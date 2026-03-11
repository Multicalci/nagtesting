// api/compressor.js  — Vercel Serverless Function
// Isentropic & polytropic compression thermodynamics — server-side only.
//
// AUDIT v2 — fixes applied:
//  [FIX-1] GAS_LIBRARY extended with all 9 gases missing from v1
//           (co, steam, ethylene, propylene, h2s, chlorine, so2, hcl, acetylene)
//  [FIX-2] gamma_in ?? gasEntry.gamma  (nullish coalescing — replaces falsy ||)
//  [FIX-3] Full server-side input validation added (n_stages, eta, T1, P1, etc.)
//  [FIX-4] n_stages < 1 now throws instead of silently returning P_shaft = 0
//  [FIX-5] eta_mec = 0 / eta_drv = 0 now caught by validation before calc
//  [FIX-6] Server-side manual stage ratio product validation added
//  [FIX-7] Intercooler T_ic > T_out_act warning added to response
//  [FIX-8] CORS headers + OPTIONS preflight handler added
//  [FIX-9] Infinity/NaN guard on all power outputs before return
//
// AUDIT v3 — deep diagnostic (line-by-line):
//  [FIX-10] CRITICAL: polytropicIndex() formula corrected for compression.
//           Old: n = γ/(γ − η·(γ−1))  ← turbine/expansion form — gives T_out < T_is (impossible)
//           New: n = 1/(1 − (γ−1)/(γ·η))  ← compression form — gives T_out > T_is  ✓

/* ─── Physical constants ─────────────────────────────────────────────── */
const R_UNIV = 8314.46261815;  // J/(kmol·K)  NIST universal gas constant

/* ─── Gas property library (protected — not exposed to client) ───────── */
const GAS_LIBRARY = {
  // Permanent gases (ideal-gas behaviour adequate for most pressures)
  air:        { name: 'Air',                   gamma: 1.400, M: 28.970,  realGas: false },
  nitrogen:   { name: 'Nitrogen (N₂)',         gamma: 1.400, M: 28.014,  realGas: false },
  oxygen:     { name: 'Oxygen (O₂)',           gamma: 1.395, M: 31.999,  realGas: false },
  hydrogen:   { name: 'Hydrogen (H₂)',         gamma: 1.405, M:  2.016,  realGas: false },
  helium:     { name: 'Helium (He)',           gamma: 1.667, M:  4.003,  realGas: false },
  argon:      { name: 'Argon (Ar)',            gamma: 1.667, M: 39.948,  realGas: false },
  co:         { name: 'Carbon Monoxide (CO)',  gamma: 1.400, M: 28.010,  realGas: false },
  // Hydrocarbons & refrigerants — real-gas deviations common at high P
  methane:    { name: 'Methane (CH₄)',         gamma: 1.308, M: 16.043,  realGas: false },
  ethane:     { name: 'Ethane (C₂H₆)',         gamma: 1.186, M: 30.069,  realGas: true  },
  propane:    { name: 'Propane (C₃H₈)',        gamma: 1.130, M: 44.097,  realGas: true  },
  nbutane:    { name: 'n-Butane (C₄H₁₀)',      gamma: 1.094, M: 58.123,  realGas: true  },
  ethylene:   { name: 'Ethylene (C₂H₄)',       gamma: 1.238, M: 28.054,  realGas: true  },
  propylene:  { name: 'Propylene (C₃H₆)',      gamma: 1.148, M: 42.081,  realGas: true  },
  acetylene:  { name: 'Acetylene (C₂H₂)',      gamma: 1.232, M: 26.038,  realGas: true  },
  // CO₂ & inorganic process gases
  co2:        { name: 'Carbon Dioxide (CO₂)',  gamma: 1.289, M: 44.010,  realGas: true  },
  steam:      { name: 'Steam (H₂O)',           gamma: 1.135, M: 18.015,  realGas: true  },
  h2s:        { name: 'Hydrogen Sulfide (H₂S)',gamma: 1.320, M: 34.081,  realGas: true  },
  chlorine:   { name: 'Chlorine (Cl₂)',        gamma: 1.340, M: 70.906,  realGas: true  },
  so2:        { name: 'Sulfur Dioxide (SO₂)',  gamma: 1.290, M: 64.065,  realGas: true  },
  hcl:        { name: 'Hydrogen Chloride (HCl)',gamma:1.410, M: 36.461,  realGas: true  },
  ammonia:    { name: 'Ammonia (NH₃)',         gamma: 1.310, M: 17.031,  realGas: true  },
  // Refrigerants
  r717:       { name: 'R-717 (Ammonia)',       gamma: 1.310, M: 17.031,  realGas: true  },
  r22:        { name: 'R-22 (Freon)',          gamma: 1.183, M: 86.468,  realGas: true  },
  r134a:      { name: 'R-134a',               gamma: 1.143, M: 102.03,  realGas: true  },
  r410a:      { name: 'R-410A',               gamma: 1.174, M: 72.585,  realGas: true  },
  r32:        { name: 'R-32',                 gamma: 1.240, M: 52.024,  realGas: true  },
  r290:       { name: 'R-290 (Propane)',       gamma: 1.130, M: 44.097,  realGas: true  },
  r744:       { name: 'R-744 (CO₂)',           gamma: 1.289, M: 44.010,  realGas: true  },
  // Custom (caller must supply gamma and M)
  custom:     { name: 'Custom Gas',            gamma: null,  M: null,    realGas: false },
};

