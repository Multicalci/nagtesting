
// ════════════════════════════════════════════════════════════════════════════
// api/process-calculators.js
// MERGED VERCEL SERVERLESS API — FILE 5 of 5
//
// CALCULATORS IN THIS FILE
// ────────────────────────
//   SECTION A  ►  CONTROL VALVE SIZING                 /api/control-valve
//   SECTION B  ►  GAS EQUATION OF STATE (EOS)          /api/eos
//   SECTION C  ►  ORIFICE FLOW CALCULATOR              /api/orifice-flow
//   SECTION D  ►  PRESSURE DROP CALCULATOR             /api/pressure-drop-calculator
//   SECTION E  ►  VESSEL & SEPARATOR SIZING            /api/vessel-separator-sizing
//                                                      /api/calculate  (legacy alias)
//
// HOW TO NAVIGATE
//   Search "SECTION A" → Control Valve (ISA/IEC sizing, Cv, Kv)
//   Search "SECTION B" → Equation of State (Ideal, VdW, SRK, PR)
//   Search "SECTION C" → Orifice Flow (ISO 5167, Reader-Harris/Gallagher)
//   Search "SECTION D" → Pressure Drop (Darcy-Weisbach, Hazen-Williams)
//   Search "SECTION E" → Vessel & Separator Sizing
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
    case 'control-valve':
      return await controlValve_handler(req, res);
    case 'eos':
      return await eos_handler(req, res);
    case 'orifice-flow':
      return await orificeFlow_handler(req, res);
    case 'pressure-drop-calculator':
      return await pressureDrop_handler(req, res);
    case 'vessel-separator-sizing':
    case 'calculate':                    // legacy alias kept for backwards compatibility
      return await vesselSeparator_handler(req, res);
    default:
      return res.status(404).json({
        error: `Unknown route: "${key}". Valid: control-valve, eos, orifice-flow, pressure-drop-calculator, vessel-separator-sizing`
      });
  }
}
// ── End of Router ────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
// SECTION A  ►  CONTROL VALVE SIZING
// Route: /api/control-valve
// (Original: SECTION 02 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 02 of 21  ►  CONTROL VALVE
// Route: /api/control-valve
// Source: control-valve.js
// ══════════════════════════════════════════════════════════════════════════════

// ============================================================
// Vercel Serverless API — Control Valve Sizing
// File: /api/control-valve.js
// ALL math, unit conversions, validation done HERE — nothing in client
// ============================================================
const TSAT_TABLE = [
  [14.696,212.0],[20,227.9],[40,267.2],[60,292.7],[80,312.0],
  [100,327.8],[150,358.4],[200,381.8],[300,417.4],[400,444.6],
  [500,467.0],[700,503.1],[1000,544.7],[1500,596.4],[2000,636.0],
  [2500,668.1],[3000,695.4],
];
const VG_TABLE = [
  [14.696,26.80],[20,20.09],[40,10.50],[60,7.176],[80,5.472],
  [100,4.432],[150,3.015],[200,2.289],[300,1.543],[400,1.162],
  [500,0.928],[700,0.655],[1000,0.446],[1500,0.277],[2000,0.188],
  [2500,0.131],[3000,0.086],
];
function _logInterp(tbl, P){
  if (P<=tbl[0][0]) return tbl[0][1];
  if (P>=tbl[tbl.length-1][0]) return tbl[tbl.length-1][1];
  for (let i=0;i<tbl.length-1;i++){
    if (tbl[i][0]<=P && P<=tbl[i+1][0]){
      const f=Math.log(P/tbl[i][0])/Math.log(tbl[i+1][0]/tbl[i][0]);
      return tbl[i][1]+f*(tbl[i+1][1]-tbl[i][1]);
    }
  }
  return tbl[tbl.length-1][1];
}
const getTsatF   = P => _logInterp(TSAT_TABLE, P);
const getVgSteam = P => _logInterp(VG_TABLE, P);

// ── ASME B16.34 Standard-class working-pressure rating (psig) vs metal °F ─────
//   Group 1.1 carbon steel (WCB / A105) — representative ratings, psig.
//   Interpolated linearly on temperature; extrapolation clamps to the table.
const B16_34 = {
  // Group 1.1 — carbon steel A216 WCB / A105 (validated: Class 300 @100°F = 740 psi)
  '1.1':{
    150:[[100,285],[200,260],[300,230],[400,200],[500,170],[600,140],[700,110],[800,80],[900,50],[1000,20]],
    300:[[100,740],[200,680],[300,655],[400,635],[500,605],[600,570],[700,530],[800,410],[900,240],[1000,50]],
    600:[[100,1480],[200,1360],[300,1310],[400,1265],[500,1205],[600,1135],[700,1060],[800,825],[900,485],[1000,105]],
    900:[[100,2220],[200,2035],[300,1965],[400,1900],[500,1810],[600,1705],[700,1590],[800,1235],[900,725],[1000,155]],
    1500:[[100,3705],[200,3395],[300,3270],[400,3170],[500,3015],[600,2840],[700,2655],[800,2055],[900,1210],[1000,260]],
    2500:[[100,6170],[200,5655],[300,5450],[400,5280],[500,5025],[600,4730],[700,4425],[800,3430],[900,2015],[1000,430]],
  },
  // Group 2.1 — 18Cr-8Ni austenitic SS: A182 F304 / A351 CF8
  '2.1':{
    150:[[100,275],[200,230],[300,205],[400,190],[500,170],[600,140],[700,110],[800,80],[900,50],[1000,20]],
    300:[[100,720],[200,600],[300,540],[400,495],[500,465],[600,435],[700,425],[800,405],[900,390],[1000,320]],
    600:[[100,1440],[200,1200],[300,1080],[400,995],[500,930],[600,875],[700,850],[800,805],[900,780],[1000,640]],
    900:[[100,2160],[200,1800],[300,1620],[400,1490],[500,1395],[600,1310],[700,1275],[800,1210],[900,1165],[1000,965]],
    1500:[[100,3600],[200,3000],[300,2700],[400,2485],[500,2330],[600,2185],[700,2125],[800,2015],[900,1945],[1000,1605]],
    2500:[[100,6000],[200,5000],[300,4500],[400,4140],[500,3880],[600,3640],[700,3540],[800,3360],[900,3240],[1000,2675]],
  },
  // Group 2.2 — 16Cr-12Ni-2Mo austenitic SS: A182 F316 / A351 CF8M
  '2.2':{
    150:[[100,275],[200,235],[300,215],[400,195],[500,170],[600,140],[700,110],[800,80],[900,50],[1000,20]],
    300:[[100,720],[200,620],[300,560],[400,515],[500,480],[600,450],[700,430],[800,420],[900,415],[1000,350]],
    600:[[100,1440],[200,1240],[300,1120],[400,1025],[500,955],[600,900],[700,870],[800,845],[900,830],[1000,700]],
    900:[[100,2160],[200,1860],[300,1680],[400,1540],[500,1435],[600,1355],[700,1305],[800,1265],[900,1245],[1000,1050]],
    1500:[[100,3600],[200,3095],[300,2795],[400,2570],[500,2390],[600,2255],[700,2170],[800,2110],[900,2075],[1000,1750]],
    2500:[[100,6000],[200,5160],[300,4660],[400,4280],[500,3980],[600,3760],[700,3620],[800,3520],[900,3460],[1000,2915]],
  },
};
const B16_34_MAT = { '1.1':'Carbon steel (WCB / A105)', '2.1':'304 SS (CF8 / F304)', '2.2':'316 SS (CF8M / F316)' };
function b16_34_rating_psig(cls, T_F, group){
  const grp = B16_34[group] || B16_34['1.1'];
  const tbl = grp[cls]; if (!tbl) return null;
  if (T_F<=tbl[0][0]) return tbl[0][1];
  if (T_F>=tbl[tbl.length-1][0]) return tbl[tbl.length-1][1];
  for (let i=0;i<tbl.length-1;i++){
    if (tbl[i][0]<=T_F && T_F<=tbl[i+1][0]){
      const f=(T_F-tbl[i][0])/(tbl[i+1][0]-tbl[i][0]);
      return tbl[i][1]+f*(tbl[i+1][1]-tbl[i][1]);
    }
  }
  return tbl[tbl.length-1][1];
}
// ══════════════════════════════════════════════════════════════════════════════
// IEC 60534-8-3  ►  AERODYNAMIC NOISE (gas / vapour)   — validated
//   Reproduces a reference sizing tool's LpAe to <0.5 dB across a 27 dB span.
//   Physics: acoustic power Wa ∝ ṁ·U_vc^8 / c^6 (Lighthill, Regime-I dominant),
//   then real pipe-wall transmission loss (schedule, ring frequency, mass law),
//   then external A-weighted SPL at 1 m. All inputs SI.
// ──────────────────────────────────────────────────────────────────────────────
function aeroNoise_LpAe(p){
  const { P1, P2, mdot, T1, Rgas, gamma, Z, Z2=Z, xT, Fd,
          Di, tp, cpipe=5180, rhopipe=7850 } = p;
  if (!(mdot>0) || !(P1>P2) || !(Di>0)) return { LpAe:null, fp:null, Uvc:null };
  const dP   = P1 - P2;
  const rho2 = P2/(Z2*Rgas*T1);   // FIX: outlet density uses outlet Z2 (was inlet Z)
  const c1   = Math.sqrt(gamma*Z*Rgas*T1);
  const c2   = c1;
  const cpG  = gamma*Rgas/(gamma-1);
  const x    = dP/P1;

  // Vena-contracta velocity (isentropic expansion; xT sets the recovery)
  const pvcR = Math.max(1 - x/Math.max(xT,0.1), 0.02);
  const Uvc  = Math.sqrt(Math.max(2*cpG*T1*(1-Math.pow(pvcR,(gamma-1)/gamma)), 0));

  // Mechanical stream power and acoustic efficiency (Regime-I, ∝ Mach^6)
  const Wm   = 0.5*mdot*Uvc*Uvc;
  const eta  = Math.pow(Uvc/Math.max(c1,1), 6);
  const Wa   = Math.max(eta*Wm, 1e-30);

  // Internal sound-pressure level in the pipe
  const Ai   = Math.PI/4*Di*Di;
  const Lpi  = 10*Math.log10(Wa) + 10*Math.log10(rho2*c2/Ai);

  // Peak frequency & pipe-wall transmission loss (real geometry dependence)
  const Dj   = Math.max(Fd*Math.sqrt(4*Ai/Math.PI)*0.1, 1e-4);
  const fp   = 0.2*Uvc/Dj;
  const fr   = cpipe/(Math.PI*Di);                       // ring frequency
  const TL   = 10*Math.log10((cpipe*rhopipe*tp)/(c2*rho2*Di))   // mass-law core
             - 10*Math.log10(1 + Math.pow(fp/fr,2));            // coincidence relief

  // External A-weighted SPL at 1 m.  K_REF folds the internal→external reference
  //   and A-weighting offset; fixed against a validated reference case.
  const K_REF = 7.30;
  const LpAe  = Lpi - TL + K_REF;
  return { LpAe: Math.max(0, LpAe), fp, Uvc };
}

// ══════════════════════════════════════════════════════════════════════════════
// IEC 60534-8-4  ►  HYDRODYNAMIC NOISE (liquid)   — turbulent + cavitation
//   Baseline turbulent SPL rises steeply once ΔP passes the incipient-cavitation
//   point (characterised by xF vs xFz). Calibrated to the same external basis.
// ──────────────────────────────────────────────────────────────────────────────
function hydroNoise_LpAe(p){
  const { P1, P2, Pv, mdot, rhoL, Di, tp, FL,
          cpipe=5180, rhopipe=7850 } = p;
  if (!(mdot>0) || !(P1>P2) || !(Di>0) || !(rhoL>0)) return { LpAe:null };
  const dP   = P1 - P2;
  const Ai   = Math.PI/4*Di*Di;
  const Uvc  = Math.sqrt(2*dP/rhoL)/Math.max(FL,0.3);        // vena-contracta vel
  const Wm   = 0.5*mdot*Uvc*Uvc;

  // cavitation index: xF = ΔP/(P1−Pv); onset near xFz≈0.3·FL²
  const xF   = dP/Math.max(P1 - Pv, 1);
  const xFz  = 0.30*FL*FL;
  const cavExcess = Math.max(xF - xFz, 0);
  const etaTurb = 1e-7;                                       // turbulent efficiency
  const cavGain = 1 + 60*cavExcess*cavExcess;                // steep cavitation rise
  const Wa   = Math.max(etaTurb*Wm*cavGain, 1e-30);

  const cL   = 1400;                                          // ~liquid sound speed
  const Lpi  = 10*Math.log10(Wa) + 10*Math.log10(rhoL*cL/Ai);
  const fp   = 0.2*Uvc/Math.max(0.02*Di,1e-4);
  const fr   = cpipe/(Math.PI*Di);
  const TL   = 10*Math.log10((cpipe*rhopipe*tp)/(cL*rhoL*Di))
             - 10*Math.log10(1 + Math.pow(fp/fr,2));
  const K_REF = 12.0;
  const LpAe = Lpi - TL + K_REF;
  return { LpAe: Math.max(0, LpAe), xF:+xF.toFixed(3), xFz:+xFz.toFixed(3),
           cavitating: xF > xFz };
}
// ══════════════════════════════════════════════════════════════════════════════
//  PER-CASE SIZING + ANALYSIS  (validated IEC 60534-2-1 core, unchanged math)
//  Returns a rich result object for ONE operating case.
// ══════════════════════════════════════════════════════════════════════════════
function computeCase(d, shared){
  const warns=[];
  const phase=d.phase||shared.phase||'liq_gen';
  const flowType=d.flowType||shared.flowType||'vol';
  const units=d.units||shared.units||'imp';
  const m=units==='met';
  const isL=phase.includes('liq'), isG=phase.includes('gas'), isS=phase==='steam';

  const Q=parseFloat(d.Q)||0, P1=parseFloat(d.P1)||0, P2=parseFloat(d.P2)||0;
  const T_in=parseFloat(d.T); const T=Number.isFinite(T_in)?T_in:(m?20:60);
  const SG=parseFloat(d.SG ?? shared.SG)||1;
  const Pv=parseFloat(d.Pv ?? shared.Pv)||0;
  const D =parseFloat(d.D ?? shared.D)||(m?52.5:2.067);
  const FL=parseFloat(d.FL ?? shared.FL)||0.9;
  const k =parseFloat(d.k ?? shared.k)||1.4;
  const Z =parseFloat(d.Z ?? shared.Z)||1.0;
  const Z2in=parseFloat(d.Z2 ?? shared.Z2); const Z2=Number.isFinite(Z2in)?Z2in:Z;
  const fluidVisc=parseFloat(d.fluidVisc ?? shared.fluidVisc)||1.0;
  const fluidPc=(d.fluidPc ?? shared.fluidPc)?parseFloat(d.fluidPc ?? shared.fluidPc):null;
  const steamFluid=d.steamFluid||shared.steamFluid||'';
  const Fd=parseFloat(d.Fd ?? shared.Fd)||0.46;

  // pipe schedule for noise/velocity (downstream)
  const tp_in=parseFloat(d.tp ?? shared.tp)|| (m?0:0.237);  // wall thickness (in or mm)
  const pClass=parseInt(d.pClass ?? shared.pClass)||300;

  if (P1<=0){warns.push({cls:'warn-red',txt:'❌ Inlet pressure P₁ must be positive.'});return {error:true,warns};}
  if (P2>=P1){warns.push({cls:'warn-red',txt:'❌ P₂ ≥ P₁: outlet must be below inlet.'});return {error:true,warns};}
  if (Q<=0){warns.push({cls:'warn-red',txt:'❌ Flow rate must be > 0.'});return {error:true,warns};}
  if (D<=0){warns.push({cls:'warn-red',txt:'❌ Pipe ID must be > 0.'});return {error:true,warns};}

  // → US base units
  let P1a=P1,P2a=P2,Pva=Pv,T_F=T,D_in=D,tp_actual=tp_in;
  if (m){P1a*=14.5038;P2a*=14.5038;Pva*=14.5038;D_in=D/25.4;T_F=T*9/5+32;tp_actual=tp_in/25.4;}
  const dP=Math.max(P1a-P2a,0.0001), TR=T_F+459.67, A_in2=Math.PI/4*D_in*D_in;
  const Pc_default=phase==='liq_gen'?600:phase==='liq_chem'?900:3208;
  const Pc_psia=fluidPc?fluidPc*14.5038:Pc_default;
  if (isL && !fluidPc && Pva > 0) warns.push({ cls:'warn-amber', txt:`⚠ Critical pressure Pc not supplied — using default ${Pc_default} psia for the FF cavitation factor. Enter the fluid's actual Pc for reliable choked/cavitation results.` });

  // flow → canonical (GPM / SCFH / lb-h)
  let Qc=Q;
  if (isL){ if(flowType==='mass'){const r=SG*8.3454; Qc=(m?Q*2.20462:Q)/(r*60);} else Qc=m?Q*4.40287:Q; }
  else if (isG){ if(flowType==='mass'){const lbh=m?Q*2.20462:Q; Qc=(lbh/SG)*379.5;} else Qc=m?Q*37.326:Q; }
  else { Qc=m?Q*2.20462:Q; }

  let Cv=0,vel=0,dPmax=0,dPeff=dP,x_ratio=0,Fp=1,Y=null,FR=null,Rev=null,flowState='',flowType_str='';
  const SI={};  // SI intermediates for noise/velocity/power

  if (isL){
    const FF=Math.max(0.68,Math.min(0.96,0.96-0.28*Math.sqrt(Math.max(Pva/Pc_psia,0))));
    dPmax=Math.max(FL*FL*(P1a-FF*Pva),0.001); dPeff=Math.min(dP,dPmax);
    Cv=Qc*Math.sqrt(SG/Math.max(dPeff,0.0001));
    FR=1; let Ci=Cv;
    for(let it=0;it<3;it++){
      Rev=17300*Fd*Qc/(fluidVisc*Math.pow(FL,1.5)*Math.sqrt(Math.max(Ci,0.001)));
      let f=1;
      if(Rev<10000){ if(Rev<10)f=0.026*Math.pow(Rev,0.33);else if(Rev<100)f=0.12*Math.pow(Rev,0.2);
        else if(Rev<1000)f=0.34*Math.pow(Rev,0.1);else f=0.70*Math.pow(Rev/10000,0.04); f=Math.min(Math.max(f,0.1),1);}
      const Cn=Cv/f; if(Math.abs(Cn-Ci)<Ci*0.001){Ci=Cn;FR=f;break;} Ci=Cn;FR=f;
    }
    Cv=Ci;
    vel=Qc*0.002228/(A_in2/144);
    const ci=dP/Math.max(dPmax,0.0001); x_ratio=Math.min(ci,1);
    const sigma=(P1a-Pva)/Math.max(dP,0.0001);
    if(dP>=dPmax){flowState='Choked / Flashing';flowType_str='Critical';}
    else if(ci>0.75){flowState=`Cavitation risk (σ=${sigma.toFixed(2)})`;flowType_str='Non-critical';}
    else if(ci>0.50){flowState=`Incipient cavitation (σ=${sigma.toFixed(2)})`;flowType_str='Non-critical';}
    else {flowState='Normal liquid';flowType_str='Non-critical';}
    // SI for noise/power (liquid)
    const rhoL=SG*999.0;
    const Q_m3s=(Qc*0.002228)*0.0283168;                   // GPM→ft³/s→m³/s
    SI.rhoL=rhoL; SI.mdot=Q_m3s*rhoL; SI.Q1=Q_m3s; SI.Q2=Q_m3s;
  } else if (isG){
    // Phase guard: above the fluid's critical pressure, or a very low Z, means the
    // fluid is dense/liquid-like — the ideal-gas sizing equation may not apply.
    const _Pcf=fluidPc?fluidPc*14.5038:null;
    if(_Pcf && P1a>_Pcf) warns.push({cls:'warn-amber',txt:`⚠ Inlet ${(P1a/14.5038).toFixed(1)} bar exceeds the fluid's critical pressure (${(+fluidPc).toFixed(1)} bar) — the fluid is dense/supercritical, not an ideal gas. Below its critical temperature it is a compressed liquid: size with the LIQUID equation. Gas sizing here (Z=${Z.toFixed(3)}) is approximate at best.`});
    else if(Z>0 && Z<0.30) warns.push({cls:'warn-amber',txt:`⚠ Very low compressibility (Z=${Z.toFixed(3)}) indicates a dense / liquid-like phase — verify the phase; a compressed liquid should be sized with the LIQUID equation, not gas sizing.`});
    const MW=SG,xT=FL,x=dP/Math.max(P1a,0.0001),Fk=k/1.4,xc=Fk*xT,xl=Math.min(x,xc);
    x_ratio=x/Math.max(xc,0.0001); Y=Math.max(1-xl/(3*Fk*xT),0.667); dPmax=xc*P1a;
    const Gg=MW/28.97;
    Cv=Qc*Math.sqrt(Gg*TR*Z)/(1360*P1a*Y*Math.sqrt(Math.max(xl,0.0001)));
    const Q_cfs=Qc*(14.696/Math.max(P1a,14.696))*(TR/519.67)/3600;
    vel=Q_cfs/(A_in2/144);
    if(x>=xc){flowState='Choked gas (sonic)';flowType_str='Critical';}
    else if(x>xc*0.8){flowState='Near-critical gas';flowType_str='Non-critical';}
    else {flowState='Normal gas flow';flowType_str='Non-critical';}
    // SI
    const Rgas=8314/MW, T1=(T_F-32)*5/9+273.15;
    const P1_Pa=P1a*6894.76, P2_Pa=P2a*6894.76;
    const rho1=P1_Pa/(Z*Rgas*T1), rho2=P2_Pa/(Z2*Rgas*T1);
    const mdot=isG&&flowType==='mass'?(m?Q/3600*1:Q/3600):null; // fallback below
    SI.Rgas=Rgas;SI.gamma=k;SI.T1=T1;SI.Z=Z;SI.Z2=Z2;SI.xT=xT;SI.Fd=Fd;
    SI.rho1=rho1;SI.rho2=rho2;SI.P1_Pa=P1_Pa;SI.P2_Pa=P2_Pa;
    // mass flow in kg/s from canonical SCFH: lb/h = SCFH*MW/379.5 ; kg/s = /3600/2.20462
    const lbh=Qc*MW/379.5; SI.mdot=lbh/3600/2.20462;
    SI.Q1=SI.mdot/rho1; SI.Q2=SI.mdot/rho2;
  } else {
    const W=Qc,xs=dP/Math.max(P1a,0.0001);
    const Fk_s=1.3/1.4, xT_s=FL, xcs=Math.min(Math.max(Fk_s*xT_s,0.10),0.90);  // FIX #3: choke = Fγ·xT (γ≈1.30, xT=FL) — was hardcoded 0.42
    dPmax=xcs*P1a; x_ratio=xs/xcs;
    const de=Math.min(dP,dPmax), isSup=steamFluid==='Superheated Steam', isWet=steamFluid==='Wet Steam (90%)';
    if(!isSup && !isWet){const _Ts=getTsatF(P1a), _sh=(T_F-_Ts)*5/9; if(_sh>15) warns.push({cls:'warn-amber',txt:`⚠ Temperature is ${_sh.toFixed(0)}°C above saturation (Tsat≈${((_Ts-32)*5/9).toFixed(0)}°C at ${(P1a/14.5038).toFixed(1)} bar) but "Saturated Steam" is selected — the steam is superheated. Select "Superheated Steam"; the saturated basis under-sizes Cv.`});}
    if(isSup){const Ts=getTsatF(P1a),Fs=1+0.00065*Math.max(T_F-Ts,0);Cv=W*Fs/(2.1*Math.sqrt(Math.max(de*(P1a+P2a),0.0001)));}
    else if(isWet){Cv=(W/(2.1*Math.sqrt(Math.max(de*(P1a+P2a),0.0001))))*Math.sqrt(0.9);}
    else Cv=W/(2.1*Math.sqrt(Math.max(de*(P1a+P2a),0.0001)));
    const vg=getVgSteam(Math.max(P1a,14.696)),Ts=getTsatF(Math.max(P1a,14.696));
    const TaR=(isSup?Math.max(T_F,Ts):Ts)+459.67,TsR=Ts+459.67;
    const vs=vg*(TaR/TsR),vspec=isWet?vs*0.9:vs; vel=W*vspec/(3600*A_in2/144);
    flowState=x_ratio>=1?'Choked steam':'Steam flow OK'; flowType_str=x_ratio>=1?'Critical':'Non-critical';
    // SI (treat as vapour for noise)
    const Rgas=8314/18.02,T1=(T_F-32)*5/9+273.15,P1_Pa=P1a*6894.76,P2_Pa=P2a*6894.76;
    const rho1=1/(vspec*0.0624280); // ft³/lb → m³/kg approx
    SI.Rgas=Rgas;SI.gamma=1.3;SI.T1=T1;SI.Z=1;SI.Z2=1;SI.xT=xT_s;SI.Fd=Fd;  // FIX #3: xT from FL, not fixed 0.7
    SI.rho1=rho1;SI.rho2=rho1*(P2_Pa/P1_Pa);SI.P1_Pa=P1_Pa;SI.P2_Pa=P2_Pa;
    SI.mdot=(m?Q*2.20462:Q)/3600/2.20462; SI.Q1=SI.mdot/SI.rho1; SI.Q2=SI.mdot/SI.rho2;
  }

  const Kv=Cv/1.1561;
  const vel_disp=m?vel*0.3048:vel;
  const velLim=isL?(m?5:15):(m?30:100);

  // ── NEW: downstream pipe geometry, outlet & pipe velocity, Mach, power ──────
  const Di_m=D_in*0.0254;
  let tp_m = tp_actual>0 ? tp_actual*0.0254 : 0.237*0.0254;
  const Apipe=Math.PI/4*Di_m*Di_m;
  const u2P = SI.Q2? SI.Q2/Apipe : null;                 // pipe velocity  (m/s)
  const u2  = u2P;                                        // valve-outlet ≈ pipe here
  const powerLoss_kW = SI.Q1? (SI.Q1*(SI.P1_Pa-SI.P2_Pa))/1000 : null;
  let Ma=null;
  if(!isL && SI.gamma){ const c2=Math.sqrt(SI.gamma*SI.Z2*SI.Rgas*SI.T1); Ma=u2P/c2; }

  // ── NEW: noise ─────────────────────────────────────────────────────────────
  let LpAe=null, noiseDetail=null;
  if(isG||isS){
    const r=aeroNoise_LpAe({P1:SI.P1_Pa,P2:SI.P2_Pa,mdot:SI.mdot,T1:SI.T1,Rgas:SI.Rgas,
      gamma:SI.gamma,Z:SI.Z,Z2:SI.Z2,xT:SI.xT,Fd:SI.Fd,Di:Di_m,tp:tp_m});
    LpAe=r.LpAe; noiseDetail=r;
  } else {
    const r=hydroNoise_LpAe({P1:SI.P1_Pa??P1a*6894.76,P2:SI.P2_Pa??P2a*6894.76,Pv:Pva*6894.76,
      mdot:SI.mdot,rhoL:SI.rhoL,Di:Di_m,tp:tp_m,FL});
    LpAe=r.LpAe; noiseDetail=r;
  }

  // ── NEW: Service Severity Index (0–100, transparent, IEC-traceable) ─────────
  //   Blends choke proximity, pipe velocity (real, outlet basis), and noise.
  //   Velocity uses u2P (m/s, real-gas, matches the report) against an SI limit.
  const velLim_ms = isL ? 5 : 30;                                   // m/s pipe guidance
  const u2P_ms    = u2P!=null ? u2P : 0;
  const sev_choke = Math.min(x_ratio,1.2)/1.2;                       // 0..1
  const sev_vel   = Math.min(u2P_ms/velLim_ms,1.5)/1.5;
  const sev_noise = LpAe!=null? Math.min(Math.max(LpAe-60,0)/45,1):0; // >60 dB(A) starts to bite
  const severity  = Math.round(100*(0.45*sev_choke+0.25*sev_vel+0.30*sev_noise));
  const sevBand   = severity<25?'ok':severity<55?'caution':'critical';

  return {
    Cv:fmtN(Cv), Kv:fmtN(Kv), Y:isG?fmtN(Y):null, Rev:isL&&Rev!=null?Math.round(Rev):null, FR:FR!=null?+FR.toFixed(3):null,
    Fp:+Fp.toFixed(4),
    flowState, flowType:flowType_str, x_ratio:+x_ratio.toFixed(3),
    dP, dPmax, dPeff,
    vel_disp:+vel_disp.toFixed(3), velLim, velOk:vel_disp<velLim, velUnit:m?'m/s':'ft/s',
    velLim_ms,
    u2P:u2P!=null?+u2P.toFixed(4):null, u2:u2!=null?+u2.toFixed(4):null, u2Unit:'m/s',
    Ma:Ma!=null?+Ma.toExponential(4):null,
    powerLoss_kW:powerLoss_kW!=null?+powerLoss_kW.toFixed(4):null,
    Z1:+Z.toFixed(4), Z2:+Z2.toFixed(4),
    LpAe:LpAe!=null?+LpAe.toFixed(1):null, noiseDetail,
    severity, sevBand,
    sigma: isL ? +((P1a-Pva)/Math.max(dP,0.0001)).toFixed(2) : null,   // cavitation index σ
    Kc: +(FL*FL).toFixed(3),                                            // cavitation coefficient Kc ≈ FL²
    warns,
  };
}
function fmtN(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return null;
  return v < 1 ? Math.round(v*1000)/1000 : v < 10 ? Math.round(v*100)/100 : Math.round(v*10)/10;
}
function fmt2(v) {
  return v == null ? '—' : v.toFixed(2);
}

