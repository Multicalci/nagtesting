// ============================================================================
// REPO PATH: api/_lib/mb-kinetics.js
// ============================================================================
// multicalci.com — STEP 23 kinetic reactors on the property-package core
// (Aspen RPlug / RCSTR with power-law kinetics):
//
//   r-pfr    plug-flow reactor: molar flows (and enthalpy flow) integrated
//            along the volume — adaptive Dormand–Prince RK5(4), switching to
//            the L-stable Rosenbrock method RODAS3 when the kinetics are
//            stiff (fast, equilibrium-limited reactions); isothermal,
//            adiabatic, fixed duty or coolant (U, T_coolant); linear
//            pressure drop; profile returned.
//   r-cstr   continuous stirred tank: extents (and T) by damped Newton from
//            several starts; for very fast kinetics, pseudo-transient
//            continuation (start-up from feed, RODAS3) to the steady state;
//            isothermal, adiabatic or fixed duty.
//   Both report the heat of each reaction in the reacting-phase model.
//
// Kinetics, per reaction j — power law or Langmuir–Hinshelwood–Hougen–Watson
// (Aspen "LHHW" form: kinetic factor × driving force / adsorption term):
//   r_j = k_j(T) · [ Π a_i^{o_ij} − (reverse) ] / [ Σ_t K_t(T) Π a_i^{e_ti} ]^m
//   k(T) = k0 · exp(−Ea / (R T))   or, with T_ref_K, k0 · exp(−Ea/R · (1/T − 1/T_ref))
//   reverse: 'equilibrium' → Π a^{o_ij} · Q_j / K_j with Q_j = Π a_i^{ν_ij}
//            (thermodynamically consistent driving force; reduces to
//            Π products^ν / K for elementary orders); K_j from the ideal-gas
//            Gibbs energies of the databank (vapour) or user-given
//            ln K = A + B/T + C ln T + D·T in the units of the rate basis;
//            or an explicit reverse Arrhenius rate with its own orders.
//   adsorption terms: K_t = K0 · exp(−ΔH_ads/(R T)) (optionally about T_ref)
//            or ln K_t = A + B/T + C ln T + D·T; exponent m (e.g. 2 for
//            dual-site surface reaction control, as in Xu–Froment SMR).
//   a_i  = concentration (kmol/m³, from the phase molar volume of the
//          property method) or partial pressure (bar, vapour only); negative
//          orders (inhibition) are allowed.
//   rate units: kmol/(m³ s); with rate_basis 'catalyst' the rate is per kg
//   of catalyst (kmol/(kg s)) and multiplied by the bed density (kg/m³).
//
// The reacting phase (vapour or liquid) is chosen by the user, as in the
// commercial simulators' "valid phases = vapour only / liquid only"; the
// outlet is flashed rigorously.
// Plain ES module. Server-side only. (c) multicalci.com
// ============================================================================

import th from './mb-thermo.js';
import units from './mb-units.js';
import compdb from './mb-compdb.js';

export const KINETICS_VERSION = 'mb-kinetics 1.1.0';
const R = 8.314462618, P0 = 101325, KJH = 3600;
const num = (x) => typeof x === 'number' && isFinite(x);
const fail = (code, msg, field) => { throw new units.UnitError(code, msg, field); };
const r7 = (x) => (num(x) ? Number(x.toPrecision(7)) : null);
const keysOf = (...ss) => [...new Set(ss.flatMap((s) => (s.components || []).filter((c) => num(c.mass_fraction) && c.mass_fraction > 0).map((c) => c.key)))];
const flashT = (pp, z, T, P) => (pp.threePhase ? th.flashPT3(pp, z, T, P) : th.flashPT(pp, z, T, P));
const flashH = (pp, z, P, h, Tg) => (pp.threePhase ? th.flashPH3(pp, z, P, h, Tg) : th.flashPH(pp, z, P, h, Tg));

