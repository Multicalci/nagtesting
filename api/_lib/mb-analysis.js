// ============================================================================
// REPO PATH: api/_lib/mb-analysis.js
// ============================================================================
// multicalci.com — STEP 23 property analysis on the property-package core
// (Aspen "Analysis" / DWSIM "Utilities"):
//
//   phase-envelope   P–T phase envelope of a stream composition: bubble and
//                    dew curves traced by Michelsen's continuation method
//                    (unknowns ln K, ln T, ln P; the specified variable
//                    switches to the most sensitive one; steps through the
//                    critical point), mixture critical point, cricondenbar,
//                    cricondentherm and optional constant-vapour-fraction
//                    (quality) lines. Activity-coefficient packages give the
//                    bubble / dew curves (no critical point).
//   property-table   T or P sweep: phase split and phase properties (density,
//                    Cp, viscosity, thermal conductivity, Z, H, S).
//   binary-diagram   T–x–y (fixed P) or P–x–y (fixed T) for a binary, with
//                    azeotrope detection.
//
// Input: the engine's usual {streams:[stream], params:{property_package, …}}.
// Plain ES module. Server-side only. (c) multicalci.com
// ============================================================================

import th from './mb-thermo.js';
import units from './mb-units.js';

export const ANALYSIS_VERSION = 'mb-analysis 1.0.1';
const num = (x) => typeof x === 'number' && isFinite(x);
const fail = (code, msg, field) => { throw new units.UnitError(code, msg, field); };
const keysOf = (s) => [...new Set((s.components || []).filter((c) => num(c.mass_fraction) && c.mass_fraction > 0).map((c) => c.key))];
const norm = (v) => { const s = v.reduce((a, b) => a + b, 0); return v.map((t) => t / s); };
const r6 = (x) => (num(x) ? Number(x.toPrecision(7)) : null);

function input(inp, label) {
  if (!inp || !Array.isArray(inp.streams) || !inp.streams.length) fail('MB_INPUT', `${label}: one stream (the composition) is required`, 'streams');
  const p = inp.params || {};
  return { s: inp.streams[0], p };
}
const flashT = (pp, z, T, P) => (pp.threePhase ? th.flashPT3(pp, z, T, P) : th.flashPT(pp, z, T, P));

// ---------------------------------------------------------------------------
// small dense solver (partial pivoting)
// ---------------------------------------------------------------------------
function solve(A, b) {
  const n = b.length;
  const a = A.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) { const f = a[r][c] / a[c][c]; if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = a[r][n]; for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k]; x[r] = s / a[r][r]; }
  return x;
}

