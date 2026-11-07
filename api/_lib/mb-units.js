// ============================================================================
// REPO PATH: api/_lib/mb-units.js
// ============================================================================
// multicalci.com — STEP 22 rigorous unit operations on the property-package
// core (api/_lib/mb-thermo.js). Every module takes the engine's usual
// {streams, params} input — mass-based streams {mass_flow_kg_h, T_K, P_bar,
// components:[{key, mass_fraction}]} — plus params.property_package
// ({model:'pr'|'srk'|'ideal'|'nrtl'|'uniquac'|'wilson'|'unifac'|'modunifac'|'amine-mea'|'amine-mdea'|'hot-k2co3'|'steam',
//   kij?, nrtl?, …}), and returns {streams_out, mass_balance, energy_balance,
// details, converged, warnings}. Outlet streams carry H_kJh, vapour_fraction
// and a `rig` block (package signature, molar H/S, phase compositions and
// phase properties) so the next unit reconstructs the exact state.
//
//   heater        heater / cooler: outlet T, duty or vapour fraction
//   valve         isenthalpic let-down
//   pump          liquid pump: ΔP, efficiency → power, head
//   compressor    isentropic or polytropic, efficiency → power, outlet T
//   expander      turbine / expander: power recovered (spec: efficiency, outlet T or power)
//   extraction-turbine  HP + LP sections with a controlled extraction (Step 26)
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
  flashPH: (pp, z, P, H, Tg, hint) => (pp.threePhase ? thBase.flashPH3(pp, z, P, H, Tg, hint) : thBase.flashPH(pp, z, P, H, Tg, hint)),
  flashPS: (pp, z, P, S, Tg, hint) => (pp.threePhase ? thBase.flashPS3(pp, z, P, S, Tg, hint) : thBase.flashPS(pp, z, P, S, Tg, hint)),
});
import compdb from './mb-compdb.js';
import bip from './mb-bip.js';

export const UNITS_VERSION = 'mb-units 1.9.0';
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

// ---------------------------------------------------------------------------
// STEP 31 — ideal-gas vapour at pressure. Activity-coefficient (and Raoult) methods with
// "Vapour phase: Ideal gas" leave out the real-gas enthalpy of the vapour; above about 5 bar
// that error enters duties and machine power directly (a steam turbine at 62 bar comes out
// ~30 % high). Every inlet and outlet of the unit being solved is checked: the size of the
// missing correction is estimated with Peng–Robinson and reported when it matters.
// ---------------------------------------------------------------------------
const IGV_P = 5e5;               // Pa — "above about 5 bar"
const IGV_H = 500;               // J/mol — smallest real-gas enthalpy correction worth a warning
let IGV = null;                  // check state of the unit call in progress (calls are synchronous)
function noteVapour(pp, r) {
  if (!IGV || !r || pp.vapourModel !== 'ideal' || pp.model === 'steam' || !(r.P >= IGV_P)) return;
  if (!(r.phase === 'V' || (r.beta > 0 && r.phase !== 'L' && r.phase !== 'LL'))) return;
  const y = r.y;
  if (!Array.isArray(y) || y.length !== pp.n) return;
  let hd;
  try {
    const pr = pkg({ model: 'pr' }, pp.keys);
    if (pr.n !== pp.n || !pr.eos) return;
    hd = pr.eos.state(r.T, r.P, y, 'V').hDep;
  } catch (_e) { return; }
  if (!num(hd) || Math.abs(hd) < IGV_H) return;
  const MWv = y.reduce((a, v, i) => a + v * pp.MW[i], 0);
  if (!IGV.hit || Math.abs(hd) > Math.abs(IGV.hDep)) Object.assign(IGV, { hDep: hd, T: r.T, dh_kJkg: MWv > 0 ? hd / MWv : null });
  IGV.P = Math.max(IGV.P || 0, r.P);
  IGV.hit = true;
  IGV.water = pp.keys.length === 1 && pp.keys[0] === 'H2O';
  IGV.gas = pp.keys.every(gasLike);
  IGV.model = pp.model;
}
/**
 * STEP 32 — per-unit checks on every state that enters or leaves the unit:
 *  · a flash that did not converge (flash result `converged: false`) marks the
 *    unit unconverged and names the worst state;
 *  · liquid water on a cubic equation of state with free water switched off
 *    (latent heat of water about 5 % high, vapour pressure up to 15 % low).
 */
function noteState(pp, r) {
  if (!IGV || !r) return;
  if (r.converged === false) {
    const res = num(r.residual) ? r.residual : NaN;
    if (!IGV.flash || !(res <= IGV.flash.residual)) IGV.flash = { T: r.T, P: r.P, residual: res, phase: r.phase };
    IGV.flashCount = (IGV.flashCount || 0) + 1;
  }
  if (pp.isEOS && !pp.freeWater && pp.index && pp.index.H2O !== undefined && r.phase !== 'V') {
    const iw = pp.index.H2O, liq = [];
    if (r.x && (r.phase === 'L' || r.phase === 'VL' || r.phase === 'LL' || r.phase === 'VLL')) liq.push(r.x);
    if (r.x2) liq.push(r.x2);
    for (const x of liq) if (x[iw] >= 0.05) { IGV.wet = Math.max(IGV.wet || 0, x[iw]); break; }
  }
}
const fmtKJ = (v) => { const a = Math.abs(v); return a >= 10 ? a.toFixed(0) : a.toPrecision(2); };
/** the advice for a unit that hit the check (also used by the flowsheet summary) */
const IGV_GASES = ['N2', 'O2', 'H2', 'CO', 'CO2', 'Ar', 'He', 'H2S', 'NH3', 'neon', 'krypton', 'xenon'];
/** light gas or hydrocarbon (formula CxHy) — the mixtures an equation of state is meant for */
function gasLike(k) {
  if (IGV_GASES.includes(k)) return true;
  const c = compdb.get(k);
  return !!(c && /^C\d*H\d+$/.test(String(c.formula || '')));
}
function igvAdvice(c) {
  return c.water ? 'use Steam / water (IAPWS-IF97) for water and steam'
    : c.gas ? 'use Peng–Robinson (or SRK) for hydrocarbons and gases'
    : c.model === 'ideal' ? 'use Peng–Robinson (or SRK) for gases and hydrocarbons, or NRTL / UNIQUAC with a Peng–Robinson vapour for polar liquids'
    : 'set Vapour phase to Peng–Robinson';
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
  else {
    r = th.flashPT(pp, z, s.T_K, P);
    // a stream that left the last unit exactly saturated (bubble / dew point — e.g. a
    // condenser at vapour fraction 0) sits on the phase boundary, where a T–P flash can
    // fall on either side by round-off: keep the phase the stream was produced in
    const rp = s.rig && s.rig.sig === pp.pkgSig && num(s.rig.h_Jmol) ? (s.rig.phase || (s.rig.beta === 0 ? 'L' : s.rig.beta === 1 ? 'V' : null)) : null;
    if ((rp === 'L' || rp === 'V') && r.phase !== rp) r = th.flashPH(pp, z, P, s.rig.h_Jmol, s.T_K);
  }
  const h = th.hOf(pp, r);
  noteVapour(pp, r);
  if (F > 0) noteState(pp, r);
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
  if (F > 0) { noteVapour(pp, r); noteState(pp, r); }
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
          Cp_kJkgK: p.Cp_JmolK / p.MW, mu_cP: p.mu_Pas * 1000, k_WmK: p.k_WmK, sigma_mNm: num(p.sigma_Nm) ? p.sigma_Nm * 1000 : undefined, acid_gas: p.acid_gas || undefined, estimated: p.estimated || undefined })) };
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
    { pp: ppDetails(pp), T_out_K: r.T, dT_K: r.T - a.T, P_out_bar: P2 / 1e5, vapour_fraction_out: out.vapour_fraction, sizing: valveSizingData(pp, a) }, pp.warnings.slice());
}
/**
 * STEP 33 — inlet data for control-valve sizing (IEC 60534 / ISA-75.01): phase, SG or MW,
 * vapour pressure (bubble pressure at the inlet T), viscosity, k = Cp/Cv, Z and Kay's-rule
 * pseudo-critical constants. Sent with the "Size this valve" link of the flowsheet page.
 */
function valveSizingData(pp, a) {
  try {
    const pr = th.properties(pp, a.r);
    const vf = a.r.phase === 'V' ? 1 : a.r.phase === 'L' || a.r.phase === 'LL' ? 0 : a.r.beta;
    const z = a.z;
    let Tc = 0, Pc = 0, om = 0;
    for (let i = 0; i < pp.n; i++) { Tc += z[i] * pp.comps[i].Tc; Pc += z[i] * pp.comps[i].Pc; om += z[i] * (pp.comps[i].omega || 0); }
    const o = { phase: vf >= 1 - 1e-9 ? (pp.model === 'steam' || (pp.keys.length === 1 && pp.keys[0] === 'H2O') ? 'steam' : 'gas') : vf <= 1e-9 ? 'liquid' : 'two-phase',
      T_K: a.T, P_bar: a.P / 1e5, MW: pr.MW, rho_kgm3: pr.rho_kgm3, Tc_K: Tc, Pc_bar: Pc / 1e5, omega: om };
    const ph = pr.phases[0];
    if (o.phase === 'liquid') {
      o.sg = pr.rho_kgm3 / 999.0;                                  // water at 15.6 °C
      o.visc_cP = ph.mu_Pas * 1000;
      try { const b = th.flashTVF(pp, z, a.T, 0); if (b && num(b.P)) o.pv_bar = b.P / 1e5; } catch (_e) { /* supercritical or no bubble point */ }
    } else if (o.phase !== 'two-phase') {
      // ideal-gas k = Cp°/(Cp° − R), the value the sizing standards use with Z for real-gas effects
      let cp = 0;
      for (let i = 0; i < pp.n; i++) if (z[i] > 0) cp += z[i] * (pp.hig(i, a.T + 0.05) - pp.hig(i, a.T - 0.05)) / 0.1;
      o.k = cp / (cp - R);
      o.Z = ph.Z;
      o.visc_cP = ph.mu_Pas * 1000;
      if (o.phase === 'steam') { try { const sat = th.flashPVF(pp, z, a.P, 1, a.T); o.superheated = sat && num(sat.T) ? a.T > sat.T + 0.5 : true; } catch (_e) { o.superheated = true; } }
    }
    return o;
  } catch (_e) { return undefined; }
}

