// ============================================================================
// REPO PATH: api/_lib/mb-units.js
// ============================================================================
// multicalci.com — STEP 22 rigorous unit operations on the property-package
// core (api/_lib/mb-thermo.js). Every module takes the engine's usual
// {streams, params} input — mass-based streams {mass_flow_kg_h, T_K, P_bar,
// components:[{key, mass_fraction}]} — plus params.property_package
// ({model:'pr'|'srk'|'ideal'|'nrtl'|'uniquac'|'wilson'|'unifac'|'modunifac'|'amine-mea'|'hot-k2co3',
//   kij?, nrtl?, …}), and returns {streams_out, mass_balance, energy_balance,
// details, converged, warnings}. Outlet streams carry H_kJh, vapour_fraction
// and a `rig` block (package signature, molar H/S, phase compositions and
// phase properties) so the next unit reconstructs the exact state.
//
//   heater        heater / cooler: outlet T, duty or vapour fraction
//   valve         isenthalpic let-down
//   pump          liquid pump: ΔP, efficiency → power, head
//   compressor    isentropic or polytropic, efficiency → power, outlet T
//   expander      turbine / expander: power recovered
//   r-flash       flash drum: T&P, P&duty (adiabatic), P&VF, T&VF
//   r-flash3      three-phase separator / decanter (vapour + two liquids, VLLE)
//   property-info pure-component / binary data the package will use
//   r-mixer       mixer: adiabatic, given duty or given outlet T (lowest inlet P)
//   r-splitter    flow splitter
//   r-component-splitter  split by component with outlet conditions
//   r-hx          two-stream counter-current exchanger with zone analysis
//   gibbs         Gibbs-energy-minimisation reactor (ideal-gas phase; Gordon–McBride / NASA-CEA iteration, Step 23)
//   r-reactor     conversion reactor (reactions in series), rigorous energy
//                 balance: adiabatic / duty, outlet T or isothermal
//   column        rigorous column (api/_lib/mb-column.js)
//
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import thBase from './mb-thermo.js';
// flashes route to the three-phase (VLLE) versions when the package's valid
// phases include a second liquid (pp.threePhase)
const th = Object.assign({}, thBase, {
  flashPT: (pp, z, T, P) => (pp.threePhase ? thBase.flashPT3(pp, z, T, P) : thBase.flashPT(pp, z, T, P)),
  flashPH: (pp, z, P, H, Tg) => (pp.threePhase ? thBase.flashPH3(pp, z, P, H, Tg) : thBase.flashPH(pp, z, P, H, Tg)),
  flashPS: (pp, z, P, S, Tg) => (pp.threePhase ? thBase.flashPS3(pp, z, P, S, Tg) : thBase.flashPS(pp, z, P, S, Tg)),
});
import compdb from './mb-compdb.js';
import bip from './mb-bip.js';

export const UNITS_VERSION = 'mb-units 1.4.0';
const KJH_PER_KW = 3600;
const num = (x) => typeof x === 'number' && isFinite(x);
const R = th.R;

class UnitError extends Error {
  constructor(code, message, field) { super(message); this.code = code; this.field = field || null; }
}
const fail = (code, msg, field) => { throw new UnitError(code, msg, field); };

// ---------------------------------------------------------------------------
// package cache and stream conversion
// ---------------------------------------------------------------------------
const PKG_CACHE = new Map();

/**
 * Property package for a set of keys (cached on spec + sorted keys).
 * @param {object} spec property_package spec
 * @param {string[]} keys
 */
export function pkg(spec, keys) {
  if (!spec || typeof spec !== 'object' || !spec.model) fail('MB_RIG_PACKAGE', 'params.property_package {model} is required for rigorous units', 'property_package');
  const ks = [...new Set(keys)].sort();
  for (const k of ks) if (!compdb.has(k)) fail('MB_RIG_KEY', `component '${k}' is not in the rigorous databank — use the classic modules for it`, 'components');
  const sig = JSON.stringify([spec, ks]);
  let p = PKG_CACHE.get(sig);
  if (!p) {
    p = th.createPackage(spec, ks);
    p.pkgSig = sig;            // (p.sig is the package's ideal-gas entropy function)
    p.index = Object.fromEntries(ks.map((k, i) => [k, i]));
    if (PKG_CACHE.size > 60) PKG_CACHE.delete(PKG_CACHE.keys().next().value);
    PKG_CACHE.set(sig, p);
  }
  return p;
}

const keysOf = (...streams) => [...new Set(streams.flatMap((s) => (s && Array.isArray(s.components) ? s.components.filter((c) => num(c.mass_fraction) && c.mass_fraction > 0).map((c) => c.key) : [])))];

/** Validate an engine stream shape. */
function checkStream(s, label) {
  if (!s || typeof s !== 'object') fail('MB_STREAM', `${label}: stream object required`, 'streams');
  if (!num(s.mass_flow_kg_h) || s.mass_flow_kg_h < 0) fail('MB_MASSFLOW', `${label}: mass_flow_kg_h must be ≥ 0`, 'mass_flow_kg_h');
  if (!num(s.T_K) || s.T_K <= 0) fail('MB_T', `${label}: T_K must be positive`, 'T_K');
  if (!num(s.P_bar) || s.P_bar <= 0) fail('MB_P', `${label}: P_bar must be positive`, 'P_bar');
  if (!Array.isArray(s.components) || !s.components.length) fail('MB_COMPONENTS', `${label}: components required`, 'components');
}

/**
 * Engine stream → rigorous state {F kmol/h, z, T, P Pa, r (flash), h J/mol, s}.
 * A stream that carries a `rig` block from the same package with a two-phase
 * state is reconstructed by a PH flash (exact for saturated / pure streams);
 * a feed with spec 'PVF' is flashed at P and its vapour fraction.
 */
export function stateIn(pp, s, label) {
  checkStream(s, label || 'stream');
  const n = pp.n;
  const mol = new Array(n).fill(0);
  let sw = 0;
  for (const c of s.components) if (num(c.mass_fraction) && c.mass_fraction > 0) sw += c.mass_fraction;
  if (!(sw > 0)) fail('MB_MASSFRAC', `${label}: mass fractions sum to zero`, 'components');
  for (const c of s.components) {
    if (!(num(c.mass_fraction) && c.mass_fraction > 0)) continue;
    const i = pp.index[c.key];
    mol[i] += s.mass_flow_kg_h * (c.mass_fraction / sw) / pp.MW[i];
  }
  const F = mol.reduce((a, b) => a + b, 0);
  const z = F > 0 ? mol.map((v) => v / F) : (() => { const t = s.components.map((c) => pp.index[c.key]); const zz = new Array(n).fill(0); zz[t[0]] = 1; return zz; })();
  const P = s.P_bar * 1e5;
  let r;
  if (s.spec === 'PVF' && num(s.vapour_fraction)) r = th.flashPVF(pp, z, P, Math.min(1, Math.max(0, s.vapour_fraction)), s.T_K);
  else if (s.rig && s.rig.sig === pp.pkgSig && num(s.rig.h_Jmol) && num(s.rig.beta) && ((s.rig.beta > 1e-9 && s.rig.beta < 1 - 1e-9) || num(s.rig.beta2))) r = th.flashPH(pp, z, P, s.rig.h_Jmol, s.T_K);
  else r = th.flashPT(pp, z, s.T_K, P);
  const h = th.hOf(pp, r);
  return { F, z, T: r.T, P, r, h, H_kJh: F * h, mass: s.mass_flow_kg_h };
}

