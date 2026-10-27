// ============================================================================
// REPO PATH: api/_lib/mb-flowsheet.js
// ============================================================================
// multicalci.com — Material Balance Calculator — STEP 21
// WHOLE-FLOWSHEET SOLVER (MODULES['flowsheet']) + DESIGN SPECS.
//
// One POST solves an entire flowsheet server-side, so the 60/min throttle
// counts ONE call per run instead of one per unit (and recycle iterations
// cost nothing extra). All thermodynamics stay in the existing module
// solvers — this file only sequences them, exactly as a sequential-modular
// simulator does:
//   1. calculation order = strongly-connected components (Tarjan) in
//      topological order;
//   2. each recycle loop (SCC) is torn at its DFS back edges and converged
//      with bounded Wegstein (q ∈ [−5, 0], direct substitution first);
//   3. optional DESIGN SPECS ("vary X so that Y = target") wrap the whole
//      solve in a damped Newton iteration with a finite-difference Jacobian.
//
// REQUEST (POST ?module=flowsheet — standard router envelope):
//   streams : [feed, ...]              base-SI inlet streams (router-validated)
//   params  : {
//     blocks : [{ id, name?, module, params?, n_in, n_out, dp_bar? }]
//              dp_bar → P_out_bar = first-inlet P − dp_bar when the block's
//              params carry no P_out_bar (heater / valve pressure drop).
//     streams: [{ id, name?, from:{b,p}|null, to:{b,p}|null,
//                 feed?: index into body.streams (required when from=null),
//                 estimate?: stream (initial guess if the stream is torn) }]
//     specs  : [{ id?, name?, value,
//                 vary:  { kind:'feed_flow'|'feed_T'|'feed_P', stream, lo?, hi? }
//                      | { kind:'param', block, path:'T_out_K'|'reactions.0.conversion'|…, lo?, hi? }
//                      | { kind:'split', block, outlet, lo?, hi? },
//                 target:{ stream, metric, key?, keys?, num?, den? }
//                      | { block, metric:'Q_kW'|'W_kW'|'duty_kW'|'outlet_T_K', port? },
//                 tol_abs? }]
//              stream metrics: T_K P_bar mass_flow_kg_h molar_flow_kmol_h
//                mole_frac mole_frac_dry mass_frac comp_kmol_h comp_kg_h
//                ratio (num/den molar) ppm_dry (keys[])
//     options: { tol?, max_iter?, spec_tol?, spec_max_iter?, budget_ms? }
//     property_package: { model:'pr'|'srk'|'ideal'|'nrtl'|'uniquac'|'wilson'
//              |'unifac'|'modunifac', kij?, nrtl?, … }   (STEP 22)
//              passed to every rigorous block (heater, valve, pump,
//              compressor, expander, r-flash, r-mixer, r-splitter,
//              r-component-splitter, r-hx, gibbs, r-reactor, column) that
//              does not carry its own, and used for the stream table.
//     sensitivity: { vary:{…as a spec vary}, values:[…] | {from, to, points},
//              outputs:[{label?, stream, metric, key?…} | {label?, block,
//              metric:'Q_kW'|'W_kW'|'duty_kW'|'outlet_T_K'|'detail', path?}] }
//              (STEP 22) — re-solves the flowsheet (specs included) at each
//              value and returns a table; ≤ 25 points, ≤ 8 outputs.
//   }
// RESULT: { stream_results:{sid:stream}, block_results:{bid:{module,result}},
//   order, loops, specs, overall, mass_balance, energy_balance, converged,
//   iterations, warnings (all, block-prefixed), alerts (loop/spec
//   non-convergence only), log, ms, solver_version }
// Errors: standard envelope, plus `partial` (log + whatever was solved).
//
// Plain ES2020 module, no imports — receives the engine toolbox through
// register() (same pattern as mb-urea.js, so there is no circular import).
// (c) multicalci.com
// ============================================================================

'use strict';

const FS_VERSION = 'mb-flowsheet 1.2.1';
const FS_MAX_SENS_POINTS = 25;
const FS_MAX_SENS_OUT = 8;
const FS_MAX_BLOCKS = 60;
const FS_MAX_STREAMS = 160;
const FS_MAX_SPECS = 4;
const FS_DEF = { tol: 1e-6, max_iter: 60, spec_tol: 1e-6, spec_max_iter: 25, budget_ms: 7500 };
const WEG_QMIN = -5;
const WEG_QMAX = 0;

let TB = null;   // engine toolbox, set by register()

const num = (x) => typeof x === 'number' && isFinite(x);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

