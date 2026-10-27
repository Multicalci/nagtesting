// ============================================================================
// REPO PATH: api/_lib/mb-thermo.js
// ============================================================================
// multicalci.com — STEP 22 rigorous thermodynamics core.
//
// One property package per flowsheet (like the "Methods" of a commercial
// simulator) gives K-values, enthalpy, entropy and transport properties that
// are consistent for any mixture, and the flash routines every rigorous unit
// uses:
//
//   packages : 'pr' | 'srk'              cubic EOS, vdW mixing, ChemSep kij
//              'ideal'                    Raoult + ideal gas
//              'nrtl' | 'uniquac' | 'wilson' | 'unifac'
//                                         activity coefficient (γ–φ), vapour
//                                         ideal or PR/SRK
//   flashes  : PT (with Michelsen stability test), PH, PS, PVF (bubble/dew/
//              any vapour fraction at P), TVF (saturation pressure)
//
// Basis (same as the legacy engine): enthalpy on the FORMATION basis — ideal
// gas elements at 298.15 K have H = 0, so H_ig,i(T) = ΔHf,i + ∫Cp,ig dT.
// Entropy is absolute (third law), ideal-gas reference 101325 Pa.
// Liquid on activity packages: H_L = H_ig − ΔHvap(T) (+ H^E when enabled).
//
// Data: api/_lib/mb-compdb.js (ChemSep v8.32) and api/_lib/mb-bip.js.
// Internal units: T K, P Pa, energies J/mol, entropy J/(mol K).
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import compdb from './mb-compdb.js';
import bip from './mb-bip.js';
import mbData from './mb-data.js';
import { makeElectrolyte, ELECTROLYTE_MODELS, ELECTROLYTE_KEYS } from './mb-electrolyte.js';

export const THERMO_VERSION = 'mb-thermo 1.3.0';

const R = 8.314462618;          // J/(mol K)
const T0 = 298.15;              // K — formation / entropy reference
const P0 = 101325;              // Pa — ideal-gas entropy reference (ChemSep S°)
const SQ2 = Math.SQRT2;

// ---------------------------------------------------------------------------
// errors — the engine's envelope { error: { code, message, field } }
// ---------------------------------------------------------------------------
class ThermoError extends Error {
  constructor(code, message, field) { super(message); this.code = code; this.field = field || null; }
}
const fail = (code, msg, field) => { throw new ThermoError(code, msg, field); };
const num = (x) => typeof x === 'number' && isFinite(x);

// ---------------------------------------------------------------------------
// ChemSep temperature correlations
// ---------------------------------------------------------------------------

/**
 * Evaluate a ChemSep correlation [eq, A, B, C, D, E, Tmin, Tmax] at T.
 * Supported eq numbers: 1-5 (polynomials), 10 (Antoine), 16, 100, 101, 102,
 * 104, 105, 106, 116, 200 (Wagner 2.5-5, E = Pc). Tc is needed for 106/116/200.
 * @param {Array<number>} c
 * @param {number} T
 * @param {number} [Tc]
 * @returns {number}
 */
export function corr(c, T, Tc) {
  const [eq, A, B, C, D, E] = c;
  switch (eq) {
    case 1: return A;
    case 2: return A + B * T;
    case 3: return A + T * (B + C * T);
    case 4: return A + T * (B + T * (C + D * T));
    case 5: return A + T * (B + T * (C + T * (D + E * T)));
    case 10: return Math.exp(A - B / (T + C));
    case 16: return A + Math.exp(B / T + C + D * T + E * T * T);
    case 100: return A + T * (B + T * (C + T * (D + E * T)));
    case 101: return Math.exp(A + B / T + C * Math.log(T) + D * Math.pow(T, E));
    case 102: return A * Math.pow(T, B) / (1 + C / T + D / (T * T));
    case 104: return A + B / T + C / Math.pow(T, 3) + D / Math.pow(T, 8) + E / Math.pow(T, 9);
    case 105: {
      const tt = Math.max(1 - T / C, 0);
      return A / Math.pow(B, 1 + Math.pow(tt, D));
    }
    case 106: {
      const Tr = T / Tc;
      if (Tr >= 1) return 0;
      return A * Math.pow(1 - Tr, B + Tr * (C + Tr * (D + E * Tr)));
    }
    case 116: {
      const tau = Math.max(1 - T / Tc, 0);
      return A + B * Math.pow(tau, 0.35) + C * Math.pow(tau, 2 / 3) + D * tau + E * Math.pow(tau, 4 / 3);
    }
    case 200: {
      const tau = 1 - T / Tc;
      return E * Math.exp((Tc / T) * (A * tau + B * Math.pow(Math.abs(tau), 1.5) * Math.sign(tau) +
        C * Math.pow(Math.abs(tau), 2.5) * Math.sign(tau) + D * Math.pow(tau, 5)));
    }
    default:
      return fail('TH_EQ', `unsupported ChemSep equation ${eq}`);
  }
}

// ---------------------------------------------------------------------------
// components
// ---------------------------------------------------------------------------

/**
 * Component record for the rigorous core. Keys are compdb keys (ChemSep);
 * legacy engine keys that share a CAS number are the same keys.
 * @param {string} key
 * @returns {object}
 */
export function component(key) {
  const c = compdb.get(key);
  if (!c) fail('TH_UNKNOWN_KEY', `component '${key}' is not in the rigorous databank`, 'key');
  if (!c._prep) prepComponent(key, c);
  return c;
}

function prepComponent(key, c) {
  c.key = key;
  c.MW = c.mw;                                  // kg/kmol = g/mol
  c.Hf = num(c.hf) ? c.hf / 1000 : 0;            // J/mol
  c.S0 = num(c.s0) ? c.s0 / 1000 : 0;            // J/(mol K)
  c.Tc = c.tc; c.Pc = c.pc; c.omega = num(c.w) ? c.w : 0;
  c._cp = cpIntegrals(c);
  // NIST-JANAF Shomate ideal-gas data where the classic engine carries it
  // (syngas, combustion and ammonia-loop species): used by default for H, S
  // and equilibrium constants — ChemSep's ΔHf / S° for e.g. CH4 put the SMR
  // equilibrium constant 2–5 % off NIST.
  const nd = mbData.get(key);
  if (nd && nd.data_quality === 'nist' && Array.isArray(nd.shomate) && nd.shomate.length && num(nd.hf_gas_298)) c._nist = nistShomate(nd);
  c._prep = true;
}

function nistShomate(nd) {
  const rs = nd.shomate.slice().sort((a, b) => a.tmin - b.tmin);
  const pick = (T) => { for (const r of rs) if (T <= r.tmax) return r; return rs[rs.length - 1]; };
  const HS = (r, T) => {
    const t = T / 1000;
    const H = r.A * t + r.B * t * t / 2 + r.C * t * t * t / 3 + r.D * t * t * t * t / 4 - r.E / t + r.F - r.H;       // kJ/mol vs 298.15
    const S = r.A * Math.log(t) + r.B * t + r.C * t * t / 2 + r.D * t * t * t / 3 - r.E / (2 * t * t) + r.G;          // J/(mol K), 1 bar
    const Cp = r.A + r.B * t + r.C * t * t + r.D * t * t * t + r.E / (t * t);
    return { H: H * 1000, S, Cp };
  };
  const lo = rs[0].tmin, hi = rs[rs.length - 1].tmax;
  const S1atm = -R * Math.log(P0 / 1e5);            // 1 bar → 101325 Pa reference
  let lastT = NaN, lastH = 0, lastS = 0;
  return {
    at(T) {
      if (T === lastT) return [lastH, lastS];
      let v;
      if (T < lo) { const a = HS(pick(lo), lo); v = { H: a.H + a.Cp * (T - lo), S: a.S + a.Cp * Math.log(T / lo) }; }
      else if (T > hi) { const a = HS(pick(hi), hi); v = { H: a.H + a.Cp * (T - hi), S: a.S + a.Cp * Math.log(T / hi) }; }
      else v = HS(pick(T), T);
      lastT = T; lastH = nd.hf_gas_298 * 1000 + v.H; lastS = v.S + S1atm;
      return [lastH, lastS];
    },
  };
}

// --- ideal-gas Cp integrals (Gauss–Legendre, closed form for polynomials) ---
const GL_X = [-0.9739065285171717, -0.8650633666889845, -0.6794095682990244, -0.4333953941292472, -0.1488743389816312,
  0.1488743389816312, 0.4333953941292472, 0.6794095682990244, 0.8650633666889845, 0.9739065285171717];
const GL_W = [0.0666713443086881, 0.1494513491505806, 0.2190863625159820, 0.2692667193099963, 0.2955242247147529,
  0.2955242247147529, 0.2692667193099963, 0.2190863625159820, 0.1494513491505806, 0.0666713443086881];

function cpIntegrals(c) {
  const k = c.cpig;
  if (!k) fail('TH_NO_CP', `component '${c.key}' has no ideal-gas Cp correlation`);
  const Tmin = num(k[6]) ? k[6] : 50, Tmax = num(k[7]) ? k[7] : 3000;
  const cp = (T) => corr(k, Math.min(Math.max(T, Tmin), Tmax)) / 1000;   // J/(mol K), constant outside range
  const poly = k[0] >= 1 && k[0] <= 5 || k[0] === 100;
  const coeff = poly ? [k[1], k[0] >= 2 || k[0] === 100 ? k[2] : 0, k[0] >= 3 || k[0] === 100 ? k[3] : 0,
    k[0] >= 4 || k[0] === 100 ? k[4] : 0, k[0] === 5 || k[0] === 100 ? k[5] : 0].map((v) => v / 1000) : null;
  // ∫cp dT and ∫cp/T dT between a and b, with a,b inside [Tmin, Tmax]
  const segH = poly
    ? (a, b) => { const [A, B, C, D, E] = coeff; const F = (T) => T * (A + T * (B / 2 + T * (C / 3 + T * (D / 4 + T * E / 5)))); return F(b) - F(a); }
    : (a, b) => { const h = (b - a) / 2, m = (a + b) / 2; let s = 0; for (let i = 0; i < 10; i++) s += GL_W[i] * cp(m + h * GL_X[i]); return s * h; };
  const segS = poly
    ? (a, b) => { const [A, B, C, D, E] = coeff; const F = (T) => A * Math.log(T) + T * (B + T * (C / 2 + T * (D / 3 + T * E / 4))); return F(b) - F(a); }
    : (a, b) => { const h = (b - a) / 2, m = (a + b) / 2; let s = 0; for (let i = 0; i < 10; i++) { const T = m + h * GL_X[i]; s += GL_W[i] * cp(T) / T; } return s * h; };
  // split long spans so Gauss–Legendre stays exact to ~1e-12 for the exp-form eq 16
  const integ = (seg, a, b) => {
    const n = Math.max(1, Math.ceil(Math.abs(b - a) / 400));
    let s = 0;
    for (let i = 0; i < n; i++) s += seg(a + (b - a) * i / n, a + (b - a) * (i + 1) / n);
    return s;
  };
  const clampInt = (seg, isS, a, b) => {
    // piecewise: constant cp outside [Tmin, Tmax]
    let s = 0;
    const lo = Math.min(a, b), hi = Math.max(a, b), sign = b >= a ? 1 : -1;
    if (lo < Tmin) { const e = Math.min(hi, Tmin); const cpl = cp(Tmin); s += isS ? cpl * Math.log(e / lo) : cpl * (e - lo); }
    const m0 = Math.max(lo, Tmin), m1 = Math.min(hi, Tmax);
    if (m1 > m0) s += integ(seg, m0, m1);
    if (hi > Tmax) { const e = Math.max(lo, Tmax); const cph = cp(Tmax); s += isS ? cph * Math.log(hi / e) : cph * (hi - e); }
    return sign * s;
  };
  let lastT = NaN, lastH = 0, lastS = 0;
  return {
    cp,
    // returns [∫T0..T cp dT, ∫T0..T cp/T dT] — cached for the last T
    at(T) {
      if (T === lastT) return [lastH, lastS];
      lastT = T; lastH = clampInt(segH, false, T0, T); lastS = clampInt(segS, true, T0, T);
      return [lastH, lastS];
    },
  };
}

/** Ideal-gas molar enthalpy, formation basis [J/mol]. */
export function hIG(c, T) { return c.Hf + c._cp.at(T)[0]; }
/** Ideal-gas molar entropy of the pure component at (T, 101325 Pa) [J/(mol K)]. */
export function sIG(c, T) { return c.S0 + c._cp.at(T)[1]; }

/**
 * Vapour pressure [Pa]. Beyond the correlation's Tmax (≈Tc) the equation is
 * extrapolated, as commercial simulators do for supercritical solutes in
 * activity-coefficient packages; below Tmin it is evaluated as is.
 */
export function psat(c, T) {
  if (c.psat) return corr(c.psat, T, c.Tc);
  if (c.psat_ant) return corr(c.psat_ant, T, c.Tc);
  // Lee–Kesler from Tc, Pc, ω
  const Tr = T / c.Tc;
  const f0 = 5.92714 - 6.09648 / Tr - 1.28862 * Math.log(Tr) + 0.169347 * Math.pow(Tr, 6);
  const f1 = 15.2518 - 15.6875 / Tr - 13.4721 * Math.log(Tr) + 0.43577 * Math.pow(Tr, 6);
  return c.Pc * Math.exp(f0 + c.omega * f1);
}
/** d ln Psat / dT (numerical). */
function dlnPsat(c, T) { const h = 1e-3 * T; return (Math.log(psat(c, T + h)) - Math.log(psat(c, T - h))) / (2 * h); }

/** Heat of vaporisation [J/mol]; 0 at and above Tc. */
export function hvap(c, T) {
  if (c.hvap) return corr(c.hvap, T, c.Tc) / 1000;
  if (T >= c.Tc) return 0;
  // Clausius–Clapeyron with ideal gas & negligible liquid volume
  return R * T * T * dlnPsat(c, T);
}

/** Saturated liquid molar volume [m3/mol] from the ChemSep density correlation (Rackett fallback). */
export function vLiq(c, T) {
  if (c.rhol && (c.rhol[0] !== 105 || T < c.rhol[3] * 0.999)) {
    const Tuse = c.rhol[0] === 105 ? Math.min(T, c.rhol[3] * 0.999) : T;
    const rho = corr(c.rhol, c.rhol[0] === 106 ? Math.min(Tuse, c.Tc * 0.999) : Tuse, c.Tc);  // kmol/m3
    if (rho > 0) return 1 / (rho * 1000);
  }
  const zra = num(c.zra) ? c.zra : 0.29056 - 0.08775 * c.omega;
  const Tr = Math.min(T / c.Tc, 0.99);
  return R * c.Tc / c.Pc * Math.pow(zra, 1 + Math.pow(1 - Tr, 2 / 7));
}

/**
 * Saturated-liquid mixture volume [m3/mol].
 *   all components below 0.95 Tc → Amagat sum of the ChemSep correlations;
 *   light (near/super-critical) components present → COSTALD
 *   (Hankinson–Thomson 1979) with Hankinson–Brobst–Thomson mixing;
 *   mixture Tr ≥ 0.95 → the EOS liquid root when an EOS is available.
 */
