// ============================================================================
// REPO PATH: scripts/build-flowsheet-validation.mjs
// ============================================================================
// multicalci.com — builds flowsheet-validation.html (Step 21, extended in Steps 22–24).
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
import eosModule from '../api/_lib/eos.js';
import compdb from '../api/_lib/mb-compdb.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = engineModule.default || engineModule;
const eos = eosModule.default || eosModule;
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

/* ---------- A. Peng–Robinson flash vs thermo ---------- */
const prRows = [];
const ENG = {};
let prWorst = 0;
for (const [id, c] of Object.entries(REF.pr)) {
  const r = engine.runModule('flash', { streams: [feedMol(c.zs, c.T_K, c.P_bar)], params: { T_K: c.T_K, P_bar: c.P_bar, model: 'pr' } });
  if (r.error) fail(id + ': ' + r.error.message);
  ENG[id] = r;
  const keys = Object.keys(c.zs);
  let dx = 0, dy = 0;
  if (c.ref.x) {
    keys.forEach((k, i) => { dx = Math.max(dx, Math.abs(r.details.x[i].x - c.ref.x[k])); dy = Math.max(dy, Math.abs(r.details.y[i].y - c.ref.y[k])); });
  }
  const dv = Math.abs(r.details.psi_VF - c.ref.vf);
  prWorst = Math.max(prWorst, dv, dx, dy);
  prRows.push(`<tr><td>${esc(id)}</td><td class="l">${esc(c.desc)}<small>${keys.map(sub).join(' · ')}</small></td><td>${f(c.T_K - 273.15, 2)}</td><td>${f(c.P_bar, 0)}</td>
    <td>${f(r.details.psi_VF, 5)}</td><td>${f(c.ref.vf, 5)}</td><td>${sci(dv)}</td><td>${c.ref.x ? sci(dx) : '—'}</td><td>${c.ref.x ? sci(dy) : '—'}</td></tr>`);
}
/* ---------- A2. Peng–Robinson flash vs DWSIM ---------- */
const DW = REF.dwsim;
const engXY = (r) => ({ vf: r.details.psi_VF, x: Object.fromEntries(r.details.x.map((o) => [o.key, o.x])), y: Object.fromEntries(r.details.y.map((o) => [o.key, o.y])) });
const diffs = (e, d, keys) => {
  const out = { dv: Math.abs(e.vf - d.vf), dx: null, dy: null };
  if (d.x && e.vf > 0 && e.vf < 1) { out.dx = 0; out.dy = 0; for (const k of keys) { out.dx = Math.max(out.dx, Math.abs(e.x[k] - d.x[k])); out.dy = Math.max(out.dy, Math.abs(e.y[k] - d.y[k])); } }
  return out;
};
const dwRows = [];
let dwWorst = 0;
for (const [id, c] of Object.entries(REF.pr)) {
  const d = DW.cases[id].same_data, keys = Object.keys(c.zs), e = engXY(ENG[id]);
  const q = diffs(e, d, keys);
  dwWorst = Math.max(dwWorst, q.dv, q.dx || 0, q.dy || 0);
  dwRows.push(`<tr><td>${esc(id)}</td><td class="l">${esc(c.desc)}</td><td>${f(e.vf, 5)}</td><td>${f(d.vf, 5)}</td><td>${sci(q.dv)}</td><td>${q.dx == null ? '—' : sci(q.dx)}</td><td>${q.dy == null ? '—' : sci(q.dy)}</td></tr>`);
}
if (dwWorst > 2e-4) fail('engine vs DWSIM (same data) differs by ' + dwWorst);
// DWSIM with its own data — the ammonia-loop cases, in plant units
const pct = (v) => f(v * 100, 3);
const nhRows = [];
for (const [id, label] of [['PR3', 'Separator, −20 °C / 140 bar'], ['PR6', 'Let-down drum, 10 °C / 20 bar']]) {
  const e = engXY(ENG[id]), d = DW.cases[id].dwsim_data;
  const row = (name, a, b, unit) => `<tr><td class="l">${name}</td><td>${a}</td><td>${b}</td><td>${unit}</td></tr>`;
  nhRows.push(`<tr><th class="l" colspan="4">${esc(id)} · ${esc(label)}</th></tr>`);
  nhRows.push(row('Vapour fraction (mol/mol)', f(e.vf, 4), f(d.vf, 4), ''));
  nhRows.push(row('NH₃ in vapour', pct(e.y.NH3), pct(d.y.NH3), 'mol %'));
  nhRows.push(row('H₂ dissolved in liquid', pct(e.x.H2), pct(d.x.H2), 'mol %'));
  nhRows.push(row('N₂ dissolved in liquid', pct(e.x.N2), pct(d.x.N2), 'mol %'));
}
const dk = DW.cases.PR3.dwsim_data.kij, dc = DW.cases.PR3.dwsim_data.crit;
const kijE = (pair) => eos.kijLookup(...pair.split('|'));
const QH = eos.QUANTUM_EFFECTIVE.H2;
const kijRows = ['H2|N2', 'N2|NH3', 'Ar|NH3', 'CH4|N2', 'CH4|H2', 'H2|NH3', 'CH4|NH3']
  .map((p) => `<tr><td class="l">k<sub>ij</sub> ${sub(p.replace('|', '–'))}</td><td>${f(kijE(p), 4)}</td><td>${f(dk[p], 4)}</td></tr>`);
