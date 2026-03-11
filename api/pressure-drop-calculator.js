// api/pressure-drop-calculator.js
// Vercel Serverless Function — Pressure Drop Calculator
// Handles: fluidList, fluidProps, fittingsList, calculate, calcHW
// All engineering computation lives here — zero physics in the browser.

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SECURITY HELPERS
═══════════════════════════════════════════════════════════════ */
const ALLOWED_ORIGINS = [
  'https://multicalci.com',
  'https://www.multicalci.com',
  'https://nagtesting.vercel.app',
];

function setCORS(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sanitizeNumber(v, fallback = null) {
  const n = parseFloat(v);
  return isFinite(n) ? n : fallback;
}

function sanitizeString(v, maxLen = 64) {
  if (typeof v !== 'string') return '';
  return v.replace(/[^a-zA-Z0-9_\-\.]/g, '').slice(0, maxLen);
}

function err(res, status, msg) {
  return res.status(status).json({ ok: false, error: msg });
}

/* ═══════════════════════════════════════════════════════════════
   FLUID DATABASE  (120+ fluids — Andrade liquids · Sutherland gas)
   Sources: Perry's ChE Handbook · NIST WebBook · Yaws' Handbook
═══════════════════════════════════════════════════════════════ */
const FLUID_DB = [
  // ── WATER & AQUEOUS ──────────────────────────────────────────────────────
  {id:'water',       name:'Water',                      cat:'Water & Aqueous',     isGas:false,
   rhoModel:'poly_water', viscModel:'andrade', A:-3.5985, B:1061.0,
   Pv_A:8.07131, Pv_B:1730.63, Pv_C:233.426,
   vp:[[0,0.611],[10,1.228],[20,2.338],[30,4.243],[40,7.384],[50,12.35],[60,19.94],[70,31.18],[80,47.39],[90,70.11],[100,101.3],[110,143.3],[120,198.5],[150,476.2],[200,1554]]},

  {id:'seawater',    name:'Seawater (3.5% NaCl)',       cat:'Water & Aqueous',     isGas:false,
   rhoModel:'linear', rho0:1025, Tref:20, k_rho:-0.30,
   viscModel:'andrade', A:-3.35, B:1030.0,
   vp:[[0,0.54],[10,1.08],[20,2.1],[30,3.81],[50,10.9],[80,44.3],[100,97.0]]},

  {id:'brine10',     name:'Brine 10% NaCl',             cat:'Water & Aqueous',     isGas:false,
   rhoModel:'linear', rho0:1071, Tref:20, k_rho:-0.35,
   viscModel:'andrade', A:-3.60, B:1010.0,
   vp:[[0,0.54],[20,2.1],[50,10.5],[80,43.0],[100,96.0]]},

  {id:'brine20',     name:'Brine 20% NaCl',             cat:'Water & Aqueous',     isGas:false,
   rhoModel:'linear', rho0:1148, Tref:20, k_rho:-0.40,
   viscModel:'linear', mu0:1.90, Tref_mu:20, k_mu:-0.030,
   vp:[[0,0.5],[20,1.95],[50,10.0],[80,41.5],[100,93.0]]},

  {id:'brine25',     name:'Brine 25% NaCl',             cat:'Water & Aqueous',     isGas:false,
   rhoModel:'linear', rho0:1188, Tref:20, k_rho:-0.45,
   viscModel:'linear', mu0:2.30, Tref_mu:20, k_mu:-0.040, vapFixed:0.017},

  {id:'cacl2_20',    name:'CaCl₂ Solution 20%',         cat:'Water & Aqueous',     isGas:false,
   rhoModel:'linear', rho0:1176, Tref:20, k_rho:-0.45,
   viscModel:'andrade', A:-3.40, B:1100.0,
   vp:[[0,0.48],[20,1.85],[50,9.5],[80,40.0],[100,90.0]]},

  {id:'cacl2_30',    name:'CaCl₂ Solution 30%',         cat:'Water & Aqueous',     isGas:false,
   rhoModel:'linear', rho0:1280, Tref:20, k_rho:-0.50,
   viscModel:'andrade', A:-2.80, B:1350.0,
   vp:[[0,0.4],[20,1.6],[50,8.5],[80,36.0],[100,82.0]]},

  // ── GLYCOLS & COOLANTS ────────────────────────────────────────────────────
  {id:'eg30',        name:'Ethylene Glycol 30%',        cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1054, Tref:20, k_rho:-0.55,
   viscModel:'andrade', A:-4.50, B:1350.0, vapFixed:0.021},

  {id:'eg50',        name:'Ethylene Glycol 50%',        cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1080, Tref:20, k_rho:-0.58,
   viscModel:'andrade', A:-3.80, B:1650.0,
   vp:[[0,0.3],[20,1.2],[50,8.0],[80,34],[100,78]]},

  {id:'eg70',        name:'Ethylene Glycol 70%',        cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1096, Tref:20, k_rho:-0.60,
   viscModel:'andrade', A:-2.80, B:2100.0,
   vp:[[0,0.18],[20,0.8],[50,6.0],[80,28],[100,68]]},

  {id:'pg30',        name:'Propylene Glycol 30%',       cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1034, Tref:20, k_rho:-0.55,
   viscModel:'andrade', A:-4.00, B:1400.0,
   vp:[[0,0.5],[20,1.8],[50,10.0],[80,40],[100,90]]},

  {id:'pg50',        name:'Propylene Glycol 50%',       cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1059, Tref:20, k_rho:-0.60,
   viscModel:'andrade', A:-3.20, B:1800.0,
   vp:[[0,0.35],[20,1.3],[50,8.5],[80,35],[100,80]]},

  {id:'deg',         name:'Diethylene Glycol (DEG)',    cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1118, Tref:20, k_rho:-0.60,
   viscModel:'andrade', A:-2.60, B:2300.0, vapFixed:0.0003},

  {id:'teg',         name:'Triethylene Glycol (TEG)',   cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1126, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:-2.00, B:2600.0, vapFixed:0.00001},

  {id:'mea30',       name:'MEA 30% (Monoethanolamine)', cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1013, Tref:25, k_rho:-0.50,
   viscModel:'andrade', A:-3.60, B:1400.0, vapFixed:0.010},

  {id:'dea35',       name:'DEA 35% (Diethanolamine)',   cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1038, Tref:25, k_rho:-0.52,
   viscModel:'andrade', A:-2.80, B:1700.0, vapFixed:0.006},

  // ── PETROLEUM & FUELS ─────────────────────────────────────────────────────
  {id:'gasoline',    name:'Gasoline (Petrol)',           cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:740, Tref:20, k_rho:-0.90,
   viscModel:'andrade', A:-4.80, B:900.0,
   Pv_A:6.80, Pv_B:1064.0, Pv_C:228.0,
   vp:[[0,10],[10,16],[20,25],[30,38.5],[40,57],[50,82],[60,115]]},

  {id:'diesel',      name:'Diesel Fuel',                 cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:840, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:-3.20, B:1600.0,
   vp:[[20,0.01],[40,0.03],[60,0.07],[80,0.15],[100,0.3]]},

  {id:'kerosene',    name:'Kerosene / Jet-A',            cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:800, Tref:20, k_rho:-0.68,
   viscModel:'andrade', A:-3.90, B:1500.0, vapFixed:0.003},

  {id:'jeta1',       name:'Jet A-1 Fuel',                cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:804, Tref:15, k_rho:-0.72,
   viscModel:'andrade', A:-3.85, B:1480.0, vapFixed:0.003},

  {id:'hfo',         name:'Heavy Fuel Oil (HFO 380)',    cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:975, Tref:15, k_rho:-0.60,
   viscModel:'andrade', A:3.00, B:4200.0, vapFixed:0.001},

  {id:'crude20',     name:'Crude Oil API 20 (heavy)',    cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:934, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:1.00, B:3200.0,
   vp:[[20,0.05],[40,0.16],[80,1.0]]},

  {id:'crude30',     name:'Crude Oil API 30',            cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:876, Tref:20, k_rho:-0.70,
   viscModel:'andrade', A:-1.80, B:2200.0, vapFixed:0.020},

  {id:'crude40',     name:'Crude Oil API 40',            cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:825, Tref:20, k_rho:-0.72,
   viscModel:'andrade', A:-3.00, B:1700.0, vapFixed:0.040},

  {id:'crude50',     name:'Crude Oil API 50 (light)',    cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:780, Tref:20, k_rho:-0.75,
   viscModel:'andrade', A:-4.00, B:1400.0,
   vp:[[20,0.02],[40,0.08],[80,0.6]]},

  {id:'naphtha',     name:'Naphtha (light)',              cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:690, Tref:20, k_rho:-0.85,
   viscModel:'andrade', A:-4.90, B:880.0,
   Pv_A:6.90, Pv_B:1100.0, Pv_C:225.0},

  {id:'naphtha_h',   name:'Naphtha (heavy)',              cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:730, Tref:20, k_rho:-0.80,
   viscModel:'andrade', A:-4.50, B:1000.0, vapFixed:0.030},

  {id:'atmresid',    name:'Atmospheric Residue (ATB)',    cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:960, Tref:60, k_rho:-0.62,
   viscModel:'andrade', A:5.00, B:4800.0, vapFixed:0.001},

  {id:'vacresid',    name:'Vacuum Residue (VTB)',         cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:985, Tref:80, k_rho:-0.60,
   viscModel:'andrade', A:7.50, B:5200.0, vapFixed:0.0001},

  {id:'bitumen',     name:'Bitumen / Asphalt',            cat:'Petroleum & Fuels',   isGas:false,
   rhoModel:'linear', rho0:1030, Tref:150, k_rho:-0.55,
   viscModel:'andrade', A:8.00, B:5500.0, vapFixed:0.0001},

  // ── LUBRICANTS & HYDRAULIC OILS ───────────────────────────────────────────
  {id:'lube32',      name:'Lube Oil ISO VG 32',          cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:858, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:0.20, B:2700.0, vapFixed:0.001},

  {id:'lube46',      name:'Lube Oil ISO VG 46',          cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:870, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:1.20, B:3100.0, vapFixed:0.001},

  {id:'lube68',      name:'Lube Oil ISO VG 68',          cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:872, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:1.60, B:3300.0, vapFixed:0.001},

  {id:'lube100',     name:'Lube Oil ISO VG 100',         cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:874, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:2.00, B:3600.0, vapFixed:0.001},

  {id:'lube150',     name:'Lube Oil ISO VG 150',         cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:875, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:2.40, B:3800.0, vapFixed:0.001},

  {id:'lube220',     name:'Lube Oil ISO VG 220',         cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:880, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:2.90, B:4000.0, vapFixed:0.001},

  {id:'hydr32',      name:'Hydraulic Oil ISO 32',        cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:860, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:0.50, B:2800.0, vapFixed:0.001},

  {id:'hydr46',      name:'Hydraulic Oil ISO 46',        cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:870, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:0.90, B:3000.0, vapFixed:0.001},

  {id:'hydr68',      name:'Hydraulic Oil ISO 68',        cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:875, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:1.40, B:3200.0, vapFixed:0.001},

  {id:'hydr100',     name:'Hydraulic Oil ISO 100',       cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:880, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:2.00, B:3500.0, vapFixed:0.001},

  {id:'thermoil',    name:'Thermal / Heat Transfer Oil', cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:855, Tref:100, k_rho:-0.65,
   viscModel:'andrade', A:-0.50, B:2500.0, vapFixed:0.001},

  {id:'turbineoil',  name:'Turbine Oil ISO VG 46',       cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:869, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:0.85, B:2950.0, vapFixed:0.001},

  {id:'gearoil320',  name:'Gear Oil ISO VG 320',         cat:'Lubricants & Hydraulic', isGas:false,
   rhoModel:'linear', rho0:890, Tref:40, k_rho:-0.65,
   viscModel:'andrade', A:3.80, B:4400.0, vapFixed:0.001},

  // ── ALCOHOLS ──────────────────────────────────────────────────────────────
  {id:'methanol',    name:'Methanol',                    cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:792, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-5.50, B:1020.0,
   Pv_A:7.8974, Pv_B:1474.08, Pv_C:229.13,
   vp:[[0,4.06],[10,6.97],[20,12.9],[30,21.9],[40,35.4],[64.7,101.3]]},

  {id:'ethanol',     name:'Ethanol (96%)',               cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:789, Tref:20, k_rho:-1.05,
   viscModel:'andrade', A:-4.80, B:1310.0,
   Pv_A:8.1122, Pv_B:1592.864, Pv_C:226.184,
   vp:[[0,1.63],[10,3.12],[20,5.95],[30,10.5],[40,17.7],[50,29.4],[60,47.1],[78.3,101.3]]},

  {id:'ethanol_abs', name:'Ethanol Absolute (99.9%)',    cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:785, Tref:20, k_rho:-1.06,
   viscModel:'andrade', A:-4.90, B:1320.0,
   Pv_A:8.1122, Pv_B:1592.864, Pv_C:226.184},

  {id:'ipa',         name:'Isopropanol (IPA)',           cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:786, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-3.80, B:1600.0,
   Pv_A:8.1178, Pv_B:1580.92, Pv_C:219.61,
   vp:[[0,1.33],[20,4.38],[40,13.2],[82.3,101.3]]},

  {id:'nbutanol',    name:'n-Butanol',                   cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:810, Tref:20, k_rho:-0.82,
   viscModel:'andrade', A:-3.20, B:1850.0,
   Pv_A:7.8366, Pv_B:1558.19, Pv_C:196.88,
   vp:[[0,0.58],[20,0.59],[40,4.35],[50,6.9],[80,22.4],[117.7,101.3]]},

  {id:'glycerol',    name:'Glycerol (100%)',             cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:1261, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:4.50, B:5400.0,
   vp:[[20,0.0002],[60,0.004],[100,0.05],[150,0.55]]},

  {id:'glycerol50',  name:'Glycerol 50% in Water',      cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:1126, Tref:20, k_rho:-0.55,
   viscModel:'andrade', A:-0.50, B:2200.0,
   vp:[[20,0.1],[40,0.35],[80,3.5],[100,10]]},

  // ── AROMATICS ─────────────────────────────────────────────────────────────
  {id:'benzene',     name:'Benzene',                     cat:'Aromatics',           isGas:false,
   rhoModel:'linear', rho0:879, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-4.60, B:1100.0,
   Pv_A:6.90565, Pv_B:1211.033, Pv_C:220.790,
   vp:[[0,3.52],[20,10.0],[40,24.4],[60,52.0],[80.1,101.3]]},

  {id:'toluene',     name:'Toluene',                     cat:'Aromatics',           isGas:false,
   rhoModel:'linear', rho0:867, Tref:20, k_rho:-0.92,
   viscModel:'andrade', A:-5.00, B:1200.0,
   Pv_A:6.95464, Pv_B:1344.800, Pv_C:219.482,
   vp:[[0,1.57],[20,3.79],[40,9.87],[60,23.4],[110.6,101.3]]},

  {id:'xylene',      name:'Xylene (mixed)',               cat:'Aromatics',           isGas:false,
   rhoModel:'linear', rho0:864, Tref:20, k_rho:-0.88,
   viscModel:'andrade', A:-4.50, B:1350.0,
   Pv_A:6.99052, Pv_B:1453.430, Pv_C:215.307},

  {id:'oxylene',     name:'o-Xylene',                    cat:'Aromatics',           isGas:false,
   rhoModel:'linear', rho0:880, Tref:20, k_rho:-0.90,
   viscModel:'andrade', A:-4.30, B:1370.0,
   Pv_A:6.99891, Pv_B:1474.679, Pv_C:213.686},

  {id:'styrene',     name:'Styrene',                     cat:'Aromatics',           isGas:false,
   rhoModel:'linear', rho0:906, Tref:20, k_rho:-0.90,
   viscModel:'andrade', A:-4.40, B:1350.0,
   Pv_A:7.14016, Pv_B:1574.51, Pv_C:218.38,
   vp:[[0,0.3],[20,0.81],[60,5.05],[100,23.1],[145,101.3]]},

  {id:'cumene',      name:'Cumene (Isopropylbenzene)',    cat:'Aromatics',           isGas:false,
   rhoModel:'linear', rho0:862, Tref:20, k_rho:-0.88,
   viscModel:'andrade', A:-4.60, B:1380.0,
   vp:[[0,0.35],[20,0.8],[40,2.2],[80,10.6],[152.4,101.3]]},

  // ── ALIPHATICS ────────────────────────────────────────────────────────────
  {id:'hexane',      name:'n-Hexane',                    cat:'Aliphatics',          isGas:false,
   rhoModel:'linear', rho0:659, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-5.40, B:900.0,
   Pv_A:6.87601, Pv_B:1171.17, Pv_C:224.408},

  {id:'heptane',     name:'n-Heptane',                   cat:'Aliphatics',          isGas:false,
   rhoModel:'linear', rho0:684, Tref:20, k_rho:-0.95,
   viscModel:'andrade', A:-5.10, B:1060.0,
   Pv_A:6.89385, Pv_B:1264.13, Pv_C:216.640},

  {id:'octane',      name:'n-Octane',                    cat:'Aliphatics',          isGas:false,
   rhoModel:'linear', rho0:703, Tref:20, k_rho:-0.90,
   viscModel:'andrade', A:-4.80, B:1140.0,
   Pv_A:6.91868, Pv_B:1351.99, Pv_C:209.155,
   vp:[[0,1.4],[20,1.47],[40,6.1],[60,11.5],[80,20.2],[125.7,101.3]]},

  {id:'cyclohex',    name:'Cyclohexane',                 cat:'Aliphatics',          isGas:false,
   rhoModel:'linear', rho0:779, Tref:20, k_rho:-0.97,
   viscModel:'andrade', A:-4.90, B:1100.0,
   Pv_A:6.84498, Pv_B:1203.526, Pv_C:222.863},

  {id:'isooctane',   name:'Isooctane (2,2,4-TMP)',       cat:'Aliphatics',          isGas:false,
   rhoModel:'linear', rho0:692, Tref:20, k_rho:-0.92,
   viscModel:'andrade', A:-5.20, B:1000.0, vapFixed:0.050},

  // ── CHLORINATED SOLVENTS ──────────────────────────────────────────────────
  {id:'dcm',         name:'Dichloromethane (DCM)',        cat:'Chlorinated Solvents', isGas:false,
   rhoModel:'linear', rho0:1325, Tref:20, k_rho:-1.80,
   viscModel:'andrade', A:-5.50, B:900.0,
   Pv_A:7.0820, Pv_B:1138.91, Pv_C:231.50,
   vp:[[0,16.7],[20,46.5],[40,110],[39.6,101.3]]},

  {id:'chloroform',  name:'Chloroform (CHCl₃)',          cat:'Chlorinated Solvents', isGas:false,
   rhoModel:'linear', rho0:1489, Tref:20, k_rho:-1.85,
   viscModel:'andrade', A:-5.20, B:1000.0,
   Pv_A:6.9360, Pv_B:1170.966, Pv_C:226.232},

  {id:'cctc',        name:'Carbon Tetrachloride (CCl₄)', cat:'Chlorinated Solvents', isGas:false,
   rhoModel:'linear', rho0:1594, Tref:20, k_rho:-1.90,
   viscModel:'andrade', A:-5.10, B:1050.0,
   Pv_A:6.93390, Pv_B:1242.43, Pv_C:230.0},

  {id:'tce',         name:'Trichloroethylene',            cat:'Chlorinated Solvents', isGas:false,
   rhoModel:'linear', rho0:1462, Tref:20, k_rho:-1.60,
   viscModel:'andrade', A:-4.80, B:1200.0,
   Pv_A:6.9730, Pv_B:1315.0, Pv_C:217.0,
   vp:[[0,3.36],[20,9.08],[40,21.6],[87.2,101.3]]},

  {id:'pce',         name:'Perchloroethylene (PCE)',      cat:'Chlorinated Solvents', isGas:false,
   rhoModel:'linear', rho0:1623, Tref:20, k_rho:-1.70,
   viscModel:'andrade', A:-4.60, B:1280.0,
   vp:[[0,1.87],[20,1.93],[40,10.9],[60,24.8],[121.3,101.3]]},

  // ── KETONES & ESTERS ──────────────────────────────────────────────────────
  {id:'acetone',     name:'Acetone',                      cat:'Ketones & Esters',    isGas:false,
   rhoModel:'linear', rho0:791, Tref:20, k_rho:-1.10,
   viscModel:'andrade', A:-5.80, B:900.0,
   Pv_A:7.11714, Pv_B:1210.595, Pv_C:229.664,
   vp:[[0,9.9],[20,24.5],[40,53.7],[56,101.3]]},

  {id:'mek',         name:'MEK (Methyl Ethyl Ketone)',    cat:'Ketones & Esters',    isGas:false,
   rhoModel:'linear', rho0:805, Tref:20, k_rho:-1.05,
   viscModel:'andrade', A:-5.40, B:1100.0,
   Pv_A:7.0652, Pv_B:1261.34, Pv_C:221.97,
   vp:[[0,3.5],[20,10.1],[40,25.0],[60,55],[79.6,101.3]]},

  {id:'mibk',        name:'MIBK (Methyl Isobutyl Ketone)',cat:'Ketones & Esters',   isGas:false,
   rhoModel:'linear', rho0:801, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-5.00, B:1150.0,
   vp:[[0,1.0],[20,3.0],[40,8.0],[60,18.9],[115.9,101.3]]},

  {id:'cyclohexanone',name:'Cyclohexanone',               cat:'Ketones & Esters',   isGas:false,
   rhoModel:'linear', rho0:948, Tref:20, k_rho:-0.90,
   viscModel:'andrade', A:-4.20, B:1500.0,
   vp:[[0,0.4],[20,0.53],[40,2.27],[60,8.09],[80,22.8],[155.6,101.3]]},

  {id:'ethacet',     name:'Ethyl Acetate',                cat:'Ketones & Esters',    isGas:false,
   rhoModel:'linear', rho0:900, Tref:20, k_rho:-1.10,
   viscModel:'andrade', A:-5.20, B:1090.0,
   Pv_A:7.0145, Pv_B:1244.95, Pv_C:217.88},

  {id:'butacet',     name:'Butyl Acetate',                cat:'Ketones & Esters',    isGas:false,
   rhoModel:'linear', rho0:882, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-4.80, B:1250.0, vapFixed:0.015},

  // ── ACIDS & BASES ─────────────────────────────────────────────────────────
  {id:'h2so4_98',    name:'Sulfuric Acid 98%',           cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1840, Tref:25, k_rho:-0.70,
   viscModel:'andrade', A:2.20, B:3700.0,
   vp:[[20,3e-05],[100,0.01],[200,0.5]]},

  {id:'h2so4_50',    name:'Sulfuric Acid 50%',           cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1395, Tref:25, k_rho:-0.80,
   viscModel:'andrade', A:-2.00, B:1800.0, vapFixed:0.020},

  {id:'h2so4_10',    name:'Sulfuric Acid 10%',           cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1066, Tref:25, k_rho:-0.45,
   viscModel:'andrade', A:-3.60, B:1100.0,
   vp:[[20,2.3],[50,10.0],[80,38],[100,90]]},

  {id:'hcl30',       name:'Hydrochloric Acid 30%',       cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1149, Tref:20, k_rho:-0.45,
   viscModel:'andrade', A:-4.00, B:1050.0, vapFixed:0.060},

  {id:'hcl10',       name:'Hydrochloric Acid 10%',       cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1047, Tref:20, k_rho:-0.40,
   viscModel:'andrade', A:-3.80, B:1000.0,
   vp:[[10,25],[20,42],[30,65],[50,120]]},

  {id:'hno3_65',     name:'Nitric Acid 65%',             cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1391, Tref:20, k_rho:-0.90,
   viscModel:'andrade', A:-4.80, B:1000.0, vapFixed:0.040},

  {id:'hno3_30',     name:'Nitric Acid 30%',             cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1180, Tref:20, k_rho:-0.70,
   viscModel:'andrade', A:-4.20, B:1050.0,
   vp:[[0,1.2],[20,3.0],[50,11.0],[80,35]]},

  {id:'h3po4_85',    name:'Phosphoric Acid 85%',         cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1685, Tref:25, k_rho:-0.95,
   viscModel:'andrade', A:0.50, B:3200.0,
   vp:[[20,0.01],[60,0.04],[100,0.15],[150,1.0]]},

  {id:'naoh30',      name:'NaOH (Caustic) 30%',          cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1328, Tref:20, k_rho:-0.45,
   viscModel:'andrade', A:-3.00, B:1400.0, vapFixed:0.020},

  {id:'naoh50',      name:'NaOH (Caustic) 50%',          cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1525, Tref:20, k_rho:-0.55,
   viscModel:'andrade', A:-1.20, B:2000.0,
   vp:[[20,0.5],[50,4.0],[80,25],[100,70]]},

  {id:'koh30',       name:'KOH Solution 30%',            cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1290, Tref:20, k_rho:-0.50,
   viscModel:'andrade', A:-3.00, B:1500.0,
   vp:[[20,1.5],[50,8.0],[80,35],[100,85]]},

  {id:'aceticac',    name:'Acetic Acid (glacial)',        cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1049, Tref:20, k_rho:-1.05,
   viscModel:'andrade', A:-4.20, B:1400.0,
   Pv_A:7.38782, Pv_B:1533.313, Pv_C:222.309},

  {id:'aceticac_50', name:'Acetic Acid 50%',             cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1062, Tref:20, k_rho:-0.85,
   viscModel:'andrade', A:-3.80, B:1350.0, vapFixed:0.040},

  {id:'formicac',    name:'Formic Acid 85%',             cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1193, Tref:20, k_rho:-0.95,
   viscModel:'andrade', A:-3.60, B:1450.0, vapFixed:0.040},

  {id:'ammonia_aq',  name:'Ammonia Solution 25%',        cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:910, Tref:20, k_rho:-0.85,
   viscModel:'andrade', A:-4.50, B:900.0,
   vp:[[0,0.55],[20,2.0],[40,6.5],[80,35],[100,90]]},

  // ── LIQUEFIED GASES ────────────────────────────────────────────────────────
  {id:'lpg',         name:'LPG (Propane/Butane mix)',    cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:530, Tref:20, k_rho:-1.80,
   viscModel:'andrade', A:-7.00, B:700.0, vapFixed:8.0},

  {id:'propane_liq', name:'Liquid Propane',              cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:493, Tref:20, k_rho:-1.90,
   viscModel:'andrade', A:-7.20, B:650.0, vapFixed:8.4},

  {id:'butane_liq',  name:'Liquid Butane',               cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:580, Tref:20, k_rho:-1.70,
   viscModel:'andrade', A:-6.50, B:700.0, vapFixed:2.1},

  {id:'ammonia_liq', name:'Liquid Ammonia',              cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:610, Tref:20, k_rho:-2.00,
   viscModel:'andrade', A:-4.729, B:800.0,
   vp:[[-50,40.8],[-40,71.7],[-33.35,101.3],[-20,190.1],[0,429.6],[20,857.2],[35,1351],[50,2032],[75,3588],[100,6253]]},
  // ── AMMONIA (dual-phase: auto liquid/gas based on T & P) ─────────────────
  {id:'ammonia',     name:'Ammonia (NH₃) — auto phase',   cat:'Dual-Phase (auto L/G)', isGas:'auto',
   // Antoine: log10(Pv/mmHg) = A - B/(C + T°C), valid -83 to 133°C
   Pv_A:7.596673, Pv_B:1028.083, Pv_C:251.369,
   Tc:132.25, Pc:112.8,
   // Liquid phase
   liq_rhoModel:'linear', liq_rho0:682.0, liq_Tref:-33.35, liq_k_rho:-1.88,
   liq_viscModel:'andrade', liq_A:-6.743, liq_B:632.0,
   // Gas phase
   gas_rhoModel:'ideal_gas', gas_MW:17.03,
   gas_viscModel:'sutherland', gas_mu_ref:0.01010e-3, gas_T_ref:293.15, gas_C_su:370.0,
   vp:[[-50,40.8],[-40,71.7],[-33.35,101.3],[-20,190.1],[0,429.6],[20,857.2],[35,1351],[50,2032],[75,3588],[100,6253]]},



  {id:'co2_liq',     name:'Liquid CO₂ (subcritical)',    cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:773, Tref:20, k_rho:-3.50,
   viscModel:'andrade', A:-7.50, B:600.0, vapFixed:57.3},

  {id:'r134a',       name:'Refrigerant R-134a',          cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:1206, Tref:20, k_rho:-3.50,
   viscModel:'andrade', A:-6.00, B:800.0,
   vp:[[-26.4,101.3],[0,293],[20,572],[40,1017],[60,1682]]},

  {id:'r22',         name:'Refrigerant R-22',            cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:1194, Tref:20, k_rho:-3.40,
   viscModel:'andrade', A:-6.20, B:750.0,
   vp:[[-40.8,101.3],[-20,245],[0,499],[20,909],[40,1535]]},

  {id:'r410a',       name:'Refrigerant R-410A',          cat:'Liquefied Gases',     isGas:false,
   rhoModel:'linear', rho0:1062, Tref:20, k_rho:-3.80,
   viscModel:'andrade', A:-6.50, B:720.0,
   vp:[[-51.4,101.3],[-20,400],[0,799],[20,1358],[40,2143]]},

  // ── GASES (ideal gas law for ρ, Sutherland for μ) ─────────────────────────
  {id:'air',         name:'Air',                          cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:28.97,
   viscModel:'sutherland', mu_ref:0.01827e-3, T_ref:291.15, C_su:120.0},

  {id:'nitrogen',    name:'Nitrogen (N₂)',                cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:28.01,
   viscModel:'sutherland', mu_ref:0.01781e-3, T_ref:300.55, C_su:111.0},

  {id:'oxygen',      name:'Oxygen (O₂)',                  cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:32.00,
   viscModel:'sutherland', mu_ref:0.02018e-3, T_ref:292.25, C_su:127.0},

  {id:'hydrogen',    name:'Hydrogen (H₂)',                cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:2.016,
   viscModel:'sutherland', mu_ref:0.00876e-3, T_ref:293.85, C_su:72.0},

  {id:'helium',      name:'Helium (He)',                  cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:4.003,
   viscModel:'sutherland', mu_ref:0.01960e-3, T_ref:273.15, C_su:79.4},

  {id:'argon',       name:'Argon (Ar)',                   cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:39.95,
   viscModel:'sutherland', mu_ref:0.02228e-3, T_ref:273.15, C_su:144.4},

  {id:'co2gas',      name:'CO₂ Gas',                      cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:44.01,
   viscModel:'sutherland', mu_ref:0.01480e-3, T_ref:293.15, C_su:240.0},

  {id:'cogas',       name:'CO Gas (Carbon Monoxide)',     cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:28.01,
   viscModel:'sutherland', mu_ref:0.01661e-3, T_ref:273.15, C_su:118.0},

  {id:'methane',     name:'Methane (CH₄)',                cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:16.04,
   viscModel:'sutherland', mu_ref:0.01100e-3, T_ref:293.15, C_su:198.0},

  {id:'ethane',      name:'Ethane (C₂H₆)',               cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:30.07,
   viscModel:'sutherland', mu_ref:0.00900e-3, T_ref:293.15, C_su:252.0},

  {id:'propgas',     name:'Propane Gas (C₃H₈)',          cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:44.10,
   viscModel:'sutherland', mu_ref:0.00820e-3, T_ref:293.15, C_su:330.0},

  {id:'natgas',      name:'Natural Gas (SG 0.65)',        cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:18.83,
   viscModel:'sutherland', mu_ref:0.01100e-3, T_ref:293.15, C_su:180.0},

  {id:'natgas_h',    name:'Natural Gas (SG 0.75, rich)',  cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:21.73,
   viscModel:'sutherland', mu_ref:0.01050e-3, T_ref:293.15, C_su:185.0},

  {id:'h2s',         name:'Hydrogen Sulfide (H₂S)',       cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:34.08,
   viscModel:'sutherland', mu_ref:0.01180e-3, T_ref:293.15, C_su:331.0},

  {id:'so2',         name:'Sulfur Dioxide (SO₂)',         cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:64.06,
   viscModel:'sutherland', mu_ref:0.01257e-3, T_ref:293.15, C_su:416.0},

  {id:'chlorinegas', name:'Chlorine Gas (Cl₂)',           cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:70.90,
   viscModel:'sutherland', mu_ref:0.01330e-3, T_ref:293.15, C_su:351.0},

  {id:'steam_gas',   name:'Steam (superheated)',           cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:18.015,
   viscModel:'sutherland', mu_ref:0.01200e-3, T_ref:373.15, C_su:1064.0},

  {id:'ammgas',      name:'Ammonia Gas (NH₃)',            cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:17.03,
   viscModel:'sutherland', mu_ref:0.01010e-3, T_ref:293.15, C_su:370.0},

  {id:'fluegas',     name:'Flue Gas (typical)',           cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:29.0,
   viscModel:'sutherland', mu_ref:0.01900e-3, T_ref:473.15, C_su:110.0},

  {id:'biogas',      name:'Biogas (60% CH₄, 40% CO₂)',   cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:27.22,
   viscModel:'sutherland', mu_ref:0.01250e-3, T_ref:293.15, C_su:200.0},

  {id:'syngas',      name:'Syngas (H₂+CO mixture)',       cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:15.50,
   viscModel:'sutherland', mu_ref:0.01300e-3, T_ref:293.15, C_su:150.0},

  {id:'hclgas',      name:'HCl Gas',                      cat:'Gases (⚠ Compressible)', isGas:true,
   rhoModel:'ideal_gas', MW:36.46,
   viscModel:'sutherland', mu_ref:0.01426e-3, T_ref:273.15, C_su:360.0},

  // ── CHEMICAL PROCESS ──────────────────────────────────────────────────────
  {id:'dmf',         name:'DMF (Dimethylformamide)',       cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:944, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-4.50, B:1200.0, vapFixed:0.004},

  {id:'dmso',        name:'DMSO (Dimethyl Sulfoxide)',     cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:1101, Tref:20, k_rho:-0.95,
   viscModel:'andrade', A:-3.50, B:1700.0, vapFixed:0.001},

  {id:'thf',         name:'THF (Tetrahydrofuran)',          cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:889, Tref:20, k_rho:-1.10,
   viscModel:'andrade', A:-5.20, B:1000.0,
   Pv_A:6.9953, Pv_B:1202.29, Pv_C:226.25},

  {id:'nmp',         name:'N-Methylpyrrolidone (NMP)',     cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:1028, Tref:20, k_rho:-0.96,
   viscModel:'andrade', A:-3.40, B:1700.0,
   vp:[[20,0.04],[50,0.37],[80,2.4],[100,5.8],[202,101.3]]},

  {id:'acetonitrile',name:'Acetonitrile (MeCN)',           cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:786, Tref:20, k_rho:-1.10,
   viscModel:'andrade', A:-5.60, B:950.0,
   Pv_A:7.1190, Pv_B:1314.4, Pv_C:230.0},

  {id:'diethether',  name:'Diethyl Ether',                 cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:713, Tref:20, k_rho:-1.20,
   viscModel:'andrade', A:-5.90, B:850.0,
   Pv_A:6.9267, Pv_B:1064.07, Pv_C:228.799},

  {id:'dioxane',     name:'1,4-Dioxane',                   cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:1034, Tref:20, k_rho:-1.00,
   viscModel:'andrade', A:-4.80, B:1250.0, vapFixed:0.038},

  {id:'furfural',    name:'Furfural',                      cat:'Chemical Process',    isGas:false,
   rhoModel:'linear', rho0:1160, Tref:20, k_rho:-0.95,
   viscModel:'andrade', A:-3.60, B:1600.0, vapFixed:0.003},

  // ── FOOD & PHARMA ──────────────────────────────────────────────────────────
  {id:'milk',        name:'Milk (whole)',                  cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:1030, Tref:20, k_rho:-0.35,
   viscModel:'andrade', A:-3.80, B:1100.0, vapFixed:0.023},

  {id:'milk_skim',   name:'Skim Milk',                     cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:1034, Tref:20, k_rho:-0.33,
   viscModel:'andrade', A:-4.00, B:1050.0, vapFixed:0.023},

  {id:'olive',       name:'Olive Oil',                     cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:910, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:1.00, B:3200.0, vapFixed:0.001},

  {id:'sunflower',   name:'Sunflower Oil',                 cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:919, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:0.90, B:3000.0,
   vp:[[40,0.001],[80,0.01],[100,0.03]]},

  {id:'palmoil',     name:'Palm Oil',                      cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:891, Tref:50, k_rho:-0.67,
   viscModel:'andrade', A:1.20, B:3400.0, vapFixed:0.001},

  {id:'cornsyrup',   name:'Corn Syrup 63° Brix',          cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:1303, Tref:20, k_rho:-0.55,
   viscModel:'andrade', A:3.20, B:3500.0, vapFixed:0.010},

  {id:'honey',       name:'Honey',                         cat:'Food & Pharma',       isGas:false,
   rhoModel:'linear', rho0:1420, Tref:20, k_rho:-0.50,
   viscModel:'andrade', A:5.00, B:4800.0, vapFixed:0.005},

  // ── SPECIAL & METALS ──────────────────────────────────────────────────────
  {id:'mercury',     name:'Mercury (liquid)',              cat:'Special & Metals',    isGas:false,
   rhoModel:'linear', rho0:13534, Tref:20, k_rho:-2.45,
   viscModel:'andrade', A:-3.50, B:800.0,
   vp:[[20,0.000227],[100,0.016],[200,0.279],[356.7,101.3]]},

  {id:'molten_s',    name:'Molten Sulfur',                 cat:'Special & Metals',    isGas:false,
   rhoModel:'linear', rho0:1800, Tref:130, k_rho:-0.95,
   viscModel:'andrade', A:-3.80, B:1500.0, vapFixed:0.001},

  {id:'slurry10',    name:'Slurry (10% solids)',           cat:'Special & Metals',    isGas:false,
   rhoModel:'linear', rho0:1100, Tref:20, k_rho:-0.35,
   viscModel:'linear', mu0:5.0, Tref_mu:20, k_mu:-0.05, vapFixed:0.020},

  {id:'slurry30',    name:'Slurry (30% solids)',           cat:'Special & Metals',    isGas:false,
   rhoModel:'linear', rho0:1350, Tref:20, k_rho:-0.40,
   viscModel:'linear', mu0:20.0, Tref_mu:20, k_mu:-0.15, vapFixed:0.015},

  {id:'slurry50',    name:'Slurry (50% solids, dense)',    cat:'Special & Metals',    isGas:false,
   rhoModel:'linear', rho0:1650, Tref:20, k_rho:-0.45,
   viscModel:'linear', mu0:80.0, Tref_mu:20, k_mu:-0.40, vapFixed:0.010},

  {id:'drilling_mud',name:'Drilling Mud (12 ppg)',         cat:'Special & Metals',    isGas:false,
   rhoModel:'linear', rho0:1440, Tref:25, k_rho:-0.50,
   viscModel:'linear', mu0:30.0, Tref_mu:25, k_mu:-0.20, vapFixed:0.015},

  // ── PROPANE (dual-phase) ──────────────────────────────────────────────────
  {id:'propane',     name:'Propane (C₃H₈) — auto phase',  cat:'Dual-Phase (auto L/G)', isGas:'auto',
   Pv_A:6.82973, Pv_B:803.810, Pv_C:246.990,
   Tc:96.68, Pc:42.48,
   liq_rhoModel:'linear', liq_rho0:493.0, liq_Tref:-42.1, liq_k_rho:-1.90,
   liq_viscModel:'andrade', liq_A:-7.20, liq_B:650.0,
   gas_rhoModel:'ideal_gas', gas_MW:44.10,
   gas_viscModel:'sutherland', gas_mu_ref:0.00820e-3, gas_T_ref:293.15, gas_C_su:330.0,
   vp:[[-42.1,101.3],[-30,161],[-20,245],[0,474],[20,879],[40,1530],[50,1771],[96.68,4248]]},

  // ── CO₂ (dual-phase) ─────────────────────────────────────────────────────
  {id:'co2',         name:'CO₂ — auto phase',              cat:'Dual-Phase (auto L/G)', isGas:'auto',
   Pv_form:'cc_ln', Pv_A:10.79, Pv_B:-1977,
   Tc:31.04, Pc:73.77,
   liq_rhoModel:'linear', liq_rho0:773.0, liq_Tref:20.0, liq_k_rho:-3.50,
   liq_viscModel:'andrade', liq_A:-7.50, liq_B:600.0,
   gas_rhoModel:'ideal_gas', gas_MW:44.01,
   gas_viscModel:'sutherland', gas_mu_ref:0.01480e-3, gas_T_ref:293.15, gas_C_su:240.0,
   vp:[[-56.6,517],[-40,1013],[-20,1969],[0,3484],[20,5729],[30,7176]]},

  // ── WATER / STEAM (dual-phase) ────────────────────────────────────────────
  {id:'water_steam', name:'Water/Steam — auto phase',       cat:'Dual-Phase (auto L/G)', isGas:'auto',
   Pv_A:8.07131, Pv_B:1730.63, Pv_C:233.426,
   Tc:373.95, Pc:220.64,
   liq_rhoModel:'poly_water', 
   liq_viscModel:'andrade', liq_A:-3.5985, liq_B:1061.0,
   gas_rhoModel:'ideal_gas', gas_MW:18.015,
   gas_viscModel:'sutherland', gas_mu_ref:0.01200e-3, gas_T_ref:373.15, gas_C_su:1064.0,
   vp:[[0,0.611],[20,2.338],[40,7.384],[60,19.94],[80,47.39],[100,101.3],[120,198.5],[150,476.2],[200,1554],[250,3975],[300,8592],[373.95,22064]]},

];

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY CALCULATION ENGINE

/* ═══════════════════════════════════════════════════════════════
   FITTING CATALOGUE
═══════════════════════════════════════════════════════════════ */
const FITTING_CATALOGUE = {
  elbow90:{label:'90° Elbow — Standard',k:0.9},elbow90lr:{label:'90° Elbow — Long Radius',k:0.6},
  elbow45:{label:'45° Elbow — Standard',k:0.4},elbow45lr:{label:'45° Elbow — Long Radius',k:0.2},
  elbow180:{label:'180° Return Bend',k:1.5},teerun:{label:'Tee — Through Run',k:0.6},
  teebranch:{label:'Tee — Branch Flow',k:1.8},teecombine:{label:'Tee — Combining',k:1.3},
  reducer:{label:'Sudden Contraction',k:0.5},expander:{label:'Sudden Expansion',k:1.0},
  gradred:{label:'Gradual Reducer',k:0.1},entrance:{label:'Pipe Entrance — Sharp',k:0.5},
  exit:{label:'Pipe Exit',k:1.0},gate_open:{label:'Gate Valve — Fully Open',k:0.2},
  gate_75:{label:'Gate Valve — 75% Open',k:1.1},gate_50:{label:'Gate Valve — 50% Open',k:5.6},
  globe_open:{label:'Globe Valve — Fully Open',k:10},globe_50:{label:'Globe Valve — 50% Open',k:13},
  diaphragm:{label:'Diaphragm Valve',k:2.3},ball_open:{label:'Ball Valve — Fully Open',k:0.05},
  ball_75:{label:'Ball Valve — 75% Open',k:0.7},ball_50:{label:'Ball Valve — 50% Open',k:5.5},
  plug_open:{label:'Plug Valve — Open',k:0.3},needle:{label:'Needle Valve',k:3.0},
  butterfly_open:{label:'Butterfly — Fully Open',k:0.5},butterfly_75:{label:'Butterfly — 75° Open',k:0.8},
  butterfly_60:{label:'Butterfly — 60° Open',k:2.0},butterfly_45:{label:'Butterfly — 45° Open',k:10},
  check_swing:{label:'Check Valve — Swing',k:2.0},check_lift:{label:'Check Valve — Lift',k:12},
  check_ball:{label:'Check Valve — Ball',k:4.5},check_tilting:{label:'Check Valve — Tilting Disc',k:0.8},
  angle:{label:'Angle Valve',k:5.0},prv:{label:'Pressure Reducing Valve',k:8.0},
  psv:{label:'Pressure Safety Valve',k:6.0},control:{label:'Control Valve — Open',k:5.0},
  solenoid:{label:'Solenoid Valve',k:3.5},ystrainer:{label:'Y-Strainer — Clean',k:3.0},
  tstrainer:{label:'T-Strainer — Clean',k:2.0},basket:{label:'Basket Strainer — Clean',k:1.5},
  orifice:{label:'Orifice Plate',k:10},flowmeter:{label:'Flow Meter',k:4.0},
  venturi:{label:'Venturi Meter',k:0.5},custom:{label:'Custom / Other',k:1.0},
};


/* ═══════════════════════════════════════════════════════════════
   PROPERTY CALCULATION ENGINE
   calcFluidProps(id, T_C, P_bar) → {rho[kg/m³], mu[cP], Pv[bar], isGas, warn}
═══════════════════════════════════════════════════════════════ */
// calcFluidProps(id, T_C, P_bar) → {rho[kg/m³], mu[cP], Pv[bar], isGas, warn}
// ─────────────────────────────────────────────────────────────────────────────

// ── VAPOUR PRESSURE LOOKUP — log-linear interpolation (same method as NPSH calculator) ──
// vp table: [[T_C, kPa], ...] — must be sorted ascending by T
// Returns Pv in kPa. Far more accurate than Antoine for most fluids.
function vpI(f, T_C) {
  const d = f.vp;
  if (!d || !d.length) return null;  // no table → fallback to Antoine/fixed
  if (T_C <= d[0][0])             return d[0][1];
  if (T_C >= d[d.length-1][0])   return d[d.length-1][1];
  for (let i = 0; i < d.length-1; i++) {
    if (T_C >= d[i][0] && T_C < d[i+1][0]) {
      const r  = (T_C - d[i][0]) / (d[i+1][0] - d[i][0]);
      const l1 = Math.log(Math.max(d[i][1],   1e-10));
      const l2 = Math.log(Math.max(d[i+1][1], 1e-10));
      return Math.exp(l1 + r*(l2 - l1));  // kPa
    }
  }
  return d[d.length-1][1];
}

function calcFluidProps(id, T_C, P_bar) {
  const f = FLUID_DB.find(x => x.id === id);
  if (!f) return null;
  const T_K = T_C + 273.15;
  let rho, mu, Pv = 0, warn = '', phaseLabel = '';

  // ── VAPOUR PRESSURE — priority: vp table > Antoine/CC > fixed ─────────────
  // Method 1: lookup table with log-linear interpolation (most accurate)
  const vpTable = vpI(f, T_C);
  if (vpTable !== null) {
    Pv = vpTable / 100;  // kPa → bar
  } else if (f.Pv_form === 'cc_ln' && f.Pv_A !== undefined) {
    // Clausius-Clapeyron ln form: ln(Pv_bar) = A + B/T_K
    Pv = Math.max(0, Math.exp(f.Pv_A + f.Pv_B / T_K));
  } else if (f.Pv_A !== undefined) {
    // Antoine: log10(Pv/mmHg) = A − B/(C + T°C)
    const denom = f.Pv_C + T_C;
    if (denom > 0) {
      const logPv = f.Pv_A - f.Pv_B / denom;
      Pv = Math.max(0, Math.pow(10, logPv) * 0.00133322); // bar
    }
  } else if (f.vapFixed !== undefined) {
    Pv = f.vapFixed;
  }

  // ── PHASE DETECTION for dual-phase fluids (isGas === 'auto') ──────────────
  // Rule: if T > Tc OR P < Pv(T) → GAS phase; else → LIQUID phase
  // Also handle supercritical: T > Tc AND P > Pc → supercritical (treat as gas-like)
  let effectiveIsGas = f.isGas; // default: use declared phase
  if (f.isGas === 'auto') {
    const aboveCriticalT = (f.Tc !== undefined) && (T_C > f.Tc);
    const aboveCriticalP = (f.Pc !== undefined) && (P_bar > f.Pc);
    // Supercritical region
    if (aboveCriticalT && aboveCriticalP) {
      effectiveIsGas = true;
      phaseLabel = '⬡ Supercritical';
      warn += '⚠ Supercritical conditions (T > Tc=' + f.Tc + '°C, P > Pc=' + f.Pc + ' bar). Using gas-like properties. ';
    }
    // Above critical temperature but sub-critical pressure → gas
    else if (aboveCriticalT) {
      effectiveIsGas = true;
      phaseLabel = '↑ Gas (T > Tc)';
    }
    // Below critical T: compare Pv(T) with operating P
    // If P < Pv → system pressure is below vapour pressure → GAS
    // If P >= Pv → liquid (condensed)
    else if (Pv > 0 && P_bar < Pv) {
      effectiveIsGas = true;
      phaseLabel = '↑ Gas (P < Psat=' + Pv.toFixed(3) + ' bar)';
    } else {
      effectiveIsGas = false;
      phaseLabel = '↓ Liquid (P ≥ Psat=' + Pv.toFixed(3) + ' bar)';
    }
  }

  // ── DENSITY ────────────────────────────────────────────────────────────────
  if (f.isGas === 'auto') {
    // Dual-phase fluid — use phase-specific model
    if (effectiveIsGas) {
      // Gas: ideal gas law
      rho = (P_bar * 1e5 * f.gas_MW) / (8314.0 * T_K);
    } else {
      // Liquid
      if (f.liq_rhoModel === 'poly_water') {
        rho = 999.842 + 0.0622*T_C - 0.003713*T_C*T_C + 4.0e-6*Math.pow(T_C,3);
        if (T_C < 0 || T_C > 374) warn += 'Water polynomial valid 0–374°C. ';
      } else {
        rho = f.liq_rho0 + f.liq_k_rho * (T_C - f.liq_Tref);
        if (rho < 1) { rho = 1; warn += 'ρ clamped — near or above boiling point. '; }
      }
    }
  } else if (f.rhoModel === 'poly_water') {
    rho = 999.842 + 0.0622*T_C - 0.003713*T_C*T_C + 4.0e-6*Math.pow(T_C,3);
    if (T_C < 0 || T_C > 150) warn += 'Water poly valid 0–150°C. ';
  } else if (f.rhoModel === 'ideal_gas') {
    rho = (P_bar * 1e5 * f.MW) / (8314.0 * T_K);
  } else {
    rho = f.rho0 + f.k_rho * (T_C - f.Tref);
    if (rho < 1) { rho = 1; warn += 'T may be above boiling point — ρ clamped. '; }
  }

  // ── VISCOSITY ──────────────────────────────────────────────────────────────
  if (f.isGas === 'auto') {
    if (effectiveIsGas) {
      // Sutherland
      const ratio = T_K / f.gas_T_ref;
      const mu_Pas = f.gas_mu_ref * Math.pow(ratio, 1.5) * (f.gas_T_ref + f.gas_C_su) / (T_K + f.gas_C_su);
      mu = mu_Pas * 1000;
    } else {
      // Andrade for liquid
      mu = Math.exp(f.liq_A + f.liq_B / T_K);
    }
    mu = Math.max(0.001, Math.min(mu, 1e7));
  } else if (f.viscModel === 'andrade') {
    mu = Math.exp(f.A + f.B / T_K);
    mu = Math.max(0.001, Math.min(mu, 1e7));
  } else if (f.viscModel === 'sutherland') {
    const ratio = T_K / f.T_ref;
    const mu_Pas = f.mu_ref * Math.pow(ratio, 1.5) * (f.T_ref + f.C_su) / (T_K + f.C_su);
    mu = mu_Pas * 1000;
    mu = Math.max(0.001, mu);
  } else {
    const Tref_mu = f.Tref_mu !== undefined ? f.Tref_mu : f.Tref;
    mu = f.mu0 + f.k_mu * (T_C - Tref_mu);
    mu = Math.max(0.001, mu);
  }

  // ── FLASH / BOILING WARNING (non-auto fluids) ──────────────────────────────
  if (f.isGas !== 'auto' && !f.isGas && P_bar > 0 && Pv > 0 && Pv >= P_bar)
    warn += '⚠ Vapour pressure ≥ operating pressure — fluid may flash or boil! ';

  // ── GAS compressibility reminder ───────────────────────────────────────────
  if (effectiveIsGas === true && f.isGas !== 'auto')
    warn += '';  // existing gas entries already get the alert via selectFluid()

  return {
    rho:        parseFloat(rho.toFixed(3)),
    mu:         parseFloat(mu.toFixed(4)),
    Pv:         parseFloat(Pv.toFixed(6)),
    isGas:      effectiveIsGas === true || effectiveIsGas === 'auto',
    phaseLabel: phaseLabel,
    name:       f.name, cat: f.cat, warn
  };
}

// Shim so any legacy code that reads FLUID_LIBRARY still works

/* ═══════════════════════════════════════════════════════════════
   DARCY-WEISBACH + COLEBROOK-WHITE CALCULATION ENGINE
═══════════════════════════════════════════════════════════════ */
function calcPressureDrop(inputs) {
  let { D, L, Q, rho, mu, dz, epsBase, foulingMm, fittings, pumpEff, motorEff, unitMode } = inputs;

  // Validate
  if ([D, L, Q, rho, mu].some(v => !isFinite(v) || v <= 0))
    return { ok: false, error: 'All inputs must be positive finite numbers.' };
  if (mu < 0.00001)
    return { ok: false, error: 'Viscosity too low — check units (enter in cP, e.g. water = 1.0 cP).' };

  const eps = epsBase + Math.max(0, foulingMm);  // total roughness [mm]
  dz = isFinite(dz) ? dz : 0;

  // Convert to SI
  if (unitMode === 'imperial') {
    D   *= 25.4;      // in → mm
    L   *= 0.3048;    // ft → m
    dz  *= 0.3048;    // ft → m
    Q   *= 0.227124;  // GPM → m³/h
    rho *= 16.0185;   // lb/ft³ → kg/m³
  }

  const Dm    = D / 1000;           // mm → m
  const Qs    = Q / 3600;           // m³/h → m³/s
  const mu_Pa = mu / 1000;          // cP → Pa·s
  const eps_m = eps / 1000;         // mm → m

  const A  = Math.PI * Dm * Dm / 4;
  const V  = Qs / A;
  const Re = rho * V * Dm / mu_Pa;

  if (Re < 1) return { ok: false, error: 'Reynolds number < 1 — check inputs.' };

  // Friction factor — Churchill (1977) spans ALL regimes
  let f;
  if (Re < 2300) {
    f = 64 / Re;  // Laminar: Hagen-Poiseuille exact
  } else if (Re < 4000) {
    const A_ch = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / Re, 0.9) + 0.27 * (eps_m / Dm))), 16);
    const B_ch = Math.pow(37530 / Re, 16);
    f = 8 * Math.pow(Math.pow(8 / Re, 12) + 1 / Math.pow(A_ch + B_ch, 1.5), 1 / 12);
    const fCB = Math.pow(-2 * Math.log10(eps_m / (3.7 * Dm) + 2.51 / (Re * Math.sqrt(0.02))), -2);
    f = Math.max(f, fCB);
  } else {
    // Swamee-Jain seed → Colebrook-White iteration
    const arg = eps_m / (3.7 * Dm) + 5.74 / Math.pow(Re, 0.9);
    f = arg > 0 ? 0.25 / Math.pow(Math.log10(arg), 2) : 0.02;
    if (!isFinite(f) || f <= 0) f = 0.02;
    for (let i = 0; i < 50; i++) {
      const inner = eps_m / (3.7 * Dm) + 2.51 / (Re * Math.sqrt(f));
      if (inner <= 0 || !isFinite(inner)) break;
      const fn = Math.pow(-2 * Math.log10(inner), -2);
      if (!isFinite(fn) || fn <= 0) break;
      if (Math.abs(fn - f) < 1e-10) { f = fn; break; }
      f = fn;
    }
  }
  if (!isFinite(f) || f <= 0) return { ok: false, error: 'Friction factor calculation failed — check pipe roughness.' };

  // K-factor total from fittings list
  const Ktot = Array.isArray(fittings)
    ? fittings.reduce((s, fit) => {
        const k = sanitizeNumber(fit.k, 0);
        const qty = Math.max(0, parseInt(fit.qty) || 0);
        return s + qty * k;
      }, 0)
    : 0;

  const dynPres = rho * V * V / 2;
  const dpPipe  = f * (L / Dm) * dynPres;
  const dpMinor = Ktot * dynPres;
  const dpElev  = rho * 9.81 * dz;
  const dpTotal = dpPipe + dpMinor + dpElev;

  const headLoss = dpTotal / (rho * 9.81);
  const Leq = f > 0 ? Ktot * Dm / f : 0;

  const P_hyd   = Qs * dpTotal;
  const P_shaft = P_hyd / pumpEff;
  const P_motor = P_shaft / motorEff;

  let regime, regimeClass;
  if (Re < 2300)       { regime = 'Laminar';      regimeClass = 'badge-green'; }
  else if (Re < 4000)  { regime = 'Transitional'; regimeClass = 'badge-amber'; }
  else                 { regime = 'Turbulent';    regimeClass = 'badge-red';   }

  const uncertPct = Re < 4000 ? 25 : (eps / Dm > 0.01 ? 8 : 5);

  // Unit display conversion
  let dpDisp, dpPipeDisp, dpMinorDisp, dpElevDisp, dpUnit, velDisp, velUnit, headDisp, headUnit;
  if (unitMode === 'imperial') {
    const toP = v => v * 0.000145038;
    dpDisp = toP(dpTotal); dpPipeDisp = toP(dpPipe); dpMinorDisp = toP(dpMinor); dpElevDisp = toP(dpElev);
    dpUnit = 'psi'; velDisp = V * 3.28084; velUnit = 'ft/s';
    headDisp = headLoss * 3.28084; headUnit = 'ft';
  } else {
    const toBar = v => v / 100000;
    dpDisp = toBar(dpTotal); dpPipeDisp = toBar(dpPipe); dpMinorDisp = toBar(dpMinor); dpElevDisp = toBar(dpElev);
    dpUnit = 'bar'; velDisp = V; velUnit = 'm/s';
    headDisp = headLoss; headUnit = 'm';
  }

  const warnings = [];
  if (V > 3 && rho > 500)
    warnings.push(`High velocity ${V.toFixed(2)} m/s — erosion risk above 3 m/s for liquids.`);
  else if (V > 15)
    warnings.push(`Very high velocity ${V.toFixed(2)} m/s — erosion and noise concern.`);
  if (Re >= 2300 && Re < 4000)
    warnings.push('Transitional regime (Re 2300–4000). Friction factor uncertainty ±20–30%.');
  if (Re < 4000 && Ktot > 0)
    warnings.push('Fittings equivalent length (Le) less reliable in laminar/transitional flow.');

  return {
    ok: true,
    dpDisp, dpPipeDisp, dpMinorDisp, dpElevDisp, dpUnit,
    velDisp, velUnit, headDisp, headUnit,
    Re, f, Ktot,
    regime, regimeClass,
    Leq, epsTotalMm: eps, foulingMm,
    P_hyd, P_shaft, P_motor,
    Qs, dpTotal, dpPipe, dpMinor, dpElev,
    uncertPct, warnings,
    per100label: unitMode === 'imperial' ? 'ΔP per 100 ft' : 'ΔP per 100 m',
    lenUnit:  unitMode === 'imperial' ? 'ft' : 'm',
    diamUnit: unitMode === 'imperial' ? 'in' : 'mm',
    diameter: inputs.D, length: inputs.L, dz,
  };
}