function liquidVolume(comps, T, P, x, eos) {
  const n = comps.length;
  let light = false;
  for (let i = 0; i < n; i++) if (x[i] > 1e-4 && T > 0.95 * comps[i].Tc) light = true;
  if (!light) {
    let v = 0; for (let i = 0; i < n; i++) if (x[i] > 0) v += x[i] * vLiq(comps[i], T);
    return v;
  }
  const Vs = comps.map((c) => (num(c.vcost) ? c.vcost / 1000 : (c.vc || 0.1) / 1000));       // m3/mol
  const ws = comps.map((c) => (num(c.wcost) ? c.wcost : c.omega));
  let s1 = 0, s23 = 0, s13 = 0, wm = 0;
  for (let i = 0; i < n; i++) if (x[i] > 0) { s1 += x[i] * Vs[i]; s23 += x[i] * Math.cbrt(Vs[i] * Vs[i]); s13 += x[i] * Math.cbrt(Vs[i]); wm += x[i] * ws[i]; }
  const Vm = 0.25 * (s1 + 3 * s23 * s13);
  let num1 = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (x[i] > 0 && x[j] > 0) num1 += x[i] * x[j] * Math.sqrt(Vs[i] * comps[i].Tc * Vs[j] * comps[j].Tc);
  const Tcm = num1 / Vm;
  const Tr = T / Tcm;
  if (Tr >= 0.95 && eos) return eos.state(T, P, x, 'L').V;
  const t = 1 - Math.min(Math.max(Tr, 0.25), 0.95);
  const V0 = 1 - 1.52816 * Math.cbrt(t) + 1.43907 * Math.pow(t, 2 / 3) - 0.81446 * t + 0.190454 * Math.pow(t, 4 / 3);
  const Trc = Math.min(Math.max(Tr, 0.25), 0.99);
  const Vd = (-0.296123 + 0.386914 * Trc - 0.0427258 * Trc * Trc - 0.0480645 * Trc * Trc * Trc) / (Trc - 1.00001);
  return Vm * V0 * (1 - wm * Vd);
}

// ---------------------------------------------------------------------------
// cubic equations of state — PR (1976) and SRK, van der Waals mixing
// ---------------------------------------------------------------------------
const EOS = {
  pr: { OA: 0.45723553, OB: 0.07779607, u: 2, w: -1, m: (w) => 0.37464 + 1.54226 * w - 0.26992 * w * w },
  srk: { OA: 0.42748023, OB: 0.08664035, u: 1, w: 0, m: (w) => 0.480 + 1.574 * w - 0.176 * w * w },
};

/** Real roots of x³ + a x² + b x + c = 0 (ascending). */
function cubicRoots(a, b, c) {
  const Q = (a * a - 3 * b) / 9, Rr = (2 * a * a * a - 9 * a * b + 27 * c) / 54;
  const Q3 = Q * Q * Q;
  let roots;
  if (Rr * Rr < Q3) {
    const th = Math.acos(Math.max(-1, Math.min(1, Rr / Math.sqrt(Q3))));
    const s = -2 * Math.sqrt(Q);
    roots = [s * Math.cos(th / 3) - a / 3, s * Math.cos((th + 2 * Math.PI) / 3) - a / 3, s * Math.cos((th - 2 * Math.PI) / 3) - a / 3];
  } else {
    const A = -Math.sign(Rr) * Math.cbrt(Math.abs(Rr) + Math.sqrt(Rr * Rr - Q3));
    const B = A !== 0 ? Q / A : 0;
    roots = [A + B - a / 3];
  }
  roots = roots.filter((z) => isFinite(z));
  if (!roots.length) {
    // degenerate coefficients — Newton from a vapour-like and a liquid-like start
    for (const z0 of [1, 1e-3]) {
      let z = z0;
      for (let i = 0; i < 100; i++) { const f = ((z + a) * z + b) * z + c, d = (3 * z + 2 * a) * z + b; if (!d) break; const dz = f / d; z -= dz; if (Math.abs(dz) < 1e-14) break; }
      if (isFinite(z)) roots.push(z);
    }
  }
  // polish with Newton
  roots = roots.map((z) => {
    for (let i = 0; i < 4; i++) {
      const f = ((z + a) * z + b) * z + c, d = (3 * z + 2 * a) * z + b;
      if (d === 0) break;
      const dz = f / d; z -= dz;
      if (Math.abs(dz) < 1e-15 * Math.max(1, Math.abs(z))) break;
    }
    return z;
  });
  return roots.sort((x, y) => x - y);
}

function makeEOS(kind, comps, kij) {
  const E = EOS[kind];
  const n = comps.length;
  const ac = comps.map((c) => E.OA * R * R * c.Tc * c.Tc / c.Pc);
  const b = comps.map((c) => E.OB * R * c.Tc / c.Pc);
  const m = comps.map((c) => E.m(c.omega));
  const delta = Math.sqrt(E.u * E.u - 4 * E.w);
  const d1 = (E.u + delta) / 2, d2 = (E.u - delta) / 2;
  let cacheT = NaN, ai = null, dai = null, aij = null, daij = null;
  function atT(T) {
    if (T === cacheT) return;
    cacheT = T;
    ai = new Array(n); dai = new Array(n);
    for (let i = 0; i < n; i++) {
      const sr = Math.sqrt(T / comps[i].Tc);
      const al = 1 + m[i] * (1 - sr);
      ai[i] = ac[i] * al * al;
      dai[i] = -ac[i] * al * m[i] / Math.sqrt(T * comps[i].Tc);
    }
    aij = []; daij = [];
    for (let i = 0; i < n; i++) {
      aij.push(new Array(n)); daij.push(new Array(n));
      for (let j = 0; j < n; j++) {
        const s = Math.sqrt(ai[i] * ai[j]);
        const k = 1 - kij[i][j];
        aij[i][j] = s * k;
        daij[i][j] = s > 0 ? 0.5 * k * s * (dai[i] / ai[i] + dai[j] / ai[j]) : 0;
      }
    }
  }
  /**
   * Mixture state at (T, P, x) for the requested root.
   * phase: 'L' smallest root > B, 'V' largest, 'min' lowest Gibbs energy.
   */
  function state(T, P, x, phase) {
    atT(T);
    let am = 0, dam = 0, bm = 0;
    const sa = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      bm += x[i] * b[i];
      for (let j = 0; j < n; j++) { sa[i] += x[j] * aij[i][j]; dam += x[i] * x[j] * daij[i][j]; }
      am += x[i] * sa[i];
    }
    const A = am * P / (R * R * T * T), B = bm * P / (R * T);
    let roots = cubicRoots(-(1 + B - E.u * B), A + E.w * B * B - E.u * B - E.u * B * B, -(A * B + E.w * B * B + E.w * B * B * B))
      .filter((z) => z > B);
    if (!roots.length) roots = [B * (1 + 1e-9) + 1e-12];   // highly compressed liquid limit
    if (!roots.length) fail('TH_EOS_ROOT', 'no physical EOS root');
    const pick = (Z) => {
      const L = Math.log((Z + d1 * B) / (Z + d2 * B));
      return { Z, L };
    };
    let Z;
    if (phase === 'L') Z = roots[0];
    else if (phase === 'V') Z = roots[roots.length - 1];
    else {
      // lowest reduced Gibbs energy (mixture, same composition)
      Z = roots[0];
      if (roots.length > 1) {
        const g = (z) => z - 1 - Math.log(z - B) - A / (B * delta) * Math.log((z + d1 * B) / (z + d2 * B));
        Z = g(roots[0]) <= g(roots[roots.length - 1]) ? roots[0] : roots[roots.length - 1];
      }
    }
    const { L } = pick(Z);
    const lnphi = new Array(n);
    for (let i = 0; i < n; i++) {
      const bi = b[i] / bm;
      lnphi[i] = bi * (Z - 1) - Math.log(Z - B) - A / (B * delta) * (2 * sa[i] / am - bi) * L;
    }
    const hDep = R * T * (Z - 1) + (T * dam - am) / (bm * delta) * L;
    const sDep = R * Math.log(Z - B) + dam / (bm * delta) * L;
    return { Z, lnphi, hDep, sDep, A, B, nRoots: roots.length, V: Z * R * T / P, am, bm };
  }
  return { kind, state, b, ai: (T) => { atT(T); return ai; } };
}

// ---------------------------------------------------------------------------
// activity coefficient models
// ---------------------------------------------------------------------------

function pairLookup(table, ki, kj) { return table[ki + '|' + kj]; }

function makeNRTL(keys, user, warnings) {
  const n = keys.length;
  const b = [], a = [], al = [];
  const missing = [];
  for (let i = 0; i < n; i++) {
    b.push(new Array(n).fill(0)); a.push(new Array(n).fill(0)); al.push(new Array(n).fill(0.3));
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const u = user && user[keys[i] + '|' + keys[j]];
    if (u) { a[i][j] = u.a || 0; b[i][j] = u.b || 0; if (num(u.alpha)) { al[i][j] = u.alpha; al[j][i] = u.alpha; } continue; }
    const p = pairLookup(bip.NRTL, keys[i], keys[j]);
    if (p) { b[i][j] = p[0]; al[i][j] = p[1]; al[j][i] = p[1]; continue; }
    if (i < j && !pairLookup(bip.NRTL, keys[j], keys[i]) && !(user && user[keys[j] + '|' + keys[i]])) missing.push(keys[i] + '–' + keys[j]);
  }
  if (missing.length) warnings.push(`NRTL: no binary parameters for ${missing.join(', ')} — treated as ideal (τ = 0)`);
  return {
    missing,
    lnGamma(T, x) {
      const tau = [], G = [];
      for (let i = 0; i < n; i++) {
        tau.push(new Array(n)); G.push(new Array(n));
        for (let j = 0; j < n; j++) { tau[i][j] = a[i][j] + b[i][j] / T; G[i][j] = Math.exp(-al[i][j] * tau[i][j]); }
      }
      const S = new Array(n), C = new Array(n);
      for (let j = 0; j < n; j++) {
        let s = 0, c = 0;
        for (let k = 0; k < n; k++) { s += x[k] * G[k][j]; c += x[k] * tau[k][j] * G[k][j]; }
        S[j] = s; C[j] = c;
      }
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        let t = C[i] / S[i];
        for (let j = 0; j < n; j++) t += x[j] * G[i][j] / S[j] * (tau[i][j] - C[j] / S[j]);
        out[i] = t;
      }
      return out;
    },
  };
}

function makeUNIQUAC(keys, comps, user, warnings) {
  const n = keys.length;
  const r = comps.map((c) => c.uqr), q = comps.map((c) => c.uqq);
  if (r.some((v) => !num(v)) || q.some((v) => !num(v))) {
    fail('TH_UNIQUAC_RQ', 'UNIQUAC needs r and q for every component: ' + keys.filter((k, i) => !num(r[i]) || !num(q[i])).join(', '));
  }
  const bb = [], aa = [];
  const missing = [];
  for (let i = 0; i < n; i++) { bb.push(new Array(n).fill(0)); aa.push(new Array(n).fill(0)); }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const u = user && user[keys[i] + '|' + keys[j]];
    if (u) { aa[i][j] = u.a || 0; bb[i][j] = u.b || 0; continue; }
    const p = pairLookup(bip.UNIQUAC, keys[i], keys[j]);
    if (p) { bb[i][j] = p[0]; continue; }
    if (i < j && !pairLookup(bip.UNIQUAC, keys[j], keys[i]) && !(user && user[keys[j] + '|' + keys[i]])) missing.push(keys[i] + '–' + keys[j]);
  }
  if (missing.length) warnings.push(`UNIQUAC: no binary parameters for ${missing.join(', ')} — treated as τ = 1`);
  const z = 10;
  const l = r.map((ri, i) => z / 2 * (ri - q[i]) - (ri - 1));
  return {
    missing,
    lnGamma(T, x) {
      let sr = 0, sq = 0;
      for (let i = 0; i < n; i++) { sr += x[i] * r[i]; sq += x[i] * q[i]; }
      const phi = r.map((ri, i) => ri / sr), th = q.map((qi, i) => x[i] * qi / sq);
      let sxl = 0; for (let i = 0; i < n; i++) sxl += x[i] * l[i];
      const tau = [];
      for (let i = 0; i < n; i++) { tau.push(new Array(n)); for (let j = 0; j < n; j++) tau[i][j] = Math.exp(aa[i][j] + bb[i][j] / T); }
      const st = new Array(n);
      for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += th[k] * tau[k][j]; st[j] = s; }
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        const Vi = phi[i];             // Φ_i / x_i
        const Fi = q[i] / sq;          // θ_i / x_i
        const comb = Math.log(Vi) + 1 - Vi - z / 2 * q[i] * (Math.log(Vi / Fi) + 1 - Vi / Fi);
        let s2 = 0; for (let j = 0; j < n; j++) s2 += th[j] * tau[i][j] / st[j];
        const res = q[i] * (1 - Math.log(st[i]) - s2);
        out[i] = comb + res;
      }
      return out;
    },
  };
}

function makeWilson(keys, comps, user, warnings) {
  const n = keys.length;
  const aa = [], bb = [];
  const missing = [];
  for (let i = 0; i < n; i++) { aa.push(new Array(n).fill(0)); bb.push(new Array(n).fill(0)); }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const u = user && user[keys[i] + '|' + keys[j]];
    if (u) { aa[i][j] = u.a || 0; bb[i][j] = u.b || 0; continue; }
    const p = pairLookup(bip.WILSON, keys[i], keys[j]);
    if (p) { aa[i][j] = p[0]; bb[i][j] = p[1]; continue; }
    if (i < j && !pairLookup(bip.WILSON, keys[j], keys[i]) && !(user && user[keys[j] + '|' + keys[i]])) missing.push(keys[i] + '–' + keys[j]);
  }
  if (missing.length) warnings.push(`Wilson: no binary parameters for ${missing.join(', ')} — treated as Λ = 1`);
  return {
    missing,
    lnGamma(T, x) {
      const L = [];
      for (let i = 0; i < n; i++) { L.push(new Array(n)); for (let j = 0; j < n; j++) L[i][j] = i === j ? 1 : Math.exp(aa[i][j] + bb[i][j] / T); }
      const S = new Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += x[j] * L[i][j]; S[i] = s; }
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        let t = 0; for (let k = 0; k < n; k++) t += x[k] * L[k][i] / S[k];
        out[i] = 1 - Math.log(S[i]) - t;
      }
      return out;
    },
  };
}

/**
 * UNIFAC — original (VLE, Hansen 1991) or modified Dortmund (Gmehling 2016).
 * Components without a group assignment (light gases, NH3, …) keep their
 * UNIQUAC r, q in the combinatorial term and contribute no groups (ideal
 * residual) — a warning names them.
 */
