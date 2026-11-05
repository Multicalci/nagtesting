// ============================================================================
// mb-syngas.js — STEP 33: steam reformers, autothermal reformer, shift
// converter and methanator on the property methods (mb-thermo.js).
//
//   r-smr         primary reformer (fired, outlet T given → furnace duty) or
//                 air/O2-blown secondary reformer (adiabatic)
//   r-atr         autothermal reformer; steam and oxidant built from the
//                 carbon count of the feed, adiabatic
//   r-shift       water-gas shift converter, HTS / LTS presets
//   r-methanator  CO / CO2 clean-up by methanation
//
// Chemistry is the restricted equilibrium of the two independent syngas
// reactions (equilReactions in mb-units.js):
//     R1  CH4 + H2O ⇌ CO + 3 H2         (steam reforming / methanation)
//     R2  CO + H2O ⇌ CO2 + H2           (water-gas shift)
// each at T_out + its approach to equilibrium (ΔT; same sign convention as
// the classic modules), with
//   · ΔG°(T) from the databank (ChemSep / NIST ideal-gas data, formation basis)
//     instead of the Twigg / Moe correlations of the classic modules;
//   · vapour fugacity coefficients from the property method (phase_model 'eos',
//     the default on a cubic equation of state, or 'ideal');
//   · enthalpies, outlet phase split and properties from the property method,
//     so the duty is on the same basis as every other unit in the flowsheet.
// Hydrocarbons and oxygenates other than CH4 are converted fully first
// (CxHyOz + (x−z) H2O → x CO + (x−z+y/2) H2), as in a primary reformer with
// pre-reforming; oxygen is consumed completely (CH4, then H2, then CO) before
// the equilibrium — the adiabatic outlet does not depend on that path.
// Species with elements other than C, H, O pass through as inerts. The outlet
// carbon activity (CH4 cracking, Boudouard, CO reduction) is reported and a
// value above 1 is flagged.
//
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import units from './mb-units.js';

export const SYNGAS_VERSION = 'mb-syngas 1.0.0';
const K = units.KIT;
const { th, num, fail, KJH_PER_KW } = K;

const RXN = {
  smr: { label: 'CH4 + H2O = CO + 3H2', stoich: { CH4: -1, H2O: -1, CO: 1, H2: 3 } },
  wgs: { label: 'CO + H2O = CO2 + H2', stoich: { CO: -1, H2O: -1, CO2: 1, H2: 1 } },
};
const SYN = ['CH4', 'H2O', 'CO', 'CO2', 'H2'];
const SHIFT_PRESETS = {
  hts: { ate: 10, Tlo: 623.15, Thi: 723.15, label: 'HTS 350–450 °C' },
  lts: { ate: 5, Tlo: 463.15, Thi: 523.15, label: 'LTS 190–250 °C' },
  none: { ate: 0, Tlo: null, Thi: null, label: null },
};
const AIR_O2 = 0.21, AIR_N2 = 0.79;

/** formula of a key as {C, H, O, …} (or null) */
const formula = (k) => K.elements(k) || null;
/** carbon-bearing feed species that are converted fully before the equilibrium */
function crackable(k) {
  if (k === 'CH4' || k === 'CO' || k === 'CO2') return false;
  const f = formula(k);
  if (!f || !(f.C > 0)) return false;
  return Object.keys(f).every((e) => e === 'C' || e === 'H' || e === 'O') && f.C - (f.O || 0) >= 0;
}

/**
 * Common driver: inlet states → working moles (pre-crack, O2 burn) → restricted
 * equilibrium at T (given or energy-balanced) → outlet stream and details.
 * @param {string} unit label ('smr', 'secondary', 'atr', 'shift', 'methanator')
 * @param {Array} streams inlet streams (already including any constructed ones)
 * @param {object} p params
 * @param {object} cfg { rx: [{key, ate}], adiabatic, T_out_K, duty_kW, allowO2, crack, Tmin, Tmax, Tguess }
 */