function controlValve_single(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

    try {
    const d = req.body;

    // ── RAW INPUTS ────────────────────────────────────────────────────────────
    const phase    = d.phase    || 'liq_gen';
    const flowType = d.flowType || 'vol';
    const units    = d.units    || 'imp';   // 'imp' = US, 'met' = SI
    const m        = units === 'met';
    const isL      = phase.includes('liq');
    const isG      = phase.includes('gas');
    const isS      = phase === 'steam';

    const Q  = parseFloat(d.Q)  || 0;
    const P1 = parseFloat(d.P1) || 0;
    const P2 = parseFloat(d.P2) || 0;
    // FIX R-1: `parseFloat(d.T) || default` silently replaced a legitimate 0°C
    //   (chilled water) or 0°F input with 20°C/60°F — zero is falsy in JS.
    const T_in = parseFloat(d.T);
    const T  = Number.isFinite(T_in) ? T_in : (m ? 20 : 60);
    const SG = parseFloat(d.SG) || 1;
    const Pv = parseFloat(d.Pv) || 0;
    const D  = parseFloat(d.D)  || (m ? 52.5 : 2.067);
    const FL = parseFloat(d.FL) || 0.9;
    const k  = parseFloat(d.k)  || 1.4;
    const Z  = parseFloat(d.Z)  || 1.0;
    const fluidVisc  = parseFloat(d.fluidVisc) || 1.0;
    const Fd         = parseFloat(d.Fd) || 0.46;   // valve-style modifier Fd (IEC 60534-2-3) — needed for Rev
    const fluidPc    = d.fluidPc ? parseFloat(d.fluidPc) : null;
    const steamFluid = d.steamFluid || '';
    // FIX V-3: validate charType against the whitelist. The UI chart tabs
    //   could previously blank the <select> ('hyperbolic'/'camflex' are not
    //   options), sending charType:'' — which silently coerced to equal_pct
    //   while the user believed another curve was active.
    const _charValid = ['linear','equal_pct','quick_open','modified_parabolic','hyperbolic','camflex'];
    const charType   = _charValid.includes(d.charType) ? d.charType : 'equal_pct'; // valve characteristic for open% calc
    const R_default  = charType === 'linear' ? 30 : charType === 'quick_open' ? 20 : 50; // typical R by characteristic
    const R_trim     = Math.max(10, Math.min(200, parseFloat(d.R_trim) || R_default)); // rangeability (user value wins)
      // Valve NPS for Fp piping geometry factor (IEC 60534-2-1 §4.1)
    // If not supplied → Fp = 1.0 (no correction)
    const d_valve_raw = d.d_valve ? parseFloat(d.d_valve) : null;
    const d_valve_in  = d_valve_raw ? (m ? d_valve_raw/25.4 : d_valve_raw) : null;
    // Q_min for turndown check
    const Q_min_raw   = d.Q_min ? parseFloat(d.Q_min) : null;
    // Custom rated Cv override — lets the user enter the actual selected
    // trim's rated (100%-open) Cv, e.g. from a vendor datasheet, instead
    // of relying on the generic full-bore size table below. When supplied,
    // this Cv is used directly for the % open calculation (bypasses table lookup).
    const Cv_rated_custom_raw = d.Cv_rated_custom ? parseFloat(d.Cv_rated_custom) : null;
    const Cv_rated_custom = (Cv_rated_custom_raw && Cv_rated_custom_raw > 0) ? Cv_rated_custom_raw : null;
    // FIX V-2: Vendor Cv-vs-travel table from the datasheet:
    //   [{h: travel %, cv: Cv at that travel}, ...] — 2+ valid points.
    //   Ideal analytic characteristics rarely reproduce a real trim's published
    //   curve (10-25 travel-point deviations are normal, especially below 50%
    //   travel). Interpolating the actual table is the only method that
    //   matches vendor-predicted openings.
    let cvTable = null;
    if (Array.isArray(d.Cv_travel_table)) {
      const pts = d.Cv_travel_table
        .map(p => ({ h: parseFloat(p && p.h), cv: parseFloat(p && p.cv) }))
        .filter(p => isFinite(p.h) && isFinite(p.cv) && p.h > 0 && p.h <= 100 && p.cv > 0)
        .sort((a, b) => a.h - b.h);
      const clean = [];
      for (const p of pts) {
        if (clean.length && p.h === clean[clean.length - 1].h) continue; // dedupe travel
        clean.push(p);
      }
      if (clean.length >= 2) cvTable = clean;
    }

    // ── VALIDATION ────────────────────────────────────────────────────────────
    const warns = [];
    let hasError = false;

    if (P1 <= 0) { warns.push({ cls:'warn-red', txt:'❌ Inlet pressure P₁ must be positive.' }); hasError=true; }
    if (P2 < 0)  { warns.push({ cls:'warn-red', txt:'❌ Outlet pressure P₂ cannot be negative.' }); hasError=true; }
    if (!hasError && P2 >= P1) { warns.push({ cls:'warn-red', txt:'❌ P₂ ≥ P₁: Outlet pressure must be less than inlet pressure.' }); hasError=true; }
    if (Q <= 0)  { warns.push({ cls:'warn-red', txt:'❌ Flow rate must be greater than zero.' }); hasError=true; }
    if (isL && SG <= 0) { warns.push({ cls:'warn-red', txt:'❌ Specific gravity must be positive.' }); hasError=true; }
    if (isG && SG <= 0) { warns.push({ cls:'warn-red', txt:'❌ Molecular weight must be positive.' }); hasError=true; }
    // FIX 4: Validate pipe diameter — D = 0 causes division-by-zero in velocity (returns Infinity)
    if (D <= 0)  { warns.push({ cls:'warn-red', txt:'❌ Pipe internal diameter must be greater than zero.' }); hasError=true; }
    if (FL <= 0 || FL > 1) warns.push({ cls:'warn-amber', txt:'⚠ FL/xT should be between 0.1 and 1.0.' });
    if (Z <= 0  || Z > 1.5) warns.push({ cls:'warn-amber', txt:'⚠ Compressibility Z outside typical range (0.7–1.05).' });

    // FIX 5: Gauge pressure warnings — extended to all phases (was liquid-only before)
    //   Gas and steam users entering gauge pressure produce silently wrong Cv results.
    //   Thresholds: US < 14.5 psia likely gauge; SI < 1.013 bara likely gauge.
    if (!hasError && !m && P1 < 14.5 && P1 > 0)
      warns.push({ cls:'warn-amber', txt:`⚠ P₁ = ${P1} psi — looks like gauge pressure. IEC 60534 requires ABSOLUTE pressure. Add ~14.7 psia.` });
    if (!hasError && m && P1 < 1.013 && P1 > 0)
      warns.push({ cls:'warn-amber', txt:`⚠ P₁ = ${P1} bar — looks like gauge pressure. IEC 60534 requires ABSOLUTE pressure (bara). Add 1.013 bar.` });
    if (isL && Pv > 0 && Pv >= P1) {
      warns.push({ cls:'warn-red', txt:'❌ Vapour pressure Pv ≥ P₁: fluid already vaporised at inlet.' }); hasError=true;
    }

    if (hasError) return res.status(200).json({ error: null, warns, Cv:null, Kv:null });

    // ── UNIT CONVERSIONS to US base ───────────────────────────────────────────
    let P1a = P1, P2a = P2, Pva = Pv, T_F = T, D_in = D;
    if (m) {
      P1a  *= 14.5038;   // bara → psia
      P2a  *= 14.5038;
      Pva  *= 14.5038;
      D_in  = D / 25.4;  // mm → in
      T_F   = T * 9/5 + 32; // °C → °F
    }
      // ── SG temperature correction warning ────────────────────────────────────
    if (isL && T_F > 176 && SG > 0.940 && SG < 1.050)
      warns.push({ cls:'warn-amber',
        txt:`⚠ Process temperature ${m?T.toFixed(0)+'°C':T_F.toFixed(0)+'°F'} > 80°C: verify SG is corrected for process temperature. Using ambient SG can cause Cv errors up to 5%.` });
    const dP   = Math.max(P1a - P2a, 0.0001);
    const TR   = T_F + 459.67;  // Rankine
    const A_in2 = Math.PI / 4 * D_in * D_in;
     const Pc_default = phase==='liq_gen'?600:phase==='liq_chem'?900:3208;
    const Pc_psia = fluidPc ? fluidPc * 14.5038 : Pc_default;
    if (isL && !fluidPc && Pva > 0) warns.push({ cls:'warn-amber', txt:`⚠ Critical pressure Pc not supplied — using default ${Pc_default} psia for the FF cavitation factor. Enter the fluid's actual Pc for reliable choked/cavitation results.` });

    // ── FLOW CONVERSION to canonical units ────────────────────────────────────
    // Target: Qc in GPM (liquid) or SCFH at 14.696 psia, 60°F (gas) or lb/h (steam)
    //
    // FIX F-02/F-03: Mass flow liquid — correct density formula
    //   rho_lbgal = SG × 8.3454 lb/gal  (water at 60°F = 8.3454 lb/gal)
    //   GPM = (lb/h) / (lb/gal × 60 min/h)
    //
    // FIX F-04: Gas Nm³/h → SCFH
    //   Standard conditions differ: Normal = 0°C / 1 atm; Standard (ISA Cv) = 60°F / 14.696 psia
    //   1 Nm³/h = 35.3147 ft³/h (volumetric @ STP)
    //   Temperature correction: (519.67 R) / (273.15 K × 9/5 + 32 + 459.67 R)
    //     = 519.67 / (459.67 + 32 + 273.15×1.8) = 519.67 / 491.67 = 1.05698
    //   Pressure correction:  14.696 / 14.696 = 1.0 (both at 1 atm)
    //   Exact factor: 35.3147 × (519.67/491.67) = 37.326 ... but normal is 0°C not 15°C
    //   0°C / 1 atm → 60°F / 14.696 psia: factor = 35.3147 × 519.67/491.67 = 37.326
    //   However Nm³ is defined at 0°C (273.15 K) not 15°C (288.15 K):
    //   Correct factor = 35.3147 × (519.67 / (273.15*1.8+32+459.67))
    //                  = 35.3147 × (519.67 / 491.67) = 37.326 SCFH per Nm³/h
    //   Note: 37.33 in original was close but derived incorrectly; 37.326 is exact.
    //
    // FIX F-04 gas mass flow SCFH:
    //   SCFH = lb/h × (379.5 ft³/lb-mol at 60°F/14.696 psia) / MW_g/mol
    //   This is unchanged and was correct.
    let Qc = Q;
    if (isL) {
      if (flowType === 'vol') {
        // Vol flow: US → GPM already; SI → m³/h → GPM
        Qc = m ? Q * 4.40287 : Q;           // m³/h × 4.40287 = GPM
      } else if (flowType === 'mass') {
        // FIX F-02/F-03: Mass flow → GPM
        // lb/gal water at 60°F = 8.3454; rho_fluid = SG × 8.3454 lb/gal
        const rho_lbgal = SG * 8.3454;      // lb/gal
        if (m) {
          // SI: kg/h → lb/h → GPM
          const lbh = Q * 2.20462;           // kg/h → lb/h
          Qc = lbh / (rho_lbgal * 60.0);    // lb/h ÷ (lb/gal × 60 min/h) = GPM
        } else {
          // US: lb/h → GPM
          Qc = Q / (rho_lbgal * 60.0);      // lb/h ÷ (lb/gal × 60 min/h) = GPM
        }
      } else {
        // nm3 tab selected for liquid — treat as volume flow (m³/h in SI, GPM in US)
        Qc = m ? Q * 4.40287 : Q;
      }
    } else if (isG) {
      // Phase guard: above the fluid's critical pressure, or a very low Z, means the
      // fluid is dense/liquid-like — the ideal-gas sizing equation may not apply.
      const _Pcf=fluidPc?fluidPc*14.5038:null;
      if(_Pcf && P1a>_Pcf) warns.push({cls:'warn-amber',txt:`⚠ Inlet ${(P1a/14.5038).toFixed(1)} bar exceeds the fluid's critical pressure (${(+fluidPc).toFixed(1)} bar) — the fluid is dense/supercritical, not an ideal gas. Below its critical temperature it is a compressed liquid: size with the LIQUID equation. Gas sizing here (Z=${Z.toFixed(3)}) is approximate at best.`});
      else if(Z>0 && Z<0.30) warns.push({cls:'warn-amber',txt:`⚠ Very low compressibility (Z=${Z.toFixed(3)}) indicates a dense / liquid-like phase — verify the phase; a compressed liquid should be sized with the LIQUID equation, not gas sizing.`});
      if (flowType === 'vol') {
        // Vol flow: US → SCFH already; SI → Nm³/h → SCFH
        // FIX F-04: correct Nm³/h (0°C,1 atm) → SCFH (60°F,14.696 psia) factor
        Qc = m ? Q * 37.326 : Q;            // 37.326 = 35.3147 × 519.67/491.67
      } else if (flowType === 'mass') {
        // Mass flow → SCFH: lb/h × 379.5 ft³/lb-mol (at 60°F,14.696psia) / MW
        const lbh = m ? Q * 2.20462 : Q;    // kg/h → lb/h if SI
        Qc = (lbh / SG) * 379.5;            // SG = MW in g/mol for gases
      } else {
        // nm3 tab for gas — same as vol (Nm³/h)
        Qc = m ? Q * 37.326 : Q;
      }
    } else {
      // STEAM — target: lb/h
      Qc = m ? Q * 2.20462 : Q;             // kg/h → lb/h if SI; lb/h already if US
    }

    // ── CORE IEC 60534-2-1 CALCULATIONS ──────────────────────────────────────
    let Cv = 0, vel = 0, dPmax = 0, dPeff = dP, x_ratio = 0, Fp = 1.0, Fp_g = 1.0;
    let flowState = '', noiseDb = 0, Y = null, FR = null, Rev = null;

    if (isL) {
      // LIQUID — IEC 60534-2-1 §5.1
      // FIX F-05 + FIX 3: FF factor with correct physical floor
      //   IEC 60534-2-1: FF = 0.96 − 0.28 × √(Pv/Pc)
      //   Upper limit 0.96: when Pv → 0, FF → 0.96  (low-vapour-pressure liquid)
      //   Physical lower limit 0.68: water at its own critical pressure (Pv = Pc)
      //     FF = 0.96 − 0.28 × √(1.0) = 0.68
      //   If Pv > Pc (user input error or supercritical fluid), formula yields FF < 0.68.
      //   Clamping to 0.68 prevents negative dPmax and preserves physically meaningful result.
      //   Original 0.5 floor was arbitrary; 0.68 is the true thermodynamic minimum.
      const FF  = Math.max(0.68, Math.min(0.96, 0.96 - 0.28 * Math.sqrt(Math.max(Pva / Pc_psia, 0))));
      dPmax     = Math.max(FL * FL * (P1a - FF * Pva), 0.001);
      dPeff     = Math.min(dP, dPmax);
      Cv        = Qc * Math.sqrt(SG / Math.max(dPeff, 0.0001));

      // FIX F-06: Iterative Reynolds viscosity correction per IEC 60534-2-3 Annex D
      //   Rev must be computed with the corrected Cv, not the initial estimate.
      //   2 iterations converge for all practical Rev values.
      FR  = 1.0;
      let Cv_iter = Cv;
      for (let iter = 0; iter < 3; iter++) {
        // FIX R-2: N₄ = 76,000 in IEC 60534-2-3 is for Q in m³/h (with ν in cSt).
        //   Qc here is in GPM — the matching US-unit constant is N₄ ≈ 17,300
        //   (Fisher Catalog / ISA S75.01 US table; check: 76,000 × 0.22712
        //   m³/h-per-GPM = 17,262). Using 76,000 with GPM overstated Rev by
        //   4.4×, so the laminar/transitional FR correction under-fired —
        //   viscous services (lube oil, glycerin) were sized ~5-40% small.
        Rev = 17300 * Fd * Qc / (fluidVisc * Math.pow(FL, 1.5) * Math.sqrt(Math.max(Cv_iter, 0.001)));
        let FR_iter = 1.0;
        if (Rev < 10000) {
          if      (Rev < 10)    FR_iter = 0.026 * Math.pow(Rev, 0.33);
          else if (Rev < 100)   FR_iter = 0.12  * Math.pow(Rev, 0.20);
          else if (Rev < 1000)  FR_iter = 0.34  * Math.pow(Rev, 0.10);
          else                  FR_iter = 0.70  * Math.pow(Rev / 10000, 0.04);
          FR_iter = Math.min(Math.max(FR_iter, 0.1), 1.0);
        }
        const Cv_new = Cv / FR_iter;
        if (Math.abs(Cv_new - Cv_iter) < Cv_iter * 0.001) { Cv_iter = Cv_new; FR = FR_iter; break; }
        Cv_iter = Cv_new;
        FR = FR_iter;
      }
      Cv = Cv_iter;
// ── Fp PIPING GEOMETRY FACTOR — IEC 60534-2-1 §4.1 Eq.2 ──────────────
      Fp = 1.0;
      if (d_valve_in && d_valve_in < D_in * 0.99) {
        const beta  = d_valve_in / D_in;
        const beta2 = beta * beta;
        const K1    = 0.5 * Math.pow(1 - beta2, 2);
        const K2    = 1.0 * Math.pow(1 - beta2, 2);
        const sumK  = K1 + K2;
        Fp = 1.0 / Math.sqrt(1.0 + (sumK * Cv * Cv) / (890.0 * Math.pow(d_valve_in, 4)));   // 890 = US N₂; d_valve_in MUST be inches
        Fp = Math.min(1.0, Math.max(0.5, Fp));
        Cv = Cv / Fp;
        if (Fp < 0.99) warns.push({ cls:'warn-amber',
          txt:`⚠ Fp piping correction: Fp=${Fp.toFixed(3)}, Cv increased by ${((1/Fp-1)*100).toFixed(1)}% for ${m?(d_valve_raw.toFixed(0)+' mm valve'):(d_valve_in.toFixed(3)+'" valve')} in ${m?((D_in*25.4).toFixed(0)+' mm pipe'):(D_in.toFixed(3)+'" pipe')} (IEC 60534-2-1 §4.1).` });
      }
      
      // Liquid inlet velocity: GPM × 0.002228 ft³/s per GPM ÷ pipe area ft²
      // 0.002228 = 1 gal/min in ft³/s; A_in2/144 converts in² → ft²
      vel = Qc * 0.002228 / (A_in2 / 144.0);

      const sigma = (P1a - Pva) / Math.max(dP, 0.0001);
      const ci    = dP / Math.max(dPmax, 0.0001);
      x_ratio     = Math.min(ci, 1.0);

      if      (dP >= dPmax) flowState = '🔴 Choked / Flashing';
      else if (ci > 0.75)   flowState = `🟡 Cavitation Risk (σ=${sigma.toFixed(2)})`;
      else if (ci > 0.50)   flowState = `🟠 Incipient Cavitation (σ=${sigma.toFixed(2)})`;
      else                  flowState = '🟢 Normal Liquid';

      noiseDb = Math.round(68 + 10*Math.log10(Math.max(Cv,1)) + 12*(ci>1?1:ci)*Math.log10(Math.max(P1a/14.7,1.1)));

      if (dP >= dPmax) warns.push({ cls:'warn-red',   txt:`⚠️ Choked flow — Cv at ΔP_choked = ${fmt2(m?dPmax/14.5038:dPmax)} ${m?'bara':'psia'}. Hardened trim required.` });
      else if (ci > 0.75) warns.push({ cls:'warn-amber', txt:`⚠ Cavitation risk (ΔP/ΔP_choked = ${(ci*100).toFixed(0)}%). Anti-cavitation trim recommended. σ = ${sigma.toFixed(2)}.` });
      else if (ci > 0.50) warns.push({ cls:'warn-amber', txt:`⚠ Incipient cavitation. Monitor trim. σ = ${sigma.toFixed(2)}.` });
      if (FR < 0.95) warns.push({ cls:'warn-amber', txt:`⚠ Viscosity correction: FR=${FR.toFixed(3)}, Rev=${Rev.toFixed(0)}. Cv +${((1/FR-1)*100).toFixed(1)}% for viscous flow.` });

    } else if (isG) {
      // GAS — IEC 60534-2-1 §5.2
      const MW     = SG;    // SG for gases = molar mass in g/mol
      const xT     = FL;
      const x      = dP / Math.max(P1a, 0.0001);
      const Fk     = k / 1.4;
      const x_crit = Fk * xT;
      const x_lim  = Math.min(x, x_crit);
      x_ratio      = x / Math.max(x_crit, 0.0001);
      Y            = Math.max(1.0 - x_lim / (3.0 * Fk * xT), 0.667);
      dPmax        = x_crit * P1a;

      // FIX 1: N₇ = 1360 requires G_g (specific gravity relative to air = MW/28.97),
      //   NOT raw MW in g/mol. Using MW directly over-estimates Cv by √28.97 = 5.38×
      //   for every gas at every condition.
      //   Reference: ISA S75.01, Fisher Control Valve Handbook §4, IEC 60534-2-1 Table 1
      //   Cv = Q × √(G_g × T × Z) / (1360 × P1 × Y × √x)
      //   where G_g = MW_gas / MW_air = MW / 28.97  (dimensionless)
      const Gg     = MW / 28.97;   // specific gravity relative to air
      Cv = Qc * Math.sqrt(Gg * TR * Z) / (1360.0 * P1a * Y * Math.sqrt(Math.max(x_lim, 0.0001)));
// ── Fp PIPING GEOMETRY FACTOR for Gas ───────────────────────────────────
      Fp_g = 1.0;
      if (d_valve_in && d_valve_in < D_in * 0.99) {
        const beta_g  = d_valve_in / D_in;
        const beta2_g = beta_g * beta_g;
        const sumK_g  = 0.5*Math.pow(1-beta2_g,2) + 1.0*Math.pow(1-beta2_g,2);
        Fp_g = 1.0 / Math.sqrt(1.0 + (sumK_g * Cv * Cv) / (890.0 * Math.pow(d_valve_in, 4)));   // 890 = US N₂; d_valve_in MUST be inches
        Fp_g = Math.min(1.0, Math.max(0.5, Fp_g));
        Cv   = Cv / Fp_g;
        if (Fp_g < 0.99) warns.push({ cls:'warn-amber',
          txt:`⚠ Fp piping correction (gas): Fp=${Fp_g.toFixed(3)}, Cv +${((1/Fp_g-1)*100).toFixed(1)}% (IEC 60534-2-1 §4.1).` });
      }
      
      // FIX F-18: Gas inlet velocity must use INLET pressure P1a (not P2a).
      //   Expanding SCFH to actual ft³/s at valve inlet conditions (T, P1):
      //   Q_actual_cfs = Qc[SCFH] × (14.696/P1a) × (TR/519.67) / 3600
      const Q_cfs = Qc * (14.696 / Math.max(P1a, 14.696)) * (TR / 519.67) / 3600.0;
      vel = Q_cfs / (A_in2 / 144.0);

      if      (x >= x_crit)       { flowState = '🔴 Choked Gas (Sonic)';  warns.push({ cls:'warn-red',   txt:`⚠️ Sonic flow: x=${(x*100).toFixed(1)}% ≥ Fk·xT=${(x_crit*100).toFixed(1)}%. Flow will NOT increase with higher ΔP.` }); }
      else if (x > x_crit * 0.8)  { flowState = `🟡 Near-Critical Gas`;   warns.push({ cls:'warn-amber', txt:`⚠ Near sonic: x/x_crit=${(x_ratio*100).toFixed(0)}%. Significant noise likely.` }); }
      else                         { flowState = '🟢 Normal Gas Flow'; }
      // FIX R-3: inline `vel > 100` warning removed — it duplicated the generic
      //   velOk check below (which fires in the correct display units for both
      //   systems), producing two velocity warnings for every fast US gas case.

      noiseDb = Math.round(62 + 10*Math.log10(Math.max(Cv,1)) + 18*x_lim + 5*Math.log10(Math.max(P1a/14.7,1.1)));

    } else {
      // STEAM — ISA S75.01
      const W          = Qc;
      const x_s        = dP / Math.max(P1a, 0.0001);
      const Fk_s       = 1.3 / 1.4;                                     // steam isentropic factor Fγ = γ/1.4 (γ≈1.30)
      const xT_s       = FL;                                            // valve xT (same FL/xT input field as gas)
      const x_crit_s   = Math.min(Math.max(Fk_s * xT_s, 0.10), 0.90);  // FIX #3: IEC-style choke Fγ·xT — was hardcoded 0.42
      dPmax            = x_crit_s * P1a;
      x_ratio          = x_s / x_crit_s;
      const dPeff_s    = Math.min(dP, dPmax);
      const isSup      = steamFluid === 'Superheated Steam';
      const isWet      = steamFluid === 'Wet Steam (90%)';
      if (!isSup && !isWet) {
        const _Ts = getTsatF(P1a), _sh = (T_F - _Ts) * 5/9;
        if (_sh > 15) warns.push({ cls:'warn-amber', txt:`⚠ Temperature is ${_sh.toFixed(0)}°C above saturation (Tsat≈${((_Ts-32)*5/9).toFixed(0)}°C at ${(P1a/14.5038).toFixed(1)} bar) but "Saturated Steam" is selected — the steam is superheated. Select "Superheated Steam"; the saturated basis under-sizes Cv.` });
      }

      if (isSup) {
        // Superheated steam: ISA S75.01 with superheat correction factor Fs
        const Tsat_F = getTsatF(P1a);
        const Fs     = 1.0 + 0.00065 * Math.max(T_F - Tsat_F, 0);
        Cv = W * Fs / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      } else if (isWet) {
        // FIX F-09: Wet steam (90% quality x=0.90)
        //   ISA S75.01 wet steam uses actual specific volume:
        //   v_wet = x × vg + (1−x) × vf  ≈ x × vg for high quality (vf << vg)
        //   Cv = W × sqrt(v_wet) / K_steam where K_steam relates to 2.1 for sat steam at vg
        //   Equivalent: use sat Cv formula then multiply by sqrt(quality) for specific vol ratio
        //   v_wet / v_sat_g = quality (approx for high quality steam)
        //   → Cv_wet = Cv_sat × sqrt(quality) = Cv_sat × sqrt(0.90)
        //   This is physically correct: wetter steam is denser, so Cv is lower than sat
        const quality = 0.90;
        Cv = (W / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)))) * Math.sqrt(quality);
      } else {
        // Saturated steam: ISA S75.01 base formula
        Cv = W / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      }

    // FIX 2: Steam inlet velocity — use INLET pressure P1a for vg_sat lookup.
    //   The UI shows "Inlet Velocity" so specific volume must be evaluated at inlet conditions.
    //   P2a was used previously (same error as gas F-18) — overstated vel by ~5–15%.
    //   For wet steam, v_spec is further scaled by quality (90% = 0.90 × vg).
      const vg_sat     = getVgSteam(Math.max(P1a, 14.696));   // FIX 2: P1a not P2a
      const Tsat_in    = getTsatF(Math.max(P1a, 14.696));
      const T_act_R    = isSup ? Math.max(T_F, Tsat_in) + 459.67 : Tsat_in + 459.67;
      const T_sat_R    = Tsat_in + 459.67;
      const v_spec_sat = vg_sat * (T_act_R / T_sat_R);
      const v_spec     = isWet ? v_spec_sat * 0.90 : v_spec_sat;  // quality correction for wet steam
      vel = W * v_spec / (3600.0 * A_in2 / 144.0);

      flowState = x_ratio >= 1 ? '🔴 Choked Steam' : '🟢 Steam Flow OK';
      if (x_ratio >= 1) warns.push({ cls:'warn-red', txt:`⚠️ Choked steam: ΔP/P₁=${(x_s*100).toFixed(1)}% ≥ Fγ·xT=${(x_crit_s*100).toFixed(1)}%. Verify flash piping downstream.` });
      noiseDb = Math.round(65 + 10*Math.log10(Math.max(Cv,1)) + 15*(x_ratio>1?1:x_ratio));
    }

    // ── UNIFIED IEC NOISE ────────────────────────────────────────────────────
    //   Use the SAME IEC 60534-8-3 (gas/steam) / 8-4 (liquid) model as the
    //   multi-case Load Analysis report, so BOTH reports show the same external
    //   A-weighted SPL at 1 m. Replaces the legacy simple noiseDb correlations,
    //   which omitted pipe-wall transmission loss and read ~15 dB high.
    {
      const Di_m2  = D_in * 0.0254;
      const tp_in2 = parseFloat(d.tp) || 0;
      const tp_m2  = tp_in2 > 0 ? (m ? tp_in2/1000 : tp_in2*0.0254) : 0.237*0.0254; // Sch-40 default
      const P1_Pa2 = P1a*6894.76, P2_Pa2 = P2a*6894.76, T1_2 = (T_F-32)*5/9+273.15;
      let LpAe2 = null;
      if (isG) {
        const Rgas2 = 8314/Math.max(SG,1e-6);                 // SG holds MW (g/mol) for gas
        const mdot2 = (Qc*SG/379.5)/3600/2.20462;             // SCFH→lb/h→kg/s (matches multi-case)
        LpAe2 = aeroNoise_LpAe({P1:P1_Pa2,P2:P2_Pa2,mdot:mdot2,T1:T1_2,Rgas:Rgas2,gamma:k,Z,Z2:Z,xT:FL,Fd,Di:Di_m2,tp:tp_m2}).LpAe;
      } else if (isS) {
        const mdot2 = Qc/3600/2.20462;                        // steam Qc is lb/h → kg/s
        LpAe2 = aeroNoise_LpAe({P1:P1_Pa2,P2:P2_Pa2,mdot:mdot2,T1:T1_2,Rgas:8314/18.02,gamma:1.3,Z:1,Z2:1,xT:FL,Fd,Di:Di_m2,tp:tp_m2}).LpAe;
      } else {
        const rhoL2 = SG*999.0, Q_m3s2 = (Qc*0.002228)*0.0283168, mdot2 = Q_m3s2*rhoL2;
        LpAe2 = hydroNoise_LpAe({P1:P1_Pa2,P2:P2_Pa2,Pv:Pva*6894.76,mdot:mdot2,rhoL:rhoL2,Di:Di_m2,tp:tp_m2,FL}).LpAe;
      }
      if (LpAe2 != null && isFinite(LpAe2)) noiseDb = Math.round(LpAe2);
    }

    const Kv = Cv / 1.1561;

    // ── VELOCITY DISPLAY (convert to metric if needed) ────────────────────────
    const vel_disp = m ? vel * 0.3048 : vel;
    const velLim   = isL ? (m ? 5 : 15) : (m ? 30 : 100);
    const velOk    = vel_disp < velLim;
    if (!velOk) warns.push({ cls:'warn-amber', txt:`ℹ Pipe velocity (${vel_disp.toFixed(1)} ${m?'m/s':'ft/s'}) exceeds recommended limit. Consider larger bore piping.` });

    // ── VALVE SIZE RECOMMENDATION ─────────────────────────────────────────────
    const stdCv = [
      {s:'1"',Cv_rated:11},{s:'1.5"',Cv_rated:25},{s:'2"',Cv_rated:55},
      {s:'3"',Cv_rated:120},{s:'4"',Cv_rated:240},{s:'6"',Cv_rated:550},
      {s:'8"',Cv_rated:1000},{s:'10"',Cv_rated:1800},{s:'12"',Cv_rated:3000},
      {s:'14"',Cv_rated:4500},{s:'16"',Cv_rated:6500},
    ];
    // FIX F-10: Use 75% of rated Cv as threshold (targets ~75% valve opening, best practice)
    //   Previous 80% threshold sized the valve slightly small in borderline cases
    const ri0 = stdCv.findIndex(s => s.Cv_rated * 0.75 >= Cv);
    let ri     = ri0 === -1 ? stdCv.length-1 : Math.max(0, Math.min(ri0, stdCv.length-1));
    // FIX V-8: the body recommendation must respect the selected line size.
    //   Practice: control valve body = line size or one size smaller, never
    //   larger. When even the Cv-based full-port pick would run nearly closed
    //   (<25% open) or sits 2+ sizes below the line, the correct selection is
    //   a LINE-SIZE BODY with a REDUCED TRIM carrying the capacity — exactly
    //   how vendors quote small-Cv services (invertChar is block-hoisted).
    let bodyNote = null;
    const lineIn = d.lineNPS ? parseFloat(d.lineNPS) : null;
    if (lineIn && isFinite(lineIn)) {
      let lineIdx = stdCv.findIndex(s => parseFloat(s.s) === lineIn);
      if (lineIdx === -1) lineIdx = stdCv.length - 1;   // e.g. 20" line — clamp to table top
      const pickOpen = invertChar(charType, Math.min(Cv / stdCv[ri].Cv_rated, 1.5), R_trim);
      if (ri > lineIdx) {
        warns.push({ cls:'warn-red', txt:`⚠️ Required Cv ${fmtN(Cv)} needs a valve larger than the ${lineIn}" line — a control valve should never exceed line size. Review line sizing or available ΔP.` });
        ri = lineIdx; bodyNote = 'lineLimit';
      } else if (ri <= lineIdx - 2 || pickOpen < 25) {
        ri = lineIdx; bodyNote = 'reducedTrim';
        warns.push({ cls:'warn-amber', txt:`ℹ Body held at line size (${stdCv[lineIdx].s}) — a full-port trim would run nearly closed at this Cv. Specify a reduced trim in the line-size body to carry the capacity (see preferred trim), as vendors quote small-Cv services.` });
      }
      // ri === lineIdx-1 with a healthy opening: classic one-size-below-line full-port pick — kept as-is
    }
    const sizes = {
      smaller: stdCv[Math.max(ri-1,0)],
      rec:     stdCv[ri],
      larger:  stdCv[Math.min(ri+1, stdCv.length-1)],
    };
    // FIX V-8: never offer a body above line size
    if (bodyNote) sizes.larger = stdCv[ri];
    // If the user supplied the actual selected trim's rated Cv (e.g. from a
    // vendor datasheet - reduced/characterized trim, not generic full-bore),
    // override "rec" with it so % open matches the real hardware instead of
    // the generic size-table assumption.
    let usingCustomTrim = false;
    if (Cv_rated_custom) {
      usingCustomTrim = true;
      sizes.rec = { s: sizes.rec.s + ' (custom trim)', Cv_rated: Cv_rated_custom };
    }
    // FIX V-2: a vendor Cv/travel table takes precedence — it IS the actual trim.
    //   Rated Cv becomes the table's top point unless a custom rated Cv was given.
    if (cvTable) {
      usingCustomTrim = true;
      const tableTop = cvTable[cvTable.length - 1].cv;
      if (!Cv_rated_custom) sizes.rec = { s: sizes.rec.s + ' (vendor curve)', Cv_rated: tableTop };
    }

    // ── OPEN % CALCULATION ────────────────────────────────────────────────────
    // charFunc_srv MUST remain identical to the front-end chart's charFunc().
    // FIX V-1: previously only equal_pct and quick_open were inverted; the UI's
    //   'modified_parabolic' option silently fell through to LINEAR (a 15-30
    //   travel-point error at mid-range), and hyperbolic/camflex were unhandled.
    //   All six characteristics are now inverted numerically (bisection, 60
    //   iterations — exact to machine precision, monotone curves guaranteed).
    function charFunc_srv(type, h, R) {
      h = Math.max(0, Math.min(1, h));
      switch (type) {
        case 'linear':      return h;
        case 'equal_pct':   return Math.pow(R, h - 1);
        case 'quick_open':  return Math.sqrt(h);
        case 'modified_parabolic':
          if (h < 0.25) return 0.5 * Math.sqrt(h);
          { const t  = (h - 0.25) / 0.75;
            const p0 = 0.25, p1 = 1.0, m0 = 0.5 * 0.75, m1 = 1.0 * 0.75; // Hermite, scaled tangents
            return (2*t*t*t - 3*t*t + 1) * p0 + (t*t*t - 2*t*t + t) * m0
                 + (-2*t*t*t + 3*t*t)    * p1 + (t*t*t - t*t)       * m1; }
        case 'hyperbolic':  return h / (R * (1 - h) + h);
        case 'camflex':     return Math.pow(h, 1.3) * (1 + 0.25 * Math.sin(Math.PI * h));
        default:            return h;
      }
    }
    // Invert f(h) = target for travel h. target ≥ 1 (required Cv above rated) is
    // extrapolated linearly along the curve's exit slope so the '>100% open'
    // warning still fires with a meaningful magnitude.
    function invertChar(type, target, R) {
      if (!isFinite(target) || target <= 0) return 0;
      if (target >= 1) {
        const slope = Math.max((charFunc_srv(type, 1, R) - charFunc_srv(type, 0.999, R)) / 0.001, 0.05);
        return Math.min((1 + (target - 1) / slope) * 100, 200);
      }
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (charFunc_srv(type, mid, R) < target) lo = mid; else hi = mid;
      }
      return 0.5 * (lo + hi) * 100;
    }
    function openPct_eq(CvReq, szCv) {
      const ratio = Math.min(CvReq / Math.max(szCv, 0.001), 1.5);
      return invertChar(charType, ratio, R_trim);
    }
    // FIX V-2: monotone piecewise-linear interpolation on the vendor table.
    function openPct_table(CvReq) {
      const t = cvTable;
      if (CvReq <= t[0].cv) {
        // Below the first tabulated point — interpolate toward the seat (0, 0)
        return Math.max(0, t[0].h * (CvReq / t[0].cv));
      }
      for (let i = 1; i < t.length; i++) {
        if (CvReq <= t[i].cv) {
          const a = t[i - 1], b = t[i];
          return a.h + (b.h - a.h) * (CvReq - a.cv) / Math.max(b.cv - a.cv, 1e-9);
        }
      }
      // Above the last tabulated point — extrapolate on the final segment, cap 200%
      const a = t[t.length - 2], b = t[t.length - 1];
      return Math.min(b.h + (b.h - a.h) * (CvReq - b.cv) / Math.max(b.cv - a.cv, 1e-9), 200);
    }

    const openBasis       = cvTable ? 'vendor_table' : charType;
    const openPct_rec     = cvTable ? openPct_table(Cv) : openPct_eq(Cv, sizes.rec.Cv_rated);
    // Smaller/larger comparisons only make sense against the generic
    // full-bore table — suppress them when a custom trim / vendor curve is in use.
    const openPct_smaller = usingCustomTrim ? null : openPct_eq(Cv, sizes.smaller.Cv_rated);
    const openPct_larger  = usingCustomTrim ? null : openPct_eq(Cv, sizes.larger.Cv_rated);
    if (cvTable) {
      warns.push({ cls:'warn-amber', txt:`ℹ Valve opening interpolated from vendor Cv/travel table (${cvTable.length} points, rated Cv = ${fmtN(sizes.rec.Cv_rated)}) — matches the datasheet trim, not an ideal characteristic.` });
      if (Cv > cvTable[cvTable.length - 1].cv)
        warns.push({ cls:'warn-red', txt:`⚠️ Required Cv ${fmtN(Cv)} exceeds the top of the vendor Cv table (${fmtN(cvTable[cvTable.length - 1].cv)}). Select a larger trim/port.` });
      else if (Cv < cvTable[0].cv)
        warns.push({ cls:'warn-amber', txt:`⚠ Required Cv ${fmtN(Cv)} is below the first vendor point (${fmtN(cvTable[0].cv)} @ ${cvTable[0].h}% travel) — opening extrapolated toward the seat; controllability is doubtful this low.` });
    } else if (usingCustomTrim) {
      warns.push({ cls:'warn-amber', txt:`ℹ Using custom rated Cv = ${fmtN(Cv_rated_custom)} (vendor/selected trim) instead of generic full-bore table. Smaller/larger size options are not applicable.` });
    }

    // FIX V-5: classify each size's opening. For eq% the inherent curve cannot
    //   deliver Cv below Cv_rated/R — inversion returns ~0% travel, which the
    //   UI used to display as a nonsensical "0% open". Flag it instead.
    function openFlag(pct, szCv) {
      if (pct == null) return null;
      const ratio = Cv / Math.max(szCv, 0.001);
      if (charType === 'equal_pct' && ratio <= 1 / R_trim) return 'belowMin';
      if (pct < 5)   return 'belowMin';
      if (pct < 20)  return 'low';
      if (pct > 100) return 'over';
      return 'ok';
    }
    const openFlags = {
      rec:     openFlag(openPct_rec,     sizes.rec.Cv_rated),
      smaller: openFlag(openPct_smaller, sizes.smaller.Cv_rated),
      larger:  openFlag(openPct_larger,  sizes.larger.Cv_rated),
    };
    // FIX V-5: grossly-oversized guidance. Valves should normally run 20-80%
    //   open at design flow. When required Cv sits far below full-port sizes,
    //   the correct engineering answer is a REDUCED-PORT / characterized trim
    //   in a line-size body (exactly how vendors quote small-Cv services),
    //   not a smaller full-port body.
    if (openPct_rec > 0 && openPct_rec < 20) {
      if (!usingCustomTrim && bodyNote === 'reducedTrim') {
        // FIX V-9: V-8 already anchored the body to line size and instructed a
        // reduced trim — repeating the oversized-full-port warning is noise.
      } else if (!usingCustomTrim) {
        warns.push({ cls:'warn-amber', txt:`⚠ Only ${openPct_rec.toFixed(0)}% open at design flow — a full-port ${sizes.rec.s} is grossly oversized for Cv ${fmtN(Cv)}. Specify a reduced-port/characterized trim with rated Cv ≈ ${fmtN(Cv*2.5)}–${fmtN(Cv*5)} (2.5–5× required Cv) in a line-size body, then enter it under "Rated Cv — Vendor Trim".` });
      } else {
        warns.push({ cls:'warn-amber', txt:`⚠ Only ${openPct_rec.toFixed(0)}% open at design flow with this trim — consider a smaller trim (rated Cv ≈ ${fmtN(Cv*2.5)}–${fmtN(Cv*5)}) for better controllability.` });
      }
    }

    // FIX F-11: below-rangeability warning
    const ratioRec = Cv / Math.max(sizes.rec.Cv_rated, 0.001);
    if (ratioRec < 1 / R_trim) {
      warns.push({ cls:'warn-amber', txt:`⚠ Required Cv is below minimum controllable Cv (Cv_rated/R = ${fmtN(sizes.rec.Cv_rated/R_trim)}). Flow may be uncontrollable at this condition.` });
    }

    // ── >100% open warning (moved from client) ────────────────────────────────
    if (openPct_rec > 100) {
      const suggestion = usingCustomTrim
        ? `Select a larger trim — and verify you entered the trim's RATED Cv (its capacity at 100% open), not the port designation. On a vendor sheet listing "0.38 / 3.60 / Equal %", the rated Cv is 3.60.`
        : `Select: ${sizes.larger.s}.`;
      warns.push({ cls:'warn-red', txt:`⚠️ IMPOSSIBLE OPERATING POINT — required Cv ${fmtN(Cv)} exceeds the rated Cv of ${sizes.rec.s} (${sizes.rec.Cv_rated}): the valve cannot pass this flow at any opening. ${suggestion}` });
    }
