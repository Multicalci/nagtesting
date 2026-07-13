// ════════════════════════════════════════════════════════════════════════════
// api/heat-exchanger.js
// MERGED VERCEL SERVERLESS API — FILE 4 of 5
//
// CALCULATORS IN THIS FILE
// ────────────────────────
//   SECTION A  ►  HEATXPERT PRO — SHELL & TUBE         /api/heatxpert  (subType: shellTube)
//   SECTION B  ►  HEATXPERT PRO — PLATE                /api/heatxpert  (subType: plate)
//   SECTION C  ►  HEATXPERT PRO — AIR COOLED           /api/heatxpert  (subType: airCooled)
//   SECTION D  ►  HEATXPERT PRO — FIN-FAN              /api/heatxpert  (subType: finFan)
//   SECTION E  ►  HEATXPERT PRO — DOUBLE PIPE          /api/heatxpert  (subType: doublePipe)
//   SECTION F  ►  HEATXPERT PRO — LMTD/NTU             /api/heatxpert  (subType: lmtdNtu)
//   SECTION G  ►  HEATXPERT PRO — WALL THICKNESS       /api/heatxpert  (subType: wallThick)
//   SECTION H  ►  HEATXPERT PRO — FOULING              /api/heatxpert  (subType: fouling)
//   SECTION I  ►  HEATXPERT PRO — SELECTOR             /api/heatxpert  (subType: selector)
//
// All sub-types are routed through a single endpoint: /api/heatxpert
// The "type" field in the POST body determines which sub-calculator runs.
//
// HOW TO NAVIGATE
//   Search "SECTION A" → Shell & Tube (Bell-Delaware)
//   Search "SECTION B" → Plate HX
//   Search "SECTION C" → Air Cooled HX
//   Search "SECTION D" → Fin-Fan HX
//   Search "SECTION E" → Double Pipe HX
//   Search "SECTION F" → LMTD / NTU method
//   Search "SECTION G" → Wall Thickness
//   Search "SECTION H" → Fouling
//   Search "SECTION I" → HX Type Selector
//   Search "heatxpert_handler" → Main dispatcher function
//
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const url      = req.url || '';
  const pathname = url.split('?')[0];
  const segments = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const key = segments[segments.length - 1] || '';

  switch (key) {
    case 'heatxpert':
      return await heatxpert_handler(req, res);
    default:
      return res.status(404).json({
        error: `Unknown route: "${key}". Valid: heatxpert`
      });
  }
}
// ── End of Router ────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// SECTION A–I  ►  HEATXPERT PRO (HEAT EXCHANGER DESIGN)
// Route: /api/heatxpert
// (Original: SECTION 06 of 21)
//
// Internal sub-type dispatch (by POST body "type" field):
//   shellTube  → calcShellTube()   [Bell-Delaware method]
//   plate      → calcPlate()
//   airCooled  → calcAirCooled()
//   finFan     → calcFinFan()
//   doublePipe → calcDoublePipe()
//   lmtdNtu    → calcLmtdNtu()
//   wallThick  → calcWallThickness()
//   fouling    → calcFouling()
//   selector   → calcSelector()
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 06 of 21  ►  HEATXPERT PRO (HEAT EXCHANGER)
// Route: /api/heatxpert
// Source: heatxpert.js
// ══════════════════════════════════════════════════════════════════════════════

// ─── VERCEL DEPLOYMENT: place this file at /api/heatxpert.js in your repo root ───
// Route auto-created at /api/heatxpert by Vercel

export const config = { api: { bodyParser: true } };
// ─── CORS ALLOWED ORIGINS ──────────────────────────────────────────────────
const HEATXPERT_ALLOWED_ORIGINS = new Set([
  'https://multicalci.com',
  'https://www.multicalci.com',
  'http://localhost:3000',
  'http://localhost:5173',
  // Add your Vercel preview URL here, e.g.:
  // 'https://multicalci-git-main-yourteam.vercel.app',
]);

async function heatxpert_handler(req, res) {
  // CORS
  const origin = req.headers.origin || '';
  const allowed = HEATXPERT_ALLOWED_ORIGINS.has(origin);
  res.setHeader('Vary', 'Origin');   // required when CORS origin is dynamic

  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://multicalci.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    // Safely parse body — Vercel may deliver it as a string or object
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON body' }); }
    }
    const { calcType } = body;
    if (!calcType) return res.status(400).json({ error: 'calcType required' });

    // ── UPGRADE (2026-07): property engine init (lazy, cached across warm calls)
    await initCoolProp();
    const _stamp = r => (r && typeof r === 'object'
      ? { ...r, propSource: CPI ? 'CoolProp 6.6 (Helmholtz EOS, NIST-grade)' : 'built-in DB (interpolated)' } : r);

   // ── Normalise units before dispatch ──────────────────────────────────
    const us = body.unitSys || 'metric';
    if (us === 'imperial') {
      ['hTi','hTo','cTi','cTo','Ti','To','Tamb','tTi','tTo','aTamb','aTout'].forEach(k => {
        if (body[k] != null) body[k] = toSI_temp(body[k], 'imperial');
      });
      ['hF','cF','F','tF_kgh'].forEach(k => {
        if (body[k] != null) body[k] = toSI_flow(body[k], 'imperial');
      });
      // FIX (audit 2026-07): pressures were never converted in imperial mode.
      // psi → bar. Affects gas density / Z-factor / Nm³-Sm³ conversion.
      // (The bundled frontend always converts client-side and sends unitSys:'metric',
      //  so this only matters for direct API callers using unitSys:'imperial'.)
      ['hPop','cPop','Pop','tPop','aPop','P','pdAllowShell','pdAllowTube',
       'pdAllowH','pdAllowC','pdAllow','pdAllowInner','pdAllowAnn','tPdAllow'].forEach(k => {
        if (body[k] != null && isFinite(parseFloat(body[k]))) body[k] = parseFloat(body[k]) * 0.0689476;
      });
    }
    if (body.hFunit && body.hFunit !== 'kgh')
      body.hF = toSI_flowWithUnit(body.hF, body.hFunit, body.hFlKey, body.hTi, body.hPop);
    if (body.cFunit && body.cFunit !== 'kgh')
      body.cF = toSI_flowWithUnit(body.cF, body.cFunit, body.cFlKey, body.cTi, body.cPop);

    switch (calcType) {
      case 'shellTube':   return res.json(_stamp(calcShellTube(body)));
      case 'plate':       return res.json(_stamp(calcPlate(body)));
      case 'airCooled':   return res.json(_stamp(calcAirCooled(body)));
      case 'finFan':      return res.json(_stamp(calcFinFan(body)));
      case 'doublePipe':  return res.json(_stamp(calcDoublePipe(body)));
      case 'lmtdNtu':     return res.json(_stamp(calcLmtdNtu(body)));
      case 'wallThick':   return res.json(_stamp(calcWallThickness(body)));
      case 'fouling':     return res.json(_stamp(calcFouling(body)));
      case 'selector':    return res.json(_stamp(calcSelector(body)));
      case 'geoOptimizer': return res.json(_stamp(calcGeometryOptimizer(body)));
      default:            return res.status(400).json({ error: 'Unknown calcType: ' + calcType });
    }
  } catch (err) {
    console.error('HeatXpert API error:', err);
    return res.status(500).json({ error: 'Calculation error: ' + (err.message || 'unknown') });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COOLPROP PROPERTY ENGINE (upgrade 2026-07, "route to 7")
//
// NIST-REFPROP-grade Helmholtz-EOS properties via the coolprop-wasm npm
// package (6.8 MB, MIT licence). Loaded LAZILY on first request and cached;
// if the package is not installed (or WASM init fails) every calculator
// falls back transparently to the built-in property database, and the
// response reports which source was used (`propSource`).
//
// Deploy: add to repo root package.json →  "dependencies": {"coolprop-wasm":"^6.6.0"}
// ═══════════════════════════════════════════════════════════════════════════
let CPI = null;              // CoolProp instance (module-level, survives warm invocations)
let _cpTried = false;
async function initCoolProp() {
  if (CPI || _cpTried) return CPI;
  _cpTried = true;
  try {
    const mod = await import('coolprop-wasm');
    CPI = await mod.default();
    console.log('[HeatXpert] CoolProp 6.6 WASM initialised — NIST-grade properties active');
  } catch (e) {
    CPI = null;
    console.warn('[HeatXpert] CoolProp unavailable (' + (e.message||e) + ') — using built-in property DB');
  }
  return CPI;
}

// Built-in key → CoolProp fluid name. Keys absent here (oils, brines, food
// fluids, molten salt…) always use the built-in DB — CoolProp has no model
// for them and pretending otherwise would be worse than interpolation.
const COOLPROP_NAME = {
  'water':'Water', 'steam':'Water',
  'air':'Air', 'nitrogen':'Nitrogen', 'oxygen':'Oxygen', 'hydrogen':'Hydrogen',
  'methane':'Methane', 'co2':'CarbonDioxide',
  'ammonia-gas':'Ammonia', 'ammonia-liquid':'Ammonia', 'r717':'Ammonia',
  'ethanol':'Ethanol', 'methanol':'Methanol', 'acetone':'Acetone',
  'benzene':'Benzene', 'toluene':'Toluene', 'xylene':'o-Xylene',
  'r134a':'R134a', 'r410a':'R410A',
  'ethylene-glycol-30':'INCOMP::MEG[0.30]', 'ethylene-glycol-50':'INCOMP::MEG[0.50]',
  'propylene-glycol-30':'INCOMP::MPG[0.30]', 'propylene-glycol-50':'INCOMP::MPG[0.50]',
  // natural-gas deliberately NOT mapped: real NG is a mixture; the built-in
  // pseudo-fluid (MW 17, Tc 200 K) is the more honest model at this fidelity.
};
const _cpMemo = new Map();   // (key|T0.1K|P0.01bar) → props; bounds warm-instance growth
function cpProps(fluidKey, T_degC, P_bar_abs) {
  if (!CPI) return null;
  const name = COOLPROP_NAME[(fluidKey||'').toLowerCase().trim()];
  if (!name) return null;
  const T_K = T_degC + 273.15, Pa = Math.max(P_bar_abs||P_REF_DB, 0.001)*1e5;
  const mk = name+'|'+(Math.round(T_K*10)/10)+'|'+(Math.round(Pa/1000));
  if (_cpMemo.has(mk)) return _cpMemo.get(mk);
  const S = (o,n1,v1,n2,v2)=>CPI.PropsSI(o,n1,v1,n2,v2,name);
  let out = null;
  try {
    const isIncomp = name.startsWith('INCOMP');
    // Saturation frame for pure fluids (incompressibles have no dome)
    let Tsat = null, hvap = null, Pc = null, Tc = null, MW = null, omega = null;
    if (!isIncomp) {
      try { Tsat = S('T','P',Pa,'Q',1) - 273.15; } catch {}
      try { hvap = Tsat!=null ? (S('H','P',Pa,'Q',1)-S('H','P',Pa,'Q',0))/1000 : null; } catch {}
      try { Pc = S('PCRIT','',0,'',0)/1e5; Tc = S('TCRIT','',0,'',0); MW = S('M','',0,'',0)*1000; omega = S('ACENTRIC','',0,'',0); } catch {}
    }
    // Intent-aware state point: '-liquid'/'r717' keys want liquid; 'steam'/'-gas'
    // want vapour. If the requested (T,P) sits on the wrong side of the dome
    // (common when users enter approximate temps), evaluate at saturation.
    const wantLiquid = /(-liquid|^water$|^r717$|glycol)/.test(fluidKey);
    const wantVapour = /(^steam$|-gas$)/.test(fluidKey);
    let args = ['T', T_K, 'P', Pa];
    if (!isIncomp && Tsat != null) {
      if (wantVapour && T_degC < Tsat + 0.05) args = ['P', Pa, 'Q', 1];
      if (wantLiquid && T_degC > Tsat - 0.05) args = ['P', Pa, 'Q', 0];
    }
    const g = o => S(o, args[0], args[1], args[2], args[3]);
    out = {
      rho: g('D'), mu: g('V')*1000 /* Pa·s→mPa·s */, cp: g('C')/1000, k: g('L'),
      Z: isIncomp ? 1.0 : (()=>{ try { return g('Z'); } catch { return 1.0; } })(),
      Tsat, hvap, Pc, Tc, MW, omega,
      _src: 'coolprop', zMethod: isIncomp ? 'incompressible' : 'Helmholtz EOS (CoolProp)'
    };
    if (!isFinite(out.rho) || !isFinite(out.mu) || !isFinite(out.cp) || !isFinite(out.k)) out = null;
  } catch { out = null; }
  if (_cpMemo.size > 5000) _cpMemo.clear();
  _cpMemo.set(mk, out);
  return out;
}

// ─── FLUID DATABASE ───────────────────────────────────────────────────────────
const GAS_RHO_THRESHOLD = 50;
const P_REF_DB = 1.01325;
const T_REF_DB = 293.15;

const FP = {
  'water': {
    rho:998, mu:0.89, cp:4.182, k:0.600,
    rho_pts:[[10,999.7],[25,997.0],[50,988.1],[75,974.9],[100,958.4],[150,916.8]],
    mu_pts: [[10,1.307],[25,0.890],[50,0.547],[75,0.378],[100,0.282],[150,0.183]],
    cp_pts: [[10,4.192],[25,4.182],[50,4.182],[75,4.190],[100,4.216],[150,4.310]],
    k_pts:  [[10,0.580],[25,0.607],[50,0.644],[75,0.667],[100,0.679],[150,0.683]],
    name:'Water'
  },

  'brine-nacl':         {rho:1197,mu:1.8,   cp:3.50,  k:0.500, name:'Brine NaCl 25%'},
  'brine-cacl2':        {rho:1298,mu:2.5,   cp:3.20,  k:0.480, name:'Brine CaCl₂ 30%'},
  'ethylene-glycol-30': {
    rho:1040, mu:2.5, cp:3.80, k:0.450,
    rho_pts:[[0,1054],[20,1040],[40,1027],[60,1014],[80,1000]],
    mu_pts: [[0,5.6],[20,2.5],[40,1.4],[60,0.85],[80,0.55]],
    cp_pts: [[0,3.64],[20,3.80],[40,3.90],[60,3.99],[80,4.07]],
    k_pts:  [[0,0.440],[20,0.450],[40,0.455],[60,0.460],[80,0.462]],
    name:'Ethylene Glycol 30%'
  },

  'ethylene-glycol-50': {rho:1078,mu:4.8,   cp:3.50,  k:0.380, name:'Ethylene Glycol 50%'},
  'propylene-glycol-30':{rho:1020,mu:2.2,   cp:3.90,  k:0.430, name:'Propylene Glycol 30%'},
  'propylene-glycol-50':{rho:1042,mu:5.5,   cp:3.60,  k:0.350, name:'Propylene Glycol 50%'},
   'crude-oil-light': {
    rho:850, mu:10, cp:2.10, k:0.140,
    rho_pts:[[20,855],[40,840],[60,825],[80,810],[100,795]],
    mu_pts: [[20,15.0],[40,8.0],[60,4.5],[80,2.8],[100,1.9]],
    cp_pts: [[20,2.00],[50,2.10],[80,2.20],[100,2.28]],
    k_pts:  [[20,0.142],[60,0.138],[100,0.133]],
    name:'Crude Oil (Light)'
  },

  'crude-oil-heavy':    {rho:950, mu:100,   cp:1.90,  k:0.120, name:'Crude Oil (Heavy)'},
  'diesel':             {rho:840, mu:3.5,   cp:2.00,  k:0.130, name:'Diesel'},
  'gasoline':           {rho:740, mu:0.6,   cp:2.20,  k:0.140, name:'Gasoline'},
  'kerosene':           {rho:820, mu:2.0,   cp:2.10,  k:0.130, name:'Kerosene'},
  'fuel-oil':           {rho:960, mu:50,    cp:1.80,  k:0.110, name:'Fuel Oil'},
  'lube-oil':           {rho:900, mu:80,    cp:2.00,  k:0.130, name:'Lubricating Oil'},
  'hydraulic-oil':      {rho:880, mu:40,    cp:2.00,  k:0.130, name:'Hydraulic Oil'},
  'thermal-oil':        {rho:870, mu:20,    cp:2.30,  k:0.120, name:'Thermal Oil'},
  'benzene':            {rho:880, mu:0.65,  cp:1.75,  k:0.140, name:'Benzene'},
  'toluene':            {rho:870, mu:0.59,  cp:1.69,  k:0.130, name:'Toluene'},
  'xylene':             {rho:870, mu:0.81,  cp:1.71,  k:0.130, name:'Xylene'},
  'air':                {rho:1.205,mu:0.0182,cp:1.005,k:0.0262,name:'Air',           MW:28.97,Tc:132.5,Pc:37.9, omega:0.035},
  'nitrogen':           {rho:1.165,mu:0.0175,cp:1.040,k:0.0260,name:'Nitrogen',       MW:28.01,Tc:126.2,Pc:33.9, omega:0.040},
  'oxygen':             {rho:1.331,mu:0.0202,cp:0.920,k:0.0265,name:'Oxygen',         MW:32.00,Tc:154.6,Pc:50.4, omega:0.022},
  'hydrogen':           {rho:0.084,mu:0.0088,cp:14.30,k:0.1800,name:'Hydrogen',       MW:2.016,Tc:33.2, Pc:13.0, omega:-0.217},
  'natural-gas':        {rho:0.720,mu:0.0110,cp:2.200,k:0.0350,name:'Natural Gas',    MW:17.00,Tc:200.0,Pc:46.0, omega:0.012},
  'methane':            {rho:0.664,mu:0.0109,cp:2.220,k:0.0340,name:'Methane',        MW:16.04,Tc:190.6,Pc:46.1, omega:0.011},
  'co2':                {rho:1.842,mu:0.0147,cp:0.850,k:0.0168,name:'Carbon Dioxide', MW:44.01,Tc:304.2,Pc:73.8, omega:0.239},
'steam': {
    rho:0.598, mu:0.0120, cp:2.010, k:0.0250,
    mu_pts: [[100,0.01227],[150,0.01415],[200,0.01615],[300,0.02008],[400,0.02449]],
    k_pts:  [[100,0.02479],[150,0.02897],[200,0.03355],[300,0.04345],[400,0.05476]],
    cp_pts: [[100,2.042],[150,1.980],[200,1.975],[300,1.997],[400,2.059]],
    MW:18.02, Tc:647.1, Pc:220.6, omega:0.345,
    hvap:2257, Tsat:100,
    name:'Steam'
  },

  'ammonia-gas':        {rho:0.730,mu:0.0101,cp:2.190,k:0.0246,name:'Ammonia Gas',    MW:17.03,Tc:405.6,Pc:113.5,omega:0.253, hvap:1370, Tsat:-33.3},
  'ammonia-liquid':     {rho:610, mu:0.25,  cp:4.70,  k:0.500, hvap:1370, Tsat:-33.3, MW:17.03, Tc:405.6, Pc:113.5, name:'Ammonia (Liquid)'},
  'ethanol':            {rho:790, mu:1.20,  cp:2.46,  k:0.170, name:'Ethanol'},
  'methanol':           {rho:792, mu:0.60,  cp:2.53,  k:0.210, name:'Methanol'},
  'acetone':            {rho:790, mu:0.32,  cp:2.15,  k:0.160, name:'Acetone'},
  'sulfuric-acid-98':   {rho:1840,mu:25,    cp:1.38,  k:0.350, name:'Sulfuric Acid 98%'},
  'sulfuric-acid-75':   {rho:1660,mu:8,     cp:1.80,  k:0.400, name:'Sulfuric Acid 75%'},
  'nitric-acid-68':     {rho:1400,mu:2.0,   cp:2.50,  k:0.400, name:'Nitric Acid 68%'},
  'hcl-32':             {rho:1160,mu:1.5,   cp:2.80,  k:0.450, name:'HCl 32%'},
  'naoh-50':            {rho:1530,mu:15,    cp:2.80,  k:0.450, name:'NaOH 50%'},
  'naoh-25':            {rho:1280,mu:3.0,   cp:3.40,  k:0.500, name:'NaOH 25%'},
  'acetic-acid':        {rho:1050,mu:1.2,   cp:2.10,  k:0.190, name:'Acetic Acid'},
  'r134a':              {rho:1200,mu:0.20,  cp:1.43,  k:0.080, hvap:198,  Tsat:-26.1, MW:102.03, Tc:374.2, Pc:40.6, name:'R-134a'},
  'r410a':              {rho:1060,mu:0.15,  cp:1.77,  k:0.080, name:'R-410A'},
  'r717':               {rho:610, mu:0.25,  cp:4.70,  k:0.500, hvap:1370, Tsat:-33.3, MW:17.03, Tc:405.6, Pc:113.5, name:'R-717 (Ammonia)'},
  'milk':               {rho:1030,mu:2.0,   cp:3.90,  k:0.550, name:'Milk'},
  'juice':              {rho:1050,mu:3.0,   cp:3.80,  k:0.540, name:'Fruit Juice'},
  'beer':               {rho:1010,mu:1.5,   cp:4.00,  k:0.580, name:'Beer'},
  'sugar-solution':     {rho:1250,mu:15,    cp:3.20,  k:0.450, name:'Sugar Solution 50%'},
  'molten-salt':        {rho:1900,mu:5.0,   cp:1.50,  k:0.500, name:'Molten Salt'},
  'dowtherm':           {rho:1060,mu:3.5,   cp:2.20,  k:0.130, name:'Dowtherm A'},
  'mercury':            {rho:13600,mu:1.5,  cp:0.14,  k:8.300, name:'Mercury'},
  'sodium':             {rho:930, mu:0.7,   cp:1.38,  k:86.00, name:'Liquid Sodium'},
};

const KMAT = {cs:50, ss304:16, ss316:14, copper:385, titanium:21, inconel:10, nickel:12};
// ── Tube mechanical properties for vibration screening (audit upgrade 2026-07) ──
const EMAT   = {cs:200e9, ss304:193e9, ss316:193e9, copper:117e9, titanium:105e9, inconel:207e9, nickel:204e9}; // Pa
const RHOMAT = {cs:7850,  ss304:8000,  ss316:8000,  copper:8960,  titanium:4510,  inconel:8440,  nickel:8890};  // kg/m³
// Vapour ↔ liquid phase-pair mapping for two-phase services
const VAPOUR_OF = {'water':'steam','ammonia-liquid':'ammonia-gas','r717':'ammonia-gas'};
const LIQUID_OF = {'steam':'water','ammonia-gas':'ammonia-liquid'};

// ═══════════════════════════════════════════════════════════════════════════
// SATURATION PROPERTY LAYER (upgrade v7, 2026-07)
//
// The database Tsat/hvap are single reference values at ~1 atm. Real services
// condense/boil at operating pressure — steam at 2.7 bar condenses at 130°C,
// not 100°C. This layer provides Tsat(P) and hvap(T):
//
//   WATER/STEAM  — Antoine equation, two published ranges:
//                    1–100°C : log10(P_mmHg) = 8.07131 − 1730.63/(233.426+T)
//                    99–374°C: log10(P_mmHg) = 8.14019 − 1810.94/(244.485+T)
//                  Verified vs steam tables: 2.7 bar → 130.2°C (table 130.0),
//                  10 bar → 180.1°C (table 179.9).
//   OTHER FLUIDS — Clausius-Clapeyron integrated from the database anchor
//                  (Tsat_ref at 1.01325 bar, hvap_ref, MW):
//                    1/T = 1/T_ref − (R_s/L)·ln(P/P_ref),  R_s = 8314/MW
//                  One Watson refinement of L at the mean temperature.
//                  NH₃ check: 4 bar → −1.4°C (R717 table −1.9), 10 bar →
//                  25.0°C (table 24.9). Thermodynamically grounded — no
//                  fitted constants beyond the DB anchor itself.
//   LATENT HEAT  — Watson relation: L(T) = L_ref·[(Tc−T)/(Tc−T_ref)]^0.38.
//                  NH₃ at 25°C → 1162 kJ/kg (table ≈1166).
// ═══════════════════════════════════════════════════════════════════════════
function satTemperature(fluidKey, P_bar_abs) {
  const key = (fluidKey || '').toLowerCase().trim();
  const P = Math.max(parseFloat(P_bar_abs) || 1.01325, 0.01);
  if (key === 'water' || key === 'steam') {
    const P_mmHg = P * 750.062;
    const lgP = Math.log10(P_mmHg);
    // low range first; switch to high range above its ~100°C validity edge
    let T = 1730.63 / (8.07131 - lgP) - 233.426;
    if (T > 99) T = 1810.94 / (8.14019 - lgP) - 244.485;
    return T;
  }
  const f = FP[key];
  if (!f || !f.Tsat || !f.hvap || !f.MW) return f?.Tsat ?? null;
  const R_s = 8314 / f.MW;                       // J/kgK
  const Tref = f.Tsat + 273.15;
  let L = f.hvap * 1000;                          // J/kg at Tref
  let T_K = Tref;
  for (let i = 0; i < 2; i++) {                   // one Watson refinement pass
    const invT = 1 / Tref - (R_s / L) * Math.log(P / 1.01325);
    T_K = 1 / Math.max(invT, 1e-6);
    if (f.Tc) {
      const Tc_K = f.Tc;                          // DB stores Tc in Kelvin
      const Tm = (T_K + Tref) / 2;
      if (Tc_K > Tm && Tc_K > Tref)
        L = f.hvap * 1000 * Math.pow((Tc_K - Tm) / (Tc_K - Tref), 0.38);
    }
  }
  // never extrapolate beyond ~0.9·Tc (Clausius-Clapeyron breaks near critical)
  if (f.Tc && T_K > 0.9 * f.Tc) T_K = 0.9 * f.Tc;
  return T_K - 273.15;
}

function hvapAtT(fluidKey, T_degC) {
  const key = (fluidKey || '').toLowerCase().trim();
  const f = FP[key] || FP[LIQUID_OF[key]] || FP[VAPOUR_OF[key]];
  if (!f || !f.hvap) return 2257;                 // steam default, kJ/kg
  if (!f.Tc || f.Tsat == null) return f.hvap;
  const Tc = f.Tc, T_K = T_degC + 273.15, Tref = f.Tsat + 273.15;
  if (T_K >= 0.95 * Tc || Tref >= Tc) return f.hvap;
  return f.hvap * Math.pow(Math.max(Tc - T_K, 1) / (Tc - Tref), 0.38);
}

// Normalize fluid key lookup (case-insensitive)
function getFluid(key) { return FP[(key||"").toLowerCase().trim()] || FP.water; }

// ─── TEMPERATURE INTERPOLATION HELPER ───────────────────────────────────────
function interpProp(pts, T, fallback) {
  if (!pts || pts.length === 0) return fallback;
  if (T <= pts[0][0])              return pts[0][1];
  if (T >= pts[pts.length-1][0])   return pts[pts.length-1][1];
  for (let i = 1; i < pts.length; i++) {
    if (T <= pts[i][0]) {
      const [T0,v0] = pts[i-1], [T1,v1] = pts[i];
      return v0 + (v1-v0)*(T-T0)/(T1-T0);
    }
  }
}

function getFluidAtT(key, T_degC) {
  const raw = FP[(key||'').toLowerCase().trim()] || FP.water;
  return {
    rho:  raw.rho_pts  ? interpProp(raw.rho_pts,  T_degC, raw.rho) : raw.rho,
    mu:   raw.mu_pts   ? interpProp(raw.mu_pts,   T_degC, raw.mu)  : raw.mu,
    cp:   raw.cp_pts   ? interpProp(raw.cp_pts,   T_degC, raw.cp)  : raw.cp,
    k:    raw.k_pts    ? interpProp(raw.k_pts,    T_degC, raw.k)   : raw.k,
    name: raw.name, MW: raw.MW, Tc: raw.Tc, Pc: raw.Pc,
    omega: raw.omega, hvap: raw.hvap, Tsat: raw.Tsat
  };
}


// ─── FLUID PROPERTY FUNCTIONS ─────────────────────────────────────────────────
function calcZ(fluid, T_K, P_bar) {
  if (!fluid.Tc || !fluid.Pc) return 1.0;
  const Tr = T_K / fluid.Tc, Pr = P_bar / fluid.Pc;
  if (Tr <= 0 || Pr <= 0) return 1.0;
  if (Pr > 1.0) return calcZ_PR(fluid, T_K, P_bar);
  const B0 = 0.083 - 0.422/Math.pow(Tr,1.6);
  const B1 = 0.139 - 0.172/Math.pow(Tr,4.2);
  const omega = fluid.omega || 0;
  return Math.max(0.1, Math.min(1 + (B0 + omega*B1)*(Pr/Tr), 2.0));
}

function calcZ_PR(fluid, T_K, P_bar) {
  // FIX (validation suite 2026-07, Tier-2 check 2.7): the previous version
  // used a = 0.45724·α·Pc²/Tc² — dimensionally wrong (PR requires
  // a = 0.45724·R²Tc²·α/Pc) — and a mangled A definition, so Z clamped near
  // 1.0-1.1 even for dense-phase gas (CO₂ at 100 bar returned Z=1.10; the
  // correct PR root is ≈0.40). Rewritten in the standard REDUCED form:
  //   A = 0.45724·α·Pr/Tr²,   B = 0.07780·Pr/Tr
  //   Z³ − (1−B)Z² + (A − 3B² − 2B)Z − (AB − B² − B³) = 0
  // Newton from Z=1 converges to the vapour/supercritical root.
  if (!fluid.Tc || !fluid.Pc) return 1.0;
  const omega = fluid.omega||0, Tr = T_K/fluid.Tc, Pr = P_bar/fluid.Pc;
  if (Tr <= 0 || Pr <= 0) return 1.0;
  const kappa = 0.37464 + 1.54226*omega - 0.26992*omega*omega;
  const alpha = Math.pow(1 + kappa*(1 - Math.sqrt(Tr)), 2);
  const A_pr = 0.45724 * alpha * Pr / (Tr*Tr);
  const B_pr = 0.07780 * Pr / Tr;
  const c2 = -(1-B_pr), c1 = A_pr-3*B_pr*B_pr-2*B_pr, c0 = -(A_pr*B_pr-B_pr*B_pr-B_pr*B_pr*B_pr);
  let Z = 1.0;
  for (let i=0; i<80; i++) {
    const fZ = Z*Z*Z+c2*Z*Z+c1*Z+c0;
    const dfZ = 3*Z*Z+2*c2*Z+c1;
    if (Math.abs(dfZ)<1e-12) break;
    const dZ = fZ/dfZ; Z -= dZ;
    if (Z <= B_pr) Z = B_pr + 1e-4;   // Z must exceed B (physical constraint)
    if (Math.abs(dZ)<1e-10) break;
  }
  return Math.max(0.05, Math.min(Z, 2.5));
}

function fluidRhoActual(fluid, T_degC, P_bar_abs) {
  if (fluid.rho >= GAS_RHO_THRESHOLD) return fluid.rho;
  const T_K = T_degC + 273.15;
  const P = Math.max(P_bar_abs||P_REF_DB, 0.001);
  if (fluid.MW && fluid.Tc && fluid.Pc) {
    const Z = calcZ(fluid, T_K, P);
    return Math.max((fluid.MW*P)/(Z*83.145*T_K)*1000, 1e-4);
  }
  return fluid.rho*(P/P_REF_DB)*(T_REF_DB/(T_degC+273.15));
}

function fluidMuActual(fluid, T_degC) {
  if (fluid.rho >= GAS_RHO_THRESHOLD) return fluid.mu;
  return fluid.mu * Math.pow((T_degC+273.15)/T_REF_DB, 0.67);
}

function fluidKActual(fluid, T_degC) {
  if (fluid.rho >= GAS_RHO_THRESHOLD) return fluid.k;
  return fluid.k * Math.pow((T_degC+273.15)/T_REF_DB, 0.8);
}

function fluidAtConditions(fluidKey, T_mean_degC, P_bar_abs) {
  const normalizedKey = (fluidKey || '').toLowerCase().trim();
  // ── UPGRADE (2026-07): CoolProp first, built-in DB as fallback ──────────
  const cp = cpProps(normalizedKey, T_mean_degC, P_bar_abs);
  if (cp) {
    const dbf = FP[normalizedKey] || {};
    return { rho:cp.rho, mu:cp.mu, cp:cp.cp, k:cp.k,
      name:(dbf.name || normalizedKey), Z:cp.Z, zMethod:cp.zMethod,
      _isGas: cp.rho < GAS_RHO_THRESHOLD, _src:'coolprop',
      hvap: cp.hvap ?? dbf.hvap, Tsat: cp.Tsat ?? dbf.Tsat,
      MW: cp.MW ?? dbf.MW, Tc: cp.Tc ?? dbf.Tc, Pc: cp.Pc ?? dbf.Pc,
      omega: cp.omega ?? dbf.omega };
  }
  const f = FP[normalizedKey];
  if (!f) {
    console.warn(`[HeatXpert] Unknown fluid key: "${fluidKey}" — falling back to water`);
  }
  const fluid = f || FP.water;
  const isGas = fluid.rho < GAS_RHO_THRESHOLD;
  const T_K = T_mean_degC + 273.15;
  const P = Math.max(P_bar_abs||P_REF_DB, 0.001);
  let Z_val=1.0, method='liquid';
  if (isGas) {
    Z_val = calcZ(fluid, T_K, P);
    method = (fluid.MW && fluid.Tc && fluid.Pc) ? (P/(fluid.Pc||1)>1.0?'Peng-Robinson':'Pitzer virial') : 'ideal gas (no crit. props)';
  }
const tProps = getFluidAtT(normalizedKey, T_mean_degC);
  const rhoFinal = isGas ? fluidRhoActual(fluid,T_mean_degC,P_bar_abs) : tProps.rho;
  // FIX (audit 2026-07): MW/Tc/Pc/omega were being stripped here, so downstream
  // consumers (Chen/Cooper boiling) could never access the real critical props.
  return { rho:rhoFinal, mu:tProps.mu, cp:tProps.cp, k:tProps.k,
    name:fluid.name, Z:Z_val, zMethod:method, _isGas:isGas, _src:'builtin-db',
    hvap:fluid.hvap, Tsat:fluid.Tsat,
    MW:fluid.MW, Tc:fluid.Tc, Pc:fluid.Pc, omega:fluid.omega };

}

// ─── LMTD CALCULATION ─────────────────────────────────────────────────────────
function calcF_1_2(R, P) {
  if (P <= 0 || P >= 1 || R <= 0) return { F:1.0, valid:false };
  if (R*P >= 1.0) return { F:0.75, valid:false };
  const S = Math.sqrt(R*R+1);
  if (Math.abs(R-1) < 0.001) {
    const denom = (2-P*(2+Math.sqrt(2))) > 0 ? Math.log((2-P*(2-Math.sqrt(2)))/(2-P*(2+Math.sqrt(2)))) : 0;
    if (Math.abs(denom) < 1e-10) return {F:1.0,valid:true};
    const F = Math.sqrt(2)*P / ((1-P)*denom);
    return {F:Math.max(0.5,Math.min(F,1.0)),valid:true};
  }
  const n1 = 2/P - 1 - R + S, n2 = 2/P - 1 - R - S;
  if (n1 <= 0 || n2 <= 0 || n1 === n2) return {F:0.8,valid:false};
  const F = (S/(R-1)) * Math.log((1-P)/(1-P*R)) / Math.log(n1/n2);
  return {F:Math.max(0.5,Math.min(F,1.0)),valid:true};
}

function calcF_crossflow(R, P) {
  // FIX (audit 2026-07): previous version used an arbitrary fitted expression
  // F = 0.88 + 0.12·exp(-0.15·NTU) with no basis in published charts.
  // Now computed RIGOROUSLY from the definition of F:
  //   F = NTU_counterflow(P,R) / NTU_crossflow(P,R)
  // where NTU_crossflow is found by inverting the standard single-pass
  // crossflow (both fluids unmixed) effectiveness relation
  //   ε = 1 − exp[ NTU^0.22 · (exp(−Cr·NTU^0.78) − 1) / Cr ]
  // (ESDU / Kays & London approximation) via bisection.
  if (P <= 0 || R < 0) return {F:1.0, valid:false};
  if (P >= 1 || R*P >= 0.999) return {F:0.75, valid:false};
  // Map to the Cmin-based domain: if R > 1 the HOT stream is Cmin;
  // by stream symmetry use Pe = P·R (hot-stream effectiveness), Re = 1/R.
  let Pe = P, Rc = R;
  if (R > 1) { Pe = P * R; Rc = 1 / R; }
  if (Pe >= 0.999) return {F:0.75, valid:false};
  const crossEff = (ntu, cr) => {
    if (cr < 1e-6) return 1 - Math.exp(-ntu);                       // evaporator/condenser limit
    return 1 - Math.exp((Math.exp(-cr * Math.pow(ntu, 0.78)) - 1) * Math.pow(ntu, 0.22) / cr);
  };
  // Bisection for NTU_crossflow
  let lo = 1e-4, hi = 200;
  if (crossEff(hi, Rc) < Pe) return {F:0.75, valid:false};          // effectiveness unattainable
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (crossEff(mid, Rc) < Pe) lo = mid; else hi = mid;
  }
  const NTU_cross = 0.5 * (lo + hi);
  const NTU_cf = Math.abs(Rc - 1) < 1e-3
    ? Pe / Math.max(1 - Pe, 1e-9)
    : Math.log((1 - Rc * Pe) / Math.max(1 - Pe, 1e-9)) / (1 - Rc);
  const F = Math.max(0.5, Math.min(1.0, NTU_cf / Math.max(NTU_cross, 1e-9)));
  return {F, valid:true};
}

