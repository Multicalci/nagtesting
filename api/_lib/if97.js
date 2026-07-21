// ============================================================================
// REPO PATH: api/_lib/if97.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2)
// Water/steam property module — ported from the steam calculator's
// pure-Python core (api/steam-calcs.py, Jul 2026 build).
//
// ⚠ WHAT THIS ACTUALLY IS (data-honesty note — read before trusting the label)
// ---------------------------------------------------------------------------
// The attached Python file is titled "IAPWS-IF97" but is NOT the IF97 Gibbs
// free-energy formulation. It contains NO region-1/2 basis-function
// coefficient arrays (n_i, I_i, J_i), NO B23 boundary equation, and NO
// region-4 saturation polynomial. It is a LOOKUP-TABLE + INTERPOLATION model:
//     • _SAT : 53-point saturation table (P, T, hf, hg, sf, sg, vf, vg),
//              linear interpolation by P or by T.
//     • _SH  : 13-pressure superheated table, bilinear interpolation in (P,T).
//     • Compressed liquid : saturated-liquid props at the ACTUAL T plus a
//              Poynting pressure correction  h = hf(T) + vf(T)·(P − Psat(T)).
// The Python header states its own accuracy as ±0.05% on h,s (±0.1% on v).
// That is fine for the enthalpy/energy balances this engine performs, and it
// is consistent with the final report's "steam duties <0.1%" claim — but it
// is a TABLE APPROXIMATION, not formulation-grade IF97. Do not represent this
// module as rigorous IF97 to end users; the UI data-quality tag for water
// should read 'handbook', not 'nist'.
//
// This is a MECHANICAL TRANSLATION of that Python core: same tables (copied
// verbatim), same bracket/interpolation arithmetic, same compressed-liquid
// Poynting branch, same ±0.05-band phase split. It is NOT re-derived. The
// selfTest() below verifies the JS reproduces the Python outputs; its
// acceptance threshold (<0.001 kJ/kg) measures PORT FIDELITY (JS vs Python),
// NOT accuracy versus true IF97.
//
// NOTE ON tsat/psat: the sibling steam-calculators.js carries a genuine
// IAPWS saturation-pressure correlation (Wagner-class), which is more
// accurate than this table's Tsat/Psat. It is deliberately NOT used here so
// the port stays an exact translation of the Python (which uses the table).
// If the owner later wants the better saturation curve, swap tsat_K/psat_bar
// only — and re-freeze the regression vectors in the same commit.
//
// EXPORTS (base-SI per spec):
//   h_kJkg(T_K, P_bar)   → specific enthalpy [kJ/kg]
//   s_kJkgK(T_K, P_bar)  → specific entropy  [kJ/kg·K]
//   tsat_K(P_bar)        → saturation temperature [K]
//   psat_bar(T_K)        → saturation pressure [bar]
//   hf_hg(P_bar)         → { hf, hg } saturated liquid/vapour enthalpy [kJ/kg]
//   region(T_K, P_bar)   → IF97-style region integer (1 liquid / 2 vapour /
//                          4 saturation; 0 = outside table / supercritical)
//   selfTest()           → { pass, maxAbsDev, results[] }
//
// Reference state: IAPWS convention — hf = sf = 0 for saturated liquid at the
// triple point (0.01 °C). mb-engine maps this to the formation basis via
//   h_water = hf_liq_298 + [ h_if97(T,P) − h_if97(298.15 K, Psat) ].
//
// Dependency-free. Plain ES2020 / CommonJS. (c) multicalci.com
// ============================================================================

'use strict';

