// ════════════════════════════════════════════════════════════════════════════
// api/materials-utilities.js
// MERGED VERCEL SERVERLESS API — FILE 2 of 5
//
// CALCULATORS IN THIS FILE
// ────────────────────────
//   SECTION A  ►  MATERIAL OF CONSTRUCTION (MOC)       /api/moc
//   SECTION B  ►  NPSH CALCULATOR                      /api/npsh-calculator
//   SECTION C  ►  COOLING TOWER PERFORMANCE            /api/cooling-tower
//   SECTION D  ►  PSYCHROMETRIC CALCULATOR             /api/psychrometric
//
// NOTE: material-grades-library is a front-end only page (no API backend).
//       No server-side handler is needed for it.
//
// HOW TO NAVIGATE
//   Search "SECTION A" → MOC / Material of Construction
//   Search "SECTION B" → NPSH Calculator
//   Search "SECTION C" → Cooling Tower
//   Search "SECTION D" → Psychrometric
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
    case 'moc':
      return await moc_handler(req, res);
    case 'npsh-calculator':
      return await npsh_handler(req, res);
    case 'cooling-tower':
      return await coolingTower_handler(req, res);
    case 'psychrometric':
      return await psychrometric_handler(req, res);
    default:
      return res.status(404).json({
        error: `Unknown route: "${key}". Valid: moc, npsh-calculator, cooling-tower, psychrometric`
      });
  }
}
// ── End of Router ────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// SECTION A  ►  MATERIAL OF CONSTRUCTION (MOC)
// Route: /api/moc
// (Original: SECTION 21 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 21 of 21  ►  MATERIAL OF CONSTRUCTION (MOC)
// Route: /api/moc
// Source: moc.js
// ══════════════════════════════════════════════════════════════════════════════

// MOC (Material of Construction) ENGINE
// Routes: GET  /api/moc  → catalog (equipment, industries, fluids)
//         POST /api/moc  → analyze (scoring engine, returns results)
// ================================================================

/* ── EQUIPMENT ── */
const EQUIPMENT = [
  {id:'pipe',       icon:'🔧', name:'Pipe / Tubing'},
  {id:'vessel',     icon:'🏺', name:'Storage Vessel'},
  {id:'pv',         icon:'🫙', name:'Pressure Vessel'},
  {id:'hx',         icon:'♨️',  name:'Heat Exchanger'},
  {id:'sep',        icon:'⚗️',  name:'Separator'},
  {id:'column',     icon:'🏛️', name:'Distill. Column'},
  {id:'reactor',    icon:'⚡', name:'Reactor'},
  {id:'pump',       icon:'💧', name:'Pump Casing'},
  {id:'compressor', icon:'⚙️', name:'Compressor'},
  {id:'tank',       icon:'🛢️', name:'Storage Tank'},
  {id:'coil',       icon:'🔩', name:'Coil / Jacket'},
  {id:'valve',      icon:'🔑', name:'Valve Body'},
  {id:'nozzle',     icon:'💨', name:'Nozzle / Fitting'},
  {id:'condenser',  icon:'❄️', name:'Condenser'},
  {id:'reboiler',   icon:'🔥', name:'Reboiler'},
  {id:'filter',     icon:'🗂️', name:'Filter / Strainer'},
];

/* ── INDUSTRIES ── */
const INDUSTRIES = ['All','Oil & Gas','Chemical','Petrochemical','Water','Power','Food & Bev','Pharma','Mining'];

/* ── FLUID LIBRARY — PROTECTED ── */
const FLUIDS = [
  {id:'crude',       name:'Crude Oil',              sub:'Sour / sweet',      color:'#3a2800', ind:'Oil & Gas',      corr:'moderate', acid:false, alkali:false, h2s:true,  cl:false},
  {id:'nat_gas',     name:'Natural Gas (Dry)',       sub:'Non-corrosive',     color:'#6b5a00', ind:'Oil & Gas',      corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'h2s_gas',     name:'H₂S (Sour Gas)',         sub:'Wet sour service',  color:'#8a4000', ind:'Oil & Gas',      corr:'severe',   acid:true,  alkali:false, h2s:true,  cl:false},
  {id:'diesel',      name:'Diesel / Fuel Oil',      sub:'Refined product',   color:'#5a4000', ind:'Oil & Gas',      corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'h2so4',       name:'Sulphuric Acid H₂SO₄',  sub:'All concentrations',color:'#8a0000', ind:'Chemical',       corr:'severe',   acid:true,  alkali:false, h2s:false, cl:false},
  {id:'hcl',         name:'Hydrochloric Acid HCl',  sub:'All concentrations',color:'#6b0000', ind:'Chemical',       corr:'severe',   acid:true,  alkali:false, h2s:false, cl:true},
  {id:'hno3',        name:'Nitric Acid HNO₃',       sub:'All concentrations',color:'#7a2000', ind:'Chemical',       corr:'severe',   acid:true,  alkali:false, h2s:false, cl:false},
  {id:'naoh',        name:'Caustic Soda NaOH',      sub:'All concentrations',color:'#004060', ind:'Chemical',       corr:'moderate', acid:false, alkali:true,  h2s:false, cl:false},
  {id:'hf',          name:'Hydrofluoric Acid HF',   sub:'Alkylation units',  color:'#8a0000', ind:'Petrochemical',  corr:'severe',   acid:true,  alkali:false, h2s:false, cl:false},
  {id:'h3po4',       name:'Phosphoric Acid H₃PO₄',  sub:'All concentrations',color:'#6b4000', ind:'Chemical',       corr:'severe',   acid:true,  alkali:false, h2s:false, cl:false},
  {id:'water_sw',    name:'Seawater',               sub:'Cl⁻ ~18,000 ppm',  color:'#004080', ind:'Water',          corr:'severe',   acid:false, alkali:false, h2s:false, cl:true},
  {id:'water_fw',    name:'Fresh Water',            sub:'General service',   color:'#0066cc', ind:'Water',          corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'water_bw',    name:'Boiler Feed Water',      sub:'Demineralised',     color:'#003366', ind:'Power',          corr:'moderate', acid:false, alkali:false, h2s:false, cl:false},
  {id:'water_cl',    name:'Cooling Water (CW)',     sub:'Treated CW',        color:'#00668a', ind:'Water',          corr:'moderate', acid:false, alkali:false, h2s:false, cl:true},
  {id:'steam',       name:'Steam (Process)',        sub:'Saturated/super',   color:'#6b6b6b', ind:'Power',          corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'milk',        name:'Milk / Dairy',           sub:'Sanitary grade',    color:'#b8a060', ind:'Food & Bev',     corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'ethanol',     name:'Ethanol / Alcohol',      sub:'Fermentation',      color:'#8a6000', ind:'Food & Bev',     corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'pharma',      name:'WFI / Pharma Media',     sub:'USP grade',         color:'#6b4080', ind:'Pharma',         corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'benzene',     name:'Benzene / Aromatics',    sub:'Carcinogenic',      color:'#4a3a00', ind:'Petrochemical',  corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'fgd',         name:'FGD Slurry (Gypsum)',    sub:'Power plant',       color:'#808060', ind:'Power',          corr:'moderate', acid:true,  alkali:false, h2s:false, cl:true},
  {id:'lox',         name:'Liquid Oxygen LOX',      sub:'Cryogenic',         color:'#0080cc', ind:'Chemical',       corr:'moderate', acid:false, alkali:false, h2s:false, cl:false},
  {id:'lng',         name:'LNG / LPG',              sub:'Cryogenic',         color:'#00666b', ind:'Oil & Gas',      corr:'low',      acid:false, alkali:false, h2s:false, cl:false},
  {id:'brine',       name:'Produced Water / Brine', sub:'High Cl⁻',         color:'#6b6b00', ind:'Oil & Gas',      corr:'severe',   acid:false, alkali:false, h2s:true,  cl:true},
  {id:'co2',         name:'CO₂ / Carbonic Acid',   sub:'Wet CO₂',           color:'#666699', ind:'Oil & Gas',      corr:'moderate', acid:true,  alkali:false, h2s:false, cl:false},
  {id:'amine',       name:'Amine (MEA/DEA/MDEA)',   sub:'H₂S absorption',    color:'#336633', ind:'Oil & Gas',      corr:'moderate', acid:false, alkali:true,  h2s:true,  cl:false},
  {id:'acid_mine',   name:'Acid Mine Drainage',     sub:'pH 1–4',            color:'#8a4000', ind:'Mining',         corr:'severe',   acid:true,  alkali:false, h2s:false, cl:true},
  {id:'sulfur',      name:'Molten Sulfur',          sub:'130–160°C',         color:'#b8a000', ind:'Petrochemical',  corr:'severe',   acid:false, alkali:false, h2s:true,  cl:false},
  {id:'nh3',         name:'Ammonia NH₃',            sub:'Anhydrous/aqueous', color:'#006b4a', ind:'Chemical',       corr:'moderate', acid:false, alkali:true,  h2s:false, cl:false},
  {id:'cl2',         name:'Chlorine Gas Cl₂',       sub:'Wet / Dry',         color:'#5a6b00', ind:'Chemical',       corr:'severe',   acid:false, alkali:false, h2s:false, cl:true},
  {id:'chlorine_sol',name:'Brine / NaCl Solution',  sub:'Chlor-alkali',      color:'#006633', ind:'Chemical',       corr:'moderate', acid:false, alkali:false, h2s:false, cl:true},
];

/* ── FLUID AUTOFILL HINTS (UX only — no engine logic) ── */
const FLUID_AUTOFILL = {
  h2so4:{pH:1,H2S:0,Cl:0}, hcl:{pH:1,H2S:0,Cl:100000}, hno3:{pH:1,H2S:0,Cl:0},
  h3po4:{pH:2,H2S:0,Cl:0}, co2:{pH:5,H2S:0,Cl:0}, naoh:{pH:13,H2S:0,Cl:0},
  nh3:{pH:11,H2S:0,Cl:0}, acid_mine:{pH:2,H2S:0,Cl:0}, water_sw:{pH:8,H2S:0,Cl:18000},
  water_fw:{pH:7,H2S:0,Cl:0}, water_bw:{pH:9.5,H2S:0,Cl:0}, water_cl:{pH:7.5,H2S:0,Cl:200},
  brine:{pH:7,H2S:0.005,Cl:50000}, crude:{pH:6,H2S:0.01,Cl:0}, h2s_gas:{pH:5,H2S:0.1,Cl:0},
  amine:{pH:9,H2S:0.005,Cl:0}, sulfur:{pH:5,H2S:0.05,Cl:0}, fgd:{pH:4,H2S:0,Cl:0},
  chlorine_sol:{pH:7,H2S:0,Cl:15000}, cl2:{pH:6,H2S:0,Cl:10000},
  lox:{pH:7,H2S:0,Cl:0}, lng:{pH:7,H2S:0,Cl:0}, milk:{pH:6.5,H2S:0,Cl:0},
  ethanol:{pH:7,H2S:0,Cl:0}, benzene:{pH:7,H2S:0,Cl:0},
};