function calcLMTD(hTi, hTo, cTi, cTo, arr) {
  let dT1, dT2;
  if (arr === 'parallel') {
    dT1 = hTi - cTi; dT2 = hTo - cTo;
  } else {
    dT1 = hTi - cTo; dT2 = hTo - cTi;
  }
  if (dT1 <= 0 || dT2 <= 0) return {lmtd:null, err:'Temperature cross — check inlet/outlet temps'};
  const lmtd = Math.abs(dT1-dT2) < 0.001 ? dT1 : (dT1-dT2)/Math.log(dT1/dT2);
  if (!isFinite(lmtd) || lmtd <= 0) return {lmtd:null, err:'LMTD calculation failed'};
  const R = (hTi-hTo)/Math.max(cTo-cTi,0.001);
  const P = (cTo-cTi)/Math.max(hTi-cTi,0.001);
  let F=1.0;
  if (arr==='shell12') F = calcF_1_2(R,P).F;
  else if (arr==='shell24') {
    const P1 = P / Math.max(2-P*(1+R), 0.01);
    F = calcF_1_2(R, Math.min(P1,0.99)).F;
  } else if (arr==='cross1') F = calcF_crossflow(R,P).F;
  return {lmtd, F, dT1, dT2};
}

// ─── TUBE-SIDE HTC ────────────────────────────────────────────────────────────
function calcHtube(fluid, massFlowKgS, Di_m, L_m, mu_wall_mPas) {
  // Tube-side HTC using:
  //   Laminar:     Sieder-Tate / Hausen with entry correction
  //   Transition:  Hausen (Re 2300-10000)
  //   Turbulent:   Gnielinski (Re > 10000), floor = Dittus-Boelter
  //   Viscosity correction: Sieder-Tate (μ_bulk/μ_wall)^0.14 applied in all regimes
  const {rho, mu:mu_mPas, cp, k} = fluid;
  const mu = mu_mPas * 1e-3;
  const A   = Math.PI * Di_m * Di_m / 4;
  const vel = massFlowKgS / (rho * Math.max(A, 1e-8));
  const Re  = rho * vel * Di_m / mu;
  const Pr  = Math.max(mu * cp * 1000 / k, 0.5);

  let Nu;
  if (Re < 2300) {
    const Gz = Re * Pr * Di_m / Math.max(L_m, 0.01);
    Nu = Math.max(3.66, 1.86 * Math.pow(Gz, 0.333));
  } else if (Re < 10000) {
    // Hausen transition correlation
    Nu = 0.116 * (Math.pow(Re, 0.667) - 125) * Math.pow(Pr, 0.333) * (1 + Math.pow(Di_m / L_m, 0.667));
    Nu = Math.max(Nu, 3.66);
  } else {
    // Gnielinski (1976) — more accurate than Dittus-Boelter especially near Re=10000
    const f_gn = Math.pow(0.790 * Math.log(Math.max(Re, 10)) - 1.64, -2);
    Nu = (f_gn / 8) * (Re - 1000) * Pr / (1 + 12.7 * Math.sqrt(f_gn / 8) * (Math.pow(Pr, 2/3) - 1));
    Nu = Math.max(Nu, 0.023 * Math.pow(Re, 0.8) * Math.pow(Pr, 0.4));  // Dittus-Boelter floor
  }

  // Sieder-Tate viscosity correction (μ_bulk / μ_wall)^0.14
  // Applied when wall viscosity is known (passed from the convergence loop where
  // hFluid_wall is available). For water the correction is small (~8%);
  // for viscous oils it can be 30-40%.
  let phi_visc = 1.0;
  if (mu_wall_mPas && mu_wall_mPas > 0) {
    const mu_wall = mu_wall_mPas * 1e-3;
    phi_visc = Math.pow(mu / mu_wall, 0.14);
    phi_visc = Math.max(0.5, Math.min(phi_visc, 2.0));  // clamp to physical range
  }
  Nu = Nu * phi_visc;

  return { h: Nu * k / Di_m, Re, vel, Nu, phi_visc };
}
// ─── FILM CONDENSATION HTC (Nusselt) ────────────────────────────────────────
// orientation: "horizontal" (default for S&T) or "vertical"
function calcHcondense(fluid, Twall_degC, OD_m, L_m, orientation) {
  const hvap  = (fluid.hvap || 2257) * 1000;     // J/kg
  const Tsat  = fluid.Tsat  || 100;              // °C at ~1 bar
  const dT    = Math.max(Math.abs(Tsat - Twall_degC), 1.0);
  const rho   = fluid.rho;
  const mu    = (fluid.mu || 0.28) * 1e-3;
  const k     = fluid.k   || 0.68;
  const g     = 9.81;
  let h;
  if (orientation === "vertical") {
    // Nusselt vertical tube/plate
    h = 0.943 * Math.pow((rho*rho*g*hvap*k*k*k) / (mu*dT*Math.max(L_m,0.01)), 0.25);
  } else {
    // Nusselt horizontal tube (default for S&T condensers)
    h = 0.725 * Math.pow((rho*rho*g*hvap*k*k*k) / (mu*dT*Math.max(OD_m,0.001)), 0.25);
  }
  return Math.min(Math.max(h, 500), 25000);   // clamp to realistic range
}

// ─── CHEN CORRELATION — FLOW BOILING / EVAPORATING ──────────────────────────
function calcHboiling(fluid, tubeRes_h, tubeRes_Re, quality, fluidVapour, P_op_bar, q_flux) {
  // Chen (1966) two-phase forced-convection boiling correlation
  // h_tp = F × h_L + S × h_nb
  //
  // F = two-phase enhancement factor (function of Martinelli parameter Xtt)
  // S = boiling suppression factor (function of two-phase Re)
  // h_L = liquid-phase forced convection HTC (Dittus-Boelter)
  // h_nb = Forster-Zuber nucleate pool boiling HTC
  //
  // quality x defaults to 0.5 (mid-evaporation) when not supplied — this is
  // a single-point approximation. For a rigorous zone-by-zone model,
  // call with actual local quality.
  const x = Math.max(0.01, Math.min(0.99, parseFloat(quality) || 0.50));

  // ── Martinelli parameter Xtt ─────────────────────────────────────────────
  // Xtt = ((1-x)/x)^0.9 × (ρ_g/ρ_l)^0.5 × (μ_l/μ_g)^0.1
  // Use supplied vapour fluid properties; fall back to steam defaults if missing
  const rho_l  = fluid.rho;
  const mu_l   = fluid.mu * 1e-3;          // Pa·s liquid
  const rho_g  = (fluidVapour?.rho) || 0.598;  // vapour density kg/m³ (steam default)
  const mu_g   = (fluidVapour?.mu  || 0.012) * 1e-3; // vapour viscosity Pa·s
  const Xtt    = Math.pow((1-x)/x, 0.9) * Math.pow(rho_g/rho_l, 0.5) * Math.pow(mu_l/mu_g, 0.1);

  // ── Enhancement factor F(Xtt) ─────────────────────────────────────────────
  // Chen (1966) / Collier & Thome (1994) Eq 10.20:
  //   F = 1                                for 1/Xtt ≤ 0.1  (nearly pure LIQUID)
  //   F = 2.35·(1/Xtt + 0.213)^0.736       for 1/Xtt > 0.1
  // FIX (validation suite 2026-07, Tier-2 check 2.4): the branch was inverted —
  // it returned F=1 for Xtt ≤ 0.1 (HIGH quality), exactly where enhancement is
  // strongest, making h_tp DECREASE with quality. Correct condition is Xtt ≥ 10.
  let F;
  if (Xtt >= 10) {
    F = 1.0;                                             // nearly pure liquid limit
  } else {
    F = 2.35 * Math.pow(1/Xtt + 0.213, 0.736);
    F = Math.max(1.0, F);
  }

  // ── Two-phase Reynolds Re_tp ──────────────────────────────────────────────
  // Re_tp = Re_L × F^1.25  (Chen 1966, Eq 9)
  const Re_tp = Math.max(tubeRes_Re, 1) * Math.pow(F, 1.25);

  // ── Suppression factor S(Re_tp) ───────────────────────────────────────────
  // S = 1 / (1 + 2.53×10⁻⁶ × Re_tp^1.17)   (Chen 1966)
  const S = 1.0 / (1.0 + 2.53e-6 * Math.pow(Re_tp, 1.17));

  // ── Liquid-phase forced convection h_L ───────────────────────────────────
  // Already computed and passed as tubeRes_h
  const h_L = tubeRes_h;

  // ── Forster-Zuber nucleate boiling h_nb ──────────────────────────────────
  // FZ: h_nb = 0.00122 × (k_l^0.79 × cp_l^0.45 × ρ_l^0.49) /
  //            (σ^0.5 × μ_l^0.29 × hvap^0.24 × ρ_g^0.24)
  //            × ΔT_sat^0.24 × ΔP_sat^0.75
  //
  // Wall superheat ΔT_sat and ΔP_sat are not available in this simplified
  // single-call context. Use the Kandlikar (1990) simplified form which
  // eliminates the need for ΔT_sat by folding it into a Boiling number:
  //   h_nb_simplified = C × k_l × Re_L^0.6 × Pr_l^0.4 / D_h
  // where C ≈ 0.0012 for convective-dominant regime
  // This gives a reasonable order-of-magnitude estimate without ΔT_sat.
  const cp_l   = fluid.cp * 1000;     // J/kgK
  const k_l    = fluid.k;             // W/mK
  const Pr_l   = Math.max(mu_l * cp_l / k_l, 0.5);
  // Nucleate boiling contribution estimate — Cooper (1984) reduced-pressure form
  // h_nb = 55 × Pr^0.12 × (-log10(Pr))^(-0.55) × M^(-0.5) × q_flux^0.67
  // Without q_flux, use a representative value for process heat exchangers:
  // q_flux_ref ≈ 20,000 W/m² (typical for water/steam at moderate conditions)
  const hvap_J  = (fluid.hvap || 2257) * 1000;   // J/kg
  const Tsat_K  = (fluid.Tsat || 100) + 273.15;  // K
  // FIX (audit 2026-07): previously hard-coded to steam (Pcrit=220.6 bar,
  // M=18.02, Pred at 1.013 bar) for ALL fluids. Now uses the actual fluid's
  // critical pressure, molecular weight and the actual operating pressure.
  // For ammonia at 4 bar: Pred = 4/113.5 = 0.035 (was 0.0046) → h_nb ≈ 1.9×
  // the old value; for refrigerants the correction is larger still.
  const Pcrit   = fluid.Pc || fluidVapour?.Pc || 220.6;   // bar
  const M_fluid = fluid.MW || fluidVapour?.MW || 18.02;
  const Pred    = Math.max(0.001, Math.min(0.9, (parseFloat(P_op_bar) || 1.01325) / Pcrit));
  // UPGRADE (2026-07): q_ref is now the LOCAL heat flux when supplied by the
  // zone-marching model (q = U·ΔT computed per increment and iterated),
  // replacing the fixed 20 kW/m² single-point assumption.
  const q_ref   = Math.max(parseFloat(q_flux) || 20000, 1000);  // W/m²
  const h_nb    = 55 * Math.pow(Pred, 0.12) *
                  Math.pow(-Math.log10(Pred), -0.55) *
                  Math.pow(M_fluid, -0.5) *
                  Math.pow(q_ref, 0.67);

  const h_tp = F * h_L + S * h_nb;
  return Math.max(h_tp, h_L);   // two-phase h always ≥ liquid-phase h
}

// ─── COOPER (1984) NUCLEATE POOL BOILING — standalone ───────────────────────
// Exposed separately so the validation suite can check it against the
// literature equation directly, and so Gungor-Winterton can reuse it.
function calcCooperNB(Pred, MW, q_flux) {
  const Pr = Math.max(0.001, Math.min(0.9, Pred));
  const q  = Math.max(q_flux || 20000, 1000);
  return 55 * Math.pow(Pr, 0.12) * Math.pow(-Math.log10(Pr), -0.55) *
         Math.pow(MW || 18.02, -0.5) * Math.pow(q, 0.67);
}

// ─── GUNGOR-WINTERTON (1986) FLOW BOILING (upgrade 2026-07, "route to 7") ───
// h_tp = E·h_l + S·h_pool           [Gungor & Winterton, IJHMT 29 (1986) 351]
//   E   = 1 + 24000·Bo^1.16 + 1.37·(1/Xtt)^0.86
//   S   = 1 / (1 + 1.15×10⁻⁶·E²·Re_l^1.17)
//   h_l = Dittus-Boelter on the LIQUID FRACTION:  Re_l = G(1−x)·D/μ_l
//   Bo  = q / (G·h_fg)   (boiling number — couples h to local heat flux)
//   h_pool = Cooper(1984) at local q and reduced pressure
// Horizontal-tube stratification correction when Fr_l < 0.05 (G-W 1986):
//   E ×= Fr^(0.1−2Fr),  S ×= √Fr
// Post-dryout: G-W is not valid beyond dryout. For x > 0.85 we blend linearly
// to vapour-only Dittus-Boelter at x = 1 and FLAG it — a mist-flow model
// (Groeneveld) is out of scope at this fidelity.
// Validated (original paper) against 3693 data points, mean dev ~21%.
function calcHboilingGW(liq, vap, x, G, D, q_flux, P_op_bar, orientation = 'horizontal') {
  const x_ = Math.max(0.01, Math.min(0.99, x));
  const mu_l = liq.mu * 1e-3, mu_g = (vap?.mu || 0.012) * 1e-3;
  const rho_l = liq.rho, rho_g = vap?.rho || 0.6;
  const k_l = liq.k, cp_l = liq.cp * 1000;
  const hfg = (liq.hvap || vap?.hvap || 2257) * 1000;                 // J/kg
  const Pr_l = Math.max(mu_l * cp_l / k_l, 0.5);
  const Re_l = Math.max(G * (1 - x_) * D / mu_l, 100);
  const h_l  = 0.023 * Math.pow(Re_l, 0.8) * Math.pow(Pr_l, 0.4) * k_l / D;
  const Xtt  = Math.pow((1 - x_) / x_, 0.9) * Math.pow(rho_g / rho_l, 0.5) * Math.pow(mu_l / mu_g, 0.1);
  const Bo   = Math.max(q_flux || 20000, 1000) / (G * hfg);
  let E = 1 + 24000 * Math.pow(Bo, 1.16) + 1.37 * Math.pow(1 / Xtt, 0.86);
  const Pcrit = liq.Pc || vap?.Pc || 220.6;
  const h_pool = calcCooperNB((P_op_bar || 1.01325) / Pcrit, liq.MW || vap?.MW, q_flux);
  let S = 1 / (1 + 1.15e-6 * E * E * Math.pow(Re_l, 1.17));
  let frCorrected = false;
  if (orientation === 'horizontal') {
    const Fr_l = G * G / (rho_l * rho_l * 9.81 * D);
    if (Fr_l < 0.05) { E *= Math.pow(Fr_l, 0.1 - 2 * Fr_l); S *= Math.sqrt(Fr_l); frCorrected = true; }
  }
  let h_tp = E * h_l + S * h_pool;
  // Post-dryout blend (flagged by caller via .dryoutBlend)
  let dryoutBlend = false;
  if (x_ > 0.85) {
    const Re_g = Math.max(G * D / mu_g, 100);
    const Pr_g = Math.max(mu_g * (vap?.cp || 2) * 1000 / (vap?.k || 0.03), 0.5);
    const h_vap = 0.023 * Math.pow(Re_g, 0.8) * Math.pow(Pr_g, 0.4) * (vap?.k || 0.03) / D;
    const w = (x_ - 0.85) / 0.15;
    h_tp = (1 - w) * h_tp + w * h_vap;
    dryoutBlend = true;
  }
  return { h: Math.max(h_tp, h_l * 0.5), E: +E.toFixed(2), S: +S.toFixed(4), Bo, Xtt,
           h_l: +h_l.toFixed(0), h_pool: +h_pool.toFixed(0), Re_l, frCorrected, dryoutBlend };
}

