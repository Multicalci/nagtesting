// ════════════════════════════════════════════════════════════════════════════
// api/civil-electrical-mechanical-instrumentation.js
// MERGED VERCEL SERVERLESS API — FILE 1 of 5
//
// CALCULATORS IN THIS FILE
// ────────────────────────
//   SECTION A  ►  CIVIL ENGINEERING CALCULATORS        /api/civil-engineering-calculators
//   SECTION B  ►  INSTRUMENTATION CALCULATORS          /api/instrumentation-calculators
//   SECTION C  ►  ELECTRICAL ENGINEERING CALCULATORS   /api/electrical-engineering-calculators
//   SECTION D  ►  MECHANICAL ENGINEERING CALCULATORS   /api/mechanical-engineering-calculators
//
// HOW TO NAVIGATE
//   Search "SECTION A" → Civil
//   Search "SECTION B" → Instrumentation
//   Search "SECTION C" → Electrical
//   Search "SECTION D" → Mechanical
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
    case 'civil-engineering-calculators':
      return await civil_handler(req, res);
    case 'instrumentation-calculators':
      return await instrumentation_handler(req, res);
    case 'electrical-engineering-calculators':
      return await electrical_handler(req, res);
    case 'mechanical-engineering-calculators':
      return await mechanical_handler(req, res);
    default:
      return res.status(404).json({
        error: `Unknown route: "${key}". Valid: civil-engineering-calculators, instrumentation-calculators, electrical-engineering-calculators, mechanical-engineering-calculators`
      });
  }
}
// ── End of Router ────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// SECTION A  ►  CIVIL ENGINEERING CALCULATORS
// Route: /api/civil-engineering-calculators
// (Original: SECTION 17 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 17 of 21  ►  CIVIL ENGINEERING CALCULATORS
// Route: /api/civil-engineering-calculators
// Source: civil-engineering-calculators.js
// ══════════════════════════════════════════════════════════════════════════════

// CIVIL ENGINEERING CALCULATORS — api/civil-engineering-calculators.js
// Covers: Beam, Column, Footing, Concrete Mix, Steel Section,
//         Pipe Flow, Retaining Wall, Earthwork, Surveying
// ================================================================

// ============================================================
// Vercel Serverless API — Civil Engineering Calculators
// Repo: github.com/nagtesting/nagtesting
// Path: /api/civil-engineering-calculators.js
// Covers: Beam, Column, Footing, Concrete Mix, Steel Section,
//         Pipe Flow, Retaining Wall, Earthwork, Surveying
// ============================================================

// ========================================================================
// SECTION: CIVIL
// ========================================================================

// ── SAFE HELPERS ─────────────────────────────────────────────
function safeDiv(num, den, fallback = Infinity) {
  return Math.abs(den) < 1e-15 ? fallback : num / den;
}
function fN(v, dp = 2, u = '') {
  return (isNaN(v) || !isFinite(v)) ? '—' : (v.toFixed(dp) + (u ? ' ' + u : ''));
}

// ── UNIT CONVERTERS ───────────────────────────────────────────
function toM(val, u)   { return u === 'ft'  ? val * 0.3048   : val; }
function civil_toMm(val, u) { return u === 'in' ? val * 25.4 : val; }
function toKN(val, u)  { return u === 'kip' ? val * 4.44822  : val; }
function toKPa(val, u) { return u === 'ksf' ? val * 47.88    : val; }
function toKNm3(val,u) { return u === 'pcf' ? val * 0.157088 : val; }
function toM3(val, u)  { return u === 'yd3' ? val * 0.7646   : val; }
function toM2(val, u)  { return u === 'ft2' ? val * 0.0929   : val; }
function toKmh(val, u) { return u === 'mph' ? val * 1.60934  : val; }
function toMs2(val, u) { return u === 'ft2' ? val * 0.0929   : val; }
function toLS(val, u)  { return u === 'gpm' ? val * 0.0630902 : val; }

// ── CALC: BEAM BENDING ────────────────────────────────────────
function calcBeam(p) {
  let L  = toM(parseFloat(p.L),  p.L_u);
  let w  = p.w_u === 'kipft' ? parseFloat(p.w) * 14.5939 : parseFloat(p.w);
  let b  = civil_toMm(parseFloat(p.b), p.dim_u) / 1000;
  let d  = civil_toMm(parseFloat(p.d), p.dim_u) / 1000;
  let tw = civil_toMm(parseFloat(p.tw)||0, p.dim_u) / 1000;
  let tf = civil_toMm(parseFloat(p.tf)||0, p.dim_u) / 1000;
  let dia= civil_toMm(parseFloat(p.dia)||0, p.dim_u) / 1000;
  const E_GPa = parseFloat(p.E_GPa);
  const fy    = parseFloat(p.fy);
  const type  = p.type;
  const sec   = p.sec;
  const Ev    = E_GPa * 1e6; // kN/m²

  const warns = [];
  if (L <= 0)    throw new Error('Span L must be > 0');
  if (w < 0)     throw new Error('Load cannot be negative');
  if (E_GPa <= 0) throw new Error('Elastic modulus must be > 0');
  if (E_GPa > 500) warns.push('⚠ E > 500 GPa is unrealistic — check units (enter GPa, not MPa)');
  if (fy <= 0)   throw new Error('Yield stress fy must be > 0');

  let I, A_sec;
  if (sec === 'rect') {
    if (b <= 0 || d <= 0) throw new Error('Width b and depth d must be > 0');
    I = b*d*d*d/12; A_sec = b*d;
  } else if (sec === 'circ') {
    if (dia <= 0) throw new Error('Diameter must be > 0');
    I = Math.PI * Math.pow(dia,4) / 64; A_sec = Math.PI*dia*dia/4;
  } else if (sec === 'hol') {
    if (b<=0||d<=0||tw<=0||tf<=0) throw new Error('All hollow section dimensions must be > 0');
    if (2*tw >= b) throw new Error('2·tw ≥ b — wall eliminates void (width)');
    if (2*tf >= d) throw new Error('2·tf ≥ d — wall eliminates void (depth)');
    const bi = b-2*tw, di = d-2*tf;
    I = (b*d*d*d - bi*di*di*di)/12; A_sec = b*d-bi*di;
  } else { // I
    if (b<=0||d<=0||tw<=0||tf<=0) throw new Error('All I-section dimensions must be > 0');
    if (tw >= b) throw new Error('Web thickness tw ≥ flange width b');
    if (2*tf >= d) throw new Error('2·tf ≥ d — no web remains');
    const hw = d-2*tf;
    I = (b*d*d*d - (b-tw)*hw*hw*hw)/12;
    A_sec = 2*b*tf + hw*tw;
  }

  if (I <= 0 || !isFinite(I)) throw new Error('Computed I ≤ 0 — check section geometry');
  const y   = sec === 'circ' ? dia/2 : d/2;
  const Z   = safeDiv(I, y);
  const rg  = Math.sqrt(safeDiv(I, A_sec, 0));

  let M=0, V=0, def=0, formula='';
  if      (type==='ss_udl')   { M=w*L*L/8;     V=w*L/2;   def=5*w*L*L*L*L/(384*Ev*I); formula='M=wL²/8 | V=wL/2 | δ=5wL⁴/384EI'; }
  else if (type==='ss_pt')    { M=w*L/4;        V=w/2;     def=w*L*L*L/(48*Ev*I);      formula='M=PL/4 | V=P/2 | δ=PL³/48EI'; }
  else if (type==='cant_udl') { M=w*L*L/2;      V=w*L;     def=w*L*L*L*L/(8*Ev*I);     formula='M=wL²/2 | V=wL | δ=wL⁴/8EI'; }
  else if (type==='cant_pt')  { M=w*L;          V=w;       def=w*L*L*L/(3*Ev*I);       formula='M=PL | V=P | δ=PL³/3EI'; }
  else if (type==='fixed_udl'){ M=w*L*L/12;     V=w*L/2;   def=w*L*L*L*L/(384*Ev*I);  formula='M_end=wL²/12 | M_mid=wL²/24 | V=wL/2 | δ=wL⁴/384EI'; }

  const sigma = safeDiv(M, Z) / 1000; // MPa
  if (!isFinite(sigma)) throw new Error('Bending stress overflow — check inputs');

  const isConcrete = (E_GPa >= 15 && E_GPa <= 50);
  const creepTheta = isConcrete ? 2.5 : 1.0;
  const def_lt = def * creepTheta;
  const LD_lt  = def_lt > 0 ? L / def_lt : Infinity;
  const LD     = def > 0 ? L / def : Infinity;
  const ok = sigma <= fy;

  if (E_GPa >= 15 && E_GPa <= 50)
    warns.push('⚠ Concrete detected — long-term deflection multiplied by θ=' + creepTheta + ' (IS 456 Cl.23.2 simplified)');
  if (LD < 250)
    warns.push('⚠ L/δ = ' + LD.toFixed(0) + ' < 250 — serviceability deflection may be excessive');

  return {
    status: ok ? 'PASS' : 'WARN',
    warns,
    summary: `Type: ${type} | Section: ${sec} | Formula: ${formula}`,
    results: [
      { label: 'Moment of Inertia I',  value: fN(I*1e12/1e6, 3, '×10⁶ mm⁴'), warn: false },
      { label: 'Section Modulus Z',    value: fN(Z*1e9/1e3, 2, '×10³ mm³'),  warn: false },
      { label: 'Radius of Gyration',   value: fN(rg*1000, 2, 'mm'),           warn: false },
      { label: 'Max Bending Moment M', value: fN(M, 3, 'kN·m'),               warn: false },
      { label: 'Max Shear Force V',    value: fN(V, 3, 'kN'),                  warn: false },
      { label: 'Max Deflection δ',     value: fN(def*1000, 3, 'mm'),           warn: false },
      { label: 'Long-term Deflection', value: fN(def_lt*1000, 3, 'mm') + (isConcrete ? ' (×'+creepTheta+' creep IS 456)' : ' (no creep)'), warn: isConcrete },
      { label: 'L/δ (short-term)',     value: LD === Infinity ? '∞' : fN(LD, 0), warn: LD < 250 },
      { label: 'L/δ (long-term)',      value: LD_lt === Infinity ? '∞' : fN(LD_lt, 0), warn: LD_lt < 250 },
      { label: 'Bending Stress σ',     value: fN(sigma, 2, 'MPa'),             warn: !ok },
      { label: 'Stress Check',         value: ok ? '✓ OK — σ ≤ fy' : '✗ Overstressed (fy=' + fy + ' MPa)', warn: !ok },
      { label: 'EI Stiffness',         value: fN(Ev*I, 0, 'kN·m²'),            warn: false },
    ]
  };
}

// ── CALC: COLUMN BUCKLING ─────────────────────────────────────
function calcCol(p) {
  const sec = p.sec;
  const K   = parseFloat(p.K);
  let Le    = toM(parseFloat(p.Le), p.Le_u);
  let b     = civil_toMm(parseFloat(p.b)||0, p.dim_u) / 1000;
  let d     = civil_toMm(parseFloat(p.d)||0, p.dim_u) / 1000;
  let diam  = civil_toMm(parseFloat(p.diam)||0, p.dim_u) / 1000;
  let OD    = civil_toMm(parseFloat(p.OD)||0, p.dim_u) / 1000;
  let t     = civil_toMm(parseFloat(p.t)||0, p.dim_u) / 1000;
  let tw    = civil_toMm(parseFloat(p.tw)||0, p.dim_u) / 1000;
  let tf    = civil_toMm(parseFloat(p.tf)||0, p.dim_u) / 1000;
  const E_GPa = parseFloat(p.E_GPa);
  const Ev    = E_GPa * 1e6;
  const fy    = parseFloat(p.fy);
  let N       = toKN(parseFloat(p.N)||0, p.N_u);

  if (Le <= 0)   throw new Error('Length Le must be > 0');
  if (E_GPa <= 0) throw new Error('Elastic modulus must be > 0');
  if (fy <= 0)   throw new Error('Yield stress fy must be > 0');

  let A=0, Ix=0, Iy=0;
  if (sec === 'rect') {
    if (b<=0||d<=0) throw new Error('Width and depth must be > 0');
    A = b*d; Ix = b*d*d*d/12; Iy = d*b*b*b/12;
  } else if (sec === 'circ') {
    if (diam <= 0) throw new Error('Diameter must be > 0');
    A = Math.PI*diam*diam/4; Ix = Iy = Math.PI*Math.pow(diam,4)/64;
  } else if (sec === 'I') {
    if (b<=0||d<=0||tw<=0||tf<=0) throw new Error('All I-section dimensions must be > 0');
    if (tw >= b) throw new Error('Web thickness tw ≥ flange width b');
    if (2*tf >= d) throw new Error('2·tf ≥ d — no web remains');
    const hw = d-2*tf;
    A  = 2*b*tf + hw*tw;
    Ix = (b*d*d*d - (b-tw)*hw*hw*hw) / 12;
    Iy = 2*(tf*b*b*b/12) + hw*tw*tw*tw/12;
  } else { // hollow
    if (OD<=0||t<=0) throw new Error('OD and thickness must be > 0');
    const ID = OD-2*t;
    if (ID <= 0) throw new Error('Wall thickness t > OD/2 — section is solid');
    A = Math.PI*(OD*OD-ID*ID)/4; Ix = Iy = Math.PI*(Math.pow(OD,4)-Math.pow(ID,4))/64;
  }

  const I_min  = Math.min(Ix, Iy);
  const r_min  = Math.sqrt(I_min/A);
  const KL     = K * Le;
  const KL_r   = safeDiv(KL, r_min);
  const fy_kPa = fy * 1000;
  const sigma_cr_euler = (Math.PI*Math.PI*Ev) / (KL_r*KL_r);
  const lambda_c = Math.PI * Math.sqrt(2*Ev/fy_kPa);
  let sigma_cr, formula_note;
  if (KL_r >= lambda_c) {
    sigma_cr = sigma_cr_euler; formula_note = 'Euler (slender)';
  } else {
    sigma_cr = fy_kPa*(1-(fy_kPa*KL_r*KL_r)/(4*Math.PI*Math.PI*Ev));
    formula_note = 'Johnson parabola (KL/r < λc=' + lambda_c.toFixed(0) + ')';
  }
  const Pcr = sigma_cr * A;

  const lambda_bar = Math.sqrt(fy_kPa / ((Math.PI*Math.PI*Ev)/(KL_r*KL_r)));
  const alphaMap   = { rect:0.49, circ:0.21, I:0.21, hol:0.34 };
  const alpha      = alphaMap[sec] || 0.34;
  let chi;
  if (lambda_bar <= 0.2) {
    chi = 1.0;
  } else {
    const phi = 0.5*(1 + alpha*(lambda_bar-0.2) + lambda_bar*lambda_bar);
    chi = Math.min(1.0, 1.0/(phi + Math.sqrt(phi*phi - lambda_bar*lambda_bar)));
  }
  const gamma_M0 = 1.10;
  const fcd = chi * fy_kPa / gamma_M0;
  const Pd  = fcd * A;
  const sigma_act = safeDiv(N, A);
  const demandOK  = N <= Pd;
  const SF        = N > 0 ? safeDiv(Pd, N) : Infinity;
  const curveLabel = {0.21:'a (α=0.21)', 0.34:'b (α=0.34)', 0.49:'c (α=0.49)'}[alpha] || 'b';
  const warns = [];
  if (KL_r > 180) warns.push('⚠ KL/r > 180 — very slender column, consider stiffening');
  if (!demandOK)  warns.push('⚠ Applied load N exceeds design resistance Pd');

  return {
    status: demandOK ? 'PASS' : 'WARN',
    warns,
    summary: `Section: ${sec} | KL/r = ${fN(KL_r,1)} | ${formula_note} | IS 800 curve ${curveLabel}`,
    results: [
      { label: 'Area A',                   value: fN(A*1e6, 1, 'mm²'),              warn: false },
      { label: 'Min. Inertia I_min',        value: fN(I_min*1e12/1e6, 2, '×10⁶ mm⁴'), warn: false },
      { label: 'Min. Radius of Gyration r', value: fN(r_min*1000, 2, 'mm'),          warn: false },
      { label: 'Slenderness KL/r',          value: fN(KL_r, 1) + ' (λc = ' + lambda_c.toFixed(0) + ')', warn: KL_r > 180 },
      { label: 'IS 800 λ̄',                 value: fN(lambda_bar, 3),                warn: false },
      { label: 'IS 800 χ (curve '+curveLabel+')', value: fN(chi, 3),                warn: false },
      { label: 'Pcr (elastic theoretical)', value: fN(Pcr, 2, 'kN'),                warn: false },
      { label: 'Pd (IS 800 design)',        value: fN(Pd, 2, 'kN'),                  warn: !demandOK },
      { label: 'Applied Load N',            value: fN(N, 2, 'kN'),                   warn: !demandOK },
      { label: 'Demand Check N ≤ Pd',       value: demandOK ? '✓ Adequate' : '✗ N > Pd — overstressed', warn: !demandOK },
      { label: 'Safety Factor Pd/N',        value: SF === Infinity ? '∞' : fN(SF, 2) + (SF>=2?' ✓ Adequate':SF>=1?' ⚠ Marginal':' ✗ Inadequate'), warn: SF < 1.5 },
      { label: 'Critical Stress σcr',       value: fN(sigma_cr/1000, 2, 'MPa'),      warn: false },
      { label: 'Axial Stress σ',            value: fN(sigma_act/1000, 2, 'MPa'),     warn: sigma_act > fy_kPa },
    ]
  };
}

