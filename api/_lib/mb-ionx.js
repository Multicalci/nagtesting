// ============================================================================
// REPO PATH: api/_lib/mb-ionx.js
// ============================================================================
// multicalci.com — flowsheet simulator — WATER TREATMENT (Nov 2026):
// ion exchange (DM plant cation / anion / mixed bed, softener) and degassing.
//
//   ion-exchange   1 inlet (water) → [treated water, regeneration waste]
//     params.resin   sac_h   strong acid cation, H⁺ form (DM cation)
//                    wac     weak acid cation (dealkalisation / ahead of SAC)
//                    sba1    strong base anion Type I
//                    sba2    strong base anion Type II
//                    wba     weak base anion (ahead of SBA)
//                    mb      mixed bed (SAC + SBA Type I in one vessel)
//                    sac_na  softener (SAC, Na⁺ form, brine regenerated)
//     params.mode    rating  resin volume given → run length, leakage, chemicals
//                    design  run length (or throughput / regenerations per day)
//                            and outlet targets given → resin volume, vessel,
//                            regeneration level that meets the target
//   degasser       1 inlet → [degassed water, vent CO₂]  (forced-draft or vacuum)
//
// WATER ANALYSIS ON THE STREAM. The ionic make-up travels with the stream as
// `water` (meq/L of the strong ions, total inorganic carbon, silica, minor
// quality items and the treatment train it has passed). A unit whose inlet
// carries no `water` uses the analysis entered on the unit (params.analysis).
// mb-flowsheet copies `water` through units that do not change the water's
// chemistry (pumps, valves, heaters, splitters, mixers — mixWater()).
//
// MODELS (preliminary design — confirm with the resin maker's software,
// DuPont WAVE / Purolite PRSM / Lanxess LewaPlus, before purchase):
//   · water chemistry: electroneutral strong-ion state + carbonate system
//     (Harned–Davis / Harned–Scholes K1, K2, Kw(T)); pH by charge balance;
//     conductivity at 25 °C from limiting equivalent conductances with an
//     ionic-strength correction
//   · operating capacity: OC = U·Qt·(1 − exp(−k·E/(U·Qt))), E = regenerant
//     eq/L, calibrated to the published capacity-vs-regeneration-level curves
//     of gel resins (co-flow and counter-flow); or the value you give
//   · leakage: SAC sodium leakage vs regeneration level and Na fraction
//     (co-flow chart trend, counter-flow ≈ 1/15); SBA silica leakage vs caustic
//     level, silica fraction, caustic temperature and resin type; softener
//     hardness leakage vs brine level and TDS; mixed bed polishing quality
//   · hydraulics: service velocity, specific flow (BV/h), bed depth, Ergun
//     pressure drop for 0.55 mm beads with water viscosity at the feed
//     temperature
//   · regeneration: chemical per regeneration and per day (100 % and
//     commercial grade), dilute volume, backwash / injection / rinse water,
//     regeneration time, excess chemical to neutralisation
//   · advisor: the additional equipment the water needs (degasser, WAC / WBA
//     ahead, mixed-bed polisher, counter-current regeneration, carbon filter,
//     filters, RO ahead, neutralisation pit, regeneration systems, tanks …),
//     with the saving or the reason
//
// Plain ES module. Registered by mb-engine.js through register(toolbox), so it
// imports nothing from the engine (no circular import). (c) multicalci.com
// ============================================================================

'use strict';

export const IONX_VERSION = 'mb-ionx 1.0.0';

let TB = null;

const num = (x) => typeof x === 'number' && isFinite(x);
const pos = (x) => num(x) && x > 0;
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const sum = (o) => Object.values(o).reduce((a, b) => a + (num(b) ? b : 0), 0);
class IxError extends Error { constructor(code, message, field) { super(message); this.code = code; this.field = field; } }
const fail = (code, message, field) => { throw new IxError(code, message, field || 'params'); };