/* ── MATERIAL DATABASE — PROTECTED ── */
const MATERIALS = {
  CS_A106:   {id:'CS_A106',   group:'Carbon Steel',   color:'#5a3e00',name:'Carbon Steel A106',        grade:'ASTM A106 Gr.B / IS 2062 Gr.B',           std:'ASTM A106, A53, IS:2062',      cost_idx:1.0,  t_min:-29, t_max:425, p_max:400,composition:{C:'0.30 max',Mn:'0.29–1.06',P:'0.048 max',S:'0.058 max',Si:'0.10 min',Fe:'Balance'},pros:['Lowest cost','Widely available','Easy to weld','Good for dry non-corrosive service'],cons:['Not for wet/corrosive service','Not for acids/alkalis','Corrosion allowance required'],suits:['nat_gas','diesel','steam','water_bw','lng'],avoids:['h2so4','hcl','hno3','water_sw','cl2','fgd','acid_mine'],desc:'Standard carbon steel for non-corrosive service. Most economical option. Widely used in oil & gas for dry service.',tags:['Low Alloy','Weldable','General Service']},
  MS_Fe410:  {id:'MS_Fe410',  group:'Mild Steel',     color:'#7a5a00',name:'Mild Steel IS 2062',        grade:'IS 2062 E250/E350 (Fe410)',                std:'IS:2062, BS EN 10025',          cost_idx:0.9,  t_min:-10, t_max:350, p_max:150,composition:{C:'0.23 max',Mn:'1.50 max',P:'0.045 max',S:'0.045 max',Si:'0.40 max',Fe:'Balance'},pros:['Very low cost','Excellent weldability','Good machinability'],cons:['Very prone to corrosion','Not for corrosive service','Limited temperature'],suits:['nat_gas','diesel','benzene'],avoids:['h2so4','hcl','water_sw','water_fw','cl2','brine'],desc:'General structural steel. Lowest cost but poorest corrosion resistance. For structural/non-process components.',tags:['Structural','Low Cost','Non-Corrosive Only']},
  LAS_P11:   {id:'LAS_P11',   group:'Low Alloy Steel',color:'#4a3000',name:'Low Alloy Steel Cr-Mo',     grade:'ASTM A335 P11 / P22',                     std:'ASTM A335, A387',               cost_idx:2.5,  t_min:-29, t_max:600, p_max:600,composition:{C:'0.05–0.15',Cr:'1.00–1.50',Mo:'0.44–0.65',Mn:'0.30–0.60',Si:'0.50–1.00',Fe:'Balance'},pros:['High temperature service','Good creep resistance','HTHA resistance per API 941 Nelson curves'],cons:['PWHT required','Not for corrosive service'],suits:['steam','nat_gas','diesel'],avoids:['h2so4','hcl','water_sw'],desc:'Cr-Mo alloy steel for high-temperature, high-pressure service. Refinery heaters, steam piping above 400°C.',tags:['High Temp','Cr-Mo','Creep Resistant']},
  SS_304:    {id:'SS_304',    group:'Stainless Steel',color:'#6a8a9a',name:'Stainless Steel 304',        grade:'ASTM A312 TP304 / UNS S30400',             std:'ASTM A312, A240, IS:6913',      cost_idx:4.5,  t_min:-196,t_max:870, p_max:400,composition:{C:'0.08 max',Cr:'18.0–20.0',Ni:'8.0–10.5',Mn:'2.0 max',Si:'0.75 max',N:'0.10 max',Fe:'Balance'},pros:['Good general corrosion resistance','Food/pharma grade','Wide temperature range'],cons:['Cl SCC above ~60°C','Not for HCl or HF'],suits:['water_fw','steam','milk','ethanol','pharma','naoh','nh3','nat_gas'],avoids:['hcl','hf','water_sw','brine','cl2','acid_mine'],desc:'Austenitic SS for moderate corrosion, food, pharma, and general process. Avoid chloride-rich environments at elevated temperature.',tags:['Austenitic','Food Grade','General Corrosion']},
  SS_316L:   {id:'SS_316L',   group:'Stainless Steel',color:'#5a7a8a',name:'Stainless Steel 316L',       grade:'ASTM A312 TP316L / UNS S31603',            std:'ASTM A312, A240, IS:6913',      cost_idx:5.5,  t_min:-196,t_max:870, p_max:400,composition:{C:'0.035 max',Cr:'16.0–18.0',Ni:'10.0–14.0',Mo:'2.0–3.0',Mn:'2.0 max',Fe:'Balance'},pros:['Better chloride resistance than 304 (Mo addition)','Low C — no sensitisation','Pharma/food grade'],cons:['Cl SCC risk above 60°C','Not for concentrated HCl/HF'],suits:['water_fw','water_cl','steam','milk','ethanol','pharma','naoh','nh3','co2','amine'],avoids:['hcl','hf','water_sw','cl2','acid_mine'],desc:'Mo-bearing austenitic SS. Preferred over 304 for moderate chloride, pharma, and food process service.',tags:['Austenitic','Mo-Bearing','Low Carbon','Pharma']},
  SS_317L:   {id:'SS_317L',   group:'Stainless Steel',color:'#5070a0',name:'Stainless Steel 317L',       grade:'ASTM A312 TP317L / UNS S31703',            std:'ASTM A312, A240',               cost_idx:6.5,  t_min:-196,t_max:870, p_max:400,composition:{C:'0.035 max',Cr:'18.0–20.0',Ni:'11.0–15.0',Mo:'3.0–4.0',Mn:'2.0 max',Fe:'Balance'},pros:['Higher Mo than 316L — better Cl resistance','Good for dilute acids','FGD service'],cons:['Higher cost than 316L','Still susceptible to high-Cl SCC'],suits:['water_cl','co2','fgd','amine','h3po4'],avoids:['hcl','water_sw','cl2','hf','acid_mine'],desc:'Higher Mo than 316L. FGD systems, phosphoric acid, moderately aggressive chloride environments.',tags:['High Mo','FGD','Acid Resistant']},
  SS_321:    {id:'SS_321',    group:'Stainless Steel',color:'#7a90a0',name:'Stainless Steel 321',         grade:'ASTM A312 TP321 / UNS S32100',             std:'ASTM A312, A240',               cost_idx:5.8,  t_min:-196,t_max:900, p_max:400,composition:{C:'0.08 max',Cr:'17.0–19.0',Ni:'9.0–12.0',Ti:'5×C min',Mn:'2.0 max',Fe:'Balance'},pros:['Ti-stabilised — excellent sensitisation resistance','High-temp welded assemblies'],cons:['Similar Cl SCC risk as 304','Not for highly corrosive media'],suits:['steam','nat_gas','diesel','amine','co2'],avoids:['hcl','water_sw','cl2','hf'],desc:'Ti-stabilised austenitic SS for welded construction at elevated temperatures. Refinery HX, furnace tubing.',tags:['Ti-Stabilised','Weld Service','High Temp']},
  DSS_2205:  {id:'DSS_2205',  group:'Duplex SS',      color:'#304870',name:'Duplex SS 2205',              grade:'ASTM A790 UNS S31803/S32205',              std:'ASTM A790, A928',               cost_idx:8.5,  t_min:-50, t_max:315, p_max:500,composition:{C:'0.03 max',Cr:'21.0–23.0',Ni:'4.5–6.5',Mo:'2.5–3.5',N:'0.08–0.20',Fe:'Balance'},pros:['Excellent Cl SCC resistance (PREN~35)','High strength — thinner walls','Good pitting resistance'],cons:['Max 315°C (sigma phase)','Higher cost','Welding care needed'],suits:['water_sw','brine','water_cl','crude','amine','co2','h3po4'],avoids:['hcl','hf','cl2','h2so4'],desc:'Duplex SS for excellent seawater, brine, and chloride resistance where austenitic grades fail by SCC.',tags:['Duplex','Seawater','High Strength','SCC Resistant']},
  SDSS_2507: {id:'SDSS_2507', group:'Duplex SS',      color:'#203060',name:'Super Duplex SS 2507',        grade:'ASTM A790 UNS S32750',                     std:'ASTM A790, A928',               cost_idx:12.0, t_min:-50, t_max:300, p_max:500,composition:{C:'0.03 max',Cr:'24.0–26.0',Ni:'6.0–8.0',Mo:'3.0–5.0',N:'0.24–0.32',Fe:'Balance'},pros:['Highest PREN ~42','Extreme Cl/seawater resistance','Very high strength'],cons:['Most expensive standard SS','Strict welding','Max 300°C'],suits:['water_sw','brine','crude','h2s_gas'],avoids:['hcl','hf','cl2'],desc:'Super Duplex for most aggressive chloride environments. Subsea pipelines, topside processing.',tags:['Super Duplex','Subsea','Extreme Cl Resistance']},
  Inconel625:{id:'Inconel625',group:'Nickel Alloy',   color:'#1a5060',name:'Alloy 625 (Inconel 625)',     grade:'ASTM B444 UNS N06625',                     std:'ASTM B444, B705',               cost_idx:25.0, t_min:-196,t_max:980, p_max:500,composition:{Ni:'58 min',Cr:'20.0–23.0',Mo:'8.0–10.0',Nb:'3.15–4.15',Fe:'5.0 max',Co:'1.0 max'},pros:['Exceptional corrosion resistance','Wide temp range','No Cl SCC','Excellent HCl and H₂SO₄'],cons:['Very high cost','Limited availability'],suits:['hcl','h2so4','water_sw','brine','cl2','acid_mine','hf'],avoids:[],desc:'Ni-based superalloy. Premium MOC for aggressive acids, seawater, and high-temperature corrosive service.',tags:['Ni-Alloy','Premium','All Corrosives','High Temp']},
  Hast_C276: {id:'Hast_C276', group:'Nickel Alloy',   color:'#0a2840',name:'Hastelloy C-276',             grade:'ASTM B574 UNS N10276',                     std:'ASTM B574, B619',               cost_idx:30.0, t_min:-196,t_max:1040,p_max:500,composition:{Ni:'57 min',Mo:'15.0–17.0',Cr:'14.5–16.5',W:'3.0–4.5',Fe:'4.0–7.0',Co:'2.5 max'},pros:['Best all-round acid resistance','Excellent HCl','Chlorine and halogen service'],cons:['Extremely high cost','Specialist procurement only'],suits:['hcl','h2so4','hno3','cl2','acid_mine','hf','h2s_gas'],avoids:[],desc:'Gold standard Ni-Mo-Cr alloy for severe corrosion. Virtually immune to pitting/crevice/SCC.',tags:['Hastelloy','Best Corrosion','Severe Duty']},
  Ti_Gr2:    {id:'Ti_Gr2',    group:'Titanium',       color:'#505060',name:'Titanium Grade 2',            grade:'ASTM B338 Grade 2 / UNS R50400',           std:'ASTM B338, B265',               cost_idx:20.0, t_min:-196,t_max:260, p_max:300,composition:{Ti:'99.2 min',Fe:'0.30 max',O:'0.25 max',C:'0.08 max',N:'0.03 max'},pros:['Immune to Cl SCC','Excellent seawater/Cl service','Lightweight (4.5 g/cm³)'],cons:['High cost','Max 260°C','Not for reducing acids or fluoride (HF)'],suits:['water_sw','water_cl','brine','cl2','hno3'],avoids:['hf','hcl'],desc:'Commercially pure titanium. Standard for seawater HX, condenser tubes, and chloride-rich offshore environments.',tags:['Titanium','Seawater','SCC Immune','Lightweight']},
  Zirconium: {id:'Zirconium', group:'Special Alloy',  color:'#707050',name:'Zirconium 702',               grade:'ASTM B523 UNS R60702',                     std:'ASTM B523',                     cost_idx:40.0, t_min:-196,t_max:370, p_max:300,composition:{Zr:'99.2 min (+ Hf)',Hf:'4.5 max',Fe:'0.20 max',O:'0.16 max'},pros:['Best for hot concentrated HCl','H₂SO₄ resistance','Acetic acid production'],cons:['Highest cost','Ignition risk in some oxidising acids'],suits:['hcl','h2so4','h3po4'],avoids:['hf','cl2'],desc:'Specialty alloy for hot concentrated HCl and sulfuric acid.',tags:['Special','Hot HCl','Sulphuric Acid']},
  HDPE:      {id:'HDPE',      group:'Polymer',        color:'#005533',name:'HDPE PE100',                   grade:'PE100 / ASTM D3035 / ISO 4427',            std:'ASTM D3035, ISO 4427',          cost_idx:0.8,  t_min:-50, t_max:60,  p_max:16, composition:{PE:'High Density Polyethylene',Density:'0.941–0.965 g/cm³',MFI:'0.2–1.0 g/10min',SDR:'11–26 typical'},pros:['Excellent acid/alkali resistance','Very low cost','No corrosion','Lightweight'],cons:['Max 60°C','Low pressure (<16 bar)','UV degradation outdoors'],suits:['water_fw','water_sw','water_cl','hcl','h2so4','naoh','nh3','acid_mine','h3po4','chlorine_sol'],avoids:['steam','lox','sulfur','lng'],desc:'HDPE for cold corrosive service. Water supply, acid distribution lines, chemical transport.',tags:['Polymer','Acid Resistant','Low Cost','Water']},
  PP:        {id:'PP',        group:'Polymer',        color:'#003388',name:'Polypropylene PP',             grade:'PP-H / PP-R (DIN 8077 / ISO 15494)',       std:'DIN 8077, ISO 15494',           cost_idx:0.9,  t_min:0,   t_max:80,  p_max:10, composition:{PP:'Polypropylene homopolymer/random copolymer',Density:'0.895–0.920 g/cm³',MFR:'0.3–3 g/10min'},pros:['Broad chemical resistance','Slightly higher temp than HDPE','Hygienic surface'],cons:['Brittle below 0°C','Max 80°C','Low pressure (<10 bar)'],suits:['water_fw','water_cl','hcl','h2so4','naoh','nh3','h3po4','milk','ethanol','acid_mine'],avoids:['steam','lox','sulfur','benzene','cl2'],desc:'Polypropylene piping for chemical, water treatment, and food/beverage service.',tags:['Polymer','Chemical Resistant','Low Pressure']},
  PVDF:      {id:'PVDF',      group:'Polymer',        color:'#440055',name:'PVDF / Kynar',                 grade:'ASTM D3222 Type I / DIN 16968',            std:'ASTM D3222',                    cost_idx:8.0,  t_min:-40, t_max:140, p_max:12, composition:{PVDF:'Polyvinylidene Fluoride',Density:'1.76–1.78 g/cm³',MW:'180,000–500,000'},pros:['Excellent halogen and acid resistance','Higher temp than PP/HDPE','Semiconductor-grade purity'],cons:['High cost for polymer','UV sensitive','Low pressure (<12 bar)'],suits:['hcl','cl2','water_fw','h3po4','pharma','h2so4'],avoids:['steam','lox','hno3'],desc:'Fluoropolymer for aggressive halogen and acid service.',tags:['Fluoropolymer','Halogen Resistant','Pharma']},
  FRP_VE:    {id:'FRP_VE',    group:'FRP/GRP',        color:'#006633',name:'FRP Vinyl Ester',              grade:'ASTM D5364 / ASME RTP-1',                  std:'ASME RTP-1, BS 4994',           cost_idx:3.5,  t_min:-40, t_max:100, p_max:6,  composition:{Matrix:'Vinyl Ester Resin',Reinforcement:'E-glass or C-glass',CorrosionBarrier:'2–3mm rich barrier',Laminate:'Filament wound'},pros:['Excellent acid/brine resistance','Lightweight','Large vessels cost-effective'],cons:['Pressure limited (<6 bar vessel)','Max ~100°C','Brittle — impact sensitive'],suits:['hcl','h2so4','water_sw','brine','h3po4','acid_mine','water_cl','fgd'],avoids:['steam','lox','benzene','cl2'],desc:'FRP with vinyl ester resin for FGD absorbers, acid storage tanks, and chemical process vessels.',tags:['FRP','Acid Resistant','Large Vessel','Lightweight']},
  CuNi_7030: {id:'CuNi_7030',group:'Copper Alloy',   color:'#c87c40',name:'Cupro-Nickel 70/30',           grade:'ASTM B466 UNS C71500',                     std:'ASTM B466, B111',               cost_idx:15.0, t_min:-196,t_max:260, p_max:200,composition:{Cu:'65–70%',Ni:'29–33%',Fe:'0.40–1.0',Mn:'1.0 max'},pros:['Excellent seawater resistance','Biofouling resistance','Standard HX tube for seawater condensers'],cons:['Not for oxidising acids','NH₃/amine attack susceptibility'],suits:['water_sw','water_fw','water_cl'],avoids:['h2so4','hcl','nh3','h2s_gas','crude'],desc:'70/30 Cu-Ni. Standard tube material for seawater-cooled HX, condensers, and desalination plants.',tags:['Cu-Ni','Seawater','HX Tubes','Marine']},
  Monel_400: {id:'Monel_400', group:'Nickel Alloy',   color:'#508060',name:'Monel 400',                    grade:'ASTM B165 UNS N04400',                     std:'ASTM B165, B127',               cost_idx:18.0, t_min:-196,t_max:480, p_max:400,composition:{Ni:'63 min',Cu:'28.0–34.0',Fe:'2.5 max',Mn:'2.0 max'},pros:['Excellent HF acid resistance','Good seawater resistance','HF alkylation unit standard'],cons:['SCC in moist aerated HF vapour','High cost'],suits:['hf','water_sw','crude','nat_gas'],avoids:['hno3','cl2'],desc:'Ni-Cu alloy. Industry standard for HF alkylation units.',tags:['Monel','HF Service','Ni-Cu','Alkylation']},
};

/* ── CORROSION RATES — PROTECTED ── */
const CORR_RATES = {
  'Carbon Steel':   {low:0.05, moderate:0.3,  severe:2.0},
  'Mild Steel':     {low:0.07, moderate:0.4,  severe:2.5},
  'Stainless Steel':{low:0.005,moderate:0.05, severe:0.5},
  'Duplex SS':      {low:0.002,moderate:0.02, severe:0.15},
  'Nickel Alloy':   {low:0.001,moderate:0.01, severe:0.05},
  'Titanium':       {low:0.001,moderate:0.005,severe:0.02},
  'Copper Alloy':   {low:0.02, moderate:0.1,  severe:0.8},
  'Polymer':        {low:0.0,  moderate:0.0,  severe:0.0},
  'FRP/GRP':        {low:0.0,  moderate:0.0,  severe:0.0},
  'Special Alloy':  {low:0.001,moderate:0.005,severe:0.02},
};

// ══════════════════════════════════════════════════════════════════════
//  ENGINE FUNCTIONS
// ══════════════════════════════════════════════════════════════════════

