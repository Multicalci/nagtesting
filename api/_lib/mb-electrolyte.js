// ============================================================================
// REPO PATH: api/_lib/mb-electrolyte.js
// ============================================================================
// multicalci.com — STEP 25 acid-gas (CO2) electrolyte property packages for
// absorbers and strippers. Used by mb-thermo.createPackage for the models
//
//   'amine-mea'  aqueous monoethanolamine. Chemical-equilibrium (ideal,
//                molarity basis) model of Akula et al. (2021) as published in
//                the open-source IDAES process modelling framework
//                (idaes/models_extra/column_models/properties/MEA_solvent.py):
//                  2 MEA + CO2 ⇌ MEAH+ + MEACOO−   ln K = 233.4 − 3410/T − 36.8 ln T
//                  MEA + CO2 + H2O ⇌ MEAH+ + HCO3−  ln K = 176.72 − 2909/T − 28.46 ln T
//                (K in L/mol, molarities from the apparent molar volume of
//                Weiland / Morgan et al.), CO2 by Henry's law on the free
//                molecular CO2 with the N2O analogy of Jiru et al. (2012),
//                water and MEA by Raoult's law on true mole fractions with the
//                IDAES vapour-pressure equations.
//   'hot-k2co3'  hot potassium carbonate (Benfield-type solutions, without
//                promoter chemistry). Pitzer (Harvie–Møller–Weare) electrolyte
//                model with the parameters and equilibrium constants of the
//                USGS PHREEQC pitzer.dat database: species K+, CO3−−, HCO3−,
//                CO2(aq), OH−, H+, water activity from the osmotic coefficient,
//                unsymmetrical mixing (Eθ), CO2(g) solubility constant.
//                The pitzer.dat KHCO3 parameters turn the strong, highly
//                converted solution unstable (spurious liquid split) near KHCO3
//                crystallisation; past 95 % of that mapped onset the properties
//                are held on the boundary and continued smoothly (flagged).
//   'amine-mdea' aqueous N-methyldiethanolamine (Step 27). Extended UNIQUAC
//                model of Sadegh (DTU PhD thesis 2013): true species H2O,
//                CO2, MDEA, MDEAH+, H+, OH−, HCO3−, CO3−−, UNIQUAC + Debye–
//                Hückel activity coefficients, equilibrium constants from the
//                fitted standard-state properties, CO2 Henry constant of Rumpf &
//                Maurer (1993). Reproduces the thesis's own model results.
//                Step 28: piperazine (activated MDEA) — PZ, PZH+, PZCOO−,
//                H+PZCOO−, PZ(COO)2−− added (13 true species); their parameters
//                by analogy to the Sadegh species plus a regression (multicalci)
//                of water interactions and carbamate equilibria to measured CO2
//                pressures (Chen 2011, Xu 2011). MDEA without PZ is unchanged.
//
// Apparent components: H2O, CO2 and the solvent (MEA, MDEA or K2CO3; piperazine with MDEA). Other gases
// dissolve by Henry's law (handled in mb-thermo). The liquid fugacities of the
// apparent components come from the speciation, so the flash routines and the
// rigorous column work unchanged. Enthalpy and entropy follow from the same
// fugacities by Gibbs–Helmholtz (h̄ᵢ = hᵢ,ig − RT² ∂ln fᵢ/∂T at fixed apparent
// composition), so heats of absorption are consistent with the solubility
// model's temperature dependence; solvents carry the ChemSep (DIPPR) heat of
// vaporisation for the pure-liquid part.
//
// Units inside: T K, P Pa, energies J/mol. Plain ES module. Server-side only.
// (c) multicalci.com
// ============================================================================

import compdb from './mb-compdb.js';

export const ELECTROLYTE_VERSION = 'mb-electrolyte 1.3.0';
export const ELECTROLYTE_MODELS = {
  'amine-mea': 'Aqueous MEA — CO₂ chemical equilibrium (Akula et al. / IDAES)',
  'amine-mdea': 'Aqueous MDEA / activated MDEA — CO₂ Extended UNIQUAC (Sadegh 2013, DTU; piperazine species fitted)',
  'hot-k2co3': 'Hot potassium carbonate — CO₂ Pitzer electrolyte (PHREEQC data)',
};

const R = 8.314462618;
const T0 = 298.15;
const P0 = 101325;
const LN10 = Math.LN10;
const MW_W = 18.01528;            // g/mol, as the databank
const num = (x) => typeof x === 'number' && isFinite(x);

// ---------------------------------------------------------------------------
// potassium carbonate as an apparent (non-volatile) component of the rigorous
// databank. ΔfH°, S° of K2CO3(aq) standard state: 2 K+ + CO3−− (NBS tables,
// Wagman et al. 1982); ideal-gas fields are placeholders that are never used
// for the liquid (the component cannot vaporise) — other packages refuse it.
// ---------------------------------------------------------------------------
const K2CO3_REC = {
  name: 'Potassium carbonate (aqueous)', cas: '584-08-7', formula: 'K2CO3', family: 0,
  mw: 138.2055, tc: 2500, pc: 1.0e7, vc: 0.2, zc: 0.25, w: 0.0, tb: 2000, tm: 1164,
  hf: -1181.9e6, gf: -1094.4e6, s0: 148.1e3,
  // never used for the liquid — keeps generic code paths finite
  cpig: [1, 114.4e3, 0, 0, 0, 0, 50, 3000],
  psat: [10, -46.0, 0, 0, 0, 0, 200, 2000],        // exp(−46) Pa ≈ 1e-20: non-volatile
  cat: 'electrolyte', electrolyte: true,
};
if (compdb && compdb.COMPS && !compdb.COMPS.K2CO3) compdb.COMPS.K2CO3 = K2CO3_REC;
export const ELECTROLYTE_KEYS = ['K2CO3'];
/** solvent (apparent component key) of each acid-gas package */
export const ELECTROLYTE_SOLVENT = { 'amine-mea': 'MEA', 'hot-k2co3': 'K2CO3', 'amine-mdea': 'methyl-diethanolamine' };