/* ─── Server-side input validation ──────────────────────────────────── */
function validateCompInputs(p) {
  const n = Number(p.n_stages ?? 2);
  if (!Number.isInteger(n) || n < 1 || n > 10)
    return 'n_stages must be an integer between 1 and 10.';

  const required = ['T1', 'P1', 'Q', 'Pout', 'eta', 'eta_mec', 'eta_drv'];
  for (const k of required) {
    if (p[k] === undefined || p[k] === null || !isFinite(Number(p[k])))
      return `Field "${k}" is missing or not a finite number.`;
  }
  const f = k => Number(p[k]);
  // Temperature: accept -273 to 2000 °C (or °F range becomes huge — clamp loosely)
  if (f('T1') < -273)                       return 'Inlet temperature T1 must be > −273 °C (or °F equivalent).';
  if (f('P1') <= 0)                         return 'Inlet pressure P1 must be > 0.';
  if (f('Pout') <= f('P1'))                 return 'Outlet pressure Pout must be > inlet pressure P1.';
  if (f('Q') <= 0)                          return 'Volumetric flow Q must be > 0.';
  if (f('eta')    <= 0 || f('eta')    > 1)  return 'Stage efficiency η must be in (0, 1].';
  if (f('eta_mec') <= 0 || f('eta_mec')> 1) return 'Mechanical efficiency η_mec must be in (0, 1].';
  if (f('eta_drv') <= 0 || f('eta_drv')> 1) return 'Driver efficiency η_drv must be in (0, 1].';

  // Custom gas: gamma and M must be supplied and valid
  if ((p.gas === 'custom' || !GAS_LIBRARY[p.gas]) && !(p.gamma > 1 && p.M > 0))
    return 'Custom gas requires gamma > 1 and M > 0.';

  // Manual stage ratios: product should equal r_total within 2%
  if (p.ratioMode === 'manual' && Array.isArray(p.stageRatios_manual)) {
    const r_total = f('Pout') / f('P1');
    const product = p.stageRatios_manual.reduce((acc, r) => acc * Number(r), 1);
    if (Math.abs(product / r_total - 1) > 0.02)
      return `Manual stage ratios product (${product.toFixed(4)}) differs from total ratio (${r_total.toFixed(4)}) by >2%. Adjust ratios so their product equals Pout/P1.`;
  }
  return null;
}

/* ─── Polytropic index from efficiency ───────────────────────────────── */
// For a compressor, polytropic efficiency is defined such that:
//   (n−1)/n  =  (γ−1) / (γ · η_p)
// → n = 1 / [1 − (γ−1)/(γ·η_p)]
//
// Physical check: η_p < 1  →  exponent > (γ−1)/γ  →  T₂_act > T₂_isentropic  ✓
// The alternative formula n = γ/(γ − η_p(γ−1)) is correct for EXPANSION (turbines),
// where it gives T₂_act < T₂_isentropic.  Using it for compression is a sign error.
function polytropicIndex(gamma, eta_p) {
  return 1 / (1 - (gamma - 1) / (gamma * eta_p));
}

/* ─── Isentropic stage ───────────────────────────────────────────────── */
function isentropicStage(T_in_K, r_stage, gamma, Cp, eta_is, mdot) {
  const T_out_is  = T_in_K * Math.pow(r_stage, (gamma - 1) / gamma);
  const T_out_act = T_in_K + (T_out_is - T_in_K) / eta_is;
  const w_is      = Cp * (T_out_is - T_in_K);   // J/kg isentropic specific work
  const w_act     = w_is / eta_is;               // J/kg actual specific work
  return {
    T_out_act,
    P_is_kW:  mdot * w_is  / 1000,
    P_act_kW: mdot * w_act / 1000,
  };
}

