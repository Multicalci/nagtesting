// ============================================================================
// REPO PATH: api/_lib/sim-sizing.js
// ============================================================================
// multicalci.com — flowsheet simulator → calculator hand-off ("Size equipment"),
// moved from the page to the server (front-end protection, Nov 2026).
//
// POST ?module=size-equipment  {streams, params:{kind, …}}
//   kind 'line' | 'orifice' | 'psv'  one stream (streams[0]) → a sizing sheet
//   kind 'drum'                      flash / three-phase separator outlets → a sheet
//   kind 'valve' | 'r-hx' | 'heater' block results → calculator buttons + a note
// A sheet is {fields:[{id, label, value, hint, aria, type?, options?}], rows:[[k, v]],
//             link:{href, label}|null, notes:[…], message:string|null, error?:string, pending?:true}.
// Relief valve: params.fields_only returns the boxes and a "calculating" line at once (pending);
// an engine error at the relieving conditions comes back as sheet.error with the boxes kept.
// The properties come from the engine's stream-properties module with the
// flowsheet's method — exactly what the page used to request itself; every rule,
// number and sentence is unchanged from the page version (flowsheet-simulator 0.38).
// (c) multicalci.com — all rights reserved
// ============================================================================

'use strict';

export const SIZING_VERSION = 'sim-sizing 1.0.0';

function num(x) { return typeof x === 'number' && isFinite(x); }
/** readout format — up to `sig` significant figures, thousands separators (same as the page) */
function fmt(x, sig) {
  if (!num(x)) return '—';
  const s = sig || 5;
  if (x === 0 || Math.abs(x) < 1e-12) return '0';
  const a = Math.abs(x);
  if (a >= 1e9 || a < 1e-4) return x.toExponential(Math.max(1, s - 2));
  const d = Math.max(0, s - 1 - Math.floor(Math.log10(a)));
  return x.toLocaleString('en-US', { maximumFractionDigits: Math.min(d, 7) });
}
const b64json = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');

/* ---------- heat-exchanger fluid of a stream (HeatXpert's property set) ---------- */
const HX_FLUID = { H2O: (vf) => (vf > 0.5 ? 'steam' : 'water'), N2: 'nitrogen', O2: 'oxygen', H2: 'hydrogen', CH4: 'methane', CO2: 'co2',
  NH3: (vf) => (vf > 0.5 ? 'ammonia-gas' : 'ammonia-liquid'), benzene: 'benzene', toluene: 'toluene', 'o-xylene': 'xylene', 'm-xylene': 'xylene', 'p-xylene': 'xylene',
  methanol: 'methanol', ethanol: 'ethanol', acetone: 'acetone', 'acetic-acid': 'acetic-acid' };
function hxFluidOf(r) {
  const comps = (r.components || []).filter((c) => c.mass_fraction > 0).sort((a, c) => c.mass_fraction - a.mass_fraction);
  const vf = num(r.vapour_fraction) ? r.vapour_fraction : 1;
  const w = Object.fromEntries(comps.map((c) => [c.key, c.mass_fraction]));
  if ((w.N2 || 0) > 0.7 && (w.O2 || 0) > 0.18) return { fluid: 'air', exact: true };
  const top = comps[0];
  if (!top) return { fluid: vf > 0.5 ? 'nitrogen' : 'water', exact: false };
  const m = HX_FLUID[top.key];
  if (m && top.mass_fraction > 0.9) return { fluid: typeof m === 'function' ? m(vf) : m, exact: true };
  const hc = comps.filter((c) => /^(CH4|C2H6|C3H8|[in]C4H10|n-|i-)/.test(c.key)).reduce((a, c) => a + c.mass_fraction, 0);
  if (vf > 0.5 && hc > 0.6) return { fluid: 'natural-gas', exact: false, top: top.key };
  if (m) return { fluid: typeof m === 'function' ? m(vf) : m, exact: false, top: top.key };
  return { fluid: vf > 0.5 ? (hc > 0.5 ? 'natural-gas' : 'nitrogen') : (hc > 0.5 ? 'crude-oil-light' : 'water'), exact: false, top: top.key };
}

/* ---------- calculator pages ---------- */
const SIZE_TOOLS = {
  line: { title: 'Line size & pressure drop', path: '/pressure-drop-calculator', open: 'Open the pressure-drop calculator ↗' },
  psv: { title: 'Relief valve', path: '/pressure-relief-valve-sizing', open: 'Open the relief-valve sizing ↗' },
  orifice: { title: 'Flow orifice', path: '/orifice-flow-calculator', open: 'Open the orifice calculator ↗' },
  drum: { title: 'Separator drum', path: '/vessel-separator-sizing', open: 'Open the separator sizing ↗' },
};
/* ASME B36.10M inside diameters, mm: Schedule 40 up to 24", standard wall for 30" and 36" */
const NPS40 = [['1/2', 15.80], ['3/4', 20.93], ['1', 26.64], ['1-1/2', 40.90], ['2', 52.51], ['3', 77.92], ['4', 102.26], ['6', 154.06], ['8', 202.72],
  ['10', 254.51], ['12', 303.23], ['14', 333.34], ['16', 381.0], ['18', 428.66], ['20', 477.82], ['24', 574.64], ['30', 742.95], ['36', 895.35]];