function getCorrSufficiency(mat, fluidCorr, life) {
  const rates = CORR_RATES[mat.group];
  if (!rates) return null;
  const rate      = rates[fluidCorr] || rates['moderate'];
  if (rate === 0) return {rate:0,totalLoss:0,minCA:0,adequate:true,note:'Polymer/FRP — no metallic corrosion allowance required.'};
  const totalLoss = rate * life;
  const minCA     = Math.ceil(totalLoss * 10) / 10;
  const minWall   = mat.group==='Nickel Alloy' ? 1.6 : mat.group==='Titanium' ? 0.9 : 3.0;
  const adequate  = minCA <= (minWall * 0.5);
  return {rate, totalLoss:totalLoss.toFixed(2), minCA:minCA.toFixed(1), adequate,
    note: adequate
      ? `Est. total loss ${totalLoss.toFixed(2)} mm over ${life} yr. Min corrosion allowance: ${minCA.toFixed(1)} mm.`
      : `⚠ Est. total loss ${totalLoss.toFixed(2)} mm over ${life} yr — corrosion allowance ${minCA.toFixed(1)} mm may be impractical. Consider upgrading material.`
  };
}

function scoreFluidMaterial(fluidId, mat, T, P, pH, Cl, H2S, V, costPrio, equipId, industry) {
  let score = 100;
  const f = FLUIDS.find(x => x.id === fluidId);
  if (!f) return 0;

  if (mat.avoids && mat.avoids.includes(fluidId)) return -1;
  if (T > mat.t_max || T < mat.t_min) return -1;
  if (P > mat.p_max) return -1;

  if (mat.suits && mat.suits.includes(fluidId)) score += 30;

  if (f.corr==='severe'   && mat.group==='Carbon Steel') score -= 40;
  if (f.corr==='severe'   && mat.group==='Mild Steel')   score -= 50;
  if (f.corr==='moderate' && mat.group==='Carbon Steel') score -= 20;
  if (f.corr==='low'      && (mat.group==='Carbon Steel'||mat.group==='Mild Steel')) score += 10;

  if (Cl > 200 && T > 60) {
    if (['SS_304','SS_316L','SS_317L','SS_321'].includes(mat.id)) score -= 35;
    if (['DSS_2205','SDSS_2507'].includes(mat.id)) score += 15;
    if (mat.id==='Ti_Gr2') score += 20;
  }
  if (Cl > 5000) {
    if (['SS_304','SS_316L','SS_317L','SS_321'].includes(mat.id)) return -1;
    if (['DSS_2205','SDSS_2507'].includes(mat.id)) score += 10;
  }

  if (H2S > 0.0003) {
    if (mat.group==='Carbon Steel' && T > 60)  score -= 20;
    if (mat.group==='Carbon Steel' && pH < 5)  return -1;
    if (H2S > 0.1 && (mat.group==='Carbon Steel'||mat.group==='Mild Steel')) return -1;
    if (['Inconel625','Hast_C276','Monel_400'].includes(mat.id)) score += 12;
    if (['DSS_2205','SDSS_2507'].includes(mat.id)) score += 8;
  }

  if (pH < 3) {
    if (mat.group==='Carbon Steel') score -= 30;
    if (mat.group==='Mild Steel')   score -= 35;
    if (['Inconel625','Hast_C276','Zirconium'].includes(mat.id)) score += 20;
    if (['HDPE','PP','FRP_VE'].includes(mat.id) && T < mat.t_max) score += 15;
  }
  if (pH > 11) {
    if (['Inconel625','SS_304','SS_316L'].includes(mat.id)) score += 8;
  }

  if (T > 250 && mat.group==='Polymer')  return -1;
  if (T > 300 && mat.group==='FRP/GRP')  return -1;
  if (T > 280 && mat.group==='Duplex SS') return -1;
  if (T > 425 && mat.id==='SS_304') score -= 25;
  if (T > 400 && ['SS_304','SS_316L','DSS_2205'].includes(mat.id)) score -= 10;
  if (T > 500 && mat.id==='LAS_P11') score += 20;

  const hthafluids = ['h2s_gas','crude','nat_gas','benzene','diesel','lng'];
  if (T > 230 && mat.group==='Carbon Steel' && hthafluids.includes(fluidId)) score -= 20;

  if (['co2','brine','crude','amine'].includes(fluidId) && H2S > 0.0003) {
    if (mat.group==='Carbon Steel'||mat.group==='Mild Steel') score -= 20;
    if (mat.group==='Stainless Steel') score += 5;
  }

  if (['water_fw','water_cl','water_sw','acid_mine'].includes(fluidId) &&
      (mat.group==='Carbon Steel'||mat.group==='Mild Steel')) score -= 15;

  if (V > 3  && ['Polymer','FRP/GRP'].includes(mat.group)) score -= 10;
  if (V > 5  && ['Polymer','FRP/GRP'].includes(mat.group)) score -= 15;
  if (V > 5  && mat.group==='Copper Alloy') score -= 20;
  if (V > 10 && mat.group==='Carbon Steel') score -= 10;
  if (V > 15 && mat.group==='Carbon Steel') score -= 20;
  if (V > 20 && mat.group==='Stainless Steel') score -= 10;

  if (equipId) {
    if (['vessel','pv','pipe'].includes(equipId) && ['Pharmaceutical','Food & Beverage'].includes(industry)) {
      if (['SS_304','SS_316L'].includes(mat.id)) score += 15;
      if (mat.group==='Carbon Steel'||mat.group==='Mild Steel') score -= 25;
    }
    if (['hx','condenser'].includes(equipId)) {
      if (mat.id==='Ti_Gr2')    score += 10;
      if (mat.id==='CuNi_7030') score += 8;
      if (mat.group==='FRP/GRP') score -= 20;
    }
    if (equipId==='pump') {
      if (mat.group==='Duplex SS') score += 8;
      if (mat.group==='Polymer')   score -= 10;
    }
    if (equipId==='tank' && P > 2 && mat.group==='Polymer') score -= 20;
    if (['column','reactor'].includes(equipId) && Cl > 500) {
      if (mat.group==='Stainless Steel') score -= 8;
      if (mat.group==='Duplex SS')       score += 5;
    }
    if (equipId==='reboiler' && T > 350) {
      if (mat.group==='Low Alloy Steel'||mat.id==='LAS_P11') score += 10;
      if (mat.group==='Carbon Steel' && T > 400) score -= 20;
    }
  }

  if (costPrio==='economy')     score = Math.max(10, score - mat.cost_idx * 3);
  if (costPrio==='performance') score += mat.cost_idx * 0.5;

  return Math.max(0, Math.min(130, score));
}

function buildExplanation(mat, fluidId, T, P, pH, Cl, H2S) {
  const f = FLUIDS.find(x => x.id === fluidId);
  const lines = [];
  lines.push(`${mat.name} (${mat.grade}) is recommended based on the following analysis:`);
  if (mat.suits && mat.suits.includes(fluidId)) lines.push(`• Proven industry suitability for ${f?f.name:fluidId} service.`);
  if (f) {
    if (f.corr==='low')    lines.push(`• Fluid has low inherent corrosivity — ${mat.group} is acceptable at these conditions.`);
    if (f.corr==='severe') lines.push(`• Fluid is highly corrosive — enhanced corrosion resistance of ${mat.name} is required.`);
  }
  if (T > 300) lines.push(`• Operating temperature ${T}°C requires creep/oxidation resistance — validated to ${mat.t_max}°C.`);
  else if (T < -20) lines.push(`• Low service temperature ${T}°C is within the ductile range (min ${mat.t_min}°C).`);
  else lines.push(`• Temperature ${T}°C is within validated range (${mat.t_min}°C – ${mat.t_max}°C).`);
  if (Cl > 200 && T > 60) {
    if (['DSS_2205','SDSS_2507'].includes(mat.id))
      lines.push(`• Chloride SCC risk: Cl⁻ ${Cl} ppm at ${T}°C — Duplex microstructure provides resistance where austenitic grades fail.`);
    if (mat.id==='Ti_Gr2')
      lines.push(`• Titanium is immune to chloride SCC — ideal for ${Cl} ppm Cl⁻ at ${T}°C.`);
  }
  if (H2S > 0.0003) lines.push(`• H₂S PP = ${H2S} bar — NACE MR0175/ISO 15156 sour service compliance required. Hardness limits apply.`);
  if (pH < 4) lines.push(`• pH ${pH} indicates strong acid conditions. This material's corrosion rate is acceptable in this range.`);
  if (pH > 10) lines.push(`• pH ${pH} alkaline conditions — material selected for caustic SCC resistance.`);
  lines.push(`Key advantages: ${mat.pros.slice(0,3).join('; ')}.`);
  if (mat.cons && mat.cons.length) lines.push(`Limitation to note: ${mat.cons[0]}.`);
  return lines.join('\n');
}

function buildConstraintRows(mat, fluidId, T, P, pH, Cl, H2S, V, fluidObj) {
  const rows = [];
  const tStatus = T <= mat.t_max*0.9 ? 'PASS' : T <= mat.t_max ? 'CAUTION' : 'FAIL';
  rows.push({label:'Temperature', input:`${T}°C`, limit:`${mat.t_max}°C max`, status:tStatus, note:T>mat.t_max*0.9?'within 10% of limit':''});
  if (T < 20) rows.push({label:'Min Temperature', input:`${T}°C`, limit:`${mat.t_min}°C min`, status:T>=mat.t_min?'PASS':'FAIL', note:''});
  const pStatus = P<=mat.p_max*0.8?'PASS':P<=mat.p_max?'CAUTION':'FAIL';
  rows.push({label:'Pressure (indicative)', input:`${P} bar g`, limit:`${mat.p_max} bar indicative`, status:pStatus, note:'verify by code calc'});
  const avoidStatus = (mat.avoids||[]).includes(fluidId)?'FAIL':(mat.suits||[]).includes(fluidId)?'PASS':'CAUTION';
  rows.push({label:'Fluid Compatibility', input:fluidObj?.name||fluidId, limit:'', status:avoidStatus,
    note:avoidStatus==='FAIL'?'explicitly avoided':avoidStatus==='PASS'?'explicitly suitable':'no explicit data — verify'});
  if (Cl > 0) {
    let clStatus='PASS', clNote='';
    if (['SS_304','SS_316L','SS_317L','SS_321'].includes(mat.id)) {
      if (Cl>5000&&T>60){clStatus='FAIL';clNote='hard limit exceeded';}
      else if (Cl>200&&T>60){clStatus='CAUTION';clNote='SCC risk — monitor';}
    } else if (['DSS_2205','SDSS_2507'].includes(mat.id)) {
      clStatus=Cl>50000?'CAUTION':'PASS'; clNote=Cl>50000?'verify PREN adequacy':'excellent Cl resistance';
    } else if (mat.id==='Ti_Gr2'){clStatus='PASS';clNote='immune to Cl SCC';}
    rows.push({label:'Chloride SCC', input:`Cl⁻ ${Cl} ppm @ ${T}°C`, limit:'200 ppm + 60°C threshold', status:clStatus, note:clNote});
  }
  if (H2S > 0) {
    const h2sStatus = H2S>0.0003&&(mat.group==='Carbon Steel'||mat.group==='Mild Steel')&&pH<5?'FAIL':H2S>0.0003?'CAUTION':'PASS';
    rows.push({label:'H₂S Sour Service', input:`${H2S} bar H₂S PP`, limit:'0.0003 bar NACE limit', status:h2sStatus, note:H2S>0.0003?'NACE MR0175 applies':'below NACE threshold'});
  }
  if (mat.group==='Duplex SS') {
    const sigmaStatus=T>280?'FAIL':T>260?'CAUTION':'PASS';
    rows.push({label:'Sigma Phase', input:`${T}°C`, limit:'280°C max (sustained)', status:sigmaStatus, note:T>260?'embrittlement risk':''});
  }
  if ((mat.group==='Carbon Steel'||mat.group==='Low Alloy Steel') && ['h2s_gas','crude','nat_gas','benzene','diesel','lng'].includes(fluidId)) {
    const hthaStatus=T>300?'FAIL':T>230?'CAUTION':'PASS';
    rows.push({label:'HTHA (API 941)', input:`${T}°C`, limit:'230°C CS limit (indicative)', status:hthaStatus, note:T>230?'verify Nelson curve':''});
  }
  if (V > 0) {
    let vLimit=50,vStatus='PASS',vNote='';
    if (mat.group==='Copper Alloy') vLimit=3;
    else if (['Polymer','FRP/GRP'].includes(mat.group)) vLimit=3;
    else if (mat.group==='Carbon Steel') vLimit=10;
    if (V>vLimit*1.5){vStatus='FAIL';vNote='erosion damage likely';}
    else if (V>vLimit){vStatus='CAUTION';vNote='approaching erosion limit';}
    if (vLimit<50) rows.push({label:'Velocity / Erosion', input:`${V} m/s`, limit:`~${vLimit} m/s guideline`, status:vStatus, note:vNote});
  }
  if (mat.id==='SS_304'&&T>425)
    rows.push({label:'HAZ Sensitization', input:`${T}°C welded service`, limit:'425°C limit for 304', status:'CAUTION', note:'use 316L/321 for welded high-T'});
  return rows;
}

function mocValidateInputs(T, P, pH, Cl, H2S, V, life) {
  const errs=[],warns=[];
  if (isNaN(T))              errs.push('Temperature is required.');
  else if (T<-270)           errs.push('Temperature below −270°C is physically impossible.');
  else if (T>1200)           errs.push('Temperature above 1200°C is outside all standard material limits.');
  else if (T>700)            warns.push(`Temperature ${T}°C — only refractory alloys operate here. Verify.`);
  if (isNaN(P))              errs.push('Pressure is required.');
  else if (P<0)              errs.push('Pressure cannot be negative.');
  else if (P>3000)           warns.push(`Pressure ${P} bar g is extremely high. Verify.`);
  if (isNaN(pH))             errs.push('pH is required (0–14).');
  else if (pH<0||pH>14)      errs.push('pH must be between 0 and 14.');
  if (isNaN(Cl)||Cl<0)       errs.push('Cl⁻ must be 0 or a positive value in ppm.');
  else if (Cl>200000)        warns.push('Cl⁻ > 200,000 ppm — verify units.');
  if (isNaN(H2S)||H2S<0)     errs.push('H₂S partial pressure must be 0 or positive.');
  else if (H2S>20)           warns.push('H₂S PP > 20 bar is extreme sour service. Verify.');
  if (isNaN(V)||V<0)         errs.push('Velocity must be 0 or positive.');
  else if (V>50)             warns.push(`Velocity ${V} m/s is very high.`);
  if (isNaN(life)||life<1)   errs.push('Design life must be at least 1 year.');
  else if (life>100)         warns.push('Design life > 100 years — unusual. Verify.');
  if (pH<2&&H2S>0.0003)      warns.push('pH < 2 with H₂S — extremely aggressive sour service.');
  if (Cl>5000&&T>150)        warns.push('High Cl⁻ at elevated temperature — Cl SCC near-certain for austenitic SS.');
  if (T>400&&P>200)          warns.push('High T + High P — ensure ASME code-compliant wall thickness calculation.');
  if (V>15&&pH<5)            warns.push('High velocity + acidic fluid — severe erosion-corrosion synergy expected.');
  return {errs,warns};
}

