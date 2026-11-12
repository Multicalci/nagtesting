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
//              'steam'                    pure water / steam on IAPWS-IF97
//                                         (api/_lib/steam-if97.js), Step 26
//   flashes  : PT (with Michelsen stability test; Newton on ln K when
//              substitution stalls, STEP 32), PH, PS, PVF (bubble/dew/
//              any vapour fraction at P), TVF (saturation pressure); every
//              flash result carries `converged`
//   free water (STEP 32, PR / SRK, on by default): liquid water and steam on
//              IAPWS-IF97, gases dissolved in water on IAPWS G7-04 Henry
//              constants — see createPackage
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
import groupTables from './mb-groups.js';      // STEP 37 — complete UNIFAC / Dortmund tables
import bipExtra from './mb-bip-extra.js';
import bipSRK from './mb-bip-srk.js';      // round 11: SRK k_ij of their own (ChemSep srk.ipd, DECHEMA)
import mbData from './mb-data.js';
import { makeElectrolyte, ELECTROLYTE_MODELS, ELECTROLYTE_KEYS, ELECTROLYTE_SALTS } from './mb-electrolyte.js';
import { makeUreaLiquid, UREA_MODEL_LABEL, UREA_KEYS, UREA_OWNED, UREA_INERTS } from './mb-ureathermo.js';
import steam from './steam-if97.js';
import gerg from './mb-gerg.js';                // ROUND 12b — GERG-2008 (NIST AGA8 reference code, public domain)
import helm from './mb-helmholtz.js';           // ROUND 12b — reference equations of state of pure fluids
import prsv2 from './mb-prsv2.js';              // ROUND 12c — PRSV2 κ1, κ2, κ3 fitted to the databank vapour pressures
import lkpKij from './mb-lkp-kij.js';                       // ROUND 12c: LKP binary parameters
import unifac2 from './mb-unifac2.js';                     // ROUND 12d: UNIFAC-LL and NIST-modified UNIFAC

export const THERMO_VERSION = 'mb-thermo 1.10.0';
// STEP 32: calibrated / sourced binary parameters that fill gaps in the ChemSep tables
export const BIP_EXTRA_USED = bipExtra.applyExtra(bip);

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
 * 104, 105, 106, 107 (Aly–Lee ideal-gas Cp), 116, 117 (PPDS 12 heat of
 * vaporisation, J/kmol), 200 (Wagner 2.5-5, E = Pc) and 201 (Wagner 1.5-3-6,
 * E = Pc). Tc is needed for 106/116/117/200/201; a ninth element c[8], where
 * present (round-12 databank), is the Tc the correlation was fitted with and
 * is used in its place so the curve reproduces its source exactly.
 * @param {Array<number>} c
 * @param {number} T
 * @param {number} [Tc]
 * @returns {number}
 */
export function corr(c, T, Tc) {
  const [eq, A, B, C, D, E] = c;
  if (c[8] > 0) Tc = c[8];
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
    case 107: {
      const x = C / T, y = E / T;
      return A + B * Math.pow(x / Math.sinh(x), 2) + D * Math.pow(y / Math.cosh(y), 2);
    }
    case 116: {
      const tau = Math.max(1 - T / Tc, 0);
      return A + B * Math.pow(tau, 0.35) + C * Math.pow(tau, 2 / 3) + D * tau + E * Math.pow(tau, 4 / 3);
    }
    case 117: {
      const tau = Math.max(1 - T / Tc, 0);
      return 1000 * R * Tc * (A * Math.cbrt(tau) + B * Math.pow(tau, 2 / 3) + C * tau + D * tau * tau + E * Math.pow(tau, 6));
    }
    case 200: {
      const tau = 1 - T / Tc;
      return E * Math.exp((Tc / T) * (A * tau + B * Math.pow(Math.abs(tau), 1.5) * Math.sign(tau) +
        C * Math.pow(Math.abs(tau), 2.5) * Math.sign(tau) + D * Math.pow(tau, 5)));
    }
    case 201: {
      const tau = 1 - T / Tc;
      return E * Math.exp((Tc / T) * (A * tau + B * Math.pow(Math.abs(tau), 1.5) * Math.sign(tau) + C * Math.pow(tau, 3) + D * Math.pow(tau, 6)));
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
  if (nd && nd.data_quality === 'nist' && Array.isArray(nd.shomate) && nd.shomate.length && num(nd.hf_gas_298)) c._nist = nistShomate(nd, c._cp);
  // STEP 41: property curves replaced where a reference correlation is markedly better
  if (KL_REF[key]) c.kl = KL_REF[key];
  c._prep = true;
}
/**
 * STEP 41: liquid thermal conductivity, DIPPR eq. 100 fitted to the reference correlation in CoolProp
 * (ammonia: Monogenidou, Assael & Huber, J. Phys. Chem. Ref. Data 47 (2018) 043101) along the saturated
 * liquid, 200–385 K, within 0.35 %. ChemSep's curve is 4 % low at 0 °C and 7 % low at −23 °C.
 */
const KL_REF = {
  NH3: [100, 1.90267907, -7.67009413e-3, 1.31911417e-5, -1.14054348e-8, 0, 196, 385],
};

/**
 * NIST Shomate ideal-gas H, S on the formation basis. Below the lowest fitted
 * range (H2O: the NIST set starts at 500 K) the ChemSep Cp shape carries the
 * curve down to 298.15 K, offset by a constant so H(298.15) = ΔHf and H(Tmin)
 * meets the Shomate value (STEP 32 — a constant-Cp extrapolation from 500 K
 * put water vapour 0.19 kJ/mol low at 25 °C and its Cp 1.6 J/(mol K) high).
 * @param {object} nd mb-data record
 * @param {{at:Function}} [cp] ChemSep integrals (∫Cp dT, ∫Cp/T dT from 298.15 K)
 */
function nistShomate(nd, cp) {
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
      if (T < lo && cp && lo > T0 + 1) {
        const a = HS(pick(lo), lo), cl = cp.at(lo), ct = cp.at(T);
        const k = (a.H - cl[0]) / (lo - T0);                    // constant Cp offset that closes H at both ends
        v = { H: ct[0] + k * (T - T0), S: a.S - (cl[1] - ct[1]) - k * Math.log(lo / T) };
      } else if (T < lo) { const a = HS(pick(lo), lo); v = { H: a.H + a.Cp * (T - lo), S: a.S + a.Cp * Math.log(T / lo) }; }
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
function liquidVolume(comps, T, P, x, eos, method) {
  const n = comps.length;
  // STEP 40: the method can be chosen — 'rackett' (Spencer–Danner mixture), 'costald' (always), 'eos' (the cubic's liquid root)
  if (method === 'eos' && eos) return eos.state(T, P, x, 'L').V;
  if (method === 'rackett') {
    let wm = 0, pcm = 0, xt = 0; for (let i = 0; i < n; i++) if (x[i] > 0) { xt += x[i]; wm += x[i] * comps[i].omega; pcm += x[i] * comps[i].Pc; }
    return rackettMix(comps, T, x) * mixTait(comps, T, P, x, rackettTcm(comps, x), wm / xt, pcm / xt);
  }
  // STEP 41: gases dissolved above (or near) their critical temperature — H2, N2, CH4, Ar in liquid ammonia, CO2 in
  // water — take a partial molar volume of ½ V_c while they are dilute (< 10 mol %), and the solvent keeps its own
  // density correlation; each subcritical liquid is compressed from its vapour pressure by the Tait form of COSTALD
  let xl = 0, xt = 0;
  for (let i = 0; i < n; i++) if (x[i] > 0) { xt += x[i]; if (x[i] > 1e-4 && T > 0.95 * comps[i].Tc) xl += x[i]; }
  if (method !== 'costald' && (xl === 0 || xl < 0.1 * xt)) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (!(x[i] > 0)) continue;
      const c = comps[i];
      if (T > 0.95 * c.Tc) { v += x[i] * (T < c.Tc ? vLiq(c, 0.95 * c.Tc) : 0.5 * (c.vc || 0.1) / 1000); continue; }
      let vi = vLiq(c, T);
      if (P > 1e5) vi *= taitFactor(T, P, psatSafe(c, T), c.Tc, c.Pc, c.omega);
      v += x[i] * vi;
    }
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
  const Pcm = (0.291 - 0.080 * wm) * R * Tcm / Vm;
  return Vm * V0 * (1 - wm * Vd) * mixTait(comps, T, P, x, Tcm, wm, Pcm);
}

/**
 * STEP 41: compressed-liquid volume factor V(P)/V(Ps), Thomson, Brobst & Hankinson, AIChE J. 28 (1982) 671
 * (Tait form; Poling, Prausnitz & O'Connell 5th ed. eqs 4-12.2 to 4-12.4). Against the reference equations of
 * state in CoolProp it brings liquid densities at 100–300 bar within about 1.5 % (ammonia at 140 bar, 0 °C: −0.3 %).
 */
function taitFactor(T, P, Ps, Tc, Pc, w) {
  if (!(P > Ps) || !(T < Tc) || !(Pc > 0)) return 1;
  const tau = 1 - T / Tc;
  const e = Math.exp(4.79594 + 0.250047 * w + 1.14188 * w * w);
  const beta = Pc * (-1 - 9.070217 * Math.cbrt(tau) + 62.45326 * Math.pow(tau, 2 / 3) - 135.1102 * tau + e * Math.pow(tau, 4 / 3));
  if (!(beta + Ps > 0)) return 1;
  const f = 1 - (0.0861488 + 0.0344483 * w) * Math.log((beta + P) / (beta + Ps));
  return f > 0.5 && f <= 1 ? f : 1;
}
/** vapour pressure for the Tait correction; above Tc (a pseudo value) from the Wilson form */
function psatSafe(c, T) {
  if (T < c.Tc) { try { const p = psat(c, T); if (p > 0 && isFinite(p)) return p; } catch (_e) { /* Wilson below */ } }
  return c.Pc * Math.exp(5.373 * (1 + c.omega) * (1 - c.Tc / T));
}
/** Tait factor of a mixture on pseudo-critical constants, with a Raoult bubble pressure */
function mixTait(comps, T, P, x, Tcm, wm, Pcm) {
  if (!(P > 1e5) || !(T < Tcm)) return 1;
  let ps = 0, xt = 0;
  for (let i = 0; i < comps.length; i++) if (x[i] > 0) { xt += x[i]; ps += x[i] * psatSafe(comps[i], T); }
  return taitFactor(T, P, ps / xt, Tcm, Pcm, wm);
}
function rackettTcm(comps, x) {
  const n = comps.length, vc = comps.map((c) => (c.vc || 0.1) / 1000);
  let sv = 0; for (let i = 0; i < n; i++) if (x[i] > 0) sv += x[i] * vc[i];
  let Tcm = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (!(x[i] > 0 && x[j] > 0)) continue;
    const kij1 = i === j ? 1 : 8 * Math.sqrt(vc[i] * vc[j]) / (Math.cbrt(vc[i]) + Math.cbrt(vc[j])) ** 3;
    Tcm += (x[i] * vc[i] / sv) * (x[j] * vc[j] / sv) * kij1 * Math.sqrt(comps[i].Tc * comps[j].Tc);
  }
  return Tcm;
}

/**
 * STEP 40: saturated-liquid mixture volume by the modified Rackett equation (Spencer & Danner 1972)
 * with Chueh–Prausnitz / Li mixing (Poling, Prausnitz & O'Connell, 5th ed., eqs 5-24 to 5-27):
 * V = R (Σ x_i T_ci / P_ci) Z_RAm^[1 + (1 − T/T_cm)^(2/7)], Z_RAm = Σ x_i Z_RA,i,
 * T_cm = ΣΣ φ_i φ_j T_cij, φ_i = x_i V_ci / Σ x_j V_cj, T_cij = (1 − k_ij)(T_ci T_cj)^½,
 * 1 − k_ij = 8 (V_ci V_cj)^½ / (V_ci^⅓ + V_cj^⅓)³. T/T_cm held at 0.99 and above. Z_RA from ChemSep where
 * tabulated, otherwise the value that reproduces the component's own density correlation at 25 °C.
 */
function rackettZ(c) {
  if (num(c.zra)) return c.zra;
  if (num(c._zra)) return c._zra;
  let z = 0.29056 - 0.08775 * c.omega;               // Yamada–Gunn
  if (c.rhol) {                                      // not tabulated: Z_RA that reproduces the ChemSep density at 25 °C (or the nearest valid T)
    const Tref = Math.min(Math.max(298.15, num(c.rhol[6]) ? c.rhol[6] : 0), num(c.rhol[7]) ? c.rhol[7] : 1e9, 0.9 * c.Tc);
    const v = vLiq(c, Tref), Tr = Tref / c.Tc;
    const zz = Math.pow(v * c.Pc / (R * c.Tc), 1 / (1 + Math.pow(1 - Tr, 2 / 7)));
    if (zz > 0.15 && zz < 0.35) z = zz;
  }
  c._zra = z;
  return z;
}
function rackettMix(comps, T, x) {
  const n = comps.length;
  let sx = 0, sTP = 0, zm = 0, sv = 0;
  const vc = comps.map((c) => (c.vc || 0.1) / 1000);       // m3/mol
  for (let i = 0; i < n; i++) {
    if (!(x[i] > 0)) continue;
    const c = comps[i];
    sx += x[i]; sTP += x[i] * c.Tc / c.Pc; sv += x[i] * vc[i];
    zm += x[i] * rackettZ(c);
  }
  if (!(sx > 0)) return 0;
  let Tcm = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (!(x[i] > 0 && x[j] > 0)) continue;
    const kij1 = i === j ? 1 : 8 * Math.sqrt(vc[i] * vc[j]) / (Math.cbrt(vc[i]) + Math.cbrt(vc[j])) ** 3;
    Tcm += (x[i] * vc[i] / sv) * (x[j] * vc[j] / sv) * kij1 * Math.sqrt(comps[i].Tc * comps[j].Tc);
  }
  const Tr = Math.min(T / Tcm, 0.99);
  return R * (sTP / sx) * Math.pow(zm / sx, 1 + Math.pow(1 - Tr, 2 / 7)) * sx;
}

// ---------------------------------------------------------------------------
// cubic equations of state — PR (1976) and SRK, van der Waals mixing
// ---------------------------------------------------------------------------
const EOS = {
  pr: { OA: 0.45723553, OB: 0.07779607, u: 2, w: -1, m: (w) => 0.37464 + 1.54226 * w - 0.26992 * w * w },
  srk: { OA: 0.42748023, OB: 0.08664035, u: 1, w: 0, m: (w) => 0.480 + 1.574 * w - 0.176 * w * w },
  // ROUND 12c — PR78 (Robinson & Peng 1978): heavier compounds (ω > 0.491) take the cubic m(ω)
  pr78: { OA: 0.45723553, OB: 0.07779607, u: 2, w: -1, m: (w) => (w <= 0.491 ? 0.37464 + 1.54226 * w - 0.26992 * w * w : 0.379642 + 1.48503 * w - 0.164423 * w * w + 0.016666 * w * w * w) },
  // PRSV2 (Stryjek & Vera 1986): κ = κ0(ω) + [κ1 + κ2(κ3 − Tr)(1 − √Tr)](1 + √Tr)(0.7 − Tr) below Tr = 0.7
  prsv2: { OA: 0.45723553, OB: 0.07779607, u: 2, w: -1, m: (w) => 0.378893 + 1.4897153 * w - 0.17131848 * w * w + 0.0196554 * w * w * w, alpha: prsv2Alpha },
  // Redlich–Kwong (vapour phase of Chao–Seader and Grayson–Streed): α = Tr^−½
  rk: { OA: 0.42748023, OB: 0.08664035, u: 1, w: 0, m: () => 0, alpha: (c, T) => { const tr = T / c.Tc; return [1 / Math.sqrt(tr), -0.5 * Math.pow(tr, -1.5) / c.Tc]; } },
};
function prsv2Alpha(c, T, k0) {
  const k = prsv2.PRSV2[c.key] || [0, 0, 0];
  const al = (t) => {
    const tr = t / c.Tc, sr = Math.sqrt(tr);
    const kap = k0 + (tr < 0.7 ? (k[0] + k[1] * (k[2] - tr) * (1 - sr)) * (1 + sr) * (0.7 - tr) : 0);
    const a = 1 + kap * (1 - sr);
    return a * a;
  };
  const h = 1e-5 * T;
  return [al(T), (al(T + h) - al(T - h)) / (2 * h)];
}

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

/**
 * STEP 41: volume translation of the cubic equations for the permanent gases (V = V_EOS − Σ x_i c_i, Péneloux et al.,
 * Fluid Phase Equilib. 8 (1982) 7). c_i fitted here to the reference equations of state in CoolProp over 250–800 K
 * (above 1.3 T_c) and 10–300 bar. Peng–Robinson under-predicts the molar volume of these gases by 3–7 cm³/mol, so
 * hydrogen-rich gas came out about 4 % dense; with the shift the mean error is 0.2–0.9 %. Fugacities of all phases move
 * by the same c_i P/RT, so phase equilibrium is unchanged; enthalpy moves by −P Σ x_i c_i, which corrects compressor
 * work (pure H₂ or N₂ from 30 to 150 bar: −1.1 % → 0.0 % against CoolProp); entropy is unchanged. Reaction equilibria
 * do move, by Σ ν_i c_i P/RT: ammonia at 450 °C goes from 35.41 to 36.29 mol % at 300 atm (measured 35.8) and from
 * 64.1 to 66.6 mol % at 1000 atm (measured 69.7). volume_translation:false gives the plain cubic equation.
 */
const VT_C = {      // cm³/mol
  pr: { H2: -4.998, He: -5.387, N2: -4.545, O2: -3.860, Ar: -4.055, CH4: -5.455, CO: -4.420 },
  srk: { H2: -0.398, He: 0.806, N2: 1.900, O2: 2.306, Ar: 2.239, CH4: 3.179, CO: 2.266 },
};
VT_C.pr78 = VT_C.pr;
VT_C.prsv2 = VT_C.pr;         // same cubic as PR (the shift does not depend on α)          // PR78 differs from PR only for ω > 0.491: the light gases keep the PR shifts

// ---------------------------------------------------------------------------
// ROUND 12c — Lee–Kesler–Plöcker: Lee & Kesler (AIChE J. 21 (1975) 510)
// simple-fluid and reference-fluid (n-octane, ω_r = 0.3978) BWR equations in
// reduced variables, Plöcker, Knapp & Prausnitz (Ind. Eng. Chem. Process Des.
// Dev. 17 (1978) 324) mixing rules (η = 0.25, k_ij from mb-lkp-kij.js). ln φ_i
// from the composition derivative of n·G_res/RT at constant T, P,
// ∂(n g)/∂n_i = g + ∂g/∂x_i − Σ x_k ∂g/∂x_k, with ∂g/∂x_k analytic through
// T_r, P_r and ω (∂ln f/∂T_r = −h/T_r², ∂ln f/∂P_r = (Z − 1)/P_r).
// ---------------------------------------------------------------------------
const LK_SIMPLE = { b1: 0.1181193, b2: 0.265728, b3: 0.154790, b4: 0.030323, c1: 0.0236744, c2: 0.0186984, c3: 0, c4: 0.042724, d1: 0.155488e-4, d2: 0.623689e-4, beta: 0.65392, gamma: 0.060167 };
const LK_REF = { b1: 0.2026579, b2: 0.331511, b3: 0.027655, b4: 0.203488, c1: 0.0313385, c2: 0.0503618, c3: 0.016901, c4: 0.041577, d1: 0.48736e-4, d2: 0.0740336e-4, beta: 1.226, gamma: 0.03754 };
const LK_OMR = 0.3978;
/** one LK fluid at Tr, Pr on a branch: {Z, lnf = ln(f/P), h = (H − H_ig)/(R Tc)} or null */
function lkFluid(F, Tr, Pr, phase) {
  const B = F.b1 - F.b2 / Tr - F.b3 / (Tr * Tr) - F.b4 / (Tr * Tr * Tr), C = F.c1 - F.c2 / Tr + F.c3 / (Tr * Tr * Tr), D = F.d1 + F.d2 / Tr;
  const e4 = F.c4 / (Tr * Tr * Tr);
  const P = (r) => { const ex = Math.exp(-F.gamma * r * r); return Tr * (r + B * r * r + C * r * r * r + D * r ** 6 + e4 * (F.beta * r ** 3 + F.gamma * r ** 5) * ex); };
  const dP = (r) => { const ex = Math.exp(-F.gamma * r * r); return Tr * (1 + 2 * B * r + 3 * C * r * r + 6 * D * r ** 5 + e4 * ((3 * F.beta * r * r + 5 * F.gamma * r ** 4) - 2 * F.gamma * r * (F.beta * r ** 3 + F.gamma * r ** 5)) * ex); };
  let r;
  if (phase === 'L') {
    r = 12;
    for (let k = 0; k < 80 && !(P(r) > Pr); k++) r *= 1.1;
    let ok = false;
    for (let it = 0; it < 200; it++) { const d = dP(r); if (!(d > 0)) break; const st = (P(r) - Pr) / d; r -= st; if (Math.abs(st) < 1e-12 * r) { ok = true; break; } }
    if (!ok || !(r > 0)) return null;
  } else {
    r = Pr / Tr;
    for (let k = 0; k < 60 && !(P(r) < Pr); k++) r *= 0.9;
    let ok = false;
    for (let it = 0; it < 200; it++) { const d = dP(r); if (!(d > 0)) break; const st = (Pr - P(r)) / d; r += st; if (!(r > 0)) break; if (Math.abs(st) < 1e-12 * r) { ok = true; break; } }
    if (!ok) return null;
  }
  const Vr = 1 / r, Z = Pr * Vr / Tr;
  const gv = F.gamma / (Vr * Vr), ex = Math.exp(-gv);
  const E = F.c4 / (2 * Tr * Tr * Tr * F.gamma) * (F.beta + 1 - (F.beta + 1 + gv) * ex);
  const lnf = Z - 1 - Math.log(Z) + B / Vr + C / (2 * Vr * Vr) + D / (5 * Vr ** 5) + E;
  const h = Tr * (Z - 1 - (F.b2 + 2 * F.b3 / Tr + 3 * F.b4 / (Tr * Tr)) / (Tr * Vr) - (F.c2 - 3 * F.c3 / (Tr * Tr)) / (2 * Tr * Vr * Vr) + F.d2 / (5 * Tr * Vr ** 5) + 3 * E);
  return { Z, lnf, h, r };
}
/** LKP k_ij matrix: user value → fitted table → correlation (hydrocarbon pairs and light gases with
 *  hydrocarbons) → 1. Returns the matrix; notes estimated pairs in `warnings` when asked. */
