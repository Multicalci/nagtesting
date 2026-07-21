// ============================================================================
// REPO PATH: api/_lib/mb-engine.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — STEPS 8+11+12+13
// PARTS 1+2+3+4+5 — THERMO CORE + THIRTEEN MODULE SOLVERS (MODULES{...}):
// mixer, splitter, flash, heat-exchanger, rotating, reactor (Part 2);
// cstr, pfr, pfr-recycle (Part 3 — liquid-basis reaction engineering);
// smr, atr (Part 4 — steam / autothermal reforming equilibria);
//   shift, methanator (Part 5 — WGS converter + trace CO/CO2 clean-up).
//
// FORMATION-ENTHALPY BASIS: every enthalpy returned here includes the
// standard enthalpy of formation at 298.15 K, so any module's duty is
// Q = Hout − Hin and reaction heat is implicit. Base SI internally:
// kg/h, K, bar(a), kJ/h; molar enthalpies in kJ/mol; Cp gas in J/mol·K.
//
// ROUTING RULES (per spec / project report):
//   gas     : NIST Shomate closed form where present, else Smith-Van Ness
//             Cp/R polynomial integral; + PR enthalpy departure (eos.js)
//             when opts.P_bar > 30 and the point is a gas.
//   liquid  : hf_liq_298 + cp_liq·(T−298.15) when both known,
//             else h_gas(T) − ΔHvap(T) (Watson, 0.38 exp, clamp 0.98·Tc,
//             Trouton fallback when dhvap_tb is null).
//   solid   : hf_sol_298 + cp_sol·(T−298.15); fallback hf_liq − dhfus.
//   water   : if97.js ALWAYS, mapped onto the formation basis:
//             h = hf_liq_298 + [h_if97(T,P) − h_if97(298.15, Psat(298.15))].
//             Above the IF97 superheat-table ceiling (1073.15 K) steam
//             continues on the NIST Shomate gas curve from the ceiling
//             value (continuous by construction — combustion/reformer
//             range; also fixes the flat-h defect where if97.region()
//             reported 0 above ~650 K at low P).
//   phase   : override > nonvolatile(Tm split) > T≥Tc gas > T<Tm solid >
//             Psat (Antoine in range, else Clausius-Clapeyron) vs P.
//
// ERROR CONVENTION: public functions NEVER throw. Failures return
// {error:{code,message,field}}; success objects carry no `error` key and
// include `warnings` (string[]) plus convergence flags where iterative.
//
// Plain ES2020 / CommonJS. Depends only on sibling _lib modules.
// (c) multicalci.com
// ============================================================================

'use strict';

import fluids from './fluids.js';
import mbData from './mb-data.js';
import if97 from './if97.js';
import eos from './eos.js';

const ENGINE_VERSION = 'mb-engine 0.9.0 (parts 1+2+3+4+5 — thermo core + core modules + cstr/pfr/pfr-recycle + smr/atr + shift/methanator)';

const T_REF = 298.15;          // K — formation-basis reference
const R_J = 8.314462;          // J/(mol·K)
const R_KJ = 0.008314462;      // kJ/(mol·K)
const P_ATM = 1.01325;         // bar
const TROUTON = 0.088;         // kJ/(mol·K): dHvap(Tb) ≈ 0.088·Tb
const PR_P_THRESHOLD = 30;     // bar — departure applied above this
const WATSON_EXP = 0.38;
const WATSON_TCLAMP = 0.98;    // clamp T to 0.98·Tc inside Watson
const IF97_SUPERHEAT_TMAX = 1073.15; // K — if97.js superheat-table ceiling;
                                     // above it steam continues on Shomate

// ---------------------------------------------------------------------------
// error / warning helpers
// ---------------------------------------------------------------------------

/**
 * Build the spec-standard error envelope.
 * @param {string} code machine code, e.g. 'MB_UNKNOWN_KEY'
 * @param {string} message human message
 * @param {string} [field] offending input field
 * @returns {{error:{code:string,message:string,field:(string|undefined)}}}
 */
function errObj(code, message, field) {
  return { error: { code, message, field } };
}

/** @param {*} x @returns {boolean} true when x is a finite number */
function num(x) { return typeof x === 'number' && isFinite(x); }

// ---------------------------------------------------------------------------
// record resolution — fluids.js (physicals) merged with mb-data.js
// (calorics + supplements for keys fluids.js lacks)
// ---------------------------------------------------------------------------

/**
 * Resolve a component key to one merged record: fluids.js physicals as the
 * base, mb-data supplement filling keys fluids.js lacks, caloric fields
 * overlaid. Unknown in both layers → error.
 * @param {string} key
 * @returns {object|{error:object}} merged record or error envelope
 */
function resolve(key) {
  if (typeof key !== 'string' || !key) {
    return errObj('MB_KEY', 'component key must be a non-empty string', 'key');
  }
  const phys = fluids.get(key);
  const cal = mbData.get(key);
  if (!phys && !cal) {
    return errObj('MB_UNKNOWN_KEY', `unknown component key '${key}'`, 'key');
  }
  const base = Object.assign(
    { key, mw: null, tb_K: null, tm_K: null, tc_K: null, pc_bar: null,
      omega: null, antoine: null, nonvolatile: false },
    phys || {},
    (cal && cal.supplement) || {},
  );
  const merged = Object.assign(base, {
    hf_gas_298: cal ? cal.hf_gas_298 : null,
    hf_liq_298: cal ? cal.hf_liq_298 : null,
    hf_sol_298: cal ? cal.hf_sol_298 : null,
    shomate: cal ? cal.shomate : null,
    cp_svn: cal ? cal.cp_svn : null,
    cp_liq_kjkgk: cal ? cal.cp_liq_kjkgk : null,
    cp_sol_kjkgk: cal ? cal.cp_sol_kjkgk : null,
    dhvap_tb: cal ? cal.dhvap_tb : null,
    dhvap_ref_K: cal ? (cal.dhvap_ref_K || null) : null,
    dhfus: cal ? cal.dhfus : null,
    caloric_quality: cal ? cal.data_quality : null,
  });
  if (cal && cal.nonvolatile) merged.nonvolatile = true;
  if (!num(merged.mw) || merged.mw <= 0) {
    return errObj('MB_NO_MW', `component '${key}' has no molecular weight`, 'key');
  }
  return merged;
}

// ---------------------------------------------------------------------------
// gas-phase Cp / H — Shomate closed form or SVN polynomial
// ---------------------------------------------------------------------------

/**
 * Pick the Shomate range containing T; clamp to the nearest range edge when
 * outside coverage (clamped flag returned — callers add a warning).
 * @param {Array<object>} ranges mb-data shomate array
 * @param {number} T_K
 * @returns {{r:object, T_eval:number, clamped:boolean}}
 */
function shomatePick(ranges, T_K) {
  for (const r of ranges) {
    if (T_K >= r.tmin && T_K <= r.tmax) return { r, T_eval: T_K, clamped: false };
  }
  let best = ranges[0];
  let bestDist = Infinity;
  for (const r of ranges) {
    const d = T_K < r.tmin ? r.tmin - T_K : T_K - r.tmax;
    if (d < bestDist) { bestDist = d; best = r; }
  }
  const T_eval = Math.min(Math.max(T_K, best.tmin), best.tmax);
  return { r: best, T_eval, clamped: true };
}

/** Shomate Cp [J/mol·K] at T within range r. */
function shomateCp(r, T_K) {
  const t = T_K / 1000;
  return r.A + r.B * t + r.C * t * t + r.D * t * t * t + r.E / (t * t);
}

/** Shomate H(T)−H(298.15) [kJ/mol] within range r (NIST closed form). */
function shomateDH(r, T_K) {
  const t = T_K / 1000;
  return r.A * t + r.B * t * t / 2 + r.C * t * t * t / 3 +
    r.D * t * t * t * t / 4 - r.E / t + r.F - r.H;
}

/**
 * Shomate ΔH between two temperatures [kJ/mol]: DH(T2) − DH(T1), each on the
 * H(T)−H(298.15) closed form with its own containing range (NIST F/H
 * constants make per-range deltas mutually consistent, so a span may cross a
 * range boundary).
 * @param {Array<object>} ranges mb-data shomate array
 * @param {number} T1_K
 * @param {number} T2_K
 * @returns {number} kJ/mol
 */
function shomateSpanDH(ranges, T1_K, T2_K) {
  const p1 = shomatePick(ranges, T1_K);
  const p2 = shomatePick(ranges, T2_K);
  return shomateDH(p2.r, p2.T_eval) - shomateDH(p1.r, p1.T_eval);
}

/** SVN Cp_ig/R polynomial → Cp [J/mol·K]. c = [A,B,C,D] true magnitudes. */
function svnCp(c, T_K) {
  return R_J * (c[0] + c[1] * T_K + c[2] * T_K * T_K + c[3] / (T_K * T_K));
}

/** SVN ∫Cp dT from 298.15 → T [kJ/mol]. */
function svnDH(c, T_K) {
  const T0 = T_REF;
  const I = c[0] * (T_K - T0) +
    c[1] / 2 * (T_K * T_K - T0 * T0) +
    c[2] / 3 * (T_K * T_K * T_K - T0 * T0 * T0) -
    c[3] * (1 / T_K - 1 / T0);
  return R_KJ * I;
}

/**
 * Ideal-gas heat capacity at T.
 * @param {string} key component key
 * @param {number} T_K temperature [K]
 * @returns {{cp_J_molK:number, method:('shomate'|'svn'), warnings:string[]}
 *           |{error:object}}
 */
function cpGas(key, T_K) {
  const rec = resolve(key);
  if (rec.error) return rec;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  const warnings = [];
  if (rec.shomate && rec.shomate.length) {
    const { r, T_eval, clamped } = shomatePick(rec.shomate, T_K);
    if (clamped) warnings.push(`cpGas(${key}): T ${T_K.toFixed(1)} K outside Shomate coverage — clamped to ${T_eval.toFixed(1)} K`);
    return { cp_J_molK: shomateCp(r, T_eval), method: 'shomate', warnings };
  }
  if (rec.cp_svn) {
    if (T_K < 250 || T_K > 1500) warnings.push(`cpGas(${key}): T ${T_K.toFixed(1)} K outside SVN validity ≈298–1500 K`);
    return { cp_J_molK: svnCp(rec.cp_svn, T_K), method: 'svn', warnings };
  }
  return errObj('MB_NO_GAS_CP', `component '${key}' has no gas Cp data (Shomate/SVN)`, 'key');
}

/**
 * Gas-phase molar enthalpy on the FORMATION basis [kJ/mol]:
 *   h = hf_gas_298 + [H(T) − H(298.15)]_ideal (+ PR departure at high P).
 * Water is redirected to the IF97 route for consistency with streams.
 * @param {string} key
 * @param {number} T_K
 * @param {{P_bar?:number}} [opts] departure applied when P_bar > 30
 * @returns {{h_kJmol:number, method:string, hDep_kJmol:number,
 *            warnings:string[]}|{error:object}}
 */
function hGasMolar(key, T_K, opts) {
  const o = opts || {};
  if (key === 'H2O') return waterMolarH(T_K, num(o.P_bar) ? o.P_bar : P_ATM, 'gas');
  const rec = resolve(key);
  if (rec.error) return rec;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  if (rec.hf_gas_298 == null) {
    return errObj('MB_NO_HF_GAS', `component '${key}' has no gas-phase Hf (likely nonvolatile solid)`, 'key');
  }
  const warnings = [];
  let dH;
  let method;
  if (rec.shomate && rec.shomate.length) {
    const { r, T_eval, clamped } = shomatePick(rec.shomate, T_K);
    if (clamped) {
      warnings.push(`hGasMolar(${key}): T ${T_K.toFixed(1)} K outside Shomate coverage — linear Cp extrapolation from ${T_eval.toFixed(1)} K`);
      dH = shomateDH(r, T_eval) + shomateCp(r, T_eval) * (T_K - T_eval) / 1000;
    } else {
      dH = shomateDH(r, T_K);
    }
    method = 'shomate';
  } else if (rec.cp_svn) {
    if (T_K < 250 || T_K > 1500) warnings.push(`hGasMolar(${key}): T ${T_K.toFixed(1)} K outside SVN validity ≈298–1500 K`);
    dH = svnDH(rec.cp_svn, T_K);
    method = 'svn';
  } else {
    return errObj('MB_NO_GAS_CP', `component '${key}' has no gas Cp data`, 'key');
  }
  let hDep = 0;
  if (num(o.P_bar) && o.P_bar > PR_P_THRESHOLD) {
    if (num(rec.tc_K) && num(rec.pc_bar)) {
      try {
        const dep = eos.hDeparture({ T_K, P_bar: o.P_bar, comps: [{
          key: rec.key, tc_K: rec.tc_K, pc_bar: rec.pc_bar,
          omega: num(rec.omega) ? rec.omega : 0, y: 1 }] });
        hDep = dep.hDep_kJmol;
        method += '+pr_departure';
      } catch (e) {
        warnings.push(`hGasMolar(${key}): PR departure failed (${e.message}) — ideal-gas value used`);
      }
    } else {
      warnings.push(`hGasMolar(${key}): P ${o.P_bar} bar > ${PR_P_THRESHOLD} but no Tc/Pc — ideal-gas value used`);
    }
  }
  return { h_kJmol: rec.hf_gas_298 + dH + hDep, method, hDep_kJmol: hDep, warnings };
}

// ---------------------------------------------------------------------------
// latent heat — Watson correlation
// ---------------------------------------------------------------------------

/**
 * ΔHvap(T) by Watson: dhvap_tb·[(Tc−T)/(Tc−Tref)]^0.38, Tref = dhvap_ref_K
 * or tb_K; T clamped to 0.98·Tc. Trouton (0.088·Tb) when dhvap_tb is null;
 * constant anchor value when Tc is unknown.
 * @param {string} key
 * @param {number} T_K
 * @returns {{dhvap_kJmol:number, method:string, warnings:string[]}
 *           |{error:object}}
 */
function dhvapT(key, T_K) {
  const rec = resolve(key);
  if (rec.error) return rec;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  const warnings = [];
  let anchor = rec.dhvap_tb;
  let method = 'watson';
  if (!num(anchor)) {
    if (!num(rec.tb_K)) {
      return errObj('MB_NO_DHVAP', `component '${key}' has neither dhvap_tb nor tb_K — cannot estimate latent heat`, 'key');
    }
    anchor = TROUTON * rec.tb_K;
    method = 'watson_trouton';
    warnings.push(`dhvapT(${key}): dhvap_tb missing — Trouton estimate ${anchor.toFixed(2)} kJ/mol used`);
  }
  const Tref = num(rec.dhvap_ref_K) ? rec.dhvap_ref_K : rec.tb_K;
  if (!num(rec.tc_K) || !num(Tref)) {
    warnings.push(`dhvapT(${key}): missing Tc or anchor T — constant ΔHvap returned`);
    return { dhvap_kJmol: anchor, method: method + '_constant', warnings };
  }
  const Tc = rec.tc_K;
  const Tuse = Math.min(T_K, WATSON_TCLAMP * Tc);
  if (Tuse < T_K) warnings.push(`dhvapT(${key}): T clamped to 0.98·Tc = ${(WATSON_TCLAMP * Tc).toFixed(1)} K`);
  const ratio = (Tc - Tuse) / (Tc - Tref);
  if (ratio <= 0) {
    return { dhvap_kJmol: 0, method: method + '_supercritical', warnings };
  }
  return { dhvap_kJmol: anchor * Math.pow(ratio, WATSON_EXP), method, warnings };
}

// ---------------------------------------------------------------------------
// liquid / solid molar enthalpy — formation basis
// ---------------------------------------------------------------------------

/**
 * Liquid molar enthalpy [kJ/mol], formation basis. Priority:
 *   1. water → IF97 route;
 *   2. hf_liq_298 + cp_liq·MW·(T−298.15) when both present;
 *   3. h_gas_ideal(T) − ΔHvap(T)  (Watson).
 * @param {string} key
 * @param {number} T_K
 * @param {{P_bar?:number}} [opts] (P only used on the water/IF97 route)
 * @returns {{h_kJmol:number, method:string, warnings:string[]}
 *           |{error:object}}
 */
function hLiqMolar(key, T_K, opts) {
  const o = opts || {};
  if (key === 'H2O') return waterMolarH(T_K, num(o.P_bar) ? o.P_bar : P_ATM, 'liquid');
  const rec = resolve(key);
  if (rec.error) return rec;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  if (rec.hf_liq_298 != null && num(rec.cp_liq_kjkgk)) {
    const h = rec.hf_liq_298 + rec.cp_liq_kjkgk * rec.mw / 1000 * (T_K - T_REF);
    return { h_kJmol: h, method: 'hf_liq+cp', warnings: [] };
  }
  // fallback: gas − Watson latent (ideal-gas branch — no departure)
  const g = hGasMolar(key, T_K, {});
  if (g.error) {
    return errObj('MB_NO_LIQ_PATH', `component '${key}': no hf_liq+cp_liq and gas branch failed (${g.error.message})`, 'key');
  }
  const v = dhvapT(key, T_K);
  if (v.error) return v;
  const warnings = g.warnings.concat(v.warnings);
  warnings.push(`hLiqMolar(${key}): via h_gas − Watson ΔHvap (no direct liquid data)`);
  return { h_kJmol: g.h_kJmol - v.dhvap_kJmol, method: 'gas_minus_watson', warnings };
}

/**
 * Solid molar enthalpy [kJ/mol], formation basis:
 *   hf_sol_298 + cp_sol·MW·(T−298.15); fallback (hf_liq−dhfus) + cp_sol path.
 * Water/ice is handled inside waterMolarH.
 * @param {string} key
 * @param {number} T_K
 * @returns {{h_kJmol:number, method:string, warnings:string[]}
 *           |{error:object}}
 */
function hSolMolar(key, T_K) {
  if (key === 'H2O') return waterMolarH(T_K, P_ATM, 'solid');
  const rec = resolve(key);
  if (rec.error) return rec;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  const warnings = [];
  let hf = rec.hf_sol_298;
  let method = 'hf_sol+cp';
  if (hf == null) {
    if (rec.hf_liq_298 != null && num(rec.dhfus)) {
      hf = rec.hf_liq_298 - rec.dhfus;
      method = 'hf_liq_minus_dhfus+cp';
      warnings.push(`hSolMolar(${key}): hf_sol estimated as hf_liq − dhfus`);
    } else {
      return errObj('MB_NO_SOL_PATH', `component '${key}' has no solid-phase enthalpy data`, 'key');
    }
  }
  const cp = num(rec.cp_sol_kjkgk) ? rec.cp_sol_kjkgk : 1.0;
  if (!num(rec.cp_sol_kjkgk)) warnings.push(`hSolMolar(${key}): cp_sol missing — 1.0 kJ/kg·K assumed`);
  return { h_kJmol: hf + cp * rec.mw / 1000 * (T_K - T_REF), method, warnings };
}

// ---------------------------------------------------------------------------
// WATER — IF97 mapped onto the formation basis (spec-mandated route):
//   h(T,P) = hf_liq_298 + [h_if97(T,P) − h_if97(298.15, Psat(298.15))] · MW
// ---------------------------------------------------------------------------

let _waterAnchor = null; // kJ/kg — IF97 h at (298.15 K, Psat) — lazy, cached

/** @returns {number} IF97 anchor enthalpy at 298.15 K sat. liquid [kJ/kg] */
function waterAnchor() {
  if (_waterAnchor == null) {
    const psat25 = if97.psat_bar(T_REF);            // ≈ 0.0317 bar
    _waterAnchor = if97.hf_hg(Math.max(psat25, 0.032)).hf; // sat-liq h ≈ 104.9
  }
  return _waterAnchor;
}

/**
 * Water/steam molar enthalpy on the formation basis via IF97 [kJ/mol].
 * Handles compressed liquid, superheated steam, low-pressure vapor below
 * the table floor (saturated-vapor-at-T approximation) and an estimated
 * ice branch below 273.15 K.
 * @param {number} T_K
 * @param {number} P_bar
 * @param {('gas'|'liquid'|'solid'|null)} [phaseHint]
 * @returns {{h_kJmol:number, method:string, phase:string,
 *            warnings:string[]}|{error:object}}
 */
function waterMolarH(T_K, P_bar, phaseHint) {
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  if (!num(P_bar) || P_bar <= 0) return errObj('MB_P', 'P_bar must be positive', 'P_bar');
  const w = resolve('H2O');
  if (w.error) return w;
  const mwkg = w.mw / 1000; // kg/mol
  const warnings = [];

  // estimated ice branch
  if (T_K < 273.15 || phaseHint === 'solid') {
    const cpIce = num(w.cp_sol_kjkgk) ? w.cp_sol_kjkgk : 2.09;
    // sat. liquid at 273.16 K relative to the 298.15 K anchor: IF97 sets
    // hf(0.01 °C) = 0 by definition, so the delta is simply −anchor.
    const hLiq0 = 0.0 - waterAnchor();
    const h = w.hf_liq_298 + hLiq0 * mwkg - w.dhfus +
      cpIce * mwkg * (T_K - 273.15);
    warnings.push('waterMolarH: T < 273.15 K — estimated ice branch (hf_liq − ΔHfus + cp_ice)');
    return { h_kJmol: h, method: 'if97_ice_estimate', phase: 'solid', warnings };
  }

  let h_kJkg;
  let phase;
  let method = 'if97';
  const reg = if97.region(T_K, P_bar);
  try {
    // if97.region() reports 0 above its declared envelope even where the
    // superheat table still interpolates cleanly (e.g. 800 K / 1 bar), so
    // gas-side routing is decided against Tsat(P) rather than the raw
    // region code. Above the superheat-table ceiling (1073.15 K) steam
    // continues on the NIST Shomate gas curve — continuous by construction
    // and needed for combustion / reformer temperatures.
    let tsat = null;
    try {
      tsat = if97.tsat_K(Math.min(Math.max(P_bar, 0.00612), 220.64));
    } catch (e2) { tsat = null; }
    const gasByState = T_K >= 647.1 || reg === 2 ||
      (reg === 0 && tsat != null && T_K > tsat);
    const wantsGas = phaseHint === 'gas' || (!phaseHint && gasByState);

    if (wantsGas && gasByState && T_K > IF97_SUPERHEAT_TMAX && w.shomate) {
      const hCeil = if97.h_kJkg(IF97_SUPERHEAT_TMAX, P_bar);
      const dH = shomateSpanDH(w.shomate, IF97_SUPERHEAT_TMAX, T_K); // kJ/mol
      h_kJkg = hCeil + dH / mwkg;
      phase = 'gas';
      method = 'if97+shomate_highT';
    } else if (wantsGas && gasByState) {
      h_kJkg = if97.h_kJkg(T_K, P_bar);
      phase = 'gas';
      if (reg === 0) method = 'if97_superheat_table';
      if (T_K > IF97_SUPERHEAT_TMAX) {
        warnings.push(`waterMolarH: T ${T_K.toFixed(1)} K above the IF97 table ceiling and no H2O Shomate data — ceiling value used`);
      }
    } else if (phaseHint === 'gas' && !gasByState) {
      // vapor requested but the (T,P) point sits in the liquid field or
      // below the table floor: approximate as saturated vapor at T (water
      // vapor enthalpy is nearly P-independent at low P).
      const psat = if97.psat_bar(Math.min(T_K, 647.0));
      h_kJkg = if97.hf_hg(Math.max(psat, 0.032)).hg;
      phase = 'gas';
      method = 'if97_satvap_at_T';
      warnings.push(`waterMolarH: gas at ${T_K.toFixed(1)} K/${P_bar} bar below saturation — saturated-vapor-at-T approximation`);
    } else if (phaseHint === 'liquid' && reg === 2) {
      // liquid requested but the (T,P) point is (slightly) superheated —
      // e.g. 100 °C at 1 bar sits 0.4 K above Tsat. Use saturated liquid
      // at T (liquid enthalpy is nearly P-independent).
      const psat = if97.psat_bar(Math.min(T_K, 647.0));
      h_kJkg = if97.hf_hg(Math.max(psat, 0.032)).hf;
      phase = 'liquid';
      method = 'if97_satliq_at_T';
      warnings.push(`waterMolarH: liquid at ${T_K.toFixed(1)} K/${P_bar} bar above saturation — saturated-liquid-at-T approximation`);
    } else {
      h_kJkg = if97.h_kJkg(T_K, P_bar);
      phase = reg === 2 ? 'gas' : 'liquid';
      if (reg === 4) warnings.push('waterMolarH: point on the saturation line — liquid branch taken');
      if (reg === 0) warnings.push('waterMolarH: outside IF97 table envelope — nearest-region value');
    }
  } catch (e) {
    return errObj('MB_IF97', `IF97 evaluation failed at T=${T_K} K, P=${P_bar} bar: ${e.message}`, 'T_K');
  }
  const h = w.hf_liq_298 + (h_kJkg - waterAnchor()) * mwkg;
  return { h_kJmol: h, method, phase, warnings };
}

