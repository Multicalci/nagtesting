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
//     energy_streams: [{ id, name?, from: blockId|null, to: blockId|null,   (ROUND 16)
//                 kW?: energy given at a free source end, efficiency?: (0, 1] }]
//              heat or shaft work carried from one unit to another, as a
//              simulator's energy stream: the unit at `to` takes its duty (heater,
//              mixer, r-flash, r-flash3: duty / Q_kW) or shaft power (compressor:
//              spec 'power') from the energy the unit at `from` gives up —
//              value = −(Q_kW or W_kW of `from`) × efficiency (both signs positive
//              INTO the fluid, so a cooler's or a turbine's output is positive).
//              No `from`: kW is given. No `to`: the stream only reports the
//              energy leaving `from`. Linked streams run as feed-forward or
//              feedback calculators (see calculators below).
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
//     options: { tol?, max_iter?, spec_tol?, spec_max_iter?, budget_ms?,
//              accelerator?: 'broyden' (default) | 'wegstein' }   (STEP 30)
//     resume: continuation token from an earlier call's result.resume or
//              error.partial.resume (STEP 30) — same flowsheet, posted again
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
//              value and returns a table; ≤ 60 points, ≤ 16 outputs.
//   }
// RESULT: { stream_results:{sid:stream}, block_results:{bid:{module,result}},
//   order, loops, specs, overall, mass_balance, energy_balance, converged,
//   iterations, warnings (all, block-prefixed), alerts (loop/spec
//   non-convergence only), log, ms, resume?, solver_version }
// Errors: standard envelope, plus `partial` (log + whatever was solved;
//   partial.resume when the time budget ran out — post again with it).
//
// STEP 30 — faster solver path for large flowsheets:
//   · fewest torn streams breaking every loop (user estimates preferred)
//   · Broyden quasi-Newton on the torn streams after two Wegstein passes,
//     falling back to substitution when a step fails or diverges
//   · per-request warm context: last converged tears (and Broyden inverse
//     Jacobian) per loop, last converged profile per rigorous column,
//     cache of unit results with identical inlets and parameters
//   · design-spec trial points that make a unit fail count as failed steps
//   · resumable continuation across calls (Vercel time limit)
//
// STEP 35 — solver transparency (result fields):
//   · loops[i].history: one entry per pass {it, err, method, tears?} — err is the
//     largest relative change of the torn streams, method how that pass's starting
//     point was made (guess | estimate | warm | continued | substitution | wegstein |
//     broyden | retreat); carried across continuation calls in the token;
//     kept to 250 entries (history_trimmed)
//   · loops[i].tear_status: per torn stream, the last change in flow, T, P and the
//     worst component; history_first_evaluation and iterations_all_evaluations when
//     design specs or feedback calculators solved the loop several times
//   · convergence: { accelerator, tolerances, evaluations, spec_history (Newton
//     steps: varied, residuals, scaled residual, step length, Jacobian),
//     calculator_history (feedback-calculator passes), tear_streams }
//
// Plain ES2020 module, no imports — receives the engine toolbox through
// register() (same pattern as mb-urea.js, so there is no circular import).
// (c) multicalci.com
// ============================================================================

'use strict';

import calc from './mb-calc.js';                // STEP 34 — calculator blocks (pure expression language, no imports)
import econ from './mb-econ.js';                // STEP 36 — equipment and utility costs
import optim from './mb-optim.js';              // STEP 36 — bounded minimisers (generators)

const FS_VERSION = 'mb-flowsheet 1.9.0';     // ROUND 16: energy streams
// STEP 36: optimisation (objective, bounded decision variables, inequality constraints)
const FS_MAX_OPT_VARS = 6, FS_MAX_OPT_CONS = 8, FS_MAX_OPT_EVALS = 300;
const ECON_METRICS = ['total_annual_cost_y', 'grassroots', 'total_module', 'bare_module', 'utility_cost_y', 'annualised_capital_y'];
// STEP 34: larger flowsheets (a whole ammonia–urea complex) — the time budget per call is
// unchanged; big flowsheets continue over further calls with the resume token
const FS_MAX_SENS_POINTS = 60;
const FS_MAX_SENS_OUT = 16;
const FS_MAX_BLOCKS = 400;      // ROUND 14: whole-complex flowsheets (was 150 units / 400 streams)
const FS_MAX_STREAMS = 1000;
const FS_MAX_SPECS = 10;
const FS_MAX_CALCS = 20;
const FS_MAX_ENERGY = 200;      // ROUND 16: energy streams
/* ROUND 16: units that can take their duty or shaft power from an energy stream — the parameter
   written, the specification parameters it replaces, and what is forced so that it is the spec */
