// ============================================================================
// REPO PATH: api/_lib/mb-ureathermo.js
// ============================================================================
// multicalci.com — STEP 34: rigorous urea-synthesis thermodynamics, the
// property method 'urea' (NH3–CO2–H2O–urea, with dissolved inert gases).
//
// Liquid: the UNIQUAC model of Voskov et al., "Thermodynamic model of the urea
// synthesis process", Ind. Eng. Chem. Res. (2016), fitted to bubble-point
// pressures and CO2-to-urea conversions at 135–230 °C, 3.5–45 MPa,
// L = N/C 2–5.5, W = (H2O − urea)/C −0.75…1.2. True liquid species:
//     1 NH3, 2 CO2, 3 H2O, 4 urea, 5 NH2COONH4 (ammonium carbamate),
//     6 NH4HCO3 (ammonium bicarbonate)
// with the chemical equilibria (true-species activities a = x γ, UNIQUAC z = 10)
//     I   2 NH3 + CO2 ⇌ urea + H2O      (slow — set by the urea reactor)
//     II  2 NH3 + CO2 ⇌ NH2COONH4        (fast — solved inside the method)
//     III NH3 + CO2 + H2O ⇌ NH4HCO3      (fast — solved inside the method)
// UNIQUAC r, q and a_ij = a_ij⁽⁰⁾ + a_ij⁽¹⁾T from the paper's Tables 3, 6, 7
// (τ_ij = exp(−a_ij/T)). Liquid standard states: NH3, CO2, H2O from the ideal
// gas through the Gibbs energy of vaporisation ΔvG = C₁ + C₂T + C₃T lnT
// (Table 4; for CO2 this is the Henry-type reference H*), urea and ammonium
// carbamate liquids from their ΔfH°, S° and Cp = a + e/√T (Table 2); ideal-gas
// NH3, CO2, H2O from the databank (NIST-JANAF). The bicarbonate constant, whose
// printed form (eq 31) could not be read reliably, was refitted here to the
// paper's own equilibrium-conversion table (Table 8, 126 points):
//     ln K_III = −13.7338 + 9172.17/T      (rms 0.06 % in conversion)
// With these, the method reproduces Table 8 to 0.06 % rms (0.25 % worst).
//
// VLE: f_i(liquid) = x_i γ_i p° exp(−ΔvG_i/RT) exp(V_i(P − P_ref)/RT) for the
// volatile true species (V_i from Table 4; P_ref = p° for NH3 and H2O, the
// water saturation pressure for CO2), urea and the salts non-volatile; the
// vapour is Peng–Robinson (the paper's virial equation is not published in
// full) with k_ij(NH3–CO2) = 0.10, fitted here to the paper's bubble-point
// table (Table 9): 4.8 % rms, 10 % worst (at 200 °C). Inert gases (N2, H2, O2,
// Ar, CH4, CO) dissolve by Henry's law in water.
//
// Enthalpy and entropy follow from the same fugacities (Gibbs–Helmholtz at
// fixed apparent composition), so the heats of carbamate formation,
// decomposition and urea formation are those of the fitted equilibria.
//
// Apparent components seen by flashes, columns and units: NH3, CO2, H2O, urea
// (+ inert gases). Plain ES module. Server-side only. (c) multicalci.com
// ============================================================================

import compdb from './mb-compdb.js';

export const UREA_THERMO_VERSION = 'mb-ureathermo 1.0.0';
export const UREA_MODEL_LABEL = 'Urea synthesis — NH₃–CO₂–H₂O–urea (UNIQUAC, carbamate equilibria; Voskov et al. 2016)';

const R = 8.314462618, T0 = 298.15, P0 = 101325;
const num = (x) => typeof x === 'number' && isFinite(x);

