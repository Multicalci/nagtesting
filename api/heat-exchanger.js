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

// Build marker — returned on every response as `apiBuild`, and on its own via
// {"calcType":"version"}. Lets you confirm which copy of this file Vercel is
// actually serving without reading the logs.
const API_BUILD = '2026-10-review-fixes-r2';

// Status = worst of the calculator's own checks and the severity of every
// message it returns (✗ fails, ⚠ check, ℹ note). Keeps the verdict and the
// message list from ever disagreeing.
function finalizeStatus(st, warns) {
  let lvl = { ok: 0, warn: 1, err: 2 }[st] ?? 0;
  for (const w of warns || []) {
    const t = String(w).trim();
    if (t.startsWith('✗')) lvl = 2;
    else if (!t.startsWith('ℹ') && !t.startsWith('✓')) lvl = Math.max(lvl, 1);
  }
  const out = ['ok', 'warn', 'err'][lvl];
  return { st: out, stTxt: out === 'err' ? '✗ Design fails' : out === 'warn' ? '⚠ Check warnings' : '✓ Design acceptable' };
}
// ─── CORS ALLOWED ORIGINS ──────────────────────────────────────────────────
const HEATXPERT_ALLOWED_ORIGINS = new Set([
  'https://www.multicalci.com',
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

  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://www.multicalci.com');
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
      ? { ...r, propSource: CPI ? 'CoolProp 6.6 (Helmholtz EOS, NIST-grade)' : 'built-in DB (interpolated)',
          apiBuild: API_BUILD } : r);

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
      case 'balance':     return res.json(_stamp(calcBalance(body)));
      // Lightweight lookup used by the UI's temperature ⇄ pressure auto-fill.
      // Always SI in / SI out (°C, bar a) — deliberately NOT unit-normalised
      // above, since its field names are its own.
      case 'saturation':  return res.json({ ...calcSaturation(body), apiBuild: API_BUILD });
      // Health check: confirms which build is deployed.
      case 'version':     return res.json({ apiBuild: API_BUILD, coolProp: !!CPI });
      case 'selftest':    return res.json(runSelfTest());
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
  // FIX 2026-10: key on the fluid KEY, not the CoolProp name. 'water' and
  // 'steam' (or 'ammonia-liquid' / 'ammonia-gas') share one CoolProp fluid but
  // ask for opposite sides of the dome at Tsat; keyed by name, the second call
  // got the first call's phase — e.g. vapour density for the condensate film,
  // which collapsed the Nusselt h of every condenser zone to ≈300 W/m²K.
  const mk = (fluidKey||'').toLowerCase().trim()+'|'+(Math.round(T_K*10)/10)+'|'+(Math.round(Pa/1000));
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
// ── ANTOINE CONSTANTS for the common condensables (upgrade 2026-07) ─────────
// NIST form, pressure in BAR and temperature in KELVIN:
//     log10(P_bar) = A − B/(T_K + C)
// Added because the single-anchor Clausius-Clapeyron fallback is only exact AT
// its 1 atm anchor and degrades as pressure departs from it — for ammonia it
// read +9.1 °C high at 15 bar, which is squarely in the middle of the normal
// NH₃ condenser range. Each set below was checked against its published normal
// boiling point (all reproduce it within 0.35 °C) and, for ammonia, against
// R717 tables from 1–20 bar (within 0.4 °C throughout).
// Used only inside its stated validity window; outside it the
// Clausius-Clapeyron path still answers. CoolProp, when installed, outranks
// both of these.
const ANTOINE = {
  //              A        B         C        Tmin_K  Tmax_K
  'ammonia':  [4.86886, 1113.928, -10.409,   239.6,  371.5],
  'methanol': [5.20409, 1581.341, -33.50,    288.1,  356.8],
  'ethanol':  [5.24677, 1598.673, -46.424,   292.8,  366.6],
  'benzene':  [4.72583, 1660.652,  -1.461,   333.4,  373.5],
  'toluene':  [4.14157, 1377.578, -50.507,   308.0,  384.0],
  'acetone':  [4.42448, 1312.253, -32.445,   259.2,  380.0],
};
// Fluid-database key → Antoine entry
const ANTOINE_OF = {
  'ammonia-liquid':'ammonia', 'ammonia-gas':'ammonia', 'r717':'ammonia',
  'methanol':'methanol', 'ethanol':'ethanol',
  'benzene':'benzene', 'toluene':'toluene', 'acetone':'acetone',
};

function satTemperature(fluidKey, P_bar_abs) {
  const key = (fluidKey || '').toLowerCase().trim();
  // Floor lowered 0.01 → 0.001 bar (2026-07). The old floor silently clamped
  // any deep-vacuum pressure to 0.01 bar, which for water pins Tsat at 7.1 °C
  // and broke the T→P→T round trip the UI auto-fill relies on. 0.001 bar is
  // still far from any numerical singularity in the Antoine form below.
  const P = Math.max(parseFloat(P_bar_abs) || 1.01325, 0.001);
  if (key === 'water' || key === 'steam') {
    const P_mmHg = P * 750.062;
    const lgP = Math.log10(P_mmHg);
    // Crossover moved 99 → 108 °C (2026-07). Checked against steam tables, the
    // low-range constants stay the more accurate of the two well past their
    // nominal 99 °C edge (−0.00 % at 99, +0.01 % at 100, +0.02 % at 105) while
    // the high range is still +0.56 % out at 100 °C. Switching at 99 therefore
    // put a 0.5 % discontinuity exactly at the atmospheric boiling point — the
    // single most commonly entered condition in the tool. They cross near
    // 108 °C, which is where the handover now happens.
    let T = 1730.63 / (8.07131 - lgP) - 233.426;
    if (T > 108) T = 1810.94 / (8.14019 - lgP) - 244.485;
    return T;
  }
  // Antoine, where a validated constant set exists and the result lands inside
  // its published window. Falls through to Clausius-Clapeyron otherwise.
  const anKey = ANTOINE_OF[key];
  if (anKey) {
    const [A, B, C, Tmin, Tmax] = ANTOINE[anKey];
    const T_K = B / (A - Math.log10(P)) - C;
    if (isFinite(T_K) && T_K >= Tmin && T_K <= Tmax) return T_K - 273.15;
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

// ── INVERSE: saturation PRESSURE from temperature (upgrade 2026-07) ─────────
// Analytical inverse of satTemperature() above, so that the T→P→T round trip
// is self-consistent to <0.05 °C:
//   WATER/STEAM  — Antoine solved for P:  P_mmHg = 10^(A − B/(C+T)),
//                  same two published ranges, switched on T (not on P).
//   OTHER FLUIDS — Clausius-Clapeyron solved for P:
//                    ln(P/P_ref) = (L/R_s)·(1/T_ref − 1/T)
//                  with the same one-pass Watson refinement of L at the mean
//                  temperature that the forward function applies.
// Returns bar absolute, or null when the fluid has no saturation anchor.
function satPressure(fluidKey, T_degC) {
  const key = (fluidKey || '').toLowerCase().trim();
  const T = parseFloat(T_degC);
  if (!isFinite(T)) return null;
  if (key === 'water' || key === 'steam') {
    // Validity window: triple point (0.01 °C) to critical point (373.95 °C).
    // Outside it there is no saturation state to return — null, not a number.
    if (T < 0.01 || T > 373.9) return null;
    // Mirrors satTemperature's crossover exactly (see note there).
    const [A, B, C] = T > 108 ? [8.14019, 1810.94, 244.485] : [8.07131, 1730.63, 233.426];
    if (C + T <= 0) return null;                       // below Antoine validity
    const P_mmHg = Math.pow(10, A - B / (C + T));
    const P_bar = P_mmHg / 750.062;
    return isFinite(P_bar) && P_bar > 0 ? P_bar : null;
  }
  const f = FP[key];
  if (!f || f.Tsat == null || !f.hvap || !f.MW) return null;
  const T_K = T + 273.15;
  if (T_K <= 0) return null;
  // Mirror satTemperature's 0.9·Tc ceiling exactly, so the T→P→T round trip is
  // consistent. Above it Clausius-Clapeyron is extrapolating past where the
  // forward function will follow, and near/above Tc there is no dome at all —
  // e.g. ammonia at 200 °C is 68 °C supercritical and must return null rather
  // than a plausible-looking 38 bar.
  if (f.Tc && (T_K > 0.9 * f.Tc || T_K < 0.4 * f.Tc)) return null;

  // NUMERICAL INVERSION of satTemperature (2026-07). An analytical inverse of
  // the Clausius-Clapeyron form is available, but it cannot reproduce the
  // forward function's two-pass Watson fixed point exactly — the residual
  // asymmetry reached 8.5 °C for ammonia at 90 °C, which the UI would surface
  // as the temperature visibly jumping after an auto-fill. Bisecting the
  // forward function instead makes satPressure its exact inverse by
  // construction. Tsat(P) is monotonic in P, so bisection on ln P is
  // unconditionally convergent; 60 halvings of the bracket below take it to
  // machine precision at negligible cost.
  let lo = 1e-4, hi = f.Pc ? Math.min(0.98 * f.Pc, 500) : 500;
  const fwd = P => satTemperature(key, P);
  const T_lo = fwd(lo), T_hi = fwd(hi);
  if (T_lo == null || T_hi == null) return null;
  if (T < T_lo || T > T_hi) return null;               // outside invertible range
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);                     // geometric = bisect ln P
    if (fwd(mid) < T) lo = mid; else hi = mid;
  }
  const P = Math.sqrt(lo * hi);
  return isFinite(P) && P > 0 ? P : null;
}

// ── SATURATION LOOKUP ENDPOINT (upgrade 2026-07) ────────────────────────────
// Powers the UI's temperature ⇄ pressure auto-fill. Given ONE of the pair it
// returns the other, plus the latent heat, so that a condenser or reboiler can
// be specified without the user hand-looking-up steam tables.
//   direction:'T_from_P'  → needs P_bar  → returns Tsat
//   direction:'P_from_T'  → needs T_degC → returns Psat
// CoolProp (Helmholtz EOS) is used when the fluid is mapped and the WASM
// module loaded; otherwise the Antoine / Clausius-Clapeyron layer answers and
// `source` says so. Fluids with no saturation model return saturable:false
// rather than a fabricated number.
// Which correlation satTemperature/satPressure will actually have used, so the
// UI reports the real provenance instead of guessing from the fluid key.
function satFallbackSource(fluidKey) {
  const k = (fluidKey || '').toLowerCase().trim();
  if (k === 'water' || k === 'steam') return 'Antoine equation';
  return ANTOINE_OF[k] ? 'Antoine equation' : 'Clausius-Clapeyron + Watson';
}

function calcSaturation(b) {
  const fluidKey = (b.fluidKey || 'water').toLowerCase().trim();
  const dir = b.direction === 'P_from_T' ? 'P_from_T' : 'T_from_P';
  const cpName = COOLPROP_NAME[fluidKey];
  const f = FP[fluidKey];
  const label = f?.name || fluidKey;

  // Fluids with neither a CoolProp model nor a DB saturation anchor
  const hasDbAnchor = !!(f && f.Tsat != null && f.hvap && f.MW) || fluidKey === 'water' || fluidKey === 'steam';
  if (!cpName && !hasDbAnchor) {
    return { saturable: false, fluidKey, fluidName: label,
             note: `${label} has no saturation model in this library — enter temperature and pressure independently.` };
  }

  let T_degC = null, P_bar = null, hvap = null, source = null;

  if (dir === 'T_from_P') {
    P_bar = parseFloat(b.P_bar);
    // Return a structured answer rather than throwing. This endpoint is called
    // on every keystroke, so a half-typed or cleared field is normal traffic,
    // not an error condition — and a 500 here makes callAPI throw, which the UI
    // surfaces as "Saturation lookup unavailable".
    if (!isFinite(P_bar) || P_bar <= 0) {
      return { saturable: false, fluidKey, fluidName: label, pending: true,
               note: 'Enter a positive absolute pressure.' };
    }
    if (CPI && cpName && !cpName.startsWith('INCOMP')) {
      try {
        const Pa = P_bar * 1e5;
        T_degC = CPI.PropsSI('T', 'P', Pa, 'Q', 1, cpName) - 273.15;
        hvap = (CPI.PropsSI('H', 'P', Pa, 'Q', 1, cpName) - CPI.PropsSI('H', 'P', Pa, 'Q', 0, cpName)) / 1000;
        source = 'CoolProp (Helmholtz EOS)';
      } catch { T_degC = null; }
    }
    if (T_degC == null || !isFinite(T_degC)) {
      T_degC = satTemperature(fluidKey, P_bar);
      hvap = T_degC != null ? hvapAtT(fluidKey, T_degC) : null;
      source = satFallbackSource(fluidKey);
    }
  } else {
    T_degC = parseFloat(b.T_degC);
    if (!isFinite(T_degC)) {
      return { saturable: false, fluidKey, fluidName: label, pending: true,
               note: 'Enter a temperature.' };
    }
    if (CPI && cpName && !cpName.startsWith('INCOMP')) {
      try {
        const T_K = T_degC + 273.15;
        P_bar = CPI.PropsSI('P', 'T', T_K, 'Q', 1, cpName) / 1e5;
        hvap = (CPI.PropsSI('H', 'T', T_K, 'Q', 1, cpName) - CPI.PropsSI('H', 'T', T_K, 'Q', 0, cpName)) / 1000;
        source = 'CoolProp (Helmholtz EOS)';
      } catch { P_bar = null; }
    }
    if (P_bar == null || !isFinite(P_bar)) {
      P_bar = satPressure(fluidKey, T_degC);
      hvap = hvapAtT(fluidKey, T_degC);
      source = satFallbackSource(fluidKey);
    }
  }

  if (T_degC == null || P_bar == null || !isFinite(T_degC) || !isFinite(P_bar)) {
    return { saturable: false, fluidKey, fluidName: label,
             note: `Saturation state for ${label} is outside the range this library can model at that condition.` };
  }

  // Critical-point guard — the dome does not extend past Tc/Pc
  const Tc_K = f?.Tc, Pc_bar = f?.Pc;
  let nearCritical = false;
  if (Tc_K && (T_degC + 273.15) > 0.98 * Tc_K) nearCritical = true;
  if (Pc_bar && P_bar > 0.98 * Pc_bar) nearCritical = true;

  return {
    saturable: true, fluidKey, fluidName: label, direction: dir,
    Tsat_degC: +T_degC.toFixed(3),
    Psat_bar:  +P_bar.toFixed(5),
    hvap_kJkg: hvap != null && isFinite(hvap) ? +hvap.toFixed(1) : null,
    source, nearCritical,
    note: nearCritical
      ? `Close to the critical point of ${label} — latent heat approaches zero and saturation correlations lose accuracy.`
      : null
  };
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

// NEW 2026-10 — temperature dependence of viscosity for database fluids that
// have no data table. Previously these used one constant value at all
// temperatures (lube oil was 80 mPa·s at 20 °C and at 150 °C alike).
//   walther — petroleum liquids (ASTM D341 form), slope B = 3.6 (typical of
//             mineral oils, VI ≈ 95), anchored at the database value at 20 °C:
//             log log(ν + 0.7) = A − B·log T
//   andrade — aqueous solutions: μ = μ20·exp[β·(1/T − 1/293.15)]
//   gases   — μ ∝ (T/293)^0.67, k ∝ (T/293)^0.8 (were constant)
// These are generic estimates; the result notes them so final designs use real data.
const VISC_MODEL = {
  'crude-oil-heavy':['walther'], 'diesel':['walther'], 'kerosene':['walther'], 'fuel-oil':['walther'],
  'lube-oil':['walther'], 'hydraulic-oil':['walther'], 'thermal-oil':['walther'],
  'brine-nacl':['andrade',1800], 'brine-cacl2':['andrade',1900], 'ethylene-glycol-50':['andrade',2500],
  'propylene-glycol-30':['andrade',2600], 'propylene-glycol-50':['andrade',3000], 'milk':['andrade',1900],
  'juice':['andrade',1900], 'beer':['andrade',1800], 'sugar-solution':['andrade',2900],
};
function getFluidAtT(key, T_degC) {
  const k0 = (key||'').toLowerCase().trim();
  const raw = FP[k0] || FP.water;
  let rho = raw.rho_pts ? interpProp(raw.rho_pts, T_degC, raw.rho) : raw.rho;
  let mu  = raw.mu_pts  ? interpProp(raw.mu_pts,  T_degC, raw.mu)  : raw.mu;
  let k   = raw.k_pts   ? interpProp(raw.k_pts,   T_degC, raw.k)   : raw.k;
  let viscModel = raw.mu_pts ? 'table' : 'constant';
  const vm = VISC_MODEL[k0];
  const T_K = T_degC + 273.15;
  if (!raw.mu_pts && vm && vm[0] === 'walther') {
    const nu20 = raw.mu / raw.rho * 1000;                         // cSt at 20 °C
    const B = 3.6, A = Math.log10(Math.log10(nu20 + 0.7)) + B * Math.log10(293.15);
    const nu = Math.max(Math.pow(10, Math.pow(10, A - B * Math.log10(Math.max(T_K, 200)))) - 0.7, 0.3);
    if (!raw.rho_pts) rho = raw.rho * (1 - 0.00065 * (T_degC - 20));
    mu = nu * rho / 1000; viscModel = 'walther';
  } else if (!raw.mu_pts && vm && vm[0] === 'andrade') {
    mu = raw.mu * Math.exp(vm[1] * (1 / Math.max(T_K, 200) - 1 / 293.15)); viscModel = 'andrade';
  } else if (!raw.mu_pts && raw.rho < GAS_RHO_THRESHOLD) {
    mu = fluidMuActual(raw, T_degC); if (!raw.k_pts) k = fluidKActual(raw, T_degC); viscModel = 'gas-power-law';
  }
  return {
    rho, mu,
    cp:   raw.cp_pts   ? interpProp(raw.cp_pts,   T_degC, raw.cp)  : raw.cp,
    k,
    name: raw.name, MW: raw.MW, Tc: raw.Tc, Pc: raw.Pc,
    omega: raw.omega, hvap: raw.hvap, Tsat: raw.Tsat, viscModel
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
  return { rho:rhoFinal, mu:tProps.mu, cp:tProps.cp, k:tProps.k, viscModel:tProps.viscModel,
    name:fluid.name, Z:Z_val, zMethod:method, _isGas:isGas, _src:'builtin-db',
    hvap:fluid.hvap, Tsat:fluid.Tsat,
    MW:fluid.MW, Tc:fluid.Tc, Pc:fluid.Pc, omega:fluid.omega };

}

// ─── LMTD CALCULATION ─────────────────────────────────────────────────────────
function calcF_1_2(R, P) {
  // Bowman–Mueller–Nagle exact F for one 1-2N shell. valid:false means the
  // duty is thermally impossible in this shell (temperature cross).
  if (P <= 0) return { F: 1.0, valid: true };
  if (P >= 1 || R <= 0 || R * P >= 1.0) return { F: null, valid: false };
  const S = Math.sqrt(R * R + 1);
  if (Math.abs(R - 1) < 0.001) {
    const den2 = 2 - P * (2 + Math.sqrt(2));
    if (den2 <= 0) return { F: null, valid: false };
    const denom = Math.log((2 - P * (2 - Math.sqrt(2))) / den2);
    if (!(denom > 0)) return { F: null, valid: false };
    const F = Math.sqrt(2) * P / ((1 - P) * denom);
    return isFinite(F) && F > 0 ? { F: Math.min(F, 1.0), valid: true } : { F: null, valid: false };
  }
  const n1 = 2 / P - 1 - R + S, n2 = 2 / P - 1 - R - S;
  if (n1 <= 0 || n2 <= 0 || n1 === n2) return { F: null, valid: false };
  const F = (S / (R - 1)) * Math.log((1 - P) / (1 - P * R)) / Math.log(n1 / n2);
  return isFinite(F) && F > 0 ? { F: Math.min(F, 1.0), valid: true } : { F: null, valid: false };
}

// Per-shell P for N identical shells in series (overall counter-current).
// FIX 2026-10: replaces P1 = P/(2 − P(1+R)), which is not the series relation
// (it gave F = 0.920 where the correct value is 0.973 for P = 0.6, R = 0.5).
function seriesP1(P, R, N) {
  if (N <= 1) return P;
  if (Math.abs(R - 1) < 1e-6) return P / (N - (N - 1) * P);
  const X = Math.pow((1 - P * R) / (1 - P), 1 / N);
  return (X - 1) / (X - R);
}
// Smallest number of 1-2 shells in series that gives a valid F ≥ 0.75.
function shellsNeeded_1_2(R, P) {
  for (let N = 1; N <= 8; N++) {
    const r = calcF_1_2(R, seriesP1(P, R, N));
    if (r.valid && r.F >= 0.75) return N;
  }
  return null;
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
  if (P <= 0 || R < 0) return {F:1.0, valid:true};
  if (P >= 1 || R*P >= 0.999) return {F:null, valid:false};
  // Map to the Cmin-based domain: if R > 1 the HOT stream is Cmin;
  // by stream symmetry use Pe = P·R (hot-stream effectiveness), Re = 1/R.
  let Pe = P, Rc = R;
  if (R > 1) { Pe = P * R; Rc = 1 / R; }
  if (Pe >= 0.999) return {F:null, valid:false};
  const crossEff = (ntu, cr) => {
    if (cr < 1e-6) return 1 - Math.exp(-ntu);                       // evaporator/condenser limit
    return 1 - Math.exp((Math.exp(-cr * Math.pow(ntu, 0.78)) - 1) * Math.pow(ntu, 0.22) / cr);
  };
  // Bisection for NTU_crossflow
  let lo = 1e-4, hi = 200;
  if (crossEff(hi, Rc) < Pe) return {F:null, valid:false};          // effectiveness unattainable
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

// Crossflow, Cmax mixed / Cmin unmixed:  ε = (1/Cr)·(1 − exp(−Cr·(1 − e^−NTU)))
// F = NTU_counterflow / NTU_crossflow (same definition as calcF_crossflow).
function calcF_cross_mixed(R, P) {
  if (P <= 0) return { F: 1.0, valid: true };
  let Pe = P, Rc = R;
  if (R > 1) { Pe = P * R; Rc = 1 / R; }
  if (Pe >= 0.999) return { F: null, valid: false };
  let NTU;
  if (Rc < 1e-6) NTU = -Math.log(1 - Pe);
  else {
    const arg = 1 + Math.log(1 - Pe * Rc) / Rc;
    if (!(arg > 0)) return { F: null, valid: false };
    NTU = -Math.log(arg);
  }
  const NTU_cf = Math.abs(Rc - 1) < 1e-3 ? Pe / (1 - Pe) : Math.log((1 - Rc * Pe) / (1 - Pe)) / (1 - Rc);
  return { F: Math.max(0, Math.min(1, NTU_cf / NTU)), valid: true };
}

// Counter-crossflow with N tube passes (air-cooled bundles): each pass is a
// crossflow unit (both fluids unmixed), passes in counter-current series.
// F = NTU_counterflow / NTU_total, NTU_total found by bisection.
function calcF_counterCross(R, P, Npass) {
  const N = Math.max(1, Math.round(Npass || 1));
  if (N === 1) return calcF_crossflow(R, P);
  if (P <= 0) return { F: 1.0, valid: true };
  let Pe = P, Rc = R;
  if (R > 1) { Pe = P * R; Rc = 1 / R; }
  if (Pe >= 0.999) return { F: null, valid: false };
  const cross = (ntu, cr) => cr < 1e-6 ? 1 - Math.exp(-ntu)
    : 1 - Math.exp((Math.exp(-cr * Math.pow(ntu, 0.78)) - 1) * Math.pow(ntu, 0.22) / cr);
  const overall = ntuTot => {
    const e1 = cross(ntuTot / N, Rc);
    if (Math.abs(Rc - 1) < 1e-6) return N * e1 / (1 + (N - 1) * e1);
    const X = Math.pow((1 - e1 * Rc) / (1 - e1), N);
    return (X - 1) / (X - Rc);
  };
  let lo = 1e-4, hi = 200;
  if (overall(hi) < Pe) return { F: null, valid: false };
  for (let i = 0; i < 70; i++) { const mid = 0.5 * (lo + hi); if (overall(mid) < Pe) lo = mid; else hi = mid; }
  const NTU = 0.5 * (lo + hi);
  const NTU_cf = Math.abs(Rc - 1) < 1e-3 ? Pe / (1 - Pe) : Math.log((1 - Rc * Pe) / (1 - Pe)) / (1 - Rc);
  return { F: Math.max(0, Math.min(1, NTU_cf / NTU)), valid: true };
}

function calcLMTD(hTi, hTo, cTi, cTo, arr, nPassCross) {
  let dT1, dT2;
  if (arr === 'parallel') {
    dT1 = hTi - cTi; dT2 = hTo - cTo;
  } else {
    dT1 = hTi - cTo; dT2 = hTo - cTi;
  }
  if (dT1 <= 0 || dT2 <= 0) return { lmtd: null, err: arr === 'parallel'
    ? 'Temperature cross — in parallel flow the cold outlet must stay below the hot outlet'
    : 'Temperature cross — the hot outlet must stay above the cold inlet and the hot inlet above the cold outlet' };
  const lmtd = Math.abs(dT1 - dT2) < 0.001 ? dT1 : (dT1 - dT2) / Math.log(dT1 / dT2);
  if (!isFinite(lmtd) || lmtd <= 0) return { lmtd: null, err: 'LMTD calculation failed' };
  const R = (hTi - hTo) / Math.max(cTo - cTi, 1e-6);
  const P = (cTo - cTi) / Math.max(hTi - cTi, 1e-6);
  let F = 1.0, valid = true, nShellsNeeded = null, fErr = null;
  if (arr === 'shell12' || arr === 'shell24') {
    const N = arr === 'shell24' ? 2 : 1;
    const r = calcF_1_2(R, seriesP1(P, R, N));
    F = r.F; valid = r.valid;
    if (!valid) {
      nShellsNeeded = shellsNeeded_1_2(R, P);
      fErr = `Temperature cross: ${N === 1 ? 'a single 1-2 shell' : 'two 1-2 shells in series'} cannot achieve these outlet temperatures (F is undefined). ` +
        (nShellsNeeded ? `At least ${nShellsNeeded} 1-2 shells in series are needed${nShellsNeeded === 2 ? ' — choose HX type 2-4' : ''}, ` : 'Use a true countercurrent unit (1-1 shell or double pipe), ') +
        'or relax the outlet temperatures.';
    } else if (F < 0.75) {
      nShellsNeeded = shellsNeeded_1_2(R, P);
    }
  } else if (arr === 'cross1') {
    const r = (nPassCross && nPassCross > 1) ? calcF_counterCross(R, P, nPassCross) : calcF_crossflow(R, P);
    F = r.F; valid = r.valid;
    if (!valid) fErr = 'Temperature cross: this crossflow arrangement cannot reach the specified outlet temperatures.';
  } else if (arr === 'cross2') {
    const r = calcF_cross_mixed(R, P);
    F = r.F; valid = r.valid;
    if (!valid) fErr = 'Temperature cross: this crossflow arrangement cannot reach the specified outlet temperatures.';
  }
  return { lmtd, F: valid ? F : null, dT1, dT2, R, P, valid, nShellsNeeded, fErr };
}
// ─── TUBE-SIDE HTC ────────────────────────────────────────────────────────────
function calcHtube(fluid, massFlowKgS, Di_m, L_m, mu_wall_mPas) {
  // Tube-side HTC using:
  //   Laminar:     Sieder-Tate / Hausen with entry correction
  //   Transition:  Hausen (Re 2300-10000)
  //   Turbulent:   Gnielinski (Re > 10000) with thermal-entry factor
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
    // Gnielinski (1976) with the thermal-entry factor [1 + (D/L)^(2/3)] (VDI Atlas G1).
    // FIX 2026-10: the result was previously floored with max(…, Dittus-Boelter),
    // which made it non-conservative wherever Dittus-Boelter over-predicts.
    const f_gn = Math.pow(0.790 * Math.log(Math.max(Re, 10)) - 1.64, -2);
    Nu = (f_gn / 8) * (Re - 1000) * Pr / (1 + 12.7 * Math.sqrt(f_gn / 8) * (Math.pow(Pr, 2/3) - 1));
    Nu = Nu * (1 + Math.pow(Di_m / Math.max(L_m, 0.01), 2/3));
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

// ─── BELL-DELAWARE SHELL-SIDE (rewritten 2026-10) ───────────────────────────
// Taborek / HEDH method, all areas from one geometry function so that the
// heat-transfer (J-factors) and pressure-drop (R-factors) calculations use
// identical numbers.
//
// FIX 2026-10: the previous crossflow area was Sm = bsp_ratio·Ds·(PT−Do)/PT,
// which is baffle spacing × a ratio — a LENGTH, not an area (missing a factor
// of Ds). It overstated Sm by 1/Ds (4–7× for small shells), so shell-side h
// was too low and shell-side ΔP far too low. Replaced with the Taborek form:
//     Sm = B·[ L_bb + (D_ctl / P_tef)·(P_t − D_o) ]
//
// Layout conventions (Taborek):          P_tef      P_p (row pitch)
//   30° triangular                       P_t        0.866·P_t
//   45° rotated square                   0.707·P_t  0.707·P_t
//   90° square                           P_t        P_t
//
// Clearances:
//   δ_tb  tube-to-baffle hole, diametral — TEMA RCB-4.2: 0.8 mm (1/32") when the
//         maximum unsupported span ≤ 914 mm OR OD > 31.75 mm; 0.4 mm (1/64")
//         otherwise. (Previous code had this condition reversed.) The maximum
//         unsupported span is taken as 2×B (window tubes).
//   δ_sb  shell-to-baffle, diametral ≈ 1.6 + 0.004·Ds [mm] (TEMA RCB-4.3 fit)
//   L_bb  bundle-to-shell diametral gap by rear head (Taborek chart fits)
function layoutPitches(PT, pitchLayout) {
  if (pitchLayout === 'square')                                  return { Ptef: PT,         Pp: PT,         key: 90 };
  if (pitchLayout === 'rotated' || pitchLayout === 'rotated-square') return { Ptef: 0.707 * PT, Pp: 0.707 * PT, key: 45 };
  return { Ptef: PT, Pp: 0.866 * PT, key: 30 };                  // triangular (30°)
}
const _clamp1 = x => Math.max(-1, Math.min(1, x));

function bdLeakGeometry(shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, nTubes, headType = 'fixed', pitchLayout = 'triangular') {
  const Ds = shellID_m, Ds_mm = Ds * 1000, Do = OD_m;
  const PT = pitch_ratio * Do;
  const B  = bsp_ratio * Ds;
  const { Ptef, Pp, key } = layoutPitches(PT, pitchLayout);
  const L_bb = ((headType === 'pull-through' ? 95 : headType === 'split-ring' ? 35 : 12) + 0.005 * Ds_mm) / 1000;
  const Dotl = Math.max(Ds - L_bb, 2 * Do);
  const Dctl = Math.max(Dotl - Do, Do);
  // Crossflow area at the bundle centreline
  const Sm = B * (L_bb + (Dctl / Ptef) * (PT - Do));
  // Clearances
  const spanMax = 2 * B;
  const d_tb = (spanMax <= 0.914 || Do > 0.03175) ? 0.0008 : 0.0004;
  const d_sb = (1.6 + 0.004 * Ds_mm) / 1000;
  // Window geometry
  const Bc = bcut_frac;
  const theta_ds  = 2 * Math.acos(_clamp1(1 - 2 * Bc));
  const theta_ctl = 2 * Math.acos(_clamp1((Ds / Dctl) * (1 - 2 * Bc)));
  const F_w = (theta_ctl - Math.sin(theta_ctl)) / (2 * Math.PI);   // fraction of tubes in ONE window
  const F_c = Math.max(0, Math.min(1, 1 - 2 * F_w));               // fraction in pure crossflow
  // Leakage areas
  const S_tb = (Math.PI / 4) * ((Do + d_tb) ** 2 - Do * Do) * nTubes * (1 - F_w);
  const S_sb = Math.PI * Ds * (d_sb / 2) * (1 - theta_ds / (2 * Math.PI));
  const r_s  = S_sb / Math.max(S_sb + S_tb, 1e-12);
  const r_lm = Math.min((S_sb + S_tb) / Math.max(Sm, 1e-12), 0.8);
  // Bypass
  const S_b   = B * (Ds - Dotl);
  const F_sbp = Math.min(S_b / Math.max(Sm, 1e-12), 0.7);
  // Window flow area and hydraulic diameter
  const Swg = (Ds * Ds / 8) * (theta_ds - Math.sin(theta_ds));
  const Ntw = nTubes * F_w;
  const Swt = Ntw * Math.PI * Do * Do / 4;
  const Sw  = Math.max(Swg - Swt, 0.05 * Swg);
  const Dw  = 4 * Sw / (Math.PI * Do * Ntw + theta_ds * Ds);
  // Tube rows crossed: between baffle tips (Nc) and in each window (Ncw)
  const Nc  = Math.max(1, Ds * (1 - 2 * Bc) / Pp);
  const Ncw = Math.max(0.5, (0.8 / Pp) * (Bc * Ds - (Ds - Dctl) / 2));
  return { Sm, B, S_tb, S_sb, r_s, r_lm, S_b, F_sbp, Nc, Ncw, F_w, F_c, theta_ds, theta_ctl,
           d_tb, d_sb, L_bb, Dotl, Dctl, Swg, Sw, Dw, Ntw, Pp, Ptef, layoutKey: key };
}

// Taborek ideal-tube-bank j and f coefficients (Taborek, HEDH 3.3.5).
// Rows: [Re lower bound, coefficient, exponent]. Continuity of every row
// boundary is checked in the regression tests.
const TABOREK = {
  30: { a: [[1e4, 0.321, -0.388], [1e3, 0.321, -0.388], [100, 0.593, -0.477], [10, 1.360, -0.657], [0, 1.400, -0.667]], a3: 1.450, a4: 0.519,
        b: [[1e4, 0.372, -0.123], [1e3, 0.486, -0.152], [100, 4.570, -0.476], [10, 45.10, -0.973], [0, 48.00, -1.000]], b3: 7.00, b4: 0.500 },
  45: { a: [[1e4, 0.370, -0.396], [1e3, 0.370, -0.396], [100, 0.730, -0.500], [10, 1.498, -0.656], [0, 1.550, -0.667]], a3: 1.930, a4: 0.500,
        b: [[1e4, 0.303, -0.126], [1e3, 0.333, -0.136], [100, 3.500, -0.476], [10, 26.20, -0.913], [0, 32.00, -1.000]], b3: 6.59, b4: 0.520 },
  90: { a: [[1e4, 0.370, -0.395], [1e3, 0.107, -0.266], [100, 0.408, -0.460], [10, 0.900, -0.631], [0, 0.970, -0.667]], a3: 1.187, a4: 0.370,
        b: [[1e4, 0.391, -0.148], [1e3, 0.0815, 0.022], [100, 6.090, -0.602], [10, 32.10, -0.963], [0, 35.00, -1.000]], b3: 6.30, b4: 0.378 },
};
function taborekIdeal(Re, pitch_ratio, layoutKey) {
  const T  = TABOREK[layoutKey] || TABOREK[30];
  const R  = Math.max(Re, 1);
  const pick = rows => rows.find(r => R >= r[0]) || rows[rows.length - 1];
  const [, a1, a2] = pick(T.a), [, b1, b2] = pick(T.b);
  const a  = T.a3 / (1 + 0.14 * Math.pow(R, T.a4));
  const bb = T.b3 / (1 + 0.14 * Math.pow(R, T.b4));
  return {
    j: a1 * Math.pow(1.33 / pitch_ratio, a)  * Math.pow(R, a2),
    f: b1 * Math.pow(1.33 / pitch_ratio, bb) * Math.pow(R, b2),
  };
}

function calcBellDelaware(fluid, massFlowKgS, shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, L_m, nTubes,
                          tema = 'C', pitchLayout = 'triangular', headType = 'fixed') {
  const { rho, mu: mu_mPas, cp, k } = fluid;
  const mu = mu_mPas * 1e-3;
  const g  = bdLeakGeometry(shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, nTubes, headType, pitchLayout);
  const G_s  = massFlowKgS / Math.max(g.Sm, 1e-9);
  const Re_s = G_s * OD_m / mu;
  const Pr_s = Math.max(mu * cp * 1000 / k, 0.5);
  const { j: jh, f: f_ideal } = taborekIdeal(Re_s, pitch_ratio, g.layoutKey);
  // h_ideal = j·cp·G·Pr^(−2/3). The (μ/μw)^0.14 factor is applied by the caller
  // (calcShellTube) — do NOT add it here as well.
  const h_ideal = jh * cp * 1000 * G_s * Math.pow(Pr_s, -2 / 3);
  // Jc — baffle cut
  const Jc = 0.55 + 0.72 * g.F_c;
  // Jl — leakage
  const Jl = Math.max(0.2, 0.44 * (1 - g.r_s) + (1 - 0.44 * (1 - g.r_s)) * Math.exp(-2.2 * g.r_lm));
  // Jb — bypass (no sealing strips modelled → r_ss = 0, conservative)
  const Nss  = 0;
  const r_ss = Nss / Math.max(g.Nc, 1);
  const C_j  = Re_s < 100 ? 1.35 : 1.25;
  const Jb   = r_ss >= 0.5 ? 1.0 : Math.exp(-C_j * g.F_sbp * (1 - Math.cbrt(Math.max(2 * r_ss, 0))));
  // Jr — adverse temperature gradient in laminar flow (Taborek)
  const nBaffles = Math.max(1, Math.round(L_m / Math.max(g.B, 0.001) - 1));
  const Nct = (nBaffles + 1) * (g.Nc + g.Ncw);
  const Jrr = Math.max(0.4, Math.pow(10 / Math.max(Nct, 1), 0.18));
  const Jr  = Re_s <= 20 ? Jrr : Re_s < 100 ? Jrr + (1 - Jrr) * (Re_s - 20) / 80 : 1.0;
  // Js — unequal end spacing (inlet/outlet spacing = central spacing assumed)
  const Js = 1.0;
  const Jtotal = Jc * Jl * Jb * Jr * Js;
  return { hShell: h_ideal * Jtotal, hTube: 0, Jc, Jl, Jb, Jr, Js, Jtotal, jh, f_ideal,
           shellVel: G_s / rho, shellRe: Re_s, G_s, nBaffles, leakGeom: g, r_ss };
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
  // otherwise assume nozzle velocity ≈ tube velocity (2 velocity heads for the pair).
  let dP_nozzle;
  if (nozzle_id_m && nozzle_id_m > 0) {
    const A_noz = Math.PI * nozzle_id_m * nozzle_id_m / 4;
    const v_noz = massFlowKgS / (rho * Math.max(A_noz, 1e-8));
    dP_nozzle   = 1.5 * rho * v_noz * v_noz / 2;
  } else {
    dP_nozzle = 2.0 * dyn;
  }

  return Math.max((dP_friction+dP_entry_exit+dP_returns+dP_nozzle)/1e5, 0);
}

// ─── BELL-DELAWARE SHELL-SIDE PRESSURE DROP (Taborek, rewritten 2026-10) ────
//   Ideal crossflow, one central section:  Δp_bi = 2·f_i·N_c·G²/ρ
//   Ideal window, one window:
//       turbulent (Re ≥ 100): Δp_wi = (2 + 0.6·N_cw)·G_w²/(2ρ)
//       laminar   (Re < 100): Δp_wi = 26·μ·G_w/ρ·[N_cw/(P_t−D_o) + B/D_w²] + G_w²/ρ
//       with G_w = ṁ/√(S_m·S_w)
//   Totals: central Δp_c = (N_b−1)·Δp_bi·R_b·R_l
//           windows Δp_w = N_b·Δp_wi·R_l
//           ends    Δp_e = 2·Δp_bi·(1 + N_cw/N_c)·R_b·R_s     (R_s = 1, equal end spacing)
// Previous version used non-standard friction factors (0.26–0.8× Taborek),
// applied R_b to the windows and used the dimensionally wrong S_m above.
// Nozzle losses are NOT included (nozzle sizes are not an input).
function calcBellDelawareDPdetail(fluid, massFlowKgS, shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, L_m, nTubes,
                                  bdHtcResult, pitchLayout = 'triangular', headType = 'fixed') {
  const { rho, mu: mu_mPas } = fluid;
  const mu = mu_mPas * 1e-3;
  const g  = bdLeakGeometry(shellID_m, OD_m, pitch_ratio, bcut_frac, bsp_ratio, nTubes, headType, pitchLayout);
  const PT = pitch_ratio * OD_m;
  const G  = massFlowKgS / Math.max(g.Sm, 1e-9);
  const Re = G * OD_m / mu;
  const { f } = taborekIdeal(Re, pitch_ratio, g.layoutKey);
  const dP_bi = 2 * f * g.Nc * G * G / rho;
  const G_w = massFlowKgS / Math.sqrt(Math.max(g.Sm * g.Sw, 1e-12));
  const dP_wi = Re >= 100
    ? (2 + 0.6 * g.Ncw) * G_w * G_w / (2 * rho)
    : 26 * mu * G_w / rho * (g.Ncw / Math.max(PT - OD_m, 1e-4) + g.B / Math.max(g.Dw * g.Dw, 1e-8)) + G_w * G_w / rho;
  const r_ss = bdHtcResult?.r_ss || 0;
  const p_exp = 0.8 - 0.15 * (1 + g.r_s);
  const Rl = Math.exp(-1.33 * (1 + g.r_s) * Math.pow(Math.max(g.r_lm, 1e-9), p_exp));
  const C_bp = Re < 100 ? 4.5 : 3.7;
  const Rb = r_ss >= 0.5 ? 1.0 : Math.exp(-C_bp * g.F_sbp * (1 - Math.cbrt(Math.max(2 * r_ss, 0))));
  const Nb = Math.max(1, Math.round(L_m / Math.max(g.B, 0.001) - 1));
  const dP_c = Math.max(Nb - 1, 0) * dP_bi * Rb * Rl;
  const dP_w = Nb * dP_wi * Rl;
  const dP_e = 2 * dP_bi * (1 + g.Ncw / g.Nc) * Rb;
  const total = (dP_c + dP_w + dP_e) / 1e5;
  return { total: Math.max(total, 0), crossflow_bar: dP_c / 1e5, window_bar: dP_w / 1e5, ends_bar: dP_e / 1e5,
           Rl, Rb, f_ideal: f, Re, Nb, Nc: g.Nc, Ncw: g.Ncw };
}
function calcBellDelawareDP(...args) { return calcBellDelawareDPdetail(...args).total; }

// Notes for results when a property came from a generic estimate (NEW 2026-10)
function viscNotes(...fluids) {
  const out = [];
  for (const f of fluids) {
    if (!f) continue;
    if (f.viscModel === 'walther') out.push(`ℹ ${f.name}: viscosity follows a generic mineral-oil curve (Walther) anchored at 20 °C — use the actual oil data for final design.`);
    else if (f.viscModel === 'andrade') out.push(`ℹ ${f.name}: viscosity follows a generic temperature curve anchored at 20 °C — use measured data for final design.`);
    else if (f.viscModel === 'constant' && f._src !== 'coolprop' && !f._isGas) out.push(`ℹ ${f.name}: properties are constant (20 °C values) — no temperature data in the library.`);
  }
  return [...new Set(out)];
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
  const out = [], pinched = [];
  for (const z of zones) {
    const Tc1 = p.cTo - Qcum / (p.massC * cpC);
    const Tc2 = p.cTo - (Qcum + z.Q) / (p.massC * cpC);
    const dTm = zoneLMTD(z.Th1, z.Th2, Tc1, Tc2);
    if (!dTm) { pinched.push(z.name); Qcum += z.Q; continue; }   // temperature cross inside this zone
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
      const gLkC = bdLeakGeometry(p.shellID, p.OD, p.pitch, p.bcut, p.bsp, p.nTubes, 'fixed', p.pitchLayout);
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
  return { A_total, zones: out, Qtot, mode: 'condensing', pinched };
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
  const out = [], pinched = [];
  const cVap = fluidAtConditions(vapKey, p.Tsat, p.cPop);
  for (const z of zones) {
    const Th1 = p.hTi - Qcum / (p.massH * cpH);
    const Th2 = p.hTi - (Qcum + z.Q) / (p.massH * cpH);
    let Tc1, Tc2;
    if (z.kind === 'boil') { Tc1 = p.Tsat; Tc2 = p.Tsat; }
    else { Tc1 = p.Tsat; Tc2 = p.cTi; }   // preheat zone, counter-current
    const dTm = zoneLMTD(Th1, Th2, Tc1, Tc2);
    if (!dTm) { pinched.push(z.name); Qcum += z.Q; continue; }
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
  return { A_total, zones: out, Qtot: p.Qhot, x_exit, Q_preheat, dryout, mode: 'evaporating', pinched };
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
  // Nozzle ID estimated (see below), capped 50-600 mm — an ESTIMATE, flagged
  // as such; supply the real nozzle for a firm check.
  // Liquids: the larger of Ds/3 and the bore that keeps ρv² ≈ 2100 (below the
  // 2232 TEMA limit), but no larger than Ds/2.
  const d_rv2 = p.isGas ? 0 : Math.sqrt(4 * p.massH_kgs / (Math.PI * Math.sqrt(2100 * p.rhoShell)));
  const d_noz = Math.min(Math.max(p.shellID / 3, d_rv2 && Math.min(d_rv2, p.shellID / 2), 0.05), 0.6);
  const v_noz = p.massH_kgs / (p.rhoShell * Math.PI * d_noz * d_noz / 4);
  const rhoV2 = p.rhoShell * v_noz * v_noz;                              // kg/(m·s²)
  const impingementNeeded = p.isGas ? true : rhoV2 > 2232;               // vapours: always per TEMA
  const impingementNote = p.isGas
    ? 'vapour/gas service — specify an impingement plate or vapour belt at the shell inlet (TEMA RCB-4.6)'
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
// ─── SHELL & TUBE — AUTO TUBE PASSES (NEW 2026-10) ──────────────────────────
// In target-velocity mode the UI promises that the tool chooses the number of
// tube passes; the backend never did. This wrapper tries the user's pass count
// and then 2/4/6/8 passes per shell, and keeps the first one that reaches 90 %
// of the target tube velocity within the allowable tube ΔP. If none does, it
// keeps the highest-velocity option that respects the tube ΔP.
// Skipped for: fixed tube count, 'keep my passes', 1-1 (true counterflow) and
// evaporating service (boiling in tubes — velocity target not meaningful).
function calcShellTube(b) {
  const basePasses = b.hxType==='1-1'?1 : b.hxType==='1-2'?2 : b.hxType==='1-4'?4 : b.hxType==='1-6'?6 : b.hxType==='1-8'?8 : 2;
  if (b.velMode === 'fixedtubes' || b.autoPasses === false || b.velMode === 'targetKeepPasses'
      || b.hxType === '1-1' || b.shellMode === 'evaporating') {
    const r = calcShellTubeCore(b);
    r.passesAuto = null;
    return r;
  }
  const cands = [basePasses, ...[2, 4, 6, 8].filter(n => n > basePasses)];
  const tried = [];
  let best = null, firstErr = null;
  for (const np of cands) {
    let r;
    try { r = calcShellTubeCore({ ...b, passesOverride: np }); }
    catch (e) { if (np === basePasses) firstErr = e; continue; }
    tried.push(r);
    if (r.tubeVel >= 0.9 * r.targetVel && r.tubeDp <= r.pdAllowTube) { best = r; break; }
  }
  if (!tried.length) throw firstErr || new Error('Shell & tube calculation failed');
  if (!best) {
    const okDp = tried.filter(r => r.tubeDp <= r.pdAllowTube);
    best = okDp.length ? okDp.reduce((a, c) => (c.tubeVel > a.tubeVel ? c : a)) : tried[0];
  }
  best.passesAuto = { base: basePasses, chosen: best.nPasses,
    tried: tried.map(r => ({ passes: r.nPasses, tubes: r.numTubes, vel: +r.tubeVel.toFixed(2), dPt: +r.tubeDp.toFixed(3), area: +r.area.toFixed(2) })) };
  if (best.nPasses !== basePasses)
    best.warns.unshift(`ℹ Tube passes set to ${best.nPasses} per shell (you selected ${basePasses}) to reach the target tube velocity within the allowable tube ΔP.`);
  return best;
}

function calcShellTubeCore(b) {
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

  // ── Thermal mode — declared here because the hot-side temperature validation
  //    below depends on it (was previously declared after the Q block).
  const shellMode  = b.shellMode || 'single-phase';

  // ── FIX (2026-07): hot-side temperature validation is now PHASE-AWARE ──────
  // The old rule `hTo >= hTi → error` is only correct for sensible-heat duty.
  // In a total condenser handling a saturated vapour with no subcooling, the
  // stream enters and leaves at the SAME temperature (both at Tsat) and all of
  // the duty is latent:  Q = m·hvap.  Rejecting hTi = hTo made the single most
  // common condenser case impossible to enter.
  //   • condensing  : hTo may equal hTi (pure latent), or be below it
  //                   (subcooling), but never above it.
  //   • single-phase: strict decrease still required — hTi = hTo would mean
  //                   Q = 0, which is not a heat exchanger.
  if (shellMode === 'condensing') {
    if (hTo > hTi + 1e-9) {
      throw new Error(
        'Hot outlet cannot be above hot inlet. For a total condenser with no ' +
        'subcooling set outlet = inlet (both at the saturation temperature); ' +
        'for a subcooling condenser set outlet below it.'
      );
    }
  } else if (hTo >= hTi) {
    throw new Error(
      shellMode === 'evaporating'
        ? 'Hot outlet must be less than hot inlet temperature — in evaporating mode the hot stream gives up sensible heat.'
        : 'Hot outlet must be less than hot inlet temperature. If the hot stream is condensing at constant temperature, set Thermal Mode to "Condensing".'
    );
  }

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
  // shellMode is declared above (needed by the hot-side temperature validation)

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
  // nPasses = tube passes PER SHELL. '2-4' is modelled as two 1-2 shells in
  // series (4 tube passes in total) — FIX 2026-10: previously all tubes were
  // placed in one shell with 4 passes while F used two shells.
  const nPasses = parseInt(b.passesOverride) || (b.hxType==='1-1'?1 : b.hxType==='1-2'?2 : b.hxType==='1-4'?4 : b.hxType==='1-6'?6 : b.hxType==='1-8'?8 : b.hxType==='2-4'?2 : 2);
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
  let bsp_ratio=parseFloat(b.bsp)||0.50;          // may be re-chosen per geometry in auto mode
  const bspMode = b.bspMode === 'auto' ? 'auto' : 'fixed';
  const headType = b.headType || 'fixed';
  const velMode=(b.velMode==='fixedtubes')?'fixedtubes':'target';   // 'manual'/'targetKeepPasses' behave as target here
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
  // Initial (velocity-based) geometry
  const numTubes_geo=numTubes, nTubesPerPass_geo=nTubesPerPass, shellID_geo=shellID;
  const isHotGas  = hFluidDB.rho < GAS_RHO_THRESHOLD;
  const isColdGas = cFluidDB.rho < GAS_RHO_THRESHOLD;

  // FIX 2026-10 — thermal evaluation FOR A GIVEN GEOMETRY (tube count per shell,
  // tubes per pass, shell ID). Called repeatedly by the geometry loop below so
  // that the U used to size the area always belongs to the geometry reported.
  function evaluateGeometry(numTubes_geo, nTubesPerPass_geo, shellID_geo, U_start) {
  // ═══════════════════════════════════════════════════════════════════════════
  // U CONVERGENCE ITERATION LOOP
  // Geometry is FIXED. Only fluid properties and film coefficients iterate.
  // Strategy: iterate U_assumed → compute hi, ho → compute U_actual
  //           repeat until |U_actual - U_assumed| / U_assumed < tolerance
  // ═══════════════════════════════════════════════════════════════════════════
  const U_CONV_TOL = 0.005;   // 0.5% convergence criterion
  const MAX_ITER   = 20;       // safety cap
  const U_CONV_RELAX = 0.6;   // under-relaxation factor (prevents oscillation)

  let U_seed = U_start || (shellMode==='condensing' ? 2000 :
               shellMode==='evaporating' ? 1500 :
               (isHotGas || isColdGas) ? 80 : 800);

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
      bdRes_iter  = calcBellDelaware(hFluid, massH, shellID_geo, OD, pitch, bcut_frac, bsp_ratio, L_eff, numTubes_geo, tema, pitchLayout, b.headType || 'fixed');
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
  // FIX (2026-07): when the shell side is condensing, the shell coefficient
  // comes from the Nusselt film correlation and Bell-Delaware is never run, so
  // bdRes_iter is null. The old stub omitted Jtotal / jh / nBaffles entirely,
  // which crashed the results renderer on `bdCorr.Jtotal.toFixed(3)`. That was
  // unreachable before, because condensing always failed validation first.
  // The stub is now shape-complete and flags itself as not-Bell-Delaware, so
  // the UI can say so instead of printing correction factors of 1.000 that
  // would imply the method ran and found nothing to correct.
  const bdRes  = bdRes_iter
    ? { ...bdRes_iter, bdApplicable: true }
    : { hShell:hShell_iter, shellRe:0, Jc:1, Jl:1, Jb:1, Jr:1, Js:1, Jtotal:1,
        jh:null, shellVel:null, nBaffles:null, hTube:hTube_iter,
        bdApplicable:false,
        bdNote:'Bell-Delaware shell-side correction not applicable — shell coefficient from phase-change correlation.' };
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
  if (lmtdRes.valid === false) throw new Error(lmtdRes.fErr || 'Temperature cross — F correction factor undefined');
  const {lmtd, F, dT1, dT2} = lmtdRes;
  const FLMTD = lmtd * F;

  // ── Final heat balance — use latent heat for phase-change modes ──────────
  let Qh, Qc, Q, balErr;
  const Wh = massH * hFluid.cp;   // kW/K — needed for NTU/eff below
  const Wc = massC * cFluid.cp;
  if (shellMode === 'condensing') {
    Qh = Qhot;
    Qc = massC * cFluid.cp * (cTo - cTi);
    Q  = (Qh + Qc) / 2;
    balErr = Math.abs(Qh - Qc) / Math.max(Qh, Qc, 0.001) * 100;
  } else if (shellMode === 'evaporating') {
    // FIX 2026-10: the cold side absorbs preheat + LATENT heat. Previously only the
    // sensible part (≈0 at a saturated inlet) was counted, which halved Q.
    const Tsat_c = phaseZones?.Tsat ?? cTo;
    const Qc_cap = massC * (cFluid.cp * Math.max(Tsat_c - cTi, 0) + (phaseZones?.hvap_kJkg || 0));
    Qh = Qhot;
    Qc = Math.min(Qhot, Qc_cap);
    Q  = Qhot;
    balErr = Math.abs(Qh - Qc) / Math.max(Qh, 0.001) * 100;
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

    return { converged, U, U_clean, hShell, hTube, bdRes, lmtdRes, lmtd, F, dT1, dT2, FLMTD,
             Qh, Qc, Q, balErr, Wh, Wc, zoneModel, dryoutWarn, area, U_effective,
             iterCount, U_deviation_pct, U_seed, iterHistory, lmtdArr, _numTubes: numTubes_geo };
  } // end evaluateGeometry

  // ── FIX 2026-10: GEOMETRY ⇄ U CONSISTENCY LOOP ────────────────────────────
  // Previously U was computed once for the velocity-based tube count and was NOT
  // recomputed when the area check added tubes. More tubes → lower tube velocity
  // and a bigger shell → lower h_tube and h_shell, so the reported design could be
  // ~25 % undersized while showing positive oversurface. Now the tube count is
  // re-evaluated until it stops changing (A ∝ N^<1, so this converges quickly).
  // NEW 2026-10 — AUTO BAFFLE SPACING. With a fixed spacing ratio, adding tubes
  // enlarges the shell, lowers the shell-side velocity and h, and the design can
  // run away (viscous shell fluids especially). In auto mode the spacing is set
  // per geometry to use ~90 % of the allowable shell ΔP, bounded by
  //   B ≥ max(0.2·Ds, 50.8 mm)              (TEMA minimum)
  //   2·B ≤ TEMA maximum unsupported span    (window tubes)
  //   B ≤ L/2                                (at least one baffle)
  // Condensing shells use half the all-vapour ΔP (Kern's rule).
  const dpShellFluid = fluidAtConditions(hFlKey, hTmean, hPop);
  const dpFactor = shellMode === 'condensing' ? 0.5 : 1.0;
  const L_temaSpan = (56.06 * (OD * 1000) + 455.9) / 1000;
  function autoBaffleRatio(nT, Ds) {
    const target = 0.9 * pdAllowShell / nShells;
    const dp = r => calcBellDelawareDPdetail(dpShellFluid, massH, Ds, OD, pitch, bcut_frac, r, L_eff, nT, null, pitchLayout, headType).total * dpFactor;
    // TEMA allows 0.2·Ds, but below ≈0.3·Ds the leakage streams grow (Jl < 0.55)
    // and ΔP rises 2–3× for a few % more h — not worth it in an automatic choice.
    const rMin = Math.max(0.3, 0.0508 / Ds);
    const rMax = Math.max(rMin, Math.min(1.0, L_temaSpan / (2 * Ds), L_eff / (2 * Ds)));
    // Condensing: h barely depends on baffle spacing, while ΔP and vapour
    // velocity fall steeply with it — use the widest spacing TEMA allows.
    if (shellMode === 'condensing') return rMax;
    if (dp(rMin) <= target) return rMin;
    if (dp(rMax) > target) return rMax;
    let lo = rMin, hi = rMax;
    for (let i = 0; i < 40; i++) { const mid = 0.5 * (lo + hi); if (dp(mid) > target) lo = mid; else hi = mid; }
    return hi;
  }
  let geo = { numTubes: numTubes_geo, nTPP: nTubesPerPass_geo, shellID: shellID_geo };
  let ev = null, geoIterations = 0, geoConverged = (velMode === 'fixedtubes');
  const geoHistory = [];
  for (let gi = 0; gi < 30; gi++) {
    geoIterations = gi + 1;
    if (bspMode === 'auto') bsp_ratio = autoBaffleRatio(geo.numTubes, geo.shellID);
    ev = evaluateGeometry(geo.numTubes, geo.nTPP, geo.shellID, ev ? ev.U : null);
    const nArea = Math.max(nPasses, Math.ceil(ev.area / (Math.PI * OD * L_eff * nShells) / nPasses) * nPasses);
    geoHistory.push({ iter: geoIterations, numTubes: geo.numTubes, shellID_mm: Math.round(geo.shellID * 1000),
                      U: +ev.U.toFixed(1), area_m2: +ev.area.toFixed(3), tubesNeeded: nArea });
    if (velMode === 'fixedtubes') break;
    if (nArea <= geo.numTubes) { geoConverged = true; break; }
    geo = { numTubes: nArea, nTPP: nArea / nPasses, shellID: estimateShellID(nArea) };
  }
  if (ev._numTubes !== geo.numTubes) {
    if (bspMode === 'auto') bsp_ratio = autoBaffleRatio(geo.numTubes, geo.shellID);
    ev = evaluateGeometry(geo.numTubes, geo.nTPP, geo.shellID, ev.U);
  }
  const { converged, U, U_clean, hShell, hTube, bdRes, lmtdRes, lmtd, F, dT1, dT2, FLMTD,
          Qh, Qc, Q, balErr, Wh, Wc, zoneModel, dryoutWarn, area, U_effective,
          iterCount, U_deviation_pct, U_seed, iterHistory, lmtdArr } = ev;
  const Ao_Ai = OD / Di;

  let numTubes_final = geo.numTubes;
  let nTubesPerPass_final = geo.nTPP;
  let shellID_final = geo.shellID;
  let area_enforcement_note = null;
  let dualObjectiveFeasible = true;
  if (velMode !== 'fixedtubes' && numTubes_final > numTubes_geo && shellMode !== 'evaporating') {
    const vel_at_area = massC / (nTubesPerPass_final * cFluid.rho * A_tube);
    if (vel_at_area < targetVel * 0.9) {
      dualObjectiveFeasible = false;
      area_enforcement_note = (vel_at_area >= targetVel * 0.75 && vel_at_area >= 0.5 ? 'ℹ ' : '') +
        `Required area ${area.toFixed(1)} m² needs ${numTubes_final} tubes${nShells > 1 ? ' per shell' : ''} at L = ${L_eff.toFixed(2)} m, ` +
        `which gives a tube velocity of ${vel_at_area.toFixed(2)} m/s (target ${targetVel} m/s). Area takes priority — ` +
        `the Design Advisor lists standard changes that meet both.`;
    } else {
      area_enforcement_note =
        `ℹ Tube count raised from ${numTubes_geo} to ${numTubes_final}${nShells > 1 ? ' per shell' : ''} to meet the required area (U re-evaluated at the final geometry).`;
    }
  }
  if (!geoConverged) area_enforcement_note = (area_enforcement_note ? area_enforcement_note + ' ' : '') +
    'Tube count did not settle within 30 geometry passes — check inputs.';

  const area_provided = Math.PI * OD * L_eff * numTubes_final * nShells;
  const overSurf = (area_provided / area - 1) * 100;
  // ── NTU / EFFECTIVENESS — phase-aware capacity rates (FIX 2026-07) ────────
  // A stream undergoing phase change exchanges heat at essentially constant
  // temperature, so its capacity rate C = Q/ΔT → ∞ and the capacity ratio
  // Cr → 0. The old code used C = ṁ·cp for BOTH streams unconditionally. For a
  // condenser that takes cp of the VAPOUR, giving a tiny C that then wins
  // Math.min() and becomes Cmin — producing nonsense like ε = 3999 % and
  // NTU = 47 on a duty whose true values are ε ≈ 27 % and NTU ≈ 0.31.
  //
  // The effective capacity rate Q/ΔT is exact for any process: for a purely
  // sensible stream it reduces identically to ṁ·cp (since Q = ṁ·cp·ΔT), and
  // for an isothermal one it correctly diverges. It is applied only to the
  // side that is actually changing phase, so the validated single-phase path
  // is untouched.
  const _dTh = hTi - hTo, _dTc = cTo - cTi;
  const Wh_eff = (shellMode === 'condensing')
    ? (_dTh > 0.01 ? Q / _dTh : Infinity) : Wh;
  const Wc_eff = (shellMode === 'evaporating')
    ? (_dTc > 0.01 ? Q / _dTc : Infinity) : Wc;

  const Cmin = Math.min(Wh_eff, Wc_eff);
  const Cmax = Math.max(Wh_eff, Wc_eff);
  const Cr   = isFinite(Cmax) && Cmax > 0 ? Cmin / Cmax : 0;
  // NTU must use the U that is consistent with the reported area and LMTD.
  // When a zone model is active the required area is zone-summed (each zone
  // carrying its own U and its own driving force), so pairing it with the
  // single-point U overstates UA by ~4 % and NTU stops reconciling with ε.
  // U_effective = Q/(A·F·LMTD) is exactly the U that closes that loop.
  const NTU  = area * (U_effective || U) / Math.max(Cmin * 1000, 0.001);
  const Qmax = Cmin * (hTi - cTi);
  const eff  = Qmax > 0 ? Q / Qmax : 0;

  // ── GAS/STEAM SHELL AUTO-RESIZE ────────────────────────────────────────────
  // For gas/steam on shell side: if crossflow velocity > 30 m/s, the shell is
  // undersized. Auto-step through TEMA standard IDs until velocity is acceptable,
  // then recompute ΔP with the correctly sized shell.
  // This prevents the formula from returning physically impossible ΔP values and
  // gives the engineer a valid starting point for gas-service design.
  let shellID_gas = shellID_final;     // may be enlarged below
  let shellDP_gas_resized = false;
  let gasResizeNote = null;
  let shellDPd = calcBellDelawareDPdetail(hFluid, massH, shellID_final, OD, pitch, bcut_frac, bsp_ratio, L_eff, numTubes_final, bdRes, pitchLayout, b.headType || 'fixed');
  let shellDP = shellDPd.total * nShells * dpFactor;
  // Condensing shells: vapour velocity at the inlet is the governing check
  let condVapourVel = null;
  if (shellMode === 'condensing') {
    const Sm_c = bdLeakGeometry(shellID_final, OD, pitch, bcut_frac, bsp_ratio, numTubes_final, headType, pitchLayout).Sm;
    condVapourVel = massH / Math.max(Sm_c * hFluid.rho, 1e-9);
  }

  if (isHotGas && shellMode !== 'condensing') {
    // FIX (2026-07): the 30 m/s erosion limit and the shell auto-resize that
    // follows are a SINGLE-PHASE gas-service rule. In a condenser the vapour is
    // being destroyed as it flows — volumetric flow falls from full inlet rate
    // to near zero at the outlet — so sizing the whole shell on the inlet
    // velocity is not meaningful. Applied to steam at 0.20 bar it demanded a
    // 3550 mm shell and reported "infeasible", while the actual computed
    // shell-side ΔP was 0.038 bar against 0.70 bar allowable. Condenser vapour
    // belt / inlet nozzle sizing is a separate check, not a shell diameter one.
    const GAS_VEL_LIMIT = 30; // m/s — erosion/vibration limit for shell-side gas
    const pitch_m = pitch * OD;
    const Sm_current = bdLeakGeometry(shellID_final, OD, pitch, bcut_frac, bsp_ratio, numTubes_final, b.headType || 'fixed', pitchLayout).Sm;
    const shellVelCheck = massH / Math.max(Sm_current * hFluid.rho, 1e-9);

    if (shellVelCheck > GAS_VEL_LIMIT) {
      // Step through TEMA standard shells to find minimum size that works
      let foundGasShell = false;
      for (const D_mm of TEMA_SHELL_IDS_MM) {
        const D_m = D_mm / 1000;
        const Sm_try = bdLeakGeometry(D_m, OD, pitch, bcut_frac, bsp_ratio, numTubes_final, b.headType || 'fixed', pitchLayout).Sm;
        const vel_try = massH / Math.max(Sm_try * hFluid.rho, 1e-9);
        if (vel_try <= GAS_VEL_LIMIT) {
          shellID_gas = D_m;
          shellDP_gas_resized = true;
          // Recompute ΔP with the gas-appropriate shell (but keep tube geometry unchanged)
          shellDPd = calcBellDelawareDPdetail(hFluid, massH, D_m, OD, pitch, bcut_frac, bsp_ratio, L_eff, numTubes_final, bdRes, pitchLayout, b.headType || 'fixed');
          shellDP = shellDPd.total * nShells * dpFactor;
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
        // Sm ≈ B·Ds·(PT−Do)/PT = bsp_ratio·Ds²·(PT−Do)/PT  →  Ds = √(Sm·PT / (bsp_ratio·(PT−Do)))
        const Sm_needed = massH / (hFluid.rho * GAS_VEL_LIMIT);
        const shellID_needed_mm = Math.round(Math.sqrt(Sm_needed * pitch_m / (bsp_ratio * (pitch_m - OD))) * 1000);
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
  const tubeDp = calcPressDropTube(cFluid, massC / nTubesPerPass_final, Di, L_eff, nPasses) * nShells;

  const warns = [];
  if (dryoutWarn) warns.push(dryoutWarn);
  if (area_enforcement_note) warns.push(area_enforcement_note.startsWith('ℹ') ? area_enforcement_note : '⚠ ' + area_enforcement_note);
  if (!converged) warns.push(`⚠ U convergence not fully achieved after ${iterCount} iterations — final deviation ${U_deviation_pct.toFixed(2)}%`);

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
      `⚠ Shell OD ≈ ${shellOD_approx_mm.toFixed(0)} mm exceeds your ${shell_OD_max} mm space limit. ` +
      `Use Design Advisor (Lever B/C/D) to find configurations that fit within the available bay width.`
    );
  }
  if (!shellID_detail.isStandard) {
    warns.push(`⚠ Shell ID ${shellID_detail.D_min_mm.toFixed(0)} mm exceeds largest TEMA standard shell (1524 mm). Verify with vessel manufacturer.`);
  } else if (shellID_detail.prevSize_mm) {
    const gap = shellID_detail.D_std_mm - shellID_detail.D_min_mm;
    if (gap > 50) warns.push(`ℹ Shell ID rounded UP from calculated ${shellID_detail.D_min_mm.toFixed(0)} mm to TEMA standard ${shellID_detail.D_std_mm} mm — ${gap.toFixed(0)} mm headroom available.`);
  }

  // Velocity diagnostics (the area note above already explains area-driven low velocity)
  if (tubeVel < 0.5 && dualObjectiveFeasible && shellMode !== 'evaporating') {
    warns.push(`⚠ Tube velocity ${tubeVel.toFixed(2)} m/s is below 0.5 m/s — fouling risk. Raise the target velocity or use more tube passes.`);
  }
  if (tubeVel > 4) warns.push('⚠ Tube velocity above 4 m/s — erosion risk. Increase tube count or OD.');
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
  if (F < 0.75 && shellMode === 'single-phase') warns.push(`⚠ F correction factor ${F.toFixed(3)} < 0.75 — the temperature approach is too tight for this shell arrangement${lmtdRes.nShellsNeeded ? `; ${lmtdRes.nShellsNeeded} 1-2 shells in series would bring F above 0.75` : ''}.`);
  if (shellDP > pdAllowShell) warns.push(`✗ Shell ΔP ${shellDP.toFixed(3)} bar exceeds the allowable ${pdAllowShell} bar — ${bspMode === 'auto' ? 'even at the widest allowed baffle spacing; ' : 'increase baffle spacing or baffle cut; '}${isHotGas ? 'for a gas, consider putting it on the tube side or using a larger shell.' : 'or use a larger shell / split flow.'}`);
  if (shellMode === 'evaporating') {
    warns.push('ℹ Tube-side ΔP is for liquid only — two-phase boiling ΔP will be several times higher.');
    // Horizontal in-tube boiling stratifies at low mass flux, leaving the upper
    // wall dry; the flow-boiling correlation then over-predicts h.
    const G_tube = massC / (nTubesPerPass_final * A_tube);
    if (G_tube < 50) warns.push(`⚠ Tube-side mass flux ${G_tube.toFixed(0)} kg/m²s is low for boiling in horizontal tubes — stratified flow is likely and the boiling coefficient may be optimistic. Use more tube passes (typically 75–300 kg/m²s).`);
  }
  if (tubeDp > pdAllowTube)   warns.push(`✗ Tube ΔP ${tubeDp.toFixed(3)} bar exceeds the allowable ${pdAllowTube} bar — reduce passes or tube velocity.`);
  if (overSurf < 0) warns.push(`✗ Insufficient area (${overSurf.toFixed(1)} %) — increase tube length or passes.`);
  else if (overSurf < 5) warns.push(velMode === 'fixedtubes'
    ? `⚠ Area margin ${overSurf.toFixed(1)} % is below 5 % — little allowance beyond the fouling resistances.`
    : `ℹ Tubes sized to the required area (margin ${overSurf.toFixed(1)} %); the fouling resistances are the design allowance — add tubes if you want extra margin.`);
  if (overSurf > 30 && velMode !== 'fixedtubes') {
    const TEMA_L = [1.83, 2.44, 3.05, 3.66, 4.27, 4.88, 6.10];
    const L_need = L_eff * (area / area_provided) * 1.10;          // keep ≈10 % margin
    const L_std = TEMA_L.find(x => x >= L_need && x < L_eff - 0.01);
    warns.push(`ℹ Oversurface ${overSurf.toFixed(0)} % — the velocity target needs more tubes than the area requires.` +
      (L_std ? ` A shorter standard tube (${L_std} m) would still give ≈${((L_std / L_eff) * (area_provided / area) * 100 - 100).toFixed(0)} % margin.` : ''));
  }
  if (zoneModel && zoneModel.pinched && zoneModel.pinched.length)
    warns.push(`✗ Temperature cross inside ${zoneModel.pinched.length} zone(s) (${zoneModel.pinched.slice(0, 3).join(', ')}) — the duty cannot be met at these temperatures; increase coolant flow or lower its inlet temperature.`);
  if (shellMode === 'condensing')
    warns.push('ℹ Condensing shell ΔP = ½ × all-vapour ΔP at inlet conditions (Kern).');
  if (condVapourVel != null && condVapourVel > 30)
    warns.push(`${condVapourVel > 60 ? '✗' : '⚠'} Vapour crossflow velocity ≈ ${condVapourVel.toFixed(0)} m/s at the inlet — the shell is small for this vapour volume (keep below ≈ 30 m/s). Use wider baffle spacing, a larger shell, or a no-baffle / X-type shell for vacuum service.`);
  if (shellDP > 0.5 * hPop)
    warns.push(`✗ Shell ΔP (${shellDP.toFixed(2)} bar) is more than half the shell operating pressure (${hPop.toFixed(2)} bar a) — outside the model's range; the shell is undersized for this flow.`);
  if (bspMode === 'auto')
    warns.push(`ℹ Baffle spacing set automatically to ${(bsp_ratio * shellID_final * 1000).toFixed(0)} mm (${bsp_ratio.toFixed(2)} × shell ID) — ` +
      (shellMode === 'condensing' ? 'the widest TEMA spacing, which keeps vapour velocity and ΔP low.' : 'the closest spacing that stays within the allowable shell ΔP.'));
  // ── Saturation-consistency check (upgrade 2026-07) ────────────────────────
  // Now that a condenser may legitimately be specified isothermally, the most
  // likely remaining user error is a temperature/pressure pair that is not on
  // the saturation curve — e.g. steam entered as 120 °C at 3 bar a, where Tsat
  // is 133.5 °C. The duty is then built on the wrong latent heat and the wrong
  // driving force, so it is flagged explicitly rather than silently absorbed.
  if (shellMode === 'condensing' && phaseZones?.Tsat != null) {
    const dTsat = hTi - phaseZones.Tsat;
    if (Math.abs(dTsat) > 1.0 && Math.abs(hTi - hTo) < 0.05) {
      warns.push(
        `⚠ Hot inlet ${hTi.toFixed(1)}°C was entered as isothermal, but the saturation temperature at ` +
        `${hPop.toFixed(3)} bar a is ${phaseZones.Tsat.toFixed(1)}°C — a ${Math.abs(dTsat).toFixed(1)}°C mismatch. ` +
        `Use the T ⇄ P link so the pair sits on the saturation curve, or correct the operating pressure.`
      );
    } else if (dTsat < -1.0) {
      warns.push(
        `✗ Hot inlet ${hTi.toFixed(1)}°C is below the saturation temperature ${phaseZones.Tsat.toFixed(1)}°C at ` +
        `${hPop.toFixed(3)} bar a — that stream is subcooled liquid, not condensing vapour. Check the operating pressure.`
      );
    }
  }
  if (shellMode === 'condensing'  && !hFluidDB.hvap) warns.push('⚠ Condensing mode: no latent-heat data for the hot fluid — a default latent heat was used.');
  if (shellMode === 'evaporating' && !cFluidDB.hvap) warns.push('⚠ Evaporating mode: no latent-heat data for the cold fluid — a default latent heat was used.');

  warns.push(...viscNotes(hFluid, cFluid));

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
    vibration.checks.forEach(c => {
      const sev = /INSTABILITY/.test(c) ? '✗' : /below all TEMA|corrosive\/abrasive|vapour\/gas service/.test(c) ? 'ℹ' : '⚠';
      warns.push(`${sev} VIBRATION — ${c}`);
    });
  } catch (e) { vibration = { status: 'na', checks: ['Vibration screen unavailable: ' + e.message] }; }

  const pinchedZones = !!(zoneModel && zoneModel.pinched && zoneModel.pinched.length);
  const { st, stTxt } = finalizeStatus(
    (overSurf < 0 || pinchedZones || (vibration && vibration.status === 'err')) ? 'err'
    : ((overSurf < 5 && velMode === 'fixedtubes') || (F < 0.75 && shellMode === 'single-phase')
       || (tubeVel < 0.5 && shellMode !== 'evaporating') || tubeVel > 4 || (vibration && vibration.status === 'warn')) ? 'warn' : 'ok',
    warns);
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
      const nTubes_req = Math.ceil((area / nShells) / A_per_tube / np) * np; // per shell, round to pass multiple
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
    for (let ns = Math.max(2, nShells + 1); ns <= 4; ns++) {
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
    numTubes_total: numTubes_final * nShells,
    numTubes_velocity: numTubes_geo,
    geometryLoop: { iterations: geoIterations, converged: geoConverged, history: geoHistory },
    nPasses, nShells, shellID: shellID_gas || shellID_final, Di, OD, L: L_eff,
    shellID_tube_bundle: shellID_final,   // shell sized for tube bundle
    shellID_gas_service: shellID_gas,     // shell sized for gas velocity limit (may differ)
    gasResizeNote,
    tubeVel, targetVel, velMode, bsp: bsp_ratio, bspMode, baffleSpacing_mm: bsp_ratio * shellID_final * 1000,
    shellDP, tubeDp, pdAllowShell, pdAllowTube,
    shellDP_method: 'bell-delaware-taborek',     // tells UI which ΔP method was used
    shellDP_breakdown: { crossflow: shellDPd.crossflow_bar * nShells * dpFactor, window: shellDPd.window_bar * nShells * dpFactor, ends: shellDPd.ends_bar * nShells * dpFactor, Rl: shellDPd.Rl, Rb: shellDPd.Rb },
    bdCorr: { ...bdRes, hShell, hTube,
      // Tube-side Reynolds at the converged mean condition, so the datasheet
      // can report it instead of a dash.
      Re_tube: (cFluid?.rho && cFluid?.mu && tubeVel && Di)
        ? cFluid.rho * tubeVel * Di / (cFluid.mu * 1e-3) : null },
    NTU, eff, balErr, tema, pitchLayout, hTmean, cTmean,
    // FIX (2026-07): these were rendered by the PDF datasheet but never
    // returned, so it printed "—" for fouling, tube material, pitch ratio and
    // tube-side Reynolds even though every one of them was used in the maths.
    Rfo, Rfi, pitchRatio: pitch, tubeMat: b.mat || null, tubeK: kw, Cr,
    massH_kgh: massH * 3600, massC_kgh: massC * 3600,
    hTi, hTo, cTi, cTo, hPop, cPop,
    hFluid, cFluid, hFluidDB, cFluidDB,
    shellRe: bdRes.shellRe, shellVel: bdRes.shellVel,
    resistanceBreakdown, st, stTxt, warns,
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
  
  // --- Martin (1996, VDI Atlas B6) — friction factor ξ and Nusselt number ---
  // FIX 2026-10: the HTC used piecewise constants labelled "Martin" that gave
  // h ≈ 1.8× Martin's own value. Now heat transfer and pressure drop both come
  // from the same ξ, as Martin intended:
  //   1/√ξ = cosφ/√(0.18·tanφ + 0.36·sinφ + ξ0/cosφ) + (1−cosφ)/√(3.8·ξ1)
  //   Nu   = 0.122·Pr^⅓·(μ/μw)^⅙·[ξ·Re²·sin2φ]^0.374
  // φ = corrugation angle measured from the flow direction.
  function martinXi(Re) {
    const phi_rad = angle * Math.PI / 180;
    let f0, f1;
    if (Re < 2000) { f0 = 64 / Math.max(Re, 0.1); f1 = 597 / Math.max(Re, 0.1) + 3.85; }
    else { f0 = Math.pow(1.8 * Math.log10(Re) - 1.5, -2); f1 = 39 * Math.pow(Re, -0.289); }
    const cs = Math.cos(phi_rad), sn = Math.sin(phi_rad), tn = Math.tan(phi_rad);
    const rhs = cs / Math.sqrt(0.18 * tn + 0.36 * sn + f0 / cs) + (1 - cs) / Math.sqrt(3.8 * f1);
    return Math.pow(rhs, -2);
  }
  const Twall_pl = (hTmean + (cTi + cTo) / 2) / 2;
  const muWallH = fluidAtConditions(hFlKey, Twall_pl, hPop).mu;
  const muWallC = fluidAtConditions(cFlKey, Twall_pl, cPop).mu;
  function htcPlate(fluid, mKgs_total, nChannels) {
    const mKgs = mKgs_total / Math.max(nChannels, 1);
    const G = mKgs / Math.max(Ac, 1e-8);
    const Re = Math.max(G * Dh / (fluid.mu * 1e-3), 1);
    const Pr = Math.max(fluid.mu * 1e-3 * fluid.cp * 1000 / fluid.k, 0.5);
    const xi = martinXi(Re);
    const muW = fluid === hFluid ? muWallH : muWallC;
    const visc = Math.pow(Math.max(fluid.mu / Math.max(muW, 1e-6), 0.2), 1 / 6);
    const Nu = 0.122 * Math.pow(Pr, 1 / 3) * visc * Math.pow(xi * Re * Re * Math.sin(2 * angle * Math.PI / 180), 0.374);
    return { h: Nu * fluid.k / Dh, Re, G, xi, vel: mKgs / Math.max(fluid.rho * Ac, 1e-8) };
  }

  // --- Pressure drop: Martin friction + port loss ---
  function pdPlate(fluid, mKgs_total, nChannels, portDia_m) {
    const mKgs = mKgs_total / Math.max(nChannels, 1);
    const G = mKgs / Math.max(Ac, 1e-8);
    const Re = Math.max(G * Dh / (fluid.mu * 1e-3), 1);
    const f_pl = martinXi(Re);
    const vel = mKgs / Math.max(fluid.rho * Ac, 1e-8);
    const dyn = fluid.rho * vel * vel / 2;
    const dP_friction = f_pl * (plen / Dh) * dyn;
    // Port loss: 1.4 velocity heads at port velocity. Port diameter estimated at
    // 0.30 × plate width when not supplied (typical gasketed PHE proportion).
    const D_port = (portDia_m && portDia_m > 0) ? portDia_m : 0.30 * pw;
    const A_port = Math.max(Math.PI * D_port * D_port / 4, 1e-6);
    const v_port = mKgs_total / Math.max(fluid.rho * A_port, 1e-8);
    const dP_port = 1.4 * fluid.rho * v_port * v_port / 2;
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
    A_provided = (nPlates - 2) * A_plate;      // the two end plates transfer no heat
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
      A_provided = (nPlates_new - 2) * A_plate;
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
    
    // Recalculate final values with converged nPlates; add plates if the
    // final channel velocities leave the pack a little short.
    for (let k = 0; k < 6; k++) {
      nChanH = Math.max(1, Math.floor(nPlates / 2));
      nChanC = Math.max(1, nPlates - 1 - nChanH);
      hRes = htcPlate(hFluid, hF / 3600, nChanH);
      cRes = htcPlate(cFluid, cF / 3600, nChanC);
      hH = hRes.h; hC = cRes.h;
      const Rwall = th / kw;
      U = 1 / (1 / hH + 1 / hC + Rwall + foul);
      A_req = Q * 1000 / (U * FLMTD);
      A_provided = (nPlates - 2) * A_plate;    // thermal plates only
      overDesign = (A_provided / A_req - 1) * 100;
      if (overDesign >= 0) break;
      nPlates += 1;
    }
  }
  const autoPlates = !b.nPlates;
  
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
  const warns = [];
  if (FLMTD < 3) warns.push('⚠ Mean temperature difference below 3 °C — very close approach, check the plate count is practical.');
  if (dpH > pdAllowH) warns.push(`✗ Hot-side ΔP ${dpH.toFixed(3)} bar exceeds the allowable ${pdAllowH} bar — use wider plates or a lower corrugation angle.`);
  if (dpC > pdAllowC) warns.push(`✗ Cold-side ΔP ${dpC.toFixed(3)} bar exceeds the allowable ${pdAllowC} bar — use wider plates or a lower corrugation angle.`);
  if (overDesign < 0) warns.push('✗ Insufficient plate area — increase the plate count.');
  else if (overDesign < 5) warns.push(autoPlates
    ? `ℹ Plate count sized to the required area (margin ${overDesign.toFixed(1)} %); the fouling resistance is the design allowance — add plates if you want extra margin.`
    : `⚠ Area margin ${overDesign.toFixed(1)} % is below 5 % — add a few plates to cover fouling and maldistribution.`);
  for (const [lbl, r] of [['Hot', hRes], ['Cold', cRes]]) {
    if (r.vel > 3) warns.push(`⚠ ${lbl}-side channel velocity ${r.vel.toFixed(2)} m/s exceeds 3 m/s (erosion risk).`);
    else if (r.vel < 0.1) warns.push(`⚠ ${lbl}-side channel velocity ${r.vel.toFixed(2)} m/s is low — poor flow distribution and fouling risk. Use narrower plates or a two-pass arrangement.`);
    if (r.Re < 50) warns.push(`ℹ ${lbl}-side Re ${r.Re.toFixed(0)} — laminar channel flow.`);
  }
  warns.push(...viscNotes(hFluid, cFluid));
  if (hFluidDB.rho < GAS_RHO_THRESHOLD || cFluidDB.rho < GAS_RHO_THRESHOLD)
    warns.push('⚠ Gas service in a gasketed plate exchanger is unusual — check ΔP and gasket limits.');
  const { st, stTxt } = finalizeStatus((overDesign < 0 || dpH > pdAllowH || dpC > pdAllowC) ? 'err'
           : ((overDesign < 5 && !autoPlates) || FLMTD < 3 || hRes.vel < 0.1 || cRes.vel < 0.1) ? 'warn' : 'ok', warns);
  
  const minApproachDT = Math.min(hTi - cTo, hTo - cTi);
  
 return {
    Q, Qhot, Qcold, U, U_clean, balErr, lmtd, F, FLMTD, dT1, dT2,
    A_req, A_provided, overDesign, nPlates, A_plate, dpH, dpC, pdAllowH, pdAllowC,
    hH, hC, NTU, eff, hTi, hTo, cTi, cTo, cF,
    minApproachDT,
    hFluid, cFluid, st, stTxt, warns,
    iterations: iteration || 1, angle, gap, phi, plateW: pw, plateL: plen, plateTh: th, foul, matName: b.mat || 'ss316',
    hF, Reh_xi: hRes.xi, Rec_xi: cRes.xi,
    nChanH, nChanC,
    vH:  hRes.vel,
    vC:  cRes.vel,
    Reh: hRes.Re,
    Rec: cRes.Re
  };
}
// ─── FINNED-TUBE AIR SIDE (rewritten 2026-10, shared by Air Cooled & Fin-Fan) ─
// FIXES vs the previous version:
//  • Free-flow area: air flows BETWEEN the thin fins, so the minimum free area
//    per metre of tube is (P_T − D_r) − 2·H_f·t_f·N_f. The old code used the
//    gap between fin TIPS (P_T − D_fin), which for typical API 661 geometry is
//    2.6–18× too small (fin-fan defaults: 1 mm instead of 17.9 mm).
//  • Heat transfer: Briggs & Young (1963) —
//        j = 0.134·Re^−0.319·(s/H_f)^0.2·(s/t_f)^0.1134
//    The old j-factor was ≈5× higher. ("Robinson-Briggs" is the ΔP correlation.)
//  • Pressure drop: Robinson & Briggs (1966), staggered banks —
//        f = 18.93·Re^−0.316·(P_T/D_r)^−0.927·(P_T/P_d)^0.515,   Δp = f·N_r·G²/ρ
//  • Fin efficiency: Schmidt annular-fin approximation.
//  • Re is based on the fin ROOT diameter and G at the minimum free area.
function finnedTubeAirSide(o) {
  const { mAir, rhoAir, muAir, cpAir, kAir, Dr, finH, finThk, finDens, PT, PL,
          nRows, nTubesPerRow, tubeLen, nParallel = 1, kFin, layout = 'staggered' } = o;
  const s     = Math.max(1 / finDens - finThk, 1e-5);                 // gap between fins (m)
  const freeL = Math.max((PT - Dr) - 2 * finH * finThk * finDens, 1e-5);
  const A_min = freeL * tubeLen * nTubesPerRow * nParallel;           // m²
  const G     = mAir / A_min;                                         // kg/m²s
  const Re    = G * Dr / muAir;
  const Pr    = muAir * cpAir * 1000 / kAir;
  const j     = 0.134 * Math.pow(Re, -0.319) * Math.pow(s / finH, 0.2) * Math.pow(s / finThk, 0.1134);
  const h     = j * G * cpAir * 1000 * Math.pow(Pr, -2 / 3);          // W/m²K on extended area
  // Schmidt annular fin efficiency
  const r1 = Dr / 2, r2 = r1 + finH, r2c = r2 + finThk / 2;
  const m  = Math.sqrt(2 * h / (kFin * Math.max(finThk, 1e-5)));
  const phi = (r2c / r1 - 1) * (1 + 0.35 * Math.log(r2c / r1));
  const X  = m * r1 * phi;
  const eta_fin = X > 1e-9 ? Math.tanh(X) / X : 1;
  // Areas per metre of tube
  const A_fin_m  = finDens * (2 * Math.PI * (r2 * r2 - r1 * r1) + 2 * Math.PI * r2 * finThk);
  const A_bare_m = Math.PI * Dr * Math.max(1 - finDens * finThk, 0);
  const A_ext_m  = A_fin_m + A_bare_m;
  const eta0 = 1 - (A_fin_m / A_ext_m) * (1 - eta_fin);
  // Robinson & Briggs pressure drop
  const Pd = Math.sqrt((PT / 2) ** 2 + PL ** 2);
  const f  = 18.93 * Math.pow(Re, -0.316) * Math.pow(PT / Dr, -0.927) * Math.pow(PT / Pd, 0.515);
  const dP = f * nRows * G * G / rhoAir;                               // Pa
  const notes = [];
  if (Re < 1100 || Re > 18000) notes.push(`ℹ Air-side Re = ${Re.toFixed(0)} is outside the Briggs & Young data range (1,100–18,000) — h is extrapolated.`);
  if (layout !== 'staggered') notes.push('ℹ Robinson & Briggs ΔP is for staggered banks — the in-line air ΔP is approximate.');
  return { G, Re, Pr, j, h, eta_fin, eta0, A_ext_m, A_bare_m, A_fin_m, A_min, dP, f_rb: f, s, freeL };
}

// ─── AIR COOLED — rewritten 2026-10 ─────────────────────────────────────────
function calcAirCooled(b) {
  const flKey  = b.flKey || 'water';
  const fluid  = getFluid(flKey);
  const Ti     = requireFinite(b.Ti,   'Ti');
  const To     = requireFinite(b.To,   'To');
  const F_kgh  = requireFinite(b.F,    'F');
  const Tamb   = requireFinite(b.Tamb, 'Tamb');
  const dTa    = Math.max(parseFloat(b.dTa) || 15, 1);
  const Pop    = parseFloat(b.Pop) || P_REF_DB;
  const tubeOD  = (parseFloat(b.tubeOD)  || 25.4)  / 1000;
  const tubeID  = (parseFloat(b.tubeID)  || 20.0)  / 1000;
  const finH    = (parseFloat(b.finH)    || 12.5)  / 1000;
  const finThk  = (parseFloat(b.finThk)  || 0.40)  / 1000;
  const finDens = parseFloat(b.finDens)  || 394;
  const pitchT  = (parseFloat(b.pitchT)  || 63.5)  / 1000;
  const nRows   = Math.max(1, parseInt(b.rows)   || 4);
  const nTubes  = Math.max(nRows, parseInt(b.nTubes) || 40);
  const nPasses = Math.max(1, Math.min(nTubes, parseInt(b.nPasses) || 1));
  const tubeLen = parseFloat(b.tubeLen)  || 6.0;
  const Rfo     = Math.max(parseFloat(b.Rfo) || 0.0002, 0);      // air-side fouling
  const Rfi     = isFinite(parseFloat(b.Rfi)) ? Math.max(parseFloat(b.Rfi), 0) : 0.0002;   // tube-side fouling
  const pdAllow = parseFloat(b.pdAllow) || 0.7;
  const FIN_K = { aluminum:222, alum:222, al1100:222, al3003:190, al6063:200, copper:385, cs:50, ss:16, titanium:21 };
  const kFin  = FIN_K[b.fmat] || FIN_K[b.finMat] || 222;
  const kTube = KMAT[b.tubeMat] || 50;                           // carbon steel tubes unless stated
  const fanType = b.fanType === 'induced' ? 'induced' : 'forced';
  const finOD = tubeOD + 2 * finH;

  if (!(F_kgh > 0)) throw new Error('Process flow must be positive');
  if (To >= Ti)   throw new Error('Process outlet must be below process inlet');
  if (Tamb >= To) throw new Error('Ambient air must be colder than the process outlet');
  if (Tamb + dTa >= Ti) throw new Error('Air outlet (ambient + air rise) must be below the process inlet');
  if (finOD >= pitchT + 1e-6) throw new Error(`Fin OD ${(finOD*1000).toFixed(1)} mm is larger than the transverse pitch — fins would overlap`);
  if (tubeID >= tubeOD) throw new Error('Tube ID must be smaller than tube OD');

  const tubeFluid = fluidAtConditions(flKey, (Ti + To) / 2, Pop);
  const Q = (F_kgh / 3600) * tubeFluid.cp * (Ti - To);            // kW
  const TairOut = Tamb + dTa;
  const air  = fluidAtConditions('air', Tamb + dTa / 2, P_REF_DB);
  const mAir = Q / (air.cp * dTa);                                  // kg/s

  const nTubesPerRow = nTubes / nRows;
  const PL = 0.866 * pitchT;                                        // equilateral staggered
  const A  = finnedTubeAirSide({ mAir, rhoAir: air.rho, muAir: air.mu * 1e-3, cpAir: air.cp, kAir: air.k,
    Dr: tubeOD, finH, finThk, finDens, PT: pitchT, PL, nRows, nTubesPerRow, tubeLen, kFin });

  const A_total  = A.A_ext_m * tubeLen * nTubes;
  const A_bareOD = Math.PI * tubeOD * tubeLen * nTubes;
  const A_inside = Math.PI * tubeID * tubeLen * nTubes;
  const nTPP = nTubes / nPasses;
  const tubeRes = calcHtube(tubeFluid, (F_kgh / 3600) / nTPP, tubeID, tubeLen);
  const Ao_Ai  = A_total / A_inside;
  const Rw_ext = (tubeOD / 2) * Math.log(tubeOD / tubeID) / kTube * (A_total / A_bareOD);
  // Overall U on the extended-surface basis.
  // FIX 2026-10: air-side fouling was multiplied by Ao/Ai (≈20× too large) and
  // tube-side fouling and wall resistance were missing.
  const U = 1 / (Ao_Ai / tubeRes.h + Ao_Ai * Rfi + Rw_ext + Rfo / A.eta0 + 1 / (A.eta0 * A.h));
  const h_eff = A.eta0 * A.h;

  const lmtdRes = calcLMTD(Ti, To, Tamb, TairOut, 'cross1', nPasses);
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err || 'LMTD error');
  if (lmtdRes.valid === false) throw new Error(lmtdRes.fErr);
  const { lmtd, F, dT1, dT2 } = lmtdRes;
  const FLMTD = lmtd * F;
  const A_req = Q * 1000 / (U * FLMTD);
  const overDesign = (A_total / A_req - 1) * 100;

  const dpTube = calcPressDropTube(tubeFluid, (F_kgh / 3600) / nTPP, tubeID, tubeLen, nPasses);
  const A_face = pitchT * nTubesPerRow * tubeLen;
  const rhoAmb = fluidAtConditions('air', Tamb, P_REF_DB).rho;
  const rhoFan = fanType === 'induced' ? fluidAtConditions('air', TairOut, P_REF_DB).rho : rhoAmb;
  const v_face = mAir / (rhoAmb * A_face);
  const V_fan  = mAir / rhoFan;                                      // m³/s at the fan
  const fanEta = 0.65;                                               // typical total efficiency
  const fanPower = V_fan * (A.dP + 0.5 * rhoFan * (V_fan / A_face) ** 2) / fanEta / 1000;   // kW
  const ApproachTemp = To - Tamb;

  const warns = [];
  if (overDesign < 0) warns.push(`✗ Insufficient extended area (${overDesign.toFixed(1)} %) — add tubes, rows or length.`);
  else if (overDesign < 5) warns.push(`⚠ Area margin ${overDesign.toFixed(1)} % is below 5 % — add tubes or rows.`);
  if (tubeFluid.rho >= GAS_RHO_THRESHOLD && tubeRes.vel < 0.5) warns.push(`⚠ Tube velocity ${tubeRes.vel.toFixed(2)} m/s is low for liquid service — fouling risk and poor tube-side h; add tube passes.`);
  if (dpTube > pdAllow) warns.push(`✗ Tube-side ΔP ${dpTube.toFixed(3)} bar exceeds the allowable ${pdAllow} bar.`);
  if (ApproachTemp < 15) warns.push(`⚠ Approach (process outlet − ambient) ${ApproachTemp.toFixed(1)} °C is tight — air coolers normally need ≥ 15 °C.`);
  if (v_face < 1.5 || v_face > 4) warns.push(`⚠ Face velocity ${v_face.toFixed(2)} m/s is outside the usual 1.5–4 m/s.`);
  if (A.eta_fin < 0.6) warns.push(`⚠ Fin efficiency ${(A.eta_fin * 100).toFixed(0)} % is low — use thinner/shorter fins or a higher-conductivity fin material.`);
  if (tubeRes.Re < 2300) warns.push(`⚠ Tube-side flow is laminar (Re ${tubeRes.Re.toFixed(0)}) — add tube passes to raise velocity.`);
  if (A.Re < 1100 || A.Re > 18000) warns.push(`ℹ Air-side Re ${A.Re.toFixed(0)} is outside the Briggs & Young data range (1,100–18,000).`);
  warns.push('ℹ Fan power assumes 65 % fan efficiency; bundle ΔP from Robinson & Briggs.');
  const { st, stTxt } = finalizeStatus(overDesign < 0 || dpTube > pdAllow ? 'err' : (overDesign < 5 || ApproachTemp < 15 || v_face > 4) ? 'warn' : 'ok', warns);

  return {
    Q, Ti, To, Tamb, TairOut, mAir, U, A_total, A_req, overDesign,
    FLMTD, lmtd, F, Fcorr: F, dT1, dT2, h_eff, h_air_bare: A.h, eta_fin: A.eta_fin, eta_0: A.eta0,
    Re_fin: A.Re, G_max: A.G, tubeVel: tubeRes.vel, Re_tube: tubeRes.Re, h_tube: tubeRes.h,
    fanPower, ApproachTemp, v_face, dpAir_Pa: A.dP, dpAir_mmH2O: A.dP / 9.80665, dpTube, pdAllow,
    flow_kgh: F_kgh, nTubes, nRows, nPasses, tubeLen, finDens, fanType, finMat: b.fmat || 'aluminum',
    fluidName: fluid.name, st, stTxt, warns
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
  // FIX 2026-10: nHairpins = 0 (or blank) → size the number of hairpins.
  // Previously it was always 1, so the tab only rated a single hairpin.
  const L=requireFinite(b.L,'L');
  const nHP_user=Math.max(0,parseInt(b.nHairpins)||0);
  const arr=b.arr||'counter', kw=KMAT[b.mat]||16;
  const foul=isFinite(parseFloat(b.foul))?Math.max(parseFloat(b.foul),0):0.0002;
  const pdAllowInner = parseFloat(b.pdAllowInner || b.pdAllow) || 1.0;
  const pdAllowAnn   = parseFloat(b.pdAllowAnn   || b.pdAllow) || 1.0;
  const iID=iOD-2*iTW;
  if (iID<=0) throw new Error('Wall thickness too large for inner pipe');
  if (oID<=iOD) throw new Error('Outer pipe ID must be greater than inner pipe OD');
  const lmtdRes=calcLMTD(hTi,hTo,cTi,cTo,arr);
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err||'LMTD error');
  const {lmtd,F,dT1,dT2}=lmtdRes, FLMTD=lmtd*F;
  const Ann_area=Math.PI*(oID*oID-iOD*iOD)/4;
  const Dh_ann=oID-iOD;
  const Ao_Ai=iOD/iID;
  const Rwall=(iOD/2)*Math.log(iOD/iID)/kw;
  const velAnn=(cF/3600)/(cFluid.rho*Math.max(Ann_area,1e-8));
  const Re_ann=cFluid.rho*velAnn*Dh_ann/(cFluid.mu*1e-3);
  const Pr_ann=Math.max(cFluid.mu*1e-3*cFluid.cp*1000/cFluid.k,0.5);
  const cFluidWall_ann = fluidAtConditions(cFlKey, (cTmean+hTmean)/2, cPop);
  const phi_ann = Math.max(0.5, Math.min(Math.pow(Math.max(cFluid.mu / Math.max(cFluidWall_ann.mu, 0.001), 0.1), 0.14), 2.0));
  function evalHairpins(nHairpins) {
    const L_total=L*nHairpins*2;
    const htInner=calcHtube(hFluid,hF/3600,iID,L_total);
    // Annulus: Gnielinski with the Petukhov–Roizen inner-wall factor
    // 0.86·(Di/Do)^−0.16 (turbulent); Sieder–Tate per leg (laminar).
    let Nu_ann;
    if (Re_ann < 2300) {
      const Gz_ann = Re_ann * Pr_ann * Dh_ann / Math.max(L, 0.01);
      Nu_ann = Math.max(3.66, 1.86*Math.pow(Gz_ann, 0.333));
    } else {
      const fg = Math.pow(0.790*Math.log(Math.max(Re_ann,2300))-1.64,-2);
      const NuG = (fg/8)*(Re_ann-1000)*Pr_ann/(1+12.7*Math.sqrt(fg/8)*(Math.pow(Pr_ann,2/3)-1));
      Nu_ann = Math.max(NuG, 3.66) * 0.86 * Math.pow(iOD/oID, -0.16);
    }
    Nu_ann *= phi_ann;
    const hAnn=Nu_ann*cFluid.k/Dh_ann;
    // FIX 2026-10: U on the OUTER-area basis: 1/Uo = 1/h_ann + (Do/Di)/h_in + Rw + Rf.
    // (Previously Ao/Ai multiplied the annulus coefficient instead of the inner one.)
    const U=1/(1/hAnn+Ao_Ai/htInner.h+Rwall+foul);
    const A_req=Q*1000/(U*FLMTD);
    const A_provided=Math.PI*iOD*L_total;
    const dpInner=calcPressDropTube(hFluid,hF/3600,iID,L_total,1);
    const f_ann=Re_ann<2300?64/Math.max(Re_ann,1):Math.pow(0.790*Math.log(Math.max(Re_ann,10))-1.64,-2);
    const dpAnn=(f_ann*(L_total/Dh_ann)+2.0*nHairpins)*cFluid.rho*velAnn*velAnn/2/1e5;
    return {nHairpins,L_total,htInner,hAnn,U,A_req,A_provided,overDesign:(A_provided/A_req-1)*100,dpInner,dpAnn};
  }
  let ev = evalHairpins(nHP_user || 1);
  if (!nHP_user) {
    for (let i = 0; i < 40; i++) {
      const need = Math.max(1, Math.ceil(ev.A_req / (Math.PI * iOD * 2 * L)));
      if (need <= ev.nHairpins) break;
      ev = evalHairpins(need);
    }
  }
  const {nHairpins,L_total,htInner,hAnn,U,A_req,A_provided,overDesign,dpInner,dpAnn} = ev;
  const NTU=A_req*U/Math.max(Math.min((hF/3600)*hFluid.cp,(cF/3600)*cFluid.cp)*1000,0.001);
  const Cmin=Math.min((hF/3600)*hFluid.cp,(cF/3600)*cFluid.cp);
  const eff=Cmin>0?Q/(Cmin*(hTi-cTi)):0;
  const warns=[];
  if (!nHP_user) warns.push(`ℹ ${nHairpins} hairpin(s) of ${L} m legs sized automatically for the required area.`);
  if(overDesign<0) warns.push(`✗ Insufficient area (${overDesign.toFixed(1)} %) — add hairpins.`);
  else if(overDesign<5 && nHP_user) warns.push(`⚠ Area margin ${overDesign.toFixed(1)} % is below 5 % — add a hairpin.`);
  if(dpInner>pdAllowInner) warns.push(`✗ Inner pipe ΔP ${dpInner.toFixed(3)} bar exceeds the allowable ${pdAllowInner} bar.`);
  if(dpAnn>pdAllowAnn)     warns.push(`✗ Annulus ΔP ${dpAnn.toFixed(3)} bar exceeds the allowable ${pdAllowAnn} bar.`);
  if(FLMTD<3) warns.push('⚠ Mean temperature difference below 3 °C — very close approach.');
  if(htInner.Re<2300) warns.push(`⚠ Inner pipe flow is laminar (Re ${htInner.Re.toFixed(0)}).`);
  if(Re_ann<2300) warns.push(`⚠ Annulus flow is laminar (Re ${Re_ann.toFixed(0)}).`);
  if(balErr>2) warns.push(`⚠ Energy balance differs by ${balErr.toFixed(1)} %.`);
  warns.push(...viscNotes(hFluid, cFluid));
  const { st, stTxt } = finalizeStatus((overDesign<0||dpInner>pdAllowInner||dpAnn>pdAllowAnn)?'err':((overDesign<5&&nHP_user)||FLMTD<3)?'warn':'ok', warns);
  return {
    Q,Qhot,Qcold,U,balErr,lmtd,F,FLMTD,dT1,dT2,
    A_req,A_provided,overDesign,hInner:htInner.h,hAnn,
    dpInner,dpAnn,pdAllow:pdAllowInner,pdAllowInner,pdAllowAnn,NTU,eff,
    hTi,hTo,cTi,cTo,cF,hF,iID,iOD,oID,Dh_ann,L,L_total,nHairpins,nHairpinsAuto:!nHP_user,
    hFluid,cFluid,Re_inner:htInner.Re,Re_ann,velInner:htInner.vel,velAnn,
    st,stTxt,warns
  };
}

// ─── FIN-FAN (API 661 style) — rewritten 2026-10 ────────────────────────────
// Uses finnedTubeAirSide() (correct free area, Briggs & Young, Robinson & Briggs,
// Schmidt fin efficiency). Other fixes:
//  • Tube-side flow is split across all bays × bundles (was sent through one bundle).
//  • EMTD from a rigorous counter-crossflow F for the actual number of passes
//    (replaces an ad-hoc row correction).
//  • Fan diameter mm→m and fan efficiency %→fraction (fan power was 100× low and
//    the fan-coverage check could never fire).
//  • API 661 fan coverage: fan area ≥ 40 % of bundle face area.
function calcFinFan(b) {
  const tFlKey = b.tFlKey || 'water';
  const tFlDB  = getFluid(tFlKey);
  const tPop   = parseFloat(b.tPop) || 4.0;
  const tTi = requireFinite(b.tTi, 'tTi'), tTo = requireFinite(b.tTo, 'tTo');
  const tF_kgh = requireFinite(b.tF_kgh, 'tF_kgh');
  const tFoul = isFinite(parseFloat(b.tFoul)) ? Math.max(parseFloat(b.tFoul), 0) : 2.9e-4;
  const tPdAllow = parseFloat(b.tPdAllow) || 0.6;
  const htSF = parseFloat(b.htSF) || 1.0;
  const aTamb = requireFinite(b.aTamb, 'aTamb'), aTout = requireFinite(b.aTout, 'aTout');
  const aPop  = parseFloat(b.aPop) || 1.01325;
  const aFoul = isFinite(parseFloat(b.aFoul)) ? Math.max(parseFloat(b.aFoul), 0) : 1.8e-4;
  const tubeOD = requireFinite(b.tubeOD, 'tubeOD') / 1000, tubeID = requireFinite(b.tubeID, 'tubeID') / 1000;
  const tubeLen = requireFinite(b.tubeLen, 'tubeLen') / 1000;
  const pitchT = requireFinite(b.pitchT, 'pitchT') / 1000, pitchL = requireFinite(b.pitchL, 'pitchL') / 1000;
  const nRows = Math.max(1, parseInt(b.nRows) || 4), nPasses = Math.max(1, parseInt(b.nPasses) || 2);
  const nTubes = Math.max(nRows, parseInt(b.nTubes) || 261);       // per bundle
  const tubeLayout = b.tubeLayout === 'inline' ? 'inline' : 'staggered';
  const TUBE_K = { cs: 50, ss304: 17, ss316: 14, copper: 385, titanium: 21, aluminum: 205 };
  const kTube = TUBE_K[b.tubeMat] || 17;
  const finDensity = parseFloat(b.finDensity) || 787;
  const finRoot = requireFinite(b.finRoot, 'finRoot') / 1000, finH = requireFinite(b.finH, 'finH') / 1000;
  const finThk = requireFinite(b.finThk, 'finThk') / 1000;
  const FIN_K = { al1100: 222, al3003: 190, copper: 385, ss: 16 };
  const kFin = FIN_K[b.finMat] || 222;
  const finOD = finRoot + 2 * finH;
  const nBays = Math.max(1, parseInt(b.nBays) || 1), nBundlesPBay = Math.max(1, parseInt(b.nBundlesPBay) || 1);
  const nParallel = nBays * nBundlesPBay;
  const bundleW = requireFinite(b.bundleW, 'bundleW') / 1000;
  const nFans = Math.max(0, parseInt(b.nFans) || 0);
  let fanDia = parseFloat(b.fanDia) || 3658;  fanDia = fanDia > 20 ? fanDia / 1000 : fanDia;   // mm → m
  let fanEff = parseFloat(b.fanEff) || 65;    fanEff = fanEff > 1 ? fanEff / 100 : fanEff;     // % → fraction
  fanEff = Math.max(0.2, Math.min(fanEff, 0.95));
  const driverKW = parseFloat(b.driverKW) || 30;
  const draftType = b.draftType === 'induced' ? 'induced' : 'forced';

  if (!(tF_kgh > 0)) throw new Error('Tube-side flow must be positive');
  if (tTo >= tTi) throw new Error('Tube-side outlet must be below the inlet');
  if (aTout <= aTamb) throw new Error('Air outlet must be above ambient');
  if (aTamb >= tTo) throw new Error('Ambient air must be colder than the process outlet');
  if (tubeID >= tubeOD) throw new Error('Tube ID must be less than tube OD');
  if (finRoot < tubeOD - 1e-6) throw new Error('Fin root diameter must be ≥ tube OD');
  if (finOD > pitchT + 1e-6) throw new Error(`Fin OD ${(finOD*1000).toFixed(1)} mm exceeds the transverse pitch ${(pitchT*1000).toFixed(1)} mm — fins would overlap`);

  const tTmean = (tTi + tTo) / 2;
  const tFluid = fluidAtConditions(tFlKey, tTmean, tPop);
  const tF_kgs = tF_kgh / 3600;
  const aTmean = (aTamb + aTout) / 2;
  const aFluid = fluidAtConditions('air', aTmean, aPop);
  const Qhot = tF_kgs * tFluid.cp * (tTi - tTo);                    // kW
  const nTubeTotal = nTubes * nParallel;
  const finsPerTube = finDensity * tubeLen;

  const cp_air = aFluid.cp;
  const mAir_kgs = Qhot / (cp_air * (aTout - aTamb));
  const mAir_kgh = mAir_kgs * 3600;
  const nTubesPerRow = nTubes / nRows;
  const A = finnedTubeAirSide({ mAir: mAir_kgs, rhoAir: aFluid.rho, muAir: aFluid.mu * 1e-3, cpAir: cp_air, kAir: aFluid.k,
    Dr: finRoot, finH, finThk, finDens: finDensity, PT: pitchT, PL: pitchL, nRows, nTubesPerRow, tubeLen,
    nParallel, kFin, layout: tubeLayout });

  const A_extended = A.A_ext_m * tubeLen * nTubeTotal;
  const A_bare_unit = Math.PI * tubeOD * tubeLen * nTubeTotal;
  const A_inside = Math.PI * tubeID * tubeLen * nTubeTotal;
  const areaRatio = A_extended / A_bare_unit;
  const A_face_total = bundleW * tubeLen * nParallel;
  const bundleL_calc = nRows * pitchL + finOD;

  // Tube side — flow split across every bay and bundle
  const nTubesPerPass = Math.max(1, Math.round(nTubes / nPasses));
  const massPerTube = tF_kgs / (nTubesPerPass * nParallel);
  const tRes = calcHtube(tFluid, massPerTube, tubeID, tubeLen);
  const h_tube = tRes.h;
  const Ao_per_Ai = A_extended / A_inside;
  const Rw_ext = (tubeOD / 2) * Math.log(tubeOD / tubeID) / kTube * areaRatio;
  const R_tube_film = Ao_per_Ai / h_tube;
  const R_foul_tube = Ao_per_Ai * tFoul;
  const R_wall_val  = Rw_ext;
  const R_foul_air  = aFoul / A.eta0;
  const R_air_film  = 1 / (A.eta0 * A.h);
  const R_total = R_tube_film + R_foul_tube + R_wall_val + R_foul_air + R_air_film;
  const U_ext   = 1 / R_total;
  const h_clean = 1 / (R_tube_film + R_wall_val + R_air_film);

  const lmtdRes = calcLMTD(tTi, tTo, aTamb, aTout, 'cross1', nPasses);
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err || 'LMTD error');
  if (lmtdRes.valid === false) throw new Error(lmtdRes.fErr);
  const { lmtd, F, dT1, dT2 } = lmtdRes;
  const EMTD = lmtd * F;
  const A_req = Qhot * 1000 * htSF / (U_ext * EMTD);
  const A_prov = A_extended;
  const overDesign = (A_prov / A_req - 1) * 100;
  const U_req = Qhot * 1000 * htSF / (A_prov * EMTD);

  const tubeVel = massPerTube / (tFluid.rho * Math.PI * tubeID * tubeID / 4);
  const dpTube = calcPressDropTube(tFluid, massPerTube, tubeID, tubeLen, nPasses);

  // Air side and fans
  const rho_amb = fluidAtConditions('air', aTamb, aPop).rho;
  const rho_fan = draftType === 'induced' ? fluidAtConditions('air', aTout, aPop).rho : rho_amb;
  const v_face = mAir_kgs / (rho_amb * Math.max(A_face_total, 0.01));
  const v_max  = A.G / aFluid.rho;
  const dpAir_Pa = A.dP;
  const dpAir_mmH2O = dpAir_Pa / 9.80665;
  const vPr_mmH2O = 0.5 * rho_amb * v_face * v_face / 9.80665;
  const V_air_m3s = mAir_kgs / rho_fan;
  const V_air_100m3min = V_air_m3s * 60 / 100;
  const nFanTotal = nFans * nBays;
  const A_fan_each = Math.PI * fanDia * fanDia / 4;
  const A_fan_total = nFanTotal * A_fan_each;
  const v_fan = nFanTotal > 0 ? V_air_m3s / A_fan_total : 0;
  const P_fan_total = nFanTotal > 0 ? V_air_m3s * (dpAir_Pa + 0.5 * rho_fan * v_fan * v_fan) / fanEff / 1000 : 0;
  const P_fan_each = P_fan_total / Math.max(nFanTotal, 1);
  const fanAreaRatio = A_fan_total / Math.max(A_face_total, 0.001);

  const T_skin_max = tTi - (tTi - aTamb) * (R_tube_film + R_foul_tube) / R_total;
  const T_skin_min = tTo - (tTo - aTamb) * (R_tube_film + R_foul_tube) / R_total;

  const warns = [];
  if (overDesign < 0) warns.push(`✗ Insufficient extended area (${overDesign.toFixed(1)} %) — add tubes, rows or bays.`);
  else if (overDesign < 5) warns.push(`⚠ Area margin ${overDesign.toFixed(1)} % is below 5 % — add tubes or rows.`);
  if (overDesign > 50) warns.push(`ℹ ${overDesign.toFixed(0)} % overdesign — the unit could be smaller.`);
  if (dpTube > tPdAllow) warns.push(`✗ Tube-side ΔP ${dpTube.toFixed(3)} bar exceeds the allowable ${tPdAllow} bar — reduce passes.`);
  if (nFanTotal === 0) warns.push('✗ No fans specified.');
  else if (P_fan_each > driverKW) warns.push(`✗ Fan shaft power ${P_fan_each.toFixed(1)} kW exceeds the ${driverKW} kW driver.`);
  if (nFanTotal > 0 && fanAreaRatio < 0.40) warns.push(`⚠ Fan coverage ${(fanAreaRatio * 100).toFixed(0)} % of the bundle face — API 661 asks for at least 40 %.`);
  if (v_face < 1.5 || v_face > 4.0) warns.push(`⚠ Face velocity ${v_face.toFixed(2)} m/s is outside the usual 1.5–4 m/s.`);
  if (A.eta_fin < 0.6) warns.push(`⚠ Fin efficiency ${(A.eta_fin * 100).toFixed(0)} % is low.`);
  if (tRes.Re < 2300) warns.push(`⚠ Tube-side flow is laminar (Re ${tRes.Re.toFixed(0)}) — add tube passes.`);
  if (A.Re < 1100 || A.Re > 18000) warns.push(`ℹ Air-side Re ${A.Re.toFixed(0)} is outside the Briggs & Young data range (1,100–18,000).`);
  if (tubeLayout === 'inline') warns.push('ℹ Robinson & Briggs ΔP is for staggered banks — in-line air ΔP is approximate.');
  const { st, stTxt } = finalizeStatus(
    (overDesign < 0 || dpTube > tPdAllow || nFanTotal === 0 || P_fan_each > driverKW) ? 'err'
    : (overDesign < 5 || v_face > 4 || (nFanTotal > 0 && fanAreaRatio < 0.40)) ? 'warn' : 'ok', warns);

  return {
    Qhot, tTi, tTo, tF_kgh, tFluid, tFlDB, aTamb, aTout, mAir_kgh,
    A_extended, A_bare: A_bare_unit, A_req, A_prov, overDesign, EMTD, lmtd, F, F_rows: F, dT1, dT2,
    U_ext, U_actual: U_ext, U_req, h_outside: A.h, h_tubeside: h_tube, h_clean,
    eta_fin: A.eta_fin, eta_surf: A.eta0, h_air: A.h, h_air_eff: A.eta0 * A.h, j_air: A.j,
    dpTube, dpAir_Pa, dpAir_mmH2O, vPr_mmH2O, P_fan_total, P_fan_each,
    v_face, v_max, G_max: A.G, V_air_m3s, V_air_100m3min, Re_air: A.Re, Re_tube: tRes.Re, tubeVel,
    A_face_total, bundleL_calc, areaRatio, finsPerTube,
    R_tube_film, R_foul_tube, R_wall_val, R_foul_air, R_air_film, R_total,
    T_skin_max, T_skin_min, nTubeTotal, nTubesPerPass,
    fanAreaRatio, driverKW, nFans, nBays, nBundlesPBay, bundleW,
    // geometry echoed for the datasheet
    tubeOD, tubeID, tubeLen, pitchT, pitchL, nRows, nPasses, nTubes, tubeLayout,
    tubeMat: b.tubeMat || 'ss304', tubeType: 'High-finned', finType: 'Plain annular (Briggs & Young)',
    finDensity, finRoot, finH, finOD, finThk, finMat: b.finMat || 'al1100',
    fanDia, fanEff, draftType, tFoul, aFoul, tPdAllow,
    st, stTxt, warns
  };
}

// ─── LMTD / NTU — rewritten 2026-10 ──────────────────────────────────────────
// NTU and effectiveness now come from UA = Q/(F·LMTD), which is exact for every
// arrangement once F is known — no per-arrangement inversion. (The old crossflow
// inversion had its exponents swapped; 'cross2' silently used F = 1; the 1-2 and
// 2-4 shells used the counterflow NTU formula.) If only one ṁ·cp is given, the
// other is filled from the energy balance; if both are given, the balance is checked.
function calcLmtdNtu(b) {
  const hTi=requireFinite(b.hTi,'hTi'), hTo=requireFinite(b.hTo,'hTo');
  const cTi=requireFinite(b.cTi,'cTi'), cTo=requireFinite(b.cTo,'cTo');
  const arr=b.arr||'counter';
  if(hTo>=hTi) throw new Error('Hot outlet must be below hot inlet');
  if(cTo<=cTi) throw new Error('Cold outlet must be above cold inlet');
  if(hTi<=cTi) throw new Error('Hot inlet must be above cold inlet');
  const lmtdRes=calcLMTD(hTi,hTo,cTi,cTo,arr);
  if (!lmtdRes.lmtd) throw new Error(lmtdRes.err||'Cannot compute LMTD');
  if (lmtdRes.valid === false) throw new Error(lmtdRes.fErr);
  const {lmtd,F,dT1,dT2,R,P}=lmtdRes, FLMTD=lmtd*F;
  let Ch=parseFloat(b.Ch)||null, Cc=parseFloat(b.Cc)||null;
  const UA_given=parseFloat(b.UA)||null;
  const warns=[];
  if (Ch && !Cc) { Cc = Ch*(hTi-hTo)/(cTo-cTi); warns.push(`ℹ Cold-side ṁ·cp set to ${Cc.toFixed(3)} kW/K from the energy balance.`); }
  if (Cc && !Ch) { Ch = Cc*(cTo-cTi)/(hTi-hTo); warns.push(`ℹ Hot-side ṁ·cp set to ${Ch.toFixed(3)} kW/K from the energy balance.`); }
  let NTU=null,eff=null,Cmin_kW=null,Cmax_kW=null,Cr=null,UA=null,Q=null,Qh=null,Qc=null,balErr=null,UA_margin=null;
  if (Ch && Cc) {
    Qh=Ch*(hTi-hTo); Qc=Cc*(cTo-cTi); Q=(Qh+Qc)/2;
    balErr=Math.abs(Qh-Qc)/Math.max(Qh,Qc)*100;
    if (balErr>2) warns.push(`⚠ Energy balance differs by ${balErr.toFixed(1)} % (hot ${Qh.toFixed(1)} kW vs cold ${Qc.toFixed(1)} kW) — the four temperatures and the two ṁ·cp values are not consistent.`);
    Cmin_kW=Math.min(Ch,Cc); Cmax_kW=Math.max(Ch,Cc); Cr=Cmin_kW/Cmax_kW;
    eff=Q/(Cmin_kW*(hTi-cTi));
    UA=Q*1000/FLMTD;                       // W/K
    NTU=UA/1000/Cmin_kW;
    if (UA_given) {
      UA_margin=(UA_given/UA-1)*100;
      warns.push(`${UA_margin>=0?'ℹ':'⚠'} Your U·A (${UA_given.toFixed(0)} W/K) is ${Math.abs(UA_margin).toFixed(1)} % ${UA_margin>=0?'above':'below'} the ${UA.toFixed(0)} W/K these temperatures require.`);
    }
  }
  if (F < 0.75) warns.push(`⚠ F = ${F.toFixed(3)} < 0.75 — too close an approach for this arrangement${lmtdRes.nShellsNeeded ? `; ${lmtdRes.nShellsNeeded} 1-2 shells in series would fix it` : ''}.`);
  return {lmtd,F,FLMTD,dT1,dT2,R,P,NTU,eff,UA,UA_given,UA_margin,Cmin_kW,Cmax_kW,Cr,Ch,Cc,Q,Qh,Qc,balErr,hTi,hTo,cTi,cTo,arr,warns};
}

// ─── WALL THICKNESS — rewritten 2026-10 ──────────────────────────────────────
// ASME VIII Div.1: UG-27 (cylinder, sphere), UG-32(g) (cone, Appendix 1-5 not
// checked); Appendix 1-2 (thick cylinder / sphere) when the thin-wall limits are
// exceeded. EN 13445-3 §7.4 and PD 5500 use the inside-diameter forms.
// FIXES: radius in the CORRODED condition (R = Ri + CA); thick-wall check uses
// the code limits (t > R/2 or P > 0.385·S·E for cylinders) instead of a "Lamé"
// value with a stray ½; MAWP uses the formula for the actual shape.
function calcWallThickness(b) {
  const std=b.std||'asme8d1', type=b.type||'cylinder';
  const P_barg=requireFinite(b.P,'P'), D_mm=requireFinite(b.D,'D');
  let S_MPa=parseFloat(b.S)||138;
  const CA_mm=Math.max(parseFloat(b.CA)||0,0), MT_mm=Math.max(parseFloat(b.MT)||0,0);
  const E=parseFloat(b.E)||1.0, alpha=parseFloat(b.alpha)||30;
  if(b.mat&&b.mat!=='custom') S_MPa=parseFloat(b.mat)||S_MPa;   // dropdown sends the stress value
  const P=P_barg*0.1;                                             // MPa
  if(P<=0||D_mm<=0||S_MPa<=0) throw new Error('Enter valid pressure, diameter and allowable stress');
  const SE=S_MPa*E;
  if(P>=SE) throw new Error(`Design pressure ${P.toFixed(2)} MPa is not below S·E = ${SE.toFixed(1)} MPa — the shell cannot be designed with this material.`);
  const R=D_mm/2+CA_mm, Dc=D_mm+2*CA_mm;                          // corroded inside radius / diameter
  const aRad=alpha*Math.PI/180;
  const warns=[];
  let t, formula, standardName, method='thin-wall', mawp;
  if (std==='asme8d1') {
    if (type==='cylinder') {
      standardName='ASME VIII Div.1 UG-27(c)(1)';
      t=P*R/(SE-0.6*P); formula='t = P·R/(S·E − 0.6·P)';
      if (t>R/2 || P>0.385*SE) {
        const Z=(SE+P)/(SE-P); t=R*(Math.sqrt(Z)-1); method='thick-wall';
        standardName='ASME VIII Div.1 Appendix 1-2(a)(1)'; formula='t = R·(√Z − 1),  Z = (S·E + P)/(S·E − P)';
        warns.push('ℹ Thin-wall limit exceeded (t > R/2 or P > 0.385·S·E) — Appendix 1-2 thick-cylinder formula used.');
      }
      mawp=te=>method==='thick-wall' ? SE*((R+te)**2-R*R)/((R+te)**2+R*R) : SE*te/(R+0.6*te);
    } else if (type==='sphere') {
      standardName='ASME VIII Div.1 UG-27(d)';
      t=P*R/(2*SE-0.2*P); formula='t = P·R/(2·S·E − 0.2·P)';
      if (t>0.356*R || P>0.665*SE) {
        const Y=2*(SE+P)/(2*SE-P); t=R*(Math.cbrt(Y)-1); method='thick-wall';
        standardName='ASME VIII Div.1 Appendix 1-3'; formula='t = R·(Y^⅓ − 1),  Y = 2(S·E + P)/(2·S·E − P)';
        warns.push('ℹ Thin-wall limit exceeded — Appendix 1-3 thick-sphere formula used.');
      }
      mawp=te=>method==='thick-wall' ? 2*SE*((R+te)**3-R**3)/((R+te)**3+2*R**3) : 2*SE*te/(R+0.2*te);
    } else {
      standardName=`ASME VIII Div.1 UG-32(g) cone, α = ${alpha}°`;
      t=P*Dc/(2*Math.cos(aRad)*(SE-0.6*P)); formula='t = P·D/(2·cos α·(S·E − 0.6·P))';
      if (alpha>30) warns.push('⚠ Half-apex angle above 30° — Appendix 1-5 cone-to-cylinder junction reinforcement must be checked.');
      mawp=te=>2*SE*te*Math.cos(aRad)/(Dc+1.2*te*Math.cos(aRad));
    }
  } else {
    const nm = std==='en13445' ? 'EN 13445-3' : 'PD 5500';
    if (type==='sphere') { standardName=`${nm} sphere`; t=P*Dc/(4*SE-P); formula='e = P·Di/(4·f·z − P)'; mawp=te=>4*SE*te/(Dc+te); }
    else if (type==='cone') { standardName=`${nm} cone, α = ${alpha}°`; t=P*Dc/(2*SE-P)/Math.cos(aRad); formula='e = P·Di/((2·f·z − P)·cos α)'; mawp=te=>2*SE*te*Math.cos(aRad)/(Dc+te*Math.cos(aRad)); }
    else { standardName=`${nm} cylinder`; t=P*Dc/(2*SE-P); formula='e = P·Di/(2·f·z − P)'; mawp=te=>2*SE*te/(Dc+te); }
    if (t/(Dc/2) > 0.16) warns.push('⚠ e/R above 0.16 — outside the usual thin-shell range of these formulas; check the code limits.');
  }
  const t_calc_mm=t, t_with_CA=t+CA_mm+MT_mm;
  const t_nominal=Math.ceil(t_with_CA*2)/2;
  const t_eff=t_nominal-CA_mm-MT_mm;
  const pMax_check_bar=mawp(t_eff)*10;
  const OD_mm=D_mm+2*t_nominal;
  const tRatio=t/R;
  return {t_calc_mm, t_thin_mm:t, t_with_CA, t_nominal, OD_mm, tRatio, isThickWall:method==='thick-wall', method,
          pMax_check_bar, lameT:null, P_barg, P_MPa:P, D_mm, S_MPa, E, CA_mm, MT_mm, formula, standardName, warns};
}

// ─── SELF-TEST (NEW 2026-10) ─────────────────────────────────────────────────
// {"calcType":"selftest"} checks the deployed build's internal correlations
// against closed-form or published values. Used by hx-regression.html.
function runSelfTest() {
  const out = [];
  const near = (name, got, exp, tol, ref) => out.push({ name, got: +(+got).toPrecision(5), expected: +(+exp).toPrecision(5), tol: +(+tol).toPrecision(3), ref,
    pass: isFinite(got) && Math.abs(got - exp) <= tol });
  const ok = (name, cond, got, ref) => out.push({ name, got, expected: '—', ref, pass: !!cond });
  const tryF = fn => { try { return fn(); } catch (e) { return NaN; } };

  // LMTD correction factors
  near('F, one 1-2 shell, R = 1, P = 0.5', calcF_1_2(1, 0.5).F, 0.8023, 0.002, 'Bowman closed form, R = 1 branch');
  near('F, one 1-2 shell, R = 0.5, P = 0.6', calcF_1_2(0.5, 0.6).F, 0.8829, 0.002, 'Bowman–Mueller–Nagle');
  near('F, two 1-2 shells in series, R = 0.5, P = 0.6', calcF_1_2(0.5, seriesP1(0.6, 0.5, 2)).F, 0.9734, 0.002, 'Series P transform (TEMA T-1.2)');
  ok('1-2 shell with a temperature cross is rejected (R = 1, P = 0.6)', calcF_1_2(1, 0.6).valid === false, calcF_1_2(1, 0.6).valid ? 'accepted' : 'rejected', 'F undefined');
  near('F, crossflow, Cmax mixed, Cr = 0.5, NTU = 1', calcF_cross_mixed(0.5, 0.54194).F, 0.9295, 0.002, 'ε = (1/Cr)(1 − exp(−Cr(1 − e^−NTU)))');
  near('F, crossflow both unmixed, Cr = 1, ε = 0.4685', calcF_crossflow(1, 0.4685).F, 0.8815, 0.003, 'ESDU ε–NTU, F = NTUcounter/NTUcross');
  near('F, crossflow, condensing limit (R = 0)', calcF_crossflow(0, 0.5).F, 1, 0.001, 'R = 0 ⇒ F = 1');
  const fc1 = calcF_counterCross(1, 0.5, 1).F, fc4 = calcF_counterCross(1, 0.5, 4).F;
  ok('Counter-crossflow F rises with passes (1 → 4)', fc4 > fc1 && fc4 <= 1, `${fc1.toFixed(3)} → ${fc4.toFixed(3)}`, 'approaches counterflow');
  near('LMTD, counterflow 150→90 / 30→75', calcLMTD(150, 90, 30, 75, 'counter').lmtd, 67.22, 0.02, '(75 − 60)/ln(75/60)');

  // Bell-Delaware ideal-bank curves: no jumps where the coefficient ranges meet
  let worst = 0, where = '';
  for (const key of [30, 45, 90]) for (const Re of [10, 100, 1000, 10000]) {
    const lo = taborekIdeal(Re * 0.999, 1.25, key), hi = taborekIdeal(Re * 1.001, 1.25, key);
    for (const k of ['j', 'f']) { const d = Math.abs(hi[k] / lo[k] - 1); if (d > worst) { worst = d; where = `${key}°, Re ${Re}, ${k}`; } }
  }
  ok('Taborek j/f curves continuous at range limits (< 6 %)', worst < 0.06, `${(worst * 100).toFixed(1)} % at ${where}`, 'HEDH 3.3.2 coefficients');

  // Crossflow area in the right units (compare with Kern's B·Ds·(PT − Do)/PT)
  const Ds = 0.489, Do = 0.01905, B = 0.4 * Ds;
  const gm = bdLeakGeometry(Ds, Do, 1.25, 0.25, 0.4, 294, 'fixed', 'triangular');
  const ratio = gm.Sm / (B * Ds * (1.25 * Do - Do) / (1.25 * Do));
  ok('Bell-Delaware crossflow area Sm ≈ Kern estimate (0.7–1.2×)', ratio > 0.7 && ratio < 1.2, ratio.toFixed(3), 'Sm = B·[Lbb + (Dctl/Ptef)(Pt − Do)]');

  // Tube side: Gnielinski, water at 40 °C, 1.5 m/s in a 15.75 mm tube, L = 4.88 m
  const w = fluidAtConditions('water', 40, 3), Di = 0.01575, L = 4.88;
  const mdot = 1.5 * w.rho * Math.PI * Di * Di / 4;
  const Re = w.rho * 1.5 * Di / (w.mu * 1e-3), Pr = w.mu * 1e-3 * w.cp * 1000 / w.k;
  const fg = Math.pow(0.79 * Math.log(Re) - 1.64, -2);
  const NuG = (fg / 8) * (Re - 1000) * Pr / (1 + 12.7 * Math.sqrt(fg / 8) * (Math.pow(Pr, 2 / 3) - 1)) * (1 + Math.pow(Di / L, 2 / 3));
  near('Tube-side h, Gnielinski (water, 1.5 m/s)', calcHtube(w, mdot, Di, L).h, NuG * w.k / Di, 0.01 * NuG * w.k / Di, 'VDI Atlas G1 eq. (26)');

  // Wall thickness
  near('ASME UG-27 cylinder, 10 barg, ID 1000, S 138 MPa', tryF(() => calcWallThickness({ P: 10, D: 1000, S: 138, E: 1 }).t_calc_mm), 3.639, 0.002, 't = PR/(SE − 0.6P)');
  near('ASME UG-27 cylinder with 3 mm CA (corroded R)', tryF(() => calcWallThickness({ P: 10, D: 1000, S: 138, E: 1, CA: 3 }).t_calc_mm), 3.661, 0.002, 'R = Ri + CA');
  near('ASME App. 1-2 thick cylinder, 600 barg', tryF(() => calcWallThickness({ P: 600, D: 1000, S: 138, E: 1 }).t_calc_mm), 296.62, 0.05, 't = R(√Z − 1)');
  near('EN 13445-3 cylinder, 10 bar, Di 1000, f 138', tryF(() => calcWallThickness({ std: 'en13445', P: 10, D: 1000, S: 138, E: 1 }).t_calc_mm), 3.636, 0.002, 'e = P·Di/(2fz − P)');

  // Property layer: liquid and vapour of one substance at Tsat keep their own phase
  {
    const Ts = satTemperature('water', 2);
    const vap = fluidAtConditions('steam', Ts, 2), liq = fluidAtConditions('water', Ts, 2);
    ok('Saturated steam / condensate at 2 bar a keep their own density', vap.rho < 5 && liq.rho > 900, `${vap.rho.toFixed(2)} / ${liq.rho.toFixed(0)} kg/m³`, 'phase-aware property cache');
  }

  // Shell & tube: film coefficients belong to the geometry that is reported
  try {
    const r = calcShellTube({ hFlKey: 'water', cFlKey: 'water', hPop: 4, cPop: 3, hTi: 90, hTo: 55, cTi: 30, hF: 20000, cF: 60000,
      coldMode: 'flow', OD: 19.05, tw: 1.65, L: 3.66, pitch: 1.25, Rfo: 0.0002, Rfi: 0.0002, arr: 'counter', mat: 'cs', hxType: '1-2',
      tema: 'C', bcut: 0.25, bspMode: 'auto', velMode: 'target', targetVel: 1.5, pdAllowShell: 0.7, pdAllowTube: 0.7,
      pitchLayout: 'triangular', shellMode: 'single-phase' });
    const bd = calcBellDelaware(r.hFluid, r.massH_kgh / 3600, r.shellID, r.OD, r.pitchRatio, 0.25, r.bsp, r.L, r.numTubes, r.tema, r.pitchLayout, 'fixed');
    near('Shell-side Re at the reported shell, tubes and baffles', r.bdCorr.shellRe, bd.shellRe, 0.001 * bd.shellRe, 'U is evaluated at the final geometry');
    near('Bell-Delaware J-factor product at the reported geometry', r.bdCorr.Jtotal, bd.Jtotal, 0.001 * bd.Jtotal, 'Jc·Jl·Jb·Jr·Js');
    const ht = calcHtube(r.cFluid, (r.massC_kgh / 3600) / r.nTubesPerPass, r.Di, r.L);
    ok('Tube-side h at the reported tubes per pass (within wall-viscosity correction)', r.bdCorr.hTube / ht.h > 0.9 && r.bdCorr.hTube / ht.h < 1.15, (r.bdCorr.hTube / ht.h).toFixed(3), 'Gnielinski × (μ/μw)^0.14');
  } catch (e) { ok('Shell & tube reference case runs', false, e.message, ''); }

  return { apiBuild: API_BUILD, passed: out.filter(t => t.pass).length, total: out.length, tests: out };
}

// ─── ENERGY BALANCE PREVIEW (NEW 2026-10) ───────────────────────────────────
// Light endpoint for the live "Q / cold outlet" chip in the shell & tube form.
// Never throws for incomplete input — returns {ok:false, msg} instead.
function calcBalance(b) {
  const hFlKey = b.hFlKey || 'water', cFlKey = b.cFlKey || 'water';
  const hPop = parseFloat(b.hPop) || P_REF_DB, cPop = parseFloat(b.cPop) || P_REF_DB;
  const hTi = parseFloat(b.hTi), hTo = parseFloat(b.hTo), cTi = parseFloat(b.cTi), hF = parseFloat(b.hF);
  const mode = b.shellMode || 'single-phase', coldMode = b.coldMode || 'flow';
  if (![hTi, hTo, cTi, hF].every(isFinite) || hF <= 0) return { ok: false, msg: 'Enter hot temperatures, hot flow and cold inlet.' };
  const mH = hF / 3600;
  let Q, Tsat_h = null, Tsat_c = null;
  if (mode === 'condensing') {
    if (hTo > hTi) return { ok: false, msg: 'Hot outlet cannot be above hot inlet.' };
    Tsat_h = satTemperature(hFlKey, hPop);
    if (Tsat_h == null) return { ok: false, msg: 'No saturation data for this hot fluid.' };
    const hv = hvapAtT(hFlKey, Tsat_h);
    const vap = fluidAtConditions(hFlKey, Math.max(hTi, Tsat_h), hPop);
    const liq = fluidAtConditions(LIQUID_OF[hFlKey] || hFlKey, Math.min(hTo, Tsat_h), hPop);
    Q = mH * (vap.cp * Math.max(hTi - Tsat_h, 0) + hv + liq.cp * Math.max(Tsat_h - hTo, 0));
  } else {
    if (hTo >= hTi) return { ok: false, msg: 'Hot outlet must be below hot inlet.' };
    Q = mH * fluidAtConditions(hFlKey, (hTi + hTo) / 2, hPop).cp * (hTi - hTo);
  }
  let cTo = parseFloat(b.cTo), cF = parseFloat(b.cF);
  if (mode === 'evaporating') {
    Tsat_c = satTemperature(cFlKey, cPop);
    if (Tsat_c == null) return { ok: false, msg: 'No saturation data for this cold fluid.' };
    cTo = Tsat_c;
    if (coldMode !== 'flow' || !(cF > 0)) {
      const c = fluidAtConditions(cFlKey, cTi, cPop);
      cF = Q / (c.cp * Math.max(Tsat_c - cTi, 0) + hvapAtT(cFlKey, Tsat_c)) * 3600;
    }
  } else if (coldMode === 'flow') {
    if (!(cF > 0)) return { ok: false, msg: 'Enter the cold flow rate.' };
    let c = fluidAtConditions(cFlKey, cTi, cPop);
    for (let i = 0; i < 3; i++) { cTo = cTi + Q / ((cF / 3600) * c.cp); c = fluidAtConditions(cFlKey, (cTi + cTo) / 2, cPop); }
  } else {
    if (!(cTo > cTi)) return { ok: false, msg: 'Cold outlet must be above cold inlet.' };
    const c = fluidAtConditions(cFlKey, (cTi + cTo) / 2, cPop);
    cF = Q / (c.cp * (cTo - cTi)) * 3600;
  }
  const hotIn = hTi, hotOut = mode === 'condensing' ? Math.min(hTo, Tsat_h) : hTo;
  const approach = Math.min(hotIn - cTo, hotOut - cTi);
  return { ok: true, Q_kW: Q, cTo, cF_kgh: cF, Tsat_h, Tsat_c, approach,
           cross: approach <= 0, msg: approach <= 0 ? 'Temperature cross — the cold stream would leave hotter than the hot stream allows.' : null };
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