const ENERGY_SINKS = {
  heater: { type: 'heat', path: 'duty_kW', drop: ['T_out_K', 'vapour_fraction'] },
  mixer: { type: 'heat', path: 'Q_kW', drop: ['T_out_K'] },                          // classic heater / mixer
  'r-mixer': { type: 'heat', path: 'duty_kW', drop: ['T_out_K'] },
  'r-flash': { type: 'heat', path: 'duty_kW', drop: ['T_K', 'vapour_fraction'] },
  'r-flash3': { type: 'heat', path: 'duty_kW', drop: ['T_K'] },
  compressor: { type: 'work', path: 'power_kW', drop: ['T_out_K'], set: { spec: 'power' } },
};
const WORK_MODULES = new Set(['compressor', 'expander', 'pump', 'rotating', 'extraction-turbine', 'r-compressor-train']);
const energyType = (module) => (WORK_MODULES.has(module) ? 'work' : 'heat');
const VARY_KINDS = ['feed_flow', 'feed_T', 'feed_P', 'param', 'split'];
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
  // ROUND 16: energy streams — checked before the calculators, which may not set what they set
  const energy = [];
  const ens = p.energy_streams === undefined || p.energy_streams === null ? [] : p.energy_streams;
  if (!Array.isArray(ens) || ens.length > FS_MAX_ENERGY) return fail('MB_FS_ENERGY', `params.energy_streams must be an array of ≤ ${FS_MAX_ENERGY}`, 'params.energy_streams');
  const eIds = new Set(), eSinks = new Map();
  for (let i = 0; i < ens.length; i++) {
    const e = ens[i], at = `params.energy_streams[${i}]`;
    if (!isObj(e) || typeof e.id !== 'string' || !e.id) return fail('MB_FS_ENERGY', `${at}.id must be a non-empty string`, at);
    if (eIds.has(e.id)) return fail('MB_FS_ENERGY', `duplicate energy stream id '${e.id}'`, at);
    eIds.add(e.id);
    const nm = typeof e.name === 'string' && e.name ? e.name.slice(0, 40) : e.id;
    const from = e.from === undefined || e.from === null ? null : e.from, to = e.to === undefined || e.to === null ? null : e.to;
    if (from !== null && !B.has(from)) return fail('MB_FS_ENERGY', `energy stream ${nm}: unknown unit '${from}'`, at + '.from');
    if (to !== null && !B.has(to)) return fail('MB_FS_ENERGY', `energy stream ${nm}: unknown unit '${to}'`, at + '.to');
    if (from === null && to === null) return fail('MB_FS_ENERGY', `energy stream ${nm} is connected to no unit`, at);
    if (from !== null && from === to) return fail('MB_FS_ENERGY', `energy stream ${nm} starts and ends on the same unit`, at);
    const bn = (id) => B.get(id).name || id;
    const srcType = from ? energyType(B.get(from).module) : null;
    let sk = null;
    if (to) {
      const blk = B.get(to);
      sk = ENERGY_SINKS[blk.module];
      if (!sk) return fail('MB_FS_ENERGY', `energy stream ${nm}: ${bn(to)} (${blk.module}) cannot take its ${srcType === 'work' ? 'power' : 'duty'} from an energy stream — a heater, mixer, flash drum, three-phase separator (heat) or compressor (shaft work) can`, at + '.to');
      if (eSinks.has(to)) return fail('MB_FS_ENERGY', `${bn(to)} already takes its ${sk.type === 'work' ? 'power' : 'duty'} from energy stream ${eSinks.get(to)}`, at + '.to');
      eSinks.set(to, nm);
      if (srcType && srcType !== sk.type) return fail('MB_FS_ENERGY', `energy stream ${nm} joins ${srcType === 'work' ? 'shaft work' : 'heat'} from ${bn(from)} to ${sk.type === 'work' ? 'the shaft' : 'the duty'} of ${bn(to)} — heat goes to heat, work to work`, at);
    }
    if (!from && !num(e.kW)) return fail('MB_FS_ENERGY', `energy stream ${nm}: give its energy (kW) — it has no source unit`, at + '.kW');
    if (!from && sk.type === 'work' && !(e.kW > 0)) return fail('MB_FS_ENERGY', `energy stream ${nm}: the shaft power given to ${bn(to)} must be above 0 kW`, at + '.kW');
    const eff = e.efficiency === undefined || e.efficiency === null ? 1 : e.efficiency;
    if (!num(eff) || !(eff > 0) || eff > 1) return fail('MB_FS_ENERGY', `energy stream ${nm}: efficiency must be in (0, 1]`, at + '.efficiency');
    if (to) {
      const k = 'param|' + to + '|' + sk.path;
      if (specs.some((sp) => isObj(sp.vary) && sp.vary.kind === 'param' && sp.vary.block === to && sp.vary.path === sk.path)) return fail('MB_FS_ENERGY', `energy stream ${nm} sets the ${sk.path} of ${bn(to)}, which a design spec varies`, at);
      if (isObj(p.sensitivity) && isObj(p.sensitivity.vary) && p.sensitivity.vary.kind === 'param' && p.sensitivity.vary.block === to && p.sensitivity.vary.path === sk.path) return fail('MB_FS_ENERGY', `energy stream ${nm} sets the quantity the sensitivity study varies`, at);
      // the receiving unit runs on the duty / power: other specifications removed, a starting value kept for feedback passes
      const blk = B.get(to), prm = JSON.parse(JSON.stringify(blk.params || {}));
      for (const d of sk.drop) delete prm[d];
      Object.assign(prm, sk.set || {});
      if (!from) prm[sk.path] = e.kW * eff;
      else if (!num(prm[sk.path]) || (sk.type === 'work' && !(Math.abs(prm[sk.path]) > 0))) prm[sk.path] = sk.type === 'work' ? 1 : 0;
      B.set(to, Object.assign({}, blk, { params: prm }));
      energy.push({ id: e.id, name: nm, type: sk.type, from, to, kW: num(e.kW) ? e.kW : null, eff, path: sk.path, key: k });
    } else energy.push({ id: e.id, name: nm, type: srcType, from, to: null, kW: null, eff, path: null, key: null });
  }
  const blocksV = energy.some((e) => e.to) ? blocks.map((b) => B.get(b.id)) : blocks;     // receiving units with their duty specification (input left untouched)
  // STEP 34: calculator blocks — imports (stream / unit results, or inputs), code, exports (inputs)
  const calcs = [];
  const cl = p.calculators === undefined ? [] : p.calculators;
  if (!Array.isArray(cl) || cl.length > FS_MAX_CALCS) return fail('MB_FS_CALC', `params.calculators must be an array of ≤ ${FS_MAX_CALCS}`, 'params.calculators');
  const varyKey = (v) => (v.kind === 'param' ? 'param|' + v.block + '|' + v.path : v.kind === 'split' ? 'split|' + v.block + '|' + v.outlet : v.kind + '|' + v.stream);
  const checkVary = (v, at) => {
    if (!isObj(v) || !VARY_KINDS.includes(v.kind)) return `${at}.kind must be ${VARY_KINDS.join(' | ')}`;
    if (v.kind.startsWith('feed_')) { const fs = S.get(v.stream); if (!fs || fs.from) return `${at}.stream must be a feed stream id`; }
    else if (v.kind === 'param') { if (!B.has(v.block) || typeof v.path !== 'string' || !v.path || /(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(v.path)) return `${at} needs block and path`; }
    else { const blk = B.get(v.block); if (!blk || (blk.module !== 'splitter' && blk.module !== 'r-splitter') || !Number.isInteger(v.outlet) || v.outlet < 0 || v.outlet >= blk.n_out) return `${at} needs a splitter block and outlet index`; }
    return null;
  };
  const exported = new Map();
  for (const e of energy) if (e.key) exported.set(e.key, 'energy stream ' + e.name);
  for (let i = 0; i < cl.length; i++) {
    const c = cl[i], at = `params.calculators[${i}]`;
    if (!isObj(c) || typeof c.code !== 'string') return fail('MB_FS_CALC', `${at} needs code`, at);
    if (c.active === false) continue;
    const id = typeof c.id === 'string' && c.id ? c.id : 'calc' + (i + 1);
    const nm = typeof c.name === 'string' && c.name ? c.name : id;
    const imps = c.imports === undefined ? [] : c.imports, exps = c.exports === undefined ? [] : c.exports;
    if (!Array.isArray(imps) || imps.length > 40 || !Array.isArray(exps) || exps.length > 20) return fail('MB_FS_CALC', `${at}: imports (≤ 40) and exports (≤ 20) must be arrays`, at);
    let prog;
    try { prog = calc.compile(c.code); } catch (e) { return fail('MB_FS_CALC', `calculator ${nm}: ${e.message}`, at + '.code'); }
    const ident = (n) => typeof n === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !calc.RESERVED.has(n);
    const names = new Set();
    for (let j = 0; j < imps.length; j++) {
      const t = imps[j], aj = `${at}.imports[${j}]`;
      if (!isObj(t) || !ident(t.name)) return fail('MB_FS_CALC', `${aj}.name must be a variable name (letters, digits, _; not a function name)`, aj);
      if (names.has(t.name)) return fail('MB_FS_CALC', `calculator ${nm}: '${t.name}' is imported twice`, aj);
      names.add(t.name);
      if (t.kind !== undefined) { const m = checkVary(t, aj); if (m) return fail('MB_FS_CALC', m, aj); }
      else if (t.stream !== undefined) { if (!S.has(t.stream) || typeof t.metric !== 'string') return fail('MB_FS_CALC', `${aj}: unknown stream or no metric`, aj); }
      else if (!B.has(t.block) || typeof t.metric !== 'string') return fail('MB_FS_CALC', `${aj} needs a stream or block result (metric), or an input (kind)`, aj);
    }
    const undef = calc.undefinedRefs(prog, names);
    if (undef.length) return fail('MB_FS_CALC', `calculator ${nm}, line ${undef[0].line}: '${undef[0].name}' is neither imported nor assigned on an earlier line`, at + '.code');
    const assigned = new Set(prog.statements.map((q) => q.name));
    for (let j = 0; j < exps.length; j++) {
      const v = exps[j], aj = `${at}.exports[${j}]`;
      if (!isObj(v) || !ident(v.name)) return fail('MB_FS_CALC', `${aj}.name must be a variable name`, aj);
      if (!assigned.has(v.name) && !names.has(v.name)) return fail('MB_FS_CALC', `calculator ${nm}: export '${v.name}' is never assigned`, aj);
      const m = checkVary(v, aj); if (m) return fail('MB_FS_CALC', m, aj);
      const k = varyKey(v);
      if (exported.has(k)) return fail('MB_FS_CALC', `calculator ${nm}: ${k.replace(/\|/g, ' ')} is already set by ${/^energy stream /.test(exported.get(k)) ? '' : 'calculator '}${exported.get(k)}`, aj);
      exported.set(k, nm);
      if (specs.some((sp) => isObj(sp.vary) && varyKey(sp.vary) === k)) return fail('MB_FS_CALC', `calculator ${nm} sets the quantity a design spec varies (${k.replace(/\|/g, ' ')})`, aj);
      if (isObj(p.sensitivity) && isObj(p.sensitivity.vary) && varyKey(p.sensitivity.vary) === k) return fail('MB_FS_CALC', `calculator ${nm} sets the quantity the sensitivity study varies`, aj);
    }
    calcs.push({ id, name: nm, prog, imports: imps, exports: exps, order: i });
  }
  // ROUND 16: a linked energy stream runs as a calculator: receiving unit's duty = −(source duty) × efficiency
  energy.forEach((e, i) => {
    if (!e.from || !e.to) return;
    calcs.push({ id: 'energy:' + e.id, name: 'energy stream ' + e.name, energy: e.id, order: 1000 + i,
      prog: calc.compile('energy = -source * ' + String(e.eff)),
      imports: [{ name: 'source', block: e.from, metric: e.type === 'work' ? 'W_kW' : 'Q_kW' }],
      exports: [{ name: 'energy', kind: 'param', block: e.to, path: e.path }] });
  });
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
      if (t.economics !== undefined) continue;            // checked once params.economics is read
      if (t.stream !== undefined) { if (!S.has(t.stream)) return fail('MB_FS_SENS', `${at}: unknown output stream '${t.stream}'`, at); }
      else if (!B.has(t.block)) return fail('MB_FS_SENS', `${at}: output needs a stream or a block`, at);
    }
    sens = { vary: v, values, outputs: outs };
  }
  // STEP 36: economics settings and optimisation problem
  let econSet = null;
  if (p.economics !== undefined && p.economics !== null) {
    const m = econ.validateSettings(p.economics);
    if (m) return fail('MB_FS_ECON', m, 'params.economics');
    for (const id of Object.keys(p.economics.units || {})) if (!B.has(id)) return fail('MB_FS_ECON', `params.economics.units: unknown block '${id}'`, 'params.economics.units');
    econSet = p.economics;
  }
  const checkTarget = (t, at) => {
    if (!isObj(t)) return `${at} must be an object`;
    if (t.economics !== undefined) {
      if (!ECON_METRICS.includes(t.economics)) return `${at}.economics must be one of ${ECON_METRICS.join(', ')}`;
      if (!econSet) return `${at}: an economics target needs params.economics`;
      return null;
    }
    if (t.stream !== undefined) return S.has(t.stream) ? null : `${at}.stream unknown`;
    return B.has(t.block) ? null : `${at} needs a stream, a block or an economics total`;
  };
  let opt = null;
  if (p.optimization !== undefined && p.optimization !== null && !(isObj(p.optimization) && p.optimization.active === false)) {
    const q = p.optimization, at = 'params.optimization';
    if (!isObj(q)) return fail('MB_FS_OPT', `${at} must be an object`, at);
    const sense = q.sense === undefined ? 'min' : q.sense;
    if (sense !== 'min' && sense !== 'max') return fail('MB_FS_OPT', `${at}.sense must be 'min' or 'max'`, at);
    const obj = Array.isArray(q.objective) ? q.objective : isObj(q.objective) ? [{ target: q.objective, coef: 1 }] : null;
    if (!obj || !obj.length || obj.length > 8) return fail('MB_FS_OPT', `${at}.objective must be a target or 1–8 terms {target, coef}`, at);
    for (let i = 0; i < obj.length; i++) {
      const t = obj[i], aj = `${at}.objective[${i}]`;
      if (!isObj(t) || (t.coef !== undefined && !num(t.coef))) return fail('MB_FS_OPT', `${aj} must be {target, coef}`, aj);
      const m = checkTarget(t.target, aj + '.target'); if (m) return fail('MB_FS_OPT', m, aj);
    }
    const vars = q.variables;
    if (!Array.isArray(vars) || !vars.length || vars.length > FS_MAX_OPT_VARS) return fail('MB_FS_OPT', `${at}.variables must list 1–${FS_MAX_OPT_VARS} decision variables`, at);
    const vkeys = new Set();
    for (let i = 0; i < vars.length; i++) {
      const v = vars[i], aj = `${at}.variables[${i}]`;
      const m = checkVary(isObj(v) ? v.vary : null, aj + '.vary'); if (m) return fail('MB_FS_OPT', m, aj);
      if (!num(v.lo) || !num(v.hi) || !(v.lo < v.hi)) return fail('MB_FS_OPT', `${aj} needs bounds lo < hi`, aj);
      const k = varyKey(v.vary);
      if (vkeys.has(k)) return fail('MB_FS_OPT', `${aj}: ${k.replace(/\|/g, ' ')} is varied twice`, aj);
      vkeys.add(k);
      if (specs.some((sp) => isObj(sp.vary) && varyKey(sp.vary) === k)) return fail('MB_FS_OPT', `${aj}: a design spec already varies ${k.replace(/\|/g, ' ')}`, aj);
      if (exported.has(k)) return fail('MB_FS_OPT', `${aj}: ${/^energy stream /.test(exported.get(k)) ? '' : 'calculator '}${exported.get(k)} sets ${k.replace(/\|/g, ' ')}`, aj);
    }
    const cons = q.constraints === undefined ? [] : q.constraints;
    if (!Array.isArray(cons) || cons.length > FS_MAX_OPT_CONS) return fail('MB_FS_OPT', `${at}.constraints must be an array of ≤ ${FS_MAX_OPT_CONS}`, at);
    for (let i = 0; i < cons.length; i++) {
      const c = cons[i], aj = `${at}.constraints[${i}]`;
      if (!isObj(c) || !['le', 'ge'].includes(c.op) || !num(c.value)) return fail('MB_FS_OPT', `${aj} needs op ('le' | 'ge'), value and target`, aj);
      const m = checkTarget(c.target, aj + '.target'); if (m) return fail('MB_FS_OPT', m, aj);
    }
    const mx = q.max_evaluations === undefined ? 60 : q.max_evaluations;
    if (!Number.isInteger(mx) || mx < 5 || mx > FS_MAX_OPT_EVALS) return fail('MB_FS_OPT', `${at}.max_evaluations must be 5–${FS_MAX_OPT_EVALS}`, at);
    const xtol = q.xtol === undefined ? 0.005 : q.xtol;
    if (!num(xtol) || xtol < 1e-6 || xtol > 0.2) return fail('MB_FS_OPT', `${at}.xtol must be 1e-6–0.2 (fraction of each variable's range)`, at);
    opt = { sense, objective: obj.map((t) => ({ target: t.target, coef: num(t.coef) ? t.coef : 1 })), variables: vars.map((v) => ({ vary: v.vary, lo: v.lo, hi: v.hi })),
      constraints: cons.map((c) => ({ target: c.target, op: c.op, value: c.value, name: typeof c.name === 'string' ? c.name.slice(0, 40) : undefined })),
      max_evaluations: mx, xtol, penalty: num(q.penalty) && q.penalty > 0 ? q.penalty : 1000 };
  }
  if (sens) for (const t of sens.outputs) if (t.economics !== undefined) { const m = checkTarget(t, 'params.sensitivity.outputs'); if (m) return fail('MB_FS_SENS', m, 'params.sensitivity'); }
  const o = Object.assign({}, FS_DEF, isObj(p.options) ? p.options : {});
  for (const k of Object.keys(FS_DEF)) if (!num(o[k]) || o[k] <= 0) o[k] = FS_DEF[k];
  o.budget_ms = Math.min(o.budget_ms, 50000);                // ROUND 14: vercel.json gives this function 60 s (default stays 7.5 s; the page asks for 25 s) — larger flowsheets continue over further calls
  o.accelerator = (isObj(p.options) && p.options.accelerator === 'wegstein') ? 'wegstein' : 'broyden';
  o.max_iter = Math.min(Math.round(o.max_iter), 500);
  o.spec_max_iter = Math.min(Math.round(o.spec_max_iter), 60);
  o.calc_max_iter = Math.min(Math.max(Math.round(num(o.calc_max_iter) ? o.calc_max_iter : 30), 1), 100);
  return { blocks: blocksV, streams, B, S, specs, opts: o, feeds: input.streams, pkg, sens, calcs, opt, econ: econSet, energy };
}

// ---------------------------------------------------------------------------
// calculation order — Tarjan SCCs + DFS back-edge tears inside each loop
// ---------------------------------------------------------------------------
/**
 * STEP 34: where each calculator runs. A feed-forward calculator (nothing it sets feeds back into
 * what it reads) becomes a node of the calculation order: after the units it reads, before the
 * units it sets. A calculator inside a recycle of its own making (it reads a result its exports
 * change) is a feedback calculator: converged by substitution around the whole solve.
 */
function calcLinks(M, c) {
  const src = new Set(), dst = new Set();
  for (const t of c.imports) {
    if (t.kind !== undefined) continue;                                     // an input: known before the solve
    if (t.stream !== undefined) { const s = M.S.get(t.stream); if (s && s.from) src.add(s.from.b); }
    else src.add(t.block);
  }
  for (const v of c.exports) {
    if (v.kind.startsWith('feed_')) { const s = M.S.get(v.stream); if (s && s.to) dst.add(s.to.b); }
    else dst.add(v.block);
  }
  return { src: [...src], dst: [...dst] };
}
function planCalcs(M, calcs) {
  const ids = M.blocks.map((b) => b.id);
  const adj = new Map(ids.map((i) => [i, []]));
  for (const s of M.streams) if (s.from && s.to) adj.get(s.from.b).push(s.to.b);
  const down = (b0) => { const seen = new Set([b0]), q = [b0]; while (q.length) { for (const w of adj.get(q.shift())) if (!seen.has(w)) { seen.add(w); q.push(w); } } return seen; };
  const ff = [], fb = [];
  for (const c of calcs) {
    const L = calcLinks(M, c);
    c.links = L;
    const loops = L.dst.some((d) => { const D = down(d); return L.src.some((s0) => D.has(s0)); });
    (loops ? fb : ff).push(c);
  }
  // feed-forward calculators chained into a cycle through one another are feedback too
  for (;;) {
    const plan = buildPlan(M, ff);
    const bad = plan.find((st) => st.loop && st.calcIn);
    if (!bad) return { plan, ff, fb };
    for (const id of bad.calcIn) { const k = ff.findIndex((c) => c.id === id); if (k >= 0) fb.push(ff.splice(k, 1)[0]); }
  }
}

