// ═══════════════════════════════════════════════════════════════════════════
// HEATXPERT PRO — VALIDATION SUITE (v1.0, 2026-07)
//
// Run:  node validation-suite.mjs [path-to-heat-exchanger.js]
//
// PHILOSOPHY — three honest tiers, no invented reference numbers:
//   TIER 1  Analytic identities   — results the correlations MUST satisfy
//                                    exactly (energy closure, LMTD algebra,
//                                    limiting behaviour). Tolerance ≤0.5%.
//   TIER 2  Hand-derivable spots  — independent re-computation of published
//                                    correlations (Gnielinski, Dittus-Boelter,
//                                    Nusselt film, Cooper, Connors) from their
//                                    literature equations, evaluated here in
//                                    the test itself. Tolerance ≤2%.
//   TIER 3  External benchmarks   — HTRI / vendor / plant data cases. The
//                                    harness is ready; PASTE your reference
//                                    values into EXTERNAL_CASES below. Empty
//                                    entries are reported as SKIPPED, never
//                                    faked.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';

const SRC = process.argv[2] || './heat-exchanger.js';
let src = fs.readFileSync(SRC, 'utf8')
  .replace(/export default async function handler/, 'async function handler')
  .replace(/export const config/, 'const config');
src += `\nexport { calcShellTube, calcPlate, calcDoublePipe, calcAirCooled, calcFinFan,
  calcLmtdNtu, calcWallThickness, calcBellDelaware, calcBellDelawareDP, bdLeakGeometry,
  calcVibrationScreen, calcHtube, calcHcondense, calcHboiling, calcF_crossflow, calcF_1_2,
  calcLMTD, fluidAtConditions, toSI_flowWithUnit, FP, initCoolProp, calcCooperNB, calcHboilingGW, calcHcondenseBundle, satTemperature, hvapAtT };`;
// Write the harness module NEXT TO the source so node_modules (CoolProp) resolves
const tmp = path.join(path.dirname(path.resolve(SRC)), `_hxval_${Date.now()}.mjs`);
fs.writeFileSync(tmp, src);
const m = await import(tmp);
try { fs.unlinkSync(tmp); } catch {}
await m.initCoolProp();   // NIST engine if installed; suite passes either way

