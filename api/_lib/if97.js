// ============================================================================
// REPO PATH: api/_lib/if97.js
// ============================================================================
// multicalci.com — Material Balance Calculator: water/steam property adapter.
//
// Keeps the small API the material-balance engine (mb-engine.js) and the urea
// units (mb-urea.js) were written against, but evaluates it with the full
// IAPWS-IF97 formulation in ./steam-if97.js (regions 1, 2, 3, 4 and 5). The
// earlier version of this file interpolated a 53-point saturation table and a
// 13-pressure superheat table (a port of the old api/steam-calcs.py tables):
// it was out by up to 65 kJ/kg below 1 bar and by 15–40 kJ/kg at 100–150 bar.
//
// EXPORTS (base-SI per spec):
//   h_kJkg(T_K, P_bar)   → specific enthalpy [kJ/kg]
//   s_kJkgK(T_K, P_bar)  → specific entropy  [kJ/kg·K]
//   tsat_K(P_bar)        → saturation temperature [K]   (P clamped to 0.00611–220.64 bar)
//   psat_bar(T_K)        → saturation pressure [bar]    (T clamped to 0.01–373.946 °C)
//   hf_hg(P_bar)         → { hf, hg } saturated liquid/vapour enthalpy [kJ/kg]
//   region(T_K, P_bar)   → 1 liquid / 2 vapour / 4 within 0.05 K of saturation /
//                          0 outside the saturation range (T ≥ T_c or P outside
//                          0.00611–220.64 bar) — the engine's phase routing
//   selfTest()           → { pass, maxAbsDev, results[] }
//
// Reference state: IAPWS convention — u = s = 0 for saturated liquid at the
// triple point. mb-engine maps this to the formation basis via
//   h_water = hf_liq_298 + [ h_if97(T,P) − h_if97(298.15 K, Psat) ].
//
// Plain ES module. (c) multicalci.com
// ============================================================================

'use strict';

import steam from './steam-if97.js';

const TC = steam.TC;
const PMIN_BAR = steam.PMIN * 10;
const PC_BAR = steam.PC * 10;
const BAND = 0.05;          // K — saturation band used by region()

const clampP = (P_bar) => Math.min(Math.max(P_bar, PMIN_BAR), PC_BAR);
const clampT = (T_K) => Math.min(Math.max(T_K, 273.15), TC);

/**
 * Single-phase state at (T, P). Below the critical pressure a point within 0.05 K
 * above saturation is still taken as liquid (the engine's saturation band), so the
 * liquid branch is used up to Tsat + 0.05 K.
 * @returns {{h:number, s:number, v:number, phase:('gas'|'liquid')}}
 */
function _statePT(T_K, P_bar) {
  const p = P_bar / 10;
  if (p < steam.PC && T_K <= 623.15) {
    const Ts = steam.tsat(clampP(P_bar) / 10);
    if (T_K <= Ts + BAND) {
      const st = steam.region1(Math.max(T_K, 273.15), p);
      return { h: st.h, s: st.s, v: st.v, phase: 'liquid' };
    }
  }
  const st = steam.pt(p, Math.max(T_K, 273.15));
  return { h: st.h, s: st.s, v: st.v, phase: st.phase === 'liquid' ? 'liquid' : 'gas' };
}

/** Specific enthalpy of water/steam [kJ/kg] at T [K], P [bar]. */
function h_kJkg(T_K, P_bar) { return _statePT(T_K, P_bar).h; }

/** Specific entropy of water/steam [kJ/(kg·K)] at T [K], P [bar]. */
function s_kJkgK(T_K, P_bar) { return _statePT(T_K, P_bar).s; }

/** Saturation temperature [K] at P [bar]. */
function tsat_K(P_bar) { return steam.tsat(clampP(P_bar) / 10); }

/** Saturation pressure [bar] at T [K]. */
function psat_bar(T_K) { return steam.psat(clampT(T_K)) * 10; }

/** Saturated liquid / vapour enthalpy [kJ/kg] at P [bar]. */
function hf_hg(P_bar) {
  const sat = steam.satP(clampP(P_bar) / 10);
  return { hf: sat.liq.h, hg: sat.vap.h };
}

/** Phase region for the engine's routing (see header). */
function region(T_K, P_bar) {
  if (T_K >= TC) return 0;
  if (P_bar < PMIN_BAR || P_bar > PC_BAR) return 0;
  const Ts = steam.tsat(P_bar / 10);
  if (T_K > Ts + BAND) return 2;
  if (T_K < Ts - BAND) return 1;
  return 4;
}

/** Saturation row [P_bar, T_C, hf, hg, sf, sg, vf, vg] at P [bar] (debugging / reuse). */
function _satByP(P_bar) {
  const s = steam.satP(clampP(P_bar) / 10);
  return [s.p * 10, s.T - 273.15, s.liq.h, s.vap.h, s.liq.s, s.vap.s, s.liq.v, s.vap.v];
}
/** Saturation row [P_bar, T_C, hf, hg, sf, sg, vf, vg] at T [°C] (debugging / reuse). */
function _satByT(T_C) {
  const s = steam.satT(clampT(T_C + 273.15));
  return [s.p * 10, s.T - 273.15, s.liq.h, s.vap.h, s.liq.s, s.vap.s, s.liq.v, s.vap.v];
}