// ---------------------------------------------------------------------------
// pump
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// STEP 34 machine performance curves (pumps: head–flow–efficiency [–NPSHr];
// compressors: head–actual inlet flow–efficiency at a rated speed). Points are
// interpolated by monotone piecewise-cubic Hermite (Fritsch–Carlson), linearly
// beyond the ends (flagged). Another speed follows the affinity laws:
//   Q ∝ N, H ∝ N², η unchanged (the operating flow is mapped back to the
//   rated-speed curve, Q_eq = Q·N0/N, and its head scaled by (N/N0)²).
// ---------------------------------------------------------------------------
export function pchip(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  if (n > 2) {
    // three-point end slopes (shape preserving)
    const end = (h0, h1, d0, d1) => { let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(s) !== Math.sign(d0)) s = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0; return s; };
    m[0] = end(h[0], h[1], d[0], d[1]); m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let k = 0; while (k < n - 2 && x > xs[k + 1]) k++;
    const t = (x - xs[k]) / h[k], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h[k] * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h[k] * m[k + 1];
  };
}
/** validated curve: {Q[], H(), E()|null, NPSH()|null, N0, Qmin, Qmax, surge, bep} */
export function machineCurve(c, label, headKey, headUnit) {
  if (!c || typeof c !== 'object') fail('MB_CURVE', `${label}: curve must be {flow_m3_h:[…], ${headKey}:[…], efficiency?:[…]}`, 'curve');
  const Q = c.flow_m3_h, H = c[headKey], E = c.efficiency, NP = c.npshr_m;
  if (!Array.isArray(Q) || !Array.isArray(H) || Q.length < 2 || Q.length !== H.length || Q.length > 40) fail('MB_CURVE', `${label}: the curve needs 2–40 points of flow_m3_h and ${headKey} (${headUnit})`, 'curve');
  for (let i = 0; i < Q.length; i++) {
    if (!num(Q[i]) || Q[i] < 0 || !num(H[i]) || H[i] <= 0) fail('MB_CURVE', `${label}: curve point ${i + 1} — flow ≥ 0 and head > 0 required`, 'curve');
    if (i && !(Q[i] > Q[i - 1])) fail('MB_CURVE', `${label}: curve flows must increase from point to point`, 'curve');
  }
  let Ef = null, bep = null;
  if (Array.isArray(E) && E.length) {
    if (E.length !== Q.length || !E.every((v) => num(v) && v > 0 && v <= 1)) fail('MB_CURVE', `${label}: curve efficiencies must be fractions (0–1], one per point`, 'curve');
    Ef = pchip(Q, E);
    let k = 0; for (let i = 1; i < E.length; i++) if (E[i] > E[k]) k = i;
    bep = { flow_m3_h: Q[k], efficiency: E[k], head: H[k] };
  }
  let NPf = null;
  if (Array.isArray(NP) && NP.length) {
    if (NP.length !== Q.length || !NP.every((v) => num(v) && v >= 0)) fail('MB_CURVE', `${label}: npshr_m needs one value ≥ 0 per curve point`, 'curve');
    NPf = pchip(Q, NP);
  }
  const N0 = num(c.speed_rpm) && c.speed_rpm > 0 ? c.speed_rpm : null;
  const surge = num(c.surge_flow_m3_h) && c.surge_flow_m3_h > 0 ? c.surge_flow_m3_h : Q[0];
  return { Q, H: pchip(Q, H), E: Ef, NPSH: NPf, N0, Qmin: Q[0], Qmax: Q[Q.length - 1], surge, bep };
}
/** operating point on a curve at flow Qop [m³/h] and speed N (rpm; null = rated) */
export function curvePoint(cv, Qop, N, label) {
  let r = 1;
  if (num(N) && N > 0) {
    if (!cv.N0) fail('MB_CURVE', `${label}: give the curve's rated speed (curve.speed_rpm) to run at another speed`, 'speed_rpm');
    r = N / cv.N0;
  }
  const Qeq = Qop / r;
  const head = cv.H(Qeq) * r * r;
  const eta = cv.E ? Math.min(1, Math.max(0.01, cv.E(Qeq))) : null;
  return { Qeq, head, eta, speed_ratio: r, npshr: cv.NPSH ? cv.NPSH(Qeq) * r * r : null, below: Qeq < cv.Qmin, beyond: Qeq > cv.Qmax };
}

function solvePumpR(inp) {
  const { streams, params: p } = input(inp, 1, 1, 'pump');
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], 'pump inlet');
  const w = pp.warnings.slice();
  let P2 = p.curve ? null : pOut(p, streams[0].P_bar, 'pump');
  let eta = num(p.efficiency) ? p.efficiency : 0.75;
  if (!(eta > 0 && eta <= 1)) fail('MB_ETA', 'pump: efficiency must be in (0, 1]', 'efficiency');
  if (a.r.phase !== 'L') w.push(`pump: inlet is not all liquid (vapour fraction ${(a.r.phase === 'V' ? 1 : a.r.beta).toFixed(4)}) — cavitation risk; power uses the mixture volume`);
  const props = th.properties(pp, a.r);
  const Vm = props.MW / 1000 / props.rho_kgm3;                     // m3/mol
  // STEP 34: performance curve — the curve, not an outlet pressure, sets the head
  let cdet = null;
  if (p.curve) {
    const cv = machineCurve(p.curve, 'pump', 'head_m', 'm');
    const Qv0 = a.mass / props.rho_kgm3;
    const cp = curvePoint(cv, Qv0, p.speed_rpm, 'pump');
    P2 = a.P + props.rho_kgm3 * 9.80665 * cp.head;
    if (cp.eta !== null) eta = cp.eta;
    cdet = { flow_m3_h: Qv0, flow_equivalent_m3_h: cp.Qeq, head_m: cp.head, efficiency: eta, speed_ratio: cp.speed_ratio, speed_rpm: num(p.speed_rpm) ? p.speed_rpm : cv.N0 };
    if (cv.bep) { cdet.bep_flow_m3_h = cv.bep.flow_m3_h * cp.speed_ratio; cdet.percent_of_bep = 100 * cp.Qeq / cv.bep.flow_m3_h; cdet.bep_efficiency = cv.bep.efficiency; }
    if (cp.below) w.push(`pump: flow ${Qv0.toFixed(2)} m³/h is below the first curve point (${(cv.Qmin * cp.speed_ratio).toFixed(2)} m³/h at this speed) — head extrapolated; check the minimum continuous flow`);
    else if (cv.bep && cp.Qeq < 0.4 * cv.bep.flow_m3_h) w.push(`pump: operating at ${(100 * cp.Qeq / cv.bep.flow_m3_h).toFixed(0)} % of the best-efficiency flow — below the usual minimum continuous flow (≈ 40 % of BEP)`);
    if (cp.beyond) w.push(`pump: flow ${Qv0.toFixed(2)} m³/h is beyond the end of the curve (${(cv.Qmax * cp.speed_ratio).toFixed(2)} m³/h at this speed, run-out) — head extrapolated`);
    if (!(cp.head > 0)) fail('MB_CURVE', `pump: the curve gives no head at ${Qv0.toFixed(2)} m³/h — the flow is beyond the pump's shut-off / run-out`, 'curve');
    // NPSH available: (P_in − P_bubble) / ρg from the inlet liquid's bubble pressure
    try {
      const xb = a.r.phase === 'L' ? a.z : a.r.x;
      const bp = th.flashTVF(pp, xb, a.T, 0, a.P).P;
      cdet.npsha_m = (a.P - bp) / (props.rho_kgm3 * 9.80665);
      if (cp.npshr !== null) {
        cdet.npshr_m = cp.npshr;
        if (cdet.npsha_m < cp.npshr) w.push(`pump: NPSH available ${cdet.npsha_m.toFixed(2)} m is below NPSH required ${cp.npshr.toFixed(2)} m — cavitation`);
        else if (cdet.npsha_m < cp.npshr + 1) w.push(`pump: NPSH margin ${(cdet.npsha_m - cp.npshr).toFixed(2)} m is less than 1 m`);
      }
    } catch (_e) { /* NPSH informative only */ }
  }
  const dP = P2 - a.P;
  const wHyd = Vm * dP;                                              // J/mol
  const wSh = wHyd / eta;
  const r = a.F > 0 ? phFlash(pp, a.z, P2, a.h + wSh, a.T) : th.flashPT(pp, a.z, a.T, P2);
  const out = streamOut(pp, a.F, a.z, r);
  const W = a.F * wSh / KJH_PER_KW;                                  // kW
  const Qv = a.mass / props.rho_kgm3;                                // m3/h
  return result([out], a.mass, a.H_kJh, out.H_kJh, W,
    Object.assign({ pp: ppDetails(pp), power_kW: W, hydraulic_kW: a.F * wHyd / KJH_PER_KW, efficiency: eta, head_m: dP / (props.rho_kgm3 * 9.80665),
      flow_m3_h: Qv, rho_kgm3: props.rho_kgm3, dP_bar: dP / 1e5, P_out_bar: P2 / 1e5, T_out_K: r.T }, cdet ? { curve: cdet } : {}), w);
}