// ---------------------------------------------------------------------------
// kinetics setup
// ---------------------------------------------------------------------------
function setupKinetics(pp, p, label) {
  const rx = p.reactions;
  if (!Array.isArray(rx) || !rx.length || rx.length > 10) fail('MB_KIN_RXN', `${label}: params.reactions must list 1–10 reactions`, 'reactions');
  const phase = p.phase === 'L' ? 'L' : 'V';
  const catalyst = p.rate_basis === 'catalyst';
  if (catalyst && !(num(p.catalyst_density_kgm3) && p.catalyst_density_kgm3 > 0)) fail('MB_KIN_CAT', `${label}: rate per kg catalyst needs catalyst_density_kgm3 (bed bulk density)`, 'catalyst_density_kgm3');
  const n = pp.n;
  const out = rx.map((r, j) => {
    const at = `reactions[${j}]`;
    if (!r || typeof r.stoich !== 'object') fail('MB_KIN_RXN', `${label}: ${at}.stoich {key: ν} required`, 'reactions');
    const nu = new Array(n).fill(0);
    for (const [k, v] of Object.entries(r.stoich)) {
      if (!(k in pp.index)) fail('MB_KIN_KEY', `${label}: ${at}: component '${k}' is not in the feed or the product list`, 'reactions');
      if (!num(v)) fail('MB_KIN_RXN', `${label}: ${at}: coefficient of '${k}' must be a number`, 'reactions');
      nu[pp.index[k]] = v;
    }
    if (!nu.some((v) => v < 0) || !nu.some((v) => v > 0)) fail('MB_KIN_RXN', `${label}: ${at} needs reactants (ν < 0) and products (ν > 0)`, 'reactions');
    const basis = r.basis === 'partial_pressure' ? 'partial_pressure' : 'concentration';
    if (basis === 'partial_pressure' && phase === 'L') fail('MB_KIN_BASIS', `${label}: ${at}: partial-pressure rates need the vapour phase`, 'reactions');
    if (!num(r.k0) || r.k0 < 0) fail('MB_KIN_K', `${label}: ${at}.k0 must be ≥ 0`, 'reactions');
    const Ea = num(r.Ea_kJmol) ? r.Ea_kJmol : 0;
    const ord = new Array(n).fill(0);
    const given = r.orders && typeof r.orders === 'object' ? r.orders : null;
    for (let i = 0; i < n; i++) {
      if (given && pp.keys[i] in given) { if (!num(given[pp.keys[i]])) fail('MB_KIN_ORDER', `${label}: ${at}: order of '${pp.keys[i]}' must be a number`, 'reactions'); ord[i] = given[pp.keys[i]]; }
      else if (!given && nu[i] < 0) ord[i] = -nu[i];                 // elementary by default
    }
    const Tref = num(r.T_ref_K) && r.T_ref_K > 0 ? r.T_ref_K : null;
    let rev = null;
    if (r.reversible === 'equilibrium') {
      const user = lnKform(r.K_eq, `${label}: ${at}.K_eq`);
      if (!user && phase !== 'V') fail('MB_KIN_REV', `${label}: ${at}: equilibrium constants from the databank are for vapour-phase reactions — give K_eq (ln K = A + B/T + C ln T + D T) or an explicit reverse rate for liquids`, 'reactions');
      // reverse exponents of the consistent driving force: o_i + ν_i
      rev = { kind: 'eq', user, ordQ: ord.map((o, i) => o + nu[i]) };
    } else if (r.reverse && typeof r.reverse === 'object') {
      if (!num(r.reverse.k0) || r.reverse.k0 < 0) fail('MB_KIN_K', `${label}: ${at}.reverse.k0 must be ≥ 0`, 'reactions');
      const ordR = new Array(n).fill(0);
      const gr = r.reverse.orders && typeof r.reverse.orders === 'object' ? r.reverse.orders : null;
      for (let i = 0; i < n; i++) { if (gr && pp.keys[i] in gr) ordR[i] = gr[pp.keys[i]]; else if (!gr && nu[i] > 0) ordR[i] = nu[i]; }
      rev = { kind: 'rate', k0: r.reverse.k0, Ea: num(r.reverse.Ea_kJmol) ? r.reverse.Ea_kJmol : 0, ord: ordR,
        Tref: num(r.reverse.T_ref_K) && r.reverse.T_ref_K > 0 ? r.reverse.T_ref_K : null };
    }
    // LHHW adsorption term
    let ads = null;
    if (r.adsorption && typeof r.adsorption === 'object' && Array.isArray(r.adsorption.terms) && r.adsorption.terms.length) {
      const m = num(r.adsorption.exponent) ? r.adsorption.exponent : 1;
      if (m < 0 || m > 4) fail('MB_KIN_ADS', `${label}: ${at}.adsorption.exponent must be between 0 and 4`, 'reactions');
      if (r.adsorption.terms.length > 12) fail('MB_KIN_ADS', `${label}: ${at}: at most 12 adsorption terms`, 'reactions');
      const terms = r.adsorption.terms.map((t, q) => {
        const tat = `${at}.adsorption.terms[${q}]`;
        if (!t || typeof t !== 'object') fail('MB_KIN_ADS', `${label}: ${tat} must be an object`, 'reactions');
        const e = new Array(n).fill(0);
        for (const [k, v] of Object.entries(t.orders || {})) {
          if (!(k in pp.index)) fail('MB_KIN_KEY', `${label}: ${tat}: component '${k}' is not in the feed or the product list`, 'reactions');
          if (!num(v)) fail('MB_KIN_ADS', `${label}: ${tat}: exponent of '${k}' must be a number`, 'reactions');
          e[pp.index[k]] = v;
        }
        const lf = lnKform(t, null);
        if (!lf) {
          if (!num(t.K0) || t.K0 < 0) fail('MB_KIN_ADS', `${label}: ${tat}: give K0 (≥ 0) and dH_kJmol, or A, B, C, D`, 'reactions');
        }
        return { e, lf, K0: t.K0, dH: num(t.dH_kJmol) ? t.dH_kJmol : 0, Tref: num(t.T_ref_K) && t.T_ref_K > 0 ? t.T_ref_K : null };
      });
      ads = { m, terms };
    }
    const dn = nu.reduce((a, v) => a + v, 0);
    return { nu, ord, k0: r.k0, Ea, Tref, basis, rev, ads, dn, name: r.name || `reaction ${j + 1}` };
  });
  return { rx: out, phase, catalyst, rhoCat: catalyst ? p.catalyst_density_kgm3 : 1 };
}

/** {A, B, C, D} → ln K(T) = A + B/T + C ln T + D·T (null when no A/B given) */
function lnKform(o, where) {
  if (!o || typeof o !== 'object' || !(num(o.A) || num(o.B))) {
    if (where && o && typeof o === 'object') fail('MB_KIN_KEQ', `${where}: give A and/or B of ln K = A + B/T + C ln T + D·T`, 'reactions');
    return null;
  }
  const A = num(o.A) ? o.A : 0, B = num(o.B) ? o.B : 0, C = num(o.C) ? o.C : 0, D = num(o.D) ? o.D : 0;
  return (T) => A + B / T + C * Math.log(T) + D * T;
}
/** Arrhenius factor with an optional reference temperature */
const arrh = (k0, EkJ, T, Tref) => k0 * Math.exp(-EkJ * 1000 / R * (1 / T - (Tref ? 1 / Tref : 0)));

/** ln K (standard state P0 ideal gas) of each reaction at T */
function lnKeq(pp, K, T) {
  return K.rx.map((r) => {
    let g = 0;
    for (let i = 0; i < pp.n; i++) if (r.nu[i]) g += r.nu[i] * (pp.hig(i, T) - T * pp.sig(i, T));
    return -g / (R * T);
  });
}

/** reaction rates [kmol/(m³ s)] at T, P (Pa) and molar flows F (any consistent units) */
function rates(pp, K, T, P, F) {
  const n = pp.n;
  const Ft = F.reduce((a, b) => a + Math.max(b, 0), 0);
  const y = F.map((v) => Math.max(v, 0) / (Ft || 1));
  let v = null;                                         // m³/mol
  const conc = () => { if (v === null) v = pp.volPhase(T, P, y, K.phase); return y.map((yi) => yi / v / 1000); };
  let C = null, pb = null;
  const lnK = K.rx.some((r) => r.rev && r.rev.kind === 'eq' && !r.rev.user) ? lnKeq(pp, K, T) : null;
  return K.rx.map((r, j) => {
    let a;
    if (r.basis === 'partial_pressure') { if (!pb) pb = y.map((yi) => yi * P / 1e5); a = pb; } else { if (!C) C = conc(); a = C; }
    // a^e: positive exponents of an absent species give 0; negative exponents (inhibition, LHHW
    // terms such as p_H2O/p_H2) are bounded by a floor of 1e-12 of the total activity
    const floor = 1e-12 * a.reduce((s2, v2) => s2 + Math.max(v2, 0), 0);
    const pw = (x, e) => (e > 0 ? Math.pow(Math.max(x, 0), e) : Math.pow(Math.max(x, floor), e));
    const kf = arrh(r.k0, r.Ea, T, r.Tref);
    let fwd = kf;
    for (let i = 0; i < n; i++) if (r.ord[i]) fwd *= pw(a[i], r.ord[i]);
    let back = 0;
    if (r.rev && r.rev.kind === 'rate') {
      back = arrh(r.rev.k0, r.rev.Ea, T, r.rev.Tref);
      for (let i = 0; i < n; i++) if (r.rev.ord[i]) back *= pw(a[i], r.rev.ord[i]);
    } else if (r.rev && r.rev.kind === 'eq') {
      // consistent driving force: k_f Π a^o · Q / K, Q = Π a^ν (K in the units of the rate basis)
      let Kb;
      if (r.rev.user) Kb = r.rev.user(T);
      else {
        Kb = lnK[j];
        if (r.basis === 'partial_pressure') Kb += r.dn * Math.log(P0 / 1e5);
        else Kb += r.dn * Math.log(P0 / (R * T) / 1000);
      }
      back = kf / Math.exp(Kb);
      for (let i = 0; i < n; i++) if (r.rev.ordQ[i]) back *= pw(a[i], r.rev.ordQ[i]);
    }
    let den = 1;
    if (r.ads) {
      let sum = 0;
      for (const t of r.ads.terms) {
        let Kt = t.lf ? Math.exp(t.lf(T)) : arrh(t.K0, t.dH, T, t.Tref);
        for (let i = 0; i < n; i++) if (t.e[i]) Kt *= pw(a[i], t.e[i]);
        sum += Kt;
      }
      den = Math.pow(sum, r.ads.m);
    }
    return (fwd - back) / den * K.rhoCat;
  });
}

