// ============================================================================
// mb-pipe.js — STEP 33: pipe segment on the property methods.
//
//   r-pipe   straight pipe of given length, inside diameter, roughness and
//            elevation change, marched in segments. Per segment:
//              friction     Darcy–Weisbach, f from Churchill (1977) — laminar,
//                           transition and turbulent in one expression
//              two-phase    homogeneous (no-slip) model: ρ_m = 1/Σ(w_k/ρ_k),
//                           μ_m = 1/Σ(w_k/μ_k) (McAdams, mass fractions)
//              elevation    ρ_m g Δz;   acceleration  G² Δ(1/ρ_m)
//              fittings     Σ K spread over the length (ΔP = K ρ v²/2)
//              energy       h + v²/2 + g z changes only by the heat exchanged
//                           with the surroundings (adiabatic, isothermal, or
//                           U·πD·ΔL·(T_amb − T)); the state at each node is a
//                           P–H flash of the property method
//            Checks: API RP 14E erosional velocity V_e = C/√ρ_m (C = 100
//            continuous service unless given; 122 C/√ρ in SI), and the Mach
//            number of a vapour from the isentropic sound speed (P–S flash);
//            the march stops with an error if the flow chokes.
//
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import units from './mb-units.js';

export const PIPE_VERSION = 'mb-pipe 1.0.0';
const K = units.KIT;
const { th, num, fail } = K;
const G = 9.80665;

/** Churchill (1977) Darcy friction factor, all regimes */
export function churchill(Re, eD) {
  if (!(Re > 0)) return 0;
  const A = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / Re, 0.9) + 0.27 * eD)), 16);
  const B = Math.pow(37530 / Re, 16);
  return 8 * Math.pow(Math.pow(8 / Re, 12) + 1 / Math.pow(A + B, 1.5), 1 / 12);
}

/** homogeneous mixture properties of a flash state: ρ_m, μ_m, vapour mass fraction */
function mixProps(pp, r) {
  const pr = th.properties(pp, r);
  let wsum = 0, inv = 0, wv = 0;
  const ws = pr.phases.map((ph) => ph.fraction * ph.MW);
  wsum = ws.reduce((a, b) => a + b, 0);
  pr.phases.forEach((ph, k) => { const w = ws[k] / wsum; inv += w / ph.mu_Pas; if (ph.type === 'vapour') wv += w; });
  return { rho: pr.rho_kgm3, mu: 1 / inv, wv, MW: pr.MW, phases: pr.phases };
}