// ---------------------------------------------------------------------------
// TABLES — copied VERBATIM from api/steam-calcs.py (_SAT, _SH). Do not edit
// values without re-generating the regression vectors from the Python source.
// _SAT columns: [ P_bar, T_C, hf, hg, sf, sg, vf, vg ]
// _SH entries : { P: bar, d: [ [ T_C, h, s, v ], ... ] }
// ---------------------------------------------------------------------------
const _SAT = [[0.00611, 0.01, 0.0, 2501.4, 0.0, 9.1562, 0.0010002, 206.14], [0.01, 6.98, 29.3, 2514.2, 0.1059, 8.9756, 0.0010001, 129.208], [0.015, 13.03, 54.7, 2525.3, 0.1956, 8.8278, 0.0010007, 87.98], [0.02, 17.5, 73.47, 2533.5, 0.2607, 8.7236, 0.0010013, 67.006], [0.03, 24.08, 101.03, 2545.5, 0.3545, 8.5775, 0.0010028, 45.665], [0.04, 28.96, 121.44, 2554.4, 0.4226, 8.4746, 0.0010041, 34.797], [0.05, 32.88, 137.79, 2561.4, 0.4763, 8.395, 0.0010053, 28.193], [0.075, 40.29, 168.76, 2574.8, 0.5763, 8.2514, 0.001008, 19.238], [0.1, 45.81, 191.81, 2584.6, 0.6492, 8.1501, 0.0010103, 14.674], [0.15, 53.97, 225.9, 2599.1, 0.7548, 8.0084, 0.0010146, 10.021], [0.2, 60.06, 251.38, 2609.7, 0.8319, 7.9085, 0.0010182, 7.649], [0.3, 69.1, 289.21, 2625.3, 0.9439, 7.7686, 0.0010243, 5.229], [0.5, 81.33, 340.47, 2645.9, 1.091, 7.5939, 0.0010341, 3.24], [0.7, 89.95, 376.7, 2660.1, 1.1919, 7.479, 0.0010416, 2.365], [1.0, 99.62, 417.44, 2675.5, 1.3025, 7.3593, 0.0010432, 1.694], [1.25, 105.99, 444.3, 2685.3, 1.3739, 7.2843, 0.0010479, 1.375], [1.5, 111.37, 467.08, 2693.5, 1.4335, 7.2232, 0.0010524, 1.159], [2.0, 120.23, 504.68, 2706.6, 1.53, 7.1271, 0.0010605, 0.8857], [2.5, 127.43, 535.34, 2716.9, 1.6072, 7.0526, 0.0010681, 0.7187], [3.0, 133.55, 561.45, 2725.3, 1.6717, 6.9918, 0.0010732, 0.6058], [4.0, 143.63, 604.73, 2738.5, 1.7766, 6.8958, 0.001084, 0.4624], [5.0, 151.86, 640.21, 2748.7, 1.8606, 6.8212, 0.001094, 0.3748], [6.0, 158.85, 670.54, 2756.8, 1.9311, 6.76, 0.0011006, 0.3156], [7.0, 164.97, 697.2, 2763.5, 1.9922, 6.708, 0.001108, 0.2728], [8.0, 170.43, 721.1, 2769.1, 2.0461, 6.6627, 0.0011148, 0.2404], [9.0, 175.38, 742.82, 2773.9, 2.0946, 6.6225, 0.0011213, 0.215], [10.0, 179.91, 762.79, 2778.1, 2.1386, 6.5864, 0.0011273, 0.1944], [12.0, 187.99, 798.64, 2784.8, 2.2165, 6.5233, 0.001139, 0.1633], [15.0, 198.32, 844.87, 2792.1, 2.315, 6.4448, 0.0011565, 0.1318], [20.0, 212.42, 908.77, 2799.5, 2.4473, 6.3408, 0.0011767, 0.0996], [25.0, 223.99, 962.09, 2803.1, 2.5546, 6.2574, 0.0011972, 0.08], [30.0, 233.9, 1008.41, 2804.1, 2.6456, 6.1869, 0.0012163, 0.0666], [35.0, 242.6, 1049.75, 2803.8, 2.7253, 6.1253, 0.0012347, 0.0571], [40.0, 250.4, 1087.29, 2801.4, 2.7963, 6.07, 0.0012524, 0.0498], [50.0, 263.99, 1154.21, 2794.3, 2.9201, 5.9733, 0.0012859, 0.0394], [60.0, 275.64, 1213.32, 2784.3, 3.0248, 5.8902, 0.001319, 0.0324], [70.0, 285.88, 1266.97, 2772.1, 3.121, 5.8132, 0.0013524, 0.0274], [80.0, 295.06, 1316.61, 2757.9, 3.2076, 5.745, 0.0013843, 0.0235], [90.0, 303.4, 1363.26, 2742.8, 3.2857, 5.6811, 0.0014184, 0.0205], [100.0, 311.06, 1407.53, 2724.7, 3.3595, 5.614, 0.0014526, 0.018], [110.0, 318.15, 1450.26, 2705.0, 3.4295, 5.5473, 0.001489, 0.016], [120.0, 324.75, 1491.24, 2684.8, 3.4961, 5.4923, 0.0015267, 0.0143], [130.0, 330.93, 1531.46, 2662.9, 3.5605, 5.4295, 0.001567, 0.0127], [140.0, 336.75, 1570.98, 2638.7, 3.6229, 5.3717, 0.0016107, 0.0115], [150.0, 342.24, 1609.02, 2614.5, 3.6834, 5.3108, 0.0016582, 0.0103], [160.0, 347.44, 1649.55, 2580.6, 3.7428, 5.2455, 0.0017105, 0.0094], [170.0, 352.37, 1690.73, 2548.5, 3.7996, 5.1832, 0.0017651, 0.0084], [180.0, 357.06, 1731.97, 2509.1, 3.8553, 5.1044, 0.0018403, 0.0075], [190.0, 361.54, 1776.53, 2468.4, 3.9102, 5.0218, 0.0019262, 0.0067], [200.0, 365.81, 1826.18, 2409.7, 4.0139, 4.9269, 0.002036, 0.0059], [210.0, 369.89, 1886.25, 2336.8, 4.1014, 4.8013, 0.002213, 0.0051], [220.0, 373.71, 2010.3, 2192.4, 4.2887, 4.5481, 0.00279, 0.0038], [220.64, 374.14, 2099.26, 2099.3, 4.412, 4.412, 0.003155, 0.0032]];