/** error envelope with optional partial results attached */
function fail(code, message, field, partial) {
  const e = TB.errObj(code, message, field);
  if (partial) e.partial = partial;
  return e;
}
class FsError extends Error {
  constructor(code, message, field) { super(message); this.code = code; this.field = field; }
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------
function validate(input) {
  if (!isObj(input) || !Array.isArray(input.streams)) return fail('MB_FS_INPUT', 'flowsheet needs {streams:[feeds], params:{blocks, streams}}', 'input');
  const p = input.params;
  if (!isObj(p)) return fail('MB_FS_PARAMS', 'params must be an object with blocks and streams', 'params');
  const blocks = p.blocks, streams = p.streams;
  if (!Array.isArray(blocks) || !blocks.length) return fail('MB_FS_BLOCKS', 'params.blocks must be a non-empty array', 'params.blocks');
  if (!Array.isArray(streams)) return fail('MB_FS_STREAMS', 'params.streams must be an array', 'params.streams');
  if (blocks.length > FS_MAX_BLOCKS) return fail('MB_FS_BLOCKS', `at most ${FS_MAX_BLOCKS} blocks per flowsheet`, 'params.blocks');
  if (streams.length > FS_MAX_STREAMS) return fail('MB_FS_STREAMS', `at most ${FS_MAX_STREAMS} streams per flowsheet`, 'params.streams');
  const B = new Map();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], at = `params.blocks[${i}]`;
    if (!isObj(b) || typeof b.id !== 'string' || !b.id) return fail('MB_FS_BLOCK', `${at}.id must be a non-empty string`, at);
    if (B.has(b.id)) return fail('MB_FS_BLOCK', `duplicate block id '${b.id}'`, at);
    if (typeof b.module !== 'string' || !TB.MODULES[b.module] || b.module === 'flowsheet') {
      return fail('MB_FS_MODULE', `${at}: unknown module '${b.module}'`, at + '.module');
    }
    if (!Number.isInteger(b.n_in) || b.n_in < 0 || b.n_in > 20) return fail('MB_FS_BLOCK', `${at}.n_in must be an integer 0–20`, at);
    if (!Number.isInteger(b.n_out) || b.n_out < 1 || b.n_out > 20) return fail('MB_FS_BLOCK', `${at}.n_out must be an integer 1–20`, at);
    if (b.params !== undefined && !isObj(b.params)) return fail('MB_FS_BLOCK', `${at}.params must be an object`, at);
    if (b.dp_bar !== undefined && b.dp_bar !== null && !num(b.dp_bar)) return fail('MB_FS_BLOCK', `${at}.dp_bar must be a number`, at);
    B.set(b.id, b);
  }
  const S = new Map(), inUse = new Set(), outUse = new Set();
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i], at = `params.streams[${i}]`;
    if (!isObj(s) || typeof s.id !== 'string' || !s.id) return fail('MB_FS_STREAM', `${at}.id must be a non-empty string`, at);
    if (S.has(s.id)) return fail('MB_FS_STREAM', `duplicate stream id '${s.id}'`, at);
    const end = (e, io) => {
      if (e === null || e === undefined) return null;
      if (!isObj(e) || !B.has(e.b) || !Number.isInteger(e.p) || e.p < 0) return `${at}.${io === 'out' ? 'from' : 'to'} must be {b: blockId, p: port}`;
      const blk = B.get(e.b);
      if (io === 'out' && e.p >= blk.n_out) return `${at}.from: block '${e.b}' has ${blk.n_out} outlet(s)`;
      if (io === 'in' && e.p >= blk.n_in) return `${at}.to: block '${e.b}' has ${blk.n_in} inlet(s)`;
      const key = e.b + ':' + e.p;
      const set = io === 'out' ? outUse : inUse;
      if (set.has(key)) return `${at}: port ${key} already has a stream`;
      set.add(key);
      return null;
    };
    let msg = end(s.from, 'out') || end(s.to, 'in');
    if (msg) return fail('MB_FS_STREAM', msg, at);
    if (!s.from && !s.to) return fail('MB_FS_STREAM', `${at}: a stream needs at least one connected end`, at);
    if (!s.from) {
      if (!Number.isInteger(s.feed) || s.feed < 0 || s.feed >= input.streams.length) {
        return fail('MB_FS_FEED', `${at} is a feed — 'feed' must index body.streams`, at + '.feed');
      }
    }
    S.set(s.id, s);
  }
  for (const b of blocks) {
    let last = -1;
    for (let i = 0; i < b.n_in; i++) if (inUse.has(b.id + ':' + i)) last = i;
    for (let i = 0; i <= last; i++) {
      if (!inUse.has(b.id + ':' + i)) return fail('MB_FS_PORTS', `block '${b.name || b.id}': inlet ${i + 1} is empty but a later inlet is connected`, 'params.streams');
    }
    if (last < 0) return fail('MB_FS_PORTS', `block '${b.name || b.id}' has no inlet stream`, 'params.streams');
  }
  const specs = p.specs === undefined ? [] : p.specs;
  if (!Array.isArray(specs) || specs.length > FS_MAX_SPECS) return fail('MB_FS_SPECS', `params.specs must be an array of ≤ ${FS_MAX_SPECS}`, 'params.specs');
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i], at = `params.specs[${i}]`;
    if (!isObj(sp) || !num(sp.value) || !isObj(sp.vary) || !isObj(sp.target)) return fail('MB_FS_SPEC', `${at} needs value, vary and target`, at);
    const v = sp.vary, t = sp.target;
    if (['feed_flow', 'feed_T', 'feed_P'].includes(v.kind)) {
      const fs = S.get(v.stream);
      if (!fs || fs.from) return fail('MB_FS_SPEC', `${at}.vary.stream must be a feed stream id`, at + '.vary');
    } else if (v.kind === 'param') {
      if (!B.has(v.block) || typeof v.path !== 'string' || !v.path) return fail('MB_FS_SPEC', `${at}.vary needs block and path`, at + '.vary');
    } else if (v.kind === 'split') {
      const blk = B.get(v.block);
      if (!blk || (blk.module !== 'splitter' && blk.module !== 'r-splitter') || !Number.isInteger(v.outlet) || v.outlet < 0 || v.outlet >= blk.n_out) return fail('MB_FS_SPEC', `${at}.vary needs a splitter block and outlet index`, at + '.vary');
    } else return fail('MB_FS_SPEC', `${at}.vary.kind must be feed_flow | feed_T | feed_P | param | split`, at + '.vary');
    if (t.stream !== undefined) { if (!S.has(t.stream)) return fail('MB_FS_SPEC', `${at}.target.stream unknown`, at + '.target'); }
    else if (!B.has(t.block)) return fail('MB_FS_SPEC', `${at}.target needs a stream or a block`, at + '.target');
    if (num(v.lo) && num(v.hi) && v.lo >= v.hi) return fail('MB_FS_SPEC', `${at}.vary: lo must be < hi`, at + '.vary');
  }
  let pkg = null;
  if (p.property_package !== undefined && p.property_package !== null) {
    if (!isObj(p.property_package) || typeof p.property_package.model !== 'string') return fail('MB_FS_PACKAGE', 'params.property_package must be {model, …}', 'params.property_package');
    if (!TB.rig) return fail('MB_FS_PACKAGE', 'this engine build has no rigorous property packages', 'params.property_package');
    pkg = p.property_package;
  }
  let sens = null;
  if (p.sensitivity !== undefined && p.sensitivity !== null) {
    const se = p.sensitivity, at = 'params.sensitivity';
    if (!isObj(se) || !isObj(se.vary)) return fail('MB_FS_SENS', `${at} needs vary, values and outputs`, at);
    const v = se.vary;
    if (['feed_flow', 'feed_T', 'feed_P'].includes(v.kind)) { const fs = S.get(v.stream); if (!fs || fs.from) return fail('MB_FS_SENS', `${at}.vary.stream must be a feed stream id`, at); }
    else if (v.kind === 'param') { if (!B.has(v.block) || typeof v.path !== 'string' || !v.path) return fail('MB_FS_SENS', `${at}.vary needs block and path`, at); }
    else if (v.kind === 'split') { const blk = B.get(v.block); if (!blk || !Number.isInteger(v.outlet)) return fail('MB_FS_SENS', `${at}.vary needs a splitter block and outlet index`, at); }
    else return fail('MB_FS_SENS', `${at}.vary.kind must be feed_flow | feed_T | feed_P | param | split`, at);
    let values = se.values;
    if (isObj(values) && num(values.from) && num(values.to) && Number.isInteger(values.points) && values.points >= 2) {
      const n = Math.min(values.points, FS_MAX_SENS_POINTS);
      values = Array.from({ length: n }, (_, i) => values.from + (values.to - values.from) * i / (n - 1));
    }
    if (!Array.isArray(values) || !values.length || values.length > FS_MAX_SENS_POINTS || !values.every(num)) return fail('MB_FS_SENS', `${at}.values must be 1–${FS_MAX_SENS_POINTS} numbers or {from, to, points}`, at);
    const outs = se.outputs;
    if (!Array.isArray(outs) || !outs.length || outs.length > FS_MAX_SENS_OUT) return fail('MB_FS_SENS', `${at}.outputs must list 1–${FS_MAX_SENS_OUT} targets`, at);
    for (const t of outs) {
      if (!isObj(t)) return fail('MB_FS_SENS', `${at}.outputs entries must be objects`, at);
      if (t.stream !== undefined) { if (!S.has(t.stream)) return fail('MB_FS_SENS', `${at}: unknown output stream '${t.stream}'`, at); }
      else if (!B.has(t.block)) return fail('MB_FS_SENS', `${at}: output needs a stream or a block`, at);
    }
    sens = { vary: v, values, outputs: outs };
  }
  const o = Object.assign({}, FS_DEF, isObj(p.options) ? p.options : {});
  for (const k of Object.keys(FS_DEF)) if (!num(o[k]) || o[k] <= 0) o[k] = FS_DEF[k];
  o.budget_ms = Math.min(o.budget_ms, 8500);
  o.max_iter = Math.min(Math.round(o.max_iter), 500);
  o.spec_max_iter = Math.min(Math.round(o.spec_max_iter), 60);
  return { blocks, streams, B, S, specs, opts: o, feeds: input.streams, pkg, sens };
}

