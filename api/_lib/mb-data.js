// ============================================================================
// REPO PATH: api/_lib/mb-data.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — STEP 5, TASK A
// CALORIC DATA LAYER — embedded fallback mirror of the Supabase `components`
// caloric columns. FORMATION-ENTHALPY BASIS throughout: every stored Hf is
// the standard enthalpy of formation at 298.15 K so that any module's duty
// is simply Q = Hout − Hin (reaction heat implicit).
//
// SOURCES — PUBLIC ONLY (per spec §5; DIPPR never used):
//   [N]  NIST Chemistry WebBook — Shomate gas-phase coefficient sets
//        (t = T/1000; Cp in J/mol·K; H(T)−H(298.15) in kJ/mol) and gas-phase
//        formation enthalpies. Tag: data_quality 'nist'.
//   [S]  Smith, Van Ness & Abbott, "Introduction to Chemical Engineering
//        Thermodynamics", App. C Table C.1 ideal-gas heat capacities,
//        Cp_ig/R = A + B·T + C·T² + D·T⁻² (T in K, valid ≈298–1500 K).
//        Tag: 'handbook'.
//   [H]  CRC Handbook / Perry's / Lange's class values (Hf liq/sol, ΔHvap(Tb),
//        ΔHfus, liquid & solid Cp). Tag: 'handbook'.
//   [E]  Estimated (Trouton, group fit, or transcription not re-verified) —
//        conservative value + TODO comment. Tag: 'estimated'. NEVER 'nist'.
//
// UNITS (document of record — mirrors mb_schema.sql comments):
//   hf_gas_298 / hf_liq_298 / hf_sol_298 : kJ/mol at 298.15 K
//   shomate  : array of {tmin,tmax,A,B,C,D,E,F,G,H}; tmin/tmax [K]; NIST
//              convention: Cp[J/mol·K] = A + B·t + C·t² + D·t³ + E/t²,
//              H(T)−H(298.15)[kJ/mol] = A·t + B·t²/2 + C·t³/3 + D·t⁴/4
//                                       − E/t + F − H, with t = T/1000.
//   cp_svn   : [A, B, C, D] with TRUE magnitudes (B [1/K], C [1/K²], D [K²]);
//              Cp_ig/R = A + B·T + C·T² + D·T⁻². Used when shomate is null.
//   cp_liq_kjkgk, cp_sol_kjkgk : constant heat capacities [kJ/kg·K]
//   dhvap_tb : ΔHvap at the normal boiling point [kJ/mol] (Watson anchor,
//              exponent 0.38, clamp 0.98·Tc). dhvap_ref_K overrides the
//              anchor temperature when it is NOT tb_K (e.g. CO2 triple pt).
//   dhfus    : ΔHfus at Tm [kJ/mol]
//   supplement : physical props (mw, tb_K, tm_K, tc_K, pc_bar, omega,
//              antoine) ONLY for keys ABSENT from fluids.js — mb-engine
//              merges these over fluids.get(key). Keys already in fluids.js
//              carry NO supplement (fluids.js is canonical for physicals).
//
// data_quality is the WEAKEST-LINK tag for the record as a whole; per-field
// provenance is stated in the inline comment ([N]/[S]/[H]/[E]).
//
// Dependency-free. Plain ES2020 / CommonJS. (c) multicalci.com
// ============================================================================

'use strict';

// ---------------------------------------------------------------------------
// helpers — compact record / range builders
// ---------------------------------------------------------------------------

/** Fill record defaults. */
function C(o) {
  return Object.assign({
    key: null, category: 'other',
    hf_gas_298: null, hf_liq_298: null, hf_sol_298: null,
    shomate: null, cp_svn: null,
    cp_liq_kjkgk: null, cp_sol_kjkgk: null,
    dhvap_tb: null, dhvap_ref_K: null, dhfus: null,
    nonvolatile: false,
    data_quality: 'handbook', source: '[H]', note: null,
    supplement: null,
  }, o);
}

/** Shomate range shorthand (NIST order A..H). */
function SH(tmin, tmax, A, B, Cc, D, E, F, G, H) {
  return { tmin, tmax, A, B, C: Cc, D, E, F, G, H };
}