/** Which electrolyte model a component list needs (or null). */
export function electrolyteNeeded(keys) {
  if (keys.includes('K2CO3')) return 'hot-k2co3';
  return null;
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function solveDense(A, b) {
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
/** PHREEQC analytic log10 K = A1 + A2 T + A3/T + A4 log10 T + A5/T² + A6 T². */
const logKan = (a, T) => a[0] + (a[1] || 0) * T + (a[2] || 0) / T + (a[3] || 0) * Math.log10(T) + (a[4] || 0) / (T * T) + (a[5] || 0) * T * T;

// ===========================================================================
// 1. AQUEOUS MEA  (Akula et al. 2021 / IDAES)
// ===========================================================================
const MEA = {
  mw: { H2O: 0.01802, MEA: 0.06108 },                // kg/mol (IDAES values)
  lnK1: (T) => 233.4 - 3410 / T - 36.8 * Math.log(T) + Math.log(1e-3),       // carbamate, m3/mol
  lnK2: (T) => 176.72 - 2909 / T - 28.46 * Math.log(T) + Math.log(1e-3),     // bicarbonate, m3/mol
  psatW: (T) => Math.exp(72.55 - 7206.70 / T - 7.1385 * Math.log(T) + 4.05e-6 * T * T),
  psatM: (T) => Math.exp(172.78 - 13492 / T - 21.914 * Math.log(T) + 1.38e-5 * T * T),
};
/** apparent molar volume [m3/mol] of an apparent composition {w, a, g} (IDAES, Weiland / Morgan). */
function meaVolume(T, w, a, g) {
  const rw = -3.2484e-6 * T * T + 0.00165 * T + 0.793;
  const rm = -5.35162e-7 * T * T - 4.51417e-4 * T + 1.19451;
  const vw = 18.02 / rw;
  const vm = 61.08 / rm + w * (-2.2642 + 3.0059 * a);
  const vc = 10.2074 + (207 - 563.3701 * a) * a;
  return (w * vw + a * vm + g * vc) * 1e-6;
}
/** ln Henry constant [Pa m3/mol] of CO2 (N2O analogy, Jiru et al. 2012 as in IDAES). */
function meaLnHenry(T, w, a) {
  const mM = a * MEA.mw.MEA, mW = w * MEA.mw.H2O;
  const s = mM + mW;
  const wM = s > 0 ? mM / s : 0, wW = s > 0 ? mW / s : 1;
  const t = T - 273.15;
  const lnHN2OM = Math.log(2.448e5) - 1348 / T, lnHCW = Math.log(3.52e6) - 2113 / T, lnHN2OW = Math.log(8.449e6) - 2283 / T;
  const lnHCM = lnHN2OM + lnHCW - lnHN2OW;
  const lwm = 1.70981 + 0.03972 * t - 4.3e-4 * t * t - 2.20377 * wW;
  return wM * lnHCM + wW * lnHCW + wM * wW * lwm;
}
/**
 * Speciation of one apparent mole {w H2O, a MEA, g CO2} (w + a + g = 1).
 * Unknown: free MEA u. For a given u the carbamate/bicarbonate ratio and the
 * MEA balance give the extents in closed form; the carbamate constant then
 * gives free CO2 s, and u is found from the CO2 balance P(u) + s(u) = g, which
 * falls monotonically from +∞ (u → 0) to −g (u = a).
 */
function meaSpeciate(T, w, a, g) {
  const v = meaVolume(T, w, a, g), rho = 1 / v;
  const K1 = Math.exp(MEA.lnK1(T)), K2 = Math.exp(MEA.lnK2(T));
  if (!(g > 0) || !(a > 0)) {
    // no reaction possible
    return { rho, v, u: a, s: g, x1: 0, x2: 0, nt: 1, W: w };
  }
  const kap = K1 / K2;
  const ev = (u) => {
    const am = a - u;
    const B = 2 * kap * u + w + am;
    const disc = Math.max(B * B - 4 * am * w, 0);
    const x2 = am > 0 ? 2 * am * w / (B + Math.sqrt(disc)) : 0;
    // carbamate extent without cancellation when bicarbonate dominates
    const x1 = x2 > 0.5 * am && w - x2 > 0 ? kap * u * x2 / (w - x2) : Math.max(0.5 * (am - x2), 0);
    const P = x1 + x2, nt = 1 - P;
    const s = P * x1 * nt / (K1 * rho * u * u);
    return { u, x1, x2, P, nt, s, F: P + s - g };
  };
  // bracket on ln u: F(lo) > 0 > F(hi)
  let hi = Math.log(a), lo = hi - 2;
  let Flo = ev(Math.exp(lo)).F;
  for (let k = 0; Flo <= 0 && k < 80; k++) { lo -= 2; Flo = ev(Math.exp(lo)).F; }
  let Fhi = -g;
  let vv = lo + (hi - lo) * 0.5, r = null;
  // safeguarded Newton (secant-derivative) on G(ln u) = F
  let last = null;
  for (let it = 0; it < 200; it++) {
    r = ev(Math.exp(vv));
    if (r.F > 0) { lo = vv; Flo = r.F; } else { hi = vv; Fhi = r.F; }
    if (Math.abs(r.F) <= 1e-15 * g || hi - lo < 1e-15) break;
    let vn;
    if (last && last.F !== r.F) vn = vv - r.F * (vv - last.v) / (r.F - last.F);
    else vn = lo - Flo * (hi - lo) / (Fhi - Flo);
    if (!(vn > lo && vn < hi) || it % 4 === 3) vn = 0.5 * (lo + hi);
    last = { v: vv, F: r.F };
    vv = vn;
  }
  // free CO2 from the balance where it is the larger term, from the carbamate law otherwise
  const s = r.s;
  return { rho, v, u: r.u, s, x1: r.x1, x2: r.x2, nt: r.nt, W: w - r.x2 };
}

function makeMEA(n, idx) {
  const { iW, iC, iA } = idx;
  /** apparent sub-composition (w, a, g) normalised over the electrolyte components; zeros → tiny */
  const sub = (x) => {
    let w = iW >= 0 ? x[iW] : 0, a = iA >= 0 ? x[iA] : 0, g = iC >= 0 ? x[iC] : 0;
    const eps = 1e-13;
    if (iW >= 0 && !(w > eps)) w = eps;
    if (iC >= 0 && !(g > eps)) g = eps;
    if (iA >= 0 && !(a > eps)) a = eps;
    const s = w + a + g;
    return { w: w / s, a: a / s, g: g / s, S: s };
  };
  /** ln f [Pa] of the apparent components and ln(true-mole-fraction activities) */
  function core(T0, w, a, g) {
    const T = Math.min(Math.max(T0, 250), 550);       // keep the correlations finite during wide searches
    const sp = meaSpeciate(T, w, a, g);
    const lnH = meaLnHenry(T, w, a);
    const out = { sp, lnf: {}, lnact: {} };
    if (iC >= 0) out.lnf.CO2 = lnH + Math.log(sp.s / sp.nt * sp.rho);
    if (iW >= 0) { out.lnact.H2O = Math.log(sp.W / sp.nt); out.lnf.H2O = out.lnact.H2O + Math.log(MEA.psatW(T0)); }
    if (iA >= 0) { out.lnact.MEA = Math.log(sp.u / sp.nt); out.lnf.MEA = out.lnact.MEA + Math.log(MEA.psatM(T0)); }
    return out;
  }
  return {
    solvent: 'MEA', sub, core,
    /** ln(f_i / x_i,sub) per owned key */
    lnPhiSub(T, xs) { const c = core(T, xs.w, xs.a, xs.g); return { H2O: c.lnf.H2O - Math.log(xs.w), CO2: c.lnf.CO2 - Math.log(xs.g), MEA: c.lnf.MEA - Math.log(xs.a), c }; },
    /** reference-relative ln activity used for the enthalpy: CO2 vs ideal gas (ln f), solvents vs pure liquid */
    lnRel(T, xs) { const c = core(T, xs.w, xs.a, xs.g); return { H2O: c.lnact.H2O, MEA: c.lnact.MEA, CO2: c.lnf.CO2 }; },
    volume(T, xs) { return meaVolume(T, xs.w, xs.a, xs.g); },
    /** liquid viscosity [Pa s], Weiland et al. (1998) form with the IDAES coefficients */
    viscosity(T, xs) {
      const mM = xs.a * 61.08, mW = xs.w * 18.02;
      const r = 100 * mM / (mM + mW);
      const alpha = xs.a > 1e-12 ? xs.g / xs.a : 0;
      const muW = 1.002e-3 * Math.pow(10, 1.3272 * (293.15 - T - 0.001053 * (T - 293.15) * (T - 293.15)) / (T - 168.15));
      const [a, b, c, d, e, f, g] = [-0.0838, 2.8817, 33.651, 1817.0, 0.00847, 0.0103, -2.3890];
      return muW * Math.exp(r * (T * (a * r + b) + c * r + d) * (alpha * (e * r + f * T + g) + 1) / (T * T));
    },
    report(T, xs) {
      const c = core(T, xs.w, xs.a, xs.g), sp = c.sp;
      const xt = (v) => v / sp.nt;
      return {
        model: 'amine-mea', loading_mol_CO2_per_mol_MEA: xs.a > 1e-12 ? xs.g / xs.a : null,
        free_MEA_fraction: xs.a > 1e-12 ? sp.u / xs.a : null,
        true_mole_fractions: { H2O: xt(sp.W), MEA: xt(sp.u), CO2: xt(sp.s), 'MEAH+': xt(sp.x1 + sp.x2), 'MEACOO-': xt(sp.x1), 'HCO3-': xt(sp.x2) },
        P_CO2_eq_kPa: iC >= 0 ? Math.exp(c.lnf.CO2) / 1000 : 0,
        density_kg_m3: (xs.w * 18.02 + xs.a * 61.08 + xs.g * 44.01) / 1000 / meaVolume(T, xs.w, xs.a, xs.g),
      };
    },
    warn(xs, T) {
      if (!(xs.a > 1e-6)) return null;
      const al = xs.g / xs.a;
      if (al > 0.55) return 'acid-gas (MEA): CO2 loading above 0.55 mol/mol — the Akula/IDAES model over-predicts the CO2 pressure there (about 2× at 0.6)';
      if (al > 0.38 && T > 368) return 'acid-gas (MEA): loading above about 0.38 mol/mol at regenerator temperature — the model over-predicts the CO2 pressure (≈ +20–40 % in total pressure at 0.40–0.44, 120 °C)';
      return null;
    },
  };
}

// ===========================================================================
// 2. HOT POTASSIUM CARBONATE  (Pitzer, PHREEQC pitzer.dat)
// ===========================================================================
// species order: 0 K+, 1 H+, 2 CO3−−, 3 HCO3−, 4 OH−, 5 CO2(aq)
const SPZ = [1, 1, -2, -1, -1, 0];
const PZ = {
  // Pitzer parameter: [A0, A1, A2, A3, A4, A5]  P(T) = A0 + A1(1/T − 1/Tr) + A2 ln(T/Tr) + A3 (T − Tr) + A4 (T² − Tr²) + A5 (1/T² − 1/Tr²)
  B0: { '0|2': [0.1488, 0, 0, 1.788e-3], '0|3': [0.0296, 0, 0, 0.996e-3], '0|4': [0.1298] },
  B1: { '0|2': [1.43, 0, 0, 2.051e-3], '0|3': [0.25, 0, 0, 1.104e-3], '0|4': [0.32] },
  C0: { '0|2': [-0.0015], '0|3': [-0.008], '0|4': [0.0041] },
  THETA: { '2|4': [0.1], '0|1': [0.005], '2|3': [-0.04] },
  LAMDA: { '5|0': [0.051], '5|5': [-1.34e-2, 348, 0.803] },
  PSI: { '2|3|0': [0.012], '2|4|0': [-0.01] },
  // log10 K analytic (PHREEQC pitzer.dat)
  KW: [293.29227, 0.1360833, -10576.913, -123.73158, 0, -6.996455e-5],          // H2O = OH− + H+
  K1: [107.8975, 0.03252849, -5151.79, -38.92561, 563713.9],                       // CO3−− + H+ = HCO3−
  K2: [464.1965, 0.09344813, -26986.16, -165.75951, 2248628.9],                    // CO3−− + 2H+ = CO2 + H2O
  KG: [10.5624, -2.3547e-2, -3972.8, 0, 5.8746e5, 1.9194e-5],                     // CO2(g) = CO2(aq), atm
};
const TR = 298.15;
const pTemp = (a, T) => (a[0] || 0) + (a[1] || 0) * (1 / T - 1 / TR) + (a[2] || 0) * Math.log(T / TR) + (a[3] || 0) * (T - TR) + (a[4] || 0) * (T * T - TR * TR) + (a[5] || 0) * (1 / (T * T) - 1 / (TR * TR));

/** saturated-liquid density of water [g/cm3] — IAPWS auxiliary equation (Wagner & Pruss 2002, eq. 2.6) */
function rhoWsat(T) {
  const th = 1 - T / 647.096;
  return 0.322 * (1 + 1.99274064 * Math.cbrt(th) + 1.09965342 * Math.pow(th, 2 / 3) - 0.510839303 * Math.pow(th, 5 / 3)
    - 1.75493479 * Math.pow(th, 16 / 3) - 45.5170352 * Math.pow(th, 43 / 3) - 6.7469445e5 * Math.pow(th, 110 / 3));
}
/** relative permittivity of water, Bradley & Pitzer (1979), pressure in bar */
function epsW(T, pbar) {
  const d1000 = 3.4279e2 * Math.exp(T * (-5.0866e-3 + 9.469e-7 * T));
  const C = -2.0525 + 3.1159e3 / (T - 1.8289e2);
  const B = -8.0325e3 + 4.21452e6 / T + 2.1417 * T;
  return d1000 + C * Math.log((B + pbar) / (B + 1e3));
}
/** Debye–Hückel osmotic slope Aφ (as PHREEQC: 1.400684e6 √(ρ/(εT)³), pressure ≥ water vapour pressure) */
function aphi(T) {
  const pbar = Math.max(1.01325, Math.exp(11.6702 - 3816.44 / (T - 46.13)) * 1.01325);
  const e = epsW(T, pbar);
  return 1.400684e6 * Math.sqrt(rhoWsat(T) / Math.pow(e * T, 3));
}

// Harvie's Chebyshev approximation of the higher-order electrostatic J(x) (Pitzer 1991)
const AKX = [1.925154014814667, -0.060076477753119, -0.029779077456514, -0.007299499690937, 0.000388260636404,
  0.000636874599598, 0.000036583601823, -0.000045036975204, -0.000004537895710, 0.000002937706971,
  0.000000396566462, -0.000000202099617, -0.000000025267769, 0.000000013522610, 0.000000001229405,
  -0.000000000821969, -0.000000000050847, 0.000000000046333, 0.000000000001943, -0.000000000002563,
  -0.000000000010991,
  0.628023320520852, 0.462762985338493, 0.150044637187895, -0.028796057604906, -0.036552745910311,
  -0.001668087945272, 0.006519840398744, 0.001130378079086, -0.000887171310131, -0.000242107641309,
  0.000087294451594, 0.000034682122751, -0.000004583768938, -0.000003548684306, -0.000000250453880,
  0.000000216991779, 0.000000080779570, 0.000000004558555, -0.000000006944757, -0.000000002849257,
  0.000000000237816];
/** J(x) and x·J'(x) — Clenshaw recurrence on Harvie's Chebyshev series (allocation free) */
const JBK = new Float64Array(23), JDK = new Float64Array(23);
const JOUT = [0, 0];
function jfunInto(X, out) {
  let Z, DZ, L;
  if (X <= 1) { Z = 4 * Math.pow(X, 0.2) - 2; DZ = 0.8 * Math.pow(X, -0.8); L = 0; }
  else { Z = 40 * Math.pow(X, -0.1) / 9 - 22 / 9; DZ = -4 * Math.pow(X, -1.1) / 9; L = 21; }
  JBK[21] = JBK[22] = JDK[21] = JDK[22] = 0;
  for (let m = 20; m >= 0; m--) { JBK[m] = Z * JBK[m + 1] - JBK[m + 2] + AKX[m + L]; JDK[m] = JBK[m + 1] + Z * JDK[m + 1] - JDK[m + 2]; }
  out[0] = 0.25 * X - 1 + 0.5 * (JBK[0] - JBK[2]);
  out[1] = 0.25 * X + 0.5 * DZ * (JDK[0] - JDK[2]) * X;
  return out;
}
export function jfun(X) { const o = [0, 0]; return jfunInto(X, o); }
const ETH = [0, 0];
function etheta(zi, zj, I, A0) {
  if (zi === zj || I <= 0) { ETH[0] = 0; ETH[1] = 0; return ETH; }
  const xc = 6 * A0 * Math.sqrt(I);
  jfunInto(xc * zi * zj, JOUT); const Jij = JOUT[0], Pij = JOUT[1];
  jfunInto(xc * zi * zi, JOUT); const Jii = JOUT[0], Pii = JOUT[1];
  jfunInto(xc * zj * zj, JOUT); const Jjj = JOUT[0], Pjj = JOUT[1];
  const zz = zi * zj;
  const et = zz * (Jij - 0.5 * Jii - 0.5 * Jjj) / (4 * I);
  ETH[0] = et; ETH[1] = zz * (Pij - 0.5 * Pii - 0.5 * Pjj) / (8 * I * I) - et / I;
  return ETH;
}
const gfun = (x) => (x > 1e-12 ? 2 * (1 - (1 + x) * Math.exp(-x)) / (x * x) : 1 - 2 * x / 3);
const gpfun = (x) => (x > 1e-12 ? -2 * (1 - (1 + x + 0.5 * x * x) * Math.exp(-x)) / (x * x) : -0.5 + 2 * x / 3);

/** Pitzer temperature set-up (parameters at T) compiled to flat lists */
function pitzerAt(T) {
  const A0 = aphi(T);
  const list = (k, f) => Object.entries(PZ[k]).map(([pr, a]) => { const ij = pr.split('|').map(Number); return f(ij, pTemp(a, T)); });
  return {
    T, A0,
    B0: list('B0', ([i, j], v) => [i, j, v]),
    B1: list('B1', ([i, j], v) => [i, j, v]).filter((r) => r[2] !== 0),
    C0: list('C0', ([i, j], v) => [i, j, v / (2 * Math.sqrt(Math.abs(SPZ[i] * SPZ[j])))]),
    TH: list('THETA', ([i, j], v) => [i, j, v]),
    PSI: list('PSI', ([i, j, k], v) => [i, j, k, v]),
    LAM: list('LAMDA', ([i, j], v) => [i, j, v]),
    lnKw: logKan(PZ.KW, T) * LN10, lnK1: logKan(PZ.K1, T) * LN10, lnK2: logKan(PZ.K2, T) * LN10, lnKg: logKan(PZ.KG, T) * LN10,
  };
}
/** ln γ of the six species and ln a_w for molalities m (Harvie–Møller–Weare form, as PHREEQC). */
function pitzer(pt, m) {
  const A0 = pt.A0;
  const nS = 6;
  let I = 0, Z = 0, osum = 0;
  for (let i = 0; i < nS; i++) { I += 0.5 * m[i] * SPZ[i] * SPZ[i]; Z += m[i] * Math.abs(SPZ[i]); osum += m[i]; }
  const sI = Math.sqrt(I), b = 1.2;
  const lg = [0, 0, 0, 0, 0, 0];
  let F = -A0 * (sI / (1 + b * sI) + 2 * Math.log(1 + b * sI) / b);
  let osm = -A0 * I * sI / (1 + b * sI);
  let csum = 0;
  for (let q = 0, B = pt.B0; q < B.length; q++) { const r = B[q], i = r[0], j = r[1], b0 = r[2]; lg[i] += 2 * m[j] * b0; lg[j] += 2 * m[i] * b0; osm += m[i] * m[j] * b0; }
  if (pt.B1.length) {
    const x = 2 * sI, gx = gfun(x), gpx = gpfun(x), ex = Math.exp(-x);
    for (let q = 0, B = pt.B1; q < B.length; q++) {
      const r = B[q], i = r[0], j = r[1], b1 = r[2];
      lg[i] += 2 * m[j] * b1 * gx; lg[j] += 2 * m[i] * b1 * gx;
      F += m[i] * m[j] * b1 * gpx / I;
      osm += m[i] * m[j] * b1 * ex;
    }
  }
  for (let q = 0, B = pt.C0; q < B.length; q++) { const r = B[q], i = r[0], j = r[1], c = r[2]; csum += m[i] * m[j] * c; lg[i] += m[j] * Z * c; lg[j] += m[i] * Z * c; osm += m[i] * m[j] * Z * c; }
  // like-charged mixing θ + Eθ (unsymmetrical terms for CO3−− with HCO3− / OH−)
  for (let q = 0, B = pt.TH; q < B.length; q++) {
    const r = B[q], i = r[0], j = r[1], th = r[2];
    const e = etheta(SPZ[i], SPZ[j], I, A0), et = e[0], etp = e[1];
    lg[i] += 2 * m[j] * (th + et); lg[j] += 2 * m[i] * (th + et);
    F += m[i] * m[j] * etp;
    osm += m[i] * m[j] * (th + et + I * etp);
  }
  for (let q = 0, B = pt.PSI; q < B.length; q++) {
    const r = B[q], i = r[0], j = r[1], k = r[2], ps = r[3];
    lg[i] += m[j] * m[k] * ps; lg[j] += m[i] * m[k] * ps; lg[k] += m[i] * m[j] * ps;
    osm += m[i] * m[j] * m[k] * ps;
  }
  for (let q = 0, B = pt.LAM; q < B.length; q++) {
    const r = B[q], i = r[0], j = r[1], la = r[2];
    if (i === j) { lg[i] += 2 * m[i] * la; osm += 0.5 * m[i] * m[i] * la; continue; }
    lg[i] += 2 * m[j] * la; lg[j] += 2 * m[i] * la; osm += m[i] * m[j] * la;
  }
  for (let i = 0; i < nS; i++) lg[i] += SPZ[i] * SPZ[i] * F + Math.abs(SPZ[i]) * csum;
  const phi = osum > 0 ? 1 + 2 * osm / osum : 1;
  const lnaw = -osum * phi * MW_W / 1000;
  return { lg, lnaw, phi, I };
}

/**
 * Speciation of one apparent mole {w H2O, k K2CO3, g CO2} (w + k + g = 1).
 * Unknowns: ln m of CO3−−, HCO3−, CO2, OH−, H+ and ln W (kg free water);
 * K+ = 2k/W. Equations: three mass-action laws with Pitzer activities, the
 * carbon, charge and hydrogen balances. Newton with a finite-difference
 * Jacobian (the activity coefficients move with every molality).
 */
function k2co3Speciate(pt, w, k, g, guess) {
  const Mw = MW_W / 1000;
  const C = k + g;
  const res = (v) => {
    const W = Math.exp(v[5]);
    const m = [2 * k / W, Math.exp(v[4]), Math.exp(v[0]), Math.exp(v[1]), Math.exp(v[3]), Math.exp(v[2])];
    const pz = pitzer(pt, m);
    const lg = pz.lg, la = (i) => lg[i] + Math.log(m[i]);
    const r = new Array(6);
    r[0] = la(3) - la(2) - la(1) - pt.lnK1;                                // HCO3−
    r[1] = la(5) + pz.lnaw - la(2) - 2 * la(1) - pt.lnK2;                   // CO2 + H2O
    r[2] = la(4) + la(1) - pz.lnaw - pt.lnKw;                               // water
    r[3] = ((m[2] + m[3] + m[5]) * W - C) / C;                              // carbon
    r[4] = (m[0] + m[1] - 2 * m[2] - m[3] - m[4]) / (m[0] + m[1] + 2 * m[2] + m[3] + m[4]);   // charge
    r[5] = (2 * w - 2 * W / Mw - (m[3] + m[4] + m[1]) * W) / (2 * w);       // hydrogen
    return { r, m, W, pz };
  };
  let v = guess ? guess.slice() : null;
  if (!v) {
    // ideal start (γ = 1, a_w = 1): charge balance solved for ln m_H by bisection
    const W0 = Math.max((w - Math.min(g, k)) * Mw, 1e-6 * w * Mw);
    const K1 = Math.exp(pt.lnK1), K2 = Math.exp(pt.lnK2), Kw = Math.exp(pt.lnKw);
    const CT = C / W0, mK = 2 * k / W0;
    const parts = (lh) => {
      const h = Math.exp(lh);
      const d = 1 + K1 * h + K2 * h * h;
      const c3 = CT / d;
      return { h, c3, hc: K1 * h * c3, co2: K2 * h * h * c3, oh: Kw / h };
    };
    let lo = -80, hi = 5;
    for (let it = 0; it < 200; it++) {
      const mid = 0.5 * (lo + hi), q = parts(mid);
      const ch = mK + q.h - 2 * q.c3 - q.hc - q.oh;          // increases with h
      if (ch > 0) hi = mid; else lo = mid;
      if (hi - lo < 1e-12) break;
    }
    const q = parts(0.5 * (lo + hi));
    const fl = (x) => Math.log(Math.max(x, 1e-300));
    v = [fl(q.c3), fl(q.hc), fl(q.co2), fl(q.oh), fl(q.h), Math.log(W0)];
  }
  let cur = res(v), nrm = Math.max(...cur.r.map(Math.abs));
  for (let it = 0; it < 80 && nrm > 1e-13; it++) {
    const J = [];
    for (let c = 0; c < 6; c++) {
      const vp = v.slice(); const h = 1e-7; vp[c] += h;
      const rp = res(vp).r;
      for (let rI = 0; rI < 6; rI++) { if (!J[rI]) J[rI] = new Array(6); J[rI][c] = (rp[rI] - cur.r[rI]) / h; }
    }
    const dv = solveDense(J, cur.r.map((x) => -x));
    if (!dv) break;
    let lim = 1; for (const d of dv) if (Math.abs(d) * lim > 2) lim = 2 / Math.abs(d);
    let alpha = lim, acc = false;
    for (let ls = 0; ls < 30; ls++) {
      const vn = v.map((x, i) => x + alpha * dv[i]);
      const cn = res(vn), nn = Math.max(...cn.r.map(Math.abs));
      if (isFinite(nn) && (nn < nrm * (1 - 1e-4 * alpha) || nn < 1e-13)) { v = vn; cur = cn; nrm = nn; acc = true; break; }
      alpha *= 0.5;
    }
    if (!acc) break;
  }
  return { v, m: cur.m, W: cur.W, pz: cur.pz, resid: nrm };
}

function makeK2CO3(n, idx, deps) {
  const { iW, iC, iA } = idx;
  const ptCache = new Map();
  const ptOf = (T) => { let p = ptCache.get(T); if (!p) { p = pitzerAt(T); if (ptCache.size > 256) ptCache.clear(); ptCache.set(T, p); } return p; };
  let warm = null;
  const sub = (x) => {
    let w = iW >= 0 ? x[iW] : 0, a = iA >= 0 ? x[iA] : 0, g = iC >= 0 ? x[iC] : 0;
    const eps = 1e-13;
    if (iW >= 0 && !(w > eps)) w = eps;
    if (iC >= 0 && !(g > eps)) g = eps;
    if (iA >= 0 && !(a > eps)) a = eps;
    const s = w + a + g;
    return { w: w / s, a: a / s, g: g / s, S: s };
  };
  // The pitzer.dat KHCO3 parameters (fitted to about 3 mol/kg) make a concentrated,
  // loaded solution thermodynamically unstable — a spurious liquid–liquid split (the
  // Hessian of G in water and CO2 at fixed salt loses positive definiteness) close to
  // where KHCO3 would in fact crystallise. ONSET holds the K2CO3 molality at which that
  // happens, from a scan of the model itself (0–250 °C, conversion α = 0.1–1.0); states
  // beyond 95 % of it (or above 8 mol/kg, about the K2CO3 solubility, or with more than
  // 2 mol/kg CO2 beyond the bicarbonate end point — they occur inside flash iterations)
  // are evaluated on that boundary at the same conversion and continued linearly in
  // ln(concentration) with the boundary slopes, so the fugacities and their temperature
  // derivatives (enthalpies) stay continuous wherever the boundary lies.
  const MK_MAX = 8, MX_MAX = 2;
  const mkMax = (T, al) => {
    const t = Math.min(Math.max((T - 273.15) / 25, 0), ONSET.length - 1.000001);
    const l = Math.min(Math.max((Math.min(al, 1) - 0.1) / 0.1, 0), ONSET[0].length - 1.000001);
    const i = Math.floor(t), j = Math.floor(l), ft = t - i, fl = l - j;
    const v = (1 - ft) * ((1 - fl) * ONSET[i][j] + fl * ONSET[i][j + 1]) + ft * ((1 - fl) * ONSET[i + 1][j] + fl * ONSET[i + 1][j + 1]);
    return Math.min(MK_MAX, 0.95 * v);
  };
  const Mw = MW_W / 1000;
  const clampState = (w, k, g, T) => {
    const mk0 = k / (w * Mw), mg0 = g / (w * Mw);
    const lim = mkMax(T, mg0 / Math.max(mk0, 1e-300));
    const sc = mk0 > lim ? lim / mk0 : 1;
    return { mk0, mg0, sc };
  };
  // evaluated state for a scale s along the ray of constant conversion
  const onRay = (cs, s) => {
    const mk = cs.mk0 * s, mgs = cs.mg0 * s, mg = Math.min(mgs, mk + MX_MAX);
    const t = 1 / Mw + mk + mg;
    return { w: 1 / Mw / t, k: mk / t, g: mg / t, mk, mg, dG: mgs - mg };
  };
  const solveAt = (pt, T, st, guess) => {
    let sp = null;
    if (guess) { sp = k2co3Speciate(pt, st.w, st.k, st.g, guess); if (!(sp.resid < 1e-10)) sp = null; }
    if (!sp && warm && Math.abs(warm.k / st.k - 1) < 0.3 && Math.abs(warm.g / st.g - 1) < 0.3 && Math.abs(warm.T - T) < 20) {
      sp = k2co3Speciate(pt, st.w, st.k, st.g, warm.v);
      if (!(sp.resid < 1e-10)) sp = null;
    }
    if (!sp) sp = k2co3Speciate(pt, st.w, st.k, st.g, null);
    if (!(sp.resid < 1e-7)) throw new Error(`hot-K2CO3 speciation did not converge at ${T.toFixed(2)} K (residual ${sp.resid.toExponential(2)})`);
    return sp;
  };
  // ln a_w, ln (γ m)_CO2 and ln a_K2CO3 of a speciated state, with the CO2 beyond the cap as free CO2
  const vals = (sp, st) => {
    const lg = sp.pz.lg, m = sp.m;
    let lnaw = sp.pz.lnaw, lfC = lg[5] + Math.log(m[5]);
    if (st.dG > 0) {
      lfC += Math.log((m[5] + st.dG) / m[5]);
      lnaw += Math.log((1 + (3 * st.mk + st.mg) * Mw) / (1 + (3 * st.mk + st.mg + st.dG) * Mw));
    }
    return [lnaw, lfC, 2 * (lg[0] + Math.log(m[0])) + lg[2] + Math.log(m[2])];
  };
  function core(T0, w0, k0, g0) {
    // the Pitzer parameters and equilibrium constants are evaluated inside 0–250 °C
    // (flash and bubble-point searches can probe far outside; the solution is not
    // physical there, but the functions stay finite)
    const T = Math.min(Math.max(T0, 273.15), 523.15);
    const pt = ptOf(T);
    const cs = clampState(w0, k0, g0, T);
    const st = onRay(cs, cs.sc);
    const sp = solveAt(pt, T, st, null);
    warm = { T, k: st.k, g: st.g, v: sp.v };
    let v = vals(sp, st);
    if (cs.sc < 1) {
      const eps = 1e-4, st2 = onRay(cs, cs.sc * (1 - eps));
      const v2 = vals(solveAt(pt, T, st2, sp.v), st2);
      const dl = -Math.log(cs.sc) / -Math.log(1 - eps);
      v = v.map((x, i) => x + (x - v2[i]) * dl);
    }
    const out = { sp, lnf: {}, lnact: {}, clamped: cs.sc < 1 || st.dG > 0 };
    out.lnact.H2O = v[0];
    if (iW >= 0) out.lnf.H2O = v[0] + Math.log(deps.psatW(T0));
    if (iC >= 0) out.lnf.CO2 = v[1] - pt.lnKg + Math.log(P0);
    out.lnact.K2CO3 = v[2];
    if (iA >= 0) out.lnf.K2CO3 = Math.log(1e-30);
    return out;
  }
  // solution heat capacity: water's plus an apparent molar Cp of the salt
  const CP_SALT = 0;     // J/(mol K) — see the validation notes (Armand handbook Cp)
  return {
    solvent: 'K2CO3', sub, core,
    lnPhiSub(T, xs) { const c = core(T, xs.w, xs.a, xs.g); return { H2O: c.lnf.H2O - Math.log(xs.w), CO2: c.lnf.CO2 - Math.log(xs.g), K2CO3: -70 - Math.log(xs.a), c }; },
    lnRel(T, xs) { const c = core(T, xs.w, xs.a, xs.g); return { H2O: c.lnact.H2O, K2CO3: c.lnact.K2CO3, CO2: c.lnf.CO2 }; },
    saltRef(T) { return { h: K2CO3_REC.hf / 1000 + CP_SALT * (T - T0), s: K2CO3_REC.s0 / 1000 + CP_SALT * Math.log(T / T0) }; },
    volume(T, xs) {
      // solution density ρ = ρw(T)·(1 + a1·w + a2·w²) on the CO2-free salt mass fraction (fit of the
      // Armand Products handbook densities at 15.6 °C); absorbed CO2 adds 33 cm3/mol
      const mW = xs.w * MW_W, mK = xs.a * K2CO3_REC.mw;
      const wf = mK / (mW + mK);
      const rho = rhoWsat(T) * (1 + K2CO3_DENS[0] * wf + K2CO3_DENS[1] * wf * wf);     // g/cm3
      return ((mW + mK) / rho + xs.g * 33.0) * 1e-6;
    },
    report(T, xs) {
      const c = core(T, xs.w, xs.a, xs.g), sp = c.sp, m = sp.m;
      return {
        model: 'hot-k2co3', conversion_to_KHCO3: xs.a > 1e-12 ? xs.g / xs.a : null,
        pH: -(sp.pz.lg[1] + Math.log(m[1])) / LN10, ionic_strength: sp.pz.I, water_activity: Math.exp(c.lnact.H2O), osmotic_coefficient: sp.pz.phi,
        ...(c.clamped ? { extrapolated: 'beyond the Pitzer parameters\' stable range: speciation shown at the boundary state' } : {}),
        molality: { 'K+': m[0], 'CO3--': m[2], 'HCO3-': m[3], CO2: m[5], 'OH-': m[4], 'H+': m[1] },
        P_CO2_eq_kPa: iC >= 0 ? Math.exp(c.lnf.CO2) / 1000 : 0,
        density_kg_m3: (xs.w * MW_W + xs.a * K2CO3_REC.mw + xs.g * 44.0095) / 1000 / this.volume(T, xs),
      };
    },
    warn(xs, T) {
      const out = [];
      if (xs.a > 1e-6 && xs.g / xs.a > 1.0) out.push('acid-gas (K2CO3): more CO2 than carbonate (conversion > 1) — beyond the bicarbonate end point, only physical solubility remains');
      if (T > 393.15) out.push('acid-gas (K2CO3): above 120 °C the Pitzer parameters (fitted to about 90–100 °C) are extrapolated');
      if (xs.w > 0) {
        const mk = xs.a / (xs.w * MW_W / 1000), al = xs.g / Math.max(xs.a, 1e-300);
        const Tc = Math.min(Math.max(T, 273.15), 523.15);
        if (mk > mkMax(Tc, al)) out.push(`acid-gas (K2CO3): solution too concentrated for the Pitzer parameters (${mk.toFixed(1)} mol K2CO3 per kg water at conversion ${al.toFixed(2)}) — near or beyond the KHCO3/K2CO3 solubility; properties there are extrapolated from the model boundary`);
      }
      return out.join('; ') || null;
    },
  };
}
// K2CO3 molality (mol/kg water) at which the Pitzer model of the loaded solution loses
// stability, rows T = 0, 25, … 250 °C, columns conversion α = 0.1, 0.2, … 1.0 — computed
// from this model (Hessian of G in water and CO2 at fixed salt, finite differences)
const ONSET = [
  [10.271, 7.221, 5.782, 4.896, 4.28, 3.819, 3.459, 3.168, 2.929, 2.756],
  [11.74, 8.312, 6.707, 5.717, 5.023, 4.501, 4.087, 3.749, 3.468, 3.259],
  [12, 9.133, 7.442, 6.398, 5.665, 5.112, 4.675, 4.319, 4.028, 3.819],
  [12, 9.768, 8.033, 6.964, 6.215, 5.65, 5.206, 4.853, 4.579, 4.417],
  [12, 10.276, 8.522, 7.444, 6.69, 6.124, 5.684, 5.343, 5.105, 5.037],
  [12, 10.693, 8.936, 7.86, 7.108, 6.547, 6.116, 5.793, 5.597, 5.671],
  [12, 11.031, 9.291, 8.225, 7.483, 6.93, 6.51, 6.206, 6.055, 6.317],
  [12, 11.278, 9.587, 8.548, 7.822, 7.283, 6.876, 6.592, 6.484, 6.974],
  [12, 11.39, 9.81, 8.826, 8.131, 7.611, 7.221, 6.955, 6.887, 7.644],
  [12, 11.324, 9.941, 9.052, 8.409, 7.92, 7.551, 7.306, 7.274, 8.328],
  [12, 11.129, 10.002, 9.238, 8.664, 8.218, 7.876, 7.653, 7.653, 9.032],
];
// density correlation coefficients (fit to Armand Products potassium carbonate handbook, Table 4, 15.6 °C)
const K2CO3_DENS = [0.8513467, 0.4361904];      // least squares, 1–52 wt %, max deviation 0.6 %

// ===========================================================================
// 3. AQUEOUS MDEA — Extended UNIQUAC (Thomsen & Rasmussen 1999 form)
// ===========================================================================
// Parameters: N. Sadegh, PhD thesis, Technical University of Denmark (2013),
// "Acid gas removal from natural gas with alkanolamines: a modeling and
// experimental study", Tables 5-2 to 5-7 (UNIQUAC r, q; interaction energies
// u⁰ᵢⱼ, uᵀᵢⱼ with uᵢⱼ = u⁰ᵢⱼ + uᵀᵢⱼ (T − 298.15); standard-state Cp, ΔfG°, ΔfH°).
// Species H2O, CO2(aq), MDEA, MDEAH+, H+, OH−, HCO3−, CO3−−; reactions
//   H2O ⇌ H+ + OH−,  CO2 + H2O ⇌ HCO3− + H+,  HCO3− ⇌ CO3−− + H+,  MDEA + H+ ⇌ MDEAH+
// with K(T) from ΔfG°, ΔfH° and Cp° = a + bT + c/(T − 200) (thesis eq. 3-35).
// Activities: water rational symmetric; solutes molality based, a = m·γ*·x_w
// (γ* rational unsymmetric). Debye–Hückel A(T) of the thesis (eq. 3-51), b = 1.5.
// CO2 vapour–liquid equilibrium by the Rumpf & Maurer (1993) Henry constant
// (thesis eq. 3-29) with a Krichevsky–Kasarnovsky Poynting term, MDEA from
// its aqueous ↔ gas standard states; water from the databank vapour pressure
// times the model's water activity (the model's own Cp integration runs 2–9 %
// low in water vapour pressure above 120 °C). Valid (thesis): 20–200 °C,
// 5–75 wt % MDEA (checked to 90 wt % at low loading), loading ≤ 1.4, p(CO2) ≤ 7.6 MPa.
const EUQ_SP = ['H2O', 'CO2', 'MDEA', 'MDEAH+', 'H+', 'OH-', 'HCO3-', 'CO3--'];
const EUQ_N = 8;
const EUQ_Z = [0, 0, 0, 1, 1, -1, -1, -2];
const EUQ_R = [0.92, 0.75, 0.13445, 2.3931, 0.13779, 9.3973, 8.0756, 10.828];
const EUQ_Q = [1.40, 2.45, 0.54315, 1.0749, 1e-15, 8.8171, 8.6806, 10.769];
const EUQ_MW = 0.01801528;                     // kg/mol water
const EUQ_U0 = [];
const EUQ_UT = [];
{
  const B = 1e10;
  // lower triangle of thesis Tables 5-3 (u⁰) and 5-4 (uᵀ), order H2O CO2 MDEA MDEAH+ H+ OH- HCO3- CO3--
  const u0 = {
    'H2O|H2O': 0, 'CO2|H2O': 8.83825, 'CO2|CO2': 302.25, 'MDEA|H2O': -561.6682, 'MDEA|CO2': B, 'MDEA|MDEA': -1489.795,
    'OH-|H2O': 600.4952, 'OH-|CO2': B, 'OH-|MDEA': B, 'OH-|OH-': 1562.881,
    'H+|H2O': 1e5, 'H+|CO2': B, 'H+|MDEA': B, 'H+|OH-': B, 'H+|H+': 0,
    'HCO3-|H2O': 577.0502, 'HCO3-|CO2': 526.31, 'HCO3-|MDEA': B, 'HCO3-|OH-': B, 'HCO3-|H+': B, 'HCO3-|HCO3-': 771.0377,
    'CO3--|H2O': 361.3877, 'CO3--|CO2': B, 'CO3--|MDEA': B, 'CO3--|OH-': 1588.025, 'CO3--|H+': B, 'CO3--|HCO3-': 800.0081, 'CO3--|CO3--': 1458.344,
    'MDEAH+|H2O': -294.3952, 'MDEAH+|CO2': -764.52, 'MDEAH+|MDEA': B, 'MDEAH+|OH-': B, 'MDEAH+|H+': B, 'MDEAH+|HCO3-': B, 'MDEAH+|CO3--': B, 'MDEAH+|MDEAH+': 0,
  };
  const uT = {
    'CO2|H2O': 0.86293, 'CO2|CO2': 0.3587, 'MDEA|H2O': 0.10616, 'MDEA|MDEA': -2.637, 'OH-|H2O': 8.5455, 'OH-|OH-': 5.6169,
    'HCO3-|H2O': -0.38795, 'HCO3-|CO2': -3.734, 'HCO3-|HCO3-': -0.019813,
    'CO3--|H2O': 3.3516, 'CO3--|OH-': 2.7496, 'CO3--|HCO3-': 1.7241, 'CO3--|CO3--': -1.3448,
    'MDEAH+|H2O': -0.0035922, 'MDEAH+|CO2': 9.473,
  };
  for (let i = 0; i < EUQ_N; i++) { EUQ_U0.push(new Array(EUQ_N).fill(NaN)); EUQ_UT.push(new Array(EUQ_N).fill(0)); }
  const put = (tab, M, def) => {
    for (const [k, v] of Object.entries(tab)) {
      const [a, b] = k.split('|').map((x) => EUQ_SP.indexOf(x));
      M[a][b] = v; M[b][a] = v;
    }
    if (def !== undefined) for (const r of M) for (let j = 0; j < EUQ_N; j++) if (Number.isNaN(r[j])) r[j] = def;
  };
  put(u0, EUQ_U0); put(uT, EUQ_UT, 0);
  for (const r of EUQ_U0) if (r.some((v) => Number.isNaN(v))) throw new Error('EUQ: incomplete u0 table');
}
// standard states (Sadegh 2013, Table 5-7, kJ/mol → J/mol) and Cp° = a + bT + c/(T − 200) (Tables 5-5, 5-6)
const EUQ_GF = { 'H2O': -237.129, 'CO2': -385.98, 'MDEA': -214.8709, 'MDEAH+': -264.1016, 'H+': 0, 'OH-': -157.2481, 'HCO3-': -586.77, 'CO3--': -527.81,
  'H2O(g)': -228.572, 'MDEA(g)': -169.0 };
const EUQ_HF = { 'H2O': -285.83, 'CO2': -413.8, 'MDEA': -491.5275, 'MDEAH+': -528.4562, 'H+': 0, 'OH-': -230.2433, 'HCO3-': -691.99, 'CO3--': -677.14,
  'H2O(g)': -241.818, 'MDEA(g)': -380.0 };
const EUQ_CP = { 'MDEA': [385, 0, 0], 'MDEAH+': [321.1582, 0, 0], 'H2O': [58.36952, 0.0389611, 523.8794], 'OH-': [1418.157, -3.445769, -51473.13],
  'H+': [0, 0, 0], 'HCO3-': [-0.6770971, 0.2737451, -10089.51], 'CO3--': [894.6877, -2.827237, -21149.44], 'CO2': [243, 0, 0],
  'H2O(g)': [33.577, 0, 0], 'MDEA(g)': [100, 0, 0] };
const EUQ_TH = 200;
const EUQ_RX = [
  { 'H+': 1, 'OH-': 1, 'H2O': -1 },
  { 'HCO3-': 1, 'H+': 1, 'CO2': -1, 'H2O': -1 },
  { 'CO3--': 1, 'H+': 1, 'HCO3-': -1 },
  { 'MDEAH+': 1, 'MDEA': -1, 'H+': -1 },
];
const EUQ_NU = EUQ_RX.map((rx) => EUQ_SP.map((sp) => rx[sp] || 0));
const MDEA_VINF_CO2 = 3.3e-5;                 // m3/mol, partial molar volume of CO2 at infinite dilution (Poynting term)
const MDEA_CP_IG = 100;                       // J/(mol K), the model's ideal-gas Cp of MDEA (Table 5-6)
/** ln K of a reaction {species: ν} at T (thesis eq. 3-35, Gibbs–Helmholtz with Cp° = a + bT + c/(T − Θ)). */
function euqLnK(rx, T) {
  let dG = 0, dH = 0, da = 0, db = 0, dc = 0;
  for (const [sp, nu] of Object.entries(rx)) {
    dG += nu * EUQ_GF[sp] * 1000; dH += nu * EUQ_HF[sp] * 1000;
    const c = EUQ_CP[sp]; da += nu * c[0]; db += nu * c[1]; dc += nu * c[2];
  }
  const v = -dG / T0 - dH * (1 / T - 1 / T0) + da * (Math.log(T / T0) + T0 / T - 1) + 0.5 * db * (T - T0) * (T - T0) / T
    + dc / EUQ_TH * ((T - EUQ_TH) / T * Math.log((T - EUQ_TH) / (T0 - EUQ_TH)) - Math.log(T / T0));
  return v / R;
}
/** ln(H/(Pa·kg/mol)) of CO2 in water, molality scale — Rumpf & Maurer (1993). */
const euqLnHenryCO2 = (T) => 192.876 - 9624.4 / T + 1.441e-2 * T - 28.749 * Math.log(T) + Math.log(1e6);
const EUQ_TMEMO = new Map();
/** temperature-only quantities: ψ, infinite-dilution terms, Debye–Hückel A, ln K's */
function euqAtT(T) {
  const hit = EUQ_TMEMO.get(T);
  if (hit) return hit;
  const psi = [];
  for (let k = 0; k < EUQ_N; k++) {
    const row = new Float64Array(EUQ_N);
    for (let l = 0; l < EUQ_N; l++) {
      const ukl = EUQ_U0[k][l] + EUQ_UT[k][l] * (T - 298.15), ull = EUQ_U0[l][l] + EUQ_UT[l][l] * (T - 298.15);
      row[l] = Math.exp(-(ukl - ull) / T);
    }
    psi.push(row);
  }
  const rw = EUQ_R[0], qw = EUQ_Q[0];
  const linf = new Float64Array(EUQ_N);
  for (let i = 1; i < EUQ_N; i++) {
    const ri = EUQ_R[i], qi = EUQ_Q[i];
    const c = Math.log(ri / rw) + 1 - ri / rw - 5 * qi * (Math.log(ri * qw / (rw * qi)) + 1 - ri * qw / (rw * qi));
    const r = qi * (1 - Math.log(psi[0][i]) - psi[i][0]);
    linf[i] = c + r;
  }
  const t = T - 273.15;
  // sparse pattern: pairs with u = 1e10 give ψ = 0 in both directions
  const nzCol = [], nzRow = [];
  for (let l = 0; l < EUQ_N; l++) { const c = []; for (let k = 0; k < EUQ_N; k++) if (psi[k][l] > 0) c.push(k); nzCol.push(Int8Array.from(c)); }
  for (let i = 0; i < EUQ_N; i++) { const r = []; for (let k = 0; k < EUQ_N; k++) if (psi[i][k] > 0) r.push(k); nzRow.push(Int8Array.from(r)); }
  const out = { psi, nzCol, nzRow, linf, A: 1.131 + 1.335e-3 * t + 1.164e-5 * t * t, lnK: EUQ_RX.map((rx) => euqLnK(rx, T)),
    lnKmdea: euqLnK({ 'MDEA(g)': 1, 'MDEA': -1 }, T), lnHco2: euqLnHenryCO2(T) };
  if (EUQ_TMEMO.size > 500) EUQ_TMEMO.clear();
  EUQ_TMEMO.set(T, out);
  return out;
}
const EUQ_GS = { th: new Float64Array(8), S: new Float64Array(8), x: new Float64Array(8) };
/** ln γ: water rational symmetric, solutes rational unsymmetric (γ*) — Extended UNIQUAC. */
function euqLnGamma(x, st, out) {
  const n = EUQ_N, R_ = EUQ_R, Q_ = EUQ_Q, psi = st.psi;
  let sr = 0, sq = 0;
  for (let i = 0; i < n; i++) { sr += x[i] * R_[i]; sq += x[i] * Q_[i]; }
  const th = EUQ_GS.th, S = EUQ_GS.S;
  for (let i = 0; i < n; i++) th[i] = x[i] * Q_[i] / sq;
  const nzC = st.nzCol, nzR = st.nzRow;
  for (let l = 0; l < n; l++) { let s = 0; const c = nzC[l]; for (let m = 0; m < c.length; m++) { const k = c[m]; s += th[k] * psi[k][l]; } S[l] = s; }
  const xw = x[0];
  let I = 0;
  for (let i = 1; i < n; i++) if (EUQ_Z[i]) I += 0.5 * x[i] / (xw * EUQ_MW) * EUQ_Z[i] * EUQ_Z[i];
  const A = st.A, b = 1.5, sI = Math.sqrt(I);
  for (let i = 0; i < n; i++) {
    const phx = R_[i] / sr, pht = (R_[i] / sr) / (Q_[i] / sq);      // φ/x and φ/θ
    let lc = Math.log(phx) + 1 - phx - 5 * Q_[i] * (Math.log(pht) + 1 - pht);
    let t2 = 0; const r = nzR[i]; for (let m = 0; m < r.length; m++) { const k = r[m]; t2 += th[k] * psi[i][k] / S[k]; }
    const lr = Q_[i] * (1 - Math.log(S[i]) - t2);
    if (i === 0) {
      let dh = 0;
      if (I > 0) { const y = b * sI; dh = 2 / 3 * EUQ_MW * A * I * sI * (3 / (y * y * y)) * (1 + y - 1 / (1 + y) - 2 * Math.log(1 + y)); }
      out[0] = lc + lr + dh;
    } else {
      out[i] = lc + lr - st.linf[i] - EUQ_Z[i] * EUQ_Z[i] * A * sI / (1 + b * sI);
    }
  }
  return out;
}
/** ln activities (water: x·γ; solutes molality based: m·γ*·x_w = x·γ* ÷ Mw) of true moles n. */
function euqLnAct(nv, st, lg, la) {
  let t = 0; for (let i = 0; i < EUQ_N; i++) t += nv[i];
  const x = EUQ_GS.x;
  for (let i = 0; i < EUQ_N; i++) x[i] = nv[i] / t;
  euqLnGamma(x, st, lg);
  la[0] = Math.log(x[0]) + lg[0];
  for (let i = 1; i < EUQ_N; i++) la[i] = Math.log(x[i]) + lg[i] - Math.log(EUQ_MW);
  return x;
}
/** 8×8 dense solve in place (partial pivoting); returns false when singular. */
function euqSolve(A, b, n) {
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (!(Math.abs(A[p * n + c]) > 1e-300)) return false;
    if (p !== c) { for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
    for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / A[c * n + c]; if (f) { for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]; b[r] -= f * b[c]; } }
  }
  for (let r = n - 1; r >= 0; r--) { let t = b[r]; for (let k = r + 1; k < n; k++) t -= A[r * n + k] * b[k]; b[r] = t / A[r * n + r]; }
  return true;
}
// recent solutions (warm starts): the flash, column and enthalpy derivatives ask for many
// nearby states; Newton from a neighbour's species distribution — with its Jacobian, updated
// by Broyden steps — converges in two or three residual evaluations instead of a dozen
const EUQ_WARM = [];
const EUQ_WARM_MAX = 48;
const EUQ_WARM_POS = { k: 0 };
const EUQ_LNTINY = Math.log(1e-280);
/**
 * Speciation of w H2O, a MDEA, g CO2 (apparent moles): Newton (Broyden-updated Jacobian)
 * on ln nᵢ of the eight true species — four equilibria plus the MDEA, carbon, charge and
 * oxygen balances — started from the nearest recent solution or, failing one, from the
 * ideal-solution speciation (charge balance solved for H+ by bisection).
 */
