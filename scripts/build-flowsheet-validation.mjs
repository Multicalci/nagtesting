// ============================================================================
// REPO PATH: scripts/build-flowsheet-validation.mjs
// ============================================================================
// multicalci.com — builds flowsheet-validation.html (Step 21, extended in Steps 22–24;
// STEP 32: the Peng–Robinson, ammonia-loop, wet-gas and recycle checks run the
// DEFAULT rigorous path — property method Peng–Robinson with free water — and
// new sections cover free water, gas solubility, flash convergence and the
// energy-balance reconciliation).
// Every engine number on the page is produced HERE by running the engine;
// every reference number comes from tests/validation-references.json
// (computed outside the engine — open-source thermo 0.6.1, DWSIM 9.0.5,
// CoolProp 8.0).
// Nothing is typed into the page by hand.
//
//   node scripts/build-flowsheet-validation.mjs
//
// Plain ES module, no dependencies. (c) multicalci.com
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import engineModule from '../api/_lib/mb-engine.js';
import compdb from '../api/_lib/mb-compdb.js';
import thermoModule from '../api/_lib/mb-thermo.js';
import steamModule from '../api/_lib/steam-if97.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = engineModule.default || engineModule;
const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/validation-references.json'), 'utf8'));
const OUT = path.join(ROOT, 'flowsheet-validation.html');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x, d) => (typeof x === 'number' && isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const sci = (x) => (x === 0 ? '0' : x.toExponential(1));
const sub = (s) => esc(s).replace(/([A-Za-z\)])(\d+)/g, (_m, a, n) => a + '<sub>' + n + '</sub>');
const feedMol = (zs, T, P) => {
  let m = 0; const ms = {};
  for (const k in zs) { ms[k] = zs[k] * 100 * engine.resolve(k).mw; m += ms[k]; }
  return { mass_flow_kg_h: m, T_K: T, P_bar: P, components: Object.keys(ms).map((k) => ({ key: k, mass_fraction: ms[k] / m })) };
};
const fail = (m) => { console.error('BUILD FAILED: ' + m); process.exit(1); };

/* ---------- A. Peng–Robinson flash vs thermo — the DEFAULT rigorous path (r-flash, PR) ---------- */
const prRows = [];
const ENG = {};          // classic flash drum (Methods → Classic) — STEP 33: on the same PR package as the rigorous flash
const ENGR = {};         // rigorous flash with the default property method
let prWorst = 0;
const PRR = REF.pr_rig.cases;
const engXYR = (r) => {
  const V = r.streams_out[0], L = r.streams_out[1];
  const vf = r.details.vapour_fraction;
  const keys = Object.keys((V.rig && V.rig.y) || (L.rig && L.rig.x) || {});
  return { vf, x: (L.rig && L.rig.x) || {}, y: (V.rig && V.rig.y) || {}, keys };
};
for (const [id, c] of Object.entries(REF.pr)) {
  const rc = engine.runModule('flash', { streams: [feedMol(c.zs, c.T_K, c.P_bar)], params: { T_K: c.T_K, P_bar: c.P_bar, model: 'pr' } });
  if (rc.error) fail(id + ' (classic): ' + rc.error.message);
  ENG[id] = rc;
  const r = engine.runModule('r-flash', { streams: [feedMol(c.zs, c.T_K, c.P_bar)], params: { T_K: c.T_K, P_bar: c.P_bar, property_package: { model: 'pr' } } });
  if (r.error) fail(id + ': ' + r.error.message);
  const e = engXYR(r);
  ENGR[id] = e;
  const ref = PRR[id].ref;
  const keys = Object.keys(c.zs);
  let dx = 0, dy = 0;
  if (ref.x) for (const k of keys) { dx = Math.max(dx, Math.abs((e.x[k] || 0) - ref.x[k])); dy = Math.max(dy, Math.abs((e.y[k] || 0) - ref.y[k])); }
  const dv = Math.abs(e.vf - ref.vf);
  prWorst = Math.max(prWorst, dv, dx, dy);
  prRows.push(`<tr><td>${esc(id)}</td><td class="l">${esc(c.desc)}<small>${keys.map(sub).join(' · ')}</small></td><td>${f(c.T_K - 273.15, 2)}</td><td>${f(c.P_bar, 0)}</td>
    <td>${f(e.vf, 5)}</td><td>${f(ref.vf, 5)}</td><td>${sci(dv)}</td><td>${ref.x ? sci(dx) : '—'}</td><td>${ref.x ? sci(dy) : '—'}</td></tr>`);
}
if (prWorst > 2e-4) fail('rigorous PR vs thermo differs by ' + prWorst);
/* ---------- A2. Peng–Robinson flash vs DWSIM ---------- */
const DW = REF.dwsim;
const engXY = (r) => ({ vf: r.details.psi_VF, x: Object.fromEntries(r.details.x.map((o) => [o.key, o.x])), y: Object.fromEntries(r.details.y.map((o) => [o.key, o.y])) });
const diffs = (e, d, keys) => {
  const out = { dv: Math.abs(e.vf - d.vf), dx: null, dy: null };
  if (d.x && e.vf > 0 && e.vf < 1) { out.dx = 0; out.dy = 0; for (const k of keys) { out.dx = Math.max(out.dx, Math.abs(e.x[k] - d.x[k])); out.dy = Math.max(out.dy, Math.abs(e.y[k] - d.y[k])); } }
  return out;
};
// STEP 33 — the classic flash drum's Peng–Robinson now runs on mb-thermo's package (eos.js, with its
// effective H2 constants and short k_ij table, is retired): classic and rigorous must agree exactly
const dwRows = [];
let dwWorst = 0;
for (const [id, c] of Object.entries(REF.pr)) {
  const keys = Object.keys(c.zs), e = engXY(ENG[id]), d = ENGR[id];
  const q = diffs(e, d, keys);
  dwWorst = Math.max(dwWorst, q.dv, q.dx || 0, q.dy || 0);
  dwRows.push(`<tr><td>${esc(id)}</td><td class="l">${esc(c.desc)}</td><td>${f(e.vf, 5)}</td><td>${f(d.vf, 5)}</td><td>${sci(q.dv)}</td><td>${q.dx == null ? '—' : sci(q.dx)}</td><td>${q.dy == null ? '—' : sci(q.dy)}</td></tr>`);
}
if (dwWorst > 5e-5) fail('classic PR flash differs from the rigorous PR flash by ' + dwWorst);
// DWSIM with its own data — the ammonia-loop cases, in plant units
const pct = (v) => f(v * 100, 3);
const nhRows = [];
for (const [id, label] of [['PR3', 'Separator, −20 °C / 140 bar'], ['PR6', 'Let-down drum, 10 °C / 20 bar']]) {
  const e = ENGR[id], d = DW.cases[id].dwsim_data;
  const row = (name, a, b, unit) => `<tr><td class="l">${name}</td><td>${a}</td><td>${b}</td><td>${unit}</td></tr>`;
  nhRows.push(`<tr><th class="l" colspan="4">${esc(id)} · ${esc(label)}</th></tr>`);
  nhRows.push(row('Vapour fraction (mol/mol)', f(e.vf, 4), f(d.vf, 4), ''));
  nhRows.push(row('NH₃ in vapour', pct(e.y.NH3), pct(d.y.NH3), 'mol %'));
  nhRows.push(row('H₂ dissolved in liquid', pct(e.x.H2), pct(d.x.H2), 'mol %'));
  nhRows.push(row('N₂ dissolved in liquid', pct(e.x.N2), pct(d.x.N2), 'mol %'));
}
const dk = DW.cases.PR3.dwsim_data.kij, dc = DW.cases.PR3.dwsim_data.crit;
const PR3c = PRR.PR3, k3 = Object.keys(REF.pr.PR3.zs);
const kijE = (pair) => { const [a, b] = pair.split('|'); return PR3c.kij[k3.indexOf(a)][k3.indexOf(b)]; };
const iH2 = k3.indexOf('H2');
const kijRows = ['H2|N2', 'N2|NH3', 'Ar|NH3', 'CH4|N2', 'CH4|H2', 'H2|NH3', 'CH4|NH3']
  .map((p) => `<tr><td class="l">k<sub>ij</sub> ${sub(p.replace('|', '–'))}</td><td>${f(kijE(p), 4)}</td><td>${f(dk[p], 4)}</td></tr>`);
kijRows.unshift(`<tr><td class="l">H₂ T<sub>c</sub> / P<sub>c</sub> / ω</td><td>${f(PR3c.Tc[iH2], 2)} K / ${f(PR3c.Pc_Pa[iH2] / 1e5, 2)} bar / ${f(PR3c.omega[iH2], 3)}</td><td>${f(dc.H2[0], 2)} K / ${f(dc.H2[1], 2)} bar / ${f(dc.H2[2], 3)}</td></tr>`);
const e3 = ENGR.PR3, d3 = DW.cases.PR3.dwsim_data;
const kijDiff = ['H2|N2', 'N2|NH3', 'Ar|NH3', 'CH4|N2', 'CH4|H2', 'H2|NH3', 'CH4|NH3'].filter((p) => Math.abs(kijE(p) - dk[p]) > 1e-4);
const dwVer = DW.version.match(/\d+\.\d+\.\d+/)[0];
/* ---------- B. NRTL activity coefficients vs thermo ---------- */
const nrRows = [];
let nrWorst = 0;
for (const [id, c] of Object.entries(REF.nrtl.cases)) {
  const r = engine.runModule('flash', { streams: [feedMol(c.zs, c.T_K, c.P_bar)], params: { T_K: c.T_K, P_bar: c.P_bar, model: 'nrtl', nrtl: { pairs: REF.nrtl.pairs } } });
  if (r.error) fail(id + ': ' + r.error.message);
  if (Math.abs(r.details.x[0].x - c.x_EtOH) > 1e-6) fail(id + ': liquid composition drifted from the reference point');
  const g = r.details.gamma.map((o) => o.gamma);
  const d = Math.max(Math.abs(g[0] - c.gamma[0]), Math.abs(g[1] - c.gamma[1]));
  nrWorst = Math.max(nrWorst, d);
  nrRows.push(`<tr><td>${esc(id)}</td><td class="l">Ethanol–water, ${f(c.T_K - 273.15, 2)} °C, 1 atm</td><td>${f(c.x_EtOH, 4)}</td>
    <td>${f(g[0], 6)} / ${f(g[1], 6)}</td><td>${f(c.gamma[0], 6)} / ${f(c.gamma[1], 6)}</td><td>${sci(d)}</td></tr>`);
}
/* ---------- C. wet-gas energy balance vs CoolProp ---------- */
const wf = (n, T, P) => { let m = 0; const ms = {}; for (const k in n) { ms[k] = n[k] * engine.resolve(k).mw; m += ms[k]; } return { mass_flow_kg_h: m, T_K: T, P_bar: P, components: Object.keys(ms).map((k) => ({ key: k, mass_fraction: ms[k] / m })) }; };
const ko = engine.runModule('flowsheet', { streams: [wf({ N2: 75, H2O: 20, CO2: 5 }, 423.15, 5), wf({ N2: 20 }, 298.15, 5)], params: {
  property_package: { model: 'pr' },
  blocks: [{ id: 'm', name: 'M1', module: 'r-mixer', n_in: 2, n_out: 1 }, { id: 'e', name: 'E1', module: 'heater', n_in: 1, n_out: 1, params: { T_out_K: 313.15 } },
    { id: 'f', name: 'F1', module: 'r-flash', n_in: 1, n_out: 2, params: { T_K: 313.15, P_bar: 4.8 } }],
  streams: [{ id: 's1', from: null, to: { b: 'm', p: 0 }, feed: 0 }, { id: 's2', from: null, to: { b: 'm', p: 1 }, feed: 1 },
    { id: 's3', from: { b: 'm', p: 0 }, to: { b: 'e', p: 0 } }, { id: 's4', from: { b: 'e', p: 0 }, to: { b: 'f', p: 0 } },
    { id: 'g', from: { b: 'f', p: 0 }, to: null }, { id: 'c', from: { b: 'f', p: 1 }, to: null }] } });
if (ko.error) fail('wet gas: ' + ko.error.message);
const koOff = engine.runModule('flowsheet', { streams: [wf({ N2: 75, H2O: 20, CO2: 5 }, 423.15, 5), wf({ N2: 20 }, 298.15, 5)], params: {
  property_package: { model: 'pr', free_water: false },
  blocks: [{ id: 'm', name: 'M1', module: 'r-mixer', n_in: 2, n_out: 1 }, { id: 'e', name: 'E1', module: 'heater', n_in: 1, n_out: 1, params: { T_out_K: 313.15 } },
    { id: 'f', name: 'F1', module: 'r-flash', n_in: 1, n_out: 2, params: { T_K: 313.15, P_bar: 4.8 } }],
  streams: [{ id: 's1', from: null, to: { b: 'm', p: 0 }, feed: 0 }, { id: 's2', from: null, to: { b: 'm', p: 1 }, feed: 1 },
    { id: 's3', from: { b: 'm', p: 0 }, to: { b: 'e', p: 0 } }, { id: 's4', from: { b: 'e', p: 0 }, to: { b: 'f', p: 0 } },
    { id: 'g', from: { b: 'f', p: 0 }, to: null }, { id: 'c', from: { b: 'f', p: 1 }, to: null }] } });
if (koOff.error) fail('wet gas (no free water): ' + koOff.error.message);
const koQoff = koOff.energy_balance.Q_kW;
const W = REF.wetgas;
const koQ = ko.energy_balance.Q_kW, koC = ko.stream_results.c.mass_flow_kg_h;
const koDev = Math.abs(koQ - W.Q_kW) / Math.abs(W.Q_kW) * 100;
/* ---------- D. flowsheet solver ---------- */
const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/mb-vectors.json'), 'utf8')).vectors;
const vec = (id) => { const v = V.find((x) => x.id === id); if (!v) fail('missing vector ' + id); return v; };
const spec = engine.runModule(...vec('MB-099').args);
if (spec.error) fail('MB-099: ' + spec.error.message);
const airRef = vec('MB-099').expect['specs.0.varied'];
const rec = engine.runModule(...vec('MB-100').args);
if (rec.error) fail('MB-100: ' + rec.error.message);
const two = engine.runModule(...vec('MB-101').args);
if (two.error) fail('MB-101: ' + two.error.message);
const recR = rec.stream_results.rcy.mass_flow_kg_h, recP = rec.stream_results.pur.mass_flow_kg_h;