/** short engineering number for messages */
function fm(x) {
  if (!num(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1000) return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (a === 0) return '0';
  return String(Number(x.toPrecision(3)));
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
const EQ_CACO3 = 50.04;                    // g CaCO3 per equivalent
const EW = { Ca: 20.039, Mg: 12.153, Na: 22.990, K: 39.098, NH4: 18.038, Cl: 35.453, SO4: 48.031, NO3: 62.005, HCO3: 61.017, CO3: 30.005, OH: 17.007, H: 1.008 };
const MW_CO2 = 44.01, MW_SIO2 = 60.08;
const CATS = ['Ca', 'Mg', 'Na', 'K', 'NH4'];
const ANS = ['Cl', 'SO4', 'NO3'];
const DIVALENT = new Set(['Ca', 'Mg', 'SO4', 'CO3']);
// limiting equivalent conductances at 25 °C, S·cm²/eq (CRC Handbook)
const LAMBDA = { Ca: 59.5, Mg: 53.0, Na: 50.1, K: 73.5, NH4: 73.5, H: 349.8, Cl: 76.3, SO4: 80.0, NO3: 71.4, HCO3: 44.5, CO3: 69.3, OH: 198.0 };
const P_ATM = 1.01325;
const INTERNALS_DP_BAR = 0.2;               // nozzle plate / laterals / distributors

/* regenerants: equivalent weight, usual commercial strength and dilute strength,
   injection rate; density of the solution vs w/w % at 20 °C (CRC Handbook) */
const CHEM = {
  HCl: { EW: 36.461, label: 'HCl', comm: 33, dil: 5, inj_bvh: 5,
    rho: [[0, 0.9982], [1, 1.0032], [2, 1.0082], [4, 1.0181], [6, 1.0279], [8, 1.0376], [10, 1.0474], [12, 1.0574], [14, 1.0675], [16, 1.0776], [18, 1.0878], [20, 1.0980], [24, 1.1187], [28, 1.1392], [30, 1.1492], [32, 1.1593], [34, 1.1691], [36, 1.1789], [38, 1.1885]] },
  H2SO4: { EW: 49.04, label: 'H₂SO₄', comm: 98, dil: 2, inj_bvh: 8,
    rho: [[0, 0.9982], [1, 1.0051], [2, 1.0118], [3, 1.0184], [4, 1.0250], [5, 1.0317], [6, 1.0385], [8, 1.0522], [10, 1.0661], [15, 1.1020], [20, 1.1394], [30, 1.2185], [40, 1.3028], [50, 1.3951], [60, 1.4983], [70, 1.6105], [80, 1.7272], [90, 1.8144], [96, 1.8355], [98, 1.8361]] },
  NaOH: { EW: 39.997, label: 'NaOH', comm: 48, dil: 4, inj_bvh: 3,
    rho: [[0, 0.9982], [1, 1.0095], [2, 1.0207], [4, 1.0428], [6, 1.0648], [8, 1.0869], [10, 1.1089], [12, 1.1309], [14, 1.1530], [16, 1.1751], [20, 1.2191], [24, 1.2629], [28, 1.3064], [32, 1.3490], [36, 1.3900], [40, 1.4300], [44, 1.4685], [48, 1.5065], [50, 1.5253]] },
  NaCl: { EW: 58.443, label: 'NaCl', comm: 100, dil: 10, inj_bvh: 3, solid: true,
    rho: [[0, 0.9982], [1, 1.0053], [2, 1.0125], [4, 1.0268], [6, 1.0413], [8, 1.0559], [10, 1.0707], [12, 1.0857], [14, 1.1009], [16, 1.1162], [18, 1.1319], [20, 1.1478], [22, 1.1640], [24, 1.1804], [26, 1.1972]] },
};
function chemRho(chem, pct) {
  const t = CHEM[chem].rho;
  if (pct <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (pct <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + (y1 - y0) * (pct - x0) / (x1 - x0); }
  return t[t.length - 1][1];
}

/* resins. Qt total capacity eq/L; U usable fraction; k regeneration efficiency
   factor of the capacity curve per regenerant and flow scheme; R default and
   range of regeneration levels (g of 100 % chemical per L of resin) */
const RESIN = {
  sac_h: { label: 'Strong acid cation (H⁺ form)', short: 'SAC', side: 'cat', Qt: 2.0, U: 0.75, chems: ['HCl', 'H2SO4'],
    k: { HCl: { co: 0.752, counter: 1.45 }, H2SO4: { co: 0.55, counter: 1.05 } },
    R: { HCl: { co: 80, counter: 50 }, H2SO4: { co: 100, counter: 70 } }, Rr: { HCl: [30, 250], H2SO4: [40, 300] },
    bw: 12, rinse: 4, vmax: { co: 25, counter: 40 }, bvh: 40, hmin: 0.8, hmax: { co: 2.5, counter: 3.0 }, fb: { co: 0.75, counter: 0.1 }, Tmax: 120 },
  wac: { label: 'Weak acid cation', short: 'WAC', side: 'cat', Qt: 4.2, U: 0.6, chems: ['HCl', 'H2SO4'], ratio: 110,
    bw: 10, rinse: 3, vmax: { co: 25, counter: 40 }, bvh: 40, hmin: 0.8, hmax: { co: 2.5, counter: 3.0 }, fb: { co: 1.0, counter: 0.15 }, Tmax: 120 },
  sba1: { label: 'Strong base anion Type I', short: 'SBA I', side: 'an', Qt: 1.3, U: 0.65, chems: ['NaOH'],
    k: { NaOH: { co: 0.593, counter: 1.3 } }, R: { NaOH: { co: 80, counter: 50 } }, Rr: { NaOH: [30, 200] }, siBase: 0.012,
    bw: 6, rinse: 8, vmax: { co: 25, counter: 40 }, bvh: 40, hmin: 0.8, hmax: { co: 2.5, counter: 3.0 }, fb: { co: 1.0, counter: 0.1 }, Tmax: 60 },
  sba2: { label: 'Strong base anion Type II', short: 'SBA II', side: 'an', Qt: 1.35, U: 0.75, chems: ['NaOH'],
    k: { NaOH: { co: 0.85, counter: 1.5 } }, R: { NaOH: { co: 64, counter: 45 } }, Rr: { NaOH: [30, 200] }, siBase: 0.04,
    bw: 6, rinse: 6, vmax: { co: 25, counter: 40 }, bvh: 40, hmin: 0.8, hmax: { co: 2.5, counter: 3.0 }, fb: { co: 1.0, counter: 0.1 }, Tmax: 35 },
  wba: { label: 'Weak base anion', short: 'WBA', side: 'an', Qt: 1.6, U: 0.75, chems: ['NaOH'], ratio: 130,
    bw: 6, rinse: 5, vmax: { co: 25, counter: 40 }, bvh: 40, hmin: 0.8, hmax: { co: 2.5, counter: 3.0 }, fb: { co: 1.0, counter: 0.15 }, Tmax: 60 },
  mb: { label: 'Mixed bed (SAC + SBA Type I)', short: 'MB', side: 'mb', chems: ['HCl', 'H2SO4'],
    cat: { Qt: 2.0, U: 0.6, k: { HCl: 0.6, H2SO4: 0.45 } }, an: { Qt: 1.3, U: 0.5, k: 0.35 },
    R: { HCl: 90, H2SO4: 120, NaOH: 90 }, bw: 8, rinse: 10, vmax: { co: 50, counter: 50 }, bvh: 50, hmin: 1.0, hmax: { co: 1.8, counter: 1.8 }, fb: { co: 1.0, counter: 1.0 }, Tmax: 60 },
  sac_na: { label: 'Softener (SAC, Na⁺ form)', short: 'SOFT', side: 'cat', Qt: 2.0, U: 0.75, chems: ['NaCl'],
    k: { NaCl: { co: 0.867, counter: 1.3 } }, R: { NaCl: { co: 120, counter: 80 } }, Rr: { NaCl: [50, 300] },
    bw: 12, rinse: 4, vmax: { co: 25, counter: 40 }, bvh: 40, hmin: 0.8, hmax: { co: 2.5, counter: 3.0 }, fb: { co: 0.75, counter: 0.1 }, Tmax: 120 },
};

// ---------------------------------------------------------------------------
// water properties
// ---------------------------------------------------------------------------
/** liquid water density, kg/m³ (Kell 1975, 0–150 °C) */
function waterRho(TK) {
  const t = Math.min(150, Math.max(0, TK - 273.15));
  return (999.83952 + 16.945176 * t - 7.9870401e-3 * t * t - 46.170461e-6 * t ** 3 + 105.56302e-9 * t ** 4 - 280.54253e-12 * t ** 5) / (1 + 16.879850e-3 * t);
}
/** liquid water viscosity, Pa·s (Vogel) */
const waterMu = (TK) => 1e-3 * Math.exp(-3.7188 + 578.919 / (TK - 137.546));

/** carbonate-system and water constants (Harned–Davis, Harned–Scholes; Kw Harned–Owen), T in K */
function kCarb(TK) {
  const pK1 = 3404.71 / TK + 0.032786 * TK - 14.8435;
  const pK2 = 2902.39 / TK + 0.02379 * TK - 6.4980;
  const pKw = 4470.99 / TK - 6.0875 + 0.01706 * TK;
  return { K1: 10 ** -pK1, K2: 10 ** -pK2, Kw: 10 ** -pKw };
}
function alphas(h, K) {
  const D = h * h + K.K1 * h + K.K1 * K.K2;
  return { a0: h * h / D, a1: K.K1 * h / D, a2: K.K1 * K.K2 / D };
}
/** pH from the charge balance of the strong ions (meq/L) and total carbonate CT (mmol/L) */
function speciate(W, TK) {
  const K = kCarb(TK);
  const anc = (sum(W.cat) - sum(W.an)) / 1000;    // eq/L
  const CT = Math.max(0, W.CT) / 1000;             // mol/L
  const f = (pH) => { const h = 10 ** -pH; const a = alphas(h, K); return anc - (CT * (a.a1 + 2 * a.a2) + K.Kw / h - h); };
  let lo = -1, hi = 15;
  for (let i = 0; i < 80; i++) { const m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
  const pH = 0.5 * (lo + hi), h = 10 ** -pH, a = alphas(h, K);
  return { pH, H: h * 1000, OH: K.Kw / h * 1000, HCO3: CT * a.a1 * 1000, CO3: 2 * CT * a.a2 * 1000, CO2: CT * a.a0 * 1000 };
}
/** conductivity at 25 °C, µS/cm */
function conductivity(W) {
  const s = speciate(W, 298.15);
  const c = Object.assign({}, W.cat, W.an, { H: s.H, OH: s.OH, HCO3: s.HCO3, CO3: s.CO3 });
  let k0 = 0, I = 0;
  for (const [ion, meq] of Object.entries(c)) {
    if (!(meq > 0)) continue;
    k0 += LAMBDA[ion] * meq;
    I += 0.5 * meq / 1000 * (DIVALENT.has(ion) ? 2 : 1);
  }
  return k0 * Math.max(0.6, 1 - 0.6 * Math.sqrt(I));
}

/** the numbers people read off a water analysis */
export function waterSummary(W, TK) {
  const T = num(TK) ? TK : 298.15;
  const s = speciate(W, T);
  const sc = sum(W.cat), sa = sum(W.an);
  const tds = CATS.reduce((a, k) => a + W.cat[k] * EW[k], 0) + ANS.reduce((a, k) => a + W.an[k] * EW[k], 0) +
    s.HCO3 * EW.HCO3 + s.CO3 * EW.CO3 + (W.SiO2 || 0);
  const r = (x, d) => (num(x) ? +x.toFixed(d) : null);
  return {
    pH: r(s.pH, 2), cond_uScm: r(conductivity(W), 4), TDS_mgL: r(tds, 2),
    TC_mgL_CaCO3: r(sc * EQ_CACO3, 3), TH_mgL_CaCO3: r((W.cat.Ca + W.cat.Mg) * EQ_CACO3, 3),
    Ca_mgL: r(W.cat.Ca * EW.Ca, 3), Mg_mgL: r(W.cat.Mg * EW.Mg, 3), Na_mgL: r(W.cat.Na * EW.Na, 4), K_mgL: r(W.cat.K * EW.K, 3),
    alk_M_mgL_CaCO3: r(Math.max(0, s.HCO3 + s.CO3 + s.OH - s.H) * EQ_CACO3, 3),
    FMA_mgL_CaCO3: r(Math.max(0, sa - sc) * EQ_CACO3, 3), EMA_mgL_CaCO3: r(sa * EQ_CACO3, 3),
    Cl_mgL: r(W.an.Cl * EW.Cl, 3), SO4_mgL: r(W.an.SO4 * EW.SO4, 3), NO3_mgL: r(W.an.NO3 * EW.NO3, 3),
    SiO2_mgL: r(W.SiO2 || 0, 4), CO2_free_mgL: r(s.CO2 * MW_CO2, 3), CO2_total_mgL: r(W.CT * MW_CO2, 3),
    TA_mgL_CaCO3: r((sa + W.CT + (W.SiO2 || 0) / MW_SIO2) * EQ_CACO3, 3),
    TOC_mgL: W.TOC || 0, Fe_mgL: W.Fe || 0, Cl2_mgL: W.Cl2 || 0, turbidity_NTU: W.turb || 0,
  };
}

/** a deep copy of a water state (train shared by value) */
function cloneW(W) {
  return { v: 1, cat: Object.assign({}, W.cat), an: Object.assign({}, W.an), CT: W.CT, SiO2: W.SiO2 || 0,
    TOC: W.TOC || 0, Fe: W.Fe || 0, Cl2: W.Cl2 || 0, turb: W.turb || 0, train: (W.train || []).map((t) => Object.assign({}, t)) };
}
/** validate a `water` object that arrived on a stream; null when unusable */
function fromStream(w) {
  if (!isObj(w) || !isObj(w.cat) || !isObj(w.an) || !num(w.CT)) return null;
  const W = { v: 1, cat: {}, an: {}, CT: Math.max(0, w.CT), SiO2: num(w.SiO2) ? Math.max(0, w.SiO2) : 0,
    TOC: num(w.TOC) ? w.TOC : 0, Fe: num(w.Fe) ? w.Fe : 0, Cl2: num(w.Cl2) ? w.Cl2 : 0, turb: num(w.turb) ? w.turb : 0,
    train: Array.isArray(w.train) ? w.train.filter(isObj).slice(-12).map((t) => Object.assign({}, t)) : [] };
  for (const k of CATS) W.cat[k] = num(w.cat[k]) ? Math.max(0, w.cat[k]) : 0;
  for (const k of ANS) W.an[k] = num(w.an[k]) ? Math.max(0, w.an[k]) : 0;
  return W;
}
/** the stream-borne form: state + summary (summary is for display only) */
function toStream(W, TK) {
  const o = cloneW(W);
  o.summary = waterSummary(W, TK);
  return o;
}

/**
 * Mix the water analyses of several inlets (mass-flow weighted). Used by the
 * flowsheet solver for mixers; null unless every inlet with flow has one.
 * @param {Array<{water:object, mass_flow_kg_h:number, T_K:number}>} ins
 */
export function mixWater(ins, TK) {
  const live = (ins || []).filter((s) => s && s.mass_flow_kg_h > 0);
  if (!live.length) return null;
  const Ws = live.map((s) => fromStream(s.water));
  if (Ws.some((w) => !w)) return null;
  const m = live.map((s) => s.mass_flow_kg_h), tot = m.reduce((a, b) => a + b, 0);
  const W = { v: 1, cat: {}, an: {}, CT: 0, SiO2: 0, TOC: 0, Fe: 0, Cl2: 0, turb: 0, train: [] };
  for (const k of CATS) W.cat[k] = Ws.reduce((a, w, i) => a + w.cat[k] * m[i], 0) / tot;
  for (const k of ANS) W.an[k] = Ws.reduce((a, w, i) => a + w.an[k] * m[i], 0) / tot;
  for (const k of ['CT', 'SiO2', 'TOC', 'Fe', 'Cl2', 'turb']) W[k] = Ws.reduce((a, w, i) => a + w[k] * m[i], 0) / tot;
  W.train = Ws[m.indexOf(Math.max(...m))].train;
  return toStream(W, TK);
}

// ---------------------------------------------------------------------------
// the analysis entered on a unit → water state
// ---------------------------------------------------------------------------
function analysisToWater(a, TK, warnings) {
  if (!isObj(a)) fail('MB_IX_ANALYSIS', 'no water analysis — enter the inlet water analysis on this unit (cations, anions, alkalinity) or feed it from an upstream water-treatment unit', 'analysis');
  const basis = a.basis === 'ion' ? 'ion' : 'caco3';
  for (const k of [...CATS, ...ANS, 'HCO3', 'CO3', 'SiO2', 'CO2', 'TOC', 'Fe', 'Cl2', 'turb']) {
    if (a[k] !== undefined && a[k] !== null && !(num(a[k]) && a[k] >= 0)) fail('MB_IX_ANALYSIS', `water analysis: ${k} must be a number ≥ 0`, 'analysis.' + k);
  }
  if (a.pH !== undefined && a.pH !== null && !(num(a.pH) && a.pH > 0 && a.pH < 14)) fail('MB_IX_ANALYSIS', 'water analysis: pH must be between 0 and 14', 'analysis.pH');
  const meq = (k, v) => (!num(v) || v <= 0 ? 0 : basis === 'ion' ? v / EW[k] : v / EQ_CACO3);
  const cat = {}, an = {};
  for (const k of CATS) cat[k] = meq(k, a[k]);
  for (const k of ANS) an[k] = meq(k, a[k]);
  const hco3 = meq('HCO3', a.HCO3), co3 = meq('CO3', a.CO3);
  const sc = sum(cat), sa = sum(an) + hco3 + co3;
  if (sc + sa <= 0) fail('MB_IX_ANALYSIS', 'the water analysis is empty — enter the cations (Ca, Mg, Na …) and anions (HCO₃, Cl, SO₄ …)', 'analysis');
  const imbalance = sc + sa > 0 ? 200 * (sc - sa) / (sc + sa) : 0;
  const bal = a.balance === 'Cl' ? 'Cl' : 'Na';
  let adj = null;
  if (Math.abs(sc - sa) > 1e-9) {
    if (bal === 'Na' && sa - sc > -cat.Na) { adj = { ion: 'Na', meq: sa - sc }; cat.Na += sa - sc; }
    else if (bal === 'Cl' && sc - sa > -an.Cl) { adj = { ion: 'Cl', meq: sc - sa }; an.Cl += sc - sa; }
    else if (sa > sc) { adj = { ion: 'Na', meq: sa - sc }; cat.Na += sa - sc; }
    else { adj = { ion: 'Cl', meq: sc - sa }; an.Cl += sc - sa; }
  }
  if (Math.abs(imbalance) > 5) warnings.push(`water analysis: cations and anions differ by ${imbalance.toFixed(1)} % — balanced with ${adj ? adj.ion : 'Na'} (${adj && adj.meq > 0 ? '+' : ''}${fm(adj ? adj.meq * EQ_CACO3 : 0)} mg/L as CaCO₃); check the analysis`);
  // carbonate system
  const K = kCarb(TK);
  let CT;
  const alk = hco3 + co3;
  if (num(a.CO2) && a.CO2 >= 0) {
    CT = a.CO2 / MW_CO2 + hco3 + co3 / 2;
  } else {
    const pH = num(a.pH) ? a.pH : 7.5;
    if (!num(a.pH)) warnings.push('water analysis: neither pH nor free CO₂ given — pH 7.5 assumed to fix the free CO₂');
    const h = 10 ** -pH, al = alphas(h, K);
    const carbAlk = alk - K.Kw / h * 1000 + h * 1000;
    CT = carbAlk > 0 ? carbAlk / (al.a1 + 2 * al.a2) : 0;
  }
  const W = { v: 1, cat, an, CT, SiO2: num(a.SiO2) ? a.SiO2 : 0, TOC: num(a.TOC) ? a.TOC : 0, Fe: num(a.Fe) ? a.Fe : 0,
    Cl2: num(a.Cl2) ? a.Cl2 : 0, turb: num(a.turb) ? a.turb : 0, train: [] };
  if (num(a.CO2) && num(a.pH)) {
    const pc = speciate(W, TK).pH;
    if (Math.abs(pc - a.pH) > 0.3) warnings.push(`water analysis: the free CO₂ and alkalinity given correspond to pH ${pc.toFixed(2)}, not the ${a.pH} entered — the free CO₂ is used`);
  }
  return { W, imbalance_pct: imbalance, balanced_with: adj ? adj.ion : null, balance_adj_mgL_CaCO3: adj ? adj.meq * EQ_CACO3 : 0 };
}

// ---------------------------------------------------------------------------
// capacity and leakage models
// ---------------------------------------------------------------------------
/** operating capacity, eq/L, from regenerant eq/L */
function opCap(Qt, U, k, E) { const cap = U * Qt; return cap * (1 - Math.exp(-k * E / cap)); }

/** SAC (H) average sodium leakage, fraction of the total cations */
function sacLeakFrac(R, chem, mode, mono) {
  const Rh = chem === 'H2SO4' ? R / CHEM.H2SO4.EW * CHEM.HCl.EW : R;   // HCl-equivalent level
  let A = 41.7 * Math.exp(-Rh / 62.6);                                // % of TC for an all-sodium water, co-flow HCl
  if (chem === 'H2SO4') A *= 1.6;
  if (mode === 'counter') A /= 15;
  return { mono: Math.min(mono, A / 100 * Math.pow(Math.max(0, mono), 1.6)), hard: A / 100 * 0.005 };
}
/** SBA silica leakage, fraction of the inlet silica */
function sbaSilicaFrac(rz, R, mode, warm, siFrac, TK) {
  let l = rz.siBase * Math.exp(-(R - 80) / 60) * (1 + 2 * siFrac) / 1.4;
  if (mode === 'counter') l *= 0.2;
  if (warm) l *= 0.5;
  const t = TK - 273.15;
  if (t > 35) l *= 1 + 0.03 * (t - 35);
  return Math.min(1, l);
}
const sbaClFrac = (R, mode) => Math.min(1, 0.004 * Math.exp(-(R - 80) / 80) * (mode === 'counter' ? 0.2 : 1));
const sbaCO2Frac = (R, mode) => Math.min(1, 0.002 * Math.exp(-(R - 80) / 80) * (mode === 'counter' ? 0.2 : 1));
/** softener hardness leakage, fraction of the inlet hardness */
const softLeakFrac = (R, mode, TCmeq) => Math.min(1, 0.006 * Math.exp(-(R - 100) / 120) * (0.5 + TCmeq / 12) * (mode === 'counter' ? 0.15 : 1));

// ---------------------------------------------------------------------------
// one exchange step on the water: returns {Wout, load (meq/L), parts}
// ---------------------------------------------------------------------------
function exchange(resin, W, o) {
  const Wo = cloneW(W);
  const TC = sum(W.cat), TH = W.cat.Ca + W.cat.Mg, MONO = W.cat.Na + W.cat.K + W.cat.NH4;
  const FMAin = sum(W.an), ANC = TC - FMAin;
  const siMeq = (W.SiO2 || 0) / MW_SIO2;
  const parts = {};
  if (resin === 'sac_h') {
    const lf = sacLeakFrac(o.R, o.chem, o.mode, TC > 0 ? MONO / TC : 0);
    const leakMono = lf.mono * TC, leakHard = Math.min(TH, lf.hard * TH);
    for (const k of ['Na', 'K', 'NH4']) Wo.cat[k] = MONO > 0 ? W.cat[k] / MONO * Math.min(MONO, leakMono) : 0;
    for (const k of ['Ca', 'Mg']) Wo.cat[k] = TH > 0 ? W.cat[k] / TH * leakHard : 0;
    parts.cations = TC; parts.hardness = TH; parts.sodium = MONO;
    return { Wo, load: TC, parts, leak: { mono_meq: Math.min(MONO, leakMono), hard_meq: leakHard } };
  }
  if (resin === 'sac_na') {
    const lf = softLeakFrac(o.R, o.mode, TC);
    const leak = lf * TH;
    for (const k of ['Ca', 'Mg']) Wo.cat[k] = TH > 0 ? W.cat[k] / TH * leak : 0;
    Wo.cat.Na = W.cat.Na + (TH - leak);
    parts.hardness = TH;
    return { Wo, load: TH, parts, leak: { hard_meq: leak } };
  }
  if (resin === 'wac') {
    const alk = Math.max(0, ANC);
    const rh = 0.95 * Math.min(TH, alk);
    const rm = 0.25 * Math.min(MONO, Math.max(0, alk - Math.min(TH, alk)));
    for (const k of ['Ca', 'Mg']) Wo.cat[k] = TH > 0 ? W.cat[k] * (1 - rh / TH) : 0;
    for (const k of ['Na', 'K', 'NH4']) Wo.cat[k] = MONO > 0 ? W.cat[k] * (1 - rm / MONO) : 0;
    parts.alkalinity_hardness = rh; parts.sodium_alkalinity = rm;
    return { Wo, load: rh + rm, parts, leak: { hard_meq: TH - rh } };
  }
  if (resin === 'sba1' || resin === 'sba2') {
    const rz = RESIN[resin];
    const load = FMAin + W.CT + siMeq;
    const siFrac = load > 0 ? siMeq / load : 0;
    const lSi = sbaSilicaFrac(rz, o.R, o.mode, o.warm, siFrac, o.TK);
    const lCl = sbaClFrac(o.R, o.mode), lC = sbaCO2Frac(o.R, o.mode);
    Wo.an = { Cl: FMAin * lCl, SO4: 0, NO3: 0 };
    Wo.CT = W.CT * lC;
    Wo.SiO2 = (W.SiO2 || 0) * lSi;
    parts.mineral_acids = FMAin; parts.CO2 = W.CT; parts.silica = siMeq;
    return { Wo, load, parts, leak: { si_frac: lSi, cl_meq: FMAin * lCl } };
  }
  if (resin === 'wba') {
    const acid = Math.max(0, -ANC);
    const take = Math.min(FMAin, acid);
    const removed = take * 0.99;
    for (const k of ANS) Wo.an[k] = FMAin > 0 ? W.an[k] * (1 - removed / FMAin) : 0;
    parts.mineral_acids = take;
    return { Wo, load: take, parts, leak: { fma_meq: take - removed } };
  }
  if (resin === 'mb') {
    const loadA = FMAin + W.CT + siMeq;
    const leakC = Math.min(TC, 0.002 * TC + 0.0001);
    for (const k of CATS) Wo.cat[k] = 0;
    Wo.cat.Na = leakC;
    Wo.an = { Cl: Math.min(FMAin, 0.002 * FMAin + 0.0001), SO4: 0, NO3: 0 };
    Wo.CT = W.CT * 0.002;
    Wo.SiO2 = Math.min(W.SiO2 || 0, (W.SiO2 || 0) * 0.01 * (o.warm ? 0.6 : 1) + 0.003);
    parts.cations = TC; parts.anions = loadA;
    return { Wo, load: TC, loadA, parts, leak: {} };
  }
  fail('MB_IX_RESIN', `unknown resin '${resin}'`, 'resin');
  return null;
}

// ---------------------------------------------------------------------------
// vessel hydraulics
// ---------------------------------------------------------------------------
function bedDP(v_mh, h, TK) {
  const eps = 0.38, d = 0.55e-3, mu = waterMu(TK), rho = waterRho(TK), u = v_mh / 3600;
  const dpL = 150 * mu * (1 - eps) ** 2 * u / (eps ** 3 * d * d) + 1.75 * rho * (1 - eps) * u * u / (eps ** 3 * d);
  return dpL * h / 1e5;
}
/**
 * choose the vessel for a resin volume: area from the velocity limit, kept within the bed-depth range.
 * design: the volume may grow to reach the minimum depth; rating: the volume is fixed.
 */
function chooseVessel(V, Qv, o) {
  let A, Vout = V, grew = false;
  if (pos(o.D)) A = Math.PI * o.D * o.D / 4;
  else {
    A = Qv / o.vmax;
    const h = Vout / A;
    if (h > o.hmax) A = Vout / o.hmax;
    else if (h < o.hmin && !o.design) A = Vout / o.hmin;
    let D = Math.sqrt(4 * A / Math.PI);
    D = o.design ? Math.ceil(D / 0.05 - 1e-9) * 0.05 : Math.max(0.05, Math.round(D / 0.05) * 0.05);
    A = Math.PI * D * D / 4;
  }
  if (o.design && Vout / A < o.hmin) { Vout = A * o.hmin; grew = true; }
  const D = Math.sqrt(4 * A / Math.PI);
  return { D, A, h: Vout / A, v: Qv / A, BVh: Qv / Vout, V: Vout, grew };
}

// ---------------------------------------------------------------------------
// regeneration of one vessel
// ---------------------------------------------------------------------------
function regenChem(chem, kg100, concPct, commPct) {
  const C = CHEM[chem];
  const conc = pos(concPct) ? concPct : C.dil;
  const comm = pos(commPct) ? commPct : C.comm;
  if (conc >= comm) fail('MB_IX_REGEN', `${C.label}: the dilute strength ${conc} % must be below the commercial strength ${comm} %`, 'conc_pct');
  const solKg = kg100 / (conc / 100);
  const Vsol = solKg / chemRho(chem, conc) / 1000;                 // m³ dilute
  const commKg = kg100 / (comm / 100);
  const commL = C.solid ? null : commKg / chemRho(chem, comm);
  return { chem, label: C.label, conc_pct: conc, comm_pct: comm, kg_100: kg100, kg_comm: commKg, L_comm: commL,
    dilute_m3: Vsol, dilution_water_m3: (solKg - commKg) / 1000, inj_bvh: C.inj_bvh };
}

// ---------------------------------------------------------------------------
// the ion-exchange unit
// ---------------------------------------------------------------------------
const MODE_LABEL = { co: 'co-flow', counter: 'counter-flow (packed bed)' };

function solveIX(input) {
  const mi = TB.moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const feed = mi.streams[0], p = mi.params;
  const warnings = [], notes = [];
  const resin = p.resin;
  const rz = RESIN[resin];
  if (!rz) fail('MB_IX_RESIN', 'params.resin must be one of sac_h, wac, sba1, sba2, wba, mb, sac_na', 'resin');
  const label = `${rz.short}${p.tag ? ' ' + p.tag : ''}`;
  const TK = feed.T_K;
  const tC = TK - 273.15;
  if (!(feed.mass_flow_kg_h > 0)) fail('MB_IX_FLOW', 'the feed has no flow', 'streams');
  if (tC < 1 || tC > 99) fail('MB_IX_T', `feed temperature ${tC.toFixed(1)} °C — ion exchange needs liquid water (1–99 °C)`, 'streams');
  if (rz.Tmax && tC > rz.Tmax) warnings.push(`feed ${tC.toFixed(0)} °C is above the ${rz.short} resin limit of ${rz.Tmax} °C — capacity loss and resin degradation`);
  const rho = waterRho(TK);
  const Q = feed.mass_flow_kg_h / rho;                               // m³/h
  const nS = pos(p.n_service) ? Math.round(p.n_service) : 1;
  const nSb = num(p.n_standby) && p.n_standby >= 0 ? Math.round(p.n_standby) : 1;
  if (nS < 1 || nS > 12) fail('MB_IX_VESSELS', 'vessels in service: 1–12', 'n_service');
  const Qv = Q / nS;

  // ---- inlet water ----
  let Win = null, src = 'upstream', ana = null;
  const fromUp = fromStream(feed.water);
  if (p.source !== 'entered' && fromUp) Win = fromUp;
  else {
    const hasEntry = isObj(p.analysis) && [...CATS, ...ANS, 'HCO3', 'CO3'].some((k) => pos(p.analysis[k]));
    if (!hasEntry && fromUp) Win = fromUp;
    else { ana = analysisToWater(p.analysis, TK, warnings); Win = ana.W; src = 'entered'; }
  }

  // ---- regeneration settings ----
  const isMB = resin === 'mb';
  const mode = isMB ? 'co' : p.regen_mode === 'counter' ? 'counter' : 'co';
  const chem = rz.chems.includes(p.chem) ? p.chem : rz.chems[0];
  const warm = p.warm === 'yes' || p.warm === true;
  const derate = num(p.derate_pct) ? Math.min(50, Math.max(0, p.derate_pct)) / 100 : 0.10;
  const design = p.mode !== 'rating';
  const vmax = pos(p.vmax_m_h) ? p.vmax_m_h : rz.vmax[mode];
  const bvhMax = pos(p.bvh_max) ? p.bvh_max : rz.bvh;
  const hmin = pos(p.hmin_m) ? p.hmin_m : rz.hmin;
  const hmax = Math.max(hmin * 1.2, rz.hmax[mode]);
  if (resin === 'sba2' && warm) warnings.push('Type II anion resin: regenerate with caustic at ≤ 35 °C — warm caustic is for Type I');

  // regeneration level: given, or the lowest that meets the outlet target, or the default
  const R0 = (ch) => (isMB ? rz.R[ch] : rz.R && rz.R[ch] ? rz.R[ch][mode] : null);
  let R = pos(p.regen_g_L) ? p.regen_g_L : null;
  let Rsource = R ? 'given' : 'default';
  const tgt = {
    na: pos(p.target_na_mgL) ? p.target_na_mgL : null, si: pos(p.target_sio2_mgL) ? p.target_sio2_mgL : null,
    cond: pos(p.target_cond_uScm) ? p.target_cond_uScm : null, th: pos(p.target_th_mgL) ? p.target_th_mgL : null,
  };
  const leakOf = (Rx) => exchange(resin, Win, { R: Rx, chem, mode, warm, TK }).Wo;
  const meets = (Wo) => {
    if (resin === 'sac_h' && tgt.na !== null) return Wo.cat.Na * EW.Na <= tgt.na;
    if ((resin === 'sba1' || resin === 'sba2') && tgt.si !== null) return Wo.SiO2 <= tgt.si;
    if (resin === 'sac_na' && tgt.th !== null) return (Wo.cat.Ca + Wo.cat.Mg) * EQ_CACO3 <= tgt.th;
    return true;
  };
  const searchable = rz.Rr && ((resin === 'sac_h' && tgt.na !== null) || ((resin === 'sba1' || resin === 'sba2') && tgt.si !== null) || (resin === 'sac_na' && tgt.th !== null));
  if (!R && rz.Rr) {
    if (searchable) {
      const [lo, hi] = rz.Rr[chem];
      let found = null;
      for (let x = lo; x <= hi + 1e-9; x += 5) if (meets(leakOf(x))) { found = x; break; }
      if (found !== null) { R = Math.max(found, lo); Rsource = 'target'; }
      else { R = hi; Rsource = 'target-not-met'; }
    } else R = R0(chem);
  } else if (!R && isMB) R = R0(chem);
  let Ra = null;                                                     // MB caustic level
  if (isMB) Ra = pos(p.regen_an_g_L) ? p.regen_an_g_L : rz.R.NaOH;
  if (R !== null && rz.Rr && (R < rz.Rr[chem][0] * 0.5 || R > rz.Rr[chem][1] * 1.5)) warnings.push(`regeneration level ${fm(R)} g/L is outside the usual ${rz.Rr[chem][0]}–${rz.Rr[chem][1]} g/L`);

  // ---- exchange ----
  const X = exchange(resin, Win, { R, chem, mode, warm, TK });
  const Wout = X.Wo;
  const load = X.load;                                               // meq/L (cation side for MB)
  const loadA = isMB ? X.loadA : null;

  // ---- operating capacity ----
  const C = CHEM[chem];
  let OC, OCa = null, E = null, Ea = null, ocBasis = 'model', ratio = null;
  if (resin === 'wac' || resin === 'wba') {
    ratio = pos(p.regen_ratio_pct) ? p.regen_ratio_pct : rz.ratio;
    if (ratio < 100) fail('MB_IX_REGEN', 'regeneration ratio must be ≥ 100 % of stoichiometric', 'regen_ratio_pct');
    let cap = rz.U * rz.Qt;
    if (resin === 'wac') {
      const TH = Win.cat.Ca + Win.cat.Mg, alk = Math.max(0, sum(Win.cat) - sum(Win.an));
      cap *= 0.7 + 0.3 * Math.min(1, alk > 0 ? TH / alk : 0);
    }
    OC = pos(p.opcap_eq_L) ? p.opcap_eq_L : cap;
    E = OC * (1 - derate) * ratio / 100;                             // regenerant for what one run loads
  } else if (isMB) {
    E = R / C.EW; Ea = Ra / CHEM.NaOH.EW;
    OC = pos(p.opcap_eq_L) ? p.opcap_eq_L : opCap(rz.cat.Qt, rz.cat.U, rz.cat.k[chem], E);
    OCa = pos(p.opcap_an_eq_L) ? p.opcap_an_eq_L : opCap(rz.an.Qt, rz.an.U, rz.an.k, Ea);
  } else {
    E = R / C.EW;
    OC = pos(p.opcap_eq_L) ? p.opcap_eq_L : opCap(rz.Qt, rz.U, rz.k[chem][mode], E);
  }
  if (pos(p.opcap_eq_L)) ocBasis = 'given';
  if (!(OC > 0)) fail('MB_IX_CAP', 'operating capacity must be > 0', 'opcap_eq_L');
  const OCd = OC * (1 - derate), OCad = OCa !== null ? OCa * (1 - derate) : null;

  // ---- run basis ----
  let runTarget = null;
  if (design) {
    const basis = p.basis || 'run_h';
    if (basis === 'throughput') { if (!pos(p.throughput_m3)) fail('MB_IX_RUN', 'give the throughput per vessel between regenerations (m³)', 'throughput_m3'); runTarget = p.throughput_m3 / Qv; }
    else if (basis === 'regens') { if (!pos(p.regens_day)) fail('MB_IX_RUN', 'give the regenerations per day per vessel', 'regens_day'); runTarget = 24 / p.regens_day; }
    else runTarget = pos(p.run_h) ? p.run_h : 16;
    if (runTarget > 2000) fail('MB_IX_RUN', 'run length above 2000 h — check the design basis', 'run_h');
  }

  // ---- resin volume and vessel ----
  let Vc = 0, Va = 0, ves, governs = null;
  const vopt = { D: p.diameter_m, vmax, hmin, hmax, design };
  if (!isMB) {
    let V;
    if (design) {
      const Vcap = load > 0 ? Qv * load * runTarget / (OCd * 1000) : 0;
      const Vbv = Qv / bvhMax;
      V = Math.max(Vcap, Vbv);
      governs = Vcap >= Vbv ? 'ionic load (run length)' : 'specific flow (≤ ' + fm(bvhMax) + ' BV/h)';
    } else {
      if (!pos(p.resin_m3)) fail('MB_IX_VOLUME', 'give the resin volume per vessel (m³) — or switch to “Calculate resin volume”', 'resin_m3');
      V = p.resin_m3;
    }
    ves = chooseVessel(V, Qv, vopt);
    if (ves.grew) governs = 'minimum bed depth (' + fm(hmin) + ' m)';
    Vc = ves.V;
  } else {
    if (design) {
      const Vcc = load > 0 ? Qv * load * runTarget / (OCd * 1000) : 0;
      const Vac = loadA > 0 ? Qv * loadA * runTarget / (OCad * 1000) : 0;
      const Vh = Qv / bvhMax;                                       // hydraulic minimum, split 1 : 1.5
      Vc = Math.max(Vcc, Vh / 2.5); Va = Math.max(Vac, Vh * 1.5 / 2.5);
      governs = Vcc >= Vh / 2.5 || Vac >= Vh * 1.5 / 2.5 ? 'ionic load (run length)' : 'specific flow (≤ ' + fm(bvhMax) + ' BV/h)';
      if (Va < Vc) Va = Vc;                                          // anion layer at least as deep as the cation
    } else {
      if (!pos(p.resin_cat_m3) || !pos(p.resin_an_m3)) fail('MB_IX_VOLUME', 'give the cation and anion resin volumes per vessel (m³)', 'resin_cat_m3');
      Vc = p.resin_cat_m3; Va = p.resin_an_m3;
    }
    ves = chooseVessel(Vc + Va, Qv, vopt);
    if (design && ves.V > Vc + Va + 1e-12) { const f = ves.V / (Vc + Va); Vc *= f; Va *= f; governs = 'minimum bed depth (' + fm(hmin) + ' m)'; }
    if (design) for (const [layer, vol] of [['cation', Vc], ['anion', Va]]) {
      if (vol / ves.A < 0.35) { const add = 0.35 * ves.A - vol; if (layer === 'cation') Vc += add; else Va += add; governs = 'minimum layer depth (0.35 m)'; }
    }
    ves = Object.assign({}, ves, { V: Vc + Va, h: (Vc + Va) / ves.A, BVh: Qv / (Vc + Va) });
  }
  const Vtot = ves.V;

  // ---- run length ----
  const runOf = (vol, oc, ld) => (ld > 0 ? vol * 1000 * oc / (Qv * ld) : Infinity);
  let run = runOf(isMB ? Vc : Vtot, OCd, load), runFresh = runOf(isMB ? Vc : Vtot, OC, load), exhausts = null;
  if (isMB) {
    const ra = runOf(Va, OCad, loadA), raf = runOf(Va, OCa, loadA);
    exhausts = ra < run ? 'anion' : 'cation';
    run = Math.min(run, ra); runFresh = Math.min(runFresh, raf);
  }
  if (!isFinite(run)) { run = 9999; runFresh = 9999; warnings.push(`no ionic load for the ${rz.short} resin in this water — it does nothing here`); }

  // ---- hydraulics ----
  const dpBed = bedDP(ves.v, ves.h, TK);
  const dp = dpBed + INTERNALS_DP_BAR;
  const fb = rz.fb[mode];
  const shell = ves.h * (1 + fb) + (mode === 'counter' && !isMB ? 0.25 : 0) + 0.3;
  if (ves.v > vmax * 1.001) warnings.push(`service velocity ${fm(ves.v)} m/h is above the ${fm(vmax)} m/h limit — the bed is too shallow / the vessel too narrow for this flow`);
  if (ves.BVh > bvhMax * 1.001) warnings.push(`specific flow ${fm(ves.BVh)} BV/h is above ${fm(bvhMax)} BV/h — too little resin for this flow (leakage rises); at least ${fm(Qv / bvhMax)} m³ per vessel`);
  if (ves.h < hmin * 0.999) warnings.push(`bed depth ${fm(ves.h)} m is below the ${fm(hmin)} m minimum — channelling and early leakage`);
  if (ves.BVh < 4 && run < 9999) notes.push(`specific flow only ${fm(ves.BVh)} BV/h — low flows favour channelling; fine for intermittent duty`);
  if (dpBed > 1.0) warnings.push(`clean-bed pressure drop ${fm(dpBed)} bar exceeds 1 bar — resin bead breakage risk; lower the velocity or the bed depth`);

  // ---- regeneration of one vessel ----
  const Vl = isMB ? Vc : Vtot;                                       // L of resin regenerated with the main chemical (m³ here)
  let kg100, kg100a = null;
  if (resin === 'wac' || resin === 'wba') kg100 = E * Vl * 1000 * C.EW / 1000;
  else kg100 = R * Vl;                                               // g/L × m³ = kg
  if (isMB) kg100a = Ra * Va;
  const rc = regenChem(chem, kg100, p.conc_pct, p.comm_pct);
  const rca = isMB ? regenChem('NaOH', kg100a, p.conc_an_pct, p.comm_an_pct) : null;
  const steps = [];
  const Vres = Vtot;
  // injection at the regenerant's usual BV/h, but never shorter than 30 min contact
  const injRate = (r) => Math.max(1e-9, Math.min(r.inj_bvh * (r === rca ? Va : Vl), r.dilute_m3 / 0.5));   // m³/h
  const bwRate = rz.bw;
  if (mode === 'co') steps.push({ step: isMB ? 'Backwash & separate' : 'Backwash', h: 0.25, m3: bwRate * ves.A * 0.25 });
  else steps.push({ step: 'Periodic backwash (≈ 1 in 15 cycles, averaged)', h: 0, m3: bwRate * ves.A * 0.25 / 15 });
  const inj = rc.dilute_m3 / injRate(rc), injA = rca ? rca.dilute_m3 / injRate(rca) : 0;
  steps.push({ step: `Inject ${rc.label} ${fm(rc.conc_pct)} %` + (rca ? ` + NaOH ${fm(rca.conc_pct)} %` : ''), h: Math.max(inj, injA), m3: rc.dilute_m3 + (rca ? rca.dilute_m3 : 0) });
  const slow = 2 * Vl / injRate(rc), slowA = rca ? 2 * Va / injRate(rca) : 0;
  steps.push({ step: 'Displacement (slow) rinse, 2 BV', h: Math.max(slow, slowA), m3: 2 * Vres });
  if (isMB) steps.push({ step: 'Drain down, air mix, refill', h: 0.5, m3: 0.5 * Vres });
  const fastBV = rz.rinse;
  steps.push({ step: `Fast rinse, ${fastBV} BV`, h: fastBV * Vres / Qv, m3: fastBV * Vres });
  const regenH = steps.reduce((a, s) => a + s.h, 0) + 0.15;
  const wastePerRegen = steps.reduce((a, s) => a + s.m3, 0);
  const regensDay = nS * 24 / run;                                   // plant regenerations per day
  const wasteDay = regensDay * wastePerRegen;
  const wasteM3h = wasteDay / 24;
  if (nSb === 0 && run < 9999) notes.push(`no standby vessel — the supply stops for ≈ ${fm(regenH)} h at every regeneration`);
  if (nSb > 0 && regenH > run) warnings.push(`regeneration (≈ ${fm(regenH)} h) takes longer than the run (${fm(run)} h) — one standby vessel cannot keep the supply continuous; add resin or vessels`);
  if (run < 8 && run < 9999) warnings.push(`run length ${fm(run)} h is short — more than ${fm(24 / run)} regenerations a day per vessel; add resin (design mode) or check the ionic load`);
  if (isMB && run > 168 && run < 9999) notes.push(`mixed-bed run ${fm(run / 24)} days — in polishing duty regenerate on a time or throughput basis (resin fouling, bacteria), typically every 1–4 weeks`);

  // excess regenerant to neutralisation (eq per regeneration)
  const exchangedEq = (isMB ? Vc : Vtot) * 1000 * OCd;
  const excessMain = Math.max(0, kg100 * 1000 / C.EW - exchangedEq);
  const excessAn = isMB ? Math.max(0, kg100a * 1000 / CHEM.NaOH.EW - Va * 1000 * OCad) : 0;
  const acidSide = chem === 'HCl' || chem === 'H2SO4';
  const excess = { acid_eq_regen: acidSide ? excessMain : 0, caustic_eq_regen: chem === 'NaOH' ? excessMain : excessAn };
  excess.acid_eq_day = excess.acid_eq_regen * regensDay; excess.caustic_eq_day = excess.caustic_eq_regen * regensDay;

  // ---- outlet pressure and streams ----
  let Pout = num(p.P_out_bar) ? p.P_out_bar : feed.P_bar - dp;
  if (!(Pout > 0)) Pout = P_ATM;
  if (!num(p.P_out_bar) && Pout < P_ATM) {
    warnings.push(`the feed at ${fm(feed.P_bar)} bar(a) cannot push ${fm(Q)} m³/h through the bed (≈ ${fm(dp)} bar drop) — outlet set to atmospheric; raise the feed pressure (pump)`);
    Pout = P_ATM;
  }
  const takeWaste = p.waste_from_feed !== 'no';
  const mWaste = takeWaste ? wasteM3h * rho : 0;
  if (mWaste >= feed.mass_flow_kg_h) fail('MB_IX_WASTE', `regeneration water (${fm(wasteM3h)} m³/h averaged) is more than the feed — the run is far too short; add resin or vessels`, 'run_h');
  if (takeWaste && mWaste > 0.1 * feed.mass_flow_kg_h) warnings.push(`regeneration and rinse water is ${fm(100 * mWaste / feed.mass_flow_kg_h)} % of the feed — high; check the run length`);
  const fr = feed.mass_flow_kg_h > 0 ? 1 - mWaste / feed.mass_flow_kg_h : 1;
  Wout.train = (Win.train || []).concat([{ type: resin, tag: p.tag || null, chem: rc.chem, R, acid_eq_day: excess.acid_eq_day, caustic_eq_day: excess.caustic_eq_day }]).slice(-12);
  const comps = feed.components.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction }));
  const treated = { mass_flow_kg_h: feed.mass_flow_kg_h * fr, T_K: TK, P_bar: Pout, components: comps, water: toStream(Wout, TK) };
  const waste = { mass_flow_kg_h: mWaste, T_K: TK, P_bar: P_ATM, components: comps.map((c) => Object.assign({}, c)) };

  // ---- quality, targets ----
  const sIn = waterSummary(Win, TK), sOut = treated.water.summary;
  const targets = [];
  if (tgt.na !== null && (resin === 'sac_h' || isMB)) targets.push({ name: 'Sodium leakage', unit: 'mg/L as Na', target: tgt.na, value: sOut.Na_mgL, met: sOut.Na_mgL <= tgt.na });
  if (tgt.si !== null && (resin === 'sba1' || resin === 'sba2' || isMB || resin === 'wba')) targets.push({ name: 'Silica', unit: 'mg/L SiO₂', target: tgt.si, value: sOut.SiO2_mgL, met: sOut.SiO2_mgL <= tgt.si });
  if (tgt.cond !== null) targets.push({ name: 'Conductivity (25 °C)', unit: 'µS/cm', target: tgt.cond, value: sOut.cond_uScm, met: sOut.cond_uScm <= tgt.cond });
  if (tgt.th !== null && (resin === 'sac_na' || resin === 'wac')) targets.push({ name: 'Residual hardness', unit: 'mg/L as CaCO₃', target: tgt.th, value: sOut.TH_mgL_CaCO3, met: sOut.TH_mgL_CaCO3 <= tgt.th });
  if (Rsource === 'target-not-met') warnings.push(`the outlet target is not met even at ${fm(R)} g/L ${C.label} — see the suggested equipment`);

  // ---- advisor ----
  const ctx = { resin, rz, Win, Wout, sIn, sOut, Q, TK, mode, chem, R, Ra, OCd, OCad, load, loadA, run, Vtot, Vc, Va, ves, warm, tgt, targets,
    rc, rca, regensDay, excess, wastePerRegen, nS, nSb, regenH, injH: inj, injHa: injA, storageDays: pos(p.storage_days) ? p.storage_days : 30, Rsource };
  const recommendations = adviseIX(ctx);

  // ---- energy and mass balance ----
  const eIn = TB.streamEnthalpy(feed);
  if (eIn.error) return eIn;
  const outs = [treated, waste];
  const es = [];
  for (const o of outs) {
    const e = TB.streamEnthalpy({ mass_flow_kg_h: o.mass_flow_kg_h, T_K: o.T_K, P_bar: o.P_bar, components: o.components });
    if (e.error) return e;
    o.H_kJh = e.H_kJh; es.push(e);
  }
  const Hout = outs.reduce((a, o) => a + o.H_kJh, 0), mOut = outs.reduce((a, o) => a + o.mass_flow_kg_h, 0);
  if (Win.TOC > 3 && (rz.side === 'an' || isMB)) notes.push('organic matter (TOC > 3 mg/L) fouls strong base resin — capacity and rinse quality fall over time');
  notes.push('Preliminary design: capacities, leakages and hydraulics are design-guide correlations for gel resins — confirm with the resin maker’s design software (DuPont WAVE, Purolite PRSM, Lanxess LewaPlus) before purchase.');

  const r3 = (x) => (num(x) ? +x.toPrecision(6) : x);
  const details = {
    unit: rz.label, resin, resin_short: rz.short, mode: design ? 'design' : 'rating', unit_version: IONX_VERSION,
    analysis_source: src,
    analysis_check: ana ? { imbalance_pct: r3(ana.imbalance_pct), balanced_with: ana.balanced_with, adjustment_mgL_CaCO3: r3(ana.balance_adj_mgL_CaCO3) } : null,
    flow: { Q_m3h: r3(Q), Q_per_vessel_m3h: r3(Qv), n_service: nS, n_standby: nSb, density_kg_m3: r3(rho), T_C: r3(tC) },
    feed_water: sIn, treated_water: sOut,
    load: isMB
      ? { cation_meqL: r3(load), anion_meqL: r3(loadA), cation_mgL_CaCO3: r3(load * EQ_CACO3), anion_mgL_CaCO3: r3(loadA * EQ_CACO3),
        cation_eq_h: r3(Q * load), anion_eq_h: r3(Q * loadA), parts_meqL: X.parts }
      : { ionic_load_meqL: r3(load), ionic_load_mgL_CaCO3: r3(load * EQ_CACO3), eq_per_h: r3(Q * load), kg_CaCO3_per_day: r3(Q * load * 24 * EQ_CACO3 / 1000), parts_meqL: X.parts },
    resin_volume: isMB
      ? { cation_m3: r3(Vc), anion_m3: r3(Va), total_m3: r3(Vtot), ratio_anion_cation: r3(Va / Vc), installed_m3: r3(Vtot * (nS + nSb)), governs }
      : { per_vessel_m3: r3(Vtot), installed_m3: r3(Vtot * (nS + nSb)), governs },
    capacity: isMB
      ? { cation_eq_L: r3(OC), anion_eq_L: r3(OCa), cation_design_eq_L: r3(OCd), anion_design_eq_L: r3(OCad), derate_pct: derate * 100, basis: ocBasis,
        cation_g_CaCO3_L: r3(OCd * EQ_CACO3), anion_g_CaCO3_L: r3(OCad * EQ_CACO3), exhausts_first: exhausts }
      : { eq_L: r3(OC), design_eq_L: r3(OCd), g_CaCO3_L: r3(OCd * EQ_CACO3), derate_pct: derate * 100, basis: ocBasis, total_capacity_eq_L: rz.Qt || null },
    vessel: { diameter_m: r3(ves.D), area_m2: r3(ves.A), bed_depth_m: r3(ves.h), velocity_m_h: r3(ves.v), specific_flow_BV_h: r3(ves.BVh),
      freeboard_pct: fb * 100, shell_height_m: r3(shell), dp_bed_bar: r3(dpBed), dp_total_bar: r3(dp),
      layers_m: isMB ? { cation: r3(Vc / ves.A), anion: r3(Va / ves.A) } : undefined },
    run: { run_h: r3(run), run_fresh_resin_h: r3(runFresh), design_run_h: runTarget !== null ? r3(runTarget) : null, throughput_m3: r3(Qv * run),
      regeneration_h: r3(regenH), regenerations_per_day: r3(regensDay), waste_m3_per_regen: r3(wastePerRegen), waste_m3_h: r3(wasteM3h),
      waste_pct: r3(100 * wasteM3h / Q), net_output_m3_h: r3(Q - (takeWaste ? wasteM3h : 0)) },
    regeneration: {
      mode: MODE_LABEL[mode], chemical: rc.label, level_g_L: R !== null ? r3(R) : null, level_basis: resin === 'wac' || resin === 'wba' ? 'ratio' : Rsource,
      ratio_pct: ratio, stoichiometric_ratio: r3(kg100 * 1000 / C.EW / Math.max(1e-9, exchangedEq)), efficiency_pct: r3(100 * exchangedEq / Math.max(1e-9, kg100 * 1000 / C.EW)),
      kg_100_per_regen: r3(rc.kg_100), kg_comm_per_regen: r3(rc.kg_comm), comm_pct: rc.comm_pct, L_comm_per_regen: r3(rc.L_comm), conc_pct: rc.conc_pct,
      dilute_m3_per_regen: r3(rc.dilute_m3), dilution_water_m3: r3(rc.dilution_water_m3),
      kg_100_per_day: r3(rc.kg_100 * regensDay), kg_comm_per_day: r3(rc.kg_comm * regensDay),
      caustic: rca ? { level_g_L: r3(Ra), kg_100_per_regen: r3(rca.kg_100), kg_comm_per_regen: r3(rca.kg_comm), comm_pct: rca.comm_pct, L_comm_per_regen: r3(rca.L_comm),
        conc_pct: rca.conc_pct, dilute_m3_per_regen: r3(rca.dilute_m3), kg_100_per_day: r3(rca.kg_100 * regensDay), kg_comm_per_day: r3(rca.kg_comm * regensDay) } : undefined,
      warm_caustic: (rz.side === 'an' || isMB) ? warm : undefined,
      steps: steps.map((s) => ({ step: s.step, min: r3(s.h * 60), m3: r3(s.m3) })),
      excess_acid_eq_day: r3(excess.acid_eq_day), excess_caustic_eq_day: r3(excess.caustic_eq_day),
    },
    targets, recommendations, notes,
    duty_kW: (Hout - eIn.H_kJh) / 3600,
  };
  return {
    streams_out: outs,
    mass_balance: TB.massBalance(feed.mass_flow_kg_h, mOut),
    energy_balance: TB.energyBalance(eIn.H_kJh, Hout, 0),
    details,
    converged: true,
    iterations: 0,
    warnings: [...new Set(warnings.concat(eIn.warnings || [], ...es.map((e) => e.warnings || [])))],
  };
}

// ---------------------------------------------------------------------------
// additional equipment advisor
// ---------------------------------------------------------------------------
const NAOH_G_PER_EQ_TYPICAL = 80 / (opCap(1.3, 0.65, 0.593, 80 / 39.997) * 0.9);   // co-flow SBA I at 80 g/L, 10 % derate
function pretreatment(W, s, side, out) {
  if (W.Cl2 > 0.1) out.push({ level: 'required', item: 'Activated carbon filter (or SMBS dosing) upstream', key: 'acf', where: 'upstream',
    why: `free chlorine ${fm(W.Cl2)} mg/L oxidises ion-exchange resin (cation: de-cross-linking and swelling; anion: loss of strong-base sites) — keep it below 0.1 mg/L` });
  if (W.turb > 2) out.push({ level: 'required', item: 'Pressure sand filter / multimedia filter upstream', key: 'filter', where: 'upstream',
    why: `turbidity ${fm(W.turb)} NTU — ion-exchange beds need < 1–2 NTU or they foul and the pressure drop climbs` });
  if (W.Fe > (side === 'cat' ? 0.3 : 0.1)) out.push({ level: 'recommended', item: 'Iron removal upstream (aeration + filtration, or manganese greensand)', key: 'iron', where: 'upstream',
    why: `iron ${fm(W.Fe)} mg/L fouls the resin (iron is not removed by regeneration) — keep it below ${side === 'cat' ? '0.3' : '0.1'} mg/L` });
  if (W.TOC > 3 && side !== 'cat') out.push({ level: 'recommended', item: 'Organic scavenger (macroporous Type I anion, brine-regenerated) or activated carbon ahead of the anion unit', key: 'scavenger', where: 'upstream',
    why: `TOC ${fm(W.TOC)} mg/L — organics foul strong base resin (capacity loss, long rinses, conductivity creep); choose macroporous or acrylic SBA` });
}
function regenSystem(r, days, perDay, regenLabel, injH) {
  if (!r) return null;
  const C = CHEM[r.chem];
  const store = r.kg_comm * perDay * days / 1000;                     // t of commercial chemical
  const storeM3 = C.solid ? null : store / chemRho(r.chem, r.comm_pct);
  return `${regenLabel}: bulk ${r.label} ${fm(r.comm_pct)} % storage ≈ ${C.solid ? fm(store) + ' t of salt' : fm(storeM3) + ' m³'} for ${fm(days)} days` +
    (C.solid ? `, brine saturator / salt dissolving tank, brine measuring tank ≈ ${fm(1.2 * r.dilute_m3 * r.conc_pct / 26)} m³ of 26 % brine per regeneration` :
      `, measuring tank ≈ ${fm(1.2 * r.L_comm / 1000)} m³, ejector / dosing pump ≈ ${fm(r.dilute_m3 / (pos(injH) ? injH : 0.75))} m³/h of ${fm(r.conc_pct)} % solution`) +
    (r.chem === 'HCl' ? ', acid-fume absorber on the tank vents' : r.chem === 'NaOH' ? ', heat-traced lines if 48 % lye can see < 15 °C' : '');
}
function neutralisation(ctx, out) {
  const acid = (ctx.Win.train || []).reduce((a, t) => a + (num(t.acid_eq_day) ? t.acid_eq_day : 0), 0) + ctx.excess.acid_eq_day;
  const caustic = (ctx.Win.train || []).reduce((a, t) => a + (num(t.caustic_eq_day) ? t.caustic_eq_day : 0), 0) + ctx.excess.caustic_eq_day;
  if (!(acid > 0 || caustic > 0)) return;
  const net = acid - caustic;
  const fix = Math.abs(net) < 1e-9 ? 'they neutralise each other' : net > 0
    ? `net excess acid ${fm(net)} eq/d — add ≈ ${fm(net * CHEM.NaOH.EW / 1000)} kg/d NaOH (or ${fm(net * 37.05 / 1000)} kg/d hydrated lime) to bring the pit to pH 6.5–8.5`
    : `net excess caustic ${fm(-net)} eq/d — add ≈ ${fm(-net * CHEM.HCl.EW / 1000)} kg/d HCl to bring the pit to pH 6.5–8.5`;
  out.push({ level: 'required', item: 'Neutralisation pit for the regeneration effluent (with air agitation / recirculation pump)', key: 'neutral', where: 'downstream',
    why: `unused regenerant leaves with the waste: excess acid ${fm(acid)} eq/d and excess caustic ${fm(caustic)} eq/d` + ((ctx.Win.train || []).length ? ' (this unit and those upstream)' : ' (this unit)') + ' — ' + fix });
}
function adviseIX(c) {
  const out = [];
  const { resin, Win, Wout, sIn, sOut, Q } = c;
  const side = c.rz.side;
  const train = (Win.train || []).map((t) => t.type);
  const has = (...ks) => ks.some((k) => train.includes(k));
  const eqd = (meq) => Q * meq * 24;                                  // eq/d
  pretreatment(Win, sIn, side === 'mb' ? 'an' : side, out);
  const TC = sum(Win.cat), TH = Win.cat.Ca + Win.cat.Mg, FMA = sum(Win.an), ANC = TC - FMA;
  const tds = sIn.TDS_mgL;
  const dmDuty = ['sac_h', 'sba1', 'sba2', 'mb', 'wac', 'wba'].includes(resin);
  if (dmDuty && !has('ro') && tds > 500) {
    const chemDay = c.rc.kg_100 * c.regensDay + (c.rca ? c.rca.kg_100 * c.regensDay : 0);
    out.push({ level: tds > 1000 ? 'recommended' : 'consider', item: 'Reverse osmosis ahead of the ion exchange (RO + mixed-bed polishing)', key: 'ro', where: 'upstream',
      why: `feed TDS ≈ ${fm(tds)} mg/L — above ≈ 500 mg/L ion exchange alone becomes regenerant-intensive`,
      benefit: `RO rejects ≈ 97–98 % of the ions: this unit's ${fm(chemDay)} kg/d of regenerant (100 %) would fall by ≈ 95 %` });
  }
  const regenDesc = c.rc ? (c.rc.chem === 'NaCl' ? 'Brine regeneration system' : c.rc.chem === 'NaOH' ? 'Caustic regeneration system' : 'Acid regeneration system') : '';

  if (resin === 'sac_h') {
    const co2AfterMeq = Win.CT;                                        // all carbonate becomes free CO₂ below pH 4.5
    const removable = Math.max(0, co2AfterMeq - 5 / MW_CO2);
    const asCaCO3 = removable * EQ_CACO3;
    const naoh = eqd(removable) * NAOH_G_PER_EQ_TYPICAL / 1000;
    if (asCaCO3 > 50) out.push({ level: 'recommended', item: 'Degasser (forced-draft CO₂ tower) between the cation and the anion unit, with degassed-water tank and transfer pumps', key: 'degasser', where: 'downstream',
      why: `the cation outlet carries ≈ ${fm(co2AfterMeq * MW_CO2)} mg/L free CO₂ (all the alkalinity, ${fm(sIn.alk_M_mgL_CaCO3)} mg/L as CaCO₃, plus the free CO₂) — the anion resin would have to take it all`,
      benefit: `stripping to ≈ 5 mg/L removes ${fm(asCaCO3)} mg/L as CaCO₃ of anion load: ≈ ${fm(naoh)} kg/d NaOH (100 %) and a proportionally smaller anion bed` });
    else if (asCaCO3 > 25) out.push({ level: 'consider', item: 'Degasser between the cation and the anion unit', key: 'degasser', where: 'downstream',
      why: `≈ ${fm(co2AfterMeq * MW_CO2)} mg/L CO₂ after the cation — a degasser pays off mainly at large flows`, benefit: `≈ ${fm(naoh)} kg/d NaOH saved` });
    const ah = Math.min(TH, Math.max(0, ANC));
    if (!has('wac') && ah >= 0.35 * TC && TC * EQ_CACO3 >= 150) {
      const gSac = c.R / c.OCd, gWac = CHEM[c.chem].EW * 1.1;
      out.push({ level: 'recommended', item: 'Weak acid cation (WAC) ahead of the SAC (separate vessel or layered bed)', key: 'wac', where: 'upstream',
        why: `alkalinity hardness ${fm(ah * EQ_CACO3)} mg/L as CaCO₃ is ${fm(100 * ah / TC)} % of the cations — WAC takes it at ≈ 110 % of stoichiometric acid`,
        benefit: `≈ ${fm(eqd(ah) * Math.max(0, gSac - gWac) / 1000)} kg/d ${CHEM[c.chem].label} (100 %) less, with the SAC's spent acid regenerating the WAC (thoroughfare)` });
    }
    if (c.chem === 'H2SO4' && Win.cat.Ca / Math.max(TC, 1e-9) > 0.3) out.push({ level: 'required', item: 'Stepwise H₂SO₄ regeneration (≈ 1.5 % then 3–5 %) — or regenerate with HCl', key: 'stepwise', where: 'in place',
      why: `calcium is ${fm(100 * Win.cat.Ca / TC)} % of the cations — single-strength sulphuric acid precipitates CaSO₄ in the bed` });
    const naT = c.tgt.na;
    if (naT !== null && sOut.Na_mgL > naT) {
      if (c.mode === 'co') {
        const ccr = sacLeakFrac(c.R, c.chem, 'counter', TC > 0 ? (Win.cat.Na + Win.cat.K + Win.cat.NH4) / TC : 0).mono * TC * EW.Na;
        out.push({ level: 'recommended', item: 'Counter-current (packed-bed) regeneration of the cation unit', key: 'ccr', where: 'in place',
          why: `co-flow sodium leakage ${fm(sOut.Na_mgL)} mg/L is above the ${fm(naT)} mg/L target`, benefit: `≈ ${fm(ccr)} mg/L Na at the same acid level` });
      }
      out.push({ level: 'recommended', item: 'Mixed-bed polisher after the anion unit', key: 'mb', where: 'downstream', why: 'cation leakage target not reachable with this unit alone' });
    } else if (c.mode === 'co' && TC * EQ_CACO3 > 250) {
      out.push({ level: 'consider', item: 'Counter-current regeneration instead of co-flow', key: 'ccr', where: 'in place',
        why: `high cation load (${fm(TC * EQ_CACO3)} mg/L as CaCO₃)`, benefit: 'typically 30–40 % less acid for the same capacity and ≈ 10× lower sodium leakage' });
    }
    out.push({ level: 'required', item: 'Anion exchanger downstream (after the degasser)', key: 'anion', where: 'downstream',
      why: `the cation outlet is decationised acidic water — free mineral acidity ${fm(sOut.FMA_mgL_CaCO3)} mg/L as CaCO₃, pH ≈ ${fm(sOut.pH)}` });
  }
  if (resin === 'wac') {
    if (Math.max(0, ANC) < 0.3 * TH) out.push({ level: 'consider', item: 'Reconsider the WAC', key: null, where: 'in place',
      why: `alkalinity hardness is only ${fm(100 * Math.max(0, ANC) / Math.max(TC, 1e-9))} % of the cations — a WAC removes cations only against alkalinity` });
    if (sum(Wout.cat) > 0.001) out.push({ level: 'required', item: 'Strong acid cation (SAC) after the WAC for demineralisation', key: 'sac_h', where: 'downstream',
      why: `the WAC leaves ${fm(sOut.TH_mgL_CaCO3)} mg/L hardness and ${fm(sOut.Na_mgL)} mg/L sodium (non-alkalinity cations)` });
    const co2 = Wout.CT * MW_CO2;
    if (co2 > 44) out.push({ level: 'recommended', item: 'Degasser after the cation units', key: 'degasser', where: 'downstream', why: `≈ ${fm(co2)} mg/L CO₂ is formed from the alkalinity` });
  }
  if (resin === 'sba1' || resin === 'sba2' || resin === 'wba') {
    if (TH * EQ_CACO3 > 1) out.push({ level: 'required', item: 'Cation exchanger (SAC, H⁺ form) ahead of the anion unit', key: 'sac_h', where: 'upstream',
      why: `${fm(TH * EQ_CACO3)} mg/L hardness reaches the anion resin — salt splitting makes hydroxide / carbonate that precipitates in the bed` });
    if (resin === 'wba' && ANC > 0) out.push({ level: 'required', item: 'Place the WBA after a cation exchanger', key: 'sac_h', where: 'upstream',
      why: 'a weak base anion removes only free mineral acids — the inlet is not acidic, so it removes nothing' });
    const co2meq = Win.CT, rem = Math.max(0, co2meq - 5 / MW_CO2);
    if (!has('degasser') && rem * EQ_CACO3 > 50 && resin !== 'wba') {
      const g = c.R / c.OCd;
      out.push({ level: 'recommended', item: 'Degasser between the cation and the anion unit', key: 'degasser', where: 'upstream',
        why: `${fm(co2meq * MW_CO2)} mg/L CO₂ reaches the anion resin (${fm(100 * co2meq / Math.max(c.load, 1e-9))} % of its load)`,
        benefit: `≈ ${fm(eqd(rem) * g / 1000)} kg/d NaOH (100 %) less and ≈ ${fm(100 * rem / Math.max(c.load, 1e-9))} % less anion resin for the same run` });
    }
    if (resin !== 'wba' && FMA >= 0.6 * c.load && FMA * EQ_CACO3 >= 100 && !has('wba')) {
      const g = c.R / c.OCd, gW = CHEM.NaOH.EW * 1.3;
      out.push({ level: 'recommended', item: 'Weak base anion (WBA) ahead of the SBA, regenerated in series with the SBA’s spent caustic (thoroughfare)', key: 'wba', where: 'upstream',
        why: `mineral acids (Cl, SO₄, NO₃) ${fm(FMA * EQ_CACO3)} mg/L as CaCO₃ are ${fm(100 * FMA / Math.max(c.load, 1e-9))} % of the anion load`,
        benefit: `≈ ${fm(eqd(FMA) * Math.max(0, g - gW) / 1000)} kg/d NaOH (100 %) less; the WBA also traps organics` });
    }
    if (resin === 'wba') out.push({ level: 'required', item: 'Strong base anion (SBA) after the WBA', key: 'sba', where: 'downstream',
      why: `CO₂ (${fm(sOut.CO2_total_mgL)} mg/L) and silica (${fm(sOut.SiO2_mgL)} mg/L) pass a weak base anion untouched` });
    if (resin === 'sba2' && c.TK - 273.15 > 35) out.push({ level: 'required', item: 'Type I anion resin — or cool the feed to ≤ 35 °C', key: null, where: 'in place', why: 'Type II strong base resin degrades above ≈ 35 °C' });
    if (resin !== 'wba') {
      const siT = c.tgt.si;
      if (siT !== null && sOut.SiO2_mgL > siT) {
        const alt = [];
        if (c.mode === 'co') alt.push(`counter-flow ≈ ${fm(Win.SiO2 * sbaSilicaFrac(c.rz, c.R, 'counter', c.warm, (Win.SiO2 / MW_SIO2) / Math.max(c.load, 1e-9), c.TK))} mg/L`);
        if (!c.warm && resin === 'sba1') alt.push(`warm caustic ≈ ${fm(Win.SiO2 * sbaSilicaFrac(c.rz, c.R, c.mode, true, (Win.SiO2 / MW_SIO2) / Math.max(c.load, 1e-9), c.TK))} mg/L`);
        out.push({ level: 'recommended', item: 'Mixed-bed polisher after the anion unit', key: 'mb', where: 'downstream',
          why: `silica leakage ${fm(sOut.SiO2_mgL)} mg/L is above the ${fm(siT)} mg/L target` + (alt.length ? ` (alternatives at this caustic level: ${alt.join('; ')})` : '') });
        if (c.mode === 'co') out.push({ level: 'consider', item: 'Counter-current regeneration of the anion unit', key: 'ccr', where: 'in place', why: 'lower silica and chloride leakage at less caustic' });
      } else if (siT === null && sOut.SiO2_mgL > 0.02) {
        out.push({ level: 'consider', item: 'Mixed-bed polisher for high-pressure boiler feed', key: 'mb', where: 'downstream',
          why: `silica ${fm(sOut.SiO2_mgL)} mg/L after the anion unit — boilers above ≈ 60 bar need ≤ 0.02 mg/L (turbine silica deposits)` });
      }
      if (siT !== null && c.Rsource === 'target' && c.rz.Rr) {
        const [lo, hi] = c.rz.Rr.NaOH, sf = (Win.SiO2 / MW_SIO2) / Math.max(c.load, 1e-9);
        const need = (mode, warm) => { for (let x = lo; x <= hi + 1e-9; x += 5) if (Win.SiO2 * sbaSilicaFrac(c.rz, x, mode, warm, sf, c.TK) <= siT) return x; return null; };
        const opts = [];
        if (resin === 'sba1' && !c.warm) { const x = need(c.mode, true); if (x !== null && x < c.R) opts.push({ what: 'warm caustic (35–50 °C)', R: x }); }
        if (c.mode === 'co') { const x = need('counter', c.warm); if (x !== null && x < c.R) opts.push({ what: 'counter-flow regeneration', R: x }); }
        for (const o of opts) out.push({ level: 'consider', item: `${o.what[0].toUpperCase() + o.what.slice(1)} for the anion unit`, key: o.what.startsWith('warm') ? 'heater' : 'ccr', where: 'in place',
          why: `the ${fm(siT)} mg/L silica target needs ${fm(c.R)} g/L NaOH co-flow as specified; with ${o.what} ≈ ${fm(o.R)} g/L meets it`,
          benefit: `≈ ${fm((c.R - o.R) * c.Vtot * c.regensDay)} kg/d NaOH (100 %) less at the same regeneration frequency` });
      }
      const siShare = (Win.SiO2 / MW_SIO2) / Math.max(c.load, 1e-9);
      if (resin === 'sba1' && !c.warm && (siShare > 0.25 || (siT !== null && sOut.SiO2_mgL > siT))) out.push({ level: 'recommended', item: 'Caustic heater (regenerant at 35–50 °C)', key: 'heater', where: 'in place',
        why: `silica is ${fm(100 * siShare)} % of the anion load — warm caustic elutes silica far better (≈ half the leakage) and avoids silica polymerising in the bed` });
      const cT = c.tgt.cond;
      if (cT !== null && sOut.cond_uScm > cT) out.push({ level: cT < 1 ? 'required' : 'recommended', item: 'Mixed-bed polisher after the anion unit' + (has('sac_h') ? ' (or counter-current regeneration of the cation)' : ''), key: 'mb', where: 'downstream',
        why: `conductivity ${fm(sOut.cond_uScm)} µS/cm vs the ${fm(cT)} µS/cm target — it is mostly sodium leaking from the cation, leaving as NaOH` });
    }
    out.push({ level: 'consider', item: 'Use DM (or decationised) water for caustic dilution and rinses', key: null, where: 'in place', why: 'hardness in the dilution water precipitates Mg(OH)₂ / CaCO₃ in the anion bed' });
  }
  if (resin === 'mb') {
    const cond = sIn.cond_uScm;
    const primary = has('sac_h') && has('sba1', 'sba2');
    if (!primary && !has('ro') && (cond > 20 || TC * EQ_CACO3 > 10)) out.push({ level: c.run < 48 ? 'recommended' : 'consider', item: 'Primary demineralisation (SAC – degasser – SBA) or RO ahead of the mixed bed', key: 'primary', where: 'upstream',
      why: `the mixed bed takes ${fm(TC * EQ_CACO3)} mg/L as CaCO₃ of cations (${fm(cond)} µS/cm; run ${fm(c.run)} h) — a mixed bed is a polisher` });
    else if (primary && cond > 10) out.push({ level: 'consider', item: 'Counter-current regeneration of the primary cation unit', key: 'ccr', where: 'upstream',
      why: `sodium leaking from the primary cation (${fm(sIn.Na_mgL)} mg/L as Na, leaving the anion unit as NaOH, ${fm(cond)} µS/cm) is most of this mixed bed's load`,
      benefit: 'counter-flow cuts that leakage ≈ 10× — a much longer mixed-bed run' });
    const siT = c.tgt.si;
    if (siT !== null && sOut.SiO2_mgL > siT && !c.warm) out.push({ level: 'recommended', item: 'Caustic heater for the mixed-bed regeneration (35–50 °C)', key: 'heater', where: 'in place', why: `silica ${fm(sOut.SiO2_mgL)} mg/L vs the ${fm(siT)} mg/L target` });
    out.push({ level: 'required', item: `Air blower for resin mixing ≈ ${fm(72 * c.ves.A)} Nm³/h at ≈ 0.4–0.5 bar(g)`, key: 'blower', where: 'in place', why: 'the separated layers are re-mixed with air after regeneration (≈ 1.2 Nm³/min per m² of bed)' });
  }
  if ((resin === 'sac_h' || resin === 'sac_na') && c.Rsource === 'target' && c.mode === 'co') {
    const [lo, hi] = c.rz.Rr[c.chem];
    const mono = TC > 0 ? (Win.cat.Na + Win.cat.K + Win.cat.NH4) / TC : 0;
    const ok = (x) => (resin === 'sac_h' ? sacLeakFrac(x, c.chem, 'counter', mono).mono * TC * EW.Na <= c.tgt.na : softLeakFrac(x, 'counter', TC) * TH * EQ_CACO3 <= c.tgt.th);
    let x = null; for (let r = lo; r <= hi + 1e-9; r += 5) if (ok(r)) { x = r; break; }
    if (x !== null && x < c.R) out.push({ level: 'consider', item: 'Counter-current (packed-bed) regeneration', key: 'ccr', where: 'in place',
      why: `the outlet target needs ${fm(c.R)} g/L ${CHEM[c.chem].label} co-flow; counter-flow meets it at ≈ ${fm(x)} g/L`,
      benefit: `≈ ${fm((c.R - x) * c.Vtot * c.regensDay)} kg/d ${CHEM[c.chem].label} (100 %) less at the same regeneration frequency` });
  }
  if (resin === 'sac_na') {
    const thT = c.tgt.th;
    if (thT !== null && sOut.TH_mgL_CaCO3 > thT) out.push({ level: 'recommended', item: c.mode === 'co' ? 'Counter-current regeneration — or a second softener in series (lead–lag polisher)' : 'Second softener in series (lead–lag polisher)', key: null, where: 'downstream',
      why: `residual hardness ${fm(sOut.TH_mgL_CaCO3)} mg/L as CaCO₃ vs the ${fm(thT)} mg/L target` });
    if (tds > 1000) out.push({ level: 'consider', item: 'Two-stage (lead–lag) softening', key: null, where: 'downstream', why: `high TDS (${fm(tds)} mg/L) raises hardness leakage of a single softener` });
    if (sIn.alk_M_mgL_CaCO3 > 50) out.push({ level: 'consider', item: 'Dealkaliser (WAC, or chloride-form anion) if the soft water is boiler make-up', key: 'wac', where: 'downstream',
      why: `softening keeps the alkalinity (${fm(sIn.alk_M_mgL_CaCO3)} mg/L as CaCO₃) — it becomes CO₂ in the steam and corrodes condensate lines` });
  }
  // regeneration system and neutralisation
  const rs = regenSystem(c.rc, c.storageDays, c.regensDay, regenDesc, c.injH);
  if (rs) out.push({ level: 'required', item: rs, key: 'regen', where: 'in place', why: `${fm(c.rc.kg_comm * c.regensDay)} kg/d of ${fm(c.rc.comm_pct)} % ${c.rc.label} at ${fm(c.regensDay)} regenerations a day` });
  if (c.rca) {
    const rsa = regenSystem(c.rca, c.storageDays, c.regensDay, 'Caustic regeneration system', c.injHa);
    out.push({ level: 'required', item: rsa, key: 'regen', where: 'in place', why: `${fm(c.rca.kg_comm * c.regensDay)} kg/d of ${fm(c.rca.comm_pct)} % NaOH` });
  }
  if (c.rc && c.rc.chem !== 'NaCl') neutralisation(c, out);
  else if (c.rc) out.push({ level: 'recommended', item: 'Effluent sump for the spent brine', key: 'neutral', where: 'downstream', why: `≈ ${fm(c.wastePerRegen)} m³ per regeneration of salty rinse (chloride ≈ ${fm(c.rc.kg_100 * c.regensDay)} kg/d as NaCl) — check the discharge limit` });
  if (c.nSb === 0 && c.run < 9999) out.push({ level: 'consider', item: 'Standby vessel (or treated-water storage covering the regeneration time)', key: 'standby', where: 'in place',
    why: `with no standby the supply stops ≈ ${fm(c.regenH)} h every ${fm(c.run)} h` });
  const order = { required: 0, recommended: 1, consider: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------------------------------------------------------------------
// degasser (decarbonator)
// ---------------------------------------------------------------------------
function solveDegasser(input) {
  const mi = TB.moduleInput(input, 1, 1);
  if (mi.error) return mi;
  const feed = mi.streams[0], p = mi.params;
  const warnings = [], notes = [];
  const TK = feed.T_K, tC = TK - 273.15;
  if (!(feed.mass_flow_kg_h > 0)) fail('MB_IX_FLOW', 'the feed has no flow', 'streams');
  if (tC < 1 || tC > 80) fail('MB_IX_T', `feed temperature ${tC.toFixed(1)} °C — the degasser model covers 1–80 °C`, 'streams');
  const type = p.type === 'vacuum' ? 'vacuum' : 'forced';
  const rho = waterRho(TK), Q = feed.mass_flow_kg_h / rho;
  let Win = null, src = 'upstream', ana = null;
  const fromUp = fromStream(feed.water);
  if (p.source !== 'entered' && fromUp) Win = fromUp;
  else {
    const hasEntry = isObj(p.analysis) && [...CATS, ...ANS, 'HCO3', 'CO3'].some((k) => pos(p.analysis[k]));
    if (!hasEntry && fromUp) Win = fromUp;
    else { ana = analysisToWater(p.analysis, TK, warnings); Win = ana.W; src = 'entered'; }
  }
  const resid = pos(p.residual_co2_mgL) ? p.residual_co2_mgL : type === 'vacuum' ? 2 : 5;
  const sp = speciate(Win, TK);
  const freeIn = sp.CO2 * MW_CO2;                                    // mg/L
  const removedMmol = Math.max(0, sp.CO2 - resid / MW_CO2);
  const Wout = cloneW(Win);
  Wout.CT = Math.max(0, Win.CT - removedMmol);
  Wout.train = (Win.train || []).concat([{ type: 'degasser', tag: p.tag || null }]).slice(-12);
  const kgCO2 = removedMmol * MW_CO2 * Q / 1000;                     // kg/h
  if (sp.pH > 6) warnings.push(`inlet pH ${sp.pH.toFixed(2)} — only ${fm(100 * sp.CO2 / Math.max(Win.CT, 1e-12))} % of the carbonate is free CO₂; a degasser works after a cation (H⁺) / WAC unit or acid dosing (pH < 4.5)`);
  if (freeIn <= resid) notes.push(`free CO₂ in (${fm(freeIn)} mg/L) is already at or below the ${fm(resid)} mg/L residual — nothing to strip`);
  // tower sizing
  const loading = pos(p.loading_m3_m2h) ? p.loading_m3_m2h : type === 'vacuum' ? 40 : 60;
  const airRatio = pos(p.air_ratio) ? p.air_ratio : 25;               // Nm³ air per m³ water
  const htu = pos(p.htu_m) ? p.htu_m : 0.6;
  let D = Math.sqrt(4 * Q / loading / Math.PI);
  D = Math.ceil(D / 0.05 - 1e-9) * 0.05;
  const A = Math.PI * D * D / 4;
  const kH = 0.034 * Math.exp(2400 * (1 / TK - 1 / 298.15));         // mol/(L·atm)
  const Hcc = 1 / (kH * 0.082057 * TK);                              // gas/liquid concentration ratio
  const GL = airRatio * TK / 273.15;                                   // actual m³ air per m³ water
  const S = type === 'forced' ? Hcc * GL : 50;
  const ratio = freeIn > resid ? freeIn / resid : 1;
  const NTU = ratio > 1 ? (S / (S - 1)) * Math.log(((ratio) * (S - 1) + 1) / S) : 0;
  const Hpack = Math.max(type === 'vacuum' ? 2.5 : 1.5, NTU * htu);
  const airNm3h = type === 'forced' ? airRatio * Q : 0;
  const fanKW = airNm3h / 3600 * 1960 / 0.6 / 1000 * (TK / 273.15);   // ≈ 200 mm WC at 60 % efficiency
  const tankM3 = Q * (pos(p.tank_min) ? p.tank_min : 20) / 60;
  // streams
  const comps = feed.components.map((c) => ({ key: c.key, mass_fraction: c.mass_fraction }));
  const mVent = Math.min(kgCO2, feed.mass_flow_kg_h * 0.5);
  const water = { mass_flow_kg_h: feed.mass_flow_kg_h - mVent, T_K: TK, P_bar: P_ATM, components: comps, water: toStream(Wout, TK) };
  const vent = { mass_flow_kg_h: mVent, T_K: TK, P_bar: P_ATM, components: [{ key: 'CO2', mass_fraction: 1 }] };
  const sIn = waterSummary(Win, TK), sOut = water.water.summary;
  const out = [];
  pretreatment(Win, sIn, 'an', out);
  if (sp.pH > 6) out.push({ level: 'required', item: 'Cation exchanger (H⁺ form) or WAC ahead — or acid dosing to pH < 4.5', key: 'sac_h', where: 'upstream',
    why: `at pH ${fm(sp.pH)} the CO₂ is held as bicarbonate (${fm(sIn.alk_M_mgL_CaCO3)} mg/L as CaCO₃) and cannot be stripped` });
  if (type === 'forced') {
    out.push({ level: 'required', item: `Degassed-water tank ≈ ${fm(tankM3)} m³ (${fm(pos(p.tank_min) ? p.tank_min : 20)} min) and transfer pumps ${fm(Q * 1.1)} m³/h (1 working + 1 standby)`, key: 'tank', where: 'downstream',
      why: 'a forced-draft tower discharges at atmospheric pressure — the anion unit needs a pump; head = anion bed and internals drop + 1.5–2 bar' });
    out.push({ level: 'required', item: `Air blower ≈ ${fm(airNm3h)} Nm³/h at ≈ 200 mm WC (≈ ${fm(fanKW)} kW absorbed, 1 + 1)`, key: 'blower', where: 'in place',
      why: `air-to-water ratio ${fm(airRatio)} Nm³/m³; filter the air intake (dust fouls the anion resin)` });
    out.push({ level: 'consider', item: 'Vacuum degasser instead, if dissolved oxygen must also go (boiler feed without a deaerator, or anion resin sensitive to oxidation)', key: null, where: 'in place',
      why: 'a forced-draft tower saturates the water with air (≈ 8 mg/L O₂ at 25 °C); a vacuum tower takes O₂ below ≈ 0.1 mg/L and CO₂ to ≈ 1–2 mg/L' });
  } else {
    out.push({ level: 'required', item: 'Vacuum system (liquid-ring pump or steam ejectors) and an extraction pump with adequate NPSH', key: 'vacuum', where: 'in place',
      why: 'the tower runs at ≈ 30–50 mbar(a); the water leaves at its saturation pressure' });
  }
  if (Win.CT > 0 && sOut.CO2_free_mgL < 1 && type === 'forced') notes.push('a forced-draft tower rarely gets below ≈ 3–5 mg/L CO₂');
  const eIn = TB.streamEnthalpy(feed);
  if (eIn.error) return eIn;
  const outs = [water, vent], es = [];
  for (const o of outs) {
    const e = TB.streamEnthalpy({ mass_flow_kg_h: o.mass_flow_kg_h, T_K: o.T_K, P_bar: o.P_bar, components: o.components });
    if (e.error) return e;
    o.H_kJh = e.H_kJh; es.push(e);
  }
  const Hout = outs.reduce((a, o) => a + o.H_kJh, 0), mOut = outs.reduce((a, o) => a + o.mass_flow_kg_h, 0);
  notes.push('Evaporation into the air (≈ 0.1 % of the water) and its cooling effect are not modelled.');
  const r3 = (x) => (num(x) ? +x.toPrecision(6) : x);
  return {
    streams_out: outs,
    mass_balance: TB.massBalance(feed.mass_flow_kg_h, mOut),
    energy_balance: TB.energyBalance(eIn.H_kJh, Hout, 0),
    details: {
      unit: type === 'vacuum' ? 'Vacuum degasser' : 'Forced-draft degasser (decarbonator)', resin: 'degasser', unit_version: IONX_VERSION, analysis_source: src,
      analysis_check: ana ? { imbalance_pct: r3(ana.imbalance_pct), balanced_with: ana.balanced_with, adjustment_mgL_CaCO3: r3(ana.balance_adj_mgL_CaCO3) } : null,
      flow: { Q_m3h: r3(Q), T_C: r3(tC), density_kg_m3: r3(rho) },
      feed_water: sIn, treated_water: sOut,
      co2: { free_in_mgL: r3(freeIn), out_mgL: r3(sOut.CO2_free_mgL), removed_mgL: r3(removedMmol * MW_CO2), removed_kg_h: r3(kgCO2),
        anion_load_removed_mgL_CaCO3: r3(removedMmol * EQ_CACO3), strippable_pct: r3(100 * sp.CO2 / Math.max(Win.CT, 1e-12)) },
      tower: { diameter_m: r3(D), area_m2: r3(A), loading_m3_m2h: r3(Q / A), packing_height_m: r3(Hpack), NTU: r3(NTU), HTU_m: htu, stripping_factor: r3(S),
        air_Nm3_h: r3(airNm3h), air_ratio_Nm3_m3: type === 'forced' ? airRatio : null, blower_kW: r3(fanKW), tank_m3: r3(tankM3) },
      recommendations: out.sort((a, b) => ({ required: 0, recommended: 1, consider: 2 }[a.level] - { required: 0, recommended: 1, consider: 2 }[b.level])),
      notes,
      duty_kW: (Hout - eIn.H_kJh) / 3600,
    },
    converged: true,
    iterations: 0,
    warnings: [...new Set(warnings.concat(eIn.warnings || [], ...es.map((e) => e.warnings || [])))],
  };
}

// ---------------------------------------------------------------------------
// registration — modules never throw: thrown IxErrors become error envelopes
// ---------------------------------------------------------------------------
const guard = (fn) => (input) => {
  try { return fn(input); } catch (e) {
    return TB.errObj((e && e.code) || 'MB_IX', (e && e.message) || String(e), (e && e.field) || 'params');
  }
};
export function register(toolbox) {
  TB = toolbox;
  return { 'ion-exchange': guard(solveIX), degasser: guard(solveDegasser) };
}
/** modules that set the stream's water analysis themselves (the flowsheet does not copy it through them) */
export const WATER_MODULES = new Set(['ion-exchange', 'degasser']);

export default { IONX_VERSION, register, mixWater, waterSummary, WATER_MODULES };