const EUQ_S = { lg: new Float64Array(8), la: new Float64Array(8), nv: new Float64Array(8), f: new Float64Array(8), f2: new Float64Array(8),
  ln2: new Float64Array(8), d: new Float64Array(8), A: new Float64Array(64), sv: new Float64Array(8), lt: new Float64Array(8), ft: new Float64Array(8) };
export const EUQ_STATS = { calls: 0, evals: 0, cold: 0, jac: 0 };
function mdeaSpeciate(T, w, a, g) {
  EUQ_STATS.calls++;
  const n = EUQ_N, st = euqAtT(T), lnK = st.lnK, Mw = EUQ_MW;
  const { lg, la, nv } = EUQ_S;
  const sA = a > 0 ? a : 1, sC = g > 0 ? g : 1, sQ = a + g + 1e-9 * w;
  const resid = (lv, f) => {
    for (let i = 0; i < n; i++) nv[i] = Math.exp(lv[i]);
    euqLnAct(nv, st, lg, la);
    for (let j = 0; j < 4; j++) { const nu = EUQ_NU[j]; let s = -lnK[j]; for (let i = 0; i < n; i++) if (nu[i]) s += nu[i] * la[i]; f[j] = s; }
    f[4] = a > 0 ? (nv[2] + nv[3] - a) / sA : nv[2] + nv[3];
    f[5] = g > 0 ? (nv[1] + nv[6] + nv[7] - g) / sC : nv[1] + nv[6] + nv[7];
    f[6] = (nv[3] + nv[4] - nv[5] - nv[6] - 2 * nv[7]) / sQ;
    f[7] = (nv[0] + nv[5] + nv[6] + nv[7] - w) / w;
    let e = 0; for (let i = 0; i < n; i++) { const v = Math.abs(f[i]); if (!(v <= e)) e = v; }
    return e;
  };
  // start: nearest recent solution, shifted to the new totals
  let ln = new Float64Array(n), J = null;
  let best = null, bd = Infinity;
  const lw = Math.log(w), lA = Math.log(a + 1e-30), lG = Math.log(g + 1e-30);
  for (let k = 0; k < EUQ_WARM.length; k++) {
    const c = EUQ_WARM[k];
    const dd = Math.abs(c.T - T) * 0.04 + Math.abs(lw - c.lw) + Math.abs(lA - c.lA) + 0.5 * Math.abs(lG - c.lG);
    if (dd < bd) { bd = dd; best = c; if (dd < 1e-6) break; }
  }
  if (best && bd > 6) best = null;
  if (best) {
    const dw = lw - best.lw, da = lA - best.lA, dg = lG - best.lG;
    for (let i = 0; i < n; i++) ln[i] = best.ln[i] + (i === 0 ? dw : i === 2 || i === 3 ? da : i === 1 || i === 6 || i === 7 ? dg : 0);
    J = bd < 0.6 ? best.J.slice() : null;               // a distant neighbour still gives a better start than the ideal solution
  } else {
    const [Kw, K1, K2, Ka] = lnK.map(Math.exp);
    const kg = w * Mw, mA = a / kg, mC = g / kg;
    const parts = (lh) => {
      const h = Math.exp(lh), oh = Kw / h, r1 = K1 / h, r2 = K2 / h, s = Ka * h;
      const co2 = mC / (1 + r1 + r1 * r2), hc = co2 * r1, c3 = hc * r2, md = mA / (1 + s);
      return [h, oh, co2, hc, c3, md, mA - md];
    };
    let lo = Math.log(1e-18), hi = Math.log(100);
    for (let k = 0; k < 200 && hi - lo > 1e-12; k++) {
      const mid = 0.5 * (lo + hi), p = parts(mid);
      if (p[0] + p[6] - p[1] - p[3] - 2 * p[4] > 0) hi = mid; else lo = mid;
    }
    const p0 = parts(0.5 * (lo + hi));
    const W0 = Math.max(w - kg * (p0[1] + p0[3] + p0[4]), 0.05 * w);
    const v0 = [W0, p0[2] * kg, p0[5] * kg, p0[6] * kg, p0[0] * kg, p0[1] * kg, p0[3] * kg, p0[4] * kg];
    for (let i = 0; i < n; i++) ln[i] = Math.max(Math.log(Math.max(v0[i], 1e-280)), EUQ_LNTINY);
  }
  const { f, f2, ln2, d, A, sv, lt, ft } = EUQ_S;
  const numJ = () => {
    J = new Float64Array(n * n);
    lt.set(ln);
    for (let k = 0; k < n; k++) {
      lt[k] = ln[k] + 1e-7; resid(lt, ft); lt[k] = ln[k];
      for (let i = 0; i < n; i++) J[i * n + k] = (ft[i] - f[i]) / 1e-7;
    }
  };
  let err = resid(ln, f), it = 0, fresh = false, evals = 1, stall = 0;
  for (it = 0; it < 60 && err > 1e-11; it++) {
    if (!J) { numJ(); evals += n; fresh = true; EUQ_STATS.jac++; }
    A.set(J); for (let i = 0; i < n; i++) d[i] = -f[i];
    if (!euqSolve(A, d, n)) { if (fresh) break; J = null; continue; }
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(d[i]));
    const lim = err > 1e-3 ? 2 : 3;
    let lam = mx > lim ? lim / mx : 1, e2 = Infinity;
    for (let bt = 0; bt < 10; bt++) {
      for (let i = 0; i < n; i++) ln2[i] = Math.max(ln[i] + lam * d[i], EUQ_LNTINY);
      e2 = resid(ln2, f2); evals++;
      if (e2 < err) break;
      if (!fresh) break;                       // a stale Jacobian is refreshed rather than backtracked
      lam *= 0.5;
    }
    if (!(e2 < err)) {
      if (!fresh) { J = null; continue; }
      break;                                   // no descent even with a fresh Jacobian
    }
    // Broyden rank-1 update with the step actually taken
    let ss = 0;
    for (let i = 0; i < n; i++) { sv[i] = ln2[i] - ln[i]; ss += sv[i] * sv[i]; }
    if (ss > 0) {
      for (let i = 0; i < n; i++) {
        let js = 0; for (let k = 0; k < n; k++) js += J[i * n + k] * sv[k];
        const u = (f2[i] - f[i] - js) / ss;
        if (u) for (let k = 0; k < n; k++) J[i * n + k] += u * sv[k];
      }
    }
    // round-off floor (extreme states, e.g. almost water-free liquid at 200 °C): stop once
    // the residual is tiny and no longer falling
    stall = e2 < 1e-8 && e2 > 0.3 * err ? stall + 1 : 0;
    ln.set(ln2); f.set(f2); err = e2; fresh = false;
    if (stall >= 2) break;
  }
  EUQ_STATS.evals += evals; if (!best) EUQ_STATS.cold++;
  if (err < 1e-7 && !(best && bd < 2e-3)) {             // keep the cache spread out: a near twin adds nothing
    if (!J) numJ();
    let e;
    if (EUQ_WARM.length < EUQ_WARM_MAX) { e = { ln: new Float64Array(n), J: new Float64Array(n * n) }; EUQ_WARM.push(e); }
    else { e = EUQ_WARM[EUQ_WARM_POS.k]; EUQ_WARM_POS.k = (EUQ_WARM_POS.k + 1) % EUQ_WARM_MAX; }
    e.T = T; e.lw = lw; e.lA = lA; e.lG = lG; e.ln.set(ln); e.J.set(J);
  }
  resid(ln, f);
  const nvo = Array.from(nv);
  let t = 0; for (let i = 0; i < n; i++) t += nvo[i];
  return { n: nvo, x: nvo.map((v) => v / t), lg: Array.from(lg), la: Array.from(la), st, err, iterations: it, evals, ok: err < 1e-7 };
}
/** liquid molar volume [m3 per mol of apparent H2O + MDEA + CO2]: Redlich–Kister fit (2 terms + T) to the
 *  MDEA–water densities measured by Sadegh (2013, Tables 7-3 to 7-7; 40–80 °C, 10–100 wt %, max 0.15 %);
 *  CO2 counted at an apparent 20 cm³/mol (order found for loaded alkanolamine solutions — approximate) */