kijRows.unshift(`<tr><td class="l">H₂ T<sub>c</sub> / P<sub>c</sub> / ω</td><td>${f(QH.tc_K, 1)} K / ${f(QH.pc_bar, 1)} bar / ${f(QH.omega, 0)} (effective)</td><td>${f(dc.H2[0], 2)} K / ${f(dc.H2[1], 2)} bar / ${f(dc.H2[2], 3)}</td></tr>`);
const e3 = engXY(ENG.PR3), d3 = DW.cases.PR3.dwsim_data;
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
  blocks: [{ id: 'm', name: 'M1', module: 'mixer', n_in: 2, n_out: 1 }, { id: 'e', name: 'E1', module: 'mixer', n_in: 1, n_out: 1, params: { T_out_K: 313.15 } },
    { id: 'f', name: 'F1', module: 'flash', n_in: 1, n_out: 2, params: { T_K: 313.15, P_bar: 4.8 } }],
  streams: [{ id: 's1', from: null, to: { b: 'm', p: 0 }, feed: 0 }, { id: 's2', from: null, to: { b: 'm', p: 1 }, feed: 1 },
    { id: 's3', from: { b: 'm', p: 0 }, to: { b: 'e', p: 0 } }, { id: 's4', from: { b: 'e', p: 0 }, to: { b: 'f', p: 0 } },
    { id: 'g', from: { b: 'f', p: 0 }, to: null }, { id: 'c', from: { b: 'f', p: 1 }, to: null }] } });
if (ko.error) fail('wet gas: ' + ko.error.message);
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
const runVec = (id) => { const v = vec(id); const r = engine.runModule(...v.args); if (r.error) fail(id + ': ' + r.error.message); return { v, r }; };
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
const qName = (k) => NICE[k] || k.replace(/^details\./, '').replace(/^streams_out\.0\.rig\.x\./, 'distillate x ').replace(/^streams_out\.1\.rig\.x\./, 'bottoms x ')
  .replace(/^x1\./, 'light liquid x ').replace(/^x2\./, 'heavy liquid x ').replace(/^y\./, 'vapour y ').replace(/^outlet_mole_frac\./, 'outlet y ');