function runSyngas(unit, streams, p, cfg) {
  const keys = [...new Set(K.keysOf(...streams).concat(SYN))];
  const pp = K.pkg(p.property_package, keys);
  const w = pp.warnings.slice();
  const st = streams.map((s, i) => K.stateIn(pp, s, `${unit} inlet ${i + 1}`));
  const f = K.combine(pp, st);
  const P = K.pOut(p, Math.min(...streams.map((s) => s.P_bar)), unit);
  // ---- working moles
  const n = f.z.map((v) => v * f.F);
  const ix = (k) => pp.index[k];
  const precrack = [];
  let steamNeed = 0;
  const inerts = [];
  for (let i = 0; i < pp.n; i++) {
    const k = pp.keys[i];
    if (!(n[i] > 0) || SYN.includes(k) || k === 'O2') continue;
    if (cfg.crack && crackable(k)) { const fm = formula(k); steamNeed += (fm.C - (fm.O || 0)) * n[i]; continue; }
    if (!cfg.crack && formula(k) && formula(k).C > 0) fail('MB_SYN_FEED', `${unit}: '${k}' is not converted on this catalyst — only CO, CO2, CH4, H2, H2O react here`, 'streams');
    inerts.push(k);
  }
  for (const k of inerts) if (!['N2', 'Ar', 'He', 'Ne'].includes(k)) w.push(`${unit}: '${k}' is carried through as an inert`);
  if (steamNeed > n[ix('H2O')] + 1e-12) fail('MB_SYN_STEAM', `${unit}: converting the C2+ / oxygenated feed needs ${steamNeed.toPrecision(4)} kmol/h H2O but ${n[ix('H2O')].toPrecision(4)} kmol/h is fed — raise the steam rate`, 'streams');
  if (cfg.crack) for (let i = 0; i < pp.n; i++) {
    const k = pp.keys[i];
    if (!(n[i] > 0) || !crackable(k)) continue;
    const fm = formula(k), a = n[i], x = fm.C, z = fm.O || 0, y = fm.H || 0;
    n[i] = 0;
    n[ix('H2O')] -= (x - z) * a; n[ix('CO')] += x * a; n[ix('H2')] += (x - z + y / 2) * a;
    precrack.push({ key: k, n_kmol_h: a });
  }
  let ch4Burned = 0, o2 = pp.index.O2 !== undefined ? n[ix('O2')] : 0;
  if (o2 > 0 && !cfg.allowO2) fail('MB_SYN_O2', `${unit}: oxygen in the feed — use the secondary or autothermal reformer`, 'streams');
  if (o2 > 0) {
    // all O2 is consumed: CH4 + 2 O2 → CO2 + 2 H2O, then 2 H2 + O2 → 2 H2O, then 2 CO + O2 → 2 CO2
    const b1 = Math.min(n[ix('CH4')], o2 / 2); n[ix('CH4')] -= b1; n[ix('CO2')] += b1; n[ix('H2O')] += 2 * b1; o2 -= 2 * b1; ch4Burned = b1;
    const b2 = Math.min(n[ix('H2')], 2 * o2); n[ix('H2')] -= b2; n[ix('H2O')] += b2; o2 -= b2 / 2;
    const b3 = Math.min(n[ix('CO')], 2 * o2); n[ix('CO')] -= b3; n[ix('CO2')] += b3; o2 -= b3 / 2;
    if (o2 > 1e-9 * f.F) fail('MB_SYN_O2', `${unit}: ${o2.toPrecision(4)} kmol/h O2 is left after burning all CH4, H2 and CO — reduce the oxygen rate`, 'streams');
    n[ix('O2')] = 0;
  }
  // ---- equilibrium options
  const pm = p.phase_model === undefined ? (K.hasRealVapour(pp) ? 'eos' : 'ideal') : p.phase_model;
  if (pm !== 'eos' && pm !== 'ideal') fail('MB_SYN_PHASE', `${unit}: phase_model must be 'eos' or 'ideal'`, 'phase_model');
  const fug = pm === 'eos' && K.hasRealVapour(pp);
  const rx = cfg.rx.map((r) => Object.assign({ approach_K: r.ate }, RXN[r.key]));
  const at = (T) => {
    const e = K.equilReactions(pp, n, T, P, rx, { fugacity: fug });
    const F = e.n.reduce((a, b) => a + b, 0);
    const z = e.n.map((v) => v / F);
    let r = th.flashPT(pp, z, T, P);
    return { e, F, z, r, H: F * th.hOf(pp, r) };
  };
  let res, T;
  if (!cfg.adiabatic) {
    T = cfg.T_out_K;
    if (!num(T) || T < cfg.Tmin || T > cfg.Tmax) fail('MB_SYN_T', `${unit}: outlet temperature must be within ${cfg.Tmin}–${cfg.Tmax} K`, 'T_out_K');
    res = at(T);
  } else {
    const Q = num(cfg.duty_kW) ? cfg.duty_kW * KJH_PER_KW : 0;
    T = K.solveEnergyT((t) => (res = at(t)).H - (f.H_kJh + Q), cfg.Tguess, cfg.Tmin, cfg.Tmax, unit);
    if (res.r.T !== T) res = at(T);
  }
  if (!res.e.converged) w.push(`${unit}: equilibrium iteration did not fully converge`);
  if (res.r.beta < 1 - 1e-9) w.push(`${unit}: ${(100 * (1 - res.r.beta)).toFixed(2)} mol % of the outlet is liquid at ${T.toFixed(1)} K — the equilibrium is computed for the gas`);
  const out = K.streamOut(pp, res.F, res.z, res.r);
  // ---- reporting
  const lp = fug ? K.vapLnPhi(pp, T, P, res.z) : null;
  const aC = K.carbonActivities(pp, res.e.n, T, P, lp);
  const aMax = aC ? Math.max(...Object.values(aC)) : null;
  // graphite is reported for the reformers; on shift and methanation catalysts at their temperatures the
  // Boudouard equilibrium always favours carbon but the reaction is kinetically absent — report only
  if (aMax !== null && aMax > 1 && cfg.crack) w.push(`${unit}: carbon activity ${aMax.toFixed(2)} > 1 in the outlet gas (${Object.entries(aC).filter(([, v]) => v > 1).map(([k]) => k).join('; ')}) — graphite is thermodynamically favoured`);
  const nOut = res.e.n, tot = res.F;
  const dryTot = tot - (nOut[ix('H2O')] || 0);
  const wet = [], dry = [];
  const order = SYN.concat(pp.keys.filter((k) => !SYN.includes(k) && nOut[ix(k)] > 0));
  for (const k of order) {
    const v = nOut[ix(k)] || 0;
    wet.push({ key: k, mole_fraction: tot > 0 ? v / tot : 0 });
    if (k !== 'H2O') dry.push({ key: k, mole_fraction: dryTot > 0 ? v / dryTot : 0 });
  }
  const dryAt = (k) => (dryTot > 0 ? (nOut[ix(k)] || 0) / dryTot : 0);
  const details = {
    pp: { model: pp.model, label: pp.label }, method: `restricted equilibrium (${rx.map((r) => r.label).join('; ')}) with ${fug ? `fugacity coefficients from ${pp.label || pp.model}` : 'an ideal-gas vapour'}; ΔG° from the databank`,
    phase_model: fug ? 'eos' : 'ideal', T_out_K: T, P_out_bar: P / 1e5,
    reactions: rx.map((r, j) => ({ label: r.label, approach_K: r.approach_K, T_eq_K: T + r.approach_K, extent_kmol_h: res.e.xi[j], lnK: res.e.lnK[j], lnQ: res.e.lnQ[j] })),
    composition_wet: wet, composition_dry: dry,
    h2_co_ratio: nOut[ix('CO')] > 0 ? nOut[ix('H2')] / nOut[ix('CO')] : null,
    ch4_slip_dry_pct: 100 * dryAt('CH4'),
    carbon_activity: aC || undefined, carbon_activity_max: aMax === null ? undefined : aMax,
    outlet_mole_flows: order.map((k) => ({ key: k, n_kmol_h: nOut[ix(k)] || 0 })),
    iterations: res.e.iterations,
  };
  if (precrack.length) details.precrack = precrack;
  if (ch4Burned > 0) details.ch4_burned_kmol_h = ch4Burned;
  const R0 = K.result([out], f.mass, f.H_kJh, out.H_kJh, 0, details, w, { converged: res.e.converged, iterations: res.e.iterations });
  return { R0, pp, f, T, P, res, dryAt, details, w };
}

