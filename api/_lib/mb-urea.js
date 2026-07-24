// ============================================================================
// REPO PATH: api/_lib/mb-urea.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — STEP 17
// PART 6 — UREA HP SECTION + SOLIDS FINISHING:
//   urea-reactor   empirical X_CO2 = f(N/C, H2O/C, T) from Supabase
//                  `correlation_params` (embedded fallback), validity
//                  envelope enforced with warnings, EMPIRICAL ESTIMATE flag,
//                  residual carbamate + biuret estimate, fixed reaction heats
//   hp-stripper    carbamate decomposition + CO2/NH3 strip gas + MP steam
//   sls            solid–liquid separator (recovery + cake moisture)
//   dryer          target moisture, evaporation, gas-side balance
//   urea-hp-loop   reactor → stripper → HP carbamate condenser, Wegstein tear
//
// ---------------------------------------------------------------------------
// WHY THIS MODULE HAS ITS OWN ENTHALPY ANCHOR (read before editing)
// ---------------------------------------------------------------------------
// The rest of the engine runs on tabulated formation enthalpies and lets the
// reaction heat emerge as Q = Hout − Hin. That works when every species has a
// tabulated Hf in the phase it is actually in. In the urea HP loop it does
// not: mb-data carries hf_sol for urea (−333.6), ammonium carbamate (−645.1)
// and biuret (−563, itself flagged `estimated`), all of which describe pure
// CRYSTALS, whereas the reactor holds a ~185 °C ammonia/carbamate/urea/water
// MELT. Closing the balance on the crystal values gives a net ENDOTHERMIC
// reactor, which is wrong by inspection.
//
// So Part 6 RE-ANCHORS the three fertilizer species to the reaction heats the
// spec prescribes, at 298.15 K, in a hypothetical dissolved/melt state:
//     hf*(NH3)       = hf_gas(NH3) − ΔHvap(298.15)      (Watson, from Part 1)
//     hf*(CO2)       = hf_gas(CO2) − ΔHvap(298.15)      (Watson, clamped)
//     hf*(H2O)       = IF97 liquid, unchanged
//     hf*(carbamate) = 2·hf*(NH3) + hf*(CO2) + ΔHr1,  ΔHr1 = −117.0 kJ/mol
//     hf*(urea)      = hf*(carbamate) − hf*(H2O) + ΔHr2, ΔHr2 = +15.5 kJ/mol
//     hf*(biuret)    = 2·hf*(urea) − hf*(NH3) + ΔHr3,  ΔHr3 = 0 (tunable)
// The universal contract Q = Hout − Hin therefore still holds EXACTLY inside
// Part 6 — but with the prescribed HP-loop reaction heats built in instead of
// the crystal Hf set. The tabulated values are reported alongside the anchored
// ones in details.enthalpy_basis so the offset is visible, never hidden. The
// anchored carbamate lands within ~2.3 kJ/mol of the tabulated crystal value,
// which is a useful independent sanity check on ΔHr1.
// Sensible heat uses condensed-phase Cp (cp_liq, else cp_sol); water always
// goes through IF97. Gas streams (stripper off-gas, dryer air) use the normal
// Part-1 gas route.
//
// NO CIRCULAR IMPORT: this file imports nothing from mb-engine.js. mb-engine
// calls register(core) once at load and receives the solver map back.
//
// ACCURACY STATEMENT (spec §9): the conversion correlation is an EMPIRICAL
// ESTIMATE inside a stated envelope. It produces balances, not design
// guarantees. Every reactor result carries estimate_flag:'EMPIRICAL ESTIMATE'.
//
// Plain ES2020. Depends only on ./if97.js. (c) multicalci.com
// ============================================================================

'use strict';

import if97 from './if97.js';

const PART6_VERSION = 'mb-urea 1.0.0';

// ---------------------------------------------------------------------------
// tunables (structural — the numeric correlation lives in CORRELATION_FALLBACK)
// ---------------------------------------------------------------------------
const KMOL_TO_MOL = 1000;          // kJ/mol · kmol/h → kJ/h
const UREA_T_MIN = 380;            // K — melt sanity window for T_out
const UREA_T_MAX = 520;
const STRIP_T_MIN = 380;
const STRIP_T_MAX = 520;
const DRYER_T_MIN = 250;
const DRYER_T_MAX = 700;
const STEAM_APPROACH_MIN_K = 5;    // warn below this steam-Tsat approach
const LOOP_MAX_ITER = 100;         // Wegstein cap on the HP-loop tear
const LOOP_TOL_FLOWREL = 1e-6;     // relative on tear mass flow (keeps the
const LOOP_TOL_X = 1e-5;           // overall closure inside the 0.01 % spec)
const LOOP_TOL_T = 0.01;           // K on tear temperature
const WEGSTEIN_QMIN = -5;
const WEGSTEIN_QMAX = 0;
const CORR_TTL_MS = 10 * 60 * 1000; // correlation cache lifetime
const CORR_TIMEOUT_MS = 3000;       // Supabase fetch budget

/** Species that carry the urea chemistry. Everything else is an inert. */
const UREA_KEYS = ['NH3', 'CO2', 'H2O', 'urea', 'amm_carbamate', 'biuret'];
/** Fertilizer species re-anchored to the prescribed reaction heats. */
const ANCHORED_KEYS = ['amm_carbamate', 'urea', 'biuret'];
/** Melt species that always report as condensed regardless of phaseOf. */
const MELT_KEYS = ['NH3', 'CO2', 'H2O', 'urea', 'amm_carbamate', 'biuret'];

// ---------------------------------------------------------------------------
// EMBEDDED CORRELATION FALLBACK — mirrors Supabase correlation_params.
// Editing the Supabase row changes engine behaviour with NO redeploy; this
// object is what the engine uses when Supabase is unreachable or the key is
// absent. Keep the two in sync (db/seed_urea_correlation.sql).
// ---------------------------------------------------------------------------

/**
 * urea_x_co2 — CO2-to-urea conversion in the HP reactor.
 *
 *   X[%] = X0 + a1·ΔNC + a2·ΔNC² + b1·ΔWC + b2·ΔWC² + c1·ΔT + c2·ΔT²
 *              + d1·ΔNC·ΔWC
 *   ΔNC = N/C − ref.nc,  ΔWC = H2O/C − ref.wc,  ΔT = T[°C] − ref.T_C
 * then × eta_approach (residence-time / holdup knob, 1.0 = design), clamped.
 *
 * N/C  = total N / total C in the reactor feed (carbamate counts 2 N + 1 C,
 *        urea 2 N + 1 C, biuret 3 N + 2 C).
 * H2O/C = total H2O / total C in the feed.
 * Units: X in %, ratios molar, T in °C, P in bar(a), enthalpies kJ/mol.
 */
const UREA_X_CO2_FALLBACK = {
  form: 'X_pct = X0 + a1*dNC + a2*dNC^2 + b1*dWC + b2*dWC^2 + c1*dT + c2*dT^2 + d1*dNC*dWC, scaled by eta_approach, clamped to clamp_pct',
  ref: { nc: 3.0, wc: 0.5, T_C: 185.0 },
  X0_pct: 62.0,
  a1: 12.0,          // %/(mol N per mol C)
  a2: -1.6,          // %/(mol N per mol C)²  — diminishing return at high N/C
  b1: -12.0,         // %/(mol H2O per mol C) — water suppresses dehydration
  b2: 4.0,           // %/(mol H2O per mol C)²
  c1: 0.45,          // %/°C
  c2: -0.020,        // %/°C² — peaks ≈ 196 °C, then falls back
  d1: 2.0,           // %/(ΔNC·ΔWC) — excess NH3 partly offsets water
  clamp_pct: [25.0, 85.0],
  envelope: {
    nc: [2.5, 4.5],
    wc: [0.0, 1.2],
    T_C: [170.0, 200.0],
    P_bar: [130.0, 200.0],
  },
  carbamate_fraction: 0.97,   // of the UNCONVERTED carbon, how much stays as
                              // carbamate rather than free CO2 in the melt
  biuret: {
    b0_pct: 0.45,             // wt% of urea at the reference point
    bT_per_C: 0.02,           // + per °C above ref.T_C
    bNC_per_unit: -0.15,      // − per unit N/C above ref.nc (NH3 suppresses)
    clamp_pct: [0.05, 2.5],
  },
  dHr_carbamate_kJ_mol: -117.0,   // 2 NH3 + CO2 → NH2COONH4   (exothermic)
  dHr_dehydration_kJ_mol: 15.5,   // NH2COONH4 → urea + H2O    (endothermic)
  dHr_biuret_kJ_mol: 0.0,         // 2 urea → biuret + NH3     (≈ thermally
                                  // neutral at this scale; tunable)
  anchor_T_K: 458.15,             // the three ΔHr above are HP-LOOP values —
  anchor_P_bar: 150.0,            // they are imposed exactly at this state
  note: 'EMPIRICAL ESTIMATE — tuned to typical total-recycle HP-loop plant figures. Not a design guarantee.',
};

const CORRELATION_FALLBACK = {
  urea_x_co2: UREA_X_CO2_FALLBACK,
};

// ---------------------------------------------------------------------------
// correlation store — Supabase REST (service key, server-side only) with a
// TTL cache and the embedded fallback. Solvers read it SYNCHRONOUSLY so the
// module contract stays synchronous and the test harness stays deterministic;
// the router awaits loadCorrelations() once per request before dispatch.
// ---------------------------------------------------------------------------

/** @type {{params:object, source:string, note:(string|null)}} per key */
const CORR_CACHE = new Map();
let corrLoadedAt = 0;
let corrInFlight = null;

/** Shallow-per-branch merge: Supabase values win, fallback fills the gaps. */
function mergeParams(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = Object.assign({}, base);
  for (const k of Object.keys(over)) {
    const b = base[k];
    const o = over[k];
    if (b && o && typeof b === 'object' && typeof o === 'object' &&
        !Array.isArray(b) && !Array.isArray(o)) {
      out[k] = Object.assign({}, b, o);
    } else if (o !== undefined && o !== null) {
      out[k] = o;
    }
  }
  return out;
}

/** Seed the cache from the embedded fallback (idempotent). */
function seedFallback() {
  for (const k of Object.keys(CORRELATION_FALLBACK)) {
    if (!CORR_CACHE.has(k)) {
      CORR_CACHE.set(k, {
        params: CORRELATION_FALLBACK[k],
        source: 'embedded',
        note: CORRELATION_FALLBACK[k].note || null,
      });
    }
  }
}
seedFallback();

/**
 * Fetch correlation_params from Supabase and refresh the cache. Never throws
 * and never rejects — on ANY failure the embedded fallback stays in place.
 * Safe to call on every request: a TTL and an in-flight guard collapse the
 * traffic to one fetch per instance per CORR_TTL_MS.
 * @param {{force?:boolean}} [opts]
 * @returns {Promise<{source:string, keys:string[], ms:number,
 *                    error:(string|null)}>}
 */