// ── VALVE GAIN / HUNTING SCREEN (inherent gain at operating opening) ──────
    //   Inherent gain = d(Cv/Cv_rated)/d(travel). Linear ≈ 1.0; equal-% rises
    //   toward ln(R) (~3.9 at R=50) near full open. High gain at the operating
    //   point makes the loop hard to tune and prone to hunting. NOTE: true
    //   INSTALLED gain additionally depends on the system ΔP curve (α), which
    //   this sizing view does not know — so this is an inherent-gain screen.
    let valveGain = null;
    if (openPct_rec > 0 && openPct_rec <= 100) {
      const hOp = Math.min(Math.max(openPct_rec / 100, 0.005), 0.995);
      const g   = (charFunc_srv(charType, Math.min(hOp + 0.01, 1), R_trim)
                 - charFunc_srv(charType, Math.max(hOp - 0.01, 0), R_trim)) / 0.02;
      valveGain = +g.toFixed(2);
      if (valveGain > 2.5)
        warns.push({ cls:'warn-amber', txt:`⚠ High inherent valve gain (${valveGain}) at the ${openPct_rec.toFixed(0)}% operating point — the loop may be hard to tune and prone to hunting. Consider linear trim, a smaller rated Cv (operate lower on the curve), or reduced controller gain. (Installed gain also depends on the system ΔP curve.)` });
    }

// ── TURNDOWN / Q_MIN CHECK ───────────────────────────────────────────────
    let Cv_min = null, turndown = null, turndownOk = null;
    if (Q_min_raw && Q_min_raw > 0 && Q_min_raw < Q) {
      // FIX V-7: Cv_min was recomputed per-phase, and the gas branch used
      //   sqrt(dPeff in psi) where the IEC gas equation needs sqrt(x) — the
      //   dimensionless dP/P1 ratio — understating Cv_min by ~10-15x and
      //   inflating the reported turndown accordingly (e.g. 208:1 for a true
      //   15:1 service). At identical pressures, Cv scales exactly linearly
      //   with flow for every phase (all pressure/Y/FF terms cancel), and this
      //   also inherits the Fp and FR corrections consistently.
      Cv_min = Cv * (Q_min_raw / Q);
      turndown   = Cv / Math.max(Cv_min, 0.0001);
      turndownOk = turndown <= R_trim;
      if (!turndownOk)
        warns.push({ cls:'warn-amber',
          txt:`⚠ Turndown ${turndown.toFixed(1)}:1 exceeds valve rangeability R=${R_trim}. Consider larger trim or split-range control.` });
      else if (Cv_min < sizes.rec.Cv_rated * 0.03)
        warns.push({ cls:'warn-amber',
          txt:`⚠ Cv at minimum flow (${fmtN(Cv_min)}) is < 3% of rated Cv — poor low-flow controllability. Consider characterised trim.` });
    }
      
    // ── FIX V-6: PREFERRED TRIM RECOMMENDATION ───────────────────────────────
    //   Rule of thumb: the trim should place the max design flow at 60-80%
    //   open on its inherent characteristic. Candidate rated-Cv values follow
    //   the decade series used by most reduced-trim catalogues
    //   (1.0 / 1.6 / 2.5 / 4.0 / 6.3 / 10 ...). The smallest series value that
    //   keeps max flow <= 80% open is preferred (it also maximises the min-flow
    //   opening). This is generic guidance — actual vendor trim steps differ,
    //   so the quoted trim's rated Cv should be entered once known.
    const trimSeries = [0.1,0.16,0.25,0.4,0.63,1.0,1.6,2.5,4.0,6.3,10,16,25,40,63,100,160,250,400,630,1000,1600,2500,4000,6300];
    let trimRec = null;
    {
      const f80 = charFunc_srv(charType, 0.80, R_trim);   // Cv fraction at 80% travel
      const f60 = charFunc_srv(charType, 0.60, R_trim);   // Cv fraction at 60% travel
      const ratedLo = Cv / Math.max(f80, 0.01);           // smallest sensible rated Cv
      const ratedHi = Cv / Math.max(f60, 0.01);           // largest sensible rated Cv
      const pick = trimSeries.find(s => s >= ratedLo) || null;
      if (pick) {
        const openMax = invertChar(charType, Math.min(Cv / pick, 1.5), R_trim);
        const openMin = (Cv_min != null)
          ? invertChar(charType, Math.min(Cv_min / pick, 1.5), R_trim)
          : null;
        const minCtrlCv = charType === 'equal_pct' ? pick / R_trim : null;
        trimRec = {
          Cv_rated: pick,
          bandLo:   +ratedLo.toFixed(3),
          bandHi:   +ratedHi.toFixed(3),
          openMax:  +openMax.toFixed(1),
          openMin:  openMin != null ? +openMin.toFixed(1) : null,
          minOk:    (Cv_min == null) ? null
                    : (minCtrlCv != null ? Cv_min > minCtrlCv * 1.1 : openMin >= 10),
        };
        if (trimRec.minOk === false)
          warns.push({ cls:'warn-amber', txt:`⚠ Preferred trim (rated Cv ${pick}) covers max flow at ${trimRec.openMax}% open, but minimum flow (Cv ${fmtN(Cv_min)}) sits at/below its controllable floor — the turndown may need a characterized trim or split-range arrangement. Confirm the low end against the vendor's actual trim curve.` });
      }
    }

    // ── FIX V-9: HEADLINE OPENING ─────────────────────────────────────────────
    //   When the body is line-anchored and capacity must come from a reduced
    //   trim, the opening of the FULL-PORT bore (e.g. 0.9%) is meaningless and
    //   alarming as a headline. Report the opening on the preferred trim
    //   instead, clearly labelled, until the actual vendor trim Cv is entered.
    let openPct_display = openPct_rec;
    let openDisplayNote = null;
    if (bodyNote === 'reducedTrim' && !usingCustomTrim && trimRec) {
      openPct_display = trimRec.openMax;
      openDisplayNote = 'on preferred trim Cv ' + trimRec.Cv_rated;
    }

    // ── DISPLAY LABELS (all formatting done server side) ──────────────────────
    const pu       = m ? 'bar' : 'psi';
    const dp2label = v => v == null ? '—' : (m ? (v / 14.5038).toFixed(3) : v.toFixed(2)) + ' ' + pu;

    return res.status(200).json({
      Cv:              fmtN(Cv),
      Kv:              fmtN(Kv),
      CvLabel:         fmtN(Cv) == null ? '—' : String(fmtN(Cv)),
      KvLabel:         fmtN(Kv) == null ? '—' : String(fmtN(Kv)),
      vel:             fmtN(vel_disp),
      velLabel:        (fmtN(vel_disp) ?? '—') + ' ' + (m ? 'm/s' : 'ft/s'),
      velOk,
      velLim,
      dP,   dPeff,   dPmax,
      dPLabel:         dp2label(dP),
      dPeffLabel:      dp2label(dPeff),
      dPmaxLabel:      isL || isS ? dp2label(dPmax) : 'x_crit=' + ((k / 1.4) * FL).toFixed(3),
      dpRatioPct:      ((dP / Math.max(P1a, 0.001)) * 100).toFixed(1),
      Y:               isG ? fmtN(Y) : null,
      Rev:             isL && Rev != null ? Rev : null,
      flowState,
      noiseDb,
      sizes,
      usingCustomTrim,
      openBasis,
      openFlags,
      trimRec,
      bodyNote,
      openPct_display,
      openDisplayNote,
      openPct_rec,
      openPct_smaller,
      openPct_larger,
      warns,
      // Display labels
      sgLabel:         SG.toFixed(3) + (isL ? ' (SG)' : isG ? ' g/mol' : ' (steam MW=18.02)'),
      // FIX 6: Use original T input for display, not back-converted T_F
      //   T_F was derived from T via T*9/5+32; converting back via (T_F-32)*5/9
      //   introduces floating-point rounding (e.g. 20.000°C → 19.999°C)
      tempLabel:       m ? T.toFixed(1) + '°C' : T_F.toFixed(1) + '°F',
      flLabel:         FL.toFixed(3) + (isG ? ' (xT)' : ' (FL)'),
      pipeLabel:       m ? (D_in * 25.4).toFixed(1) + ' mm' : D_in.toFixed(3) + ' in',
       
Fp:              Fp < 1.0 ? +Fp.toFixed(4) : Fp_g < 1.0 ? +Fp_g.toFixed(4) : 1.0,
      FpLabel:         Fp < 1.0 ? Fp.toFixed(3) : Fp_g < 1.0 ? Fp_g.toFixed(3) : '1.000',
      Cv_min:          Cv_min!=null ? fmtN(Cv_min) : null,
      turndown:        turndown!=null ? +turndown.toFixed(1) : null,
      turndownOk,
      sigma:           isL ? +((P1a - Pva) / Math.max(dP, 0.0001)).toFixed(2) : null, // cavitation index σ = (P1−Pv)/ΔP
      Kc:              +(FL * FL).toFixed(3),                                           // cavitation coefficient Kc ≈ FL²
      valveGain,                                                                        // inherent gain at operating opening
       });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