/* ---------- E. Step 22: rigorous property packages, VLLE, columns, Gibbs ---------- */
const getP = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const runVec = (id) => {
  const v = vec(id);
  if (v.call === 'combine') {                     // sum of engine results (e.g. an integral heat of absorption from three enthalpies)
    let value = 0;
    for (const t of v.args.terms) { const q = engine[t.fn](...t.args); if (q.error) fail(id + ': ' + q.error.message); value += t.coef * getP(q, t.field); }
    return { v, r: { value } };
  }
  const r = engine.runModule(...v.args); if (r.error) fail(id + ': ' + r.error.message); return { v, r };
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => 'MB-' + String(a + i).padStart(3, '0'));
const tolOf = (v, k) => (typeof v.tol === 'number' ? v.tol : (v.tol[k] !== undefined ? v.tol[k] : v.tol.default));
const NICE = {
  'details.critical.T_K': 'critical temperature, K', 'details.critical.P_bar': 'critical pressure, bar', 'details.cricondentherm.T_K': 'cricondentherm, K',
  'details.rows.0.phases.vapour.rho_kgm3': 'vapour density, kg/m³', 'details.rows.0.phases.vapour.Z': 'vapour Z', 'details.rows.0.vapour_fraction': 'vapour fraction',
  'details.azeotropes.0.x1': 'azeotrope x₁ (heteroazeotrope: vapour y₁)', 'details.azeotropes.0.T_K': 'azeotrope T, K', 'details.bubble.5.T_K': 'bubble T at x₁ = 0.5, K',
  'details.bubble.5.y1': 'y₁ at x₁ = 0.5', 'details.azeotropes.length': 'number of azeotropes', 'details.three_phase.T_K': 'three-phase T, K',
  'details.three_phase.x1_light': 'light liquid x₁', 'details.three_phase.x1_heavy': 'heavy liquid x₁', 'details.three_phase.y1': 'vapour y₁',
  'details.conversion.C2H6': 'conversion of C2H6', 'details.conversion.C2H4': 'conversion of C2H4', 'details.T_out_K': 'outlet T, K', 'details.T_K': 'reactor T, K',
  'details.steady_states.length': 'steady states found', 'details.steady_states.1.T_K': 'middle steady state T, K', 'details.steady_states.2.T_K': 'upper steady state T, K',
  'energy_balance.Q_kW': 'duty, kW', 'details.conversion.1-butene': 'conversion', 'details.conversion.CH4': 'conversion of CH4',
  'details.outlet_mole_frac.CO2': 'outlet y CO2', 'details.outlet_mole_frac.CO': 'outlet y CO', 'details.rows.0.H_kJkmol': 'liquid enthalpy at 25 °C, kJ/kmol',
  'details.heat_of_reaction.0.dH_kJmol': 'heat of reaction, kJ/mol',
  'details.vapour_fraction': 'vapour fraction', 'details.T_out_K': 'T (bubble / dew), K', 'details.light_liquid_fraction': 'light-liquid fraction',
  'details.heavy_liquid_fraction': 'heavy-liquid fraction', 'details.condenser_duty_kW': 'condenser duty, kW', 'details.reboiler_duty_kW': 'reboiler duty, kW',
  'details.rows.0.phases.liquid.acid_gas.density_kg_m3': 'liquid density, kg/m³', 'details.rows.0.phases.liquid.mu_cP': 'liquid viscosity, cP',
  'details.rows.0.phases.liquid.acid_gas.P_CO2_eq_kPa': 'equilibrium CO₂ pressure, kPa', 'details.rows.0.phases.liquid.acid_gas.true_mole_fractions.MEACOO-': 'carbamate true mole fraction',
  'details.rows.0.phases.liquid.acid_gas.water_activity': 'water activity', 'details.rows.0.phases.liquid.Cp_kJkgK': 'liquid Cp, kJ/kg·K', 'details.rows.0.phases.liquid.rho_kgm3': 'liquid density, kg/m³',
  'details.P_bar': 'bubble pressure, bar', 'details.duty_kW': 'heat released, kW', 'details.profile.0.y.benzene': 'top vapour y benzene', 'details.profile.0.T_K': 'condenser T, K',
};
const STEAM_NICE = {
  'details.duty_kW': 'heater duty, kW', 'streams_out.0.vapour_fraction': 'outlet vapour fraction', 'streams_out.0.rig.props.phases.0.rho_kgm3': 'outlet density, kg/m³',
  'streams_out.0.rig.props.phases.0.Cp_kJkgK': 'outlet cp, kJ/kg·K', 'streams_out.0.rig.props.phases.0.mu_cP': 'outlet viscosity, cP', 'streams_out.0.rig.props.phases.0.k_WmK': 'outlet conductivity, W/m·K',
  'streams_out.0.rig.props.rho_kgm3': 'outlet density, kg/m³', 'details.power_kW': 'shaft power, kW', 'details.vapour_fraction_out': 'exhaust quality (vapour fraction)',
  'details.T_out_K': 'outlet T, K', 'details.steam_rate_kg_kWh': 'steam rate, kg/kWh', 'details.efficiency': 'efficiency (calculated)', 'details.power_hp_kW': 'HP-section power, kW',
  'details.power_lp_kW': 'LP-section power, kW', 'details.T_extract_K': 'extraction T, K', 'streams_out.0.mass_flow_kg_h': 'extraction flow, kg/h', 'streams_out.1.mass_flow_kg_h': 'exhaust flow, kg/h',
  'mass_balance.closure_pct': 'mass closure, %', 'energy_balance.Q_kW': 'energy-balance residual, kW', 'details.rho_kgm3': 'inlet density, kg/m³', 'details.isentropic_power_kW': 'isentropic power, kW',
  'block_results.b1.result.details.power_kW': 'turbine power, kW', 'block_results.b1.result.details.vapour_fraction_out': 'turbine exhaust quality', 'block_results.b2.result.details.duty_kW': 'condenser duty, kW',
  'block_results.b3.result.details.power_kW': 'pump power, kW', 'stream_results.s5.T_K': 'feed-water T, K', 'stream_results.s2.T_K': 'process-steam T, K',
};
const MDEA_NICE = {
  'details.P_bar': 'bubble pressure, bar (thesis condition 1.10)', 'value': 'heat of absorption, kJ/kmol CO2',
  'details.rows.0.phases.liquid.acid_gas.P_CO2_eq_kPa': 'equilibrium CO₂ pressure, kPa',
  'details.rows.0.phases.liquid.acid_gas.true_mole_fractions.MDEA': 'true x MDEA', 'details.rows.0.phases.liquid.acid_gas.true_mole_fractions.MDEAH+': 'true x MDEAH⁺',
  'details.rows.0.phases.liquid.acid_gas.true_mole_fractions.HCO3-': 'true x HCO₃⁻', 'details.rows.0.phases.liquid.acid_gas.true_mole_fractions.CO3--': 'true x CO₃²⁻',
  'details.rows.0.phases.liquid.acid_gas.true_mole_fractions.CO2': 'true x CO₂(aq)',
};
const AMDEA_NICE = { 'details.P_bar': 'bubble pressure, bar', 'details.rows.0.phases.liquid.acid_gas.P_CO2_eq_kPa': 'equilibrium CO₂ pressure, kPa', 'details.rows.0.phases.liquid.rho_kgm3': 'liquid density, kg/m³' };
const qName = (k) => NICE[k] || k.replace(/^details\./, '').replace(/^streams_out\.0\.rig\.x\./, 'distillate x ').replace(/^streams_out\.1\.rig\.x\./, 'bottoms x ')
  .replace(/^x1\./, 'light liquid x ').replace(/^x2\./, 'heavy liquid x ').replace(/^y\./, 'vapour y ').replace(/^outlet_mole_frac\./, 'outlet y ');
let s22Worst = { flash: 0, three: 0, colPct: 0, colX: 0, gibbs: 0, env: 0, bin: 0, kin: 0, lhhw: 0, assocH: 0, steamRel: 0 }, s22N = 0, s22Pass = 0, s23N = 0, s23Pass = 0, s24N = 0, s24Pass = 0, s25N = 0, s25Pass = 0, s26N = 0, s26Pass = 0, s27N = 0, s27Pass = 0, s28N = 0, s28Pass = 0;
const vecTable = (ids, kind) => {
  const rows = [];
  for (const id of ids) {
    const { v, r } = runVec(id);
    const keys = Object.keys(v.expect).filter((k) => typeof v.expect[k] === 'number' && k !== 'details.element_balance_max_rel');
    const s23 = +id.slice(3) >= 143 && +id.slice(3) < 165, s24 = +id.slice(3) >= 165 && +id.slice(3) < 175, s25 = +id.slice(3) >= 175 && +id.slice(3) < 196, s26 = +id.slice(3) >= 196 && +id.slice(3) < 208, s27 = +id.slice(3) >= 208 && +id.slice(3) < 219, s28 = +id.slice(3) >= 219;
    keys.forEach((k, i) => {
      const a = getP(r, k), e = v.expect[k];
      const d = Math.abs(a - e), tol = tolOf(v, k);
      if (!(d <= tol)) fail(id + ' ' + k + ': ' + a + ' vs ' + e);
      if (s28) { s28N++; s28Pass++; } else if (s27) { s27N++; s27Pass++; } else if (s26) { s26N++; s26Pass++; if (e !== 0) s22Worst.steamRel = Math.max(s22Worst.steamRel, d / Math.abs(e)); } else if (s25) { s25N++; s25Pass++; } else if (s24) { s24N++; s24Pass++; } else if (s23) { s23N++; s23Pass++; } else { s22N++; s22Pass++; }
      if (kind === 'lhhw' && /conversion|outlet_mole_frac/.test(k)) s22Worst.lhhw = Math.max(s22Worst.lhhw, d);
      if (kind === 'assoc' && /H_kJkmol/.test(k)) s22Worst.assocH = Math.max(s22Worst.assocH, d / 1000);
      if (kind === 'env' && /T_K/.test(k)) s22Worst.env = Math.max(s22Worst.env, d);
      if (kind === 'bin' && /T_K/.test(k)) s22Worst.bin = Math.max(s22Worst.bin, d);
      if (kind === 'kin' && /conversion|outlet_mole_frac/.test(k) && !/MB-16[12]/.test(id)) s22Worst.kin = Math.max(s22Worst.kin, d);
      const pct = /duty/.test(k) ? d / Math.abs(e) * 100 : null;
      if (kind === 'flash') s22Worst.flash = Math.max(s22Worst.flash, /T_out_K/.test(k) ? 0 : d);
      if (kind === 'three') s22Worst.three = Math.max(s22Worst.three, d);
      if (kind === 'col') { if (pct !== null) s22Worst.colPct = Math.max(s22Worst.colPct, pct); else s22Worst.colX = Math.max(s22Worst.colX, d); }
      if (kind === 'gibbs') s22Worst.gibbs = Math.max(s22Worst.gibbs, d);
      const dig = Number.isInteger(e) && Math.abs(e) < 100 && !/T_K|T_out/.test(k) ? 0 : Math.abs(e) >= 100 ? 2 : Math.abs(e) >= 10 ? 3 : 6;
      rows.push(`<tr>${i === 0 ? `<td rowspan="${keys.length}">${esc(id)}</td><td class="l" rowspan="${keys.length}">${esc(v.desc)}</td>` : ''}<td class="l">${sub(kind === 'kin' && k === 'details.T_out_K' ? 'outlet T, K' : (kind === 'steam' && STEAM_NICE[k]) || (kind === 'mdea' && MDEA_NICE[k]) || (kind === 'amdea' && AMDEA_NICE[k]) || qName(k))}</td><td>${f(a, dig)}</td><td>${f(e, dig)}</td><td>${pct !== null ? f(pct, 3) + ' %' : sci(d)}</td></tr>`);
    });
  }
  return rows.join('\n');
};
const colTable = vecTable(range(104, 107), 'col');
const threeTable = vecTable(range(108, 116), 'three');
const gibbsTable = vecTable(['MB-117', 'MB-163', 'MB-164'], 'gibbs');
const envTable = vecTable(range(143, 146), 'env');
const ptTable = vecTable(['MB-147'], 'pt');
const binTable = vecTable(range(148, 152), 'bin');
const kinTable = vecTable(range(153, 162), 'kin');
const lhhwTable = vecTable(range(165, 168), 'lhhw');
const assocTable = vecTable(range(169, 174), 'assoc');
const flashTable = vecTable(range(118, 142), 'flash');
/* ---------- F. Step 25: acid-gas electrolyte packages and tray efficiencies ---------- */
const meaTable = vecTable(['MB-175', 'MB-176', 'MB-181'], 'mea');
const arshTable = vecTable(range(177, 180), 'arsh');
const k2Table = vecTable(range(182, 185), 'k2');
const armandTable = vecTable(range(186, 188), 'armand');
const murphTable = vecTable(range(189, 190), 'murph');
const edgeTable = vecTable(range(193, 195), 'edge');
/* ---------- G. Step 26: IAPWS-IF97 steam package, turbines and compressors ---------- */
const steamTable = vecTable([...range(196, 204), 'MB-207'], 'steam');
const R25 = REF.step25;
const molS = (mol, T, P) => { const ks = Object.keys(mol); const m = ks.map((k) => mol[k] * compdb.get(k).mw); const t = m.reduce((a, b) => a + b, 0); return { mass_flow_kg_h: t, T_K: T, P_bar: P, components: ks.map((k, i) => ({ key: k, mass_fraction: m[i] / t })) }; };
/* ---------- G2. Step 27: aqueous MDEA, Extended UNIQUAC (Sadegh 2013) ---------- */
const mdeaTable = vecTable(range(208, 218), 'mdea');
const amdeaTable = vecTable(range(219, 224), 'amdea');
const R27 = REF.step27;
const num = (x) => typeof x === "number" && Number.isFinite(x);
const KMD = 'methyl-diethanolamine';
const mdeaBubble = (wt, al, T) => {
  const a = wt / 100 / 0.1191622, w = (1 - wt / 100) / 0.01801528;
  const r = engine.runModule('r-flash', { streams: [molS({ H2O: w, [KMD]: a, CO2: al * a }, T, 5)], params: { property_package: { model: 'amine-mdea' }, T_K: T, vapour_fraction: 0 } });
  if (r.error) throw new Error(r.error.message);
  return r.details.P_bar;
};
const mdeaLoading = (wt, T) => {               // loading at 110 kPa total pressure (bisection on the bubble pressure)
  let lo = 1e-4, hi = 1.4;
  if (mdeaBubble(wt, lo, T) > 1.1 || mdeaBubble(wt, hi, T) < 1.1) return NaN;
  for (let k = 0; k < 40; k++) { const m = 0.5 * (lo + hi); if (mdeaBubble(wt, m, T) > 1.1) hi = m; else lo = m; if (hi - lo < 2e-5) break; }
  return 0.5 * (lo + hi);
};
const mdeaRows = [];
let mdeaRepWorst = 0, mdeaRepN = 0;
const mdeaExp = {};
for (const [Tc, rows] of Object.entries(R27.loading_110kPa)) {
  const T = +Tc + 273.15;
  const o = mdeaExp[Tc] = { n: 0, dev: 0, nT: 0 };
  for (const [wt, meas, thesisModel] of rows) {
    let al;
    try { al = mdeaLoading(wt, T); } catch (_e) { al = NaN; }
    const dRep = Math.abs(al - thesisModel);
    if (num(al) && wt <= 80) { mdeaRepWorst = Math.max(mdeaRepWorst, dRep); mdeaRepN++; }
    if (num(al) && wt >= 20 && wt <= 80) { o.n++; o.dev += Math.abs(al - meas) / meas; o.nT += Math.abs(thesisModel - meas) / meas; }
    mdeaRows.push(`<tr><td>${Tc}</td><td>${f(wt, 2)}</td><td>${f(meas, 2)}</td><td>${f(thesisModel, thesisModel < 0.01 ? 3 : 2)}</td><td>${num(al) ? f(al, 3) : '—'}</td><td>${num(al) ? f(al - thesisModel, 3) : '—'}</td></tr>`);
  }
}
const mdeaExpRows = Object.entries(mdeaExp).map(([Tc, o]) => `<tr><td>${Tc}</td><td>${o.n}</td><td>${f(100 * o.dev / o.n, 1)} %</td><td>${f(100 * o.nT / o.n, 1)} %</td><td>${R27.model_aard_pct[Tc]} %</td></tr>`).join('\n');