async function loadCorrelations(opts) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (!force && corrLoadedAt && (now - corrLoadedAt) < CORR_TTL_MS) {
    return { source: 'cache', keys: [...CORR_CACHE.keys()], ms: 0, error: null };
  }
  if (corrInFlight) return corrInFlight;
  const t0 = Date.now();
  corrInFlight = (async () => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    const wanted = Object.keys(CORRELATION_FALLBACK);
    if (!url || !key) {
      corrLoadedAt = Date.now();
      return { source: 'embedded', keys: wanted, ms: Date.now() - t0,
        error: 'supabase env vars missing' };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CORR_TIMEOUT_MS);
    try {
      const endpoint = url.replace(/\/+$/, '') +
        '/rest/v1/correlation_params?select=key,params,note&key=in.(' +
        wanted.join(',') + ')';
      const resp = await fetch(endpoint, {
        method: 'GET',
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        signal: ctl.signal,
      });
      if (!resp.ok) throw new Error('supabase status ' + resp.status);
      const rows = await resp.json();
      if (!Array.isArray(rows)) throw new Error('supabase bad payload');
      let hits = 0;
      for (const row of rows) {
        if (!row || typeof row.key !== 'string') continue;
        const base = CORRELATION_FALLBACK[row.key];
        if (!base) continue;
        CORR_CACHE.set(row.key, {
          params: mergeParams(base, row.params),
          source: 'supabase',
          note: row.note || base.note || null,
        });
        hits++;
      }
      corrLoadedAt = Date.now();
      return { source: hits > 0 ? 'supabase' : 'embedded', keys: wanted,
        ms: Date.now() - t0, error: hits > 0 ? null : 'no matching rows' };
    } catch (e) {
      corrLoadedAt = Date.now();   // back off; fallback is already in place
      return { source: 'embedded', keys: wanted, ms: Date.now() - t0,
        error: (e && e.message) || 'fetch failed' };
    } finally {
      clearTimeout(timer);
      corrInFlight = null;
    }
  })();
  return corrInFlight;
}

/**
 * Synchronous correlation read.
 * @param {string} key e.g. 'urea_x_co2'
 * @returns {{params:object, source:string, note:(string|null)}}
 */
function correlation(key) {
  seedFallback();
  return CORR_CACHE.get(key) || { params: {}, source: 'missing', note: null };
}

/** Test hook: drop the cache back to the embedded fallback. */
function resetCorrelations() {
  CORR_CACHE.clear();
  corrLoadedAt = 0;
  seedFallback();
}

// ---------------------------------------------------------------------------
// core toolbox injected by mb-engine.js (no circular import)
// ---------------------------------------------------------------------------

/** @type {object|null} */
let core = null;

/** @returns {object} the injected mb-engine toolbox */
function C() {
  if (!core) throw new Error('mb-urea: register(core) was never called');
  return core;
}

// ---------------------------------------------------------------------------
// melt enthalpy — re-anchored condensed-phase formation basis (see banner)
// ---------------------------------------------------------------------------

/** @type {{hf:Object<string,number>, cp:Object<string,number>,
 *          dHr:object, notes:string[]}|null} */
let ANCHOR = null;

/**
 * Build (and cache) the re-anchored condensed-phase reference enthalpies.
 *
 * The prescribed heats −117 / +15.5 kJ/mol are HP-LOOP values, i.e. they
 * apply at reactor conditions (≈185 °C, ≈150 bar), NOT at 298.15 K. So the
 * anchor is imposed at (anchor_T_K, anchor_P_bar) and then walked back to the
 * 298.15 K reference with the condensed-phase Cp:
 *     h(carbamate, Ta) = 2·h(NH3, Ta) + h(CO2, Ta) + ΔHr1
 *     h(urea, Ta)      =   h(carbamate, Ta) − h(H2O, Ta) + ΔHr2
 *     h(biuret, Ta)    = 2·h(urea, Ta) − h(NH3, Ta) + ΔHr3
 *     hf*(i)           =   h(i, Ta) − cp_i·MW_i·(Ta − 298.15)
 * The three reaction enthalpies are therefore EXACT at Ta and drift only by
 * ΔCp·(T − Ta) across the narrow 170–200 °C envelope.
 *
 * @param {object} p urea_x_co2 params (reaction heats + anchor state)
 * @returns {{hf:object, cp:object, dHr:object, anchor:object,
 *            tabulated:object, offsets:object, notes:string[]}
 *           |{error:object}}
 */
function meltAnchor(p) {
  const { errObj, num, resolve, dhvapT, waterMolarH } = C();
  const dHr1 = num(p.dHr_carbamate_kJ_mol) ? p.dHr_carbamate_kJ_mol : -117.0;
  const dHr2 = num(p.dHr_dehydration_kJ_mol) ? p.dHr_dehydration_kJ_mol : 15.5;
  const dHr3 = num(p.dHr_biuret_kJ_mol) ? p.dHr_biuret_kJ_mol : 0.0;
  const Ta = num(p.anchor_T_K) ? p.anchor_T_K : 458.15;      // 185 °C
  const Pa = num(p.anchor_P_bar) ? p.anchor_P_bar : 150.0;

  if (ANCHOR && ANCHOR.dHr.carbamate === dHr1 &&
      ANCHOR.dHr.dehydration === dHr2 && ANCHOR.dHr.biuret === dHr3 &&
      ANCHOR.anchor.T_K === Ta && ANCHOR.anchor.P_bar === Pa) {
    return ANCHOR;
  }

  const notes = [];
  const hf = {};
  const cp = {};
  const dTa = Ta - 298.15;

  // NH3 and CO2: dissolved/condensed reference from the gas Hf minus the
  // Part-1 Watson latent heat at 298.15 K.
  for (const k of ['NH3', 'CO2']) {
    const rec = resolve(k);
    if (rec.error) return rec;
    if (!num(rec.hf_gas_298)) {
      return errObj('MB_UREA_ANCHOR', `component '${k}' has no hf_gas_298`, 'components');
    }
    const v = dhvapT(k, 298.15);
    if (v.error) return v;
    hf[k] = rec.hf_gas_298 - v.dhvap_kJmol;
    cp[k] = num(rec.cp_liq_kjkgk) ? rec.cp_liq_kjkgk : 2.0;
  }

  // water: IF97 liquid; the 298.15 K reference is exactly hf_liq_298
  const w0 = waterMolarH(298.15, 1.01325, 'liquid');
  if (w0.error) return w0;
  hf.H2O = w0.h_kJmol;
  cp.H2O = 4.18;   // reporting only — H2O always routes through IF97
  const wa = waterMolarH(Ta, Pa, 'liquid');
  if (wa.error) return wa;

  // condensed-phase Cp of the three anchored species, in kJ/(mol·K)
  const cpMolar = {};
  const mw = {};
  for (const k of ANCHORED_KEYS) {
    const rec = resolve(k);
    if (rec.error) return rec;
    mw[k] = rec.mw;
    cp[k] = num(rec.cp_liq_kjkgk) ? rec.cp_liq_kjkgk
      : (num(rec.cp_sol_kjkgk) ? rec.cp_sol_kjkgk : 2.0);
    cpMolar[k] = cp[k] * rec.mw / 1000;
  }

  // impose the prescribed heats AT the anchor state, then walk back to 298.15
  const hNH3a = hf.NH3 + cp.NH3 * resolve('NH3').mw / 1000 * dTa;
  const hCO2a = hf.CO2 + cp.CO2 * resolve('CO2').mw / 1000 * dTa;
  const hCarbA = 2 * hNH3a + hCO2a + dHr1;
  const hUreaA = hCarbA - wa.h_kJmol + dHr2;
  const hBiuA = 2 * hUreaA - hNH3a + dHr3;
  hf.amm_carbamate = hCarbA - cpMolar.amm_carbamate * dTa;
  hf.urea = hUreaA - cpMolar.urea * dTa;
  hf.biuret = hBiuA - cpMolar.biuret * dTa;

  const tabulated = {};
  const offsets = {};
  for (const k of ANCHORED_KEYS) {
    const rec = resolve(k);
    const tab = rec.hf_sol_298 != null ? rec.hf_sol_298 : rec.hf_liq_298;
    tabulated[k] = tab;
    offsets[k] = tab != null ? hf[k] - tab : null;
  }
  notes.push(`urea/carbamate/biuret reference enthalpies are RE-ANCHORED so that ΔHr = ${dHr1} / ${dHr2} / ${dHr3} kJ/mol holds exactly at ${Ta.toFixed(2)} K, ${Pa} bar (HP melt/solution state) — the tabulated crystal Hf set is NOT used`);

  ANCHOR = {
    hf, cp,
    dHr: { carbamate: dHr1, dehydration: dHr2, biuret: dHr3 },
    anchor: { T_K: Ta, P_bar: Pa },
    tabulated, offsets, notes,
  };
  return ANCHOR;
}

/**
 * Condensed-phase (melt) molar enthalpy on the re-anchored basis [kJ/mol].
 * Water routes through IF97 at (T, P); everything else is hf* + cp·ΔT.
 * @param {string} key
 * @param {number} T_K
 * @param {number} P_bar
 * @param {object} anc meltAnchor result
 * @returns {{h_kJmol:number, method:string}|{error:object}}
 */
function hMeltMolar(key, T_K, P_bar, anc) {
  const { errObj, num, resolve, waterMolarH, dhvapT } = C();
  if (key === 'H2O') {
    const w = waterMolarH(T_K, P_bar, 'liquid');
    if (w.error) return w;
    return { h_kJmol: w.h_kJmol, method: 'if97_liquid' };
  }
  const rec = resolve(key);
  if (rec.error) return rec;
  let hf = anc.hf[key];
  let method = ANCHORED_KEYS.includes(key) ? 'anchored_melt' : 'hf_gas_minus_dhvap';
  let cp = anc.cp[key];
  if (!num(hf)) {
    // a melt component outside the urea chain (e.g. a dissolved salt)
    if (num(rec.hf_liq_298)) { hf = rec.hf_liq_298; method = 'hf_liq'; }
    else if (rec.hf_sol_298 != null) { hf = rec.hf_sol_298; method = 'hf_sol'; }
    else if (num(rec.hf_gas_298)) {
      const v = dhvapT(key, 298.15);
      if (v.error) return v;
      hf = rec.hf_gas_298 - v.dhvap_kJmol;
      method = 'hf_gas_minus_dhvap';
    } else {
      return errObj('MB_UREA_NO_MELT_PATH',
        `component '${key}' has no condensed-phase enthalpy data for the melt basis`, 'components');
    }
    cp = num(rec.cp_liq_kjkgk) ? rec.cp_liq_kjkgk
      : (num(rec.cp_sol_kjkgk) ? rec.cp_sol_kjkgk : 2.0);
  }
  return { h_kJmol: hf + cp * rec.mw / 1000 * (T_K - 298.15), method };
}

/**
 * Total enthalpy of a MELT stream given mole flows [kJ/h]. Urea-chain species
 * use the anchored condensed basis; anything else (inerts, dissolved gases
 * outside the chain) is evaluated on the Part-1 gas route, since in the HP
 * loop those species are physically in the vapour space.
 * @param {Array<{key:string, n_kmol_h:number}>} entries
 * @param {number} T_K
 * @param {number} P_bar
 * @param {object} anc
 * @returns {{H_kJh:number, cp_kJ_hK:number, perComponent:Array}|{error:object}}
 */