const _SH = [{"P": 1.0, "d": [[100.0, 2676.2, 7.361, 1.696], [150.0, 2776.5, 7.615, 1.937], [200.0, 2875.5, 7.835, 2.172], [250.0, 2974.5, 8.033, 2.406], [300.0, 3074.3, 8.217, 2.639], [350.0, 3175.8, 8.39, 2.871], [400.0, 3279.6, 8.545, 3.103], [500.0, 3488.1, 8.834, 3.565], [600.0, 3705.4, 9.102, 4.028], [700.0, 3928.7, 9.352, 4.49], [800.0, 4159.0, 9.586, 4.952]]}, {"P": 5.0, "d": [[152.0, 2748.7, 6.821, 0.375], [200.0, 2855.4, 7.059, 0.425], [250.0, 2961.0, 7.272, 0.474], [300.0, 3064.2, 7.46, 0.523], [350.0, 3168.1, 7.633, 0.57], [400.0, 3272.3, 7.794, 0.617], [500.0, 3484.9, 8.087, 0.711], [600.0, 3704.3, 8.352, 0.804], [700.0, 3927.1, 8.605, 0.897], [800.0, 4157.8, 8.84, 0.99]]}, {"P": 10.0, "d": [[180.0, 2778.1, 6.587, 0.1944], [200.0, 2827.9, 6.694, 0.206], [250.0, 2942.6, 6.925, 0.2328], [300.0, 3051.2, 7.123, 0.2579], [350.0, 3157.7, 7.301, 0.2825], [400.0, 3264.5, 7.465, 0.3066], [500.0, 3478.5, 7.762, 0.3541], [600.0, 3697.9, 8.029, 0.4011], [700.0, 3922.5, 8.281, 0.4479], [800.0, 4154.5, 8.516, 0.4945]]}, {"P": 20.0, "d": [[213.0, 2799.5, 6.341, 0.0996], [250.0, 2902.5, 6.545, 0.1114], [300.0, 3023.5, 6.768, 0.1255], [350.0, 3137.0, 6.958, 0.1385], [400.0, 3248.7, 7.127, 0.152], [500.0, 3467.6, 7.432, 0.1757], [600.0, 3687.9, 7.702, 0.1996], [700.0, 3913.3, 7.955, 0.2233], [800.0, 4142.0, 8.192, 0.2467]]}, {"P": 40.0, "d": [[251.0, 2801.4, 6.07, 0.0498], [300.0, 2962.0, 6.362, 0.0589], [350.0, 3092.5, 6.584, 0.0666], [400.0, 3213.6, 6.771, 0.0734], [500.0, 3445.3, 7.09, 0.0864], [600.0, 3670.3, 7.369, 0.0989], [700.0, 3894.9, 7.624, 0.1112], [800.0, 4122.0, 7.861, 0.1234]]}, {"P": 60.0, "d": [[276.0, 2784.3, 5.89, 0.0324], [300.0, 2885.5, 6.07, 0.0362], [350.0, 3043.4, 6.336, 0.0421], [400.0, 3178.3, 6.545, 0.0474], [500.0, 3422.2, 6.883, 0.0567], [600.0, 3658.4, 7.169, 0.0653], [700.0, 3876.1, 7.428, 0.0736], [800.0, 4095.0, 7.667, 0.0818]]}, {"P": 80.0, "d": [[295.0, 2758.4, 5.745, 0.0235], [300.0, 2786.5, 5.794, 0.0243], [350.0, 2988.1, 6.132, 0.0299], [400.0, 3139.4, 6.366, 0.0343], [500.0, 3398.3, 6.727, 0.0398], [600.0, 3633.2, 7.059, 0.048], [700.0, 3857.2, 7.321, 0.0543], [800.0, 4074.0, 7.562, 0.0604]]}, {"P": 100.0, "d": [[311.0, 2725.5, 5.614, 0.018], [350.0, 2924.5, 5.945, 0.0228], [400.0, 3096.5, 6.212, 0.0264], [450.0, 3249.0, 6.419, 0.0297], [500.0, 3374.2, 6.599, 0.0328], [600.0, 3625.3, 6.903, 0.0384], [700.0, 3838.2, 7.176, 0.0427], [800.0, 4053.0, 7.418, 0.0487]]}, {"P": 120.0, "d": [[325.0, 2684.9, 5.492, 0.0143], [360.0, 2820.0, 5.752, 0.0165], [400.0, 3051.6, 6.004, 0.0208], [450.0, 3215.9, 6.233, 0.0236], [500.0, 3350.7, 6.425, 0.0262], [600.0, 3582.3, 6.742, 0.0308], [700.0, 3793.5, 7.027, 0.0351], [800.0, 4032.0, 7.271, 0.0405]]}, {"P": 140.0, "d": [[337.0, 2637.6, 5.372, 0.0115], [360.0, 2753.0, 5.581, 0.0132], [400.0, 3001.9, 5.845, 0.0166], [450.0, 3182.5, 6.086, 0.0191], [500.0, 3323.1, 6.285, 0.0214], [600.0, 3541.2, 6.604, 0.026], [700.0, 3762.2, 6.898, 0.0302], [800.0, 4011.0, 7.143, 0.0352]]}, {"P": 160.0, "d": [[347.0, 2580.6, 5.246, 0.0093], [380.0, 2745.0, 5.508, 0.0115], [400.0, 2947.0, 5.693, 0.0132], [450.0, 3146.1, 5.951, 0.0157], [500.0, 3295.0, 6.156, 0.0178], [600.0, 3561.1, 6.513, 0.0214], [700.0, 3732.3, 6.781, 0.0256], [800.0, 3989.0, 7.029, 0.0302]]}, {"P": 180.0, "d": [[357.0, 2509.1, 5.104, 0.0075], [390.0, 2748.0, 5.484, 0.01], [400.0, 2880.1, 5.554, 0.0107], [450.0, 3104.9, 5.827, 0.013], [500.0, 3266.1, 6.037, 0.0149], [600.0, 3542.0, 6.409, 0.0181], [700.0, 3701.4, 6.657, 0.0218], [800.0, 3968.0, 6.909, 0.026]]}, {"P": 200.0, "d": [[366.0, 2409.7, 4.927, 0.0059], [395.0, 2702.0, 5.378, 0.0085], [400.0, 2818.1, 5.472, 0.0099], [450.0, 3060.1, 5.796, 0.0121], [500.0, 3239.3, 6.018, 0.0145], [600.0, 3532.0, 6.336, 0.0175], [700.0, 3670.6, 6.589, 0.021], [800.0, 3947.0, 6.845, 0.0249]]}];