// ─── SHELL-SIDE BUNDLE CONDENSATION (upgrade 2026-07, "route to 7") ─────────
// Single-tube Nusselt over-predicts a BUNDLE: condensate from upper rows
// drains onto lower rows (inundation). And at high vapour velocity the film
// is shear-thinned, RAISING h. Both effects now modelled:
//   Gravity term:  h_grav = h_Nusselt(1 tube) × N_r^(−1/6)     [Kern 1958]
//   Shear term:    h_sh   = 1.26·(1/Xtt)^0.78 · h_l(crossflow) [McNaught 1982]
//   Combined:      h = (h_grav² + h_sh²)^½
// Regime labelled with the Breber dimensionless vapour velocity:
//   Jg* = x·G / √(g·D·ρ_g·(ρ_l−ρ_g));  Jg*>1.5 shear / <0.5 gravity / else mixed
function calcHcondenseBundle(liq, vap, x, G_shell, OD, Nrows, h_l_crossflow, Twall, L_m) {
  const rho_l = liq.rho, rho_g = Math.max(vap?.rho || 0.6, 1e-3);
  const mu_l = liq.mu * 1e-3, mu_g = (vap?.mu || 0.012) * 1e-3;
  const h_1tube = calcHcondense(liq, Twall, OD, L_m, 'horizontal');
  const h_grav  = h_1tube * Math.pow(Math.max(Nrows, 1), -1/6);
  const x_ = Math.max(0.02, Math.min(0.98, x));
  const Xtt = Math.pow((1 - x_) / x_, 0.9) * Math.pow(rho_g / rho_l, 0.5) * Math.pow(mu_l / mu_g, 0.1);
  const h_sh = 1.26 * Math.pow(1 / Xtt, 0.78) * Math.max(h_l_crossflow, 1);
  const Jg = x_ * G_shell / Math.sqrt(9.81 * OD * rho_g * Math.max(rho_l - rho_g, 1));
  const regime = Jg > 1.5 ? 'shear' : Jg < 0.5 ? 'gravity' : 'mixed';
  return { h: Math.sqrt(h_grav * h_grav + h_sh * h_sh), h_grav: +h_grav.toFixed(0),
           h_sh: +h_sh.toFixed(0), Jg: +Jg.toFixed(3), regime, Nrows };
}


// ─── GUNGOR-WINTERTON FLOW BOILING (upgrade v7, 2026-07) ────────────────────
// Gungor & Winterton (1987, simplified form) — validated against ~3700 data
// points in the original paper; generally tighter than Chen for in-tube
// saturated flow boiling:
//     h_tp = E · h_L
//     E    = 1 + 3000·Bo^0.86 + 1.12·(x/(1−x))^0.75·(ρ_l/ρ_g)^0.41
//     h_L  = 0.023·Re_L^0.8·Pr_l^0.4·(k_l/D),  Re_L = G(1−x)·D/μ_l
//     Bo   = q / (G·h_fg)          [boiling number — needs LOCAL heat flux]
// DRYOUT: the correlation is for wetted-wall boiling. Above x_do = 0.8 the
// wall progressively dries; h is blended linearly to vapour-only
// Dittus-Boelter at x = 0.95. This is a screening treatment of the
// post-dryout region, clearly flagged — not a mist-flow model.
function calcHboilGW(liq, vap, G_kgm2s, D_m, x, q_Wm2, hvap_kJkg) {
  const x_c = Math.max(0.01, Math.min(x, 0.99));
  const mu_l = liq.mu * 1e-3, k_l = liq.k, cp_l = liq.cp * 1000;
  const Pr_l = Math.max(mu_l * cp_l / k_l, 0.5);
  const hfg  = Math.max(hvap_kJkg, 1) * 1000;                 // J/kg
  const hOf = (xq) => {                                        // wetted-wall h at quality xq
    const Re_L = Math.max(G_kgm2s * (1 - xq) * D_m / mu_l, 100);
    const h_L  = 0.023 * Math.pow(Re_L, 0.8) * Math.pow(Pr_l, 0.4) * k_l / D_m;
    const Bo   = Math.max(q_Wm2, 500) / (G_kgm2s * hfg);
    const E    = 1 + 3000 * Math.pow(Bo, 0.86)
                   + 1.12 * Math.pow(xq / (1 - xq), 0.75)
                   * Math.pow(liq.rho / Math.max(vap.rho, 1e-3), 0.41);
    return E * h_L;
  };
  const X_DO = 0.80, X_DRY = 0.95;
  if (x_c <= X_DO) return { h: hOf(x_c), regime: 'wet-wall (G-W)' };
  // vapour-only Dittus-Boelter
  const mu_g = vap.mu * 1e-3, Pr_g = Math.max(mu_g * vap.cp * 1000 / vap.k, 0.5);
  const Re_g = Math.max(G_kgm2s * D_m / mu_g, 100);
  const h_v  = 0.023 * Math.pow(Re_g, 0.8) * Math.pow(Pr_g, 0.4) * vap.k / D_m;
  if (x_c >= X_DRY) return { h: h_v, regime: 'post-dryout (vapour DB)' };
  const w = (x_c - X_DO) / (X_DRY - X_DO);
  return { h: (1 - w) * hOf(X_DO) + w * h_v, regime: `dryout blend (x=${x_c.toFixed(2)})` };
}

// ─── BELL-DELAWARE SHELL-SIDE ────────────────────────────────────────────────
// ── LEAKAGE / BYPASS GEOMETRY (upgrade 2026-07) ─────────────────────────────
// Computes the actual leakage and bypass stream areas from TEMA diametral
// clearances instead of the previous per-class constants. Shared by the HTC
// (Jl, Jb) and pressure-drop (Rl, Rb) functions so both use identical geometry.
//
//   δ_tb  tube-to-baffle-hole diametral clearance — TEMA RCB-4.2:
//         0.4 mm (1/64") for OD ≤ 31.75 mm and unsupported span ≤ 914 mm,
//         else 0.8 mm (1/32").
//   δ_sb  shell-to-baffle diametral clearance — linear fit of the TEMA
//         RCB-4.3 table: δ_sb ≈ 1.6 + 0.004·Ds  [mm]  (HEDH / Taborek).
//   L_bb  bundle-to-shell diametral gap (bypass lane), by rear-head type
//         (Taborek HEDH chart fits):
//           fixed tubesheet / U-tube : 12 + 0.005·Ds  [mm]
//           split-ring floating head : 35 + 0.005·Ds  [mm]
//           pull-through floating    : 95 + 0.005·Ds  [mm]
function bdLeakGeometry(shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, nTubes, headType='fixed') {
  const Ds_mm = shellID_m * 1000;
  const PT    = pitch_ratio * OD_m;
  const bsp   = bsp_ratio * shellID_m;
  const Sm    = bsp_ratio * shellID_m * (PT - OD_m) / PT;          // crossflow area m²
  // Clearances
  const d_tb  = (OD_m <= 0.03175 && bsp <= 0.914) ? 0.0004 : 0.0008;  // m diametral
  const d_sb  = (1.6 + 0.004 * Ds_mm) / 1000;                          // m diametral
  const L_bb  = ((headType === 'pull-through' ? 95 : headType === 'split-ring' ? 35 : 12)
                 + 0.005 * Ds_mm) / 1000;                              // m diametral
  // Window geometry
  const theta_ds = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 2 * bcut_frac))); // baffle window angle
  const F_w      = (theta_ds - Math.sin(theta_ds)) / (2 * Math.PI);   // fraction of tubes in one window
  // Leakage areas (Bell-Delaware / HEDH definitions)
  const S_tb = Math.PI * OD_m * (d_tb / 2) * nTubes * (1 - F_w);      // tube-baffle leakage
  const S_sb = Math.PI * shellID_m * (d_sb / 2) * (1 - theta_ds / (2 * Math.PI)); // shell-baffle leakage
  const r_s  = S_sb / Math.max(S_sb + S_tb, 1e-9);
  const r_lm = Math.min((S_sb + S_tb) / Math.max(Sm, 1e-9), 0.8);
  // Bypass stream
  const S_b   = bsp * L_bb;                                            // bypass lane area
  const F_sbp = Math.min(S_b / Math.max(Sm, 1e-9), 0.7);
  // Tube rows crossed per baffle (needed for sealing-strip ratio)
  const Nc   = Math.max(1, shellID_m * (1 - 2 * bcut_frac) / PT);
  return { Sm, S_tb, S_sb, r_s, r_lm, S_b, F_sbp, Nc, F_w, theta_ds, d_tb, d_sb, L_bb };
}


function calcBellDelaware(fluid, massFlowKgS, shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, L_m, nTubes, tema='C', pitchLayout='triangular') {
  const {rho, mu:mu_mPas, cp, k} = fluid;
  const mu = mu_mPas*1e-3;
  const PT = pitch_ratio*OD_m;
  const bsp = bsp_ratio*shellID_m;
  // ── Crossflow area Sm (Bell-Delaware method) ────────────────────────────
  // Correct formula depends on tube layout:
  //   Triangular: Sm = bsp × [shellID × (1 - OD/PT)]           ← most conservative
  //   Square:     Sm = bsp × [shellID - OD + (PT-OD)/PT × OD]  ← slightly larger
  // Both reduce to the same limit at PT→OD but differ at large pitch.
  // Reference: HEDH Section 3.2.2-8, Eq 3.2.2-19
  let Sm;
  if (pitchLayout === 'square' || pitchLayout === 'rotated-square') {
    // Square pitch: Sm = bsp × (shellID - nTubesAtCL × OD + (nTubesAtCL-1) × (PT-OD))
    // Simplified (continuous tube field approximation):
    Sm = bsp_ratio * shellID_m * (PT - OD_m) / PT;   // same formula numerically
    // For square: the free-flow area is slightly larger because the diagonal path
    // is longer. Correction factor ≈ 1.0 to 1.05 — use 1.02 for square, 1.04 for rotated-square.
    Sm = Sm * (pitchLayout === 'rotated-square' ? 1.04 : 1.02);
  } else {
    // Triangular (default)
    Sm = bsp_ratio * shellID_m * (PT - OD_m) / PT;
  }
  const G_s = massFlowKgS/Math.max(Sm,1e-6);
  const Re_s = G_s*OD_m/mu;
  const Pr_s = Math.max(mu*cp*1000/k, 0.5);
  let a, b;
  if (Re_s < 100) {a=1.40;b=0.667;} else if (Re_s<1000) {a=0.560;b=0.500;} else if (Re_s<10000) {a=0.350;b=0.600;} else {a=0.370;b=0.600;}
  const jh = a*Math.pow(Math.max(Re_s,1), b-1);
  const Nu_s = jh*Re_s*Math.pow(Pr_s,0.333);
  const h_ideal = Nu_s*k/OD_m;
  // ── Jc FIX (upgrade 2026-07): the published correlation is
  //      Jc = 0.55 + 0.72·Fc,   Fc = fraction of tubes in pure crossflow = 1 − 2·F_w
  // The previous code fed the BAFFLE-CUT fraction (0.25) where Fc (≈0.61 at a
  // 25% cut) belongs, giving Jc = 0.62 instead of ≈0.99 — under-predicting the
  // shell HTC by ~35-40% across the board.
  const headType = arguments.length > 11 && arguments[11] ? arguments[11] : 'fixed';
  const Nss      = 0;  // sealing strip pairs (0 = conservative; expose later if needed)
  const gLeak = bdLeakGeometry(shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, nTubes, headType);
  const Fc = Math.max(0, Math.min(1, 1 - 2 * gLeak.F_w));
  const Jc = Math.max(0.52, Math.min(1.15, 0.55 + 0.72 * Fc));
  // ── UPGRADE (2026-07): published Bell-Delaware Jl and Jb from ACTUAL
  // TEMA diametral clearances (see bdLeakGeometry) — replaces the previous
  // per-class constants which gave only a coarse ±10-15% approximation.
  // (gLeak/headType/Nss declared above with the Jc fix.)
  // Jl — Taborek/HEDH:  Jl = 0.44(1−r_s) + [1 − 0.44(1−r_s)]·exp(−2.2·r_lm)
  const Jl = Math.max(0.40, 0.44*(1 - gLeak.r_s) + (1 - 0.44*(1 - gLeak.r_s)) * Math.exp(-2.2 * gLeak.r_lm));
  // Jb — Taborek/HEDH:  Jb = exp(−C_j·F_sbp·(1 − (2·r_ss)^⅓)),  Jb = 1 if r_ss ≥ ½
  const r_ss = Nss / Math.max(gLeak.Nc, 1);
  const C_j  = Re_s < 100 ? 1.35 : 1.25;
  const Jb   = r_ss >= 0.5 ? 1.0
             : Math.max(0.40, Math.exp(-C_j * gLeak.F_sbp * (1 - Math.cbrt(Math.max(2 * r_ss, 0)))));
  const Jr = Re_s<100 ? Math.max(0.4, 0.8-0.003*Re_s) : 1.0;
  const Js = 1.0;
  // NOTE (audit 2026-07): the viscosity-gradient correction Jμ = (μ_b/μ_w)^0.14
  // is deliberately NOT applied here. calcShellTube's U-convergence loop already
  // multiplies hShell by phi_h = (μ_bulk/μ_wall)^0.14 using the wall-temperature
  // viscosity from fluidAtConditions. Adding Jμ inside this function as well
  // would DOUBLE-apply the correction. Do not "fix" this.
  const Jtotal = Math.max(0.30, Jc*Jl*Jb*Jr*Js);
  const hShell = h_ideal*Jtotal;
  const nBaffles = Math.max(1, Math.round(L_m/Math.max(bsp,0.001)-1));
  const shellVel = G_s/rho;
  return {hShell, hTube:0, Jc, Jl, Jb, Jr, Js, Jtotal, jh, shellVel, shellRe:Re_s, nBaffles,
          leakGeom:gLeak, r_ss};
}

// ─── PRESSURE DROP TUBE ───────────────────────────────────────────────────────
function calcPressDropTube(fluid, massFlowKgS, Di_m, L_m, nPasses, nozzle_id_m) {
  const {rho, mu:mu_mPas} = fluid;
  const mu = mu_mPas*1e-3;
  const A   = Math.PI*Di_m*Di_m/4;
  const vel = massFlowKgS/(rho*Math.max(A,1e-8));
  const Re  = rho*vel*Di_m/mu;
  const f   = Re<2300 ? 64/Math.max(Re,1) : Math.pow(0.790*Math.log(Math.max(Re,10))-1.64,-2);
  const dyn = rho*vel*vel/2;

  const dP_friction   = f*(L_m*nPasses/Di_m)*dyn;
  const dP_entry_exit = 1.5*nPasses*dyn;
  const dP_returns    = 1.5*Math.max(nPasses-1,0)*dyn;

  // Nozzle ΔP: use actual nozzle velocity when nozzle_id_m is supplied,
  // otherwise estimate from typical inlet/outlet nozzle area = 0.20 × (total tube bundle area).
  // Entry loss coefficient = 0.5 (inlet) + 1.0 (exit kinetic energy recovery) = 1.5 per nozzle pair.
  let dP_nozzle;
  if (nozzle_id_m && nozzle_id_m > 0) {
    const A_noz = Math.PI * nozzle_id_m * nozzle_id_m / 4;
    const v_noz = massFlowKgS / (rho * Math.max(A_noz, 1e-8));
    dP_nozzle   = 1.5 * rho * v_noz * v_noz / 2;   // inlet + outlet nozzle pair
  } else {
    // Default: nozzle ΔP ≈ 2× tube velocity heads (both nozzles combined)
    // This is conservative for standard nozzle sizing (v_nozzle ≈ v_tube for typical designs)
    dP_nozzle = 2.0 * dyn;
  }

  return Math.max((dP_friction+dP_entry_exit+dP_returns+dP_nozzle)/1e5, 0);
}

// ─── BELL-DELAWARE 4-TERM SHELL-SIDE PRESSURE DROP ───────────────────────────
// BUG FIX: Previous version used nTubes (total tube count) as the crossflow
// multiplier. This is WRONG. The correct Bell-Delaware formula uses:
//   Nc = number of tube ROWS crossed per baffle window
//      = shellID × (1 − 2×bcut_frac) / (pitch_ratio × OD)
// For a 152mm shell with 14 tubes, Nc ≈ 2.4 rows, NOT 14 tubes.
// Using nTubes gave up to 119× overestimate for steam/gas service.
function calcBellDelawareDP(fluid, massFlowKgS, shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, L_m, nTubes, bdHtcResult) {
  const {rho, mu: mu_mPas} = fluid;
  const mu = mu_mPas * 1e-3;
  const PT = pitch_ratio * OD_m;
  const bsp = bsp_ratio * shellID_m;                      // baffle spacing (m)
  const nBaffles = bdHtcResult ? bdHtcResult.nBaffles : Math.max(1, Math.round(L_m / Math.max(bsp, 0.001) - 1));
  const Sm = bsp_ratio * shellID_m * (PT - OD_m) / PT;    // crossflow area (m²)

  // ── CORRECT Nc: tube rows crossed per baffle ─────────────────────────────
  const Nc = Math.max(1, shellID_m * (1 - 2 * bcut_frac) / (pitch_ratio * OD_m));

  // ── Crossflow ΔP per baffle space ────────────────────────────────────────
  const G_s  = massFlowKgS / Math.max(Sm, 1e-6);
  const Re_s = G_s * OD_m / mu;
  let f_s;
  if      (Re_s < 10)   f_s = 14.0  * Math.pow(Re_s, -0.20);
  else if (Re_s < 100)  f_s = 7.0   * Math.pow(Re_s, -0.20);
  else if (Re_s < 1e3)  f_s = 0.72  * Math.pow(Re_s, -0.05);
  else if (Re_s < 1e4)  f_s = 0.35;
  else                   f_s = 0.20  * Math.pow(Re_s, -0.02);

  // dP_cf uses Nc (tube rows) not nTubes (total bundle count)
  const dP_cf_one = f_s * Nc * G_s * G_s / (2 * rho);    // Pa per baffle gap

  // ── Window zone ΔP ───────────────────────────────────────────────────────
  const theta_bc = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 2 * bcut_frac)));
  const A_window = (shellID_m * shellID_m / 4) * (theta_bc - Math.sin(theta_bc));
  const A_tubes_window = nTubes * bcut_frac * Math.PI * OD_m * OD_m / 4;
  const A_w_free = Math.max(A_window - A_tubes_window, Sm * 0.1);
  const A_w_geomean = Math.sqrt(Sm * A_w_free);
  const G_w = massFlowKgS / Math.max(A_w_geomean, 1e-6);
  const Nw = Math.max(1, Math.round(Nc * bcut_frac));
  const dP_win_one = (2 + 0.6 * Nw) * G_w * G_w / (2 * rho);

  // ── Bypass and leakage corrections ───────────────────────────────────────
  // UPGRADE (2026-07): published Bell-Delaware forms using the same
  // clearance-based geometry as the HTC function (bdLeakGeometry):
  //   Rl = exp[−1.33·(1 + r_s)·r_lm^p],  p = 0.8 − 0.15·(1 + r_s)
  //   Rb = exp[−C_bp·F_sbp·(1 − (2·r_ss)^⅓)],  C_bp = 4.5 (Re<100) / 3.7
  // Previous version used ad-hoc functions of bsp_ratio only.
  // Always recompute from the shellID actually passed — the gas auto-resize
  // path calls this with a LARGER shell than bdHtcResult was built for.
  const gLeak = bdLeakGeometry(shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, nTubes, 'fixed');
  const r_ss_dp = bdHtcResult?.r_ss || 0;
  const p_exp = 0.8 - 0.15 * (1 + gLeak.r_s);
  const Rl = Math.max(0.10, Math.exp(-1.33 * (1 + gLeak.r_s) * Math.pow(gLeak.r_lm, p_exp)));
  const C_bp = Re_s < 100 ? 4.5 : 3.7;
  const Rb = r_ss_dp >= 0.5 ? 1.0
           : Math.max(0.30, Math.exp(-C_bp * gLeak.F_sbp * (1 - Math.cbrt(Math.max(2 * r_ss_dp, 0)))));

  // ── End-zone factor from actual inlet/outlet baffle spacing ratio ─────────
  // When end baffle spacing equals central spacing, Rze = 1.0 and the end-zone
  // ΔP equals the central crossflow ΔP per baffle.
  // Bell-Delaware: dP_end_one = dP_cf_one × (L_inlet/L_central)^(2-n)
  // where n ≈ 0.2 (turbulent) or 1.0 (laminar).
  // Without user input for L_inlet, assume L_inlet = L_central (common design).
  // The ratio then = 1.0 and end_zone_factor = 1.0 (not 1.3).
  // If b.bsp_inlet is provided, use it; otherwise fall back to bsp.
  const bsp_inlet = parseFloat(bdHtcResult?.bsp_inlet) || bsp;
  const end_ratio  = bsp_inlet / Math.max(bsp, 0.001);
  const n_exp      = Re_s > 1000 ? 0.2 : 1.0;  // turbulent vs laminar
  const end_zone_factor = Math.pow(end_ratio, 2 - n_exp);

  // ── Central and end-zone ΔP ──────────────────────────────────────────────
  const dP_central = (dP_cf_one + dP_win_one) * nBaffles * Rb * Rl;
  const dP_end     = 2 * dP_cf_one * end_zone_factor * Rb;

  const dP_total_Pa = dP_central + dP_end;
  return Math.max(dP_total_Pa / 1e5, 0);  // bar
}

// ─── INPUT VALIDATION HELPER ──────────────────────────────────────────────────
function requireFinite(val, name) {
  if (!isFinite(parseFloat(val))) throw new Error(`Invalid input: ${name} must be a finite number`);
  return parseFloat(val);
}
// ─── UNIT CONVERSION HELPERS (server-side) ───────────────────────────────────
function toSI_temp(val, unitSys) {
  return unitSys === 'imperial' ? (val - 32) * 5 / 9 : val;
}

function toSI_flow(val, unitSys) {
  return unitSys === 'imperial' ? val / 2.20462 : val;
}

function toSI_flowWithUnit(val, flowUnit, fluidKey, T_degC, P_bar) {
  if (!flowUnit || flowUnit === 'kgh') return val;
  const fluid = getFluid(fluidKey);
// FIX (audit 2026-07): Normal conditions (Nm³) are defined at 0°C = 273.15 K
// (DIN 1343 / ISO norm reference), NOT 20°C. Previous code used T_REF_DB=293.15 K,
// under-estimating rho_n (and hence mass flow) by ~6.8%.
// Standard conditions (Sm³) remain 15°C = 288.15 K (ISO 13443).
const rho_n = (fluid.MW || 29) * P_REF_DB * 1e5 / (8314 * 273.15);
const rho_s = (fluid.MW || 29) * P_REF_DB * 1e5 / (8314 * 288.15);
  if (flowUnit === 'nm3h') return val * rho_n;
  if (flowUnit === 'sm3h') return val * rho_s;
  return val;
}

// ─── RESISTANCE BREAKDOWN HELPER ─────────────────────────────────────────────
function calcResistanceBreakdown(hShell, hTube, Rfo, Rfi, Rwall, Ao_Ai) {
  const r_shell = 1 / Math.max(hShell, 0.001);
  const r_tube  = (Ao_Ai || 1) / Math.max(hTube, 0.001);
  const r_fo    = Rfo || 0;
  const r_fi    = (Ao_Ai || 1) * (Rfi || 0);
  const r_w     = Rwall || 0;
  const Rt      = r_shell + r_tube + r_fo + r_fi + r_w;
  if (Rt <= 0) return [];
  const pct = v => parseFloat((v / Rt * 100).toFixed(1));
  return [
    { label: 'Shell-side film', pct: pct(r_shell), color: '#E24B4A' },
    { label: 'Tube-side film',  pct: pct(r_tube),  color: '#378ADD' },
    { label: 'Shell fouling',   pct: pct(r_fo),    color: '#BA7517' },
    { label: 'Tube fouling',    pct: pct(r_fi),    color: '#854F0B' },
    { label: 'Wall conduction', pct: pct(r_w),     color: '#1D9E75' },
  ];
}