/** S/C on the as-fed streams: H2O over hydrocarbon carbon (CO/CO2 excluded) */
function steamCarbon(streams, p) {
  let nC = 0, nW = 0;
  for (const s of streams) {
    const m = units.moles(s);
    if (!m) continue;
    for (const [k, v] of Object.entries(m.n)) {
      if (k === 'H2O') nW += v;
      else if (k === 'CH4' || crackable(k)) nC += (formula(k).C || 0) * v;
    }
  }
  return { nC, nW, sc: nC > 0 ? nW / nC : null };
}

/**
 * r-smr. params: mode 'fired' | 'secondary', T_out_K (fired), P_out_bar | dp_bar,
 * ate_smr_K (default 0), ate_wgs_K (default 10), s_c_min (2.5), phase_model,
 * furnace_efficiency, fuel_lhv_kJkg (fired); duty_kW heat loss (secondary).
 */
function solveRSMR(inp) {
  const { streams, params: p } = K.input(inp, 1, 2, 'r-smr');
  const mode = p.mode === undefined ? (streams.length === 2 ? 'secondary' : 'fired') : p.mode;
  if (mode !== 'fired' && mode !== 'secondary') fail('MB_SMR_MODE', "r-smr: mode must be 'fired' or 'secondary'", 'mode');
  if (mode === 'fired' && streams.length !== 1) fail('MB_STREAMS', 'r-smr: fired mode takes one process stream', 'streams');
  if (mode === 'secondary' && streams.length !== 2) fail('MB_STREAMS', 'r-smr: secondary mode takes [process gas, air / O2]', 'streams');
  const ateS = num(p.ate_smr_K) ? p.ate_smr_K : 0, ateW = num(p.ate_wgs_K) ? p.ate_wgs_K : 10;
  const sc = steamCarbon(streams, p);
  const scMin = num(p.s_c_min) ? p.s_c_min : (mode === 'fired' ? 2.5 : 0.5);
  const unit = mode === 'fired' ? 'smr' : 'secondary';
  if (mode === 'secondary') {
    const m = units.moles(streams[1]);
    if (!m || !(m.n.O2 > 0)) fail('MB_SMR_O2', 'r-smr: secondary mode needs O2 in the second (air / oxidant) stream', 'streams');
  }
  const run = runSyngas(unit, streams, p, { rx: [{ key: 'smr', ate: ateS }, { key: 'wgs', ate: ateW }], adiabatic: mode === 'secondary',
    T_out_K: p.T_out_K, duty_kW: p.duty_kW, allowO2: mode === 'secondary', crack: true, Tmin: 500, Tmax: 1800, Tguess: 1250 });
  const { R0, details, w } = run;
  details.mode = mode;
  details.ate_smr_K = ateS; details.ate_wgs_K = ateW;
  details.T_eq_smr_K = run.T + ateS; details.T_eq_wgs_K = run.T + ateW;
  details.s_c = { ratio: sc.sc, min: scMin, ok: sc.sc === null ? false : sc.sc >= scMin };
  if (sc.sc !== null && sc.sc < scMin) w.push(`${unit}: S/C = ${sc.sc.toFixed(3)} is below ${scMin} — carbon formation risk on the catalyst`);
  if (mode === 'fired') {
    const Q = R0.energy_balance.Q_kW;
    details.Q_furnace_kW = Q;
    const eff = num(p.furnace_efficiency) ? p.furnace_efficiency : 1.0;
    if (eff <= 0 || eff > 1) fail('MB_SMR_EFF', 'r-smr: furnace_efficiency must be in (0, 1]', 'furnace_efficiency');
    details.furnace_efficiency = eff;
    if (num(p.fuel_lhv_kJkg)) {
      if (p.fuel_lhv_kJkg <= 0) fail('MB_SMR_LHV', 'r-smr: fuel_lhv_kJkg must be positive', 'fuel_lhv_kJkg');
      details.fuel_kg_h = Q > 0 ? Q * KJH_PER_KW / (eff * p.fuel_lhv_kJkg) : 0;
    }
  }
  R0.warnings = [...new Set(w)];
  return R0;
}