// ---------------------------------------------------------------------------
// urea as an apparent (non-volatile) component of the rigorous databank. Only
// the urea method uses it; its liquid properties come from the model below.
// Ideal-gas fields: urea(g) ΔfH° −235.5 kJ/mol (NIST), placeholders otherwise.
// ---------------------------------------------------------------------------
const UREA_REC = {
  name: 'Urea', cas: '57-13-6', formula: 'CH4N2O', family: 0,
  mw: 60.0553, tc: 705, pc: 9.05e6, vc: 0.218, zc: 0.336, w: 0.5, tb: 465, tm: 405.85,
  hf: -235.5e6, gf: -152.7e6, s0: 276.0e3,
  cpig: [1, 93.0e3, 0, 0, 0, 0, 50, 3000],
  psat: [10, -46.0, 0, 0, 0, 0, 200, 2000],            // non-volatile
  cat: 'fertilizer', ureaModel: true,
};
if (compdb && compdb.COMPS && !compdb.COMPS.urea) compdb.COMPS.urea = UREA_REC;
export const UREA_KEYS = ['urea'];
/** apparent components the liquid model owns */
export const UREA_OWNED = ['NH3', 'CO2', 'H2O', 'urea'];
/** inert gases allowed (Henry's law in water) */
export const UREA_INERTS = ['N2', 'H2', 'O2', 'Ar', 'CH4', 'CO', 'He'];

// ---------------------------------------------------------------------------
// model parameters (Voskov et al. 2016)
// ---------------------------------------------------------------------------
const NS = 6;
const RQ = [[1.4397, 2.0918], [5.7410, 6.0806], [0.92, 1.40], [2.1408, 2.4860], [9.1911, 9.7386], [12.8910, 13.2834]];
const A0 = { '12': 159.8, '13': 3214.6, '14': 1664.2, '15': -826.39, '16': 1288, '21': -304.9, '24': 441.25, '31': -874.62, '32': 63.393,
  '35': 290.6, '41': -560.18, '43': -211.96, '46': 733.43, '53': 538.17, '54': 59.254, '61': -266.32, '64': 657.62, '65': -374.31 };
const A1 = { '13': -4.3216, '15': 2.7073, '31': 0.91464, '35': -1.2096, '41': 0.380, '46': -2.215, '63': 1.3333, '65': 1.1849 };
const AIJ0 = [], AIJ1 = [];
for (let i = 0; i < NS; i++) { AIJ0.push([]); AIJ1.push([]); for (let j = 0; j < NS; j++) { const k = '' + (i + 1) + (j + 1); AIJ0[i].push(A0[k] || 0); AIJ1[i].push(A1[k] || 0); } }
const VOL = ['NH3', 'CO2', 'H2O'];
/** Gibbs energy of vaporisation ΔvG(T) = C1 + C2 T + C3 T ln T [J/mol] (Table 4) */
const CE = { NH3: [38258.1, -471.14, 56.995], CO2: [60904.5, -1040.41, 135.971], H2O: [56781, -404.71, 42.66] };
/** liquid molar volume V = C1 + 1e-2 C2 T + 1e-5 C3 T² [cm³/mol] (Table 4) */
const CV = { NH3: [-0.50, 9.54, 0], CO2: [45.6, 0, 0], H2O: [21.89, -3.101, 5.981] };
/** urea and ammonium carbamate liquids: ΔfH°(298.15) [J/mol], S° [J/(mol K)], Cp = a + e/√T (Table 2) */
const LIQ = { urea: [-321827, 130.0, 287.59, -2763.3], carb: [-624323, 180.3, 346.37, -3137.5] };
/** bicarbonate equilibrium (liquid basis), refitted to Table 8 (see header) */
const K3 = [-13.733808748415818, 9172.172249669391];
/** molar volumes of the salts and urea in the liquid [m³/mol] (density only) */
const V_SALT = { urea: 48e-6, carb: 60e-6, bic: 55e-6 };