function meltEnthalpy(entries, T_K, P_bar, anc) {
  const { num, resolve, hGasMolar } = C();
  let H = 0;
  let cpTot = 0;
  const per = [];
  for (const e of entries) {
    if (!num(e.n_kmol_h) || e.n_kmol_h <= 0) continue;
    const rec = resolve(e.key);
    if (rec.error) return rec;
    let h;
    let method;
    let cpMass;
    if (MELT_KEYS.includes(e.key) || rec.nonvolatile) {
      const r = hMeltMolar(e.key, T_K, P_bar, anc);
      if (r.error) return r;
      h = r.h_kJmol; method = r.method;
      cpMass = e.key === 'H2O' ? 4.4
        : (num(anc.cp[e.key]) ? anc.cp[e.key]
          : (num(rec.cp_liq_kjkgk) ? rec.cp_liq_kjkgk
            : (num(rec.cp_sol_kjkgk) ? rec.cp_sol_kjkgk : 2.0)));
    } else {
      const r = hGasMolar(e.key, T_K, { P_bar });
      if (r.error) return r;
      h = r.h_kJmol; method = 'gas';
      cpMass = 1.05;
    }
    const Hi = e.n_kmol_h * h * KMOL_TO_MOL;
    H += Hi;
    cpTot += e.n_kmol_h * rec.mw * cpMass;
    per.push({ key: e.key, n_kmol_h: e.n_kmol_h, h_kJmol: h, H_kJh: Hi, method });
  }
  return { H_kJh: H, cp_kJ_hK: cpTot, perComponent: per };
}

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

/** Mole-flow map from a mass-basis stream. @returns {Map|{error:object}} */
function molesOf(stream, warnings) {
  const { molarize } = C();
  const m = molarize(stream);
  if (m.error) return m;
  if (Array.isArray(m.warnings) && warnings) warnings.push(...m.warnings);
  const n = new Map();
  for (const c of m.components) n.set(c.key, (n.get(c.key) || 0) + c.n_kmol_h);
  return n;
}

/** Map → [{key, n_kmol_h}] preserving a preferred key order first. */
function entriesOf(map, order) {
  const out = [];
  const seen = new Set();
  for (const k of order || []) {
    if (map.has(k)) { out.push({ key: k, n_kmol_h: map.get(k) }); seen.add(k); }
  }
  for (const [k, v] of map.entries()) {
    if (!seen.has(k)) out.push({ key: k, n_kmol_h: v });
  }
  return out;
}

/** C and N atom counts per mole of each urea-chain species. */
const ATOMS = {
  CO2: { C: 1, N: 0 }, NH3: { C: 0, N: 1 }, H2O: { C: 0, N: 0 },
  urea: { C: 1, N: 2 }, amm_carbamate: { C: 1, N: 2 }, biuret: { C: 2, N: 3 },
};

/**
 * Carbon / nitrogen atom balance over a set of mole-flow entries [kmol/h].
 * Species outside ATOMS contribute nothing (inerts carry no C or N here).
 * @param {Array<{key:string,n_kmol_h:number}>} entries
 * @returns {{C:number, N:number}}
 */
function atomsOf(entries) {
  let Cc = 0;
  let Nn = 0;
  for (const e of entries) {
    const a = ATOMS[e.key];
    if (!a) continue;
    Cc += a.C * e.n_kmol_h;
    Nn += a.N * e.n_kmol_h;
  }
  return { C: Cc, N: Nn };
}

/** De-duplicate a warnings array, preserving order. */
function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const w of list) { if (!seen.has(w)) { seen.add(w); out.push(w); } }
  return out;
}

/** Clamp x into [lo, hi]. */
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

/** Range check that pushes a warning instead of failing. */
function envelopeCheck(label, value, range, unit, warnings, breaches) {
  if (!Array.isArray(range) || range.length !== 2) return;
  if (value < range[0] || value > range[1]) {
    breaches.push(label);
    warnings.push(`urea-reactor: ${label} = ${value.toFixed(3)} ${unit} is OUTSIDE the correlation validity envelope ${range[0]}–${range[1]} ${unit} — result is an extrapolation`);
  }
}

/** Saturated-steam properties at P [bar] from IF97. */
function steamAt(P_bar) {
  const s = if97.hf_hg(P_bar);
  const Tsat = if97.tsat_K ? if97.tsat_K(P_bar) : null;
  return {
    P_bar,
    T_sat_K: Tsat,
    hf_kJkg: s.hf,
    hg_kJkg: s.hg,
    hfg_kJkg: s.hg - s.hf,
  };
}

// ===========================================================================
// MODULE 'urea-reactor'
// ===========================================================================

/**
 * Evaluate the empirical conversion correlation.
 * @param {number} nc  N/C molar ratio
 * @param {number} wc  H2O/C molar ratio
 * @param {number} T_C reactor temperature [°C]
 * @param {number} P_bar
 * @param {number} eta approach factor (1.0 = design)
 * @param {object} p   urea_x_co2 params
 * @param {string[]} warnings
 * @returns {{X:number, X_pct:number, raw_pct:number, clamped:boolean,
 *            breaches:string[]}}
 */
function ureaConversion(nc, wc, T_C, P_bar, eta, p, warnings) {
  const ref = p.ref || { nc: 3.0, wc: 0.5, T_C: 185.0 };
  const dNC = nc - ref.nc;
  const dWC = wc - ref.wc;
  const dT = T_C - ref.T_C;
  const raw = p.X0_pct +
    p.a1 * dNC + p.a2 * dNC * dNC +
    p.b1 * dWC + p.b2 * dWC * dWC +
    p.c1 * dT + p.c2 * dT * dT +
    p.d1 * dNC * dWC;
  const scaled = raw * eta;
  const lim = p.clamp_pct || [25, 85];
  const X_pct = clamp(scaled, lim[0], lim[1]);

  const breaches = [];
  const env = p.envelope || {};
  envelopeCheck('N/C', nc, env.nc, '–', warnings, breaches);
  envelopeCheck('H2O/C', wc, env.wc, '–', warnings, breaches);
  envelopeCheck('reactor T', T_C, env.T_C, '°C', warnings, breaches);
  envelopeCheck('reactor P', P_bar, env.P_bar, 'bar(a)', warnings, breaches);
  if (Math.abs(X_pct - scaled) > 1e-9) {
    warnings.push(`urea-reactor: correlation returned ${scaled.toFixed(2)} % — clamped to the ${lim[0]}–${lim[1]} % physical band`);
  }
  return { X: X_pct / 100, X_pct, raw_pct: raw, clamped: Math.abs(X_pct - scaled) > 1e-9, breaches };
}

/** Biuret content of the reactor melt as wt% of urea. */
function biuretPct(T_C, nc, p) {
  const b = p.biuret || {};
  const ref = p.ref || { nc: 3.0, T_C: 185.0 };
  const v = (b.b0_pct != null ? b.b0_pct : 0.45) +
    (b.bT_per_C != null ? b.bT_per_C : 0.02) * (T_C - ref.T_C) +
    (b.bNC_per_unit != null ? b.bNC_per_unit : -0.15) * (nc - ref.nc);
  const lim = b.clamp_pct || [0.05, 2.5];
  return clamp(v, lim[0], lim[1]);
}