/* ---------- G3. Step 28: activated MDEA (piperazine) — fitted species vs measured CO2 pressures ---------- */
const R28 = REF.step28;
const KPZ = 'piperazine';
const amP = (Tc, mM, mP, al) => {
  const T = Tc + 273.15, g = al * (mM + 2 * mP);
  const mol = mM > 0 ? { H2O: 1 / 0.01801528, [KMD]: mM, [KPZ]: mP, CO2: g } : { H2O: 1 / 0.01801528, [KPZ]: mP, CO2: g };
  const r = engine.runModule('property-table', { streams: [molS(mol, T, 30)], params: { property_package: { model: 'amine-mdea' }, vary: 'T', from: T, to: T + 1, points: 2, P_bar: 30 } });
  if (r.error) throw new Error('amine-mdea PZ: ' + r.error.message);
  return r.details.rows[0].phases.liquid.acid_gas.P_CO2_eq_kPa;
};
const AM_SETS = [
  ['chen72', '7 m MDEA / 2 m PZ', 'Chen (2011), Table 4.7', false, (r) => [r[0], 7, 2, r[1], r[2]]],
  ['chen55', '5 m MDEA / 5 m PZ', 'Chen (2011), Table 4.8', true, (r) => [r[0], 5, 5, r[1], r[2]]],
  ['xu72', '7:2 MDEA/PZ, 10.5–10.7 m alkalinity', 'Xu (2011), Table 2-8', false, (r) => [r[1], r[0] * 7 / 11, r[0] * 2 / 11, r[2], r[3]]],
  ['xu55', '5:5 MDEA/PZ, 14.4–14.6 m alkalinity', 'Xu (2011), Table 2-9', false, (r) => [r[1], r[0] / 3, r[0] / 3, r[2], r[3]]],
  ['xupz', 'aqueous PZ, 4.9–8.0 m', 'Xu (2011), Table 2-2', false, (r) => [r[1], 0, r[0], r[2], r[3]]],
];
const amSummary = [], amRows = [];
let amHeld = 0, amAllN = 0, amAllDev = 0;
for (const [key, label, src, held, conv] of AM_SETS) {
  let n = 0, dev = 0, bias = 0, mx = 0;
  const rows = [];
  for (const raw of R28[key]) {
    const [Tc, mM, mP, al, Pm] = conv(raw);
    const Pc = amP(Tc, mM, mP, al);
    const e = Pc / Pm - 1;
    n++; dev += Math.abs(e); bias += e; mx = Math.max(mx, Math.abs(e));
    rows.push(`<tr><td>${f(Tc, 0)}</td><td>${f(al, 3)}</td><td>${f(Pm, Pm < 10 ? 2 : 0)}</td><td>${f(Pc, Pc < 10 ? 2 : 0)}</td><td>${f(100 * e, 0)} %</td></tr>`);
  }
  amAllN += n; amAllDev += dev;
  if (held) amHeld = dev / n;
  amSummary.push(`<tr><td class="l">${esc(label)}</td><td class="l">${esc(src)}</td><td>${held ? '<b>held out</b>' : 'fitted'}</td><td>${n}</td><td>${f(100 * dev / n, 1)} %</td><td>${f(100 * bias / n, 1)} %</td><td>${f(100 * mx, 0)} %</td></tr>`);
  amRows.push(`<tr><td class="l" colspan="5"><b>${esc(label)}</b> · ${esc(src)}${held ? ' · held out of the fit' : ''}</td></tr>` + rows.join(''));
}
// aqueous-PZ correlation of Xu (2011) at absorber temperatures (regressed to five literature data sets)
const XC = R28.xu_pz_correlation;
const xuCorr = (Tc, al) => { const T = Tc + 273.15; return Math.exp(XC.a + XC.b / T + XC.c * al + XC.d * al * al + XC.e * al / T + XC.f * al * al / T) / 1000; };
const amCorrRows = [];
for (const Tc of [40, 60, 80]) for (const al of [0.25, 0.3, 0.35, 0.4]) {
  const Pm = xuCorr(Tc, al), Pc = amP(Tc, 0, 8, al);
  amCorrRows.push(`<tr><td>${Tc}</td><td>${f(al, 2)}</td><td>${f(Pm, 2)}</td><td>${f(Pc, 2)}</td><td>${f(100 * (Pc / Pm - 1), 0)} %</td></tr>`);
}
// density of the blends (Frailie 2014, Table C-1)
let amRhoWorst = 0;
for (const [mM, mP, Tc, al, rho] of R28.frailie_density.rows) {
  const T = Tc + 273.15, g = al * (mM + 2 * mP);
  const r = engine.runModule('property-table', { streams: [molS({ H2O: 1 / 0.01801528, [KMD]: mM, [KPZ]: mP, CO2: g }, T, 5)], params: { property_package: { model: 'amine-mdea' }, vary: 'T', from: T, to: T + 1, points: 2, P_bar: 5 } });
  if (r.error) throw new Error(r.error.message);
  amRhoWorst = Math.max(amRhoWorst, Math.abs(r.details.rows[0].phases.liquid.rho_kgm3 / (1000 * rho) - 1));
}// every measured MEA point (Arshad et al. 2014)
const arshRows = [], arshDev = { lo: [], hi: [] };
for (const pt of R25.arshad2014.points) {
  const r = engine.runModule('r-flash', { streams: [molS({ MEA: R25.arshad2014.MEA_mol_per_kg_water, H2O: 1000 / 18.01528, CO2: pt.CO2_mol_per_kg_water }, pt.T_K, 20)], params: { property_package: { model: 'amine-mea' }, T_K: pt.T_K, vapour_fraction: 0 } });
  if (r.error) fail('Arshad point: ' + r.error.message);
  const Pm = r.details.P_bar * 100, a = pt.CO2_mol_per_kg_water / R25.arshad2014.MEA_mol_per_kg_water, dev = (Pm - pt.P_total_kPa) / pt.P_total_kPa * 100;
  (a <= 0.45 ? arshDev.lo : arshDev.hi).push(Math.abs(dev));
  arshRows.push(`<tr><td>${f(pt.T_K - 273.15, 0)}</td><td>${f(a, 3)}</td><td>${f(pt.P_total_kPa, 1)}</td><td>${f(Pm, 1)}</td><td>${(dev >= 0 ? '+' : '') + f(dev, 1)} %</td></tr>`);
}
const aad = (v) => v.reduce((x, y) => x + y, 0) / v.length;
// PHREEQC grid (72 states)
const pqByT = {}, pqBeyond = [];
for (const g of R25.phreeqc_grid.points) {
  const T = g.T_C + 273.15;
  const r = engine.runModule('property-table', { streams: [molS({ H2O: 1000 / 18.01528, K2CO3: g.k_mol, CO2: g.g_mol }, T, 20)], params: { property_package: { model: 'hot-k2co3' }, vary: 'T', from: T, to: T + 1, points: 2, P_bar: 20 } });
  if (r.error) fail('PHREEQC point: ' + r.error.message);
  const ag = r.details.rows[0].phases.liquid.acid_gas;
  const dP = Math.abs(ag.P_CO2_eq_kPa / (g.P_CO2_atm * 101.325) - 1) * 100, dA = Math.abs(ag.water_activity - g.aw);
  if (ag.extrapolated) {
    // past the model's stability onset (KHCO3 would crystallise): reported, not graded
    pqBeyond.push(`<tr><td>${g.T_C}</td><td class="l">${f(g.wt_K2CO3 * 100, 0)} wt %, α = ${g.conversion}</td><td>${f(g.P_CO2_atm * 101.325, 2)}</td><td>${f(ag.P_CO2_eq_kPa, 2)}</td><td>${f(dP, 1)} %</td><td>${sci(dA)}</td></tr>`);
    continue;
  }
  const o = pqByT[g.T_C] = pqByT[g.T_C] || { n: 0, dP: 0, dA: 0, pmin: Infinity, pmax: 0 };
  o.n++; o.dP = Math.max(o.dP, dP); o.dA = Math.max(o.dA, dA); o.pmin = Math.min(o.pmin, g.P_CO2_atm * 101.325); o.pmax = Math.max(o.pmax, g.P_CO2_atm * 101.325);
}
const pqRows = Object.entries(pqByT).map(([T, o]) => `<tr><td>${T}</td><td>${o.n}</td><td>${f(o.pmin, 3)} – ${f(o.pmax, 0)}</td><td>${f(o.dP, 3)} %</td><td>${sci(o.dA)}</td></tr>`).join('\n');
const pqLow = Math.max(...Object.entries(pqByT).filter(([T]) => +T <= 90).map(([, o]) => o.dP)), pqHigh = Math.max(...Object.values(pqByT).map((o) => o.dP));
// Armand handbook: water activity, Cp, density
const armRows = [];
{
  const A = R25.armand;
  for (const [wt, mm] of Object.entries(A.vapour_pressure_20_5C_mmHg)) {
    if (wt === 'water') continue;
    const w = +wt / 100;
    const r = engine.runModule('property-table', { streams: [molS({ K2CO3: w / 0.1382055, H2O: (1 - w) / 0.01801528 }, 293.65, 1.01325)], params: { property_package: { model: 'hot-k2co3' }, vary: 'T', from: 293.65, to: 294.65, points: 2, P_bar: 1.01325 } });
    const e = mm / A.vapour_pressure_20_5C_mmHg.water, a = r.details.rows[0].phases.liquid.acid_gas.water_activity;
    armRows.push(`<tr><td class="l">water activity, ${wt} wt %, 20.5 °C</td><td>${f(a, 4)}</td><td>${f(e, 4)}</td><td>${(a >= e ? '+' : '') + f((a / e - 1) * 100, 1)} %</td></tr>`);
  }
  for (const [wt, cp] of Object.entries(A.cp_cal_gK)) {
    const w = +wt / 100;
    const r = engine.runModule('property-table', { streams: [molS({ K2CO3: w / 0.1382055, H2O: (1 - w) / 0.01801528 }, 308.15, 1.5)], params: { property_package: { model: 'hot-k2co3' }, vary: 'T', from: 308.15, to: 309.15, points: 2, P_bar: 1.5 } });
    const a = r.details.rows[0].phases.liquid.Cp_kJkgK, e = cp * 4.184;
    armRows.push(`<tr><td class="l">heat capacity, ${wt} wt %, 35 °C, kJ/kg·K</td><td>${f(a, 3)}</td><td>${f(e, 3)}</td><td>${(a >= e ? '+' : '') + f((a / e - 1) * 100, 1)} %</td></tr>`);
  }
  for (const [wt, row] of Object.entries(A.sg_vs_T_F)) {
    const w = +wt / 100;
    for (const [TF, sg] of Object.entries(row)) {
      const T = (+TF - 32) / 1.8 + 273.15;
      const r = engine.runModule('property-table', { streams: [molS({ K2CO3: w / 0.1382055, H2O: (1 - w) / 0.01801528 }, T, 1.5)], params: { property_package: { model: 'hot-k2co3' }, vary: 'T', from: T, to: T + 1, points: 2, P_bar: 1.5 } });
      const a = r.details.rows[0].phases.liquid.rho_kgm3, e = sg * A.water_density_60F_kgm3;
      armRows.push(`<tr><td class="l">density, ${wt} wt %, ${f((+TF - 32) / 1.8, 1)} °C, kg/m³</td><td>${f(a, 1)}</td><td>${f(e, 1)}</td><td>${(a >= e ? '+' : '') + f((a / e - 1) * 100, 2)} %</td></tr>`);
    }
  }
}
/* ---------- H. STEP 32: free water, gas solubility, flash convergence, energy reconciliation ---------- */
const th = thermoModule.default || thermoModule;
const steam97 = steamModule.default || steamModule;
const S32 = REF.step32;
const waterS = (kgh, T, P, extra) => Object.assign({ mass_flow_kg_h: kgh, T_K: T, P_bar: P, components: [{ key: 'H2O', mass_fraction: 1 }] }, extra || {});
const fwRun = (fw) => {
  const pp = { model: 'pr', free_water: fw };
  const run = (mod, st, prm) => { const r = engine.runModule(mod, { streams: [st], params: Object.assign({ property_package: pp }, prm) }); if (r.error) fail('free water ' + mod + ': ' + r.error.message); return r; };
  return {
    W1: run('heater', waterS(1000, 298.15, 10), { T_out_K: 473.15 }).details.duty_kW,
    W2: run('heater', waterS(1000, 298.15, 10), { duty_kW: 500 }).details.vapour_fraction_out,
    W3: run('heater', waterS(1000, 420, 4, { spec: 'PVF', vapour_fraction: 1 }), { vapour_fraction: 0 }).details.duty_kW,
    W4: run('heater', waterS(1000, 580, 100, { spec: 'PVF', vapour_fraction: 1 }), { vapour_fraction: 0 }).details.duty_kW,
    W5: run('valve', waterS(1000, 673.15, 40), { P_out_bar: 10 }).details.T_out_K - 273.15,
    W6: run('pump', waterS(1000, 303.15, 1), { P_out_bar: 100, efficiency: 0.75 }).details.power_kW,
    W7: (() => { const r = engine.runModule('r-flash', { streams: [feedMol({ N2: 0.5, H2O: 0.5 }, 313.15, 1.01325)], params: { property_package: pp, T_K: 313.15, P_bar: 1.01325 } });
      if (r.error) fail('free water W7: ' + r.error.message); return r.streams_out[0].rig.y.H2O * 101.325; })(),
  };
};
const FWon = fwRun(true), FWoff = fwRun(false);
const fwDig = { W1: 1, W2: 4, W3: 1, W4: 1, W5: 2, W6: 3, W7: 3 };
let fwWorst = 0, fwOffWorst = 0;
const fwRows = Object.entries(S32.water).map(([id, c]) => {
  const a = FWon[id], b = FWoff[id], e = c.value;
  const ra = Math.abs(a - e) / Math.abs(e) * 100, rb = Math.abs(b - e) / Math.abs(e) * 100;
  if (id !== 'W5' && id !== 'W7') { fwWorst = Math.max(fwWorst, ra); fwOffWorst = Math.max(fwOffWorst, rb); }   // W5 in K; W7 includes the real gas-phase enhancement
  const dev = (v, r) => (id === 'W5' ? (v - e >= 0 ? '+' : '') + f(v - e, 2) + ' K' : (v - e >= 0 ? '+' : '−') + f(r, 2) + ' %');
  return `<tr><td>${id}</td><td class="l">${esc(c.desc)}</td><td class="l">${esc(c.quantity)}</td><td>${f(a, fwDig[id])}</td><td>${dev(a, ra)}</td><td>${f(b, fwDig[id])}</td><td>${dev(b, rb)}</td><td>${f(e, fwDig[id])}</td></tr>`;
}).join('\n');
if (fwWorst > 0.5) fail('free water vs IAPWS-95 worst ' + fwWorst + ' %');
// Henry constants of gases in water: engine (infinite dilution in the property package) vs IAPWS G7-04
const khEngine = (g, T, fw) => {
  const pp = th.createPackage({ model: 'pr', free_water: fw }, [g, 'H2O']);
  const ig = pp.keys.indexOf(g), iw = pp.keys.indexOf('H2O');
  const P = steam97.psat(T) * 1e6, x = [0, 0]; x[iw] = 1;
  return Math.exp(pp.eos.state(T, P, x, 'L').lnphi[ig]) * P / 1e6;      // MPa
};
let khWorst = 0, khOffWorst = 0;
const khRows = Object.entries(S32.henry_MPa).map(([g, byT]) => {
  const cells = Object.entries(byT).map(([Tk, ref]) => {
    const T = +Tk, a = khEngine(g, T, true), b = khEngine(g, T, false);
    khWorst = Math.max(khWorst, Math.abs(a / ref - 1)); khOffWorst = Math.max(khOffWorst, Math.max(b / ref, ref / b));
    return `<td>${f(a, 0)}</td><td>${f(ref, 0)}</td><td>${f(b / ref, b / ref < 10 ? 1 : 0)}×</td>`;
  }).join('');
  return `<tr><td class="l">${sub(g)}</td>${cells}</tr>`;
}).join('\n');
if (khWorst > 1e-6) fail('Henry constants vs IAPWS G7-04 differ by ' + khWorst);
const khTemps = Object.keys(Object.values(S32.henry_MPa)[0]).map((T) => f(+T - 273.15, 0) + ' °C');
// flash convergence near a critical point: C1/C2/C3/nC5 scan, fugacity residual of every two-phase answer
const ncPP = th.createPackage({ model: 'pr' }, ['CH4', 'C2H6', 'C3H8', 'n-pentane']);
const ncZ = [0.80, 0.10, 0.06, 0.04];
let ncN = 0, ncTwo = 0, ncNewton = 0, ncUnconv = 0, ncWorst = 0;
for (let T = 200; T <= 260; T += 1) for (let P = 50e5; P <= 95e5; P += 1e5) {
  const r = th.flashPT(ncPP, ncZ, T, P); ncN++;
  if (r.converged === false) ncUnconv++;
  if (r.phase !== 'VL') continue;
  ncTwo++; if (r.iterations > 100) ncNewton++;
  const L = ncPP.eos.state(T, P, r.x, 'L'), Vv = ncPP.eos.state(T, P, r.y, 'V');
  for (let i = 0; i < 4; i++) ncWorst = Math.max(ncWorst, Math.abs(Math.log(r.x[i]) + L.lnphi[i] - Math.log(r.y[i]) - Vv.lnphi[i]));
}
if (ncUnconv || ncWorst > 1e-8) fail('near-critical flashes: ' + ncUnconv + ' unconverged, worst residual ' + ncWorst);
// rigorous ammonia synthesis loop (default method) and a mixed classic / rigorous chain for the energy reconciliation
const nh3Feed = feedMol({ H2: 0.7425, N2: 0.2475, CH4: 0.007, Ar: 0.003 }, 313.15, 140);
const nh3Loop = engine.runModule('flowsheet', { streams: [nh3Feed], params: { property_package: { model: 'pr' },
  blocks: [{ id: 'MX', name: 'M1', module: 'r-mixer', n_in: 2, n_out: 1 }, { id: 'HT', name: 'E1', module: 'heater', n_in: 1, n_out: 1, params: { T_out_K: 673.15 } },
    { id: 'RX', name: 'R1', module: 'r-reactor', n_in: 1, n_out: 1, params: { reactions: [{ stoich: { N2: -1, H2: -3, NH3: 2 }, key: 'N2', conversion: 0.25 }] } },
    { id: 'CL', name: 'E2', module: 'heater', n_in: 1, n_out: 1, params: { T_out_K: 268.15 } }, { id: 'FL', name: 'F1', module: 'r-flash', n_in: 1, n_out: 2, params: { T_K: 268.15, P_bar: 140 } },
    { id: 'SP', name: 'S1', module: 'r-splitter', n_in: 1, n_out: 2, params: { fractions: [0.03, 0.97] } }],
  streams: [{ id: 'F', from: null, to: { b: 'MX', p: 0 }, feed: 0 }, { id: 'S1', from: { b: 'MX', p: 0 }, to: { b: 'HT', p: 0 } }, { id: 'S2', from: { b: 'HT', p: 0 }, to: { b: 'RX', p: 0 } },
    { id: 'S3', from: { b: 'RX', p: 0 }, to: { b: 'CL', p: 0 } }, { id: 'S4', from: { b: 'CL', p: 0 }, to: { b: 'FL', p: 0 } }, { id: 'V', from: { b: 'FL', p: 0 }, to: { b: 'SP', p: 0 } },
    { id: 'L', from: { b: 'FL', p: 1 }, to: null }, { id: 'PG', from: { b: 'SP', p: 0 }, to: null }, { id: 'RC', from: { b: 'SP', p: 1 }, to: { b: 'MX', p: 1 } }] } });
