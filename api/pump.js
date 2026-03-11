// api/pump.js  — Vercel Serverless Function
// All proprietary pump formulae, constants and fluid library live here.
// The client never sees these formulas — they are executed server-side only.
//
// AUDIT v2 — fixes applied:
//  [FIX-1] Full server-side numeric + range validation for all inputs
//  [FIX-2] Infinity/NaN guard on all computed power outputs before return
//  [FIX-3] Dead variable Q_total_m3s removed
//  [FIX-4] CORS headers + OPTIONS preflight handler added
//  [FIX-5] Stage loop de-duplicated (single P_hyd_s/P_shaft_s computed once)
//  [IMPROVE] lb/ft³→kg/m³ factor standardised to 16.01846 (exact 6 s.f.)

/* ─── Physical constants ─────────────────────────────────────────────── */
const G_GRAV = 9.80665;     // m/s²  standard gravity (ISO 80000-3)

/* ─── Fluid property library (protected — not exposed to client) ─────── */
const FLUID_LIBRARY = {
  water_20:  { name: 'Water 20 °C',    rho: 998.2, mu: 1.002, Pv_bar: 0.02338 },
  water_60:  { name: 'Water 60 °C',    rho: 983.2, mu: 0.467, Pv_bar: 0.1993  },
  water_80:  { name: 'Water 80 °C',    rho: 971.8, mu: 0.355, Pv_bar: 0.4736  },
  diesel:    { name: 'Diesel',          rho: 820,   mu: 3.5,   Pv_bar: 0.0003  },
  seawater:  { name: 'Seawater 20 °C', rho: 1025,  mu: 1.08,  Pv_bar: 0.023   },
  glycol50:  { name: 'EG 50% 20 °C',   rho: 1058,  mu: 6.5,   Pv_bar: 0.01    },
  ammonia:   { name: 'Liquid NH₃',     rho: 610,   mu: 0.13,  Pv_bar: 8.57    },
};

/* ─── Server-side input validation ──────────────────────────────────── */
function validatePumpInputs(p) {
  const required = ['Q','H','rho','eta_h','eta_mec','eta_m','N_rpm',
                    'Ps','Pv','Vs','hfs','NPSHr'];
  for (const k of required) {
    if (p[k] === undefined || p[k] === null || !isFinite(Number(p[k])))
      return `Field "${k}" is missing or not a finite number.`;
  }
  const f = k => Number(p[k]);
  if (f('Q')     <= 0)                      return 'Flow rate Q must be > 0.';
  if (f('H')     <= 0)                      return 'Head H must be > 0.';
  if (f('rho')   <= 0)                      return 'Density ρ must be > 0.';
  if (f('N_rpm') <= 0)                      return 'Speed N must be > 0.';
  if (f('eta_h')   <= 0 || f('eta_h')  > 1) return 'Hydraulic efficiency η_h must be in (0, 1].';
  if (f('eta_mec') <= 0 || f('eta_mec')> 1) return 'Mechanical efficiency η_mec must be in (0, 1].';
  if (f('eta_m')   <= 0 || f('eta_m')  > 1) return 'Motor efficiency η_m must be in (0, 1].';
  if (f('NPSHr') < 0)                       return 'NPSHr must be ≥ 0.';
  const n = p.n_stages !== undefined ? Number(p.n_stages) : 1;
  if (!Number.isInteger(n) || n < 1 || n > 20)
    return 'n_stages must be an integer between 1 and 20.';
  const nu = p.nu_cSt !== undefined ? Number(p.nu_cSt) : 1.0;
  if (!isFinite(nu) || nu <= 0)             return 'Viscosity ν must be > 0 cSt.';
  return null;
}

/* ─── Viscosity correction (HI 9.6.7 / Gülich Ch.16) ───────────────── */
// C_η ≈ 1 − 0.0105·(ν − 1)^0.60  — valid ~1–3000 cSt centrifugal pumps
function viscCorrectionFactor(nu_cSt) {
  return Math.max(0.40, 1.0 - 0.0105 * Math.pow(nu_cSt - 1, 0.60));
}

/* ─── NPSH available (ISO 9906 / HI full equation) ──────────────────── */
// NPSHa = (Ps − Pv)×10⁵ / (ρg) + V²/(2g) − hfs − z_s
function calcNPSHa(Ps_bar, Pv_bar, rho, Vs_ms, hfs_m, zs_m) {
  return (Ps_bar - Pv_bar) * 1e5 / (rho * G_GRAV)
       + (Vs_ms * Vs_ms)  / (2 * G_GRAV)
       - hfs_m
       - zs_m;
}

/* ─── Specific speed (SI — Gülich / Kaplan definition) ──────────────── */
// Ns = N_rpm · √Q(m³/s) / H(m)^(3/4)
function calcNs(N_rpm, Q_m3s, H_m) {
  return N_rpm * Math.sqrt(Q_m3s) / Math.pow(H_m, 0.75);
}

/* ─── Impeller type classification ──────────────────────────────────── */
function classifyImpeller(Ns) {
  if (Ns < 25)  return 'Radial (Centrifugal)';
  if (Ns < 60)  return 'Francis / Mixed Flow';
  if (Ns < 120) return 'Mixed Flow / Axial';
  return 'Axial Flow';
}

