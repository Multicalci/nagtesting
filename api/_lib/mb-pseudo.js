// ============================================================================
// mb-pseudo.js — STEP 34: petroleum pseudo-components (characterised by the
// normal boiling point Tb and specific gravity SG 60/60 °F, molar mass
// optional) and TBP assay cutting.
//
// Critical properties (method):
//   'twu'          Twu (1984): n-alkane reference + SG perturbation (Tc, Pc,
//                  Vc, MW) — the default; best for heavy fractions
//   'riazi'        Riazi–Daubert (1987, API Technical Data Book form): Tc, Pc,
//                  MW from exp(a·Tb + b·SG + c·Tb·SG)·Tb^d·SG^e
//   'lee-kesler'   Kesler–Lee (1976) Tc, Pc; MW Riazi–Daubert (1987)
// Acentric factor: Kesler–Lee (from the Lee–Kesler vapour-pressure equation
//   through Tb). Vapour pressure: Lee–Kesler. ΔHvap: Riedel at Tb, Watson
//   exponent 0.38. Liquid density: Rackett, Z_RA fitted so ρ(15.56 °C) is the
//   SG. Ideal-gas Cp: cp = (−1.10153 + 0.0890245 Kw) + (2.86409 + 0.253512 Kw)·t
//   + (−2.00616 − 0.0214628 Kw)·t² kJ/(kg K), t = T/1000 K — fitted here to the
//   ideal-gas Cp of the databank's 170 C5+ hydrocarbons (paraffins,
//   naphthenes, olefins, aromatics; Watson K 8.6–13.5; 300–1000 K): 5.0 % rms.
//   Formation properties follow the n-paraffin of the same carbon number
//   (the enthalpy reference only; pseudo-components never react).
//   Liquid viscosity: the n-paraffin of the same Tb at the same T/Tb
//   (corresponding states on the databank n-alkanes) — an estimate.
//
// Pseudo-components are registered into the component databank at run time
// under a key that encodes their definition (e.g. PC450.0_0.7800), so the same
// key always carries the same properties.
//
// TBP assay cutting: a TBP curve (volume % distilled vs T), a bulk SG (or
// API), and the cuts (a number of equal-temperature cuts, or cut points) give
// one pseudo-component per cut — Tb the volume-average boiling point of the
// cut, SG from a constant Watson K chosen so the cuts' volume-average SG is
// the bulk SG, and the cut's volume → mass → mole fractions.
//
// Plain ES module. Server-side only. (c) multicalci.com
// ============================================================================

import compdb from './mb-compdb.js';

export const PSEUDO_VERSION = 'mb-pseudo 1.0.0';
const R = 8.314462618;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
class PseudoError extends Error { constructor(code, message, field) { super(message); this.code = code; this.field = field; } }
const fail = (code, message, field) => { throw new PseudoError(code, message, field); };
export const METHODS = ['twu', 'riazi', 'lee-kesler'];