/**
 * MODULE 'urea-reactor' — HP urea synthesis reactor, EMPIRICAL ESTIMATE.
 *
 * streams: 1..4 inlets, all combined (fresh NH3, fresh/recycled CO2,
 *          carbamate solution from the HP condenser, LP recycle).
 * params:
 *   mode          'adiabatic' (default) | 'specified_T' | 'isothermal'
 *   T_out_K       required for specified_T; isothermal uses the mixed feed T
 *   P_bar         reactor pressure (default: lowest inlet P)
 *   T_corr_K      temperature the correlation is evaluated at (default: the
 *                 outlet T; for adiabatic mode the solve is iterated on it)
 *   X_co2         manual conversion override, fraction (0,1] — bypasses the
 *                 correlation but keeps the envelope warnings
 *   eta_approach  correlation multiplier for residence time / holdup (1.0)
 *   carbamate_fraction  of unconverted carbon that stays as carbamate
 *   biuret_pct    wt% of urea, overrides the biuret estimate
 *   Q_kW          external duty, + into the melt (adiabatic mode only)
 *
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveUreaReactor(input) {
  const { errObj, num, resolve, moduleInput, streamFromMoles, massBalance,
    energyBalance, KJH_PER_KW } = C();
  const mi = moduleInput(input, 1, 4);
  if (mi.error) return mi;
  const p = mi.params;
  const warnings = [];

  const cp = correlation('urea_x_co2');
  const cpar = mergeParams(UREA_X_CO2_FALLBACK, cp.params);

  // ---- feed aggregation ----
  const nIn = new Map();
  let mIn = 0;
  let Pmin = Infinity;
  let hSum = 0;   // for the mixed-feed temperature seed
  const anc0 = meltAnchor(cpar);
  if (anc0.error) return anc0;
  for (const s of mi.streams) {
    const n = molesOf(s, warnings);
    if (n.error) return n;
    for (const [k, v] of n.entries()) nIn.set(k, (nIn.get(k) || 0) + v);
    mIn += s.mass_flow_kg_h;
    Pmin = Math.min(Pmin, s.P_bar);
  }
  if (mIn <= 0) return errObj('MB_UREA_FEED', 'reactor feed mass flow is zero', 'streams');
  const P = num(p.P_bar) ? p.P_bar : Pmin;
  if (!num(P) || P <= 0) return errObj('MB_P', 'reactor pressure must be positive', 'P_bar');

  const feedEntries = entriesOf(nIn, UREA_KEYS);
  const eIn = meltEnthalpy(feedEntries, mi.streams[0].T_K, P, anc0);
  if (eIn.error) return eIn;

  // mixed feed temperature: enthalpy-weighted mix of the inlets
  let Hfeed = 0;
  for (const s of mi.streams) {
    const n = molesOf(s, []);
    if (n.error) return n;
    const e = meltEnthalpy(entriesOf(n, UREA_KEYS), s.T_K, P, anc0);
    if (e.error) return e;
    Hfeed += e.H_kJh;
    hSum += e.cp_kJ_hK * s.T_K;
  }
  const eMixCp = meltEnthalpy(feedEntries, 298.15, P, anc0);
  if (eMixCp.error) return eMixCp;
  const T_feed_mix = eMixCp.cp_kJ_hK > 0 ? hSum / eMixCp.cp_kJ_hK : mi.streams[0].T_K;

  // ---- elemental ratios (the correlation inputs) ----
  const g = (k) => nIn.get(k) || 0;
  const C_tot = g('CO2') + g('amm_carbamate') + g('urea') + 2 * g('biuret');
  const N_tot = g('NH3') + 2 * g('amm_carbamate') + 2 * g('urea') + 3 * g('biuret');
  const W_tot = g('H2O');
  if (C_tot <= 0) {
    return errObj('MB_UREA_NO_CARBON',
      'urea reactor feed contains no CO2, carbamate or urea — nothing to convert', 'streams');
  }
  if (N_tot <= 0) {
    return errObj('MB_UREA_NO_N', 'urea reactor feed contains no ammonia nitrogen', 'streams');
  }
  const nc = N_tot / C_tot;
  const wc = W_tot / C_tot;

  // ---- mode / temperature handling ----
  const mode = p.mode === undefined ? 'adiabatic' : p.mode;
  if (!['adiabatic', 'specified_T', 'isothermal'].includes(mode)) {
    return errObj('MB_UREA_MODE',
      `params.mode must be 'adiabatic', 'specified_T' or 'isothermal'`, 'mode');
  }
  if (mode === 'specified_T' && (!num(p.T_out_K) || p.T_out_K < UREA_T_MIN || p.T_out_K > UREA_T_MAX)) {
    return errObj('MB_UREA_T',
      `specified_T mode requires params.T_out_K in [${UREA_T_MIN}, ${UREA_T_MAX}] K`, 'T_out_K');
  }
  const Q_ext_kW = num(p.Q_kW) ? p.Q_kW : 0;
  if (Q_ext_kW !== 0 && mode !== 'adiabatic') {
    warnings.push('urea-reactor: params.Q_kW is only used in adiabatic mode — ignored');
  }
  const eta = num(p.eta_approach) ? p.eta_approach : 1.0;
  if (eta <= 0 || eta > 1.5) {
    return errObj('MB_UREA_ETA', 'params.eta_approach must be in (0, 1.5]', 'eta_approach');
  }

  /** One composition + enthalpy pass at a given correlation/outlet T. */
  const pass = (T_corr_K, T_out_K, wl) => {
    const T_C = T_corr_K - 273.15;
    let conv;
    if (num(p.X_co2)) {
      if (p.X_co2 <= 0 || p.X_co2 > 0.95) {
        return errObj('MB_UREA_X', 'params.X_co2 must be in (0, 0.95]', 'X_co2');
      }
      const probe = [];
      conv = ureaConversion(nc, wc, T_C, P, eta, cpar, probe);
      conv = { X: p.X_co2, X_pct: p.X_co2 * 100, raw_pct: conv.raw_pct,
        clamped: false, breaches: conv.breaches, overridden: true };
      wl.push(...probe.filter((w) => w.includes('OUTSIDE')));
    } else {
      conv = ureaConversion(nc, wc, T_C, P, eta, cpar, wl);
    }

    const U = conv.X * C_tot;                      // kmol/h urea by dehydration
    if (U < (nIn.get('urea') || 0) - 1e-12) {
      wl.push('urea-reactor: correlated urea output is below the urea already in the feed — the reactor is being fed more urea than it can hold at this conversion; check the recycle');
    }
    const bpct = num(p.biuret_pct) ? p.biuret_pct : biuretPct(T_C, nc, cpar);
    const mwU = resolve('urea').mw;
    const mwB = resolve('biuret').mw;
    let B = (bpct / 100) * (U * mwU) / mwB;        // kmol/h biuret
    if (2 * B > U) { B = U / 2; wl.push('urea-reactor: biuret estimate exceeded the urea formed — capped'); }

    const fcarb = num(p.carbamate_fraction) ? p.carbamate_fraction
      : cpar.carbamate_fraction;
    if (fcarb < 0 || fcarb > 1) {
      return errObj('MB_UREA_FCARB', 'carbamate_fraction must be in [0, 1]', 'carbamate_fraction');
    }
    const Cleft = C_tot - U;
    const nCarb = fcarb * Cleft;
    const nCO2 = Cleft - nCarb;

    const nUrea = U - 2 * B;
    const nH2O = W_tot + U;
    const nNH3 = N_tot - 2 * nUrea - 3 * B - 2 * nCarb;
    if (nNH3 < -1e-9) {
      return errObj('MB_UREA_N_DEFICIT',
        `ammonia balance is negative (${nNH3.toFixed(4)} kmol/h): N/C = ${nc.toFixed(3)} cannot support ${(conv.X * 100).toFixed(1)} % conversion with ${(fcarb * 100).toFixed(0)} % of the residue as carbamate`,
        'streams');
    }

    const out = new Map();
    out.set('urea', nUrea);
    out.set('amm_carbamate', nCarb);
    out.set('H2O', nH2O);
    out.set('NH3', Math.max(0, nNH3));
    out.set('CO2', nCO2);
    if (B > 0) out.set('biuret', B);
    for (const [k, v] of nIn.entries()) {
      if (!UREA_KEYS.includes(k)) out.set(k, (out.get(k) || 0) + v);
    }

    const xi1 = (nCarb + U) - (nIn.get('amm_carbamate') || 0);  // carbamate formed
    const xi2 = U;                                             // dehydration
    const xi3 = B;                                             // biuret

    const oEntries = entriesOf(out, UREA_KEYS);
    const eOut = meltEnthalpy(oEntries, T_out_K, P, anc0);
    if (eOut.error) return eOut;
    return { conv, U, B, nCarb, nCO2, nUrea, nH2O, nNH3, out, oEntries,
      xi1, xi2, xi3, eOut, bpct, fcarb };
  };

  // ---- solve ----
  let T_out;
  let st;
  let iterations = 0;
  let converged = true;
  if (mode === 'isothermal') {
    T_out = T_feed_mix;
    st = pass(T_out, T_out, warnings);
    if (st.error) return st;
  } else if (mode === 'specified_T') {
    T_out = p.T_out_K;
    const T_corr = num(p.T_corr_K) ? p.T_corr_K : T_out;
    st = pass(T_corr, T_out, warnings);
    if (st.error) return st;
  } else {
    // adiabatic: the correlation depends on T_out, and T_out depends on the
    // conversion, so iterate. Q + ΔH_rxn(anchored) = 0 is already built into
    // the anchored basis, so the closure is simply H_out(T_out) = H_in + Q.
    const target = Hfeed + Q_ext_kW * KJH_PER_KW;
    let T = num(p.T_corr_K) ? p.T_corr_K : Math.min(UREA_T_MAX - 1, T_feed_mix + 20);
    const quiet = [];
    for (; iterations < 40; iterations++) {
      const trial = pass(T, T, quiet);
      if (trial.error) return trial;
      // secant-free update: linearise on the melt heat capacity
      const cpTot = trial.eOut.cp_kJ_hK;
      if (!(cpTot > 0)) {
        return errObj('MB_UREA_CP', 'melt heat capacity evaluated to zero', 'streams');
      }
      const dT = (target - trial.eOut.H_kJh) / cpTot;
      const Tn = clamp(T + clamp(dT, -60, 60), UREA_T_MIN, UREA_T_MAX);
      if (Math.abs(Tn - T) < 1e-4) { T = Tn; break; }
      T = Tn;
    }
    converged = iterations < 40;
    if (!converged) {
      warnings.push(`urea-reactor: adiabatic iteration cap 40 reached — best estimate returned`);
    }
    T_out = T;
    st = pass(T_out, T_out, warnings);
    if (st.error) return st;
    if (T_out <= UREA_T_MIN + 1e-6 || T_out >= UREA_T_MAX - 1e-6) {
      converged = false;   // pinned at the bracket is NOT a converged solve
      warnings.push(`urea-reactor: adiabatic outlet pinned at the ${UREA_T_MIN}–${UREA_T_MAX} K melt window — check the feed enthalpy (a reactor fed raw NH3 + CO2 rather than condensed carbamate releases the full carbamate heat and cannot be adiabatic)`);
    }
  }

  if (T_out < UREA_T_MIN || T_out > UREA_T_MAX) {
    warnings.push(`urea-reactor: outlet ${T_out.toFixed(1)} K is outside the ${UREA_T_MIN}–${UREA_T_MAX} K melt window`);
  }

  // ---- outlet stream ----
  const outStream = streamFromMoles(st.oEntries, T_out, P, 'liquid');
  if (outStream.error) return outStream;
  const out = Object.assign({}, outStream, { H_kJh: st.eOut.H_kJh });

  // ---- balances ----
  const mb = massBalance(mIn, out.mass_flow_kg_h);
  const eb = energyBalance(Hfeed, st.eOut.H_kJh, 0);
  const heat_release_kJ_h = -(st.xi1 * anc0.dHr.carbamate +
    st.xi2 * anc0.dHr.dehydration + st.xi3 * anc0.dHr.biuret) * KMOL_TO_MOL;

  // ---- composition report (melt, wt%) ----
  const mwOf = (k) => resolve(k).mw;
  const massOut = st.oEntries.map((e) => ({ key: e.key, kg_h: e.n_kmol_h * mwOf(e.key) }));
  const mTot = massOut.reduce((a, x) => a + x.kg_h, 0) || 1;
  const melt = massOut.map((x) => ({ key: x.key, kg_h: x.kg_h, wt_pct: 100 * x.kg_h / mTot }));

  const details = {
    estimate_flag: 'EMPIRICAL ESTIMATE',
    empirical_estimate: true,
    correlation: {
      key: 'urea_x_co2',
      source: cp.source,                 // 'supabase' | 'embedded' | 'missing'
      note: cp.note,
      form: cpar.form,
      eta_approach: eta,
      overridden: !!st.conv.overridden,
      raw_pct: st.conv.raw_pct,
      clamped: st.conv.clamped,
      envelope: cpar.envelope,
      envelope_ok: st.conv.breaches.length === 0,
      envelope_breaches: st.conv.breaches,
    },
    mode,
    T_feed_mix_K: T_feed_mix,
    T_out_K: T_out,
    delta_T_K: T_out - T_feed_mix,
    P_bar: P,
    ratios: { n_c: nc, h2o_c: wc, C_total_kmol_h: C_tot, N_total_kmol_h: N_tot },
    conversion: {
      X_co2: st.conv.X,
      X_co2_pct: st.conv.X_pct,
      urea_kmol_h: st.nUrea,
      urea_kg_h: st.nUrea * mwOf('urea'),
    },
    residuals: {
      carbamate_kmol_h: st.nCarb,
      carbamate_fraction_of_residue: st.fcarb,
      free_co2_kmol_h: st.nCO2,
      free_nh3_kmol_h: st.nNH3,
      biuret_kmol_h: st.B,
      biuret_wt_pct_of_urea: st.bpct,
    },
    extents_kmol_h: { carbamate: st.xi1, dehydration: st.xi2, biuret: st.xi3 },
    thermal: {
      basis: 'prescribed HP-loop reaction heats, built into the anchored condensed-phase reference enthalpies',
      dHr_carbamate_kJ_mol: anc0.dHr.carbamate,
      dHr_dehydration_kJ_mol: anc0.dHr.dehydration,
      dHr_biuret_kJ_mol: anc0.dHr.biuret,
      heat_release_kJ_h,
      heat_release_kW: heat_release_kJ_h / KJH_PER_KW,
      melt_cp_kJ_hK: st.eOut.cp_kJ_hK,
      Q_external_kW: mode === 'adiabatic' ? Q_ext_kW : eb.Q_kW,
    },
    enthalpy_basis: {
      anchored_hf_kJ_mol: {
        NH3: anc0.hf.NH3, CO2: anc0.hf.CO2, H2O: anc0.hf.H2O,
        amm_carbamate: anc0.hf.amm_carbamate, urea: anc0.hf.urea,
        biuret: anc0.hf.biuret,
      },
      anchor_state: anc0.anchor,
      tabulated_hf_sol_kJ_mol: anc0.tabulated,
      anchored_minus_tabulated_kJ_mol: anc0.offsets,
      note: anc0.notes[0],
    },
    atom_balance: (() => {
      const ai = atomsOf(feedEntries);
      const ao = atomsOf(st.oEntries);
      return {
        C_in_kmol_h: ai.C, C_out_kmol_h: ao.C,
        N_in_kmol_h: ai.N, N_out_kmol_h: ao.N,
        C_closure_pct: ai.C > 0 ? 100 * (ao.C - ai.C) / ai.C : 0,
        N_closure_pct: ai.N > 0 ? 100 * (ao.N - ai.N) / ai.N : 0,
      };
    })(),
    melt_composition: melt,
    outlet_mole_flows: st.oEntries,
  };

  warnings.unshift('urea-reactor: EMPIRICAL ESTIMATE — conversion comes from a tuned correlation, not from rigorous urea VLE. Use for balances, not as a design guarantee.');
  if (cp.source !== 'supabase') {
    warnings.push(`urea-reactor: correlation served from the ${cp.source} fallback (Supabase correlation_params not reached this request)`);
  }

  return {
    streams_out: [out],
    mass_balance: mb,
    energy_balance: eb,
    details,
    converged,
    iterations,
    warnings: uniq(warnings),
  };
}