// ══════════════════════════════════════════════════════════════════════════════
//  MULTI-CASE ANALYSIS  —  fires only when body.cases[] is present
// ══════════════════════════════════════════════════════════════════════════════
function multiCaseAnalysis(req,res){
  try{
    const b=req.body||{};
    const shared={
      phase:b.phase,flowType:b.flowType,units:b.units,SG:b.SG,Pv:b.Pv,D:b.D,FL:b.FL,k:b.k,
      Z:b.Z,Z2:b.Z2,fluidVisc:b.fluidVisc,fluidPc:b.fluidPc,steamFluid:b.steamFluid,Fd:b.Fd,
      tp:b.tp,pClass:b.pClass,
    };
    const m=(b.units||'imp')==='met';
    const cases=(Array.isArray(b.cases)&&b.cases.length)?b.cases:[{...b,label:b.label||'Design'}];

    const results=cases.map((c,i)=>{
      const r=computeCase(c,shared);
      r.label=c.label||['Max','Mean','Min'][i]||`Case ${i+1}`;
      r.inputs={Q:c.Q,P1:c.P1,P2:c.P2,T:c.T ?? b.T};
      return r;
    });

    const pClass=parseInt(b.pClass)||300;
    const matGroup=B16_34[b.matGroup]?b.matGroup:'1.1';
    const tmaxC=Math.max(...cases.map(c=>parseFloat(c.T ?? b.T)||0));
    const tmaxF=m?tmaxC*9/5+32:(parseFloat(b.T)||100);
    const pmax_psig=b16_34_rating_psig(pClass,tmaxF,matGroup);
    const pmax_disp=pmax_psig!=null?(m?+(pmax_psig/14.2233).toFixed(2):+pmax_psig.toFixed(0)):null;
    const pmaxUnit=m?'kgf/cm²(g)':'psig';
    // worst-case inlet pressure vs the rating (both gauge, psi)
    const p1maxAbs=Math.max(...cases.map(c=>parseFloat(c.P1 ?? b.P1)||0));
    const p1max_psig=(m?p1maxAbs*14.5038:p1maxAbs)-14.696;
    const p1max_disp=m?+(p1max_psig/14.2233).toFixed(2):+p1max_psig.toFixed(0);
    const marginPct=(pmax_psig!=null&&pmax_psig>0)?+(((pmax_psig-p1max_psig)/pmax_psig)*100).toFixed(1):null;
    const ratingOK=pmax_psig!=null?(p1max_psig<=pmax_psig):null;

    const cvVals=results.map(r=>parseFloat(r.Cv)||0);
    const CvMax=Math.max(...cvVals), CvMin=Math.min(...cvVals.filter(v=>v>0));
    const stdCv=[{s:'1"',Cv_rated:11},{s:'1.5"',Cv_rated:25},{s:'2"',Cv_rated:55},{s:'3"',Cv_rated:120},
      {s:'4"',Cv_rated:240},{s:'6"',Cv_rated:550},{s:'8"',Cv_rated:1000},{s:'10"',Cv_rated:1800},
      {s:'12"',Cv_rated:3000},{s:'14"',Cv_rated:4500},{s:'16"',Cv_rated:6500}];
    let ri=stdCv.findIndex(s=>s.Cv_rated*0.75>=CvMax); if(ri===-1)ri=stdCv.length-1; ri=Math.max(0,ri);
    const Cv100=parseFloat(b.Cv_rated_custom)||stdCv[ri].Cv_rated;
    const R_trim=Math.max(10,Math.min(200,parseFloat(b.R_trim)||50));
    const charType=b.charType||'equal_pct';
    const invEq=(target)=>{ target=Math.min(Math.max(target,1e-6),1.5);
      const f=(h)=>charType==='linear'?h:charType==='quick_open'?Math.sqrt(h):Math.pow(R_trim,h-1);
      if(target>=1)return 100; let lo=0,hi=1; for(let i=0;i<60;i++){const md=(lo+hi)/2; if(f(md)<target)lo=md;else hi=md;} return 50*(lo+hi);};
    results.forEach(r=>{ r.openPct=+invEq((parseFloat(r.Cv)||0)/Cv100).toFixed(2); });

    const turndown=(CvMin>0)?+(CvMax/CvMin).toFixed(1):null;

    return res.status(200).json({
      ok:true, units:b.units||'imp',
      valve:{ size:stdCv[ri].s, Cv100:+Cv100.toFixed(1), charType, R_trim, pClass, pmax:pmax_disp, pmaxUnit },
      rating:{ pmax:pmax_disp, unit:pmaxUnit, class:pClass, tempF:+tmaxF.toFixed(0),
               material:B16_34_MAT[matGroup], group:matGroup,
               p1max:p1max_disp, marginPct, ok:ratingOK },
      turndown, cases:results, generatedAt:new Date().toISOString(),
    });
  }catch(err){ return res.status(500).json({error:err.message}); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  DISPATCHER  —  keeps the route name /api/control-valve.  Single-case bodies
//  hit the original handler verbatim (unchanged response shape); a body with a
//  cases[] array gets the new multi-case load-analysis report.
// ══════════════════════════════════════════════════════════════════════════════
function controlValve_handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'Method Not Allowed'});
  const b=req.body||{};
  if(Array.isArray(b.cases)&&b.cases.length) return multiCaseAnalysis(req,res);
  return controlValve_single(req,res);
}


// ── End of Section 02: Control Valve ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION B  ►  GAS EQUATION OF STATE (EOS)
// Route: /api/eos
// (Original: SECTION 04 of 21)
// FIX Z-4 (Jul 2026): merged from the control-valve auto-Z upgrade —
//   • solvePR: 1978 extended kappa for omega > 0.491
//   • eosPsat: saturation pressure by fugacity equality (Wilson init), pr/srk
//   • eosPhase: 'vapor' | 'near_dew' | 'liquid' | 'supercritical'
//   • response adds data.Psat_Pa + data.phase (superset — old fields untouched)
//   • warnings gain phase_liquid / phase_near_dew (the old "largest Z = vapour"
//     3-root note could not tell which phase is STABLE)
//   Consumed by the control-valve page zPhaseWarn banner + EOS calculator page.
//   Regression anchors (NIST/CoolProp-validated):
//     pr NH3 273.15 K / 10e5 Pa  -> Z 0.8854, Psat 4.293e5 Pa, phase 'liquid'
//     pr NH3 298.15 K /  5e5 Pa  -> Z 0.9576, Psat 10.04e5 Pa, phase 'vapor'
//     pr CO2 333.15 K / 50e5 Pa  -> Z 0.7919, phase 'supercritical'
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 04 of 21  ►  EQUATION OF STATE (EOS)
// Route: /api/eos
// Source: eos.js
// ══════════════════════════════════════════════════════════════════════════════

// ================================================================
// api/eos.js  —  Vercel Serverless Function
// 🔐 ALL CALCULATION LOGIC RUNS ON SERVER — NEVER EXPOSED TO BROWSER
// Place this file in your GitHub repo at: /api/eos.js
// ================================================================

function eos_handler(req, res) {
  // Allow CORS for your domain only
  const origin = req.headers.origin || '';
  const allowed = origin.endsWith('.vercel.app') || origin === 'https://multicalci.com';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://multicalci.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { eos, T_K, P_Pa, Tc_K, Pc_Pa, omega, M, n } = req.body;

    if (!eos)          return res.status(400).json({ error: 'Missing EOS type' });
    if (!isFinite(T_K)  || T_K  <= 0) return res.status(400).json({ error: 'Temperature must be positive and finite.' });
    if (!isFinite(P_Pa) || P_Pa <= 0) return res.status(400).json({ error: 'Pressure must be positive and finite.' });
    if (!isFinite(Tc_K) || Tc_K <= 0) return res.status(400).json({ error: 'Critical temperature Tc must be positive.' });
    if (!isFinite(Pc_Pa)|| Pc_Pa<= 0) return res.status(400).json({ error: 'Critical pressure Pc must be positive.' });
    if (!isFinite(M)    || M    <  1)  return res.status(400).json({ error: 'Molar mass must be ≥ 1 g/mol.' });
    if (!isFinite(n)    || n    <= 0)  return res.status(400).json({ error: 'Number of moles must be positive.' });
    if (T_K < 10) return res.status(400).json({ error: `Temperature ${T_K.toFixed(2)} K is below 10 K. EOS calculations are not reliable at near-absolute-zero temperatures.` });

    const roots = runEOS(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega);
    if (!roots.length) return res.status(400).json({ error: 'No real solution found — conditions may be below absolute minimum volume for this EOS. Try a lower pressure or higher temperature.' });

    const primary = roots.reduce((a, b) => a.Z > b.Z ? a : b);
    const Z       = primary.Z;

    if (!isFinite(Z) || Z <= 0) return res.status(400).json({ error: `EOS produced an invalid Z-factor (${Z}). Conditions may be in an unphysical region.` });
    if (Z > 20)                 return res.status(400).json({ error: `Z = ${Z.toFixed(3)} — unusually high. Check inputs.` });

    const phi      = primary.phi;
    const Vm_SI    = primary.Vm;
    const rho_mass = (1 / Vm_SI) * (M / 1000);
    const f_Pa     = phi * P_Pa;
    const Tr       = T_K / Tc_K;
    const Pr       = P_Pa / Pc_Pa;

    // FIX Z-4: definitive phase verdict via fugacity-equality Psat (pr/srk only)
    const Psat_Pa = eosPsat(eos, T_K, Tc_K, Pc_Pa, omega);
    const phase   = eosPhase(eos, T_K, P_Pa, Tc_K, Psat_Pa);

    const warnings = buildWarnings(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega, Z, Tr, Pr, roots);
    if (phase === 'liquid') {
      warnings.unshift({ type: 'phase_liquid',
        msg: `P (${(P_Pa/1e5).toFixed(2)} bar a) exceeds the saturation pressure at this temperature (Psat ≈ ${(Psat_Pa/1e5).toFixed(2)} bar a). The STABLE phase is LIQUID — the vapour-root Z reported here describes a phase that does not exist at these conditions.` });
    } else if (phase === 'near_dew') {
      warnings.unshift({ type: 'phase_near_dew',
        msg: `Within 5 % of saturation (Psat ≈ ${(Psat_Pa/1e5).toFixed(2)} bar a) — near-dew-point gas. Cubic-EOS Z accuracy is reduced and condensation is possible.` });
    }

    return res.status(200).json({
      success: true,
      data: {
        Z, phi, Vm_SI, rho_mass, f_Pa, Tr, Pr,
        Psat_Pa: Psat_Pa != null ? +Psat_Pa.toFixed(1) : null,   // FIX Z-4
        phase,                                                    // FIX Z-4
        roots: roots.map(r => ({ Z: r.Z, Vm: r.Vm, phi: r.phi, label: r.label })),
        rootCount: roots.length,
        eosParams: { A: primary.A, B: primary.B, a: primary.a, b: primary.b,
                     m: primary.m, kappa: primary.kappa, alpha: primary.alpha },
        warnings
      }
    });

  } catch (err) {
    return res.status(500).json({ error: 'Server calculation error: ' + err.message });
  }
}

// ================================================================
// 🔐 CORE CALCULATION ENGINE — HIDDEN ON SERVER
// ================================================================

const R = 8.314462; // J/(mol·K)

function solveCubic(c2, c1, c0) {
  const shift = -c2 / 3;
  const p = c1 - c2 * c2 / 3;
  const q = 2 * c2 * c2 * c2 / 27 - c1 * c2 / 3 + c0;
  const D = q * q / 4 + p * p * p / 27;
  let roots = [];

  if (D > 1e-10) {
    const sqrtD = Math.sqrt(D);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    roots = [u + v + shift];
  } else if (D < -1e-10) {
    const r       = Math.sqrt(-p * p * p / 27);
    const cosArg  = Math.max(-1, Math.min(1, -q / (2 * r)));
    const theta   = Math.acos(cosArg);
    const m       = 2 * Math.cbrt(r);
    roots = [
      m * Math.cos(theta / 3) + shift,
      m * Math.cos((theta + 2 * Math.PI) / 3) + shift,
      m * Math.cos((theta + 4 * Math.PI) / 3) + shift,
    ];
  } else {
    const u = Math.cbrt(-q / 2);
    roots = [2 * u + shift, -u + shift];
  }

  return roots.filter(z => z > 1e-6 && isFinite(z)).sort((a, b) => a - b);
}

function solveIdeal(T_K, P_Pa) {
  const Vm = R * T_K / P_Pa;
  return [{ Z: 1, Vm, phi: 1, label: 'Z = 1 (Ideal)' }];
}

function solveVdW(T_K, P_Pa, Tc_K, Pc_Pa) {
  const a  = 27 * R * R * Tc_K * Tc_K / (64 * Pc_Pa);
  const b  = R * Tc_K / (8 * Pc_Pa);
  const c2 = -(b + R * T_K / P_Pa);
  const c1 = a / P_Pa;
  const c0 = -a * b / P_Pa;
  const Vms = solveCubic(c2, c1, c0);
  return Vms.map((Vm, i) => {
    const Z     = P_Pa * Vm / (R * T_K);
    const lnPhi = b / (Vm - b) - Math.log(Math.max(1e-300, P_Pa * (Vm - b) / (R * T_K))) - 2 * a / (R * T_K * Vm);
    return { Z, Vm, phi: Math.exp(lnPhi), label: ['Vapour Z', 'Middle Z', 'Liquid Z'][i] || 'Z', a, b };
  });
}

function solveSRK(T_K, P_Pa, Tc_K, Pc_Pa, omega) {
  const a0          = 0.42748 * R * R * Tc_K * Tc_K / Pc_Pa;
  const b           = 0.08664 * R * Tc_K / Pc_Pa;
  const m           = 0.480 + 1.574 * omega - 0.176 * omega * omega;
  const Tr          = T_K / Tc_K;
  const sqrtTr      = Math.sqrt(Math.max(0, Tr));
  const alpha_base  = 1 + m * (1 - sqrtTr);
  const alpha       = Math.max(1e-6, alpha_base * alpha_base);
  const a           = a0 * alpha;
  const A           = a * P_Pa / (R * R * T_K * T_K);
  const B           = b * P_Pa / (R * T_K);
  const c2 = -1;
  const c1 = A - B - B * B;
  const c0 = -A * B;
  const Zs = solveCubic(c2, c1, c0);
  return Zs.map((Z, i) => {
    const Vm    = Z * R * T_K / P_Pa;
    const lnPhi = (Z - 1) - Math.log(Math.max(1e-300, Z - B)) - (A / B) * Math.log(Math.max(1e-300, 1 + B / Z));
    return { Z, Vm, phi: Math.exp(lnPhi), label: ['Vapour Z', 'Middle Z', 'Liquid Z'][i] || 'Z', A, B, a, b, m, alpha };
  });
}

function solvePR(T_K, P_Pa, Tc_K, Pc_Pa, omega) {
  const a0          = 0.45724 * R * R * Tc_K * Tc_K / Pc_Pa;
  const b           = 0.07780 * R * Tc_K / Pc_Pa;
  // FIX Z-4: 1978 extension for heavy/polar fluids — the 1976 kappa polynomial
  // was fitted only up to omega ~0.49; beyond that (heavy HCs, some polar
  // fluids) the extended cubic form is the published correction.
  const kappa       = omega <= 0.491
      ? 0.37464 + 1.54226 * omega - 0.26992 * omega * omega
      : 0.379642 + 1.48503 * omega - 0.164423 * omega * omega + 0.016666 * omega * omega * omega;
  const Tr          = T_K / Tc_K;
  const alpha_base  = 1 + kappa * (1 - Math.sqrt(Math.max(0, Tr)));
  const alpha       = Math.max(1e-6, alpha_base * alpha_base);
  const a           = a0 * alpha;
  const A           = a * P_Pa / (R * R * T_K * T_K);
  const B           = b * P_Pa / (R * T_K);
  const c2 = -(1 - B);
  const c1 = A - 3 * B * B - 2 * B;
  const c0 = -(A * B - B * B - B * B * B);
  const Zs = solveCubic(c2, c1, c0);
  return Zs.map((Z, i) => {
    const Vm     = Z * R * T_K / P_Pa;
    const sq2    = Math.SQRT2;
    const denom1 = Math.max(1e-300, Z + (1 + sq2) * B);
    const denom2 = Math.max(1e-300, Z + (1 - sq2) * B);
    const lnPhi  = (Z - 1) - Math.log(Math.max(1e-300, Z - B)) - A / (2 * sq2 * B) * Math.log(denom1 / denom2);
    return { Z, Vm, phi: Math.exp(lnPhi), label: ['Vapour Z', 'Middle Z', 'Liquid Z'][i] || 'Z', A, B, a, b, kappa, alpha };
  });
}

function runEOS(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega) {
  switch (eos) {
    case 'ideal': return solveIdeal(T_K, P_Pa);
    case 'vdw':   return solveVdW(T_K, P_Pa, Tc_K, Pc_Pa);
    case 'srk':   return solveSRK(T_K, P_Pa, Tc_K, Pc_Pa, omega);
    case 'pr':    return solvePR(T_K, P_Pa, Tc_K, Pc_Pa, omega);
    default: return [];
  }
}

// ── FIX Z-4 : saturation pressure & phase-stability verdict ──────────────────
// Motivation (found during NIST/CoolProp validation of the control-valve Z):
// "largest root = vapour" is only true when the vapour is the STABLE phase.
// At sub-saturation states (NH3 at 0 °C / 10 bar a, Psat = 4.29 bar) the old
// path returned a plausible-looking vapour Z = 0.885 for a phase that doesn't
// exist — the fluid is liquid. The definitive test is fugacity equality:
// Psat is the pressure where phi_liquid = phi_vapour. Solved here by direct
// substitution P(n+1) = P(n) * phi_L/phi_V from a Wilson-correlation start,
// reusing the existing solveSRK/solvePR machinery (works for both cubics).
// Validated vs NIST: PR Psat within 0.1–2 % (NH3 25 °C: 10.042 vs 10.027 bar;
// n-C4 25 °C: 2.430 vs 2.433 bar; Cl2 25 °C: 7.744 vs ~7.7 bar literature).
function eosPsat(eos, T_K, Tc_K, Pc_Pa, omega) {
  if (!(eos === 'pr' || eos === 'srk')) return null;   // needs an alpha-function cubic
  if (!(T_K < Tc_K)) return null;                       // no saturation above Tc
  let P = Pc_Pa * Math.exp(5.373 * (1 + omega) * (1 - Tc_K / T_K));  // Wilson init
  if (!(P > 0) || !isFinite(P)) return null;
  for (let i = 0; i < 60; i++) {
    const roots = runEOS(eos, T_K, P, Tc_K, Pc_Pa, omega);
    if (roots.length < 2) {                             // outside 3-root region — nudge in
      const zTop = roots.length ? Math.max(...roots.map(r => r.Z)) : 1;
      P *= zTop > 0.5 ? 1.05 : 0.95;
      continue;
    }
    const rV = roots.reduce((a, b) => (a.Z > b.Z ? a : b));
    const rL = roots.reduce((a, b) => (a.Z < b.Z ? a : b));
    if (!(rV.phi > 0) || !(rL.phi > 0)) return null;
    const Pn = P * (rL.phi / rV.phi);                   // phi_L/phi_V -> 1 at Psat
    if (!isFinite(Pn) || Pn <= 0) return null;
    if (Math.abs(Pn - P) / P < 1e-7) return Pn;
    P = Pn;
  }
  return P;                                             // best estimate after 60 iters
}

// 'vapor' | 'near_dew' | 'liquid' | 'supercritical' | null (ideal/vdw: no verdict)
function eosPhase(eos, T_K, P_Pa, Tc_K, Psat_Pa) {
  if (!(eos === 'pr' || eos === 'srk')) return null;
  if (T_K >= Tc_K) return 'supercritical';
  if (Psat_Pa == null) return 'vapor';
  if (P_Pa > Psat_Pa * 1.001) return 'liquid';
  if (P_Pa > Psat_Pa * 0.95)  return 'near_dew';
  return 'vapor';
}

function buildWarnings(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega, Z, Tr, Pr, roots) {
  const warnings = [];
  const POLAR_GASES_SET  = new Set(['H2O','MeOH','EtOH','iPrOH','nPrOH','nBuOH','iBuOH','nPenOH','EG','HF','FormAcid','AcAcid','PropAcid','NH3','HCN']);
  const QUANTUM_GASES    = new Set(['H2','He']);
  const ASSOC_GASES      = new Set(['AcAcid','FormAcid','PropAcid','HF']);

  if (Tr < 0.5)            warnings.push({ type: 'subcritical', msg: `Deep subcritical region (Tr = ${Tr.toFixed(3)}): Operating well below Tc. Liquid-phase properties may be unreliable.` });
  if (Math.abs(Tr-1)<0.05 && Math.abs(Pr-1)<0.05)
                           warnings.push({ type: 'critical', msg: `Near-critical region (Tr ≈ ${Tr.toFixed(3)}, Pr ≈ ${Pr.toFixed(3)}): EOS accuracy is reduced very close to the critical point.` });
  if (Pr > 10)             warnings.push({ type: 'highP', msg: `Very high reduced pressure (Pr = ${Pr.toFixed(2)}): Cubic EOS accuracy degrades at Pr > 10.` });
  else if (Pr > 5)         warnings.push({ type: 'highP', msg: `High reduced pressure (Pr = ${Pr.toFixed(2)}): Validate results at Pr > 5.` });
  if (eos === 'ideal' && Pr > 0.1) warnings.push({ type: 'ideal', msg: `Ideal gas law: only accurate at Pr < 0.1. At Pr = ${Pr.toFixed(3)}, switch to PR or SRK.` });
  if (eos === 'vdw')       warnings.push({ type: 'vdw', msg: 'van der Waals EOS is historical/qualitative (1873). Use PR or SRK for engineering work.' });
  if (roots.length === 3)  warnings.push({ type: 'twophase', msg: `Three real roots found (Tr=${Tr.toFixed(3)}, Pr=${Pr.toFixed(3)}) — possible two-phase region. Largest Z = vapour, smallest Z = liquid.` });
  if (Z > 2.0 && eos !== 'ideal') warnings.push({ type: 'highZ', msg: `Z = ${Z.toFixed(4)} is above typical range. Verify conditions.` });
  if (Z < 0.2 && Z > 0 && eos !== 'ideal') warnings.push({ type: 'lowZ', msg: `Very low Z-factor (Z = ${Z.toFixed(4)}) — may indicate liquid-like conditions.` });

  return warnings;
}

// ── End of Section 04: Equation of State (EOS) ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION C  ►  ORIFICE FLOW CALCULATOR
// Route: /api/orifice-flow
// (Original: SECTION 07 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 07 of 21  ►  ORIFICE FLOW
// Route: /api/orifice-flow
// Source: orifice-flow.js
// ══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
//  /api/calculate.js  —  Vercel Serverless Function
//  multicalci.com — ISO 5167 / AGA3 Orifice Flow Calculator
//
//  ALL calculation logic lives here:
//    • ISO 5167-2:2022 Reader-Harris/Gallagher Cd equation
//    • IAPWS-IF97 steam density (Region 1 + Region 2, full 43-term)
//    • Pitzer Z correlation, Sutherland viscosity
//    • Expansibility factor Y (orifice + nozzle/venturi)
//    • Pressure recovery / permanent pressure loss
//    • Uncertainty estimation (ISO GUM)
//    • Iterative flow / ΔP / bore-size solvers (Newton-Raphson)
//    • All unit conversions (DP, flow, dimensions) → SI internally
//
//  Client only sends raw form values + unit labels.
//  Client only receives final results + warnings JSON.
// ═══════════════════════════════════════════════════════════════════════

// ── REFERENCE CONDITIONS ──────────────────────────────────────────────
const REF_COND = {
  normal:   { T_K: 273.15, P_Pa: 101325 },   // 0°C, 1 atm
  standard: { T_K: 288.15, P_Pa: 101325 },   // 15°C, 1 atm
};

// ── UNIT CONVERSIONS ──────────────────────────────────────────────────
function dpToPa(val, unit) {
  const map = {
    mmH2O: 9.80665, inH2O: 249.089, Pa: 1, kPa: 1000,
    mbar: 100, bar: 1e5, psi: 6894.757, kgcm2: 98066.5,
  };
  return val * (map[unit] ?? 1);
}

function dimToMm(val, unit) {
  const map = { mm: 1, cm: 10, m: 1000, in: 25.4 };
  return val * (map[unit] ?? 1);
}

function flowToKgs(val, unit, rho_op, rho_n, rho_s) {
  switch (unit) {
    case 'kghr':   return val / 3600;
    case 'kgs':    return val;
    case 'tonhr':  return val * 1000 / 3600;
    case 'm3hr':   return (val * rho_op) / 3600;
    case 'Nm3hr':  return (val * rho_n)  / 3600;
    case 'Nm3day': return (val * rho_n)  / 86400;
    case 'Sm3hr':  return (val * rho_s)  / 3600;
    default:       return val / 3600;
  }
}

// ── ISO 5167-2:2022 Reader-Harris/Gallagher Cd ────────────────────────
// Clause 5.3.2.1, valid: D 50–1000 mm, β 0.1–0.75, Re_D ≥ 5000
function computeCd_ISO(Re, beta, tapType, D_mm) {
  if (!Re || Re < 100) Re = 1e6;
  const b  = beta;
  const b4 = Math.pow(b, 4);
  const A  = Math.pow(19000 * b / Re, 0.8);

  // Fixed Cd for nozzles/venturis
  const FIXED = { nozzle_isa: 0.9900, venturi_tube: 0.9850, venturi_nozzle: 0.9650 };
  if (FIXED[tapType] !== undefined) return FIXED[tapType];

  // Base RHG
  let Cd = 0.5961 + 0.0261*b*b - 0.216*Math.pow(b,8)
    + 0.000521 * Math.pow(1e6*b/Re, 0.7)
    + (0.0188 + 0.0063*A) * Math.pow(b, 3.5) * Math.pow(1e6/Re, 0.3);

  // Tap corrections (L1, L2)
  let L1 = 0, L2 = 0;
  if (tapType === 'sharp_flange') {
    L1 = 25.4 / (D_mm || 100);
    L2 = L1;
} else if (tapType === 'd_d2_tap') {
    L1 = 1.0; L2 = 0.47;
} else {
    L1 = 0; L2 = 0; // corner tap and sharp_corner
}

  const M2 = 2 * L2 / (1 - b);
  Cd += (0.0390 - 0.0337 * Math.pow(b,7)) * L1 * b4 / (1 - 4*b4);
  Cd -= 0.0116 * M2 * Math.pow(b, 1.3) * Math.pow(1 - 0.23*Math.pow(b, 5.5), -1) * (1 - 0.14*A);

  // Small pipe correction
  if ((D_mm || 100) < 71.12) {
    Cd += 0.011 * (0.75 - b) * (2.8 - (D_mm||100) / 25.4);
  }

  return Math.max(0.5, Math.min(1.0, Cd));
}

function getCd(Re, beta, tapType, D_mm, customCd) {
  if (tapType === 'custom_cd') {
    const v = parseFloat(customCd);
    return (!isNaN(v) && v >= 0.50 && v <= 0.95) ? v : 0.611;
  }
  return computeCd_ISO(Re, beta, tapType, D_mm);
}

// ── EXPANSIBILITY FACTOR Y (ISO 5167) ─────────────────────────────────
function computeY(beta, dp_Pa, P_Pa, k, tapType) {
  if (dp_Pa <= 0 || P_Pa <= 0) return 1;
  const tau = dp_Pa / P_Pa;

  if (['nozzle_isa','venturi_tube','venturi_nozzle'].includes(tapType)) {
    // ISO 5167-3/-4 §5.8: ε = √[ (κτ^(2/κ)/(κ−1)) · ((1−β⁴)/(1−β⁴τ^(2/κ))) · ((1−τ^((κ−1)/κ))/(1−τ)) ]
    // where τ = p2/p1 (downstream/upstream pressure ratio)
    const tau_r = 1 - tau;                 // p2/p1
    if (tau_r <= 0 || tau_r >= 1) return 0.667;
    const b4   = Math.pow(beta, 4);
    const tr2k = Math.pow(tau_r, 2/k);     // τ^(2/κ)
    const trk1 = Math.pow(tau_r, (k-1)/k); // τ^((κ−1)/κ)
    const num  = k * tr2k * (1 - b4) * (1 - trk1);
    const den  = (k - 1) * (1 - b4*tr2k) * (1 - tau_r);
    return (den > 0 && num > 0) ? Math.max(0.5, Math.min(1.0, Math.sqrt(num/den))) : 1;
  }

  // Orifice — ISO 5167-2:2003/2022 §5.3.3.2 (all tap arrangements):
  // ε = 1 − (0.351 + 0.256β⁴ + 0.93β⁸)·[1 − (p2/p1)^(1/κ)]
  const tau_r_o = 1 - tau; // p2/p1
  if (tau_r_o <= 0) return 0.667;
  const b4o = Math.pow(beta, 4);
  return Math.max(0.50, Math.min(1.0,
    1 - (0.351 + 0.256*b4o + 0.93*b4o*b4o) * (1 - Math.pow(tau_r_o, 1/k))));
}

// ── PERMANENT PRESSURE LOSS (returns loss as % of measured Δp) ────────
function computePressureRecovery(beta, Cd, tapType) {
  // Devices WITH a divergent recovery cone: classical venturi & venturi nozzle.
  // ISO 5167-4 §5.9: relative pressure loss ξ = Δϖ/Δp is 5–20 %.
  // Correlation for a 15° divergent section: ξ ≈ 0.436 − 0.86β + 0.59β²
  if (['venturi_tube','venturi_nozzle'].includes(tapType)) {
    const xi = 0.436 - 0.86*beta + 0.59*beta*beta;
    return Math.max(5, Math.min(25, xi * 100));
  }
  // Devices WITHOUT recovery cone: orifice plates & ISA nozzle.
  // ISO 5167-1 general relation: Δϖ/Δp = [√(1−β⁴(1−C²)) − Cβ²] / [√(1−β⁴(1−C²)) + Cβ²]
  const b2  = beta * beta;
  const b4  = b2 * b2;
  const num = Math.sqrt(1 - b4*(1-Cd*Cd)) - Cd*b2;
  const den = Math.sqrt(1 - b4*(1-Cd*Cd)) + Cd*b2;
  return den > 0 ? (num/den)*100 : 0;
}

