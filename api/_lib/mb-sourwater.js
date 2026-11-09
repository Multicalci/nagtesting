// ============================================================================
// REPO PATH: api/_lib/mb-sourwater.js
// ============================================================================
// multicalci.com — STEP 38 sour-water property method: aqueous NH3, H2S and CO2
// (refinery sour water, ammonia-plant process condensate, coke-oven liquor),
// optionally with caustic (NaOH) to free fixed ammonia.
//
// Model: Edwards, Maurer, Newman & Prausnitz (AIChE J. 24 (1978) 966) with the
// equilibrium and Henry's constants of Kawazuishi & Prausnitz (LBL-22402, 1986;
// Ind. Eng. Chem. Res. 26 (1987) 1482):
//   NH3 + H2O ⇌ NH4+ + OH−            CO2 + H2O ⇌ HCO3− + H+
//   HCO3− ⇌ CO3−− + H+                 H2S ⇌ HS− + H+        HS− ⇌ S−− + H+
//   NH3 + HCO3− ⇌ NH2COO− + H2O        H2O ⇌ H+ + OH−
// ln K = A1/T + A2 ln T + A3 T + A4 (molality scale; water by its activity).
// Henry's constants (molality scale, at the vapour pressure of water): NH3 and
// CO2 from Kawazuishi & Prausnitz, H2S from IAPWS G7-04 (kH·M_w). Activity
// coefficients: Pitzer's Debye–Hückel term (b = 1.2) for the ions and the water
// activity; the molecule–molecule terms of Edwards et al. for NH3 and CO2.
// Kawazuishi & Prausnitz set every other interaction parameter to zero, and so
// does this method. Vapour fugacities come from the package's vapour model; the
// liquid gases carry a Poynting factor with constant partial molar volumes.
//
// Apparent components: H2O, NH3, H2S, CO2 and NaOH (non-volatile). Other gases
// (H2, N2, CH4, CO, Ar, O2 …) dissolve by Henry's law, handled in mb-thermo.
// Units inside: T K, P Pa, molality mol/kg. Plain ES module. (c) multicalci.com
// ============================================================================

import pz from './mb-pitzer.js';

const R = 8.314462618;
const MW = 0.01801528;                 // kg/mol water
const LN10 = Math.LN10;
const num = (x) => typeof x === 'number' && isFinite(x);

// Kawazuishi & Prausnitz (1986/87), Table 1 and Table 2 (NH3, CO2, carbamate); Edwards et al. (1978) β for NH3–NH3, CO2–CO2
export const SW = {
  KN: [-5914.082, -15.06399, -0.01100801, 97.97152],      // NH3 + H2O = NH4+ + OH−          0–175 °C
  KC1: [-7726.010, -14.50613, -0.02798420, 102.2755],     // CO2 + H2O = HCO3− + H+          0–225 °C
  KC2: [-9137.258, -18.11192, -0.02245619, 116.7371],     // HCO3− = CO3−− + H+               0–225 °C
  // H2S = HS− + H+ and HS− = S−− + H+ from the USGS PHREEQC database (phreeqc.dat): log K1 = 11.17 − 0.02386 T − 3279/T
  // (Kawazuishi & Prausnitz's printed coefficients put pK1 at 5.97 at 200 °C, against about 7.0 measured);
  // K2: log K = −12.918 at 25 °C, ΔH° 12.1 kcal/mol (van 't Hoff) — negligible below pH 12
  KS1: [-3279.0 * Math.LN10, 0, -0.02386 * Math.LN10, 11.17 * Math.LN10],
  KS2: [-(12.1 * 4184 / 8.314462618), 0, 0, -12.918 * Math.LN10 + 12.1 * 4184 / 8.314462618 / 298.15],
  KCB: [604.1164, -4.017263, 0.005030950, 20.15214],      // NH3 + HCO3− = NH2COO− + H2O    0–160 °C, kg/mol
  HN: [-7579.948, -13.58857, 0.008596972, 96.23184],      // Henry NH3, bar·kg/mol            0–300 °C
  HC: [-17060.71, -68.31596, 0.06598907, 430.1920],       // Henry CO2, bar·kg/mol            0–200 °C
  BNN: [-0.0398, 17.0],                                   // β NH3–NH3 = E + F/T, kg/mol      0–300 °C
  BCC: [-0.0901, 25.4],                                   // β CO2–CO2                        0–200 °C
  V: { NH3: 24.5e-6, CO2: 33.5e-6, H2S: 35.0e-6, H2O: 18.07e-6 },   // partial molar volumes, m3/mol (Poynting)
};
const lnKf = (c, T) => c[0] / T + c[1] * Math.log(T) + c[2] * T + c[3];