// ---------------------------------------------------------------------------
// correlations (Tb in K, SG 60/60 °F; Pc in bar unless noted)
// ---------------------------------------------------------------------------
/** Riazi–Daubert (1987) — API TDB: θ = a·exp(b·Tb + c·SG + d·Tb·SG)·Tb^e·SG^f */
export function riaziDaubert(Tb, SG) {
  const f = (a, b, c, d, e, g) => a * Math.exp(b * Tb + c * SG + d * Tb * SG) * Math.pow(Tb, e) * Math.pow(SG, g);
  return {
    MW: f(42.965, 2.097e-4, -7.78712, 2.08476e-3, 1.26007, 4.98308),
    Tc: f(9.5233, -9.314e-4, -0.544442, 6.4791e-4, 0.81067, 0.53691),
    Pc: f(3.1958e5, -8.505e-3, -4.8014, 5.749e-3, -0.4844, 4.0846),
  };
}
/** Kesler–Lee (1976) Tc [K], Pc [bar] */
export function keslerLee(Tb, SG) {
  const Tc = 189.8 + 450.6 * SG + (0.4244 + 0.1174 * SG) * Tb + (0.1441 - 1.0069 * SG) * 1e5 / Tb;
  const s2 = SG * SG;
  const lnPc = 5.689 - 0.0566 / SG - (0.43639 + 4.1216 / SG + 0.21343 / s2) * 1e-3 * Tb
    + (0.47579 + 1.182 / SG + 0.15302 / s2) * 1e-6 * Tb * Tb - (2.4505 + 9.9099 / s2) * 1e-10 * Tb * Tb * Tb;
  return { Tc, Pc: Math.exp(lnPc) };
}
/** Twu (1984): Tc [K], Pc [bar], Vc [m³/kmol], MW — computed in °R, psia, ft³/lbmol as published */
export function twu(Tb_K, SG) {
  const Tb = Tb_K * 1.8;
  // n-alkane reference
  const Tco = Tb / (0.533272 + 0.191017e-3 * Tb + 0.779681e-7 * Tb * Tb - 0.284376e-10 * Tb * Tb * Tb + 0.959468e28 / Math.pow(Tb, 13));
  const a = 1 - Tb / Tco;
  const Pco = Math.pow(3.83354 + 1.19629 * Math.sqrt(a) + 34.8888 * a + 36.1952 * a * a + 104.193 * Math.pow(a, 4), 2);
  const Vco = Math.pow(1 - (0.419869 - 0.505839 * a - 1.56436 * Math.pow(a, 3) - 9481.70 * Math.pow(a, 14)), -8);
  const SGo = 0.843593 - 0.128624 * a - 3.36159 * Math.pow(a, 3) - 13749.5 * Math.pow(a, 12);
  // M° from Tb = exp(5.71419 + 2.71579θ − 0.286590θ² − 39.8544/θ − 0.122488/θ²) − 24.7522θ + 35.3155θ², θ = ln M°
  const TbOf = (th) => Math.exp(5.71419 + 2.71579 * th - 0.286590 * th * th - 39.8544 / th - 0.122488 / (th * th)) - 24.7522 * th + 35.3155 * th * th;
  let th = Math.log(Tb / (10.44 - 0.0052 * Tb));
  for (let k = 0; k < 60; k++) {
    const f = TbOf(th) - Tb, d = (TbOf(th + 1e-6) - TbOf(th - 1e-6)) / 2e-6;
    const st = f / d; th -= st;
    if (Math.abs(st) < 1e-12) break;
  }
  const sq = Math.sqrt(Tb);
  const pr = (f) => Math.pow((1 + 2 * f) / (1 - 2 * f), 2);
  const dT = Math.exp(5 * (SGo - SG)) - 1;
  const fT = dT * (-0.362456 / sq + (0.0398285 - 0.948125 / sq) * dT);
  const Tc = Tco * pr(fT);
  const dV = Math.exp(4 * (SGo * SGo - SG * SG)) - 1;
  const fV = dV * (0.466590 / sq + (-0.182421 + 3.01721 / sq) * dV);
  const Vc = Vco * pr(fV);
  const dP = Math.exp(0.5 * (SGo - SG)) - 1;
  const fP = dP * ((2.53262 - 46.1955 / sq - 0.00127885 * Tb) + (-11.4277 + 252.140 / sq + 0.00230535 * Tb) * dP);
  const Pc = Pco * (Tc / Tco) * (Vco / Vc) * pr(fP);
  const dM = Math.exp(5 * (SGo - SG)) - 1;
  const x = Math.abs(0.0123420 - 0.328086 / sq);
  const fM = dM * (x + (-0.0175691 + 0.193168 / sq) * dM);
  const MW = Math.exp(th * pr(fM));
  return { Tc: Tc / 1.8, Pc: Pc * 0.0689475729, Vc: Vc * 0.0624279606, MW };
}
/** Kesler–Lee acentric factor (Lee–Kesler vapour pressure through Tb; Kw form above Tbr 0.8) */
export function keslerLeeOmega(Tb, SG, Tc, Pc) {
  const Tbr = Tb / Tc;
  if (Tbr < 0.8) {
    const lt = Math.log(Tbr), t6 = Math.pow(Tbr, 6);
    return (-Math.log(Pc / 1.01325) - 5.92714 + 6.09648 / Tbr + 1.28862 * lt - 0.169347 * t6) / (15.2518 - 15.6875 / Tbr - 13.4721 * lt + 0.43577 * t6);
  }
  const Kw = Math.cbrt(1.8 * Tb) / SG;
  return -7.904 + 0.1352 * Kw - 0.007465 * Kw * Kw + 8.359 * Tbr + (1.408 - 0.01063 * Kw) / Tbr;
}
export const watsonK = (Tb, SG) => Math.cbrt(1.8 * Tb) / SG;
export const SGfromAPI = (api) => 141.5 / (api + 131.5);
export const APIfromSG = (sg) => 141.5 / sg - 131.5;