const MDEA_DENS = [1.02497390, -7.58465661e-4, -4.44100259, -2.87498304, 0.331296627, 1.79496829e-2];
function mdeaVolume(T, w, a, g) {
  const [a0, a1, k0, k1, k2, kT] = MDEA_DENS;
  const VA = 119.1622 / (a0 + a1 * (T - 313.15)), VW = 18.01528 / rhoWsat(Math.min(T, 640));
  const s = w + a;
  const xw = s > 0 ? w / s : 1, xa = s > 0 ? a / s : 0, dx = xw - xa;
  const v = xw * VW + xa * VA + xw * xa * (k0 + k1 * dx + k2 * dx * dx + kT * (T - 313.15));
  return (s * v + g * 20) * 1e-6;
}

// ===========================================================================
// 3b. ACTIVATED MDEA (MDEA + piperazine) — Extended UNIQUAC, 13 true species
// ===========================================================================
// The MDEA–CO2–H2O part is the Sadegh (2013) set above, unchanged. Piperazine adds
// PZ, PZH+, PZCOO−, H+PZCOO− (zwitterion, written HPZCOO) and PZ(COO)2−−, with
//   PZH+ ⇌ PZ + H+                      Gupta, da Silva & Svendsen, J. Phys. Chem. B 126 (2022) 1980,
//                                        Table 1 reaction 6 (it reproduces the measured pKa's of its Fig. 4)
//   PZ + HCO3− ⇌ PZCOO− + H2O           ⎫ ln K = ln K(313.15 K) − ΔH/R (1/T − 1/313.15),
//   HPZCOO ⇌ PZCOO− + H+                ⎬ fitted here
//   PZCOO− + HCO3− ⇌ PZ(COO)2−− + H2O   ⎭
// No published, self-contained piperazine parameter set exists for this model (the DTU
// consortium keeps its set in its databank), so the piperazine species take their UNIQUAC
// r, q and interaction energies from the nearest Sadegh species (PZ, HPZCOO ~ MDEA;
// PZH+ ~ MDEAH+; PZCOO− ~ HCO3−; PZ(COO)2−− ~ CO3−−) and five water interactions plus the
// three reaction constants were regressed (multicalci, 2026) to measured CO2 partial pressures:
// Xu (2011, UT Austin) 7:2 and 5:5 MDEA/PZ at 100–160 °C and aqueous PZ at 100–160 °C,
// Chen (2011, UT Austin) 7 m MDEA / 2 m PZ at 40–100 °C, and Xu's (2011) correlation of five
// aqueous-PZ data sets at 40–80 °C. Chen's 5 m MDEA / 5 m PZ data (40–100 °C) were held out.
// Average deviations in p(CO2): 12–21 % per data set (held-out set 13 %). Range of the data:
// 40–160 °C, loading ≤ 0.45 mol CO2/mol alkalinity, p(CO2) ≤ 28 kPa below 100 °C.
// PZ volatility: Henry constant of the 'Fawkes' model (Frailie 2014, App. B, Table B-1).
const AM_SP = [...EUQ_SP, 'PZ', 'PZH+', 'PZCOO-', 'HPZCOO', 'PZ(COO)2--'];
const AM_N = 13;
const AM_Z = [...EUQ_Z, 0, 1, -1, 0, -2];
const AM_R = [...EUQ_R, 0.13445, 2.3931, 8.0756, 0.13445, 10.828];
const AM_Q = [...EUQ_Q, 0.54315, 1.0749, 8.6806, 0.54315, 10.769];
const AM_U0 = [];
const AM_UT = [];
{
  const B = 1e10;
  const u0 = {
    'PZ|H2O': -527.6452, 'PZ|PZ': -1489.795, 'PZ|MDEA': -1489.795,
    'HPZCOO|H2O': -1359.5422, 'HPZCOO|HPZCOO': -1489.795, 'HPZCOO|MDEA': -1489.795, 'HPZCOO|PZ': -1489.795,
    'PZH+|H2O': 987.3348, 'PZH+|PZH+': 0, 'PZH+|CO2': -764.52, 'PZH+|MDEAH+': 0,
    'PZCOO-|H2O': 147.7672, 'PZCOO-|PZCOO-': 771.0377, 'PZCOO-|CO2': 526.31, 'PZCOO-|HCO3-': 771.0377, 'PZCOO-|CO3--': 800.0081,
    'PZ(COO)2--|H2O': 592.5277, 'PZ(COO)2--|PZ(COO)2--': 1458.344, 'PZ(COO)2--|OH-': 1588.025, 'PZ(COO)2--|HCO3-': 800.0081,
    'PZ(COO)2--|PZCOO-': 800.0081, 'PZ(COO)2--|CO3--': 1458.344,
  };
  const uT = {
    'PZ|H2O': 0.10616, 'PZ|PZ': -2.637, 'PZ|MDEA': -2.637,
    'HPZCOO|H2O': 0.10616, 'HPZCOO|HPZCOO': -2.637, 'HPZCOO|MDEA': -2.637, 'HPZCOO|PZ': -2.637,
    'PZH+|H2O': -0.0035922, 'PZH+|CO2': 9.473,
    'PZCOO-|H2O': -0.38795, 'PZCOO-|PZCOO-': -0.019813, 'PZCOO-|CO2': -3.734, 'PZCOO-|HCO3-': -0.019813, 'PZCOO-|CO3--': 1.7241,
    'PZ(COO)2--|H2O': 3.3516, 'PZ(COO)2--|PZ(COO)2--': -1.3448, 'PZ(COO)2--|OH-': 2.7496, 'PZ(COO)2--|HCO3-': 1.7241,
    'PZ(COO)2--|PZCOO-': 1.7241, 'PZ(COO)2--|CO3--': -1.3448,
  };
  for (let i = 0; i < AM_N; i++) {
    AM_U0.push(new Array(AM_N).fill(B)); AM_UT.push(new Array(AM_N).fill(0));
    if (i < EUQ_N) for (let j = 0; j < EUQ_N; j++) { AM_U0[i][j] = EUQ_U0[i][j]; AM_UT[i][j] = EUQ_UT[i][j]; }
  }
  const put = (tab, M) => {
    for (const [k, v] of Object.entries(tab)) {
      const [a, b] = k.split('|').map((x) => AM_SP.indexOf(x));
      if (a < 0 || b < 0) throw new Error('AM: unknown species in ' + k);
      M[a][b] = v; M[b][a] = v;
    }
  };
  put(u0, AM_U0); put(uT, AM_UT);
}
const AM_RX = [...EUQ_RX,
  { 'PZ': 1, 'H+': 1, 'PZH+': -1 },
  { 'PZCOO-': 1, 'H2O': 1, 'PZ': -1, 'HCO3-': -1 },
  { 'PZCOO-': 1, 'H+': 1, 'HPZCOO': -1 },
  { 'PZ(COO)2--': 1, 'H2O': 1, 'PZCOO-': -1, 'HCO3-': -1 }];