/** single-phase molar enthalpy and the temperature that matches a target (reacting-phase model) */
function hAt(pp, K, T, P, y) { return pp.hPhase(T, P, y, K.phase); }
function TfromH(pp, K, P, y, h, Tg) {
  const f = (T) => hAt(pp, K, T, P, y) - h;
  let T = num(Tg) && Tg > 30 && Tg < 6000 ? Tg : 600;
  for (let it = 0; it < 40; it++) {
    const f0 = f(T), d = (f(T + 0.01) - f0) / 0.01;
    if (!(Number.isFinite(f0) && Number.isFinite(d) && d > 0)) break;
    let dT = -f0 / d;
    if (Math.abs(dT) > 100) dT = Math.sign(dT) * 100;
    T = Math.min(6000, Math.max(30, T + dT));
    if (Math.abs(dT) < 1e-9 * T) return T;
  }
  // safeguard: bisection on a wide bracket (single-phase h(T) is monotonic)
  let lo = 30, hi = 6000;
  if (!(f(lo) < 0 && f(hi) > 0)) return NaN;
  for (let it = 0; it < 200 && hi - lo > 1e-10 * hi; it++) { const m = 0.5 * (lo + hi), fm = f(m); if (!Number.isFinite(fm)) return NaN; if (fm < 0) lo = m; else hi = m; }
  return 0.5 * (lo + hi);
}

function heatsOfReaction(pp, K, T, P, F) {
  const n = pp.n, Nt = F.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const x = F.map((v) => Math.max(v, 0) / Nt);
  const H = (dn) => { const N2 = 1 + dn.reduce((a, b) => a + b, 0); return N2 * hAt(pp, K, T, P, x.map((v, i) => (v + dn[i]) / N2)); };
  const H0 = H(new Array(n).fill(0)), d = 1e-6;
  const hbar = pp.keys.map((_, i) => { const dn = new Array(n).fill(0); dn[i] = d; return (H(dn) - H0) / d; });
  return K.rx.map((r) => ({ reaction: r.name, T_K: r7(T), dH_kJmol: r7(r.nu.reduce((a, v, i) => a + v * hbar[i], 0) / 1000),
    dH298_ig_kJmol: r7(r.nu.reduce((a, v, i) => a + v * pp.hig(i, 298.15), 0) / 1000) }));
}

/** carboxylic acids (DIPPR families 50–53) dimerise in the vapour; without a vapour association
 *  model (Hayden–O'Connell) the liquid enthalpy of an activity-coefficient package — ideal-gas
 *  monomer minus the measured heat of vaporisation — is ~25 kJ/mol too high for these acids. */
function acidWarning(pp, K, label) {
  if (K.phase !== 'L' || pp.isEOS) return null;
  const assoc = (pp.association && pp.association.keys) || [];
  const acids = pp.keys.filter((k, i) => { const c = compdb.has(k) ? compdb.get(k) : null; return c && c.family >= 50 && c.family <= 53 && !assoc.includes(k) && K.rx.some((r) => r.nu[i] !== 0); });
  return acids.length ? `${label}: ${acids.join(', ')}: carboxylic acids associate in the vapour and vapour association is off for this package (an equation-of-state vapour, or association disabled), so their liquid enthalpy (ideal-gas monomer − measured heat of vaporisation) is roughly 25 kJ/mol too high — the liquid heat of reaction, duty and adiabatic temperature can be strongly in error` : null;
}

/** liquid reacting phase of an activity-coefficient package above a component's critical
 *  temperature: its liquid enthalpy falls back to the ideal gas (zero heat of vaporisation) */
function supercriticalWarning(pp, K, label, Tmax, F) {
  if (K.phase !== 'L' || pp.isEOS) return null;
  const sc = pp.keys.filter((k, i) => F[i] > 0 && !(pp.henryKeys || []).includes(k) && pp.comps[i].Tc > 0 && Tmax > pp.comps[i].Tc);
  return sc.length ? `${label}: ${sc.join(', ')}: the liquid reaches ${Tmax.toFixed(1)} K, above the critical temperature — the liquid enthalpy of a supercritical solute is taken as its ideal-gas value (no heat of vaporisation), so heats of reaction there are approximate; use an equation of state or keep the liquid below Tc` : null;
}

function feedState(pp, streams, label) {
  const st = streams.map((s, i) => units.stateIn(pp, s, `${label} inlet ${i + 1}`));
  const n = pp.n, mol = new Array(n).fill(0);
  let H = 0, mass = 0;
  for (const a of st) { for (let i = 0; i < n; i++) mol[i] += a.F * a.z[i]; H += a.H_kJh; mass += a.mass; }
  const F = mol.reduce((a, b) => a + b, 0);
  const T = st.reduce((a, s) => a + s.T * s.F, 0) / (F || 1);
  const P = Math.min(...st.map((s) => s.P));
  return { mol, F, H, mass, T, P };
}
const compObj = (pp, v) => { const t = v.reduce((a, b) => a + Math.max(b, 0), 0) || 1; return Object.fromEntries(pp.keys.map((k, i) => [k, r7(Math.max(v[i], 0) / t)]).filter((e) => e[1] > 0)); };

function outlet(pp, Fout, T, P, Hout_kJh, isothermal) {
  const F = Fout.reduce((a, b) => a + b, 0);
  const z = Fout.map((v) => Math.max(v, 0) / F);
  const r = isothermal ? flashT(pp, z, T, P) : flashH(pp, z, P, Hout_kJh / F, T);
  return units.streamOut(pp, F, z, r);
}