/** n-paraffin liquid viscosity reference: ln μ at T/Tb, interpolated on the databank n-alkanes */
let NREF = null;
function nParaffinRef() {
  if (NREF) return NREF;
  const ks = ['n-pentane', 'n-hexane', 'nC7H16', 'n-octane', 'n-nonane', 'n-decane', 'n-undecane', 'n-dodecane', 'n-tridecane', 'n-tetradecane', 'n-pentadecane', 'n-hexadecane', 'n-heptadecane', 'n-octadecane', 'n-nonadecane', 'n-eicosane'];
  NREF = ks.map((k) => compdb.get(k)).filter((c) => c && c.mul && c.tb).map((c) => ({ c, Tb: c.tb })).sort((a, b) => a.Tb - b.Tb);
  return NREF;
}
function corr101(k, T) { return Math.exp(k[1] + k[2] / T + k[3] * Math.log(T) + k[4] * Math.pow(T, k[5])); }
export function lnMuRef(Tb, T) {
  const ref = nParaffinRef();
  const r = T / Tb;
  const at = (q) => { const c = q.c, Tq = Math.min(Math.max(r * q.Tb, c.mul[6]), c.mul[7]); return Math.log(c.mul[0] === 101 ? corr101(c.mul, Tq) : 1e-3); };
  if (Tb <= ref[0].Tb) return at(ref[0]) + (Tb - ref[0].Tb) / (ref[1].Tb - ref[0].Tb) * (at(ref[1]) - at(ref[0]));
  for (let i = 0; i < ref.length - 1; i++) if (Tb <= ref[i + 1].Tb) { const f = (Tb - ref[i].Tb) / (ref[i + 1].Tb - ref[i].Tb); return at(ref[i]) + f * (at(ref[i + 1]) - at(ref[i])); }
  const a = ref[ref.length - 2], b = ref[ref.length - 1];
  return at(b) + (Tb - b.Tb) / (b.Tb - a.Tb) * (at(b) - at(a));
}

/** canonical databank key of a pseudo-component definition */
export function pseudoKey(d) {
  const m = d.method && d.method !== 'twu' ? (d.method === 'riazi' ? '_RD' : '_LK') : '';
  return 'PC' + d.Tb_K.toFixed(1) + '_' + d.SG.toFixed(4) + (num(d.MW) ? '_M' + d.MW.toFixed(2) : '') + m;
}

/**
 * Properties of a pseudo-component and its databank record (ChemSep units: Pa, J/kmol, m³/kmol).
 * @param {{Tb_K:number, SG:number, MW?:number, method?:string, name?:string}} d
 */