// ===========================================================================
// MODULE 'hp-stripper'
// ===========================================================================

/**
 * MODULE 'hp-stripper' — HP falling-film carbamate stripper.
 *
 * streams: 1 = reactor melt (required); 2 = strip gas (optional: CO2 for a
 *          Stamicarbon-type CO2 stripper, NH3 for a Snamprogetti-type
 *          self-stripper, or omitted for pure thermal stripping).
 * outlets: [ off-gas to the HP carbamate condenser, stripped urea solution ]
 * params:
 *   decomposition_efficiency  fraction of feed carbamate decomposed (0.80)
 *   nh3_strip_efficiency      fraction of the free-NH3 pool to gas (0.85)
 *   co2_strip_efficiency      fraction of the free-CO2 pool to gas (0.97)
 *   h2o_to_gas_fraction       fraction of feed water carried over (0.03)
 *   T_out_K                   bottom liquid temperature (default: feed T)
 *   T_gas_out_K               top gas temperature (default: T_out_K)
 *   P_bar                     stripper pressure (default: feed P)
 *   steam_P_bar               MP heating steam pressure (default 23 bar)
 *   steam_superheat_K         optional superheat on the supply steam (0)
 *
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveHPStripper(input) {
  const { errObj, num, resolve, moduleInput, streamFromMoles, streamEnthalpy,
    massBalance, energyBalance, KJH_PER_KW } = C();
  const mi = moduleInput(input, 1, 2);
  if (mi.error) return mi;
  const p = mi.params;
  const warnings = [];

  const cpar = mergeParams(UREA_X_CO2_FALLBACK, correlation('urea_x_co2').params);
  const anc = meltAnchor(cpar);
  if (anc.error) return anc;

  const feed = mi.streams[0];
  const gasIn = mi.streams[1] || null;
  const P = num(p.P_bar) ? p.P_bar : feed.P_bar;
  if (!num(P) || P <= 0) return errObj('MB_P', 'stripper pressure must be positive', 'P_bar');
  const T_liq = num(p.T_out_K) ? p.T_out_K : feed.T_K;
  if (T_liq < STRIP_T_MIN || T_liq > STRIP_T_MAX) {
    warnings.push(`hp-stripper: bottom temperature ${T_liq.toFixed(1)} K is outside the ${STRIP_T_MIN}–${STRIP_T_MAX} K HP window`);
  }
  const T_gas = num(p.T_gas_out_K) ? p.T_gas_out_K : T_liq;

  const nFeed = molesOf(feed, warnings);
  if (nFeed.error) return nFeed;
  const nStrip = gasIn ? molesOf(gasIn, warnings) : new Map();
  if (nStrip.error) return nStrip;

  const eff = num(p.decomposition_efficiency) ? p.decomposition_efficiency : 0.80;
  const effN = num(p.nh3_strip_efficiency) ? p.nh3_strip_efficiency : 0.85;
  const effC = num(p.co2_strip_efficiency) ? p.co2_strip_efficiency : 0.97;
  const fW = num(p.h2o_to_gas_fraction) ? p.h2o_to_gas_fraction : 0.03;
  for (const [lab, v] of [['decomposition_efficiency', eff],
    ['nh3_strip_efficiency', effN], ['co2_strip_efficiency', effC],
    ['h2o_to_gas_fraction', fW]]) {
    if (v < 0 || v > 1) return errObj('MB_STRIP_FRAC', `params.${lab} must be in [0, 1]`, lab);
  }

  const gf = (k) => nFeed.get(k) || 0;
  const gs = (k) => nStrip.get(k) || 0;
  const carbIn = gf('amm_carbamate');
  if (carbIn <= 0 && gf('NH3') <= 0) {
    warnings.push('hp-stripper: feed carries neither carbamate nor free ammonia — nothing to strip');
  }

  // 1. carbamate decomposition: NH2COONH4 → 2 NH3 + CO2
  const D = eff * carbIn;
  // 2. free pools available to the gas
  const nh3Pool = gf('NH3') + 2 * D + gs('NH3');
  const co2Pool = gf('CO2') + D + gs('CO2');
  const h2oPool = gf('H2O') + gs('H2O');

  const nh3Gas = effN * nh3Pool;
  const co2Gas = effC * co2Pool;
  const h2oGas = fW * h2oPool;

  const gasOut = new Map();
  gasOut.set('NH3', nh3Gas);
  gasOut.set('CO2', co2Gas);
  gasOut.set('H2O', h2oGas);
  const liqOut = new Map();
  liqOut.set('urea', gf('urea') + gs('urea'));
  liqOut.set('amm_carbamate', carbIn - D + gs('amm_carbamate'));
  liqOut.set('H2O', h2oPool - h2oGas);
  liqOut.set('NH3', nh3Pool - nh3Gas);
  liqOut.set('CO2', co2Pool - co2Gas);
  const biu = gf('biuret') + gs('biuret');
  if (biu > 0) liqOut.set('biuret', biu);
  // inerts follow the gas
  for (const m of [nFeed, nStrip]) {
    for (const [k, v] of m.entries()) {
      if (!UREA_KEYS.includes(k)) gasOut.set(k, (gasOut.get(k) || 0) + v);
    }
  }

  const gasEntries = entriesOf(gasOut, ['NH3', 'CO2', 'H2O']).filter((e) => e.n_kmol_h > 0);
  const liqEntries = entriesOf(liqOut, UREA_KEYS).filter((e) => e.n_kmol_h > 1e-15);
  if (gasEntries.length === 0) {
    return errObj('MB_STRIP_NO_GAS', 'stripper produced no off-gas — check the decomposition and stripping efficiencies', 'params');
  }
  if (liqEntries.length === 0) {
    return errObj('MB_STRIP_NO_LIQ', 'stripper produced no bottom liquid', 'params');
  }

  const sGas = streamFromMoles(gasEntries, T_gas, P, 'gas');
  if (sGas.error) return sGas;
  const sLiq = streamFromMoles(liqEntries, T_liq, P, 'liquid');
  if (sLiq.error) return sLiq;

  // ---- enthalpies: gas on the Part-1 gas route, liquid on the melt basis ----
  const eGas = streamEnthalpy(sGas);
  if (eGas.error) return eGas;
  warnings.push(...eGas.warnings);
  const eLiq = meltEnthalpy(liqEntries, T_liq, P, anc);
  if (eLiq.error) return eLiq;

  const eFeed = meltEnthalpy(entriesOf(nFeed, UREA_KEYS), feed.T_K, feed.P_bar, anc);
  if (eFeed.error) return eFeed;
  let Hin = eFeed.H_kJh;
  let mIn = feed.mass_flow_kg_h;
  if (gasIn) {
    const eSg = streamEnthalpy(gasIn);
    if (eSg.error) return eSg;
    warnings.push(...eSg.warnings);
    Hin += eSg.H_kJh;
    mIn += gasIn.mass_flow_kg_h;
  }
  const Hout = eGas.H_kJh + eLiq.H_kJh;
  const eb = energyBalance(Hin, Hout, 0);

  // ---- MP steam ----
  const Psteam = num(p.steam_P_bar) ? p.steam_P_bar : 23.0;
  if (Psteam <= 0) return errObj('MB_STRIP_STEAM_P', 'params.steam_P_bar must be positive', 'steam_P_bar');
  const stm = steamAt(Psteam);
  let steam_kg_h = null;
  let approach_K = null;
  if (num(stm.T_sat_K)) {
    approach_K = stm.T_sat_K - T_liq;
    if (approach_K < STEAM_APPROACH_MIN_K) {
      warnings.push(`hp-stripper: ${Psteam} bar steam saturates at ${stm.T_sat_K.toFixed(1)} K — only ${approach_K.toFixed(1)} K above the ${T_liq.toFixed(1)} K bottom; raise steam_P_bar`);
    }
  }
  if (eb.Q_kW > 0 && stm.hfg_kJkg > 0) {
    steam_kg_h = eb.Q_kW * KJH_PER_KW / stm.hfg_kJkg;
  } else if (eb.Q_kW <= 0) {
    warnings.push('hp-stripper: the balance requires cooling, not heating — no steam rate reported (check T_out_K and the stripping efficiencies)');
  }

  const mwOf = (k) => resolve(k).mw;
  const ureaKgh = (liqOut.get('urea') || 0) * mwOf('urea');
  const details = {
    P_bar: P,
    T_in_K: feed.T_K,
    T_liquid_out_K: T_liq,
    T_gas_out_K: T_gas,
    strip_gas: gasIn ? (gs('CO2') >= gs('NH3') ? 'co2' : 'nh3') : 'none',
    strip_gas_kmol_h: gasIn ? [...nStrip.values()].reduce((a, b) => a + b, 0) : 0,
    decomposition: {
      efficiency: eff,
      carbamate_in_kmol_h: carbIn,
      carbamate_decomposed_kmol_h: D,
      carbamate_out_kmol_h: carbIn - D,
    },
    stripping: {
      nh3_efficiency: effN, co2_efficiency: effC, h2o_to_gas_fraction: fW,
      nh3_to_gas_kmol_h: nh3Gas, co2_to_gas_kmol_h: co2Gas,
      h2o_to_gas_kmol_h: h2oGas,
      nh3_in_bottoms_kmol_h: liqOut.get('NH3'),
      co2_in_bottoms_kmol_h: liqOut.get('CO2'),
    },
    solution_out: {
      urea_kg_h: ureaKgh,
      urea_wt_pct: sLiq.mass_flow_kg_h > 0 ? 100 * ureaKgh / sLiq.mass_flow_kg_h : 0,
      biuret_wt_pct: sLiq.mass_flow_kg_h > 0 ? 100 * biu * mwOf('biuret') / sLiq.mass_flow_kg_h : 0,
      h2o_wt_pct: sLiq.mass_flow_kg_h > 0 ? 100 * (liqOut.get('H2O') || 0) * mwOf('H2O') / sLiq.mass_flow_kg_h : 0,
    },
    steam: {
      P_bar: Psteam,
      T_sat_K: stm.T_sat_K,
      hfg_kJkg: stm.hfg_kJkg,
      approach_K,
      steam_kg_h,
      steam_t_per_t_urea: (steam_kg_h != null && ureaKgh > 0) ? steam_kg_h / ureaKgh : null,
    },
    gas_mole_flows: gasEntries,
    liquid_mole_flows: liqEntries,
  };

  return {
    streams_out: [Object.assign({}, sGas, { H_kJh: eGas.H_kJh }),
      Object.assign({}, sLiq, { H_kJh: eLiq.H_kJh })],
    mass_balance: massBalance(mIn, sGas.mass_flow_kg_h + sLiq.mass_flow_kg_h),
    energy_balance: eb,
    details,
    converged: true,
    iterations: 0,
    warnings: uniq(warnings),
  };
}

// ===========================================================================
// MODULE 'sls' — solid–liquid separator (centrifuge / filter / crystal cut)
// ===========================================================================

/**
 * MODULE 'sls'.
 * streams: 1 = slurry feed.
 * outlets: [ cake (wet solids), mother liquor (filtrate) ]
 * params:
 *   solid_keys      array of component keys treated as solid; default = every
 *                   component flagged nonvolatile in the library
 *   recovery        fraction of solids reporting to the cake (0.98)
 *   cake_moisture   mass fraction of ADHERING LIQUOR in the cake (0.05)
 *   wash_kg_h       optional wash liquid added to the cake (0)
 *   T_out_K         both outlets (default: feed T)
 *   P_bar           both outlets (default: feed P)
 *
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveSLS(input) {
  const { errObj, num, resolve, moduleInput, molarize, massBalance,
    energyBalance, streamEnthalpy } = C();
  const mi = moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const p = mi.params;
  const warnings = [];
  const feed = mi.streams[0];

  const mol = molarize(feed);
  if (mol.error) return mol;
  warnings.push(...mol.warnings);

  let solidKeys = p.solid_keys;
  if (solidKeys === undefined) {
    solidKeys = mol.components
      .filter((c) => { const r = resolve(c.key); return !r.error && r.nonvolatile; })
      .map((c) => c.key);
  }
  if (!Array.isArray(solidKeys) || solidKeys.length === 0) {
    return errObj('MB_SLS_SOLIDS',
      'no solid phase identified — pass params.solid_keys (the feed has no nonvolatile component)', 'solid_keys');
  }
  const isSolid = new Set(solidKeys);

  const rec = num(p.recovery) ? p.recovery : 0.98;
  const wCake = num(p.cake_moisture) ? p.cake_moisture : 0.05;
  if (rec <= 0 || rec > 1) return errObj('MB_SLS_RECOVERY', 'params.recovery must be in (0, 1]', 'recovery');
  if (wCake < 0 || wCake >= 1) return errObj('MB_SLS_MOISTURE', 'params.cake_moisture must be in [0, 1)', 'cake_moisture');

  // mass split
  let mSolid = 0;
  let mLiquor = 0;
  const solidMass = new Map();
  const liquorMass = new Map();
  for (const c of mol.components) {
    const m = feed.mass_flow_kg_h * c.mass_fraction;
    if (isSolid.has(c.key)) { mSolid += m; solidMass.set(c.key, m); }
    else { mLiquor += m; liquorMass.set(c.key, m); }
  }
  if (mSolid <= 0) {
    return errObj('MB_SLS_NO_SOLID', 'the feed carries no solid-phase mass', 'streams');
  }

  const mSolidCake = rec * mSolid;
  const mSolidFilt = mSolid - mSolidCake;
  // adhering liquor: wCake is the wet-cake moisture mass fraction
  const mLiqCake = wCake > 0 ? mSolidCake * wCake / (1 - wCake) : 0;
  if (mLiqCake > mLiquor + 1e-9) {
    return errObj('MB_SLS_LIQUOR_SHORT',
      `cake moisture ${(wCake * 100).toFixed(1)} % needs ${mLiqCake.toFixed(2)} kg/h of liquor but only ${mLiquor.toFixed(2)} kg/h is present`,
      'cake_moisture');
  }
  const fLiqToCake = mLiquor > 0 ? mLiqCake / mLiquor : 0;
  if (mSolidFilt > 0) {
    warnings.push(`sls: ${(100 * (1 - rec)).toFixed(2)} % of the solids (${mSolidFilt.toFixed(3)} kg/h) leave with the mother liquor`);
  }

  const build = (get) => {
    const comps = [];
    let tot = 0;
    for (const c of mol.components) {
      const m = get(c.key);
      if (m > 0) { comps.push({ key: c.key, m }); tot += m; }
    }
    if (tot <= 0) return null;
    return {
      mass_flow_kg_h: tot,
      components: comps.map((x) => ({ key: x.key, mass_fraction: x.m / tot })),
    };
  };

  const cakeRaw = build((k) => (isSolid.has(k) ? rec * (solidMass.get(k) || 0)
    : fLiqToCake * (liquorMass.get(k) || 0)));
  const filtRaw = build((k) => (isSolid.has(k) ? (1 - rec) * (solidMass.get(k) || 0)
    : (1 - fLiqToCake) * (liquorMass.get(k) || 0)));
  if (!cakeRaw) return errObj('MB_SLS_NO_CAKE', 'cake stream is empty', 'params');
  if (!filtRaw) return errObj('MB_SLS_NO_FILTRATE', 'mother-liquor stream is empty — recovery 1.0 with zero cake moisture leaves nothing behind', 'params');

  const T = num(p.T_out_K) ? p.T_out_K : feed.T_K;
  const P = num(p.P_bar) ? p.P_bar : feed.P_bar;
  const cake = Object.assign({ T_K: T, P_bar: P }, cakeRaw);
  const filt = Object.assign({ T_K: T, P_bar: P }, filtRaw);

  const eIn = streamEnthalpy(feed);
  if (eIn.error) return eIn;
  warnings.push(...eIn.warnings);
  const eCake = streamEnthalpy(cake);
  if (eCake.error) return eCake;
  const eFilt = streamEnthalpy(filt);
  if (eFilt.error) return eFilt;

  const details = {
    solid_keys: [...isSolid],
    recovery: rec,
    cake_moisture: wCake,
    feed: { solids_kg_h: mSolid, liquor_kg_h: mLiquor,
      solids_wt_pct: 100 * mSolid / feed.mass_flow_kg_h },
    cake: {
      total_kg_h: cake.mass_flow_kg_h,
      solids_kg_h: mSolidCake,
      liquor_kg_h: mLiqCake,
      moisture_wt_pct: 100 * mLiqCake / cake.mass_flow_kg_h,
    },
    mother_liquor: {
      total_kg_h: filt.mass_flow_kg_h,
      suspended_solids_kg_h: mSolidFilt,
      solids_wt_pct: 100 * mSolidFilt / filt.mass_flow_kg_h,
    },
    liquor_split_to_cake: fLiqToCake,
  };

  return {
    streams_out: [Object.assign({}, cake, { H_kJh: eCake.H_kJh }),
      Object.assign({}, filt, { H_kJh: eFilt.H_kJh })],
    mass_balance: massBalance(feed.mass_flow_kg_h,
      cake.mass_flow_kg_h + filt.mass_flow_kg_h),
    energy_balance: energyBalance(eIn.H_kJh, eCake.H_kJh + eFilt.H_kJh, 0),
    details,
    converged: true,
    iterations: 0,
    warnings: uniq(warnings),
  };
}

// ===========================================================================
// MODULE 'dryer' — convective solids dryer with a full gas-side balance
// ===========================================================================

/**
 * MODULE 'dryer'.
 * streams: 1 = wet solids; 2 = drying gas (required for the gas-side balance).
 * outlets: [ dried product, exhaust gas ]
 * params:
 *   moisture_key            volatile carried by the solid (default 'H2O')
 *   target_moisture         product moisture, mass fraction (0.003)
 *   solid_keys              components treated as product solids
 *                           (default = nonvolatile components)
 *   mode                    'specified_T' (default) | 'adiabatic'
 *   T_solid_out_K           product temperature (default: feed gas T − 20 K)
 *   T_gas_out_K             exhaust temperature — required for specified_T
 *   P_bar                   both outlets (default: solids feed P)
 *
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveDryer(input) {
  const { errObj, num, resolve, moduleInput, molarize, massBalance,
    energyBalance, streamEnthalpy, solveOutletT } = C();
  const mi = moduleInput(input, 2, 2);
  if (mi.error) return mi;
  const p = mi.params;
  const warnings = [];
  const wet = mi.streams[0];
  const gas = mi.streams[1];

  const mKey = typeof p.moisture_key === 'string' ? p.moisture_key : 'H2O';
  const target = num(p.target_moisture) ? p.target_moisture : 0.003;
  if (target < 0 || target >= 1) {
    return errObj('MB_DRYER_TARGET', 'params.target_moisture must be in [0, 1)', 'target_moisture');
  }
  const P = num(p.P_bar) ? p.P_bar : wet.P_bar;

  const molW = molarize(wet);
  if (molW.error) return molW;
  warnings.push(...molW.warnings);

  let solidKeys = p.solid_keys;
  if (solidKeys === undefined) {
    solidKeys = molW.components
      .filter((c) => { const r = resolve(c.key); return !r.error && r.nonvolatile; })
      .map((c) => c.key);
  }
  if (!Array.isArray(solidKeys) || solidKeys.length === 0) {
    return errObj('MB_DRYER_SOLIDS',
      'no solid phase identified — pass params.solid_keys', 'solid_keys');
  }
  const isSolid = new Set(solidKeys);

  let mMoist = 0;
  let mSolid = 0;
  const wetMass = new Map();
  for (const c of molW.components) {
    const m = wet.mass_flow_kg_h * c.mass_fraction;
    wetMass.set(c.key, m);
    if (c.key === mKey) mMoist += m;
    else if (isSolid.has(c.key)) mSolid += m;
    else {
      mSolid += m;
      warnings.push(`dryer: '${c.key}' is neither the moisture nor a listed solid — carried through with the product`);
    }
  }
  if (mSolid <= 0) return errObj('MB_DRYER_NO_SOLID', 'the wet feed carries no dry solid', 'streams');
  const w_in = mMoist / wet.mass_flow_kg_h;
  if (target >= w_in) {
    return errObj('MB_DRYER_TARGET_HIGH',
      `target moisture ${(target * 100).toFixed(3)} wt% is not below the feed moisture ${(w_in * 100).toFixed(3)} wt% — nothing to evaporate`,
      'target_moisture');
  }
  const mProd = mSolid / (1 - target);
  const mMoistOut = mProd - mSolid;
  const mEvap = mMoist - mMoistOut;

  // ---- product stream ----
  const prodComps = [];
  for (const c of molW.components) {
    const m = c.key === mKey ? mMoistOut : (wetMass.get(c.key) || 0);
    if (m > 0) prodComps.push({ key: c.key, m });
  }
  const T_gas_in = gas.T_K;
  const T_solid = num(p.T_solid_out_K) ? p.T_solid_out_K : Math.max(DRYER_T_MIN, T_gas_in - 20);
  const prod = {
    mass_flow_kg_h: mProd, T_K: T_solid, P_bar: P,
    components: prodComps.map((x) => ({ key: x.key, mass_fraction: x.m / mProd })),
  };

  // ---- exhaust gas ----
  const molG = molarize(gas);
  if (molG.error) return molG;
  warnings.push(...molG.warnings);
  const exhMass = new Map();
  for (const c of molG.components) exhMass.set(c.key, gas.mass_flow_kg_h * c.mass_fraction);
  exhMass.set(mKey, (exhMass.get(mKey) || 0) + mEvap);
  let mExh = 0;
  for (const v of exhMass.values()) mExh += v;
  const exhComps = [];
  for (const [k, v] of exhMass.entries()) if (v > 0) exhComps.push({ key: k, mass_fraction: v / mExh });

  const mode = p.mode === undefined ? 'specified_T' : p.mode;
  if (!['specified_T', 'adiabatic'].includes(mode)) {
    return errObj('MB_DRYER_MODE', `params.mode must be 'specified_T' or 'adiabatic'`, 'mode');
  }

  const eWet = streamEnthalpy(wet);
  if (eWet.error) return eWet;
  warnings.push(...eWet.warnings);
  const eGasIn = streamEnthalpy(gas);
  if (eGasIn.error) return eGasIn;
  warnings.push(...eGasIn.warnings);
  const eProd = streamEnthalpy(prod);
  if (eProd.error) return eProd;
  warnings.push(...eProd.warnings);
  const Hin = eWet.H_kJh + eGasIn.H_kJh;

  const exhShape = { mass_flow_kg_h: mExh, P_bar: P, components: exhComps.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction, phase: 'gas' })) };
  let T_gas_out;
  let iterations = 0;
  let converged = true;
  if (mode === 'adiabatic') {
    const targetH = Hin - eProd.H_kJh;
    const sol = solveOutletT(exhShape, targetH, Math.max(DRYER_T_MIN, T_solid - 50), T_gas_in + 10);
    if (sol.error) return sol;
    T_gas_out = sol.T_K;
    iterations = sol.iterations;
    converged = sol.converged;
    warnings.push(...(sol.warnings || []));
  } else {
    if (!num(p.T_gas_out_K)) {
      return errObj('MB_DRYER_TGAS', `specified_T mode requires params.T_gas_out_K [K]`, 'T_gas_out_K');
    }
    T_gas_out = p.T_gas_out_K;
  }
  if (T_gas_out < DRYER_T_MIN || T_gas_out > DRYER_T_MAX) {
    warnings.push(`dryer: exhaust temperature ${T_gas_out.toFixed(1)} K is outside the ${DRYER_T_MIN}–${DRYER_T_MAX} K window`);
  }
  const exh = Object.assign({ T_K: T_gas_out }, exhShape);
  const eExh = streamEnthalpy(exh);
  if (eExh.error) return eExh;
  warnings.push(...eExh.warnings);

  // ---- humidity + saturation check ----
  const mwM = resolve(mKey).mw;
  const mDryGas = gas.mass_flow_kg_h - (molG.components
    .filter((c) => c.key === mKey)
    .reduce((a, c) => a + gas.mass_flow_kg_h * c.mass_fraction, 0));
  const humIn = mDryGas > 0 ? (gas.mass_flow_kg_h - mDryGas) / mDryGas : null;
  const humOut = mDryGas > 0 ? (exhMass.get(mKey) || 0) / mDryGas : null;
  let saturation = null;
  if (mKey === 'H2O') {
    let nTot = 0;
    for (const [k, v] of exhMass.entries()) { const r = resolve(k); if (!r.error) nTot += v / r.mw; }
    const yW = nTot > 0 ? (exhMass.get(mKey) || 0) / mwM / nTot : 0;
    const psat = if97.psat_bar(T_gas_out);
    if (num(psat) && psat > 0) {
      saturation = (yW * P) / psat;
      if (saturation > 0.9) {
        warnings.push(`dryer: exhaust is ${(saturation * 100).toFixed(0)} % of saturation at ${T_gas_out.toFixed(1)} K / ${P} bar — condensation risk; raise the gas rate or the exhaust temperature`);
      }
    }
  }

  const details = {
    mode,
    moisture_key: mKey,
    solid_keys: [...isSolid],
    feed: { wet_kg_h: wet.mass_flow_kg_h, dry_solids_kg_h: mSolid,
      moisture_kg_h: mMoist, moisture_wt_pct: 100 * w_in },
    product: { kg_h: mProd, moisture_kg_h: mMoistOut,
      moisture_wt_pct: 100 * target, T_K: T_solid },
    evaporation_kg_h: mEvap,
    specific_evaporation_kg_per_kg_product: mProd > 0 ? mEvap / mProd : null,
    gas_side: {
      gas_in_kg_h: gas.mass_flow_kg_h,
      dry_gas_kg_h: mDryGas,
      exhaust_kg_h: mExh,
      T_gas_in_K: T_gas_in,
      T_gas_out_K: T_gas_out,
      humidity_in_kg_per_kg_dry: humIn,
      humidity_out_kg_per_kg_dry: humOut,
      relative_saturation_out: saturation,
    },
  };

  const eb = energyBalance(Hin, eProd.H_kJh + eExh.H_kJh, 0);
  details.duty_kW = eb.Q_kW;

  return {
    streams_out: [Object.assign({}, prod, { H_kJh: eProd.H_kJh }),
      Object.assign({}, exh, { H_kJh: eExh.H_kJh })],
    mass_balance: massBalance(wet.mass_flow_kg_h + gas.mass_flow_kg_h,
      mProd + mExh),
    energy_balance: eb,
    details,
    converged,
    iterations,
    warnings: uniq(warnings),
  };
}

// ===========================================================================
// MODULE 'urea-hp-loop' — reactor → stripper → HP carbamate condenser
// ===========================================================================

/**
 * HP carbamate condenser: absorb the stripper off-gas into the recycle
 * carbamate solution, forming carbamate and raising LP steam.
 * @returns {{stream:object, entries:Array, Q_kW:number, steam_kg_h:number,
 *            carbamate_formed_kmol_h:number}|{error:object}}
 */