function compObj(pp, v) { const o = {}; pp.keys.forEach((k, i) => { if (v[i] > 1e-15) o[k] = v[i]; }); return o; }

/**
 * Rigorous state → engine stream with H_kJh, vapour_fraction and rig block.
 * @param {object} pp package
 * @param {number} F kmol/h
 * @param {number[]} z mole fractions
 * @param {object} r flash result
 * @param {{props?:boolean}} [opt]
 */
export function streamOut(pp, F, z, r, opt) {
  const m = z.map((v, i) => v * F * pp.MW[i]);
  const mass = m.reduce((a, b) => a + b, 0);
  const comps = [];
  pp.keys.forEach((k, i) => { if (z[i] > 0 || mass === 0) comps.push({ key: k, mass_fraction: mass > 0 ? m[i] / mass : z[i] }); });
  const h = th.hOf(pp, r), s = th.sOf(pp, r);
  const beta = r.phase === 'V' ? 1 : r.phase === 'L' ? 0 : r.beta;
  const out = {
    mass_flow_kg_h: mass, T_K: r.T, P_bar: r.P / 1e5, components: comps,
    H_kJh: F * h, n_kmol_h: F, vapour_fraction: beta,
    rig: { sig: pp.pkgSig, model: pp.model, h_Jmol: h, s_JmolK: s, beta, phase: r.phase,
      x: r.phase !== 'V' ? compObj(pp, r.x) : null, y: r.phase !== 'L' && r.phase !== 'LL' ? compObj(pp, r.y) : null,
      x2: r.x2 && r.beta2 > 0 ? compObj(pp, r.x2) : undefined, beta2: r.x2 && r.beta2 > 0 ? r.beta2 : undefined },
  };
  if (!opt || opt.props !== false) {
    try {
      const pr = th.properties(pp, r);
      out.rig.props = { MW: pr.MW, rho_kgm3: pr.rho_kgm3,
        phases: pr.phases.map((p) => ({ type: p.type, fraction: p.fraction, MW: p.MW, rho_kgm3: p.rho_kgm3, Z: p.Z,
          Cp_kJkgK: p.Cp_JmolK / p.MW, mu_cP: p.mu_Pas * 1000, k_WmK: p.k_WmK, acid_gas: p.acid_gas || undefined })) };
    } catch (_e) { /* properties are informative only */ }
  }
  return out;
}

const zeroStream = (pp, z, T, P) => streamOut(pp, 0, z, th.flashPT(pp, z.map((v) => v), T, P), { props: false });

function pOut(p, Pin_bar, label) {
  if (num(p.P_out_bar)) { if (p.P_out_bar <= 0) fail('MB_P', `${label}: P_out_bar must be positive`, 'P_out_bar'); return p.P_out_bar * 1e5; }
  if (num(p.dp_bar)) { const v = Pin_bar - p.dp_bar; if (v <= 0) fail('MB_P', `${label}: pressure drop exceeds inlet pressure`, 'dp_bar'); return v * 1e5; }
  return Pin_bar * 1e5;
}

function input(inp, minN, maxN, label) {
  if (!inp || typeof inp !== 'object' || !Array.isArray(inp.streams)) fail('MB_INPUT', `${label}: {streams, params} required`, 'input');
  if (inp.streams.length < minN) fail('MB_STREAMS', `${label}: needs at least ${minN} inlet stream(s)`, 'streams');
  if (inp.streams.length > maxN) fail('MB_STREAMS', `${label}: accepts at most ${maxN} inlet stream(s)`, 'streams');
  const p = inp.params || {};
  if (typeof p !== 'object' || Array.isArray(p)) fail('MB_PARAMS', `${label}: params must be an object`, 'params');
  return { streams: inp.streams, params: p };
}

function result(streams_out, mIn, Hin_kJh, Hout_kJh, W_kW, details, warnings, extra) {
  const mOut = streams_out.reduce((a, s) => a + s.mass_flow_kg_h, 0);
  return Object.assign({
    streams_out,
    mass_balance: { in: mIn, out: mOut, closure_pct: mIn > 0 ? 100 * (mOut - mIn) / mIn : 0 },
    energy_balance: { Hin: Hin_kJh, Hout: Hout_kJh, Q_kW: (Hout_kJh - Hin_kJh) / KJH_PER_KW - W_kW, W_kW },
    details,
    converged: true,
    warnings: [...new Set(warnings)],
  }, extra || {});
}

function ppDetails(pp) {
  return { model: pp.model, label: pp.label, phases: pp.threePhase ? 'VLL' : 'VL', kij: Object.keys(pp.kijUsed).length ? pp.kijUsed : undefined,
    henry: pp.henryKeys && pp.henryKeys.length ? pp.henryKeys : undefined };
}

/** Mix rigorous inlet states into one composition / flow / enthalpy flow. */
function combine(pp, states) {
  const n = pp.n, mol = new Array(n).fill(0);
  let H = 0, mass = 0;
  for (const st of states) { for (let i = 0; i < n; i++) mol[i] += st.F * st.z[i]; H += st.H_kJh; mass += st.mass; }
  const F = mol.reduce((a, b) => a + b, 0);
  return { F, z: F > 0 ? mol.map((v) => v / F) : states[0].z.slice(), H_kJh: H, mass };
}

/** Flash for a duty-type outlet spec: returns flash result at P with molar enthalpy h. */
function phFlash(pp, z, P, h, Tg) { return th.flashPH(pp, z, P, h, Tg); }

// ---------------------------------------------------------------------------
// heater / cooler
// ---------------------------------------------------------------------------
function solveHeater(inp) {
  const { streams, params: p } = input(inp, 1, 1, 'heater');
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], 'heater inlet');
  const P2 = pOut(p, streams[0].P_bar, 'heater');
  const w = pp.warnings.slice();
  let r;
  const nspec = ['T_out_K', 'duty_kW', 'vapour_fraction'].filter((k) => num(p[k])).length;
  if (nspec !== 1) fail('MB_HEATER_SPEC', 'heater: give exactly one of T_out_K, duty_kW, vapour_fraction', 'params');
  if (num(p.T_out_K)) r = th.flashPT(pp, a.z, p.T_out_K, P2);
  else if (num(p.duty_kW)) r = a.F > 0 ? phFlash(pp, a.z, P2, a.h + p.duty_kW * KJH_PER_KW / a.F, a.T) : th.flashPT(pp, a.z, a.T, P2);
  else r = th.flashPVF(pp, a.z, P2, Math.min(1, Math.max(0, p.vapour_fraction)), a.T);
  const out = streamOut(pp, a.F, a.z, r);
  const Q = (out.H_kJh - a.H_kJh) / KJH_PER_KW;
  return result([out], a.mass, a.H_kJh, out.H_kJh, 0,
    { pp: ppDetails(pp), duty_kW: Q, T_in_K: a.T, T_out_K: r.T, P_out_bar: P2 / 1e5, vapour_fraction_in: a.r.phase === 'V' ? 1 : a.r.phase === 'L' ? 0 : a.r.beta, vapour_fraction_out: out.vapour_fraction }, w);
}

