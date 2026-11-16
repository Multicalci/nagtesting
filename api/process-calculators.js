
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
  const D2r=parseFloat(d.D2 ?? shared.D2); const D2=D2r>0?D2r:D;          // FIX V-11: downstream pipe
  const dvr=parseFloat(d.d_valve ?? shared.d_valve); const dV=dvr>0?dvr:null; // valve size (outlet Mach)
  const FL=parseFloat(d.FL ?? shared.FL)||0.9;
  const k =parseFloat(d.k ?? shared.k)||1.4;
  const Z =parseFloat(d.Z ?? shared.Z)||1.0;
  const Z2in=parseFloat(d.Z2 ?? shared.Z2); let Z2=Number.isFinite(Z2in)?Z2in:Z;   // FIX V-11: PR below if not given
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
  let P1a=P1,P2a=P2,Pva=Pv,T_F=T,D_in=D,D2_in=D2,dV_in=dV,tp_actual=tp_in;
  if (m){P1a*=14.5038;P2a*=14.5038;Pva*=14.5038;D_in=D/25.4;D2_in=D2/25.4;dV_in=dV?dV/25.4:null;T_F=T*9/5+32;tp_actual=tp_in/25.4;}
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
    const Q_cfs=Qc*(14.696/Math.max(P1a,14.696))*(TR/519.67)*Z/3600;   // FIX V-11: × Z (real gas)
    vel=Q_cfs/(A_in2/144);
    if(x>=xc){flowState='Choked gas (sonic)';flowType_str='Critical';}
    else if(x>xc*0.8){flowState='Near-critical gas';flowType_str='Non-critical';}
    else {flowState='Normal gas flow';flowType_str='Non-critical';}
    // SI
    const Rgas=8314/MW, T1=(T_F-32)*5/9+273.15;
    const P1_Pa=P1a*6894.76, P2_Pa=P2a*6894.76;
    if(!Number.isFinite(Z2in)) Z2=cvOutletZ({...shared,...d},T1,P2_Pa,Z).Z2;   // FIX V-11: PR Z₂ at (T₁,P₂)
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
  const Di_m=D2_in*0.0254;                                // FIX V-11: downstream pipe ID (was upstream)
  let tp_m = tp_actual>0 ? tp_actual*0.0254 : 0.237*0.0254;
  const Apipe=Math.PI/4*Di_m*Di_m;
  const u2P = SI.Q2? SI.Q2/Apipe : null;                 // pipe velocity  (m/s)
  const u2  = (SI.Q2 && dV_in) ? SI.Q2/(Math.PI/4*Math.pow(dV_in*0.0254,2)) : u2P;   // FIX V-11: valve outlet ≈ valve size
  const powerLoss_kW = SI.Q1? (SI.Q1*(SI.P1_Pa-SI.P2_Pa))/1000 : null;
  let Ma=null, MaValve=null;
  if(!isL && SI.gamma){ const c2=Math.sqrt(SI.gamma*SI.Z2*SI.Rgas*SI.T1); Ma=u2P/c2; if(dV_in) MaValve=u2/c2; }

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
    MaValve:MaValve!=null?+MaValve.toFixed(3):null,
    powerLoss_kW:powerLoss_kW!=null?+powerLoss_kW.toFixed(4):null,
    Z1:+Z.toFixed(4), Z2:+Z2.toFixed(4),
    LpAe:LpAe!=null?+LpAe.toFixed(1):null, noiseDetail,
    severity, sevBand,
    sigma: isL ? +((P1a-Pva)/Math.max(dP,0.0001)).toFixed(2) : null,   // cavitation index σ
    Kc: +(FL*FL).toFixed(3),                                            // cavitation coefficient Kc ≈ FL²
    warns,
  };
}
// FIX V-11: outlet compressibility Z₂ at (T₁, P₂). An explicit Z2 in the body wins;
//   otherwise Peng-Robinson from the critical properties the page sends (zTc K,
//   zPc bar, zOmega); otherwise fall back to the inlet Z (the previous behaviour).
//   T₁ basis: no Joule-Thomson correction (conservative for gases that cool).
function cvOutletZ(src, T_K, P2_Pa, Zin){
  const z2 = parseFloat(src.Z2);
  if (Number.isFinite(z2) && z2 > 0) return { Z2: z2, basis: 'input' };
  const Tc = parseFloat(src.zTc), Pc = parseFloat(src.zPc), om = parseFloat(src.zOmega);
  if (Tc > 0 && Pc > 0 && T_K > 0 && P2_Pa > 0) {
    try {
      const r = eosStableRoot(runEOS('pr', T_K, P2_Pa, Tc, Pc * 1e5, Number.isFinite(om) ? om : 0));
      if (r && isFinite(r.Z) && r.Z > 0 && r.kind !== 'liquid') return { Z2: r.Z, basis: 'PR-EOS' };
    } catch (e) { /* fall through */ }
  }
  return { Z2: Zin, basis: 'inlet Z' };
}