// ─── TWO-PHASE / CONDENSING LMTD CORRECTION ─────────────────────────────────
// For condensing/evaporating service the "hot" or "cold" side is isothermal
// (T = Tsat). We compute a zone-weighted LMTD across the condensing region
// using the Chen & Flux weighted method (simplified to isothermal-side LMTD).
function calcLMTD_twophase(hTi, hTo, cTi, cTo, shellMode, arr) {
  // For condensing: hot side is at Tsat (isothermal); cold side sensible
  // For evaporating: cold side is at Tsat (isothermal); hot side sensible
  // In both cases dT1 and dT2 are well-defined; F = 1.0 (no cross-flow penalty
  // because one stream is isothermal → pure countercurrent is always equivalent)
  let dT1, dT2;
  if (shellMode === 'condensing') {
    // Hot side: isothermal at hTi (= hTo = Tsat_hot for condenser shell side)
    // Use the actual terminal temperatures but set F=1.0
    dT1 = hTi - cTo;
    dT2 = hTo - cTi;
  } else if (shellMode === 'evaporating') {
    // Cold side isothermal at cTi (= cTo = Tsat_cold for evaporator tube side)
    dT1 = hTi - cTo;
    dT2 = hTo - cTi;
  } else {
    return calcLMTD(hTi, hTo, cTi, cTo, arr);
  }
  if (dT1 <= 0 || dT2 <= 0) return { lmtd: null, err: 'Temperature cross in two-phase service' };
  const lmtd = Math.abs(dT1 - dT2) < 0.001 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
  if (!isFinite(lmtd) || lmtd <= 0) return { lmtd: null, err: 'LMTD failed (two-phase)' };
  // F = 1.0 for isothermal-side service (one stream at constant temperature
  // → no correction needed regardless of pass arrangement)
  return { lmtd, F: 1.0, dT1, dT2, twophase: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// ZONE-WISE MARCHING MODEL FOR PHASE-CHANGE SERVICES (upgrade 2026-07)
//
// Replaces the single-point U·A·LMTD sizing for condensers and evaporators
// with an incremental model (HTRI-style zone analysis, simplified):
//   • The exchanger is split into thermodynamic zones (desuperheat /
//     condensation / subcool, or preheat / boiling) and the isothermal
//     phase-change zone is further split into quality increments.
//   • In each zone: local fluid properties, local film coefficients, local
//     U and local LMTD → local area A_i = Q_i / (U_i·ΔT_i).  A_req = ΣA_i.
//   • Boiling uses Chen at the LOCAL quality with the LOCAL heat flux
//     (q = U·ΔT iterated per increment) instead of x=0.5 / q=20 kW/m² fixed.
//   • Counter-current temperature mapping: cold-side temperature at each
//     zone boundary derived from cumulative duty.
// Limitations (stated deliberately): film condensation h from Nusselt theory
// (no shear-enhancement), straight quality-linear condensing path, single
// cp linearisation for the coolant boundary mapping. This is a preliminary-
// design zone model, not an HTRI incremental rating.
// ═══════════════════════════════════════════════════════════════════════════
const N_PHASE_INCREMENTS = 8;

function zoneLMTD(Th1, Th2, Tc1, Tc2) {
  // Terminal ΔTs of one zone (counter-current orientation already applied)
  const dT1 = Th1 - Tc1, dT2 = Th2 - Tc2;
  if (dT1 <= 0 || dT2 <= 0) return null;
  return Math.abs(dT1 - dT2) < 1e-3 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
}

function marchCondensingZones(p) {
  // p: {hFlKey,hPop,massH,Tsat,hTi,hTo,hvap_kJkg, cFlKey,cPop,massC,cTi,cTo,
  //     OD,Di,L_eff,nTubesPerPass,shellID,pitch,bcut,bsp,nTubes,tema,pitchLayout,
  //     Rfo,Rfi,Rwall,Ao_Ai}
  const liqKey = LIQUID_OF[p.hFlKey] || p.hFlKey;
  const cpC = fluidAtConditions(p.cFlKey, (p.cTi + p.cTo) / 2, p.cPop).cp; // linearised coolant cp
  const zones = [];
  // Build hot-side zone boundaries from hTi → hTo
  if (p.hTi > p.Tsat + 0.1) {
    const Qd = p.massH * fluidAtConditions(p.hFlKey, (p.hTi + p.Tsat) / 2, p.hPop).cp * (p.hTi - p.Tsat);
    zones.push({ name: 'Desuperheat', kind: 'vap', Th1: p.hTi, Th2: p.Tsat, Q: Qd });
  }
  const Qlat = p.massH * p.hvap_kJkg;
  for (let i = 0; i < N_PHASE_INCREMENTS; i++) {
    zones.push({ name: `Condense x=${(1 - i / N_PHASE_INCREMENTS).toFixed(2)}→${(1 - (i + 1) / N_PHASE_INCREMENTS).toFixed(2)}`,
                 kind: 'cond', Th1: p.Tsat, Th2: p.Tsat, Q: Qlat / N_PHASE_INCREMENTS,
                 xm: 1 - (i + 0.5) / N_PHASE_INCREMENTS });
  }
  if (p.hTo < p.Tsat - 0.1) {
    const Qs = p.massH * fluidAtConditions(liqKey, (p.Tsat + p.hTo) / 2, p.hPop).cp * (p.Tsat - p.hTo);
    zones.push({ name: 'Subcool', kind: 'liq', Th1: p.Tsat, Th2: p.hTo, Q: Qs });
  }
  const Qtot = zones.reduce((s, z) => s + z.Q, 0);
  // Counter-current coolant mapping: at the hot-inlet end the coolant is at cTo.
  let Qcum = 0, A_total = 0;
  const out = [];
  for (const z of zones) {
    const Tc1 = p.cTo - Qcum / (p.massC * cpC);
    const Tc2 = p.cTo - (Qcum + z.Q) / (p.massC * cpC);
    const dTm = zoneLMTD(z.Th1, z.Th2, Tc1, Tc2);
    if (!dTm) { Qcum += z.Q; continue; }   // pinched zone — skip, flagged by caller via area deficit
    const TcM = (Tc1 + Tc2) / 2, ThM = (z.Th1 + z.Th2) / 2;
    // Tube-side (coolant) local h
    const cLoc = fluidAtConditions(p.cFlKey, TcM, p.cPop);
    const hT = calcHtube(cLoc, p.massC / p.nTubesPerPass, p.Di, p.L_eff).h;
    // Shell-side local h by zone kind
    let hS, regime = '';
    if (z.kind === 'cond') {
      const liq = fluidAtConditions(liqKey, p.Tsat, p.hPop);
      const liqProps = { rho: liq.rho, mu: liq.mu, k: liq.k, hvap: p.hvap_kJkg, Tsat: p.Tsat };
      // UPGRADE v7 (2026-07): Kern condensate-inundation correction for tube
      // BANKS — h_bank = h_Nusselt(single tube) · N_vert^(−1/6), where N_vert
      // is the tube count in a vertical column (≈0.7·Ds/PT for staggered
      // layouts). Condensate raining from upper rows thickens the film on
      // lower rows; the single-tube value over-predicts by 20-40% on real
      // bundles. Also flags the shear-controlled regime (dimensionless vapour
      // velocity J*g > 1) where gravity-film correlations under-predict —
      // conservative, but noted per zone.
      const N_vert = Math.max(1, Math.round(0.7 * p.shellID / (p.pitch * p.OD)));
      // UPGRADE v7b (2026-07): shear term now MODELLED, not just flagged.
      // calcHcondenseBundle combines Kern gravity-film (×N^−1/6 inundation)
      // with the McNaught (1982) shear term h_sh = 1.26·(1/Xtt)^0.78·h_l,
      // h = √(h_grav² + h_sh²); Breber J*g labels the governing regime.
      const vapB = fluidAtConditions(VAPOUR_OF[liqKey] || p.hFlKey, p.Tsat, p.hPop);
      const gLkC = bdLeakGeometry(p.shellID, p.OD, p.pitch, p.bcut, p.bsp, p.nTubes, 'fixed');
      const G_shC = p.massH / Math.max(gLkC.Sm, 1e-6);
      const h_l_cf = calcBellDelaware(liq, Math.max(p.massH * (1 - (z.xm ?? 0.5)), 0.02 * p.massH),
                     p.shellID, p.OD, p.pitch, p.bcut, p.bsp, p.L_eff, p.nTubes, p.tema, p.pitchLayout).hShell;
      let Twall = (p.Tsat + TcM) / 2, U_i = 800, bres = null;
      for (let it = 0; it < 3; it++) {
        bres = calcHcondenseBundle(liqProps, vapB, z.xm ?? 0.5, G_shC, p.OD, N_vert, h_l_cf, Twall, p.L_eff);
        hS = bres.h;
        U_i = 1 / (1 / hS + p.Rfo + p.Ao_Ai / hT + p.Ao_Ai * p.Rfi + p.Rwall);
        Twall = p.Tsat - (p.Tsat - TcM) * (U_i / hS);
      }
      regime = `${bres.regime} (J*g=${bres.Jg}; grav ${bres.h_grav}×N${N_vert}⁻¹ᐟ⁶ ⊕ shear ${bres.h_sh})`;
    } else {
      const key = z.kind === 'vap' ? p.hFlKey : liqKey;
      const sLoc = fluidAtConditions(key, ThM, p.hPop);
      hS = calcBellDelaware(sLoc, p.massH, p.shellID, p.OD, p.pitch, p.bcut, p.bsp,
                            p.L_eff, p.nTubes, p.tema, p.pitchLayout).hShell;
      regime = z.kind === 'vap' ? 'single-phase vapour crossflow' : 'single-phase liquid crossflow';
    }
    const U_i = 1 / (1 / hS + p.Rfo + p.Ao_Ai / hT + p.Ao_Ai * p.Rfi + p.Rwall);
    const A_i = z.Q * 1000 / (U_i * dTm);
    A_total += A_i;
    out.push({ zone: z.name, Q_kW: +z.Q.toFixed(1), U: +U_i.toFixed(0), LMTD: +dTm.toFixed(2), A_m2: +A_i.toFixed(2), regime });
    Qcum += z.Q;
  }
  out.forEach(z => z.A_pct = +(z.A_m2 / A_total * 100).toFixed(1));
  return { A_total, zones: out, Qtot, mode: 'condensing' };
}

function marchEvaporatingZones(p) {
  // p adds: hvap_kJkg (cold fluid), Tsat (cold), hFluid props via hFlKey/hPop
  const vapKeyRaw = VAPOUR_OF[p.cFlKey] || p.cFlKey.replace('-liquid', '-gas');
  const vapKey = FP[vapKeyRaw] ? vapKeyRaw : 'steam';
  const cpH = fluidAtConditions(p.hFlKey, (p.hTi + p.hTo) / 2, p.hPop).cp;
  const cLiq = fluidAtConditions(p.cFlKey, p.Tsat, p.cPop);
  const Q_preheat = p.cTi < p.Tsat - 0.1 ? p.massC * cLiq.cp * (p.Tsat - p.cTi) : 0;
  const Q_boil = Math.max(p.Qhot - Q_preheat, 0);
  const x_exit = Math.min(Q_boil / Math.max(p.massC * p.hvap_kJkg, 1e-6), 1.0);
  const dryout = Q_boil > p.massC * p.hvap_kJkg * 0.999;
  const zones = [];
  // Order along the HOT path (hot inlet first). Counter-current: boiling exit
  // (highest quality) sits at the hot-inlet end, preheat at the hot-outlet end.
  for (let i = 0; i < N_PHASE_INCREMENTS; i++) {
    const x1 = x_exit * (1 - i / N_PHASE_INCREMENTS);
    const x2 = x_exit * (1 - (i + 1) / N_PHASE_INCREMENTS);
    zones.push({ name: `Boil x=${x2.toFixed(2)}→${x1.toFixed(2)}`, kind: 'boil',
                 Q: Q_boil / N_PHASE_INCREMENTS, xm: (x1 + x2) / 2 });
  }
  if (Q_preheat > 0) zones.push({ name: 'Preheat (subcooled)', kind: 'preheat', Q: Q_preheat });
  let Qcum = 0, A_total = 0;
  const out = [];
  const cVap = fluidAtConditions(vapKey, p.Tsat, p.cPop);
  for (const z of zones) {
    const Th1 = p.hTi - Qcum / (p.massH * cpH);
    const Th2 = p.hTi - (Qcum + z.Q) / (p.massH * cpH);
    let Tc1, Tc2;
    if (z.kind === 'boil') { Tc1 = p.Tsat; Tc2 = p.Tsat; }
    else { Tc1 = p.Tsat; Tc2 = p.cTi; }   // preheat zone, counter-current
    const dTm = zoneLMTD(Th1, Th2, Tc1, Tc2);
    if (!dTm) { Qcum += z.Q; continue; }
    const ThM = (Th1 + Th2) / 2;
    // Shell-side hot local h
    const sLoc = fluidAtConditions(p.hFlKey, ThM, p.hPop);
    const hS = calcBellDelaware(sLoc, p.massH, p.shellID, p.OD, p.pitch, p.bcut, p.bsp,
                                p.L_eff, p.nTubes, p.tema, p.pitchLayout).hShell;
    // Tube-side cold local h
    const cLoc = fluidAtConditions(p.cFlKey, z.kind === 'boil' ? p.Tsat : (p.cTi + p.Tsat) / 2, p.cPop);
    const tubeRes = calcHtube(cLoc, p.massC / p.nTubesPerPass, p.Di, p.L_eff);
    let hT = tubeRes.h, U_i = 800, regime = '';
    if (z.kind === 'boil') {
      // UPGRADE v7 (2026-07): Gungor-Winterton (1987) at LOCAL quality and
      // LOCAL heat flux (q = U·ΔT iterated), with dryout blending above
      // x=0.8. Chen remains available via boilCorr:'chen'.
      const G_tube = (p.massC / p.nTubesPerPass) / (Math.PI * p.Di * p.Di / 4);
      let q = 20000;
      for (let it = 0; it < 4; it++) {
        if (p.boilCorr === 'chen') {
          hT = calcHboiling(cLoc, tubeRes.h, tubeRes.Re, Math.max(z.xm, 0.02), cVap, p.cPop, q);
          regime = 'Chen';
        } else {
          const gw = calcHboilingGW(cLoc, cVap, Math.max(z.xm, 0.02), G_tube, p.Di, q, p.cPop, 'horizontal');
          hT = gw.h;
          regime = `Gungor-Winterton (E=${gw.E}, S=${gw.S})`
                 + (gw.frCorrected ? ' +Fr-strat' : '')
                 + (gw.dryoutBlend ? ' ⚠ post-dryout blend' : '');
        }
        U_i = 1 / (1 / hS + p.Rfo + p.Ao_Ai / hT + p.Ao_Ai * p.Rfi + p.Rwall);
        q = Math.max(U_i * dTm, 1000);
      }
    } else {
      U_i = 1 / (1 / hS + p.Rfo + p.Ao_Ai / hT + p.Ao_Ai * p.Rfi + p.Rwall);
      regime = 'single-phase liquid';
    }
    const A_i = z.Q * 1000 / (U_i * dTm);
    A_total += A_i;
    out.push({ zone: z.name, Q_kW: +z.Q.toFixed(1), U: +U_i.toFixed(0), LMTD: +dTm.toFixed(2), A_m2: +A_i.toFixed(2), regime });
    Qcum += z.Q;
  }
  out.forEach(z => z.A_pct = +(z.A_m2 / A_total * 100).toFixed(1));
  return { A_total, zones: out, Qtot: p.Qhot, x_exit, Q_preheat, dryout, mode: 'evaporating' };
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW-INDUCED VIBRATION SCREEN (upgrade 2026-07)
//
// Basic TEMA-V-style screening — the checks HTRI performs in full detail:
//   1. Tube fundamental natural frequency (pinned-pinned central span,
//      conservative vs clamped) including tube metal, tube-side fluid, and
//      confined added mass of the shell-side fluid (Blevins).
//   2. Fluidelastic instability — Connors/Pettigrew-Taylor:
//        V_crit = K·f_n·d·√(δ·m_L / (ρ_shell·d²)),  K = 3.0,
//        log decrement δ = 0.10 (liquid) / 0.03 (gas)  [screening values].
//   3. Vortex shedding (St = 0.2) resonance band vs f_n.
//   4. Turbulent buffeting dominant frequency (Owen 1965) vs f_n.
//   5. Acoustic resonance (gas shells only): first transverse mode vs
//      shedding/buffeting frequencies.
// This is a SCREEN — it flags risk for detailed analysis, it does not clear
// a design the way a full HTRI vibration run does.
// ═══════════════════════════════════════════════════════════════════════════
function calcVibrationScreen(p) {
  // p: {matKey, OD, Di, span_m, span_end_m?, shellID, pitch_ratio, massH_kgs,
  //     rhoShell, muShell_mPas, rhoTubeFluid, isGas, T_K, MW}
  const E   = EMAT[p.matKey]   || 200e9;
  const rhoT= RHOMAT[p.matKey] || 7850;
  const I   = Math.PI / 64 * (Math.pow(p.OD, 4) - Math.pow(p.Di, 4));   // m⁴
  // Mass per length: tube metal + tube-side fluid + shell-side added mass
  const m_tube  = rhoT * Math.PI / 4 * (p.OD * p.OD - p.Di * p.Di);
  const m_in    = p.rhoTubeFluid * Math.PI / 4 * p.Di * p.Di;
  const DeOverD = (0.96 + 0.5 * p.pitch_ratio) * p.pitch_ratio;
  const Cm      = (DeOverD * DeOverD + 1) / Math.max(DeOverD * DeOverD - 1, 0.2);
  const m_add   = Cm * p.rhoShell * Math.PI / 4 * p.OD * p.OD;
  const m_L     = m_tube + m_in + m_add;                                 // kg/m
  const logDec  = p.isGas ? 0.03 : 0.10;

  // Crossflow velocity at bundle centreline (central baffle spacing)
  const PT = p.pitch_ratio * p.OD;
  const Sm = p.span_m * p.shellID * (PT - p.OD) / PT;
  const V  = p.massH_kgs / Math.max(Sm * p.rhoShell, 1e-9);              // m/s

  // ── UPGRADE v7 (2026-07): SPAN-BY-SPAN evaluation ─────────────────────────
  // HTRI checks every span; the previous screen checked only the central one.
  //   central — span = baffle spacing, supported at every baffle
  //   end     — inlet/outlet spacing (often larger to clear nozzles)
  //   window  — tubes in the baffle window are supported only at EVERY OTHER
  //             baffle → span = 2×central → f_n ÷ 4. This is where real FEI
  //             failures start, and single-span screens miss it entirely.
  const spanEnd = Math.max(p.span_end_m || p.span_m, p.span_m);
  const spanDefs = [
    { name: 'central',      L: p.span_m },
    { name: 'end zone',     L: spanEnd },
    { name: 'window tubes', L: 2 * p.span_m },
  ];
  const spans = spanDefs.map(s => {
    const f_n = (Math.PI / 2) * Math.sqrt(E * I / m_L) / (s.L * s.L);    // pinned-pinned
    const V_crit = 3.0 * f_n * p.OD * Math.sqrt(logDec * m_L / (p.rhoShell * p.OD * p.OD));
    return { ...s, f_n: +f_n.toFixed(1), V_crit: +V_crit.toFixed(2),
             feiRatio: +(V / Math.max(V_crit, 1e-6)).toFixed(3) };
  });
  const worst = spans.reduce((a, b) => (b.feiRatio > a.feiRatio ? b : a), spans[0]);
  const central = spans[0];

  // ── TEMA maximum unsupported span (RCB-4.52, steel class anchors:
  //    OD 19.05 mm → 1524 mm, OD 25.4 mm → 1880 mm; linear interpolation,
  //    ×0.87 for low-modulus tube materials). Approximate — verify against
  //    the actual TEMA table for final designs.
  const matFac = (p.matKey === 'copper' || p.matKey === 'aluminum' || p.matKey === 'titanium') ? 0.87 : 1.0;
  const L_tema = (56.06 * (p.OD * 1000) + 455.9) / 1000 * matFac;        // m
  const maxSpanUsed = Math.max(...spanDefs.map(s => s.L));
  const temaSpanOK = maxSpanUsed <= L_tema;

  // Excitation frequencies (central-span velocity basis)
  const f_vs = 0.2 * V / p.OD;
  const xT = p.pitch_ratio;
  const f_tb = (V / (xT * xT * p.OD)) * (3.05 * Math.pow(1 - 1 / xT, 2) + 0.28);

  // Acoustic resonance (gas only)
  let f_ac = null, acRisk = false;
  if (p.isGas && p.MW) {
    const c = Math.sqrt(1.3 * 8314 * p.T_K / p.MW);
    f_ac = c / (2 * p.shellID);
    acRisk = (f_vs > 0.8 * f_ac && f_vs < 1.2 * f_ac) || (f_tb > 0.8 * f_ac && f_tb < 1.2 * f_ac);
  }

  // ── UPGRADE v7 (2026-07): shell-inlet ρv² impingement check (TEMA RCB-4.6).
  // Nozzle ID estimated at Ds/3 (typ.) capped 50-600 mm — an ESTIMATE, flagged
  // as such; supply the real nozzle for a firm check.
  const d_noz = Math.min(Math.max(p.shellID / 3, 0.05), 0.6);
  const v_noz = p.massH_kgs / (p.rhoShell * Math.PI * d_noz * d_noz / 4);
  const rhoV2 = p.rhoShell * v_noz * v_noz;                              // kg/(m·s²)
  const impingementNeeded = p.isGas ? true : rhoV2 > 2232;               // vapours: always per TEMA
  const impingementNote = p.isGas
    ? 'vapour/gas service — TEMA requires impingement protection'
    : rhoV2 > 2232 ? `ρv² = ${rhoV2.toFixed(0)} > 2232 kg/(m·s²) — impingement plate required (TEMA RCB-4.6)`
    : rhoV2 > 744  ? `ρv² = ${rhoV2.toFixed(0)} — impingement required if fluid is corrosive/abrasive or near bubble point (limit 744)`
    : `ρv² = ${rhoV2.toFixed(0)} — below all TEMA impingement thresholds`;

  const checks = [];
  let status = 'ok';
  if (worst.feiRatio > 1.0)      { status = 'err';  checks.push(`FLUIDELASTIC INSTABILITY on ${worst.name} span (L=${(worst.L*1000).toFixed(0)} mm): V/V_crit = ${worst.feiRatio} > 1.0 — redesign required`); }
  else if (worst.feiRatio > 0.8) { status = 'warn'; checks.push(`Fluidelastic margin low on ${worst.name} span: V/V_crit = ${worst.feiRatio} (screen limit 0.8)`); }
  if (!temaSpanOK) { if (status==='ok') status='warn';
    checks.push(`Unsupported span ${(maxSpanUsed*1000).toFixed(0)} mm exceeds TEMA maximum ≈${(L_tema*1000).toFixed(0)} mm for ${(p.OD*1000).toFixed(1)} mm OD — add intermediate supports`); }
  const vsRatio = f_vs / Math.max(worst.f_n, 1e-6);
  if (!p.isGas && vsRatio > 0.5 && vsRatio < 2.0) { if (status==='ok') status='warn';
    checks.push(`Vortex shedding f_vs=${f_vs.toFixed(1)} Hz within resonance band of ${worst.name} f_n=${worst.f_n} Hz`); }
  const tbRatio = f_tb / Math.max(worst.f_n, 1e-6);
  if (tbRatio > 0.5 && tbRatio < 2.0) { if (status==='ok') status='warn';
    checks.push(`Turbulent buffeting f_tb=${f_tb.toFixed(1)} Hz near ${worst.name} f_n=${worst.f_n} Hz`); }
  if (acRisk) { if (status==='ok') status='warn';
    checks.push(`Acoustic resonance risk: shell transverse mode f_ac=${f_ac.toFixed(0)} Hz coincides with excitation — consider detuning baffles`); }
  if (impingementNeeded && !p.isGas) { if (status==='ok') status='warn'; }
  checks.push(`Inlet impingement (nozzle est. ${(d_noz*1000).toFixed(0)} mm): ${impingementNote}`);

  return { f_n: central.f_n, V_cross:+V.toFixed(2), V_crit: central.V_crit,
           feiRatio: central.feiRatio, spans, worstSpan: worst.name,
           worstFeiRatio: worst.feiRatio, temaSpanLimit_m:+L_tema.toFixed(3), temaSpanOK,
           f_vs:+f_vs.toFixed(1), f_tb:+f_tb.toFixed(1),
           f_ac: f_ac ? +f_ac.toFixed(0) : null, m_L:+m_L.toFixed(2), Cm:+Cm.toFixed(2),
           span_m:+p.span_m.toFixed(3), logDec,
           rhoV2:+rhoV2.toFixed(0), d_noz_est_mm:+(d_noz*1000).toFixed(0), impingementNeeded,
           status, checks };
}

// ─── SHELL & TUBE — WITH U CONVERGENCE ITERATION & TEMP-DEPENDENT PROPS ─────
function calcShellTube(b) {
  const hFlKey=b.hFlKey||'water', cFlKey=b.cFlKey||'water';
  const hFluidDB=getFluid(hFlKey), cFluidDB=getFluid(cFlKey);
  const hPop=parseFloat(b.hPop)||P_REF_DB, cPop=parseFloat(b.cPop)||P_REF_DB;
  const hTi=requireFinite(b.hTi,'hTi'), hTo=requireFinite(b.hTo,'hTo'), cTi=requireFinite(b.cTi,'cTi');

  // Hot side always requires hF (flow rate) to be provided.
  // hotMode='flow' was a planned feature but is not implemented — return friendly error.
  if (b.hotMode === 'flow') {
    throw new Error('Auto hot flow calculation is not yet available. Please enter the hot-side flow rate directly.');
  }

  const hF=requireFinite(b.hF,'hF');
  if (hF<=0) throw new Error('Hot flow must be positive');
  if (hTo>=hTi) throw new Error('Hot outlet must be less than hot inlet temperature');

  // ── Phase-change heat duty — correctly uses latent heat ──────────────────
  // This was the critical bug: shellMode='condensing'/'evaporating' was only
  // changing the HTC correlation but still computing Q = mass × cp × ΔT
  // (sensible heat). For condensers/evaporators, Q = mass × hvap (latent heat)
  // can be 55-100× larger than the sensible-only calculation.
  //
  // Three-zone model for partial condensation (vapour entering superheated):
  //   Zone 1 Desuperheating: hTi → Tsat  (sensible, vapour)
  //   Zone 2 Condensation:   at Tsat     (latent, hvap)
  //   Zone 3 Subcooling:     Tsat → hTo  (sensible, liquid)
  //
  // Auto bubble/dew-point detection:
  //   If shellMode='condensing' AND fluid has Tsat data AND hTi > Tsat → superheated inlet
  //   If shellMode='evaporating' AND fluid has Tsat data AND cTi < Tsat → subcooled inlet
  //   In both cases the three-zone Q is used automatically.

  const hFluidInit = fluidAtConditions(hFlKey, (hTi+hTo)/2, hPop);
  const cFluidInit = fluidAtConditions(cFlKey, (cTi + (cTi+30))/2, cPop);
  let cF=parseFloat(b.cF)||0, cTo=parseFloat(b.cTo)||0;
  const coldMode=b.coldMode||'flow';
  const massH_kgs = hF / 3600;   // kg/s — used in phase-change heat duty below
  const shellMode  = b.shellMode || 'single-phase';   // declared early for Q calc

  // ── Compute hot-side heat duty with phase-change awareness ───────────────
  let Qhot;
  let phaseZones = null;  // populated if three-zone model is used
  if (shellMode === 'condensing') {
    // Hot side is condensing. Q includes latent heat.
    // UPGRADE v7 (2026-07): saturation temperature and latent heat are now
    // PRESSURE-DEPENDENT. Steam at 2.7 bar condenses at ≈130°C with
    // hvap ≈ 2174 kJ/kg — the previous fixed 100°C / 2257 kJ/kg mis-stated
    // both the driving force and the duty at any pressure other than 1 atm.
    // Priority (upgrade v7b): CoolProp pressure-true saturation frame first,
    // then Antoine/Watson estimates, then database constants as last resort.
    const Tsat_h    = (hFluidInit._src === 'coolprop' && hFluidInit.Tsat != null)
                      ? hFluidInit.Tsat
                      : (satTemperature(hFlKey, hPop) ?? (hFluidInit.Tsat || 100));
    const hvap_kJkg = (hFluidInit._src === 'coolprop' && hFluidInit.hvap != null)
                      ? hFluidInit.hvap
                      : (hvapAtT(hFlKey, Tsat_h) || hFluidInit.hvap || 2257);
    const massH_kgs = hF / 3600;
    if (hTi > Tsat_h + 0.1) {
      // Superheated inlet → three zones
      const hFluidVap  = fluidAtConditions(hFlKey, (hTi + Tsat_h) / 2, hPop);
      const hFluidLiq  = fluidAtConditions(hFlKey.replace('steam','water').replace('-gas','-liquid'), (Tsat_h + hTo) / 2, hPop);
      const Q_desup    = massH_kgs * hFluidVap.cp * (hTi - Tsat_h);   // kW
      const Q_latent   = massH_kgs * hvap_kJkg;                        // kW
      const Q_subcool  = massH_kgs * (hFluidLiq.cp || hFluidInit.cp) * (Tsat_h - hTo); // kW (0 if hTo=Tsat)
      Qhot = Q_desup + Q_latent + Math.max(0, Q_subcool);
      phaseZones = { mode:'condensing', Tsat:Tsat_h, Q_desup, Q_latent, Q_subcool:Math.max(0,Q_subcool),
                     hvap_kJkg, superheated: true };
    } else {
      // Inlet at or below Tsat — pure condensation + optional subcooling
      const Q_latent   = massH_kgs * hvap_kJkg;
      const Q_subcool  = massH_kgs * hFluidInit.cp * Math.max(0, Tsat_h - hTo);
      Qhot = Q_latent + Q_subcool;
      phaseZones = { mode:'condensing', Tsat:Tsat_h, Q_desup:0, Q_latent, Q_subcool,
                     hvap_kJkg, superheated: false };
    }
  } else if (shellMode === 'evaporating') {
    // Cold side is evaporating (boiling). Q = hot-side sensible heat.
    // UPGRADE v7 (2026-07): pressure-dependent boiling point — ammonia at
    // 4 bar boils at ≈ −1.5°C, not −33°C. Latent heat via Watson at Tsat.
    // Priority (upgrade v7b): CoolProp exact → Antoine/Watson → DB constant
    const Tsat_c    = (cFluidInit._src === 'coolprop' && cFluidInit.Tsat != null)
                      ? cFluidInit.Tsat
                      : (satTemperature(cFlKey, cPop) ?? (cFluidInit.Tsat || 100));
    const hvap_kJkg = (cFluidInit._src === 'coolprop' && cFluidInit.hvap != null)
                      ? cFluidInit.hvap
                      : (hvapAtT(cFlKey, Tsat_c) || cFluidInit.hvap || 2257);
    const massH_kgs = hF / 3600;
    Qhot = massH_kgs * hFluidInit.cp * (hTi - hTo);
    // Boiling is isothermal at Tsat — cold outlet = Tsat regardless of flow rate
    cTo = Tsat_c;   // will be overridden by energy balance below, but capped next
    phaseZones = { mode:'evaporating', Tsat:Tsat_c, hvap_kJkg,
                   Q_latent_avail: (cF/3600) * hvap_kJkg };
  } else {
    // Single-phase: sensible heat only
    Qhot = (hF/3600) * hFluidInit.cp * (hTi - hTo);
  }

  if (coldMode==='flow') {
    if (cF<=0) throw new Error('Cold flow must be positive');
    if (shellMode === 'evaporating' && phaseZones?.Tsat != null) {
      // Boiling is isothermal — cold outlet stays at Tsat regardless of flow
      cTo = phaseZones.Tsat;
    } else {
      cTo = cTi + Qhot/((cF/3600)*cFluidInit.cp);
    }
    // For condensing: cTo must be below the hot-side saturation temperature
    // (you can't heat the cold stream above the condensing temperature).
    // If calculated cTo > Tsat_hot, the cold flow rate is too low for the duty.
    if ((shellMode === 'condensing') && phaseZones?.Tsat != null) {
      const T_approach = 5;  // minimum approach °C
      const cTo_max = phaseZones.Tsat - T_approach;
      if (cTo > cTo_max) {
        const cF_required = (Qhot / ((cTo_max - cTi) * cFluidInit.cp)) * 3600;
        throw new Error(
          `Condensing: cold outlet ${cTo.toFixed(1)}°C would exceed Tsat ${phaseZones.Tsat}°C. ` +
          `Increase cold flow to at least ${cF_required.toFixed(0)} kg/h, or use "Know T_out" mode.`
        );
      }
    }
  } else {
    if (cTo<=cTi) throw new Error('Cold outlet must be > cold inlet');
    if (cTo>=hTi) throw new Error('Cold outlet must be < hot inlet');
    cF = (Qhot/(cFluidInit.cp*(cTo-cTi)))*3600;
  }
  // For evaporating: cTo=Tsat=cTi is physically valid (isothermal boiling inlet)
  if (cTo<cTi && shellMode !== 'evaporating') throw new Error('Cold outlet must be greater than cold inlet');
  if (hTi<=cTi) throw new Error('Hot inlet must be above cold inlet');

  const OD=requireFinite(b.OD,'OD')/1000, tw=requireFinite(b.tw,'tw')/1000, L=requireFinite(b.L,'L');
  // ── FIX 5: Space constraints as hard inputs ───────────────────────────────
  // L_max and shell_OD_max now ENFORCE plant space limits before geometry is
  // fixed. Previously these were advisory only (post-hoc advisor).
  const L_max       = parseFloat(b.L_max)        || Infinity;   // m — max allowed tube length
  const shell_OD_max= parseFloat(b.shell_OD_max) || Infinity;   // mm — max allowed shell OD
  const L_effective = Math.min(L, L_max);                        // enforce length constraint
  const pitch=parseFloat(b.pitch)||1.25;
  const Rfo=Math.max(parseFloat(b.Rfo)||0.0002,0), Rfi=Math.max(parseFloat(b.Rfi)||0.0002,0);
  const arr=b.arr||'counter', kw=KMAT[b.mat]||16;
  const nPasses = b.hxType==='1-1'?1 : b.hxType==='1-2'?2 : b.hxType==='1-4'?4 : b.hxType==='1-6'?6 : b.hxType==='2-4'?4 : 2;
  const nShells=b.hxType==='2-4'?2:1;
  const tema=b.tema||'C';
  // shellMode already declared above
  if (OD<=0||L<=0||OD<=2*tw) throw new Error('Invalid tube geometry');
  const Di=OD-2*tw;
  const massH=hF/3600, massC=cF/3600;
  const A_tube=Math.PI*Di*Di/4;
  const pitchLen=pitch*OD;
  const Rwall=(OD/2)*Math.log(OD/Di)/kw;
  const bcut_frac=parseFloat(b.bcut)||0.25;
  const bsp_ratio=parseFloat(b.bsp)||0.50;
  const velMode=b.velMode||'target';
  const targetVel=parseFloat(b.targetVel)||1.5;
  const pdAllowShell=parseFloat(b.pdAllowShell)||0.70;
  const pdAllowTube=parseFloat(b.pdAllowTube)||1.00;
  const pitchLayout=b.pitchLayout||'triangular';
  const bundleAreaFactor=pitchLayout==='triangular'?0.866:1.0;
  // ── FIX 1: TEMA Table D-5 discrete shell ID steps (mm) ──────────────────
  // Continuous formula gave ±15% error vs actual available shell sizes.
  // Now we: (a) compute the theoretical minimum ID, (b) round UP to next
  // standard TEMA size, and (c) return both so the UI can warn between sizes.
  const TEMA_SHELL_IDS_MM = [
    152, 203, 254, 305, 337, 387, 438, 489, 540, 591,
    635, 686, 737, 787, 838, 889, 940, 991, 1067, 1143,
    1219, 1295, 1372, 1448, 1524
  ];
  function estimateShellID(n) {
    const bA  = n * pitchLen * pitchLen * bundleAreaFactor;
    const D_min = Math.sqrt(4 * bA / Math.PI) * 1.10;  // theoretical min (m)
    const D_min_mm = D_min * 1000;
    // Find next standard TEMA size ≥ theoretical minimum
    const standard = TEMA_SHELL_IDS_MM.find(d => d >= D_min_mm);
    const D_std_mm  = standard || (D_min_mm * 1.05); // fallback if > largest table entry
    return D_std_mm / 1000;  // return in metres
  }
  function estimateShellID_detail(n) {
    const bA      = n * pitchLen * pitchLen * bundleAreaFactor;
    const D_min   = Math.sqrt(4 * bA / Math.PI) * 1.10;
    const D_min_mm = D_min * 1000;
    const standard = TEMA_SHELL_IDS_MM.find(d => d >= D_min_mm);
    const D_std_mm  = standard || (D_min_mm * 1.05);
    const prev = TEMA_SHELL_IDS_MM.filter(d => d < D_min_mm).slice(-1)[0] || null;
    return { D_min_mm: +D_min_mm.toFixed(1), D_std_mm, prevSize_mm: prev, isStandard: !!standard };
  }

  // ── Step 0: Initial temperature-dependent fluid props ──
  let hTmean=(hTi+hTo)/2;
  let hFluid=fluidAtConditions(hFlKey,hTmean,hPop);
  let cTmean=(cTi+cTo)/2;
  let cFluid=fluidAtConditions(cFlKey,cTmean,cPop);
  // For single-phase: refine cTo with temperature-corrected cp (2 passes).
  // For condensing/evaporating: cTo was already set from Qhot (latent-based) above.
  if (shellMode === 'single-phase') {
    const Qhot_corrected = (hF/3600) * hFluid.cp * (hTi - hTo);
    if (coldMode === 'flow') {
      cTo = cTi + Qhot_corrected / ((cF/3600) * cFluid.cp);
      cTmean = (cTi+cTo)/2;
      cFluid = fluidAtConditions(cFlKey, cTmean, cPop);
      cTo = cTi + Qhot_corrected / ((cF/3600) * cFluid.cp);
      cTmean = (cTi+cTo)/2;
      cFluid = fluidAtConditions(cFlKey, cTmean, cPop);
    }
  }

  // ── FIX BUG 2: Fix geometry ONCE before the U-convergence loop ──
  // Geometry (numTubes, shellID, L) must be determined BEFORE iterating U.
  // The convergence loop only iterates U (film coefficients), NOT geometry.
  let nTubesPerPass, numTubes, shellID, L_eff;
  if (velMode==='fixedtubes') {
    numTubes=Math.max(1,parseInt(b.numTubesFixed)||0);
    if (!numTubes) throw new Error('Fixed-tube mode: enter number of tubes');
    nTubesPerPass=Math.max(1,Math.round(numTubes/nPasses));
    shellID=estimateShellID(numTubes); L_eff=L_effective;
  } else {
    // velocity-target: set initial tube count from velocity — geometry is now FIXED
    const nTPP=Math.max(1,Math.ceil(massC/(cFluid.rho*A_tube*targetVel)));
    nTubesPerPass=nTPP; numTubes=nTPP*nPasses;
    shellID=estimateShellID(numTubes); L_eff=L_effective;
  }
  // Snapshot geometry — these do NOT change inside the convergence loop
  const numTubes_geo=numTubes, nTubesPerPass_geo=nTubesPerPass, shellID_geo=shellID;

  // ═══════════════════════════════════════════════════════════════════════════
  // U CONVERGENCE ITERATION LOOP
  // Geometry is FIXED. Only fluid properties and film coefficients iterate.
  // Strategy: iterate U_assumed → compute hi, ho → compute U_actual
  //           repeat until |U_actual - U_assumed| / U_assumed < tolerance
  // ═══════════════════════════════════════════════════════════════════════════
  const U_CONV_TOL = 0.005;   // 0.5% convergence criterion
  const MAX_ITER   = 20;       // safety cap
  const U_CONV_RELAX = 0.6;   // under-relaxation factor (prevents oscillation)

  const isHotGas  = hFluidDB.rho < GAS_RHO_THRESHOLD;
  const isColdGas = cFluidDB.rho < GAS_RHO_THRESHOLD;
  let U_seed = shellMode==='condensing' ? 2000 :
               shellMode==='evaporating' ? 1500 :
               (isHotGas || isColdGas) ? 80 : 800;

  let U_iter = U_seed;
  let hShell_iter, hTube_iter, bdRes_iter, tubeRes_iter;
  let U_actual_iter, U_clean_iter;
  let iterCount = 0;
  let U_deviation_pct = 100;
  let Twall_shell, Twall_tube;
  const iterHistory = [];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterCount = iter + 1;

    // ── Step 1: Re-evaluate fluid props at bulk mean temperatures ──
    const R_shell_est = 1 / Math.max(U_iter, 1);
    const R_tube_est  = 1 / Math.max(U_iter, 1);
    Twall_shell = hTmean - (hTmean - cTmean) * 0.5 * (R_shell_est / (R_shell_est + R_tube_est));
    Twall_tube  = cTmean + (hTmean - cTmean) * 0.5 * (R_tube_est  / (R_shell_est + R_tube_est));
    hFluid = fluidAtConditions(hFlKey, hTmean, hPop);
    cFluid = fluidAtConditions(cFlKey, cTmean, cPop);
    const hFluid_wall = fluidAtConditions(hFlKey, Twall_shell, hPop);
    const cFluid_wall = fluidAtConditions(cFlKey, Twall_tube,  cPop);
    const phi_h = Math.pow(Math.max(hFluid.mu / Math.max(hFluid_wall.mu, 0.001), 0.1), 0.14);
    const phi_c = Math.pow(Math.max(cFluid.mu / Math.max(cFluid_wall.mu, 0.001), 0.1), 0.14);

    // ── FIX 3: Recalculate cTo INSIDE the convergence loop ────────────────
    // For single-phase: recompute with temperature-corrected cp each iteration.
    // For condensing/evaporating: Q is latent-heat-based and does not change with T.
    const Qhot_iter = (shellMode === 'condensing' || shellMode === 'evaporating')
      ? Qhot   // latent heat — fixed, not temperature-dependent
      : massH * hFluid.cp * (hTi - hTo);   // sensible — recompute with current cp
    if (coldMode === 'flow') {
      if (shellMode === 'evaporating' && phaseZones?.Tsat != null) {
        cTo = phaseZones.Tsat;  // boiling isothermal — stays at Tsat
      } else {
        cTo = cTi + Qhot_iter / (massC * cFluid.cp);
      }
      cTmean = (cTi + cTo) / 2;
    }
    // (coldMode==='temp': cTo is fixed by user; cF was set before the loop)

    // ── Step 2: Shell-side HTC ─────────────────────────────────────────────
    if (shellMode === 'condensing') {
      // Hot shell side is condensing: Nusselt horizontal film condensation.
      // Must use saturated LIQUID properties at Tsat (not vapour) for the film.
      // Vapour density (~0.6 kg/m³) gives h~40 W/m²K; liquid (~960 kg/m³) gives ~5000-15000.
      const Tsat_h   = phaseZones?.Tsat ?? 100;
      const Twall_h  = (cTmean + Tsat_h) / 2;
      // UPGRADE v7 (2026-07): condensate film properties now come from the
      // actual liquid phase of the condensing fluid at Tsat(P) — previously
      // hard-coded to water at 100°C regardless of fluid or pressure.
      const liqKeyC = LIQUID_OF[hFlKey] || hFlKey;
      const liqAtTsat = FP[liqKeyC] ? fluidAtConditions(liqKeyC, Tsat_h, hPop) : null;
      const hSatLiq  = liqAtTsat && liqAtTsat.rho > GAS_RHO_THRESHOLD ? {
        rho:  liqAtTsat.rho,
        mu:   liqAtTsat.mu,
        k:    liqAtTsat.k,
        hvap: (hFluid._src === 'coolprop' && hFluid.hvap != null) ? hFluid.hvap
              : (hvapAtT(hFlKey, Tsat_h) || hFluid.hvap || 2257),
        Tsat: Tsat_h
      } : {
        rho:  960,    // fallback: liquid water at ~100°C
        mu:   0.282,  // mPa·s  (liquid)
        k:    0.680,  // W/mK   (liquid)
        hvap: hFluid.hvap ?? 2257,
        Tsat: Tsat_h
      };
      hShell_iter = calcHcondense(hSatLiq, Twall_h, OD, L_eff, 'horizontal');
    } else {
      // Single-phase or evaporating: Bell-Delaware crossflow HTC on shell side
      bdRes_iter  = calcBellDelaware(hFluid, massH, shellID_geo, OD, pitch, bcut_frac, bsp_ratio, L_eff, numTubes_geo, tema, pitchLayout);
      hShell_iter = bdRes_iter.hShell * phi_h;
    }

    // ── Step 3: Tube-side HTC ─────────────────────────────────────────────
    // Pass cFluid_wall.mu so calcHtube can apply Sieder-Tate (μ/μ_wall)^0.14.
    // This is significant for viscous fluids (oils, glycol): 20-40% correction.
    // For water the correction is ~8% — small but now correctly applied.
    tubeRes_iter = calcHtube(cFluid, massC / nTubesPerPass_geo, Di, L_eff, cFluid_wall.mu);
    let hTube_base;
    if (shellMode === 'condensing') {
      // Cold tube side is single-phase cooling water — phi_c already folded into calcHtube
      hTube_base = tubeRes_iter.h;
    } else if (shellMode === 'evaporating') {
      // Cold tube side is boiling — Chen (1966) correlation with correct Xtt
      // Pass the vapour-phase fluid for Xtt calculation (quality = 0.5 average)
      // FIX (audit 2026-07): '-liquid' → '' produced keys not in the fluid DB
      // (e.g. 'ammonia-liquid' → 'ammonia', which silently fell back to WATER,
      // so Xtt used liquid-water density as the "vapour" density). Now mapped
      // to the correct vapour-phase key, defaulting to steam if none exists.
      const VAPOUR_KEY = { 'water':'steam', 'ammonia-liquid':'ammonia-gas', 'r717':'ammonia-gas' };
      let vapKey = VAPOUR_KEY[cFlKey] || cFlKey.replace('-liquid','-gas');
      if (!FP[vapKey]) vapKey = 'steam';
      const cFluidVap = fluidAtConditions(vapKey, cTmean, cPop);
      // FIX (audit 2026-07): pass cPop so the nucleate term uses the real
      // reduced pressure instead of hard-coded steam at 1 atm.
      hTube_base = calcHboiling(cFluid, tubeRes_iter.h, tubeRes_iter.Re, 0.5, cFluidVap, cPop);
    } else {
      hTube_base = tubeRes_iter.h;   // phi_c already applied inside calcHtube
    }
    hTube_iter = hTube_base;

    // ── Step 4: Compute actual U ──
    const Ao_Ai = OD / Di;
    U_clean_iter = 1 / (1/hShell_iter + Ao_Ai/hTube_iter + Rwall);
    U_actual_iter = 1 / (1/hShell_iter + Rfo + Ao_Ai/hTube_iter + Ao_Ai*Rfi + Rwall);

    // ── Step 5: Check convergence ──
    U_deviation_pct = Math.abs(U_actual_iter - U_iter) / Math.max(U_iter, 1) * 100;
    iterHistory.push({ iter: iterCount, U_assumed: +U_iter.toFixed(2), U_actual: +U_actual_iter.toFixed(2), deviation_pct: +U_deviation_pct.toFixed(3) });
    if (U_deviation_pct < U_CONV_TOL * 100) break;
    U_iter = U_iter + U_CONV_RELAX * (U_actual_iter - U_iter);
  }

  const converged = U_deviation_pct < 1.0;
  const U = U_actual_iter;
  const U_clean = U_clean_iter;
  const hShell = hShell_iter;
  const hTube  = hTube_iter;
  // bdRes_iter is null for condensing mode (no Bell-Delaware on condensing shell side)
  const bdRes  = bdRes_iter || { hShell:hShell_iter, shellRe:0, Jc:1, Jl:1, Jb:1, Jr:1, Js:1, hTube:hTube_iter };
  const Ao_Ai  = OD / Di;

  // ── Recalculate cTo with converged fluid properties ──
  // FIX (validation suite 2026-07, Tier-1 check 1.7): this recompute is
  // SENSIBLE-heat only (hFluid.cp·ΔT_hot). It previously ran for condensing
  // mode too, overwriting the latent-based cTo from the convergence loop and
  // collapsing Qc (and hence Q=(Qh+Qc)/2) to the ~4% desuperheat fraction.
  // It must run for single-phase ONLY.
  if (coldMode === 'flow' && shellMode === 'single-phase') {
    cTo = cTi + (hFluid.cp * massH * (hTi - hTo)) / (cFluid.cp * massC);
    cTmean = (cTi + cTo) / 2;
    cFluid = fluidAtConditions(cFlKey, cTmean, cPop);
  }

  // ── Two-phase / Condensing LMTD correction ──
  let lmtdArr;
  if (arr==='parallel') lmtdArr='parallel';
  else if (arr==='cross1') lmtdArr='cross1';
  else if (nPasses===1&&nShells===1) lmtdArr='counter';
  else if (nShells>=2) lmtdArr='shell24';
  else lmtdArr='shell12';

  let lmtdRes;
  if (shellMode === 'condensing' || shellMode === 'evaporating') {
    lmtdRes = calcLMTD_twophase(hTi, hTo, cTi, cTo, shellMode, lmtdArr);
  } else {
    lmtdRes = calcLMTD(hTi, hTo, cTi, cTo, lmtdArr);
  }
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err || 'LMTD error');
  const {lmtd, F, dT1, dT2} = lmtdRes;
  const FLMTD = lmtd * F;

  // ── Final heat balance — use latent heat for phase-change modes ──────────
  let Qh, Qc, Q, balErr;
  const Wh = massH * hFluid.cp;   // kW/K — needed for NTU/eff below
  const Wc = massC * cFluid.cp;
  if (shellMode === 'condensing' || shellMode === 'evaporating') {
    Qh = Qhot;
    Qc = massC * cFluid.cp * (cTo - cTi);
    Q  = (Qh + Qc) / 2;
    balErr = Math.abs(Qh - Qc) / Math.max(Qh, Qc, 0.001) * 100;
  } else {
    Qh = Wh * (hTi - hTo);
    Qc = Wc * (cTo - cTi);
    Q  = (Qh + Qc) / 2;
    balErr = Math.abs(Qh - Qc) / Math.max(Qh, Qc, 0.001) * 100;
  }

  // ── UPGRADE (2026-07): ZONE-WISE AREA for phase-change services ───────────
  // Condensers/evaporators no longer sized with one U and one LMTD.
  // The zone marcher computes local U·ΔT per thermodynamic zone and quality
  // increment; A_req = Σ A_i. Single-phase services keep the converged
  // single-point method (already iterating properties and wall viscosity).
  let zoneModel = null;
  const zoneParams = {
    hFlKey, hPop, massH, cFlKey, cPop, massC, cTi, cTo,
    OD, Di, L_eff, nTubesPerPass: nTubesPerPass_geo, shellID: shellID_geo,
    pitch, bcut: bcut_frac, bsp: bsp_ratio, nTubes: numTubes_geo, tema, pitchLayout,
    Rfo, Rfi, Rwall, Ao_Ai, boilCorr: b.boilCorr || 'gungor-winterton'
  };
  let dryoutWarn = null;
  if (shellMode === 'condensing' && phaseZones) {
    zoneModel = marchCondensingZones({ ...zoneParams,
      Tsat: phaseZones.Tsat, hTi, hTo, hvap_kJkg: phaseZones.hvap_kJkg });
  } else if (shellMode === 'evaporating' && phaseZones) {
    zoneModel = marchEvaporatingZones({ ...zoneParams,
      Tsat: phaseZones.Tsat, hTi, hTo, Qhot, hvap_kJkg: phaseZones.hvap_kJkg });
    if (zoneModel.dryout) dryoutWarn =
      '⚠ DRYOUT — hot-side duty exceeds the cold flow\'s latent capacity (exit quality reaches 1.0). ' +
      'Vapour superheating beyond dryout is NOT modelled; increase cold flow or reduce hot duty.';
  }

  // Required area: zone-summed for phase change, converged single-point otherwise
  const area = (zoneModel && zoneModel.A_total > 0)
    ? zoneModel.A_total
    : Q * 1000 / (U * FLMTD);
  // Duty-weighted effective U consistent with the reported overall FLMTD
  const U_effective = zoneModel ? Q * 1000 / (area * FLMTD) : U;

  // ── DUAL-OBJECTIVE TUBE COUNT SOLVER ─────────────────────────────────────
  // Engineering principle (your correct observation):
  //   AREA is a hard requirement  — Q = U·A·F·LMTD must be satisfied
  //   VELOCITY is a target        — we want it ≥ targetVel, but area wins if conflict
  //
  // The solver finds the minimum tube count n* such that:
  //   (a) A_provided(n*) ≥ A_required          [area constraint]
  //   (b) velocity(n*/nPasses) ≥ targetVel*0.9  [velocity target, 10% tolerance]
  //
  // If (a) and (b) cannot be satisfied simultaneously at current L/OD/passes,
  // the solver:
  //   — Enforces (a) as the hard requirement (area always wins)
  //   — Reports the velocity deficit and flags it clearly
  //   — Returns a `dualObjectiveFeasible` flag so the UI/advisor can explain
  //     WHY the velocity is low even after applying the lever

  let numTubes_final = numTubes_geo;
  let nTubesPerPass_final = nTubesPerPass_geo;
  let shellID_final = shellID_geo;
  let area_enforcement_note = null;
  let dualObjectiveFeasible = true;  // can we satisfy BOTH area AND velocity?

  if (velMode !== 'fixedtubes') {
    const A_per_tube    = Math.PI * OD * L_eff;
    const numTubes_area = Math.ceil(area / A_per_tube / nPasses) * nPasses; // min for area
    const numTubes_vel  = Math.ceil(massC / (cFluid.rho * A_tube * targetVel)) * nPasses; // max for velocity

    // numTubes_area = minimum tubes to cover the required area (area constraint)
    // numTubes_vel  = maximum tubes that still achieve target velocity
    // If numTubes_area > numTubes_vel: conflict — more tubes needed for area than velocity allows
    // The engineering resolution: use numTubes_area (area wins), report velocity deficit

    if (numTubes_area > numTubes_geo) {
      numTubes_final      = numTubes_area;
      nTubesPerPass_final = numTubes_final / nPasses;
      shellID_final       = estimateShellID(numTubes_final);
      const vel_at_area   = massC / (nTubesPerPass_final * cFluid.rho * A_tube);
      if (vel_at_area < targetVel * 0.9) {
        // Dual-objective conflict: area forces more tubes than velocity target allows
        dualObjectiveFeasible = false;
        area_enforcement_note =
          `Area requirement (${area.toFixed(1)} m²) forces ${numTubes_final} tubes at L=${L_eff.toFixed(1)} m. ` +
          `This gives velocity ${vel_at_area.toFixed(3)} m/s — below target ${targetVel} m/s. ` +
          `To achieve both area AND velocity: increase tube length, add passes, or reduce OD. ` +
          `See Design Advisor for specific options.`;
      } else {
        area_enforcement_note =
          `Tube count increased from ${numTubes_geo} to ${numTubes_final} to satisfy area requirement.`;
      }
    } else if (numTubes_geo > numTubes_vel + nPasses) {
      // Velocity-only mode: we have MORE tubes than velocity needs and area is already covered.
      // Reduce tube count to the minimum that satisfies area (saves material, improves velocity).
      numTubes_final      = Math.max(numTubes_area, nPasses); // never below 1 pass
      nTubesPerPass_final = numTubes_final / nPasses;
      shellID_final       = estimateShellID(numTubes_final);
    }
  }

  const A_tube_OD = Math.PI * OD * L_eff * numTubes_final;
  const area_provided = A_tube_OD;
  const overSurf = (area_provided / area - 1) * 100;
  const NTU = area * U / Math.max(Math.min(Wh, Wc) * 1000, 0.001);
  const Cmin = Math.min(Wh, Wc), Qmax = Cmin * (hTi - cTi);
  const eff = Qmax > 0 ? Q / Qmax : 0;

  // ── GAS/STEAM SHELL AUTO-RESIZE ────────────────────────────────────────────
  // For gas/steam on shell side: if crossflow velocity > 30 m/s, the shell is
  // undersized. Auto-step through TEMA standard IDs until velocity is acceptable,
  // then recompute ΔP with the correctly sized shell.
  // This prevents the formula from returning physically impossible ΔP values and
  // gives the engineer a valid starting point for gas-service design.
  let shellID_gas = shellID_final;     // may be enlarged below
  let shellDP_gas_resized = false;
  let gasResizeNote = null;
  let shellDP = calcBellDelawareDP(hFluid, massH, shellID_final, OD, pitch, bcut_frac, bsp_ratio, L_eff, numTubes_final, bdRes);

  if (isHotGas) {
    const GAS_VEL_LIMIT = 30; // m/s — erosion/vibration limit for shell-side gas
    const pitch_m = pitch * OD;
    const Sm_current = bsp_ratio * shellID_final * (pitch_m - OD) / pitch_m;
    const shellVelCheck = massH / Math.max(Sm_current * hFluid.rho, 1e-9);

    if (shellVelCheck > GAS_VEL_LIMIT) {
      // Step through TEMA standard shells to find minimum size that works
      let foundGasShell = false;
      for (const D_mm of TEMA_SHELL_IDS_MM) {
        const D_m = D_mm / 1000;
        const Sm_try = bsp_ratio * D_m * (pitch_m - OD) / pitch_m;
        const vel_try = massH / Math.max(Sm_try * hFluid.rho, 1e-9);
        if (vel_try <= GAS_VEL_LIMIT) {
          shellID_gas = D_m;
          shellDP_gas_resized = true;
          // Recompute ΔP with the gas-appropriate shell (but keep tube geometry unchanged)
          shellDP = calcBellDelawareDP(hFluid, massH, D_m, OD, pitch, bcut_frac, bsp_ratio, L_eff, numTubes_final, bdRes);
          gasResizeNote = {
            original_mm: Math.round(shellID_final * 1000),
            required_mm: D_mm,
            vel_original: shellVelCheck.toFixed(0),
            vel_new: vel_try.toFixed(1),
            dp_new: shellDP.toFixed(3)
          };
          foundGasShell = true;
          break;
        }
      }
      if (!foundGasShell) {
        // Beyond largest TEMA standard (1524mm) — flag as infeasible
        const Sm_needed = massH / (hFluid.rho * GAS_VEL_LIMIT);
        const shellID_needed_mm = Math.round(Sm_needed * pitch_m / (bsp_ratio * (pitch_m - OD)) * 1000);
        gasResizeNote = {
          original_mm: Math.round(shellID_final * 1000),
          required_mm: shellID_needed_mm,
          vel_original: shellVelCheck.toFixed(0),
          vel_new: null,
          dp_new: null,
          infeasible: true
        };
      }
    }
  }

  // Recalculate tube velocity with FINAL tube count
  const tubeVel = massC / (nTubesPerPass_final * cFluid.rho * A_tube);
  const tubeDp = calcPressDropTube(cFluid, massC / nTubesPerPass_final, Di, L_eff, nPasses);

  const warns = [];
  if (dryoutWarn) warns.push(dryoutWarn);
  if (area_enforcement_note) warns.push('⚠ ' + area_enforcement_note);
  if (!converged) warns.push(`U convergence not fully achieved after ${iterCount} iterations — final deviation ${U_deviation_pct.toFixed(2)}%`);

  // Gas shell resize notification
  if (gasResizeNote) {
    if (gasResizeNote.infeasible) {
      warns.push(
        `⚠ GAS SERVICE — Shell velocity ${gasResizeNote.vel_original} m/s exceeds 30 m/s limit. ` +
        `Required shell ID ${gasResizeNote.required_mm} mm exceeds largest TEMA standard (1524 mm). ` +
        `Consider: reduce gas flow rate, increase baffle spacing, or use multiple shells in parallel.`
      );
    } else {
      warns.push(
        `ℹ GAS SERVICE — Shell auto-resized from ${gasResizeNote.original_mm} mm to ${gasResizeNote.required_mm} mm ` +
        `(tube bundle unchanged) to limit crossflow velocity to ≤30 m/s. ` +
        `Shell ΔP recomputed: ${gasResizeNote.dp_new} bar at ${gasResizeNote.vel_new} m/s crossflow.`
      );
    }
  }

  // ── FIX 5b: Shell OD max enforcement warning ─────────────────────────────
  const shellID_detail = estimateShellID_detail(numTubes_final);
  const shellOD_approx_mm = shellID_detail.D_std_mm + 2 * ({R:12,C:16,B:20}[tema]||16); // typical wall + flange
  if (isFinite(shell_OD_max) && shellOD_approx_mm > shell_OD_max) {
    warns.push(
      `Shell OD ≈ ${shellOD_approx_mm.toFixed(0)} mm exceeds your ${shell_OD_max} mm space limit. ` +
      `Use Design Advisor (Lever B/C/D) to find configurations that fit within the available bay width.`
    );
  }
  if (!shellID_detail.isStandard) {
    warns.push(`Shell ID ${shellID_detail.D_min_mm.toFixed(0)} mm exceeds largest TEMA standard shell (1524 mm). Verify with vessel manufacturer.`);
  } else if (shellID_detail.prevSize_mm) {
    const gap = shellID_detail.D_std_mm - shellID_detail.D_min_mm;
    if (gap > 50) warns.push(`Shell ID rounded UP from calculated ${shellID_detail.D_min_mm.toFixed(0)} mm to TEMA standard ${shellID_detail.D_std_mm} mm — ${gap.toFixed(0)} mm headroom available.`);
  }

  // Intelligent velocity diagnostics
  if (tubeVel < 0.5) {
    const L_for_target = L_eff * (targetVel / Math.max(tubeVel, 0.01));
    const OD_for_target_mm = Math.round((OD * 1000) * Math.pow(tubeVel / targetVel, 0.5) * 10) / 10;
    warns.push(
      `Tube velocity ${tubeVel.toFixed(3)} m/s is below 0.5 m/s — fouling risk. ` +
      `Caused by area requirement forcing ${numTubes_final} tubes at L=${L_eff.toFixed(1)} m. ` +
      `To restore ${targetVel} m/s: increase tube length to ~${L_for_target.toFixed(1)} m, ` +
      `OR use fewer/larger tubes (try OD ≈ ${OD_for_target_mm} mm with same L).`
    );
  } else if (tubeVel < targetVel * 0.5 && velMode !== 'fixedtubes') {
    // velocity significantly below target but above fouling threshold — advisory only
    const L_for_target = L_eff * (targetVel / Math.max(tubeVel, 0.01));
    warns.push(
      `Tube velocity ${tubeVel.toFixed(3)} m/s is well below target ${targetVel} m/s ` +
      `(area requirement drives ${numTubes_final} tubes). ` +
      `Consider increasing tube length to ~${L_for_target.toFixed(1)} m to raise velocity closer to target.`
    );
  }
  if (tubeVel > 4) warns.push('Tube velocity above 4 m/s — erosion risk. Increase tube count or OD.');
  if (phaseZones) {
    if (phaseZones.mode === 'condensing') {
      const total = phaseZones.Q_desup + phaseZones.Q_latent + phaseZones.Q_subcool;
      if (phaseZones.superheated) {
        warns.push(
          `ℹ Condensing: three-zone heat duty — ` +
          `Desuperheat ${phaseZones.Q_desup.toFixed(1)} kW + ` +
          `Latent ${phaseZones.Q_latent.toFixed(1)} kW (hvap=${phaseZones.hvap_kJkg} kJ/kg) + ` +
          `Subcool ${phaseZones.Q_subcool.toFixed(1)} kW = ${total.toFixed(1)} kW total. ` +
          `Tsat=${phaseZones.Tsat}°C.`
        );
      } else {
        warns.push(
          `ℹ Condensing: Q = latent ${phaseZones.Q_latent.toFixed(1)} kW + ` +
          `subcool ${phaseZones.Q_subcool.toFixed(1)} kW. ` +
          `hvap=${phaseZones.hvap_kJkg} kJ/kg, Tsat=${phaseZones.Tsat}°C.`
        );
      }
    } else if (phaseZones.mode === 'evaporating') {
      warns.push(
        `ℹ Evaporating: hot side drives Q=${Qhot.toFixed(1)} kW. ` +
        `Tsat=${phaseZones.Tsat}°C, hvap=${phaseZones.hvap_kJkg} kJ/kg. ` +
        `Verify cold flow rate provides sufficient latent heat capacity.`
      );
    }
  }
  if (F < 0.75 && shellMode === 'single-phase') warns.push(`F correction factor ${F.toFixed(3)} < 0.75 — consider additional shell pass`);
  if (shellDP > pdAllowShell) warns.push(`Shell ΔP ${shellDP.toFixed(3)} bar exceeds allowable`);
  if (tubeDp > pdAllowTube)   warns.push(`Tube ΔP ${tubeDp.toFixed(3)} bar exceeds allowable`);
  if (overSurf < 0) warns.push('Insufficient area — increase tube length or passes');
  if (shellMode === 'condensing'  && !cFluidDB.hvap) warns.push('Condensing mode: no hvap data for this fluid — using Nusselt film correlation only');
  if (shellMode === 'evaporating' && !hFluidDB.hvap) warns.push('Evaporating mode: no hvap data — Chen correlation using approximate Xtt=0.9');

  // ── UPGRADE (2026-07): flow-induced vibration screening ───────────────────
  // Runs on every S&T design using the final geometry. For condensing shells
  // the crossflow is vapour at inlet — screen with vapour density (worst case
  // for velocity, conservative for FEI given the low added mass).
  let vibration = null;
  try {
    const vibShellFluid = (shellMode === 'condensing')
      ? fluidAtConditions(hFlKey, phaseZones?.Tsat ?? hTmean, hPop)
      : hFluid;
    vibration = calcVibrationScreen({
      matKey: b.mat || 'cs',
      OD, Di,
      span_m: bsp_ratio * (shellID_gas || shellID_final),
      shellID: shellID_gas || shellID_final,
      pitch_ratio: pitch,
      massH_kgs: massH,
      rhoShell: vibShellFluid.rho,
      muShell_mPas: vibShellFluid.mu,
      rhoTubeFluid: cFluid.rho,
      isGas: isHotGas,
      T_K: hTmean + 273.15,
      MW: hFluidDB.MW
    });
    vibration.checks.forEach(c => warns.push((vibration.status === 'err' ? '✗ VIBRATION — ' : '⚠ VIBRATION — ') + c));
  } catch (e) { vibration = { status: 'na', checks: ['Vibration screen unavailable: ' + e.message] }; }

  const st = overSurf < -5 ? 'err' : overSurf < 5 ? 'warn' : (vibration && vibration.status === 'err') ? 'err' : 'ok';
  const resistanceBreakdown = calcResistanceBreakdown(hShell, hTube, Rfo, Rfi, Rwall, OD / Di);

  // ═══════════════════════════════════════════════════════════════════════════
  // DESIGN ADVISOR — complete rewrite
  //
  // Root problem: area requirement forces more tubes than velocity needs.
  // Result: too many tubes-per-pass → low velocity.
  //
  // Every lever is evaluated properly:
  //   A — Try each TEMA standard length in turn. At each length, recompute
  //       required tube count AND resulting velocity. Stop at the shortest
  //       standard length where velocity ≥ target. Never use a proportional
  //       formula (which gave absurd 28m suggestions).
  //   B — More passes: iterate np = current+2 … 8. For each, compute nTPP
  //       from area requirement (not from current tube count) and check vel.
  //   C — Shells in series: split area, solve each shell independently.
  //   D — Smaller TEMA OD: for each standard smaller OD, solve properly.
  //   E — Combined: best standard length + increased passes together.
  //       Useful when a single lever is marginal.
  // ═══════════════════════════════════════════════════════════════════════════
  let designAdvisor = null;

  if (velMode !== 'fixedtubes' && numTubes_final > numTubes_geo && tubeVel < targetVel * 0.9) {

    // Standard TEMA tube lengths (m) — sorted ascending
    const TEMA_LENGTHS = [1.83, 2.44, 3.05, 3.66, 4.27, 4.88, 6.10];
    const VEL_THRESHOLD = targetVel * 0.90; // accept 90% of target as "achieved"

    // Helper: given a tube OD/Di/tw/passes/length, find minimum tube count
    // for required area, then compute actual tube-side velocity.
    function solveConfig(od_m, di_m, np, L_try) {
      const A_per_tube = Math.PI * od_m * L_try;
      const A_cross    = Math.PI * di_m * di_m / 4;
      const nTubes_req = Math.ceil(area / A_per_tube / np) * np; // round to pass multiple
      if (nTubes_req < 1 || nTubes_req > 2000) return null;
      const nTPP       = nTubes_req / np;
      const vel        = massC / (nTPP * cFluid.rho * A_cross);
      return { nTubes: nTubes_req, nTPP: +nTPP.toFixed(0), velocity: +vel.toFixed(3),
               shellID_mm: +(estimateShellID(nTubes_req) * 1000).toFixed(0) };
    }

    // ── LEVER A: Shortest TEMA standard length that achieves target velocity ──
    // This correctly accounts for the circular dependency:
    // longer L → fewer tubes needed → fewer tubes/pass → higher velocity.
    let leverA = null;
    for (const L_try of TEMA_LENGTHS) {
      if (L_try <= L_eff * 1.05) continue; // only lengths meaningfully longer than current
      const cfg = solveConfig(OD, Di, nPasses, L_try);
      if (!cfg) continue;
      if (cfg.velocity >= VEL_THRESHOLD) {
        leverA = {
          L_required_m: L_try,
          numTubes:     cfg.nTubes,
          nTubesPerPass: cfg.nTPP,
          velocity:     cfg.velocity,
          shellID_mm:   cfg.shellID_mm,
          note: `Standard TEMA length. Fewer tubes needed at longer L → higher velocity.`
        };
        break; // shortest standard length that works
      }
    }
    // If no standard length works (very high duty), report the next TEMA step up with its velocity
    if (!leverA) {
      const bestL = TEMA_LENGTHS[TEMA_LENGTHS.length - 1];
      const cfg = solveConfig(OD, Di, nPasses, bestL);
      if (cfg) {
        leverA = {
          L_required_m: bestL,
          numTubes:     cfg.nTubes,
          nTubesPerPass: cfg.nTPP,
          velocity:     cfg.velocity,
          shellID_mm:   cfg.shellID_mm,
          note: `Maximum standard TEMA length. Velocity ${cfg.velocity} m/s is the best achievable at this OD and pass count — combine with Lever B or D.`,
          partial: true
        };
      }
    }

    // ── LEVER B: Increase tube passes at current length ────────────────────
    // Correctly re-solves required tube count for each pass count.
    let leverB = null;
    for (let np = nPasses + 2; np <= 8; np += 2) {
      const cfg = solveConfig(OD, Di, np, L_eff);
      if (!cfg) continue;
      if (cfg.velocity >= VEL_THRESHOLD) {
        leverB = {
          passes:       np,
          numTubes:     cfg.nTubes,
          nTubesPerPass: cfg.nTPP,
          velocity:     cfg.velocity,
          shellID_mm:   cfg.shellID_mm,
          note: `Same tube length. More passes → fewer tubes per pass → higher velocity. No extra bay space needed.`
        };
        break;
      }
    }

    // ── LEVER C: Multiple shells in series ─────────────────────────────────
    let leverC = null;
    for (let ns = 2; ns <= 4; ns++) {
      const area_per_shell = area / ns;
      // Override area for the per-shell solve
      const A_per_tube = Math.PI * OD * L_eff;
      const nTubes_per_shell = Math.ceil(area_per_shell / A_per_tube / nPasses) * nPasses;
      if (nTubes_per_shell < 1 || nTubes_per_shell > 2000) continue;
      const nTPP = nTubes_per_shell / nPasses;
      const vel  = massC / (nTPP * cFluid.rho * A_tube);
      if (vel >= VEL_THRESHOLD) {
        leverC = {
          shells:        ns,
          tubesPerShell: nTubes_per_shell,
          nTubesPerPass: +nTPP.toFixed(0),
          velocity:      +vel.toFixed(3),
          shellID_mm:    +(estimateShellID(nTubes_per_shell) * 1000).toFixed(0),
          note: `Each shell handles ${(100/ns).toFixed(0)}% of total duty. Series arrangement maintains temperature driving force.`
        };
        break;
      }
    }

    // ── LEVER D: Reduce tube OD (TEMA standard sizes only) ────────────────
    // Standard TEMA OD options smaller than current, in mm
    const TEMA_OD_MM = [38.1, 31.75, 25.4, 19.05, 15.88, 12.7];
    let leverD = null;
    for (const od_mm of TEMA_OD_MM) {
      const od_m  = od_mm / 1000;
      if (od_m >= OD) continue; // only smaller ODs
      // BWG/schedule wall: use 10% of OD as typical wall, min 1.2mm
      const tw_m  = Math.max(0.0012, od_m * 0.10);
      const di_m  = od_m - 2 * tw_m;
      if (di_m <= 0.005) continue;
      const cfg = solveConfig(od_m, di_m, nPasses, L_eff);
      if (!cfg) continue;
      if (cfg.velocity >= VEL_THRESHOLD) {
        leverD = {
          OD_mm:         od_mm,
          Di_mm:         +(di_m * 1000).toFixed(1),
          tw_mm:         +(tw_m * 1000).toFixed(1),
          numTubes:      cfg.nTubes,
          nTubesPerPass: cfg.nTPP,
          velocity:      cfg.velocity,
          shellID_mm:    cfg.shellID_mm,
          note: `Smaller bore → smaller flow area per tube → higher velocity for same flow. Check fouling/cleaning access.`
        };
        break;
      }
    }

    // ── LEVER E: Combined — best standard length + increased passes ────────
    // Useful when neither A nor B alone achieves target but together they can.
    let leverE = null;
    if (!leverA || (leverA && leverA.partial)) {
      outerLoop:
      for (const L_try of TEMA_LENGTHS) {
        if (L_try <= L_eff * 1.05) continue;
        for (let np = nPasses + 2; np <= 8; np += 2) {
          const cfg = solveConfig(OD, Di, np, L_try);
          if (!cfg) continue;
          if (cfg.velocity >= VEL_THRESHOLD) {
            leverE = {
              L_required_m:  L_try,
              passes:        np,
              numTubes:      cfg.nTubes,
              nTubesPerPass: cfg.nTPP,
              velocity:      cfg.velocity,
              shellID_mm:    cfg.shellID_mm,
              note: `Combined: standard length + extra passes. Use when a single lever is insufficient.`
            };
            break outerLoop;
          }
        }
      }
    }

    designAdvisor = {
      problem: `Tube velocity ${tubeVel.toFixed(3)} m/s is below target ${targetVel} m/s. ` +
               `Area requirement (${area.toFixed(1)} m²) forces ${numTubes_final} tubes at L=${L_eff.toFixed(1)} m, ` +
               `giving ${nTubesPerPass_final} tubes/pass — too many for target velocity.`,
      currentVelocity: +tubeVel.toFixed(3),
      targetVelocity:  targetVel,
      requiredArea_m2: +area.toFixed(2),
      currentL_m:      L_eff,
      levers: {
        A_increase_length: leverA,
        B_more_passes:     leverB,
        C_more_shells:     leverC,
        D_smaller_OD:      leverD,
        E_combined:        leverE,
      }
    };
  }

  return {
    hF, cF, Q, Qh, Qc, U, U_clean, area, area_provided, overSurf,
    U_effective,                 // duty-consistent U (differs from film U for zone-marched services)
    zoneModel,                   // zone-by-zone {zone, Q_kW, U, LMTD, A_m2, A_pct} for phase change
    vibration,                   // TEMA-style flow-induced vibration screen
    lmtd, F, FLMTD, dT1, dT2, lmtdArr, shellMode,
    numTubes: numTubes_final, nTubesPerPass: nTubesPerPass_final,
    numTubes_velocity: numTubes_geo,
    nPasses, nShells, shellID: shellID_gas || shellID_final, Di, OD, L: L_eff,
    shellID_tube_bundle: shellID_final,   // shell sized for tube bundle
    shellID_gas_service: shellID_gas,     // shell sized for gas velocity limit (may differ)
    gasResizeNote,
    tubeVel, targetVel, velMode,
    shellDP, tubeDp, pdAllowShell, pdAllowTube,
    shellDP_method: 'bell-delaware-4term-Nc',   // tells UI which ΔP method was used
    bdCorr: { ...bdRes, hShell, hTube },
    NTU, eff, balErr, tema, pitchLayout, hTmean, cTmean,
    hTi, hTo, cTi, cTo, hPop, cPop,
    hFluid, cFluid, hFluidDB, cFluidDB,
    shellRe: bdRes.shellRe, shellVel: bdRes.shellVel,
    resistanceBreakdown, st, warns,
    designAdvisor,
    velocity_driven_by_area: numTubes_final > numTubes_geo,
    dual_objective_feasible: dualObjectiveFeasible,
    phaseZones,
    // Space constraint info
    spaceConstraints: {
      L_max_applied:       isFinite(L_max) ? L_max : null,
      shell_OD_max_mm:     isFinite(shell_OD_max) ? shell_OD_max : null,
      L_constrained:       isFinite(L_max) && L > L_max,
    },
    // TEMA shell sizing detail
    temaShell: shellID_detail,
    convergence: {
      converged,
      iterations: iterCount,
      U_seed: +U_seed.toFixed(2),
      U_final: +U.toFixed(2),
      deviation_pct: +U_deviation_pct.toFixed(3),
      history: iterHistory,
      twophase_lmtd: !!(lmtdRes.twophase)
    }
  };
}

function calcPlate(b) {
  const hFlKey = b.hFlKey || 'water', cFlKey = b.cFlKey || 'water';
  const hFluidDB = getFluid(hFlKey), cFluidDB = getFluid(cFlKey);
  const hPop = parseFloat(b.hPop) || P_REF_DB, cPop = parseFloat(b.cPop) || P_REF_DB;
  const hTi = requireFinite(b.hTi, 'hTi'), hTo = requireFinite(b.hTo, 'hTo'), cTi = requireFinite(b.cTi, 'cTi');
  const hF = requireFinite(b.hF, 'hF');
  
  // --- Input validation ---
  if (hF <= 0) throw new Error('Hot flow must be positive');
  if (hTo >= hTi) throw new Error('Hot outlet must be below hot inlet');
  if (cTi >= hTo) throw new Error('Cold inlet must be below hot outlet');
  
  // --- Fluid properties at mean temperatures ---
  const hTmean = (hTi + hTo) / 2;
  const hFluid = fluidAtConditions(hFlKey, hTmean, hPop);
  const Qhot = (hF / 3600) * hFluid.cp * (hTi - hTo);
  
  let cF = parseFloat(b.cF) || 0, cTo = parseFloat(b.cTo) || 0;
  const coldMode = b.coldMode || 'flow';

  // FIX (audit 2026-07 — CONFIRMED Meta AI Bug #1): the cold-side energy
  // balance previously used hFluid.cp (the HOT fluid's specific heat) for
  // the COLD stream. For water (4.18) hot vs thermal-oil (2.3) cold, the
  // required cold flow came out ~45% low, cTo was wrong, and the energy
  // balance error was artificially zero (both sides used the same cp).
  // Now uses the cold fluid's own temperature-corrected cp, with a short
  // fixed-point iteration because cp depends on cTmean which depends on cTo.
  let cFluid;
  if (coldMode === 'temp') {
    if (cTo <= cTi) throw new Error('Cold outlet must be > cold inlet');
    if (cTo >= hTi) throw new Error('Cold outlet cannot exceed hot inlet');
    cFluid = fluidAtConditions(cFlKey, (cTi + cTo) / 2, cPop);
    cF = (Qhot / (cFluid.cp * (cTo - cTi))) * 3600;
  } else {
    if (cF <= 0) throw new Error('Cold flow must be positive');
    cFluid = fluidAtConditions(cFlKey, cTi, cPop);      // initial guess at inlet T
    for (let it = 0; it < 3; it++) {                    // converges in 2-3 passes
      cTo = cTi + Qhot / ((cF / 3600) * cFluid.cp);
      if (cTo >= hTi) throw new Error('Cold outlet exceeds hot inlet — check flow/temps');
      cFluid = fluidAtConditions(cFlKey, (cTi + cTo) / 2, cPop);
    }
  }

  const Qcold = (cF / 3600) * cFluid.cp * (cTo - cTi);
  const balErr = Math.abs(Qhot - Qcold) / Math.max(Qhot, Qcold, 0.001) * 100;
  const Q = (Qhot + Qcold) / 2;

  const cTmean = (cTi + cTo) / 2;
  
  // --- Geometry ---
  const th = requireFinite(b.th, 'th') / 1000, angle = parseFloat(b.angle) || 45;
  const gap = requireFinite(b.gap, 'gap') / 1000, pw = requireFinite(b.pw, 'pw') / 1000;
  const plen = requireFinite(b.plen, 'plen') / 1000, phi = parseFloat(b.phi) || 1.17;
  const kw = KMAT[b.mat] || 14, foul = parseFloat(b.foul) || 0.0002;
  const pdAllowH = parseFloat(b.pdAllowH) || 1.5, pdAllowC = parseFloat(b.pdAllowC) || 1.5;
  
  const lmtdRes = calcLMTD(hTi, hTo, cTi, cTo, 'counter');
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err || 'LMTD error');
  const { lmtd, F, dT1, dT2 } = lmtdRes, FLMTD = lmtd * F;
  
  const Dh = 2 * gap / phi;
  const Ac = pw * gap;
  // FIX (audit 2026-07 — Meta AI Bug #6 resolved properly): the old code used
  // PROJECTED plate area (pw·plen) but multiplied Nu by phi to compensate —
  // a mixed basis that made the Rwall and fouling terms inconsistent (they
  // were per developed area, over-weighted by ~phi). Now everything is on the
  // standard DEVELOPED (effective) area basis, matching vendor datasheet
  // convention: A_plate = phi·pw·plen, and Nu is used as-correlated (no ×phi).
  // Plate-count results are essentially unchanged; reported areas are now
  // true effective heat-transfer areas.
  const A_plate = phi * pw * plen;
  
  // --- HTC: Martin (1996) Nusselt correlation ---
  function htcPlate(fluid, mKgs_total, nChannels) {
    const mKgs = mKgs_total / Math.max(nChannels, 1);
    const G = mKgs / Math.max(Ac, 1e-8);
    const Re = G * Dh / (fluid.mu * 1e-3);
    const Pr = Math.max(fluid.mu * 1e-3 * fluid.cp * 1000 / fluid.k, 0.5);
    const ang = angle;
    let C_Nu, m_Nu;
    if (ang <= 30) { C_Nu = 0.228; m_Nu = 0.65; }
    else if (ang <= 45) { C_Nu = 0.350; m_Nu = 0.68; }
    else if (ang <= 60) { C_Nu = 0.479; m_Nu = 0.70; }
    else { C_Nu = 0.560; m_Nu = 0.72; }
    // ×phi removed (see A_plate comment above — developed-area basis)
    const Nu = C_Nu * Math.pow(Math.max(Re, 10), m_Nu) * Math.pow(Pr, 0.333);
    return { h: Nu * fluid.k / Dh, Re, G, vel: mKgs / Math.max(fluid.rho * Ac, 1e-8) };
  }
  
  // --- Pressure drop: Martin VDI (2010) ---
  function pdPlate(fluid, mKgs_total, nChannels, portDia_m) {
    const mKgs = mKgs_total / Math.max(nChannels, 1);
    const G = mKgs / Math.max(Ac, 1e-8);
    const Re = G * Dh / (fluid.mu * 1e-3);
    
    const phi_rad = angle * Math.PI / 180;
    let f0, f1;
    if (Re < 2000) {
      f0 = 64 / Math.max(Re, 0.1);
      f1 = 597 / Math.max(Re, 0.1) + 3.85;
    } else {
      f0 = Math.pow(1.8 * Math.log10(Re) - 1.5, -2);
      f1 = 39 * Math.pow(Re, -0.289);
    }
    
    const a = 3.8, b = 0.18, c = 0.36;
    const cos_phi = Math.cos(phi_rad);
    const sin_phi = Math.sin(phi_rad);
    const tan_phi = Math.tan(phi_rad);
    const term1 = cos_phi / Math.sqrt(b * tan_phi + c * sin_phi + f0 / cos_phi);
    const term2 = (1 - cos_phi) / Math.sqrt(a * f1);
    const rhs = term1 + term2;
    const f_pl = Math.pow(rhs, -2);
    
    const vel = mKgs / Math.max(fluid.rho * Ac, 1e-8);
    const dyn = fluid.rho * vel * vel / 2;
    const dP_friction = f_pl * (plen / Dh) * dyn;
    
    let dP_port;
    if (portDia_m && portDia_m > 0) {
      const A_port = Math.PI * portDia_m * portDia_m / 4;
      const v_port = mKgs_total / Math.max(fluid.rho * A_port, 1e-8);
      dP_port = 1.4 * fluid.rho * v_port * v_port / 2;
    } else {
      // FIX (audit 2026-07 — CONFIRMED Meta AI Bug #7): the fallback used
      // A_port_est = nChannels×Ac (the TOTAL channel flow area), making the
      // "port velocity" equal the channel velocity and the port ΔP negligible.
      // Real ports are far smaller. Estimate D_port ≈ 0.30 × plate width
      // (typical gasketed-PHE proportion) → realistic port velocity.
      // NOTE: the frontend currently never sends portDia, so this fallback
      // is ALWAYS the active path.
      const D_port_est = 0.30 * pw;
      const A_port_est = Math.max(Math.PI * D_port_est * D_port_est / 4, 1e-6);
      const v_port = mKgs_total / Math.max(fluid.rho * A_port_est, 1e-8);
      dP_port = 1.4 * fluid.rho * v_port * v_port / 2;
    }
    
    return Math.max((dP_friction + dP_port) / 1e5, 0);
  }
  
  const portDia_m = parseFloat(b.portDia) / 1000 || 0;
  
  // ═══════════════════════════════════════════════════════════════════════
  // ITERATIVE PLATE COUNT CONVERGENCE
  // Resolves circular dependency: nPlates → nChan → h → U → A_req → nPlates
  // ═══════════════════════════════════════════════════════════════════════
  
  let nPlates, nChanH, nChanC, hRes, cRes, hH, hC, U, A_req, A_provided, overDesign;
  let iteration = 0;
  const MAX_ITER = 50;
  const CONVERGENCE_TOL = 0.1; // 0.1% tolerance on overDesign
  
  if (b.nPlates) {
    // User-specified plate count: single pass, no iteration needed
    nPlates = Math.max(4, parseInt(b.nPlates));
    nChanH = Math.max(1, Math.floor(nPlates / 2));
    nChanC = Math.max(1, nPlates - 1 - nChanH);
    
    hRes = htcPlate(hFluid, hF / 3600, nChanH);
    cRes = htcPlate(cFluid, cF / 3600, nChanC);
    hH = hRes.h; hC = cRes.h;
    
    const Rwall = th / kw;
    U = 1 / (1 / hH + 1 / hC + Rwall + foul);
    A_req = Q * 1000 / (U * FLMTD);
    A_provided = nPlates * A_plate;
    overDesign = (A_provided / A_req - 1) * 100;
    
  } else {
    // Auto-size: iterate until nPlates and A_req are consistent
    // Initial guess: assume reasonable h ~ 5000 W/m²K for water-water
    const U_guess = 3000; // Conservative initial U [W/m²K]
    nPlates = Math.max(4, Math.ceil((Q * 1000 / (U_guess * FLMTD)) / A_plate) + 2);
    
    let overDesign_prev = Infinity;
    
    for (iteration = 1; iteration <= MAX_ITER; iteration++) {
      // Derive channels from current plate count
      nChanH = Math.max(1, Math.floor(nPlates / 2));
      nChanC = Math.max(1, nPlates - 1 - nChanH);
      
      // Calculate heat transfer with current channel count
      hRes = htcPlate(hFluid, hF / 3600, nChanH);
      cRes = htcPlate(cFluid, cF / 3600, nChanC);
      hH = hRes.h; hC = cRes.h;
      
      const Rwall = th / kw;
      U = 1 / (1 / hH + 1 / hC + Rwall + foul);
      A_req = Q * 1000 / (U * FLMTD);
      
      // Size plates from consistent A_req
      const nPlates_new = Math.max(4, Math.ceil(A_req / A_plate) + 2);
      A_provided = nPlates_new * A_plate;
      overDesign = (A_provided / A_req - 1) * 100;
      
      // Check convergence
      const delta = Math.abs(overDesign - overDesign_prev);
      if (Math.abs(nPlates_new - nPlates) <= 1 || delta < CONVERGENCE_TOL) {
        nPlates = nPlates_new;
        break;
      }
      
      nPlates = nPlates_new;
      overDesign_prev = overDesign;
    }
    
    // Recalculate final values with converged nPlates
    nChanH = Math.max(1, Math.floor(nPlates / 2));
    nChanC = Math.max(1, nPlates - 1 - nChanH);
    hRes = htcPlate(hFluid, hF / 3600, nChanH);
    cRes = htcPlate(cFluid, cF / 3600, nChanC);
    hH = hRes.h; hC = cRes.h;
    
    const Rwall = th / kw;
    U = 1 / (1 / hH + 1 / hC + Rwall + foul);
    A_req = Q * 1000 / (U * FLMTD);
    A_provided = nPlates * A_plate;
    overDesign = (A_provided / A_req - 1) * 100;
  }
  
  const Rwall = th / kw; // Recalculate for output
  const U_clean = 1 / (1 / hH + 1 / hC + Rwall);
  
  // --- Pressure drop with converged channel counts ---
  const dpH = pdPlate(hFluid, hF / 3600, nChanH, portDia_m);
  const dpC = pdPlate(cFluid, cF / 3600, nChanC, portDia_m);
  
  // --- Performance metrics ---
  // FIX (audit 2026-07): NTU/Cmin now use temperature-corrected cp
  // (hFluid/cFluid at mean temps), not the 20°C database reference values.
  const NTU = A_req * U / Math.max(Math.min((hF / 3600) * hFluid.cp, (cF / 3600) * cFluid.cp) * 1000, 0.001);
  const Cmin = Math.min((hF / 3600) * hFluid.cp, (cF / 3600) * cFluid.cp);
  const eff = Cmin > 0 ? Q / (Cmin * (hTi - cTi)) : 0;
  
  // --- Status and warnings ---
  const st = overDesign < 0 ? 'err' : overDesign < 5 ? 'warn' : 'ok';
  const warns = [];
  if (FLMTD < 3) warns.push('FLMTD < 3°C — very close approach');
  if (dpH > pdAllowH) warns.push(`Hot ΔP ${dpH.toFixed(3)} bar exceeds allowable`);
  if (dpC > pdAllowC) warns.push(`Cold ΔP ${dpC.toFixed(3)} bar exceeds allowable`);
  if (overDesign < 0) warns.push('Insufficient plate area — increase plate count');
  if (hRes.vel > 3) warns.push(`Hot velocity ${hRes.vel.toFixed(2)} m/s > 3 m/s (erosion risk)`);
  if (cRes.vel > 3) warns.push(`Cold velocity ${cRes.vel.toFixed(2)} m/s > 3 m/s (erosion risk)`);
  
  const minApproachDT = Math.min(hTi - cTo, hTo - cTi);
  
 return {
    Q, Qhot, Qcold, U, U_clean, balErr, lmtd, F, FLMTD, dT1, dT2,
    A_req, A_provided, overDesign, nPlates, A_plate, dpH, dpC, pdAllowH, pdAllowC,
    hH, hC, NTU, eff, hTi, hTo, cTi, cTo, cF,
    minApproachDT,
    hFluid, cFluid, st, warns,
    iterations: iteration || 1,
    nChanH, nChanC,
    vH:  hRes.vel,
    vC:  cRes.vel,
    Reh: hRes.Re,
    Rec: cRes.Re
  };
}
// ─── AIR COOLED — IMPROVED (Robinson-Briggs j-factor + fin efficiency) ──────
function calcAirCooled(b) {
  const flKey  = b.flKey || 'water';
  const fluid  = getFluid(flKey);
  const Ti     = requireFinite(b.Ti,   'Ti');
  const To     = requireFinite(b.To,   'To');
  const F_kgh  = requireFinite(b.F,    'F');
  const Tamb   = requireFinite(b.Tamb, 'Tamb');
  const dTa    = Math.max(parseFloat(b.dTa)  || 15,  1);

  // Tube & fin geometry — all with defaults matching typical API 661 bundle
  const tubeOD  = (parseFloat(b.tubeOD)  || 25.4)  / 1000;  // m
  const tubeID  = (parseFloat(b.tubeID)  || 20.0)  / 1000;
  const finH    = (parseFloat(b.finH)    || 12.5)  / 1000;
  const finThk  = (parseFloat(b.finThk)  || 0.40)  / 1000;
  const finDens = parseFloat(b.finDens)  || 394;             // fins/m
  const pitchT  = (parseFloat(b.pitchT)  || 63.5)  / 1000;  // transverse pitch m
  const nRows   = Math.max(1, parseInt(b.rows)   || 4);
  const nTubes  = Math.max(1, parseInt(b.nTubes) || 40);     // tubes per row × bays
  const tubeLen = parseFloat(b.tubeLen)  || 6.0;             // m
  const Rfo     = parseFloat(b.Rfo)      || 0.0002;          // fouling m²K/W
  // FIX: fin thermal conductivity from material — was hardcoded to aluminium (222 W/mK).
  // Carbon steel fins (k=50) give eta_fin ~0.86 vs 0.96 for Al — significant for area sizing.
  const FIN_K = { alum:222, al1100:222, al3003:190, al6063:200, copper:385, cs:50, ss:16, titanium:21 };
  const kFin = FIN_K[b.finMat] || FIN_K[b.fmat] || 222;  // default aluminium

  if (To >= Ti)   throw new Error('Outlet must be below inlet for air cooling');
  if (Tamb >= To) throw new Error('Ambient must be below process outlet');

  // Heat duty kW
  // FIX (audit 2026-07 — own finding): was using the 20°C database cp.
  // Now uses cp at the process mean temperature (tubeFluid, also reused
  // below for the tube-side HTC).
  const tubeFluid = fluidAtConditions(flKey, (Ti + To) / 2, parseFloat(b.Pop) || P_REF_DB);
  const Q = (F_kgh / 3600) * tubeFluid.cp * (Ti - To);
  const TairOut = Tamb + dTa;

  // Extended surface geometry
  const finOD       = tubeOD + 2 * finH;
  const finSpacing  = 1.0 / finDens;
  const A_fin_1fin  = Math.PI / 4 * (finOD*finOD - tubeOD*tubeOD) * 2;
  const A_bare_1gap = Math.PI * tubeOD * (finSpacing - finThk);
  const A_per_m     = (A_fin_1fin + A_bare_1gap) * finDens;
  const A_total     = A_per_m * tubeLen * nTubes;         // total ext. surface m²
  const A_inside    = Math.PI * tubeID * tubeLen * nTubes; // total inside surface m²

  // Air-side: minimum free-flow area and mass velocity
  const clearT   = pitchT - finOD;
  const A_min    = Math.max(clearT * tubeLen * nTubes / nRows, 0.001);
  const mAir     = Q * 1000 / (1005 * dTa);              // kg/s (energy balance)
  const G_max    = mAir / A_min;                          // kg/m²s

  // Robinson-Briggs j-factor — Re uses bare TUBE OD as characteristic length
  // (not finOD). This is consistent with how calcFinFan was fixed and matches
  // the original Robinson-Briggs (1966) paper. Using finOD underestimates Re by
  // factor finOD/tubeOD ~2.4, shifting j and h_air by ~17%.
  const Re_fin   = Math.min(G_max * tubeOD / 1.84e-5, 50000);  // cap at correlation range
  const s_D      = Math.max((finSpacing - finThk) / tubeOD, 0.05);
  const j        = 0.1378 * Math.pow(Math.max(Re_fin, 500), -0.2178)
                           * Math.pow(s_D, -0.1285);
  const h_air_bare = j * G_max * 1005 / Math.pow(0.72, 2/3);  // W/m²K

  // Fin efficiency — Schmidt approximation
  const m_fin    = Math.sqrt(2 * h_air_bare / (kFin * Math.max(finThk, 0.0001)));
  const mH       = m_fin * finH;
  const eta_fin  = Math.tanh(mH) / Math.max(mH, 1e-9);
  const phi_fin  = A_fin_1fin / (A_fin_1fin + A_bare_1gap);
  const eta_0    = 1 - phi_fin * (1 - eta_fin);           // overall surface efficiency
  const h_eff    = eta_0 * h_air_bare;

  // Tube-side HTC (Dittus-Boelter) — tubeFluid declared above with Q
  const tubeRes   = calcHtube(tubeFluid, F_kgh/3600/nTubes, tubeID, tubeLen);

  // Overall U on extended-surface basis
  const Ao_Ai  = A_total / Math.max(A_inside, 0.001);
  const U      = 1 / (Ao_Ai/tubeRes.h + Ao_Ai*Rfo + 1/h_eff);

  // LMTD crossflow with F correction
  const lmtdRes = calcLMTD(Ti, To, Tamb, TairOut, 'cross1');
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err || 'LMTD error');
  const { lmtd, F, dT1, dT2 } = lmtdRes;
  const FLMTD  = lmtd * F;
  const A_req  = Q * 1000 / (U * FLMTD);
  const overDesign = (A_total / A_req - 1) * 100;

  // Fan power estimate (simple fan-law approach)
  const rhoAir   = 1.18;
  const V_air    = mAir / rhoAir;           // m³/s volumetric
  const dP_air   = 0.8 * nRows * G_max * G_max / (2 * rhoAir);  // Pa simple
  const fanPower = V_air * dP_air / (0.65 * 1000);  // kW at 65% efficiency

  const ApproachTemp = To - Tamb;
  const st     = ApproachTemp<5?'err':ApproachTemp<15?'warn':'ok';
  const stTxt  = ApproachTemp<5?'✗ Approach Too Close':ApproachTemp<15?'⚠ Close Approach':'✓ Design Acceptable';
  const warns  = [];
  if (Re_fin < 2000)    warns.push('Airside Re='+Re_fin.toFixed(0)+' below validated range (2000–50000)');
  if (eta_fin < 0.60)   warns.push('Fin efficiency '+( eta_fin*100).toFixed(1)+'% is low');
  if (overDesign < 0)   warns.push('Insufficient tube area — increase nTubes or tube length');

  return {
    Q, Ti, To, Tamb, TairOut, mAir, U, A_total, A_req, overDesign,
    FLMTD, lmtd, F, dT1, dT2, h_eff, h_air_bare, eta_fin, eta_0,
    Re_fin, tubeVel:tubeRes.vel, fanPower, ApproachTemp, st, stTxt,
    fluidName: fluid.name, warns
  };
}