const pipeVel = (Q_m3_h, id_mm) => Q_m3_h / 3600 / (Math.PI / 4 * (id_mm / 1000) ** 2);
/** smallest listed pipe with a velocity at or below vMax, m/s (the largest if none) */
function pipeFor(Q_m3_h, vMax) {
  for (const [nps, id] of NPS40) if (pipeVel(Q_m3_h, id) <= vMax) return { nps, id };
  const [nps, id] = NPS40[NPS40.length - 1];
  return { nps, id };
}
const npsOf = (id) => { const p = NPS40.find((q) => Math.abs(q[1] - id) < 0.01); return p ? p[0] : null; };
const sizeUrl = (kind, data) => {
  const o = { v: 1, src: 'flowsheet' };
  for (const k in data) o[k] = typeof data[k] === 'number' ? Number(data[k].toPrecision(7)) : data[k];
  return SIZE_TOOLS[kind].path + '#mb=' + b64json(o);
};
const sizeLink = (kind, data) => ({ href: sizeUrl(kind, data), label: SIZE_TOOLS[kind].open });
/** the stream is pure water (Steam / water method, or water alone) */
function isWaterOnly(st, pkgModel) { return pkgModel === 'steam' || (st.components.length === 1 && st.components[0].key === 'H2O'); }

/** phase state of a stream-properties result: 'gas' | 'liquid' | 'two-phase' and the values a sizing tool takes.
 *  trim: a trace of the other phase (under 1 % of the mass) is set aside and the main phase's properties used */
function sizingState(D, trim) {
  const o = D.overall || {}, ph = D.phases || [];
  let vap = ph.filter((q) => q.type === 'vapour'), liq = ph.filter((q) => q.type !== 'vapour');
  const beta = num(o.vapour_fraction) ? o.vapour_fraction : vap.length ? 1 : 0;
  const vmf = num(o.vapour_mass_fraction) ? o.vapour_mass_fraction : vap.reduce((t, q) => t + (q.mass_fraction || 0), 0);
  let trace = null;
  if (vap.length && liq.length && trim && vmf >= 0.99) { trace = { phase: 'liquid', mass: 1 - vmf }; liq = []; }
  else if (vap.length && liq.length && trim && vmf <= 0.01) { trace = { phase: 'vapour', mass: vmf }; vap = []; }
  if (vap.length && liq.length) return { kind: 'two-phase', beta, vmf, o };
  const set = vap.length ? vap : liq;
  const main = set.slice().sort((a, b) => b.flow_m3_h - a.flow_m3_h)[0] || {};
  return { kind: vap.length ? 'gas' : 'liquid', beta, vmf, o, main, trace, twoLiquids: liq.length > 1 && !vap.length,
    rho: trace ? main.rho_kgm3 : o.rho_kgm3,
    Q: trace ? set.reduce((t, q) => t + q.flow_m3_h, 0) : o.flow_m3_h,
    mu: !trace && num(o.mu_cP) ? o.mu_cP : main.mu_cP, MW: trace ? main.MW : o.MW, Z: !trace && num(o.Z) ? o.Z : main.Z,
    kIG: !trace && num(o.Cp_Cv_ideal_gas) ? o.Cp_Cv_ideal_gas : main.Cp_Cv_ideal_gas };
}
/** a usual transmitter range, mmH₂O, that keeps β = d/D at 0.65 or less for this flow (C ≈ 0.605, ε ≈ 1) */
function orificeDp(W_kg_h, rho, D_mm) {
  const b = 0.65, A = Math.PI / 4 * (b * D_mm / 1000) ** 2, C = 0.605 / Math.sqrt(1 - b ** 4);
  const need = (W_kg_h / 3600 / (C * A)) ** 2 / (2 * rho) / 9.80665;
  return [500, 1000, 1250, 2000, 2500, 5000, 10000, 20000].find((v) => v >= need) || 20000;
}
/** bubble pressure at the stream temperature (the vapour pressure of a liquid mixture), bar a */
function D_bubble(z) { return z && z.sat && num(z.sat.bubble_P_bar) ? z.sat.bubble_P_bar : null; }
/** an edited value when the page sent one (null = an empty or invalid box), else the default */
const pick = (edits, k, dflt) => (edits && Object.prototype.hasOwnProperty.call(edits, k) ? (num(edits[k]) ? edits[k] : null) : dflt);
const sheet = (o) => Object.assign({ fields: [], rows: [], link: null, notes: [], message: null }, o);
const keepRows = (rows) => rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '');