// ---------------------------------------------------------------------------
// calculation order — Tarjan SCCs + DFS back-edge tears inside each loop
// ---------------------------------------------------------------------------
function buildPlan(M) {
  const ids = M.blocks.map((b) => b.id);
  const adj = new Map(ids.map((i) => [i, []]));
  for (const s of M.streams) if (s.from && s.to) adj.get(s.from.b).push({ to: s.to.b, sid: s.id });
  let index = 0;
  const st = [], on = new Set(), idx = new Map(), low = new Map(), sccs = [];
  const strong = (v) => {
    idx.set(v, index); low.set(v, index); index++; st.push(v); on.add(v);
    for (const e of adj.get(v)) {
      if (!idx.has(e.to)) { strong(e.to); low.set(v, Math.min(low.get(v), low.get(e.to))); }
      else if (on.has(e.to)) low.set(v, Math.min(low.get(v), idx.get(e.to)));
    }
    if (low.get(v) === idx.get(v)) {
      const c = []; let w;
      do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v);
      sccs.push(c);
    }
  };
  for (const v of ids) if (!idx.has(v)) strong(v);
  sccs.reverse();
  const plan = [];
  for (const c of sccs) {
    const self = adj.get(c[0]).some((e) => e.to === c[0]);
    if (c.length === 1 && !self) { plan.push({ blocks: c, loop: false, tears: [] }); continue; }
    const set = new Set(c);
    const ordered = ids.filter((id) => set.has(id));
    const ext = (bid) => M.streams.some((s) => s.to && s.to.b === bid && (!s.from || !set.has(s.from.b)));
    const start = ordered.find(ext) || ordered[0];
    const tears = [], state = new Map();
    const dfs = (v) => {
      state.set(v, 1);
      for (const e of adj.get(v)) {
        if (!set.has(e.to)) continue;
        const sv = state.get(e.to);
        if (!sv) dfs(e.to); else if (sv === 1) tears.push(e.sid);
      }
      state.set(v, 2);
    };
    dfs(start);
    for (const v of ordered) if (!state.get(v)) dfs(v);
    const tset = new Set(tears);
    const indeg = new Map(ordered.map((v) => [v, 0]));
    for (const s of M.streams) if (s.from && s.to && set.has(s.from.b) && set.has(s.to.b) && !tset.has(s.id)) indeg.set(s.to.b, indeg.get(s.to.b) + 1);
    const order = [], q = ordered.filter((v) => indeg.get(v) === 0);
    while (q.length) {
      const v = q.shift(); order.push(v);
      for (const e of adj.get(v)) {
        if (!set.has(e.to) || tset.has(e.sid)) continue;
        indeg.set(e.to, indeg.get(e.to) - 1);
        if (indeg.get(e.to) === 0) q.push(e.to);
      }
    }
    plan.push({ blocks: order, loop: true, tears });
  }
  return plan;
}