// ─── DOUBLE PIPE ─────────────────────────────────────────────────────────────
function calcDoublePipe(b) {
  const hFlKey=b.hFlKey||'water', cFlKey=b.cFlKey||'water';
  const hFluidDB=getFluid(hFlKey), cFluidDB=getFluid(cFlKey);
  const hPop=parseFloat(b.hPop)||P_REF_DB, cPop=parseFloat(b.cPop)||P_REF_DB;
  const hTi=requireFinite(b.hTi,'hTi'), hTo=requireFinite(b.hTo,'hTo'), cTi=requireFinite(b.cTi,'cTi');
  const hF=requireFinite(b.hF,'hF');
  if (hF<=0) throw new Error('Hot flow must be positive');
  if (hTo>=hTi) throw new Error('Hot outlet must be below hot inlet');
  const hTmean=(hTi+hTo)/2;
  const hFluid=fluidAtConditions(hFlKey,hTmean,hPop);
  // FIX: use actual-temperature cp for heat duty, not DB reference cp
  const Qhot=(hF/3600)*hFluid.cp*(hTi-hTo);
  let cF=parseFloat(b.cF)||0, cTo=parseFloat(b.cTo)||0;
  const coldMode=b.coldMode||'flow';
  // FIX (audit 2026-07 — CONFIRMED Meta AI Bug #2): cold-side balance used
  // cFluidDB.cp (20°C database reference) while Qcold used the temperature-
  // corrected cp — producing a fake balance error and a biased cTo/cF.
  // Now iterated with the cold fluid's cp at its actual mean temperature.
  let cFluid;
  if (coldMode==='flow') {
    if (cF<=0) throw new Error('Cold flow must be positive');
    cFluid=fluidAtConditions(cFlKey,cTi,cPop);            // initial guess at inlet T
    for (let it=0; it<3; it++) {                          // converges in 2-3 passes
      cTo=cTi+Qhot/((cF/3600)*cFluid.cp);
      cFluid=fluidAtConditions(cFlKey,(cTi+cTo)/2,cPop);
    }
  } else {
    if (cTo<=cTi) throw new Error('Cold outlet must be > cold inlet');
    cFluid=fluidAtConditions(cFlKey,(cTi+cTo)/2,cPop);
    cF=(Qhot/(cFluid.cp*(cTo-cTi)))*3600;
  }
  if (cTo>=hTi) throw new Error('Cold outlet exceeds hot inlet');
  const cTmean=(cTi+cTo)/2;
  const Qcold=(cF/3600)*cFluid.cp*(cTo-cTi);
  const Q=(Qhot+Qcold)/2;
  const balErr=Math.abs(Qhot-Qcold)/Math.max(Qhot,Qcold,0.001)*100;
  const iOD=requireFinite(b.iOD,'iOD')/1000, iTW=requireFinite(b.iTW,'iTW')/1000;
  const oID=requireFinite(b.oID,'oID')/1000;
  const L=requireFinite(b.L,'L'), nHairpins=Math.max(1,parseInt(b.nHairpins)||1);
  const arr=b.arr||'counter', kw=KMAT[b.mat]||16;
  const foul=parseFloat(b.foul)||0.0002;
  const pdAllowInner = parseFloat(b.pdAllowInner || b.pdAllow) || 1.0;
  const pdAllowAnn   = parseFloat(b.pdAllowAnn   || b.pdAllow) || 1.0;
  const iID=iOD-2*iTW;
  if (iID<=0) throw new Error('Wall thickness too large for inner pipe');
  if (oID<=iOD) throw new Error('Outer pipe ID must be greater than inner pipe OD');
  const lmtdRes=calcLMTD(hTi,hTo,cTi,cTo,arr);
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err||'LMTD error');
  const {lmtd,F,dT1,dT2}=lmtdRes, FLMTD=lmtd*F;
  const L_total=L*nHairpins*2;
  const htInner=calcHtube(hFluid,hF/3600,iID,L_total);
  const Ann_area=Math.PI*(oID*oID-iOD*iOD)/4;
  const Dh_ann=oID-iOD;
  // Annulus HTC using Dittus-Boelter (turbulent) or Sieder-Tate (laminar)
  // Dh_ann = D_outer - D_inner (hydraulic diameter for concentric annulus)
  // Pr exponent: 0.4 for heating, 0.3 for cooling — use 0.4 (cold side being heated)
  const velAnn=(cF/3600)/(cFluid.rho*Math.max(Ann_area,1e-8));
  const Re_ann=cFluid.rho*velAnn*Dh_ann/(cFluid.mu*1e-3);
  const Pr_ann=Math.max(cFluid.mu*1e-3*cFluid.cp*1000/cFluid.k,0.5);
  let Nu_ann;
  if(Re_ann<2300){
    // Sieder-Tate laminar with entry correction.
    // Use per-hairpin leg length (L_total / (nHairpins * 2)) as the thermal
    // entry length, NOT L_total. Each hairpin leg restarts the developing
    // flow profile at the bend, so the Graetz number must be based on the
    // individual leg length. Using L_total overestimates L/D, suppresses
    // the entry-length Nu boost, and underpredicts h_ann in multi-hairpin units.
    const L_per_leg = L_total / (nHairpins * 2);
    const Gz_ann = Re_ann * Pr_ann * Dh_ann / Math.max(L_per_leg, 0.01);
    Nu_ann = Math.max(3.66, 1.86*Math.pow(Gz_ann, 0.333));
  } else {
    // Dittus-Boelter turbulent — Pr^0.4 for cold fluid being heated
    Nu_ann = 0.023*Math.pow(Re_ann,0.8)*Math.pow(Pr_ann,0.4);
  }
  // Sieder-Tate viscosity correction for annulus
  const cFluidWall_ann = fluidAtConditions(cFlKey, (cTmean+hTmean)/2, cPop);
  const phi_ann = Math.pow(Math.max(cFluid.mu / Math.max(cFluidWall_ann.mu, 0.001), 0.1), 0.14);
  Nu_ann = Nu_ann * Math.max(0.5, Math.min(phi_ann, 2.0));
  const hAnn=Nu_ann*cFluid.k/Dh_ann;
  const Ao_Ai=iOD/iID;
  const Rwall=(iOD/2)*Math.log(iOD/iID)/kw;
  const U=1/(1/htInner.h+Ao_Ai/hAnn+Rwall+foul);
  const A_req=Q*1000/(U*FLMTD);
  const A_provided=Math.PI*iOD*L_total;
  const overDesign=(A_provided/A_req-1)*100;
  const dpInner=calcPressDropTube(hFluid,hF/3600,iID,L_total,1);
  const f_ann=Re_ann<2300?64/Math.max(Re_ann,1):Math.pow(0.790*Math.log(Math.max(Re_ann,10))-1.64,-2);
  const dpAnn=(f_ann*(L_total/Dh_ann)+2.0)*cFluid.rho*velAnn*velAnn/2/1e5;
  // FIX (audit 2026-07): NTU/Cmin use temperature-corrected cp, not DB reference
  const NTU=A_req*U/Math.max(Math.min((hF/3600)*hFluid.cp,(cF/3600)*cFluid.cp)*1000,0.001);
  const Cmin=Math.min((hF/3600)*hFluid.cp,(cF/3600)*cFluid.cp);
  const eff=Cmin>0?Q/(Cmin*(hTi-cTi)):0;
  const st=overDesign<0?'err':overDesign<5?'warn':'ok';
  const warns=[];
  if(dpInner>pdAllowInner) warns.push(`Inner pipe ΔP ${dpInner.toFixed(3)} bar exceeds allowable ${pdAllowInner} bar`);