// ---------------------------------------------------------------------------
// phase envelope — Michelsen (1980) continuation
// u = [ln K_1 … ln K_n, ln T, ln P];  x = feed phase, y = incipient phase
// g_i = ln K_i + ln φ_i(y) − ln φ_i(x) ;  g_n = Σ (y_i − x_i) ;  g_{n+1} = u_s − S
// ---------------------------------------------------------------------------
function envelopeTracer(pp, z, beta, opts) {
  const live = z.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const C = live.length;
  const zc = live.map((i) => z[i]);
  const full = (v) => { const o = new Array(pp.n).fill(0); live.forEach((i, k) => { o[i] = v[k]; }); return o; };
  const comps = (u) => {
    const K = u.slice(0, C).map(Math.exp);
    const x = zc.map((zi, k) => zi / (1 + beta * (K[k] - 1)));
    const y = x.map((xi, k) => xi * K[k]);
    return { K, x, y };
  };
  // phase roots: feed phase 'L' and incipient 'V' on the bubble side; swapped past the critical point
  const G = (u, swap) => {
    const T = Math.exp(u[C]), P = Math.exp(u[C + 1]);
    const { x, y } = comps(u);
    const fx = pp.lnFug(T, P, full(norm(x)), swap ? 'V' : 'L');
    const fy = pp.lnFug(T, P, full(norm(y)), swap ? 'L' : 'V');
    const g = new Array(C + 1);
    for (let k = 0; k < C; k++) g[k] = u[k] + fy[live[k]] - fx[live[k]];
    let s = 0; for (let k = 0; k < C; k++) s += y[k] - x[k];
    g[C] = s;
    return g;
  };
  const jac = (u, swap, g0) => {
    const J = [];
    for (let r = 0; r <= C; r++) J.push(new Array(C + 2).fill(0));
    for (let j = 0; j < C + 2; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(u[j]));
      const up = u.slice(); up[j] += h;
      const gp = G(up, swap);
      for (let r = 0; r <= C; r++) J[r][j] = (gp[r] - g0[r]) / h;
    }
    return J;
  };
  /** Newton at fixed spec u[s] = S; returns {u, it} or null */
  const newton = (u0, s, S, swap) => {
    let u = u0.slice();
    u[s] = S;
    for (let it = 1; it <= 30; it++) {
      const g = G(u, swap);
      if (!g.every(num)) return null;
      const J = jac(u, swap, g);
      const A = J.map((row) => row.slice());
      const spec = new Array(C + 2).fill(0); spec[s] = 1;
      A.push(spec);
      const d = solve(A, g.concat([0]).map((v) => -v));
      if (!d || !d.every(num)) return null;
      // step limiting
      let mx = 0; for (let j = 0; j < C + 2; j++) mx = Math.max(mx, Math.abs(d[j]) / (j < C ? 1 : 0.2));
      const f = mx > 1 ? 1 / mx : 1;
      for (let j = 0; j < C + 2; j++) u[j] += f * d[j];
      let err = 0; for (let j = 0; j < C + 2; j++) err = Math.max(err, Math.abs(d[j]));
      if (err < 1e-9 && f === 1) {
        const gf = G(u, swap);
        if (Math.max(...gf.map(Math.abs)) < 1e-7) return { u, it, J: jac(u, swap, gf) };
      }
    }
    return null;
  };
  return { C, live, zc, comps, newton, jac, G };
}

/** Lagrange interpolation of ln T, ln P at signed-ln K = 0 (k = component with the largest |ln K| swing) */
function interpCritical(pts, C) {
  let k = 0, sw = -1;
  for (let j = 0; j < C; j++) { const v = Math.abs(pts[0][j]) + Math.abs(pts[pts.length - 1][j]); if (v > sw) { sw = v; k = j; } }
  const xs = pts.map((p) => p[k]);
  const L = (yIdx) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      let w = 1;
      for (let j = 0; j < pts.length; j++) if (j !== i) w *= (0 - xs[j]) / (xs[i] - xs[j]);
      s += w * pts[i][yIdx];
    }
    return s;
  };
  const ok = new Set(xs).size === xs.length;
  if (!ok) { const a = pts[pts.length - 2], b = pts[pts.length - 1]; return { T: Math.exp(0.5 * (a[C] + b[C])), P: Math.exp(0.5 * (a[C + 1] + b[C + 1])) }; }
  return { T: Math.exp(L(C)), P: Math.exp(L(C + 1)) };
}