function result(streams_out, mIn, Hin, Hout, details, warnings, extra) {
  const mOut = streams_out.reduce((a, s) => a + s.mass_flow_kg_h, 0);
  return Object.assign({ streams_out,
    mass_balance: { in: mIn, out: mOut, closure_pct: mIn > 0 ? 100 * (mOut - mIn) / mIn : 0 },
    energy_balance: { Hin, Hout, Q_kW: (Hout - Hin) / KJH, W_kW: 0 }, details, converged: true, warnings: [...new Set(warnings)] }, extra || {});
}

// ---------------------------------------------------------------------------
// plug-flow reactor
// ---------------------------------------------------------------------------
function solvePFR(inp) {
  const label = 'r-pfr';
  if (!inp || !Array.isArray(inp.streams) || !inp.streams.length) fail('MB_INPUT', `${label}: at least one inlet stream`, 'streams');
  const p = inp.params || {};
  const extra = Array.isArray(p.products) ? p.products : [];
  const rxKeys = Array.isArray(p.reactions) ? p.reactions.flatMap((r) => Object.keys((r && r.stoich) || {})) : [];
  const pp = units.pkg(p.property_package, [...new Set(keysOf(...inp.streams).concat(rxKeys, extra))]);
  const w = pp.warnings.slice();
  const K = setupKinetics(pp, p, label);
  const f = feedState(pp, inp.streams, label);
  let Vtot = num(p.volume_m3) ? p.volume_m3 : null;
  const D = num(p.diameter_m) && p.diameter_m > 0 ? p.diameter_m : null;
  const ntube = num(p.tubes) && p.tubes >= 1 ? Math.round(p.tubes) : 1;
  if (!Vtot && num(p.length_m) && D) Vtot = Math.PI * D * D / 4 * p.length_m * ntube;
  if (!(Vtot > 0)) fail('MB_PFR_V', `${label}: give volume_m3, or length_m and diameter_m`, 'volume_m3');
  const mode = ['isothermal', 'adiabatic', 'duty', 'coolant'].includes(p.thermal) ? p.thermal : 'isothermal';
  const T0r = num(p.T_K) ? p.T_K : f.T;
  if (mode === 'coolant' && !(num(p.U_W_m2K) && num(p.T_coolant_K) && D)) fail('MB_PFR_COOL', `${label}: coolant mode needs U_W_m2K, T_coolant_K and diameter_m`, 'U_W_m2K');
  const Pin = num(p.P_bar) ? p.P_bar * 1e5 : f.P;
  const dP = num(p.dp_bar) ? p.dp_bar * 1e5 : 0;
  if (Pin - dP <= 0) fail('MB_PFR_P', `${label}: pressure drop exceeds the inlet pressure`, 'dp_bar');
  const n = pp.n;
  const F0 = f.mol.map((v) => v / 3600);                 // kmol/s
  const ytot = (F) => { const s = F.reduce((a, b) => a + Math.max(b, 0), 0); return F.map((v) => Math.max(v, 0) / s); };
  // reacting-phase enthalpy flow at the inlet (kW): F[kmol/s]·h[J/mol] = kW
  const T1 = mode === 'isothermal' ? T0r : f.T;
  let H0 = F0.reduce((a, b) => a + b, 0) * hAt(pp, K, T1, Pin, ytot(F0));
  const qv = mode === 'duty' ? (num(p.duty_kW) ? p.duty_kW : 0) / Vtot : 0;   // kW/m³
  const aV = D ? 4 / D : 0;                              // heat-transfer area per volume, m²/m³
  // state vector: F (n) + H (kW) ; returns d/dV
  let Tlast = T1;
  const Tof = (V, Y) => {
    if (mode === 'isothermal') return T0r;
    const F = Y.slice(0, n), Ft = F.reduce((a, b) => a + Math.max(b, 0), 0);
    const T = TfromH(pp, K, Pin - dP * V / Vtot, ytot(F), Y[n] / Ft, Tlast);
    if (Number.isFinite(T)) Tlast = T;
    return T;
  };
  const rhs = (V, Y) => {
    const F = Y.slice(0, n);
    const P = Pin - dP * V / Vtot;
    const T = Tof(V, Y);
    if (!Number.isFinite(T) || F.some((v) => !Number.isFinite(v))) return new Array(n + 1).fill(NaN);   // the step is rejected
    const r = rates(pp, K, T, P, F);
    const d = new Array(n + 1).fill(0);
    for (let j = 0; j < r.length; j++) for (let i = 0; i < n; i++) if (K.rx[j].nu[i]) d[i] += K.rx[j].nu[i] * r[j];
    d[n] = mode === 'adiabatic' || mode === 'isothermal' ? 0 : mode === 'duty' ? qv : p.U_W_m2K * aV * (p.T_coolant_K - T) / 1000;
    return d;
  };
  const rtol = num(p.rtol) ? p.rtol : 1e-8;
  const scale = F0.reduce((a, b) => a + b, 0);
  const prof = [];
  const rec = (Vx, Yx) => {
    const F = Yx.slice(0, n), T = Tof(Vx, Yx), Ft = F.reduce((a, b) => a + Math.max(b, 0), 0);
    prof.push({ V_m3: r7(Vx), z_m: D ? r7(Vx / (Math.PI * D * D / 4 * ntube)) : null, T_K: r7(T), P_bar: r7((Pin - dP * Vx / Vtot) / 1e5),
      F_kmol_h: r7(Ft * 3600), y: Object.fromEntries(pp.keys.map((k, i) => [k, r7(Math.max(F[i], 0) / Ft)])) });
  };
  const ig = integrate(rhs, F0.concat([H0]), Vtot, {
    n, rtol, scale, energyErr: mode === 'duty' || mode === 'coolant', autonomous: !(dP > 0), rec, nOut: 60,
    budget: num(p.budget_ms) ? p.budget_ms : 5000, label });
  const Y = ig.Y, steps = ig.steps, rej = ig.rejected;
  const Fend = Y.slice(0, n).map((v) => Math.max(v, 0));
  const Tend = Tof(Vtot, Y);
  const Pend = Pin - dP;
  // outlet: rigorous flash — isothermal at T, otherwise at the integrated enthalpy flow (+ the
  // difference between the reacting-phase model and the rigorous inlet state)
  const Ftot0 = F0.reduce((a, b) => a + b, 0);
  const Qtot_kW = mode === 'isothermal' ? null : (Y[n] - H0);
  let out;
  if (mode === 'isothermal') out = outlet(pp, Fend.map((v) => v * 3600), Tend, Pend, 0, true);
  else out = outlet(pp, Fend.map((v) => v * 3600), Tend, Pend, f.H + Qtot_kW * KJH, false);
  const Q = (out.H_kJh - f.H) / KJH;
  void Ftot0;
  const conv = {};
  pp.keys.forEach((k, i) => { if (F0[i] > 0 && Fend[i] < F0[i] && K.rx.some((r) => r.nu[i] < 0)) conv[k] = r7(1 - Fend[i] / F0[i]); });
  const aw = acidWarning(pp, K, label); if (aw) w.push(aw);
  { const Tm = Math.max(...prof.map((q) => q.T_K).filter(Number.isFinite), Tend); const Fany = F0.map((v, i) => Math.max(v, Fend[i])); const sw = supercriticalWarning(pp, K, label, Tm, Fany); if (sw) w.push(sw); }
  if (mode !== 'isothermal' && Math.abs(out.T_K - Tend) > 0.5) w.push(`${label}: the outlet flash differs from the reacting-phase temperature by ${(out.T_K - Tend).toFixed(2)} K (phase change at the outlet)`);
  return result([out], f.mass, f.H, out.H_kJh, {
    pp: { model: pp.model, label: pp.label }, phase: K.phase, thermal: mode, volume_m3: Vtot, duty_kW: Q, T_out_K: out.T_K, T_reactor_out_K: Tend,
    conversion: conv, outlet_mole_frac: compObj(pp, Fend), heat_of_reaction: heatsOfReaction(pp, K, T1, Pin, F0), profile: prof, steps, rejected: rej, solver: ig.solver,
    residence_time_s: null }, w);
}