if(dpAnn>pdAllowAnn)     warns.push(`Annulus ΔP ${dpAnn.toFixed(3)} bar exceeds allowable ${pdAllowAnn} bar`);
  if(FLMTD<3) warns.push('FLMTD < 3°C — very close approach');
  return {
    Q,Qhot,Qcold,U,balErr,lmtd,F,FLMTD,dT1,dT2,
    A_req,A_provided,overDesign,hInner:htInner.h,hAnn,
    dpInner,dpAnn,pdAllow:pdAllowInner,pdAllowInner,pdAllowAnn,NTU,eff,
    hTi,hTo,cTi,cTo,cF,iID,iOD,L,L_total,nHairpins,
    hFluid,cFluid,Re_inner:htInner.Re,Re_ann,velInner:htInner.vel,velAnn,
    st,warns
  };
}

// ─── FIN-FAN (DETAILED API 661) ───────────────────────────────────────────────
function calcFinFan(b) {
  const tFlKey=b.tFlKey||'water';
  const tFlDB=getFluid(tFlKey);
  const tPop=parseFloat(b.tPop)||4.0;
  const tTi=requireFinite(b.tTi,'tTi'), tTo=requireFinite(b.tTo,'tTo');
  const tF_kgh=requireFinite(b.tF_kgh,'tF_kgh');
  const tFoul=parseFloat(b.tFoul)||2.9e-4, tPdAllow=parseFloat(b.tPdAllow)||0.6;
  const htSF=parseFloat(b.htSF)||1.0;
  const aTamb=requireFinite(b.aTamb,'aTamb'), aTout=requireFinite(b.aTout,'aTout');
  const aPop=parseFloat(b.aPop)||1.01325, aFoul=parseFloat(b.aFoul)||1.8e-4;
  const tubeOD=requireFinite(b.tubeOD,'tubeOD')/1000, tubeID=requireFinite(b.tubeID,'tubeID')/1000;
  const tubeLen=requireFinite(b.tubeLen,'tubeLen')/1000;
  const pitchT=requireFinite(b.pitchT,'pitchT')/1000, pitchL=requireFinite(b.pitchL,'pitchL')/1000;
  const nRows=Math.max(1,parseInt(b.nRows)||4), nPasses=Math.max(1,parseInt(b.nPasses)||2);
  const nTubes=Math.max(1,parseInt(b.nTubes)||261);
  const tubeLayout=b.tubeLayout||'staggered';
  const kTube=({cs:50,ss304:17,ss316:14,copper:385,titanium:21,aluminum:205})[b.tubeMat]||17;
  const finDensity=parseFloat(b.finDensity)||787;
  const finRoot=requireFinite(b.finRoot,'finRoot')/1000, finH=requireFinite(b.finH,'finH')/1000;
  const finThk=requireFinite(b.finThk,'finThk')/1000;
  const kFin=({al1100:222,al3003:190,copper:385,ss:16})[b.finMat]||222;
  const finOD=finRoot+2*finH;
  const nBays=Math.max(1,parseInt(b.nBays)||1), nBundlesPBay=Math.max(1,parseInt(b.nBundlesPBay)||1);
  const bundleW=requireFinite(b.bundleW,'bundleW')/1000;
  const nFans=Math.max(0,parseInt(b.nFans)||2), fanDia=parseFloat(b.fanDia)||3658/1000;
  const fanEff=Math.max(0.1,parseFloat(b.fanEff)||0.65);
  const driverKW=parseFloat(b.driverKW)||30;
  const draftType=b.draftType||'forced';
  if(tTo>=tTi) throw new Error('Tubeside outlet must be below inlet');
  if(aTout<=aTamb) throw new Error('Air outlet must be above ambient');
  if(tubeID>=tubeOD) throw new Error('Tube ID must be less than tube OD');
  if(finRoot<tubeOD) throw new Error('Fin root diameter must be ≥ tube OD');
  const tTmean=(tTi+tTo)/2;
  const tFluid=fluidAtConditions(tFlKey,tTmean,tPop);
  const tF_kgs=tF_kgh/3600;
  const aTmean=(aTamb+aTout)/2;
  const aFluid=fluidAtConditions('air',aTmean,aPop);
  // FIX (audit 2026-07 — own finding): duty previously used tFlDB.cp (20°C
  // database reference). Now uses cp at the tubeside mean temperature —
  // for hot oils (cp rises ~10-15% from 20°C to 100°C+) this matters.
  const Qhot=tF_kgs*tFluid.cp*(tTi-tTo);
  const nTubeTotal=nTubes*nBays*nBundlesPBay;
  const finSpacing=1.0/finDensity;
  const finsPerTube=finDensity*tubeLen;
  const nFinGaps=finsPerTube-1;
  const A_fin_per_fin=Math.PI/4*(finOD*finOD-tubeOD*tubeOD)*2+Math.PI*finOD*finThk;
  const A_bare_per_fin_gap=Math.PI*tubeOD*(finSpacing-finThk);
  const A_bare_ends=Math.PI*tubeOD*(finSpacing/2);
  const A_fin_per_tube=A_fin_per_fin*finsPerTube;
  const A_bare_per_tube=A_bare_per_fin_gap*nFinGaps+2*A_bare_ends;
  const A_total_per_tube=A_fin_per_tube+A_bare_per_tube;
  const A_extended=A_total_per_tube*nTubeTotal;
  const A_bare=A_bare_per_tube*nTubeTotal;
  const A_bare_unit=Math.PI*tubeOD*tubeLen*nTubeTotal;
  const areaRatio=A_extended/A_bare_unit;
  const A_inside=Math.PI*tubeID*tubeLen*nTubeTotal;
  const bundleL_calc=nRows*pitchL+tubeOD;
  const A_face_per_bundle=bundleW*tubeLen;
  const A_face_total=A_face_per_bundle*nBays*nBundlesPBay;
  function finEff(h_ao){
    const m=Math.sqrt(2*h_ao/(kFin*Math.max(finThk,0.0001)));
    const r1=finRoot/2, r2=finOD/2, r2c=r2+finThk/2;
    const mH=m*(r2c-r1);
    const eta_fin_approx=Math.tanh(mH)/Math.max(mH,1e-9);
    const phi_fin=A_fin_per_tube/A_total_per_tube;
    const eta_surf=1-phi_fin*(1-eta_fin_approx);
    return {eta_fin:eta_fin_approx,eta_surf};
  }
  // ── Air-side minimum free-flow area (corrected) ──────────────────────────
  // clearT = gap between fin tips of adjacent tubes (fin-to-fin only)
  const clearT = Math.max(pitchT - finOD, 0.001);
  const nTubesPerRow = Math.max(1, Math.round(nTubes / nRows));
  // A_min includes the full row width (nTubesPerRow) — previous code omitted this
  const A_min_row   = tubeLen * clearT * (1 - finDensity * finThk) * nTubesPerRow;
  const A_min_total = Math.max(A_min_row * nBays * nBundlesPBay, 0.001);
  const cp_air_kJ = aFluid.cp;
  const mAir_kgs  = Qhot / (cp_air_kJ * (aTout - aTamb));
  const mAir_kgh  = mAir_kgs * 3600;
  const rho_air   = aFluid.rho;
  const v_face    = mAir_kgs / (rho_air * Math.max(A_face_total, 0.01));
  const G_max     = mAir_kgs / A_min_total;
  const v_max     = G_max / rho_air;
  const mu_air    = aFluid.mu * 1e-3;
  const cp_air_J  = cp_air_kJ * 1000;
  const Re_air    = G_max * tubeOD / mu_air;
  const Pr_air    = Math.max(mu_air * cp_air_J / aFluid.k, 0.5);
  const s_fin     = Math.max(finSpacing - finThk, 0.0001);
  const s_over_D  = Math.max(s_fin / tubeOD, 0.05);
  const Re_safe   = Math.max(Math.min(Re_air, 50000), 500);
  const j_factor  = tubeLayout === 'staggered'
    ? 0.1378 * Math.pow(Re_safe, -0.2178) * Math.pow(s_over_D, -0.1285)
    : 0.0724 * Math.pow(Re_safe, -0.2115) * Math.pow(s_over_D, -0.1472);
  // FIX (audit 2026-07 — Meta AI Bug #8): removed a dead loop that called
  // finEff() five times, discarded the result, and recomputed h_air to the
  // identical value each pass. It never affected results (the line below
  // already computes eta correctly) — pure wasted work, now deleted.
  const h_air = j_factor * G_max * cp_air_J / Math.pow(Pr_air, 2/3);
  const {eta_fin, eta_surf} = finEff(h_air);
  const h_air_eff = eta_surf * h_air;
  const nTubesPerPass=Math.max(1,Math.round(nTubes/nPasses));
  const massPerTube=tF_kgs/Math.max(nTubesPerPass,1);
  const hTube_res=calcHtube(tFluid,massPerTube,tubeID,tubeLen);
  const h_tube=hTube_res.h;
  const Ao_per_Ai=A_extended/A_inside;
  const Rw_cyl=(tubeOD/2)*Math.log(tubeOD/tubeID)/kTube;
  const Rw_ext=Rw_cyl*(A_extended/A_bare_unit);
  const U_ext=1/(Ao_per_Ai/h_tube+Ao_per_Ai*tFoul+Rw_ext+aFoul/eta_surf+1/h_air_eff);
  const lmtdRes=calcLMTD(tTi,tTo,aTamb,aTout,'cross1');
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err||'LMTD error');
  const {lmtd,F,dT1,dT2}=lmtdRes;
  const F_rows=Math.min(F+(1-F)*Math.min(nRows,8)*0.08,0.98);
  const EMTD=lmtd*F_rows;
  const A_req=Qhot*1000*htSF/(U_ext*EMTD);
  const A_prov=A_extended;
  const overDesign=(A_prov/A_req-1)*100;
  const U_actual=Qhot*1000/(A_prov*EMTD);
  const tubeVel=massPerTube/(tFluid.rho*Math.PI*tubeID*tubeID/4);
  const mu_t=tFluid.mu*1e-3;
  const Re_tube=tFluid.rho*tubeVel*tubeID/mu_t;
  const f_tube=Re_tube<2300?64/Math.max(Re_tube,1):Math.pow(0.790*Math.log(Math.max(Re_tube,10))-1.64,-2);
  const L_flow=tubeLen*nPasses;
  const dyn_t=tFluid.rho*tubeVel*tubeVel/2;
  const dpTube=(f_tube*L_flow/tubeID+1.5+2.0*(nPasses-1)*1.5+2.0)*dyn_t/1e5;
  const f_air_C=tubeLayout==='staggered'?18.0:14.0;
  const f_friction=f_air_C*Math.pow(Re_safe,-0.316);
  const dpAir_Pa=f_friction*nRows*G_max*G_max/(2*rho_air);
  const dpAir_mmH2O=dpAir_Pa/9.80665;
  const dynPr_air=0.5*rho_air*v_face*v_face;
  const vPr_mmH2O=dynPr_air/9.80665;
  const V_air_m3s=mAir_kgs/rho_air;
  const V_air_100m3min=V_air_m3s*60/100;
  const P_static_Pa=dpAir_Pa;
  const P_fan_total=nFans*nBays>0?V_air_m3s*(P_static_Pa+dynPr_air)/Math.max(fanEff,0.1)/1000:0;
  const P_fan_each=P_fan_total/Math.max(nFans*nBays,1);
  const A_fan_each=Math.PI*fanDia*fanDia/4;
  const A_fan_total=nFans*nBays*A_fan_each;
  const fanAreaRatio=A_fan_total/Math.max(A_face_total,0.001);
  const R_tube_film=Ao_per_Ai/h_tube;
  const R_foul_tube=Ao_per_Ai*tFoul;
  const R_wall_val=Rw_ext;
  const R_foul_air=aFoul/eta_surf;
  const R_air_film=1/h_air_eff;
  const R_total=R_tube_film+R_foul_tube+R_wall_val+R_foul_air+R_air_film;
  const h_clean=1/(R_tube_film+R_wall_val+R_air_film);
  const T_skin_max=tTi-(tTi-aTamb)*(R_tube_film+R_foul_tube)/R_total;
  const T_skin_min=tTo-(tTo-aTamb)*(R_tube_film+R_foul_tube)/R_total;
  let st='ok',stTxt='✓ Design Acceptable';
  if(overDesign<0){st='err';stTxt='✗ Under-designed';}
  else if(overDesign<5||dpTube>tPdAllow||P_fan_each>driverKW*1.05){st='warn';stTxt='⚠ Check Warnings';}
  const warns=[];
  if(overDesign<0) warns.push(`Insufficient tube area — add ${Math.abs(overDesign).toFixed(1)}% more`);
  if(overDesign>50) warns.push(`${overDesign.toFixed(1)}% overdesign is high`);
  if(dpTube>tPdAllow) warns.push(`Tubeside ΔP ${dpTube.toFixed(3)} bar exceeds allowable ${tPdAllow}`);
  if(P_fan_each>driverKW) warns.push(`Fan power ${P_fan_each.toFixed(1)} kW exceeds driver ${driverKW} kW`);
  if(Re_air<2000) warns.push(`Airside Re=${Re_air.toFixed(0)} below validated range of Robinson-Briggs (2000–50000)`);
  if(eta_fin<0.60) warns.push(`Fin efficiency ${(eta_fin*100).toFixed(1)}% is low (<60%)`);
  if(v_face>4.0) warns.push(`Face velocity ${v_face.toFixed(2)} m/s is high (>4 m/s)`);
  if(fanAreaRatio<0.35) warns.push(`Fan coverage ${(fanAreaRatio*100).toFixed(0)}% low (<35%)`);
  return {
    Qhot,tTi,tTo,tF_kgh,tFluid,tFlDB,aTamb,aTout,mAir_kgh,
    A_extended,A_bare,A_req,A_prov,overDesign,EMTD,lmtd,F,F_rows,dT1,dT2,
    U_ext,U_actual,h_outside:h_air,h_tubeside:h_tube,h_clean,
    eta_fin,eta_surf,h_air,h_air_eff,
    dpTube,dpAir_Pa,dpAir_mmH2O,vPr_mmH2O,P_fan_total,P_fan_each,
    v_face,v_max,G_max,V_air_m3s,V_air_100m3min,Re_air,Re_tube,tubeVel,
    A_face_total,bundleL_calc,areaRatio,finsPerTube,
    R_tube_film,R_foul_tube,R_wall_val,R_foul_air,R_air_film,R_total,
    T_skin_max,T_skin_min,nTubeTotal,nTubesPerPass,
    fanAreaRatio,driverKW,nFans,nBays,nBundlesPBay,bundleW,
    st,stTxt,warns
  };
}