let nPass = 0, nFail = 0, nSkip = 0;
const rows = [];
function check(tier, name, got, exp, tolPct, note = '') {
  const dev = exp === 0 ? Math.abs(got) : Math.abs(got - exp) / Math.abs(exp) * 100;
  const ok = dev <= tolPct;
  ok ? nPass++ : nFail++;
  rows.push({ tier, name, got: +(+got).toPrecision(5), exp: +(+exp).toPrecision(5),
              dev: +dev.toFixed(2), tol: tolPct, status: ok ? 'PASS' : 'FAIL', note });
}
function skip(tier, name, note) { nSkip++; rows.push({ tier, name, got: '—', exp: '—', dev: '—', tol: '—', status: 'SKIP', note }); }

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — ANALYTIC IDENTITIES
// ─────────────────────────────────────────────────────────────────────────────
{ // 1.1 Energy balance closure, single phase S&T
  const r = m.calcShellTube({hFlKey:'water',cFlKey:'water',hTi:90,hTo:60,cTi:30,hF:20000,
    coldMode:'flow',cF:30000,OD:19.05,tw:2.11,L:4.88,pitch:1.25,mat:'cs',hxType:'1-2',tema:'C',
    bcut:0.25,bsp:0.5,velMode:'target',targetVel:1.5});
  check(1,'S&T energy closure Qh vs Qc', r.Qc, r.Qh, 0.5, 'Qh must equal Qc after cTo convergence');
  check(1,'S&T Q=U_eff·A·FLMTD identity', r.U_effective*r.area*r.FLMTD/1000, r.Q, 0.5, 'definition of required area');
}
{ // 1.2 LMTD equal-ΔT limit: dT1=dT2 → LMTD = dT
  const r = m.calcLMTD(80,60,40,60,'counter');   // dT1=dT2=20
  check(1,'LMTD equal-terminal limit', r.lmtd, 20, 0.1, 'balanced counterflow');
}
{ // 1.3 Counterflow F=1 always
  const r = m.calcLMTD(90,50,30,70,'counter');
  check(1,'Counterflow F = 1', r.F, 1.0, 0.01);
}
{ // 1.4 Crossflow F → 1 as P → 0 (vanishing duty)
  const r = m.calcF_crossflow(1.0, 0.02);
  check(1,'Crossflow F→1 at small P', r.F, 1.0, 2.0);
}
{ // 1.5 Crossflow F self-consistency: NTU from F must reproduce P via ε-NTU
  const R=0.8, P=0.55, r=m.calcF_crossflow(R,P);
  const NTU_cf = Math.log((1-R*P)/(1-P))/(1-R);          // counterflow NTU for (P,R)
  const NTU_x  = NTU_cf/r.F;                             // implied crossflow NTU
  const eps = 1-Math.exp((Math.exp(-R*Math.pow(NTU_x,0.78))-1)*Math.pow(NTU_x,0.22)/R);
  check(1,'Crossflow F inversion round-trip', eps, P, 1.0, 'ε(NTU implied by F) must return P');
}
{ // 1.6 Plate energy closure with dissimilar fluids (the Bug-#1 regression guard)
  const r = m.calcPlate({hFlKey:'water',cFlKey:'thermal-oil',hTi:90,hTo:60,cTi:30,hF:10000,
    coldMode:'flow',cF:20000,th:0.5,angle:45,gap:3,pw:400,plen:1200,phi:1.17,mat:'ss316'});
  const cpOil = m.fluidAtConditions('thermal-oil',(30+r.cTo)/2,1.013).cp;
  check(1,'Plate cold ΔT uses COLD cp', r.cTo-30, r.Qhot/((20000/3600)*cpOil), 0.5,
    'guards against hot-cp regression (audit Bug #1)');
}
{ // 1.7 Condenser zone areas must sum to reported area; zone Q must sum to duty
  const r = m.calcShellTube({hFlKey:'steam',cFlKey:'water',hTi:140,hTo:95,cTi:30,hF:2000,
    coldMode:'flow',cF:60000,hPop:2.7,cPop:3,OD:19.05,tw:2.11,L:4.88,pitch:1.25,mat:'cs',
    hxType:'1-2',tema:'C',bcut:0.25,bsp:0.5,velMode:'target',targetVel:1.5,shellMode:'condensing'});
  const sumA = r.zoneModel.zones.reduce((s,z)=>s+z.A_m2,0);
  const sumQ = r.zoneModel.zones.reduce((s,z)=>s+z.Q_kW,0);
  check(1,'Condenser ΣA_zone = A_req', sumA, r.area, 0.5);
  check(1,'Condenser ΣQ_zone = Q', sumQ, r.Q, 1.0);
}
{ // 1.8 Nm³/Sm³ definitions (exact ideal-gas algebra)
  const rho_n_exp = 16.04*1.01325e5/(8314*273.15);   // methane at 0°C, 1 atm
  const rho_s_exp = 16.04*1.01325e5/(8314*288.15);   // 15°C
  check(1,'Nm³ density basis 273.15 K', m.toSI_flowWithUnit(1,'nm3h','methane'), rho_n_exp, 0.1);
  check(1,'Sm³ density basis 288.15 K', m.toSI_flowWithUnit(1,'sm3h','methane'), rho_s_exp, 0.1);
}
{ // 1.9 Laminar tube-flow floor: Nu → 3.66 (constant-Tw asymptote) at low Gz
  const f = m.fluidAtConditions('water',40,2);
  const r = m.calcHtube(f, 0.002, 0.016, 12);  // Re≈245, long tube → Gz small
  check(1,'Laminar Nu floor 3.66', r.Nu, 3.66, 1.0);
}
{ // 1.10 Vibration: fn scales as 1/span² (pinned-pinned identity)
  const base = {matKey:'cs',OD:0.01905,Di:0.01483,shellID:0.5,pitch_ratio:1.25,
    massH_kgs:5,rhoShell:998,muShell_mPas:0.6,rhoTubeFluid:998,isGas:false,T_K:330,MW:18};
  const f1 = m.calcVibrationScreen({...base, span_m:0.5}).f_n;
  const f2 = m.calcVibrationScreen({...base, span_m:1.0}).f_n;
  check(1,'f_n ∝ 1/L² identity', f1/f2, 4.0, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2 — HAND-DERIVABLE SPOT CHECKS (independent recomputation, in-test)
// ─────────────────────────────────────────────────────────────────────────────
{ // 2.1 Gnielinski, water Re≈5e4 — recompute from the 1976 equation directly
  const f = m.fluidAtConditions('water',50,3);       // rho 988, mu 0.547, cp 4.182, k 0.644
  const Di=0.016, mdot = 5e4 * (f.mu*1e-3) * Math.PI*Di/4;   // sets Re exactly 5e4
  const r = m.calcHtube(f, mdot, Di, 5);
  const Re=5e4, Pr=(f.mu*1e-3)*(f.cp*1000)/f.k;
  const fg=Math.pow(0.790*Math.log(Re)-1.64,-2);
  const NuG=(fg/8)*(Re-1000)*Pr/(1+12.7*Math.sqrt(fg/8)*(Math.pow(Pr,2/3)-1));
  check(2,'Gnielinski Nu, Re=5e4 water', r.Nu, Math.max(NuG,0.023*Math.pow(Re,0.8)*Math.pow(Pr,0.4)), 1.0);
}
{ // 2.2 Nusselt horizontal film condensation — literature Eq, steam props at 1 atm
  const liq={rho:960,mu:0.282,k:0.680,hvap:2257,Tsat:100};
  const got = m.calcHcondense(liq, 90, 0.01905, 4.88, 'horizontal');
  const exp = 0.725*Math.pow((960*960*9.81*2257e3*Math.pow(0.680,3))/(0.282e-3*10*0.01905),0.25);
  check(2,'Nusselt film h, steam/10K/19mm', got, Math.min(Math.max(exp,500),25000), 1.0);
}
{ // 2.4 Chen limiting behaviour: h_tp must be ≥ h_L and increase with quality
  const liq = m.fluidAtConditions('ammonia-liquid',-10,4);
  const vap = m.fluidAtConditions('ammonia-gas',-10,4);
  const h1 = m.calcHboiling(liq, 2000, 2e4, 0.10, vap, 4, 20000);
  const h2 = m.calcHboiling(liq, 2000, 2e4, 0.60, vap, 4, 20000);
  check(2,'Chen h_tp ≥ h_L', Math.min(h1,h2) >= 2000 ? 1 : 0, 1, 0, 'floor identity');
  check(2,'Chen h_tp rises with x', h2 > h1 ? 1 : 0, 1, 0, 'F(Xtt) monotonicity');
}
{ // 2.5 Bell-Delaware Jc at 25% cut ≈ 0.55+0.72·Fc with Fc from window geometry
  const g = m.bdLeakGeometry(0.489,0.01905,1.25,0.25,0.5,158,'fixed');
  const Fc = 1-2*g.F_w;
  const bd = m.calcBellDelaware(m.fluidAtConditions('water',75,3), 5.56, 0.489, 0.01905, 1.25, 0.25, 0.5, 4.88, 158);
  check(2,'Jc = 0.55+0.72·Fc (25% cut)', bd.Jc, 0.55+0.72*Fc, 0.5);
  check(2,'Jl within published band 0.7-0.95', (bd.Jl>=0.7&&bd.Jl<=0.95)?1:0, 1, 0,
    `Jl=${bd.Jl.toFixed(3)} — HEDH typical for well-built bundles`);
}
{ // 2.6 Connors critical velocity — recompute from the screening equation
  const p={matKey:'cs',OD:0.01905,Di:0.01483,span_m:0.6,shellID:0.5,pitch_ratio:1.25,
    massH_kgs:5,rhoShell:998,muShell_mPas:0.6,rhoTubeFluid:998,isGas:false,T_K:330,MW:18};
  const v=m.calcVibrationScreen(p);
  const exp = 3.0*v.f_n*p.OD*Math.sqrt(0.10*v.m_L/(998*p.OD*p.OD));
  check(2,'Connors V_crit recomputation', v.V_crit, exp, 1.0);
}
{ // 2.7 Peng-Robinson sanity: CO2 at 100 bar, 320 K → Z well below 1
  const f = m.fluidAtConditions('co2',46.85,100);
  check(2,'PR Z(CO2,100 bar) < 0.6', f.Z < 0.6 ? 1 : 0, 1, 0, `Z=${f.Z.toFixed(3)} — dense-phase CO2`);
}

// ── v7 additions ─────────────────────────────────────────────────────────────
{ // 2.8 Cooper (1984) — now directly exposed, checked against the literature Eq
  const got = m.calcCooperNB(0.0352, 17.03, 20000);   // NH3 at 4 bar
  const exp = 55*Math.pow(0.0352,0.12)*Math.pow(-Math.log10(0.0352),-0.55)*Math.pow(17.03,-0.5)*Math.pow(20000,0.67);
  check(2,'Cooper h_nb literature Eq (NH3)', got, exp, 0.5);
}
{ // 2.9 Gungor-Winterton — E and S recomputed from the 1986 equations
  const liq = m.fluidAtConditions('ammonia-liquid',-1.9,4), vap = m.fluidAtConditions('ammonia-gas',-1.9,4);
  const G=300, D=0.0148, x=0.4, q=30000;
  const r = m.calcHboilingGW(liq, vap, x, G, D, q, 4, 'vertical'); // vertical → no Fr term
  const mu_l=liq.mu*1e-3, mu_g=vap.mu*1e-3;
  const Xtt=Math.pow((1-x)/x,0.9)*Math.pow(vap.rho/liq.rho,0.5)*Math.pow(mu_l/mu_g,0.1);
  const Bo=q/(G*(liq.hvap||1268)*1000);
  const E_exp=1+24000*Math.pow(Bo,1.16)+1.37*Math.pow(1/Xtt,0.86);
  check(2,'G-W enhancement E (NH3, x=0.4)', r.E, E_exp, 1.0);
  const S_exp=1/(1+1.15e-6*E_exp*E_exp*Math.pow(G*(1-x)*D/mu_l,1.17));
  check(2,'G-W suppression S (NH3, x=0.4)', r.S, S_exp, 1.5);
}
{ // 2.10 G-W dryout blend engages above x=0.85 and is flagged
  const liq = m.fluidAtConditions('ammonia-liquid',-1.9,4), vap = m.fluidAtConditions('ammonia-gas',-1.9,4);
  const r = m.calcHboilingGW(liq, vap, 0.93, 300, 0.0148, 30000, 4, 'vertical');
  check(2,'G-W post-dryout blend flagged', r.dryoutBlend?1:0, 1, 0);
}
{ // 2.11 Bundle condensation: Kern N^(-1/6) at zero shear; shear raises h
  const liq={rho:960,mu:0.282,k:0.680,hvap:2174,Tsat:130,MW:18.02,Pc:220.6};
  const vap={rho:1.5,mu:0.0135};
  const noShear = m.calcHcondenseBundle(liq,vap,0.5,0.001,0.01905,10,1,120,4.88);
  const h1 = m.calcHcondense(liq,120,0.01905,4.88,'horizontal');
  check(2,'Kern inundation h_bundle=h₁·N^(−1/6)', noShear.h_grav, h1*Math.pow(10,-1/6), 1.0);
  const withShear = m.calcHcondenseBundle(liq,vap,0.5,80,0.01905,10,3000,120,4.88);
  check(2,'McNaught shear raises combined h', withShear.h > noShear.h ? 1:0, 1, 0,
    `Jg*=${withShear.Jg} regime=${withShear.regime}`);
}
{ // 2.12 Antoine fallback: steam Tsat at 2.7 bar ≈ 130°C (steam tables)
  const t = m.satTemperature('steam', 2.7);
  if (t == null) skip(2,'Antoine Tsat(steam, 2.7 bar)','no Antoine coefficients for this key');
  else check(2,'Antoine Tsat(steam, 2.7 bar)', t, 129.98, 1.5, 'vs steam tables');
}
{ // 2.13 CoolProp NIST anchors (skips gracefully when package absent)
  const w = m.fluidAtConditions('water', 25, 1.01325);
  if (w._src !== 'coolprop') skip(2,'CoolProp NIST anchors','coolprop-wasm not installed — fallback DB active (this is a supported mode)');
  else {
    check(2,'CoolProp ρ water 25°C (NIST 997.05)', w.rho, 997.05, 0.05);
    check(2,'CoolProp cp water 25°C (NIST 4.1813)', w.cp, 4.1813, 0.05);
    const s = m.fluidAtConditions('steam', 135, 2.7);
    check(2,'CoolProp Tsat steam 2.7 bar (129.98)', s.Tsat, 129.98, 0.1);
    const n = m.fluidAtConditions('ammonia-liquid', -5, 4.0);
    check(2,'CoolProp Tsat NH3 4 bar (−1.87)', n.Tsat, -1.87, 1.0);
  }
}
{ // 2.14 TEMA RCB-4.52 span-limit anchors (exact table values)
  const v19 = m.calcVibrationScreen({matKey:'cs',OD:0.01905,Di:0.01483,span_m:0.5,shellID:0.5,
    pitch_ratio:1.25,massH_kgs:5,rhoShell:998,muShell_mPas:0.6,rhoTubeFluid:998,isGas:false,T_K:330,MW:18});
  check(2,'TEMA span limit OD 19.05 → 1524 mm', v19.temaSpanLimit_m, 1.524, 0.5);
  const v25 = m.calcVibrationScreen({matKey:'cs',OD:0.0254,Di:0.02,span_m:0.5,shellID:0.5,
    pitch_ratio:1.25,massH_kgs:5,rhoShell:998,muShell_mPas:0.6,rhoTubeFluid:998,isGas:false,T_K:330,MW:18});
  check(2,'TEMA span limit OD 25.4 → 1880 mm', v25.temaSpanLimit_m, 1.880, 0.5);
}
{ // 2.15 Window tubes: span 2× → f_n exactly ÷4, and worst span is the window
  const v = m.calcVibrationScreen({matKey:'cs',OD:0.01905,Di:0.01483,span_m:0.4,shellID:0.5,
    pitch_ratio:1.25,massH_kgs:5,rhoShell:998,muShell_mPas:0.6,rhoTubeFluid:998,isGas:false,T_K:330,MW:18});
  const cen=v.spans.find(s=>s.name==='central'), win=v.spans.find(s=>s.name==='window tubes');
  check(2,'Window-tube f_n = central/4', cen.f_n/win.f_n, 4.0, 1.0);
  check(2,'Worst FEI span = window tubes', v.worstSpan==='window tubes'?1:0, 1, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3 — EXTERNAL BENCHMARKS  (paste HTRI / vendor / plant values here)
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO USE: for each real case you have an HTRI Xist run or a vendor
// datasheet for, fill `inputs` with the HeatXpert payload and `expect` with
// the reference {U, area, shellDP, tubeDp} plus a tolerance. Deviations are
// then tracked release-over-release. DO NOT fill expect with guesses.
const EXTERNAL_CASES = [
  { name: 'IFFCO Kalol CW cooler (HTRI ref)',    inputs: null, expect: null, tol: 15 },
  { name: 'NH3 chiller vendor datasheet',        inputs: null, expect: null, tol: 20 },
  { name: 'Steam surface condenser (plant data)',inputs: null, expect: null, tol: 20 },
];
for (const c of EXTERNAL_CASES) {
  if (!c.inputs || !c.expect) { skip(3, c.name, 'reference values not yet supplied — paste HTRI/vendor data'); continue; }
  const r = m.calcShellTube(c.inputs);
  if (c.expect.U      != null) check(3, `${c.name} — U`,      r.U_effective, c.expect.U,      c.tol);
  if (c.expect.area   != null) check(3, `${c.name} — area`,   r.area,        c.expect.area,   c.tol);
  if (c.expect.shellDP!= null) check(3, `${c.name} — shellΔP`,r.shellDP,     c.expect.shellDP,c.tol);
  if (c.expect.tubeDp != null) check(3, `${c.name} — tubeΔP`, r.tubeDp,      c.expect.tubeDp, c.tol);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nHEATXPERT VALIDATION REPORT —', new Date().toISOString().slice(0,10));
console.log('─'.repeat(100));
console.log('T | ' + 'Check'.padEnd(44) + ' | ' + 'Got'.padStart(11) + ' | ' + 'Expected'.padStart(11) + ' | Dev%  | Status');
console.log('─'.repeat(100));
for (const r of rows) {
  console.log(`${r.tier} | ${String(r.name).padEnd(44)} | ${String(r.got).padStart(11)} | ${String(r.exp).padStart(11)} | ${String(r.dev).padStart(5)} | ${r.status}${r.note?'  · '+r.note:''}`);
}
console.log('─'.repeat(100));
console.log(`PASS ${nPass}  FAIL ${nFail}  SKIP ${nSkip}`);
process.exit(nFail > 0 ? 1 : 0);