// ---------------------------------------------------------------------------
// stream helpers
// ---------------------------------------------------------------------------
/** API-clean copy: key + mass_fraction only (phases re-evaluated downstream) */
function clean(s) {
  let comps = (s.components || []).filter((c) => num(c.mass_fraction) && c.mass_fraction > 0);
  if (!comps.length) comps = (s.components || []).slice(0, 1).map((c) => ({ key: c.key, mass_fraction: 1 }));
  const sum = comps.reduce((a, c) => a + c.mass_fraction, 0) || 1;
  const o = { mass_flow_kg_h: Math.max(0, num(s.mass_flow_kg_h) ? s.mass_flow_kg_h : 0), T_K: s.T_K, P_bar: s.P_bar,
    components: comps.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction / sum })) };
  // STEP 22: rigorous state (molar H, vapour fraction, package signature) lets
  // the next rigorous block reconstruct saturated / pure-component states
  if (s.rig && typeof s.rig.sig === 'string') o.rig = { sig: s.rig.sig, h_Jmol: s.rig.h_Jmol, beta: s.rig.beta };
  if (s.spec === 'PVF' && num(s.vapour_fraction)) { o.spec = 'PVF'; o.vapour_fraction = s.vapour_fraction; }
  return o;
}
function sObj(s) {
  const m = {};
  for (const c of s.components || []) m[c.key] = (m[c.key] || 0) + c.mass_fraction * s.mass_flow_kg_h;
  return { m, T: s.T_K, P: s.P_bar };
}
function objS(o) {
  let keys = Object.keys(o.m).filter((k) => o.m[k] > 0);
  let tot = keys.reduce((a, k) => a + o.m[k], 0);
  if (!(tot > 0)) { keys = Object.keys(o.m).slice(0, 1); tot = 1e-9; }
  return { mass_flow_kg_h: tot, T_K: o.T, P_bar: o.P,
    components: keys.map((k) => ({ key: k, mass_fraction: (o.m[k] > 0 ? o.m[k] : tot) / tot })) };
}
function keysOf(...os) { const s = new Set(); for (const o of os) if (o) for (const k in o.m) s.add(k); return [...s]; }
function relErr(x, g) {
  const sx = Object.values(x.m).reduce((a, b) => a + b, 0), sg = Object.values(g.m).reduce((a, b) => a + b, 0);
  const tot = Math.max(sx, sg, 1e-12);
  let e = 0;
  for (const k of keysOf(x, g)) e = Math.max(e, Math.abs((g.m[k] || 0) - (x.m[k] || 0)) / tot);
  return Math.max(e, Math.abs(g.T - x.T) / Math.max(g.T, 1), Math.abs(g.P - x.P) / Math.max(g.P, 1e-6));
}
function wegstein(x, g, xp, gp) {
  const step = (xv, gv, xpv, gpv) => {
    if (!xp) return gv;
    const dx = xv - xpv;
    if (!(Math.abs(dx) > 1e-14 * (Math.abs(xv) + 1e-30))) return gv;
    const sl = (gv - gpv) / dx;
    let q = sl / (sl - 1);
    if (!isFinite(q)) q = 0;
    q = clamp(q, WEG_QMIN, WEG_QMAX);
    return q * xv + (1 - q) * gv;
  };
  const n = { m: {}, T: 0, P: 0 };
  for (const k of keysOf(x, g, xp, gp)) n.m[k] = Math.max(0, step(x.m[k] || 0, g.m[k] || 0, xp ? xp.m[k] || 0 : 0, gp ? gp.m[k] || 0 : 0));
  n.T = Math.max(1, step(x.T, g.T, xp && xp.T, gp && gp.T));
  n.P = Math.max(1e-6, step(x.P, g.P, xp && xp.P, gp && gp.P));
  return n;
}
const label = (b) => b.name || b.id;
const sname = (s) => s.name || s.id;