/* ═══════════════════════════════════════════════════════════════
   HAZEN-WILLIAMS CALCULATION ENGINE
═══════════════════════════════════════════════════════════════ */
function calcHW(inputs) {
  const { D_mm, L_m, Q_m3h, C } = inputs;
  if (D_mm <= 0 || L_m <= 0 || Q_m3h <= 0 || C <= 0)
    return { ok: false, error: 'All inputs must be positive values.' };

  const D_m  = D_mm / 1000;
  const Q_s  = Q_m3h / 3600;
  const hf   = 10.67 * L_m * Math.pow(Q_s, 1.852) / (Math.pow(C, 1.852) * Math.pow(D_m, 4.8704));
  if (!isFinite(hf) || hf < 0) return { ok: false, error: 'Calculation error — check inputs.' };

  const S    = hf / L_m;
  const A    = Math.PI * D_m * D_m / 4;
  const V    = Q_s / A;
  const rho  = 998, g = 9.81;
  const dpPa = hf * rho * g;
  const dpBar = dpPa / 1e5;

  const warnings = [
    '⚠ Hazen-Williams is valid only for water between 5–30°C (fully turbulent, Re > 100,000, D > 50 mm).'
  ];
  if (V > 3) warnings.push(`⚠ Velocity ${V.toFixed(2)} m/s exceeds 3 m/s — erosion risk.`);
  if (C < 80) warnings.push(`⚠ C = ${C} indicates severely fouled/corroded pipe.`);

  return {
    ok: true,
    hf, dpBar, S, V, C,
    per100m: (hf / L_m * 100),
    warnings,
  };
}