/* ---------- line ---------- */
function lineSheet(name, st, z, warnings, edits) {
  if (z.kind === 'two-phase') {
    return sheet({ message: 'Two-phase flow (vapour fraction ' + fmt(z.beta, 3) + ') — the pressure-drop calculator is for one phase. Put a Pipe segment unit in the flowsheet instead: it integrates the two-phase pressure drop and the flashing along the line.' });
  }
  const gas = z.kind === 'gas';
  const vMax = gas ? Math.min(20, Math.sqrt(15000 / z.rho)) : 2;     // gas: 20 m/s and ρv² ≤ 15 000 Pa
  const p0 = pipeFor(z.Q, vMax);
  const fields = [
    { id: 'D', label: 'Pipe inside diameter, mm', value: p0.id, hint: 'starting size: ' + p0.nps + '" Sch 40', aria: 'Pipe inside diameter' },
    { id: 'L', label: 'Line length, m', value: 100, hint: null, aria: 'Line length' },
  ];
  const E = { D: pick(edits, 'D', p0.id), L: pick(edits, 'L', 100) };
  if (!(E.D > 0) || !(E.L > 0)) return sheet({ fields, message: 'Enter a pipe inside diameter and length.' });
  const nps = npsOf(E.D), v = pipeVel(z.Q, E.D);
  const pv = !gas ? D_bubble(z) : null;
  const data = { name, phase: z.kind, T_C: st.T_K - 273.15, P_bar: st.P_bar, flow_m3_h: z.Q, rho_kgm3: z.rho, mu_cP: z.mu, D_mm: E.D, L_m: E.L };
  if (num(pv)) data.pv_bar = pv;
  const rows = keepRows([
    ['Flow at line conditions', fmt(z.Q, 5) + ' m³/h (' + fmt(st.mass_flow_kg_h, 5) + ' kg/h)'],
    ['Density', fmt(z.rho, 5) + ' kg/m³'], ['Viscosity', fmt(z.mu, 4) + ' cP'],
    ['Temperature / pressure', fmt(st.T_K - 273.15, 5) + ' °C · ' + fmt(st.P_bar, 5) + ' bar a'],
    ['Vapour pressure (bubble)', num(pv) ? fmt(pv, 4) + ' bar a' : null],
    ['Velocity in this pipe', fmt(v, 3) + ' m/s' + (nps ? ' — ' + nps + '" Sch ' + (/^(30|36)$/.test(nps) ? 'STD' : '40') : '')],
    ['ρv²', fmt(z.rho * v * v, 3) + ' Pa'],
  ]);
  const notes = ['The starting pipe is the smallest Schedule 40 size with ' + (gas ? 'a velocity of 20 m/s or less and ρv² of 15,000 Pa or less (gas rule of thumb)' : 'a velocity of 2 m/s or less (liquid rule of thumb)') + '; the length is a placeholder — enter your line and its fittings in the calculator.'];
  if (gas) notes.push('The calculator treats the flow as incompressible, which holds while the pressure drop stays below about 10 % of the inlet pressure; for longer gas lines use a Pipe segment unit in the flowsheet.');
  if (z.twoLiquids) notes.push('Two liquid phases: the density is the mixture’s and the viscosity that of the larger liquid phase.');
  for (const w of warnings.slice(0, 3)) notes.push(String(w));
  return sheet({ fields, rows, link: sizeLink('line', data), notes });
}