// ---------------------------------------------------------------------------
// one complete sequential-modular pass (all loops converged)
// ---------------------------------------------------------------------------
function evaluate(M, plan, opts, deadline, logOn, sink) {
  const SV = {}, BR = {}, log = [], warnings = [], loops = [], alerts = [];
  if (sink) { sink.SV = SV; sink.BR = BR; sink.log = log; }
  let solves = 0;
  const L = (k, t) => { if (logOn) log.push([k, t]); };
  for (const s of M.streams) if (!s.from) SV[s.id] = clean(M.feeds[s.feed]);
  const inlets = (b) => {
    const out = [];
    for (let i = 0; i < b.n_in; i++) {
      const s = M.streams.find((x) => x.to && x.to.b === b.id && x.to.p === i);
      if (!s) break;
      if (!SV[s.id]) throw new FsError('MB_FS_ORDER', `${label(b)}: inlet ${i + 1} (${sname(s)}) has no value yet`, 'params.streams');
      out.push(clean(SV[s.id]));
    }
    return out;
  };
  const solve = (bid, quiet) => {
    if (Date.now() > deadline) throw new FsError('MB_FS_BUDGET', 'flowsheet exceeded the server time budget — simplify the flowsheet or loosen tolerances', 'params.options');
    const b = M.B.get(bid);
    const ins = inlets(b);
    const params = Object.assign({}, b.params || {});
    if (num(b.dp_bar) && !num(params.P_out_bar) && ins[0]) params.P_out_bar = ins[0].P_bar - b.dp_bar;
    if (M.pkg && TB.RIG_NAMES && TB.RIG_NAMES.has(b.module) && !isObj(params.property_package)) params.property_package = M.pkg;
    // integrating units get what is left of the flowsheet's time budget (Vercel limit)
    if (b.module === 'r-pfr' || b.module === 'r-cstr') params.budget_ms = Math.max(200, Math.min(num(params.budget_ms) ? params.budget_ms : 5000, deadline - Date.now()));
    const r = TB.runModule(b.module, { streams: ins, params });
    solves++;
    if (r.error) throw new FsError(r.error.code, `${label(b)} (${b.module}): ${r.error.message}`, r.error.field);
    BR[bid] = { module: b.module, result: r };
    const outs = r.streams_out || [];
    for (let j = 0; j < b.n_out; j++) {
      const s = M.streams.find((x) => x.from && x.from.b === bid && x.from.p === j);
      if (s && outs[j]) SV[s.id] = outs[j];
    }
    if (!quiet) {
      const cp = r.mass_balance && r.mass_balance.closure_pct;
      L('o', `✓ ${label(b)} (${b.module})` + (num(cp) ? ` · closure ${cp.toPrecision(3)} %` : ''));
    }
    for (const w of r.warnings || []) { const t = `${label(b)}: ${typeof w === 'string' ? w : (w && w.message) || ''}`; if (!warnings.includes(t)) warnings.push(t); }
    if (r.converged === false && !quiet) {
      const m = `${label(b)} (${b.module}) did not converge — results are the last iterate`;
      if (!alerts.includes(m)) { alerts.push(m); L('w', '⚠ ' + m); }
    }
  };
  for (const step of plan) {
    if (!step.loop) { solve(step.blocks[0], false); continue; }
    const names = step.blocks.map((id) => label(M.B.get(id))).join(' → ');
    L('h', `⟲ recycle loop ${names} · tear ${step.tears.map((t) => sname(M.S.get(t))).join(', ')}`);
    const rec = { blocks: step.blocks, tears: step.tears, iterations: 0, err: NaN, converged: false };
    loops.push(rec);
    let x = step.tears.map((tid) => {
      const s = M.S.get(tid);
      if (isObj(s.estimate) && num(s.estimate.mass_flow_kg_h) && Array.isArray(s.estimate.components) && s.estimate.components.length) return sObj(clean(s.estimate));
      let best = null;
      for (const st of M.streams) {
        if (st.to && step.blocks.includes(st.to.b) && (!st.from || !step.blocks.includes(st.from.b))) {
          const v = SV[st.id];
          if (v && (!best || v.mass_flow_kg_h > best.mass_flow_kg_h)) best = v;
        }
      }
      if (!best) throw new FsError('MB_FS_LOOP', `loop ${names} has no fresh feed`, 'params.streams');
      const o = sObj(clean(best));
      for (const k in o.m) o.m[k] *= 0.01;
      return o;
    });
    let xp = null, gp = null;
    for (let it = 1; it <= opts.max_iter; it++) {
      step.tears.forEach((tid, k) => { SV[tid] = objS(x[k]); });
      for (const bid of step.blocks) solve(bid, true);
      const g = step.tears.map((tid) => sObj(SV[tid]));
      const err = Math.max(...g.map((gk, k) => relErr(x[k], gk)));
      rec.iterations = it; rec.err = err;
      L('', `   iteration ${it} · max relative change ${err.toExponential(2)}`);
      if (err <= opts.tol) { rec.converged = true; break; }
      const xn = x.map((xk, k) => wegstein(xk, g[k], xp && xp[k], gp && gp[k]));
      xp = x; gp = g; x = xn;
    }
    if (rec.converged) L('o', `✓ loop converged in ${rec.iterations} iterations (error ${rec.err.toExponential(2)})`);
    else {
      const m = `recycle loop ${names} did not converge in ${rec.iterations} iterations (error ${rec.err.toExponential(2)}) — last iterate returned`;
      L('w', '⚠ ' + m); warnings.push(m); alerts.push(m);
    }
  }
  return { SV, BR, log, warnings, loops, solves, alerts, pkg: M.pkg || null };
}