/* ─── US → SI unit conversion ───────────────────────────────────────── */
function toSI_pump(inp) {
  return {
    Q_m3h:  inp.Q      * 0.22712,    // US GPM → m³/h   [3.785411784 L/min × 60/1000]
    H_m:    inp.H      * 0.3048,     // ft → m
    rho:    inp.rho    * 16.01846,   // lb/ft³ → kg/m³  [0.45359237 / 0.028316847]
    Ps_bar: inp.Ps     * 0.0689476,  // psia → bar
    Pv_bar: inp.Pv     * 0.0689476,
    Vs_ms:  inp.Vs     * 0.3048,     // ft/s → m/s
    hfs_m:  inp.hfs    * 0.3048,
    zs_m:   inp.zs     * 0.3048,
    NPSHr:  inp.NPSHr  * 0.3048,
  };
}

/* ─── Finite output guard ────────────────────────────────────────────── */
// JSON.stringify silently converts Infinity/NaN → null, hiding errors from client.
function assertFinite(val, label) {
  if (!isFinite(val))
    throw new Error(`Computed "${label}" is not finite — check input magnitudes.`);
}

/* ─── Main calculation ───────────────────────────────────────────────── */
function pumpCalc(params) {
  const {
    Q, H, rho,
    n_stages = 1,
    config   = 'series',
    eta_h: eta_h_in, eta_mec, eta_m,
    N_rpm,
    nu_cSt   = 1.0,
    Ps, Pv, Vs, hfs,
    zs       = 0,
    NPSHr,
    pump_type = 'centrifugal',
    unitMode  = 'SI',
  } = params;

  /* ── Unit conversion ── */
  let si;
  if (unitMode === 'US') {
    si = toSI_pump({ Q, H, rho, Ps, Pv, Vs, hfs, zs, NPSHr });
  } else {
    si = { Q_m3h: Q, H_m: H, rho,
           Ps_bar: Ps, Pv_bar: Pv,
           Vs_ms: Vs, hfs_m: hfs, zs_m: zs, NPSHr };
  }

  /* ── Viscosity correction (centrifugal only, ν > 10 cSt) ── */
  let eta_h         = eta_h_in;
  let viscCorr      = false;
  let viscCorrFactor = 1.0;
  if (pump_type === 'centrifugal' && nu_cSt > 10) {
    viscCorrFactor = viscCorrectionFactor(nu_cSt);
    eta_h          = eta_h_in * viscCorrFactor;
    viscCorr       = true;
  }

  /* ── Stage totals ── */
  const Q_stage     = si.Q_m3h;
  const H_total     = config === 'series'   ? n_stages * si.H_m   : si.H_m;
  const Q_total     = config === 'parallel' ? n_stages * si.Q_m3h : si.Q_m3h;
  const Q_stage_m3s = Q_stage / 3600;

  /* ── Power chain ── */
  const P_hyd_stage = si.rho * G_GRAV * Q_stage_m3s * si.H_m / 1000; // kW
  const P_hyd_total = n_stages * P_hyd_stage;
  const P_shaft     = P_hyd_total / (eta_h * eta_mec);
  const P_input     = P_shaft / eta_m;

  // Guard against Infinity/NaN before returning
  assertFinite(P_hyd_total, 'P_hyd_total');
  assertFinite(P_shaft,     'P_shaft');
  assertFinite(P_input,     'P_input');

  /* ── Vapour pressure guard ── */
  const pvWarn  = si.Pv_bar >= si.Ps_bar;
  const Pv_safe = pvWarn ? si.Ps_bar * 0.999 : si.Pv_bar;

  /* ── NPSH available ── */
  const NPSHa = calcNPSHa(si.Ps_bar, Pv_safe, si.rho, si.Vs_ms, si.hfs_m, si.zs_m);
  const margin = NPSHa - si.NPSHr;
  const cavOk  = margin >= 0.5;

  /* ── Specific speed & impeller type ── */
  const Ns      = calcNs(N_rpm, Q_stage_m3s, si.H_m);
  const impType = classifyImpeller(Ns);

  /* ── Per-stage table (computed once, reused for all identical stages) ── */
  const P_shaft_stage = P_hyd_stage / (eta_h * eta_mec);
  const stages = [];
  for (let i = 1; i <= n_stages; i++) {
    stages.push({
      stage:   i,
      Q:       Q_stage,
      H:       si.H_m,
      P_hyd:   P_hyd_stage,
      P_shaft: P_shaft_stage,
      eta_h,
    });
  }

  return {
    ok: true,
    P_hyd_total, P_shaft, P_input,
    NPSHa, NPSHr: si.NPSHr, margin, cavOk, pvWarn,
    Q_total, H_total, n_stages, config,
    Ns, impType,
    eta_h, eta_mec, eta_m,
    viscCorr, viscCorrFactor, nu_cSt, eta_h_input: eta_h_in,
    zs: si.zs_m,
    stages,
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

  const err = validatePumpInputs(body);
  if (err) return res.status(400).json({ error: err });

  try {
    return res.status(200).json(pumpCalc(body));
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Calculation error.' });
  }
}
