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
import pseudoMod from '../api/_lib/mb-pseudo.js';
import usercompMod from '../api/_lib/mb-usercomp.js';
import aqelecMod from '../api/_lib/mb-aqelec.js';
import { aphi as aphi38 } from '../api/_lib/mb-electrolyte.js';
import gergMod from '../api/_lib/mb-gerg.js';

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
let QN_EXTRA = {};      // per-section labels (STEP 41)
const qName = (k) => QN_EXTRA[k] || NICE[k] || k.replace(/^details\./, '').replace(/^streams_out\.0\.rig\.x\./, 'distillate x ').replace(/^streams_out\.1\.rig\.x\./, 'bottoms x ')
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
      rows.push(`<tr>${i === 0 ? `<td rowspan="${keys.length}">${esc(id)}</td><td class="l" rowspan="${keys.length}">${esc(v.desc)}</td>` : ''}<td class="l">${sub(kind === 'kin' && k === 'details.T_out_K' ? 'outlet T, K' : kind === 'fill' && k === 'details.T_K' ? 'bubble T, K' : (kind === 'steam' && STEAM_NICE[k]) || (kind === 'mdea' && MDEA_NICE[k]) || (kind === 'amdea' && AMDEA_NICE[k]) || (kind === 'ter' && TER_NICE(v, k)) || qName(k))}</td><td>${f(a, dig)}</td><td>${f(e, dig)}</td><td>${pct !== null ? f(pct, 3) + ' %' : sci(d)}</td></tr>`);
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
  const c = kn33[id], r = run33('r-pfr', [knFeed], { property_package: { model: 'pr', volume_translation: false }, phase: 'V', thermal: 'isothermal', T_K: c.T_K, P_bar: kn33.P_bar, volume_m3: c.V_m3, reactions: rxT });   // reference: thermo PRMIX without the volume shift
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

// ---------------------------------------------------------------------------
// STEP 34 — urea synthesis method, machine curves, compressor train,
// calculators, pseudo-components
// ---------------------------------------------------------------------------
const R34 = REF.step34;
const thermo = th;
const MW34 = (k) => compdb.get(k).mw;
const st34 = (mol, T, P) => { const ks = Object.keys(mol).filter((k) => mol[k] > 0); const m = ks.map((k) => mol[k] * MW34(k)); const t = m.reduce((a, b) => a + b, 0); return { mass_flow_kg_h: t, T_K: T, P_bar: P, components: ks.map((k, i) => ({ key: k, mass_fraction: m[i] / t })) }; };
// Table 8 / Table 9 over every point
const yRows34 = [], pRows34 = [];
let ySe = 0, yN = 0, yWorst = 0, pSe = 0, pN = 0, pWorst = 0;
for (const L of R34.urea_L) for (const t of R34.urea_t_C) {
  const ydev = [], pdev = [];
  R34.urea_W.forEach((W, j) => {
    const T = +t + 273.15;
    const ry = engine.runModule('r-urea-reactor', { streams: [st34({ NH3: 100 * +L, CO2: 100, H2O: 100 * W }, T, 350)], params: { mode: 'specified_T', T_out_K: T, P_out_bar: 350 } });
    const Y = 100 * ry.details.co2_conversion_equilibrium, Yr = R34.urea_Y_pct[L][t][j];
    ydev.push(Y - Yr); ySe += (Y - Yr) ** 2; yN++; yWorst = Math.max(yWorst, Math.abs(Y - Yr));
    const y = Yr / 100;
    const rp = engine.runModule('r-flash', { streams: [st34({ NH3: 100 * (+L - 2 * y), CO2: 100 * (1 - y), H2O: 100 * (W + y), urea: 100 * y }, T, 100)], params: { property_package: { model: 'urea' }, T_K: T, vapour_fraction: 0 } });
    const Pm = rp.error ? NaN : rp.streams_out[0].P_bar / 10, Pr = R34.urea_P_MPa[L][t][j];
    const e = (Pm - Pr) / Pr; pdev.push(e); if (num34(e)) { pSe += e * e; pN++; pWorst = Math.max(pWorst, Math.abs(e)); }
  });
  yRows34.push(`<tr><td>${L}</td><td>${t}</td>${ydev.map((v) => `<td>${f(v, 2)}</td>`).join('')}</tr>`);
  pRows34.push(`<tr><td>${L}</td><td>${t}</td>${pdev.map((v) => `<td>${f(100 * v, 1)}</td>`).join('')}</tr>`);
}
function num34(v) { return typeof v === 'number' && isFinite(v); }
const yRms34 = Math.sqrt(ySe / yN), pRms34 = Math.sqrt(pSe / pN);
// liquid enthalpies at 185 °C, 250 bar (all liquid)
const ppU = thermo.createPackage({ model: 'urea' }, ['CO2', 'H2O', 'NH3', 'urea']);
const ppI = thermo.createPackage({ model: 'ideal' }, ['CO2', 'H2O', 'NH3']);
const zU = (a) => { const S = a.reduce((x, y) => x + y, 0); return a.map((v) => v / S); };
const Hl = (a, T) => a.reduce((x, y) => x + y, 0) * ppU.hPhase(T, 250e5, zU(a), 'L');
const Hig = (a, T) => { const b = a.slice(0, 3); return b.reduce((x, y) => x + y, 0) * ppI.hPhase(T, 1e5, zU(b), 'V'); };
const a0 = [1, 0.5, 3, 0], a1 = [0.5, 1.0, 2, 0.5];
const dHc34 = (Hl(a0, 458.15) - Hig(a0, 458.15)) / 1000, dHu34 = (Hl(a1, 458.15) - Hl(a0, 458.15)) / 0.5 / 1000;
// machine curves
const rhoW = 992.2674305831472;
const pc34 = { flow_m3_h: [0, 40, 80, 100, 120, 140], head_m: [110, 108, 102, 96, 88, 77], efficiency: [0.05, 0.5, 0.72, 0.76, 0.74, 0.66], speed_rpm: 2950 };
const mcRows = [];
for (const [Q, N] of [[100, 2950], [90, 2655], [60, 2950]]) {
  const r = engine.runModule('pump', { streams: [{ mass_flow_kg_h: Q * rhoW, T_K: 313.15, P_bar: 2, components: [{ key: 'H2O', mass_fraction: 1 }] }], params: { property_package: { model: 'steam' }, curve: pc34, speed_rpm: N } });
  const c = r.details.curve;
  const hand = Q === 100 && N === 2950 ? 96 : Q === 90 ? 96 * 0.81 : null;
  mcRows.push(`<tr><td class="l">Pump, water 40 °C</td><td>${Q} m³/h, ${N} rpm</td><td>${f(c.head_m, 3)} m</td><td>${hand === null ? 'interpolated' : f(hand, 3) + ' m'}</td><td>${f(r.details.P_out_bar, 4)}</td><td>${f(100 * c.efficiency, 2)} %</td><td>${f(r.details.power_kW, 2)} kW</td></tr>`);
}
const cc34 = { flow_m3_h: [15000, 18000, 21000, 24000, 27000], head_kJkg: [118, 115, 110, 102, 90], efficiency: [0.74, 0.79, 0.81, 0.79, 0.72], speed_rpm: 7000, surge_flow_m3_h: 15500 };
const gas34 = (m) => ({ mass_flow_kg_h: m, T_K: 313.15, P_bar: 1.5, components: [{ key: 'CO2', mass_fraction: 0.99 }, { key: 'N2', mass_fraction: 0.01 }] });
const rhoG = 1000 / engine.runModule('compressor', { streams: [gas34(1000)], params: { property_package: { model: 'pr' }, P_out_bar: 2, efficiency: 0.8 } }).details.inlet_volume_m3_h;
for (const [Q, N] of [[21000, 7000], [21000, 6300], [15000, 7000]]) {
  const m = Q * rhoG;
  const r = engine.runModule('compressor', { streams: [gas34(m)], params: { property_package: { model: 'pr' }, curve: cc34, speed_rpm: N } });
  const c = r.details.curve;
  mcRows.push(`<tr><td class="l">CO₂ compressor, PR</td><td>${Q} m³/h, ${N} rpm</td><td>${f(c.head_kJkg, 2)} kJ/kg</td><td>${f(c.efficiency * (r.energy_balance.W_kW * 3600 / m), 2)} kJ/kg (η·Δh)</td><td>${f(r.details.P_out_bar, 3)}</td><td>${f(100 * c.efficiency, 2)} %</td><td>${f(r.energy_balance.W_kW, 0)} kW${c.surge ? ' — SURGE' : ' · surge margin ' + f(c.surge_margin_pct, 1) + ' %'}</td></tr>`);
}
const tr34 = engine.runModule('r-compressor-train', { streams: [st34({ CO2: 1000, H2O: 40, N2: 6 }, 313.15, 1.4)], params: { property_package: { model: 'pr' }, stages: 4, P_out_bar: 145, intercooler_T_K: 313.15, intercooler_dp_bar: [0.1, 0.3, 0.8, 0], efficiency: 0.78 } });
const trRows = tr34.details.stages.map((r) => `<tr><td>${r.stage}</td><td>${f(r.P_suction_bar, 2)} → ${f(r.P_discharge_bar, 2)}</td><td>${f(r.pressure_ratio, 4)}</td><td>${f(r.T_discharge_K - 273.15, 1)}</td><td>${f(r.power_kW, 0)}</td><td>${f(r.cooler_duty_kW, 0)}</td><td>${f(r.condensate_kg_h, 1)}</td></tr>`).join('\n');
const trQgap = Math.abs(tr34.energy_balance.Q_kW - tr34.details.total_cooling_kW);
// calculators
const gasC = st34({ CH4: 100, N2: 2 }, 600, 30), steamC = st34({ H2O: 50 }, 600, 30);
const baseC = { property_package: { model: 'pr' }, blocks: [{ id: 'H1', module: 'heater', n_in: 1, n_out: 1, params: { T_out_K: 700 } }, { id: 'M1', module: 'r-mixer', n_in: 2, n_out: 1, params: {} }],
  streams: [{ id: 'G', from: null, to: { b: 'H1', p: 0 }, feed: 0 }, { id: 'S', from: null, to: { b: 'M1', p: 1 }, feed: 1 }, { id: 'G2', from: { b: 'H1', p: 0 }, to: { b: 'M1', p: 0 } }, { id: 'P', from: { b: 'M1', p: 0 }, to: null }] };
const cff = engine.runModule('flowsheet', { streams: [gasC, steamC], params: Object.assign({}, baseC, { calculators: [{ name: 'S/C', imports: [{ name: 'ch4', stream: 'G2', metric: 'comp_kmol_h', key: 'CH4' }], code: 'steam = 3.0 * ch4 * 18.01528', exports: [{ name: 'steam', kind: 'feed_flow', stream: 'S' }] }] }) });
const cfb = engine.runModule('flowsheet', { streams: [gasC, steamC], params: Object.assign({}, baseC, { calculators: [{ name: 'Tctl', imports: [{ name: 'Tp', stream: 'P', metric: 'T_K' }, { name: 'Th', kind: 'param', block: 'H1', path: 'T_out_K' }], code: 'Tnew = Th + 1.5 * (650 - Tp)', exports: [{ name: 'Tnew', kind: 'param', block: 'H1', path: 'T_out_K' }] }] }) });
// pseudo-components vs databank hydrocarbons
const hcs = compdb.keys().map((k) => [k, compdb.get(k)]).filter(([, c]) => !c.ext && /^C\d+H\d+$/.test(c.formula || '') && c.tb >= 300 && c.tb <= 800 && c.rhol && c.tc && c.pc && num34(c.w) && +c.formula.match(/^C(\d+)/)[1] >= 5);
const st = {}; for (const m of ['twu', 'riazi', 'lee-kesler']) st[m] = { Tc: [], Pc: [], MW: [], w: [] };
const showK = ['nC7H16', 'n-decane', 'n-hexadecane', 'n-eicosane', 'cyclohexane', 'benzene', 'toluene', 'naphthalene'];
const psRows = [];
for (const [k, c] of hcs) {
  const SG = thermo.corr(c.rhol, 288.71, c.tc) * c.mw / 999.0;
  const row = [];
  for (const m of ['twu', 'riazi', 'lee-kesler']) {
    const r = pseudoMod.pseudoRecord({ Tb_K: c.tb, SG, method: m });
    const q = st[m]; q.Tc.push((r.tc - c.tc) / c.tc); q.Pc.push((r.pc - c.pc) / c.pc); q.MW.push((r.mw - c.mw) / c.mw); q.w.push(r.w - c.w);
    row.push(r);
  }
  if (showK.includes(k)) psRows.push(`<tr><td class="l">${c.name}</td><td>${f(c.tb, 1)}</td><td>${f(SG, 4)}</td><td>${f(c.tc, 1)} / ${f(row[0].tc, 1)} / ${f(row[1].tc, 1)} / ${f(row[2].tc, 1)}</td><td>${f(c.pc / 1e5, 2)} / ${f(row[0].pc / 1e5, 2)} / ${f(row[1].pc / 1e5, 2)} / ${f(row[2].pc / 1e5, 2)}</td><td>${f(c.mw, 1)} / ${f(row[0].mw, 1)} / ${f(row[1].mw, 1)}</td><td>${f(c.w, 3)} / ${f(row[0].w, 3)}</td></tr>`);
}
const rms34 = (a) => 100 * Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length);
const psStat = ['twu', 'riazi', 'lee-kesler'].map((m) => `<tr><td class="l">${m === 'twu' ? 'Twu (1984)' : m === 'riazi' ? 'Riazi–Daubert (1987)' : 'Kesler–Lee (1976), M Riazi–Daubert'}</td><td>${f(rms34(st[m].Tc), 2)} %</td><td>${f(rms34(st[m].Pc), 2)} %</td><td>${f(rms34(st[m].MW), 2)} %</td><td>${f(rms34(st[m].w) / 100, 3)}</td></tr>`).join('\n');
// n-decane-like pseudo vs n-decane on PR
const kPs = pseudoMod.registerPseudos([{ Tb_K: 447.3, SG: 0.7342 }])[0];
const decRows = [];
for (const [key, lbl] of [['n-decane', 'n-decane (databank)'], [kPs, 'pseudo-component, Tb 447.3 K, SG 0.7342']]) {
  const pp = thermo.createPackage({ model: 'pr' }, [key]);
  const pr = thermo.properties(pp, thermo.flashPT(pp, [1], 298.15, 1.01325e5));
  const nbp = thermo.flashPVF(pp, [1], 1.01325e5, 0).T, ps = thermo.flashTVF(pp, [1], 373.15, 0, 1e4).P;
  const dh = (thermo.hOf(pp, thermo.flashPT(pp, [1], 500, 1e5)) - thermo.hOf(pp, thermo.flashPT(pp, [1], 300, 1e5))) / 1000;
  decRows.push(`<tr><td class="l">${lbl}</td><td>${f(nbp, 2)}</td><td>${f(ps / 1000, 3)}</td><td>${f(pr.rho_kgm3, 1)}</td><td>${f(dh, 2)}</td><td>${f(pr.phases[0].mu_Pas * 1000, 3)}</td></tr>`);
}

// ---------------------------------------------------------------------------
// STEP 35 — solver transparency: the same recycle with each accelerator, and the design-spec Newton record
// ---------------------------------------------------------------------------
const rcB = engine.runModule(...vec('MB-276').args), rcW = engine.runModule(...vec('MB-277').args);
const spH = engine.runModule(...vec('MB-278').args);
const rcRef = vec('MB-100').expect['stream_results.rcy.mass_flow_kg_h'];
const M35 = { guess: 'guess', estimate: 'estimate', warm: 'warm', continued: 'continued', substitution: 'S', wegstein: 'W', broyden: 'B', retreat: 'R' };
const accRows = [['Broyden (default)', rcB], ['Wegstein only', rcW]].map(([lab, r]) => {
  const L = r.loops[0];
  return `<tr><td class="l">${lab}</td><td>${L.iterations}</td><td>${sci(L.err)}</td><td class="l">${L.history.map((h) => M35[h.method]).join(' → ')}</td><td>${f(r.stream_results.rcy.mass_flow_kg_h, 4)}</td><td>${f(rcRef, 4)}</td></tr>`;
}).join('\n');
const SH35 = spH.convergence.spec_history;
const spRows = SH35.steps.map((st) => `<tr><td>${st.iteration}</td><td>${f(st.varied[0], 5)}</td><td>${sci(st.residuals[0])}</td><td>${sci(st.scaled)}</td><td>${st.lambda == null ? '—' : f(st.lambda, 2)}</td><td>${st.evaluations}</td><td>${st.jacobian ? sci(st.jacobian[0][0]) : '—'}</td></tr>`).join('\n');
// ---------------------------------------------------------------------------
// STEP 36 — pinch analysis, equipment / utility costing and optimisation
// ---------------------------------------------------------------------------
const run36 = (id) => engine.runModule(...vec(id).args);
const pinchCases = [['MB-280', 'Four-stream problem, ΔTmin 10 K (Kemp, ch. 2)'], ['MB-281', 'Same streams, ΔTmin 20 K (hand problem table)'], ['MB-282', 'Threshold problem (hand)'], ['MB-283', 'Boiler feed 25 → 200 °C at 10 bar on IAPWS-IF97 vs hot oil']];
let s36Pass = 0, s36N = 0;
const chk36 = (a, b, tol) => { s36N++; const ok = Math.abs(a - b) <= tol; if (ok) s36Pass++; return ok; };
const pinchRows = pinchCases.map(([id, lab]) => {
  const d = run36(id).details, e = vec(id).expect, t = vec(id).tol;
  const tl = (k) => (typeof t[k] === 'number' ? t[k] : t.default);
  const pc = (k) => (e['details.' + k] === undefined ? '—' : f(e['details.' + k], 2));
  chk36(d.Q_hot_min_kW, e['details.Q_hot_min_kW'] === undefined ? d.Q_hot_min_kW : e['details.Q_hot_min_kW'], 1e-6);
  if (e['details.pinch_cold_K'] !== undefined) chk36(d.pinch_cold_K, e['details.pinch_cold_K'], tl('details.pinch_cold_K'));
  return `<tr><td class="l">${lab}</td><td>${f(d.Q_hot_min_kW, 2)}</td><td>${pc('Q_hot_min_kW')}</td><td>${f(d.Q_cold_min_kW, 2)}</td><td>${pc('Q_cold_min_kW')}</td><td>${d.threshold ? 'none' : f(d.pinch_hot_K - 273.15, 3) + ' / ' + f(d.pinch_cold_K - 273.15, 3)}</td><td>${e['details.threshold'] === true ? 'none' : e['details.pinch_cold_K'] !== undefined ? f(e['details.pinch_hot_K'] - 273.15, 3) + ' / ' + f(e['details.pinch_cold_K'] - 273.15, 3) : '—'}</td></tr>`;
}).join('\n');
const ec36 = run36('MB-284').economics;
const lg36 = Math.log10, esc36 = ec36.basis.cepci / ec36.basis.cepci_base;
const vesHand = Math.pow(10, 3.4974 + 0.4485 * lg36(20) + 0.1074 * lg36(20) ** 2) * esc36;
const dpA = ec36.items[0].parts[0].size, dpHand = Math.pow(10, 3.3444 + 0.2745 * lg36(dpA) - 0.0472 * lg36(dpA) ** 2) * esc36;
const crfHand = 0.1 * 1.1 ** 10 / (1.1 ** 10 - 1);
const sumBM = ec36.items.reduce((a, it) => a + it.CBM, 0), sumBM0 = ec36.items.reduce((a, it) => a + it.CBM0, 0);
const cgrHand = 1.18 * sumBM + 0.5 * sumBM0, tacHand = cgrHand * crfHand + 100 * 28.8 * 14;
const costRows = [
  ['Vertical vessel 20 m³, purchased (Cp⁰), USD', ec36.items[1].parts[0].Cp0, vesHand, 0],
  ['Vertical vessel, bare module (FBM 4.07), USD', ec36.items[1].parts[0].CBM, vesHand * 4.07, 0],
  ['Double-pipe exchanger ' + f(dpA, 3) + ' m², purchased, USD', ec36.items[0].parts[0].Cp0, dpHand, 0],
  ['Capital recovery factor, 10 % over 10 years', ec36.basis.crf, crfHand, 6],
  ['Grassroots capital 1.18 ΣC_BM + 0.5 ΣC_BM⁰, USD', ec36.totals.grassroots, cgrHand, 0],
  ['LP steam, 100 kW × 8000 h × 14 USD/GJ, USD/y', ec36.utilities[0].cost_y, 40320, 0],
  ['Total annual cost, USD/y', ec36.totals.total_annual_cost_y, tacHand, 0],
].map(([lab, a, b, d]) => { chk36(a, b, Math.max(1e-6, 2e-5 * Math.abs(b))); return `<tr><td class="l">${lab}</td><td>${f(a, d)}</td><td>${f(b, d)}</td><td>${sci((a - b) / b)}</td></tr>`; }).join('\n');
const optCases = [['MB-287', 'One variable, T₁ 300–420 K (Brent)', [350], 1600], ['MB-288', 'One variable with T₁ ≤ 340 K', [340], null], ['MB-289', 'Two variables, T₁ and P₁ 2–9 bar (Nelder–Mead)', [350, 4], 1500]];
const optRows = optCases.map(([id, lab, xs, fo]) => {
  const O = run36(id).optimization;
  O.variables.forEach((v, k) => chk36(v.value, xs[k], 0.005 * (v.hi - v.lo)));
  return `<tr><td class="l">${lab}</td><td>${O.variables.map((v) => f(v.value, 4)).join(', ')}</td><td>${xs.join(', ')}</td><td>${f(O.objective, 2)}</td><td>${fo === null ? f(1000 + 500 + 1000 + 100, 2) + ' at 340 K' : f(fo, 2)}</td><td>${O.evaluations}</td><td>${O.feasible ? 'yes' : 'NO'}</td></tr>`;
}).join('\n');