function traceEnvelope(pp, z, beta, Pmin, maxPts, deadline, Pmax) {
  const liveC = pp.comps.filter((c, i) => z[i] > 0);
  const Tcmax = Math.max(...liveC.map((c) => c.Tc)), Pcmax = Math.max(...liveC.map((c) => c.Pc));
  const start = th.flashPVF(pp, z, Pmin, beta);
  const tr = envelopeTracer(pp, z, beta);
  const { C, live } = tr;
  const K0 = live.map((i) => Math.max(start.y[i], 1e-30) / Math.max(start.x[i], 1e-30));
  let u = K0.map(Math.log).concat([Math.log(start.T), Math.log(Pmin)]);
  let swap = false, s = C + 1;
  let first = tr.newton(u, s, u[s], swap);
  if (!first) fail('MB_ENV_START', 'phase envelope: could not converge the starting point at the minimum pressure');
  u = first.u;
  const branch = (sw) => (beta === 0 ? (sw ? 'dew' : 'bubble') : beta === 1 ? (sw ? 'bubble' : 'dew') : 'quality');
  const pts = [{ T: Math.exp(u[C]), P: Math.exp(u[C + 1]), swap, branch: branch(swap), u: u.slice() }];
  let critical = null, critCross = null;
  const hist = [];
  let ds = 0.1;                       // step in the specified variable
  let J = first.J;
  let lastDir = 1;
  const logPmin = Math.log(Pmin);
  for (let k = 0; k < maxPts; k++) {
    if (Date.now() > deadline) break;
    // sensitivity du/dS for the current spec
    const sens = (Jm, sp) => {
      const A = Jm.map((row) => row.slice());
      const spec = new Array(C + 2).fill(0); spec[sp] = 1;
      A.push(spec);
      const rhs = new Array(C + 1).fill(0).concat([1]);
      return solve(A, rhs);
    };
    let du = sens(J, s);
    if (!du) break;
    // switch the specified variable to the most sensitive one (ln K scaled ×1, ln T ×5, ln P ×1)
    const w = (j) => Math.abs(du[j]) * (j === C ? 5 : 1);
    let ns = 0; for (let j = 1; j < C + 2; j++) if (w(j) > w(ns)) ns = j;
    if (ns !== s) {
      const scale = du[ns];
      du = du.map((v) => v / scale);
      ds = ds * scale;
      s = ns;
    }
    // limits on the step: ln K ≤ 0.25 (0.05 near the critical point), ln T ≤ 0.04, ln P ≤ 0.25
    const nearCrit = Math.max(...u.slice(0, C).map(Math.abs)) < 0.5;
    const lim = (j) => (j < C ? (nearCrit ? 0.05 : 0.25) : j === C ? 0.04 : 0.25);
    let fac = 1;
    for (let j = 0; j < C + 2; j++) { const m = Math.abs(du[j] * ds); if (m > lim(j)) fac = Math.min(fac, lim(j) / m); }
    let step = ds * fac;
    // near the critical point with a ln K specified and heading for zero: jump
    // across to the mirror value (Newton is singular at ln K = 0)
    const jumping = s < C && nearCrit && Math.abs(u[s]) < 0.15 && Math.sign(step) === -Math.sign(u[s]);
    const jumpF = [2, 1.6, 2.6, 3.4, 1.3];
    let res = null, tries = 0;
    while (!res && tries < 8) {
      if (jumping) { if (tries >= jumpF.length) break; step = -jumpF[tries] * u[s]; }
      const ug = u.map((v, j) => v + du[j] * step);
      const S = u[s] + step;
      // crossing the critical point: all ln K change sign
      const crosses = u.slice(0, C).every((v, j) => Math.sign(v) !== Math.sign(ug[j]) || Math.abs(ug[j]) < 1e-12);
      const sw = crosses ? !swap : swap;
      res = tr.newton(ug, s, S, sw);
      if (res) {
        if (crosses) {
          // critical point: interpolate ln T and ln P against the signed ln K of the
          // heaviest-swing component (cubic through two points on each side when available)
          critCross = { before: hist.slice(-2).concat([u]), after: res.u, swapBefore: swap, swapAfter: sw };
          swap = sw;
        }
        break;
      }
      if (!jumping) step *= 0.5;
      tries++;
    }
    if (!res) break;
    // step control on Newton effort
    ds = step * (res.it <= 3 ? 1.6 : res.it <= 6 ? 1.0 : 0.6);
    lastDir = Math.sign(step) || lastDir;
    hist.push(u.slice()); if (hist.length > 4) hist.shift();
    u = res.u; J = res.J;
    if (critCross && !critCross.done) {
      critCross.post = (critCross.post || []).concat([u.slice()]);
      critical = interpCritical(critCross.before.slice(-2).concat(critCross.post.slice(0, 2)), C);
      if (critCross.post.length >= 2) critCross.done = true;
    }
    const T = Math.exp(u[C]), P = Math.exp(u[C + 1]);
    pts.push({ T, P, swap, branch: branch(swap), u: u.slice() });
    if (u[C + 1] < logPmin - 1e-9 && pts.length > 3) break;          // back down to the minimum pressure
    if (T < 20 || T > 3000 || P > (Pmax || 1e8)) break;
    if (!pp.isEOS && (T > Tcmax || P > Pcmax)) break;              // activity methods: stay below the components' critical points
    // a quality line ends at the critical point
    if (beta > 0 && beta < 1 && Math.max(...u.slice(0, C).map(Math.abs)) < 0.02) { critical = { T, P }; break; }
  }
  // exact critical point: converge saturation points at small ±ln K of the key
  // component on both sides of the crossing and extrapolate to ln K = 0
  if (critCross) {
    try {
      const a = critCross.before[critCross.before.length - 1], b = critCross.after;
      let k = 0; for (let j = 1; j < C; j++) if (Math.abs(a[j]) > Math.abs(a[k])) k = j;
      const sg = Math.sign(a[k]) || 1;
      const sol = [];
      for (const [sv, swp] of [[0.08, critCross.swapBefore], [0.04, critCross.swapBefore], [-0.04, critCross.swapAfter], [-0.08, critCross.swapAfter]]) {
        const S = sg * sv;
        const t = (S - a[k]) / (b[k] - a[k]);
        const ug = a.map((v, j) => v + t * (b[j] - v));
        const r = tr.newton(ug, k, S, swp);
        if (r) sol.push(r.u);
      }
      if (sol.length < 3 || !sol.some((v) => Math.sign(v[k]) === sg) || !sol.some((v) => Math.sign(v[k]) === -sg)) throw new Error('refine');
      const xs = sol.map((v) => v[k]);
      const L = (idx) => sol.reduce((acc, v, i) => { let w = 1; for (let j = 0; j < sol.length; j++) if (j !== i) w *= (0 - xs[j]) / (xs[i] - xs[j]); return acc + w * v[idx]; }, 0);
      critical = { T: Math.exp(L(C)), P: Math.exp(L(C + 1)), refined: true };
    } catch (_e) { /* keep the interpolated estimate */ }
  }
  return { pts, critical, tr };
}