const AM_NU = AM_RX.map((rx) => AM_SP.map((sp) => rx[sp] || 0));
/** fitted reaction constants: [ln K at 313.15 K, ΔH J/mol] (carbamate, protonated carbamate, dicarbamate) */
const AM_KFIT = [[1.56192, -47513.9], [-26.8867, 24738.8], [-1.31445, -19679.1]];
/** ln K of PZH+ ⇌ PZ + H+ (molality basis) — Gupta et al. (2022), Table 1, reaction 6 */
const amLnKpzh = (T) => 37.31499 - 6091.49 / T - 8.39402 * Math.log(T) + 0.033076 * T - 1.69e-5 * T * T;
/** ln(H/Pa) of PZ in water, mole-fraction scale — Frailie (2014) App. B Table B-1 (HENRY 1 = 29.0, HENRY 2/313 = −25.23) */
const amLnHpzX = (T) => 29.0 - 25.23 * 313 / T;
const AM_TMEMO = new Map();
function amAtT(T) {
  const hit = AM_TMEMO.get(T);
  if (hit) return hit;
  const psi = [];
  for (let k = 0; k < AM_N; k++) {
    const row = new Float64Array(AM_N);
    for (let l = 0; l < AM_N; l++) {
      const ukl = AM_U0[k][l] + AM_UT[k][l] * (T - 298.15), ull = AM_U0[l][l] + AM_UT[l][l] * (T - 298.15);
      row[l] = Math.exp(-(ukl - ull) / T);
    }
    psi.push(row);
  }
  const rw = AM_R[0], qw = AM_Q[0];
  const linf = new Float64Array(AM_N);
  for (let i = 1; i < AM_N; i++) {
    const ri = AM_R[i], qi = AM_Q[i];
    const c = Math.log(ri / rw) + 1 - ri / rw - 5 * qi * (Math.log(ri * qw / (rw * qi)) + 1 - ri * qw / (rw * qi));
    linf[i] = c + qi * (1 - Math.log(psi[0][i]) - psi[i][0]);
  }
  const nzCol = [], nzRow = [];
  for (let l = 0; l < AM_N; l++) { const c = []; for (let k = 0; k < AM_N; k++) if (psi[k][l] > 0) c.push(k); nzCol.push(Int8Array.from(c)); }
  for (let i = 0; i < AM_N; i++) { const r = []; for (let k = 0; k < AM_N; k++) if (psi[i][k] > 0) r.push(k); nzRow.push(Int8Array.from(r)); }
  const t = T - 273.15, base = euqAtT(T);
  const lnK = [...base.lnK, amLnKpzh(T), ...AM_KFIT.map(([l313, dH]) => l313 - dH / R * (1 / T - 1 / 313.15))];
  const out = { psi, nzCol, nzRow, linf, A: 1.131 + 1.335e-3 * t + 1.164e-5 * t * t, lnK,
    lnKmdea: base.lnKmdea, lnHco2: base.lnHco2, lnHpz: amLnHpzX(T) + Math.log(EUQ_MW) };
  if (AM_TMEMO.size > 500) AM_TMEMO.clear();
  AM_TMEMO.set(T, out);
  return out;
}
const AM_GS = { th: new Float64Array(AM_N), S: new Float64Array(AM_N), x: new Float64Array(AM_N) };
function amLnGamma(x, st, out) {
  const n = AM_N, R_ = AM_R, Q_ = AM_Q, psi = st.psi;
  let sr = 0, sq = 0;
  for (let i = 0; i < n; i++) { sr += x[i] * R_[i]; sq += x[i] * Q_[i]; }
  const th = AM_GS.th, S = AM_GS.S;
  for (let i = 0; i < n; i++) th[i] = x[i] * Q_[i] / sq;
  const nzC = st.nzCol, nzR = st.nzRow;
  for (let l = 0; l < n; l++) { let s = 0; const c = nzC[l]; for (let m = 0; m < c.length; m++) { const k = c[m]; s += th[k] * psi[k][l]; } S[l] = s; }
  const xw = x[0];
  let I = 0;
  for (let i = 1; i < n; i++) if (AM_Z[i]) I += 0.5 * x[i] / (xw * EUQ_MW) * AM_Z[i] * AM_Z[i];
  const A = st.A, b = 1.5, sI = Math.sqrt(I);
  for (let i = 0; i < n; i++) {
    const phx = R_[i] / sr, pht = (R_[i] / sr) / (Q_[i] / sq);
    const lc = Math.log(phx) + 1 - phx - 5 * Q_[i] * (Math.log(pht) + 1 - pht);
    let t2 = 0; const r = nzR[i]; for (let m = 0; m < r.length; m++) { const k = r[m]; t2 += th[k] * psi[i][k] / S[k]; }
    const lr = Q_[i] * (1 - Math.log(S[i]) - t2);
    if (i === 0) {
      let dh = 0;
      if (I > 0) { const y = b * sI; dh = 2 / 3 * EUQ_MW * A * I * sI * (3 / (y * y * y)) * (1 + y - 1 / (1 + y) - 2 * Math.log(1 + y)); }
      out[0] = lc + lr + dh;
    } else {
      out[i] = lc + lr - st.linf[i] - AM_Z[i] * AM_Z[i] * A * sI / (1 + b * sI);
    }
  }
  return out;
}
function amLnAct(nv, st, lg, la) {
  let t = 0; for (let i = 0; i < AM_N; i++) t += nv[i];
  const x = AM_GS.x;
  for (let i = 0; i < AM_N; i++) x[i] = nv[i] / t;
  amLnGamma(x, st, lg);
  la[0] = Math.log(x[0]) + lg[0];
  for (let i = 1; i < AM_N; i++) la[i] = Math.log(x[i]) + lg[i] - Math.log(EUQ_MW);
  return x;
}
/** ideal-solution start: nested bisection on ln[H+] (charge) and ln[HCO3−] (carbon) */
function amIdealStart(st, w, a, p, g) {
  const [Kw, K1, K2, Ka, K4, K5, K6, K7] = st.lnK.map(Math.exp);
  const kg = w * EUQ_MW, mA = a / kg, mP = p / kg, mC = g / kg;
  const parts = (h, c) => {
    const oh = Kw / h, co2 = c * h / K1, c3 = c * K2 / h, mdh = mA * Ka * h / (1 + Ka * h);
    const pz = mP / (1 + h / K4 + K5 * c * (1 + h / K6 + K7 * c));
    const pzh = pz * h / K4, pzc = K5 * pz * c, hpzc = pzc * h / K6, pzc2 = K7 * pzc * c;
    return [h, oh, co2, c, c3, mdh, pz, pzh, pzc, hpzc, pzc2];
  };
  const carbon = (h) => {
    let lo = Math.log(1e-300), hi = Math.log(mC + 1e-300);
    for (let k = 0; k < 120 && hi - lo > 1e-13; k++) {
      const mid = 0.5 * (lo + hi), q = parts(h, Math.exp(mid));
      if (q[2] + q[3] + q[4] + q[8] + q[9] + 2 * q[10] > mC) hi = mid; else lo = mid;
    }
    return Math.exp(0.5 * (lo + hi));
  };
  let lo = Math.log(1e-18), hi = Math.log(100);
  for (let k = 0; k < 120 && hi - lo > 1e-12; k++) {
    const mid = 0.5 * (lo + hi), h = Math.exp(mid), q = parts(h, carbon(h));
    if (q[0] + q[5] + q[7] - q[1] - q[3] - 2 * q[4] - q[8] - 2 * q[10] > 0) hi = mid; else lo = mid;
  }
  const h = Math.exp(0.5 * (lo + hi)), q = parts(h, carbon(h));
  const W0 = Math.max(w - kg * (q[1] + q[3] + q[4]), 0.05 * w);
  const v0 = [W0, q[2] * kg, (mA - q[5]) * kg, q[5] * kg, q[0] * kg, q[1] * kg, q[3] * kg, q[4] * kg, q[6] * kg, q[7] * kg, q[8] * kg, q[9] * kg, q[10] * kg];
  return v0.map((v) => Math.max(Math.log(Math.max(v, 1e-280)), EUQ_LNTINY));
}
const AM_WARM = [];
const AM_WARM_POS = { k: 0 };
const AM_S = { lg: new Float64Array(AM_N), la: new Float64Array(AM_N), nv: new Float64Array(AM_N), f: new Float64Array(AM_N), f2: new Float64Array(AM_N),
  ln2: new Float64Array(AM_N), d: new Float64Array(AM_N), A: new Float64Array(AM_N * AM_N), sv: new Float64Array(AM_N), lt: new Float64Array(AM_N), ft: new Float64Array(AM_N),
  J: new Float64Array(AM_N * AM_N), H: new Float64Array(AM_N * AM_N), ln: new Float64Array(AM_N),
  yv: new Float64Array(AM_N), hy: new Float64Array(AM_N), sh: new Float64Array(AM_N) };
