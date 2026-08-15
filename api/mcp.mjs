// =============================================================================
// multicalci.com — MCP Server  (v1.3, zero-dependency)
// -----------------------------------------------------------------------------
// Exposes multicalci calculation engines as Model Context Protocol tools so AI
// assistants (Claude, ChatGPT, Cursor, etc.) call YOUR standards-referenced code
// instead of improvising the arithmetic.
//
//   Deploy path : api/mcp.mjs
//   Endpoint    : https://www.multicalci.com/api/mcp
//   Transport   : Streamable HTTP, stateless (plain JSON responses, no SSE)
//   Dependencies: NONE. No package.json edit, no mcp-handler, no zod, no SDK.
//
// Why zero-dependency: mcp-handler targets Next.js/Nuxt route handlers
// (Web Request -> Response). This repo is static HTML + classic Vercel Node
// functions, so raw JSON-RPC is both simpler and more robust here.
//
// v1.3 changes vs v1.2:
//   - added tool #9  tank_volume  (exact partial-fill, ASME F&D by quadrature)
//   - Peng-Robinson phase resolved by fugacity equality, not root count
//   - explicit ISO 5167 / IEC 60534 validity warnings returned with results
// =============================================================================

const BRAND = "\n\nComputed by multicalci.com — https://www.multicalci.com";
const SERVER = { name: "multicalci", version: "1.3.0" };

/* ===========================================================================
   1. ENGINES
   ======================================================================== */

const G = 9.80665;
const RGAS = 8.314462618; // J/(mol·K)

/* --- friction factor ---------------------------------------------------- */
function frictionFactor(Re, relRough) {
  if (Re <= 0) return { f: 0, regime: "no flow" };
  if (Re < 2300) return { f: 64 / Re, regime: "laminar" };
  // Colebrook-White, Newton on x = 1/sqrt(f)
  let x = -2 * Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9)); // Swamee-Jain seed
  for (let i = 0; i < 60; i++) {
    const g = x + 2 * Math.log10(relRough / 3.7 + 2.51 * x / Re);
    const dg = 1 + (2 / Math.LN10) * (2.51 / Re) / (relRough / 3.7 + 2.51 * x / Re);
    const xn = x - g / dg;
    if (!isFinite(xn)) break;
    if (Math.abs(xn - x) < 1e-12) { x = xn; break; }
    x = xn;
  }
  return { f: 1 / (x * x), regime: Re < 4000 ? "transitional" : "turbulent" };
}

function pipePressureDrop(a) {
  const D = a.diameter_mm / 1000;
  const A = Math.PI * D * D / 4;
  const Q = a.flow_m3h / 3600;
  const v = Q / A;
  const Re = a.density_kgm3 * v * D / (a.viscosity_cp / 1000);
  const rr = (a.roughness_mm / 1000) / D;
  const { f, regime } = frictionFactor(Re, rr);
  const dpFric = f * (a.length_m / D) * a.density_kgm3 * v * v / 2;
  const dpFit = (a.fitting_k_total || 0) * a.density_kgm3 * v * v / 2;
  const dpElev = a.density_kgm3 * G * (a.elevation_change_m || 0);
  const total = dpFric + dpFit + dpElev;
  return {
    velocity_m_s: r(v, 4),
    reynolds_number: Re < 100 ? r(Re, 4) : r(Re, 0), // keep precision in viscous service
    flow_regime: regime,
    friction_factor_darcy: r(f, 5),
    relative_roughness: r(rr, 6),
    friction_drop_pa: r(dpFric, 1),
    fitting_drop_pa: r(dpFit, 1),
    elevation_drop_pa: r(dpElev, 1),
    total_drop_pa: r(total, 1),
    total_drop_bar: r(total / 1e5, 5),
    total_drop_kpa: r(total / 1000, 3),
    method: "Darcy-Weisbach with Colebrook-White friction factor"
  };
}