function hpCondenser(gasStream, recycleStream, p, anc, warnings) {
  const { errObj, num, streamFromMoles, streamEnthalpy, KJH_PER_KW } = C();
  const T_out = num(p.condenser_T_K) ? p.condenser_T_K : 443.15;   // 170 °C
  const P = num(p.P_bar) ? p.P_bar : gasStream.P_bar;
  const fCond = num(p.condensation_fraction) ? p.condensation_fraction : 0.95;
  if (fCond < 0 || fCond > 1) {
    return errObj('MB_LOOP_FCOND', 'params.condensation_fraction must be in [0, 1]', 'condensation_fraction');
  }
  const n = molesOf(gasStream, warnings);
  if (n.error) return n;
  if (recycleStream) {
    const r = molesOf(recycleStream, warnings);
    if (r.error) return r;
    for (const [k, v] of r.entries()) n.set(k, (n.get(k) || 0) + v);
  }
  const co2 = n.get('CO2') || 0;
  const nh3 = n.get('NH3') || 0;
  // 2 NH3 + CO2 → carbamate, limited by whichever runs out first
  const ext = fCond * Math.min(co2, nh3 / 2);
  n.set('CO2', co2 - ext);
  n.set('NH3', nh3 - 2 * ext);
  n.set('amm_carbamate', (n.get('amm_carbamate') || 0) + ext);

  // inerts (passivation air, dissolved N2/O2/H2, ...) cannot recycle for ever:
  // they leave through the HP scrubber vent, together with an optional slip of
  // NH3/CO2 set by params.vent_fraction.
  const fVent = num(p.vent_fraction) ? p.vent_fraction : 0;
  if (fVent < 0 || fVent > 1) {
    return errObj('MB_LOOP_FVENT', 'params.vent_fraction must be in [0, 1]', 'vent_fraction');
  }
  const vent = new Map();
  for (const [k, v] of [...n.entries()]) {
    if (!UREA_KEYS.includes(k)) { vent.set(k, v); n.set(k, 0); }
    else if (fVent > 0 && (k === 'NH3' || k === 'CO2')) {
      vent.set(k, (vent.get(k) || 0) + fVent * v);
      n.set(k, v * (1 - fVent));
    }
  }
  const ventEntries = entriesOf(vent, ['NH3', 'CO2']).filter((e) => e.n_kmol_h > 1e-15);
  let ventStream = null;
  if (ventEntries.length) {
    const vs = streamFromMoles(ventEntries, T_out, P, 'gas');
    if (vs.error) return vs;
    const ev = streamEnthalpy(vs);
    if (ev.error) return ev;
    warnings.push(...ev.warnings);
    ventStream = Object.assign({}, vs, { H_kJh: ev.H_kJh });
  }

  const entries = entriesOf(n, UREA_KEYS).filter((e) => e.n_kmol_h > 1e-15);
  const s = streamFromMoles(entries, T_out, P, 'liquid');
  if (s.error) return s;
  const eOut = meltEnthalpy(entries, T_out, P, anc);
  if (eOut.error) return eOut;

  let Hin = 0;
  const eg = streamEnthalpy(gasStream);
  if (eg.error) return eg;
  Hin += eg.H_kJh;
  if (recycleStream) {
    const nr = molesOf(recycleStream, []);
    if (nr.error) return nr;
    const er = meltEnthalpy(entriesOf(nr, UREA_KEYS), recycleStream.T_K, P, anc);
    if (er.error) return er;
    Hin += er.H_kJh;
  }
  const Q_kW = (eOut.H_kJh + (ventStream ? ventStream.H_kJh : 0) - Hin) / KJH_PER_KW;
  const Psteam = num(p.condenser_steam_P_bar) ? p.condenser_steam_P_bar : 4.5;
  const stm = steamAt(Psteam);
  const steam_kg_h = (Q_kW < 0 && stm.hfg_kJkg > 0)
    ? (-Q_kW) * KJH_PER_KW / stm.hfg_kJkg : 0;
  if (num(stm.T_sat_K) && stm.T_sat_K >= T_out - STEAM_APPROACH_MIN_K) {
    warnings.push(`urea-hp-loop: ${Psteam} bar steam saturates at ${stm.T_sat_K.toFixed(1)} K — too close to the ${T_out.toFixed(1)} K condenser to raise steam`);
  }
  return {
    stream: Object.assign({}, s, { H_kJh: eOut.H_kJh }),
    vent: ventStream,
    entries,
    Q_kW,
    steam: { P_bar: Psteam, T_sat_K: stm.T_sat_K, steam_kg_h },
    carbamate_formed_kmol_h: ext,
  };
}