// ---------------------------------------------------------------------------
// compressor / expander
// ---------------------------------------------------------------------------
// Outlet pressure (P_out_bar, pressure_ratio or dp_bar) plus ONE of:
//   spec 'efficiency' (default)  efficiency → outlet state and power
//   spec 'T_out'                 measured outlet temperature T_out_K → efficiency and power
//   spec 'power'                 shaft power power_kW (absorbed by a compressor,
//                                delivered by a turbine; sign ignored) → outlet state and efficiency
// Efficiency basis: isentropic (adiabatic) or polytropic (20 equal pressure-ratio steps).

/** Pressure path of a machine: outlet h for an efficiency on the chosen basis. */
function machinePath(pp, a, P2, kind, mode) {
  const s1 = th.sOf(pp, a.r);
  const rs = th.flashPS(pp, a.z, P2, s1, a.T);
  const hs = th.hOf(pp, rs);
  const hOut = (eta) => {
    if (mode === 'isentropic') return kind === 'compressor' ? a.h + (hs - a.h) / eta : a.h - eta * (a.h - hs);
    const nst = 20, ratio = Math.pow(P2 / a.P, 1 / nst);
    let h = a.h, rr = a.r, Pk = a.P, T = a.T;
    for (let k = 0; k < nst; k++) {
      const Pn = Pk * ratio;
      const rk = th.flashPS(pp, a.z, Pn, th.sOf(pp, rr), T);
      const hk = th.hOf(pp, rk);
      h = kind === 'compressor' ? h + (hk - h) / eta : h - eta * (h - hk);
      rr = th.flashPH(pp, a.z, Pn, h, rk.T); T = rr.T; Pk = Pn;
    }
    return h;
  };
  return { rs, hs, hOut };
}

/** Efficiency on the chosen basis that gives outlet enthalpy h2 (isentropic: closed form). */
function etaFor(path, a, h2, kind, mode, label) {
  const dhs = path.hs - a.h, dh = h2 - a.h;
  if (kind === 'compressor' ? !(dh > 0) : !(dh < 0)) {
    fail('MB_MACHINE_SPEC', `${label}: the specification gives ${kind === 'compressor' ? 'no enthalpy rise' : 'no enthalpy drop'} across the machine — check the outlet temperature or power`, 'params');
  }
  const etaIs = kind === 'compressor' ? dhs / dh : dh / dhs;
  if (mode === 'isentropic' || !(etaIs > 0 && etaIs <= 1)) return etaIs;
  // polytropic: the outlet h is monotonic in η — bisection. A compressor's polytropic
  // efficiency lies above its isentropic one, a turbine's below (the reheat factor)
  const f = (e) => path.hOut(e) - h2;
  let lo = kind === 'compressor' ? etaIs * (1 - 1e-9) : Math.max(0.02, 0.4 * etaIs);
  let hi = kind === 'compressor' ? 1.0 : Math.min(1, etaIs * (1 + 1e-9));
  const flo = f(lo), fhi = f(hi);
  if ((flo < 0) === (fhi < 0)) return Math.abs(fhi) < Math.abs(flo) ? (hi >= 1 ? 1.0001 : hi) : NaN;     // beyond η = 1 → reported as impossible
  for (let k = 0; k < 60; k++) {
    const m = 0.5 * (lo + hi), fm = f(m);
    if ((fm < 0) === (flo < 0)) lo = m; else hi = m;
    if (hi - lo < 1e-10) break;
  }
  return 0.5 * (lo + hi);
}

function machine(inp, kind) {
  const label = kind === 'expander' ? 'turbine' : kind;
  const { streams, params: p } = input(inp, 1, 1, label);
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], `${label} inlet`);
  const w = pp.warnings.slice();
  let P2, cdet = null, curveEta = null;
  if (kind === 'compressor' && p.curve) {
    // STEP 34: performance curve — head and efficiency at the actual inlet flow set the discharge pressure
    const cv = machineCurve(p.curve, label, 'head_kJkg', 'kJ/kg');
    const rho = th.properties(pp, a.r).rho_kgm3;
    const Qv0 = a.mass / rho;
    const cp = curvePoint(cv, Qv0, p.speed_rpm, label);
    const htype = p.curve.head_type === 'isentropic' ? 'isentropic' : p.curve.head_type === 'polytropic' ? 'polytropic' : (p.mode === 'isentropic' ? 'isentropic' : 'polytropic');
    curveEta = cp.eta !== null ? cp.eta : (num(p.efficiency) ? p.efficiency : 0.75);
    if (!(cp.head > 0)) fail('MB_CURVE', `${label}: the curve gives no head at ${Qv0.toFixed(1)} m³/h (beyond stonewall)`, 'curve');
    if (!(a.mass > 0)) fail('MB_CURVE', `${label}: a performance curve needs a flowing inlet`, 'streams');
    const perKg = a.F / a.mass;                                   // kmol/kg: J/mol × kmol/kg = kJ/kg
    const headAt = (P) => {
      const pa = machinePath(pp, a, P, kind, htype);
      return htype === 'isentropic' ? (pa.hs - a.h) * perKg : curveEta * (pa.hOut(curveEta) - a.h) * perKg;
    };
    // discharge pressure: head rises monotonically with ln P — bracket, then Illinois
    let lo = Math.log(a.P * 1.0001), hi = Math.log(a.P * 1.5), flo = -cp.head, fhi = headAt(Math.exp(hi)) - cp.head;
    for (let k = 0; k < 40 && fhi < 0; k++) { lo = hi; flo = fhi; hi += 0.5; fhi = headAt(Math.exp(hi)) - cp.head; }
    if (!(fhi >= 0)) fail('MB_CURVE', `${label}: no discharge pressure gives the curve head ${cp.head.toFixed(1)} kJ/kg`, 'curve');
    let side = 0, u = hi;
    for (let k = 0; k < 60; k++) {
      u = (lo * fhi - hi * flo) / (fhi - flo);
      const fu = headAt(Math.exp(u)) - cp.head;
      if (Math.abs(fu) < 1e-9 * cp.head || hi - lo < 1e-12) break;
      if ((fu < 0) === (flo < 0)) { lo = u; flo = fu; if (side === -1) fhi *= 0.5; side = -1; } else { hi = u; fhi = fu; if (side === 1) flo *= 0.5; side = 1; }
    }
    P2 = Math.exp(u);
    const surgeEq = cv.surge;
    cdet = { flow_m3_h: Qv0, flow_equivalent_m3_h: cp.Qeq, head_kJkg: cp.head, head_type: htype, efficiency: curveEta, speed_ratio: cp.speed_ratio,
      speed_rpm: num(p.speed_rpm) ? p.speed_rpm : cv.N0, surge_flow_m3_h: surgeEq * cp.speed_ratio, surge_margin_pct: 100 * (cp.Qeq - surgeEq) / surgeEq,
      surge: cp.Qeq < surgeEq, stonewall: cp.beyond };
    if (cv.bep) cdet.percent_of_bep = 100 * cp.Qeq / cv.bep.flow_m3_h;
    if (cp.Qeq < surgeEq) w.push(`${label}: SURGE — inlet flow ${Qv0.toFixed(0)} m³/h is below the surge flow ${(surgeEq * cp.speed_ratio).toFixed(0)} m³/h at this speed; open the anti-surge recycle or reduce speed`);
    else if (cdet.surge_margin_pct < 10) w.push(`${label}: surge margin ${cdet.surge_margin_pct.toFixed(1)} % (below the usual 10 %)`);
    if (cp.beyond) w.push(`${label}: inlet flow ${Qv0.toFixed(0)} m³/h is beyond the last curve point (${(cv.Qmax * cp.speed_ratio).toFixed(0)} m³/h at this speed) — stonewall region, head extrapolated`);
  } else if (num(p.pressure_ratio)) P2 = a.P * (kind === 'compressor' ? p.pressure_ratio : 1 / p.pressure_ratio);
  else P2 = pOut(p, streams[0].P_bar, label);
  if (kind === 'compressor' && P2 <= a.P) fail('MB_P', 'compressor: outlet pressure must exceed inlet pressure', 'P_out_bar');
  if (kind === 'expander' && P2 >= a.P) fail('MB_P', 'turbine: outlet pressure must be below inlet pressure', 'P_out_bar');
  const mode = cdet ? cdet.head_type : p.mode === 'polytropic' ? 'polytropic' : 'isentropic';
  const spec = cdet ? 'efficiency' : p.spec === 'T_out' || p.spec === 'power' ? p.spec : 'efficiency';
  if (a.r.phase !== 'V') w.push(`${label}: inlet contains liquid (vapour fraction ${(a.r.phase === 'L' ? 0 : a.r.beta).toFixed(4)})`);
  const path = machinePath(pp, a, P2, kind, mode);
  let eta, h2, r;
  if (spec === 'efficiency') {
    eta = curveEta !== null ? curveEta : num(p.efficiency) ? p.efficiency : 0.75;
    if (!(eta > 0 && eta <= 1)) fail('MB_ETA', `${label}: efficiency must be in (0, 1]`, 'efficiency');
    h2 = path.hOut(eta);
    r = th.flashPH(pp, a.z, P2, h2, path.rs.T);
  } else {
    if (!(a.F > 0)) fail('MB_MACHINE_SPEC', `${label}: a zero-flow inlet cannot fix the efficiency from ${spec === 'power' ? 'power' : 'outlet temperature'}`, 'params');
    if (spec === 'T_out') {
      if (!num(p.T_out_K) || p.T_out_K <= 0) fail('MB_T', `${label}: outlet temperature T_out_K required for spec 'T_out'`, 'T_out_K');
      r = th.flashPT(pp, a.z, p.T_out_K, P2);
      if (r.phase !== 'V' && r.phase !== 'L') {
        fail('MB_MACHINE_SPEC', `${label}: ${(p.T_out_K - 273.15).toFixed(2)} °C is the saturation temperature at the outlet pressure — the outlet is wet and its temperature does not fix the state; give the efficiency or the power instead`, 'T_out_K');
      }
      h2 = th.hOf(pp, r);
    } else {
      if (!num(p.power_kW) || p.power_kW === 0) fail('MB_MACHINE_SPEC', `${label}: shaft power power_kW required for spec 'power'`, 'power_kW');
      const Wmag = Math.abs(p.power_kW);
      h2 = a.h + (kind === 'compressor' ? 1 : -1) * Wmag * KJH_PER_KW / a.F;
      r = th.flashPH(pp, a.z, P2, h2, path.rs.T);
    }
    eta = etaFor(path, a, h2, kind, mode, label);
    if (!(eta > 0) || eta > 1 + 1e-9) {
      fail('MB_MACHINE_SPEC', `${label}: the ${spec === 'power' ? 'power' : 'outlet temperature'} given implies ${num(eta) ? `an ${mode} efficiency of ${(eta * 100).toFixed(1)} %` : `an ${mode} efficiency outside 5–100 %`} — not physically possible (the ideal machine gives ${(Math.abs(a.F * (path.hs - a.h)) / KJH_PER_KW).toFixed(1)} kW${kind === 'compressor' ? ' absorbed' : ''})`, spec === 'power' ? 'power_kW' : 'T_out_K');
    }
  }
  const out = streamOut(pp, a.F, a.z, r);
  if (out.vapour_fraction < 1 - 1e-9) w.push(`${label}: outlet is two-phase (vapour fraction ${out.vapour_fraction.toFixed(4)})`);
  if (kind === 'expander' && out.vapour_fraction < 0.88 && out.vapour_fraction > 0) w.push(`turbine: exhaust wetness ${((1 - out.vapour_fraction) * 100).toFixed(1)} % exceeds the usual 12 % blade-erosion limit`);
  const W = (out.H_kJh - a.H_kJh) / KJH_PER_KW;          // from the converged outlet state: the energy balance closes exactly
  const props = out.rig.props && out.rig.props.phases[0];
  const etaIs = (kind === 'compressor' ? (path.hs - a.h) / (h2 - a.h) : (a.h - h2) / (a.h - path.hs));
  const det = { pp: ppDetails(pp), spec, power_kW: W, mode, efficiency: eta, isentropic_efficiency: etaIs, pressure_ratio: P2 / a.P, P_out_bar: P2 / 1e5,
    T_out_K: r.T, T_isentropic_K: path.rs.T, vapour_fraction_out: out.vapour_fraction, vapour_fraction_isentropic: path.rs.phase === 'V' ? 1 : path.rs.phase === 'L' ? 0 : path.rs.beta,
    isentropic_power_kW: a.F * (path.hs - a.h) / KJH_PER_KW, head_kJkg: (h2 - a.h) / (out.mass_flow_kg_h > 0 ? out.mass_flow_kg_h / a.F : 1),
    dh_kJkg: a.mass > 0 ? (h2 - a.h) * a.F / a.mass : null,
    inlet_volume_m3_h: (() => { try { const pr = th.properties(pp, a.r); return a.mass / pr.rho_kgm3; } catch (_e) { return null; } })(),
    Z_out: props ? props.Z : null };
  if (kind === 'expander' && W < 0) det.steam_rate_kg_kWh = a.mass / -W;     // specific steam (or gas) consumption
  if (cdet) det.curve = cdet;
  return result([out], a.mass, a.H_kJh, out.H_kJh, W, det, w);
}
const solveCompressor = (inp) => machine(inp, 'compressor');
const solveExpander = (inp) => machine(inp, 'expander');