// ---------------------------------------------------------------------------
// valve (isenthalpic)
// ---------------------------------------------------------------------------
function solveValve(inp) {
  const { streams, params: p } = input(inp, 1, 1, 'valve');
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], 'valve inlet');
  const P2 = pOut(p, streams[0].P_bar, 'valve');
  if (P2 > a.P * (1 + 1e-12)) fail('MB_VALVE_P', 'valve: outlet pressure above inlet pressure', 'P_out_bar');
  const r = a.F > 0 ? phFlash(pp, a.z, P2, a.h, a.T) : th.flashPT(pp, a.z, a.T, P2);
  const out = streamOut(pp, a.F, a.z, r);
  return result([out], a.mass, a.H_kJh, out.H_kJh, 0,
    { pp: ppDetails(pp), T_out_K: r.T, dT_K: r.T - a.T, P_out_bar: P2 / 1e5, vapour_fraction_out: out.vapour_fraction }, pp.warnings.slice());
}

// ---------------------------------------------------------------------------
// pump
// ---------------------------------------------------------------------------
function solvePumpR(inp) {
  const { streams, params: p } = input(inp, 1, 1, 'pump');
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], 'pump inlet');
  const w = pp.warnings.slice();
  const P2 = pOut(p, streams[0].P_bar, 'pump');
  const eta = num(p.efficiency) ? p.efficiency : 0.75;
  if (!(eta > 0 && eta <= 1)) fail('MB_ETA', 'pump: efficiency must be in (0, 1]', 'efficiency');
  if (a.r.phase !== 'L') w.push(`pump: inlet is not all liquid (vapour fraction ${(a.r.phase === 'V' ? 1 : a.r.beta).toFixed(4)}) — cavitation risk; power uses the mixture volume`);
  const props = th.properties(pp, a.r);
  const Vm = props.MW / 1000 / props.rho_kgm3;                     // m3/mol
  const dP = P2 - a.P;
  const wHyd = Vm * dP;                                              // J/mol
  const wSh = wHyd / eta;
  const r = a.F > 0 ? phFlash(pp, a.z, P2, a.h + wSh, a.T) : th.flashPT(pp, a.z, a.T, P2);
  const out = streamOut(pp, a.F, a.z, r);
  const W = a.F * wSh / KJH_PER_KW;                                  // kW
  const Qv = a.mass / props.rho_kgm3;                                // m3/h
  return result([out], a.mass, a.H_kJh, out.H_kJh, W,
    { pp: ppDetails(pp), power_kW: W, hydraulic_kW: a.F * wHyd / KJH_PER_KW, efficiency: eta, head_m: dP / (props.rho_kgm3 * 9.80665),
      flow_m3_h: Qv, rho_kgm3: props.rho_kgm3, dP_bar: dP / 1e5, T_out_K: r.T }, w);
}

// ---------------------------------------------------------------------------
// compressor / expander
// ---------------------------------------------------------------------------
function machine(inp, kind) {
  const label = kind;
  const { streams, params: p } = input(inp, 1, 1, label);
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], `${label} inlet`);
  const w = pp.warnings.slice();
  let P2;
  if (num(p.pressure_ratio)) P2 = a.P * (kind === 'compressor' ? p.pressure_ratio : 1 / p.pressure_ratio);
  else P2 = pOut(p, streams[0].P_bar, label);
  if (kind === 'compressor' && P2 <= a.P) fail('MB_P', 'compressor: outlet pressure must exceed inlet pressure', 'P_out_bar');
  if (kind === 'expander' && P2 >= a.P) fail('MB_P', 'expander: outlet pressure must be below inlet pressure', 'P_out_bar');
  const mode = p.mode === 'polytropic' ? 'polytropic' : 'isentropic';
  const eta = num(p.efficiency) ? p.efficiency : 0.75;
  if (!(eta > 0 && eta <= 1)) fail('MB_ETA', `${label}: efficiency must be in (0, 1]`, 'efficiency');
  if (a.r.phase !== 'V') w.push(`${label}: inlet contains liquid (vapour fraction ${(a.r.phase === 'L' ? 0 : a.r.beta).toFixed(4)})`);
  const s1 = th.sOf(pp, a.r);
  const rs = th.flashPS(pp, a.z, P2, s1, a.T);
  const hs = th.hOf(pp, rs);
  let h2;
  if (mode === 'isentropic') h2 = kind === 'compressor' ? a.h + (hs - a.h) / eta : a.h - eta * (a.h - hs);
  else {
    // polytropic: 20 small isentropic steps at the stage efficiency
    const nst = 20, ratio = Math.pow(P2 / a.P, 1 / nst);
    let h = a.h, rr = a.r, Pk = a.P, T = a.T;
    for (let k = 0; k < nst; k++) {
      const Pn = Pk * ratio;
      const sK = th.sOf(pp, rr);
      const rk = th.flashPS(pp, a.z, Pn, sK, T);
      const hk = th.hOf(pp, rk);
      h = kind === 'compressor' ? h + (hk - h) / eta : h - eta * (h - hk);
      rr = th.flashPH(pp, a.z, Pn, h, rk.T); T = rr.T; Pk = Pn;
    }
    h2 = h;
  }
  const r = th.flashPH(pp, a.z, P2, h2, rs.T);
  const out = streamOut(pp, a.F, a.z, r);
  if (out.vapour_fraction < 1 - 1e-9) w.push(`${label}: outlet is two-phase (vapour fraction ${out.vapour_fraction.toFixed(4)})`);
  const W = a.F * (h2 - a.h) / KJH_PER_KW;
  const props = out.rig.props && out.rig.props.phases[0];
  return result([out], a.mass, a.H_kJh, out.H_kJh, W,
    { pp: ppDetails(pp), power_kW: W, mode, efficiency: eta, pressure_ratio: P2 / a.P, T_out_K: r.T, T_isentropic_K: rs.T,
      isentropic_power_kW: a.F * (hs - a.h) / KJH_PER_KW, head_kJkg: (h2 - a.h) / (out.mass_flow_kg_h > 0 ? out.mass_flow_kg_h / a.F : 1),
      inlet_volume_m3_h: (() => { try { const pr = th.properties(pp, a.r); return a.mass / pr.rho_kgm3; } catch (_e) { return null; } })(),
      Z_out: props ? props.Z : null }, w);
}
const solveCompressor = (inp) => machine(inp, 'compressor');
const solveExpander = (inp) => machine(inp, 'expander');