// ---------------------------------------------------------------------------
// INTERPOLATION CORE — faithful ports of the Python helpers.
// ---------------------------------------------------------------------------

/**
 * Binary search for the bracketing index pair in a sorted 2-D table.
 * Port of Python _find_bracket. Returns [lo, lo+1].
 * @param {number[][]} arr sorted table
 * @param {number} val value to bracket
 * @param {number} col column index to search on
 * @returns {[number, number]}
 */
function _findBracket(arr, val, col) {
  let lo = 0;
  let hi = arr.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid][col] <= val) lo = mid;
    else hi = mid - 1;
  }
  return [lo, lo + 1];
}

/**
 * Interpolate the saturation table by pressure. Port of Python _sat_by_P.
 * Clamps P into table range, returns all 8 interpolated columns.
 * @param {number} P_bar
 * @returns {number[]} [P_bar, T_C, hf, hg, sf, sg, vf, vg]
 */
function _satByP(P_bar) {
  P_bar = Math.max(_SAT[0][0], Math.min(_SAT[_SAT.length - 1][0], P_bar));
  const [lo, hi] = _findBracket(_SAT, P_bar, 0);
  const denom = _SAT[hi][0] - _SAT[lo][0];
  const t = denom !== 0 ? (P_bar - _SAT[lo][0]) / denom : 0;
  const out = new Array(8);
  for (let i = 0; i < 8; i++) out[i] = _SAT[lo][i] + t * (_SAT[hi][i] - _SAT[lo][i]);
  return out;
}