// ---------------------------------------------------------------------------
// ODE integrator for the PFR: Dormand–Prince RK5(4) (FSAL) with Hairer's
// stiffness test; once the problem is found stiff (fast, equilibrium-limited
// kinetics) the remaining volume is integrated with the L-stable, stiffly
// accurate Rosenbrock method RODAS3 (Sandu et al., Atmos. Env. 31, 1997;
// order 3, embedded order 2) on a finite-difference Jacobian.
// ---------------------------------------------------------------------------
const DP_A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
const DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const DP_B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const DP_B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

function luFactor(A) {
  const n = A.length, a = A.map((r) => r.slice()), piv = [...Array(n).keys()];
  for (let c = 0; c < n; c++) {
    let m = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[m][c])) m = r;
    if (!(Math.abs(a[m][c]) > 1e-300)) return null;
    if (m !== c) { [a[c], a[m]] = [a[m], a[c]]; [piv[c], piv[m]] = [piv[m], piv[c]]; }
    for (let r = c + 1; r < n; r++) { const f = (a[r][c] /= a[c][c]); if (f) for (let k = c + 1; k < n; k++) a[r][k] -= f * a[c][k]; }
  }
  return { a, piv };
}
function luSolve(L, b) {
  const n = b.length, a = L.a, x = L.piv.map((i) => b[i]);
  for (let r = 0; r < n; r++) for (let k = 0; k < r; k++) x[r] -= a[r][k] * x[k];
  for (let r = n - 1; r >= 0; r--) { for (let k = r + 1; k < n; k++) x[r] -= a[r][k] * x[k]; x[r] /= a[r][r]; }
  return x;
}