/**
 * r-atr. streams: [hydrocarbon feed]; params s_c_ratio, o2_c_ratio, oxidant 'O2' | 'air',
 * steam_T_K (500), oxidant_T_K (298.15), P_out_bar, ate_smr_K, ate_wgs_K, s_c_min (0.5), phase_model.
 */
function solveRATR(inp) {
  const { streams, params: p } = K.input(inp, 1, 1, 'r-atr');
  if (!num(p.s_c_ratio) || p.s_c_ratio < 0) fail('MB_ATR_SC', 'r-atr: s_c_ratio (kmol added H2O per kmol C) must be ≥ 0', 's_c_ratio');
  if (!num(p.o2_c_ratio) || p.o2_c_ratio <= 0) fail('MB_ATR_O2C', 'r-atr: o2_c_ratio (kmol O2 per kmol C) must be > 0', 'o2_c_ratio');
  const oxidant = p.oxidant === undefined ? 'O2' : p.oxidant;
  if (oxidant !== 'O2' && oxidant !== 'air') fail('MB_ATR_OX', "r-atr: oxidant must be 'O2' or 'air'", 'oxidant');
  const feed = streams[0];
  const sc0 = steamCarbon([feed], p);
  if (!(sc0.nC > 0)) fail('MB_ATR_FEED', 'r-atr: the feed carries no hydrocarbon carbon', 'streams');
  const steamT = num(p.steam_T_K) ? p.steam_T_K : 500, oxT = num(p.oxidant_T_K) ? p.oxidant_T_K : 298.15;
  const nSteam = p.s_c_ratio * sc0.nC, nO2 = p.o2_c_ratio * sc0.nC;
  const P = num(p.P_out_bar) ? p.P_out_bar : feed.P_bar;
  const mw = (k) => K.pkg(p.property_package, [k]).MW[0];
  const extra = [];
  const w0 = [];
  if (nSteam > 0) {
    const s = { mass_flow_kg_h: nSteam * mw('H2O'), T_K: steamT, P_bar: P, components: [{ key: 'H2O', mass_fraction: 1 }] };
    const ppw = K.pkg(p.property_package, ['H2O']);
    const r = th.flashPT(ppw, [1], steamT, P * 1e5);
    if (r.phase !== 'V') { s.spec = 'PVF'; s.vapour_fraction = 1; w0.push(`atr: added steam at ${steamT.toFixed(1)} K is below its saturation temperature at ${P.toPrecision(4)} bar — taken as saturated vapour`); }
    extra.push(s);
  }
  if (oxidant === 'O2') extra.push({ mass_flow_kg_h: nO2 * mw('O2'), T_K: oxT, P_bar: P, components: [{ key: 'O2', mass_fraction: 1 }] });
  else {
    const nN2 = nO2 * AIR_N2 / AIR_O2, mO2 = nO2 * mw('O2'), mN2 = nN2 * mw('N2');
    extra.push({ mass_flow_kg_h: mO2 + mN2, T_K: oxT, P_bar: P, components: [{ key: 'O2', mass_fraction: mO2 / (mO2 + mN2) }, { key: 'N2', mass_fraction: mN2 / (mO2 + mN2) }] });
  }
  const all = [feed].concat(extra);
  const ateS = num(p.ate_smr_K) ? p.ate_smr_K : 0, ateW = num(p.ate_wgs_K) ? p.ate_wgs_K : 10;
  const run = runSyngas('atr', all, Object.assign({}, p, { P_out_bar: P }), { rx: [{ key: 'smr', ate: ateS }, { key: 'wgs', ate: ateW }], adiabatic: true,
    duty_kW: p.duty_kW, allowO2: true, crack: true, Tmin: 600, Tmax: 2200, Tguess: 1300 });
  const { R0, details, w } = run;
  const sc = steamCarbon(all, p);
  const scMin = num(p.s_c_min) ? p.s_c_min : 0.5;
  Object.assign(details, { mode: 'atr', ate_smr_K: ateS, ate_wgs_K: ateW, T_eq_smr_K: run.T + ateS, T_eq_wgs_K: run.T + ateW, o2_c_ratio: p.o2_c_ratio,
    s_c: { ratio: sc.sc, min: scMin, ok: sc.sc === null ? false : sc.sc >= scMin },
    constructed_streams: { steam_kmol_h: nSteam, steam_T_K: steamT, oxidant, o2_kmol_h: nO2, oxidant_T_K: oxT } });
  if (sc.sc !== null && sc.sc < scMin) w.push(`atr: S/C = ${sc.sc.toFixed(3)} is below ${scMin} — soot / carbon risk`);
  // the constructed steam and oxidant are inlets of this unit: report the mass balance on all of them
  R0.mass_balance.in = run.f.mass;
  R0.mass_balance.closure_pct = run.f.mass > 0 ? 100 * (R0.mass_balance.out - run.f.mass) / run.f.mass : 0;
  R0.details.added_mass_kg_h = run.f.mass - feed.mass_flow_kg_h;
  R0.warnings = [...new Set(w0.concat(w))];
  return R0;
}

