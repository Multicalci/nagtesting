// api/fan.js  — Vercel Serverless Function
// Fan & blower power, specific speed, affinity laws — server-side only.
//
// AUDIT v2 — fixes applied:
//  [FIX-1] Full server-side input validation added (was entirely missing)
//  [FIX-2] Infinity/NaN guard on computed power outputs before return
//  [FIX-3] lb/ft³→kg/m³ factor corrected to 16.01846 (was 16.0185 — rounding error)
//  [FIX-4] CORS headers + OPTIONS preflight handler added
//
// AUDIT v3 — deep diagnostic (line-by-line):
//  [FIX-5] affinityLaws() now receives actual rho_ratio (rho/1.2) instead of hardcoded 1.0.
//           Old: dP and P affinity predictions always assumed standard air density.
//           New: predictions scale correctly for hot air, altitude, or dense process gases.

/* ─── Fan specific-speed classification (dimensionless SI) ───────────── */
// Ω_s = ω·√Q(m³/s) / (ΔPt/ρ)^0.75
// Thresholds from ISO 13349 / AMCA 802:
function classifyFan(Ns_fan) {
  if (Ns_fan < 0.5)  return 'High-Pressure Centrifugal';
  if (Ns_fan < 1.2)  return 'Centrifugal (Standard)';
  if (Ns_fan < 2.5)  return 'Mixed Flow';
  if (Ns_fan < 4.0)  return 'Axial Flow';
  return 'High-Flow Axial';
}

/* ─── Affinity (fan similarity) laws ────────────────────────────────── */
// Q₂ = Q₁ · (N₂/N₁)·(D₂/D₁)³
// ΔP₂= ΔP₁· (N₂/N₁)²·(D₂/D₁)²·(ρ₂/ρ₁)
// P₂ = P₁ · (N₂/N₁)³·(D₂/D₁)⁵·(ρ₂/ρ₁)
function affinityLaws(Q1, dPt1, P_shaft1, N1, D1, N2, D2, rho_ratio = 1.0) {
  const rN = N2 / N1;
  const rD = D2 / D1;
  return {
    Q2:       Q1       * rN       * Math.pow(rD, 3),
    dP2:      dPt1     * Math.pow(rN, 2) * Math.pow(rD, 2) * rho_ratio,
    P2_shaft: P_shaft1 * Math.pow(rN, 3) * Math.pow(rD, 5) * rho_ratio,
    rN, rD,
  };
}

/* ─── Server-side input validation ──────────────────────────────────── */
function validateFanInputs(p) {
  const required = ['Q', 'dPs', 'dPd', 'rho', 'N1', 'D1', 'eta_t', 'eta_m', 'N2', 'D2'];
  for (const k of required) {
    if (p[k] === undefined || p[k] === null || !isFinite(Number(p[k])))
      return `Field "${k}" is missing or not a finite number.`;
  }
  const f = k => Number(p[k]);
  if (f('Q')   <= 0)                        return 'Flow Q must be > 0.';
  if (f('rho') <= 0)                        return 'Density ρ must be > 0.';
  if (f('N1')  <= 0)                        return 'Speed N1 must be > 0.';
  if (f('D1')  <= 0)                        return 'Diameter D1 must be > 0.';
  if (f('N2')  <= 0)                        return 'Speed N2 must be > 0.';
  if (f('D2')  <= 0)                        return 'Diameter D2 must be > 0.';
  if (f('eta_t') <= 0 || f('eta_t') > 1)   return 'Total efficiency η_t must be in (0, 1].';
  if (f('eta_m') <= 0 || f('eta_m') > 1)   return 'Motor efficiency η_m must be in (0, 1].';
  // dPs and dPd can be zero (e.g. static-only or dynamic-only measurement) but total must be > 0
  if (f('dPs') + f('dPd') <= 0)            return 'Total pressure (dPs + dPd) must be > 0.';
  if (f('dPs') < 0 || f('dPd') < 0)        return 'Pressure components dPs and dPd must be ≥ 0.';
  return null;
}

/* ─── US → SI conversion ─────────────────────────────────────────────── */
function toSI_fan(inp) {
  return {
    Q_m3h: inp.Q   * 1.69901,   // CFM → m³/h   [0.028316847 m³/ft³ × 60 min/h]
    dPs:   inp.dPs * 249.089,   // in WG → Pa
    dPd:   inp.dPd * 249.089,
    rho:   inp.rho * 16.01846,  // lb/ft³ → kg/m³  [corrected from 16.0185]
    D1_mm: inp.D1  * 25.4,      // in → mm
    D2_mm: inp.D2  * 25.4,
  };
}