if (nh3Loop.error) fail('rigorous ammonia loop: ' + nh3Loop.error.message);
const nh3R = nh3Loop.energy_balance.reconciliation;
if (!nh3R || !nh3R.ok) fail('rigorous ammonia loop energy balance does not close');
const shiftFeed = feedMol({ H2: 0.38, CO: 0.10, CO2: 0.06, CH4: 0.003, N2: 0.15, Ar: 0.002, H2O: 0.305 }, 643.15, 30);
const mixedRun = (rx) => engine.runModule('flowsheet', { streams: [shiftFeed], params: { property_package: { model: 'pr' }, blocks: [rx,
  { id: 'CL', name: 'E1', module: 'heater', n_in: 1, n_out: 1, params: { T_out_K: 313.15 } }, { id: 'FL', name: 'F1', module: 'r-flash', n_in: 1, n_out: 2, params: { T_K: 313.15, P_bar: 29 } }],
  streams: [{ id: 'F', from: null, to: { b: 'RX', p: 0 }, feed: 0 }, { id: 'S1', from: { b: 'RX', p: 0 }, to: { b: 'CL', p: 0 } }, { id: 'S2', from: { b: 'CL', p: 0 }, to: { b: 'FL', p: 0 } },
    { id: 'G', from: { b: 'FL', p: 0 }, to: null }, { id: 'C', from: { b: 'FL', p: 1 }, to: null }] } });
const mixC = mixedRun({ id: 'RX', name: 'R1 (classic HTS)', module: 'shift', n_in: 1, n_out: 1, params: {} });
const mixR = mixedRun({ id: 'RX', name: 'R1 (PR conversion reactor)', module: 'r-reactor', n_in: 1, n_out: 1, params: { reactions: [{ stoich: { CO: -1, H2O: -1, CO2: 1, H2: 1 }, key: 'CO', conversion: 0.75 }] } });
if (mixC.error || mixR.error) fail('reconciliation cases: ' + ((mixC.error || mixR.error).message));
const rcC = mixC.energy_balance.reconciliation, rcR = mixR.energy_balance.reconciliation;
if (rcC.ok !== false || rcR.ok !== true) fail('energy reconciliation did not flag the mixed chain / pass the rigorous one');
const recRow = (label, r, run) => `<tr><td class="l">${esc(label)}</td><td>${f(r.dH_kW, 1)}</td><td>${f(r.sum_duties_kW + r.sum_work_kW, 1)}</td><td>${f(r.imbalance_kW, 3)}</td><td>${f(r.tolerance_kW, 2)}</td><td>${r.ok ? 'closes' : '<b>flagged</b>'}</td></tr>`;

/* ---------- I. STEP 33: fugacity Gibbs, carbon, syngas units, ammonia kinetics, pipe ---------- */
const S33 = REF.step33;
const run33 = (mod, streams, params) => { const r = engine.runModule(mod, { streams, params: Object.assign({ property_package: { model: 'pr' } }, params) }); if (r.error) fail('step 33 ' + mod + ': ' + r.error.message); return r; };
const molS33 = (kmol, T, P, comps) => { const t = Object.values(comps).reduce((a, b) => a + b, 0); let m = 0; const ms = {};
  for (const k in comps) { ms[k] = comps[k] / t * kmol * compdb.get(k).mw; m += ms[k]; }
  return { mass_flow_kg_h: m, T_K: T, P_bar: P, components: Object.keys(ms).map((k) => ({ key: k, mass_fraction: ms[k] / m })) }; };
// 25: ammonia equilibrium, ideal gas vs Peng–Robinson fugacity coefficients vs measured
let nhWorst300 = 0;
const nh33Rows = S33.nh3_measured.points.map((pt) => {
  const st = molS33(100, S33.nh3_measured.T_K, pt.P_atm * 1.01325, { H2: 3, N2: 1 });
  const yi = run33('gibbs', [st], { T_out_K: S33.nh3_measured.T_K, products: ['NH3'], phase_model: 'ideal' }).details.outlet_mole_frac.NH3 * 100;
  const rf = run33('gibbs', [st], { T_out_K: S33.nh3_measured.T_K, products: ['NH3'] });
  const yf = rf.details.outlet_mole_frac.NH3 * 100;
  if (pt.P_atm <= 300) nhWorst300 = Math.max(nhWorst300, Math.abs(yf - pt.y_NH3_pct));
  const phi = rf.details.fugacity_coeff || {};
  return `<tr><td>${f(pt.P_atm, 0)}</td><td>${f(yi, 2)}</td><td>${f(yf, 2)}</td><td>${f(pt.y_NH3_pct, 1)}</td><td>${f(yf - pt.y_NH3_pct, 2)}</td><td>${f(phi.H2, 3)} / ${f(phi.N2, 3)} / ${f(phi.NH3, 3)}</td></tr>`;
}).join('\n');
if (nhWorst300 > 0.6) fail('ammonia equilibrium with fugacity coefficients off measured by ' + nhWorst300 + ' mol %');
// 26: carbon
const c133 = S33.carbon.C1, c1r33 = run33('gibbs', [molS33(100, c133.T_K, c133.P_bar, c133.feed)], { T_out_K: c133.T_K, P_out_bar: c133.P_bar, phase_model: 'ideal', products: ['H2', 'CO', 'CO2'], carbon: true });
const c1n33 = c1r33.solids_out.kmol_h / (100 * c133.feed.CH4 / (c133.feed.CH4 + c133.feed.H2O));
const cRows = [`<tr><td>C1</td><td class="l">${esc(c133.desc)}</td><td class="l">graphite, mol per mol CH₄ fed</td><td>${f(c1n33, 5)}</td><td>${f(c133.nC_per_CH4, 5)}</td></tr>`,
  `<tr><td>C1</td><td class="l"></td><td class="l">H₂ in the gas, mol %</td><td>${f(100 * c1r33.details.outlet_mole_frac.H2, 3)}</td><td>${f(100 * c133.y.H2, 3)}</td></tr>`];