/** r-shift. params: preset 'hts' | 'lts' | 'none', mode 'adiabatic' | 'isothermal', T_out_K, ate_K, P_out_bar, phase_model */
function solveRShift(inp) {
  const { streams, params: p } = K.input(inp, 1, 1, 'r-shift');
  const preset = p.preset === undefined ? 'none' : p.preset;
  if (!(preset in SHIFT_PRESETS)) fail('MB_SHIFT_PRESET', `r-shift: preset must be one of ${Object.keys(SHIFT_PRESETS).join(', ')}`, 'preset');
  const mode = p.mode === undefined ? 'adiabatic' : p.mode;
  if (mode !== 'adiabatic' && mode !== 'isothermal') fail('MB_SHIFT_MODE', "r-shift: mode must be 'adiabatic' or 'isothermal'", 'mode');
  const ate = num(p.ate_K) ? p.ate_K : SHIFT_PRESETS[preset].ate;
  const m = units.moles(streams[0]);
  if (m && !((m.n.CO > 0 && m.n.H2O > 0) || (m.n.CO2 > 0 && m.n.H2 > 0))) fail('MB_SHIFT_FEED', 'r-shift: needs CO + H2O (forward) and/or CO2 + H2 (reverse) in the feed', 'streams');
  const run = runSyngas('shift', streams, p, { rx: [{ key: 'wgs', ate }], adiabatic: mode === 'adiabatic', T_out_K: p.T_out_K, duty_kW: p.duty_kW,
    allowO2: false, crack: false, Tmin: 350, Tmax: 1100, Tguess: streams[0].T_K + 30 });
  const { R0, details, w } = run;
  const pr = SHIFT_PRESETS[preset];
  if (pr.Tlo && (run.T < pr.Tlo || run.T > pr.Thi)) w.push(`shift: T_out ${run.T.toFixed(1)} K is outside the ${preset} window ${pr.Tlo}–${pr.Thi} K (${pr.label})`);
  Object.assign(details, { mode, preset, ate_K: ate, T_eq_K: run.T + ate, T_in_K: streams[0].T_K, delta_T_K: run.T - streams[0].T_K,
    extent_kmol_h: details.reactions[0].extent_kmol_h, co_slip_dry_pct: 100 * run.dryAt('CO') });
  if (mode === 'isothermal') details.Q_kW = R0.energy_balance.Q_kW;
  R0.warnings = [...new Set(w)];
  return R0;
}

