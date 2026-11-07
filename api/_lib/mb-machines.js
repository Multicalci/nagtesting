// ============================================================================
// mb-machines.js — STEP 34: multistage compressor with intercoolers and
// knock-out drums, on the property methods.
//
//   r-compressor-train   N stages (2–8). Each stage: compressor (isentropic or
//                        polytropic efficiency, or its own performance curve)
//                        → intercooler to a set temperature (pressure drop
//                        optional) → knock-out drum (liquid removed). The last
//                        stage has an aftercooler + knock-out only when an
//                        aftercooler temperature is given.
//                        Stage discharge pressures: given (stage_P_out_bar), or
//                        an equal pressure ratio per stage found so that the
//                        last stage reaches P_out_bar with the cooler pressure
//                        drops taken into account.
//                        Outlets: [compressed gas, combined condensate] — the
//                        knock-out liquids are let down and mixed at the lowest
//                        drum pressure (drain header).
//                        Reported per stage: suction / discharge P and T,
//                        ratio, power, efficiency, cooler duty, condensate, and
//                        a curve's surge margin; totals for power, cooling and
//                        condensate.
//
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import units from './mb-units.js';

export const MACHINES_VERSION = 'mb-machines 1.0.0';
const K = units.KIT;
const { num, fail } = K;
const U = K.units;

const listOr = (v, n, def, label, key) => {
  if (Array.isArray(v)) {
    if (v.length !== n || !v.every(num)) fail('MB_TRAIN_LIST', `${label}: ${key} needs one number per stage (${n})`, key);
    return v.slice();
  }
  return new Array(n).fill(num(v) ? v : def);
};
const unwrap = (r, what) => {
  if (r && r.error) fail(r.error.code || 'MB_TRAIN_UNIT', `r-compressor-train: ${what}: ${r.error.message}`, r.error.field || 'params');
  return r;
};
/** run a unit solver, naming the stage in any error it raises */
const call = (fn, inp, what) => {
  try { return unwrap(fn(inp), what); } catch (e) {
    if (e && e.code && /^r-compressor-train:/.test(e.message)) throw e;
    fail((e && e.code) || 'MB_TRAIN_UNIT', `r-compressor-train: ${what}: ${e && e.message}`, (e && e.field) || 'params');
  }
};