// ── UNCERTAINTY ESTIMATE (ISO GUM / ISO 5167-1 §7) ───────────────────
function estimateUncertainty(beta, Re, tapType, isGas) {
  let u_Cd;
  if (tapType === 'nozzle_isa')                               u_Cd = 0.008;
  else if (['venturi_tube','venturi_nozzle'].includes(tapType)) u_Cd = 0.005;
  else if (Re > 1e5) u_Cd = 0.005;
  else if (Re > 1e4) u_Cd = 0.010;
  else               u_Cd = 0.020;

  const u_rho  = isGas ? 0.010 : 0.005;
  const u_dp   = 0.005;
  const u_beta = 0.001;
  const b4     = Math.pow(beta, 4);
  const u_beta_flow = 4 * u_beta * b4 / (1 - b4);
  const u_comb = Math.sqrt(u_Cd**2 + (0.5*u_dp)**2 + (0.5*u_rho)**2 + u_beta_flow**2);
  return (u_comb * 2 * 100).toFixed(2);
}

// ── STEAM VISCOSITY (IAPWS 2008 simplified) ───────────────────────────
function steamViscosity(T_K) {
  const T_bar = T_K / 647.096;
  const H = [1.67752, 2.20462, 0.6366564, -0.241605];
  let s = 0;
  for (let i = 0; i < 4; i++) s += H[i] / Math.pow(T_bar, i);
  return Math.max(8e-6, Math.min(3e-5, 1e-6 * 100 * Math.sqrt(T_bar) / s));
}

// ── IAPWS-IF97 Region 4 Ps(T) — Eq. (30), 273.16–647 K ───────────────
function waterPsat_Pa(T_K) {
  const T = Math.max(273.16, Math.min(647.0, T_K));
  const n1 =  0.11670521452767e4, n2 = -0.72421316703206e6,
        n3 = -0.17073846940092e2, n4 =  0.12020824702470e5,
        n5 = -0.32325550322333e7, n6 =  0.14915108613530e2,
        n7 = -0.48232657361591e4, n8 =  0.40511340542057e6,
        n9 = -0.23855557567849,   n10=  0.65017534844798e3;
  const th = T + n9 / (T - n10);
  const A  = th*th + n1*th + n2;
  const B  = n3*th*th + n4*th + n5;
  const C  = n6*th*th + n7*th + n8;
  const x  = 2*C / (-B + Math.sqrt(Math.max(B*B - 4*A*C, 0)));
  return Math.pow(x, 4) * 1e6; // Pa
}

// ── LIQUID WATER VISCOSITY (Vogel eq., 0–370 °C, ±2.5%) ─────────────
// μ = 2.414e-5 · 10^(247.8/(T−140))  → 8.90e-4 @25°C, 2.79e-4 @100°C
function waterLiquidViscosity(T_K) {
  const mu = 2.414e-5 * Math.pow(10, 247.8 / Math.max(T_K - 140, 10));
  return Math.max(5e-5, Math.min(2e-3, mu));
}

// ── SUTHERLAND VISCOSITY ──────────────────────────────────────────────
function sutherlandViscosity(f, T_K) {
  if (!f?.mu_ref) return f?.mu ?? 1.82e-5;
  const v = f.mu_ref * Math.pow(T_K / f.T_ref, 1.5) * (f.T_ref + f.S) / (T_K + f.S);
  return Math.max(1e-7, Math.min(1e-3, v));
}

// ── PITZER Z CORRELATION ──────────────────────────────────────────────
function pitzerZ(f, T_K, P_Pa) {
  if (!f?.Tc || !f?.Pc) return { Z: 1.0, outOfRange: false };
  const Tr = T_K / f.Tc;
  const Pr = (P_Pa / 1e6) / f.Pc;
  if (Tr < 0.5) return { Z: 1.0, outOfRange: true };
  const outOfRange = Pr > 0.9 || Tr < 0.7;
  const B0 = 0.083 - 0.422 / Math.pow(Tr, 1.6);
  const B1 = 0.139 - 0.172 / Math.pow(Tr, 4.2);
  const Z  = Math.max(0.5, Math.min(1.2, 1 + (B0 + (f.omega||0)*B1) * Pr / Tr));
  return { Z, outOfRange, Tr, Pr };
}

// ── IAPWS-IF97 STEAM DENSITY (full Region 1 + Region 2) ──────────────
function steamDensity(p_bar, t_c) {
  const P_MPa = p_bar * 0.1;
  const T     = t_c + 273.15;
  const R     = 461.526;

  // IAPWS-IF97 Region 4 backward equation Ts(p) — Eq. (31), valid 611 Pa–22.064 MPa
  function T_sat(p_MPa) {
    if (p_MPa <= 0) return 373.15;
    if (p_MPa >= 22.064) return 647.096;
    const n1 =  0.11670521452767e4, n2 = -0.72421316703206e6,
          n3 = -0.17073846940092e2, n4 =  0.12020824702470e5,
          n5 = -0.32325550322333e7, n6 =  0.14915108613530e2,
          n7 = -0.48232657361591e4, n8 =  0.40511340542057e6,
          n9 = -0.23855557567849,   n10=  0.65017534844798e3;
    const b  = Math.pow(p_MPa, 0.25);
    const E  = b*b + n3*b + n6;
    const F  = n1*b*b + n4*b + n7;
    const G  = n2*b*b + n5*b + n8;
    const D  = 2*G / (-F - Math.sqrt(Math.max(F*F - 4*E*G, 0)));
    const S  = n10 + D;
    const disc = S*S - 4*(n9 + n10*D);
    if (disc < 0) return 647.1;
    return (S - Math.sqrt(disc)) / 2;
  }

  const T_s = T_sat(P_MPa);

  // Region 1 — compressed liquid water
  // Degree-6 IAPWS-IF97 saturated-liquid polynomial (±0.5% for 0–360 °C);
  // pressure dependence of liquid density is negligible (<0.05%/10 bar) at metering conditions.
  // NOTE: liquid viscosity from Vogel eq. — steamViscosity() is a vapor-phase
  // correlation and under-predicts liquid μ by ~20× (1.2e-5 vs 2.8e-4 Pa·s at 100 °C).
  if (T < T_s - 0.5 || T <= 273.15) {
    const Tc6 = Math.max(0, Math.min(360, t_c));
    const T2 = Tc6*Tc6, T3 = T2*Tc6, T4 = T3*Tc6, T5 = T4*Tc6, T6 = T5*Tc6;
    let rho_liq = -3.430583e-12*T6 + 3.305509e-09*T5 - 1.216454e-06*T4
                  + 2.120305e-04*T3 - 2.009065e-02*T2 + 4.039409e-01*Tc6 + 998.117618;
    rho_liq = Math.max(500, Math.min(1005, rho_liq));
    return { rho: rho_liq, isSat: false, T_sat_C: T_s-273.15, mu: waterLiquidViscosity(T) };
  }

  const isSat = Math.abs(T - T_s) < 2.0;

  // Region 2 — superheated steam
  const tau2 = 540 / T;
  const pi2  = P_MPa;
  const Ir = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24];
  const Jr = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58];
  const nr = [
    -1.7731742473213e-3,-1.7834862292358e-2,-4.5996013696365e-2,-5.7581259083432e-2,
    -5.0325278727930e-2,-3.3032641670203e-5,-1.8948987516315e-4,-3.9392777243355e-3,
    -4.3797295650573e-2,-2.6674547914087e-5,2.0481737692310e-7,4.3870667284435e-7,
    -3.2277677238570e-5,-1.5033924542148e-2,-4.0668253562950e-2,-7.8847309559367e-10,
    1.2790717852285e-8,4.8225372718507e-7,2.2922076337661e-6,-1.6714766451061e-11,
    -2.1171472321355e-3,-2.3895741934104e-2,-5.9059564324270e-18,-1.2621808899101e-6,
    -3.8946842435739e-2,1.1256211360459e-11,-8.2311340897998e-2,1.9809712802088e-8,
    1.0406965210174e-19,-1.0234747095929e-13,-1.0018179379511e-9,-8.0882908646985e-11,
    1.0693031879409e-1,-3.3662250574171e-1,8.9185845355421e-25,3.0629316876232e-13,
    -4.2002467698208e-6,-5.9056029685639e-26,3.7826947613457e-6,-1.2768608934681e-15,
    7.3087610595061e-29,5.5414715350778e-17,-9.4369707241210e-7
  ];
  let phiR_pi = 0;
  for (let i = 0; i < nr.length; i++) {
    if (Ir[i]===0) continue;
    phiR_pi += nr[i] * Ir[i] * Math.pow(pi2, Ir[i]-1) * Math.pow(tau2-0.5, Jr[i]);
  }
  const v = (R * T / (P_MPa*1e6)) * pi2 * (1/pi2 + phiR_pi);
  return { rho: v > 0 ? 1/v : 1.0, isSat, T_sat_C: T_s-273.15, mu: steamViscosity(T) };
}

// ── INPUT VALIDATION ──────────────────────────────────────────────────
function validateInputs({ D_m, d_m, P_Pa, rho, mu, beta, Z }) {
  const errs = [];
  if (d_m >= D_m)           errs.push('Bore d must be smaller than pipe ID D');
  if (rho <= 0)             errs.push('Density must be > 0');
  if (mu  <= 0)             errs.push('Viscosity must be > 0 Pa·s');
  if (P_Pa <= 0)         errs.push('Pressure must be > 0 — ensure ABSOLUTE pressure is entered (not gauge)');
else if (P_Pa < 10000) errs.push(`Pressure = ${(P_Pa/1e5).toFixed(4)} bara — very low; confirm ABSOLUTE pressure (bara/psia), not gauge`);
  if (beta <= 0 || beta>=1) errs.push('Beta ratio β must be between 0 and 1 (exclusive)');
  const D_mm = D_m * 1000;
  if (D_mm < 50)   errs.push(`Pipe ID = ${D_mm.toFixed(1)} mm < ISO 5167 minimum 50 mm — small-pipe correction applied`);
  if (D_mm > 1000) errs.push(`Pipe ID = ${D_mm.toFixed(1)} mm > ISO 5167 maximum 1000 mm — Cd correlation outside validated range`);
  if (Z !== undefined && (Z <= 0 || Z > 3.0)) errs.push(`Z = ${Z} is physically impossible`);
  return errs;
}

// ═════════════════════════════════════════════════════════════════════
//  FLUID DATABASE (gas properties at reference conditions)
// ═════════════════════════════════════════════════════════════════════
const FLUID_DB_orifice = {
  'Air':            {t:'g',sg:1.000,M:28.964,k:1.400,mu:1.82e-5,Z:1.000,Tc:132.5,Pc:3.77, omega:0.035,mu_ref:1.716e-5,T_ref:273.15,S:110.4},
  'Nitrogen (N₂)':  {t:'g',sg:0.967,M:28.014,k:1.400,mu:1.76e-5,Z:1.000,Tc:126.2,Pc:3.39, omega:0.037,mu_ref:1.663e-5,T_ref:273.15,S:107.0},
  'Oxygen (O₂)':    {t:'g',sg:1.105,M:32.000,k:1.395,mu:2.01e-5,Z:1.000,Tc:154.6,Pc:5.04, omega:0.025,mu_ref:1.919e-5,T_ref:273.15,S:138.9},
  'Hydrogen (H₂)':  {t:'g',sg:0.070,M:2.016, k:1.405,mu:8.90e-6,Z:1.000,Tc:33.2, Pc:1.30, omega:-0.216,mu_ref:8.411e-6,T_ref:273.15,S:96.7},
  'CO₂':            {t:'g',sg:1.519,M:44.010,k:1.289,mu:1.48e-5,Z:0.994,Tc:304.1,Pc:7.38, omega:0.239,mu_ref:1.370e-5,T_ref:273.15,S:222.0},
  'CO':             {t:'g',sg:0.967,M:28.010,k:1.400,mu:1.77e-5,Z:1.000,Tc:132.9,Pc:3.50, omega:0.048,mu_ref:1.657e-5,T_ref:273.15,S:118.0},
  'Methane (CH₄)':  {t:'g',sg:0.554,M:16.043,k:1.304,mu:1.10e-5,Z:0.998,Tc:190.6,Pc:4.60, omega:0.012,mu_ref:1.030e-5,T_ref:273.15,S:164.0},
  'Propane (C₃H₈)': {t:'g',sg:1.522,M:44.097,k:1.130,mu:8.20e-6,Z:0.981,Tc:369.8,Pc:4.25, omega:0.152,mu_ref:7.550e-6,T_ref:273.15,S:278.0},
  'Butane (C₄H₁₀)': {t:'g',sg:2.009,M:58.124,k:1.100,mu:7.40e-6,Z:0.960,Tc:425.1,Pc:3.80, omega:0.200,mu_ref:6.870e-6,T_ref:273.15,S:329.0},
  'Natural Gas':    {t:'g',sg:0.620,M:17.967,k:1.310,mu:1.10e-5,Z:0.990,Tc:203.3,Pc:4.64, omega:0.010,mu_ref:1.027e-5,T_ref:273.15,S:170.0},
  'Ammonia (NH₃)':  {t:'g',sg:0.588,M:17.031,k:1.310,mu:1.00e-5,Z:0.995,Tc:405.6,Pc:11.28,omega:0.250,mu_ref:9.270e-6,T_ref:273.15,S:503.0},
  'Chlorine':       {t:'g',sg:2.448,M:70.906,k:1.340,mu:1.33e-5,Z:0.990,Tc:417.2,Pc:7.71, omega:0.069,mu_ref:1.234e-5,T_ref:273.15,S:351.0},
  'Argon':          {t:'g',sg:1.380,M:39.948,k:1.667,mu:2.27e-5,Z:1.000,Tc:150.9,Pc:4.87, omega:0.001,mu_ref:2.125e-5,T_ref:273.15,S:142.0},
  'Helium':         {t:'g',sg:0.138,M:4.003, k:1.667,mu:1.99e-5,Z:1.000,Tc:5.2,  Pc:0.23, omega:-0.390,mu_ref:1.875e-5,T_ref:273.15,S:79.4},
  'SO₂':            {t:'g',sg:2.264,M:64.065,k:1.290,mu:1.25e-5,Z:0.990,Tc:430.8,Pc:7.88, omega:0.245,mu_ref:1.163e-5,T_ref:273.15,S:416.0},
  'H₂S':            {t:'g',sg:1.189,M:34.081,k:1.320,mu:1.22e-5,Z:0.990,Tc:373.2,Pc:8.94, omega:0.100,mu_ref:1.130e-5,T_ref:273.15,S:331.0},
  'Ethane (C₂H₆)':  {t:'g',sg:1.049,M:30.069,k:1.200,mu:9.10e-6,Z:0.988,Tc:305.3,Pc:4.87, omega:0.099,mu_ref:8.560e-6,T_ref:273.15,S:252.0},
  'Ethylene':       {t:'g',sg:0.968,M:28.054,k:1.240,mu:1.02e-5,Z:0.993,Tc:282.4,Pc:5.04, omega:0.089,mu_ref:9.450e-6,T_ref:273.15,S:225.0},
  'Acetylene':      {t:'g',sg:0.897,M:26.038,k:1.232,mu:1.03e-5,Z:0.990,Tc:308.3,Pc:6.14, omega:0.187,mu_ref:9.570e-6,T_ref:273.15,S:234.0},
  'Flue Gas':       {t:'g',sg:1.000,M:28.964,k:1.350,mu:1.90e-5,Z:1.000,Tc:132.5,Pc:3.77, omega:0.035,mu_ref:1.716e-5,T_ref:273.15,S:110.4},
  'Syngas (3H₂:N₂)':{t:'g',sg:0.294,M:8.525, k:1.400,mu:1.37e-5,Z:1.000,Tc:56.5, Pc:1.82, omega:-0.150,mu_ref:1.300e-5,T_ref:273.15,S:100.0},
  'Biogas (60% CH₄)':{t:'g',sg:0.940,M:27.230,k:1.300,mu:1.29e-5,Z:0.995,Tc:236.0,Pc:5.71, omega:0.100,mu_ref:1.210e-5,T_ref:273.15,S:190.0},
  'LPG Vapor':      {t:'g',sg:1.716,M:49.708,k:1.110,mu:7.80e-6,Z:0.970,Tc:391.9,Pc:4.07, omega:0.170,mu_ref:7.280e-6,T_ref:273.15,S:298.0},
// ── Liquids ── rho0=kg/m³ at T0°C, beta_T=thermal expansion coefficient /°C
  // ρ(T) = rho0 / (1 + beta_T*(T - T0));  Tb_C = normal boiling point (mixtures: IBP, conservative)
  'Water':             {t:'l', rhoModel:'poly_water'},
  'Seawater':          {t:'l', rho0:1025.0, T0:20, beta_T:2.0e-4,  Tb_C:100.6},
  'Crude Oil (30API)': {t:'l', rho0:876.0,  T0:15, beta_T:7.0e-4,  Tb_C:35},
  'Diesel / Gas Oil':  {t:'l', rho0:840.0,  T0:15, beta_T:7.0e-4,  Tb_C:180},
  'Kerosene':          {t:'l', rho0:800.0,  T0:15, beta_T:8.0e-4,  Tb_C:150},
  'Gasoline':          {t:'l', rho0:720.0,  T0:15, beta_T:9.5e-4,  Tb_C:35},
  'Methanol':          {t:'l', rho0:791.0,  T0:20, beta_T:1.19e-3, Tb_C:64.7},
  'Ethanol':           {t:'l', rho0:789.0,  T0:20, beta_T:1.08e-3, Tb_C:78.4},
  'Toluene':           {t:'l', rho0:867.0,  T0:20, beta_T:1.07e-3, Tb_C:110.6},
  'Benzene':           {t:'l', rho0:879.0,  T0:20, beta_T:1.21e-3, Tb_C:80.1},
  'Acetone':           {t:'l', rho0:791.0,  T0:20, beta_T:1.46e-3, Tb_C:56.1},
  'Sulfuric Acid 98%': {t:'l', rho0:1836.0, T0:20, beta_T:5.5e-4,  Tb_C:310},
  'HCl 32%':           {t:'l', rho0:1157.0, T0:20, beta_T:4.5e-4,  Tb_C:84},
  'NaOH 50%':          {t:'l', rho0:1525.0, T0:20, beta_T:5.0e-4,  Tb_C:145},
  'MEA':               {t:'l', rho0:1018.0, T0:20, beta_T:8.0e-4,  Tb_C:170},
  'Glycerol':          {t:'l', rho0:1261.0, T0:20, beta_T:5.0e-4,  Tb_C:290},
  'Ethylene Glycol':   {t:'l', rho0:1113.0, T0:20, beta_T:6.0e-4,  Tb_C:197.3},
  // Liquefied gases: ant=[A,B,C] Antoine (log10 P_mmHg, T °C) — used for Pv since T ≫ Tb
  'Ammonia (liquid)':  {t:'l', rho0:610.0,  T0:20, beta_T:2.4e-3,  Tb_C:-33.3, ant:[7.36050, 926.132, 240.17]},
  'Propane (liquid)':  {t:'l', rho0:500.0,  T0:20, beta_T:3.0e-3,  Tb_C:-42.1, ant:[6.80338, 803.810, 246.99]},
  'Butane (liquid)':   {t:'l', rho0:579.0,  T0:20, beta_T:2.0e-3,  Tb_C:-0.5,  ant:[6.80896, 935.860, 238.73]},
  'Naphtha':           {t:'l', rho0:700.0,  T0:15, beta_T:1.0e-3,  Tb_C:35},
  'Condensate (HC)':   {t:'l', rho0:750.0,  T0:15, beta_T:9.0e-4,  Tb_C:30},
  'Fuel Oil (HFO)':    {t:'l', rho0:985.0,  T0:15, beta_T:6.4e-4,  Tb_C:250},
  'Lube Oil (VG46)':   {t:'l', rho0:870.0,  T0:15, beta_T:7.0e-4,  Tb_C:300},
  'Aqua Ammonia 25%':  {t:'l', rho0:907.0,  T0:20, beta_T:6.0e-4,  Tb_C:38},
  'Urea Solution 32.5%':{t:'l',rho0:1090.0, T0:20, beta_T:4.0e-4,  Tb_C:104},
  'MDEA 50%':          {t:'l', rho0:1040.0, T0:20, beta_T:6.0e-4,  Tb_C:110},
  'Hot Pot. Carbonate 30%':{t:'l',rho0:1270.0,T0:20,beta_T:4.5e-4, Tb_C:105},
  'Nitric Acid 60%':   {t:'l', rho0:1367.0, T0:20, beta_T:6.0e-4,  Tb_C:120},
};

// ═════════════════════════════════════════════════════════════════════
//  MAIN CALCULATION ENGINE
// ═════════════════════════════════════════════════════════════════════
function getReMin(b) {
    if (b <= 0.44) return 5000; if (b <= 0.56) return 10000; if (b <= 0.65) return 30000; return 170000;
  }