// ── CALC: FOOTING ─────────────────────────────────────────────
function calcFooting(p) {
  let P   = toKN(parseFloat(p.P),   p.P_u);
  let cb  = civil_toMm(parseFloat(p.cb),  p.dim_u) / 1000;
  let cd  = civil_toMm(parseFloat(p.cd),  p.dim_u) / 1000;
  let B   = toM(parseFloat(p.B),    p.L_u);
  let L   = toM(parseFloat(p.L),    p.L_u);
  let d   = civil_toMm(parseFloat(p.d),   p.dim_u) / 1000;
  let qa  = toKPa(parseFloat(p.qa), p.qa_u);
  let ex  = toM(parseFloat(p.ex)||0, p.L_u);
  let ey  = toM(parseFloat(p.ey)||0, p.L_u);
  const fck  = parseInt(p.fck);
  const fy_s = parseInt(p.fy_s);

  if (P<=0)         throw new Error('Column load P must be > 0');
  if (B<=0||L<=0)   throw new Error('Footing dimensions must be > 0');
  if (d<=0)         throw new Error('Effective depth must be > 0');
  if (cb<=0||cd<=0) throw new Error('Column dimensions must be > 0');
  if (cb>=B||cd>=L) throw new Error('Column larger than footing');

  const q_avg = P / (B*L);
  const q_max = q_avg * (1 + 6*Math.abs(ex)/B + 6*Math.abs(ey)/L);
  const q_min = q_avg * (1 - 6*Math.abs(ex)/B - 6*Math.abs(ey)/L);
  const A_req = P / qa;
  const A_prov = B * L;
  const bearOK = q_max <= qa;
  const cantB  = (B-cb)/2, cantL = (L-cd)/2;
  const Mu_B   = 1.5 * q_max * cantB * cantB / 2;
  const Mu_L   = 1.5 * q_max * cantL * cantL / 2;
  const b_px   = cb+d, b_py = cd+d;
  const b0     = 2*(b_px+b_py);
  const V_punch = 1.5*P - 1.5*q_avg*b_px*b_py;
  const tau_v   = V_punch / (b0*d*1000);
  const beta_c  = Math.min(cb,cd) / Math.max(cb,cd);
  const k_s     = Math.min(1.0, 0.5+beta_c);
  const tau_co  = 0.25*Math.sqrt(fck);
  const tau_c   = k_s*tau_co;
  const punchOK = tau_v <= tau_c;
  const D_overall = d + 0.05;
  const pt_min    = fy_s >= 500 ? 0.0012 : 0.0015;
  const Ast_min   = pt_min * 1000 * D_overall * 1000;
  const Ast_B_calc = (Mu_B*1e6)/(0.87*fy_s*0.9*d*1000);
  const Ast_L_calc = (Mu_L*1e6)/(0.87*fy_s*0.9*d*1000);
  const Ast_B = Math.max(Ast_B_calc, Ast_min);
  const Ast_L = Math.max(Ast_L_calc, Ast_min);
  const critB = Math.max(0,(B-cb)/2-d), critL = Math.max(0,(L-cd)/2-d);
  const Vow_B = 1.5*q_max*critB, Vow_L = 1.5*q_max*critL;
  const tau_ow_B = Vow_B/(d*1000), tau_ow_L = Vow_L/(d*1000);
  function tauC_IS456(pt,fck){ if(pt<=0)return 0; const beta=Math.max(1,0.8*fck/(6.89*pt*100)); return 0.85*Math.sqrt(0.8*fck)*(Math.sqrt(1+5*beta)-1)/(6*beta); }
  const pt_B = Math.min(Ast_B/(1000*d*1000),0.03), pt_L = Math.min(Ast_L/(1000*d*1000),0.03);
  const tau_c_ow_B = tauC_IS456(pt_B*100,fck), tau_c_ow_L = tauC_IS456(pt_L*100,fck);
  const owOK_B = tau_ow_B <= tau_c_ow_B, owOK_L = tau_ow_L <= tau_c_ow_L;
  const allOK = bearOK && punchOK && owOK_B && owOK_L;
  const warns = [];
  if (!bearOK)  warns.push('⚠ Max bearing pressure q_max exceeds allowable SBC');
  if (!punchOK) warns.push('⚠ Punching shear fails — increase d or fck');
  if (!owOK_B)  warns.push('⚠ One-way shear fails in B-direction — increase effective depth');
  if (!owOK_L)  warns.push('⚠ One-way shear fails in L-direction — increase effective depth');
  if (q_min < 0) warns.push('⚠ Tension at base (q_min < 0) — check soil contact');

  return {
    status: allOK ? 'PASS' : 'WARN',
    warns,
    summary: `Footing ${fN(B,2)}×${fN(L,2)} m | d=${fN(d*1000,0)} mm | fck=${fck} MPa | fy=${fy_s} MPa`,
    results: [
      { label: 'Max Bearing Pressure q_max', value: fN(q_max,2,'kN/m²'), warn: !bearOK },
      { label: 'Bearing Check',              value: bearOK ? '✓ q_max ≤ qa' : '✗ Exceeds qa='+qa.toFixed(0)+' kN/m²', warn: !bearOK },
      { label: 'Min Bearing Pressure q_min', value: fN(q_min,2,'kN/m²'), warn: q_min<0 },
      { label: 'Required Area',              value: fN(A_req,2,'m²'),     warn: false },
      { label: 'Provided Area',              value: fN(A_prov,2,'m²') + (A_prov>=A_req?' ✓':' ✗'), warn: A_prov<A_req },
      { label: 'Factored Mu (B-dir)',        value: fN(Mu_B,2,'kN·m/m'), warn: false },
      { label: 'Factored Mu (L-dir)',        value: fN(Mu_L,2,'kN·m/m'), warn: false },
      { label: 'Punch Perimeter b0',         value: fN(b0*1000,0,'mm'),  warn: false },
      { label: 'Applied τ_v',                value: fN(tau_v,3,'MPa'),   warn: !punchOK },
      { label: 'k_s (IS 456 Cl.31.6.3)',     value: fN(k_s,3)+' (β_c='+fN(beta_c,3)+')', warn: false },
      { label: 'Allowable τ_c',              value: fN(tau_c,3,'MPa'),   warn: false },
      { label: 'Punching Check',             value: punchOK ? '✓ Safe τ_v ≤ τ_c' : '✗ Fails — increase d or fck', warn: !punchOK },
      { label: 'Ast B-dir',                  value: fN(Ast_B,0,'mm²/m'), warn: false },
      { label: 'Ast L-dir',                  value: fN(Ast_L,0,'mm²/m'), warn: false },
      { label: 'Ast_min',                    value: fN(Ast_min,0,'mm²/m') + ' (IS 456 Cl.26.5.2.1)', warn: false },
      { label: 'One-way Shear B',            value: fN(tau_ow_B,3,'MPa')+' vs τ_c='+fN(tau_c_ow_B,3,'MPa'), warn: !owOK_B },
      { label: 'One-way Shear L',            value: fN(tau_ow_L,3,'MPa')+' vs τ_c='+fN(tau_c_ow_L,3,'MPa'), warn: !owOK_L },
    ]
  };
}

// ── CALC: CONCRETE MIX ───────────────────────────────────────
function calcConc(p) {
  const grade  = parseInt(p.grade);
  const wc     = parseFloat(p.wc);
  let   vol    = parseFloat(p.vol_u) === 'yd3' ? parseFloat(p.vol)*0.7646 : parseFloat(p.vol);
  if (vol <= 0) vol = 1;
  const slump  = parseInt(p.slump);
  const aggSz  = parseInt(p.aggSz);
  const FA_pct = parseFloat(p.FA_pct) / 100;
  const exp    = p.exp;
  const cem    = p.cem;
  const expMap = {
    mild:      { minCem:300, maxWC:0.65 },
    moderate:  { minCem:320, maxWC:0.55 },
    severe:    { minCem:340, maxWC:0.50 },
    very_severe:{ minCem:360, maxWC:0.45 }
  };
  const expData = expMap[exp] || expMap['moderate'];

  let W = 175;
  if (aggSz===10) W+=15; if (aggSz===40) W-=15;
  if (slump===25) W-=15; if (slump===150) W+=20;
  let C = W / wc;
  if (C < expData.minCem) C = expData.minCem;
  const WC_actual = W / C;
  const S_dev = grade >= 30 ? 5 : 4;
  const fm    = grade + 1.65 * S_dev;
  const rho_cem = cem==='PPC' ? 2900 : (cem==='SRPC' ? 3200 : 3150);
  const vol_cem = C/rho_cem, vol_w = W/1000, vol_air = 0.015;
  const vol_agg = 1 - vol_cem - vol_w - vol_air;
  const FA = vol_agg * FA_pct * 2650;
  const CA = vol_agg * (1-FA_pct) * 2700;
  const density = C+W+FA+CA;
  const bags = C/50;
  const rFA = FA/C, rCA = CA/C, rW = W/C;
  const wcOK = WC_actual <= expData.maxWC;
  const warns = [];
  if (!wcOK) warns.push('⚠ W/C ratio ' + WC_actual.toFixed(3) + ' exceeds durability limit ' + expData.maxWC + ' for ' + exp + ' exposure');

  return {
    status: wcOK ? 'PASS' : 'WARN',
    warns,
    summary: `M${grade} | fm=${fN(fm,1)} MPa | W/C=${WC_actual.toFixed(3)} | ρ=${fN(density,0)} kg/m³`,
    results: [
      { label: 'Target Mean Strength fm', value: fN(fm,1,'MPa') + ' = fck + 1.65×'+S_dev, warn: false },
      { label: 'Cement Content',          value: fN(C,0,'kg/m³') + ' | Batch: ' + fN(C*vol,0,'kg'), warn: C > 500 },
      { label: 'Water Content',           value: fN(W,0,'L/m³') + ' | Batch: ' + fN(W*vol,0,'L'), warn: false },
      { label: 'W/C Ratio (actual)',       value: WC_actual.toFixed(3) + (wcOK?' ✓':' ✗ Exceeds '+expData.maxWC), warn: !wcOK },
      { label: 'Fine Aggregate FA',        value: fN(FA,0,'kg/m³') + ' | Batch: ' + fN(FA*vol,0,'kg'), warn: false },
      { label: 'Coarse Aggregate CA',      value: fN(CA,0,'kg/m³') + ' | Batch: ' + fN(CA*vol,0,'kg'), warn: false },
      { label: 'Mix Ratio C:FA:CA:W',      value: '1:'+rFA.toFixed(2)+':'+rCA.toFixed(2)+':'+rW.toFixed(2), warn: false },
      { label: 'Fresh Density (computed)', value: fN(density,0,'kg/m³'), warn: false },
      { label: 'Cement Bags',             value: fN(bags,1,'bags (50 kg/m³)'), warn: false },
    ]
  };
}

// ── CALC: STEEL SECTION ───────────────────────────────────────
function calcSteel(p) {
  const type = p.type;
  const fy_s = parseFloat(p.fy_s);
  if (!isFinite(fy_s) || fy_s <= 0) throw new Error('fy must be a positive number');

  let Ixx=0, Iyy=0, A=0, Zpx=0, Zpy=0, yc=0, yt=0, yb=0, zt=0, zb=0;
  let zpxLabel='', zpyLabel='';

  function findPNA(areaAbove, lo, hi, tol=1e-6) {
    for (let i=0; i<60; i++) {
      const mid=(lo+hi)/2;
      if (areaAbove(mid) > A/2) lo=mid; else hi=mid;
      if (hi-lo < tol) break;
    }
    return (lo+hi)/2;
  }

  if (type === 'I') {
    const H=parseFloat(p.H),Bf=parseFloat(p.Bf),Tf=parseFloat(p.Tf),Tw=parseFloat(p.Tw);
    if (H<=0||Bf<=0||Tf<=0||Tw<=0) throw new Error('All dimensions must be > 0');
    if (H<=2*Tf) throw new Error('H ≤ 2·Tf — web height is zero');
    if (Tw>=Bf)  throw new Error('Web thickness ≥ flange width');
    const hw=H-2*Tf;
    A=2*Bf*Tf+hw*Tw; yc=H/2; yt=yb=H/2; zt=zb=Bf/2;
    Ixx=(Bf*H*H*H-(Bf-Tw)*hw*hw*hw)/12;
    Iyy=2*(Tf*Bf*Bf*Bf/12)+hw*Tw*Tw*Tw/12;
    Zpx=2*(Bf*Tf*(hw/2+Tf/2)+Tw*(hw/2)*(hw/4));
    Zpy=2*(2*Tf*(Bf/2)*(Bf/4)+hw*(Tw/2)*(Tw/4));
    zpxLabel='Exact — doubly-symmetric I'; zpyLabel='Exact';

  } else if (type === 'C') {
    const H=parseFloat(p.H),Bf=parseFloat(p.Bf),Tf=parseFloat(p.Tf),Tw=parseFloat(p.Tw);
    if (H<=0||Bf<=0||Tf<=0||Tw<=0) throw new Error('All dimensions must be > 0');
    if (H<=2*Tf) throw new Error('H ≤ 2·Tf — web height is zero');
    if (Tw>=Bf)  throw new Error('Web thickness ≥ flange width');
    const hw=H-2*Tf;
    A=2*Bf*Tf+hw*Tw; yc=H/2; yt=yb=H/2;
    const A_flange=Bf*Tf,A_web=hw*Tw;
    const zc_flange=Tw+Bf/2, zc_web=Tw/2;
    const zc=(2*A_flange*zc_flange+A_web*zc_web)/A;
    zt=zc; zb=Bf+Tw-zc;
    Ixx=(Bf*H*H*H-(Bf-Tw)*hw*hw*hw)/12;
    const Iyy_flange_own=2*(Tf*Bf*Bf*Bf/12);
    const Iyy_flange_pa=2*(A_flange*(zc_flange-zc)*(zc_flange-zc));
    const Iyy_web_own=hw*Tw*Tw*Tw/12;
    const Iyy_web_pa=A_web*(zc_web-zc)*(zc_web-zc);
    Iyy=Iyy_flange_own+Iyy_flange_pa+Iyy_web_own+Iyy_web_pa;
    Zpx=2*(Bf*Tf*(hw/2+Tf/2)+Tw*(hw/2)*(hw/4));
    const zfl_right=Bf+Tw-zc;
    const Zpy_flange_right=2*(Tf*zfl_right*(zfl_right/2));
    const Zpy_web_left=hw*(Math.min(Tw,zc))*(Math.min(Tw,zc)/2);
    const Zpy_flange_left=2*(Tf*Math.max(0,zc-Tw)*(Math.max(0,zc-Tw)/2));
    Zpy=Zpy_flange_right+Zpy_web_left+Zpy_flange_left;
    zpxLabel='Exact — C-channel'; zpyLabel='Exact — minor axis';

  } else if (type === 'angle') {
    const La=parseFloat(p.La),ta=parseFloat(p.ta);
    if (La<=0||ta<=0) throw new Error('Leg length and thickness must be > 0');
    if (ta>=La)       throw new Error('Thickness ≥ leg length');
    const A1=La*ta, y1c=La/2, A2=(La-ta)*ta, y2c=ta/2;
    A=A1+A2; yc=(A1*y1c+A2*y2c)/A;
    yt=La-yc; yb=yc; zt=La-yc; zb=yc;
    const Ixx1=ta*La*La*La/12+A1*(y1c-yc)*(y1c-yc);
    const Ixx2=(La-ta)*ta*ta*ta/12+A2*(y2c-yc)*(y2c-yc);
    Ixx=Ixx1+Ixx2; Iyy=Ixx;
    const Ixy=A1*(La/2-yc)*(y1c-yc)+A2*((La+ta)/2-yc)*(y2c-yc);
    const Imin=Ixx-Math.abs(Ixy); const Imax=Ixx+Math.abs(Ixy);
    function areaAboveAngle(y){ return ta*Math.max(0,La-y)+(La-ta)*Math.max(0,ta-y); }
    const y_pna=findPNA(areaAboveAngle,0,La);
    function fmAbove(y_p){ let S=0; if(y_p<ta){S+=La*(ta-y_p)*(ta-y_p)/2;S+=ta*((La-y_p)*(La-y_p)-(ta-y_p)*(ta-y_p))/2;}else{S=ta*(La-y_p)*(La-y_p)/2;} return S; }
    function fmBelow(y_p){ const lo_end=Math.min(y_p,ta); let S=La*(y_p*lo_end-lo_end*lo_end/2); if(y_p>ta)S+=ta*(y_p-ta)*(y_p-ta)/2; return S; }
    Zpx=fmAbove(y_pna)+fmBelow(y_pna); Zpy=Zpx;
    Ixx=Imin; Iyy=Imax;
    zpxLabel='Exact — bisection PNA (equal angle)'; zpyLabel='Exact (= Zpx)';

  } else if (type === 'SHS') {
    const Bs=parseFloat(p.Bs),ts=parseFloat(p.ts);
    if (Bs<=0||ts<=0) throw new Error('Outer size and thickness must be > 0');
    if (2*ts>=Bs)     throw new Error('2·t ≥ B — wall thickness eliminates void');
    const Bi=Bs-2*ts;
    A=Bs*Bs-Bi*Bi; yc=Bs/2; yt=yb=Bs/2; zt=zb=Bs/2;
    Ixx=Iyy=(Bs*Bs*Bs*Bs-Bi*Bi*Bi*Bi)/12;
    Zpx=Zpy=(Bs*Bs*Bs-Bi*Bi*Bi)/4;
    zpxLabel=zpyLabel='Exact — (Bs³−Bi³)/4';

  } else if (type === 'CHS') {
    const Dc=parseFloat(p.Dc),tc=parseFloat(p.tc);
    if (Dc<=0||tc<=0) throw new Error('Outer diameter and thickness must be > 0');
    if (2*tc>=Dc)     throw new Error('2·t ≥ D — wall eliminates bore');
    const Di=Dc-2*tc;
    A=Math.PI*(Dc*Dc-Di*Di)/4; yc=Dc/2; yt=yb=Dc/2; zt=zb=Dc/2;
    Ixx=Iyy=Math.PI*(Math.pow(Dc,4)-Math.pow(Di,4))/64;
    Zpx=Zpy=(Math.pow(Dc,3)-Math.pow(Di,3))/6;
    zpxLabel=zpyLabel='Exact — (Do³−Di³)/6';
  } else {
    throw new Error('Unknown section type: ' + type);
  }

  if (!isFinite(A)||A<=0) throw new Error('Computed area invalid — check inputs');
  if (!isFinite(Ixx)||Ixx<=0) throw new Error('Ixx ≤ 0 — geometry produces zero inertia');

  const y_max=Math.max(yt,yb), z_max=Math.max(zt,zb);
  const Zxx=Ixx/y_max, Zyy=Iyy/z_max;
  const rx=Math.sqrt(Ixx/A), ry=Math.sqrt(Iyy/A);
  const wt_per_m=A*7850/1e6;
  const gamma_M0=1.10;
  const Mc=Zpx*fy_s/(gamma_M0*1e6);
  const eps=Math.sqrt(250/fy_s);
  let classNote='', classBadge='info';
  if (type==='I') {
    const H=parseFloat(p.H),Bf=parseFloat(p.Bf),Tf=parseFloat(p.Tf),Tw=parseFloat(p.Tw),hw=H-2*Tf;
    const b_tf=Bf/(2*Tf),d_tw=hw/Tw;
    if(b_tf<=9.4*eps&&d_tw<=84*eps){classNote='Class 1 — Plastic';classBadge='ok';}
    else if(b_tf<=10.5*eps&&d_tw<=105*eps){classNote='Class 2 — Compact';classBadge='ok';}
    else if(b_tf<=15.7*eps&&d_tw<=126*eps){classNote='Class 3 — Semi-compact';classBadge='warn';}
    else{classNote='Class 4 — Slender ⚠';classBadge='err';}
  }
  const warns = [];
  if (classBadge==='err') warns.push('⚠ Class 4 slender section — moment capacity Mc may be reduced per IS 800');

  return {
    status: classBadge==='err' ? 'WARN' : 'PASS',
    warns,
    summary: `Type: ${type} | A=${fN(A,0)} mm² | wt=${fN(wt_per_m,2)} kg/m | Mc=${fN(Mc,2)} kN·m`,
    results: [
      { label: 'Area A',              value: fN(A,0,'mm²'),              warn: false },
      { label: 'Ixx (major)',         value: fN(Ixx/1e6,3,'×10⁶ mm⁴'), warn: false },
      { label: 'Iyy (minor)',         value: fN(Iyy/1e6,3,'×10⁶ mm⁴'), warn: false },
      { label: 'Elastic Modulus Zxx', value: fN(Zxx/1e3,2,'×10³ mm³'), warn: false },
      { label: 'Elastic Modulus Zyy', value: fN(Zyy/1e3,2,'×10³ mm³'), warn: false },
      { label: 'Radius of Gyration rx', value: fN(rx,2,'mm'),           warn: false },
      { label: 'Radius of Gyration ry', value: fN(ry,2,'mm'),           warn: false },
      { label: 'Plastic Modulus Zpx',  value: fN(Zpx/1e3,3,'×10³ mm³')+' ('+zpxLabel+')', warn: false },
      { label: 'Section Classification', value: classNote || 'N/A for this section type', warn: classBadge==='err' },
      { label: 'Weight per metre',     value: fN(wt_per_m,2,'kg/m'),    warn: false },
      { label: 'Moment Capacity Mc',   value: fN(Mc,2,'kN·m') + ' (IS 800 Cl.8.2.1.2, γM0=1.10)', warn: false },
    ]
  };
}