/* ---------- STEP 37: structure-based components, UNIFAC fill-in, transport properties ---------- */
const R37 = REF.step37;
const TH37 = thermoModule.default || thermoModule, UC37 = usercompMod.default || usercompMod;
const ucRun = (list) => engine.runModule('user-components', { streams: [], params: { user_components: list } });
// (a) group assignment against thermo + RDKit
const gKey = (o) => JSON.stringify(Object.keys(o || {}).map(Number).sort((a, b) => a - b).map((k) => [k, o[k]]));
const gList = (a) => gKey(Object.fromEntries((a || []).map((g) => [g.id, g.n])));
const fragAgree = { unifac: 0, modunifac: 0, joback: 0 }, fragMiss = [];
for (const m of R37.frag) {
  const r = ucRun([{ name: m.key, smiles: m.smiles }]);
  if (r.error) { fragMiss.push(`${m.key}: ${r.error.message}`); continue; }
  const c = r.details.components[0];
  if (gList(c.unifac) === gKey(m.unifac)) fragAgree.unifac++; else fragMiss.push(`${m.key} UNIFAC ${gList(c.unifac)} vs ${gKey(m.unifac)}`);
  if (gList(c.modunifac) === gKey(m.modunifac)) fragAgree.modunifac++; else fragMiss.push(`${m.key} Dortmund ${gList(c.modunifac)} vs ${gKey(m.modunifac)}`);
  if (gList(c.joback.groups) === gKey(m.joback)) fragAgree.joback++; else fragMiss.push(`${m.key} Joback ${gList(c.joback.groups)} vs ${gKey(m.joback)}`);
}
const nFrag = R37.frag.length;
if (fragAgree.unifac < nFrag - 2 || fragAgree.modunifac < nFrag - 2 || fragAgree.joback < nFrag - 1) fail('group assignment: ' + fragMiss.join('; '));
const FO = R37.frag_offline;
const fragRows = [['UNIFAC (original)', fragAgree.unifac, FO.unifac_pct, FO.ddbst_unifac_pct, FO.thermo_ddbst_unifac_pct], ['Modified UNIFAC (Dortmund)', fragAgree.modunifac, FO.modunifac_pct, FO.ddbst_modunifac_pct, FO.thermo_ddbst_modunifac_pct], ['Joback', fragAgree.joback, FO.joback_pct, null, null]]
  .map(([lab, a, off, dd, td]) => `<tr><td class="l">${lab}</td><td>${a} / ${nFrag}</td><td>${f(off, 1)} %</td><td>${dd === null ? '—' : f(dd, 1) + ' % / ' + f(td, 1) + ' %'}</td></tr>`).join('\n');
// (b) estimates against the ChemSep databank (structure only, then with the measured Tb)
const est37 = {}, addE = (k, e) => { if (Number.isFinite(e)) (est37[k] = est37[k] || []).push(e); };
let estFail = 0, estN = 0;
const estKeys = compdb.keys().filter((k) => { const c = compdb.get(k); return c.smiles && !c.ext && !c.user && !c.pseudo && !/^UC[0-9A-F]{8}$/.test(k) && c.cat !== 'inorganic' && c.cat !== 'mixture' && /C/.test(c.formula || ''); });
for (const withTb of [false, true]) for (const k of estKeys) {
  const c = TH37.component(k);
  let r;
  try { r = UC37.userRecord(withTb ? { smiles: c.smiles, Tb_K: c.tb } : { smiles: c.smiles }); } catch (e) { if (!withTb) estFail++; continue; }
  if (!withTb) estN++;
  const rel = (a, b) => (a - b) / b * 100, p = withTb ? 'tb' : 's';
  if (!withTb) addE('s Tb', rel(r.tb, c.tb));
  addE(p + ' Tc', rel(r.tc, c.Tc)); addE(p + ' Pc', rel(r.pc, c.Pc)); addE(p + ' Vc', rel(r.vc, c.vc)); addE(p + ' w', r.w - c.omega);
  if (withTb) continue;
  addE('Hf', (r.hf - c.hf) / 1e6);
  const T0 = 298.15, cpU = (r.cpig[1] + T0 * (r.cpig[2] + T0 * (r.cpig[3] + T0 * r.cpig[4]))) / 1000;
  addE('cp', rel(cpU, (c._cp.at(T0 + 0.05)[0] - c._cp.at(T0 - 0.05)[0]) / 0.1));
  const T = c.tb > 320 ? T0 : 0.8 * c.tb;
  if (c.rhol) addE('rho', rel(TH37.corr(r.rhol, T, r.tc) * r.mw, TH37.corr(c.rhol, T, c.Tc) * c.mw));
  const tmp = Object.assign({}, r, { key: 'tmp', MW: r.mw, Tc: r.tc, Pc: r.pc, omega: r.w });
  const inR = (q, t) => q && t >= q[6] && t <= q[7];
  if (inR(c.mul, T)) addE('muL', rel(TH37.pureMuL(tmp, T), corr37Safe(c.mul, T, c.Tc)));
  if (inR(c.kl, T)) addE('kL', rel(TH37.pureKL(tmp, T), corr37Safe(c.kl, T, c.Tc)));
  if (inR(c.st, T)) addE('sig', rel(TH37.pureSigma(tmp, T), corr37Safe(c.st, T, c.Tc)));
  const Tv = Math.max(c.tb * 1.1, 350);
  if (inR(c.muv, Tv)) addE('muV', rel(TH37.pureMuV(tmp, Tv), corr37Safe(c.muv, Tv, c.Tc)));
}
function corr37Safe(q, T, Tc) { try { return TH37.corr(q, T, Tc); } catch (e) { return NaN; } }
const qtl = (a, q) => { const s2 = a.slice().sort((x, y) => x - y); return s2[Math.floor(q * (s2.length - 1))]; };
const estRow = (lab, k, unit, d) => {
  const a = est37[k]; if (!a || a.length < 50) fail('estimate statistics: too few points for ' + k);
  const abs = a.map(Math.abs);
  return `<tr><td class="l">${lab}</td><td>${a.length}</td><td>${f(qtl(abs, 0.5), d)}${unit}</td><td>${f(qtl(abs, 0.9), d)}${unit}</td><td>${f(a.reduce((x, y) => x + y, 0) / a.length, d)}${unit}</td></tr>`;
};
const estRows = [
  ['Normal boiling point Tb (Joback)', 's Tb', ' %', 1], ['Critical temperature Tc (Joback through the estimated Tb)', 's Tc', ' %', 1], ['Tc with the measured Tb', 'tb Tc', ' %', 1],
  ['Critical pressure Pc (Joback)', 's Pc', ' %', 1], ['Critical volume Vc (Joback)', 's Vc', ' %', 1], ['Acentric factor ω (Lee–Kesler; the same with the measured Tb, since Joback fixes Tc/Tb), absolute', 's w', '', 3],
  ['ΔHf° ideal gas (Joback), kJ/mol', 'Hf', '', 1], ['Ideal-gas Cp at 25 °C (Joback)', 'cp', ' %', 1], ['Liquid density (Rackett, Tyn–Calus anchor)', 'rho', ' %', 1],
  ['Liquid viscosity (Joback; n-paraffin reference where Joback has no groups)', 'muL', ' %', 1], ['Liquid thermal conductivity (Sato–Riedel)', 'kL', ' %', 1],
  ['Surface tension (Brock–Bird; Sastri–Rao for alcohols and acids)', 'sig', ' %', 1], ['Low-pressure vapour viscosity (Chung)', 'muV', ' %', 1],
].map((a) => estRow(...a)).join('\n');
// (c) UNIFAC fill-in against ChemSep NRTL for pairs that have data
const fillPairs = [['EtOH', 'H2O'], ['acetone', 'H2O'], ['MeOH', 'H2O'], ['acetone', 'MeOH'], ['EtOH', 'benzene'], ['chloroform', 'acetone'], ['nC6H14', 'EtOH'], ['toluene', 'MeOH'], ['MeOH', 'benzene'], ['acetone', 'benzene']];
const NM37 = { EtOH: 'ethanol', H2O: 'water', MeOH: 'methanol', nC6H14: 'n-hexane' };
let fillWorst = 0;
const fillRows = fillPairs.map(([a, b]) => {
  const fit = TH37.fitPairFromUNIFAC('nrtl', TH37.component(a), TH37.component(b));
  if (!fit) fail('fill-in: no fit for ' + a + '–' + b);
  const ppC = TH37.createPackage({ model: 'nrtl', fill_missing: 'none' }, [a, b]);
  const ppE = TH37.createPackage({ model: 'nrtl', fill_missing: 'none', nrtl: { [a + '|' + b]: { a: fit.a12, b: fit.b12, alpha: 0.3 }, [b + '|' + a]: { a: fit.a21, b: fit.b21, alpha: 0.3 } } }, [a, b]);
  const dT = [0.1, 0.3, 0.5, 0.7, 0.9].map((x) => TH37.flashPVF(ppE, [x, 1 - x], 101325, 0).T - TH37.flashPVF(ppC, [x, 1 - x], 101325, 0).T);
  const w = Math.max(...dT.map(Math.abs)); fillWorst = Math.max(fillWorst, w);
  return `<tr><td class="l">${esc(NM37[a] || a)} – ${esc(NM37[b] || b)}</td><td class="l">${esc(fit.source)}</td><td>${f(fit.rms, 3)}</td>${dT.map((v) => `<td>${f(v, 2)}</td>`).join('')}</tr>`;
}).join('\n');
if (fillWorst > 4) fail('fill-in: bubble-temperature difference ' + fillWorst + ' K');
// (d) vectors
const C0 = 'details.components.0.';
Object.assign(NICE, { [C0 + 'MW']: 'molar mass, kg/kmol', [C0 + 'Tb_K']: 'Tb, K', [C0 + 'Tc_K']: 'Tc, K', [C0 + 'Pc_bar']: 'Pc, bar', [C0 + 'Vc_m3kmol']: 'Vc, m³/kmol',
  [C0 + 'Hf_kJmol']: 'ΔHf° (gas), kJ/mol', [C0 + 'Gf_kJmol']: 'ΔGf° (gas), kJ/mol', [C0 + 'cp298_JmolK']: 'Cp ideal gas 25 °C, J/(mol·K)', [C0 + 'omega']: 'acentric factor ω',
  [C0 + 'joback.groups.2.id']: 'Joback group 3 (−OH alcohol = 20)', [C0 + 'unifac.0.id']: 'UNIFAC group 1, id', [C0 + 'unifac.0.n']: 'UNIFAC group 1, count', [C0 + 'unifac.1.id']: 'UNIFAC group 2, id',
  [C0 + 'unifac.1.n']: 'UNIFAC group 2, count', [C0 + 'modunifac.0.id']: 'Dortmund group 1, id', [C0 + 'modunifac.0.n']: 'Dortmund group 1, count', [C0 + 'modunifac.1.id']: 'Dortmund group 2, id',
  [C0 + 'modunifac.1.n']: 'Dortmund group 2, count', [C0 + 'modunifac.2.id']: 'Dortmund group 3, id', 'details.y.benzene': 'vapour y benzene', 'details.y.UC5ADF6CCF': 'vapour y ethanol (user component)',
  'details.rows.0.phases.vapour.mu_cP': 'vapour viscosity, cP', 'details.rows.0.phases.vapour.k_WmK': 'vapour conductivity, W/(m·K)', 'details.rows.0.phases.liquid.k_WmK': 'liquid conductivity, W/(m·K)',
  'details.rows.0.phases.liquid.sigma_mNm': 'surface tension, mN/m' });
const ucVecTable = vecTable(range(291, 295), 'uc');
const fillVecTable = vecTable(['MB-298', 'MB-299', 'MB-300', 'MB-302'], 'fill');
// (e) transport against CoolProp
const ptab37 = (comps, T, extra) => {
  const r = engine.runModule('property-table', { streams: [{ mass_flow_kg_h: 100, T_K: T, P_bar: 1.01325, components: comps }],
    params: Object.assign({ property_package: { model: 'pr' }, vary: 'T', from: T, to: T + 50, points: 2, P_bar: 1.01325 }, extra || {}) });
  if (r.error) fail('property-table: ' + r.error.message);
  return r.details.rows[0].phases;
};
const tpDev = { db: { rho: [], mu: [], k: [], sig: [] }, est: { rho: [], mu: [], k: [], sig: [] } };
const tpCell = (v, ref, bucket, key) => { const d = (v - ref) / ref * 100; if (bucket) bucket[key].push(Math.abs(d)); return `<td>${f(v, key === 'rho' ? 1 : key === 'sig' ? 2 : 4)} <span class="dim">(${d >= 0 ? '+' : ''}${f(d, 1)} %)</span></td>`; };
const tpRows = R37.coolprop_liquids.map((q) => {
  const ld = ptab37([{ key: q.key, mass_fraction: 1 }], q.T_K).liquid;
  const u = ucRun([{ name: q.fluid, smiles: q.smiles }]); if (u.error) fail(q.fluid + ': ' + u.error.message);
  const uk = u.details.components[0].key;
  const le = ptab37([{ key: uk, mass_fraction: 1 }], q.T_K, { user_components: [{ name: q.fluid, smiles: q.smiles }] }).liquid;
  const row = (lab, ph, b) => `<tr><td class="l">${lab}</td>${tpCell(ph.rho_kgm3, q.rho_kgm3, b, 'rho')}${tpCell(ph.mu_cP, q.mu_cP, b, 'mu')}${tpCell(ph.k_WmK, q.k_WmK, b, 'k')}${tpCell(ph.sigma_mNm, q.sigma_mNm, b, 'sig')}</tr>`;
  return `<tr><td class="l" colspan="5"><b>${esc(q.fluid)}</b> · CoolProp: ρ ${f(q.rho_kgm3, 1)}, μ ${f(q.mu_cP, 4)}, k ${f(q.k_WmK, 4)}, σ ${f(q.sigma_mNm, 2)}</td></tr>\n` +
    row('databank (ChemSep correlations)', ld, tpDev.db) + '\n' + row('from the SMILES alone', le, tpDev.est);
}).join('\n');
const avg37 = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const MWa = { N2: 28.0134, O2: 31.9988, Ar: 39.948 }, xa = { N2: 0.7812, O2: 0.2096, Ar: 0.0092 };
const mma = Object.keys(xa).reduce((t, k) => t + xa[k] * MWa[k], 0);
const airC = Object.keys(xa).map((k) => ({ key: k, mass_fraction: xa[k] * MWa[k] / mma }));
const airRows = R37.coolprop_air.map((q) => {
  const v = ptab37(airC, q.T_K).vapour;
  return `<tr><td>${f(q.T_K, 0)}</td><td>${f(v.mu_cP * 1e3, 3)}</td><td>${f(q.mu_cP * 1e3, 3)}</td><td>${f((v.mu_cP - q.mu_cP) / q.mu_cP * 100, 1)} %</td><td>${f(v.k_WmK * 1e3, 2)}</td><td>${f(q.k_WmK * 1e3, 2)}</td><td>${f((v.k_WmK - q.k_WmK) / q.k_WmK * 100, 1)} %</td></tr>`;
}).join('\n');
const s37vec = vecTable(range(303, 305), 'tp');
console.log(`Step 37: groups ${fragAgree.unifac}/${fragAgree.modunifac}/${fragAgree.joback} of ${nFrag} · estimates over ${estN} molecules · fill-in worst ΔTbub ${f(fillWorst, 2)} K · transport vs CoolProp mean |Δ| databank μ ${f(avg37(tpDev.db.mu), 1)} % SMILES μ ${f(avg37(tpDev.est.mu), 1)} %`);

/* ---------- STEP 38: aqueous electrolytes (PHREEQC pitzer.dat) and sour water ---------- */
const R38 = REF.step38;
const MW38 = { H2O: 18.01528, NaCl: 58.4428, KCl: 74.5513, CaCl2: 110.984, MgCl2: 95.211, Na2SO4: 142.0421, K2SO4: 174.2592, MgSO4: 120.3676, CaSO4: 136.1406, NaOH: 39.99711,
  KOH: 56.10564, Na2CO3: 105.9884, NaHCO3: 84.0066, K2CO3: 138.2055, KHCO3: 100.1151, H2SO4: 98.0785, CO2: 44.0095, HCl: 36.4609, NH3: 17.03052, H2S: 34.08088 };