// ---------------------------------------------------------------------------
// phase determination
// ---------------------------------------------------------------------------

/**
 * Saturation pressure for a MERGED record: fluids.psat_bar when the key
 * lives in fluids.js; otherwise local Antoine/Clausius-Clapeyron using the
 * supplement + caloric dhvap_tb.
 * @param {object} rec merged record from resolve()
 * @param {number} T_K
 * @returns {{psat_bar:number|null, method:string, warning?:string}}
 */
function psatOf(rec, T_K) {
  if (fluids.get(rec.key)) {
    const r = fluids.psat_bar(rec.key, T_K);
    return { psat_bar: r.psat_bar, method: r.method, warning: r.warning };
  }
  if (rec.nonvolatile) return { psat_bar: 0, method: 'nonvolatile' };
  if (num(rec.tc_K) && T_K >= rec.tc_K) {
    return { psat_bar: null, method: 'supercritical' };
  }
  const a = rec.antoine;
  const T_C = T_K - 273.15;
  if (a && T_C >= a.tmin_c && T_C <= a.tmax_c) {
    return { psat_bar: Math.pow(10, a.A - a.B / (a.C + T_C)) * 0.001333224, method: 'antoine' };
  }
  if (num(rec.tb_K)) {
    const dHvap = num(rec.dhvap_tb) ? rec.dhvap_tb : TROUTON * rec.tb_K;
    const p = P_ATM * Math.exp(-(dHvap / R_KJ) * (1 / T_K - 1 / rec.tb_K));
    return { psat_bar: p, method: 'clausius_clapeyron' };
  }
  return { psat_bar: null, method: 'no_data', warning: `no Psat route for '${rec.key}'` };
}

/**
 * Phase of a component at (T, P).
 * Priority: explicit override > water via IF97 > nonvolatile (solid below
 * Tm, else liquid) > T ≥ Tc gas > T < Tm solid > Psat vs P.
 * @param {string} key
 * @param {number} T_K
 * @param {number} P_bar
 * @param {('gas'|'liquid'|'solid')} [override]
 * @returns {{phase:('gas'|'liquid'|'solid'), method:string,
 *            psat_bar:(number|null), warnings:string[]}|{error:object}}
 */
function phaseOf(key, T_K, P_bar, override) {
  const rec = resolve(key);
  if (rec.error) return rec;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'T_K must be positive', 'T_K');
  if (!num(P_bar) || P_bar <= 0) return errObj('MB_P', 'P_bar must be positive', 'P_bar');
  const warnings = [];
  if (override) {
    if (override !== 'gas' && override !== 'liquid' && override !== 'solid') {
      return errObj('MB_PHASE_OVERRIDE', `invalid phase override '${override}'`, 'phase');
    }
    return { phase: override, method: 'override', psat_bar: null, warnings };
  }
  if (key === 'H2O') {
    if (T_K < 273.15) return { phase: 'solid', method: 'if97_tm', psat_bar: null, warnings };
    const reg = if97.region(T_K, P_bar);
    if (reg === 2) return { phase: 'gas', method: 'if97_region', psat_bar: null, warnings };
    if (reg === 1) return { phase: 'liquid', method: 'if97_region', psat_bar: null, warnings };
    if (reg === 4) {
      warnings.push('phaseOf(H2O): on the saturation line — liquid returned');
      return { phase: 'liquid', method: 'if97_region', psat_bar: null, warnings };
    }
    // region 0: out of table envelope
    if (T_K >= 647.1) {
      warnings.push('phaseOf(H2O): supercritical — treated as gas');
      return { phase: 'gas', method: 'supercritical', psat_bar: null, warnings };
    }
    try {
      const p = if97.psat_bar(T_K);
      return { phase: p > P_bar ? 'gas' : 'liquid', method: 'if97_psat', psat_bar: p, warnings };
    } catch (e) {
      warnings.push(`phaseOf(H2O): psat lookup failed (${e.message}) — liquid assumed`);
      return { phase: 'liquid', method: 'fallback', psat_bar: null, warnings };
    }
  }
  if (rec.nonvolatile) {
    const solid = num(rec.tm_K) ? T_K < rec.tm_K : true;
    return { phase: solid ? 'solid' : 'liquid', method: 'nonvolatile', psat_bar: 0, warnings };
  }
  if (num(rec.tc_K) && T_K >= rec.tc_K) {
    return { phase: 'gas', method: 'supercritical', psat_bar: null, warnings };
  }
  if (num(rec.tm_K) && T_K < rec.tm_K) {
    return { phase: 'solid', method: 'below_tm', psat_bar: null, warnings };
  }
  const ps = psatOf(rec, T_K);
  if (ps.warning) warnings.push(`phaseOf(${key}): ${ps.warning}`);
  if (!num(ps.psat_bar)) {
    warnings.push(`phaseOf(${key}): no Psat estimate — liquid assumed below Tc`);
    return { phase: 'liquid', method: 'fallback', psat_bar: null, warnings };
  }
  return { phase: ps.psat_bar > P_bar ? 'gas' : 'liquid',
    method: 'psat_' + ps.method, psat_bar: ps.psat_bar, warnings };
}

// ---------------------------------------------------------------------------
// streams — molarize + total enthalpy
// ---------------------------------------------------------------------------

/**
 * Convert a mass-basis stream into mole flows / fractions / average MW.
 * Mass fractions off unity by ≤2% are normalized with a warning; worse → error.
 * @param {{mass_flow_kg_h:number, components:Array<{key:string,
 *          mass_fraction:number, phase?:string}>}} stream
 * @returns {{n_total_kmol_h:number, mw_avg:number,
 *            components:Array<{key,mass_fraction,mole_fraction,
 *                              n_kmol_h,mw}>, warnings:string[]}
 *           |{error:object}}
 */
function molarize(stream) {
  if (!stream || typeof stream !== 'object') {
    return errObj('MB_STREAM', 'stream object required', 'stream');
  }
  if (!num(stream.mass_flow_kg_h) || stream.mass_flow_kg_h < 0) {
    return errObj('MB_MASSFLOW', 'mass_flow_kg_h must be a non-negative number', 'mass_flow_kg_h');
  }
  if (!Array.isArray(stream.components) || stream.components.length === 0) {
    return errObj('MB_COMPONENTS', 'components array required', 'components');
  }
  const warnings = [];
  let sum = 0;
  for (const c of stream.components) {
    if (!c || !num(c.mass_fraction) || c.mass_fraction < 0) {
      return errObj('MB_MASSFRAC', `component '${c && c.key}' mass_fraction must be ≥ 0`, 'components');
    }
    sum += c.mass_fraction;
  }
  if (Math.abs(sum - 1) > 0.02) {
    return errObj('MB_MASSFRAC_SUM', `mass fractions sum to ${sum.toFixed(4)} (must be 1 ± 0.02)`, 'components');
  }
  if (Math.abs(sum - 1) > 1e-6) {
    warnings.push(`molarize: mass fractions summed to ${sum.toFixed(5)} — normalized`);
  }
  const comps = [];
  let n_total = 0;
  for (const c of stream.components) {
    const rec = resolve(c.key);
    if (rec.error) return rec;
    const wfrac = c.mass_fraction / sum;
    const n = stream.mass_flow_kg_h * wfrac / rec.mw; // kmol/h (mw g/mol = kg/kmol)
    n_total += n;
    comps.push({ key: c.key, mass_fraction: wfrac, n_kmol_h: n, mw: rec.mw });
  }
  for (const c of comps) c.mole_fraction = n_total > 0 ? c.n_kmol_h / n_total : 0;
  const mw_avg = n_total > 0 ? stream.mass_flow_kg_h / n_total : 0;
  return { n_total_kmol_h: n_total, mw_avg, components: comps, warnings };
}

/**
 * Total stream enthalpy on the FORMATION basis.
 * Per component: phase from phaseOf (per-component `phase` field acts as
 * override), then the matching molar-enthalpy route; water always IF97.
 * @param {{mass_flow_kg_h:number, T_K:number, P_bar:number,
 *          components:Array<{key:string, mass_fraction:number,
 *                            phase?:('gas'|'liquid'|'solid')}>}} stream
 * @returns {{H_kJh:number, h_kJkg:number,
 *            perComponent:Array<{key,phase,n_kmol_h,h_kJmol,H_kJh,method}>,
 *            warnings:string[]}|{error:object}}
 */
function streamEnthalpy(stream) {
  if (!stream || typeof stream !== 'object') {
    return errObj('MB_STREAM', 'stream object required', 'stream');
  }
  if (!num(stream.T_K) || stream.T_K <= 0) {
    return errObj('MB_T', 'stream.T_K must be positive', 'T_K');
  }
  if (!num(stream.P_bar) || stream.P_bar <= 0) {
    return errObj('MB_P', 'stream.P_bar must be positive', 'P_bar');
  }
  const mol = molarize(stream);
  if (mol.error) return mol;
  const warnings = mol.warnings.slice();
  const per = [];
  let H = 0;
  for (let i = 0; i < mol.components.length; i++) {
    const mc = mol.components[i];
    if (mc.n_kmol_h <= 0) {
      // zero-flow component (e.g. the excluded species in a flash product):
      // contributes nothing — skip evaluation so a phase override doesn't
      // demand data the component legitimately lacks.
      per.push({ key: mc.key, phase: null, n_kmol_h: 0, h_kJmol: 0, H_kJh: 0, method: 'zero_flow' });
      continue;
    }
    const override = stream.components[i].phase;
    const ph = phaseOf(mc.key, stream.T_K, stream.P_bar, override);
    if (ph.error) return ph;
    warnings.push(...ph.warnings);
    let hres;
    if (mc.key === 'H2O') {
      hres = waterMolarH(stream.T_K, stream.P_bar, ph.phase);
    } else if (ph.phase === 'gas') {
      hres = hGasMolar(mc.key, stream.T_K, { P_bar: stream.P_bar });
    } else if (ph.phase === 'liquid') {
      hres = hLiqMolar(mc.key, stream.T_K, { P_bar: stream.P_bar });
    } else {
      hres = hSolMolar(mc.key, stream.T_K);
    }
    if (hres.error) return hres;
    warnings.push(...hres.warnings);
    const Hi = mc.n_kmol_h * hres.h_kJmol * 1000; // kmol/h · kJ/mol · 1000 mol/kmol = kJ/h
    H += Hi;
    per.push({ key: mc.key, phase: ph.phase, n_kmol_h: mc.n_kmol_h,
      h_kJmol: hres.h_kJmol, H_kJh: Hi, method: hres.method });
  }
  const h_kJkg = stream.mass_flow_kg_h > 0 ? H / stream.mass_flow_kg_h : 0;
  return { H_kJh: H, h_kJkg, perComponent: per, warnings };
}

// ---------------------------------------------------------------------------
// inverse solve — find T for a target stream enthalpy
// ---------------------------------------------------------------------------

const SOLVE_T_MAX_ITER = 200;

/**
 * Bisection solve for the temperature at which the stream's formation-basis
 * enthalpy equals targetH_kJh. H(T) is monotonically increasing in T for a
 * fixed-phase composition, so a sign change over [Tlo, Thi] is sufficient.
 * @param {{mass_flow_kg_h:number, P_bar:number, components:Array}} streamShape
 *        stream WITHOUT T_K (any T_K present is ignored)
 * @param {number} targetH_kJh
 * @param {number} Tlo bracket low [K]
 * @param {number} Thi bracket high [K]
 * @returns {{T_K:number, H_kJh:number, iterations:number, converged:boolean,
 *            warnings:string[]}|{error:object}}
 */
function solveT_forH(streamShape, targetH_kJh, Tlo, Thi) {
  if (!num(targetH_kJh)) return errObj('MB_TARGET', 'targetH_kJh must be a number', 'targetH_kJh');
  if (!num(Tlo) || !num(Thi) || Tlo <= 0 || Thi <= Tlo) {
    return errObj('MB_BRACKET', 'require 0 < Tlo < Thi', 'Tlo');
  }
  const warnings = [];
  const f = (T) => {
    const r = streamEnthalpy(Object.assign({}, streamShape, { T_K: T }));
    return r;
  };
  const rlo = f(Tlo);
  if (rlo.error) return rlo;
  const rhi = f(Thi);
  if (rhi.error) return rhi;
  const flo = rlo.H_kJh - targetH_kJh;
  const fhi = rhi.H_kJh - targetH_kJh;
  const tolH = Math.max(1e-6 * Math.abs(targetH_kJh), 1e-3); // kJ/h
  if (Math.abs(flo) <= tolH) {
    return { T_K: Tlo, H_kJh: rlo.H_kJh, iterations: 0, converged: true, warnings: rlo.warnings };
  }
  if (Math.abs(fhi) <= tolH) {
    return { T_K: Thi, H_kJh: rhi.H_kJh, iterations: 0, converged: true, warnings: rhi.warnings };
  }
  if (flo * fhi > 0) {
    return errObj('MB_NO_BRACKET',
      `target enthalpy not bracketed: H(${Tlo} K)=${rlo.H_kJh.toExponential(4)}, H(${Thi} K)=${rhi.H_kJh.toExponential(4)}, target=${targetH_kJh.toExponential(4)} kJ/h`,
      'targetH_kJh');
  }
  let lo = Tlo;
  let hi = Thi;
  let fl = flo;
  let it = 0;
  let mid = 0.5 * (lo + hi);
  let rmid = null;
  for (; it < SOLVE_T_MAX_ITER; it++) {
    mid = 0.5 * (lo + hi);
    rmid = f(mid);
    if (rmid.error) return rmid;
    const fm = rmid.H_kJh - targetH_kJh;
    if (Math.abs(fm) <= tolH || (hi - lo) < 1e-6) {
      return { T_K: mid, H_kJh: rmid.H_kJh, iterations: it + 1, converged: true,
        warnings: warnings.concat(rmid.warnings) };
    }
    if (fl * fm <= 0) { hi = mid; } else { lo = mid; fl = fm; }
  }
  warnings.push(`solveT_forH: iteration cap ${SOLVE_T_MAX_ITER} reached — best estimate returned`);
  return { T_K: mid, H_kJh: rmid ? rmid.H_kJh : NaN, iterations: it,
    converged: false, warnings };
}

// ===========================================================================
// PART 2 — MODULE SOLVERS (Step 8): mixer, splitter, flash, heat-exchanger,
// rotating (pump/compressor/turbine), reactor (conversion).
//
// COMMON CONTRACT — every solver takes ONE argument { streams:[...],
// params:{...} } in base SI (kg/h, K, bar(a)) and returns:
//   { streams_out:[...],
//     mass_balance:   { in, out, closure_pct },          // kg/h, %
//     energy_balance: { Hin, Hout, Q_kW, W_kW },         // kJ/h, kW
//     details, converged, iterations, warnings }
// or the standard {error:{code,message,field}} envelope. Solvers never throw.
//
// SIGN CONVENTION: Q_kW and W_kW are both positive INTO the process fluid
// (heat added / work done on the fluid). Turbine W_kW is therefore negative.
// On the formation basis  Q + W = Hout − Hin  holds for every module.
// ===========================================================================

const KJH_PER_KW = 3600;       // kJ/h per kW
const MODULE_T_FLOOR = 150;    // K — outlet-T search floor
const MODULE_T_CEIL = 4000;    // K — outlet-T search ceiling
const BRACKET_EXPANSIONS = 14; // adaptive-bracket growth steps
const RR_MAX_ITER = 200;       // Rachford-Rice bisection cap
const K_NONCOND = 1e6;         // K-value assigned to supercritical comps

// ---------------------------------------------------------------------------
// shared module helpers
// ---------------------------------------------------------------------------

/**
 * Validate the {streams, params} envelope and inlet-stream count.
 * @param {{streams:Array, params?:object}} input
 * @param {number} minN minimum inlet streams
 * @param {number} maxN maximum inlet streams
 * @returns {{streams:Array, params:object}|{error:object}}
 */
function moduleInput(input, minN, maxN) {
  if (!input || typeof input !== 'object') {
    return errObj('MB_INPUT', 'module input {streams, params} required', 'input');
  }
  const s = input.streams;
  if (!Array.isArray(s) || s.length < minN) {
    return errObj('MB_STREAMS', `module requires at least ${minN} inlet stream(s)`, 'streams');
  }
  if (s.length > maxN) {
    return errObj('MB_STREAMS', `module accepts at most ${maxN} inlet stream(s)`, 'streams');
  }
  const p = input.params;
  if (p !== undefined && (p === null || typeof p !== 'object' || Array.isArray(p))) {
    return errObj('MB_PARAMS', 'params must be an object when given', 'params');
  }
  return { streams: s, params: p || {} };
}

/**
 * Mass-balance block. closure_pct is SIGNED: 100·(out−in)/in.
 * @param {number} mIn kg/h
 * @param {number} mOut kg/h
 * @returns {{in:number,out:number,closure_pct:number}}
 */
function massBalance(mIn, mOut) {
  const closure = mIn > 0 ? (100 * (mOut - mIn)) / mIn : (mOut === 0 ? 0 : 100);
  return { in: mIn, out: mOut, closure_pct: closure };
}

/**
 * Energy-balance block on the module convention Q + W = Hout − Hin.
 * @param {number} Hin kJ/h
 * @param {number} Hout kJ/h
 * @param {number} W_kW work INTO the fluid [kW]
 * @returns {{Hin:number,Hout:number,Q_kW:number,W_kW:number}}
 */
function energyBalance(Hin, Hout, W_kW) {
  return { Hin, Hout, Q_kW: (Hout - Hin) / KJH_PER_KW - W_kW, W_kW };
}

/**
 * Strip per-component phase overrides (outlet phases are re-evaluated by
 * phaseOf unless a solver deliberately re-imposes one).
 * @param {Array<{key:string,mass_fraction:number,phase?:string}>} comps
 * @returns {Array<{key:string,mass_fraction:number}>}
 */
function compsNoPhase(comps) {
  return comps.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction }));
}

/**
 * Build a stream from component MOLE flows [kmol/h]. Zero-total-flow streams
 * keep an equal-split composition so molarize stays valid downstream.
 * @param {Array<{key:string, n_kmol_h:number}>} entries
 * @param {number} T_K
 * @param {number} P_bar
 * @param {('gas'|'liquid'|'solid')} [phase] override applied to every comp
 * @returns {{mass_flow_kg_h:number,T_K:number,P_bar:number,
 *            components:Array}|{error:object}}
 */
function streamFromMoles(entries, T_K, P_bar, phase) {
  let mass = 0;
  const masses = [];
  for (const e of entries) {
    const rec = resolve(e.key);
    if (rec.error) return rec;
    const m = Math.max(0, e.n_kmol_h) * rec.mw; // kmol/h · kg/kmol
    mass += m;
    masses.push({ key: e.key, m });
  }
  const components = masses.map((c) => {
    const comp = { key: c.key, mass_fraction: mass > 0 ? c.m / mass : 1 / masses.length };
    if (phase) comp.phase = phase;
    return comp;
  });
  return { mass_flow_kg_h: mass, T_K, P_bar, components };
}

/**
 * solveT_forH with an adaptive bracket: expands the [lo,hi] window (H is
 * monotone in T for a fixed composition) until the target enthalpy is
 * bracketed, within [MODULE_T_FLOOR, MODULE_T_CEIL].
 * @param {{mass_flow_kg_h:number,P_bar:number,components:Array}} shape
 * @param {number} targetH_kJh
 * @param {number} Tlo0 seed bracket low [K]
 * @param {number} Thi0 seed bracket high [K]
 * @returns {{T_K:number,H_kJh:number,iterations:number,converged:boolean,
 *            warnings:string[]}|{error:object}}
 */
function solveOutletT(shape, targetH_kJh, Tlo0, Thi0) {
  let lo = Math.min(Math.max(MODULE_T_FLOOR, Tlo0), MODULE_T_CEIL - 1);
  let hi = Math.max(Math.min(MODULE_T_CEIL, Thi0), lo + 1);
  let span = Math.max(hi - lo, 25);
  for (let k = 0; k < BRACKET_EXPANSIONS; k++) {
    const rlo = streamEnthalpy(Object.assign({}, shape, { T_K: lo }));
    if (rlo.error) return rlo;
    const rhi = streamEnthalpy(Object.assign({}, shape, { T_K: hi }));
    if (rhi.error) return rhi;
    if (targetH_kJh < rlo.H_kJh - 1e-9) {
      if (lo <= MODULE_T_FLOOR) break;
      lo = Math.max(MODULE_T_FLOOR, lo - span);
      span *= 2;
      continue;
    }
    if (targetH_kJh > rhi.H_kJh + 1e-9) {
      if (hi >= MODULE_T_CEIL) break;
      hi = Math.min(MODULE_T_CEIL, hi + span);
      span *= 2;
      continue;
    }
    return solveT_forH(shape, targetH_kJh, lo, hi);
  }
  return errObj('MB_NO_BRACKET',
    `outlet temperature not bracketed in [${MODULE_T_FLOOR}, ${MODULE_T_CEIL}] K — check duty / feed enthalpies`,
    'params');
}

// ---------------------------------------------------------------------------
// 1. MIXER — N inlets → 1 outlet; adiabatic (default), heated (params.Q_kW)
//    or specified outlet temperature (params.T_out_K).
// ---------------------------------------------------------------------------