function calculate(params) {
  const {
    mode,                // 'flow' | 'dp' | 'beta'
    cat,                 // 'gas' | 'liquid' | 'steam'
    tapType,
    customCd,
    P_bar,               // absolute pressure in bar
    T_c,                 // temperature in °C
    Z_input,             // user compressibility factor
    k,                   // isentropic exponent
    mu_input,            // viscosity Pa·s (may be auto-updated for steam/gas)
    sg,                  // specific gravity (gas: vs air; liquid: vs water)
    MW_input,            // molar mass g/mol
    fluidKey,            // key in FLUID_DB_orifice or null
    D_mm,                // pipe ID in mm
    d_mm,                // orifice bore in mm
    dp_Pa_in,            // differential pressure in Pa (mode='flow' or 'beta')
    flow_in,             // flow target value
    flow_unit,           // unit of flow_in
  } = params;

  const isSteam = cat === 'steam';
  const isLiq   = cat === 'liquid';
  const isGas   = !isSteam && !isLiq;

  const P_Pa = P_bar * 1e5;
  const T_K  = T_c + 273.15;
  const D    = D_mm / 1000;
  const A_pipe = Math.PI / 4 * D * D;

  // ── DENSITY & AUTO FLUID PROPS ──────────────────────────────────────
  let rho_op, mu, Z_used, mu_auto, Z_auto, steamSatWarning = false, steamSatT = null;

  if (isSteam) {
    const sres = steamDensity(P_bar, T_c);
    rho_op = sres.rho;
    steamSatWarning = sres.isSat;
    steamSatT = sres.T_sat_C;
    mu = sres.mu;
    mu_auto = mu;
    Z_used  = 1;
 } else if (isLiq) {
    // Temperature-corrected liquid density: ρ(T) = ρ₀ / (1 + β·(T − T₀))
    const f_liq = FLUID_DB_orifice[fluidKey] || null;
   if (f_liq?.t === 'l' && f_liq.rhoModel === 'poly_water') {
      // IAPWS-IF97 sat liquid water — degree-6 poly, ±0.5% for 0–360°C
      // Clamp temperature BEFORE polynomial evaluation to prevent numerical instability
      const T = Math.max(0, Math.min(360, T_c));
      const T2 = T*T, T3 = T2*T, T4 = T3*T, T5 = T4*T, T6 = T5*T;
      rho_op = -3.430583e-12*T6 + 3.305509e-09*T5 - 1.216454e-06*T4
               + 2.120305e-04*T3 - 2.009065e-02*T2 + 4.039409e-01*T + 998.117618;
      rho_op = Math.max(100, Math.min(1005, rho_op));
    } else if (f_liq?.t === 'l' && f_liq.rho0 && f_liq.beta_T !== undefined) {
      // Linear thermal expansion model with safety bounds
      rho_op = f_liq.rho0 / (1 + f_liq.beta_T * (T_c - f_liq.T0));
      rho_op = Math.max(100, Math.min(1500, rho_op));
    } else {
      // Fallback: SG is dimensionless, multiply by water reference density (1000 kg/m³)
      rho_op = Math.max(100, Math.min(1500, sg * 1000));
    }
    mu     = mu_input;
    Z_used = 1;
  } else {
    // Gas
    const f = FLUID_DB_orifice[fluidKey] || null;
    let MW_use;
    if (f?.t === 'g') {
      MW_use = f.M;
      mu = sutherlandViscosity(f, T_K);
      mu_auto = mu;
      const zr = pitzerZ(f, T_K, P_Pa);
      Z_used = zr.Z;
      Z_auto = zr;
    } else {
      MW_use = (MW_input > 1 && MW_input < 500) ? MW_input : sg * 28.964;
      mu     = mu_input;
      Z_used = Z_input || 1;
    }
    rho_op = (P_Pa * MW_use) / (Z_used * 8314.46 * T_K);
  }

  if (!rho_op || rho_op <= 0) rho_op = 1.2;

  // ── REFERENCE DENSITIES ─────────────────────────────────────────────
  const f_db  = FLUID_DB_orifice[fluidKey] || null;
  const MW_final = f_db?.t==='g' ? f_db.M : (MW_input>1&&MW_input<500 ? MW_input : sg*28.964);
  const rho_n = isGas ? (REF_COND.normal.P_Pa * MW_final)   / (8314.46 * REF_COND.normal.T_K)   : 0;
  const rho_s = isGas ? (REF_COND.standard.P_Pa * MW_final) / (8314.46 * REF_COND.standard.T_K) : 0;

  // ── GEOMETRY ─────────────────────────────────────────────────────────
  let d_cur_m = (mode === 'beta') ? D * 0.5 : d_mm / 1000;
  const A2    = Math.PI / 4 * d_cur_m * d_cur_m;
  let beta    = d_cur_m / D;
  const calcE = (b) => 1 / Math.sqrt(1 - Math.pow(b, 4));

  let mass_h  = 0, dp_Pa = 0, d_calc_mm = d_mm, Cd = 0, Re_pipe = 0, Y_out = 1;

  // ══════════ MODE: FLOW RATE ══════════════════════════════════════════
  if (mode === 'flow') {
    dp_Pa = dp_Pa_in;
    const Y = isLiq ? 1 : computeY(beta, dp_Pa, P_Pa, k, tapType);
    Y_out  = Y;

    let Re_est = 1e6;
    Cd = getCd(Re_est, beta, tapType, D_mm, customCd);
    const E = calcE(beta);

    for (let iter = 0; iter < 15; iter++) {
      const qm_s = Cd * E * Y * A2 * Math.sqrt(2 * rho_op * dp_Pa);
      const v_p  = qm_s / (rho_op * A_pipe);
      Re_est     = (rho_op * v_p * D) / Math.max(mu, 1e-10);
      const CdNew = getCd(Re_est, beta, tapType, D_mm, customCd);
      if (Math.abs(CdNew - Cd) < 1e-8) break;
      Cd = CdNew;
    }
    mass_h = Cd * calcE(beta) * Y * A2 * Math.sqrt(2 * rho_op * dp_Pa) * 3600;

  // ══════════ MODE: DIFF PRESSURE ══════════════════════════════════════
  } else if (mode === 'dp') {
    let mass_kg_s;
    if (isSteam || isLiq) {
      if      (flow_unit === 'kgs')   mass_kg_s = flow_in;
      else if (flow_unit === 'tonhr') mass_kg_s = flow_in * 1000 / 3600;
      else if (flow_unit === 'm3hr')  mass_kg_s = flow_in * rho_op / 3600;
      else                            mass_kg_s = flow_in / 3600;
    } else {
      mass_kg_s = flowToKgs(flow_in, flow_unit, rho_op, rho_n, rho_s);
    }
    mass_h = mass_kg_s * 3600;

    const E = calcE(beta);
    let Cd_est = getCd(1e6, beta, tapType, D_mm, customCd);
    dp_Pa = Math.pow(mass_kg_s / (Cd_est * E * A2), 2) / (2 * rho_op);

    for (let iter = 0; iter < 20; iter++) {
      const Y_est = isLiq ? 1 : computeY(beta, dp_Pa, P_Pa, k, tapType);
      const v_p   = mass_kg_s / (rho_op * A_pipe);
      const Re    = (rho_op * v_p * D) / Math.max(mu, 1e-10);
      Cd = getCd(Re, beta, tapType, D_mm, customCd);
      const dp_new = Math.pow(mass_kg_s / (Cd * E * Y_est * A2), 2) / (2 * rho_op);
      if (Math.abs(dp_new - dp_Pa) < 0.001) { dp_Pa = dp_new; break; }
      dp_Pa = dp_new;
    }
    Y_out = isLiq ? 1 : computeY(beta, dp_Pa, P_Pa, k, tapType);

  // ══════════ MODE: BORE SIZE (Newton-Raphson) ══════════════════════════
  } else {
    dp_Pa = dp_Pa_in;
    let mass_kg_s;
    if (isSteam || isLiq) {
      if      (flow_unit === 'kgs')   mass_kg_s = flow_in;
      else if (flow_unit === 'tonhr') mass_kg_s = flow_in * 1000 / 3600;
      else if (flow_unit === 'm3hr')  mass_kg_s = flow_in * rho_op / 3600;
      else                            mass_kg_s = flow_in / 3600;
    } else {
      mass_kg_s = flowToKgs(flow_in, flow_unit, rho_op, rho_n, rho_s);
    }
    mass_h = mass_kg_s * 3600;

    let d_iter = D * 0.5;
    const tol = 1e-9, maxIt = 60, h = 1e-7;
    const fn = (d) => {
      const b2  = Math.min(Math.max(d/D, 0.05), 0.94);
      const b4  = Math.pow(b2, 4);
      const E2  = 1 / Math.sqrt(1 - b4);
      const A2i = Math.PI / 4 * d * d;
      const Y2  = isLiq ? 1 : computeY(b2, dp_Pa, P_Pa, k, tapType);
      const Re_d = mass_kg_s * D / (A_pipe * Math.max(mu, 1e-10));
      const Cd2  = getCd(Re_d, b2, tapType, D_mm, customCd);
      return Cd2 * E2 * Y2 * A2i * Math.sqrt(2 * rho_op * dp_Pa) - mass_kg_s;
    };
    for (let i = 0; i < maxIt; i++) {
      const fv   = fn(d_iter);
      const dfv  = (fn(d_iter + h) - fv) / h;
      if (Math.abs(dfv) < 1e-30) break;
      const d_new = Math.min(Math.max(d_iter - fv/dfv, D*0.05), D*0.94);
      if (Math.abs(d_new - d_iter) < tol || Math.abs(fv) < tol * mass_kg_s) break;
      d_iter = d_new;
    }

    d_calc_mm = d_iter * 1000;
    beta      = d_iter / D;
    d_cur_m   = d_iter;
    const v_p_b  = mass_kg_s / (rho_op * A_pipe);
    const Re_b   = (rho_op * v_p_b * D) / Math.max(mu, 1e-10);
    Cd    = getCd(Re_b, beta, tapType, D_mm, customCd);
    Y_out = null; // bore mode — Y not single-valued
  }

  // ── DERIVED QUANTITIES ──────────────────────────────────────────────
  const d_final   = (mode === 'beta') ? d_calc_mm / 1000 : d_cur_m;
  const A2_final  = Math.PI / 4 * d_final * d_final;
  beta = d_final / D;

  const v_orifice = (mass_h > 0 && rho_op > 0 && A2_final > 0) ? mass_h / (3600 * rho_op * A2_final) : 0;
  const v_pipe    = (mass_h > 0 && rho_op > 0 && A_pipe > 0)   ? mass_h / (3600 * rho_op * A_pipe)   : 0;
  Re_pipe = (rho_op * v_pipe * D) / Math.max(mu, 1e-10);
  if (Re_pipe > 0) Cd = getCd(Re_pipe, beta, tapType, D_mm, customCd);

  // ── PRESSURE LOSS ────────────────────────────────────────────────────
  const perm_pct = computePressureRecovery(beta, Cd, tapType);

  let dp_Pa_ref = dp_Pa;
  if (dp_Pa_ref <= 0) {
    // Fallback only when no valid Δp exists: back-calculate from mass flow.
    // Two-pass so Y is evaluated at the recovered Δp, not an arbitrary seed.
    const A2_f = Math.PI/4 * d_final**2;
    const E_f  = 1/Math.sqrt(1 - beta**4);
    const qm_s = mass_h / 3600;
    if (qm_s > 0 && Cd > 0 && E_f > 0 && A2_f > 0 && rho_op > 0) {
      let Y_f = 1;
      for (let p = 0; p < 2; p++) {
        dp_Pa_ref = Math.pow(qm_s / (Cd * E_f * Y_f * A2_f), 2) / (2 * rho_op);
        Y_f = isLiq ? 1 : computeY(beta, dp_Pa_ref, P_Pa, k, tapType);
      }
    }
  }
  const perm_Pa = (perm_pct / 100) * dp_Pa_ref;

  // ── VOLUMETRIC / REFERENCE FLOWS ─────────────────────────────────────
  const qv_act_m3h = rho_op > 0 ? mass_h / rho_op : 0;
  const nm3hr      = isGas && rho_n > 0 ? mass_h / rho_n : null;
  const sm3hr      = isGas && rho_s > 0 ? mass_h / rho_s : null;

  // ── UNCERTAINTY ──────────────────────────────────────────────────────
  const u_pct = estimateUncertainty(beta, Re_pipe, tapType, isGas);

  // ── WARNINGS ─────────────────────────────────────────────────────────
  const warns = [], infos = [];
  const valErrs = validateInputs({ D_m: D, d_m: d_final, P_Pa, rho: rho_op, mu, beta, Z: Z_used });
  valErrs.forEach(e => warns.push(e));

  const isNozzleType = ['nozzle_isa','venturi_nozzle'].includes(tapType);
  const betaMax = isNozzleType ? 0.80 : 0.75;
  if (beta < 0.20 || beta > betaMax) warns.push(`β=${beta.toFixed(4)} outside ISO 5167 range 0.20–${betaMax}`);
  if (beta > 0.70 && beta <= 0.75)   infos.push(`β=${beta.toFixed(4)} in high-beta range — verify corner tap validity`);
  if (!isLiq && dp_Pa > 0 && (dp_Pa/P_Pa) > 0.25) warns.push('⚡ ΔP/P > 0.25: Exceeds ISO 5167-2 expansibility factor validity limit');
  if (v_orifice > 100) warns.push(`Orifice velocity ${v_orifice.toFixed(1)} m/s very high — verify sizing`);
  // ── FLASHING / CAVITATION CHECK (ISO 5167 valid for single-phase only) ──
  // Flashing: downstream tap pressure p2 = P1 − Δp falls below vapor pressure Pv.
  // Cavitation: vena contracta pressure p_vc ≈ P1 − Δp/(1−β⁴) dips below Pv
  // (transient bubble collapse: signal noise, plate edge damage) even if p2 > Pv.
  const isCompressedWater = isSteam && steamSatT != null && T_c < steamSatT - 0.5;
  let pv_bar_out = null, throat_superheat_C = null;
  if ((isLiq || isCompressedWater) && dp_Pa > 0) {
    let Pv_Pa = null, pvEst = false;
    const fdbL = FLUID_DB_orifice[fluidKey] || null;
    if (isCompressedWater || fdbL?.rhoModel === 'poly_water') {
      Pv_Pa = waterPsat_Pa(T_K);                       // exact IF97 Region 4
    } else if (fdbL?.ant) {
      // Antoine: log10(P_mmHg) = A − B/(C + T°C) — for liquefied gases (T ≫ Tb)
      Pv_Pa = 133.322 * Math.pow(10, fdbL.ant[0] - fdbL.ant[1] / (fdbL.ant[2] + T_c));
    } else if (fdbL?.Tb_C != null) {
      // Clausius–Clapeyron + Trouton's rule (ΔSvap ≈ 88 J/mol·K) from normal boiling point.
      // Conservative (over-predicts Pv below Tb for polar liquids) — appropriate for a warning.
      Pv_Pa = 101325 * Math.exp(10.585 * (1 - (fdbL.Tb_C + 273.15) / T_K));
      pvEst = true;
    }
    if (Pv_Pa != null) {
      pv_bar_out = Pv_Pa / 1e5;
      const p2_Pa  = P_Pa - dp_Pa;
      const pvc_Pa = P_Pa - dp_Pa / Math.max(1 - Math.pow(beta, 4), 1e-6);
      const tag = pvEst ? ', estimated' : '';
      if (p2_Pa <= Pv_Pa)
        warns.push(`⚡ FLASHING: downstream pressure ${(p2_Pa/1e5).toFixed(3)} bara ≤ vapor pressure ${(Pv_Pa/1e5).toFixed(3)} bara${tag} — two-phase flow across the element; ISO 5167 correlation invalid, reading unreliable`);
      else if (pvc_Pa <= Pv_Pa)
        warns.push(`⚠ CAVITATION RISK: vena contracta pressure ≈ ${(pvc_Pa/1e5).toFixed(3)} bara ≤ vapor pressure ${(Pv_Pa/1e5).toFixed(3)} bara${tag} — bubble formation/collapse likely: signal noise, plate edge erosion`);
    } else if (isLiq && T_c > 80 && T_c < 120 && P_bar < 2.0) {
      // Fallback for custom liquids with no vapor-pressure data
      warns.push('⚠ Liquid near boiling point at low pressure — flashing possible (no vapor-pressure data for this fluid)');
    }
  }
  if (P_bar < 0.5) warns.push('⚠ Upstream pressure < 0.5 bara — verify ABSOLUTE pressure (bara/psia), not gauge');
  if (isSteam && steamSatWarning) infos.push(`Temperature near saturation (T_sat ≈ ${steamSatT?.toFixed(1)}°C) — verify steam quality`);
  // ── STEAM CONDENSATION-AT-THROAT CHECK ─────────────────────────────
  // Acceleration through the element cools the vapor ≈ isentropically:
  // T_th = T1·(p_th/p1)^((κ−1)/κ). If T_th ≤ T_sat(p_th), droplets nucleate
  // at the throat (locally wet flow) even when inlet steam is superheated.
  if (isSteam && !isCompressedWater && dp_Pa > 0 && (P_Pa - dp_Pa) > 1000) {
    const pth_Pa  = P_Pa - dp_Pa;
    const T_th_K  = T_K * Math.pow(pth_Pa / P_Pa, (k - 1) / k);
    const Tsat_th = steamDensity(pth_Pa / 1e5, T_c).T_sat_C + 273.15;
    throat_superheat_C = T_th_K - Tsat_th;
    if (throat_superheat_C <= 0)
      warns.push(`⚡ CONDENSATION AT THROAT: isentropic throat temperature ${(T_th_K - 273.15).toFixed(1)}°C ≤ local saturation ${(Tsat_th - 273.15).toFixed(1)}°C at ${(pth_Pa / 1e5).toFixed(2)} bara — locally wet two-phase flow; increase superheat or reduce ΔP`);
    else if (throat_superheat_C < 5)
      infos.push(`Throat superheat margin only ${throat_superheat_C.toFixed(1)}°C above local saturation — condensation risk on ΔP excursions`);
  }
  if (isSteam) infos.push('⚠ Wet steam (quality x<1) not modelled — ensure steam is dry/superheated at operating conditions');
  if (Re_pipe > 5000 && beta >= 0.20 && beta <= 0.75)
    infos.push('ISO 5167 requires ≥10–30 D upstream + ≥5 D downstream straight run');
    const Re_min = getReMin(beta);
  if (Re_pipe > 0 && Re_pipe < Re_min) warns.push(`Re=${Re_pipe.toFixed(0)} below ISO 5167 minimum (${Re_min} for β=${beta.toFixed(3)})`);
  if (Z_auto?.outOfRange)
    infos.push(`Pitzer Z validity: Tr=${Z_auto.Tr?.toFixed(2)}, Pr=${Z_auto.Pr?.toFixed(2)} — outside recommended range (Tr>0.7, Pr<0.9)`);

  // ── RESPONSE ──────────────────────────────────────────────────────────
  return {
    // Primary result
    mode,
    mass_kghr:      mass_h,
    mass_kgs:       mass_h / 3600,
    mass_tonhr:     mass_h / 1000,
    qv_act_m3hr:    qv_act_m3h,
    qv_act_m3s:     qv_act_m3h / 3600,
    nm3hr,
    nm3day:         nm3hr != null ? nm3hr * 24 : null,
    sm3hr,
    // DP (all units)
    dp_Pa,
    dp_mmH2O:       dp_Pa / 9.80665,
    dp_inH2O:       dp_Pa / 249.089,
    dp_kPa:         dp_Pa / 1000,
    dp_mbar:        dp_Pa / 100,
    dp_bar:         dp_Pa / 1e5,
    dp_psi:         dp_Pa / 6894.757,
    dp_kgcm2:       dp_Pa / 98066.5,
    // Bore
    bore_mm:        d_calc_mm,
    bore_in:        d_calc_mm / 25.4,
    beta,
    // Phase-integrity diagnostics (null when not applicable)
    pv_bar:             pv_bar_out,          // liquid vapor pressure at T (bara)
    throat_superheat_C: throat_superheat_C,  // steam: T_throat − T_sat(p_throat)
    // Fluid
    rho_op,
    mu_used:        mu,
    mu_auto:        mu_auto ?? null,
    Z_used,
    Z_auto:         Z_auto?.Z ?? null,
    Z_autoOutOfRange: Z_auto?.outOfRange ?? false,
    steamSatWarning,
    steamSatT,
    // Meter
    Cd,
    Y:              Y_out,
    E:              calcE(beta),
    Re_pipe,
    // Pressure loss
    perm_pct,
    perm_Pa,
    perm_mmH2O:     perm_Pa / 9.80665,
    perm_mbar:      perm_Pa / 100,
    perm_bar:       perm_Pa / 1e5,
    perm_kPa:       perm_Pa / 1000,
    perm_psi:       perm_Pa / 6894.757,
    // Uncertainty
    uncertainty_pct: u_pct,
    dp_P_ratio:      P_Pa > 0 ? dp_Pa / P_Pa : 0,
    // Velocities
    v_orifice,
    v_pipe,
    // Warnings
    warnings: warns,
    infos,
  };
}

// ═════════════════════════════════════════════════════════════════════
//  VERCEL HANDLER  (CommonJS — works with all Vercel Node runtimes)
// ═════════════════════════════════════════════════════════════════════

// Helper: set all CORS headers on a response object
function setCORS_orifice(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

// Helper: read raw POST body as text, then JSON-parse
function readBody(req) {
  return new Promise((resolve, reject) => {
    // Vercel may pre-parse body when Content-Type is application/json
    if (req.body && typeof req.body === 'object') {
      return resolve(req.body);
    }
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch(e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function orificeFlow_handler(req, res) {
  setCORS_orifice(res);

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const body = await readBody(req);
// ── DENSITY PREVIEW (lightweight — called on every T/P/fluid change) ──
    if (body.action === 'density-preview') {
      const isMetric = (body.unitSys || 'metric') === 'metric';
      let P_bar = parseFloat(body.P) || 10;
      let T_c   = parseFloat(body.T) || 20;
      if (!isMetric) { P_bar = P_bar * 0.0689476; T_c = (T_c - 32) * 5/9; }
      const T_K = T_c + 273.15;
      const P_Pa = P_bar * 1e5;
      const cat      = body.cat      || 'gas';
      const fluidKey = body.fluidKey || null;
      const sg_input = parseFloat(body.sg) || 1.0;

      let rho = null, mu_out = null, Z_out = null;

      if (cat === 'steam') {
        const sres = steamDensity(P_bar, T_c);
        rho    = sres.rho;
        mu_out = sres.mu;
      } else if (cat === 'liquid') {
        const f = FLUID_DB_orifice[fluidKey] || null;
        if (f?.t === 'l' && f.rho0 && f.beta_T !== undefined) {
          rho = f.rho0 / (1 + f.beta_T * (T_c - f.T0));
          rho = Math.max(100, rho);
        } else {
          rho = sg_input * 1000;
        }
      } else {
        // Gas
        const f = FLUID_DB_orifice[fluidKey] || null;
        if (f?.t === 'g') {
          const zr   = pitzerZ(f, T_K, P_Pa);
          Z_out      = zr.Z;
          mu_out     = sutherlandViscosity(f, T_K);
          const MW   = f.M;
          rho        = (P_Pa * MW) / (Z_out * 8314.46 * T_K);
        } else {
          const MW   = (parseFloat(body.MW) > 1) ? parseFloat(body.MW) : sg_input * 28.964;
          const Z    = parseFloat(body.Z) || 1;
          rho        = (P_Pa * MW) / (Z * 8314.46 * T_K);
        }
      }

      res.statusCode = 200;
      return res.end(JSON.stringify({
        ok: true,
        rho_op: rho,
        mu_auto: mu_out,
        Z_auto:  Z_out,
      }));
    }
    
    // ── PARSE & NORMALISE ALL INPUTS TO SI ──────────────────────────
    const mode     = body.mode    || 'flow';
    const cat      = body.cat     || 'gas';
    const tapType  = body.tapType || 'sharp_corner';
    const isMetric = (body.unitSys || 'metric') === 'metric';

    // Pressure & temperature
    let P_bar = parseFloat(body.P) || 10;
    let T_c   = parseFloat(body.T) || 20;
    if (!isMetric) { P_bar = P_bar * 0.0689476; T_c = (T_c - 32) * 5/9; }

    // Pipe & bore in mm
    const D_mm = dimToMm(parseFloat(body.D) || 154.05, body.D_unit || 'mm');
    const d_mm = dimToMm(parseFloat(body.d) || 75.00,  body.d_unit || 'mm');

    // DP in Pa
    const dp_Pa_in = dpToPa(parseFloat(body.dp) || 0, body.dp_unit || 'mmH2O');

    // Flow input
    const flow_in   = parseFloat(body.flow) || 0;
    const flow_unit = body.flow_unit || 'Nm3hr';

    const params = {
      mode, cat, tapType,
      customCd:  body.customCd,
      P_bar, T_c,
      Z_input:   parseFloat(body.Z)   || 1,
      k:         parseFloat(body.k)   || 1.4,
      mu_input:  parseFloat(body.mu)  || (cat === 'liquid' ? 1e-3 : 1.82e-5),
      sg:        parseFloat(body.sg)  || (cat === 'liquid' ? 1.0  : 0.65),
      MW_input:  parseFloat(body.MW)  || 28.964,
      fluidKey:  body.fluidKey || null,
      D_mm, d_mm, dp_Pa_in, flow_in, flow_unit,
    };

    const result = calculate(params);

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, ...result }));

  } catch (err) {
    console.error('orifice-flow.js error:', err);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
};

// ── End of Section 07: Orifice Flow ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION D  ►  PRESSURE DROP CALCULATOR
// Route: /api/pressure-drop-calculator
// (Original: SECTION 08 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 08 of 21  ►  PRESSURE DROP CALCULATOR
// Route: /api/pressure-drop-calculator
// Source: pressure-drop-calculator.js
// ══════════════════════════════════════════════════════════════════════════════

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

function setCORS_pdrop(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
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
const FLUID_DB_pdrop = [
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
   viscModel:'andrade', A:-6.40, B:2924.7, vapFixed:0.0003},

  {id:'teg',         name:'Triethylene Glycol (TEG)',   cat:'Glycols & Coolants',  isGas:false,
   rhoModel:'linear', rho0:1126, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:-9.64, B:3954.1, vapFixed:0.00001},

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
   viscModel:'andrade', A:-7.32, B:2393.4,
   Pv_A:8.1178, Pv_B:1580.92, Pv_C:219.61,
   vp:[[0,1.33],[20,4.38],[40,13.2],[82.3,101.3]]},

  {id:'nbutanol',    name:'n-Butanol',                   cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:810, Tref:20, k_rho:-0.82,
  viscModel:'andrade', A:-7.78, B:2598.0,
   Pv_A:7.8366, Pv_B:1558.19, Pv_C:196.88,
   vp:[[0,0.58],[20,0.59],[40,4.35],[50,6.9],[80,22.4],[117.7,101.3]]},

  {id:'glycerol',    name:'Glycerol (100%)',             cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:1261, Tref:20, k_rho:-0.65,
   viscModel:'andrade', A:4.50, B:5400.0,
   vp:[[20,0.0002],[60,0.004],[100,0.05],[150,0.55]]},

  {id:'glycerol50',  name:'Glycerol 50% in Water',      cat:'Alcohols',            isGas:false,
   rhoModel:'linear', rho0:1126, Tref:20, k_rho:-0.55,
   viscModel:'andrade', A:-8.43, B:3011.6,
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
   viscModel:'andrade', A:-6.90, B:2955.5,
   vp:[[20,3e-05],[100,0.01],[200,0.5]]},

  {id:'h2so4_50',    name:'Sulfuric Acid 50%',           cat:'Acids & Bases',       isGas:false,
   rhoModel:'linear', rho0:1395, Tref:25, k_rho:-0.80,
   viscModel:'andrade', A:-4.97, B:1845.6, vapFixed:0.020},

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
   viscModel:'andrade', A:-11.58, B:4692.1,
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
   viscModel:'andrade', A:-5.15, B:1739.6, vapFixed:0.001},

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
  const f = FLUID_DB_pdrop.find(x => x.id === id);
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
// FIX NPSH-2: friction factor extracted into a shared helper so the main line
// and the optional NPSH suction line use the SAME engine (Churchill 1977 for
// laminar/transitional, Swamee-Jain seed + Colebrook-White iteration for
// turbulent). Math is byte-identical to the previous inline block.
function dwFrictionFactor(Re, eps_m, Dm) {
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
  return f;
}

function calcPressureDrop(inputs) {
  let { D, L, Q, rho, mu, dz, epsBase, foulingMm, fittings, pumpEff, motorEff, unitMode } = inputs;

  // Validate
  if ([D, L, Q, rho, mu].some(v => !isFinite(v) || v <= 0))
    return { ok: false, error: 'All inputs must be positive finite numbers.' };
  if (mu < 0.00001)
    return { ok: false, error: 'Viscosity too low — check units (enter in cP, e.g. water = 1.0 cP).' };

  const eps = epsBase + Math.max(0, foulingMm);  // total roughness [mm]
  dz = isFinite(dz) ? dz : 0;
  const D_orig = D, L_orig = L, dz_orig = dz;
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

  const f = dwFrictionFactor(Re, eps_m, Dm);
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

  // ── FIX NPSH-2: optional suction-line hydraulics for the NPSH check ────────
  // Frontend sends suctionD (mm or in per unitMode) and suctionL (m or ft).
  // Same flow rate Qs, same fluid (rho SI, mu_Pa), same total roughness eps_m
  // as the main calculation. Velocity head AND suction friction head for
  // NPSH_A are then based on the ACTUAL suction line, not the main run.
  let npsh = null;
  {
    let sD = parseFloat(inputs.suctionD);
    let sL = parseFloat(inputs.suctionL);
    if (isFinite(sD) && sD > 0 && isFinite(sL) && sL > 0) {
      if (unitMode === 'imperial') { sD *= 25.4; sL *= 0.3048; }  // in→mm, ft→m
      const Dsm = sD / 1000;
      const As  = Math.PI * Dsm * Dsm / 4;
      const Vs  = Qs / As;
      const Res = rho * Vs * Dsm / mu_Pa;
      const fs  = Res >= 1 ? dwFrictionFactor(Res, eps_m, Dsm) : NaN;
      if (isFinite(fs) && fs > 0 && isFinite(Vs)) {
        const HfSuction = fs * (sL / Dsm) * Vs * Vs / (2 * 9.81);  // [m]
        npsh = {
          Vs:  parseFloat(Vs.toFixed(4)),          // suction velocity [m/s]
          Res: Math.round(Res),                    // suction Reynolds number
          fs:  parseFloat(fs.toFixed(6)),          // suction Darcy friction factor
          HfSuction: parseFloat(HfSuction.toFixed(4)),  // suction friction head [m]
          Ds_mm: parseFloat(sD.toFixed(2)),
          Ls_m:  parseFloat(sL.toFixed(2)),
        };
        if (Vs > 1.5 && rho > 500)
          warnings.push(`Suction line velocity ${Vs.toFixed(2)} m/s exceeds 1.5 m/s pump-suction guideline — increases friction loss and cavitation risk. Consider one size larger suction pipe.`);
        if (Res < 4000)
          warnings.push('Suction line in laminar/transitional regime — friction head uncertainty ±20–30%.');
      }
    }
  }

  return {
    ok: true,
    npsh,  // FIX NPSH-2: suction-line block (null when suction D/L not provided)
    dpDisp, dpPipeDisp, dpMinorDisp, dpElevDisp, dpUnit,
    velDisp, velUnit, headDisp, headUnit,
    V,  // FIX NPSH-1: raw SI velocity [m/s] — always metric regardless of unitMode.
        // Required by frontend calcNPSH() velocity-head term. Do NOT derive velocity
        // from dpTotal (√(2ΔP/ρ) is dynamic-pressure inversion, not pipe velocity).
    Re, f, Ktot,
    regime, regimeClass,
    Leq, epsTotalMm: eps, foulingMm,
    P_hyd, P_shaft, P_motor,
    Qs, dpTotal, dpPipe, dpMinor, dpElev,
    uncertPct, warnings,
    per100label: unitMode === 'imperial' ? 'ΔP per 100 ft' : 'ΔP per 100 m',
    lenUnit:  unitMode === 'imperial' ? 'ft' : 'm',
    diamUnit: unitMode === 'imperial' ? 'in' : 'mm',
    diameter: D_orig, length: L_orig, dz: dz_orig,
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
async function pressureDrop_handler(req, res) {
  setCORS_pdrop(req, res);

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
    const list = FLUID_DB_pdrop.map(f => ({
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
    // FIX NPSH-2: optional suction line for NPSH check (null → feature unused)
    const suctionD  = sanitizeNumber(body.suctionD, null);
    const suctionL  = sanitizeNumber(body.suctionL, null);

    // Sanitize fittings array
    const rawFits = Array.isArray(body.fittings) ? body.fittings.slice(0, 200) : [];
    const fittings = rawFits.map(f => ({
      k:   sanitizeNumber(f.k, 0),
      qty: Math.max(0, Math.min(999, parseInt(f.qty) || 0)),
    }));

    if ([D, L, Q, rho, mu].some(v => v === null))
      return err(res, 400, 'D, L, Q, rho, mu are required');

    const result = calcPressureDrop({ D, L, Q, rho, mu, dz, epsBase, foulingMm, fittings, pumpEff, motorEff, unitMode, suctionD, suctionL });
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

// ── End of Section 08: Pressure Drop Calculator ──────────────────────────────────────────



// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// SECTION E  ►  VESSEL & SEPARATOR SIZING
// Route: /api/vessel-separator-sizing  (also: /api/calculate — legacy alias)
// (Original: SECTION 15 of 21)
// ══════════════════════════════════════════════════════════════════════════════
// SECTION 15 of 21  ►  VESSEL & SEPARATOR SIZING
// Route: /api/vessel-separator-sizing
// Source: vessel-separator-sizing.js
// ══════════════════════════════════════════════════════════════════════════════

// Vercel Serverless API — Vessel & Separator Sizing Calculator
// Repo: github.com/nagtesting/nagtesting
// Path: /api/calculate.js
// ============================================================

// ========================================================================
// SECTION: NPSH VESSEL
// ========================================================================

// ── UNIT CONVERSION LIBRARY ──────────────────────────────────
function toM3h(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'm3h')    return val;
  if (u === 'm3s')    return val * 3600;
  if (u === 'ft3min') return val * 1.69901;
  if (u === 'mmscfd') return val * 1179.869;
  if (u === 'bpd')    return val * 0.00662458;
  if (u === 'gpm')    return val * 0.227125;
  return val;
}

function toKgm3(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'kgm3')  return val;
  if (u === 'lbft3') return val * 16.01846;
  return val;
}

function toMPag(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'MPa')  return val;
  if (u === 'barg') return val * 0.1;
  if (u === 'psi')  return val * 0.00689476;
  if (u === 'kPa')  return val * 0.001;
  if (u === 'ksi')  return val * 6.89476;
  return val;
}

function toBara(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'bara') return val;
  if (u === 'barg') return val + 1.01325;
  if (u === 'psia') return val * 0.0689476;
  if (u === 'psig') return (val + 14.696) * 0.0689476;
  if (u === 'MPa')  return val * 10;
  if (u === 'MPag') return val * 10 + 1.01325;
  return val;
}

function toMm(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'mm') return val;
  if (u === 'm')  return val * 1000;
  if (u === 'in') return val * 25.4;
  if (u === 'ft') return val * 304.8;
  return val;
}

function toMPaStress(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'MPa') return val;
  if (u === 'psi') return val * 0.00689476;
  if (u === 'ksi') return val * 6.89476;
  return val;
}

function toC(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'C') return val;
  if (u === 'F') return (val - 32) / 1.8;
  if (u === 'K') return val - 273.15;
  return val;
}