function buildPlan(M, ffCalcs) {
  const CN = (c) => '\u00a7' + c.id;                                       // calculator node id
  const cmap = new Map((ffCalcs || []).map((c) => [CN(c), c]));
  const ids = M.blocks.map((b) => b.id).concat([...cmap.keys()]);
  const adj = new Map(ids.map((i) => [i, []]));
  for (const s of M.streams) if (s.from && s.to) adj.get(s.from.b).push({ to: s.to.b, sid: s.id });
  for (const [n, c] of cmap) {
    for (const b of c.links.src) adj.get(b).push({ to: n, sid: null });
    for (const b of c.links.dst) adj.get(n).push({ to: b, sid: null });
  }
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
    if (c.length === 1 && cmap.has(c[0])) { plan.push({ calc: cmap.get(c[0]).id, blocks: [], loop: false, tears: [] }); continue; }
    if (c.length === 1 && !self) { plan.push({ blocks: c, loop: false, tears: [] }); continue; }
    if (c.some((v) => cmap.has(v))) { plan.push({ loop: true, calcIn: c.filter((v) => cmap.has(v)).map((v) => cmap.get(v).id), blocks: [], tears: [] }); continue; }
    const set = new Set(c);
    const ordered = ids.filter((id) => set.has(id));
    const ext = (bid) => M.streams.some((s) => s.to && s.to.b === bid && (!s.from || !set.has(s.from.b)));
    const start = ordered.find(ext) || ordered[0];
    const dfsTears = [], state = new Map(), rank = new Map();
    const dfs = (v) => {
      state.set(v, 1); rank.set(v, rank.size);
      for (const e of adj.get(v)) {
        if (!set.has(e.to)) continue;
        const sv = state.get(e.to);
        if (!sv) dfs(e.to); else if (sv === 1) dfsTears.push(e.sid);
      }
      state.set(v, 2);
    };
    dfs(start);
    for (const v of ordered) if (!state.get(v)) dfs(v);
    // STEP 30: the fewest torn streams that break every cycle of the loop (user estimates
    // preferred — when the streams given estimates break every cycle, those are torn); the
    // depth-first back edges remain the fallback for very large loops
    const tears = minTears(M, set, ordered, adj, rank) || dfsTears;
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

/**
 * Minimum tear set of one strongly connected block set: elementary cycles are listed
 * (capped), then the smallest set of streams meeting every cycle is found by iterative
 * deepening. Among sets of that size: most streams carrying a user estimate, then streams
 * entering blocks reached earliest from the loop's fresh feed. When the estimated streams
 * alone break every cycle, the tears are taken from them. Returns null when the loop is too
 * large to enumerate (the caller keeps the depth-first tears).
 */
function minTears(M, set, ordered, adj, rank) {
  const vid = new Map(ordered.map((v, i) => [v, i]));
  const cycles = [];
  let steps = 0;
  const CMAX = 2000, SMAX = 200000;
  for (let s0 = 0; s0 < ordered.length; s0++) {
    const path = [], onPath = new Set([s0]);
    const walk = (v) => {
      if (cycles.length > CMAX || ++steps > SMAX) return;
      for (const e of adj.get(ordered[v])) {
        if (!set.has(e.to)) continue;
        const w = vid.get(e.to);
        if (w < s0) continue;
        if (w === s0) { cycles.push(path.concat([e.sid])); continue; }
        if (onPath.has(w)) continue;
        onPath.add(w); path.push(e.sid);
        walk(w);
        path.pop(); onPath.delete(w);
      }
    };
    walk(s0);
  }
  if (!cycles.length || cycles.length > CMAX || steps > SMAX) return null;
  const est = new Set(M.streams.filter((st) => isObj(st.estimate) && num(st.estimate.mass_flow_kg_h) && Array.isArray(st.estimate.components) && st.estimate.components.length).map((st) => st.id));
  const toB = new Map(M.streams.map((st) => [st.id, st.to && st.to.b]));
  const cycSets = cycles.map((c) => new Set(c));
  const solve = (allowed) => {
    for (let k = 1; k <= 6; k++) {
      const found = [];
      let nodes = 0;
      const rec = (chosen, depth) => {
        if (found.length > 4000 || ++nodes > 100000) return;
        let pick = null;
        for (const cs of cycSets) if (![...chosen].some((sid) => cs.has(sid))) { if (!pick || cs.size < pick.size) pick = cs; }
        if (!pick) { found.push([...chosen]); return; }
        if (depth === 0) return;
        for (const sid of pick) {
          if (!allowed(sid) || chosen.has(sid)) continue;
          chosen.add(sid); rec(chosen, depth - 1); chosen.delete(sid);
        }
      };
      rec(new Set(), k);
      if (found.length) {
        const key = (t) => [-t.filter((sid) => est.has(sid)).length, t.reduce((a, sid) => a + (rank.get(toB.get(sid)) || 0), 0), t.slice().sort().join()];
        const uniq = [...new Map(found.map((t) => [t.slice().sort().join(), t])).values()];
        uniq.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0); });
        const best = uniq[0];
        return M.streams.filter((st) => best.includes(st.id)).map((st) => st.id);     // stream-list order
      }
      if (nodes > 100000) return null;
    }
    return null;
  };
  const estIn = cycles.every((c) => c.some((sid) => est.has(sid)));
  return (estIn && solve((sid) => est.has(sid))) || solve(() => true);
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
  if (s.rig && typeof s.rig.sig === 'string') o.rig = { sig: s.rig.sig, h_Jmol: s.rig.h_Jmol, beta: s.rig.beta, phase: s.rig.phase };
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
const cpO = (o) => ({ m: Object.assign({}, o.m), T: o.T, P: o.P });
/**
 * One Broyden step on the torn streams (fixed point x = G(x), F = G − x). Variables are
 * scaled: component flows by the stream's total flow, T and P by their own values, so
 * the convergence test (relErr) and the update see the same magnitudes. Returns the next
 * iterate, or null when Wegstein should take this step.
 */
function broydenStep(st, x, g) {
  const keys = x.map((xk, k) => keysOf(xk, g[k]).sort());
  const same = st.keys && st.keys.length === keys.length && keys.every((ks, k) => ks.join('\u0001') === st.keys[k].join('\u0001'));
  if (!same || !st.H) {
    st.keys = keys;
    st.sc = g.map((gk) => ({ F: Math.max(Object.values(gk.m).reduce((a, b) => a + b, 0), 1e-9), T: Math.max(gk.T, 1), P: Math.max(gk.P, 1e-6) }));
    st.H = null; st.u0 = null; st.F0 = null;
  }
  const pack = (arr) => {
    const v = [];
    arr.forEach((o, k) => { for (const c of st.keys[k]) v.push((o.m[c] || 0) / st.sc[k].F); v.push(o.T / st.sc[k].T, o.P / st.sc[k].P); });
    return v;
  };
  const u = pack(x), Fv = pack(g).map((gv, i) => gv - u[i]);
  const n = u.length;
  if (!st.H) { st.H = Array.from({ length: n }, (_, i) => { const r = new Array(n).fill(0); r[i] = -1; return r; }); }
  else if (st.u0) {
    // good Broyden: H ← H + (Δu − H ΔF) (Δuᵀ H) / (Δuᵀ H ΔF)
    const du = u.map((v, i) => v - st.u0[i]), dF = Fv.map((v, i) => v - st.F0[i]);
    const HdF = st.H.map((row) => row.reduce((a, h, j) => a + h * dF[j], 0));
    const duH = new Array(n).fill(0);
    for (let i = 0; i < n; i++) if (du[i]) for (let j = 0; j < n; j++) duH[j] += du[i] * st.H[i][j];
    const den = du.reduce((a, v, i) => a + v * HdF[i], 0);
    const dun = Math.sqrt(du.reduce((a, v) => a + v * v, 0)), hn = Math.sqrt(HdF.reduce((a, v) => a + v * v, 0));
    if (Math.abs(den) > 1e-12 * dun * hn && isFinite(den)) {
      for (let i = 0; i < n; i++) { const a = (du[i] - HdF[i]) / den; if (a) for (let j = 0; j < n; j++) st.H[i][j] += a * duH[j]; }
    }
  }
  const s = st.H.map((row) => -row.reduce((a, h, j) => a + h * Fv[j], 0));
  if (!s.every(num)) { st.H = null; return null; }
  // step control: flows stay ≥ 0 (a component may fall at most 90 %), T and P change ≤ 20 %
  let lam = 1;
  for (let i = 0; i < n; i++) if (s[i] < 0 && u[i] > 0 && -s[i] * lam > 0.9 * u[i] + 1e-12) lam = Math.min(lam, (0.9 * u[i] + 1e-12) / -s[i]);
  let off = 0;
  x.forEach((_, k) => { off += st.keys[k].length; for (const q of [off, off + 1]) if (Math.abs(s[q]) * lam > 0.2 * u[q]) lam = Math.min(lam, 0.2 * u[q] / Math.abs(s[q])); off += 2; });
  // and the step is at most 50 × the substitution step (a near-singular update would jump far)
  const sMax = Math.max(...s.map(Math.abs)), fMax = Math.max(...Fv.map(Math.abs));
  if (sMax * lam > 50 * fMax && sMax > 0) lam = 50 * fMax / sMax;
  lam = Math.max(lam, 0.02);
  st.u0 = u; st.F0 = Fv;
  const un = u.map((v, i) => v + lam * s[i]);
  off = 0;
  return x.map((_, k) => {
    const o = { m: {}, T: 0, P: 0 }, sc = st.sc[k];
    for (const c of st.keys[k]) { o.m[c] = Math.max(0, un[off]) * sc.F; off++; }
    o.T = Math.max(1, un[off] * sc.T); o.P = Math.max(1e-6, un[off + 1] * sc.P); off += 2;
    return o;
  });
}
// STEP 30 per-request warm context: block-result cache, column profiles, last tear values
const NO_CACHE = new Set(['r-pfr', 'r-cstr']);
const CACHE_MAX = 600;            // entries (FIFO) — a few MB at most
// ROUND 14: converged unit solves are also kept between calls on the same server instance (LRU, copies in and out),
// so a flowsheet too large for one call re-runs its finished part from here in the next call instead of solving it again.
// The key holds the unit id, its inlet streams and every parameter, property package included — a hit is the same calculation.
const SHARED = new Map(), SHARED_MAX = 1500;
const sharedGet = (k) => { const v = SHARED.get(k); if (v === undefined) return undefined; SHARED.delete(k); SHARED.set(k, v); return structuredClone(v); };
const sharedSet = (k, v) => { if (SHARED.size >= SHARED_MAX) SHARED.delete(SHARED.keys().next().value); SHARED.set(k, structuredClone(v)); };
function newWarm() { return { cache: new Map(), col: {}, tear: {}, bro: {}, hits: 0, warmCols: 0, specX: null, solves: 0, loopTot: {}, firstHist: {}, evals: 0, hist: null, histBase: null }; }
// STEP 35: convergence history of a recycle loop — one entry per pass, kept to HIST_MAX entries
// (the first HIST_HEAD and the latest ones) so a long run stays small in the reply and the token
const HIST_MAX = 250, HIST_HEAD = 25;
const HIST_CODES = { g: 'guess', e: 'estimate', w: 'warm', c: 'continued', s: 'substitution', W: 'wegstein', b: 'broyden', r: 'retreat' };
const HIST_LETTER = Object.fromEntries(Object.entries(HIST_CODES).map(([k, v]) => [v, k]));
const p4 = (v) => (num(v) ? Number(v.toPrecision(4)) : null);
const p7 = (v) => (num(v) ? Number(v.toPrecision(7)) : null);
function histPush(h, e) {
  h.push(e);
  if (h.length > HIST_MAX) { h.splice(HIST_HEAD, 1); h.trimmed = true; }
}
/** final state of one torn stream: last computed value g against the value x it was computed from */
function tearStatus(M, tid, x, g) {
  const sx = Object.values(x.m).reduce((a, b) => a + b, 0), sg = Object.values(g.m).reduce((a, b) => a + b, 0);
  const tot = Math.max(sx, sg, 1e-12);
  let wk = null, we = 0;
  for (const k of keysOf(x, g)) { const e = Math.abs((g.m[k] || 0) - (x.m[k] || 0)) / tot; if (e > we) { we = e; wk = k; } }
  return { stream: tid, name: sname(M.S.get(tid)), rel_change: p4(relErr(x, g)), flow_kg_h: p4(sg), dflow_rel: p4((sg - sx) / tot),
    T_K: p4(g.T), dT_K: p4(g.T - x.T), P_bar: p4(g.P), dP_bar: p4(g.P - x.P), worst_component: wk, worst_rel: p4(we) };
}