export function pseudoRecord(d) {
  const Tb = d.Tb_K, SG = d.SG;
  if (!num(Tb) || Tb < 250 || Tb > 1100) fail('MB_PSEUDO', 'pseudo-component: Tb_K must be 250–1100 K', 'Tb_K');
  if (!num(SG) || SG < 0.55 || SG > 1.3) fail('MB_PSEUDO', 'pseudo-component: SG must be 0.55–1.3', 'SG');
  const method = d.method || 'twu';
  if (!METHODS.includes(method)) fail('MB_PSEUDO', `pseudo-component: method must be ${METHODS.join(' | ')}`, 'method');
  let Tc, Pc, Vc = null, MW;
  const rd = riaziDaubert(Tb, SG);
  if (method === 'twu') { const t = twu(Tb, SG); Tc = t.Tc; Pc = t.Pc; Vc = t.Vc; MW = t.MW; }
  else if (method === 'riazi') { Tc = rd.Tc; Pc = rd.Pc; MW = rd.MW; }
  else { const k = keslerLee(Tb, SG); Tc = k.Tc; Pc = k.Pc; MW = rd.MW; }
  if (num(d.MW)) { if (d.MW < 30 || d.MW > 2000) fail('MB_PSEUDO', 'pseudo-component: MW must be 30–2000', 'MW'); MW = d.MW; }
  if (!(Tc > Tb && Pc > 0.1 && MW > 0)) fail('MB_PSEUDO', `pseudo-component: the ${method} correlations give no valid critical point for Tb ${Tb} K, SG ${SG}`, 'Tb_K');
  const w = keslerLeeOmega(Tb, SG, Tc, Pc);
  const Zc = 0.2905 - 0.085 * w;                                   // Pitzer
  if (!num(Vc)) Vc = Zc * R * Tc / (Pc * 1e5) * 1000;             // m³/kmol
  const Kw = watsonK(Tb, SG);
  // Lee–Kesler vapour pressure as ChemSep eq 101: ln P = A + B/T + C ln T + D T^6
  const lnPc = Math.log(Pc * 1e5);
  const psat = [101, lnPc + (5.92714 + 15.2518 * w) + (1.28862 + 13.4721 * w) * Math.log(Tc), -(6.09648 + 15.6875 * w) * Tc,
    -(1.28862 + 13.4721 * w), (0.169347 + 0.43577 * w) / Math.pow(Tc, 6), 6, Math.max(0.3 * Tc, 150), Tc];
  // Riedel ΔHvap at Tb, Watson 0.38 (eq 106: A (1 − Tr)^B)
  const Tbr = Tb / Tc;
  const dHb = 1.093 * R * Tc * Tbr * (Math.log(Pc) - 1.013) / (0.930 - Tbr) * 1000;   // J/kmol
  const hvap = [106, dHb / Math.pow(1 - Tbr, 0.38), 0.38, 0, 0, 0, Math.max(0.3 * Tc, 150), Tc];
  // Rackett with Z_RA through ρ(288.71 K) = SG·999.0 kg/m³ (eq 105: ρ = A / B^(1 + (1 − T/C)^D) kmol/m³)
  const A = Pc * 1e5 / (8314.462618 * Tc);
  const rho15 = SG * 999.0 / MW;                                    // kmol/m³
  const tau15 = Math.max(1 - 288.71 / Tc, 0);
  const zra = Math.pow(A / rho15, 1 / (1 + Math.pow(tau15, 2 / 7)));
  const rhol = [105, A, zra, Tc, 2 / 7, 0, Math.max(0.3 * Tc, 150), Tc];
  // ideal-gas Cp (eq 3, J/(kmol K))
  const ca = -1.10153 + 0.0890245 * Kw, cb = 2.86409 + 0.253512 * Kw, cc = -2.00616 - 0.0214628 * Kw;
  const cpig = [3, 1000 * ca * MW, cb * MW, cc * MW / 1000, 0, 0, 250, 1100];
  // formation properties of the n-paraffin of the same carbon number (reference only)
  const nC = Math.max(1, (MW - 2.016) / 14.027);
  const hf = (-43.4 - 20.6 * nC) * 1e6, gf = (-50.2 + 8.34 * nC) * 1e6, s0 = (153.3 + 39.24 * nC) * 1e3;
  // liquid viscosity: n-paraffin of the same Tb at the same T/Tb, fitted to eq 101 (A + B/T + C ln T)
  let mul = null;
  try {
    const Ts = [0.55, 0.7, 0.85, 1.0, 1.15].map((r) => r * Tb).filter((T) => T < 0.95 * Tc);
    if (Ts.length >= 3) {
      const ys = Ts.map((T) => lnMuRef(Tb, T));
      // least squares in [1, 1/T, ln T]
      const M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v3 = [0, 0, 0];
      Ts.forEach((T, k) => { const f = [1, 1 / T, Math.log(T)]; for (let i = 0; i < 3; i++) { v3[i] += f[i] * ys[k]; for (let j = 0; j < 3; j++) M3[i][j] += f[i] * f[j]; } });
      const sol = solve3(M3, v3);
      if (sol.every(num)) mul = [101, sol[0], sol[1], sol[2], 0, 0, Math.min(...Ts) * 0.9, Math.max(...Ts)];
    }
  } catch (_e) { mul = null; }
  const rec = {
    name: d.name || `Pseudo NBP ${(Tb - 273.15).toFixed(0)} °C, SG ${SG.toFixed(4)}`, cas: '', formula: '', family: 0,
    mw: MW, tc: Tc, pc: Pc * 1e5, vc: Vc, zc: Zc, w, tb: Tb, hf, gf, s0, zra, vcost: Vc, wcost: w,
    psat, cpig, hvap, rhol, cat: 'pseudo', pseudo: { Tb_K: Tb, SG, API: APIfromSG(SG), Kw, method, MW_given: num(d.MW) },
  };
  if (mul) rec.mul = mul;
  return rec;
}
function solve3(A, b) {
  const M = A.map((r, i) => r.concat([b[i]]));
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let j = i; j < 4; j++) M[r][j] -= f * M[i][j]; }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/**
 * Register pseudo-component definitions into the databank (idempotent).
 * Each definition must carry its canonical key, or none (then it is assigned).
 * @returns {string[]} keys
 */