function solvePipe(inp) {
  const { streams, params: p } = K.input(inp, 1, 1, 'r-pipe');
  const pp = K.pkg(p.property_package, K.keysOf(streams[0]));
  const w = pp.warnings.slice();
  const st = K.stateIn(pp, streams[0], 'r-pipe inlet');
  const L = p.length_m, D = p.diameter_m;
  if (!(num(L) && L > 0)) fail('MB_PIPE_L', 'r-pipe: length_m must be > 0', 'length_m');
  if (!(num(D) && D > 0 && D < 10)) fail('MB_PIPE_D', 'r-pipe: diameter_m (inside diameter) must be between 0 and 10 m', 'diameter_m');
  const eps = (num(p.roughness_mm) ? p.roughness_mm : 0.0457) / 1000;
  if (eps < 0 || eps > 0.05 * D) fail('MB_PIPE_EPS', 'r-pipe: roughness_mm must be between 0 and 5 % of the diameter', 'roughness_mm');
  const dz = num(p.elevation_m) ? p.elevation_m : 0;
  if (Math.abs(dz) > L) fail('MB_PIPE_Z', 'r-pipe: the elevation change cannot exceed the length', 'elevation_m');
  const Kf = num(p.fittings_K) ? p.fittings_K : 0;
  if (Kf < 0) fail('MB_PIPE_K', 'r-pipe: fittings_K must be ≥ 0', 'fittings_K');
  const N = num(p.segments) ? Math.min(400, Math.max(1, Math.round(p.segments))) : 20;
  const thermal = p.thermal === undefined ? (num(p.U_W_m2K) ? 'heat_loss' : 'adiabatic') : p.thermal;
  if (!['adiabatic', 'isothermal', 'heat_loss'].includes(thermal)) fail('MB_PIPE_THERMAL', "r-pipe: thermal must be 'adiabatic', 'isothermal' or 'heat_loss'", 'thermal');
  if (thermal === 'heat_loss' && !(num(p.U_W_m2K) && num(p.T_ambient_K))) fail('MB_PIPE_U', 'r-pipe: heat_loss needs U_W_m2K (on the inside area) and T_ambient_K', 'U_W_m2K');
  const Ce = num(p.erosional_C) ? p.erosional_C : 100;
  const A = Math.PI * D * D / 4;
  const mdot = streams[0].mass_flow_kg_h / 3600;          // kg/s
  if (!(mdot > 0)) fail('MB_PIPE_FLOW', 'r-pipe: the inlet flow must be positive', 'streams');
  const Gm = mdot / A;                                    // kg/(m² s)
  const F = st.F, z = st.z;
  const MWm = z.reduce((a, v, i) => a + v * pp.MW[i], 0); // kg/kmol
  const hMass = (h) => h / MWm * 1000;                    // J/mol → J/kg
  const dL = L / N, dZ = dz / N;
  let r = st.r, P = st.P, T = st.T;
  let mp = mixProps(pp, r);
  let hJkg = hMass(st.h);
  let v = Gm / mp.rho;
  const v0 = v;
  const T0 = T;
  let Qtot = 0, dpF = 0, dpZ = 0, dpA = 0, dpK = 0;
  let maxV = v, maxRatio = 0, maxMach = 0, minRe = Infinity, maxRe = 0;
  const prof = [{ L_m: 0, P_bar: P / 1e5, T_K: T, vapour_fraction: r.phase === 'V' ? 1 : r.phase === 'L' ? 0 : r.beta, rho_kgm3: mp.rho, v_ms: v }];
  const fric = (m) => { const Re = Gm * D / m.mu; return { Re, f: churchill(Re, eps / D) }; };
  const nodeAt = (Pn, hn, Tg) => {
    if (thermal === 'isothermal') return th.flashPT(pp, z, T0, Pn);
    return th.flashPH(pp, z, Pn, hn * MWm / 1000, Tg);
  };
  for (let k = 0; k < N; k++) {
    // predictor at the segment inlet, corrector with the average of both ends (Heun)
    const fr0 = fric(mp);
    const grad0 = fr0.f * Gm * Gm / (2 * D * mp.rho) + mp.rho * G * dZ / dL + Kf / L * Gm * Gm / (2 * mp.rho);
    let P1 = P - grad0 * dL;
    if (!(P1 > 0)) fail('MB_PIPE_CHOKE', `r-pipe: pressure falls to zero ${(k * dL).toFixed(1)} m along the pipe — the line cannot pass this flow (choked or undersized)`, 'diameter_m');
    let q = 0, r1, m1, h1, v1;
    for (let pass = 0; pass < 3; pass++) {
      const Tm = pass === 0 ? T : 0.5 * (T + r1.T);
      q = thermal === 'heat_loss' ? p.U_W_m2K * Math.PI * D * dL * (p.T_ambient_K - Tm) / mdot : 0;   // J/kg
      v1 = pass === 0 ? v : Gm / m1.rho;
      h1 = hJkg + q - G * dZ - 0.5 * (v1 * v1 - v * v);
      r1 = nodeAt(P1, h1, T);
      m1 = mixProps(pp, r1);
      const fr1 = fric(m1);
      const rhoA = 0.5 * (mp.rho + m1.rho);
      const fA = 0.5 * (fr0.f + fr1.f);
      const dF = fA * Gm * Gm / (2 * D) * 0.5 * (1 / mp.rho + 1 / m1.rho) * dL;
      const dG = rhoA * G * dZ;
      const dAc = Gm * Gm * (1 / m1.rho - 1 / mp.rho);
      const dK = Kf / L * dL * Gm * Gm / 2 * 0.5 * (1 / mp.rho + 1 / m1.rho);
      const Pn = P - dF - dG - dAc - dK;
      if (!(Pn > 0)) fail('MB_PIPE_CHOKE', `r-pipe: pressure falls to zero ${((k + 1) * dL).toFixed(1)} m along the pipe — the line cannot pass this flow (choked or undersized)`, 'diameter_m');
      const conv = Math.abs(Pn - P1) < 1e-7 * P;
      P1 = Pn;
      if (pass === 2 || conv) { dpF += dF; dpZ += dG; dpA += dAc; dpK += dK; break; }
    }
    if (thermal === 'isothermal') { r1 = th.flashPT(pp, z, T0, P1); m1 = mixProps(pp, r1); }
    else { v1 = Gm / m1.rho; h1 = hJkg + q - G * dZ - 0.5 * (v1 * v1 - v * v); r1 = nodeAt(P1, h1, r1.T); m1 = mixProps(pp, r1); }
    const v2 = Gm / m1.rho;
    if (thermal === 'isothermal') { const hn = hMass(th.hOf(pp, r1)); q = hn - hJkg + G * dZ + 0.5 * (v2 * v2 - v * v); h1 = hn; }
    Qtot += q * mdot;
    const fr = fric(m1);
    minRe = Math.min(minRe, fr.Re); maxRe = Math.max(maxRe, fr.Re);
    P = P1; r = r1; mp = m1; hJkg = thermal === 'isothermal' ? h1 : hMass(th.hOf(pp, r1)); T = r1.T; v = v2;
    maxV = Math.max(maxV, v);
    maxRatio = Math.max(maxRatio, v / (1.22 * Ce / Math.sqrt(mp.rho)));
    if ((k + 1) % Math.max(1, Math.round(N / 40)) === 0 || k === N - 1) prof.push({ L_m: (k + 1) * dL, P_bar: P / 1e5, T_K: T, vapour_fraction: r.phase === 'V' ? 1 : r.phase === 'L' ? 0 : r.beta, rho_kgm3: mp.rho, v_ms: v });
  }
  // sound speed of a vapour at the outlet (isentropic, by a P–S flash 0.5 % lower)
  let mach = null;
  if (r.phase === 'V') {
    try {
      const s0 = th.sOf(pp, r), P2 = P * 0.995;
      const r2 = th.flashPS(pp, z, P2, s0, T);
      const rho2 = mixProps(pp, r2).rho;
      const c = Math.sqrt((P - P2) / (mp.rho - rho2));
      if (num(c) && c > 0) { mach = v / c; maxMach = mach; }
    } catch (_e) { /* informative */ }
  }
  if (mach !== null && mach > 0.3) w.push(`r-pipe: outlet Mach number ${mach.toFixed(2)} — compressible flow is significant${mach > 0.7 ? '; close to choking, shorten segments or enlarge the line' : ''}`);
  if (maxRatio > 1) w.push(`r-pipe: velocity exceeds the API RP 14E erosional velocity (C = ${Ce}) by ${(100 * (maxRatio - 1)).toFixed(0)} %`);
  const vfOut = r.phase === 'V' ? 1 : r.phase === 'L' ? 0 : r.beta;
  if (vfOut > 0 && vfOut < 1) w.push('r-pipe: two-phase flow — homogeneous (no-slip) model; slip and flow-pattern effects (Beggs–Brill and similar) are not modelled');
  if (minRe > 2300 && minRe < 4000 || maxRe > 2300 && maxRe < 4000) w.push('r-pipe: Reynolds number in the laminar–turbulent transition (2300–4000) — friction factor uncertain');
  const out = K.streamOut(pp, F, z, r);
  const dpT = st.P - P;
  const details = {
    pp: { model: pp.model, label: pp.label }, length_m: L, diameter_m: D, roughness_mm: eps * 1000, elevation_m: dz, fittings_K: Kf, segments: N, thermal,
    dp_bar: dpT / 1e5, dp_friction_bar: dpF / 1e5, dp_elevation_bar: dpZ / 1e5, dp_acceleration_bar: dpA / 1e5, dp_fittings_bar: dpK / 1e5,
    dp_per_100m_bar: dpT / 1e5 / L * 100,
    P_out_bar: P / 1e5, T_out_K: T, vapour_fraction_out: vfOut,
    velocity_in_ms: v0, velocity_out_ms: v, velocity_max_ms: maxV, mass_flux_kgm2s: Gm,
    reynolds_in: Gm * D / mixProps(pp, st.r).mu, reynolds_out: Gm * D / mp.mu, friction_factor_out: churchill(Gm * D / mp.mu, eps / D),
    erosional_velocity_ms: 1.22 * Ce / Math.sqrt(mp.rho), erosional_ratio_max: maxRatio, erosional_C: Ce,
    mach_out: mach === null ? undefined : mach, heat_kW: Qtot / 1000,
    rhov2_out_Pa: mp.rho * v * v,
    method: 'Darcy–Weisbach with the Churchill friction factor; homogeneous two-phase; property-method P–H flash at each node',
    profile: prof,
  };
  // energy balance: stream enthalpies exclude kinetic and potential energy, which the duty here carries
  return K.result([out], st.mass, st.H_kJh, out.H_kJh, 0, details, w);
}

export const PIPE_MODULES = { 'r-pipe': solvePipe };
export default { PIPE_VERSION, PIPE_MODULES, churchill };
