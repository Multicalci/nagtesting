// ============================================================================
// REPO PATH: api/_lib/mb-engine.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — STEP 8
// PARTS 1+2 — THERMO CORE + SIX CORE MODULE SOLVERS (MODULES{...}):
// mixer, splitter, flash, heat-exchanger, rotating, reactor.
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

const ENGINE_VERSION = 'mb-engine 0.6.0 (parts 1+2 — thermo core + six core modules)';

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
                    // heat-exchanger, rotating, reactor (Part 2)
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