/* ---------- flow orifice ---------- */
function orificeSheet(name, st, z, warnings, edits, pkgModel) {
  if (z.kind === 'two-phase') {
    return sheet({ message: 'Two-phase flow (vapour fraction ' + fmt(z.beta, 3) + ') — meter a single-phase stream, or use the two-phase correlations on the orifice page with your own quality.' });
  }
  const steam = z.kind === 'gas' && isWaterOnly(st, pkgModel);
  const cat = steam ? 'steam' : z.kind;
  if (cat === 'gas' && !num(z.kIG)) return sheet({ message: 'No ideal-gas Cp/Cv for this method — use Stream properties and enter k on the orifice page.' });
  // ISO 5167 orifices need D ≥ 50 mm: at least 2"
  let p0 = pipeFor(z.Q, z.kind === 'gas' ? Math.min(20, Math.sqrt(15000 / z.rho)) : 2);
  if (p0.id < 50) p0 = { nps: '2', id: 52.51 };
  const dp0 = orificeDp(st.mass_flow_kg_h, z.rho, p0.id);
  const fields = [
    { id: 'W', label: 'Flow at full-scale ΔP, kg/h', value: st.mass_flow_kg_h, hint: 'normal flow: ' + fmt(st.mass_flow_kg_h, 5) + ' kg/h', aria: 'Meter flow' },
    { id: 'dp', label: 'Differential pressure, mmH₂O', value: dp0, hint: 'a usual range giving β ≤ 0.65', aria: 'Differential pressure' },
    { id: 'D', label: 'Pipe inside diameter, mm', value: p0.id, hint: 'starting size: ' + p0.nps + '" Sch 40 (ISO 5167: 50 mm or more)', aria: 'Pipe inside diameter' },
  ];
  const E = { D: pick(edits, 'D', p0.id), dp: pick(edits, 'dp', dp0), W: pick(edits, 'W', st.mass_flow_kg_h) };
  if (!(E.D > 0) || !(E.dp > 0) || !(E.W > 0)) return sheet({ fields, message: 'Enter the pipe diameter, the differential pressure and the flow.' });
  const data = { name, cat, P_bar: st.P_bar, T_C: st.T_K - 273.15, W_kg_h: E.W, D_mm: E.D, dp_mmH2O: E.dp };
  const nps = npsOf(E.D); if (nps && nps !== '30' && nps !== '36') data.nps = nps;
  if (cat === 'gas') Object.assign(data, { MW: z.MW, Z: z.Z, k: z.kIG, mu_Pas: z.mu / 1000 });
  if (cat === 'liquid') Object.assign(data, { SG: z.rho / 1000, mu_Pas: z.mu / 1000 });
  const rows = keepRows([
    ['Flow', fmt(E.W, 5) + ' kg/h · ' + fmt(E.W / z.rho, 5) + ' m³/h at flow conditions'],
    ['Pressure / temperature', fmt(st.P_bar, 5) + ' bar a · ' + fmt(st.T_K - 273.15, 5) + ' °C'],
    ['Density', fmt(z.rho, 5) + ' kg/m³'],
    cat === 'gas' ? ['Molar mass · Z · ideal-gas k', fmt(z.MW, 5) + ' · ' + fmt(z.Z, 4) + ' · ' + fmt(z.kIG, 4)] : cat === 'liquid' ? ['Specific gravity (ρ / 1000)', fmt(z.rho / 1000, 5)] : ['Steam', 'IAPWS-IF97 on the orifice page'],
    cat !== 'steam' ? ['Viscosity', fmt(z.mu, 4) + ' cP'] : null,
  ]);
  const notes = ['Opens on bore sizing (sharp-edged orifice, flange taps by default) for this flow at the chosen differential pressure. Meters are usually sized for a full-scale flow of 1.2–1.3 times the normal flow — enter that flow here or on the page.'];
  for (const w of warnings.slice(0, 3)) notes.push(String(w));
  return sheet({ fields, rows, link: sizeLink('orifice', data), notes });
}