function makeUNIFAC(keys, comps, dortmund, warnings) {
  const n = keys.length;
  const field = dortmund ? 'modunifac' : 'unifac';
  const SUB = dortmund ? bip.DORTMUND_SUB : bip.UNIFAC_SUB;
  const AMN = dortmund ? bip.DORTMUND_A : bip.UNIFAC_A;
  const grouped = comps.map((c) => !!c[field]);
  const ung = keys.filter((k, i) => !grouped[i]);
  if (ung.length === n) fail('TH_UNIFAC_GROUPS', `${dortmund ? 'Dortmund UNIFAC' : 'UNIFAC'} group assignment not available for any of: ${keys.join(', ')}`);
  if (ung.length) warnings.push(`${dortmund ? 'Dortmund UNIFAC' : 'UNIFAC'}: no group assignment for ${ung.join(', ')} — combinatorial term only (residual treated as ideal)`);
  const subs = [...new Set(comps.flatMap((c) => (c[field] ? Object.keys(c[field]).map(Number) : [])))];
  const G = subs.length;
  const Rk = subs.map((s) => SUB[s][1]), Qk = subs.map((s) => SUB[s][2]);
  const main = subs.map((s) => SUB[s][0]);
  const nu = comps.map((c) => subs.map((s) => (c[field] && c[field][s]) || 0));
  const r = nu.map((v, i) => (grouped[i] ? v.reduce((s, x, k) => s + x * Rk[k], 0) : (comps[i].uqr || 1)));
  const q = nu.map((v, i) => (grouped[i] ? v.reduce((s, x, k) => s + x * Qk[k], 0) : (comps[i].uqq || 1)));
  const r34 = r.map((v) => Math.pow(v, 0.75));
  const amn = [];
  const missingPairs = new Set();
  for (let k = 0; k < G; k++) {
    amn.push(new Array(G));
    for (let m = 0; m < G; m++) {
      if (main[k] === main[m]) { amn[k][m] = dortmund ? [0, 0, 0] : 0; continue; }
      const v = AMN[main[k] + '|' + main[m]];
      if (v === undefined) { missingPairs.add(Math.min(main[k], main[m]) + '/' + Math.max(main[k], main[m])); amn[k][m] = dortmund ? [0, 0, 0] : 0; } else amn[k][m] = v;
    }
  }
  if (missingPairs.size) warnings.push(`${dortmund ? 'Dortmund UNIFAC' : 'UNIFAC'}: no interaction parameters for main groups ${[...missingPairs].join(', ')} — treated as 0`);
  const psiAt = (T) => amn.map((row) => row.map((a) => (dortmund ? Math.exp(-(a[0] + a[1] * T + a[2] * T * T) / T) : Math.exp(-a / T))));
  const lnGammaGroups = (psi, X) => {
    let sQX = 0; for (let k = 0; k < G; k++) sQX += Qk[k] * X[k];
    const th = Qk.map((Q, k) => Q * X[k] / sQX);
    const S = new Array(G);
    for (let m = 0; m < G; m++) { let s = 0; for (let k = 0; k < G; k++) s += th[k] * psi[k][m]; S[m] = s; }
    return Qk.map((Q, k) => {
      let t = 0; for (let m = 0; m < G; m++) t += th[m] * psi[k][m] / S[m];
      return Q * (1 - Math.log(S[k]) - t);
    });
  };
  let pureT = NaN, pureLn = null, psi = null;
  return {
    missing: [...missingPairs],
    lnGamma(T, x) {
      if (T !== pureT) {
        pureT = T; psi = psiAt(T);
        pureLn = nu.map((v, i) => {
          if (!grouped[i]) return null;
          const tot = v.reduce((s, a) => s + a, 0);
          const lg = lnGammaGroups(psi, v.map((a) => a / tot));
          return lg.map((g, k) => (v[k] ? g : 0));
        });
      }
      let tot = 0; const Xm = new Array(G).fill(0);
      for (let i = 0; i < n; i++) if (grouped[i]) for (let k = 0; k < G; k++) { Xm[k] += x[i] * nu[i][k]; tot += x[i] * nu[i][k]; }
      const lgm = tot > 0 ? lnGammaGroups(psi, Xm.map((v) => v / tot)) : null;
      let sr = 0, sq = 0, sr34 = 0;
      for (let i = 0; i < n; i++) { sr += x[i] * r[i]; sq += x[i] * q[i]; sr34 += x[i] * r34[i]; }
      const out = new Array(n);
      for (let i = 0; i < n; i++) {
        const V = r[i] / sr, F = q[i] / sq;
        const Vp = dortmund ? r34[i] / sr34 : V;
        const comb = 1 - Vp + Math.log(Vp) - 5 * q[i] * (1 - V / F + Math.log(V / F));
        let res = 0;
        if (grouped[i] && lgm) for (let k = 0; k < G; k++) if (nu[i][k]) res += nu[i][k] * (lgm[k] - pureLn[i][k]);
        out[i] = comb + res;
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// vapour-phase association of carboxylic acids — chemical theory
// (Marek & Standart 1954; Prausnitz, Molecular Thermodynamics, ch. 5):
// the vapour is an ideal gas of TRUE species — monomers of every component
// plus dimers of the acids (2 M ⇌ D, and cross dimers D_ij with
// K_ij = 2 √(K_i K_j)). Apparent fugacity coefficients φ_i = z_i / y_i (z = true
// monomer fraction), enthalpy, entropy and volume departures follow; on the
// liquid side the pure saturated vapour is associated too (φ_sat, H_dep,sat), so
// the DIPPR vapour pressure and the calorimetric heat of vaporisation stay
// exact while the liquid enthalpy becomes consistent with the ideal-gas
// (monomer) formation enthalpy — this fixes liquid heats of reaction of acids.
// ---------------------------------------------------------------------------
const LN10 = Math.log(10);
// ln K_D [1/Pa] = a + b/T
const ACID_DIMER = {
  AcOH: { a: -17.374 - Math.log(1e5), b: 7290, src: 'K_D = exp(−17.374 + 7290/T) bar⁻¹ (DECHEMA VLE Data Collection, as given by Gmehling et al.)' },
  'propionic-acid': { a: -10.834 * LN10 - Math.log(133.322368), b: 3316 * LN10, src: 'log₁₀ K_D = −10.834 + 3316/T, mmHg⁻¹ (Marek-type correlation)' },
};
function makeAssoc(keys, comps, warnings) {
  const idx = [], a = [], b = [], est = [];
  keys.forEach((k, i) => {
    const fam = comps[i].family;
    const isAcid = !!ACID_DIMER[k] || (num(fam) && fam >= 50 && fam <= 53);
    if (!isAcid) return;
    const d = ACID_DIMER[k] || ACID_DIMER['propionic-acid'];
    idx.push(i); a.push(d.a); b.push(d.b); est.push(!ACID_DIMER[k]);
  });
  if (!idx.length) return null;
  const nA = idx.length;
  const pos = keys.map(() => -1); idx.forEach((i, q) => { pos[i] = q; });
  const dH = (q, r) => -R * (b[q] + b[r]) / 2;                    // J/mol of dimer
  const lnK = (q, T) => a[q] + b[q] / T;
  warnings.push(`vapour association (chemical theory): ${idx.map((i, q) => keys[i] + (est[q] ? ' (dimerisation constant estimated from propionic acid)' : '')).join(', ')} ${idx.length > 1 ? 'dimerise' : 'dimerises'} in the vapour`);
  /** pure acid q at (T, P): true monomer fraction, departures per apparent mole */
  function pure(q, T, P) {
    const Kp = Math.exp(lnK(q, T)) * P;
    const z = Kp > 1e-12 ? (-1 + Math.sqrt(1 + 4 * Kp)) / (2 * Kp) : 1 - Kp;
    const S = z + 2 * Kp * z * z;                                    // apparent moles per true mole
    const d = Kp * z * z / S;                                        // dimers per apparent mole
    const h = d * dH(q, q);
    return { lnphi: Math.log(z), h, s: h / T - R * Math.log(z) };
  }
  /** mixture vapour at (T, P, apparent y) */
  let cT = NaN, cP = NaN, cY = null, cR = null;
  function mix(T, P, y) {
    if (T === cT && P === cP && cY && cY.every((v, i) => v === y[i])) return cR;
    const n = y.length;
    const act = [];
    for (let q = 0; q < nA; q++) if (y[idx[q]] > 0) act.push(q);
    let res;
    if (!act.length) res = { S: 1, lnphi: new Array(n).fill(0), h: 0, s: 0 };
    else {
      const Kp = act.map((q) => Math.exp(lnK(q, T)) * P);
      const m = act.length;
      const Kx = (u, v) => (u === v ? Kp[u] : 2 * Math.sqrt(Kp[u] * Kp[v]));
      const yA = act.map((q) => y[idx[q]]);
      const YN = Math.max(0, 1 - yA.reduce((s2, v) => s2 + v, 0));
      let z, S;
      // single acid: closed form of Kp(2 − y) z² + z − y·(…) — general with inerts:
      if (m === 1) {
        const yy = yA[0], K1 = Kp[0];
        const A2 = K1 * (2 - yy);
        z = [A2 > 1e-14 ? (-1 + Math.sqrt(1 + 4 * A2 * yy)) / (2 * A2) : yy];
        S = (z[0] + 2 * K1 * z[0] * z[0]) / yy;
      } else {
        // Newton on true monomer fractions z (acids) and S (apparent per true mole)
        z = yA.map((yy, u) => { const A2 = Kp[u] * (2 - yy); return A2 > 1e-14 ? (-1 + Math.sqrt(1 + 4 * A2 * yy)) / (2 * A2) : yy; });
        S = 1;
        for (let it = 0; it < 100; it++) {
          const F = [], J = [];
          for (let u = 0; u < m; u++) {
            let f = z[u] - yA[u] * S; const row = new Array(m + 1).fill(0);
            for (let v = 0; v < m; v++) {
              const k = Kx(u, v) * (u === v ? 2 : 1);
              f += k * z[u] * z[v];
              row[v] += k * z[u] * (u === v ? 2 : 1);
              if (u !== v) row[v] = Kx(u, v) * z[u];
            }
            row[u] = 1 + 4 * Kp[u] * z[u] + act.reduce((s2, _q, v) => s2 + (v !== u ? Kx(u, v) * z[v] : 0), 0);
            row[m] = -yA[u];
            F.push(f); J.push(row);
          }
          let g = S * YN - 1; const rowG = new Array(m + 1).fill(0);
          for (let u = 0; u < m; u++) {
            g += z[u] + Kp[u] * z[u] * z[u];
            rowG[u] = 1 + 2 * Kp[u] * z[u];
            for (let v = u + 1; v < m; v++) { g += Kx(u, v) * z[u] * z[v]; }
            for (let v = 0; v < m; v++) if (v !== u) rowG[u] += Kx(u, v) * z[v];
          }
          rowG[m] = YN;
          F.push(g); J.push(rowG);
          const dx = solveSmall(J, F.map((v) => -v));
          if (!dx) break;
          let lam = 1;
          for (let u = 0; u < m; u++) if (z[u] + lam * dx[u] < 0.2 * z[u]) lam = Math.min(lam, 0.8 * z[u] / -dx[u]);
          if (S + lam * dx[m] < 0.5) lam = Math.min(lam, 0.5 * (S - 0.5) / -dx[m]);
          for (let u = 0; u < m; u++) z[u] += lam * dx[u];
          S += lam * dx[m];
          if (Math.max(...F.map(Math.abs)) < 1e-15) break;
        }
      }
      const lnphi = new Array(n).fill(Math.log(S));                  // non-associating: φ = S
      act.forEach((q, u) => { lnphi[idx[q]] = Math.log(z[u] / yA[u]); });
      let h = 0;
      for (let u = 0; u < m; u++) for (let v = u; v < m; v++) h += Kx(u, v) * z[u] * z[v] / S * dH(act[u], act[v]);
      let g = 0; for (let i = 0; i < n; i++) if (y[i] > 0) g += y[i] * lnphi[i];
      res = { S, lnphi, h, s: h / T - R * g };
    }
    cT = T; cP = P; cY = y.slice(); cR = res;
    return res;
  }
  return { idx, pos, est, pure, mix, keys: idx.map((i) => keys[i]), src: idx.map((i, q) => (est[q] ? 'estimated: ' : '') + (ACID_DIMER[keys[i]] || ACID_DIMER['propionic-acid']).src) };
}
function solveSmall(A, bv) {
  const n = bv.length, M = A.map((r, i) => r.slice().concat([bv[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let t = M[r][n]; for (let k = r + 1; k < n; k++) t -= M[r][k] * x[k]; x[r] = t / M[r][r]; }
  return x;
}

// ---------------------------------------------------------------------------
// property package
// ---------------------------------------------------------------------------

export const PACKAGES = {
  pr: 'Peng–Robinson (1976)',
  srk: 'Soave–Redlich–Kwong',
  ideal: 'Ideal (Raoult + ideal gas)',
  nrtl: 'NRTL (γ–φ)',
  uniquac: 'UNIQUAC (γ–φ)',
  wilson: 'Wilson (γ–φ)',
  unifac: 'UNIFAC (predictive γ–φ)',
  modunifac: 'Modified UNIFAC — Dortmund (predictive γ–φ)',
  ...ELECTROLYTE_MODELS,
};

/**
 * Build a property package for a fixed component list.
 * @param {{model:string, kij?:object, nrtl?:object, uniquac?:object, wilson?:object,
 *          vapour?:('ideal'|'pr'|'srk'), excess_enthalpy?:boolean,
 *          three_phase?:(boolean|'auto')}} spec   three_phase: units flash with a
 *        second liquid (VLLE) — see threePhase below
 *        kij: { 'A|B': value } overrides (EOS packages, and the vapour EOS of
 *        activity packages); nrtl: { 'i|j': {a, b, alpha} } (τ_ij = a + b/T);
 *        uniquac/wilson: { 'i|j': {a, b} }.
 * @param {string[]} keys component keys (compdb)
 * @returns {object} package
 */
export function createPackage(spec, keys) {
  const s = spec || {};
  const model = String(s.model || 'pr').toLowerCase();
  if (!PACKAGES[model]) fail('TH_PACKAGE', `unknown property package '${s.model}' (use ${Object.keys(PACKAGES).join(' | ')})`, 'property_package');
  if (!Array.isArray(keys) || !keys.length) fail('TH_KEYS', 'component list required');
  const comps = keys.map(component);
  const n = keys.length;
  const warnings = [];
  const elecModel = ELECTROLYTE_MODELS[model] ? model : null;
  const saltIn = keys.filter((k) => ELECTROLYTE_KEYS.includes(k));
  if (saltIn.length && model !== 'hot-k2co3') fail('TH_ELECTROLYTE', `${saltIn.join(', ')} is an electrolyte — use the 'hot-k2co3' (hot potassium carbonate) property package`, 'property_package');
  const isEOS = model === 'pr' || model === 'srk';
  const vapourModel = isEOS ? model : (s.vapour === 'pr' || s.vapour === 'srk' ? s.vapour : 'ideal');
  // kij matrix (ChemSep PR table; same values used for SRK, as DWSIM does; user overrides win)
  const kij = [];
  const kijUsed = {};
  for (let i = 0; i < n; i++) {
    kij.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const [a, b] = [keys[i], keys[j]].sort();
      const pair = a + '|' + b;
      let v = bip.PR[pair] || 0;
      if (s.kij && num(s.kij[pair])) v = s.kij[pair];
      else if (s.kij && num(s.kij[b + '|' + a])) v = s.kij[b + '|' + a];
      kij[i][j] = v;
      if (v && i < j) kijUsed[pair] = v;
    }
  }
  const eos = vapourModel !== 'ideal' ? makeEOS(vapourModel, comps, kij) : null;
  let act = null;
  if (model === 'nrtl') act = makeNRTL(keys, s.nrtl, warnings);
  else if (model === 'uniquac') act = makeUNIQUAC(keys, comps, s.uniquac, warnings);
  else if (model === 'wilson') act = makeWilson(keys, comps, s.wilson, warnings);
  else if (model === 'unifac' || model === 'modunifac') act = makeUNIFAC(keys, comps, model === 'modunifac', warnings);
  const excessH = !!s.excess_enthalpy && !!act;
  const activity = !isEOS;
  const poynting = activity && model !== 'ideal' && !elecModel && s.poynting !== false;   // Raoult's law: no Poynting
  // STEP 25 acid-gas electrolyte packages: H2O, CO2 and the solvent (MEA / K2CO3)
  // from the speciation model; any other gas by Henry's law in water
  const elec = elecModel ? makeElectrolyte(elecModel, keys, { psatW: (T) => psat(component('H2O'), T) }) : null;
  const owned = new Array(n).fill(false);
  if (elec) {
    for (const i of elec.owned) owned[i] = true;
    if (!keys.includes('H2O')) warnings.push(`${PACKAGES[model]}: no water in this unit's components — the liquid model needs water`);
    if (elecModel === 'amine-mea' && keys.includes('K2CO3')) fail('TH_ELECTROLYTE', "K2CO3 cannot be used with the MEA package", 'property_package');
  }
  // Henry's law for dissolved gases (activity / ideal packages): a component is
  // a Henry component when it is a gas at ambient (Tb < 273.15 K, or no Tb and
  // Tc < 310 K), has Henry data against a solvent in the list, and the γ model
  // has no binary parameters for that pair. henry:false disables;
  // henry_components:[keys] sets the list explicitly.
  const henry = keys.map(() => null);
  if (activity && (s.henry !== false || elec)) {
    const explicit = Array.isArray(s.henry_components) && !elec ? new Set(s.henry_components) : null;
    for (let i = 0; i < n; i++) {
      const c = comps[i];
      if (owned[i]) continue;
      const gas = num(c.tb) ? c.tb < 273.15 : c.Tc < 310;
      if (explicit ? !explicit.has(keys[i]) : !gas) continue;
      const sol = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const h = bip.HENRY[keys[i] + '|' + keys[j]];
        if (!h) continue;
        const hasBip = act && act.missing && !act.missing.includes(keys[i] + '–' + keys[j]) && !act.missing.includes(keys[j] + '–' + keys[i]) && model !== 'unifac' && model !== 'modunifac';
        if (hasBip && !explicit) continue;
        sol.push([j, h[0], h[1]]);
      }
      if (sol.length) henry[i] = sol;
    }
    const hk = keys.filter((k, i) => henry[i]);
    if (hk.length) warnings.push(`Henry's law used for ${hk.join(', ')} dissolved in ${[...new Set(henry.flatMap((h) => (h ? h.map((v) => keys[v[0]]) : [])))].join(', ')}`);
  }
  if (elec) {
    // gases that react with the solvent are not modelled — refuse rather than treat them as physically dissolved
    const reactive = keys.filter((k) => ['H2S', 'NH3', 'SO2', 'HCl', 'Cl2', 'NO2', 'hydrogen-cyanide', 'carbonyl-sulfide', 'methyl-mercaptan', 'HNO3', 'formaldehyde'].includes(k));
    if (reactive.length) fail('TH_ELECTROLYTE', `${PACKAGES[model]}: ${reactive.join(', ')} react with the solvent and are not modelled (CO2 chemistry only)`, 'components');
    const bad = keys.filter((k, i) => !owned[i] && !henry[i]);
    if (bad.length) fail('TH_ELECTROLYTE', `${PACKAGES[model]}: ${bad.join(', ')} not supported — the liquid holds H2O, CO2, ${elec.solvent} and gases with Henry data in water (N2, H2, O2, CH4, CO, Ar, …)`, 'components');
  }
  /** solvent-weighted ln H [Pa] and B [K] for Henry component i, or null when no solvent is present */
  function henryMix(i, T, x) {
    let sw = 0, lnH = 0, B = 0;
    for (const [j, A, Bj] of henry[i]) { sw += x[j]; lnH += x[j] * (A + Bj / T); B += x[j] * Bj; }
    if (!(sw > 1e-12)) return null;
    return { lnH: lnH / sw, B: B / sw };
  }

  // vapour association of carboxylic acids: activity / ideal packages with an ideal-gas vapour
  const assoc = activity && !elec && vapourModel === 'ideal' && s.association !== false && s.association !== 'off' ? makeAssoc(keys, comps, warnings) : null;

  // ---- ideal-gas H, S per component (NIST Shomate where available) ----
  const useNist = s.ideal_gas_data !== 'chemsep';
  const hig = (i, T) => (useNist && comps[i]._nist ? comps[i]._nist.at(T)[0] : hIG(comps[i], T));
  const sig = (i, T) => (useNist && comps[i]._nist ? comps[i]._nist.at(T)[1] : sIG(comps[i], T));

  // ---- K-values / fugacity ----
  /** ln φ (EOS) or ln(γ Psat / P) (activity/ideal liquid) for one phase. */
  function lnFug(T, P, x, phase) {
    if (isEOS) return eos.state(T, P, x, phase).lnphi;
    if (phase === 'V') {
      if (eos) return eos.state(T, P, x, 'V').lnphi;
      return assoc ? assoc.mix(T, P, x).lnphi.slice() : new Array(n).fill(0);
    }
    if (elec) {
      const lp = elec.lnPhiL(T, P, x);
      return comps.map((c, i) => {
        if (owned[i]) return lp[i];
        const hm = henryMix(i, T, x);
        return hm ? hm.lnH - Math.log(P) : 50;
      });
    }
    const lg = act ? act.lnGamma(T, x) : new Array(n).fill(0);
    return comps.map((c, i) => {
      if (henry[i]) { const hm = henryMix(i, T, x); if (hm) return hm.lnH - Math.log(P); }
      const ps = psat(c, T);
      let v = lg[i] + Math.log(ps / P);
      if (assoc && assoc.pos[i] >= 0) v += assoc.pure(assoc.pos[i], T, ps).lnphi;     // φ_sat of the associated pure vapour
      if (poynting && T < c.Tc) v += vLiq(c, T) * (P - ps) / (R * T);
      return v;
    });
  }
  function lnK(T, P, x, y) {
    const fl = lnFug(T, P, x, 'L'), fv = lnFug(T, P, y, 'V');
    return fl.map((v, i) => v - fv[i]);
  }

  // ---- enthalpy / entropy ----
  function hPhase(T, P, x, phase) {
    let h = 0;
    for (let i = 0; i < n; i++) if (x[i] > 0) h += x[i] * hig(i, T);
    if (isEOS) return h + eos.state(T, P, x, phase).hDep;
    if (phase === 'V') return eos ? h + eos.state(T, P, x, 'V').hDep : (assoc ? h + assoc.mix(T, P, x).h : h);
    if (elec) return elecH(T, P, x);
    for (let i = 0; i < n; i++) if (x[i] > 0) {
      const hm = henry[i] ? henryMix(i, T, x) : null;
      if (hm) { h += x[i] * R * hm.B; continue; }             // heat of solution R·B for Henry gases
      h -= x[i] * hvap(comps[i], T);
      // calorimetric ΔHvap is measured to the associated saturated vapour
      if (assoc && assoc.pos[i] >= 0) h += x[i] * assoc.pure(assoc.pos[i], T, psat(comps[i], T)).h;
      // compressed / expanded liquid: + V_L (P − Psat) (DWSIM-consistent pressure effect)
      if (T < comps[i].Tc) h += x[i] * vLiq(comps[i], T) * (P - psat(comps[i], T));
    }
    if (excessH) {
      const dT = 0.01;
      const g1 = act.lnGamma(T + dT, x), g0 = act.lnGamma(T - dT, x);
      let he = 0; for (let i = 0; i < n; i++) he += x[i] * (g1[i] - g0[i]) / (2 * dT);
      h += -R * T * T * he;
    }
    return h;
  }
  function sPhase(T, P, x, phase) {
    let sMix = 0, s = 0;
    for (let i = 0; i < n; i++) if (x[i] > 0) { s += x[i] * sig(i, T); sMix -= R * x[i] * Math.log(x[i]); }
    if (isEOS) return s + sMix - R * Math.log(P / P0) + eos.state(T, P, x, phase).sDep;
    if (phase === 'V') return s + sMix - R * Math.log(P / P0) + (eos ? eos.state(T, P, x, 'V').sDep : assoc ? assoc.mix(T, P, x).s : 0);
    if (elec) return elecS(T, P, x);
    // liquid: pure saturated liquid at Psat, then ideal mixing + excess
    for (let i = 0; i < n; i++) if (x[i] > 0) {
      const hm = henry[i] ? henryMix(i, T, x) : null;
      if (hm) { s += x[i] * (-(hm.lnH - Math.log(P0)) * R + R * hm.B / T); continue; }
      const ps = psat(comps[i], T);
      s += x[i] * (-R * Math.log(ps / P0) - hvap(comps[i], T) / T);
      if (assoc && assoc.pos[i] >= 0) s += x[i] * assoc.pure(assoc.pos[i], T, ps).s;
    }
    let sE = 0;
    if (act) {
      const lg = act.lnGamma(T, x);
      for (let i = 0; i < n; i++) if (x[i] > 0 && !(henry[i] && henryMix(i, T, x))) sE -= R * x[i] * lg[i];
      if (excessH) {
        const dT = 0.01;
        const g1 = act.lnGamma(T + dT, x), g0 = act.lnGamma(T - dT, x);
        let he = 0; for (let i = 0; i < n; i++) he += x[i] * (g1[i] - g0[i]) / (2 * dT);
        sE += -R * T * he;      // H^E / T
      }
    }
    return s + sMix + sE;
  }
  function volPhase(T, P, x, phase) {
    if (phase === 'V') {
      if (eos) return eos.state(T, P, x, 'V').V;
      return assoc ? R * T / (P * assoc.mix(T, P, x).S) : R * T / P;
    }
    if (elec) { let v = elec.volume(T, x); for (let i = 0; i < n; i++) if (!owned[i] && x[i] > 0) v += x[i] * 35e-6; return v; }
    return liquidVolume(comps, T, P, x, eos);
  }
  // ---- electrolyte liquid: partial molar properties by Gibbs–Helmholtz ----
  // h̄_i = h_i,ig − ΔHvap,i (solvents) + (−RT² ∂ln a_i/∂T); CO2: h_ig − RT² ∂ln f/∂T;
  // K2CO3: aqueous standard state (NBS) − RT² ∂ln a/∂T. Henry gases as in the γ–φ packages.
  function elecPartials(T, P, x) {
    const xs = elec.sub(x);
    const hx = elec.hEx(T, xs);
    const lp = elec.lnPhiSubRaw(T, xs);
    const out = {};
    for (const i of elec.owned) {
      const key = elec.keyOf(i);
      const xsub = key === 'H2O' ? xs.w : key === 'CO2' ? xs.g : xs.a;
      const lnf = lp[key] + Math.log(xsub) + Math.log(xs.S);           // ln f_i [Pa], diluted by any Henry gases
      let h, sv;
      if (key === 'K2CO3') {
        const ref = elec.saltRef(T);
        const lnact = elec.rel(T, xs).K2CO3;
        h = ref.h + hx.K2CO3;
        sv = ref.s + hx.K2CO3 / T - R * lnact - R * Math.log(xs.S);
      } else {
        const hg = hig(i, T);
        h = hg + (hx[key] || 0);
        if (key !== 'CO2') {
          h -= hvap(comps[i], T);
          if (T < comps[i].Tc) h += vLiq(comps[i], T) * (P - psat(comps[i], T));
        }
        sv = sig(i, T) - R * (lnf - Math.log(P0)) + (h - hg) / T;
      }
      out[i] = { h, s: sv };
    }
    return out;
  }
  function elecH(T, P, x) {
    const pm = elecPartials(T, P, x);
    let h = 0;
    for (let i = 0; i < n; i++) {
      if (!(x[i] > 0)) continue;
      if (owned[i]) { h += x[i] * pm[i].h; continue; }
      const hm = henryMix(i, T, x);
      h += x[i] * (hig(i, T) + (hm ? R * hm.B : 0));
    }
    return h;
  }
  function elecS(T, P, x) {
    const pm = elecPartials(T, P, x);
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (!(x[i] > 0)) continue;
      if (owned[i]) { s += x[i] * pm[i].s; continue; }
      const hm = henryMix(i, T, x);
      const lnH = hm ? hm.lnH : Math.log(1e12);
      s += x[i] * (sig(i, T) - R * (Math.log(x[i]) + lnH - Math.log(P0)) + (hm ? R * hm.B / T : 0));
    }
    return s;
  }
  // valid phases: vapour–liquid–liquid when asked (three_phase:true), or by
  // default ('auto') for an equation of state with water plus a hydrocarbon
  // that can condense (Tc > 360 K, i.e. propane and heavier) — free water
  const hcLiquid = comps.some((c, i) => keys[i] !== 'H2O' && c.cat === 'hydrocarbon' && c.Tc > 360);
  const threePhase = !elec && (s.three_phase === true || ((s.three_phase === undefined || s.three_phase === 'auto') && isEOS && keys.includes('H2O') && hcLiquid));
  return {
    model, label: PACKAGES[model], keys, comps, n, isEOS, vapourModel, warnings, kijUsed, threePhase,
    henryKeys: keys.filter((k, i) => henry[i]), poynting,
    association: assoc ? { keys: assoc.keys, sources: assoc.src } : null,
    electrolyte: elec ? { model: elecModel, solvent: elec.solvent, report: (T, x) => elec.report(T, x), warn: (T, x) => elec.warn(T, x), viscosity: elec.viscosity,
      saltLnAct: (T, x) => { const r = elec.rel(T, elec.sub(x)); return num(r.K2CO3) ? r.K2CO3 : 0; },
      nonvolatile: keys.map((k) => ELECTROLYTE_KEYS.includes(k)) } : null,
    eos, act, lnFug, lnK, hPhase, sPhase, volPhase, hig, sig,
    idealGasData: useNist ? 'nist+chemsep' : 'chemsep',
    MW: comps.map((c) => c.MW),
  };
}

// ---------------------------------------------------------------------------
// Rachford–Rice (negative-flash capable, Leibovici–Neoschil bracketed Newton)
// ---------------------------------------------------------------------------
export function rachfordRice(z, K) {
  const n = z.length;
  let Kmax = -Infinity, Kmin = Infinity;
  for (let i = 0; i < n; i++) if (z[i] > 0) { Kmax = Math.max(Kmax, K[i]); Kmin = Math.min(Kmin, K[i]); }
  const f = (b) => { let s = 0; for (let i = 0; i < n; i++) if (z[i] > 0) s += z[i] * (K[i] - 1) / ((1 - b) + b * K[i]); return s; };
  if (Kmax <= 1) return { beta: 0, below: true };
  if (Kmin >= 1) return { beta: 1, above: true };
  let lo = 1 / (1 - Kmax) + 1e-14, hi = 1 / (1 - Kmin) - 1e-14;
  let b = Math.min(Math.max(0.5, lo + 1e-9), hi - 1e-9);
  for (let it = 0; it < 200; it++) {
    let fv = 0, d = 0;
    for (let i = 0; i < n; i++) if (z[i] > 0) { const t = K[i] - 1, den = 1 + b * t; fv += z[i] * t / den; d -= z[i] * t * t / (den * den); }
    if (fv > 0) lo = b; else hi = b;
    let bn = b - fv / d;
    if (!(bn > lo && bn < hi)) bn = 0.5 * (lo + hi);
    if (Math.abs(bn - b) < 1e-15) { b = bn; break; }
    b = bn;
  }
  return { beta: b, f: f(b) };
}

function phaseComps(z, K, beta) {
  const n = z.length, x = new Array(n), y = new Array(n);
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { x[i] = z[i] / ((1 - beta) + beta * K[i]); y[i] = K[i] * x[i]; sx += x[i]; sy += y[i]; }
  for (let i = 0; i < n; i++) { x[i] /= sx; y[i] /= sy; }
  return { x, y };
}

const wilsonK = (pp, T, P) => pp.comps.map((c) => c.Pc / P * Math.exp(5.373 * (1 + c.omega) * (1 - c.Tc / T)));

// ---------------------------------------------------------------------------
// stability (Michelsen tangent-plane distance) — EOS packages
// ---------------------------------------------------------------------------
function stabilityEOS(pp, T, P, z) {
  const n = pp.n;
  const ref = pp.eos.state(T, P, z, 'min');
  const di = z.map((zi, i) => (zi > 0 ? Math.log(zi) + ref.lnphi[i] : -Infinity));
  const Kw = wilsonK(pp, T, P);
  let best = null;
  for (const trial of ['V', 'L']) {
    let W = z.map((zi, i) => (trial === 'V' ? zi * Kw[i] : zi / Kw[i]));
    let tm = 0, conv = false;
    for (let it = 0; it < 200; it++) {
      const sW = W.reduce((a, v) => a + v, 0);
      const w = W.map((v) => v / sW);
      const st = pp.eos.state(T, P, w, trial === 'V' ? 'V' : 'L');
      const lnW = st.lnphi.map((lp, i) => (z[i] > 0 ? di[i] - lp : -Infinity));
      const Wn = lnW.map((v) => (isFinite(v) ? Math.exp(v) : 0));
      let err = 0;
      for (let i = 0; i < n; i++) if (z[i] > 0) err = Math.max(err, Math.abs(Math.log(Wn[i]) - Math.log(Math.max(W[i], 1e-300))));
      W = Wn;
      tm = 1 - W.reduce((a, v) => a + v, 0);
      if (err < 1e-10) { conv = true; break; }
      // trivial solution check
      let triv = 0; for (let i = 0; i < n; i++) if (z[i] > 0) triv += Math.pow(Math.log(W[i] / z[i] / 1), 2);
      if (triv < 1e-8 && it > 3) break;
    }
    const sW = W.reduce((a, v) => a + v, 0);
    let triv = 0; for (let i = 0; i < n; i++) if (z[i] > 0) triv += Math.pow(Math.log(W[i] / sW / z[i]), 2);
    if (triv < 1e-6) continue;           // converged to the feed itself
    if (tm < -1e-9 && (!best || tm < best.tm)) best = { tm, trial, W: W.map((v) => v / sW) };
  }
  return best;  // null → stable
}

// ---------------------------------------------------------------------------
// PT flash
// ---------------------------------------------------------------------------

const liveIdx = (z) => z.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);

/**
 * Isothermal flash.
 * @param {object} pp package
 * @param {number[]} z feed mole fractions (sum 1)
 * @param {number} T K
 * @param {number} P Pa
 * @returns {{T,P,beta,x,y,phase:('V'|'L'|'VL'),iterations:number}}
 */
export function flashPT(pp, z, T, P) {
  if (!(T > 0) || !(P > 0)) fail('TH_TP', 'flash needs T > 0 and P > 0');
  const live = liveIdx(z);
  if (live.length === 1) {
    // pure component: saturation from the vapour-pressure correlation (as DWSIM / ChemSep)
    const c = pp.comps[live[0]];
    if (T >= c.Tc || P >= c.Pc) return single(pp, z, T, P, T >= c.Tc ? 'V' : 'L');
    return single(pp, z, T, P, psat(c, T) > P ? 'V' : 'L');
  }
  return pp.isEOS ? flashPT_EOS(pp, z, T, P) : pp.electrolyte ? flashPT_elec(pp, z, T, P) : flashPT_act(pp, z, T, P);
}

/**
 * Isothermal flash for the acid-gas electrolyte packages. The K-value of CO2
 * changes by decades with the liquid loading and the liquid leaving a Murphree
 * tray can sit a hair above its bubble point, so successive substitution is
 * unreliable. Newton is applied instead to ln f_i,L(x) = ln f_i,V(y) with the
 * vapour fraction β as an unknown: for small β the unknowns are ln y_i and β
 * (x from the material balance, well conditioned as β → 0), for large β the
 * unknowns are ln x_i and β. Non-volatile salts stay in the liquid.
 */
function flashPT_elec(pp, z, T, P) {
  const n = pp.n, nv = pp.electrolyte.nonvolatile;
  // a mere trace of salt (carried into a gas by a column's numerics) cannot be resolved
  // as a brine droplet: flash the salt-free remainder and put the salt in its liquid
  let sTr = 0, sBig = false;
  for (let i = 0; i < n; i++) if (nv[i] && z[i] > 0) { sTr += z[i]; if (z[i] >= 1e-9) sBig = true; }
  if (sTr > 0 && !sBig) {
    const z2 = z.map((v, i) => (nv[i] ? 0 : v / (1 - sTr)));
    const r = flashPT_elec(pp, z2, T, P);
    if (r.phase !== 'VL') return single(pp, z, T, P, r.phase);
    const Lm = (1 - r.beta) * (1 - sTr) + sTr;
    const x = r.x.map((v, i) => (nv[i] ? z[i] : (1 - r.beta) * (1 - sTr) * v) / Lm);
    return { ...r, beta: r.beta * (1 - sTr), x };
  }
  // ultra-trace volatile components (a column's 1e-18 flow floors) make the Newton
  // below crawl: solve without them, then split them with their K-values
  {
    let tr = 0; const trI = [];
    for (let i = 0; i < n; i++) if (!nv[i] && z[i] > 0 && z[i] < 1e-14) { tr += z[i]; trI.push(i); }
    if (trI.length && tr < 1e-12) {
      const z2 = z.map((v, i) => (trI.includes(i) ? 0 : v / (1 - tr)));
      const r = flashPT_elec(pp, z2, T, P);
      if (r.phase !== 'VL') return single(pp, z, T, P, r.phase);
      const lpL = pp.lnFug(T, P, r.x, 'L'), lpV = pp.lnFug(T, P, r.y, 'V');
      const x = r.x.map((v) => v * (1 - tr)), y = r.y.map((v) => v * (1 - tr));
      for (const i of trI) {
        const K = Math.exp(Math.min(700, lpL[i] - lpV[i]));
        x[i] = z[i] / ((1 - r.beta) + r.beta * K); y[i] = K * x[i];
      }
      const sx = x.reduce((a, b) => a + b, 0), sy = y.reduce((a, b) => a + b, 0);
      return { ...r, x: x.map((v) => v / sx), y: y.map((v) => v / sy) };
    }
  }
  const vol = [], salt = [];
  for (let i = 0; i < n; i++) if (z[i] > 0) (nv[i] ? salt : vol).push(i);
  const lnP = Math.log(P);
  const lnfL = (x) => { const lp = pp.lnFug(T, P, x, 'L'); return lp.map((v, i) => v + Math.log(Math.max(x[i], 1e-300)) + lnP); };
  const lnPhiV = (y) => pp.lnFug(T, P, y, 'V');
  // 1. all-liquid test (incipient vapour from the feed as liquid)
  const fz = lnfL(z);
  let y = z.map((v, i) => (vol.includes(i) ? Math.exp(fz[i]) / P : 0));
  let sumY = 0;
  for (let k = 0; k < 20; k++) {
    const sy = y.reduce((a, b) => a + b, 0); if (!(sy > 0)) break;
    const yn = y.map((v) => v / sy);
    const lv = lnPhiV(yn);
    y = z.map((v, i) => (vol.includes(i) ? Math.exp(fz[i] - lv[i]) / P : 0));
    sumY = y.reduce((a, b) => a + b, 0);
  }
  if (sumY <= 1 + 1e-7) return single(pp, z, T, P, 'L');      // (a vapour below ~1e-7 of the feed is not resolved)
  const yInc = y.map((v) => v / sumY);
  // an equation-of-state "vapour" of this composition that is liquid-like (no
  // vapour root) cannot form: the feed is a compressed liquid
  const vapLike = (yy) => !pp.eos || P * pp.volPhase(T, P, yy, 'V') / (R * T) > 0.3;
  if (!vapLike(yInc)) return single(pp, z, T, P, 'L');
  // 2. vapour fraction estimate from Rachford–Rice at K = y_inc / z
  const K0 = z.map((zi, i) => (vol.includes(i) && zi > 0 ? Math.max(y[i] / zi, 1e-30) : 1e-30));
  const rr = rachfordRice(z, K0);
  let beta0 = rr.below ? 1e-8 : rr.above ? 0.999 : Math.min(0.999, Math.max(1e-10, rr.beta));
  const m = vol.length;
  // unknowns u = [w_1 … w_m, β]: for a component that stays mostly in the liquid
  // w = ln y (x from the balance), for one that goes mostly to the vapour w = ln x
  // (y from the balance) — both differences stay well conditioned
  let vapRich = vol.map((i) => beta0 * K0[i] / (1 + beta0 * (K0[i] - 1)) > 0.5);
  const build = (u) => {
    const beta = u[m];
    if (!(beta > 0 && beta < 1)) return null;
    const x = new Array(n).fill(0), yy = new Array(n).fill(0);
    for (const i of salt) x[i] = z[i] / (1 - beta);
    for (let q = 0; q < m; q++) {
      const i = vol[q], w = Math.exp(u[q]);
      if (vapRich[q]) { x[i] = w; yy[i] = (z[i] - (1 - beta) * w) / beta; if (!(yy[i] > 0)) return null; }
      else { yy[i] = w; x[i] = (z[i] - beta * w) / (1 - beta); if (!(x[i] > 0)) return null; }
    }
    return { beta, x, y: yy };
  };
  const resid = (u) => {
    const st = build(u);
    if (!st) return null;
    const sx = st.x.reduce((a, b) => a + b, 0), sy = st.y.reduce((a, b) => a + b, 0);
    const xn = st.x.map((v) => v / sx), yn = st.y.map((v) => v / sy);
    const fl = lnfL(xn), pv = lnPhiV(yn);
    // f_L at the normalised x times Σx, f_V at the normalised y times Σy (exact at the solution, where both sums are 1)
    const r = vol.map((i) => Math.log(st.y[i]) + pv[i] + lnP - fl[i] - Math.log(sx));
    r.push(st.beta < 0.5 ? sy - 1 : sx - 1);
    let nrm = 0; for (const v of r) nrm = Math.max(nrm, Math.abs(v));
    return isFinite(nrm) ? { st, r, nrm, xn, yn } : null;
  };
  const newton = (u0) => {
    let u = u0.slice(), cur = resid(u), itN = 0;
    if (!cur) return null;
    for (let it = 0; it < 80 && cur.nrm > 1e-12; it++, itN++) {
      const J = [];
      for (let c = 0; c <= m; c++) {
        let h = c === m ? Math.max(1e-10, 1e-7 * Math.min(u[m], 1 - u[m])) : 1e-7;
        let up = u.slice(); up[c] += h;
        let rp = resid(up);
        if (!rp) { h = -h; up = u.slice(); up[c] += h; rp = resid(up); }
        if (!rp) return null;
        for (let a = 0; a <= m; a++) { if (!J[a]) J[a] = new Array(m + 1); J[a][c] = (rp.r[a] - cur.r[a]) / h; }
      }
      const du = solveLin(J, cur.r.map((v) => -v));
      if (!du) return null;
      let lim = 1;
      for (let q = 0; q < m; q++) if (Math.abs(du[q]) * lim > 3) lim = 3 / Math.abs(du[q]);
      let alpha = lim, acc = false;
      for (let ls = 0; ls < 40; ls++) {
        const un = u.map((v, q) => v + alpha * du[q]);
        if (!(un[m] > 0)) un[m] = u[m] * 0.1;
        if (!(un[m] < 1)) un[m] = 1 - (1 - u[m]) * 0.1;
        const cn = resid(un);
        if (cn && cn.nrm < cur.nrm * (1 - 1e-4 * alpha)) { u = un; cur = cn; acc = true; break; }
        alpha *= 0.5;
      }
      if (!acc) break;
      if (u[m] < 1e-14) return { beta: 0, st: cur, nrm: 0 };
    }
    return { beta: u[m], st: cur, nrm: cur.nrm, it: itN };
  };
  const start = (b0) => {
    vapRich = vol.map((i) => b0 * K0[i] / (1 + b0 * (K0[i] - 1)) > 0.5);
    return vol.map((i, q) => {
      const xi = z[i] / (1 + b0 * (K0[i] - 1));
      return Math.log(Math.max(vapRich[q] ? xi : K0[i] * xi, 1e-300));
    }).concat([b0]);
  };
  // Gibbs energy / RT of a converged state (same chemical potential in both phases):
  // Σ_volatile z_i ln f_i + Σ_salt z_s ln a_s
  const gRT = (r) => {
    const fl = lnfL(r.st.xn);
    let g = 0;
    for (const i of vol) g += z[i] * fl[i];
    for (const i of salt) g += z[i] * pp.electrolyte.saltLnAct(T, r.st.xn);
    return g;
  };
  // concentrated salt solutions (where the extrapolated Pitzer model can have more than
  // one vapour–liquid solution) are solved from every start and the lowest-G state kept
  const concentrated = (r) => salt.length && salt.some((i) => r.st.xn[i] / Math.max(r.st.xn[pp.keys.indexOf('H2O')] || 0, 1e-9) > 0.07);
  // incipient-liquid (dew) test by Newton on ln x (unnormalised): f_L(x/Σx)·Σx = f_V(z);
  // Σx ≤ 1 means the vapour is stable (only without a salt — a salt keeps a liquid)
  const dewTest = (extraStarts) => {
    const lpv = lnPhiV(z);
    const tgt = vol.map((i) => Math.log(z[i]) + lpv[i]);
    const F = (lx) => {
      const x = new Array(n).fill(0);
      let sx = 0; for (let q = 0; q < m; q++) { x[vol[q]] = Math.exp(lx[q]); sx += x[vol[q]]; }
      const lpl = pp.lnFug(T, P, x.map((v) => v / sx), 'L');
      const r = vol.map((i, q) => lx[q] + lpl[i] - tgt[q]);
      let nr = 0; for (const v of r) nr = Math.max(nr, Math.abs(v));
      return isFinite(nr) ? { r, nr, sx, x } : null;
    };
    const dewNewton = (x0) => {
      let lx = vol.map((i) => Math.log(Math.max(x0[i], 1e-300))), cur = F(lx);
      if (!cur) return null;
      for (let it = 0; it < 60 && cur.nr > 1e-11; it++) {
        const J = [];
        for (let c = 0; c < m; c++) {
          const l2 = lx.slice(); l2[c] += 1e-7; const r2 = F(l2); if (!r2) return null;
          for (let a = 0; a < m; a++) { if (!J[a]) J[a] = new Array(m); J[a][c] = (r2.r[a] - cur.r[a]) / 1e-7; }
        }
        const d = solveLin(J, cur.r.map((v) => -v)); if (!d) return null;
        let al = 1; for (const v of d) if (Math.abs(v) * al > 3) al = 3 / Math.abs(v);
        let ok = false;
        for (let ls = 0; ls < 30; ls++) {
          const ln = lx.map((v, q) => v + al * d[q]), cn = F(ln);
          if (cn && cn.nr < cur.nr * (1 - 1e-4 * al)) { lx = ln; cur = cn; ok = true; break; }
          al *= 0.5;
        }
        if (!ok) break;
      }
      return cur;
    };
    const starts = extraStarts.concat([z.map((zi, i) => (zi > 0 ? zi / Math.max(K0[i], 1e-12) : 0))]);
    for (const x0 of starts) { const d = dewNewton(x0); if (d && d.nr < 1e-9) return d; }
    return null;
  };
  let dw0 = null;
  if (!salt.length && beta0 > 0.5) {
    dw0 = dewTest([]);
    if (dw0 && dw0.sx <= 1 + 1e-9) return single(pp, z, T, P, 'V');
  }
  let res = null, best = null, closest = null;
  for (const b0 of [beta0, Math.min(0.5, Math.max(1e-6, beta0 * 3)), Math.max(1e-9, beta0 / 10), 0.5, 0.9]) {
    res = newton(start(b0));
    if (res && (!closest || res.nrm < closest.nrm)) closest = res;
    if (res && res.nrm < 1e-9) {
      if (!best) { best = res; if (!concentrated(res)) break; continue; }
      if (Math.abs(res.beta - best.beta) > 1e-7 && gRT(res) < gRT(best) - 1e-10) best = res;
    }
  }
  if (best) res = best;
  else if (closest && closest.nrm < 1e-6 && closest.beta > 1e-12 && closest.beta < 1 - 1e-12) res = closest;   // round-off limited (near a phase boundary)
  if (!res || !(res.nrm < 1e-8) || (!salt.length && res.beta > 1 - 1e-6)) {
    // without a salt the liquid can vanish: incipient-liquid (dew) test
    if (!salt.length) {
      const dw = dw0 || dewTest(res && res.st ? [res.st.xn] : []);
      if (dw && dw.sx <= 1 + 1e-9) return single(pp, z, T, P, 'V');
      if (dw && !(res && res.nrm < 1e-8 && res.beta <= 1 - 1e-6)) {
        // a liquid forms just below the dew point: restart from the incipient liquid with
        // every component's ln x as unknown (the vapour is close to the feed)
        const xi = dw.x.map((v) => v / dw.sx);
        for (const b0 of [1 - 0.5 * (dw.sx - 1), 0.99, 0.9]) {
          const bb = Math.min(1 - 1e-9, Math.max(0.5, b0));
          vapRich = vol.map(() => true);
          const r2 = newton(vol.map((i) => Math.log(Math.max(xi[i], 1e-300))).concat([bb]));
          if (r2 && r2.nrm < 1e-9) { res = r2; break; }
        }
      }
    }
  }
  if ((!res || !(res.nrm < 1e-8)) && closest && closest.nrm < 1e-4 && closest.beta < 1e-5 && sumY < 1 + 1e-4) {
    // at the bubble point within round-off (Newton cannot resolve a vapour of ~1e-9)
    return single(pp, z, T, P, 'L');
  }
  if ((!res || !(res.nrm < 1e-8)) && salt.length && closest) {
    // the usual cause: the brine boils down past the salt's solubility (solids would form)
    const iW = pp.keys.indexOf('H2O');
    const xw = iW >= 0 ? closest.st.xn[iW] : 0;
    const note = pp.electrolyte.warn(T, closest.st.xn) || '';
    if (/too concentrated/.test(note) || !(xw > 0.5)) {
      const mol = salt.reduce((a, i) => a + closest.st.xn[i], 0) / Math.max(xw * 0.018015, 1e-12);
      fail('TH_FLASH', `acid-gas flash at ${T.toFixed(2)} K, ${(P / 1e5).toFixed(3)} bar: the solution boils down past the salt's solubility (the liquid heads beyond ${Math.min(mol, 99).toFixed(0)} mol salt per kg water) — solid salt would form, which the model does not cover; raise the pressure, lower the temperature or add water`);
    }
  }
  if (!res || !(res.nrm < 1e-6)) {
    fail('TH_FLASH', `acid-gas flash did not converge at ${T.toFixed(2)} K, ${(P / 1e5).toFixed(3)} bar (residual ${res ? res.nrm.toExponential(2) : 'n/a'})`);
  }
  if (res.beta < 1e-13 || !vapLike(res.st.yn)) return single(pp, z, T, P, 'L');
  if (!salt.length && res.beta > 1 - 1e-13) return single(pp, z, T, P, 'V');
  return { T, P, beta: res.beta, x: res.st.xn, y: res.st.yn, phase: 'VL', iterations: 0 };
}
function solveLin(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s2 = M[r][n]; for (let k = r + 1; k < n; k++) s2 -= M[r][k] * x[k]; x[r] = s2 / M[r][r]; }
  return x;
}

function single(pp, z, T, P, ph) {
  return { T, P, beta: ph === 'V' ? 1 : 0, x: z.slice(), y: z.slice(), phase: ph, iterations: 0 };
}

/**
 * Successive substitution on K with dominant-eigenvalue acceleration.
 * Negative flash is allowed while iterating; a converged β outside (0,1)
 * means the feed is single-phase.
 */
function ssFlash(pp, z, T, P, K0, maxIt) {
  const n = pp.n;
  let K = K0.slice(), x, y, beta = 0.5, it = 0;
  let lnKprev = K.map(Math.log);
  const hist = [];
  for (it = 1; it <= (maxIt || 500); it++) {
    const rr = rachfordRice(z, K);
    if (rr.below || rr.above) return { beta: rr.below ? 0 : 1, single: rr.below ? 'L' : 'V', K, it };
    beta = rr.beta;
    ({ x, y } = phaseComps(z, K, beta));
    const lnKn = pp.lnK(T, P, x, y);
    let err = 0; for (let i = 0; i < n; i++) if (z[i] > 0) err = Math.max(err, Math.abs(lnKn[i] - lnKprev[i]));
    hist.push(lnKn);
    let lnKu = lnKn;
    if (it % 5 === 0 && hist.length >= 3) {
      const ha = hist[hist.length - 3], hb = hist[hist.length - 2], hc = hist[hist.length - 1];
      let nu1 = 0, de1 = 0;
      for (let i = 0; i < n; i++) if (z[i] > 0) { const d1 = hb[i] - ha[i], d2 = hc[i] - hb[i]; nu1 += d2 * d1; de1 += d1 * d1; }
      const lam = de1 > 0 ? nu1 / de1 : 0;
      if (lam > 0 && lam < 0.995) lnKu = hc.map((v, i) => v + lam / (1 - lam) * (hc[i] - hb[i]));
    }
    K = lnKu.map(Math.exp);
    lnKprev = lnKu;
    let triv = 0; for (let i = 0; i < n; i++) if (z[i] > 0) triv += lnKn[i] * lnKn[i];
    if (triv < 1e-10) return { beta, trivial: true, K, it };
    if (err < 1e-11) break;
  }
  const rr = rachfordRice(z, K);
  if (rr.below || rr.above) return { beta: rr.below ? 0 : 1, single: rr.below ? 'L' : 'V', K, it };
  if (rr.beta <= 0 || rr.beta >= 1) return { beta: rr.beta, single: rr.beta <= 0 ? 'L' : 'V', K, it };
  ({ x, y } = phaseComps(z, K, rr.beta));
  return { beta: rr.beta, x, y, K, it };
}

function labelSingleEOS(pp, z, T, P) {
  const st = pp.eos.state(T, P, z, 'min');
  if (st.nRoots > 1) {
    const v = pp.eos.state(T, P, z, 'V');
    return Math.abs(v.Z - st.Z) < 1e-12 ? 'V' : 'L';
  }
  // one root: pseudo-critical temperature (Li's rule) decides the label
  let sv = 0; for (let i = 0; i < pp.n; i++) sv += z[i] * (pp.comps[i].vc || 0);
  let Tpc = 0;
  if (sv > 0) for (let i = 0; i < pp.n; i++) Tpc += z[i] * (pp.comps[i].vc || 0) / sv * pp.comps[i].Tc;
  else for (let i = 0; i < pp.n; i++) Tpc += z[i] * pp.comps[i].Tc;
  return T >= Tpc ? 'V' : 'L';
}

function flashPT_EOS(pp, z, T, P) {
  const Kw = wilsonK(pp, T, P);
  const rr = rachfordRice(z, Kw);
  if (!rr.below && !rr.above && rr.beta > 0 && rr.beta < 1) {
    const r = ssFlash(pp, z, T, P, Kw);
    if (!r.single && !r.trivial) return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it };
  }
  const st = stabilityEOS(pp, T, P, z);
  if (!st) return single(pp, z, T, P, labelSingleEOS(pp, z, T, P));
  const K0 = st.trial === 'V'
    ? st.W.map((w, i) => (z[i] > 0 ? w / z[i] : 1))
    : st.W.map((w, i) => (z[i] > 0 && w > 0 ? z[i] / w : 1));
  const r = ssFlash(pp, z, T, P, K0, 1000);
  if (r.single || r.trivial) return single(pp, z, T, P, labelSingleEOS(pp, z, T, P));
  return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it };
}