// ─── LMTD / NTU ──────────────────────────────────────────────────────────────
function calcLmtdNtu(b) {
  const hTi=requireFinite(b.hTi,'hTi'), hTo=requireFinite(b.hTo,'hTo');
  const cTi=requireFinite(b.cTi,'cTi'), cTo=requireFinite(b.cTo,'cTo');
  const arr=b.arr||'counter';
  if(hTo>=hTi) throw new Error('Hot outlet must be below hot inlet');
  if(cTo<=cTi) throw new Error('Cold outlet must be above cold inlet');
  if(hTi<=cTi) throw new Error('Hot inlet must be above cold inlet');
  const lmtdRes=calcLMTD(hTi,hTo,cTi,cTo,arr);
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err||'Cannot compute LMTD');
  const {lmtd,F,dT1,dT2}=lmtdRes, FLMTD=lmtd*F;
  const Ch=parseFloat(b.Ch)||null, Cc=parseFloat(b.Cc)||null;
  const UA_given=parseFloat(b.UA)||null;
  let NTU=null,eff=null,Cmin_kW=null,UA=UA_given;
  if(Ch&&Cc){
    Cmin_kW=Math.min(Ch,Cc);
    const Cmax_kW=Math.max(Ch,Cc);
    const Q_kW=Ch*(hTi-hTo), Qmax=Cmin_kW*(hTi-cTi);
    eff=Qmax>0?Q_kW/Qmax:null;
    const Cr=Cmin_kW/Cmax_kW;
   if(arr==='counter'&&Cr<0.999&&eff!=null)
      NTU=Math.log((1-Cr*Math.max(eff,0.001))/Math.max(1-eff,0.001))/(1-Cr);
    else if(arr==='counter'&&Cr>=0.999&&eff!=null)
      NTU=eff/Math.max(1-eff,1e-9);
    else if(arr==='parallel'&&eff!=null)
      NTU=-Math.log(1-eff*(1+Cr))/(1+Cr);
    else if(arr==='cross1'&&eff!=null)
      // Crossflow (both unmixed) — iterative inversion of NTU-effectiveness
      NTU=(function(){let n=1.0;for(let i=0;i<30;i++){const e=1-Math.exp((Math.exp(-Cr*Math.pow(n,0.22))-1)*Math.pow(n,0.78)/Cr);const de=(e-eff);if(Math.abs(de)<1e-6)break;n-=de/0.5;n=Math.max(0.01,n);}return n;})();
    else if(eff!=null)
      NTU=Math.log((1-Cr*Math.max(eff,0.001))/Math.max(1-eff,0.001))/(1-Math.max(Cr,0.001));
    UA=NTU*Cmin_kW*1000;
  }
  return {lmtd,F,FLMTD,dT1,dT2,NTU,eff,UA,Cmin_kW,hTi,hTo,cTi,cTo,arr};
}