/* --- control valve, liquid : IEC 60534-2-1 ------------------------------- */
function controlValveLiquid(a) {
  const P1 = a.inlet_pressure_bara, P2 = a.outlet_pressure_bara;
  const dp = P1 - P2;
  if (dp <= 0) throw new Error("Outlet pressure must be below inlet pressure.");
  const Pv = a.vapour_pressure_bara, Pc = a.critical_pressure_bara;
  const FL = a.FL;
  const FF = 0.96 - 0.28 * Math.sqrt(Pv / Pc);
  const dpChoked = FL * FL * (P1 - FF * Pv);
  const choked = dp > dpChoked;
  const dpSize = choked ? dpChoked : dp;
  const SG = a.density_kgm3 / 1000;
  const Kv = a.flow_m3h * Math.sqrt(SG / dpSize);
  const sigma = (P1 - Pv) / dp;
  let cav = "low risk";
  if (sigma < 1.0) cav = "flashing / severe cavitation";
  else if (sigma < 1.5) cav = "significant cavitation likely";
  else if (sigma < 2.0) cav = "incipient cavitation possible";
  return {
    required_kv_m3h_bar: r(Kv, 3),
    required_cv_us: r(Kv * 1.156, 3),
    differential_pressure_bar: r(dp, 4),
    sizing_differential_pressure_bar: r(dpSize, 4),
    choked_flow: choked,
    choked_dp_limit_bar: r(dpChoked, 4),
    liquid_critical_pressure_ratio_FF: r(FF, 4),
    cavitation_index_sigma: r(sigma, 3),
    cavitation_assessment: cav,
    standard: "IEC 60534-2-1 / ISA 75.01",
    note: choked
      ? "Flow is choked: sizing used the choked dP limit, not the actual dP."
      : "Flow is not choked."
  };
}

/* --- control valve, gas : IEC 60534-2-1 mass-flow form -------------------- */
function controlValveGas(a) {
  const P1 = a.inlet_pressure_bara, P2 = a.outlet_pressure_bara;
  if (P2 >= P1) throw new Error("Outlet pressure must be below inlet pressure.");
  const x = (P1 - P2) / P1;
  const Fg = a.specific_heat_ratio / 1.40;
  const xT = a.xT;
  const xChoked = Fg * xT;
  const choked = x >= xChoked;
  const xSize = Math.min(x, xChoked);
  const Y = Math.max(0.667, Math.min(1, 1 - xSize / (3 * xChoked)));
  // inlet density from ideal gas + Z
  const rho1 = (P1 * 1e5 * a.molecular_weight / 1000) /
               (a.compressibility_Z * RGAS * a.inlet_temperature_k);
  // N6 = 27.3 -> Kv, with W kg/h, P bar, rho kg/m3
  const Kv = a.mass_flow_kgh / (27.3 * Y * Math.sqrt(xSize * P1 * rho1));
  return {
    required_kv_m3h_bar: r(Kv, 3),
    required_cv_us: r(Kv * 1.156, 3),
    pressure_drop_ratio_x: r(x, 4),
    choked_x_limit: r(xChoked, 4),
    choked_flow: choked,
    specific_heat_ratio_factor_Fgamma: r(Fg, 4),
    expansion_factor_Y: r(Y, 4),
    inlet_density_kgm3: r(rho1, 4),
    standard: "IEC 60534-2-1 (N6 = 27.3, mass-flow form)",
    note: choked
      ? "Flow is choked: sizing used x = Fgamma * xT."
      : "Flow is not choked."
  };
}

/* --- orifice : ISO 5167-2, Reader-Harris/Gallagher ----------------------- */
function readerHarrisGallagher(beta, ReD, Dmm, tap) {
  let L1, L2;
  if (tap === "corner") { L1 = 0; L2 = 0; }
  else if (tap === "d_and_d2") { L1 = 1; L2 = 0.47; }
  else { L1 = 25.4 / Dmm; L2 = 25.4 / Dmm; } // flange taps
  const A = Math.pow(19000 * beta / ReD, 0.8);
  const M2 = 2 * L2 / (1 - beta);
  let C = 0.5961
    + 0.0261 * beta * beta
    - 0.216 * Math.pow(beta, 8)
    + 0.000521 * Math.pow(1e6 * beta / ReD, 0.7)
    + (0.0188 + 0.0063 * A) * Math.pow(beta, 3.5) * Math.pow(1e6 / ReD, 0.3)
    + (0.043 + 0.080 * Math.exp(-10 * L1) - 0.123 * Math.exp(-7 * L1))
      * (1 - 0.11 * A) * Math.pow(beta, 4) / (1 - Math.pow(beta, 4))
    - 0.031 * (M2 - 0.8 * Math.pow(M2, 1.1)) * Math.pow(beta, 1.3);
  if (Dmm < 71.12) C += 0.011 * (0.75 - beta) * (2.8 - Dmm / 25.4);
  return C;
}