const liq38 = (mol, T, model, P0) => {
  const P = P0 || (T > 368 ? 10 : 1.01325);           // keep the solution liquid
  const m = { H2O: 1000 }; for (const [k, v] of Object.entries(mol)) m[k] = v * MW38[k];
  const tot = Object.values(m).reduce((a, b) => a + b, 0);
  const r = engine.runModule('property-table', { streams: [{ mass_flow_kg_h: tot, T_K: T, P_bar: P, components: Object.entries(m).map(([key, v]) => ({ key, mass_fraction: v / tot })) }],
    params: { property_package: { model }, vary: 'T', from: T, to: T + 1, points: 2, P_bar: P } });
  if (r.error) fail('STEP 38 property-table: ' + r.error.message);
  const L = r.details.rows[0].phases.liquid;
  if (!L || !L.acid_gas) fail('STEP 38: no liquid report at ' + T + ' K for ' + JSON.stringify(mol));
  return L;
};
const molsOf = (c) => Object.assign({}, c.salts || {}, c.CO2 ? { CO2: c.CO2 } : {}, c.HCl ? { HCl: c.HCl } : {});
// (a) the implementation against PHREEQC itself
const w38 = { aw: 0, phi: 0, pH: 0, si: 0, nSi: 0 };
const pq38Rows = R38.pq.map((c) => {
  const ag = liq38(molsOf(c), c.T_K, 'aqueous-electrolyte').acid_gas, r = c.ref;
  const daw = Math.abs(ag.water_activity - r.aw), dphi = Math.abs(ag.osmotic_coefficient - r.phi), dpH = Math.abs(ag.pH - r.pH);
  let dsi = 0, nsi = 0;
  for (const [ph, v] of Object.entries(r.si)) { const e = ag.saturation_index[ph]; if (!Number.isFinite(e)) fail('STEP 38: no SI ' + ph + ' for ' + c.label); dsi = Math.max(dsi, Math.abs(e - v)); nsi++; }
  w38.aw = Math.max(w38.aw, daw); w38.phi = Math.max(w38.phi, dphi); w38.pH = Math.max(w38.pH, dpH); w38.si = Math.max(w38.si, dsi); w38.nSi += nsi;
  if (daw > 2e-4 || dpH > 0.01 || dsi > 0.01) fail(`STEP 38 vs PHREEQC: ${c.label} ${c.T_K} K aw ${daw} pH ${dpH} SI ${dsi}`);
  return `<tr><td class="l">${sub(c.label)}</td><td>${f(c.T_K - 273.15, 0)}</td><td>${f(ag.water_activity, 5)}</td><td>${f(r.aw, 5)}</td><td>${f(ag.osmotic_coefficient, 4)}</td><td>${f(r.phi, 4)}</td><td>${f(ag.pH, 3)}</td><td>${f(r.pH, 3)}</td><td>${nsi ? sci(dsi) + ' (' + nsi + ')' : '—'}</td></tr>`;
}).join('\n');
// (b) independent references
const AQ = aqelecMod.default || aqelecMod;
const aqImpl = (keys) => AQ.makeAqElec(keys, { aphi: aphi38, psatW: (T) => TH37.psat(TH37.component('H2O'), T), lnKhCO2: (T) => TH37.lnKhG704('CO2', T) });
const aqAt = (mol, T) => { const keys = ['H2O', ...Object.keys(mol)]; const im = aqImpl(keys); const xs = im.sub(keys.map((k) => (k === 'H2O' ? 1000 / MW38.H2O : mol[k]))); return { im, xs, rep: im.report(T, xs), rel: im.lnRel(T, xs) }; };
let hw38Worst = 0;
const hw38Rows = R38.hamer_wu.rows.map(([m, phi, g]) => {
  const q = aqAt({ NaCl: m }, 298.15), ge = Math.exp(0.5 * q.rel.NaCl) / m;
  if (m <= 5) hw38Worst = Math.max(hw38Worst, Math.abs(q.rep.osmotic_coefficient - phi) / phi, Math.abs(ge - g) / g);
  return `<tr><td>${m}</td><td>${f(q.rep.osmotic_coefficient, 4)}</td><td>${f(phi, 4)}</td><td>${f(ge, 3)}</td><td>${f(g, 3)}</td></tr>`;
}).join('\n');
if (hw38Worst > 0.004) fail('STEP 38: NaCl vs Hamer & Wu ' + hw38Worst);
const solub38 = (salt, phase, T, lo, hi) => { for (let i = 0; i < 60; i++) { const mid = Math.sqrt(lo * hi); if (aqAt({ [salt]: mid }, T).rep.saturation_index[phase] > 0) hi = mid; else lo = mid; } return Math.sqrt(lo * hi); };
const sol38Rows = [];
for (const [T, ref] of R38.solubility.halite.rows) { const m = solub38('NaCl', 'Halite', T, 3, 9); sol38Rows.push(`<tr><td class="l">Halite (NaCl)</td><td>${f(T - 273.15, 0)}</td><td>${f(m, 3)} mol/kg</td><td>${f(ref, 3)}</td><td>${f((m - ref) / ref * 100, 1)} %</td></tr>`); if (Math.abs(m - ref) / ref > 0.015) fail('halite solubility ' + T); }
for (const [T, ref] of R38.solubility.gypsum.rows) { const m = 1000 * solub38('CaSO4', 'Gypsum', T, 0.001, 0.1); sol38Rows.push(`<tr><td class="l">Gypsum (CaSO₄·2H₂O)</td><td>${f(T - 273.15, 0)}</td><td>${f(m, 2)} mmol/kg</td><td>${f(ref, 1)}</td><td>${f((m - ref) / ref * 100, 1)} %</td></tr>`); if (Math.abs(m - ref) / ref > 0.03) fail('gypsum solubility'); }
let Ttr38 = 0; { let lo = 313.15, hi = 353.15; for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (solub38('CaSO4', 'Gypsum', mid, 0.001, 0.1) < solub38('CaSO4', 'Anhydrite', mid, 0.0005, 0.1)) lo = mid; else hi = mid; } Ttr38 = 0.5 * (lo + hi); }
const tw38 = { rho: 0, cp: 0, aw: 0 };
const teos38Rows = R38.teos10.rows.map((q) => {
  const mol = Object.fromEntries(Object.entries(R38.teos10.composition).map(([k, v]) => [k, v * q.factor]));
  const L = liq38(mol, q.t_C + 273.15, 'aqueous-electrolyte');
  const dr = (L.rho_kgm3 - q.rho) / q.rho * 100, dc = (L.Cp_kJkgK * 1000 - q.cp) / q.cp * 100, da = L.acid_gas.water_activity - q.aw;
  tw38.rho = Math.max(tw38.rho, Math.abs(dr)); tw38.cp = Math.max(tw38.cp, Math.abs(dc)); tw38.aw = Math.max(tw38.aw, Math.abs(da));
  return `<tr><td>${f(q.SA, 2)}</td><td>${q.t_C}</td><td>${f(L.rho_kgm3, 2)}</td><td>${f(q.rho, 2)}</td><td>${f(dr, 2)} %</td><td>${f(L.Cp_kJkgK * 1000, 1)}</td><td>${f(q.cp, 1)}</td><td>${f(dc, 2)} %</td><td>${f(L.acid_gas.water_activity, 5)}</td><td>${f(q.aw, 5)}</td></tr>`;
}).join('\n');
if (tw38.rho > 0.2 || tw38.cp > 0.6 || tw38.aw > 2e-4) fail('STEP 38 seawater vs TEOS-10 ' + JSON.stringify(tw38));
// (c) sour water against measured partial pressures: liquid fugacity from the engine's sour-water
// package at the measured total pressure (Poynting included) against p_i·φ_i of the measured vapour
// (Peng–Robinson), the same comparison the parameter fit used
const SR38 = R38.sour, sw38Stat = {};
const KS38 = ['H2O', 'NH3', 'CO2', 'H2S'];
const ppSW38 = TH37.createPackage({ model: 'sour-water' }, KS38), ppPR38 = TH37.createPackage({ model: 'pr' }, KS38);
const mmHg38 = 133.322;
const sw38Pt = (set, T, mol, p, Ptot) => {      // mol: {NH3,CO2,H2S} per kg water; p: measured partial pressures Pa (H2O optional)
  const n = KS38.map((k) => (k === 'H2O' ? 1000 / MW38.H2O : Math.max(mol[k] || 0, 1e-12)));
  const tn = n.reduce((a, b) => a + b, 0), x = n.map((v) => v / tn);
  const P = Ptot || KS38.reduce((a, k) => a + (p[k] || 0), 0);
  const y = KS38.map((k) => (p[k] || 0) / P);
  if (!p.H2O) y[0] = Math.max(1 - y[1] - y[2] - y[3], 1e-6);
  const ys = y.reduce((a, b) => a + b, 0);
  const lpL = ppSW38.lnFug(T, P, x, 'L'), lpV = ppPR38.lnFug(T, P, y.map((v) => Math.max(v, 1e-12) / ys), 'V');
  KS38.forEach((k, i) => {
    if (k === 'H2O' || !(p[k] > 0)) return;
    const d = (Math.log(x[i]) + lpL[i] + Math.log(P)) - (Math.log(p[k]) + lpV[i]);
    const key = set + '|' + { NH3: 'NH₃', CO2: 'CO₂', H2S: 'H₂S' }[k];
    (sw38Stat[key] = sw38Stat[key] || []).push(d);
  });
};
for (const [t, mN, mC, P, pN, pC] of SR38.muller.rows) sw38Pt('Müller (1983)', t + 273.15, { NH3: mN, CO2: mC }, { NH3: pN === 0.285 ? 0 : pN * 1e5, CO2: pC * 1e5 }, P * 1e5);
for (const [T, xN, xC, xS, xW, pN, pC, pS, pW] of SR38.wilson85.rows) { const w = xW / 100 * MW38.H2O / 1000; sw38Pt('Wilson, Gillespie & Owens (1985)', T, { NH3: xN / 100 / w, CO2: xC / 100 / w, H2S: xS / 100 / w }, { NH3: pN * 1e5, CO2: pC * 1e5, H2S: pS * 1e5, H2O: pW * 1e5 }); }
for (const [mN, mS, pN, pS] of SR38.api80.rows) { if (mN > 12) continue; sw38Pt('API data, 80 °C', 353.15, { NH3: mN, H2S: mS }, { NH3: pN * mmHg38, H2S: pS * mmHg38 }, (pN + pS) * mmHg38 + 0.95 * TH37.psat(TH37.component('H2O'), 353.15)); }
for (const [cS, cN, T, pS, pN, pW] of SR38.leyko.rows) { const ws = 1 - (cN * 17.03 + cS * 34.08) / 1000; sw38Pt('Leyko (1959)', T, { NH3: cN / ws, H2S: cS / ws }, { NH3: pN * mmHg38, H2S: pS * mmHg38, H2O: pW * mmHg38 }); }
const sw38Liq = (T, mol) => liq38(mol, T, 'sour-water', 20).acid_gas;
const sw38All = Object.values(sw38Stat).flat();
const sw38Mean = sw38All.reduce((a, x) => a + Math.abs(x), 0) / sw38All.length;
const sw38Rows = Object.entries(sw38Stat).map(([k, a]) => { const [set, sp] = k.split('|'); const m = a.reduce((s, x) => s + Math.abs(x), 0) / a.length, b = a.reduce((s, x) => s + x, 0) / a.length;
  return `<tr><td class="l">${esc(set)}</td><td>${sp}</td><td>${a.length}</td><td>${f((Math.exp(m) - 1) * 100, 0)} %</td><td>${b >= 0 ? '+' : ''}${f((Math.exp(b) - 1) * 100, 0)} %</td></tr>`; }).join('\n');
if (sw38Mean > 0.2) fail('STEP 38 sour water mean |ln ratio| ' + sw38Mean);
const h2s38Rows = [283.15, 298.15, 323.15, 353.15, 393.15, 423.15].map((T) => {
  const A = SR38.h2s_iupac.A, x1 = Math.exp(A[0] + A[1] / T + A[2] * Math.log(T) + A[3] * T), m = 0.05, x = m / (1000 / MW38.H2O + m);
  const pe = sw38Liq(T, { H2S: m }).P_H2S_eq_kPa, pr = 101.325 * x / x1;
  return `<tr><td>${f(T - 273.15, 0)}</td><td>${f(pe, 2)}</td><td>${f(pr, 2)}</td><td>${f((pe - pr) / pr * 100, 1)} %</td></tr>`;
}).join('\n');
const hsol38f = (key, m) => { const d = 0.5, a = sw38Liq(298.15 + d, { [key]: m }), b = sw38Liq(298.15 - d, { [key]: m }); const pk = 'P_' + key + '_eq_kPa'; return 8.314462618 * (Math.log(a[pk]) - Math.log(b[pk])) / (1 / (298.15 + d) - 1 / (298.15 - d)) / 1000; };
const hsol38Rows = [['NH₃', 'NH3', 0.1, '−34.1 to −34.9 (4100–4200 K)'], ['H₂S', 'H2S', 0.05, '−17.5 (2100 K)'], ['CO₂', 'CO2', 0.05, '−20.0 (2400 K)']]
  .map(([lab, k, m, ref]) => `<tr><td class="l">${lab}</td><td>${m}</td><td>${f(hsol38f(k, m), 1)}</td><td>${ref}</td></tr>`).join('\n');
Object.assign(NICE, { 'details.rows.0.phases.liquid.acid_gas.water_activity': 'water activity', 'details.rows.0.phases.liquid.acid_gas.osmotic_coefficient': 'osmotic coefficient',
  'details.rows.0.phases.liquid.acid_gas.pH': 'pH (MacInnes scale)', 'details.rows.0.phases.liquid.acid_gas.ionic_strength_mol_kg': 'ionic strength, mol/kg',
  'details.rows.0.phases.liquid.acid_gas.P_CO2_eq_kPa': 'equilibrium CO₂ pressure, kPa', 'details.rows.0.phases.liquid.acid_gas.P_NH3_eq_kPa': 'equilibrium NH₃ pressure, kPa',
  'details.rows.0.phases.liquid.acid_gas.P_H2S_eq_kPa': 'equilibrium H₂S pressure, kPa', 'details.rows.0.phases.liquid.rho_kgm3': 'liquid density, kg/m³', 'details.rows.0.phases.liquid.Cp_kJkgK': 'liquid Cp, kJ/(kg·K)' });
for (const ph of ['Halite', 'Calcite', 'Dolomite', 'Gypsum', 'Anhydrite', 'Brucite']) NICE['details.rows.0.phases.liquid.acid_gas.saturation_index.' + ph] = 'saturation index, ' + ph.toLowerCase();
const s38vec = vecTable(range(306, 326), 'aq');
console.log(`Step 38: vs PHREEQC worst aw ${sci(w38.aw)} φ ${sci(w38.phi)} pH ${sci(w38.pH)} SI ${sci(w38.si)} · Hamer & Wu worst ${f(100 * hw38Worst, 2)} % · TEOS-10 ρ ${f(tw38.rho, 2)} % cp ${f(tw38.cp, 2)} % · sour water mean ${f((Math.exp(sw38Mean) - 1) * 100, 1)} % · gypsum/anhydrite ${f(Ttr38 - 273.15, 1)} °C`);

/* ---------- STEP 39: liquid enthalpy of the activity-coefficient methods ---------- */
const R39 = REF.step39;
const pk39 = {};
const pkg39 = (key, spec) => { const k = key + JSON.stringify(spec); return pk39[k] || (pk39[k] = TH37.createPackage(spec, [key, 'N2'])); };
const cpOf39 = (key, T, P, spec) => { const pp = pkg39(key, spec), c = TH37.component(key), d = 0.25; const h = (t) => pp.hPhase(t, P, [1, 0], 'L'); return (h(T + d) - h(T - d)) / (2 * d) / c.MW * 1000 / 1000; };
const dev39 = { cp: [], hvap: [] };
const cp39Rows = R39.cp.map((r) => {
  const c = TH37.component(r.key);
  const a = cpOf39(r.key, r.T_K, r.P_Pa, { model: 'nrtl' }), b = cpOf39(r.key, r.T_K, r.P_Pa, { model: 'nrtl', liquid_enthalpy: 'hvap' });
  const da = (a - r.cp_kJkgK) / r.cp_kJkgK * 100, db = (b - r.cp_kJkgK) / r.cp_kJkgK * 100;
  if (r.T_K <= c.tb + 1) { dev39.cp.push(Math.abs(da)); dev39.hvap.push(Math.abs(db)); }
  return `<tr><td class="l">${esc(r.label)}</td><td>${f(r.T_K - 273.15, 0)}</td><td>${f(r.cp_kJkgK, 3)}</td><td>${f(a, 3)} <span class="dim">(${da >= 0 ? '+' : ''}${f(da, 1)} %)</span></td><td>${f(b, 3)} <span class="dim">(${db >= 0 ? '+' : ''}${f(db, 1)} %)</span></td></tr>`;
}).join('\n');
const mean39 = (a) => a.reduce((x, y) => x + y, 0) / a.length;
if (mean39(dev39.cp) > 2) fail('STEP 39 liquid Cp mean deviation ' + mean39(dev39.cp));
const hv39Rows = R39.hvap.map((r) => {
  const P = TH37.psat(TH37.component(r.key), r.T_K);
  const dh = (spec) => { const pp = pkg39(r.key, spec); return (pp.hPhase(r.T_K, P, [1, 0], 'V') - pp.hPhase(r.T_K, P, [1, 0], 'L')) / 1000; };
  const cell = (v) => `<td>${f(v, 2)} <span class="dim">(${v >= r.dHvap_kJmol ? '+' : ''}${f((v - r.dHvap_kJmol) / r.dHvap_kJmol * 100, 1)} %)</span></td>`;
  return `<tr><td class="l">${esc(r.label)}</td><td>${f(r.T_K - 273.15, 1)}</td><td>${f(r.dHvap_kJmol, 2)}</td>${cell(dh({ model: 'nrtl' }))}${cell(dh({ model: 'nrtl', vapour: 'pr' }))}${cell(dh({ model: 'nrtl', liquid_enthalpy: 'hvap' }))}</tr>`;
}).join('\n');
const s39vec = vecTable(range(327, 332), 'liq');
console.log(`Step 39: liquid Cp to Tb mean |Δ| liquid-Cp route ${f(mean39(dev39.cp), 2)} % · ΔHvap route ${f(mean39(dev39.hvap), 2)} %`);

/* ---------- STEP 40: ternary maps and azeotrope search, separators, heat of mixing, liquid volume ---------- */
const R40 = REF.step40;
const NM40 = { MeOH: 'methanol', H2O: 'water', EtOH: 'ethanol', nBuOH: '1-butanol', benzene: 'benzene', cyclohexane: 'cyclohexane', acetone: 'acetone', chloroform: 'chloroform', toluene: 'toluene', nC6H14: 'n-hexane', C3H8: 'propane', NH3: 'ammonia' };
const nm40 = (ks) => ks.map((k) => NM40[k] || k).join('–');
const id40 = (ks) => ks.slice().sort().join('+');
const az40 = {};
for (const sys of R40.azeotropes) for (const model of ['nrtl', 'uniquac', 'modunifac']) {
  const r = engine.runModule('azeotrope-search', { streams: [], params: { property_package: { model }, keys: sys.keys, P_bar: 1.01325 } });
  if (r.error) fail('STEP 40 azeotrope ' + sys.system + ' ' + model + ': ' + r.error.message);
  az40[sys.system + '|' + model] = r.details;
}
const azDev40 = { nrtl: [], uniquac: [], modunifac: [] };
const az40Rows = R40.azeotropes.map((sys) => {
  const head = `<tr><th colspan="5">${esc(sys.system)}</th></tr>`;
  return head + sys.az.map((a) => {
    const wk = Object.keys(a.w);
    const lit = `${f(a.T_C, 1)} °C${a.het ? ' <span class="dim">het.</span>' : ''}<small>${wk.map((k) => f(100 * a.w[k], 1) + ' wt % ' + (NM40[k] || k)).join(', ')}</small>`;
    const cells = ['nrtl', 'uniquac', 'modunifac'].map((model) => {
      // the model azeotrope of that set nearest the tabulated one (a parameter set can add a spurious one — see below)
      const cand = az40[sys.system + '|' + model].azeotropes.filter((z) => id40(z.keys) === id40(a.keys)).sort((u, v) => Math.abs(u.T_K - 273.15 - a.T_C) - Math.abs(v.T_K - 273.15 - a.T_C));
      const q = cand.length ? Object.assign({}, cand[0], { w: Object.fromEntries(cand[0].keys.map((k, i) => [k, cand[0].w[i]])) }) : null;
      if (!q) return '<td class="dim">none</td>';
      const dT = q.T_K - 273.15 - a.T_C;
      azDev40[model].push(Math.abs(dT));
      return `<td>${f(q.T_K - 273.15, 2)}${q.heterogeneous ? ' <span class="dim">het.</span>' : ''} <span class="dim">(${dT >= 0 ? '+' : ''}${f(dT, 2)} K)</span><small>${wk.map((k) => f(100 * (q.w[k] || 0), 1)).join(', ')}</small></td>`;
    });
    return `<tr><td class="l">${esc(nm40(a.keys))}</td><td>${lit}</td>${cells.join('')}</tr>`;
  }).join('\n');
}).join('\n');
const meanArr = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
if (meanArr(azDev40.nrtl) > 1) fail('STEP 40 NRTL azeotrope mean |ΔT| ' + meanArr(azDev40.nrtl));
// residue curve map topology against the published maps
const TOPO40 = [
  { model: 'nrtl', keys: ['MeOH', 'acetone', 'chloroform'], lle: null, want: { MeOH: 'stable node', acetone: 'saddle', chloroform: 'saddle', 'MeOH+acetone': 'unstable node', 'MeOH+chloroform': 'unstable node', 'acetone+chloroform': 'stable node', 'MeOH+acetone+chloroform': 'saddle' }, regions: 4 },
  { model: 'uniquac', keys: ['H2O', 'EtOH', 'benzene'], lle: 298.15, want: { H2O: 'stable node', EtOH: 'stable node', benzene: 'stable node', 'EtOH+H2O': 'saddle', 'EtOH+benzene': 'saddle', 'H2O+benzene': 'saddle', 'EtOH+H2O+benzene': 'unstable node' }, regions: 3 },
];
let topo40Ok = 0, topo40N = 0;
const topo40Rows = TOPO40.map((t) => {
  const r = engine.runModule('ternary-diagram', { streams: [], params: { property_package: { model: t.model }, keys: t.keys, P_bar: 1.01325, ...(t.lle ? { lle_T_K: t.lle } : {}) } });
  if (r.error) fail('STEP 40 ternary ' + t.keys + ': ' + r.error.message);
  const d = r.details;
  const rows = Object.entries(t.want).map(([id, kind]) => {
    const q = d.by_keys[id];
    topo40N++; const ok = q && q.kind === kind; if (ok) topo40Ok++; else fail('STEP 40 topology ' + id + ': ' + (q && q.kind) + ' vs ' + kind);
    return `<tr><td class="l">${esc(id.split('+').map((k) => NM40[k] || k).join('–'))}</td><td>${q ? f(q.T_K - 273.15, 2) : '—'}${q && q.heterogeneous ? ' <span class="dim">het.</span>' : ''}</td><td class="l">${esc(kind)}</td><td class="l">${esc(q ? q.kind : 'not found')}</td></tr>`;
  }).join('\n');
  if (d.n_boundaries + 0 < t.regions - 1) fail('STEP 40 boundaries ' + t.keys);
  return `<tr><th colspan="4">${esc(nm40(t.keys))} — ${esc(d.pp.label)}, ${d.residue_curves.length} residue curves, ${d.n_boundaries} distillation boundaries${d.lle ? ', ' + d.lle.tie_lines.length + ' liquid–liquid tie lines at 25 °C' : ''}, ${d.bubble_points} bubble points in ${f(d.ms / 1000, 1)} s</th></tr>` + rows;
}).join('\n');
// heat of mixing, equimolar at 25 °C
const MW40 = (k) => TH37.component(k).MW;
const hE40 = (keys, model) => {
  const w0 = MW40(keys[0]) / (MW40(keys[0]) + MW40(keys[1]));
  const run = (spec) => engine.runModule('property-table', { streams: [{ mass_flow_kg_h: 100, T_K: 298.15, P_bar: 1.01325, components: [{ key: keys[0], mass_fraction: w0 }, { key: keys[1], mass_fraction: 1 - w0 }] }], params: { property_package: spec, vary: 'T', from: 298.15, to: 299.15, points: 2, P_bar: 1.01325 } });
  const a = run({ model, excess_enthalpy: true }), b = run({ model });
  if (a.error || b.error) fail('STEP 40 hE ' + keys + ' ' + model);
  return a.details.rows[0].H_kJkmol - b.details.rows[0].H_kJkmol;
};
const hE40Models = ['nrtl', 'uniquac', 'wilson', 'unifac', 'modunifac'];
const hEdev40 = [];
const hE40Rows = R40.hE.map((h) => {
  const cells = hE40Models.map((m) => { const v = hE40(h.keys, m); if (m === 'modunifac') hEdev40.push(Math.abs(v - h.hE_Jmol) / Math.abs(h.hE_Jmol)); return `<td${m === 'modunifac' ? ' style="font-weight:600"' : ''}>${f(v, 0)}</td>`; });
  return `<tr><td class="l">${esc(h.label)}<small>${esc(h.source)}</small></td><td>${f(h.hE_Jmol, 0)}</td>${cells.join('')}</tr>`;
}).join('\n');
if (Math.max(...hEdev40) > 0.06) fail('STEP 40 Dortmund UNIFAC hE worst ' + Math.max(...hEdev40));
// liquid density by method
const rho40 = (keys, x, T, P, spec) => {
  const pp = TH37.createPackage(spec, keys);
  const xs = pp.keys.map((k) => x[keys.indexOf(k)]);
  const v = pp.volPhase(T, P, xs, 'L');
  return xs.reduce((a, xi, i) => a + xi * pp.comps[i].MW, 0) / 1000 / v;
};
const rhoDev40 = { auto: [], rackett: [], costald: [], eos: [] };
const rho40Rows = R40.rho.map((r) => {
  const cell = (spec, kk) => { const v = rho40([r.key], [1], r.T_K, r.P_Pa, spec); const dv = (v - r.rho) / r.rho * 100; rhoDev40[kk].push(Math.abs(dv)); return `<td>${f(v, 1)} <span class="dim">(${dv >= 0 ? '+' : ''}${f(dv, 1)} %)</span></td>`; };
  return `<tr><td class="l">${esc(r.label)}</td><td>${f(r.T_K - 273.15, 0)}</td><td>${f(r.rho, 1)}</td>${cell({ model: 'pr' }, 'auto')}${cell({ model: 'pr', liquid_volume: 'rackett' }, 'rackett')}${cell({ model: 'pr', liquid_volume: 'costald' }, 'costald')}${cell({ model: 'pr', liquid_volume: 'eos' }, 'eos')}</tr>`;
}).join('\n');
if (meanArr(rhoDev40.auto) > 1) fail('STEP 40 default liquid density mean ' + meanArr(rhoDev40.auto));
const mx40 = R40.mix_rho;
const mixRho40 = ['auto', 'rackett', 'costald'].map((lv) => rho40(mx40.keys, mx40.x, mx40.T_K, 101325, { model: 'nrtl', ...(lv === 'auto' ? {} : { liquid_volume: lv }) }));
const TER_NICE = (v, k) => {
  if (k === 'value') return /heat of mixing/.test(v.desc) ? 'heat of mixing Hᴱ, J/mol' : /heater/.test(v.desc) ? 'separator − heater duty, kW' : '3600·Q − ΔH(CO₂ outlet), kJ/h';
  let m = k.match(/^details\.by_keys\.([^.]+)\.T_K$/); if (m) return m[1].split('+').map((q) => NM40[q] || q).join('–') + ' T, K';
  m = k.match(/^details\.by_keys\.([^.]+)\.w\.(\w+)$/); if (m) return m[1].split('+').map((q) => NM40[q] || q).join('–') + ': mass fraction ' + (NM40[m[2]] || m[2]);
  m = k.match(/^details\.outlets_kg_h\.(\d)$/); if (m) return 'outlet ' + (+m[1] + 1) + ', kg/h';
  m = k.match(/^streams_out\.(\d)\.(T_K|P_bar|vapour_fraction)$/); if (m) return 'outlet ' + (+m[1] + 1) + ' ' + { T_K: 'T, K', P_bar: 'P, bar', vapour_fraction: 'vapour fraction' }[m[2]];
  return { 'details.n_azeotropes': 'azeotropes found', 'details.n_boundaries': 'distillation boundaries', 'details.rows.0.rho_kgm3': 'liquid density, kg/m³' }[k] || qName(k);
};
const s40vec = vecTable(range(333, 351), 'ter');