// ---------------------------------------------------------------------------
// flash drum
// ---------------------------------------------------------------------------
function solveFlashR(inp) {
  const { streams, params: p } = input(inp, 1, 8, 'r-flash');
  const pp = pkg(p.property_package, keysOf(...streams));
  const st = streams.map((s, i) => stateIn(pp, s, `flash inlet ${i + 1}`));
  const f = combine(pp, st);
  const w = pp.warnings.slice();
  const Pin = Math.min(...streams.map((s) => s.P_bar));
  const P = num(p.P_bar) ? p.P_bar * 1e5 : pOut(p, Pin, 'r-flash');
  const hf = f.F > 0 ? f.H_kJh / f.F : 0;
  let r, mode;
  if (num(p.T_K) && !num(p.vapour_fraction)) { r = th.flashPT(pp, f.z, p.T_K, P); mode = 'TP'; }
  else if (num(p.vapour_fraction) && num(p.T_K)) { r = th.flashTVF(pp, f.z, p.T_K, p.vapour_fraction); mode = 'TVF'; }
  else if (num(p.vapour_fraction)) { r = th.flashPVF(pp, f.z, P, p.vapour_fraction, st[0].T); mode = 'PVF'; }
  else { const q = num(p.duty_kW) ? p.duty_kW : 0; r = f.F > 0 ? th.flashPH(pp, f.z, P, hf + q * KJH_PER_KW / f.F, st[0].T) : th.flashPT(pp, f.z, st[0].T, P); mode = q === 0 ? 'adiabatic' : 'PQ'; }
  const beta = r.phase === 'V' ? 1 : r.phase === 'L' || r.phase === 'LL' ? 0 : r.beta;
  const Fv = f.F * beta, Fl = f.F * (1 - beta);
  const rv = { T: r.T, P: r.P, beta: 1, x: r.y, y: r.y, phase: 'V' };
  let rl = { T: r.T, P: r.P, beta: 0, x: r.x, y: r.x, phase: 'L' }, xL = r.x;
  if (r.x2 && r.beta2 > 0) {
    // two liquids leave together through the liquid outlet
    const b2 = r.beta2 / (1 - beta);
    xL = r.x.map((v, i) => (1 - b2) * v + b2 * r.x2[i]);
    rl = { T: r.T, P: r.P, beta: 0, beta2: b2, x: r.x, y: r.x, x2: r.x2, phase: 'LL' };
    w.push('r-flash: two liquid phases leave together through the liquid outlet — use the three-phase separator to split them');
  }
  const vap = streamOut(pp, Fv, r.phase === 'L' || r.phase === 'LL' ? f.z : r.y, r.phase === 'L' || r.phase === 'LL' ? { ...rv, x: f.z, y: f.z } : rv);
  const liq = streamOut(pp, Fl, r.phase === 'V' ? f.z : xL, r.phase === 'V' ? { ...rl, x: f.z, y: f.z } : rl);
  const Hout = vap.H_kJh + liq.H_kJh;
  const K = r.phase === 'VL' ? compObj(pp, r.y.map((y, i) => (r.x[i] > 0 ? y / r.x[i] : 0))) : null;
  return result([vap, liq], f.mass, f.H_kJh, Hout, 0,
    { pp: ppDetails(pp), mode, T_K: r.T, P_bar: r.P / 1e5, vapour_fraction: beta, duty_kW: (Hout - f.H_kJh) / KJH_PER_KW,
      vapour_kmol_h: Fv, liquid_kmol_h: Fl, K, x: compObj(pp, xL), y: compObj(pp, r.y), phases: r.phase }, w);
}

// ---------------------------------------------------------------------------
// three-phase separator / decanter (VLLE)
// outlets: vapour, light liquid (liquid 1), heavy liquid (liquid 2)
// ---------------------------------------------------------------------------
function solveFlash3R(inp) {
  const { streams, params: p } = input(inp, 1, 8, 'r-flash3');
  const pp = pkg(p.property_package, keysOf(...streams));
  const st = streams.map((s, i) => stateIn(pp, s, `three-phase separator inlet ${i + 1}`));
  const f = combine(pp, st);
  const w = pp.warnings.slice();
  const Pin = Math.min(...streams.map((s) => s.P_bar));
  const P = num(p.P_bar) ? p.P_bar * 1e5 : pOut(p, Pin, 'r-flash3');
  let r, mode;
  if (num(p.T_K)) { r = th.flashPT3(pp, f.z, p.T_K, P); mode = 'TP'; }
  else {
    const q = num(p.duty_kW) ? p.duty_kW : 0;
    r = f.F > 0 ? th.flashPH3(pp, f.z, P, (f.H_kJh + q * KJH_PER_KW) / f.F, st[0].T) : th.flashPT3(pp, f.z, st[0].T, P);
    mode = q === 0 ? 'adiabatic' : 'PQ';
  }
  // phase fractions
  let bV = 0, b1 = 0, b2 = 0, xV = f.z, x1 = f.z, x2 = f.z;
  if (r.x2 && r.beta2 > 0) { bV = r.beta; b2 = r.beta2; b1 = 1 - bV - b2; xV = r.y; x1 = r.x; x2 = r.x2; }
  else {
    bV = r.phase === 'V' ? 1 : r.phase === 'L' ? 0 : r.beta;
    xV = r.phase === 'L' ? f.z : r.y;
    const xl = r.phase === 'V' ? f.z : r.x;
    // a single liquid goes to the heavy (aqueous) outlet when the key component dominates it
    const key = typeof p.heavy_key === 'string' ? p.heavy_key : 'H2O';
    const ik = pp.index[key];
    if (ik !== undefined && xl[ik] > 0.5) { b2 = 1 - bV; x2 = xl; } else { b1 = 1 - bV; x1 = xl; }
  }
  const T = r.T;
  const mk = (b, c, ph) => streamOut(pp, f.F * b, c, { T, P, beta: ph === 'V' ? 1 : 0, x: c, y: c, phase: ph }, { props: b > 0 });
  const vap = mk(bV, xV, 'V'), l1 = mk(b1, x1, 'L'), l2 = mk(b2, x2, 'L');
  const Hout = vap.H_kJh + l1.H_kJh + l2.H_kJh;
  const phases = r.x2 && r.beta2 > 0 ? r.phase : bV >= 1 ? 'V' : bV <= 0 ? 'L' : 'VL';
  if (phases === 'VL' || phases === 'L') w.push('r-flash3: a single liquid phase at these conditions — no second liquid forms');
  return result([vap, l1, l2], f.mass, f.H_kJh, Hout, 0,
    { pp: ppDetails(pp), mode, phases, T_K: T, P_bar: P / 1e5, vapour_fraction: bV, light_liquid_fraction: b1, heavy_liquid_fraction: b2,
      duty_kW: (Hout - f.H_kJh) / KJH_PER_KW, vapour_kmol_h: f.F * bV, light_liquid_kmol_h: f.F * b1, heavy_liquid_kmol_h: f.F * b2,
      y: compObj(pp, xV), x1: compObj(pp, x1), x2: compObj(pp, x2) }, w);
}

// ---------------------------------------------------------------------------
// mixer / splitter / component splitter
// ---------------------------------------------------------------------------
function solveMixerR(inp) {
  const { streams, params: p } = input(inp, 1, 12, 'r-mixer');
  const pp = pkg(p.property_package, keysOf(...streams));
  const st = streams.map((s, i) => stateIn(pp, s, `mixer inlet ${i + 1}`));
  const f = combine(pp, st);
  const P = num(p.P_out_bar) ? p.P_out_bar * 1e5 : Math.min(...st.map((s) => s.P));
  if (num(p.T_out_K) && num(p.duty_kW)) fail('MB_MIXER_SPEC', 'r-mixer: give T_out_K or duty_kW, not both', 'params');
  const Tg = st.reduce((a, s) => a + s.T * s.F, 0) / (f.F || 1);
  const q = num(p.duty_kW) ? p.duty_kW * KJH_PER_KW : 0;            // optional heat input (kJ/h)
  let r;
  if (num(p.T_out_K)) r = th.flashPT(pp, f.z, p.T_out_K, P);
  else r = f.F > 0 ? th.flashPH(pp, f.z, P, (f.H_kJh + q) / f.F, Tg) : th.flashPT(pp, f.z, Tg, P);
  const out = streamOut(pp, f.F, f.z, r);
  return result([out], f.mass, f.H_kJh, out.H_kJh, 0, { pp: ppDetails(pp), T_out_K: r.T, P_out_bar: P / 1e5, duty_kW: (out.H_kJh - f.H_kJh) / KJH_PER_KW,
    vapour_fraction_out: out.vapour_fraction }, pp.warnings.slice());
}