function orificeFlow(a) {
  const D = a.pipe_id_mm / 1000, d = a.orifice_bore_mm / 1000;
  const beta = d / D;
  if (beta <= 0 || beta >= 1) throw new Error("Beta ratio must be between 0 and 1.");
  const rho = a.density_kgm3, mu = a.viscosity_cp / 1000;
  const dp = a.differential_pressure_pa;
  const E = 1 / Math.sqrt(1 - Math.pow(beta, 4));
  // expansibility
  let eps = 1;
  if (a.fluid_state === "gas" || a.fluid_state === "steam") {
    const pr = a.downstream_pressure_bara / a.upstream_pressure_bara;
    eps = 1 - (0.351 + 0.256 * Math.pow(beta, 4) + 0.93 * Math.pow(beta, 8))
              * (1 - Math.pow(pr, 1 / a.isentropic_exponent));
  }
  // iterate Cd <-> Re
  let qm = 0.6 * E * eps * (Math.PI / 4) * d * d * Math.sqrt(2 * dp * rho);
  let Cd = 0.6, ReD = 0;
  for (let i = 0; i < 100; i++) {
    ReD = 4 * qm / (Math.PI * D * mu);
    Cd = readerHarrisGallagher(beta, ReD, a.pipe_id_mm, a.tap_type);
    const qn = Cd * E * eps * (Math.PI / 4) * d * d * Math.sqrt(2 * dp * rho);
    if (Math.abs(qn - qm) < 1e-12) { qm = qn; break; }
    qm = qn;
  }
  // permanent pressure loss, ISO 5167-2 clause 5.4.2
  const num = Math.sqrt(1 - beta ** 4 * (1 - Cd * Cd)) - Cd * beta * beta;
  const den = Math.sqrt(1 - beta ** 4 * (1 - Cd * Cd)) + Cd * beta * beta;
  const ppl = (num / den) * dp;

  const warn = [];
  if (beta < 0.1 || beta > 0.75) warn.push("Beta outside ISO 5167-2 range 0.10-0.75.");
  if (a.pipe_id_mm < 50 || a.pipe_id_mm > 1000) warn.push("Pipe ID outside ISO 5167-2 range 50-1000 mm.");
  if (ReD < 5000) warn.push("ReD below ISO 5167-2 minimum.");

  return {
    mass_flow_kg_s: r(qm, 6),
    mass_flow_kg_h: r(qm * 3600, 2),
    volumetric_flow_m3h: r(qm * 3600 / rho, 3),
    discharge_coefficient_Cd: r(Cd, 5),
    beta_ratio: r(beta, 4),
    velocity_of_approach_E: r(E, 5),
    expansibility_epsilon: r(eps, 5),
    pipe_reynolds_number: r(ReD, 0),
    permanent_pressure_loss_pa: r(ppl, 1),
    tap_type: a.tap_type,
    standard: "ISO 5167-2:2022, Reader-Harris/Gallagher (2003)",
    validity_warnings: warn.length ? warn : ["Within ISO 5167-2 validity limits."]
  };
}

/* --- IAPWS-IF97 Region 4 saturation line --------------------------------- */
const N4 = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
            0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2,
            -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849,
            0.65017534844798e3];

function psatFromT(T) { // K -> MPa
  const th = T + N4[8] / (T - N4[9]);
  const A = th * th + N4[0] * th + N4[1];
  const B = N4[2] * th * th + N4[3] * th + N4[4];
  const C = N4[5] * th * th + N4[6] * th + N4[7];
  return Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4);
}
function tsatFromP(p) { // MPa -> K
  const b = Math.pow(p, 0.25);
  const E = b * b + N4[2] * b + N4[5];
  const F = N4[0] * b * b + N4[3] * b + N4[6];
  const Gq = N4[1] * b * b + N4[4] * b + N4[7];
  const Dd = 2 * Gq / (-F - Math.sqrt(F * F - 4 * E * Gq));
  return (N4[9] + Dd - Math.sqrt(Math.pow(N4[9] + Dd, 2) - 4 * (N4[8] + N4[9] * Dd))) / 2;
}

function steamSaturation(a) {
  let T, P;
  if (a.temperature_c != null) {
    T = a.temperature_c + 273.15;
    if (T < 273.15 || T > 647.096) throw new Error("Temperature outside IF97 Region 4 (0.01-373.946 degC).");
    P = psatFromT(T);
  } else if (a.pressure_bara != null) {
    P = a.pressure_bara / 10;
    if (P < 611.213e-6 || P > 22.064) throw new Error("Pressure outside IF97 Region 4 (0.0061-220.64 bar a).");
    T = tsatFromP(P);
  } else {
    throw new Error("Provide either temperature_c or pressure_bara.");
  }
  return {
    saturation_temperature_c: r(T - 273.15, 4),
    saturation_temperature_k: r(T, 4),
    saturation_pressure_bara: r(P * 10, 6),
    saturation_pressure_mpa: r(P, 8),
    standard: "IAPWS-IF97 Region 4 saturation equation"
  };
}