// ---------------------------------------------------------------------------
// STEP 30 resumable solves: when the time budget runs out, the response carries a
// continuation token (torn-stream values, column profiles, design-spec point, finished
// sensitivity rows); the client posts the same flowsheet again with params.resume and the
// solve picks up from there. The token only seeds starting values — it is checked
// against a signature of the flowsheet and every number in it is validated.
// ---------------------------------------------------------------------------
const RESUME_V = 1;
function sigOf(input) {
  const p = Object.assign({}, input.params || {});
  delete p.resume;
  if (isObj(p.options)) { p.options = Object.assign({}, p.options); delete p.options.budget_ms; }
  const t = JSON.stringify({ s: input.streams, p });
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16) + ':' + t.length;
}
const okTear = (o) => isObj(o) && isObj(o.m) && num(o.T) && o.T > 0 && num(o.P) && o.P > 0 && Object.keys(o.m).length <= 80
  && Object.values(o.m).every((v) => num(v) && v >= 0);
const okCol = (c) => isObj(c) && Number.isInteger(c.N) && c.N > 0 && c.N <= 200 && Array.isArray(c.keys) && c.keys.length <= 80
  && c.keys.every((k) => typeof k === 'string') && Array.isArray(c.X) && c.X.length === c.N && Array.isArray(c.g) && c.g.length <= 4
  && Array.isArray(c.border) && c.border.length === c.g.length && num(c.Ftot)
  && c.X.every((r) => Array.isArray(r) && r.length === 2 * c.keys.length + 1 && r.every(num)) && c.g.every(num);
/** validated resume state, or null (a stale or foreign token is ignored, never an error) */
function readResume(input, plan, M, V) {
  const r = input.params && input.params.resume;
  if (!isObj(r) || r.v !== RESUME_V || r.sig !== sigOf(input)) return null;
  const out = { tear: {}, col: {}, x: null, rows: [], phase: r.phase === 'sens' ? 'sens' : r.phase === 'opt' ? 'opt' : 'main', calls: 0, solves: 0, ms: 0 };
  // STEP 36: optimisation points already evaluated (replayed, not re-solved)
  if (V.opt && Array.isArray(r.opt) && r.opt.length <= FS_MAX_OPT_EVALS + 2) {
    const n = V.opt.variables.length, nc = V.opt.constraints.length;
    const ok = r.opt.every((q) => isObj(q) && Array.isArray(q.x) && q.x.length === n && q.x.every(num) &&
      (q.obj === null ? typeof q.err === 'string' : num(q.obj) && Array.isArray(q.g) && q.g.length === nc && q.g.every(num)));
    if (ok) out.opt = r.opt.map((q) => ({ x: q.x.slice(), obj: q.obj, g: q.g ? q.g.slice() : null, err: q.err ? String(q.err).slice(0, 200) : undefined, conv: q.conv !== false }));
  }
  if (isObj(r.tears)) for (const k of Object.keys(r.tears)) {
    const i = Number(k), a = r.tears[k];
    if (Number.isInteger(i) && plan[i] && plan[i].loop && Array.isArray(a) && a.length === plan[i].tears.length && a.every(okTear)) out.tear[i] = a.map(cpO);
  }
  if (isObj(r.cols)) for (const k of Object.keys(r.cols)) if (M.B.has(k) && M.B.get(k).module === 'column' && okCol(r.cols[k])) out.col[k] = r.cols[k];
  if (Array.isArray(r.x) && r.x.length === V.specs.length && r.x.every(num)) out.x = r.x.slice();
  if (isObj(r.its) && !V.specs.length && out.phase === 'main') {
    out.its = {};
    for (const k of Object.keys(r.its)) { const i = Number(k); if (Number.isInteger(i) && plan[i] && plan[i].loop && Number.isInteger(r.its[k]) && r.its[k] > 0) out.its[i] = Math.min(r.its[k], 500); }
  }
  if (isObj(r.hist) && !V.specs.length && out.phase === 'main') {
    out.hist = {};
    for (const k of Object.keys(r.hist)) {
      const i = Number(k), a = r.hist[k];
      if (!Number.isInteger(i) || !plan[i] || !plan[i].loop || !Array.isArray(a) || a.length > HIST_MAX) continue;
      if (!a.every((e) => Array.isArray(e) && e.length === 3 && Number.isInteger(e[0]) && e[0] > 0 && e[0] <= 500 && (e[1] === null || num(e[1])) && HIST_CODES[e[2]])) continue;
      out.hist[i] = a.map((e) => ({ it: e[0], err: e[1], method: HIST_CODES[e[2]] }));
    }
  }
  if (V.sens && Array.isArray(r.rows) && r.rows.length < V.sens.values.length) {
    out.rows = r.rows.filter((row) => isObj(row) && num(row.value)).slice(0, V.sens.values.length).map((row) => ({
      value: row.value,
      outputs: Array.isArray(row.outputs) ? row.outputs.slice(0, FS_MAX_SENS_OUT).map((v) => (num(v) ? v : null)) : undefined,
      converged: row.converged === true,
      alerts: Array.isArray(row.alerts) ? row.alerts.slice(0, 3).map((a) => String(a).slice(0, 300)) : undefined,
      error: row.error !== undefined ? String(row.error).slice(0, 300) : undefined,
    }));
  }
  for (const k of ['calls', 'solves', 'ms']) if (num(r[k]) && r[k] >= 0) out[k] = Math.min(r[k], 1e9);
  return out;
}
// the token carries at most 120 passes per loop (the first 10 and the latest) to keep the re-posted body small
const packHist = (H) => (H ? Object.fromEntries(Object.entries(H).map(([k, h]) => [k, (h.length > 120 ? h.slice(0, 10).concat(h.slice(-110)) : h).map((e) => [e.it, e.err, HIST_LETTER[e.method] || 's'])])) : null);
function makeResume(input, st) {
  return { v: RESUME_V, sig: sigOf(input), phase: st.phase, tears: st.tears, cols: st.cols, x: st.x || undefined, its: st.its || undefined, hist: st.hist || undefined,
    rows: st.rows && st.rows.length ? st.rows : undefined, opt: st.opt && st.opt.length ? st.opt : undefined, calls: st.calls, solves: st.solves, ms: st.ms };
}
const snapTears = (wc) => Object.fromEntries(Object.entries(wc.tear).map(([k, a]) => [k, a.map(cpO)]));