function solveSplitterR(inp) {
  const { streams, params: p } = input(inp, 1, 1, 'r-splitter');
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], 'splitter inlet');
  const fr = p.fractions;
  if (!Array.isArray(fr) || fr.length < 2 || fr.some((v) => !num(v) || v < 0)) fail('MB_SPLIT', 'r-splitter: params.fractions must be an array of ≥ 2 non-negative numbers', 'fractions');
  const sum = fr.reduce((x, y) => x + y, 0);
  if (Math.abs(sum - 1) > 1e-6) fail('MB_SPLIT', `r-splitter: fractions sum to ${sum} (must be 1)`, 'fractions');
  const outs = fr.map((v) => streamOut(pp, a.F * v, a.z, a.r));
  return result(outs, a.mass, a.H_kJh, outs.reduce((x, s) => x + s.H_kJh, 0), 0, { pp: ppDetails(pp), fractions: fr }, pp.warnings.slice());
}

function solveCompSplitR(inp) {
  const { streams, params: p } = input(inp, 1, 1, 'r-component-splitter');
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], 'component splitter inlet');
  const fr = {};
  const sp = p.splits;
  if (Array.isArray(sp)) { for (const r of sp) if (r && typeof r.key === 'string') fr[r.key] = r.f; } else if (sp && typeof sp === 'object') Object.assign(fr, sp);
  else fail('MB_SPLITS', 'r-component-splitter: params.splits must be {key: fraction to outlet 1}', 'splits');
  const w = pp.warnings.slice();
  for (const k in fr) {
    if (!num(fr[k]) || fr[k] < 0 || fr[k] > 1) fail('MB_SPLITS', `split fraction for '${k}' must be in [0, 1]`, 'splits');
    if (!(k in pp.index)) w.push(`r-component-splitter: '${k}' is not in the feed — ignored`);
  }
  const n1 = pp.keys.map((k, i) => a.F * a.z[i] * (num(fr[k]) ? fr[k] : 0));
  const n2 = pp.keys.map((k, i) => a.F * a.z[i] - n1[i]);
  const mk = (nv, T, Pb) => {
    const F = nv.reduce((x, y) => x + y, 0);
    const z = F > 0 ? nv.map((v) => v / F) : a.z;
    const P = num(Pb) ? Pb * 1e5 : a.P;
    return streamOut(pp, F, z, th.flashPT(pp, z, num(T) ? T : a.T, P));
  };
  const o1 = mk(n1, p.T1_K, p.P1_bar), o2 = mk(n2, p.T2_K, p.P2_bar);
  return result([o1, o2], a.mass, a.H_kJh, o1.H_kJh + o2.H_kJh, 0, { pp: ppDetails(pp), duty_kW: (o1.H_kJh + o2.H_kJh - a.H_kJh) / KJH_PER_KW }, w);
}

// ---------------------------------------------------------------------------
// two-stream heat exchanger (counter-current, zone analysis)
// ---------------------------------------------------------------------------
function solveHXR(inp) {
  const { streams, params: p } = input(inp, 2, 2, 'r-hx');
  const pp = pkg(p.property_package, keysOf(...streams));
  const hot = stateIn(pp, streams[0], 'hot inlet'), cold = stateIn(pp, streams[1], 'cold inlet');
  const w = pp.warnings.slice();
  if (hot.T < cold.T) w.push('r-hx: hot inlet is colder than cold inlet — check port order (port 1 = hot, port 2 = cold)');
  const Ph = pOut({ dp_bar: p.dp_hot_bar || 0 }, streams[0].P_bar, 'r-hx hot side');
  const Pc = pOut({ dp_bar: p.dp_cold_bar || 0 }, streams[1].P_bar, 'r-hx cold side');
  const specs = ['hot_T_out_K', 'cold_T_out_K', 'duty_kW', 'min_approach_K', 'UA_kW_K'].filter((k) => num(p[k]));
  if (specs.length !== 1) fail('MB_HX_SPEC', 'r-hx: give exactly one of hot_T_out_K, cold_T_out_K, duty_kW, min_approach_K, UA_kW_K', 'params');
  const NZ = 24;
  // profiles for a duty Q (kW): returns {ok, dTmin, UA, rh, rc}
  const evalQ = (Q) => {
    const dq = Q * KJH_PER_KW;
    const rh = th.flashPH(pp, hot.z, Ph, hot.h - dq / hot.F, hot.T);
    const rc = th.flashPH(pp, cold.z, Pc, cold.h + dq / cold.F, cold.T);
    // zones: hot side from inlet (T_h,in) to outlet; cold counter-current
    let dTmin = Infinity, UA = 0, prev = null;
    for (let k = 0; k <= NZ; k++) {
      const q = dq * k / NZ;           // heat transferred from hot inlet end
      const Th = k === 0 ? hot.T : k === NZ ? rh.T : th.flashPH(pp, hot.z, hot.P + (Ph - hot.P) * k / NZ, hot.h - q / hot.F, hot.T).T;
      // cold at the same location has received (dq − q) counted from its inlet
      const qc = dq - q;
      const Tc = k === NZ ? cold.T : k === 0 ? rc.T : th.flashPH(pp, cold.z, cold.P + (Pc - cold.P) * (NZ - k) / NZ, cold.h + qc / cold.F, cold.T).T;
      const dT = Th - Tc;
      dTmin = Math.min(dTmin, dT);
      if (prev) {
        const d1 = prev, d2 = dT;
        const lm = Math.abs(d1 - d2) < 1e-9 ? d1 : (d1 - d2) / Math.log(d1 / d2);
        UA += (dq / NZ) / KJH_PER_KW / (lm > 0 ? lm : NaN);
      }
      prev = dT;
    }
    return { dTmin, UA, rh, rc };
  };
  let Q;
  if (num(p.duty_kW)) Q = p.duty_kW;
  else if (num(p.hot_T_out_K)) { const r = th.flashPT(pp, hot.z, p.hot_T_out_K, Ph); Q = hot.F * (hot.h - th.hOf(pp, r)) / KJH_PER_KW; }
  else if (num(p.cold_T_out_K)) { const r = th.flashPT(pp, cold.z, p.cold_T_out_K, Pc); Q = cold.F * (th.hOf(pp, r) - cold.h) / KJH_PER_KW; }
  else {
    // bracket Q in (0, Qmax): Qmax = smaller of the two "cool hot to cold-in" / "heat cold to hot-in" duties
    const qh = hot.F * (hot.h - th.hOf(pp, th.flashPT(pp, hot.z, cold.T, Ph))) / KJH_PER_KW;
    const qc = cold.F * (th.hOf(pp, th.flashPT(pp, cold.z, hot.T, Pc)) - cold.h) / KJH_PER_KW;
    let lo = 0, hi = Math.min(qh, qc) * 0.999999;
    if (!(hi > 0)) fail('MB_HX_SPEC', 'r-hx: no heat can flow from the hot to the cold stream', 'params');
    const target = num(p.min_approach_K) ? p.min_approach_K : p.UA_kW_K;
    // dTmin decreases with Q; UA increases with Q
    for (let it = 0; it < 80; it++) {
      const m = 0.5 * (lo + hi);
      const e = evalQ(m);
      const ok = num(p.min_approach_K) ? e.dTmin > target : (isFinite(e.UA) && e.UA < target);
      if (ok) lo = m; else hi = m;
      if (hi - lo < 1e-7 * Math.max(1, hi)) break;
    }
    Q = 0.5 * (lo + hi);
  }
  if (!(Q >= 0)) fail('MB_HX_SPEC', 'r-hx: the specification gives heat flowing from the cold to the hot stream', 'params');
  const e = evalQ(Q);
  if (e.dTmin < -1e-6) fail('MB_HX_CROSS', `r-hx: temperature cross — minimum approach ${e.dTmin.toFixed(2)} K inside the exchanger (zone analysis); check the specification${Math.abs(e.dTmin) > 200 ? ' — inside a recycle loop, give the torn stream a realistic initial estimate' : ''}`, 'params');
  if (e.dTmin < 1) w.push(`r-hx: minimum approach only ${e.dTmin.toFixed(2)} K — exchanger area becomes very large`);
  const oh = streamOut(pp, hot.F, hot.z, e.rh), oc = streamOut(pp, cold.F, cold.z, e.rc);
  const dT1 = hot.T - e.rc.T, dT2 = e.rh.T - cold.T;
  const lmtd = Math.abs(dT1 - dT2) < 1e-9 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
  return result([oh, oc], hot.mass + cold.mass, hot.H_kJh + cold.H_kJh, oh.H_kJh + oc.H_kJh, 0,
    { pp: ppDetails(pp), duty_kW: Q, hot_T_out_K: e.rh.T, cold_T_out_K: e.rc.T, min_approach_K: e.dTmin, LMTD_K: lmtd,
      UA_kW_K: e.UA, UA_LMTD_kW_K: lmtd > 0 ? Q / lmtd : null, zones: NZ }, w);
}