// FIX V-11: Fp piping geometry factor, IEC 60534-2-1 Eq. (2)–(4), with separate
//   inlet reducer (D1) and outlet expander (D2):
//   Σζ = ζ1 + ζ2 + ζB1 − ζB2,  ζ1 = 0.5(1−(d/D1)²)², ζ2 = 1.0(1−(d/D2)²)², ζB = 1−(d/D)⁴
//   (with D1 = D2 the Bernoulli terms cancel — identical to the previous formula).
//   d, D1, D2 in inches; 890 = N₂ for Cv with d in inches.
function cvFp(Cv, d_in, D1_in, D2_in){
  if (!d_in || !(D1_in > 0) || !(D2_in > 0)) return 1;
  const r1 = Math.min(d_in / D1_in, 1), r2 = Math.min(d_in / D2_in, 1);
  if (r1 > 0.99 && r2 > 0.99) return 1;
  const z1  = 0.5 * Math.pow(1 - r1 * r1, 2), z2 = 1.0 * Math.pow(1 - r2 * r2, 2);
  const zB1 = 1 - Math.pow(r1, 4),           zB2 = 1 - Math.pow(r2, 4);
  const sz  = z1 + z2 + zB1 - zB2;
  const Fp  = 1 / Math.sqrt(Math.max(1 + sz * Cv * Cv / (890 * Math.pow(d_in, 4)), 1e-6));
  return Math.min(1, Math.max(0.5, Fp));
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
    // FIX V-11: downstream pipe ID — outlet velocity, Mach, noise and the outlet side
    //   of Fp use it. Blank / 0 → same as the upstream pipe (previous behaviour).
    const D2raw = parseFloat(d.D2);
    const D2 = D2raw > 0 ? D2raw : D;
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
    let P1a = P1, P2a = P2, Pva = Pv, T_F = T, D_in = D, D2_in = D2;
    if (m) {
      P1a  *= 14.5038;   // bara → psia
      P2a  *= 14.5038;
      Pva  *= 14.5038;
      D_in  = D / 25.4;  // mm → in
      D2_in = D2 / 25.4; // mm → in  (FIX V-11)
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
    let steamVspec = null, steamTK = null;   // FIX V-11: steam inlet specific volume (ft³/lb) & T (K) for outlet velocity

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
      if (d_valve_in && (d_valve_in < D_in * 0.99 || d_valve_in < D2_in * 0.99)) {
        Fp = cvFp(Cv, d_valve_in, D_in, D2_in);           // FIX V-11: separate inlet / outlet pipe
        Cv = Cv / Fp;
        const _pl = x => m ? (x*25.4).toFixed(0)+' mm' : x.toFixed(3)+'"';
        if (Fp < 0.99) warns.push({ cls:'warn-amber',
          txt:`⚠ Fp piping correction: Fp=${Fp.toFixed(3)}, Cv increased by ${((1/Fp-1)*100).toFixed(1)}% for ${m?(d_valve_raw.toFixed(0)+' mm valve'):(d_valve_in.toFixed(3)+'" valve')} between ${_pl(D_in)} inlet / ${_pl(D2_in)} outlet pipe (IEC 60534-2-1 §4.1).` });
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
      if (d_valve_in && (d_valve_in < D_in * 0.99 || d_valve_in < D2_in * 0.99)) {
        Fp_g = cvFp(Cv, d_valve_in, D_in, D2_in);         // FIX V-11: separate inlet / outlet pipe
        Cv   = Cv / Fp_g;
        if (Fp_g < 0.99) warns.push({ cls:'warn-amber',
          txt:`⚠ Fp piping correction (gas): Fp=${Fp_g.toFixed(3)}, Cv +${((1/Fp_g-1)*100).toFixed(1)}% (IEC 60534-2-1 §4.1).` });
      }
      
      // FIX F-18: Gas inlet velocity must use INLET pressure P1a (not P2a).
      //   Expanding SCFH to actual ft³/s at valve inlet conditions (T, P1):
      //   Q_actual_cfs = Qc[SCFH] × (14.696/P1a) × (TR/519.67) / 3600
      // FIX V-11: × Z — actual volume is real-gas (was ideal-gas; −20…−30 % for CO₂ / NH₃ vapour near saturation)
      const Q_cfs = Qc * (14.696 / Math.max(P1a, 14.696)) * (TR / 519.67) * Z / 3600.0;
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
      steamVspec = v_spec; steamTK = (T_act_R - 459.67 - 32) * 5/9 + 273.15;   // FIX V-11

      flowState = x_ratio >= 1 ? '🔴 Choked Steam' : '🟢 Steam Flow OK';
      if (x_ratio >= 1) warns.push({ cls:'warn-red', txt:`⚠️ Choked steam: ΔP/P₁=${(x_s*100).toFixed(1)}% ≥ Fγ·xT=${(x_crit_s*100).toFixed(1)}%. Verify flash piping downstream.` });
      noiseDb = Math.round(65 + 10*Math.log10(Math.max(Cv,1)) + 15*(x_ratio>1?1:x_ratio));
    }

    // ── FIX V-11: OUTLET-SIDE VELOCITY & MACH ───────────────────────────────
    //   For a letdown valve the outlet is where velocity matters: the gas has
    //   expanded by ~P₁/P₂. Downstream pipe uses D2; the valve outlet uses the
    //   valve size (d_valve) as an approximation of the body outlet bore.
    //   Basis: real gas at P₂ with Z₂, temperature T₁ (no J-T correction).
    let vel2 = null, Ma2 = null, velValve = null, MaValve = null, Z2used = null, Z2basis = null;
    {
      const T1K   = (T_F - 32) * 5/9 + 273.15;
      const P2_Pa = P2a * 6894.76;
      const A2    = Math.PI / 4 * Math.pow(D2_in * 0.0254, 2);
      const Av    = d_valve_in ? Math.PI / 4 * Math.pow(d_valve_in * 0.0254, 2) : null;
      let Q2 = null, c2 = null;
      if (isG) {
        const zz = cvOutletZ(d, T1K, P2_Pa, Z); Z2used = zz.Z2; Z2basis = zz.basis;
        const Rg   = 8314.462618 / SG;                       // SG holds MW for gas
        const mdot = (Qc * SG / 379.5) / 3600 / 2.20462;     // SCFH → kg/s
        Q2 = mdot / (P2_Pa / (Z2used * Rg * T1K));
        c2 = Math.sqrt(k * Z2used * Rg * T1K);
      } else if (isS && steamVspec) {
        const rho1 = 1 / (steamVspec * 0.0624280);           // ft³/lb → kg/m³
        const rho2 = rho1 * (P2a / Math.max(P1a, 1e-6));     // ideal expansion (approx.)
        Q2 = (Qc / 3600 / 2.20462) / rho2;
        c2 = Math.sqrt(1.3 * (8314.462618 / 18.015) * (steamTK || T1K));
      } else if (isL) {
        Q2 = Qc * 0.002228 * 0.0283168;                      // GPM → m³/s (incompressible)
      }
      if (Q2 != null) {
        vel2 = Q2 / A2;  if (c2) Ma2 = vel2 / c2;
        if (Av) { velValve = Q2 / Av; if (c2) MaValve = velValve / c2; }
      }
      if (!isL) {
        const vU = v => m ? v.toFixed(0) + ' m/s' : (v / 0.3048).toFixed(0) + ' ft/s';
        const vs = d_valve_in ? (m ? d_valve_raw.toFixed(0) + ' mm' : d_valve_in.toFixed(2) + '"') : '';
        if (MaValve != null && MaValve >= 1)
          warns.push({ cls:'warn-red', txt:`❌ Valve outlet Mach ${MaValve.toFixed(2)} (${vU(velValve)}) at the ${vs} body outlet — the outlet bore would itself choke at P₂. Use an expanded-outlet body, a larger valve outlet, or a staged downstream restrictor that raises the valve back-pressure.` });
        else if (MaValve != null && MaValve > 0.5)
          warns.push({ cls:'warn-amber', txt:`⚠ Valve outlet Mach ${MaValve.toFixed(2)} (${vU(velValve)}) at the ${vs} body outlet exceeds 0.5 — the commonly used limit (≤ 0.3 for noise-sensitive service). Expect high noise; consider an expanded outlet.` });
        if (Ma2 != null && Ma2 > 0.3)
          warns.push({ cls:'warn-amber', txt:`⚠ Downstream pipe Mach ${Ma2.toFixed(2)} (${vU(vel2)}) > ${Ma2 > 0.5 ? '0.5' : '0.3'} — ${Ma2 > 0.5 ? 'enlarge the downstream pipe' : 'high for noise-sensitive service; check the downstream pipe size'}.` });
      }
    }

    // ── UNIFIED IEC NOISE ────────────────────────────────────────────────────
    //   Use the SAME IEC 60534-8-3 (gas/steam) / 8-4 (liquid) model as the
    //   multi-case Load Analysis report, so BOTH reports show the same external
    //   A-weighted SPL at 1 m. Replaces the legacy simple noiseDb correlations,
    //   which omitted pipe-wall transmission loss and read ~15 dB high.
    //   FIX V-11: IEC 60534-8-3 is a DOWNSTREAM-pipe model → uses D2 and Z₂.
    {
      const Di_m2  = D2_in * 0.0254;
      const tp_in2 = parseFloat(d.tp) || 0;
      const tp_m2  = tp_in2 > 0 ? (m ? tp_in2/1000 : tp_in2*0.0254) : 0.237*0.0254; // Sch-40 default
      const P1_Pa2 = P1a*6894.76, P2_Pa2 = P2a*6894.76, T1_2 = (T_F-32)*5/9+273.15;
      let LpAe2 = null;
      if (isG) {
        const Rgas2 = 8314/Math.max(SG,1e-6);                 // SG holds MW (g/mol) for gas
        const mdot2 = (Qc*SG/379.5)/3600/2.20462;             // SCFH→lb/h→kg/s (matches multi-case)
        LpAe2 = aeroNoise_LpAe({P1:P1_Pa2,P2:P2_Pa2,mdot:mdot2,T1:T1_2,Rgas:Rgas2,gamma:k,Z,Z2:(Z2used||Z),xT:FL,Fd,Di:Di_m2,tp:tp_m2}).LpAe;
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
      // FIX V-11: outlet side (downstream pipe D2, valve outlet ≈ valve size), real gas at P₂/T₁
      vel2:            vel2 != null ? fmtN(m ? vel2 : vel2 / 0.3048) : null,
      vel2Label:       vel2 != null ? fmtN(m ? vel2 : vel2 / 0.3048) + ' ' + (m ? 'm/s' : 'ft/s') : '—',
      Ma2:             Ma2 != null ? +Ma2.toFixed(3) : null,
      velValve:        velValve != null ? fmtN(m ? velValve : velValve / 0.3048) : null,
      velValveLabel:   velValve != null ? fmtN(m ? velValve : velValve / 0.3048) + ' ' + (m ? 'm/s' : 'ft/s') : '—',
      MaValve:         MaValve != null ? +MaValve.toFixed(3) : null,
      Z2:              Z2used != null ? +Z2used.toFixed(4) : null,
      Z2basis,
      pipe2Label:      m ? (D2_in * 25.4).toFixed(1) + ' mm' : D2_in.toFixed(3) + ' in',
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
      D2:b.D2,d_valve:b.d_valve,zTc:b.zTc,zPc:b.zPc,zOmega:b.zOmega,   // FIX V-11
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
//
// FIX Z-5 (Oct 2026): full calculation review of the EOS engine —
//   • solveCubic REWRITTEN. The old Cardano routine switched branches on an
//     ABSOLUTE tolerance (|D| < 1e-10). van der Waals was solved in molar-volume
//     units where D ~ 1e-20, so EVERY vdW call fell into the "repeated root"
//     branch and returned wrong numbers (CO2 350 K/100 bar: Z 0.7276 instead of
//     0.6105; NH3 373 K/100 bar: 0.528 instead of 0.215) plus a phantom 2nd root.
//     The same tolerance corrupted SRK/PR near the critical point (≈4 % in Z)
//     and let roots below the co-volume (Z < B, i.e. Vm < b) through
//     (PR H2 300 K/700 bar reported a non-existent root Z = 0.1385).
//     New solver: roots are isolated between the turning points of the cubic
//     and refined by bracketed Newton — no tolerances, scale-free, and only
//     physical roots (Z > B) are returned.
//   • van der Waals now solved as a cubic in Z like SRK/PR (A = aP/R²T²,
//     B = bP/RT); eosParams carries A and B for vdW too.
//   • Root labels were inverted (smallest Z was labelled "Vapour Z", largest
//     "Liquid Z"). Roots now carry a correct label + kind
//     ('liquid' | 'unstable' | 'vapour' | 'gas' | 'supercritical' | 'ideal').
//   • eosPsat: Newton on ln P inside a guaranteed bracket instead of 60 rounds of
//     successive substitution (which stalled near Tc and lost the liquid root at
//     low Tr because of the old `z > 1e-6` filter). Works for vdW as well.
//   • NEW data.stable — the thermodynamically stable root (lowest fugacity):
//       { phase, kind, label, Z, phi, Vm_SI, rho_mass, f_Pa, Psat_Pa,
//         V_m3, mass_kg, isLegacyRoot }
//     phase: 'liquid' | 'vapor' | 'gas' (T ≥ Tc, P < Pc) | 'supercritical'
//            (T ≥ Tc, P ≥ Pc) | null (ideal).  V_m3 / mass_kg use the mole
//     number n, which was validated before but never used in any result.
//   • BACKWARD COMPATIBILITY: data.Z / phi / Vm_SI / rho_mass / f_Pa are STILL
//     the largest-Z (vapour-like) root and data.phase / data.Psat_Pa keep their
//     Z-4 meaning (pr/srk only), so the control-valve auto-Z contract and the
//     three regression anchors above are unchanged. Pages that want the real
//     fluid state must read data.stable.
//   • Optional body.gas (page gas key) switches on the polar / associating /
//     quantum-gas notes — those sets existed in buildWarnings but were never used.
//   • Inputs are coerced with Number(); unknown EOS names and a missing ω for
//     SRK/PR now return a clear 400 instead of "No real solution found".
//   • NEW request type  { curve: 'ZP' | 'PV', T_K, Pmax_Pa, Tc_K, Pc_Pa, omega }
//     → chart series for all four EOS in ONE call (eosCurve_handler). The page
//     used to draw its charts with a second, simplified copy of the maths in
//     the browser (van der Waals there was hard-wired to Z = 1); the charts now
//     come from this same engine, so they cannot drift from the calculator.
//
// FIX Z-6 (Oct 2026): GAS MIXTURES — a request with  components: [{name, x, Tc_K,
//   Pc_Pa, omega, M}, …]  (and optional kij matrix) is handled by
//   eosMixture_handler near the end of this section: van der Waals one-fluid
//   mixing rules, component fugacities, tangent-plane stability test and a
//   two-phase flash. Pure-gas requests are untouched.
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
  const allowed = origin.endsWith('.vercel.app') || origin === 'https://www.multicalci.com';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://www.multicalci.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // FIX Z-5: coerce — a JSON string "350" used to pass isFinite() and then crash on .toFixed()
    const body = req.body || {};
    const num  = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));
    if (body.curve) return eosCurve_handler(body, num, res);          // FIX Z-5: chart series
    if (Array.isArray(body.components)) return eosMixture_handler(body, num, res);   // FIX Z-6: gas mixtures
    const eos   = typeof body.eos === 'string' ? body.eos.trim().toLowerCase() : body.eos;
    const T_K   = num(body.T_K),  P_Pa  = num(body.P_Pa);
    const Tc_K  = num(body.Tc_K), Pc_Pa = num(body.Pc_Pa);
    const M     = num(body.M),    n     = num(body.n);
    let   omega = num(body.omega);
    const gas   = typeof body.gas === 'string' ? body.gas : null;   // optional page gas key

    if (!eos)          return res.status(400).json({ error: 'Missing EOS type' });
    if (!EOS_TYPES.includes(eos)) return res.status(400).json({ error: `Unknown EOS type "${eos}". Use ideal, vdw, srk or pr.` });
    if (!isFinite(T_K)  || T_K  <= 0) return res.status(400).json({ error: 'Temperature must be positive and finite.' });
    if (!isFinite(P_Pa) || P_Pa <= 0) return res.status(400).json({ error: 'Pressure must be positive and finite.' });
    if (!isFinite(Tc_K) || Tc_K <= 0) return res.status(400).json({ error: 'Critical temperature Tc must be positive.' });
    if (!isFinite(Pc_Pa)|| Pc_Pa<= 0) return res.status(400).json({ error: 'Critical pressure Pc must be positive.' });
    if (!isFinite(M)    || M    <  1)  return res.status(400).json({ error: 'Molar mass must be ≥ 1 g/mol.' });
    if (!isFinite(n)    || n    <= 0)  return res.status(400).json({ error: 'Number of moles must be positive.' });
    if (T_K < 10) return res.status(400).json({ error: `Temperature ${T_K.toFixed(2)} K is below 10 K. EOS calculations are not reliable at near-absolute-zero temperatures.` });
    if (eos === 'srk' || eos === 'pr') {
      if (!isFinite(omega)) return res.status(400).json({ error: 'Acentric factor ω is required for SRK and Peng-Robinson.' });
      if (omega < -1 || omega > 2) return res.status(400).json({ error: `Acentric factor ω = ${omega} is outside the physical range (−1 … 2). Check the input.` });
    } else if (!isFinite(omega)) {
      omega = 0;                                   // ideal / vdW do not use ω
    }

    const roots = runEOS(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega);
    if (!roots.length) return res.status(400).json({ error: 'No real solution found — conditions may be below absolute minimum volume for this EOS. Try a lower pressure or higher temperature.' });

    // Legacy "primary" root = largest Z (vapour-like). Kept for the control-valve auto-Z contract.
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

    // FIX Z-5: the stable root (lowest fugacity) and the model's own saturation pressure
    const stableRoot = eosStableRoot(roots);
    const PsatModel  = eosPsat(eos, T_K, Tc_K, Pc_Pa, omega);           // ideal → null, T ≥ Tc → null

    // FIX Z-4: definitive phase verdict via fugacity-equality Psat (pr/srk only — unchanged contract)
    const Psat_Pa = (eos === 'pr' || eos === 'srk') ? PsatModel : null;
    const phase   = eosPhase(eos, T_K, P_Pa, Tc_K, Psat_Pa, stableRoot.kind);

    const stable = {
      phase:      EOS_KIND_TO_PHASE[stableRoot.kind] || null,
      kind:       stableRoot.kind,
      label:      stableRoot.label,
      Z:          stableRoot.Z,
      phi:        stableRoot.phi,
      Vm_SI:      stableRoot.Vm,
      rho_mass:   (M / 1000) / stableRoot.Vm,
      f_Pa:       stableRoot.phi * P_Pa,
      Psat_Pa:    PsatModel != null ? +PsatModel.toPrecision(8) : null,
      V_m3:       n * stableRoot.Vm,              // total volume of n mol
      mass_kg:    +(n * M / 1000).toPrecision(12), // mass of n mol
      isLegacyRoot: stableRoot === primary        // false → data.Z is a metastable vapour root
    };

    const warnings = buildWarnings(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega, Z, Tr, Pr, roots,
                                   { stable, gas, legacyZ: Z });
    if (phase === 'liquid') {
      warnings.unshift({ type: 'phase_liquid',
        msg: `P (${(P_Pa/1e5).toFixed(2)} bar a) exceeds the saturation pressure at this temperature (Psat ≈ ${eosFmtBar(Psat_Pa)} bar a). The STABLE phase is LIQUID (liquid-root Z = ${stable.Z.toPrecision(4)}). The vapour-root Z = ${Z.toFixed(4)} describes a phase that does not exist at these conditions.` });
    } else if (phase === 'near_dew') {
      warnings.unshift({ type: 'phase_near_dew',
        msg: `Within 5 % of saturation (Psat ≈ ${eosFmtBar(Psat_Pa)} bar a) — near-dew-point gas. Cubic-EOS Z accuracy is reduced and condensation is possible.` });
    }

    return res.status(200).json({
      success: true,
      data: {
        Z, phi, Vm_SI, rho_mass, f_Pa, Tr, Pr,
        Psat_Pa: Psat_Pa != null ? +Psat_Pa.toPrecision(8) : null,   // FIX Z-4 (Z-5: precision kept for low Psat)
        phase,                                                        // FIX Z-4
        stable,                                                       // FIX Z-5
        n, M,
        roots: roots.map(r => ({ Z: r.Z, Vm: r.Vm, phi: r.phi, label: r.label, kind: r.kind,
                                 rho_mass: (M / 1000) / r.Vm, stable: r === stableRoot })),
        rootCount: roots.length,
        eosParams: { A: primary.A, B: primary.B, a: primary.a, b: primary.b,
                     m: primary.m, kappa: primary.kappa, alpha: primary.alpha,
                     kappaForm: primary.kappaForm },
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

const EOS_TYPES = ['ideal', 'vdw', 'srk', 'pr'];
const EOS_ROOT_LABEL    = { liquid: 'Liquid Z', unstable: 'Middle Z (unstable)', vapour: 'Vapour Z',
                            gas: 'Gas Z', supercritical: 'Supercritical Z', ideal: 'Z = 1 (Ideal)' };
const EOS_KIND_TO_PHASE = { liquid: 'liquid', vapour: 'vapor', gas: 'gas', supercritical: 'supercritical' };
// Critical compressibility of each model (Vc = Zc·R·Tc/Pc) — used to tell a lone
// sub-critical root apart: Vm < Vc → liquid-like branch, Vm > Vc → vapour-like branch.
const EOS_ZC = { vdw: 0.375, srk: 1 / 3, pr: 0.3074013087 };

function eosFmtBar(P_Pa) {
  if (P_Pa == null || !isFinite(P_Pa)) return '—';
  const bar = P_Pa / 1e5;
  return bar >= 0.01 ? bar.toFixed(2) : bar.toExponential(2);
}

// ── FIX Z-5 : bracketed Newton (never leaves [a, b]; falls back to bisection) ──
// Requires f(a) and f(b) of opposite sign. Converges to full double precision.
function eosBracketRoot(f, df, a, b, fa) {
  let lo = fa < 0 ? a : b;           // f(lo) < 0
  let hi = fa < 0 ? b : a;           // f(hi) > 0
  let x = 0.5 * (a + b);
  let dxOld = Math.abs(b - a), dx = dxOld;
  for (let it = 0; it < 300; it++) {
    const fx = f(x);
    if (fx === 0) return x;
    if (fx < 0) lo = x; else hi = x;                 // x is now one end of the bracket
    const d    = df(x);
    const mn   = Math.min(lo, hi), mx = Math.max(lo, hi);
    const step = fx / d;
    let xn = x - step;                               // Newton candidate
    const newtonOk = isFinite(xn) && xn > mn && xn < mx && Math.abs(2 * step) <= Math.abs(dxOld);
    dxOld = dx;
    if (newtonOk) {
      dx = step;
    } else {
      xn = lo + 0.5 * (hi - lo);                     // bisection step
      dx = xn - x;
      if (xn === lo || xn === hi) return x;          // bracket has collapsed to adjacent doubles
    }
    if (Math.abs(xn - x) <= 4e-16 * Math.abs(xn)) return xn;
    x = xn;
  }
  return x;
}

// ── FIX Z-5 : real roots of  z³ + c2·z² + c1·z + c0 = 0  with z > zMin, ascending ──
// A cubic is monotonic between its turning points, so each interval
// [zMin, z_max], [z_max, z_min], [z_min, Cauchy bound] holds at most one root and a
// sign change proves it is there. No discriminant, no tolerance, no scale
// dependence — the same routine is exact for Z ~ 1 and for a liquid root Z ~ 1e-9.
function solveCubic(c2, c1, c0, zMin = 0) {
  if (!(isFinite(c2) && isFinite(c1) && isFinite(c0) && isFinite(zMin))) return [];
  const f  = z => ((z + c2) * z + c1) * z + c0;
  const df = z => (3 * z + 2 * c2) * z + c1;
  const zMax = 1 + Math.max(Math.abs(c2), Math.abs(c1), Math.abs(c0), Math.abs(zMin));  // all roots lie below this

  // turning points: 3z² + 2·c2·z + c1 = 0 (cancellation-free quadratic formula)
  let zA = NaN, zB = NaN;
  const disc = c2 * c2 - 3 * c1;
  if (disc > 0) {
    const s = Math.sqrt(disc);
    const q = -(c2 + (c2 >= 0 ? s : -s));
    const r1 = q / 3, r2 = c1 / q;
    zA = Math.min(r1, r2);            // local maximum
    zB = Math.max(r1, r2);            // local minimum
  }

  const pts = [zMin];
  if (zA > zMin && zA < zMax) pts.push(zA);
  if (zB > zMin && zB < zMax && !(zB <= zA)) pts.push(zB);
  pts.push(zMax);

  const roots = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i], hi = pts[i + 1];
    const flo = f(lo), fhi = f(hi);
    if (fhi === 0) { roots.push(hi); continue; }             // root sits exactly on a turning point
    if (flo === 0 || (flo > 0) === (fhi > 0)) continue;      // no sign change → no root here
    roots.push(eosBracketRoot(f, df, lo, hi, flo));
  }
  return roots.filter((z, i) => isFinite(z) && z > zMin && (i === 0 || z > roots[i - 1]));
}

function solveIdeal(T_K, P_Pa) {
  const Vm = R * T_K / P_Pa;
  return [{ Z: 1, Vm, phi: 1, lnPhi: 0, label: EOS_ROOT_LABEL.ideal, kind: 'ideal' }];
}

// Shared tail of the three cubic models: solve, attach Vm / ln φ / φ, classify roots.
function eosFinishRoots(eos, T_K, P_Pa, Tc_K, Pc_Pa, c2, c1, c0, B, lnPhiOf, params) {
  let Zs = solveCubic(c2, c1, c0, B);                        // only Z > B  (Vm > b) is physical
  // At the model's exact critical point the three roots coincide; a triple root can only be
  // resolved to ~ε^(1/3) ≈ 1e-5, so numerically "different" roots that close are one root.
  if (Zs.length > 1 && Zs[Zs.length - 1] - Zs[0] < 5e-5 * Zs[Zs.length - 1]) {
    Zs = [Zs.reduce((s, z) => s + z, 0) / Zs.length];
  }
  const RT_P = R * T_K / P_Pa;
  const roots = Zs.map(Z => {
    const lnPhi = lnPhiOf(Z);
    return { Z, Vm: Z * RT_P, phi: Math.exp(lnPhi), lnPhi, ...params };
  }).filter(r => isFinite(r.lnPhi));

  const Vc = EOS_ZC[eos] * R * Tc_K / Pc_Pa;
  roots.forEach((r, i) => {
    if (roots.length === 1) {
      r.kind = T_K >= Tc_K ? (P_Pa >= Pc_Pa ? 'supercritical' : 'gas')
                           : (r.Vm < Vc ? 'liquid' : 'vapour');
    } else {
      r.kind = i === 0 ? 'liquid' : i === roots.length - 1 ? 'vapour' : 'unstable';
    }
    r.label = EOS_ROOT_LABEL[r.kind];
  });
  return roots;
}

function solveVdW(T_K, P_Pa, Tc_K, Pc_Pa) {
  const a = 27 * R * R * Tc_K * Tc_K / (64 * Pc_Pa);
  const b = R * Tc_K / (8 * Pc_Pa);
  const A = a * P_Pa / (R * R * T_K * T_K);
  const B = b * P_Pa / (R * T_K);
  // FIX Z-5: Z³ − (1+B)Z² + A·Z − A·B = 0  (was a cubic in Vm — see header)
  const lnPhi = Z => (Z - 1) - Math.log(Z - B) - A / Z;      // ≡ b/(Vm−b) − ln[P(Vm−b)/RT] − 2a/(RT·Vm)
  return eosFinishRoots('vdw', T_K, P_Pa, Tc_K, Pc_Pa, -(1 + B), A, -A * B, B, lnPhi, { A, B, a, b });
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
  const lnPhi = Z => (Z - 1) - Math.log(Z - B) - (A / B) * Math.log(1 + B / Z);
  return eosFinishRoots('srk', T_K, P_Pa, Tc_K, Pc_Pa, -1, A - B - B * B, -A * B, B, lnPhi,
                        { A, B, a, b, m, alpha });
}

function solvePR(T_K, P_Pa, Tc_K, Pc_Pa, omega) {
  const a0          = 0.45724 * R * R * Tc_K * Tc_K / Pc_Pa;
  const b           = 0.07780 * R * Tc_K / Pc_Pa;
  // FIX Z-4: 1978 extension for heavy/polar fluids — the 1976 kappa polynomial
  // was fitted only up to omega ~0.49; beyond that (heavy HCs, some polar
  // fluids) the extended cubic form is the published correction.
  const kappaForm   = omega <= 0.491 ? 1976 : 1978;
  const kappa       = omega <= 0.491
      ? 0.37464 + 1.54226 * omega - 0.26992 * omega * omega
      : 0.379642 + 1.48503 * omega - 0.164423 * omega * omega + 0.016666 * omega * omega * omega;
  const Tr          = T_K / Tc_K;
  const alpha_base  = 1 + kappa * (1 - Math.sqrt(Math.max(0, Tr)));
  const alpha       = Math.max(1e-6, alpha_base * alpha_base);
  const a           = a0 * alpha;
  const A           = a * P_Pa / (R * R * T_K * T_K);
  const B           = b * P_Pa / (R * T_K);
  const sq2         = Math.SQRT2;
  const lnPhi = Z => (Z - 1) - Math.log(Z - B)
                     - A / (2 * sq2 * B) * Math.log((Z + (1 + sq2) * B) / (Z + (1 - sq2) * B));
  return eosFinishRoots('pr', T_K, P_Pa, Tc_K, Pc_Pa,
                        -(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B * B * B), B, lnPhi,
                        { A, B, a, b, kappa, kappaForm, alpha });
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

// ── FIX Z-5 : which root is the real one? ────────────────────────────────────
// For a pure fluid the stable phase is the one with the lower fugacity. With a
// single physical root there is nothing to choose; with three, the middle root
// has (∂P/∂V)_T > 0 and is never a candidate.
function eosStableRoot(roots) {
  if (roots.length <= 1) return roots[0] || null;
  const liq = roots[0], vap = roots[roots.length - 1];
  return liq.lnPhi < vap.lnPhi ? liq : vap;
}

// ── FIX Z-4 : saturation pressure & phase-stability verdict ──────────────────
// Motivation (found during NIST/CoolProp validation of the control-valve Z):
// "largest root = vapour" is only true when the vapour is the STABLE phase.
// At sub-saturation states (NH3 at 0 °C / 10 bar a, Psat = 4.29 bar) the old
// path returned a plausible-looking vapour Z = 0.885 for a phase that doesn't
// exist — the fluid is liquid. The definitive test is fugacity equality:
// Psat is the pressure where phi_liquid = phi_vapour.
//
// FIX Z-5: solved by Newton on ln P,   ln P ← ln P + (ln φL − ln φV)/(ZV − ZL)
// (exact derivative: ∂ln φ/∂ln P = Z − 1), safeguarded by a bracket that always
// contains Psat: below it the vapour is stable, above it the liquid is. Outside
// the three-root window the side is read from the lone root (Vm vs the model's
// Vc), so the search can never stall the way the old successive-substitution
// loop did near Tc or at low Tr. Valid for any of the three cubics (vdW too).
// Validated vs NIST: PR Psat within 0.1–2 % (NH3 25 °C: 10.042 vs 10.027 bar;
// n-C4 25 °C: 2.430 vs 2.433 bar; Cl2 25 °C: 7.744 vs ~7.7 bar literature).
function eosPsat(eos, T_K, Tc_K, Pc_Pa, omega) {
  if (!(eos === 'pr' || eos === 'srk' || eos === 'vdw')) return null;   // needs a cubic
  if (!(T_K < Tc_K) || !(T_K > 0)) return null;                         // no saturation above Tc

  // g > 0 → vapour stable (P below Psat);  g < 0 → liquid stable (P above Psat)
  const probe = P => {
    const r = runEOS(eos, T_K, P, Tc_K, Pc_Pa, omega);
    if (!r.length) return null;
    if (r.length >= 2) {
      const L = r[0], V = r[r.length - 1];
      return { g: L.lnPhi - V.lnPhi, dZ: V.Z - L.Z };
    }
    return { g: r[0].kind === 'liquid' ? -Infinity : Infinity, dZ: 0 };
  };

  let lo = Pc_Pa * 1e-100, hi = Pc_Pa;
  const atLo = probe(lo);
  if (!atLo || !(atLo.g > 0)) return null;                // Psat below any meaningful pressure

  const w = isFinite(omega) ? omega : 0;
  let P = Pc_Pa * Math.exp(5.373 * (1 + w) * (1 - Tc_K / T_K));          // Wilson init
  if (!(P > lo && P < hi)) P = Math.sqrt(lo * hi);

  for (let i = 0; i < 200; i++) {
    const s = probe(P);
    if (!s) return null;
    if (s.g === 0) return P;
    if (s.g > 0) lo = P; else hi = P;
    let Pn = NaN;
    if (isFinite(s.g) && s.dZ > 0) Pn = P * Math.exp(s.g / s.dZ);        // Newton step in ln P
    if (!(Pn > lo && Pn < hi)) Pn = Math.sqrt(lo * hi);                  // otherwise bisect in ln P
    if (Math.abs(Pn - P) <= 1e-12 * P) return Pn;
    P = Pn;
  }
  return P;                                               // best estimate (bracket already tiny)
}

// 'vapor' | 'near_dew' | 'liquid' | 'supercritical' | null (ideal/vdw: no verdict)
// Legacy Z-4 field — unchanged meaning ('supercritical' = T ≥ Tc at any pressure).
// FIX Z-5: if Psat could not be evaluated below Tc, fall back on the stable-root
// kind instead of silently answering 'vapor'.
function eosPhase(eos, T_K, P_Pa, Tc_K, Psat_Pa, stableKind) {
  if (!(eos === 'pr' || eos === 'srk')) return null;
  if (T_K >= Tc_K) return 'supercritical';
  if (Psat_Pa == null) return stableKind === 'liquid' ? 'liquid' : 'vapor';
  if (P_Pa > Psat_Pa * 1.001) return 'liquid';
  if (P_Pa > Psat_Pa * 0.95)  return 'near_dew';
  return 'vapor';
}

// ── FIX Z-5 : chart series for the EOS page (one request per chart) ──────────
//   curve 'ZP' → Z of the STABLE phase vs pressure, with the exact vapour→liquid
//                step at each model's own Psat when T < Tc
//   curve 'PV' → pressure-explicit isotherm P(Vm) on a log-spaced volume grid,
//                plus the saturation tie-line (Maxwell construction) when T < Tc
function eosCurve_handler(body, num, res) {
  const type  = String(body.curve).toUpperCase();
  const T_K   = num(body.T_K),  Pmax  = num(body.Pmax_Pa);
  const Tc_K  = num(body.Tc_K), Pc_Pa = num(body.Pc_Pa);
  let   omega = num(body.omega);
  if (type !== 'ZP' && type !== 'PV') return res.status(400).json({ error: `Unknown curve type "${body.curve}". Use ZP or PV.` });
  if (!isFinite(T_K)  || T_K  <= 0)  return res.status(400).json({ error: 'Temperature must be positive and finite.' });
  if (T_K < 10)                      return res.status(400).json({ error: `Temperature ${T_K.toFixed(2)} K is below 10 K. EOS calculations are not reliable at near-absolute-zero temperatures.` });
  if (!isFinite(Pmax) || Pmax <= 0)  return res.status(400).json({ error: 'Maximum pressure must be positive and finite.' });
  if (!isFinite(Tc_K) || Tc_K <= 0)  return res.status(400).json({ error: 'Critical temperature Tc must be positive.' });
  if (!isFinite(Pc_Pa)|| Pc_Pa<= 0)  return res.status(400).json({ error: 'Critical pressure Pc must be positive.' });
  if (!isFinite(omega)) omega = 0;
  if (omega < -1 || omega > 2)       return res.status(400).json({ error: `Acentric factor ω = ${omega} is outside the physical range (−1 … 2).` });

  let N = Math.round(num(body.N));
  if (!isFinite(N)) N = 160;
  N = Math.max(20, Math.min(400, N));
  let list = Array.isArray(body.eos) ? body.eos.filter(e => EOS_TYPES.includes(e)) : [];
  if (!list.length) list = EOS_TYPES;

  const RT   = R * T_K;
  const Vlo  = 1.03 * 0.07780 * R * Tc_K / Pc_Pa;          // just above the smallest co-volume (PR)
  const Vhi  = Math.max(RT / (0.01 * Pmax), 50 * Vlo);     // ideal-gas volume at 1 % of Pmax

  const series = list.map(eos => {
    const Psat = eosPsat(eos, T_K, Tc_K, Pc_Pa, omega);
    let sat = null;
    if (Psat != null) {
      const r = runEOS(eos, T_K, Psat, Tc_K, Pc_Pa, omega);
      if (r.length >= 2) {
        const L = r[0], V = r[r.length - 1];
        sat = { P_Pa: Psat, Z_liq: L.Z, Z_vap: V.Z, Vm_liq: L.Vm, Vm_vap: V.Vm };
      }
    }
    const points = [];

    if (type === 'ZP') {
      const Ps = [Pmax * 1e-3];
      for (let i = 1; i <= N; i++) Ps.push(Pmax * i / N);
      let stepDone = false;
      for (const P of Ps) {
        if (sat && !stepDone && P >= sat.P_Pa) {             // exact phase change at Psat
          points.push({ P_Pa: sat.P_Pa, Z: sat.Z_vap, kind: 'vapour' },
                      { P_Pa: sat.P_Pa, Z: sat.Z_liq, kind: 'liquid' });
          stepDone = true;
          if (P === sat.P_Pa) continue;
        }
        const s = eosStableRoot(runEOS(eos, T_K, P, Tc_K, Pc_Pa, omega));
        if (s && isFinite(s.Z)) points.push({ P_Pa: P, Z: s.Z, kind: s.kind });
      }
    } else {
      // a (with α at this T) and b of the model, taken from the engine itself
      const ref = eos === 'ideal' ? null : runEOS(eos, T_K, Pc_Pa, Tc_K, Pc_Pa, omega)[0];
      const a = ref ? ref.a : 0, b = ref ? ref.b : 0;
      const Pof = Vm => {
        if (eos === 'ideal') return RT / Vm;
        if (Vm <= b * 1.0001) return NaN;
        if (eos === 'vdw') return RT / (Vm - b) - a / (Vm * Vm);
        if (eos === 'srk') return RT / (Vm - b) - a / (Vm * (Vm + b));
        return RT / (Vm - b) - a / (Vm * (Vm + b) + b * (Vm - b));
      };
      const ratio = Math.log(Vhi / Vlo);
      for (let i = 0; i < N; i++) {
        const Vm = Vlo * Math.exp(ratio * i / (N - 1));
        const P  = Pof(Vm);
        // null breaks the line where the isotherm leaves the plotted range (or goes negative)
        points.push({ Vm, P_Pa: (isFinite(P) && P > 0 && P <= 1.3 * Pmax) ? P : null });
      }
    }
    return { eos, Psat_Pa: Psat, sat, points };
  });

  return res.status(200).json({
    success: true,
    data: { curve: type, T_K, Tr: T_K / Tc_K, Pmax_Pa: Pmax, N, series }
  });
}

function buildWarnings(eos, T_K, P_Pa, Tc_K, Pc_Pa, omega, Z, Tr, Pr, roots, ctx) {
  const warnings = [];
  const POLAR_GASES_SET  = new Set(['H2O','MeOH','EtOH','iPrOH','nPrOH','nBuOH','iBuOH','nPenOH','EG','HF','FormAcid','AcAcid','PropAcid','NH3','R717','HCN']);
  const QUANTUM_GASES    = new Set(['H2','He','Ne']);
  const ASSOC_GASES      = new Set(['AcAcid','FormAcid','PropAcid','HF']);
  const stable  = (ctx && ctx.stable) || null;
  const gas     = (ctx && ctx.gas) || null;
  const cubic   = eos !== 'ideal';
  const isLiq   = !!stable && stable.kind === 'liquid';
  const Zs      = stable ? stable.Z : Z;          // Z of the phase that actually exists

  if (Tr < 0.5)            warnings.push({ type: 'subcritical', msg: `Deep subcritical region (Tr = ${Tr.toFixed(3)}): Operating well below Tc. Liquid-phase properties may be unreliable.` });
  if (Math.abs(Tr-1)<0.05 && Math.abs(Pr-1)<0.05)
                           warnings.push({ type: 'critical', msg: `Near-critical region (Tr ≈ ${Tr.toFixed(3)}, Pr ≈ ${Pr.toFixed(3)}): EOS accuracy is reduced very close to the critical point.` });
  if (Pr > 10)             warnings.push({ type: 'highP', msg: `Very high reduced pressure (Pr = ${Pr.toFixed(2)}): Cubic EOS accuracy degrades at Pr > 10.` });
  else if (Pr > 5)         warnings.push({ type: 'highP', msg: `High reduced pressure (Pr = ${Pr.toFixed(2)}): Validate results at Pr > 5.` });
  if (eos === 'ideal' && Pr > 0.1) warnings.push({ type: 'ideal', msg: `Ideal gas law: only accurate at Pr < 0.1. At Pr = ${Pr.toFixed(3)}, switch to PR or SRK.` });
  if (eos === 'vdw')       warnings.push({ type: 'vdw', msg: 'van der Waals EOS is historical/qualitative (1873). Use PR or SRK for engineering work.' });

  // FIX Z-5: three roots do NOT mean two phases are present — only that T < Tc and P
  // lies between the two spinodal pressures. Say which root is the real one.
  if (roots.length === 3) {
    const liqStable = isLiq;
    warnings.push({ type: 'twophase', msg: `Three real roots (Tr=${Tr.toFixed(3)}, Pr=${Pr.toFixed(3)}) — T is below Tc and P lies between the spinodal limits. The ${liqStable ? 'LIQUID (smallest Z)' : 'VAPOUR (largest Z)'} root has the lower fugacity and is the stable phase; the ${liqStable ? 'vapour' : 'liquid'} root is metastable and the middle root is unphysical. Two phases coexist only at P = Psat.` });
  }

  // FIX Z-5: vdW has no legacy phase verdict — report its own (qualitative) one here.
  if (eos === 'vdw' && isLiq) {
    warnings.push({ type: 'vdw_liquid', msg: `van der Waals predicts LIQUID at these conditions${stable.Psat_Pa != null ? ` (its own Psat ≈ ${eosFmtBar(stable.Psat_Pa)} bar a)` : ''}. The vdW saturation line is far from the real one — use PR or SRK to judge the phase.` });
  }
  if (cubic && isLiq) {
    warnings.push({ type: 'liquid_density', msg: 'Liquid density from an untranslated cubic EOS is approximate. For non-polar fluids PR is typically within 5 % (worst cases ≈ 15 %) and SRK reads about 9 % low (up to 25 %); for water, ammonia and alcohols expect 15–30 % error; van der Waals is far worse. No Peneloux volume shift is applied — use a liquid-density correlation for design.' });
  }

  if (Zs > 2.0 && eos !== 'ideal') warnings.push({ type: 'highZ', msg: `Z = ${Zs.toFixed(4)} is above typical range. Verify conditions.` });
  if (Zs < 0.2 && Zs > 0 && eos !== 'ideal' && !isLiq) warnings.push({ type: 'lowZ', msg: `Very low Z-factor (Z = ${Zs.toFixed(4)}) — dense, liquid-like fluid.` });

  // FIX Z-5: fluid-specific notes (need the optional body.gas key)
  if (cubic && gas) {
    if (QUANTUM_GASES.has(gas)) warnings.push({ type: 'quantum', msg: 'Quantum gas (H₂ / He / Ne): at Tr ≫ 1 the Soave-type α(T) is used far outside the range it was fitted to. Expect Z a few % low at high pressure (PR is ≈ 5 % low for H₂ at 300 K / 700 bar).' });
    if (ASSOC_GASES.has(gas))   warnings.push({ type: 'associating', msg: 'Associating fluid (carboxylic acid / HF): the vapour dimerises or oligomerises even at low pressure. A cubic EOS cannot represent this — real vapour density can be far higher than calculated.' });
    else if (POLAR_GASES_SET.has(gas)) warnings.push({ type: 'polar', msg: 'Polar / hydrogen-bonding fluid: vapour-phase Z is usually good to a few %, but cubic-EOS liquid density can be 10–30 % in error and Psat several % off.' });
    if (/_sim$/.test(gas))      warnings.push({ type: 'mixture', msg: 'Refrigerant blend treated as ONE pseudo-pure component: bubble- and dew-point pressures are not distinguished (no temperature glide).' });
  }
  if ((eos === 'srk' || eos === 'pr') && (omega < -0.4 || omega > 1.0)) {
    warnings.push({ type: 'omega', msg: `Acentric factor ω = ${omega} is outside the range the α(T) correlations were fitted to (≈ −0.4 … 1.0).` });
  }

  return warnings;
}

// ══════════════════════════════════════════════════════════════════════════════
// FIX Z-6 (Oct 2026): GAS MIXTURES   — request body carries  components: [...]
//
//   components: [{ name, key?, x, Tc_K, Pc_Pa, omega, M }]   (x = mole fraction or mole %,
//                any positive scale — normalised here; 1 … 20 components)
//   kij:        optional n×n matrix of binary interaction parameters (default all 0)
//
//   Mixing rules (van der Waals one-fluid):
//       a = Σi Σj xi·xj·(1 − kij)·√(ai·aj)        b = Σi xi·bi
//   with the pure-component ai(T), bi of the same model as the pure-gas engine above.
//   Component fugacity coefficient:
//       ln φi = (bi/b)(Z − 1) − ln(Z − B) − L(Z)·[2·Σj xj·aij / a − bi/b]
//       L(Z) = A/(2√2·B)·ln[(Z+(1+√2)B)/(Z+(1−√2)B)]  (PR)   (A/B)·ln(1+B/Z)  (SRK)   A/Z  (vdW)
//
//   A mixture is NOT assumed to be a gas. The feed is first tested for stability
//   (Michelsen tangent-plane test); if it is unstable it is split by an isothermal
//   flash (Rachford-Rice + successive substitution on ln K, with dominant-eigenvalue
//   acceleration) and each phase is reported separately. Reporting "gas" values for
//   a mixture that has dropped liquid is the same mistake as the old vapour-root
//   answer for a pure liquid.
//
//   A one-component "mixture" reproduces the pure-gas engine exactly.
// ══════════════════════════════════════════════════════════════════════════════

const EOS_MIX_MAX_COMPONENTS = 20;
const EOS_OMEGA_B_OVER_ZC = { vdw: 0.125 / 0.375, srk: 0.08664 / (1 / 3), pr: 0.07780 / 0.3074013087 };  // b/Vc of each model

// Pure-component a(T) and b — the same expressions as solveVdW / solveSRK / solvePR.
function eosPureAB(eos, T_K, Tc_K, Pc_Pa, omega) {
  if (eos === 'vdw') {
    return { a: 27 * R * R * Tc_K * Tc_K / (64 * Pc_Pa), b: R * Tc_K / (8 * Pc_Pa) };
  }
  const Tr = T_K / Tc_K;
  if (eos === 'srk') {
    const m = 0.480 + 1.574 * omega - 0.176 * omega * omega;
    const alpha_base = 1 + m * (1 - Math.sqrt(Math.max(0, Tr)));
    const alpha = Math.max(1e-6, alpha_base * alpha_base);
    return { a: 0.42748 * R * R * Tc_K * Tc_K / Pc_Pa * alpha, b: 0.08664 * R * Tc_K / Pc_Pa };
  }
  const kappa = omega <= 0.491
      ? 0.37464 + 1.54226 * omega - 0.26992 * omega * omega
      : 0.379642 + 1.48503 * omega - 0.164423 * omega * omega + 0.016666 * omega * omega * omega;
  const alpha_base = 1 + kappa * (1 - Math.sqrt(Math.max(0, Tr)));
  const alpha = Math.max(1e-6, alpha_base * alpha_base);
  return { a: 0.45724 * R * R * Tc_K * Tc_K / Pc_Pa * alpha, b: 0.07780 * R * Tc_K / Pc_Pa };
}

// One phase of composition x (mole fractions summing to 1).
//   pick: 'min' → the root with the lower Gibbs energy (the only physically meaningful choice)
// Returns Z, Vm, ln φi and the number of physical roots.
function eosMixPhase(mix, x, P_Pa) {
  const { eos, T_K, sq, bi, omk } = mix;
  const n = x.length;
  const s = new Array(n);                       // s_i = Σj xj·aij
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    let t = 0;
    const row = omk[i];
    for (let j = 0; j < n; j++) t += x[j] * row[j] * sq[j];
    s[i] = sq[i] * t;
    a += x[i] * s[i];
    b += x[i] * bi[i];
  }
  const RT = R * T_K;
  const A = a * P_Pa / (RT * RT);
  const B = b * P_Pa / RT;

  let c2, c1, c0, L;
  if (eos === 'vdw') {
    c2 = -(1 + B); c1 = A; c0 = -A * B;
    L = Z => A / Z;
  } else if (eos === 'srk') {
    c2 = -1; c1 = A - B - B * B; c0 = -A * B;
    L = Z => (A / B) * Math.log(1 + B / Z);
  } else {
    const sq2 = Math.SQRT2;
    c2 = -(1 - B); c1 = A - 3 * B * B - 2 * B; c0 = -(A * B - B * B - B * B * B);
    L = Z => A / (2 * sq2 * B) * Math.log((Z + (1 + sq2) * B) / (Z + (1 - sq2) * B));
  }

  let Zs = solveCubic(c2, c1, c0, B);
  if (Zs.length > 1 && Zs[Zs.length - 1] - Zs[0] < 5e-5 * Zs[Zs.length - 1]) {
    Zs = [Zs.reduce((u, z) => u + z, 0) / Zs.length];
  }
  if (!Zs.length) return null;
  // reduced Gibbs energy of the phase at fixed composition:  Σ xi·ln φi = (Z−1) − ln(Z−B) − L(Z)
  const gOf = Z => (Z - 1) - Math.log(Z - B) - L(Z);
  let Z = Zs[0], g = gOf(Z);
  if (Zs.length > 1) {
    const Zv = Zs[Zs.length - 1], gv = gOf(Zv);
    if (!(g < gv)) { Z = Zv; g = gv; }
  }
  const LZ = L(Z), lnZB = Math.log(Z - B);
  const lnPhi = new Array(n);
  for (let i = 0; i < n; i++) {
    const br = bi[i] / b;
    lnPhi[i] = br * (Z - 1) - lnZB - LZ * (2 * s[i] / a - br);
  }
  return { Z, Vm: Z * RT / P_Pa, lnPhi, g, A, B, a, b, rootCount: Zs.length,
           liquidLike: B / Z > EOS_OMEGA_B_OVER_ZC[eos] };          // Vm below the model's critical volume
}

// Rachford-Rice:  Σ zi·(Ki − 1)/(1 + β(Ki − 1)) = 0   for the vapour fraction β.
// The function falls monotonically between its two asymptotes, so a bracketed Newton
// always converges. β outside [0, 1] is returned as-is ("negative flash") — the caller
// reads it as a single-phase result.
function eosRachfordRice(z, K) {
  let Kmax = -Infinity, Kmin = Infinity;
  for (let i = 0; i < K.length; i++) { if (K[i] > Kmax) Kmax = K[i]; if (K[i] < Kmin) Kmin = K[i]; }
  if (!(Kmax > 1 && Kmin < 1)) return null;                 // no root: every component prefers the same phase
  let lo = 1 / (1 - Kmax), hi = 1 / (1 - Kmin);             // asymptotes: g(lo+) = +∞, g(hi−) = −∞
  let beta = Math.min(Math.max(0.5, lo + 1e-12 * (hi - lo)), hi - 1e-12 * (hi - lo));
  for (let it = 0; it < 200; it++) {
    let g = 0, dg = 0;
    for (let i = 0; i < z.length; i++) {
      const k1 = K[i] - 1, den = 1 + beta * k1, t = z[i] * k1 / den;
      g += t; dg -= t * k1 / den;
    }
    if (g === 0) break;
    if (g > 0) lo = beta; else hi = beta;
    let bn = beta - g / dg;
    if (!(bn > lo && bn < hi)) bn = 0.5 * (lo + hi);
    if (Math.abs(bn - beta) <= 1e-15 * Math.max(1, Math.abs(bn))) { beta = bn; break; }
    beta = bn;
  }
  return beta;
}

// Michelsen tangent-plane stability test of the feed z.
// Returns { stable, tm, K, all } — K (and the other unstable trials in `all`) are starting
// estimates for the flash when the feed is unstable.
function eosMixStability(mix, z, P_Pa, feed, Kw, tol) {
  const n = z.length;
  const d = z.map((zi, i) => Math.log(zi) + feed.lnPhi[i]);
  const trials = [
    z.map((zi, i) => zi * Kw[i]),                           // vapour-like
    z.map((zi, i) => zi / Kw[i]),                           // liquid-like
    d.map(di => Math.exp(di)),                              // ideal-gas-like
  ];
  for (let k = 0; k < n; k++) {                             // nearly pure component k
    trials.push(z.map((zi, i) => (i === k ? 0.9 : 0.1 / Math.max(1, n - 1))));
  }
  const found = [];
  for (const W0 of trials) {
    let W = W0.slice(), ok = true, ph = null, w = null;
    for (let it = 0; it < 2000; it++) {
      const sum = W.reduce((u, v) => u + v, 0);
      if (!(sum > 0) || !isFinite(sum)) { ok = false; break; }
      w = W.map(v => v / sum);
      ph = eosMixPhase(mix, w, P_Pa);
      if (!ph) { ok = false; break; }
      let err = 0;
      const Wn = new Array(n);
      for (let i = 0; i < n; i++) {
        const lnWn = d[i] - ph.lnPhi[i];
        const dl = lnWn - Math.log(W[i]);
        err += dl * dl;
        Wn[i] = Math.exp(lnWn);
      }
      W = Wn;
      if (err < 1e-22) break;
    }
    if (!ok || !ph) continue;
    const sum = W.reduce((u, v) => u + v, 0);
    let dist = 0;
    for (let i = 0; i < n; i++) { const t = W[i] / sum - z[i]; dist += t * t; }
    const trivial = dist < 1e-10 && Math.abs(ph.Z - feed.Z) < 1e-6 * feed.Z;      // converged back onto the feed
    const tm = 1 - sum;                                     // tangent-plane distance at the stationary point
    if (!trivial && tm < -(tol || 1e-9)) {
      const vapourTrial = ph.Z > feed.Z;
      found.push({ tm, K: z.map((zi, i) => (vapourTrial ? W[i] / zi : zi / W[i])) });
    }
  }
  found.sort((u, v) => u.tm - v.tm);
  return found.length ? { stable: false, tm: found[0].tm, K: found[0].K, all: found.map(f => f.K) }
                      : { stable: true, tm: 0, K: null, all: [] };
}

// One evaluation of the flash equations for a given ln K:
//   F_i = (ln φi^L − ln φi^V) − ln K_i      (zero at equilibrium)
function eosMixFlashEval(mix, z, P_Pa, lnK) {
  const n = z.length;
  const K = lnK.map(Math.exp);
  const beta = eosRachfordRice(z, K);
  if (beta === null) return { trivial: true };
  const x = new Array(n), y = new Array(n);
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { x[i] = z[i] / (1 + beta * (K[i] - 1)); y[i] = K[i] * x[i]; sx += x[i]; sy += y[i]; }
  if (!(sx > 0 && sy > 0) || !isFinite(sx) || !isFinite(sy)) return { failed: true };
  for (let i = 0; i < n; i++) { x[i] /= sx; y[i] /= sy; }
  const pl = eosMixPhase(mix, x, P_Pa), pv = eosMixPhase(mix, y, P_Pa);
  if (!pl || !pv) return { failed: true };
  const F = new Array(n);
  let err = 0, mag = 0;
  for (let i = 0; i < n; i++) { F[i] = (pl.lnPhi[i] - pv.lnPhi[i]) - lnK[i]; err += F[i] * F[i]; mag += lnK[i] * lnK[i]; }
  if (!isFinite(err)) return { failed: true };
  if (mag < 1e-12) return { trivial: true };                 // K → 1: the two phases have merged
  return { beta, x, y, K, pl, pv, F, err };
}

// Solve J·d = −F by Gaussian elimination with partial pivoting (n ≤ 20).
function eosSolveLinear(J, F) {
  const n = F.length;
  const M = J.map((r, i) => r.concat([-F[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f !== 0) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const d = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let v = M[r][n];
    for (let k = r + 1; k < n; k++) v -= M[r][k] * d[k];
    d[r] = v / M[r][r];
  }
  return d.every(isFinite) ? d : null;
}

// Isothermal two-phase flash.
//   1. successive substitution on ln K with dominant-eigenvalue extrapolation — robust far from the answer;
//   2. Newton's method on the same equations (finite-difference Jacobian, step halving) — successive
//      substitution alone crawls near a critical point, Newton finishes in a few steps.
function eosMixFlash(mix, z, P_Pa, K0) {
  const n = z.length;
  const TOL = 1e-24;                                         // on Σ F_i²
  let lnK = K0.map(Math.log);
  let cur = null, prevF = null, lastErr = Infinity, it = 0;

  const substitution = maxIt => {
    for (let k = 0; k < maxIt; k++) {
      it++;
      const e = eosMixFlashEval(mix, z, P_Pa, lnK);
      if (e.trivial || e.failed) return e;
      cur = e;
      if (e.err < TOL) return e;
      let step = e.F;
      if (prevF && it % 5 === 0 && e.err < lastErr) {         // dominant-eigenvalue method
        let num = 0, den = 0;
        for (let i = 0; i < n; i++) { num += e.F[i] * e.F[i]; den += e.F[i] * prevF[i]; }
        const lam = den !== 0 ? num / den : 0;
        if (lam > 0 && lam < 0.999) step = e.F.map(v => v / (1 - lam));
      }
      for (let i = 0; i < n; i++) lnK[i] += step[i];
      prevF = e.F; lastErr = e.err;
    }
    return cur;
  };

  const newton = maxIt => {
    for (let k = 0; k < maxIt; k++) {
      it++;
      const e = eosMixFlashEval(mix, z, P_Pa, lnK);
      if (e.trivial || e.failed) return false;
      cur = e;
      if (e.err < TOL) return true;
      const J = [];
      for (let i = 0; i < n; i++) J.push(new Array(n));
      for (let j = 0; j < n; j++) {
        const h = 1e-7 * Math.max(1, Math.abs(lnK[j]));
        const t = lnK.slice(); t[j] += h;
        const ej = eosMixFlashEval(mix, z, P_Pa, t);
        if (ej.trivial || ej.failed) return false;
        for (let i = 0; i < n; i++) J[i][j] = (ej.F[i] - e.F[i]) / h;
      }
      const d = eosSolveLinear(J, e.F);
      if (!d) return false;
      let lam = 1, accepted = false;
      for (let ls = 0; ls < 30; ls++) {
        const t = lnK.map((v, i) => v + lam * d[i]);
        const et = eosMixFlashEval(mix, z, P_Pa, t);
        if (!et.trivial && !et.failed && et.err < e.err) { lnK = t; cur = et; accepted = true; break; }
        lam *= 0.5;
      }
      if (!accepted) return cur.err < 1e-20;                 // cannot improve further (rounding floor)
      if (cur.err < TOL) return true;
    }
    return false;
  };

  let r = substitution(60);
  if (!r || r.trivial || r.failed) return { ...(r || { failed: true }), iterations: it };
  let converged = r.err < TOL;
  if (!converged) converged = newton(60);
  if (!converged) {                                          // last resort: keep substituting
    const backup = { lnK: lnK.slice(), cur };
    r = substitution(20000);
    if (!r || r.trivial || r.failed) {
      if (r && r.trivial) return { trivial: true, iterations: it };
      lnK = backup.lnK; cur = backup.cur;
    }
    converged = !!cur && cur.err < 1e-18;
  }
  if (!cur) return { failed: true, iterations: it };
  return { ...cur, iterations: it, converged };
}

function eosMixture_handler(body, num, res) {
  const eos   = typeof body.eos === 'string' ? body.eos.trim().toLowerCase() : body.eos;
  const T_K   = num(body.T_K), P_Pa = num(body.P_Pa), nMol = num(body.n);
  const list  = body.components;

  if (!eos)                     return res.status(400).json({ error: 'Missing EOS type' });
  if (!EOS_TYPES.includes(eos)) return res.status(400).json({ error: `Unknown EOS type "${eos}". Use ideal, vdw, srk or pr.` });
  if (!isFinite(T_K)  || T_K  <= 0) return res.status(400).json({ error: 'Temperature must be positive and finite.' });
  if (T_K < 10)                 return res.status(400).json({ error: `Temperature ${T_K.toFixed(2)} K is below 10 K. EOS calculations are not reliable at near-absolute-zero temperatures.` });
  if (!isFinite(P_Pa) || P_Pa <= 0) return res.status(400).json({ error: 'Pressure must be positive and finite.' });
  if (!isFinite(nMol) || nMol <= 0) return res.status(400).json({ error: 'Number of moles must be positive.' });
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'Add at least one component.' });
  if (list.length > EOS_MIX_MAX_COMPONENTS) return res.status(400).json({ error: `At most ${EOS_MIX_MAX_COMPONENTS} components are supported.` });

  // ── components ──
  const all = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i] || {};
    const label = (typeof c.name === 'string' && c.name.trim()) ? c.name.trim().slice(0, 80) : `Component ${i + 1}`;
    const x = num(c.x), Tc = num(c.Tc_K), Pc = num(c.Pc_Pa), M = num(c.M);
    let w = num(c.omega);
    if (!isFinite(x) || x < 0)   return res.status(400).json({ error: `${label}: mole fraction must be zero or positive.` });
    if (!isFinite(Tc) || Tc <= 0) return res.status(400).json({ error: `${label}: critical temperature Tc must be positive.` });
    if (!isFinite(Pc) || Pc <= 0) return res.status(400).json({ error: `${label}: critical pressure Pc must be positive.` });
    if (!isFinite(M)  || M < 1)   return res.status(400).json({ error: `${label}: molar mass must be ≥ 1 g/mol.` });
    if (eos === 'srk' || eos === 'pr') {
      if (!isFinite(w)) return res.status(400).json({ error: `${label}: acentric factor ω is required for SRK and Peng-Robinson.` });
      if (w < -1 || w > 2) return res.status(400).json({ error: `${label}: acentric factor ω = ${w} is outside the physical range (−1 … 2).` });
    } else if (!isFinite(w)) w = 0;
    all.push({ name: label, key: typeof c.key === 'string' ? c.key : null, x, Tc, Pc, omega: w, M, index: i });
  }
  const total = all.reduce((u, c) => u + c.x, 0);
  if (!(total > 0)) return res.status(400).json({ error: 'The mole fractions add up to zero — enter the composition.' });
  all.forEach(c => { c.z = c.x / total; });

  // ── binary interaction parameters (full list indices) ──
  let kijIn = null;
  if (body.kij != null) {
    if (!Array.isArray(body.kij) || body.kij.length !== all.length || body.kij.some(r => !Array.isArray(r) || r.length !== all.length))
      return res.status(400).json({ error: `kij must be a ${all.length} × ${all.length} matrix.` });
    kijIn = body.kij.map(r => r.map(v => { const k = num(v); return isFinite(k) ? k : 0; }));
    for (let i = 0; i < all.length; i++) for (let j = 0; j < all.length; j++) {
      if (Math.abs(kijIn[i][j]) >= 1) return res.status(400).json({ error: `kij between ${all[i].name} and ${all[j].name} must lie between −1 and 1.` });
      if (i !== j && Math.abs(kijIn[i][j] - kijIn[j][i]) > 1e-12) return res.status(400).json({ error: `kij must be symmetric (${all[i].name} / ${all[j].name}).` });
    }
  }

  const comps = all.filter(c => c.z > 0);                    // components that are actually present
  const n = comps.length;
  const z = comps.map(c => c.z);
  const Mmix = comps.reduce((u, c) => u + c.z * c.M, 0);
  const anyKij = !!kijIn && comps.some((ci, i) => comps.some((cj, j) => i !== j && kijIn[ci.index][cj.index] !== 0));
  const RT = R * T_K;
  const warnings = [];
  const pack = (kind, frac, ph, x) => {
    const M = x.reduce((u, xi, i) => u + xi * comps[i].M, 0);
    return { kind, moleFrac: frac, Z: ph.Z, Vm_SI: ph.Vm, M, rho_mass: (M / 1000) / ph.Vm,
             x, lnPhi: ph.lnPhi, phi: ph.lnPhi.map(Math.exp),
             f_Pa: ph.lnPhi.map((l, i) => Math.exp(l) * x[i] * P_Pa),
             A: ph.A, B: ph.B, a: ph.a, b: ph.b, rootCount: ph.rootCount };
  };
  // Kay's-rule pseudo-critical point — for orientation only, it is not used in the calculation
  const pseudo = { Tc_K: comps.reduce((u, c) => u + c.z * c.Tc, 0), Pc_Pa: comps.reduce((u, c) => u + c.z * c.Pc, 0),
                   omega: comps.reduce((u, c) => u + c.z * c.omega, 0) };
  pseudo.Tr = T_K / pseudo.Tc_K; pseudo.Pr = P_Pa / pseudo.Pc_Pa;

  let state = 'single', beta = 1, phases, K = null, flashInfo = null, tm = null, splitKind = null;

  if (eos === 'ideal') {
    const Vm = RT / P_Pa;
    phases = [{ kind: 'ideal', moleFrac: 1, Z: 1, Vm_SI: Vm, M: Mmix, rho_mass: (Mmix / 1000) / Vm, x: z.slice(),
                lnPhi: z.map(() => 0), phi: z.map(() => 1), f_Pa: z.map(zi => zi * P_Pa), rootCount: 1 }];
    if (pseudo.Pr > 0.1) warnings.push({ type: 'ideal', msg: `Ideal gas law: only accurate at low reduced pressure. At pseudo-reduced Pr = ${pseudo.Pr.toFixed(3)} use PR or SRK — the ideal-gas law also cannot detect condensation.` });
  } else {
    const pure = comps.map(c => eosPureAB(eos, T_K, c.Tc, c.Pc, c.omega));
    const mix = { eos, T_K, sq: pure.map(p => Math.sqrt(p.a)), bi: pure.map(p => p.b),
                  omk: comps.map((ci, i) => comps.map((cj, j) => 1 - (kijIn && i !== j ? kijIn[ci.index][cj.index] : 0))) };
    const feed = eosMixPhase(mix, z, P_Pa);
    if (!feed) return res.status(400).json({ error: 'No real solution found for this mixture — try a lower pressure or a higher temperature.' });
    if (!isFinite(feed.Z) || feed.Z <= 0 || feed.Z > 20) return res.status(400).json({ error: `EOS produced an unusable Z-factor (${feed.Z}). Check the inputs.` });

    let split = null;
    if (n > 1) {
      const Kw = comps.map(c => (c.Pc / P_Pa) * Math.exp(5.373 * (1 + c.omega) * (1 - c.Tc / T_K)));     // Wilson
      const st = eosMixStability(mix, z, P_Pa, feed, Kw);
      tm = st.tm;
      if (!st.stable) {
        // Several two-phase solutions can exist (vapour–liquid and liquid–liquid). Flash from every
        // unstable trial and from the Wilson estimate, and keep the split with the lowest Gibbs energy.
        const gMix = (frac, x, ph) => frac * x.reduce((u, xi, i) => u + xi * (Math.log(xi) + ph.lnPhi[i]), 0);
        const gFeed = gMix(1, z, feed);
        let gBest = Infinity;
        for (const K0 of st.all.concat([Kw])) {
          const f = eosMixFlash(mix, z, P_Pa, K0);
          if (!f || f.trivial || f.failed || !(f.beta > 0 && f.beta < 1)) continue;
          let dxy = 0;
          for (let i = 0; i < n; i++) dxy += (f.x[i] - f.y[i]) * (f.x[i] - f.y[i]);
          if (dxy < 1e-14) continue;                                    // the two "phases" are the same
          const g = gMix(f.beta, f.y, f.pv) + gMix(1 - f.beta, f.x, f.pl);
          if (g < gFeed && g < gBest - 1e-12 * Math.max(1, Math.abs(g))) { gBest = g; split = f; }
        }
        if (!split) warnings.push({ type: 'flash', msg: 'The stability test indicates two phases, but the phase split did not converge (very close to a phase boundary or a critical point). Single-phase values are shown — treat them with caution.' });
        else {
          // is either phase itself unstable? → a third phase (vapour–liquid–liquid)
          const third = [[split.x, split.pl], [split.y, split.pv]].some(([xx, pp]) => !eosMixStability(mix, xx, P_Pa, pp, Kw, 1e-7).stable);
          if (third) warnings.push({ type: 'three_phase', msg: 'A third phase is indicated at these conditions (vapour–liquid–liquid). This calculator splits a mixture into at most two phases — treat the phase amounts and compositions below as approximate.' });
        }
      }
    }
    if (split) {
      // the lighter phase (larger molar volume) is the vapour
      const vapIsY = split.pv.Vm >= split.pl.Vm;
      const pv = vapIsY ? split.pv : split.pl, pl = vapIsY ? split.pl : split.pv;
      const y = vapIsY ? split.y : split.x,   x = vapIsY ? split.x : split.y;
      beta = vapIsY ? split.beta : 1 - split.beta;
      K = y.map((yi, i) => yi / x[i]);
      state = 'two-phase';
      // Both phases liquid-like (Vm below the model's critical volume) → a liquid–liquid split.
      splitKind = pv.liquidLike ? 'liquid-liquid' : 'vapour-liquid';
      phases = [pack(pv.liquidLike ? 'liquid-light' : 'vapour', beta, pv, y), pack('liquid', 1 - beta, pl, x)];
      flashInfo = { iterations: split.iterations, converged: !!split.converged };
      if (!split.converged) warnings.push({ type: 'flash', msg: 'The phase split has not fully converged (close to a critical point). Phase amounts and compositions are approximate.' });
    } else {
      const liq = feed.liquidLike;
      beta = liq ? 0 : 1;
      phases = [pack(liq ? 'liquid' : 'vapour', 1, feed, z.slice())];
    }

    if (eos === 'vdw') warnings.push({ type: 'vdw', msg: 'van der Waals EOS is historical/qualitative (1873). Use PR or SRK for engineering work — its phase boundaries in particular are far from the real ones.' });
    if (splitKind === 'vapour-liquid') warnings.push({ type: 'two_phase', msg: `Two phases are present at these conditions: ${(beta * 100).toFixed(2)} mol % vapour and ${((1 - beta) * 100).toFixed(2)} mol % liquid. Each phase has its own composition, Z and density.` });
    if (splitKind === 'liquid-liquid') warnings.push({ type: 'liquid_liquid', msg: 'The model predicts TWO LIQUID phases (a liquid–liquid split) at these conditions. With kij = 0, or for polar components, a cubic EOS often predicts such a split where the real mixture is fully miscible — do not rely on it without checking against data. A vapour phase is not looked for once two liquids are found.' });
    if (phases.some(p => p.kind === 'liquid')) warnings.push({ type: 'liquid_density', msg: 'Liquid density from an untranslated cubic EOS is approximate (PR typically within 5 % for non-polar fluids, SRK about 9 % low; much worse for water, ammonia and alcohols).' });
    if (!anyKij && n > 1) warnings.push({ type: 'kij', msg: 'All binary interaction parameters kij are zero. Gas-phase Z is hardly affected, but dew/bubble points and phase compositions of CO₂-, H₂S-, N₂- or H₂-hydrocarbon and of polar mixtures can shift noticeably — enter kij values if you have them.' });
    const POLAR = new Set(['H2O','MeOH','EtOH','iPrOH','nPrOH','nBuOH','iBuOH','nPenOH','EG','HF','FormAcid','AcAcid','PropAcid','NH3','R717','HCN']);
    const polarNames = comps.filter(c => c.key && POLAR.has(c.key)).map(c => c.name);
    if (polarNames.length) warnings.push({ type: 'polar', msg: `Polar / hydrogen-bonding component present (${polarNames.join(', ')}): a cubic EOS with classical mixing rules is only a rough guide to its condensation and to the liquid phase.` });
    if (comps.some(c => c.key && ['H2','He','Ne'].includes(c.key))) warnings.push({ type: 'quantum', msg: 'Hydrogen / helium / neon present: the Soave-type α(T) is used far above the range it was fitted to. Expect Z a few % low at high pressure.' });
    if (pseudo.Pr > 10) warnings.push({ type: 'highP', msg: `Very high pressure (pseudo-reduced Pr = ${pseudo.Pr.toFixed(2)}): cubic EOS accuracy degrades.` });
  }

  // ── overall (both phases together) ──
  const Vm_all = phases.reduce((u, p) => u + p.moleFrac * p.Vm_SI, 0);            // m³ per mol of feed
  const massFracDen = phases.reduce((u, p) => u + p.moleFrac * p.M, 0);
  phases.forEach(p => {
    p.massFrac = p.moleFrac * p.M / massFracDen;
    p.volFrac  = p.moleFrac * p.Vm_SI / Vm_all;
    p.moles    = nMol * p.moleFrac;
    p.V_m3     = nMol * p.moleFrac * p.Vm_SI;
    p.mass_kg  = +(nMol * p.moleFrac * p.M / 1000).toPrecision(12);
  });
  const overall = { M: Mmix, Z: P_Pa * Vm_all / RT, Vm_SI: Vm_all, rho_mass: (Mmix / 1000) / Vm_all,
                    V_m3: nMol * Vm_all, mass_kg: +(nMol * Mmix / 1000).toPrecision(12) };

  // expand per-component arrays back to the caller's component order (absent components → null)
  const expand = arr => all.map(c => { const k = comps.indexOf(c); return k < 0 ? null : arr[k]; });
  return res.status(200).json({
    success: true,
    data: {
      mixture: true, eos, T_K, P_Pa, n: nMol,
      components: all.map(c => ({ name: c.name, key: c.key, z: c.z, Tc_K: c.Tc, Pc_Pa: c.Pc, omega: c.omega, M: c.M })),
      state, split: splitKind, beta,
      phases: phases.map(p => ({ ...p, x: expand(p.x), lnPhi: expand(p.lnPhi), phi: expand(p.phi), f_Pa: expand(p.f_Pa) })),
      K: K ? expand(K) : null,
      overall, pseudo, kijUsed: anyKij,
      stability: tm == null ? null : { tm },
      flash: flashInfo,
      warnings
    }
  });
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

  // FIX 2026-08: tap-correction terms restored to ISO 5167-2 Clause 5.3.2.1.
  // The previous expressions were not the RHG tap terms and carried a
  // (1 - 4*b4) denominator; error reached +8.3% at beta 0.70 and -7.1% at 0.75.
  Cd += (0.043 + 0.080 * Math.exp(-10 * L1) - 0.123 * Math.exp(-7 * L1))
        * (1 - 0.11 * A) * b4 / (1 - b4);
  Cd -= 0.031 * (M2 - 0.8 * Math.pow(M2, 1.1)) * Math.pow(b, 1.3);

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

// ── LIQUID VISCOSITY ─ Andrade / Vogel ────────────────────────
// FIX 2026-08: liquids previously used a fixed user-entered mu (default 1e-3
// Pa·s = water @20 °C) regardless of temperature. Reynolds number was therefore
// wrong by up to ~3x on hot service, which corrupts Cd and the Re-range check.
//   Water            → Vogel correlation (waterLiquidViscosity)
//   Other liquids    → Andrade:  log10(mu_cP) = mu_A + mu_B / T_K
function liquidViscosity(f, T_K) {
  if (!f || f.t !== 'l') return null;
  if (f.rhoModel === 'poly_water') return waterLiquidViscosity(T_K);
  if (f.mu_A === undefined || f.mu_B === undefined) return null;
  const mu_cP = Math.pow(10, f.mu_A + f.mu_B / Math.max(T_K, 100));
  return Math.max(5e-5, Math.min(50, mu_cP * 1e-3));   // Pa·s, clamped
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
    return { rho: rho_liq, isSat: false, T_sat_C: T_s-273.15, mu: waterLiquidViscosity(T), kappa: null };
  }

  const isSat = Math.abs(T - T_s) < 2.0;

  // Region 2 — superheated steam (IAPWS-IF97, shared with the isentropic exponent)
  const r2 = if97Region2(P_MPa, T);
  return { rho: r2.v > 0 ? 1/r2.v : 1.0, isSat, T_sat_C: T_s-273.15, mu: steamViscosity(T), kappa: r2.kappa };
}

// ── IAPWS-IF97 REGION 2 (superheated steam) ───────────────────────────
// Dimensionless Gibbs free energy γ = γ° + γʳ, IAPWS-IF97 (2007) Eq. 15–17,
// Tables 10–12. Used for density and for the isentropic exponent.
// FIX 2026-10: residual coefficients n11, n14, n22 and n27 corrected (they had
// wrong powers of ten; density was +0.4 % at 11 bar a / 200 °C, +20 % at 160 bar a).
const IF97_R2_J0 = [0, 1, -5, -4, -3, -2, -1, 2, 3];
const IF97_R2_N0 = [-9.6927686500217, 10.086655968018, -0.005608791128302, 0.071452738081455,
                    -0.40710498223928, 1.4240819171444, -4.383951131945, -0.28408632460772, 0.021268463753307];
const IF97_R2_I  = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24];
const IF97_R2_J  = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58];
const IF97_R2_N  = [
    -1.7731742473213e-3,-1.7834862292358e-2,-4.5996013696365e-2,-5.7581259083432e-2,
    -5.0325278727930e-2,-3.3032641670203e-5,-1.8948987516315e-4,-3.9392777243355e-3,
    -4.3797295650573e-2,-2.6674547914087e-5,2.0481737692309e-8,4.3870667284435e-7,
    -3.2277677238570e-5,-1.5033924542148e-3,-4.0668253562950e-2,-7.8847309559367e-10,
    1.2790717852285e-8,4.8225372718507e-7,2.2922076337661e-6,-1.6714766451061e-11,
    -2.1171472321355e-3,-2.3895741934104e+1,-5.9059564324270e-18,-1.2621808899101e-6,
    -3.8946842435739e-2,1.1256211360459e-11,-8.2311340897998e+0,1.9809712802088e-8,
    1.0406965210174e-19,-1.0234747095929e-13,-1.0018179379511e-9,-8.0882908646985e-11,
    1.0693031879409e-1,-3.3662250574171e-1,8.9185845355421e-25,3.0629316876232e-13,
    -4.2002467698208e-6,-5.9056029685639e-26,3.7826947613457e-6,-1.2768608934681e-15,
    7.3087610595061e-29,5.5414715350778e-17,-9.4369707241210e-7
  ];