// ---------------------------------------------------------------------------
// design-spec metrics and manipulated variables
// ---------------------------------------------------------------------------
function molesOf(s) {
  if (s.rig && TB.rig && TB.rig.moles) { const m = TB.rig.moles(s); if (m) return m; }   // databank MW for rigorous streams
  const n = {};
  let tot = 0;
  for (const c of s.components || []) {
    const r = TB.resolve(c.key);
    if (r.error) continue;
    const ni = c.mass_fraction * s.mass_flow_kg_h / r.mw;
    n[c.key] = (n[c.key] || 0) + ni; tot += ni;
  }
  return { n, tot };
}
function metric(t, ev) {
  if (t.stream !== undefined) {
    const s = ev.SV[t.stream];
    if (!s) throw new FsError('MB_FS_SPEC', `target stream '${t.stream}' was not calculated`, 'params.specs');
    const mm = () => molesOf(s);
    switch (t.metric) {
      case 'T_K': return s.T_K;
      case 'P_bar': return s.P_bar;
      case 'mass_flow_kg_h': return s.mass_flow_kg_h;
      case 'molar_flow_kmol_h': return mm().tot;
      case 'mass_frac': { const c = s.components.find((x) => x.key === t.key); return c ? c.mass_fraction : 0; }
      case 'comp_kg_h': { const c = s.components.find((x) => x.key === t.key); return c ? c.mass_fraction * s.mass_flow_kg_h : 0; }
      case 'comp_kmol_h': return mm().n[t.key] || 0;
      case 'mole_frac': { const { n, tot } = mm(); return tot > 0 ? (n[t.key] || 0) / tot : 0; }
      case 'mole_frac_dry': { const { n, tot } = mm(); const d = tot - (n.H2O || 0); return d > 0 ? (n[t.key] || 0) / d : 0; }
      case 'ratio': { const { n } = mm(); return (n[t.num] || 0) / (n[t.den] || NaN); }
      case 'ppm_dry': { const { n, tot } = mm(); const d = tot - (n.H2O || 0); return d > 0 ? (t.keys || []).reduce((a, k) => a + (n[k] || 0), 0) / d * 1e6 : 0; }
      case 'vapour_fraction': {
        if (s.rig && num(s.rig.beta)) return s.rig.beta;
        if (ev.pkg && TB.rig) { const d = TB.rig.describeStream(ev.pkg, clean(s)); return d.vapour_fraction; }
        throw new FsError('MB_FS_SPEC', 'vapour_fraction needs a property package', 'params.specs');
      }
      case 'H_kW': return num(s.H_kJh) ? s.H_kJh / 3600 : NaN;
      default: throw new FsError('MB_FS_SPEC', `unknown stream metric '${t.metric}'`, 'params.specs');
    }
  }
  const br = ev.BR[t.block];
  if (!br) throw new FsError('MB_FS_SPEC', `target block '${t.block}' was not calculated`, 'params.specs');
  const r = br.result, eb = r.energy_balance || {};
  switch (t.metric) {
    case 'Q_kW': return eb.Q_kW;
    case 'W_kW': return eb.W_kW;
    case 'duty_kW': return r.details && num(r.details.duty_kW) ? r.details.duty_kW : eb.Q_kW;
    case 'outlet_T_K': { const o = (r.streams_out || [])[t.port || 0]; return o ? o.T_K : NaN; }
    case 'detail': {
      const v = typeof t.path === 'string' ? getPath(r.details || {}, t.path) : undefined;
      if (!num(v)) throw new FsError('MB_FS_SPEC', `block '${t.block}' has no numeric result '${t.path}'`, 'params.specs');
      return v;
    }
    default: throw new FsError('MB_FS_SPEC', `unknown block metric '${t.metric}'`, 'params.specs');
  }
}
function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.');
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') throw new FsError('MB_FS_SPEC', `vary path '${path}' not found in block params`, 'params.specs');
    a = a[ks[i]];
  }
  a[ks[ks.length - 1]] = v;
}
function readVary(v, M) {
  if (v.kind === 'feed_flow') return M.feeds[M.S.get(v.stream).feed].mass_flow_kg_h;
  if (v.kind === 'feed_T') return M.feeds[M.S.get(v.stream).feed].T_K;
  if (v.kind === 'feed_P') return M.feeds[M.S.get(v.stream).feed].P_bar;
  if (v.kind === 'split') { const f = (M.B.get(v.block).params || {}).fractions || []; return num(f[v.outlet]) ? f[v.outlet] : 0; }
  const x = getPath(M.B.get(v.block).params || {}, v.path);
  if (!num(x)) throw new FsError('MB_FS_SPEC', `vary path '${v.path}' of block '${v.block}' must hold a number (give a starting value)`, 'params.specs');
  return x;
}
function writeVary(v, M, x) {
  if (v.kind === 'feed_flow') M.feeds[M.S.get(v.stream).feed].mass_flow_kg_h = x;
  else if (v.kind === 'feed_T') M.feeds[M.S.get(v.stream).feed].T_K = x;
  else if (v.kind === 'feed_P') M.feeds[M.S.get(v.stream).feed].P_bar = x;
  else if (v.kind === 'split') {
    const b = M.B.get(v.block);
    const f = ((b.params || {}).fractions || []).slice();
    const rest = f.reduce((a, y, j) => a + (j === v.outlet ? 0 : (num(y) ? y : 0)), 0);
    const others = f.length - 1;
    for (let j = 0; j < f.length; j++) {
      if (j === v.outlet) f[j] = x;
      else f[j] = rest > 0 ? (num(f[j]) ? f[j] : 0) / rest * (1 - x) : (1 - x) / others;
    }
    b.params = Object.assign({}, b.params, { fractions: f });
  } else {
    const b = M.B.get(v.block);
    b.params = JSON.parse(JSON.stringify(b.params || {}));
    setPath(b.params, v.path, x);
  }
}
function defaultBounds(v, x0) {
  if (num(v.lo) && num(v.hi)) return [v.lo, v.hi];
  if (v.kind === 'split') return [0, 1];
  if (v.kind === 'feed_T' || /(^|\.)T_|_K$/.test(v.path || '')) return [Math.max(1, x0 - 400), x0 + 400];
  if (v.kind === 'feed_P') return [Math.max(1e-3, x0 / 20), x0 * 20];
  if (/conversion|fraction|efficiency|eta/.test(v.path || '')) return [1e-6, 1];
  const a = Math.abs(x0) || 1;
  return [num(v.lo) ? v.lo : (x0 > 0 ? x0 / 50 : x0 - 50 * a), num(v.hi) ? v.hi : (x0 > 0 ? x0 * 50 : x0 + 50 * a)];
}
function gaussSolve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// ---------------------------------------------------------------------------
// public entry
// ---------------------------------------------------------------------------
function cloneModel(M) {
  const C = {
    blocks: M.blocks.map((b) => Object.assign({}, b, { params: JSON.parse(JSON.stringify(b.params || {})) })),
    streams: M.streams, S: M.S, feeds: M.feeds.map((f) => JSON.parse(JSON.stringify(f))), pkg: M.pkg,
  };
  C.B = new Map(C.blocks.map((b) => [b.id, b]));
  return C;
}

/**
 * One complete solve: sequential-modular pass, and the design-spec Newton
 * around it when specs are present. Throws FsError.
 * @returns {{ev, specOut, solves}}
 */