// ---------------------------------------------------------------------------
// element matrix (from compdb formulas)
// ---------------------------------------------------------------------------
function elements(key) {
  const c = compdb.get(key);
  const f = c && c.formula;
  if (!f || /\(/.test(f)) return null;
  const out = {};
  const re = /([A-Z][a-z]?)(\d*)/g;
  let m;
  while ((m = re.exec(f))) out[m[1]] = (out[m[1]] || 0) + (m[2] ? parseInt(m[2], 10) : 1);
  return out;
}

// ---------------------------------------------------------------------------
// Gibbs reactor — ideal-gas phase, Gordon–McBride (NASA CEA, RP-1311) method:
// Newton on Δln n_j, the element potentials π and Δln n with the CEA control
// factors, so trace species (down to ~1e-300) and limiting elements converge
// from a uniform starting composition.
// ---------------------------------------------------------------------------
function gibbsEquilibrium(pp, nIn, T, P, keysAllowed) {
  const n = pp.n;
  const act = pp.keys.map((k) => keysAllowed.includes(k));
  const El = [...new Set(pp.keys.flatMap((k, i) => (act[i] || nIn[i] > 0 ? Object.keys(elements(k) || {}) : [])))];
  const A = El.map((e) => pp.keys.map((k) => (elements(k) || {})[e] || 0));
  const b0 = El.map((e, r) => A[r].reduce((s, a, i) => s + a * nIn[i], 0));
  const E = El.length;
  const mu0 = pp.comps.map((c, i) => (pp.hig(i, T) - T * pp.sig(i, T)) / (R * T));
  const lnP = Math.log(P / th.P0);
  const J = pp.keys.map((_, i) => i).filter((i) => act[i]);
  const NS = J.length;
  const Nfeed = nIn.reduce((s, v) => s + v, 0) || 1;
  const SIZE = 18.420681;                                 // ln(1e8)
  let lnN = Math.log(Nfeed);
  const lnn = new Array(n).fill(-Infinity);
  for (const j of J) lnn[j] = lnN - Math.log(NS);
  let pi = new Array(E).fill(0), it, conv = false;
  for (it = 0; it < 500; it++) {
    const nj = lnn.map((v) => (Number.isFinite(v) ? Math.exp(v) : 0));
    const sumN = J.reduce((s, j) => s + nj[j], 0);
    const mu = lnn.map((v, j) => (act[j] ? mu0[j] + v - lnN + lnP : 0));     // μ_j/RT
    const bc = El.map((_, r) => J.reduce((s, j) => s + A[r][j] * nj[j], 0));
    // (E+1) linear equations in π and Δln n
    const M = [], rhs = [];
    for (let k = 0; k < E; k++) {
      const row = new Array(E + 1).fill(0);
      for (let i = 0; i < E; i++) row[i] = J.reduce((s, j) => s + A[k][j] * A[i][j] * nj[j], 0);
      row[E] = bc[k];
      M.push(row);
      rhs.push(b0[k] - bc[k] + J.reduce((s, j) => s + A[k][j] * nj[j] * mu[j], 0));
    }
    {
      const row = new Array(E + 1).fill(0);
      for (let i = 0; i < E; i++) row[i] = bc[i];
      row[E] = sumN - Math.exp(lnN);
      M.push(row);
      rhs.push(Math.exp(lnN) - sumN + J.reduce((s, j) => s + nj[j] * mu[j], 0));
    }
    for (let k = 0; k < E; k++) M[k][k] += 1e-14 * Math.max(1, Math.abs(M[k][k]));
    const x = gauss(M, rhs);
    if (!x || !x.every(Number.isFinite)) break;
    pi = x.slice(0, E);
    const dlnN = x[E];
    const dl = new Array(n).fill(0);
    for (const j of J) { let v = -mu[j] + dlnN; for (let i = 0; i < E; i++) v += A[i][j] * pi[i]; dl[j] = v; }
    // convergence (RP-1311 eq. 3.5, tightened) and element balance
    let crit = Math.abs(dlnN) * Math.exp(lnN) / sumN;
    for (const j of J) crit = Math.max(crit, nj[j] * Math.abs(dl[j]) / sumN);
    let eb = 0;
    for (let k = 0; k < E; k++) eb = Math.max(eb, Math.abs(b0[k] - bc[k]) / Math.max(b0[k], 1e-300));
    if (crit < 1e-11 && eb < 1e-10) { conv = true; break; }
    if (crit < 1e-8 && eb < 1e-9 && it > 60) { conv = true; break; }       // round-off floor reached
    // control factors (RP-1311 eqs. 3.1–3.3)
    let big = 5 * Math.abs(dlnN);
    for (const j of J) if (lnn[j] - lnN > -SIZE) big = Math.max(big, Math.abs(dl[j]));
    let lam = big > 2 ? 2 / big : 1;
    for (const j of J) if (lnn[j] - lnN <= -SIZE && dl[j] >= 0) {
      const den = dl[j] - dlnN;
      if (den > 0) lam = Math.min(lam, Math.abs((-(lnn[j] - lnN) - 9.2103404) / den));
    }
    lam = Math.min(1, lam);
    lnN += lam * dlnN;
    for (const j of J) lnn[j] = Math.max(lnn[j] + lam * dl[j], lnN - 690);
  }
  const nn = lnn.map((v) => (Number.isFinite(v) ? Math.exp(v) : 0));
  return { n: nn, converged: conv, iterations: it, elements: El, lambda: pi };
}

function gauss(M, b) {
  const n = b.length;
  const a = M.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = a[r][n]; for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k]; x[r] = s / a[r][r]; }
  return x;
}