function lkpKmat(keys, comps, s, warnings, src) {
  const n = keys.length, K = [], est = [];
  const user = (s && s.lkp_kij) || {};
  for (let i = 0; i < n; i++) {
    K.push(new Array(n).fill(1));
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const [a, b] = [keys[i], keys[j]].sort(), pair = a + '|' + b;
      const note = (t) => { if (src && i < j) src[pair] = t; };
      if (num(user[pair]) && user[pair] > 0) { K[i][j] = user[pair]; note('user'); continue; }
      if (num(user[b + '|' + a]) && user[b + '|' + a] > 0) { K[i][j] = user[b + '|' + a]; note('user'); continue; }
      if (num(lkpKij.LKP_KIJ[pair])) { K[i][j] = lkpKij.LKP_KIJ[pair]; note('fitted to GERG-2008 bubble pressures (multicalci)'); continue; }
      const e = lkpKijEstimate(keys[i], comps[i], keys[j], comps[j]);
      if (num(e)) { K[i][j] = e; if (i < j) est.push(pair); note('correlation fitted to the GERG-2008 pairs (multicalci)'); continue; }
      note('none (1)');
    }
  }
  if (est.length && warnings) warnings.push(`Lee–Kesler–Plöcker: k_ij estimated by correlation for ${est.length} pair${est.length > 1 ? 's' : ''} (${est.slice(0, 6).join(', ')}${est.length > 6 ? ', …' : ''}) — no fitted value`);
  return K;
}
/** ROUND 12c: the Lee–Kesler–Plöcker k_ij of each pair with its source (property-info) */
export function lkpKijTable(keys, spec) {
  const comps = keys.map((k) => component(k)), src = {};
  const K = lkpKmat(keys, comps, spec || {}, null, src);
  const out = {};
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const pair = [keys[i], keys[j]].sort().join('|'); out[pair] = { kij: K[i][j], source: src[pair] }; }
  return out;
}
/** estimate for a pair with no fitted value, or NaN (then k_ij = 1) */
function lkpKijEstimate(ka, ca, kb, cb) {
  const C = lkpKij.LKP_CORR;
  if (!C) return NaN;
  const hc = (k, c) => !!(c && (c.pseudo || /^C\d+H\d+$/.test(c.formula || '') || (C.hc || []).includes(k)));
  let [k1, c1, k2, c2] = ca.Tc <= cb.Tc ? [ka, ca, kb, cb] : [kb, cb, ka, ca];        // 1 = lighter
  if (!hc(k2, c2)) return NaN;
  const vc = (c) => (0.2905 - 0.085 * c.omega) * R * c.Tc / c.Pc;
  const lt = Math.log(c2.Tc / c1.Tc);
  if (C.gas && C.gas[k1]) {                                                       // light gas + heavier hydrocarbon
    const g = C.gas[k1], X = Math.min(Math.max(lt, g.xmin), g.xmax + 0.5);
    return g.a + g.b * X + g.c * X * X;
  }
  if (hc(k1, c1) && C.hc2) {                                                       // hydrocarbon pair
    const lv = Math.log(vc(c2) / vc(c1)), h = C.hc2;
    return 1 + h.a * lt * lv + h.b * lt + h.c * lt * lt;
  }
  return NaN;
}
function makeLKP(keys, comps, kmat) {
  const n = keys.length;
  const iH2 = keys.indexOf('H2');
  const omega = comps.map((c, i) => (i === iH2 ? 0 : c.omega));
  const Vc0 = comps.map((c, i) => (0.2905 - 0.085 * omega[i]) * R * c.Tc / c.Pc);
  const eta = 0.25;
  let tcache = NaN, Vcij = null, Tcij = null;
  // hydrogen: Gunn, Chueh & Prausnitz (AIChE J. 12 (1966) 937) quantum-corrected constants at the
  // temperature of the calculation (M in g/mol), ω = 0, as Plöcker et al. used them
  function pairs(T) {
    if (T === tcache && Vcij) return;
    const Tc = comps.map((c) => c.Tc), Vc = Vc0.slice();
    if (iH2 >= 0) {
      const MT = 2.01588 * T;
      Tc[iH2] = 43.6 / (1 + 21.8 / MT);
      Vc[iH2] = 51.5e-6 / (1 - 9.91 / MT);
    }
    Vcij = []; Tcij = [];
    for (let i = 0; i < n; i++) { Vcij.push([]); Tcij.push([]); for (let j = 0; j < n; j++) { Vcij[i][j] = Math.pow((Math.cbrt(Vc[i]) + Math.cbrt(Vc[j])) / 2, 3); Tcij[i][j] = Math.sqrt(Tc[i] * Tc[j]) * (i === j ? 1 : kmat[i][j]); } }
    tcache = T;
  }
  /** pseudo-critical constants and, with `deriv`, their derivatives with respect to each x_k (x not normalised) */
  function pseudo(x, deriv) {
    let Vm = 0, Tn = 0, wm = 0;
    const dV = deriv ? new Array(n).fill(0) : null, dT = deriv ? new Array(n).fill(0) : null;
    for (let i = 0; i < n; i++) {
      if (x[i] > 0) wm += x[i] * omega[i];
      for (let j = 0; j < n; j++) {
        if (!(x[j] > 0)) continue;
        const vt = Math.pow(Vcij[i][j], eta) * Tcij[i][j];
        if (x[i] > 0) { Vm += x[i] * x[j] * Vcij[i][j]; Tn += x[i] * x[j] * vt; }
        if (deriv) { dV[i] += 2 * x[j] * Vcij[i][j]; dT[i] += 2 * x[j] * vt; }
      }
    }
    const Vme = Math.pow(Vm, eta), Tcm = Tn / Vme, zc = 0.2905 - 0.085 * wm, Pcm = zc * R * Tcm / Vm;
    if (!deriv) return { Tcm, Pcm, wm };
    const dTcm = dT.map((v, k) => v / Vme - eta * Tcm * dV[k] / Vm);
    const dPcm = dTcm.map((v, k) => -0.085 * omega[k] * R * Tcm / Vm + zc * R * (v / Vm - Tcm * dV[k] / (Vm * Vm)));
    return { Tcm, Pcm, wm, dTcm, dPcm };
  }
  function mix(T, P, x, phase, deriv) {
    pairs(T);
    const pc = pseudo(x, deriv), Tr = T / pc.Tcm, Pr = P / pc.Pcm;
    let a = lkFluid(LK_SIMPLE, Tr, Pr, phase), b = lkFluid(LK_REF, Tr, Pr, phase);
    const other = phase === 'L' ? 'V' : 'L';
    if (!a) a = lkFluid(LK_SIMPLE, Tr, Pr, other);
    if (!b) b = lkFluid(LK_REF, Tr, Pr, other);
    if (!a || !b) fail('TH_LKP', `Lee–Kesler–Plöcker: no ${phase === 'L' ? 'liquid' : 'vapour'} root at Tr = ${Tr.toFixed(3)}, Pr = ${Pr.toFixed(3)}`);
    const f = pc.wm / LK_OMR;
    const g = a.lnf + f * (b.lnf - a.lnf), Z = a.Z + f * (b.Z - a.Z), hr = a.h + f * (b.h - a.h);
    const out = { g, Z, h: R * pc.Tcm * hr };
    if (deriv) {
      // ∂g/∂x_k through T_r, P_r and ω: ∂ln f/∂T_r = −h_r/T_r², ∂ln f/∂P_r = (Z − 1)/P_r for each fluid
      const gT = -hr / (Tr * Tr), gP = (Z - 1) / Pr, gW = (b.lnf - a.lnf) / LK_OMR;
      out.dg = pc.dTcm.map((dt, k) => gT * (-Tr / pc.Tcm) * dt + gP * (-Pr / pc.Pcm) * pc.dPcm[k] + gW * omega[k]);
    }
    return out;
  }
  let cache = new Map();
  function one(T, P, x, phase) {
    const m0 = mix(T, P, x, phase, true), dg = m0.dg;               // analytic composition derivative of g
    let sxd = 0;
    for (let i = 0; i < n; i++) if (x[i] > 0) sxd += x[i] * dg[i];
    const lnphi = x.map((xi, i) => (xi > 0 ? m0.g + dg[i] - sxd : NaN));
    let hd = m0.h;
    if (iH2 >= 0 && x[iH2] > 0) { const dT = 1e-3 * T; hd = -R * T * T * (mix(T + dT, P, x, phase).g - mix(T - dT, P, x, phase).g) / (2 * dT); pairs(T); }
    return { Z: m0.Z, g: m0.g, lnphi, hDep: hd, sDep: hd / T - R * m0.g, V: m0.Z * R * T / P };
  }
  function state(T, P, x, phase) {
    const key = T + '|' + P + '|' + phase + '|' + x.join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    let st, nRoots = 1;
    if (phase === 'L' || phase === 'V') st = one(T, P, x, phase);
    else { const a = one(T, P, x, 'V'), b = one(T, P, x, 'L'); nRoots = Math.abs(a.Z / b.Z - 1) > 1e-6 ? 2 : 1; st = nRoots === 2 && b.g < a.g ? b : a; }
    const out = { Z: st.Z, lnphi: st.lnphi, hDep: st.hDep, sDep: st.sDep, V: st.V, nRoots, A: NaN, B: NaN };
    if (cache.size > 2000) cache = new Map();
    cache.set(key, out);
    return out;
  }
  return { kind: 'lkp', state, b: keys.map(() => 0), ai: () => keys.map(() => 0) };
}

// ---------------------------------------------------------------------------
// ROUND 12c — Chao–Seader (AIChE J. 7 (1961) 598) and Grayson–Streed (6th
// World Petroleum Congress, 1963): K_i = ν_i γ_i / φ_i^V with the pure-liquid
// fugacity coefficient ν from the corresponding-states correlation (simple
// fluid + ω term; hydrogen and methane with their own constants), γ from the
// Scatchard–Hildebrand regular solution (solubility parameters and liquid
// volumes at 25 °C) and φ^V from Redlich–Kwong. The ω term is held at its
// Tr = 1 value above the critical temperature. Liquid enthalpy and entropy come
// from Lee–Kesler (Plöcker mixing), vapour ones from Redlich–Kwong.
// ---------------------------------------------------------------------------
const CSGS_COEF = {
  'chao-seader': { simple: [5.75748, -3.01761, -4.985, 2.02299, 0, 0.08427, 0.26667, -0.31138, -0.02655, 0.02883], CH4: [2.4384, -2.2455, -0.34084, 0.00212, -0.00223, 0.10486, -0.03691, 0, 0, 0], H2: [1.96718, 1.02972, -0.054009, 0.0005288, 0, 0.008585, 0, 0, 0, 0] },
  'grayson-streed': { simple: [2.05135, -2.10899, 0, -0.19396, 0.02282, 0.08852, 0, -0.00872, -0.00353, 0.00203], CH4: [1.36822, -1.54831, 0, 0.02889, -0.01076, 0.10486, -0.02529, 0, 0, 0], H2: [1.50709, 2.74283, -0.0211, 0.00011, 0, 0.008585, 0, 0, 0, 0] },
};
const CSGS_V25 = { H2: 31.0e-6, CH4: 52.0e-6 };    // Chao–Seader hypothetical-liquid volumes, m³/mol
function makeCSGS(model, keys, comps) {
  const K = CSGS_COEF[model], n = keys.length;
  const v = comps.map((c, i) => CSGS_V25[keys[i]] || (c.Tc > 310 ? vLiq(c, 298.15) : vLiq(c, 0.7 * c.Tc)));
  const delta = comps.map((c, i) => {
    if (num(c.solp) && c.solp > 0) return c.solp;                        // (J/m³)^½, ChemSep
    const Tref = Math.min(298.15, 0.7 * c.Tc);
    return Math.sqrt(Math.max(hvap(c, Tref) - R * Tref, 0) / v[i]);
  });
  const log10nu = (i, T, P) => {
    const c = comps[i], Tr = T / c.Tc, Pr = P / c.Pc;
    const A = K[keys[i]] || K.simple;
    let y = A[0] + A[1] / Tr + A[2] * Tr + A[3] * Tr * Tr + A[4] * Tr * Tr * Tr + (A[5] + A[6] * Tr + A[7] * Tr * Tr) * Pr + (A[8] + A[9] * Tr) * Pr * Pr - Math.log10(Pr);
    if (!K[keys[i]]) { const t = Math.min(Tr, 1); y += c.omega * (-4.23893 + 8.65808 * t - 1.2206 / t - 3.15224 * t * t * t - 0.025 * (Pr - 0.6)); }
    return y;
  };
  const lnNu = (i, T, P) => Math.LN10 * log10nu(i, T, P);
  const dbar = (x) => { let sv = 0, sd = 0; for (let i = 0; i < n; i++) if (x[i] > 0) { sv += x[i] * v[i]; sd += x[i] * v[i] * delta[i]; } return sd / sv; };
  const act = {
    lnGamma(T, x) { const db = dbar(x); return v.map((vi, i) => vi * (delta[i] - db) ** 2 / (R * T)); },
    missing: [],
  };
  return {
    act, lnNu, v, delta,
  };
}

function makeEOS(kind, comps, kij, translate) {
  const E = EOS[kind];
  const n = comps.length;
  const vt = comps.map((c) => (translate !== false && VT_C[kind] && num(VT_C[kind][c.key]) ? VT_C[kind][c.key] * 1e-6 : 0));
  const anyVT = vt.some((v) => v !== 0);
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
      if (E.alpha) { const [al, dal] = E.alpha(comps[i], T, m[i]); ai[i] = ac[i] * al; dai[i] = ac[i] * dal; continue; }
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
    let hDep = R * T * (Z - 1) + (T * dam - am) / (bm * delta) * L;
    const sDep = R * Math.log(Z - B) + dam / (bm * delta) * L;
    let V = Z * R * T / P;
    if (anyVT) {
      let cm = 0; for (let i = 0; i < n; i++) { cm += x[i] * vt[i]; lnphi[i] -= vt[i] * P / (R * T); }
      V -= cm; hDep -= P * cm;
    }
    return { Z, lnphi, hDep, sDep, A, B, nRoots: roots.length, V, am, bm };
  }
  return { kind, state, b, ai: (T) => { atT(T); return ai; } };
}

// ---------------------------------------------------------------------------
// ROUND 12b — GERG-2008 as an equation-of-state package (mb-gerg.js). The same
// state() interface as the cubic equations: density root of the requested
// phase, ln φ_i, residual enthalpy and entropy (relative to the ideal gas at T,
// P) and molar volume. 'min' takes the root of lower Gibbs energy.
// ---------------------------------------------------------------------------
const GERG_INDEX = Object.fromEntries(gerg.GERG_KEYS.map((k, i) => [k, i + 1]));
function makeGERG(keys) {
  const idx = keys.map((k) => GERG_INDEX[k] || 0);
  const bad = keys.filter((_k, i) => !idx[i]);
  if (bad.length) fail('TH_GERG', `GERG-2008 covers methane, nitrogen, CO2, ethane, propane, the butanes, pentanes, n-hexane to n-decane, hydrogen, oxygen, CO, water, H2S, helium and argon — not ${bad.join(', ')}; use Peng–Robinson or SRK for this mixture`, 'property_package');
  const n = keys.length;
  let cache = new Map();
  const toG = (x) => {
    const xg = new Array(gerg.NC + 1).fill(0);
    let sum = 0;
    for (let i = 0; i < n; i++) { const v = x[i] > 0 ? x[i] : 0; xg[idx[i]] += v; sum += v; }
    for (let j = 1; j <= gerg.NC; j++) xg[j] /= sum;
    return xg;
  };
  const gres = (st, xg) => { let g = 0; for (let j = 1; j <= gerg.NC; j++) if (xg[j] > 0) g += xg[j] * st.lnphi[j]; return g; };
  function solve(T, P, xg, phase) {
    let st = gerg.phaseState(T, P, xg, phase);
    if (st.ierr && phase === 'L') { const v = gerg.phaseState(T, P, xg, 'V'); if (!v.ierr) st = v; }
    return st;
  }
  function state(T, P, x, phase) {
    const key = T + '|' + P + '|' + phase + '|' + x.join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    const xg = toG(x);
    let st, nRoots = 1;
    if (phase === 'L' || phase === 'V') st = solve(T, P, xg, phase);
    else {
      const a = solve(T, P, xg, 'V'), b = solve(T, P, xg, 'L');
      nRoots = Math.abs(a.D / b.D - 1) > 1e-6 ? 2 : 1;
      st = nRoots === 2 && gres(b, xg) < gres(a, xg) ? b : a;
    }
    const out = { Z: st.Z, lnphi: idx.map((g) => st.lnphi[g]), hDep: st.hres, sDep: st.sres, V: st.V, nRoots, A: NaN, B: NaN, D: st.D, ierr: st.ierr };
    if (cache.size > 2000) cache = new Map();
    cache.set(key, out);
    return out;
  }
  // pure-component critical points of the equation (its reducing values)
  const crit = (i) => { const gi = idx[i], xu = new Array(gerg.NC + 1).fill(0); xu[gi] = 1; return { Tc: gerg.TC[gi], Pc: 1000 * gerg.pressure(gerg.TC[gi], gerg.DC[gi], xu).P }; };
  return { kind: 'gerg2008', state, idx, crit, b: keys.map(() => 0), ai: () => keys.map(() => 0) };
}

/**
 * ROUND 12b — reference equation of state of one pure fluid (mb-helmholtz.js) with the EOS-package interface.
 * The liquid branch starts from the databank liquid density; 'min' takes the root of lower Gibbs energy.
 */
function makeRefEOS(keys) {
  const f = keys.length === 1 ? helm.fluid(keys[0]) : null;
  if (!f) fail('TH_REFEOS', `the reference equations are for one pure fluid at a time — ammonia, CO2, nitrogen, hydrogen, methane, argon or oxygen${keys.length > 1 ? ' (got a mixture: use GERG-2008 for natural gas and syngas components, else Peng–Robinson)' : ' (not ' + keys[0] + ')'}`, 'property_package');
  const c = component(keys[0]);
  let cache = new Map();
  const solve = (T, P, ph) => {
    const guess = ph === 'L' && T < f.Tc ? 1 / (vLiq(c, T) * 1.0) : 0;
    let rho = helm.densityTP(f, T, P, ph, guess);
    if (rho === null) rho = helm.densityTP(f, T, P, ph === 'L' ? 'V' : 'L', 0);
    if (rho === null) fail('TH_REFEOS', `${f.name}: no density found at ${T.toFixed(2)} K, ${(P / 1e5).toFixed(3)} bar`, 'T_K');
    return helm.stateTrho(f, T, rho);
  };
  function state(T, P, x, phase) {
    if (T > f.Tmax * 1.0001 || P > f.pmax) fail('TH_REFEOS_RANGE', `${f.name}: the reference equation is valid to ${f.Tmax} K and ${(f.pmax / 1e5).toFixed(0)} bar`, 'T_K');
    const key = T + '|' + P + '|' + phase;
    const hit = cache.get(key);
    if (hit) return hit;
    let st, nRoots = 1;
    if (phase === 'L' || phase === 'V') st = solve(T, P, phase);
    else { const a = solve(T, P, 'V'), b = solve(T, P, 'L'); nRoots = Math.abs(a.rho / b.rho - 1) > 1e-7 ? 2 : 1; st = nRoots === 2 && b.lnphi < a.lnphi ? b : a; }
    const out = { Z: st.Z, lnphi: [st.lnphi], hDep: st.hres, sDep: st.sres, V: 1 / st.rho, nRoots, A: NaN, B: NaN, rho: st.rho, cp: st.cp, w: st.w };
    if (cache.size > 2000) cache = new Map();
    cache.set(key, out);
    return out;
  }
  return { kind: 'reference', state, f, idx: [0], crit: () => ({ Tc: f.Tc, Pc: f.pc }), b: [0], ai: () => [0] };
}

/**
 * Saturation line of a pure component on an equation-of-state package (ROUND 12b — GERG-2008 and the reference
 * equations): p_sat(T) from ln φ_L = ln φ_V by Newton in ln P (slope Z_L − Z_V), T_sat(P) by Newton in T (slope
 * Δh_vap / RT²), each started from the databank correlation. The critical point is where the liquid and vapour
 * roots merge, located by bisection on T; above it, or where no two roots exist, the hooks report a supercritical
 * state as the flashes expect.
 */
function eosPureSat(eos, n, i, c, crit) {
  const unit = new Array(n).fill(0); unit[i] = 1;
  const two = (T, P) => { const L = eos.state(T, P, unit, 'L'), V = eos.state(T, P, unit, 'V'); return { L, V, split: Math.abs(L.Z / V.Z - 1) > 1e-5 }; };
  function psatEOS(T) {
    let lnP = Math.log(psat(c, Math.min(T, 0.999 * c.Tc)));
    for (let it = 0; it < 60; it++) {
      const P = Math.exp(lnP), q = two(T, P);
      if (!q.split) {
        // both roots on one side: step towards the two-phase pressure range
        lnP += q.L.Z < 0.3 ? -0.05 : 0.05;
        continue;
      }
      const f = q.L.lnphi[i] - q.V.lnphi[i], d = q.L.Z - q.V.Z;
      const step = f / d;
      lnP -= Math.max(-0.5, Math.min(0.5, step));
      if (Math.abs(step) < 1e-11) return Math.exp(lnP);
    }
    return NaN;
  }
  let Tc = crit && crit.Tc, Pc = crit && crit.Pc;
  if (!Tc) {
    // merge point of the roots, starting from the databank critical temperature
    let lo = 0.7 * c.Tc, hi = 1.05 * c.Tc;
    for (let it = 0; it < 40; it++) { const m = 0.5 * (lo + hi); if (Number.isFinite(psatEOS(m))) lo = m; else hi = m; }
    Tc = lo; Pc = psatEOS(lo);
  }
  function tsatEOS(P) {
    if (P >= Pc) return Infinity;
    let T = Math.min(satT(c, P), 0.999 * Tc);
    for (let it = 0; it < 60; it++) {
      const q = two(T, P);
      if (!q.split) { T *= q.L.Z < 0.3 ? 1.01 : 0.99; continue; }
      const f = q.L.lnphi[i] - q.V.lnphi[i];
      const d = (q.V.hDep - q.L.hDep) / (R * T * T);
      const step = f / d;
      T -= Math.max(-0.1 * T, Math.min(0.1 * T, step));
      if (Math.abs(step) < 1e-9 * T) return T;
    }
    return NaN;
  }
  return { Tc, Pc, psat: (T) => (T >= Tc ? Pc : psatEOS(T)), tsat: tsatEOS };
}

const UF_ALL = {
  USUB: Object.assign({}, groupTables.UNIFAC_SUB_ALL, bip.UNIFAC_SUB), UA: Object.assign({}, groupTables.UNIFAC_A_ALL, bip.UNIFAC_A),
  DSUB: Object.assign({}, groupTables.DORTMUND_SUB_ALL, bip.DORTMUND_SUB), DA: Object.assign({}, groupTables.DORTMUND_A_ALL, bip.DORTMUND_A),
};
// ---------------------------------------------------------------------------
// activity coefficient models
// ---------------------------------------------------------------------------

function pairLookup(table, ki, kj) { return table[ki + '|' + kj]; }