/** Bounded Wegstein acceleration (same convention as the PFR-recycle tear). */
function wegstein(x, gx, xp, gp, accelerate) {
  if (!accelerate || !isFinite(xp) || Math.abs(x - xp) < 1e-14) return gx;
  const s = (gx - gp) / (x - xp);
  let q = s / (s - 1);
  if (!isFinite(q)) return gx;
  q = Math.min(WEGSTEIN_QMAX, Math.max(WEGSTEIN_QMIN, q));
  return q * x + (1 - q) * gx;
}

/**
 * MODULE 'urea-hp-loop' — the HP synthesis loop as one converged unit.
 *
 * streams: 1 = fresh NH3, 2 = fresh CO2 (also used as CO2 strip gas),
 *          3 = LP carbamate recycle (optional).
 * outlets: [ stripped urea solution to LP recovery ]
 *          plus, when the feeds carry inerts or params.condenser.vent_fraction
 *          is set, [ HP scrubber vent ]. The HP carbamate recycle is INTERNAL
 *          (it is the converged tear) and is therefore not an outlet — the
 *          loop mass balance closes on fresh NH3 + fresh CO2 + LP recycle.
 * params: reactor_*, stripper_* and condenser_* groups (see the field lists on
 *         the individual modules); plus
 *   strip_gas_fraction   fraction of the fresh CO2 routed to the stripper as
 *                        strip gas, the balance going straight to the
 *                        condenser (1.0 = full CO2-stripping layout)
 *   max_iter             Wegstein cap (default 60)
 *
 * @param {{streams:Array, params?:object}} input
 * @returns {object}
 */