/* ---------- relief valve: properties at the relieving pressure (set pressure + 10 % or 0.207 bar, whichever is larger) ---------- */
async function psvSheet(name, st, edits, pkgModel, props, fieldsOnly) {
  const Pg0 = st.P_bar - 1.01325;
  const d0 = { set: Pg0 > 0.1 ? Number(Pg0.toFixed(2)) : 0.1, W: Number(st.mass_flow_kg_h.toPrecision(6)) };
  const fields = [
    { id: 'set', label: 'Set pressure, bar g', value: d0.set, hint: 'stream: ' + fmt(st.P_bar - 1.01325, 5) + ' bar g', aria: 'Set pressure' },
    { id: 'W', label: 'Relief load, kg/h', value: d0.W, hint: 'stream: ' + fmt(st.mass_flow_kg_h, 5) + ' kg/h', aria: 'Relief load' },
  ];
  const E = { set: pick(edits, 'set', d0.set), W: pick(edits, 'W', d0.W) };
  if (!(E.set > 0) || !(E.W > 0)) return sheet({ fields, message: 'Enter a set pressure and a relief load.' });
  const p1 = E.set + Math.max(0.1 * E.set, 0.207) + 1.01325;
  // the boxes straight away (the relieving properties can take a while with the heavier methods)
  if (fieldsOnly) return sheet({ fields, message: 'Calculating the relieving properties at ' + fmt(p1, 4) + ' bar a…', pending: true });
  const r = await props(st, { P_bar: p1, T_K: st.T_K });
  if (r.error) return sheet({ fields, error: errText(r.error) });   // the boxes stay, so another set pressure can be tried
  const { D, warnings } = r;
  const z = sizingState(D, true);
  z.sat = D.saturation || {};
  const T_C = st.T_K - 273.15;
  let data = null, rows = [];
  const notes = ['Properties at the relieving pressure P₁ = ' + fmt(p1, 4) + ' bar a (set pressure + 10 % overpressure, at least 0.207 bar) and the stream temperature; for a fire case or another relieving temperature use Stream properties at those conditions.',
    'The set pressure and relief load come from the stream — replace them with the design set pressure and the load of the governing relief case.'];
  if (z.kind === 'two-phase') {
    return sheet({ fields, message: 'Two-phase at the relieving conditions (vapour fraction ' + fmt(z.beta, 3) + ', ' + fmt(100 * z.vmf, 3) + ' % of the mass) — size with the Ω method on the two-phase tab of the relief-valve page; the flowsheet does not fill it in.' });
  }
  if (z.trace) notes.push(fmt(100 * z.trace.mass, 2) + ' % of the mass ' + (z.trace.phase === 'liquid' ? 'condenses' : 'flashes') + ' at P₁ and the stream temperature; the ' + (z.trace.phase === 'liquid' ? 'vapour' : 'liquid') + '’s properties are used for the whole load.');
  if (z.kind === 'gas' && isWaterOnly(st, pkgModel)) {
    const Ts = num(z.sat.dew_T_K) ? z.sat.dew_T_K : num(z.sat.bubble_T_K) ? z.sat.bubble_T_K : null;
    const sup = !num(Ts) || st.T_K > Ts + 0.5;
    data = { name, kind: 'steam', setP_barg: E.set, W_kg_h: E.W, T_C, superheated: sup };
    rows = [['Fluid', sup ? 'superheated steam' : 'saturated steam'], ['Saturation temperature at P₁', num(Ts) ? fmt(Ts - 273.15, 5) + ' °C' : null], ['Steam temperature', fmt(T_C, 5) + ' °C']];
  } else if (z.kind === 'gas') {
    if (!num(z.kIG) || !num(z.Z)) return sheet({ fields, message: 'This method gives no ideal-gas Cp/Cv or Z — enter M, k and Z on the relief-valve page from Stream properties.' });
    data = { name, kind: 'gas', setP_barg: E.set, W_kg_h: E.W, T_C, M: z.MW, k: z.kIG, Z: z.Z, P1_bar: p1 };
    rows = [['Molar mass M', fmt(z.MW, 5)], ['k = Cp/Cv (ideal gas)', fmt(z.kIG, 4) + (num(z.o.Cp_Cv) ? ' · real gas ' + fmt(z.o.Cp_Cv, 4) : '')], ['Compressibility Z at P₁', fmt(z.Z, 4)], ['Relieving temperature', fmt(T_C, 5) + ' °C']];
    notes.push('API 520 takes k for the ideal gas at the relieving temperature and the real-gas effects through Z.');
  } else {
    const Q = E.W / z.rho;
    data = { name, kind: 'liquid', setP_barg: E.set, Q_m3_h: Q, G: z.rho / 999.0, mu_cP: z.mu, T_C };
    rows = [['Flow at relieving temperature', fmt(Q, 5) + ' m³/h'], ['Specific gravity G (ρ / 999 kg/m³)', fmt(z.rho / 999.0, 5)], ['Viscosity', fmt(z.mu, 4) + ' cP'],
      ['Bubble pressure at T', num(z.sat.bubble_P_bar) ? fmt(z.sat.bubble_P_bar, 4) + ' bar a' : null]];
    if (num(z.sat.bubble_P_bar) && z.sat.bubble_P_bar > p1 * 0.9) notes.push('The bubble pressure is close to the relieving pressure: the liquid may flash in the valve — check with the two-phase (Ω) method.');
  }
  for (const w of warnings.slice(0, 3)) notes.push(String(w));
  return sheet({ fields, rows: keepRows([['Set pressure / P₁', fmt(E.set, 5) + ' bar g · ' + fmt(p1, 5) + ' bar a'], ['Relief load', fmt(E.W, 5) + ' kg/h'], ...rows]), link: sizeLink('psv', data), notes });
}

/* ---------- separator drum from a flash drum or three-phase separator ----------
   streams: the outlets that carry flow; params.slots: their outlet numbers (0 vapour, 1 liquid / light liquid, 2 heavy liquid);
   params.vo: {P_bar, T_K, mass_flow_kg_h} of outlet 0; params.liq_kg_h: the flow of outlet 1 */