// ─── WALL THICKNESS ───────────────────────────────────────────────────────────
function calcWallThickness(b) {
  const std=b.std||'asme8d1', type=b.type||'cylinder';
  const P_barg=requireFinite(b.P,'P'), D_mm=requireFinite(b.D,'D');
  let S_MPa=parseFloat(b.S)||138;
  const CA_mm=parseFloat(b.CA)||3, MT_mm=parseFloat(b.MT)||0.6;
  const E=parseFloat(b.E)||1.0, alpha=parseFloat(b.alpha)||30;
  // NOTE (audit 2026-07): the frontend's wt_mat dropdown sends NUMERIC strings
  // ("138","118","130","103","96","115") or "custom", never names like 'ss316'.
  // parseFloat therefore works; 'custom' correctly falls back to the wt_S input.
  // Do NOT add a name→stress map here without also changing the frontend options.
  if(b.mat&&b.mat!=='custom') S_MPa=parseFloat(b.mat)||S_MPa;
  const P_MPa=P_barg*0.1, R_i=D_mm/2;
  if(P_MPa<=0||D_mm<=0||S_MPa<=0) throw new Error('Enter valid pressure, diameter, and stress');

  let t_thin_mm, formula, standardName;
  if(type==='cylinder'){
    if(std==='asme8d1'){t_thin_mm=(P_MPa*R_i)/(S_MPa*E-0.6*P_MPa);formula='t = P·R_i/(S·E−0.6P)';standardName='ASME VIII Div.1 UG-27(c)(1)';}
    else if(std==='en13445'){t_thin_mm=(P_MPa*D_mm)/(2*S_MPa*E-P_MPa);formula='e = P·D_i/(2·f·z−P)';standardName='EN 13445-3 Clause 7.4.2';}
    else{t_thin_mm=(P_MPa*D_mm)/(2*S_MPa*E-P_MPa);formula='e = P·D_i/(2·f·z−P)';standardName='BS PD 5500';}
  } else if(type==='sphere'){
    if(std==='asme8d1'){t_thin_mm=(P_MPa*R_i)/(2*S_MPa*E-0.2*P_MPa);formula='t = P·R_i/(2·S·E−0.2P)';standardName='ASME VIII Div.1 UG-27(d)';}
    else{t_thin_mm=(P_MPa*D_mm)/(4*S_MPa*E-P_MPa);formula='e = P·D_i/(4·f·z−P)';standardName='EN 13445-3 Clause 7.4.3';}
  } else {
    const aRad=alpha*Math.PI/180;
    t_thin_mm=(P_MPa*D_mm)/(2*Math.cos(aRad)*(S_MPa*E-0.6*P_MPa));
    formula=`t = P·D_i/(2·cos(α)·(S·E−0.6P)) α=${alpha}°`;
    standardName=`ASME VIII Div.1 UG-32(g) Conical`;
  }

  // ── Thick-wall check ────────────────────────────────────────────────────
  // Industry standard: thin-wall assumption valid when t/R_i < 0.1 (10%).
  // Previous code used t/R > 0.5 (too lenient) and only reported Lamé informational.
  // FIX: When t/R_i ≥ 0.1, compute Lamé thick-wall result and USE IT for t_calc_mm.
  // The Lamé formula for a thick-wall cylinder under internal pressure:
  //   t = R_i × (exp(P / (2·S·E)) − 1)      [exact elastic solution]
  // This gives a larger (more conservative) t than thin-wall at high t/R.
  const tRatio_thin = t_thin_mm / R_i;
  let t_calc_mm = t_thin_mm;
  let lameT = null;
  let isThickWall = false;
  const warns = [];
  if (type === 'cylinder' && tRatio_thin >= 0.1) {
    lameT = R_i * (Math.exp(P_MPa / (2 * S_MPa * E)) - 1);
    isThickWall = true;
    t_calc_mm = Math.max(t_thin_mm, lameT);  // take the larger (conservative)
    // For internal pressure cylinders: thin-wall (UG-27) gives larger t than Lamé.
    // UG-27 is therefore conservative and is used. Lamé is shown informational.
    // Warn the user that they are in the thick-wall regime.
    warns.push(`Thick-wall regime (t/R = ${tRatio_thin.toFixed(3)} ≥ 0.1). ASME UG-27 thin-wall formula gives t = ${t_thin_mm.toFixed(2)} mm (conservative for internal pressure). Lamé exact solution: ${lameT.toFixed(2)} mm.`);
  }

  const tRatio = t_calc_mm / R_i;
  const t_with_CA = t_calc_mm + CA_mm + MT_mm;
  const t_nominal = Math.ceil(t_with_CA * 2) / 2;
  const pMax_check = (S_MPa*E*(t_nominal-CA_mm-MT_mm)) / (R_i+0.6*(t_nominal-CA_mm-MT_mm));
  const OD_mm = D_mm + 2 * t_nominal;

  return {t_calc_mm, t_thin_mm, t_with_CA, t_nominal, OD_mm, tRatio, isThickWall,
          pMax_check_bar:pMax_check*10, lameT, P_barg, P_MPa, D_mm, S_MPa, E,
          CA_mm, MT_mm, formula, standardName, warns};
}

// ─── FOULING COMBINED ─────────────────────────────────────────────────────────
function calcFouling(b) {
  const Rf_s=parseFloat(b.Rf_s)||0, Rf_t=parseFloat(b.Rf_t)||0;
  const U_cl=parseFloat(b.U_cl)||800;
  const Rf_total=Rf_s+Rf_t;
  const U_service=1/(1/U_cl+Rf_total);
  const area_increase=(U_cl/U_service-1)*100;
  return {Rf_s,Rf_t,Rf_total,U_cl,U_service,area_increase};
}

// ─── SPACE-CONSTRAINED GEOMETRY OPTIMIZER ────────────────────────────────────
// Called when tube length is fixed and velocity target cannot be met.
// Finds the best combination of (OD, nPasses, nShells) that satisfies
// BOTH area requirement AND target velocity within engineering constraints.
function calcGeometryOptimizer(b) {
  const area_req   = requireFinite(b.area_req,  'area_req');   // m²
  const massC_kgs  = requireFinite(b.massC_kgs, 'massC_kgs');  // kg/s cold side
  const L_fixed    = requireFinite(b.L_fixed,   'L_fixed');     // m — max allowed
  const rho_c      = requireFinite(b.rho_c,     'rho_c');       // kg/m³ cold fluid
  const target_vel = parseFloat(b.target_vel) || 1.5;           // m/s
  const vel_min    = parseFloat(b.vel_min)    || 0.8;           // m/s acceptable floor
  const vel_max    = parseFloat(b.vel_max)    || 3.5;           // m/s erosion ceiling
  const max_passes = parseInt(b.max_passes)   || 8;
  const max_shells = parseInt(b.max_shells)   || 4;
  const tw_default = parseFloat(b.tw_mm)      || 2.0;           // mm wall thickness

  // Standard tube OD options (TEMA/ASME preferred sizes in mm)
  const OD_options_mm = [12.7, 15.88, 19.05, 25.4, 31.75, 38.1];
  // Standard pass counts
  const pass_options  = [1, 2, 4, 6, 8].filter(p => p <= max_passes);
  // Shell series options
  const shell_options = [1, 2, 3].filter(s => s <= max_shells);

  const solutions = [];

  OD_options_mm.forEach(od_mm => {
    const OD  = od_mm / 1000;
    const tw  = Math.min(tw_default / 1000, OD * 0.12); // max 12% wall ratio
    const Di  = OD - 2 * tw;
    if (Di <= 0.005) return;
    const A_cross     = Math.PI * Di * Di / 4;
    const A_per_tube  = Math.PI * OD * L_fixed;

    pass_options.forEach(np => {
      shell_options.forEach(ns => {
        // Each shell sees 1/ns of the total area requirement
        const area_per_shell = area_req / ns;
        const n_total = Math.ceil(area_per_shell / A_per_tube / np) * np;
        if (n_total < 1 || n_total > 500) return;
        const nTPP    = n_total / np;
        const vel     = massC_kgs / (nTPP * rho_c * A_cross);
        const A_prov  = A_per_tube * n_total * ns;
        const margin  = (A_prov / area_req - 1) * 100;

        // Score solution: penalize velocity deviation from target, reward fewer tubes/passes
        const vel_ok   = vel >= vel_min && vel <= vel_max;
        const vel_score = Math.abs(vel - target_vel) / target_vel;  // 0 = perfect
        const complexity = (np / 8) + (ns / 4) + (n_total / 200);   // lower = simpler
        const score = vel_ok ? (vel_score + complexity * 0.3) : 999;

        solutions.push({
          od_mm, OD, Di: +(Di*1000).toFixed(2), tw_mm: +(tw*1000).toFixed(2),
          nPasses: np, nShells: ns,
          numTubes: n_total, nTubesPerPass: nTPP,
          velocity: +vel.toFixed(3),
          area_provided: +A_prov.toFixed(2),
          area_margin_pct: +margin.toFixed(1),
          vel_ok, score: +score.toFixed(4),
          label: `OD=${od_mm}mm · ${np} pass · ${ns} shell${ns>1?'s':''}`
        });
      });
    });
  });

  // Sort: valid solutions first (by score), then invalid by closeness to vel_min
  solutions.sort((a, b) => a.score - b.score);

  const valid   = solutions.filter(s => s.vel_ok).slice(0, 5);
  const invalid = solutions.filter(s => !s.vel_ok)
    .sort((a, b) => Math.abs(a.velocity - vel_min) - Math.abs(b.velocity - vel_min))
    .slice(0, 3);

  // Generate plain-English recommendation
  let recommendation = '';
  if (valid.length > 0) {
    const best = valid[0];
    recommendation = `Best option: ${best.od_mm}mm OD tubes with ${best.nPasses} passes` +
      (best.nShells > 1 ? ` × ${best.nShells} shells in series` : '') +
      ` → ${best.numTubes} tubes (${best.nTubesPerPass}/pass), velocity ${best.velocity} m/s.`;
  } else {
    recommendation = `No solution found within constraints. Consider relaxing velocity floor to ${(vel_min*0.8).toFixed(1)} m/s or allowing longer tubes.`;
  }

  return {
    area_req: +area_req.toFixed(3),
    L_fixed,
    target_vel,
    vel_min,
    vel_max,
    solutions_valid:   valid,
    solutions_partial: invalid,
    recommendation,
    any_solution: valid.length > 0
  };
}

// ─── HX SELECTOR ─────────────────────────────────────────────────────────────
function calcSelector(b) {
  const {app,pres,foul,duty,space,corr}=b;
  const scores={'shell-tube':0,'plate':0,'air-cooled':0,'double-pipe':0,'spiral':0,'plate-fin':0};
  if(app==='liquid-liquid'){scores['plate']+=3;scores['shell-tube']+=2;scores['double-pipe']+=1;}
  if(app==='liquid-gas'){scores['shell-tube']+=3;scores['air-cooled']+=2;}
  if(app==='gas-gas'){scores['plate-fin']+=3;scores['shell-tube']+=1;}
  if(app==='condensing'){scores['shell-tube']+=4;scores['plate']+=1;}
  if(app==='evaporating'){scores['shell-tube']+=4;}
  if(app==='air-cooling'){scores['air-cooled']+=5;}
  if(pres==='high'){scores['shell-tube']+=3;scores['plate']-=2;scores['double-pipe']+=2;}
  if(pres==='medium'){scores['shell-tube']+=2;scores['plate']+=1;}
  if(pres==='low'){scores['plate']+=2;scores['shell-tube']+=1;}
  if(foul==='high'){scores['shell-tube']+=3;scores['plate']-=3;scores['spiral']+=3;}
  if(foul==='medium'){scores['shell-tube']+=2;}
  if(foul==='low'){scores['plate']+=2;}
  if(duty==='small'){scores['double-pipe']+=3;scores['plate']+=2;}
  if(duty==='medium'){scores['plate']+=2;scores['shell-tube']+=2;}
  if(duty==='large'){scores['shell-tube']+=3;scores['air-cooled']+=2;}
  if(space==='very-limited'){scores['plate']+=3;scores['plate-fin']+=2;scores['shell-tube']-=1;}
  if(space==='limited'){scores['plate']+=2;}
  if(space==='plenty'){scores['shell-tube']+=1;scores['air-cooled']+=1;}
  if(corr==='high'){scores['plate']+=2;scores['shell-tube']+=1;}
  if(corr==='medium'){scores['shell-tube']+=1;}
  const sorted=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  return {top:sorted[0][0],second:sorted[1][0],scores};
}

// ── End of Section 06: HeatXpert Pro (Heat Exchanger) ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════