function flashPT_act(pp, z, T, P) {
  const n = pp.n;
  let K = pp.lnK(T, P, z, z).map(Math.exp);
  for (let outer = 0; outer < 4; outer++) {
    const r = ssFlash(pp, z, T, P, K, 600);
    if (!r.single && !r.trivial) return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it };
    if (r.single === 'L' || (r.trivial && r.beta <= 0.5)) {
      // incipient-vapour test at x = z
      let y = z.slice(), Kb = K;
      for (let k = 0; k < 80; k++) {
        Kb = pp.lnK(T, P, z, y).map(Math.exp);
        let sy = 0; const yn = z.map((v, i) => { const t = v * Kb[i]; sy += t; return t; });
        y = yn.map((v) => v / sy);
      }
      let s2 = 0; for (let i = 0; i < n; i++) s2 += z[i] * Kb[i];
      if (s2 <= 1 + 1e-10) return single(pp, z, T, P, 'L');
      K = Kb;
    } else {
      // incipient-liquid test at y = z
      let x = z.slice(), Kd = K;
      for (let k = 0; k < 80; k++) {
        Kd = pp.lnK(T, P, x, z).map(Math.exp);
        let sx = 0; const xn = z.map((v, i) => { const t = v / Kd[i]; sx += t; return t; });
        x = xn.map((v) => v / sx);
      }
      let s2 = 0; for (let i = 0; i < n; i++) s2 += z[i] / Kd[i];
      if (s2 <= 1 + 1e-10) return single(pp, z, T, P, 'V');
      K = Kd;
    }
  }
  // fall back: decide by the bubble-point sum at the feed
  const Kz = pp.lnK(T, P, z, z).map(Math.exp);
  let sb = 0; for (let i = 0; i < n; i++) sb += z[i] * Kz[i];
  return single(pp, z, T, P, sb > 1 ? 'V' : 'L');
}