let cWorst = Math.abs(c1n33 / c133.nC_per_CH4 - 1);
for (const id of ['C2', 'C3']) {
  const c = S33.carbon[id], r = run33('gibbs', [molS33(100, c.T_K, c.P_bar, c.feed)], { T_out_K: c.T_K, P_out_bar: c.P_bar, phase_model: 'ideal', products: ['H2', 'CO', 'CO2'] });
  cWorst = Math.max(cWorst, Math.abs(r.details.carbon_activity_max / c.aC - 1));
  cRows.push(`<tr><td>${id}</td><td class="l">${esc(c.desc)}</td><td class="l">carbon activity of the gas</td><td>${f(r.details.carbon_activity_max, 4)}</td><td>${f(c.aC, 4)}</td></tr>`);
}
if (cWorst > 0.005) fail('carbon vs JANAF differs by ' + cWorst);
// 27: syngas units vs JANAF, and the classic modules on the same cases
const sg33 = S33.syngas;
const smrFeed = molS33(1, 773.15, 25, { CH4: 1, H2O: 3, H2: 0.05, N2: 0.02 });
const htsFeed = molS33(1, 633.15, 29, { H2: 0.38, CO: 0.10, CO2: 0.06, CH4: 0.003, N2: 0.15, Ar: 0.002, H2O: 0.305 });
const mFeed = molS33(1, 573.15, 25, { H2: 0.74, N2: 0.245, CH4: 0.004, Ar: 0.003, CO: 0.004, CO2: 0.001, H2O: 0.003 });
const cls33 = (mod, st, prm) => { const r = engine.runModule(mod, { streams: [st], params: prm }); if (r.error) fail('classic ' + mod + ': ' + r.error.message); return r; };
const dryOf33 = (r, k) => (r.details.composition_dry.find((x) => x.key === k) || {}).mole_fraction;
const synCases = [
  ['SMR1', 'CH₄ slip, mol % dry', run33('r-smr', [smrFeed], { mode: 'fired', T_out_K: 1100, P_out_bar: 25, ate_smr_K: 0, ate_wgs_K: 0, phase_model: 'ideal' }), cls33('smr', smrFeed, { mode: 'fired', T_out_K: 1100, P_out_bar: 25, ate_smr_K: 0, ate_wgs_K: 0 }), (r) => 100 * dryOf33(r, 'CH4'), 100 * sg33.SMR1.dry.CH4, 3],
  ['SMR1', 'H₂ / CO', null, null, null, sg33.SMR1.dry.H2 / sg33.SMR1.dry.CO, 3],
  ['SMR2', 'CH₄ slip, mol % dry', run33('r-smr', [smrFeed], { mode: 'fired', T_out_K: 1100, P_out_bar: 25, ate_smr_K: -100, ate_wgs_K: 0, phase_model: 'ideal' }), cls33('smr', smrFeed, { mode: 'fired', T_out_K: 1100, P_out_bar: 25, ate_smr_K: -100, ate_wgs_K: 0 }), (r) => 100 * dryOf33(r, 'CH4'), 100 * sg33.SMR2.dry.CH4, 3],
  ['HTS', 'CO slip, mol % dry', run33('r-shift', [htsFeed], { preset: 'hts', mode: 'isothermal', T_out_K: 700, ate_K: 0, phase_model: 'ideal' }), cls33('shift', htsFeed, { preset: 'hts', mode: 'isothermal', T_out_K: 700, ate_K: 0 }), (r) => 100 * dryOf33(r, 'CO'), 100 * sg33.HTS.dry.CO, 4],
  ['METH', 'CO, ppm dry', run33('r-methanator', [mFeed], { mode: 'isothermal', T_out_K: 600, P_out_bar: 25, phase_model: 'ideal' }), cls33('methanator', mFeed, { mode: 'isothermal', T_out_K: 600, P_out_bar: 25 }), (r) => 1e6 * dryOf33(r, 'CO'), 1e6 * sg33.METH.dry.CO, 9],
];
synCases[1][2] = synCases[0][2]; synCases[1][3] = synCases[0][3]; synCases[1][4] = (r) => dryOf33(r, 'H2') / dryOf33(r, 'CO');
let synWorst = 0;
const synRows = synCases.map(([id, q, rr, rc, get, ref, dg]) => {
  const a = get(rr), c = get(rc), rel = Math.abs(a / ref - 1);
  synWorst = Math.max(synWorst, rel);
  return `<tr><td>${id}</td><td class="l">${esc(sg33[id].desc)}</td><td class="l">${q}</td><td>${dg > 6 ? a.toExponential(4) : f(a, dg)}</td><td>${dg > 6 ? ref.toExponential(4) : f(ref, dg)}</td><td>${f(100 * rel, 2)} %</td><td>${dg > 6 ? c.toExponential(3) : f(c, dg)}</td></tr>`;
}).join('\n');
if (synWorst > 0.005) fail('syngas units vs JANAF differ by ' + synWorst);
// 28: ammonia kinetics in fugacities
const kn33 = S33.kinetics, rxT = [{ stoich: { N2: -1, H2: -3, NH3: 2 }, model: 'temkin', k0: 8.849e14, Ea_kJmol: 170.56, alpha: 0.5 }];
const knFeed = molS33(Object.values(kn33.feed_kmol_h).reduce((a, b) => a + b, 0), 700, kn33.P_bar, kn33.feed_kmol_h);
let knWorst = 0;
const knRows = ['K1', 'K2'].map((id) => {
  const c = kn33[id], r = run33('r-pfr', [knFeed], { phase: 'V', thermal: 'isothermal', T_K: c.T_K, P_bar: kn33.P_bar, volume_m3: c.V_m3, reactions: rxT });
  const a = r.details.outlet_mole_frac.NH3; knWorst = Math.max(knWorst, Math.abs(a - c.y.NH3));
  return `<tr><td>${id}</td><td class="l">Isothermal ${f(c.T_K - 273.15, 0)} °C, ${f(kn33.P_bar, 0)} bar, ${f(c.V_m3, 1)} m³ catalyst</td><td>${f(100 * a, 4)}</td><td>${f(100 * c.y.NH3, 4)}</td><td>${sci(Math.abs(a - c.y.NH3))}</td></tr>`;
}).join('\n');
const longF = molS33(1000, 723.15, 303.975, { H2: 0.75, N2: 0.25, NH3: 0.02 });
const longK = run33('r-pfr', [longF], { phase: 'V', thermal: 'isothermal', T_K: 723.15, volume_m3: 200, reactions: [Object.assign({}, rxT[0], { K_a: 'databank' })] }).details.outlet_mole_frac.NH3;
const longG = run33('gibbs', [longF], { T_out_K: 723.15, products: ['NH3'] }).details.outlet_mole_frac.NH3;
if (knWorst > 2e-6 || Math.abs(longK - longG) > 2e-6) fail('ammonia kinetics check failed');
// 29: pipe + dense-gas viscosity
const pw33 = (kgh, T, P, k) => ({ mass_flow_kg_h: kgh, T_K: T, P_bar: P, components: [{ key: k, mass_fraction: 1 }] });
const pipeCases = [['P1', run33('r-pipe', [pw33(100000, 298.15, 10, 'H2O')], { length_m: 500, diameter_m: 0.10226, roughness_mm: 0.0457, segments: 20 })],
  ['P2', run33('r-pipe', [pw33(100000, 298.15, 10, 'H2O')], { length_m: 500, diameter_m: 0.10226, roughness_mm: 0.0457, elevation_m: 30, segments: 20 })],
  ['P3', run33('r-pipe', [pw33(72000, 288.15, 50, 'CH4')], { length_m: 20000, diameter_m: 0.3, roughness_mm: 0.0457, thermal: 'isothermal', segments: 100 })]];
let pipeWorstW = 0, pipeG = 0;
const pipeRows = pipeCases.map(([id, r]) => {
  const ref = S33.pipe[id].dp_bar, rel = (r.details.dp_bar / ref - 1) * 100;
  if (id === 'P3') pipeG = rel; else pipeWorstW = Math.max(pipeWorstW, Math.abs(rel));
  return `<tr><td>${id}</td><td class="l">${esc(S33.pipe[id].desc)}</td><td>${f(r.details.dp_bar, 3)}</td><td>${f(ref, 3)}</td><td>${rel >= 0 ? '+' : '−'}${f(Math.abs(rel), 2)} %</td><td>${f(r.details.velocity_out_ms, 2)}</td><td>${f(100 * r.details.erosional_ratio_max, 0)} %</td></tr>`;
}).join('\n');
if (pipeWorstW > 0.6 || Math.abs(pipeG) > 3.5) fail('pipe pressure drops off the reference');
const visRows = Object.entries(S33.viscosity.mu_uPas).map(([Pb, ref]) => {
  const r = run33('r-flash', [pw33(1000, 288.15, +Pb, 'CH4')], { T_K: 288.15, P_bar: +Pb });
  const mu = r.streams_out[0].rig.props.phases[0].mu_cP * 1000;
  return `<tr><td>${f(+Pb, 0)}</td><td>${f(mu, 3)}</td><td>${f(ref, 3)}</td><td>${f((mu / ref - 1) * 100, 2)} %</td></tr>`;
}).join('\n');

const ncomp = compdb.keys().length;