async function drumSheet(name, streams, P, edits, props) {
  const three = !!P.three;
  const slots = Array.isArray(P.slots) ? P.slots : [];
  const zs = [null, null, null];
  for (let i = 0; i < streams.length; i++) {
    const j = slots[i];
    if (!(j >= 0 && j <= 2)) continue;
    const r = await props(streams[i], { saturation: false });
    if (r.error) return r;
    zs[j] = sizingState(r.D);
  }
  const [g, l1, l2] = zs;
  if (!g) return sheet({ message: 'No vapour leaves this unit — it works as a liquid–liquid decanter or a liquid drum; size it from the liquid hold-up.' });
  const vo = P.vo || {};
  const base = { name, P_bar: vo.P_bar, T_C: vo.T_K - 273.15, Qg_m3_h: g.Q, rhog: g.rho };
  if (three) {
    const data = Object.assign({ kind: '3p', Qo_m3_h: l1 ? l1.Q : 0, rhoo: l1 ? l1.rho : null, Qw_m3_h: l2 ? l2.Q : 0, rhow: l2 ? l2.rho : null, mu_cP: l1 ? l1.mu : null }, base);
    return sheet({
      rows: [['Drum', fmt(base.P_bar, 5) + ' bar a · ' + fmt(base.T_C, 5) + ' °C'], ['Gas', fmt(g.Q, 5) + ' m³/h at ' + fmt(g.rho, 5) + ' kg/m³'],
        ['Light liquid', l1 ? fmt(l1.Q, 5) + ' m³/h at ' + fmt(l1.rho, 5) + ' kg/m³ · ' + fmt(l1.mu, 4) + ' cP' : 'none'], ['Heavy liquid', l2 ? fmt(l2.Q, 5) + ' m³/h at ' + fmt(l2.rho, 5) + ' kg/m³' : 'none']],
      link: sizeLink('drum', data),
      notes: ['Opens the three-phase separator with the light liquid as the oil and the heavy liquid as the water; retention times, droplet size and K-factor are the page’s defaults.'],
    });
  }
  const liq = l1;
  const liqKg = num(P.liq_kg_h) ? P.liq_kg_h : 0;
  const vmf = vo.mass_flow_kg_h / ((vo.mass_flow_kg_h + liqKg) || 1);
  const o0 = vmf >= 0.5 ? 'v' : 'h';
  const orient = edits && (edits.orient === 'v' || edits.orient === 'h') ? edits.orient : o0;
  const fields = [{ id: 'orient', type: 'select', label: 'Orientation', value: o0, aria: 'Orientation', options: [['v', 'Vertical'], ['h', 'Horizontal']] }];
  const data = Object.assign({ kind: '2p', orient, Ql_m3_h: liq ? liq.Q : 0, rhol: liq ? liq.rho : null }, base);
  const notes = ['Both the vertical and the horizontal separator are filled; the one chosen opens first. ' + (vmf >= 0.5 ? 'Most of the feed leaves as gas, so a vertical knock-out drum is the usual choice.' : 'Most of the feed leaves as liquid, so a horizontal drum is the usual choice.'),
    'Retention time, surge factor and K-factor are the page’s defaults — set your own.'];
  if (liq && liq.twoLiquids) notes.push('The liquid holds two liquid phases — a three-phase separator unit in the flowsheet gives the separate loads.');
  return sheet({
    fields,
    rows: [['Drum', fmt(base.P_bar, 5) + ' bar a · ' + fmt(base.T_C, 5) + ' °C'], ['Gas', fmt(g.Q, 5) + ' m³/h at ' + fmt(g.rho, 5) + ' kg/m³ (' + fmt(vo.mass_flow_kg_h, 5) + ' kg/h)'],
      ['Liquid', liq ? fmt(liq.Q, 5) + ' m³/h at ' + fmt(liq.rho, 5) + ' kg/m³ (' + fmt(liqKg, 5) + ' kg/h)' : 'none']],
    link: sizeLink('drum', data), notes,
  });
}