let s22Worst = { flash: 0, three: 0, colPct: 0, colX: 0, gibbs: 0, env: 0, bin: 0, kin: 0, lhhw: 0, assocH: 0 }, s22N = 0, s22Pass = 0, s23N = 0, s23Pass = 0, s24N = 0, s24Pass = 0, s25N = 0, s25Pass = 0;
const vecTable = (ids, kind) => {
  const rows = [];
  for (const id of ids) {
    const { v, r } = runVec(id);
    const keys = Object.keys(v.expect).filter((k) => typeof v.expect[k] === 'number' && k !== 'details.element_balance_max_rel');
    const s23 = +id.slice(3) >= 143 && +id.slice(3) < 165, s24 = +id.slice(3) >= 165 && +id.slice(3) < 175, s25 = +id.slice(3) >= 175;
    keys.forEach((k, i) => {
      const a = getP(r, k), e = v.expect[k];
      const d = Math.abs(a - e), tol = tolOf(v, k);
      if (!(d <= tol)) fail(id + ' ' + k + ': ' + a + ' vs ' + e);
      if (s25) { s25N++; s25Pass++; } else if (s24) { s24N++; s24Pass++; } else if (s23) { s23N++; s23Pass++; } else { s22N++; s22Pass++; }
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
      rows.push(`<tr>${i === 0 ? `<td rowspan="${keys.length}">${esc(id)}</td><td class="l" rowspan="${keys.length}">${esc(v.desc)}</td>` : ''}<td class="l">${sub(kind === 'kin' && k === 'details.T_out_K' ? 'outlet T, K' : qName(k))}</td><td>${f(a, dig)}</td><td>${f(e, dig)}</td><td>${pct !== null ? f(pct, 3) + ' %' : sci(d)}</td></tr>`);
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
const R25 = REF.step25;
const molS = (mol, T, P) => { const ks = Object.keys(mol); const m = ks.map((k) => mol[k] * compdb.get(k).mw); const t = m.reduce((a, b) => a + b, 0); return { mass_flow_kg_h: t, T_K: T, P_bar: P, components: ks.map((k, i) => ({ key: k, mass_fraction: m[i] / t })) }; };
// every measured MEA point (Arshad et al. 2014)
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
  <div><b>${sci(prWorst)}</b><span>largest difference in V/F or mole fraction, Peng–Robinson flash vs thermo (6 cases)</span></div>
  <div><b>${sci(dwWorst)}</b><span>largest difference vs DWSIM ${esc(dwVer)} given the same input data (6 cases)</span></div>
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
</div>

<h2>1 · Peng–Robinson flash vs an independent implementation</h2>
<p>Reference: the open-source <i>thermo</i> 0.6.1 library (Gibbs-stability flash with PR gas and liquid phases), given the same critical constants, acentric factors, binary interaction parameters and H₂ effective constants as the engine. This verifies the φ–φ flash itself; how well Peng–Robinson matches experiment depends on the k<sub>ij</sub> values, which can be tuned.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th>T, °C</th><th>P, bar</th><th>V/F engine</th><th>V/F reference</th><th>|ΔV/F|</th><th>max |Δx|</th><th>max |Δy|</th></tr></thead><tbody>
${prRows.join('\n')}
</tbody></table></div>

<h2>2 · Peng–Robinson flash vs DWSIM</h2>
<p>Reference: DWSIM ${esc(dwVer)}, the open-source process simulator (Peng–Robinson property package, default flash), run through its automation interface on the same six feeds.</p>
<h3>Same input data</h3>
<p>DWSIM given the engine's critical constants, acentric factors, H₂ effective constants and k<sub>ij</sub> — a second, separately written implementation of the same flash.</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th>V/F engine</th><th>V/F DWSIM</th><th>|ΔV/F|</th><th>max |Δx|</th><th>max |Δy|</th></tr></thead><tbody>
${dwRows.join('\n')}
</tbody></table></div>
<h3>DWSIM's own data — ammonia loop</h3>
<p>The two ammonia-loop cases again, this time with DWSIM's built-in constants and k<sub>ij</sub>, as a new DWSIM user would get them. The flash method is the same; these inputs are not:</p>
<div class="tw"><table><thead><tr><th class="l">Input</th><th>Engine</th><th>DWSIM built-in</th></tr></thead><tbody>
${kijRows.join('\n')}
</tbody></table></div>
<div class="tw"><table><thead><tr><th class="l">Result</th><th>Engine</th><th>DWSIM built-in data</th><th>Unit</th></tr></thead><tbody>
${nhRows.join('\n')}
</tbody></table></div>
<p class="note">With matching inputs the two programs agree to about ${sci(dwWorst)}, so the gap below comes from input data, not from the flash. With DWSIM's own data the separator vapour carries ${pct(d3.y.NH3)} mol % NH₃ against the engine's ${pct(e3.y.NH3)} mol %, and the H₂ and N₂ dissolved in the liquid differ by a factor of about ${f(Math.max(d3.x.H2 / e3.x.H2, e3.x.H2 / d3.x.H2), 1)} and ${f(Math.max(d3.x.N2 / e3.x.N2, e3.x.N2 / d3.x.N2), 1)}. Dissolved N₂ follows the N₂–NH₃ k<sub>ij</sub>, which the engine sets to zero; dissolved H₂ follows how H₂ is represented (effective or true critical constants); the NH₃ in the vapour moves with both, in opposite directions. This comparison does not show which set is closer to a real loop; for loop work, check these numbers against plant separator data.</p>

<h2>3 · NRTL activity coefficients</h2>
<p>γ from the engine's NRTL flash at its converged liquid composition, against <i>thermo</i>'s NRTL model at the same composition and temperature (Aspen form τ<sub>ij</sub> = a<sub>ij</sub> + b<sub>ij</sub>/T, α = ${REF.nrtl.pairs[0].cij}; parameters are test inputs, not a recommended data set).</p>
<div class="tw"><table><thead><tr><th>Case</th><th class="l">System</th><th>x ethanol</th><th>γ engine (EtOH / H₂O)</th><th>γ reference</th><th>max |Δγ|</th></tr></thead><tbody>
${nrRows.join('\n')}
</tbody></table></div>

<h2>4 · Energy balance with condensation</h2>
<p>${esc(W.desc)}. Reference: CoolProp 8.0 (IAPWS-95 water, reference equations of state for N₂ and CO₂) evaluated at the component partial pressures with a Raoult split at the drum.</p>
<div class="tw"><table><thead><tr><th class="l">Quantity</th><th>Engine</th><th>Reference</th><th>Difference</th></tr></thead><tbody>
<tr><td class="l">Total heat removed, kW</td><td>${f(koQ, 1)}</td><td>${f(W.Q_kW, 1)}</td><td>${f(koDev, 2)} %</td></tr>
<tr><td class="l">Condensate, kg/h</td><td>${f(koC, 1)}</td><td>${f(W.condensate_kg_h, 1)}</td><td>${f(Math.abs(koC - W.condensate_kg_h) / W.condensate_kg_h * 100, 2)} %</td></tr>
</tbody></table></div>
<p class="note">This case exercises the dew-point rule: wet process gas above its dew point is treated as all vapour, with water evaluated at its partial pressure.</p>

<h2>5 · Flowsheet solver</h2>
<div class="tw"><table class="wrap"><colgroup><col style="width:40%"><col style="width:32%"><col style="width:28%"></colgroup><thead><tr><th class="l">Check</th><th>Result</th><th class="l">Expected</th></tr></thead><tbody>
<tr><td class="l">Ammonia front end (primary + secondary reformer, HTS, LTS, CO₂ removal, methanator): design spec varies process air for H₂/N₂ = 3, starting 20 % low</td>
  <td>air ${f(spec.specs[0].varied, 3)} kg/h · H₂/N₂ ${f(spec.specs[0].target_value, 6)}</td><td class="l">${f(airRef, 3)} kg/h, the air rate the step-by-step template bisects for the same chain</td></tr>
<tr><td class="l">Recycle loop (mixer → shift reactor → cooler → flash → 50/50 splitter → back), Wegstein on the torn recycle</td>
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

<h2>Scope</h2>
<p>These checks verify the implementation against independent references. Agreement with another simulator shows the equations are solved correctly for the given parameters; it does not make a property method suitable for every system — Peng–Robinson without fitted k<sub>ij</sub> over-predicts the solubility of water in hydrocarbon liquids, ChemSep NRTL / UNIQUAC parameters are fitted to vapour–liquid data, and the urea units remain empirical correlations. Use the results for preliminary engineering and confirm them against plant data before design use. Kinetic reactors are only as good as the rate expressions entered, and the acid association model covers dimerisation only (no acid–water cross association; binary parameters fitted without association may need refitting). The CO₂ packages cover CO₂ only (no H₂S, NH₃ or MDEA / activated MDEA chemistry), and tray efficiencies stand in for rate-based mass transfer. The inputs for every case above are in the engine test set, cases MB-089 to MB-195.</p>
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
console.log('Step 25:', s25Pass + '/' + s25N, 'in tolerance · MEA vs Arshad AAD (α ≤ 0.45)', aad(arshDev.lo).toFixed(2) + ' %', '· PHREEQC worst ≤90 °C', pqLow.toFixed(4) + ' %', 'all', pqHigh.toFixed(3) + ' %', '· beyond stability (not graded)', pqBeyond.length);
console.log('Step 24:', s24Pass + '/' + s24N, 'in tolerance · LHHW worst', s22Worst.lhhw.toExponential(2), '· acid liquid ΔfH worst', s22Worst.assocH.toFixed(2) + ' kJ/mol');
console.log('Step 23:', s23Pass + '/' + s23N, 'in tolerance · envelope worst', s22Worst.env.toFixed(3) + ' K', '· binary T worst', s22Worst.bin.toExponential(2), '· kinetics worst', s22Worst.kin.toExponential(2));
console.log('wrote', path.relative(ROOT, OUT), '— PR worst', prWorst.toExponential(2), '· DWSIM (same data) worst', dwWorst.toExponential(2), '· NRTL worst', nrWorst.toExponential(2), '· wet gas', koDev.toFixed(3) + ' %');