// ---------------------------------------------------------------------------
// one complete sequential-modular pass (all loops converged)
// ---------------------------------------------------------------------------
function evaluate(M, plan, opts, deadline, logOn, sink, wc) {
  const SV = {}, BR = {}, log = [], warnings = [], loops = [], alerts = [];
  const WMAP = new Map();
  wc = wc || newWarm();
  wc.evals++;
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
    // STEP 30: a block whose inlets and parameters are identical to an earlier solve in this
    // request (blocks outside the loop being iterated, re-evaluations at the same point)
    // reuses that result instead of solving again
    const cacheable = !NO_CACHE.has(b.module);
    const key = bid + '\u0001' + JSON.stringify(ins) + '\u0001' + JSON.stringify(params);
    const ck = cacheable ? key : null;
    let r = ck ? wc.cache.get(ck) : undefined;
    if (r === undefined) { r = sharedGet(key); if (r !== undefined && ck) wc.cache.set(ck, r); }   // ROUND 14: also completed kinetic reactors
    if (r) wc.hits++;
    else {
      // integrating units get what is left of the flowsheet's time budget (Vercel limit)
      const integ = b.module === 'r-pfr' || b.module === 'r-cstr';
      let cut = false;
      if (integ) { const want = num(params.budget_ms) ? params.budget_ms : 5000; params.budget_ms = Math.max(200, Math.min(want, deadline - Date.now())); cut = params.budget_ms < want; }
      // rigorous columns: warm start from this column's last converged profile, and never past the budget
      const isCol = b.module === 'column' || b.module === 'r-urea-stripper';
      if (isCol) {
        params.budget_ms = Math.max(150, deadline - Date.now());
        params.warm_out = true;
        if (wc.col[bid]) { params.warm = wc.col[bid]; wc.warmCols++; }
      }
      r = TB.runModule(b.module, { streams: ins, params });
      solves++; wc.solves++;
      // ROUND 14: a reactor stopped only because the call's time was nearly used up — continue in the next call
      if (integ && cut && r && r.error && /BUDGET/.test(r.error.code || '')) throw new FsError('MB_FS_BUDGET', `flowsheet exceeded the server time budget (in ${label(b)})`, 'params.options');
      if (isCol && r && !r.error) {
        if (r.warm_state) wc.col[bid] = r.warm_state;
        r = Object.assign({}, r);
        delete r.warm_state;
        // a column cut short by the time budget: stop here so the next call continues from its profile
        if (r.converged === false && Date.now() > deadline - 150) throw new FsError('MB_FS_BUDGET', `flowsheet exceeded the server time budget (in ${label(b)})`, 'params.options');
      }
      if (r && !r.error && r.converged !== false) {
        if (ck) {
          if (wc.cache.size >= CACHE_MAX) wc.cache.delete(wc.cache.keys().next().value);
          wc.cache.set(ck, r);
        }
        sharedSet(key, r);
      }
    }
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
    for (const w of r.warnings || []) {
      // the same message from several units (property-method notes) is listed once, naming every unit
      const msg = typeof w === 'string' ? w : (w && w.message) || '';
      const k = WMAP.get(msg);
      if (k === undefined) { WMAP.set(msg, { i: warnings.length, units: [label(b)] }); warnings.push(`${label(b)}: ${msg}`); }
      else if (!k.units.includes(label(b))) { k.units.push(label(b)); warnings[k.i] = `${k.units.join(', ')}: ${msg}`; }
    }
    if (r.converged === false && !quiet) {
      const fu = r.flash_unconverged;
      const m = fu
        ? `${label(b)} (${b.module}): a phase-equilibrium flash did not converge (${(fu.T_K - 273.15).toFixed(1)} °C, ${fu.P_bar.toPrecision(4)} bar) — the phase split there is approximate`
        : `${label(b)} (${b.module}) did not converge — results are the last iterate`;
      if (!alerts.includes(m)) { alerts.push(m); L('w', '⚠ ' + m); }
    }
  };
  const calcRes = {};
  const runCalcStep = (cid) => {
    const c = (M.calcs || []).find((x) => x.id === cid);
    if (!c) return;
    const r = runCalculator(c, M, { SV, BR, pkg: M.pkg || null });
    calcRes[c.id] = r;
    // exported feed values reach the feed streams already set at the start of this pass
    for (const v of c.exports) if (v.kind.startsWith('feed_')) { const fs = M.S.get(v.stream); SV[fs.id] = clean(M.feeds[fs.feed]); }
    L('o', `ƒ calculator ${c.name}: ` + Object.entries(r.exports).map(([k, v]) => `${k} = ${v.toPrecision(7)}`).join(', '));
  };
  for (let si = 0; si < plan.length; si++) {
    const step = plan[si];
    if (step.calc) { runCalcStep(step.calc); continue; }
    if (!step.loop) { solve(step.blocks[0], false); continue; }
    const names = step.blocks.map((id) => label(M.B.get(id))).join(' → ');
    L('h', `⟲ recycle loop ${names} · tear ${step.tears.map((t) => sname(M.S.get(t))).join(', ')}`);
    const rec = { blocks: step.blocks, tears: step.tears, iterations: 0, err: NaN, converged: false };
    loops.push(rec);
    // starting values of the torn streams: the last converged values in this request (warm),
    // else the user's estimates, else a fraction of the loop's largest fresh feed — 1 %, and if
    // the first pass fails with that (e.g. an exchanger temperature cross) 100 %, then 10 %
    const GUESS = [0.01, 1, 0.1];
    let gi = 0;
    const hasEst = (s) => isObj(s.estimate) && num(s.estimate.mass_flow_kg_h) && Array.isArray(s.estimate.components) && s.estimate.components.length;
    const initX = () => step.tears.map((tid) => {
      const s = M.S.get(tid);
      if (hasEst(s)) return sObj(clean(s.estimate));
      let best = null;
      for (const st of M.streams) {
        if (st.to && step.blocks.includes(st.to.b) && (!st.from || !step.blocks.includes(st.from.b))) {
          const v = SV[st.id];
          if (v && (!best || v.mass_flow_kg_h > best.mass_flow_kg_h)) best = v;
        }
      }
      if (!best) throw new FsError('MB_FS_LOOP', `loop ${names} has no fresh feed`, 'params.streams');
      const o = sObj(clean(best));
      for (const k in o.m) o.m[k] *= GUESS[gi];
      return o;
    });
    const warmT = wc.tear[si];
    let warmUsed = !!(warmT && warmT.length === step.tears.length);
    let x = warmUsed ? warmT.map(cpO) : initX();
    const guessed = step.tears.some((tid) => !hasEst(M.S.get(tid)));
    let xp = null, gp = null;
    // STEP 30: after two Wegstein passes the torn streams are converged together by Broyden's
    // quasi-Newton method (inverse-Jacobian update, scaled variables); it falls back to Wegstein
    // whenever a step makes the error grow
    const BR8 = opts.accelerator === 'broyden' ? { H: null, u0: null, F0: null, keys: null, sc: null, best: Infinity, fails: 0 } : null;
    // a continued call (STEP 30) carries on counting the loop's iterations
    const it0 = wc.itBase && num(wc.itBase[si]) ? Math.min(wc.itBase[si], opts.max_iter - 1) : 0;
    if (it0) { rec.iterations = it0; warmUsed = false; }
    // a loop met again in this request (design-spec / sensitivity evaluations) starts from its
    // last converged torn streams AND its Broyden inverse Jacobian, so it goes straight to Broyden
    const bro = wc.bro && wc.bro[si];
    let broFrom = it0 + 3;
    if (BR8 && warmUsed && bro) { BR8.H = bro.H.map((r) => r.slice()); BR8.keys = bro.keys; BR8.sc = bro.sc; broFrom = it0 + 1; }
    let lastG = null, lastX = null, subst = 0, retreats = 0;
    const balHist = [];
    // STEP 35: pass-by-pass record — the error of each pass and how its starting point was made
    const hist = [];
    if (it0 && wc.histBase && Array.isArray(wc.histBase[si])) for (const e of wc.histBase[si]) if (e.it <= it0) histPush(hist, e);
    if (wc.hist) wc.hist[si] = hist;
    let how = it0 ? 'continued' : warmUsed ? 'warm' : guessed ? 'guess' : 'estimate';
    for (let it = it0 + 1; it <= opts.max_iter; it++) {
      if (wc.itDone) wc.itDone[si] = it - 1;
      step.tears.forEach((tid, k) => { SV[tid] = objS(x[k]); });
      try { for (const bid of step.blocks) solve(bid, true); }
      catch (e) {
        // the first pass from guessed starting values failed: start again from other values
        if (it === it0 + 1 && !it0 && e instanceof FsError && e.code !== 'MB_FS_BUDGET' && (warmUsed || (guessed && gi < GUESS.length - 1))) {
          if (warmUsed) warmUsed = false; else gi++;
          x = initX();
          how = guessed ? 'guess' : 'estimate';
          if (BR8) BR8.H = null;
          broFrom = it0 + 3;
          L('w', `   first pass failed (${e.message}) — restarting the loop from ${gi ? `torn streams at ${GUESS[gi] * 100} % of the fresh feed` : guessed ? 'the default starting values' : 'the starting estimates'}`);
          it = it0;
          continue;
        }
        // a pass from an accelerated (extrapolated) iterate failed: go back to the last computed
        // torn-stream values and take plain substitution steps for a while
        if (lastG && retreats < 3 && e instanceof FsError && e.code !== 'MB_FS_BUDGET') {
          retreats++; subst = 3;
          x = lastG.map(cpO); xp = null; gp = null; how = 'retreat';
          if (BR8) { BR8.H = null; BR8.fails++; }
          L('w', `   pass ${it} failed (${e.message}) — back to the last computed values, direct substitution`);
          continue;
        }
        throw e;
      }
      const g = step.tears.map((tid) => sObj(SV[tid]));
      lastG = g.map(cpO);
      if (it - it0 > 4) { balHist.push(loopBalance(M, step, SV, BR)); if (balHist.length > 8) balHist.shift(); }
      const errs = g.map((gk, k) => relErr(x[k], gk));
      const err = Math.max(...errs);
      rec.iterations = it; rec.err = err;
      lastX = x;
      const he = { it, err: p4(err), method: how };
      if (errs.length > 1 && errs.length <= 8) he.tears = errs.map(p4);
      histPush(hist, he);
      L('', `   iteration ${it} · max relative change ${err.toExponential(2)} · ${how}`);
      if (err <= opts.tol) { rec.converged = true; break; }
      let xn = null, nh = null;
      if (subst > 0) { subst--; xn = g.map(cpO); nh = 'retreat'; }
      else if (BR8 && it >= broFrom && BR8.fails < 4) {
        if (err > 2 * BR8.best && BR8.H) { BR8.H = null; BR8.fails++; }          // diverging: restart from substitution
        else { xn = broydenStep(BR8, x, g); if (xn) nh = 'broyden'; }
        BR8.best = Math.min(BR8.best, err);
      }
      if (!xn) { nh = xp ? 'wegstein' : 'substitution'; xn = x.map((xk, k) => wegstein(xk, g[k], xp && xp[k], gp && gp[k])); }
      how = nh;
      xp = x; gp = g; x = xn;
      wc.tear[si] = x.map(cpO);
    }
    wc.tear[si] = x.map(cpO);
    rec.accelerator = opts.accelerator;
    rec.history = hist;
    if (hist.trimmed) rec.history_trimmed = true;
    if (lastX && lastG) rec.tear_status = step.tears.map((tid, k) => tearStatus(M, tid, lastX[k], lastG[k]));
    wc.loopTot[si] = (wc.loopTot[si] || 0) + (rec.iterations - it0);
    if (!wc.firstHist[si]) wc.firstHist[si] = hist;
    if (BR8 && wc.bro) { if (rec.converged && BR8.H && BR8.fails === 0) wc.bro[si] = { H: BR8.H, keys: BR8.keys, sc: BR8.sc }; else delete wc.bro[si]; }
    if (rec.converged) L('o', `✓ loop converged in ${rec.iterations} iterations (error ${rec.err.toExponential(2)})`);
    else {
      const m = `recycle loop ${names} did not converge in ${rec.iterations} iterations (error ${rec.err.toExponential(2)}) — last iterate returned`;
      L('w', '⚠ ' + m); warnings.push(m); alerts.push(m);
      const hint = loopImbalance(M, step, balHist);
      if (hint) { L('w', '   ' + hint); warnings.push(hint); }
    }
  }
  return { SV, BR, log, warnings, loops, solves, alerts, pkg: M.pkg || null, calcs: calcRes };
}

/**
 * Why a loop may have no steady state: a component entering the loop (fresh feeds and
 * make-up) faster or slower than it leaves (products, purges, vents) builds up or runs down
 * on every pass — a closed solvent loop with a fixed make-up is the usual case. Checked on
 * loops without reactors only. Returns a sentence or null.
 */
const REACTING = /react|gibbs|pfr|cstr|smr|atr|shift|methanat|urea|equil|conversion|kinetic|burner|combust/;
/** component in − out (kg/h) across the loop boundary for the current pass, and the largest internal flow */
function loopBalance(M, step, SV, BR) {
  const inL = new Set(step.blocks);
  const acc = {}, add = (s, sg) => { if (!s) return; for (const c of s.components || []) acc[c.key] = (acc[c.key] || 0) + sg * c.mass_fraction * s.mass_flow_kg_h; };
  let loopF = 0;
  for (const s of M.streams) {
    const toIn = s.to && inL.has(s.to.b), fromIn = s.from && inL.has(s.from.b);
    if (toIn && !fromIn) add(SV[s.id], 1);
    else if (fromIn && !toIn) add(SV[s.id], -1);
    else if (toIn && fromIn && SV[s.id]) loopF = Math.max(loopF, SV[s.id].mass_flow_kg_h);
  }
  for (const bid of step.blocks) {
    const b = M.B.get(bid), br = BR[bid];
    if (!br) continue;
    for (let j = 0; j < b.n_out; j++) if (!M.streams.some((s) => s.from && s.from.b === bid && s.from.p === j)) add((br.result.streams_out || [])[j], -1);
  }
  return { acc, loopF };
}
/**
 * Why a loop may have no steady state: a component that enters the loop (fresh feed, make-up)
 * faster or slower than it leaves (products, vents, purges) builds up or runs down on every
 * pass, and the imbalance does not shrink as the loop iterates — a closed solvent loop with a
 * fixed make-up is the usual case. Judged from the last eight passes, loops without reactors
 * only. Returns a sentence or null.
 */