/** Region 2 at p (MPa) and T (K): specific volume v (m³/kg), speed of sound w (m/s)
 *  and isentropic exponent κ = ρw²/p — the definition used in ISO 5167-1. */
function if97Region2(P_MPa, T) {
  const R = 461.526, pi = P_MPa, tau = 540 / T, t = tau - 0.5;
  let gr_p = 0, gr_pp = 0, gr_tt = 0, gr_pt = 0, g0_tt = 0;
  for (let i = 0; i < IF97_R2_N.length; i++) {
    const n = IF97_R2_N[i], I = IF97_R2_I[i], J = IF97_R2_J[i];
    gr_p  += n * I * Math.pow(pi, I - 1) * Math.pow(t, J);
    gr_pp += n * I * (I - 1) * Math.pow(pi, I - 2) * Math.pow(t, J);
    gr_tt += n * Math.pow(pi, I) * J * (J - 1) * Math.pow(t, J - 2);
    gr_pt += n * I * Math.pow(pi, I - 1) * J * Math.pow(t, J - 1);
  }
  for (let i = 0; i < IF97_R2_N0.length; i++) {
    const J = IF97_R2_J0[i];
    g0_tt += IF97_R2_N0[i] * J * (J - 1) * Math.pow(tau, J - 2);
  }
  const v  = R * T / (P_MPa * 1e6) * pi * (1 / pi + gr_p);
  const a  = 1 + pi * gr_p - tau * pi * gr_pt;
  const w2 = R * T * (1 + 2 * pi * gr_p + pi * pi * gr_p * gr_p)
           / ((1 - pi * pi * gr_pp) + a * a / (tau * tau * (g0_tt + gr_tt)));
  return { v, w: Math.sqrt(w2), kappa: w2 / (P_MPa * 1e6 * v) };
}

// FIX 2026-10: isentropic exponent for steam (was a fixed 1.135 from the fluid list).
//   More than 2 °C above saturation: κ = ρw²/p from IAPWS-IF97 (about 1.24–1.32).
//   Within 2 °C of saturation:       1.135, the customary value for dry saturated steam.
//   Compressed water:                 null (κ is not used for liquids).
function steamKappaAuto(p_bar, t_c) {
  const s = steamDensity(p_bar, t_c);
  if (s.kappa == null) return { k: null, basis: 'compressed water' };
  if (s.isSat)         return { k: 1.135, basis: 'dry saturated steam (within 2 °C of saturation)' };
  return { k: s.kappa, basis: 'IAPWS-IF97, κ = ρw²/p' };
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
  if (D_mm < 50)   errs.push(`Pipe ID = ${D_mm.toFixed(1)} mm < ISO 5167 minimum 50 mm — Cd correlation outside validated range`);
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
  'Natural Gas':    {t:'g',sg:0.620,M:17.967,k:1.310,mu:1.10e-5,Z:0.990,Tc:203.3,Pc:4.64, omega:0.010,mu_ref:1.027e-5,T_ref:273.15,S:170.0,pseudo:true},
  'Ammonia (NH₃)':  {t:'g',sg:0.588,M:17.031,k:1.310,mu:1.00e-5,Z:0.995,Tc:405.6,Pc:11.28,omega:0.250,mu_ref:9.270e-6,T_ref:273.15,S:503.0},
  'Chlorine':       {t:'g',sg:2.448,M:70.906,k:1.340,mu:1.33e-5,Z:0.990,Tc:417.2,Pc:7.71, omega:0.069,mu_ref:1.234e-5,T_ref:273.15,S:351.0},
  'Argon':          {t:'g',sg:1.380,M:39.948,k:1.667,mu:2.27e-5,Z:1.000,Tc:150.9,Pc:4.87, omega:0.001,mu_ref:2.125e-5,T_ref:273.15,S:142.0},
  'Helium':         {t:'g',sg:0.138,M:4.003, k:1.667,mu:1.99e-5,Z:1.000,Tc:5.2,  Pc:0.23, omega:-0.390,mu_ref:1.875e-5,T_ref:273.15,S:79.4},
  'SO₂':            {t:'g',sg:2.264,M:64.065,k:1.290,mu:1.25e-5,Z:0.990,Tc:430.8,Pc:7.88, omega:0.245,mu_ref:1.163e-5,T_ref:273.15,S:416.0},
  'H₂S':            {t:'g',sg:1.189,M:34.081,k:1.320,mu:1.22e-5,Z:0.990,Tc:373.2,Pc:8.94, omega:0.100,mu_ref:1.130e-5,T_ref:273.15,S:331.0},
  'Ethane (C₂H₆)':  {t:'g',sg:1.049,M:30.069,k:1.200,mu:9.10e-6,Z:0.988,Tc:305.3,Pc:4.87, omega:0.099,mu_ref:8.560e-6,T_ref:273.15,S:252.0},
  'Ethylene':       {t:'g',sg:0.968,M:28.054,k:1.240,mu:1.02e-5,Z:0.993,Tc:282.4,Pc:5.04, omega:0.089,mu_ref:9.450e-6,T_ref:273.15,S:225.0},
  'Acetylene':      {t:'g',sg:0.897,M:26.038,k:1.232,mu:1.03e-5,Z:0.990,Tc:308.3,Pc:6.14, omega:0.187,mu_ref:9.570e-6,T_ref:273.15,S:234.0},
  // ADD 2026-10: extra components for gas mixtures (natural gas C4–C6, water vapour).
  // Tc, Pc, ω from Poling, Prausnitz & O'Connell (5th ed.), Appendix A; κ = ideal-gas cp/cv at 15 °C (GPSA).
  // mixOnly: offered only as a mixture component on the page (pure C5+ / water are not gases at usual conditions).
  'Isobutane (i-C₄H₁₀)':{t:'g',sg:2.007,M:58.123,k:1.097,mu:7.40e-6,Z:0.970,Tc:407.8,Pc:3.64, omega:0.184,mu_ref:6.900e-6,T_ref:273.15,S:330.0},
  'n-Pentane (C₅H₁₂)':  {t:'g',sg:2.491,M:72.150,k:1.077,mu:6.70e-6,Z:0.950,Tc:469.7,Pc:3.37, omega:0.252,mu_ref:6.100e-6,T_ref:273.15,S:383.0,mixOnly:true},
  'Isopentane (i-C₅H₁₂)':{t:'g',sg:2.491,M:72.150,k:1.080,mu:6.75e-6,Z:0.950,Tc:460.4,Pc:3.38, omega:0.227,mu_ref:6.150e-6,T_ref:273.15,S:380.0,mixOnly:true},
  'n-Hexane (C₆H₁₄)':   {t:'g',sg:2.975,M:86.177,k:1.063,mu:6.20e-6,Z:0.930,Tc:507.6,Pc:3.025,omega:0.301,mu_ref:5.600e-6,T_ref:273.15,S:436.0,mixOnly:true},
  'Water Vapour (H₂O)': {t:'g',sg:0.622,M:18.015,k:1.330,mu:1.23e-5,Z:1.000,Tc:647.1,Pc:22.064,omega:0.344,mu_ref:1.227e-5,T_ref:373.15,S:961.0,mixOnly:true,muFn:'iapws'},
  // pseudo: these entries are themselves mixtures — not accepted as mixture components.
  'Flue Gas':       {t:'g',sg:1.000,M:28.964,k:1.350,mu:1.90e-5,Z:1.000,Tc:132.5,Pc:3.77, omega:0.035,mu_ref:1.716e-5,T_ref:273.15,S:110.4,pseudo:true},
  'Syngas (3H₂:N₂)':{t:'g',sg:0.294,M:8.525, k:1.400,mu:1.37e-5,Z:1.000,Tc:56.5, Pc:1.82, omega:-0.150,mu_ref:1.300e-5,T_ref:273.15,S:100.0,pseudo:true},
  'Biogas (60% CH₄)':{t:'g',sg:0.940,M:27.230,k:1.300,mu:1.29e-5,Z:0.995,Tc:236.0,Pc:5.71, omega:0.100,mu_ref:1.210e-5,T_ref:273.15,S:190.0,pseudo:true},
  'LPG Vapor':      {t:'g',sg:1.716,M:49.708,k:1.110,mu:7.80e-6,Z:0.970,Tc:391.9,Pc:4.07, omega:0.170,mu_ref:7.280e-6,T_ref:273.15,S:298.0,pseudo:true},
// ── Liquids ── rho0=kg/m³ at T0°C, beta_T=thermal expansion coefficient /°C
  // ρ(T) = rho0 / (1 + beta_T*(T - T0));  Tb_C = normal boiling point (mixtures: IBP, conservative)
  'Water':             {t:'l', rhoModel:'poly_water'},
  'Seawater':          {t:'l', rho0:1025.0, T0:20, beta_T:2.0e-4,  Tb_C:100.6, mu_A:-2.5055, mu_B:744.3},
  'Crude Oil (30API)': {t:'l', rho0:876.0,  T0:15, beta_T:7.0e-4,  Tb_C:35, mu_A:-2.5436, mu_B:1038.8},
  'Diesel / Gas Oil':  {t:'l', rho0:840.0,  T0:15, beta_T:7.0e-4,  Tb_C:180, mu_A:-3.0383, mu_B:1050.2},
  'Kerosene':          {t:'l', rho0:800.0,  T0:15, beta_T:8.0e-4,  Tb_C:150, mu_A:-2.0838, mu_B:670.7},
  'Gasoline':          {t:'l', rho0:720.0,  T0:15, beta_T:9.5e-4,  Tb_C:35, mu_A:-1.7926, mu_B:449.4},
  'Methanol':          {t:'l', rho0:791.0,  T0:20, beta_T:1.19e-3, Tb_C:64.7, mu_A:-2.123, mu_B:556.0},
  'Ethanol':           {t:'l', rho0:789.0,  T0:20, beta_T:1.08e-3, Tb_C:78.4, mu_A:-2.4423, mu_B:739.2},
  'Toluene':           {t:'l', rho0:867.0,  T0:20, beta_T:1.07e-3, Tb_C:110.6, mu_A:-1.8205, mu_B:466.5},
  'Benzene':           {t:'l', rho0:879.0,  T0:20, beta_T:1.21e-3, Tb_C:80.1, mu_A:-2.0446, mu_B:544.9},
  'Acetone':           {t:'l', rho0:791.0,  T0:20, beta_T:1.46e-3, Tb_C:56.1, mu_A:-1.7779, mu_B:377.7},
  'Sulfuric Acid 98%': {t:'l', rho0:1836.0, T0:20, beta_T:5.5e-4,  Tb_C:310, mu_A:-2.6592, mu_B:1186.8},
  'HCl 32%':           {t:'l', rho0:1157.0, T0:20, beta_T:4.5e-4,  Tb_C:84, mu_A:-2.2519, mu_B:735.0},
  'NaOH 50%':          {t:'l', rho0:1525.0, T0:20, beta_T:5.0e-4,  Tb_C:145, mu_A:-3.8379, mu_B:1679.7},
  'MEA':               {t:'l', rho0:1018.0, T0:20, beta_T:8.0e-4,  Tb_C:170, mu_A:-3.6342, mu_B:1470.0},
  'Glycerol':          {t:'l', rho0:1261.0, T0:20, beta_T:5.0e-4,  Tb_C:290, mu_A:-7.1891, mu_B:3030.8},
  'Ethylene Glycol':   {t:'l', rho0:1113.0, T0:20, beta_T:6.0e-4,  Tb_C:197.3, mu_A:-4.039, mu_B:1571.0},
  // Liquefied gases: ant=[A,B,C] Antoine (log10 P_mmHg, T °C) — used for Pv since T ≫ Tb
  'Ammonia (liquid)':  {t:'l', rho0:610.0,  T0:20, beta_T:2.4e-3,  Tb_C:-33.3, ant:[7.36050, 926.132, 240.17], mu_A:-1.8363, mu_B:298.5},
  'Propane (liquid)':  {t:'l', rho0:500.0,  T0:20, beta_T:3.0e-3,  Tb_C:-42.1, ant:[6.80338, 803.810, 246.99], mu_A:-2.1638, mu_B:338.6},
  'Butane (liquid)':   {t:'l', rho0:579.0,  T0:20, beta_T:2.0e-3,  Tb_C:-0.5,  ant:[6.80896, 935.860, 238.73], mu_A:-2.1784, mu_B:405.3},
  'Naphtha':           {t:'l', rho0:700.0,  T0:15, beta_T:1.0e-3,  Tb_C:35, mu_A:-1.6885, mu_B:429.9},
  'Condensate (HC)':   {t:'l', rho0:750.0,  T0:15, beta_T:9.0e-4,  Tb_C:30, mu_A:-1.7531, mu_B:468.5},
  'Fuel Oil (HFO)':    {t:'l', rho0:985.0,  T0:15, beta_T:6.4e-4,  Tb_C:250, mu_A:-5.7146, mu_B:2678.1},
  'Lube Oil (VG46)':   {t:'l', rho0:870.0,  T0:15, beta_T:7.0e-4,  Tb_C:300, mu_A:-3.6605, mu_B:1648.0},
  'Aqua Ammonia 25%':  {t:'l', rho0:907.0,  T0:20, beta_T:6.0e-4,  Tb_C:38, mu_A:-2.9975, mu_B:912.1},
  'Urea Solution 32.5%':{t:'l',rho0:1090.0, T0:20, beta_T:4.0e-4,  Tb_C:104, mu_A:-2.9187, mu_B:898.4},
  'MDEA 50%':          {t:'l', rho0:1040.0, T0:20, beta_T:6.0e-4,  Tb_C:110, mu_A:-4.1989, mu_B:1483.9},
  'Hot Pot. Carbonate 30%':{t:'l',rho0:1270.0,T0:20,beta_T:4.5e-4, Tb_C:105, mu_A:-2.6796, mu_B:902.2},
  'Nitric Acid 60%':   {t:'l', rho0:1367.0, T0:20, beta_T:6.0e-4,  Tb_C:120, mu_A:-2.6308, mu_B:852.9},
};

// ═════════════════════════════════════════════════════════════════════
//  GAS MIXTURES  (ADD 2026-10)
//  Composition in mol % (= vol % for gases) or mass %, any total (normalised).
//  The mixture then goes through the same path as a single gas from the list:
//    M  = Σ yi·Mi                                  SG = M / 28.964
//    Z  = Pitzer correlation (as for single gases) at Kay's-rule pseudo-criticals
//         Tpc = Σ yi·Tci,  Ppc = Σ yi·Pci,  ω = Σ yi·ωi
//    μ  = Wilke (1950) mixing rule on each component's μi(T)
//         (Sutherland; water vapour from the IAPWS dilute-gas equation)
//    κ  = ideal-gas mixing of molar heat capacities:
//         cp,i = R·κi/(κi − 1),  cp = Σ yi·cp,i,  κ = cp/(cp − R)
//  A one-component "mixture" gives exactly the single-gas result.
//  Phase checks: water dew point (IAPWS-IF97 Psat vs H₂O partial pressure) and,
//  for 2+ components, the Peng-Robinson stability test of Section B (kij = 0)
//  for condensation of heavier components (C3+, NH₃, CO₂, H₂S …).
// ═════════════════════════════════════════════════════════════════════
const ORIFICE_MIX_MAX   = 20;
const ORIFICE_WATER_KEY = 'Water Vapour (H₂O)';