/* --- Peng-Robinson ------------------------------------------------------- */
function cubicRoots(a2, a1, a0) {
  // z^3 + a2 z^2 + a1 z + a0 = 0
  const p = a1 - a2 * a2 / 3;
  const q = 2 * a2 * a2 * a2 / 27 - a2 * a1 / 3 + a0;
  const disc = q * q / 4 + p * p * p / 27;
  const shift = -a2 / 3;
  if (disc > 0) {
    const s = Math.cbrt(-q / 2 + Math.sqrt(disc)) + Math.cbrt(-q / 2 - Math.sqrt(disc));
    return [s + shift];
  }
  const rr = Math.sqrt(-p * p * p / 27);
  const phi = Math.acos(Math.min(1, Math.max(-1, -q / (2 * rr))));
  const m = 2 * Math.sqrt(-p / 3);
  return [0, 1, 2].map(k => m * Math.cos((phi + 2 * Math.PI * k) / 3) + shift)
                  .sort((x, y) => x - y);
}

function prLnPhi(Z, A, B) {
  const s2 = Math.SQRT2;
  return Z - 1 - Math.log(Z - B) -
    A / (2 * s2 * B) * Math.log((Z + (1 + s2) * B) / (Z + (1 - s2) * B));
}

function pengRobinsonZ(a) {
  const T = a.temperature_c + 273.15;
  const P = a.pressure_bara * 1e5;
  const Tc = a.critical_temperature_k, Pc = a.critical_pressure_bara * 1e5;
  const w = a.acentric_factor;
  const Tr = T / Tc;
  const k = 0.37464 + 1.54226 * w - 0.26992 * w * w;
  const alpha = Math.pow(1 + k * (1 - Math.sqrt(Tr)), 2);
  const ac = 0.45724 * RGAS * RGAS * Tc * Tc / Pc;
  const b = 0.07780 * RGAS * Tc / Pc;
  const A = ac * alpha * P / Math.pow(RGAS * T, 2);
  const B = b * P / (RGAS * T);
  const roots = cubicRoots(-(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B * B * B))
                  .filter(z => z > B + 1e-12);
  if (!roots.length) throw new Error("No physical root found for the given state.");

  let Z, phase;
  if (roots.length === 1) {
    Z = roots[0];
    phase = Z > 0.3 ? "vapour / supercritical" : "liquid";
  } else {
    const Zl = roots[0], Zv = roots[roots.length - 1];
    // fugacity equality decides which root is stable
    const gl = prLnPhi(Zl, A, B), gv = prLnPhi(Zv, A, B);
    if (gl < gv) { Z = Zl; phase = "liquid"; }
    else { Z = Zv; phase = "vapour"; }
  }
  const Vm = Z * RGAS * T / P;                       // m3/mol
  const rho = a.molecular_weight / 1000 / Vm;        // kg/m3
  return {
    compressibility_factor_Z: r(Z, 5),
    phase: phase,
    molar_volume_m3_mol: r(Vm, 8),
    density_kgm3: r(rho, 4),
    fugacity_coefficient: r(Math.exp(prLnPhi(Z, A, B)), 5),
    reduced_temperature: r(Tr, 4),
    reduced_pressure: r(P / Pc, 4),
    parameter_A: r(A, 6),
    parameter_B: r(B, 6),
    equation_of_state: "Peng-Robinson (1976), phase selected by minimum fugacity"
  };
}

/* --- NPSH available ------------------------------------------------------ */
function npshAvailable(a) {
  const rho = a.density_kgm3;
  const hp = a.suction_pressure_bara * 1e5 / (rho * G);
  const hv = a.vapour_pressure_bara * 1e5 / (rho * G);
  const npsha = hp + a.static_head_m - a.friction_loss_m - hv;
  const out = {
    npsh_available_m: r(npsha, 3),
    pressure_head_m: r(hp, 3),
    static_head_m: r(a.static_head_m, 3),
    friction_loss_m: r(a.friction_loss_m, 3),
    vapour_pressure_head_m: r(hv, 3)
  };
  if (a.npsh_required_m != null) {
    const margin = npsha - a.npsh_required_m;
    out.npsh_required_m = a.npsh_required_m;
    out.margin_m = r(margin, 3);
    out.margin_ratio = r(npsha / a.npsh_required_m, 3);
    out.assessment = margin <= 0 ? "CAVITATION - NPSHa below NPSHr"
      : margin < 0.5 ? "MARGINAL - less than 0.5 m margin"
      : margin < 1.0 ? "TIGHT - Hydraulic Institute suggests 1 m or 10% minimum"
      : "ACCEPTABLE";
  }
  out.note = "Static head positive for flooded suction, negative for suction lift.";
  return out;
}