/**
 * Speciation of w H2O, a MDEA, p PZ, g CO2 (apparent moles): Newton (Broyden-updated Jacobian) on
 * ln nᵢ of the 13 true species — eight equilibria plus the MDEA, PZ, carbon, charge and oxygen balances.
 */
function amdeaSpeciate(T, w, a, p, g) {
  EUQ_STATS.calls++;
  const n = AM_N, st = amAtT(T), lnK = st.lnK;
  if (!(a > 1e-12 * p)) a = 1e-12 * p;                  // keeps the MDEA species defined in aqueous PZ
  const { lg, la, nv } = AM_S;
  const sA = a, sP = p, sC = g > 0 ? g : 1, sQ = a + p + g + 1e-9 * w;
  const resid = (lv, f) => {
    for (let i = 0; i < n; i++) nv[i] = Math.exp(lv[i]);
    amLnAct(nv, st, lg, la);
    for (let j = 0; j < 8; j++) { const nu = AM_NU[j]; let s = -lnK[j]; for (let i = 0; i < n; i++) if (nu[i]) s += nu[i] * la[i]; f[j] = s; }
    f[8] = (nv[2] + nv[3] - a) / sA;
    f[9] = (nv[8] + nv[9] + nv[10] + nv[11] + nv[12] - p) / sP;
    f[10] = g > 0 ? (nv[1] + nv[6] + nv[7] + nv[10] + nv[11] + 2 * nv[12] - g) / sC : nv[1] + nv[6] + nv[7] + nv[10] + nv[11] + 2 * nv[12];
    f[11] = (nv[3] + nv[4] + nv[9] - nv[5] - nv[6] - 2 * nv[7] - nv[10] - 2 * nv[12]) / sQ;
    f[12] = (nv[0] + nv[5] + nv[6] + nv[7] - w) / w;
    let e = 0; for (let i = 0; i < n; i++) { const v = Math.abs(f[i]); if (!(v <= e)) e = v; }
    return e;
  };
  const ln = AM_S.ln, JB = AM_S.J, HB = AM_S.H;
  let H = null;                                         // null, or HB holding a usable inverse Jacobian
  let best = null, bd = Infinity;
  const lw = Math.log(w), lA = Math.log(a), lP = Math.log(p), lG = Math.log(g + 1e-30);
  for (let k = 0; k < AM_WARM.length; k++) {
    const c = AM_WARM[k];
    const dd = Math.abs(c.T - T) * 0.04 + Math.abs(lw - c.lw) + Math.abs(lA - c.lA) + Math.abs(lP - c.lP) + 0.5 * Math.abs(lG - c.lG);
    if (dd < bd) { bd = dd; best = c; if (dd < 1e-6) break; }
  }
  if (best && bd > 6) best = null;
  if (best) {
    const dw = lw - best.lw, da = lA - best.lA, dp = lP - best.lP, dg = lG - best.lG;
    for (let i = 0; i < n; i++) ln[i] = best.ln[i] + (i === 0 ? dw : i === 2 || i === 3 ? da : i >= 8 ? dp : i === 1 || i === 6 || i === 7 ? dg : 0);
    if (bd < 0.6) { HB.set(best.H); H = HB; } else H = null;
  } else {
    ln.set(amIdealStart(st, w, a, p, g));
  }
  const { f, f2, ln2, d, A, sv, lt, ft, yv, hy, sh } = AM_S;
  // Newton with an inverse Jacobian H: numeric Jacobian inverted once (Gauss–Jordan), then
  // Broyden's 'good' inverse rank-1 updates — no linear solve per iteration
  const numH = () => {
    lt.set(ln);
    for (let k = 0; k < n; k++) {
      lt[k] = ln[k] + 1e-7; resid(lt, ft); lt[k] = ln[k];
      for (let i = 0; i < n; i++) JB[i * n + k] = (ft[i] - f[i]) / 1e-7;
    }
    A.set(JB); HB.fill(0); for (let i = 0; i < n; i++) HB[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let pr = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[pr * n + c])) pr = r;
      if (!(Math.abs(A[pr * n + c]) > 1e-300)) return false;
      if (pr !== c) for (let k = 0; k < n; k++) { let t = A[c * n + k]; A[c * n + k] = A[pr * n + k]; A[pr * n + k] = t; t = HB[c * n + k]; HB[c * n + k] = HB[pr * n + k]; HB[pr * n + k] = t; }
      const ip = 1 / A[c * n + c];
      for (let k = 0; k < n; k++) { A[c * n + k] *= ip; HB[c * n + k] *= ip; }
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const fc = A[r * n + c];
        if (fc) for (let k = 0; k < n; k++) { A[r * n + k] -= fc * A[c * n + k]; HB[r * n + k] -= fc * HB[c * n + k]; }
      }
    }
    return true;
  };
  let err = resid(ln, f), it = 0, fresh = false, evals = 1, stall = 0;
  for (it = 0; it < 80 && err > 1e-11; it++) {
    if (!H) { evals += n; EUQ_STATS.jac++; if (!numH()) break; H = HB; fresh = true; }
    let mx = 0, finite = true;
    for (let i = 0; i < n; i++) {
      let t = 0; for (let k = 0; k < n; k++) t += H[i * n + k] * f[k];
      d[i] = -t; if (!Number.isFinite(t)) finite = false; else if (Math.abs(t) > mx) mx = Math.abs(t);
    }
    if (!finite) { if (fresh) break; H = null; continue; }
    const lim = err > 1e-3 ? 2 : 3;
    let lam = mx > lim ? lim / mx : 1, e2 = Infinity;
    for (let bt = 0; bt < 12; bt++) {
      for (let i = 0; i < n; i++) ln2[i] = Math.max(ln[i] + lam * d[i], EUQ_LNTINY);
      e2 = resid(ln2, f2); evals++;
      if (e2 < err) break;
      if (!fresh) break;
      lam *= 0.5;
    }
    if (!(e2 < err)) {
      if (!fresh) { H = null; continue; }
      break;
    }
    let sHy = 0;
    for (let i = 0; i < n; i++) { sv[i] = ln2[i] - ln[i]; yv[i] = f2[i] - f[i]; }
    for (let i = 0; i < n; i++) { let t = 0; for (let k = 0; k < n; k++) t += H[i * n + k] * yv[k]; hy[i] = t; sHy += sv[i] * t; }
    if (Math.abs(sHy) > 1e-300) {
      for (let k = 0; k < n; k++) { let t = 0; for (let i = 0; i < n; i++) t += sv[i] * H[i * n + k]; sh[k] = t; }
      for (let i = 0; i < n; i++) { const u = (sv[i] - hy[i]) / sHy; if (u) for (let k = 0; k < n; k++) H[i * n + k] += u * sh[k]; }
    }
    stall = e2 < 1e-8 && e2 > 0.3 * err ? stall + 1 : 0;
    ln.set(ln2); f.set(f2); err = e2; fresh = false;
    if (stall >= 2) break;
  }
  EUQ_STATS.evals += evals; if (!best) EUQ_STATS.cold++;
  if (err < 1e-7 && !(best && bd < 2e-3)) {
    if (!H && numH()) H = HB;
    if (H) {
      let e;
      if (AM_WARM.length < EUQ_WARM_MAX) { e = { ln: new Float64Array(n), H: new Float64Array(n * n) }; AM_WARM.push(e); }
      else { e = AM_WARM[AM_WARM_POS.k]; AM_WARM_POS.k = (AM_WARM_POS.k + 1) % EUQ_WARM_MAX; }
      e.T = T; e.lw = lw; e.lA = lA; e.lP = lP; e.lG = lG; e.ln.set(ln); e.H.set(H);
    }
  }
  resid(ln, f);
  const nvo = Array.from(nv);
  let t = 0; for (let i = 0; i < n; i++) t += nvo[i];
  return { n: nvo, x: nvo.map((v) => v / t), lg: Array.from(lg), la: Array.from(la), st, err, iterations: it, evals, ok: err < 1e-7 };
}
/** piperazine apparent molar volume (cm³/mol) and the CO2 apparent volume in MDEA/PZ — least squares
 *  to Frailie (2014) Table C-1 densities of 7 m MDEA/2 m PZ and 5 m MDEA/5 m PZ, 20–60 °C, loaded (31 points, max 1.0 %) */