function solveGibbs(inp) {
  const { streams, params: p } = input(inp, 1, 6, 'gibbs');
  const prodKeys = Array.isArray(p.products) ? p.products.filter((k) => typeof k === 'string') : [];
  const keys = [...new Set(keysOf(...streams).concat(prodKeys))];
  const pp = pkg(p.property_package, keys);
  const w = pp.warnings.slice();
  const st = streams.map((s, i) => stateIn(pp, s, `gibbs inlet ${i + 1}`));
  const f = combine(pp, st);
  for (const k of pp.keys) if (!elements(k)) fail('MB_GIBBS_FORMULA', `gibbs: no molecular formula for '${k}'`, 'products');
  // every feed species may remain at equilibrium (as in a commercial RGibbs);
  // `products` adds the species that may form. remove_feed:true restores the
  // strict mode in which unlisted feed species can only react away.
  const feedKeys = pp.keys.filter((k) => f.z[pp.index[k]] > 0);
  const listed = prodKeys.concat(Array.isArray(p.inerts) ? p.inerts : []);
  const allowed = prodKeys.length ? [...new Set(p.remove_feed === true ? listed : listed.concat(feedKeys))] : pp.keys.slice();
  if (p.remove_feed === true) for (const k of feedKeys) if (!allowed.includes(k)) w.push(`gibbs: feed component '${k}' is not in the product list — it can only react away`);
  const P = num(p.P_out_bar) ? p.P_out_bar * 1e5 : pOut(p, Math.min(...streams.map((s) => s.P_bar)), 'gibbs');
  const nIn = f.z.map((v) => v * f.F);
  const solveAt = (T) => {
    const g = gibbsEquilibrium(pp, nIn, T, P, allowed);
    const F = g.n.reduce((s, v) => s + v, 0);
    const z = g.n.map((v) => v / F);
    const r = { T, P, beta: 1, x: z, y: z, phase: 'V' };
    return { g, F, z, r, H: F * th.hOf(pp, r) };
  };
  let res, T;
  if (num(p.T_out_K)) { T = p.T_out_K; res = solveAt(T); }
  else {
    // adiabatic (or given duty): find T with H_out = H_in + Q
    const Q = num(p.duty_kW) ? p.duty_kW * KJH_PER_KW : 0;
    const target = f.H_kJh + Q;
    let lo = 300, hi = 2500;
    let flo = solveAt(lo).H - target, fhi = solveAt(hi).H - target;
    if (flo > 0 || fhi < 0) fail('MB_GIBBS_T', 'gibbs: adiabatic temperature outside 300–2500 K', 'params');
    for (let it = 0; it < 80; it++) {
      const m = 0.5 * (lo + hi), fm = solveAt(m).H - target;
      if (fm > 0) hi = m; else lo = m;
      if (hi - lo < 1e-6) break;
    }
    T = 0.5 * (lo + hi); res = solveAt(T);
  }
  if (!res.g.converged) w.push('gibbs: element-potential iteration did not fully converge');
  const out = streamOut(pp, res.F, res.z, res.r);
  w.push('gibbs: vapour-phase ideal-gas equilibrium (no condensed phases)');
  // equilibrium approach report: ln Kp check for each species pair is implicit; report element balance
  const elemErr = res.g.elements.map((e) => {
    const a = pp.keys.map((k) => (elements(k) || {})[e] || 0);
    const bin = a.reduce((s, v, i) => s + v * nIn[i], 0), bout = a.reduce((s, v, i) => s + v * res.g.n[i], 0);
    return Math.abs(bout - bin) / Math.max(bin, 1e-12);
  });
  return result([out], f.mass, f.H_kJh, out.H_kJh, 0,
    { pp: ppDetails(pp), T_out_K: T, P_out_bar: P / 1e5, duty_kW: (out.H_kJh - f.H_kJh) / KJH_PER_KW, iterations: res.g.iterations,
      element_balance_max_rel: Math.max(...elemErr), outlet_mole_frac: compObj(pp, res.z) }, w, { converged: res.g.converged });
}

// ---------------------------------------------------------------------------
// conversion reactor (reactions in series), rigorous energy balance
// ---------------------------------------------------------------------------
function solveConvReactor(inp) {
  const { streams, params: p } = input(inp, 1, 6, 'r-reactor');
  const rx = p.reactions;
  if (!Array.isArray(rx) || !rx.length) fail('MB_RXN', 'r-reactor: params.reactions [{stoich:{key:ν}, key, conversion}] required', 'reactions');
  const keys = [...new Set(keysOf(...streams).concat(rx.flatMap((r) => Object.keys(r.stoich || {}))))];
  const pp = pkg(p.property_package, keys);
  const w = pp.warnings.slice();
  const st = streams.map((s, i) => stateIn(pp, s, `reactor inlet ${i + 1}`));
  const f = combine(pp, st);
  const nmol = f.z.map((v) => v * f.F);
  const ext = [];
  rx.forEach((r, j) => {
    const nu = r.stoich || {};
    const key = r.key;
    if (!(key in nu) || !(nu[key] < 0)) fail('MB_RXN', `reaction ${j + 1}: key component '${key}' must be a reactant (negative coefficient)`, 'reactions');
    if (!num(r.conversion) || r.conversion < 0 || r.conversion > 1) fail('MB_RXN', `reaction ${j + 1}: conversion must be in [0, 1]`, 'reactions');
    // element balance check
    const El = new Set(Object.keys(nu).flatMap((k) => Object.keys(elements(k) || {})));
    for (const e of El) {
      const s = Object.entries(nu).reduce((a, [k, v]) => a + v * ((elements(k) || {})[e] || 0), 0);
      if (Math.abs(s) > 1e-6) w.push(`reaction ${j + 1}: element ${e} does not balance (Σν·a = ${s.toFixed(4)})`);
    }
    const xi = nmol[pp.index[key]] * r.conversion / -nu[key];
    for (const k in nu) {
      const i = pp.index[k];
      nmol[i] += nu[k] * xi;
      if (nmol[i] < -1e-9) fail('MB_RXN', `reaction ${j + 1}: '${k}' goes negative — limiting reactant is not '${key}'`, 'reactions');
      nmol[i] = Math.max(0, nmol[i]);
    }
    // standard heat of reaction at 298.15 K, kJ/mol of key
    const dH = Object.entries(nu).reduce((a, [k, v]) => a + v * pp.comps[pp.index[k]].Hf, 0) / -nu[key] / 1000;
    ext.push({ reaction: j + 1, extent_kmol_h: xi, dHr298_kJ_per_mol_key: dH });
  });
  const F = nmol.reduce((a, b) => a + b, 0);
  const z = nmol.map((v) => v / F);
  const P = num(p.P_out_bar) ? p.P_out_bar * 1e5 : pOut(p, Math.min(...streams.map((s) => s.P_bar)), 'r-reactor');
  let r;
  // isothermal: outlet at the (flow-weighted) inlet temperature
  const Tiso = p.isothermal === true ? st.reduce((a, s) => a + s.T * s.F, 0) / (f.F || 1) : NaN;
  if (num(p.T_out_K)) r = th.flashPT(pp, z, p.T_out_K, P);
  else if (num(Tiso)) r = th.flashPT(pp, z, Tiso, P);
  else { const Q = num(p.duty_kW) ? p.duty_kW * KJH_PER_KW : 0; r = th.flashPH(pp, z, P, (f.H_kJh + Q) / F, st[0].T); }
  const out = streamOut(pp, F, z, r);
  return result([out], f.mass, f.H_kJh, out.H_kJh, 0, { pp: ppDetails(pp), T_out_K: r.T, duty_kW: (out.H_kJh - f.H_kJh) / KJH_PER_KW, reactions: ext }, w);
}