/**
 * Interpolate the saturation table by temperature. Port of Python _sat_by_T.
 * @param {number} T_C
 * @returns {number[]} [P_bar, T_C, hf, hg, sf, sg, vf, vg]
 */
function _satByT(T_C) {
  T_C = Math.max(_SAT[0][1], Math.min(_SAT[_SAT.length - 1][1], T_C));
  const [lo, hi] = _findBracket(_SAT, T_C, 1);
  const denom = _SAT[hi][1] - _SAT[lo][1];
  const t = denom !== 0 ? (T_C - _SAT[lo][1]) / denom : 0;
  const out = new Array(8);
  for (let i = 0; i < 8; i++) out[i] = _SAT[lo][i] + t * (_SAT[hi][i] - _SAT[lo][i]);
  return out;
}

/**
 * Interpolate one superheated pressure block at a temperature.
 * Port of Python inner interp_at_P: clamps to the block's T ends, else lerps.
 * @param {{P:number,d:number[][]}} entry
 * @param {number} T_C
 * @returns {[number, number, number]} [h, s, v]
 */
function _interpAtP(entry, T_C) {
  const d = entry.d;
  if (T_C <= d[0][0]) return [d[0][1], d[0][2], d[0][3]];
  const last = d.length - 1;
  if (T_C >= d[last][0]) return [d[last][1], d[last][2], d[last][3]];
  let i = 0;
  for (let j = 0; j < d.length - 1; j++) {
    if (d[j][0] <= T_C && T_C <= d[j + 1][0]) { i = j; break; }
  }
  const t = (T_C - d[i][0]) / (d[i + 1][0] - d[i][0]);
  return [
    d[i][1] + t * (d[i + 1][1] - d[i][1]),
    d[i][2] + t * (d[i + 1][2] - d[i][2]),
    d[i][3] + t * (d[i + 1][3] - d[i][3]),
  ];
}