// ---------------------------------------------------------------------------
// STEP 37 — binary pairs missing from the databank, estimated from UNIFAC: the
// γ model's parameters (NRTL a, b with α = 0.3; UNIQUAC / Wilson a, b) are
// fitted by Levenberg–Marquardt to ln γ of both components from modified
// UNIFAC (Dortmund) — original UNIFAC when either lacks Dortmund groups — at
// 7 compositions and 3 temperatures spanning the pair's boiling points (the
// usual "estimate missing parameters" route of commercial simulators). Pairs
// with a gas (Tb < 0 °C) stay to Henry's law; pairs whose UNIFAC groups lack
// interaction parameters stay unfilled.
// ---------------------------------------------------------------------------
const PAIR_FIT = new Map();
function solveN(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    if (Math.abs(M[i][i]) < 1e-300) return null;
    for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
export function fitPairFromUNIFAC(model, ci, cj) {
  const dort = !!(ci.modunifac && cj.modunifac), orig = !!(ci.unifac && cj.unifac);
  if (!dort && !orig) return null;
  const key = model + '|' + ci.key + '|' + cj.key + '|' + (dort ? 'D' : 'U');
  if (PAIR_FIT.has(key)) return PAIR_FIT.get(key);
  let res = null;
  try {
    const uf = makeUNIFAC([ci.key, cj.key], [ci, cj], dort, []);
    if (uf.missing && uf.missing.length) { PAIR_FIT.set(key, null); return null; }
    const tb = (c) => (num(c.tb) ? c.tb : 0.6 * c.Tc);
    const Tlo = Math.max(Math.min(tb(ci), tb(cj)) - 40, 260);
    let Thi = Math.min(Math.max(tb(ci), tb(cj)) + 10, 0.95 * Math.min(ci.Tc, cj.Tc), 600);
    if (Thi < Tlo + 20) Thi = Tlo + 20;
    const Ts = [Tlo, (Tlo + Thi) / 2, Thi], Tm = Ts[1];
    const xs = [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98];
    const data = [];
    for (const T of Ts) for (const x of xs) { const g = uf.lnGamma(T, [x, 1 - x]); data.push([T, x, g[0], g[1]]); }
    const k12 = ci.key + '|' + cj.key, k21 = cj.key + '|' + ci.key;
    // parameters u = [c12, d12, c21, d21]: a + b/T = c + d·(1000/T − 1000/Tm)
    const toAB = (u) => ({ a12: u[0] - u[1] * 1000 / Tm, b12: u[1] * 1000, a21: u[2] - u[3] * 1000 / Tm, b21: u[3] * 1000 });
    const build = (u) => {
      const f = toAB(u);
      const user = { [k12]: { a: f.a12, b: f.b12, alpha: 0.3 }, [k21]: { a: f.a21, b: f.b21, alpha: 0.3 } };
      return model === 'nrtl' ? makeNRTL([ci.key, cj.key], user, [], null, 'none') : model === 'uniquac' ? makeUNIQUAC([ci.key, cj.key], [ci, cj], user, [], 'none') : makeWilson([ci.key, cj.key], [ci, cj], user, [], 'none');
    };
    const resid = (u) => { const m = build(u); const r = []; for (const [T, x, g1, g2] of data) { const g = m.lnGamma(T, [x, 1 - x]); r.push(g[0] - g1, g[1] - g2); } return r; };
    let u = [0, 0, 0, 0], r = resid(u), S = r.reduce((s, v) => s + v * v, 0), lam = 1e-3;
    for (let it = 0; it < 80; it++) {
      const J = [];
      for (let k = 0; k < 4; k++) { const h = 1e-6 + 1e-6 * Math.abs(u[k]); const up = u.slice(); up[k] += h; const rp = resid(up); J.push(rp.map((v, i) => (v - r[i]) / h)); }
      const A = [0, 1, 2, 3].map((p) => [0, 1, 2, 3].map((q) => J[p].reduce((s, v, i) => s + v * J[q][i], 0)));
      const g = [0, 1, 2, 3].map((p) => J[p].reduce((s, v, i) => s + v * r[i], 0));
      let improved = false;
      for (let t = 0; t < 10; t++) {
        const Ad = A.map((row, p) => row.map((v, q) => v + (p === q ? lam * (v + 1e-9) : 0)));
        const d = solveN(Ad, g.map((v) => -v));
        if (!d) { lam *= 10; continue; }
        const un = u.map((v, k) => v + Math.max(-2, Math.min(2, d[k])));
        const rn = resid(un), Sn = rn.reduce((s, v) => s + v * v, 0);
        if (Number.isFinite(Sn) && Sn < S) { u = un; r = rn; const dS = S - Sn; S = Sn; lam = Math.max(lam / 10, 1e-9); improved = true; if (dS < 1e-14 * (1 + S)) it = 999; break; }
        lam *= 10;
      }
      if (!improved) break;
    }
    const rms = Math.sqrt(S / r.length);
    res = Object.assign(toAB(u), { rms, source: dort ? 'Dortmund UNIFAC' : 'UNIFAC', T: [Ts[0], Ts[2]] });
  } catch (_e) { res = null; }
  PAIR_FIT.set(key, res);
  return res;
}
/** fill the missing pairs of an activity model; returns [{pair, source, rms}] and prunes `missing` */
function fillPairs(model, keys, comps, missing, fill, set, warnings) {
  if (fill === 'none' || !comps || !missing.length) return [];
  const est = [];
  const gas = (c) => (num(c.tb) ? c.tb < 273.15 : c.Tc < 310);
  for (let m = missing.length - 1; m >= 0; m--) {
    const [ki, kj] = missing[m].split('–');
    const i = keys.indexOf(ki), j = keys.indexOf(kj);
    if (i < 0 || j < 0 || gas(comps[i]) || gas(comps[j])) continue;
    const f = fitPairFromUNIFAC(model, comps[i], comps[j]);
    if (!f || !(f.rms < 0.5)) continue;
    set(i, j, f);
    est.push({ pair: missing[m], source: f.source, rms: f.rms });
    missing.splice(m, 1);
  }
  if (est.length) {
    const lab = model === 'nrtl' ? 'NRTL' : model === 'uniquac' ? 'UNIQUAC' : 'Wilson';
    const bySrc = {};
    for (const e of est) (bySrc[e.source] = bySrc[e.source] || []).push(e);
    for (const [src, list] of Object.entries(bySrc)) {
      warnings.push(`${lab}: binary parameters for ${list.map((e) => e.pair).reverse().join(', ')} estimated from ${src} (fit to ln γ, rms ${Math.max(...list.map((e) => e.rms)).toFixed(3)} at worst) — replace with data-fitted values for design`);
    }
  }
  return est.reverse();
}

function makeNRTL(keys, user, warnings, comps, fill) {
  const n = keys.length;
  const b = [], a = [], al = [], e = [], f = [];
  const missing = [];
  for (let i = 0; i < n; i++) {
    b.push(new Array(n).fill(0)); a.push(new Array(n).fill(0)); al.push(new Array(n).fill(0.3)); e.push(new Array(n).fill(0)); f.push(new Array(n).fill(0));
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const u = user && user[keys[i] + '|' + keys[j]];
    if (u) { a[i][j] = u.a || 0; b[i][j] = u.b || 0; e[i][j] = u.e || 0; f[i][j] = u.f || 0; if (num(u.alpha)) { al[i][j] = u.alpha; al[j][i] = u.alpha; } continue; }
    const p = pairLookup(bip.NRTL, keys[i], keys[j]);     // [b, α] (ChemSep) or [b, α, a, e, f] (mb-bip-extra.js)
    if (p) { b[i][j] = p[0]; al[i][j] = p[1]; al[j][i] = p[1]; a[i][j] = p[2] || 0; e[i][j] = p[3] || 0; f[i][j] = p[4] || 0; continue; }
    if (i < j && !pairLookup(bip.NRTL, keys[j], keys[i]) && !(user && user[keys[j] + '|' + keys[i]])) missing.push(keys[i] + '–' + keys[j]);
  }
  const est = fillPairs('nrtl', keys, comps, missing, fill, (i, j, f) => { a[i][j] = f.a12; b[i][j] = f.b12; a[j][i] = f.a21; b[j][i] = f.b21; al[i][j] = al[j][i] = 0.3; }, warnings);
  if (missing.length) warnings.push(`NRTL: no binary parameters for ${missing.join(', ')} — treated as ideal (τ = 0)`);
  return {
    missing, estimated: est,
    lnGamma(T, x) {
      const tau = [], G = [], lnT = Math.log(T);
      for (let i = 0; i < n; i++) {
        tau.push(new Array(n)); G.push(new Array(n));
        for (let j = 0; j < n; j++) { tau[i][j] = a[i][j] + b[i][j] / T + e[i][j] * lnT + f[i][j] * T; G[i][j] = Math.exp(-al[i][j] * tau[i][j]); }
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

function makeUNIQUAC(keys, comps, user, warnings, fill) {
  const n = keys.length;
  const r = comps.map((c) => c.uqr), q = comps.map((c) => c.uqq);
  if (r.some((v) => !num(v)) || q.some((v) => !num(v))) {
    fail('TH_UNIQUAC_RQ', 'UNIQUAC needs r and q for every component: ' + keys.filter((k, i) => !num(r[i]) || !num(q[i])).join(', '));
  }
  const bb = [], aa = [], ee = [], ff = [];
  const missing = [];
  for (let i = 0; i < n; i++) { bb.push(new Array(n).fill(0)); aa.push(new Array(n).fill(0)); ee.push(new Array(n).fill(0)); ff.push(new Array(n).fill(0)); }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const u = user && user[keys[i] + '|' + keys[j]];
    if (u) { aa[i][j] = u.a || 0; bb[i][j] = u.b || 0; ee[i][j] = u.e || 0; ff[i][j] = u.f || 0; continue; }
    const p = pairLookup(bip.UNIQUAC, keys[i], keys[j]);  // [b] (ChemSep) or [b, a, e, f] (mb-bip-extra.js)
    if (p) { bb[i][j] = p[0]; aa[i][j] = p[1] || 0; ee[i][j] = p[2] || 0; ff[i][j] = p[3] || 0; continue; }
    if (i < j && !pairLookup(bip.UNIQUAC, keys[j], keys[i]) && !(user && user[keys[j] + '|' + keys[i]])) missing.push(keys[i] + '–' + keys[j]);
  }
  const est = fillPairs('uniquac', keys, comps, missing, fill, (i, j, f) => { aa[i][j] = f.a12; bb[i][j] = f.b12; aa[j][i] = f.a21; bb[j][i] = f.b21; }, warnings);
  if (missing.length) warnings.push(`UNIQUAC: no binary parameters for ${missing.join(', ')} — treated as τ = 1`);
  const z = 10;
  const l = r.map((ri, i) => z / 2 * (ri - q[i]) - (ri - 1));
  return {
    missing, estimated: est,
    lnGamma(T, x) {
      let sr = 0, sq = 0;
      for (let i = 0; i < n; i++) { sr += x[i] * r[i]; sq += x[i] * q[i]; }
      const phi = r.map((ri, i) => ri / sr), th = q.map((qi, i) => x[i] * qi / sq);
      let sxl = 0; for (let i = 0; i < n; i++) sxl += x[i] * l[i];
      const tau = [];
      const lnT = Math.log(T);
      for (let i = 0; i < n; i++) { tau.push(new Array(n)); for (let j = 0; j < n; j++) tau[i][j] = Math.exp(aa[i][j] + bb[i][j] / T + ee[i][j] * lnT + ff[i][j] * T); }
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

function makeWilson(keys, comps, user, warnings, fill) {
  const n = keys.length;
  const aa = [], bb = [], ee = [], ff = [];
  const missing = [];
  for (let i = 0; i < n; i++) { aa.push(new Array(n).fill(0)); bb.push(new Array(n).fill(0)); ee.push(new Array(n).fill(0)); ff.push(new Array(n).fill(0)); }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const u = user && user[keys[i] + '|' + keys[j]];
    if (u) { aa[i][j] = u.a || 0; bb[i][j] = u.b || 0; ee[i][j] = u.e || 0; ff[i][j] = u.f || 0; continue; }
    const p = pairLookup(bip.WILSON, keys[i], keys[j]);
    if (p) { aa[i][j] = p[0]; bb[i][j] = p[1]; continue; }
    if (i < j && !pairLookup(bip.WILSON, keys[j], keys[i]) && !(user && user[keys[j] + '|' + keys[i]])) missing.push(keys[i] + '–' + keys[j]);
  }
  const est = fillPairs('wilson', keys, comps, missing, fill, (i, j, f) => { aa[i][j] = f.a12; bb[i][j] = f.b12; aa[j][i] = f.a21; bb[j][i] = f.b21; }, warnings);
  if (missing.length) warnings.push(`Wilson: no binary parameters for ${missing.join(', ')} — treated as Λ = 1`);
  return {
    missing, estimated: est,
    lnGamma(T, x) {
      const L = [];
      const lnT = Math.log(T);
      for (let i = 0; i < n; i++) { L.push(new Array(n)); for (let j = 0; j < n; j++) L[i][j] = i === j ? 1 : Math.exp(aa[i][j] + bb[i][j] / T + ee[i][j] * lnT + ff[i][j] * T); }
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
 * UNIFAC — original (VLE, Hansen 1991), modified Dortmund (Gmehling 2016), UNIFAC-LL (Magnussen et al. 1981,
 * fitted to liquid–liquid equilibria; original form) or NIST-modified UNIFAC (Kang et al. 2015; Dortmund form).
 * Components without a group assignment (light gases, NH3, …) keep their UNIQUAC r, q in the combinatorial
 * term and contribute no groups (ideal residual) — a warning names them.
 */
const UF_VARIANT = {
  unifac: { label: 'UNIFAC', tdep: false, r34: false },
  modunifac: { label: 'Dortmund UNIFAC', tdep: true, r34: true },
  'unifac-ll': { label: 'UNIFAC-LL', tdep: false, r34: false },
  'nist-modunifac': { label: 'NIST modified UNIFAC', tdep: true, r34: true },
};
/** ROUND 12d: a component's subgroups for a UNIFAC variant (databank assignment, else mapped from UNIFAC / Dortmund) */
function mapGroups(assign, table) {
  if (!assign) return null;
  const out = {};
  for (const [s, n] of Object.entries(assign)) {
    const t = table[s];
    if (t === undefined || t === null) return null;
    if (typeof t === 'object') for (const [q, m] of Object.entries(t)) out[q] = (out[q] || 0) + m * n;
    else out[t] = (out[t] || 0) + n;
  }
  return out;
}
export function unifacGroups(variant, c) {
  if (!c) return null;
  if (variant === 'unifac' || variant === 'modunifac') return c[variant] || null;
  if (variant === 'unifac-ll') return c.unifac_ll || (!c.user && unifac2.LLE_ASSIGN[c.key]) || mapGroups(c.unifac, unifac2.U2LLE);
  return c.nist_unifac || (!c.user && unifac2.NIST_ASSIGN[c.key]) || mapGroups(c.modunifac, unifac2.D2NIST);
}
function makeUNIFAC(keys, comps, variant, warnings) {
  const n = keys.length;
  if (variant === true) variant = 'modunifac'; else if (variant === false) variant = 'unifac';
  const V = UF_VARIANT[variant], dortmund = V.tdep;
  // STEP 37: the complete subgroup / interaction tables (user components may carry any subgroup)
  const SUB = variant === 'modunifac' ? UF_ALL.DSUB : variant === 'unifac' ? UF_ALL.USUB : variant === 'unifac-ll' ? unifac2.LLE_SUB : unifac2.NIST_SUB;
  const AMN = variant === 'modunifac' ? UF_ALL.DA : variant === 'unifac' ? UF_ALL.UA : variant === 'unifac-ll' ? unifac2.LLE_A : unifac2.NIST_A;
  const GR = comps.map((c) => {
    const g = unifacGroups(variant, c);
    return g && Object.keys(g).every((s) => SUB[s]) ? g : null;
  });
  const grouped = GR.map((g) => !!g);
  const ung = keys.filter((k, i) => !grouped[i]);
  if (ung.length === n) fail('TH_UNIFAC_GROUPS', `${V.label} group assignment not available for any of: ${keys.join(', ')}`);
  if (ung.length) warnings.push(`${V.label}: no group assignment for ${ung.join(', ')} — combinatorial term only (residual treated as ideal)`);
  const field = '_g';
  comps = comps.map((c, i) => ({ uqr: c.uqr, uqq: c.uqq, _g: GR[i] }));
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
  if (missingPairs.size) warnings.push(`${V.label}: no interaction parameters for main groups ${[...missingPairs].join(', ')} — treated as 0`);
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
        const Vv = r[i] / sr, F = q[i] / sq;
        const Vp = V.r34 ? r34[i] / sr34 : Vv;
        const comb = 1 - Vp + Math.log(Vp) - 5 * q[i] * (1 - Vv / F + Math.log(Vv / F));
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
  'unifac-ll': 'UNIFAC-LL — liquid–liquid parameters (predictive γ–φ)',          // ROUND 12d
  'nist-modunifac': 'Modified UNIFAC — NIST (predictive γ–φ)',
  steam: 'Steam / water (IAPWS-IF97)',
  gerg2008: 'GERG-2008 (natural gas, 21 components)',
  reference: 'Reference equation of state (pure fluid)',
  pr78: 'Peng–Robinson 1978 (PR78)',
  prsv2: 'PRSV2 (Stryjek–Vera)',
  lkp: 'Lee–Kesler–Plöcker',
  'chao-seader': 'Chao–Seader',
  'grayson-streed': 'Grayson–Streed',
  ...ELECTROLYTE_MODELS,
  urea: UREA_MODEL_LABEL,
};

/**
 * Build a property package for a fixed component list.
 * @param {{model:string, kij?:object, nrtl?:object, uniquac?:object, wilson?:object,
 *          vapour?:('ideal'|'pr'|'srk'), excess_enthalpy?:boolean,
 *          three_phase?:(boolean|'auto')}} spec   three_phase: units flash with a
 *        second liquid (VLLE) — see threePhase below
 *        kij: { 'A|B': value } overrides (EOS packages, and the vapour EOS of
 *        activity packages); nrtl: { 'i|j': {a, b, e?, f?, alpha} } (Aspen form τ_ij = a + b/T + e ln T + f T);
 *        uniquac/wilson: { 'i|j': {a, b, e?, f?} } (ln τ_ij or ln Λ_ij in the same form).
 * @param {string[]} keys component keys (compdb)
 * @returns {object} package
 */
// ---------------------------------------------------------------------------
// STEP 32 — IAPWS G7-04 (2004) Henry's constants of gases in liquid water,
// kH = lim f2/x2 at the saturation pressure of water (Fernández-Prini, Alvarez
// & Harvey, J. Phys. Chem. Ref. Data 32 (2003) 903):
//   ln(kH / p1*) = A/Tr + B·τ^0.355/Tr + C·Tr^−0.41·e^τ,  Tr = T/647.096, τ = 1 − Tr
// with p1* from the guideline's Eq. 4. [A, B, C, Tmin, Tmax] per databank key.
// ---------------------------------------------------------------------------
const G704 = {
  He: [-3.52839, 7.12983, 4.47770, 273.21, 553.18], neon: [-3.18301, 5.31448, 5.43774, 273.20, 543.36],
  Ar: [-8.40954, 4.29587, 10.52779, 273.19, 568.36], krypton: [-8.97358, 3.61508, 11.29963, 273.19, 525.56],
  xenon: [-14.21635, 4.00041, 15.60999, 273.22, 574.85], H2: [-4.73284, 6.08954, 6.06066, 273.15, 636.09],
  N2: [-9.67578, 4.72162, 11.70585, 278.12, 636.46], O2: [-9.44833, 4.43822, 11.42005, 274.15, 616.52],
  CO: [-10.52862, 5.13259, 12.01421, 278.15, 588.67], CO2: [-8.55445, 4.01195, 9.52345, 274.19, 642.66],
  H2S: [-4.51499, 5.23538, 4.42126, 273.15, 533.09], CH4: [-10.44708, 4.66491, 12.12986, 275.46, 633.11],
  C2H6: [-19.67563, 4.51222, 20.62567, 275.44, 473.46], 'sulfur-hexafluoride': [-16.56118, 2.15289, 20.35440, 283.14, 505.55],
};
const G704_PS = [[-7.85951783, 1], [1.84408259, 1.5], [-11.7866497, 3], [22.6807411, 3.5], [-15.9618719, 4], [1.80122502, 7.5]];
/** ln kH [Pa] of gas `key` in water at T by IAPWS G7-04 (T clamped to 273.15 K – 0.995 Tc) */
function lnKhG704(key, T) {
  const c = G704[key];
  const Tc = 647.096, Pc = 22.064e6;
  const Tr = Math.min(Math.max(T, 273.15), 0.995 * Tc) / Tc, tau = 1 - Tr;
  let sp = 0; for (const [a, b] of G704_PS) sp += a * Math.pow(tau, b);
  return Math.log(Pc) + sp / Tr + c[0] / Tr + c[1] * Math.pow(tau, 0.355) / Tr + c[2] * Math.pow(Tr, -0.41) * Math.exp(tau);
}
export { lnKhG704 };

/**
 * Urea synthesis liquid viscosity — an ESTIMATE: ln μ = Σ x_t,i ln μ_i over the true species
 * (Grunberg–Nissan without interaction terms). NH3, CO2, H2O from the databank liquid
 * correlations (clamped to their upper T limit); urea, carbamate and bicarbonate as a
 * molten-urea Andrade law μ = 2.6 mPa·s at 135 °C, B = 2400 K. Typical result 0.2–0.4 mPa·s.
 */
function ureaViscosity(ul, T, x) {
  const s = ul.speciation(T, x);
  const S = s.n.reduce((a, b) => a + b, 0);
  if (!(S > 0)) return NaN;
  const muDb = (k) => { const c = component(k); const mu = c.mul ? corr(c.mul, Math.min(T, c.mul[7] || T), c.Tc) : NaN; return mu > 0 ? mu : 1e-4; };
  const muSalt = 2.6e-3 * Math.exp(2400 * (1 / T - 1 / 408.15));
  const mu = [muDb('NH3'), muDb('CO2'), muDb('H2O'), muSalt, muSalt, muSalt];
  let ln = 0;
  for (let i = 0; i < 6; i++) ln += s.n[i] / S * Math.log(mu[i]);
  return Math.exp(ln);
}

/** ideal-gas reference packages for single keys (urea method: Gibbs energies of NH3, CO2, H2O absent from a unit) */
const IDEAL_REF = new Map();
function idealRef(k) { let q = IDEAL_REF.get(k); if (!q) { q = createPackage({ model: 'ideal' }, [k]); IDEAL_REF.set(k, q); } return q; }

export function createPackage(spec, keys) {
  const s = spec || {};
  const model = String(s.model || 'pr').toLowerCase();
  if (!PACKAGES[model]) fail('TH_PACKAGE', `unknown property package '${s.model}' (use ${Object.keys(PACKAGES).join(' | ')})`, 'property_package');
  if (!Array.isArray(keys) || !keys.length) fail('TH_KEYS', 'component list required');
  if (model === 'steam') return makeSteamPackage(keys);
  const comps = keys.map(component);
  const n = keys.length;
  const warnings = [];
  const elecModel = ELECTROLYTE_MODELS[model] ? model : null;
  const saltIn = keys.filter((k) => ELECTROLYTE_KEYS.includes(k));
  // STEP 38: each electrolyte method lists the salts it holds
  const saltOk = (ELECTROLYTE_SALTS && ELECTROLYTE_SALTS[model]) || [];
  const saltBad = saltIn.filter((k) => !saltOk.includes(k));
  if (saltBad.length) {
    const homes = Object.entries(ELECTROLYTE_SALTS || {}).filter(([, l]) => saltBad.every((k) => l.includes(k))).map(([m]) => `'${m}'`);
    fail('TH_ELECTROLYTE', `${saltBad.join(', ')} is an electrolyte — use ${homes.length ? 'the ' + homes.join(' or ') + ' property method' : 'an electrolyte property method'}`, 'property_package');
  }
  // STEP 34: urea exists only in the urea-synthesis method (its liquid model owns it)
  const ureaIn = keys.filter((k) => UREA_KEYS.includes(k));
  const isUrea = model === 'urea';
  if (ureaIn.length && !isUrea) fail('TH_UREA', "urea is modelled only by the 'urea' (urea synthesis) property method", 'property_package');
  if (isUrea) {
    const bad = keys.filter((k) => !UREA_OWNED.includes(k) && !UREA_INERTS.includes(k));
    if (bad.length) fail('TH_UREA', `urea method: ${bad.join(', ')} not supported — the method holds NH3, CO2, H2O, urea and inert gases (${UREA_INERTS.join(', ')})`, 'components');
  }
  const isGERG = model === 'gerg2008', isRef = model === 'reference';     // ROUND 12b
  const isHelm = isGERG || isRef;                                     // multiparameter Helmholtz equations
  const isLKP = model === 'lkp', isCSGS = model === 'chao-seader' || model === 'grayson-streed';   // ROUND 12c
  const isCubic = model === 'pr' || model === 'srk' || model === 'pr78' || model === 'prsv2';
  const isEOS = isCubic || isHelm || isLKP;
  const vapourModel = isEOS ? model : isUrea ? 'pr' : isCSGS ? 'rk' : (s.vapour === 'pr' || s.vapour === 'srk' ? s.vapour : 'ideal');
  // kij matrix: ChemSep PR table for Peng–Robinson; for SRK the DECHEMA SRK table (mb-bip-srk.js), the PR value
  // where SRK has none; user overrides win
  const kij = [];
  const kijUsed = {};
  for (let i = 0; i < n; i++) {
    kij.push(new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const [a, b] = [keys[i], keys[j]].sort();
      const pair = a + '|' + b;
      let v = (vapourModel === 'srk' && num(bipSRK.SRK[pair]) && !BIP_EXTRA_USED.PR[pair] ? bipSRK.SRK[pair] : bip.PR[pair]) || 0;
      if (isUrea && pair === 'CO2|NH3' && !(s.kij && (num(s.kij[pair]) || num(s.kij['NH3|CO2'])))) v = 0.10;   // fitted to Voskov et al. 2016, Table 9
      if (s.kij && num(s.kij[pair])) v = s.kij[pair];
      else if (s.kij && num(s.kij[b + '|' + a])) v = s.kij[b + '|' + a];
      kij[i][j] = v;
      if (v && i < j) kijUsed[pair] = v;
    }
  }
  if (isHelm || isLKP || isCSGS) for (const k of Object.keys(kijUsed)) delete kijUsed[k];     // no cubic k_ij in these methods
  // STEP 32: gas–ammonia pairs with no k_ij — the NH3 content of loop gas and the gases
  // dissolved in liquid ammonia depend on them; say so instead of staying silent
  if (isCubic && keys.includes('NH3') || (!isEOS && !isCSGS && vapourModel !== 'ideal' && keys.includes('NH3'))) {
    const zero = ['H2', 'CH4', 'CO', 'He'].filter((g) => {
      if (!keys.includes(g)) return false;
      const [a, b] = [g, 'NH3'].sort();
      return !(kij[keys.indexOf(a)][keys.indexOf(b)]) && !(s.kij && (num(s.kij[a + '|' + b]) || num(s.kij[b + '|' + a])));
    });
    if (zero.length) warnings.push(`${PACKAGES[model]}: no binary interaction parameter for ${zero.map((g) => g + '–NH3').join(', ')} (k_ij = 0) — ` +
      'the NH3 left in separator vapour and the gases dissolved in liquid ammonia are uncertain; calibrate k_ij against separator analyses (Methods → binary data)');
  }
  // `eos` is replaced below by a free-water-corrected view when that applies (STEP 32)
  let eos = isGERG ? makeGERG(keys) : isRef ? makeRefEOS(keys) : isLKP ? makeLKP(keys, comps, lkpKmat(keys, comps, s, warnings)) : isCSGS ? makeEOS('rk', comps, keys.map(() => keys.map(() => 0)), false) : vapourModel !== 'ideal' ? makeEOS(vapourModel, comps, kij, s.volume_translation) : null;     // STEP 41: volume_translation:false turns the gas shift off
  let act = null;
  const fill = s.fill_missing === 'none' ? 'none' : 'auto';          // STEP 37: missing pairs from UNIFAC
  if (model === 'nrtl') act = makeNRTL(keys, s.nrtl, warnings, comps, fill);
  else if (model === 'uniquac') act = makeUNIQUAC(keys, comps, s.uniquac, warnings, fill);
  else if (model === 'wilson') act = makeWilson(keys, comps, s.wilson, warnings, fill);
  else if (model === 'unifac' || model === 'modunifac' || model === 'unifac-ll' || model === 'nist-modunifac') act = makeUNIFAC(keys, comps, model, warnings);
  if (isLKP || isCSGS) {                                                      // ROUND 12c: corresponding states / regular solution
    const polar = keys.filter((k, i) => num(comps[i].dip) && comps[i].dip > 4.3e-30);     // dipole moment above 1.3 D
    if (polar.length) warnings.push(`${PACKAGES[model]}: ${polar.join(', ')} — strongly polar, outside the basis of this method (meant for hydrocarbons and light gases); ` +
      'their phase equilibrium is rough — Peng–Robinson with free water, or an activity method, describes them better');
  }
  const csgs = isCSGS ? makeCSGS(model, keys, comps) : null;                  // ROUND 12c
  // Chao–Seader / Grayson–Streed: liquid enthalpy and entropy from Lee–Kesler (as commercial simulators do) — the ν
  // correlations were fitted to K-values and their temperature derivative gives poor heat capacities
  const csgsLK = isCSGS ? makeLKP(keys, comps, lkpKmat(keys, comps, s, null)) : null;
  if (csgs) act = csgs.act;
  const excessH = !!s.excess_enthalpy && !!act;
  // STEP 40: liquid molar volume method (densities, volumetric flows, pump heads) — 'auto' keeps the default
  const liqVol = ['rackett', 'costald', 'eos'].includes(s.liquid_volume) ? s.liquid_volume : isHelm ? 'eos' : 'auto';     // GERG-2008 and the reference equations: their own liquid density
  if (liqVol === 'eos' && !eos) warnings.push(`${PACKAGES[model]}: liquid volume from the equation of state needs PR or SRK (as the method or its vapour model) — the default liquid volume is used`);
  const activity = !isEOS;
  const poynting = activity && model !== 'ideal' && !elecModel && !isUrea && !isCSGS && s.poynting !== false;   // Raoult's law: no Poynting (CS / GS: in ν)
  // STEP 25 acid-gas electrolyte packages: H2O, CO2 and the solvent (MEA / K2CO3)
  // from the speciation model; any other gas by Henry's law in water
  const lnPhiSatWMemo = new Map();
  const elec = elecModel ? makeElectrolyte(elecModel, keys, {
    psatW: (T) => psat(component('H2O'), T),
    lnKhH2S: (T) => lnKhG704('H2S', T),
    lnKhCO2: (T) => lnKhG704('CO2', T),
    // pure-water vapour fugacity coefficient at saturation, when the vapour is an equation of state (STEP 38)
    lnPhiSatW: eos && keys.includes('H2O') ? (T) => {
      const k = Math.round(T * 100);
      if (lnPhiSatWMemo.has(k)) return lnPhiSatWMemo.get(k);
      const iw = keys.indexOf('H2O'), y = keys.map((q, i) => (i === iw ? 1 : 0));
      let v = 0; try { v = eos.state(T, psat(component('H2O'), T), y, 'V').lnphi[iw]; if (!Number.isFinite(v)) v = 0; } catch (_e) { v = 0; }
      if (lnPhiSatWMemo.size > 2000) lnPhiSatWMemo.clear();
      lnPhiSatWMemo.set(k, v);
      return v;
    } : null,
  }) : null;
  const owned = new Array(n).fill(false);
  // STEP 34: urea-synthesis liquid (NH3, CO2, H2O, urea with carbamate / bicarbonate speciation)
  const ureaLiq = isUrea ? makeUreaLiquid(keys, { Gig: (k, T) => ureaGig(k, T), psatW: (T) => psat(component('H2O'), T), hig: (i, T) => hig(i, T) }) : null;
  if (ureaLiq) for (const i of ureaLiq.owned) owned[i] = true;
  function ureaGig(k, T) {
    const i = keys.indexOf(k);
    if (i >= 0) return hig(i, T) - T * sig(i, T);
    const q = idealRef(k);
    return q.hig(0, T) - T * q.sig(0, T);
  }
  if (elec) {
    for (const i of elec.owned) owned[i] = true;
    if (!keys.includes('H2O')) warnings.push(`${PACKAGES[model]}: no water in this unit's components — the liquid model needs water`);
    if ((elecModel === 'amine-mea' || elecModel === 'amine-mdea') && keys.includes('K2CO3')) fail('TH_ELECTROLYTE', `K2CO3 cannot be used with the ${elecModel === 'amine-mea' ? 'MEA' : 'MDEA'} package`, 'property_package');
    if (elecModel === 'amine-mdea' && keys.includes('MEA')) fail('TH_ELECTROLYTE', 'MEA cannot be mixed into the MDEA package (no MEA–MDEA parameters) — use one amine', 'components');
  }
  // Henry's law for dissolved gases (activity / ideal packages): a component is
  // a Henry component when it is a gas at ambient (Tb < 273.15 K, or no Tb and
  // Tc < 310 K), has Henry data against a solvent in the list, and the γ model
  // has no binary parameters for that pair. henry:false disables;
  // henry_components:[keys] sets the list explicitly.
  const henry = keys.map(() => null);
  if (activity && !isCSGS && (s.henry !== false || elec || ureaLiq)) {
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
    const reactive = keys.filter((k, i) => !owned[i] && ['H2S', 'NH3', 'CO2', 'SO2', 'HCl', 'Cl2', 'NO2', 'hydrogen-cyanide', 'carbonyl-sulfide', 'methyl-mercaptan', 'HNO3', 'formaldehyde'].includes(k));
    if (reactive.length) fail('TH_ELECTROLYTE', `${PACKAGES[model]}: ${reactive.join(', ')} react with the solvent and are not modelled (${elecModel === 'sour-water' ? 'NH3, H2S and CO2 chemistry' : elecModel === 'aqueous-electrolyte' ? 'CO2 and HCl chemistry with dissolved salts; NH3 and H2S need the sour-water method' : 'CO2 chemistry only'})`, 'components');
    const bad = keys.filter((k, i) => !owned[i] && !henry[i]);
    if (bad.length) fail('TH_ELECTROLYTE', `${PACKAGES[model]}: ${bad.join(', ')} not supported — the liquid holds ${elec.owned.map((i) => keys[i]).concat(elec.heavy.filter((k) => !keys.includes(k) && k !== 'H2O')).join(', ')} and gases with Henry data in water (N2, H2, O2, CH4, CO, Ar, …)`, 'components');
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
  const hig0 = (i, T) => (useNist && comps[i]._nist ? comps[i]._nist.at(T)[0] : hIG(comps[i], T));
  const sig0 = (i, T) => (useNist && comps[i]._nist ? comps[i]._nist.at(T)[1] : sIG(comps[i], T));
  // ROUND 12b: GERG-2008 carries its own ideal-gas heat capacities (Jaeschke & Schley); their shape is used, moved onto
  // the package basis (formation enthalpy, third-law entropy at 101325 Pa) at 298.15 K like the steam package
  const igOf = isGERG ? (i, T) => gerg.idealPure(eos.idx[i], T) : isRef ? (_i, T) => helm.idealGas(eos.f, T) : null;
  const gIG = isHelm ? keys.map((k, i) => { const q = igOf(i, T0); return { dh: hig0(i, T0) - q.h, ds: sig0(i, T0) - q.s, T: NaN, h: 0, s: 0 }; }) : null;
  const gAt = (i, T) => { const g = gIG[i]; if (T !== g.T) { const q = igOf(i, T); g.T = T; g.h = q.h + g.dh; g.s = q.s + g.ds; } return g; };
  const hig = isHelm ? (i, T) => gAt(i, T).h : hig0;
  const sig = isHelm ? (i, T) => gAt(i, T).s : sig0;

  // ---- STEP 39 pure-liquid enthalpy and entropy of activity-coefficient (and electrolyte-solvent) liquids ----
  // The ΔHvap route, h_L = h_ig − ΔHvap(T), takes the liquid heat capacity from the slope of the ΔHvap
  // correlation, which is poorly conditioned: at 25 °C it gives methanol +27 %, ammonia +25 %, ethanol +11 %,
  // and water −2 % at 5 °C to +15 % at 150 °C. Default route: water on IAPWS-IF97; every other component
  // with a liquid-Cp correlation is anchored at its normal boiling point, h_L(Tb) = h_ig(Tb) − ΔHvap(Tb),
  // and carried by ∫Cp_L dT (s by ∫Cp_L/T dT) up to about 0.9 Tc; above that the ΔHvap route takes over
  // with the offset fading linearly to zero at Tc, so ΔHvap still vanishes there.
  // liquid_enthalpy: 'hvap' keeps the ΔHvap route (as in DWSIM's default for activity models).
  const liqRoute = s.liquid_enthalpy === 'hvap' ? 'hvap' : 'cp';
  const GL8 = [[-0.9602898565, 0.1012285363], [-0.7966664774, 0.2223810345], [-0.5255324099, 0.3137066459], [-0.1834346425, 0.3626837834],
    [0.1834346425, 0.3626837834], [0.5255324099, 0.3137066459], [0.7966664774, 0.2223810345], [0.9602898565, 0.1012285363]];
  const iwL = keys.indexOf('H2O');
  // water: IF97 liquid at (T, max(P, psat)) on the package's ideal-gas basis; below 0 °C extrapolated with the 0 °C Cp
  let waterLiq = null;
  if (iwL >= 0) {
    const kgw = comps[iwL].MW, ig0 = steam.idealGas(T0, P0 / 1e6);
    const Ch = hig(iwL, T0) - kgw * ig0.h, Cs = sig(iwL, T0) - kgw * ig0.s;
    const TL = 273.16, TH = 0.97 * steam.TC;
    waterLiq = (T, P) => {
      const Te = Math.min(Math.max(T, TL), TH);
      const Pe = Math.max(P, steam.psat(Te) * 1e6 * (1 + 1e-6));
      let st;
      try { st = steam.liquidSide(Pe / 1e6, Te); } catch (_e) { return null; }
      let h = kgw * st.h + Ch, sv = kgw * st.s + Cs;
      if (T !== Te) { const cp = kgw * st.cp; h += cp * (T - Te); sv += cp * Math.log(T / Te); }
      return { h, s: sv };
    };
  }
  /** pure liquid at T on the ΔHvap route (association: calorimetric ΔHvap is to the associated vapour) */
  const legacyLiq = (i, T) => {
    const c = comps[i], ps = psat(c, T), hv = hvap(c, T);
    let h = hig(i, T) - hv, sv = sig(i, T) - R * Math.log(ps / P0) - hv / T;
    if (assocRef && assocRef.pos[i] >= 0) { const a = assocRef.pure(assocRef.pos[i], T, ps); h += a.h; sv += a.s; }
    return { h, s: sv };
  };
  const assocRef = assoc;
  const cpLiq = comps.map((c, i) => {
    if (liqRoute !== 'cp' || i === iwL || !c.cpl || !(c.Tc > 0)) return null;
    // eq. 16 (exponential form, the bulk of the databank) is carried on to 0.9 Tc beyond its fitted range —
    // it extrapolates far better than the ΔHvap slope (methanol at 137 °C: −1 % against +46 %); polynomials stop at their range
    const lo = c.cpl[6], top = c.cpl[7];
    const hi = c.cpl[0] === 16 ? Math.max(Math.min(top, 0.95 * c.Tc), 0.9 * c.Tc) : Math.min(top, 0.9 * c.Tc);
    if (!(hi > lo + 5) || !(corr(c.cpl, Math.min(0.5 * (lo + top), hi), c.Tc) > 0)) return null;
    const cpTop = corr(c.cpl, Math.min(top, hi), c.Tc) / 1000;
    const cp = (T) => { const v = corr(c.cpl, T, c.Tc) / 1000; return T > top ? Math.min(Math.max(v, cpTop), 3 * cpTop) : v; };   // J/(mol K)
    const Ta = Math.min(Math.max(num(c.tb) ? c.tb : T0, lo), hi);
    const integ = (a, b, f) => { const hh = 0.5 * (b - a), m = 0.5 * (a + b); let q = 0; for (const [x, w] of GL8) q += w * f(m + hh * x); return q * hh; };
    let base = null, atHi = null;
    const inRange = (T) => {
      if (!base) {
        // anchor: saturated liquid = saturated vapour − ΔHvap, the vapour on the package's vapour model,
        // so the latent heat at Tb is the measured one whichever vapour model is chosen
        base = legacyLiq(i, Ta);
        if (eos && activity) {
          try {
            const xi = comps.map((_c, j) => (j === i ? 1 : 0)), st = eos.state(Ta, psat(c, Ta), xi, 'V');
            if (Number.isFinite(st.hDep) && Number.isFinite(st.sDep)) { base = { h: base.h + st.hDep, s: base.s + st.sDep }; }
          } catch (_e) { /* ideal-gas anchor */ }
        }
      }
      return { h: base.h + integ(Ta, T, cp), s: base.s + integ(Ta, T, (t) => cp(t) / t) };
    };
    return (T) => {
      if (T < lo) { const r = inRange(lo), c0 = cp(lo); return { h: r.h + c0 * (T - lo), s: r.s + c0 * Math.log(T / lo) }; }
      if (T <= hi) return inRange(T);
      if (!atHi) { const a = inRange(hi), l = legacyLiq(i, hi); atHi = { dh: a.h - l.h, ds: a.s - l.s }; }
      const f = Math.max(0, (c.Tc - T) / (c.Tc - hi)), l = legacyLiq(i, T);
      return { h: l.h + f * atHi.dh, s: l.s + f * atHi.ds };
    };
  });
  /** pure-liquid h (J/mol, Poynting included) and s (J/(mol K), at saturation) of component i */
  const liqHS = (i, T, P) => {
    if (i === iwL && waterLiq && liqRoute === 'cp') { const w = waterLiq(T, P); if (w) return w; }
    const r = cpLiq[i] ? cpLiq[i](T) : legacyLiq(i, T);
    const c = comps[i];
    return { h: r.h + (T < c.Tc ? vLiq(c, T) * (P - psat(c, T)) : 0), s: r.s };
  };

  // ---- STEP 32 free water: liquid water on IAPWS-IF97 inside the cubic EOS ----
  // A cubic EOS overstates the latent heat of water (PR: liquid h at 25 °C is
  // 1.9 kJ/mol too low — boiler and condenser duties come out ~5 % high) and
  // understates its vapour pressure (PR: 15 % low at 27 °C). As in a commercial
  // simulator's free-water option, the water in a liquid phase is referred to
  // IAPWS-IF97 instead: the liquid Gibbs energy gains n_w·Δμ(T, P) with
  //   Δμ = μ_IF97,liq(T, P) − μ_EOS,pure liq(T, P),
  // so ln φ_w gains Δμ/RT, H gains x_w·Δh and S gains x_w·Δs (Δh, Δs the
  // matching differences — exact for pure liquid water, consistent by
  // construction). A phase takes the correction by how liquid-like its EOS root
  // is (packing fraction b/V from 0.15 to 0.25), so a vapour root gets none and
  // a single supercritical-like root gets the same value whatever it is called.
  // The correction fades out between 0.95 and 0.99 Tc of water; below 0 °C it
  // is extrapolated with Δh, Δs held at their 0 °C values. free_water:false
  // switches it off.
  const iw = keys.indexOf('H2O');
  let freeWater = null;
  if (isCubic && iw >= 0 && s.free_water !== false) {
    const TCw = steam.TC, T1 = 0.95 * TCw, T2 = 0.99 * TCw, TL = 273.15;
    const kgw = comps[iw].MW;                                   // kJ/kg × g/mol = J/mol
    const ig0w = steam.idealGas(T0, P0 / 1e6);
    const ChW = hig(iw, T0) - kgw * ig0w.h, CsW = sig(iw, T0) - kgw * ig0w.s;   // IF97 → package basis
    const eosRaw = eos;
    const unit = new Array(n).fill(0); unit[iw] = 1;
    let cT = NaN, cP = NaN, cV = null;
    /** Δμ/RT, Δh [J/mol], Δs [J/(mol K)] for water at (T, P), or null outside the range */
    const corr = (T, P) => {
      if (T === cT && P === cP) return cV;
      cT = T; cP = P; cV = null;
      if (!(T < T2)) return null;
      const Te = Math.max(T, TL);
      const Pe = Math.max(P, steam.psat(Te) * 1e6 * (1 + 1e-6));
      let st;
      try { st = steam.liquidSide(Pe / 1e6, Te); } catch (_e) { return null; }
      const ref = eosRaw.state(Te, Pe, unit, 'L');
      if (!(ref.B / ref.Z > 0.2)) return null;                    // no liquid-like EOS root: leave the EOS alone
      let dh = (kgw * st.h + ChW) - (hig(iw, Te) + ref.hDep);
      let ds = (kgw * st.s + CsW) - (sig(iw, Te) - R * Math.log(Pe / P0) + ref.sDep);
      let dmu = dh - T * ds;                                        // below 0 °C: Δh, Δs frozen, Δμ linear in T
      if (T > T1) {
        const w = T2 - T1, t = (T - T1) / w, lam = 1 - t * t * (3 - 2 * t), dlam = -6 * t * (1 - t) / w;
        dh = lam * dh - T * dlam * dmu;
        ds = lam * ds - dlam * dmu;
        dmu = lam * dmu;
      }
      cV = { C: dmu / (R * T), dh, ds };
      return cV;
    };
    const weight = (stt) => {
      const eta = stt.B / stt.Z, t = (eta - 0.15) / 0.10;
      return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    };
    // Gases dissolved in the aqueous liquid (STEP 32): with a constant k_ij a
    // cubic cannot give the solubility of gases in water (PR with the databank
    // k_ij puts CH4 about 28×, CO2 about 30× and CO about 150× too insoluble at
    // 25 °C, with the wrong temperature trend). Their infinite-dilution fugacity in water is moved
    // onto IAPWS G7-04 (13 gases), or Sander's (2015) Henry constants for other
    // gases (Tb < 0 °C; ammonia keeps the cubic, it is not sparingly soluble):
    // Δ_g(T) = ln kH,ref − ln kH,EOS (raw cubic, pure water at Psat). The
    // liquid gains G/RT = S·φ(x_w), S = Σ_g x_g Δ_g, φ = x_w·σ(x_w) with σ a
    // smooth step from 0 at x_w = 0.5 to 1 at x_w = 1 (σ(1) = 1, σ'(1) = 0), so
    // ln φ_g += φ·Δ_g − x_w·φ'·S, ln φ_w += (1 − x_w)·φ'·S, ln φ_j −= x_w·φ'·S,
    // H += −R T² φ Σ_g x_g Δ_g', S from (H − G)/T — exact at infinite dilution
    // in water (φ = φ' = 1 there), Gibbs–Duhem consistent at any composition,
    // and zero in a water-poor liquid (φ' = 0): a hydrocarbon liquid keeps the
    // cubic's own water solubility. Same weight and the same fade-out near the
    // critical point of water as above.
    const HW0 = 0.5;
    const hIdx = [];
    for (let i = 0; i < n; i++) {
      if (i === iw || keys[i] === 'NH3') continue;
      const c = comps[i];
      const gas = num(c.tb) ? c.tb < 273.15 : c.Tc < 310;
      if (G704[keys[i]]) hIdx.push([i, 'g704']);
      else if (gas && bip.HENRY[keys[i] + '|H2O']) hIdx.push([i, 'sander']);
    }
    let hT = NaN, hV = null;
    const lnKhRef = (i, src, T) => (src === 'g704' ? lnKhG704(keys[i], T) : (() => { const h = bip.HENRY[keys[i] + '|H2O']; return h[0] + h[1] / Math.min(Math.max(T, 273.15), 473.15); })());
    const lnKhEos = (T) => {
      const Te = Math.min(Math.max(T, TL), T2);
      const Ps = steam.psat(Te) * 1e6;
      const st = eosRaw.state(Te, Ps, unit, 'L');
      return st.lnphi.map((v) => v + Math.log(Ps));
    };
    /** Δ_g and dΔ_g/dT per component (0 for non-Henry), λ-faded; null when none apply */
    const henryCorr = (T) => {
      if (!hIdx.length || !(T < T2)) return null;
      if (T === hT) return hV;
      const Te = Math.max(T, TL), h = 0.01;
      const D = new Array(n).fill(0), Dp = new Array(n).fill(0);
      const e0 = lnKhEos(Te), ep = lnKhEos(Te + h), em = lnKhEos(Te - h);
      let lam = 1, dlam = 0;
      if (T > T1) { const w = T2 - T1, t = (T - T1) / w; lam = 1 - t * t * (3 - 2 * t); dlam = -6 * t * (1 - t) / w; }
      for (const [i, src] of hIdx) {
        const d0 = lnKhRef(i, src, Te) - e0[i];
        const d1 = T > TL ? ((lnKhRef(i, src, Te + h) - ep[i]) - (lnKhRef(i, src, Te - h) - em[i])) / (2 * h) : 0;
        D[i] = lam * d0; Dp[i] = lam * d1 + dlam * d0;
      }
      hT = T; hV = { D, Dp };
      return hV;
    };
    // Vapour side: water vapour is moved onto IF97 too. Its residual Gibbs energy
    // at its partial pressure p_w = y_w·P replaces the cubic's (pure-component
    // values, Lewis–Randall-like): the vapour gains n_w·Δg(T, p_w) with
    //   Δg = g^R_IF97,vap(T, p_w) − g^R_EOS,pure vap(T, p_w),
    // exact for steam and equal to the second-virial correction y_w²·(B_IF97 −
    // B_EOS)·P for dilute water (PR's B for steam is about half IF97's). Hence
    //   ln φ_w += [Δg + y_w(1 − y_w)·P·Δv]/RT,  ln φ_j −= y_w²·P·Δv/RT,
    //   H += y_w·Δh,  S += y_w·Δs,  V += y_w²·Δv.
    // Above Psat(T) (supersaturated vapour) Δg continues linearly in p; below
    // 0 °C and above 800 °C the second-virial form is used.
    const eosW = makeEOS(vapourModel, [comps[iw]], [[0]]);
    const MWkg = kgw / 1000;
    const Beos = (T) => eosW.b[0] - eosW.ai(T)[0] / (R * T);
    let vT = NaN, vP = NaN, vV = null;
    const vcorr = (T, p) => {
      if (T === vT && p === vP) return vV;
      vT = T; vP = p; vV = null;
      if (!(p > 1e-3)) { vV = { dg: 0, dh: 0, ds: 0, dv: 0 }; return vV; }
      if (T < TL || T > 1073.15) {
        const Tv = Math.min(Math.max(T, TL), 2273.15), bv = steam.secondVirial(Tv), h = 1e-3 * Tv;
        const d = bv.B * MWkg - Beos(Tv), dd = bv.dBdT * MWkg - (Beos(Tv + h) - Beos(Tv - h)) / (2 * h);
        vV = { dg: d * p, dh: p * (d - T * dd), ds: -p * dd, dv: d };
        return vV;
      }
      const pe = T < TCw ? Math.min(p, steam.psat(T) * 1e6) : p;
      let st, ig;
      try { st = steam.vapourSide(pe / 1e6, T); ig = steam.idealGas(T, pe / 1e6); } catch (_e) { vV = { dg: 0, dh: 0, ds: 0, dv: 0 }; return vV; }
      const e1 = eosW.state(T, pe, [1], 'V');
      const hR = kgw * (st.h - ig.h), sR = kgw * (st.s - ig.s);
      const dh0 = hR - e1.hDep, ds0 = sR - e1.sDep, dv = st.v * MWkg - e1.V;
      const dg0 = dh0 - T * ds0;
      vV = { dg: dg0 + dv * (p - pe), dh: dh0 + dv * (p - pe), ds: ds0, dv };
      return vV;
    };
    eos = Object.assign({}, eosRaw, {
      raw: eosRaw,
      state(T, P, x, phase) {
        const stt = eosRaw.state(T, P, x, phase);
        if (!(x[iw] > 0)) return stt;
        const w = weight(stt);
        const lnphi = stt.lnphi.slice();
        let hDep = stt.hDep, sDep = stt.sDep, V = stt.V;
        if (w > 0) {
          const c = corr(T, P);
          if (c) { lnphi[iw] += w * c.C; hDep += w * x[iw] * c.dh; sDep += w * x[iw] * c.ds; }
          const hc = henryCorr(T);
          if (hc) {
            const xw = x[iw];
            let S = 0, Sp = 0;
            for (const [i] of hIdx) { S += x[i] * hc.D[i]; Sp += x[i] * hc.Dp[i]; }
            // video round: G/RT = S·φ(x_w), φ = x_w·σ, σ a smooth step from 0 at x_w = 0.5 to 1 at x_w = 1 — φ(1) = φ'(1) = 1
            // keep the Henry constant and its first-order slope; a water-poor liquid gets nothing (with φ = x_w, water in
            // liquid propane got ln γ = S ≈ −6 and a propane liquid holding 40 % water came out of the flash)
            const tq = (xw - HW0) / (1 - HW0), sg = tq <= 0 ? 0 : tq >= 1 ? 1 : tq * tq * (3 - 2 * tq), dsg = tq <= 0 || tq >= 1 ? 0 : 6 * tq * (1 - tq) / (1 - HW0);
            const phi = xw * sg, dphi = sg + xw * dsg;
            for (let i = 0; i < n; i++) lnphi[i] += w * (i === iw ? dphi * (1 - xw) * S : phi * hc.D[i] - dphi * xw * S);
            const dH = -R * T * T * phi * Sp, dG = R * T * phi * S;
            hDep += w * dH;
            sDep += w * (dH - dG) / T;
          }
        }
        if (w < 1) {
          const wv = 1 - w, yw = x[iw], v = vcorr(T, yw * P), RT = R * T;
          for (let i = 0; i < n; i++) lnphi[i] += i === iw ? wv * (v.dg + yw * (1 - yw) * P * v.dv) / RT : -wv * yw * yw * P * v.dv / RT;
          hDep += wv * yw * v.dh;
          sDep += wv * yw * v.ds;
          V += wv * yw * yw * v.dv;
        }
        return Object.assign({}, stt, { lnphi, hDep, sDep, V, freeWater: w });
      },
    });
    freeWater = {
      index: iw,
      // pure water saturates on IF97, as in the steam package
      sat: {
        Tc: TCw, Pc: steam.PC * 1e6,
        psat: (T) => steam.psat(Math.min(Math.max(T, TL), TCw)) * 1e6,
        tsat: (P) => (P >= steam.PC * 1e6 ? Infinity : P < steam.PMIN * 1e6 ? NaN : steam.tsat(P / 1e6)),
      },
      correction: corr,
      henry: hIdx.map(([i, src]) => ({ key: keys[i], source: src === 'g704' ? 'IAPWS G7-04' : 'Sander (2015)' })),
    };
  }

  // ---- K-values / fugacity ----
  /** ln φ (EOS) or ln(γ Psat / P) (activity/ideal liquid) for one phase. */
  function lnFug(T, P, x, phase) {
    if (isEOS) return eos.state(T, P, x, phase).lnphi;
    if (phase === 'V') {
      if (eos) return eos.state(T, P, x, 'V').lnphi;
      return assoc ? assoc.mix(T, P, x).lnphi.slice() : new Array(n).fill(0);
    }
    if (ureaLiq) {
      const lp = ureaLiq.lnPhiL(T, P, x);
      return comps.map((c, i) => {
        if (owned[i]) return lp[i];
        const hm = henryMix(i, T, x);
        return hm ? hm.lnH - Math.log(P) : 50;
      });
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
    if (csgs) return comps.map((_c, i) => lg[i] + csgs.lnNu(i, T, P));        // ROUND 12c: f_L,i = x γ ν P
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
    if (ureaLiq) return ureaHS(T, P, x).h;
    if (elec) return elecH(T, P, x);
    if (csgs) return h + csgsLK.state(T, P, x, 'L').hDep;                  // Lee–Kesler liquid departure
    for (let i = 0; i < n; i++) if (x[i] > 0) {
      const hm = henry[i] ? henryMix(i, T, x) : null;
      if (hm) { h += x[i] * R * hm.B; continue; }             // heat of solution R·B for Henry gases
      // pure liquid (STEP 39 route; association and V_L (P − Psat) included) relative to the ideal gas already summed
      h += x[i] * (liqHS(i, T, P).h - hig(i, T));
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
    if (ureaLiq) return ureaHS(T, P, x).s;
    if (elec) return elecS(T, P, x);
    if (csgs) return s + sMix - R * Math.log(P / P0) + csgsLK.state(T, P, x, 'L').sDep;
    // liquid: pure saturated liquid at Psat, then ideal mixing + excess
    for (let i = 0; i < n; i++) if (x[i] > 0) {
      const hm = henry[i] ? henryMix(i, T, x) : null;
      if (hm) { s += x[i] * (-(hm.lnH - Math.log(P0)) * R + R * hm.B / T); continue; }
      s += x[i] * (liqHS(i, T, P).s - sig(i, T));
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
    if (ureaLiq) { let v = ureaLiq.volume(T, x); for (let i = 0; i < n; i++) if (!owned[i] && x[i] > 0) v += x[i] * 35e-6; return v; }
    return liquidVolume(comps, T, P, x, eos, liqVol);
  }
  // ---- electrolyte liquid: partial molar properties by Gibbs–Helmholtz ----
  // h̄_i = h_i,ig − ΔHvap,i (solvents) + (−RT² ∂ln a_i/∂T); CO2 (and MDEA, Extended UNIQUAC): h_ig − RT² ∂ln f/∂T;
  // K2CO3: aqueous standard state (NBS) − RT² ∂ln a/∂T. Henry gases as in the γ–φ packages.
  // STEP 38: water-based methods (sour water, aqueous electrolytes) take pure liquid water on IAPWS-IF97,
  // on the package's ideal-gas basis; below 0 °C extrapolated with the 0 °C heat capacity
  // STEP 39: every electrolyte method on the default liquid route
  const waterIF = elec && waterLiq && (elec.waterIF97 || liqRoute === 'cp') ? waterLiq : null;
  function elecPartials(T, P, x) {
    const xs = elec.sub(x);
    const hx = elec.hEx(T, xs);
    const lp = elec.lnPhiSubRaw(T, xs);
    const out = {};
    for (const i of elec.owned) {
      const key = elec.keyOf(i);
      const xsub = elec.xsub(xs, key);
      const lnf = lp[key] + Math.log(xsub) + Math.log(xs.S);           // ln f_i [Pa], diluted by any Henry gases
      let h, sv;
      const wIF = key === 'H2O' && waterIF ? waterIF(T, P) : null;
      if (wIF) {
        h = wIF.h + (hx.H2O || 0);
        sv = wIF.s + (hx.H2O || 0) / T - R * (elec.rel(T, xs).H2O + Math.log(xs.S));
      } else if (elec.salts.includes(key)) {
        const ref = elec.saltRef(T, key);
        const lnact = elec.rel(T, xs)[key];
        h = ref.h + (hx[key] || 0);
        sv = ref.s + (hx[key] || 0) / T - R * lnact - R * Math.log(xs.S);
      } else {
        // gas-referenced keys (CO2; MDEA in the Extended UNIQUAC package) follow their fugacity
        // directly; a model whose gas standard state carries its own ideal-gas Cp (igShape) keeps
        // that Cp so the solution heat capacity is the one the model was fitted with
        const shape = elec.igShape && elec.igShape[key];
        const hg = shape ? hig(i, T0) + shape.cp * (T - T0) : hig(i, T);
        const sg = shape ? sig(i, T0) + shape.cp * Math.log(T / T0) : sig(i, T);
        h = hg + (hx[key] || 0);
        if (!elec.gasRef.includes(key)) {
          // liquid solvent (MEA, K2CO3 solvent key …): STEP 39 route, Poynting included
          h += (shape ? 0 : liqHS(i, T, P).h - hig(i, T)) - (shape ? hvap(comps[i], T) - (T < comps[i].Tc ? vLiq(comps[i], T) * (P - psat(comps[i], T)) : 0) : 0);
        }
        sv = sg - R * (lnf - Math.log(P0)) + (h - hg) / T;
      }
      out[i] = { h, s: sv };
    }
    return out;
  }
  // urea liquid: owned components from the model's partial molar h, s; Henry gases as in the γ–φ packages
  function ureaHS(T, P, x) {
    const pm = ureaLiq.partials(T, P, x);
    let h = 0, sv = 0;
    for (let i = 0; i < n; i++) {
      if (!(x[i] > 0)) continue;
      if (owned[i]) { h += x[i] * pm[i].h; sv += x[i] * pm[i].s; continue; }
      const hm = henryMix(i, T, x);
      const lnH = hm ? hm.lnH : Math.log(1e12);
      h += x[i] * (hig(i, T) + (hm ? R * hm.B : 0));
      sv += x[i] * (sig(i, T) - R * (Math.log(x[i]) + lnH - Math.log(P0)) + (hm ? R * hm.B / T : 0));
    }
    return { h, s: sv };
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
  const gSat = [];
  const threePhase = !elec && (s.three_phase === true || ((s.three_phase === undefined || s.three_phase === 'auto') && ((isEOS && keys.includes('H2O') && hcLiquid) || model === 'unifac-ll')));   // ROUND 12d: UNIFAC-LL is for two liquids
  return {
    model, label: PACKAGES[model], keys, comps, n, isEOS, vapourModel, warnings, kijUsed, threePhase,
    henryKeys: keys.filter((k, i) => henry[i]), poynting, excessEnthalpy: excessH, liquidVolumeMethod: liqVol, volumeTranslation: !!eos && s.volume_translation !== false && keys.some((k) => VT_C[vapourModel] && num(VT_C[vapourModel][k])),
    estimatedPairs: act && act.estimated ? act.estimated : [],                  // STEP 37
    // STEP 32: free water (IAPWS-IF97 liquid water inside the EOS) and the pure-water saturation it implies
    freeWater: freeWater ? { index: iw, correction: freeWater.correction, henry: freeWater.henry } : null,
    pureSatOf: (i) => (freeWater && i === iw ? freeWater.sat : isHelm ? (gSat[i] || (gSat[i] = eosPureSat(eos, n, i, comps[i], eos.crit(i)))) : null),
    association: assoc ? { keys: assoc.keys, sources: assoc.src } : null,
    ureaLiquid: ureaLiq || undefined,
    electrolyte: ureaLiq ? { model: 'urea', solvent: 'urea synthesis liquid', heavy: ['urea'], report: (T, x) => ureaLiq.report(T, x), warn: (T, x) => ureaLiq.warn(T, x),
      viscosity: (T, x) => ureaViscosity(ureaLiq, T, x), saltLnAct: (T, x) => ureaLiq.ureaLnAct(T, x), nonvolatile: keys.map((k) => k === 'urea'), urea: true } : elec ? { model: elecModel, solvent: elec.solvent, heavy: elec.heavy, report: (T, x) => elec.report(T, x), warn: (T, x) => elec.warn(T, x), viscosity: elec.viscosity,
      waterTransport: !!elec.waterTransport, conductivity: elec.conductivity || null, sigma: elec.sigma || null,
      saltLnAct: (T, x, key) => elec.saltLnAct(T, x, key || 'K2CO3'),
      nonvolatile: keys.map((k) => ELECTROLYTE_KEYS.includes(k)) } : null,
    eos, act, lnFug, lnK, hPhase, sPhase, volPhase, hig, sig,
    idealGasData: isGERG ? 'gerg-2008' : isRef ? 'reference-eos' : useNist ? 'nist+chemsep' : 'chemsep',
    MW: comps.map((c) => c.MW),
  };
}

// ---------------------------------------------------------------------------
// STEP 26 — steam package: pure water / steam on IAPWS-IF97
// ---------------------------------------------------------------------------
// Every state comes from the full IF97 formulation (regions 1, 2, 3, 5 and the
// saturation line) instead of the ChemSep correlations, and viscosity / thermal
// conductivity from IAPWS R12-08 / R15-11 — the properties a steam turbine,
// boiler feed pump, desuperheater or condenser is designed with. IF97 has its
// own reference state (u = s = 0 for liquid at the triple point); it is moved
// onto the package basis (formation enthalpy, third-law entropy at 101325 Pa)
// by matching IF97's ideal-gas part to the ideal-gas H and S at 298.15 K, so
// a steam stream carries the same H as it would on Peng–Robinson at low
// pressure and the reaction / mixing balances of the other units stay valid.
const IF97_TMIN = 273.15, IF97_TMAX = 2273.15;
const STEAM_PC = steam.PC * 1e6;            // Pa

/** IF97 single-phase state at T [K], P [Pa] on the branch of `phase` ('L' | 'V'). */
function steamState(T, P, phase) {
  if (!(T >= IF97_TMIN - 1e-9)) fail('TH_STEAM_RANGE', `IAPWS-IF97 covers water from 0 °C (got ${(T - 273.15).toFixed(2)} °C)`, 'T_K');
  if (!(T <= IF97_TMAX)) fail('TH_STEAM_RANGE', `IAPWS-IF97 covers steam up to 2000 °C (got ${(T - 273.15).toFixed(1)} °C)`, 'T_K');
  const p = P / 1e6;
  try {
    if (T >= steam.TC || p >= steam.PC) return steam.pt(p, T);            // one fluid above the critical point
    const ps = steam.psat(Math.max(T, IF97_TMIN));
    const want = phase === 'V' ? 'V' : 'L';
    const stable = p >= ps ? 'L' : 'V';
    if (want === stable || Math.abs(p / ps - 1) < 1e-9) return want === 'L' ? steam.liquidSide(p, T) : steam.vapourSide(p, T);
    // a metastable phase (the other side of the saturation line): the IF97 equations
    // extend a little past it; further out, the saturated phase at T stands in
    try { return want === 'L' ? steam.liquidSide(p, T) : steam.vapourSide(p, T); } catch (_e) { const sat = steam.satT(T); return want === 'L' ? sat.liq : sat.vap; }
  } catch (e) {
    if (e instanceof ThermoError) throw e;
    fail('TH_STEAM_RANGE', `IAPWS-IF97: ${e.message}`, 'P_bar');
  }
}

function makeSteamPackage(keys) {
  const ks = [...new Set(keys)];
  if (ks.length !== 1 || ks[0] !== 'H2O') {
    fail('TH_STEAM', `the Steam (IAPWS-IF97) package is for pure water and steam only — this unit also carries ${ks.filter((k) => k !== 'H2O').join(', ') || 'no water'}; use Peng–Robinson, NRTL or another package for mixtures`, 'property_package');
  }
  const c = component('H2O');
  const MWw = c.MW;                               // g/mol — the same MW converts mass flows, so H per kg is IF97's h exactly
  const kg = MWw;                                 // kJ/kg × g/mol = J/mol
  const higW = (T) => (c._nist ? c._nist.at(T)[0] : hIG(c, T));
  const sigW = (T) => (c._nist ? c._nist.at(T)[1] : sIG(c, T));
  const ig0 = steam.idealGas(T0, P0 / 1e6);
  const Ch = higW(T0) - kg * ig0.h;               // J/mol
  const Cs = sigW(T0) - kg * ig0.s;               // J/(mol K)
  const st = (T, P, phase) => steamState(T, P, phase);
  return {
    model: 'steam', label: PACKAGES.steam, keys: ks, comps: [c], n: 1, isEOS: false, vapourModel: 'if97', warnings: [],
    kijUsed: {}, threePhase: false, henryKeys: [], poynting: false, association: null, electrolyte: null,
    eos: null, act: null,
    // pure component: the flashes take saturation from IF97 (region 4) through this hook
    pureSat: {
      Tc: steam.TC, Pc: STEAM_PC,
      psat: (T) => steam.psat(Math.min(Math.max(T, IF97_TMIN), steam.TC)) * 1e6,
      tsat: (P) => (P >= STEAM_PC ? Infinity : P < steam.PMIN * 1e6 ? NaN : steam.tsat(P / 1e6)),
    },
    lnFug(T, P, x, phase) {
      if (phase === 'V' || T >= steam.TC) return [0];
      return [Math.log(steam.psat(Math.max(T, IF97_TMIN)) * 1e6 / P)];
    },
    lnK(T, P) { return T >= steam.TC ? [0] : [Math.log(steam.psat(Math.max(T, IF97_TMIN)) * 1e6 / P)]; },
    hPhase: (T, P, x, phase) => kg * st(T, P, phase).h + Ch,
    sPhase: (T, P, x, phase) => kg * st(T, P, phase).s + Cs,
    volPhase: (T, P, x, phase) => st(T, P, phase).v * MWw / 1000,
    hig: (i, T) => higW(T), sig: (i, T) => sigW(T),
    steam: {
      state: st,
      /** transport and caloric properties of one phase in the package's units */
      phaseProps(T, P, phase) {
        const s2 = st(T, P, phase);
        return { cp: s2.cp * kg, mu: steam.viscosity(s2.rho, T), k: steam.conductivity(s2.rho, T, s2), w: s2.w,
          sigma: phase === 'L' && T < steam.TC ? steam.surfaceTension(T) : undefined };
      },
    },
    idealGasData: 'iapws-if97',
    MW: [MWw],
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

/** saturation hook of a pure component: the package's own (steam) or free water's IF97 line (STEP 32) */
const satHook = (pp, i) => pp.pureSat || (pp.pureSatOf ? pp.pureSatOf(i) : null);

const liveIdx = (z) => z.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);

/**
 * Isothermal flash.
 * @param {object} pp package
 * @param {number[]} z feed mole fractions (sum 1)
 * @param {number} T K
 * @param {number} P Pa
 * @returns {{T,P,beta,x,y,phase:('V'|'L'|'VL'),iterations:number}}
 */
export function flashPT(pp, z, T, P, hint) {
  if (!(T > 0) || !(P > 0)) fail('TH_TP', 'flash needs T > 0 and P > 0');
  const live = liveIdx(z);
  if (live.length === 1) {
    // pure component: saturation from the vapour-pressure correlation (as DWSIM / ChemSep)
    const c = pp.comps[live[0]];
    const sat = satHook(pp, live[0]);
    const Tc = sat ? sat.Tc : c.Tc, Pc = sat ? sat.Pc : c.Pc;
    if (T >= Tc || P >= Pc) return single(pp, z, T, P, T >= Tc ? 'V' : 'L');
    return single(pp, z, T, P, (sat ? sat.psat(T) : psat(c, T)) > P ? 'V' : 'L');
  }
  return pp.isEOS ? flashPT_EOS(pp, z, T, P, hint && hint.phase === 'VL' && !hint.x2 ? kOf(hint) : null) : pp.electrolyte ? flashPT_elec(pp, z, T, P) : flashPT_act(pp, z, T, P);
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
    for (const i of salt) g += z[i] * pp.electrolyte.saltLnAct(T, r.st.xn, pp.keys[i]);
    return g;
  };
  // concentrated salt solutions (where the extrapolated Pitzer model can have more than
  // one vapour–liquid solution) are solved from every start and the lowest-G state kept
  const concentrated = (r) => !pp.electrolyte.urea && salt.length && salt.some((i) => r.st.xn[i] / Math.max(r.st.xn[pp.keys.indexOf('H2O')] || 0, 1e-9) > 0.07);
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
      const dw = (dw0 && dw0.sx <= 1 + 1e-9 ? dw0 : null) || dewTest([closest, res].filter((q) => q && q.st).map((q) => q.st.xn)) || dw0;
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
  if ((!res || !(res.nrm < 1e-8)) && salt.length && closest && !pp.electrolyte.urea) {
    // the usual cause: the brine boils down past the salt's solubility (solids would form)
    const iW = pp.keys.indexOf('H2O');
    const xw = iW >= 0 ? closest.st.xn[iW] : 0;
    const note = pp.electrolyte.warn(T, closest.st.xn) || '';
    if (/too concentrated/.test(note) || !(xw > 0.5)) {
      const mol = salt.reduce((a, i) => a + closest.st.xn[i], 0) / Math.max(xw * 0.018015, 1e-12);
      fail('TH_FLASH', `acid-gas flash at ${T.toFixed(2)} K, ${(P / 1e5).toFixed(3)} bar: the solution boils down past the salt's solubility (the liquid heads beyond ${Math.min(mol, 99).toFixed(0)} mol salt per kg water) — solid salt would form, which the model does not cover; raise the pressure, lower the temperature or add water`);
    }
  }
  if ((!res || !(res.nrm < 1e-6)) && pp.electrolyte.urea && closest && closest.st) {
    // urea method: damped successive substitution from the best Newton state (converges where
    // the Newton Jacobian of the speciated liquid is poorly conditioned, e.g. near a dew point)
    let K = new Array(n).fill(1e-30);
    for (const i of vol) K[i] = Math.max(closest.st.yn[i], 1e-30) / Math.max(closest.st.xn[i], 1e-30);
    for (let it = 0; it < 300; it++) {
      const rr = rachfordRice(z, K);
      if (rr.below) return single(pp, z, T, P, 'L');
      if (rr.above) { if (!salt.length) return single(pp, z, T, P, 'V'); break; }
      const b = rr.beta;
      let x = z.map((zi, i) => zi / (1 + b * (K[i] - 1))), yv = x.map((xi, i) => xi * K[i]);
      const sx = x.reduce((a, c) => a + c, 0), sy = yv.reduce((a, c) => a + c, 0);
      x = x.map((v) => v / sx); yv = yv.map((v) => v / sy);
      const lL = pp.lnFug(T, P, x, 'L'), lV = pp.lnFug(T, P, yv, 'V');
      let err = 0;
      for (const i of vol) { const kn = Math.exp(lL[i] - lV[i]); err = Math.max(err, Math.abs(Math.log(kn / K[i]))); K[i] = Math.exp(0.5 * Math.log(K[i]) + 0.5 * Math.log(kn)); }
      if (err < 1e-10) { if (b < 1e-13) return single(pp, z, T, P, 'L'); if (b > 1 - 1e-13 && !salt.length) return single(pp, z, T, P, 'V'); return { T, P, beta: b, x, y: yv, phase: 'VL', iterations: it }; }
    }
  }
  if (!res || !(res.nrm < 1e-6)) {
    if (pp.electrolyte.urea) {
      const iW = pp.keys.indexOf('H2O'), iU = pp.keys.indexOf('urea');
      const wet = (iW >= 0 ? z[iW] : 0) + (iU >= 0 ? z[iU] : 0);
      fail('TH_FLASH', `urea-method flash did not converge at ${T.toFixed(2)} K, ${(P / 1e5).toFixed(3)} bar (residual ${res ? res.nrm.toExponential(2) : 'n/a'})` +
        (wet < 0.15 && P < 100e5 ? ' — NH3–CO2 with little water at this pressure is near the solid ammonium carbamate region, which the liquid model does not cover' : ''));
    }
    fail('TH_FLASH', `${pp.electrolyte.urea ? 'urea-method' : 'acid-gas'} flash did not converge at ${T.toFixed(2)} K, ${(P / 1e5).toFixed(3)} bar (residual ${res ? res.nrm.toExponential(2) : 'n/a'})`);
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
 * Newton–Raphson on ln K (STEP 32): residual F_i = ln K_i − [ln φ_i,L(x) −
 * ln φ_i,V(y)] with x, y from the Rachford–Rice solution at K (negative flash
 * allowed), Jacobian by forward differences, step limited to 1 in ln K and a
 * backtracking line search on ‖F‖. Used where successive substitution
 * crawls — near a critical point, where its convergence ratio tends to 1.
 * Works for every package (pp.lnK). Returns null when it cannot improve.
 */
function newtonFlash(pp, z, T, P, K0, maxIt) {
  const live = liveIdx(z);
  const m = live.length;
  const evalAt = (lnKl) => {
    const K = z.map(() => 1);
    live.forEach((i, a) => { K[i] = Math.exp(lnKl[a]); });
    const rr = rachfordRice(z, K);
    if (rr.below || rr.above) return null;
    const { x, y } = phaseComps(z, K, rr.beta);
    const lc = pp.lnK(T, P, x, y);
    const F = live.map((i, a) => lnKl[a] - lc[i]);
    let nr = 0; for (const v of F) nr = Math.max(nr, Math.abs(v));
    if (!isFinite(nr)) return null;
    return { F, nr, beta: rr.beta, x, y, K };
  };
  let lk = live.map((i) => Math.log(K0[i]));
  let cur = evalAt(lk);
  if (!cur) return null;
  let it;
  for (it = 0; it < (maxIt || 30); it++) {
    if (cur.nr < 1e-11) break;
    const J = [];
    for (let a = 0; a < m; a++) J.push(new Array(m).fill(0));
    for (let b = 0; b < m; b++) {
      const h = 1e-7 * Math.max(1, Math.abs(lk[b]));
      const l2 = lk.slice(); l2[b] += h;
      const e2 = evalAt(l2);
      if (!e2) return null;
      for (let a = 0; a < m; a++) J[a][b] = (e2.F[a] - cur.F[a]) / h;
    }
    const d = solveLin(J, cur.F.map((v) => -v));
    if (!d || !d.every(isFinite)) return null;
    let mx = 0; for (const v of d) mx = Math.max(mx, Math.abs(v));
    let lam = mx > 1 ? 1 / mx : 1, nxt = null;
    for (let k = 0; k < 12; k++) {
      const l2 = lk.map((v, a) => v + lam * d[a]);
      const e2 = evalAt(l2);
      if (e2 && e2.nr < (1 - 1e-4 * lam) * cur.nr) { nxt = { l: l2, e: e2 }; break; }
      lam *= 0.5;
    }
    if (!nxt) break;
    lk = nxt.l; cur = nxt.e;
    let triv = 0; for (const v of lk) triv += v * v;
    if (triv < 1e-10) return null;                    // collapsed onto the trivial solution
  }
  return { beta: cur.beta, x: cur.x, y: cur.y, K: cur.K, it, residual: cur.nr, converged: cur.nr < 1e-9 };
}

/**
 * Successive substitution on K with dominant-eigenvalue acceleration.
 * Negative flash is allowed while iterating; a converged β outside (0,1)
 * means the feed is single-phase. STEP 32: when substitution has not
 * converged after 100 steps, Newton (newtonFlash) takes over from the
 * current K; the result carries `converged` and the final residual.
 */
function ssFlash(pp, z, T, P, K0, maxIt) {
  const n = pp.n;
  const cap = maxIt || 500;
  let K = K0.slice(), x, y, beta = 0.5, it = 0, err = Infinity, newtonTried = false;
  let lnKprev = K.map(Math.log);
  const hist = [];
  for (it = 1; it <= cap; it++) {
    const rr = rachfordRice(z, K);
    if (rr.below || rr.above) return { beta: rr.below ? 0 : 1, single: rr.below ? 'L' : 'V', K, it };
    beta = rr.beta;
    ({ x, y } = phaseComps(z, K, beta));
    const lnKn = pp.lnK(T, P, x, y);
    err = 0; for (let i = 0; i < n; i++) if (z[i] > 0) err = Math.max(err, Math.abs(lnKn[i] - lnKprev[i]));
    hist.push(lnKn);
    let lnKu = lnKn;
    if (it % 5 === 0 && hist.length >= 3) {
      const ha = hist[hist.length - 3], hb = hist[hist.length - 2], hc = hist[hist.length - 1];
      let nu1 = 0, de1 = 0;
      for (let i = 0; i < n; i++) if (z[i] > 0) { const d1 = hb[i] - ha[i], d2 = hc[i] - hb[i]; nu1 += d2 * d1; de1 += d1 * d1; }
      const lam = de1 > 0 ? nu1 / de1 : 0;
      if (lam > 0 && lam < 0.995) lnKu = hc.map((v, i) => v + lam * (hc[i] - hb[i]) / (1 - lam));
    }
    K = lnKu.map(Math.exp);
    lnKprev = lnKu;
    let triv = 0; for (let i = 0; i < n; i++) if (z[i] > 0) triv += lnKn[i] * lnKn[i];
    if (triv < 1e-10) return { beta, trivial: true, K, it };
    if (err < 1e-11) break;
    if (it === 100 && !newtonTried) {
      newtonTried = true;
      const nw = newtonFlash(pp, z, T, P, K);
      if (nw && nw.converged) {
        if (nw.beta <= 0 || nw.beta >= 1) return { beta: nw.beta, single: nw.beta <= 0 ? 'L' : 'V', K: nw.K, it: it + nw.it };
        return { beta: nw.beta, x: nw.x, y: nw.y, K: nw.K, it: it + nw.it, converged: true, residual: nw.residual, method: 'newton' };
      }
    }
  }
  const converged = err < 1e-8;
  const rr = rachfordRice(z, K);
  if (rr.below || rr.above) return { beta: rr.below ? 0 : 1, single: rr.below ? 'L' : 'V', K, it };
  if (rr.beta <= 0 || rr.beta >= 1) return { beta: rr.beta, single: rr.beta <= 0 ? 'L' : 'V', K, it, converged };
  ({ x, y } = phaseComps(z, K, rr.beta));
  return { beta: rr.beta, x, y, K, it, converged, residual: err };
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

function kOf(r) { return r.y.map((v, i) => (r.x[i] > 0 && v > 0 ? v / r.x[i] : 1)); }
function flashPT_EOS(pp, z, T, P, Kg) {
  // STEP 30: K-values of a two-phase solution at a nearby temperature (the previous trial of
  // a P–H / P–S flash) start the successive substitution; anything but a two-phase answer
  // falls through to the full Wilson + stability path below
  if (Kg && Kg.length === z.length) {
    const rg = rachfordRice(z, Kg);
    if (!rg.below && !rg.above && rg.beta > 0 && rg.beta < 1) {
      const r = ssFlash(pp, z, T, P, Kg);
      if (!r.single && !r.trivial) return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it, converged: r.converged !== false, residual: r.residual };
    }
  }
  const Kw = wilsonK(pp, T, P);
  const rr = rachfordRice(z, Kw);
  if (!rr.below && !rr.above && rr.beta > 0 && rr.beta < 1) {
    const r = ssFlash(pp, z, T, P, Kw);
    if (!r.single && !r.trivial) return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it, converged: r.converged !== false, residual: r.residual };
  }
  const st = stabilityEOS(pp, T, P, z);
  if (!st) return single(pp, z, T, P, labelSingleEOS(pp, z, T, P));
  const K0 = st.trial === 'V'
    ? st.W.map((w, i) => (z[i] > 0 ? w / z[i] : 1))
    : st.W.map((w, i) => (z[i] > 0 && w > 0 ? z[i] / w : 1));
  const r = ssFlash(pp, z, T, P, K0, 1000);
  if (r.single || r.trivial) return single(pp, z, T, P, labelSingleEOS(pp, z, T, P));
  return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it, converged: r.converged !== false, residual: r.residual };
}

function flashPT_act(pp, z, T, P) {
  const n = pp.n;
  let K = pp.lnK(T, P, z, z).map(Math.exp);
  for (let outer = 0; outer < 4; outer++) {
    const r = ssFlash(pp, z, T, P, K, 600);
    if (!r.single && !r.trivial) return { T, P, beta: r.beta, x: r.x, y: r.y, phase: 'VL', iterations: r.it, converged: r.converged !== false, residual: r.residual };
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
function ssLL(pp, z, T, P, x1, x2, maxIt, tol) {
  const eps = tol || 1e-10;
  const n = pp.n, live = liveIdx(z);
  let K = z.map((zi, i) => (zi > 0 ? Math.max(x2[i], 1e-30) / Math.max(x1[i], 1e-30) : 1));
  let beta = 0.5, xa = x1, xb = x2, it, err = Infinity;
  for (it = 1; it <= (maxIt || 800); it++) {
    const rr = rachfordRice(z, K);
    if (rr.below || rr.above) return null;
    beta = rr.beta;
    ({ x: xa, y: xb } = phaseComps(z, K, beta));
    const fb = pp.lnFug(T, P, xb, 'L');
    const lnK = pp.lnFug(T, P, xa, 'L').map((v, i) => v - fb[i]);
    let triv = 0;
    err = 0;
    for (const i of live) { err = Math.max(err, Math.abs(lnK[i] - Math.log(K[i]))); triv += lnK[i] * lnK[i]; }
    K = lnK.map(Math.exp);
    if (triv < 1e-8) return null;
    if (err < eps) break;
  }
  if (!(beta > 0 && beta < 1)) return null;
  void n;
  return { beta, x1: xa, x2: xb, it, converged: err < Math.max(1e-8, 10 * eps), residual: err };
}

/**
 * STEP 40: liquid–liquid split of a liquid of composition x at T, P — {x1, x2, beta} (beta = fraction
 * of liquid 2) or null when a single liquid is stable. A previous split (hint) starts the substitution.
 * Used by the residue-curve and azeotrope analyses.
 */
export function liquidSplit(pp, x, T, P, hint, tol) {
  if (liveIdx(x).length < 2) return null;
  const dist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
  const ok = (ll) => ll && ll.converged && ll.beta > 1e-9 && ll.beta < 1 - 1e-9 && dist(ll.x1, ll.x2) > 1e-5;
  if (hint && hint.x1 && hint.x2) {
    const ll = ssLL(pp, x, T, P, x.map((v, i) => (v > 0 ? Math.max(hint.x1[i], 1e-12) : 0)), x.map((v, i) => (v > 0 ? Math.max(hint.x2[i], 1e-12) : 0)), 300, tol);
    if (ok(ll)) return { x1: ll.x1, x2: ll.x2, beta: ll.beta };
  }
  const st = stabilityLiquid(pp, T, P, x, x, null);
  if (!st) return null;
  const ll = ssLL(pp, x, T, P, x.map((v) => (v > 0 ? Math.max(v, 1e-12) : 0)), st.w, 800, tol);
  return ok(ll) ? { x1: ll.x1, x2: ll.x2, beta: ll.beta } : null;
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

/** can a vapour form from liquid x (bubble-point sum > 1)? — the test flashPT3 applies to a liquid–liquid answer */
function vapourFrom(pp, T, P, x) {
  const fl = pp.lnFug(T, P, x, 'L');
  let yv = x.slice();
  for (let k = 0; k < 40; k++) { const fv = pp.lnFug(T, P, yv, 'V'); yv = norm(x.map((xi, i) => xi * Math.exp(fl[i] - fv[i]))); }
  const fv = pp.lnFug(T, P, yv, 'V');
  let sb = 0; for (let i = 0; i < pp.n; i++) sb += x[i] * Math.exp(fl[i] - fv[i]);
  return sb > 1 + 1e-9;
}
/** successive substitution for vapour + two liquids from starting K-values (relative to liquid 1) */
function ss3(pp, z, T, P, KV, KL, b0) {
  const n = pp.n;
  let b = b0.slice(), rr, x1, y, x2, it, lastErr = Infinity;
  const bAt = [];                 // phase fractions 20 iterations back
  for (it = 1; it <= 1500; it++) {
    rr = rachfordRice3(z, KV, KL, b);
    b = [rr.bV, rr.bL];
    // STEP 30: a phase fraction that has settled clearly below zero (negative flash) means that
    // phase does not form — stop now instead of running the iteration limit (same answer: null)
    bAt.push(b);
    if (it > 30) {
      const o = bAt[bAt.length - 21];
      if ((b[0] < -0.01 && Math.abs(b[0] - o[0]) < 0.2 * Math.abs(b[0])) || (b[1] < -0.01 && Math.abs(b[1] - o[1]) < 0.2 * Math.abs(b[1]))
        || (1 - b[0] - b[1] < -0.01 && Math.abs(b[0] + b[1] - o[0] - o[1]) < 0.2 * Math.abs(1 - b[0] - b[1]))) return null;
    }
    if (bAt.length > 25) bAt.shift();
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
    lastErr = err;
    if (trivL < 1e-8 || trivV < 1e-8) return null;
    if (err < 1e-10) break;
    if (it > 60 && (b[0] < -0.5 || b[1] < -0.5 || b[0] + b[1] > 1.5)) return null;   // a phase is vanishing — another candidate wins
  }
  rr = rachfordRice3(z, KV, KL, b);
  const bV = rr.bV, bL2 = rr.bL, bL1 = 1 - bV - bL2;
  if (!(bV > 1e-12 && bL2 > 1e-12 && bL1 > 1e-12)) return null;
  x1 = norm(rr.x1.map((v) => Math.max(v, 0))); y = norm(x1.map((v, i) => v * KV[i])); x2 = norm(x1.map((v, i) => v * KL[i]));
  return { T, P, beta: bV, beta2: bL2, x: x1, y, x2, phase: 'VLL', iterations: it, converged: lastErr < 1e-8, residual: lastErr };
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
export function flashPT3(pp, z, T, P, hint) {
  // STEP 30: a three-phase answer at a nearby temperature (previous trial of a P–H / P–S
  // flash) starts the V/L/L substitution directly; any other outcome takes the full path
  if (hint && hint.phase === 'VLL' && hint.x2 && hint.beta > 0 && hint.beta2 > 0) {
    const KV0 = hint.y.map((y, i) => (z[i] > 0 ? Math.max(y, 1e-30) / Math.max(hint.x[i], 1e-30) : 1));
    const KL0 = hint.x2.map((x2, i) => (z[i] > 0 ? Math.max(x2, 1e-30) / Math.max(hint.x[i], 1e-30) : 1));
    const v = ss3(pp, z, T, P, KV0, KL0, [hint.beta, hint.beta2]);
    if (v) { const best = pp.isEOS ? lightestAsVapour(pp, T, P, v) : v; return orderLiquids(pp, T, P, best); }
  }
  if (hint && hint.phase === 'LL' && hint.x2 && hint.beta2 > 0 && hint.beta2 < 1) {
    // liquid–liquid answer nearby: converge the two liquids from it, and keep it when no vapour
    // can form from the lighter liquid (bubble-point test as below); otherwise the full path
    const ll = ssLL(pp, z, T, P, z.map((v, i) => (v > 0 ? Math.max(hint.x[i], 1e-12) : 0)), hint.x2);
    if (ll) {
      const rLL = { T, P, beta: 0, beta2: ll.beta, x: ll.x1, y: ll.x1, x2: ll.x2, phase: 'LL', iterations: ll.it, converged: ll.converged, residual: ll.residual };
      if (!vapourFrom(pp, T, P, rLL.x)) return eosLabels(pp, T, P, orderLiquids(pp, T, P, rLL));
    }
  }
  const r2 = flashPT(pp, z, T, P, hint && hint.phase === 'VL' && !hint.x2 ? hint : null);
  if (r2.phase === 'V' || liveIdx(z).length < 2) return r2;
  const xl = r2.phase === 'L' ? z : r2.x;
  const st = stabilityLiquid(pp, T, P, xl, z, r2.phase === 'VL' ? r2.y : null);
  if (!st) return eosLabels(pp, T, P, r2);
  const cands = [r2];
  // liquid–liquid split of the whole feed
  const xs = z.map((v, i) => (v > 0 ? Math.max(xl[i], 1e-12) : 0));
  const ll = ssLL(pp, z, T, P, xs, st.w);
  let rLL = null;
  if (ll) { rLL = { T, P, beta: 0, beta2: ll.beta, x: ll.x1, y: ll.x1, x2: ll.x2, phase: 'LL', iterations: ll.it, converged: ll.converged, residual: ll.residual }; cands.push(rLL); }
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
  return eosLabels(pp, T, P, best.x2 ? orderLiquids(pp, T, P, best) : best);
}
/**
 * Video round: phase labels of an EOS two-phase answer from flashPT3. A phase with a single real root
 * has an arbitrary 'vapour' / 'liquid' label, and the V/L and L/L candidates of one state tie in G/RT, so
 * the label is set by what the phase is: gas above its pseudo-critical temperature (Li's rule), liquid
 * below it when it is also dense (packing fraction b/V above 0.4; the critical value is about 0.25).
 * Cases seen: a saturated natural gas over a little free water came out as 'liquid 1' (64 kg/m³) and
 * would have left a three-phase separator through the light-liquid outlet; liquid propane over water at
 * 69.5 bar came out as the 'vapour' of a V/L answer.
 */
function eosLabels(pp, T, P, r) {
  if (!pp.isEOS || !pp.eos || typeof pp.eos.state !== 'function' || !pp.comps) return r;
  const kind = (x) => {
    let st;
    try { st = pp.eos.state(T, P, x, 'min'); } catch (_e) { return null; }
    if (!st || st.nRoots !== 1) return null;
    let sv = 0, stc = 0;
    for (let i = 0; i < pp.n; i++) {
      const c = pp.comps[i];
      if (!(x[i] > 0) || !(c.Tc > 0) || !(c.Pc > 0)) continue;
      const vc = x[i] * (0.2905 - 0.085 * (c.omega || 0)) * c.Tc / c.Pc;   // Vc from Zc ≈ 0.2905 − 0.085ω (R cancels)
      sv += vc; stc += vc * c.Tc;
    }
    if (!(sv > 0)) return null;
    if (T > stc / sv) return 'gas';
    return num(st.B) && num(st.Z) && st.Z > 0 && st.B / st.Z > 0.4 ? 'liquid' : null;
  };
  if (r.phase === 'LL' && r.x2 && r.beta2 > 0 && r.beta2 < 1) {
    if (kind(r.x) !== 'gas' || kind(r.x2) === 'gas') return r;
    const { x2, beta2, ...rest } = r;
    return { ...rest, phase: 'VL', beta: 1 - beta2, y: r.x, x: x2 };
  }
  if (r.phase === 'VL' && !r.x2 && r.beta > 0 && r.beta < 1 && r.y && r.x) {
    const kv = kind(r.y);
    if (kv !== 'liquid') return r;
    const kl = kind(r.x);
    if (kl === 'gas') return { ...r, beta: 1 - r.beta, y: r.x, x: r.y };          // labels swapped
    return orderLiquids(pp, T, P, { ...r, phase: 'LL', beta: 0, beta2: 1 - r.beta, x: r.y, x2: r.x, y: r.y });
  }
  return r;
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
    const sat = satHook(pp, live[0]);
    const T = sat ? sat.tsat(P) : satT(c, P);
    if (Number.isNaN(T)) fail('TH_VF', `no saturation temperature at ${(P / 1e5).toFixed(5)} bar — below the triple-point pressure of water`);
    if (!isFinite(T)) fail('TH_SUPERCRITICAL', `${pp.keys[live[0]]} is supercritical at ${(P / 1e5).toFixed(3)} bar — no saturation temperature`);
    return { T, P, beta, x: z.slice(), y: z.slice(), phase: beta === 0 ? 'L' : beta === 1 ? 'V' : 'VL', iterations: 0 };
  }
  if (pp.electrolyte && beta === 1 && live.some((i) => pp.electrolyte.nonvolatile[i])) {
    fail('TH_VF', 'no dew point: the dissolved salt stays in the liquid, so the liquid cannot vanish completely');
  }
  // an equation of state can converge onto the trivial solution (vapour = liquid) near the critical region:
  // such a "dew point" is not a phase boundary. Reject it and locate the boundary by scanning PT flashes.
  const eosEnd = pp.isEOS && (beta === 0 || beta === 1);
  const trivialish = (r) => { if (!eosEnd || !r || !r.K) return false; let m = 0; for (const i of live) m = Math.max(m, Math.abs(Math.log(r.K[i]))); return m < 0.02; };
  // round 11: a bubble point found for the feed as one liquid is not the phase boundary when that liquid splits into two
  // (nitrogen with ethane near the critical pressure of nitrogen): then the boundary is where the lighter liquid boils
  const checkLL = (r) => {
    if (!(pp.isEOS && beta === 0 && r && live.length >= 2)) return r;
    let sp = null;
    try { sp = liquidSplit(pp, z, r.T, P); } catch (_e) { sp = null; }
    if (!sp) return r;
    const hb = hetBubbleEOS(pp, z, P, r.T, sp);
    return hb || r;
  };
  if (num(Tguess)) { try { const r = vfSolve(pp, z, beta, 'T', P, Tguess); if (!trivialish(r)) return checkLL(r); } catch (_e) { /* a poor guess can collapse onto the trivial solution — restart from Wilson */ } }
  try {
    const r = vfSolve(pp, z, beta, 'T', P, undefined);
    if (trivialish(r)) { const q = vfScanT(pp, z, beta, P); if (q) return q; }
    return checkLL(r);
  } catch (e) {
    if (eosEnd) { const q = vfScanT(pp, z, beta, P); if (q) return q; }
    if (pp.electrolyte && pp.electrolyte.urea) { const r = vfBisect(pp, z, beta, 'T', P, Tguess); if (r) return r; }
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

/**
 * STEP 41: temperature at which the feed has vapour fraction beta at pressure P when a second liquid may form
 * (valid phases VLL). A bubble point of a liquid that splits into two liquids is heterogeneous — it lies above
 * the bubble point of the (unstable) single liquid. The two-phase answer is kept when the three-phase flash
 * finds no second liquid there; otherwise the vapour fraction of the three-phase PT flash is bisected in T.
 */
export function flashPVF3(pp, z, P, beta, Tguess) {
  let r2 = null, e2 = null;
  try { r2 = flashPVF(pp, z, P, beta, Tguess); } catch (e) { e2 = e; }
  const at = (T) => { const r = flashPT3(pp, z, T, P); return { r, bV: r.phase === 'V' ? 1 : (r.phase === 'L' || r.phase === 'LL') ? 0 : r.beta }; };
  if (r2) {
    const q = at(r2.T);
    if (!q.r.x2) return r2;                       // no second liquid at the two-phase answer
  }
  const above = (q) => (beta === 0 ? q.bV > 1e-12 : beta === 1 ? q.bV >= 1 - 1e-12 : q.bV >= beta);
  const T0 = r2 ? r2.T : num(Tguess) ? Tguess : 350;
  let lo = null, hi = null, qhi = null, qlo = null;
  const q0 = at(T0);
  if (above(q0)) { hi = T0; qhi = q0; } else { lo = T0; qlo = q0; }
  for (let d = 1, k = 0; k < 14 && (lo === null || hi === null); k++, d *= 2) {
    if (hi === null) { const T = lo + d, q = at(T); if (above(q)) { hi = T; qhi = q; } else { lo = T; qlo = q; } }
    else { const T = Math.max(20, hi - d), q = at(T); if (above(q)) { hi = T; qhi = q; } else { lo = T; qlo = q; } }
  }
  if (lo === null || hi === null) { if (r2) return r2; throw e2 || new ThermoError('TH_VF', 'vapour-fraction point not found with a second liquid'); }
  for (let it = 0; it < 50 && hi - lo > 1e-6; it++) {
    const T = 0.5 * (lo + hi), q = at(T);
    if (above(q)) { hi = T; qhi = q; } else { lo = T; qlo = q; }
  }
  const T = 0.5 * (lo + hi);
  if (beta === 0) {
    // the liquids just below the bubble point and the first vapour just above it
    const L = qlo.r, V = qhi.r;
    const y = V.phase === 'V' ? V.y : V.y || L.x;
    if (L.phase === 'LL') return { T, P, beta: 0, beta2: L.beta2, x: L.x, x2: L.x2, y, phase: 'LL', iterations: 0, method: 'bisect3' };
    return { T, P, beta: 0, x: z.slice(), y, phase: 'L', iterations: 0, method: 'bisect3' };
  }
  if (beta === 1) {
    const L = qlo.r;
    return { T, P, beta: 1, x: L.x, x2: L.x2, y: z.slice(), phase: 'V', iterations: 0, method: 'bisect3' };
  }
  const r = qhi.r;
  return Object.assign({}, r, { T, method: 'bisect3' });
}

/** Pressure at which the feed has vapour fraction beta at temperature T. */
export function flashTVF(pp, z, T, beta, Pguess) {
  if (!(beta >= 0 && beta <= 1)) fail('TH_VF', 'vapour fraction must be 0–1');
  const live = liveIdx(z);
  if (live.length === 1) {
    const c = pp.comps[live[0]];
    const sat = satHook(pp, live[0]);
    if (T >= (sat ? sat.Tc : c.Tc)) fail('TH_SUPERCRITICAL', `${pp.keys[live[0]]} is supercritical at ${T.toFixed(2)} K — no saturation pressure`);
    return { T, P: sat ? sat.psat(T) : psat(c, T), beta, x: z.slice(), y: z.slice(), phase: beta === 0 ? 'L' : beta === 1 ? 'V' : 'VL', iterations: 0 };
  }
  // ROUND 12c: as for bubble and dew temperatures, an equation of state can land on the trivial solution or fail
  // (a supercritical light gas in a heavy liquid); then the boundary is found by scanning PT flashes in pressure
  const eosEnd = pp.isEOS && (beta === 0 || beta === 1);
  const trivialish = (r) => { if (!eosEnd || !r || !r.K) return false; let m = 0; for (const i of live) m = Math.max(m, Math.abs(Math.log(r.K[i]))); return m < 0.02; };
  if (num(Pguess) && Pguess > 0) { try { const r = vfSolve(pp, z, beta, 'P', T, Math.log(Pguess)); if (!trivialish(r)) return r; } catch (_e) { /* restart from Wilson */ } }
  try {
    const r = vfSolve(pp, z, beta, 'P', T, undefined);
    if (trivialish(r)) { const q = vfScanP(pp, z, beta, T); if (q) return q; }
    return r;
  } catch (e) {
    if (eosEnd) { const q = vfScanP(pp, z, beta, T); if (q) return q; }
    if (pp.electrolyte && pp.electrolyte.urea) { const r = vfBisect(pp, z, beta, 'P', T, Pguess); if (r) return r; }
    throw e;
  }
}

/**
 * ROUND 12c: bubble (beta = 0) or dew (beta = 1) pressure of an equation-of-state mixture by scanning PT flashes
 * upwards in ln P — a dew point is the first pressure at which a liquid appears, a bubble point the pressure at
 * which the last vapour disappears — then bisecting on the boundary. Returns null when no boundary is crossed
 * (the temperature is above the cricondentherm, or the mixture goes dense without a phase change).
 */
function vfScanP(pp, z, beta, T) {
  const live = liveIdx(z);
  const ph = (P) => { try { const r = flashPT(pp, z, T, P); return { r, two: r.phase === 'VL' && r.beta > 0 && r.beta < 1 }; } catch (_e) { return null; } };
  const dew = beta === 1;
  let pmin = Infinity;
  for (const i of live) { const c = pp.comps[i]; const v = T < c.Tc ? psat(c, T) : c.Pc; if (v > 0) pmin = Math.min(pmin, v); }
  pmin = Math.max(1, Math.min(0.2 * pmin, 1e5));
  let pIn = null, pOut = null, qIn = null, seenTwo = false;
  for (let P = pmin, k = 0; k < 200 && P <= 1.5e8; k++, P *= 1.08) {
    const q = ph(P);
    if (!q) continue;
    if (dew) {
      if (q.two) { if (pOut !== null) { pIn = P; qIn = q; break; } continue; }
      if (q.r.phase === 'V') pOut = P;
      else if (pOut !== null) return null;                 // vapour went straight to liquid: dense fluid, no dew point
    } else {
      if (q.two) { seenTwo = true; pIn = P; qIn = q; continue; }
      if (seenTwo && q.r.phase === 'L') { pOut = P; break; }
      if (seenTwo) return null;                            // two phases then one dense non-liquid phase: above the cricondentherm side
    }
  }
  if (pIn === null || pOut === null) return null;
  for (let it = 0; it < 60 && Math.abs(Math.log(pOut / pIn)) > 1e-9; it++) {
    const P = Math.sqrt(pOut * pIn), q = ph(P);
    if (!q) break;
    if (q.two) { pIn = P; qIn = q; } else pOut = P;
  }
  const P = Math.sqrt(pOut * pIn), r = qIn.r;
  const res = dew ? { T, P, beta: 1, x: r.x, y: z.slice(), phase: 'V' } : { T, P, beta: 0, x: z.slice(), y: r.y, phase: 'L' };
  res.K = (dew ? z.map((zi, i) => (r.x[i] > 0 ? zi / r.x[i] : 1)) : r.y.map((yi, i) => (z[i] > 0 ? yi / z[i] : 1)));
  res.iterations = 0; res.scanned = true;
  return res;
}

/**
 * Vapour-fraction point by bracketing on isothermal flashes (urea method: the speciated
 * liquid makes the composition iteration of vfSolve fragile; β(T) and β(ln P) are monotonic).
 * mode 'T': T at fixed P; mode 'P': P at fixed T. Returns null when no bracket is found.
 */
/**
 * STEP 41: dew (beta = 1) or bubble (beta = 0) temperature of an equation-of-state mixture by scanning PT flashes —
 * from the top down for a dew point (the first temperature at which a liquid appears), from the bottom up for a
 * bubble point — then bisecting on the phase boundary. Used when the Newton solver fails or lands on the trivial
 * solution near the critical region. Returns null when the pressure is above the cricondenbar (no boundary).
 */
function vfScanT(pp, z, beta, P) {
  const live = liveIdx(z);
  const Tcs = live.map((i) => pp.comps[i].Tc);
  const Tmax = Math.min(1500, 1.25 * Math.max(...Tcs)), Tmin = Math.max(20, 0.3 * Math.min(...Tcs));
  const ph = (T) => { try { const r = flashPT(pp, z, T, P); return { r, two: r.phase === 'VL' && r.beta > 0 && r.beta < 1 }; } catch (_e) { return null; } };
  const dew = beta === 1;
  // round 11: is the lighter phase of a split liquid-like? (Z below the critical Z of the cubic: 0.307 PR, 1/3 SRK)
  const zc = pp.eos && pp.eos.kind === 'srk' ? 1 / 3 : 0.3074;
  const lightIsLiquid = (T, r) => { try { return pp.eos.state(T, P, r.y, 'V').Z < zc; } catch (_e) { return false; } };
  let tOut = null, tIn = null, qIn = null;           // tOut: single phase side, tIn: two-phase side
  let tLL = null, qLL = null, tTwo = null;           // bubble side: two liquids seen before any vapour
  for (let T = dew ? Tmax : Tmin, k = 0; k < 160 && T >= Tmin - 1e-9 && T <= Tmax + 1e-9; k++, T = dew ? T * 0.975 : T / 0.975) {
    const q = ph(T);
    if (!q) continue;
    if (q.two) {
      if (tOut === null) {
        // a split before the single phase was seen (e.g. a CO2-rich liquid far below its freezing point) is not this boundary —
        // unless it is two liquids (liquid N2 beside liquid ethane, …) whose lighter one then boils: that is a heterogeneous bubble point
        if (!dew && pp.eos) {
          if (lightIsLiquid(T, q.r)) { tLL = T; qLL = q; }
          else if (tLL !== null) {
            const hb = hetBubbleEOS(pp, z, P, tLL, { x1: qLL.r.x, x2: qLL.r.y });
            if (hb) return hb;
            tTwo = T; tLL = null;
          }
          else if (tTwo === null) tTwo = T;
        }
        continue;
      }
      tIn = T; qIn = q; break;
    }
    if ((dew && q.r.phase === 'V') || (!dew && q.r.phase === 'L')) { tOut = T; tLL = null; }
    else if (tOut !== null) return null;              // vapour turned into liquid (or back) without two phases: dense / supercritical
  }
  if (!dew && tOut === null && (tLL !== null || tTwo !== null)) {
    fail('TH_VF', `no bubble point at ${(P / 1e5).toFixed(3)} bar: the mixture stays in two phases from ${Tmin.toFixed(0)} K up to its dew point — ` +
      'its components do not form a single liquid at this pressure (one of them is above or near its critical point)');
  }
  if (tIn === null || tOut === null) return null;
  for (let it = 0; it < 60 && Math.abs(tOut - tIn) > 1e-7 * tIn; it++) {
    const T = 0.5 * (tOut + tIn), q = ph(T);
    if (!q) break;
    if (q.two) { tIn = T; qIn = q; } else tOut = T;
  }
  const T = 0.5 * (tOut + tIn), r = qIn.r;
  const res = dew ? { T, P, beta: 1, x: r.x, y: z.slice(), phase: 'V' } : { T, P, beta: 0, x: z.slice(), y: r.y, phase: 'L' };
  res.K = (dew ? z.map((zi, i) => (r.x[i] > 0 ? zi / r.x[i] : 1)) : r.y.map((yi, i) => (z[i] > 0 ? yi / z[i] : 1)));
  res.iterations = 0; res.method = 'scan';
  // polish with the Newton solver from the bracketed temperature; keep it only if it stays non-trivial and close
  try {
    const q = vfSolve(pp, z, beta, 'T', P, T);
    let m = 0; for (const i of live) m = Math.max(m, Math.abs(Math.log(q.K[i])));
    if (m >= 0.02 && Math.abs(q.T - T) < 0.05) return q;
  } catch (_e) { /* keep the bracketed result */ }
  return res;
}

/**
 * Round 11: heterogeneous bubble point of an equation-of-state mixture that is two liquids below its bubble point
 * (nitrogen with ethane, propane or CO2 near the critical pressure of nitrogen, for example): the temperature at
 * which the lighter liquid boils, so that vapour, light liquid and heavy liquid coexist. Found as the fixed point
 * T = T_bubble(light liquid of the liquid–liquid split at T) — the vapour that forms is in equilibrium with both
 * liquids. Starts from a temperature T0 at which the feed is two liquids, with an optional split as the hint.
 * Returns null when the two liquids merge or no fixed point is found.
 */
function hetBubbleEOS(pp, z, P, T0, hint) {
  let T = T0, sp = liquidSplit(pp, z, T, P, hint), b = null;
  if (!sp) return null;
  const lightOf = (q) => (molarMassOf(pp, q.x1) < molarMassOf(pp, q.x2) ? q.x1 : q.x2);
  for (let it = 0; it < 60; it++) {
    b = null;
    for (const g of [T, undefined]) { try { b = vfSolve(pp, lightOf(sp), 0, 'T', P, g); break; } catch (_e) { b = null; } }   // the guess can collapse onto the trivial solution: retry from Wilson
    if (!b) return null;
    let m = 0; for (const i of liveIdx(b.x)) m = Math.max(m, Math.abs(Math.log(b.K[i])));
    if (m < 0.02) return null;                                     // the light liquid's bubble point collapsed onto the trivial solution
    const dT = b.T - T;
    T = b.T;
    const n = liquidSplit(pp, z, T, P, sp);
    if (!n) return null;                                           // the liquids merged before the light one boiled
    sp = n;
    if (Math.abs(dT) < 1e-7 * T) break;
  }
  const light = lightOf(sp), heavy = light === sp.x1 ? sp.x2 : sp.x1;
  const bLight = light === sp.x1 ? 1 - sp.beta : sp.beta;          // ssLL: beta is the share of x2
  return { T, P, beta: 0, x: heavy, x2: light, beta2: bLight, y: b.y, phase: 'LL', iterations: 0, method: 'het-bubble',
    note: 'heterogeneous bubble point — below it the feed is two liquids' };
}
const molarMassOf = (pp, x) => x.reduce((a, v, i) => a + v * pp.MW[i], 0);

function vfBisect(pp, z, beta, mode, fixed, guess) {
  const bOf = (u) => {
    const T = mode === 'T' ? u : fixed, P = mode === 'T' ? fixed : Math.exp(u);
    const r = flashPT(pp, z, T, P);
    return { r, b: r.phase === 'L' ? 0 : r.phase === 'V' ? 1 : r.beta };
  };
  // residual increasing in u: β − target in T, target − β in ln P
  const g = (q) => (mode === 'T' ? q.b - beta : beta - q.b);
  let lo = mode === 'T' ? 250 : Math.log(1e4), hi = mode === 'T' ? 700 : Math.log(1e9);
  const u0 = num(guess) && guess > 0 ? (mode === 'T' ? guess : Math.log(guess)) : null;
  let qlo = null, qhi = null;
  try {
    if (u0 !== null) {
      // walk out from the guess
      let d = mode === 'T' ? 5 : 0.05, q0 = bOf(u0);
      if (g(q0) < 0) { lo = u0; qlo = q0; for (let k = 0; k < 30; k++) { const u = u0 + d; const q = bOf(u); if (g(q) >= 0) { hi = u; qhi = q; break; } lo = u; qlo = q; d *= 2; } }
      else { hi = u0; qhi = q0; for (let k = 0; k < 30; k++) { const u = u0 - d; const q = bOf(u); if (g(q) < 0) { lo = u; qlo = q; break; } hi = u; qhi = q; d *= 2; } }
    }
    if (!qlo) qlo = bOf(lo);
    if (!qhi) qhi = bOf(hi);
  } catch (_e) { return null; }
  if (!(g(qlo) < 0 && g(qhi) >= 0)) return null;
  let best = null;
  for (let it = 0; it < 80; it++) {
    const u = 0.5 * (lo + hi);
    let q;
    try { q = bOf(u); } catch (_e) { return null; }
    if (g(q) < 0) lo = u; else hi = u;
    best = { u, q };
    if (Math.abs(q.b - beta) < 1e-7 && q.r.phase === 'VL') break;
    if (hi - lo < (mode === 'T' ? 1e-7 : 1e-10)) break;
  }
  if (!best) return null;
  const T = mode === 'T' ? best.u : fixed, P = mode === 'T' ? fixed : Math.exp(best.u);
  const r = best.q.r;
  // at a bubble (dew) point the flash sits on the boundary: report the incipient phase
  if (r.phase !== 'VL') return { T, P, beta, x: z.slice(), y: z.slice(), phase: beta === 0 ? 'L' : beta === 1 ? 'V' : r.phase, iterations: 80 };
  return { T, P, beta: r.beta, x: r.x, y: r.y, phase: beta === 0 ? 'L' : beta === 1 ? 'V' : 'VL', iterations: 80 };
}

// ---------------------------------------------------------------------------
// PH / PS flashes
// ---------------------------------------------------------------------------

function stateFlash(pp, z, P, target, fn, Tguess, flashFn, hint0) {
  const val = (r) => (fn === 'h' ? hOf(pp, r) : sOf(pp, r));
  const ff = flashFn || flashPT;
  let hint = hint0 && hint0.x && hint0.y ? hint0 : null;        // last trial's answer: warm start of the next trial's flash (STEP 30)
  const at = (T) => {
    const r = ff(pp, z, T, P, hint);
    hint = r;
    return { T, r, v: val(r) - target };
  };
  const tol = (fn === 'h' ? 1e-10 : 1e-12) * Math.abs(target) + (fn === 'h' ? 1e-6 : 1e-9);
  // pure component: plateau at Tsat is handled analytically
  const live = liveIdx(z);
  if (live.length === 1) {
    const c = pp.comps[live[0]];
    const sat = satHook(pp, live[0]);
    const Ts = sat ? sat.tsat(P) : satT(c, P);
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
  // STEP 30 single-phase fast path: Newton on T with the phase's own enthalpy (entropy)
  // function — no flash per step — then ONE full flash at the answer confirms the phase
  // (stability test included); otherwise the bracketing search below runs as before
  if ((A.r.phase === 'V' || A.r.phase === 'L') && !A.r.x2) {
    const ph = A.r.phase;
    try {
      const f = (T) => (fn === 'h' ? pp.hPhase(T, P, z, ph) : pp.sPhase(T, P, z, ph)) - target;
      let T = A.T, v = f(T), ok = false;
      for (let k = 0; k < 12 && isFinite(v); k++) {
        const d = Math.max(1e-3, 1e-5 * T);
        const sl = (f(T + d) - v) / d;
        if (!(sl > 0)) break;
        T = Math.max(10, T + Math.max(-50, Math.min(50, -v / sl)));
        v = f(T);
        if (Math.abs(v) < tol) { ok = true; break; }
      }
      if (ok) {
        const B = at(T);
        if (B.r.phase === ph && !B.r.x2 && Math.abs(B.v) < tol) return { ...B.r, iterations: 0 };
      }
    } catch (_e) { /* model not valid along the path — bracketing below */ }
  }
  // bracket the root walking from the guess. STEP 30: the first trial is a short probe and,
  // when it does not bracket, the next one jumps to the secant (≈ −Δ/Cp) prediction plus a
  // small overshoot — a far guess no longer costs a long run of growing fixed steps
  let step = 10, B = null, probe = true;
  for (let k = 0; k < 80; k++) {
    let T2 = A.v < 0 ? A.T + step : Math.max(10, A.T - step);
    if (probe) T2 = A.v < 0 ? A.T + 1 : Math.max(10, A.T - 1);
    try { B = at(T2); } catch (e) {
      // a state the model cannot represent (e.g. an electrolyte boiled dry) lies beyond
      // the target in this direction: retreat with a shorter step
      if (step < 0.05) throw e;
      step /= 4; B = null; probe = false; continue;
    }
    if ((A.v < 0) !== (B.v < 0) || Math.abs(B.v) < tol) break;
    if (T2 <= 10 && B.v > 0) fail(fn === 'h' ? 'TH_PH' : 'TH_PS', `${fn === 'h' ? 'enthalpy' : 'entropy'} target below the 10 K limit`);
    const sl = (B.v - A.v) / (B.T - A.T);
    A = B;
    if (probe && sl > 0) {
      const d = Math.abs(A.v / sl);                 // secant distance to the root
      step = Math.min(Math.max(1.02 * d + 0.5, 1), 400);
    } else step *= 1.6;
    probe = false;
    if (T2 > 6000) fail(fn === 'h' ? 'TH_PH' : 'TH_PS', `${fn === 'h' ? 'enthalpy' : 'entropy'} target above the 6000 K limit`);
  }
  if (Math.abs(B.v) < tol) return { ...B.r, iterations: 0 };
  const bracketed = (A.v < 0) !== (B.v < 0);
  let lo = A.v < 0 ? A : B, hi = A.v < 0 ? B : A;
  let it, side = 0, flo = lo.v, fhi = hi.v;
  // Illinois regula falsi (the retained end's value is halved when the same end is kept
  // twice running), with a bisection step whenever the secant point leaves the bracket
  for (it = 0; it < 200; it++) {
    let T = lo.T - flo * (hi.T - lo.T) / (fhi - flo);
    if (!(T > lo.T && T < hi.T)) T = 0.5 * (lo.T + hi.T);
    const m = at(T);
    if (Math.abs(m.v) < tol) return { ...m.r, iterations: it };
    if (m.v < 0) { lo = m; flo = m.v; if (side === -1) fhi *= 0.5; side = -1; }
    else { hi = m; fhi = m.v; if (side === 1) flo *= 0.5; side = 1; }
    if (hi.T - lo.T < 1e-9 * hi.T) break;
  }
  // a jump in H(T) that the bracket cannot resolve (pure-component-like
  // plateau, azeotrope, three-phase point): lever rule between the phase
  // assemblages on the two sides — phase amounts are combined, so the
  // material balance closes exactly
  const vl = lo.v + target, vh = hi.v + target;
  const lam = Math.min(1, Math.max(0, (target - vl) / (vh - vl)));
  const out = leverState(lo.r, hi.r, lam, hi.T, P, it);
  // STEP 32: a lever-rule answer is genuine only when the bracket closed on a jump in H(T)
  // (or S(T)) and both sides' flashes converged
  if (!bracketed || !(hi.T - lo.T < 1e-6 * hi.T) || lo.r.converged === false || hi.r.converged === false) {
    out.converged = false;
    out.residual = Math.min(Math.abs(lo.v), Math.abs(hi.v));
  }
  return out;
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
export function flashPH(pp, z, P, H, Tguess, hint) { return stateFlash(pp, z, P, H, 'h', Tguess, null, hint); }
/** Flash at (P, S): S in J/(mol K). */
export function flashPS(pp, z, P, S, Tguess, hint) { return stateFlash(pp, z, P, S, 's', Tguess, null, hint); }
/** Three-phase flash at (P, H). */
export function flashPH3(pp, z, P, H, Tguess, hint) { return stateFlash(pp, z, P, H, 'h', Tguess, flashPT3, hint); }
/** Three-phase flash at (P, S). */
export function flashPS3(pp, z, P, S, Tguess, hint) { return stateFlash(pp, z, P, S, 's', Tguess, flashPT3, hint); }

// ---------------------------------------------------------------------------
// properties of a flash result (per phase and overall)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// STEP 37 — transport properties. Pure components: the ChemSep correlations
// inside their range; outside it, or where a component has none (run-time user
// components, a few databank entries), a corresponding-states estimate:
//   liquid viscosity   Letsou–Stiel (Tr ≥ 0.76; above the correlation's upper
//                      limit it is scaled to meet the correlation there),
//                      Lewis–Squires temperature dependence below Tr 0.76
//   vapour viscosity   Chung et al. (1988) dilute gas
//   vapour conductivity Chung et al. (1988)
//   liquid conductivity Sato–Riedel
//   surface tension    Brock–Bird (scaled to the correlation's end point)
// Mixtures (Poling, Prausnitz & O'Connell, 5th ed.):
//   vapour μ  Herning–Zipperer + Jossi–Stiel–Thodos dense-gas term (§9-5, 9-6)
//   vapour k  Wassiljewa with the Mason–Saxena coefficients (ε = 1) + Stiel–
//             Thodos dense-gas term on pseudo-critical constants (§10-5, 10-6)
//   liquid μ  Grunberg–Nissan without interaction (ln-mole-fraction mean) +
//             Lucas (1981) compressed-liquid correction above the saturation
//             pressure (§9-10, 9-12)
//   liquid k  Li (1976) — DIPPR procedure 9I (§10-12)
//   liquid σ  Winterfeld, Scriven & Davis (1978) (§12-5)
// Each estimate used is named in phase.estimated.
// ---------------------------------------------------------------------------
const CP_UNIT = 1e-3;            // cP → Pa·s
/** a correlation value, NaN when its equation form is not supported (e.g. ChemSep eq 118) */
function tcorr(k, T, Tc) { try { return corr(k, T, Tc); } catch (_e) { return NaN; } }
function noteEst(est, what) { if (est && !est.includes(what)) est.push(what); }
/** Letsou–Stiel (1973) saturated-liquid viscosity [Pa s], 0.76 ≤ Tr ≤ 0.98 */
function letsouStiel(c, T) {
  const Tr = Math.min(Math.max(T / c.Tc, 0.76), 0.98);
  const x0 = (1.5174 - Tr * (2.135 - 0.75 * Tr)) * 1e-5, x1 = (4.2552 - Tr * (7.674 - 3.4 * Tr)) * 1e-5;
  const xi = 2173.424 * Math.pow(c.Tc, 1 / 6) / Math.sqrt(c.MW) * Math.pow(c.Pc, -2 / 3);
  return (x0 + c.omega * x1) / xi;
}
/** Lewis–Squires: μ^−0.2661 = μk^−0.2661 + (T − Tk)/233, μ in cP */
function lewisSquires(muK, TK, T) { const v = Math.pow(muK / CP_UNIT, -0.2661) + (T - TK) / 233; return v > 0 ? Math.pow(v, -1 / 0.2661) * CP_UNIT : muK; }
/** pure saturated-liquid viscosity [Pa s] */
export function pureMuL(c, T, est) {
  // a user component's viscosity curve is itself an estimate unless a measured point anchored it
  if (c.mul && c.user && c.user.src && !/given point/.test(c.user.src.mul || '')) noteEst(est, 'μL ' + c.key + ' (' + (c.user.src.mul || 'estimated') + ')');
  if (c.mul) {
    const Tmax = num(c.mul[7]) ? c.mul[7] : T, Tmin = num(c.mul[6]) ? c.mul[6] : T;
    if (T <= Tmax) {
      const mu = tcorr(c.mul, Math.max(T, 0.8 * Tmin), c.Tc);
      if (mu > 0) return T < 0.8 * Tmin ? lewisSquires(mu, 0.8 * Tmin, T) : mu;
    } else {
      const muMax = tcorr(c.mul, Tmax, c.Tc);
      if (muMax > 0) {
        noteEst(est, 'μL ' + c.key + ' extrapolated (Letsou–Stiel)');
        if (Tmax >= 0.76 * c.Tc) return muMax * letsouStiel(c, T) / letsouStiel(c, Tmax);
        const T76 = 0.76 * c.Tc;
        if (T <= T76) return lewisSquires(muMax, Tmax, T);
        return lewisSquires(muMax, Tmax, T76) * letsouStiel(c, T) / letsouStiel(c, T76);
      }
    }
  }
  noteEst(est, 'μL ' + c.key + ' (Letsou–Stiel / Lewis–Squires)');
  const T76 = 0.76 * c.Tc;
  return T >= T76 ? letsouStiel(c, T) : lewisSquires(letsouStiel(c, T76), T76, T);
}
/** Chung et al. (1988) dilute-gas viscosity [Pa s] */
function chungMuV(c, T) {
  const Vc = c.vc * 1000;                                   // cm³/mol
  const dipD = num(c.dip) ? c.dip / 3.33564e-30 : 0;        // debye
  const mur = 131.3 * dipD / Math.sqrt(Vc * c.Tc);
  const Fc = 1 - 0.2756 * c.omega + 0.059035 * Math.pow(mur, 4);
  const Ts = 1.2593 * T / c.Tc;
  const Om = 1.16145 * Math.pow(Ts, -0.14874) + 0.52487 * Math.exp(-0.77320 * Ts) + 2.16178 * Math.exp(-2.43787 * Ts);
  return 40.785 * Fc * Math.sqrt(c.MW * T) / (Math.pow(Vc, 2 / 3) * Om) * 1e-7;
}
export function pureMuV(c, T, est) {
  if (c.muv) { const mu = tcorr(c.muv, T, c.Tc); if (mu > 0) return mu; }
  noteEst(est, 'μV ' + c.key + ' (Chung)');
  return chungMuV(c, T);
}
/** Chung et al. (1988) dilute-gas thermal conductivity [W/(m K)] */
function chungKV(c, T, muV) {
  const Cv = c._cp ? hIGcp(c, T) - R : 2.5 * R;
  const alpha = Cv / R - 1.5, beta = 0.7862 - 0.7109 * c.omega + 1.3168 * c.omega * c.omega, Z = 2 + 10.5 * (T / c.Tc) ** 2;
  const psi = 1 + alpha * ((0.215 + 0.28288 * alpha - 1.061 * beta + 0.26665 * Z) / (0.6366 + beta * Z + 1.061 * alpha * beta));
  return 3.75 * psi * R * muV / (c.MW * 1e-3);
}
function hIGcp(c, T) { const h = 0.05; return (c._cp.at(T + h)[0] - c._cp.at(T - h)[0]) / (2 * h); }
export function pureKV(c, T, est) {
  if (c.kv) { const k = tcorr(c.kv, T, c.Tc); if (k > 0) return k; }
  noteEst(est, 'kV ' + c.key + ' (Chung)');
  return chungKV(c, T, pureMuV(c, T));
}
/** Sato–Riedel liquid thermal conductivity [W/(m K)] */
function satoRiedel(c, T) {
  const Tb = num(c.tb) ? c.tb : 0.6 * c.Tc;
  const tr = Math.max(1 - T / c.Tc, 0), tb = Math.max(1 - Tb / c.Tc, 1e-6);
  return 1.1053 * (3 + 20 * Math.pow(tr, 2 / 3)) / Math.sqrt(c.MW) / (3 + 20 * Math.pow(tb, 2 / 3));
}
export function pureKL(c, T, est) {
  if (c.kl) {
    const Tmin = num(c.kl[6]) ? c.kl[6] : T, Tmax = num(c.kl[7]) ? c.kl[7] : T;
    const Tu = Math.min(Math.max(T, Tmin), Tmax);
    const k = tcorr(c.kl, Tu, c.Tc);
    if (k > 0) {
      if (T === Tu) return k;
      noteEst(est, 'kL ' + c.key + ' extrapolated (Sato–Riedel)');
      return k * satoRiedel(c, T) / satoRiedel(c, Tu);
    }
  }
  noteEst(est, 'kL ' + c.key + ' (Sato–Riedel)');
  return satoRiedel(c, T);
}
/** Brock–Bird surface tension [N/m] */
function brockBird(c, T) {
  if (T >= c.Tc) return 0;
  const Tb = num(c.tb) ? c.tb : 0.6 * c.Tc, Pc = c.Pc * 1e-5, Tbr = Tb / c.Tc;
  const Q = 0.1196 * (1 + Tbr * Math.log(Pc / 1.01325) / (1 - Tbr)) - 0.279;
  return Math.max(Math.pow(Pc, 2 / 3) * Math.pow(c.Tc, 1 / 3) * Q * Math.pow(1 - T / c.Tc, 11 / 9) * 1e-3, 0);
}
// Sastri & Rao (1995) for hydrogen-bonding liquids, where Brock–Bird fails
// (ethanol +50 %): σ = K Pc^x Tb^y Tc^z [(1 − Tr)/(1 − Tbr)]^m, Pc in bar, mN/m
// (Poling et al., 5th ed., Eq. 12-3.12). The class comes from the UNIFAC groups:
// aliphatic OH or methanol → alcohol constants, COOH / HCOOH → acid constants.
const SASTRI = { alcohol: [2.28, 0.25, 0.175, 0, 0.8], acid: [0.125, 0.5, -1.5, 1.85, 11 / 9] };
function sigmaClass(c) {
  if (c._sigClass !== undefined) return c._sigClass;
  const g = c.unifac || {};
  c._sigClass = g[42] || g[43] ? 'acid' : g[14] || g[15] ? 'alcohol' : null;
  return c._sigClass;
}
function sastriRao(c, T, cls) {
  if (T >= c.Tc || !num(c.tb)) return 0;
  const [K, x, y, z, m] = SASTRI[cls];
  return K * Math.pow(c.Pc * 1e-5, x) * Math.pow(c.tb, y) * Math.pow(c.Tc, z) * Math.pow((1 - T / c.Tc) / (1 - c.tb / c.Tc), m) * 1e-3;
}
function sigmaEst(c, T) {
  const cls = sigmaClass(c);
  if (cls && num(c.tb)) return { v: sastriRao(c, T, cls), m: 'Sastri–Rao, ' + cls };
  return { v: brockBird(c, T), m: 'Brock–Bird' };
}
export function pureSigma(c, T, est) {
  if (T >= c.Tc) return 0;
  if (c.st) {
    const Tmin = num(c.st[6]) ? c.st[6] : T, Tmax = num(c.st[7]) ? c.st[7] : T;
    const Tu = Math.min(Math.max(T, Tmin), Tmax);
    const v = tcorr(c.st, Tu, c.Tc);
    if (v > 0) {
      if (T === Tu) return v;
      const b0 = sigmaEst(c, Tu);
      if (b0.v > 0) { const b = sigmaEst(c, T); noteEst(est, 'σ ' + c.key + ' extrapolated (' + b.m + ')'); return v * b.v / b0.v; }
      return v;
    }
  }
  const e = sigmaEst(c, T);
  noteEst(est, 'σ ' + c.key + ' (' + e.m + ')');
  return Math.max(e.v, 0);
}
function kayPseudo(pp, x) {
  let Tc = 0, Pc = 0, Vc = 0, MW = 0, w = 0, Zc = 0, ok = true;
  for (let i = 0; i < pp.n; i++) if (x[i] > 0) {
    const c = pp.comps[i];
    if (!(c.vc > 0 && c.Tc > 0 && c.Pc > 0)) { ok = false; break; }
    Tc += x[i] * c.Tc; Pc += x[i] * c.Pc; Vc += x[i] * c.vc / 1000; MW += x[i] * c.MW; w += x[i] * c.omega;
    Zc += x[i] * (num(c.zc) ? c.zc : c.Pc * c.vc / 1000 / (R * c.Tc));
  }
  return ok ? { Tc, Pc, Vc, MW, w, Zc } : null;
}
function mixVisL(pp, T, x, P, est) {
  // STEP 38: a method's own solution viscosity first (brines: Laliberté); dilute aqueous
  // methods without one (sour water) take the viscosity of water
  if (pp.electrolyte && pp.electrolyte.viscosity) {
    try { const v = pp.electrolyte.viscosity(T, x); if (v > 0) return v; if (Number.isNaN(v)) return NaN; } catch (_e) { /* generic below */ }
  }
  if (pp.electrolyte && pp.electrolyte.waterTransport) { const v = pureMuL(component('H2O'), T, null); if (v > 0) return v; }
  let lnmu = 0, ps = 0;
  for (let i = 0; i < pp.n; i++) if (x[i] > 0) {
    const c = pp.comps[i];
    let mu = pureMuL(c, T, est);
    if (!(mu > 0)) mu = 1e-4;
    lnmu += x[i] * Math.log(mu);
    if (T < c.Tc) { try { ps += x[i] * psat(c, T); } catch (_e) { /* none */ } } else ps += x[i] * c.Pc;
  }
  let mu = Math.exp(lnmu);
  // Lucas (1981) compressed liquid, on Kay's-rule pseudo-critical constants
  const k = num(P) ? kayPseudo(pp, x) : null;
  if (k && P - ps > 5e5) {
    const Tr = Math.min(T / k.Tc, 1);
    const C = Tr * (Tr * (Tr * (Tr * (Tr * (Tr * (15.6719 * Tr - 59.8127) + 96.1209) - 84.8291) + 44.1706) - 13.404) + 2.1616) - 0.07921;
    const D = 0.3257 * Math.pow(1.0039 - Math.pow(Tr, 2.573), -0.2906) - 0.2086;
    const A = 0.9991 - 4.674e-4 / (1.0523 * Math.pow(Tr, -0.03877) - 1.0513);
    const dPr = (P - ps) / k.Pc;
    const f = (1 + D * Math.pow(dPr / 2.118, A)) / (1 + C * k.w * dPr);
    if (f > 0.5 && f < 5) mu *= f;
  }
  return mu;
}
function mixVisV(pp, T, y, V, est) {
  let num1 = 0, den = 0;
  for (let i = 0; i < pp.n; i++) if (y[i] > 0) {
    const c = pp.comps[i];
    let mu = pureMuV(c, T, est);
    if (!(mu > 0)) mu = 1.2e-5;
    const s = Math.sqrt(c.MW);
    num1 += y[i] * mu * s; den += y[i] * s;
  }
  const mu0 = num1 / den;
  // STEP 33 — dense-gas correction (Jossi, Stiel & Thodos 1962; Poling, Prausnitz & O'Connell,
  // 5th ed., §9-6) with Kay's-rule pseudo-criticals; the databank correlations are for the dilute
  // gas, about 9 % low for methane at 50 bar. Applied for ρr = Vc/V up to 3 (its validity range).
  if (!(V > 0)) return mu0;
  const k = kayPseudo(pp, y);
  if (!k) return mu0;
  const rr = Math.min(k.Vc / V, 3);
  if (!(rr > 0.01)) return mu0;
  // [(μ − μ°)ξ + 1]^¼ = 1.0230 + 0.23364 ρr + 0.58533 ρr² − 0.40758 ρr³ + 0.093324 ρr⁴,
  // μ in micropoise, ξ = Tc^(1/6) / (M^½ Pc^(2/3)) with Tc in K, Pc in atm
  const xi = Math.pow(k.Tc, 1 / 6) / (Math.sqrt(k.MW) * Math.pow(k.Pc / 101325, 2 / 3));
  const lhs = 1.0230 + 0.23364 * rr + 0.58533 * rr * rr - 0.40758 * rr ** 3 + 0.093324 * rr ** 4;
  const dmu = (Math.pow(lhs, 4) - 1) / xi;                                                 // μP
  return mu0 + Math.max(dmu, 0) * 1e-7;
}
function mixKV(pp, T, y, V, est) {
  const idx = [], ks = [], mus = [], Ms = [];
  for (let i = 0; i < pp.n; i++) if (y[i] > 0) {
    const c = pp.comps[i];
    idx.push(i); Ms.push(c.MW);
    let mu = pureMuV(c, T, est); if (!(mu > 0)) mu = 1.2e-5; mus.push(mu);
    let k = pureKV(c, T, est); if (!(k > 0)) k = 0.03; ks.push(k);
  }
  let k0 = 0;
  for (let a = 0; a < idx.length; a++) {
    let d = 0;
    for (let b = 0; b < idx.length; b++) {
      const phi = Math.pow(1 + Math.sqrt(mus[a] / mus[b]) * Math.pow(Ms[b] / Ms[a], 0.25), 2) / Math.sqrt(8 * (1 + Ms[a] / Ms[b]));
      d += y[idx[b]] * phi;
    }
    k0 += y[idx[a]] * ks[a] / d;
  }
  if (!(V > 0)) return k0;
  // Stiel–Thodos dense gas (Poling eq 10-5.x) on Kay's-rule pseudo-criticals
  const q = kayPseudo(pp, y);
  if (!q) return k0;
  const rr = Math.min(q.Vc / V, 2.8);
  if (!(rr > 0.01)) return k0;
  const gamma = 210 * Math.pow(q.Tc * q.MW ** 3 * Math.pow(q.Pc * 1e-5, -4), 1 / 6);
  const term = rr < 0.5 ? 1.22e-2 * (Math.exp(0.535 * rr) - 1) : rr < 2 ? 1.14e-2 * (Math.exp(0.67 * rr) - 1.069) : 2.60e-3 * (Math.exp(1.155 * rr) + 2.016);
  return k0 + term * Math.pow(q.Zc, -5) / gamma;
}
function mixKL(pp, T, x, est) {
  if (pp.electrolyte && pp.electrolyte.conductivity) { try { const k = pp.electrolyte.conductivity(T, x); if (k > 0) return k; } catch (_e) { /* generic below */ } }
  if (pp.electrolyte && pp.electrolyte.waterTransport) { const k = pureKL(component('H2O'), T, null); if (k > 0) return k; }
  // Li (1976): k = Σ Σ φi φj kij, kij = 2 / (1/ki + 1/kj), φ = x V / Σ x V
  // STEP 41: gases dissolved above their critical temperature (H2, N2, CH4 … in liquid ammonia) have no
  // liquid conductivity of their own; while they are dilute (< 10 mol %) the solvent carries the conduction
  let xsc = 0, xall = 0;
  for (let i = 0; i < pp.n; i++) if (x[i] > 0) { xall += x[i]; if (T > pp.comps[i].Tc) xsc += x[i]; }
  const skipSC = xsc > 0 && xsc < 0.1 * xall;
  const idx = [], ks = [], phi = [];
  let tot = 0;
  for (let i = 0; i < pp.n; i++) if (x[i] > 0) {
    const c = pp.comps[i];
    if (skipSC && T > c.Tc) continue;
    let k = pureKL(c, T, est); if (!(k > 0)) k = 0.15;
    const v = x[i] * vLiq(c, Math.min(T, 0.99 * c.Tc));
    idx.push(i); ks.push(k); phi.push(v); tot += v;
  }
  let k = 0;
  for (let a = 0; a < ks.length; a++) for (let b = 0; b < ks.length; b++) k += (phi[a] / tot) * (phi[b] / tot) * 2 / (1 / ks[a] + 1 / ks[b]);
  return k;
}
function mixSigma(pp, T, x, est) {
  // Winterfeld, Scriven & Davis (1978): σ = Σ Σ xi xj Vi Vj (σi σj)^½ / (Σ xi Vi)²
  let tot = 0;
  const v = [], sq = [];
  for (let i = 0; i < pp.n; i++) {
    if (!(x[i] > 0)) { v.push(0); sq.push(0); continue; }
    const c = pp.comps[i];
    const s = pureSigma(c, T, est);
    const vi = vLiq(c, Math.min(T, 0.99 * c.Tc));
    v.push(x[i] * vi); sq.push(Math.sqrt(Math.max(s, 0))); tot += x[i] * vi;
  }
  let a = 0;
  for (let i = 0; i < pp.n; i++) a += v[i] * sq[i];
  return (a / tot) ** 2;
}

/**
 * Phase and overall properties for reporting / equipment sizing.
 * @returns {{phases: Array, MW, rho_kgm3, H_Jmol, S_JmolK, Cp_JmolK}}
 */
export function properties(pp, r) {
  const phases = [];
  const add = (type, frac, comp) => {
    const est = [];
    const MW = comp.reduce((s, v, i) => s + v * pp.MW[i], 0);
    const V = pp.volPhase(r.T, r.P, comp, type);
    const h = pp.hPhase(r.T, r.P, comp, type);
    const sp = pp.steam ? pp.steam.phaseProps(r.T, r.P, type) : null;      // IAPWS caloric + transport
    const dT = 0.05;
    const cp = sp ? sp.cp : (pp.hPhase(r.T + dT, r.P, comp, type) - pp.hPhase(r.T - dT, r.P, comp, type)) / (2 * dT);
    let Z = r.P * V / (R * r.T);
    const ph = {
      type: type === 'V' ? 'vapour' : 'liquid', fraction: frac, x: comp,
      MW, rho_kgm3: MW / 1000 / V, Z, H_Jmol: h, Cp_JmolK: cp,
      mu_Pas: sp ? sp.mu : type === 'V' ? mixVisV(pp, r.T, comp, V, est) : mixVisL(pp, r.T, comp, r.P, est),
      k_WmK: sp ? sp.k : type === 'V' ? mixKV(pp, r.T, comp, V, est) : mixKL(pp, r.T, comp, est),
    };
    if (sp && num(sp.sigma)) ph.sigma_Nm = sp.sigma;
    else if (!sp && type !== 'V' && pp.electrolyte && (pp.electrolyte.waterTransport || pp.electrolyte.sigma)) {
      try { const sg = pp.electrolyte.sigma ? pp.electrolyte.sigma(r.T, comp) : pureSigma(component('H2O'), r.T, null); if (sg >= 0 && Number.isFinite(sg)) ph.sigma_Nm = sg; } catch (_e) { /* none */ }
    } else if (!sp && type !== 'V' && !(pp.electrolyte && pp.electrolyte.urea)) { try { const sg = mixSigma(pp, r.T, comp, est); if (sg >= 0 && Number.isFinite(sg)) ph.sigma_Nm = sg; } catch (_e) { /* none */ } }
    if (est.length) ph.estimated = est.slice(0, 12);
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
  createPackage, rachfordRice, rachfordRice3, flashPT, flashPT3, flashPH, flashPH3, flashPS, flashPS3, flashPVF, flashPVF3, flashTVF,
  hOf, sOf, properties, lnKhG704, BIP_EXTRA_USED, BIP_SRK: bipSRK, unifacGroups,
  pureMuL, pureMuV, pureKV, pureKL, pureSigma, fitPairFromUNIFAC, liquidSplit, lkpKijTable,
};