const AM_VPZ = [82.3751, 0.0346];
const AM_VCO2 = 4.9648;
function amdeaVolume(T, w, a, p, g) {
  return mdeaVolume(T, w, a, 0) + (p * (AM_VPZ[0] + AM_VPZ[1] * (T - 313.15)) + g * AM_VCO2) * 1e-6;
}

function makeMDEA(n, idx, deps) {
  const { iW, iC, iA, iP } = idx;
  const hasPZ = iP >= 0;
  const sub = (x) => {
    let w = iW >= 0 ? x[iW] : 0, a = iA >= 0 ? x[iA] : 0, g = iC >= 0 ? x[iC] : 0, p = hasPZ ? x[iP] : 0;
    const eps = 1e-13;
    if (iW >= 0 && !(w > eps)) w = eps;
    if (iC >= 0 && !(g > eps)) g = eps;
    if (iA >= 0 && !(a > eps)) a = eps;
    if (hasPZ && !(p > eps)) p = eps;
    const s = w + a + g + p;
    return { w: w / s, a: a / s, g: g / s, p: p / s, S: s };
  };
  function core(T0_, w, a, g, p) {
    const T = Math.min(Math.max(T0_, 263.15), 493.15);       // the model's range (20–200 °C) plus margin, for wide searches
    const sp = hasPZ ? amdeaSpeciate(T, w, a, p, g) : mdeaSpeciate(T, w, a, g);
    const la = sp.la, st = sp.st;
    const out = { sp, lnf: {}, lnact: {} };
    out.lnact.H2O = la[0];
    if (iW >= 0) out.lnf.H2O = la[0] + Math.log(deps.psatW(T0_));
    if (iC >= 0) out.lnf.CO2 = st.lnHco2 + la[1];
    if (iA >= 0) out.lnf.MDEA = st.lnKmdea + la[2] + Math.log(1e5);
    if (hasPZ) out.lnf.PZ = st.lnHpz + la[8];
    return out;
  }
  const K = 'methyl-diethanolamine', KP = 'piperazine';
  const vol = (T, xs) => (hasPZ ? amdeaVolume(T, xs.w, xs.a, xs.p, xs.g) : mdeaVolume(T, xs.w, xs.a, xs.g));
  return {
    solvent: K, sub, core,
    heavy: hasPZ ? ['H2O', K, KP] : ['H2O', K],
    gasRef: hasPZ ? ['CO2', K, KP] : ['CO2', K],
    igShape: { [K]: { cp: MDEA_CP_IG } },
    vInf: { CO2: MDEA_VINF_CO2 },
    lnPhiSub(T, xs) {
      const c = core(T, xs.w, xs.a, xs.g, xs.p);
      const o = { H2O: c.lnf.H2O - Math.log(xs.w), CO2: c.lnf.CO2 - Math.log(xs.g), [K]: c.lnf.MDEA - Math.log(xs.a), c };
      if (hasPZ) o[KP] = c.lnf.PZ - Math.log(xs.p);
      return o;
    },
    lnRel(T, xs) {
      const c = core(T, xs.w, xs.a, xs.g, xs.p);
      const o = { H2O: c.lnact.H2O, [K]: c.lnf.MDEA, CO2: c.lnf.CO2 };
      if (hasPZ) o[KP] = c.lnf.PZ;
      return o;
    },
    volume(T, xs) { return vol(T, xs); },
    /** no viscosity correlation for loaded MDEA in the sources used — reported as unavailable, not guessed */
    viscosity() { return NaN; },
    report(T, xs) {
      const c = core(T, xs.w, xs.a, xs.g, xs.p), sp = c.sp;
      const SP = hasPZ ? AM_SP : EUQ_SP, ZZ = hasPZ ? AM_Z : EUQ_Z;
      const o = {};
      SP.forEach((k, i) => { o[k] = sp.x[i]; });
      const massW = xs.w * 18.01528, massA = xs.a * 119.1622, massP = hasPZ ? xs.p * 86.1356 : 0;
      const r = {
        model: 'amine-mdea', loading_mol_CO2_per_mol_MDEA: xs.a > 1e-12 ? xs.g / xs.a : null,
        MDEA_wt_pct_CO2_free: 100 * massA / (massA + massW + massP),
        protonated_MDEA_fraction: xs.a > 1e-12 ? sp.n[3] / (sp.n[2] + sp.n[3]) : null,
        true_mole_fractions: o,
        ionic_strength_mol_kg: 0.5 * SP.reduce((s, k, i) => s + (ZZ[i] ? sp.n[i] / (sp.n[0] * EUQ_MW) * ZZ[i] * ZZ[i] : 0), 0),
        P_CO2_eq_kPa: iC >= 0 ? Math.exp(c.lnf.CO2) / 1000 : 0,
        density_kg_m3: (xs.w * 18.01528 + xs.a * 119.1622 + xs.g * 44.0095 + massP) / 1000 / vol(T, xs),
        speciation_converged: sp.ok,
      };
      if (hasPZ) {
        const pz = sp.n.slice(8, 13), tot = pz.reduce((s, v) => s + v, 0);
        r.piperazine_wt_pct_CO2_free = 100 * massP / (massA + massW + massP);
        r.loading_mol_CO2_per_mol_amine = xs.a + xs.p > 1e-12 ? xs.g / (xs.a + xs.p) : null;
        r.loading_mol_CO2_per_mol_alkalinity = xs.a + xs.p > 1e-12 ? xs.g / (xs.a + 2 * xs.p) : null;
        r.piperazine_as_carbamate_fraction = tot > 0 ? (pz[2] + pz[3] + pz[4]) / tot : null;
        r.P_PZ_eq_Pa = Math.exp(c.lnf.PZ);
      }
      return r;
    },
    warn(xs, T) {
      const out = [];
      const massW = xs.w * 18.01528, massA = xs.a * 119.1622, massP = hasPZ ? xs.p * 86.1356 : 0;
      const wt = 100 * massA / Math.max(massA + massW + massP, 1e-30);
      const pzOn = hasPZ && xs.p > 1e-6 * (xs.a + xs.w);
      if (!pzOn) {
        if (xs.a > 1e-6 && wt > 75.5) out.push(`acid-gas (MDEA): ${wt.toFixed(0)} wt % MDEA — above the 75 wt % the Extended UNIQUAC parameters were fitted to`);
        if (xs.a > 1e-6 && xs.g / xs.a > 1.4) out.push(`acid-gas (MDEA): CO2 loading ${(xs.g / xs.a).toFixed(2)} mol/mol — above the fitted range (≤ 1.4)`);
        if (T < 288.15 || T > 478.15) out.push(`acid-gas (MDEA): ${(T - 273.15).toFixed(0)} °C — outside the fitted 20–200 °C`);
      } else {
        const wp = 100 * massP / Math.max(massA + massW + massP, 1e-30), alk = xs.g / Math.max(xs.a + 2 * xs.p, 1e-30);
        if (wt + wp > 60) out.push(`activated MDEA: ${(wt + wp).toFixed(0)} wt % amine — above the ~50 wt % of the piperazine data`);
        if (alk > 0.5) out.push(`activated MDEA: loading ${alk.toFixed(2)} mol CO2/mol alkalinity — above the piperazine data (≤ 0.45); MDEA chemistry dominates there, but this is an extrapolation`);
        if (T < 308.15 || T > 438.15) out.push(`activated MDEA: ${(T - 273.15).toFixed(0)} °C — outside the 40–160 °C of the piperazine data`);
        if (T < 373.15 && iC >= 0) {
          const pc = Math.exp(core(T, xs.w, xs.a, xs.g, xs.p).lnf.CO2) / 1000;
          if (pc > 35) out.push(`activated MDEA: equilibrium p(CO2) ${pc.toFixed(0)} kPa below 100 °C — above the ~30 kPa the piperazine fit was checked to (rich absorber end is extrapolated)`);
        }
        if (wp > 12.4 && T < 298.15) out.push(`activated MDEA: ${wp.toFixed(1)} wt % piperazine below 25 °C — solid piperazine hydrate may precipitate (only ~12 wt % dissolves in water at 20 °C)`);
      }
      return out.join('; ') || null;
    },
  };
}