/* ---------- unit results → calculator buttons ---------- */
/* saturated steam levels, bar a: T_sat °C and latent heat kJ/kg (IAPWS-IF97) */
const STEAM_LEVELS = [{ P: 4.5, Ts: 147.91, hfg: 2120.2 }, { P: 11, Ts: 184.07, hfg: 1999.5 }, { P: 21, Ts: 214.87, hfg: 1879.4 }, { P: 41, Ts: 251.83, hfg: 1705.8 }];
/* heater / cooler → HeatXpert with a utility on the other side. P: {nIn, ri, ro, Q_kW} */
function heaterHxCase(P) {
  if (P.nIn > 1) return { note: 'Several inlets — HeatXpert takes one process stream; mix them first.' };
  const ri = P.ri, ro = P.ro;
  const Q = P.Q_kW;
  if (!ri || !ro || !num(Q) || Math.abs(Q) < 1e-3 || !(ri.mass_flow_kg_h > 0)) return null;
  const Ti = ri.T_K - 273.15, To = ro.T_K - 273.15, fp = hxFluidOf(ri);
  const vi = ri.vapour_fraction || 0, vo = ro.vapour_fraction || 0;
  const r3 = (x) => +x.toFixed(3), p6 = (x) => +x.toPrecision(6), p5 = (x) => +x.toPrecision(5);
  const fluidNote = 'HeatXpert uses its own property set: process side “' + fp.fluid + '”' + (fp.exact ? '' : ' (nearest to ' + (fp.top || 'the mixture') + ')');
  if (Q < 0) {
    const cw = To >= 40 ? { Ti: 30, To: 40, lab: 'cooling water 30 → 40 °C' } : To >= 17 ? { Ti: 7, To: 12, lab: 'chilled water 7 → 12 °C' } : null;
    if (!cw) return { note: 'The outlet is below 17 °C — that needs a refrigerant, which HeatXpert does not rate.' };
    const cond = vi > 0.5 && vo < 0.01;                 // a (mostly) vapour condensed to liquid
    // HeatXpert condenses a dry saturated vapour: from a wet inlet send the vapour part only (the liquid passes through)
    const pv = ri.rig && ri.rig.props && (ri.rig.props.phases || []).find((q) => q.type === 'vapour');
    const vmf = pv && num(pv.MW) && num(ri.rig.props.MW) ? Math.min(1, pv.fraction * pv.MW / ri.rig.props.MW) : vi;
    const wet = cond && vmf < 0.99;
    const v = { st_shellMode: cond ? 'condensing' : 'single-phase', st_type: '1-2', st_flow: 'counter',
      st_hFl: fp.fluid, st_hTi: r3(Ti), st_hTo: r3(To), st_hF: p6(ri.mass_flow_kg_h * (wet ? vmf : 1)), st_hFunit: 'kgh', st_hPop: p5(ri.P_bar),
      st_cFl: 'water', st_cTi: cw.Ti, st_cTo: cw.To, st_cF: p6(-Q * 3600 / (4.18 * (cw.To - cw.Ti))), st_cFunit: 'kgh', st_cPop: 4 };
    return { url: '/heat-exchanger-design#case=' + b64json({ t: 'shell-tube', u: 'metric', coldMode: 'temp', v }),
      note: 'Opens a shell-and-tube cooler for this duty (' + fmt(-Q, 5) + ' kW) with ' + cw.lab + ' on the tube side; HeatXpert works out the water flow. ' + fluidNote +
        (cond ? '; the process side condenses on the shell' + (wet ? ' — the inlet is ' + fmt(100 * vmf, 3) + ' % vapour by mass, so the condensing flow sent is that part, ' + fmt(ri.mass_flow_kg_h * vmf, 5) + ' kg/h' : '') + '.' : vi !== vo ? '. The process stream changes phase only partly — the case opens as single-phase; check the shell mode.' : '.') };
  }
  const lv = STEAM_LEVELS.find((q) => q.Ts >= To + 10);
  if (!lv) return { note: 'The outlet is above 240 °C — beyond saturated steam up to 41 bar a; a fired heater or hot oil would serve, which HeatXpert does not rate here.' };
  const v = { st_shellMode: 'condensing', st_satLink: 1, st_type: '1-2', st_flow: 'counter', st_hFl: 'steam', st_hTi: lv.Ts, st_hTo: lv.Ts,
    st_hF: p6(Q * 3600 / lv.hfg), st_hFunit: 'kgh', st_hPop: lv.P,
    st_cFl: fp.fluid, st_cTi: r3(Ti), st_cF: p6(ri.mass_flow_kg_h), st_cFunit: 'kgh', st_cPop: p5(ri.P_bar) };
  return { url: '/heat-exchanger-design#case=' + b64json({ t: 'shell-tube', u: 'metric', coldMode: 'flow', v }),
    note: 'Opens a shell-and-tube heater for this duty (' + fmt(Q, 5) + ' kW) with saturated steam as the utility, at ' + lv.P + ' bar a (' + lv.Ts + ' °C, ' + fmt(Q * 3600 / lv.hfg, 5) + ' kg/h) condensing on the shell side, the lowest of 4.5 / 11 / 21 / 41 bar a at least 10 K above the ' +
      fmt(To, 4) + ' °C outlet. ' + fluidNote + (vi !== vo ? '. The process stream changes phase — HeatXpert rates it as single-phase on the tube side; treat the area as indicative.' : '.') };
}
/** {buttons:[{label, href}], note} | {none:true} */
function toolLinks(kind, P) {
  if (kind === 'valve') {
    const z = P.sizing;
    if (!z) return { none: true };
    if (z.phase === 'two-phase') return { buttons: [], note: 'Inlet is two-phase — IEC 60534 has no two-phase sizing method; size the liquid and vapour parts separately.' };
    const d = { name: P.name, phase: z.phase, flow_kg_h: P.flow_kg_h, P1_bar: z.P_bar, P2_bar: P.P_out_bar, T_C: z.T_K - 273.15,
      sg: z.sg, MW: z.MW, pv_bar: z.pv_bar, visc_cP: z.visc_cP, k: z.k, Z: z.Z, Pc_bar: z.Pc_bar, Tc_K: z.Tc_K, omega: z.omega, superheated: z.superheated };
    return { buttons: [{ label: 'Size this valve ↗', href: '/control-valve-sizing#mb=' + b64json(d) }],
      note: 'Opens the control-valve sizing tool (IEC 60534) with this inlet: ' + (z.phase === 'liquid' ? 'SG ' + fmt(z.sg, 4) + ', vapour pressure ' + (num(z.pv_bar) ? fmt(z.pv_bar, 4) + ' bar' : '—') : 'MW ' + fmt(z.MW, 4) + ', Z ' + fmt(z.Z, 4) + ', k ' + fmt(z.k, 3)) + ', pseudo-critical Pc ' + fmt(z.Pc_bar, 4) + ' bar.' };
  }
  if (kind === 'r-hx') {
    const { hi, ci, ho, co } = P;
    if (!hi || !ci || !ho || !co) return { none: true };
    const fh = hxFluidOf(hi), fc = hxFluidOf(ci);
    const cond = (hi.vapour_fraction || 0) > 0.99 && (ho.vapour_fraction || 0) < 0.01;
    const boil = (ci.vapour_fraction || 0) < 0.01 && (co.vapour_fraction || 0) > 0.99;
    const v = { st_shellMode: cond ? 'condensing' : boil ? 'evaporating' : 'single-phase', st_type: '1-2', st_flow: 'counter',
      st_hFl: fh.fluid, st_hTi: +(hi.T_K - 273.15).toFixed(3), st_hTo: +(ho.T_K - 273.15).toFixed(3), st_hF: +hi.mass_flow_kg_h.toPrecision(6), st_hFunit: 'kgh', st_hPop: +hi.P_bar.toPrecision(5),
      st_cFl: fc.fluid, st_cTi: +(ci.T_K - 273.15).toFixed(3), st_cF: +ci.mass_flow_kg_h.toPrecision(6), st_cFunit: 'kgh', st_cPop: +ci.P_bar.toPrecision(5) };
    const ph = (hi.vapour_fraction || 0) !== (ho.vapour_fraction || 0) || (ci.vapour_fraction || 0) !== (co.vapour_fraction || 0);
    return { buttons: [{ label: 'Rate in HeatXpert ↗', href: '/heat-exchanger-design#case=' + b64json({ t: 'shell-tube', u: 'metric', coldMode: 'flow', v }) }],
      note: 'Opens a shell-and-tube design with these temperatures, flows and pressures (duty ' + fmt(P.duty_kW, 5) + ' kW). HeatXpert uses its own property set: hot side “' + fh.fluid + '”' + (fh.exact ? '' : ' (nearest to ' + (fh.top || 'the mixture') + ')') +
        ', cold side “' + fc.fluid + '”' + (fc.exact ? '' : ' (nearest to ' + (fc.top || 'the mixture') + ')') + (ph && !cond && !boil ? '. A side changes phase only partly — the case opens as single-phase; check the shell mode.' : '.') };
  }
  if (kind === 'heater') {
    const hc = heaterHxCase(P);
    if (!hc) return { none: true };
    return { buttons: hc.url ? [{ label: 'Design in HeatXpert ↗', href: hc.url }] : [], note: hc.note };
  }
  return { none: true };
}