function solveTrain(inp) {
  const label = 'r-compressor-train';
  const { streams, params: p } = K.input(inp, 1, 1, label);
  if (!p.property_package) fail('MB_RIG_PACKAGE', `${label}: params.property_package {model} is required`, 'property_package');
  const N = num(p.stages) ? Math.round(p.stages) : 3;
  if (N < 1 || N > 8) fail('MB_TRAIN_N', `${label}: stages must be 1–8`, 'stages');
  const Pin = streams[0].P_bar;
  const dp = listOr(p.intercooler_dp_bar, N, 0, label, 'intercooler_dp_bar');
  const Tic = listOr(p.intercooler_T_K, N, NaN, label, 'intercooler_T_K');
  const eff = listOr(p.efficiency, N, 0.78, label, 'efficiency');
  const mode = p.mode === 'isentropic' ? 'isentropic' : 'polytropic';
  const curves = Array.isArray(p.curves) ? p.curves : null;
  if (curves && curves.length !== N) fail('MB_TRAIN_LIST', `${label}: curves needs one entry (or null) per stage`, 'curves');
  for (let i = 0; i < N - 1; i++) if (!(num(Tic[i]) && Tic[i] > 0)) fail('MB_TRAIN_T', `${label}: intercooler_T_K is required for the intercoolers (stage 1–${N - 1})`, 'intercooler_T_K');
  const after = num(p.aftercooler_T_K) ? p.aftercooler_T_K : null;
  if (after !== null && !(after > 0)) fail('MB_TRAIN_T', `${label}: aftercooler_T_K must be > 0`, 'aftercooler_T_K');
  // discharge pressures
  let Pd;
  if (Array.isArray(p.stage_P_out_bar)) {
    Pd = listOr(p.stage_P_out_bar, N, NaN, label, 'stage_P_out_bar');
  } else if (!curves) {
    if (!(num(p.P_out_bar) && p.P_out_bar > Pin)) fail('MB_TRAIN_P', `${label}: P_out_bar (final discharge) must exceed the suction pressure ${Pin.toFixed(3)} bar`, 'P_out_bar');
    // equal ratio r with the cooler drops: suction_{i+1} = r·suction_i − dp_i
    const last = (r) => { let ps = Pin; for (let i = 0; i < N; i++) { const pd = ps * r; if (i === N - 1) return pd; ps = pd - dp[i]; if (!(ps > 0)) return -1; } return -1; };
    let lo = 1, hi = Math.pow(p.P_out_bar / Pin, 1 / N) * 2 + 1;
    for (let k = 0; k < 40 && last(hi) < p.P_out_bar; k++) hi *= 2;
    for (let k = 0; k < 200; k++) { const m = 0.5 * (lo + hi); if (last(m) < p.P_out_bar) lo = m; else hi = m; if (hi - lo < 1e-13) break; }
    const r = 0.5 * (lo + hi);
    Pd = []; let ps = Pin;
    for (let i = 0; i < N; i++) { Pd.push(ps * r); ps = ps * r - dp[i]; }
    Pd[N - 1] = p.P_out_bar;
  }
  // stage by stage
  let s = streams[0];
  const stages = [], liquids = [], warnings = [];
  let W = 0;
  for (let i = 0; i < N; i++) {
    const cp = { property_package: p.property_package, mode };
    if (curves && curves[i]) { cp.curve = curves[i]; if (Array.isArray(p.speed_rpm)) cp.speed_rpm = p.speed_rpm[i]; else if (num(p.speed_rpm)) cp.speed_rpm = p.speed_rpm; }
    else {
      if (!Pd) fail('MB_TRAIN_P', `${label}: stage ${i + 1} has no curve — give stage_P_out_bar or a curve for every stage`, 'curves');
      cp.P_out_bar = Pd[i]; cp.efficiency = eff[i];
      if (!(Pd[i] > s.P_bar)) fail('MB_TRAIN_P', `${label}: stage ${i + 1} discharge ${Pd[i].toFixed(3)} bar does not exceed its suction ${s.P_bar.toFixed(3)} bar`, 'stage_P_out_bar');
    }
    const c = call(U.compressor, { streams: [s], params: cp }, `stage ${i + 1} compressor`);
    const d = c.details;
    W += c.energy_balance.W_kW;
    const row = { stage: i + 1, P_suction_bar: s.P_bar, T_suction_K: s.T_K, P_discharge_bar: d.P_out_bar, T_discharge_K: d.T_out_K, pressure_ratio: d.pressure_ratio,
      power_kW: d.power_kW, efficiency: d.efficiency, mode: d.mode, inlet_volume_m3_h: d.inlet_volume_m3_h };
    if (d.curve) Object.assign(row, { surge_margin_pct: d.curve.surge_margin_pct, surge: d.curve.surge, head_kJkg: d.curve.head_kJkg });
    for (const x of c.warnings || []) warnings.push(`stage ${i + 1}: ${x}`);
    s = c.streams_out[0];
    const Tc = i < N - 1 ? Tic[i] : after;
    if (Tc !== null && num(Tc)) {
      const hp = { property_package: p.property_package, T_out_K: Tc };
      if (dp[i] > 0) hp.dp_bar = dp[i];
      const h = call(U.heater, { streams: [s], params: hp }, `stage ${i + 1} cooler`);
      row.cooler_duty_kW = h.details.duty_kW; row.T_cooled_K = Tc;
      if (Tc > row.T_discharge_K) warnings.push(`stage ${i + 1}: the cooler outlet (${(Tc - 273.15).toFixed(1)} °C) is above the discharge temperature — it heats`);
      const f = call(U.flash, { streams: h.streams_out, params: { property_package: p.property_package, duty_kW: 0 } }, `stage ${i + 1} knock-out`);
      const [gv, gl] = f.streams_out;
      row.condensate_kg_h = gl.mass_flow_kg_h;
      if (gl.mass_flow_kg_h > 0) liquids.push(gl);
      s = gv.mass_flow_kg_h > 0 ? gv : h.streams_out[0];
      if (!(gv.mass_flow_kg_h > 0)) warnings.push(`stage ${i + 1}: everything condenses in the cooler — the gas is fully liquefied`);
    }
    if (i === 0 && row.T_discharge_K > 473.15) warnings.push(`stage 1: discharge ${(row.T_discharge_K - 273.15).toFixed(0)} °C — above the usual 150–200 °C limit; add a stage`);
    else if (row.T_discharge_K > 473.15) warnings.push(`stage ${i + 1}: discharge ${(row.T_discharge_K - 273.15).toFixed(0)} °C — above the usual 150–200 °C limit`);
    stages.push(row);
  }
  // combined condensate (drain header at the lowest drum pressure)
  let cond;
  if (liquids.length) cond = call(U.mixer, { streams: liquids, params: { property_package: p.property_package } }, 'condensate header').streams_out[0];
  else cond = Object.assign({}, s, { mass_flow_kg_h: 0, vapour_fraction: 0 });
  const Hin = K.stateIn(K.pkg(p.property_package, K.keysOf(streams[0])), streams[0], `${label} inlet`).H_kJh;
  const Hout = s.H_kJh + (liquids.length ? cond.H_kJh : 0);
  const Qc = stages.reduce((a, r) => a + (num(r.cooler_duty_kW) ? r.cooler_duty_kW : 0), 0);
  const details = {
    stages, total_power_kW: W, total_cooling_kW: Qc, condensate_kg_h: liquids.reduce((a, l) => a + l.mass_flow_kg_h, 0),
    overall_pressure_ratio: s.P_bar / Pin, P_out_bar: s.P_bar, T_out_K: s.T_K, mode, power_kW: W, unit_version: MACHINES_VERSION,
  };
  const out = [s, cond];
  return K.result(out, streams[0].mass_flow_kg_h, Hin, Hout, W, details, [...new Set(warnings)]);
}

export const MACHINE_MODULES = { 'r-compressor-train': solveTrain };
export default { MACHINES_VERSION, MACHINE_MODULES };