/* --- pump power ---------------------------------------------------------- */
function pumpPower(a) {
  const Ph = a.density_kgm3 * G * a.flow_m3h * a.head_m / 3.6e6; // kW
  const Pb = Ph / (a.pump_efficiency / 100);
  const Pm = Pb / (a.motor_efficiency / 100);
  return {
    hydraulic_power_kw: r(Ph, 4),
    shaft_brake_power_kw: r(Pb, 4),
    motor_input_power_kw: r(Pm, 4),
    shaft_brake_power_hp: r(Pb / 0.7457, 4),
    suggested_motor_rating_kw: nextMotorSize(Pb * 1.15),
    overall_efficiency_percent: r(a.pump_efficiency * a.motor_efficiency / 100, 2)
  };
}
const IEC_MOTORS = [0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5,
  22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315, 355, 400, 450, 500];
function nextMotorSize(kw) {
  for (const m of IEC_MOTORS) if (m >= kw) return m;
  return Math.ceil(kw / 100) * 100;
}

/* --- tank / vessel volume ------------------------------------------------ */
function headProfileRadius(z, type, D, headParams) {
  const R = D / 2;
  if (type === "hemispherical" || type === "ellipsoidal_2_1") {
    const aH = type === "hemispherical" ? R : R / 2;
    const zz = z - aH; // shift so apex at z=aH -> zz=0
    const v = 1 - (zz * zz) / (aH * aH);
    return R * Math.sqrt(Math.max(0, v));
  }
  if (type === "conical") {
    const hC = headParams.cone_height_m;
    return R * Math.max(0, (1 - z / hC));
  }
  // torispherical (ASME F&D by default: L = D, r = 0.06 D)
  const L = headParams.crown_radius_m, rk = headParams.knuckle_radius_m;
  const Rc = R - rk;
  const zc = -Math.sqrt((L - rk) * (L - rk) - Rc * Rc); // crown centre, below tangent line
  const zj = -zc * rk / (L - rk);                        // knuckle/crown junction height
  if (z <= zj) return Rc + Math.sqrt(Math.max(0, rk * rk - z * z));
  return Math.sqrt(Math.max(0, L * L - (z - zc) * (z - zc)));
}

function headDepth(type, D, hp) {
  const R = D / 2;
  if (type === "flat") return 0;
  if (type === "hemispherical") return R;
  if (type === "ellipsoidal_2_1") return R / 2;
  if (type === "conical") return hp.cone_height_m;
  const L = hp.crown_radius_m, rk = hp.knuckle_radius_m, Rc = R - rk;
  return L - Math.sqrt((L - rk) * (L - rk) - Rc * Rc);
}

// volume of one head filled from its tangent line up to height z (vertical, head at bottom)
function headVolumeToHeight(z, type, D, hp) {
  if (type === "flat" || z <= 0) return 0;
  const h = headDepth(type, D, hp);
  const zz = Math.min(z, h);
  const n = 2000; // Simpson, even
  const step = zz / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const zi = i * step;
    const rr = headProfileRadius(zi, type, D, hp);
    const w = (i === 0 || i === n) ? 1 : (i % 2 ? 4 : 2);
    s += w * Math.PI * rr * rr;
  }
  return s * step / 3;
}