function solvePhaseEnvelope(inp) {
  const { s, p } = input(inp, 'phase-envelope');
  const pp = units.pkg(p.property_package, keysOf(s));
  const a = units.stateIn(pp, s, 'phase-envelope stream');
  const z = a.z;
  const live = z.filter((v) => v > 0).length;
  if (live < 2) fail('MB_ENV_PURE', 'phase envelope: needs at least two components (a pure component has a vapour-pressure curve)', 'streams');
  const Pmin = (num(p.P_min_bar) && p.P_min_bar > 0 ? p.P_min_bar : 1) * 1e5;
  const Pmax = (num(p.P_max_bar) && p.P_max_bar > Pmin / 1e5 ? p.P_max_bar : 1000) * 1e5;
  const t0 = Date.now(), deadline = t0 + (num(p.budget_ms) ? p.budget_ms : 6000);
  const w = pp.warnings.slice();
  const maxPts = num(p.max_points) ? Math.min(600, p.max_points) : 400;
  // start on the bubble curve at the minimum pressure; mixtures rich in light gases
  // (no bubble point there) start on the dew curve instead
  let env = null, startBeta = 0;
  for (const b of [0, 1]) {
    try { env = traceEnvelope(pp, z, b, Pmin, maxPts, deadline, Pmax); startBeta = b; break; } catch (_e) { env = null; }
  }
  if (!env) fail('MB_ENV_START', `phase envelope: no bubble or dew point found at ${(Pmin / 1e5).toFixed(3)} bar — try another minimum pressure`, 'P_min_bar');
  const bubble = [], dew = [];
  for (const q of env.pts) (q.branch === 'bubble' ? bubble : dew).push([r6(q.T), r6(q.P / 1e5)]);
  if (!env.critical || !pp.isEOS) {
    // no critical point crossed: trace the other curve from the minimum pressure
    try {
      const d = traceEnvelope(pp, z, startBeta === 0 ? 1 : 0, Pmin, 300, deadline, Pmax);
      for (const q of d.pts) (q.branch === 'bubble' ? bubble : dew).push([r6(q.T), r6(q.P / 1e5)]);
      if (pp.isEOS) w.push('phase envelope: the bubble and dew curves were traced separately (no critical point reached)');
    } catch (_e) { w.push(`phase envelope: the ${startBeta === 0 ? 'dew' : 'bubble'} curve could not be traced from ${(Pmin / 1e5).toFixed(3)} bar`); }
  }
  if (!pp.isEOS) w.push('phase envelope: activity-coefficient methods have no critical point — the curves stop at the components’ critical temperature / pressure');
  const all = bubble.concat(dew);
  // cricondenbar / cricondentherm: golden-section refinement on the traced curve
  // (max ln P at specified ln T, max ln T at specified ln P)
  const refine = (objIdx, specIdx) => {
    const P = env.pts;
    let i = 0;
    for (let k = 1; k < P.length; k++) if (P[k].u[objIdx] > P[i].u[objIdx]) i = k;
    if (i === 0 || i === P.length - 1 || P[i - 1].swap !== P[i + 1].swap) return P[i];
    const a0 = P[i - 1].u, b0 = P[i + 1].u, sw = P[i].swap;
    const at = (S) => {
      const t = (S - a0[specIdx]) / (b0[specIdx] - a0[specIdx]);
      const ug = a0.map((v, j) => v + t * (b0[j] - v));
      const r = env.tr.newton(ug, specIdx, S, sw);
      return r ? r.u : null;
    };
    let lo = Math.min(a0[specIdx], b0[specIdx]), hi = Math.max(a0[specIdx], b0[specIdx]);
    const gr = (Math.sqrt(5) - 1) / 2;
    let best = P[i].u;
    for (let it = 0; it < 40 && hi - lo > 1e-9; it++) {
      const m1 = hi - gr * (hi - lo), m2 = lo + gr * (hi - lo);
      const u1 = at(m1), u2 = at(m2);
      if (!u1 || !u2) break;
      if (u1[objIdx] > best[objIdx]) best = u1;
      if (u2[objIdx] > best[objIdx]) best = u2;
      if (u1[objIdx] > u2[objIdx]) hi = m2; else lo = m1;
    }
    const C = env.tr.C;
    return { T: Math.exp(best[C]), P: Math.exp(best[C + 1]) };
  };
  let cb = null, ct = null;
  if (env.pts.length > 2) {
    const C = env.tr.C;
    const rb = refine(C + 1, C), rt = refine(C, C + 1);
    cb = [r6(rb.T), r6(rb.P / 1e5)]; ct = [r6(rt.T), r6(rt.P / 1e5)];
  }
  for (const q of all) { if (!cb || q[1] > cb[1]) cb = q; if (!ct || q[0] > ct[0]) ct = q; }
  const qual = [];
  for (const b of Array.isArray(p.quality) ? p.quality.filter((v) => num(v) && v > 0 && v < 1).slice(0, 5) : []) {
    try {
      const q = traceEnvelope(pp, z, b, Pmin, 300, deadline, Pmax);
      qual.push({ vapour_fraction: b, points: q.pts.map((t) => [r6(t.T), r6(t.P / 1e5)]) });
    } catch (e) { w.push(`quality line ${b}: ${e.message}`); }
  }
  if (Date.now() > deadline) w.push('phase envelope: stopped at the time budget — the curve may be incomplete');
  if (bubble.concat(dew).some((q) => q[1] >= Pmax / 1e5 * 0.999)) w.push(`phase envelope: a curve reaches the ${Pmax / 1e5} bar limit and was stopped there (open envelope — typical with hydrogen or other supercritical light gases)`);
  return {
    streams_out: [], mass_balance: {}, energy_balance: {},
    details: {
      pp: { model: pp.model, label: pp.label }, composition: Object.fromEntries(pp.keys.map((k, i) => [k, r6(z[i])])), P_min_bar: Pmin / 1e5,
      bubble, dew, critical: env.critical ? { T_K: r6(env.critical.T), P_bar: r6(env.critical.P / 1e5) } : null,
      P_max_bar: Pmax / 1e5, cricondenbar: cb ? { T_K: cb[0], P_bar: cb[1] } : null, cricondentherm: ct ? { T_K: ct[0], P_bar: ct[1] } : null,
      quality_lines: qual, points: all.length, ms: Date.now() - t0, method: 'Michelsen continuation (ln K, ln T, ln P)',
    },
    converged: true, warnings: [...new Set(w)],
  };
}