// ===========================================================================
// DATA — caloric records keyed identically to fluids.js where the fluid
// exists there; new keys (C3H6, NO, NO2, fertilizer, salts) carry supplement.
// ===========================================================================
const DATA = {

// ── SYNGAS SET ─────────────────────────────────────────────────────────────

H2: C({ key: 'H2', category: 'syngas',
  hf_gas_298: 0.0,                                     // element [N]
  shomate: [ // [N] NIST WebBook H2 gas
    SH(298, 1000, 33.066178, -11.363417, 11.432816, -2.772874, -0.158558, -9.980797, 172.707974, 0.0),
    SH(1000, 2500, 18.563083, 12.257357, -2.859786, 0.268238, 1.977990, -1.147438, 156.288133, 0.0),
  ],
  dhvap_tb: 0.90,                                      // [H] at 20.3 K
  data_quality: 'nist', source: '[N] Shomate; [H] dhvap' }),

N2: C({ key: 'N2', category: 'syngas',
  hf_gas_298: 0.0,                                     // element [N]
  shomate: [ // [N] NIST WebBook N2 gas
    SH(100, 500, 28.98641, 1.853978, -9.647459, 16.63537, 0.000117, -8.671914, 226.4168, 0.0),
    SH(500, 2000, 19.50583, 19.88705, -8.598535, 1.369784, 0.527601, -4.935202, 212.3900, 0.0),
  ],
  dhvap_tb: 5.57,                                      // [H] at 77.4 K
  data_quality: 'nist', source: '[N] Shomate; [H] dhvap' }),

O2: C({ key: 'O2', category: 'syngas',
  hf_gas_298: 0.0,                                     // element [N]
  shomate: [ // [N] NIST WebBook O2 gas
    SH(100, 700, 31.32234, -20.23531, 57.86644, -36.50624, -0.007374, -8.903471, 246.7945, 0.0),
    SH(700, 2000, 30.03235, 8.772972, -3.988133, 0.788313, -0.741599, -11.32468, 236.1663, 0.0),
  ],
  dhvap_tb: 6.82,                                      // [H] at 90.2 K
  data_quality: 'nist', source: '[N] Shomate; [H] dhvap' }),

Ar: C({ key: 'Ar', category: 'syngas',
  hf_gas_298: 0.0,                                     // element [N]
  shomate: [ // [N] monatomic — Cp = 20.786 J/mol·K, flat
    SH(298, 6000, 20.78600, 2.825911e-7, -1.464191e-7, 1.092131e-8, -3.661371e-8, -6.197350, 179.9990, 0.0),
  ],
  dhvap_tb: 6.43,                                      // [H] at 87.3 K
  data_quality: 'nist', source: '[N] Shomate; [H] dhvap' }),

He: C({ key: 'He', category: 'syngas',
  hf_gas_298: 0.0,                                     // element [N]
  shomate: [ // [N] monatomic — Cp = 20.786 J/mol·K, flat
    SH(298, 6000, 20.78603, 4.850636e-10, -1.582916e-10, 1.525102e-11, 3.196347e-11, -6.197350, 151.3064, 0.0),
  ],
  dhvap_tb: 0.083,                                     // [H] at 4.2 K
  data_quality: 'nist', source: '[N] Shomate; [H] dhvap' }),

CO: C({ key: 'CO', category: 'syngas',
  hf_gas_298: -110.53,                                 // [N]
  shomate: [ // [N] NIST WebBook CO gas
    SH(298, 1300, 25.56759, 6.096130, 4.054656, -2.671301, 0.131021, -118.0089, 227.3665, -110.5271),
    SH(1300, 6000, 35.15070, 1.300095, -0.205921, 0.013550, -3.282780, -127.8375, 231.7120, -110.5271),
  ],
  dhvap_tb: 6.04,                                      // [H] at 81.7 K
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap' }),

CO2: C({ key: 'CO2', category: 'syngas',
  hf_gas_298: -393.52,                                 // [N]
  shomate: [ // [N] NIST WebBook CO2 gas
    SH(298, 1200, 24.99735, 55.18696, -33.69137, 7.948387, -0.136638, -403.6075, 228.2431, -393.5224),
    SH(1200, 6000, 58.16639, 2.720074, -0.492289, 0.038844, -6.447293, -425.9186, 263.6125, -393.5224),
  ],
  cp_liq_kjkgk: 2.2,                                   // [E] sat. liquid ≈ −20 °C — TODO verify
  dhvap_tb: 15.3, dhvap_ref_K: 216.59,                 // [H] ΔHvap at TRIPLE point
  // fluids.js tb_K (194.7 K) is the 1-atm SUBLIMATION point — Watson must
  // anchor at the triple point instead, hence dhvap_ref_K. ΔHsub(194.7 K)
  // ≈ 25.2 kJ/mol if a sublimation branch is ever needed.
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap; [E] cp_liq',
  note: 'tb_K is sublimation pt; vaporization anchored at triple pt 216.59 K' }),

CH4: C({ key: 'CH4', category: 'syngas',
  hf_gas_298: -74.87,                                  // [N]
  shomate: [ // [N] NIST WebBook methane gas
    SH(298, 1300, -0.703029, 108.4773, -42.52157, 5.862788, 0.678565, -76.84376, 158.7163, -74.87310),
    SH(1300, 6000, 85.81217, 11.26467, -2.114146, 0.138190, -26.42221, -153.5327, 224.4143, -74.87310),
  ],
  dhvap_tb: 8.19,                                      // [H] at 111.7 K
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap' }),

C2H6: C({ key: 'C2H6', category: 'syngas',
  hf_gas_298: -83.8,                                   // [N]
  cp_svn: [1.131, 19.225e-3, -5.561e-6, 0],            // [S] Table C.1 ethane
  dhvap_tb: 14.69,                                     // [H] at 184.6 K
  data_quality: 'handbook', source: '[N] Hf; [S] Cp; [H] dhvap' }),

C3H8: C({ key: 'C3H8', category: 'syngas',
  hf_gas_298: -104.7,                                  // [N]
  cp_svn: [1.213, 28.785e-3, -8.824e-6, 0],            // [S] Table C.1 propane
  cp_liq_kjkgk: 2.4,                                   // [E] sat. liq ~25 °C — TODO verify
  dhvap_tb: 18.77,                                     // [H] at 231.1 K
  data_quality: 'handbook', source: '[N] Hf; [S] Cp; [H] dhvap; [E] cp_liq' }),

nC4H10: C({ key: 'nC4H10', category: 'syngas',
  hf_gas_298: -125.8,                                  // [N]
  cp_svn: [1.935, 36.915e-3, -11.402e-6, 0],           // [S] Table C.1 n-butane
  cp_liq_kjkgk: 2.3,                                   // [E] sat. liq ~25 °C — TODO verify
  dhvap_tb: 22.44,                                     // [H] at 272.7 K
  data_quality: 'handbook', source: '[N] Hf; [S] Cp; [H] dhvap; [E] cp_liq' }),

C2H4: C({ key: 'C2H4', category: 'syngas',
  hf_gas_298: 52.4,                                    // [N]
  cp_svn: [1.424, 14.394e-3, -4.392e-6, 0],            // [S] Table C.1 ethylene
  dhvap_tb: 13.53,                                     // [H] at 169.4 K
  data_quality: 'handbook', source: '[N] Hf; [S] Cp; [H] dhvap' }),

C3H6: C({ key: 'C3H6', category: 'syngas',
  hf_gas_298: 20.0,                                    // [H] propene (sources 19.7–20.4)
  cp_svn: [1.637, 22.706e-3, -6.915e-6, 0],            // [S] Table C.1 propylene
  dhvap_tb: 18.42,                                     // [H] at 225.5 K
  data_quality: 'handbook', source: '[H] Hf; [S] Cp; [H] dhvap',
  supplement: { mw: 42.081, tb_K: 225.46, tm_K: 87.9, tc_K: 364.9,
    pc_bar: 46.0, omega: 0.142, antoine: null,
    name: 'Propylene', formula: 'C3H6', cas: '115-07-1', category: 'gas' } }),

NH3: C({ key: 'NH3', category: 'syngas',
  hf_gas_298: -45.90,                                  // [N]
  shomate: [ // [N] NIST WebBook ammonia gas
    SH(298, 1400, 19.99563, 49.77119, -15.37599, 1.921168, 0.189174, -53.30667, 203.8591, -45.89806),
  ],
  cp_liq_kjkgk: 4.7,                                   // [H] sat. liquid
  dhvap_tb: 23.33,                                     // [H] at 239.8 K
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap, cp_liq' }),

H2S: C({ key: 'H2S', category: 'syngas',
  hf_gas_298: -20.6,                                   // [N]
  shomate: [ // NIST-form set — transcribed from WebBook, second decimals
    // not re-verified against the live page → tagged 'handbook', not 'nist'.
    SH(298, 1400, 26.88412, 18.67809, 3.434203, -3.378702, 0.135882, -28.91211, 233.3747, -20.50202),
  ],
  dhvap_tb: 18.67,                                     // [H] at 212.8 K
  data_quality: 'handbook',
  source: '[N] Hf; NIST-form Shomate (verify); [H] dhvap',
  note: 'TODO verify Shomate digits vs NIST WebBook before promoting to nist' }),

SO2: C({ key: 'SO2', category: 'syngas',
  hf_gas_298: -296.84,                                 // [N]
  shomate: [ // [N] NIST WebBook SO2 gas
    SH(298, 1200, 21.43049, 74.35094, -57.75217, 16.35534, 0.086731, -305.7688, 254.8872, -296.8422),
    SH(1200, 6000, 57.48188, 1.009328, -0.076290, 0.005174, -4.045401, -324.4140, 302.7798, -296.8422),
  ],
  cp_liq_kjkgk: 1.36,                                  // [H] sat. liquid
  dhvap_tb: 24.94,                                     // [H] at 263.1 K
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap, cp_liq' }),

HCl: C({ key: 'HCl', category: 'syngas',
  hf_gas_298: -92.31,                                  // [N]
  shomate: [ // [N] NIST WebBook HCl gas
    SH(298, 1200, 32.12392, -13.45805, 19.86852, -6.853936, -0.049672, -101.6206, 228.6866, -92.31201),
    SH(1200, 6000, 31.91923, 3.203184, -0.541539, 0.035925, -3.438525, -108.0150, 218.2768, -92.31201),
  ],
  dhvap_tb: 16.15,                                     // [H] at 188.2 K
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap' }),

Cl2: C({ key: 'Cl2', category: 'syngas',
  hf_gas_298: 0.0,                                     // element [N]
  shomate: [ // NIST-form set — transcribed, not re-verified → 'handbook'.
    SH(298, 1000, 33.05060, 12.22940, -12.06510, 4.385330, -0.159494, -10.83480, 259.0290, 0.0),
    SH(1000, 3000, 42.67730, -5.009570, 1.904621, -0.165641, -2.098480, -17.28980, 269.8400, 0.0),
  ],
  cp_liq_kjkgk: 0.93,                                  // [H] sat. liquid
  dhvap_tb: 20.41,                                     // [H] at 239.1 K
  data_quality: 'handbook',
  source: 'NIST-form Shomate (verify); [H] dhvap, cp_liq',
  note: 'TODO verify Shomate digits vs NIST WebBook before promoting to nist' }),

NO: C({ key: 'NO', category: 'syngas',
  hf_gas_298: 90.29,                                   // [N] (matches Shomate H)
  shomate: [ // [N] NIST WebBook NO gas
    SH(298, 1200, 23.83491, 12.58878, -1.139011, -1.497459, 0.214194, 83.35783, 237.1219, 90.29114),
    SH(1200, 6000, 35.99169, 0.957170, -0.148032, 0.009974, -3.004088, 73.10787, 246.1619, 90.29114),
  ],
  dhvap_tb: 13.83,                                     // [H] at 121.4 K
  data_quality: 'nist', source: '[N] Hf+Shomate; [H] dhvap',
  supplement: { mw: 30.006, tb_K: 121.38, tm_K: 109.5, tc_K: 180.0,
    pc_bar: 64.8, omega: 0.582, antoine: null,
    name: 'Nitric oxide', formula: 'NO', cas: '10102-43-9', category: 'gas' } }),

NO2: C({ key: 'NO2', category: 'syngas',
  hf_gas_298: 33.10,                                   // [N]
  shomate: [ // [N] NIST WebBook NO2 gas
    SH(298, 1200, 16.10857, 75.89525, -54.38740, 14.30777, 0.239423, 26.17464, 240.5386, 33.09502),
    SH(1200, 6000, 56.82541, 0.738053, -0.144721, 0.009777, -5.459911, 2.846456, 290.5056, 33.09502),
  ],
  cp_liq_kjkgk: 1.6,                                   // [E] liquid is N2O4-rich — TODO
  dhvap_tb: null,                                      // NO2⇌N2O4: ΔHvap(294 K) = 38.1
  // kJ per mol N2O4; a per-"NO2" number is composition-dependent — left null
  // so the engine's Trouton fallback (≈25.9 kJ/mol) is used with a warning.
  data_quality: 'estimated',
  source: '[N] Hf+Shomate; [E] liquid branch (dimerization)',
  note: 'TODO: liquid branch entangled with N2O4 equilibrium — verify before use',
  supplement: { mw: 46.006, tb_K: 294.3, tm_K: 261.9, tc_K: 431.0,
    pc_bar: 101.0, omega: 0.85, antoine: null,
    name: 'Nitrogen dioxide', formula: 'NO2', cas: '10102-44-0', category: 'gas' } }),

// ── WATER ──────────────────────────────────────────────────────────────────

H2O: C({ key: 'H2O', category: 'water',
  hf_gas_298: -241.83,                                 // [N]
  hf_liq_298: -285.83,                                 // [N]
  shomate: [ // [N] NIST WebBook water gas (lower bound 500 K per NIST) —
    // kept only for diagnostics; mb-engine routes ALL water through if97.js.
    SH(500, 1700, 30.09200, 6.832514, 6.793435, -2.534480, 0.082139, -250.8810, 223.3967, -241.8264),
    SH(1700, 6000, 41.96426, 8.622053, -1.499780, 0.098119, -11.15764, -272.1797, 219.7809, -241.8264),
  ],
  cp_liq_kjkgk: 4.18,                                  // [H] (IF97 supersedes)
  cp_sol_kjkgk: 2.09,                                  // [H] ice
  dhvap_tb: 40.65,                                     // [N] 373.15 K
  dhfus: 6.01,                                         // [N]
  data_quality: 'nist', source: '[N] all primaries',
  note: 'engine MUST route enthalpy via if97.js on the formation basis' }),

// ── SOLVENTS ───────────────────────────────────────────────────────────────

MeOH: C({ key: 'MeOH', category: 'solvent',
  hf_gas_298: -201.0, hf_liq_298: -239.1,              // [N]/[H]
  cp_svn: [2.211, 12.216e-3, -3.450e-6, 0],            // [S] Table C.1 methanol
  cp_liq_kjkgk: 2.53,                                  // [H]
  dhvap_tb: 35.21, dhfus: 3.22,                        // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

EtOH: C({ key: 'EtOH', category: 'solvent',
  hf_gas_298: -234.8, hf_liq_298: -277.6,              // [N]/[H]
  cp_svn: [3.518, 20.001e-3, -6.002e-6, 0],            // [S] Table C.1 ethanol
  cp_liq_kjkgk: 2.44,                                  // [H]
  dhvap_tb: 38.56, dhfus: 4.93,                        // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

acetone: C({ key: 'acetone', category: 'solvent',
  hf_gas_298: -217.1, hf_liq_298: -248.4,              // [H] CRC-class
  cp_svn: [5.12, 12.88e-3, 0, 0],                      // [E] linear fit to
  // Cp_ig ≈ 74.5 J/mol·K @298 and ≈150 @1000 K — TODO replace with a
  // published polynomial (SVN C.1 row not transcribed with confidence).
  cp_liq_kjkgk: 2.17,                                  // [H]
  dhvap_tb: 29.10, dhfus: 5.77,                        // [H]
  data_quality: 'estimated', source: '[H] Hf, latents; [E] gas Cp fit',
  note: 'TODO: replace cp_svn fit with published coefficients' }),

benzene: C({ key: 'benzene', category: 'solvent',
  hf_gas_298: 82.9, hf_liq_298: 49.0,                  // [N]/[H]
  cp_svn: [-0.206, 39.064e-3, -13.301e-6, 0],          // [S] Table C.1 benzene
  cp_liq_kjkgk: 1.74,                                  // [H]
  dhvap_tb: 30.72, dhfus: 9.87,                        // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

toluene: C({ key: 'toluene', category: 'solvent',
  hf_gas_298: 50.1, hf_liq_298: 12.0,                  // [N]/[H]
  cp_svn: [0.290, 47.052e-3, -15.716e-6, 0],           // [S] Table C.1 toluene
  cp_liq_kjkgk: 1.70,                                  // [H]
  dhvap_tb: 33.18, dhfus: 6.64,                        // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

nC6H14: C({ key: 'nC6H14', category: 'solvent',
  hf_gas_298: -167.1, hf_liq_298: -198.7,              // [N]/[H]
  cp_svn: [3.025, 53.722e-3, -16.791e-6, 0],           // [S] Table C.1 n-hexane
  cp_liq_kjkgk: 2.26,                                  // [H]
  dhvap_tb: 28.85, dhfus: 13.08,                       // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

nC7H16: C({ key: 'nC7H16', category: 'solvent',
  hf_gas_298: -187.7, hf_liq_298: -224.2,              // [N]/[H]
  cp_svn: [3.570, 62.127e-3, -19.486e-6, 0],           // [S] Table C.1 n-heptane
  cp_liq_kjkgk: 2.24,                                  // [H]
  dhvap_tb: 31.77, dhfus: 14.03,                       // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

AcOH: C({ key: 'AcOH', category: 'solvent',
  hf_gas_298: -432.2, hf_liq_298: -484.5,              // [H] CRC-class (monomer)
  cp_svn: [3.74, 13.06e-3, 0, 0],                      // [E] linear fit to
  // MONOMER Cp_ig ≈ 63.4 J/mol·K @298 — vapor-phase dimerization makes the
  // apparent Cp/ΔHvap strongly non-ideal; see note. TODO published poly.
  cp_liq_kjkgk: 2.05,                                  // [H]
  dhvap_tb: 23.70, dhfus: 11.73,                       // [H] (apparent ΔHvap —
  // low because the saturated vapor is dimer-rich)
  data_quality: 'estimated', source: '[H] Hf, latents; [E] gas Cp fit',
  note: 'vapor dimerization: gas-branch enthalpies are monomer-basis approximations' }),

MEA: C({ key: 'MEA', category: 'solvent',
  hf_liq_298: -507.5,                                  // [E] widely quoted; TODO
  // verify against a primary source before relying on MEA reaction duties.
  hf_gas_298: null,                                    // derive as liq + ΔHvap if needed
  cp_svn: [5.9, 21.8e-3, 0, 0],                        // [E] group-fit, Cp_ig≈103 @298
  cp_liq_kjkgk: 2.55,                                  // [H]
  dhvap_tb: 49.8,                                      // [E] TODO verify
  data_quality: 'estimated', source: '[E] Hf, dhvap, Cp fit; [H] cp_liq',
  note: 'TODO: verify hf_liq and dhvap_tb against primary literature' }),

MEG: C({ key: 'MEG', category: 'solvent',
  hf_liq_298: -454.8,                                  // [H] ethylene glycol
  hf_gas_298: -392.2,                                  // [H]
  cp_svn: [4.19, 17.42e-3, 0, 0],                      // [E] fit, Cp_ig≈78 @298
  cp_liq_kjkgk: 2.42,                                  // [H]
  dhvap_tb: 50.5,                                      // [E] conservative; TODO verify
  data_quality: 'estimated', source: '[H] Hf; [E] dhvap, Cp fit',
  note: 'TODO: verify dhvap_tb and gas Cp fit' }),

// ── EXTRA SOLVENT-CLASS (fluids.js keys, high-confidence caloric) ──────────

nC8H18: C({ key: 'nC8H18', category: 'solvent',
  hf_gas_298: -208.6, hf_liq_298: -250.1,              // [N]/[H]
  cp_svn: [4.108, 70.567e-3, -22.208e-6, 0],           // [S] Table C.1 n-octane
  cp_liq_kjkgk: 2.22,                                  // [H]
  dhvap_tb: 34.41,                                     // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, dhvap; [S] Cp' }),

cyclohexane: C({ key: 'cyclohexane', category: 'solvent',
  hf_gas_298: -123.1, hf_liq_298: -156.2,              // [N]/[H]
  cp_svn: [-3.876, 63.249e-3, -20.928e-6, 0],          // [S] Table C.1 cyclohexane
  cp_liq_kjkgk: 1.84,                                  // [H]
  dhvap_tb: 29.97, dhfus: 2.68,                        // [H]
  data_quality: 'handbook', source: '[N] Hf gas; [H] Hf liq, latents; [S] Cp' }),

C2H2: C({ key: 'C2H2', category: 'syngas',
  hf_gas_298: 227.4,                                   // [H] (sources 226.7–228.2)
  cp_svn: [6.132, 1.952e-3, 0, -1.299e5],              // [S] Table C.1 acetylene
  dhvap_tb: null,                                      // 1-atm point is sublimation
  data_quality: 'handbook', source: '[H] Hf; [S] Cp',
  note: 'no normal bp (sublimes); liquid branch via Trouton only, with warning' }),

// ── FERTILIZER CHAIN ───────────────────────────────────────────────────────

urea: C({ key: 'urea', category: 'fertilizer',
  hf_sol_298: -333.6,                                  // [H] CRC-class
  cp_sol_kjkgk: 1.55,                                  // [H] ≈93 J/mol·K / 60.06
  cp_liq_kjkgk: 2.1,                                   // [E] melt — TODO verify
  dhfus: 14.5,                                         // [H] (sources 13.6–15.1)
  nonvolatile: true,
  data_quality: 'handbook', source: '[H] Hf, cp_sol, dhfus; [E] cp melt',
  supplement: { mw: 60.056, tb_K: null, tm_K: 406.15, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Urea', formula: 'CH4N2O', cas: '57-13-6', category: 'fertilizer' } }),

amm_carbamate: C({ key: 'amm_carbamate', category: 'fertilizer',
  hf_sol_298: -645.1,                                  // [H] widely quoted for
  // NH2COONH4(s) — the urea-process anchor value.
  cp_sol_kjkgk: 1.67,                                  // [E] TODO verify
  nonvolatile: true,
  data_quality: 'handbook', source: '[H] Hf; [E] cp_sol',
  note: 'decomposes to 2NH3+CO2 above ~60 °C at 1 atm — no liquid/gas branch',
  supplement: { mw: 78.071, tb_K: null, tm_K: null, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Ammonium carbamate', formula: 'NH2COONH4', cas: '1111-78-0',
    category: 'fertilizer' } }),

biuret: C({ key: 'biuret', category: 'fertilizer',
  hf_sol_298: -563.0,                                  // [E] conservative — TODO
  // verify against a primary source; biuret Hf is poorly tabulated.
  cp_sol_kjkgk: 1.5,                                   // [E] TODO verify
  nonvolatile: true,
  data_quality: 'estimated', source: '[E] all — verify before use',
  note: 'TODO: hf_sol_298 requires literature confirmation',
  supplement: { mw: 103.081, tb_K: null, tm_K: 466.15, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Biuret', formula: 'C2H5N3O2', cas: '108-19-0',
    category: 'fertilizer' } }),

HNO3: C({ key: 'HNO3', category: 'fertilizer',
  hf_gas_298: -133.9, hf_liq_298: -174.1,              // [N]/[H]
  cp_svn: [4.5, 6.4e-3, 0, 0],                         // [E] fit, Cp_ig≈53.4 @298
  cp_liq_kjkgk: 1.74,                                  // [H] ≈110 J/mol·K / 63.01
  dhvap_tb: 39.1,                                      // [E] TODO verify at Tb 356 K
  data_quality: 'handbook', source: '[N]/[H] Hf; [E] Cp fit, dhvap',
  note: 'PURE acid; aqueous strengths live in fluids.js (hno3_65 etc.)',
  supplement: { mw: 63.013, tb_K: 356.15, tm_K: 231.55, tc_K: 520.0,
    pc_bar: 68.9, omega: 0.7, antoine: null,
    name: 'Nitric acid (pure)', formula: 'HNO3', cas: '7697-37-2',
    category: 'fertilizer' } }),

H2SO4: C({ key: 'H2SO4', category: 'fertilizer',
  hf_liq_298: -814.0,                                  // [N]
  hf_gas_298: -735.1,                                  // [H] (rarely needed)
  cp_liq_kjkgk: 1.42,                                  // [H] ≈139 J/mol·K / 98.08
  nonvolatile: true,                                   // negligible Psat in
  // process range; boils with decomposition ~610 K.
  data_quality: 'handbook', source: '[N] Hf liq; [H] rest',
  note: 'PURE acid; aqueous strengths live in fluids.js (h2so4_98 etc.)',
  supplement: { mw: 98.079, tb_K: 610.0, tm_K: 283.46, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Sulfuric acid (pure)', formula: 'H2SO4', cas: '7664-93-9',
    category: 'fertilizer' } }),

// ── SALTS / SOLIDS ─────────────────────────────────────────────────────────

NaOH: C({ key: 'NaOH', category: 'salt',
  hf_sol_298: -425.6,                                  // [N]
  cp_sol_kjkgk: 1.49,                                  // [H] ≈59.5 J/mol·K / 40.0
  dhfus: 6.6,                                          // [H] at Tm 596 K
  nonvolatile: true,
  data_quality: 'handbook', source: '[N] Hf; [H] cp, dhfus',
  note: 'PURE solid; caustic solutions live in fluids.js (naoh_30/50)',
  supplement: { mw: 39.997, tb_K: 1661.0, tm_K: 596.0, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Sodium hydroxide', formula: 'NaOH', cas: '1310-73-2',
    category: 'salt' } }),

NaCl: C({ key: 'NaCl', category: 'salt',
  hf_sol_298: -411.2,                                  // [N]
  cp_sol_kjkgk: 0.86,                                  // [H] ≈50.5 J/mol·K / 58.44
  dhfus: 28.16,                                        // [H] at Tm 1074 K
  nonvolatile: true,
  data_quality: 'handbook', source: '[N] Hf; [H] cp, dhfus',
  supplement: { mw: 58.443, tb_K: 1738.0, tm_K: 1073.8, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Sodium chloride', formula: 'NaCl', cas: '7647-14-5',
    category: 'salt' } }),

CaCO3: C({ key: 'CaCO3', category: 'salt',
  hf_sol_298: -1207.6,                                 // [H] calcite (sources
  // −1206.9…−1207.6; calcination duty CaCO3→CaO+CO2 = +178.8 with this set ✓)
  cp_sol_kjkgk: 0.82,                                  // [H] ≈83.5 J/mol·K / 100.09
  nonvolatile: true,
  data_quality: 'handbook', source: '[H] all',
  note: 'decomposes ~1170 K at 1 atm CO2 — no melt branch',
  supplement: { mw: 100.087, tb_K: null, tm_K: null, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Calcium carbonate (calcite)', formula: 'CaCO3', cas: '471-34-1',
    category: 'salt' } }),

CaO: C({ key: 'CaO', category: 'salt',
  hf_sol_298: -634.9,                                  // [N]
  cp_sol_kjkgk: 0.75,                                  // [H] ≈42 J/mol·K / 56.08
  nonvolatile: true,
  data_quality: 'handbook', source: '[N] Hf; [H] cp',
  supplement: { mw: 56.077, tb_K: null, tm_K: 2886.0, tc_K: null,
    pc_bar: null, omega: null, antoine: null, nonvolatile: true,
    name: 'Calcium oxide (quicklime)', formula: 'CaO', cas: '1305-78-8',
    category: 'salt' } }),

};

// ===========================================================================
// PUBLIC API
// ===========================================================================

/**
 * Caloric record by key.
 * @param {string} key
 * @returns {object|null}
 */
function get(key) { return DATA[key] || null; }

/** @returns {string[]} all caloric-layer keys */
function keys() { return Object.keys(DATA); }

/** @returns {number} record count */
function count() { return Object.keys(DATA).length; }

/**
 * Picker-safe metadata (NO coefficients) — the api router's Supabase-outage
 * fallback for GET ?module=components.
 * @returns {Array<{key,category,nonvolatile,data_quality,has_gas,has_liq,has_sol}>}
 */
function pickerFallback() {
  return Object.values(DATA).map(r => ({
    key: r.key, category: r.category, nonvolatile: r.nonvolatile,
    data_quality: r.data_quality,
    has_gas: r.hf_gas_298 != null,
    has_liq: r.hf_liq_298 != null || r.cp_liq_kjkgk != null,
    has_sol: r.hf_sol_298 != null,
  }));
}

module.exports = { DATA, get, keys, count, pickerFallback };
