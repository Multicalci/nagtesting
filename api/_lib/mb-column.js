// ============================================================================
// REPO PATH: api/_lib/mb-column.js
// ============================================================================
// multicalci.com — STEP 22 rigorous equilibrium-stage column
// (distillation, absorption, stripping, refluxed absorber / reboiled
// stripper) on the property-package core.
//
// Method: Naphtali–Sandholm simultaneous correction. Unknowns per stage are
// the liquid and vapour component flows and the temperature (2C+1); the
// MESH equations are solved by Newton's method with a numerically built
// block-tridiagonal Jacobian, bordered by the column-level unknowns
// (distillate draw ratio, condenser / reboiler duty) and the two operating
// specifications. Start-up: constant-molal-overflow flows, a smooth key-split
// estimate of the products, bubble-point temperatures and a few Wang–Henke
// (bubble-point method) passes, then full Newton with step limiting and a
// residual line search.
//
// Stage numbering follows the commercial convention: stage 1 is the
// condenser (when present), stage N the reboiler (when present).
//
// params:
//   stages            N (≥ 3 with condenser + reboiler)
//   condenser         'total' | 'partial' | 'none'
//   reboiler          'kettle' | 'none'
//   feed_stages       [stage for inlet 1, stage for inlet 2, …]
//   P_top_bar         condenser (or top-stage) pressure
//   dp_stage_bar      pressure drop per stage (default 0)
//   condenser_dp_bar  condenser → stage 2 pressure drop (default 0)
//   specs             [{type, value, key?, product?}] — as many as needed:
//                     reflux_ratio, distillate_rate (kmol/h), bottoms_rate,
//                     boilup_ratio, reflux_rate, boilup_rate,
//                     condenser_duty (kW), reboiler_duty (kW),
//                     distillate_mole_frac {key}, bottoms_mole_frac {key},
//                     recovery {key, product:'distillate'|'bottoms'}
//                     condenser_temperature (K, partial / total condenser)
//   efficiency        Murphree vapour efficiency of every tray (0 < E ≤ 1,
//                     default 1 = equilibrium stages); condenser and reboiler
//                     are always equilibrium stages (STEP 25)
//   stage_efficiency  [{stage, value}] tray-by-tray overrides
//   component_efficiency { key: E } component Murphree efficiencies (e.g. a
//                     low CO2 efficiency in a reactive absorber), override E
//   side_draws        [{stage, phase:'L'|'V', rate_kmol_h}]
//   heaters           [{stage, duty_kW}]
//   estimates         {D_kmol_h, reflux_ratio, T_top_K, T_bottom_K}
//   max_iter, tol     Newton limits (default 60, 1e-9)
//
// outlets: [distillate | top vapour, bottoms | bottom liquid, side draws in
//          the order of params.side_draws]
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import th from './mb-thermo.js';
import units from './mb-units.js';

export const COLUMN_VERSION = 'mb-column 1.2.0';
const KJH_PER_KW = 3600;
const num = (x) => typeof x === 'number' && isFinite(x);
const fail = (code, msg, field) => { throw new units.UnitError(code, msg, field); };

// ---------------------------------------------------------------------------
// small dense linear algebra
// ---------------------------------------------------------------------------
function luFactor(M) {
  const n = M.length;
  const a = M.map((r) => r.slice());
  const piv = new Array(n);
  for (let c = 0; c < n; c++) {
    let p = c, mx = Math.abs(a[c][c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(a[r][c]); if (v > mx) { mx = v; p = r; } }
    if (mx < 1e-300) return null;
    piv[c] = p;
    if (p !== c) { const t = a[c]; a[c] = a[p]; a[p] = t; }
    const d = a[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / d;
      if (f !== 0) { a[r][c] = f; const ar = a[r], ac = a[c]; for (let k = c + 1; k < n; k++) ar[k] -= f * ac[k]; } else a[r][c] = 0;
    }
  }
  return { a, piv, n };
}
function luSolve(F, b) {
  const { a, piv, n } = F;
  const x = b.slice();
  for (let c = 0; c < n; c++) { const p = piv[c]; if (p !== c) { const t = x[c]; x[c] = x[p]; x[p] = t; } }
  for (let r = 1; r < n; r++) { let s = x[r]; const ar = a[r]; for (let k = 0; k < r; k++) s -= ar[k] * x[k]; x[r] = s; }
  for (let r = n - 1; r >= 0; r--) { let s = x[r]; const ar = a[r]; for (let k = r + 1; k < n; k++) s -= ar[k] * x[k]; x[r] = s / ar[r]; }
  return x;
}
const matVec = (M, v) => M.map((r) => r.reduce((s, a, k) => s + a * v[k], 0));
const matMat = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0)));
const transpose = (M) => M[0].map((_, j) => M.map((r) => r[j]));

/**
 * Solve the block-tridiagonal system  Sub_j X_{j−1} + D_j X_j + Sup_j X_{j+1} = RHS_j
 * for several right-hand sides at once (RHS_j is b × m).
 */
function blockThomas(Sub, D, Sup, RHS) {
  const N = D.length;
  const Dp = new Array(N), Rp = new Array(N), F = new Array(N);
  F[0] = luFactor(D[0]);
  if (!F[0]) return null;
  Rp[0] = RHS[0];
  Dp[0] = D[0];
  const solveCols = (Fk, M) => transpose(transpose(M).map((col) => luSolve(Fk, col)));
  const G = new Array(N);       // G_j = Dp_j^{-1} Sup_j
  for (let j = 0; j < N; j++) {
    if (j > 0) {
      // Dp_j = D_j − Sub_j G_{j−1};  Rp_j = RHS_j − Sub_j Y_{j−1}
      const SG = matMat(Sub[j], G[j - 1]);
      Dp[j] = D[j].map((r, a) => r.map((v, b) => v - SG[a][b]));
      F[j] = luFactor(Dp[j]);
      if (!F[j]) return null;
      const SY = matMat(Sub[j], Rp[j - 1]);
      Rp[j] = RHS[j].map((r, a) => r.map((v, b) => v - SY[a][b]));
    }
    Rp[j] = solveCols(F[j], Rp[j]);          // Y_j = Dp_j^{-1}(…)
    if (j < N - 1) G[j] = solveCols(F[j], Sup[j]);
  }
  const X = new Array(N);
  X[N - 1] = Rp[N - 1];
  for (let j = N - 2; j >= 0; j--) {
    const GX = matMat(G[j], X[j + 1]);
    X[j] = Rp[j].map((r, a) => r.map((v, b) => v - GX[a][b]));
  }
  return X;
}

// ---------------------------------------------------------------------------
// column model
// ---------------------------------------------------------------------------