// sodium hydroxide as an apparent, non-volatile component: aqueous standard state Na+ + OH−
// (NBS tables, Wagman et al. 1982: ΔfH° −240.12 − 229.994 kJ/mol, S° 59.0 − 10.75, Cp° 46.4 − 148.5 J/mol K)
export const NAOH_REC = {
  name: 'Sodium hydroxide (aqueous)', cas: '1310-73-2', formula: 'NaOH', family: 0,
  mw: 39.99711, tc: 2820, pc: 2.5e7, vc: 0.05, zc: 0.25, w: 0.0, tb: 1661, tm: 591,
  hf: -470.114e6, gf: -419.149e6, s0: 48.25e3, cp_aq: -102.1,
  cpig: [1, 59.5e3, 0, 0, 0, 0, 50, 3000],
  psat: [10, -46.0, 0, 0, 0, 0, 200, 3000],
  cat: 'electrolyte', electrolyte: true, ions: { 'Na+': 1, 'OH-': 1 },
};

// species of the Pitzer model (molality scale) and their charges
export const SP = ['NH3', 'CO2', 'H2S', 'NH4+', 'Na+', 'H+', 'OH-', 'HCO3-', 'CO3--', 'HS-', 'S--', 'NH2COO-'];
const ZS = [0, 0, 0, 1, 1, 1, -1, -1, -2, -1, -2, -1];
const NS = SP.length;
// ion-interaction parameters P(T) = a + b (1/T − 1/298.15): fitted (multicalci) to the sour-water VLE data
// listed in the validation page (see SW_FIT); sodium pairs from PHREEQC pitzer.dat (25 °C values)
export const SW_PAR = {
  B0: { 'NH4+|HCO3-': [-0.051205, -20.322], 'NH4+|HS-': [0.054873, -7.0978], 'NH4+|NH2COO-': [0.58002, 0],
    'Na+|HCO3-': [0.0277, 0], 'Na+|CO3--': [0.0399, 0], 'Na+|OH-': [0.0864, 0] },
  B1: { 'Na+|HCO3-': [0.0411, 0], 'Na+|CO3--': [1.389, 0], 'Na+|OH-': [0.253, 0] },
  C0: { 'Na+|CO3--': [0.0044, 0], 'Na+|OH-': [0.0044, 0] },
  LAM: { 'NH3|NH4+': [-0.014748, 0] },
};
// fit quality (mean |ln(p_model/p_measured)|, PR vapour): Müller 1983 NH3 13 % CO2 22 %; Wilson, Gillespie & Owens 1985
// NH3 12 % CO2 12 % H2S 21 %; API (Beutier & Renon 1978) NH3 13 % H2S 22 %; Leyko 1959 NH3 13 % H2S 24 % (99 values)
export const SW_FIT = 'B0(NH4+–HS−, NH4+–HCO3−, NH4+–NH2COO−) and λ(NH3–NH4+) fitted (multicalci, 2026) to 99 measured partial pressures: Müller (1983), Wilson, Gillespie & Owens (1985), API data (Beutier & Renon 1978), Leyko (1959)';
const IDX = Object.fromEntries(SP.map((s, i) => [s, i]));
const pT = (a, T) => a[0] + (a[1] || 0) * (1 / T - 1 / 298.15);
function swCompile(T, A0, bNN, bCC, par) {
  const P = par || SW_PAR;
  const L = (tbl) => Object.entries(tbl || {}).map(([k, a]) => { const [x, y] = k.split('|').map((q) => IDX[q]); return [x, y, pT(a, T)]; }).filter((r) => r[2] !== 0);
  const LAM = L(P.LAM);
  if (bNN) LAM.push([0, 0, bNN]);
  if (bCC) LAM.push([1, 1, bCC]);
  return pz.compile(SP, ZS, { B0: L(P.B0), B1: L(P.B1), C0: L(P.C0), LAM }, A0);
}

/**
 * Speciation of sour water.
 * @param {number} T K
 * @param {{w:number,N:number,S:number,C:number,Na:number}} ap apparent moles (any total)
 * @param {{aphi:(T:number)=>number, lnKw:(T:number)=>number}} h helpers
 * @param {number[]|null} guess previous unknown vector (ln molalities of the 11 free species + ln W)
 * @param {{noBeta?:boolean, par?:object}} [opt]
 * @returns {object} molalities q, ln γ, water activity, free water W (kg), residual
 */