export function registerPseudos(list) {
  if (!Array.isArray(list)) fail('MB_PSEUDO', 'pseudo_components must be an array', 'pseudo_components');
  if (list.length > 60) fail('MB_PSEUDO', 'at most 60 pseudo-components', 'pseudo_components');
  const keys = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!d || typeof d !== 'object') fail('MB_PSEUDO', `pseudo_components[${i}] must be an object {Tb_K, SG, MW?, method?}`, 'pseudo_components');
    const k = pseudoKey({ Tb_K: d.Tb_K, SG: d.SG, MW: d.MW, method: d.method });
    if (d.key !== undefined && d.key !== k) fail('MB_PSEUDO', `pseudo_components[${i}]: key '${d.key}' does not match its definition (expected '${k}')`, 'pseudo_components');
    if (!compdb.has(k)) {
      const rec = pseudoRecord(Object.assign({}, d, { Tb_K: +d.Tb_K.toFixed(1), SG: +d.SG.toFixed(4), MW: num(d.MW) ? +d.MW.toFixed(2) : undefined }));
      compdb.COMPS[k] = rec;
    }
    keys.push(k);
  }
  return keys;
}

/** table interpolation, x increasing */
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0] + (x - xs[0]) * (ys[1] - ys[0]) / (xs[1] - xs[0]);
  for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) return ys[i] + (x - xs[i]) * (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  const n = xs.length;
  return ys[n - 1] + (x - xs[n - 1]) * (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2]);
}

/**
 * Cut a TBP assay into pseudo-components.
 * @param {{tbp:[number,number][] (vol %, T K), SG?:number, API?:number, cuts?:number, cut_T_K?:number[], method?:string}} a
 */