// ---------------------------------------------------------------------------
// property table — T or P sweep
// ---------------------------------------------------------------------------
function solvePropertyTable(inp) {
  const { s, p } = input(inp, 'property-table');
  const pp = units.pkg(p.property_package, keysOf(s));
  const a = units.stateIn(pp, s, 'property-table stream');
  const z = a.z;
  const vary = p.vary === 'P' ? 'P' : 'T';
  const n = Math.max(2, Math.min(60, Math.round(num(p.points) ? p.points : 21)));
  if (!num(p.from) || !num(p.to) || p.from === p.to) fail('MB_PT_RANGE', 'property-table: give from and to', 'from');
  const Tfix = num(p.T_K) ? p.T_K : a.T, Pfix = (num(p.P_bar) ? p.P_bar : a.P / 1e5) * 1e5;
  if (vary === 'T' && (p.from <= 0 || p.to <= 0)) fail('MB_PT_RANGE', 'property-table: temperatures must be > 0 K', 'from');
  if (vary === 'P' && (p.from <= 0 || p.to <= 0)) fail('MB_PT_RANGE', 'property-table: pressures must be > 0 bar', 'from');
  const rows = [];
  const w = pp.warnings.slice();
  const MWm = z.reduce((q, v, i) => q + v * pp.MW[i], 0);
  for (let k = 0; k < n; k++) {
    const v = p.from + (p.to - p.from) * k / (n - 1);
    const T = vary === 'T' ? v : Tfix, P = vary === 'P' ? v * 1e5 : Pfix;
    try {
      const r = flashT(pp, z, T, P);
      const pr = th.properties(pp, r);
      const h = th.hOf(pp, r), sv = th.sOf(pp, r);
      // mixture Cp at constant P (two-sided difference across a flash: includes latent heat inside the envelope)
      const dT = 0.05;
      let cp = null;
      try { cp = (th.hOf(pp, flashT(pp, z, T + dT, P)) - th.hOf(pp, flashT(pp, z, T - dT, P))) / (2 * dT); } catch (_e) { cp = null; }
      const beta = r.phase === 'V' ? 1 : r.phase === 'L' || r.phase === 'LL' ? 0 : r.beta;
      const ph = {};
      for (const q of pr.phases) {
        ph[q.type] = { fraction: r6(q.fraction), rho_kgm3: r6(q.rho_kgm3), MW: r6(q.MW), Cp_kJkgK: r6(q.Cp_JmolK / q.MW), mu_cP: r6(q.mu_Pas * 1000), k_WmK: r6(q.k_WmK), Z: r6(q.Z) };
        if (q.acid_gas) ph[q.type].acid_gas = q.acid_gas;       // STEP 25 speciation of an acid-gas solution
      }
      rows.push({ T_K: r6(T), P_bar: r6(P / 1e5), phase: r.phase, vapour_fraction: r6(beta), liquid2_fraction: r.x2 ? r6(r.beta2) : 0,
        H_kJkmol: r6(h), S_kJkmolK: r6(sv), H_kJkg: r6(h / MWm), Cp_kJkgK: num(cp) ? r6(cp / MWm) : null, rho_kgm3: r6(pr.rho_kgm3), phases: ph });
    } catch (e) { rows.push({ T_K: r6(T), P_bar: r6(P / 1e5), error: e.message }); }
  }
  return { streams_out: [], mass_balance: {}, energy_balance: {},
    details: { pp: { model: pp.model, label: pp.label }, vary, MW: r6(MWm), fixed: vary === 'T' ? { P_bar: r6(Pfix / 1e5) } : { T_K: r6(Tfix) }, rows },
    converged: rows.every((r) => !r.error), warnings: w };
}

