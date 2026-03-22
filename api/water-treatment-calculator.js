// ============================================================
//  api/water-treatment-calculator.js  — AUDITED v2
//  Vercel Serverless Function — multicalci.com
//
//  AUDIT FIXES APPLIED (deep review 2026-03):
//  [CRITICAL] FIX-1  RO:        SEC /3.6 → /36 (was 10× too high; 1 bar·m³=1/36 kWh not 1/3.6)
//  [CRITICAL] FIX-2  Clarifier: Sludge vol ssKgd*SVI/MLSS → ssKgd*SVI/1000 (dimensional error)
//  [HIGH]     FIX-3  DM:        HCl density 1.18 → f(concentration) (~1.02 for 5% soln)
//  [HIGH]     FIX-4  DM:        NaOH density 1.22 → f(concentration) (~1.04 for 4% soln)
//  [HIGH]     FIX-5  DM:        Cycle length: add ×1000 eq→meq conversion; was 1000× too small
//  [HIGH]     FIX-6  Boiler:    Sat temp: gauge → absolute pressure (press+1.013 bar)
//  [HIGH]     FIX-7  Chem:      kgday = active chemical mass (not solution mass)
//  [MEDIUM]   FIX-8  RO:        Vessel count: nVperStage*stages as authoritative total
//  [MEDIUM]   FIX-9  Boiler:    Silica volatility corrected to ASME CRTD-34 values
//  [MEDIUM]   FIX-10 Drinking:  LSI uses dedicated Ca+Alk inputs (dw_ca, dw_alk) not hardness proxy
//  [LOW]      FIX-11 RO:        Kelvin 273 → 273.15
//  [LOW]      FIX-12 Drinking:  Giardia CT <10°C: 90 → 95 mg·min/L (EPA LT1ESWTR)
// ============================================================

// ============================================================
//  api/water-treatment-calculator.js
//  Vercel Serverless Function — multicalci.com
//
//  Handles POST requests for all 6 WTP calculator modules:
//    ro        → RO Membrane System
//    clarifier → Gravity Clarifier / Sedimentation
//    dm        → DM Plant (Ion Exchange)
//    boiler    → Boiler Feed Water Chemistry (ASME / IS 10392 / ABMA)
//    drinking  → Drinking Water Treatment (IS 10500 / WHO)
//    chem      → Chemical Dosing System
//
//  Request body (JSON):
//    { "type": "<module>", ...inputs }
//
//  Response body (JSON):
//    { "ok": true,  "data": { ...calculated_results } }   — success
//    { "ok": false, "error": "<message>" }                — validation/input error
//
//  CORS: allowed for all origins (same policy as other API routes).
// ============================================================