const dvG = (k, T) => CE[k][0] + CE[k][1] * T + CE[k][2] * T * Math.log(T);
const dvH = (k, T) => CE[k][0] - CE[k][2] * T;                                   // −T² ∂(ΔvG/T)/∂T
const Vm = (k, T) => (CV[k][0] + CV[k][1] * 1e-2 * T + CV[k][2] * 1e-5 * T * T) * 1e-6;
function liqHG(s, T) {
  const [H, S, a, e] = LIQ[s];
  const dH = a * (T - T0) + 2 * e * (Math.sqrt(T) - Math.sqrt(T0));
  const dS = a * Math.log(T / T0) - 2 * e * (1 / Math.sqrt(T) - 1 / Math.sqrt(T0));
  return { H: H + dH, S: S + dS, G: H + dH - T * (S + dS) };
}

/** UNIQUAC ln γ of the six true species */
export function lnGammaTrue(x, T) {
  const z = 10;
  let sr = 0, sq = 0;
  for (let i = 0; i < NS; i++) { sr += x[i] * RQ[i][0]; sq += x[i] * RQ[i][1]; }
  const th = new Array(NS), l = new Array(NS);
  let sxl = 0;
  for (let i = 0; i < NS; i++) { th[i] = x[i] * RQ[i][1] / sq; l[i] = z / 2 * (RQ[i][0] - RQ[i][1]) - (RQ[i][0] - 1); sxl += x[i] * l[i]; }
  const tau = [];
  for (let i = 0; i < NS; i++) { tau.push(new Array(NS)); for (let j = 0; j < NS; j++) tau[i][j] = i === j ? 1 : Math.exp(-(AIJ0[i][j] + AIJ1[i][j] * T) / T); }
  const s = new Array(NS);
  for (let i = 0; i < NS; i++) { let v = 0; for (let j = 0; j < NS; j++) v += th[j] * tau[j][i]; s[i] = v; }
  const out = new Array(NS);
  for (let i = 0; i < NS; i++) {
    const r = RQ[i][0], q = RQ[i][1];
    const c = Math.log(r / sr) + z / 2 * q * Math.log((q / sq) / (r / sr)) + l[i] - r / sr * sxl;
    let t2 = 0; for (let j = 0; j < NS; j++) t2 += th[j] * tau[i][j] / s[j];
    out[i] = c + q * (1 - Math.log(s[i]) - t2);
  }
  return out;
}

/** ln K of reactions I, II, III at T (liquid standard states at p°) */
export function lnKs(T, Gig) {
  const G1 = Gig('NH3', T) - dvG('NH3', T), G2 = Gig('CO2', T) - dvG('CO2', T), G3 = Gig('H2O', T) - dvG('H2O', T);
  const G4 = liqHG('urea', T).G, G5 = liqHG('carb', T).G;
  return [-(G4 + G3 - 2 * G1 - G2) / (R * T), -(G5 - 2 * G1 - G2) / (R * T), K3[0] + K3[1] / T];
}

/** small dense Newton solve (n ≤ 3) */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/**
 * Fast equilibria II and III for apparent moles {N, C, W, U} (NH3, CO2, H2O,
 * urea) at T. Newton on the extents of the active reactions, each accepted step
 * folded into the base composition (a species driven to 1e-12 of the liquid is
 * carried as its own small number), with a fraction-to-boundary step limit.
 * Returns true mole numbers n[0..5], true mole fractions x and ln γ.
 */