export function swSpeciate(T, ap, h, guess, opt) {
  const o = opt || {};
  const lnKN = lnKf(SW.KN, T), lnKC1 = lnKf(SW.KC1, T), lnKC2 = lnKf(SW.KC2, T);
  const lnKS1 = lnKf(SW.KS1, T), lnKS2 = lnKf(SW.KS2, T), lnKCB = lnKf(SW.KCB, T);
  const lnKw = h.lnKw(T);
  const A0 = h.aphi(T);
  const bNN = o.noBeta ? 0 : SW.BNN[0] + SW.BNN[1] / T, bCC = o.noBeta ? 0 : SW.BCC[0] + SW.BCC[1] / T;
  const cp = swCompile(T, A0, bNN, bCC, o.par);
  const { w, N, S, C, Na } = ap;
  const m = new Float64Array(NS), lg = new Float64Array(NS);
  // unknowns v: ln m of SP[i] for i ≠ Na+ (11 values, Na+ skipped), then ln W
  const FREE = [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11];
  const NU = 12;
  const resid = (v) => {
    for (let q = 0; q < 11; q++) m[FREE[q]] = Math.exp(v[q]);
    const W = Math.exp(v[11]);
    m[4] = Na / W;
    const pr = pz.evaluate(cp, m, lg);
    const la = (i) => lg[i] + Math.log(m[i]);
    const lnaw = pr.lnaw;
    const r = new Array(NU);
    r[0] = la(3) + la(6) - la(0) - lnaw - lnKN;             // NH3 + H2O = NH4+ + OH−
    r[1] = la(7) + la(5) - la(1) - lnaw - lnKC1;            // CO2 + H2O = HCO3− + H+
    r[2] = la(8) + la(5) - la(7) - lnKC2;                   // HCO3− = CO3−− + H+
    r[3] = la(9) + la(5) - la(2) - lnKS1;                   // H2S = HS− + H+
    r[4] = la(10) + la(5) - la(9) - lnKS2;                  // HS− = S−− + H+
    r[5] = la(11) + lnaw - la(0) - la(7) - lnKCB;           // NH3 + HCO3− = NH2COO− + H2O
    r[6] = la(5) + la(6) - lnaw - lnKw;                     // H2O = H+ + OH−
    r[7] = ((m[0] + m[3] + m[11]) * W - N) / N;
    r[8] = ((m[1] + m[7] + m[8] + m[11]) * W - C) / C;
    r[9] = ((m[2] + m[9] + m[10]) * W - S) / S;
    const pos = m[3] + m[4] + m[5], neg = m[6] + m[7] + 2 * m[8] + m[9] + 2 * m[10] + m[11];
    r[10] = (pos - neg) / (pos + neg);
    r[11] = (W / MW + W * (2 * m[1] + 3 * m[7] + 3 * m[8] + 2 * m[11] + m[6]) - (w + 2 * C + Na)) / w;
    return { r, lnaw, I: pr.I, phi: pr.phi };
  };
  const norm = (r) => { let x = 0; for (const v of r) { const a = Math.abs(v); if (!(a <= x)) x = a; } return x; };
  let v = guess && guess.length === NU ? guess.slice() : null;
  if (!v) {
    // ideal start (γ = 1, a_w = 1): for each ln m_H the NH3 / CO2 balances are a quadratic
    // (carbamate couples them); the charge balance is then solved by bisection on ln m_H
    const KN = Math.exp(lnKN), KC1 = Math.exp(lnKC1), KC2 = Math.exp(lnKC2), KS1 = Math.exp(lnKS1), KS2 = Math.exp(lnKS2), KCB = Math.exp(lnKCB), Kw = Math.exp(lnKw);
    const W0 = w * MW;
    const Nm = N / W0, Cm = C / W0, Sm = S / W0, Nam = Na / W0;
    const parts = (lh) => {
      const mH = Math.exp(lh), mOH = Kw / mH;
      const aN = 1 + KN / mOH;
      const aC = 1 + KC1 / mH + KC1 * KC2 / (mH * mH);
      const kap = KCB * KC1 / mH;
      const A = kap * aC / aN, B = aC + kap * (Nm - Cm) / aN;
      const c = Cm > 0 ? 2 * Cm / (B + Math.sqrt(Math.max(B * B + 4 * A * Cm, 0))) : 0;
      const a = Math.max((Nm - Cm + aC * c) / aN, Nm * 1e-30);
      const mHCO3 = KC1 * c / mH, mCO3 = KC2 * mHCO3 / mH, mCB = KCB * a * mHCO3;
      const s = Sm / (1 + KS1 / mH + KS1 * KS2 / (mH * mH));
      const mHS = KS1 * s / mH, mS = KS2 * mHS / mH;
      const mNH4 = KN * a / mOH;
      return { a, c, s, mH, mOH, mNH4, mHCO3, mCO3, mHS, mS, mCB, ch: mNH4 + mH + Nam - mOH - mHCO3 - 2 * mCO3 - mHS - 2 * mS - mCB };
    };
    let lo = -80, hi = 5;
    for (let it = 0; it < 200; it++) {
      const mid = 0.5 * (lo + hi), q = parts(mid);
      if (q.ch > 0) hi = mid; else lo = mid;
      if (hi - lo < 1e-12) break;
    }
    const q = parts(0.5 * (lo + hi));
    const fl = (x) => Math.log(Math.max(x, 1e-250));
    v = [fl(q.a), fl(q.c), fl(q.s), fl(q.mNH4), fl(q.mH), fl(q.mOH), fl(q.mHCO3), fl(q.mCO3), fl(q.mHS), fl(q.mS), fl(q.mCB), Math.log(W0)];
  }
  let cur = resid(v), nrm = norm(cur.r);
  const J = Array.from({ length: NU }, () => new Array(NU));
  for (let it = 0; it < 120 && nrm > 1e-12; it++) {
    for (let c = 0; c < NU; c++) {
      const vp = v.slice(); vp[c] += 1e-7;
      const rp = resid(vp).r;
      for (let k = 0; k < NU; k++) J[k][c] = (rp[k] - cur.r[k]) / 1e-7;
    }
    const dv = solve7(J, cur.r.map((x) => -x));
    if (!dv) break;
    let lim = 1; for (const d of dv) if (Math.abs(d) * lim > 4) lim = 4 / Math.abs(d);
    let alpha = lim, acc = false;
    for (let ls = 0; ls < 40; ls++) {
      const vn = v.map((x, i) => x + alpha * dv[i]);
      const cn = resid(vn), nn = norm(cn.r);
      if (isFinite(nn) && (nn < nrm * (1 - 1e-4 * alpha) || nn < 1e-12)) { v = vn; cur = cn; nrm = nn; acc = true; break; }
      alpha *= 0.5;
    }
    if (!acc) break;
  }
  // final state (recompute γ at the accepted point)
  const fin = resid(v);
  const g = (i) => Math.exp(lg[i]);
  const q = {
    a: m[0], c: m[1], s: m[2], mNH4: m[3], mNa: m[4], mH: m[5], mOH: m[6], mHCO3: m[7], mCO3: m[8], mHS: m[9], mS: m[10], mCB: m[11],
    W: Math.exp(v[11]), I: fin.I, aw: Math.exp(fin.lnaw), gN: g(0), gC: g(1), gS: g(2), lgH: lg[5], lgNa: lg[4], lgOH: lg[6], phi: fin.phi,
  };
  return { v, q, lnaw: fin.lnaw, resid: nrm, lg: Array.from(lg), m: Array.from(m) };
}
function solve7(A, b) {
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

/** ln f [Pa] of NH3, CO2, H2S (molecular Henry's law with Poynting) and of water, from a speciated state */
export function swFugacities(T, P, sp, h) {
  const q = sp.q, psw = h.psatW(T);
  const dp = Math.max(P - psw, 0) / (R * T);
  return {
    NH3: lnKf(SW.HN, T) + Math.log(1e5) + Math.log(q.gN * q.a) + SW.V.NH3 * dp,
    CO2: lnKf(SW.HC, T) + Math.log(1e5) + Math.log(q.gC * q.c) + SW.V.CO2 * dp,
    H2S: h.lnKhH2S(T) + Math.log(MW) + Math.log(q.gS * q.s) + SW.V.H2S * dp,
    H2O: sp.lnaw + Math.log(psw) + (h.lnPhiSatW ? h.lnPhiSatW(T) : 0) + SW.V.H2O * dp,
  };
}

/**
 * Electrolyte implementation for mb-electrolyte.makeElectrolyte.
 * @param {string[]} keys package keys
 * @param {object} h helpers {aphi, lnKw, lnKhH2S, psatW, lnPhiSatW?, rhoW}
 */
export function makeSourWater(keys, h) {
  const ALL = ['H2O', 'NH3', 'H2S', 'CO2', 'NaOH'];
  const owned = ALL.filter((k) => keys.includes(k));
  const idx = owned.map((k) => keys.indexOf(k));
  const EPS = 1e-13;
  /** apparent sub-composition over the owned keys (absent ones → tiny); S = owned share of the liquid */
  const sub = (x) => {
    const xk = {};
    let s = 0;
    owned.forEach((k, j) => { let v = x[idx[j]]; if (!(v > EPS)) v = EPS; xk[k] = v; s += v; });
    for (const k of owned) xk[k] /= s;
    return { xk, S: s, w: xk.H2O || EPS };
  };
  let warm = null;
  const cache = new Map();
  const MMAX = 10;                 // mol solute per kg water solved directly; beyond, extrapolated from this boundary
  const solve = (T, ap) => {
    let r = null;
    if (warm && Math.abs(warm.T - T) < 25) { r = swSpeciate(T, ap, h, warm.v); if (!(r.resid < 1e-9)) r = null; }
    if (!r) { r = swSpeciate(T, ap, h, null); if (!(r.resid < 1e-9)) r = null; }
    if (!r) {
      // continuation from a dilute solution of the same proportions
      let g = null;
      for (const f of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1]) {
        const a2 = { w: ap.w, N: ap.N * f, S: ap.S * f, C: ap.C * f, Na: ap.Na * f };
        const q = swSpeciate(T, a2, h, g);
        if (!(q.resid < 1e-9)) { g = null; break; }
        g = q.v; r = q;
      }
      if (!g) r = null;
    }
    if (!r) throw new Error(`sour-water speciation did not converge at ${T.toFixed(2)} K`);
    warm = { T, v: r.v };
    return r;
  };
  // ln f (P-independent part) of the gases, ln a_w and ln a_NaOH of a speciated state
  const valsOf = (T, sp) => {
    const f = swFugacities(T, 0, sp, h);
    return [f.NH3, f.CO2, f.H2S, sp.lnaw, sp.q.lgNa + sp.q.lgOH + Math.log(Math.max(sp.q.mNa, 1e-300) * sp.q.mOH)];
  };
  function core(T0, xs) {
    const T = Math.min(Math.max(T0, 273.15), 573.15);
    const k = T + '|' + owned.map((q) => xs.xk[q]).join('|');
    let c = cache.get(k);
    if (c) return c;
    const w = xs.xk.H2O || EPS;
    const ap = { w, N: xs.xk.NH3 || EPS * 1e-3, S: xs.xk.H2S || EPS * 1e-3, C: xs.xk.CO2 || EPS * 1e-3, Na: xs.xk.NaOH || 0 };
    const mt = (ap.N + ap.S + ap.C + ap.Na) / (w * MW);
    if (mt <= MMAX) {
      const sp = solve(T, ap);
      c = { sp, vals: valsOf(T0, sp), clamped: false, T };
    } else {
      const sc = MMAX / mt, eps = 1e-4;
      const at = (f) => ({ w, N: ap.N * f, S: ap.S * f, C: ap.C * f, Na: ap.Na * f });
      const sp = solve(T, at(sc));
      const v1 = valsOf(T0, sp), v2 = valsOf(T0, solve(T, at(sc * (1 - eps))));
      const dl = -Math.log(sc) / -Math.log(1 - eps);
      c = { sp, vals: v1.map((x, i) => x + (x - v2[i]) * dl), clamped: true, T };
    }
    if (cache.size > 300) cache.clear();
    cache.set(k, c);
    return c;
  }
  function lnf(T0, xs) {
    const c = core(T0, xs);
    const out = { NH3: c.vals[0], CO2: c.vals[1], H2S: c.vals[2], H2O: c.vals[3] + Math.log(h.psatW(T0)) + (h.lnPhiSatW ? h.lnPhiSatW(T0) : 0) };
    if (owned.includes('NaOH')) out.NaOH = Math.log(1e-30);
    return { out, sp: c.sp, c };
  }
  return {
    solvent: 'H2O', keys: owned, sub, heavy: ['H2O', 'NaOH'], gasRef: ['NH3', 'H2S', 'CO2'], salts: ['NaOH'],
    waterTransport: true, waterIF97: true,       // dilute: viscosity, conductivity and surface tension of water
    vInf: { NH3: SW.V.NH3, CO2: SW.V.CO2, H2S: SW.V.H2S },
    xsub: (xs, key) => xs.xk[key],
    lnPhiSub(T, xs) {
      const { out } = lnf(T, xs);
      const r = {};
      for (const k of owned) r[k] = out[k] - Math.log(xs.xk[k]);
      return r;
    },
    lnRel(T, xs) {
      const { out, c } = lnf(T, xs);
      const r = { H2O: c.vals[3] };
      for (const k of ['NH3', 'H2S', 'CO2']) if (owned.includes(k)) r[k] = out[k];
      if (owned.includes('NaOH')) r.NaOH = c.vals[4];
      return r;
    },
    saltRef(T, key) {
      const c = NAOH_REC;
      return { h: c.hf / 1000 + c.cp_aq * (T - 298.15), s: c.s0 / 1000 + c.cp_aq * Math.log(T / 298.15) };
    },
    saltLnAct(T, xs, key) { return this.lnRel(T, xs).NaOH || 0; },
    volume(T, xs) {
      // free and reacted water at the saturated-liquid density plus apparent molar volumes of the solutes
      const x = xs.xk;
      return (x.H2O || 0) * MW / (h.rhoW(T) * 1000) + (x.NH3 || 0) * 24.5e-6 + (x.H2S || 0) * 35e-6 + (x.CO2 || 0) * 33e-6 + (x.NaOH || 0) * -4e-6;
    },
    report(T, xs) {
      const c = core(T, xs), sp = c.sp;
      const q = sp.q;
      const f = { NH3: c.vals[0], CO2: c.vals[1], H2S: c.vals[2] };
      const pp = (k) => (owned.includes(k) ? Math.exp(f[k]) / 1000 : 0);
      const totN = q.a + q.mNH4 + q.mCB;
      return {
        model: 'sour-water', pH: -(q.lgH + Math.log(q.mH)) / LN10, pH_scale: 'unscaled', ionic_strength_mol_kg: q.I, water_activity: Math.exp(c.vals[3]),
        ...(c.clamped ? { extrapolated: 'above 10 mol solute per kg water: speciation shown at that boundary, pressures extrapolated' } : {}),
        free_NH3_fraction: totN > 0 ? q.a / totN : null,
        molality: { NH3: q.a, 'NH4+': q.mNH4, H2S: q.s, 'HS-': q.mHS, 'S--': q.mS, CO2: q.c, 'HCO3-': q.mHCO3, 'CO3--': q.mCO3, 'NH2COO-': q.mCB, 'OH-': q.mOH, 'H+': q.mH, ...(q.mNa > 0 ? { 'Na+': q.mNa } : {}) },
        P_NH3_eq_kPa: pp('NH3'), P_H2S_eq_kPa: pp('H2S'), P_CO2_eq_kPa: pp('CO2'),
        density_kg_m3: owned.reduce((s, k) => s + xs.xk[k] * { H2O: 18.01528, NH3: 17.03052, H2S: 34.08088, CO2: 44.0095, NaOH: 39.99711 }[k], 0) / 1000 / this.volume(T, xs),
      };
    },
    warn(xs, T) {
      const out = [];
      const x = xs.xk, mw = (x.H2O || 1e-12) * MW;
      const tot = ((x.NH3 || 0) + (x.H2S || 0) + (x.CO2 || 0) + 2 * (x.NaOH || 0)) / mw;
      if (tot > 10) out.push(`sour water: ${tot.toFixed(1)} mol solute per kg water — beyond the 10 mol/kg the Kawazuishi–Prausnitz correlation was checked to`);
      if (T > 473.15) out.push('sour water: above 200 °C the equilibrium constants (fitted to 0–175 °C for NH3, 0–160 °C for carbamate) are extrapolated');
      if ((x.NaOH || 0) > 0.02) out.push('sour water: more than 2 mol % NaOH — Na⁺ interaction parameters exist only with OH⁻, HCO₃⁻ and CO₃²⁻ (none with HS⁻ or carbamate), so results are indicative; caustic without NH₃ / H₂S belongs to the aqueous-electrolyte method');
      return out.join('; ') || null;
    },
  };
}

export default { SW, SW_PAR, SW_FIT, SP, NAOH_REC, swSpeciate, swFugacities, makeSourWater };