// ---------------------------------------------------------------------------
// THREE-PHASE (VLLE) FLASH — Step 22, phase 4
// The two-phase result is tested for a second liquid with Michelsen's
// tangent-plane distance (trial phases started near each pure component and
// from the Wilson estimate); if unstable, vapour / liquid 1 / liquid 2 are
// found by successive substitution on two sets of K-values (relative to
// liquid 1) with Okuno's convex three-phase Rachford–Rice. Works with every
// package: EOS liquids from the cubic, activity liquids from γ.
// ---------------------------------------------------------------------------

/**
 * Tangent-plane test for an additional liquid against an equilibrium state
 * (single liquid x, or vapour y + liquid x). The reference fugacities come
 * from the vapour where it exists (exact for components absent from the
 * liquid). Returns the most negative trial {tm, w} or null.
 */
function stabilityLiquid(pp, T, P, x, z, y) {
  const live = liveIdx(z);
  if (live.length < 2) return null;
  const fl = pp.lnFug(T, P, x, 'L'), fv = y ? pp.lnFug(T, P, y, 'V') : null;
  const d = z.map((zi, i) => {
    if (!(zi > 0)) return -Infinity;
    if (y && y[i] > 0) return Math.log(y[i]) + fv[i];
    return x[i] > 0 ? Math.log(x[i]) + fl[i] : -Infinity;
  });
  x = z.map((zi, i) => (zi > 0 ? Math.max(x[i], 1e-12) : 0));
  const trials = [];
  // trial liquids rich in one component each — for long lists only the likely
  // second-liquid formers: water, the heaviest and the lightest component
  let pick = live;
  if (live.length > 6) {
    const byTc = live.slice().sort((a, b) => pp.comps[a].Tc - pp.comps[b].Tc);
    pick = [...new Set([pp.keys.indexOf('H2O'), byTc[byTc.length - 1], byTc[byTc.length - 2], byTc[0]].filter((i) => i >= 0 && z[i] > 0))];
  }
  for (const k of pick) { const w = x.map((v, i) => (i === k ? 0.98 : (v > 0 ? 0.02 * v : 0))); trials.push(w); }
  const Kw = wilsonK(pp, T, P);
  trials.push(x.map((v, i) => (v > 0 ? v / Kw[i] : 0)));
  let best = null;
  for (const w0 of trials) {
    let W = w0.slice();
    let tm = 0;
    for (let it = 0; it < 300; it++) {
      const sW = W.reduce((a, v) => a + v, 0);
      const w = W.map((v) => v / sW);
      const f = pp.lnFug(T, P, w, 'L');
      const Wn = x.map((xi, i) => (xi > 0 ? Math.exp(d[i] - f[i]) : 0));
      let err = 0;
      for (const i of live) err = Math.max(err, Math.abs(Math.log(Math.max(Wn[i], 1e-300)) - Math.log(Math.max(W[i], 1e-300))));
      W = Wn;
      tm = 1 - W.reduce((a, v) => a + v, 0);
      if (err < 1e-10) break;
    }
    const sW = W.reduce((a, v) => a + v, 0);
    const w = W.map((v) => v / sW);
    let triv = 0; for (const i of live) triv += Math.pow(Math.log(Math.max(w[i], 1e-300) / x[i]), 2);
    if (triv < 1e-5) continue;                          // collapsed onto the reference liquid
    if (y) { let tv = 0; for (const i of live) tv += Math.pow(Math.log(Math.max(w[i], 1e-300) / Math.max(y[i], 1e-300)), 2); if (tv < 1e-5) continue; }
    if (tm < -1e-8 && (!best || tm < best.tm)) best = { tm, w };
  }
  return best;
}