/* ═══════════════════════════════════════════════════════════════
   MAIN HANDLER
═══════════════════════════════════════════════════════════════ */
module.exports = async function handler(req, res) {
  setCORS(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return err(res, 405, 'Method not allowed');

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return err(res, 400, 'Invalid JSON body');
  }

  const action = sanitizeString(body.action, 32);

  /* ── ACTION: fluidList ── */
  if (action === 'fluidList') {
    const list = FLUID_DB.map(f => ({
      id:    f.id,
      name:  f.name,
      cat:   f.cat,
      isGas: f.isGas,
    }));
    return res.status(200).json({ ok: true, fluids: list });
  }

  /* ── ACTION: fluidProps ── */
  if (action === 'fluidProps') {
    const id    = sanitizeString(body.fluidId, 64);
    const T_C   = sanitizeNumber(body.T_C);
    const P_bar = sanitizeNumber(body.P_bar, 1.0);

    if (!id || T_C === null || !isFinite(T_C))
      return err(res, 400, 'fluidId and T_C are required');
    if (T_C < -273 || T_C > 2000)
      return err(res, 400, 'T_C out of reasonable range');

    const props = calcFluidProps(id, T_C, P_bar);
    if (!props) return err(res, 404, `Unknown fluid: ${id}`);
    return res.status(200).json({ ok: true, ...props });
  }

  /* ── ACTION: fittingsList ── */
  if (action === 'fittingsList') {
    const list = Object.entries(FITTING_CATALOGUE).map(([id, v]) => ({
      id, label: v.label, k: v.k,
    }));
    return res.status(200).json({ ok: true, fittings: list });
  }

  /* ── ACTION: calculate (Darcy-Weisbach) ── */
  if (action === 'calculate') {
    const D         = sanitizeNumber(body.D);
    const L         = sanitizeNumber(body.L);
    const Q         = sanitizeNumber(body.Q);
    const rho       = sanitizeNumber(body.rho);
    const mu        = sanitizeNumber(body.mu);
    const dz        = sanitizeNumber(body.dz, 0);
    const epsBase   = sanitizeNumber(body.epsBase, 0.046);
    const foulingMm = sanitizeNumber(body.foulingMm, 0);
    const pumpEff   = Math.max(0.01, Math.min(1, sanitizeNumber(body.pumpEff, 0.75)));
    const motorEff  = Math.max(0.01, Math.min(1, sanitizeNumber(body.motorEff, 0.92)));
    const unitMode  = body.unitMode === 'imperial' ? 'imperial' : 'metric';
    const isGasFluid = !!body.isGasFluid;

    // Sanitize fittings array
    const rawFits = Array.isArray(body.fittings) ? body.fittings.slice(0, 200) : [];
    const fittings = rawFits.map(f => ({
      k:   sanitizeNumber(f.k, 0),
      qty: Math.max(0, Math.min(999, parseInt(f.qty) || 0)),
    }));

    if ([D, L, Q, rho, mu].some(v => v === null))
      return err(res, 400, 'D, L, Q, rho, mu are required');

    const result = calcPressureDrop({ D, L, Q, rho, mu, dz, epsBase, foulingMm, fittings, pumpEff, motorEff, unitMode });
    if (!result.ok) return err(res, 422, result.error);

    if (isGasFluid)
      result.warnings.unshift('⚠ Compressible fluid detected. Darcy-Weisbach with constant density is approximate. Valid only if ΔP/P₁ < 10%.');

    return res.status(200).json(result);
  }

  /* ── ACTION: calcHW (Hazen-Williams) ── */
  if (action === 'calcHW') {
    const D_mm  = sanitizeNumber(body.D_mm);
    const L_m   = sanitizeNumber(body.L_m);
    const Q_m3h = sanitizeNumber(body.Q_m3h);
    const C     = sanitizeNumber(body.C);

    if ([D_mm, L_m, Q_m3h, C].some(v => v === null))
      return err(res, 400, 'D_mm, L_m, Q_m3h, C are required');

    const result = calcHW({ D_mm, L_m, Q_m3h, C });
    if (!result.ok) return err(res, 422, result.error);
    return res.status(200).json(result);
  }

  return err(res, 400, `Unknown action: ${action}`);
};