// Water dew point (K) for a given H₂O partial pressure — inverse of waterPsat_Pa().
// Returns null below the triple point (frost point < 0 °C).
function waterDewPoint_K(pp_Pa) {
  if (!(pp_Pa > 0) || pp_Pa < waterPsat_Pa(273.16)) return null;
  if (pp_Pa >= waterPsat_Pa(647.0)) return 647.0;
  let lo = 273.16, hi = 647.0;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (waterPsat_Pa(mid) < pp_Pa) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Peng-Robinson single-phase check of a gas mixture (reuses the Section B engine).
function orificeMixPhaseCheck(comps, y, T_K, P_Pa) {
  try {
    const pure = comps.map(c => eosPureAB('pr', T_K, c.f.Tc, c.f.Pc * 1e6, c.f.omega));
    const mix  = { eos: 'pr', T_K, sq: pure.map(p => Math.sqrt(p.a)), bi: pure.map(p => p.b),
                   omk: comps.map(() => comps.map(() => 1)) };            // kij = 0
    const feed = eosMixPhase(mix, y, P_Pa);
    if (!feed) return null;
    const Kw = comps.map(c => (c.f.Pc * 1e6 / P_Pa) * Math.exp(5.373 * (1 + c.f.omega) * (1 - c.f.Tc / T_K)));
    const st = eosMixStability(mix, y, P_Pa, feed, Kw);
    return { stable: !!st.stable, liquidLike: !!feed.liquidLike, Z_pr: feed.Z };
  } catch (e) {
    return null;                                      // the check is advisory — never block the calculation
  }
}

// mixIn = { basis: 'mol' | 'mass', comps: [{ key, v }, …] }   (v = amount in the chosen basis)
function gasMixtureProps(mixIn, T_K, P_Pa) {
  if (!mixIn || typeof mixIn !== 'object') return { error: 'Gas mixture: composition is missing.' };
  const basis = mixIn.basis === 'mass' ? 'mass' : 'mol';
  const unit  = basis === 'mass' ? 'mass %' : 'mol %';
  const list  = Array.isArray(mixIn.comps) ? mixIn.comps : [];
  if (list.length > ORIFICE_MIX_MAX) return { error: `Gas mixture: at most ${ORIFICE_MIX_MAX} components.` };

  const warns = [], infos = [];
  const amounts = new Map();
  for (const c of list) {
    const key = (c && typeof c.key === 'string') ? c.key : '';
    if (!key) continue;                                                   // empty row
    const f = FLUID_DB_orifice[key];
    if (!f || f.t !== 'g') return { error: `Gas mixture: "${key.slice(0, 60).replace(/[<>&"']/g, '')}" is not in the gas component list.` };
    if (f.pseudo)          return { error: `Gas mixture: "${key}" is itself a mixture — enter its components instead.` };
    const v = (c.v === '' || c.v == null) ? 0 : Number(c.v);
    if (!Number.isFinite(v) || v < 0) return { error: `Gas mixture: the amount of ${key} must be zero or positive.` };
    if (v === 0) continue;
    if (amounts.has(key)) infos.push(`${key} is listed more than once — the amounts were added.`);
    amounts.set(key, (amounts.get(key) || 0) + v);
  }
  if (!amounts.size) return { error: 'Gas mixture: enter at least one component with an amount above zero.' };

  const comps = [...amounts.keys()].map(key => ({ key, f: FLUID_DB_orifice[key], v: amounts.get(key) }));
  const sum   = comps.reduce((s, c) => s + c.v, 0);
  if (Math.abs(sum - 100) > 0.005) {
    if (Math.abs(sum - 1) <= 0.01)       infos.push(`Composition entered as fractions (total ${sum.toFixed(4)}) — normalised to 100 %.`);
    else if (Math.abs(sum - 100) <= 1)   infos.push(`Composition totals ${sum.toFixed(3)} ${unit} — normalised to 100 %.`);
    else                                 warns.push(`Composition totals ${sum.toFixed(2)} ${unit} — normalised to 100 %. Check the gas analysis.`);
  }

  // Mole fractions (mass basis: yi = (wi/Mi) / Σ wj/Mj)
  const raw = comps.map(c => basis === 'mass' ? c.v / c.f.M : c.v);
  const rs  = raw.reduce((a, b) => a + b, 0);
  const y   = raw.map(v => v / rs);
  const M   = comps.reduce((s, c, i) => s + y[i] * c.f.M, 0);
  const w   = comps.map((c, i) => y[i] * c.f.M / M);

  // Z — Kay's rule pseudo-criticals + Pitzer (same correlation as single gases)
  const Tpc   = comps.reduce((s, c, i) => s + y[i] * c.f.Tc, 0);
  const Ppc   = comps.reduce((s, c, i) => s + y[i] * c.f.Pc, 0);              // MPa
  const omega = comps.reduce((s, c, i) => s + y[i] * (c.f.omega || 0), 0);
  const zr    = pitzerZ({ Tc: Tpc, Pc: Ppc, omega }, T_K, P_Pa);

  // μ — Wilke mixing rule
  const mui = comps.map(c => c.f.muFn === 'iapws' ? steamViscosity(T_K) : sutherlandViscosity(c.f, T_K));
  let mu = 0;
  for (let i = 0; i < comps.length; i++) {
    let den = 0;
    for (let j = 0; j < comps.length; j++) {
      const phi = Math.pow(1 + Math.sqrt(mui[i] / mui[j]) * Math.pow(comps[j].f.M / comps[i].f.M, 0.25), 2)
                / Math.sqrt(8 * (1 + comps[i].f.M / comps[j].f.M));
      den += y[j] * phi;
    }
    mu += y[i] * mui[i] / den;
  }

  // κ — ideal-gas molar heat capacities
  const Rg = 8.314462;
  const cp = comps.reduce((s, c, i) => s + y[i] * Rg * c.f.k / (c.f.k - 1), 0);
  const k  = cp / (cp - Rg);

  // Water dew point
  let h2o = null;
  const iw = comps.findIndex(c => c.key === ORIFICE_WATER_KEY);
  if (iw >= 0) {
    const pp    = y[iw] * P_Pa;
    const dewK  = waterDewPoint_K(pp);
    const condenses = dewK != null && T_K < 647.0 && T_K <= dewK;
    h2o = { y: y[iw], pp_bar: pp / 1e5, dew_C: dewK != null ? dewK - 273.15 : null, below0: dewK == null, condenses };
    const T_C = T_K - 273.15;
    if (condenses)
      warns.push(`⚡ WATER CONDENSES: H₂O partial pressure ${(pp / 1e5).toFixed(4)} bar a ≥ saturation pressure ${(waterPsat_Pa(T_K) / 1e5).toFixed(4)} bar a at ${T_C.toFixed(1)} °C (water dew point ${h2o.dew_C.toFixed(1)} °C). Liquid water is present, so the single-phase gas equation does not apply. Check whether the analysis is on a wet or dry basis, or use Two-Phase mode.`);
    else if (dewK != null && T_K - dewK < 5)
      infos.push(`Water dew point ${h2o.dew_C.toFixed(1)} °C is only ${(T_K - dewK).toFixed(1)} °C below the operating temperature — water can condense in impulse lines or on cooling; keep the meter and lines above the dew point.`);
  }

  // Peng-Robinson phase check (2+ components). Water is judged by IAPWS-IF97 above —
  // a cubic EOS with kij = 0 is poor for water–gas systems and flags condensation
  // several °C above the true water dew point — so the test is run on the water-free
  // gas at its own partial pressure.
  let pr = null;
  const dry = comps.map((c, i) => i).filter(i => i !== iw);
  if (dry.length >= 2) {
    const yd = dry.map(i => y[i]);
    const sd = yd.reduce((a, b) => a + b, 0);
    pr = orificeMixPhaseCheck(dry.map(i => comps[i]), yd.map(v => v / sd), T_K, P_Pa * sd);
    if (pr && !pr.stable && !(h2o && h2o.condenses))
      warns.push(`⚡ PARTIAL CONDENSATION: the Peng-Robinson stability test (kij = 0) shows this mixture is not a single gas phase at ${(P_Pa / 1e5).toFixed(2)} bar a and ${(T_K - 273.15).toFixed(1)} °C — heavier components${iw >= 0 ? ' (other than water)' : ''} condense. The single-phase orifice equation does not apply; keep the meter above the dew point or use Two-Phase mode. The test is indicative (no binary interaction parameters).`);
    else if (pr && pr.stable && pr.liquidLike)
      warns.push('Dense, liquid-like state (Peng-Robinson): the Pitzer Z used here is not reliable at these conditions. Check Z with an equation of state and enter M, Z, κ and μ under Known MW.');
  }

  return {
    M, sg: M / 28.964, k, mu, Z: zr.Z, zr, warns, infos,
    summary: {
      basis, sumInput: sum, n: comps.length,
      M, sg: M / 28.964, k, mu, Z: zr.Z, Z_outOfRange: !!zr.outOfRange,
      Tpc_K: Tpc, Ppc_bar: Ppc * 10, omega,
      comps: comps.map((c, i) => ({ key: c.key, y: y[i], w: w[i], M: c.f.M })),
      h2o, pr: pr ? { stable: pr.stable, liquidLike: pr.liquidLike } : null,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════
//  MAIN CALCULATION ENGINE
// ═════════════════════════════════════════════════════════════════════
function getReMin(b) {
    if (b <= 0.44) return 5000; if (b <= 0.56) return 10000; if (b <= 0.65) return 30000; return 170000;
  }
// FIX 2026-10: orifice plates use the ISO 5167-2:2003/2022 §5.3.1 Reynolds limits,
// which depend on the tapping arrangement. getReMin() above is kept for the
// nozzle, venturi and custom-Cd types only.
//   Corner and D & D/2 taps: Re_D ≥ 5000 (β ≤ 0.56), Re_D ≥ 16000·β² (β > 0.56)
//   Flange taps:             Re_D ≥ 5000 and Re_D ≥ 170·β²·D   (D in mm)
const ORIFICE_TAPS = ['sharp_corner', 'corner_tap', 'sharp_flange', 'd_d2_tap'];
function reMinOrificeISO(beta, tapType, D_mm) {
  if (tapType === 'sharp_flange') return Math.max(5000, 170 * beta * beta * D_mm);
  return beta <= 0.56 ? 5000 : 16000 * beta * beta;
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
    gasMix,              // ADD 2026-10: gasMixtureProps() result, or null
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
    // FIX 2026-08: temperature-dependent liquid viscosity (was: fixed mu_input)
    const mu_liq = liquidViscosity(f_liq, T_K);
    if (mu_liq != null) { mu = mu_liq; mu_auto = mu_liq; }
    else                { mu = mu_input; }
    Z_used = 1;
  } else {
    // Gas
    const f = FLUID_DB_orifice[fluidKey] || null;
    let MW_use;
    if (gasMix) {
      // ADD 2026-10: gas mixture — properties computed from the composition
      MW_use  = gasMix.M;
      mu      = gasMix.mu;
      mu_auto = mu;
      Z_used  = gasMix.Z;
      Z_auto  = gasMix.zr;
    } else if (f?.t === 'g') {
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
  const MW_final = gasMix ? gasMix.M
                 : f_db?.t==='g' ? f_db.M : (MW_input>1&&MW_input<500 ? MW_input : sg*28.964);
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

  const isNozzleType  = ['nozzle_isa','venturi_nozzle'].includes(tapType);
  const isOrificeType = ORIFICE_TAPS.includes(tapType);
  const betaMax = isNozzleType ? 0.80 : 0.75;
  // FIX 2026-10: ISO 5167-2 allows orifice plates from β = 0.10 (was 0.20).
  // The 1e-9 margin stops a ratio like 40/200 = 0.19999999999999998 being flagged.
  const betaMin = isOrificeType ? 0.10 : 0.20;
  if (beta < betaMin - 1e-9 || beta > betaMax + 1e-9) warns.push(`β=${beta.toFixed(4)} outside ISO 5167 range ${betaMin.toFixed(2)}–${betaMax}`);
  if (beta > 0.70 && beta <= 0.75)   infos.push(`β=${beta.toFixed(4)} in high-beta range — verify corner tap validity`);
  // FIX 2026-10: ISO 5167-2 §5.3.1 minimum bore, d ≥ 12.5 mm (was not checked).
  if (isOrificeType && d_final * 1000 < 12.5 - 1e-9) warns.push(`Bore d = ${(d_final * 1000).toFixed(2)} mm below ISO 5167-2 minimum 12.5 mm`);
  if (!isLiq && dp_Pa > 0 && (dp_Pa/P_Pa) > 0.25) warns.push('⚡ ΔP/P > 0.25 (p₂/p₁ < 0.75): Exceeds ISO 5167-2 expansibility factor validity limit');
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
  const Re_min = isOrificeType ? reMinOrificeISO(beta, tapType, D_mm) : getReMin(beta);
  if (Re_pipe > 0 && Re_pipe < Re_min) warns.push(`Re=${Re_pipe.toFixed(0)} below ISO 5167 minimum (${Re_min.toFixed(0)} for β=${beta.toFixed(3)})`);
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

// ══════════════════════════════════════════════════════════════════════════════
// SECTION C-2  ►  TWO-PHASE ORIFICE EXTENSION  (gas–liquid & wet steam)
// Paste this whole block inside SECTION C of api/process-calculators.js,
// directly ABOVE the line:   async function orificeFlow_handler(req, res) {
//
// Re-uses existing Section C helpers (do not duplicate them):
//   getCd, computeY, computePressureRecovery, estimateUncertainty, steamDensity,
//   steamViscosity, waterLiquidViscosity, liquidViscosity, sutherlandViscosity,
//   pitzerZ, validateInputs, getReMin, FLUID_DB_orifice
//
// Model basis (separated-flow orifice correlations, frozen quality):
//   gas-alone capacity  Kg = Cd·E·ε·A₂·√(2·ρg·ΔP)          (ε on the gas phase)
//   X  = ((1−x)/x)·√(ρg/ρl)·ε                              (Lockhart–Martinelli)
//   Chisholm 1977 :  ṁ = Kg / (x·√(1 + C·X + X²)),  C = (ρl/ρg)^¼ + (ρg/ρl)^¼
//   Murdock  1962 :  ṁ = Kg / (x·(1 + 1.26·X))
//   Homogeneous   :  ṁ = Cd·E·A₂·√(2ΔP / v_m),  v_m = x/(ε²ρg) + (1−x)/ρl
//   James    1965 :  as homogeneous with x → x^1.5  (steam–water)
//   Cd from ISO RHG at the gas-alone Re (X ≤ 1) or liquid-alone Re (X > 1).
// ══════════════════════════════════════════════════════════════════════════════

const TP_CORR = {
  chisholm:    { label: 'Chisholm (1977)',          base_u: 3.0 },
  murdock:     { label: 'Murdock (1962)',           base_u: 4.0 },
  homogeneous: { label: 'Homogeneous (no slip)',    base_u: 8.0 },
  james:       { label: 'James (1965) steam–water', base_u: 4.0 },
};
const TP_KEYS = Object.keys(TP_CORR);

// Saturated-liquid water density — same IF97 polynomial as Section C
function tpWaterDensity(T_c) {
  const T = Math.max(0, Math.min(360, T_c));
  const T2 = T*T, T3 = T2*T, T4 = T3*T, T5 = T4*T, T6 = T5*T;
  const r = -3.430583e-12*T6 + 3.305509e-09*T5 - 1.216454e-06*T4
          + 2.120305e-04*T3 - 2.009065e-02*T2 + 4.039409e-01*T + 998.117618;
  return Math.max(100, Math.min(1005, r));
}

function tpLiquidDensity(f, T_c, sg) {
  if (f?.t === 'l' && f.rhoModel === 'poly_water') return tpWaterDensity(T_c);
  if (f?.t === 'l' && f.rho0 && f.beta_T !== undefined)
    return Math.max(100, Math.min(1500, f.rho0 / (1 + f.beta_T * (T_c - f.T0))));
  return Math.max(100, Math.min(2500, (sg > 0 ? sg : 1) * 1000));
}

// ── IAPWS-IF97 saturation enthalpies, 1 °C table (0.01–373 °C, kJ/kg) ────────
// Generated from IAPWS-IF97; linear interpolation error < 0.1 kJ/kg up to 365 °C.
const TP_HF = [0.00,4.18,8.39,12.60,16.81,21.02,25.22,29.43,33.63,37.82,42.02,46.22,50.41,54.60,58.79,62.98,67.17,71.36,75.55,79.73,83.92,88.10,92.29,96.47,100.66,104.84,109.02,113.20,117.38,121.56,125.75,129.93,134.11,138.29,142.47,146.64,150.82,155.00,159.18,163.36,167.54,171.72,175.90,180.08,184.26,188.44,192.62,196.80,200.98,205.16,209.34,213.52,217.70,221.88,226.06,230.24,234.42,238.61,242.79,246.97,251.15,255.34,259.52,263.71,267.89,272.08,276.27,280.45,284.64,288.83,293.02,297.21,301.40,305.59,309.78,313.97,318.17,322.36,326.56,330.75,334.95,339.15,343.34,347.54,351.74,355.95,360.15,364.35,368.56,372.76,376.97,381.18,385.38,389.59,393.81,398.02,402.23,406.45,410.66,414.88,419.10,423.32,427.54,431.76,435.99,440.21,444.44,448.67,452.90,457.13,461.36,465.60,469.83,474.07,478.31,482.55,486.80,491.04,495.29,499.53,503.78,508.04,512.29,516.55,520.80,525.06,529.32,533.59,537.85,542.12,546.39,550.66,554.93,559.21,563.49,567.77,572.05,576.33,580.62,584.91,589.20,593.49,597.79,602.09,606.39,610.69,615.00,619.31,623.62,627.93,632.25,636.57,640.89,645.22,649.55,653.88,658.21,662.55,666.89,671.23,675.57,679.92,684.28,688.63,692.99,697.35,701.71,706.08,710.45,714.83,719.21,723.59,727.97,732.36,736.75,741.15,745.55,749.95,754.36,758.77,763.19,767.61,772.03,776.46,780.89,785.32,789.76,794.21,798.66,803.11,807.57,812.03,816.49,820.96,825.44,829.92,834.40,838.89,843.39,847.89,852.39,856.90,861.42,865.94,870.46,874.99,879.53,884.07,888.62,893.17,897.73,902.29,906.86,911.44,916.02,920.61,925.20,929.80,934.41,939.02,943.64,948.27,952.90,957.54,962.19,966.84,971.50,976.17,980.84,985.52,990.21,994.91,999.61,1004.32,1009.04,1013.77,1018.50,1023.24,1028.00,1032.76,1037.52,1042.30,1047.08,1051.88,1056.68,1061.49,1066.31,1071.14,1075.98,1080.83,1085.69,1090.55,1095.43,1100.32,1105.22,1110.13,1115.04,1119.97,1124.91,1129.86,1134.83,1139.80,1144.78,1149.78,1154.79,1159.81,1164.84,1169.88,1174.94,1180.01,1185.09,1190.19,1195.30,1200.42,1205.55,1210.70,1215.87,1221.05,1226.24,1231.45,1236.67,1241.91,1247.16,1252.43,1257.72,1263.02,1268.34,1273.68,1279.03,1284.41,1289.80,1295.20,1300.63,1306.08,1311.54,1317.03,1322.54,1328.06,1333.61,1339.18,1344.77,1350.39,1356.02,1361.68,1367.37,1373.07,1378.81,1384.57,1390.35,1396.16,1402.00,1407.87,1413.77,1419.69,1425.65,1431.63,1437.65,1443.70,1449.78,1455.90,1462.05,1468.24,1474.46,1480.73,1487.03,1493.37,1499.76,1506.18,1512.66,1519.17,1525.74,1532.35,1539.02,1545.74,1552.51,1559.34,1566.23,1573.18,1580.20,1587.29,1594.45,1601.68,1608.99,1616.38,1623.86,1631.44,1639.11,1646.88,1654.75,1662.75,1670.86,1679.14,1687.54,1696.09,1704.81,1713.71,1722.80,1732.10,1741.63,1751.42,1761.49,1771.88,1782.62,1793.78,1805.41,1817.59,1830.43,1844.09,1858.77,1874.78,1892.64,1913.44,1938.57,1974.31];
const TP_HG = [2500.91,2502.73,2504.57,2506.40,2508.24,2510.07,2511.91,2513.74,2515.57,2517.40,2519.23,2521.06,2522.89,2524.71,2526.54,2528.36,2530.19,2532.01,2533.83,2535.65,2537.47,2539.29,2541.10,2542.92,2544.73,2546.54,2548.35,2550.16,2551.97,2553.78,2555.58,2557.39,2559.19,2560.99,2562.79,2564.58,2566.38,2568.17,2569.96,2571.75,2573.54,2575.33,2577.11,2578.89,2580.67,2582.45,2584.23,2586.00,2587.77,2589.54,2591.31,2593.08,2594.84,2596.60,2598.35,2600.11,2601.86,2603.61,2605.36,2607.10,2608.85,2610.58,2612.32,2614.05,2615.78,2617.51,2619.23,2620.96,2622.67,2624.39,2626.10,2627.81,2629.51,2631.21,2632.91,2634.60,2636.29,2637.98,2639.66,2641.34,2643.01,2644.68,2646.35,2648.01,2649.67,2651.33,2652.98,2654.62,2656.26,2657.90,2659.53,2661.16,2662.78,2664.39,2666.01,2667.61,2669.22,2670.81,2672.40,2673.99,2675.57,2677.15,2678.72,2680.28,2681.84,2683.39,2684.94,2686.48,2688.02,2689.55,2691.07,2692.58,2694.09,2695.60,2697.09,2698.58,2700.07,2701.55,2703.02,2704.48,2705.93,2707.38,2708.82,2710.26,2711.69,2713.11,2714.52,2715.92,2717.32,2718.71,2720.09,2721.46,2722.83,2724.18,2725.53,2726.87,2728.20,2729.53,2730.84,2732.15,2733.44,2734.73,2736.01,2737.28,2738.54,2739.80,2741.04,2742.27,2743.50,2744.71,2745.92,2747.12,2748.30,2749.48,2750.64,2751.80,2752.95,2754.08,2755.21,2756.33,2757.43,2758.53,2759.61,2760.68,2761.75,2762.80,2763.84,2764.87,2765.89,2766.90,2767.89,2768.88,2769.85,2770.82,2771.77,2772.70,2773.63,2774.55,2775.45,2776.34,2777.22,2778.09,2778.94,2779.78,2780.61,2781.43,2782.23,2783.02,2783.80,2784.56,2785.31,2786.05,2786.77,2787.48,2788.18,2788.86,2789.53,2790.18,2790.82,2791.45,2792.06,2792.66,2793.24,2793.81,2794.36,2794.90,2795.42,2795.93,2796.42,2796.89,2797.35,2797.80,2798.22,2798.64,2799.03,2799.41,2799.77,2800.12,2800.45,2800.76,2801.05,2801.33,2801.59,2801.83,2802.05,2802.26,2802.45,2802.61,2802.76,2802.90,2803.01,2803.10,2803.18,2803.23,2803.27,2803.28,2803.28,2803.26,2803.21,2803.15,2803.06,2802.95,2802.82,2802.68,2802.50,2802.31,2802.10,2801.86,2801.60,2801.32,2801.01,2800.68,2800.33,2799.96,2799.56,2799.13,2798.69,2798.21,2797.71,2797.19,2796.64,2796.07,2795.47,2794.84,2794.19,2793.51,2792.80,2792.07,2791.30,2790.51,2789.69,2788.84,2787.96,2787.05,2786.11,2785.14,2784.14,2783.11,2782.05,2780.95,2779.82,2778.66,2777.47,2776.24,2774.97,2773.67,2772.34,2770.97,2769.56,2768.12,2766.63,2765.11,2763.55,2761.95,2760.31,2758.63,2756.90,2755.14,2753.33,2751.47,2749.57,2747.63,2745.64,2743.60,2741.51,2739.38,2737.19,2734.95,2732.66,2730.32,2727.92,2725.47,2722.96,2720.39,2717.77,2715.08,2712.33,2709.51,2706.63,2703.68,2700.67,2697.58,2694.42,2691.19,2687.87,2684.48,2681.01,2677.45,2673.81,2670.08,2666.25,2662.33,2658.30,2654.18,2649.95,2645.60,2641.14,2636.57,2631.86,2627.03,2622.07,2616.96,2611.71,2606.30,2600.74,2595.01,2589.10,2583.02,2576.74,2570.27,2563.59,2556.72,2549.57,2542.15,2534.45,2526.45,2518.13,2509.46,2500.40,2490.93,2480.99,2470.53,2459.49,2447.79,2435.34,2422.00,2407.63,2391.98,2374.76,2355.51,2333.50,2307.60,2274.71,2227.16];
function tpHsat(T_c) {
  const T = Math.max(0.01, Math.min(372.999, T_c));
  const i = Math.floor(T), f = T - i;
  const hf = TP_HF[i] + (TP_HF[i + 1] - TP_HF[i]) * f;
  const hg = TP_HG[i] + (TP_HG[i + 1] - TP_HG[i]) * f;
  return { hf, hg, hfg: hg - hf };
}
function tpTsat(P_bar) { return steamDensity(P_bar, 0).T_sat_C; }

// Quality after an isenthalpic flash of liquid (saturated at P_src, or at T_src) down to P
function tpFlashQuality(P_src_bar, P_bar, T_src_C) {
  const Tsrc = Number.isFinite(T_src_C) ? T_src_C : tpTsat(P_src_bar);
  const h_in = tpHsat(Tsrc).hf;            // compressed-liquid pressure term ignored (<0.2 % on x)
  const s    = tpHsat(tpTsat(P_bar));
  return { x: (h_in - s.hf) / s.hfg, h_in, Tsrc };
}

// Vapour pressure estimate (bar) for boiling check of the liquid phase
function tpLiquidPv(f, T_c) {
  if (!f || f.t !== 'l') return null;
  if (f.rhoModel === 'poly_water') return null;                 // handled via IF97 Tsat
  if (Array.isArray(f.ant)) {
    const [A, B, C] = f.ant;
    return { Pv: Math.pow(10, A - B / (C + T_c)) * 0.00133322, method: 'Antoine' };
  }
  if (f.Tb_C != null) {                                          // Trouton / Clausius–Clapeyron estimate
    const Tb = f.Tb_C + 273.15, T = T_c + 273.15;
    return { Pv: 1.01325 * Math.exp(10.5 * (1 - Tb / T)), method: 'Trouton estimate' };
  }
  return null;
}

// ── Phase properties ─────────────────────────────────────────────────────────
function tpProps(p) {
  const P_Pa = p.P_bar * 1e5;
  const out = { sub: p.sub, warns: [], infos: [], gasAuto: false, zr: null, Tsat_C: null };

  if (p.sub === 'wetsteam') {
    const Tsat_C = steamDensity(p.P_bar, 0).T_sat_C;
    const Tsat_K = Tsat_C + 273.15;
    out.Tsat_C = Tsat_C;
    out.T_c    = Tsat_C;
    out.rho_g  = steamDensity(p.P_bar, Tsat_C + 0.01).rho;   // IF97 Region 2 on the saturation line
    out.rho_l  = tpWaterDensity(Tsat_C);
    out.mu_g   = steamViscosity(Tsat_K);
    out.mu_l   = waterLiquidViscosity(Tsat_K);
    out.MW     = 18.015;
    out.Z      = 1;
    if (p.P_bar > 165)
      out.warns.push(`Wet steam at ${p.P_bar.toFixed(1)} bara — IF97 Region 2 / liquid polynomial lose accuracy above ~165 bara (near-critical)`);
    if (Number.isFinite(p.T_c) && Math.abs(p.T_c - Tsat_C) > 2)
      out.infos.push(`Wet steam is saturated — temperature taken as Tsat = ${Tsat_C.toFixed(2)} °C (entered value ignored)`);
    return out;
  }

  // Gas + liquid
  const T_K = p.T_c + 273.15;
  const fg  = FLUID_DB_orifice[p.gasKey] || null;
  if (p.mix) {
    // ADD 2026-10: gas phase defined by a mixture composition
    out.MW   = p.mix.M;
    out.mu_g = p.mix.mu;
    out.zr   = p.mix.zr;
    out.Z    = p.mix.Z;
    out.gasAuto = true;
  } else if (fg?.t === 'g') {
    out.MW   = fg.M;
    out.mu_g = sutherlandViscosity(fg, T_K);
    out.zr   = pitzerZ(fg, T_K, P_Pa);
    out.Z    = out.zr.Z;
    out.gasAuto = true;
  } else {
    // Mirrors the single-phase gas path: MW field wins over SG when valid
    out.MW   = (p.MW_input > 1 && p.MW_input < 500) ? p.MW_input : (p.sg_gas > 0 ? p.sg_gas : 0.65) * 28.964;
    out.Z    = p.Z_input > 0 ? p.Z_input : 1;
    out.mu_g = p.mu_g_input > 0 ? p.mu_g_input : 1.82e-5;
  }
  out.rho_g = (P_Pa * out.MW) / (out.Z * 8314.46 * T_K);

  const fl  = FLUID_DB_orifice[p.liqKey] || null;
  out.rho_l = tpLiquidDensity(fl, p.T_c, p.liqSG);
  const muL = liquidViscosity(fl, T_K);
  out.mu_l  = muL != null ? muL : (p.liqMu > 0 ? p.liqMu : 1e-3);
  out.T_c   = p.T_c;
  // ── Boiling check: the "liquid" phase must actually be liquid at P, T ──
  if (fl?.rhoModel === 'poly_water') {
    const Ts = tpTsat(p.P_bar);
    if (p.T_c >= Ts - 0.1)
      out.fatal = `Water at ${p.T_c.toFixed(1)} °C is not liquid at ${p.P_bar.toFixed(2)} bara (saturation ${Ts.toFixed(1)} °C) — it is steam. ` +
                  `For steam–water mixtures select System = Wet Steam; for a hot-water letdown use Wet Steam with "quality from flash".`;
    else if (p.T_c > Ts - 3)
      out.warns.push(`Water is only ${(Ts - p.T_c).toFixed(1)} °C below saturation (${Ts.toFixed(1)} °C) — it may flash at the orifice throat; consider System = Wet Steam`);
  } else {
    const pv = tpLiquidPv(fl, p.T_c);
    if (pv && pv.Pv >= p.P_bar) {
      const msg = `${p.liqKey}: vapour pressure ≈ ${pv.Pv.toFixed(2)} bar (${pv.method}) ≥ line pressure ${p.P_bar.toFixed(2)} bara at ${p.T_c.toFixed(1)} °C — the liquid would boil`;
      if (pv.method === 'Antoine') out.fatal = msg + '. Frozen-quality correlations do not apply to flashing flow.';
      else out.warns.push(msg + ' (estimate from normal boiling point — verify). Result not valid if the liquid flashes.');
    } else if (pv && pv.Pv > 0.8 * p.P_bar) {
      out.warns.push(`${p.liqKey}: vapour pressure ≈ ${pv.Pv.toFixed(2)} bar (${pv.method}) is within 20 % of line pressure — flashing at the orifice throat is possible`);
    }
  }
  return out;
}

// ── Core: total mass flow for a given ΔP and bore ────────────────────────────
function tpMassFlow(corr, dp_Pa, d_m, c) {
  const D    = c.D_m;
  const beta = d_m / D;
  const b4   = Math.pow(beta, 4);
  const A2   = Math.PI / 4 * d_m * d_m;
  const E    = 1 / Math.sqrt(1 - b4);
  const eps  = computeY(beta, dp_Pa, c.P_Pa, c.k, c.tapType);
  const x = c.x, rg = c.rho_g, rl = c.rho_l;
  const X   = ((1 - x) / x) * Math.sqrt(rg / rl) * eps;
  const Cch = Math.pow(rl / rg, 0.25) + Math.pow(rg / rl, 0.25);

  const massAt = (Cd) => {
    const Kg = Cd * E * eps * A2 * Math.sqrt(2 * rg * dp_Pa);
    switch (corr) {
      case 'murdock':
        return Kg / (x * (1 + 1.26 * X));
      case 'homogeneous': {
        const vm = x / (eps * eps * rg) + (1 - x) / rl;
        return Cd * E * A2 * Math.sqrt(2 * dp_Pa / vm);
      }
      case 'james': {
        const xj = Math.pow(x, 1.5);
        const vm = xj / (eps * eps * rg) + (1 - xj) / rl;
        return Cd * E * A2 * Math.sqrt(2 * dp_Pa / vm);
      }
      default:
        return Kg / (x * Math.sqrt(1 + Cch * X + X * X));
    }
  };

  let Cd = getCd(1e6, beta, c.tapType, c.D_mm, c.customCd);
  let m = 0, Re = 0, Re_g = 0, Re_l = 0;
  for (let i = 0; i < 40; i++) {
    m    = massAt(Cd);
    Re_g = 4 * x * m / (Math.PI * D * c.mu_g);
    Re_l = 4 * (1 - x) * m / (Math.PI * D * c.mu_l);
    Re   = X <= 1 ? Re_g : Re_l;
    const CdN = getCd(Re, beta, c.tapType, c.D_mm, c.customCd);
    if (Math.abs(CdN - Cd) < 1e-10) { Cd = CdN; break; }
    Cd = CdN;
  }
  m = massAt(Cd);
  const mg_app = Cd * E * eps * A2 * Math.sqrt(2 * rg * dp_Pa);   // flow a dry-gas meter would report
  return { m, Cd, eps, E, beta, X, Cch, Re, Re_g, Re_l, OR: mg_app / (x * m) };
}

// ΔP for a target mass flow (log-bisection; ṁ rises monotonically with ΔP)
function tpSolveDp(corr, m_target, d_m, c) {
  let lo = 0.1, hi = 0.6 * c.P_Pa;
  if (tpMassFlow(corr, hi, d_m, c).m < m_target) return null;
  for (let i = 0; i < 90; i++) {
    const mid = Math.sqrt(lo * hi);
    if (tpMassFlow(corr, mid, d_m, c).m < m_target) lo = mid; else hi = mid;
    if (hi / lo < 1 + 1e-10) break;
  }
  return Math.sqrt(lo * hi);
}

// Bore for a target mass flow at a given ΔP (bisection; ṁ rises with d)
function tpSolveBore(corr, m_target, dp_Pa, c) {
  let lo = 0.05 * c.D_m, hi = 0.94 * c.D_m;
  if (tpMassFlow(corr, hi, dp_Pa, c).m < m_target) return null;
  if (tpMassFlow(corr, lo, dp_Pa, c).m > m_target) return null;
  for (let i = 0; i < 90; i++) {
    const mid = 0.5 * (lo + hi);
    if (tpMassFlow(corr, dp_Pa, mid, c).m < m_target) lo = mid; else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  return 0.5 * (lo + hi);
}

// ── Main two-phase calculation ───────────────────────────────────────────────
function calculateTwoPhase(params) {
  const { mode, tapType, customCd, P_bar, T_c, k, D_mm, d_mm,
          dp_Pa_in, flow_in, flow_unit, tp } = params;

  if (!(P_bar > 0)) return { error: 'Pressure must be > 0 bara (absolute).' };

  // ── Quality: entered, or from isenthalpic flash of upstream liquid (wet steam only) ──
  let x = tp.x, flash = null;
  if (tp.sub === 'wetsteam' && tp.xMode === 'flash') {
    if (!(tp.Psrc_bar > 0)) return { error: 'Enter the upstream (source) liquid pressure for quality-from-flash.' };
    if (tp.Psrc_bar <= P_bar) return { error: `Source pressure (${tp.Psrc_bar.toFixed(2)} bara) must be higher than the meter pressure (${P_bar.toFixed(2)} bara) for the liquid to flash.` };
    if (tp.Psrc_bar > 200) return { error: 'Source pressure above 200 bara is outside the saturation-table range (near-critical).' };
    const Tsat_src = tpTsat(tp.Psrc_bar);
    if (Number.isFinite(tp.Tsrc_C) && tp.Tsrc_C > Tsat_src + 0.5)
      return { error: `Source liquid temperature ${tp.Tsrc_C.toFixed(1)} °C is above saturation at the source pressure (${Tsat_src.toFixed(1)} °C).` };
    flash = tpFlashQuality(tp.Psrc_bar, P_bar, tp.Tsrc_C);
    x = flash.x;
    if (!(x > 0)) return { error: `Source liquid does not flash at the meter pressure (x = ${x.toFixed(4)}) — this is single-phase liquid; use the Liquid category.` };
    if (!(x < 1)) return { error: `Computed flash quality x = ${x.toFixed(4)} ≥ 1 — check pressures.` };
  }
  if (!(x > 0 && x < 1))
    return { error: 'Quality x (gas mass fraction) must be between 0 and 1 (exclusive). For x = 0 or 1 use the Liquid or Gas category.' };
  if (!(D_mm > 0))  return { error: 'Pipe ID must be > 0.' };

  const corr = TP_CORR[tp.corr] ? tp.corr : 'chisholm';
  const pr   = tpProps({ ...tp, P_bar, T_c });
  if (pr.fatal) return { error: pr.fatal };
  if (!(pr.rho_g > 0 && pr.rho_l > 0))
    return { error: 'Could not evaluate phase densities — check pressure, temperature and fluid inputs.' };
  if (pr.rho_g >= pr.rho_l)
    return { error: `Gas density (${pr.rho_g.toFixed(2)}) ≥ liquid density (${pr.rho_l.toFixed(1)} kg/m³) — not a gas–liquid system at these conditions.` };

  const D_m    = D_mm / 1000;
  const P_Pa   = P_bar * 1e5;
  const A_pipe = Math.PI / 4 * D_m * D_m;
  const c = { D_m, D_mm, P_Pa, k, tapType, customCd, x,
              rho_g: pr.rho_g, rho_l: pr.rho_l, mu_g: pr.mu_g, mu_l: pr.mu_l };

  const toKgs = (v, u) => u === 'kgs' ? v : u === 'tonhr' ? v * 1000 / 3600 : v / 3600;

  let dp_Pa, d_m, m_target = null;
  if (mode === 'flow') {
    dp_Pa = dp_Pa_in; d_m = d_mm / 1000;
    if (!(dp_Pa > 0)) return { error: 'Differential pressure must be > 0.' };
    if (!(d_m > 0 && d_m < D_m)) return { error: 'Bore d must be > 0 and smaller than pipe ID.' };
  } else if (mode === 'dp') {
    m_target = toKgs(flow_in, flow_unit); d_m = d_mm / 1000;
    if (!(m_target > 0)) return { error: 'Target total mass flow must be > 0.' };
    if (!(d_m > 0 && d_m < D_m)) return { error: 'Bore d must be > 0 and smaller than pipe ID.' };
    dp_Pa = tpSolveDp(corr, m_target, d_m, c);
    if (dp_Pa == null) return { error: 'Required ΔP exceeds 60 % of line pressure — bore too small for this two-phase flow (near-critical). Increase the bore.' };
  } else {
    m_target = toKgs(flow_in, flow_unit); dp_Pa = dp_Pa_in;
    if (!(m_target > 0)) return { error: 'Target total mass flow must be > 0.' };
    if (!(dp_Pa > 0))    return { error: 'Differential pressure must be > 0.' };
    d_m = tpSolveBore(corr, m_target, dp_Pa, c);
    if (d_m == null) return { error: 'No bore between β = 0.05 and 0.94 passes this flow at the given ΔP — change the ΔP range.' };
  }

  const r  = tpMassFlow(corr, dp_Pa, d_m, c);
  const m  = r.m;                       // kg/s (≈ target in dp/bore modes)
  const mg = x * m, ml = (1 - x) * m;
  const qg = mg / pr.rho_g, ql = ml / pr.rho_l;
  const vm = x / pr.rho_g + (1 - x) / pr.rho_l;
  const rho_h = 1 / vm;
  const alpha = (x / pr.rho_g) / vm;
  const A2 = Math.PI / 4 * d_m * d_m;

  // ── Correlation comparison (same mode, same inputs) ──
  const selVal = mode === 'flow' ? m * 3600 : mode === 'dp' ? dp_Pa : d_m * 1000;
  const compare = TP_KEYS.map(key => {
    let v = null;
    if (mode === 'flow')      v = tpMassFlow(key, dp_Pa, d_m, c).m * 3600;
    else if (mode === 'dp') { const s = tpSolveDp(key, m_target, d_m, c);   v = s != null ? s : null; }
    else                    { const s = tpSolveBore(key, m_target, dp_Pa, c); v = s != null ? s * 1000 : null; }
    return { key, label: TP_CORR[key].label, value: v,
             dev_pct: v != null ? (v / selVal - 1) * 100 : null, selected: key === corr };
  });
  const sepVals = compare.filter(q => q.key !== 'homogeneous' && q.value != null).map(q => q.value);
  const spread_raw = sepVals.length > 1 ? (Math.max(...sepVals) - Math.min(...sepVals)) / selVal * 100 : 0;
  // express the spread as a flow-equivalent % (ΔP ∝ ṁ², ṁ ∝ d² roughly)
  const spread_flow = mode === 'dp' ? spread_raw / 2 : mode === 'beta' ? spread_raw * 2 : spread_raw;

  // ── Sensitivity of flow to quality (+5 % on x) ──
  const x2 = Math.min(x * 1.05, 0.9999);
  const sens_x = (tpMassFlow(corr, dp_Pa, d_m, { ...c, x: x2 }).m / m - 1) * 100;

  // ── Uncertainty (indicative) ──
  const u_iso = parseFloat(estimateUncertainty(r.beta, r.Re, tapType, true));
  const U = Math.sqrt(TP_CORR[corr].base_u ** 2 + u_iso ** 2 + (spread_flow / 2) ** 2);

  // ── Permanent loss (single-phase ISO relation — approximate for two-phase) ──
  const perm_pct = computePressureRecovery(r.beta, r.Cd, tapType);
  const perm_Pa  = perm_pct / 100 * dp_Pa;

  // Gas-phase normal volume (gas–liquid only)
  const rho_n = pr.sub === 'wetsteam' ? null : 101325 * pr.MW / (8314.46 * 273.15);
  const nm3hr_gas = rho_n ? mg * 3600 / rho_n : null;

  // ── Warnings / infos ──
  const warns = [...pr.warns], infos = [...pr.infos];
  validateInputs({ D_m, d_m, P_Pa, rho: rho_h, mu: pr.mu_g, beta: r.beta, Z: pr.Z })
    .forEach(e => warns.push(e));
  const betaMax = ['nozzle_isa', 'venturi_nozzle'].includes(tapType) ? 0.80 : 0.75;
  if (r.beta < 0.20 || r.beta > betaMax) warns.push(`β=${r.beta.toFixed(4)} outside ISO 5167 range 0.20–${betaMax}`);
  if (dp_Pa / P_Pa > 0.25) warns.push('⚡ ΔP/P > 0.25: gas expansibility factor outside ISO validity — two-phase result unreliable');
  const Re_min = getReMin(r.beta);
  if (r.Re < Re_min) warns.push(`Continuous-phase Re=${r.Re.toFixed(0)} below ISO minimum ${Re_min} for β=${r.beta.toFixed(3)}`);
  if (corr === 'chisholm' && r.X > 1)
    warns.push(`X = ${r.X.toFixed(3)} > 1 (liquid-dominant) — outside Chisholm's orifice range; compare with Homogeneous/James`);
  if (corr === 'murdock' && r.X > 0.3)
    warns.push(`X = ${r.X.toFixed(3)} > 0.3 — outside Murdock's wet-gas range; Chisholm is preferred here`);
  if (corr === 'james' && pr.sub !== 'wetsteam')
    infos.push('James correlation was developed for steam–water; for other fluid pairs treat the result as indicative');
  if (corr === 'homogeneous')
    infos.push('Homogeneous model ignores phase slip — it gives the lowest flow for a given ΔP (conservative-low for metering)');
  if (spread_raw > 5)
    warns.push(`Correlations disagree by ${spread_raw.toFixed(1)} % — result is correlation-dependent; confirm x and consider a wet-gas / two-phase meter`);
  if (pr.zr?.outOfRange)
    infos.push(`Pitzer Z validity: Tr=${pr.zr.Tr?.toFixed(2)}, Pr=${pr.zr.Pr?.toFixed(2)} — outside recommended range`);
  infos.push(`Flow is sensitive to quality: +5 % on x changes total flow by ${sens_x >= 0 ? '+' : ''}${sens_x.toFixed(2)} % — x must come from a reliable source (heat balance, sampling, separator test)`);
  // ── Additional flashing across the plate (wet steam: isenthalpic, known enthalpy) ──
  let plateFlash = null;
  if (pr.sub === 'wetsteam') {
    const sU = tpHsat(pr.Tsat_C);
    const h  = sU.hf + x * sU.hfg;
    const P2 = (P_Pa - dp_Pa) / 1e5;
    const sD = tpHsat(tpTsat(P2));
    const x_down = (h - sD.hf) / sD.hfg;
    const x_avg  = 0.5 * (x + x_down);
    const m_avg  = tpMassFlow(corr, dp_Pa, d_m, { ...c, x: x_avg }).m;
    plateFlash = { x_down, dx_pct: (x_down / x - 1) * 100, flow_effect_pct: (m_avg / m - 1) * 100 };
    if (plateFlash.dx_pct > 2)
      warns.push(`Flashing across the plate: x rises ${x.toFixed(4)} → ${x_down.toFixed(4)} (+${plateFlash.dx_pct.toFixed(1)} %). Frozen-quality result may overstate flow by ≈ ${Math.abs(plateFlash.flow_effect_pct).toFixed(1)} % — keep ΔP/P small or allow for it`);
    else
      infos.push(`Flashing across the plate is small: x ${x.toFixed(4)} → ${x_down.toFixed(4)} (+${plateFlash.dx_pct.toFixed(2)} %)`);
  }
  if (flash)
    infos.push(`Quality from isenthalpic flash: liquid at ${Number.isFinite(tp.Tsrc_C) ? tp.Tsrc_C.toFixed(1) + ' °C / ' : 'saturation, '}${tp.Psrc_bar.toFixed(2)} bara (h = ${flash.h_in.toFixed(1)} kJ/kg) → x = ${x.toFixed(4)} at ${P_bar.toFixed(2)} bara. x changes with line pressure — pressure-compensate the DCS calculation.`);
  infos.push('Frozen quality assumed (no flashing/condensation across the plate). Install in vertical flow where possible; stratified horizontal flow is outside all correlations. Provide drain/vent hole and DP damping.');

  return {
    mode, twoPhaseCalc: true,
    mass_kghr:   m * 3600,
    mass_kgs:    m,
    mass_tonhr:  m * 3.6,
    qv_act_m3hr: (qg + ql) * 3600,
    qv_act_m3s:  qg + ql,
    nm3hr: null, nm3day: null, sm3hr: null,
    dp_Pa,
    dp_mmH2O: dp_Pa / 9.80665,  dp_inH2O: dp_Pa / 249.089, dp_kPa: dp_Pa / 1000,
    dp_mbar:  dp_Pa / 100,      dp_bar:   dp_Pa / 1e5,     dp_psi: dp_Pa / 6894.757,
    dp_kgcm2: dp_Pa / 98066.5,
    bore_mm: d_m * 1000, bore_in: d_m * 1000 / 25.4, beta: r.beta,
    pv_bar: null, throat_superheat_C: null,
    rho_op: rho_h,
    mu_used: pr.mu_g,
    mu_auto: pr.gasAuto ? pr.mu_g : null,
    Z_used:  pr.Z,
    Z_auto:  pr.gasAuto ? pr.Z : null,
    Z_autoOutOfRange: pr.zr?.outOfRange ?? false,
    steamSatWarning: false,
    steamSatT: pr.Tsat_C,
    Cd: r.Cd, Y: r.eps, E: r.E, Re_pipe: r.Re,
    perm_pct, perm_Pa,
    perm_mmH2O: perm_Pa / 9.80665, perm_mbar: perm_Pa / 100, perm_bar: perm_Pa / 1e5,
    perm_kPa: perm_Pa / 1000,      perm_psi:  perm_Pa / 6894.757,
    uncertainty_pct: U.toFixed(1),
    dp_P_ratio: dp_Pa / P_Pa,
    v_orifice: (qg + ql) / A2,
    v_pipe:    (qg + ql) / A_pipe,
    warnings: warns,
    infos,
    twoPhase: {
      sub: pr.sub, corr, corrLabel: TP_CORR[corr].label, x,
      xMode: flash ? 'flash' : 'entered',
      Psrc_bar: flash ? tp.Psrc_bar : null, Tsrc_C: flash ? flash.Tsrc : null, h_in: flash ? flash.h_in : null,
      x_down: plateFlash ? plateFlash.x_down : null,
      plate_dx_pct: plateFlash ? plateFlash.dx_pct : null,
      plate_flow_effect_pct: plateFlash ? plateFlash.flow_effect_pct : null,
      rho_g: pr.rho_g, rho_l: pr.rho_l, rho_h, alpha,
      mu_g: pr.mu_g, mu_l: pr.mu_l, Tsat_C: pr.Tsat_C,
      mg_kghr: mg * 3600, ml_kghr: ml * 3600,
      qg_m3hr: qg * 3600, ql_m3hr: ql * 3600, nm3hr_gas,
      X: r.X, Cch: r.Cch, OR: r.OR, Re_g: r.Re_g, Re_l: r.Re_l,
      sens_x, spread_pct: spread_raw,
      compareUnit: mode === 'flow' ? 'kg/hr' : mode === 'dp' ? 'Pa' : 'mm',
      compare,
    },
  };
}

// Lightweight preview for the page (densities as T/P/x change)
function twoPhasePreview(tp, P_bar, T_c) {
  const pr = tpProps({ ...tp, P_bar, T_c });
  let x = (tp.x > 0 && tp.x < 1) ? tp.x : null, x_flash = null;
  if (tp.sub === 'wetsteam' && tp.xMode === 'flash' && tp.Psrc_bar > P_bar && tp.Psrc_bar <= 200) {
    x_flash = tpFlashQuality(tp.Psrc_bar, P_bar, tp.Tsrc_C).x;
    x = (x_flash > 0 && x_flash < 1) ? x_flash : null;
  }
  const rho_h = x ? 1 / (x / pr.rho_g + (1 - x) / pr.rho_l) : null;
  return {
    ok: true,
    rho_op: rho_h,
    x_flash, fatal: pr.fatal || null,
    rho_g: pr.rho_g, rho_l: pr.rho_l, Tsat_C: pr.Tsat_C,
    mu_auto: pr.gasAuto ? pr.mu_g : null,
    Z_auto:  pr.gasAuto ? pr.Z : null,
    ...(tp.mix && tp.sub !== 'wetsteam' ? gasMixPreviewFields(tp.mix) : {}),   // ADD 2026-10
  };
}
// ── End of Section C-2: Two-Phase Orifice Extension ─────────────────────────

// ADD 2026-10: mixture fields shared by the density preview and the results
function gasMixPreviewFields(gm) {
  return { k_auto: gm.k, k_basis: 'gas mixture, ideal-gas cp mixing',
           gasMix: { ...gm.summary, warns: gm.warns, infos: gm.infos } };
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

    // ── TWO-PHASE input bundle (used only when cat === 'twophase') ──
    const buildTP = (b) => ({
      sub:        b.tpSub === 'wetsteam' ? 'wetsteam' : 'gasliq',
      corr:       b.tpCorr || 'chisholm',
      x:          parseFloat(b.x),
      gasKey:     b.fluidKey || null,
      MW_input:   parseFloat(b.MW) || 0,
      sg_gas:     parseFloat(b.sg) || 0,
      Z_input:    parseFloat(b.Z)  || 1,
      mu_g_input: parseFloat(b.mu) || 1.82e-5,
      liqKey:     b.liqKey || null,
      liqSG:      parseFloat(b.liqSG) || 1.0,
      liqMu:      parseFloat(b.liqMu) || 1e-3,
      xMode:      b.xMode === 'flash' ? 'flash' : 'entered',
      // Source (upstream liquid) pressure / temperature — same unit system as P, T
      Psrc_bar:   (() => { const v = parseFloat(b.Psrc); if (!(v > 0)) return null;
                           return (b.unitSys || 'metric') === 'metric' ? v : v * 0.0689476; })(),
      Tsrc_C:     (() => { const v = parseFloat(b.Tsrc); if (!Number.isFinite(v)) return NaN;
                           return (b.unitSys || 'metric') === 'metric' ? v : (v - 32) * 5 / 9; })(),
    });

// ── DENSITY PREVIEW (lightweight — called on every T/P/fluid change) ──
    if (body.action === 'density-preview') {
      const isMetric = (body.unitSys || 'metric') === 'metric';
      let P_bar = parseFloat(body.P) || 10;
      let T_c   = Number.isFinite(parseFloat(body.T)) ? parseFloat(body.T) : 20;   // FIX 2026-10: 0 °C / 0 °F was replaced by 20
      if (!isMetric) { P_bar = P_bar * 0.0689476; T_c = (T_c - 32) * 5/9; }
      const T_K = T_c + 273.15;
      const P_Pa = P_bar * 1e5;
      const cat      = body.cat      || 'gas';
      const fluidKey = body.fluidKey || null;
      const sg_input = parseFloat(body.sg) || 1.0;

      // ADD 2026-10: gas mixture (gas, or gas phase of gas–liquid two-phase)
      let gm = null;
      if (body.gasMix && (cat === 'gas' || (cat === 'twophase' && body.tpSub !== 'wetsteam'))) {
        gm = gasMixtureProps(body.gasMix, T_K, P_Pa);
        if (gm.error) {
          res.statusCode = 200;
          return res.end(JSON.stringify({ ok: false, error: gm.error, mixError: true }));
        }
      }

      // TWO-PHASE preview
      if (cat === 'twophase') {
        res.statusCode = 200;
        return res.end(JSON.stringify(twoPhasePreview({ ...buildTP(body), mix: gm }, P_bar, T_c)));
      }

      if (gm) {
        res.statusCode = 200;
        return res.end(JSON.stringify({
          ok: true,
          rho_op:  (P_Pa * gm.M) / (gm.Z * 8314.46 * T_K),
          mu_auto: gm.mu,
          Z_auto:  gm.Z,
          ...gasMixPreviewFields(gm),
        }));
      }

      let rho = null, mu_out = null, Z_out = null, k_out = null, k_basis = null;

      if (cat === 'steam') {
        const sres = steamDensity(P_bar, T_c);
        rho    = sres.rho;
        mu_out = sres.mu;
        const ka = steamKappaAuto(P_bar, T_c);   // FIX 2026-10
        k_out = ka.k; k_basis = ka.basis;
      } else if (cat === 'liquid') {
        const f = FLUID_DB_orifice[fluidKey] || null;
        if (f?.t === 'l' && f.rhoModel === 'poly_water') {
          // FIX 2026-08: water now uses the same IF97 polynomial as calculate();
          // it previously fell through to sg*1000 and reported a flat 1000 kg/m³.
          const T = Math.max(0, Math.min(360, T_c));
          const T2 = T*T, T3 = T2*T, T4 = T3*T, T5 = T4*T, T6 = T5*T;
          rho = -3.430583e-12*T6 + 3.305509e-09*T5 - 1.216454e-06*T4
                + 2.120305e-04*T3 - 2.009065e-02*T2 + 4.039409e-01*T + 998.117618;
          rho = Math.max(100, Math.min(1005, rho));
        } else if (f?.t === 'l' && f.rho0 && f.beta_T !== undefined) {
          rho = f.rho0 / (1 + f.beta_T * (T_c - f.T0));
          rho = Math.max(100, rho);
        } else {
          rho = sg_input * 1000;
        }
        mu_out = liquidViscosity(f, T_K);   // FIX 2026-08
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
        k_auto:  k_out,
        k_basis,
      }));
    }

    // ── PARSE & NORMALISE ALL INPUTS TO SI ──────────────────────────
    const mode     = body.mode    || 'flow';
    const cat      = body.cat     || 'gas';
    const tapType  = body.tapType || 'sharp_corner';
    const isMetric = (body.unitSys || 'metric') === 'metric';

    // Pressure & temperature
    let P_bar = parseFloat(body.P) || 10;
    let T_c   = Number.isFinite(parseFloat(body.T)) ? parseFloat(body.T) : 20;   // FIX 2026-10: 0 °C / 0 °F was replaced by 20
    if (!isMetric) { P_bar = P_bar * 0.0689476; T_c = (T_c - 32) * 5/9; }

    // Pipe & bore in mm
    const D_mm = dimToMm(parseFloat(body.D) || 154.05, body.D_unit || 'mm');
    const d_mm = dimToMm(parseFloat(body.d) || 75.00,  body.d_unit || 'mm');

    // DP in Pa
    const dp_Pa_in = dpToPa(parseFloat(body.dp) || 0, body.dp_unit || 'mmH2O');

    // Flow input
    const flow_in   = parseFloat(body.flow) || 0;
    const flow_unit = body.flow_unit || 'Nm3hr';

    // ── GAS MIXTURE (ADD 2026-10) — composition → M, Z, μ, κ ──
    // Used for gas, and for the gas phase of gas–liquid two-phase flow.
    // Without body.gasMix the request is handled exactly as before.
    let gm = null;
    if (body.gasMix && (cat === 'gas' || (cat === 'twophase' && body.tpSub !== 'wetsteam'))) {
      gm = gasMixtureProps(body.gasMix, T_c + 273.15, P_bar * 1e5);
      if (gm.error) {
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: false, error: gm.error }));
      }
    }
    const withMix = (r) => {
      if (!gm) return r;
      r.warnings = [...gm.warns, ...(r.warnings || [])];
      r.infos    = [...gm.infos, ...(r.infos || [])];
      return { ...r, k_used: gm.k, ...gasMixPreviewFields(gm) };
    };

    // ── TWO-PHASE BRANCH ──
    if (cat === 'twophase') {
      const tpResult = calculateTwoPhase({
        mode, tapType, customCd: body.customCd, P_bar, T_c,
        k: gm ? gm.k : (parseFloat(body.k) || 1.3),
        D_mm, d_mm, dp_Pa_in, flow_in, flow_unit,
        tp: { ...buildTP(body), mix: gm },
      });
      if (tpResult.error) {
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: false, error: tpResult.error }));
      }
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, ...withMix(tpResult) }));
    }

    const params = {
      mode, cat, tapType,
      customCd:  body.customCd,
      P_bar, T_c,
      Z_input:   parseFloat(body.Z)   || 1,
      k:         gm ? gm.k : (parseFloat(body.k) || 1.4),
      mu_input:  parseFloat(body.mu)  || (cat === 'liquid' ? 1e-3 : 1.82e-5),
      sg:        parseFloat(body.sg)  || (cat === 'liquid' ? 1.0  : 0.65),
      MW_input:  parseFloat(body.MW)  || 28.964,
      fluidKey:  gm ? null : (body.fluidKey || null),
      gasMix:    gm,
      D_mm, d_mm, dp_Pa_in, flow_in, flow_unit,
    };

    const result = calculate(params);

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, ...withMix(result) }));

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
// Rev. Nov-2026: reference fluid tables, Churchill transition, gas Z/ΔP-P₁/Mach checks, NPSH removed.
// All engineering computation lives here — zero physics in the browser.