function runAnalysis({fluidId,equipId,T,P,pH,Cl,H2S,V,life,costPrio,industry,notes}) {
  const validation = mocValidateInputs(T,P,pH,Cl,H2S,V,life);
  if (validation.errs.length>0) return {ok:false, errors:validation.errs};

  const fluid = FLUIDS.find(f=>f.id===fluidId);
  const equip = EQUIPMENT.find(e=>e.id===equipId);
  if (!fluid) return {ok:false, errors:['Unknown fluid ID.']};
  if (!equip) return {ok:false, errors:['Unknown equipment ID.']};

  const allScored = Object.values(MATERIALS).map(mat=>({mat, score:scoreFluidMaterial(fluidId,mat,T,P,pH,Cl,H2S,V,costPrio,equipId,industry)}));
  const eliminated = allScored.filter(x=>x.score<=0).map(x=>x.mat.name);
  const scored     = allScored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
  if (scored.length===0) return {ok:false, errors:['No standard material found for these conditions.']};

  const best=scored[0], alts=scored.slice(1,5);
  const warnings=[];

  if (Cl>200&&T>60&&['SS_304','SS_316L'].includes(best.mat.id))
    warnings.push({type:'scc_cl',label:'Chloride SCC Risk',body:`Cl⁻ ${Cl} ppm at ${T}°C exceeds safe limit for austenitic SS. Upgrade to Duplex 2205 or Titanium Gr.2.`});
  if (T>260&&T<=280&&best.mat.group==='Duplex SS')
    warnings.push({type:'sigma',label:'Sigma Phase Warning',body:'Duplex SS approaching sigma phase embrittlement range (260–280°C). Restrict to short-duration excursions only.'});
  if (T>425&&best.mat.id==='SS_304')
    warnings.push({type:'sensitization',label:'Sensitization / IGC Risk',body:'SS 304 in welded service above 425°C susceptible to IGC. Upgrade to SS 316L, SS 321, or SS 347.'});
  if (H2S>0.0003) {
    const sscRisk=pH<6?'HIGH — SSC primary threat':'MODERATE — HIC primary concern';
    warnings.push({type:'nace',label:'NACE MR0175 / ISO 15156 Sour Service',body:`H₂S PP = ${H2S} bar. SSC risk: ${sscRisk}. Hardness max HV 248 (HRC 22). PWHT mandatory for CS welds. Specify HIC-resistant plate (NACE TM0284).`});
  }
  if (H2S>0.0003&&pH<5&&(best.mat.group==='Carbon Steel'||best.mat.group==='Mild Steel'))
    warnings.push({type:'hic',label:'Hydrogen Blistering / HIC — DOMINANT RISK',body:`Wet H₂S at pH ${pH} — severe hydrogen absorption. Requires HIC-resistant plate (NACE TM0284 Grade A), hardness control (HV ≤ 248). Consider SS 316L, Duplex 2205, or Alloy 625.`});
  if (T>230&&(best.mat.group==='Carbon Steel'||best.mat.group==='Mild Steel'))
    warnings.push({type:'htha',label:'HTHA Risk (API 941)',body:'CS/MS above 230°C in hydrocarbon/H₂ service. Verify position on API 941 Nelson curves.'});
  if (pH<4)
    warnings.push({type:'acid',label:'Strong Acid Service',body:`pH ${pH} — corrosion rate increases exponentially. Min corrosion allowance 3–6 mm recommended.`});
  if (T<0&&best.mat.group==='Carbon Steel')
    warnings.push({type:'lowtemp',label:'Low Temperature Impact Toughness',body:'Below 0°C — Charpy CVN testing required per ASME UCS-66. Consider LTCS A333 Gr.6 or austenitic SS.'});
  if ((best.mat.group==='Carbon Steel'||best.mat.group==='Mild Steel')&&(fluidId==='water_sw'||Cl>1000))
    warnings.push({type:'galvanic',label:'Galvanic Corrosion Risk',body:'CS in contact with stainless or copper alloys in saline service — CS acts as anode. Ensure electrical isolation at dissimilar-metal joints.'});
  if (best.mat.id==='Ti_Gr2'&&(fluidId==='water_sw'||Cl>1000))
    warnings.push({type:'galvanic',label:'Galvanic Corrosion Risk',body:'Titanium coupled to carbon steel in saline service creates a severe galvanic pair — CS corrodes rapidly. Electrically isolate all flanges.'});
  if (V>5&&best.mat.group==='Copper Alloy')
    warnings.push({type:'erosion',label:'Erosion-Corrosion Risk',body:`Cu-Ni velocity limit ~3 m/s. At ${V} m/s impingement attack likely. Consider Titanium or Duplex SS.`});
  if (notes&&notes.trim().length>0) {
    const nl=notes.toLowerCase(), noteWarnings=[];
    if (/oxygen|o2|aerat/.test(nl))           noteWarnings.push('Oxygen present — dissolved O₂ significantly accelerates corrosion in CS/MS.');
    if (/solid|slurry|sand|particl|abrasiv/.test(nl)) noteWarnings.push('Solids/abrasives noted — erosion-corrosion rate will exceed model predictions.');
    if (/chloride|cl-/.test(nl)&&Cl===0)      noteWarnings.push('Chloride contamination noted but Cl⁻ input is 0 — re-enter a representative value.');
    if (/h2s|sour|sulphide|sulfide/.test(nl)&&H2S===0) noteWarnings.push('H₂S noted but H₂S PP input is 0 — enter a representative H₂S partial pressure.');
    if (noteWarnings.length) warnings.push({type:'notes',label:'Advisory from Notes Field',body:noteWarnings.join(' | ')});
  }

  const corrSuff      = getCorrSufficiency(best.mat, fluid.corr||'moderate', life);
  const constraintRows= buildConstraintRows(best.mat, fluidId, T, P, pH, Cl, H2S, V, fluid);
  const explanation   = buildExplanation(best.mat, fluidId, T, P, pH, Cl, H2S);
  const displayScore  = Math.min(Math.round(best.score), 100);

  let dominantFailureMode=null;
  if (Cl>200&&T>60&&['SS_304','SS_316L'].includes(best.mat.id)) dominantFailureMode='Chloride SCC';
  if (H2S>0.0003&&pH<5&&(best.mat.group==='Carbon Steel'||best.mat.group==='Mild Steel')) dominantFailureMode='Hydrogen Blistering / HIC';
  if (T>230&&(best.mat.group==='Carbon Steel'||best.mat.group==='Mild Steel')) dominantFailureMode=dominantFailureMode||'HTHA';

  return {
    ok:true, warnings, inputWarnings:validation.warns,
    best:{id:best.mat.id,name:best.mat.name,grade:best.mat.grade,std:best.mat.std,group:best.mat.group,color:best.mat.color,desc:best.mat.desc,tags:best.mat.tags,pros:best.mat.pros,cons:best.mat.cons,cost_idx:best.mat.cost_idx,t_min:best.mat.t_min,t_max:best.mat.t_max,p_max:best.mat.p_max,composition:best.mat.composition,score:displayScore},
    alts:alts.map(a=>({id:a.mat.id,name:a.mat.name,grade:a.mat.grade,std:a.mat.std,group:a.mat.group,desc:a.mat.desc,tags:a.mat.tags,pros:a.mat.pros,cons:a.mat.cons,cost_idx:a.mat.cost_idx,t_max:a.mat.t_max,score:Math.min(Math.round(a.score),100)})),
    eliminated, constraintRows, explanation, corrSuff, dominantFailureMode,
    summary:{equip:equip.name,fluid:fluid.name,T,P,pH,Cl,H2S,V,life,industry},
    totalEvaluated:scored.length,
  };
}

// MOC rate limiter (scoped to /api/moc)
const _mocRateMap = new Map();
function mocRateLimit(ip) {
  const now = Date.now(), entry = _mocRateMap.get(ip) || { count: 0, window: now };
  if (now - entry.window > 60000) { entry.count = 0; entry.window = now; }
  entry.count++;
  _mocRateMap.set(ip, entry);
  return entry.count > 30;
}

function mocParseBody(body) {
  const n = (v, def, min, max) => { const f = parseFloat(v); return isNaN(f) ? def : Math.min(max, Math.max(min, f)); };
  return {
    fluidId:  String(body.fluidId  || '').slice(0, 40),
    equipId:  String(body.equipId  || '').slice(0, 40),
    T:        n(body.T,    100, -270, 1200),
    P:        n(body.P,     10,    0, 5000),
    pH:       n(body.pH,     7,    0,   14),
    Cl:       n(body.Cl,     0,    0, 300000),
    H2S:      n(body.H2S,    0,    0,   50),
    V:        n(body.V,      2,    0,  100),
    life:     n(body.life,  25,    1,  100),
    costPrio: ['balanced', 'economy', 'performance'].includes(body.costPrio) ? body.costPrio : 'balanced',
    industry: String(body.industry || 'Oil & Gas').slice(0, 40),
    notes:    String(body.notes    || '').slice(0, 500),
  };
}

// ========================================================================
// SECTION: MOC
// ========================================================================

async function handle_moc(req, body, res) {
  // GET → catalog
  if (req.method === 'GET') {
    const fluidsDisplay = FLUIDS.map(f => ({
      id: f.id, name: f.name, sub: f.sub, color: f.color, ind: f.ind,
      autofill: FLUID_AUTOFILL[f.id] || null,
    }));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ equipment: EQUIPMENT, industries: INDUSTRIES, fluids: fluidsDisplay });
  }
  // POST → analyze
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (mocRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Please wait.' });
  const result = runAnalysis(mocParseBody(body));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(result.ok ? 200 : 422).json(result);
}



// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — dispatches to handle_moc
// Supports both GET (catalog) and POST (analyze)
// ════════════════════════════════════════════════════════════════════════════
async function moc_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? req.body : {};
  if (req.method === 'POST' && (!body || typeof body !== 'object'))
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_moc(req, body, res);
  } catch (e) {
    console.error('[moc.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 21: Material of Construction (MOC) ──────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// SECTION B  ►  NPSH CALCULATOR
// Route: /api/npsh-calculator
// (Original: SECTION 16 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 16 of 21  ►  NPSH CALCULATOR
// Route: /api/npsh-calculator
// Source: npsh-calculator.js
// ══════════════════════════════════════════════════════════════════════════════

// NPSH CALCULATOR — api/npsh-calculator.js
// ================================================================

// ── NPSH sanitisation helpers (shared) ──
function sNum(v, def = null) { const n = parseFloat(v); return isFinite(n) ? n : def; }
function sInt(v, def = 0)    { const n = parseInt(v);   return isFinite(n) ? n : def; }
function sStr(v, allowed, def) { return allowed.includes(v) ? v : def; }

/* ===================================================================
   NPSH CALCULATOR API — multicalci.com
   Vercel serverless function: api/npsh-calculator.js

   Algorithm: Hydraulic Institute 9.6.1 / AFT Fathom grade
   All internal units: Pa, m, m³/s, kg/m³

   ACTIONS (POST):
     fluidList      → returns all 31 fluids [{index, id, name}]
     fluidProps     → {fluidIndex, T_C} → {rho, mu_mPas, pv_kPa, pv_bar, hvp}
     estimateNpshr  → {fluidIndex, T_C, N_rpm, Q_raw, H_total, stages, pumpType, unitMode}
                   → {npshr_m, npshr_bar, sigma, Ns, Nss, method}
     calculate      → full NPSHa calc payload → all results
=================================================================== */

/* ═══════════════════════════════════════════════════════════════
   FLUID DATABASE — 31 fluids (SECURED — not exposed to browser)
   Each: {id, name, rho20, mu20, vp:[[T_C, kPa],...], muF(T)->mPa·s}
═══════════════════════════════════════════════════════════════ */
const NPSH_FLUIDS = [
  {id:'water',name:'Water (H₂O)',rho20:998.2,mu20:1.002,
   vp:[[0,.611],[5,.872],[10,1.228],[15,1.706],[20,2.338],[25,3.169],[30,4.243],[40,7.384],[50,12.35],[60,19.94],[70,31.18],[80,47.39],[90,70.11],[100,101.3],[110,143.3],[120,198.5],[150,476.2],[200,1554]],
   muF:t=>2.414e-5*Math.pow(10,247.8/(t+133.15))*1000, rhoF:t=>999.842*(1-3.85e-5*(t-4)*(t-4)/(t+288))},
  {id:'seawater',name:'Seawater (3.5% NaCl)',rho20:1025,mu20:1.07,vp:[[0,.54],[10,1.08],[20,2.10],[30,3.81],[50,10.9],[80,44.3],[100,97.0]],muF:t=>Math.max(.5,1.07*Math.exp(-.018*(t-20)))},
  {id:'ethanol',name:'Ethanol (C₂H₅OH)',rho20:789,mu20:1.17,vp:[[0,1.63],[10,3.12],[20,5.95],[30,10.5],[40,17.7],[50,29.4],[60,47.1],[78.3,101.3]],muF:t=>Math.max(.05,1.17*Math.exp(-.02*(t-20)))},
  {id:'methanol',name:'Methanol (CH₃OH)',rho20:791,mu20:.59,vp:[[0,4.06],[10,6.97],[20,12.9],[30,21.9],[40,35.4],[64.7,101.3]],muF:t=>Math.max(.02,.59*Math.exp(-.022*(t-20)))},
  {id:'acetone',name:'Acetone',rho20:791,mu20:.32,vp:[[0,9.9],[20,24.5],[40,53.7],[56,101.3]],muF:t=>Math.max(.01,.32*Math.exp(-.025*(t-20)))},
  {id:'toluene',name:'Toluene',rho20:867,mu20:.59,vp:[[0,1.57],[20,3.79],[40,9.87],[60,23.4],[110.6,101.3]],muF:t=>Math.max(.01,.59*Math.exp(-.018*(t-20)))},
  {id:'benzene',name:'Benzene (C₆H₆)',rho20:879,mu20:.65,vp:[[0,3.52],[20,10.0],[40,24.4],[60,52.0],[80.1,101.3]],muF:t=>Math.max(.01,.65*Math.exp(-.019*(t-20)))},
  {id:'diesel',name:'Diesel Fuel',rho20:835,mu20:3.5,vp:[[20,.01],[40,.03],[60,.07],[80,.15],[100,.3]],muF:t=>Math.max(.5,3.5*Math.exp(-.028*(t-20)))},
  {id:'petrol',name:'Petrol / Gasoline',rho20:720,mu20:.45,vp:[[0,10],[10,16],[20,25],[30,38.5],[40,57],[50,82],[60,115]],muF:t=>Math.max(.05,.45*Math.exp(-.02*(t-20)))},
  {id:'hfo',name:'Heavy Fuel Oil (HFO 380)',rho20:991,mu20:700,vp:[[50,.001],[80,.005],[100,.01],[150,.1]],muF:t=>Math.max(10,700*Math.exp(-.055*(t-20)))},
  {id:'lube',name:'Lube Oil (ISO VG 46)',rho20:870,mu20:46,vp:[[50,.001],[80,.003],[100,.006]],muF:t=>Math.max(1,46*Math.exp(-.05*(t-20)))},
  {id:'glycol33',name:'Ethylene Glycol-Water 33%',rho20:1060,mu20:2.8,vp:[[0,.45],[20,1.65],[50,9.5],[80,38],[100,85]],muF:t=>Math.max(.3,2.8*Math.exp(-.028*(t-20)))},
  {id:'glycol50',name:'Ethylene Glycol-Water 50%',rho20:1070,mu20:5.0,vp:[[0,.3],[20,1.2],[50,8.0],[80,34],[100,78]],muF:t=>Math.max(.3,5.0*Math.exp(-.035*(t-20)))},
  {id:'milk',name:'Milk (whole)',rho20:1030,mu20:2.0,vp:[[5,.872],[20,2.33],[40,7.38],[80,47.4],[100,101.3]],muF:t=>Math.max(.3,2.0*Math.exp(-.025*(t-20)))},
  {id:'honey',name:'Honey',rho20:1420,mu20:6000,vp:[[20,.5],[40,2.0],[60,7.0]],muF:t=>Math.max(50,6000*Math.exp(-.09*(t-20)))},
  {id:'hcl30',name:'Hydrochloric Acid 30%',rho20:1149,mu20:2.1,vp:[[10,25],[20,42],[30,65],[50,120]],muF:t=>Math.max(.5,2.1*Math.exp(-.022*(t-20)))},
  {id:'h2so4',name:'Sulphuric Acid 98%',rho20:1840,mu20:24.5,vp:[[20,3e-5],[100,.01],[200,.5]],muF:t=>Math.max(2,24.5*Math.exp(-.04*(t-20)))},
  {id:'naoh20',name:'Sodium Hydroxide 20%',rho20:1220,mu20:4.0,vp:[[10,1.0],[20,1.8],[50,9.0],[80,38],[100,87]],muF:t=>Math.max(.5,4.0*Math.exp(-.03*(t-20)))},
  {id:'ipa',name:'Isopropyl Alcohol (IPA)',rho20:785,mu20:2.37,vp:[[0,1.33],[20,4.38],[40,13.2],[82.3,101.3]],muF:t=>Math.max(.1,2.37*Math.exp(-.033*(t-20)))},
  {id:'glycerol',name:'Glycerol (Glycerine)',rho20:1261,mu20:1480,vp:[[20,2e-4],[60,.004],[100,.05]],muF:t=>Math.max(5,1480*Math.exp(-.11*(t-20)))},
  {id:'ammonia',name:'Ammonia (liquid)',rho20:610,mu20:.14,vp:[[-33,101.3],[-20,190],[0,430],[20,857],[50,2033]],muF:t=>Math.max(.05,.14*Math.exp(-.025*(t+33)))},
  {id:'styrene',name:'Styrene',rho20:906,mu20:.72,vp:[[0,.3],[20,.81],[60,5.05],[100,23.1],[145,101.3]],muF:t=>Math.max(.05,.72*Math.exp(-.022*(t-20)))},
  {id:'xylene',name:'Xylene (mixed)',rho20:864,mu20:.62,vp:[[0,.48],[20,1.05],[60,6.48],[100,27.8],[140,101.3]],muF:t=>Math.max(.05,.62*Math.exp(-.018*(t-20)))},
  {id:'brine',name:'Brine (NaCl 25%)',rho20:1193,mu20:2.4,vp:[[0,.45],[20,1.6],[50,9.0],[80,37],[100,84]],muF:t=>Math.max(.5,2.4*Math.exp(-.025*(t-20)))},
  {id:'palm',name:'Palm Oil',rho20:912,mu20:60,vp:[[40,.001],[80,.01],[100,.03]],muF:t=>Math.max(2,60*Math.exp(-.055*(t-20)))},
  {id:'crude',name:'Crude Oil (light, API 35)',rho20:847,mu20:12,vp:[[20,.05],[40,.16],[80,1.0]],muF:t=>Math.max(.5,12*Math.exp(-.04*(t-20)))},
  {id:'kerosene',name:'Kerosene / Jet A',rho20:800,mu20:1.5,vp:[[20,.15],[50,.6],[100,4.0]],muF:t=>Math.max(.1,1.5*Math.exp(-.028*(t-20)))},
  {id:'mercury',name:'Mercury (Hg)',rho20:13600,mu20:1.55,vp:[[20,2.27e-4],[100,.016],[200,.279],[356.7,101.3]],muF:t=>Math.max(.8,1.55*Math.exp(-.003*(t-20)))},
  {id:'freon22',name:'Refrigerant R-22 (liquid)',rho20:1194,mu20:.21,vp:[[-40,101.3],[0,499],[20,909],[40,1535]],muF:t=>Math.max(.05,.21*Math.exp(-.018*(t-20)))},
  {id:'co2',name:'CO₂ (liquid, pressurised)',rho20:773,mu20:.07,vp:[[-40,1006],[-20,1969],[0,3484],[20,5729],[30,7176]],muF:t=>Math.max(.02,.07*Math.exp(-.02*(t+40)))},
  {id:'coconut',name:'Coconut Oil',rho20:924,mu20:28,vp:[[30,.001],[80,.01],[100,.02]],muF:t=>Math.max(1,28*Math.exp(-.05*(t-20)))}
];

/* ═══════════════════════════════════════════════════════════════
   CORE PHYSICS — ALL SECURED ON SERVER
═══════════════════════════════════════════════════════════════ */

/** Log-linear vapour pressure interpolation — accurate above 80°C */
function npshVpI(f, T) {
  const d = f.vp;
  if (!d || !d.length) return 101.325;
  if (T <= d[0][0]) return d[0][1];
  if (T >= d[d.length-1][0]) return d[d.length-1][1];
  for (let i = 0; i < d.length-1; i++) {
    if (T >= d[i][0] && T < d[i+1][0]) {
      const r = (T - d[i][0]) / (d[i+1][0] - d[i][0]);
      const lv1 = Math.log(Math.max(d[i][1], 1e-10));
      const lv2 = Math.log(Math.max(d[i+1][1], 1e-10));
      return Math.exp(lv1 + r * (lv2 - lv1));
    }
  }
  return d[d.length-1][1];
}

function rhoAt(f, T) { return f.rhoF ? f.rhoF(T) : f.rho20 * (1 - 6.5e-4 * (T - 20)); }
function muAt(f, T)  { return f.muF  ? f.muF(T) / 1000 : f.mu20 / 1000 * (1 - 0.02 * (T - 20)); }

/**
 * Colebrook-White friction factor (industry standard)
 * Laminar: Hagen-Poiseuille  f = 64/Re
 * Transitional: blended continuously
 * Turbulent: iterative Colebrook-White (8–12 iterations)
 */
function frictionFactor(Re, eps_mm, D_m) {
  if (Re < 1)    return 64;
  if (Re < 2300) return 64 / Re;
  if (Re < 4000) {
    const f_lam  = 64 / 2300;
    const r      = eps_mm / (D_m * 1000);
    const f_turb = 0.25 / Math.pow(Math.log10(r / 3.7 + 5.74 / Math.pow(4000, 0.9)), 2);
    const blend  = (Re - 2300) / (4000 - 2300);
    return f_lam + (f_turb - f_lam) * blend;
  }
  // Turbulent — Colebrook-White iterative
  const r = eps_mm / (D_m * 1000);
  let f = 0.02;
  for (let i = 0; i < 12; i++) {
    const rhs = 1 / (-2 * Math.log10(r / 3.7 + 2.51 / (Re * Math.sqrt(f))));
    f = rhs * rhs;
  }
  return Math.max(0.008, Math.min(0.1, f));
}

/**
 * NPSHr estimation — Thoma cavitation number σ method
 * Per Hydraulic Institute 9.6.1 + HI suction specific speed check
 * Returns the MORE CONSERVATIVE of two methods:
 *   1. Thoma σ model:  NPSHr = σ × H_stage
 *   2. Nss limit method: NPSHr from Nss_max = 210 (SI)
 */
function calcEstimateNpshr(inputs) {
  const { N, Q_m3s, H_total, stages, pumpType } = inputs;
  const H_stage = H_total / Math.max(1, stages);

  // Dimensionless specific speed (SI: rpm, m³/s, m)
  const Ns = N * Math.sqrt(Q_m3s) / Math.pow(Math.max(H_stage, 1), 0.75);

  // Thoma sigma from specific speed — HI empirical correlation
  const CsMap = {
    centrifugal_low:  0.30,
    centrifugal_med:  0.45,
    centrifugal_high: 0.65,
    mixed:            0.85,
    axial:            1.20,
    multistage:       0.40,
  };
  const Cs    = CsMap[pumpType] || 0.40;
  const sigma = Cs * Math.pow(Ns / 1000, 4/3);
  const npshr_sigma = Math.max(0.3, sigma * H_stage);

  // Suction specific speed limit method (Nss_max = 210 SI)
  const Nss_limit    = 210;
  const npshr_nss    = Math.pow(N * Math.sqrt(Q_m3s) / Nss_limit, 4/3);
  const npshr_nss_safe = Math.max(0.3, npshr_nss);

  // Conservative: take higher of the two
  const npshr_m   = Math.max(npshr_sigma, npshr_nss_safe);
  const Nss_actual = N * Math.sqrt(Q_m3s) / Math.pow(Math.max(npshr_m, 0.1), 0.75);
  const npshr_bar  = npshr_m * 9810 / 1e5;

  return { npshr_m, npshr_bar, sigma, Ns, Nss: Nss_actual, H_stage };
}

/**
 * Main NPSHa calculation engine
 * Algorithm: Aspen HYSYS / AFT Fathom grade — HI 9.6.1
 *
 * NPSHa = P_abs/(ρg) + z − h_f − Pv/(ρg)
 *
 * CRITICAL: All pressure-to-head conversions use ACTUAL fluid density.
 * This is the #1 source of error in inferior calculators.
 */
function calcNPSH(inputs) {
  const {
    fluidIndex, T_C, unitMode,
    D_mm, Q_raw, L_m, Lf_m, eps_mm,
    upType, baro_bar, vessel_pg_raw,
    z_raw_user, npshrMethod, npshr_direct_user,
    N_rpm, H_total_user, stages, pumpType,
    margin_req,
  } = inputs;

  const isImp   = unitMode === 'IMP';
  const isAbove = upType.endsWith('above');
  const isVessel = upType.startsWith('vessel');

  // ── Fluid ──
  const f   = NPSH_FLUIDS[fluidIndex] || NPSH_FLUIDS[0];
  const T   = T_C; // always SI internally
  const rho = rhoAt(f, T);
  const mu  = muAt(f, T);           // Pa·s
  const pv_kPa = npshVpI(f, T);         // kPa
  const pv_Pa  = pv_kPa * 1000;     // Pa
  const pv_bar = pv_kPa / 100;
  const g   = 9.81;
  const rg  = rho * g;              // Pa/m — ACTUAL fluid

  // ── Pipe ──
  const D = D_mm / 1000;            // m
  const A = Math.PI * D * D / 4;   // m²

  // ── Flow → m³/s ──
  const Q = isImp ? Q_raw / 264.172 / 60 : Q_raw / 3600;

  // ── Velocity ──
  const v  = (Q > 0 && A > 0) ? Q / A : 0;
  const vh = v * v / (2 * g);

  // ── Pipe length (always in metres from user — unit conversion done in HTML) ──
  const L  = L_m;
  const Lf = Lf_m;
  const Le = L + Lf;

  // ── Friction ──
  const Re = (mu > 0 && D > 0) ? rho * v * D / mu : 0;
  const ff = frictionFactor(Re, eps_mm, D);
  const hf = (Le > 0 && D > 0) ? ff * (Le / D) * vh : 0;

  // ── Upstream pressure → Pa ──
  let P_abs_Pa = 0;
  if (isVessel) {
    const pg_Pa = isImp ? vessel_pg_raw * 6894.76 : vessel_pg_raw * 1e5;
    P_abs_Pa    = baro_bar * 1e5 + pg_Pa;
  } else {
    P_abs_Pa = baro_bar * 1e5;
  }

  // ── CRITICAL: H_abs uses ACTUAL fluid density ──
  const H_abs = P_abs_Pa / rg;

  // ── Static head (magnitude in metres, sign applied by config) ──
  const z_raw = z_raw_user; // already metres
  const z     = isAbove ? z_raw : -z_raw;

  // ── Vapour pressure head ──
  const h_vp = pv_Pa / rg;
  // ── VLE / Saturated liquid detection ──
  // For a pure single-component fluid in a pressurised vessel (refrigerant
  // receiver, liquid ammonia accumulator, condensate drum) the vessel pressure
  // equals the vapour pressure at the bulk liquid temperature. Any apparent
  // difference is instrument error, not real subcooling.
  // Threshold: if Pv/P_abs > 0.90 (within 3%) treat as saturated service.
  const saturationRatio = isVessel ? (pv_Pa / P_abs_Pa) : 0;
  const isSaturatedService = isVessel && saturationRatio >= 0.90;
  // In saturated service the pressure terms cancel → NPSHa = z − hf only
  const H_abs_effective = isSaturatedService ? h_vp : H_abs;

  // ── NPSHa (HI 9.6.1) ──
  const npsha = H_abs_effective + z - hf - h_vp;

  // ── NPSHa pressure equivalents ──
  const npsha_deltaP_Pa  = rg * npsha;
  const npsha_deltaP_bar = npsha_deltaP_Pa / 1e5;
  const npsha_Ps_bar     = (pv_Pa + npsha_deltaP_Pa) / 1e5;
  const npsha_ft         = npsha * 3.281;
  const npsha_psi        = npsha_deltaP_bar * 14.504;

  // ── NPSHr ──
  let npshr_m = 0;
  let npshrEstimate = null;
  if (npshrMethod === 'direct') {
    npshr_m = isImp ? npshr_direct_user / 3.281 : npshr_direct_user;
  } else {
    const Q_m3s = Q;
    const H_total = isImp ? H_total_user / 3.281 : H_total_user;
    npshrEstimate = calcEstimateNpshr({ N: N_rpm, Q_m3s, H_total, stages, pumpType });
    npshr_m = npshrEstimate.npshr_m;
  }

  // ── Safety margin ──
  const margin_actual   = npsha - (npshr_m + margin_req);
  const npsha_required  = npshr_m + margin_req;

  // ── Engineering warnings ──
  const warnings = [];
  if (v > 3.0)
    warnings.push({cls:'err', msg:'⛔ Pipe velocity '+v.toFixed(2)+' m/s exceeds 3 m/s. Risk of erosion, excessive losses and noise. Upsize suction pipe by at least one DN size.'});
  else if (v > 1.5)
    warnings.push({cls:'warn', msg:'⚠ Pipe velocity '+v.toFixed(2)+' m/s is above recommended 1.5 m/s for suction piping. Consider upsizing.'});
  if (Re > 2300 && Re < 4000)
    warnings.push({cls:'warn', msg:'⚠ Transition flow regime (Re = '+Re.toFixed(0)+'). Friction factor is uncertain (range 0.02–0.05). System may be unstable. Redesign to achieve Re > 4000 or < 2300.'});
  if (!isAbove && z_raw > 5.0)
    warnings.push({cls:'warn', msg:'⚠ Suction lift '+z_raw.toFixed(1)+' m exceeds practical limit of 5 m for most pump/fluid combinations at sea level. Maximum theoretical = P_atm/ρg.'});
  if (npsha < npshr_m && npsha > 0)
    warnings.push({cls:'err', msg:'⛔ NPSHa ('+npsha.toFixed(2)+' m) < NPSHr ('+npshr_m.toFixed(2)+' m). Cavitation will occur. Redesign suction system.'});
  if (margin_actual < 1.0 && margin_actual >= 0)
    warnings.push({cls:'warn', msg:'⚠ NPSHa margin '+margin_actual.toFixed(2)+' m is below recommended 1.0 m. Use ≥1.5 m for hot fluids or critical services (HI 9.6.1).'});
  if (npsha < 0)
    warnings.push({cls:'err', msg:'⛔ NPSHa is NEGATIVE ('+npsha.toFixed(2)+' m). Fluid will flash in suction pipe. Immediate redesign required — raise tank, lower pump, or reduce temperature.'});
  if (T > 80)
    warnings.push({cls:'warn', msg:'⚠ High temperature '+T.toFixed(0)+'°C: vapour pressure is rising steeply. Small temperature increases cause large NPSHa reductions. Check worst-case temperature.'});
  if (isSaturatedService)
    warnings.push({cls:'err', msg:'⛔ SATURATED LIQUID SERVICE DETECTED — Pv/P_vessel = '+(saturationRatio*100).toFixed(1)+'%. This vessel contains liquid in VLE equilibrium with its own vapour (refrigerant receiver, ammonia accumulator, condensate drum). The vessel pressure and vapour pressure are the SAME thermodynamic state — they cancel exactly. NPSHa = z − h_f = '+npsha.toFixed(2)+' m only. Standard NPSH formula does not apply. Do NOT use a standard centrifugal pump — specify canned motor, barrel type, or a pump with inducer rated for near-zero NPSH service.'});
  // ── Status classification ──
  let sc, st;
  if (npsha < 0) {
    sc='err'; st='⛔ Critical — NPSHa negative. Fluid flashing in suction pipe.';
  } else if (npsha < npshr_m) {
    sc='err'; st='⛔ Cavitation — NPSHa ('+npsha.toFixed(2)+' m) < NPSHr ('+npshr_m.toFixed(2)+' m). Pump will cavitate.';
  } else if (margin_actual < 0) {
    sc='warn'; st='⚠ Marginal — NPSHa > NPSHr but safety margin of '+margin_req.toFixed(1)+' m not satisfied (HI 9.6.1).';
  } else if (margin_actual < 1.0) {
    sc='warn'; st='⚠ Acceptable — Margin '+margin_actual.toFixed(2)+' m meets minimum. Use ≥1 m for critical service.';
  } else if (margin_actual >= 3) {
    sc='ok'; st='✔ Excellent — NPSHa = '+npsha.toFixed(2)+' m. Margin = '+margin_actual.toFixed(2)+' m. Very low cavitation risk.';
  } else {
    sc='ok'; st='✔ Adequate — NPSHa = '+npsha.toFixed(2)+' m. Margin = '+margin_actual.toFixed(2)+' m exceeds safety requirement.';
  }

  // ── Cavitation check ──
  const cavPmin_Pa  = pv_Pa + npshr_m * rg;
  const cavPmin_bar = cavPmin_Pa / 1e5;
  const cavPs_Pa    = pv_Pa + npsha * rg;
  const cavPs_bar   = cavPs_Pa / 1e5;
  const cavMargin_bar = cavPs_bar - cavPmin_bar;
  const cavS         = cavPs_bar > 0 ? pv_bar / cavPs_bar : 0;

  // ── Net ΔP calculation note ──
  const netDP_bar = (P_abs_Pa - pv_Pa) / 1e5;
  const netDP_m   = (P_abs_Pa - pv_Pa) / rg;

  // ── NPSHr pressure equivalents ──
  const npshr_bar_fluid = npshr_m * rg / 1e5;
  const npshr_bar_water = npshr_m * 9810 / 1e5;

  return {
    ok: true,
    // Fluid
    fluidName: f.name,
    fluidShort: f.name.replace(/\s*\(.*\)/, ''),
    T, rho, mu_mPas: mu * 1000,
    pv_Pa, pv_kPa, pv_bar,
    // Pipe / flow
    D_mm, D, A, Q, v, vh, Re, ff, hf, Le, eps_mm,
    // Heads
    H_abs, P_abs_Pa, z, z_raw,
    h_vp,
    // NPSHa
    npsha, npsha_deltaP_Pa, npsha_deltaP_bar,
    npsha_Ps_bar, npsha_ft, npsha_psi,
    // NPSHr
    npshr_m, npshr_bar_fluid, npshr_bar_water,
    npshrEstimate,
    // Margin
    margin_req, margin_actual, npsha_required,
    // Status
    sc, st,
    warnings,
    // Cavitation
    cavPmin_Pa, cavPmin_bar, cavPs_Pa, cavPs_bar,
    cavMargin_bar, cavS,
    // Helpers
    netDP_bar, netDP_m,
    isSaturatedService, saturationRatio,
    rg, g,
    tp: upType, isAbove, isVessel,
  };
}

// NOTE: handle_calculate() was removed from this file.
// It belongs to the Vessel & Separator section and is declared
// in process-calculators.js alongside all other vessel functions.

async function handle_npsh_calculator(body, res) {
  const action = (body.action || '').trim();

  /* ── fluidList ── */
  if (action === 'fluidList') {
    return res.status(200).json({
      ok: true,
      fluids: NPSH_FLUIDS.map((f, i) => ({ index: i, id: f.id, name: f.name })),
    });
  }

  /* ── fluidProps ── */
  if (action === 'fluidProps') {
    const idx = sInt(body.fluidIndex, 0);
    const T   = sNum(body.T_C, 20);
    if (idx < 0 || idx >= NPSH_FLUIDS.length) return res.status(400).json({ ok: false, error: 'Invalid fluidIndex' });
    const f       = NPSH_FLUIDS[idx];
    const rho     = rhoAt(f, T);
    const mu_mPas = muAt(f, T) * 1000;
    const pv_kPa  = npshVpI(f, T);
    const pv_bar  = pv_kPa / 100;
    const rg      = rho * 9.81;
    const hvp     = pv_kPa * 1000 / rg;
    return res.status(200).json({
      ok: true, name: f.name,
      rho:     parseFloat(rho.toFixed(3)),
      mu_mPas: parseFloat(mu_mPas.toFixed(4)),
      pv_kPa:  parseFloat(pv_kPa.toFixed(5)),
      pv_bar:  parseFloat(pv_bar.toFixed(6)),
      hvp:     parseFloat(hvp.toFixed(4)),
    });
  }

  /* ── estimateNpshr ── */
  if (action === 'estimateNpshr') {
    const idx      = sInt(body.fluidIndex, 0);
    const T_C      = sNum(body.T_C, 20);
    const unitMode = sStr(body.unitMode, ['SI','IMP'], 'SI');
    const isImp    = unitMode === 'IMP';
    const N_rpm    = sNum(body.N_rpm, 1450);
    const Q_raw    = sNum(body.Q_raw, 50);
    const H_user   = sNum(body.H_total, 30);
    const stages   = Math.max(1, sInt(body.stages, 1));
    const pumpType = sStr(body.pumpType, ['centrifugal_low','centrifugal_med','centrifugal_high','mixed','axial','multistage'], 'centrifugal_med');
    const Q_m3s    = isImp ? Q_raw / 264.172 / 60 : Q_raw / 3600;
    const H_total  = isImp ? H_user / 3.281 : H_user;
    const result   = calcEstimateNpshr({ N: N_rpm, Q_m3s, H_total, stages, pumpType });
    const f        = NPSH_FLUIDS[idx] || NPSH_FLUIDS[0];
    const rho      = rhoAt(f, T_C);
    const rg       = rho * 9.81;
    const npshr_bar_fluid = result.npshr_m * rg / 1e5;
    return res.status(200).json({ ok: true, ...result, npshr_bar_fluid });
  }

  /* ── calculate (main NPSHa) ── */
  if (action === 'calculate') {
    const VALID_UP    = ['open_above','open_below','vessel_above','vessel_below'];
    const VALID_NPSHR = ['direct','estimate'];
    const VALID_PUMP  = ['centrifugal_low','centrifugal_med','centrifugal_high','mixed','axial','multistage'];
    const VALID_UNIT  = ['SI','IMP'];
    const inputs = {
      fluidIndex:         Math.max(0, Math.min(NPSH_FLUIDS.length-1, sInt(body.fluidIndex, 0))),
      T_C:                Math.max(-50, Math.min(250, sNum(body.T_C, 20))),
      unitMode:           sStr(body.unitMode,   VALID_UNIT,  'SI'),
      D_mm:               Math.max(5, Math.min(2000, sNum(body.D_mm, 154.1))),
      Q_raw:              Math.max(0.001, sNum(body.Q_raw, 50)),
      L_m:                Math.max(0, sNum(body.L_m, 5)),
      Lf_m:               Math.max(0, sNum(body.Lf_m, 2.5)),
      eps_mm:             Math.max(0.0001, Math.min(10, sNum(body.eps_mm, 0.046))),
      upType:             sStr(body.upType, VALID_UP, 'open_above'),
      baro_bar:           Math.max(0.5, Math.min(1.1, sNum(body.baro_bar, 1.01325))),
      vessel_pg_raw:      sNum(body.vessel_pg_raw, 1.5),
      z_raw_user:         sNum(body.z_raw_user, 3.0),
      npshrMethod:        sStr(body.npshrMethod, VALID_NPSHR, 'direct'),
      npshr_direct_user:  Math.max(0, sNum(body.npshr_direct_user, 3.0)),
      N_rpm:              Math.max(100, Math.min(10000, sNum(body.N_rpm, 1450))),
      H_total_user:       Math.max(1, sNum(body.H_total_user, 30)),
      stages:             Math.max(1, Math.min(20, sInt(body.stages, 1))),
      pumpType:           sStr(body.pumpType, VALID_PUMP, 'centrifugal_med'),
      margin_req:         Math.max(0, Math.min(10, sNum(body.margin_req, 0.6))),
    };
    const result = calcNPSH(inputs);
    return res.status(200).json(result);
  }

  return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
}





// ================================================================

// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — dispatches to handle_npsh_calculator
// ════════════════════════════════════════════════════════════════════════════
async function npsh_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? req.body : {};
  if (req.method === 'POST' && (!body || typeof body !== 'object'))
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_npsh_calculator(body, res);
  } catch (e) {
    console.error('[npsh-calculator.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 16: NPSH Calculator ──────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION C  ►  COOLING TOWER PERFORMANCE
// Route: /api/cooling-tower
// (Original: SECTION 03 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 03 of 21  ►  COOLING TOWER
// Route: /api/cooling-tower
// Source: cooling-tower.js
// ══════════════════════════════════════════════════════════════════════════════

// ================================================================
// api/cooling-tower.js  —  Vercel Serverless Function
// 🔐 ALL CALCULATION LOGIC RUNS ON SERVER — NEVER EXPOSED TO BROWSER
// Place this file in your GitHub repo at: /api/cooling-tower.js
// ================================================================

function coolingTower_handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = origin.endsWith('.vercel.app') || origin === 'https://multicalci.com';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://multicalci.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, params } = req.body;
    if (!action) return res.status(400).json({ error: 'Missing action' });

    if (action === 'calculate') {
      const result = runCalculate(params);
      if (result.error) return res.status(400).json({ error: result.error });
      return res.status(200).json({ success: true, data: result });
    }

    if (action === 'predictCWT') {
      const result = runPredictCWT(params);
      if (result.error) return res.status(400).json({ error: result.error });
      return res.status(200).json({ success: true, data: result });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    return res.status(500).json({ error: 'Server calculation error: ' + err.message });
  }
}

// ================================================================
// 🔐 CORE CALCULATION ENGINE — HIDDEN ON SERVER
// ================================================================

// ── Psychrometric helpers ────────────────────────────────────────

function psat_kPa(T_C) {
  if (T_C <= 60) {
    return 0.61121 * Math.exp((18.678 - T_C / 234.5) * (T_C / (257.14 + T_C)));
  } else {
    const P_mmHg = Math.pow(10, 8.07131 - 1730.63 / (233.426 + T_C));
    return P_mmHg * 0.133322;
  }
}

function saturationEnthalpy(T_C, P_kPa) {
  const psat = psat_kPa(T_C);
  if (psat >= P_kPa) return null;
  const Ws = 0.62198 * psat / (P_kPa - psat);
  return 1.006 * T_C + Ws * (2501 + 1.805 * T_C);
}

function airEnthalpy(Twb_C, P_kPa) {
  return saturationEnthalpy(Twb_C, P_kPa);
}

function cpWater(T_C) {
  const t = T_C;
  return 4.2174 - 0.005618 * t + 1.313e-4 * t * t - 1.014e-6 * t * t * t;
}

function elevToPatm(elev_m) {
  return 101.325 * Math.pow(1 - 2.25577e-5 * elev_m, 5.25588);
}

function rhoWater(T_C) {
  return 999.842 - 0.0624 * T_C - 0.003712 * T_C * T_C;
}

function rhoAir(T_C, Patm_kPa, RH = 1.0) {
  const T_K = T_C + 273.15;
  const pv = RH * psat_kPa(T_C);
  const pd = Patm_kPa - pv;
  return (pd * 0.028964 + pv * 0.018016) / (8.314462e-3 * T_K);
}

// ── KaV/L — Adaptive Chebyshev Integration (CTI ATC-105) ────────

function kavl(cwt_C, hwt_C, wb_C, P_kPa) {
  const range = hwt_C - cwt_C;
  if (range <= 0) return null;
  const h_a = airEnthalpy(wb_C, P_kPa);
  if (h_a === null) return null;

  const fracs = range > 15
    ? [0.05, 0.15, 0.30, 0.45, 0.55, 0.70, 0.85, 0.95]
    : [0.1, 0.4, 0.6, 0.9];
  const n = fracs.length;

  let sum = 0;
  let anyPositive = false;
  for (const f of fracs) {
    const T_i = cwt_C + f * range;
    const h_si = saturationEnthalpy(T_i, P_kPa);
    if (h_si === null) continue;
    const dh = h_si - h_a;
    if (dh < 0.01) continue;
    const cp_i = cpWater(T_i);
    sum += cp_i / dh;
    anyPositive = true;
  }
  if (!anyPositive) return null;
  return (range / n) * sum;
}

// ── CTI κ (Kappa) Solver ─────────────────────────────────────────

function solveCWT(target_kavl, hwt_C, wb_C, P_kPa) {
  let lo = wb_C + 0.01, hi = hwt_C - 0.01;
  if (lo >= hi) return { cwt: null, converged: false };
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const k = kavl(mid, hwt_C, wb_C, P_kPa);
    if (k === null) { lo = mid; continue; }
    if (k > target_kavl) lo = mid; else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  const cwt = (lo + hi) / 2;
  const k_check = kavl(cwt, hwt_C, wb_C, P_kPa);
  const converged = k_check !== null && Math.abs(k_check - target_kavl) / target_kavl < 0.001;
  return { cwt, converged };
}

function computeKappa(cwt_d_C, hwt_d_C, wb_d_C, P_kPa) {
  const kavl_d = kavl(cwt_d_C, hwt_d_C, wb_d_C, P_kPa);
  if (!kavl_d || kavl_d <= 0) return null;

  const approach = cwt_d_C - wb_d_C;
  const delta = Math.max(0.1, Math.min(1.0, approach * 0.03));

  const r_plus = solveCWT(kavl_d, hwt_d_C, wb_d_C + delta, P_kPa);
  const r_minus = solveCWT(kavl_d, hwt_d_C, wb_d_C - delta, P_kPa);

  if (r_plus.cwt === null || r_minus.cwt === null) return null;
  if (!r_plus.converged || !r_minus.converged) return null;

  const kappa = (r_plus.cwt - r_minus.cwt) / (2 * delta);
  if (kappa <= 0 || kappa > 1.5) return null;
  return kappa;
}

function calcPredictedCWT(cwt_d, wb_d, wb_a, kappa) {
  return cwt_d + kappa * (wb_a - wb_d);
}

// ── Status Assessments ───────────────────────────────────────────

function approachSt(dAppVsPred_C, thW_C, thB_C) {
  if (dAppVsPred_C <= 0)       return { cls: 'ok',   lbl: 'ON PREDICTION', icon: '✅', t: 'Actual approach at or better than κ-predicted Merkel value. Tower performing to specification.' };
  if (dAppVsPred_C <= 0.5)     return { cls: 'ok',   lbl: 'ACCEPTABLE',    icon: '✅', t: 'Within ±0.5°C of Merkel prediction. Monitor trend — no immediate action.' };
  if (dAppVsPred_C <= thW_C)   return { cls: 'ok',   lbl: 'ACCEPTABLE',    icon: '✅', t: 'Within warning band of Merkel prediction. Increase monitoring frequency. Check water chemistry and distribution headers.' };
  if (dAppVsPred_C <= thB_C)   return { cls: 'warn', lbl: 'DEGRADED',      icon: '⚠️', t: 'Actual approach exceeds κ-predicted value beyond warning threshold. Inspect: fill media, nozzles, louvres, drift eliminators, and fan. Schedule maintenance.' };
  return                              { cls: 'bad',  lbl: 'CRITICAL',      icon: '🔴', t: 'Actual approach far exceeds Merkel prediction — critical degradation. Likely causes: fill fouling/scaling, blocked nozzles, draft failure. Immediate inspection required.' };
}

function lgSt(lg) {
  if (lg < 0.6)  return { cls: 'bad',  lbl: 'VERY LOW', icon: '🔴', t: 'Unusually low L/G. Check pump operation, valve positions, basin level, and flow meter calibration.' };
  if (lg < 0.75) return { cls: 'warn', lbl: 'LOW',      icon: '⚠️', t: 'Below typical range. Verify pump impeller, strainer condition, and water distribution headers.' };
  if (lg <= 1.5) return { cls: 'ok',   lbl: 'NORMAL',   icon: '✅', t: 'L/G within typical operating range (0.75–1.5) for counterflow/crossflow towers.' };
  if (lg <= 2.0) return { cls: 'warn', lbl: 'HIGH',     icon: '⚠️', t: 'High L/G — water dominates. Check fan blade pitch, motor speed, belt/drive system, or air-side obstructions.' };
  return               { cls: 'bad',  lbl: 'VERY HIGH', icon: '🔴', t: 'Very high L/G. Significant air-side deficiency. Immediate fan/mechanical draft investigation required.' };
}

function fillStatus(pct) {
  if (pct === null || isNaN(pct)) return { cls: 'info', lbl: 'N/A',      icon: '—',  t: 'Cannot compute fill efficiency — verify all inputs.', bar: 'am' };
  if (pct >= 95)  return { cls: 'ok',   lbl: 'GOOD',     icon: '✅', t: 'Fill operating at or near design specification (≥95%). No immediate action required.', bar: 'gn' };
  if (pct >= 80)  return { cls: 'warn', lbl: 'DEGRADED',  icon: '⚠️', t: 'Fill partially degraded (80–95%). Schedule inspection: check for scaling, biological fouling, sagging or collapsed blocks.', bar: 'am' };
  if (pct >= 60)  return { cls: 'bad',  lbl: 'POOR',      icon: '🔴', t: 'Fill severely degraded (60–80%). Urgent inspection required. Likely causes: heavy fouling, scaling, structural damage.', bar: 'rd' };
  return                { cls: 'bad',  lbl: 'CRITICAL',   icon: '🔴', t: 'Fill critically degraded (<60%). Tower cannot meet design duty. Immediate shutdown for inspection and fill replacement required.', bar: 'rd' };
}

function perfScore(app_a, pred_app, fillPct, lg) {
  // Approach score (50 pts)
  const dApp = app_a - pred_app;
  let appScore;
  if (dApp <= 0) appScore = 50;
  else if (dApp <= 0.5) appScore = 45;
  else if (dApp <= 1.5) appScore = 35;
  else if (dApp <= 3.0) appScore = 20;
  else appScore = 5;

  // Fill score (35 pts)
  let fillScore;
  if (fillPct === null) fillScore = 20;
  else if (fillPct >= 95) fillScore = 35;
  else if (fillPct >= 80) fillScore = 25;
  else if (fillPct >= 60) fillScore = 12;
  else fillScore = 3;

  // L/G score (15 pts)
  let lgScore;
  if (lg === null) lgScore = 10;
  else if (lg >= 0.75 && lg <= 1.5) lgScore = 15;
  else if (lg >= 0.6 && lg <= 2.0) lgScore = 8;
  else lgScore = 2;

  return appScore + fillScore + lgScore;
}

function scoreInfo(s) {
  if (s >= 85) return { c: '#00e676', lbl: 'EXCELLENT' };
  if (s >= 70) return { c: '#00c9a7', lbl: 'GOOD' };
  if (s >= 55) return { c: '#ffb800', lbl: 'FAIR' };
  return { c: '#ff4444', lbl: 'POOR' };
}

// ── WBT Sweep Builder ────────────────────────────────────────────

function buildWBTSweep(dWB_C, dCWT_C, dHWT_C, aWB_C, kappa, Patm_kPa) {
  const steps = [];
  for (let dT = -15; dT <= 15; dT += 1) {
    const wb = dWB_C + dT;
    const pred = calcPredictedCWT(dCWT_C, dWB_C, wb, kappa);
    const kavlV = kavl(pred, dHWT_C, wb, Patm_kPa);
    const app = pred - wb;
    steps.push({
      wb: parseFloat(wb.toFixed(1)),
      pred: parseFloat(pred.toFixed(2)),
      app: parseFloat(app.toFixed(2)),
      kavlV: kavlV !== null ? parseFloat(kavlV.toFixed(4)) : null,
      isActual: Math.abs(wb - aWB_C) < 0.05
    });
  }
  return steps;
}

// ── Main calculate handler ───────────────────────────────────────

function runCalculate(p) {
  const {
    dWB_C, dCWT_C, dHWT_C, dWR, dAR,
    aWB_C, aCWT_C, aHWT_C,
    thW_C, thB_C,
    elev, patm,
    unitSys
  } = p;

  // Determine Patm
  let Patm_kPa = 101.325;
  if (isFinite(patm) && patm > 70 && patm < 110) {
    Patm_kPa = patm;
  } else if (isFinite(elev) && elev >= 0) {
    Patm_kPa = elevToPatm(elev);
  }

  // Validation
  const errs = [];
  if (!isFinite(dWB_C) || !isFinite(aWB_C)) errs.push('WBT values must be finite.');
  if (!isFinite(dCWT_C) || !isFinite(dHWT_C)) errs.push('Design CWT and HWT must be provided.');
  if (!isFinite(aCWT_C) || !isFinite(aHWT_C)) errs.push('Actual CWT and HWT must be provided.');
  if (dCWT_C <= dWB_C) errs.push('Design CWT must be > WBT (approach must be positive).');
  if (dHWT_C <= dCWT_C) errs.push('Design HWT must be > CWT (range must be positive).');
  if (aCWT_C <= aWB_C) errs.push('Actual CWT must be > Actual WBT.');
  if (aHWT_C <= aCWT_C) errs.push('Actual HWT must be > Actual CWT.');
  if (!isFinite(dWR) || dWR <= 0) errs.push('Water flow must be positive.');
  if (dHWT_C > 80 || aHWT_C > 80) errs.push('HWT must be below 80°C — near-boiling inputs are outside the valid psychrometric range.');
  if (dWB_C < -10 || aWB_C < -10) errs.push('WBT below −10°C is outside the valid psychrometric range for evaporative cooling.');
  if (errs.length) return { error: errs.join(' | ') };

  const hasAirFlow = isFinite(dAR) && dAR > 0;
  const thW = isFinite(thW_C) ? thW_C : 1.5;
  const thB = isFinite(thB_C) ? thB_C : 3.0;

  // Core calcs
  const app_d = dCWT_C - dWB_C, app_a = aCWT_C - aWB_C;
  const rng_d = dHWT_C - dCWT_C, rng_a = aHWT_C - aCWT_C;
  const dApp = app_a - app_d, dWBT = aWB_C - dWB_C;

  const avgTw_d = (dCWT_C + dHWT_C) / 2;
  const RHO_W_d = rhoWater(avgTw_d);
  const RHO_A_site = rhoAir(aWB_C, Patm_kPa);
  const Lmass = dWR * RHO_W_d / 3600;
  const Gmass = hasAirFlow ? dAR * RHO_A_site / 3600 : null;
  const lg = hasAirFlow ? Lmass / Gmass : null;

  const kavl_d = kavl(dCWT_C, dHWT_C, dWB_C, Patm_kPa);
  const kavl_a = kavl(aCWT_C, aHWT_C, aWB_C, Patm_kPa);
  const kavl_d_norm = kavl(dCWT_C, dHWT_C, aWB_C, Patm_kPa);
  const kavl_a_norm = kavl(aCWT_C, aHWT_C, aWB_C, Patm_kPa);
  let fillPct = null;
  if (kavl_d_norm !== null && kavl_d_norm > 0 && kavl_a_norm !== null)
    fillPct = Math.min((kavl_a_norm / kavl_d_norm) * 100, 150);

  const kappa = computeKappa(dCWT_C, dHWT_C, dWB_C, Patm_kPa);
  const kappaOK = kappa !== null;
  const kappaVal = kappaOK ? kappa : 0.6;
  const pred_cwt = calcPredictedCWT(dCWT_C, dWB_C, aWB_C, kappaVal);
  const pred_app = pred_cwt - aWB_C;
  const cwtDev = aCWT_C - pred_cwt;
  const dAppVsPred = app_a - pred_app;

  const effectiveness_d = rng_d / (dHWT_C - dWB_C);
  const effectiveness_a = rng_a / (aHWT_C - aWB_C);

  const appStResult = approachSt(dAppVsPred, thW, thB);
  const lgStResult = lg !== null ? lgSt(lg) : { cls: 'info', lbl: 'N/A', icon: '—', t: 'Air flow not provided — L/G ratio not computed.' };
  const fillStResult = fillStatus(fillPct);

  const score = perfScore(app_a, pred_app, fillPct, lg);
  const sInfo = scoreInfo(score);

  const worst = fillStResult.cls === 'bad' || appStResult.cls === 'bad' ? 'bad'
    : fillStResult.cls === 'warn' || appStResult.cls === 'warn' ? 'warn' : 'ok';

  // Build sweep table data
  const sweepData = buildWBTSweep(dWB_C, dCWT_C, dHWT_C, aWB_C, kappaVal, Patm_kPa);

  // Merkel chart data points
  const chartData = buildMerkelChart(dCWT_C, dHWT_C, dWB_C, aCWT_C, aHWT_C, aWB_C, Patm_kPa);

  return {
    // Inputs (echoed back in SI °C)
    dWB: dWB_C, dCWT: dCWT_C, dHWT: dHWT_C, dWR_r: dWR, dAR_r: dAR,
    aWB: aWB_C, aCWT: aCWT_C, aHWT: aHWT_C,
    hasAirFlow,

    // Core results
    app_d, app_a, rng_d, rng_a, dApp, dWBT,
    Lmass, Gmass, lg,
    kavl_d, kavl_a, kavl_d_norm, kavl_a_norm, fillPct,
    kappa: kappaVal, kappaOK, pred_cwt, pred_app, cwtDev, dAppVsPred,
    effectiveness_d, effectiveness_a,
    Patm_kPa, RHO_W_d, RHO_A_site,
    thW_C: thW, thB_C: thB,
    appSt: appStResult, lgSt: lgStResult, fillSt: fillStResult,
    worst, score, sInfo,

    // Table/chart data
    sweepData,
    chartData,

    // Range flag for integration info
    largeRange: rng_d > 15,

    ts: new Date().toISOString()
  };
}

function buildMerkelChart(dCWT_C, dHWT_C, dWB_C, aCWT_C, aHWT_C, aWB_C, Patm_kPa) {
  // Saturation curve points
  const Tmin = Math.min(dCWT_C, aCWT_C) - 2;
  const Tmax = Math.max(dHWT_C, aHWT_C) + 2;
  const nPts = 60;
  const satCurve = [];
  for (let i = 0; i <= nPts; i++) {
    const T = Tmin + i * (Tmax - Tmin) / nPts;
    satCurve.push({ T: parseFloat(T.toFixed(2)), h: saturationEnthalpy(T, Patm_kPa) });
  }

  // Chebyshev integration points (actual)
  const range_a = aHWT_C - aCWT_C;
  const fracs = [0.1, 0.4, 0.6, 0.9];
  const h_a_actual = airEnthalpy(aWB_C, Patm_kPa);
  const chevPts = fracs.map(f => {
    const Ti = aCWT_C + f * range_a;
    const cpAvg = (cpWater(aCWT_C) + cpWater(Ti)) / 2;
    return {
      T: parseFloat(Ti.toFixed(2)),
      hs: saturationEnthalpy(Ti, Patm_kPa),
      ha: h_a_actual + cpAvg * (Ti - aCWT_C)
    };
  });

  return {
    Tmin, Tmax,
    satCurve,
    chevPts,
    hADesign: saturationEnthalpy(dWB_C, Patm_kPa),
    hAActual: h_a_actual,
    aCWT: aCWT_C, aHWT: aHWT_C, aWB: aWB_C, dWB: dWB_C
  };
}

function runPredictCWT(p) {
  const { dWB_C, dCWT_C, dHWT_C, aWB_C, Patm_kPa = 101.325 } = p;

  if (!isFinite(dWB_C) || !isFinite(dCWT_C) || !isFinite(dHWT_C) || !isFinite(aWB_C))
    return { error: 'Enter Design WBT, CWT, HWT and Actual WBT first.' };

  const app_d = dCWT_C - dWB_C, rng_d = dHWT_C - dCWT_C;
  if (app_d <= 0) return { error: 'Design approach ≤ 0: CWT must be > WBT.' };
  if (rng_d <= 0) return { error: 'Design range ≤ 0: HWT must be > CWT.' };

  const kappa = computeKappa(dCWT_C, dHWT_C, dWB_C, Patm_kPa);
  if (kappa === null) return { error: '⚠ κ solver did not converge. Check input ranges.' };

  const pred_C = calcPredictedCWT(dCWT_C, dWB_C, aWB_C, kappa);
  const dWBT_C = aWB_C - dWB_C;
  const dCWT_delta = pred_C - dCWT_C;

  return {
    pred_C: parseFloat(pred_C.toFixed(2)),
    kappa: parseFloat(kappa.toFixed(3)),
    dWBT_C: parseFloat(dWBT_C.toFixed(2)),
    dCWT_delta: parseFloat(dCWT_delta.toFixed(2)),
    Patm_kPa: parseFloat(Patm_kPa.toFixed(2))
  };
}

// ── End of Section 03: Cooling Tower ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION D  ►  PSYCHROMETRIC CALCULATOR
// Route: /api/psychrometric
// (Original: SECTION 09 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 09 of 21  ►  PSYCHROMETRIC
// Route: /api/psychrometric
// Source: psychrometric.js
// ══════════════════════════════════════════════════════════════════════════════

// ============================================================
// Vercel Serverless API — Psychrometric Engine
// All thermodynamic calculations run server-side.
// Client sends raw inputs; server returns computed state.
// ============================================================

// ── ASHRAE 2009 Wexler-Hyland saturation pressure ──────────
function satPressure(T_C) {
  const T = T_C + 273.15;
  if (T_C >= 0) {
    const C8 = -5.8002206e3, C9 = 1.3914993, C10 = -4.8640239e-2,
          C11 = 4.1764768e-5, C12 = -1.4452093e-8, C13 = 6.5459673;
    return Math.exp(C8/T + C9 + C10*T + C11*T*T + C12*T*T*T + C13*Math.log(T)) / 1000;
  } else {
    const C1 = -5.6745359e3, C2 = 6.3925247, C3 = -9.677843e-3,
          C4 = 6.2215701e-7, C5 = 2.0747825e-9, C6 = -9.484024e-13, C7 = 4.1635019;
    return Math.exp(C1/T + C2 + C3*T + C4*T*T + C5*T*T*T + C6*T*T*T*T + C7*Math.log(T)) / 1000;
  }
}

// ── ISA atmosphere pressure from altitude ──────────────────
function altitudePressure(z_m) {
  return 101.325 * Math.pow(1 - 0.0065 * z_m / 288.15, 5.255);
}

// ── ASHRAE humidity ratio ──────────────────────────────────
function humidityRatio(pv_kPa, p_kPa) {
  return 0.621945 * pv_kPa / (p_kPa - pv_kPa);
}

// ── Moist air enthalpy (kJ/kg dry air) ─────────────────────
function enthalpy(T_C, W) {
  return 1.006 * T_C + W * (2501 + 1.86 * T_C);
}

// ── Specific volume (m³/kg dry air) ────────────────────────
function specVolume(T_C, W, p_kPa) {
  return 0.287058 * (T_C + 273.15) * (1 + 1.6078 * W) / p_kPa;
}

// ── Dew point — ARM (Alduchov & Eskridge 1996) ─────────────
function dewPoint(rh_fraction, T_C) {
  const a = 17.625, b = 243.04;
  const alpha = Math.log(Math.max(rh_fraction, 1e-6)) + a * T_C / (b + T_C);
  return b * alpha / (a - alpha);
}

// ── Wet bulb — Stull (2011) + ASHRAE thermodynamic Newton ──
function wetBulbApprox(T_C, rh_fraction, p_kPa) {
  const rh100 = rh_fraction * 100;
  let wb = T_C * Math.atan(0.151977 * Math.pow(rh100 + 8.313659, 0.5))
         + Math.atan(T_C + rh100)
         - Math.atan(rh100 - 1.676331)
         + 0.00391838 * Math.pow(rh100, 1.5) * Math.atan(0.023101 * rh100)
         - 4.686035;
  wb = Math.min(wb, T_C);
  const W_target = humidityRatio(satPressure(T_C) * rh_fraction, p_kPa);
  for (let i = 0; i < 50; i++) {
    const Ws_wb = humidityRatio(satPressure(wb), p_kPa);
    const W_calc = ((2501 - 2.381 * wb) * Ws_wb - 1.006 * (T_C - wb))
                 / (2501 + 1.805 * T_C - 4.186 * wb);
    const err = W_calc - W_target;
    if (Math.abs(err) < 1e-9) break;
    const h = 1e-4;
    const Ws_wb_h = humidityRatio(satPressure(wb + h), p_kPa);
    const W_calc_h = ((2501 - 2.381 * (wb + h)) * Ws_wb_h - 1.006 * (T_C - (wb + h)))
                   / (2501 + 1.805 * T_C - 4.186 * (wb + h));
    const dFdwb = (W_calc_h - W_calc) / h;
    wb -= Math.abs(dFdwb) > 1e-12 ? err / dFdwb : err * 60;
    wb = Math.min(wb, T_C);
  }
  return wb;
}

// ── Full state point from T, RH%, altitude ─────────────────
function calcState(T_C, rh_pct, z_m, p_override) {
  const p = p_override > 0 ? p_override : altitudePressure(z_m);
  const ps = satPressure(T_C);
  const rh = rh_pct / 100;
  const pv = ps * rh;
  const W = humidityRatio(pv, p);
  const h = enthalpy(T_C, W);
  const v = specVolume(T_C, W, p);
  const rho = (1 + W) / v;
  return { T: T_C, p, rh, W, h, v, rho, pv, ps };
}

// ── HVAC process ────────────────────────────────────────────
function calcProcess(T1, rh1, T2, rh2, Q_m3h, z_m) {
  const S1 = calcState(T1, rh1, z_m);
  const S2 = calcState(T2, rh2, z_m);
  const Q_kgs = Q_m3h / 3600 * S1.rho / (1 + S1.W);
  const dh = S2.h - S1.h;
  const dW = S2.W - S1.W;
  const Q_total = Q_kgs * dh;
  const Q_sensible = Q_kgs * 1.006 * (T2 - T1);
  const T_mean = (T1 + T2) / 2;
  const h_fg = 2501 - 2.381 * T_mean;
  const Q_latent = Q_kgs * h_fg * dW;
  const m_water = Q_kgs * Math.abs(dW) * 3600;
  const SHR = Math.abs(Q_total) > 0.001 ? Math.abs(Q_sensible) / Math.abs(Q_total) : 1.0;
  const procType = dh < 0
    ? (dW < -0.0001 ? 'Cooling + Dehumidification' : 'Sensible Cooling Only')
    : (dW > 0.0001 ? 'Heating + Humidification' : 'Sensible Heating Only');
  return { S1, S2, Q_kgs, dh, dW, Q_total, Q_sensible, Q_latent, m_water, SHR, procType };
}

// ── Duct / fan calculator ───────────────────────────────────
function calcDuct(T_C, rh_pct, z_m, shape, dims, Q_m3h, L, rough_mm) {
  const S = calcState(T_C, rh_pct, z_m);
  let A_m2, Dh_m, perim_m;
  if (shape === 'round') {
    const D = dims.diameter / 1000;
    A_m2 = Math.PI * D * D / 4;
    Dh_m = D;
    perim_m = Math.PI * D;
  } else {
    const W = dims.width / 1000, H = dims.height / 1000;
    A_m2 = W * H;
    Dh_m = 4 * A_m2 / (2 * (W + H));
    perim_m = 2 * (W + H);
  }
  const Q_m3s = Q_m3h / 3600;
  const rough_m = rough_mm / 1000;
  const vel_ms = Q_m3s / A_m2;
  // Sutherland's law — temperature-dependent viscosity
  const T_K = T_C + 273.15;
  const mu = 1.716e-5 * Math.pow(T_K / 273.15, 1.5) * (273.15 + 110.4) / (T_K + 110.4);
  const Re = S.rho * vel_ms * Dh_m / mu;
  let f, regimeNote = '';
  if (Re > 4000) {
    f = 0.25 / Math.pow(Math.log10(rough_m / (3.7 * Dh_m) + 5.74 / Math.pow(Re, 0.9)), 2);
  } else if (Re > 2300) {
    const f_lam = 64 / 2300;
    const f_turb = 0.25 / Math.pow(Math.log10(rough_m / (3.7 * Dh_m) + 5.74 / Math.pow(4000, 0.9)), 2);
    f = f_lam + (f_turb - f_lam) * (Re - 2300) / (4000 - 2300);
    regimeNote = 'Transition regime (Re 2300–4000) — friction factor interpolated; result uncertain ±20%';
  } else {
    f = Re > 0 ? 64 / Re : 0.02;
  }
  const dP_Pa = f * (L / Dh_m) * 0.5 * S.rho * vel_ms * vel_ms;
  const dP_mmWg = dP_Pa / 9.80665;
  const Pstatic_Pa = 0.5 * S.rho * vel_ms * vel_ms;
  const fanPower_kW = (dP_Pa * Q_m3s) / (1000 * 0.7);
  return { S, A_m2, Dh_m, perim_m, vel_ms, Re, f, dP_Pa, dP_mmWg, Pstatic_Pa, fanPower_kW, regimeNote };
}

// ── RH curves for chart (server generates coordinate data) ──
function calcChartData(p_kPa) {
  const Tmin = -10, Tmax = 50, Wmax = 0.030;
  const step = 0.5;
  const points = t => {
    const arr = [];
    for (let tt = Tmin; tt <= Tmax; tt += step) {
      arr.push({ t: tt, W: humidityRatio(satPressure(tt), p_kPa) });
    }
    return arr;
  };
  const satCurve = points();
  const rhCurves = [20, 30, 40, 50, 60, 70, 80].map(rh => {
    const pts = [];
    for (let t = Tmin; t <= Tmax; t += step) {
      const W = humidityRatio(satPressure(t) * rh / 100, p_kPa);
      if (W >= 0 && W <= Wmax) pts.push({ t, W });
    }
    return { rh, pts };
  });
  const enthalpyLines = [];
  for (let h_line = 10; h_line <= 110; h_line += 10) {
    const pts = [];
    for (let t = Tmin; t <= Tmax; t += step) {
      const W = (h_line - 1.006 * t) / (2501 + 1.86 * t);
      if (W >= 0 && W <= Wmax) pts.push({ t, W });
    }
    enthalpyLines.push({ h: h_line, pts });
  }
  return { satCurve, rhCurves, enthalpyLines };
}

// ════════════════════════════════════════════════════════════
// VERCEL HANDLER
// ════════════════════════════════════════════════════════════
function psychrometric_handler(req, res) {
  // CORS headers (adjust origin in production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, payload } = req.body;

    // ── STATE POINT ─────────────────────────────────────────
    if (action === 'statePoint') {
      const { T, mode, z, p_override, rh, wb, dp, W_in } = payload;

      if (T < -60 || T > 80) {
        return res.status(400).json({ error: 'Temperature out of valid range (−60°C to 80°C)' });
      }
      const p = p_override > 0 ? p_override : altitudePressure(z);
      const ps = satPressure(T);
      let pv, rh_val, W_val;

      if (mode === 'rh') {
        rh_val = rh / 100;
        pv = ps * rh_val;
      } else if (mode === 'wb') {
        if (wb > T) return res.status(400).json({ error: 'Wet bulb must be ≤ dry bulb temperature' });
        const psw = satPressure(wb);
        pv = psw - 0.000662 * p * (T - wb);
        rh_val = pv / ps;
      } else if (mode === 'dp') {
        if (dp >= T) return res.status(400).json({ error: 'Dew point must be < dry bulb temperature' });
        pv = satPressure(dp);
        rh_val = pv / ps;
      } else if (mode === 'w') {
        W_val = W_in;
        pv = W_val * p / (0.621945 + W_val);
        rh_val = pv / ps;
      }

      rh_val = Math.max(0, Math.min(1, rh_val));
      if (!W_val) W_val = humidityRatio(pv, p);
      const h = enthalpy(T, W_val);
      const v = specVolume(T, W_val, p);
      const rho = (1 + W_val) / v;
      const dp_C = dewPoint(rh_val, T);
      const wb_C = wetBulbApprox(T, rh_val, p);

      return res.status(200).json({
        T, p, ps, pv, rh: rh_val, W: W_val, h, v, rho, dp: dp_C, wb: wb_C
      });
    }

    // ── HVAC PROCESS ────────────────────────────────────────
    if (action === 'process') {
      const { T1, rh1, T2, rh2, Q_m3h, z } = payload;
      return res.status(200).json(calcProcess(T1, rh1, T2, rh2, Q_m3h, z));
    }

    // ── DUCT ────────────────────────────────────────────────
    if (action === 'duct') {
      const { T, rh, z, shape, dims, Q_m3h, L, rough_mm } = payload;
      return res.status(200).json(calcDuct(T, rh, z, shape, dims, Q_m3h, L, rough_mm));
    }

    // ── CHART DATA ──────────────────────────────────────────
    if (action === 'chartData') {
      const { p } = payload;
      return res.status(200).json(calcChartData(p || 101.325));
    }

    // ── ALTITUDE → PRESSURE ─────────────────────────────────
    if (action === 'altPressure') {
      return res.status(200).json({ p: altitudePressure(payload.z) });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[psychrometric]', err);
    return res.status(500).json({ error: 'Internal calculation error', detail: err.message });
  }
}

// ── End of Section 09: Psychrometric ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════