/**
 * Mixer/blender. params: { P_out_bar?, Q_kW?, T_out_K? }. With one inlet it
 * degenerates to a heater/cooler. Outlet phase overrides are dropped —
 * phaseOf re-evaluates each component at the mixed condition.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveMixer(input) {
  const mi = moduleInput(input, 1, 12);
  if (mi.error) return mi;
  const { streams, params } = mi;
  const warnings = [];

  let Hin = 0;
  let massIn = 0;
  let Tmin = Infinity;
  let Tmax = -Infinity;
  let Pmin = Infinity;
  const massByKey = new Map(); // insertion order = first-seen order
  for (let i = 0; i < streams.length; i++) {
    const st = streams[i];
    const e = streamEnthalpy(st);
    if (e.error) return e;
    warnings.push(...e.warnings);
    const mol = molarize(st); // normalized mass fractions
    if (mol.error) return mol;
    Hin += e.H_kJh;
    massIn += st.mass_flow_kg_h;
    Tmin = Math.min(Tmin, st.T_K);
    Tmax = Math.max(Tmax, st.T_K);
    Pmin = Math.min(Pmin, st.P_bar);
    for (const c of mol.components) {
      massByKey.set(c.key, (massByKey.get(c.key) || 0) + st.mass_flow_kg_h * c.mass_fraction);
    }
  }
  if (massIn <= 0) return errObj('MB_MASSFLOW', 'total inlet mass flow must be positive', 'streams');

  let P_out = params.P_out_bar;
  if (P_out === undefined) {
    P_out = Pmin;
    const Ps = streams.map((s) => s.P_bar);
    if (Math.max(...Ps) - Pmin > 1e-9) {
      warnings.push(`mixer: inlet pressures differ — outlet set to lowest inlet P = ${Pmin} bar`);
    }
  } else if (!num(P_out) || P_out <= 0) {
    return errObj('MB_P', 'params.P_out_bar must be positive', 'P_out_bar');
  }

  const components = [];
  for (const [key, m] of massByKey.entries()) {
    components.push({ key, mass_fraction: m / massIn });
  }
  const shape = { mass_flow_kg_h: massIn, P_bar: P_out, components };

  let T_out;
  let Hout;
  let mode;
  let iterations = 0;
  let converged = true;
  if (num(params.T_out_K)) {
    if (params.T_out_K <= 0) return errObj('MB_T', 'params.T_out_K must be positive', 'T_out_K');
    if (num(params.Q_kW)) warnings.push('mixer: T_out_K specified — params.Q_kW input ignored, duty is an output');
    T_out = params.T_out_K;
    mode = 'specified_T';
    const e = streamEnthalpy(Object.assign({}, shape, { T_K: T_out }));
    if (e.error) return e;
    warnings.push(...e.warnings);
    Hout = e.H_kJh;
  } else {
    const Qext = num(params.Q_kW) ? params.Q_kW : 0;
    mode = Qext === 0 ? 'adiabatic' : 'heated';
    const target = Hin + Qext * KJH_PER_KW;
    const sol = solveOutletT(shape, target, Tmin - 2, Tmax + 2);
    if (sol.error) return sol;
    warnings.push(...sol.warnings);
    T_out = sol.T_K;
    Hout = sol.H_kJh;
    iterations = sol.iterations;
    converged = sol.converged;
  }

  const out = Object.assign({}, shape, { T_K: T_out, H_kJh: Hout });
  const outMol = molarize(out);
  return {
    streams_out: [out],
    mass_balance: massBalance(massIn, out.mass_flow_kg_h),
    energy_balance: energyBalance(Hin, Hout, 0),
    details: {
      mode,
      n_inlets: streams.length,
      T_out_K: T_out,
      P_out_bar: P_out,
      mw_avg_out: outMol.error ? null : outMol.mw_avg,
      composition_out: components.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction })),
    },
    converged,
    iterations,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 2. SPLITTER — 1 inlet → N outlets with identical T/P/composition.
// ---------------------------------------------------------------------------

/**
 * Splitter. params: { fractions:number[] } — each ≥ 0, sum = 1 ± 0.001
 * (validated; small drift normalized with a warning).
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveSplitter(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const feed = mi.streams[0];
  const fr = mi.params.fractions;
  const warnings = [];

  if (!Array.isArray(fr) || fr.length < 2) {
    return errObj('MB_SPLIT_FRACTIONS', 'params.fractions must be an array of ≥ 2 split fractions', 'fractions');
  }
  let sum = 0;
  for (const f of fr) {
    if (!num(f) || f < 0) return errObj('MB_SPLIT_FRACTIONS', 'every split fraction must be a number ≥ 0', 'fractions');
    sum += f;
  }
  if (Math.abs(sum - 1) > 1e-3) {
    return errObj('MB_SPLIT_SUM', `split fractions sum to ${sum.toFixed(5)} (must be 1 ± 0.001)`, 'fractions');
  }
  if (Math.abs(sum - 1) > 1e-9) warnings.push(`splitter: fractions summed to ${sum.toFixed(6)} — normalized`);

  const eIn = streamEnthalpy(feed);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);

  const streams_out = [];
  let Hout = 0;
  let massOut = 0;
  for (const f of fr) {
    const st = {
      mass_flow_kg_h: feed.mass_flow_kg_h * (f / sum),
      T_K: feed.T_K,
      P_bar: feed.P_bar,
      components: feed.components.map((c) => {
        const cc = { key: c.key, mass_fraction: c.mass_fraction };
        if (c.phase) cc.phase = c.phase; // splitter preserves declared phases
        return cc;
      }),
    };
    const e = streamEnthalpy(st);
    if (e.error) return e;
    st.H_kJh = e.H_kJh;
    Hout += e.H_kJh;
    massOut += st.mass_flow_kg_h;
    streams_out.push(st);
  }

  return {
    streams_out,
    mass_balance: massBalance(feed.mass_flow_kg_h, massOut),
    energy_balance: energyBalance(eIn.H_kJh, Hout, 0),
    details: { n_outlets: fr.length, fractions_used: fr.map((f) => f / sum) },
    converged: true,
    iterations: 0,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 3. FLASH — isothermal flash at specified (T, P): Ki = Psat_i(T)/P
//    (Raoult), Rachford-Rice bisection on V/F. Near-ideal systems only.
// ---------------------------------------------------------------------------

/**
 * K-value for one component at the flash condition. Water uses IF97 Psat;
 * others use the merged-record Psat route (Antoine in range, else
 * Clausius-Clapeyron). Nonvolatile → K = 0; supercritical → K_NONCOND.
 * @param {string} key
 * @param {number} T_K
 * @param {number} P_bar
 * @returns {{K:number, method:string, warning?:string}|{error:object}}
 */
function flashK(key, T_K, P_bar) {
  if (key === 'H2O') {
    if (T_K >= 647.1) return { K: K_NONCOND, method: 'supercritical', warning: 'H2O supercritical — treated as noncondensable' };
    if (T_K < 273.16) return { K: 0, method: 'below_triple', warning: 'H2O below triple point — held in the liquid/solid stream' };
    try {
      return { K: if97.psat_bar(T_K) / P_bar, method: 'if97_psat' };
    } catch (e) {
      return errObj('MB_IF97', `IF97 Psat failed at ${T_K} K: ${e.message}`, 'T_K');
    }
  }
  const rec = resolve(key);
  if (rec.error) return rec;
  if (rec.nonvolatile) return { K: 0, method: 'nonvolatile' };
  const ps = psatOf(rec, T_K);
  if (ps.method === 'supercritical') {
    return { K: K_NONCOND, method: 'supercritical', warning: `${key} supercritical at ${T_K.toFixed(1)} K — treated as noncondensable (all-vapor)` };
  }
  if (!num(ps.psat_bar)) {
    return { K: 0, method: 'no_psat', warning: `${key}: no Psat route — treated as nonvolatile` };
  }
  return { K: ps.psat_bar / P_bar, method: 'psat_' + ps.method };
}

/**
 * Isothermal flash. Feed = streams[0] at its own (T,P) — that state sets
 * Hin, so Q covers both the temperature change to the flash condition and
 * the phase split. params: { T_K, P_bar } (flash condition, required).
 * VALIDITY: Raoult's-law K-values — near-ideal systems only; azeotropic /
 * strongly polar pairs are out of scope (spec: activity models are Phase 3).
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveFlash(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const feed = mi.streams[0];
  const { T_K, P_bar } = mi.params;
  if (!num(T_K) || T_K <= 0) return errObj('MB_T', 'params.T_K (flash temperature) must be positive', 'T_K');
  if (!num(P_bar) || P_bar <= 0) return errObj('MB_P', 'params.P_bar (flash pressure) must be positive', 'P_bar');
  const warnings = [];

  const eIn = streamEnthalpy(feed);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);
  const mol = molarize(feed);
  if (mol.error) return mol;

  const z = mol.components.map((c) => c.mole_fraction);
  const Ks = [];
  for (const c of mol.components) {
    const k = flashK(c.key, T_K, P_bar);
    if (k.error) return k;
    if (k.warning) warnings.push(`flash: ${k.warning}`);
    Ks.push({ key: c.key, K: k.K, method: k.method });
  }

  // Rachford-Rice: f(ψ) = Σ zᵢ(Kᵢ−1)/(1+ψ(Kᵢ−1)); monotone decreasing.
  const f = (psi) => {
    let s = 0;
    for (let i = 0; i < z.length; i++) {
      const km1 = Ks[i].K - 1;
      s += (z[i] * km1) / (1 + psi * km1);
    }
    return s;
  };
  const PSI_HI = 1 - 1e-9; // guard the ψ→1 pole when any K = 0
  let psi;
  let regime;
  let iterations = 0;
  let converged = true;
  const f0 = f(0);
  if (f0 <= 0) {
    psi = 0;
    regime = 'all_liquid';
    if (Math.abs(f0) < 1e-9) warnings.push('flash: feed is at its bubble point — all-liquid returned');
  } else if (f(PSI_HI) >= 0) {
    psi = 1;
    regime = 'all_vapor';
  } else {
    regime = 'two_phase';
    let lo = 0;
    let hi = PSI_HI;
    let flo = f0;
    for (; iterations < RR_MAX_ITER; iterations++) {
      const mid = 0.5 * (lo + hi);
      const fm = f(mid);
      if (Math.abs(fm) < 1e-12 || hi - lo < 1e-12) { lo = mid; hi = mid; break; }
      if (flo * fm <= 0) hi = mid;
      else { lo = mid; flo = fm; }
    }
    psi = 0.5 * (lo + hi);
    if (iterations >= RR_MAX_ITER) {
      converged = false;
      warnings.push(`flash: Rachford-Rice iteration cap ${RR_MAX_ITER} reached`);
    }
  }

  // phase compositions and component splits
  const x = [];
  const y = [];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < z.length; i++) {
    const km1 = Ks[i].K - 1;
    const xi = psi >= 1 ? (Ks[i].K > 0 ? z[i] / Ks[i].K : 0) : z[i] / (1 + psi * km1);
    const yi = Ks[i].K >= K_NONCOND ? (psi > 0 ? z[i] / psi : 0) : Ks[i].K * xi;
    x.push(xi); y.push(yi); sx += xi; sy += yi;
  }
  for (let i = 0; i < z.length; i++) {
    x[i] = sx > 0 ? x[i] / sx : 0;
    y[i] = sy > 0 ? y[i] / sy : 0;
  }

  const nTot = mol.n_total_kmol_h;
  const vapEntries = mol.components.map((c, i) => ({ key: c.key, n_kmol_h: psi * nTot * y[i] }));
  const liqEntries = mol.components.map((c, i) => ({ key: c.key, n_kmol_h: (1 - psi) * nTot * x[i] }));
  const vap = streamFromMoles(vapEntries, T_K, P_bar, 'gas');
  if (vap.error) return vap;
  const liq = streamFromMoles(liqEntries, T_K, P_bar, 'liquid');
  if (liq.error) return liq;
  // nonvolatile components keep their natural phase in the liquid product
  // (phaseOf routes them solid below Tm — a forced 'liquid' override would
  // demand liquid-phase data that salts and the like don't have).
  for (const c of liq.components) {
    const rec = resolve(c.key);
    if (!rec.error && rec.nonvolatile) delete c.phase;
  }
  const eV = streamEnthalpy(vap);
  if (eV.error) return eV;
  const eL = streamEnthalpy(liq);
  if (eL.error) return eL;
  warnings.push(...eV.warnings, ...eL.warnings);
  vap.H_kJh = eV.H_kJh;
  liq.H_kJh = eL.H_kJh;

  const Hout = eV.H_kJh + eL.H_kJh;
  return {
    streams_out: [vap, liq],
    mass_balance: massBalance(feed.mass_flow_kg_h, vap.mass_flow_kg_h + liq.mass_flow_kg_h),
    energy_balance: energyBalance(eIn.H_kJh, Hout, 0),
    details: {
      T_K, P_bar,
      psi_VF: psi,
      regime,
      K: Ks,
      x: mol.components.map((c, i) => ({ key: c.key, x: x[i] })),
      y: mol.components.map((c, i) => ({ key: c.key, y: y[i] })),
      vapor_kmol_h: psi * nTot,
      liquid_kmol_h: (1 - psi) * nTot,
    },
    converged,
    iterations,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 4. HEAT EXCHANGER — hot = streams[0], cold = streams[1]; four modes,
//    LMTD/UA report once both terminal temperatures are known.
// ---------------------------------------------------------------------------

/**
 * Heat exchanger. params:
 *   mode          : 'both_T' | 'solve_cold' | 'solve_hot' | 'duty'
 *   T_hot_out_K   : required by both_T, solve_cold
 *   T_cold_out_K  : required by both_T, solve_hot
 *   duty_kW       : required by duty mode (positive = hot → cold)
 *   dP_hot_bar, dP_cold_bar : optional pressure drops (default 0)
 *   arrangement   : 'counter' (default) | 'cocurrent'  (LMTD form)
 *   U_W_m2K       : optional — reports area when LMTD is defined
 * Outlet phase overrides are dropped (condensers/vaporizers re-phase
 * per component via phaseOf). Overall external Q_kW ≈ 0 in solve modes;
 * in both_T it exposes the hot/cold duty mismatch.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveHeatExchanger(input) {
  const mi = moduleInput(input, 2, 2);
  if (mi.error) return mi;
  const [hot, cold] = mi.streams;
  const p = mi.params;
  const warnings = [];
  const MODES = ['both_T', 'solve_cold', 'solve_hot', 'duty'];
  if (!MODES.includes(p.mode)) {
    return errObj('MB_HX_MODE', `params.mode must be one of ${MODES.join(' | ')}`, 'mode');
  }
  const dPh = num(p.dP_hot_bar) ? p.dP_hot_bar : 0;
  const dPc = num(p.dP_cold_bar) ? p.dP_cold_bar : 0;
  if (dPh < 0 || dPc < 0) return errObj('MB_HX_DP', 'pressure drops must be ≥ 0', 'dP_hot_bar');
  const PhOut = hot.P_bar - dPh;
  const PcOut = cold.P_bar - dPc;
  if (PhOut <= 0 || PcOut <= 0) return errObj('MB_HX_DP', 'pressure drop exceeds inlet pressure', 'dP_hot_bar');
  const arrangement = p.arrangement === 'cocurrent' ? 'cocurrent' : 'counter';

  const eH = streamEnthalpy(hot);
  if (eH.error) return eH;
  const eC = streamEnthalpy(cold);
  if (eC.error) return eC;
  warnings.push(...eH.warnings, ...eC.warnings);

  const hotShape = { mass_flow_kg_h: hot.mass_flow_kg_h, P_bar: PhOut, components: compsNoPhase(hot.components) };
  const coldShape = { mass_flow_kg_h: cold.mass_flow_kg_h, P_bar: PcOut, components: compsNoPhase(cold.components) };
  const evalAt = (shape, T) => streamEnthalpy(Object.assign({}, shape, { T_K: T }));

  let ThOut;
  let TcOut;
  let HhOut;
  let HcOut;
  let duty; // kW, hot → cold
  let dutyHot = null;
  let dutyCold = null;
  let mismatchPct = null;
  let iterations = 0;
  let converged = true;

  if (p.mode === 'both_T') {
    if (!num(p.T_hot_out_K) || !num(p.T_cold_out_K)) {
      return errObj('MB_HX_T', 'both_T mode requires T_hot_out_K and T_cold_out_K', 'T_hot_out_K');
    }
    ThOut = p.T_hot_out_K;
    TcOut = p.T_cold_out_K;
    const rh = evalAt(hotShape, ThOut);
    if (rh.error) return rh;
    const rc = evalAt(coldShape, TcOut);
    if (rc.error) return rc;
    warnings.push(...rh.warnings, ...rc.warnings);
    HhOut = rh.H_kJh;
    HcOut = rc.H_kJh;
    dutyHot = (eH.H_kJh - HhOut) / KJH_PER_KW;
    dutyCold = (HcOut - eC.H_kJh) / KJH_PER_KW;
    duty = dutyHot;
    const ref = Math.max(Math.abs(dutyHot), 1e-9);
    mismatchPct = (100 * (dutyCold - dutyHot)) / ref;
    if (Math.abs(mismatchPct) > 1) {
      warnings.push(`heat-exchanger: hot/cold duty mismatch ${mismatchPct.toFixed(2)}% — both_T over-specifies the balance`);
    }
  } else if (p.mode === 'solve_cold') {
    if (!num(p.T_hot_out_K)) return errObj('MB_HX_T', 'solve_cold mode requires T_hot_out_K', 'T_hot_out_K');
    ThOut = p.T_hot_out_K;
    const rh = evalAt(hotShape, ThOut);
    if (rh.error) return rh;
    warnings.push(...rh.warnings);
    HhOut = rh.H_kJh;
    duty = (eH.H_kJh - HhOut) / KJH_PER_KW;
    const sol = solveOutletT(coldShape, eC.H_kJh + duty * KJH_PER_KW, cold.T_K - 2, Math.max(hot.T_K, cold.T_K) + 2);
    if (sol.error) return sol;
    warnings.push(...sol.warnings);
    TcOut = sol.T_K;
    HcOut = sol.H_kJh;
    iterations = sol.iterations;
    converged = sol.converged;
  } else if (p.mode === 'solve_hot') {
    if (!num(p.T_cold_out_K)) return errObj('MB_HX_T', 'solve_hot mode requires T_cold_out_K', 'T_cold_out_K');
    TcOut = p.T_cold_out_K;
    const rc = evalAt(coldShape, TcOut);
    if (rc.error) return rc;
    warnings.push(...rc.warnings);
    HcOut = rc.H_kJh;
    duty = (HcOut - eC.H_kJh) / KJH_PER_KW;
    const sol = solveOutletT(hotShape, eH.H_kJh - duty * KJH_PER_KW, Math.min(hot.T_K, cold.T_K) - 2, hot.T_K + 2);
    if (sol.error) return sol;
    warnings.push(...sol.warnings);
    ThOut = sol.T_K;
    HhOut = sol.H_kJh;
    iterations = sol.iterations;
    converged = sol.converged;
  } else { // duty
    if (!num(p.duty_kW)) return errObj('MB_HX_DUTY', 'duty mode requires params.duty_kW (positive = hot → cold)', 'duty_kW');
    duty = p.duty_kW;
    const sh = solveOutletT(hotShape, eH.H_kJh - duty * KJH_PER_KW, hot.T_K - 50, hot.T_K + 50);
    if (sh.error) return sh;
    const sc = solveOutletT(coldShape, eC.H_kJh + duty * KJH_PER_KW, cold.T_K - 50, cold.T_K + 50);
    if (sc.error) return sc;
    warnings.push(...sh.warnings, ...sc.warnings);
    ThOut = sh.T_K;
    HhOut = sh.H_kJh;
    TcOut = sc.T_K;
    HcOut = sc.H_kJh;
    iterations = Math.max(sh.iterations, sc.iterations);
    converged = sh.converged && sc.converged;
  }

  if (duty > 0 && hot.T_K <= cold.T_K) {
    warnings.push('heat-exchanger: hot inlet is not hotter than cold inlet for positive duty — check stream order');
  }

  // LMTD / UA (both terminal temperatures now known)
  let lmtd = null;
  let UA = null;
  let area = null;
  const dt1 = arrangement === 'counter' ? hot.T_K - TcOut : hot.T_K - cold.T_K;
  const dt2 = arrangement === 'counter' ? ThOut - cold.T_K : ThOut - TcOut;
  if (dt1 > 0 && dt2 > 0) {
    lmtd = Math.abs(dt1 - dt2) < 1e-9 ? dt1 : (dt1 - dt2) / Math.log(dt1 / dt2);
    if (duty > 0) {
      UA = duty / lmtd; // kW/K
      if (num(p.U_W_m2K) && p.U_W_m2K > 0) area = (UA * 1000) / p.U_W_m2K;
    }
  } else {
    warnings.push('heat-exchanger: temperature cross or non-positive approach — LMTD not defined');
  }

  const hotOut = Object.assign({}, hotShape, { T_K: ThOut, H_kJh: HhOut });
  const coldOut = Object.assign({}, coldShape, { T_K: TcOut, H_kJh: HcOut });
  const Hin = eH.H_kJh + eC.H_kJh;
  const Hout = HhOut + HcOut;
  return {
    streams_out: [hotOut, coldOut],
    mass_balance: massBalance(hot.mass_flow_kg_h + cold.mass_flow_kg_h,
      hotOut.mass_flow_kg_h + coldOut.mass_flow_kg_h),
    energy_balance: energyBalance(Hin, Hout, 0),
    details: {
      mode: p.mode,
      arrangement,
      duty_kW: duty,
      duty_hot_kW: dutyHot === null ? duty : dutyHot,
      duty_cold_kW: dutyCold === null ? duty : dutyCold,
      mismatch_pct: mismatchPct,
      lmtd_K: lmtd,
      UA_kW_K: UA,
      area_m2: area,
      T_hot_out_K: ThOut,
      T_cold_out_K: TcOut,
    },
    converged,
    iterations,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 5. ROTATING — pump / compressor / turbine (params.machine selects).
// ---------------------------------------------------------------------------

/**
 * Pump branch. params: { machine:'pump', dP_bar or P_out_bar, eta (0–1,
 * default 0.7) }. Incompressible: W_hyd = ṁ·ΔP/ρ, W_shaft = W_hyd/η,
 * ΔT = ΔP·(1/η − 1)/(ρ·cp). NOTE: the liquid enthalpy route carries no
 * ΔP·v flow-work term, so Hout − Hin reflects only the friction heating;
 * energy_balance therefore reports Q_kW = 0 with W_kW = shaft power and the
 * residual is stated in details.enthalpy_note.
 * @param {object} feed inlet stream
 * @param {object} p params
 * @returns {object} module result or error envelope
 */