function tankVolume(a) {
  const D = a.diameter_m, R = D / 2;
  const type = a.head_type;
  const hp = {
    crown_radius_m: a.crown_radius_m != null ? a.crown_radius_m : D,
    knuckle_radius_m: a.knuckle_radius_m != null ? a.knuckle_radius_m : 0.06 * D,
    cone_height_m: a.cone_height_m != null ? a.cone_height_m : R
  };
  const hd = headDepth(type, D, hp);
  const vHeadFull = headVolumeToHeight(hd, type, D, hp);
  const vShell = Math.PI * R * R * a.straight_length_m;
  const vTotal = vShell + 2 * vHeadFull;

  let vFill = null, level = a.liquid_level_m;
  if (level != null) {
    if (a.orientation === "vertical") {
      if (level <= hd) vFill = headVolumeToHeight(level, type, D, hp);
      else if (level <= hd + a.straight_length_m)
        vFill = vHeadFull + Math.PI * R * R * (level - hd);
      else {
        const top = Math.min(level - hd - a.straight_length_m, hd);
        vFill = vHeadFull + vShell + (vHeadFull - headVolumeToHeight(hd - top, type, D, hp));
      }
    } else {
      // horizontal: exact circular segment on shell; heads scaled by segment fraction
      const hL = Math.min(Math.max(level, 0), D);
      const seg = R * R * Math.acos((R - hL) / R) - (R - hL) * Math.sqrt(Math.max(0, 2 * R * hL - hL * hL));
      vFill = seg * a.straight_length_m + 2 * vHeadFull * (seg / (Math.PI * R * R));
    }
  }

  const out = {
    orientation: a.orientation,
    head_type: type,
    head_depth_m: r(hd, 5),
    head_volume_each_m3: r(vHeadFull, 5),
    shell_volume_m3: r(vShell, 5),
    total_volume_m3: r(vTotal, 5),
    total_volume_litres: r(vTotal * 1000, 1),
    total_volume_us_gallons: r(vTotal * 264.172, 1)
  };
  if (vFill != null) {
    out.liquid_level_m = level;
    out.filled_volume_m3 = r(vFill, 5);
    out.filled_volume_litres = r(vFill * 1000, 1);
    out.fill_percent = r(100 * vFill / vTotal, 2);
    if (a.density_kgm3) out.liquid_mass_kg = r(vFill * a.density_kgm3, 1);
  }
  if (type === "torispherical") {
    out.crown_radius_m = hp.crown_radius_m;
    out.knuckle_radius_m = hp.knuckle_radius_m;
    out.note = "Exact crown-and-knuckle profile integrated numerically, " +
               "not the 0.0809*D^3 approximation.";
  }
  if (a.orientation === "horizontal" && type !== "flat")
    out.head_note = "Horizontal head fill approximated by shell segment fraction.";
  return out;
}

function r(x, n) {
  if (!isFinite(x)) return null;
  const f = Math.pow(10, n);
  return Math.round(x * f) / f;
}

/* ===========================================================================
   2. TOOL REGISTRY
   ======================================================================== */

const num = (d, def) => def === undefined
  ? { type: "number", description: d }
  : { type: "number", description: d, default: def };