/* ---------- STEP 41: cross-check against DWSIM 10, water–hydrocarbon pairs, volume translation, liquid density ---------- */
const R41 = REF.step41;
const run41 = (job) => {
  const r = engine.runModule(job.module, job.args);
  if (r.error) fail('STEP 41 ' + job.module + ': ' + r.error.message);
  const o = {}; for (const [k, p] of Object.entries(job.picks)) o[k] = getP(r, p); return o;
};
const QL41 = { vapour_fraction: 'vapour fraction', bubble_T_K: 'bubble point, K', dew_T_K: 'dew point, K', power_kW: 'power, kW', T_out_K: 'outlet T, K', duty_kW: 'duty, kW',
  rho_vapour: 'vapour density, kg/m³', T_K: 'T, K', n_liquids: 'liquid phases', x_hc_in_water: 'x hydrocarbon in water', x_water_in_hc: 'x water in hydrocarbon' };
const ql41 = (k) => QL41[k] || k.replace(/^y_(.+)$/, 'y $1').replace(/^x_(.+)$/, 'x $1').replace(/^w_(.+)_(org|aq)$/, (m, c, ph) => (ph === 'org' ? 'organic' : 'aqueous') + ' layer, wt % ' + c);
const fv41 = (k, v) => {
  if (typeof v !== 'number') return '—';
  if (/^w_/.test(k)) return f(100 * v, 1);
  if (k === 'n_liquids') return f(v, 0);
  if (/T_K|T_out/.test(k)) return f(v, 2);
  if (Math.abs(v) < 0.01 && v !== 0) return v.toExponential(2);
  return Math.abs(v) >= 100 ? f(v, 2) : Math.abs(v) >= 10 ? f(v, 3) : f(v, 4);
};
const NOTE41 = {
  ng_flash_srk: 'SRKNOTE',
  nh3_separator: 'Vapour density: the engine includes the volume translation of the permanent gases; plain Peng–Robinson (as DWSIM) gives PLAIN kg/m³.',
  ng_dew_50bar: 'DWSIM 9 (Simulate 365) returned a false dew point at 205.8 K; DWSIM 10 and the engine find the true one (independent Peng–Robinson flash: 263.675 K).',
  compressor_CH4: 'DWSIM is plain Peng–Robinson; the engine adds the volume translation (plain: PLAIN kW).',
  compressor_H2: 'DWSIM is plain Peng–Robinson; the engine adds the volume translation (plain: PLAIN kW).',
  valve_ng: 'Reference: GERG-2008 (CoolProp).',
  cooler_ng: 'Reference: GERG-2008 (CoolProp).',
  gibbs_smr: 'Each program uses its own formation data.',
  web_layers: 'Reference: CRC / Lange ternary azeotrope table. DWSIM uses its own NRTL water–benzene pair.',
  lle_benzene_298: 'Reference: IUPAC-NIST recommended.',
  lle_toluene_298: 'DWSIM has no NRTL water–toluene pair and finds one liquid (the engine did too before this round).',
  lle_nC6H14_298: 'DWSIM estimates the pair; hexane in water 130 times the data.',
};
const dw41 = { agree: 0, n: 0, off: [] };
const dw41Rows = R41.cases.map((c) => {
  const eng = {}; for (const j of c.jobs) Object.assign(eng, run41(j));
  const keys = Object.keys(c.dwsim).filter((k) => (k !== 'n_liquids' || c.dwsim[k] !== 2) && !(c.id === 'gibbs_smr' && k === 'T_K'));
  let note = NOTE41[c.id] || '';
  if (note === 'SRKNOTE') {
    const j = JSON.parse(JSON.stringify(c.jobs[0])); j.args.params.property_package.kij = R41.srk_dwsim_kij.kij;
    const e2 = run41(j);
    note = `Both use DECHEMA SRK k<sub>ij</sub> from ChemSep, chosen differently: the engine takes the sets measured at 250–450 K; DWSIM takes the first set listed and has none for the pairs with N₂ or CO₂ (methane–CO₂ 0 against about 0.10). Given DWSIM's set, the engine gives ${fv41('vapour_fraction', e2.vapour_fraction)} and ${fv41('x_CH4', e2.x_CH4)}.`;
  }
  if (/PLAIN/.test(note)) note = note.replace('PLAIN', f(eng.rho_vapour_plainPR ?? eng.power_kW_plainPR, 2));
  return keys.map((k, i) => {
    const ref = c.ref && typeof c.ref[k] === 'number' ? c.ref[k] : null;
    if (/^(vapour_fraction|bubble_T_K|dew_T_K|y_|x_C|x_N)/.test(k) && !/srk|dew_50|cooler/.test(c.id)) {
      dw41.n++;
      if (Math.abs((eng[k] - c.dwsim[k]) / (c.dwsim[k] || 1)) < 0.003 || (Math.abs(eng[k] - c.dwsim[k]) < 0.05 && /T_K/.test(k))) dw41.agree++;
      else dw41.off.push(`${ql41(k)} in “${c.desc.split(',')[0]}” (${fv41(k, c.dwsim[k])} against ${fv41(k, eng[k])})`);
    }
    return `<tr>${i === 0 ? `<td class="l" rowspan="${keys.length}">${esc(c.desc)}</td>` : ''}<td class="l">${sub(ql41(k))}</td><td>${fv41(k, c.dwsim[k])}</td><td>${fv41(k, eng[k])}</td><td>${ref === null ? '<span class="dim">—</span>' : fv41(k, ref)}</td>${i === 0 ? `<td class="l" rowspan="${keys.length}"><small>${note}</small></td>` : ''}</tr>`;
  }).join('\n');
}).join('\n');
// water–hydrocarbon mutual solubilities: engine NRTL / UNIQUAC against the IUPAC-NIST reference equations
const NM41 = { benzene: 'benzene', toluene: 'toluene', ethylbenzene: 'ethylbenzene', oxylene: 'o-xylene', 'm-xylene': 'm-xylene', 'p-xylene': 'p-xylene', cyclohexane: 'cyclohexane', methylcyclohexane: 'methylcyclohexane', 'n-pentane': 'n-pentane', nC6H14: 'n-hexane', nC7H16: 'n-heptane', nC8H18: 'n-octane', isooctane: 'isooctane' };
const whcDev = { nrtl: [], uniquac: [] };
const lle41 = (key, model, T) => {
  const r = engine.runModule('r-flash3', { streams: [{ mass_flow_kg_h: 1000, T_K: T, P_bar: 20, components: [{ key: 'H2O', mass_fraction: 0.3 }, { key, mass_fraction: 0.7 }] }], params: { property_package: { model, three_phase: true }, T_K: T, P_bar: 20 } });
  if (r.error || r.details.phases !== 'LL') fail('STEP 41 LLE ' + key + ' ' + model + ' ' + T);
  return [r.details.x2[key], r.details.x1.H2O];
};
const pct41 = (a, b) => 100 * (a / b - 1);
const whcRows = R41.whc.map((w) => w.points.map((pt, i) => {
  const n = lle41(w.key, 'nrtl', pt.T_K), u = lle41(w.key, 'uniquac', pt.T_K);
  const cell = (v, ref, m) => { const d = pct41(v, ref); whcDev[m].push(Math.abs(d)); return m === 'nrtl' ? `${v.toExponential(2)} <span class="dim">${d >= 0 ? '+' : ''}${f(d, 1)} %</span>` : `${d >= 0 ? '+' : ''}${f(d, 1)} %`; };
  const rec = i === 0 && w.rec298 ? `<small>meas. ${w.rec298[0].toExponential(2)} / ${w.rec298[1].toExponential(2)}</small>` : '';
  return `<tr>${i === 0 ? `<td class="l" rowspan="${w.points.length}">${esc(NM41[w.key] || w.key)}<small>${f(w.T_range[0] - 273.15, 0)}–${f(w.T_range[1] - 273.15, 0)} °C</small></td>` : ''}<td>${f(pt.T_K - 273.15, 0)}</td>`
    + `<td>${pt.x_hc_in_water.toExponential(2)}</td><td>${cell(n[0], pt.x_hc_in_water, 'nrtl')}</td><td>${cell(u[0], pt.x_hc_in_water, 'uniquac')}</td>`
    + `<td>${pt.x_water_in_hc.toExponential(2)}${rec}</td><td>${cell(n[1], pt.x_water_in_hc, 'nrtl')}</td><td>${cell(u[1], pt.x_water_in_hc, 'uniquac')}</td></tr>`;
}).join('\n')).join('\n');
if (Math.max(...whcDev.nrtl) > 8) fail('STEP 41 water–hydrocarbon NRTL worst ' + Math.max(...whcDev.nrtl));
// volume translation
const syn41 = R41.vt.syngas, MW41 = { H2: 2.01588, N2: 28.0134, CH4: 16.0425, Ar: 39.948 };
const synComps = (() => { const s = Object.entries(syn41.y).reduce((a, [k, v]) => a + v * MW41[k], 0); return Object.entries(syn41.y).map(([k, v]) => ({ key: k, mass_fraction: v * MW41[k] / s })); })();
const rhoSyn = (vt) => engine.runModule('property-table', { streams: [{ mass_flow_kg_h: 1000, T_K: 300, P_bar: 10, components: synComps }], params: { property_package: { model: 'pr', volume_translation: vt }, vary: 'T', from: 273.15, to: 373.15, points: 2, P_bar: 140 } }).details.rows.map((r) => r.phases.vapour.rho_kgm3);
const synOn = rhoSyn(true), synOff = rhoSyn(false);
const vtRows = [];
syn41.points.forEach((p, i) => vtRows.push(`<tr><td class="l">H₂/N₂/CH₄/Ar 68/23/6/3, 140 bar</td><td class="l">vapour density at ${f(p.T_K - 273.15, 0)} °C, kg/m³</td><td>${f(p.rho, 2)}</td><td>${f(synOn[i], 2)} <span class="dim">(${f(pct41(synOn[i], p.rho), 1)} %)</span></td><td>${f(synOff[i], 2)} <span class="dim">(${f(pct41(synOff[i], p.rho), 1)} %)</span></td></tr>`));
for (const c of R41.vt.compressor) {
  const w = (vt) => engine.runModule('compressor', { streams: [{ mass_flow_kg_h: 1000, T_K: 300, P_bar: 30, components: [{ key: c.key, mass_fraction: 1 }] }], params: { property_package: { model: 'pr', volume_translation: vt }, P_out_bar: 150, efficiency: 0.75 } }).details.power_kW;
  const on = w(true), off = w(false);
  vtRows.push(`<tr><td class="l">compressor, 1 t/h ${esc(c.fluid.toLowerCase())}, 300 K, 30 → 150 bar, η 0.75</td><td class="l">shaft power, kW</td><td>${f(c.power_kW, 2)}</td><td>${f(on, 2)} <span class="dim">(${f(pct41(on, c.power_kW), 2)} %)</span></td><td>${f(off, 2)} <span class="dim">(${f(pct41(off, c.power_kW), 2)} %)</span></td></tr>`);
}
for (const q of R41.vt.nh3) {
  const g = (vt) => engine.runModule('gibbs', { streams: [{ mass_flow_kg_h: 851.526, T_K: 723.15, P_bar: q.P_atm * 1.01325, components: [{ key: 'H2', mass_fraction: 0.17755300484072123 }, { key: 'N2', mass_fraction: 0.8224469951592788 }] }], params: { property_package: { model: 'pr', volume_translation: vt }, T_out_K: 723.15, products: ['NH3'] } }).details.outlet_mole_frac.NH3;
  const on = g(true), off = g(false);
  vtRows.push(`<tr><td class="l">Gibbs reactor, H₂/N₂ = 3, 450 °C, ${q.P_atm} atm</td><td class="l">equilibrium NH₃, mol %</td><td>${f(100 * q.y, 1)}</td><td>${f(100 * on, 2)}</td><td>${f(100 * off, 2)}</td></tr>`);
}
// compressed-liquid density
const liqDev41 = [];
const liqRows = R41.liq.points.map((p) => {
  const r = engine.runModule('property-table', { streams: [{ mass_flow_kg_h: 100, T_K: p.T_K, P_bar: p.P_bar, components: [{ key: p.key, mass_fraction: 1 }] }], params: { property_package: { model: p.model }, vary: 'T', from: p.T_K, to: p.T_K + 1, points: 2, P_bar: p.P_bar } });
  const rho = r.details.rows[0].phases.liquid.rho_kgm3, d = pct41(rho, p.rho);
  liqDev41.push(Math.abs(d));
  return `<tr><td class="l">${esc(p.fluid.toLowerCase())} <span class="dim">(${p.model === 'pr' ? 'Peng–Robinson' : 'NRTL'} package)</span></td><td>${f(p.T_K - 273.15, 0)}</td><td>${f(p.P_bar, p.P_bar < 10 ? 2 : 0)}</td><td>${f(p.rho, 2)}</td><td>${f(rho, 2)} <span class="dim">(${d >= 0 ? '+' : ''}${f(d, 2)} %)</span></td></tr>`;
}).join('\n');
if (Math.max(...liqDev41) > 2.5) fail('STEP 41 compressed liquid worst ' + Math.max(...liqDev41));
QN_EXTRA = { 'streams_out.0.T_K': 'T (bubble / dew), K', 'details.rows.0.Cp_kJkgK': 'Cp, kJ/kg·K', 'details.rows.0.phases.liquid.k_WmK': 'liquid conductivity, W/m·K', 'details.power_kW': 'shaft power, kW', 'details.T_out_K': 'outlet T, K',
  'streams_out.1.components.0.mass_fraction': 'upper layer, wt fraction ethanol', 'streams_out.1.components.1.mass_fraction': 'upper layer, wt fraction water', 'streams_out.1.components.2.mass_fraction': 'upper layer, wt fraction benzene',
  'streams_out.2.components.0.mass_fraction': 'lower layer, wt fraction ethanol', 'streams_out.2.components.1.mass_fraction': 'lower layer, wt fraction water', 'streams_out.2.components.2.mass_fraction': 'lower layer, wt fraction benzene' };
const s41vec = vecTable(range(352, 395), 'x41');

// ---------------------------------------------------------------------------
// Section 41 (round 12a): extended pure-component databank
// ---------------------------------------------------------------------------
const R42 = REF.step42;
const t42 = R42.tally, pct42 = (x) => f(100 * x, 1) + ' %';
const PROP42 = [['Tc', 'critical temperature'], ['Pc', 'critical pressure'], ['Tb', 'normal boiling point'], ['Hf', 'ΔH<sub>f</sub> (ideal gas)'], ['psat', 'vapour pressure'], ['cpig', 'ideal-gas heat capacity'],
  ['hvap', 'heat of vaporisation'], ['rhol', 'liquid density'], ['mul', 'liquid viscosity'], ['st', 'surface tension'], ['modunifac', 'Dortmund UNIFAC groups']];
const prov42 = PROP42.map(([k, lab]) => {
  const q = t42[k] || {};
  const isG = /unifac/.test(k);
  return `<tr><td class="l">${lab}</td><td>${isG ? q.meas || 0 : (q.meas || 0)}</td><td>${q.ref || 0}</td><td>${isG ? '—' : q.anchored || '—'}</td><td>${isG ? (q.est || 0) + ' from the structure, ' + (q.none || 0) + ' none' : q.est || 0}</td></tr>`;
}).join('\n');
const cat42 = Object.entries(R42.cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => n + ' ' + c).join(', ');
const drop42 = Object.entries(R42.dropped).sort((a, b) => b[1] - a[1]).map(([w, n]) => `<li>${n} — ${esc(w)}</li>`).join('');
const case42 = R42.cases.map((c) => {
  const { r } = runVec(c.id);
  const a = getP(r, c.path), dlt = a - c.ref;
  const rel = /T_K/.test(c.path) ? f(dlt, 3) + ' K' : f(100 * dlt / c.ref, 3) + ' %';
  return `<tr><td>${esc(c.id)}</td><td class="l">${esc(c.src)}</td><td class="l">${esc(c.q)}</td><td>${f(a, Math.abs(c.ref) >= 100 ? 3 : 4)}</td><td>${f(c.ref, Math.abs(c.ref) >= 100 ? 3 : 4)}</td><td>${rel}</td></tr>`;
}).join('\n');
const E42 = R42.est;