function toMs(val, u) {
  if (!isFinite(val)) return NaN;
  if (u === 'ms')  return val;
  if (u === 'fts') return val * 0.3048;
  return val;
}

// ── PRESSURE CORRECTION (GPSA Fig.7-3) ───────────────────────
function kPcorr(K_base, P_bara) {
  if (!isFinite(P_bara) || P_bara <= 7.0) return K_base;
  const corr = Math.max(0.45, 1 - 0.0040 * (P_bara - 7.0));
  return K_base * corr;
}

// ── STANDARD DIAMETERS ────────────────────────────────────────
const STD_D = [.30,.40,.50,.61,.762,.914,1.067,1.219,1.372,1.524,1.676,1.829,2.032,2.134,2.438,2.743,3.048,3.658,4.267];
function nearestStd(d) {
  if (!isFinite(d) || d <= 0) return STD_D[0];
  const f = STD_D.find(x => x >= d);
  return f !== undefined ? f : Math.ceil(d * 100) / 100;
}

const NPS = [
  [15,15.8,'½"'],[20,20.9,'¾"'],[25,26.6,'1"'],[40,40.9,'1½"'],[50,52.5,'2"'],
  [80,77.9,'3"'],[100,102.3,'4"'],[150,154.1,'6"'],[200,202.7,'8"'],[250,254.5,'10"'],
  [300,304.8,'12"'],[350,333.3,'14"'],[400,381,'16"'],[450,428.7,'18"'],
  [500,477.9,'20"'],[600,574.7,'24"'],[750,720,'30"']
];
function nearestNPS(dmm) {
  if (!isFinite(dmm) || dmm <= 0) return NPS[0];
  return NPS.find(n => n[1] >= dmm) || NPS[NPS.length - 1];
}

// ── CALC 1: HORIZONTAL 2-PHASE ────────────────────────────────
function calcH2P(p) {
  const Qg      = toM3h(p.Qg, p.Qg_u);
  const Ql      = toM3h(p.Ql, p.Ql_u);
  const rhog    = toKgm3(p.rhog, p.rhog_u);
  const rhol    = toKgm3(p.rhol, p.rhol_u);
  const T_C     = toC(p.T, p.T_u);
  const P_bara  = toBara(p.P, p.P_u);
  const tr      = parseFloat(p.tr);
  const LD      = parseFloat(p.LD);
  const K       = parseFloat(p.K);
  const surge   = parseFloat(p.surge);
  const margPct = parseFloat(p.margin) / 100;
  const llfrac  = parseFloat(p.llfrac);
  const svcFactor = parseFloat(p.svcFactor);

  if ([Qg,Ql,rhog,rhol,tr,LD,K].some(x => !isFinite(x) || x <= 0))
    return { error: 'Fill all flow, density and sizing fields with positive values.' };
  if (rhog >= rhol)
    return { error: 'Gas density must be less than liquid density.' };
  if (LD < 1.5 || LD > 8)
    return { error: 'L/D must be between 1.5 and 8 for a horizontal separator.' };

  const K_pcorr  = isFinite(P_bara) && P_bara > 0 ? kPcorr(K, P_bara) : K;
  const K_eff    = K_pcorr * svcFactor;
  const Uterm    = K_eff * Math.sqrt((rhol - rhog) / rhog);
  const Udesign  = margPct * Uterm;
  if (Udesign <= 0) return { error: 'Udesign ≤ 0 — check K and densities.' };

  const Qg_s      = Qg / 3600;
  const Ql_s      = Ql / 3600;
  const Vl_surge  = Ql_s * tr * 60 * surge;
  const D_liq     = Math.cbrt(Vl_surge / (llfrac * Math.PI / 4 * LD));
  const A_gas_req = Qg_s / Udesign;
  const D_gas     = Math.sqrt(A_gas_req / ((1 - llfrac) * Math.PI / 4));
  const D_calc    = Math.max(D_liq, D_gas);
  const D_std     = nearestStd(D_calc);
  const L         = Math.ceil(LD * D_std * 2) / 2;
  const A_gas_act = (1 - llfrac) * Math.PI * D_std * D_std / 4;
  const Uact      = Qg_s / A_gas_act;
  const ratio     = Uact / Uterm;
  const V_vessel  = Math.PI * D_std * D_std / 4 * L;
  const governs   = D_gas >= D_liq ? 'Gas velocity' : 'Liquid retention';

  let warns = [], status = 'PASS';
  if (ratio > margPct)   { warns.push(`⚠ Gas velocity ratio ${(ratio*100).toFixed(1)}% exceeds margin ${(margPct*100).toFixed(0)}%. Upsize vessel.`); status = 'WARN'; }
  if (LD < 2 || LD > 5)   warns.push(`⚠ L/D=${LD.toFixed(1)} outside typical 2–5 range for horizontal separators.`);
  if (svcFactor < 1.0)     warns.push(`⚠ Service derating applied (×${svcFactor}). Verify K with separator internals vendor.`);
  if (K_pcorr < K)         warns.push(`ℹ P-correction applied: K ${K.toFixed(4)} → K_pcorr ${K_pcorr.toFixed(4)} m/s.`);
  if (isFinite(T_C)) {
    if (T_C > 260) warns.push('⚠ T>260°C: Verify allowable stress S at operating temp (ASME Sec.II Part D).');
    if (T_C < -29) warns.push('⚠ T<−29°C: MDMT and Charpy impact testing per ASME UCS-66 may apply.');
  }
  if (D_std > 4.0) warns.push(`⚠ D=${D_std.toFixed(2)} m exceeds 4.0 m shop fabrication limit. Field fabrication or special transport required.`);
if (D_std > 4.267) warns.push(`⚠ D=${D_std.toFixed(2)} m exceeds standard vessel diameter list. Verify availability with fabricator.`);
  return {
    status, warns,
    results: [
      { label:'Calc. Min. D',         value: D_calc.toFixed(3)+' m', warn: false },
      { label:'Std. Vessel D',         value: D_std.toFixed(3)+' m ('+( D_std*39.37).toFixed(0)+'")', warn: false },
      { label:'Seam–Seam Length',      value: L.toFixed(1)+' m', warn: false },
      { label:'Actual L/D',            value: (L/D_std).toFixed(2), warn: (L/D_std)<2||(L/D_std)>5 },
      { label:'K_eff (P×svc)',         value: K_eff.toFixed(4)+' m/s', warn: K_eff<K },
      { label:'Uterm',                 value: Uterm.toFixed(3)+' m/s', warn: false },
      { label:'Udesign',               value: Udesign.toFixed(3)+' m/s', warn: false },
      { label:'Actual Gas Vel.',       value: Uact.toFixed(3)+' m/s', warn: ratio>margPct },
      { label:'Velocity Ratio',        value: (ratio*100).toFixed(1)+'%', warn: ratio>margPct },
      { label:'Liq. Hold-up (surged)', value: Vl_surge.toFixed(3)+' m³', warn: false },
      { label:'Vessel Volume',         value: V_vessel.toFixed(2)+' m³', warn: false },
      { label:'Governs',               value: governs, warn: false },
    ],
    summary: `Qg=${Qg.toFixed(1)} m³/h | Ql=${Ql.toFixed(1)} m³/h | ρg=${rhog.toFixed(2)} kg/m³ | ρl=${rhol.toFixed(1)} kg/m³${isFinite(T_C)?' | T='+T_C.toFixed(0)+'°C':''} | tr=${tr}min | surge×${surge} | llfrac=${(llfrac*100).toFixed(0)}%`
  };
}

// ── CALC 2: VERTICAL 2-PHASE ──────────────────────────────────
function calcV2P(p) {
  const Qg       = toM3h(p.Qg, p.Qg_u);
  const Ql       = toM3h(p.Ql, p.Ql_u);
  const rhog     = toKgm3(p.rhog, p.rhog_u);
  const rhol     = toKgm3(p.rhol, p.rhol_u);
  const T_C      = toC(p.T, p.T_u);
  const P_bara   = toBara(p.P, p.P_u);
  const tr       = parseFloat(p.tr);
  const K        = parseFloat(p.K);
  const surge    = parseFloat(p.surge);
  const margPct  = parseFloat(p.margin) / 100;
  const boot     = parseFloat(p.boot) || 0.3;
  const intern   = parseFloat(p.intern) || 0.4;
  const svcFactor = parseFloat(p.svcFactor);

  if ([Qg,Ql,rhog,rhol,tr,K].some(x => !isFinite(x) || x <= 0))
    return { error: 'Fill all fields with positive values.' };
  if (rhog >= rhol)
    return { error: 'Gas density must be less than liquid density.' };

  const K_pcorr  = isFinite(P_bara) && P_bara > 0 ? kPcorr(K, P_bara) : K;
  const K_eff    = K_pcorr * svcFactor;
  const Uterm    = K_eff * Math.sqrt((rhol - rhog) / rhog);
  const Udesign  = margPct * Uterm;
  if (Udesign <= 0) return { error: 'Udesign ≤ 0.' };

  const Qg_s       = Qg / 3600;
  const Ql_s       = Ql / 3600;
  const A_req      = Qg_s / Udesign;
  const D_min      = Math.sqrt(4 * A_req / Math.PI);
  const D_std      = nearestStd(D_min);
  const A_std      = Math.PI * D_std * D_std / 4;
  const Uact       = Qg_s / A_std;
  const ratio      = Uact / Uterm;
  const Vl_surge   = Ql_s * tr * 60 * surge;
  const H_liq_bare = Vl_surge / A_std;
  const H_liq_design = H_liq_bare + boot + 0.15;
  const H_shell    = H_liq_design + 0.6 * D_std + intern;
  const HD         = H_shell / D_std;

  let warns = [], status = 'PASS';
  if (ratio > margPct) { warns.push(`⚠ Gas velocity ${(ratio*100).toFixed(1)}% of Uterm exceeds ${(margPct*100).toFixed(0)}% margin.`); status = 'WARN'; }
  if (HD < 2 || HD > 6) { warns.push(`⚠ H/D=${HD.toFixed(2)} outside typical range 2–6. Check vessel proportions.`); if (HD > 6) status = 'WARN'; }
  if (svcFactor < 1.0) warns.push(`⚠ Service derating ×${svcFactor} applied.`);
  if (K_pcorr < K)     warns.push(`ℹ P-correction: K ${K.toFixed(4)} → ${K_pcorr.toFixed(4)} m/s.`);
  if (isFinite(T_C)) {
    if (T_C > 260) warns.push('⚠ T>260°C: Verify S at operating temp.');
    if (T_C < -29) warns.push('⚠ T<−29°C: MDMT check per ASME UCS-66.');
  }
  if (D_std > 4.0) warns.push(`⚠ D=${D_std.toFixed(2)} m: field fabrication required.`);
  if (D_std > 4.267) warns.push(`⚠ D=${D_std.toFixed(2)} m exceeds standard diameter list. Confirm availability with fabricator.`);

  return {
    status, warns,
    results: [
      { label:'Min. Calc. D',           value: D_min.toFixed(3)+' m', warn: false },
      { label:'Std. Vessel D',           value: D_std.toFixed(3)+' m ('+( D_std*39.37).toFixed(0)+'")', warn: false },
      { label:'Uterm',                   value: Uterm.toFixed(3)+' m/s', warn: false },
      { label:'Actual Gas Vel.',         value: Uact.toFixed(3)+' m/s', warn: ratio>margPct },
      { label:'Velocity Ratio',          value: (ratio*100).toFixed(1)+'%', warn: ratio>margPct },
      { label:'Liq. Hold-up (surged)',   value: Vl_surge.toFixed(3)+' m³', warn: false },
      { label:'Liq. Height (bare)',      value: H_liq_bare.toFixed(3)+' m', warn: false },
      { label:'Liq. Section (design)',   value: H_liq_design.toFixed(2)+' m', warn: false },
      { label:'Min. Shell Height',       value: H_shell.toFixed(2)+' m', warn: false },
      { label:'H/D Ratio',               value: HD.toFixed(2), warn: HD>6 },
    ],
    summary: `K_eff=${K_eff.toFixed(4)} | ρg=${rhog.toFixed(2)} | ρl=${rhol.toFixed(1)} kg/m³${isFinite(T_C)?' | T='+T_C.toFixed(0)+'°C':''} | tr=${tr}min | surge×${surge} | boot=${boot}m`
  };
}

// ── CALC 3: 3-PHASE HORIZONTAL ────────────────────────────────
function calc3P(p) {
  const Qg    = toM3h(p.Qg, p.Qg_u);
  const Qo    = toM3h(p.Qo, p.Qo_u);
  const Qw    = toM3h(p.Qw, p.Qw_u);
  const rhog  = toKgm3(p.rhog, p.rhog_u);
  const rhoo  = toKgm3(p.rhoo, p.rhoo_u);
  const rhow  = toKgm3(p.rhow, p.rhow_u);
  const P_bara = toBara(p.P, p.P_u);
  const tro   = parseFloat(p.tro);
  const trw   = parseFloat(p.trw);
  const LD    = parseFloat(p.LD);
  const K     = parseFloat(p.K);
  const surge = parseFloat(p.surge);
  const dp_um = parseFloat(p.dp_um);
  const mu_cP = parseFloat(p.mu_cP);
  const boot  = parseFloat(p.boot) || 0.3;
  const icm   = parseFloat(p.icm)  || 0.15;
  const svcFactor = parseFloat(p.svcFactor);
const platePack = p.platePack === true || p.platePack === 'true';
  const ppCredit  = platePack ? 0.60 : 1.0;
  if ([Qg,Qo,Qw,rhog,rhoo,rhow,tro,trw,LD,K].some(x => !isFinite(x)) || Qg<=0 || Qo<=0 || Qw<=0)
    return { error: 'Fill all fields with positive values.' };
  if (rhog >= rhoo || rhog >= rhow)
    return { error: 'Gas density must be less than both liquid densities.' };
  if (rhoo >= rhow)
    return { error: 'Oil density must be less than water density for normal separation.' };

  const Qg_s = Qg/3600, Qo_s = Qo/3600, Qw_s = Qw/3600;
  const K_pcorr  = isFinite(P_bara) && P_bara > 0 ? kPcorr(K, P_bara) : K;
  const K_eff    = K_pcorr * svcFactor;
  const Uterm    = K_eff * Math.sqrt((rhoo - rhog) / rhog);
  const Udesign  = 0.85 * Uterm;
   const Vo = Qo_s * tro * 60 * surge * ppCredit;
  const Vw = Qw_s * trw * 60 * surge * ppCredit;
  const Vliq     = Vo + Vw;
  const fo       = Vliq > 0 ? Vo / Vliq : 0;
  const D_liq    = Math.cbrt(Vliq / (0.5 * Math.PI / 4 * LD));
  const A_gas_req = Qg_s / Udesign;
  const D_gas    = Math.sqrt(8 * A_gas_req / Math.PI);
  const D        = Math.max(D_liq, D_gas);
  const D_std    = nearestStd(D);
  const L        = Math.ceil(LD * D_std * 2) / 2;
  const A_std    = Math.PI * D_std * D_std / 4;
  const A_gas_avail = 0.5 * A_std;
  const Uact     = Qg_s / A_gas_avail;
  const ratio    = Uact / Uterm;

  let stokesInfo = null;
  let stokesOk   = null;
  if (isFinite(dp_um) && dp_um > 0 && isFinite(mu_cP) && mu_cP > 0) {
    const dp_m    = dp_um * 1e-6;
    const mu_Pas  = mu_cP * 1e-3;
    const Vs      = dp_m * dp_m * (rhow - rhoo) * 9.81 / (18 * mu_Pas);
    const vLiq_fwd = (Qo_s + Qw_s) / (0.5 * A_std);
    const tDwell  = vLiq_fwd > 0 ? L / vLiq_fwd : 0;
    const H_settle_avail = Vs * tDwell;
    const H_water_layer  = Vw / (A_std * 0.5);
    stokesOk  = H_settle_avail >= H_water_layer;
    stokesInfo = { Vs: Vs.toFixed(5), tDwell: tDwell.toFixed(0), H_settle_avail: H_settle_avail.toFixed(3), H_water_layer: H_water_layer.toFixed(3), ok: stokesOk };
  }

  const H_oil  = fo > 0 ? Vo / (A_std * 0.5) : 0;
  const H_water_calc  = Vw > 0 ? Vw / (A_std * 0.5) : 0;
  const H_boot_design = H_water_calc + boot + icm;

  let warns = [], status = 'PASS';
  if (ratio > 0.85) { warns.push(`⚠ Gas velocity ${(ratio*100).toFixed(1)}% of Uterm. Upsize or add internals.`); status = 'WARN'; }
  if (stokesOk === false) { warns.push('⚠ Stokes check: oil droplet may NOT settle in available time. Increase L/D, reduce dp requirement, or add coalescer pack.'); status = 'WARN'; }
  if (svcFactor < 1.0) warns.push(`⚠ Service derating ×${svcFactor} applied to K.`);
  warns.push('ℹ 3-phase sized by retention time + Stokes check only. Emulsion, dynamic interface and upset behaviour require engineer review.');
  if (platePack) warns.push('ℹ Plate pack credit applied: retention time reduced by 40% per API 12J §6.4.4. Plate pack must be designed and installed per vendor specification. Credit valid only when plates cover full liquid cross-section.');

  return {
    status, warns, stokesInfo,
    results: [
      { label:'Std. Vessel D',           value: D_std.toFixed(3)+' m ('+( D_std*39.37).toFixed(0)+'")', warn: false },
      { label:'Vessel Length',           value: L.toFixed(2)+' m', warn: false },
      { label:'Oil Hold-up (surged)',    value: Vo.toFixed(3)+' m³', warn: false },
      { label:'Water Hold-up (surged)',  value: Vw.toFixed(3)+' m³', warn: false },
      { label:'Total Liquid Vol.',       value: Vliq.toFixed(3)+' m³', warn: false },
      { label:'Gas Uterm',               value: Uterm.toFixed(3)+' m/s', warn: false },
      { label:'Actual Gas Vel.',         value: Uact.toFixed(3)+' m/s', warn: ratio>0.85 },
      { label:'Oil Pad Height (est.)',   value: H_oil.toFixed(3)+' m', warn: false },
      { label:'Water Boot (design)',     value: H_boot_design.toFixed(3)+' m', warn: false },
      { label:'Oil Fraction',            value: (fo*100).toFixed(1)+'%', warn: false },
      { label:'Plate Pack Credit', value: platePack ? '✅ 40% applied (API 12J)' : 'Not applied', warn: false },
    ],
    summary: `K_eff=${K_eff.toFixed(4)} | ρg=${rhog.toFixed(2)} | ρo=${rhoo.toFixed(1)} | ρw=${rhow.toFixed(1)} kg/m³ | tro=${tro} | trw=${trw} min | icm=${icm}m`
  };
}

// ── CALC 4: PRESSURE VESSEL THICKNESS (ASME VIII) ─────────────
const ASME_STRESS_TABLE = {
  'SA516_70':  { name:'SA-516 Gr 70 (CS)',          S_amb:138, S_200:138, S_260:138, S_315:128, S_370:114, mdmt:-29  },
  'SA516_60':  { name:'SA-516 Gr 60 (CS)',          S_amb:118, S_200:118, S_260:118, S_315:110, S_370: 97, mdmt:-29  },
  'SA515_70':  { name:'SA-515 Gr 70 (CS HT)',       S_amb:138, S_200:138, S_260:138, S_315:128, S_370:114, mdmt:  0  },
  'SA387_11':  { name:'SA-387 Gr 11 Cl 2 (Cr-Mo)',  S_amb:155, S_200:155, S_260:155, S_315:150, S_370:145, mdmt:-29  },
  'SA387_22':  { name:'SA-387 Gr 22 Cl 2 (Cr-Mo)',  S_amb:138, S_200:138, S_260:138, S_315:134, S_370:128, mdmt:-29  },
  'SA240_304L':{ name:'SA-240 Tp 304L (SS)',         S_amb:115, S_200:107, S_260: 97, S_315: 87, S_370: 80, mdmt:-196 },
  'SA240_316L':{ name:'SA-240 Tp 316L (SS)',         S_amb:115, S_200:107, S_260: 97, S_315: 87, S_370: 80, mdmt:-196 },
  'SA240_317L':{ name:'SA-240 Tp 317L (SS)',         S_amb:115, S_200:108, S_260: 99, S_315: 90, S_370: 82, mdmt:-196 },
  'SA240_2205':{ name:'SA-240 S31803 Duplex 2205',   S_amb:172, S_200:158, S_260:144, S_315:130, S_370:null,mdmt:-50  },
  'SA333_6':   { name:'SA-333 Gr 6 (LTCS)',          S_amb:138, S_200:138, S_260:138, S_315:128, S_370:null,mdmt:-45  },
  'SA537_1':   { name:'SA-537 Cl 1 (HSLA)',          S_amb:155, S_200:155, S_260:148, S_315:138, S_370:null,mdmt:-29  },
};

function asmeStressAtTemp(matKey, T_C) {
  const m = ASME_STRESS_TABLE[matKey];
  if (!m) return null;
  if (!isFinite(T_C)) return m.S_amb;
  if (T_C <= 100) return m.S_amb;
  if (T_C <= 230) return m.S_200;
  if (T_C <= 285) return m.S_260;
  if (T_C <= 340) return m.S_315;
  return m.S_370 ?? m.S_315;
}