// ── CALC: PIPE FLOW ────────────────────────────────────────────
function calcPipe(p) {
  const mode  = p.mode;
  let D_mm    = civil_toMm(parseFloat(p.D), p.D_u);
  if (D_mm <= 0) throw new Error('Diameter must be > 0');
  const D = D_mm / 1000;

  if (mode === 'pressure') {
    let L   = toM(parseFloat(p.L),   p.L_u);
    let Q_ls= toLS(parseFloat(p.Q), p.Q_u);
    let Hlim= toM(parseFloat(p.Hlim),p.L_u);
    const eps_mm = parseFloat(p.eps_mm);
    const fl_data = { w:{rho:998.2,mu:1.003e-3}, wc:{rho:999.7,mu:1.307e-3}, sw:{rho:1025,mu:1.073e-3} };
    const fl = fl_data[p.fluid] || fl_data['w'];
    if (L<=0) throw new Error('Length must be > 0');
    if (Q_ls<=0) throw new Error('Flow rate must be > 0');
    const Ap = Math.PI*D*D/4;
    const Q_m3s = Q_ls/1000, v = Q_m3s/Ap;
    const Re = fl.rho*v*D/fl.mu;
    const g = 9.81, eps_rel = eps_mm/D_mm;
    const f = Re<1 ? 64/Math.max(Re,0.01) : Re<2300 ? 64/Re : 0.25/Math.pow(Math.log10(eps_rel/3.7+5.74/Math.pow(Re,0.9)),2);
    const hf = f*(L/D)*(v*v/(2*g));
    const vH = v*v/(2*g);
    const hfOK = hf <= Hlim;
    const regime = Re<2300?'Laminar':Re<4000?'Transitional':'Turbulent';
    const warns = [];
    if (!hfOK) warns.push('⚠ Head loss ' + fN(hf,3) + ' m exceeds limit ' + fN(Hlim,3) + ' m');
    if (Re>=2300&&Re<4000) warns.push('⚠ Transitional flow (Re=' + Re.toFixed(0) + ') — friction factor uncertain');

    return {
      status: hfOK ? 'PASS' : 'WARN',
      warns,
      summary: `Pressure pipe | D=${fN(D_mm,0)} mm | Q=${fN(Q_ls,2)} L/s | v=${fN(v,2)} m/s | ${regime}`,
      results: [
        { label: 'Flow Velocity v',     value: fN(v,3,'m/s'),       warn: false },
        { label: 'Reynolds Number Re',  value: Re.toFixed(0),        warn: Re>=2300&&Re<4000 },
        { label: 'Flow Regime',         value: regime,               warn: Re>=2300&&Re<4000 },
        { label: 'Darcy Friction Factor f', value: fN(f,5,''),      warn: false },
        { label: 'Head Loss hf',        value: fN(hf,3,'m'),        warn: !hfOK },
        { label: 'Head Loss Check',     value: hfOK ? '✓ hf ≤ limit' : '✗ Exceeds limit', warn: !hfOK },
        { label: 'Hydraulic Gradient',  value: fN(hf/L,5,'m/m'),    warn: false },
        { label: 'Velocity Head v²/2g', value: fN(vH,4,'m'),        warn: false },
        { label: 'Flow Area A',         value: fN(Ap*1e4,2,'cm²'),  warn: false },
        { label: 'Mass Flow ṁ',         value: fN(fl.rho*Q_m3s,3,'kg/s'), warn: false },
      ]
    };

  } else { // gravity/manning
    const S = parseFloat(p.S), n = parseFloat(p.n);
    const shape = p.shape;
    let width = toM(parseFloat(p.width)||0, p.L_u);
    let depth = toM(parseFloat(p.depth)||0, p.L_u);
    const z   = parseFloat(p.z)||0;
    let Q_des_ls = toLS(parseFloat(p.Q_des)||0, p.Q_u);
    if (S<=0) throw new Error('Slope S must be > 0');
    if (n<=0) throw new Error('Manning n must be > 0');
    const g=9.81;
    let A_full,P_wet,R_h,v_full,Q_full,y_eff;
    if (shape==='circ') {
      A_full=Math.PI*D*D/4; P_wet=Math.PI*D; R_h=D/4;
      v_full=(1/n)*Math.pow(R_h,2/3)*Math.pow(S,0.5); Q_full=A_full*v_full; y_eff=D;
    } else if (shape==='rect') {
      if(width<=0||depth<=0) throw new Error('Width and depth must be > 0');
      A_full=width*depth; P_wet=width+2*depth; R_h=A_full/P_wet;
      v_full=(1/n)*Math.pow(R_h,2/3)*Math.pow(S,0.5); Q_full=A_full*v_full; y_eff=depth;
    } else {
      if(width<=0||depth<=0) throw new Error('Width and depth must be > 0');
      A_full=(width+z*depth)*depth; P_wet=width+2*depth*Math.sqrt(1+z*z); R_h=A_full/P_wet;
      v_full=(1/n)*Math.pow(R_h,2/3)*Math.pow(S,0.5); Q_full=A_full*v_full; y_eff=depth;
    }
    const Q_des = Q_des_ls/1000;
    const capOK = Q_full >= Q_des;
    const S_min = Math.pow(0.6*n/Math.pow(R_h,2/3),2);
    const Fr    = v_full/Math.sqrt(g*y_eff);
    const frLabel = Fr<1?'Subcritical':Fr>1?'Supercritical':'Critical';
    const warns = [];
    if (!capOK) warns.push('⚠ Full-flow capacity insufficient — increase D, slope, or reduce n');
    if (v_full < 0.6) warns.push('⚠ v < 0.6 m/s — below self-cleaning velocity');

    return {
      status: capOK ? 'PASS' : 'WARN',
      warns,
      summary: `Gravity | D=${fN(D_mm,0)} mm | S=${fN(S,5)} | n=${fN(n,4)} | Q_full=${fN(Q_full*1000,2)} L/s`,
      results: [
        { label: 'Full-Flow Capacity Q', value: fN(Q_full*1000,3,'L/s'), warn: !capOK },
        { label: 'Capacity Check',       value: capOK ? '✓ Q_full ≥ Q_design' : '✗ Insufficient capacity', warn: !capOK },
        { label: 'Full-Flow Velocity v', value: fN(v_full,3,'m/s'),      warn: v_full<0.6 },
        { label: 'Hydraulic Radius R',   value: fN(R_h,4,'m'),           warn: false },
        { label: 'Flow Area A',          value: fN(A_full,4,'m²'),        warn: false },
        { label: 'Wetted Perimeter P',   value: fN(P_wet,3,'m'),          warn: false },
        { label: 'Min Slope (v=0.6m/s)', value: fN(S_min,5,'m/m'),       warn: false },
        { label: 'Froude Number Fr',     value: fN(Fr,3) + ' (' + frLabel + ')', warn: Fr>1 },
      ]
    };
  }
}

// ── CALC: RETAINING WALL ──────────────────────────────────────
function calcRetWall(p) {
  let H     = toM(parseFloat(p.H), p.L_u);
  let B     = toM(parseFloat(p.B), p.L_u);
  let stem  = toM(parseFloat(p.stem), p.L_u);
  let base  = toM(parseFloat(p.base), p.L_u);
  let gamma  = toKNm3(parseFloat(p.gamma), p.g_u);
  let gammaC = toKNm3(parseFloat(p.gammaC), p.g_u);
  let q   = toKPa(parseFloat(p.q)||0,   p.q_u);
  let qa  = toKPa(parseFloat(p.qa),      p.q_u);
  const phi = parseFloat(p.phi) * Math.PI/180;
  const mu  = parseFloat(p.mu);

  if (H<=0)    throw new Error('Wall height H must be > 0');
  if (B<=0)    throw new Error('Base width B must be > 0');
  if (stem<=0) throw new Error('Stem thickness must be > 0');
  if (base<=0) throw new Error('Base thickness must be > 0');
  if (base>=H) throw new Error('Base thickness must be less than wall height H');
  if (stem>=B) throw new Error('Stem thickness must be less than base width B');

  const Hs     = H-base;
  const Ka     = Math.pow(Math.tan(Math.PI/4-phi/2),2);
  const Kp     = Math.pow(Math.tan(Math.PI/4+phi/2),2);
  const Pa_soil  = 0.5*gamma*H*H*Ka;
  const Pa_surch = q*H*Ka;
  const Pa       = Pa_soil + Pa_surch;
  const Mo = Pa_soil*(H/3) + Pa_surch*(H/2);
  const W_stem = gammaC*stem*Hs, W_base = gammaC*B*base, W_soil = gamma*(B-stem)*Hs;
  const W  = W_stem + W_base + W_soil;
  const Mr = W_stem*(stem/2) + W_base*(B/2) + W_soil*(stem+(B-stem)/2);
  const FSOvt = Mr/Mo, FSsl = mu*W/Pa;
  const e  = B/2 - (Mr-Mo)/W;
  const q_max = (W/B)*(1+6*e/B), q_min = (W/B)*(1-6*e/B);
  const otOK = FSOvt>=1.5, slOK = FSsl>=1.5, qOK = q_max<=qa;
  const allOK = otOK && slOK && qOK;
  const warns = [];
  if (!otOK) warns.push('⚠ Overturning FS=' + FSOvt.toFixed(2) + ' < 1.5 — redesign required');
  if (!slOK) warns.push('⚠ Sliding FS=' + FSsl.toFixed(2) + ' < 1.5 — add shear key or increase base');
  if (!qOK)  warns.push('⚠ Foundation pressure q_max exceeds allowable bearing capacity');

  return {
    status: allOK ? 'PASS' : 'WARN',
    warns,
    summary: `H=${fN(H,2)}m | B=${fN(B,2)}m | Ka=${fN(Ka,4)} | FSOvt=${fN(FSOvt,2)} | FSsl=${fN(FSsl,2)}`,
    results: [
      { label: 'Active Pressure Ka',     value: fN(Ka,4),                warn: false },
      { label: 'Passive Pressure Kp',    value: fN(Kp,4),                warn: false },
      { label: 'Active Force Pa',        value: fN(Pa,2,'kN/m'),         warn: false },
      { label: 'Vertical Load W',        value: fN(W,2,'kN/m'),          warn: false },
      { label: 'Overturning Moment Mo',  value: fN(Mo,2,'kN·m/m'),       warn: false },
      { label: 'Stabilising Moment Mr',  value: fN(Mr,2,'kN·m/m'),       warn: false },
      { label: 'FS Overturning (≥1.5)',  value: fN(FSOvt,2) + (otOK?' ✓ OK':' ✗ Fails'), warn: !otOK },
      { label: 'FS Sliding (≥1.5)',      value: fN(FSsl,2)  + (slOK?' ✓ OK':' ✗ Fails — add shear key'), warn: !slOK },
      { label: 'Eccentricity e',         value: fN(e,3,'m'),              warn: e>B/6 },
      { label: 'Max Foundation Pressure',value: fN(q_max,2,'kN/m²'),     warn: !qOK },
      { label: 'Min Foundation Pressure',value: fN(q_min,2,'kN/m²'),     warn: q_min<0 },
      { label: 'Bearing Check',          value: qOK ? '✓ q_max ≤ qa' : '✗ Exceeds qa=' + qa.toFixed(0) + ' kN/m²', warn: !qOK },
    ]
  };
}

// ── CALC: EARTHWORK ───────────────────────────────────────────
function calcEarth(p) {
  const method = p.method;
  let A1 = toM2(parseFloat(p.A1), p.A_u);
  let A2 = toM2(parseFloat(p.A2), p.A_u);
  let Am = toM2(parseFloat(p.Am)||0, p.A_u);
  let L  = toM(parseFloat(p.L),   p.L_u);
  const sw    = parseFloat(p.sw)/100;
  const sh    = parseFloat(p.sh)/100;
  const densB = parseFloat(p.densB);
  const densL = parseFloat(p.densL);
  const truck = parseFloat(p.truck);

  if (A1<0||A2<0)        throw new Error('Cross-section areas must be ≥ 0');
  if (L<=0)              throw new Error('Distance L must be > 0');
  if (densB<=0||densL<=0) throw new Error('Densities must be > 0');
  if (truck<=0)          throw new Error('Truck capacity must be > 0');

  const Vavg  = L*(A1+A2)/2;
  const Vprism= method==='prism' ? L*(A1+4*Am+A2)/6 : Vavg;
  const Vb=Vprism, Vl=Vb*(1+sw), Vc=Vb*(1-sh);
  const mass=Vb*densB, trucks=Math.ceil(Vl/truck), LF=densB/densL;
  const prismCorr = Vprism-Vavg;

  return {
    status: 'PASS',
    warns: [],
    summary: `Method: ${method} | Vbank=${fN(Vb,2)} m³ | Loose=${fN(Vl,2)} m³ | Trucks=${trucks}`,
    results: [
      { label: 'Bank Volume',           value: fN(Vb,2,'m³'),             warn: false },
      { label: 'Loose Volume',          value: fN(Vl,2,'m³'),             warn: false },
      { label: 'Compacted Volume',      value: fN(Vc,2,'m³'),             warn: false },
      { label: 'Mass of Material',      value: fN(mass,2,'t'),            warn: false },
      { label: 'Load Factor (Bank/Loose)', value: fN(LF,3,''),            warn: false },
      { label: 'Truck Loads Required',  value: trucks + ' loads',          warn: false },
      { label: 'Prismoidal Correction', value: method==='prism' ? fN(prismCorr,3,'m³') : 'N/A (avg end area)', warn: false },
    ]
  };
}

// ── CALC: SURVEYING & ROAD GEOMETRY ──────────────────────────
function calcSurvey(p) {
  let R   = toM(parseFloat(p.R),   p.L_u);
  const delta_deg = parseFloat(p.delta_deg);
  const delta = delta_deg * Math.PI/180;
  let V   = toKmh(parseFloat(p.V), p.V_u);
  const e = parseFloat(p.e)/100;
  const f_fr = parseFloat(p.f_fr);
  let SSD = toM(parseFloat(p.SSD), p.L_u);
  const G1 = parseFloat(p.G1), G2 = parseFloat(p.G2);

  if (R<=0)         throw new Error('Radius R must be > 0');
  if (delta_deg<=0) throw new Error('Deflection angle must be > 0');
  if (V<=0)         throw new Error('Design speed must be > 0');
  if (SSD<=0)       throw new Error('SSD must be > 0');

  const Lc    = R*delta;
  const T     = R*Math.tan(delta/2);
  const M_ord = R*(1-Math.cos(delta/2));
  const E_ext = R*(1/Math.cos(delta/2)-1);
  const chord = 2*R*Math.sin(delta/2);
  const DC    = 180*20/(Math.PI*R);
  const Rmin  = V*V/(127*(e+f_fr));
  const RminOK= R >= Rmin;
  const A_grade = Math.abs(G1-G2);
  const VCL_crest = A_grade>0 ? A_grade*SSD*SSD/658 : 0;
  const VCL_sag   = A_grade>0 ? (A_grade*SSD/3.5+SSD) : 0;
  const VCL = G2<G1 ? VCL_crest : VCL_sag;
  const RC  = VCL>0 ? A_grade*1000/VCL : 0;
  const warns = [];
  if (!RminOK) warns.push('⚠ R=' + fN(R,1) + ' m < Rmin=' + fN(Rmin,1) + ' m for V=' + fN(V,0) + ' km/h — unsafe speed');

  return {
    status: RminOK ? 'PASS' : 'WARN',
    warns,
    summary: `R=${fN(R,1)}m | Δ=${fN(delta_deg,2)}° | V=${fN(V,0)}km/h | Lc=${fN(Lc,2)}m`,
    results: [
      { label: 'Curve Length Lc',       value: fN(Lc,2,'m'),   warn: false },
      { label: 'Tangent Length T',      value: fN(T,2,'m'),    warn: false },
      { label: 'Mid-Ordinate M',        value: fN(M_ord,3,'m'),warn: false },
      { label: 'External Distance E',   value: fN(E_ext,3,'m'),warn: false },
      { label: 'Chord Length C',        value: fN(chord,3,'m'),warn: false },
      { label: 'Degree of Curvature',   value: fN(DC,4,'°'),   warn: false },
      { label: 'Min Radius Rmin',       value: fN(Rmin,1,'m'), warn: !RminOK },
      { label: 'Speed Check R ≥ Rmin',  value: RminOK ? '✓ R ≥ Rmin — safe' : '✗ R < Rmin — unsafe', warn: !RminOK },
      { label: 'Grade Difference A',    value: fN(A_grade,3,'%'), warn: false },
      { label: 'Vertical Curve Length', value: fN(VCL,1,'m'),  warn: false },
      { label: 'Rate of Change RC',     value: fN(RC,4,'%/m'), warn: false },
    ]
  };
}

async function handle_civil_engineering(body, res) {
  const { calc, params: p } = body || {};
  if (!calc || !p)
    return res.status(400).json({ error: 'Missing calc or params in request body' });
  try {
    let result;
    switch (calc) {
      case 'beam':    result = calcBeam(p);    break;
      case 'col':     result = calcCol(p);     break;
      case 'footing': result = calcFooting(p); break;
      case 'conc':    result = calcConc(p);    break;
      case 'steel':   result = calcSteel(p);   break;
      case 'pipe':    result = calcPipe(p);    break;
      case 'retwall': result = calcRetWall(p); break;
      case 'earth':   result = calcEarth(p);   break;
      case 'survey':  result = calcSurvey(p);  break;
      default:
        return res.status(400).json({ error: 'Unknown calc type: ' + calc });
    }
    return res.status(200).json(result);
  } catch(err) {
    return res.status(422).json({ error: err.message });
  }
}





// ================================================================

// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — dispatches to handle_civil_engineering
// ════════════════════════════════════════════════════════════════════════════
async function civil_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? req.body : {};
  if (req.method === 'POST' && (!body || typeof body !== 'object'))
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_civil_engineering(body, res);
  } catch (e) {
    console.error('[civil-engineering-calculators.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 17: Civil Engineering Calculators ──────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION B  ►  INSTRUMENTATION CALCULATORS
// Route: /api/instrumentation-calculators
// (Original: SECTION 18 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 18 of 21  ►  INSTRUMENTATION CALCULATORS
// Route: /api/instrumentation-calculators
// Source: instrumentation-calculators.js
// ══════════════════════════════════════════════════════════════════════════════

// INSTRUMENTATION CALCULATORS — 4-20mA, Thermowell, Loop, LLA
// ================================================================

/**
 * Vercel Serverless Function — /api/calculate
 * POST body: { tool: string, inputs: object }
 * Returns:   { ok: true, result: object } | { ok: false, error: string }
 *
 * AUDIT FIXES vs first draft:
 *  FIX-API-1  All numeric inputs coerced with Number() before isNaN checks.
 *  FIX-API-2  calcLoop: added txmin < supply guard (missing → negative maxLoad).
 *  FIX-API-3  calcThermowell: Re/fs/fn/mu returned as formatted strings so
 *             exponential notation is preserved for display on client.
 *  FIX-API-4  calcSqrt: cutoff clamped 0–100; dp===cutoff treated as above
 *             cutoff (flow shown) consistent with hysteresis semantics.
 *  FIX-API-5  awgToMm2: explicit guard for AWG ≤ 0.
 *  FIX-API-6  calcLLA: maxLoad_diag added to return object (was computed
 *             but not returned, silently omitting limit from warn message).
 *  FIX-API-7  calcThermowell: validation BEFORE unit conversion.
 *  FIX-API-8  OPTIONS preflight returns 204 (correct), not 200.
 *  FIX-API-9  calcLoop: 22 mA diagnostic check added (was only in LLA).
 */
// FIX-API-1: coerce to Number, NaN stays NaN
function instr_n(val) { const v = Number(val); return isNaN(v) ? NaN : v; }

/* ── NAMUR NE43 ── */
function namurZone(mA) {
  if (mA < 3.6)   return { zone:'FAIL_LOW',   label:'🔴 NAMUR FAIL – Low (< 3.6 mA)',      color:'red',    isValid:false, isFault:true  };
  if (mA < 3.8)   return { zone:'WARN_LOW',   label:'🟠 NAMUR FAULT – Low (3.6–3.8 mA)',   color:'orange', isValid:false, isFault:true  };
  if (mA < 4.0)   return { zone:'BURNOUT_LO', label:'⚠ Below live-zero (3.8–4.0 mA)',      color:'orange', isValid:false, isFault:true  };
  if (mA <= 20.0) return { zone:'VALID',      label:'✅ Valid 4–20 mA signal',              color:'green',  isValid:true,  isFault:false };
  if (mA <= 21.0) return { zone:'BURNOUT_HI', label:'🟠 NAMUR FAULT – High (20–21 mA)',    color:'orange', isValid:false, isFault:true  };
  return           { zone:'FAIL_HIGH',  label:'🔴 NAMUR FAIL – High (> 21 mA)',      color:'red',    isValid:false, isFault:true  };
}

/* ── SIGNAL ── */
function calcSignal(raw) {
  const v = instr_n(raw.v), mn = instr_n(raw.mn), mx = instr_n(raw.mx);
  const dir = String(raw.dir || 'ma2eu');
  if (isNaN(v))           throw new Error('Please enter an input value');
  if (isNaN(mn)||isNaN(mx)) throw new Error('Enter valid Range Min and Max');
  if (mn === mx)          throw new Error('Range Min and Max cannot be equal (zero span)');

  if (dir === 'ma2eu') {
    const nz = namurZone(v);
    if (nz.isFault) return { type:'fault', nz, mA:v };
    const result = mn + ((v - 4) / 16) * (mx - mn);
    return { type:'ma2eu', result:+result.toFixed(4), pct:+((v-4)/16*100).toFixed(1), span:+(mx-mn).toFixed(4), mA:v, mn, mx, nz };
  } else {
    const lo = Math.min(mn,mx), hi = Math.max(mn,mx);
    if (v < lo || v > hi) throw new Error(`Value must be within range [${lo} … ${hi}]`);
    const result = 4 + ((v - mn) / (mx - mn)) * 16;
    return { type:'eu2ma', result:+result.toFixed(4), pct:+((result-4)/16*100).toFixed(1), eu:v, mn, mx, nz:namurZone(result) };
  }
}

/* ── SQRT ── FIX-API-4 */
function calcSqrt(raw) {
  const dp = instr_n(raw.dp), qmax = instr_n(raw.qmax);
  const funit = String(raw.funit || 'm3h');
  let cutoff = instr_n(raw.cutoff);
  if (isNaN(cutoff) || cutoff < 0) cutoff = 1;
  if (cutoff > 100) cutoff = 100;

  if (isNaN(dp) || dp < 0 || dp > 100) throw new Error('DP% must be 0 – 100');
  if (isNaN(qmax) || qmax <= 0)        throw new Error('Enter a valid Max Flow span (> 0)');

  const hysteresisHigh = +(cutoff + 0.5).toFixed(1);
  if (dp < cutoff) {
    return { cutoffActive:true, flow:0, dp, qmax, cutoff, hysteresisHigh, funit };
  }
  const flow = qmax * Math.sqrt(dp / 100);
  return {
    cutoffActive:false,
    flow:+flow.toFixed(4), sqrtVal:+Math.sqrt(dp/100).toFixed(5),
    pct:+(flow/qmax*100).toFixed(2), dp, qmax, cutoff, hysteresisHigh, funit
  };
}

/* ── LOOP ── FIX-API-2, FIX-API-5, FIX-API-9 */
const AWG_TABLE = {10:5.261,12:3.309,14:2.081,16:1.309,18:0.8231,20:0.5176,22:0.3255,24:0.2047,26:0.1288,28:0.0810};

function awgToMm2(awg) {
  if (awg <= 0) throw new Error('AWG value must be > 0'); // FIX-API-5
  const a = Math.round(awg);
  if (AWG_TABLE[a]) return AWG_TABLE[a];
  const d_in = 0.005 * Math.pow(92, (36 - awg) / 39);
  const d_mm = d_in * 25.4;
  return (Math.PI / 4) * d_mm * d_mm;
}

function calcLoop(raw) {
  let len = instr_n(raw.len);
  const lenU = String(raw.lenU || 'm');
  let csaRaw = instr_n(raw.csaRaw);
  const csaU = String(raw.csaU || 'mm2');
  const supply = instr_n(raw.supply), txmin = instr_n(raw.txmin), load = instr_n(raw.load);
  const cableTemp = instr_n(raw.cableTemp);

  if ([len,csaRaw,supply,txmin,load].some(isNaN)) throw new Error('Fill all fields');
  if (len    <= 0) throw new Error('Cable length must be > 0');
  if (csaRaw <= 0) throw new Error('Cable cross-section must be > 0');
  if (supply <= 0) throw new Error('Supply voltage must be > 0');
  if (txmin  <= 0) throw new Error('Transmitter min voltage must be > 0');
  if (load   <  0) throw new Error('Loop burden cannot be negative');
  if (txmin >= supply) throw new Error('Transmitter min voltage must be less than supply voltage'); // FIX-API-2

  if (lenU === 'km') len *= 1000; else if (lenU === 'ft') len *= 0.3048;
  const csa = csaU === 'awg' ? awgToMm2(csaRaw) : csaRaw;

  const rho_cu_20 = 0.0168;
  const T = isNaN(cableTemp) ? 20 : cableTemp;
  const alpha = 0.00393;
  const rho_cu = rho_cu_20 * (1 + alpha * (T - 20));
  const cable_r = rho_cu * (2 * len) / csa;

  const total_r     = load + cable_r;
  const vDrop_cable = cable_r * 0.020;
  const vDrop_load  = load    * 0.020;
  const vAtTx       = supply - vDrop_cable - vDrop_load;
  const headroom    = vAtTx  - txmin;
  const maxLoad     = (supply - txmin) / 0.020;
  const loadUsed    = (total_r / maxLoad * 100).toFixed(1);
  const vRequired_safe = txmin * 1.3 + total_r * 0.020;

  // FIX-API-9: 22 mA diagnostic check (was missing from loop calc)
  const vAtTx_diag    = supply - (total_r * 0.022);
  const headroom_diag = vAtTx_diag - txmin;

  const warns = [];
  if (headroom < 0) warns.push(`🚨 FAIL — Tx voltage at 20 mA is ${vAtTx.toFixed(2)} V, below minimum ${txmin} V. Reduce cable length, increase CSA, or reduce burden.`);
  else if (headroom < 2) warns.push(`⚠ WARNING — Headroom only ${headroom.toFixed(2)} V. Marginal — consider increasing supply or reducing load.`);
  if (supply < vRequired_safe) warns.push(`⚠ SAFETY MARGIN — Industrial practice requires supply ≥ 1.3 × V_tx_min + loop drop = ${vRequired_safe.toFixed(2)} V. Current supply (${supply} V) is below this threshold.`);
  if (headroom_diag < 0) warns.push(`🚨 DIAGNOSTIC OVERLOAD — At 22 mA (HART diagnostic peak), Tx sees ${vAtTx_diag.toFixed(2)} V, below minimum ${txmin} V. Loop will collapse during diagnostics.`);
  else if (headroom_diag < 1) warns.push(`⚠ MARGINAL AT 22 mA — Headroom during HART diagnostic is only ${headroom_diag.toFixed(2)} V. Verify transmitter diagnostic current spec.`);
  if (T !== 20) warns.push(`ℹ Cable R corrected to ${T}°C: ρ = ${rho_cu.toFixed(5)} Ω·mm²/m (vs 0.0168 at 20°C, Δ${((rho_cu/rho_cu_20-1)*100).toFixed(1)}%)`);
  if (T > 100)  warns.push(`⚠ HIGH TEMPERATURE — Linear α correction (R_T = R₂₀[1 + α(T−20)]) becomes increasingly inaccurate above 100°C. Error may reach 2–5% at 200°C.`);

  return {
    cable_r:        +cable_r.toFixed(3),
    total_r:        +total_r.toFixed(3),
    vDrop_cable:    +vDrop_cable.toFixed(3),
    vDrop_load:     +vDrop_load.toFixed(3),
    vAtTx:          +vAtTx.toFixed(3),
    headroom:       +headroom.toFixed(3),
    headroom_diag:  +headroom_diag.toFixed(3),
    maxLoad:        +maxLoad.toFixed(1),
    loadUsed,
    vRequired_safe: +vRequired_safe.toFixed(2),
    rho_cu:         +rho_cu.toFixed(5),
    csa:            +csa.toFixed(3),
    T, csaU,
    csaRaw_rounded: Math.round(csaRaw),
    pass20mA: headroom >= 0,
    pass22mA: headroom_diag >= 0,
    warns
  };
}

/* ── THERMOWELL ── FIX-API-3, FIX-API-7 */
function strouhalFromRe(Re) {
  if (Re < 1000)   return { St:0.21, regime:'Sub-critical (Re < 10³)' };
  if (Re < 200000) return { St:0.22, regime:'Subcritical (10³ ≤ Re < 2×10⁵)' };
  if (Re < 500000) return { St:0.19, regime:'Critical / drag-crisis (2×10⁵ ≤ Re < 5×10⁵)' };
  return            { St:0.27, regime:'Supercritical (Re ≥ 5×10⁵)' };
}
function estimateMu(fluid, rho) {
  if (fluid === 'liquid') return 0.001;
  if (fluid === 'gas')    return 1.8e-5;
  return rho > 100 ? 0.001 : 1.8e-5;
}

function calcThermowell(raw) {
  // FIX-API-7: validate BEFORE unit conversion
  const U_raw   = instr_n(raw.U),  d_raw = instr_n(raw.d), vel_raw = instr_n(raw.vel);
  const lenU    = String(raw.lenU  || 'mm');
  const odU     = String(raw.odU   || 'mm');
  const velU    = String(raw.velU  || 'ms');
  const fluid   = String(raw.fluid || 'liquid');
  let rho       = instr_n(raw.rho);

  if (isNaN(U_raw)||isNaN(d_raw)||isNaN(vel_raw)) throw new Error('Fill insertion length, tip OD and velocity');
  if (U_raw   <= 0) throw new Error('Insertion length must be > 0');
  if (d_raw   <= 0) throw new Error('Tip OD must be > 0');
  if (vel_raw <= 0) throw new Error('Velocity must be > 0');

  let U = U_raw, d = d_raw, vel = vel_raw;
  if (lenU === 'mm') U /= 1000; else if (lenU === 'in') U *= 0.0254;
  if (odU  === 'mm') d /= 1000; else if (odU  === 'in') d *= 0.0254;
  if (velU === 'fts') vel *= 0.3048;

  let densityNote = '';
  if (fluid === 'liquid' && (isNaN(rho)||rho<=0)) {
    rho = 1000; densityNote = 'Liquid: default ρ = 1000 kg/m³ (water). For hydrocarbons or oils enter Custom density.';
  } else if (fluid === 'gas' && (isNaN(rho)||rho<=0)) {
    rho = 10;   densityNote = 'Gas: default ρ = 10 kg/m³. ⚠ Rough estimate — actual density depends heavily on P and T. Enter Custom density for accurate results.';
  } else if (fluid === 'custom' && (isNaN(rho)||rho<=0)) {
    throw new Error('Enter custom fluid density');
  }

  const mu = estimateMu(fluid, rho);
  const Re = (rho * vel * d) / mu;
  const { St, regime } = strouhalFromRe(Re);
  const fs = St * vel / d;

  const E = 193e9, rho_mat = 7950;
  const r = d / 2;
  const I = (Math.PI * Math.pow(r, 4)) / 4;
  const A = Math.PI * r * r;
  const fn = (3.52 / (2 * Math.PI * U * U)) * Math.sqrt((E * I) / (rho_mat * A));
  const fr = fs / fn;

  let status, statusLevel;
  if (fr < 0.6)      { status = '✅ ACCEPTABLE (f_s/f_n < 0.6)';               statusLevel = 'ok';   }
  else if (fr < 0.8) { status = '⚠ MARGINAL (0.6 ≤ f_s/f_n < 0.8)';          statusLevel = 'warn'; }
  else               { status = '🚨 CRITICAL — Resonance risk (f_s/f_n ≥ 0.8)'; statusLevel = 'fail'; }

  const warns = [];
  if (fr >= 0.8) warns.push(`🚨 Frequency ratio ${fr.toFixed(3)} ≥ 0.8. HIGH RESONANCE RISK — shorten U, increase tip OD d, or reduce process velocity.`);
  else if (fr >= 0.6) warns.push(`⚠ Ratio ${fr.toFixed(3)} is marginal (0.6–0.8). Perform full ASME PTC 19.3 TW detailed calculation before finalising design.`);
  if (densityNote) warns.push(`ℹ Density note: ${densityNote}`);
  warns.push(`ℹ Reynolds regime: ${regime} → St = ${St} (Reynolds-corrected). Re = ${Re.toExponential(2)}.`);
  warns.push(`ℹ Scruton number (Sc = 2mδ/ρd²) requires structural damping data — cannot be calculated here. Perform full ASME PTC 19.3 TW for final design sign-off.`);
  warns.push(`ℹ Solid uniform 316SS rod assumed. Tapered/stepped geometry, support compliance and fluid damping not modelled — simplified first-pass only.`);

  // FIX-API-3: return pre-formatted strings for scientific notation values
  return {
    Re_str:    Re.toExponential(3),
    St, regime,
    fs_str:    fs.toFixed(3),
    fn_str:    fn.toFixed(3),
    fr_str:    fr.toFixed(4),
    fr_num:    fr,
    status, statusLevel,
    U_mm:      +(U * 1000).toFixed(1),
    d_mm:      +(d * 1000).toFixed(2),
    vel_ms:    +vel.toFixed(3),
    rho,
    mu_str:    mu.toExponential(2),
    I_e10_str: (I * 1e10).toFixed(4),
    warns
  };
}

/* ── LLA ── FIX-API-6 */
function calcLLA(raw) {
  const supply  = instr_n(raw.supply),  txmin = instr_n(raw.txmin);
  const ai      = isNaN(instr_n(raw.ai))      ? 0 : Math.max(0, instr_n(raw.ai));
  const iso     = isNaN(instr_n(raw.iso))     ? 0 : Math.max(0, instr_n(raw.iso));
  const barrier = isNaN(instr_n(raw.barrier)) ? 0 : Math.max(0, instr_n(raw.barrier));
  const cable   = isNaN(instr_n(raw.cable))   ? 0 : Math.max(0, instr_n(raw.cable));
  const other   = isNaN(instr_n(raw.other))   ? 0 : Math.max(0, instr_n(raw.other));

  if (isNaN(supply)||isNaN(txmin)) throw new Error('Enter supply and Tx min voltages');
  if (supply <= 0)    throw new Error('Supply voltage must be > 0');
  if (txmin  <= 0)    throw new Error('Transmitter min voltage must be > 0');
  if (txmin >= supply) throw new Error('Tx min voltage must be less than supply voltage');

  const total          = ai + iso + barrier + cable + other;
  const maxLoad        = (supply - txmin) / 0.020;
  const vDrop          = total * 0.020;
  const vRequired      = txmin + 0.020 * total;
  const vRequired_safe = 1.3 * txmin + 0.020 * total;
  const vAtTx          = supply - vDrop;
  const headroom       = vAtTx - txmin;
  const usedPct        = (total / maxLoad * 100).toFixed(1);

  const I_DIAG        = 0.022;
  const vAtTx_diag    = supply - (total * I_DIAG);
  const headroom_diag = vAtTx_diag - txmin;
  const maxLoad_diag  = (supply - txmin) / I_DIAG; // FIX-API-6

  const warns = [];
  if (headroom < 0) warns.push(`🚨 FAIL @ 20 mA — Total load (${total.toFixed(1)} Ω) exceeds max allowable (${maxLoad.toFixed(1)} Ω). Transmitter cannot be powered at full-scale output.`);
  else if (parseFloat(usedPct) > 80) warns.push(`⚠ Load is at ${usedPct}% of maximum at 20 mA. Marginal headroom — review cable lengths and additional loads.`);
  if (supply < vRequired_safe) warns.push(`⚠ SAFETY MARGIN — Industrial practice: supply ≥ 1.3 × V_tx_min + loop drop = ${vRequired_safe.toFixed(2)} V. Current supply (${supply} V) is below this threshold.`);
  if (headroom_diag < 0) warns.push(`🚨 DIAGNOSTIC OVERLOAD — At 22 mA (smart transmitter diagnostic peak), headroom is ${headroom_diag.toFixed(3)} V. Loop will collapse during HART diagnostics. Reduce total impedance below ${maxLoad_diag.toFixed(0)} Ω.`);
  else if (headroom_diag < 1) warns.push(`⚠ MARGINAL AT 22 mA — Smart transmitters may output up to 22–24 mA during HART diagnostics. Headroom at 22 mA is only ${headroom_diag.toFixed(3)} V. Verify transmitter diagnostic current specification.`);

  return {
    total:           +total.toFixed(2),
    maxLoad:         +maxLoad.toFixed(1),
    maxLoad_diag:    +maxLoad_diag.toFixed(0), // FIX-API-6
    vDrop:           +vDrop.toFixed(3),
    vRequired:       +vRequired.toFixed(3),
    vRequired_safe:  +vRequired_safe.toFixed(3),
    vAtTx:           +vAtTx.toFixed(3),
    headroom:        +headroom.toFixed(3),
    headroom_diag:   +headroom_diag.toFixed(3),
    usedPct,
    pass20mA:  headroom >= 0,
    pass22mA:  headroom_diag >= 0,
    ai, iso, barrier, cable, other,
    warns
  };
}

// ========================================================================
// SECTION: INSTRUMENTATION
// ========================================================================

async function handle_instrumentation(body, res) {
  const { tool, inputs } = body || {};
  if (!tool)   return res.status(400).json({ ok: false, error: 'Missing tool' });
  if (!inputs) return res.status(400).json({ ok: false, error: 'Missing inputs' });
  try {
    let result;
    switch (tool) {
      case 'signal':     result = calcSignal(inputs);     break;
      case 'sqrt':       result = calcSqrt(inputs);       break;
      case 'loop':       result = calcLoop(inputs);       break;
      case 'thermowell': result = calcThermowell(inputs); break;
      case 'lla':        result = calcLLA(inputs);        break;
      default: return res.status(400).json({ ok: false, error: `Unknown tool: ${tool}` });
    }
    return res.status(200).json({ ok: true, result });
  } catch(e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}


// ================================================================

// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — dispatches to handle_instrumentation
// ════════════════════════════════════════════════════════════════════════════
async function instrumentation_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? req.body : {};
  if (req.method === 'POST' && (!body || typeof body !== 'object'))
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_instrumentation(body, res);
  } catch (e) {
    console.error('[instrumentation-calculators.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 18: Instrumentation Calculators ──────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION C  ►  ELECTRICAL ENGINEERING CALCULATORS
// Route: /api/electrical-engineering-calculators
// (Original: SECTION 19 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 19 of 21  ►  ELECTRICAL ENGINEERING CALCULATORS
// Route: /api/electrical-engineering-calculators
// Source: electrical-engineering-calculators.js
// ══════════════════════════════════════════════════════════════════════════════

// ELECTRICAL ENGINEERING CALCULATORS — Ohm, Cable, Motor, VD, etc.
// ================================================================

/**
 * /api/calculate.js  — Vercel Serverless Function
 * Handles all secure electrical engineering calculations.
 * Called by the client-side index.html via POST /api/calculate
 *
 * Body: { calc: "<name>", inputs: { ...fields } }
 * Response: { ok: true, results: { ...outputs } }  |  { ok: false, error: "..." }
 */

// ─── tiny helpers (same logic as the original HTML) ─────────────────────────
const elec_fN = (v, d) => (v !== null && v !== undefined && isFinite(v) ? +v.toFixed(d) : null);
const consistent = (a, b, ratio) => Math.abs(ratio - 1) < 0.02;

// Lookup: cable reactance by voltage level
// Keys match the HTML <select> option values exactly (cbVLevel / vdVLevel)
const CABLE_X_TABLE = {
  lv_trefoil: { x: 0.080e-3, label: "LV Trefoil/touching ≤1 kV",      note: "0.08 mΩ/m typical — IEC 60228. ±15% vs actual datasheet." },
  lv_flat:    { x: 0.100e-3, label: "LV Flat formation ≤1 kV",         note: "0.10 mΩ/m — flat-laid LV cables. Verify with manufacturer." },
  mv_close:   { x: 0.100e-3, label: "MV touching trefoil 1–36 kV",     note: "0.10 mΩ/m — ⚠ Use manufacturer datasheet for MV project work." },
  mv_1d:      { x: 0.130e-3, label: "MV spacing 1× dia. 1–36 kV",      note: "0.13 mΩ/m — ⚠ Verify with manufacturer data." },
  mv_2d:      { x: 0.170e-3, label: "MV spacing 2× dia. 1–36 kV",      note: "0.17 mΩ/m — ⚠ ±30–50% error possible. Use datasheet." },
  mv_3d:      { x: 0.200e-3, label: "MV spacing 3× dia. 1–36 kV",      note: "0.20 mΩ/m — ⚠ Broad estimate. Datasheet required." },
  hv:         { x: 0.300e-3, label: "HV XLPE >33 kV",                  note: "⛔ HV: estimate only. Use IEC 60287 software for design." },
};
function getCableX(vLevel) {
  return CABLE_X_TABLE[vLevel] || CABLE_X_TABLE["lv_trefoil"];
}

// Standard breaker sizes
const BRK_STD = [6,10,13,16,20,25,32,40,50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3200,4000];
function nextBrk(i) { return BRK_STD.find(b => b >= i) || Math.ceil(i); }

// ─── Calculator implementations ─────────────────────────────────────────────

function calcOhm({ V, I, R, P, oRs, oRp }) {
  // Parse inputs — treat empty/undefined as NaN, allow 0 for R (short circuit)
  let v = parseFloat(V), i = parseFloat(I), r = parseFloat(R), p = parseFloat(P);

  // Validate ranges for filled fields
  if (isFinite(v) && v < 0)  return { error: "Voltage V must be ≥ 0." };
  if (isFinite(i) && i < 0)  return { error: "Current I must be ≥ 0." };
  if (isFinite(r) && r < 0)  return { error: "Resistance R must be ≥ 0 (use 0 for short circuit)." };
  if (isFinite(p) && p < 0)  return { error: "Power P must be ≥ 0." };

  // Count defined (non-NaN, non-negative) inputs — include R=0
  const defined = [v, i, r, p].filter(x => isFinite(x) && x >= 0).length;
  if (defined < 2) return { error: "Enter at least 2 values (V, I, R, or P)." };

  // Overdetermined: 3+ fields — check mutual consistency (2% tolerance)
  if (defined > 2) {
    const tol = 0.02;
    const ok = (a, b) => b === 0 ? a === 0 : Math.abs(a / b - 1) < tol;
    const errs = [];
    if (isFinite(v) && isFinite(i) && isFinite(r)) {
      if (!ok(v, i * r)) errs.push("V ≠ I×R");
    }
    if (isFinite(v) && isFinite(i) && isFinite(p)) {
      if (!ok(p, v * i)) errs.push("P ≠ V×I");
    }
    if (isFinite(v) && isFinite(r) && isFinite(p) && r > 0) {
      if (!ok(p, v * v / r)) errs.push("P ≠ V²/R");
    }
    if (isFinite(i) && isFinite(r) && isFinite(p)) {
      if (!ok(p, i * i * r)) errs.push("P ≠ I²×R");
    }
    if (errs.length) return { error: "Overdetermined: " + errs.join(", ") + " (±2% tolerance). Clear one field." };
  }

  // Solve — pick first valid pair (handle R=0 for short-circuit)
  if (isFinite(v) && isFinite(i) && v >= 0 && i >= 0)          { r = i > 0 ? v / i : 0; p = v * i; }
  else if (isFinite(v) && isFinite(r) && v >= 0 && r > 0)      { i = v / r;              p = v * i; }
  else if (isFinite(i) && isFinite(r) && i >= 0 && r >= 0)     { v = i * r;              p = v * i; }
  else if (isFinite(r) && isFinite(p) && r > 0 && p >= 0)      { v = Math.sqrt(p * r);   i = v / r; }
  else if (isFinite(v) && isFinite(p) && v > 0 && p >= 0)      { i = p / v;              r = v / i; }
  else if (isFinite(i) && isFinite(p) && i > 0 && p >= 0)      { v = p / i;              r = v / i; }

  // Float guard: round to 10 sig-figs to kill floating-point noise
  const r10 = x => parseFloat(x.toPrecision(10));
  if (isFinite(v)) v = r10(v); if (isFinite(i)) i = r10(i);
  if (isFinite(r)) r = r10(r); if (isFinite(p)) p = r10(p);

  const G = (isFinite(r) && r > 0) ? 1 / r : null;
  const Ekwh = isFinite(p) ? p / 1000 : null;

  // Series / parallel resistor networks
  const parseList = str => (str || "").split(",").map(s => parseFloat(s.trim())).filter(x => isFinite(x) && x >= 0);
  const sr = parseList(oRs), pr = parseList(oRp);
  const Rs = sr.length ? parseFloat(sr.reduce((a, b) => a + b, 0).toPrecision(10)) : null;
  // Parallel: zero-resistance in parallel short-circuits the network → result = 0
  const hasZero = pr.some(x => x === 0);
  const Rp = pr.length ? (hasZero ? 0 : parseFloat((1 / pr.reduce((a, b) => a + 1 / b, 0)).toPrecision(10))) : null;

  return { V: elec_fN(v,4), I: elec_fN(i,6), R: elec_fN(r,6), P: elec_fN(p,4), G: elec_fN(G,6), Ekwh: elec_fN(Ekwh,6), Rs: elec_fN(Rs,4), Rp: elec_fN(Rp,4) };
}

function calcPower({ phase, VL, IL, PF, eff, loadType, hr, rate }) {
  phase = parseInt(phase) || 1;
  VL = parseFloat(VL); IL = parseFloat(IL); PF = parseFloat(PF);
  eff = parseFloat(eff); hr = parseFloat(hr) || 8760; rate = parseFloat(rate) || 0;
  if (!(VL > 0 && IL > 0 && PF > 0 && PF <= 1 && eff > 0 && eff <= 1))
    return { error: "Invalid inputs — check V, I, PF (0–1), efficiency (0–1)." };

  const S = phase === 3 ? Math.sqrt(3) * VL * IL : VL * IL;
  const Vphi = phase === 3 ? VL / Math.sqrt(3) : VL;
  const P = S * PF;
  const sinPhi = Math.sqrt(Math.max(0, 1 - PF * PF));
  const Q = S * sinPhi;
  const phi = Math.acos(Math.min(1, Math.max(-1, PF)));
  const Pin = P / eff;
  const phi2 = Math.acos(0.95);
  const Qc_var = P * (Math.tan(phi) - Math.tan(phi2));
  const energy = P * hr / 1000;
  const cost = energy * rate;

  return {
    S: elec_fN(S, 2), P: elec_fN(P, 2), Q: elec_fN(Q, 2),
    phi_deg: elec_fN(phi * 180 / Math.PI, 2),
    Vphi: elec_fN(Vphi, 2),
    Pin: elec_fN(Pin, 2),
    Qc_kvar: elec_fN(Math.max(0, Qc_var / 1000), 3),
    energy_kwh: elec_fN(energy, 1),
    cost: elec_fN(cost, 2),
    harmonic_warn: (Math.max(0, Qc_var / 1000) > 0 && PF < 0.85),
  };
}

function calcCable({ phase, I, V, L_m, PF, area_mm2, VDmax_pct, T_op, kT, kG, kI, material, vLevel }) {
  phase = parseInt(phase) || 3;
  I = parseFloat(I); V = parseFloat(V); L_m = parseFloat(L_m);
  PF = parseFloat(PF); area_mm2 = parseFloat(area_mm2);
  VDmax_pct = parseFloat(VDmax_pct) || 5;
  T_op = parseFloat(T_op) || 30;
  kT = parseFloat(kT) || 0.87; kG = parseFloat(kG) || 1.0; kI = parseFloat(kI) || 1.0;

  if (!(I > 0 && V > 0 && L_m > 0 && PF > 0 && PF <= 1 && area_mm2 > 0))
    return { error: "Invalid inputs." };

  const rho20 = material === "al" ? 2.82e-8 : 1.72e-8;
  const alpha = material === "al" ? 0.00403 : 0.00393;
  const rho_T = rho20 * (1 + alpha * (T_op - 20));
  const rm = rho_T * 1e6;  // Ω·mm²/m

  const cxData = getCableX(vLevel || "lv_trefoil");
  const X_mpm = cxData.x;

  const sinPF = Math.sqrt(Math.max(0, 1 - PF * PF));
  const Rc = rm * L_m / area_mm2;
  const Xc = X_mpm * L_m;
  const mult = phase === 3 ? Math.sqrt(3) : 2;
  const VD = mult * I * (Rc * PF + Xc * sinPF);
  const VD_pct = (VD / V) * 100;
  const VDmax = V * VDmax_pct / 100;
  const Amin = rm * mult * L_m * I * PF / VDmax;
  const loss = I * I * Rc * (phase === 3 ? 3 : 2);
  const kTotal = kT * kG * kI;
  const dens = I / area_mm2;
  const Rpkm = rm * 1000 / area_mm2;

  return {
    Rc: elec_fN(Rc, 6), Xc: elec_fN(Xc, 6),
    VD: elec_fN(VD, 3), VD_pct: elec_fN(VD_pct, 2),
    within_limit: VD_pct <= VDmax_pct,
    Amin: elec_fN(Amin, 2), loss_W: elec_fN(loss, 1),
    kTotal: elec_fN(kTotal, 4), dens: elec_fN(dens, 4), Rpkm: elec_fN(Rpkm, 4),
    X_mpm_mohm: elec_fN(X_mpm * 1e3, 3), cxLabel: cxData.label,
    skin_warn: area_mm2 > 150,
    long_cable_warn: L_m > 500,
    high_temp_warn: T_op > 90,
  };
}

function calcVD({ phase, V, I, L_m, area_mm2, PF, material, vLevel }) {
  phase = parseInt(phase) || 3;
  V = parseFloat(V); I = parseFloat(I); L_m = parseFloat(L_m);
  area_mm2 = parseFloat(area_mm2); PF = parseFloat(PF) || 0.85;

  if (!(V > 0 && I > 0 && L_m > 0 && area_mm2 > 0))
    return { error: "Invalid inputs — V, I, Length and CSA must all be > 0." };
  if (!(PF > 0 && PF <= 1))
    return { error: "Power factor must be in range (0, 1]." };

  const rho20 = material === "al" ? 2.82e-8 : 1.72e-8;
  const alpha = material === "al" ? 0.00403 : 0.00393;
  // IEC/NEC standard: use 75°C for voltage drop / protection calculations
  const T_op = 75;
  const rho_T = rho20 * (1 + alpha * (T_op - 20));
  const rm = rho_T * 1e6;  // Ω·mm²/m at 75°C
  const sinPF = Math.sqrt(Math.max(0, 1 - PF * PF));

  // Use reactance from vLevel selector (same table as cable sizing)
  const cxData = getCableX(vLevel || "lv_trefoil");
  const X_mpm = cxData.x;

  const Rc = rm * L_m / area_mm2;
  const Xc = X_mpm * L_m;
  const mult = phase === 3 ? Math.sqrt(3) : 2;
  const VD = mult * I * (Rc * PF + Xc * sinPF);
  const VD_pct = (VD / V) * 100;
  const VDmax_pct = 5;
  const Amin = rm * mult * L_m * I * PF / (V * VDmax_pct / 100);
  const loss = I * I * Rc * (phase === 3 ? 3 : 2);
  const brkRule = 1.25;
  const brk = nextBrk(I * brkRule);
  const dens = I / area_mm2;

  return {
    VD: elec_fN(VD, 4), VD_pct: elec_fN(VD_pct, 4),
    within_5pct: VD_pct <= 5,
    end_voltage: elec_fN(V - VD, 2),
    loss_W: elec_fN(loss, 2), Amin: elec_fN(Amin, 2),
    Rc: elec_fN(Rc, 6), Xc: elec_fN(Xc, 6),
    X_mpm_mohm: elec_fN(X_mpm * 1e3, 3),
    dens: elec_fN(dens, 4), brk,
  };
}

function calcMotor({ Pkw, V, PF, eff, n, phase, poles, freq, SF, start, brkRule, ISM }) {
  Pkw = parseFloat(Pkw); V = parseFloat(V); PF = parseFloat(PF);
  eff = parseFloat(eff); n = parseFloat(n) || 1480; phase = parseInt(phase) || 3;
  poles = parseInt(poles) || 4; freq = parseFloat(freq) || 50;
  SF = parseFloat(SF) || 1.0;
  // brkRule: 1.25 = 125% FLC (IEC standard), 2.5 = 250% for DOL inverse-time (NEC 430.52)
  brkRule = parseFloat(brkRule) || 1.25;
  // ISM: locked-rotor current multiplier from motor nameplate (IEC 60034, typically 5–8)
  ISM = parseFloat(ISM) || 6;

  if (!(Pkw > 0 && V > 0 && PF > 0 && PF <= 1 && eff > 0 && eff <= 1))
    return { error: "Invalid motor parameters — check kW, V, PF (0–1), efficiency (0–1)." };
  if (n <= 0) return { error: "Rated speed must be > 0 RPM." };

  const Pout = Pkw * 1000;           // shaft output in Watts
  const Pin  = Pout / eff;           // electrical input in Watts
  // IL = Pin / (sqrt(3)*V*PF) for 3-phase, Pin/(V*PF) for 1-phase
  const IL   = phase === 3 ? Pin / (Math.sqrt(3) * V * PF) : Pin / (V * PF);
  const IL_SF = IL * SF;
  // S = sqrt(3)*V*IL for 3-phase  (derived from IL above, not redundant formula)
  const S    = phase === 3 ? Math.sqrt(3) * V * IL : V * IL;
  // Torque from SHAFT power (not Pin) — prevents overestimation
  const T    = Pout / (2 * Math.PI * n / 60);
  const Ns   = 60 * freq / (poles / 2);
  const slip = ((Ns - n) / Ns) * 100;
  const Q    = S * Math.sqrt(Math.max(0, 1 - PF * PF));

  // Starting current & torque by method
  // Note: HTML option value is "sd" for Star-Delta (not "star_delta")
  let Is, Ts, note;
  if (start === "dol") {
    Is = ISM * IL;
    Ts = 150;
    note = `DOL: Is = ${ISM}×IL (nameplate ISM = ${ISM})`;
  } else if (start === "sd") {
    // Y-Δ reduces both voltage and current by 1/√3 → current reduces to 1/3
    Is = ISM * IL / 3;
    Ts = 50;   // 50% of rated torque (= DOL torque / 3, assuming DOL ≈ 150% rated)
    note = `Y-Δ: Is = ISM×IL/3 = ${(ISM/3).toFixed(2)}×IL. ⚠ Load torque must be < 33% rated at switchover.`;
  } else if (start === "autotx") {
    // Auto-transformer (65% tap): voltage ratio 0.65 → current ratio 0.65² ≈ 0.42×
    Is = ISM * IL * 0.42;
    Ts = 42;
    note = `Auto-transformer (65% tap): Is ≈ 0.42×DOL = ${(ISM*0.42).toFixed(2)}×IL`;
  } else if (start === "softstarter") {
    Is = 2.5 * IL;
    Ts = 100;
    note = "Soft starter: Is ≈ 2–3×IL (ramp limited).";
  } else {
    // VFD
    Is = 1.0 * IL;
    Ts = 150;
    note = "VFD: Is ≈ 1.0×IL (current-limited by drive). Consult VFD commissioning data.";
  }

  const brk = nextBrk(IL_SF * brkRule);

  return {
    IL: elec_fN(IL, 3), IL_SF: elec_fN(IL_SF, 3), SF,
    Pin_W: elec_fN(Pin, 2), S_VA: elec_fN(S, 2),
    T_Nm: elec_fN(T, 2), Ns: elec_fN(Ns, 0), slip_pct: elec_fN(slip, 2),
    Is: elec_fN(Is, 2), Ts_pct: Ts, Q_VAr: elec_fN(Q, 2),
    start_note: note, brkRule, brk,
  };
}

function calcXfmr({ kVA, V1, V2, PF, xLoad_pct, Pfe, Pcu, Zpct, Rpct, pfType }) {
  kVA = parseFloat(kVA); V1 = parseFloat(V1); V2 = parseFloat(V2);
  PF = parseFloat(PF) || 0.8; xLoad_pct = parseFloat(xLoad_pct) || 100;
  Pfe = parseFloat(Pfe) || 1000; Pcu = parseFloat(Pcu) || 3000;
  Zpct = parseFloat(Zpct) || 4; Rpct = parseFloat(Rpct) || 1;

  if (!(kVA > 0 && V1 > 0 && V2 > 0)) return { error: "kVA and voltages must be > 0." };
  if (!(PF > 0 && PF <= 1)) return { error: "PF must be in (0,1]." };

  const xL = xLoad_pct / 100;
  const Xpct = Math.sqrt(Math.max(0, Zpct * Zpct - Rpct * Rpct));
  const a = V1 / V2;
  const I1 = kVA * 1000 / V1;
  const I2 = kVA * 1000 / V2;
  const Pout_W = xL * kVA * 1000 * PF;
  const CuL = xL * xL * Pcu;
  const eff = Pout_W > 0 ? Pout_W / (Pout_W + Pfe + CuL) * 100 : 0;
  const sinp = Math.sqrt(Math.max(0, 1 - PF * PF));
  const VR = Rpct * PF + (pfType === "lead" ? -1 : 1) * Xpct * sinp;
  const xmaxE = Math.sqrt(Pfe / Math.max(1, Pcu));
  const Isc = I1 / (Math.max(0.01, Zpct) / 100);

  return {
    a: elec_fN(a, 5), Xpct: elec_fN(Xpct, 3),
    I1: elec_fN(I1, 3), I2: elec_fN(I2, 3),
    eff: elec_fN(eff, 3), VR: elec_fN(VR, 3),
    maxEff_pct_kva: elec_fN(xmaxE * 100, 2),
    Isc: elec_fN(Isc, 3),
    CuL_W: elec_fN(CuL, 1), Pout_W: elec_fN(Pout_W, 1),
  };
}

function calcCap({ Cu, Lm, R, V, f }) {
  Cu = parseFloat(Cu); Lm = parseFloat(Lm);
  R = parseFloat(R); V = parseFloat(V); f = parseFloat(f) || 50;

  const C = (Cu > 0) ? Cu * 1e-6 : NaN;
  const L = (Lm > 0) ? Lm * 1e-3 : NaN;
  const w = 2 * Math.PI * f;

  const Xc = (isFinite(C) && C > 0 && f > 0) ? 1 / (w * C) : null;
  const XL  = (isFinite(L) && L > 0 && f > 0) ? w * L       : null;
  const f0  = (isFinite(L) && isFinite(C) && L > 0 && C > 0) ? 1 / (2 * Math.PI * Math.sqrt(L * C)) : null;
  const w0  = f0 ? 1 / Math.sqrt(L * C) : null;
  const Ecap = (isFinite(C) && C > 0 && isFinite(V)) ? 0.5 * C * V * V : null;
  const Qch  = (isFinite(C) && C > 0 && isFinite(V)) ? C * V : null;
  const tau  = (isFinite(R) && R > 0 && isFinite(C) && C > 0) ? R * C : null;
  const Z = (isFinite(R) && R > 0 && Xc != null && XL != null)
    ? Math.sqrt(R * R + Math.pow(XL - Xc, 2)) : null;
  const Ic = (Xc != null && Xc > 0 && isFinite(V)) ? V / Xc : null;
  const Qf_series = (isFinite(R) && R > 0 && isFinite(L) && L > 0 && isFinite(C) && C > 0)
    ? (1 / R) * Math.sqrt(L / C) : null;

  return {
    Xc: elec_fN(Xc, 4), XL: elec_fN(XL, 4),
    Ecap_mJ: elec_fN(Ecap != null ? Ecap * 1000 : null, 4),
    Qch_mC: elec_fN(Qch != null ? Qch * 1000 : null, 4),
    f0: elec_fN(f0, 3), w0: elec_fN(w0, 2),
    tau_ms: elec_fN(tau != null ? tau * 1000 : null, 4),
    Qf_series: elec_fN(Qf_series, 4),
    Z: elec_fN(Z, 4), Ic: elec_fN(Ic, 5),
  };
}

function calcFault({ gridMVA, xkVA, xZpct, xRpct, CL_m, CA_mm2, LV, fltMat, motKVA }) {
  // Note: Vn_kV (HV nominal voltage) was previously accepted but unused.
  // All calculations use LV (low-voltage bus voltage) as the reference.
  gridMVA = parseFloat(gridMVA);
  xkVA   = parseFloat(xkVA);   xZpct = parseFloat(xZpct) || 4; xRpct = parseFloat(xRpct) || 1;
  CL_m   = parseFloat(CL_m)   || 10; CA_mm2 = parseFloat(CA_mm2) || 50;
  LV     = parseFloat(LV)     || 415; motKVA = parseFloat(motKVA) || 0;

  if (!(LV > 0 && xkVA > 0 && gridMVA > 0 && CA_mm2 > 0 && CL_m >= 0))
    return { error: "LV voltage, transformer kVA, grid MVA, and cable CSA must all be > 0." };
  if (xRpct > xZpct)
    return { error: `%R (${xRpct}%) cannot exceed %Z (${xZpct}%). Check transformer nameplate.` };

  const rho = fltMat === "al" ? 2.82e-8 : 1.72e-8;
  // IEC 60909 §2.3: cable resistance at 20°C for maximum fault current calculation
  const rm = rho * 1e6;  // Ω·mm²/m at 20°C

  // IEC 60909 §4.3: voltage factor c = 1.05 for maximum fault current at LV systems ≤ 1 kV
  const c = 1.05;

  // Per-unit base on transformer kVA (LV side)
  const Sbase = xkVA * 1000;
  const Zbase = LV * LV / Sbase;  // Ω

  // Grid source impedance referred to LV side: Zq = Zbase * (Sbase / Skq)
  // Equivalent to: LV² / (gridMVA × 1e6) — transformer MVA base cancels
  const Zgrid_mag = LV * LV / (gridMVA * 1e6);
  const XR_grid = 10;  // typical X/R for HV grid sources (IEC 60909 Table 3)
  const Rgrid = Zgrid_mag / Math.sqrt(1 + XR_grid * XR_grid);
  const Xgrid = XR_grid * Rgrid;

  // Transformer impedance components from %Z and %R
  const Zpct   = xZpct;
  const Rpct_x = Math.min(xRpct, xZpct);  // guard: R% ≤ Z%
  const Xpct_x = Math.sqrt(Math.max(0, Zpct * Zpct - Rpct_x * Rpct_x));
  const Zxfmr_mag = (Zpct   / 100) * Zbase;
  const Rxfmr     = (Rpct_x / 100) * Zbase;
  const Xxfmr     = (Xpct_x / 100) * Zbase;
  const XR_xfmr   = Xxfmr > 0 ? Xxfmr / Math.max(Rxfmr, 1e-9) : 5;

  // Cable impedance (positive sequence, conductor at 20°C per IEC 60909 for max fault)
  const Rcable = rm * CL_m / CA_mm2;
  const Xcable = 0.08e-3 * CL_m;  // ≈ 0.08 mΩ/m typical LV XLPE

  // Total positive-sequence impedance
  const Rtot = Rgrid + Rxfmr + Rcable;
  const Xtot = Xgrid + Xxfmr + Xcable;
  const Ztot = Math.sqrt(Rtot * Rtot + Xtot * Xtot);
  if (Ztot === 0) return { error: "Total impedance is zero — check inputs." };
  const XR_total = Xtot / Math.max(Rtot, 1e-12);

  // IEC 60909 §4.2: symmetrical 3-phase fault current
  const Isc3 = c * LV / (Math.sqrt(3) * Ztot);

  // Phase-phase fault: Isc2 = (√3/2) × Isc3 ≈ 0.866 × Isc3
  const Isc2 = Isc3 * Math.sqrt(3) / 2;

  // 1-phase fault: requires Z0 (zero-sequence). Using Isc1 ≈ 0.85×Isc3 as approximation.
  // For accurate Isc1, zero-sequence impedance data is required.
  const Isc1 = Isc3 * 0.85;

  // IEC 60909 §4.7: peak asymmetrical current — κ factor
  const kappa = 1.02 + 0.98 * Math.exp(-3 / XR_total);
  const Ip = kappa * Math.sqrt(2) * Isc3;

  // IEC 60909 §3.10: motor back-EMF contribution (conservative: 6× FLC)
  const Imot = motKVA > 0 ? (motKVA * 1000 / (Math.sqrt(3) * LV)) * 6 : 0;
  const Isc3_total = Isc3 + Imot;

  const fMVA = Math.sqrt(3) * LV * Isc3 / 1e6;

  // IEC standard breaker kA ratings
  const kA_std = [6, 10, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 150, 200];
  const brkKA = kA_std.find(k => k >= Ip / 1000) || Math.ceil(Ip / 1000);

  return {
    Isc3: elec_fN(Isc3, 1), Isc2: elec_fN(Isc2, 1),
    Isc1: elec_fN(Isc1, 1), Isc1_note: "Approximate (Isc1 = 0.85×Isc3). Accurate value requires Z0 data.",
    Ip: elec_fN(Ip, 1), kappa: elec_fN(kappa, 4),
    Imot: elec_fN(Imot, 1), Isc3_total: elec_fN(Isc3_total, 1),
    fMVA: elec_fN(fMVA, 4), Ztot: elec_fN(Ztot, 6),
    Zgrid_mag: elec_fN(Zgrid_mag, 6), Zxfmr_mag: elec_fN(Zxfmr_mag, 6),
    Rcable: elec_fN(Rcable, 6), Xcable: elec_fN(Xcable, 6),
    XR_total: elec_fN(XR_total, 2), brkKA,
    c_factor: 1.05,
  };
}

function calcIllum({ L_m, W_m, H_m, WH_m, E_target, F_lm, Pw, MF, UF }) {
  L_m = parseFloat(L_m); W_m = parseFloat(W_m);
  H_m = parseFloat(H_m); WH_m = parseFloat(WH_m) || 0.85;
  E_target = parseFloat(E_target) || 500;
  F_lm = parseFloat(F_lm) || 4000;
  Pw = parseFloat(Pw) || 36;
  MF = parseFloat(MF) || 0.8; UF = parseFloat(UF) || 0.6;

  if (!(L_m > 0 && W_m > 0 && H_m > 0))
    return { error: "Room dimensions (L, W, H) must all be > 0." };
  if (E_target <= 0) return { error: "Target illuminance must be > 0 lux." };
  if (F_lm <= 0)     return { error: "Lumens per fitting must be > 0." };
  if (!(MF > 0 && MF <= 1)) return { error: "Maintenance Factor MF must be in (0, 1]." };
  if (!(UF > 0 && UF <= 1)) return { error: "Utilisation Factor UF must be in (0, 1]." };

  // Mounting height above working plane
  const Hm = H_m - WH_m;
  if (Hm <= 0) return { error: `Mounting height Hm = H − WH = ${H_m} − ${WH_m} = ${Hm.toFixed(2)} m. Hm must be > 0. Reduce working height or increase mounting height.` };

  const A = L_m * W_m;
  const RI = A / (Hm * (L_m + W_m));
  const N = Math.ceil(E_target * A / (F_lm * MF * UF));
  if (N <= 0) return { error: "Calculated luminaire count is 0 — check input values." };

  const Ea = N * F_lm * MF * UF / A;
  const Wtot = N * Pw;
  const Wdens = Wtot / A;

  // Find grid layout with aspect ratio closest to room aspect ratio
  let br = 1, bc = N, ba = Infinity;
  for (let rr = 1; rr <= N; rr++) {
    const cc = Math.ceil(N / rr);
    const asp = Math.abs(L_m / cc - W_m / rr);
    if (asp < ba) { ba = asp; br = rr; bc = cc; }
  }
  const Sl = L_m / bc, Sw = W_m / br;

  return {
    N, RI: elec_fN(RI, 3), Hm: elec_fN(Hm, 2), Ea: elec_fN(Ea, 1),
    target_met: Ea >= E_target,
    Wtot: elec_fN(Wtot, 0), Wdens: elec_fN(Wdens, 2),
    A: elec_fN(A, 1), grid: `${br} rows × ${bc} cols`,
    Sl: elec_fN(Sl, 2), Sw: elec_fN(Sw, 2),
  };
}

function calcHVTest({ Uo, U, L_m, T_deg, method, cond, insType, sheathType }) {
  Uo = parseFloat(Uo) || 6; U = parseFloat(U) || 10;
  L_m = parseFloat(L_m) || 100; T_deg = parseFloat(T_deg) || 20;

  let testV = 0, dur = "", std = "", pass = "", warnMsg = "";
  const isXLPE = insType === "xlpe";
  const isPILC = insType === "pil";

  if (method === "ac_site") {
    if (cond === "new")       { testV = 2 * Uo;    dur = "60 min"; }
    else if (cond === "maint") { testV = 1.5 * Uo;  dur = "30 min"; }
    else if (cond === "repair"){ testV = 1.73 * Uo; dur = "60 min"; }
    else                       { testV = 2.5 * Uo;  dur = "60 min (factory acceptance)"; }
    std  = "IEC 60502-4 / IEC 60840 (AC site test)";
    pass = "No breakdown or disruptive discharge. Leakage current stable.";
  } else if (method === "ac_factory") {
    testV = (isXLPE ? 2.5 : 2) * Uo;
    if (insType === "pvc") testV = 2 * Uo;
    dur  = "5 min (routine); longer for type test";
    std  = "IEC 60502-2 / IEC 60840 (factory AC)";
    pass = "No puncture or surface tracking. PD within limit.";
  } else if (method === "dc_site") {
    if (isXLPE) warnMsg = "DC NOT recommended for XLPE — creates space charge causing delayed failures. Use VLF instead.";
    testV = (isPILC ? 3.5 : 3) * Uo;
    if (cond === "maint") testV = 2.5 * Uo;
    dur  = "15 min (legacy)";
    std  = "IEEE 400 (DC — legacy method)";
    pass = "Leakage current ≤ manufacturer limit. No breakdown.";
  } else if (method === "vlf") {
    testV = (cond === "maint" ? 1.5 : cond === "new" ? 2 : 1.73) * Uo;
    dur  = "60 min (new/repair); 30 min (maintenance)";
    std  = "IEEE 400.2 / HD 620 (VLF 0.1 Hz)";
    pass = "No breakdown. tanδ < 4×10⁻³ indicates good insulation.";
    if (!isXLPE) warnMsg = "VLF optimised for XLPE/EPR. For PILC, AC or DC per IEC 60502 more traditional.";
  } else {
    dur  = "1–10 min (DAR / Polarisation Index)";
    std  = "IEEE 43 / IEC — Insulation Resistance Test";
    pass = "PI = IR_10min/IR_1min > 2 good; < 1 suspect.";
  }

  const lenKm = Math.max(L_m / 1000, 0.01);
  const irMin = ((Uo + 1) * lenKm).toFixed(2);
  const irAtT = (parseFloat(irMin) * Math.pow(0.5, (T_deg - 20) / 10)).toFixed(2);

  let sheathTxt = "Not required";
  if (sheathType === "pvc_outer") sheathTxt = "DC 10 kV / 1 min — outer sheath to earth. No breakdown.";
  else if (sheathType === "pe_outer") sheathTxt = "DC 25 kV / 1 min — outer sheath to earth. No breakdown.";

  if (!warnMsg) warnMsg = "HV testing is life-threatening — authorised personnel only. Maintain exclusion zone, earth all conductors before connecting. Discharge cable after every test.";

  return {
    testV: testV > 0 ? elec_fN(testV, 2) : null,
    dur, std, pass,
    sheathTest: sheathTxt,
    ir_min_MOhm: irMin, ir_at_temp_MOhm: irAtT,
    warn: warnMsg,
  };
}

// ========================================================================
// SECTION: ELECTRICAL
// ========================================================================

async function handle_electrical(body, res) {
  const ELEC_CALCS = {
    ohm:    calcOhm,
    power:  calcPower,
    cable:  calcCable,
    vd:     calcVD,
    motor:  calcMotor,
    xfmr:   calcXfmr,
    cap:    calcCap,
    fault:  calcFault,
    illum:  calcIllum,
    hvtest: calcHVTest,
  };
  const { calc, inputs } = body || {};
  const fn = ELEC_CALCS[calc];
  if (!fn) return res.status(400).json({ ok: false, error: `Unknown calculator: "${calc}"` });
  try {
    const results = fn(inputs || {});
    if (results && results.error) return res.status(200).json({ ok: false, error: results.error });
    return res.status(200).json({ ok: true, results });
  } catch(err) {
    return res.status(200).json({ ok: false, error: 'Calculation failed: ' + err.message });
  }
}



// ================================================================

// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — dispatches to handle_electrical
// ════════════════════════════════════════════════════════════════════════════
async function electrical_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? req.body : {};
  if (req.method === 'POST' && (!body || typeof body !== 'object'))
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_electrical(body, res);
  } catch (e) {
    console.error('[electrical-engineering-calculators.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 19: Electrical Engineering Calculators ──────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION D  ►  MECHANICAL ENGINEERING CALCULATORS
// Route: /api/mechanical-engineering-calculators
// (Original: SECTION 20 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 20 of 21  ►  MECHANICAL ENGINEERING CALCULATORS
// Route: /api/mechanical-engineering-calculators
// Source: mechanical-engineering-calculators.js
// ══════════════════════════════════════════════════════════════════════════════

// MECHANICAL ENGINEERING CALCULATORS
// Route: POST /api/mechanical-engineering-calculators
// Body:  { calculator: string, inputs: object }
// Response: { ok: boolean, results: object }
// ================================================================

// ── Protected lookup tables ──────────────────────────────────────

const MECH_MAT = {
  shaft: {
    'c45':       { Sy: 390e6, Su: 620e6,  E: 200e9, rho: 7850 },
    '4140':      { Sy: 655e6, Su: 1020e6, E: 200e9, rho: 7850 },
    'stainless': { Sy: 207e6, Su: 517e6,  E: 193e9, rho: 7960 },
  },
  spring: {
    'steel-hard': { G: 79000, Ssy: 700 },
    'steel-ht':   { G: 79000, Ssy: 550 },
    'ss302':      { G: 69000, Ssy: 480 },
    'chrome-si':  { G: 77200, Ssy: 750 },
  },
  sheet: {
    'ms':     { K: 0.44, Sy: 250, E: 200, Rmin_factor: 0.5 },
    'ss304':  { K: 0.44, Sy: 310, E: 193, Rmin_factor: 1.0 },
    'alum':   { K: 0.40, Sy: 193, E: 70,  Rmin_factor: 4.0 },
    'copper': { K: 0.44, Sy: 210, E: 117, Rmin_factor: 1.0 },
    'galv':   { K: 0.44, Sy: 280, E: 200, Rmin_factor: 0.5 },
  },
  gear: {
    'steel-ht':   { Sall: 200 },
    'steel-soft': { Sall: 83  },
    'ci':         { Sall: 50  },
    'bronze':     { Sall: 40  },
  },
  pvessel: {
    'cs':    { S: 138 },
    'ss':    { S: 138 },
    'ss316': { S: 115 },
  },
  liquid: {
    water: 1000, diesel: 840, petrol: 720,
    lpg: 488, acid: 1840, caustic: 1530,
  },
  cncKc: {
    'mild-steel': 1500, 'alloy-steel': 2200, 'ss': 2500,
    'alum': 700, 'cast-iron': 1100, 'copper': 900, 'titanium': 3000,
  },
  cncVc: {
    'mild-steel': 200, 'alloy-steel': 150, 'ss': 120,
    'alum': 600, 'cast-iron': 180, 'copper': 300, 'titanium': 50,
  },
  fastener: {
    '4.6':  { Sy: 240 }, '8.8': { Sy: 660 },
    '10.9': { Sy: 940 }, '12.9': { Sy: 1100 }, 'A2-70': { Sy: 450 },
  },
  gasket: {
    swg:    { m: 3.0,  y: 69  },
    rtj:    { m: 6.5,  y: 179 },
    flat:   { m: 4.75, y: 62  },
    rubber: { m: 0.5,  y: 0   },
  },
  bolt: {
    '800':  { Sy: 724, Su: 862  },
    '8.8':  { Sy: 660, Su: 800  },
    '10.9': { Sy: 940, Su: 1040 },
  },
  beam: {
    'steel':  { E: 200, Fy: 250, rho: 7850 },
    'alum':   { E: 69,  Fy: 276, rho: 2700 },
    'timber': { E: 12,  Fy: 30,  rho: 500  },
    'conc':   { E: 30,  Fy: 25,  rho: 2400 },
  },
};

// AGMA Lewis Y form factor — interpolated, AGMA 908-B89 (server-side only)
function mech_lewisY(z) {
  const T = [
    [12,0.245],[13,0.261],[14,0.277],[15,0.290],[16,0.296],[17,0.303],
    [18,0.309],[19,0.314],[20,0.322],[22,0.331],[24,0.337],[26,0.346],
    [28,0.353],[30,0.359],[34,0.371],[38,0.384],[43,0.397],[50,0.409],
    [60,0.422],[75,0.435],[100,0.447],[150,0.460],[300,0.472],[400,0.480],
  ];
  if (z <= 0) return 0.245;
  for (let i = T.length - 1; i >= 0; i--) {
    if (z >= T[i][0]) {
      if (i === T.length - 1) return T[i][1];
      return T[i][1] + (T[i+1][1] - T[i][1]) * (z - T[i][0]) / (T[i+1][0] - T[i][0]);
    }
  }
  return 0.245;
}

// ISO metric coarse pitch (server-side only)
function mech_isoPitch(d) {
  if (d <= 6) return 1.0; if (d <= 8) return 1.25; if (d <= 10) return 1.5;
  if (d <= 12) return 1.75; if (d <= 16) return 2.0; if (d <= 20) return 2.5;
  if (d <= 24) return 3.0; return 3.5;
}

// AWS D1.1 Table 5.8 minimum fillet weld size
function mech_awsMinWeld(leg) {
  if (leg <= 6) return 3; if (leg <= 12) return 5; if (leg <= 19) return 6; return 8;
}

// Standard rolled section library (I mm⁴, Z mm³, A mm²) — server-side only
const MECH_SECTIONS = {
  'HEA100': { I: 3490000,   Z: 72760,  A: 2124 },
  'HEA140': { I: 10330000,  Z: 173500, A: 3142 },
  'HEA180': { I: 27900000,  Z: 324000, A: 4525 },
  'HEA200': { I: 36920000,  Z: 388800, A: 5383 },
  'IPE160': { I: 8693000,   Z: 123000, A: 2009 },
  'IPE200': { I: 19430000,  Z: 194200, A: 2848 },
  'IPE240': { I: 38920000,  Z: 324300, A: 3912 },
  'IPE300': { I: 83560000,  Z: 557400, A: 5381 },
  'UB203x133x30': { I: 28500000,  Z: 279000,  A: 3820 },
  'UB305x165x54': { I: 117000000, Z: 765000,  A: 6860 },
};

// ── Calculator engines ───────────────────────────────────────────

function mech_pressureVessel(inp) {
  let { P, Pu, T_design, T_unit, D, Du, S, E, CA, type, materialKey } = inp;
  if (Pu === 'bar') P *= 0.1; else if (Pu === 'psi') P *= 0.00689476;
  const T_C = T_unit === 'F' ? (T_design - 32) * 5/9 : (T_design || 20);
  if (materialKey && MECH_MAT.pvessel[materialKey]) S = MECH_MAT.pvessel[materialKey].S;
  let R = D / 2;
  if (Du === 'in') R *= 25.4;
  if (P <= 0 || R <= 0 || S <= 0 || CA < 0) return { error: 'Invalid inputs' };
  let t_calc, formula;
  const D_inside = R * 2;
  switch (type) {
    case 'cyl':       t_calc = (P*R)/(S*E - 0.6*P);         formula = 't = P·R/(S·E−0.6P) [ASME VIII UG-27(c)(1)]'; break;
    case 'sph':       t_calc = (P*R)/(2*S*E - 0.2*P);       formula = 't = P·R/(2·S·E−0.2P) [ASME VIII UG-27(d)]'; break;
    case 'head-hemi': t_calc = (P*R)/(2*S*E - 0.2*P);       formula = 't = P·R/(2·S·E−0.2P) [ASME VIII UG-32(f)]'; break;
    case 'head-ell':  t_calc = (P*D_inside)/(2*S*E - 0.2*P);formula = 't = P·D/(2·S·E−0.2P) [ASME VIII UG-32(d)]'; break;
    default: return { error: 'Unknown vessel type' };
  }
  const t_gross   = t_calc + CA;
  const t_nominal = Math.ceil(t_gross / 0.5) * 0.5;
  const t_net     = t_nominal - CA;
  const t_min_asme = 1.5875;
  let sigma_h, sigma_l, MAWP;
  if (type === 'cyl') {
    sigma_h = P*R/t_net; sigma_l = P*R/(2*t_net); MAWP = S*E*t_net/(R + 0.6*t_net);
  } else if (type === 'head-ell') {
    sigma_h = P*D_inside/(2*t_net); sigma_l = sigma_h/2; MAWP = 2*S*E*t_net/(D_inside + 0.2*t_net);
  } else {
    sigma_h = P*R/(2*t_net); sigma_l = sigma_h; MAWP = 2*S*E*t_net/(R + 0.2*t_net);
  }
  const sf            = S*E / Math.max(sigma_h, 0.001);
  const thinWallRatio = t_nominal / R;
  const ok            = sf >= 1.0 && t_nominal >= t_min_asme;
  const tempWarning   = T_C > 300
    ? `At ${T_C.toFixed(0)}°C ASME allowable stress is significantly reduced. Verify S from ASME II-D Table 1A.`
    : T_C > 50 ? `At ${T_C.toFixed(0)}°C confirm S is the temperature-derated value from ASME II-D Table 1A.` : null;
  return {
    ok,
    t_calc:      +t_calc.toFixed(3),      t_gross:   +t_gross.toFixed(3),
    t_nominal:   +t_nominal.toFixed(1),   t_net:     +t_net.toFixed(3),
    sigma_h:     +sigma_h.toFixed(2),     sigma_l:   +sigma_l.toFixed(2),
    MAWP_bar:    +(MAWP*10).toFixed(2),   sf:        +sf.toFixed(3),
    thinWallRatio: +thinWallRatio.toFixed(3),
    thinWallOk: thinWallRatio < 0.5,
    hoopFail:   sigma_h > S*E,
    t_min_asme, formula,
    R_mm: +R.toFixed(1), P_bar: +(P*10).toFixed(2), S, E, CA, tempWarning,
  };
}

function mech_boltFlange(inp) {
  let { nb, bd, ba, T, Tu, K, gtype, gm, gy, god, gid, P, Pu, bgrade } = inp;
  if (Tu === 'lbft') T *= 1.35582;
  if (Pu === 'bar') P *= 0.1; else if (Pu === 'psi') P *= 0.00689476;
  const gp = MECH_MAT.gasket[gtype];
  if (gp) { gm = gp.m; gy = gp.y; }
  if (!ba || ba <= 0) {
    const cp = mech_isoPitch(bd);
    const d2 = bd - 0.6495*cp; const d3 = bd - 1.2269*cp;
    ba = Math.PI/4 * Math.pow((d2+d3)/2, 2);
  }
  const Fi           = T / (K * bd / 1000);
  const totalPreload = Fi * nb;
  const G            = (god + gid) / 2;
  const b            = (god - gid) / 4;
  const Agasket_eff  = Math.PI * G * b;
  const Wm1 = Math.PI*G*b*gm*P + Math.PI/4*G*G*P;
  const Wm2 = Math.PI*G*b*gy;
  const Sy_bolt  = (MECH_MAT.bolt[bgrade] || { Sy: 724 }).Sy;
  const Sall     = 0.66 * Sy_bolt;
  const boltStress = Fi / ba;
  const util     = boltStress / Sall * 100;
  const ok       = boltStress < Sall && totalPreload > Math.max(Wm1, Wm2);
  const Fi_low   = T / (0.40 * bd / 1000);
  const Fi_high  = T / (0.10 * bd / 1000);
  return {
    ok,
    Fi_kN:          +(Fi/1000).toFixed(2),
    totalPreload_kN:+(totalPreload/1000).toFixed(2),
    boltStress:     +boltStress.toFixed(1),
    Sall:           +Sall.toFixed(1),
    util:           +util.toFixed(1),
    Wm1_kN:         +(Wm1/1000).toFixed(2),
    Wm2_kN:         +(Wm2/1000).toFixed(2),
    gasketStress:   +(totalPreload/Agasket_eff).toFixed(1),
    gy, gm,
    At:             +ba.toFixed(1),
    nb, bd, T_Nm: +T.toFixed(1), K, P_bar: +(P*10).toFixed(2),
    preloadRange: {
      low_kN:  +(Fi_low  * nb / 1000).toFixed(1),
      high_kN: +(Fi_high * nb / 1000).toFixed(1),
    },
    kUncertaintyNote: `K=${K}. Typical range 0.10 (oiled)–0.40 (dry). Preload uncertainty ±~30%.`,
  };
}

function mech_weld(inp) {
  let { w, wLeg_u, Lw, wL_u, wtype, config, V, V_u, N_kN, M_kNm, FEXX, e, gw, gh } = inp;
  if (wLeg_u === 'in') w  *= 25.4;
  if (wL_u   === 'in') Lw *= 25.4;
  if (V_u    === 'N')  V  /= 1000; else if (V_u === 'kip') V *= 4.44822;
  if (w <= 0 || Lw <= 0 || FEXX <= 0) return { error: 'Invalid weld inputs' };
  let throat, throatNote;
  if      (wtype === 'fillet')    { throat = 0.707*w; throatNote = 'a = 0.707·w (45° equal-leg fillet, AWS D1.1 2.4.1)'; }
  else if (wtype === 'butt-full') { throat = w;        throatNote = 'a = w (complete joint penetration)'; }
  else                            { throat = Math.max(w-3, w*0.7); throatNote = 'a ≈ w−3mm (partial penetration, 60° bevel approx)'; }
  const allowable = 0.3 * FEXX;
  if (config === 'group-rect') {
    if (!gw || !gh || gw <= 0 || gh <= 0) return { error: 'Enter valid group dimensions' };
    const Lw_group  = 2*(gw+gh);
    const Aw        = throat * Lw_group;
    const Jw_unit   = (gw*gh*(gw*gw + gh*gh)) / 6;
    const r_max     = Math.sqrt(Math.pow(gw/2,2) + Math.pow(gh/2,2));
    const tau_V     = V*1000 / Aw;
    const sigma_N   = (N_kN||0)*1000 / Aw;
    let tau_torsion = 0, torsionNote = '';
    if (e > 0) {
      const Mt    = V*1000*e;
      tau_torsion = Mt*r_max / (throat*Jw_unit);
      torsionNote = `Mt=${(Mt/1e6).toFixed(3)} kN·m, τ_tors=${tau_torsion.toFixed(1)} MPa at r_max=${r_max.toFixed(1)} mm`;
    }
    const sigma_M   = (M_kNm||0)*1e6 / (throat*(gh*gw*gw/6));
    const sigma_tot = sigma_N + sigma_M;
    const tau_tot   = Math.sqrt(
      Math.pow(tau_V + tau_torsion*(gw/2)/r_max, 2) +
      Math.pow(tau_torsion*(gh/2)/r_max, 2)
    );
    const combined = Math.sqrt(sigma_tot*sigma_tot/3 + tau_tot*tau_tot);
    const util     = combined / allowable * 100;
    return {
      ok: combined <= allowable, isGroup: true,
      throat: +throat.toFixed(2), Aw: +Aw.toFixed(1),
      tau_V: +tau_V.toFixed(2), tau_torsion: +tau_torsion.toFixed(2),
      combined: +combined.toFixed(2), allowable: +allowable.toFixed(1),
      util: +util.toFixed(1), Lw_group: +Lw_group.toFixed(0),
      throatNote, torsionNote, FEXX, gw, gh,
    };
  }
  const nWelds    = config === 'double' ? 2 : 1;
  const Aw        = throat * Lw * nWelds;
  const tau_V     = V*1000 / Aw;
  const sigma_N   = (N_kN||0)*1000 / Aw;
  const sigma_M   = (M_kNm||0)*1e6 / (Aw * Lw / 6);
  const sigma_tot = sigma_N + sigma_M;
  const tau_tot   = Math.sqrt(Math.pow(tau_V,2) + Math.pow(sigma_tot/Math.sqrt(3),2));
  const util      = tau_tot / allowable * 100;
  const ok        = tau_tot <= allowable;
  return {
    ok, isGroup: false,
    throat: +throat.toFixed(2), Aw: +Aw.toFixed(1),
    tau_V: +tau_V.toFixed(2), sigma_tot: +sigma_tot.toFixed(2),
    tau_tot: +tau_tot.toFixed(2), allowable: +allowable.toFixed(1),
    util: +util.toFixed(1),
    minWeld: mech_awsMinWeld(w),
    suggestedLeg: tau_tot > allowable ? Math.ceil(w * Math.sqrt(tau_tot/allowable) + 1) : null,
    throatNote, FEXX, config,
    w: +w.toFixed(1), Lw: +Lw.toFixed(0), V: +V.toFixed(1), M_kNm: M_kNm||0,
  };
}

function mech_gear(inp) {
  let { m, z1, z2, F, n1, P, P_u, eta, materialKey, Sall } = inp;
  if (P_u === 'hp') P *= 0.7457;
  if (materialKey && MECH_MAT.gear[materialKey]) Sall = MECH_MAT.gear[materialKey].Sall;
  if (z1 < 6 || z2 < 6) return { error: 'Minimum 6 teeth per gear' };
  if (m <= 0 || F <= 0 || n1 <= 0 || P <= 0) return { error: 'Invalid gear inputs' };
  if (F < 8*m) return { error: `Face width F=${F}mm too narrow. AGMA: F ≥ ${8*m}mm` };
  const i = z2/z1, n2 = n1/i, d1 = m*z1, d2 = m*z2, a = (d1+d2)/2;
  const T1 = P*1000/(2*Math.PI*n1/60), T2 = T1*i*eta;
  const Wt = T1*1000/(d1/2);
  const Vp = Math.PI*d1*n1/60000;
  const Vp_fpm = Vp * 196.85, Qv = 6;
  const A_agma = 56 + Math.sqrt(200 - Qv*Qv);
  const Kv = Math.max(1.0, (A_agma + Math.sqrt(Vp_fpm)) / A_agma);
  const Ks = Math.max(1.0, 1.192 * Math.pow(F * Math.sqrt(mech_lewisY(Math.min(z1,z2))) / m, 0.0535));
  const F_over_d = F / d1;
  const Km = 1 + 0.0675*F_over_d + 0.0128*F_over_d*F_over_d + (n1 > 3600 ? 0.15 : 0);
  const Y1 = mech_lewisY(z1), Y2 = mech_lewisY(z2);
  const sigma_lewis = Wt / (F * m * Math.min(Y1,Y2));
  const sigma_agma  = Wt * Kv * Ks * Km / (F * m * Math.min(Y1,Y2));
  const sf = Sall / sigma_agma;
  const ok = sf > 1.5 && Vp < 25;
  return {
    ok, i: +i.toFixed(3), n2: +n2.toFixed(1), d1: +d1.toFixed(1), d2: +d2.toFixed(1), a: +a.toFixed(1),
    Wt: +Wt.toFixed(1), T1_Nm: +T1.toFixed(2), T2_Nm: +T2.toFixed(2), Vp: +Vp.toFixed(2),
    sigma_lewis: +sigma_lewis.toFixed(2), sigma_agma: +sigma_agma.toFixed(2),
    Kv: +Kv.toFixed(3), Ks: +Ks.toFixed(3), Km: +Km.toFixed(3),
    Y1: +Y1.toFixed(4), Y2: +Y2.toFixed(4), sf: +sf.toFixed(3), Sall,
    P_kW: +P.toFixed(2), P_out_kW: +(P*eta).toFixed(2),
    eta_recommended: Vp < 5 ? 0.96 : Vp < 15 ? 0.97 : 0.98,
    faceWidthWarn: F > 16*m ? `Face width F=${F}mm exceeds AGMA max 16×m=${16*m}mm.` : null,
  };
}

function mech_shaft(inp) {
  let { M, T, Fa, d, d_u, L, Sy, Su, SF, Lk, materialKey } = inp;
  const mat = MECH_MAT.shaft[materialKey];
  if (mat) { Sy = mat.Sy/1e6; Su = mat.Su/1e6; }
  if (d_u === 'in') d *= 25.4;
  d /= 1000; L /= 1000; Lk /= 1000;
  Sy *= 1e6; Su *= 1e6;
  if (d <= 0 || SF < 1 || M < 0 || T < 0) return { error: 'Invalid shaft inputs' };
  const r = d/2;
  const J = Math.PI*Math.pow(d,4)/32;
  const I = Math.PI*Math.pow(d,4)/64;
  const A = Math.PI*d*d/4;
  const sigma_b = M*r/I, tau_t = T*r/J, sigma_a = (Fa||0)/A;
  const sigma_total = sigma_b + sigma_a;
  const sigma_vm = Math.sqrt(sigma_total*sigma_total + 3*tau_t*tau_t);
  const sf_vm = Sy / sigma_vm;
  const Se = 0.504 * Su;
  const sf_fatigue = 1 / (sigma_b/Se + tau_t/(0.577*Se));
  const E_s   = mat ? mat.E : 200e9;
  const rho_s = mat ? mat.rho : 7850;
  const w_self = rho_s * A * 9.81;
  const delta_ss = 5 * w_self * Math.pow(L,4) / (384 * E_s * I);
  const Nc = (30/Math.PI) * Math.sqrt(9.81 / Math.max(delta_ss, 1e-9));
  const kw = Math.max(4, Math.round(d*1000/4));
  const key_shear   = 2*T / (d * (kw/1000) * Lk);
  const key_bearing = 4*T / (d * (kw/2000) * Lk);
  const ok = sf_vm > SF;
  return {
    ok,
    sigma_b: +(sigma_b/1e6).toFixed(3), sigma_a: +(sigma_a/1e6).toFixed(3),
    tau_t:   +(tau_t/1e6).toFixed(3),   sigma_vm: +(sigma_vm/1e6).toFixed(3),
    Sy_MPa: +(Sy/1e6).toFixed(0), sf_vm: +sf_vm.toFixed(3), sf_fatigue: +sf_fatigue.toFixed(3),
    Nc_rpm: +Nc.toFixed(0), Se_MPa: +(Se/1e6).toFixed(0),
    key_shear: +(key_shear/1e6).toFixed(2), key_bearing: +(key_bearing/1e6).toFixed(2),
    kw, kh: kw, d_mm: +(d*1000).toFixed(0), L_mm: +(L*1000).toFixed(0),
    J_mm4: +(J*1e12).toFixed(2), Fa_N: Fa||0, SF,
    vmFail: sigma_vm > Sy, keyShearFail: key_shear > 0.577*Sy, keyBearFail: key_bearing > Sy,
  };
}

function mech_sheetMetal(inp) {
  let { t, t_u, K, theta, R, A, B, Sy, E, materialKey } = inp;
  const mat = MECH_MAT.sheet[materialKey];
  if (mat) { K = mat.K; Sy = mat.Sy; E = mat.E; }
  if (t_u === 'in') t *= 25.4;
  const E_MPa = E * 1000;
  if (t <= 0 || R < 0 || theta <= 0) return { error: 'Invalid sheet metal inputs' };
  const BA        = (Math.PI/180) * theta * (R + K*t);
  const BD        = 2*(R+t)*Math.tan(theta/2*Math.PI/180) - BA;
  const TotalFlat = A + B + BA;
  const Kf        = Sy * R / (E_MPa * t);
  const thetaFinal = theta * (1 - 3*Kf + 4*Math.pow(Kf,3));
  const springback = Math.max(0, theta - thetaFinal);
  const effMat = MECH_MAT.sheet[materialKey] || MECH_MAT.sheet['ms'];
  const Rmin   = effMat.Rmin_factor * t;
  const Rmin_labels = { ms:'0.5t (mild steel)', ss304:'1.0t (SS304)', alum:'4.0t (Al 6061)', copper:'1.0t (copper)', galv:'0.5t (galvanised)' };
  return {
    ok: R >= Rmin,
    BA: +BA.toFixed(3), BD: +BD.toFixed(3), TotalFlat: +TotalFlat.toFixed(3),
    springback: +springback.toFixed(2), overbend: +(theta+springback).toFixed(1),
    Rmin: +Rmin.toFixed(2), Rmin_note: Rmin_labels[materialKey] || `${effMat.Rmin_factor}t`,
    Kf: +Kf.toFixed(4), neutral_mm: +(K*t).toFixed(3), arc_R: +(R+K*t).toFixed(3),
    bendOk: R >= Rmin, Kf_warn: Kf > 0.3,
    t, K, theta, R, A, B, Sy, E,
  };
}

function mech_spring(inp) {
  let { dw, D, Na, F, G, Ssy, ends, materialKey } = inp;
  const mat = MECH_MAT.spring[materialKey];
  if (mat) { G = mat.G; Ssy = mat.Ssy; }
  if (dw <= 0 || D <= 0 || dw >= D) return { error: 'Invalid wire/coil diameter' };
  if (Na < 1 || F <= 0) return { error: 'Invalid active coils or load' };
  const C  = D / dw;
  const Kw = (4*C-1)/(4*C-4) + 0.615/C;
  const k  = G * Math.pow(dw,4) / (8 * Math.pow(D,3) * Na);
  const delta = F / k;
  const tau   = Kw * 8*F*D / (Math.PI*Math.pow(dw,3));
  const sf    = Ssy / tau;
  const p_free = dw * 1.25;
  let Nt, Lf;
  if      (ends === 'closed-ground') { Nt = Na+2; Lf = Na*p_free + 2*dw; }
  else if (ends === 'closed')        { Nt = Na+2; Lf = Na*p_free + 3*dw; }
  else                               { Nt = Na;   Lf = Na*p_free + dw;   }
  const solid_h        = Nt * dw;
  const endDw          = ends === 'closed-ground' ? 2 : ends === 'closed' ? 3 : 1;
  const pitch          = (Lf - endDw*dw) / Na;
  const coil_gap       = pitch - dw;
  const clash_clearance = Lf - delta - solid_h;
  const slenderness    = Lf / D;
  return {
    ok: sf >= 1.2 && C >= 4 && C <= 12,
    k: +k.toFixed(3), delta: +delta.toFixed(3), Kw: +Kw.toFixed(4), C: +C.toFixed(2),
    tau: +tau.toFixed(2), Ssy: +Ssy.toFixed(1), sf: +sf.toFixed(3),
    Lf: +Lf.toFixed(2), solid_h: +solid_h.toFixed(2), pitch: +pitch.toFixed(3),
    coil_gap: +coil_gap.toFixed(3), clash_clearance: +clash_clearance.toFixed(3),
    slenderness: +slenderness.toFixed(3), Nt,
    bucklingRisk: slenderness > 4.0, clashWarn: clash_clearance < 0.15*Lf, C_warn: C < 4 || C > 12,
    dw, D, Na, G, F, ends,
  };
}

function mech_fastener(inp) {
  let { d, p, Sy, T, Tu, K, Fa_kN, gradeKey } = inp;
  if (gradeKey && MECH_MAT.fastener[gradeKey]) Sy = MECH_MAT.fastener[gradeKey].Sy;
  if (Tu === 'lbft') T *= 1.35582;
  if (d <= 0 || p <= 0 || Sy <= 0 || T <= 0) return { error: 'Invalid fastener inputs' };
  if (K < 0.05 || K > 0.5) return { error: 'K outside typical range 0.05–0.5' };
  const d2 = d - 0.6495*p, d3 = d - 1.2269*p;
  const At = Math.PI/4 * Math.pow((d2+d3)/2, 2);
  const Fi = T*1000 / (K*d);
  const sigma_preload = Fi / At;
  const tau_tighten   = sigma_preload * 0.5 * Math.tan(Math.atan(p / (Math.PI*d2)));
  const sigma_vm_tight = Math.sqrt(sigma_preload*sigma_preload + 3*tau_tighten*tau_tighten);
  const Fa            = (Fa_kN||0) * 1000;
  const sigma_service = (Fi + Fa) / At;
  const sf   = Sy / Math.max(sigma_vm_tight, sigma_service);
  const util = sigma_service / Sy * 100;
  const ok   = sf >= 1.2 && sigma_service < Sy;
  const T_strip = 0.18 * Sy * At * d / 1000;
  return {
    ok,
    At: +At.toFixed(2), d2: +d2.toFixed(3), d3: +d3.toFixed(3),
    Fi_kN: +(Fi/1000).toFixed(3), sigma_preload: +sigma_preload.toFixed(1),
    sigma_service: +sigma_service.toFixed(1), Sy, sf: +sf.toFixed(3),
    util: +util.toFixed(1), T_strip_Nm: +T_strip.toFixed(1),
    T_strip_ratio: +(T_strip/T).toFixed(2),
    p, K, T, Fa_kN: Fa_kN||0, gradeKey,
  };
}

function mech_cnc(inp) {
  let { D, Vc, Vc_u, fz, z, ap, ae, workMat, toolMat } = inp;
  if (Vc_u === 'sfm') Vc *= 0.3048;
  if (!Vc && workMat) {
    const base = MECH_MAT.cncVc[workMat] || 200;
    Vc = toolMat === 'hss' ? Math.round(base/4) : base;
  }
  if (D <= 0 || Vc <= 0 || fz <= 0 || z < 1 || ap <= 0 || ae <= 0) return { error: 'Invalid CNC inputs' };
  if (ae > D) return { error: `Radial depth ae=${ae}mm exceeds tool diameter D=${D}mm` };
  const n   = 1000*Vc / (Math.PI*D);
  const f   = fz*z*n;
  const MRR = ae*ap*f / 1000;
  const kc_val = MECH_MAT.cncKc[workMat] || 1500;
  const Pc  = kc_val*ae*ap*f / (60*1e6);
  const tc  = 100 / (f/60);
  return {
    ok: true,
    n: +n.toFixed(0), f: +f.toFixed(0), Vc, fz,
    MRR: +MRR.toFixed(2), Pc: +Pc.toFixed(3), tc_per_100mm: +tc.toFixed(1),
    kc_val, D, ae, ap, z,
    highSpindleWarn: n > 30000 ? `Spindle ${Math.round(n)} rpm is very high. Verify machine maximum.` : null,
    aeWarn: ae > D*0.75 ? `High radial engagement ae/D=${(ae/D*100).toFixed(0)}%. Consider reducing.` : null,
  };
}

function mech_tank(inp) {
  let { D, Du, H, fill_pct, rho, type, thk, liquidKey } = inp;
  if (Du === 'm') D *= 1000; else if (Du === 'ft') D *= 304.8;
  if (liquidKey && MECH_MAT.liquid[liquidKey]) rho = MECH_MAT.liquid[liquidKey];
  const R    = D / 2;
  const fill = fill_pct / 100;
  let V_total = 0, V_fill = 0;
  switch (type) {
    case 'vert-cyl':       V_total = Math.PI*R*R*H/1e6; V_fill = V_total*fill; break;
    case 'horiz-cyl': {
      V_total = Math.PI*R*R*H/1e6;
      const h_fill  = D*fill;
      const theta_h = 2*Math.acos(Math.max(-1, Math.min(1, 1 - 2*h_fill/D)));
      V_fill = (R*R*(theta_h - Math.sin(theta_h))/2) * H/1e6; break;
    }
    case 'rect':           V_total = D*D*H/1e6; V_fill = V_total*fill; break;
    case 'cone':           V_total = Math.PI*R*R*H/3/1e6; V_fill = V_total*Math.pow(fill,3); break;
    case 'sph':            V_total = 4/3*Math.PI*Math.pow(R,3)/1e6; V_fill = V_total*fill; break;
    case 'vert-cyl-heads': {
      const Vcyl = Math.PI*R*R*H/1e6; const Vhead = 2*(Math.PI/12*D*R*R/1e6);
      V_total = Vcyl+Vhead; V_fill = V_total*fill; break;
    }
    default: return { error: 'Unknown tank type' };
  }
  const OD          = D + 2*thk;
  const mass_liquid = V_fill * rho;
  const hydrostatic = rho*9.81*(H/1000)*fill/1e5;
  const V_litre     = V_total * 1000;
  return {
    ok: true,
    V_total_L:      +V_litre.toFixed(1),
    V_fill_L:       +(V_fill*1000).toFixed(1),
    V_total_m3:     +V_total.toFixed(4),
    V_gal:          +(V_litre*0.264172).toFixed(1),
    V_bbls:         +(V_litre/158.987).toFixed(2),
    mass_liquid_kg: +mass_liquid.toFixed(1),
    hydrostatic_bar:+hydrostatic.toFixed(3),
    OD: +OD.toFixed(0), D, H, fill_pct, rho, thk,
  };
}

function mech_cog(inp) {
  const { components } = inp;
  if (!components || components.length === 0) return { error: 'No components provided' };
  let totalM = 0, sumMx = 0, sumMy = 0;
  for (const c of components) { totalM += c.m; sumMx += c.m*c.x; sumMy += c.m*c.y; }
  if (totalM === 0) return { error: 'Total mass is zero' };
  const cogX = sumMx/totalM, cogY = sumMy/totalM;
  return {
    ok: true,
    totalM: +totalM.toFixed(4), weight_N: +(totalM*9.81).toFixed(1),
    cogX: +cogX.toFixed(2), cogY: +cogY.toFixed(2),
    breakdown: components.map(c => ({
      name: c.name, m: c.m, x: c.x, y: c.y,
      pct: +(c.m/totalM*100).toFixed(1),
    })),
  };
}

function mech_beam(inp) {
  let { loadType, section, L, load, a_pos, E, Fy, materialKey,
        b_rect, h_rect, bf, tf, hw, tw, bh, hh, th, dia } = inp;
  const mat = MECH_MAT.beam[materialKey];
  if (mat) { E = mat.E; if (!Fy) Fy = mat.Fy; }
  // Resolve section properties
  let I_mm4, Z_mm3, A_mm2, sectionDesc = '';
  if (MECH_SECTIONS[section]) {
    ({ I: I_mm4, Z: Z_mm3, A: A_mm2 } = MECH_SECTIONS[section]); sectionDesc = section;
  } else if (section === 'rect' && b_rect > 0 && h_rect > 0) {
    I_mm4 = b_rect*Math.pow(h_rect,3)/12; Z_mm3 = b_rect*h_rect*h_rect/6; A_mm2 = b_rect*h_rect;
    sectionDesc = `Rect ${b_rect}×${h_rect} mm`;
  } else if (section === 'circle' && dia > 0) {
    I_mm4 = Math.PI*Math.pow(dia,4)/64; Z_mm3 = Math.PI*Math.pow(dia,3)/32; A_mm2 = Math.PI*dia*dia/4;
    sectionDesc = `Circle ⌀${dia} mm`;
  } else if (section === 'ibeam' && bf > 0 && tf > 0 && hw > 0 && tw > 0) {
    // hw may be overall depth H (from HTML) or pure web height — derive web height
    const hw_web = hw > 2*tf ? hw - 2*tf : hw; // if overall H sent, subtract flanges
    const I_f = 2*(bf*Math.pow(tf,3)/12 + bf*tf*Math.pow((hw_web/2+tf/2),2));
    const I_w = tw*Math.pow(hw_web,3)/12;
    I_mm4 = I_f + I_w; Z_mm3 = I_mm4/((hw_web/2+tf)); A_mm2 = 2*bf*tf + hw_web*tw;
    sectionDesc = `I-beam ${bf}×${tf}f / ${hw_web}×${tw}w mm`;
  } else if (section === 'hollow-rect' && bh > 0 && hh > 0 && th > 0) {
    const bi = bh-2*th, hi = hh-2*th;
    I_mm4 = (bh*Math.pow(hh,3) - bi*Math.pow(hi,3))/12; Z_mm3 = I_mm4/(hh/2); A_mm2 = bh*hh - bi*hi;
    sectionDesc = `Hollow ${bh}×${hh}×${th} mm`;
  } else {
    return { error: 'Unknown section or missing dimensions' };
  }
  if (!I_mm4 || I_mm4 <= 0 || L <= 0 || load <= 0) return { error: 'Invalid beam inputs' };
  const E_Pa  = E * 1e9, I_m4 = I_mm4*1e-12, L_m = L/1000;
  const EI    = E_Pa * I_m4;
  let delta_max_m = 0, M_max_Nm = 0, V_max_N = 0, reaction_A = 0, reaction_B = 0, formulaStr = '';
  if (loadType === 'udl-ss') {
    const w = load;
    delta_max_m = 5*w*Math.pow(L_m,4)/(384*EI); M_max_Nm = w*L_m*L_m/8;
    V_max_N = w*L_m/2; reaction_A = reaction_B = V_max_N; formulaStr = 'δ=5wL⁴/384EI · M=wL²/8';
  } else if (loadType === 'point-ss-mid') {
    const P = load;
    delta_max_m = P*Math.pow(L_m,3)/(48*EI); M_max_Nm = P*L_m/4;
    V_max_N = P/2; reaction_A = reaction_B = P/2; formulaStr = 'δ=PL³/48EI · M=PL/4';
  } else if (loadType === 'point-ss-off') {
    const P = load, a = (a_pos||L/2)/1000, b = L_m-a;
    reaction_A = P*b/L_m; reaction_B = P*a/L_m; M_max_Nm = reaction_A*a; V_max_N = Math.max(reaction_A,reaction_B);
    const tmp = P*a*b*(a+2*b)*Math.sqrt(3*a*(a+2*b));
    delta_max_m = tmp/(27*EI*L_m); formulaStr = 'δ_max=Pa·b·(a+2b)√(3a(a+2b))/27EIL';
  } else if (loadType === 'cantilever-udl') {
    const w = load;
    delta_max_m = w*Math.pow(L_m,4)/(8*EI); M_max_Nm = w*L_m*L_m/2;
    V_max_N = w*L_m; reaction_A = V_max_N; formulaStr = 'δ=wL⁴/8EI · M=wL²/2 (cantilever)';
  } else if (loadType === 'cantilever-point') {
    const P = load;
    delta_max_m = P*Math.pow(L_m,3)/(3*EI); M_max_Nm = P*L_m;
    V_max_N = P; reaction_A = P; formulaStr = 'δ=PL³/3EI · M=PL (cantilever)';
  } else if (loadType === 'fixed-point') {
    // Fixed-fixed, central point load
    const P = load;
    delta_max_m = P*Math.pow(L_m,3)/(192*EI); M_max_Nm = P*L_m/8;
    V_max_N = P/2; reaction_A = reaction_B = P/2; formulaStr = 'δ=PL³/192EI · M=PL/8 (fixed-fixed)';
  } else if (loadType === 'fixed-udl') {
    // Fixed-fixed, UDL
    const w = load;
    delta_max_m = w*Math.pow(L_m,4)/(384*EI); M_max_Nm = w*L_m*L_m/12;
    V_max_N = w*L_m/2; reaction_A = reaction_B = V_max_N; formulaStr = 'δ=wL⁴/384EI · M=wL²/12 (fixed-fixed)';
  } else {
    return { error: 'Unknown load type' };
  }
  const sigma   = Z_mm3 > 0 ? M_max_Nm*1e3/Z_mm3 : 0;
  const dLimit  = L_m / 360;
  const Fy_Pa   = (Fy||250) * 1e6;
  const ok      = sigma <= Fy_Pa && delta_max_m <= dLimit;
  return {
    ok,
    Mmax: +(M_max_Nm/1000).toFixed(3), Vmax: +(V_max_N/1000).toFixed(3),
    delta_mm: +(delta_max_m*1000).toFixed(3), dLimit_mm: +(dLimit*1000).toFixed(3),
    sigma_MPa: +(sigma/1e6).toFixed(2), Fy_MPa: Fy||250,
    sf: +(Fy_Pa/Math.max(sigma,1)).toFixed(3),
    EI_kNm2: +(EI/1e3).toFixed(1),
    reaction_A_kN: +(reaction_A/1000).toFixed(3), reaction_B_kN: +(reaction_B/1000).toFixed(3),
    I_mm4: I_mm4.toExponential(3), Z_mm3: Z_mm3.toExponential(3), A_mm2,
    E_GPa: E, L_m: +L_m.toFixed(3), sectionDesc, formulaStr,
    stressFail: sigma > Fy_Pa, deflFail: delta_max_m > dLimit,
  };
}

function mech_materialProps(inp) {
  const { category, key } = inp;
  const cat = MECH_MAT[category];
  if (!cat) return { ok: false, error: `Unknown category "${category}"` };
  if (key) {
    if (cat[key] !== undefined) return { ok: true, props: cat[key] };
    return { ok: false, error: `Key "${key}" not found in "${category}"` };
  }
  return { ok: true, keys: Object.keys(cat) };
}

// ── Route handler ─────────────────────────────────────────────────

// ========================================================================
// SECTION: MECHANICAL
// ========================================================================

async function handle_mechanical_engineering(body, res) {
  const { calculator, inputs } = body || {};
  if (!calculator || !inputs) {
    return res.status(400).json({ ok: false, error: 'Missing "calculator" or "inputs" in request body.' });
  }
  let result;
  try {
    switch (calculator) {
      case 'pressure-vessel': result = mech_pressureVessel(inputs); break;
      case 'bolt-flange':     result = mech_boltFlange(inputs);     break;
      case 'weld':            result = mech_weld(inputs);           break;
      case 'gear':            result = mech_gear(inputs);           break;
      case 'shaft':           result = mech_shaft(inputs);          break;
      case 'sheet-metal':     result = mech_sheetMetal(inputs);     break;
      case 'spring':          result = mech_spring(inputs);         break;
      case 'fastener':        result = mech_fastener(inputs);       break;
      case 'cnc':             result = mech_cnc(inputs);            break;
      case 'tank':            result = mech_tank(inputs);           break;
      case 'cog':             result = mech_cog(inputs);            break;
      case 'beam':            result = mech_beam(inputs);           break;
      case 'material-props':  result = mech_materialProps(inputs);  break;
      default:
        return res.status(400).json({ ok: false, error: `Unknown calculator: "${calculator}"` });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Calculation error: ' + err.message });
  }
  if (result && result.error) return res.status(422).json({ ok: false, error: result.error });
  return res.status(200).json({ ok: true, results: result });
}




// ================================================================

// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — dispatches to handle_mechanical_engineering
// ════════════════════════════════════════════════════════════════════════════
async function mechanical_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = req.method === 'POST' ? req.body : {};
  if (req.method === 'POST' && (!body || typeof body !== 'object'))
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_mechanical_engineering(body, res);
  } catch (e) {
    console.error('[mechanical-engineering-calculators.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 20: Mechanical Engineering Calculators ──────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