export default function handler(req, res) {

  // ── CORS headers (mirrors vercel.json /api/(.*) headers) ──────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  const { type } = body || {};
  if (!type) return res.status(400).json({ ok: false, error: 'Missing "type" field' });

  // ── Dispatch ──────────────────────────────────────────────────────────────
  try {
    switch (type) {
      case 'ro':        return res.json(calcRO(body));
      case 'clarifier': return res.json(calcClarifier(body));
      case 'dm':        return res.json(calcDM(body));
      case 'boiler':    return res.json(calcBoiler(body));
      case 'drinking':  return res.json(calcDrinking(body));
      case 'chem':      return res.json(calcChem(body));
      default:          return res.status(400).json({ ok: false, error: `Unknown calculator type: "${type}"` });
    }
  } catch (err) {
    console.error('[WTP API]', type, err);
    return res.status(500).json({ ok: false, error: 'Internal calculation error', detail: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function err(msg)  { return { ok: false, error: msg }; }
function ok(data)  { return { ok: true,  data }; }
function fmt(v, d=2) { return isNaN(v) ? null : +v.toFixed(d); }

// ─────────────────────────────────────────────────────────────────────────────
//  1. RO MEMBRANE SYSTEM
//  Inputs: Qf, TDSf, P (bar), T (°C), SDI, rec (%), rej (%), flux (L/m²/hr),
//          stages, memA (m²/element), epv (elements/vessel), pH, ca, alk
// ─────────────────────────────────────────────────────────────────────────────
function calcRO(p) {
  const { Qf, TDSf, P, T, SDI, rec: recPct, rej: rejPct,
          flux, stages, memA, epv, pH, ca, alk } = p;

  const rec = recPct / 100;
  const rej = rejPct / 100;

  if ([Qf, TDSf, P, T, SDI, rec, rej, flux, stages, memA, epv].some(v => isNaN(v)))
    return err('Fill all required fields.');
  if (rec >= 0.95 || rec < 0.1)
    return err('Recovery must be 10–95%.');
  if (SDI >= 6)
    return err('SDI ≥ 6 — Pre-treat to SDI < 5 before RO.');
  if (rej < 0.85)
    return err('Salt rejection must be at least 85%.');

  // Mass balance
  const Qp   = Qf * rec;
  const Qc   = Qf - Qp;
  const CF   = 1 / (1 - rec);
  const TDSp = TDSf * (1 - rej);
  const TDSc = (TDSf * Qf - TDSp * Qp) / Math.max(Qc, 0.001);
  const actRej = (1 - TDSp / TDSf) * 100;

  // Membrane sizing
  const totalMemA  = (Qp * 1000) / flux;
  const nElem      = Math.ceil(totalMemA / memA);
  const nVperStage = Math.ceil(Math.ceil(nElem / epv) / stages);  // FIX-8: compute stage size first
  const nVessel    = nVperStage * stages;                            // authoritative total (ceiling-consistent)

  // Temperature correction (TCF)
  const TCF       = Math.exp(2640 * (1 / (T + 273.15) - 1 / 298.15));
  const fluxCorr  = flux / TCF;

  // Langelier Saturation Index
  const pK2      = 10.33 - 0.0142 * T;
  const pKs      = 8.34  - 0.013  * T;
  const pCa      = -Math.log10(Math.max(ca  / 40080, 1e-10));
  const pAlk     = -Math.log10(Math.max(alk / 50000, 1e-10));
  const pHs      = pK2 - pKs + pCa + pAlk;
  const pHconc   = pH + Math.log10(CF);
  const LSI_feed = pH - pHs;

  const pCa_conc  = -Math.log10(Math.max(ca  * CF / 40080, 1e-10));
  const pAlk_conc = -Math.log10(Math.max(alk * CF / 50000, 1e-10));
  const pHs_conc  = pK2 - pKs + pCa_conc + pAlk_conc;
  const LSI_conc  = pHconc - pHs_conc;

  // Osmotic pressure & energy
  const osmFeed = TDSf * 0.0000689;
  const osmConc = TDSc * 0.0000689;
  const NDP     = P - osmConc;
  const SEC     = (P * Qf) / (Qp * 0.75 * 36);    // kWh/m³ permeate — FIX-1: 1 bar·m³=100kJ=100/3600kWh=1/36kWh

  return ok({
    // Mass balance
    Qf, Qp: fmt(Qp), Qc: fmt(Qc), TDSf,
    TDSp: fmt(TDSp, 0), TDSc: fmt(TDSc, 0),
    recovery_pct: fmt(rec * 100, 0),
    salt_rejection_pct: fmt(actRej, 1),

    // Membrane configuration
    totalMemArea_m2: fmt(totalMemA, 0),
    nElements: nElem,
    nVessels: nVessel,
    nVesselsPerStage: nVperStage,

    // Performance
    TCF: fmt(TCF, 3),
    correctedFlux: fmt(fluxCorr, 1),
    SEC_kWh_m3: fmt(SEC, 2),
    NDP_bar: fmt(NDP, 2),
    osmPressureConc_bar: fmt(osmConc, 2),

    // LSI (scaling)
    LSI_feed: fmt(LSI_feed, 3),
    LSI_conc: fmt(LSI_conc, 3),
    pHconc: fmt(pHconc, 2),
    antiscalant_required: LSI_conc > 0,

    // Checks
    checks: {
      permeate_potable:  TDSp <= 500,
      recovery_optimal:  rec >= 0.65 && rec <= 0.85,
      SDI_ok:            SDI <= 5,
      NDP_ok:            NDP >= 2,
      LSI_stable:        LSI_conc <= 0,
      LSI_with_AS:       LSI_conc <= 1,
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  2. GRAVITY CLARIFIER / SEDIMENTATION
//  Inputs: Q, ti, to, SS, T, pH, SOR, DT, WLR, type, SVI, MLSS, coag, dose
// ─────────────────────────────────────────────────────────────────────────────
function calcClarifier(p) {
  const { Q, ti, to, SS, T, pH, SOR, DT, WLR,
          type = 'circular', SVI, MLSS, coag = 'alum', dose } = p;

  if ([Q, ti, to, SS, SOR, DT, WLR, SVI, MLSS, dose].some(v => isNaN(v)))
    return err('Fill all required fields.');
  if (to >= ti) return err('Effluent turbidity must be less than influent.');
  if (Q <= 0 || SOR <= 0) return err('Flow rate and SOR must be positive.');

  const Qdaily   = Q * 24;
  const A        = Q / SOR;
  const V        = Q * DT;
  const depth    = V / A;

  let dia = 0, len = 0, wid = 0;
  if (type === 'circular' || type === 'inclined' || type === 'upflow')
    dia = Math.sqrt(A * 4 / Math.PI);
  else { len = Math.sqrt(A * 1.5); wid = A / len; }

  const weir      = Qdaily / WLR;
  const turbRem   = (ti - to) / ti * 100;
  const ssRem     = Math.min(98, turbRem * 0.92);
  const ssKgd     = (SS * ssRem / 100) * Qdaily / 1000;
  const sludgeVol = ssKgd * SVI / 1000;  // FIX-2: ssKgd[kg/d]*SVI[mL/g]/1000=m³/d. Old /MLSS was dimensionally wrong.
  const coagKgd   = dose * Qdaily / 1e6 * 1e3;
  const G_rapid   = 800;
  const G_floc    = Math.max(20, Math.min(60, 55 - (ti - 50) * 0.05));
  const upVel     = Q / A;

  const coagNames = {
    alum: 'Alum Al₂(SO₄)₃', ferric: 'Ferric Chloride',
    pac: 'PAC', lime: 'Lime'
  };

  return ok({
    surface_area_m2:   fmt(A, 0),
    diameter_m:        fmt(dia, 1),
    length_m:          fmt(len, 1),
    width_m:           fmt(wid, 1),
    depth_m:           fmt(depth, 2),
    volume_m3:         fmt(V, 0),
    upflow_velocity:   fmt(upVel, 3),
    weir_length_m:     fmt(weir, 1),

    turbidity_removal_pct: fmt(turbRem, 1),
    SS_removal_pct:        fmt(ssRem, 1),
    SS_removed_kgDay:      fmt(ssKgd, 0),
    sludge_volume_m3Day:   fmt(sludgeVol, 1),
    coagulant:             coagNames[coag] || coag,
    coagulant_dose_mgL:    dose,
    coagulant_qty_kgDay:   fmt(coagKgd, 1),

    mixing: { G_rapid_per_s: G_rapid, G_floc_per_s: fmt(G_floc, 0) },

    checks: {
      SOR_ok:   SOR >= 0.8 && SOR <= 2.0,
      DT_ok:    DT  >= 2   && DT  <= 4,
      WLR_ok:   WLR >= 125 && WLR <= 250,
      depth_ok: depth >= 2.5 && depth <= 5,
      SVI_ok:   SVI <= 150,
      effluent_turbidity_ok: to <= 1,
      pH_coag_optimal: pH >= 6.5 && pH <= 8,
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  3. DM PLANT (ION EXCHANGE)
//  Inputs: flow, cat, an, si, co2, tds, catcap, ancap, cycle, vel, bedh,
//          hcl_c, naoh_c, hcl_d, naoh_d, cond_t, si_t
// ─────────────────────────────────────────────────────────────────────────────
function calcDM(p) {
  const { flow, cat, an, si, co2, tds,
          catcap, ancap, cycle, vel, bedh,
          hcl_c, naoh_c, hcl_d, naoh_d, cond_t, si_t } = p;

  if ([flow, cat, an, si, co2, catcap, ancap, cycle, vel, bedh,
       hcl_c, naoh_c, hcl_d, naoh_d].some(v => isNaN(v)))
    return err('Fill all required fields.');
  if (cat < 0 || an < 0 || si < 0)
    return err('Concentrations cannot be negative.');

  const catMeq   = cat / 50;
  const totalAn  = an + si * 50 / 30 + co2 * 50 / 22;
  const anMeq    = totalAn / 50;

  const colAreaCat = flow / vel;
  const colDiaCat  = Math.sqrt(colAreaCat * 4 / Math.PI);
  const colAreaAn  = flow / (vel * 0.85);
  const colDiaAn   = Math.sqrt(colAreaAn * 4 / Math.PI);

  const catResL = colAreaCat * bedh * 1000;
  const anResL  = colAreaAn  * bedh * 1000;

  const hclKg  = (catResL * catcap * hcl_d)  / 1000;
  const naohKg = (anResL  * ancap  * naoh_d) / 1000;
  // FIX-3 & FIX-4: concentration-dependent densities (old code used 1.18/1.22 which are 36%/20% densities)
  const _hclDen  = hcl_c  <= 6  ? 1.020 + hcl_c  * 0.003
                 : hcl_c  <= 15 ? 1.030 + hcl_c  * 0.005
                 : 1.100 + hcl_c * 0.003;   // kg/L at w/w%
  const _naohDen = naoh_c <= 5  ? 1.000 + naoh_c * 0.010
                 : naoh_c <= 15 ? 1.050 + naoh_c * 0.011
                 : 1.200 + naoh_c * 0.005;  // kg/L at w/w%
  const hclL   = hclKg  / (hcl_c  / 100 * _hclDen);
  const naohL  = naohKg / (naoh_c / 100 * _naohDen);

  const totalCapCat = catResL * catcap;
  const loadPerHr   = catMeq * flow * 1000;
  const cycleHr     = Math.min(cycle * 1.2, totalCapCat * 1000 / Math.max(loadPerHr, 0.001));  // FIX-5: totalCapCat[eq]*1000→meq to match loadPerHr[meq/hr]
  const regPerDay   = 24 / Math.max(cycleHr, cycle);
  const washWaterM3 = (catResL + anResL) * 0.005;

  const siLeakFraction = si > 20 ? 0.015 : si > 10 ? 0.008 : 0.004;
  const siLeak         = si * siLeakFraction;

  const degasserRecommended = co2 > 15;
  const anionLoadSaving_pct = degasserRecommended
    ? fmt(co2 / Math.max(totalAn, 1) * 50 * 0.9, 0)
    : 0;

  return ok({
    cation_column_dia_m:  fmt(colDiaCat, 2),
    anion_column_dia_m:   fmt(colDiaAn, 2),
    cation_col_area_m2:   fmt(colAreaCat, 2),
    anion_col_area_m2:    fmt(colAreaAn, 2),
    cation_resin_vol_L:   fmt(catResL, 0),
    anion_resin_vol_L:    fmt(anResL, 0),

    hcl_per_regen_kg:     fmt(hclKg, 1),
    naoh_per_regen_kg:    fmt(naohKg, 1),
    hcl_soln_L:           fmt(hclL, 0),
    naoh_soln_L:          fmt(naohL, 0),
    hcl_daily_kg:         fmt(hclKg * Math.max(1, regPerDay), 1),
    naoh_daily_kg:        fmt(naohKg * Math.max(1, regPerDay), 1),

    est_cycle_hr:         fmt(cycleHr, 1),
    regens_per_day:       fmt(Math.max(1, regPerDay), 1),
    wash_water_L:         fmt(washWaterM3 * 1000, 0),
    wash_water_pct:       fmt(washWaterM3 / cycle / flow * 100, 1),

    ion_loads: {
      cation_meqL:   fmt(catMeq, 2),
      anion_meqL:    fmt(anMeq, 2),
      silica_mgL:    si,
      free_co2_mgL:  co2,
    },

    product_quality: {
      silica_leak_mgL:     fmt(siLeak, 4),
      silica_target_mgL:   si_t,
      silica_ok:           siLeak <= si_t,
      mixed_bed_needed:    siLeak > si_t,
    },

    recommendations: {
      degasser_recommended:  degasserRecommended,
      anion_load_saving_pct: anionLoadSaving_pct,
      regens_too_frequent:   regPerDay > 3,
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  4. BOILER FEED WATER CHEMISTRY  (ASME CRTD-34 / IS 10392 / ABMA)
//  Inputs: steam (t/hr), press (bar g), cr (%), nb, btype, fuel,
//          muTDS, hard, alk, cl, sil, fe, cu, DO_raw, toc, oil,
//          o2type, o2excess (%), phTarget, phos, daPresent, std, TDSmax
// ─────────────────────────────────────────────────────────────────────────────
function calcBoiler(p) {
  const {
    steam, press, cr: crPct, nb, btype = 'watertube', fuel,
    muTDS, hard, alk, cl = 0, sil, fe, cu,
    DO_raw, toc, oil,
    o2type = 'smbs', o2excess: o2excessPct = 20,
    phTarget, phos,
    daPresent, std = 'asme', TDSmax
  } = p;

  const cr       = crPct / 100;
  const o2excess = o2excessPct / 100;

  if ([steam, press, cr, muTDS, hard, sil, fe, cu, DO_raw, toc, phos].some(v => isNaN(v)))
    return err('Fill all required fields.');
  if (muTDS <= 0) return err('Makeup TDS must be positive.');
  if (press <= 0) return err('Boiler pressure must be positive.');

  // ── ASME pressure-based limits ──────────────────────────────────────────
  const pressPsig = press * 14.504;
  let limTDS, limSilica, limAlk, limCond, limFe_ug, limCu_ug,
      limDO_ug, limPH_lo, limPH_hi, limSteamTDS, limTSS;

  if      (pressPsig <=  300) { limTDS=3500;limSilica=150;limAlk=700;limCond=5400;limFe_ug=100;limCu_ug=50;limDO_ug=7000;limPH_lo=10.5;limPH_hi=12.0;limSteamTDS=1.0;limTSS=15; }
  else if (pressPsig <=  450) { limTDS=3000;limSilica=90;limAlk=600;limCond=4600;limFe_ug=50;limCu_ug=25;limDO_ug=1000;limPH_lo=10.5;limPH_hi=11.8;limSteamTDS=1.0;limTSS=10; }
  else if (pressPsig <=  600) { limTDS=2500;limSilica=40;limAlk=500;limCond=3800;limFe_ug=25;limCu_ug=20;limDO_ug=100;limPH_lo=10.0;limPH_hi=11.8;limSteamTDS=1.0;limTSS=8; }
  else if (pressPsig <=  750) { limTDS=1000;limSilica=30;limAlk=400;limCond=1500;limFe_ug=25;limCu_ug=20;limDO_ug=100;limPH_lo=10.0;limPH_hi=11.5;limSteamTDS=0.5;limTSS=3; }
  else if (pressPsig <=  900) { limTDS=750;limSilica=20;limAlk=300;limCond=1200;limFe_ug=15;limCu_ug=15;limDO_ug=20;limPH_lo=9.8;limPH_hi=11.0;limSteamTDS=0.5;limTSS=2; }
  else if (pressPsig <= 1000) { limTDS=625;limSilica=8;limAlk=200;limCond=1000;limFe_ug=10;limCu_ug=10;limDO_ug=20;limPH_lo=9.6;limPH_hi=10.8;limSteamTDS=0.5;limTSS=1; }
  else if (pressPsig <= 1500) { limTDS=100;limSilica=2;limAlk=null;limCond=150;limFe_ug=10;limCu_ug=10;limDO_ug=20;limPH_lo=9.0;limPH_hi=10.0;limSteamTDS=0.1;limTSS=1; }
  else if (pressPsig <= 2000) { limTDS=50;limSilica=1;limAlk=null;limCond=80;limFe_ug=5;limCu_ug=3;limDO_ug=7;limPH_lo=8.5;limPH_hi=9.5;limSteamTDS=0.05;limTSS=null; }
  else                        { limTDS=0.05;limSilica=0.02;limAlk=null;limCond=0.25;limFe_ug=null;limCu_ug=null;limDO_ug=7;limPH_lo=8.5;limPH_hi=9.5;limSteamTDS=0.05;limTSS=null; }

  if (btype === 'watertube_sh' || btype === 'hrsg') {
    limTDS    = Math.round(limTDS * 0.6);
    limSilica = Math.round(limSilica * 0.5 * 10) / 10;
  }

  const effectiveTDSmax = Math.min(TDSmax, limTDS);

  // ── COC & blowdown ───────────────────────────────────────────────────────
  const COC           = effectiveTDSmax / Math.max(muTDS, 0.001);
  const BD_pct        = 1 / (COC - 1) * 100;
  const BD_tph        = steam * BD_pct / 100;
  const condFlow      = steam * cr;
  const muFlow        = steam * (1 - cr) + BD_tph;
  const totalFeedFlow = steam + BD_tph;

  // ── Boiler water chemistry ───────────────────────────────────────────────
  const boilerTDS  = muTDS * COC;
  const boilerSil  = sil   * COC;
  const boilerAlk  = alk   * COC;
  const boilerCond = boilerTDS * 1.6;
  const boilerCl   = cl   * COC;

  const maxCOCsilica = limSilica / Math.max(sil, 0.001);
  const maxCOCalk    = limAlk ? limAlk / Math.max(alk, 0.001) : Infinity;
  const recCOC       = Math.min(COC, maxCOCsilica, maxCOCalk, 20);

  // ── DO after deaerator ───────────────────────────────────────────────────
  const DO_after_DA = daPresent ? Math.min(DO_raw * 0.005, 0.005) : DO_raw;

  // ── O2 scavenger ────────────────────────────────────────────────────────
  let o2DoseMgL, o2Name, o2Note;
  const DO_to_scav = DO_after_DA;
  if (o2type === 'hydrazine') {
    o2DoseMgL = DO_to_scav * 1.0 * (1 + o2excess);
    o2Name = 'Hydrazine N₂H₄';
    o2Note = 'Decomposes to N₂ + H₂O — no TDS contribution. Not for food steam.';
  } else if (o2type === 'smbs') {
    o2DoseMgL = DO_to_scav * 8 * (1 + o2excess);
    o2Name = 'SMBS (Na₂S₂O₅)';
    o2Note = 'Used for LP/MP boilers. Decomposes above 120°C releasing SO₂.';
  } else if (o2type === 'carbohydrazide') {
    o2DoseMgL = DO_to_scav * 1.4 * (1 + o2excess);
    o2Name = 'Carbohydrazide';
    o2Note = 'Food-grade alternative to hydrazine. Effective up to 200 bar.';
  } else {
    o2DoseMgL = DO_to_scav * 1.5 * (1 + o2excess);
    o2Name = 'Sodium Erythorbate';
    o2Note = 'Food-grade oxygen scavenger. pH stable.';
  }
  const o2KgDay   = o2DoseMgL * muFlow * 24 / 1e6 * 1e3;
  const phosKgDay = phos * muFlow * 24 / 1e6 * 1e3;

  // ── Saturation temp, heat loss, silica carryover ─────────────────────────
  const satT        = press > 0 ? 100 + 28.5 * Math.log(Math.max((press + 1.013) / 1.013, 1)) : 100;  // FIX-6: convert gauge to absolute before log
  const hf          = 4.18 * satT + 0.0015 * satT * satT;   // kJ/kg
  const bdHeatLoss  = BD_tph * 1000 * hf / 3600;            // kW
  const bdHeatMcal  = bdHeatLoss * 0.86;

  // FIX-9: ASME CRTD-34 aligned factors (old 0.15/0.05/0.01 were overestimated)
  const silicaVolatilityFactor = pressPsig > 1200 ? 0.10
                               : pressPsig >  900 ? 0.05
                               : pressPsig >  600 ? 0.02
                               :                    0.005;
  const silCarryover           = boilerSil * silicaVolatilityFactor;

  const pumpHead = press * 100 / 9.81 + 30;   // m
  const pumpFlow = totalFeedFlow * 1000 / 3600; // L/s

  // ── Compliance flags ──────────────────────────────────────────────────────
  const f = {
    tds:   boilerTDS     <= limTDS,
    silica: boilerSil    <= limSilica,
    alk:   !limAlk       || boilerAlk <= limAlk,
    fe:    fe * 1000     <= limFe_ug,
    cu:    cu * 1000     <= limCu_ug,
    do:    DO_after_DA * 1000 <= limDO_ug,
    toc:   toc           <= (pressPsig > 1000 ? 1 : pressPsig > 600 ? 3 : 5),
    oil:   oil           <= (pressPsig > 600 ? 0.5 : 1.0),
    cond:  boilerCond    <= limCond,
  };
  const allOK = Object.values(f).every(Boolean);
  const stdName = std === 'asme' ? 'ASME CRTD-34' : std === 'is' ? 'IS 10392' : 'ABMA';

  return ok({
    standard: stdName,
    press_bar: press,
    press_psig: fmt(pressPsig, 0),

    // Limits for this pressure range
    limits: {
      TDS: limTDS, silica: limSilica, alkalinity: limAlk,
      conductivity: limCond,
      Fe_ug: limFe_ug, Cu_ug: limCu_ug, DO_ug: limDO_ug,
      pH_lo: limPH_lo, pH_hi: limPH_hi, steamTDS: limSteamTDS, TSS: limTSS,
    },

    // Mass balance
    COC: fmt(COC, 2),
    BD_pct: fmt(BD_pct, 2),
    BD_tph: fmt(BD_tph, 3),
    condensate_return_tph: fmt(condFlow, 2),
    makeup_flow_tph: fmt(muFlow, 2),
    total_feed_tph: fmt(totalFeedFlow, 2),
    rec_max_COC: fmt(recCOC, 1),
    COC_limited_by: recCOC === maxCOCsilica ? 'silica' : recCOC === maxCOCalk ? 'alkalinity' : 'TDS limit',
    sat_steam_temp_C: fmt(satT, 0),
    BD_heat_loss_kW: fmt(bdHeatLoss, 0),
    BD_heat_loss_Mcal_hr: fmt(bdHeatMcal, 0),

    // Boiler water
    boiler_TDS_mgL: fmt(boilerTDS, 0),
    boiler_silica_mgL: fmt(boilerSil, 2),
    boiler_alkalinity_mgL: fmt(boilerAlk, 0),
    boiler_conductivity_uS: fmt(boilerCond, 0),
    boiler_Cl_mgL: fmt(boilerCl, 1),
    silica_carryover_mgL: fmt(silCarryover, 3),
    silica_turbine_risk: silCarryover > 0.05,

    // Chemicals
    o2_scavenger: o2Name,
    o2_dose_mgL: fmt(o2DoseMgL, 2),
    o2_qty_kgDay: fmt(o2KgDay, 3),
    o2_note: o2Note,
    phosphate_dose_mgL: phos,
    phosphate_qty_kgDay: fmt(phosKgDay, 3),
    DA_installed: !!daPresent,
    DO_after_DA_mgL: fmt(DO_after_DA, 3),

    // Pump
    feed_pump_head_m: fmt(pumpHead, 0),
    feed_pump_flow_Ls: fmt(pumpFlow, 2),

    // Compliance
    compliance: f,
    all_within_spec: allOK,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  5. DRINKING WATER TREATMENT  (IS 10500:2012 / WHO)
//  Inputs: flow, turb, tds, pH, hard, ecoli, fl, fe, alum, cl2, cl_d,
//          ct, fr, nf, media, temp
// ─────────────────────────────────────────────────────────────────────────────
function calcDrinking(p) {
  // FIX-10: Added dw_alk (alkalinity mg/L CaCO3) and dw_ca (calcium mg/L as Ca2+) for proper LSI
  const { flow, turb, tds, pH, hard, ecoli = 0,
          fl = 0, fe = 0, alum, cl2, cl_d, ct, fr, nf, media, temp,
          dw_alk, dw_ca } = p;   // NEW: separate alkalinity and Ca inputs

  if ([flow, turb, tds, pH, hard, alum, cl2, cl_d, ct, fr, nf, media, temp].some(v => isNaN(v)))
    return err('Fill all required fields.');
  if (cl2 <= cl_d) return err('Chlorine dose must exceed demand. Increase dose or reduce demand estimate.');
  if (flow <= 0)   return err('Flow rate must be positive.');

  const clRes     = cl2 - cl_d;
  const CT_act    = clRes * ct;
  const CT_giardia = temp > 20 ? 28 : temp > 15 ? 50 : temp > 10 ? 70 : 95;   // FIX-12: EPA LT1ESWTR pH 7-8: 95 (not 90) at ≤10°C
  const CT_crypto  = temp > 20 ? 4500 : 8600;
  const logGiardia = Math.min(6, CT_act / CT_giardia * 3);

  const alumKgd     = alum * flow * 24 / 1e3;
  const cl2Kgd      = cl2  * flow * 24 / 1e3;
  const filtAreaTot = flow / fr;
  const filtAreaEa  = flow / (fr * (nf - 1));   // N-1 for backwash
  const filtLen     = Math.sqrt(filtAreaEa);

  // After-treatment turbidity
  const turbAfterClar = turb * (1 - Math.min(0.97, alum / 100 * 0.8 + 0.2));
  const turbFinal     = Math.max(0.05, turbAfterClar * 0.1);
  const feAfterFilt   = fe > 0.3 ? fe * 0.15 : fe;

  // Corrosion indices — FIX-10: use dedicated Ca and Alk inputs if provided, else fall back to hardness proxy
  const pK2      = 10.33 - 0.014 * temp;
  const pKs      = 8.34  - 0.013 * temp;
  const ca_mgL   = (dw_ca  && dw_ca  > 0) ? dw_ca  : hard * 0.6 * 40.08 / 100;  // Ca2+ mg/L
  const alk_caco3 = (dw_alk && dw_alk > 0) ? dw_alk : hard;                        // mg/L as CaCO3
  const pCa      = -Math.log10(Math.max(ca_mgL / 40080, 1e-10));
  const pAlk_v   = -Math.log10(Math.max(alk_caco3 / 50000, 1e-10));
  const pHs      = pK2 - pKs + pCa + pAlk_v;
  const LSI   = pH - pHs;
  const RSI   = 2 * pHs - pH;

  const Qdaily    = flow * 24;
  const popServed = Math.round(Qdaily * 1000 / 150);

  const fluorDose = fl < 0.6 ? 1.0 - fl : 0;

  // IS 10500 compliance
  const c = {
    turbidity:     turbFinal <= 1,
    TDS:           tds <= 500,
    pH:            pH >= 6.5 && pH <= 8.5,
    cl2_residual:  clRes >= 0.2 && clRes <= 1.0,
    hardness:      hard <= 200,
    iron:          feAfterFilt <= 0.3,
    fluoride:      fl <= 1.0,
  };
  const comply = Object.values(c).every(Boolean);

  return ok({
    population_served: popServed,
    daily_volume_m3:   fmt(Qdaily, 0),

    disinfection: {
      cl2_residual_mgL: fmt(clRes, 2),
      CT_actual:        fmt(CT_act, 0),
      CT_giardia_req:   CT_giardia,
      CT_crypto_ref:    CT_crypto,
      giardia_log_removal: fmt(logGiardia, 1),
      giardia_3log_achieved: logGiardia >= 3,
    },

    treated_quality: {
      turbidity_NTU:   fmt(turbFinal, 2),
      iron_mgL:        fmt(feAfterFilt, 2),
      cl2_residual_mgL: fmt(clRes, 2),
    },

    corrosion_indices: {
      LSI: fmt(LSI, 2),
      RSI: fmt(RSI, 2),
      tendency: LSI > 0.5 ? 'Scaling' : LSI < -0.5 ? 'Corrosive' : 'Balanced',
    },

    chemicals: {
      alum_dose_mgL:  alum,
      alum_kgDay:     fmt(alumKgd, 1),
      cl2_dose_mgL:   cl2,
      cl2_kgDay:      fmt(cl2Kgd, 1),
    },

    filtration: {
      total_area_m2: fmt(filtAreaTot, 1),
      area_each_m2:  fmt(filtAreaEa, 1),
      dim_approx_m:  fmt(filtLen, 1),
      n_filters:     nf,
    },

    fluoride: {
      raw_mgL:     fl,
      dosing_required: fluorDose > 0,
      dose_to_add_mgL: fmt(fluorDose, 2),
    },

    compliance_IS10500: c,
    overall_compliant:  comply,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  6. CHEMICAL DOSING SYSTEM
//  Inputs: flow, hrs, auto (days autonomy), sf (service factor),
//          d1/d2/d3, s1/s2/s3 (%), den1/2/3 (kg/L), n1/n2/n3 (name)
// ─────────────────────────────────────────────────────────────────────────────
function calcChem(p) {
  const { flow, hrs, auto, sf,
          d1 = 0, s1 = 0, den1, n1 = 'Chemical 1',
          d2 = 0, s2 = 0, den2, n2 = 'Chemical 2',
          d3 = 0, s3 = 0, den3, n3 = 'Chemical 3' } = p;

  if ([flow, hrs, auto, sf, d1, s1 / 100, den1, d2, s2 / 100, den2, d3, s3 / 100, den3].some(v => isNaN(v)))
    return err('Fill all required fields.');
  if ([d1, d2, d3].every(v => v <= 0))
    return err('At least one chemical dose must be > 0.');

  function cc(dose, strPct, den, name) {
    if (dose <= 0) return null;
    const str  = strPct / 100;
    const Lhr  = (dose * flow) / (str * den * 1e3);
    const Lday = Lhr * hrs;
    const kgday_chemical = Lday * den * str;  // FIX-7: active chemical kg/day
    const kgday_solution = Lday * den;          // solution mass kg/day
    const kgday = kgday_chemical;               // alias
    const tank  = Lday * auto;
    const pump  = Lhr * sf;
    return { name, dose, str: strPct, den, Lhr, Lday, kgday, kgday_solution, tank_L: tank, pump_Lhr: pump };
  }

  const chemicals = [
    cc(d1, s1, den1, n1),
    cc(d2, s2, den2, n2),
    cc(d3, s3, den3, n3),
  ].filter(Boolean);

  return ok({
    design_basis: { flow_m3hr: flow, ops_hrs_day: hrs, autonomy_days: auto, service_factor: sf },
    chemicals: chemicals.map(c => ({
      name:          c.name,
      dose_mgL:      c.dose,
      strength_pct:  c.str,
      density_kgL:   c.den,
      pump_rate_Lhr:        fmt(c.pump_Lhr, 2),
      daily_vol_L:          fmt(c.Lday, 1),
      daily_mass_chemical_kg: fmt(c.kgday, 1),   // FIX-7: pure chemical mass
      daily_mass_solution_kg: fmt(c.kgday_solution, 1),  // solution mass
      tank_vol_L:    fmt(c.tank_L, 0),
      tank_vol_m3:   fmt(c.tank_L / 1000, 2),
    })),
  });
}