// ---------------------------------------------------------------------------
// CHECK VALUES — the same calls as before, with expected values from the
// independent iapws library (IAPWS-IF97, Python). Acceptance |dev| < 0.001.
// ---------------------------------------------------------------------------
const REGRESSION = [
  { call: 'h_kJkg', args: [298.15, 10.0], region: 1, expect: 105.761282, desc: '25C/10bar liq' },
  { call: 's_kJkgK', args: [298.15, 10.0], region: 1, expect: 0.366999, desc: '25C/10bar liq' },
  { call: 'h_kJkg', args: [298.15, 1.0], region: 1, expect: 104.928068, desc: '25C/1bar liq' },
  { call: 'h_kJkg', args: [373.15, 10.0], region: 1, expect: 419.774152, desc: '100C/10bar liq' },
  { call: 'h_kJkg', args: [423.15, 50.0], region: 1, expect: 635.055399, desc: '150C/50bar liq' },
  { call: 'h_kJkg', args: [298.15, 100.0], region: 1, expect: 114.059852, desc: '25C/100bar liq' },
  { call: 'h_kJkg', args: [573.15, 10.0], region: 2, expect: 3051.703186, desc: '300C/10bar sh' },
  { call: 's_kJkgK', args: [573.15, 10.0], region: 2, expect: 7.124712, desc: '300C/10bar sh' },
  { call: 'h_kJkg', args: [673.15, 40.0], region: 2, expect: 3214.373509, desc: '400C/40bar sh' },
  { call: 'h_kJkg', args: [773.15, 100.0], region: 2, expect: 3375.058442, desc: '500C/100bar sh' },
  { call: 's_kJkgK', args: [773.15, 100.0], region: 2, expect: 6.599323, desc: '500C/100bar sh' },
  { call: 'h_kJkg', args: [873.15, 1.0], region: 2, expect: 3705.57149, desc: '600C/1bar sh' },
  { call: 'h_kJkg', args: [333.15, 0.1], region: 2, expect: 2611.177967, desc: '60C/0.1bar sh' },
  { call: 'tsat_K', args: [1.0], region: 4, expect: 372.755919, desc: 'tsat 1 bar' },
  { call: 'tsat_K', args: [10.0], region: 4, expect: 453.035632, desc: 'tsat 10 bar' },
  { call: 'tsat_K', args: [100.0], region: 4, expect: 584.149488, desc: 'tsat 100 bar' },
  { call: 'psat_bar', args: [373.15], region: 4, expect: 1.01418, desc: 'psat 373.15 K' },
  { call: 'psat_bar', args: [573.15], region: 4, expect: 85.877083, desc: 'psat 573.15 K' },
  { call: 'hf_hg.hf', args: [10.0], region: 4, expect: 762.682844, desc: 'hf 10 bar' },
  { call: 'hf_hg.hg', args: [10.0], region: 4, expect: 2777.119538, desc: 'hg 10 bar' },
  { call: 'hf_hg.hf', args: [50.0], region: 4, expect: 1154.502042, desc: 'hf 50 bar' },
  { call: 'hf_hg.hg', args: [50.0], region: 4, expect: 2794.227066, desc: 'hg 50 bar' },
];

function _invoke(row) {
  switch (row.call) {
    case 'h_kJkg': return h_kJkg(row.args[0], row.args[1]);
    case 's_kJkgK': return s_kJkgK(row.args[0], row.args[1]);
    case 'tsat_K': return tsat_K(row.args[0]);
    case 'psat_bar': return psat_bar(row.args[0]);
    case 'hf_hg.hf': return hf_hg(row.args[0]).hf;
    case 'hf_hg.hg': return hf_hg(row.args[0]).hg;
    default: throw new Error('IF97_SELFTEST: unknown call ' + row.call);
  }
}

/** Recompute the check values; also runs the formulation's own verification table. */
function selfTest() {
  const TOL = 0.001;
  let maxAbsDev = 0;
  const results = REGRESSION.map((row) => {
    let actual, dev, ok;
    try {
      actual = _invoke(row);
      dev = Math.abs(actual - row.expect);
      ok = isFinite(dev) && dev < TOL;
    } catch (err) { actual = NaN; dev = NaN; ok = false; }
    if (isFinite(dev) && dev > maxAbsDev) maxAbsDev = dev;
    return { desc: row.desc, region: row.region, call: row.call, expect: row.expect, actual, dev, ok };
  });
  const formulation = steam.selfTest();
  return { pass: results.every((r) => r.ok) && formulation.pass, maxAbsDev, results, formulation: { pass: formulation.pass, worstRel: formulation.worst } };
}

export default {
  h_kJkg,
  s_kJkgK,
  tsat_K,
  psat_bar,
  hf_hg,
  region,
  selfTest,
  _satByP,
  _satByT,
};