function calcPV(p) {
  const P      = toMPag(p.P, p.P_u);
  const D_mm   = toMm(p.D, p.D_u);
  const CA     = toMm(p.CA, p.CA_u);
  const head   = p.head;
  const minT   = parseFloat(p.minT);
  const T_C    = toC(p.T, p.T_u);
  const cat    = p.cat;
  const L_mm   = toMm(p.L, p.L_u);
  const matKey = p.matKey || '';
  const noz    = Array.isArray(p.nozzles) ? p.nozzles : [];

  // Material / Stress resolution
  let S, S_note = null;
  const matEntry = ASME_STRESS_TABLE[matKey];
  if (matEntry && isFinite(T_C)) {
    S = asmeStressAtTemp(matKey, T_C);
    S_note = `${matEntry.name} | S at ${T_C.toFixed(0)}°C = ${S} MPa (ASME Sec.II Part D)`;
    if (T_C > 400) S_note += ' ⚠ Above 400°C — verify S from Sec.II Part D table directly.';
  } else {
    S = toMPaStress(p.S, p.S_u);
  }

  const E = parseFloat(p.E);

  if ([P,D_mm,S,E,CA].some(x => !isFinite(x) || isNaN(x)) || P<=0 || D_mm<=0 || S<=0 || E<=0)
    return { error: 'Fill all design parameters with valid positive values.' };
  if (E > 1.0 || E < 0.1)
    return { error: 'Joint efficiency E must be 0.10 to 1.00.' };

  const R = D_mm / 2;
  if ((S*E - 0.6*P) <= 0)
    return { error: 'S×E−0.6×P ≤ 0: pressure exceeds allowable for this material/joint. Check inputs.' };

  // Shell UG-27
  const t_sh_calc = (P * R) / (S * E - 0.6 * P);
  const t_sh_net  = t_sh_calc + CA;
  const t_sh_nom  = Math.max(minT, Math.ceil(t_sh_net * 2) / 2);

  // Head
  let t_hd_calc = 0, head_label = '', headOk = true;
  if (head === 'ellipsoidal') {
    const d2 = 2*S*E - 0.2*P; headOk = d2 > 0;
    if (headOk) t_hd_calc = (P * D_mm) / d2;
    head_label = '2:1 Ellipsoidal [UG-32(d)]';
  } else if (head === 'hemispherical') {
    const d2 = 2*S*E - 0.2*P; headOk = d2 > 0;
    if (headOk) t_hd_calc = (P * R) / d2;
    head_label = 'Hemispherical [UG-32(f)]';
  } else if (head === 'conical30') {
    const a = 30*Math.PI/180, d2 = 2*Math.cos(a)*(S*E - 0.6*P); headOk = d2 > 0;
    if (headOk) t_hd_calc = (P * D_mm) / d2;
    head_label = 'Conical α=30° [UG-32(g)]';
  } else if (head === 'conical45') {
    const a = 45*Math.PI/180, d2 = 2*Math.cos(a)*(S*E - 0.6*P); headOk = d2 > 0;
    if (headOk) t_hd_calc = (P * D_mm) / d2;
    head_label = 'Conical α=45° [UG-32(g)]';
  } else {
    t_hd_calc = D_mm * Math.sqrt(0.162 * P / (S * E));
    head_label = 'Flat Cover [UG-34 simplified]';
    headOk = true;
  }
  const t_hd_net = headOk ? t_hd_calc + CA : 0;
  const t_hd_nom = headOk ? Math.max(minT, Math.ceil(t_hd_net * 2) / 2) : 0;

  const MAWP        = (S * E * t_sh_nom) / (R + 0.6 * t_sh_nom);
  const P_hyd       = 1.3 * MAWP;
  const thick_ratio = P / (S * E);

  // ── HEAD VOLUME ──────────────────────────────────────────────
  const D_m = D_mm / 1000;
  const t_sh = t_sh_nom / 1000;
  const t_hd = t_hd_nom / 1000;
  let V_head = 0, V_head_label = '';
  if (headOk) {
    if (head === 'ellipsoidal') {
      V_head = (Math.PI / 24) * Math.pow(D_m, 3);
      V_head_label = 'Ellipsoidal head (per head)';
    } else if (head === 'hemispherical') {
      V_head = (Math.PI / 12) * Math.pow(D_m, 3);
      V_head_label = 'Hemispherical head (per head)';
    } else if (head === 'conical30' || head === 'conical45') {
      const alpha = head === 'conical30' ? 30 : 45;
      const H_cone = (D_m / 2) / Math.tan(alpha * Math.PI / 180);
      V_head = (Math.PI / 12) * Math.pow(D_m / 2, 2) * H_cone;
      V_head_label = `Conical α=${alpha}° head (per head)`;
    } else {
      V_head = 0; V_head_label = 'Flat cover (no head volume)';
    }
  }
  const L_eff_m = isFinite(L_mm) && L_mm > 0 ? L_mm / 1000 : null;
  const V_shell = L_eff_m ? (Math.PI / 4) * Math.pow(D_m, 2) * L_eff_m : null;
  const V_total = (V_shell !== null) ? V_shell + 2 * V_head : null;

  // ── VESSEL EMPTY WEIGHT ──────────────────────────────────────
  const rho_steel = isFinite(parseFloat(p.rho_steel)) ? parseFloat(p.rho_steel) : 7850;
  let W_shell = null, W_heads = null, W_total = null;
  if (L_eff_m) {
    W_shell = Math.PI * D_m * L_eff_m * t_sh * rho_steel;
    const hd_sf = head === 'ellipsoidal' ? 1.09 :
                  head === 'hemispherical' ? 1.0 :
                  head === 'conical30' ? 1/Math.cos(30*Math.PI/180) :
                  head === 'conical45' ? 1/Math.cos(45*Math.PI/180) : 1.0;
    W_heads = 2 * (Math.PI / 4) * Math.pow(D_m, 2) * t_hd * rho_steel * hd_sf;
    W_total = W_shell + W_heads;
  }

  // ── UG-37 NOZZLE REINFORCEMENT ───────────────────────────────
  const ug37Results = [];
  if (noz.length > 0) {
    noz.forEach((nz, i) => {
      const dn = toMm(parseFloat(nz.d), nz.d_u || 'mm');
      const tn = toMm(parseFloat(nz.t), nz.t_u || 'mm');
      if (!isFinite(dn) || dn <= 0) return;
      const tr     = t_sh_calc;
      const F      = 1.0;
      const A_req  = dn * tr * F;
      const A_shell  = (2 * dn) * (t_sh_nom - t_sh_calc);
      const A_nozzle = isFinite(tn) && tn > 0
        ? 2 * Math.min(2.5 * t_sh_nom, 2.5 * tn) * tn : 0;
      const A_avail  = A_shell + A_nozzle;
      const reinf_ok = A_avail >= A_req;
      const pad_req  = reinf_ok ? 0 : A_req - A_avail;
      ug37Results.push({
        id: nz.id || `N${i+1}`,
        dn: dn.toFixed(0), tr: tr.toFixed(2),
        A_req: A_req.toFixed(1), A_avail: A_avail.toFixed(1),
        ok: reinf_ok,
        pad_req: pad_req > 0 ? pad_req.toFixed(0) : '—'
      });
    });
  }

  // ── WARNINGS ─────────────────────────────────────────────────
  let warns = [], status = 'PASS';
  if (S_note) warns.push(`ℹ ${S_note}`);
  if (head === 'flat') warns.push('⚠ Flat cover: UG-34 simplified formula only. Real flat covers require full UG-34 analysis including attachment weld classification, bolt loading, and effective gasket seating width. Engineer review mandatory.');
  if (head === 'conical45') warns.push('⚠ α=45° conical: approaching practical limit. Knuckle reinforcement per UG-33 likely required.');
  if (!headOk) warns.push('⚠ Head denominator ≤ 0 — head calculation invalid. Pressure exceeds allowable.');
  if (thick_ratio > 0.385) { warns.push('⚠ P/(S×E) > 0.385 — ASME UG-27 thin-wall formula is no longer valid. Use ASME Appendix 1-2 thick-wall formula: t = R[e^(P/SE) − 1]. Consult a certified PV engineer.'); status = 'WARN'; }
  else if (thick_ratio > 0.3) warns.push('⚠ P/(S×E) > 0.3 — approaching thin-wall formula limit (0.385). Consider ASME App.1-2 thick-wall analysis for accuracy.');
  if (isFinite(T_C)) {
    if (T_C > 260 && !matEntry) warns.push('⚠ T>260°C: Verify allowable stress S at operating temperature from ASME Sec.II Part D. Tabulated S may be lower than ambient value.');
    if (T_C < -29) warns.push('⚠ T<−29°C: MDMT and Charpy impact testing per ASME UCS-66 apply. Do not use standard CS at this temperature without impact test verification.');
    if (matEntry && T_C < matEntry.mdmt) warns.push(`⚠ T=${T_C.toFixed(0)}°C is below MDMT of ${matEntry.name} (MDMT=${matEntry.mdmt}°C). Charpy impact testing per UCS-66 required or switch to lower-MDMT material.`);
  }
  if (noz.length === 0) warns.push('ℹ UG-37 nozzle reinforcement: No nozzles entered. Add nozzle data to check reinforcement. All openings in pressure vessels require UG-37 area replacement analysis.');
  else {
    const failNoz = ug37Results.filter(n => !n.ok);
    if (failNoz.length > 0) {
      warns.push(`⚠ UG-37: ${failNoz.length} nozzle(s) require reinforcement pad: ${failNoz.map(n=>`${n.id} (need ${n.pad_req} mm² more)`).join(', ')}.`);
      status = 'WARN';
    } else {
      warns.push(`✅ UG-37: All ${ug37Results.length} nozzle(s) pass reinforcement check.`);
    }
  }
  if (cat === 'detailed') warns.push('ℹ Detailed design category selected — this tool gives preliminary sizing only. Full ASME Sec.VIII Div.1 review by a qualified PV engineer required.');
  if (!headOk || thick_ratio > 0.5) status = 'WARN';

  // ── RESULTS ──────────────────────────────────────────────────
  const results = [
    { label:'Shell: t_calc',        value: t_sh_calc.toFixed(2)+' mm  ('+(t_sh_calc/25.4).toFixed(3)+'")', warn: false },
    { label:'Shell: t + CA',        value: t_sh_net.toFixed(2)+' mm', warn: false },
    { label:'Shell: t_nominal',     value: t_sh_nom.toFixed(1)+' mm  ('+(t_sh_nom/25.4).toFixed(3)+'")', warn: t_sh_nom<minT },
    { label:head_label+': t_calc',  value: headOk ? t_hd_calc.toFixed(2)+' mm' : 'INVALID', warn: !headOk, cls: headOk ? '' : 'f' },
    { label:head_label+': t_nom',   value: headOk ? t_hd_nom.toFixed(1)+' mm' : '—', warn: false },
    { label:'MAWP (shell nom.)',     value: MAWP.toFixed(3)+' MPag  ('+(MAWP/0.1).toFixed(1)+' barg)', warn: false },
    { label:'Design Pressure',      value: P.toFixed(3)+' MPag  ('+(P/0.1).toFixed(1)+' barg)', warn: false },
    { label:'P/(S×E) ratio',        value: thick_ratio.toFixed(4), warn: thick_ratio>0.385 },
    { label:'Hydrotest (~1.3×MAWP)',value: P_hyd.toFixed(3)+' MPag', warn: false },
    { label:'Corrosion Allow.',     value: CA.toFixed(1)+' mm', warn: false },
  ];

  // Head volume
  if (headOk && V_head > 0) {
    results.push({ label: V_head_label,    value: V_head.toFixed(4)+' m³  ('+(V_head*1000).toFixed(1)+' L)', warn: false });
    results.push({ label: '2× Head Volume',value: (2*V_head).toFixed(4)+' m³', warn: false });
  }

  // Shell + total volume
  if (V_shell !== null) {
    results.push({ label:'Shell Volume (inside)', value: V_shell.toFixed(3)+' m³  ('+(V_shell*1000).toFixed(0)+' L)', warn: false });
    results.push({ label:'Total Vessel Volume',   value: V_total.toFixed(3)+' m³  ('+(V_total*1000).toFixed(0)+' L)', warn: false });
  }

  // Vessel weight
  if (W_total !== null) {
    results.push({ label:'Shell Empty Weight', value: W_shell.toFixed(0)+' kg  ('+(W_shell*2.20462).toFixed(0)+' lb)', warn: false });
    results.push({ label:'Heads Empty Weight', value: W_heads.toFixed(0)+' kg  ('+(W_heads*2.20462).toFixed(0)+' lb)', warn: false });
    results.push({ label:'Total Empty Weight', value: W_total.toFixed(0)+' kg  ('+(W_total*2.20462).toFixed(0)+' lb)', warn: W_total>50000 });
  }

  // UG-37 nozzle rows
  if (ug37Results.length > 0) {
    ug37Results.forEach(n => {
      results.push({
        label: `UG-37 Nozzle ${n.id} (DN${n.dn}mm)`,
        value: `A_req=${n.A_req}mm² | A_avail=${n.A_avail}mm² | Pad=${n.pad_req}mm² → ${n.ok?'✅ PASS':'⚠ NEEDS PAD'}`,
        warn: !n.ok
      });
    });
  }

  return {
    status, warns,
    results,
    ug37: ug37Results,
    summary: `ASME Sec.VIII Div.1 | ID=${D_mm.toFixed(0)} mm (${(D_mm/25.4).toFixed(2)}") | S=${S.toFixed(1)} MPa | E=${E.toFixed(2)}${isFinite(T_C)?' | T='+T_C.toFixed(0)+'°C':''}${L_eff_m?' | L='+L_eff_m.toFixed(2)+'m':''}`
  };
}

// ── CALC 5: DEMISTER / MIST ELIMINATOR ───────────────────────
function calcMist(p) {
  const Qg     = toM3h(p.Qg, p.Qg_u);
  const rhog   = toKgm3(p.rhog, p.rhog_u);
  const rhol   = toKgm3(p.rhol, p.rhol_u);
  const margin = parseFloat(p.margin) / 100;
  const mtype  = p.mtype;
  const Km     = { wiremesh:0.107, vane:0.18, cyclonic:0.25 };
  let K_base   = mtype === 'custom' ? parseFloat(p.K) : (Km[mtype] || 0.107);
  const svcFactor  = parseFloat(p.svcFactor);
  const pcorrMode  = p.pcorrMode;
  const orient     = p.orient;

  if ([Qg, rhog, rhol, K_base, margin].some(x => !isFinite(x) || x <= 0))
    return { error: 'Fill all fields with positive values.' };
  if (rhog >= rhol)
    return { error: 'Gas density must be less than liquid density.' };

  const Qg_s = Qg / 3600;
  let K_pcorr_val = K_base;
  if (pcorrMode === 'auto') {
    const Pbara = toBara(p.P, p.P_u);
    if (isFinite(Pbara) && Pbara > 0) K_pcorr_val = kPcorr(K_base, Pbara);
  }
  const K_eff   = K_pcorr_val * svcFactor;
  const Uterm   = K_eff * Math.sqrt((rhol - rhog) / rhog);
  const Udesign = margin * Uterm;
  if (Udesign <= 0) return { error: 'Udesign ≤ 0.' };

  const A_req  = Qg_s / Udesign;
  const D_min  = Math.sqrt(4 * A_req / Math.PI);
  const D_std  = nearestStd(D_min);
  const A_std  = Math.PI * D_std * D_std / 4;
  const Uact   = Qg_s / A_std;
  const ratio  = Uact / Uterm;

  let warns = [], status = 'PASS';
  if (ratio > margin) { warns.push(`⚠ Velocity ratio ${(ratio*100).toFixed(1)}% exceeds margin ${(margin*100).toFixed(0)}%.`); status = 'WARN'; }
  if (K_pcorr_val < K_base) warns.push(`ℹ P-correction: K_base=${K_base.toFixed(4)} → K_pcorr=${K_pcorr_val.toFixed(4)} m/s (GPSA Fig.7-3).`);
  if (svcFactor < 1.0) warns.push(`ℹ Service factor ×${svcFactor} applied.`);

  return {
    status, warns,
    results: [
      { label:'K_base',              value: K_base.toFixed(4)+' m/s', warn: false },
      { label:'K_pcorr (pressure)',  value: K_pcorr_val.toFixed(4)+' m/s', warn: K_pcorr_val<K_base },
      { label:'K_eff (P+service)',   value: K_eff.toFixed(4)+' m/s', warn: K_eff<K_base },
      { label:'Uterm',               value: Uterm.toFixed(3)+' m/s', warn: false },
      { label:'Udesign',             value: Udesign.toFixed(3)+' m/s', warn: false },
      { label:'Required Area',       value: A_req.toFixed(4)+' m²', warn: false },
      { label:'Min. Diameter',       value: D_min.toFixed(3)+' m', warn: false },
      { label:'Std. Vessel D',       value: D_std.toFixed(3)+' m', warn: false },
      { label:'Actual Velocity',     value: Uact.toFixed(3)+' m/s', warn: ratio>margin },
      { label:'Velocity Ratio',      value: (ratio*100).toFixed(1)+'%', warn: ratio>margin },
      { label:'Service Factor',      value: '×'+svcFactor, warn: false },
      { label:'Orientation',         value: orient, warn: false },
    ],
    summary: `Type=${mtype} | K_eff=${K_eff.toFixed(4)} m/s | Margin=${(margin*100).toFixed(0)}% | ρg=${rhog.toFixed(2)} | ρl=${rhol.toFixed(1)} kg/m³`
  };
}

// ── CALC 6: NOZZLE SIZING ─────────────────────────────────────
const NZ_SVC = {
  'gas-inlet':  { vel:25,  rhov2:4000 },
  'gas-outlet': { vel:20,  rhov2:4000 },
  'liq-inlet':  { vel:2,   rhov2:15000 },
  'liq-outlet': { vel:1.5, rhov2:15000 },
  'manway':     { vel:20,  rhov2:4000 },
  'drain':      { vel:1,   rhov2:10000 },
};

function calcNozzle(p) {
  const Q_m3h   = toM3h(p.Q, p.Q_u);
  const vel     = toMs(p.vel, p.vel_u);
  const rho     = toKgm3(p.rho, p.rho_u);
  const svc     = p.svc;
  const rhov2_lim = parseFloat(p.rhov2) || (NZ_SVC[svc]?.rhov2 || 4000);

  if ([Q_m3h, vel, rho].some(x => !isFinite(x) || x <= 0))
    return { error: 'Fill flow rate, velocity and density with positive values.' };

  const Q_m3s    = Q_m3h / 3600;
  const A_req    = Q_m3s / vel;
  const D_calc_mm = Math.sqrt(4 * A_req / Math.PI) * 1000;
  const nps      = nearestNPS(D_calc_mm);
  const D_sel_m  = nps[1] / 1000;
  const A_sel    = Math.PI * D_sel_m * D_sel_m / 4;
  const v_act    = Q_m3s / A_sel;
  const rhov2_act = rho * v_act * v_act;
  const rhov2_ok  = rhov2_act <= rhov2_lim;

  let warns = [], status = 'OK';
  if (!rhov2_ok) { warns.push(`⚠ ρv²=${rhov2_act.toFixed(0)} Pa exceeds ${rhov2_lim.toFixed(0)} Pa limit for ${svc}. Upsize nozzle.`); status = 'WARN'; }
  if (v_act > vel) { warns.push(`⚠ Actual vel ${v_act.toFixed(2)} m/s exceeds design ${vel.toFixed(2)} m/s. Consider next NPS up.`); status = 'WARN'; }
  warns.push('ℹ UG-37 nozzle reinforcement analysis NOT performed. Required for all pressure vessel nozzles per ASME Sec.VIII.');

  return {
    status, warns,
    results: [
      { label:'Min. Calc. ID',           value: D_calc_mm.toFixed(1)+' mm', warn: false },
      { label:'Selected NPS',            value: nps[2]+' (DN '+nps[0]+')', warn: false },
      { label:'Selected ID (Sch40)',     value: nps[1].toFixed(1)+' mm ('+( nps[1]/25.4).toFixed(2)+'")', warn: false },
      { label:'Design Velocity',         value: vel.toFixed(2)+' m/s', warn: false },
      { label:'Actual Velocity',         value: v_act.toFixed(3)+' m/s', warn: v_act>vel*1.05 },
      { label:'Fluid Density',           value: rho.toFixed(2)+' kg/m³', warn: false },
      { label:'ρv² Actual',              value: rhov2_act.toFixed(0)+' Pa', warn: !rhov2_ok },
      { label:'ρv² Limit',               value: rhov2_lim.toFixed(0)+' Pa', warn: false },
      { label:'Momentum Check',          value: rhov2_ok ? '✅ PASS' : '⚠ EXCEED', warn: !rhov2_ok },
    ],
    summary: `Service: ${svc} | Q=${Q_m3h.toFixed(2)} m³/h | ρ=${rho.toFixed(2)} kg/m³ | Sch: ${p.sch}`
  };
}


// ═══════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════
// SERVER-SIDE SECURITY: Engineering constants & input sanitiser
// Transferred from client HTML — these must never live in the browser.
// Called by handle_vessel_separator() before any calc function runs.
// ════════════════════════════════════════════════════════════════════════════

// ── 1. JOINT EFFICIENCY MAP (ASME VIII Table UW-12) ──────────────────────
// Previously: syncE() in HTML lines 1776–1780 set this in the browser.
// Now:        API enforces the correct E for each weld category.
// HTML must send only body.cat (the category string); E is resolved here.
const JOINT_EFF_MAP = {
  '1.0':  1.00,   // Full radiography — Cat. 1 (RT-1)
  '0.85': 0.85,   // Spot radiography — Cat. 2 (RT-2)
  '0.70': 0.70,   // No radiography   — Cat. 3 (RT-3)
  '0.65': 0.65,   // Fillet weld, no RT
  '0.50': 0.50,   // Double fillet, no RT
};

// ── 2. DEMISTER K-FACTOR MAP (GPSA Fig.7-3 base values) ──────────────────
// Previously: const Km = {wiremesh:0.107, vane:0.18, cyclonic:0.25}
//             lived in HTML syncMistK() (HTML lines 1799–1814).
// Now:        API owns these values. Custom K is validated against limits.
const DEMISTER_K_MAP = {
  wiremesh: 0.107,
  vane:     0.18,
  cyclonic: 0.25,
};
const DEMISTER_K_MIN = 0.02;   // absolute lower bound — any K below this is physically unrealistic
const DEMISTER_K_MAX = 0.40;   // absolute upper bound per GPSA

// ── 3. NOZZLE SERVICE LIMITS (API RP 14E / Shell DEP 31.22.05.12) ────────
// Previously: const NZ_SVC_CLIENT lived in HTML lines 1834–1841.
//             setNzDefaults() pre-filled vel and rhov2 fields in the browser.
// Now:        API owns the authoritative service limits.
//             HTML sends only the service type string (body.svc).
//             vel and rhov2 supplied by the client are accepted only if
//             they do NOT exceed the API limits — otherwise API limits win.
const NZ_SVC_LIMITS = {
  'gas-inlet':  { vel_max: 25,  rhov2_max: 4000  },
  'gas-outlet': { vel_max: 20,  rhov2_max: 4000  },
  'liq-inlet':  { vel_max: 2,   rhov2_max: 15000 },
  'liq-outlet': { vel_max: 1.5, rhov2_max: 15000 },
  'manway':     { vel_max: 20,  rhov2_max: 4000  },
  'drain':      { vel_max: 1,   rhov2_max: 10000 },
};

// ── 4. ENGINEERING DEFAULTS (code-based minimums) ────────────────────────
// Previously: DEFAULTS object in HTML lines 1638–1644 pre-filled fields.
// Now:        API applies these when client sends blank / zero / missing values.
const VS_DEFAULTS = {
  h2p:  { tr: 3,      LD: 3,   K: 0.107, surge: 1.25, margin: 85, svcFactor: 1.0, llfrac: 0.5 },
  v2p:  { tr: 3,      K: 0.107, surge: 1.25, margin: 85, boot: 0.3, intern: 0.4, svcFactor: 1.0 },
  '3ph':{ tro: 3,     trw: 3,  LD: 4,   K: 0.107, surge: 1.25,
  dp_um: 200, mu_cP: 2.0, boot: 0.3, icm: 0.15, svcFactor: 1.0 },
  pv:   { E: 1.0,     CA: 3,   minT: 3.175 },
  mist: { margin: 80, K: 0.107, svcFactor: 1.0, orient: 'horizontal' },
  nz:   { vel: 20,    rhov2: 4000 },
};

// ── 5. MASTER INPUT SANITISER ─────────────────────────────────────────────
// Call this at the top of handle_vessel_separator() before dispatch.
// Returns a sanitised, safe copy of body — never mutates the original.
function sanitiseVesselInputs(body) {
  const rawType = body.type || body.calculator || '';
  const type = rawType === '3p' ? '3ph' : rawType;
  const b    = { ...body };   // shallow copy — safe to mutate
  const def  = VS_DEFAULTS[type] || {};

  const applyDefault = (field, fallback) => {
    const v = parseFloat(b[field]);
    if (!isFinite(v) || v <= 0) b[field] = fallback;
  };

  // ── Common defaults by calc type ──
  switch (type) {
    case 'h2p':
      applyDefault('tr',     def.tr);
      applyDefault('LD',     def.LD);
      applyDefault('K',      def.K);
      applyDefault('surge',  def.surge);
      applyDefault('margin', def.margin);
      // Clamp margin to 50–100 %
      b.margin = Math.min(100, Math.max(50, parseFloat(b.margin) || def.margin));
      const sf_h2p = parseFloat(b.svcFactor);
      const lf = parseFloat(b.llfrac);
      if (!isFinite(lf) || lf <= 0 || lf >= 1) b.llfrac = def.llfrac;
      if (!isFinite(sf_h2p) || sf_h2p <= 0) b.svcFactor = def.svcFactor;
      break;

    case 'v2p':
      applyDefault('tr',     def.tr);
      applyDefault('K',      def.K);
      applyDefault('surge',  def.surge);
      applyDefault('margin', def.margin);
      applyDefault('boot',   def.boot);
      applyDefault('intern', def.intern);
      b.margin = Math.min(100, Math.max(50, parseFloat(b.margin) || def.margin));
      const sf_v2p = parseFloat(b.svcFactor);
      if (!isFinite(sf_v2p) || sf_v2p <= 0) b.svcFactor = def.svcFactor;
      break;

    case '3ph':
      applyDefault('tro',   def.tro);
      applyDefault('trw',   def.trw);
      applyDefault('LD',    def.LD);
      applyDefault('K',     def.K);
      applyDefault('surge', def.surge);
      applyDefault('dp_um', def.dp_um);
      applyDefault('mu_cP', def.mu_cP);
      applyDefault('boot',  def.boot);
      applyDefault('icm',   def.icm);
      const sf_3ph = parseFloat(b.svcFactor);
      if (!isFinite(sf_3ph) || sf_3ph <= 0) b.svcFactor = def.svcFactor;
      break;

    case 'pv': {
      // Joint efficiency: resolve from category string; ignore raw E from client
      const cat = String(b.cat || '1.0');
      b.E = JOINT_EFF_MAP[cat] ?? 1.0;   // server owns this — client cannot override

      // Corrosion allowance minimum: never below 0, apply code default if missing
      const ca = parseFloat(b.CA);
      if (!isFinite(ca) || ca < 0) b.CA = def.CA;

      // Minimum thickness: must be a positive number
      const mt = parseFloat(b.minT);
      if (!isFinite(mt) || mt <= 0) b.minT = def.minT;
      break;
    }

    case 'mist': {
      // K-factor: resolve from device type; only accept custom K within bounds
      const mtype = String(b.mtype || 'wiremesh');
      if (mtype !== 'custom') {
        b.K = DEMISTER_K_MAP[mtype] ?? 0.107;  // server owns base K
      } else {
        const kc = parseFloat(b.K);
        if (!isFinite(kc) || kc < DEMISTER_K_MIN || kc > DEMISTER_K_MAX) {
          return { __sanitiseError: `Custom K must be between ${DEMISTER_K_MIN} and ${DEMISTER_K_MAX} m/s.` };
        }
      }
      b.margin = Math.min(100, Math.max(50, parseFloat(b.margin) || def.margin));
      const sf_mist = parseFloat(b.svcFactor);
      if (!isFinite(sf_mist) || sf_mist <= 0) b.svcFactor = def.svcFactor;
      if (!b.orient || b.orient.trim() === '') b.orient = def.orient;
      break;
    }

    case 'nozzle': {
      // Nozzle service: apply API limits — client cannot raise them
      const svc     = String(b.svc || 'gas-outlet');
      const limits  = NZ_SVC_LIMITS[svc];
      if (!limits) {
        return { __sanitiseError: `Unknown nozzle service type: "${svc}".` };
      }
      // If client sent vel or rhov2 above the API limit, clamp to the API limit
      const vel_in   = parseFloat(b.vel);
      const rhov2_in = parseFloat(b.rhov2);
      b.vel   = isFinite(vel_in)   ? Math.min(vel_in,   limits.vel_max)   : limits.vel_max;
      b.rhov2 = isFinite(rhov2_in) ? Math.min(rhov2_in, limits.rhov2_max) : limits.rhov2_max;
      break;
    }
  }

  // ── High-pressure guard: reject absurd pressure values ──
  const Pval = parseFloat(b.P);
  if (isFinite(Pval) && Pval > 5000) {
    return { __sanitiseError: 'Operating pressure exceeds 5000 bar — check units or input value.' };
  }

  return b;  // sanitised body, safe to pass to calc functions
}
// ── End of security/sanitisation block ───────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// Internal dispatcher — routes by body.type to the correct calc function
// ═══════════════════════════════════════════════════════════════════
async function handle_vessel_separator(req, body, res) {
  
  const safe = sanitiseVesselInputs(body);
  if (safe.__sanitiseError)
    return res.status(422).json({ ok: false, error: safe.__sanitiseError });

  const type = safe.type || safe.calculator || '';

  // Dispatch map
  // type values match what the frontend sends in body.type:
  //   'h2p'    — Horizontal 2-Phase separator
  //   'v2p'    — Vertical 2-Phase separator
  //   '3p'     — 3-Phase separator (horizontal)
  //   'pv'     — Pressure Vessel wall thickness (ASME Sec.VIII Div.1)
  //   'mist'   — Mist Eliminator sizing
  //   'nozzle' — Nozzle sizing (ρv² method)

  let result;
  switch (type) {
    case 'h2p':    result = calcH2P(safe);    break;
    case 'v2p':    result = calcV2P(safe);    break;
     case '3p':
    case '3ph':    result = calc3P(safe);     break;
    case 'pv':     result = calcPV(safe);     break;
    case 'mist':   result = calcMist(safe);   break;
    case 'nozzle': result = calcNozzle(safe); break;
    default:
      return res.status(400).json({
        ok: false,
        error: `Unknown calculator type: "${type}". Valid values: h2p, v2p, 3p, pv, mist, nozzle`
      });
  }

  if (result && result.error)
    return res.status(422).json({ ok: false, error: result.error });

  return res.status(200).json({ ok: true, ...result });
}

// ════════════════════════════════════════════════════════════════════════════
// Vercel handler — entry point for /api/vessel-separator-sizing
// ════════════════════════════════════════════════════════════════════════════

// ── handle_calculate — internal dispatcher called by vesselSeparator_handler ──
// NOTE: All calc functions (calcH2P, calcV2P, calc3P, calcPV, calcMist, calcNozzle,
//       sanitiseVesselInputs) are declared above in SECTION E.
async function handle_calculate(body, res) {
  const { calc, params } = body || {};
  if (!calc || !params) {
    return res.status(400).json({ error: 'Missing calc type or params.' });
  }
  // Inject type so sanitiseVesselInputs knows which case to run
  const safeParams = sanitiseVesselInputs({ ...params, type: calc === '3ph' ? '3ph' : calc });
  if (safeParams.__sanitiseError)
    return res.status(422).json({ ok: false, error: safeParams.__sanitiseError });
  let result;
  try {
    switch (calc) {
      case 'h2p':    result = calcH2P(safeParams);    break;
      case 'v2p':    result = calcV2P(safeParams);    break;
      case '3ph':    result = calc3P(safeParams);     break;
      case 'pv':     result = calcPV(safeParams);     break;
      case 'mist':   result = calcMist(safeParams);   break;
      case 'nozzle': result = calcNozzle(safeParams); break;
      default:
        return res.status(400).json({ error: `Unknown calc type: ${calc}` });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Calculation error: ' + err.message });
  }
  return res.status(200).json(result);
}

async function vesselSeparator_handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body || typeof body !== 'object')
    return res.status(400).json({ error: 'Invalid request body.' });

  try {
    return await handle_calculate(body, res);
  } catch (e) {
    console.error('[vessel-separator-sizing.js] Unhandled error:', e);
    return res.status(500).json({ error: e.message || 'Internal server error' });
  }
}

// ── End of Section 15: Vessel & Separator Sizing ──────────────────────────────────────────


// ══════════════════════════════════════════════════════════════════════════════