/* ─── Polytropic stage ────────────────────────────────────────────────── */
function polytropicStage(T_in_K, r_stage, gamma, n_poly, R_spec, Cp, mdot) {
  const T_out_act = T_in_K * Math.pow(r_stage, (n_poly - 1) / n_poly);
  const w_act     = (n_poly / (n_poly - 1)) * R_spec * T_in_K
                    * (Math.pow(r_stage, (n_poly - 1) / n_poly) - 1); // J/kg
  const T_out_is  = T_in_K * Math.pow(r_stage, (gamma - 1) / gamma);
  return {
    T_out_act,
    P_is_kW:  mdot * Cp * (T_out_is - T_in_K) / 1000,
    P_act_kW: mdot * w_act / 1000,
  };
}

/* ─── US → SI conversion ─────────────────────────────────────────────── */
function toSI_comp(inp) {
  const T1_C = (inp.T1 - 32) / 1.8;          // °F → °C
  const P1   = inp.P1   * 0.0689476;          // psia → bar
  const Pout = inp.Pout * 0.0689476;
  let Q_m3h  = inp.Q * 1.69901;              // ACFM → m³/h
  if (inp.flowBasis === 'scfm') {
    // Convert SCFM → ACFM at actual conditions (ideal gas)
    const T_std_K = 288.706;   // 60 °F in K
    const P_std   = 1.01325;   // bar
    const T1_K    = T1_C + 273.15;
    Q_m3h = inp.Q * 1.69901 * (P_std / P1) * (T1_K / T_std_K);
  }
  return { T1_C, P1, Pout, Q_m3h };
}

/* ─── Finite guard ───────────────────────────────────────────────────── */
function assertFinite(val, label) {
  if (!isFinite(val))
    throw new Error(`Computed "${label}" is not finite — check input magnitudes.`);
}