/** three-phase Rachford–Rice (Okuno et al. 2010): minimise −Σ z ln t over t > 0 */
export function rachfordRice3(z, KV, KL, b0) {
  const n = z.length;
  const aV = KV.map((k) => k - 1), aL = KL.map((k) => k - 1);
  let b = b0 ? b0.slice() : [0, 0];
  const tOf = (bb) => z.map((zi, i) => 1 + bb[0] * aV[i] + bb[1] * aL[i]);
  const F = (bb) => { const t = tOf(bb); let s = 0; for (let i = 0; i < n; i++) if (z[i] > 0) { if (!(t[i] > 0)) return Infinity; s -= z[i] * Math.log(t[i]); } return s; };
  if (!isFinite(F(b))) b = [0, 0];
  let Fb = F(b);
  for (let it = 0; it < 200; it++) {
    const t = tOf(b);
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < n; i++) {
      if (!(z[i] > 0)) continue;
      const u = z[i] / t[i], u2 = u / t[i];
      g0 += u * aV[i]; g1 += u * aL[i];
      h00 += u2 * aV[i] * aV[i]; h01 += u2 * aV[i] * aL[i]; h11 += u2 * aL[i] * aL[i];
    }
    if (Math.abs(g0) + Math.abs(g1) < 1e-14) break;
    const det = h00 * h11 - h01 * h01;
    let d0, d1;
    if (Math.abs(det) > 1e-300) { d0 = (h11 * g0 - h01 * g1) / det; d1 = (h00 * g1 - h01 * g0) / det; }
    else { d0 = g0 / (h00 || 1); d1 = g1 / (h11 || 1); }
    let s = 1, bn, Fn;
    for (let k = 0; k < 60; k++) { bn = [b[0] + s * d0, b[1] + s * d1]; Fn = F(bn); if (Fn <= Fb + 1e-16) break; s *= 0.5; }
    if (!(Fn <= Fb + 1e-16)) break;
    const step = Math.abs(bn[0] - b[0]) + Math.abs(bn[1] - b[1]);
    b = bn; Fb = Fn;
    if (step < 1e-15) break;
  }
  const t = tOf(b);
  const x1 = z.map((zi, i) => zi / t[i]);
  return { bV: b[0], bL: b[1], x1 };
}