// ===========================================================================
// public factory
// ===========================================================================
/**
 * Build the electrolyte part of a package.
 * @param {string} model 'amine-mea' | 'hot-k2co3'
 * @param {string[]} keys package component keys
 * @param {{psatW:(T:number)=>number}} deps engine water vapour pressure (Pa)
 */
export function makeElectrolyte(model, keys, deps) {
  const iW = keys.indexOf('H2O'), iC = keys.indexOf('CO2');
  const solvent = ELECTROLYTE_SOLVENT[model];
  const iA = keys.indexOf(solvent);
  const iP = model === 'amine-mdea' ? keys.indexOf('piperazine') : -1;
  const idx = { iW, iC, iA, iP };
  const impl = model === 'amine-mea' ? makeMEA(keys.length, idx) : model === 'amine-mdea' ? makeMDEA(keys.length, idx, deps) : makeK2CO3(keys.length, idx, deps);
  const owned = [iW, iC, iA, iP].filter((i) => i >= 0);
  const keyOf = (i) => (i === iW ? 'H2O' : i === iC ? 'CO2' : i === iP ? 'piperazine' : solvent);
  // memo of the last few evaluations (the column asks K and h at the same state)
  const memo = new Map();
  const memoKey = (T, xs) => T + '|' + xs.w + '|' + xs.a + '|' + xs.g + '|' + (xs.p || 0);
  const remember = (k, v) => { if (memo.size > 400) memo.clear(); memo.set(k, v); return v; };
  function lnPhi(T, xs) {
    const k = 'p' + memoKey(T, xs);
    return memo.get(k) || remember(k, impl.lnPhiSub(T, xs));
  }
  function rel(T, xs) {
    const k = 'r' + memoKey(T, xs);
    return memo.get(k) || remember(k, impl.lnRel(T, xs));
  }
  /** −RT² ∂(ln rel)/∂T at fixed apparent composition, per owned key */
  function hEx(T, xs) {
    const k = 'h' + memoKey(T, xs);
    const m = memo.get(k);
    if (m) return m;
    const d = 0.01;
    const a = rel(T + d, xs), b = rel(T - d, xs);
    const o = {};
    for (const key of Object.keys(a)) if (num(a[key]) && num(b[key])) o[key] = -R * T * T * (a[key] - b[key]) / (2 * d);
    return remember(k, o);
  }
  return {
    model, solvent, owned, keyOf, impl,
    /** keys that stay in the liquid (not 'light' in the absorber/stripper start-up) */
    heavy: impl.heavy || ['H2O', solvent],
    sub: impl.sub,
    /** ln φ_i (liquid) for owned components i (+ Poynting term for gases with a V∞) */
    lnPhiL(T, P, x) {
      const xs = impl.sub(x);
      const lp = lnPhi(T, xs);
      const out = {};
      for (const i of owned) out[i] = lp[keyOf(i)] - Math.log(P);
      if (impl.vInf && iC >= 0 && impl.vInf.CO2) out[iC] += impl.vInf.CO2 * Math.max(P - deps.psatW(T), 0) / (R * T);
      return out;
    },
    /** keys whose liquid enthalpy is referred to the ideal gas (else to the pure liquid) */
    gasRef: impl.gasRef || ['CO2'],
    /** ideal-gas heat capacity the model's gas standard state uses (keeps the solution Cp as fitted) */
    igShape: impl.igShape || null,
    /** partial molar enthalpies relative to the reference parts, and ln f for entropy */
    hEx, rel, lnPhiSubRaw: lnPhi,
    volume: (T, x) => { const xs = impl.sub(x); return impl.volume(T, xs) * xs.S; },
    viscosity: impl.viscosity ? (T, x) => impl.viscosity(T, impl.sub(x)) : null,
    report: (T, x) => impl.report(T, impl.sub(x)),
    warn: (T, x) => impl.warn(impl.sub(x), T),
    saltRef: impl.saltRef ? (T) => impl.saltRef(T) : null,
  };
}

export default { ELECTROLYTE_VERSION, ELECTROLYTE_MODELS, ELECTROLYTE_KEYS, ELECTROLYTE_SOLVENT, makeElectrolyte, electrolyteNeeded, jfun };
export { meaSpeciate, meaVolume, meaLnHenry, pitzerAt, pitzer, k2co3Speciate, aphi, rhoWsat, mdeaSpeciate, mdeaVolume, euqAtT, euqLnK,
  amdeaSpeciate, amdeaVolume, amAtT, AM_SP };