function solvePump(feed, p) {
  const warnings = [];
  const eta = num(p.eta) ? p.eta : 0.7;
  if (eta <= 0 || eta > 1) return errObj('MB_ETA', 'params.eta must be in (0, 1]', 'eta');
  let dP = p.dP_bar;
  if (!num(dP) && num(p.P_out_bar)) dP = p.P_out_bar - feed.P_bar;
  if (!num(dP) || dP <= 0) {
    return errObj('MB_PUMP_DP', 'pump requires params.dP_bar > 0 (or P_out_bar above inlet)', 'dP_bar');
  }
  const mol = molarize(feed);
  if (mol.error) return mol;

  // mass-weighted mixture density (1/ρ mix) and liquid cp
  let invRho = 0;
  let cp = 0;
  for (const c of mol.components) {
    const fRec = fluids.get(c.key);
    let rho = fRec && num(fRec.rho_liq_kgm3) ? fRec.rho_liq_kgm3 : null;
    if (rho == null) {
      rho = 1000;
      warnings.push(`pump: no liquid density for '${c.key}' — 1000 kg/m³ assumed`);
    }
    invRho += c.mass_fraction / rho;
    const rec = resolve(c.key);
    if (rec.error) return rec;
    let cpi = num(rec.cp_liq_kjkgk) ? rec.cp_liq_kjkgk : null;
    if (cpi == null) {
      cpi = c.key === 'H2O' ? 4.187 : 2.0;
      warnings.push(`pump: no liquid cp for '${c.key}' — ${cpi} kJ/kg·K assumed`);
    }
    cp += c.mass_fraction * cpi;
  }
  const rho = 1 / invRho;

  const mkgs = feed.mass_flow_kg_h / 3600;
  const Whyd = (mkgs * dP * 1e5) / rho / 1000;   // kW
  const Wshaft = Whyd / eta;                      // kW
  const dT = (dP * 1e5 * (1 / eta - 1)) / (rho * cp * 1000); // K

  const eIn = streamEnthalpy(feed);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);
  const out = {
    mass_flow_kg_h: feed.mass_flow_kg_h,
    T_K: feed.T_K + dT,
    P_bar: feed.P_bar + dP,
    components: feed.components.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction, phase: 'liquid' })),
  };
  const eOut = streamEnthalpy(out);
  if (eOut.error) return eOut;
  warnings.push(...eOut.warnings);
  out.H_kJh = eOut.H_kJh;

  return {
    streams_out: [out],
    mass_balance: massBalance(feed.mass_flow_kg_h, out.mass_flow_kg_h),
    energy_balance: { Hin: eIn.H_kJh, Hout: eOut.H_kJh, Q_kW: 0, W_kW: Wshaft },
    details: {
      machine: 'pump',
      dP_bar: dP,
      eta,
      rho_kgm3: rho,
      cp_kJkgK: cp,
      W_hydraulic_kW: Whyd,
      W_shaft_kW: Wshaft,
      dT_K: dT,
      enthalpy_note: 'liquid enthalpy route excludes the ΔP·v flow-work term; Hout − Hin shows only the friction temperature rise',
    },
    converged: true,
    iterations: 0,
    warnings,
  };
}

/**
 * Compressor / turbine branch. params: { machine, P_out_bar (required),
 * eta (isentropic; default 0.75 compressor / 0.80 turbine) }.
 * γ from the mole-weighted mixture Cp(T) (two-pass: at T1, then at the
 * (T1+T2s)/2 mean), T2s = T1·r^((γ−1)/γ), isentropic work from the
 * formation-basis enthalpy at T2s (PR departure applies automatically above
 * 30 bar), real work = Ws/η (compressor) or Ws·η (turbine), outlet T solved
 * from H(T2) = H1 + W. Densities via eos.solveZ at inlet and outlet.
 * @param {object} feed inlet stream
 * @param {object} p params
 * @param {('compressor'|'turbine')} machine
 * @returns {object} module result or error envelope
 */
function solveCompressorTurbine(feed, p, machine) {
  const warnings = [];
  const eta = num(p.eta) ? p.eta : (machine === 'compressor' ? 0.75 : 0.8);
  if (eta <= 0 || eta > 1) return errObj('MB_ETA', 'params.eta must be in (0, 1]', 'eta');
  const P2 = p.P_out_bar;
  if (!num(P2) || P2 <= 0) return errObj('MB_P', 'params.P_out_bar must be positive', 'P_out_bar');
  const r = P2 / feed.P_bar;
  if (machine === 'compressor' && r <= 1) {
    return errObj('MB_PRESSURE_RATIO', 'compressor requires P_out_bar > inlet pressure', 'P_out_bar');
  }
  if (machine === 'turbine' && r >= 1) {
    return errObj('MB_PRESSURE_RATIO', 'turbine requires P_out_bar < inlet pressure', 'P_out_bar');
  }

  const mol = molarize(feed);
  if (mol.error) return mol;
  for (const c of feed.components) {
    if (c.key === 'H2O') continue;
    const ph = phaseOf(c.key, feed.T_K, feed.P_bar);
    if (!ph.error && ph.phase !== 'gas') {
      warnings.push(`rotating: '${c.key}' is not a gas at the inlet condition — treated as gas for the ${machine}`);
    }
  }

  /** mole-weighted ideal-gas Cp of the mixture [J/mol·K] at T */
  const cpMix = (T) => {
    let s = 0;
    for (const c of mol.components) {
      const cg = cpGas(c.key, T);
      if (cg.error) return cg;
      s += c.mole_fraction * cg.cp_J_molK;
    }
    return s;
  };
  const cp1 = cpMix(feed.T_K);
  if (cp1.error) return cp1;
  const g1 = cp1 / (cp1 - R_J);
  let T2s = feed.T_K * Math.pow(r, (g1 - 1) / g1);
  const cpm = cpMix(0.5 * (feed.T_K + T2s));
  if (cpm.error) return cpm;
  const gm = cpm / (cpm - R_J);
  T2s = feed.T_K * Math.pow(r, (gm - 1) / gm);

  const gasShape = {
    mass_flow_kg_h: feed.mass_flow_kg_h,
    P_bar: feed.P_bar,
    components: feed.components.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction, phase: 'gas' })),
  };
  const e1 = streamEnthalpy(Object.assign({}, gasShape, { T_K: feed.T_K }));
  if (e1.error) return e1;
  const e2s = streamEnthalpy(Object.assign({}, gasShape, { T_K: T2s, P_bar: P2 }));
  if (e2s.error) return e2s;
  warnings.push(...e1.warnings, ...e2s.warnings);

  const Ws = e2s.H_kJh - e1.H_kJh; // kJ/h, isentropic
  const W = machine === 'compressor' ? Ws / eta : Ws * eta; // kJ/h, actual
  const outShape = Object.assign({}, gasShape, { P_bar: P2 });
  const sol = solveOutletT(outShape, e1.H_kJh + W,
    Math.min(feed.T_K, T2s) - 10, Math.max(feed.T_K, T2s) + 60);
  if (sol.error) return sol;
  warnings.push(...sol.warnings);

  /** PR density [kg/m³] at (T,P); Z = 1 fallback when criticals are missing */
  const density = (T, P) => {
    const comps = [];
    let ok = true;
    for (const c of mol.components) {
      const rec = resolve(c.key);
      if (rec.error || !num(rec.tc_K) || !num(rec.pc_bar)) { ok = false; break; }
      comps.push({ key: c.key, tc_K: rec.tc_K, pc_bar: rec.pc_bar,
        omega: num(rec.omega) ? rec.omega : 0, y: c.mole_fraction });
    }
    let Z = 1;
    if (ok) {
      try { Z = eos.solveZ({ T_K: T, P_bar: P, comps }).Z; } catch (e) { ok = false; }
    }
    if (!ok) warnings.push(`rotating: PR density unavailable at ${T.toFixed(1)} K/${P} bar — ideal gas (Z = 1) used`);
    return { rho: (P * 1e5 * (mol.mw_avg / 1000)) / (Z * R_J * T), Z };
  };
  const dIn = density(feed.T_K, feed.P_bar);
  const dOut = density(sol.T_K, P2);

  const out = Object.assign({}, outShape, { T_K: sol.T_K, H_kJh: sol.H_kJh });
  return {
    streams_out: [out],
    mass_balance: massBalance(feed.mass_flow_kg_h, out.mass_flow_kg_h),
    energy_balance: energyBalance(e1.H_kJh, sol.H_kJh, W / KJH_PER_KW),
    details: {
      machine,
      pressure_ratio: r,
      eta_isentropic: eta,
      gamma_in: g1,
      gamma_mean: gm,
      T2s_K: T2s,
      W_isentropic_kW: Ws / KJH_PER_KW,
      W_shaft_kW: W / KJH_PER_KW,
      rho_in_kgm3: dIn.rho,
      rho_out_kgm3: dOut.rho,
      Z_in: dIn.Z,
      Z_out: dOut.Z,
    },
    converged: sol.converged,
    iterations: sol.iterations,
    warnings,
  };
}

/**
 * Rotating-equipment dispatcher. params.machine ∈ pump|compressor|turbine.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveRotating(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const machine = mi.params.machine;
  if (machine === 'pump') return solvePump(mi.streams[0], mi.params);
  if (machine === 'compressor' || machine === 'turbine') {
    return solveCompressorTurbine(mi.streams[0], mi.params, machine);
  }
  return errObj('MB_MACHINE', "params.machine must be 'pump' | 'compressor' | 'turbine'", 'machine');
}

// ---------------------------------------------------------------------------
// 6. REACTOR — conversion reactor (spec Sec 6): ≤ 3 reactions, named
//    limiting reactant each, sequential extents, negativity guard;
//    isothermal / adiabatic / specified-T; dHr298 reported per reaction.
// ---------------------------------------------------------------------------

/**
 * Standard-state molar enthalpy at 298.15 K / 1 atm on the formation basis
 * (natural phase via phaseOf → this equals Hf° of that phase; water resolves
 * liquid, so combustion dHr298 values follow the higher-heating-value
 * convention).
 * @param {string} key
 * @returns {{h_kJmol:number, phase:string}|{error:object}}
 */
function hStd298(key) {
  const ph = phaseOf(key, T_REF, P_ATM);
  if (ph.error) return ph;
  let r;
  if (key === 'H2O') r = waterMolarH(T_REF, P_ATM, ph.phase);
  else if (ph.phase === 'gas') r = hGasMolar(key, T_REF, {});
  else if (ph.phase === 'liquid') r = hLiqMolar(key, T_REF, {});
  else r = hSolMolar(key, T_REF);
  if (r.error) return r;
  return { h_kJmol: r.h_kJmol, phase: ph.phase };
}

/**
 * Conversion reactor. params:
 *   reactions : 1–3 of { stoich:{key:ν, ...} (ν < 0 reactants, ν > 0
 *               products), conversion:X ∈ (0,1] of the limiting reactant,
 *               limiting:key (must appear in stoich with ν < 0) }
 *   mode      : 'isothermal' (default; T_out = feed T) | 'adiabatic'
 *               (solves T_out; optional params.Q_kW adds duty) |
 *               'specified_T' (requires T_out_K)
 *   T_out_K   : outlet T for specified_T
 *   P_out_bar : optional (default feed P)
 * Extents are applied SEQUENTIALLY in the listed order; each extent is
 * clamped so no species goes negative (warning + effective conversion
 * reported). dHr298 per reaction is informational — the duty itself comes
 * from the formation-basis stream enthalpies, so reaction heat is implicit.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveReactor(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const feed = mi.streams[0];
  const p = mi.params;
  const warnings = [];

  const rxns = p.reactions;
  if (!Array.isArray(rxns) || rxns.length < 1 || rxns.length > 3) {
    return errObj('MB_RXN', 'params.reactions must be an array of 1–3 reactions', 'reactions');
  }
  const mode = p.mode === undefined ? 'isothermal' : p.mode;
  if (!['isothermal', 'adiabatic', 'specified_T'].includes(mode)) {
    return errObj('MB_RXN_MODE', "params.mode must be 'isothermal' | 'adiabatic' | 'specified_T'", 'mode');
  }
  if (mode === 'specified_T' && (!num(p.T_out_K) || p.T_out_K <= 0)) {
    return errObj('MB_T', 'specified_T mode requires params.T_out_K > 0', 'T_out_K');
  }
  if (mode !== 'adiabatic' && num(p.Q_kW)) {
    warnings.push(`reactor: params.Q_kW is only used in adiabatic mode — ignored (duty is an output in ${mode})`);
  }
  const P_out = num(p.P_out_bar) ? p.P_out_bar : feed.P_bar;
  if (P_out <= 0) return errObj('MB_P', 'params.P_out_bar must be positive', 'P_out_bar');

  const eIn = streamEnthalpy(feed);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);
  const mol = molarize(feed);
  if (mol.error) return mol;

  // working mole map, insertion order = feed order then first-seen products
  const order = [];
  const n = new Map();
  for (const c of mol.components) {
    order.push(c.key);
    n.set(c.key, c.n_kmol_h);
  }

  const rxnDetails = [];
  for (let j = 0; j < rxns.length; j++) {
    const rx = rxns[j];
    const at = `reactions[${j}]`;
    if (!rx || typeof rx !== 'object' || !rx.stoich || typeof rx.stoich !== 'object') {
      return errObj('MB_RXN', `${at}.stoich must be an object of {key: ν}`, 'reactions');
    }
    const keys = Object.keys(rx.stoich);
    if (keys.length < 2) return errObj('MB_RXN', `${at}.stoich needs at least one reactant and one product`, 'reactions');
    let dHr = 0;
    for (const k of keys) {
      const nu = rx.stoich[k];
      if (!num(nu) || nu === 0) return errObj('MB_RXN', `${at}.stoich['${k}'] must be a nonzero number`, 'reactions');
      const rec = resolve(k);
      if (rec.error) return rec;
      const hs = hStd298(k);
      if (hs.error) return hs;
      dHr += nu * hs.h_kJmol;
      if (!n.has(k)) { order.push(k); n.set(k, 0); }
    }
    const X = rx.conversion;
    if (!num(X) || X <= 0 || X > 1) {
      return errObj('MB_RXN_X', `${at}.conversion must be in (0, 1]`, 'reactions');
    }
    const lim = rx.limiting;
    if (typeof lim !== 'string' || !num(rx.stoich[lim]) || rx.stoich[lim] >= 0) {
      return errObj('MB_RXN_LIMITING', `${at}.limiting must name a reactant (ν < 0) in stoich`, 'reactions');
    }

    const nLim0 = n.get(lim);
    let extent = 0;
    let Xeff = 0;
    if (nLim0 <= 1e-15) {
      warnings.push(`reactor: limiting reactant '${lim}' absent when reaction ${j + 1} runs — extent 0`);
    } else {
      const wanted = (X * nLim0) / -rx.stoich[lim];
      let feasible = Infinity;
      for (const k of keys) {
        const nu = rx.stoich[k];
        if (nu < 0) feasible = Math.min(feasible, n.get(k) / -nu);
      }
      extent = Math.min(wanted, feasible);
      if (extent < wanted - 1e-12) {
        warnings.push(`reactor: reaction ${j + 1} extent clamped by co-reactant depletion (negativity guard) — requested ${wanted.toExponential(4)}, feasible ${feasible.toExponential(4)} kmol/h`);
      }
      for (const k of keys) {
        const v = n.get(k) + rx.stoich[k] * extent;
        n.set(k, Math.abs(v) < 1e-12 ? 0 : v);
      }
      Xeff = (extent * -rx.stoich[lim]) / nLim0;
    }
    rxnDetails.push({
      limiting: lim,
      conversion_requested: X,
      conversion_effective: Xeff,
      extent_kmol_h: extent,
      dHr298_kJmol: dHr,
    });
  }
  for (const [k, v] of n.entries()) {
    if (v < 0) return errObj('MB_RXN_NEGATIVE', `species '${k}' driven negative (${v.toExponential(4)} kmol/h) — check stoichiometry`, 'reactions');
  }

  const entries = order.map((k) => ({ key: k, n_kmol_h: n.get(k) }));
  const outNoT = streamFromMoles(entries, feed.T_K, P_out);
  if (outNoT.error) return outNoT;
  const shape = { mass_flow_kg_h: outNoT.mass_flow_kg_h, P_bar: P_out, components: outNoT.components };

  let T_out;
  let Hout;
  let iterations = 0;
  let converged = true;
  if (mode === 'adiabatic') {
    const target = eIn.H_kJh + (num(p.Q_kW) ? p.Q_kW : 0) * KJH_PER_KW;
    const sol = solveOutletT(shape, target, feed.T_K - 50, feed.T_K + 50);
    if (sol.error) return sol;
    warnings.push(...sol.warnings);
    T_out = sol.T_K;
    Hout = sol.H_kJh;
    iterations = sol.iterations;
    converged = sol.converged;
  } else {
    T_out = mode === 'specified_T' ? p.T_out_K : feed.T_K;
    if (mode === 'isothermal' && num(p.T_out_K) && Math.abs(p.T_out_K - feed.T_K) > 1e-9) {
      warnings.push('reactor: isothermal mode pins T_out to the feed temperature — params.T_out_K ignored (use specified_T)');
    }
    const e = streamEnthalpy(Object.assign({}, shape, { T_K: T_out }));
    if (e.error) return e;
    warnings.push(...e.warnings);
    Hout = e.H_kJh;
  }

  const out = Object.assign({}, shape, { T_K: T_out, H_kJh: Hout });
  return {
    streams_out: [out],
    mass_balance: massBalance(feed.mass_flow_kg_h, out.mass_flow_kg_h),
    energy_balance: energyBalance(eIn.H_kJh, Hout, 0),
    details: {
      mode,
      T_out_K: T_out,
      P_out_bar: P_out,
      reactions: rxnDetails,
      outlet_mole_flows: entries,
    },
    converged,
    iterations,
    warnings,
  };
}

// ===========================================================================
// PART 3 — REACTION-ENGINEERING MODULES (Step 11): cstr, pfr, pfr-recycle.
//
// SCOPE (per spec / project report): LIQUID-BASIS kinetics — constant-density
// incompressible reacting liquid, single rate-controlling reaction, rate law
// pseudo-nth-order in ONE named reactant:  −r_A = k · Ca^n,  n ∈ {0, 1, 2}.
// Concentrations in kmol/m³, volumes in m³, rate constant on the SECONDS
// base:  n=0 → k [kmol/(m³·s)],  n=1 → k [1/s],  n=2 → k [m³/(kmol·s)].
// Arrhenius option: k = A·exp(−Ea/(R·T)) with A in the same units as k and
// Ea in kJ/mol (R = 0.008314462 kJ/mol·K).
//
// Stoichiometry is FULL (all species, ν < 0 reactants / ν > 0 products) so
// the mole bookkeeping conserves mass exactly when Σν·MW = 0; a warning is
// issued when the supplied stoichiometry is mass-inconsistent. Extents are
// clamped so no species goes negative (negativity guard, as in the
// conversion reactor).
//
// Energy: FORMATION BASIS as everywhere else — isothermal duty is simply
// Q = Hout − Hin (reaction heat implicit); adiabatic outlet T solved from
// stream enthalpies via solveOutletT.
//
// pfr-recycle: classic recycle reactor (Fogler Ch. 6 / Levenspiel Ch. 6) —
// fresh feed + recycle mix, PFR pass, splitter returns R·(product flow) as
// recycle. Tear stream (recycle composition + T) converged by WEGSTEIN with
// acceleration factor bounded q ∈ [−5, 0] and fallback to direct
// substitution; tolerances 0.01 % total flow / 1e-3 mass fraction / 0.1 K,
// iteration cap 100.
// ===========================================================================

const KIN_MAX_ITER = 100;      // recycle-tear / adiabatic-CSTR cap
const KIN_TOL_FLOWREL = 1e-4;  // 0.01 % relative on total tear mass flow
const KIN_TOL_X = 1e-3;        // abs on tear mass fractions
const KIN_TOL_T = 0.1;         // K on tear / CSTR temperature
const KIN_CSTR_DAMP = 0.5;     // damping for the adiabatic-CSTR T loop
const PFR_SEGMENTS_DEF = 50;   // default axial segments
const PFR_SEGMENTS_MIN = 5;
const PFR_SEGMENTS_MAX = 500;
const WEGSTEIN_QMIN = -5;      // bounded acceleration factor q ∈ [−5, 0]
const WEGSTEIN_QMAX = 0;

// ---------------------------------------------------------------------------
// shared kinetics helpers
// ---------------------------------------------------------------------------

/**
 * Validate the shared kinetics parameter block and return an evaluator.
 * params: { order:0|1|2, k_si? OR arrhenius:{A_si, Ea_kJmol},
 *           reaction:{ stoich:{key:ν,...}, reactant:key } }
 * Exactly one of k_si / arrhenius must be given. `reactant` must appear in
 * stoich with ν < 0.
 * @param {object} p module params
 * @returns {{order:number, reactant:string, stoich:object,
 *            kAt:(T:number)=>number, kIsConstant:boolean,
 *            warnings:string[]}|{error:object}}
 */
function kineticsSetup(p) {
  const warnings = [];
  const order = p.order;
  if (![0, 1, 2].includes(order)) {
    return errObj('MB_KIN_ORDER', 'params.order must be 0, 1 or 2', 'order');
  }
  const hasK = num(p.k_si);
  const arr = p.arrhenius;
  const hasArr = !!(arr && typeof arr === 'object' && num(arr.A_si) && num(arr.Ea_kJmol));
  if (hasK === hasArr) {
    return errObj('MB_KIN_K',
      'give exactly one of params.k_si or params.arrhenius {A_si, Ea_kJmol}', 'k_si');
  }
  if (hasK && p.k_si <= 0) return errObj('MB_KIN_K', 'params.k_si must be > 0', 'k_si');
  if (hasArr && (arr.A_si <= 0 || arr.Ea_kJmol < 0)) {
    return errObj('MB_KIN_K', 'arrhenius requires A_si > 0 and Ea_kJmol ≥ 0', 'arrhenius');
  }
  const rx = p.reaction;
  if (!rx || typeof rx !== 'object' || !rx.stoich || typeof rx.stoich !== 'object') {
    return errObj('MB_KIN_RXN', 'params.reaction {stoich, reactant} required', 'reaction');
  }
  const keys = Object.keys(rx.stoich);
  if (keys.length < 2) {
    return errObj('MB_KIN_RXN', 'reaction.stoich needs at least one reactant and one product', 'reaction');
  }
  let massSum = 0;
  let massAbs = 0;
  for (const k of keys) {
    const nu = rx.stoich[k];
    if (!num(nu) || nu === 0) {
      return errObj('MB_KIN_RXN', `reaction.stoich['${k}'] must be a nonzero number`, 'reaction');
    }
    const rec = resolve(k);
    if (rec.error) return rec;
    massSum += nu * rec.mw;
    massAbs += Math.abs(nu) * rec.mw;
  }
  if (massAbs > 0 && Math.abs(massSum) / massAbs > 1e-3) {
    warnings.push(`kinetics: reaction stoichiometry is mass-inconsistent by ${(100 * massSum / massAbs).toFixed(3)} % — mass closure will show it`);
  }
  const reactant = rx.reactant;
  if (typeof reactant !== 'string' || !num(rx.stoich[reactant]) || rx.stoich[reactant] >= 0) {
    return errObj('MB_KIN_REACTANT', 'reaction.reactant must name a reactant (ν < 0) in stoich', 'reaction');
  }
  const kAt = hasK
    ? () => p.k_si
    : (T) => arr.A_si * Math.exp(-arr.Ea_kJmol / (R_KJ * T));
  return { order, reactant, stoich: rx.stoich, kAt, kIsConstant: hasK, warnings };
}

/**
 * Mixture liquid density: params.rho_kgm3 override, else mass-weighted
 * harmonic mean of fluids.js rho_liq_kgm3 (1000 kg/m³ assumed with a
 * warning when a component has none) — same convention as the pump.
 * @param {Array<{key:string, mass_fraction:number}>} molComponents
 * @param {object} p module params
 * @param {string[]} warnings appended in place
 * @returns {number|{error:object}} density [kg/m³]
 */
function liquidDensityOf(molComponents, p, warnings) {
  if (num(p.rho_kgm3)) {
    if (p.rho_kgm3 <= 0) return errObj('MB_KIN_RHO', 'params.rho_kgm3 must be > 0', 'rho_kgm3');
    return p.rho_kgm3;
  }
  let invRho = 0;
  for (const c of molComponents) {
    const fRec = fluids.get(c.key);
    let rho = fRec && num(fRec.rho_liq_kgm3) ? fRec.rho_liq_kgm3 : null;
    if (rho == null) {
      rho = 1000;
      warnings.push(`kinetics: no liquid density for '${c.key}' — 1000 kg/m³ assumed (or give params.rho_kgm3)`);
    }
    invRho += c.mass_fraction / rho;
  }
  return 1 / invRho;
}