/** liquid–liquid (no vapour) split by successive substitution from a trial liquid */
function ssLL(pp, z, T, P, x1, x2, maxIt) {
  const n = pp.n, live = liveIdx(z);
  let K = z.map((zi, i) => (zi > 0 ? Math.max(x2[i], 1e-30) / Math.max(x1[i], 1e-30) : 1));
  let beta = 0.5, xa = x1, xb = x2, it;
  for (it = 1; it <= (maxIt || 800); it++) {
    const rr = rachfordRice(z, K);
    if (rr.below || rr.above) return null;
    beta = rr.beta;
    ({ x: xa, y: xb } = phaseComps(z, K, beta));
    const lnK = pp.lnFug(T, P, xa, 'L').map((v, i) => v - pp.lnFug(T, P, xb, 'L')[i]);
    let err = 0, triv = 0;
    for (const i of live) { err = Math.max(err, Math.abs(lnK[i] - Math.log(K[i]))); triv += lnK[i] * lnK[i]; }
    K = lnK.map(Math.exp);
    if (triv < 1e-8) return null;
    if (err < 1e-10) break;
  }
  if (!(beta > 0 && beta < 1)) return null;
  void n;
  return { beta, x1: xa, x2: xb, it };
}

/** order two liquids: liquid 1 = lighter (lower mass density) */
function orderLiquids(pp, T, P, r) {
  if (!r.x2) return r;
  const rho = (x) => { const MW = x.reduce((a, v, i) => a + v * pp.MW[i], 0); return MW / 1000 / pp.volPhase(T, P, x, 'L'); };
  if (rho(r.x) > rho(r.x2)) {
    const bL1 = 1 - r.beta - r.beta2;
    return { ...r, x: r.x2, x2: r.x, beta2: bL1 };
  }
  return r;
}

/** G/RT of a flash state (common ideal-gas reference, so states of one feed compare) */
function gibbsRT(pp, T, P, r) {
  const ph = [];
  if (r.x2 && r.beta2 > 0) { if (r.beta > 0) ph.push([r.beta, r.y, 'V']); ph.push([1 - r.beta - r.beta2, r.x, 'L'], [r.beta2, r.x2, 'L']); }
  else if (r.phase === 'V') ph.push([1, r.y, 'V']);
  else if (r.phase === 'L') ph.push([1, r.x, 'L']);
  else ph.push([r.beta, r.y, 'V'], [1 - r.beta, r.x, 'L']);
  let g = 0;
  for (const [b, x, t] of ph) { const f = pp.lnFug(T, P, x, t); for (let i = 0; i < x.length; i++) if (x[i] > 0) g += b * x[i] * (Math.log(x[i]) + f[i]); }
  return g;
}

/** successive substitution for vapour + two liquids from starting K-values (relative to liquid 1) */
function ss3(pp, z, T, P, KV, KL, b0) {
  const n = pp.n;
  let b = b0.slice(), rr, x1, y, x2, it;
  for (it = 1; it <= 1500; it++) {
    rr = rachfordRice3(z, KV, KL, b);
    b = [rr.bV, rr.bL];
    x1 = norm(rr.x1.map((v) => Math.max(v, 0)));
    y = norm(x1.map((v, i) => v * KV[i]));
    x2 = norm(x1.map((v, i) => v * KL[i]));
    const f1 = pp.lnFug(T, P, x1, 'L'), fv = pp.lnFug(T, P, y, 'V'), f2 = pp.lnFug(T, P, x2, 'L');
    let err = 0, trivL = 0, trivV = 0;
    const KVn = new Array(n), KLn = new Array(n);
    for (let i = 0; i < n; i++) {
      const lv = f1[i] - fv[i], ll = f1[i] - f2[i];
      KVn[i] = Math.exp(lv); KLn[i] = Math.exp(ll);
      if (z[i] > 0) { err = Math.max(err, Math.abs(lv - Math.log(KV[i])), Math.abs(ll - Math.log(KL[i]))); trivL += ll * ll; trivV += lv * lv; }
    }
    KV = KVn; KL = KLn;
    if (trivL < 1e-8 || trivV < 1e-8) return null;
    if (err < 1e-10) break;
    if (it > 60 && (b[0] < -0.5 || b[1] < -0.5 || b[0] + b[1] > 1.5)) return null;   // a phase is vanishing — another candidate wins
  }
  rr = rachfordRice3(z, KV, KL, b);
  const bV = rr.bV, bL2 = rr.bL, bL1 = 1 - bV - bL2;
  if (!(bV > 1e-12 && bL2 > 1e-12 && bL1 > 1e-12)) return null;
  x1 = norm(rr.x1.map((v) => Math.max(v, 0))); y = norm(x1.map((v, i) => v * KV[i])); x2 = norm(x1.map((v, i) => v * KL[i]));
  return { T, P, beta: bV, beta2: bL2, x: x1, y, x2, phase: 'VLL', iterations: it };
}

/**
 * Three-phase isothermal flash (vapour + up to two liquids).
 * The two-phase answer is tested for a second liquid; candidate states
 * (V/L, L/L, V/L/L) are converged and the one with the lowest Gibbs energy
 * is returned — this also settles binaries, which cannot hold three phases
 * at an arbitrary T and P.
 * @returns {{T,P,beta,x,y,x2?,beta2?,phase:('V'|'L'|'VL'|'LL'|'VLL'),iterations}}
 *   beta = vapour fraction, x = liquid 1 (lighter), x2 = liquid 2 (heavier), beta2 = its fraction.
 */
export function flashPT3(pp, z, T, P) {
  const r2 = flashPT(pp, z, T, P);
  if (r2.phase === 'V' || liveIdx(z).length < 2) return r2;
  const xl = r2.phase === 'L' ? z : r2.x;
  const st = stabilityLiquid(pp, T, P, xl, z, r2.phase === 'VL' ? r2.y : null);
  if (!st) return r2;
  const cands = [r2];
  // liquid–liquid split of the whole feed
  const xs = z.map((v, i) => (v > 0 ? Math.max(xl[i], 1e-12) : 0));
  const ll = ssLL(pp, z, T, P, xs, st.w);
  let rLL = null;
  if (ll) { rLL = { T, P, beta: 0, beta2: ll.beta, x: ll.x1, y: ll.x1, x2: ll.x2, phase: 'LL', iterations: ll.it }; cands.push(rLL); }
  // vapour + two liquids, from the V/L answer and from the L/L answer
  const KL0 = xl.map((v, i) => (z[i] > 0 ? Math.max(st.w[i], 1e-30) / Math.max(v, 1e-12) : 1));
  if (r2.phase === 'VL') {
    const KV0 = r2.y.map((y, i) => (z[i] > 0 ? Math.max(y, 1e-30) / Math.max(r2.x[i], 1e-12) : 1));
    const v = ss3(pp, z, T, P, KV0, KL0, [r2.beta, 0.05]);
    if (v) cands.push(v);
  }
  if (rLL) {
    const fl = pp.lnFug(T, P, rLL.x, 'L');
    let yv = rLL.x.slice();
    for (let k = 0; k < 40; k++) { const fv = pp.lnFug(T, P, yv, 'V'); yv = norm(rLL.x.map((x, i) => x * Math.exp(fl[i] - fv[i]))); }
    const fv = pp.lnFug(T, P, yv, 'V');
    const KV0 = rLL.x.map((x, i) => Math.exp(fl[i] - fv[i]));
    let sb = 0; for (let i = 0; i < pp.n; i++) sb += rLL.x[i] * KV0[i];
    if (sb > 1 + 1e-9) {
      const KL1 = rLL.x.map((x, i) => (z[i] > 0 ? Math.max(rLL.x2[i], 1e-30) / Math.max(x, 1e-30) : 1));
      const v = ss3(pp, z, T, P, KV0, KL1, [0.05, rLL.beta2]);
      if (v) cands.push(v);
    }
  }
  let best = cands[0], gb = gibbsRT(pp, T, P, cands[0]);
  for (const c of cands.slice(1)) { const g = gibbsRT(pp, T, P, c); if (g < gb - 1e-10) { best = c; gb = g; } }
  if (best.phase === 'VLL' && pp.isEOS) best = lightestAsVapour(pp, T, P, best);
  return best.x2 ? orderLiquids(pp, T, P, best) : best;
}
/**
 * EOS three-phase answer: when a phase has a single real root its 'vapour' /
 * 'liquid' label is arbitrary — call the least dense phase the vapour (the
 * usual convention, e.g. a dense CO₂-rich phase next to a hydrocarbon liquid).
 */
function lightestAsVapour(pp, T, P, r) {
  const bL1 = 1 - r.beta - r.beta2;
  const ph = [{ c: r.y, b: r.beta, t: 'V' }, { c: r.x, b: bL1, t: 'L' }, { c: r.x2, b: r.beta2, t: 'L' }];
  for (const p of ph) {
    const st = pp.eos.state(T, P, p.c, p.t);
    p.single = pp.eos.state(T, P, p.c, 'min').nRoots === 1;
    const MW = p.c.reduce((a, v, i) => a + v * pp.MW[i], 0);
    p.rho = MW / 1000 / st.V;
  }
  let k = 0;
  for (let i = 1; i < 3; i++) if (ph[i].rho < ph[k].rho) k = i;
  if (k === 0 || !ph[0].single || !ph[k].single) return r;
  const V = ph[k], Ls = ph.filter((_, i) => i !== k);
  return { ...r, beta: V.b, y: V.c, x: Ls[0].c, x2: Ls[1].c, beta2: Ls[1].b };
}

// ---------------------------------------------------------------------------
// state functions of a flash result
// ---------------------------------------------------------------------------

/** Molar enthalpy [J/mol] of a flash result. */
export function hOf(pp, r) {
  if (r.x2 && r.beta2 > 0) {
    const bL1 = 1 - r.beta - r.beta2;
    return (r.beta > 0 ? r.beta * pp.hPhase(r.T, r.P, r.y, 'V') : 0) + bL1 * pp.hPhase(r.T, r.P, r.x, 'L') + r.beta2 * pp.hPhase(r.T, r.P, r.x2, 'L');
  }
  if (r.phase === 'V') return pp.hPhase(r.T, r.P, r.y, 'V');
  if (r.phase === 'L') return pp.hPhase(r.T, r.P, r.x, 'L');
  return r.beta * pp.hPhase(r.T, r.P, r.y, 'V') + (1 - r.beta) * pp.hPhase(r.T, r.P, r.x, 'L');
}
/** Molar entropy [J/(mol K)] of a flash result. */
export function sOf(pp, r) {
  if (r.x2 && r.beta2 > 0) {
    const bL1 = 1 - r.beta - r.beta2;
    return (r.beta > 0 ? r.beta * pp.sPhase(r.T, r.P, r.y, 'V') : 0) + bL1 * pp.sPhase(r.T, r.P, r.x, 'L') + r.beta2 * pp.sPhase(r.T, r.P, r.x2, 'L');
  }
  if (r.phase === 'V') return pp.sPhase(r.T, r.P, r.y, 'V');
  if (r.phase === 'L') return pp.sPhase(r.T, r.P, r.x, 'L');
  return r.beta * pp.sPhase(r.T, r.P, r.y, 'V') + (1 - r.beta) * pp.sPhase(r.T, r.P, r.x, 'L');
}

// ---------------------------------------------------------------------------
// PVF / TVF flashes (bubble, dew, any vapour fraction)
// ---------------------------------------------------------------------------

function phaseCompsUnnorm(z, K, beta) {
  const n = z.length, x = new Array(n), y = new Array(n);
  for (let i = 0; i < n; i++) { x[i] = z[i] / ((1 - beta) + beta * K[i]); y[i] = K[i] * x[i]; }
  return { x: norm(x), y: norm(y) };
}
function norm(v) { const s = v.reduce((a, b) => a + b, 0); return v.map((t) => t / s); }

/** Pure-component saturation temperature at P from the Psat correlation (Infinity if P ≥ Pc). */
export function satT(c, P) {
  if (P >= c.Pc) return Infinity;
  let lo = Math.max(5, (c.psat ? c.psat[6] : c.Tc * 0.3) * 0.3), hi = c.Tc;
  for (let i = 0; i < 200; i++) {
    const m = 0.5 * (lo + hi);
    if (psat(c, m) > P) hi = m; else lo = m;
    if (hi - lo < 1e-11 * hi) break;
  }
  return 0.5 * (lo + hi);
}

/**
 * Newton on one variable (u = T for PVF, u = ln P for TVF) of the
 * Rachford–Rice residual at fixed vapour fraction β, with the phase
 * compositions updated by successive substitution inside every step and
 * the starting point from Wilson K-values (which brackets robustly).
 */
function vfSolve(pp, z, beta, mode, fixed, uGuess) {
  const live = liveIdx(z);
  const TP = (u) => (mode === 'T' ? [u, fixed] : [fixed, Math.exp(u)]);
  const rrRes = (K) => { let s = 0; for (const i of live) s += z[i] * (K[i] - 1) / ((1 - beta) + beta * K[i]); return s; };
  // 1. Wilson start — the residual is monotonic in T (and in ln P)
  const wK = (u) => { const [T, P] = TP(u); return wilsonK(pp, T, P); };
  let lo, hi;
  if (mode === 'T') { lo = 20; hi = 3000; } else { lo = Math.log(1); hi = Math.log(1e9); }
  const fw = (u) => rrRes(wK(u)) * (mode === 'T' ? 1 : -1);   // increasing in u
  for (let i = 0; i < 200; i++) { const m = 0.5 * (lo + hi); if (fw(m) > 0) hi = m; else lo = m; if (hi - lo < 1e-10) break; }
  let u = num(uGuess) ? uGuess : 0.5 * (lo + hi);
  let K = wK(u);
  // compositions for the start: one SS pass with the model
  let x, y;
  ({ x, y } = phaseCompsUnnorm(z, K, beta));
  {
    const [T, P] = TP(u);
    K = pp.lnK(T, P, x, y).map(Math.exp);
  }
  const sign = mode === 'T' ? 1 : -1;
  let it, f = 0, du = 0, lastGood = null;
  for (it = 0; it < 120; it++) {
    const [T, P] = TP(u);
    // inner composition iteration at fixed u
    for (let k = 0; k < 30; k++) {
      ({ x, y } = phaseCompsUnnorm(z, K, beta));
      const Kn = pp.lnK(T, P, x, y).map(Math.exp);
      let err = 0; for (const i of live) err = Math.max(err, Math.abs(Math.log(Kn[i] / K[i])));
      K = Kn;
      if (err < 1e-10) break;
    }
    f = rrRes(K);
    let triv = 0; for (const i of live) triv += Math.log(K[i]) ** 2;
    if (pp.isEOS && triv < 1e-8) {
      // collapsed to the trivial solution (near-critical) — step back towards the last good point
      // (activity models have no trivial solution: K = 1 there is a genuine azeotrope)
      if (!lastGood) fail('TH_VF', `${beta === 0 ? 'bubble' : beta === 1 ? 'dew' : 'vapour-fraction'} point not found — mixture is near or above its critical point at these conditions`);
      u = lastGood.u + 0.3 * (u - lastGood.u); K = lastGood.K.slice(); continue;
    }
    lastGood = { u, K: K.slice() };
    if (Math.abs(f) < 1e-11 && Math.abs(du) < 1e-9 * Math.max(1, Math.abs(u))) break;
    // derivative of the residual by perturbing u at fixed phase compositions
    const h = mode === 'T' ? Math.max(1e-4, 1e-6 * u) : 1e-6;
    const [T2, P2] = TP(u + h);
    const K2 = pp.lnK(T2, P2, x, y).map(Math.exp);
    const d = (rrRes(K2) - f) / h;
    if (!(d * sign > 0)) { du = sign * (mode === 'T' ? 2 : 0.05) * (f > 0 ? -1 : 1); }
    else du = -f / d;
    const lim = mode === 'T' ? Math.max(2, 0.08 * u) : 0.3;
    if (Math.abs(du) > lim) du = Math.sign(du) * lim;
    u += du;
    if (Math.abs(f) < 1e-11 && Math.abs(du) < 1e-9 * Math.max(1, Math.abs(u))) break;
  }
  if (!(Math.abs(f) <= 1e-7)) fail('TH_VF', `${beta === 0 ? 'bubble' : beta === 1 ? 'dew' : 'vapour-fraction'} point did not converge (residual ${f.toExponential(2)})`);
  const [T, P] = TP(u);
  ({ x, y } = phaseCompsUnnorm(z, K, beta));
  return { T, P, beta, x, y, phase: beta === 0 ? 'L' : beta === 1 ? 'V' : 'VL', iterations: it, K };
}