function core(M, plan, V, opts, deadline, logOn, sink) {
  let ev = null, totalSolves = 0;
  const specOut = [];
  if (!V.specs.length) {
    ev = evaluate(M, plan, opts, deadline, logOn, sink);
    return { ev, specOut, solves: ev.solves };
  }
  /* inner recycle tolerance tighter than the spec tolerance so the FD Jacobian is clean */
  const inner = Object.assign({}, opts, { tol: Math.min(opts.tol, opts.spec_tol * 1e-2) });
  const vs = V.specs.map((sp) => sp.vary);
  let x = vs.map((v) => readVary(v, M));
  const bounds = vs.map((v, i) => defaultBounds(v, x[i]));
  x = x.map((xi, i) => clamp(xi, bounds[i][0], bounds[i][1]));
  const F = (xv) => {
    xv.forEach((xi, i) => writeVary(vs[i], M, xi));
    const e = evaluate(M, plan, inner, deadline, false, sink);
    totalSolves += e.solves;
    return { e, r: V.specs.map((sp) => metric(sp.target, e) - sp.value) };
  };
  let cur = F(x);
  const tols = V.specs.map((sp, i) => (num(sp.tol_abs) && sp.tol_abs > 0 ? sp.tol_abs
    : opts.spec_tol * Math.max(Math.abs(sp.value), Math.abs(cur.r[i] + sp.value) * 1e-3, 1e-12)));
  const scaled = (r) => Math.max(...r.map((ri, i) => Math.abs(ri) / tols[i]));
  if (!cur.r.every(num)) throw new FsError('MB_FS_SPEC', 'a design-spec target is not a number at the starting point (e.g. ratio with a zero denominator)', 'params.specs');
  let it = 0, conv = scaled(cur.r) <= 1;
  for (; !conv && it < opts.spec_max_iter; it++) {
    const n = x.length;
    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      let h = Math.max(Math.abs(x[j]) * 1e-4, (bounds[j][1] - bounds[j][0]) * 1e-7, 1e-10);
      if (x[j] + h > bounds[j][1]) h = -h;
      const xh = x.slice(); xh[j] += h;
      const rh = F(xh).r;
      for (let i = 0; i < n; i++) J[i][j] = (rh[i] - cur.r[i]) / h;
    }
    const dx = gaussSolve(J, cur.r.map((v) => -v));
    if (!dx || !dx.every(num)) throw new FsError('MB_FS_SPEC_SINGULAR', 'design spec cannot be met: the varied quantity has no effect on the target', 'params.specs');
    let lam = 1, best = null;
    for (let ls = 0; ls < 8; ls++) {
      const xn = x.map((xi, i) => clamp(xi + lam * dx[i], bounds[i][0], bounds[i][1]));
      const tr = F(xn);
      if (tr.r.every(num) && (!best || scaled(tr.r) < scaled(best.r))) best = { x: xn, ...tr };
      if (tr.r.every(num) && scaled(tr.r) < scaled(cur.r)) break;
      lam /= 2;
    }
    if (!best || scaled(best.r) >= scaled(cur.r)) {
      const atBound = x.some((xi, i) => Math.abs(xi - bounds[i][0]) < 1e-12 || Math.abs(xi - bounds[i][1]) < 1e-12);
      throw new FsError('MB_FS_SPEC_STALL', 'design spec stalled' + (atBound ? ' at a bound of the varied quantity — widen lo/hi' : ' — check the spec is reachable'), 'params.specs');
    }
    x = best.x; cur = best;
    conv = scaled(cur.r) <= 1;
  }
  x.forEach((xi, i) => writeVary(vs[i], M, xi));
  ev = evaluate(M, plan, inner, deadline, logOn, sink);
  totalSolves += ev.solves;
  V.specs.forEach((sp, i) => {
    const val = metric(sp.target, ev);
    specOut.push({ id: sp.id || ('spec' + (i + 1)), name: sp.name || null, varied: x[i], target_value: val,
      target: sp.value, residual: val - sp.value, converged: conv, iterations: it, bounds: bounds[i] });
  });
  ev.log.unshift(['h', `◎ design spec${V.specs.length > 1 ? 's' : ''} ${conv ? 'met' : 'NOT met'} in ${it} Newton iteration${it === 1 ? '' : 's'}: ` +
    specOut.map((s2) => `${s2.name || s2.id} → varied = ${s2.varied.toPrecision(7)}, target ${s2.target_value.toPrecision(7)}`).join('; ')]);
  if (!conv) {
    const m = `design spec not met after ${it} iterations (max scaled residual ${scaled(cur.r).toPrecision(3)})`;
    ev.warnings.push(m); ev.alerts.push(m);
  }
  return { ev, specOut, solves: totalSolves };
}