function loopImbalance(M, step, hist) {
  if (step.blocks.some((bid) => REACTING.test(M.B.get(bid).module)) || hist.length < 8) return null;
  const H = hist.slice(-8), loopF = Math.max(...H.map((h) => h.loopF));
  if (!(loopF > 0)) return null;
  let worst = null;
  for (const k of Object.keys(H[H.length - 1].acc)) {
    const v = H.map((h) => h.acc[k] || 0);
    const last = v[v.length - 1];
    const steady = v.every((y) => Math.sign(y) === Math.sign(last) && Math.abs(y) > 2e-4 * loopF) && Math.abs(last) > 0.5 * Math.abs(v[0]);
    if (steady && (!worst || Math.abs(last) > Math.abs(worst[1]))) worst = [k, last];
  }
  if (!worst) return null;
  const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
  return `${worst[0]} ${worst[1] > 0 ? 'builds up in' : 'drains from'} this loop by about ${f(Math.abs(worst[1]))} kg/h on every pass and the imbalance is not shrinking — ` +
    'the loop has no steady state with these inputs: a closed loop only settles when every component that enters also leaves (let a design spec set the make-up flow, or add a purge)';
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
// ---------------------------------------------------------------------------
// STEP 36 — economics of a solved evaluation, and targets that may be an economics total
// ---------------------------------------------------------------------------
function streamMW(s) {
  if (!s) return NaN;
  if (num(s.mw_avg)) return s.mw_avg;
  let inv = 0;
  for (const c of s.components || []) { let w = NaN; try { w = TB.resolve(c.key).mw; } catch (_e) { w = NaN; } if (!num(w) || !num(c.mass_fraction)) return NaN; inv += c.mass_fraction / w; }
  return inv > 0 ? 1 / inv : NaN;
}
function econUnits(M, ev, settings) {
  const out = [];
  for (const b of M.blocks) {
    const br = ev.BR[b.id];
    if (!br) continue;
    const inlets = [], outlets = [];
    // drums and columns are sized from phase densities: describe their streams with the property method when needed
    const eq = (settings && settings.units && settings.units[b.id] && settings.units[b.id].equip) || econ.inferEquip(b.module);
    const dens = (eq === 'drum' || eq === 'column') && M.pkg && TB.rig;
    for (const s of M.streams) {
      let v = ev.SV[s.id];
      if (!v) continue;
      if (dens && ((s.from && s.from.b === b.id) || (s.to && s.to.b === b.id)) && !(v.rig && v.rig.props)) {
        try { const d = TB.rig.describeStream(M.pkg, clean(v)); v = Object.assign({}, v, { rig: d.rig, vapour_fraction: d.vapour_fraction }); } catch (_e) { /* outside the method's databank */ }
      }
      const w = num(v.mw_avg) ? v : Object.assign({}, v, { mw_avg: streamMW(v) });
      if (s.to && s.to.b === b.id) inlets[s.to.p] = w;
      if (s.from && s.from.b === b.id) outlets[s.from.p] = w;
    }
    out.push({ id: b.id, name: b.name || b.id, module: b.module, params: b.params, result: br.result, inlets, outlets });
  }
  return out;
}
function econOf(M, ev, settings) {
  if (ev.__econ && ev.__econSet === settings) return ev.__econ;
  const r = econ.computeEconomics(econUnits(M, ev, settings), settings, { mw: (k) => { try { return TB.resolve(k).mw; } catch (_e) { return NaN; } } });
  Object.defineProperty(ev, '__econ', { value: r, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(ev, '__econSet', { value: settings, writable: true, configurable: true, enumerable: false });
  return r;
}
/** a design-spec style target, or an economics total (needs the model and the settings) */
function metricX(t, ev, M, econSet) {
  if (t && t.economics !== undefined) {
    const v = econOf(M, ev, econSet).totals[t.economics];
    if (!num(v)) throw new FsError('MB_FS_ECON', `economics total '${t.economics}' could not be computed`, 'params.economics');
    return v;
  }
  return metric(t, ev);
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
    calcs: M.calcs, fbCalcs: M.fbCalcs,
  };
  C.B = new Map(C.blocks.map((b) => [b.id, b]));
  return C;
}

/**
 * STEP 34: run one calculator — imports read from the solved streams / units (or the model's
 * inputs), the program evaluated, exports written into the model (feed or unit input).
 * @returns {{imports, exports, variables}}
 */
function runCalculator(c, M, ev) {
  const inp = {};
  for (const t of c.imports) {
    let v;
    try { v = t.kind !== undefined ? readVary(t, M) : metric(t, ev); } catch (e) { throw new FsError('MB_FS_CALC', `calculator ${c.name}: import '${t.name}': ${e.message}`, 'params.calculators'); }
    if (!num(v)) throw new FsError('MB_FS_CALC', `calculator ${c.name}: import '${t.name}' is not a number`, 'params.calculators');
    inp[t.name] = v;
  }
  let env;
  try { env = calc.run(c.prog, inp); } catch (e) { throw new FsError('MB_FS_CALC', `calculator ${c.name}: ${e.message}`, 'params.calculators'); }
  const exps = {};
  for (const v of c.exports) {
    const x = env[v.name];
    if (v.kind === 'feed_flow' && !(x >= 0)) throw new FsError('MB_FS_CALC', `calculator ${c.name}: ${v.name} = ${x} — a feed flow cannot be negative`, 'params.calculators');
    if ((v.kind === 'feed_T' || v.kind === 'feed_P') && !(x > 0)) throw new FsError('MB_FS_CALC', `calculator ${c.name}: ${v.name} = ${x} — an absolute temperature / pressure must be positive`, 'params.calculators');
    if (v.kind === 'split' && !(x >= 0 && x <= 1)) throw new FsError('MB_FS_CALC', `calculator ${c.name}: ${v.name} = ${x} — a split fraction must be 0–1`, 'params.calculators');
    writeVary(v, M, x);
    exps[v.name] = x;
  }
  const vars = {};
  for (const q of c.prog.statements) vars[q.name] = env[q.name];
  return { imports: inp, exports: exps, variables: vars };
}

/**
 * evaluate() plus the feedback calculators: each pass's results give new exports, written
 * into the model, until they stop changing (substitution, Wegstein-accelerated per variable).
 */
function evaluateC(M, plan, opts, deadline, logOn, sink, wc) {
  let ev = evaluate(M, plan, opts, deadline, logOn, sink, wc);
  const FB = M.fbCalcs || [];
  if (!FB.length) return ev;
  let solves = ev.solves;
  const keyOf = (c, v) => c.id + '.' + v.name;
  const hist = {};
  let it = 0, conv = false, err = NaN;
  const all = FB.flatMap((c) => c.exports.map((v) => [c, v]));
  const chist = [];                                  // STEP 35: pass-by-pass record
  for (; it < opts.calc_max_iter; it++) {
    const x0 = all.map(([, v]) => { try { return readVary(v, M); } catch (_e) { return NaN; } });
    const res = {};
    for (const c of FB) res[c.id] = runCalculator(c, M, ev);   // writes the new exports
    const g = all.map(([c, v]) => res[c.id].exports[v.name]);
    err = Math.max(0, ...g.map((gi, k) => (num(x0[k]) ? Math.abs(gi - x0[k]) / Math.max(Math.abs(gi), Math.abs(x0[k]), 1e-12) : Infinity)));
    Object.assign(ev.calcs, res);
    chist.push({ pass: it + 1, err: num(err) ? p4(err) : null, values: Object.fromEntries(all.map(([c, v], k) => [(FB.length > 1 ? c.name + '.' : '') + v.name, p4(g[k])])) });
    if (err <= Math.max(opts.tol, 1e-9)) {
      // converged: the model keeps the export values the reported solve was made with
      all.forEach(([, v], k) => { if (num(x0[k])) writeVary(v, M, x0[k]); });
      conv = true; break;
    }
    // Wegstein per variable (bounded) after two substitution passes
    all.forEach(([c, v], k) => {
      const h = hist[keyOf(c, v)];
      let xn = g[k];
      if (h && it >= 2 && num(x0[k]) && Math.abs(x0[k] - h.x) > 1e-14 * Math.max(1, Math.abs(x0[k]))) {
        const sl = (g[k] - h.g) / (x0[k] - h.x);
        if (num(sl) && sl < 1) { const q = Math.min(Math.max(sl / (sl - 1), -5), 0.5); xn = q * x0[k] + (1 - q) * g[k]; }
      }
      hist[keyOf(c, v)] = { x: x0[k], g: g[k] };
      if (v.kind === 'feed_flow') xn = Math.max(0, xn);
      if (v.kind === 'split') xn = Math.min(1, Math.max(0, xn));
      if ((v.kind === 'feed_T' || v.kind === 'feed_P') && !(xn > 0)) xn = g[k];
      writeVary(v, M, xn);
    });
    ev = evaluate(M, plan, opts, deadline, false, sink, wc);
    solves += ev.solves;
  }
  ev.solves = solves;
  ev.calcLoop = { iterations: Math.min(it + 1, opts.calc_max_iter), converged: conv, err, history: chist };
  const names = FB.map((c) => c.name).join(', ');
  ev.log.push([conv ? 'o' : 'w', `${conv ? 'ƒ' : '⚠'} feedback calculator${FB.length > 1 ? 's' : ''} ${names} ${conv ? 'converged' : 'NOT converged'} in ${ev.calcLoop.iterations} pass${ev.calcLoop.iterations > 1 ? 'es' : ''} (relative change ${num(err) ? err.toExponential(2) : err})`]);
  if (!conv) { const m = `feedback calculator${FB.length > 1 ? 's' : ''} ${names} did not converge in ${opts.calc_max_iter} passes`; ev.warnings.push(m); ev.alerts.push(m); }
  return ev;
}

/**
 * One complete solve: sequential-modular pass, and the design-spec Newton
 * around it when specs are present. Throws FsError.
 * @returns {{ev, specOut, solves}}
 */
function core(M, plan, V, opts, deadline, logOn, sink, wc) {
  let ev = null, totalSolves = 0;
  const specOut = [];
  if (!V.specs.length) {
    ev = evaluateC(M, plan, opts, deadline, logOn, sink, wc);
    return { ev, specOut, solves: ev.solves };
  }
  /* inner recycle tolerance tighter than the spec tolerance so the FD Jacobian is clean
     (STEP 30: 0.1 × spec_tol — every evaluation starts from the last converged tears, so the
     finite-difference noise is far below the tolerance) */
  const inner = Object.assign({}, opts, { tol: Math.min(opts.tol, Math.max(opts.spec_tol * 0.1, 1e-10)) });
  const vs = V.specs.map((sp) => sp.vary);
  let x = vs.map((v) => readVary(v, M));
  const bounds = vs.map((v, i) => defaultBounds(v, x[i]));
  x = x.map((xi, i) => clamp(xi, bounds[i][0], bounds[i][1]));
  if (wc && logOn) wc.specX = x.slice();
  let nF = 0;
  const F = (xv) => {
    nF++;
    xv.forEach((xi, i) => writeVary(vs[i], M, xi));
    const e = evaluateC(M, plan, inner, deadline, false, sink, wc);
    totalSolves += e.solves;
    return { e, r: V.specs.map((sp) => metric(sp.target, e) - sp.value) };
  };
  // a trial point where some unit cannot be solved (e.g. an exchanger temperature cross) is
  // treated as a failed step, and the warm-start state is rolled back to before it (STEP 30)
  let lastFail = null;
  const tryF = (xv) => {
    const snap = wc ? { tear: Object.assign({}, wc.tear), col: Object.assign({}, wc.col), bro: Object.assign({}, wc.bro) } : null;
    try { return F(xv); } catch (e) {
      if (!(e instanceof FsError) || e.code === 'MB_FS_BUDGET') throw e;
      lastFail = e.message;
      if (snap) { wc.tear = snap.tear; wc.col = snap.col; wc.bro = snap.bro; }
      return null;
    }
  };
  let cur = F(x);
  const tols = V.specs.map((sp, i) => (num(sp.tol_abs) && sp.tol_abs > 0 ? sp.tol_abs
    : opts.spec_tol * Math.max(Math.abs(sp.value), Math.abs(cur.r[i] + sp.value) * 1e-3, 1e-12)));
  const scaled = (r) => Math.max(...r.map((ri, i) => Math.abs(ri) / tols[i]));
  if (!cur.r.every(num)) throw new FsError('MB_FS_SPEC', 'a design-spec target is not a number at the starting point (e.g. ratio with a zero denominator)', 'params.specs');
  let it = 0, conv = scaled(cur.r) <= 1;
  // STEP 35: Newton record — varied values, residuals, scaled residual (≤ 1 = met), step length, Jacobian
  const steps = [{ iteration: 0, varied: x.map(p7), residuals: cur.r.map(p4), scaled: p4(scaled(cur.r)), lambda: null, evaluations: nF }];
  const specHist = { specs: V.specs.map((sp, i) => ({ id: sp.id || ('spec' + (i + 1)), name: sp.name || null, target: sp.value, tol: p4(tols[i]) })), steps, inner_tol: inner.tol };
  if (wc) wc.specHist = specHist;
  for (; !conv && it < opts.spec_max_iter; it++) {
    const n = x.length;
    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      let h = Math.max(Math.abs(x[j]) * 1e-4, (bounds[j][1] - bounds[j][0]) * 1e-7, 1e-10);
      if (x[j] + h > bounds[j][1]) h = -h;
      let xh = x.slice(); xh[j] += h;
      let th = tryF(xh);
      if (!th) { h = -h; xh = x.slice(); xh[j] += h; th = F(xh); }
      const rh = th.r;
      for (let i = 0; i < n; i++) J[i][j] = (rh[i] - cur.r[i]) / h;
    }
    const dx = gaussSolve(J, cur.r.map((v) => -v));
    if (!dx || !dx.every(num)) throw new FsError('MB_FS_SPEC_SINGULAR', 'design spec cannot be met: the varied quantity has no effect on the target', 'params.specs');
    let lam = 1, best = null;
    for (let ls = 0; ls < 8; ls++) {
      const xn = x.map((xi, i) => clamp(xi + lam * dx[i], bounds[i][0], bounds[i][1]));
      const tr = tryF(xn);
      if (!tr) { lam /= 2; continue; }
      if (tr.r.every(num) && (!best || scaled(tr.r) < scaled(best.r))) best = { x: xn, lam, ...tr };
      if (tr.r.every(num) && scaled(tr.r) < scaled(cur.r)) break;
      lam /= 2;
    }
    if (!best || scaled(best.r) >= scaled(cur.r)) {
      const atBound = x.some((xi, i) => Math.abs(xi - bounds[i][0]) < 1e-12 || Math.abs(xi - bounds[i][1]) < 1e-12);
      throw new FsError('MB_FS_SPEC_STALL', 'design spec stalled' + (atBound ? ' at a bound of the varied quantity — widen lo/hi' : ' — check the spec is reachable') +
        (lastFail ? `; moving the varied quantity further makes a unit fail: ${lastFail}` : ''), 'params.specs');
    }
    x = best.x; cur = best;
    if (wc && logOn) wc.specX = x.slice();
    conv = scaled(cur.r) <= 1;
    steps.push({ iteration: it + 1, varied: x.map(p7), residuals: cur.r.map(p4), scaled: p4(scaled(cur.r)), lambda: p4(best.lam), evaluations: nF,
      jacobian: J.map((row) => row.map(p4)) });
  }
  x.forEach((xi, i) => writeVary(vs[i], M, xi));
  ev = evaluateC(M, plan, inner, deadline, logOn, sink, wc);
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
  return { ev, specOut, solves: totalSolves, specHist };
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
  // STEP 34: calculators — feed-forward ones join the calculation order, feedback ones iterate around it
  const CP = planCalcs(M, V.calcs);
  M.calcs = CP.ff; M.fbCalcs = CP.fb;
  const M0 = V.sens ? cloneModel(M) : null;        // user inputs, before specs move anything
  const plan = CP.plan;
  const cname = (id) => { const c = V.calcs.find((x) => x.id === id); return 'ƒ ' + (c ? c.name : id); };
  const orderTxt = plan.map((p) => (p.calc ? cname(p.calc) : p.loop ? '[' + p.blocks.map((id) => label(M.B.get(id))).join(' → ') + ']⟲' : label(M.B.get(p.blocks[0])))).join('  →  ') +
    (CP.fb.length ? '  ⟲ ' + CP.fb.map((c) => cname(c.id)).join(', ') + ' (feedback)' : '');
  let ev = null;
  const sink = {};
  let specOut = [];
  let totalSolves = 0;
  let specHist = null;
  const wc = newWarm();
  // continuation of an earlier call that ran out of time (STEP 30)
  const RS = readResume(input, plan, M, V);
  if (RS) {
    wc.tear = RS.tear; wc.col = RS.col;
    if (RS.x) V.specs.forEach((sp, i) => writeVary(sp.vary, M, RS.x[i]));
    if (RS.its) wc.itBase = RS.its;
    if (RS.hist) wc.histBase = RS.hist;
  }
  if (!V.specs.length) { wc.itDone = {}; wc.hist = {}; }   // loop iterations (and their history) of the main solve, carried by a continuation
  const prior = RS ? { calls: RS.calls, solves: RS.solves, ms: RS.ms } : { calls: 0, solves: 0, ms: 0 };
  const tally = () => ({ calls: prior.calls + 1, solves: prior.solves + wc.solves, ms: prior.ms + (Date.now() - t0) });
  try {
    const r = core(M, plan, V, opts, deadline, true, sink, wc);
    ev = r.ev; specOut = r.specOut; totalSolves = r.solves; specHist = r.specHist || null;
  } catch (e) {
    if (e instanceof FsError) {
      const solved = {};
      for (const k in sink.SV || {}) solved[k] = sink.SV[k];
      const partial = { order: orderTxt, log: (sink.log || []).concat([['e', '✕ ' + e.message]]),
        stream_results: solved, block_results: sink.BR || {}, solves: totalSolves, ms: Date.now() - t0 };
      if (e.code === 'MB_FS_BUDGET') {
        const phase = RS ? RS.phase : 'main';
        partial.resume = makeResume(input, Object.assign({ phase, tears: snapTears(wc), cols: wc.col,
          x: wc.specX || (RS && RS.x), rows: RS ? RS.rows : [], its: phase === 'main' && wc.itDone ? wc.itDone : null,
          hist: phase === 'main' ? packHist(wc.hist) : null }, tally()));
      }
      return fail(e.code, e.message, e.field, partial);
    }
    return fail('MB_FS_THROW', 'flowsheet solver exception: ' + e.message, 'params', null);
  }
  // STEP 31: units whose vapour above about 5 bar is an ideal gas (activity / Raoult methods with
  // "Vapour phase: Ideal gas") — one summary line in the run log and the warning list
  {
    const hits = M.blocks.filter((b) => ev.BR[b.id] && ev.BR[b.id].result && ev.BR[b.id].result.ideal_vapour).map((b) => [b, ev.BR[b.id].result.ideal_vapour]);
    if (hits.length) {
      const Pm = Math.max(...hits.map((h) => h[1].P_bar));
      const worst = hits.reduce((a, h) => (Math.abs(h[1].dh_kJkg || 0) > Math.abs(a[1].dh_kJkg || 0) ? h : a));
      const adv = [...new Set(hits.map((h) => h[1].advice))];
      const dh = Math.abs(worst[1].dh_kJkg || 0);
      const m = `Property method: vapour above 5 bar is treated as an ideal gas in ${hits.map((h) => label(h[0])).join(', ')} (up to ${Pm.toPrecision(3)} bar) — ` +
        `the real-gas enthalpy correction left out is about ${dh >= 10 ? dh.toFixed(0) : dh.toPrecision(2)} kJ/kg${hits.length > 1 ? ' in ' + label(worst[0]) : ''} (Peng–Robinson estimate), ` +
        `so duties and turbine / compressor power can be well off — ${adv.join('; ')}.`;
      ev.log.push(['w', '⚠ ' + m]);
      ev.alerts.push(m);
      ev.method_check = { ideal_vapour: hits.map((h) => Object.assign({ block: h[0].id }, h[1])) };
    }
  }
  const mainTears = snapTears(wc);
  wc.itBase = null; wc.itDone = null; wc.hist = null;
  // STEP 35: loop passes summed over every evaluation of the main solve (design-spec Newton,
  // feedback calculators) — the reported loop record is the last evaluation's
  const loopTot = Object.assign({}, wc.loopTot), evals = wc.evals;
  {
    const li = plan.map((p, i) => (p.loop ? i : -1)).filter((i) => i >= 0);
    ev.loops.forEach((l, j) => {
      if (evals > 1 && num(loopTot[li[j]])) l.iterations_all_evaluations = loopTot[li[j]] + (RS && RS.its && RS.its[li[j]] ? RS.its[li[j]] : 0);
      // the loop's first (cold) solve in this request, when later evaluations started warm from it
      const fh = wc.firstHist[li[j]];
      if (evals > 1 && fh && fh !== l.history && fh.length > 1) l.history_first_evaluation = fh;
    });
  }
  let resume;

  /* STEP 36: optimisation — minimise (or maximise) the objective over the bounded decision
     variables, constraints by an exact penalty; each point is a whole flowsheet solve (with the
     design specs met inside it). Points already solved in an earlier call are replayed. */
  let optimization, optCache = null;
  if (V.opt) {
    const O = V.opt, n = O.variables.length;
    const lo = O.variables.map((v) => v.lo), hi = O.variables.map((v) => v.hi);
    let x0;
    try { x0 = O.variables.map((v, k) => Math.min(hi[k], Math.max(lo[k], readVary(v.vary, M)))); }
    catch (e) { return fail(e.code || 'MB_FS_OPT', 'optimisation: ' + e.message, 'params.optimization'); }
    const cache = RS && RS.opt ? RS.opt.slice() : [];
    optCache = cache;
    const replayed = cache.length;
    let lastRun = null, lastX = null;
    const sgn = O.sense === 'max' ? -1 : 1;
    const objOf = (e) => O.objective.reduce((a, t) => a + t.coef * metricX(t.target, e, M, V.econ), 0);
    const viol = (g) => O.constraints.map((c, i) => (c.op === 'le' ? Math.max(0, g[i] - c.value) : Math.max(0, c.value - g[i])));
    const scaleOf = (i) => { const c = O.constraints[i]; if (Math.abs(c.value) > 1e-9) return Math.abs(c.value); const g0 = cache[0] && cache[0].g ? Math.abs(cache[0].g[i]) : 0; return g0 > 1e-9 ? g0 : 1; };
    const merit = (q) => {
      if (q.obj === null || !num(q.obj)) return 1e30;
      const f0 = cache.find((z) => num(z.obj));
      const Fs = f0 && Math.abs(f0.obj) > 1e-12 ? Math.abs(f0.obj) : 1;
      return sgn * q.obj / Fs + O.penalty * viol(q.g).reduce((a, v, i) => a + v / scaleOf(i), 0);
    };
    const evalAt = (x) => {
      let q = cache.find((z) => z.x.every((v, k) => v === x[k]));
      if (!q) {
        O.variables.forEach((v, k) => writeVary(v.vary, M, x[k]));
        try {
          const r = core(M, plan, V, opts, deadline, false, {}, wc);
          totalSolves += r.solves;
          q = { x: x.slice(), obj: objOf(r.ev), g: O.constraints.map((c) => metricX(c.target, r.ev, M, V.econ)),
            conv: r.ev.loops.every((l) => l.converged) && r.specOut.every((sp) => sp.converged) };
          if (!num(q.obj) || !q.g.every(num)) q = { x: x.slice(), obj: null, g: null, err: 'objective or constraint is not a number' };
          lastRun = r; lastX = x.slice();
        } catch (e) {
          if (e instanceof FsError && e.code === 'MB_FS_BUDGET') throw e;
          q = { x: x.slice(), obj: null, g: null, err: String(e.message || e).slice(0, 200) };
        }
        cache.push(q);
      }
      return merit(q);
    };
    const method = n === 1 ? 'Brent (golden section with parabolic steps)' : 'Nelder–Mead simplex';
    let res;
    try {
      if (n === 1) {
        const gen = optim.brent(lo[0], hi[0], x0[0], O.xtol * (hi[0] - lo[0]), O.max_evaluations);
        let st = gen.next();
        while (!st.done) st = gen.next(evalAt([st.value]));
        res = { x: st.value.x, converged: st.value.converged };
      } else {
        const toX = (u) => u.map((v, k) => lo[k] + v * (hi[k] - lo[k]));
        const gen = optim.nelderMead(x0.map((v, k) => (v - lo[k]) / (hi[k] - lo[k])), { maxit: O.max_evaluations, xtol: O.xtol, ftol: 1e-6 });
        let st = gen.next();
        while (!st.done) st = gen.next(evalAt(toX(st.value)));
        res = { x: toX(st.value.u), converged: st.value.converged };
      }
    } catch (e) {
      if (e instanceof FsError && e.code === 'MB_FS_BUDGET') {
        const partial = { order: orderTxt, log: ev.log.concat([['h', `◇ optimisation: ${cache.length} point${cache.length === 1 ? '' : 's'} solved — continuing in the next call`]]),
          stream_results: ev.SV, block_results: ev.BR, solves: totalSolves, ms: Date.now() - t0 };
        partial.resume = makeResume(input, Object.assign({ phase: 'opt', tears: snapTears(wc), cols: wc.col, x: V.specs.length ? specOut.map((sp) => sp.varied) : null, opt: cache }, tally()));
        return fail('MB_FS_BUDGET', `optimisation: server time budget reached after ${cache.length} points`, 'params.optimization', partial);
      }
      throw e;
    }
    // the best point solved (lowest merit); the final state of the flowsheet is solved there
    let bk = -1, bm = Infinity;
    cache.forEach((q, k) => { const m = merit(q); if (m < bm) { bm = m; bk = k; } });
    if (bk < 0 || bm >= 1e29) {
      O.variables.forEach((v, k) => writeVary(v.vary, M, x0[k]));
      return fail('MB_FS_OPT', 'optimisation: no point could be solved — ' + (cache.find((q) => q.err) || {}).err, 'params.optimization');
    }
    const xb = cache[bk].x;
    O.variables.forEach((v, k) => writeVary(v.vary, M, xb[k]));
    let fin = lastX && lastX.every((v, k) => v === xb[k]) ? lastRun : null;
    if (!fin) {
      try { fin = core(M, plan, V, opts, deadline, false, sink, wc); totalSolves += fin.solves; }
      catch (e) {
        if (e instanceof FsError && e.code === 'MB_FS_BUDGET') {
          const partial = { order: orderTxt, log: ev.log, stream_results: ev.SV, block_results: ev.BR, solves: totalSolves, ms: Date.now() - t0 };
          partial.resume = makeResume(input, Object.assign({ phase: 'opt', tears: snapTears(wc), cols: wc.col, x: V.specs.length ? specOut.map((sp) => sp.varied) : null, opt: cache }, tally()));
          return fail('MB_FS_BUDGET', 'optimisation: server time budget reached at the final solve', 'params.optimization', partial);
        }
        throw e;
      }
    }
    const mainLog = ev.log;
    ev = fin.ev; specOut = fin.specOut;
    ev.log = mainLog.concat(ev.log.filter((l) => !mainLog.includes(l)));
    const qb = cache[bk];
    const vb = viol(qb.g);
    const feasible = vb.every((v, i) => v <= 1e-4 * scaleOf(i));
    const p8 = (v) => (num(v) ? Number(v.toPrecision(8)) : null);
    optimization = {
      sense: O.sense, method, converged: res.converged && feasible, feasible,
      message: !feasible ? 'best point violates a constraint — widen the bounds or relax the constraint' : res.converged ? 'converged' : `stopped at ${O.max_evaluations} evaluations`,
      evaluations: cache.length, replayed: replayed || undefined, max_evaluations: O.max_evaluations, xtol: O.xtol,
      objective_start: p8(cache[0].obj), objective: p8(qb.obj),
      variables: O.variables.map((v, k) => ({ vary: v.vary, lo: v.lo, hi: v.hi, start: p8(x0[k]), value: p8(xb[k]),
        at_bound: Math.abs(xb[k] - v.lo) <= 1e-6 * (v.hi - v.lo) ? 'lower' : Math.abs(xb[k] - v.hi) <= 1e-6 * (v.hi - v.lo) ? 'upper' : null })),
      constraints: O.constraints.map((c, i) => ({ name: c.name, target: c.target, op: c.op, value: c.value, result: p8(qb.g[i]), satisfied: vb[i] <= 1e-4 * scaleOf(i) })),
      best_evaluation: bk + 1,
      history: cache.map((q, k) => ({ eval: k + 1, x: q.x.map(p8), objective: p8(q.obj), constraints: q.g ? q.g.map(p8) : undefined, merit: p8(merit(q)),
        feasible: q.g ? viol(q.g).every((v, i) => v <= 1e-4 * scaleOf(i)) : false, converged: q.conv === false ? false : undefined, error: q.err })),
    };
    ev.log.push(['h', `◇ optimisation (${method}): ${O.sense === 'max' ? 'maximum' : 'minimum'} ${p8(qb.obj)} after ${cache.length} evaluations — ${optimization.message}`]);
    if (!optimization.converged) ev.warnings.push('optimisation: ' + optimization.message);
    if (M0) O.variables.forEach((v, k) => writeVary(v.vary, M0, xb[k]));       // the sensitivity study runs at the optimum
  }

  /* sensitivity study: re-solve from the user's inputs at each value */
  let sensitivity;
  if (V.sens) {
    const rows = RS ? RS.rows.slice() : [];
    let stopped = false;
    for (const val of V.sens.values.slice(rows.length)) {
      if (Date.now() > deadline) { stopped = true; break; }
      const Mi = cloneModel(M0);
      const row = { value: val };
      try {
        writeVary(V.sens.vary, Mi, val);
        const r = core(Mi, plan, V, opts, deadline, false, {}, wc);
        totalSolves += r.solves;
        row.outputs = V.sens.outputs.map((t) => { try { return metricX(t, r.ev, Mi, V.econ); } catch (e) { return null; } });
        row.converged = r.ev.loops.every((l) => l.converged) && r.specOut.every((sp) => sp.converged) &&
          Object.values(r.ev.BR).every((br) => br.result.converged !== false);
        if (r.ev.alerts.length) row.alerts = r.ev.alerts.slice(0, 3);
      } catch (e) {
        if (e instanceof FsError && e.code === 'MB_FS_BUDGET') { stopped = true; break; }   // this point is redone by the next call
        row.error = e.message;
      }
      rows.push(row);
    }
    sensitivity = { vary: V.sens.vary, outputs: V.sens.outputs, rows, complete: !stopped && rows.length === V.sens.values.length };
    if (stopped) {
      ev.warnings.push(`sensitivity stopped at the server time budget after ${rows.length} of ${V.sens.values.length} points`);
      resume = makeResume(input, Object.assign({ phase: 'sens', tears: mainTears, cols: wc.col, x: V.specs.length ? specOut.map((sp) => sp.varied) : null, rows, opt: optCache }, tally()));
    }
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
  let heat = 0, cool = 0, work = 0, workOut = 0, qMissing = [];
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
    // STEP 33: solid carbon leaving a Gibbs reactor (or reformer) is a product of its own
    const so = br.result.solids_out;
    if (so && so.mass_flow_kg_h > 0) { prodsL.push(`${label(b)}·solids`); mOut += so.mass_flow_kg_h; if (num(so.H_kJh)) hOut += so.H_kJh; }
    const eb = br.result.energy_balance || {};
    const dl = br.result.details && Array.isArray(br.result.details.duties) ? br.result.details.duties : null;
    if (dl) { for (const d of dl) if (num(d.kW)) { if (d.kW > 0) heat += d.kW; else cool += d.kW; } }   // column: condenser and reboiler separately
    else if (num(eb.Q_kW)) { if (eb.Q_kW > 0) heat += eb.Q_kW; else cool += eb.Q_kW; }
    else if ((br.result.streams_out || []).length) qMissing.push(label(b));
    if (num(eb.W_kW)) { if (eb.W_kW > 0) work += eb.W_kW; else workOut += eb.W_kW; }
  }
  /* STEP 32: energy-balance reconciliation — the enthalpy change from feeds to products must
     equal the sum of the unit duties and shaft work. A gap means two units evaluated the same
     stream on different enthalpy bases (a classic unit next to a property-method unit, or two
     units with different property methods), or an unconverged recycle carried an error. */
  let recon = null;
  if (hOk && !qMissing.length) {
    const dHk = (hOut - hIn) / 3600, sumQ = heat + cool, sumW = work + workOut;
    const gap = dHk - sumQ - sumW;
    const gross = Math.abs(heat) + Math.abs(cool) + Math.abs(work) + Math.abs(workOut);
    let hAbs = 0;
    for (const s of M.streams) { const r = SR[s.id]; if (r && (!s.from || !s.to) && num(r.H_kJh)) hAbs += Math.abs(r.H_kJh) / 3600; }
    const tolK = Math.max(1e-3 * gross, 2e-5 * hAbs, 0.05);
    // where the gap arises: each unit's ΔH across its streams in the stream table against its own duty + work
    const byBlock = [];
    for (const b of M.blocks) {
      const br = ev.BR[b.id];
      if (!br) continue;
      let hi = 0, ho = 0, okH = true;
      for (const st of M.streams) {
        const r = SR[st.id];
        if (st.to && st.to.b === b.id) { if (r && num(r.H_kJh)) hi += r.H_kJh; else okH = false; }
        if (st.from && st.from.b === b.id) { if (r && num(r.H_kJh)) ho += r.H_kJh; else okH = false; }
      }
      for (let j = 0; j < b.n_out; j++) {
        if (M.streams.some((st) => st.from && st.from.b === b.id && st.from.p === j)) continue;
        const o = (br.result.streams_out || [])[j];
        if (o && num(o.H_kJh)) ho += o.H_kJh;
      }
      if (br.result.solids_out && num(br.result.solids_out.H_kJh)) ho += br.result.solids_out.H_kJh;
      if (!okH) continue;
      const eb = br.result.energy_balance || {};
      const dl = br.result.details && Array.isArray(br.result.details.duties) ? br.result.details.duties : null;
      const q = dl ? dl.reduce((a, d) => a + (num(d.kW) ? d.kW : 0), 0) : (num(eb.Q_kW) ? eb.Q_kW : 0);
      const g = (ho - hi) / 3600 - q - (num(eb.W_kW) ? eb.W_kW : 0);
      if (Math.abs(g) > 0.1 * tolK) byBlock.push({ block: b.id, name: label(b), module: b.module, gap_kW: g });
    }
    byBlock.sort((a, b) => Math.abs(b.gap_kW) - Math.abs(a.gap_kW));
    recon = { dH_kW: dHk, sum_duties_kW: sumQ, sum_work_kW: sumW, imbalance_kW: gap,
      imbalance_pct: gross > 0 ? 100 * gap / gross : null, tolerance_kW: tolK, ok: Math.abs(gap) <= tolK, by_block: byBlock.slice(0, 6) };
    if (!recon.ok) {
      const fm = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3));
      const where = byBlock.length ? ' — it arises in ' + byBlock.slice(0, 4).map((x) => `${x.name} (${x.module}, ${fm(x.gap_kW)} kW)`).join(', ') : '';
      const classic = byBlock.length && byBlock.slice(0, 4).every((x) => !(TB.RIG_NAMES && TB.RIG_NAMES.has(x.module)));
      const m = `Energy balance does not close: products − feeds ΔH = ${fm(dHk)} kW but the units' duties and shaft work add up to ${fm(sumQ + sumW)} kW ` +
        `(gap ${fm(gap)} kW${gross > 0 ? ', ' + (100 * Math.abs(gap) / gross).toPrecision(2) + ' % of the gross duty' : ''})${where}. ` +
        (classic ? 'The classic unit models (reformers, shift, methanator, component separator, classic heaters and valves) compute their duty on their own enthalpy route, which differs slightly from the stream-table enthalpies — a known limitation of the classic models; with a property method the standard units are on one basis.'
          : 'Usually a classic unit next to a property-method unit, or units with different property methods, evaluating the same stream on different enthalpy bases.');
      ev.warnings.push(m); ev.alerts.push(m); ev.log.push(['w', '⚠ ' + m]);
    }
  } else if (qMissing.length) {
    recon = { ok: null, note: `no duty reported by ${qMissing.join(', ')}` };
  }
  const closure = mIn > 0 ? (mOut - mIn) / mIn * 100 : 0;
  const loopsOk = ev.loops.every((l) => l.converged) && (!ev.calcLoop || ev.calcLoop.converged);
  const specsOk = specOut.every((s) => s.converged);
  ev.log.unshift(['h', 'Calculation order: ' + orderTxt]);
  const ms = Date.now() - t0;
  const tot = tally();
  ev.log.push(['o', `■ solved server-side · ${totalSolves} unit solves · ${ms} ms` + (tot.calls > 1 ? ` (call ${tot.calls}: ${tot.solves} unit solves · ${tot.ms} ms in all)` : '')]);
  const products = M.streams.filter((s) => s.from && !s.to && SR[s.id]).map((s) => Object.assign({ stream_id: s.id }, SR[s.id]));
  // ROUND 16: energy streams — what each carries (positive in the direction drawn)
  const energyOut = (V.energy || []).map((e) => {
    const br = e.from ? ev.BR[e.from] : null, eb = br ? br.result.energy_balance || {} : {};
    const q = e.from ? eb[e.type === 'work' ? 'W_kW' : 'Q_kW'] : null;
    const given = num(q) ? -q : null;                                   // energy the source unit gives up
    const kW = e.from ? (num(given) ? given * (e.to ? e.eff : 1) : null) : e.kW * e.eff;
    const o = { id: e.id, name: e.name, type: e.type, from: e.from, to: e.to, kind: e.from && e.to ? 'link' : e.from ? 'product' : 'feed', kW, efficiency: e.eff };
    if (e.from && e.to) o.source_kW = given;
    if (e.to) o.sink_param = e.path;
    if (e.from && e.to && num(kW) && kW < 0) {
      const lab = (id) => label(M.B.get(id));
      const m = e.type === 'work'
        ? `energy stream ${e.name}: ${lab(e.from)} absorbs ${(-given).toFixed(1)} kW of shaft power instead of delivering it — draw the arrow from the machine that delivers power (turbine) to the one it drives`
        : `energy stream ${e.name} carries ${kW.toFixed(1)} kW: ${lab(e.from)} takes heat in, so ${lab(e.to)} is cooled — the heat flows against the arrow`;
      ev.warnings.push(m); if (e.type === 'work') ev.alerts.push(m); ev.log.push(['w', '⚠ ' + m]);
    }
    return o;
  });
  const eLinks = energyOut.filter((e) => e.kind === 'link' && num(e.kW));
  return {
    streams_out: products,
    stream_results: SR,
    block_results: ev.BR,
    order: plan.map((p) => (p.calc ? { calculator: p.calc } : { blocks: p.blocks, loop: p.loop, tears: p.tears })),
    calculators: V.calcs.some((c) => !c.energy) ? V.calcs.filter((c) => !c.energy).map((c) => Object.assign({ id: c.id, name: c.name, kind: CP.fb.includes(c) ? 'feedback' : 'feed-forward' }, ev.calcs[c.id] || {},
      CP.fb.includes(c) && ev.calcLoop ? { converged: ev.calcLoop.converged, passes: ev.calcLoop.iterations } : {})) : undefined,
    energy_streams: energyOut.length ? energyOut.map((e) => { const c = V.calcs.find((x) => x.energy === e.id); return c ? Object.assign(e, { solved_as: CP.fb.includes(c) ? 'feedback' : 'feed-forward' }) : e; }) : undefined,
    loops: ev.loops,
    specs: specOut,
    convergence: {                // STEP 35: solver transparency
      accelerator: opts.accelerator, tol: opts.tol, max_iter: opts.max_iter, spec_tol: opts.spec_tol, spec_max_iter: opts.spec_max_iter,
      calc_max_iter: opts.calc_max_iter, evaluations: evals, spec_history: specHist || undefined,
      calculator_history: ev.calcLoop ? ev.calcLoop.history : undefined,
      tear_streams: plan.reduce((a, p) => a + (p.loop ? p.tears.length : 0), 0),
    },
    feeds_varied: V.specs.length || V.opt ? M.feeds : undefined,
    optimization,                // STEP 36
    economics: V.econ ? (() => { try { return econOf(M, ev, V.econ); } catch (e) { return { error: e.message }; } })() : undefined,
    overall: { feeds: feedsL, products: prodsL, mIn, mOut, closure, dH_kW: hOk ? (hOut - hIn) / 3600 : null, heat, cool, work, workOut,
      heat_recovered_kW: eLinks.length ? eLinks.filter((e) => e.type === 'heat').reduce((a, e) => a + e.kW, 0) : undefined,
      work_transferred_kW: eLinks.length ? eLinks.filter((e) => e.type === 'work').reduce((a, e) => a + e.kW, 0) : undefined },
    mass_balance: { in: mIn, out: mOut, closure_pct: closure },
    energy_balance: { Hin: hOk ? hIn : null, Hout: hOk ? hOut : null, Q_kW: hOk ? (hOut - hIn) / 3600 - (work + workOut) : null, W_kW: work + workOut, reconciliation: recon },
    details: { blocks: M.blocks.length, streams: M.streams.length, unit_solves: totalSolves, reused_results: wc.hits, warm_column_starts: wc.warmCols,
      server_calls: tot.calls, unit_solves_all_calls: tot.solves, ms_all_calls: tot.ms, solver: FS_VERSION,
      property_package: M.pkg ? M.pkg.model : null },
    sensitivity,
    converged: loopsOk && specsOk,
    iterations: totalSolves,
    warnings: ev.warnings,
    alerts: ev.alerts,           // loop / spec non-convergence and property-method misuse (UI status lamp)
    method_check: ev.method_check,
    log: ev.log,
    ms,
    resume,                      // set when the sensitivity study stopped at the time budget (post again with params.resume)
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