const NU = [[-2, -1, 0, 0, 1, 0], [-1, -1, -1, 0, 0, 1]];
export function speciate(app, T, Gig, guess) {
  const r = speciateNewton(app, T, Gig, guess);
  if (r.nrm <= 1e-10 || !(app.N > 0) || !(app.C > 0)) return r;
  // restarts from other carbamate extents, then a nested bisection (always converges: each
  // residual runs from −∞ to +∞ across its extent's range), polished by Newton
  let best = r;
  for (const f2 of [0.5, 0.99, 0.2, 0.02]) {
    const { N, C, W, U } = app;
    const x2 = f2 * Math.min(N / 2, C), x3 = W > 1e-14 * (N + C + W + U) ? 0.05 * Math.min(N - 2 * x2, C - x2, W) : 0;
    const g = [N - 2 * x2 - x3, C - x2 - x3, W - x3, U, x2, x3];
    const r2 = speciateNewton(app, T, Gig, g);
    if (r2.nrm < best.nrm) best = r2;
    if (best.nrm <= 1e-10) return best;
  }
  const nb = bisectSpeciation(app, T, Gig);
  if (nb) { const r3 = speciateNewton(app, T, Gig, nb); if (r3.nrm < best.nrm) best = r3; }
  return best;
}

/** nested bisection on the extents of reactions II (inner) and III (outer) */
function bisectSpeciation(app, T, Gig) {
  const { N, C, W, U } = app;
  const lnK = lnKs(T, Gig);
  const la = (n) => {
    const S = n.reduce((a, b) => a + b, 0), x = n.map((v) => Math.max(v / S, 1e-300));
    const lg = lnGammaTrue(x, T);
    return x.map((v, i) => Math.log(v) + lg[i]);
  };
  const comp = (x2, x3) => [N - 2 * x2 - x3, C - x2 - x3, W - x3, U, x2, x3];
  const inner = (x3) => {
    const hi = Math.min((N - x3) / 2, C - x3);
    if (!(hi > 0)) return null;
    let a = 0, b = 1;
    for (let k = 0; k < 64; k++) {
      const t = 0.5 * (a + b), n = comp(t * hi, x3);
      const l = la(n);
      if (l[4] - 2 * l[0] - l[1] - lnK[1] < 0) a = t; else b = t;
    }
    return 0.5 * (a + b) * hi;
  };
  const tot = N + C + W + U;
  if (!(W > 1e-14 * tot)) { const x2 = inner(0); return x2 === null ? null : comp(x2, 0); }
  const h3 = Math.min(N, C, W);
  let a = 0, b = 1, x2 = 0;
  for (let k = 0; k < 60; k++) {
    const t = 0.5 * (a + b), x3 = t * h3;
    x2 = inner(x3);
    if (x2 === null) { b = t; continue; }
    const l = la(comp(x2, x3));
    if (l[5] - l[0] - l[1] - l[2] - lnK[2] < 0) a = t; else b = t;
  }
  const x3 = 0.5 * (a + b) * h3;
  x2 = inner(x3);
  if (x2 === null) return null;
  const n = comp(x2, x3);
  return n.every((v, i) => v > 0 || (i === 3 && U === 0)) ? n : null;
}