const TOOLS = [
  {
    name: "pipe_pressure_drop",
    description: "Calculate friction pressure drop in a pipe using Darcy-Weisbach with " +
      "the Colebrook-White friction factor. Handles laminar and turbulent flow, fitting " +
      "losses by the K-method, and elevation change. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        flow_m3h: num("Volumetric flow rate, m3/h"),
        diameter_mm: num("Pipe internal diameter, mm"),
        length_m: num("Straight pipe length, m"),
        density_kgm3: num("Fluid density, kg/m3", 998),
        viscosity_cp: num("Dynamic viscosity, cP", 1.0),
        roughness_mm: num("Absolute pipe roughness, mm (CS 0.045, SS 0.015)", 0.045),
        fitting_k_total: num("Sum of fitting K factors", 0),
        elevation_change_m: num("Rise from inlet to outlet, m (negative if falling)", 0)
      },
      required: ["flow_m3h", "diameter_mm", "length_m"]
    },
    run: pipePressureDrop
  },
  {
    name: "control_valve_size_liquid",
    description: "Size a control valve for liquid service per IEC 60534-2-1 / ISA 75.01. " +
      "Returns required Kv and Cv, choked-flow check (FF, dP limit) and cavitation index " +
      "sigma with an assessment. Pressures in bar absolute. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        flow_m3h: num("Liquid flow rate, m3/h"),
        inlet_pressure_bara: num("Upstream pressure P1, bar absolute"),
        outlet_pressure_bara: num("Downstream pressure P2, bar absolute"),
        density_kgm3: num("Liquid density at flowing temperature, kg/m3", 998),
        vapour_pressure_bara: num("Vapour pressure at flowing temperature, bar a", 0.0234),
        critical_pressure_bara: num("Thermodynamic critical pressure, bar a", 220.64),
        FL: num("Liquid pressure recovery factor (globe 0.9, ball 0.6, butterfly 0.7)", 0.9)
      },
      required: ["flow_m3h", "inlet_pressure_bara", "outlet_pressure_bara"]
    },
    run: controlValveLiquid
  },
  {
    name: "control_valve_size_gas",
    description: "Size a control valve for gas or vapour service per IEC 60534-2-1 using " +
      "the mass-flow form. Returns required Kv and Cv, pressure-drop ratio x, expansion " +
      "factor Y and a choked-flow check against Fgamma*xT. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        mass_flow_kgh: num("Gas mass flow rate, kg/h"),
        inlet_pressure_bara: num("Upstream pressure P1, bar absolute"),
        outlet_pressure_bara: num("Downstream pressure P2, bar absolute"),
        inlet_temperature_k: num("Inlet temperature, K", 288.15),
        molecular_weight: num("Gas molecular weight, g/mol", 28.96),
        specific_heat_ratio: num("Ratio of specific heats gamma (Cp/Cv)", 1.40),
        compressibility_Z: num("Compressibility factor Z at inlet", 1.0),
        xT: num("Pressure differential ratio factor xT (globe 0.72, ball 0.15)", 0.72)
      },
      required: ["mass_flow_kgh", "inlet_pressure_bara", "outlet_pressure_bara"]
    },
    run: controlValveGas
  },
  {
    name: "orifice_flow_iso5167",
    description: "Calculate mass flow through an orifice plate per ISO 5167-2 using the " +
      "Reader-Harris/Gallagher discharge coefficient equation, solved iteratively against " +
      "pipe Reynolds number. Supports corner, flange and D&D/2 taps, gas expansibility and " +
      "permanent pressure loss. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        pipe_id_mm: num("Pipe internal diameter D, mm"),
        orifice_bore_mm: num("Orifice bore diameter d at flowing temperature, mm"),
        differential_pressure_pa: num("Measured differential pressure, Pa"),
        density_kgm3: num("Upstream fluid density, kg/m3", 998),
        viscosity_cp: num("Dynamic viscosity, cP", 1.0),
        tap_type: { type: "string", enum: ["corner", "flange", "d_and_d2"],
                    description: "Pressure tap arrangement", default: "flange" },
        fluid_state: { type: "string", enum: ["liquid", "gas", "steam"],
                       description: "Fluid state; gas/steam applies expansibility",
                       default: "liquid" },
        upstream_pressure_bara: num("Upstream static pressure, bar a (gas/steam only)", 1.01325),
        downstream_pressure_bara: num("Downstream static pressure, bar a (gas/steam only)", 1.0),
        isentropic_exponent: num("Isentropic exponent kappa (gas/steam only)", 1.4)
      },
      required: ["pipe_id_mm", "orifice_bore_mm", "differential_pressure_pa"]
    },
    run: orificeFlow
  },
  {
    name: "steam_saturation_if97",
    description: "Water and steam saturation properties from the IAPWS-IF97 Region 4 " +
      "equation. Give either temperature_c to get saturation pressure, or pressure_bara " +
      "to get saturation temperature. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        temperature_c: num("Saturation temperature, degC (0.01 to 373.946)"),
        pressure_bara: num("Saturation pressure, bar absolute (0.0061 to 220.64)")
      }
    },
    run: steamSaturation
  },
  {
    name: "gas_z_factor_pr",
    description: "Real-gas compressibility factor Z, molar volume, density and fugacity " +
      "coefficient from the Peng-Robinson equation of state. When two roots exist the " +
      "stable phase is chosen by minimum fugacity, not by root count. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        temperature_c: num("Temperature, degC"),
        pressure_bara: num("Pressure, bar absolute"),
        critical_temperature_k: num("Critical temperature Tc, K"),
        critical_pressure_bara: num("Critical pressure Pc, bar absolute"),
        acentric_factor: num("Acentric factor omega"),
        molecular_weight: num("Molecular weight, g/mol", 28.96)
      },
      required: ["temperature_c", "pressure_bara", "critical_temperature_k",
                 "critical_pressure_bara", "acentric_factor"]
    },
    run: pengRobinsonZ
  },
  {
    name: "npsh_available",
    description: "Net Positive Suction Head available for a centrifugal pump, broken down " +
      "by component. Optionally compares against NPSHr and reports the margin with a " +
      "Hydraulic Institute style assessment. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        suction_pressure_bara: num("Absolute pressure on suction vessel surface, bar a", 1.01325),
        density_kgm3: num("Liquid density, kg/m3", 998),
        vapour_pressure_bara: num("Vapour pressure at pumping temperature, bar a", 0.0234),
        static_head_m: num("Liquid level above pump centreline, m (negative for lift)"),
        friction_loss_m: num("Suction line friction and fitting losses, m", 0),
        npsh_required_m: num("Pump NPSHr from the curve, m (optional)")
      },
      required: ["static_head_m"]
    },
    run: npshAvailable
  },
  {
    name: "pump_power",
    description: "Pump hydraulic, shaft (brake) and motor input power from duty point, with " +
      "the next standard IEC motor frame size at a 15 percent margin. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        flow_m3h: num("Flow rate, m3/h"),
        head_m: num("Total differential head, m"),
        density_kgm3: num("Liquid density, kg/m3", 998),
        pump_efficiency: num("Pump efficiency, percent", 70),
        motor_efficiency: num("Motor efficiency, percent", 94)
      },
      required: ["flow_m3h", "head_m"]
    },
    run: pumpPower
  },
  {
    name: "tank_volume",
    description: "Total and partial-fill volume of a cylindrical tank or pressure vessel " +
      "with flat, hemispherical, 2:1 ellipsoidal, torispherical (ASME F&D) or conical heads. " +
      "Horizontal or vertical. The torispherical head is integrated over the exact crown and " +
      "knuckle profile rather than the usual approximation. Powered by multicalci.com.",
    inputSchema: {
      type: "object",
      properties: {
        diameter_m: num("Inside shell diameter, m"),
        straight_length_m: num("Straight shell length, tangent to tangent, m"),
        orientation: { type: "string", enum: ["vertical", "horizontal"],
                       description: "Vessel orientation", default: "vertical" },
        head_type: { type: "string",
          enum: ["flat", "hemispherical", "ellipsoidal_2_1", "torispherical", "conical"],
          description: "Head type on both ends", default: "ellipsoidal_2_1" },
        crown_radius_m: num("Torispherical crown radius L, m (ASME F&D default = D)"),
        knuckle_radius_m: num("Torispherical knuckle radius r, m (ASME F&D default = 0.06 D)"),
        cone_height_m: num("Conical head height, m (default = D/2)"),
        liquid_level_m: num("Liquid level from the lowest inside point, m (optional)"),
        density_kgm3: num("Liquid density for mass output, kg/m3 (optional)")
      },
      required: ["diameter_m", "straight_length_m"]
    },
    run: tankVolume
  }
];