const today = new Date().toISOString().slice(0, 10);
const html = `<!DOCTYPE html>
<!-- REPO PATH: flowsheet-validation.html — GENERATED by scripts/build-flowsheet-validation.mjs (${today}); do not edit by hand -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flowsheet Simulator Validation — Property Packages, Columns, CO₂ Absorption &amp; Catalytic Reactors | multicalci.com</title>
<meta name="description" content="How the multicalci.com flowsheet simulator is verified: Peng–Robinson, SRK, NRTL, UNIQUAC, Wilson and UNIFAC flashes, rigorous distillation columns, three-phase (VLLE) flashes and phase envelopes against DWSIM and the open-source thermo library, binary T–x–y diagrams with azeotropes, kinetic plug-flow and CSTR reactors against exact solutions, Gibbs-reactor equilibrium against NIST-JANAF, aqueous-MEA and hot-potassium-carbonate CO₂ absorption against measured data, IDAES and USGS PHREEQC, Murphree tray efficiencies, plus energy-balance, recycle and design-spec checks.">
<link rel="canonical" href="https://www.multicalci.com/flowsheet-validation">
<meta name="robots" content="index, follow">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#eef1f6;--card:#fff;--line:#d6dfeb;--ink:#0d1726;--ink2:#2a3a52;--dim:#5f6f86;--accent:#0055bb;--ok:#157a3c;--mono:'IBM Plex Mono',ui-monospace,monospace;--sans:Inter,system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.6 var(--sans);color:var(--ink);background:var(--bg)}
header{background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;gap:12px;align-items:center}
.lm{width:32px;height:32px;border-radius:7px;border:2px solid var(--accent);color:var(--accent);display:grid;place-items:center;font:700 14px var(--mono);background:#e7f0fb}
header a{color:inherit;text-decoration:none;display:flex;gap:10px;align-items:center;font-weight:700}
header .sp{flex:1}
header .btn{font-weight:600;font-size:13px;color:#fff;background:var(--accent);padding:8px 14px;border-radius:8px}
main{max-width:1040px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:26px;line-height:1.25;margin-bottom:8px}
h2{font-size:18px;margin:34px 0 8px}
p{color:var(--ink2);margin:8px 0}
.lead{font-size:16px;color:var(--ink2)}
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:20px 0}
.sum div{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.sum b{display:block;font:600 22px var(--mono);color:var(--ok)}
.sum span{font-size:13px;color:var(--dim)}
.tw{overflow-x:auto;background:#fff;border:1px solid var(--line);border-radius:12px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:13.5px;min-width:640px}
th{background:#f3f6fa;text-align:right;padding:8px 10px;font-size:12px;color:var(--ink2);border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid #eef2f7;text-align:right;font-family:var(--mono);white-space:nowrap}
th.l,td.l{text-align:left;font-family:var(--sans);white-space:normal}
th:first-child,td:first-child{text-align:left}
td small{display:block;color:var(--dim);font-size:11.5px}
tbody th{text-align:left;background:#f8fafc;color:var(--ink);font-size:12.5px}
h3{font-size:15px;margin:22px 0 4px}
.wrap{table-layout:fixed}
.wrap td{white-space:normal;vertical-align:top}
.wrap td:nth-child(2){font-size:12.5px;text-align:left}
.wrap th:nth-child(2){text-align:left}
.note{font-size:13px;color:var(--dim)}
footer{max-width:1040px;margin:0 auto;padding:0 18px 40px;font-size:12.5px;color:var(--dim)}
</style>
</head>
<body>
<header><a href="https://www.multicalci.com/"><span class="lm">mc</span>multicalci.com</a><span class="sp"></span><a class="btn" href="/flowsheet-simulator">Open the flowsheet simulator</a></header>
<main>
<h1>Flowsheet simulator — validation</h1>
<p class="lead">Each check below runs the live calculation engine (${esc(engine.ENGINE_VERSION.split(' (')[0])}) and compares it with a reference computed outside the engine. The engine numbers are generated by a build script, not typed in.</p>
<div class="sum">
  <div><b>${sci(prWorst)}</b><span>largest difference in V/F or mole fraction, Peng–Robinson flash (default property method) vs thermo (6 cases)</span></div>
  <div><b>${f(fwWorst, 2)} %</b><span>largest difference from IAPWS-95, Peng–Robinson with free water: heater, boiler, condensers, pump (${f(fwOffWorst, 1)} % without free water)</span></div>
  <div><b>${sci(khWorst)}</b><span>largest relative difference in Henry's constant of 9 gases in water vs IAPWS G7-04, 25–150 °C (up to ${f(khOffWorst, 0)}× off without free water)</span></div>
  <div><b>${ncUnconv} / ${ncN}</b><span>unconverged flashes in a near-critical scan; worst fugacity residual ${sci(ncWorst)}</span></div>
  <div><b>${f(nhWorst300, 2)} mol %</b><span>largest difference from measured ammonia equilibrium up to 300 atm, Gibbs reactor with Peng–Robinson fugacity coefficients</span></div>
  <div><b>${f(100 * synWorst, 2)} %</b><span>largest difference from NIST-JANAF equilibria, reformers, shift and methanator on the property method (5 quantities)</span></div>
  <div><b>${sci(knWorst)}</b><span>largest NH₃ mole-fraction difference, ammonia kinetics in fugacities vs an independent integration</span></div>
  <div><b>${sci(dwWorst)}</b><span>largest difference between the classic flash drum and the default Peng–Robinson flash — one equation of state for the whole site (6 cases)</span></div>
  <div><b>${sci(nrWorst)}</b><span>largest difference in activity coefficient, NRTL vs thermo</span></div>
  <div><b>${f(koDev, 2)} %</b><span>wet-gas cooler + knock-out duty vs CoolProp / IAPWS-95</span></div>
  <div><b>${f(spec.specs[0].target_value, 6)}</b><span>H₂/N₂ reached by the design spec (target 3.000000) in ${spec.specs[0].iterations} Newton iteration${spec.specs[0].iterations === 1 ? '' : 's'}</span></div>
  <div><b>${f(s22Worst.colPct, 2)} %</b><span>largest condenser / reboiler duty difference, rigorous column vs DWSIM (4 columns)</span></div>
  <div><b>${sci(s22Worst.three)}</b><span>largest difference, three-phase and liquid–liquid flash vs thermo (9 cases)</span></div>
  <div><b>${s22Pass} / ${s22N}</b><span>Step 22 property-package checks inside tolerance</span></div>
  <div><b>${f(s22Worst.env, 2)} K</b><span>largest critical-point / cricondentherm difference, phase envelope vs DWSIM (4 mixtures)</span></div>
  <div><b>${sci(s22Worst.kin)}</b><span>largest conversion / mole-fraction difference, kinetic PFR and CSTR vs exact solutions (8 cases, incl. stiff and multiple steady states)</span></div>
  <div><b>${s23Pass} / ${s23N}</b><span>Step 23 checks inside tolerance (envelopes, property table, binary diagrams, kinetics, Gibbs)</span></div>
  <div><b>${sci(s22Worst.lhhw)}</b><span>largest difference, LHHW / Xu–Froment catalytic reactors vs closed forms and scipy (4 cases)</span></div>
  <div><b>${f(s22Worst.assocH, 2)} kJ/mol</b><span>largest liquid ΔfH difference vs NIST for acetic and propionic acid with vapour association (was 28 kJ/mol without)</span></div>
  <div><b>${s24Pass} / ${s24N}</b><span>Step 24 checks inside tolerance (LHHW kinetics, acid association)</span></div>
  <div><b>${f(aad(arshDev.lo), 1)} %</b><span>mean deviation from measured total pressures over 30 wt % MEA up to a loading of 0.45 (${arshDev.lo.length} points)</span></div>
  <div><b>${f(pqLow, 3)} %</b><span>largest CO₂-pressure difference vs USGS PHREEQC, hot potassium carbonate 25–90 °C inside the model's stable range (${f(pqHigh, 2)} % up to 125 °C)</span></div>
  <div><b>${s25Pass} / ${s25N}</b><span>Step 25 checks inside tolerance (MEA, hot carbonate, Murphree trays)</span></div>
  <div><b>${sci(s22Worst.steamRel)}</b><span>largest relative difference, IAPWS-IF97 steam package, turbines and compressors vs the iapws library (${s26N} quantities)</span></div>
  <div><b>${f(mdeaRepWorst, 3)}</b><span>largest loading difference (mol/mol) from the published Extended UNIQUAC MDEA model's own results (${mdeaRepN} points, 40–80 °C, printed to 2 decimals)</span></div>
  <div><b>${f(100 * amHeld, 0)} %</b><span>average deviation in CO₂ pressure, activated MDEA (5 m MDEA / 5 m PZ, 40–100 °C) — a measured data set held out of the piperazine fit</span></div>
</div>

<h2>1 · Peng–Robinson flash vs an independent implementation</h2>
<p>Engine: the flash drum with the flowsheet's default property method, Peng–Robinson (the rigorous unit a new flowsheet uses). Reference: the open-source <i>thermo</i> 0.6.1 library (Gibbs-stability flash with PR gas and liquid phases), given the same ChemSep critical constants (true H₂ constants), acentric factors and binary interaction parameters. This verifies the φ–φ flash itself; how well Peng–Robinson matches experiment depends on the k<sub>ij</sub> values, which can be tuned.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th>T, °C</th><th>P, bar</th><th>V/F engine</th><th>V/F reference</th><th>|ΔV/F|</th><th>max |Δx|</th><th>max |Δy|</th></tr></thead><tbody>
${prRows.join('\n')}
</tbody></table></div>

<h2>2 · Peng–Robinson flash vs DWSIM</h2>
<p>Reference: DWSIM ${esc(dwVer)}, the open-source process simulator (Peng–Robinson property package, default flash), run through its automation interface on the same six feeds.</p>
<h3>Classic flash drum on the same equation of state</h3>
<p>The classic flash drum (property method <i>Classic</i>, flash model Peng–Robinson) used to carry its own copy of the equation of state, with effective H₂ constants (43.6 K / 20.5 bar / 0) and a short k<sub>ij</sub> table. It now calls the same Peng–Robinson package as the rigorous units — ChemSep constants, the k<sub>ij</sub> databank, free water, stability test and Newton fallback — so the two agree; the small remaining differences come only from the molar masses each path uses to turn the mass-based feed into mole fractions:</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th>V/F classic</th><th>V/F default (PR)</th><th>|ΔV/F|</th><th>max |Δx|</th><th>max |Δy|</th></tr></thead><tbody>
${dwRows.join('\n')}
</tbody></table></div>
<h3>DWSIM's own data — ammonia loop</h3>
<p>The two ammonia-loop cases again: the engine's default property method (Peng–Robinson with ChemSep data) against DWSIM with its built-in constants and k<sub>ij</sub>, as a new user of each program would get them. Inputs that differ are the only source of difference:</p>
<div class="tw"><table><thead><tr><th class="l">Input</th><th>Engine</th><th>DWSIM built-in</th></tr></thead><tbody>
${kijRows.join('\n')}
</tbody></table></div>
<div class="tw"><table><thead><tr><th class="l">Result</th><th>Engine</th><th>DWSIM built-in data</th><th>Unit</th></tr></thead><tbody>
${nhRows.join('\n')}
</tbody></table></div>
<p class="note">The engine's default method and DWSIM now start from the same ChemSep constants${kijDiff.length ? '; the inputs still differ in k<sub>ij</sub> ' + kijDiff.map((p) => sub(p.replace('|', '–'))).join(', ') : ''}. The separator vapour carries ${pct(e3.y.NH3)} mol % NH₃ in the engine and ${pct(d3.y.NH3)} mol % in DWSIM; dissolved H₂ is ${pct(e3.x.H2)} against ${pct(d3.x.H2)} mol %. Neither program has data for H₂–NH₃ or CH₄–NH₃ (k<sub>ij</sub> = 0 in both; the engine says so in its run warnings), and the NH₃ left in loop gas is sensitive to them. This comparison does not show which set is closer to a real loop; for loop work, calibrate those k<sub>ij</sub> against plant separator analyses (Methods → binary data).</p>

<h2>3 · NRTL activity coefficients</h2>
<p>The engine's NRTL flash against an independent calculation: <i>thermo</i>'s NRTL model for γ (Aspen form τ<sub>ij</sub> = a<sub>ij</sub> + b<sub>ij</sub>/T, α = ${REF.nrtl.pairs[0].cij}; parameters are test inputs, not a recommended data set). In the two-phase case the liquid composition is solved independently as well, from the bubble condition Σ x<sub>i</sub>γ<sub>i</sub>P<sub>sat,i</sub> = P with the IAPWS-IF97 water vapour pressure (<i>iapws</i> library) and the ethanol Antoine constants the engine lists.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th>x ethanol</th><th>γ engine (EtOH / H₂O)</th><th>γ reference</th><th>max |Δγ|</th></tr></thead><tbody>
${nrRows.join('\n')}
</tbody></table></div>

<h2>4 · Energy balance with condensation</h2>
<p>${esc(W.desc)}. Engine: rigorous mixer, heater and flash drum with the default property method (Peng–Robinson, free water on). Reference: CoolProp 8.0 (IAPWS-95 water, reference equations of state for N₂ and CO₂) evaluated at the component partial pressures with a Raoult split at the drum.</p>
<div class="tw"><table><thead><tr><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>Difference</th></tr></thead><tbody>
<tr><td class="l">Total heat removed, kW</td><td>${f(koQ, 1)}</td><td>${f(W.Q_kW, 1)}</td><td>${f(koDev, 2)} %</td></tr>
<tr><td class="l">Condensate, kg/h</td><td>${f(koC, 1)}</td><td>${f(W.condensate_kg_h, 1)}</td><td>${f(Math.abs(koC - W.condensate_kg_h) / W.condensate_kg_h * 100, 2)} %</td></tr>
</tbody></table></div>
<p class="note">The reference splits the drum by Raoult's law (no gas-phase non-ideality). Peng–Robinson leaves slightly more water in the gas at 4.8 bar — an enhancement factor of a few per cent, which the plain cubic's water–N₂ attraction (k<sub>ij</sub> = 0) somewhat overstates — hence the small condensate difference. Without free water the duty is ${f(Math.abs(W.Q_kW - koQoff) / Math.abs(W.Q_kW) * 100, 1)} % off.</p>

<h2>5 · Flowsheet solver</h2>
<div class="tw"><table class="wrap"><colgroup><col style="width:40%"><col style="width:32%"><col style="width:28%"></colgroup><thead><tr><th class="l">Check</th><th>Result</th><th class="l">Expected</th></tr></thead><tbody>
<tr><td class="l">Ammonia front end (primary + secondary reformer, HTS, LTS, CO₂ removal, methanator): design spec varies process air for H₂/N₂ = 3, starting 20 % low</td>
  <td>air ${f(spec.specs[0].varied, 3)} kg/h · H₂/N₂ ${f(spec.specs[0].target_value, 6)}</td><td class="l">${f(airRef, 3)} kg/h, the air rate the step-by-step template bisects for the same chain</td></tr>
<tr><td class="l">Ammonia synthesis loop with the default property method (mixer → heater → converter at 25 % N₂ conversion → chiller → separator at −5 °C / 140 bar → 3 % purge → recycle)</td>
  <td>converged in ${nh3Loop.loops[0].iterations} iterations · closure ${f(nh3Loop.mass_balance.closure_pct, 5)} % · energy imbalance ${f(nh3R.imbalance_kW, 3)} kW of ${f(Math.abs(nh3R.dH_kW), 0)} kW</td><td class="l">recycle converged; mass and energy balances close</td></tr>
<tr><td class="l">Recycle loop with classic units (mixer → shift reactor → cooler → flash → 50/50 splitter → back), Wegstein, then Broyden, on the torn recycle</td>
  <td>converged in ${rec.loops[0].iterations} iterations · recycle ${f(recR, 4)} / purge ${f(recP, 4)} kg/h · closure ${f(rec.mass_balance.closure_pct, 4)} %</td><td class="l">recycle = purge exactly; closure within the reactor's molecular-weight rounding</td></tr>
<tr><td class="l">Two simultaneous design specs (splitter fraction → 300 kg/h recycle; flash T → 0.30 mol % water in gas)</td>
  <td>${f(two.specs[0].target_value, 3)} kg/h · ${f(two.specs[1].target_value * 100, 4)} mol % · ${two.specs[0].iterations} iterations</td><td class="l">both targets met</td></tr>
</tbody></table></div>

<h2>6 · Property methods — flashes vs DWSIM</h2>
<p>The rigorous units use a property method chosen for the whole flowsheet: Peng–Robinson, Soave–Redlich–Kwong, NRTL, UNIQUAC, Wilson, UNIFAC, Dortmund UNIFAC or ideal, with pure-component data for ${ncomp} components and binary parameters from the ChemSep databank. Each case below is a flash or bubble / dew point run through the engine's own heater and flash units, against DWSIM ${esc(dwVer)} with the same property package and parameters (Poynting and Henry corrections off on both sides).</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>DWSIM</th><th>|Δ|</th></tr></thead><tbody>
${flashTable}
</tbody></table></div>
<p class="note">UNIQUAC is not listed: DWSIM's built-in UNIQUAC parameters for methanol–water and acetone pairs differ from the ChemSep set the engine uses; against <i>thermo</i> with identical parameters the engine's activity coefficients agree to machine precision for all five activity models.</p>

<h2>7 · Three-phase (VLLE) and liquid–liquid flash</h2>
<p>The three-phase separator, and every flash when the method's valid phases include a second liquid, tests the two-phase answer for another liquid (Michelsen tangent-plane distance), converges vapour, light liquid and heavy liquid with a three-phase Rachford–Rice, and keeps the state with the lowest Gibbs energy. References: <i>thermo</i>'s FlashVLN (one Peng–Robinson gas and two Peng–Robinson liquids, same constants and k<sub>ij</sub>) for water–hydrocarbon systems, and isoactivity equations solved separately with <i>thermo</i>'s activity models for partially miscible liquids.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${threeTable}
</tbody></table></div>

<h2>8 · Rigorous distillation columns vs DWSIM</h2>
<p>Equilibrium-stage columns solved by simultaneous correction (Naphtali–Sandholm Newton on the full MESH equations), against DWSIM's rigorous column on the same feed, stages, pressure and specifications (reflux ratio and bottoms rate).</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Column</th><th class="l">Quantity</th><th>Engine</th><th>DWSIM</th><th>Difference</th></tr></thead><tbody>
${colTable}
</tbody></table></div>

<h2>9 · Gibbs reactor vs NIST-JANAF</h2>
<p>Equilibrium by Gibbs-energy minimisation (the Gordon–McBride element-potential iteration of NASA CEA, so species whose element is nearly exhausted still converge), with no reactions written, against equilibrium constants from the NIST-JANAF formation Gibbs energies: water-gas shift at 1000 K and ammonia synthesis — stoichiometric at 700 K / 150 bar and with hydrogen nearly used up at 400 K / 100 bar.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>NIST-JANAF</th><th>|Δ|</th></tr></thead><tbody>
${gibbsTable}
</tbody></table></div>

<h2>10 · Phase envelopes vs DWSIM</h2>
<p>Bubble and dew curves traced by Michelsen's continuation method (Newton on ln K, ln T and ln P with the most sensitive variable specified, stepping through the critical point), with the critical point located on the curve and the cricondenbar / cricondentherm refined. Reference: DWSIM ${esc(dwVer)} with the same critical constants and k<sub>ij</sub> — its critical point from the Heidemann–Khalil method, its cricondentherm as the hottest point of its own dew curve (sampled every 0.5 bar). Points along the traced curves were also confirmed with independent bubble / dew calculations in <i>thermo</i> to within 2·10⁻⁴ K.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Mixture</th><th class="l">Quantity</th><th>Engine</th><th>DWSIM</th><th>|Δ|</th></tr></thead><tbody>
${envTable}
</tbody></table></div>
<h3>Property table</h3>
<p>A temperature / pressure sweep tabulates phase fractions, enthalpy, entropy, Cp and the density, viscosity and thermal conductivity of each phase. Reference for the vapour density and compressibility: <i>thermo</i>'s Peng–Robinson gas root with the same constants and k<sub>ij</sub>.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Stream</th><th class="l">Quantity</th><th>Engine</th><th>thermo</th><th>|Δ|</th></tr></thead><tbody>
${ptTable}
</tbody></table></div>

<h2>11 · Binary T–x–y diagrams</h2>
<p>Bubble and dew curves from the flowsheet property method, azeotropes located by bisection on y₁ − x₁, and — for partially miscible pairs — the three-phase line found from the three-phase flash, with the stable diagram drawn across the liquid–liquid gap. Reference: modified Raoult's law with <i>thermo</i>'s NRTL / UNIFAC activity coefficients and the same vapour-pressure equations, solved independently with scipy (isoactivity liquid–liquid equilibrium plus the bubble condition for the heteroazeotropes).</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${binTable}
</tbody></table></div>

<h2>12 · Kinetic plug-flow and CSTR reactors vs exact solutions</h2>
<p>Power-law kinetics in the chosen phase of the property method. The plug-flow reactor integrates molar flows and enthalpy flow (Dormand–Prince RK5(4), switching to the L-stable Rosenbrock method RODAS3 when the kinetics are stiff); the CSTR solves the extents and temperature by Newton from several starts, reports every steady state it finds, and takes very fast kinetics to the steady state by pseudo-transient continuation. References: Levenspiel's closed forms for first-order reactions with volume change, scipy LSODA and root-bracketing on the same ideal-gas balances (adiabatic, cooled and fixed-duty reactors, including all three steady states of an exothermic CSTR), the closed-form solution of a linear system with a stiffness ratio of 3·10⁶, and the NIST-JANAF water-gas-shift equilibrium for reactors whose reverse rate comes from the equilibrium constant.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Reactor</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${kinTable}
</tbody></table></div>
<p class="note">With very fast reversible kinetics the plug-flow and CSTR outlets also reproduce the engine's Gibbs reactor (adiabatic, same species) to 10⁻⁷ in mole fraction for steam reforming + shift, butene isomerisation and ammonia synthesis — two independent routes to the same equilibrium.</p>

<h2>13 · Catalytic (LHHW / Hougen–Watson) rate laws</h2>
<p>Rates of the form k(T)·[Π a<sup>order</sup> − reverse]/(Σ K<sub>t</sub>(T) Π a<sup>e</sup>)<sup>m</sup>, with a thermodynamically consistent driving force when the reverse rate comes from the equilibrium constant (the databank's or your own ln K correlation). References: the closed-form Langmuir–Hinshelwood plug-flow and stirred-tank solutions, and the published Xu &amp; Froment (1989) steam-reforming model — three reversible reactions with negative hydrogen orders and a squared adsorption term — integrated independently with scipy, isothermal and adiabatic.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Reactor</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${lhhwTable}
</tbody></table></div>

<h2>14 · Vapour association of carboxylic acids</h2>
<p>With an activity-coefficient method, acids dimerise in the vapour (chemical theory: ideal gas of monomers, dimers and cross dimers). The measured vapour pressure and heat of vaporisation refer to this associated vapour, so the liquid enthalpy built from them is now consistent with the formation enthalpies — without association it is about 28 kJ/mol too high for acetic acid, which made liquid heats of reaction and adiabatic temperatures wrong. References: NIST liquid enthalpies of formation, the DIPPR vapour-pressure equation, and an independently written chemical-theory solution for vapour compressibilities.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${assocTable}
</tbody></table></div>

<h2>15 · CO₂ absorption in aqueous MEA</h2>
<p>The aqueous-MEA method solves the carbamate (2 MEA + CO₂ ⇌ MEAH⁺ + MEACOO⁻) and bicarbonate (MEA + CO₂ + H₂O ⇌ MEAH⁺ + HCO₃⁻) equilibria of the published Akula et al. model as implemented in the open-source IDAES process-modelling framework; CO₂ follows Henry's law on the free molecular CO₂ (N₂O analogy), water and MEA Raoult's law on the true species. Enthalpies come from the temperature dependence of the same fugacities, so the heat of absorption is consistent with the solubility. References: the IDAES property-package test values, an independent scipy solution of the published equations, and the IDAES heat of absorption.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${meaTable}
</tbody></table></div>
<h3>Against measured vapour pressures</h3>
<p>Total pressure over 30 wt % MEA (7.017 mol/kg water) measured by Arshad et al. (J. Chem. Eng. Data 59, 2014, 764; NIST ThermoML), against the engine's bubble pressure. At 120 °C the model is within 2 % up to a loading of 0.32 mol/mol and then over-predicts more and more (+19 % at 0.40, +37 % at 0.44); at 80 °C it is within 10 % to 0.44, and at 40 °C within 20 % at 0.5. Above about 0.55 it over-predicts the CO₂ pressure about twofold — a known limit of ideal-solution chemical-equilibrium models. In a regenerator this makes CO₂ look slightly easier to strip at the rich end, so reboiler duties come out somewhat low.</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th>Loading, mol/mol</th><th>Measured, kPa</th><th>Engine, kPa</th><th>Deviation</th></tr></thead><tbody>
${arshRows.join('\n')}
</tbody></table></div>
<p class="note">Mean absolute deviation ${f(aad(arshDev.lo), 1)} % for loadings up to 0.45 (${arshDev.lo.length} points) and ${f(aad(arshDev.hi), 0)} % above (${arshDev.hi.length} points). The test vectors below hold four of these points with tolerances set at the model's accuracy.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th class="l">Quantity</th><th>Engine</th><th>Measured</th><th>|Δ|</th></tr></thead><tbody>
${arshTable}
</tbody></table></div>

<h2>16 · Hot potassium carbonate (Benfield-type solutions)</h2>
<p>A Pitzer electrolyte model (Harvie–Møller–Weare form with unsymmetrical mixing terms) with the parameters and equilibrium constants of the USGS PHREEQC <i>pitzer.dat</i> database: species K⁺, CO₃²⁻, HCO₃⁻, CO₂(aq), OH⁻ and H⁺, the water activity from the osmotic coefficient, and the water consumed by bicarbonate formation. Reference: PHREEQC itself, adding K₂CO₃ and CO₂ to 1 kg of water.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Solution</th><th class="l">Quantity</th><th>Engine</th><th>PHREEQC</th><th>|Δ|</th></tr></thead><tbody>
${k2Table}
</tbody></table></div>
<h3>Full grid against PHREEQC</h3>
<p>20, 30 and 40 wt % K₂CO₃ at conversions to bicarbonate of 0.05, 0.3, 0.6 and 0.9. Above 100 °C PHREEQC evaluates the solution at the water vapour pressure instead of 1 atm, which accounts for the small difference there.</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th>States</th><th>CO₂ pressure range, kPa</th><th>Largest CO₂-pressure difference</th><th>Largest water-activity difference</th></tr></thead><tbody>
${pqRows}
</tbody></table></div>
<p>The <i>pitzer.dat</i> KHCO₃ parameters are fitted to about 3 mol/kg. In strong, highly converted solutions they make the model thermodynamically unstable (a spurious liquid–liquid split) close to where KHCO₃ would in fact crystallise; the engine maps that onset over 0–250 °C and, past 95 % of it, holds the properties at the boundary and extrapolates smoothly (the stream report flags such states). PHREEQC evaluates those states without a stability check, so they are listed separately and not graded — all are cold or 40 wt % solutions converted 60–90 % to bicarbonate, beyond normal hot-carbonate practice:</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th class="l">Solution</th><th>PHREEQC CO₂ pressure, kPa</th><th>Engine, kPa</th><th>Difference</th><th>Water-activity difference</th></tr></thead><tbody>
${pqBeyond.join('\n')}
</tbody></table></div>
<h3>Against handbook data</h3>
<p>Water activity, heat capacity and density of potassium carbonate solutions from the Armand Products potassium carbonate handbook. The density correlation is fitted to the handbook's 15.6 °C table, so its temperature dependence is the test here; the heat capacity follows from the Pitzer parameters' temperature dependence and is not fitted.</p>
<div class="tw"><table><thead><tr><th class="l">Quantity</th><th>Engine</th><th>Handbook</th><th>Deviation</th></tr></thead><tbody>
${armRows.join('\n')}
</tbody></table></div>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Solution</th><th class="l">Quantity</th><th>Engine</th><th>Handbook</th><th>|Δ|</th></tr></thead><tbody>
${armandTable}
</tbody></table></div>
<h3>Phase-boundary edge cases</h3>
<p>Gas and condensate around a carbonate absorber and regenerator: wet CO₂ at its dew point with the salt listed but absent, the absorber overhead carrying a numerical trace of K₂CO₃, and the same gas condensing water. Reference: IAPWS-IF97 saturation of water at its partial pressure.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Stream</th><th class="l">Quantity</th><th>Engine</th><th>IF97</th><th>|Δ|</th></tr></thead><tbody>
${edgeTable}
</tbody></table></div>
<p class="note">At high concentration the Pitzer water activity falls below the handbook's 20 °C vapour pressures (−8 % at 46 wt %) and the heat capacity of 40 wt % solution is 10 % low; between 20 and 30 wt % — the Benfield range — both agree within 1–4 %. The Pitzer parameters carry fitted temperature terms to about 90–100 °C and are extrapolated above that. Promoters (DEA, glycine, vanadium) change absorption rates, not the equilibrium, and are represented through tray efficiencies.</p>

<h2>17 · Murphree tray efficiency</h2>
<p>A tray with Murphree vapour efficiency E leaves its vapour at y = y<sub>in</sub> + E(K x − y<sub>in</sub>) instead of in equilibrium; the efficiency can be set for every tray or per component. Reference: the exact solution of the tray equations for a dilute absorber with a straight equilibrium line (numpy), which equals the Lewis–Kremser closed form. The regenerator case checks the condenser-temperature specification used for amine and carbonate strippers.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Column</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${murphTable}
</tbody></table></div>

<h2>18 · Steam (IAPWS-IF97) package, turbines and compressors</h2>
<p>The Steam / water method evaluates every state with the IAPWS-IF97 industrial formulation (regions 1, 2, 3, 5 and the saturation line) and the IAPWS viscosity and thermal-conductivity correlations. Reference: the same states and machines worked with the independent Python <i>iapws</i> library — heater duties from compressed water to superheated and supercritical steam (region 3 near the critical point), outlet transport properties, a turbine specified by efficiency, by measured outlet temperature and by shaft power, an extraction turbine section by section, a boiler feed pump, a vapour-recompression compressor, and the simulator's steam-turbine example flowsheet. The steam calculators (properties, quench, turbine power, Rankine cycle) use the same formulation and are checked against the IAPWS verification tables in their own test suite.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Unit</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${steamTable}
</tbody></table></div>

<h2>19 · Aqueous MDEA — Extended UNIQUAC</h2>
<p>The Aqueous MDEA method is the Extended UNIQUAC electrolyte model (UNIQUAC + Debye–Hückel) with the parameter set of N. Sadegh's DTU PhD thesis (2013): true species H₂O, CO₂, MDEA, MDEAH⁺, H⁺, OH⁻, HCO₃⁻, CO₃²⁻; equilibrium constants from the fitted standard-state properties; CO₂ Henry constant of Rumpf &amp; Maurer (1993). First check: the thesis printed the loading its model predicts at 110 kPa total pressure for 10–90 wt % MDEA at 40–80 °C; the engine solves the same condition (bubble pressure = 110 kPa) with the same parameters. The water vapour pressure comes from the databank rather than the model's own Cp integration, and the vapour is ideal rather than SRK, so agreement is to the printed two decimals, not to machine precision. Second check: an independent Python implementation of the model (scipy speciation) for the species distribution, and calorimetric heat of absorption.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Condition</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${mdeaTable}
</tbody></table></div>
<p>Loading at 110 kPa total pressure — measured in the thesis (volumetric method), the thesis model's printed value and the engine:</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th>MDEA, wt %</th><th>Measured</th><th>Thesis model</th><th>Engine</th><th>Engine − thesis model</th></tr></thead><tbody>
${mdeaRows.join('\n')}
</tbody></table></div>
<p>Against the measurements (20–80 wt %; the 10 wt % points carry 7–10 % uncertainty and the 90 wt % points are outside the fitted range):</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th>Points</th><th>Engine AARD</th><th>Thesis model, same points</th><th>Thesis model, all points (as reported)</th></tr></thead><tbody>
${mdeaExpRows}
</tbody></table></div>
<p class="note">The engine follows the thesis model's own deviation from these measurements point for point, as it should. The thesis explains the growth with temperature: the volume of CO₂ consumed in its cell shrinks as temperature rises, and at 80 °C a systematic error pulls all measured loadings down; below 70 wt % MDEA the model over-predicts solubility. The parameters were regressed to 1,597 literature points (pure MDEA, MDEA–water and CO₂–MDEA–water data) and represent the ternary data used within 16 % AARD; the stated validity range is 20–200 °C, CO₂ partial pressure up to 7,565 kPa, loading 0.0002–1.4 and 5–75 wt % MDEA. Piperazine-activated MDEA (aMDEA) is not part of this method yet — Neerup et al. (2025) give the MDEA–piperazine interaction parameters, but the piperazine species' standard-state data and UNIQUAC volume / area parameters they rest on are in Fosbøl et al. (2013), which is still to be added.</p>

<h2>20 · Activated MDEA — piperazine added to the MDEA model</h2>
<p>Piperazine (PZ) activates MDEA in most ammonia-plant CO₂ removal units. No complete, self-contained piperazine parameter set has been published for this model: the DTU group keeps its set in its consortium databank, and the University of Texas models depend on Aspen Plus databank values that are not printed. So the piperazine species were added here and fitted to measured data. Five species are added: PZ, PZH⁺, the carbamate PZCOO⁻, the protonated carbamate H⁺PZCOO⁻ and the dicarbamate PZ(COO)₂²⁻. The MDEA–CO₂–water part is the Sadegh (2013) set of section 19, unchanged.</p>
<ul>
<li><b>PZ protonation:</b> the constant comes from Gupta, da Silva &amp; Svendsen (2022), whose correlation reproduces the measured pKa values plotted in their paper.</li>
<li><b>Interaction parameters:</b> each piperazine species takes its UNIQUAC size, area and interaction parameters from the nearest Sadegh species: PZ and the zwitterion from MDEA, PZH⁺ from MDEAH⁺, the carbamate from HCO₃⁻ and the dicarbamate from CO₃²⁻.</li>
<li><b>Fitted values:</b> five water interactions and the three carbamate reaction constants (each a value at 40 °C plus a reaction enthalpy) were regressed to the measured CO₂ pressures below, weighting the deviation in ln p(CO₂).</li>
<li><b>Held-out data:</b> the 5 m MDEA / 5 m PZ data of Chen (2011) were kept out of the regression to test it.</li>
</ul>
<div class="tw"><table><thead><tr><th class="l">Solvent</th><th class="l">Source</th><th>Role</th><th>Points</th><th>Average |Δ|</th><th>Bias</th><th>Largest |Δ|</th></tr></thead><tbody>
${amSummary.join('\n')}
</tbody></table></div>
<p>Engine test set (CO₂ pressures, a bubble pressure against the measured total pressure and a density):</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Condition</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${amdeaTable}
</tbody></table></div>
<p>Every point (T in °C, loading in mol CO₂ per mol alkalinity = MDEA + 2 PZ, p(CO₂) in kPa):</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th>Loading</th><th>Measured</th><th>Engine</th><th>Δ</th></tr></thead><tbody>
${amRows.join('\n')}
</tbody></table></div>
<p>Aqueous piperazine (8 m) at absorber temperatures, compared with Xu's (2011) correlation of five measured data sets (Hilliard 2008, Dugas 2008, Ermatchkov 2006, Nguyen 2010, Kamps 2003). These comparison points were also used in the regression, at half weight:</p>
<div class="tw"><table><thead><tr><th>T, °C</th><th>Loading</th><th>Correlation</th><th>Engine</th><th>Δ</th></tr></thead><tbody>
${amCorrRows.join('\n')}
</tbody></table></div>
<p class="note">Density of the loaded blends: piperazine and CO₂ apparent volumes were fitted to Frailie (2014, Table C-1). The largest deviation over its 31 points is ${f(100 * amRhoWorst, 2)} %. Limits of this extension:</p>
<ul class="note">
<li><b>Data range:</b> the data reach 0.3 bar CO₂ below 100 °C and 0.45 mol/mol alkalinity, so the rich end of a high-pressure absorber is an extrapolation and the stream warnings say so. There, most of the CO₂ is held by MDEA, whose model is validated to 75 bar CO₂.</li>
<li><b>Speciation:</b> the split of piperazine between its species is a by-product of fitting CO₂ pressures, not a measurement.</li>
<li><b>Heat of absorption:</b> no calorimetric data were used. The heat implied by the temperature trend of the fitted CO₂ pressures sits within about 15 % of the trend in Xu's correlations at 80–120 °C. At 40 °C it deviates by up to about 30 %: higher at low loading, lower at high loading.</li>
</ul>

<h2>21 · Free water — water and steam on IAPWS-IF97 inside Peng–Robinson</h2>
<p>With Peng–Robinson or SRK, the free-water option (on by default) refers the water in every liquid phase to IAPWS-IF97, and water vapour to IF97 at its partial pressure. Each case runs the engine's own heater, valve, pump or flash drum on pure water. Reference: IAPWS-95 (CoolProp ${esc((S32.about.match(/CoolProp ([\d.]+)/) || [])[1] || '')}); IF97 and IAPWS-95 agree to about 0.01 % here.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Duty</th><th class="l">Quantity</th><th>PR, free water</th><th>Δ</th><th>PR, plain cubic</th><th>Δ</th><th>IAPWS-95</th></tr></thead><tbody>
${fwRows}
</tbody></table></div>
<p class="note">A plain cubic puts the latent heat of water about 2–5 % high below 100 bar and the fugacity of liquid water 10–15 % low near ambient (W7: too little water in the gas), and the error changes sign close to the critical point. Pure water alone saturates on a vapour-pressure correlation either way, and the pump uses the liquid density, so W6 is the same with and without free water. Mixtures are treated the same way: water in a liquid phase carries the IF97 correction in proportion to its mole fraction, and water vapour the IF97 residual at its partial pressure. Hydrocarbon liquids and dry gases are unchanged.</p>

<h2>22 · Gases dissolved in water — Henry's constants vs IAPWS G7-04</h2>
<p>Henry's constant k<sub>H</sub> (MPa) of each gas at infinite dilution in water at the saturation pressure, from the engine's Peng–Robinson package, against the IAPWS G7-04 guideline (Fernández-Prini, Alvarez &amp; Harvey 2003, via the <i>iapws</i> Python package). With free water the dissolved gases are referred to G7-04, so this table checks the implementation; the last column of each temperature shows how far a plain cubic with the databank k<sub>ij</sub> is off (≫ 1 = too insoluble).</p>
<div class="tw"><table><thead><tr><th class="l" rowspan="2">Gas</th>${khTemps.map((t) => `<th colspan="3">${t}</th>`).join('')}</tr><tr>${khTemps.map(() => '<th>engine</th><th>G7-04</th><th>plain/G7-04</th>').join('')}</tr></thead><tbody>
${khRows}
</tbody></table></div>
<p class="note">A constant k<sub>ij</sub> cannot represent gas solubility in water: the fitted value is negative near ambient and drifts with temperature. Gases without G7-04 data (propane, ethylene …) use the Sander (2015) Henry constants already used by the activity-coefficient packages. Ammonia keeps the cubic (k<sub>ij</sub> NH₃–H₂O from ChemSep); it is not sparingly soluble.</p>

<h2>23 · Flash convergence near a critical point</h2>
<p>${ncN} isothermal flashes of a natural-gas mixture (C1/C2/C3/nC5 = 80/10/6/4 mol %) over 200–260 K and 50–95 bar, which crosses its critical region. Successive substitution hands over to Newton–Raphson on ln K after 100 steps; every flash now reports whether it converged, and a unit with an unconverged flash says so in its results and on the status lamp.</p>
<div class="tw"><table><thead><tr><th class="l">Quantity</th><th>Result</th></tr></thead><tbody>
<tr><td class="l">Flashes / two-phase answers</td><td>${ncN} / ${ncTwo}</td></tr>
<tr><td class="l">Finished by Newton after 100 substitution steps</td><td>${ncNewton}</td></tr>
<tr><td class="l">Not converged</td><td>${ncUnconv}</td></tr>
<tr><td class="l">Worst fugacity residual max |ln f<sub>L</sub> − ln f<sub>V</sub>| of a two-phase answer</td><td>${sci(ncWorst)}</td></tr>
</tbody></table></div>
<p class="note">Before this check was added, 194 of 9,801 flashes on a finer grid stopped at the substitution limit with fugacity errors up to 0.8 % and were reported as converged.</p>

<h2>24 · Energy-balance reconciliation</h2>
<p>After every run the solver compares the enthalpy change from feeds to products with the sum of the unit duties and shaft work. A gap means two units evaluated the same stream on different enthalpy bases (a classic unit next to a property-method unit, or units with different property methods) or a recycle carried an error. It is flagged when it exceeds 0.1 % of the gross duty (at least 2 × 10⁻⁵ of the feed and product enthalpy flows, and 0.05 kW), and the warning names the units where the gap arises.</p>
<div class="tw"><table><thead><tr><th class="l">Flowsheet</th><th>ΔH products − feeds, kW</th><th>Σ Q + Σ W, kW</th><th>Gap, kW</th><th>Tolerance, kW</th><th>Check</th></tr></thead><tbody>
${recRow('Ammonia synthesis loop, all units on Peng–Robinson (section 5)', nh3R)}
${recRow('HTS → cooler → knock-out, all units on Peng–Robinson', rcR)}
${recRow('Same chain with the classic shift converter feeding Peng–Robinson units', rcC)}
</tbody></table></div>

<h2>25 · Gibbs reactor with fugacity coefficients — ammonia equilibrium vs measurement</h2>
<p>A 3:1 H₂/N₂ feed brought to equilibrium at 450 °C. With Peng–Robinson the Gibbs reactor now minimises μ<sub>i</sub> = μ°<sub>i</sub> + RT ln(y<sub>i</sub> φ<sub>i</sub> P/P°) with φ from the property method (successive substitution on ln φ); ideal gas is kept as an option. Measured: Larson &amp; Dodge (1923) and Larson (1924).</p>
<div class="tw"><table><thead><tr><th>P, atm</th><th>Ideal gas, mol % NH₃</th><th>Peng–Robinson φ, mol % NH₃</th><th>Measured, mol % NH₃</th><th>Δ (PR − measured)</th><th>φ H₂ / N₂ / NH₃</th></tr></thead><tbody>
${nh33Rows}
</tbody></table></div>
<p class="note">Up to 300 atm the fugacity correction removes most of the ideal-gas error. At 1000 atm Peng–Robinson with van der Waals mixing and the databank k<sub>ij</sub> still under-predicts; ammonia converters run at 100–300 bar.</p>

<h2>26 · Solid carbon and carbon activity vs NIST-JANAF</h2>
<p>With carbon allowed, graphite (NASA polynomials, McBride, Gordon &amp; Reno 1993) deposits until the gas is at unit carbon activity; the deposit leaves as a solid product of its own and the flowsheet mass and energy balances include it. Without carbon, the outlet carbon activity by methane cracking, Boudouard and CO reduction is reported and flagged above 1. Reference: three equilibrium constants from NIST-JANAF ΔfG° at 1000 K solved with scipy, independent of the element-potential method.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Feed and conditions</th><th class="l">Quantity</th><th>Engine</th><th>JANAF</th></tr></thead><tbody>
${cRows.join('\n')}
</tbody></table></div>

<h2>27 · Reformers, shift and methanator on the property method</h2>
<p>The primary and secondary reformer, autothermal reformer, shift converter and methanator now solve the restricted equilibrium of reforming and shift — each reaction at outlet T + its approach — with ΔG° from the databank, vapour fugacity coefficients and enthalpies from the flowsheet's property method. Ideal-gas cases are compared with equilibria solved from NIST-JANAF; the last column is the classic module (Twigg / Moe correlations) on the same case.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Conditions</th><th class="l">Quantity</th><th>Engine</th><th>JANAF</th><th>Δ</th><th>Classic module</th></tr></thead><tbody>
${synRows}
</tbody></table></div>
<p class="note">With every unit on the property method, the ammonia front-end example closes its energy balance to round-off (it left a 0.47 kW gap with the classic reformers, shift and methanator). The classic flash drum's Peng–Robinson also runs on the same package now (section 2).</p>

<h2>28 · Ammonia synthesis kinetics in fugacities</h2>
<p>The kinetic plug-flow reactor takes rates in fugacities a<sub>i</sub> = y<sub>i</sub> φ<sub>i</sub> P from the property method, and the Temkin–Pyzhev rate in the form of Dyson &amp; Simon (1968): R<sub>NH₃</sub> = η k [K<sub>a</sub>² f<sub>N₂</sub> (f<sub>H₂</sub>³/f<sub>NH₃</sub>²)<sup>α</sup> − (f<sub>NH₃</sub>²/f<sub>H₂</sub>³)<sup>1−α</sup>], k<sub>0</sub> = 8.849·10¹⁴ kmol/(m³·h), E = 170.56 kJ/mol, α = 0.5, K<sub>a</sub> of Gillespie &amp; Beattie (1930). Reference: the same rate with <i>thermo</i> 0.6.1 PRMIX fugacity coefficients (engine constants and k<sub>ij</sub>) integrated by scipy (Radau).</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Bed</th><th>NH₃ out, mol % (engine)</th><th>NH₃ out, mol % (reference)</th><th>|Δy|</th></tr></thead><tbody>
${knRows}
<tr><td>K3</td><td class="l">Long isothermal bed, 450 °C / 300 atm, K<sub>a</sub> from the databank</td><td>${f(100 * longK, 4)}</td><td>${f(100 * longG, 4)} (Gibbs reactor)</td><td>${sci(Math.abs(longK - longG))}</td></tr>
</tbody></table></div>
<p class="note">With K<sub>a</sub> from the databank the rate vanishes exactly at the Gibbs-reactor equilibrium (K3). Gillespie &amp; Beattie's K<sub>a</sub> is about 7 % below NIST-JANAF at 450 °C. The three-bed converter example uses this rate with adiabatic beds and interbed coolers.</p>

<h2>29 · Pipe segment</h2>
<p>A pipe marched in segments with a P–H flash of the property method at each node: Darcy–Weisbach friction with the Churchill (1977) factor, elevation, acceleration and fittings, homogeneous two-phase flow, the API RP 14E erosional velocity and the Mach number of a gas. Reference: <i>fluids</i> 1.3.1 Churchill factor with CoolProp reference-equation densities and viscosities.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Line</th><th>ΔP engine, bar</th><th>ΔP reference, bar</th><th>Δ</th><th>Outlet velocity, m/s</th><th>Share of erosional velocity</th></tr></thead><tbody>
${pipeRows}
</tbody></table></div>
<p>Vapour viscosity now carries the Jossi–Stiel–Thodos dense-gas correction (the databank correlations are for the dilute gas):</p>
<div class="tw"><table><thead><tr><th>Methane at 15 °C, bar</th><th>Engine, µPa·s</th><th>CoolProp, µPa·s</th><th>Δ</th></tr></thead><tbody>
${visRows}
</tbody></table></div>
<p class="note">P3: Peng–Robinson puts the density of methane at 50 bar about 2.2 % high, which lowers the pressure drop by about the same amount. Two-phase lines use the no-slip model; slip and flow patterns (Beggs–Brill and similar) are not modelled.</p>

<h2>Scope</h2>
<p>These checks verify the implementation against independent references. Agreement with another simulator shows the equations are solved correctly for the given parameters; it does not make a property method suitable for every system — Peng–Robinson without fitted k<sub>ij</sub> over-predicts the solubility of water in hydrocarbon liquids, ChemSep NRTL / UNIQUAC parameters are fitted to vapour–liquid data, and the urea units remain empirical correlations. Use the results for preliminary engineering and confirm them against plant data before design use. Kinetic reactors are only as good as the rate expressions entered, and the acid association model covers dimerisation only (no acid–water cross association; binary parameters fitted without association may need refitting). The CO₂ packages cover CO₂ only (no H₂S or NH₃ chemistry), the piperazine part of activated MDEA is a fit to measured CO₂ pressures (section 20), and tray efficiencies stand in for rate-based mass transfer. The Steam / water method takes pure water only. Sections 21–29 are generated by this page's build script from the references in <code>tests/validation-references.json</code>. Peng–Robinson has no built-in k<sub>ij</sub> for H₂–NH₃ or CH₄–NH₃; calibrate them against plant separator data for ammonia-loop work. The inputs for every other case above are in the engine test set, cases MB-089 to MB-247.</p>
</main>
<footer>Generated ${today} · multicalci.com</footer>
<script>
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
fs.writeFileSync(OUT, html);
console.log('Step 22:', s22Pass + '/' + s22N, 'in tolerance · column duty worst', s22Worst.colPct.toFixed(3) + ' %', '· three-phase worst', s22Worst.three.toExponential(2));
console.log('Step 28:', s28Pass + '/' + s28N, 'in tolerance · activated MDEA AARD all', (100 * amAllDev / amAllN).toFixed(1) + '%', 'held-out', (100 * amHeld).toFixed(1) + '%', '· density worst', (100 * amRhoWorst).toFixed(2) + '%');
console.log('Step 27:', s27Pass + '/' + s27N, 'in tolerance · MDEA reproduction worst Δα', mdeaRepWorst.toFixed(4), 'over', mdeaRepN, 'points', '· vs measured AARD', Object.entries(mdeaExp).map(([T, o]) => T + ':' + (100 * o.dev / o.n).toFixed(1) + '%').join(' '));
console.log('Step 26:', s26Pass + '/' + s26N, 'in tolerance · steam worst relative', s22Worst.steamRel.toExponential(2));
console.log('Step 25:', s25Pass + '/' + s25N, 'in tolerance · MEA vs Arshad AAD (α ≤ 0.45)', aad(arshDev.lo).toFixed(2) + ' %', '· PHREEQC worst ≤90 °C', pqLow.toFixed(4) + ' %', 'all', pqHigh.toFixed(3) + ' %', '· beyond stability (not graded)', pqBeyond.length);
console.log('Step 24:', s24Pass + '/' + s24N, 'in tolerance · LHHW worst', s22Worst.lhhw.toExponential(2), '· acid liquid ΔfH worst', s22Worst.assocH.toFixed(2) + ' kJ/mol');
console.log('Step 23:', s23Pass + '/' + s23N, 'in tolerance · envelope worst', s22Worst.env.toFixed(3) + ' K', '· binary T worst', s22Worst.bin.toExponential(2), '· kinetics worst', s22Worst.kin.toExponential(2));
console.log('Step 33: NH3 vs measured ≤300 atm', nhWorst300.toFixed(2), 'mol % · carbon', cWorst.toExponential(2), '· syngas vs JANAF', (100 * synWorst).toFixed(3) + ' %', '· kinetics', knWorst.toExponential(2), '· pipe water', pipeWorstW.toFixed(2) + ' %', 'gas', pipeG.toFixed(2) + ' %');
console.log('wrote', path.relative(ROOT, OUT), '— PR worst', prWorst.toExponential(2), '· classic vs rigorous PR', dwWorst.toExponential(2), '· NRTL worst', nrWorst.toExponential(2), '· wet gas', koDev.toFixed(3) + ' %');