// ---------------------------------------------------------------------------
// Section 42 (round 12b): GERG-2008 and the pure-fluid reference equations
// ---------------------------------------------------------------------------
const R43 = REF.step43;
const aga43 = (() => {
  const x = [0, ...R43.aga.x], p = gergMod.properties(R43.aga.T, R43.aga.D, x);
  const rows = [['Z', 'Z', 9], ['H', 'enthalpy, J/mol', 6], ['S', 'entropy, J/(mol K)', 8], ['Cp', 'c<sub>p</sub>, J/(mol K)', 8], ['W', 'speed of sound, m/s', 6], ['JT', 'Joule–Thomson, K/kPa', 9], ['Kappa', 'isentropic exponent', 9]];
  let worst = 0;
  const html = rows.map(([k, lab, dg]) => { const d = Math.abs(p[k] / R43.aga[k] - 1); worst = Math.max(worst, d); return `<tr><td class="l">${lab}</td><td>${f(p[k], k === 'JT' ? 12 : dg)}</td><td>${f(R43.aga[k], k === 'JT' ? 12 : dg)}</td><td>${sci(d)}</td></tr>`; }).join('\n');
  return { html, worst };
})();
const gergVle43 = R43.vle.map((c) => {
  const T = {};
  for (const model of ['gerg2008', 'pr']) { const pp = thermoModule.createPackage({ model }, c.keys); T[model] = thermoModule.flashPVF(pp, c.x, c.P, c.kind === 'dew' ? 1 : 0).T; }
  return { ...c, eng: T.gerg2008, pr: T.pr };
});
const gergVleRows = gergVle43.map((c) => `<tr><td class="l">${esc(c.label)}</td><td class="l">${c.kind} point, ${f(c.P / 1e5, 0)} bar</td><td>${f(c.T, 3)}</td><td>${f(c.eng, 3)}</td><td>${f(c.eng - c.T, 3)}</td><td>${f(c.pr - c.T, 3)}</td></tr>`).join('\n');
const gVleWorst = Math.max(...gergVle43.map((c) => Math.abs(c.eng - c.T))), gVleWorstPR = Math.max(...gergVle43.map((c) => Math.abs(c.pr - c.T)));
const ngKeys43 = ['CH4', 'C2H6', 'C3H8', 'nC4H10', 'N2', 'CO2'];
const gergSp43 = R43.sp.map((q) => {
  const pp = thermoModule.createPackage({ model: 'gerg2008' }, ngKeys43), r = thermoModule.flashPT(pp, R43.sp_x, q.T, q.P), pr = thermoModule.properties(pp, r);
  const ppr = thermoModule.createPackage({ model: 'pr' }, ngKeys43), rr = thermoModule.flashPT(ppr, R43.sp_x, q.T, q.P), prr = thermoModule.properties(ppr, rr);
  const rho = pr.rho_kgm3 / pr.MW * 1000, rhoPR = prr.rho_kgm3 / prr.MW * 1000;
  return { ...q, dRho: 100 * (rho / q.rho - 1), dCp: 100 * (pr.phases[0].Cp_JmolK / q.cp - 1), dRhoPR: 100 * (rhoPR / q.rho - 1), dCpPR: 100 * (prr.phases[0].Cp_JmolK / q.cp - 1) };
});
const gergSpRows = gergSp43.map((q) => `<tr><td>${f(q.T, 0)}</td><td>${f(q.P / 1e5, 0)}</td><td>${f(q.dRho, 3)} %</td><td>${f(q.dCp, 2)} %</td><td>${f(q.dRhoPR, 2)} %</td><td>${f(q.dCpPR, 2)} %</td></tr>`).join('\n');
let refW43 = { rho: 0, cp: 0, T: 0, h: 0 };
const refRows43 = R43.ref.map((q) => {
  const pp = thermoModule.createPackage({ model: 'reference' }, [q.key]), r = thermoModule.flashPT(pp, [1], q.T, q.P), pr = thermoModule.properties(pp, r);
  const dr = (pr.rho_kgm3 / pr.MW * 1000) / q.rhomolar - 1, dc = pr.phases[0].Cp_JmolK / q.cp - 1;     // molar density: the molar masses differ in the 5th digit
  refW43.rho = Math.max(refW43.rho, Math.abs(dr)); refW43.cp = Math.max(refW43.cp, Math.abs(dc));
  return `<tr><td class="l">${esc(q.key)}</td><td>${f(q.T, 0)}</td><td>${f(q.P / 1e5, 0)}</td><td class="l">${esc(q.phase.replace('supercritical_', 'supercritical '))}</td><td>${f(pr.rho_kgm3, 3)}</td><td>${f(q.rho, 3)}</td><td>${sci(Math.abs(dr))}</td><td>${sci(Math.abs(dc))}</td></tr>`;
}).join('\n');
const satRows43 = R43.sat.map((q) => {
  const pp = thermoModule.createPackage({ model: 'reference' }, [q.key]);
  const L = thermoModule.flashPVF(pp, [1], q.P, 0), V = thermoModule.flashPVF(pp, [1], q.P, 1);
  const hv = thermoModule.hOf(pp, V) - thermoModule.hOf(pp, L);
  refW43.T = Math.max(refW43.T, Math.abs(L.T - q.T)); refW43.h = Math.max(refW43.h, Math.abs(hv / q.hvap - 1));
  return `<tr><td class="l">${esc(q.key)}</td><td>${f(q.P / 1e5, 0)}</td><td>${f(L.T, 4)}</td><td>${f(q.T, 4)}</td><td>${f(hv, 1)}</td><td>${f(q.hvap, 1)}</td></tr>`;
}).join('\n');
const s43vec = vecTable(range(405, 412), 'x43');

// ---------------------------------------------------------------------------
// Section 43 (round 12c): refinery methods — PR78, PRSV2, Lee–Kesler–Plöcker, Chao–Seader, Grayson–Streed
// ---------------------------------------------------------------------------
const R44 = REF.step44;
const M44 = { pr: 'Peng–Robinson', pr78: 'PR78', prsv2: 'PRSV2', lkp: 'Lee–Kesler–Plöcker', 'chao-seader': 'Chao–Seader', 'grayson-streed': 'Grayson–Streed' };
const pk44 = new Map();
const pp44 = (model, keys) => { const k = model + '|' + keys.join(','); if (!pk44.has(k)) pk44.set(k, thermoModule.createPackage({ model }, keys)); return pk44.get(k); };
const worst44 = {};
const dw44 = R44.dwsim.map((c) => {
  const keys = Object.keys(c.x), z = keys.map((k) => c.x[k]), pp = pp44(c.method, keys);
  let eng = NaN, q = '', dg = 2, unit = '';
  if (c.kind === 'bubble' || c.kind === 'dew') { eng = thermoModule.flashPVF(pp, z, c.P, c.kind === 'dew' ? 1 : 0).T; q = c.kind + ' point, K'; unit = ' K'; }
  else if (c.kind === 'vf' || c.kind === 'K') {
    const r = thermoModule.flashPT(pp, z, c.T, c.P);
    if (c.kind === 'vf') { eng = r.beta; q = 'vapour fraction'; dg = 4; }
    else { const i = keys.indexOf(c.key); eng = r.y[i] / r.x[i]; q = 'K of ' + c.key; dg = 4; }
  } else {
    const MW = keys.reduce((a, k, i) => a + z[i] * thermoModule.component(k).MW, 0);
    const h = (T) => thermoModule.hOf(pp, thermoModule.flashPT(pp, z, T, c.P));
    eng = (h(c.T2) - h(c.T)) / MW; q = 'ΔH, kJ/kg'; dg = 2;
  }
  const d = eng - c.dwsim, rel = c.kind === 'bubble' || c.kind === 'dew' ? Math.abs(d) : Math.abs(d / c.dwsim);
  const w = worst44[c.method] = worst44[c.method] || { T: 0, rel: 0 };
  if (c.kind === 'bubble' || c.kind === 'dew') w.T = Math.max(w.T, Math.abs(d)); else w.rel = Math.max(w.rel, rel);
  return `<tr><td class="l">${esc(c.label)}</td><td class="l">${esc(M44[c.method])}</td><td class="l">${esc(q)}</td><td>${f(c.dwsim, dg + (c.kind === 'K' && c.dwsim < 1 ? 1 : 0))}</td><td>${f(eng, dg + (c.kind === 'K' && c.dwsim < 1 ? 1 : 0))}</td><td>${c.kind === 'bubble' || c.kind === 'dew' ? f(d, 3) + unit : f(100 * d / Math.abs(c.dwsim), 2) + ' %'}</td></tr>`;
}).join('\n');
const prsv2Rows44 = R44.prsv2.rows.map((r) => `<tr><td>${f(r.tr, 1)}</td><td>${r.n}</td><td>${f(100 * r.prsv2_median, 3)} %</td><td>${f(100 * r.prsv2_p90, 2)} %</td><td>${f(100 * r.pr_median, 2)} %</td><td>${f(100 * r.pr_p90, 1)} %</td></tr>`).join('\n');
const L44 = R44.lkp;
const lkpEx44 = L44.examples.map((e) => `<tr><td class="l">${esc(e.pair.replace('|', ' – '))}</td><td>${f(e.kij, 4)}</td><td>${f(100 * e.aad, 1)} %</td><td>${f(100 * e.aad_k1, 0)} %</td></tr>`).join('\n');
const s44vec = vecTable(range(413, 423), 'x44');

// ---------------------------------------------------------------------------
// Section 44 (round 12d): UNIFAC-LL, NIST-modified UNIFAC, aqueous MDEA viscosity
// ---------------------------------------------------------------------------
const R45 = REF.step45;
const NM45 = { nBuOH: '1-butanol', mek: 'methyl ethyl ketone', etoac: 'ethyl acetate', benzene: 'benzene', toluene: 'toluene', mibk: 'methyl isobutyl ketone', furfural: 'furfural', EtOH: 'ethanol', H2O: 'water', acetone: 'acetone', MeOH: 'methanol', cyclohexane: 'cyclohexane' };
const lle45 = (model, other, T) => {
  const pp = thermoModule.createPackage({ model, three_phase: true }, ['H2O', other]);
  const r = thermoModule.flashPT3(pp, [0.8, 0.2], T, 2e5);
  if (!r.x2) return { aq: NaN, org: NaN };
  const [a, b] = r.x[0] > r.x2[0] ? [r.x, r.x2] : [r.x2, r.x];
  return { aq: a[1], org: b[0] };
};
let nistW45 = 0;
const nist45 = R45.nist_dwsim.map((c) => {
  if (c.kind === 'bubble') {
    const keys = Object.keys(c.x), pp = thermoModule.createPackage({ model: 'nist-modunifac' }, keys);
    const T = thermoModule.flashPVF(pp, keys.map((k) => c.x[k]), c.P, 0).T;
    nistW45 = Math.max(nistW45, Math.abs(T - c.dwsim));
    return `<tr><td class="l">${esc(keys.map((k) => NM45[k] + ' ' + c.x[k]).join(' / '))}</td><td class="l">bubble point at 1 atm, K</td><td>${f(c.dwsim, 3)}</td><td>${f(T, 3)}</td><td>${f(T - c.dwsim, 4)} K</td></tr>`;
  }
  const e = lle45('nist-modunifac', c.other, c.T), v = c.kind === 'aq' ? e.aq : e.org;
  const dwOne = c.kind === 'aq' ? Math.abs(c.dwsim - 0.2) < 1e-6 : c.dwsim === null;
  if (!dwOne) nistW45 = Math.max(nistW45, Math.abs(v / c.dwsim - 1) * 0);
  return `<tr><td class="l">water / ${esc(NM45[c.other])}, 25 °C (80 / 20 mol % feed)</td><td class="l">${c.kind === 'aq' ? 'x ' + esc(NM45[c.other]) + ' in the water layer' : 'x water in the organic layer'}</td><td>${dwOne ? 'one liquid' : sci(c.dwsim)}</td><td>${sci(v)}</td><td>${dwOne ? '—' : sci(Math.abs(v / c.dwsim - 1))}</td></tr>`;
}).join('\n');
// mutual solubilities against the IUPAC-NIST recommended values of section 40
const lleRows45 = REF.step41.whc.filter((w) => ['benzene', 'toluene', 'ethylbenzene', 'p-xylene', 'cyclohexane', 'nC6H14'].includes(w.key)).map((w) => {
  const [ra, ro] = w.rec298 || [w.points[0].x_hc_in_water, w.points[0].x_water_in_hc];
  const cells = ['unifac', 'modunifac', 'unifac-ll', 'nist-modunifac'].map((m) => {
    const pp = thermoModule.createPackage({ model: m, three_phase: true }, ['H2O', w.key]);
    const r = thermoModule.flashPT3(pp, [0.5, 0.5], 298.15, 2e5);
    if (!r.x2) return '<td>—</td><td>—</td>';
    const [a, b] = r.x[0] > r.x2[0] ? [r.x, r.x2] : [r.x2, r.x];
    return `<td>${f(a[1] / ra, 2)}</td><td>${f(b[0] / ro, 2)}</td>`;
  }).join('');
  return `<tr><td class="l">${esc(w.key === 'nC6H14' ? 'n-hexane' : w.key)}</td><td>${sci(ra)}</td><td>${sci(ro)}</td>${cells}</tr>`;
}).join('\n');
const polar45 = ['nBuOH', 'mek', 'etoac', 'mibk', 'furfural'].map((k) => {
  const cells = ['unifac', 'modunifac', 'unifac-ll', 'nist-modunifac'].map((m) => { const e = lle45(m, k, 298.15); return `<td>${Number.isFinite(e.aq) ? sci(e.aq) + ' / ' + f(e.org, 3) : 'one liquid'}</td>`; }).join('');
  return `<tr><td class="l">${esc(NM45[k])}</td>${cells}</tr>`;
}).join('\n');
const G45 = R45.groups, VF45 = R45.visc_fit;
const am45 = R45.amdea_dwsim.map((c) => {
  const keys = Object.keys(c.mf), MWs = keys.map((k) => thermoModule.component(k).MW);
  const nn = keys.map((k, i) => c.mf[k] / MWs[i]), sn = nn.reduce((a, b) => a + b, 0), z = nn.map((v) => v / sn);
  const pp = thermoModule.createPackage({ model: 'amine-mdea' }, keys), r = thermoModule.flashPT(pp, z, c.T, Math.max(c.P, 1e5)), pr = thermoModule.properties(pp, r);
  const L = pr.phases.find((q) => q.type === 'liquid'), cp = L.Cp_JmolK / L.MW;
  const row = (lab, dv, ev, dg) => `<td>${f(dv, dg)} / ${f(ev, dg)}</td>`;
  return `<tr><td class="l">${esc(c.label)}</td>${row('ρ', c.dwsim.rho, L.rho_kgm3, 1)}${row('μ', c.dwsim.mu_cP, L.mu_Pas * 1000, 3)}${row('cp', c.dwsim.cp, cp, 3)}${row('k', c.dwsim.k, L.k_WmK, 3)}${row('pH', c.dwsim.pH, L.acid_gas && L.acid_gas.pH, 2)}</tr>`;
}).join('\n');
const s45vec = vecTable(range(424, 431), 'x45');
QN_EXTRA = {};
// ROUND 15: stream properties (Cv, Cp/Cv, speed of sound, Joule–Thomson) against CoolProp
QN_EXTRA = { 'details.overall.Cv_kJkgK': 'Cv, kJ/kg·K', 'details.overall.Cp_Cv': 'Cp/Cv', 'details.overall.speed_of_sound_m_s': 'speed of sound, m/s', 'details.overall.joule_thomson_K_bar': 'Joule–Thomson coefficient, K/bar',
  'details.overall.rho_kgm3': 'density, kg/m³', 'details.overall.vapour_fraction': 'vapour fraction', 'details.K.H2O': 'K of water (y/x)', 'details.saturation.dew_T_K': 'dew point at 5 bar, K' };
const s46vec = vecTable(range(433, 438), 'x46');
QN_EXTRA = {};
// ROUND 16: energy streams in the flowsheet solver against IAPWS-IF97 (python iapws)
QN_EXTRA = { 'block_results.T1.result.energy_balance.W_kW': 'turbine power, kW', 'block_results.K1.result.energy_balance.W_kW': 'compressor power, kW', 'energy_streams.0.kW': 'energy stream, kW',
  'block_results.E1.result.energy_balance.Q_kW': 'source cooler duty, kW', 'block_results.E2.result.energy_balance.Q_kW': 'receiving heater duty, kW', 'block_results.E3.result.energy_balance.Q_kW': 'heater in between, duty, kW',
  'stream_results.s4.T_K': 'heated water outlet, K', 'stream_results.s2.T_K': 'heated water outlet, K' };
const s47vec = vecTable(range(439, 442), 'x47');
QN_EXTRA = {};
console.log(`Step 41: DWSIM agreement ${dw41.agree}/${dw41.n} · water–HC worst NRTL ${f(Math.max(...whcDev.nrtl), 1)} % UNIQUAC ${f(Math.max(...whcDev.uniquac), 1)} % · compressed liquid worst ${f(Math.max(...liqDev41), 2)} %`);

console.log(`Step 40: azeotrope mean |ΔT| NRTL ${f(meanArr(azDev40.nrtl), 2)} K UNIQUAC ${f(meanArr(azDev40.uniquac), 2)} K Dortmund ${f(meanArr(azDev40.modunifac), 2)} K · topology ${topo40Ok}/${topo40N} · hE Dortmund worst ${f(100 * Math.max(...hEdev40), 1)} % · density mean auto ${f(meanArr(rhoDev40.auto), 2)} % Rackett ${f(meanArr(rhoDev40.rackett), 2)} % COSTALD ${f(meanArr(rhoDev40.costald), 2)} % PR ${f(meanArr(rhoDev40.eos), 2)} %`);