/** r-methanator. params: mode 'adiabatic' | 'isothermal', T_out_K, ate_K (both reactions, default 0), P_out_bar, phase_model */
function solveRMethanator(inp) {
  const { streams, params: p } = K.input(inp, 1, 1, 'r-methanator');
  const mode = p.mode === undefined ? 'adiabatic' : p.mode;
  if (mode !== 'adiabatic' && mode !== 'isothermal') fail('MB_METH_MODE', "r-methanator: mode must be 'adiabatic' or 'isothermal'", 'mode');
  const ate = num(p.ate_K) ? p.ate_K : 0;
  const m = units.moles(streams[0]);
  if (m && (!(m.n.H2 > 0) || !((m.n.CO || 0) + (m.n.CO2 || 0) > 0))) fail('MB_METH_FEED', 'r-methanator: needs H2 and CO and/or CO2 in the feed', 'streams');
  const run = runSyngas('methanator', streams, p, { rx: [{ key: 'smr', ate }, { key: 'wgs', ate }], adiabatic: mode === 'adiabatic', T_out_K: p.T_out_K, duty_kW: p.duty_kW,
    allowO2: false, crack: false, Tmin: 350, Tmax: 1000, Tguess: streams[0].T_K + 30 });
  const { R0, details } = run;
  Object.assign(details, { mode, ate_K: ate, T_eq_K: run.T + ate, T_in_K: streams[0].T_K, delta_T_K: run.T - streams[0].T_K,
    co_ppm_dry: 1e6 * run.dryAt('CO'), co2_ppm_dry: 1e6 * run.dryAt('CO2'), co_co2_ppm_dry: 1e6 * (run.dryAt('CO') + run.dryAt('CO2')), ch4_dry_pct: 100 * run.dryAt('CH4') });
  if (mode === 'isothermal') details.Q_kW = R0.energy_balance.Q_kW;
  return R0;
}

export const SYNGAS_MODULES = {
  'r-smr': solveRSMR,
  'r-atr': solveRATR,
  'r-shift': solveRShift,
  'r-methanator': solveRMethanator,
};

export default { SYNGAS_VERSION, SYNGAS_MODULES };