const errObj = (code, message, field) => ({ error: { code, message, field } });
/** an engine error as the page words it */
const errText = (e) => '[' + (e.code || 'MB_ERROR') + '] ' + e.message + (e.field ? ' (field: ' + e.field + ')' : '');

/**
 * POST ?module=size-equipment
 * @param {{streams:object[], params:object}} input  streams already shape-checked by the router
 * @param {(name:string, streams:object[], params:object) => Promise<object>|object} runModule  the router's
 *        validate-and-dispatch for an engine module (the same path a page request takes)
 */
export async function sizeEquipment(input, runModule) {
  const streams = input.streams || [], P = input.params || {};
  const kind = P.kind;
  if (['valve', 'r-hx', 'heater'].includes(kind)) return { links: toolLinks(kind, P), version: SIZING_VERSION };
  const pkgParams = { property_package: P.property_package };
  if (P.pseudo_components) pkgParams.pseudo_components = P.pseudo_components;
  if (P.user_components) pkgParams.user_components = P.user_components;
  const props = async (st, extra) => {
    let r;
    try { r = await runModule('stream-properties', [st], Object.assign({}, pkgParams, { saturation: true }, extra || {})); }
    catch (e) { return errObj('MB_ENGINE_THROW', 'engine exception: ' + (e && e.message)); }
    if (!r || r.error) return r && r.error ? r : errObj('MB_SIZING', 'stream properties failed');
    return { D: r.details || {}, warnings: r.warnings || [] };
  };
  const name = typeof P.name === 'string' ? P.name : '';
  const edits = P.edits && typeof P.edits === 'object' ? P.edits : null;
  let out;
  if (kind === 'drum') out = await drumSheet(name, streams, P, edits, props);
  else if (['line', 'orifice', 'psv'].includes(kind)) {
    const st = streams[0];
    if (!st) return errObj('MB_STREAMS', 'size-equipment needs the stream', 'streams');
    if (kind === 'psv') out = await psvSheet(name, st, edits, P.pkg_model, props, !!P.fields_only);
    else {
      const r = await props(st);
      if (r.error) return r;
      const z = sizingState(r.D);
      z.sat = r.D.saturation || {};
      out = kind === 'line' ? lineSheet(name, st, z, r.warnings, edits) : orificeSheet(name, st, z, r.warnings, edits, P.pkg_model);
    }
  } else return errObj('MB_KIND', "params.kind must be 'line', 'orifice', 'psv', 'drum', 'valve', 'r-hx' or 'heater'", 'params.kind');
  if (out && out.error && typeof out.error === 'object') return out;   // an {error:{code, message}} envelope (a sheet's own error is text)
  return { sheet: out, version: SIZING_VERSION };
}

export default { SIZING_VERSION, sizeEquipment };