let S0warn = [];
function setup(inp) {
  if (!inp || !Array.isArray(inp.streams) || !inp.streams.length) fail('MB_INPUT', 'column: {streams, params} with at least one feed', 'streams');
  const p = inp.params || {};
  const N = p.stages;
  if (!Number.isInteger(N) || N < 2 || N > 120) fail('MB_COL_STAGES', 'column: stages must be an integer 2–120', 'stages');
  const cond = p.condenser || 'total';
  const reb = p.reboiler || 'kettle';
  if (!['total', 'partial', 'none'].includes(cond)) fail('MB_COL_COND', "column: condenser must be 'total', 'partial' or 'none'", 'condenser');
  if (!['kettle', 'none'].includes(reb)) fail('MB_COL_REB', "column: reboiler must be 'kettle' or 'none'", 'reboiler');
  const hasC = cond !== 'none', hasR = reb !== 'none';
  if (N < (hasC ? 1 : 0) + (hasR ? 1 : 0) + 1) fail('MB_COL_STAGES', 'column: too few stages for the condenser / reboiler chosen', 'stages');
  const fs = p.feed_stages;
  if (!Array.isArray(fs) || fs.length !== inp.streams.length) fail('MB_COL_FEED', 'column: feed_stages must list one stage (1…N) per inlet stream', 'feed_stages');
  for (const s of fs) if (!Number.isInteger(s) || s < 1 || s > N) fail('MB_COL_FEED', `column: feed stage ${s} outside 1…${N}`, 'feed_stages');
  if (hasC && fs.some((s) => s === 1)) fail('MB_COL_FEED', 'column: a feed cannot enter the condenser (stage 1)', 'feed_stages');
  const specs = Array.isArray(p.specs) ? p.specs : [];
  const need = (hasC ? 1 : 0) + (hasR ? 1 : 0);
  if (specs.length !== need) fail('MB_COL_SPECS', `column: ${need} specification(s) needed (${hasC ? 'condenser' : ''}${hasC && hasR ? ' + ' : ''}${hasR ? 'reboiler' : ''}${need ? '' : 'none for an absorber'}) — ${specs.length} given`, 'specs');
  const known = ['reflux_ratio', 'distillate_rate', 'bottoms_rate', 'boilup_ratio', 'reflux_rate', 'boilup_rate', 'condenser_duty', 'reboiler_duty', 'distillate_mole_frac', 'bottoms_mole_frac', 'recovery', 'condenser_temperature'];
  for (const s of specs) {
    if (!s || !known.includes(s.type)) fail('MB_COL_SPECS', `column: unknown spec '${s && s.type}' (use ${known.join(', ')})`, 'specs');
    if (!num(s.value)) fail('MB_COL_SPECS', `column: spec '${s.type}' needs a numeric value`, 'specs');
    if ((s.type.endsWith('mole_frac') || s.type === 'recovery') && typeof s.key !== 'string') fail('MB_COL_SPECS', `column: spec '${s.type}' needs a component key`, 'specs');
    if (s.type === 'recovery' && !['distillate', 'bottoms'].includes(s.product)) fail('MB_COL_SPECS', "column: recovery spec needs product 'distillate' or 'bottoms'", 'specs');
    if ((s.type === 'reflux_ratio' || s.type === 'reflux_rate' || s.type === 'condenser_duty' || s.type === 'distillate_mole_frac' || (s.type === 'recovery' && s.product === 'distillate') || s.type === 'distillate_rate') && !hasC && s.type !== 'distillate_rate') fail('MB_COL_SPECS', `column: '${s.type}' needs a condenser`, 'specs');
    if ((s.type === 'boilup_ratio' || s.type === 'boilup_rate' || s.type === 'reboiler_duty') && !hasR) fail('MB_COL_SPECS', `column: '${s.type}' needs a reboiler`, 'specs');
    if (s.type === 'condenser_temperature' && !hasC) fail('MB_COL_SPECS', "column: 'condenser_temperature' needs a condenser", 'specs');
    if (s.type === 'condenser_temperature' && !(s.value > 0)) fail('MB_COL_SPECS', 'column: condenser_temperature is in K and must be positive', 'specs');
  }
  // Murphree vapour efficiencies (STEP 25)
  const eff = (v, what) => { if (v === undefined || v === null) return null; if (!num(v) || v <= 0 || v > 1) fail('MB_COL_EFF', `column: ${what} must be a number in (0, 1]`, 'efficiency'); return v; };
  const E0 = eff(p.efficiency, 'efficiency');
  const Est = new Array(N).fill(E0 === null ? 1 : E0);
  for (const e of Array.isArray(p.stage_efficiency) ? p.stage_efficiency : []) {
    if (!e || !Number.isInteger(e.stage) || e.stage < 1 || e.stage > N) fail('MB_COL_EFF', 'column: stage_efficiency entries need {stage 1…N, value}', 'stage_efficiency');
    Est[e.stage - 1] = eff(e.value, `stage ${e.stage} efficiency`);
  }
  const Ecomp = {};
  if (p.component_efficiency && typeof p.component_efficiency === 'object') for (const [k, v] of Object.entries(p.component_efficiency)) Ecomp[k] = eff(v, `component efficiency of ${k}`);
  if (hasC) Est[0] = 1;
  if (hasR) Est[N - 1] = 1;
  if (!num(p.P_top_bar) || p.P_top_bar <= 0) fail('MB_COL_P', 'column: P_top_bar (top / condenser pressure) required', 'P_top_bar');
  S0warn = specs.filter((s) => s.type === 'condenser_duty' || s.type === 'reboiler_duty').length === 2
    ? ['column: condenser and reboiler duty specified together are ill-conditioned (their difference fixes the product split) — prefer one flow or ratio specification'] : [];
  return { p, N, cond, reb, hasC, hasR, fs: fs.map((s) => s - 1), specs, Est, Ecomp };
}