/* ─── Finite guard ───────────────────────────────────────────────────── */
function assertFinite(val, label) {
  if (!isFinite(val))
    throw new Error(`Computed "${label}" is not finite — check input magnitudes.`);
}

/* ─── Main calculation ───────────────────────────────────────────────── */
function fanCalc(params) {
  const {
    Q, dPs, dPd, rho,
    N1, D1, eta_t, eta_m,
    N2, D2,
    unitMode = 'SI',
  } = params;

  let Q_m3h, dPs_Pa, dPd_Pa, rho_kgm3, D1_mm, D2_mm;

  if (unitMode === 'US') {
    const si = toSI_fan({ Q, dPs, dPd, rho, D1, D2 });
    Q_m3h = si.Q_m3h; dPs_Pa = si.dPs; dPd_Pa = si.dPd;
    rho_kgm3 = si.rho; D1_mm = si.D1_mm; D2_mm = si.D2_mm;
  } else {
    Q_m3h = Q; dPs_Pa = dPs; dPd_Pa = dPd;
    rho_kgm3 = rho; D1_mm = D1; D2_mm = D2;
  }

  const Q_m3s = Q_m3h / 3600;
  const dPt   = dPs_Pa + dPd_Pa;             // total pressure rise  [Pa]

  /* ── Power chain ── */
  const P_air   = Q_m3s * dPt   / 1000;     // kW  fluid (air) power
  const P_shaft = P_air  / eta_t;            // kW  shaft
  const P_input = P_shaft / eta_m;           // kW  motor input

  assertFinite(P_air,   'P_air');
  assertFinite(P_shaft, 'P_shaft');
  assertFinite(P_input, 'P_input');

  /* ── Static efficiency = static fluid power / shaft power ── */
  const eta_s = (Q_m3s * dPs_Pa) / (P_shaft * 1000);

  /* ── Fan specific speed (dimensionless SI) ──
     Ω_s = ω · √Q(m³/s) / (ΔPt/ρ)^0.75  */
  const omega  = N1 * 2 * Math.PI / 60;     // rad/s
  const Ns_fan = omega * Math.sqrt(Q_m3s)
               / Math.pow(dPt / rho_kgm3, 0.75);

  const fanType = classifyFan(Ns_fan);

  /* ── Tip speed ── */
  const tip_speed = Math.PI * (D1_mm / 1000) * N1 / 60;   // m/s
  const tipWarn   = tip_speed > 120
    ? '⚠ Check tip speed (>120 m/s) — blade stress limit'
    : '✓ Within typical range (<120 m/s)';

  /* ── Density deviation check (fan laws assume constant ρ) ── */
  const rhoRef          = 1.2;    // kg/m³  standard air
  const densityDeviates = Math.abs(rho_kgm3 / rhoRef - 1) > 0.10;

  /* ── Affinity laws ──
     ΔP and P both scale with density, so we pass rho/rhoRef as the density ratio.
     This ensures affinity predictions are correct when the fan operates at
     non-standard air density (hot air, altitude, dense gas etc.).
     Q (volumetric) is density-independent, so rho_ratio only affects ΔP and P. */
  const rho_ratio = rho_kgm3 / rhoRef;
  const aff = affinityLaws(Q_m3h, dPt, P_shaft, N1, D1_mm, N2, D2_mm, rho_ratio);

  return {
    ok: true,
    // Power
    P_air, P_shaft, P_input,
    // Pressures
    dPs: dPs_Pa, dPd: dPd_Pa, dPt,
    // Efficiency
    eta_t, eta_m, eta_s,
    // Classification
    Ns_fan, fanType,
    // Geometry
    D1: D1_mm, D2: D2_mm, N1, N2,
    tip_speed, tipWarn,
    // Conditions
    Q: Q_m3h, rho: rho_kgm3,
    densityDeviates,
    // Affinity law predictions
    affinity: {
      Q2:       aff.Q2,
      dP2:      aff.dP2,
      P2_shaft: aff.P2_shaft,
      rN:       aff.rN,
      rD:       aff.rD,
    },
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

  const err = validateFanInputs(body);
  if (err) return res.status(400).json({ error: err });

  try {
    return res.status(200).json(fanCalc(body));
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Calculation error.' });
  }
}