function integrate(rhs, Y0, Vtot, o) {
  const { n, rtol, scale, label } = o;
  const N = Y0.length;
  const wt = (y, i) => (i < n ? rtol * scale + rtol * Math.abs(y) : rtol * Math.max(1, Math.abs(y)));
  const errOf = (Ynew, E) => {
    let err = 0;
    for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(E[i]) / wt(Ynew[i], i));
    if (o.energyErr) err = Math.max(err, Math.abs(E[n]) / wt(Ynew[n], n));
    return err;
  };
  const t0 = Date.now();
  let Y = Y0.slice(), V = 0, h = Vtot / 200, steps = 0, rej = 0, nextOut = Vtot / o.nOut, stiffAt = null, jacs = 0;
  o.rec(0, Y);
  const accept = (Vn, Yn) => {
    V = Vn; Y = Yn;
    // a fully consumed species ends within the error tolerance of zero: clip it; a clearly negative
    // flow means a zero-order (or negative-order) rate kept running after the reactant was exhausted
    const tolNeg = Math.max(1e-10, 100 * rtol) * scale;
    for (let i = 0; i < n; i++) if (Y[i] < 0 && Y[i] > -tolNeg) Y[i] = 0;
    if (Y.slice(0, n).some((v) => v < -tolNeg)) fail('MB_PFR_NEG', `${label}: a molar flow went negative — a reactant is exhausted; check orders and rate constants`, 'reactions');
    if (V >= nextOut * (1 - 1e-12) || V >= Vtot * (1 - 1e-12)) { o.rec(V, Y); nextOut = Math.min(Vtot, nextOut + Vtot / o.nOut); }
  };
  const guard = () => {
    if (Date.now() - t0 > o.budget) fail('MB_PFR_BUDGET', `${label}: integration exceeded the time budget at V = ${V.toPrecision(4)} m³ of ${Vtot.toPrecision(4)} (raise rtol or check the rate constants)`, 'reactions');
    if (++steps > 200000) fail('MB_PFR_STEPS', `${label}: too many integration steps`, 'reactions');
  };
  const clampH = () => { h = Math.min(h, Vtot - V); if (nextOut - V > 1e-12 * Vtot) h = Math.min(h, nextOut - V); };
  // ---- stiffness at the inlet: spectral radius of the Jacobian (power iteration) × volume ----
  const jacobian = (Vx, Yx, F0) => {
    const J = [];
    for (let r = 0; r < N; r++) J.push(new Array(N).fill(0));
    for (let c = 0; c < N; c++) {
      const d = c < n ? 1e-7 * Math.max(Math.abs(Yx[c]), 1e-5 * scale) : 1e-7 * Math.max(1, Math.abs(Yx[c]));
      const yp = Yx.slice(); yp[c] += d;
      const Fp = rhs(Vx, yp);
      for (let r = 0; r < N; r++) J[r][c] = (Fp[r] - F0[r]) / d;
    }
    return J;
  };
  let k0 = rhs(V, Y), iasti = 0, nonsti = 0;
  if (!k0.every(Number.isFinite)) fail('MB_PFR_RATE', `${label}: the rate equations cannot be evaluated at the inlet (check the feed, rate constants and orders)`, 'reactions');
  {
    const J = jacobian(V, Y, k0);
    if (J.every((row) => row.every(Number.isFinite))) {
      // power iteration on the similarity-scaled Jacobian D·J·D⁻¹ (D = 1/error weights, so flows and
      // the enthalpy flow are comparable); growth rate over the last iterations ≈ spectral radius
      const wv = Y.map((y, i) => wt(y, i));
      const Js = J.map((row, r) => row.map((x, c) => x * wv[c] / wv[r]));
      let v = Js.map((_, i) => 1 + 0.1 * Math.sin(i + 1)), logs = [];
      for (let it = 0; it < 24; it++) {
        const w = Js.map((row) => row.reduce((a, x, c) => a + x * v[c], 0));
        const nw = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
        if (!(nw > 0)) { logs = []; break; }
        logs.push(Math.log(nw)); v = w.map((x) => x / nw);
      }
      const rho = logs.length >= 12 ? Math.exp(logs.slice(-12).reduce((a, b) => a + b, 0) / 12) : 0;
      if (rho * Vtot > 1000) stiffAt = 0;
    }
  }
  // ---- explicit phase ----
  while (V < Vtot * (1 - 1e-12) && stiffAt === null) {
    guard(); clampH();
    const k = [k0], Ys = [Y];
    for (let s = 1; s < 7; s++) {
      const y = Y.map((y0, i) => { let acc = y0; for (let q = 0; q < s; q++) acc += h * DP_A[s][q] * k[q][i]; return acc; });
      Ys.push(y); k.push(rhs(V + DP_C[s] * h, y));
    }
    const Y5 = Ys[6];
    const E = Y.map((y, i) => h * DP_B5.reduce((a, b, s) => a + (b - DP_B4[s]) * k[s][i], 0));
    let err = errOf(Y5, E);
    if (!Number.isFinite(err)) err = Infinity;
    if (err <= 1 || (h < 1e-14 * Vtot && Number.isFinite(err))) {
      // Hairer's stiffness detection: h·|λ| ≈ h‖k7 − k6‖ / ‖y7 − y6‖ near the stability boundary (3.25)
      let num2 = 0, den2 = 0;
      for (let i = 0; i < N; i++) { const w = wt(Y5[i], i); num2 += ((k[6][i] - k[5][i]) / w) ** 2; den2 += ((Y5[i] - Ys[5][i]) / w) ** 2; }
      const hl = den2 > 0 ? h * Math.sqrt(num2 / den2) : 0;
      if (hl > 3.25) { nonsti = 0; if (++iasti >= 15) stiffAt = V + h; } else if (++nonsti >= 6) iasti = 0;
      accept(V + h, Y5); k0 = k[6];
      h *= Math.min(5, 0.9 * Math.pow(Math.max(err, 1e-10), -0.2));
    } else { rej++; h *= Number.isFinite(err) ? Math.max(0.1, 0.9 * Math.pow(err, -0.25)) : 0.1; }
    if (stiffAt === null && steps > 1500 && V < 0.5 * Vtot) stiffAt = V;   // slow progress: treat as stiff
  }
  // ---- stiff phase: RODAS3 ----
  if (V < Vtot * (1 - 1e-12)) {
    const g = 0.5;
    let lastRejected = false;
    while (V < Vtot * (1 - 1e-12)) {
      guard(); clampH();
      const F0 = rhs(V, Y);
      if (!F0.every(Number.isFinite)) fail('MB_PFR_RATE', `${label}: the rate equations returned a non-finite value at V = ${V.toPrecision(4)} m³ (check rate constants and orders)`, 'reactions');
      const J = jacobian(V, Y, F0);
      jacs++;
      let Ft = null;
      if (!o.autonomous) { const dv = 1e-7 * Vtot; const Fv = rhs(V + dv, Y); Ft = Fv.map((v, i) => (v - F0[i]) / dv); }
      for (;;) {
        const L = luFactor(J.map((row, r) => row.map((v, c) => -v + (r === c ? 1 / (h * g) : 0))));
        if (!J.every((row) => row.every(Number.isFinite))) fail('MB_PFR_JAC', `${label}: the rate equations returned a non-finite value at V = ${V.toPrecision(4)} m³ (check rate constants and orders)`, 'reactions');
        if (!L) { h *= 0.25; rej++; guard(); continue; }
        const K1 = luSolve(L, F0.map((v, i) => v + (Ft ? h * 0.5 * Ft[i] : 0)));
        const K2 = luSolve(L, F0.map((v, i) => v + 4 / h * K1[i] + (Ft ? h * 1.5 * Ft[i] : 0)));
        const Y3 = Y.map((v, i) => v + 2 * K1[i]);
        let ok = Y3.slice(0, n).every((v) => v > -1e-6 * scale);
        let Ynew = null, E = null;
        if (ok) {
          const F3 = rhs(V + h, Y3);
          const K3 = luSolve(L, F3.map((v, i) => v + (K1[i] - K2[i]) / h));
          const Y4 = Y3.map((v, i) => v + K3[i]);
          ok = Y4.slice(0, n).every((v) => v > -1e-6 * scale);
          if (ok) {
            const F4 = rhs(V + h, Y4);
            E = luSolve(L, F4.map((v, i) => v + (K1[i] - K2[i] - 8 / 3 * K3[i]) / h));
            Ynew = Y4.map((v, i) => v + E[i]);
          }
        }
        const err = ok && Ynew.every(Number.isFinite) ? errOf(Ynew, E) : Infinity;
        if (Number.isFinite(err) && (err <= 1 || h < 1e-20 * Vtot)) {
          accept(V + h, Ynew);
          let fac = Math.min(6, Math.max(0.2, 0.9 * Math.pow(Math.max(err, 1e-12), -1 / 3)));
          if (lastRejected) fac = Math.min(1, fac);
          h *= fac; lastRejected = false;
          break;
        }
        rej++; lastRejected = true;
        h *= isFinite(err) ? Math.max(0.2, 0.9 * Math.pow(err, -1 / 3)) : 0.25;
        if (h < 1e-22 * Vtot || V + h === V) fail('MB_PFR_STEP', `${label}: the step size collapsed at V = ${V.toPrecision(4)} (the rate equations cannot be integrated there — check rate constants and orders)`, 'reactions');
        guard(); clampH();
      }
    }
  }
  return { Y, steps, rejected: rej, stiffAt, jacobians: jacs,
    solver: stiffAt === null ? 'Dormand–Prince RK5(4), adaptive' : stiffAt === 0 ? 'RODAS3 Rosenbrock (stiff kinetics from the inlet)' : `Dormand–Prince RK5(4), switched to RODAS3 (stiff) at V = ${Number(stiffAt.toPrecision(4))} m³` };
}