function solveColumn(inp) {
  const t0 = Date.now();
  const S = setup(inp);
  const { p, N, cond, hasC, hasR, specs } = S;
  const keysAll = [...new Set(inp.streams.flatMap((s) => (s.components || []).filter((c) => num(c.mass_fraction) && c.mass_fraction > 0).map((c) => c.key)))];
  const pp = units.pkg(p.property_package, keysAll);
  const C = pp.n, b = 2 * C + 1;
  const warnings = pp.warnings.slice().concat(S0warn);
  if (pp.threePhase) warnings.push('column: stages are vapour–liquid only — a free-water (second liquid) phase is not modelled on the trays');
  const feeds = inp.streams.map((s, k) => units.stateIn(pp, s, `column feed ${k + 1}`));
  // Murphree efficiency matrix E[j][i]; vapour entering the bottom tray of a
  // column without reboiler = the vapour part of the feeds on that stage
  for (const k of Object.keys(S.Ecomp)) if (!(k in pp.index)) warnings.push(`column: component efficiency for '${k}' ignored — not in the feeds`);
  const Emat = Array.from({ length: N }, (_, j) => pp.keys.map((k) => ((hasC && j === 0) || (hasR && j === N - 1) ? 1 : (k in S.Ecomp ? S.Ecomp[k] : S.Est[j]))));
  const yFeedV = Array.from({ length: N }, () => null);
  feeds.forEach((f, k) => {
    const j = S.fs[k];
    const bV = f.r.phase === 'V' ? 1 : f.r.phase === 'L' ? 0 : f.r.beta;
    if (!(bV > 0)) return;
    const yv = f.r.phase === 'V' ? f.z : f.r.y;
    if (!yFeedV[j]) yFeedV[j] = new Array(pp.n).fill(0);
    for (let i = 0; i < pp.n; i++) yFeedV[j][i] += f.F * bV * yv[i];
  });
  for (let j = 0; j < N; j++) if (yFeedV[j]) { const s2 = yFeedV[j].reduce((a, c) => a + c, 0); yFeedV[j] = yFeedV[j].map((v) => v / s2); }
  const murphree = Emat.some((r) => r.some((e) => e < 1));
  if (murphree && !hasR && !yFeedV[N - 1]) for (let i = 0; i < pp.n; i++) Emat[N - 1][i] = 1;
  const Ftot = feeds.reduce((a, f) => a + f.F, 0);
  if (!(Ftot > 0)) fail('MB_COL_FEED', 'column: total feed flow is zero', 'streams');
  const fFlow = feeds.map((f) => f.z.map((v) => v * f.F));
  const zTot = new Array(C).fill(0);
  fFlow.forEach((v) => v.forEach((x, i) => { zTot[i] += x / Ftot; }));
  // pressures
  const Pst = new Array(N);
  const dps = num(p.dp_stage_bar) ? p.dp_stage_bar : 0;
  const cdp = num(p.condenser_dp_bar) ? p.condenser_dp_bar : 0;
  for (let j = 0; j < N; j++) Pst[j] = (p.P_top_bar + (hasC && j > 0 ? cdp : 0) + dps * (hasC ? Math.max(0, j - 1) : j)) * 1e5;
  if (num(p.P_bottom_bar)) for (let j = 0; j < N; j++) Pst[j] = (p.P_top_bar + (p.P_bottom_bar - p.P_top_bar) * j / Math.max(1, N - 1)) * 1e5;
  // stage feeds
  const Fst = Array.from({ length: N }, () => new Array(C).fill(0));
  const HFst = new Array(N).fill(0);
  feeds.forEach((f, k) => { const j = S.fs[k]; for (let i = 0; i < C; i++) Fst[j][i] += fFlow[k][i]; HFst[j] += f.H_kJh; });
  // side draws and heaters
  const UL = new Array(N).fill(0), UV = new Array(N).fill(0), Qst = new Array(N).fill(0);
  for (const d of Array.isArray(p.side_draws) ? p.side_draws : []) {
    if (!Number.isInteger(d.stage) || d.stage < 1 || d.stage > N || !num(d.rate_kmol_h) || d.rate_kmol_h < 0) fail('MB_COL_DRAW', 'column: side_draws need {stage 1…N, phase, rate_kmol_h ≥ 0}', 'side_draws');
    if ((hasC && d.stage === 1) || (hasR && d.stage === N)) fail('MB_COL_DRAW', `column: side draw on stage ${d.stage} — draw from the condenser / reboiler through the distillate / bottoms specs instead`, 'side_draws');
    if (d.phase === 'V') UV[d.stage - 1] += d.rate_kmol_h; else UL[d.stage - 1] += d.rate_kmol_h;
  }
  for (const h of Array.isArray(p.heaters) ? p.heaters : []) {
    if (!Number.isInteger(h.stage) || h.stage < 1 || h.stage > N || !num(h.duty_kW)) fail('MB_COL_HEATER', 'column: heaters need {stage, duty_kW}', 'heaters');
    Qst[h.stage - 1] += h.duty_kW * KJH_PER_KW;
  }
  const totalCond = cond === 'total';
  const top = 0, bot = N - 1;
  // border unknowns
  const border = [];
  if (totalCond) border.push('sL');        // distillate / reflux ratio D/L0
  if (cond === 'partial') border.push('Qc');
  if (hasR) border.push('Qr');
  const G = border.length;

  // ------------------------------------------------------------- initial guess
  const est = p.estimates || {};
  const Tf = feeds.reduce((a, f) => a + f.T * f.F, 0) / Ftot;
  let D0;
  const specOf = (t) => specs.find((s) => s.type === t);
  if (num(est.D_kmol_h)) D0 = est.D_kmol_h;
  else if (specOf('distillate_rate')) D0 = specOf('distillate_rate').value;
  else if (specOf('bottoms_rate')) D0 = Ftot - specOf('bottoms_rate').value;
  else {
    // feed flash at the mean of its bubble and dew temperatures at the top pressure
    let vf = 0.5;
    try {
      const Pm = Pst[Math.floor(N / 2)];
      const tb = th.flashPVF(pp, zTot, Pm, 0).T, td = th.flashPVF(pp, zTot, Pm, 1).T;
      const r = th.flashPT(pp, zTot, 0.5 * (tb + td), Pm);
      vf = r.phase === 'V' ? 1 : r.phase === 'L' ? 0 : r.beta;
    } catch (_e) { vf = 0.5; }
    D0 = Ftot * Math.min(0.9, Math.max(0.1, vf));
    if (pp.electrolyte) {
      // acid-gas regenerator: the distillate is the stripped gas (components that
      // are volatile at the feed's bubble point) plus its water of saturation
      try {
        const rb = th.flashPVF(pp, zTot, Pst[Math.floor(N / 2)], 0);
        let light = 0;
        for (let i = 0; i < C; i++) if (!['H2O', 'MEA', 'K2CO3'].includes(pp.keys[i]) && (pp.keys[i] === 'CO2' || rb.y[i] / Math.max(zTot[i], 1e-30) > 1)) light += zTot[i] * Ftot;
        if (light > 0) D0 = Math.min(0.9 * Ftot, Math.max(0.005 * Ftot, 1.08 * light));
      } catch (_e) { /* keep the flash estimate */ }
    }
    // composition specs: sharp-split estimate around the spec's key component,
    // ordering components by K-value at the feed bubble point
    const cs = specs.find((s) => ['recovery', 'distillate_mole_frac', 'bottoms_mole_frac'].includes(s.type) && s.key in pp.index);
    if (cs) {
      let Kb;
      try {
        const Pm = Pst[Math.floor(N / 2)];
        const rb = th.flashPVF(pp, zTot, Pm, 0);
        Kb = rb.y.map((v, i) => v / Math.max(zTot[i], 1e-30));
      } catch (_e) { Kb = null; }
      if (Kb) {
        const ik = pp.index[cs.key], fk = zTot[ik] * Ftot;
        const lighter = zTot.reduce((a, z, i) => a + (i !== ik && Kb[i] > Kb[ik] ? z * Ftot : 0), 0);
        const heavier = Ftot - lighter - fk;
        const v = cs.value;
        let d;
        if (cs.type === 'recovery') d = cs.product === 'distillate' ? lighter + v * fk : lighter + (1 - v) * fk;
        else if (cs.type === 'distillate_mole_frac') d = v >= 0.5 ? lighter + 0.98 * fk : lighter / Math.max(1 - v, 1e-6);   // key purity / heavy-key impurity
        else d = v >= 0.5 ? Ftot - (heavier + 0.98 * fk) : Ftot - heavier / Math.max(1 - v, 1e-6);                         // key purity / light-key impurity
        if (d > 0.02 * Ftot && d < 0.98 * Ftot) D0 = d;
      }
    }
  }
  if (!hasC && !hasR) D0 = null;
  let R0 = num(est.reflux_ratio) ? est.reflux_ratio : specOf('reflux_ratio') ? specOf('reflux_ratio').value : (pp.electrolyte ? 1 : 2);
  if (specOf('reflux_rate') && D0) R0 = specOf('reflux_rate').value / D0;
  if (specOf('boilup_ratio') && D0 && !specOf('reflux_ratio')) {
    // V_N = boilup·B ; above-feed V = V_N (saturated-liquid feed) → R = V/D − 1
    const Vb = specOf('boilup_ratio').value * (Ftot - D0);
    R0 = Math.max(0.2, Vb / D0 - 1);
  }
  // flows (CMO)
  const L = new Array(N).fill(0), V = new Array(N).fill(0);
  const q = feeds.map((f) => 1 - (f.r.phase === 'V' ? 1 : f.r.phase === 'L' ? 0 : f.r.beta));
  if (hasC || hasR) {
    const D = D0;
    let Lr = R0 * D, Vr = Lr + D;
    if (cond === 'partial') { Lr = R0 * D; Vr = Lr + D; }
    for (let j = 0; j < N; j++) {
      // on-stage feeds: feed liquid leaves with the stage liquid, feed vapour
      // with the stage vapour (so vapour below the feed stage is reduced)
      let Lj = Lr, Vj = Vr;
      feeds.forEach((f, k) => { if (S.fs[k] <= j) Lj += q[k] * f.F; if (S.fs[k] < j) Vj -= (1 - q[k]) * f.F; });
      L[j] = Math.max(1e-3 * Ftot, Lj - UL.slice(0, j + 1).reduce((a, c) => a + c, 0));
      V[j] = Math.max(1e-3 * Ftot, Vj - UV.slice(j).reduce((a, c) => a + c, 0));
    }
    if (hasR) L[N - 1] = Math.max(1e-3 * Ftot, Ftot - D - UL.reduce((a, c) => a + c, 0) - UV.reduce((a, c) => a + c, 0));
    if (totalCond) V[0] = 1;                     // phantom normalisation
    if (cond === 'partial') V[0] = D;
  } else {
    // absorber: liquid from the top feed, gas from the bottom feed
    const Lin = feeds.reduce((a, f, k) => a + (S.fs[k] === 0 ? f.F : 0), 0) || 0.5 * Ftot;
    const Vin = feeds.reduce((a, f, k) => a + (S.fs[k] === N - 1 ? f.F : 0), 0) || 0.5 * Ftot;
    for (let j = 0; j < N; j++) { L[j] = Lin; V[j] = Vin; }
  }
  // product composition estimates by a smooth relative-volatility split
  const Pmid = Pst[Math.floor(N / 2)];
  // K-values for the split estimate from the feed's bubble point (an EOS
  // evaluated at x = y = z returns K = 1 where only one root exists)
  let Kf;
  try { const rb = th.flashPVF(pp, zTot, Pmid, 0); Kf = rb.y.map((v, i) => v / Math.max(zTot[i], 1e-30)); } catch (_e) { Kf = null; }
  if (!Kf) Kf = pp.comps.map((c) => c.Pc / Pmid * Math.exp(5.373 * (1 + c.omega) * (1 - c.Tc / Tf)));
  let xD = zTot.slice(), xB = zTot.slice();
  const lightSet = pp.electrolyte ? pp.keys.map((k) => !['H2O', 'MEA', 'K2CO3'].includes(k)) : null;
  if (pp.electrolyte && D0 && D0 > 0 && D0 < Ftot) {
    // acid-gas regenerator: CO2 and the dissolved gases go up with a little water
    const lightF = zTot.reduce((a, z, i) => a + (lightSet[i] ? z * Ftot : 0), 0);
    const iw = pp.index.H2O;
    const dI = zTot.map((z, i) => (lightSet[i] ? z * Ftot * Math.min(1, 0.92 * D0 / Math.max(lightF, 1e-30)) : 0));
    if (iw !== undefined) dI[iw] = Math.min(zTot[iw] * Ftot * 0.5, 0.08 * D0);
    const bI = zTot.map((z, i) => Math.max(z * Ftot - dI[i], 0));
    const sd = dI.reduce((a, c) => a + c, 0), sb = bI.reduce((a, c) => a + c, 0);
    if (sd > 0 && sb > 0) { xD = dI.map((v) => v / sd); xB = bI.map((v) => v / sb); }
  } else if (D0 && D0 > 0 && D0 < Ftot) {
    const lnK = Kf.map(Math.log);
    let lo = -50, hi = 50;
    const split = (c0) => lnK.map((v) => 1 / (1 + Math.exp(-(4 * v - c0))));
    for (let it = 0; it < 100; it++) { const m = 0.5 * (lo + hi); const d = split(m).reduce((a, s, i) => a + s * zTot[i] * Ftot, 0); if (d > D0) lo = m; else hi = m; }
    const sp = split(0.5 * (lo + hi));
    const dI = zTot.map((v, i) => v * Ftot * sp[i]), bI = zTot.map((v, i) => v * Ftot * (1 - sp[i]));
    const sd = dI.reduce((a, c) => a + c, 0), sb = bI.reduce((a, c) => a + c, 0);
    xD = dI.map((v) => v / sd); xB = bI.map((v) => v / sb);
  }
  // temperatures
  const safeT = (fn, fallback) => { try { const r = fn(); return num(r.T) ? r.T : fallback; } catch (_e) { return fallback; } };
  let Ttop, Tbot;
  if (hasC || hasR) {
    Ttop = num(est.T_top_K) ? est.T_top_K : safeT(() => th.flashPVF(pp, xD, Pst[0], cond === 'partial' ? 1 : 0), Tf - 20);
    Tbot = num(est.T_bottom_K) ? est.T_bottom_K : safeT(() => th.flashPVF(pp, xB, Pst[N - 1], 0), Tf + 20);
  } else {
    const tl = feeds.find((f, k) => S.fs[k] === 0), tv = feeds.find((f, k) => S.fs[k] === N - 1);
    Ttop = num(est.T_top_K) ? est.T_top_K : (tl ? tl.T : Tf);
    Tbot = num(est.T_bottom_K) ? est.T_bottom_K : (tv ? tv.T : Tf);
  }
  if (!(Tbot > Ttop - 1e-6) && (hasC || hasR)) { const t = Ttop; Ttop = Math.min(t, Tbot); Tbot = Math.max(t, Tbot) + 1; }
  const T = new Array(N);
  for (let j = 0; j < N; j++) T[j] = Ttop + (Tbot - Ttop) * j / Math.max(1, N - 1);
  // compositions
  let x = [], y = [];
  if (hasC || hasR) {
    for (let j = 0; j < N; j++) { const w = j / Math.max(1, N - 1); x.push(xD.map((v, i) => (1 - w) * v + w * xB[i])); }
  } else {
    const lf = feeds.find((f, k) => S.fs[k] === 0), vf = feeds.find((f, k) => S.fs[k] === N - 1);
    for (let j = 0; j < N; j++) x.push((lf ? lf.z : zTot).slice());
    y = Array.from({ length: N }, () => (vf ? vf.z : zTot).slice());
  }
  const kAt = (j, xx, yy) => pp.lnK(T[j], Pst[j], xx, yy).map(Math.exp);
  const bubble = (j, xx, Tg) => { try { return th.flashPVF(pp, xx, Pst[j], 0, Tg); } catch (_e) { return null; } };
  if (hasC || hasR) y = x.map((xx, j) => {
    const rb = bubble(j, xx, T[j]);
    if (rb) return rb.y;
    const K = pp.comps.map((c) => c.Pc / Pst[j] * Math.exp(5.373 * (1 + c.omega) * (1 - c.Tc / T[j])));
    const yy = xx.map((v, i) => v * K[i]); const s2 = yy.reduce((a, c) => a + c, 0); return yy.map((v) => v / s2);
  });

  // Start-up passes. Distillation: bubble-point method (component balances
  // by Thomas at constant-molal-overflow flows, bubble-point temperatures).
  // Absorber / stripper: sum-rates style passes (component balances, flows
  // summed from the solution).
  const sLfix = totalCond ? (specOf('reflux_ratio') ? 1 / specOf('reflux_ratio').value : 1 / Math.max(R0, 0.05)) : 0;
  const distil = hasC || hasR;
  const preIt = distil ? 10 : 8;
  const lsol = Array.from({ length: N }, () => new Array(C).fill(0));
  const vsol = Array.from({ length: N }, () => new Array(C).fill(0));
  // absorbers / strippers: K-values damped in log space and bounded (a chemical
  // solvent's CO2 K-value moves by decades with the loading), flows relaxed, and a
  // pass that blows the flows up is discarded (STEP 25)
  let Kprev = null;
  for (let pass = 0; pass < preIt; pass++) {
    let K = T.map((_, j) => kAt(j, x[j], y[j]));
    const saved = { x: x.map((r) => r.slice()), y: y.map((r) => r.slice()), L: L.slice(), V: V.slice(), T: T.slice() };
    if (!distil) {
      K = K.map((row) => row.map((k) => Math.min(1e10, Math.max(1e-10, num(k) ? k : 1))));
      if (Kprev) K = K.map((row, j) => row.map((k, i) => Math.exp(0.5 * Math.log(k) + 0.5 * Math.log(Kprev[j][i]))));
      Kprev = K;
    }
    for (let i = 0; i < C; i++) {
      // unknowns l_j; v_j = K (V/L) l  (total condenser: no vapour leaves stage 1)
      const a = new Array(N).fill(0), bb = new Array(N).fill(0), c = new Array(N).fill(0), d = new Array(N).fill(0);
      for (let j = 0; j < N; j++) {
        const Sv = (j === 0 && totalCond) ? 0 : K[j][i] * V[j] / L[j];
        const sl = (j === 0 && totalCond) ? sLfix : UL[j] / L[j];
        const sv = UV[j] / V[j];
        bb[j] = 1 + sl + Sv * (1 + sv);
        if (j > 0) a[j] = -1;
        if (j < N - 1) c[j] = -(K[j + 1][i] * V[j + 1] / L[j + 1]);
        d[j] = Fst[j][i];
      }
      for (let j = 1; j < N; j++) { const m = a[j] / bb[j - 1]; bb[j] -= m * c[j - 1]; d[j] -= m * d[j - 1]; }
      const l = new Array(N);
      l[N - 1] = d[N - 1] / bb[N - 1];
      for (let j = N - 2; j >= 0; j--) l[j] = (d[j] - c[j] * l[j + 1]) / bb[j];
      for (let j = 0; j < N; j++) {
        lsol[j][i] = Math.max(l[j], 1e-14 * Ftot);
        vsol[j][i] = (j === 0 && totalCond) ? 0 : Math.max(K[j][i] * V[j] / L[j] * l[j], 1e-14 * Ftot);
      }
    }
    for (let j = 0; j < N; j++) {
      const s = lsol[j].reduce((a2, v) => a2 + v, 0);
      x[j] = lsol[j].map((v) => v / s);
      if (distil) {
        const rb = bubble(j, x[j], T[j]);
        if (rb) { T[j] = pass < 2 ? rb.T : 0.5 * T[j] + 0.5 * rb.T; y[j] = rb.y; }
      } else {
        const sv2 = vsol[j].reduce((a2, v) => a2 + v, 0);
        y[j] = vsol[j].map((v) => v / sv2);
        L[j] = pass === 0 ? s : 0.5 * (L[j] + s); V[j] = pass === 0 ? sv2 : 0.5 * (V[j] + sv2);
      }
    }
    const bad = (v) => !num(v);
    if ((!distil && (L.some((v) => !(v < 20 * Ftot && v > 1e-6 * Ftot)) || V.some((v) => !(v < 20 * Ftot && v > 1e-6 * Ftot))))
      || T.some(bad) || x.some((r) => r.some(bad)) || y.some((r) => r.some(bad))) {
      // a pass that blows up (or yields NaN) is discarded and the passes stop
      for (let j = 0; j < N; j++) { x[j] = saved.x[j]; y[j] = saved.y[j]; L[j] = saved.L[j]; V[j] = saved.V[j]; T[j] = saved.T[j]; }
      break;
    }
  }

  // ------------------------------------------------------------- Newton
  // state vector per stage: [l_1..l_C, v_1..v_C, T]
  const X = [];
  for (let j = 0; j < N; j++) X.push(x[j].map((v) => v * L[j]).concat(y[j].map((v) => v * (j === 0 && totalCond ? 1 : V[j])), [T[j]]));
  const g = border.map((bn) => (bn === 'sL' ? sLfix : 0));
  const Hscale = Ftot * 2e4;                     // kJ/h
  const fScale = Ftot;
  const sumv = (arr, o) => { let s = 0; for (let i = 0; i < C; i++) s += arr[o + i]; return s; };
  // stage property evaluation from its own variables
  const props = (j, xj) => {
    const Lj = Math.max(sumv(xj, 0), 1e-30), Vj = Math.max(sumv(xj, C), 1e-30);
    const xx = new Array(C), yy = new Array(C);
    for (let i = 0; i < C; i++) { xx[i] = Math.max(xj[i], 0) / Lj; yy[i] = Math.max(xj[C + i], 0) / Vj; }
    const Tj = xj[2 * C];
    const K = pp.lnK(Tj, Pst[j], xx, yy).map(Math.exp);
    const hL = pp.hPhase(Tj, Pst[j], xx, 'L'), hV = pp.hPhase(Tj, Pst[j], yy, 'V');
    return { L: Lj, V: Vj, x: xx, y: yy, K, hL, hV, LH: Lj * hL, VH: Vj * hV };
  };
  const sLof = (gg) => (totalCond ? gg[border.indexOf('sL')] : 0);
  const QcOf = (gg) => (cond === 'partial' ? gg[border.indexOf('Qc')] : 0);
  const QrOf = (gg) => (hasR ? gg[border.indexOf('Qr')] : 0);
  // residuals of stage j given props of j−1, j, j+1
  const stageRes = (j, Xs, P, gg) => {
    const r = new Array(b);
    const xj = Xs[j], Pj = P[j];
    const sl = j === 0 && totalCond ? sLof(gg) : UL[j] / Math.max(Pj.L, 1e-30);
    const sv = UV[j] / Math.max(Pj.V, 1e-30);
    const phantom = j === 0 && totalCond;
    for (let i = 0; i < C; i++) {
      let m = (1 + sl) * xj[i] + (phantom ? 0 : (1 + sv) * xj[C + i]) - Fst[j][i];
      if (j > 0) m -= Xs[j - 1][i];
      if (j < N - 1) m -= Xs[j + 1][C + i];
      r[i] = m / fScale;
      const Ej = Emat[j][i];
      if (Ej >= 1) r[C + i] = Pj.K[i] * Pj.x[i] - Pj.y[i];
      else {
        // Murphree: y_j = y_in + E (K x_j − y_in), y_in = vapour from the stage below
        const yin = j < N - 1 ? P[j + 1].y[i] : yFeedV[j][i];
        r[C + i] = Ej * Pj.K[i] * Pj.x[i] + (1 - Ej) * yin - Pj.y[i];
      }
    }
    if (phantom) r[2 * C] = sumv(xj, C) - 1;
    else {
      let h = (1 + sl) * Pj.LH + (1 + sv) * Pj.VH - HFst[j] - Qst[j];
      if (j > 0) h -= P[j - 1].LH;
      if (j < N - 1) h -= P[j + 1].VH;
      if (j === 0 && cond === 'partial') h -= QcOf(gg) * KJH_PER_KW;
      if (j === N - 1 && hasR) h -= QrOf(gg) * KJH_PER_KW;
      r[2 * C] = h / Hscale;
    }
    return r;
  };
  // derived column quantities
  const products = (Xs, P, gg) => {
    const sl = sLof(gg);
    const Dv = totalCond ? Xs[0].slice(0, C).map((v) => v * sl) : (cond === 'partial' ? Xs[0].slice(C, 2 * C) : Xs[0].slice(C, 2 * C));
    const Bv = Xs[N - 1].slice(0, C);
    const Dt = Dv.reduce((a, c) => a + c, 0), Bt = Bv.reduce((a, c) => a + c, 0);
    let Qc = null;
    if (totalCond) Qc = ((1 + sl) * P[0].LH - P[1].VH) / KJH_PER_KW;
    else if (cond === 'partial') Qc = QcOf(gg);
    return { Dv, Bv, Dt, Bt, Qc, Qr: hasR ? QrOf(gg) : null, reflux: P[0].L, boilup: hasR ? P[N - 1].V : null };
  };
  let active = specs;
  const specRes = (Xs, P, gg) => active.map((s) => {
    const pr = products(Xs, P, gg);
    switch (s.type) {
      case 'reflux_ratio': return totalCond ? (sLof(gg) * s.value - 1) : (pr.reflux - s.value * pr.Dt) / fScale;
      case 'reflux_rate': return (pr.reflux - s.value) / fScale;
      case 'distillate_rate': return (pr.Dt - s.value) / fScale;
      case 'bottoms_rate': return (pr.Bt - s.value) / fScale;
      case 'boilup_ratio': return (pr.boilup - s.value * pr.Bt) / fScale;
      case 'boilup_rate': return (pr.boilup - s.value) / fScale;
      case 'condenser_duty': return (pr.Qc - s.value) * KJH_PER_KW / Hscale;
      case 'reboiler_duty': return (pr.Qr - s.value) * KJH_PER_KW / Hscale;
      case 'condenser_temperature': return (Xs[0][2 * C] - s.value) / 100;
      case 'distillate_mole_frac': { const i = pp.index[s.key]; if (i === undefined) fail('MB_COL_SPECS', `column: spec key '${s.key}' not in feed`, 'specs'); return pr.Dv[i] / Math.max(pr.Dt, 1e-30) - s.value; }
      case 'bottoms_mole_frac': { const i = pp.index[s.key]; if (i === undefined) fail('MB_COL_SPECS', `column: spec key '${s.key}' not in feed`, 'specs'); return pr.Bv[i] / Math.max(pr.Bt, 1e-30) - s.value; }
      case 'recovery': {
        const i = pp.index[s.key]; if (i === undefined) fail('MB_COL_SPECS', `column: spec key '${s.key}' not in feed`, 'specs');
        const fi = zTot[i] * Ftot; const v = (s.product === 'distillate' ? pr.Dv[i] : pr.Bv[i]) / fi; return v - s.value;
      }
      default: return 0;
    }
  });
  const allProps = (Xs) => Xs.map((xj, j) => props(j, xj));
  const norm2 = (P, Xs, gg) => {
    let s = 0;
    for (let j = 0; j < N; j++) for (const v of stageRes(j, Xs, P, gg)) s += v * v;
    for (const v of specRes(Xs, P, gg)) s += v * v;
    return Math.sqrt(s);
  };
  // initial border values: Qr / Qc from energy balances of the start profile
  {
    const P = allProps(X);
    if (hasR) {
      const j = N - 1;
      const h = (1 + 0) * P[j].LH + P[j].VH - HFst[j] - Qst[j] - (j > 0 ? P[j - 1].LH : 0);
      g[border.indexOf('Qr')] = h / KJH_PER_KW;
    }
    if (cond === 'partial') {
      const h = P[0].LH + P[0].VH - (N > 1 ? P[1].VH : 0) - HFst[0] - Qst[0];
      g[border.indexOf('Qc')] = h / KJH_PER_KW;
    }
  }
  const maxIt = Number.isInteger(p.max_iter) ? Math.min(p.max_iter, 200) : 80;
  const tol = num(p.tol) ? p.tol : 1e-9;
  let P = allProps(X);
  let res = norm2(P, X, g);
  let it = 0, converged = false, itTotal = 0, lastIssue = null;
  const history = [];
  const newton = (limit, factor) => {
  const accept = num(factor) ? factor : 5.0;
  converged = false;
  res = norm2(P, X, g);
  for (it = 0; it < limit; it++, itTotal++) {
    if (Date.now() - t0 > 7000) { warnings.push('column: stopped at the server time budget'); break; }
    if (res < tol) { converged = true; break; }
    // ---- Jacobian blocks
    const Dg = [], Sub = [], Sup = [], Rv = [];
    const dX = X.map((xj) => xj.map((v, k) => (k === 2 * C ? 1e-6 * Math.max(1, Math.abs(v)) : Math.max(1e-7 * Math.abs(v), 1e-10 * Ftot))));
    // derivatives of each stage's props w.r.t. its own variables
    const dP = [];
    for (let j = 0; j < N; j++) {
      const cols = [];
      for (let k = 0; k < b; k++) {
        const xp = X[j].slice(); xp[k] += dX[j][k];
        cols.push(props(j, xp));
      }
      dP.push(cols);
    }
    for (let j = 0; j < N; j++) {
      const r0 = stageRes(j, X, P, g);
      Rv.push(r0.map((v) => [-v]));
      const Dj = [], Sj = [], Uj = [];
      for (let a = 0; a < b; a++) { Dj.push(new Array(b).fill(0)); Sj.push(new Array(b).fill(0)); Uj.push(new Array(b).fill(0)); }
      // own block
      for (let k = 0; k < b; k++) {
        const Xp = X.slice(); Xp[j] = X[j].slice(); Xp[j][k] += dX[j][k];
        const Pp = P.slice(); Pp[j] = dP[j][k];
        const r1 = stageRes(j, Xp, Pp, g);
        for (let a = 0; a < b; a++) Dj[a][k] = (r1[a] - r0[a]) / dX[j][k];
      }
      // neighbours
      if (j > 0) for (let k = 0; k < b; k++) {
        const Xp = X.slice(); Xp[j - 1] = X[j - 1].slice(); Xp[j - 1][k] += dX[j - 1][k];
        const Pp = P.slice(); Pp[j - 1] = dP[j - 1][k];
        const r1 = stageRes(j, Xp, Pp, g);
        for (let a = 0; a < b; a++) Sj[a][k] = (r1[a] - r0[a]) / dX[j - 1][k];
      }
      if (j < N - 1) for (let k = 0; k < b; k++) {
        const Xp = X.slice(); Xp[j + 1] = X[j + 1].slice(); Xp[j + 1][k] += dX[j + 1][k];
        const Pp = P.slice(); Pp[j + 1] = dP[j + 1][k];
        const r1 = stageRes(j, Xp, Pp, g);
        for (let a = 0; a < b; a++) Uj[a][k] = (r1[a] - r0[a]) / dX[j + 1][k];
      }
      Dg.push(Dj); Sub.push(Sj); Sup.push(Uj);
    }
    // border columns: d stage-residual / d g
    const Bcol = border.map((_, q) => {
      const gp = g.slice(); const h = Math.max(1e-6 * Math.abs(g[q]), border[q] === 'sL' ? 1e-7 : 1e-4); gp[q] += h;
      return { h, cols: X.map((_, j) => { const r0 = Rv[j].map((v) => -v[0]); const r1 = stageRes(j, X, P, gp); return r1.map((v, a) => (v - r0[a]) / h); }) };
    });
    // spec rows: d spec / d X (stages 0, 1, N−2, N−1 only) and d spec / d g
    const s0 = specRes(X, P, g);
    const touch = [...new Set([0, 1, N - 2, N - 1].filter((j) => j >= 0 && j < N))];
    const Cx = active.map(() => X.map(() => new Array(b).fill(0)));
    for (const j of touch) for (let k = 0; k < b; k++) {
      const Xp = X.slice(); Xp[j] = X[j].slice(); Xp[j][k] += dX[j][k];
      const Pp = P.slice(); Pp[j] = dP[j][k];
      const s1 = specRes(Xp, Pp, g);
      for (let q = 0; q < active.length; q++) Cx[q][j][k] = (s1[q] - s0[q]) / dX[j][k];
    }
    const Dgg = active.map(() => new Array(G).fill(0));
    border.forEach((_, q2) => {
      const gp = g.slice(); gp[q2] += Bcol[q2].h;
      const s1 = specRes(X, P, gp);
      for (let q = 0; q < active.length; q++) Dgg[q][q2] = (s1[q] - s0[q]) / Bcol[q2].h;
    });
    // ---- solve bordered system
    const RHS = Rv.map((rj, j) => rj.map((row, a) => row.concat(Bcol.map((bc) => bc.cols[j][a]))));
    const Sol = blockThomas(Sub, Dg, Sup, RHS);
    if (!Sol) { lastIssue = 'singular Jacobian'; break; }
    const X1 = Sol.map((sj) => sj.map((row) => row[0]));
    let dg = [];
    if (G) {
      const X2 = Sol.map((sj) => sj.map((row) => row.slice(1)));       // per stage b × G
      const M = active.map((_, q) => border.map((__, q2) => {
        let s = Dgg[q][q2];
        for (const j of touch) for (let k = 0; k < b; k++) s -= Cx[q][j][k] * X2[j][k][q2];
        return s;
      }));
      const rhs = active.map((_, q) => {
        let s = -s0[q];
        for (const j of touch) for (let k = 0; k < b; k++) s -= Cx[q][j][k] * X1[j][k];
        return s;
      });
      const Fm = luFactor(M);
      if (!Fm) { lastIssue = 'specifications are not independent (singular)'; break; }
      dg = luSolve(Fm, rhs);
      for (let j = 0; j < N; j++) for (let k = 0; k < b; k++) for (let q = 0; q < G; q++) X1[j][k] -= X2[j][k][q] * dg[q];
    }
    // ---- step limiting + non-monotone line search
    // α keeps every flow positive (at most a 90 % cut per step) and every
    // temperature change ≤ 10 K; the step is accepted while the residual
    // stays below 5× the worst of the last five iterations (Grippo-style),
    // which lets Newton walk composition fronts through the column instead
    // of stalling on a monotone line search.
    let alpha = 1;
    for (let j = 0; j < N; j++) {
      const dT = X1[j][2 * C];
      if (Math.abs(dT) * alpha > 10) alpha = 10 / Math.abs(dT);
    }
    for (let q = 0; q < G; q++) if (border[q] === 'sL' && dg[q] < 0 && -dg[q] * alpha > 0.9 * g[q]) alpha = 0.9 * g[q] / -dg[q];
    const ref = Math.max(res, ...history.slice(-5));
    let accepted = false;
    for (let ls = 0; ls < 10; ls++) {
      const Xn = X.map((xj, j) => xj.map((v, k) => {
        const d = alpha * X1[j][k];
        let nv = v + d;
        // component flows: a large relative decrease is taken in log space
        // (v·e^(d/v)), so trace components can fall by decades without
        // forcing a tiny step on the whole column
        if (k < 2 * C && d < -0.5 * v) nv = Math.max(v * Math.exp(d / Math.max(v, 1e-300)), 1e-18 * Ftot);
        if (k === 2 * C) nv = Math.max(nv, 20);
        return nv;
      }));
      const gn = g.map((v, q) => {
        let nv = v + alpha * dg[q];
        if (border[q] === 'sL' && nv <= 0) nv = Math.max(v * 0.1, 1e-8);
        return nv;
      });
      let Pn;
      try { Pn = allProps(Xn); } catch (_e) { alpha *= 0.5; continue; }
      const rn = norm2(Pn, Xn, gn);
      if (isFinite(rn) && (rn < accept * (accept > 1 ? ref : res) * (accept > 1 ? 1 : 1 - 1e-4 * alpha) || rn < tol)) {
        for (let j = 0; j < N; j++) X[j] = Xn[j];
        for (let q = 0; q < G; q++) g[q] = gn[q];
        P = Pn; res = rn; accepted = true;
        break;
      }
      alpha *= 0.5;
    }
    history.push(res);
    if (!accepted) { lastIssue = 'line search failed'; break; }
  }
  if (!converged && res < 1e-7) converged = true;
  return converged;
  };
  // Composition and duty specifications: converge first with flow specs at
  // the start estimates (distillate rate D0, reflux ratio R0), then switch to
  // the requested specs from that profile. If Newton stalls on the requested
  // specs, an outer secant / Broyden search on those flow-spec values
  // (each inner column fully converged) meets them instead.
  // acid-gas regenerators: the reboiler duty is the natural specification (it sets
  // the stripping) and is kept from the start; the condenser temperature is reached
  // from a reflux-ratio start-up instead of a guessed distillate rate
  const hardT = ['distillate_mole_frac', 'bottoms_mole_frac', 'recovery', 'condenser_duty', 'condenser_temperature'].concat(pp.electrolyte ? [] : ['reboiler_duty']);
  let aux = null;
  if (specs.some((s) => hardT.includes(s.type)) && D0 > 0) {
    const used = new Set(specs.filter((s) => !hardT.includes(s.type)).map((s) => s.type));
    aux = specs.map((s) => {
      if (!hardT.includes(s.type)) return s;
      if (pp.electrolyte && hasC && !used.has('reflux_ratio') && !used.has('reflux_rate')) { used.add('reflux_ratio'); return { type: 'reflux_ratio', value: Math.max(R0, 0.2) }; }
      if (!used.has('distillate_rate') && !used.has('bottoms_rate')) { used.add('distillate_rate'); return { type: 'distillate_rate', value: D0 }; }
      if (hasC && !used.has('reflux_ratio') && !used.has('reflux_rate')) { used.add('reflux_ratio'); return { type: 'reflux_ratio', value: Math.max(R0, 0.2) }; }
      used.add('boilup_ratio'); return { type: 'boilup_ratio', value: 1.5 };
    });
    active = aux;
    const okAux = newton(Math.min(maxIt, 60), 5.0);
    if (!okAux) warnings.push('column: start-up profile (flow specifications) did not fully converge');
    const X0 = X.map((r) => r.slice()), g0 = g.slice();
    active = specs;
    if (!newton(Math.min(30, maxIt), 1.0) && okAux) {
      // outer search on the substituted flow-spec values (each inner column
      // fully converged with flow specs): bracketed secant/bisection for one
      // hard spec, Broyden for two
      for (let j = 0; j < N; j++) X[j] = X0[j].slice();
      for (let q = 0; q < G; q++) g[q] = g0[q];
      const idx = specs.map((s2, q) => (hardT.includes(s2.type) ? q : -1)).filter((q) => q >= 0);
      const lo = (q) => (aux[q].type === 'distillate_rate' ? 0.005 * Ftot : 0.05), hi = (q) => (aux[q].type === 'distillate_rate' ? 0.995 * Ftot : 200);
      let Xbest = null;
      const evalAt = (u) => {
        idx.forEach((q, k) => { aux[q] = { ...aux[q], value: Math.min(hi(q), Math.max(lo(q), u[k])) }; });
        active = aux;
        const ok = newton(40, 5.0);
        active = specs;
        const r = specRes(X, P, g);
        const f = idx.map((q) => r[q]);
        if (ok && (!Xbest || Math.max(...f.map(Math.abs)) < Xbest.err)) Xbest = { X: X.map((rr) => rr.slice()), g: g.slice(), err: Math.max(...f.map(Math.abs)), f: f.slice() };
        return { ok, f };
      };
      const m = idx.length;
      let done = false;
      if (m === 1) {
        const q = idx[0];
        let a = aux[q].value, fa = evalAt([a]).f[0];
        // bracket: expand away from the start in the downhill direction
        let step = 0.03 * Math.max(Math.abs(a), lo(q)), bpt = null, fb = null;
        for (let k = 0; k < 40 && Date.now() - t0 < 6500; k++) {
          const tryU = (dir) => { const u = Math.min(hi(q), Math.max(lo(q), a + dir * step)); return { u, f: evalAt([u]).f[0] }; };
          const up = tryU(1), dn = tryU(-1);
          if (Math.sign(up.f) !== Math.sign(fa)) { bpt = up.u; fb = up.f; break; }
          if (Math.sign(dn.f) !== Math.sign(fa)) { bpt = dn.u; fb = dn.f; break; }
          step *= 1.6;
          if (up.u >= hi(q) && dn.u <= lo(q)) break;
        }
        if (bpt === null && Xbest) {
          const s2 = specs[q];
          warnings.push(`column: ${s2.type.replace(/_/g, ' ')} ${s2.value}${s2.key ? ' (' + s2.key + ')' : ''} looks unreachable together with the other specification — closest value reached ${(s2.value + Xbest.f[0]).toPrecision(5)}`);
        }
        if (bpt !== null) {
          let x0 = a, f0 = fa, x1 = bpt, f1 = fb;
          for (let k = 0; k < 60 && Date.now() - t0 < 6800; k++) {
            let xm = x1 - f1 * (x1 - x0) / (f1 - f0);
            if (!(xm > Math.min(x0, x1) && xm < Math.max(x0, x1)) || k % 3 === 2) xm = 0.5 * (x0 + x1);
            const fm = evalAt([xm]).f[0];
            if (Math.abs(fm) < 1e-9) { done = true; break; }
            if (Math.sign(fm) === Math.sign(f0)) { x0 = xm; f0 = fm; } else { x1 = xm; f1 = fm; }
            if (Math.abs(x1 - x0) < 1e-10 * Math.max(1, Math.abs(x1))) { done = true; break; }
          }
        }
      } else {
        let u = idx.map((q) => aux[q].value);
        let e = evalAt(u);
        let J = [];
        for (let k = 0; k < m; k++) {
          const up = u.slice(); const h = Math.max(1e-3 * Math.abs(u[k]), 1e-4); up[k] += h;
          const ep = evalAt(up);
          J.push(ep.f.map((v, a2) => (v - e.f[a2]) / h));
        }
        J = J[0].map((_, a2) => J.map((row) => row[a2]));
        e = evalAt(u);
        for (let outer = 0; outer < 30 && Date.now() - t0 < 6500; outer++) {
          if (Math.max(...e.f.map(Math.abs)) < 1e-8) { done = true; break; }
          const Fm = luFactor(J);
          if (!Fm) break;
          let du = luSolve(Fm, e.f.map((v) => -v));
          du = du.map((d, k) => { const q = idx[k]; const lim = 0.3 * Math.max(Math.abs(u[k]), lo(q)); return Math.max(-lim, Math.min(lim, d)); });
          const un = u.map((v, k) => Math.min(hi(idx[k]), Math.max(lo(idx[k]), v + du[k])));
          const en = evalAt(un);
          const s1 = un.map((v, k) => v - u[k]), y1 = en.f.map((v, a2) => v - e.f[a2]);
          const ss = s1.reduce((acc, v) => acc + v * v, 0);
          if (ss > 0) for (let a2 = 0; a2 < m; a2++) { const Js = J[a2].reduce((acc, v, k) => acc + v * s1[k], 0); for (let k = 0; k < m; k++) J[a2][k] += (y1[a2] - Js) * s1[k] / ss; }
          u = un; e = en;
        }
      }
      if (Xbest) { for (let j = 0; j < N; j++) X[j] = Xbest.X[j].slice(); for (let q = 0; q < G; q++) g[q] = Xbest.g[q]; P = allProps(X); }
      if (!done) warnings.push('column: outer search on the substituted specifications did not fully converge');
      active = specs;
      if (!newton(25, 1.0)) newton(25, 5.0);
      if (!converged && Math.max(...specRes(X, P, g).map(Math.abs)) < 1e-6 && res < 1e-6) converged = true;
    }
  } else newton(maxIt, 5.0);
  it = itTotal;
  if (!converged && res < 1e-7) converged = true;
  if (!converged && lastIssue) warnings.push(`column: ${lastIssue}`);
  if (!converged) warnings.push(`column: Newton did not converge (residual ${res.toExponential(2)} after ${it} iterations) — check the specifications and estimates`);

  // ------------------------------------------------------------- outputs
  const pr = products(X, P, g);
  const outs = [];
  const mkLiquid = (Fl, xx, j) => units.streamOut(pp, Fl, xx, { T: P[j] ? X[j][2 * C] : T[j], P: Pst[j], beta: 0, x: xx, y: xx, phase: 'L' });
  const mkVapour = (Fv, yy, j) => units.streamOut(pp, Fv, yy, { T: X[j][2 * C], P: Pst[j], beta: 1, x: yy, y: yy, phase: 'V' });
  const normv = (v) => { const s = v.reduce((a, c) => a + c, 0); return s > 0 ? v.map((t) => t / s) : v.map(() => 1 / v.length); };
  if (totalCond) outs.push(mkLiquid(pr.Dt, normv(pr.Dv), 0));
  else outs.push(mkVapour(pr.Dt, normv(pr.Dv), 0));
  outs.push(mkLiquid(pr.Bt, normv(pr.Bv), N - 1));
  // side-draw outlets in the order given in params.side_draws (outlet 3, 4, …)
  const draws = [];
  for (const d of Array.isArray(p.side_draws) ? p.side_draws : []) {
    const j = d.stage - 1;
    if (d.phase === 'V') outs.push(mkVapour(d.rate_kmol_h, P[j].y, j)); else outs.push(mkLiquid(d.rate_kmol_h, P[j].x, j));
    draws.push({ stage: d.stage, phase: d.phase === 'V' ? 'V' : 'L', rate_kmol_h: d.rate_kmol_h, T_K: X[j][2 * C] });
  }
  const Hin = feeds.reduce((a, f) => a + f.H_kJh, 0);
  const Hout = outs.reduce((a, s) => a + s.H_kJh, 0);
  const Qtot = (pr.Qc || 0) + (pr.Qr || 0) + Qst.reduce((a, c) => a + c, 0) / KJH_PER_KW;
  const ebErr = (Hout - Hin) / KJH_PER_KW - Qtot;
  if (Math.abs(ebErr) > 1e-3 * Math.max(1, Math.abs(pr.Qc || 0) + Math.abs(pr.Qr || 0))) warnings.push(`column: overall energy balance off by ${ebErr.toFixed(3)} kW`);
  const profile = X.map((xj, j) => ({
    stage: j + 1, T_K: xj[2 * C], P_bar: Pst[j] / 1e5,
    L_kmol_h: j === 0 && totalCond ? P[0].L : P[j].L, V_kmol_h: j === 0 && totalCond ? 0 : P[j].V,
    x: Object.fromEntries(pp.keys.map((k, i) => [k, P[j].x[i]])),
    y: Object.fromEntries(pp.keys.map((k, i) => [k, P[j].y[i]])),
  }));
  const specVals = specRes(X, P, g);
  const details = {
    pp: { model: pp.model, label: pp.label },
    stages: N, condenser: cond, reboiler: S.reb,
    condenser_duty_kW: pr.Qc, reboiler_duty_kW: pr.Qr,
    duties: [hasC ? { name: 'condenser', kW: pr.Qc } : null, hasR ? { name: 'reboiler', kW: pr.Qr } : null,
      ...Qst.map((q, j) => (q ? { name: `stage ${j + 1} heater`, kW: q / KJH_PER_KW } : null))].filter(Boolean),
    reflux_ratio: pr.Dt > 0 ? pr.reflux / pr.Dt : null, boilup_ratio: hasR && pr.Bt > 0 ? pr.boilup / pr.Bt : null,
    distillate_kmol_h: pr.Dt, bottoms_kmol_h: pr.Bt,
    specs: specs.map((s, q) => ({ ...s, residual: specVals[q] })),
    efficiency: murphree ? { default: S.Est.slice(hasC ? 1 : 0, hasR ? N - 1 : N).every((e) => e === S.Est[hasC ? 1 : 0]) ? S.Est[hasC ? 1 : 0] : null,
      stages: S.Est, components: Object.keys(S.Ecomp).length ? S.Ecomp : undefined, basis: 'Murphree vapour' } : null,
    profile, side_draws: draws,
    iterations: it, residual: res, history, solver: 'Naphtali–Sandholm (Newton, block-tridiagonal)', ms: Date.now() - t0,
  };
  const mIn = feeds.reduce((a, f) => a + f.mass, 0);
  const mOut = outs.reduce((a, s) => a + s.mass_flow_kg_h, 0);
  return {
    streams_out: outs,
    mass_balance: { in: mIn, out: mOut, closure_pct: mIn > 0 ? 100 * (mOut - mIn) / mIn : 0 },
    energy_balance: { Hin, Hout, Q_kW: (Hout - Hin) / KJH_PER_KW, W_kW: 0 },
    details,
    converged,
    iterations: it,
    warnings: [...new Set(warnings)],
  };
}

export default { COLUMN_VERSION, solveColumn };
export { solveColumn };