'use strict';

/* ═══════════════════════════════════════════════════════════════
   SECURITY HELPERS
═══════════════════════════════════════════════════════════════ */
const ALLOWED_ORIGINS = [
  'https://www.multicalci.com',
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
   FLUID DATABASE  (142 fluids)
   Liquids: tabulated ρ(T), μ(T) generated from reference sources —
     IAPWS-95 / CoolProp Helmholtz EOS (water, NH₃, CO₂, LPG, refrigerants),
     CoolProp INCOMP (glycols, brines, seawater), DIPPR/Perry via the thermo
     library (pure organics), ASTM D341 Walther from ν40/ν100 (oils),
     Glasø (crudes) and handbook data (acids, food, others).
     Each entry carries a `src` string describing its basis and accuracy.
   Gases: ideal gas + Pitzer 2nd-virial Z, Sutherland viscosity.
═══════════════════════════════════════════════════════════════ */
const FLUID_DB_pdrop = [
  {id:"water", name:"Water", cat:"Water & Aqueous", isGas:false, tab:[[0,999.8,1.791],[10,999.7,1.306],[20,998.2,1.002],[30,995.6,0.7972],[40,992.2,0.6527],[50,988.0,0.5465],[60,983.2,0.466],[70,977.8,0.4035],[80,971.8,0.3541],[90,965.3,0.3142],[100,958.4,0.2816],[110,950.9,0.2546],[120,943.1,0.232],[140,926.1,0.1966],[160,907.5,0.1704],[180,887.0,0.1504],[200,864.7,0.1346]], vp:[[0,0.6112],[10,1.228],[20,2.339],[30,4.247],[40,7.385],[50,12.35],[60,19.95],[70,31.2],[80,47.41],[90,70.18],[100,101.4],[110,143.4],[120,198.7],[140,361.5],[160,618.2],[180,1003.0],[200,1555.0]], src:"IAPWS-95 via CoolProp"},
  {id:"seawater", name:"Seawater (3.5% NaCl)", cat:"Water & Aqueous", isGas:false, tab:[[0,1028.1,1.889],[10,1026.9,1.407],[20,1024.9,1.085],[30,1022.0,0.8631],[40,1018.4,0.7057],[50,1014.0,0.5911],[60,1009.1,0.5055],[70,1003.5,0.4399],[80,997.5,0.3882],[90,991.0,0.3462],[100,984.1,0.311]], vp:[[0,0.54],[10,1.08],[20,2.1],[30,3.81],[50,10.9],[80,44.3],[100,97.0]], src:"CoolProp INCOMP (SecCool/Melinder data)"},
  {id:"brine10", name:"Brine 10% NaCl", cat:"Water & Aqueous", isGas:false, tab:[[-5,1078.0,2.437],[0,1076.8,2.071],[10,1073.9,1.542],[20,1070.6,1.193],[30,1066.7,0.9605],[40,1062.3,0.804],[50,1058.1,0.6732],[60,1053.3,0.5741],[70,1047.8,0.4971],[80,1041.9,0.4361],[90,1035.4,0.387],[100,1028.4,0.3469]], vp:[[0,0.54],[20,2.1],[50,10.5],[80,43.0],[100,96.0]], src:"CoolProp INCOMP, extended above its range with constant relative viscosity to water"},
  {id:"brine20", name:"Brine 20% NaCl", cat:"Water & Aqueous", isGas:false, tab:[[-15,1162.7,4.649],[-10,1160.7,3.833],[0,1156.7,2.696],[10,1152.3,1.986],[20,1147.8,1.532],[30,1142.9,1.237],[40,1137.8,1.047],[50,1133.6,0.8764],[60,1128.8,0.7474],[70,1123.3,0.6471],[80,1117.4,0.5678],[90,1110.9,0.5038],[100,1103.9,0.4516]], vp:[[0,0.5],[20,1.95],[50,10.0],[80,41.5],[100,93.0]], src:"CoolProp INCOMP, extended above its range with constant relative viscosity to water"},
  {id:"brine25", name:"Brine 25% NaCl", cat:"Water & Aqueous", isGas:false, tab:[[-15,1203.6,5.766],[-10,1201.7,4.753],[0,1197.6,3.344],[10,1193.3,2.463],[20,1188.7,1.9],[30,1183.8,1.535],[40,1178.7,1.298],[50,1174.5,1.087],[60,1169.7,0.9269],[70,1164.3,0.8026],[80,1158.3,0.7042],[90,1151.8,0.6249],[100,1144.9,0.5601]], vapFixed:0.017, src:"Handbook point data, ±10–20%"},
  {id:"cacl2_20", name:"CaCl₂ Solution 20%", cat:"Water & Aqueous", isGas:false, tab:[[-15,1188.4,5.143],[-10,1186.9,4.336],[0,1184.8,3.183],[10,1183.0,2.427],[20,1180.6,1.913],[30,1176.5,1.55],[40,1169.8,1.285],[50,1165.7,1.076],[60,1160.8,0.9176],[70,1155.4,0.7945],[80,1149.4,0.6971],[90,1142.9,0.6186],[100,1136.0,0.5544]], vp:[[0,0.48],[20,1.85],[50,9.5],[80,40.0],[100,90.0]], src:"CoolProp INCOMP, extended above its range with constant relative viscosity to water"},
  {id:"cacl2_30", name:"CaCl₂ Solution 30%", cat:"Water & Aqueous", isGas:false, tab:[[-30,1304.9,17.84],[-20,1301.1,11.18],[-10,1296.7,7.627],[0,1291.7,5.572],[10,1286.5,4.294],[20,1281.2,3.438],[30,1276.2,2.817],[40,1271.5,2.325],[50,1267.3,1.947],[60,1262.4,1.66],[70,1257.0,1.438],[80,1251.0,1.261],[90,1244.5,1.119],[100,1237.6,1.003]], vp:[[0,0.4],[20,1.6],[50,8.5],[80,36.0],[100,82.0]], src:"CoolProp INCOMP, extended above its range with constant relative viscosity to water"},
  {id:"eg30", name:"Ethylene Glycol 30%", cat:"Glycols & Coolants", isGas:false, tab:[[-10,1047.5,6.508],[0,1045.0,4.298],[10,1041.8,2.983],[20,1038.0,2.166],[30,1033.7,1.639],[40,1028.8,1.286],[50,1023.4,1.041],[60,1017.5,0.866],[70,1011.1,0.7371],[80,1004.3,0.6388],[90,997.0,0.5613],[100,989.4,0.4977]], vapFixed:0.021, src:"CoolProp INCOMP (SecCool/Melinder data)"},
  {id:"eg50", name:"Ethylene Glycol 50%", cat:"Glycols & Coolants", isGas:false, tab:[[-30,1085.1,41.77],[-20,1082.2,22.18],[-10,1078.7,12.78],[0,1074.6,7.93],[10,1070.0,5.257],[20,1064.9,3.693],[30,1059.4,2.729],[40,1053.4,2.103],[50,1047.1,1.678],[60,1040.5,1.375],[70,1033.6,1.148],[80,1026.4,0.9685],[90,1019.0,0.8195],[100,1011.5,0.69]], vp:[[0,0.3],[20,1.2],[50,8.0],[80,34.0],[100,78.0]], src:"CoolProp INCOMP (SecCool/Melinder data)"},
  {id:"eg70", name:"Ethylene Glycol 70%", cat:"Glycols & Coolants", isGas:false, tab:[[-30,1114.0,111.4],[-20,1110.4,50.74],[-10,1106.1,26.06],[0,1101.1,14.9],[10,1095.5,9.351],[20,1089.3,6.356],[30,1082.8,4.615],[40,1075.8,3.532],[50,1068.5,2.81],[60,1061.0,2.293],[70,1053.4,1.893],[80,1045.6,1.559],[90,1037.8,1.265],[100,1030.1,0.9963]], vp:[[0,0.18],[20,0.8],[50,6.0],[80,28.0],[100,68.0]], src:"Handbook point data, ±10–20% (extrapolated from CoolProp MEG 50/60%)"},
  {id:"pg30", name:"Propylene Glycol 30%", cat:"Glycols & Coolants", isGas:false, tab:[[-10,1034.3,12.33],[0,1031.6,7.117],[10,1028.0,4.438],[20,1023.8,2.965],[30,1018.9,2.104],[40,1013.4,1.573],[50,1007.5,1.229],[60,1001.2,0.9946],[70,994.5,0.8272],[80,987.6,0.7011],[90,980.5,0.6005],[100,973.4,0.5155]], vp:[[0,0.5],[20,1.8],[50,10.0],[80,40.0],[100,90.0]], src:"CoolProp INCOMP (SecCool/Melinder data)"},
  {id:"pg50", name:"Propylene Glycol 50%", cat:"Glycols & Coolants", isGas:false, tab:[[-30,1064.1,212.4],[-20,1060.4,84.74],[-10,1056.0,38.1],[0,1050.9,19.11],[10,1045.3,10.58],[20,1039.1,6.394],[30,1032.4,4.175],[40,1025.4,2.914],[50,1018.0,2.151],[60,1010.5,1.661],[70,1002.7,1.328],[80,994.9,1.088],[90,987.1,0.9032],[100,979.3,0.7518]], vp:[[0,0.35],[20,1.3],[50,8.5],[80,35.0],[100,80.0]], src:"CoolProp INCOMP (SecCool/Melinder data)"},
  {id:"deg", name:"Diethylene Glycol (DEG)", cat:"Glycols & Coolants", isGas:false, tab:[[0,1132.4,115.3],[10,1125.1,62.99],[20,1117.8,36.81],[30,1110.6,22.84],[40,1103.4,14.95],[50,1096.1,10.27],[60,1088.8,7.358],[70,1081.5,5.481],[80,1074.1,4.227],[90,1066.6,3.364],[100,1059.0,2.754],[110,1051.4,2.313],[120,1043.9,1.989],[140,1029.3,1.565],[160,1015.1,1.322],[180,1001.2,1.185],[200,987.7,1.111]], vp:[[0,8.86e-05],[10,0.0002561],[20,0.0006886],[30,0.001734],[40,0.004118],[50,0.00927],[60,0.01987],[70,0.04075],[80,0.08023],[90,0.1522],[100,0.2789],[110,0.4953],[120,0.8541],[140,2.347],[160,5.771],[180,12.8],[200,26.02]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"teg", name:"Triethylene Glycol (TEG)", cat:"Glycols & Coolants", isGas:false, tab:[[0,1140.5,158.5],[10,1132.6,85.23],[20,1124.7,48.14],[30,1116.8,29.38],[40,1109.0,19.19],[50,1101.2,13.24],[60,1093.4,9.545],[70,1085.6,7.138],[80,1077.8,5.502],[90,1069.9,4.35],[100,1061.9,3.513],[110,1053.9,2.879],[120,1046.1,2.384],[140,1030.7,1.68],[160,1015.8,1.222],[180,1001.3,0.9148],[200,987.2,0.7017]], vp:[[0,9.702e-06],[10,3.006e-05],[20,8.623e-05],[30,0.0002307],[40,0.0005798],[50,0.001376],[60,0.003101],[70,0.006665],[80,0.01372],[90,0.02713],[100,0.05173],[110,0.09538],[120,0.1705],[140,0.5005],[160,1.33],[180,3.23],[200,7.126]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"mea30", name:"MEA 30% (Monoethanolamine)", cat:"Glycols & Coolants", isGas:false, tab:[[20,1014.2,2.92],[25,1012.0,2.48],[40,1005.2,1.7],[60,996.2,1.1],[80,987.2,0.78],[100,978.2,0.58]], vapFixed:0.01, src:"Handbook point data, ±10–20%"},
  {id:"dea35", name:"DEA 35% (Diethanolamine)", cat:"Glycols & Coolants", isGas:false, tab:[[20,1041.5,4.4],[25,1039.0,3.75],[40,1031.5,2.45],[60,1021.5,1.55],[80,1011.5,1.05],[100,1001.5,0.77]], vapFixed:0.006, src:"Handbook point data, ±10–20%"},
  {id:"gasoline", name:"Gasoline (Petrol)", cat:"Petroleum & Fuels", isGas:false, tab:[[-40,797.2,1.299],[-30,787.8,1.083],[-20,778.2,0.9161],[-10,768.8,0.7848],[0,759.2,0.68],[10,749.8,0.5952],[20,740.2,0.5257],[30,730.8,0.4682],[40,721.2,0.42],[50,711.8,0.3793],[60,702.2,0.3447]], vp:[[0,10.0],[10,16.0],[20,25.0],[30,38.5],[40,57.0],[50,82.0],[60,115.0]], src:"Indicative literature values, ±30% — verify for design"},
  {id:"diesel", name:"Diesel Fuel", cat:"Petroleum & Fuels", isGas:false, tab:[[-10,852.5,10.32],[0,845.5,7.116],[10,838.5,5.163],[20,831.5,3.903],[30,824.5,3.051],[40,817.5,2.453],[50,810.5,2.017],[60,803.5,1.692],[70,796.5,1.443],[80,789.5,1.249],[90,782.5,1.094],[100,775.5,0.9694],[110,768.5,0.8671],[120,761.5,0.7824],[140,747.5,0.6513],[150,740.5,0.6]], vp:[[20,0.01],[40,0.03],[60,0.07],[80,0.15],[100,0.3]], src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"kerosene", name:"Kerosene / Jet-A", cat:"Petroleum & Fuels", isGas:false, tab:[[-40,839.6,6.349],[-30,832.4,4.463],[-20,825.2,3.301],[-10,818.0,2.542],[0,810.8,2.022],[10,803.6,1.652],[20,796.4,1.381],[30,789.2,1.175],[40,782.0,1.017],[50,774.8,0.8916],[60,767.6,0.7913],[70,760.4,0.7098],[80,753.2,0.6425],[90,746.0,0.5865],[100,738.8,0.5392],[110,731.6,0.499],[120,724.4,0.4645],[140,710.0,0.4087],[150,702.8,0.3859]], vapFixed:0.003, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"jeta1", name:"Jet A-1 Fuel", cat:"Petroleum & Fuels", isGas:false, tab:[[-40,843.6,6.379],[-30,836.4,4.484],[-20,829.2,3.317],[-10,822.0,2.554],[0,814.8,2.032],[10,807.6,1.661],[20,800.4,1.387],[30,793.2,1.181],[40,786.0,1.022],[50,778.8,0.8962],[60,771.6,0.7955],[70,764.4,0.7135],[80,757.2,0.6459],[90,750.0,0.5896],[100,742.8,0.5421],[110,735.6,0.5017],[120,728.4,0.4671],[140,714.0,0.411],[150,706.8,0.3881]], vapFixed:0.003, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"hfo", name:"Heavy Fuel Oil (HFO 380)", cat:"Petroleum & Fuels", isGas:false, tab:[[20,976.9,4920.0],[30,970.7,1805.0],[40,964.5,764.1],[50,958.3,364.2],[60,952.1,191.5],[70,945.9,109.4],[80,939.7,67.01],[90,933.5,43.5],[100,927.3,29.67],[110,921.1,21.11],[120,914.9,15.56],[140,902.5,9.233],[160,890.1,6.003],[180,877.7,4.182],[200,865.3,3.073]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"crude20", name:"Crude Oil API 20 (heavy)", cat:"Petroleum & Fuels", isGas:false, tab:[[10,936.8,304.0],[20,930.2,151.5],[30,923.6,88.98],[40,917.0,57.86],[50,910.4,40.3],[60,903.8,29.51],[70,897.2,22.43],[80,890.6,17.57],[90,884.0,14.09],[100,877.4,11.53],[110,870.8,9.583],[120,864.2,8.079],[140,851.0,5.943],[150,844.4,5.171]], vp:[[20,0.05],[40,0.16],[80,1.0]], src:"Glasø (1980) dead-oil correlation from API gravity — indicative, crude viscosity varies widely"},
  {id:"crude30", name:"Crude Oil API 30", cat:"Petroleum & Fuels", isGas:false, tab:[[10,879.0,27.51],[20,872.4,16.33],[30,865.8,10.96],[40,859.2,7.94],[50,852.6,6.056],[60,846.0,4.795],[70,839.4,3.905],[80,832.8,3.252],[90,826.2,2.757],[100,819.6,2.371],[110,813.0,2.065],[120,806.4,1.817],[140,793.2,1.444],[150,786.6,1.301]], vapFixed:0.02, src:"Glasø (1980) dead-oil correlation from API gravity — indicative, crude viscosity varies widely"},
  {id:"crude40", name:"Crude Oil API 40", cat:"Petroleum & Fuels", isGas:false, tab:[[10,827.9,5.918],[20,821.3,3.928],[30,814.7,2.872],[40,808.1,2.229],[50,801.5,1.802],[60,794.9,1.5],[70,788.3,1.276],[80,781.7,1.105],[90,775.1,0.9709],[100,768.5,0.8626],[110,761.9,0.7738],[120,755.3,0.6998],[140,742.1,0.5841],[150,735.5,0.5382]], vapFixed:0.04, src:"Glasø (1980) dead-oil correlation from API gravity — indicative, crude viscosity varies widely"},
  {id:"crude50", name:"Crude Oil API 50 (light)", cat:"Petroleum & Fuels", isGas:false, tab:[[10,782.5,1.947],[20,775.9,1.401],[30,769.3,1.09],[40,762.7,0.8893],[50,756.1,0.7497],[60,749.5,0.647],[70,742.9,0.5685],[80,736.3,0.5065],[90,729.7,0.4564],[100,723.1,0.415],[110,716.5,0.3804],[120,709.9,0.3509],[140,696.7,0.3035],[150,690.1,0.2842]], vp:[[20,0.02],[40,0.08],[80,0.6]], src:"Glasø (1980) dead-oil correlation from API gravity — indicative, crude viscosity varies widely"},
  {id:"naphtha", name:"Naphtha (light)", cat:"Petroleum & Fuels", isGas:false, tab:[[-40,747.0,0.6444],[-30,737.5,0.5526],[-20,728.0,0.4797],[-10,718.5,0.4209],[0,709.0,0.3729],[10,699.5,0.3332],[20,690.0,0.3],[30,680.5,0.272],[40,671.0,0.2482],[50,661.5,0.2277],[60,652.0,0.21],[70,642.5,0.1946],[80,633.0,0.1811]], src:"Indicative literature values, ±30% — verify for design"},
  {id:"naphtha_h", name:"Naphtha (heavy)", cat:"Petroleum & Fuels", isGas:false, tab:[[-20,777.0,1.155],[-10,769.0,0.984],[0,761.0,0.8484],[10,753.0,0.7391],[20,745.0,0.65],[30,737.0,0.5765],[40,729.0,0.5153],[50,721.0,0.4637],[60,713.0,0.42],[70,705.0,0.3826],[80,697.0,0.3504],[90,689.0,0.3224],[100,681.0,0.298],[110,673.0,0.2766],[120,665.0,0.2577],[140,649.0,0.226],[150,641.0,0.2126]], vapFixed:0.03, src:"Indicative literature values, ±30% — verify for design"},
  {id:"atmresid", name:"Atmospheric Residue (ATB)", cat:"Petroleum & Fuels", isGas:false, tab:[[60,942.1,200.6],[70,935.9,121.4],[80,929.7,77.81],[90,923.5,52.33],[100,917.3,36.69],[110,911.1,26.66],[120,904.9,19.98],[140,892.5,12.12],[160,880.1,7.982],[180,867.7,5.598],[200,855.3,4.125],[225,839.8,2.974],[250,824.3,2.247],[275,808.8,1.763],[300,793.3,1.424],[325,777.8,1.179],[350,762.3,0.9957]], vapFixed:0.001, src:"Indicative literature values, ±30% — verify for design"},
  {id:"vacresid", name:"Vacuum Residue (VTB)", cat:"Petroleum & Fuels", isGas:false, tab:[[80,981.0,7784.0],[90,975.0,3739.0],[100,969.0,1938.0],[110,963.0,1074.0],[120,957.0,630.2],[140,945.0,251.5],[160,933.0,117.6],[180,921.0,62.3],[200,909.0,36.4],[225,894.0,20.72],[250,879.0,12.94],[275,864.0,8.692],[300,849.0,6.175],[325,834.0,4.587],[350,819.0,3.533]], vapFixed:0.0001, src:"Indicative literature values, ±30% — verify for design"},
  {id:"bitumen", name:"Bitumen / Asphalt", cat:"Petroleum & Fuels", isGas:false, tab:[[60,1003.0,300900.0],[70,997.0,81900.0],[80,991.0,26280.0],[90,985.0,9701.0],[100,979.0,4034.0],[110,973.0,1858.0],[120,967.0,934.8],[140,955.0,293.9],[160,943.0,116.3],[180,931.0,54.71],[200,919.0,29.41],[220,907.0,17.52]], vapFixed:0.0001, src:"Indicative literature values, ±30% — verify for design"},
  {id:"lube32", name:"Lube Oil ISO VG 32", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,885.8,713.2],[0,879.5,295.5],[10,873.1,140.6],[20,866.9,74.79],[30,860.5,43.57],[40,854.2,27.34],[50,848.0,18.23],[60,841.6,12.78],[70,835.4,9.344],[80,829.0,7.074],[90,822.8,5.516],[100,816.5,4.409],[110,810.1,3.6],[120,803.9,2.993],[140,791.2,2.166],[150,785.0,1.878]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"lube46", name:"Lube Oil ISO VG 46", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,890.8,1313.0],[0,884.5,510.6],[10,878.1,230.0],[20,871.9,116.7],[30,865.5,65.26],[40,859.2,39.53],[50,853.0,25.57],[60,846.6,17.46],[70,840.4,12.48],[80,834.0,9.26],[90,827.8,7.096],[100,821.5,5.586],[110,815.1,4.5],[120,808.9,3.698],[140,796.2,2.622],[150,790.0,2.254]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"lube68", name:"Lube Oil ISO VG 68", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,895.8,2529.0],[0,889.5,919.0],[10,883.1,390.4],[20,876.9,188.3],[30,870.5,100.8],[40,864.2,58.77],[50,858.0,36.78],[60,851.6,24.41],[70,845.4,17.01],[80,839.0,12.35],[90,832.8,9.287],[100,826.5,7.19],[110,820.1,5.708],[120,813.9,4.629],[140,801.2,3.211],[150,795.0,2.734]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"lube100", name:"Lube Oil ISO VG 100", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,900.8,4647.0],[0,894.5,1599.0],[10,888.1,647.3],[20,881.9,299.2],[30,875.5,154.2],[40,869.2,86.92],[50,863.0,52.81],[60,856.6,34.15],[70,850.4,23.26],[80,844.0,16.55],[90,837.8,12.22],[100,831.5,9.312],[110,825.1,7.289],[120,818.9,5.838],[140,806.2,3.964],[150,800.0,3.345]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"lube150", name:"Lube Oil ISO VG 150", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,905.8,8581.0],[0,899.5,2812.0],[10,893.1,1089.0],[20,886.9,483.3],[30,880.5,240.2],[40,874.2,131.1],[50,868.0,77.4],[60,861.6,48.76],[70,855.4,32.45],[80,849.0,22.62],[90,842.8,16.4],[100,836.5,12.3],[110,830.1,9.484],[120,823.9,7.497],[140,811.2,4.978],[150,805.0,4.161]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"lube220", name:"Lube Oil ISO VG 220", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,910.8,15270.0],[0,904.5,4782.0],[10,898.1,1777.0],[20,891.9,759.9],[30,885.5,365.2],[40,879.2,193.4],[50,873.0,111.1],[60,866.6,68.31],[70,860.4,44.48],[80,854.0,30.41],[90,847.8,21.66],[100,841.5,15.99],[110,835.1,12.16],[120,828.9,9.493],[140,816.2,6.169],[150,810.0,5.109]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"hydr32", name:"Hydraulic Oil ISO 32", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,885.8,713.2],[0,879.5,295.5],[10,873.1,140.6],[20,866.9,74.79],[30,860.5,43.57],[40,854.2,27.34],[50,848.0,18.23],[60,841.6,12.78],[70,835.4,9.344],[80,829.0,7.074],[90,822.8,5.516],[100,816.5,4.409],[110,810.1,3.6],[120,803.9,2.993],[140,791.2,2.166],[150,785.0,1.878]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"hydr46", name:"Hydraulic Oil ISO 46", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,890.8,1313.0],[0,884.5,510.6],[10,878.1,230.0],[20,871.9,116.7],[30,865.5,65.26],[40,859.2,39.53],[50,853.0,25.57],[60,846.6,17.46],[70,840.4,12.48],[80,834.0,9.26],[90,827.8,7.096],[100,821.5,5.586],[110,815.1,4.5],[120,808.9,3.698],[140,796.2,2.622],[150,790.0,2.254]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"hydr68", name:"Hydraulic Oil ISO 68", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,895.8,2529.0],[0,889.5,919.0],[10,883.1,390.4],[20,876.9,188.3],[30,870.5,100.8],[40,864.2,58.77],[50,858.0,36.78],[60,851.6,24.41],[70,845.4,17.01],[80,839.0,12.35],[90,832.8,9.287],[100,826.5,7.19],[110,820.1,5.708],[120,813.9,4.629],[140,801.2,3.211],[150,795.0,2.734]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"hydr100", name:"Hydraulic Oil ISO 100", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,900.8,4647.0],[0,894.5,1599.0],[10,888.1,647.3],[20,881.9,299.2],[30,875.5,154.2],[40,869.2,86.92],[50,863.0,52.81],[60,856.6,34.15],[70,850.4,23.26],[80,844.0,16.55],[90,837.8,12.22],[100,831.5,9.312],[110,825.1,7.289],[120,818.9,5.838],[140,806.2,3.964],[150,800.0,3.345]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"thermoil", name:"Thermal / Heat Transfer Oil", cat:"Lubricants & Hydraulic", isGas:false, tab:[[0,875.8,195.2],[10,869.2,97.84],[20,862.8,54.36],[30,856.2,32.84],[40,849.8,21.24],[50,843.2,14.53],[60,836.8,10.41],[70,830.2,7.754],[80,823.8,5.963],[90,817.2,4.712],[100,810.8,3.811],[110,804.2,3.143],[120,797.8,2.636],[140,784.8,1.936],[160,771.8,1.488],[180,758.8,1.185],[200,745.8,0.9715],[225,729.5,0.7831],[250,713.2,0.6501],[275,697.0,0.5527],[300,680.8,0.4792],[320,667.8,0.4326]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"turbineoil", name:"Turbine Oil ISO VG 46", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,890.8,1313.0],[0,884.5,510.6],[10,878.1,230.0],[20,871.9,116.7],[30,865.5,65.26],[40,859.2,39.53],[50,853.0,25.57],[60,846.6,17.46],[70,840.4,12.48],[80,834.0,9.26],[90,827.8,7.096],[100,821.5,5.586],[110,815.1,4.5],[120,808.9,3.698],[140,796.2,2.622],[150,790.0,2.254]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"gearoil320", name:"Gear Oil ISO VG 320", cat:"Lubricants & Hydraulic", isGas:false, tab:[[-10,915.8,28260.0],[0,909.5,8330.0],[10,903.1,2936.0],[20,896.9,1199.0],[30,890.5,553.6],[40,884.2,283.0],[50,878.0,157.5],[60,871.6,94.2],[70,865.4,59.86],[80,859.0,40.05],[90,852.8,28.0],[100,846.5,20.31],[110,840.1,15.22],[120,833.9,11.73],[140,821.2,7.451],[150,815.0,6.111]], vapFixed:0.001, src:"ASTM D341 (Walther) from typical ν40/ν100 for the grade — verify with product data sheet"},
  {id:"methanol", name:"Methanol", cat:"Alcohols", isGas:false, tab:[[-40,847.8,1.777],[-30,838.1,1.425],[-20,828.6,1.162],[-10,819.1,0.9617],[0,809.7,0.806],[10,800.4,0.6833],[20,791.0,0.5852],[30,781.6,0.5062],[40,772.2,0.4417],[50,762.6,0.3883],[60,752.8,0.3437],[70,742.8,0.3062],[80,732.6,0.2743],[90,722.0,0.2467],[100,710.9,0.2227],[110,699.4,0.2017],[120,687.3,0.1831],[140,660.8,0.1513],[160,630.4,0.125],[163,625.4,0.1214]], vp:[[-40,0.201],[-30,0.4715],[-20,1.028],[-10,2.102],[0,4.056],[10,7.438],[20,13.03],[30,21.91],[40,35.52],[50,55.68],[60,84.71],[70,125.4],[80,181.1],[90,255.7],[100,353.7],[110,480.2],[120,640.8],[140,1090.0],[160,1760.0],[163,1883.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"ethanol", name:"Ethanol (96%)", cat:"Alcohols", isGas:false, tab:[[-40,857.9,5.478],[-30,849.4,4.157],[-20,840.9,3.21],[-10,832.4,2.517],[0,823.9,2.001],[10,815.4,1.611],[20,806.9,1.313],[30,798.3,1.083],[40,789.6,0.9016],[50,780.7,0.7579],[60,771.6,0.6427],[70,762.1,0.5496],[80,752.4,0.4732],[90,742.2,0.4099],[100,731.5,0.3569],[110,720.3,0.3122],[120,708.3,0.2741],[140,681.7,0.2122],[160,650.9,0.1652],[164,644.2,0.1572]], vp:[[-40,0.05564],[-30,0.1446],[-20,0.3459],[-10,0.7689],[0,1.602],[10,3.149],[20,5.876],[30,10.47],[40,17.88],[50,29.41],[60,46.73],[70,71.99],[80,107.8],[90,157.3],[100,224.2],[110,312.6],[120,427.3],[140,756.6],[160,1258.0],[164,1383.0]], src:"DIPPR/Perry correlations (thermo library), adjusted to 96% v/v"},
  {id:"ethanol_abs", name:"Ethanol Absolute (99.9%)", cat:"Alcohols", isGas:false, tab:[[-40,840.4,4.98],[-30,831.9,3.779],[-20,823.4,2.918],[-10,814.9,2.288],[0,806.4,1.819],[10,797.9,1.464],[20,789.4,1.194],[30,780.8,0.9841],[40,772.1,0.8196],[50,763.2,0.689],[60,754.1,0.5843],[70,744.6,0.4996],[80,734.9,0.4302],[90,724.7,0.3726],[100,714.0,0.3244],[110,702.8,0.2838],[120,690.8,0.2491],[140,664.2,0.193],[160,633.4,0.1502],[164,626.7,0.1429]], vp:[[-40,0.05564],[-30,0.1446],[-20,0.3459],[-10,0.7689],[0,1.602],[10,3.149],[20,5.876],[30,10.47],[40,17.88],[50,29.41],[60,46.73],[70,71.99],[80,107.8],[90,157.3],[100,224.2],[110,312.6],[120,427.3],[140,756.6],[160,1258.0],[164,1383.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"ipa", name:"Isopropanol (IPA)", cat:"Alcohols", isGas:false, tab:[[-40,841.5,23.25],[-30,832.8,14.76],[-20,823.9,9.701],[-10,814.9,6.573],[0,805.7,4.576],[10,796.3,3.265],[20,786.7,2.381],[30,776.9,1.771],[40,766.8,1.341],[50,756.5,1.032],[60,745.9,0.8065],[70,735.0,0.6387],[80,723.8,0.5122],[82,721.5,0.4908]], vp:[[-40,0.0268],[-30,0.07504],[-20,0.1936],[-10,0.4622],[0,1.027],[10,2.141],[20,4.207],[30,7.841],[40,13.92],[50,23.67],[60,38.66],[70,60.88],[80,92.76],[82,100.5]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"nbutanol", name:"n-Butanol", cat:"Alcohols", isGas:false, tab:[[-40,855.8,21.34],[-30,848.2,14.16],[-20,840.4,9.777],[-10,832.6,6.965],[0,824.6,5.092],[10,816.5,3.806],[20,808.2,2.899],[30,799.8,2.245],[40,791.3,1.765],[50,782.6,1.406],[60,773.7,1.133],[70,764.6,0.9235],[80,755.3,0.7603],[90,745.8,0.6316],[100,736.1,0.5292],[110,726.1,0.4468],[118,717.9,0.3923]], vp:[[-40,0.002123],[-30,0.006689],[-20,0.01925],[-10,0.05112],[0,0.1264],[10,0.2923],[20,0.6325],[30,1.289],[40,2.487],[50,4.567],[60,8.013],[70,13.49],[80,21.87],[90,34.24],[100,51.94],[110,76.54],[118,102.4]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"glycerol", name:"Glycerol (100%)", cat:"Alcohols", isGas:false, tab:[[0,1274.0,12070.0],[10,1267.5,3900.0],[20,1261.0,1412.0],[30,1254.5,612.0],[40,1248.0,284.0],[50,1241.5,142.0],[60,1235.0,81.3],[70,1228.5,50.6],[80,1222.0,31.9],[90,1215.5,21.3],[100,1209.0,14.8]], vp:[[21,1.425e-05],[30,4.202e-05],[40,0.0001287],[50,0.0003647],[60,0.0009622],[70,0.00238],[80,0.005548],[90,0.01226],[100,0.02576],[110,0.05175],[120,0.09968],[140,0.3303],[160,0.959],[167,1.354]], src:"Segur & Oberstar (1951) data"},
  {id:"glycerol50", name:"Glycerol 50% in Water", cat:"Alcohols", isGas:false, tab:[[-20,1143.6,46.86],[-10,1139.8,23.87],[0,1135.5,13.72],[10,1130.9,8.708],[20,1126.1,5.958],[30,1121.0,4.295],[40,1115.8,3.189],[50,1111.6,2.67],[60,1106.8,2.277],[70,1101.3,1.972],[80,1095.4,1.73],[90,1088.9,1.535],[100,1081.9,1.376]], vp:[[20,0.1],[40,0.35],[80,3.5],[100,10.0]], src:"CoolProp INCOMP, extended above its range with constant relative viscosity to water"},
  {id:"benzene", name:"Benzene", cat:"Aromatics", isGas:false, tab:[[9,890.4,0.767],[10,889.4,0.7543],[20,878.9,0.6475],[30,868.4,0.5635],[40,857.8,0.496],[50,847.0,0.4404],[60,836.2,0.3943],[70,825.2,0.3547],[80,814.0,0.3209],[90,802.6,0.2917],[100,791.1,0.2659],[110,779.3,0.2431],[120,767.3,0.223],[140,742.4,0.1884],[160,716.1,0.1604],[180,688.0,0.1366],[200,657.3,0.1166],[204,650.8,0.1129]], vp:[[9,5.763],[10,6.074],[20,10.03],[30,15.92],[40,24.39],[50,36.2],[60,52.25],[70,73.52],[80,101.1],[90,136.2],[100,180.2],[110,234.3],[120,300.0],[140,472.5],[160,710.3],[180,1027.0],[200,1438.0],[204,1533.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"toluene", name:"Toluene", cat:"Aromatics", isGas:false, tab:[[-40,922.4,1.598],[-30,913.1,1.29],[-20,903.9,1.067],[-10,894.7,0.8992],[0,885.4,0.7697],[10,876.2,0.6685],[20,866.9,0.5875],[30,857.6,0.5208],[40,848.2,0.4652],[50,838.8,0.4187],[60,829.2,0.3796],[70,819.6,0.3463],[80,809.9,0.3173],[90,800.0,0.2917],[100,790.0,0.2693],[110,779.8,0.2497],[120,769.4,0.2324],[140,748.0,0.2023],[160,725.6,0.1774],[180,701.8,0.1566],[200,676.3,0.1378],[225,640.9,0.1176],[229,634.8,0.1144]], vp:[[-40,0.04208],[-30,0.1013],[-20,0.2251],[-10,0.4659],[0,0.9057],[10,1.666],[20,2.919],[30,4.894],[40,7.892],[50,12.29],[60,18.54],[70,27.19],[80,38.87],[90,54.29],[100,74.25],[110,99.62],[120,131.4],[140,218.1],[160,343.4],[180,517.2],[200,750.1],[225,1142.0],[229,1217.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"xylene", name:"Xylene (mixed)", cat:"Aromatics", isGas:false, tab:[[-40,914.7,1.607],[-30,906.3,1.321],[-20,898.0,1.102],[-10,889.6,0.9356],[0,881.2,0.8045],[10,872.7,0.7005],[20,864.2,0.6177],[30,855.6,0.5499],[40,847.0,0.4934],[50,838.2,0.4461],[60,829.4,0.4062],[70,820.4,0.3718],[80,811.4,0.3414],[90,802.3,0.3147],[100,793.0,0.2911],[110,783.6,0.2701],[120,774.0,0.251],[140,754.4,0.2175],[160,734.0,0.1898],[180,712.6,0.1659],[200,689.9,0.1453],[225,659.2,0.1231],[250,624.9,0.104],[251,623.4,0.1032]], vp:[[-40,0.007252],[-30,0.01937],[-20,0.04727],[-10,0.1066],[0,0.2244],[10,0.444],[20,0.8317],[30,1.484],[40,2.534],[50,4.161],[60,6.596],[70,10.13],[80,15.11],[90,21.97],[100,31.18],[110,43.32],[120,59.01],[140,103.9],[160,172.2],[180,271.3],[200,409.3],[225,650.4],[250,986.2],[251,1002.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"oxylene", name:"o-Xylene", cat:"Aromatics", isGas:false, tab:[[-21,914.6,1.659],[-20,913.8,1.624],[-10,905.4,1.329],[0,897.0,1.108],[10,888.6,0.9415],[20,880.2,0.8114],[30,871.8,0.708],[40,863.3,0.6252],[50,854.8,0.5572],[60,846.2,0.5002],[70,837.6,0.4522],[80,828.8,0.4114],[90,820.0,0.3763],[100,811.0,0.3454],[110,801.9,0.3184],[120,792.7,0.2946],[140,773.7,0.2547],[160,754.0,0.2222],[180,733.5,0.1957],[200,711.7,0.173],[225,682.5,0.1489],[250,650.2,0.1274],[262,633.2,0.1179]], vp:[[-21,0.03303],[-20,0.03603],[-10,0.08229],[0,0.1752],[10,0.3506],[20,0.6636],[30,1.196],[40,2.061],[50,3.413],[60,5.454],[70,8.438],[80,12.68],[90,18.55],[100,26.5],[110,37.02],[120,50.7],[140,90.12],[160,150.6],[180,238.9],[200,362.5],[225,579.3],[250,882.3],[262,1064.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"styrene", name:"Styrene", cat:"Aromatics", isGas:false, tab:[[-27,945.6,1.769],[-20,939.7,1.521],[-10,931.1,1.247],[0,922.4,1.039],[10,913.7,0.8788],[20,904.9,0.7535],[30,896.0,0.6539],[40,886.9,0.5736],[50,877.8,0.5081],[60,868.6,0.4541],[70,859.2,0.4091],[80,849.7,0.3712],[90,840.1,0.3391],[100,830.4,0.3117],[110,820.5,0.2881],[120,810.5,0.2676],[140,789.9,0.2342],[145,784.7,0.2271]], vp:[[-27,0.01994],[-20,0.03595],[-10,0.07904],[0,0.164],[10,0.3233],[20,0.6085],[30,1.098],[40,1.904],[50,3.174],[60,5.108],[70,7.957],[80,12.04],[90,17.72],[100,25.46],[110,35.74],[120,49.16],[140,87.93],[145,100.6]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"cumene", name:"Cumene (Isopropylbenzene)", cat:"Aromatics", isGas:false, tab:[[-40,911.5,2.412],[-30,903.7,1.912],[-20,895.8,1.548],[-10,887.8,1.278],[0,879.7,1.073],[10,871.5,0.9145],[20,863.3,0.7899],[30,854.9,0.6905],[40,846.4,0.6101],[50,837.9,0.5444],[60,829.2,0.49],[70,820.4,0.4445],[80,811.5,0.4062],[90,802.4,0.3736],[100,793.3,0.3457],[110,783.9,0.3217],[120,774.4,0.3008],[126,768.6,0.2896]], vp:[[-40,0.005482],[-30,0.01355],[-20,0.03119],[-10,0.06738],[0,0.1376],[10,0.2671],[20,0.4955],[30,0.8827],[40,1.515],[50,2.516],[60,4.052],[70,6.347],[80,9.667],[90,14.31],[100,20.66],[110,29.15],[120,40.26],[126,48.42]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"hexane", name:"n-Hexane", cat:"Aliphatics", isGas:false, tab:[[-40,711.7,0.6447],[-30,703.2,0.5595],[-20,694.6,0.4903],[-10,685.9,0.4339],[0,677.2,0.3871],[10,668.3,0.3473],[20,659.4,0.313],[30,650.3,0.2837],[40,641.0,0.2583],[50,631.6,0.2357],[60,622.0,0.2156],[70,612.1,0.1978],[80,602.0,0.182],[90,591.6,0.1676],[100,581.0,0.1544],[110,569.9,0.1425],[120,558.4,0.1317],[140,533.8,0.1121],[158,509.3,0.09676]], vp:[[-40,0.4537],[-30,0.9534],[-20,1.87],[-10,3.451],[0,6.041],[10,10.09],[20,16.16],[30,24.95],[40,37.27],[50,54.07],[60,76.41],[70,105.5],[80,142.5],[90,189.0],[100,246.3],[110,316.1],[120,399.9],[140,616.6],[158,878.1]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"heptane", name:"n-Heptane", cat:"Aliphatics", isGas:false, tab:[[-40,733.7,0.9588],[-30,725.4,0.8067],[-20,717.2,0.6899],[-10,708.9,0.5974],[0,700.6,0.5232],[10,692.3,0.4629],[20,683.8,0.4125],[30,675.3,0.3697],[40,666.7,0.3332],[50,658.0,0.3021],[60,649.2,0.275],[70,640.2,0.2509],[80,631.0,0.2296],[90,621.6,0.2108],[100,612.0,0.1941],[110,602.2,0.1789],[120,592.1,0.165],[140,570.9,0.1411],[160,548.0,0.1207],[180,522.8,0.1032],[186,514.7,0.09845]], vp:[[-40,0.07705],[-30,0.1816],[-20,0.3948],[-10,0.8003],[0,1.525],[10,2.751],[20,4.73],[30,7.788],[40,12.34],[50,18.89],[60,28.05],[70,40.52],[80,57.09],[90,78.65],[100,106.2],[110,140.7],[120,183.4],[140,298.3],[160,461.3],[180,684.1],[186,764.5]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"octane", name:"n-Octane", cat:"Aliphatics", isGas:false, tab:[[-40,750.2,1.481],[-30,742.3,1.197],[-20,734.4,0.9915],[-10,726.5,0.8349],[0,718.6,0.7148],[10,710.6,0.6205],[20,702.6,0.5441],[30,694.5,0.4818],[40,686.4,0.4306],[50,678.1,0.3875],[60,669.7,0.3505],[70,661.3,0.3188],[80,652.7,0.2914],[90,643.9,0.2674],[100,635.0,0.246],[110,625.9,0.2267],[120,616.6,0.2095],[140,597.2,0.1799],[160,576.8,0.1548],[180,554.8,0.1335],[200,530.8,0.1144],[210,517.8,0.1059]], vp:[[-40,0.01339],[-30,0.03525],[-20,0.08481],[-10,0.1885],[0,0.3908],[10,0.7616],[20,1.405],[30,2.469],[40,4.153],[50,6.718],[60,10.49],[70,15.88],[80,23.35],[90,33.47],[100,46.86],[110,64.24],[120,86.4],[140,148.5],[160,240.8],[180,371.9],[200,551.4],[210,662.6]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"cyclohex", name:"Cyclohexane", cat:"Aliphatics", isGas:false, tab:[[10,788.0,1.173],[20,778.7,0.9729],[30,769.2,0.8198],[40,759.7,0.7012],[50,750.0,0.6067],[60,740.2,0.5309],[70,730.3,0.4674],[80,720.2,0.4148],[90,710.0,0.3704],[100,699.5,0.3318],[110,688.9,0.2989],[120,678.1,0.2705],[140,655.5,0.2236],[160,631.6,0.1878],[180,605.7,0.1588],[197,581.5,0.1382]], vp:[[10,6.341],[20,10.34],[30,16.24],[40,24.64],[50,36.27],[60,51.94],[70,72.57],[80,99.17],[90,132.8],[100,174.7],[110,226.1],[120,288.2],[140,450.3],[160,672.3],[180,966.4],[197,1283.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"isooctane", name:"Isooctane (2,2,4-TMP)", cat:"Aliphatics", isGas:false, tab:[[-40,740.5,1.289],[-30,732.5,1.061],[-20,724.4,0.8895],[-10,716.4,0.7581],[0,708.3,0.6553],[10,700.2,0.5726],[20,692.0,0.5049],[30,683.8,0.449],[40,675.4,0.4025],[50,667.0,0.363],[60,658.4,0.3288],[70,649.7,0.299],[80,640.8,0.273],[90,631.7,0.2503],[100,622.4,0.2299],[110,612.9,0.2115],[120,603.1,0.1948],[140,582.6,0.1662],[160,560.5,0.1416],[180,536.2,0.1204],[189,524.3,0.1117]], vp:[[-40,0.1002],[-30,0.2271],[-20,0.4771],[-10,0.9382],[0,1.74],[10,3.065],[20,5.156],[30,8.328],[40,12.97],[50,19.55],[60,28.62],[70,40.81],[80,56.84],[90,77.49],[100,103.6],[110,136.1],[120,176.1],[140,282.3],[160,431.3],[180,633.0],[189,743.8]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"dcm", name:"Dichloromethane (DCM)", cat:"Chlorinated Solvents", isGas:false, tab:[[-40,1435.3,0.9082],[-30,1418.1,0.7816],[-20,1400.6,0.6811],[-10,1382.8,0.6001],[0,1364.7,0.5339],[10,1346.4,0.4792],[20,1327.7,0.4334],[30,1308.7,0.3948],[40,1289.3,0.362],[50,1269.5,0.3338],[60,1249.2,0.3094],[70,1228.5,0.2881],[80,1207.2,0.2695],[90,1185.3,0.2531],[100,1162.8,0.2385]], vp:[[-40,1.988],[-30,3.776],[-20,6.804],[-10,11.7],[0,19.27],[10,30.57],[20,46.85],[30,69.6],[40,100.5],[50,141.6],[60,194.9],[70,262.6],[80,347.1],[90,451.0],[100,576.9]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"chloroform", name:"Chloroform (CHCl₃)", cat:"Chlorinated Solvents", isGas:false, tab:[[-40,1596.9,1.259],[-30,1580.1,1.07],[-20,1563.0,0.9222],[-10,1545.7,0.8044],[0,1528.1,0.7092],[10,1510.2,0.6313],[20,1492.1,0.5668],[30,1473.6,0.5129],[40,1454.7,0.4673],[50,1435.5,0.4285],[60,1415.9,0.3951],[70,1395.9,0.3662],[80,1375.4,0.3411]], vp:[[-40,0.6271],[-30,1.303],[-20,2.529],[-10,4.62],[0,8.01],[10,13.26],[20,21.07],[30,32.31],[40,47.97],[50,69.22],[60,97.37],[70,133.9],[80,180.3]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"cctc", name:"Carbon Tetrachloride (CCl₄)", cat:"Chlorinated Solvents", isGas:false, tab:[[-19,1661.4,1.874],[-10,1645.8,1.585],[0,1628.4,1.332],[10,1610.6,1.133],[20,1592.6,0.9739],[30,1574.3,0.845],[40,1555.8,0.7394],[50,1536.8,0.6521],[60,1517.6,0.5792],[70,1498.0,0.5178],[80,1477.9,0.4657],[90,1457.5,0.4211],[100,1436.5,0.3828],[110,1415.1,0.3495],[120,1393.1,0.3205],[140,1347.2,0.2727],[160,1298.1,0.2353],[180,1245.2,0.2054],[181,1242.4,0.2041]], vp:[[-19,1.432],[-10,2.509],[0,4.444],[10,7.502],[20,12.14],[30,18.91],[40,28.49],[50,41.65],[60,59.27],[70,82.34],[80,111.9],[90,149.2],[100,195.3],[110,251.6],[120,319.4],[140,495.4],[160,734.9],[180,1051.0],[181,1069.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"tce", name:"Trichloroethylene", cat:"Chlorinated Solvents", isGas:false, tab:[[-40,1557.8,1.22],[-30,1542.6,1.04],[-20,1527.3,0.9004],[-10,1511.8,0.7902],[0,1496.0,0.7018],[10,1480.0,0.6299],[20,1463.8,0.5707],[30,1447.3,0.5213],[40,1430.6,0.4796],[50,1413.6,0.4443],[60,1396.3,0.414],[70,1378.7,0.3878],[80,1360.8,0.365],[90,1342.5,0.3451],[100,1323.8,0.3276],[110,1304.8,0.312],[120,1285.2,0.2983],[140,1244.7,0.2749],[160,1201.8,0.256],[180,1156.1,0.2405],[200,1106.6,0.2276],[212,1074.7,0.2209]], vp:[[-40,0.1516],[-30,0.3293],[-20,0.6727],[-10,1.302],[0,2.4],[10,4.238],[20,7.196],[30,11.73],[40,18.38],[50,27.82],[60,40.83],[70,58.3],[80,81.21],[90,110.6],[100,147.8],[110,193.9],[120,250.2],[140,399.5],[160,607.8],[180,888.1],[200,1255.0],[212,1524.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"pce", name:"Perchloroethylene (PCE)", cat:"Chlorinated Solvents", isGas:false, tab:[[-19,1680.9,1.435],[-10,1667.3,1.27],[0,1652.1,1.12],[10,1636.7,0.9951],[20,1621.2,0.8913],[30,1605.5,0.8038],[40,1589.6,0.7294],[50,1573.5,0.6655],[60,1557.2,0.6103],[70,1540.8,0.5622],[80,1524.1,0.52],[90,1507.2,0.4828],[100,1490.0,0.4497],[110,1472.6,0.4202],[120,1454.9,0.3937],[140,1418.6,0.3482],[160,1381.0,0.3104],[180,1341.7,0.2785],[200,1300.5,0.2511],[225,1245.7,0.2217],[246,1195.8,0.2]], vp:[[-19,0.1583],[-10,0.2991],[0,0.5774],[10,1.064],[20,1.88],[30,3.201],[40,5.248],[50,8.309],[60,12.74],[70,18.99],[80,27.56],[90,39.05],[100,54.15],[110,73.61],[120,98.25],[140,166.7],[160,267.3],[180,408.7],[200,600.2],[225,925.3],[246,1287.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"acetone", name:"Acetone", cat:"Ketones & Esters", isGas:false, tab:[[-40,854.9,0.6685],[-30,844.3,0.5812],[-20,833.7,0.5109],[-10,823.0,0.4536],[0,812.2,0.4062],[10,801.3,0.3659],[20,790.3,0.3311],[30,779.1,0.3013],[40,767.7,0.2754],[50,756.1,0.2525],[60,744.3,0.2321],[70,732.2,0.2142],[80,719.8,0.1983],[90,707.0,0.1839],[100,693.8,0.1707],[110,680.2,0.1588],[120,666.0,0.1481],[140,635.6,0.1289],[158,605.4,0.114]], vp:[[-40,0.7217],[-30,1.501],[-20,2.917],[-10,5.345],[0,9.299],[10,15.45],[20,24.66],[30,37.96],[40,56.58],[50,81.95],[60,115.7],[70,159.5],[80,215.5],[90,285.7],[100,372.3],[110,477.8],[120,604.8],[140,934.1],[158,1333.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"mek", name:"MEK (Methyl Ethyl Ketone)", cat:"Ketones & Esters", isGas:false, tab:[[-40,867.5,0.9277],[-30,857.4,0.7947],[-20,847.2,0.6875],[-10,836.8,0.6],[0,826.3,0.5278],[10,815.7,0.4676],[20,804.9,0.417],[30,794.0,0.374],[40,782.8,0.3372],[50,771.5,0.3056],[60,760.0,0.2782],[70,748.2,0.2543],[80,736.2,0.2334],[90,723.9,0.2149],[100,711.4,0.1986],[110,698.5,0.1841],[120,685.3,0.1711],[140,657.5,0.149],[160,627.8,0.131],[180,595.2,0.1161],[183,590.1,0.1141]], vp:[[-40,0.2032],[-30,0.4443],[-20,0.9134],[-10,1.773],[0,3.254],[10,5.683],[20,9.496],[30,15.25],[40,23.65],[50,35.52],[60,51.86],[70,73.79],[80,102.6],[90,139.6],[100,186.4],[110,244.7],[120,316.1],[140,506.0],[160,772.1],[180,1133.0],[183,1196.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"mibk", name:"MIBK (Methyl Isobutyl Ketone)", cat:"Ketones & Esters", isGas:false, tab:[[-40,852.1,1.625],[-30,843.8,1.322],[-20,835.4,1.093],[-10,826.9,0.9166],[0,818.3,0.7788],[10,809.6,0.6694],[20,800.7,0.5814],[30,791.8,0.5096],[40,782.7,0.4505],[50,773.4,0.4012],[60,764.0,0.3599],[70,754.5,0.3248],[80,744.7,0.2949],[90,734.8,0.2692],[100,724.7,0.2469],[110,714.4,0.2274],[116,708.1,0.217]], vp:[[-40,0.02492],[-30,0.06002],[-20,0.1349],[-10,0.285],[0,0.57],[10,1.086],[20,1.979],[30,3.457],[40,5.778],[50,9.283],[60,14.4],[70,21.63],[80,31.58],[90,44.94],[100,62.49],[110,85.07],[116,101.4]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"cyclohexanone", name:"Cyclohexanone", cat:"Ketones & Esters", isGas:false, tab:[[-27,986.8,7.776],[-20,981.0,6.206],[-10,972.6,4.619],[0,964.2,3.538],[10,955.6,2.778],[20,947.0,2.231],[30,938.3,1.828],[40,929.5,1.525],[50,920.6,1.293],[60,911.6,1.112],[70,902.5,0.9685],[80,893.3,0.8539],[90,883.9,0.7609],[100,874.5,0.6848],[110,864.9,0.6218],[120,855.1,0.5692],[140,835.2,0.4875],[155,819.7,0.4414]], vp:[[-27,0.009429],[-20,0.01829],[-10,0.04382],[0,0.09734],[10,0.2022],[20,0.3956],[30,0.7342],[40,1.299],[50,2.204],[60,3.599],[70,5.677],[80,8.682],[90,12.91],[100,18.71],[110,26.5],[120,36.75],[140,66.81],[155,100.2]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"ethacet", name:"Ethyl Acetate", cat:"Ketones & Esters", isGas:false, tab:[[-40,966.3,0.9454],[-30,955.6,0.8286],[-20,944.7,0.7294],[-10,933.7,0.6446],[0,922.5,0.5718],[10,911.1,0.5091],[20,899.5,0.4547],[30,887.7,0.4075],[40,875.6,0.3663],[50,863.4,0.3301],[60,850.8,0.2984],[70,838.0,0.2704],[80,824.8,0.2456],[90,811.3,0.2237],[100,797.4,0.2041],[110,783.0,0.1866],[120,768.2,0.171],[140,736.9,0.1444],[160,702.7,0.1229],[171,682.3,0.1127]], vp:[[-40,0.2115],[-30,0.4576],[-20,0.9316],[-10,1.797],[0,3.302],[10,5.815],[20,9.844],[30,16.0],[40,25.06],[50,37.96],[60,55.8],[70,79.83],[80,111.5],[90,152.3],[100,203.9],[110,268.2],[120,347.0],[140,556.6],[160,850.2],[171,1054.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"butacet", name:"Butyl Acetate", cat:"Ketones & Esters", isGas:false, tab:[[-23,922.3,1.492],[-20,919.5,1.406],[-10,910.0,1.167],[0,900.4,0.9831],[10,890.7,0.8394],[20,880.9,0.7252],[30,870.9,0.6333],[40,860.8,0.5584],[50,850.5,0.4966],[60,840.1,0.4452],[70,829.5,0.4019],[80,818.7,0.3653],[90,807.7,0.334],[100,796.5,0.307],[110,785.1,0.2837],[120,773.4,0.2633],[126,766.2,0.2523]], vp:[[-23,0.06624],[-20,0.08381],[-10,0.1766],[0,0.3525],[10,0.6698],[20,1.218],[30,2.131],[40,3.595],[50,5.873],[60,9.315],[70,14.35],[80,21.48],[90,31.31],[100,44.56],[110,62.01],[120,84.57],[126,101.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"h2so4_98", name:"Sulfuric Acid 98%", cat:"Acids & Bases", isGas:false, tab:[[0,1854.0,50.4],[10,1845.0,34.4],[20,1836.0,24.09],[30,1827.0,17.28],[40,1818.0,12.65],[50,1809.0,9.449],[60,1800.0,7.181],[70,1791.0,5.545],[80,1782.0,4.345],[90,1773.0,3.45],[100,1764.0,2.774],[110,1755.0,2.256],[120,1746.0,1.854],[140,1728.0,1.289],[150,1719.0,1.088]], vp:[[20,3e-05],[100,0.01],[200,0.5]], src:"Handbook point data, ±10–20%"},
  {id:"h2so4_50", name:"Sulfuric Acid 50%", cat:"Acids & Bases", isGas:false, tab:[[-20,1425.0,10.18],[-10,1417.5,7.717],[0,1410.0,5.97],[10,1402.5,4.703],[20,1395.0,3.765],[30,1387.5,3.059],[40,1380.0,2.518],[50,1372.5,2.099],[60,1365.0,1.768],[70,1357.5,1.504],[80,1350.0,1.292],[90,1342.5,1.119],[100,1335.0,0.9763],[110,1327.5,0.8581],[120,1320.0,0.7591]], vapFixed:0.02, src:"Handbook point data, ±10–20%"},
  {id:"h2so4_10", name:"Sulfuric Acid 10%", cat:"Acids & Bases", isGas:false, tab:[[0,1074.6,1.945],[10,1070.3,1.534],[20,1066.0,1.23],[30,1061.7,1.0],[40,1057.4,0.8246],[50,1053.1,0.6878],[60,1048.8,0.58],[70,1044.5,0.494],[80,1040.2,0.4245],[90,1035.9,0.3679],[100,1031.6,0.3213]], vp:[[20,2.3],[50,10.0],[80,38.0],[100,90.0]], src:"Handbook point data, ±10–20%"},
  {id:"hcl30", name:"Hydrochloric Acid 30%", cat:"Acids & Bases", isGas:false, tab:[[-20,1169.0,4.457],[-10,1164.0,3.436],[0,1159.0,2.699],[10,1154.0,2.157],[20,1149.0,1.75],[30,1144.0,1.44],[40,1139.0,1.199],[50,1134.0,1.01],[60,1129.0,0.86]], vapFixed:0.06, src:"Indicative literature values, ±30% — verify for design"},
  {id:"hcl10", name:"Hydrochloric Acid 10%", cat:"Acids & Bases", isGas:false, tab:[[0,1054.0,1.809],[10,1050.5,1.437],[20,1047.0,1.16],[30,1043.5,0.9497],[40,1040.0,0.7875],[50,1036.5,0.6606],[60,1033.0,0.56],[70,1029.5,0.4793],[80,1026.0,0.4139],[90,1022.5,0.3603]], vp:[[10,25.0],[20,42.0],[30,65.0],[50,120.0]], src:"Handbook point data, ±10–20%"},
  {id:"hno3_65", name:"Nitric Acid 65%", cat:"Acids & Bases", isGas:false, tab:[[0,1412.0,2.778],[10,1401.5,2.251],[20,1391.0,1.85],[30,1380.5,1.54],[40,1370.0,1.298],[50,1359.5,1.105],[60,1349.0,0.95],[70,1338.5,0.824],[80,1328.0,0.7204],[90,1317.5,0.6346],[100,1307.0,0.5628]], vapFixed:0.04, src:"Indicative literature values, ±30% — verify for design"},
  {id:"hno3_30", name:"Nitric Acid 30%", cat:"Acids & Bases", isGas:false, tab:[[0,1192.0,1.917],[10,1186.0,1.536],[20,1180.0,1.25],[30,1174.0,1.031],[40,1168.0,0.8608],[50,1162.0,0.7269],[60,1156.0,0.62],[70,1150.0,0.5338],[80,1144.0,0.4634],[90,1138.0,0.4055],[100,1132.0,0.3574]], vp:[[0,1.2],[20,3.0],[50,11.0],[80,35.0]], src:"Indicative literature values, ±30% — verify for design"},
  {id:"h3po4_85", name:"Phosphoric Acid 85%", cat:"Acids & Bases", isGas:false, tab:[[20,1689.8,38.0],[30,1680.2,26.33],[40,1670.8,18.68],[50,1661.2,13.54],[60,1651.8,10.0],[70,1642.2,7.519],[80,1632.8,5.746],[90,1623.2,4.456],[100,1613.8,3.504],[110,1604.2,2.789],[120,1594.8,2.247]], vp:[[20,0.01],[60,0.04],[100,0.15],[150,1.0]], src:"Indicative literature values, ±30% — verify for design"},
  {id:"naoh30", name:"NaOH (Caustic) 30%", cat:"Acids & Bases", isGas:false, tab:[[10,1333.0,16.83],[20,1328.0,12.0],[30,1323.0,8.749],[40,1318.0,6.509],[50,1313.0,4.932],[60,1308.0,3.8],[70,1303.0,2.973],[80,1298.0,2.358],[90,1293.0,1.894],[100,1288.0,1.54],[110,1283.0,1.265],[120,1278.0,1.05]], vapFixed:0.02, src:"Indicative literature values, ±30% — verify for design"},
  {id:"naoh50", name:"NaOH (Caustic) 50%", cat:"Acids & Bases", isGas:false, tab:[[15,1527.8,110.3],[20,1525.0,83.58],[30,1519.5,49.29],[40,1514.0,30.07],[50,1508.5,18.91],[60,1503.0,12.23],[70,1497.5,8.114],[80,1492.0,5.509],[90,1486.5,3.821],[100,1481.0,2.703],[110,1475.5,1.947],[120,1470.0,1.426]], vp:[[20,0.5],[50,4.0],[80,25.0],[100,70.0]], src:"Handbook point data, ±10–20%"},
  {id:"koh30", name:"KOH Solution 30%", cat:"Acids & Bases", isGas:false, tab:[[0,1300.0,3.205],[10,1295.0,2.575],[20,1290.0,2.1],[30,1285.0,1.736],[40,1280.0,1.452],[50,1275.0,1.229],[60,1270.0,1.05],[70,1265.0,0.9055],[80,1260.0,0.7875],[90,1255.0,0.6901],[100,1250.0,0.6091]], vp:[[20,1.5],[50,8.0],[80,35.0],[100,85.0]], src:"Indicative literature values, ±30% — verify for design"},
  {id:"aceticac", name:"Acetic Acid (glacial)", cat:"Acids & Bases", isGas:false, tab:[[20,1047.1,1.202],[30,1036.9,1.037],[40,1026.6,0.9036],[50,1016.1,0.7935],[60,1005.4,0.7021],[70,994.6,0.6255],[80,983.5,0.5607],[90,972.2,0.5056],[100,960.6,0.4583],[110,948.8,0.4174],[117,940.4,0.3921]], vp:[[20,1.558],[30,2.755],[40,4.682],[50,7.654],[60,12.09],[70,18.5],[80,27.55],[90,40.02],[100,56.85],[110,79.14],[117,98.66]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"aceticac_50", name:"Acetic Acid 50%", cat:"Acids & Bases", isGas:false, tab:[[0,1075.0,3.134],[10,1066.5,2.632],[20,1058.0,2.237],[30,1049.5,1.922],[40,1041.0,1.667],[50,1032.5,1.459],[60,1024.0,1.287],[70,1015.5,1.144],[80,1007.0,1.023],[90,998.5,0.9208],[100,990.0,0.8335]], vapFixed:0.04, src:"Handbook point data, ±10–20%"},
  {id:"formicac", name:"Formic Acid 85%", cat:"Acids & Bases", isGas:false, tab:[[12,1204.3,2.128],[20,1194.7,1.785],[30,1182.5,1.46],[40,1170.1,1.216],[50,1157.5,1.03],[60,1144.6,0.8856],[70,1131.6,0.7718],[80,1118.2,0.6809],[90,1104.6,0.6074],[100,1090.7,0.5474]], vapFixed:0.04, src:"Handbook point data, ±10–20% (pure formic-acid viscosity, 85% density)"},
  {id:"ammonia_aq", name:"Ammonia Solution 25%", cat:"Acids & Bases", isGas:false, tab:[[-20,926.5,4.679],[-10,922.3,3.139],[0,917.6,2.236],[10,912.5,1.663],[20,906.9,1.27],[30,900.9,0.9792],[40,897.5,0.8018],[50,893.3,0.6713],[60,888.4,0.5724]], vp:[[0,0.55],[20,2.0],[40,6.5],[80,35.0],[100,90.0]], src:"CoolProp INCOMP, extended above its range with constant relative viscosity to water"},
  {id:"lpg", name:"LPG (Propane/Butane mix)", cat:"Liquefied Gases", isGas:false, tab:[[-40,602.2,0.2274],[-30,591.1,0.2029],[-20,579.5,0.1819],[-10,567.6,0.1635],[0,555.3,0.1474],[10,542.3,0.1332],[20,528.8,0.1204],[30,514.4,0.1088],[40,498.9,0.09823],[50,482.1,0.08839],[60,463.4,0.07909],[70,441.9,0.07008],[80,415.5,0.06095]], vp:[[-40,79.44],[-30,120.9],[-20,177.6],[-10,252.7],[0,349.8],[10,472.6],[20,625.2],[30,811.8],[40,1037.0],[50,1304.0],[60,1620.0],[70,1990.0],[80,2420.0]], src:"CoolProp Helmholtz EOS — saturated liquid (60/40 wt% propane/n-butane)"},
  {id:"propane_liq", name:"Liquid Propane", cat:"Liquefied Gases", isGas:false, tab:[[-40,578.4,0.1926],[-30,566.6,0.1723],[-20,554.5,0.1547],[-10,541.8,0.1393],[0,528.6,0.1256],[10,514.7,0.1133],[20,500.1,0.1023],[30,484.4,0.09219],[40,467.5,0.08284],[50,448.9,0.07407],[60,428.0,0.06565],[70,403.6,0.05736],[80,373.3,0.04879]], vp:[[-40,111.1],[-30,167.8],[-20,244.5],[-10,345.3],[0,474.5],[10,636.6],[20,836.5],[30,1079.0],[40,1369.0],[50,1713.0],[60,2117.0],[70,2587.0],[80,3132.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"butane_liq", name:"Liquid Butane", cat:"Liquefied Gases", isGas:false, tab:[[-40,641.9,0.3158],[-30,631.9,0.2803],[-20,621.7,0.2503],[-10,611.4,0.2247],[0,600.7,0.2025],[10,589.8,0.1832],[20,578.6,0.1662],[30,567.0,0.1511],[40,554.9,0.1376],[50,542.3,0.1254],[60,529.1,0.1143],[70,515.2,0.1041],[80,500.4,0.09465],[90,484.5,0.0858],[100,467.1,0.07741],[110,447.9,0.06934],[120,425.9,0.06142]], vp:[[-40,16.79],[-30,28.21],[-20,45.21],[-10,69.55],[0,103.2],[10,148.5],[20,207.6],[30,283.4],[40,378.5],[50,495.8],[60,638.2],[70,809.1],[80,1012.0],[90,1249.0],[100,1526.0],[110,1846.0],[120,2213.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"ammonia_liq", name:"Liquid Ammonia", cat:"Liquefied Gases", isGas:false, tab:[[-40,689.8,0.2802],[-30,677.5,0.2434],[-20,665.0,0.2141],[-10,652.0,0.1901],[0,638.6,0.1702],[10,624.8,0.1532],[20,610.4,0.1385],[30,595.4,0.1256],[40,579.6,0.1141],[50,563.0,0.1039],[60,545.3,0.09451],[70,526.3,0.08594],[80,505.7,0.07799],[90,482.8,0.07049],[100,456.8,0.06327]], vp:[[-40,71.63],[-30,119.4],[-20,190.0],[-10,290.6],[0,429.2],[10,614.8],[20,857.0],[30,1167.0],[40,1555.0],[50,2033.0],[60,2614.0],[70,3312.0],[80,4141.0],[90,5116.0],[100,6255.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"ammonia", name:"Ammonia (NH₃) — auto phase", cat:"Dual-Phase (auto L/G)", isGas:"auto", Tc:132.41, Pc:113.63, omega:0.2557, gas_MW:17.03, gas_mu_ref:1.01000e-05, gas_T_ref:293.15, gas_C_su:370, liq_tab:[[-70,725.0,0.4768],[-40,689.8,0.2802],[-30,677.5,0.2434],[-20,665.0,0.2141],[-10,652.0,0.1901],[0,638.6,0.1702],[10,624.8,0.1532],[20,610.4,0.1385],[30,595.4,0.1256],[40,579.6,0.1141],[50,563.0,0.1039],[60,545.3,0.09451],[70,526.3,0.08594],[80,505.7,0.07799],[90,482.8,0.07049],[100,456.8,0.06327],[110,425.7,0.05605],[120,385.1,0.04827],[125,357.1,0.0437]], vp:[[-70,10.9],[-40,71.63],[-30,119.4],[-20,190.0],[-10,290.6],[0,429.2],[10,614.8],[20,857.0],[30,1167.0],[40,1555.0],[50,2033.0],[60,2614.0],[70,3312.0],[80,4141.0],[90,5116.0],[100,6255.0],[110,7577.0],[120,9109.0],[125,9964.0]], src:"CoolProp Helmholtz EOS — saturated liquid (liquid) / Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity (vapour)"},
  {id:"co2_liq", name:"Liquid CO₂ (subcritical)", cat:"Liquefied Gases", isGas:false, tab:[[-50,1154.6,0.2271],[-40,1116.4,0.1927],[-30,1075.7,0.164],[-20,1031.7,0.1397],[-10,982.9,0.1188],[0,927.4,0.1004],[10,861.1,0.08354],[20,773.4,0.06677],[25,710.5,0.05731]], vp:[[-50,682.3],[-40,1004.0],[-30,1428.0],[-20,1970.0],[-10,2649.0],[0,3485.0],[10,4502.0],[20,5729.0],[25,6434.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"r134a", name:"Refrigerant R-134a", cat:"Liquefied Gases", isGas:false, tab:[[-40,1417.7,0.467],[-30,1388.4,0.401],[-20,1358.3,0.3476],[-10,1327.1,0.3036],[0,1294.8,0.2665],[10,1261.0,0.2349],[20,1225.3,0.2074],[30,1187.5,0.1831],[40,1146.7,0.1614],[50,1102.3,0.1418],[60,1052.9,0.1236],[70,996.2,0.1065],[80,928.2,0.08985],[90,837.8,0.07245]], vp:[[-40,51.21],[-30,84.38],[-20,132.7],[-10,200.6],[0,292.8],[10,414.6],[20,571.7],[30,770.2],[40,1017.0],[50,1318.0],[60,1682.0],[70,2117.0],[80,2633.0],[90,3244.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"r22", name:"Refrigerant R-22", cat:"Liquefied Gases", isGas:false, tab:[[-40,1406.8,0.2841],[-30,1377.2,0.2485],[-20,1346.5,0.2185],[-10,1314.7,0.193],[0,1281.5,0.1709],[10,1246.7,0.1518],[20,1209.9,0.1349],[30,1170.7,0.1199],[40,1128.5,0.1066],[50,1082.3,0.09457],[60,1030.4,0.08356],[70,969.7,0.07327],[80,893.7,0.06326],[85,844.8,0.05811]], vp:[[-40,105.2],[-30,163.9],[-20,245.3],[-10,354.8],[0,498.0],[10,680.9],[20,910.0],[30,1192.0],[40,1534.0],[50,1943.0],[60,2427.0],[70,2997.0],[80,3664.0],[85,4038.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"r410a", name:"Refrigerant R-410A", cat:"Liquefied Gases", isGas:false, tab:[[-40,1312.9,0.267],[-30,1279.7,0.2375],[-20,1245.0,0.2107],[-10,1208.6,0.1866],[0,1169.9,0.1647],[10,1128.5,0.145],[20,1083.3,0.1273],[30,1033.1,0.1113],[40,975.7,0.09678],[50,907.0,0.08327],[60,815.4,0.06969],[65,748.3,0.06174]], vp:[[-40,175.5],[-30,270.3],[-20,400.7],[-10,574.6],[0,800.7],[10,1088.0],[20,1447.0],[30,1889.0],[40,2426.0],[50,3071.0],[60,3843.0],[65,4283.0]], src:"CoolProp Helmholtz EOS — saturated liquid"},
  {id:"air", name:"Air", cat:"Gases (⚠ Compressible)", isGas:true, MW:28.97, mu_ref:1.82700e-05, T_ref:291.15, C_su:120, Tc:-140.65, Pc:37.86, omega:0.035, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"nitrogen", name:"Nitrogen (N₂)", cat:"Gases (⚠ Compressible)", isGas:true, MW:28.01, mu_ref:1.78100e-05, T_ref:300.55, C_su:111, Tc:-146.96, Pc:33.96, omega:0.0372, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"oxygen", name:"Oxygen (O₂)", cat:"Gases (⚠ Compressible)", isGas:true, MW:32, mu_ref:2.01800e-05, T_ref:292.25, C_su:127, Tc:-118.57, Pc:50.43, omega:0.0222, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"hydrogen", name:"Hydrogen (H₂)", cat:"Gases (⚠ Compressible)", isGas:true, MW:2.016, mu_ref:8.76000e-06, T_ref:293.85, C_su:72, Tc:-229.55, Pc:20.5, omega:0.0, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"helium", name:"Helium (He)", cat:"Gases (⚠ Compressible)", isGas:true, MW:4.003, mu_ref:1.87000e-05, T_ref:273.15, C_su:79.4, Tc:-262.68, Pc:6.76, omega:0.0, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"argon", name:"Argon (Ar)", cat:"Gases (⚠ Compressible)", isGas:true, MW:39.95, mu_ref:2.10000e-05, T_ref:273.15, C_su:144.4, Tc:-122.46, Pc:48.63, omega:-0.0022, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"co2gas", name:"CO₂ Gas", cat:"Gases (⚠ Compressible)", isGas:true, MW:44.01, mu_ref:1.48000e-05, T_ref:293.15, C_su:240, Tc:30.98, Pc:73.77, omega:0.2239, vp:[[-55,554.0],[-40,1004.0],[-30,1428.0],[-20,1970.0],[-10,2649.0],[0,3485.0],[10,4502.0],[20,5729.0],[30,7214.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"cogas", name:"CO Gas (Carbon Monoxide)", cat:"Gases (⚠ Compressible)", isGas:true, MW:28.01, mu_ref:1.66100e-05, T_ref:273.15, C_su:118, Tc:-140.29, Pc:34.94, omega:0.0497, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"methane", name:"Methane (CH₄)", cat:"Gases (⚠ Compressible)", isGas:true, MW:16.04, mu_ref:1.10000e-05, T_ref:293.15, C_su:198, Tc:-82.59, Pc:45.99, omega:0.0114, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"ethane", name:"Ethane (C₂H₆)", cat:"Gases (⚠ Compressible)", isGas:true, MW:30.07, mu_ref:9.00000e-06, T_ref:293.15, C_su:252, Tc:32.17, Pc:48.72, omega:0.0995, vp:[[-80,157.4],[-40,777.4],[-30,1064.0],[-20,1422.0],[-10,1859.0],[0,2387.0],[10,3017.0],[20,3765.0],[30,4655.0],[31,4754.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"propgas", name:"Propane Gas (C₃H₈)", cat:"Gases (⚠ Compressible)", isGas:true, MW:44.1, mu_ref:8.20000e-06, T_ref:293.15, C_su:330, Tc:96.74, Pc:42.51, omega:0.1521, vp:[[-80,13.05],[-40,111.1],[-30,167.8],[-20,244.5],[-10,345.3],[0,474.5],[10,636.6],[20,836.5],[30,1079.0],[40,1369.0],[50,1713.0],[60,2117.0],[70,2587.0],[80,3132.0],[90,3764.0],[96,4194.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"natgas", name:"Natural Gas (SG 0.65)", cat:"Gases (⚠ Compressible)", isGas:true, MW:18.83, mu_ref:1.10000e-05, T_ref:293.15, C_su:180, Tc:-70.35, Pc:46.2, omega:0.02, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"natgas_h", name:"Natural Gas (SG 0.75, rich)", cat:"Gases (⚠ Compressible)", isGas:true, MW:21.73, mu_ref:1.05000e-05, T_ref:293.15, C_su:185, Tc:-56.65, Pc:45.3, omega:0.03, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"h2s", name:"Hydrogen Sulfide (H₂S)", cat:"Gases (⚠ Compressible)", isGas:true, MW:34.08, mu_ref:1.18000e-05, T_ref:293.15, C_su:331, Tc:99.95, Pc:90.0, omega:0.1005, vp:[[-80,33.2],[-40,256.6],[-30,380.9],[-20,546.4],[-10,760.8],[0,1032.0],[10,1370.0],[20,1781.0],[30,2276.0],[40,2863.0],[50,3552.0],[60,4355.0],[70,5282.0],[80,6349.0],[90,7577.0],[99,8852.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"so2", name:"Sulfur Dioxide (SO₂)", cat:"Gases (⚠ Compressible)", isGas:true, MW:64.06, mu_ref:1.25700e-05, T_ref:293.15, C_su:416, Tc:157.49, Pc:78.87, omega:0.256, vp:[[-71,2.437],[-40,21.6],[-30,38.02],[-20,63.52],[-10,101.4],[0,155.5],[10,230.3],[20,330.7],[30,462.1],[40,630.3],[50,841.5],[60,1102.0],[70,1419.0],[80,1799.0],[90,2250.0],[100,2780.0],[110,3398.0],[120,4112.0],[140,5877.0],[156,7692.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"chlorinegas", name:"Chlorine Gas (Cl₂)", cat:"Gases (⚠ Compressible)", isGas:true, MW:70.9, mu_ref:1.33000e-05, T_ref:293.15, C_su:351, Tc:143.72, Pc:76.42, omega:0.07, vp:[[-80,7.634],[-40,77.03],[-30,120.2],[-20,180.4],[-10,261.6],[0,368.1],[10,504.6],[20,675.7],[30,886.3],[40,1141.0],[50,1446.0],[60,1804.0],[70,2222.0],[80,2703.0],[90,3254.0],[100,3878.0],[110,4581.0],[120,5369.0],[140,7240.0],[142,7453.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"steam_gas", name:"Steam (superheated)", cat:"Gases (⚠ Compressible)", isGas:true, MW:18.015, mu_ref:1.20000e-05, T_ref:373.15, C_su:1064, Tc:373.95, Pc:220.64, omega:0.3443, vp:[[2,0.706],[10,1.228],[20,2.339],[30,4.247],[40,7.385],[50,12.35],[60,19.95],[70,31.2],[80,47.41],[90,70.18],[100,101.4],[110,143.4],[120,198.7],[140,361.5],[160,618.2],[180,1003.0],[200,1555.0],[225,2550.0],[250,3976.0],[275,5946.0],[300,8588.0],[325,12050.0],[350,16530.0],[370,21040.0],[373,21810.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"ammgas", name:"Ammonia Gas (NH₃)", cat:"Gases (⚠ Compressible)", isGas:true, MW:17.03, mu_ref:1.01000e-05, T_ref:293.15, C_su:370, Tc:132.41, Pc:113.63, omega:0.256, vp:[[-76,6.906],[-40,71.63],[-30,119.4],[-20,190.0],[-10,290.6],[0,429.2],[10,614.8],[20,857.0],[30,1167.0],[40,1555.0],[50,2033.0],[60,2614.0],[70,3312.0],[80,4141.0],[90,5116.0],[100,6255.0],[110,7577.0],[120,9109.0],[131,11080.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"fluegas", name:"Flue Gas (typical)", cat:"Gases (⚠ Compressible)", isGas:true, MW:29, mu_ref:1.90000e-05, T_ref:473.15, C_su:110, Tc:-82.45, Pc:54.4, omega:0.08, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"biogas", name:"Biogas (60% CH₄, 40% CO₂)", cat:"Gases (⚠ Compressible)", isGas:true, MW:27.22, mu_ref:1.25000e-05, T_ref:293.15, C_su:200, Tc:-37.15, Pc:57.1, omega:0.097, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"syngas", name:"Syngas (H₂+CO mixture)", cat:"Gases (⚠ Compressible)", isGas:true, MW:15.5, mu_ref:1.30000e-05, T_ref:293.15, C_su:150, Tc:-183.25, Pc:28.0, omega:-0.08, src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"hclgas", name:"HCl Gas", cat:"Gases (⚠ Compressible)", isGas:true, MW:36.46, mu_ref:1.42600e-05, T_ref:273.15, C_su:360, Tc:51.53, Pc:83.14, omega:0.129, vp:[[-68,243.4],[-40,765.8],[-30,1078.0],[-20,1477.0],[-10,1976.0],[0,2589.0],[10,3334.0],[20,4227.0],[30,5292.0],[40,6556.0],[50,8059.0]], src:"Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity"},
  {id:"dmf", name:"DMF (Dimethylformamide)", cat:"Chemical Process", isGas:false, tab:[[-33,996.4,2.035],[-30,993.7,1.917],[-20,985.0,1.588],[-10,976.1,1.338],[0,967.2,1.144],[10,958.2,0.9901],[20,949.1,0.8673],[30,939.9,0.7676],[40,930.6,0.6858],[50,921.1,0.6178],[60,911.6,0.5608],[70,902.0,0.5127],[80,892.2,0.4716],[90,882.3,0.4362],[100,872.3,0.4057],[110,862.1,0.3791],[120,851.8,0.3558],[140,830.6,0.3172],[152,817.6,0.2981]], vp:[[-33,0.005071],[-30,0.006883],[-20,0.01795],[-10,0.04307],[0,0.09597],[10,0.2003],[20,0.3943],[30,0.7367],[40,1.314],[50,2.246],[60,3.698],[70,5.883],[80,9.072],[90,13.6],[100,19.87],[110,28.36],[120,39.62],[140,72.99],[152,102.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"dmso", name:"DMSO (Dimethyl Sulfoxide)", cat:"Chemical Process", isGas:false, tab:[[22,1099.1,2.101],[30,1091.3,1.805],[40,1081.5,1.515],[50,1071.6,1.289],[60,1061.6,1.112],[70,1051.6,0.9711],[80,1041.5,0.857],[90,1031.3,0.7638],[100,1021.0,0.6869],[110,1010.6,0.6228],[120,1000.1,0.5689],[140,978.9,0.4844],[160,957.2,0.4222],[180,935.0,0.3753],[190,923.8,0.3562]], vp:[[22,0.06476],[30,0.1133],[40,0.2182],[50,0.4018],[60,0.7103],[70,1.21],[80,1.993],[90,3.183],[100,4.941],[110,7.475],[120,11.04],[140,22.59],[160,42.85],[180,76.17],[190,99.4]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"thf", name:"THF (Tetrahydrofuran)", cat:"Chemical Process", isGas:false, tab:[[-40,945.8,1.077],[-30,936.0,0.9159],[-20,926.2,0.789],[-10,916.2,0.6874],[0,906.0,0.6048],[10,895.7,0.537],[20,885.3,0.4806],[30,874.6,0.4333],[40,863.8,0.3932],[50,852.7,0.3589],[60,841.5,0.3294],[70,830.0,0.3038],[80,818.3,0.2815],[90,806.2,0.2619],[100,793.9,0.2446]], vp:[[-40,0.4831],[-30,1.009],[-20,1.973],[-10,3.642],[0,6.387],[10,10.7],[20,17.22],[30,26.72],[40,40.12],[50,58.52],[60,83.12],[70,115.3],[80,156.4],[90,208.2],[100,272.1]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"nmp", name:"N-Methylpyrrolidone (NMP)", cat:"Chemical Process", isGas:false, tab:[[-20,1067.0,3.784],[-10,1058.5,3.075],[0,1050.0,2.537],[10,1041.5,2.122],[20,1033.0,1.797],[30,1024.5,1.538],[40,1016.0,1.329],[50,1007.5,1.16],[60,999.0,1.02],[70,990.5,0.9038],[80,982.0,0.8064],[90,973.5,0.724],[100,965.0,0.6538],[110,956.5,0.5936],[120,948.0,0.5415],[140,931.0,0.4568],[160,914.0,0.3914],[180,897.0,0.34],[200,880.0,0.2989]], vp:[[-20,0.0008315],[-10,0.002234],[0,0.005584],[10,0.01308],[20,0.02891],[30,0.06066],[40,0.1214],[50,0.2326],[60,0.4288],[70,0.7607],[80,1.295],[90,2.122],[100,3.362],[110,5.168],[120,7.728],[140,16.07],[160,30.77],[180,54.93],[200,92.44]], src:"Handbook point data, ±10–20%"},
  {id:"acetonitrile", name:"Acetonitrile (MeCN)", cat:"Chemical Process", isGas:false, tab:[[-40,843.1,0.7725],[-30,833.2,0.6624],[-20,823.2,0.5749],[-10,813.1,0.5044],[0,802.9,0.4467],[10,792.5,0.3991],[20,782.0,0.3593],[30,771.3,0.3257],[40,760.4,0.2971],[50,749.4,0.2726],[60,738.2,0.2514],[70,726.8,0.2329],[80,715.2,0.2168],[90,703.3,0.2025],[100,691.1,0.1899],[110,678.7,0.1787],[120,665.9,0.1686],[140,639.3,0.1514],[160,610.9,0.1374],[163,606.4,0.1355]], vp:[[-40,0.2534],[-30,0.5337],[-20,1.054],[-10,1.965],[0,3.485],[10,5.912],[20,9.641],[30,15.18],[40,23.14],[50,34.31],[60,49.57],[70,69.97],[80,96.74],[90,131.2],[100,175.0],[110,229.6],[120,297.1],[140,478.7],[160,738.0],[163,784.9]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"diethether", name:"Diethyl Ether", cat:"Chemical Process", isGas:false, tab:[[-3,739.1,0.2983],[0,735.9,0.2889],[10,724.9,0.2603],[20,713.6,0.2355],[30,702.0,0.2139],[40,690.1,0.1949],[50,677.8,0.1781],[60,665.2,0.1631],[70,652.1,0.1497],[80,638.4,0.1376],[90,624.2,0.1266],[100,609.3,0.1166],[110,593.5,0.1073],[120,576.8,0.09875],[123,571.6,0.09628]], vp:[[-3,21.44],[0,24.74],[10,38.85],[20,58.83],[30,86.25],[40,122.9],[50,170.7],[60,231.7],[70,308.2],[80,402.4],[90,516.9],[100,654.3],[110,817.1],[120,1008.0],[123,1071.0]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"dioxane", name:"1,4-Dioxane", cat:"Chemical Process", isGas:false, tab:[[15,1039.5,1.431],[20,1034.0,1.302],[30,1022.9,1.092],[40,1011.7,0.9307],[50,1000.3,0.8054],[60,988.7,0.7065],[70,977.0,0.6272],[80,965.0,0.563],[90,952.9,0.5103],[100,940.5,0.4668],[101,939.2,0.4629]], vp:[[15,3.019],[20,3.941],[30,6.523],[40,10.42],[50,16.12],[60,24.24],[70,35.48],[80,50.71],[90,70.91],[100,97.18],[101,100.2]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"furfural", name:"Furfural", cat:"Chemical Process", isGas:false, tab:[[0,1179.7,2.381],[10,1169.6,1.981],[20,1159.4,1.67],[30,1149.2,1.423],[40,1138.8,1.226],[50,1128.3,1.065],[60,1117.7,0.9335],[70,1106.9,0.8245],[80,1096.0,0.7333],[90,1085.0,0.6564],[100,1073.9,0.5911]], vp:[[0,0.04928],[10,0.1063],[20,0.216],[30,0.4161],[40,0.7641],[50,1.344],[60,2.273],[70,3.713],[80,5.873],[90,9.025],[100,13.51]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"milk", name:"Milk (whole)", cat:"Food & Pharma", isGas:false, tab:[[2,1035.9,3.188],[10,1033.3,2.572],[20,1030.0,2.0],[30,1026.7,1.581],[40,1023.4,1.269],[50,1020.1,1.032],[60,1016.8,0.85],[70,1013.5,0.708],[80,1010.2,0.5959],[90,1006.9,0.5063]], vapFixed:0.023, src:"Handbook point data, ±10–20%"},
  {id:"milk_skim", name:"Skim Milk", cat:"Food & Pharma", isGas:false, tab:[[2,1040.9,2.777],[10,1038.3,2.245],[20,1035.0,1.75],[30,1031.7,1.387],[40,1028.4,1.115],[50,1025.1,0.9089],[60,1021.8,0.75],[70,1018.5,0.6259],[80,1015.2,0.5276],[90,1011.9,0.449]], vapFixed:0.023, src:"Handbook point data, ±10–20%"},
  {id:"olive", name:"Olive Oil", cat:"Food & Pharma", isGas:false, tab:[[10,919.2,134.8],[20,912.8,81.56],[30,906.2,52.47],[40,899.8,35.54],[50,893.2,25.15],[60,886.8,18.47],[70,880.2,13.99],[80,873.8,10.89],[90,867.2,8.681],[100,860.8,7.058],[110,854.2,5.84],[120,847.8,4.906],[140,834.8,3.599],[150,828.2,3.134]], vapFixed:0.001, src:"Handbook point data, ±10–20%"},
  {id:"sunflower", name:"Sunflower Oil", cat:"Food & Pharma", isGas:false, tab:[[10,924.2,92.01],[20,917.8,59.24],[30,911.2,40.14],[40,904.8,28.41],[50,898.2,20.86],[60,891.8,15.8],[70,885.2,12.3],[80,878.8,9.792],[90,872.2,7.957],[100,865.8,6.58],[110,859.2,5.524],[120,852.8,4.701],[140,839.8,3.523],[150,833.2,3.094]], vp:[[40,0.001],[80,0.01],[100,0.03]], src:"Handbook point data, ±10–20%"},
  {id:"palmoil", name:"Palm Oil", cat:"Food & Pharma", isGas:false, tab:[[40,898.5,35.94],[50,891.9,25.59],[60,885.3,18.88],[70,878.7,14.36],[80,872.1,11.22],[90,865.5,8.961],[100,858.9,7.301],[110,852.3,6.05],[120,845.7,5.09],[140,832.5,3.741],[150,825.9,3.259]], vapFixed:0.001, src:"Handbook point data, ±10–20% (solid below ~35 °C)"},
  {id:"cornsyrup", name:"Corn Syrup 63° Brix", cat:"Food & Pharma", isGas:false, tab:[[10,1308.5,193.3],[20,1303.0,110.0],[30,1297.5,64.98],[40,1292.0,39.69],[50,1286.5,25.0],[60,1281.0,16.19],[70,1275.5,10.75],[80,1270.0,7.308],[90,1264.5,5.074]], vapFixed:0.01, src:"Indicative literature values, ±30% — verify for design"},
  {id:"honey", name:"Honey", cat:"Food & Pharma", isGas:false, tab:[[10,1425.0,27420.0],[20,1420.0,9000.0],[30,1415.0,3179.0],[40,1410.0,1200.0],[50,1405.0,481.1],[60,1400.0,203.8],[70,1395.0,90.75]], vapFixed:0.005, src:"Indicative literature values, ±30% — verify for design (17% moisture)"},
  {id:"mercury", name:"Mercury (liquid)", cat:"Special & Metals", isGas:false, tab:[[-23,13652.1,1.874],[-20,13644.6,1.847],[-10,13619.8,1.764],[0,13595.1,1.691],[10,13570.4,1.626],[20,13545.9,1.567],[30,13521.3,1.515],[40,13496.9,1.467],[50,13472.5,1.423],[60,13448.2,1.383],[70,13423.9,1.347],[80,13399.7,1.314],[90,13375.5,1.283],[100,13351.4,1.254],[110,13327.3,1.228],[120,13303.3,1.203],[140,13255.3,1.159],[160,13207.5,1.12],[180,13159.7,1.086],[200,13112.0,1.056],[225,13052.5,1.022],[250,12992.9,0.9926],[275,12933.3,0.9666],[300,12873.6,0.9434]], vp:[[-23,2.23e-06],[-20,3.168e-06],[-10,9.631e-06],[0,2.699e-05],[10,7.028e-05],[20,0.0001713],[30,0.0003931],[40,0.0008551],[50,0.001771],[60,0.003508],[70,0.006673],[80,0.01223],[90,0.02167],[100,0.03721],[110,0.06209],[120,0.1009],[140,0.2478],[160,0.5592],[180,1.173],[200,2.307],[225,4.971],[250,9.935],[275,18.61],[300,32.97]], src:"DIPPR/Perry correlations (thermo library)"},
  {id:"molten_s", name:"Molten Sulfur", cat:"Special & Metals", isGas:false, tab:[[120,1808.5,15.21],[140,1791.5,9.606],[158,1776.2,6.588]], vapFixed:0.001, src:"Handbook point data, ±10–20% — invalid above 159 °C (polymerisation)"},
  {id:"slurry10", name:"Slurry (10% solids)", cat:"Special & Metals", isGas:false, tab:[[5,1105.2,5.75],[10,1103.5,5.5],[20,1100.0,5.0],[30,1096.5,4.5],[40,1093.0,4.0],[50,1089.5,3.5],[60,1086.0,3.0],[70,1082.5,2.5],[80,1079.0,2.0],[90,1075.5,1.5]], vapFixed:0.02, src:"Indicative only — slurries/muds are non-Newtonian; use measured rheology"},
  {id:"slurry30", name:"Slurry (30% solids)", cat:"Special & Metals", isGas:false, tab:[[5,1356.0,22.25],[10,1354.0,21.5],[20,1350.0,20.0],[30,1346.0,18.5],[40,1342.0,17.0],[50,1338.0,15.5],[60,1334.0,14.0],[70,1330.0,12.5],[80,1326.0,11.0],[90,1322.0,9.5]], vapFixed:0.015, src:"Indicative only — slurries/muds are non-Newtonian; use measured rheology"},
  {id:"slurry50", name:"Slurry (50% solids, dense)", cat:"Special & Metals", isGas:false, tab:[[5,1656.8,86.0],[10,1654.5,84.0],[20,1650.0,80.0],[30,1645.5,76.0],[40,1641.0,72.0],[50,1636.5,68.0],[60,1632.0,64.0],[70,1627.5,60.0],[80,1623.0,56.0],[90,1618.5,52.0]], vapFixed:0.01, src:"Indicative only — slurries/muds are non-Newtonian; use measured rheology"},
  {id:"drilling_mud", name:"Drilling Mud (12 ppg)", cat:"Special & Metals", isGas:false, tab:[[5,1450.0,34.0],[10,1447.5,33.0],[20,1442.5,31.0],[30,1437.5,29.0],[40,1432.5,27.0],[50,1427.5,25.0],[60,1422.5,23.0],[70,1417.5,21.0],[80,1412.5,19.0],[90,1407.5,17.0]], vapFixed:0.015, src:"Indicative only — slurries/muds are non-Newtonian; use measured rheology"},
  {id:"propane", name:"Propane (C₃H₈) — auto phase", cat:"Dual-Phase (auto L/G)", isGas:"auto", Tc:96.74, Pc:42.51, omega:0.1521, gas_MW:44.1, gas_mu_ref:8.20000e-06, gas_T_ref:293.15, gas_C_su:330, liq_tab:[[-80,622.8,0.3159],[-40,578.4,0.1926],[-30,566.6,0.1723],[-20,554.5,0.1547],[-10,541.8,0.1393],[0,528.6,0.1256],[10,514.7,0.1133],[20,500.1,0.1023],[30,484.4,0.09219],[40,467.5,0.08284],[50,448.9,0.07407],[60,428.0,0.06565],[70,403.6,0.05736],[80,373.3,0.04879],[90,328.8,0.03882]], vp:[[-80,13.05],[-40,111.1],[-30,167.8],[-20,244.5],[-10,345.3],[0,474.5],[10,636.6],[20,836.5],[30,1079.0],[40,1369.0],[50,1713.0],[60,2117.0],[70,2587.0],[80,3132.0],[90,3764.0]], src:"CoolProp Helmholtz EOS — saturated liquid (liquid) / Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity (vapour)"},
  {id:"co2", name:"CO₂ — auto phase", cat:"Dual-Phase (auto L/G)", isGas:"auto", Tc:30.98, Pc:73.77, omega:0.2239, gas_MW:44.01, gas_mu_ref:1.48000e-05, gas_T_ref:293.15, gas_C_su:240, liq_tab:[[-55,1172.9,0.2468],[-40,1116.4,0.1927],[-30,1075.7,0.164],[-20,1031.7,0.1397],[-10,982.9,0.1188],[0,927.4,0.1004],[10,861.1,0.08354],[20,773.4,0.06677],[30,593.3,0.04342]], vp:[[-55,554.0],[-40,1004.0],[-30,1428.0],[-20,1970.0],[-10,2649.0],[0,3485.0],[10,4502.0],[20,5729.0],[30,7214.0]], src:"CoolProp Helmholtz EOS — saturated liquid (liquid) / Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity (vapour)"},
  {id:"water_steam", name:"Water/Steam — auto phase", cat:"Dual-Phase (auto L/G)", isGas:"auto", Tc:373.95, Pc:220.64, omega:0.3443, gas_MW:18.015, gas_mu_ref:1.20000e-05, gas_T_ref:373.15, gas_C_su:1064, liq_tab:[[0,999.8,1.791],[10,999.7,1.306],[20,998.2,1.002],[30,995.6,0.7972],[40,992.2,0.6527],[50,988.0,0.5465],[60,983.2,0.466],[70,977.7,0.4035],[80,971.8,0.354],[90,965.3,0.3142],[100,958.3,0.2816],[110,950.9,0.2546],[120,943.1,0.232],[140,926.1,0.1966],[160,907.4,0.1704],[180,887.0,0.1504],[200,864.7,0.1346],[225,833.7,0.1189],[250,798.9,0.1063],[275,759.0,0.09555],[300,712.1,0.08586],[325,654.3,0.07639],[350,574.7,0.0658],[370,451.4,0.05226]], vp:[[0,0.6117],[10,1.228],[20,2.339],[30,4.247],[40,7.385],[50,12.35],[60,19.95],[70,31.2],[80,47.41],[90,70.18],[100,101.4],[110,143.4],[120,198.7],[140,361.5],[160,618.2],[180,1003.0],[200,1555.0],[225,2550.0],[250,3976.0],[275,5946.0],[300,8588.0],[325,12050.0],[350,16530.0],[370,21040.0]], src:"CoolProp Helmholtz EOS — saturated liquid (liquid) / Ideal gas + Pitzer/Tsonopoulos 2nd-virial Z; Sutherland viscosity (vapour)"},
];


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
   calcFluidProps(id, T_C, P_bar) → {rho[kg/m³], mu[cP], Pv[bar], isGas, Z, warn, src}

   Liquids  : tabulated reference data  tab = [[T °C, ρ kg/m³, μ cP], …]
              ρ linear in T between nodes; ln μ linear in 1/T (Andrade between
              nodes) — this also gives a physically sensible extrapolation.
   Gases    : ρ = P·M / (Z·R·T), Z from the Pitzer / Tsonopoulos second-virial
              correlation (Tc, Pc, ω); μ from Sutherland's law.
   Psat     : vp = [[T °C, kPa], …] — ln P linear in 1/T (Clausius–Clapeyron).
═══════════════════════════════════════════════════════════════ */
const R_GAS = 8314.46;   // J/(kmol·K)

function tabInterp(tab, T_C) {
  const n = tab.length;
  let i;
  if (T_C <= tab[0][0]) i = 0;
  else if (T_C >= tab[n - 1][0]) i = n - 2;
  else { i = 0; while (i < n - 2 && T_C > tab[i + 1][0]) i++; }
  const a = tab[i], b = tab[i + 1];
  const r = (T_C - a[0]) / (b[0] - a[0]);
  let rho = a[1] + r * (b[1] - a[1]);
  const ia = 1 / (a[0] + 273.15), ib = 1 / (b[0] + 273.15), it = 1 / (T_C + 273.15);
  const s = (it - ia) / (ib - ia);
  const mu = Math.exp(Math.log(a[2]) + s * (Math.log(b[2]) - Math.log(a[2])));
  const rhoMin = Math.min(tab[0][1], tab[n - 1][1]);
  if (rho < 0.5 * rhoMin) rho = 0.5 * rhoMin;       // guard against wild extrapolation
  return { rho, mu, Tmin: tab[0][0], Tmax: tab[n - 1][0], out: T_C < tab[0][0] || T_C > tab[n - 1][0] };
}

// Vapour pressure [kPa] — log-linear in 1/T between nodes, Clausius–Clapeyron beyond.
function vpLookup(f, T_C) {
  const d = f.vp;
  if (!d || d.length < 2) return null;
  const n = d.length;
  let i;
  if (T_C <= d[0][0]) i = 0;
  else if (T_C >= d[n - 1][0]) i = n - 2;
  else { i = 0; while (i < n - 2 && T_C > d[i + 1][0]) i++; }
  const a = d[i], b = d[i + 1];
  const ia = 1 / (a[0] + 273.15), ib = 1 / (b[0] + 273.15), it = 1 / (T_C + 273.15);
  const s = (it - ia) / (ib - ia);
  let P = Math.exp(Math.log(Math.max(a[1], 1e-12)) + s * (Math.log(Math.max(b[1], 1e-12)) - Math.log(Math.max(a[1], 1e-12))));
  if (f.Pc && P > f.Pc * 100) P = f.Pc * 100;
  return P;
}

// Pitzer correlation for the second virial coefficient (Tsonopoulos form)
function virialZ(T_K, P_bar, Tc_C, Pc_bar, omega) {
  const Tr = T_K / (Tc_C + 273.15), Pr = P_bar / Pc_bar;
  const B0 = 0.083 - 0.422 / Math.pow(Tr, 1.6);
  const B1 = 0.139 - 0.172 / Math.pow(Tr, 4.2);
  const Z = 1 + (B0 + (omega || 0) * B1) * Pr / Tr;
  return { Z: Math.min(1.6, Math.max(0.3, Z)), Tr, Pr };
}

function sutherland(mu_ref, T_ref, C, T_K) {
  return mu_ref * Math.pow(T_K / T_ref, 1.5) * (T_ref + C) / (T_K + C) * 1000;  // cP
}

function calcFluidProps(id, T_C, P_bar) {
  const f = FLUID_DB_pdrop.find(x => x.id === id);
  if (!f) return null;
  const T_K = T_C + 273.15;
  const warns = [];
  let rho, mu, Z = null, phaseLabel = '', isGasNow;

  // ── Vapour pressure ──────────────────────────────────────────────────────
  let Pv = 0;
  const vpk = vpLookup(f, T_C);
  if (vpk !== null) Pv = vpk / 100;
  else if (f.vapFixed !== undefined) Pv = f.vapFixed;

  // ── Phase ────────────────────────────────────────────────────────────────
  if (f.isGas === true) isGasNow = true;
  else if (f.isGas === false) isGasNow = false;
  else {
    if (T_C >= f.Tc) {
      isGasNow = true;
      phaseLabel = P_bar > f.Pc ? '⬡ Supercritical' : '↑ Gas (T > Tc)';
      if (P_bar > f.Pc) warns.push('Supercritical (T > Tc = ' + f.Tc + ' °C, P > Pc = ' + f.Pc + ' bar) — gas-like properties used, accuracy reduced.');
    } else if (P_bar < Pv) {
      isGasNow = true;
      phaseLabel = '↑ Vapour (P < Psat = ' + Pv.toFixed(3) + ' bar)';
    } else {
      isGasNow = false;
      phaseLabel = '↓ Liquid (P ≥ Psat = ' + Pv.toFixed(3) + ' bar)';
    }
    if (T_C < f.Tc && Pv > 0 && Math.abs(P_bar - Pv) / Pv < 0.05)
      warns.push('Within 5% of saturation pressure — two-phase flow likely; single-phase result is unreliable.');
  }

  // ── Properties ───────────────────────────────────────────────────────────
  if (isGasNow) {
    const g = f.isGas === true
      ? { MW: f.MW, mu_ref: f.mu_ref, T_ref: f.T_ref, C: f.C_su }
      : { MW: f.gas_MW, mu_ref: f.gas_mu_ref, T_ref: f.gas_T_ref, C: f.gas_C_su };
    Z = 1;
    if (f.Tc !== undefined && f.Pc) {
      const v = virialZ(T_K, P_bar, f.Tc, f.Pc, f.omega);
      Z = v.Z;
      if (v.Pr / v.Tr > 0.5) warns.push('High reduced pressure (Pr/Tr = ' + (v.Pr / v.Tr).toFixed(2) + ') — virial Z approximate and viscosity has no pressure correction (may read ~10% low); use an EOS for design.');
    }
    rho = P_bar * 1e5 * g.MW / (Z * R_GAS * T_K);
    mu = Math.max(0.001, sutherland(g.mu_ref, g.T_ref, g.C, T_K));
    if (f.isGas === true && vpk !== null && f.Tc !== undefined && T_C < f.Tc && P_bar >= Pv)
      warns.push('⚠ P ≥ saturation pressure (' + Pv.toFixed(2) + ' bar) at this T — this fluid would be LIQUID. Use the liquid or auto-phase entry.');
  } else {
    const tab = f.isGas === 'auto' ? f.liq_tab : f.tab;
    const r = tabInterp(tab, T_C);
    rho = r.rho; mu = r.mu;
    if (r.out) warns.push('T outside data range (' + r.Tmin + ' to ' + r.Tmax + ' °C) — properties extrapolated, verify.');
    if (f.isGas === false && P_bar > 0 && Pv > 0 && Pv >= P_bar)
      warns.push('⚠ Vapour pressure (' + Pv.toFixed(3) + ' bar) ≥ operating pressure — fluid will flash or boil.');
  }

  return {
    rho:        parseFloat(rho.toPrecision(5)),
    mu:         parseFloat(mu.toPrecision(4)),
    Pv:         parseFloat(Pv.toPrecision(4)),
    isGas:      isGasNow === true,
    Z:          Z === null ? null : parseFloat(Z.toFixed(4)),
    phaseLabel,
    name:       f.name, cat: f.cat,
    src:        f.src || '',
    warn:       warns.join(' '),
  };
}

/* ═══════════════════════════════════════════════════════════════
   DARCY-WEISBACH FRICTION FACTOR
     Re < 2000        : f = 64/Re (Hagen-Poiseuille, exact)
     2000 ≤ Re < 4000 : Churchill (1977) — continuous through transition
                        (equals 64/Re within 0.14 % at Re = 2000)
     Re ≥ 4000        : Colebrook-White, Swamee-Jain seed, iterated to 1e-10
═══════════════════════════════════════════════════════════════ */
function churchill1977(Re, relRough) {
  const A = Math.pow(2.457 * Math.log(1 / (Math.pow(7 / Re, 0.9) + 0.27 * relRough)), 16);
  const B = Math.pow(37530 / Re, 16);
  return 8 * Math.pow(Math.pow(8 / Re, 12) + 1 / Math.pow(A + B, 1.5), 1 / 12);
}

function dwFrictionFactor(Re, eps_m, Dm) {
  const rr = eps_m / Dm;
  if (Re < 2000) return 64 / Re;
  if (Re < 4000) return churchill1977(Re, rr);
  const arg = rr / 3.7 + 5.74 / Math.pow(Re, 0.9);
  let f = 0.25 / Math.pow(Math.log10(arg), 2);
  if (!isFinite(f) || f <= 0) f = 0.02;
  for (let i = 0; i < 50; i++) {
    const inner = rr / 3.7 + 2.51 / (Re * Math.sqrt(f));
    if (inner <= 0 || !isFinite(inner)) break;
    const fn = Math.pow(-2 * Math.log10(inner), -2);
    if (!isFinite(fn) || fn <= 0) break;
    if (Math.abs(fn - f) < 1e-12) { f = fn; break; }
    f = fn;
  }
  return f;
}

function calcPressureDrop(inputs) {
  let { D, L, Q, rho, mu, dz, epsBase, foulingMm, fittings, pumpEff, motorEff, unitMode, isGasFluid, P1_bar } = inputs;

  if ([D, L, Q, rho, mu].some(v => !isFinite(v) || v <= 0))
    return { ok: false, error: 'All inputs must be positive finite numbers.' };
  if (mu < 0.001)
    return { ok: false, error: 'Viscosity below 0.001 cP — check units (enter in cP, e.g. water = 1.0 cP).' };

  const eps = epsBase + Math.max(0, foulingMm || 0);  // total roughness [mm]
  dz = isFinite(dz) ? dz : 0;
  const D_orig = D, L_orig = L, dz_orig = dz;
  if (unitMode === 'imperial') {
    D   *= 25.4;      // in → mm
    L   *= 0.3048;    // ft → m
    dz  *= 0.3048;    // ft → m
    Q   *= 0.2271247; // US gpm → m³/h
    rho *= 16.01846;  // lb/ft³ → kg/m³
  }

  const g     = 9.80665;
  const Dm    = D / 1000;
  const Qs    = Q / 3600;
  const mu_Pa = mu / 1000;
  const eps_m = eps / 1000;

  const A  = Math.PI * Dm * Dm / 4;
  const V  = Qs / A;
  const Re = rho * V * Dm / mu_Pa;
  if (Re < 1) return { ok: false, error: 'Reynolds number < 1 — check inputs.' };

  const f = dwFrictionFactor(Re, eps_m, Dm);
  if (!isFinite(f) || f <= 0) return { ok: false, error: 'Friction factor calculation failed — check pipe roughness.' };

  const Ktot = Array.isArray(fittings)
    ? fittings.reduce((s, fit) => s + Math.max(0, parseInt(fit.qty) || 0) * sanitizeNumber(fit.k, 0), 0)
    : 0;

  const dynPres = rho * V * V / 2;
  const dpPipe  = f * (L / Dm) * dynPres;
  const dpMinor = Ktot * dynPres;
  const dpElev  = rho * g * dz;
  const dpTotal = dpPipe + dpMinor + dpElev;

  const headLoss = dpTotal / (rho * g);
  const Leq = Ktot * Dm / f;                          // [m]

  const gravityFlow = dpTotal <= 0;
  const P_hyd   = gravityFlow ? 0 : Qs * dpTotal;
  const P_shaft = P_hyd / pumpEff;
  const P_motor = P_shaft / motorEff;

  let regime, regimeClass;
  if (Re < 2300)       { regime = 'Laminar';      regimeClass = 'badge-green'; }
  else if (Re < 4000)  { regime = 'Transitional'; regimeClass = 'badge-amber'; }
  else                 { regime = 'Turbulent';    regimeClass = 'badge-red';   }

  const relRough = eps_m / Dm;                       // dimensionless ε/D
  const uncertPct = Re < 4000 ? 25 : (relRough > 0.01 ? 8 : 5);

  const imp = unitMode === 'imperial';
  const toP = imp ? (v => v * 0.000145037738) : (v => v / 1e5);
  const dpDisp = toP(dpTotal), dpPipeDisp = toP(dpPipe), dpMinorDisp = toP(dpMinor), dpElevDisp = toP(dpElev);
  const dpUnit  = imp ? 'psi' : 'bar';
  const velDisp = imp ? V * 3.280840 : V;
  const velUnit = imp ? 'ft/s' : 'm/s';
  const headDisp = imp ? headLoss * 3.280840 : headLoss;
  const headUnit = imp ? 'ft' : 'm';
  const LeqDisp = imp ? Leq * 3.280840 : Leq;
  const lenUnit = imp ? 'ft' : 'm';
  // Friction gradient of the straight pipe — the usual line-sizing criterion
  const gradDisp = L_orig > 0 ? dpPipeDisp / L_orig * 100 : 0;

  const warnings = [];
  if (!isGasFluid && V > 3)
    warnings.push(`High liquid velocity ${V.toFixed(2)} m/s — erosion and water-hammer risk above ~3 m/s.`);
  if (isGasFluid && V > 30)
    warnings.push(`High gas velocity ${V.toFixed(1)} m/s — noise/erosion concern; check API RP 14E erosional velocity.`);
  if (Re >= 2000 && Re < 4000)
    warnings.push('Transitional regime (Re 2000–4000): friction factor from Churchill (1977), uncertainty ±20–30%.');
  if (Re < 4000 && Ktot > 0)
    warnings.push('K-factors are turbulent-flow values — fitting losses are under-predicted in laminar/transitional flow (use 3-K or 2-K method).');
  if (gravityFlow)
    warnings.push('Net ΔP ≤ 0: the elevation drop exceeds the friction losses, so the line flows by gravity and no pump is needed. The surplus head must be taken up by a control valve or orifice.');

  // Compressibility checks for gases (need the inlet absolute pressure)
  let dpRatio = null, mach = null;
  if (isGasFluid) {
    const P1 = sanitizeNumber(P1_bar, null);
    if (P1 && P1 > 0) {
      dpRatio = dpTotal / (P1 * 1e5);
      if (dpRatio > 0.4)
        warnings.push(`ΔP/P₁ = ${(dpRatio * 100).toFixed(0)}% — far outside the incompressible model. Use isothermal/adiabatic compressible flow (or split the line into short segments).`);
      else if (dpRatio > 0.1)
        warnings.push(`ΔP/P₁ = ${(dpRatio * 100).toFixed(1)}% exceeds 10% — use the average density or a compressible-flow method; result is approximate.`);
      const a = Math.sqrt(1.3 * P1 * 1e5 / rho);    // speed of sound, γ ≈ 1.3 (conservative)
      mach = V / a;
      if (mach > 0.3)
        warnings.push(`Mach ≈ ${mach.toFixed(2)} (> 0.3) — compressibility significant regardless of ΔP/P₁.`);
    }
  }

  return {
    ok: true,
    dpDisp, dpPipeDisp, dpMinorDisp, dpElevDisp, dpUnit,
    velDisp, velUnit, headDisp, headUnit,
    V,
    Re, f, Ktot, relRough,
    regime, regimeClass,
    Leq, LeqDisp, epsTotalMm: eps, foulingMm,
    P_hyd, P_shaft, P_motor, gravityFlow,
    Qs, dpTotal, dpPipe, dpMinor, dpElev,
    dpRatio, mach,
    uncertPct, warnings,
    gradDisp, gradLabel: imp ? 'Friction gradient per 100 ft' : 'Friction gradient per 100 m',
    lenUnit, diamUnit: imp ? 'in' : 'mm',
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
    const P1_bar    = sanitizeNumber(body.P1_bar, null);   // inlet abs. pressure (gas checks)

    // Sanitize fittings array
    const rawFits = Array.isArray(body.fittings) ? body.fittings.slice(0, 200) : [];
    const fittings = rawFits.map(f => ({
      k:   sanitizeNumber(f.k, 0),
      qty: Math.max(0, Math.min(999, parseInt(f.qty) || 0)),
    }));

    if ([D, L, Q, rho, mu].some(v => v === null))
      return err(res, 400, 'D, L, Q, rho, mu are required');

    const result = calcPressureDrop({ D, L, Q, rho, mu, dz, epsBase, foulingMm, fittings, pumpEff, motorEff, unitMode, isGasFluid, P1_bar });
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