/**
 * Temperature at which the feed has vapour fraction beta at pressure P
 * (beta = 0 bubble point, 1 dew point).
 */
export function flashPVF(pp, z, P, beta, Tguess) {
  if (!(beta >= 0 && beta <= 1)) fail('TH_VF', 'vapour fraction must be 0–1');
  const live = liveIdx(z);
  if (live.length === 1) {
    const c = pp.comps[live[0]];
    const T = satT(c, P);
    if (!isFinite(T)) fail('TH_SUPERCRITICAL', `${pp.keys[live[0]]} is supercritical at ${(P / 1e5).toFixed(3)} bar — no saturation temperature`);
    return { T, P, beta, x: z.slice(), y: z.slice(), phase: beta === 0 ? 'L' : beta === 1 ? 'V' : 'VL', iterations: 0 };
  }
  if (pp.electrolyte && beta === 1 && live.some((i) => pp.electrolyte.nonvolatile[i])) {
    fail('TH_VF', 'no dew point: the dissolved salt stays in the liquid, so the liquid cannot vanish completely');
  }
  if (num(Tguess)) { try { return vfSolve(pp, z, beta, 'T', P, Tguess); } catch (_e) { /* a poor guess can collapse onto the trivial solution — restart from Wilson */ } }
  try {
    return vfSolve(pp, z, beta, 'T', P, undefined);
  } catch (e) {
    if (pp.electrolyte && beta === 0) {
      // the acid-gas models cover 0–250 °C; say so when the bubble point lies outside
      // (cheap test: Σ z_i K_i of the feed as liquid against an ideal-gas vapour)
      const sumK = (T) => {
        try {
          const lf = pp.lnFug(T, P, z, 'L');
          let sK = 0; for (const i of live) if (!pp.electrolyte.nonvolatile[i]) sK += z[i] * Math.exp(lf[i]);
          return sK;
        } catch (_e) { return NaN; }
      };
      if (sumK(273.15) > 1) fail('TH_VF', `bubble point lies below 0 °C at ${(P / 1e5).toFixed(3)} bar — the acid-gas model's lower limit (the feed already boils at 0 °C)`);
      if (sumK(523.15) < 1) fail('TH_VF', `bubble point lies above 250 °C at ${(P / 1e5).toFixed(3)} bar — beyond the acid-gas model's range`);
    }
    throw e;
  }
}

/** Pressure at which the feed has vapour fraction beta at temperature T. */
export function flashTVF(pp, z, T, beta, Pguess) {
  if (!(beta >= 0 && beta <= 1)) fail('TH_VF', 'vapour fraction must be 0–1');
  const live = liveIdx(z);
  if (live.length === 1) {
    const c = pp.comps[live[0]];
    if (T >= c.Tc) fail('TH_SUPERCRITICAL', `${pp.keys[live[0]]} is supercritical at ${T.toFixed(2)} K — no saturation pressure`);
    return { T, P: psat(c, T), beta, x: z.slice(), y: z.slice(), phase: beta === 0 ? 'L' : beta === 1 ? 'V' : 'VL', iterations: 0 };
  }
  if (num(Pguess) && Pguess > 0) { try { return vfSolve(pp, z, beta, 'P', T, Math.log(Pguess)); } catch (_e) { /* restart from Wilson */ } }
  return vfSolve(pp, z, beta, 'P', T, undefined);
}

// ---------------------------------------------------------------------------
// PH / PS flashes
// ---------------------------------------------------------------------------

function stateFlash(pp, z, P, target, fn, Tguess, flashFn) {
  const val = (r) => (fn === 'h' ? hOf(pp, r) : sOf(pp, r));
  const ff = flashFn || flashPT;
  const at = (T) => { const r = ff(pp, z, T, P); return { T, r, v: val(r) - target }; };
  const tol = (fn === 'h' ? 1e-10 : 1e-12) * Math.abs(target) + (fn === 'h' ? 1e-6 : 1e-9);
  // pure component: plateau at Tsat is handled analytically
  const live = liveIdx(z);
  if (live.length === 1) {
    const c = pp.comps[live[0]];
    const Ts = satT(c, P);
    if (isFinite(Ts)) {
      const L = { T: Ts, P, beta: 0, x: z.slice(), y: z.slice(), phase: 'L' };
      const V = { T: Ts, P, beta: 1, x: z.slice(), y: z.slice(), phase: 'V' };
      const vl = val(L), vv = val(V);
      if (target >= vl && target <= vv) {
        const beta = (target - vl) / (vv - vl);
        return { T: Ts, P, beta, x: z.slice(), y: z.slice(), phase: beta <= 0 ? 'L' : beta >= 1 ? 'V' : 'VL', iterations: 0 };
      }
    }
  }
  let A = at(num(Tguess) && Tguess > 20 ? Tguess : 300);
  if (Math.abs(A.v) < tol) return { ...A.r, iterations: 0 };
  let step = 10, B = null;
  for (let k = 0; k < 80; k++) {
    const T2 = A.v < 0 ? A.T + step : Math.max(10, A.T - step);
    try { B = at(T2); } catch (e) {
      // a state the model cannot represent (e.g. an electrolyte boiled dry) lies beyond
      // the target in this direction: retreat with a shorter step
      if (step < 0.05) throw e;
      step /= 4; B = null; continue;
    }
    if ((A.v < 0) !== (B.v < 0) || Math.abs(B.v) < tol) break;
    if (T2 <= 10 && B.v > 0) fail(fn === 'h' ? 'TH_PH' : 'TH_PS', `${fn === 'h' ? 'enthalpy' : 'entropy'} target below the 10 K limit`);
    A = B; step *= 1.6;
    if (T2 > 6000) fail(fn === 'h' ? 'TH_PH' : 'TH_PS', `${fn === 'h' ? 'enthalpy' : 'entropy'} target above the 6000 K limit`);
  }
  if (Math.abs(B.v) < tol) return { ...B.r, iterations: 0 };
  let lo = A.v < 0 ? A : B, hi = A.v < 0 ? B : A;
  let it;
  for (it = 0; it < 200; it++) {
    let T = lo.T - lo.v * (hi.T - lo.T) / (hi.v - lo.v);
    if (!(T > lo.T && T < hi.T) || it % 3 === 2) T = 0.5 * (lo.T + hi.T);
    const m = at(T);
    if (Math.abs(m.v) < tol) return { ...m.r, iterations: it };
    if (m.v < 0) lo = m; else hi = m;
    if (hi.T - lo.T < 1e-9 * hi.T) break;
  }
  // a jump in H(T) that the bracket cannot resolve (pure-component-like
  // plateau, azeotrope, three-phase point): lever rule between the phase
  // assemblages on the two sides — phase amounts are combined, so the
  // material balance closes exactly
  const vl = lo.v + target, vh = hi.v + target;
  const lam = Math.min(1, Math.max(0, (target - vl) / (vh - vl)));
  return leverState(lo.r, hi.r, lam, hi.T, P, it);
}
function phasesOf(r) {
  if (r.x2 && r.beta2 > 0) {
    const out = [];
    if (r.beta > 0) out.push(['V', r.beta, r.y]);
    out.push(['L', 1 - r.beta - r.beta2, r.x], ['L', r.beta2, r.x2]);
    return out;
  }
  if (r.phase === 'V') return [['V', 1, r.y]];
  if (r.phase === 'L') return [['L', 1, r.x]];
  return [['V', r.beta, r.y], ['L', 1 - r.beta, r.x]];
}
function leverState(ra, rb, lam, T, P, it) {
  const n = ra.x.length;
  const V = new Array(n).fill(0);
  const Ls = [];
  for (const [r, w] of [[ra, 1 - lam], [rb, lam]]) {
    if (!(w > 0)) continue;
    for (const [t, b, c] of phasesOf(r)) {
      if (!(b * w > 0)) continue;
      if (t === 'V') for (let i = 0; i < n; i++) V[i] += w * b * c[i];
      else {
        // merge with a liquid of (nearly) the same composition, else keep it apart
        const amt = c.map((v) => w * b * v);
        const twin = Ls.find((L) => { const s = L.reduce((a, v) => a + v, 0); return L.every((v, i) => Math.abs(v / s - c[i]) < 1e-3); });
        if (twin) for (let i = 0; i < n; i++) twin[i] += amt[i]; else Ls.push(amt);
      }
    }
  }
  while (Ls.length > 2) {            // more than two liquids: merge the two closest
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < Ls.length; i++) for (let j = i + 1; j < Ls.length; j++) {
      const si = Ls[i].reduce((a, v) => a + v, 0), sj = Ls[j].reduce((a, v) => a + v, 0);
      const d = Ls[i].reduce((a, v, k) => a + Math.abs(v / si - Ls[j][k] / sj), 0);
      if (d < bd) { bd = d; bi = i; bj = j; }
    }
    for (let k = 0; k < n; k++) Ls[bi][k] += Ls[bj][k];
    Ls.splice(bj, 1);
  }
  const bV = V.reduce((a, v) => a + v, 0);
  const bL = Ls.map((L) => L.reduce((a, v) => a + v, 0));
  const y = bV > 0 ? V.map((v) => v / bV) : (Ls[0] ? norm(Ls[0]) : ra.x.slice());
  if (Ls.length === 0) return { T, P, beta: 1, x: y.slice(), y, phase: 'V', iterations: it, plateau: true };
  const x = norm(Ls[0]);
  if (Ls.length === 1) return { T, P, beta: bV, x, y: bV > 0 ? y : x.slice(), phase: bV > 0 ? 'VL' : 'L', iterations: it, plateau: true };
  return { T, P, beta: bV, beta2: bL[1], x, x2: norm(Ls[1]), y: bV > 0 ? y : x.slice(), phase: bV > 0 ? 'VLL' : 'LL', iterations: it, plateau: true };
}

/** Flash at (P, H): H in J/mol. */
export function flashPH(pp, z, P, H, Tguess) { return stateFlash(pp, z, P, H, 'h', Tguess); }
/** Flash at (P, S): S in J/(mol K). */
export function flashPS(pp, z, P, S, Tguess) { return stateFlash(pp, z, P, S, 's', Tguess); }
/** Three-phase flash at (P, H). */
export function flashPH3(pp, z, P, H, Tguess) { return stateFlash(pp, z, P, H, 'h', Tguess, flashPT3); }
/** Three-phase flash at (P, S). */
export function flashPS3(pp, z, P, S, Tguess) { return stateFlash(pp, z, P, S, 's', Tguess, flashPT3); }

// ---------------------------------------------------------------------------
// properties of a flash result (per phase and overall)
// ---------------------------------------------------------------------------

function mixVisL(pp, T, x) {
  if (pp.electrolyte && pp.electrolyte.viscosity) { try { const v = pp.electrolyte.viscosity(T, x); if (v > 0) return v; } catch (_e) { /* generic below */ } }
  let lnmu = 0;
  for (let i = 0; i < pp.n; i++) if (x[i] > 0) {
    const c = pp.comps[i];
    let mu = c.mul ? corr(c.mul, Math.min(T, c.mul[7] || T), c.Tc) : NaN;
    if (!(mu > 0)) mu = 1e-4;
    lnmu += x[i] * Math.log(mu);
  }
  return Math.exp(lnmu);
}
function mixVisV(pp, T, y) {
  let num1 = 0, den = 0;
  for (let i = 0; i < pp.n; i++) if (y[i] > 0) {
    const c = pp.comps[i];
    let mu = c.muv ? corr(c.muv, T, c.Tc) : NaN;
    if (!(mu > 0)) mu = 1.2e-5;
    const s = Math.sqrt(c.MW);
    num1 += y[i] * mu * s; den += y[i] * s;
  }
  return num1 / den;
}
function mixK(pp, T, x, phase) {
  let k = 0, s = 0;
  for (let i = 0; i < pp.n; i++) if (x[i] > 0) {
    const c = pp.comps[i];
    const cc = phase === 'V' ? c.kv : c.kl;
    let v = cc ? corr(cc, phase === 'L' ? Math.min(T, cc[7] || T) : T, c.Tc) : NaN;
    if (!(v > 0)) v = phase === 'V' ? 0.03 : 0.15;
    const w = x[i] * c.MW; k += w * v; s += w;
  }
  return k / s;
}

/**
 * Phase and overall properties for reporting / equipment sizing.
 * @returns {{phases: Array, MW, rho_kgm3, H_Jmol, S_JmolK, Cp_JmolK}}
 */
export function properties(pp, r) {
  const phases = [];
  const add = (type, frac, comp) => {
    const MW = comp.reduce((s, v, i) => s + v * pp.MW[i], 0);
    const V = pp.volPhase(r.T, r.P, comp, type);
    const h = pp.hPhase(r.T, r.P, comp, type);
    const dT = 0.05;
    const cp = (pp.hPhase(r.T + dT, r.P, comp, type) - pp.hPhase(r.T - dT, r.P, comp, type)) / (2 * dT);
    let Z = r.P * V / (R * r.T);
    const ph = {
      type: type === 'V' ? 'vapour' : 'liquid', fraction: frac, x: comp,
      MW, rho_kgm3: MW / 1000 / V, Z, H_Jmol: h, Cp_JmolK: cp,
      mu_Pas: type === 'V' ? mixVisV(pp, r.T, comp) : mixVisL(pp, r.T, comp),
      k_WmK: mixK(pp, r.T, comp, type),
    };
    if (type === 'L' && pp.electrolyte) {
      try {
        const rep = pp.electrolyte.report(r.T, comp);
        const note = pp.electrolyte.warn(r.T, comp);
        ph.acid_gas = Object.assign(rep, note ? { note } : {});
      } catch (_e) { /* informative only */ }
    }
    phases.push(ph);
  };
  if (r.x2 && r.beta2 > 0) {
    if (r.beta > 0) add('V', r.beta, r.y);
    add('L', 1 - r.beta - r.beta2, r.x);
    add('L', r.beta2, r.x2);
    phases[phases.length - 1].type = 'liquid 2';
  } else {
    if (r.phase === 'V' || r.phase === 'VL') add('V', r.phase === 'V' ? 1 : r.beta, r.y);
    if (r.phase === 'L' || r.phase === 'VL') add('L', r.phase === 'L' ? 1 : 1 - r.beta, r.x);
  }
  const H = hOf(pp, r), S = sOf(pp, r);
  const MW = phases.reduce((s, p) => s + p.fraction * p.MW, 0);
  const vol = phases.reduce((s, p) => s + p.fraction * p.MW / 1000 / p.rho_kgm3, 0);
  return { phases, MW, rho_kgm3: MW / 1000 / vol, H_Jmol: H, S_JmolK: S };
}

// ---------------------------------------------------------------------------
// convenience: package from engine streams
// ---------------------------------------------------------------------------

export { ThermoError, R, T0, P0 };

export default {
  THERMO_VERSION, PACKAGES, ThermoError, R, T0, P0,
  corr, component, hIG, sIG, psat, hvap, vLiq, satT,
  createPackage, rachfordRice, rachfordRice3, flashPT, flashPT3, flashPH, flashPH3, flashPS, flashPS3, flashPVF, flashTVF,
  hOf, sOf, properties,
};
