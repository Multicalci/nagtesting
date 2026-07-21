// ============================================================================
// REPO PATH: api/_lib/fluids.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2)
// CANONICAL MASTER FLUID LIBRARY — hydraulic + VLE-support layer.
//
// MERGED FROM (both inside process-calculators.js, Jul 2026 build):
//   [O] FLUID_DB_orifice  (SECTION C, ISO 5167 calculator)  ~55 entries
//       gases: M, Tc [K], Pc [MPa], omega, mu [Pa·s]; liquids: rho0/Tb.
//   [P] FLUID_DB_pdrop    (SECTION D, pressure-drop calc)   142 entries
//       liquids: rho0 [kg/m3 @ Tref °C], Antoine Pv_A/B/C
//       (log10 mmHg, T °C), Andrade viscosity; gases: MW, Sutherland.
//   NOTE: the control-valve 73-fluid library named in the build playbook
//   was NOT present in the attached file (Section A holds no database —
//   it references keys resolved elsewhere). This merge therefore uses
//   [O] + [P]. Fields neither source carries (CAS, formula, Tm, liquid
//   criticals, missing Antoine sets) are filled from public handbook /
//   NIST-class knowledge and tagged data_quality accordingly.
//   Re-run the merge if the control-valve library file surfaces.
//
// ---------------------------------------------------------------------------
// UNIT CONVENTION (normalized — document of record):
//   antoine  : log10(P_mmHg) = A − B/(C + T_°C), validity tmin_c..tmax_c [°C]
//              Source [P] was ALREADY in this base (confirmed by the NH3
//              record's own comment "log10(Pv/mmHg) = A − B/(C + T°C)" and
//              by boiling-point identity checks: every retained set gives
//              ≈760 mmHg at Tb). Source [O]'s three liquefied-gas sets were
//              also mmHg/°C. NO kPa/K conversions were required; sets that
//              FAILED the 760-mmHg-at-Tb identity were corrected from
//              handbook values and are itemized in the MERGE AUDIT.
//   mw       : g/mol            tb_K, tm_K, tc_K : K       pc_bar : bar
//              ([O] gases carried Pc in MPa → converted ×10 to bar, e.g.
//               air 3.77 MPa → 37.7 bar; NH3 11.28 MPa → 112.8 bar.
//               [P] dual-phase records carried Tc in °C → converted +273.15,
//               e.g. NH3 132.25 °C → 405.4 K, agreeing with [O] 405.6 K.)
//   rho_liq_kgm3 : liquid density at 20 °C unless the inline comment says
//              otherwise (petroleum cuts at 15 °C per [O]/[P] convention).
//   mu_cp    : viscosity in cP. Liquids at 20 °C unless the inline comment
//              states another T (lube oils quoted at 40 °C = ISO VG basis).
//              Gases at ~0–25 °C, converted from [O] mu [Pa·s] ×1000.
//   dhvap_tb_kjmol : PLACEHOLDER (null) — caloric layer lands in Step 5
//              (mb-data.js). Until then psat_bar() falls back to a Trouton
//              estimate (ΔHvap ≈ 0.088·Tb kJ/mol) outside Antoine range.
//   Caloric fields (Hf, Shomate, dhfus) are intentionally ABSENT (Step 5).
//
// RECORD SHAPE (every fluid):
//   { key, name, formula, cas, mw, tb_K, tm_K, tc_K, pc_bar, omega,
//     antoine:{A,B,C,tmin_c,tmax_c}|null, rho_liq_kgm3, mu_cp,
//     dhvap_tb_kjmol, nonvolatile, data_quality, category }
//   null = not applicable or not yet sourced. Pseudo-fluids (fuels, cuts,
//   solutions, foods) carry formula:null, cas:null and pseudo:true.
//   data_quality: 'nist' | 'handbook' | 'estimated' (per spec §5).
//
// Dependency-free. Plain ES2020 / CommonJS. (c) multicalci.com
// ============================================================================

'use strict';

const MMHG_TO_BAR = 0.001333224; // 1 mmHg = 0.001333224 bar (exact enough)
const R_KJ = 0.008314462;        // kJ/(mol·K)
const TROUTON_KJ_PER_MOLK = 0.088; // Trouton: dHvap(Tb) ≈ 0.088·Tb kJ/mol

// ---------------------------------------------------------------------------
// helper — compact record builder (fills defaults, keeps literals short)
// ---------------------------------------------------------------------------
function F(o) {
  return Object.assign({
    key: null, name: null, formula: null, cas: null, mw: null,
    tb_K: null, tm_K: null, tc_K: null, pc_bar: null, omega: null,
    antoine: null, rho_liq_kgm3: null, mu_cp: null,
    dhvap_tb_kjmol: null,          // Step-5 placeholder
    nonvolatile: false, pseudo: false,
    data_quality: 'handbook', category: 'other',
  }, o);
}
/** antoine shorthand */
function ANT(A, B, C, tmin_c, tmax_c) { return { A, B, C, tmin_c, tmax_c }; }