// ---------------------------------------------------------------------------
// binary T–x–y / P–x–y diagram
// ---------------------------------------------------------------------------
function solveBinary(inp) {
  const { s, p } = input(inp, 'binary-diagram');
  let keys = Array.isArray(p.keys) && p.keys.length === 2 ? p.keys : keysOf(s).slice(0, 2);
  if (keys.length !== 2 || keys[0] === keys[1]) fail('MB_BIN_KEYS', 'binary-diagram: two different components are needed', 'keys');
  const pp = units.pkg(p.property_package, keys);
  const i1 = pp.index[keys[0]], i2 = pp.index[keys[1]];
  const type = p.type === 'Pxy' ? 'Pxy' : 'Txy';
  const n = Math.max(5, Math.min(51, Math.round(num(p.points) ? p.points : 21)));
  const P = (num(p.P_bar) ? p.P_bar : 1.01325) * 1e5, T = num(p.T_K) ? p.T_K : 298.15;
  const w = pp.warnings.slice();
  const rows = [];
  let guess;
  for (let k = 0; k < n; k++) {
    const x1 = k / (n - 1);
    const z = new Array(pp.n).fill(0); z[i1] = x1; z[i2] = 1 - x1;
    try {
      let r;
      if (type === 'Txy') r = th.flashPVF(pp, z, P, 0, guess); else r = th.flashTVF(pp, z, T, 0, guess);
      guess = type === 'Txy' ? r.T : r.P;
      rows.push({ x1: r6(x1), y1: r6(r.y[i1]), T_K: r6(r.T), P_bar: r6(r.P / 1e5) });
    } catch (e) { rows.push({ x1: r6(x1), error: e.message }); }
  }
  // dew curve at the same composition grid (y = z): x from the dew point
  const dew = [];
  guess = undefined;
  for (let k = 0; k < n; k++) {
    const y1 = k / (n - 1);
    const z = new Array(pp.n).fill(0); z[i1] = y1; z[i2] = 1 - y1;
    try {
      let r;
      if (type === 'Txy') r = th.flashPVF(pp, z, P, 1, guess); else r = th.flashTVF(pp, z, T, 1, guess);
      guess = type === 'Txy' ? r.T : r.P;
      dew.push({ y1: r6(y1), x1: r6(r.x[i1]), T_K: r6(r.T), P_bar: r6(r.P / 1e5) });
    } catch (e) { dew.push({ y1: r6(y1), error: e.message }); }
  }
  // azeotrope: sign change of (y1 − x1) on the bubble curve (interior points)
  const azeo = [];
  const good = rows.filter((r) => !r.error);
  for (let k = 1; k < good.length; k++) {
    const a = good[k - 1], b = good[k];
    const da = a.y1 - a.x1, db = b.y1 - b.x1;
    if (a.x1 > 0 && b.x1 < 1 && da * db < 0) {
      // refine by bisection on x1
      let lo = a.x1, hi = b.x1, flo = da;
      let xr = 0, Tr = 0;
      xr = a.x1 + (b.x1 - a.x1) * da / (da - db);              // linear estimate
      Tr = type === 'Txy' ? a.T_K + (b.T_K - a.T_K) * (xr - a.x1) / (b.x1 - a.x1) : a.P_bar + (b.P_bar - a.P_bar) * (xr - a.x1) / (b.x1 - a.x1);
      for (let it = 0; it < 40; it++) {
        const m = 0.5 * (lo + hi);
        const z = new Array(pp.n).fill(0); z[i1] = m; z[i2] = 1 - m;
        let r;
        try { r = type === 'Txy' ? th.flashPVF(pp, z, P, 0, a.T_K) : th.flashTVF(pp, z, T, 0, a.P_bar * 1e5); } catch (_e) { break; }
        const fm = r.y[i1] - m;
        if (fm * flo > 0) { lo = m; flo = fm; } else hi = m;
        xr = m; Tr = type === 'Txy' ? r.T : r.P / 1e5;
        if (hi - lo < 1e-7) break;
      }
      azeo.push(type === 'Txy' ? { x1: r6(xr), T_K: r6(Tr) } : { x1: r6(xr), P_bar: r6(Tr) });
    }
  }
  // liquid–liquid split along the bubble curve (heterogeneous region) and the
  // three-phase (heteroazeotrope) line: bisection on T (Txy) or P (Pxy) between
  // the liquid–liquid and vapour–liquid answers of the three-phase flash
  let lle = false, three = null;
  for (const r of good) {
    if (r.x1 <= 0 || r.x1 >= 1) continue;
    const z = new Array(pp.n).fill(0); z[i1] = r.x1; z[i2] = 1 - r.x1;
    let r3 = null;
    try { r3 = th.flashPT3(pp, z, Math.max(10, r.T_K - 0.05), r.P_bar * 1e5); } catch (_e) { r3 = null; }
    if (!r3 || !r3.x2) continue;
    lle = true;
    try {
      const at = (v) => (type === 'Txy' ? th.flashPT3(pp, z, v, P) : th.flashPT3(pp, z, T, v));
      // the three-phase point lies below both pure boiling points (above both pure vapour pressures)
      const ends = [good[0], good[good.length - 1]];
      let lo = type === 'Txy' ? Math.min(r.T_K, ...ends.map((e) => e.T_K)) - 60 : 3 * Math.max(...ends.map((e) => e.P_bar)) * 1e5;
      let hi = type === 'Txy' ? Math.min(...ends.map((e) => e.T_K)) : Math.max(...ends.map((e) => e.P_bar)) * 1e5;
      let rl = at(lo), rh = at(hi);
      if (rl.phase === 'LL' && (rh.phase === 'VL' || rh.phase === 'V')) {
        for (let it = 0; it < 60; it++) {
          const m = 0.5 * (lo + hi), rm = at(m);
          if (rm.phase === 'LL') { lo = m; rl = rm; } else if (rm.phase === 'VLL') { rl = rm; rh = rm; lo = m; hi = m; break; } else { hi = m; rh = rm; }
          if (Math.abs(hi - lo) < (type === 'Txy' ? 1e-6 : 1e-3)) break;
        }
        const yv = rh.phase === 'V' ? rh.y : rh.y;
        three = { [type === 'Txy' ? 'T_K' : 'P_bar']: r6(type === 'Txy' ? 0.5 * (lo + hi) : 0.5 * (lo + hi) / 1e5),
          x1_light: r6(rl.x[i1]), x1_heavy: r6(rl.x2[i1]), y1: r6(yv[i1]) };
      }
    } catch (_e) { /* three-phase line not resolved */ }
    break;
  }
  // stable diagram: inside the liquid–liquid gap the bubble point of the overall liquid is the
  // three-phase point (vapour = heteroazeotrope composition); single-liquid azeotropes found on
  // the metastable curve there are dropped
  if (three) {
    const lo = Math.min(three.x1_light, three.x1_heavy), hi = Math.max(three.x1_light, three.x1_heavy);
    const key = type === 'Txy' ? 'T_K' : 'P_bar';
    for (const r of rows) if (!r.error && r.x1 > lo && r.x1 < hi) { r[key] = three[key]; r.y1 = three.y1; r.two_liquids = true; }
    for (let k = azeo.length - 1; k >= 0; k--) if (azeo[k].x1 > lo && azeo[k].x1 < hi) azeo.splice(k, 1);
    if (three.y1 > lo && three.y1 < hi) azeo.push({ x1: three.y1, [key]: three[key], heterogeneous: true });
    w.push('binary-diagram: two liquid phases between x₁ = ' + lo.toFixed(4) + ' and ' + hi.toFixed(4) + ' — the bubble curve there is the three-phase line');
  } else if (lle) w.push('binary-diagram: two liquid phases coexist along part of the bubble curve, but the three-phase line could not be resolved — the single-liquid bubble curve shown there is metastable');
  return { streams_out: [], mass_balance: {}, energy_balance: {},
    details: { pp: { model: pp.model, label: pp.label }, type, keys, fixed: type === 'Txy' ? { P_bar: r6(P / 1e5) } : { T_K: r6(T) }, bubble: rows, dew, azeotropes: azeo, liquid_liquid: lle, three_phase: three },
    converged: rows.every((r) => !r.error), warnings: w };
}

export const ANALYSIS_MODULES = {
  'phase-envelope': solvePhaseEnvelope,
  'property-table': solvePropertyTable,
  'binary-diagram': solveBinary,
};
export default { ANALYSIS_VERSION, ANALYSIS_MODULES };