/* ===========================================================================
   3. JSON-RPC / MCP PLUMBING
   ======================================================================== */

function applyDefaults(tool, args) {
  const out = Object.assign({}, args || {});
  const props = tool.inputSchema.properties || {};
  for (const k of Object.keys(props)) {
    if (out[k] === undefined && props[k].default !== undefined) out[k] = props[k].default;
  }
  for (const k of (tool.inputSchema.required || [])) {
    if (out[k] === undefined || out[k] === null)
      throw new Error(`Missing required parameter: ${k}`);
  }
  return out;
}

function handleRpc(msg) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "Standards-referenced process engineering calculations from multicalci.com. " +
          "All results are for preliminary engineering and must be verified by a " +
          "qualified engineer against the applicable code before use in final design."
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notifications get no response

    case "ping":
      return ok({});

    case "tools/list":
      return ok({
        tools: TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      });

    case "tools/call": {
      const tool = TOOLS.find(t => t.name === (params && params.name));
      if (!tool) return err(-32602, `Unknown tool: ${params && params.name}`);
      try {
        const args = applyDefaults(tool, params.arguments);
        const result = tool.run(args);
        return ok({
          content: [{ type: "text", text: JSON.stringify(result, null, 2) + BRAND }],
          isError: false
        });
      } catch (e) {
        return ok({
          content: [{ type: "text", text: `Calculation error: ${e.message}` }],
          isError: true
        });
      }
    }

    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string" && req.body.length)
    return Promise.resolve(JSON.parse(req.body));
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({
      server: SERVER,
      transport: "Streamable HTTP (stateless JSON)",
      endpoint: "https://www.multicalci.com/api/mcp",
      tools: TOOLS.map(t => t.name),
      usage: "POST JSON-RPC 2.0 to this URL. Try {\"jsonrpc\":\"2.0\",\"id\":1," +
             "\"method\":\"tools/list\"}",
      site: "https://www.multicalci.com"
    });
  }

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  let body;
  try { body = await readBody(req); }
  catch {
    return res.status(400).json({
      jsonrpc: "2.0", id: null,
      error: { code: -32700, message: "Parse error" }
    });
  }

  if (Array.isArray(body)) {
    const out = body.map(handleRpc).filter(Boolean);
    return out.length ? res.status(200).json(out) : res.status(202).end();
  }

  const out = handleRpc(body);
  if (!out) return res.status(202).end();
  return res.status(200).json(out);
}