const html = `<!DOCTYPE html>
<!-- REPO PATH: flowsheet-validation.html — GENERATED by scripts/build-flowsheet-validation.mjs (${today}); do not edit by hand -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flowsheet Simulator Validation — Property Packages, Columns, CO₂ Absorption &amp; Catalytic Reactors | multicalci.com</title>
<meta name="description" content="How the multicalci.com flowsheet simulator is verified: Peng–Robinson, SRK, NRTL, UNIQUAC, Wilson and UNIFAC flashes, rigorous distillation columns, three-phase (VLLE) flashes and phase envelopes against DWSIM and the open-source thermo library, binary T–x–y diagrams, ternary residue curve maps and azeotropes against tabulated data, kinetic plug-flow and CSTR reactors against exact solutions, Gibbs-reactor equilibrium against NIST-JANAF, aqueous-MEA and hot-potassium-carbonate CO₂ absorption against measured data, IDAES and USGS PHREEQC, brines and seawater against PHREEQC and TEOS-10, sour water against measured NH₃ / H₂S / CO₂ pressures, Murphree tray efficiencies, plus energy-balance, recycle and design-spec checks.">
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
.dim{color:var(--dim);font-size:12px}
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


<h2>30 · Urea synthesis method — Voskov et al. (2016)</h2>
<p>The liquid is UNIQUAC over the true species NH₃, CO₂, H₂O, urea, ammonium carbamate and ammonium bicarbonate, with the carbamate and bicarbonate equilibria solved in every flash and urea formation solved by the urea reactor; parameters of Voskov, Pilaar &amp; Rietveld (2016), the bicarbonate equilibrium constant refitted and no Poynting term in the chemical equilibria (the form that reproduces their tables); vapour Peng–Robinson with k<sub>ij</sub>(NH₃–CO₂) = 0.10 fitted here. Reference: the paper's Table 8 (equilibrium conversion of the closed liquid) and Table 9 (its bubble pressure), every point.</p>
<p><b>Equilibrium CO₂ → urea conversion, engine − paper, percentage points</b> (H/C across): rms ${f(yRms34, 3)}, worst ${f(yWorst, 3)} over ${yN} points.</p>
<div class="tw"><table><thead><tr><th>N/C</th><th>t, °C</th>${R34.urea_W.map((w) => `<th>H/C ${w}</th>`).join('')}</tr></thead><tbody>
${yRows34.join('\n')}
</tbody></table></div>
<p><b>Bubble pressure, (engine − paper)/paper, %</b>: rms ${f(100 * pRms34, 1)} %, worst ${f(100 * pWorst, 1)} % over ${pN} points.</p>
<div class="tw"><table><thead><tr><th>N/C</th><th>t, °C</th>${R34.urea_W.map((w) => `<th>H/C ${w}</th>`).join('')}</tr></thead><tbody>
${pRows34.join('\n')}
</tbody></table></div>
<p>Heats at 185 °C, 250 bar (all liquid): forming the liquid from NH₃, CO₂ and H₂O gases (N/C 3, H/C 0.5) ${f(dHc34, 1)} kJ per mol CO₂ — carbamate formation from the gases is about −117 to −159 kJ/mol, plus the solution of the excess ammonia; urea formation in the liquid ${f(dHu34, 1)} kJ per mol urea (the dehydration of carbamate to urea is endothermic, +15.5 kJ/mol in the literature). The urea HP synthesis example on the simulator page (adiabatic reactor at N/C 2.94, H/C 0.47) gives 56 % conversion at 185 °C and a stripping efficiency of 77 % with 0.83 t steam per t urea.</p>
<p class="note">The worst bubble-pressure deviations are at N/C 2.5 and 200 °C, where the paper's own vapour model departs most from Peng–Robinson. Liquid density uses the model's partial molar volumes and liquid viscosity a log-mixing estimate — both indicative. Biuret and urea hydrolysis are not modelled.</p>

<h2>31 · Machine performance curves and the multistage compressor</h2>
<p>Pump and compressor curves (head, efficiency against flow at a rated speed) interpolated by monotone cubic Hermite; other speeds by the affinity laws Q ∝ N, H ∝ N². A pump's head sets the discharge pressure through ΔP = ρgH; a compressor's polytropic head sets the discharge pressure through the rigorous polytropic path of the property method, so H<sub>p</sub> = η<sub>p</sub>Δh. Reference: hand calculation with the IAPWS-IF97 density of water (992.267 kg/m³ at 40 °C, 2 bar) and the curve points.</p>
<div class="tw"><table><thead><tr><th class="l">Machine</th><th>Operating point</th><th>Head, engine</th><th>Head, reference</th><th>P out, bar</th><th>η</th><th>Power</th></tr></thead><tbody>
${mcRows.join('\n')}
</tbody></table></div>
<p>Four-stage CO₂ compressor 1.4 → 145 bar, intercoolers to 40 °C with pressure drops 0.1 / 0.3 / 0.8 bar, polytropic η 0.78 (Peng–Robinson; wet CO₂ with 3.8 mol % water). The equal stage ratio is found with the cooler drops included; the unit's ΔH − W equals the summed cooler duties to ${sci(trQgap)} kW.</p>
<div class="tw"><table><thead><tr><th>Stage</th><th>P, bar</th><th>Ratio</th><th>T disch, °C</th><th>Power, kW</th><th>Cooler, kW</th><th>Condensate, kg/h</th></tr></thead><tbody>
${trRows}
</tbody></table></div>

<h2>32 · Calculator blocks</h2>
<p>Calculators read stream and unit results (or inputs), evaluate the user's formulas in a sandboxed arithmetic language and write the answers into feeds or unit specifications. A feed-forward calculator joins the calculation order after the units it reads and before the units it sets; one that reads a result its own exports change is converged around the solve (substitution with Wegstein acceleration).</p>
<div class="tw"><table><thead><tr><th class="l">Case</th><th class="l">Order / convergence</th><th>Result</th><th>Reference</th></tr></thead><tbody>
<tr><td class="l">Steam = 3 × CH₄ (kmol/h) × 18.01528</td><td class="l">${(cff.log || []).find((l) => /Calculation order/.test(l[1]))[1].replace('Calculation order: ', '')}</td><td>${f(cff.stream_results.S.mass_flow_kg_h, 3)} kg/h</td><td>${f(3 * cff.calculators[0].imports.ch4 * 18.01528, 3)} kg/h</td></tr>
<tr><td class="l">Heater outlet T ← T + 1.5 (650 K − T<sub>mix</sub>)</td><td class="l">feedback, ${cfb.calculators[0].passes} passes</td><td>${f(cfb.stream_results.P.T_K, 4)} K</td><td>650 K</td></tr>
</tbody></table></div>

<h2>33 · Petroleum pseudo-components and TBP assay cutting</h2>
<p>Pseudo-components from the normal boiling point and specific gravity: critical constants by Twu (1984), Riazi–Daubert (1987) or Kesler–Lee (1976), the Kesler–Lee acentric factor, the Lee–Kesler vapour pressure, Riedel ΔH<sub>vap</sub> with the Watson exponent, Rackett liquid density through the SG, and an ideal-gas heat capacity in the Watson K fitted here to the databank. Reference: ${hcs.length} C5+ hydrocarbons of the databank (paraffins, naphthenes, olefins, aromatics, Tb 300–800 K), using only their Tb and SG.</p>
<div class="tw"><table><thead><tr><th class="l">Method</th><th>Tc, rms</th><th>Pc, rms</th><th>M, rms</th><th>ω, rms</th></tr></thead><tbody>
${psStat}
</tbody></table></div>
<div class="tw"><table><thead><tr><th class="l">Compound</th><th>Tb, K</th><th>SG</th><th>Tc, K: data / Twu / R–D / K–L</th><th>Pc, bar: data / Twu / R–D / K–L</th><th>M: data / Twu / R–D</th><th>ω: data / K–L</th></tr></thead><tbody>
${psRows.join('\n')}
</tbody></table></div>
<p>On Peng–Robinson, a pseudo-component with the Tb and SG of n-decane against n-decane itself:</p>
<div class="tw"><table><thead><tr><th class="l">Component</th><th>NBP, K</th><th>P<sub>sat</sub> 100 °C, kPa</th><th>ρ<sub>L</sub> 25 °C, kg/m³</th><th>Δh 300 → 500 K at 1 bar (liquid → vapour), kJ/mol</th><th>μ<sub>L</sub> 25 °C, mPa·s</th></tr></thead><tbody>
${decRows.join('\n')}
</tbody></table></div>
<p class="note">Twu reproduces the n-alkanes by construction and is the default; aromatics carry the largest Pc errors for every method. The heat-capacity correlation has 5 % rms over the reference set; liquid viscosity is the n-paraffin of the same Tb at the same T/Tb — an estimate. A TBP assay is cut into equal-temperature (or given) cuts at constant Watson K scaled to the bulk SG (vectors MB-273 and MB-275).</p>

<h2>34 · Solver transparency</h2>
<p>Every run returns the history of each recycle loop — the largest relative change of the torn streams at every pass and how that pass was started — the final change of each torn stream, the design-spec Newton steps and the feedback-calculator passes; the simulator plots them in its Convergence tab. The recycle of vector MB-100 (mixer → shift reactor → cooler → flash → 50 / 50 splitter, tolerance 10⁻⁹) with each accelerator (S = direct substitution, W = Wegstein, B = Broyden):</p>
<div class="tw"><table><thead><tr><th class="l">Accelerator</th><th>Passes</th><th>Final change</th><th class="l">Passes started by</th><th>Recycle, kg/h</th><th>Reference, kg/h</th></tr></thead><tbody>
${accRows}
</tbody></table></div>
<p>The design spec of vector MB-099 (process air varied until H₂/N₂ = 3.000 in the methanated make-up gas, tolerance 10⁻⁶ relative): scaled residual = |H₂/N₂ − 3| ÷ ${sci(SH35.specs[0].tol)}, met at 1 or below; each Newton step costs one evaluation for the finite-difference Jacobian and one for the step.</p>
<div class="tw"><table><thead><tr><th>Iteration</th><th>Air, kg/h</th><th>H₂/N₂ − 3</th><th>Scaled residual</th><th>Step λ</th><th>Evaluations</th><th>∂(H₂/N₂)/∂air, h/kg</th></tr></thead><tbody>
${spRows}
</tbody></table></div>
<p class="note">Both accelerators land on the same recycle flow — the steady state does not depend on how it is reached. With a single torn stream, as here, Wegstein alone is as quick; Broyden's quasi-Newton update is meant for loops with several coupled torn streams, where Wegstein's one-variable-at-a-time steps ignore the coupling. The air rate reached is ${f(spH.specs[0].varied, 4)} kg/h against ${f(vec('MB-099').expect['specs.0.varied'], 4)} kg/h frozen in the templates (vectors MB-276 to MB-279).</p>

<h2>35 · Pinch analysis, equipment costing and optimisation</h2>
<p>Energy targets by the problem-table algorithm (hot streams shifted down and cold streams up by ΔT<sub>min</sub>/2, interval heat surpluses cascaded from the top). A stream given as a process state is flashed with the property method along its path, so boiling and condensation appear as corners of its curve — here at the IAPWS-IF97 saturation temperature.</p>
<div class="tw"><table><thead><tr><th class="l">Case</th><th>Q<sub>H,min</sub>, kW</th><th>Reference</th><th>Q<sub>C,min</sub>, kW</th><th>Reference</th><th>Pinch hot / cold, °C</th><th>Reference</th></tr></thead><tbody>
${pinchRows}
</tbody></table></div>
<p>Equipment costs by module costing (Turton et al., <i>Analysis, Synthesis and Design of Chemical Processes</i>, App. A, at CEPCI 397) escalated to CEPCI ${f(ec36.basis.cepci, 1)}, against the same correlations evaluated by hand for vector MB-284 (a 100 kW LP-steam heater and a 20 m³ atmospheric vertical vessel):</p>
<div class="tw"><table><thead><tr><th class="l">Quantity</th><th>Engine</th><th>Hand calculation</th><th>Relative difference</th></tr></thead><tbody>
${costRows}
</tbody></table></div>
<p>Optimisation over whole-flowsheet solves, on a flowsheet whose product flow is the analytic function 1000 + 500 + 1000((T₁ − 350)/10)² + 100(P₁ − 4)² kg/h (a calculator block sets a feed from feed S1's temperature and pressure); tolerance 0.5 % of each variable's range:</p>
<div class="tw"><table><thead><tr><th class="l">Problem</th><th>Optimum found</th><th>Exact</th><th>Objective, kg/h</th><th>Exact</th><th>Evaluations</th><th>Feasible</th></tr></thead><tbody>
${optRows}
</tbody></table></div>
<p class="note">The cost correlations are study-estimate grade (about −20 % / +30 %). The constants for exchangers, vertical vessels and towers, sieve trays, centrifugal pumps, compressors and drives, the exchanger pressure and material factors and the bare-module constants of exchangers, pumps and vertical vessels were checked against a second copy of Turton's tables; the pump pressure and material factors, horizontal-vessel bare-module constants, alloy vessel material factors, the tray quantity factor and the fired-heater bare-module factors are transcribed from Turton App. A without a second check. Utility prices are examples. A pinch analysis of a flowsheet uses the duties of its last run; isothermal duties (condensers, reboilers, reactors) are spread over 1 K (vectors MB-280 to MB-290).</p>

<h2>36 · Components from a structure, UNIFAC fill-in and transport properties</h2>
<p>A component missing from the databank can be entered as a SMILES string. The structure is parsed (rings, aromaticity, charges, the five-valent nitro form normalised) and split into UNIFAC, Dortmund-UNIFAC and Joback groups by SMARTS matching with the priority algorithm of the open-source thermo library. Joback & Reid give Tb, Tc, Pc, Vc, ΔHf°, ΔGf° and the ideal-gas Cp; Lee–Kesler gives ω and the vapour pressure; the liquid density is Rackett through the Tyn–Calus volume at Tb. Any measured constant the user enters replaces its estimate. Group assignment of ${nFrag} molecules against thermo 0.6.1 with RDKit SMARTS matching:</p>
<div class="tw"><table><thead><tr><th class="l">Group set</th><th>Same groups as thermo, this sample</th><th>Same as thermo, 4,416 molecules (separate run)</th><th>Same as DDBST's published assignment, this code / thermo (separate run)</th></tr></thead><tbody>
${fragRows}
</tbody></table></div>
<p>Joback values and group assignments for single molecules (Joback & Reid 1987 with the Tb base of 198 K; thermo uses 198.2 K, so its Tb and Tc are rebased):</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${ucVecTable}
</tbody></table></div>
<p>How good the estimates are: every organic molecule of the ChemSep databank that the groups cover (${estN} molecules; ${estFail} not covered by Joback) entered by its SMILES alone and compared with its own databank constants and correlations — Tb and liquid properties at 25 °C (or 0.8 Tb for light compounds), vapour viscosity at 1.1 Tb:</p>
<div class="tw"><table><thead><tr><th class="l">Property</th><th>n</th><th>Median |error|</th><th>90th percentile |error|</th><th>Mean error (bias)</th></tr></thead><tbody>
${estRows}
</tbody></table></div>
<p>Missing NRTL, UNIQUAC and Wilson pairs are filled by fitting the pair's parameters (a + b/T; NRTL α = 0.3) to Dortmund UNIFAC activity coefficients at three temperatures and seven compositions (original UNIFAC where Dortmund has no groups); supercritical gases keep Henry's law. For pairs that do have ChemSep NRTL data, the bubble temperature at 1 atm from the filled parameters minus that from ChemSep NRTL, K:</p>
<div class="tw"><table><thead><tr><th class="l">Pair</th><th class="l">Fitted to</th><th>rms ln γ</th><th>x₁ = 0.1</th><th>0.3</th><th>0.5</th><th>0.7</th><th>0.9</th></tr></thead><tbody>
${fillRows}
</tbody></table></div>
<p>Against measured data where the databank has no NRTL pair, and a user component in a flash:</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${fillVecTable}
</tbody></table></div>
<p>Transport properties of liquids at 25 °C against CoolProp reference correlations — from the databank correlations and from the structure alone (deviation in brackets). Units: ρ kg/m³, μ mPa·s, k W/(m·K), σ mN/m. Mean absolute deviation, databank: ρ ${f(avg37(tpDev.db.rho), 1)} %, μ ${f(avg37(tpDev.db.mu), 1)} %, k ${f(avg37(tpDev.db.k), 1)} %, σ ${f(avg37(tpDev.db.sig), 1)} %; from the SMILES: ρ ${f(avg37(tpDev.est.rho), 1)} %, μ ${f(avg37(tpDev.est.mu), 1)} %, k ${f(avg37(tpDev.est.k), 1)} %, σ ${f(avg37(tpDev.est.sig), 1)} %.</p>
<div class="tw"><table><thead><tr><th class="l">Source</th><th>ρ</th><th>μ</th><th>k</th><th>σ</th></tr></thead><tbody>
${tpRows}
</tbody></table></div>
<p>Mixture rules on databank gases — dry air at 1 atm (Herning–Zipperer viscosity, Wassiljewa–Mason–Saxena conductivity) against CoolProp's pseudo-pure air (Lemmon & Jacobsen 2004):</p>
<div class="tw"><table><thead><tr><th>T, K</th><th>μ, μPa·s</th><th>CoolProp</th><th>Δ</th><th>k, mW/(m·K)</th><th>CoolProp</th><th>Δ</th></tr></thead><tbody>
${airRows}
</tbody></table></div>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s37vec}
</tbody></table></div>
<p class="note">The few group assignments that differ from thermo over the large set are fused polycyclic hydrocarbons and quinodimethanes written in Kekulé form, where which rings count as aromatic is a convention. Group-contribution estimates are screening values: a large or strongly polar molecule can be off by more than the 90th percentile above, and Joback has no groups for some structures (formates, sulfones, furfural-type rings) — enter Tb, Tc and Pc for those. Estimated liquid viscosity is the weakest property; one measured value anchors it. Filled binary pairs are predictions, flagged in the run log and the property information; replace them with fitted data for design (vectors MB-291 to MB-305).</p>

<h2>37 · Aqueous electrolytes and sour water</h2>
<p>The <b>aqueous-electrolyte</b> method is the Pitzer (Harvie–Møller–Weare) model with the species, equilibrium constants, interaction parameters and mineral solubility products of the USGS PHREEQC <code>pitzer.dat</code> database for Na, K, Ca, Mg, Cl, S(VI), C(IV), H and O, unsymmetrical mixing (Eθ) for every pair of like-signed ions of different charge, and pH reported on the MacInnes scale. It is first checked against PHREEQC itself (${R38.pq.length} solutions; ${w38.nSi} saturation indices) — the same data set, so this is a check of the implementation, not of the data:</p>
<div class="tw"><table><thead><tr><th class="l">Solution (mol/kg water)</th><th>t, °C</th><th>a<sub>w</sub></th><th>PHREEQC</th><th>φ</th><th>PHREEQC</th><th>pH</th><th>PHREEQC</th><th>max |ΔSI| (n)</th></tr></thead><tbody>
${pq38Rows}
</tbody></table></div>
<p>Against independent data. NaCl at 25 °C against the critically evaluated osmotic and mean activity coefficients of Hamer &amp; Wu (1972):</p>
<div class="tw"><table><thead><tr><th>m, mol/kg</th><th>φ</th><th>Hamer &amp; Wu</th><th>γ<sub>±</sub></th><th>Hamer &amp; Wu</th></tr></thead><tbody>
${hw38Rows}
</tbody></table></div>
<p>Solubilities, where the saturation index crosses zero (the gypsum–anhydrite transition comes out at ${f(Ttr38 - 273.15, 0)} °C; measurements put it between about 42 and 58 °C):</p>
<div class="tw"><table><thead><tr><th class="l">Mineral</th><th>t, °C</th><th>Engine</th><th>Measured</th><th>Δ</th></tr></thead><tbody>
${sol38Rows.join('\n')}
</tbody></table></div>
<p>Seawater (Millero's reference composition with Sr as Ca and Br as Cl; boron left out) and twice-concentrated brine against TEOS-10, the international seawater standard — density from Laliberté's mixing rule, heat capacity from Laliberté's apparent heat capacities on IAPWS-IF97 water with the Pitzer heats of dilution at 25 °C, water activity from Pitzer:</p>
<div class="tw"><table><thead><tr><th>S<sub>A</sub>, g/kg</th><th>t, °C</th><th>ρ, kg/m³</th><th>TEOS-10</th><th>Δ</th><th>c<sub>p</sub>, J/(kg·K)</th><th>TEOS-10</th><th>Δ</th><th>a<sub>w</sub></th><th>TEOS-10</th></tr></thead><tbody>
${teos38Rows}
</tbody></table></div>
<p>The <b>sour-water</b> method solves NH₃, H₂S and CO₂ in water with their ionisation, ammonium carbamate and NaOH: equilibrium and Henry constants of Edwards et al. (1978) and Kawazuishi &amp; Prausnitz (1987), H₂S ionisation from the PHREEQC database, H₂S Henry constant IAPWS G7-04, and four Pitzer parameters (NH₄⁺–HCO₃⁻, NH₄⁺–HS⁻, NH₄⁺–carbamate, NH₃–NH₄⁺) fitted by multicalci (Levenberg–Marquardt) to the 99 measured partial pressures below. Each point compares the liquid-phase fugacity from the engine at the measured total pressure with the measured partial pressure times its Peng–Robinson vapour fugacity coefficient (mean |Δ| and bias, as ratios):</p>
<div class="tw"><table><thead><tr><th class="l">Data set</th><th>Gas</th><th>n</th><th>Mean |Δ|</th><th>Bias</th></tr></thead><tbody>
${sw38Rows}
</tbody></table></div>
<p>Each data set was also left out of the fit in turn and predicted from the others: Müller (NH₃ 13 %, CO₂ 22 %) and the API data (NH₃ 14 %, H₂S 24 %) are predicted as well as they are fitted, but Wilson et al. (93–260 °C; NH₃ 39 %, CO₂ 45 %, H₂S 48 %) and Leyko (20–60 °C; NH₃ 63 %, H₂S 143 %) are not — each covers a temperature range the others do not, so the fit should not be stretched beyond about 20–260 °C.</p>
<p>H₂S 0.05 mol/kg in pure water against the IUPAC-evaluated solubility (Fogg &amp; Young 1988), equilibrium pressure in kPa:</p>
<div class="tw"><table><thead><tr><th>t, °C</th><th>Engine</th><th>IUPAC</th><th>Δ</th></tr></thead><tbody>
${h2s38Rows}
</tbody></table></div>
<p>Heat of solution of the gases at 25 °C, dilute (kJ/mol; from the temperature dependence of the equilibrium pressure), against the recommended temperature dependence of Henry's constant in Sander's compilation (2015):</p>
<div class="tw"><table><thead><tr><th class="l">Gas</th><th>m, mol/kg</th><th>Engine</th><th>Sander (2015)</th></tr></thead><tbody>
${hsol38Rows}
</tbody></table></div>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s38vec}
</tbody></table></div>
<p class="note">Solids are not precipitated: a positive saturation index is reported and warned, and the solution stays supersaturated. pitzer.dat's CO₂(g) constant (Plummer &amp; Busenberg 1982) is replaced by IAPWS G7-04 for CO₂ volatility — the two agree within 1 % below 50 °C and differ by 5–9 % at 100–150 °C. In the aqueous-electrolyte method only the CO₂ component can leave the liquid, so carbonate alkalinity that should decompose on boiling is entered as Na₂CO₃ or K₂CO₃ plus CO₂. The Laliberté heat-capacity, density and viscosity correlations are fitted to roughly 0–140 °C and are held at their range limits outside it. Sour-water results above 10 mol solute per kg water are extrapolated (vectors MB-306 to MB-326).</p>

<h2>38 · Liquid enthalpy of the activity-coefficient methods</h2>
<p>NRTL, UNIQUAC, Wilson, UNIFAC and the solvents of the electrolyte methods take their liquid enthalpy from liquid heat capacities: water on IAPWS-IF97, every other component with a liquid-Cp correlation anchored at its normal boiling point (saturated vapour on the package's vapour model minus ΔHvap) and carried by ∫C<sub>p,L</sub> dT up to about 0.9 T<sub>c</sub>. The older route, h<sub>ig</sub> − ΔHvap(T), takes the liquid heat capacity from the slope of the ΔHvap correlation; it remains available (<code>liquid_enthalpy: 'hvap'</code>, the default of DWSIM's activity methods). Liquid heat capacity in kJ/(kg·K) against the reference equations of state in CoolProp; mean |Δ| up to the normal boiling point ${f(mean39(dev39.cp), 1)} % with the liquid-Cp route and ${f(mean39(dev39.hvap), 1)} % with the ΔHvap route:</p>
<div class="tw"><table><thead><tr><th class="l">Liquid</th><th>t, °C</th><th>CoolProp</th><th>Liquid-Cp route</th><th>ΔHvap route</th></tr></thead><tbody>
${cp39Rows}
</tbody></table></div>
<p>Heat of vaporisation (kJ/mol) as the package computes it, vapour minus liquid at the saturation pressure. At the normal boiling point the liquid-Cp route reproduces the ΔHvap correlation with either vapour model; at 25 °C it is within about 1.5 % with an ideal-gas vapour and 1 % with a Peng–Robinson vapour (ammonia at 10 bar needs the real-gas vapour):</p>
<div class="tw"><table><thead><tr><th class="l">Liquid</th><th>t, °C</th><th>CoolProp</th><th>Liquid-Cp, ideal vapour</th><th>Liquid-Cp, PR vapour</th><th>ΔHvap route, ideal vapour</th></tr></thead><tbody>
${hv39Rows}
</tbody></table></div>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s39vec}
</tbody></table></div>
<p class="note">Most liquid-Cp correlations end near the normal boiling point and are extrapolated above it — at 0.8 T<sub>c</sub> they are still within 2–9 % (acetone +9 %, ethanol +6 %); from 0.9 T<sub>c</sub> the ΔHvap route takes over with its offset fading to zero at T<sub>c</sub>. Components without a liquid-Cp correlation — mostly light gases and structure-only user components — stay on the ΔHvap route. The column-duty comparisons with DWSIM in section 22 are unchanged within their tolerance, because those columns run near the normal boiling points where both routes agree (vectors MB-327 to MB-332).</p>

<h2>39 · Ternary maps, azeotrope search, multi-outlet separator and property-method options</h2>
<p><b>Azeotropes.</b> The azeotrope search scans every binary edge for sign changes of y − x, then solves ternary and quaternary azeotropes by Newton's method on y(x) − x = 0 from several starts; where an activity method predicts two liquids at the boiling point the bubble point is heterogeneous (liquid–liquid split, then the bubble condition of one liquid). Temperature, and composition in wt %, at 101.325 kPa against tabulated data (${esc(R40.azeotrope_source)}); mean |ΔT| ${f(meanArr(azDev40.nrtl), 2)} K with NRTL, ${f(meanArr(azDev40.uniquac), 2)} K with UNIQUAC and ${f(meanArr(azDev40.modunifac), 2)} K with Dortmund UNIFAC (no binary data at all):</p>
<div class="tw"><table><thead><tr><th class="l">Azeotrope</th><th>Tabulated</th><th>NRTL</th><th>UNIQUAC</th><th>Dortmund UNIFAC</th></tr></thead><tbody>
${az40Rows}
</tbody></table></div>
<p>“none” means the model does not form that azeotrope with its parameters. Water with benzene and cyclohexane uses the pairs fitted to IUPAC-NIST mutual solubilities in round 11 (section 40); before that ChemSep had none and the UNIFAC estimate failed for water–cyclohexane, so NRTL treated that pair as ideal. UNIQUAC's ChemSep pair for acetone–chloroform also puts a spurious tangent azeotrope 0.003 mol from pure acetone (56.14 °C) beside the real maximum-boiling one at ${f(az40['methanol–acetone–chloroform|uniquac'].azeotropes.filter((a) => a.keys.length === 2 && a.keys.includes('acetone') && a.keys.includes('chloroform')).slice(-1)[0].T_K - 273.15, 2)} °C, and predicts ethanol–cyclohexane heterogeneous at its boiling point; both are properties of the parameter sets, reported as found.</p>
<p><b>Residue curve maps.</b> Residue curves integrate dx/dξ = x − y (Heun's method, adaptive step). Pure components, azeotropes and the heterogeneous points are classified from the eigenvalues of d(x − y)/dx plus the transverse direction 1 − K<sub>∞</sub> of the missing component; separatrices traced from the saddles are drawn as distillation boundaries. Classification against the published maps (Doherty &amp; Malone, <i>Conceptual Design of Distillation Systems</i>, 2001; Widagdo &amp; Seider, AIChE J. 42 (1996) 96) — ${topo40Ok} of ${topo40N} points agree:</p>
<div class="tw"><table><thead><tr><th class="l">Point</th><th>t, °C</th><th class="l">Published</th><th class="l">Engine</th></tr></thead><tbody>
${topo40Rows}
</tbody></table></div>
<p><b>Heat of mixing.</b> With <code>excess_enthalpy</code> on, the liquid enthalpy of an activity method includes H<sup>E</sup> = −RT² Σ x<sub>i</sub> ∂ln γ<sub>i</sub>/∂T. Equimolar values at 25 °C in J/mol; only Dortmund UNIFAC was fitted to heats of mixing (worst ${f(100 * Math.max(...hEdev40), 1)} % here) — NRTL, UNIQUAC and Wilson parameters regressed from vapour–liquid data alone can have the wrong sign, which is why the option is off by default:</p>
<div class="tw"><table><thead><tr><th class="l">Mixture</th><th>Calorimetry</th><th>NRTL</th><th>UNIQUAC</th><th>Wilson</th><th>UNIFAC</th><th>Dortmund UNIFAC</th></tr></thead><tbody>
${hE40Rows}
</tbody></table></div>
<p><b>Liquid volume.</b> Pure-liquid density in kg/m³ by each liquid-volume method against the ${esc(R40.rho_source)}. Mean |Δ|: automatic (ChemSep density correlations) ${f(meanArr(rhoDev40.auto), 2)} %, Rackett ${f(meanArr(rhoDev40.rackett), 2)} %, COSTALD ${f(meanArr(rhoDev40.costald), 2)} %, Peng–Robinson liquid root ${f(meanArr(rhoDev40.eos), 1)} %:</p>
<div class="tw"><table><thead><tr><th class="l">Liquid</th><th>t, °C</th><th>Reference</th><th>Automatic</th><th>Rackett</th><th>COSTALD</th><th>PR liquid root</th></tr></thead><tbody>
${rho40Rows}
</tbody></table></div>
<p>Equimolar methanol–water at 25 °C has a density of about ${f(mx40.rho, 0)} kg/m³ (${esc(mx40.source)}). The automatic method gives ${f(mixRho40[0], 1)} kg/m³ — an Amagat sum has no volume change on mixing — while the Rackett mixture rule gives ${f(mixRho40[1], 1)} and COSTALD ${f(mixRho40[2], 1)}. Rackett takes Z<sub>RA</sub> from ChemSep where tabulated (water's 0.2338 makes pure water 7 % dense) and otherwise the value that reproduces the component's own density at 25 °C.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s40vec}
</tbody></table></div>
<p class="note">The component separator now takes up to eight outlets, each with its own temperature and pressure (or pressure and vapour fraction on the property method); its duty is the enthalpy of all outlets minus the feed, checked above against an independent heater and against the ideal-gas enthalpy change of the cooled outlet. The Poynting correction on the pure-liquid fugacity of the activity methods, exp[V<sub>L</sub>(P − P<sub>sat</sub>)/RT], was always applied and can now be switched off to match programs that omit it. Residue curve maps and the azeotrope search run within the 10-second limit of a single request for up to eight components; very large regions of liquid–liquid immiscibility take the longest (water–ethanol–benzene with NRTL about ${f(az40['water–ethanol–benzene|nrtl'].ms / 1000, 1)} s for the search, a few seconds for the full map) (vectors MB-333 to MB-351).</p>

<h2>40 · Cross-check against DWSIM 10, water–hydrocarbon liquid–liquid data, volume translation and compressed liquids</h2>
<p><b>DWSIM 10.</b> Each case below was built in DWSIM 10.2.15 through its headless MCP server and in the engine with the same feed (default settings in both: ChemSep compounds and interaction parameters). The phase-equilibrium results agree within 0.3 % or 0.05 K in ${dw41.agree} of ${dw41.n} checks${dw41.off.length ? ' (the others: ' + dw41.off.map(sub).join('; ') + ')' : ''}; where the programs differ, an independent reference (reference equation of state, IUPAC-NIST, CRC) is given when one exists. The script that builds the cases is <code>scripts/dwsim-crosscheck.py</code>; it can be rerun against any DWSIM MCP server.</p>
<div class="tw"><table><thead><tr><th class="l">Case</th><th class="l">Quantity</th><th>DWSIM 10</th><th>Engine</th><th>Reference</th><th class="l">Note</th></tr></thead><tbody>
${dw41Rows}
</tbody></table></div>
<p><b>SRK binary parameters.</b> SRK now has a k<sub>ij</sub> table of its own (<code>api/_lib/mb-bip-srk.js</code>, built by <code>scripts/build-srk-kij.py</code> from ChemSep's DECHEMA SRK library; until this round SRK used the Peng–Robinson values). The library often lists several sets for one pair, some at cryogenic temperatures and a few far from the rest; the engine takes the median of the sets measured somewhere in 250–450 K, and the Peng–Robinson value where SRK has none in that range. DWSIM reads the same library but takes the first set listed and finds none for the pairs with N₂ or CO₂; given that set the engine reproduces DWSIM's SRK flash to 2×10⁻⁵ (case MB-389), so the two SRK equations are the same and only the k<sub>ij</sub> differ.</p>
<p>DWSIM's rigorous distillation column could not be driven through the server (its stage connections are not set by the server's connect call); the engine column is checked against independent calculations in sections 22 and 27.</p>
<p><b>Water–hydrocarbon pairs.</b> ChemSep has no NRTL or UNIQUAC parameters for water with hydrocarbons. Until this round the engine estimated them from UNIFAC — water in benzene came out more than twice the data, and water–toluene and water–alkane pairs failed the estimate's fit test and were treated as ideal, so those mixtures formed a single liquid. The pairs for benzene, toluene, ethylbenzene, the xylenes, cyclohexane, methylcyclohexane, C5–C8 n-alkanes and isooctane are now fitted (<code>scripts/fit-water-hydrocarbon.py</code>, Aspen form τ = a + b/T + e ln T, NRTL α = 0.2) to both liquid phases of the IUPAC-NIST reference mutual solubilities from 0 °C to 120–200 °C: the SDS-81 smoothing equations for the hydrocarbon in water, and for water in the hydrocarbon the SDS-81 reference equations (toluene and ethylbenzene from the IUPAC Technical Report of Bazyleva & Acree, 2021; alkanes from Mączyński et al., J. Phys. Chem. Ref. Data 33, 2004), the xylenes anchored at the recommended 25 °C value and benzene fitted to the IUPAC recommended values 25–70 °C. Mole fractions; worst deviation from the reference ${f(Math.max(...whcDev.nrtl), 1)} % (NRTL) and ${f(Math.max(...whcDev.uniquac), 1)} % (UNIQUAC). The measured values at 25 °C (${esc(R41.whc_rec_source)}) are shown under the reference: for water in the n-alkanes the reference equation sits about 20 % above the measurements at 25 °C and below them at 90 °C — that is the spread of the data the pairs carry.</p>
<div class="tw"><table><thead><tr><th class="l">Hydrocarbon<small>fitted range</small></th><th>t, °C</th><th>HC in water<small>reference</small></th><th>NRTL<small>Δ</small></th><th>UNIQUAC<small>Δ</small></th><th>water in HC<small>reference</small></th><th>NRTL<small>Δ</small></th><th>UNIQUAC<small>Δ</small></th></tr></thead><tbody>
${whcRows}
</tbody></table></div>
<p>With these pairs the water–ethanol–benzene layers at the ternary heteroazeotrope fall on the tabulated ones (upper 0.8 / 12.5 / 86.7 against 1.3 / 12.7 / 86.0 wt % water / ethanol / benzene, lower 43.4 / 50.9 / 5.8 against 43.1 / 52.1 / 4.8), and the heteroazeotropes of water with benzene, toluene and cyclohexane come within 0.5 K and 0.2 wt % of the CRC values (69.3, 84.1 and 69.8 °C). The vapour of the ternary heteroazeotrope carries 22 wt % ethanol against 18.5 tabulated (64.3 °C against 64.9 °C) — that part is set by the ChemSep ethanol pairs.</p>
<p><b>Volume translation.</b> Peng–Robinson puts the molar volume of H₂, He, N₂, O₂, Ar, CH₄ and CO 3–7 cm³/mol low. The engine now shifts it by constants fitted to the reference equations of state in CoolProp (Péneloux et al. 1982; <code>volume_translation: false</code> turns it off). The shift is consistent: enthalpy moves by −P Σx<sub>i</sub>c<sub>i</sub> and fugacity coefficients by −c<sub>i</sub>P/RT, so phase equilibria are unchanged and reaction equilibria move as the real-gas non-ideality requires. Reference, engine, plain Peng–Robinson:</p>
<div class="tw"><table><thead><tr><th class="l">Case</th><th class="l">Quantity</th><th>Reference</th><th>Engine</th><th>Plain PR</th></tr></thead><tbody>
${vtRows.join('\n')}
</tbody></table></div>
<p class="note">References: ${esc(R41.vt.syngas.src)}; ${esc(R41.vt.compressor_src)}; ${esc(R41.vt.nh3_src)}.</p>
<p><b>Compressed liquids.</b> Liquid densities from the density correlations, Rackett and COSTALD now carry the Thomson–Brobst–Hankinson (Tait) pressure correction, and a light gas dissolved below 10 mol % in a liquid takes a partial molar volume (about half its critical volume) instead of switching the whole liquid to COSTALD. An ammonia-loop separator liquid (2 mol % dissolved H₂, N₂, CH₄, Ar at 0 °C, 140 bar) now comes out at 638 kg/m³ against 622 before; pure ammonia at those conditions is 647.7 (DWSIM's default, which mixes mass densities with mole fractions, gives 658). Density in kg/m³ against the ${esc(R41.liq.src)}; worst ${f(Math.max(...liqDev41), 2)} %:</p>
<div class="tw"><table><thead><tr><th class="l">Liquid</th><th>t, °C</th><th>P, bar</th><th>Reference</th><th>Engine</th></tr></thead><tbody>
${liqRows}
</tbody></table></div>
<p>The Tait correction over-predicts the pressure effect of the n-alkanes by about a fifth at 500 bar (1.3 % on density) and under-predicts that of methanol (1.8 % at 300 bar). Ammonia liquid thermal conductivity now follows the reference correlation (the generic correlation was 15 % low).</p>
<p><b>Heterogeneous bubble points with an equation of state.</b> Nitrogen with ethane, propane or CO₂ near the critical pressure of nitrogen is two liquids below its bubble point — a nitrogen-rich and a heavy one — and the first vapour forms when the nitrogen-rich liquid boils. The bubble-point solver now checks whether the feed, taken as one liquid, would split; if it does, the bubble point is found as the temperature at which the lighter liquid of the split is at its own bubble point, so that three phases coexist (cases MB-392 to MB-395). Before, these cases either failed or returned the bubble point of the unstable single liquid, as DWSIM does — for nitrogen–ethane at 30 bar with DWSIM's SRK parameters 124.86 K against 124.87 K with the split, but at 10 bar with Peng–Robinson 101.0 K against 104.3 K, where the split is wide. Solids are not modelled.</p>
<p><b>Engine cases.</b> Round 11 cases with their references (robust dew and bubble points near the critical region and the heterogeneous bubble points included):</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s41vec}
</tbody></table></div>

<h2>41 · Extended component databank</h2>
<p>The property methods draw on ${(431 + R42.n).toLocaleString('en-US')} pure components: the 431 of the ChemSep databank and ${R42.n.toLocaleString('en-US')} added in round 12 (${cat42}). Every added compound has tabulated critical constants (IUPAC critical-property series, Matthews, CRC Handbook, DIPPR 801 as published by Pina-Martinez et al. 2019, PSRK tables) and a tabulated normal boiling point; ${t42.Tc.ref} fluids with a reference equation of state (refrigerants, siloxanes, others) take their constants and curves from it. The data were compiled from the published sources in the open-source <i>chemicals</i>, <i>CoolProp</i> and <i>thermo</i> libraries (MIT licence) by <code>scripts/gather-compdb-ext.py</code>; <code>scripts/build-compdb-ext.mjs</code> checks them and writes <code>api/_lib/mb-compdb-ext.js</code>. Where a value comes from for each component, and for every property:</p>
<div class="tw"><table><thead><tr><th class="l">Property</th><th>Measured / evaluated</th><th>Reference equation</th><th>Anchored on a measured point</th><th>Estimated</th></tr></thead><tbody>
${prov42}
</tbody></table></div>
<p class="note">“Anchored”: Rackett density through the CRC Handbook density at 20 °C. Vapour pressures counted as measured include ${R42.antoine_refit} Antoine equations (Landolt–Börnstein, NIST WebBook, Poling et al.) that cover only part of the curve and were refitted as DIPPR eq. 101 through their own points, the boiling point and the critical point. ${R42.noform} compounds have no measured or estimable ΔH<sub>f</sub> and are flagged “no ΔHf” in the program (fine in heat and material balances, not in reactions). Estimated values use the same methods as a component given by its structure (Joback, Lee–Kesler through the measured T<sub>b</sub>, T<sub>c</sub>, P<sub>c</sub>, Riedel–Watson, Rackett through the Tyn–Calus volume). UNIFAC and Dortmund groups are the DDBST assignments where they exist; the engine’s own fragmentation of the structure agrees with them for ${R42.groups.unifac.same} of ${R42.groups.unifac.same + R42.groups.unifac.differ} compounds (UNIFAC) and ${R42.groups.modunifac.same} of ${R42.groups.modunifac.same + R42.groups.modunifac.differ} (Dortmund).</p>
<p><b>Checks before a compound goes in.</b> The structure must give the formula the data are filed under; tabulated boiling points that disagree (they do by several kelvin now and then) are decided by a vapour-pressure equation covering the boiling point, which must reach 1 atm within 3 K of one of them, or else by agreement of two sources within 1.5 K; conflicting critical constants are decided by agreement with the Joback estimate, and a lone value far from it is not used; every correlation must stay inside physical limits at a temperature in its range (heat capacity rising with T and within 25 % of Joback, Trouton ratio 20–160 J/(mol K), density 300–3500 kg/m³ and falling with T, and so on). ${R42.n_dropped} compounds were left out:</p>
<ul>${drop42}</ul>
<p>${R42.n_rejected} correlations failed their check and were replaced by the next source or the estimate (${Object.entries(R42.rejected).map(([k, n]) => n + ' ' + ({ psat: 'vapour pressure', cpig: 'ideal-gas heat capacity', rhol: 'liquid density' }[k] || k)).join(', ')}). Before the databank was assembled this way, ${R42.gather_skips['critical constants from DIPPR only, without a measured boiling point and vapour-pressure equation'] || 0} compounds with DIPPR critical constants but no measured boiling point and vapour pressure were already excluded, as were compounds with metals or other elements outside C, H, O, N, S, the halogens, P, Si, B and the noble gases, salts, and molecules above 500 g/mol.</p>
<p><b>How good the estimates are.</b> Where a compound has a measured value, the estimate it would otherwise get was compared with it: vapour pressure by Lee–Kesler through T<sub>b</sub>, T<sub>c</sub>, P<sub>c</sub> — median ${pct42(E42.psat_lk.median)}, one point in ten off by more than ${pct42(E42.psat_lk.p90)} (${E42.psat_lk.n} points, 0.55–0.95 T<sub>c</sub>); Joback ideal-gas heat capacity — median ${pct42(E42.cp.median)}, 90th percentile ${pct42(E42.cp.p90)}; Rackett density through the Tyn–Calus volume — median ${pct42(E42.rho.median)}, 90th percentile ${pct42(E42.rho.p90)}; Riedel–Watson heat of vaporisation at T<sub>b</sub> — median ${pct42(E42.hv.median)}, 90th percentile ${pct42(E42.hv.p90)}. Two independent measured vapour-pressure equations for the same compound (${E42.psat_second_source.n} compounds, above 1 kPa) differ by a median ${pct42(E42.psat_second_source.median)} at their worst point — the spread of the data themselves.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Reference</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>Δ</th></tr></thead><tbody>
${case42}
</tbody></table></div>
<p class="note">The refrigerant and siloxane rows check that the curves fitted to the reference equations are carried through the flash and the liquid-volume model; R-410A checks a mixture of two added fluids with Peng–Robinson and no k<sub>ij</sub>. 2-Methyltetrahydrofuran / water is the honest case: Dortmund UNIFAC with the DDBST groups forms the two liquids and puts the heteroazeotrope 2 K low, but predicts mutual solubilities at 20 °C of 0.8 wt % water and 7 wt % 2-MeTHF against 4.4 and 14 wt % measured — fit NRTL to solubility data before designing a decanter. Engine test cases MB-396 to MB-404.</p>

<h2>42 · GERG-2008 and the reference equations of state</h2>
<p><b>GERG-2008</b> (Kunz &amp; Wagner, J. Chem. Eng. Data 57 (2012) 3032; ISO 20765-2) is the reference equation for natural gas and its 21 components — methane to n-decane, N₂, CO₂, H₂, O₂, CO, H₂O, H₂S, He and Ar. The engine's version (<code>api/_lib/mb-gerg.js</code>) is generated by <code>scripts/gen-gerg2008.py</code> from NIST's public-domain AGA 8 code; fugacity coefficients for phase equilibrium come from the analytic composition derivative of the Helmholtz energy (checked against central differences to 1e-8, and Σ x<sub>i</sub> ln φ<sub>i</sub> equals the residual Gibbs energy to 1e-15). The NIST test gas at 400 K and 500 bar, every property against the code's expected output (largest relative difference ${sci(aga43.worst)}):</p>
<div class="tw"><table><thead><tr><th class="l">Property</th><th>Engine</th><th>NIST AGA 8</th><th>|Δ|/value</th></tr></thead><tbody>
${aga43.html}
</tbody></table></div>
<p>Phase boundaries against CoolProp ${esc(R43.cp_version)}, which uses the GERG-2008 mixing functions on top of the reference equations of the pure fluids (GERG has its own, slightly simpler pure-fluid equations — the source of the small differences for the heavier components). Temperatures in K; largest difference ${f(gVleWorst, 3)} K, against ${f(gVleWorstPR, 2)} K for Peng–Robinson:</p>
<div class="tw"><table><thead><tr><th class="l">Mixture (mol %)</th><th class="l">Quantity</th><th>CoolProp</th><th>GERG-2008</th><th>Δ GERG</th><th>Δ Peng–Robinson</th></tr></thead><tbody>
${gergVleRows}
</tbody></table></div>
<p>Natural gas (CH₄ 85, C₂H₆ 7, C₃H₈ 3, nC₄ 1, N₂ 2, CO₂ 2 mol %), density and heat capacity against the same CoolProp model:</p>
<div class="tw"><table><thead><tr><th>T, K</th><th>P, bar</th><th>Δρ GERG</th><th>Δc<sub>p</sub> GERG</th><th>Δρ PR</th><th>Δc<sub>p</sub> PR</th></tr></thead><tbody>
${gergSpRows}
</tbody></table></div>
<p class="note">The heat-capacity differences of 0.05–0.1 % are those between GERG-2008's ideal-gas equations (Jaeschke &amp; Schley) and the reference ones. Peng–Robinson here includes the volume translation of section 40.</p>
<p><b>Reference equations of pure fluids</b> (<code>api/_lib/mb-helmholtz.js</code>, generated by <code>scripts/gen-helmholtz.py</code> from the coefficients distributed with CoolProp): ammonia (Gao et al. 2020), CO₂ (Span &amp; Wagner 1996), nitrogen (Span et al. 2000), normal hydrogen (Leachman et al. 2009), methane (Setzmann &amp; Wagner 1991), argon (Tegeler et al. 1999) and oxygen (Schmidt &amp; Wagner 1985). The engine evaluates them itself — residual power, Gaussian, the Gao terms of ammonia and the non-analytic critical terms of CO₂ — and solves the saturation line from equal fugacities. Against CoolProp (largest differences: molar density ${sci(refW43.rho)}, c<sub>p</sub> ${sci(refW43.cp)} — the engine takes c<sub>p</sub> as the numerical temperature derivative of the enthalpy — saturation temperature ${sci(refW43.T)} K, heat of vaporisation ${sci(refW43.h)}):</p>
<div class="tw"><table><thead><tr><th class="l">Fluid</th><th>T, K</th><th>P, bar</th><th class="l">Phase</th><th>ρ engine, kg/m³</th><th>ρ CoolProp</th><th>|Δρ|/ρ (molar)</th><th>|Δc<sub>p</sub>|/c<sub>p</sub></th></tr></thead><tbody>
${refRows43}
</tbody></table></div>
<div class="tw"><table><thead><tr><th class="l">Fluid</th><th>P, bar</th><th>T<sub>sat</sub> engine, K</th><th>T<sub>sat</sub> CoolProp</th><th>ΔH<sub>vap</sub> engine, J/mol</th><th>ΔH<sub>vap</sub> CoolProp</th></tr></thead><tbody>
${satRows43}
</tbody></table></div>
<p><b>Engine cases.</b> Round 12b cases with their references:</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s43vec}
</tbody></table></div>
<p class="note">GERG-2008 and the reference equations take their ideal-gas heat capacities from the equations themselves, placed on the same enthalpy and entropy basis as the other methods at 25 °C, so a stream keeps its enthalpy when it passes between units on different methods. Viscosity and thermal conductivity still come from the databank correlations. A GERG-2008 phase envelope takes a few seconds (the Helmholtz equation is far more expensive than a cubic).</p>

<h2>43 · Refinery methods: Peng–Robinson 1978, PRSV2, Lee–Kesler–Plöcker, Chao–Seader and Grayson–Streed</h2>
<p><b>Peng–Robinson 1978</b> differs from Peng–Robinson only in α(ω) for components with ω above 0.491 (heavy hydrocarbons and petroleum fractions). <b>PRSV2</b> (Stryjek &amp; Vera 1986) gives each component α = [1 + κ(1 − √T<sub>r</sub>)]² with κ = κ<sub>0</sub>(ω) + [κ<sub>1</sub> + κ<sub>2</sub>(κ<sub>3</sub> − T<sub>r</sub>)(1 − √T<sub>r</sub>)](1 + √T<sub>r</sub>)(0.7 − T<sub>r</sub>) below T<sub>r</sub> = 0.7. The engine's κ<sub>1</sub>–κ<sub>3</sub> are not the published table: <code>scripts/build-prsv2.mjs</code> fits them to the databank vapour pressure of every component that has one (${R44.prsv2.n_components} of them) — the α that makes Peng–Robinson reproduce the vapour pressure exactly, at 40 temperatures from the triple point (or 0.35 T<sub>c</sub>) to 0.7 T<sub>c</sub>, by linear least squares. Vapour pressures from the equation itself (equal fugacities) against the databank correlation:</p>
<div class="tw"><table><thead><tr><th>T<sub>r</sub></th><th>Components</th><th>PRSV2 median</th><th>PRSV2 90th pct.</th><th>Peng–Robinson median</th><th>Peng–Robinson 90th pct.</th></tr></thead><tbody>
${prsv2Rows44}
</tbody></table></div>
<p class="note">Above T<sub>r</sub> = 0.7 the κ<sub>1</sub>–κ<sub>3</sub> term is zero, as Stryjek and Vera prescribe, so PRSV2 is only as good as the acentric factor there — the same as Peng–Robinson. Where the databank vapour-pressure curve and the critical constants disagree, both show it at high T<sub>r</sub>.</p>
<p><b>Lee–Kesler–Plöcker</b> (Lee &amp; Kesler 1975; Plöcker, Knapp &amp; Prausnitz 1978): the simple-fluid and n-octane reference BWR equations in reduced variables, Plöcker's pseudo-critical mixing rules with η = 0.25, hydrogen with the Gunn–Chueh–Prausnitz quantum-corrected constants. Fugacity coefficients come from the analytic composition derivative through T<sub>r</sub>, P<sub>r</sub> and ω (checked against central differences of n·G<sup>R</sup>/RT to 5e-9). Plöcker's own k<sub>ij</sub> table is not freely available, so <code>scripts/fit-lkp-kij.mjs</code> fits k<sub>ij</sub> (the multiplier on T<sub>c,ij</sub>) for each pair of the GERG-2008 components that has fitted GERG-2008 mixture parameters — water and helium left out — to GERG-2008 bubble pressures at three temperatures and three compositions below 100 bar: ${L44.n_pairs} pairs, median mean absolute deviation in bubble pressure ${f(100 * L44.median_aad, 1)} % (one pair in ten above ${f(100 * L44.p90_aad, 0)} %), against ${f(100 * L44.median_aad_k1, 0)} % with k<sub>ij</sub> = 1. Other pairs take correlations fitted to that table: hydrocarbon pairs k = 1 + a lnτ lnν + b lnτ + c (lnτ)² (τ, ν the T<sub>c</sub> and V<sub>c</sub> ratios; ${L44.hc2.n} pairs, rms ${f(L44.hc2.rms, 3)}), and a line in ln(T<sub>c,HC</sub>/T<sub>c,gas</sub>) for each of N₂, CO₂, CO, H₂, methane, ethane and propane with heavier hydrocarbons. ${L44.replaced.length ? L44.replaced.map((r) => esc(r.pair.replace('|', ' – '))).join(' and ') + ' lay far off the homologous trend (GERG-2008 rests on sparse data there) and take the correlation instead. ' : ''}Examples:</p>
<div class="tw"><table><thead><tr><th class="l">Pair</th><th>k<sub>ij</sub></th><th>Deviation from GERG-2008</th><th>With k<sub>ij</sub> = 1</th></tr></thead><tbody>
${lkpEx44}
</tbody></table></div>
<p class="note">Methane, nitrogen and CO₂ with the heavier alkanes and hydrogen with any hydrocarbon keep deviations of 5–18 %: a single k<sub>ij</sub> cannot follow GERG-2008's temperature dependence there. For hydrogen with hydrocarbons, Chao–Seader or Grayson–Streed is the better choice.</p>
<p><b>Chao–Seader and Grayson–Streed</b> (Chao &amp; Seader 1961; Grayson &amp; Streed 1963): K = ν γ / φ<sup>V</sup> with the corresponding-states liquid fugacity coefficient ν (simple fluid plus ω term, hydrogen and methane with constants of their own), the Scatchard–Hildebrand regular solution with the solubility parameters and 25 °C liquid volumes (31 and 52 cm³/mol for hydrogen and methane), and a Redlich–Kwong vapour. Liquid enthalpy and entropy come from Lee–Kesler with Plöcker mixing, as commercial simulators do — the temperature derivative of ν gives heat capacities 10–20 % low.</p>
<p>All five against DWSIM ${esc(R44.dwsim_version.replace('DWSIM ', ''))} with the same inputs (numbers only; none of DWSIM's code is used). Largest bubble/dew-point difference: PR78 ${f(worst44.pr78.T, 3)} K, PRSV2 ${f(worst44.prsv2.T, 2)} K (different κ<sub>1</sub>–κ<sub>3</sub>), Chao–Seader ${f(worst44['chao-seader'].T, 2)} K, Grayson–Streed ${f(worst44['grayson-streed'].T, 2)} K, Lee–Kesler–Plöcker ${f(worst44.lkp.T, 1)} K (different k<sub>ij</sub>):</p>
<div class="tw"><table><thead><tr><th class="l">Case (mol %)</th><th class="l">Method</th><th class="l">Quantity</th><th>DWSIM</th><th>Engine</th><th>Δ</th></tr></thead><tbody>
${dw44}
</tbody></table></div>
<p class="note">DWSIM's Lee–Kesler–Plöcker uses its own k<sub>ij</sub> table and estimates; the engine's bubble points lie closer to GERG-2008 for methane / propane (231.3 K) and propane / n-hexane (332.9 K). The hydrotreater K of methane is 7 % higher than DWSIM's with both Chao–Seader and Grayson–Streed while hydrogen, n-hexane and n-decane agree within 0.7 %. The enthalpy differences of 1–2 kJ/kg for natural gas are the ideal-gas heat capacities of the two databanks (Peng–Robinson shows the same).</p>
<p><b>Bubble and dew pressures</b> of equation-of-state mixtures now fall back on a scan of PT flashes in pressure when the Newton solution fails or lands on the trivial one, as bubble and dew temperatures already did — a light gas dissolved in a heavy liquid above its critical temperature (methane in n-hexane at 355 K) had no bubble pressure before. Engine cases:</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s44vec}
</tbody></table></div>

<h2>44 · UNIFAC-LL, NIST-modified UNIFAC and the viscosity of aqueous MDEA</h2>
<p><b>UNIFAC-LL</b> (Magnussen, Rasmussen &amp; Fredenslund, Ind. Eng. Chem. Process Des. Dev. 20 (1981) 331) is original UNIFAC with interaction parameters fitted to liquid–liquid equilibria — 57 subgroups in 32 main groups, temperature-independent a<sub>mn</sub>, propanols as groups of their own. <b>NIST-modified UNIFAC</b> (Kang, Diky &amp; Frenkel, Fluid Phase Equilib. 388 (2015) 128) is the Dortmund form with groups and parameters refitted to critically evaluated data — 201 subgroups, including branched ketones, ring ethers and amines, aromatic acids and esters. Both tables come from the thermo library (MIT licence; <code>scripts/gen-unifac2.py</code>, one typo in its UNIFAC-LL table corrected: R of the ring CH₂O group is 0.9183). The engine's activity coefficients equal thermo's with the same groups to ${sci(R45.thermo_check.max_rel)} (${R45.thermo_check.systems} mixtures). Groups come from each component's structure with the SMARTS of each table: ${G45.n_lle} of the ${G45.n_db} databank components get UNIFAC-LL groups (${G45.lle.smarts} from the structure, ${G45.lle.mapped} mapped from their UNIFAC groups; the rest contain groups UNIFAC-LL does not have — amines, sulfur, fluorine — and are treated with the combinatorial term only, as the run log says), ${G45.n_nist} get NIST groups; for ${G45.nist_vs_dortmund[1]} of them the NIST assignment differs from the Dortmund one because NIST has the finer group. Components added by structure take the groups mapped from their UNIFAC and Dortmund assignments.</p>
<p>Mutual solubilities of water and hydrocarbons at 25 °C, as ratios to the IUPAC-NIST recommended values of section 40 (1.00 = exact):</p>
<div class="tw"><table><thead><tr><th class="l" rowspan="2">Hydrocarbon</th><th rowspan="2">x<sub>HC</sub> in water</th><th rowspan="2">x<sub>water</sub> in HC</th><th colspan="2">UNIFAC</th><th colspan="2">Dortmund</th><th colspan="2">UNIFAC-LL</th><th colspan="2">NIST UNIFAC</th></tr><tr><th>HC in water</th><th>water in HC</th><th>HC in water</th><th>water in HC</th><th>HC in water</th><th>water in HC</th><th>HC in water</th><th>water in HC</th></tr></thead><tbody>
${lleRows45}
</tbody></table></div>
<p>Water with polar solvents at 25 °C (80 / 20 mol % feed): x of the solvent in the water layer / x of water in the organic layer. Measured, approximately: 1-butanol 0.019 / 0.51, methyl ethyl ketone 0.07 / 0.31, ethyl acetate 0.017 / 0.13, MIBK 0.003 / 0.10.</p>
<div class="tw"><table><thead><tr><th class="l">Solvent</th><th>UNIFAC</th><th>Dortmund</th><th>UNIFAC-LL</th><th>NIST UNIFAC</th></tr></thead><tbody>
${polar45}
</tbody></table></div>
<p class="note">No version is best everywhere. UNIFAC-LL puts the 1-butanol–water layers within a few per cent of the measurements and benzene, toluene and ethylbenzene within about 25 % both ways, where Dortmund and NIST UNIFAC put 2–3 times too much water into the aromatics; but UNIFAC-LL makes ethyl acetate and methyl ethyl ketone 2–3 times too insoluble in water, and every version over-predicts alkanes in water by an order of magnitude or more. UNIFAC-LL is also the poorest of the four for vapour–liquid equilibrium (ethanol–water bubbles about 2 K high), so it is meant for extraction and decanters, not distillation. None of them replaces NRTL fitted to solubility data for a decanter design.</p>
<p>NIST-modified UNIFAC against DWSIM ${esc(R45.dwsim_version.replace('DWSIM ', ''))}, same inputs — DWSIM carries the same Kang et al. (2015) parameters, and the two agree to the solver tolerance where both find the same phases (largest bubble-point difference ${f(nistW45, 3)} K, methyl ethyl ketone / toluene). For four of the water–solvent feeds DWSIM's flash returns a single liquid although its activity coefficients equal the engine's (bubble points inside each single-liquid region agree to 1e-8 K): the split is in the model, and the engine's stability test finds it.</p>
<div class="tw"><table><thead><tr><th class="l">System</th><th class="l">Quantity</th><th>DWSIM</th><th>Engine</th><th>Δ</th></tr></thead><tbody>
${nist45}
</tbody></table></div>
<p class="note">DWSIM 10's UNIFAC-LL is not usable as a reference: it finds no liquid split in any of the seven water–solvent feeds and puts bubble points outside the boiling points of the pure components (${R45.unifacll_dwsim_bubble.slice(0, 3).map((r) => esc(r.case.replace(/ 1\.01 bar$/, '')) + ' ' + f(r.dwsim, 1) + ' K, engine ' + f(r.engine, 1) + ' K').join('; ')}). The engine's UNIFAC-LL is checked against thermo and the measured solubilities above instead.</p>
<p><b>Viscosity of aqueous MDEA and activated MDEA.</b> The Aqueous MDEA method had no liquid viscosity until now (reported as unavailable). It now uses the form of Weiland et al. (J. Chem. Eng. Data 43 (1998) 378), ln(μ/μ<sub>w</sub>) = W[(aW + b)T + (cW + d)][1 + α(fT + g)]/T² (W mass % amine on a CO₂-free basis, α mol CO₂ per mol amine), with a–d fitted here to ${esc(R45.visc_src.unloaded)} (${VF45.n_unloaded} points, mean deviation ${f(100 * VF45.aard_unloaded, 1)} %, largest ${f(100 * VF45.max_unloaded, 1)} %) and f, g to ${esc(R45.visc_src.loaded)} (${VF45.n_loaded} points up to α = 0.85, mean deviation ${f(100 * VF45.aard_loaded, 1)} % on μ(α)/μ(0)). Piperazine is counted as MDEA by mass — an estimate. The liquid now also reports a pH from the H⁺ molality of the speciation (activity coefficient taken as 1). Against DWSIM's CO2 Capture (eNRTL) package for the lean-solvent streams you exported from it (DWSIM / engine):</p>
<div class="tw"><table><thead><tr><th class="l">39 wt % MDEA + 2.5 wt % PZ</th><th>Density, kg/m³</th><th>Viscosity, mPa s</th><th>c<sub>p</sub>, kJ/(kg K)</th><th>Conductivity, W/(m K)</th><th>pH</th></tr></thead><tbody>
${am45}
</tbody></table></div>
<p class="note">Densities agree within 0.3 % and conductivities within 6 %. DWSIM's heat capacity of 2.2–2.5 kJ/(kg K) is about a third below the calorimetric value of 40 wt % MDEA solutions (about 3.6–3.7 kJ/(kg K) near 40 °C), and its viscosity of the loaded solvent at 73 °C (1.27 mPa s) is below the measured viscosity of the unloaded solvent at that temperature; the engine follows the measurements.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s45vec}
</tbody></table></div>

<h2>45 · Stream properties: C<sub>v</sub>, C<sub>p</sub>/C<sub>v</sub>, speed of sound and the Joule–Thomson coefficient</h2>
<p>The stream-properties view reports, for each phase, the derived properties of the equation of state alongside density, enthalpy, entropy and C<sub>p</sub>. They come from the phase volume V(T, P, x) by central differences: C<sub>v</sub> = C<sub>p</sub> − T(∂V/∂T)<sub>P</sub><sup>2</sup> / [−(∂V/∂P)<sub>T</sub>]; the speed of sound w = √[(C<sub>p</sub>/C<sub>v</sub>) / (ρ κ<sub>T</sub>)] with κ<sub>T</sub> = −(1/V)(∂V/∂P)<sub>T</sub>; and μ<sub>JT</sub> = [T(∂V/∂T)<sub>P</sub> − V] / C<sub>p</sub>. A vapour gets all four from any method. A liquid gets μ<sub>JT</sub> from any method, but C<sub>v</sub>, C<sub>p</sub>/C<sub>v</sub> and w only from Steam / water, the reference equations and GERG-2008: liquid-density correlations (Rackett, COSTALD) fix the density well but not its pressure derivative, and give liquid compressibilities several times too large. The Steam / water method takes w directly from IAPWS-IF97. The mixture C<sub>p</sub> of a two-phase stream is the slope of the flash enthalpy and includes the latent heat. The bubble and dew points shown with the stream are the same bubble- and dew-point flashes as the phase envelopes of section 10.</p>
<p>Against CoolProp, which implements the same reference equations independently:</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s46vec}
</tbody></table></div>
<p class="note">Water is computed with IAPWS-IF97 and compared with IAPWS-95; the two formulations differ by about 0.1 % in the speed of sound of liquid water. The wet-gas row checks that the view reproduces the flash drum of the knock-out example at the same state.</p>

<h2>46 · Energy streams</h2>
<p>An energy stream carries heat or shaft work from one unit to another, as in other sequential-modular simulators: the unit at the arrow head takes the energy the unit at the tail gives up as its own specification — its duty (heater, mixer, flash drum, three-phase separator) or its shaft power (compressor). The solver treats each link as a calculator: receiving duty = −(source duty or work) × fraction delivered, run after the source and before the receiver, or, when the receiver lies upstream of the source in the same process, converged by repeated passes around the flowsheet. An arrow with no source gives a duty you type in; an arrow with no receiver only reports the source’s duty. Heat goes to heat and work to work; turbines, pumps and exchangers cannot receive energy streams, and both refusals are tested.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">Description</th><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>|Δ|</th></tr></thead><tbody>
${s47vec}
</tbody></table></div>
<p class="note">References from the independent Python iapws library (IAPWS97) for the same water and steam states; the syngas compressor of the first case only has to absorb the 98 % of the turbine power it receives. The flowsheet example “Steam-turbine-driven compressor with heat recovery” shows both kinds of link.</p>

<h2>Scope</h2>
<p>These checks verify the implementation against independent references. Agreement with another simulator shows the equations are solved correctly for the given parameters; it does not make a property method suitable for every system — Peng–Robinson without fitted k<sub>ij</sub> over-predicts the solubility of water in hydrocarbon liquids, ChemSep NRTL / UNIQUAC parameters are fitted to vapour–liquid data, and the classic urea units remain empirical correlations (the urea synthesis method of section 30 is the rigorous alternative). Use the results for preliminary engineering and confirm them against plant data before design use. Kinetic reactors are only as good as the rate expressions entered, and the acid association model covers dimerisation only (no acid–water cross association; binary parameters fitted without association may need refitting). The CO₂ packages cover CO₂ only (H₂S and NH₃ chemistry is the sour-water method of section 37), the piperazine part of activated MDEA is a fit to measured CO₂ pressures (section 20), and tray efficiencies stand in for rate-based mass transfer. The Steam / water method takes pure water only. Sections 21–46 are generated by this page's build script from the references in <code>tests/validation-references.json</code>. Peng–Robinson has no built-in k<sub>ij</sub> for H₂–NH₃ or CH₄–NH₃; calibrate them against plant separator data for ammonia-loop work. The inputs for every other case above are in the engine test set, cases MB-089 to MB-444.</p>
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
console.log('Step 34: urea Y rms', yRms34.toFixed(3), 'worst', yWorst.toFixed(3), '· bubble P rms', (100 * pRms34).toFixed(1) + ' %', 'worst', (100 * pWorst).toFixed(1) + ' %', '· train Q gap', trQgap.toExponential(2), '· pseudo Twu Tc rms', rms34(st.twu.Tc).toFixed(2) + ' %');
console.log('Step 36:', s36Pass + '/' + s36N, 'in tolerance');
console.log('Step 35: recycle passes Broyden', rcB.loops[0].iterations, 'Wegstein', rcW.loops[0].iterations, '· spec Newton steps', SH35.steps.length - 1);
console.log('wrote', path.relative(ROOT, OUT), '— PR worst', prWorst.toExponential(2), '· classic vs rigorous PR', dwWorst.toExponential(2), '· NRTL worst', nrWorst.toExponential(2), '· wet gas', koDev.toFixed(3) + ' %');