export function cutAssay(a) {
  if (!a || !Array.isArray(a.tbp) || a.tbp.length < 3 || a.tbp.length > 60) fail('MB_ASSAY', 'assay: tbp needs 3–60 points [volume %, T K]', 'tbp');
  const pts = a.tbp.map((p, i) => {
    if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) fail('MB_ASSAY', `assay: tbp point ${i + 1} must be [volume %, T K]`, 'tbp');
    return { v: p[0], T: p[1] };
  });
  for (let i = 1; i < pts.length; i++) if (!(pts[i].v > pts[i - 1].v && pts[i].T > pts[i - 1].T)) fail('MB_ASSAY', 'assay: TBP volume % and temperatures must both increase', 'tbp');
  if (pts[0].v < 0 || pts[pts.length - 1].v > 100) fail('MB_ASSAY', 'assay: volume % must lie within 0–100', 'tbp');
  const SGb = num(a.SG) ? a.SG : num(a.API) ? SGfromAPI(a.API) : NaN;
  if (!(SGb > 0.55 && SGb < 1.3)) fail('MB_ASSAY', 'assay: give the bulk SG (0.55–1.3) or API gravity', 'SG');
  const v0 = pts[0].v, v1 = pts[pts.length - 1].v;
  const vs = pts.map((p) => p.v), Ts = pts.map((p) => p.T);
  const Tat = (v) => interp(vs, Ts, v);
  // volume-average boiling point of the whole assay (Simpson on the TBP)
  const avgT = (va, vb) => { const n = 40, h = (vb - va) / n; let s = Tat(va) + Tat(vb); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * Tat(va + i * h); return s * h / 3 / (vb - va); };
  const VABP = avgT(v0, v1);
  const Kw = watsonK(VABP, SGb);
  // cut temperatures
  let cutsT;
  if (Array.isArray(a.cut_T_K) && a.cut_T_K.length) {
    cutsT = a.cut_T_K.slice().sort((x, y) => x - y).filter((T) => T > Ts[0] && T < Ts[Ts.length - 1]);
  } else {
    const n = num(a.cuts) ? Math.round(a.cuts) : 8;
    if (n < 1 || n > 40) fail('MB_ASSAY', 'assay: cuts must be 1–40', 'cuts');
    cutsT = []; for (let i = 1; i < n; i++) cutsT.push(Ts[0] + (Ts[Ts.length - 1] - Ts[0]) * i / n);
  }
  const vOfT = (T) => interp(Ts, vs, T);
  const bounds = [v0, ...cutsT.map(vOfT), v1];
  const raw = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const va = bounds[i], vb = bounds[i + 1];
    if (!(vb - va > 1e-9)) continue;
    raw.push({ va, vb, Tb: avgT(va, vb) });
  }
  // constant Watson K, scaled so the cuts' volume-average SG equals the bulk SG exactly
  const vt = raw.reduce((x, r) => x + (r.vb - r.va), 0);
  const sg0 = raw.reduce((x, r) => x + (r.vb - r.va) * Math.cbrt(1.8 * r.Tb), 0) / vt;   // Σ v Tb^⅓ (×1.8^⅓)
  const KwC = sg0 / SGb;
  const comps = [];
  for (const { va, vb, Tb } of raw) {
    const SG = Math.cbrt(1.8 * Tb) / KwC;
    const d = { Tb_K: +Tb.toFixed(1), SG: +SG.toFixed(4), method: a.method && a.method !== 'twu' ? a.method : undefined };
    d.key = pseudoKey(d);
    const rec = pseudoRecord(d);
    comps.push({ key: d.key, Tb_K: d.Tb_K, SG: d.SG, method: d.method, vol_frac: (vb - va) / (v1 - v0), T_from_K: Tat(va), T_to_K: Tat(vb), MW: rec.mw, Tc_K: rec.tc, Pc_bar: rec.pc / 1e5, omega: rec.w });
  }
  // volume → mass → mole fractions (liquid volumes at 15.56 °C)
  const mass = comps.map((c) => c.vol_frac * c.SG), sm = mass.reduce((x, y) => x + y, 0);
  const mol = comps.map((c, i) => mass[i] / c.MW), sn = mol.reduce((x, y) => x + y, 0);
  comps.forEach((c, i) => { c.mass_frac = mass[i] / sm; c.mole_frac = mol[i] / sn; });
  const SGcalc = sm / comps.reduce((x, c) => x + c.vol_frac, 0);
  return { components: comps, VABP_K: VABP, Kw: KwC, Kw_VABP: Kw, SG_bulk: SGb, SG_check: SGcalc, API_bulk: APIfromSG(SGb), MW_avg: sm / sn, method: a.method || 'twu' };
}

export { PseudoError };
export default { PSEUDO_VERSION, METHODS, pseudoKey, pseudoRecord, registerPseudos, cutAssay, riaziDaubert, keslerLee, twu, keslerLeeOmega, watsonK, SGfromAPI, APIfromSG, lnMuRef };