function solveUreaHPLoop(input) {
  const { errObj, num, moduleInput, massBalance, energyBalance, streamEnthalpy,
    KJH_PER_KW } = C();
  const mi = moduleInput(input, 2, 3);
  if (mi.error) return mi;
  const p = mi.params;
  const warnings = [];
  const nh3Feed = mi.streams[0];
  const co2Feed = mi.streams[1];
  const lpRecycle = mi.streams[2] || null;

  const cpar = mergeParams(UREA_X_CO2_FALLBACK, correlation('urea_x_co2').params);
  const anc = meltAnchor(cpar);
  if (anc.error) return anc;

  const P = num(p.P_bar) ? p.P_bar : Math.min(nh3Feed.P_bar, co2Feed.P_bar);
  const fStrip = num(p.strip_gas_fraction) ? p.strip_gas_fraction : 1.0;
  if (fStrip < 0 || fStrip > 1) {
    return errObj('MB_LOOP_FSTRIP', 'params.strip_gas_fraction must be in [0, 1]', 'strip_gas_fraction');
  }
  const maxIter = num(p.max_iter) ? Math.min(200, Math.max(5, p.max_iter)) : LOOP_MAX_ITER;

  const split = (s, f) => (f <= 0 ? null : Object.assign({}, s, { mass_flow_kg_h: s.mass_flow_kg_h * f }));
  const stripGas = split(co2Feed, fStrip);
  const co2ToCond = split(co2Feed, 1 - fStrip);

  const rp = Object.assign({ mode: 'specified_T', T_out_K: 458.15, P_bar: P }, p.reactor || {});
  const sp = Object.assign({ P_bar: P }, p.stripper || {});
  const cp2 = Object.assign({ P_bar: P }, p.condenser || {});

  // tear stream: the carbamate solution leaving the HP condenser
  let tear = null;
  let prev = null;
  let prevG = null;
  let iterations = 0;
  let converged = false;
  let rxn = null;
  let strip = null;
  let cond = null;

  for (; iterations < maxIter; iterations++) {
    const quiet = [];
    const rxFeeds = [nh3Feed];
    if (tear) rxFeeds.push(tear);
    else if (co2ToCond) rxFeeds.push(co2ToCond);
    else rxFeeds.push(Object.assign({}, co2Feed, { mass_flow_kg_h: co2Feed.mass_flow_kg_h * 0.999 }));
    if (lpRecycle && !tear) rxFeeds.push(lpRecycle);

    rxn = solveUreaReactor({ streams: rxFeeds, params: rp });
    if (rxn.error) return rxn;
    strip = solveHPStripper({
      streams: stripGas ? [rxn.streams_out[0], stripGas] : [rxn.streams_out[0]],
      params: sp,
    });
    if (strip.error) return strip;
    const condFeeds = [];
    if (co2ToCond) condFeeds.push(co2ToCond);
    if (lpRecycle) condFeeds.push(lpRecycle);
    cond = hpCondenser(strip.streams_out[0],
      condFeeds.length ? mergeStreams(condFeeds) : null, cp2, anc, quiet);
    if (cond.error) return cond;

    const g = cond.stream;
    if (tear) {
      const dm = Math.abs(g.mass_flow_kg_h - tear.mass_flow_kg_h) /
        Math.max(1e-9, tear.mass_flow_kg_h);
      const dT = Math.abs(g.T_K - tear.T_K);
      let dx = 0;
      for (const c of g.components) {
        const old = tear.components.find((z) => z.key === c.key);
        dx = Math.max(dx, Math.abs(c.mass_fraction - (old ? old.mass_fraction : 0)));
      }
      if (dm < LOOP_TOL_FLOWREL && dx < LOOP_TOL_X && dT < LOOP_TOL_T) {
        converged = true;
        tear = g;
        break;
      }
    }
    const xNew = g.mass_flow_kg_h;
    const acc = tear !== null && prev !== null;
    const mAcc = wegstein(tear ? tear.mass_flow_kg_h : xNew, xNew, prev, prevG, acc);
    prev = tear ? tear.mass_flow_kg_h : xNew;
    prevG = xNew;
    tear = Object.assign({}, g, { mass_flow_kg_h: Math.max(1e-9, mAcc) });
  }
  if (!converged) {
    warnings.push(`urea-hp-loop: Wegstein tear did not converge in ${maxIter} iterations — best estimate returned`);
  }

  warnings.push(...rxn.warnings, ...strip.warnings);

  // overall balance
  let mIn = nh3Feed.mass_flow_kg_h + co2Feed.mass_flow_kg_h +
    (lpRecycle ? lpRecycle.mass_flow_kg_h : 0);
  const eN = streamEnthalpy(nh3Feed);
  if (eN.error) return eN;
  const eC = streamEnthalpy(co2Feed);
  if (eC.error) return eC;
  let Hin = eN.H_kJh + eC.H_kJh;
  if (lpRecycle) {
    const nr = molesOf(lpRecycle, []);
    if (nr.error) return nr;
    const er = meltEnthalpy(entriesOf(nr, UREA_KEYS), lpRecycle.T_K, P, anc);
    if (er.error) return er;
    Hin += er.H_kJh;
  }
  // At convergence the condenser liquid IS the tear (internal recycle), so the
  // only loop outlets are the stripped urea solution and the HP scrubber vent.
  const product = strip.streams_out[1];
  const vent = cond.vent;
  const Hout = (product.H_kJh || 0) + (vent ? vent.H_kJh : 0);

  const ureaKgh = product.components.reduce((a, c) =>
    a + (c.key === 'urea' ? product.mass_flow_kg_h * c.mass_fraction : 0), 0);

  // overall C / N closure across the loop (the tear is internal, so every
  // carbon atom fed as fresh CO2 or LP recycle must leave in a product stream)
  const atomsIn = { C: 0, N: 0 };
  const atomsOut = { C: 0, N: 0 };
  for (const s of [nh3Feed, co2Feed, lpRecycle]) {
    if (!s) continue;
    const n = molesOf(s, []);
    if (n.error) return n;
    const a = atomsOf(entriesOf(n, UREA_KEYS));
    atomsIn.C += a.C; atomsIn.N += a.N;
  }
  for (const s of [product, vent]) {
    if (!s) continue;
    const n = molesOf(s, []);
    if (n.error) return n;
    const a = atomsOf(entriesOf(n, UREA_KEYS));
    atomsOut.C += a.C; atomsOut.N += a.N;
  }

  const details = {
    estimate_flag: 'EMPIRICAL ESTIMATE',
    empirical_estimate: true,
    P_bar: P,
    strip_gas_fraction: fStrip,
    tear: {
      variable: 'HP carbamate condenser outlet (carbamate solution to the reactor)',
      mass_flow_kg_h: tear ? tear.mass_flow_kg_h : null,
      T_K: tear ? tear.T_K : null,
      tolerance: { flow_rel: LOOP_TOL_FLOWREL, mass_frac: LOOP_TOL_X, T_K: LOOP_TOL_T },
    },
    reactor: rxn.details,
    stripper: strip.details,
    condenser: {
      T_K: cond.stream.T_K,
      duty_kW: cond.Q_kW,
      carbamate_formed_kmol_h: cond.carbamate_formed_kmol_h,
      carbamate_solution_kg_h: cond.stream.mass_flow_kg_h,
      steam: cond.steam,
      vent_kg_h: vent ? vent.mass_flow_kg_h : 0,
    },
    atom_balance: {
      C_in_kmol_h: atomsIn.C, C_out_kmol_h: atomsOut.C,
      N_in_kmol_h: atomsIn.N, N_out_kmol_h: atomsOut.N,
      C_closure_pct: atomsIn.C > 0 ? 100 * (atomsOut.C - atomsIn.C) / atomsIn.C : 0,
      N_closure_pct: atomsIn.N > 0 ? 100 * (atomsOut.N - atomsIn.N) / atomsIn.N : 0,
    },
    production: {
      urea_solution_kg_h: product.mass_flow_kg_h,
      urea_kg_h: ureaKgh,
      urea_t_per_day: ureaKgh * 24 / 1000,
      nh3_specific_consumption_kg_per_t_urea:
        ureaKgh > 0 ? nh3Feed.mass_flow_kg_h / (ureaKgh / 1000) : null,
      co2_specific_consumption_kg_per_t_urea:
        ureaKgh > 0 ? co2Feed.mass_flow_kg_h / (ureaKgh / 1000) : null,
      hp_steam_t_per_t_urea: strip.details.steam.steam_t_per_t_urea,
    },
  };

  return {
    streams_out: vent ? [product, vent] : [product],
    mass_balance: massBalance(mIn,
      product.mass_flow_kg_h + (vent ? vent.mass_flow_kg_h : 0)),
    energy_balance: energyBalance(Hin, Hout, 0),
    details,
    converged,
    iterations,
    warnings: uniq(warnings),
  };
}

/** Merge N mass-basis streams into one (enthalpy-free helper for the loop). */
function mergeStreams(list) {
  let m = 0;
  const acc = new Map();
  let T = 0;
  for (const s of list) {
    m += s.mass_flow_kg_h;
    T += s.mass_flow_kg_h * s.T_K;
    for (const c of s.components) {
      acc.set(c.key, (acc.get(c.key) || 0) + s.mass_flow_kg_h * c.mass_fraction);
    }
  }
  const comps = [];
  for (const [k, v] of acc.entries()) if (v > 0) comps.push({ key: k, mass_fraction: v / m });
  return { mass_flow_kg_h: m, T_K: m > 0 ? T / m : list[0].T_K,
    P_bar: list[0].P_bar, components: comps };
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

/**
 * Receive the mb-engine internal toolbox and hand back the Part-6 solver map.
 * Called exactly once, at mb-engine module load.
 * @param {object} toolbox mb-engine internals (errObj, num, resolve, ...)
 * @returns {Object<string, function>} solver map for MODULES
 */
function register(toolbox) {
  core = toolbox;
  ANCHOR = null;
  return {
    'urea-reactor': solveUreaReactor,
    'hp-stripper': solveHPStripper,
    'sls': solveSLS,
    'dryer': solveDryer,
    'urea-hp-loop': solveUreaHPLoop,
  };
}

export default {
  PART6_VERSION,
  register,
  loadCorrelations,
  correlation,
  resetCorrelations,
  CORRELATION_FALLBACK,
};