/**
 * Bilinear interpolation in the superheated table. Port of Python _sh_by_PT.
 * Clamps to the P ends of the table (no extrapolation).
 * @param {number} P_bar
 * @param {number} T_C
 * @returns {[number, number, number]} [h, s, v]
 */
function _shByPT(P_bar, T_C) {
  const Ps = _SH.map(e => e.P);
  let pi0;
  let pi1;
  if (P_bar <= Ps[0]) { pi0 = 0; pi1 = 0; }
  else if (P_bar >= Ps[Ps.length - 1]) { pi0 = Ps.length - 1; pi1 = Ps.length - 1; }
  else {
    pi0 = 0;
    for (let j = 0; j < Ps.length - 1; j++) {
      if (Ps[j] <= P_bar && P_bar <= Ps[j + 1]) { pi0 = j; break; }
    }
    pi1 = pi0 + 1;
  }
  const [h0, s0, v0] = _interpAtP(_SH[pi0], T_C);
  if (pi0 === pi1) return [h0, s0, v0];
  const [h1, s1, v1] = _interpAtP(_SH[pi1], T_C);
  const t = (P_bar - Ps[pi0]) / (Ps[pi1] - Ps[pi0]);
  return [h0 + t * (h1 - h0), s0 + t * (s1 - s0), v0 + t * (v1 - v0)];
}

// ---------------------------------------------------------------------------
// STATE RESOLUTION — port of the IAPWS97(P,T) property path.
// Returns { h, s, v, phase } for a (T,P) point: superheated vapour if T is
// above Tsat(P) by the source's 0.05 °C band, else compressed liquid via the
// Poynting correction anchored at saturated-liquid props at the ACTUAL T.
// ---------------------------------------------------------------------------

/**
 * @param {number} T_K
 * @param {number} P_bar
 * @returns {{h:number, s:number, v:number, phase:('gas'|'liquid')}}
 */