/**
 * Apply conversion X of the named reactant to a mole map (kmol/h),
 * clamping the extent so no species goes negative.
 * @param {string[]} order species order (extended in place for new products)
 * @param {Map<string,number>} n mole flows [kmol/h] (mutated)
 * @param {object} stoich {key: ν}
 * @param {string} reactant
 * @param {number} X requested conversion of the reactant
 * @param {string[]} warnings appended in place
 * @returns {{extent_kmolh:number, Xeff:number}}
 */
function applyKineticConversion(order, n, stoich, reactant, X, warnings) {
  for (const k of Object.keys(stoich)) {
    if (!n.has(k)) { order.push(k); n.set(k, 0); }
  }
  const nA0 = n.get(reactant);
  if (nA0 <= 1e-15) return { extent_kmolh: 0, Xeff: 0 };
  const wanted = (X * nA0) / -stoich[reactant];
  let feasible = Infinity;
  for (const k of Object.keys(stoich)) {
    if (stoich[k] < 0) feasible = Math.min(feasible, n.get(k) / -stoich[k]);
  }
  const extent = Math.min(wanted, feasible);
  if (extent < wanted - 1e-12) {
    warnings.push(`kinetics: conversion clamped by co-reactant depletion — requested extent ${wanted.toExponential(4)}, feasible ${feasible.toExponential(4)} kmol/h`);
  }
  for (const k of Object.keys(stoich)) {
    const v = n.get(k) + stoich[k] * extent;
    n.set(k, Math.abs(v) < 1e-12 ? 0 : v);
  }
  return { extent_kmolh: extent, Xeff: (extent * -stoich[reactant]) / nA0 };
}

/**
 * Max feasible conversion of the reactant given co-reactant inventories.
 * @param {Map<string,number>} n feed mole flows [kmol/h]
 * @param {object} stoich
 * @param {string} reactant
 * @returns {number} X_max ∈ [0, 1]
 */
function kinXmax(n, stoich, reactant) {
  const nA0 = n.get(reactant) || 0;
  if (nA0 <= 1e-15) return 0;
  let feasible = nA0 / -stoich[reactant];
  for (const k of Object.keys(stoich)) {
    if (stoich[k] < 0 && n.has(k)) feasible = Math.min(feasible, n.get(k) / -stoich[k]);
  }
  return Math.min(1, (feasible * -stoich[reactant]) / nA0);
}

/**
 * Ideal-CSTR conversion for −r_A = k·Ca^n at constant density.
 *   n=0: X = kτ/Ca0        n=1: X = Da/(1+Da), Da = kτ
 *   n=2: kτCa0·X² − (2kτCa0+1)·X + kτCa0 = 0 → physical root
 * @param {number} order 0|1|2
 * @param {number} k    [SI, per order]
 * @param {number} tau  [s]
 * @param {number} Ca0  [kmol/m³]
 * @returns {number} X ∈ [0, 1)
 */
function cstrConversion(order, k, tau, Ca0) {
  if (tau <= 0 || k <= 0) return 0;
  if (order === 0) return Ca0 > 0 ? Math.min(1, (k * tau) / Ca0) : 0;
  if (order === 1) { const Da = k * tau; return Da / (1 + Da); }
  const a = k * tau * Ca0;
  if (a <= 0) return 0;
  return ((2 * a + 1) - Math.sqrt(4 * a + 1)) / (2 * a);
}

/**
 * Residence time for target X in the ideal reactor family.
 *   'cstr' : n=0 Ca0X/k · n=1 X/(k(1−X)) · n=2 X/(kCa0(1−X)²)
 *   'pfr'  : n=0 Ca0X/k · n=1 ln(1/(1−X))/k · n=2 X/(kCa0(1−X))
 * ('pfr' doubles as the constant-volume BATCH time — identical integrals.)
 * @param {('cstr'|'pfr')} ideal
 * @param {number} order 0|1|2
 * @param {number} k
 * @param {number} Ca0 [kmol/m³]
 * @param {number} X ∈ (0, 1)
 * @returns {number} τ [s]
 */
function tauForConversion(ideal, order, k, Ca0, X) {
  if (order === 0) return (Ca0 * X) / k;
  if (order === 1) return ideal === 'cstr' ? X / (k * (1 - X)) : Math.log(1 / (1 - X)) / k;
  return ideal === 'cstr' ? X / (k * Ca0 * (1 - X) * (1 - X)) : X / (k * Ca0 * (1 - X));
}

/**
 * One EXACT constant-density segment of length dτ at fixed k:
 *   n=0: Ca − k·dτ (floored at 0) · n=1: Ca·e^(−k·dτ) · n=2: Ca/(1+k·Ca·dτ)
 * @param {number} order
 * @param {number} k
 * @param {number} Ca [kmol/m³]
 * @param {number} dtau [s]
 * @returns {number} Ca after the segment
 */
function segmentStep(order, k, Ca, dtau) {
  if (Ca <= 0) return 0;
  if (order === 0) return Math.max(0, Ca - k * dtau);
  if (order === 1) return Ca * Math.exp(-k * dtau);
  return Ca / (1 + k * Ca * dtau);
}

/**
 * Validate the shared thermal-mode parameters for the kinetics modules.
 * @param {object} p params
 * @param {string[]} warnings appended in place
 * @returns {{mode:string}|{error:object}}
 */
function kinThermalMode(p, warnings) {
  const mode = p.mode === undefined ? 'isothermal' : p.mode;
  if (!['isothermal', 'adiabatic'].includes(mode)) {
    return errObj('MB_KIN_MODE', "params.mode must be 'isothermal' | 'adiabatic'", 'mode');
  }
  if (mode !== 'adiabatic' && num(p.Q_kW)) {
    warnings.push('kinetics: params.Q_kW is only used in adiabatic mode — ignored (duty is an output in isothermal)');
  }
  return { mode };
}

/**
 * Warn when any flowing outlet component resolves to a NON-liquid phase —
 * the kinetics here are liquid-basis, so a gas-phase resolution flags the
 * result as outside the model's validity envelope.
 * @param {object} eOut streamEnthalpy result
 * @param {string[]} warnings appended in place
 */
