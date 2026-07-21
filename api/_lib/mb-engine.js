// ============================================================================
// REPO PATH: api/_lib/mb-engine.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — STEP 5, TASK B
// PART 1 — THERMO CORE ONLY. Module solvers (MODULES{...}) land in Part 2.
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

const fluids = require('./fluids.js');
const mbData = require('./mb-data.js');
const if97 = require('./if97.js');
const eos = require('./eos.js');

const ENGINE_VERSION = 'mb-engine 0.5.1 (part 1 — thermo core)';

const T_REF = 298.15;          // K — formation-basis reference
const R_J = 8.314462;          // J/(mol·K)
const R_KJ = 0.008314462;      // kJ/(mol·K)
const P_ATM = 1.01325;         // bar
const TROUTON = 0.088;         // kJ/(mol·K): dHvap(Tb) ≈ 0.088·Tb
const PR_P_THRESHOLD = 30;     // bar — departure applied above this
const WATSON_EXP = 0.38;
const WATSON_TCLAMP = 0.98;    // clamp T to 0.98·Tc inside Watson

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
    if (phaseHint === 'gas' && reg !== 2) {
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
      phase = reg === 2 ? 'gas' : (reg === 1 ? 'liquid' : (reg === 4 ? 'liquid' : 'gas'));
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

// ---------------------------------------------------------------------------
// MODULES — placeholder; Part 2 (Step 8+) registers evaporator, dryer,
// reactor, mixer/splitter, etc. The api router dispatches into this map.
// ---------------------------------------------------------------------------
const MODULES = {};

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
module.exports = {
  ENGINE_VERSION,
  MODULES,          // Part-2 registry (empty in Part 1)
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