function _statePT(T_K, P_bar) {
  const T_C = T_K - 273.15;
  const T_sat_C = _satByP(P_bar)[1];
  if (T_C > T_sat_C + 0.05) {
    const [h, s, v] = _shByPT(P_bar, T_C);
    return { h, s, v, phase: 'gas' };
  }
  // Compressed / subcooled liquid: sat-liquid props at the actual T + Poynting.
  const rowT = _satByT(Math.min(Math.max(T_C, 0.01), 373.9));
  const Psat_bar = rowT[0];
  const hf = rowT[2];
  const sf = rowT[4];
  const vf = rowT[6];
  const dP_kPa = (P_bar - Psat_bar) * 100.0;   // bar → kPa
  const h = hf + vf * dP_kPa;                   // vf[m3/kg]·kPa = kJ/kg
  return { h, s: sf, v: vf, phase: 'liquid' };  // s ~ pressure-independent
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Specific enthalpy of water/steam at (T, P). IAPWS reference (hf=0 @ triple).
 * @param {number} T_K temperature [K]
 * @param {number} P_bar pressure [bar absolute]
 * @returns {number} enthalpy [kJ/kg]
 */
function h_kJkg(T_K, P_bar) { return _statePT(T_K, P_bar).h; }

/**
 * Specific entropy of water/steam at (T, P).
 * @param {number} T_K temperature [K]
 * @param {number} P_bar pressure [bar absolute]
 * @returns {number} entropy [kJ/kg·K]
 */
function s_kJkgK(T_K, P_bar) { return _statePT(T_K, P_bar).s; }

/**
 * Saturation temperature at a pressure (table interpolation).
 * @param {number} P_bar [bar]
 * @returns {number} Tsat [K]
 */
function tsat_K(P_bar) { return _satByP(P_bar)[1] + 273.15; }

/**
 * Saturation pressure at a temperature (table interpolation).
 * @param {number} T_K [K]
 * @returns {number} Psat [bar]
 */
function psat_bar(T_K) { return _satByT(T_K - 273.15)[0]; }

/**
 * Saturated liquid / vapour enthalpy at a pressure.
 * @param {number} P_bar [bar]
 * @returns {{hf:number, hg:number}} [kJ/kg]
 */
function hf_hg(P_bar) {
  const row = _satByP(P_bar);
  return { hf: row[2], hg: row[3] };
}

/**
 * IF97-style region classification for a (T,P) point, derived from the same
 * Tsat comparison the source uses. This is a STRUCTURAL mapping of the
 * table model, not an IF97 boundary evaluation.
 *   1 = compressed / subcooled liquid   (T below Tsat by >0.05 °C)
 *   2 = superheated vapour              (T above Tsat by >0.05 °C)
 *   4 = saturation / two-phase          (|T − Tsat| ≤ 0.05 °C)
 *   0 = outside the table envelope (T ≥ critical 374.14 °C, or P beyond
 *       0.00611–220.64 bar) — caller should treat as unsupported.
 * @param {number} T_K [K]
 * @param {number} P_bar [bar]
 * @returns {number} region integer
 */
function region(T_K, P_bar) {
  const T_C = T_K - 273.15;
  if (T_C >= 374.14) return 0;                       // at/above critical T
  if (P_bar < _SAT[0][0] || P_bar > _SAT[_SAT.length - 1][0]) return 0;
  const T_sat_C = _satByP(P_bar)[1];
  if (T_C > T_sat_C + 0.05) return 2;
  if (T_C < T_sat_C - 0.05) return 1;
  return 4;
}

// ---------------------------------------------------------------------------
// REGRESSION — outputs captured from api/steam-calcs.py at build time, across
// region 1 (liquid), region 2 (superheated) and region 4 (saturation).
// selfTest() recomputes each via the exports above and reports max |dev|.
// Because this is the same interpolation arithmetic, deviations are
// floating-point-scale; the <0.001 acceptance measures PORT FIDELITY.
// Each row: { call, args, region, expect, desc }.  expect units follow call:
//   h_kJkg → kJ/kg ; s_kJkgK → kJ/kg·K ; tsat_K → K ; psat_bar → bar ;
//   hf_hg.hf / hf_hg.hg → kJ/kg.
// ---------------------------------------------------------------------------
const REGRESSION = [
  { call:'h_kJkg', args:[298.15, 10.0], region:1, expect:105.877634, desc:'25C/10bar liq (298 anchor)' },
  { call:'s_kJkgK', args:[298.15, 10.0], region:1, expect:0.367339, desc:'25C/10bar liq (298 anchor)' },
  { call:'h_kJkg', args:[298.15, 1.0], region:1, expect:104.974893, desc:'25C/1bar liq' },
  { call:'s_kJkgK', args:[298.15, 1.0], region:1, expect:0.367339, desc:'25C/1bar liq' },
  { call:'h_kJkg', args:[373.15, 10.0], region:1, expect:419.9799, desc:'100C/10bar liq' },
  { call:'s_kJkgK', args:[373.15, 10.0], region:1, expect:1.306759, desc:'100C/10bar liq' },
  { call:'h_kJkg', args:[423.15, 50.0], region:1, expect:637.128937, desc:'150C/50bar liq' },
  { call:'s_kJkgK', args:[423.15, 50.0], region:1, expect:1.841616, desc:'150C/50bar liq' },
  { call:'h_kJkg', args:[298.15, 100.0], region:1, expect:114.905039, desc:'25C/100bar liq Poynting' },
  { call:'s_kJkgK', args:[298.15, 100.0], region:1, expect:0.367339, desc:'25C/100bar liq Poynting' },
  { call:'h_kJkg', args:[573.15, 10.0], region:2, expect:3051.2, desc:'300C/10bar sh' },
  { call:'s_kJkgK', args:[573.15, 10.0], region:2, expect:7.123, desc:'300C/10bar sh' },
  { call:'h_kJkg', args:[673.15, 40.0], region:2, expect:3213.6, desc:'400C/40bar sh' },
  { call:'s_kJkgK', args:[673.15, 40.0], region:2, expect:6.771, desc:'400C/40bar sh' },
  { call:'h_kJkg', args:[773.15, 100.0], region:2, expect:3374.2, desc:'500C/100bar sh' },
  { call:'s_kJkgK', args:[773.15, 100.0], region:2, expect:6.599, desc:'500C/100bar sh' },
  { call:'h_kJkg', args:[523.15, 5.0], region:2, expect:2961.0, desc:'250C/5bar sh' },
  { call:'s_kJkgK', args:[523.15, 5.0], region:2, expect:7.272, desc:'250C/5bar sh' },
  { call:'h_kJkg', args:[873.15, 1.0], region:2, expect:3705.4, desc:'600C/1bar sh' },
  { call:'s_kJkgK', args:[873.15, 1.0], region:2, expect:9.102, desc:'600C/1bar sh' },
  { call:'tsat_K', args:[1.0], region:4, expect:372.77, desc:'tsat 1 bar' },
  { call:'tsat_K', args:[10.0], region:4, expect:453.06, desc:'tsat 10 bar' },
  { call:'tsat_K', args:[100.0], region:4, expect:584.21, desc:'tsat 100 bar' },
  { call:'psat_bar', args:[373.15], region:4, expect:1.014914, desc:'psat 373.15 K' },
  { call:'psat_bar', args:[473.15], region:4, expect:15.595745, desc:'psat 473.15 K' },
  { call:'psat_bar', args:[573.15], region:4, expect:85.923261, desc:'psat 573.15 K' },
  { call:'hf_hg.hf', args:[10.0], region:4, expect:762.79, desc:'hf 10 bar' },
  { call:'hf_hg.hg', args:[10.0], region:4, expect:2778.1, desc:'hg 10 bar' },
  { call:'hf_hg.hf', args:[50.0], region:4, expect:1154.21, desc:'hf 50 bar' },
  { call:'hf_hg.hg', args:[50.0], region:4, expect:2794.3, desc:'hg 50 bar' },
];

/**
 * Dispatch a regression row's call string to the matching export.
 * @param {{call:string,args:number[]}} row
 * @returns {number}
 */
function _invoke(row) {
  switch (row.call) {
    case 'h_kJkg':   return h_kJkg(row.args[0], row.args[1]);
    case 's_kJkgK':  return s_kJkgK(row.args[0], row.args[1]);
    case 'tsat_K':   return tsat_K(row.args[0]);
    case 'psat_bar': return psat_bar(row.args[0]);
    case 'hf_hg.hf': return hf_hg(row.args[0]).hf;
    case 'hf_hg.hg': return hf_hg(row.args[0]).hg;
    default: throw new Error('IF97_SELFTEST: unknown call ' + row.call);
  }
}

/**
 * Recompute every regression point and report the maximum absolute deviation
 * from the embedded Python outputs. Acceptance: maxAbsDev < 0.001 (port
 * fidelity — NOT accuracy versus formulation-grade IF97).
 * @returns {{pass:boolean, maxAbsDev:number,
 *            results:Array<{desc:string,region:number,call:string,
 *                           expect:number,actual:number,dev:number,ok:boolean}>}}
 */
function selfTest() {
  const TOL = 0.001;
  let maxAbsDev = 0;
  const results = REGRESSION.map(row => {
    let actual;
    let ok;
    let dev;
    try {
      actual = _invoke(row);
      dev = Math.abs(actual - row.expect);
      ok = isFinite(dev) && dev < TOL;
    } catch (err) {
      actual = NaN; dev = NaN; ok = false;
    }
    if (isFinite(dev) && dev > maxAbsDev) maxAbsDev = dev;
    return {
      desc: row.desc, region: row.region, call: row.call,
      expect: row.expect, actual, dev, ok,
    };
  });
  return { pass: results.every(r => r.ok), maxAbsDev, results };
}

export default {
  h_kJkg,
  s_kJkgK,
  tsat_K,
  psat_bar,
  hf_hg,
  region,
  selfTest,
  // exposed for mb-engine reuse / debugging (do not mutate):
  _satByP,
  _satByT,
};