function speciateNewton(app, T, Gig, guess) {
  const { N, C, W, U } = app;
  const lnK = lnKs(T, Gig);
  const tot = N + C + W + U;
  const fin = (n) => { const S = n.reduce((a, b) => a + b, 0), x = n.map((v) => v / S); return { n, x, lg: lnGammaTrue(x, T) }; };
  if (!(N > 0) || !(C > 0)) return Object.assign(fin([N, C, W, U, 0, 0]), { lnK, it: 0, nrm: 0 });
  const act = W > 1e-14 * tot ? [0, 1] : [0];
  // start: the given base (warm start) or carbamate of the limiting reagent nearly complete
  let n;
  if (guess && guess.length === 6 && Math.abs(guess[0] + 2 * guess[4] + guess[5] - N) < 1e-9 * tot && Math.abs(guess[1] + guess[4] + guess[5] - C) < 1e-9 * tot
    && Math.abs(guess[2] + guess[5] - W) < 1e-9 * tot && guess.every((v, i) => v > 0 || (i === 5 && act.length === 1) || (i === 3 && U === 0) || (i === 2 && W === 0))) n = guess.slice();
  else {
    const xi2 = 0.9 * Math.min(N / 2, C), xi3 = act.length > 1 ? 0.05 * Math.min(N - 2 * xi2, C - xi2, W) : 0;
    n = [N - 2 * xi2 - xi3, C - xi2 - xi3, W - xi3, U, xi2, xi3];
  }
  const F = (nn) => {
    const S = nn.reduce((a, b) => a + b, 0), x = nn.map((v) => v / S);
    const lg = lnGammaTrue(x.map((v) => Math.max(v, 1e-300)), T);
    const la = x.map((v, i) => Math.log(Math.max(v, 1e-300)) + lg[i]);
    return act.map((r) => (r === 0 ? la[4] - 2 * la[0] - la[1] - lnK[1] : la[5] - la[0] - la[1] - la[2] - lnK[2]));
  };
  const move = (nn, d) => { const m = nn.slice(); act.forEach((r, q) => { for (let i = 0; i < 6; i++) if (NU[r][i]) m[i] += NU[r][i] * d[q]; }); return m; };
  let f = F(n), it = 0, nrm = Math.max(...f.map(Math.abs));
  for (; it < 100 && nrm > 1e-12; it++) {
    // Jacobian by extents: step proportional to the smallest species the reaction touches
    const J = act.map(() => new Array(act.length).fill(0));
    for (let q = 0; q < act.length; q++) {
      let mn = Infinity; for (let i = 0; i < 6; i++) if (NU[act[q]][i] && n[i] > 0) mn = Math.min(mn, n[i]);
      const h = 1e-6 * mn, d = act.map((_, k) => (k === q ? h : 0));
      const f2 = F(move(n, d));
      for (let r = 0; r < act.length; r++) J[r][q] = (f2[r] - f[r]) / h;
    }
    const dx = solve(J, f.map((v) => -v));
    if (!dx || !dx.every(Number.isFinite)) break;
    // fraction to the boundary
    let amax = 1;
    for (let i = 0; i < 6; i++) { let dn = 0; act.forEach((r, q) => { dn += NU[r][i] * dx[q]; }); if (dn < 0 && n[i] > 0) amax = Math.min(amax, -0.95 * n[i] / dn); }
    let a = amax, moved = false;
    for (let ls = 0; ls < 50; ls++) {
      const n2 = move(n, dx.map((v) => a * v));
      if (n2.every((v, i) => v >= 0 && (v > 0 || n[i] === 0))) {
        const f2 = F(n2), m2 = Math.max(...f2.map(Math.abs));
        if (m2 < nrm * (1 - 1e-4 * a) || m2 < 1e-12) { n = n2; f = f2; nrm = m2; moved = true; break; }
      }
      a *= 0.5;
    }
    if (!moved) break;
  }
  return Object.assign(fin(n), { lnK, it, nrm, base: n });
}

/**
 * The liquid model of the 'urea' property method for a component list.
 * @param {string[]} keys package keys
 * @param {{Gig:(key,T)=>number, psatW:(T)=>number, hig:(i,T)=>number, sig:(i,T)=>number}} dep
 */