function solveFlowsheet(input) {
  const t0 = Date.now();
  const V = validate(input);
  if (V.error) return V;
  const opts = V.opts;
  const deadline = t0 + opts.budget_ms;
  const M = {
    blocks: V.blocks.map((b) => Object.assign({}, b, { params: JSON.parse(JSON.stringify(b.params || {})) })),
    streams: V.streams, S: V.S, feeds: V.feeds.map((f) => JSON.parse(JSON.stringify(f))), pkg: V.pkg,
  };
  M.B = new Map(M.blocks.map((b) => [b.id, b]));
  const M0 = V.sens ? cloneModel(M) : null;        // user inputs, before specs move anything
  const plan = buildPlan(M);
  const orderTxt = plan.map((p) => (p.loop ? '[' + p.blocks.map((id) => label(M.B.get(id))).join(' → ') + ']⟲' : label(M.B.get(p.blocks[0])))).join('  →  ');
  let ev = null;
  const sink = {};
  let specOut = [];
  let totalSolves = 0;
  try {
    const r = core(M, plan, V, opts, deadline, true, sink);
    ev = r.ev; specOut = r.specOut; totalSolves = r.solves;
  } catch (e) {
    if (e instanceof FsError) {
      const solved = {};
      for (const k in sink.SV || {}) solved[k] = sink.SV[k];
      return fail(e.code, e.message, e.field, { order: orderTxt, log: (sink.log || []).concat([['e', '✕ ' + e.message]]),
        stream_results: solved, block_results: sink.BR || {}, solves: totalSolves, ms: Date.now() - t0 });
    }
    return fail('MB_FS_THROW', 'flowsheet solver exception: ' + e.message, 'params', null);
  }

  /* sensitivity study: re-solve from the user's inputs at each value */
  let sensitivity;
  if (V.sens) {
    const rows = [];
    let stopped = false;
    for (const val of V.sens.values) {
      if (Date.now() > deadline) { stopped = true; break; }
      const Mi = cloneModel(M0);
      const row = { value: val };
      try {
        writeVary(V.sens.vary, Mi, val);
        const r = core(Mi, plan, V, opts, deadline, false, {});
        totalSolves += r.solves;
        row.outputs = V.sens.outputs.map((t) => { try { return metric(t, r.ev); } catch (e) { return null; } });
        row.converged = r.ev.loops.every((l) => l.converged) && r.specOut.every((sp) => sp.converged) &&
          Object.values(r.ev.BR).every((br) => br.result.converged !== false);
        if (r.ev.alerts.length) row.alerts = r.ev.alerts.slice(0, 3);
      } catch (e) {
        row.error = e.message;
      }
      rows.push(row);
    }
    sensitivity = { vary: V.sens.vary, outputs: V.sens.outputs, rows, complete: !stopped && rows.length === V.sens.values.length };
    if (stopped) ev.warnings.push(`sensitivity stopped at the server time budget after ${rows.length} of ${V.sens.values.length} points`);
    ev.log.push(['h', `◇ sensitivity: ${rows.length} point${rows.length === 1 ? '' : 's'} solved${stopped ? ' (stopped at the time budget)' : ''}`]);
  }

  /* feed enthalpies + phase summary for every calculated stream */
  const SR = {};
  for (const s of M.streams) {
    const v = ev.SV[s.id];
    if (!v) continue;
    const out = Object.assign({}, v, { components: (v.components || []).map((c) => Object.assign({}, c)) });
    if (M.pkg && TB.rig && !(out.rig && out.rig.props)) {
      // STEP 22: every stream described by the flowsheet's property package
      try {
        const d = TB.rig.describeStream(M.pkg, clean(out));
        out.H_kJh = d.H_kJh; out.vapour_fraction = d.vapour_fraction; out.rig = d.rig;
        if (!s.from && d.T_K !== out.T_K) out.T_K = d.T_K;
      } catch (_e) { /* component outside the rigorous databank — legacy description below */ }
    }
    const e = out.rig ? { error: true } : TB.streamEnthalpy(clean(out));
    if (!e.error) {
      if (!num(out.H_kJh)) out.H_kJh = e.H_kJh;
      const ph = {};
      for (const pc of e.perComponent) if (pc.phase) ph[pc.key] = pc.phase;
      for (const c of out.components) if (!c.phase && ph[c.key]) c.phase = ph[c.key];
    }
    const rm = out.rig && TB.rig && TB.rig.moles ? TB.rig.moles(out) : null;
    if (rm && rm.tot > 0) {
      out.n_kmol_h = rm.tot;
      out.mw_avg = out.mass_flow_kg_h / rm.tot;
      out.mole_fractions = Object.fromEntries(Object.entries(rm.n).map(([k, v]) => [k, v / rm.tot]));
    } else {
      const mol = TB.molarize(clean(out));
      if (!mol.error) {
        out.n_kmol_h = mol.n_total_kmol_h;
        out.mw_avg = mol.mw_avg;
        out.mole_fractions = Object.fromEntries(mol.components.map((c) => [c.key, c.mole_fraction]));
      }
    }
    if (!s.from) out.feed = true;
    SR[s.id] = out;
  }
  /* overall balance (feeds vs products + unconnected outlets) */
  let mIn = 0, mOut = 0, hIn = 0, hOut = 0, hOk = true;
  const feedsL = [], prodsL = [];
  for (const s of M.streams) {
    const r = SR[s.id];
    if (!r) continue;
    if (!s.from) { feedsL.push(sname(s)); mIn += r.mass_flow_kg_h; if (num(r.H_kJh)) hIn += r.H_kJh; else hOk = false; }
    else if (!s.to) { prodsL.push(sname(s)); mOut += r.mass_flow_kg_h; if (num(r.H_kJh)) hOut += r.H_kJh; else hOk = false; }
  }
  let heat = 0, cool = 0, work = 0, workOut = 0;
  for (const b of M.blocks) {
    const br = ev.BR[b.id];
    if (!br) continue;
    for (let j = 0; j < b.n_out; j++) {
      if (M.streams.some((s) => s.from && s.from.b === b.id && s.from.p === j)) continue;
      const o = (br.result.streams_out || [])[j];
      if (!o) continue;
      prodsL.push(`${label(b)}·out${j + 1}`);
      mOut += o.mass_flow_kg_h;
      if (num(o.H_kJh)) hOut += o.H_kJh; else if (o.mass_flow_kg_h > 0) hOk = false;
    }
    const eb = br.result.energy_balance || {};
    const dl = br.result.details && Array.isArray(br.result.details.duties) ? br.result.details.duties : null;
    if (dl) { for (const d of dl) if (num(d.kW)) { if (d.kW > 0) heat += d.kW; else cool += d.kW; } }   // column: condenser and reboiler separately
    else if (num(eb.Q_kW)) { if (eb.Q_kW > 0) heat += eb.Q_kW; else cool += eb.Q_kW; }
    if (num(eb.W_kW)) { if (eb.W_kW > 0) work += eb.W_kW; else workOut += eb.W_kW; }
  }
  const closure = mIn > 0 ? (mOut - mIn) / mIn * 100 : 0;
  const loopsOk = ev.loops.every((l) => l.converged);
  const specsOk = specOut.every((s) => s.converged);
  ev.log.unshift(['h', 'Calculation order: ' + orderTxt]);
  const ms = Date.now() - t0;
  ev.log.push(['o', `■ solved server-side · ${totalSolves} unit solves · ${ms} ms`]);
  const products = M.streams.filter((s) => s.from && !s.to && SR[s.id]).map((s) => Object.assign({ stream_id: s.id }, SR[s.id]));
  return {
    streams_out: products,
    stream_results: SR,
    block_results: ev.BR,
    order: plan.map((p) => ({ blocks: p.blocks, loop: p.loop, tears: p.tears })),
    loops: ev.loops,
    specs: specOut,
    feeds_varied: V.specs.length ? M.feeds : undefined,
    overall: { feeds: feedsL, products: prodsL, mIn, mOut, closure, dH_kW: hOk ? (hOut - hIn) / 3600 : null, heat, cool, work, workOut },
    mass_balance: { in: mIn, out: mOut, closure_pct: closure },
    energy_balance: { Hin: hOk ? hIn : null, Hout: hOk ? hOut : null, Q_kW: hOk ? (hOut - hIn) / 3600 - (work + workOut) : null, W_kW: work + workOut },
    details: { blocks: M.blocks.length, streams: M.streams.length, unit_solves: totalSolves, solver: FS_VERSION,
      property_package: M.pkg ? M.pkg.model : null },
    sensitivity,
    converged: loopsOk && specsOk,
    iterations: totalSolves,
    warnings: ev.warnings,
    alerts: ev.alerts,           // loop / spec non-convergence only (UI status lamp)
    log: ev.log,
    ms,
    solver_version: FS_VERSION,
  };
}

/**
 * Register into the engine's MODULES. The toolbox must expose the LIVE
 * MODULES object so blocks can call every module registered before or after.
 * @param {{errObj:Function, MODULES:object, runModule:Function,
 *          streamEnthalpy:Function, resolve:Function}} toolbox
 * @returns {{flowsheet:Function}}
 */
function register(toolbox) {
  TB = toolbox;
  return { flowsheet: solveFlowsheet };
}

export default { register, FS_VERSION };