function warnIfNotLiquid(eOut, warnings) {
  for (const pc of eOut.perComponent) {
    if (pc.n_kmol_h > 1e-12 && pc.phase && pc.phase !== 'liquid') {
      warnings.push(`kinetics: '${pc.key}' resolves ${pc.phase} at outlet conditions — liquid-basis rate law outside validity`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. CSTR — single pseudo-nth-order liquid reaction; V→X or X→V;
//    Damköhler + batch-time equivalent; isothermal / adiabatic.
// ---------------------------------------------------------------------------

/**
 * CSTR. params:
 *   order, k_si | arrhenius, reaction     — see kineticsSetup
 *   solve_for : 'X' (default; requires V_m3) | 'V' (requires X_target)
 *   V_m3, X_target
 *   mode      : 'isothermal' (default) | 'adiabatic' (+ optional Q_kW)
 *   rho_kgm3  : liquid-density override [kg/m³]
 *   P_out_bar : optional (default feed P)
 * Adiabatic + solve X: k depends on the (unknown) outlet T, so the loop
 * damped-iterates T_out ↔ X with cap 100 / 0.1 K tolerance; NOTE the
 * exothermic adiabatic CSTR can have MULTIPLE steady states — the returned
 * one is the branch reached from the feed temperature (warning issued).
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveCSTR(input) {
  return solveIdealReactor(input, 'cstr');
}

// ---------------------------------------------------------------------------
// 8. PFR — same kinetics, exact-per-segment axial march (default 50
//    segments), adiabatic per-segment T update, profile [{z,X,Ca,T}].
// ---------------------------------------------------------------------------

/**
 * PFR. params as CSTR plus:
 *   segments : axial segments (default 50, 5–500)
 * solve_for 'V' (X_target → V) is ISOTHERMAL ONLY (closed-form τ); the
 * profile is then reported at the resulting volume. Each segment is solved
 * with the EXACT constant-density kinetic step at the segment-inlet k(T), so
 * the isothermal march reproduces the analytic conversion to machine
 * precision at any segment count; adiabatic accuracy improves with segments.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solvePFR(input) {
  return solveIdealReactor(input, 'pfr');
}

/**
 * Shared CSTR/PFR implementation (they differ only in the design equation
 * and the axial march).
 * @param {{streams:Array, params:object}} input
 * @param {('cstr'|'pfr')} ideal
 * @returns {object} module result or error envelope
 */
function solveIdealReactor(input, ideal) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const feed = mi.streams[0];
  const p = mi.params;
  const warnings = [];

  const kin = kineticsSetup(p);
  if (kin.error) return kin;
  warnings.push(...kin.warnings);
  const tm = kinThermalMode(p, warnings);
  if (tm.error) return tm;
  const mode = tm.mode;

  const solveFor = p.solve_for === undefined ? 'X' : p.solve_for;
  if (!['X', 'V'].includes(solveFor)) {
    return errObj('MB_KIN_SOLVEFOR', "params.solve_for must be 'X' | 'V'", 'solve_for');
  }
  if (solveFor === 'X' && (!num(p.V_m3) || p.V_m3 <= 0)) {
    return errObj('MB_KIN_V', "solve_for 'X' requires params.V_m3 > 0", 'V_m3');
  }
  if (solveFor === 'V' && (!num(p.X_target) || p.X_target <= 0 || p.X_target >= 1)) {
    return errObj('MB_KIN_X', "solve_for 'V' requires params.X_target in (0, 1)", 'X_target');
  }
  if (solveFor === 'V' && mode === 'adiabatic' && ideal === 'pfr') {
    return errObj('MB_KIN_SOLVEFOR', "pfr solve_for 'V' is isothermal only — march the volume (solve_for 'X') for adiabatic", 'solve_for');
  }
  let segments = PFR_SEGMENTS_DEF;
  if (ideal === 'pfr' && p.segments !== undefined) {
    if (!num(p.segments) || p.segments < PFR_SEGMENTS_MIN || p.segments > PFR_SEGMENTS_MAX) {
      return errObj('MB_KIN_SEG', `params.segments must be ${PFR_SEGMENTS_MIN}–${PFR_SEGMENTS_MAX}`, 'segments');
    }
    segments = Math.round(p.segments);
  }
  const P_out = num(p.P_out_bar) ? p.P_out_bar : feed.P_bar;
  if (P_out <= 0) return errObj('MB_P', 'params.P_out_bar must be positive', 'P_out_bar');

  const eIn = streamEnthalpy(feed);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);
  const mol = molarize(feed);
  if (mol.error) return mol;

  const rho = liquidDensityOf(mol.components, p, warnings);
  if (rho.error) return rho;
  const v_m3s = feed.mass_flow_kg_h / rho / 3600;    // constant-density volumetric flow
  if (!(v_m3s > 0)) return errObj('MB_KIN_FLOW', 'feed mass flow must be > 0', 'mass_flow_kg_h');

  const order0 = [];
  const n0 = new Map();
  for (const c of mol.components) { order0.push(c.key); n0.set(c.key, c.n_kmol_h); }
  const nA0 = n0.get(kin.reactant) || 0;
  if (nA0 <= 1e-15) {
    return errObj('MB_KIN_REACTANT', `reactant '${kin.reactant}' absent from the feed`, 'reaction');
  }
  const Ca0 = (nA0 / 3600) / v_m3s;                  // kmol/m³
  const Xmax = kinXmax(n0, kin.stoich, kin.reactant);
  const Q_kW = mode === 'adiabatic' && num(p.Q_kW) ? p.Q_kW : 0;
  const targetH = eIn.H_kJh + Q_kW * KJH_PER_KW;

  /** build outlet stream at conversion X and temperature T (or solve T
   *  adiabatically toward hTarget); returns {out, eOut, Xeff, itT} */
  const outletAt = (X, T_fixed, hTarget) => {
    const ord = order0.slice();
    const n = new Map(n0);
    const ap = applyKineticConversion(ord, n, kin.stoich, kin.reactant, X, warnings);
    const entries = ord.map((k) => ({ key: k, n_kmol_h: n.get(k) }));
    const base = streamFromMoles(entries, feed.T_K, P_out);
    if (base.error) return base;
    const shape = { mass_flow_kg_h: base.mass_flow_kg_h, P_bar: P_out, components: base.components };
    if (hTarget === undefined) {
      const e = streamEnthalpy(Object.assign({}, shape, { T_K: T_fixed }));
      if (e.error) return e;
      return { out: Object.assign({}, shape, { T_K: T_fixed, H_kJh: e.H_kJh }), eOut: e, Xeff: ap.Xeff, itT: 0 };
    }
    const sol = solveOutletT(shape, hTarget, feed.T_K - 60, feed.T_K + 60);
    if (sol.error) return sol;
    const e = streamEnthalpy(Object.assign({}, shape, { T_K: sol.T_K }));
    if (e.error) return e;
    return { out: Object.assign({}, shape, { T_K: sol.T_K, H_kJh: sol.H_kJh }), eOut: e, Xeff: ap.Xeff, itT: sol.iterations };
  };

  let X = 0;
  let V_m3;
  let tau_s;
  let T_out = feed.T_K;
  let iterations = 0;
  let converged = true;
  let profile = null;
  let k_used;

  if (solveFor === 'V') {
    // -------- X_target → V (k at the operating temperature) ---------------
    X = Math.min(p.X_target, Xmax);
    if (X < p.X_target - 1e-12) {
      warnings.push(`kinetics: X_target ${p.X_target} infeasible (co-reactant limit) — clamped to ${X.toFixed(6)}`);
    }
    if (mode === 'adiabatic') {
      // X fixed → outlet composition fixed → T_out from the energy balance
      // in ONE solve; k is then evaluated at T_out. (CSTR contents = outlet.)
      const r = outletAt(X, undefined, targetH);
      if (r.error) return r;
      T_out = r.out.T_K;
      iterations = r.itT;
    }
    k_used = kin.kAt(mode === 'adiabatic' ? T_out : feed.T_K);
    tau_s = tauForConversion(ideal, kin.order, k_used, Ca0, X);
    V_m3 = tau_s * v_m3s;
  } else {
    // -------- V → X --------------------------------------------------------
    V_m3 = p.V_m3;
    tau_s = V_m3 / v_m3s;
    if (ideal === 'cstr') {
      if (mode === 'isothermal' || kin.kIsConstant) {
        // isothermal, or constant k: X in one shot; adiabatic constant-k
        // still needs the single T solve afterwards.
        k_used = kin.kAt(feed.T_K);
        X = Math.min(cstrConversion(kin.order, k_used, tau_s, Ca0), Xmax);
      } else {
        // adiabatic + Arrhenius: damped T ↔ X loop (k at outlet T).
        warnings.push('cstr: adiabatic operation can have multiple steady states — result is the branch reached from the feed temperature');
        let T = feed.T_K;
        let ok = false;
        for (iterations = 1; iterations <= KIN_MAX_ITER; iterations++) {
          k_used = kin.kAt(T);
          X = Math.min(cstrConversion(kin.order, k_used, tau_s, Ca0), Xmax);
          const r = outletAt(X, undefined, targetH);
          if (r.error) return r;
          const T_new = r.out.T_K;
          if (Math.abs(T_new - T) < KIN_TOL_T / 2) { T = T_new; ok = true; break; }
          T = KIN_CSTR_DAMP * T + (1 - KIN_CSTR_DAMP) * T_new;
        }
        converged = ok;
        if (!ok) warnings.push(`cstr: adiabatic T↔X loop hit the ${KIN_MAX_ITER}-iteration cap — best estimate returned`);
        T_out = T;
        k_used = kin.kAt(T_out);
        X = Math.min(cstrConversion(kin.order, k_used, tau_s, Ca0), Xmax);
      }
    } else {
      // PFR march — exact kinetic step per segment at segment-inlet k(T).
      const m = pfrMarch(kin, mode, segments, tau_s, Ca0, Xmax, feed, order0, n0,
        P_out, eIn.H_kJh, Q_kW, warnings);
      if (m.error) return m;
      X = m.X;
      T_out = m.T_end;
      profile = m.profile;
      iterations = m.iterations;
      converged = m.converged;
      k_used = kin.kAt(mode === 'adiabatic' ? T_out : feed.T_K);
    }
  }

  // final outlet stream (adiabatic: solve T; isothermal: T = feed T)
  const fin = mode === 'adiabatic'
    ? outletAt(X, undefined, targetH)
    : outletAt(X, feed.T_K);
  if (fin.error) return fin;
  warnings.push(...fin.eOut.warnings);
  warnIfNotLiquid(fin.eOut, warnings);
  T_out = fin.out.T_K;
  const Xeff = fin.Xeff;

  // isothermal PFR profile when not produced by a march (solve_for 'V')
  if (ideal === 'pfr' && profile === null) {
    const m = pfrMarch(kin, 'isothermal', segments, tau_s, Ca0, Xmax, feed,
      order0, n0, P_out, eIn.H_kJh, 0, warnings);
    if (!m.error) profile = m.profile;
  }

  const Da = kin.order === 1 ? k_used * tau_s
    : kin.order === 0 ? (Ca0 > 0 ? (k_used * tau_s) / Ca0 : 0)
      : k_used * tau_s * Ca0;                        // Da = k·τ·Ca0^(n−1)
  const batch_s = Xeff > 0 && Xeff < 1
    ? tauForConversion('pfr', kin.order, kin.kAt(mode === 'adiabatic' ? T_out : feed.T_K), Ca0, Xeff)
    : null;

  const details = {
    ideal,
    mode,
    solve_for: solveFor,
    order: kin.order,
    reactant: kin.reactant,
    k_si: k_used,
    rho_kgm3: rho,
    v0_m3h: v_m3s * 3600,
    Ca0_kmolm3: Ca0,
    Ca_out_kmolm3: Ca0 * (1 - Xeff),
    X: Xeff,
    Da,
    tau_s,
    V_m3,
    batch_time_equiv_s: batch_s,
    T_out_K: T_out,
    P_out_bar: P_out,
  };
  if (ideal === 'pfr') { details.segments = segments; details.profile = profile; }

  return {
    streams_out: [fin.out],
    mass_balance: massBalance(feed.mass_flow_kg_h, fin.out.mass_flow_kg_h),
    energy_balance: energyBalance(eIn.H_kJh, fin.out.H_kJh, 0),
    details,
    converged,
    iterations,
    warnings,
  };
}

/**
 * Axial PFR march: `segments` exact kinetic steps of dτ = τ/segments each,
 * k evaluated at the SEGMENT-INLET temperature; adiabatic T after each
 * segment solved from the formation-basis energy balance with Q distributed
 * uniformly along the length.
 * @returns {{X:number, T_end:number, iterations:number, converged:boolean,
 *            profile:Array<{z:number,X:number,Ca_kmolm3:number,T_K:number}>}
 *           |{error:object}}
 */
function pfrMarch(kin, mode, segments, tau_s, Ca0, Xmax, feed, order0, n0,
  P_out, Hin_kJh, Q_kW, warnings) {
  const dtau = tau_s / segments;
  let Ca = Ca0;
  let T = feed.T_K;
  let iterations = 0;
  let converged = true;
  const profile = [{ z: 0, X: 0, Ca_kmolm3: Ca0, T_K: T }];
  const CaFloor = Ca0 * (1 - Xmax);                  // co-reactant feasibility floor
  for (let s = 1; s <= segments; s++) {
    const k = kin.kAt(T);
    Ca = Math.max(CaFloor, segmentStep(kin.order, k, Ca, dtau));
    const X = Ca0 > 0 ? 1 - Ca / Ca0 : 0;
    if (mode === 'adiabatic') {
      const ord = order0.slice();
      const n = new Map(n0);
      applyKineticConversion(ord, n, kin.stoich, kin.reactant, X, []);
      const entries = ord.map((kk) => ({ key: kk, n_kmol_h: n.get(kk) }));
      const base = streamFromMoles(entries, T, P_out);
      if (base.error) return base;
      const shape = { mass_flow_kg_h: base.mass_flow_kg_h, P_bar: P_out, components: base.components };
      const target = Hin_kJh + Q_kW * KJH_PER_KW * (s / segments);
      const sol = solveOutletT(shape, target, T - 60, T + 60);
      if (sol.error) return sol;
      iterations += sol.iterations;
      if (!sol.converged) converged = false;
      T = sol.T_K;
    }
    profile.push({ z: s / segments, X, Ca_kmolm3: Ca, T_K: T });
  }
  return { X: profile[segments].X, T_end: T, iterations, converged, profile };
}

// ---------------------------------------------------------------------------
// 9. PFR + RECYCLE — recycle ratio R = recycle/product (Fogler Ch. 6);
//    tear stream converged by bounded Wegstein (q ∈ [−5, 0], fallback to
//    direct substitution); reports per-pass X_sp and overall X_ov.
// ---------------------------------------------------------------------------

/**
 * One bounded-Wegstein update for a scalar tear variable.
 * @param {number} x   current tear input
 * @param {number} gx  map output g(x)
 * @param {number} xp  previous tear input
 * @param {number} gp  previous map output
 * @param {boolean} accelerate apply Wegstein (else direct substitution)
 * @returns {{next:number, q:number, s:number|null}} s = estimated map slope
 */
function wegsteinStep(x, gx, xp, gp, accelerate) {
  if (!accelerate || !num(xp) || !num(gp)) return { next: gx, q: 0, s: null };
  const dx = x - xp;
  if (Math.abs(dx) < 1e-14) return { next: gx, q: 0, s: null };
  const s = (gx - gp) / dx;
  if (!isFinite(s) || Math.abs(s - 1) < 1e-12) return { next: gx, q: 0, s: null }; // fallback
  let q = s / (s - 1);
  if (q < WEGSTEIN_QMIN) q = WEGSTEIN_QMIN;
  if (q > WEGSTEIN_QMAX) q = WEGSTEIN_QMAX;
  return { next: q * x + (1 - q) * gx, q, s };
}

/**
 * PFR with recycle. params:
 *   order, k_si | arrhenius, reaction   — see kineticsSetup
 *   V_m3      : reactor volume (> 0)
 *   R         : recycle ratio, recycle flow / product flow (≥ 0)
 *   mode      : 'isothermal' (default; whole loop at fresh-feed T)
 *               | 'adiabatic' (mixing point + reactor adiabatic; + Q_kW)
 *   rho_kgm3, segments, P_out_bar : as PFR
 * Flowsheet: fresh + recycle → PFR(V) → splitter; recycle = R/(1+R) of the
 * reactor effluent, product = 1/(1+R). TEAR = the recycle stream (component
 * mole flows + T), converged by Wegstein with q ∈ [−5, 0] (fallback direct
 * substitution). Tolerances: 0.01 % total tear flow, 1e-3 tear mass
 * fractions, 0.1 K; cap 100. R = 0 short-circuits to a single PFR pass.
 * details reports X_sp (per pass, across the reactor) and X_ov (overall,
 * fresh basis); module streams_out = [product], so at convergence the mass
 * closure is exact on the fresh-in / product-out envelope.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solvePFRRecycle(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const fresh = mi.streams[0];
  const p = mi.params;
  const warnings = [];

  const kin = kineticsSetup(p);
  if (kin.error) return kin;
  warnings.push(...kin.warnings);
  const tm = kinThermalMode(p, warnings);
  if (tm.error) return tm;
  const mode = tm.mode;

  if (!num(p.V_m3) || p.V_m3 <= 0) return errObj('MB_KIN_V', 'params.V_m3 > 0 required', 'V_m3');
  const R = num(p.R) ? p.R : null;
  if (!num(R) || R < 0) return errObj('MB_KIN_R', 'params.R (recycle ratio ≥ 0) required', 'R');
  let segments = PFR_SEGMENTS_DEF;
  if (p.segments !== undefined) {
    if (!num(p.segments) || p.segments < PFR_SEGMENTS_MIN || p.segments > PFR_SEGMENTS_MAX) {
      return errObj('MB_KIN_SEG', `params.segments must be ${PFR_SEGMENTS_MIN}–${PFR_SEGMENTS_MAX}`, 'segments');
    }
    segments = Math.round(p.segments);
  }
  const P_out = num(p.P_out_bar) ? p.P_out_bar : fresh.P_bar;
  if (P_out <= 0) return errObj('MB_P', 'params.P_out_bar must be positive', 'P_out_bar');

  const eFresh = streamEnthalpy(fresh);
  if (eFresh.error) return eFresh;
  warnings.push(...eFresh.warnings);
  const molF = molarize(fresh);
  if (molF.error) return molF;

  const rho = liquidDensityOf(molF.components, p, warnings);
  if (rho.error) return rho;

  // unified species order: fresh feed first, then stoich-only species
  const species = [];
  const nFresh = new Map();
  for (const c of molF.components) { species.push(c.key); nFresh.set(c.key, c.n_kmol_h); }
  for (const k of Object.keys(kin.stoich)) {
    if (!nFresh.has(k)) { species.push(k); nFresh.set(k, 0); }
  }
  const nA_fresh = nFresh.get(kin.reactant) || 0;
  if (nA_fresh <= 1e-15) {
    return errObj('MB_KIN_REACTANT', `reactant '${kin.reactant}' absent from the fresh feed`, 'reaction');
  }
  const Q_kW = mode === 'adiabatic' && num(p.Q_kW) ? p.Q_kW : 0;

  /** one flowsheet pass: tear (recycle mole flows [kmol/h] + T) →
   *  new recycle after mix → reactor → split. */
  const passOnce = (tearN, tearT) => {
    // ---- mixing point --------------------------------------------------
    const nMix = species.map((k, i) => nFresh.get(k) + tearN[i]);
    const entries = species.map((k, i) => ({ key: k, n_kmol_h: nMix[i] }));
    const mixBase = streamFromMoles(entries, fresh.T_K, fresh.P_bar);
    if (mixBase.error) return mixBase;
    let T_mix = fresh.T_K;
    if (mode === 'adiabatic' && tearN.some((x) => x > 0)) {
      const tearEntries = species.map((k, i) => ({ key: k, n_kmol_h: tearN[i] }));
      const tearBase = streamFromMoles(tearEntries, tearT, P_out);
      if (tearBase.error) return tearBase;
      const eTear = streamEnthalpy(Object.assign({}, tearBase, { T_K: tearT }));
      if (eTear.error) return eTear;
      const shape = { mass_flow_kg_h: mixBase.mass_flow_kg_h, P_bar: fresh.P_bar, components: mixBase.components };
      const sol = solveOutletT(shape, eFresh.H_kJh + eTear.H_kJh,
        Math.min(fresh.T_K, tearT) - 30, Math.max(fresh.T_K, tearT) + 30);
      if (sol.error) return sol;
      T_mix = sol.T_K;
    }
    // ---- reactor pass --------------------------------------------------
    const v_mix = mixBase.mass_flow_kg_h / rho / 3600;      // m³/s
    const tau = p.V_m3 / v_mix;
    const nMixMap = new Map(species.map((k, i) => [k, nMix[i]]));
    const nA_mix = nMixMap.get(kin.reactant);
    const CaMix = (nA_mix / 3600) / v_mix;
    const XmaxP = kinXmax(nMixMap, kin.stoich, kin.reactant);
    const mixFeed = Object.assign({}, mixBase, { T_K: T_mix });
    const eMix = streamEnthalpy(mixFeed);
    if (eMix.error) return eMix;
    const m = pfrMarch(kin, mode, segments, tau, CaMix, XmaxP, mixFeed,
      species.slice(), nMixMap, P_out, eMix.H_kJh, Q_kW, []);
    if (m.error) return m;
    // outlet mole flows at per-pass conversion m.X
    const ordOut = species.slice();
    const nOut = new Map(nMixMap);
    applyKineticConversion(ordOut, nOut, kin.stoich, kin.reactant, m.X, []);
    const outFlows = species.map((k) => nOut.get(k));
    // ---- splitter ------------------------------------------------------
    const fRec = R / (1 + R);
    return {
      recycleN: outFlows.map((x) => Math.max(0, x * fRec)),
      recycleT: m.T_end,
      productN: outFlows.map((x) => Math.max(0, x * (1 - fRec))),
      T_out: m.T_end,
      X_sp: m.X,
      tau_s: tau,
      CaMix,
      profile: m.profile,
      marchConverged: m.converged,
    };
  };

  // ---- tear iteration (Wegstein) ---------------------------------------
  // MASS-CONSTRAINED TEAR: for this splitter-only loop the converged recycle
  // mass is known a priori — m_recycle = R · m_fresh (splitter balance) — so
  // each pass's recycle is rescaled onto that mass before the Wegstein
  // update. This removes the slowly-contracting total-mass mode (direct-
  // substitution slope R/(1+R) → 1 for large R, which the bounded q ∈ [−5,0]
  // cannot fully accelerate) and makes the fresh-in/product-out closure
  // exact by construction; Wegstein then only has to converge composition
  // and temperature, which contract at the per-pass reaction rate.
  const mFresh = fresh.mass_flow_kg_h;
  const mwOf = species.map((k) => resolve(k).mw);
  const tearMassTarget = R * mFresh;
  const rescaleToTearMass = (N) => {
    let m = 0;
    for (let i = 0; i < N.length; i++) m += N[i] * mwOf[i];
    if (!(m > 0) || !(tearMassTarget > 0)) return N.map(() => 0);
    const f = tearMassTarget / m;
    return N.map((x) => x * f);
  };
  let tearN = rescaleToTearMass(species.map((k) => nFresh.get(k)));
  let tearT = fresh.T_K;
  let prevIn = null;                                  // {N:[], T}
  let prevOut = null;
  // Wegstein slope estimate of the dominant tear mode: the RESIDUAL
  // ‖g(x)−x‖ understates the true tear error by 1/(1−s) for a contraction
  // of slope s (→ 1 as R grows), so the spec tolerances are applied as
  // residual ≤ tol·(1−ŝ) — the spec numbers then bound the TRUE error.
  let sHat = 0;
  let last = null;
  let iterations = 0;
  let converged = R === 0;                            // R=0: single pass below
  for (let it = 1; it <= (R === 0 ? 1 : KIN_MAX_ITER); it++) {
    iterations = it;
    last = passOnce(tearN, tearT);
    if (last.error) return last;
    if (R === 0) { converged = true; break; }
    const rawRecycleMass = last.recycleN.reduce((a, x, i) => a + x * mwOf[i], 0);
    last.recycleN = rescaleToTearMass(last.recycleN);
    // convergence: g(x) vs x — 0.01 % total mass flow (raw, pre-rescale, so
    // the splitter balance itself is verified), 1e-3 mass fractions, 0.1 K
    let massIn = 0;
    let massOut = 0;
    for (let i = 0; i < species.length; i++) {
      massIn += tearN[i] * mwOf[i];
      massOut += last.recycleN[i] * mwOf[i];
    }
    const resFactor = 1 - sHat;                       // residual → true-error scaling
    const flowOk = Math.abs(rawRecycleMass - massIn)
      <= KIN_TOL_FLOWREL * resFactor * Math.max(rawRecycleMass, 1e-12);
    let fracOk = true;
    for (let i = 0; i < species.length; i++) {
      const wIn = massIn > 0 ? (tearN[i] * mwOf[i]) / massIn : 0;
      const wOut = massOut > 0 ? (last.recycleN[i] * mwOf[i]) / massOut : 0;
      if (Math.abs(wOut - wIn) > KIN_TOL_X * resFactor) { fracOk = false; break; }
    }
    const tOk = Math.abs(last.recycleT - tearT) <= KIN_TOL_T * Math.max(resFactor, 0.05);
    if (flowOk && fracOk && tOk && it > 1) { converged = true; break; }
    // Wegstein update per tear variable (from iteration 2 onward);
    // ŝ = flow-weighted max estimated slope, clamped to [0, 0.995]
    const acc = it >= 2;
    let sMax = 0;
    const nextN = species.map((_, i) => {
      const w = wegsteinStep(tearN[i], last.recycleN[i],
        prevIn ? prevIn.N[i] : NaN, prevOut ? prevOut.N[i] : NaN, acc);
      if (w.s !== null && last.recycleN[i] * mwOf[i] > 1e-6 * tearMassTarget) {
        sMax = Math.max(sMax, Math.min(Math.abs(w.s), 0.995));
      }
      return Math.max(0, w.next);
    });
    const wT = wegsteinStep(tearT, last.recycleT,
      prevIn ? prevIn.T : NaN, prevOut ? prevOut.T : NaN, acc);
    if (acc) sHat = sMax;
    prevIn = { N: tearN, T: tearT };
    prevOut = { N: last.recycleN, T: last.recycleT };
    tearN = nextN;
    tearT = Math.max(MODULE_T_FLOOR, wT.next);
  }
  if (!converged) {
    warnings.push(`pfr-recycle: tear not converged in ${KIN_MAX_ITER} Wegstein iterations — best estimate returned`);
  }
  if (!last.marchConverged) converged = false;

  // ---- product stream + overall conversion -----------------------------
  const prodEntries = species.map((k, i) => ({ key: k, n_kmol_h: last.productN[i] }));
  const prodBase = streamFromMoles(prodEntries, last.T_out, P_out);
  if (prodBase.error) return prodBase;
  const eProd = streamEnthalpy(Object.assign({}, prodBase, { T_K: last.T_out }));
  if (eProd.error) return eProd;
  warnings.push(...eProd.warnings);
  warnIfNotLiquid(eProd, warnings);
  const product = Object.assign({}, prodBase, { T_K: last.T_out, H_kJh: eProd.H_kJh });

  const iA = species.indexOf(kin.reactant);
  const X_ov = 1 - last.productN[iA] / nA_fresh;
  const recEntries = species.map((k, i) => ({ key: k, n_kmol_h: last.recycleN[i] }));
  const recBase = streamFromMoles(recEntries, last.recycleT, P_out);
  if (recBase.error) return recBase;
  const k_used = kin.kAt(mode === 'adiabatic' ? last.T_out : fresh.T_K);
  const v_fresh = fresh.mass_flow_kg_h / rho / 3600;

  return {
    streams_out: [product],
    mass_balance: massBalance(fresh.mass_flow_kg_h, product.mass_flow_kg_h),
    energy_balance: energyBalance(eFresh.H_kJh, product.H_kJh, 0),
    details: {
      mode,
      order: kin.order,
      reactant: kin.reactant,
      R,
      k_si: k_used,
      rho_kgm3: rho,
      V_m3: p.V_m3,
      segments,
      v_fresh_m3h: v_fresh * 3600,
      Da0_fresh_basis: kin.order === 1 ? k_used * (p.V_m3 / v_fresh)
        : k_used * (p.V_m3 / v_fresh) * Math.pow((nA_fresh / 3600) / v_fresh, kin.order - 1),
      tau_reactor_s: last.tau_s,
      Ca_mix_kmolm3: last.CaMix,
      X_sp: last.X_sp,
      X_ov,
      T_out_K: last.T_out,
      P_out_bar: P_out,
      recycle_stream: {
        mass_flow_kg_h: recBase.mass_flow_kg_h,
        T_K: last.recycleT,
        components: recBase.components,
      },
      profile: last.profile,
    },
    converged,
    iterations,
    warnings,
  };
}

// ===========================================================================
// PART 4 — STEAM-REFORMING MODULES (Step 12): smr, atr.
//
// CHEMISTRY (per spec): higher alkanes are PRE-CRACKED fully,
//     CnH2n+2 + n H2O  →  n CO + (2n+1) H2      (C2H6, C3H8, nC4H10),
// then the two simultaneous equilibria are solved at the outlet condition:
//     R1  CH4 + H2O ⇌ CO + 3 H2    ln K1 = 30.114 − 26830/T   [K1 in bar²]
//                                   (Twigg, Catalyst Handbook)
//     R2  CO + H2O ⇌ CO2 + H2      ln K2 = 4400/T − 4.036      [dimensionless]
//                                   (Moe 1962)
// Each reaction is evaluated at T_out + its APPROACH-TO-EQUILIBRIUM offset
// (params.ate_smr_K, default 0 K; params.ate_wgs_K, default 10 K).
//
// SOLVER: 2×2 damped Newton on the extents (e1, e2) in LOG-RESIDUAL form
//     F1 = ln(y_CO·y_H2³ / (y_CH4·y_H2O)) + 2·ln P − ln K1(T1)
//     F2 = ln(y_CO2·y_H2 / (y_CO·y_H2O)) − ln K2(T2)
// with a coarse feasible-box seed scan, numerical Jacobian, step backtracking
// that enforces strict species positivity, iteration cap 200 and a converged
// flag. Negative extents (methanation / reverse shift) are permitted.
//
// MODES:
//   smr 'fired'     : 1 process stream; T_out specified; the furnace duty is
//                     Q_furnace = Hout − Hin on the formation basis, and the
//                     firing rate follows from params.fuel_lhv_kJkg and
//                     params.furnace_efficiency.
//   smr 'secondary' : 2 streams (process + air/O2). ALL O2 is first consumed
//                     by CH4 combustion (CH4 + 2 O2 → CO2 + 2 H2O), then the
//                     equilibrium is solved; T_out is ADIABATIC, found by an
//                     outer bisection on [800, 1600] K.
//   atr             : 1 hydrocarbon stream + params.s_c_ratio / o2_c_ratio;
//                     the engine constructs the steam and oxidant (O2 or air)
//                     streams, then runs the same machinery adiabatically.
//
// Outputs per module: wet + dry composition, H2/CO ratio, CH4 slip (dry %),
// S/C check against params.s_c_min (default 2.5), duty / fuel (fired), and
// the usual mass/energy-balance blocks. N2, Ar, He pass through as inerts.
// ===========================================================================

const SMR_LNK1_A = 30.114;      // ln K1 = A − B/T  [bar²] (Twigg)
const SMR_LNK1_B = 26830;
const SMR_LNK2_A = 4400;        // ln K2 = A/T − B  [–]    (Moe 1962)
const SMR_LNK2_B = 4.036;
const SMR_ATE_SMR_DEF = 0;      // K — default approach-to-equilibrium, R1
const SMR_ATE_WGS_DEF = 10;     // K — default approach-to-equilibrium, R2
const SMR_NEWTON_MAX = 200;     // Newton iteration cap (per spec)
const SMR_NEWTON_TOL = 1e-9;    // max |F| in log units
const SMR_SEED_GRID = 24;       // seed-scan resolution per extent
const SMR_ADIA_TLO = 800;       // K — adiabatic outer-bisection bracket
const SMR_ADIA_THI = 1600;
const SMR_ADIA_MAX = 100;       // outer-bisection cap
const SMR_ADIA_TOLK = 0.01;     // K — outer-bisection T tolerance
const SMR_T_MIN = 500;          // K — fired-mode T_out sanity window
const SMR_T_MAX = 1500;
const SMR_SC_MIN_DEF = 2.5;     // default S/C coking-check threshold (smr)
const SMR_SC_MIN_ATR_DEF = 0.5; // default S/C threshold for atr (O2-assisted)
const SMR_EPS = 1e-18;          // relative positivity floor in the solver
                                // (equilibrium CO in a methanator sits at
                                // ~1e-14·N — the floor must sit well below)
const SMR_AIR_O2 = 0.21;        // mole fraction O2 in dry air
const SMR_AIR_N2 = 0.79;

/** Alkanes pre-cracked fully: key → carbon number n in CnH2n+2. */
const SMR_ALKANES = { C2H6: 2, C3H8: 3, nC4H10: 4 };
/** Species participating in the two equilibria. */
const SMR_REACTING = ['CH4', 'H2O', 'CO', 'H2', 'CO2'];
/** Species accepted as pass-through inerts. */
const SMR_INERTS = ['N2', 'Ar', 'He'];

/**
 * Validate a reformer feed and split it into a working mole map.
 * Accepted keys: CH4, the SMR_ALKANES, H2O, CO, CO2, H2, O2 (only when
 * allowO2), and the SMR_INERTS. Any other component is rejected — an
 * unconverted C2+ olefin or heavy at reformer conditions would silently
 * corrupt the equilibrium.
 * @param {object} feed stream object
 * @param {boolean} allowO2 accept O2 in this stream
 * @returns {{n:Map<string,number>, nC_hydrocarbon:number, nH2O:number,
 *            nO2:number, warnings:string[]}|{error:object}}
 */
function smrFeedMoles(feed, allowO2) {
  const mol = molarize(feed);
  if (mol.error) return mol;
  const warnings = mol.warnings.slice();
  const n = new Map();
  let nC = 0;
  let nO2 = 0;
  for (const c of mol.components) {
    const k = c.key;
    const ok = k === 'CH4' || k === 'H2O' || k === 'CO' || k === 'CO2' ||
      k === 'H2' || SMR_ALKANES[k] !== undefined || SMR_INERTS.includes(k) ||
      (allowO2 && k === 'O2');
    if (!ok) {
      return errObj('MB_SMR_FEED',
        `component '${k}' is not supported by the reformer modules — allowed: CH4, C2H6, C3H8, nC4H10, H2O, CO, CO2, H2, ${allowO2 ? 'O2, ' : ''}N2, Ar, He`,
        'streams');
    }
    if (k === 'CH4') nC += c.n_kmol_h;
    if (SMR_ALKANES[k] !== undefined) nC += SMR_ALKANES[k] * c.n_kmol_h;
    if (k === 'O2') nO2 += c.n_kmol_h;
    n.set(k, (n.get(k) || 0) + c.n_kmol_h);
  }
  return { n, nC_hydrocarbon: nC, nH2O: n.get('H2O') || 0, nO2, warnings };
}

/**
 * Pre-crack all C2+ alkanes fully: CnH2n+2 + n H2O → n CO + (2n+1) H2.
 * Errors when the steam inventory cannot cover the crack (the spec demands
 * FULL cracking, so a shortfall cannot be clamped).
 * @param {Map<string,number>} n working mole map [kmol/h] — mutated
 * @param {string[]} warnings appended in place
 * @returns {{cracked:Array<{key:string,n_kmol_h:number}>}|{error:object}}
 */
function smrPrecrack(n, warnings) {
  const cracked = [];
  let steamNeed = 0;
  for (const k of Object.keys(SMR_ALKANES)) {
    steamNeed += SMR_ALKANES[k] * (n.get(k) || 0);
  }
  if (steamNeed > (n.get('H2O') || 0) + 1e-12) {
    return errObj('MB_SMR_STEAM',
      `pre-cracking the C2+ alkanes needs ${steamNeed.toExponential(4)} kmol/h H2O but only ${((n.get('H2O') || 0)).toExponential(4)} is fed — raise the steam rate`,
      'streams');
  }
  for (const k of Object.keys(SMR_ALKANES)) {
    const a = n.get(k) || 0;
    if (a <= 0) continue;
    const nc = SMR_ALKANES[k];
    n.set(k, 0);
    n.set('H2O', (n.get('H2O') || 0) - nc * a);
    n.set('CO', (n.get('CO') || 0) + nc * a);
    n.set('H2', (n.get('H2') || 0) + (2 * nc + 1) * a);
    cracked.push({ key: k, n_kmol_h: a });
    warnings.push(`smr: pre-cracked ${a.toExponential(4)} kmol/h ${k} (consumed ${(nc * a).toExponential(4)} kmol/h H2O)`);
  }
  return { cracked };
}

/**
 * Consume ALL O2 by CH4 combustion, CH4 + 2 O2 → CO2 + 2 H2O.
 * O2 beyond the sub-stoichiometric window (O2 > 2·CH4) is an error — the
 * equilibrium set has no oxidation path for the surplus and treating free O2
 * as an inert would be chemically wrong.
 * @param {Map<string,number>} n working mole map — mutated; O2 removed
 * @param {number} nO2 kmol/h O2 fed
 * @returns {{ch4_burned_kmol_h:number}|{error:object}}
 */
function smrCombustO2(n, nO2) {
  const x = nO2 / 2; // kmol/h CH4 burned
  const ch4 = n.get('CH4') || 0;
  if (x > ch4 + 1e-12) {
    return errObj('MB_SMR_O2',
      `O2 feed (${nO2.toExponential(4)} kmol/h) exceeds the CH4 combustion capacity (CH4 = ${ch4.toExponential(4)} kmol/h, O2/CH4 must stay below 2)`,
      'streams');
  }
  n.set('CH4', ch4 - x);
  n.set('CO2', (n.get('CO2') || 0) + x);
  n.set('H2O', (n.get('H2O') || 0) + 2 * x);
  n.delete('O2');
  return { ch4_burned_kmol_h: x };
}

/**
 * Simultaneous equilibrium of R1 (at T1) and R2 (at T2), total pressure
 * P_bar. 2×2 damped Newton on the extents in log-residual form with a
 * coarse seed scan; strict positivity enforced by backtracking.
 * @param {Map<string,number>} n0 pre-equilibrium moles [kmol/h]
 * @param {number} T1_K R1 equilibrium temperature (T_out + ATE_smr)
 * @param {number} T2_K R2 equilibrium temperature (T_out + ATE_wgs)
 * @param {number} P_bar total pressure
 * @returns {{n:Map<string,number>, e1_kmol_h:number, e2_kmol_h:number,
 *            lnK1:number, lnK2:number, iterations:number,
 *            converged:boolean}|{error:object}}
 */
function reformerEquilibrium(n0, T1_K, T2_K, P_bar) {
  const a = n0.get('CH4') || 0;
  const b = n0.get('H2O') || 0;
  const c = n0.get('CO') || 0;
  const d = n0.get('H2') || 0;
  const f = n0.get('CO2') || 0;
  if (a + c + f <= 0 || b + d <= 0) {
    return errObj('MB_SMR_FEED',
      'reformer feed carries no carbon (CH4/CO/CO2) or no hydrogen (H2O/H2) after pre-processing',
      'streams');
  }
  let Ninert = 0;
  for (const [k, v] of n0.entries()) {
    if (!SMR_REACTING.includes(k)) Ninert += v;
  }
  const N0 = a + b + c + d + f + Ninert;
  const floor = SMR_EPS * N0;
  const lnK1 = SMR_LNK1_A - SMR_LNK1_B / T1_K;
  const lnK2 = SMR_LNK2_A / T2_K - SMR_LNK2_B;
  const lnP = Math.log(P_bar);

  /** species moles at extents (e1, e2); null when any goes ≤ floor */
  const molesAt = (e1, e2) => {
    const m = {
      CH4: a - e1, H2O: b - e1 - e2, CO: c + e1 - e2,
      H2: d + 3 * e1 + e2, CO2: f + e2,
    };
    for (const k of SMR_REACTING) if (m[k] <= floor) return null;
    return m;
  };
  /** log residuals [F1, F2]; null when infeasible */
  const F = (e1, e2) => {
    const m = molesAt(e1, e2);
    if (!m) return null;
    const N = m.CH4 + m.H2O + m.CO + m.H2 + m.CO2 + Ninert;
    const F1 = Math.log(m.CO) + 3 * Math.log(m.H2) - Math.log(m.CH4) -
      Math.log(m.H2O) - 2 * Math.log(N) + 2 * lnP - lnK1;
    const F2 = Math.log(m.CO2) + Math.log(m.H2) - Math.log(m.CO) -
      Math.log(m.H2O) - lnK2;
    return [F1, F2];
  };

  // SEED by nested bisection, then let the Newton polish. F2 is STRICTLY
  // increasing in e2 (Δn = 0, d F2/d e2 = 1/CO2 + 1/H2 + 1/CO + 1/H2O > 0)
  // and diverges to ∓∞ at the e2 feasibility bounds, so the inner root is
  // unique and always bracketed; F1 evaluated at that inner root diverges to
  // ∓∞ at the e1 bounds likewise. This lands the seed within bisection
  // accuracy of the solution even when an extreme K pins an extent within
  // 1e-10 of a bound (e.g. a 500 K fired case), where a grid scan cannot.
  // JOINT feasibility bounds. e2's window given e1 is
  //   ( max(−f, −d−3·e1), min(c+e1, b−e1) )
  // and demanding it be non-empty yields the e1 interval below. The naive
  // per-reaction clamp e1 ≥ −min(c, d/3) is WRONG when CO and CO2 both
  // methanate: the root then has e1 < −c with e2 < 0 keeping CO positive.
  const e1lo = Math.max(-(c + f), -(c + d) / 4, -(b + d) / 2);
  const e1hi = Math.min(a, b + f);
  const e2Bounds = (e1) => [Math.max(-f, -d - 3 * e1), Math.min(c + e1, b - e1)];
  const e2Star = (e1) => {
    let [lo, hi] = e2Bounds(e1);
    const w = 1e-18 * Math.max(hi - lo, N0);
    lo += w;
    hi -= w;
    if (hi <= lo) return null;
    for (let k = 0; k < 100; k++) {
      const mid = 0.5 * (lo + hi);
      const r = F(e1, mid);
      if (!r) return null;
      if (r[1] > 0) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  };
  let best = null;
  {
    let lo = e1lo;
    let hi = e1hi;
    const w = 1e-18 * Math.max(hi - lo, N0);
    lo += w;
    hi -= w;
    for (let k = 0; hi > lo && k < 100; k++) {
      const mid = 0.5 * (lo + hi);
      const em = e2Star(mid);
      const r = em === null ? null : F(mid, em);
      if (!r) {
        // empty/degenerate inner window — walk toward the collapsing side:
        // the CO cap (c+e1) collapsing marks the low-e1 edge
        if (c + mid <= b - mid) lo = mid; else hi = mid;
      } else if (r[0] > 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    // final pick, backing inward if the midpoint window is degenerate
    let e1s = 0.5 * (lo + hi);
    let e2s = e2Star(e1s);
    for (let k = 0; e2s === null && k < 60; k++) {
      e1s = 0.5 * (e1s + (c + e1s > b - e1s ? e1lo : e1hi));
      e2s = e2Star(e1s);
    }
    const rs = e2s === null ? null : F(e1s, e2s);
    if (rs) best = { s: rs[0] * rs[0] + rs[1] * rs[1], e1: e1s, e2: e2s };
  }
  if (!best) {
    // fallback: coarse grid over the feasible box
    for (let i = 1; i < SMR_SEED_GRID; i++) {
      const e1 = e1lo + ((e1hi - e1lo) * i) / SMR_SEED_GRID;
      const [e2lo, e2hi] = e2Bounds(e1);
      for (let j = 1; j < SMR_SEED_GRID; j++) {
        const e2 = e2lo + ((e2hi - e2lo) * j) / SMR_SEED_GRID;
        const r = F(e1, e2);
        if (!r) continue;
        const s = r[0] * r[0] + r[1] * r[1];
        if (!best || s < best.s) best = { s, e1, e2 };
      }
    }
  }
  if (!best) {
    return errObj('MB_SMR_EQ_SEED',
      'no feasible equilibrium extent found — check the feed composition', 'streams');
  }

  // damped Newton with numerical Jacobian and positivity backtracking
  let e1 = best.e1;
  let e2 = best.e2;
  let it = 0;
  let converged = false;
  // Achievable precision of F at (e1, e2): each mole is a sum/difference of
  // terms up to the magnitudes below, so its absolute rounding noise is
  // ~eps·(term sum) and the log-residual noise is the sum of relative mole
  // noises. Near a feasibility corner (e.g. a methanator where CO and CO2
  // both go to ~1e-13·N by cancellation) this dwarfs SMR_NEWTON_TOL — the
  // solve is then converged when it is within what F can resolve.
  const EPSM = 2.220446049250313e-16;
  const noiseAt = (mm, e1v, e2v) => {
    const a1 = Math.abs(e1v);
    const a2 = Math.abs(e2v);
    return 8 * EPSM * ((a + a1) / mm.CH4 + (b + a1 + a2) / mm.H2O +
      (c + a1 + a2) / mm.CO + (d + 3 * a1 + a2) / mm.H2 + (f + a2) / mm.CO2);
  };
  for (; it < SMR_NEWTON_MAX; it++) {
    const r = F(e1, e2);
    if (!r) break; // cannot happen while backtracking holds — belt and braces
    const [F1, F2] = r;
    const mm = molesAt(e1, e2);
    const tolEff = mm ? Math.max(SMR_NEWTON_TOL, noiseAt(mm, e1, e2)) : SMR_NEWTON_TOL;
    if (Math.max(Math.abs(F1), Math.abs(F2)) < tolEff) {
      converged = true;
      break;
    }
    const h = 1e-8 * Math.max(1, Math.abs(e1) + Math.abs(e2), N0 * 1e-6);
    const ra = F(e1 + h, e2) || F(e1 - h, e2);
    const rb = F(e1, e2 + h) || F(e1, e2 - h);
    if (!ra || !rb) break;
    const sa = F(e1 + h, e2) ? h : -h;
    const sb = F(e1, e2 + h) ? h : -h;
    const J11 = (ra[0] - F1) / sa;
    const J21 = (ra[1] - F2) / sa;
    const J12 = (rb[0] - F1) / sb;
    const J22 = (rb[1] - F2) / sb;
    const det = J11 * J22 - J12 * J21;
    if (!num(det) || Math.abs(det) < 1e-300) break;
    const de1 = (-F1 * J22 + F2 * J12) / det;
    const de2 = (-J11 * F2 + J21 * F1) / det;
    const norm0 = F1 * F1 + F2 * F2;
    let alpha = 1;
    let stepped = false;
    for (let k = 0; k < 50; k++) {
      const rt = F(e1 + alpha * de1, e2 + alpha * de2);
      if (rt && rt[0] * rt[0] + rt[1] * rt[1] < norm0) {
        e1 += alpha * de1;
        e2 += alpha * de2;
        stepped = true;
        break;
      }
      alpha *= 0.5;
    }
    if (!stepped) break; // stalled — recheck against achievable precision below
  }
  if (!converged) {
    const r = F(e1, e2);
    const mm = molesAt(e1, e2);
    if (r && mm &&
        Math.max(Math.abs(r[0]), Math.abs(r[1])) < Math.max(SMR_NEWTON_TOL, noiseAt(mm, e1, e2))) {
      converged = true;
    }
  }
  const m = molesAt(e1, e2);
  if (!m) {
    return errObj('MB_SMR_EQ',
      'equilibrium solve left the feasible region — check the feed composition',
      'streams');
  }
  const n = new Map(n0);
  for (const k of SMR_REACTING) n.set(k, m[k]);
  return { n, e1_kmol_h: e1, e2_kmol_h: e2, lnK1, lnK2, iterations: it, converged };
}

/**
 * Wet/dry composition, H2/CO and CH4 slip from an outlet mole map.
 * @param {Map<string,number>} n outlet moles [kmol/h]
 * @param {string[]} order stable key order for the reported arrays
 * @returns {{wet:Array,dry:Array,h2_co_ratio:(number|null),
 *            ch4_slip_dry_pct:number}}
 */
function smrComposition(n, order) {
  let tot = 0;
  let dryTot = 0;
  for (const k of order) {
    const v = n.get(k) || 0;
    tot += v;
    if (k !== 'H2O') dryTot += v;
  }
  const wet = [];
  const dry = [];
  let slip = 0;
  for (const k of order) {
    const v = n.get(k) || 0;
    wet.push({ key: k, mole_fraction: tot > 0 ? v / tot : 0 });
    if (k !== 'H2O') {
      const y = dryTot > 0 ? v / dryTot : 0;
      dry.push({ key: k, mole_fraction: y });
      if (k === 'CH4') slip = 100 * y;
    }
  }
  const nH2 = n.get('H2') || 0;
  const nCO = n.get('CO') || 0;
  return {
    wet, dry,
    h2_co_ratio: nCO > 0 ? nH2 / nCO : null,
    ch4_slip_dry_pct: slip,
  };
}

/**
 * Shared reformer core: pre-crack → optional O2 combustion → equilibrium at
 * a specified T_out, returning the outlet mole map and bookkeeping. The
 * adiabatic callers re-run this inside the outer T bisection.
 * @param {Map<string,number>} nFeed combined feed moles [kmol/h] (not mutated)
 * @param {number} T_out_K outlet temperature
 * @param {number} P_bar outlet pressure
 * @param {number} ateSmr ATE offset for R1 [K]
 * @param {number} ateWgs ATE offset for R2 [K]
 * @param {string[]} warnings appended in place (pre-crack notes on 1st call)
 * @param {boolean} quiet suppress pre-crack warnings (bisection re-runs)
 * @returns {{n:Map, order:string[], cracked:Array, ch4_burned:number,
 *            eq:object}|{error:object}}
 */
function reformerAtT(nFeed, T_out_K, P_bar, ateSmr, ateWgs, warnings, quiet) {
  const n = new Map(nFeed);
  const w = quiet ? [] : warnings;
  const pc = smrPrecrack(n, w);
  if (pc.error) return pc;
  let ch4Burned = 0;
  const nO2 = n.get('O2') || 0;
  if (nO2 > 0) {
    const cb = smrCombustO2(n, nO2);
    if (cb.error) return cb;
    ch4Burned = cb.ch4_burned_kmol_h;
  }
  const eq = reformerEquilibrium(n, T_out_K + ateSmr, T_out_K + ateWgs, P_bar);
  if (eq.error) return eq;
  // stable reporting order: reacting species first, then inerts as fed
  const order = SMR_REACTING.slice();
  for (const k of eq.n.keys()) if (!order.includes(k)) order.push(k);
  return { n: eq.n, order, cracked: pc.cracked, ch4_burned: ch4Burned, eq };
}

/**
 * Steam-methane reformer. params:
 *   mode              : 'fired' (default) | 'secondary'
 *   T_out_K           : outlet T, REQUIRED in fired mode (500–1500 K window)
 *   P_out_bar         : outlet pressure (default: process-feed P)
 *   ate_smr_K         : approach-to-equilibrium for CH4+H2O⇌CO+3H2 (default 0)
 *   ate_wgs_K         : approach-to-equilibrium for CO+H2O⇌CO2+H2 (default 10)
 *   s_c_min           : S/C coking-check threshold (default 2.5)
 *   fuel_lhv_kJkg     : fired mode — fuel LHV; enables details.fuel_kg_h
 *   furnace_efficiency: fired mode — fraction of fired LHV reaching the
 *                       process gas (default 1.0)
 * streams: [process feed] (fired) or [process feed, air/O2] (secondary).
 * Secondary mode consumes ALL O2 by CH4 combustion, then solves the
 * equilibrium with T_out ADIABATIC via outer bisection on [800, 1600] K.
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveSMR(input) {
  const mi = moduleInput(input, 1, 2);
  if (mi.error) return mi;
  const p = mi.params;
  const mode = p.mode === undefined ? 'fired' : p.mode;
  if (!['fired', 'secondary'].includes(mode)) {
    return errObj('MB_SMR_MODE', "params.mode must be 'fired' | 'secondary'", 'mode');
  }
  if (mode === 'fired' && mi.streams.length !== 1) {
    return errObj('MB_STREAMS', 'fired mode takes exactly one process stream', 'streams');
  }
  if (mode === 'secondary' && mi.streams.length !== 2) {
    return errObj('MB_STREAMS', 'secondary mode takes [process, air/O2] — exactly two streams', 'streams');
  }
  const warnings = [];
  return reformerRun(mi.streams, p, mode === 'secondary', mode, warnings);
}

/**
 * Autothermal reformer — adiabatic only. streams: [hydrocarbon feed].
 * The steam and oxidant streams are CONSTRUCTED from the carbon count:
 *   s_c_ratio  : kmol H2O ADDED per kmol hydrocarbon carbon (required ≥ 0;
 *                any H2O already in the feed counts toward the reported S/C
 *                but not toward this added steam)
 *   o2_c_ratio : kmol O2 per kmol hydrocarbon carbon (required > 0)
 *   oxidant    : 'O2' (default) | 'air' (adds 79/21 N2)
 *   steam_T_K  : added-steam temperature (default 500 K)
 *   oxidant_T_K: oxidant temperature (default 298.15 K)
 *   P_out_bar, ate_smr_K, ate_wgs_K as for smr; s_c_min defaults to 0.5
 *   here (O2-assisted reforming tolerates far leaner steam than fired SMR).
 * @param {{streams:Array, params:object}} input
 * @returns {object} module result or error envelope
 */
function solveATR(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const p = mi.params;
  const feed = mi.streams[0];
  if (!num(p.s_c_ratio) || p.s_c_ratio < 0) {
    return errObj('MB_ATR_SC', 'params.s_c_ratio (kmol added H2O per kmol C) must be ≥ 0', 's_c_ratio');
  }
  if (!num(p.o2_c_ratio) || p.o2_c_ratio <= 0) {
    return errObj('MB_ATR_O2C', 'params.o2_c_ratio (kmol O2 per kmol C) must be > 0', 'o2_c_ratio');
  }
  const oxidant = p.oxidant === undefined ? 'O2' : p.oxidant;
  if (!['O2', 'air'].includes(oxidant)) {
    return errObj('MB_ATR_OX', "params.oxidant must be 'O2' | 'air'", 'oxidant');
  }
  const steamT = num(p.steam_T_K) ? p.steam_T_K : 500;
  const oxT = num(p.oxidant_T_K) ? p.oxidant_T_K : T_REF;
  if (steamT <= 0 || oxT <= 0) {
    return errObj('MB_T', 'steam_T_K / oxidant_T_K must be positive', 'steam_T_K');
  }

  // carbon count from the feed alone sizes the constructed streams
  const fm = smrFeedMoles(feed, false);
  if (fm.error) return fm;
  if (fm.nC_hydrocarbon <= 0) {
    return errObj('MB_ATR_FEED', 'ATR feed carries no hydrocarbon carbon', 'streams');
  }
  const nSteam = p.s_c_ratio * fm.nC_hydrocarbon;   // kmol/h
  const nO2 = p.o2_c_ratio * fm.nC_hydrocarbon;     // kmol/h
  const recH2O = resolve('H2O');
  if (recH2O.error) return recH2O;
  const recO2 = resolve('O2');
  if (recO2.error) return recO2;
  const P = num(p.P_out_bar) ? p.P_out_bar : feed.P_bar;
  const streams = [feed];
  if (nSteam > 0) {
    streams.push({
      mass_flow_kg_h: nSteam * recH2O.mw, T_K: steamT, P_bar: P,
      components: [{ key: 'H2O', mass_fraction: 1, phase: 'gas' }],
    });
  }
  if (oxidant === 'O2') {
    streams.push({
      mass_flow_kg_h: nO2 * recO2.mw, T_K: oxT, P_bar: P,
      components: [{ key: 'O2', mass_fraction: 1 }],
    });
  } else {
    const recN2 = resolve('N2');
    if (recN2.error) return recN2;
    const nN2 = nO2 * (SMR_AIR_N2 / SMR_AIR_O2);
    const mO2 = nO2 * recO2.mw;
    const mN2 = nN2 * recN2.mw;
    streams.push({
      mass_flow_kg_h: mO2 + mN2, T_K: oxT, P_bar: P,
      components: [
        { key: 'O2', mass_fraction: mO2 / (mO2 + mN2) },
        { key: 'N2', mass_fraction: mN2 / (mO2 + mN2) },
      ],
    });
  }
  const warnings = [];
  const res = reformerRun(streams, p, true, 'atr', warnings);
  if (res.error) return res;
  res.details.o2_c_ratio = p.o2_c_ratio;
  res.details.constructed_streams = {
    steam_kmol_h: nSteam, steam_T_K: steamT,
    oxidant, o2_kmol_h: nO2, oxidant_T_K: oxT,
  };
  return res;
}

/**
 * Common driver behind solveSMR / solveATR: combine feed streams, take the
 * inlet enthalpy, then either equilibrate at the specified T_out (fired) or
 * bisect the adiabatic T_out on [800, 1600] K (secondary / atr).
 * @param {Array} streams inlet stream objects (process first)
 * @param {object} p module params
 * @param {boolean} adiabatic outer-bisection mode
 * @param {string} modeLabel 'fired' | 'secondary' | 'atr'
 * @param {string[]} warnings accumulator
 * @returns {object} module result or error envelope
 */
function reformerRun(streams, p, adiabatic, modeLabel, warnings) {
  const ateSmr = num(p.ate_smr_K) ? p.ate_smr_K : SMR_ATE_SMR_DEF;
  const ateWgs = num(p.ate_wgs_K) ? p.ate_wgs_K : SMR_ATE_WGS_DEF;
  const scMin = num(p.s_c_min) ? p.s_c_min
    : (modeLabel === 'atr' ? SMR_SC_MIN_ATR_DEF : SMR_SC_MIN_DEF);
  const P = num(p.P_out_bar) ? p.P_out_bar : streams[0].P_bar;
  if (!num(P) || P <= 0) return errObj('MB_P', 'outlet pressure must be positive', 'P_out_bar');

  // combine feeds: enthalpy per stream (each at its own T/P), moles summed
  let Hin = 0;
  let mIn = 0;
  const nFeed = new Map();
  let nC = 0;
  let nH2O = 0;
  for (let i = 0; i < streams.length; i++) {
    const e = streamEnthalpy(streams[i]);
    if (e.error) return e;
    warnings.push(...e.warnings);
    Hin += e.H_kJh;
    mIn += streams[i].mass_flow_kg_h;
    const fm = smrFeedMoles(streams[i], adiabatic || modeLabel === 'atr');
    if (fm.error) return fm;
    warnings.push(...fm.warnings);
    for (const [k, v] of fm.n.entries()) nFeed.set(k, (nFeed.get(k) || 0) + v);
    nC += fm.nC_hydrocarbon;
    nH2O += fm.nH2O;
  }
  if (modeLabel === 'fired' && (nFeed.get('O2') || 0) > 0) {
    return errObj('MB_SMR_O2', 'fired mode accepts no O2 in the process feed — use secondary mode', 'streams');
  }
  if (modeLabel === 'secondary' && (nFeed.get('O2') || 0) <= 0) {
    return errObj('MB_SMR_O2', 'secondary mode requires O2 in the air/oxidant stream', 'streams');
  }

  // S/C check on the AS-FED streams (total steam over hydrocarbon carbon)
  const sc = nC > 0 ? nH2O / nC : null;
  if (sc !== null && sc < scMin) {
    warnings.push(`${modeLabel}: S/C = ${sc.toFixed(3)} is below the coking threshold ${scMin} — carbon formation risk`);
  }

  let T_out;
  let core;
  let outerIters = 0;
  let outerConverged = true;
  if (adiabatic) {
    if (num(p.T_out_K)) {
      warnings.push(`${modeLabel}: adiabatic — params.T_out_K ignored (outlet T is solved)`);
    }
    /** adiabatic residual g(T) = Hout(T) − Hin; also returns the core */
    const g = (T) => {
      const c = reformerAtT(nFeed, T, P, ateSmr, ateWgs, warnings, true);
      if (c.error) return c;
      const entries = c.order.map((k) => ({ key: k, n_kmol_h: c.n.get(k) || 0 }));
      const s = streamFromMoles(entries, T, P);
      if (s.error) return s;
      const e = streamEnthalpy(s);
      if (e.error) return e;
      return { resid: e.H_kJh - Hin, core: c };
    };
    const glo = g(SMR_ADIA_TLO);
    if (glo.error) return glo;
    const ghi = g(SMR_ADIA_THI);
    if (ghi.error) return ghi;
    if (glo.resid * ghi.resid > 0) {
      return errObj('MB_SMR_ADIABATIC',
        `adiabatic outlet temperature not bracketed in [${SMR_ADIA_TLO}, ${SMR_ADIA_THI}] K — check feed preheat / O2 rate`,
        'streams');
    }
    let lo = SMR_ADIA_TLO;
    let hi = SMR_ADIA_THI;
    let flo = glo.resid;
    let mid = 0.5 * (lo + hi);
    let last = glo;
    for (; outerIters < SMR_ADIA_MAX; outerIters++) {
      mid = 0.5 * (lo + hi);
      const gm = g(mid);
      if (gm.error) return gm;
      last = gm;
      if (hi - lo < SMR_ADIA_TOLK) break;
      if (flo * gm.resid <= 0) { hi = mid; } else { lo = mid; flo = gm.resid; }
    }
    outerConverged = outerIters < SMR_ADIA_MAX;
    if (!outerConverged) {
      warnings.push(`${modeLabel}: adiabatic bisection cap ${SMR_ADIA_MAX} reached — best estimate returned`);
    }
    T_out = mid;
    core = last.core;
  } else {
    if (!num(p.T_out_K) || p.T_out_K < SMR_T_MIN || p.T_out_K > SMR_T_MAX) {
      return errObj('MB_SMR_T', `fired mode requires params.T_out_K in [${SMR_T_MIN}, ${SMR_T_MAX}] K`, 'T_out_K');
    }
    T_out = p.T_out_K;
    core = reformerAtT(nFeed, T_out, P, ateSmr, ateWgs, warnings, false);
    if (core.error) return core;
  }
  if (!core.eq.converged) {
    warnings.push(`${modeLabel}: equilibrium Newton did not reach tolerance in ${SMR_NEWTON_MAX} iterations`);
  }

  const entries = core.order.map((k) => ({ key: k, n_kmol_h: core.n.get(k) || 0 }));
  const outNoH = streamFromMoles(entries, T_out, P);
  if (outNoH.error) return outNoH;
  const eOut = streamEnthalpy(outNoH);
  if (eOut.error) return eOut;
  warnings.push(...eOut.warnings);
  const out = Object.assign({}, outNoH, { H_kJh: eOut.H_kJh });

  const comp = smrComposition(core.n, core.order);
  const eb = energyBalance(Hin, eOut.H_kJh, 0);

  const details = {
    mode: modeLabel,
    T_out_K: T_out,
    P_out_bar: P,
    ate_smr_K: ateSmr,
    ate_wgs_K: ateWgs,
    T_eq_smr_K: T_out + ateSmr,
    T_eq_wgs_K: T_out + ateWgs,
    lnK1: core.eq.lnK1,
    lnK2: core.eq.lnK2,
    extents: { smr_kmol_h: core.eq.e1_kmol_h, wgs_kmol_h: core.eq.e2_kmol_h },
    precrack: core.cracked,
    ch4_burned_kmol_h: core.ch4_burned,
    composition_wet: comp.wet,
    composition_dry: comp.dry,
    h2_co_ratio: comp.h2_co_ratio,
    ch4_slip_dry_pct: comp.ch4_slip_dry_pct,
    s_c: { ratio: sc, min: scMin, ok: sc === null ? false : sc >= scMin },
    outlet_mole_flows: entries,
  };
  if (modeLabel === 'fired') {
    details.Q_furnace_kW = eb.Q_kW;
    const eff = num(p.furnace_efficiency) ? p.furnace_efficiency : 1.0;
    if (eff <= 0 || eff > 1) {
      return errObj('MB_SMR_EFF', 'params.furnace_efficiency must be in (0, 1]', 'furnace_efficiency');
    }
    details.furnace_efficiency = eff;
    if (num(p.fuel_lhv_kJkg)) {
      if (p.fuel_lhv_kJkg <= 0) {
        return errObj('MB_SMR_LHV', 'params.fuel_lhv_kJkg must be positive', 'fuel_lhv_kJkg');
      }
      if (eb.Q_kW <= 0) {
        details.fuel_kg_h = 0;
        warnings.push('smr: Q_furnace ≤ 0 (feed enthalpy already covers the outlet) — fuel rate reported as 0');
      } else {
        details.fuel_kg_h = (eb.Q_kW * KJH_PER_KW) / (eff * p.fuel_lhv_kJkg);
      }
    }
  }

  return {
    streams_out: [out],
    mass_balance: massBalance(mIn, out.mass_flow_kg_h),
    energy_balance: eb,
    details,
    converged: core.eq.converged && outerConverged,
    iterations: core.eq.iterations + outerIters,
    warnings,
  };
}

// ===========================================================================
// PART 5 — WATER-GAS SHIFT CONVERTER + METHANATOR (Step 13)
//
// shift      : single-equilibrium WGS  CO + H2O ⇌ CO2 + H2  at T_out + ATE,
//              lnK2 = 4400/T − 4.036 (Moe 1962; pressure cancels, Δn = 0).
//              CH4 is INERT here (no reforming activity on shift catalysts).
//              Presets: 'hts' (350–450 °C window, ATE default 10 K) and
//              'lts' (190–250 °C window, ATE default 5 K); T_out outside the
//              preset window raises a warning, not an error. Modes:
//              'adiabatic' (default; outlet T by bisection on [400, 1000] K)
//              and 'isothermal' (params.T_out_K; duty Q_kW reported).
//              The 1-D extent solve is a bisection — the residual is strictly
//              increasing in the extent and diverges at the feasibility
//              bounds, so the root is unique and always bracketed.
//
// methanator : the SAME two-reaction equilibrium as the reformer family, run
//              in the methanation direction (CO + 3H2 → CH4 + H2O and, via
//              the coupled shift, CO2 + 4H2 → CH4 + 2H2O). Reports residual
//              CO / CO2 / CO+CO2 in DRY mol-ppm and the per-bed adiabatic
//              rise (≈ 74 K per 1 % CO, ≈ 60 K per 1 % CO2 — the classic
//              rules emerge from the enthalpy balance, they are not coded).
//              Modes 'adiabatic' (default) and 'isothermal'.
//
// Feed streams are re-based to gas-phase enthalpies (per-component 'gas'
// overrides): process gas at LTS temperatures sits below the PURE-water
// saturation line at total pressure, but the water is vapor because only its
// PARTIAL pressure matters — waterMolarH's saturated-vapor-at-T branch
// handles exactly this.
// ===========================================================================

const SHIFT_PRESETS = {
  hts: { ate: 10, Tlo: 623.15, Thi: 723.15, label: 'HTS 350\u2013450 \u00b0C' },
  lts: { ate: 5, Tlo: 463.15, Thi: 523.15, label: 'LTS 190\u2013250 \u00b0C' },
  none: { ate: 0, Tlo: null, Thi: null, label: null },
};
const SHIFT_T_MIN = 350;        // K — isothermal T_out sanity window
const SHIFT_T_MAX = 1100;
const SHIFT_ADIA_TLO = 400;     // K — adiabatic outer-bisection bracket
const SHIFT_ADIA_THI = 1000;
const SHIFT_BISECT_MAX = 100;   // extent-bisection iteration cap
const SHIFT_TOL = 1e-9;         // |F| convergence target in log units
const SHIFT_KEYS = ['CO', 'H2O', 'CO2', 'H2', 'CH4', 'N2', 'Ar', 'He'];
const SHIFT_ORDER = ['CO', 'H2O', 'CO2', 'H2', 'CH4'];

const METH_T_MIN = 350;         // K — isothermal T_out sanity window
const METH_T_MAX = 1000;
const METH_ADIA_TLO = 400;      // K — adiabatic outer-bisection bracket
const METH_ADIA_THI = 1000;
const METH_ATE_DEF = 0;         // K — default approach-to-equilibrium

/**
 * Collect and validate feed moles for shift/methanator (gas-phase species
 * only; alkanes and O2 are not accepted).
 * @param {object} stream
 * @param {string} errCode error code to raise on a foreign component
 * @returns {{n:Map<string,number>, warnings:string[]}|{error:object}}
 */
function shiftFeedMoles(stream, errCode) {
  const mol = molarize(stream);
  if (mol.error) return mol;
  const n = new Map();
  for (const mc of mol.components) {
    if (mc.n_kmol_h <= 0) continue;
    if (!SHIFT_KEYS.includes(mc.key)) {
      return errObj(errCode,
        `component '${mc.key}' is not accepted here (allowed: ${SHIFT_KEYS.join(', ')})`,
        'streams');
    }
    n.set(mc.key, (n.get(mc.key) || 0) + mc.n_kmol_h);
  }
  return { n, warnings: mol.warnings.slice() };
}

/**
 * Single-extent WGS equilibrium CO + H2O ⇌ CO2 + H2 at T. Bisection on the
 * extent: F(e) = ln(CO2·H2) − ln(CO·H2O) − lnK2 is strictly increasing and
 * diverges to ∓∞ at the feasibility bounds, so the root is unique. Converged
 * when |F| is within max(SHIFT_TOL, achievable float precision of F).
 * @param {Map<string,number>} n0 feed moles [kmol/h]
 * @param {number} T_K equilibrium temperature (already includes ATE)
 * @returns {{n:Map, e_kmol_h:number, lnK2:number, iterations:number,
 *            converged:boolean}|{error:object}}
 */
function wgsEquilibrium(n0, T_K) {
  const c = n0.get('CO') || 0;
  const b = n0.get('H2O') || 0;
  const f = n0.get('CO2') || 0;
  const d = n0.get('H2') || 0;
  const lnK2 = SMR_LNK2_A / T_K - SMR_LNK2_B;
  const span0 = Math.min(c, b) + Math.min(f, d);
  const done = (e, it, conv) => {
    const n = new Map(n0);
    n.set('CO', c - e);
    n.set('H2O', b - e);
    n.set('CO2', f + e);
    n.set('H2', d + e);
    return { n, e_kmol_h: e, lnK2, iterations: it, converged: conv };
  };
  if (span0 <= 0) return done(0, 0, true); // no reactive pair in either direction
  const F = (e) => {
    const CO = c - e;
    const H2O = b - e;
    const CO2 = f + e;
    const H2 = d + e;
    if (CO <= 0 || H2O <= 0 || CO2 <= 0 || H2 <= 0) return null;
    return Math.log(CO2) + Math.log(H2) - Math.log(CO) - Math.log(H2O) - lnK2;
  };
  let lo = -Math.min(f, d);
  let hi = Math.min(c, b);
  const w = 1e-18 * Math.max(hi - lo, c + b + f + d);
  lo += w;
  hi -= w;
  let it = 0;
  for (; it < SHIFT_BISECT_MAX; it++) {
    const mid = 0.5 * (lo + hi);
    const r = F(mid);
    if (r === null) return errObj('MB_SHIFT_EQ', 'shift equilibrium left the feasible region', 'streams');
    if (r > 0) hi = mid; else lo = mid;
  }
  const e = 0.5 * (lo + hi);
  const r = F(e);
  const EPSM = 2.220446049250313e-16;
  const ae = Math.abs(e);
  const noise = r === null ? Infinity :
    8 * EPSM * ((c + ae) / (c - e) + (b + ae) / (b - e) + (f + ae) / (f + e) + (d + ae) / (d + e));
  const conv = r !== null && Math.abs(r) < Math.max(SHIFT_TOL, noise);
  return done(e, it, conv);
}

/**
 * Stable output key order: the module's reacting set first, then remaining
 * feed keys in map order.
 * @param {Map<string,number>} n
 * @param {string[]} lead
 * @returns {string[]}
 */
function shiftOrder(n, lead) {
  const order = lead.filter((k) => n.has(k));
  for (const k of n.keys()) if (!order.includes(k)) order.push(k);
  return order;
}

/**
 * Shared shift/methanator driver.
 * @param {object} stream single feed stream
 * @param {object} p params
 * @param {string} which 'shift' | 'methanator'
 * @param {string[]} warnings
 * @returns {object} module result or error envelope
 */
function shiftMethRun(stream, p, which, warnings) {
  const isShift = which === 'shift';
  const EC = isShift ? 'MB_SHIFT' : 'MB_METH';
  const mode = p.mode === undefined ? 'adiabatic' : p.mode;
  if (mode !== 'adiabatic' && mode !== 'isothermal') {
    return errObj(`${EC}_MODE`, `params.mode must be 'adiabatic' or 'isothermal'`, 'mode');
  }
  let preset = 'none';
  let ate;
  if (isShift) {
    preset = p.preset === undefined ? 'none' : p.preset;
    if (!(preset in SHIFT_PRESETS)) {
      return errObj('MB_SHIFT_PRESET', `params.preset must be one of ${Object.keys(SHIFT_PRESETS).join(', ')}`, 'preset');
    }
    ate = num(p.ate_K) ? p.ate_K : SHIFT_PRESETS[preset].ate;
  } else {
    ate = num(p.ate_K) ? p.ate_K : METH_ATE_DEF;
  }
  const P = num(p.P_out_bar) ? p.P_out_bar : stream.P_bar;
  if (!num(P) || P <= 0) return errObj('MB_P', 'outlet pressure must be positive', 'P_out_bar');

  const fm = shiftFeedMoles(stream, `${EC}_FEED`);
  if (fm.error) return fm;
  warnings.push(...fm.warnings);
  const nFeed = fm.n;
  const c = nFeed.get('CO') || 0;
  const b = nFeed.get('H2O') || 0;
  const f = nFeed.get('CO2') || 0;
  const d = nFeed.get('H2') || 0;
  if (isShift) {
    if (!((c > 0 && b > 0) || (f > 0 && d > 0))) {
      return errObj('MB_SHIFT_FEED',
        'water-gas shift needs CO + H2O (forward) and/or CO2 + H2 (reverse) in the feed', 'streams');
    }
  } else {
    if (d <= 0 || c + f <= 0) {
      return errObj('MB_METH_FEED', 'methanation needs H2 and CO and/or CO2 in the feed', 'streams');
    }
  }

  // gas-basis feed enthalpy (see the Part 5 banner note on sub-Tsat water)
  const feedEntries = [];
  for (const [k, v] of nFeed.entries()) feedEntries.push({ key: k, n_kmol_h: v });
  const feedGas = streamFromMoles(feedEntries, stream.T_K, stream.P_bar, 'gas');
  if (feedGas.error) return feedGas;
  const eIn = streamEnthalpy(feedGas);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);
  const Hin = eIn.H_kJh;
  const T_in = stream.T_K;

  /** equilibrium core at outlet T */
  const coreAt = (T) => {
    if (isShift) {
      const eq = wgsEquilibrium(nFeed, T + ate);
      if (eq.error) return eq;
      return { n: eq.n, eq, lnK1: null };
    }
    const eq = reformerEquilibrium(nFeed, T + ate, T + ate, P);
    if (eq.error) return eq;
    return { n: eq.n, eq, lnK1: eq.lnK1 };
  };

  const [ATLO, ATHI] = isShift ? [SHIFT_ADIA_TLO, SHIFT_ADIA_THI] : [METH_ADIA_TLO, METH_ADIA_THI];
  const [TMIN, TMAX] = isShift ? [SHIFT_T_MIN, SHIFT_T_MAX] : [METH_T_MIN, METH_T_MAX];
  let T_out;
  let core;
  let outerIters = 0;
  let outerConverged = true;
  if (mode === 'adiabatic') {
    if (num(p.T_out_K)) {
      warnings.push(`${which}: adiabatic — params.T_out_K ignored (outlet T is solved)`);
    }
    const g = (T) => {
      const cr = coreAt(T);
      if (cr.error) return cr;
      const entries = [];
      for (const [k, v] of cr.n.entries()) entries.push({ key: k, n_kmol_h: v });
      const s = streamFromMoles(entries, T, P, 'gas');
      if (s.error) return s;
      const e = streamEnthalpy(s);
      if (e.error) return e;
      return { resid: e.H_kJh - Hin, core: cr };
    };
    const glo = g(ATLO);
    if (glo.error) return glo;
    const ghi = g(ATHI);
    if (ghi.error) return ghi;
    if (glo.resid * ghi.resid > 0) {
      return errObj(`${EC}_ADIABATIC`,
        `adiabatic outlet temperature not bracketed in [${ATLO}, ${ATHI}] K — check the feed temperature`,
        'streams');
    }
    let lo = ATLO;
    let hi = ATHI;
    let flo = glo.resid;
    let mid = 0.5 * (lo + hi);
    let last = glo;
    for (; outerIters < SMR_ADIA_MAX; outerIters++) {
      mid = 0.5 * (lo + hi);
      const gm = g(mid);
      if (gm.error) return gm;
      last = gm;
      if (hi - lo < SMR_ADIA_TOLK) break;
      if (flo * gm.resid <= 0) { hi = mid; } else { lo = mid; flo = gm.resid; }
    }
    outerConverged = outerIters < SMR_ADIA_MAX;
    if (!outerConverged) {
      warnings.push(`${which}: adiabatic bisection cap ${SMR_ADIA_MAX} reached — best estimate returned`);
    }
    T_out = mid;
    core = last.core;
  } else {
    if (!num(p.T_out_K) || p.T_out_K < TMIN || p.T_out_K > TMAX) {
      return errObj(`${EC}_T`, `isothermal mode requires params.T_out_K in [${TMIN}, ${TMAX}] K`, 'T_out_K');
    }
    T_out = p.T_out_K;
    core = coreAt(T_out);
    if (core.error) return core;
  }
  if (!core.eq.converged) {
    warnings.push(`${which}: equilibrium solve did not reach tolerance`);
  }
  if (isShift && preset !== 'none') {
    const pr = SHIFT_PRESETS[preset];
    if (T_out < pr.Tlo || T_out > pr.Thi) {
      warnings.push(`shift: T_out ${T_out.toFixed(1)} K is outside the ${preset} window ` +
        `${pr.Tlo}\u2013${pr.Thi} K (${pr.label})`);
    }
  }

  const order = shiftOrder(core.n, isShift ? SHIFT_ORDER : SMR_REACTING);
  const entries = order.map((k) => ({ key: k, n_kmol_h: core.n.get(k) || 0 }));
  const outNoH = streamFromMoles(entries, T_out, P, 'gas');
  if (outNoH.error) return outNoH;
  const eOut = streamEnthalpy(outNoH);
  if (eOut.error) return eOut;
  warnings.push(...eOut.warnings);
  const out = Object.assign({}, outNoH, { H_kJh: eOut.H_kJh });

  const comp = smrComposition(core.n, order);
  const eb = energyBalance(Hin, eOut.H_kJh, 0);
  const dryAt = (k) => {
    const hit = comp.dry.find((x) => x.key === k);
    return hit ? hit.mole_fraction : 0;
  };

  const details = {
    mode,
    T_in_K: T_in,
    T_out_K: T_out,
    delta_T_K: T_out - T_in,
    P_out_bar: P,
    ate_K: ate,
    T_eq_K: T_out + ate,
    lnK2: core.eq.lnK2,
    composition_wet: comp.wet,
    composition_dry: comp.dry,
    outlet_mole_flows: entries,
  };
  if (isShift) {
    details.preset = preset;
    details.extent_kmol_h = core.eq.e_kmol_h;
    details.co_slip_dry_pct = dryAt('CO') * 100;
    details.h2_co_ratio = comp.h2_co_ratio;
  } else {
    details.lnK1 = core.lnK1;
    details.extents = { smr_kmol_h: core.eq.e1_kmol_h, wgs_kmol_h: core.eq.e2_kmol_h };
    details.co_ppm_dry = dryAt('CO') * 1e6;
    details.co2_ppm_dry = dryAt('CO2') * 1e6;
    details.co_co2_ppm_dry = (dryAt('CO') + dryAt('CO2')) * 1e6;
    details.ch4_dry_pct = dryAt('CH4') * 100;
  }
  if (mode === 'isothermal') details.Q_kW = eb.Q_kW;

  return {
    streams_out: [out],
    mass_balance: massBalance(stream.mass_flow_kg_h, out.mass_flow_kg_h),
    energy_balance: eb,
    details,
    converged: core.eq.converged && outerConverged,
    iterations: core.eq.iterations + outerIters,
    warnings,
  };
}

/**
 * MODULE 'shift' — water-gas shift converter (HTS/LTS).
 * streams: exactly 1 (process gas: CO/H2O/CO2/H2 + CH4/N2/Ar/He inerts).
 * params:
 *   mode        'adiabatic' (default) | 'isothermal'
 *   preset      'hts' | 'lts' | 'none' (default) — sets the ATE default
 *               (10 / 5 / 0 K) and the T window that raises a warning
 *   ate_K       approach-to-equilibrium override [K]
 *   T_out_K     required for isothermal mode [K]
 *   P_out_bar   defaults to the feed pressure
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveShift(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  return shiftMethRun(mi.streams[0], mi.params, 'shift', []);
}

/**
 * MODULE 'methanator' — trace CO/CO2 clean-up by methanation (the reverse
 * reformer equilibria; residuals reported in dry mol-ppm).
 * streams: exactly 1 (H2-rich gas with trace CO and/or CO2).
 * params:
 *   mode        'adiabatic' (default) | 'isothermal'
 *   ate_K       approach-to-equilibrium (default 0 K, both reactions)
 *   T_out_K     required for isothermal mode [K]
 *   P_out_bar   defaults to the feed pressure
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveMethanator(input) {
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  return shiftMethRun(mi.streams[0], mi.params, 'methanator', []);
}

// ---------------------------------------------------------------------------
// MODULES registry — the api router dispatches into this map. Later steps
// (CSTR, PFR, SMR, ...) register here without touching Part 1.
// ---------------------------------------------------------------------------
const MODULES = {
  'mixer': solveMixer,
  'splitter': solveSplitter,
  'flash': solveFlash,
  'heat-exchanger': solveHeatExchanger,
  'rotating': solveRotating,
  'reactor': solveReactor,
  'cstr': solveCSTR,
  'pfr': solvePFR,
  'pfr-recycle': solvePFRRecycle,
  'smr': solveSMR,
  'atr': solveATR,
  'shift': solveShift,
  'methanator': solveMethanator,
};

/**
 * Run a registered module by name — never throws (belt-and-braces for the
 * router and the test harness).
 * @param {string} name registry key, e.g. 'mixer'
 * @param {{streams:Array, params?:object}} input
 * @returns {object} module result or error envelope
 */
function runModule(name, input) {
  const fn = MODULES[name];
  if (typeof fn !== 'function') {
    return errObj('MB_UNKNOWN_MODULE',
      `unknown module '${name}' — available: ${Object.keys(MODULES).join(', ')}`, 'module');
  }
  try {
    return fn(input);
  } catch (e) {
    return errObj('MB_ENGINE_THROW', `module '${name}' threw: ${e.message}`, 'module');
  }
}

// ---------------------------------------------------------------------------
// selfTest — the five Step-5 VERIFY hand-checks + formation-basis identity
// ---------------------------------------------------------------------------

/**
 * Run the Step-5 acceptance hand-checks.
 * @returns {{pass:boolean, results:Array<{desc:string, ok:boolean,
 *            actual:number|string, expect:string}>}}
 */
function selfTest() {
  const results = [];
  const push = (desc, ok, actual, expect) => results.push({ desc, ok, actual, expect });
  try {
    const c = cpGas('CO2', 298.15);
    push('Cp CO2 @298 ≈ 37 J/mol·K', !c.error && Math.abs(c.cp_J_molK - 37.1) < 0.6,
      c.error ? c.error.code : c.cp_J_molK, '37.1 ± 0.6');

    const n1 = hGasMolar('N2', 1000);
    const n0 = hGasMolar('N2', 298.15);
    const dN2 = n1.h_kJmol - n0.h_kJmol;
    push('N2 h(1000K)−h(298K) ≈ 21.5 kJ/mol', Math.abs(dN2 - 21.46) < 0.2, dN2, '21.46 ± 0.2');

    const w100 = waterMolarH(373.15, 1.0, 'liquid');
    const w25 = waterMolarH(298.15, 1.0, 'liquid');
    const dW = (w100.h_kJmol - w25.h_kJmol) / 0.018015; // kJ/kg
    push('H2O liq ΔH 25→100 °C ≈ 314 kJ/kg', Math.abs(dW - 315) < 4, dW, '315 ± 4');

    const v = dhvapT('H2O', 373.15);
    const vkJkg = v.dhvap_kJmol / 0.018015;
    push('Watson dHvap H2O @100 °C ≈ 2257 kJ/kg', Math.abs(vkJkg - 2256) < 30, vkJkg, '2256 ± 30');

    const p1 = phaseOf('C3H8', 298.15, 1.0);
    const p2 = phaseOf('C3H8', 298.15, 15.0);
    push('phaseOf propane 298 K/1 bar = gas', p1.phase === 'gas', p1.phase, 'gas');
    push('phaseOf propane 298 K/15 bar = liquid', p2.phase === 'liquid', p2.phase, 'liquid');

    // formation-basis identity: H2 + ½O2 → H2O(g) at 298.15 K, ΔH = −241.8
    const hH2 = hGasMolar('H2', 298.15).h_kJmol;
    const hO2 = hGasMolar('O2', 298.15).h_kJmol;
    const hW = waterMolarH(298.15, 1.0, 'gas').h_kJmol;
    const dRxn = hW - hH2 - 0.5 * hO2;
    push('H2+½O2→H2O(g) ΔH ≈ −241.8 kJ/mol', Math.abs(dRxn + 241.8) < 2.0, dRxn, '−241.8 ± 2.0');
  } catch (e) {
    push('selfTest exception', false, e.message, 'no throw');
  }
  return { pass: results.every(r => r.ok), results };
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
export default {
  ENGINE_VERSION,
  MODULES,          // module registry — mixer, splitter, flash,
                    // heat-exchanger, rotating, reactor (Part 2);
                    // cstr, pfr, pfr-recycle (Part 3);
                    // smr, atr (Part 4)
  runModule,
  resolve,
  cpGas,
  hGasMolar,
  hLiqMolar,
  hSolMolar,
  dhvapT,
  waterMolarH,
  phaseOf,
  molarize,
  streamEnthalpy,
  solveT_forH,
  selfTest,
};