// ---------------------------------------------------------------------------
// CSTR
// ---------------------------------------------------------------------------
function solveCSTRk(inp) {
  const label = 'r-cstr';
  if (!inp || !Array.isArray(inp.streams) || !inp.streams.length) fail('MB_INPUT', `${label}: at least one inlet stream`, 'streams');
  const p = inp.params || {};
  const extra = Array.isArray(p.products) ? p.products : [];
  const rxKeys = Array.isArray(p.reactions) ? p.reactions.flatMap((r) => Object.keys((r && r.stoich) || {})) : [];
  const pp = units.pkg(p.property_package, [...new Set(keysOf(...inp.streams).concat(rxKeys, extra))]);
  const w = pp.warnings.slice();
  const K = setupKinetics(pp, p, label);
  const f = feedState(pp, inp.streams, label);
  if (!(num(p.volume_m3) && p.volume_m3 > 0)) fail('MB_CSTR_V', `${label}: volume_m3 required`, 'volume_m3');
  const Vr = p.volume_m3;
  const mode = ['isothermal', 'adiabatic', 'duty'].includes(p.thermal) ? p.thermal : 'isothermal';
  const P = num(p.P_bar) ? p.P_bar * 1e5 : f.P;
  const n = pp.n, m = K.rx.length;
  const F0 = f.mol.map((v) => v / 3600);
  const yOf = (F) => { const s = F.reduce((a, b) => a + Math.max(b, 0), 0); return F.map((v) => Math.max(v, 0) / s); };
  const Fof = (xi) => F0.map((v, i) => { let s = v; for (let j = 0; j < m; j++) s += K.rx[j].nu[i] * xi[j]; return s; });
  const iso = mode === 'isothermal';
  const Tiso = num(p.T_K) ? p.T_K : f.T;
  // enthalpy target for the reacting-phase model: inlet (rigorous) + duty
  const Hin_kW = f.H / KJH;
  const Qd = mode === 'duty' ? (num(p.duty_kW) ? p.duty_kW : 0) : 0;
  // the reacting-phase enthalpy of the inlet at its own T (consistent basis for the balance)
  const hin_phase = F0.reduce((a, b) => a + b, 0) * hAt(pp, K, f.T, P, yOf(F0));
  const resid = (u) => {
    const xi = u.slice(0, m), T = iso ? Tiso : u[m];
    const F = Fof(xi);
    const r = rates(pp, K, T, P, F);
    const g = xi.map((x, j) => x - Vr * r[j]);
    if (!iso) {
      const Ft = F.reduce((a, b) => a + b, 0);
      g.push((Ft * hAt(pp, K, T, P, yOf(F)) - hin_phase - Qd) / Math.max(1, Math.abs(hin_phase)));
    }
    return g;
  };
  const N = iso ? m : m + 1;
  const scaleX = F0.reduce((a, b) => a + b, 0);
  const feasible = (u) => Fof(u.slice(0, m)).every((v) => v >= -1e-12 * scaleX) && (iso || u[m] > 20);
  const newton = (u0) => {
    let u = u0.slice();
    for (let it = 0; it < 200; it++) {
      const g = resid(u);
      let gn = 0; for (let j = 0; j < m; j++) gn = Math.max(gn, Math.abs(g[j]) / scaleX); if (!iso) gn = Math.max(gn, Math.abs(g[m]));
      if (gn < 1e-11) return { u, it };
      const J = [];
      for (let r0 = 0; r0 < N; r0++) J.push(new Array(N).fill(0));
      for (let c = 0; c < N; c++) {
        const hh = c < m ? 1e-7 * scaleX + 1e-7 * Math.abs(u[c]) : 1e-4;
        const up = u.slice(); up[c] += hh;
        const gp = resid(up);
        for (let r0 = 0; r0 < N; r0++) J[r0][c] = (gp[r0] - g[r0]) / hh;
      }
      const d = solveLin(J, g.map((v) => -v));
      if (!d) return null;
      let s = 1;
      for (let k = 0; k < 40; k++) {
        const un = u.map((v, i) => v + s * d[i]);
        if (feasible(un)) {
          const gn2 = resid(un);
          let nn = 0; for (let j = 0; j < m; j++) nn = Math.max(nn, Math.abs(gn2[j]) / scaleX); if (!iso) nn = Math.max(nn, Math.abs(gn2[m]));
          if (nn < gn || s < 1e-3) { u = un; break; }
        }
        s *= 0.5;
        if (k === 39) return null;
      }
    }
    return null;
  };
  // starts: no reaction, then progressively larger extents (and hotter / colder for adiabatic)
  const starts = [];
  const Test = !iso && num(p.T_estimate_K) && p.T_estimate_K > 20 ? p.T_estimate_K : null;
  const Tst = iso ? [null] : [f.T, f.T + 100, f.T + 300, Math.max(250, f.T - 50), f.T + 600, f.T + 1000];
  // a temperature estimate (Aspen RCSTR "initial estimate") is tried first, with every extent guess,
  // so a chosen steady state of a multiple-steady-state reactor can be reached
  const estStarts = [];
  if (Test) for (const fr of [0, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    const xi = K.rx.map((r) => { let lim = Infinity; r.nu.forEach((v, i) => { if (v < 0) lim = Math.min(lim, F0[i] / -v); }); return fr * (isFinite(lim) ? lim : 0) / m; });
    estStarts.push(xi.concat([Test]));
  }
  for (const fr of [0, 0.5, 0.9, 0.99]) for (const Ts of Tst) {
    // extent so that the limiting reactant of each reaction is converted by fr
    const xi = K.rx.map((r) => { let lim = Infinity; r.nu.forEach((v, i) => { if (v < 0) lim = Math.min(lim, F0[i] / -v); }); return fr * (isFinite(lim) ? lim : 0) / m; });
    starts.push(iso ? xi : xi.concat([Ts]));
  }
  let sol = null, how = 'Newton on the reaction extents';
  if (estStarts.length) {
    // the steady state closest to the temperature estimate
    for (const s0 of estStarts) {
      if (!feasible(s0)) continue;
      const q = newton(s0);
      if (q && (!sol || Math.abs(q.u[m] - Test) < Math.abs(sol.u[m] - Test))) sol = q;
    }
    if (sol) how = 'Newton on the reaction extents, from the temperature estimate';
  }
  if (!sol) for (const s0 of starts) { if (!feasible(s0)) continue; sol = newton(s0); if (sol) break; }
  // non-isothermal: look for other steady states from the remaining starts (multiplicity check)
  const found = [];
  if (sol && !iso) {
    const t0 = Date.now();
    found.push(sol.u.slice());
    for (const s0 of estStarts.concat(starts)) {
      if (Date.now() - t0 > 400) break;
      if (!feasible(s0)) continue;
      const q = newton(s0);
      if (q && found.every((u) => Math.abs(u[m] - q.u[m]) > 0.01)) found.push(q.u.slice());
    }
    found.sort((a, b) => a[m] - b[m]);
  }
  let xi, T, Fss = null;
  if (sol) { xi = sol.u.slice(0, m); T = iso ? Tiso : sol.u[m]; }
  else {
    // fallback for very fast (stiff) kinetics: pseudo-transient continuation — the start-up of
    // the stirred tank from feed, dF/dτ = F0 − F + V Σ ν r(F, T), dH/dτ = H0 + Q − H (τ in
    // residence times), integrated with the L-stable RODAS3 method to the steady state
    const Htarget = hin_phase + Qd;
    let Tl = iso ? Tiso : f.T;
    const Tst = (Y) => {
      if (iso) return Tiso;
      const Fp = Y.slice(0, n), Ft = Fp.reduce((a, b) => a + Math.max(b, 0), 0);
      const t = TfromH(pp, K, P, yOf(Fp), Y[n] / Ft, Tl);
      if (Number.isFinite(t)) Tl = t;
      return t;
    };
    const rhsT = (_tau, Y) => {
      const Fp = Y.slice(0, n);
      const t = Tst(Y);
      if (!Number.isFinite(t) || Fp.some((v) => !Number.isFinite(v))) return new Array(n + 1).fill(NaN);
      const r = rates(pp, K, t, P, Fp);
      const d = Fp.map((v, i) => F0[i] - v);
      for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) if (K.rx[j].nu[i]) d[i] += Vr * K.rx[j].nu[i] * r[j];
      d.push(iso ? 0 : Htarget - Y[n]);
      return d;
    };
    try {
      const ig = integrate(rhsT, F0.concat([iso ? 0 : hin_phase]), 80, { n, rtol: 1e-9, scale: scaleX, energyErr: !iso, autonomous: true,
        rec: () => {}, nOut: 1, budget: num(p.budget_ms) ? Math.min(p.budget_ms, 4000) : 4000, label });
      // converge on the root in flow space with a few Newton steps: with very fast kinetics the
      // raw residual is dominated by round-off amplified by the rate derivatives, so convergence
      // is judged by the size of the Newton correction instead
      let Y = ig.Y.slice(), stepN = Infinity;
      const N1 = n + 1;
      for (let it = 0; it < 6; it++) {
        const g0 = rhsT(0, Y);
        if (!g0.every(Number.isFinite)) break;
        const J = [];
        for (let r0 = 0; r0 < N1; r0++) J.push(new Array(N1).fill(0));
        for (let c = 0; c < N1; c++) {
          const d = c < n ? 1e-7 * Math.max(Math.abs(Y[c]), 1e-5 * scaleX) : 1e-7 * Math.max(1, Math.abs(Y[c]));
          const yp = Y.slice(); yp[c] += d;
          const gp = rhsT(0, yp);
          for (let r0 = 0; r0 < N1; r0++) J[r0][c] = (gp[r0] - g0[r0]) / d;
        }
        if (iso) { for (let c = 0; c < N1; c++) J[n][c] = c === n ? -1 : 0; }
        const dl = solveLin(J, g0.map((v) => -v));
        if (!dl || !dl.every(Number.isFinite)) break;
        const sN = Math.max(...dl.slice(0, n).map((v) => Math.abs(v))) / scaleX;
        const Yn = Y.map((v, i) => v + dl[i]);
        if (Yn.slice(0, n).some((v) => v < -1e-9 * scaleX) || !(sN <= stepN * 2 || it === 0)) break;
        Y = Yn.map((v, i) => (i < n ? Math.max(v, 0) : v)); stepN = sN;
        if (sN < 1e-12) break;
      }
      const Fp = Y.slice(0, n), t = Tst(Y);
      const resN = stepN;
      if (Number.isFinite(t) && resN < 1e-8) {
        // extents by least squares on ν (independent reactions): (ν νᵀ) ξ = ν (F − F0)
        const A = K.rx.map((ra) => K.rx.map((rb) => ra.nu.reduce((a, v, i) => a + v * rb.nu[i], 0)));
        const bb = K.rx.map((ra) => ra.nu.reduce((a, v, i) => a + v * (Fp[i] - F0[i]), 0));
        const x = solveLin(A, bb);
        if (x) { xi = x; T = t; Fss = Fp; sol = { it: ig.steps }; how = 'pseudo-transient continuation (RODAS3) to the steady state'; }
      }
    } catch (_e) { /* fall through to the error below */ }
    if (!sol) fail('MB_CSTR_CONV', `${label}: no steady state found (try another volume, rate constant or thermal mode)`, 'reactions');
  }
  const Fend = (Fss || Fof(xi)).map((v) => Math.max(v, 0));
  const Fh = Fend.reduce((a, b) => a + b, 0);
  const Hout_target = iso ? 0 : Hin_kW + Qd;      // kW: rigorous inlet enthalpy + duty (the reacting-phase balance holds at the solution)
  const out = iso ? outlet(pp, Fend.map((v) => v * 3600), T, P, 0, true) : outlet(pp, Fend.map((v) => v * 3600), T, P, Hout_target * KJH, false);
  const conv = {};
  pp.keys.forEach((k, i) => { if (F0[i] > 0 && Fend[i] < F0[i] && K.rx.some((r) => r.nu[i] < 0)) conv[k] = r7(1 - Fend[i] / F0[i]); });
  const aw = acidWarning(pp, K, label); if (aw) w.push(aw);
  { const sw = supercriticalWarning(pp, K, label, T, Fend); if (sw) w.push(sw); }
  const kr = K.rx[0].nu.findIndex((v, i) => v < 0 && F0[i] > 0);
  const ss = found.map((u) => ({ T_K: r7(u[m]), conversion: kr >= 0 ? r7(1 - Fof(u.slice(0, m))[kr] / F0[kr]) : null }));
  if (ss.length > 1) w.push(`${label}: ${ss.length} steady states found (T = ${ss.map((q) => q.T_K.toFixed(1)).join(', ')} K) — the one at ${T.toFixed(1)} K is reported; set a temperature estimate to choose another`);
  if (!iso && Math.abs(out.T_K - T) > 0.5) w.push(`${label}: the outlet flash differs from the reacting-phase temperature by ${(out.T_K - T).toFixed(2)} K (phase change at the outlet)`);
  const vm = pp.volPhase(T, P, yOf(Fend), K.phase);
  const tau = Vr / (Fh * 1000 * vm);                      // s, at outlet conditions
  return result([out], f.mass, f.H, out.H_kJh, {
    pp: { model: pp.model, label: pp.label }, phase: K.phase, thermal: mode, volume_m3: Vr, T_K: r7(T), duty_kW: (out.H_kJh - f.H) / KJH,
    extents_kmol_h: xi.map((v) => r7(v * 3600)), rates_kmol_m3_s: rates(pp, K, T, P, Fend).map(r7), conversion: conv, outlet_mole_frac: compObj(pp, Fend),
    heat_of_reaction: heatsOfReaction(pp, K, T, P, Fend), T_out_K: out.T_K,
    residence_time_s: r7(tau), solver: how, newton_iterations: sol.it, steady_states: ss.length > 1 ? ss : undefined }, w);
}

function solveLin(A, b) {
  const n = b.length;
  const a = A.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) { const f = a[r][c] / a[c][c]; if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = a[r][n]; for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k]; x[r] = s / a[r][r]; }
  return x;
}

export const KINETIC_MODULES = { 'r-pfr': solvePFR, 'r-cstr': solveCSTRk };
export default { KINETICS_VERSION, KINETIC_MODULES };