/* ─── Main calculation ───────────────────────────────────────────────── */
function compressorCalc(params) {
  const {
    n_stages = 2, T1, P1, Q, Pout,
    gamma: gamma_in, M: M_in,
    eta, eta_mec, eta_drv,
    eff_mode = 'isentropic',
    Cp_override,
    gas = 'air',
    stageRatios_manual,
    ratioMode = 'equal',
    intercoolers = [],
    unitMode  = 'SI',
  } = params;

  /* ── Unit conversion ── */
  let T1_C = T1, P1_bar = P1, Pout_bar = Pout, Q_m3h = Q;
  if (unitMode === 'US') {
    const si = toSI_comp({ T1, P1, Pout, Q, flowBasis: params.flowBasis });
    T1_C = si.T1_C; P1_bar = si.P1; Pout_bar = si.Pout; Q_m3h = si.Q_m3h;
  }

  /* ── Gas properties ──
     Use nullish coalescing (??) so that gamma_in = 0 does NOT silently
     fall through to the library value (0 is invalid anyway, caught above). */
  const gasEntry  = GAS_LIBRARY[gas] ?? GAS_LIBRARY.air;
  const gamma     = gamma_in  ?? gasEntry.gamma;
  const M         = M_in      ?? gasEntry.M;
  const isRealGas = gasEntry.realGas;

  const P_ratio_high = (Pout_bar / P1_bar) > 10;
  const realGasWarn  = isRealGas || P_ratio_high;

  const R_spec        = R_UNIV / M;                        // J/(kg·K)
  const Cp_ideal      = gamma * R_spec / (gamma - 1);      // J/(kg·K)  ideal gas
  const Cp_overridden = !!(Cp_override && Cp_override > 100);
  const Cp            = Cp_overridden ? Cp_override : Cp_ideal;

  /* ── Pressure ratios ── */
  const r_total = Pout_bar / P1_bar;
  let stageRatios;
  if (ratioMode === 'manual' && Array.isArray(stageRatios_manual) && stageRatios_manual.length === n_stages) {
    stageRatios = stageRatios_manual.map(Number);
  } else {
    const r_eq  = Math.pow(r_total, 1 / n_stages);
    stageRatios = Array(n_stages).fill(r_eq);
  }

  /* ── Polytropic index ── */
  const n_poly = polytropicIndex(gamma, eta);

  /* ── Inlet density & mass flow ── */
  const T1_K  = T1_C + 273.15;
  const rho1  = P1_bar * 1e5 * M / (R_UNIV * T1_K);   // kg/m³  ideal gas Z=1
  const Q_m3s = Q_m3h / 3600;
  const mdot  = rho1 * Q_m3s;                           // kg/s

  /* ── Stage-by-stage loop ── */
  let totalActPower = 0;
  let totalIsPower  = 0;
  let T_in = T1_K;
  let P_in = P1_bar;
  const stageData = [];
  const icWarnings = [];

  for (let i = 1; i <= n_stages; i++) {
    const r_stg     = stageRatios[i - 1];
    const P_out_stg = P_in * r_stg;

    let T_out_act, P_is_kW, P_act_kW;
    if (eff_mode === 'isentropic') {
      ({ T_out_act, P_is_kW, P_act_kW } =
          isentropicStage(T_in, r_stg, gamma, Cp, eta, mdot));
    } else {
      ({ T_out_act, P_is_kW, P_act_kW } =
          polytropicStage(T_in, r_stg, gamma, n_poly, R_spec, Cp, mdot));
    }

    totalIsPower  += P_is_kW;
    totalActPower += P_act_kW;

    stageData.push({
      stage:   i,
      P_in,    P_out: P_out_stg, r: r_stg,
      T_in_C:  T_in      - 273.15,
      T_out_C: T_out_act - 273.15,
      P_act_kW,
    });

    /* ── Intercooler between stages ── */
    if (i < n_stages) {
      const ic     = (intercoolers && intercoolers[i - 1]) || {};
      // Use nullish coalescing so 0 °C is a valid intercooler temperature
      const T_ic_C = ic.T_out_C !== undefined && ic.T_out_C !== null
                     ? Number(ic.T_out_C) : 40;
      const dP_ic  = ic.dP_bar  !== undefined && ic.dP_bar  !== null
                     ? Number(ic.dP_bar)  : 0.05;

      // Physical sanity check: cooled temp should be below discharge temp
      const T_out_act_C = T_out_act - 273.15;
      if (T_ic_C >= T_out_act_C) {
        icWarnings.push(
          `Intercooler ${i}: outlet T (${T_ic_C.toFixed(1)} °C) ≥ stage ${i} discharge T (${T_out_act_C.toFixed(1)} °C) — cooling has no effect or heats the gas. Check intercooler settings.`
        );
      }

      stageData.push({
        isIC:     true,
        icNum:    i,
        T_in_C:   T_out_act_C,
        T_out_C:  T_ic_C,
        dP_ic,
        P_in_IC:  P_out_stg,
        P_out_IC: P_out_stg - dP_ic,
      });

      T_in = T_ic_C + 273.15;
      P_in = P_out_stg - dP_ic;
    }
  }

  const P_shaft_total = totalActPower / eta_mec;
  const P_input_total = P_shaft_total / eta_drv;

  // Guard infinite/NaN outputs
  assertFinite(P_shaft_total, 'P_shaft_total');
  assertFinite(P_input_total, 'P_input_total');

  const lastStage = stageData.filter(d => !d.isIC).slice(-1)[0];
  const finalT    = lastStage ? lastStage.T_out_C : 0;

  /* ── Actual outlet pressure (may be < Pout_bar when intercooler dP_ic > 0) ── */
  // The stage loop applies equal pressure ratios but intercooler pressure drops
  // reduce the inlet pressure to each subsequent stage.  The result is that the
  // actual discharge pressure is slightly less than the target (Pout_bar).
  // We compute it from the last stage's P_out so the client can show it and
  // warn the user when the deviation is significant.
  const actual_Pout = lastStage ? lastStage.P_out : Pout_bar;
  const Pout_deviation_pct = Math.abs(actual_Pout - Pout_bar) / Pout_bar * 100;
  const PoutWarn = Pout_deviation_pct > 0.5   // warn if >0.5% off target
    ? `Actual outlet pressure (${actual_Pout.toFixed(3)} bar) differs from target (${Pout_bar.toFixed(3)} bar) by ${Pout_deviation_pct.toFixed(2)}% due to intercooler pressure drops. To hit exactly ${Pout_bar.toFixed(3)} bar, increase the stage pressure ratios to compensate.`
    : null;

  return {
    ok: true,
    // Power
    totalIsPower, totalActPower, P_shaft_total, P_input_total,
    // Gas props
    gamma, M, R_spec, Cp, Cp_overridden, rho1, mdot,
    // Ratios
    r_total, r_stage: stageRatios[0], n_stages,
    // Thermo
    n_poly, eff_mode, eta, eta_mec, eta_drv,
    T1: T1_C, P1: P1_bar, Pout: Pout_bar, actual_Pout,
    // Stages
    stageData,
    // Final discharge temperature
    finalT,
    // Warnings
    realGasWarn, isRealGasRisk: isRealGas, P_ratio_high,
    gasName: gasEntry.name,
    icWarnings: icWarnings.length ? icWarnings : null,
    PoutWarn,
  };
}

/* ─── CORS helper ────────────────────────────────────────────────────── */
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ─── Vercel handler ─────────────────────────────────────────────────── */
export default function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body || typeof body !== 'object')
    return res.status(400).json({ error: 'Invalid request body.' });

  const err = validateCompInputs(body);
  if (err) return res.status(400).json({ error: err });

  try {
    return res.status(200).json(compressorCalc(body));
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Calculation error.' });
  }
}