export function makeUreaLiquid(keys, dep) {
  const idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const owned = keys.map((k, i) => (UREA_OWNED.includes(k) ? i : -1)).filter((i) => i >= 0);
  const Gig = dep.Gig;
  let cacheKey = null, cacheVal = null;
  const appOf = (x) => ({ N: idx.NH3 !== undefined ? x[idx.NH3] : 0, C: idx.CO2 !== undefined ? x[idx.CO2] : 0, W: idx.H2O !== undefined ? x[idx.H2O] : 0, U: idx.urea !== undefined ? x[idx.urea] : 0 });
  const lastU = new Map();
  let lastFrac = null;
  function spec(T, x) {
    const a = appOf(x);
    const key = T.toFixed(9) + '|' + [a.N, a.C, a.W, a.U].map((v) => v.toPrecision(14)).join(',');
    if (key === cacheKey) return cacheVal;
    const gk = [a.N, a.C, a.W, a.U].map((v) => v.toPrecision(3)).join(',');
    // warm start: the extents of the last solution, as fractions of what this composition allows
    let s = null;
    if (lastFrac && a.N > 0 && a.C > 0) {
      const x2 = lastFrac[0] * Math.min(a.N / 2, a.C);
      const x3 = a.W > 1e-14 * (a.N + a.C + a.W + a.U) ? lastFrac[1] * Math.min(a.N - 2 * x2, a.C - x2, a.W) : 0;
      const g = [a.N - 2 * x2 - x3, a.C - x2 - x3, a.W - x3, a.U, x2, x3];
      if (g[0] > 0 && g[1] > 0 && x2 > 0) { const s1 = speciate(a, T, Gig, g); if (s1.nrm <= 1e-10) s = s1; }
    }
    if (!s) {
      s = speciate(a, T, Gig, null);
      if (s.nrm > 1e-9) { const w = lastU.get(gk); if (w) { const s2 = speciate(a, T, Gig, w); if (s2.nrm < s.nrm) s = s2; } }
    }
    if (s.base) {
      lastU.set(gk, s.base); if (lastU.size > 400) lastU.delete(lastU.keys().next().value);
      const b = s.base, m2 = Math.min(a.N / 2, a.C);
      if (s.nrm <= 1e-10 && m2 > 0 && b[4] > 0) {
        const f2 = b[4] / m2, r3 = Math.min(a.N - 2 * b[4], a.C - b[4], a.W);
        lastFrac = [Math.min(f2, 1 - 1e-9), r3 > 0 ? Math.min(b[5] / r3, 1 - 1e-9) : 0];
      }
    }
    cacheKey = key; cacheVal = s;
    return s;
  }
  /** reference liquid fugacity of a volatile true species [Pa] at T, P */
  function lnfRef(k, T, P) {
    const Pref = k === 'CO2' ? Math.min(dep.psatW(Math.min(T, 647)), P) : P0;
    return Math.log(P0) - dvG(k, T) / (R * T) + Vm(k, T) * (P - Pref) / (R * T);
  }
  const TRUE_POS = { NH3: 0, CO2: 1, H2O: 2, urea: 3 };
  /** ln f_i [Pa] of the owned apparent components (volatile ones; urea: ln activity) */
  function lnf(T, P, x) {
    const s = spec(T, x), out = {};
    for (const k of VOL) if (idx[k] !== undefined) {
      const p = TRUE_POS[k];
      out[k] = Math.log(Math.max(s.x[p], 1e-300)) + s.lg[p] + lnfRef(k, T, P);
    }
    out.urea = Math.log(Math.max(s.x[3], 1e-300)) + s.lg[3];
    // dissolved inert gases dilute the liquid the model describes
    const xs = owned.reduce((q, i) => q + x[i], 0);
    if (xs > 0 && xs < 1) for (const k of Object.keys(out)) out[k] += Math.log(xs);
    // apparent moles per true mole (speciation removes moles)
    const nApp = Object.values(appOf(x)).reduce((q, v) => q + v, 0), nTrue = s.n.reduce((q, v) => q + v, 0);
    out._ratio = nTrue / Math.max(nApp, 1e-300);
    out._s = s;
    return out;
  }
  return {
    model: 'urea', owned, keys,
    /** ln φ_i = ln f_i − ln(x_i P) of the owned apparent components (urea non-volatile: 50) */
    lnPhiL(T, P, x) {
      const f = lnf(T, P, x);
      return keys.map((k, i) => (VOL.includes(k) ? f[k] - Math.log(Math.max(x[i], 1e-300) * P) : k === 'urea' ? -50 : null));
    },
    /** partial molar h, s of the owned apparent components (Gibbs–Helmholtz on ln f at fixed apparent x) */
    partials(T, P, x) {
      const dT = 0.02;
      const fa = lnf(T + dT, P, x), fb = lnf(T - dT, P, x), f0 = lnf(T, P, x);
      const out = {};
      for (const k of VOL) if (idx[k] !== undefined) {
        const i = idx[k];
        const dlnf = (fa[k] - fb[k]) / (2 * dT);
        const hg = dep.hig(i, T);
        const h = hg - R * T * T * dlnf;
        const mu = Gig(k, T) + R * T * (f0[k] - Math.log(P0));
        out[i] = { h, s: (h - mu) / T, mu };
      }
      if (idx.urea !== undefined) {
        const ref = liqHG('urea', T);
        const dlna = (fa.urea - fb.urea) / (2 * dT);
        const h = ref.H - R * T * T * dlna;
        const mu = ref.G + R * T * f0.urea;
        out[idx.urea] = { h, s: (h - mu) / T, mu };
      }
      return out;
    },
    /** liquid molar volume per apparent mole [m³/mol] (owned part; Henry gases added by the caller) */
    volume(T, x) {
      const s = spec(T, x), n = s.n;
      const v = n[0] * Vm('NH3', T) + n[1] * Vm('CO2', T) + n[2] * Vm('H2O', T) + n[3] * V_SALT.urea + n[4] * V_SALT.carb + n[5] * V_SALT.bic;
      const nApp = Object.values(appOf(x)).reduce((q, w) => q + w, 0);
      return nApp > 0 ? v / nApp * (owned.reduce((q, i) => q + x[i], 0)) : 35e-6;
    },
    /** ln activity of urea (for the flash's Gibbs-energy comparison) */
    ureaLnAct(T, x) { const s = spec(T, x); return Math.log(Math.max(s.x[3], 1e-300)) + s.lg[3]; },
    /** speciation report for the stream properties */
    report(T, x) {
      const a = appOf(x), s = spec(T, x);
      const C0 = a.C + a.U, N0 = a.N + 2 * a.U, W0 = a.W - a.U;
      const S = s.n.reduce((q, v) => q + v, 0);
      return { L_NH3_CO2: C0 > 0 ? N0 / C0 : null, W_H2O_CO2: C0 > 0 ? W0 / C0 : null, urea_conversion: C0 > 0 ? a.U / C0 : null,
        x_true: { NH3: s.n[0] / S, CO2: s.n[1] / S, H2O: s.n[2] / S, urea: s.n[3] / S, carbamate: s.n[4] / S, bicarbonate: s.n[5] / S },
        carbamate_fraction_of_CO2: a.C > 0 ? s.n[4] / a.C : null };
    },
    /** range note (the fitted range of the published model) */
    warn(T, x) {
      const a = appOf(x), C0 = a.C + a.U;
      if (!(C0 > 1e-6 * (a.N + a.C + a.W + a.U))) return null;
      const L = (a.N + 2 * a.U) / C0, W = (a.W - a.U) / C0;
      const out = [];
      if (T < 408.15 || T > 503.15) out.push(`T ${(T - 273.15).toFixed(0)} °C`);
      if (L < 2 || L > 5.5) out.push(`N/C ${L.toFixed(2)}`);
      if (W < -0.75 || W > 1.2) out.push(`H₂O/C ${W.toFixed(2)}`);
      return out.length ? `urea method outside its fitted range (135–230 °C, N/C 2–5.5, H₂O/C −0.75 to 1.2): ${out.join(', ')}` : null;
    },
    /** equilibrium of reaction I in this liquid: residual ln Q − ln K_I (true-species activities) */
    ureaResidual(T, x) {
      const s = spec(T, x);
      const la = s.x.map((v, i) => Math.log(Math.max(v, 1e-300)) + s.lg[i]);
      return la[2] + la[3] - 2 * la[0] - la[1] - s.lnK[0];
    },
    speciation: spec,
  };
}

export default { UREA_THERMO_VERSION, UREA_MODEL_LABEL, UREA_KEYS, UREA_OWNED, UREA_INERTS, makeUreaLiquid, speciate, lnKs, lnGammaTrue };