// ---------------------------------------------------------------------------
// extraction turbine — HP section to the extraction pressure, a controlled
// extraction (bleed) of part of the flow, LP section to the exhaust pressure.
// Outlets: [0] extraction steam, [1] exhaust. Each section has its own
// isentropic efficiency (efficiency_hp / efficiency_lp, or one efficiency for both).
// Extraction amount: extraction_kg_h, or extraction_fraction of the inlet mass.
// ---------------------------------------------------------------------------
function solveExtractionTurbine(inp) {
  const label = 'extraction turbine';
  const { streams, params: p } = input(inp, 1, 1, label);
  const pp = pkg(p.property_package, keysOf(...streams));
  const a = stateIn(pp, streams[0], `${label} inlet`);
  const w = pp.warnings.slice();
  if (!num(p.P_extract_bar) || p.P_extract_bar <= 0) fail('MB_P', `${label}: extraction pressure P_extract_bar required`, 'P_extract_bar');
  const Pe = p.P_extract_bar * 1e5;
  const P2 = pOut(p, streams[0].P_bar, label);
  if (!(Pe < a.P)) fail('MB_P', `${label}: extraction pressure must be below the inlet pressure`, 'P_extract_bar');
  if (!(P2 < Pe)) fail('MB_P', `${label}: exhaust pressure must be below the extraction pressure`, 'P_out_bar');
  const e1 = num(p.efficiency_hp) ? p.efficiency_hp : num(p.efficiency) ? p.efficiency : 0.8;
  const e2 = num(p.efficiency_lp) ? p.efficiency_lp : num(p.efficiency) ? p.efficiency : 0.8;
  for (const [e, k] of [[e1, 'efficiency_hp'], [e2, 'efficiency_lp']]) if (!(e > 0 && e <= 1)) fail('MB_ETA', `${label}: ${k === 'efficiency_hp' ? 'HP' : 'LP'} section efficiency must be in (0, 1]`, k);
  let mx;
  if (num(p.extraction_kg_h)) mx = p.extraction_kg_h;
  else if (num(p.extraction_fraction)) mx = p.extraction_fraction * a.mass;
  else fail('MB_EXTRACTION', `${label}: give the extraction flow (extraction_kg_h) or the extracted fraction of the inlet (extraction_fraction)`, 'extraction_kg_h');
  if (!(mx >= 0) || mx > a.mass * (1 + 1e-12)) fail('MB_EXTRACTION', `${label}: extraction must be between 0 and the inlet flow (${a.mass.toFixed(3)} kg/h)`, 'extraction_kg_h');
  mx = Math.min(mx, a.mass);
  if (a.r.phase !== 'V') w.push(`${label}: inlet contains liquid (vapour fraction ${(a.r.phase === 'L' ? 0 : a.r.beta).toFixed(4)})`);
  // HP section
  const rsE = th.flashPS(pp, a.z, Pe, th.sOf(pp, a.r), a.T);
  const hsE = th.hOf(pp, rsE);
  const hE = a.h - e1 * (a.h - hsE);
  const rE = th.flashPH(pp, a.z, Pe, hE, rsE.T);
  // LP section from the extraction-stage state
  const rs2 = th.flashPS(pp, a.z, P2, th.sOf(pp, rE), rE.T);
  const hs2 = th.hOf(pp, rs2);
  const h2 = hE - e2 * (hE - hs2);
  const r2 = th.flashPH(pp, a.z, P2, h2, rs2.T);
  const fx = a.mass > 0 ? mx / a.mass : 0;
  const Fx = a.F * fx, Fl = a.F - Fx;
  const outX = streamOut(pp, Fx, a.z, rE);
  const outL = streamOut(pp, Fl, a.z, r2);
  const W = (outX.H_kJh + outL.H_kJh - a.H_kJh) / KJH_PER_KW;      // from the converged outlet states
  const Whp = a.F * (th.hOf(pp, rE) - a.h) / KJH_PER_KW, Wlp = W - Whp;
  if (outX.vapour_fraction < 1 - 1e-9) w.push(`${label}: extraction steam is wet (vapour fraction ${outX.vapour_fraction.toFixed(4)})`);
  if (outL.vapour_fraction < 0.88 && outL.vapour_fraction > 0) w.push(`${label}: exhaust wetness ${((1 - outL.vapour_fraction) * 100).toFixed(1)} % exceeds the usual 12 % blade-erosion limit`);
  if (Fl <= 0) w.push(`${label}: all the steam is extracted — the LP section carries no flow`);
  return result([outX, outL], a.mass, a.H_kJh, outX.H_kJh + outL.H_kJh, W,
    { pp: ppDetails(pp), power_kW: W, power_hp_kW: Whp, power_lp_kW: Wlp, efficiency_hp: e1, efficiency_lp: e2,
      extraction_kg_h: mx, extraction_fraction: fx, exhaust_kg_h: a.mass - mx,
      P_extract_bar: Pe / 1e5, P_out_bar: P2 / 1e5, T_extract_K: rE.T, T_out_K: r2.T,
      T_extract_isentropic_K: rsE.T, T_out_isentropic_K: rs2.T,
      vapour_fraction_extract: outX.vapour_fraction, vapour_fraction_out: outL.vapour_fraction,
      dh_hp_kJkg: a.mass > 0 ? (hE - a.h) * a.F / a.mass : null, dh_lp_kJkg: a.mass > 0 ? (h2 - hE) * a.F / a.mass : null,
      steam_rate_kg_kWh: W < 0 ? a.mass / -W : null }, w);
}

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
  if (!(f.F > 0)) {
    // every inlet empty (e.g. liquid outlets of all-vapour knock-out drums): an empty outlet at the
    // inlets' mean temperature and average composition, so downstream units keep a valid state
    const zz = pp.keys.map((_, i) => st.reduce((a, s) => a + (num(s.z[i]) ? s.z[i] : 0), 0) / st.length);
    const zs = zz.reduce((a, v) => a + v, 0) || 1;
    const z0 = zz.map((v) => v / zs);
    const T0 = num(p.T_out_K) ? p.T_out_K : st.reduce((a, s) => a + s.T, 0) / st.length;
    const r0 = th.flashPT(pp, z0, T0, P);
    const out0 = streamOut(pp, 0, z0, r0);
    return result([out0], f.mass, f.H_kJh, out0.H_kJh, 0, { pp: ppDetails(pp), T_out_K: r0.T, P_out_bar: P / 1e5, duty_kW: 0,
      vapour_fraction_out: out0.vapour_fraction }, pp.warnings.concat(['r-mixer: all inlets are empty — empty outlet']));
  }
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
    let dTmin = Infinity, UA = 0, prev = null, hP = hot.r, cP = rc;
    for (let k = 0; k <= NZ; k++) {
      const q = dq * k / NZ;           // heat transferred from hot inlet end
      // each zone's flash starts from the neighbouring zone's answer (STEP 30)
      if (k > 0 && k < NZ) hP = th.flashPH(pp, hot.z, hot.P + (Ph - hot.P) * k / NZ, hot.h - q / hot.F, hP.T, hP);
      const Th = k === 0 ? hot.T : k === NZ ? rh.T : hP.T;
      // cold at the same location has received (dq − q) counted from its inlet
      const qc = dq - q;
      if (k > 0 && k < NZ) cP = th.flashPH(pp, cold.z, cold.P + (Pc - cold.P) * (NZ - k) / NZ, cold.h + qc / cold.F, cP.T, cP);
      const Tc = k === NZ ? cold.T : k === 0 ? rc.T : cP.T;
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
function gibbsEquilibrium(pp, nIn, T, P, keysAllowed, opt) {
  const o = opt || {};
  const n = pp.n;
  const act = pp.keys.map((k) => keysAllowed.includes(k));
  const El = [...new Set(pp.keys.flatMap((k, i) => (act[i] || nIn[i] > 0 ? Object.keys(elements(k) || {}) : [])))];
  const A = El.map((e) => pp.keys.map((k) => (elements(k) || {})[e] || 0));
  const b0 = El.map((e, r) => A[r].reduce((s, a, i) => s + a * nIn[i], 0) - (e === 'C' && num(o.carbonOut) ? o.carbonOut : 0));
  const E = El.length;
  // STEP 33: standard potentials at the equilibrium temperature (temperature approach) plus
  // ln φ of the vapour from the property method (held fixed during this solve)
  const Teq = num(o.Teq) ? o.Teq : T;
  const mu0 = pp.comps.map((c, i) => (pp.hig(i, Teq) - Teq * pp.sig(i, Teq)) / (R * Teq) + (o.lnphi ? o.lnphi[i] : 0));
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

// ---------------------------------------------------------------------------
// STEP 33 — equilibrium core shared by the Gibbs reactor and the syngas units
// (mb-syngas.js): fugacity coefficients from the property method, temperature
// approaches, restricted equilibrium by reactions, and solid carbon.
// ---------------------------------------------------------------------------

// Graphite, C(gr): NASA TM-4513 (McBride, Gordon & Reno 1993) 7-coefficient
// polynomials, 200–1000–5000 K; H(298.15 K) = 0, S°(298.15 K) = 5.734 J/(mol K).
const C_GR = { Tmid: 1000,
  lo: [-0.310872072, 4.40353686e-03, 1.90394118e-06, -6.38546966e-09, 2.98964248e-12, -108.650794, 1.11382953],
  hi: [1.45571829, 1.71702216e-03, -6.97562786e-07, 1.35277032e-10, -9.67590652e-15, -695.138814, -8.52583033] };
/** graphite H [J/mol] (formation basis, 0 at 298.15 K) and S [J/(mol K)] at T */
export function graphite(T) {
  const Tc = Math.min(Math.max(T, 200), 5000);
  const a = Tc < C_GR.Tmid ? C_GR.lo : C_GR.hi;
  const t = Tc;
  const H = R * t * (a[0] + a[1] * t / 2 + a[2] * t * t / 3 + a[3] * t ** 3 / 4 + a[4] * t ** 4 / 5 + a[5] / t);
  const S = R * (a[0] * Math.log(t) + a[1] * t + a[2] * t * t / 2 + a[3] * t ** 3 / 3 + a[4] * t ** 4 / 4 + a[6]);
  return { H, S, mu: H - T * S };
}

/** true when the package's vapour is not an ideal gas (EOS vapour or associating vapour) */
function hasRealVapour(pp) { return !!pp.eos || !!pp.association; }
/** ln φ of a vapour of composition y from the package (zeros for an ideal-gas vapour) */
function vapLnPhi(pp, T, P, y) {
  if (!hasRealVapour(pp)) return new Array(pp.n).fill(0);
  try { const l = pp.lnFug(T, P, y, 'V'); return l.every(Number.isFinite) ? l : new Array(pp.n).fill(0); } catch (_e) { return new Array(pp.n).fill(0); }
}

/**
 * Gibbs-energy minimisation with the options of a commercial RGibbs:
 *   opt.fugacity  true → μ_i = μ°_i + RT ln(y_i φ_i P/P°), φ from the property
 *                 method's vapour (successive substitution on ln φ)
 *   opt.approach_K equilibrium evaluated at T + ΔT (energy balance stays at T)
 *   opt.carbon    true → solid graphite may form (unit activity); the element
 *                 potential of carbon is held at μ°_C(gr)/RT when it does
 * Always returns the carbon activity a_C = exp(π_C − μ°_C(gr)/RT) of the gas.
 */
export function gibbsSolve(pp, nIn, T, P, allowed, opt) {
  const o = opt || {};
  const Teq = T + (num(o.approach_K) ? o.approach_K : 0);
  const useFug = o.fugacity !== false && hasRealVapour(pp);
  const iC = (() => { const El = new Set(pp.keys.flatMap((k, i) => (allowed.includes(k) || nIn[i] > 0 ? Object.keys(elements(k) || {}) : []))); return El.has('C') ? [...El].indexOf('C') : -1; })();
  const muGr = graphite(Teq).mu / (R * Teq);
  const atCarbon = (nC) => {
    let lnphi = new Array(pp.n).fill(0), g = null, k;
    for (k = 0; k < (useFug ? 60 : 1); k++) {
      g = gibbsEquilibrium(pp, nIn, T, P, allowed, { Teq, lnphi, carbonOut: nC });
      if (!useFug) break;
      const F = g.n.reduce((a, v) => a + v, 0);
      const y = g.n.map((v) => v / F);
      const ln2 = vapLnPhi(pp, T, P, y);
      let d = 0; for (let i = 0; i < pp.n; i++) if (allowed.includes(pp.keys[i]) || nIn[i] > 0) d = Math.max(d, Math.abs(ln2[i] - lnphi[i]));
      lnphi = ln2;
      if (d < 1e-10) break;
    }
    const piC = iC >= 0 && g.elements.indexOf('C') >= 0 ? g.lambda[g.elements.indexOf('C')] : NaN;
    return { g, lnphi, lnaC: piC - muGr, fugIt: k + 1 };
  };
  let res = atCarbon(0), nC = 0;
  const bC = pp.keys.reduce((a, kk, i) => a + ((elements(kk) || {}).C || 0) * nIn[i], 0);
  if (o.carbon && num(res.lnaC) && res.lnaC > 1e-10 && bC > 0) {
    // carbon deposits until the gas is at unit carbon activity: ln a_C(n_C) falls monotonically
    // bracket: step toward the total carbon until the gas falls below unit activity
    let lo = 0, flo = res.lnaC, hi = 0.5 * bC, rh = atCarbon(hi), fhi = rh.lnaC, side = 0;
    for (let k = 0; k < 40 && num(fhi) && fhi > 0; k++) { lo = hi; flo = fhi; hi = hi + 0.5 * (bC - hi); rh = atCarbon(hi); fhi = rh.lnaC; }
    if (!(num(fhi) && fhi < 0)) { nC = lo; res = lo > 0 ? atCarbon(lo) : res; }
    else {
      for (let it = 0; it < 100; it++) {
        let m = lo - flo * (hi - lo) / (fhi - flo);
        if (!(m > lo && m < hi)) m = 0.5 * (lo + hi);
        const rm = atCarbon(m);
        if (rm.lnaC > 0) { lo = m; flo = rm.lnaC; if (side === -1) fhi *= 0.5; side = -1; } else { hi = m; fhi = rm.lnaC; if (side === 1) flo *= 0.5; side = 1; }
        nC = m; res = rm;
        if (Math.abs(rm.lnaC) < 1e-9 || hi - lo < 1e-14 * bC) break;
      }
    }
  }
  return { n: res.g.n, nC, carbonActivity: num(res.lnaC) ? Math.exp(nC > 0 ? 0 : res.lnaC) : null, carbonActivityGas: num(res.lnaC) ? Math.exp(res.lnaC) : null,
    converged: res.g.converged, iterations: res.g.iterations, fugIterations: res.fugIt, elements: res.g.elements, lambda: res.g.lambda, lnphi: res.lnphi, Teq };
}

/**
 * Restricted chemical equilibrium (a commercial REquil, or RGibbs with
 * specified reactions): extents ξ_r of the given reactions such that
 *   Σ_i ν_ir ln(y_i φ_i P/P°) = ln K_r(T + ΔT_r),  ln K_r = −Σ_i ν_ir μ°_i(T_r)/RT_r.
 * Newton on the convex function G̃(ξ) = Σ_r ξ_r ΔG°_r/RT_r + Σ_i n_i ln(n_i P/(N P°))
 * (+ Σ n_i ln φ_i with φ held fixed, refreshed in an outer loop), whose
 * gradient is that residual, with a step kept inside n_i ≥ 0 and an Armijo
 * line search — converges from any interior start. Species absent from the
 * feed but formed by a reaction are seeded at 1e-12 of the flow.
 * reactions: [{ stoich: {key: ν}, approach_K?, fixed_extent? }]
 * @returns {{n:number[], xi:number[], converged:boolean, iterations:number, lnK:number[], lnQ:number[]}}
 */
export function equilReactions(pp, nIn, T, P, reactions, opt) {
  const o = opt || {};
  const useFug = o.fugacity !== false && hasRealVapour(pp);
  const nS = pp.n, NR = reactions.length;
  const nu = reactions.map((rx) => { const v = new Array(nS).fill(0); for (const [k, c] of Object.entries(rx.stoich || {})) { const i = pp.index[k]; if (i === undefined) fail('MB_RXN', `reaction species '${k}' is not in the component list`, 'reactions'); v[i] += c; } return v; });
  const dnu = nu.map((v) => v.reduce((a, b) => a + b, 0));
  const Tr = reactions.map((rx) => T + (num(rx.approach_K) ? rx.approach_K : 0));
  const dG = nu.map((v, r) => { let g = 0; for (let i = 0; i < nS; i++) if (v[i]) g += v[i] * (pp.hig(i, Tr[r]) - Tr[r] * pp.sig(i, Tr[r])); return g / (R * Tr[r]); });
  const N0 = nIn.reduce((a, b) => a + b, 0) || 1;
  const n0 = nIn.slice();
  for (let i = 0; i < nS; i++) if (!(n0[i] > 0) && nu.some((v) => v[i] !== 0)) n0[i] = 1e-12 * N0;
  const lnPP = Math.log(P / th.P0);
  const fixed = reactions.map((rx) => num(rx.fixed_extent));
  // extents are accumulated on a moving base composition (nb): every accepted step is folded
  // into nb, so a species driven to 1e-14 of the flow (CO in a methanator) is carried as its
  // own small number instead of the difference of two large ones
  let nb = n0.slice();
  const xi = new Array(NR).fill(0);
  const molesAt = (x) => { const m = nb.slice(); for (let r = 0; r < NR; r++) if (x[r]) for (let i = 0; i < nS; i++) if (nu[r][i]) m[i] += nu[r][i] * x[r]; return m; };
  const fold = (x) => { nb = molesAt(x); for (let r = 0; r < NR; r++) xi[r] += x[r]; };
  { const x0 = reactions.map((rx) => (num(rx.fixed_extent) ? rx.fixed_extent : 0)); if (x0.some((v) => v)) { if (molesAt(x0).some((v) => v < 0)) fail('MB_RXN', 'fixed reaction extent exceeds the feed', 'reactions'); fold(x0); } }
  let lnphi = new Array(nS).fill(0);
  const Gt = (x) => { const m = molesAt(x); if (m.some((v) => v < 0)) return Infinity; const N = m.reduce((a, b) => a + b, 0); let g = 0; for (let r = 0; r < NR; r++) g += x[r] * dG[r]; for (let i = 0; i < nS; i++) if (m[i] > 0) g += m[i] * (Math.log(m[i] / N) + lnPP + lnphi[i]); return g; };
  const grad = (m) => { const N = m.reduce((a, b) => a + b, 0); return nu.map((v, r) => { let s = dG[r]; for (let i = 0; i < nS; i++) if (v[i]) s += v[i] * (Math.log(Math.max(m[i], 1e-300) / N) + lnPP + lnphi[i]); return s; }); };
  const zero = new Array(NR).fill(0);
  let it = 0, conv = false, outer;
  for (outer = 0; outer < (useFug ? 40 : 1); outer++) {
    for (let k = 0; k < 200; k++, it++) {
      const m = nb, N = m.reduce((a, b) => a + b, 0);
      const F = grad(m);
      let fmax = 0; for (let r = 0; r < NR; r++) if (!fixed[r]) fmax = Math.max(fmax, Math.abs(F[r]));
      if (fmax < 1e-10) { conv = true; break; }
      const H = [];
      for (let r = 0; r < NR; r++) {
        H.push(new Array(NR).fill(0));
        for (let q = 0; q < NR; q++) { let h = -dnu[r] * dnu[q] / N; for (let i = 0; i < nS; i++) if (nu[r][i] && nu[q][i]) h += nu[r][i] * nu[q][i] / Math.max(m[i], 1e-300); H[r][q] = h; }
      }
      for (let r = 0; r < NR; r++) if (fixed[r]) { for (let q = 0; q < NR; q++) H[r][q] = H[q][r] = 0; H[r][r] = 1; F[r] = 0; }
      for (let r = 0; r < NR; r++) H[r][r] += 1e-14 * Math.max(1, Math.abs(H[r][r]));
      const d = gauss(H, F.map((v) => -v));
      if (!d || !d.every(Number.isFinite)) break;
      // largest step keeping every species positive (99 % of the way to the boundary)
      let amax = 1;
      for (let i = 0; i < nS; i++) { let dn = 0; for (let r = 0; r < NR; r++) dn += nu[r][i] * d[r]; if (dn < 0) amax = Math.min(amax, -0.99 * m[i] / dn); }
      const g0 = Gt(zero); let a = amax, slope = 0; for (let r = 0; r < NR; r++) slope += F[r] * d[r];
      let moved = false;
      for (let ls = 0; ls < 60; ls++) {
        const x2 = d.map((v) => a * v);
        const g2 = Gt(x2);
        // near the solution G̃ is flat to round-off: accept a Newton step that lowers the gradient instead
        const flat = Math.abs(g2 - g0) <= 1e-13 * Math.max(1, Math.abs(g0));
        if (g2 <= g0 + 1e-4 * a * slope || (flat && Math.max(...grad(molesAt(x2)).map((v, r) => (fixed[r] ? 0 : Math.abs(v)))) < fmax)) { fold(x2); moved = true; break; }
        a *= 0.5;
      }
      if (!moved) break;
    }
    if (!useFug) break;
    const N = nb.reduce((a, b) => a + b, 0);
    const ln2 = vapLnPhi(pp, T, P, nb.map((v) => v / N));
    let dd = 0; for (let i = 0; i < nS; i++) dd = Math.max(dd, Math.abs(ln2[i] - lnphi[i]));
    lnphi = ln2;
    if (dd < 1e-10 && conv) break;
    conv = false;
  }
  if (useFug && !conv) {      // the last φ refresh moved the answer: accept if the residual is still small
    const F = grad(nb); conv = F.every((v, r) => fixed[r] || Math.abs(v) < 1e-8);
  }
  const molesFinal = nb;
  const nOut = molesFinal.map((v, i) => (nIn[i] > 0 || v > 1e-11 * N0 ? Math.max(v, 0) : 0));
  const N = nOut.reduce((a, b) => a + b, 0);
  const lnQ = nu.map((v) => { let q = 0; for (let i = 0; i < nS; i++) if (v[i]) q += v[i] * (Math.log(Math.max(nOut[i], 1e-300) / N) + lnPP + lnphi[i]); return q; });
  return { n: nOut, xi, converged: conv, iterations: it, lnK: dG.map((g) => -g), lnQ, lnphi, Teq: Tr };
}

/** Illinois-regula-falsi search for the outlet T where f(T) = 0 (energy balance), with an expanding bracket */
export function solveEnergyT(f, Tguess, Tmin, Tmax, label) {
  let a = Math.max(Tmin, Math.min(Tmax, Tguess - 50)), b = Math.min(Tmax, Math.max(Tmin, Tguess + 50));
  let fa = f(a), fb = f(b);
  for (let k = 0; k < 40 && fa * fb > 0; k++) {
    if (Math.abs(fa) < Math.abs(fb)) { a = Math.max(Tmin, a - (b - a)); fa = f(a); } else { b = Math.min(Tmax, b + (b - a)); fb = f(b); }
    if (a <= Tmin && b >= Tmax && fa * fb > 0) break;
  }
  if (fa * fb > 0) fail('MB_ENERGY_T', `${label}: no outlet temperature between ${Tmin.toFixed(0)} and ${Tmax.toFixed(0)} K satisfies the energy balance`, 'params');
  let side = 0, c = a, fc = fa;
  for (let it = 0; it < 100; it++) {
    c = (a * fb - b * fa) / (fb - fa);
    if (!(c > Math.min(a, b) && c < Math.max(a, b))) c = 0.5 * (a + b);
    fc = f(c);
    if (Math.abs(fc) < 1e-7 * Math.max(1, Math.abs(fa), Math.abs(fb)) || Math.abs(b - a) < 1e-5) break;
    if (fc * fb < 0) { a = b; fa = fb; b = c; fb = fc; side = 0; }
    else { b = c; fb = fc; if (side === 1) fa *= 0.5; side = 1; }
  }
  return c;
}

/**
 * Carbon activities of a gas by the three carbon-forming reactions used in
 * reformer and shift practice (principle of the equilibrated gas, Rostrup-Nielsen):
 *   CH4 ⇌ C + 2 H2,  2 CO ⇌ C + CO2,  CO + H2 ⇌ C + H2O,
 *   a_C = K_r(T) · Π (y_i φ_i P/P°)^(−ν_i) over the gas species.
 * A value above 1 means graphite is thermodynamically favoured.
 */
export function carbonActivities(pp, n, T, P, lnphi) {
  const N = n.reduce((a, b) => a + b, 0);
  if (!(N > 0)) return null;
  const muGr = graphite(T).mu / (R * T), lnPP = Math.log(P / th.P0);
  const lnf = (k) => { const i = pp.index[k]; if (i === undefined || !(n[i] > 0)) return null; return Math.log(n[i] / N) + lnPP + (lnphi ? lnphi[i] : 0); };
  const mu0 = (k) => { const i = pp.index[k]; return (pp.hig(i, T) - T * pp.sig(i, T)) / (R * T); };
  const out = {};
  const rx = [['CH4 = C + 2H2', { CH4: 1 }, { H2: 2 }], ['2CO = C + CO2', { CO: 2 }, { CO2: 1 }], ['CO + H2 = C + H2O', { CO: 1, H2: 1 }, { H2O: 1 }]];
  for (const [name, re, pr] of rx) {
    let ok = true, lnA = -muGr, g = 0;
    for (const [k, v] of Object.entries(re)) { const f = lnf(k); if (f === null) { ok = false; break; } lnA += v * f; g += v * mu0(k); }
    if (!ok) continue;
    for (const [k, v] of Object.entries(pr)) { const f = lnf(k); if (f === null) { ok = false; break; } lnA -= v * f; g -= v * mu0(k); }
    if (!ok) continue;
    out[name] = Math.exp(lnA + g);
  }
  return Object.keys(out).length ? out : null;
}

/** parse and check params.reactions for the restricted-equilibrium mode */
function equilRxns(p, pp, unit) {
  if (!Array.isArray(p.reactions) || !p.reactions.length) return null;
  return p.reactions.map((rx, r) => {
    if (!rx || typeof rx.stoich !== 'object') fail('MB_RXN', `${unit}: reactions[${r}].stoich {key: coefficient} is required`, 'reactions');
    const bal = {};
    for (const [k, v] of Object.entries(rx.stoich)) {
      if (!num(v)) fail('MB_RXN', `${unit}: reactions[${r}] coefficient for '${k}' is not a number`, 'reactions');
      for (const [e, a] of Object.entries(elements(k) || {})) bal[e] = (bal[e] || 0) + a * v;
    }
    const bad = Object.entries(bal).filter(([, v]) => Math.abs(v) > 1e-9);
    if (bad.length) fail('MB_RXN_BALANCE', `${unit}: reactions[${r}] is not element-balanced (${bad.map(([e, v]) => `${e} ${v > 0 ? '+' : ''}${+v.toFixed(4)}`).join(', ')})`, 'reactions');
    if (rx.approach_K !== undefined && !num(rx.approach_K)) fail('MB_RXN', `${unit}: reactions[${r}].approach_K must be a number (K)`, 'reactions');
    return { stoich: rx.stoich, approach_K: num(rx.approach_K) ? rx.approach_K : (num(p.approach_K) ? p.approach_K : 0), label: rx.label };
  });
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
  // STEP 33 options
  const pm = p.phase_model === undefined ? (hasRealVapour(pp) ? 'eos' : 'ideal') : p.phase_model;
  if (pm !== 'eos' && pm !== 'ideal') fail('MB_GIBBS_PHASE', "gibbs: phase_model must be 'eos' (fugacity coefficients from the property method) or 'ideal'", 'phase_model');
  const fug = pm === 'eos' && hasRealVapour(pp);
  if (pm === 'eos' && !hasRealVapour(pp)) w.push(`gibbs: property method ${pp.label || pp.model} has an ideal-gas vapour — equilibrium uses φ = 1`);
  if (p.approach_K !== undefined && !num(p.approach_K)) fail('MB_GIBBS_APPROACH', 'gibbs: approach_K must be a number (K)', 'approach_K');
  const dT = num(p.approach_K) ? p.approach_K : 0;
  const rxns = equilRxns(p, pp, 'gibbs');
  const allowC = p.carbon === true;
  if (allowC && rxns) fail('MB_GIBBS_CARBON', 'gibbs: carbon: true needs the unrestricted (no reactions list) mode', 'carbon');
  const MW_C = 12.0107;           // g/mol, same atomic weights as the databank (CH4 16.04246, CO 28.0101)
  const solveAt = (T) => {
    let g;
    if (rxns) {
      const e = equilReactions(pp, nIn, T, P, rxns, { fugacity: fug });
      g = { n: e.n, nC: 0, converged: e.converged, iterations: e.iterations, lnphi: e.lnphi, xi: e.xi, lnK: e.lnK, lnQ: e.lnQ };
    } else g = gibbsSolve(pp, nIn, T, P, allowed, { fugacity: fug, approach_K: dT, carbon: allowC });
    const F = g.n.reduce((s, v) => s + v, 0);
    const z = g.n.map((v) => v / F);
    let r = th.flashPT(pp, z, T, P);
    if (!r || !num(r.beta)) r = { T, P, beta: 1, x: z, y: z, phase: 'V' };
    const hC = g.nC > 0 ? graphite(T).H : 0;
    return { g, F, z, r, H: F * th.hOf(pp, r) + g.nC * hC, Hs: g.nC * hC };
  };
  let res, T;
  if (num(p.T_out_K)) { T = p.T_out_K; res = solveAt(T); }
  else {
    // adiabatic (or given duty): find T with H_out = H_in + Q
    const Q = num(p.duty_kW) ? p.duty_kW * KJH_PER_KW : 0;
    const target = f.H_kJh + Q;
    const Tg = num(p.T_guess_K) ? p.T_guess_K : Math.max(...streams.map((s) => s.T_K || 600));
    T = solveEnergyT((t) => (res = solveAt(t)).H - target, Tg, 250, 3000, 'gibbs');
    if (res.r.T !== T) res = solveAt(T);
  }
  if (!res.g.converged) w.push('gibbs: equilibrium iteration did not fully converge');
  const out = streamOut(pp, res.F, res.z, res.r);
  const lp = fug ? vapLnPhi(pp, T, P, res.z) : null;
  const aC = carbonActivities(pp, res.g.n, T, P, lp);
  const aMax = aC ? Math.max(...Object.values(aC)) : null;
  const method = (`vapour-phase ${fug ? `equilibrium with fugacity coefficients from ${pp.label || pp.model}` : 'ideal-gas equilibrium'}${res.g.nC > 0 ? ' plus solid graphite' : ''}${rxns ? ' restricted to the listed reactions' : ''}${dT && !rxns ? `, approach ${dT > 0 ? '+' : ''}${dT} K` : ''}`);
  if (res.r.beta < 1 - 1e-9) w.push(`gibbs: outlet contains ${(100 * (1 - res.r.beta)).toFixed(2)} mol % liquid at ${T.toFixed(1)} K — liquid-phase equilibrium is not included (vapour-phase Gibbs minimisation)`);
  if (aMax !== null && aMax > 1 && !(res.g.nC > 0)) w.push(`gibbs: carbon activity ${aMax.toFixed(2)} > 1 at the outlet (${Object.entries(aC).filter(([, v]) => v > 1).map(([k]) => k).join('; ')}) — graphite is thermodynamically favoured${rxns ? '' : '; set carbon: true to let it deposit'}`);
  if (res.g.nC > 0) w.push(`gibbs: ${(res.g.nC * MW_C).toPrecision(4)} kg/h graphite deposits at equilibrium — reported as solids_out, not in the outlet stream`);
  const nAll = res.g.n.slice();
  const elemErr = [...new Set(pp.keys.flatMap((k) => Object.keys(elements(k) || {})))].map((e) => {
    const a = pp.keys.map((k) => (elements(k) || {})[e] || 0);
    const bin = a.reduce((s, v, i) => s + v * nIn[i], 0), bout = a.reduce((s, v, i) => s + v * nAll[i], 0) + (e === 'C' ? res.g.nC : 0);
    return Math.abs(bout - bin) / Math.max(bin, 1e-12);
  });
  const solids = res.g.nC > 0 ? { component: 'C(graphite)', kmol_h: res.g.nC, mass_flow_kg_h: res.g.nC * MW_C, H_kJh: res.Hs, T_K: T } : null;
  const details = { pp: ppDetails(pp), T_out_K: T, P_out_bar: P / 1e5, duty_kW: (out.H_kJh + res.Hs - f.H_kJh) / KJH_PER_KW, iterations: res.g.iterations,
    method, phase_model: fug ? 'eos' : 'ideal', approach_K: rxns ? undefined : dT, equilibrium_T_K: rxns ? undefined : T + dT,
    element_balance_max_rel: Math.max(...elemErr), outlet_mole_frac: compObj(pp, res.z),
    carbon_activity: aC || undefined, carbon_activity_max: aMax === null ? undefined : aMax, solids_out: solids || undefined,
    fugacity_coeff: lp ? compObj(pp, lp.map(Math.exp)) : undefined };
  if (rxns) details.reactions = rxns.map((rx, r) => ({ label: rx.label || Object.entries(rx.stoich).map(([k, v]) => `${v}${k}`).join(' '), approach_K: rx.approach_K,
    extent_kmol_h: res.g.xi[r], lnK: res.g.lnK[r], lnQ: res.g.lnQ[r] }));
  const R0 = result([out], f.mass, f.H_kJh, out.H_kJh + res.Hs, 0, details, w, { converged: res.g.converged, solids_out: solids || undefined });
  if (solids) { R0.mass_balance.out += solids.mass_flow_kg_h; R0.mass_balance.closure_pct = f.mass > 0 ? 100 * (R0.mass_balance.out - f.mass) / f.mass : 0; }
  return R0;
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
  // STEP 37: pairs the package estimated from UNIFAC
  const estMap = new Map((pp.estimatedPairs || []).map((e) => [e.pair, e]));
  const estOf = (a, b) => {
    const e = estMap.get(a + '–' + b) || estMap.get(b + '–' + a);
    if (!e) return null;
    const [ka, kb] = e.pair.split('–');
    const f = th.fitPairFromUNIFAC(model, th.component(ka), th.component(kb));
    if (!f) return null;
    return ka === a ? { a_ij: f.a12, b_ij: f.b12, a_ji: f.a21, b_ji: f.b21, source: 'estimated (' + e.source + ')' } : { a_ij: f.a21, b_ij: f.b21, a_ji: f.a12, b_ji: f.b12, source: 'estimated (' + e.source + ')' };
  };
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = keys[i], b = keys[j];
    const row = { i: a, j: b };
    if (model === 'pr' || model === 'srk' || pp.vapourModel !== 'ideal') {
      const [x, y] = [a, b].sort();
      const u = spec.kij && (num(spec.kij[x + '|' + y]) ? spec.kij[x + '|' + y] : num(spec.kij[y + '|' + x]) ? spec.kij[y + '|' + x] : null);
      const v = num(u) ? u : bip.PR[x + '|' + y];
      row.kij = num(v) ? v : 0;
      row.kij_source = num(u) ? 'user' : th.BIP_EXTRA_USED && th.BIP_EXTRA_USED.PR[x + '|' + y] ? th.BIP_EXTRA_USED.PR[x + '|' + y] : num(v) ? 'ChemSep' : 'none (0)';
    }
    if (model === 'nrtl') {
      const ua = userOf(spec.nrtl, a, b), ub = userOf(spec.nrtl, b, a);
      const da = bip.NRTL[a + '|' + b], db = bip.NRTL[b + '|' + a];
      row.nrtl = { b_ij: ua ? ua.b || 0 : da ? da[0] : 0, b_ji: ub ? ub.b || 0 : db ? db[0] : 0, a_ij: ua ? ua.a || 0 : 0, a_ji: ub ? ub.a || 0 : 0,
        alpha: ua && num(ua.alpha) ? ua.alpha : da ? da[1] : db ? db[1] : 0.3 };
      row.source = ua || ub ? 'user' : da || db ? 'ChemSep' : 'none (ideal)';
      const es = !ua && !ub && !da && !db ? estOf(a, b) : null;
      if (es) { row.nrtl = { b_ij: es.b_ij, b_ji: es.b_ji, a_ij: es.a_ij, a_ji: es.a_ji, alpha: 0.3 }; row.source = es.source; }
    } else if (model === 'uniquac') {
      const ua = userOf(spec.uniquac, a, b), ub = userOf(spec.uniquac, b, a);
      const da = bip.UNIQUAC[a + '|' + b], db = bip.UNIQUAC[b + '|' + a];
      row.uniquac = { b_ij: ua ? ua.b || 0 : da ? da[0] : 0, b_ji: ub ? ub.b || 0 : db ? db[0] : 0 };
      row.source = ua || ub ? 'user' : da || db ? 'ChemSep' : 'none (τ = 1)';
      const es = !ua && !ub && !da && !db ? estOf(a, b) : null;
      if (es) { row.uniquac = { b_ij: es.b_ij, b_ji: es.b_ji, a_ij: es.a_ij, a_ji: es.a_ji }; row.source = es.source; }
    } else if (model === 'wilson') {
      const ua = userOf(spec.wilson, a, b), ub = userOf(spec.wilson, b, a);
      const da = bip.WILSON[a + '|' + b], db = bip.WILSON[b + '|' + a];
      row.wilson = { a_ij: ua ? ua.a || 0 : da ? da[0] : 0, b_ij: ua ? ua.b || 0 : da ? da[1] : 0, a_ji: ub ? ub.a || 0 : db ? db[0] : 0, b_ji: ub ? ub.b || 0 : db ? db[1] : 0 };
      row.source = ua || ub ? 'user' : da || db ? 'ChemSep' : 'none (Λ = 1)';
      const es = !ua && !ub && !da && !db ? estOf(a, b) : null;
      if (es) { row.wilson = { a_ij: es.a_ij, b_ij: es.b_ij, a_ji: es.a_ji, b_ji: es.b_ji }; row.source = es.source; }
    }
    pairs.push(row);
  }
  const henry = (pp.henryKeys || []).slice();
  return { streams_out: [], mass_balance: {}, energy_balance: {},
    details: { model, label: pp.label, vapour_model: pp.vapourModel, poynting: !!pp.poynting, components: comps, pairs, henry_components: henry,
      // STEP 32: free water — liquid water on IAPWS-IF97 and the gases dissolved in it on Henry constants
      free_water: pp.isEOS && pp.keys.includes('H2O')
        ? (pp.freeWater ? { on: true, water: 'IAPWS-IF97 (liquid; vapour residual at the water partial pressure)', henry: pp.freeWater.henry } : { on: false })
        : null,
      association: pp.association || null,
      electrolyte: pp.electrolyte ? { model: pp.electrolyte.model, solvent: pp.electrolyte.solvent,
        method: pp.electrolyte.model === 'amine-mea'
          ? 'Chemical equilibrium (carbamate + bicarbonate, ideal molarity basis), Akula et al. (2021) as in the IDAES MEA property package; CO2 Henry constant by the N2O analogy (Jiru et al. 2012); H2O / MEA by Raoult on true mole fractions'
          : pp.electrolyte.model === 'amine-mdea'
          ? 'Extended UNIQUAC (UNIQUAC + Debye–Hückel) with the parameters of Sadegh (DTU PhD thesis, 2013): H2O, CO2, MDEA, MDEAH+, H+, OH−, HCO3−, CO3−−; equilibrium constants from the fitted standard-state ΔfG°, ΔfH°, Cp°; CO2 Henry constant of Rumpf & Maurer (1993)' + (pp.keys.includes('piperazine') ? '; activated MDEA: PZ, PZH+, PZCOO−, H+PZCOO−, PZ(COO)2−− with parameters by analogy to the Sadegh species and water interactions / carbamate equilibria fitted to measured CO2 pressures (Chen 2011, Xu 2011; 40–160 °C), PZH+ dissociation of Gupta et al. (2022)' : '')
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
  const outer = IGV;
  IGV = { hit: false };
  try {
    const r = fn(inp);
    if (r && !r.error && IGV.hit) {
      // STEP 31: an ideal-gas vapour above about 5 bar with a significant real-gas correction
      const c = IGV;
      r.ideal_vapour = { P_bar: c.P / 1e5, T_K: c.T, dh_kJkg: c.dh_kJkg, hDep_Jmol: c.hDep, water_only: c.water, model: c.model, advice: igvAdvice(c) };
      r.warnings = (r.warnings || []).concat([`property method: vapour at up to ${(c.P / 1e5).toPrecision(3)} bar is treated as an ideal gas — the real-gas enthalpy ` +
        `correction there is about ${num(c.dh_kJkg) ? fmtKJ(c.dh_kJkg) + ' kJ/kg' : fmtKJ(c.hDep / 1000) + ' kJ/mol'} ` +
        `(Peng–Robinson estimate) and is missing from duties and machine power — ${igvAdvice(c)}`]);
    }
    if (r && !r.error && IGV.flash) {
      // STEP 32: a phase-equilibrium calculation behind one of the unit's streams did not converge
      const f = IGV.flash;
      r.converged = false;
      r.flash_unconverged = { count: IGV.flashCount, T_K: f.T, P_bar: f.P / 1e5, residual: num(f.residual) ? f.residual : null };
      r.warnings = (r.warnings || []).concat([`flash did not converge at ${(f.T - 273.15).toFixed(2)} °C, ${(f.P / 1e5).toPrecision(4)} bar` +
        (num(f.residual) ? ` (residual ${f.residual.toExponential(1)})` : '') + ' — phase split and enthalpy there are approximate; the state is probably close to a critical point or a phase boundary']);
    }
    if (r && !r.error && IGV.wet) {
      r.warnings = (r.warnings || []).concat([`free water is switched off: liquid water (up to ${(100 * IGV.wet).toFixed(0)} mol % of a liquid) is on the cubic equation of state, ` +
        'which puts the latent heat of water about 5 % high and its vapour pressure up to 15 % low — turn Free water on for this method']);
    }
    return r;
  } catch (e) {
    if (e instanceof UnitError || e instanceof th.ThermoError) return { error: { code: e.code, message: e.message, field: e.field || null } };
    return { error: { code: 'MB_RIG_THROW', message: e.message, field: null } };
  } finally { IGV = outer; }
};

export const RIG_MODULES = {
  'heater': solveHeater,
  'valve': solveValve,
  'pump': solvePumpR,
  'compressor': solveCompressor,
  'expander': solveExpander,
  'extraction-turbine': solveExtractionTurbine,
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
/** helpers shared with the rigorous syngas units (mb-syngas.js) and the pipe (mb-pipe.js) */
export const KIT = { th, num, fail, R, KJH_PER_KW, input, result, combine, keysOf, pOut, pkg, stateIn, streamOut, ppDetails, compObj,
  elements, equilReactions, carbonActivities, solveEnergyT, hasRealVapour, vapLnPhi, graphite,
  // STEP 34: unit solvers reused by composite units (compressor train)
  units: { compressor: (i) => solveCompressor(i), heater: (i) => solveHeater(i), flash: (i) => solveFlashR(i), mixer: (i) => solveMixerR(i) } };
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

export default { UNITS_VERSION, RIG_MODULES, register, pkg, stateIn, streamOut, describeStream, elements, UnitError, moles, KIT };