// ===========================================================================
// FLUIDS — the canonical library
// ===========================================================================
const FLUIDS = {

// ── GASES (criticals from [O], Pc MPa→bar; mu from [O] Pa·s→cP) ────────────
H2O: F({ key:'H2O', name:'Water', formula:'H2O', cas:'7732-18-5', mw:18.015,
  tb_K:373.15, tm_K:273.15, tc_K:647.10, pc_bar:220.64, omega:0.344,
  // [P] water Pv set; identity: 100 °C → 760.1 mmHg = 1.0134 bar ✓
  antoine:ANT(8.07131,1730.63,233.426,1,100), rho_liq_kgm3:998, mu_cp:1.00,
  data_quality:'nist', category:'water',
  // NOTE: mb-engine routes ALL water/steam enthalpy through if97.js;
  // this Antoine is for phase screening / flash K-values only.
}),
air: F({ key:'air', name:'Air', formula:null, cas:null, mw:28.964, pseudo:true,
  tb_K:78.8, tm_K:null, tc_K:132.5, pc_bar:37.7, omega:0.035, // [O] 3.77 MPa
  mu_cp:0.0182, data_quality:'handbook', category:'gas' }),
N2: F({ key:'N2', name:'Nitrogen', formula:'N2', cas:'7727-37-9', mw:28.014,
  tb_K:77.36, tm_K:63.15, tc_K:126.2, pc_bar:33.9, omega:0.037, // [O] (Pc 3.39 MPa)
  mu_cp:0.0176, data_quality:'nist', category:'gas' }),
O2: F({ key:'O2', name:'Oxygen', formula:'O2', cas:'7782-44-7', mw:32.000,
  tb_K:90.19, tm_K:54.36, tc_K:154.6, pc_bar:50.4, omega:0.025,
  mu_cp:0.0201, data_quality:'nist', category:'gas' }),
H2: F({ key:'H2', name:'Hydrogen', formula:'H2', cas:'1333-74-0', mw:2.016,
  tb_K:20.28, tm_K:13.99, tc_K:33.2, pc_bar:13.0, omega:-0.216, // true criticals;
  // eos.js substitutes quantum effective constants automatically by key
  mu_cp:0.0089, data_quality:'nist', category:'gas' }),
He: F({ key:'He', name:'Helium', formula:'He', cas:'7440-59-7', mw:4.003,
  tb_K:4.22, tm_K:null, tc_K:5.2, pc_bar:2.3, omega:-0.390, // no Tm at 1 atm
  mu_cp:0.0199, data_quality:'nist', category:'gas' }),
Ar: F({ key:'Ar', name:'Argon', formula:'Ar', cas:'7440-37-1', mw:39.948,
  tb_K:87.30, tm_K:83.81, tc_K:150.9, pc_bar:48.7, omega:0.001,
  mu_cp:0.0227, data_quality:'nist', category:'gas' }),
CO: F({ key:'CO', name:'Carbon monoxide', formula:'CO', cas:'630-08-0', mw:28.010,
  tb_K:81.65, tm_K:68.13, tc_K:132.9, pc_bar:35.0, omega:0.048,
  mu_cp:0.0177, data_quality:'nist', category:'gas' }),
CO2: F({ key:'CO2', name:'Carbon dioxide', formula:'CO2', cas:'124-38-9', mw:44.010,
  // [O] Tc 304.1 K / 7.38 MPa and [P] 31.04 °C / 73.77 bar AGREE → 304.1 / 73.8
  tb_K:194.69, tm_K:216.59, tc_K:304.1, pc_bar:73.8, omega:0.239,
  // tb_K = 1-atm SUBLIMATION point (no liquid at 1 atm); tm_K = triple point.
  // Liquid-branch Antoine (−56..31 °C, subcritical liquid CO2):
  antoine:ANT(7.5322,835.06,268.223,-57,31), // handbook set
  rho_liq_kgm3:773, // [P] co2_liq (saturated liquid, ~−20 °C — NOT 20 °C)
  mu_cp:0.0148, data_quality:'handbook', category:'gas' }),
CH4: F({ key:'CH4', name:'Methane', formula:'CH4', cas:'74-82-8', mw:16.043,
  tb_K:111.66, tm_K:90.69, tc_K:190.6, pc_bar:46.0, omega:0.012,
  mu_cp:0.0110, data_quality:'nist', category:'gas' }),
C2H6: F({ key:'C2H6', name:'Ethane', formula:'C2H6', cas:'74-84-0', mw:30.069,
  tb_K:184.55, tm_K:90.36, tc_K:305.3, pc_bar:48.7, omega:0.099,
  mu_cp:0.0091, data_quality:'nist', category:'gas' }),
C2H4: F({ key:'C2H4', name:'Ethylene', formula:'C2H4', cas:'74-85-1', mw:28.054,
  tb_K:169.42, tm_K:104.00, tc_K:282.4, pc_bar:50.4, omega:0.089,
  mu_cp:0.0102, data_quality:'nist', category:'gas' }),
C2H2: F({ key:'C2H2', name:'Acetylene', formula:'C2H2', cas:'74-86-2', mw:26.038,
  tb_K:189.2, tm_K:192.35, tc_K:308.3, pc_bar:61.4, omega:0.187,
  // tb_K = sublimation point at 1 atm; tm_K = triple point (above it!)
  mu_cp:0.0103, data_quality:'handbook', category:'gas' }),
C3H8: F({ key:'C3H8', name:'Propane', formula:'C3H8', cas:'74-98-6', mw:44.097,
  // Criticals: [O] 369.8 K / 4.25 MPa; [P] 96.68 °C / 42.48 bar → agree; 369.8/42.5.
  tb_K:231.05, tm_K:85.47, tc_K:369.8, pc_bar:42.5, omega:0.152,
  // Antoine CHOICE: [O] liquid A=6.80338 vs [P] A=6.82973 (same B,C).
  // Identity at Tb −42.1 °C: [O] → 760 mmHg ✓, [P] → 807 mmHg (+6%).
  // KEPT [O] (Lange-classic set). See MERGE AUDIT #A2.
  antoine:ANT(6.80338,803.810,246.99,-108,-25),
  rho_liq_kgm3:493, // [P] propane_liq at 20 °C (sat.); [O] 500 folded
  mu_cp:0.0082, data_quality:'handbook', category:'gas' }),
nC4H10: F({ key:'nC4H10', name:'n-Butane', formula:'C4H10', cas:'106-97-8', mw:58.124,
  tb_K:272.65, tm_K:134.87, tc_K:425.1, pc_bar:38.0, omega:0.200,
  // [O] liquid Antoine; identity at Tb −0.5 °C → 759.6 mmHg ✓
  antoine:ANT(6.80896,935.860,238.73,-77,19),
  rho_liq_kgm3:580, // [P] butane_liq 20 °C sat.; [O] 579 agrees
  mu_cp:0.0074, data_quality:'handbook', category:'gas' }),
NH3: F({ key:'NH3', name:'Ammonia', formula:'NH3', cas:'7664-41-7', mw:17.031,
  // Criticals: [O] 405.6 K / 11.28 MPa; [P] 132.25 °C / 112.8 bar → agree.
  tb_K:239.82, tm_K:195.42, tc_K:405.6, pc_bar:112.8, omega:0.250,
  // Antoine CHOICE: [P] auto-phase set (documented range −83..133 °C,
  // identity at Tb → 760.3 mmHg ✓) over [O] liquid set 7.36050/926.132/240.17
  // (also fine at Tb, but no stated range). See MERGE AUDIT #A1.
  antoine:ANT(7.596673,1028.083,251.369,-83,132),
  rho_liq_kgm3:610, // [O] 20 °C sat. liquid ([P] 682 is at −33 °C — noted)
  mu_cp:0.0100, data_quality:'handbook', category:'gas' }),
H2S: F({ key:'H2S', name:'Hydrogen sulfide', formula:'H2S', cas:'7783-06-4', mw:34.081,
  tb_K:212.85, tm_K:187.7, tc_K:373.2, pc_bar:89.4, omega:0.100,
  antoine:ANT(6.99392,768.13,249.09,-83,-43), // handbook (added; neither source had it)
  mu_cp:0.0122, data_quality:'handbook', category:'gas' }),
SO2: F({ key:'SO2', name:'Sulfur dioxide', formula:'SO2', cas:'7446-09-5', mw:64.065,
  tb_K:263.10, tm_K:197.7, tc_K:430.8, pc_bar:78.8, omega:0.245,
  antoine:ANT(7.28228,999.90,237.19,-77,-10), // handbook (added)
  mu_cp:0.0125, data_quality:'handbook', category:'gas' }),
Cl2: F({ key:'Cl2', name:'Chlorine', formula:'Cl2', cas:'7782-50-5', mw:70.906,
  tb_K:239.11, tm_K:172.2, tc_K:417.2, pc_bar:77.1, omega:0.069,
  antoine:ANT(6.93790,861.34,246.33,-85,-30), // handbook (added)
  mu_cp:0.0133, data_quality:'handbook', category:'gas' }),
HCl: F({ key:'HCl', name:'Hydrogen chloride (anhydrous)', formula:'HCl',
  cas:'7647-01-0', mw:36.461,
  tb_K:188.15, tm_K:158.9, tc_K:324.7, pc_bar:83.1, omega:0.12, // handbook
  mu_cp:0.0143, data_quality:'estimated', category:'gas',
  // TODO(Step 5 / NIST pass): verify Tc/Pc/omega; Antoine deliberately
  // omitted (estimated sets for HCl scatter badly) — CC fallback used.
}),

// ── GAS PSEUDO-MIXTURES ────────────────────────────────────────────────────
natural_gas: F({ key:'natural_gas', name:'Natural gas (lean, SG≈0.62)', pseudo:true,
  mw:17.967, tc_K:203.3, pc_bar:46.4, omega:0.010, // [O]; [P] natgas SG 0.65 folded
  mu_cp:0.0110, data_quality:'estimated', category:'gas' }),
natural_gas_rich: F({ key:'natural_gas_rich', name:'Natural gas (rich, SG≈0.75)',
  pseudo:true, mw:21.73, tc_K:225, pc_bar:46, omega:0.03, // [P]; criticals estimated
  mu_cp:0.0110, data_quality:'estimated', category:'gas' }),
flue_gas: F({ key:'flue_gas', name:'Flue gas (typical)', pseudo:true, mw:28.964,
  tc_K:132.5, pc_bar:37.7, omega:0.035, mu_cp:0.0190, // [O] (air-like); [P] MW 29.0 agrees
  data_quality:'estimated', category:'gas' }),
syngas_3h2_n2: F({ key:'syngas_3h2_n2', name:'Syngas 3H2:N2 (NH3 make-up)', pseudo:true,
  mw:8.525, tc_K:56.5, pc_bar:18.2, omega:-0.150, mu_cp:0.0137, // [O]
  data_quality:'estimated', category:'gas' }),
syngas_h2_co: F({ key:'syngas_h2_co', name:'Syngas H2+CO (~2:1)', pseudo:true,
  mw:15.50, tc_K:90, pc_bar:25, omega:-0.08, mu_cp:0.0130, // [P] MW; criticals estimated
  data_quality:'estimated', category:'gas' }),
biogas_60ch4: F({ key:'biogas_60ch4', name:'Biogas (60% CH4 / 40% CO2)', pseudo:true,
  mw:27.230, tc_K:236.0, pc_bar:57.1, omega:0.100, mu_cp:0.0129, // [O]; [P] MW 27.22 agrees
  data_quality:'estimated', category:'gas' }),
lpg: F({ key:'lpg', name:'LPG (propane/butane mix)', pseudo:true,
  mw:49.708, tc_K:391.9, pc_bar:40.7, omega:0.170, // [O] vapor record
  rho_liq_kgm3:530, mu_cp:0.0078, // liquid rho from [P] lpg; gas mu from [O]
  data_quality:'estimated', category:'gas' }),

// ── REFRIGERANTS ([P]; criticals added, handbook) ──────────────────────────
r134a: F({ key:'r134a', name:'R-134a (1,1,1,2-tetrafluoroethane)', formula:'C2H2F4',
  cas:'811-97-2', mw:102.03, tb_K:247.08, tm_K:172.0, tc_K:374.2, pc_bar:40.6,
  omega:0.327, rho_liq_kgm3:1206, mu_cp:0.21, category:'refrigerant' }),
r22: F({ key:'r22', name:'R-22 (chlorodifluoromethane)', formula:'CHClF2',
  cas:'75-45-6', mw:86.47, tb_K:232.3, tm_K:115.7, tc_K:369.3, pc_bar:49.9,
  omega:0.221, rho_liq_kgm3:1194, mu_cp:0.20, category:'refrigerant' }),
r410a: F({ key:'r410a', name:'R-410A (R32/R125 blend)', pseudo:true, mw:72.6,
  tb_K:221.7, tc_K:344.5, pc_bar:49.0, omega:0.30, rho_liq_kgm3:1062, mu_cp:0.16,
  data_quality:'estimated', category:'refrigerant' }),

// ── ALIPHATIC HYDROCARBON LIQUIDS ([P] Antoine + rho; criticals added) ─────
nC6H14: F({ key:'nC6H14', name:'n-Hexane', formula:'C6H14', cas:'110-54-3', mw:86.177,
  tb_K:341.88, tm_K:177.83, tc_K:507.6, pc_bar:30.2, omega:0.301,
  antoine:ANT(6.87601,1171.17,224.408,-25,92), rho_liq_kgm3:659, mu_cp:0.31,
  data_quality:'nist', category:'aliphatic' }),
nC7H16: F({ key:'nC7H16', name:'n-Heptane', formula:'C7H16', cas:'142-82-5', mw:100.204,
  tb_K:371.57, tm_K:182.57, tc_K:540.2, pc_bar:27.4, omega:0.350,
  antoine:ANT(6.89385,1264.13,216.640,-2,124), rho_liq_kgm3:684, mu_cp:0.41,
  data_quality:'nist', category:'aliphatic' }),
nC8H18: F({ key:'nC8H18', name:'n-Octane', formula:'C8H18', cas:'111-65-9', mw:114.231,
  tb_K:398.82, tm_K:216.38, tc_K:568.7, pc_bar:24.9, omega:0.398,
  antoine:ANT(6.91868,1351.99,209.155,19,152), rho_liq_kgm3:703, mu_cp:0.54,
  data_quality:'nist', category:'aliphatic' }),
cyclohexane: F({ key:'cyclohexane', name:'Cyclohexane', formula:'C6H12',
  cas:'110-82-7', mw:84.161, tb_K:353.87, tm_K:279.62, tc_K:553.6, pc_bar:40.7,
  omega:0.212, antoine:ANT(6.84498,1203.526,222.863,7,81), rho_liq_kgm3:779,
  mu_cp:0.98, data_quality:'nist', category:'aliphatic' }),
isooctane: F({ key:'isooctane', name:'Isooctane (2,2,4-trimethylpentane)',
  formula:'C8H18', cas:'540-84-1', mw:114.231,
  tb_K:372.39, tm_K:165.78, tc_K:543.9, pc_bar:25.7, omega:0.303,
  antoine:ANT(6.81189,1257.84,220.74,-15,125), // handbook (added; [P] had none)
  rho_liq_kgm3:692, mu_cp:0.50, category:'aliphatic' }),

// ── AROMATICS ([P] Antoine + rho; criticals added) ─────────────────────────
benzene: F({ key:'benzene', name:'Benzene', formula:'C6H6', cas:'71-43-2', mw:78.114,
  tb_K:353.24, tm_K:278.68, tc_K:562.0, pc_bar:48.9, omega:0.210,
  antoine:ANT(6.90565,1211.033,220.790,8,103), rho_liq_kgm3:879, mu_cp:0.65,
  data_quality:'nist', category:'aromatic' }),
toluene: F({ key:'toluene', name:'Toluene', formula:'C7H8', cas:'108-88-3', mw:92.141,
  tb_K:383.78, tm_K:178.18, tc_K:591.8, pc_bar:41.1, omega:0.263,
  antoine:ANT(6.95464,1344.800,219.482,6,137), rho_liq_kgm3:867, mu_cp:0.59,
  data_quality:'nist', category:'aromatic' }),
xylene_mixed: F({ key:'xylene_mixed', name:'Xylene (mixed isomers)', pseudo:true,
  formula:'C8H10', cas:'1330-20-7', mw:106.167,
  tb_K:412, tm_K:225, tc_K:617, pc_bar:35.4, omega:0.320,
  antoine:ANT(6.99052,1453.430,215.307,28,166), rho_liq_kgm3:864, mu_cp:0.62,
  data_quality:'handbook', category:'aromatic' }),
oxylene: F({ key:'oxylene', name:'o-Xylene', formula:'C8H10', cas:'95-47-6', mw:106.167,
  tb_K:417.58, tm_K:247.98, tc_K:630.3, pc_bar:37.3, omega:0.312,
  antoine:ANT(6.99891,1474.679,213.686,32,172), rho_liq_kgm3:880, mu_cp:0.81,
  data_quality:'nist', category:'aromatic' }),
styrene: F({ key:'styrene', name:'Styrene', formula:'C8H8', cas:'100-42-5', mw:104.150,
  tb_K:418.31, tm_K:242.54, tc_K:636.0, pc_bar:38.4, omega:0.297,
  // MERGE AUDIT #C5: [P] set 7.14016/1574.51/218.38 gives 644 mmHg at Tb
  // (−15%). Replaced with handbook set (identity → 759 mmHg ✓):
  antoine:ANT(6.95711,1445.58,209.43,30,145), rho_liq_kgm3:906, mu_cp:0.70,
  category:'aromatic' }),
cumene: F({ key:'cumene', name:'Cumene (isopropylbenzene)', formula:'C9H12',
  cas:'98-82-8', mw:120.194, tb_K:425.56, tm_K:177.14, tc_K:631.0, pc_bar:32.1,
  omega:0.326, antoine:ANT(6.93666,1460.793,207.78,39,181), // handbook (added)
  rho_liq_kgm3:862, mu_cp:0.74, category:'aromatic' }),

// ── ALCOHOLS & POLYOLS ─────────────────────────────────────────────────────
MeOH: F({ key:'MeOH', name:'Methanol', formula:'CH4O', cas:'67-56-1', mw:32.042,
  tb_K:337.85, tm_K:175.47, tc_K:512.6, pc_bar:80.9, omega:0.565,
  antoine:ANT(7.89750,1474.08,229.13,-14,65), // [P] 7.8974 → std 5-digit 7.89750
  rho_liq_kgm3:792, mu_cp:0.59, data_quality:'nist', category:'alcohol' }),
EtOH: F({ key:'EtOH', name:'Ethanol (absolute)', formula:'C2H6O', cas:'64-17-5',
  mw:46.069, tb_K:351.44, tm_K:159.0, tc_K:513.9, pc_bar:61.4, omega:0.645,
  antoine:ANT(8.11220,1592.864,226.184,-2,100), rho_liq_kgm3:785, mu_cp:1.20,
  data_quality:'nist', category:'alcohol' }),
ethanol_96: F({ key:'ethanol_96', name:'Ethanol 96% (azeotropic)', pseudo:true,
  mw:44.6, tb_K:351.3, rho_liq_kgm3:789, mu_cp:1.4,
  // [P] gave it the pure-EtOH Antoine — kept for screening but flagged:
  antoine:ANT(8.11220,1592.864,226.184,-2,100),
  data_quality:'estimated', category:'alcohol' }),
iPrOH: F({ key:'iPrOH', name:'Isopropanol (IPA)', formula:'C3H8O', cas:'67-63-0',
  mw:60.096, tb_K:355.41, tm_K:184.65, tc_K:508.3, pc_bar:47.6, omega:0.665,
  antoine:ANT(8.11780,1580.92,219.61,0,101), rho_liq_kgm3:786, mu_cp:2.43,
  data_quality:'nist', category:'alcohol' }),
nBuOH: F({ key:'nBuOH', name:'n-Butanol', formula:'C4H10O', cas:'71-36-3', mw:74.123,
  tb_K:390.88, tm_K:183.85, tc_K:563.0, pc_bar:44.2, omega:0.590,
  antoine:ANT(7.83660,1558.19,196.88,15,131), rho_liq_kgm3:810, mu_cp:2.95,
  data_quality:'nist', category:'alcohol' }),
glycerol: F({ key:'glycerol', name:'Glycerol', formula:'C3H8O3', cas:'56-81-5',
  mw:92.094, tb_K:563.2, tm_K:291.33, tc_K:850, pc_bar:75, omega:0.51,
  rho_liq_kgm3:1261, mu_cp:1412, // criticals estimated; Antoine null → CC/Trouton
  data_quality:'estimated', category:'alcohol',
  // TODO(NIST pass): glycerol Tc/Pc are extrapolations; verify before 'handbook'.
}),
glycerol_50: F({ key:'glycerol_50', name:'Glycerol 50% in water', pseudo:true,
  rho_liq_kgm3:1126, mu_cp:6.0, data_quality:'estimated', category:'alcohol' }),

// ── KETONES & ESTERS ───────────────────────────────────────────────────────
acetone: F({ key:'acetone', name:'Acetone', formula:'C3H6O', cas:'67-64-1', mw:58.079,
  tb_K:329.22, tm_K:178.45, tc_K:508.1, pc_bar:47.0, omega:0.307,
  antoine:ANT(7.11714,1210.595,229.664,-13,55), rho_liq_kgm3:791, mu_cp:0.32,
  data_quality:'nist', category:'ketone_ester' }),
mek: F({ key:'mek', name:'MEK (2-butanone)', formula:'C4H8O', cas:'78-93-3',
  mw:72.106, tb_K:352.74, tm_K:186.48, tc_K:535.5, pc_bar:41.5, omega:0.323,
  antoine:ANT(7.06520,1261.34,221.97,-15,85), rho_liq_kgm3:805, mu_cp:0.40,
  category:'ketone_ester' }),
mibk: F({ key:'mibk', name:'MIBK (4-methyl-2-pentanone)', formula:'C6H12O',
  cas:'108-10-1', mw:100.159, tb_K:389.6, tm_K:189.2, tc_K:571.4, pc_bar:32.7,
  omega:0.352, antoine:ANT(6.67272,1168.4,191.9,22,116), // handbook (added)
  rho_liq_kgm3:801, mu_cp:0.58, category:'ketone_ester' }),
cyclohexanone: F({ key:'cyclohexanone', name:'Cyclohexanone', formula:'C6H10O',
  cas:'108-94-1', mw:98.143, tb_K:428.8, tm_K:242.0, tc_K:653, pc_bar:40.0,
  omega:0.30, rho_liq_kgm3:948, mu_cp:2.0, // Antoine null → CC (no reliable set on hand)
  data_quality:'estimated', category:'ketone_ester',
  // TODO(NIST pass): add Antoine + confirm criticals.
}),
etoac: F({ key:'etoac', name:'Ethyl acetate', formula:'C4H8O2', cas:'141-78-6',
  mw:88.106, tb_K:350.26, tm_K:189.6, tc_K:523.3, pc_bar:38.8, omega:0.366,
  // MERGE AUDIT #C1: [P] had A=7.0145 (→ 622 mmHg at Tb, −18%!). B and C
  // match the classic set exactly, so A was a typo of 7.10179 → corrected.
  antoine:ANT(7.10179,1244.95,217.88,-20,77), rho_liq_kgm3:900, mu_cp:0.45,
  data_quality:'handbook', category:'ketone_ester' }),
buac: F({ key:'buac', name:'n-Butyl acetate', formula:'C6H12O2', cas:'123-86-4',
  mw:116.160, tb_K:399.2, tm_K:195.0, tc_K:575.4, pc_bar:30.9, omega:0.412,
  antoine:ANT(7.02845,1368.5,204.0,25,128), // handbook (added)
  rho_liq_kgm3:882, mu_cp:0.73, category:'ketone_ester' }),

// ── CHLORINATED SOLVENTS ───────────────────────────────────────────────────
dcm: F({ key:'dcm', name:'Dichloromethane (DCM)', formula:'CH2Cl2', cas:'75-09-2',
  mw:84.933, tb_K:312.99, tm_K:178.0, tc_K:510.0, pc_bar:60.8, omega:0.199,
  antoine:ANT(7.08200,1138.91,231.50,-40,40), // [P]; identity at Tb → 766 mmHg ✓
  rho_liq_kgm3:1325, mu_cp:0.44, category:'chlorinated' }),
chloroform: F({ key:'chloroform', name:'Chloroform', formula:'CHCl3', cas:'67-66-3',
  mw:119.377, tb_K:334.32, tm_K:209.6, tc_K:536.4, pc_bar:54.7, omega:0.222,
  // MERGE AUDIT #C2: [P] set 6.9360/1170.966/226.232 gives 728 mmHg at Tb
  // (−4.2%). Replaced with the Lange-classic set (identity → 758 mmHg ✓):
  antoine:ANT(6.49340,929.44,196.03,-35,61), rho_liq_kgm3:1489, mu_cp:0.57,
  category:'chlorinated' }),
ccl4: F({ key:'ccl4', name:'Carbon tetrachloride', formula:'CCl4', cas:'56-23-5',
  mw:153.822, tb_K:349.79, tm_K:250.33, tc_K:556.4, pc_bar:45.6, omega:0.193,
  antoine:ANT(6.93390,1242.43,230.0,-20,102), rho_liq_kgm3:1594, mu_cp:0.97,
  category:'chlorinated' }),
tce: F({ key:'tce', name:'Trichloroethylene', formula:'C2HCl3', cas:'79-01-6',
  mw:131.388, tb_K:360.3, tm_K:188.4, tc_K:571.0, pc_bar:49.1, omega:0.217,
  // MERGE AUDIT #C3: [P] set 6.9730/1315.0/217.0 gives 447 mmHg at Tb
  // (−41%! C constant off). Replaced with handbook set (identity → 763 ✓):
  antoine:ANT(7.02808,1315.04,230.0,-13,87), rho_liq_kgm3:1462, mu_cp:0.57,
  category:'chlorinated' }),
pce: F({ key:'pce', name:'Perchloroethylene (PCE)', formula:'C2Cl4', cas:'127-18-4',
  mw:165.833, tb_K:394.4, tm_K:250.8, tc_K:620.2, pc_bar:47.6, omega:0.254,
  antoine:ANT(6.97683,1386.92,217.53,37,120), // handbook (added; [P] had none)
  rho_liq_kgm3:1623, mu_cp:0.89, category:'chlorinated' }),

// ── PURE ACIDS / PROCESS CHEMICALS ─────────────────────────────────────────
AcOH: F({ key:'AcOH', name:'Acetic acid (glacial)', formula:'C2H4O2', cas:'64-19-7',
  mw:60.052, tb_K:391.05, tm_K:289.8, tc_K:592.0, pc_bar:57.9, omega:0.467,
  antoine:ANT(7.38782,1533.313,222.309,17,118), rho_liq_kgm3:1049, mu_cp:1.22,
  data_quality:'nist', category:'acid_base',
  // NOTE: vapor-phase association (dimerization) — PR fugacity NOT applied
  // per spec §4; flash validity flagged by mb-engine for this species.
}),
dmf: F({ key:'dmf', name:'DMF (dimethylformamide)', formula:'C3H7NO', cas:'68-12-2',
  mw:73.095, tb_K:426.2, tm_K:212.7, tc_K:649.6, pc_bar:44.2, omega:0.32,
  rho_liq_kgm3:944, mu_cp:0.92, data_quality:'estimated', category:'process_chem',
  // TODO(NIST pass): add Antoine; CC fallback meanwhile.
}),
dmso: F({ key:'dmso', name:'DMSO (dimethyl sulfoxide)', formula:'C2H6OS',
  cas:'67-68-5', mw:78.133, tb_K:462.2, tm_K:291.67, tc_K:729, pc_bar:56.5,
  omega:0.28, rho_liq_kgm3:1101, mu_cp:2.0,
  data_quality:'estimated', category:'process_chem',
  // TODO(NIST pass): Tc/Pc are estimates; add Antoine.
}),
thf: F({ key:'thf', name:'THF (tetrahydrofuran)', formula:'C4H8O', cas:'109-99-9',
  mw:72.107, tb_K:339.12, tm_K:164.8, tc_K:540.1, pc_bar:51.9, omega:0.225,
  antoine:ANT(6.99530,1202.29,226.25,-20,80), // [P]; identity at Tb → 761 ✓
  rho_liq_kgm3:889, mu_cp:0.48, category:'process_chem' }),
nmp: F({ key:'nmp', name:'NMP (N-methyl-2-pyrrolidone)', formula:'C5H9NO',
  cas:'872-50-4', mw:99.133, tb_K:475.2, tm_K:249.0, tc_K:721, pc_bar:45,
  omega:0.36, rho_liq_kgm3:1028, mu_cp:1.70,
  data_quality:'estimated', category:'process_chem',
  // TODO(NIST pass): criticals estimated; add Antoine.
}),
mecn: F({ key:'mecn', name:'Acetonitrile', formula:'C2H3N', cas:'75-05-8', mw:41.053,
  tb_K:354.75, tm_K:227.45, tc_K:545.5, pc_bar:48.3, omega:0.278,
  // MERGE AUDIT #C4: [P] set 7.1190/1314.4/230.0 gives 796 mmHg at Tb (+4.7%).
  // Replaced with handbook set (identity → 753 mmHg, −0.9% ✓):
  antoine:ANT(7.33986,1482.29,250.523,-27,82), rho_liq_kgm3:786, mu_cp:0.35,
  data_quality:'handbook', category:'process_chem' }),
et2o: F({ key:'et2o', name:'Diethyl ether', formula:'C4H10O', cas:'60-29-7',
  mw:74.123, tb_K:307.58, tm_K:156.85, tc_K:466.7, pc_bar:36.4, omega:0.281,
  antoine:ANT(6.92670,1064.07,228.799,-61,35), // [P]; identity → 768 mmHg ✓
  rho_liq_kgm3:713, mu_cp:0.22, category:'process_chem' }),
dioxane: F({ key:'dioxane', name:'1,4-Dioxane', formula:'C4H8O2', cas:'123-91-1',
  mw:88.106, tb_K:374.47, tm_K:284.95, tc_K:587.0, pc_bar:52.1, omega:0.281,
  antoine:ANT(7.43155,1554.68,240.34,20,105), // handbook (added; identity → 760 ✓)
  rho_liq_kgm3:1034, mu_cp:1.30, category:'process_chem' }),
furfural: F({ key:'furfural', name:'Furfural', formula:'C5H4O2', cas:'98-01-1',
  mw:96.085, tb_K:434.9, tm_K:236.65, tc_K:670, pc_bar:56.6, omega:0.37,
  rho_liq_kgm3:1160, mu_cp:1.60, data_quality:'estimated', category:'process_chem',
  // TODO(NIST pass): criticals estimated; add Antoine.
}),
MEG: F({ key:'MEG', name:'Ethylene glycol (MEG)', formula:'C2H6O2', cas:'107-21-1',
  mw:62.068, tb_K:470.4, tm_K:260.2, tc_K:719.0, pc_bar:82.0, omega:0.487,
  rho_liq_kgm3:1113, mu_cp:16.9, // [O] rho; Antoine omitted (published sets
  // for MEG disagree widely) → CC fallback. TODO(NIST pass).
  data_quality:'estimated', category:'glycol_amine' }),
DEG: F({ key:'DEG', name:'Diethylene glycol (DEG)', formula:'C4H10O3',
  cas:'111-46-6', mw:106.120, tb_K:518.2, tm_K:262.7, rho_liq_kgm3:1118,
  mu_cp:35.7, data_quality:'estimated', category:'glycol_amine' }),
TEG: F({ key:'TEG', name:'Triethylene glycol (TEG)', formula:'C6H14O4',
  cas:'112-27-6', mw:150.170, tb_K:561.5, tm_K:265.8, rho_liq_kgm3:1126,
  mu_cp:49.0, data_quality:'estimated', category:'glycol_amine' }),
MEA: F({ key:'MEA', name:'Monoethanolamine (MEA, pure)', formula:'C2H7NO',
  cas:'141-43-5', mw:61.083, tb_K:443.6, tm_K:283.6, tc_K:671.4, pc_bar:80.3,
  omega:0.573, rho_liq_kgm3:1018, mu_cp:24.0, // [O] rho; Antoine → TODO
  data_quality:'estimated', category:'glycol_amine' }),

// ── AQUEOUS SOLUTIONS (pseudo-fluids; MB treats composition explicitly,
//    these are hydraulic conveniences carried over from the sources) ────────
seawater: F({ key:'seawater', name:'Seawater (3.5% NaCl)', pseudo:true,
  tb_K:373.75, rho_liq_kgm3:1025, mu_cp:1.08, category:'aqueous' }), // both sources agree
brine_10: F({ key:'brine_10', name:'Brine 10% NaCl', pseudo:true,
  rho_liq_kgm3:1071, mu_cp:1.2, category:'aqueous' }),
brine_20: F({ key:'brine_20', name:'Brine 20% NaCl', pseudo:true,
  rho_liq_kgm3:1148, mu_cp:1.6, category:'aqueous' }),
brine_25: F({ key:'brine_25', name:'Brine 25% NaCl', pseudo:true,
  rho_liq_kgm3:1188, mu_cp:1.9, category:'aqueous' }),
cacl2_20: F({ key:'cacl2_20', name:'CaCl2 solution 20%', pseudo:true,
  rho_liq_kgm3:1176, mu_cp:1.8, category:'aqueous' }),
cacl2_30: F({ key:'cacl2_30', name:'CaCl2 solution 30%', pseudo:true,
  rho_liq_kgm3:1280, mu_cp:3.0, category:'aqueous' }),
eg_30: F({ key:'eg_30', name:'Ethylene glycol 30% (coolant)', pseudo:true,
  rho_liq_kgm3:1054, mu_cp:2.2, category:'glycol_amine' }),
eg_50: F({ key:'eg_50', name:'Ethylene glycol 50% (coolant)', pseudo:true,
  rho_liq_kgm3:1080, mu_cp:3.9, category:'glycol_amine' }),
eg_70: F({ key:'eg_70', name:'Ethylene glycol 70%', pseudo:true,
  rho_liq_kgm3:1096, mu_cp:6.7, category:'glycol_amine' }),
pg_30: F({ key:'pg_30', name:'Propylene glycol 30%', pseudo:true,
  rho_liq_kgm3:1034, mu_cp:2.8, category:'glycol_amine' }),
pg_50: F({ key:'pg_50', name:'Propylene glycol 50%', pseudo:true,
  rho_liq_kgm3:1059, mu_cp:6.0, category:'glycol_amine' }),
mea_30: F({ key:'mea_30', name:'MEA 30% (CO2 wash)', pseudo:true,
  rho_liq_kgm3:1013, mu_cp:2.5, category:'glycol_amine' }),
dea_35: F({ key:'dea_35', name:'DEA 35%', pseudo:true,
  rho_liq_kgm3:1038, mu_cp:3.8, category:'glycol_amine' }),
mdea_50: F({ key:'mdea_50', name:'MDEA 50%', pseudo:true, // [O] only
  rho_liq_kgm3:1040, mu_cp:10.0, data_quality:'estimated', category:'glycol_amine' }),
hot_pot_carbonate_30: F({ key:'hot_pot_carbonate_30', pseudo:true,
  name:'Hot potassium carbonate 30% (Benfield)', rho_liq_kgm3:1270, mu_cp:1.3,
  nonvolatile:true, data_quality:'estimated', category:'aqueous' }), // [O] only
ammonia_aq_25: F({ key:'ammonia_aq_25', name:'Aqua ammonia 25%', pseudo:true,
  tb_K:311.2, rho_liq_kgm3:910, mu_cp:1.1, category:'aqueous' }),
  // [P] 910 kept over [O] 907 (agree within 0.3%); Tb 38 °C from [O]
urea_solution_32_5: F({ key:'urea_solution_32_5', pseudo:true,
  name:'Urea solution 32.5% (DEF/AdBlue)', tb_K:377.2, rho_liq_kgm3:1090,
  mu_cp:1.4, data_quality:'estimated', category:'aqueous' }), // [O] only

// ── ACID / BASE SOLUTIONS (pseudo) ─────────────────────────────────────────
h2so4_98: F({ key:'h2so4_98', name:'Sulfuric acid 98%', pseudo:true, tb_K:583,
  rho_liq_kgm3:1840, mu_cp:24.0, nonvolatile:true, category:'acid_base' }),
  // [P] 1840 kept over [O] 1836 (0.2% apart); H2SO4 vapor pressure negligible
h2so4_50: F({ key:'h2so4_50', name:'Sulfuric acid 50%', pseudo:true,
  rho_liq_kgm3:1395, mu_cp:5.9, nonvolatile:true, category:'acid_base' }),
h2so4_10: F({ key:'h2so4_10', name:'Sulfuric acid 10%', pseudo:true,
  rho_liq_kgm3:1066, mu_cp:1.2, category:'acid_base' }),
hcl_aq_30: F({ key:'hcl_aq_30', name:'Hydrochloric acid 30%', pseudo:true,
  tb_K:357, rho_liq_kgm3:1149, mu_cp:1.9, category:'acid_base' }),
  // [O] "HCl 32%" (rho 1157, Tb 84 °C) folded here as near-duplicate — AUDIT #D1
hcl_aq_10: F({ key:'hcl_aq_10', name:'Hydrochloric acid 10%', pseudo:true,
  rho_liq_kgm3:1047, mu_cp:1.2, category:'acid_base' }),
hno3_65: F({ key:'hno3_65', name:'Nitric acid 65%', pseudo:true, tb_K:394,
  rho_liq_kgm3:1391, mu_cp:1.9, category:'acid_base' }),
hno3_60: F({ key:'hno3_60', name:'Nitric acid 60%', pseudo:true, tb_K:393,
  rho_liq_kgm3:1367, mu_cp:1.7, category:'acid_base' }), // [O] only — distinct conc., kept
hno3_30: F({ key:'hno3_30', name:'Nitric acid 30%', pseudo:true,
  rho_liq_kgm3:1180, mu_cp:1.3, category:'acid_base' }),
h3po4_85: F({ key:'h3po4_85', name:'Phosphoric acid 85%', pseudo:true,
  rho_liq_kgm3:1685, mu_cp:47.0, nonvolatile:true, category:'acid_base' }),
naoh_30: F({ key:'naoh_30', name:'Caustic soda (NaOH) 30%', pseudo:true,
  rho_liq_kgm3:1328, mu_cp:10.0, nonvolatile:true, category:'acid_base' }),
naoh_50: F({ key:'naoh_50', name:'Caustic soda (NaOH) 50%', pseudo:true, tb_K:418,
  rho_liq_kgm3:1525, mu_cp:78.0, nonvolatile:true, category:'acid_base' }),
  // both sources: rho 1525 identical — clean merge
koh_30: F({ key:'koh_30', name:'Caustic potash (KOH) 30%', pseudo:true,
  rho_liq_kgm3:1290, mu_cp:2.5, nonvolatile:true, category:'acid_base' }),
acoh_50: F({ key:'acoh_50', name:'Acetic acid 50%', pseudo:true,
  rho_liq_kgm3:1062, mu_cp:2.0, category:'acid_base' }),
formic_85: F({ key:'formic_85', name:'Formic acid 85%', pseudo:true, tb_K:380.4,
  rho_liq_kgm3:1193, mu_cp:1.6, category:'acid_base' }),

// ── PETROLEUM CUTS (pseudo; rho at 15 °C per source convention) ────────────
gasoline: F({ key:'gasoline', name:'Gasoline (petrol)', pseudo:true, tb_K:308,
  antoine:ANT(6.80,1064.0,228.0,-20,60), // [P] pseudo-set — RVP-class estimate
  rho_liq_kgm3:740, mu_cp:0.50, data_quality:'estimated', category:'petroleum' }),
  // rho: [P] 740 kept over [O] 720 — AUDIT #D2. tb_K = IBP (conservative).
diesel: F({ key:'diesel', name:'Diesel / gas oil', pseudo:true, tb_K:453,
  rho_liq_kgm3:840, mu_cp:3.0, data_quality:'estimated', category:'petroleum' }),
kerosene: F({ key:'kerosene', name:'Kerosene / Jet-A', pseudo:true, tb_K:423,
  rho_liq_kgm3:800, mu_cp:1.6, data_quality:'estimated', category:'petroleum' }),
jeta1: F({ key:'jeta1', name:'Jet A-1', pseudo:true, tb_K:433,
  rho_liq_kgm3:804, mu_cp:1.4, data_quality:'estimated', category:'petroleum' }),
naphtha_light: F({ key:'naphtha_light', name:'Naphtha (light)', pseudo:true,
  tb_K:308, antoine:ANT(6.90,1100.0,225.0,-10,80), // [P] pseudo-set, estimate
  rho_liq_kgm3:690, mu_cp:0.45, data_quality:'estimated', category:'petroleum' }),
  // rho: [P] 690 kept over [O] 700 — AUDIT #D2
naphtha_heavy: F({ key:'naphtha_heavy', name:'Naphtha (heavy)', pseudo:true,
  tb_K:373, rho_liq_kgm3:730, mu_cp:0.7, data_quality:'estimated', category:'petroleum' }),
condensate: F({ key:'condensate', name:'Condensate (HC)', pseudo:true, tb_K:303,
  rho_liq_kgm3:750, mu_cp:0.6, data_quality:'estimated', category:'petroleum' }), // [O] only
crude_20api: F({ key:'crude_20api', name:'Crude oil API 20 (heavy)', pseudo:true,
  rho_liq_kgm3:934, mu_cp:300, data_quality:'estimated', category:'petroleum' }),
crude_30api: F({ key:'crude_30api', name:'Crude oil API 30', pseudo:true, tb_K:308,
  rho_liq_kgm3:876, mu_cp:12, data_quality:'estimated', category:'petroleum' }),
  // both sources 876 — clean merge; tb_K = IBP from [O]
crude_40api: F({ key:'crude_40api', name:'Crude oil API 40', pseudo:true,
  rho_liq_kgm3:825, mu_cp:4, data_quality:'estimated', category:'petroleum' }),
crude_50api: F({ key:'crude_50api', name:'Crude oil API 50 (light)', pseudo:true,
  rho_liq_kgm3:780, mu_cp:1.5, data_quality:'estimated', category:'petroleum' }),
hfo: F({ key:'hfo', name:'Heavy fuel oil (HFO 380)', pseudo:true, tb_K:523,
  rho_liq_kgm3:975, mu_cp:2000, nonvolatile:true, // mu extrapolated to 20 °C
  data_quality:'estimated', category:'petroleum' }),
  // rho: [P] 975 kept over [O] 985 — AUDIT #D2
atmresid: F({ key:'atmresid', name:'Atmospheric residue (ATB)', pseudo:true,
  rho_liq_kgm3:960, mu_cp:5000, nonvolatile:true,
  data_quality:'estimated', category:'petroleum' }),
vacresid: F({ key:'vacresid', name:'Vacuum residue (VTB)', pseudo:true,
  rho_liq_kgm3:985, mu_cp:50000, nonvolatile:true,
  data_quality:'estimated', category:'petroleum' }),
bitumen: F({ key:'bitumen', name:'Bitumen / asphalt', pseudo:true,
  rho_liq_kgm3:1030, mu_cp:500000, nonvolatile:true,
  data_quality:'estimated', category:'petroleum' }),

// ── LUBRICANTS & HYDRAULIC (pseudo; mu at 40 °C = ISO VG × rho basis) ──────
lube_vg32: F({ key:'lube_vg32', name:'Lube oil ISO VG 32', pseudo:true,
  rho_liq_kgm3:858, mu_cp:28, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
lube_vg46: F({ key:'lube_vg46', name:'Lube oil ISO VG 46', pseudo:true,
  rho_liq_kgm3:870, mu_cp:40, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
  // both sources 870 — clean merge
lube_vg68: F({ key:'lube_vg68', name:'Lube oil ISO VG 68', pseudo:true,
  rho_liq_kgm3:872, mu_cp:59, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
lube_vg100: F({ key:'lube_vg100', name:'Lube oil ISO VG 100', pseudo:true,
  rho_liq_kgm3:874, mu_cp:87, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
lube_vg150: F({ key:'lube_vg150', name:'Lube oil ISO VG 150', pseudo:true,
  rho_liq_kgm3:875, mu_cp:131, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
lube_vg220: F({ key:'lube_vg220', name:'Lube oil ISO VG 220', pseudo:true,
  rho_liq_kgm3:880, mu_cp:194, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
hydr_32: F({ key:'hydr_32', name:'Hydraulic oil ISO 32', pseudo:true,
  rho_liq_kgm3:860, mu_cp:28, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
hydr_46: F({ key:'hydr_46', name:'Hydraulic oil ISO 46', pseudo:true,
  rho_liq_kgm3:870, mu_cp:40, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
hydr_68: F({ key:'hydr_68', name:'Hydraulic oil ISO 68', pseudo:true,
  rho_liq_kgm3:875, mu_cp:59, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
hydr_100: F({ key:'hydr_100', name:'Hydraulic oil ISO 100', pseudo:true,
  rho_liq_kgm3:880, mu_cp:87, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
thermoil: F({ key:'thermoil', name:'Thermal / heat-transfer oil', pseudo:true,
  rho_liq_kgm3:855, mu_cp:25, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
turbine_oil: F({ key:'turbine_oil', name:'Turbine oil ISO VG 46', pseudo:true,
  rho_liq_kgm3:869, mu_cp:40, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),
gear_oil_320: F({ key:'gear_oil_320', name:'Gear oil ISO VG 320', pseudo:true,
  rho_liq_kgm3:890, mu_cp:285, nonvolatile:true, data_quality:'estimated', category:'lubricant' }),

// ── FOOD & PHARMA (pseudo; [P] only) ───────────────────────────────────────
milk: F({ key:'milk', name:'Milk (whole)', pseudo:true, rho_liq_kgm3:1030,
  mu_cp:2.0, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),
milk_skim: F({ key:'milk_skim', name:'Skim milk', pseudo:true, rho_liq_kgm3:1034,
  mu_cp:1.5, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),
olive_oil: F({ key:'olive_oil', name:'Olive oil', pseudo:true, rho_liq_kgm3:910,
  mu_cp:84, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),
sunflower_oil: F({ key:'sunflower_oil', name:'Sunflower oil', pseudo:true,
  rho_liq_kgm3:919, mu_cp:49, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),
palm_oil: F({ key:'palm_oil', name:'Palm oil', pseudo:true, rho_liq_kgm3:891,
  mu_cp:45, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),
corn_syrup_63bx: F({ key:'corn_syrup_63bx', name:'Corn syrup 63° Brix', pseudo:true,
  rho_liq_kgm3:1303, mu_cp:15000, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),
honey: F({ key:'honey', name:'Honey', pseudo:true, rho_liq_kgm3:1420,
  mu_cp:10000, nonvolatile:true, data_quality:'estimated', category:'food_pharma' }),

// ── SPECIAL & METALS ([P] only) ────────────────────────────────────────────
mercury: F({ key:'mercury', name:'Mercury', formula:'Hg', cas:'7439-97-6',
  mw:200.59, tb_K:629.88, tm_K:234.32, rho_liq_kgm3:13534, mu_cp:1.55,
  category:'special' }),
molten_sulfur: F({ key:'molten_sulfur', name:'Molten sulfur (~130 °C)',
  formula:'S8', cas:'7704-34-9', mw:256.52, tb_K:717.8, tm_K:388.36,
  rho_liq_kgm3:1800, mu_cp:7.0, // mu at 130 °C — sulfur viscosity is strongly
  // non-monotonic (jumps ×10^4 above 159 °C); single value is indicative only
  data_quality:'estimated', category:'special' }),
slurry_10: F({ key:'slurry_10', name:'Slurry (10% solids)', pseudo:true,
  rho_liq_kgm3:1100, mu_cp:3, nonvolatile:true, data_quality:'estimated', category:'special' }),
slurry_30: F({ key:'slurry_30', name:'Slurry (30% solids)', pseudo:true,
  rho_liq_kgm3:1350, mu_cp:15, nonvolatile:true, data_quality:'estimated', category:'special' }),
slurry_50: F({ key:'slurry_50', name:'Slurry (50% solids, dense)', pseudo:true,
  rho_liq_kgm3:1650, mu_cp:120, nonvolatile:true, data_quality:'estimated', category:'special' }),
drilling_mud_12ppg: F({ key:'drilling_mud_12ppg', name:'Drilling mud (12 ppg)',
  pseudo:true, rho_liq_kgm3:1440, mu_cp:35, nonvolatile:true,
  data_quality:'estimated', category:'special' }),
};

// ===========================================================================
// API
// ===========================================================================

/**
 * Picker-safe metadata list (mirrors the Supabase components_picker view).
 * @returns {Array<{key,name,formula,mw,category,nonvolatile,data_quality}>}
 */
function list() {
  return Object.values(FLUIDS).map(f => ({
    key: f.key, name: f.name, formula: f.formula, mw: f.mw,
    category: f.category, nonvolatile: f.nonvolatile,
    data_quality: f.data_quality,
  }));
}

/**
 * Full record by key.
 * @param {string} key
 * @returns {object|null}
 */
function get(key) { return FLUIDS[key] || null; }

/**
 * Saturation pressure [bar] at T_K.
 * Priority: Antoine (log10 mmHg / °C) inside its validity range; outside it,
 * Clausius-Clapeyron anchored at (Tb, 1 atm) with dHvap = dhvap_tb_kjmol
 * (Step-5 field) or a Trouton estimate (0.088·Tb kJ/mol) when null.
 * @param {string} key
 * @param {number} T_K
 * @returns {{psat_bar:number|null, in_range:boolean,
 *            method:'antoine'|'clausius_clapeyron'|'supercritical'|
 *                   'nonvolatile'|'no_data', warning?:string}}
 */
function psat_bar(key, T_K) {
  const f = FLUIDS[key];
  if (!f) return { psat_bar: null, in_range: false, method: 'no_data',
    warning: `unknown fluid key '${key}'` };
  if (f.nonvolatile) return { psat_bar: 0, in_range: false, method: 'nonvolatile' };
  if (f.tc_K != null && T_K >= f.tc_K) {
    return { psat_bar: null, in_range: false, method: 'supercritical',
      warning: `T ${T_K.toFixed(1)} K >= Tc ${f.tc_K} K — no saturation curve` };
  }
  const T_c = T_K - 273.15;
  const a = f.antoine;
  if (a && T_c >= a.tmin_c && T_c <= a.tmax_c) {
    const p_mmHg = Math.pow(10, a.A - a.B / (a.C + T_c));
    return { psat_bar: p_mmHg * MMHG_TO_BAR, in_range: true, method: 'antoine' };
  }
  // Clausius-Clapeyron fallback from (Tb, 1.01325 bar)
  if (f.tb_K != null && f.tb_K > 0) {
    const dHvap = f.dhvap_tb_kjmol != null
      ? f.dhvap_tb_kjmol
      : TROUTON_KJ_PER_MOLK * f.tb_K; // Trouton until Step 5 fills the field
    const p = 1.01325 * Math.exp(-(dHvap / R_KJ) * (1 / T_K - 1 / f.tb_K));
    return { psat_bar: p, in_range: false, method: 'clausius_clapeyron',
      warning: f.dhvap_tb_kjmol == null
        ? 'CC with Trouton-estimated dHvap (placeholder until Step 5)'
        : undefined };
  }
  return { psat_bar: null, in_range: false, method: 'no_data',
    warning: 'no Antoine set and no Tb — cannot estimate Psat' };
}

/** @returns {number} total fluid count */
function count() { return Object.keys(FLUIDS).length; }

export default { FLUIDS, list, get, psat_bar, count };

/* ===========================================================================
   MERGE AUDIT — [O] FLUID_DB_orifice + [P] FLUID_DB_pdrop → this file
   ===========================================================================
   TOTAL: 144 canonical fluids (run count() to confirm at runtime).
   Source coverage: [P] 142 records + [O] ~55 records → 128 after merge
   ([O] ~55 + [P] 142 = ~197 source records → 144 after collapsing
   per-phase / per-alias duplicates — see D-list — while every distinct
   species/concentration is retained).

   A. ANTOINE CHOICES (both sources had a set; one kept)
   A1  NH3      kept [P] 7.596673/1028.083/251.369 (documented −83..133 °C,
                760.3 mmHg at Tb) over [O] 7.36050/926.132/240.17.
   A2  C3H8     kept [O] 6.80338/803.810/246.99 (760 mmHg at Tb) over
                [P] A=6.82973 (same B,C; +6% at Tb — likely digit slip).

   B. UNIT CONVERSIONS PERFORMED
   B1  [O] gas Pc: MPa → bar (×10) for all 24 gas records
       (air 3.77→37.7, CO2 7.38→73.8, NH3 11.28→112.8, He 0.23→2.3, …).
   B2  [P] dual-phase Tc: °C → K (+273.15): NH3 132.25→405.40 (agrees [O]
       405.6), C3H8 96.68→369.83 (agrees [O] 369.8), CO2 31.04→304.19
       (agrees [O] 304.1), H2O 373.95 °C→647.10 K.
   B3  [O] gas viscosity Pa·s → cP (×1000) for mu_cp.
   B4  NO Antoine base conversions were needed: both sources were already
       log10(mmHg)/°C (verified by [P]'s own NH3 comment and by 760-mmHg-
       at-Tb identity checks on every retained set).

   C. SUSPICIOUS VALUES — CORRECTED (each failed the Tb identity check)
   C1  ethyl acetate  [P] A=7.0145 → 622 mmHg at Tb (−18%). B,C matched the
                      classic set digit-for-digit ⇒ A typo; corrected to
                      7.10179 (→ 761 mmHg ✓).
   C2  chloroform     [P] 6.9360/1170.966/226.232 → 728 mmHg at Tb (−4.2%);
                      replaced with Lange set 6.4934/929.44/196.03 (758 ✓).
   C3  trichloroethylene [P] 6.9730/1315.0/217.0 → 447 mmHg at Tb (−41%!,
                      C off by ~13); replaced with 7.02808/1315.04/230.0
                      (763 ✓). WORST defect found in the sources.
   C4  acetonitrile   [P] 7.1190/1314.4/230.0 → 796 mmHg at Tb (+4.7%);
                      replaced with 7.33986/1482.29/250.523 (753 ✓).
   C5  styrene        [P] 7.14016/1574.51/218.38 → 644 mmHg at Tb (−15%);
                      replaced with handbook set 6.95711/1445.58/209.43
                      (759 ✓).
   C6  (flagged, not corrected) ethanol_96 carries the PURE-ethanol Antoine
       from [P]; acceptable for screening, data_quality:'estimated'.
   C7  (flagged) [P] glycerol listed BENZENE's Antoine constants
       (6.90565/1211.033/220.790) — obvious copy-paste defect; DISCARDED,
       glycerol uses CC fallback instead.
   C8  (note) CO2's Antoine is the LIQUID branch (−56..31 °C); its tb_K
       is the 1-atm SUBLIMATION point, which lies outside that branch —
       the 760-mmHg-at-Tb identity intentionally does not apply. Sanity
       instead checked at the triple point: −56.6 °C → 5.14 bar vs the
       true 5.18 bar triple pressure ✓.
   C9  (flagged) [P] gasoline/naphtha Antoine sets are pseudo-component
       estimates (round numbers); retained but tagged 'estimated'.

   D. DUPLICATES RESOLVED (multi-record → one canonical)
   D1  hcl_aq_30 ← [P] hcl30 + [O] 'HCl 32%' (Δconc 2 pts, Δrho 0.7% —
       folded as near-duplicate; noted inline).
   D2  rho conflicts, [P] kept (fresher curation): gasoline 740 over [O]
       720; naphtha_light 690 over [O] 700; hfo 975 over [O] 985;
       ammonia_aq_25 910 over 907. Identical in both: crude_30api 876,
       naoh_50 1525, lube_vg46 870, seawater 1025, diesel 840, kerosene 800.
   D3  Species collapsed from per-phase/alias records:
       NH3   ← [O]'Ammonia (NH₃)' + [O]'Ammonia (liquid)' + [P]ammonia +
               [P]ammonia_liq + [P]ammgas            (5 → 1)
       C3H8  ← [O]gas + [O]liquid + [P]propane + [P]propane_liq + [P]propgas (5 → 1)
       nC4H10← [O]gas + [O]liquid + [P]butane_liq    (3 → 1)
       CO2   ← [O]'CO₂' + [P]co2gas + [P]co2_liq + [P]co2 (4 → 1)
       H2O   ← [O]'Water' + [P]water + [P]steam_gas + [P]water_steam (4 → 1;
               steam handled by if97.js, not a separate fluid)
       lpg   ← [O]'LPG Vapor' + [P]lpg               (2 → 1)
       kerosene ← [O] + [P]kerosene ('Kerosene / Jet-A'); jeta1 kept separate.
       natural_gas ← [O](SG .62, full criticals) + [P]natgas(SG .65);
               natural_gas_rich kept separate from [P]natgas_h.
       + 1:1 merges for all common gases (N2, O2, H2, He, Ar, CO, CH4,
       C2H6, C2H4, C2H2, H2S, SO2, Cl2, flue gas, biogas) and solvents
       (methanol, ethanol, benzene, toluene, acetone, glycerol, MEG,
       naoh_50, seawater, ammonia_aq_25, crude_30api, diesel, gasoline,
       naphtha, hfo, lube_vg46).
   D4  DISTINCT records intentionally NOT merged (different concentration
       or composition, not duplicates): MEA (pure) vs mea_30; MEG vs
       eg_30/50/70; hno3_65 vs hno3_60 ([O]) vs hno3_30; h2so4 98/50/10;
       EtOH vs ethanol_96; syngas_3h2_n2 ([O]) vs syngas_h2_co ([P] —
       different mixtures, MW 8.5 vs 15.5).

   E. FIELDS ADDED FROM PUBLIC KNOWLEDGE (neither source carried them)
       CAS, formula, Tm for all pure species; Tc/Pc/omega for all pure
       liquids; Antoine for H2S, SO2, Cl2, CO2(liq), isooctane, cumene,
       MIBK, butyl acetate, PCE, dioxane — tagged 'handbook'. Estimated-
       class records (HCl criticals, DMF/DMSO/NMP/furfural/glycerol/MEG/
       MEA caloric-adjacent constants) tagged 'estimated' + TODO. Verify
       against NIST WebBook before promoting any tag (standing rule).

   F. KNOWN GAPS (deliberate, per Step-3 scope)
       dhvap_tb_kjmol: null everywhere (Step-5 placeholder; psat_bar uses
       Trouton meanwhile). No Hf/Shomate/Cp/dhfus anywhere (Step 5).
       Antoine still missing (CC fallback active): HCl, glycerol, MEG,
       DEG, TEG, MEA, DMF, DMSO, NMP, furfural, cyclohexanone + all
       pseudo-fluids without a set.
   ======================================================================== */