// ---------------------------------------------------------------------------
// property-info: what the package will use for these components (Aspen's
// "Methods → Parameters" view) — pure-component data coverage and the
// binary parameters found in the databank, so a user can see the gaps
// before running. streams: one or more streams carrying the components.
// ---------------------------------------------------------------------------
function propertyInfo(inp) {
  const { streams, params: p } = input(inp, 1, 20, 'property-info');
  const all = keysOf(...streams);
  if (all.length > 40) fail('MB_PINFO', 'property-info: at most 40 components', 'streams');
  const noData = all.filter((k) => !compdb.has(k));
  const keys = all.filter((k) => compdb.has(k));
  if (!keys.length) fail('MB_PINFO', `property-info: no rigorous property data for ${noData.join(', ')}`, 'streams');
  const spec = p.property_package || { model: 'pr' };
  const pp = pkg(spec, keys);
  const model = pp.model;
  const r4 = (v, d) => (num(v) ? Number(v.toPrecision(d || 6)) : null);
  const comps = keys.map((k) => {
    const c = compdb.get(k) || {};
    return { key: k, name: c.name || k, formula: c.formula || null, cas: c.cas || null, mw: r4(c.mw), Tc_K: r4(c.tc), Pc_bar: r4(c.pc / 1e5),
      omega: r4(c.w), Tb_K: r4(c.tb), Hf_kJmol: r4(c.hf / 1e6), unifac: !!c.unifac, modunifac: !!c.modunifac,
      uniquac_rq: num(c.uqr) && num(c.uqq), category: c.cat || null };
  });
  const pairs = [];
  const userOf = (tab, a, b) => (tab && tab[a + '|' + b]) || null;
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j];
    const row = { i: a, j: b };
    if (model === 'pr' || model === 'srk' || pp.vapourModel !== 'ideal') {
      const [x, y] = [a, b].sort();
      const u = spec.kij && (num(spec.kij[x + '|' + y]) ? spec.kij[x + '|' + y] : num(spec.kij[y + '|' + x]) ? spec.kij[y + '|' + x] : null);
      const v = num(u) ? u : bip.PR[x + '|' + y];
      row.kij = num(v) ? v : 0;
      row.kij_source = num(u) ? 'user' : num(v) ? 'ChemSep' : 'none (0)';
    }
    if (model === 'nrtl') {
      const ua = userOf(spec.nrtl, a, b), ub = userOf(spec.nrtl, b, a);
      const da = bip.NRTL[a + '|' + b], db = bip.NRTL[b + '|' + a];
      row.nrtl = { b_ij: ua ? ua.b || 0 : da ? da[0] : 0, b_ji: ub ? ub.b || 0 : db ? db[0] : 0, a_ij: ua ? ua.a || 0 : 0, a_ji: ub ? ub.a || 0 : 0,
        alpha: ua && num(ua.alpha) ? ua.alpha : da ? da[1] : db ? db[1] : 0.3 };
      row.source = ua || ub ? 'user' : da || db ? 'ChemSep' : 'none (ideal)';
    } else if (model === 'uniquac') {
      const ua = userOf(spec.uniquac, a, b), ub = userOf(spec.uniquac, b, a);
      const da = bip.UNIQUAC[a + '|' + b], db = bip.UNIQUAC[b + '|' + a];
      row.uniquac = { b_ij: ua ? ua.b || 0 : da ? da[0] : 0, b_ji: ub ? ub.b || 0 : db ? db[0] : 0 };
      row.source = ua || ub ? 'user' : da || db ? 'ChemSep' : 'none (τ = 1)';
    } else if (model === 'wilson') {
      const ua = userOf(spec.wilson, a, b), ub = userOf(spec.wilson, b, a);
      const da = bip.WILSON[a + '|' + b], db = bip.WILSON[b + '|' + a];
      row.wilson = { a_ij: ua ? ua.a || 0 : da ? da[0] : 0, b_ij: ua ? ua.b || 0 : da ? da[1] : 0, a_ji: ub ? ub.a || 0 : db ? db[0] : 0, b_ji: ub ? ub.b || 0 : db ? db[1] : 0 };
      row.source = ua || ub ? 'user' : da || db ? 'ChemSep' : 'none (Λ = 1)';
    }
    pairs.push(row);
  }
  const henry = (pp.henryKeys || []).slice();
  return { streams_out: [], mass_balance: {}, energy_balance: {},
    details: { model, label: pp.label, vapour_model: pp.vapourModel, poynting: !!pp.poynting, components: comps, pairs, henry_components: henry,
      association: pp.association || null,
      electrolyte: pp.electrolyte ? { model: pp.electrolyte.model, solvent: pp.electrolyte.solvent,
        method: pp.electrolyte.model === 'amine-mea'
          ? 'Chemical equilibrium (carbamate + bicarbonate, ideal molarity basis), Akula et al. (2021) as in the IDAES MEA property package; CO2 Henry constant by the N2O analogy (Jiru et al. 2012); H2O / MEA by Raoult on true mole fractions'
          : 'Pitzer electrolyte model (Harvie–Møller–Weare) with the USGS PHREEQC pitzer.dat parameters and equilibrium constants: K+, CO3−−, HCO3−, CO2(aq), OH−, H+; water activity from the osmotic coefficient',
        enthalpy: 'Gibbs–Helmholtz on the liquid fugacities (heats of absorption consistent with the solubility model)' } : null,
      no_data: noData,
      databank: (compdb.CHEMSEP_VERSION || 'ChemSep') + ' (Artistic License 2.0) · NIST Shomate ideal-gas data where available' },
    converged: true, warnings: pp.warnings.concat(noData.length ? [`no rigorous property data for ${noData.join(', ')} — these can only be used in the classic engine models`] : []) };
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------
const wrap = (fn) => (inp) => {
  try { return fn(inp); } catch (e) {
    if (e instanceof UnitError || e instanceof th.ThermoError) return { error: { code: e.code, message: e.message, field: e.field || null } };
    return { error: { code: 'MB_RIG_THROW', message: e.message, field: null } };
  }
};

export const RIG_MODULES = {
  'heater': solveHeater,
  'valve': solveValve,
  'pump': solvePumpR,
  'compressor': solveCompressor,
  'expander': solveExpander,
  'r-flash': solveFlashR,
  'r-flash3': solveFlash3R,
  'r-mixer': solveMixerR,
  'r-splitter': solveSplitterR,
  'r-component-splitter': solveCompSplitR,
  'r-hx': solveHXR,
  'gibbs': solveGibbs,
  'r-reactor': solveConvReactor,
  'property-info': propertyInfo,
};

/**
 * Register the rigorous modules (wrapped so they return error envelopes).
 * @param {object} [extra] more modules (the column) to wrap and add
 * @returns {object} name → function
 */
export function register(extra) {
  const out = {};
  for (const [k, fn] of Object.entries(Object.assign({}, RIG_MODULES, extra || {}))) out[k] = wrap(fn);
  return out;
}

/**
 * Rigorous stream summary for the flowsheet's stream table (feeds included).
 * @returns {object} stream with H_kJh, vapour_fraction, rig
 */
export function describeStream(spec, s) {
  const pp = pkg(spec, keysOf(s));
  const a = stateIn(pp, s, 'stream');
  return streamOut(pp, a.F, a.z, a.r);
}

export { UnitError, elements, gibbsEquilibrium, gauss, stateIn as rigStateIn };
/** component and total molar flows of a stream with the databank molecular weights (rigorous streams) */
export function moles(s) {
  const n = {};
  let tot = 0;
  for (const c of s.components || []) {
    const d = compdb.get(c.key);
    if (!d || !num(c.mass_fraction)) return null;
    const v = c.mass_fraction * s.mass_flow_kg_h / d.mw;
    n[c.key] = (n[c.key] || 0) + v; tot += v;
  }
  return { n, tot };
}

export default { UNITS_VERSION, RIG_MODULES, register, pkg, stateIn, streamOut, describeStream, elements, UnitError, moles };
