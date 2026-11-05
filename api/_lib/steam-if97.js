// ============================================================================
// REPO PATH: api/_lib/steam-if97.js
// ============================================================================
// multicalci.com — water and steam properties, IAPWS-IF97.
//
// One implementation of the IAPWS Industrial Formulation 1997 shared by the
// flowsheet simulator, the material-balance engine and (in its Python twin,
// api/steam-calcs.py) the steam calculators:
//   region 1  compressed liquid            (Gibbs energy g(p,T), 34 terms)
//   region 2  superheated steam            (g(p,T), ideal 9 + residual 43 terms)
//   region 3  near-critical fluid          (Helmholtz energy f(ρ,T), 40 terms;
//             (p,T) states found by solving p(ρ,T) = p on the right branch)
//   region 4  saturation line              (p_sat(T), T_sat(p))
//   region 5  high-temperature steam       (g(p,T), 1073.15–2273.15 K, ≤ 50 MPa)
//   B23       region 2/3 boundary
// Coefficients: IAPWS R7-97(2012), "Revised Release on the IAPWS Industrial
// Formulation 1997 for the Thermodynamic Properties of Water and Steam".
// Transport: viscosity IAPWS R12-08 (industrial form, no critical term),
// thermal conductivity IAPWS R15-11 (industrial form with the critical
// enhancement), surface tension IAPWS R1-76(2014).
// Verified against the release's own verification tables (selfTest below).
//
// Units: p in MPa, T in K, h in kJ/kg, s in kJ/(kg·K), v in m³/kg, ρ in kg/m³,
// cp/cv in kJ/(kg·K), w in m/s, μ in Pa·s, λ in W/(m·K), σ in N/m.
// Range: 273.15 K ≤ T ≤ 1073.15 K, p ≤ 100 MPa; 1073.15 K < T ≤ 2273.15 K,
// p ≤ 50 MPa. Out-of-range input throws a RangeError with a plain message.
//
// Plain ES module, no dependencies, server-side only. (c) multicalci.com
// ============================================================================

export const IF97_VERSION = 'steam-if97 1.1.0';
export const R = 0.461526;          // kJ/(kg·K), specific gas constant of IF97
export const TC = 647.096;          // K
export const PC = 22.064;           // MPa
export const RHOC = 322;            // kg/m³
export const PT = 611.657e-6;       // MPa, triple point
export const PMIN = 611.213e-6;     // MPa, saturation pressure at 273.15 K
export const MW = 18.015268;        // g/mol (IF97: R = 8.314371 / 18.015268)

// ---------------------------------------------------------------------------
// coefficients (IAPWS R7-97(2012), Tables 2, 10, 11, 30, 37, 38)
// ---------------------------------------------------------------------------
const R1_I = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 8, 8, 21, 23, 29, 30, 31, 32];
const R1_J = [-2, -1, 0, 1, 2, 3, 4, 5, -9, -7, -1, 0, 1, 3, -3, 0, 1, 3, 17, -4, 0, 6, -5, -2, 10, -8, -11, -6, -29, -31, -38, -39, -40, -41];
const R1_N = [0.14632971213167, -0.84548187169114, -3.756360367204, 3.3855169168385, -0.95791963387872, 0.15772038513228, -0.016616417199501, 0.00081214629983568, 0.00028319080123804, -0.00060706301565874, -0.018990068218419, -0.032529748770505, -0.021841717175414, -5.283835796993e-05, -0.00047184321073267, -0.00030001780793026, 4.7661393906987e-05, -4.4141845330846e-06, -7.2694996297594e-16, -3.1679644845054e-05, -2.8270797985312e-06, -8.5205128120103e-10, -2.2425281908e-06, -6.5171222895601e-07, -1.4341729937924e-13, -4.0516996860117e-07, -1.2734301741641e-09, -1.7424871230634e-10, -6.8762131295531e-19, 1.4478307828521e-20, 2.6335781662795e-23, -1.1947622640071e-23, 1.8228094581404e-24, -9.3537087292458e-26];
const R2_J0 = [0, 1, -5, -4, -3, -2, -1, 2, 3];
const R2_N0 = [-9.6927686500217, 10.086655968018, -0.005608791128302, 0.071452738081455, -0.40710498223928, 1.4240819171444, -4.383951131945, -0.28408632460772, 0.021268463753307];
const R2_I = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10, 10, 10, 16, 16, 18, 20, 20, 20, 21, 22, 23, 24, 24, 24];
const R2_J = [0, 1, 2, 3, 6, 1, 2, 4, 7, 36, 0, 1, 3, 6, 35, 1, 2, 3, 7, 3, 16, 35, 0, 11, 25, 8, 36, 13, 4, 10, 14, 29, 50, 57, 20, 35, 48, 21, 53, 39, 26, 40, 58];
const R2_N = [-0.0017731742473213, -0.017834862292358, -0.045996013696365, -0.057581259083432, -0.05032527872793, -3.3032641670203e-05, -0.00018948987516315, -0.0039392777243355, -0.043797295650573, -2.6674547914087e-05, 2.0481737692309e-08, 4.3870667284435e-07, -3.227767723857e-05, -0.0015033924542148, -0.040668253562649, -7.8847309559367e-10, 1.2790717852285e-08, 4.8225372718507e-07, 2.2922076337661e-06, -1.6714766451061e-11, -0.0021171472321355, -23.895741934104, -5.905956432427e-18, -1.2621808899101e-06, -0.038946842435739, 1.1256211360459e-11, -8.2311340897998, 1.9809712802088e-08, 1.0406965210174e-19, -1.0234747095929e-13, -1.0018179379511e-09, -8.0882908646985e-11, 0.10693031879409, -0.33662250574171, 8.9185845355421e-25, 3.0629316876232e-13, -4.2002467698208e-06, -5.9056029685639e-26, 3.7826947613457e-06, -1.2768608934681e-15, 7.3087610595061e-29, 5.5414715350778e-17, -9.436970724121e-07];
const R3_I = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9, 9, 10, 10, 11];
const R3_J = [0, 1, 2, 7, 10, 12, 23, 2, 6, 15, 17, 0, 2, 6, 7, 22, 26, 0, 2, 4, 16, 26, 0, 2, 4, 26, 1, 3, 26, 0, 2, 26, 2, 26, 2, 26, 0, 1, 26];
const R3_N = [-15.732845290239, 20.944396974307, -7.6867707878716, 2.6185947787954, -2.808078114862, 1.2053369696517, -0.0084566812812502, -1.2654315477714, -1.1524407806681, 0.88521043984318, -0.64207765181607, 0.38493460186671, -0.85214708824206, 4.8972281541877, -3.0502617256965, 0.039420536879154, 0.12558408424308, -0.2799932969871, 1.389979956946, -2.018991502357, -0.0082147637173963, -0.47596035734923, 0.0439840744735, -0.44476435428739, 0.90572070719733, 0.70522450087967, 0.10770512626332, -0.32913623258954, -0.50871062041158, -0.022175400873096, 0.094260751665092, 0.16436278447961, -0.013503372241348, -0.014834345352472, 0.00057922953628084, 0.0032308904703711, 8.0964802996215e-05, -0.00016557679795037, -4.4923899061815e-05];
const R5_J0 = [0, 1, -3, -2, -1, 2];
const R5_N0 = [-13.179983674201, 6.8540841634434, -0.024805148933466, 0.36901534980333, -3.1161318213925, -0.32961626538917];
const R5_I = [1, 1, 1, 2, 2, 3];
const R5_J = [1, 2, 3, 3, 9, 7];
const R5_N = [0.0015736404855259, 0.00090153761673944, -0.0050270077677648, 2.2440037409485e-06, -4.1163275453471e-06, 3.7919454822955e-08];
const R3_N1 = 1.0658070028513;
const R4_N = [0, 0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5,
  -0.32325550322333e7, 0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6,
  -0.23855557567849, 0.65017534844798e3];
const B23_N = [0.34805185628969e3, -0.11671859879975e1, 0.10192970039326e-2, 0.57254459862746e3, 0.13918839778870e2];

const range = (msg) => { throw new RangeError(msg); };
const fmtT = (T) => `${(T - 273.15).toFixed(2)} °C`;
const fmtP = (p) => `${(p * 10).toPrecision(5)} bar`;

// ---------------------------------------------------------------------------
// region 4 — saturation line and the B23 boundary
// ---------------------------------------------------------------------------
/** Saturation pressure [MPa] at T [K] (273.15 K ≤ T ≤ 647.096 K). */
export function psat(T) {
  if (!(T >= 273.15 && T <= TC)) range(`saturation needs 0–373.946 °C (got ${fmtT(T)})`);
  const n = R4_N;
  const th = T + n[9] / (T - n[10]);
  const A = th * th + n[1] * th + n[2];
  const B = n[3] * th * th + n[4] * th + n[5];
  const C = n[6] * th * th + n[7] * th + n[8];
  return Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4);
}
/** Saturation temperature [K] at p [MPa] (611.213 Pa ≤ p ≤ 22.064 MPa). */
export function tsat(p) {
  if (!(p >= PMIN * 0.999999 && p <= PC)) range(`saturation needs 0.00611–220.64 bar (got ${fmtP(p)})`);
  const n = R4_N;
  const b = Math.pow(p, 0.25);
  const E = b * b + n[3] * b + n[6];
  const F = n[1] * b * b + n[4] * b + n[7];
  const G = n[2] * b * b + n[5] * b + n[8];
  const D = 2 * G / (-F - Math.sqrt(F * F - 4 * E * G));
  return (n[10] + D - Math.sqrt((n[10] + D) * (n[10] + D) - 4 * (n[9] + n[10] * D))) / 2;
}
/** Region 2/3 boundary pressure [MPa] at T [K]. */
export function p23(T) { return B23_N[0] + B23_N[1] * T + B23_N[2] * T * T; }
/** Region 2/3 boundary temperature [K] at p [MPa]. */
export function t23(p) { return B23_N[3] + Math.sqrt((p - B23_N[4]) / B23_N[2]); }

// ---------------------------------------------------------------------------
// basic equations — each returns the full property set of one state
// ---------------------------------------------------------------------------
function gibbsState(region, T, p, g, gp, gpp, gt, gtt, gpt, pi, tau) {
  // dimensionless Gibbs derivatives with respect to π and τ → properties
  const v = pi * gp * R * T / (p * 1000);
  const h = tau * gt * R * T;
  const s = R * (tau * gt - g);
  const u = R * T * (tau * gt - pi * gp);
  const cp = -R * tau * tau * gtt;
  const cv = R * (-tau * tau * gtt + (gp - tau * gpt) * (gp - tau * gpt) / gpp);
  const w = Math.sqrt(R * T * 1000 * gp * gp / ((gp - tau * gpt) * (gp - tau * gpt) / (tau * tau * gtt) - gpp));
  const kt = -pi * gpp / gp / p;                      // 1/MPa
  const alfav = (1 - tau * gpt / gp) / T;             // 1/K
  return { region, T, p, v, rho: 1 / v, h, s, u, cp, cv, w, kt, alfav };
}

/** Region 1, compressed liquid. */
export function region1(T, p) {
  const pi = p / 16.53, tau = 1386 / T;
  const a = 7.1 - pi, b = tau - 1.222;
  let g = 0, gp = 0, gpp = 0, gt = 0, gtt = 0, gpt = 0;
  for (let k = 0; k < 34; k++) {
    const I = R1_I[k], J = R1_J[k], n = R1_N[k];
    const aI = Math.pow(a, I), bJ = Math.pow(b, J);
    const aI1 = Math.pow(a, I - 1), bJ1 = Math.pow(b, J - 1);
    g += n * aI * bJ;
    gp -= n * I * aI1 * bJ;
    gpp += n * I * (I - 1) * Math.pow(a, I - 2) * bJ;
    gt += n * J * aI * bJ1;
    gtt += n * J * (J - 1) * aI * Math.pow(b, J - 2);
    gpt -= n * I * J * aI1 * bJ1;
  }
  return gibbsState(1, T, p, g, gp, gpp, gt, gtt, gpt, pi, tau);
}

/** Region 2 (and the ideal-gas form of region 5): γ = γ° + γʳ. */
function gibbsIdealPlusResidual(region, T, p, tau, J0, N0, I, J, N, tauShift) {
  const pi = p;
  let g0 = Math.log(pi), g0t = 0, g0tt = 0;
  for (let k = 0; k < J0.length; k++) {
    g0 += N0[k] * Math.pow(tau, J0[k]);
    g0t += N0[k] * J0[k] * Math.pow(tau, J0[k] - 1);
    g0tt += N0[k] * J0[k] * (J0[k] - 1) * Math.pow(tau, J0[k] - 2);
  }
  const g0p = 1 / pi, g0pp = -1 / (pi * pi);
  const b = tau - tauShift;
  let gr = 0, grp = 0, grpp = 0, grt = 0, grtt = 0, grpt = 0;
  for (let k = 0; k < I.length; k++) {
    const i = I[k], j = J[k], n = N[k];
    const pI = Math.pow(pi, i), pI1 = Math.pow(pi, i - 1);
    const bJ = Math.pow(b, j), bJ1 = Math.pow(b, j - 1);
    gr += n * pI * bJ;
    grp += n * i * pI1 * bJ;
    grpp += n * i * (i - 1) * Math.pow(pi, i - 2) * bJ;
    grt += n * pI * j * bJ1;
    grtt += n * pI * j * (j - 1) * Math.pow(b, j - 2);
    grpt += n * i * pI1 * j * bJ1;
  }
  const v = pi * (g0p + grp) * R * T / (p * 1000);
  const h = R * T * tau * (g0t + grt);
  const s = R * (tau * (g0t + grt) - (g0 + gr));
  const u = R * T * (tau * (g0t + grt) - pi * (g0p + grp));
  const cp = -R * tau * tau * (g0tt + grtt);
  const A = 1 + pi * grp - tau * pi * grpt;
  const cv = R * (-tau * tau * (g0tt + grtt) - A * A / (1 - pi * pi * grpp));
  const w = Math.sqrt(R * T * 1000 * (1 + 2 * pi * grp + pi * pi * grp * grp)
    / ((1 - pi * pi * grpp) + A * A / (tau * tau * (g0tt + grtt))));
  const kt = (1 - pi * pi * grpp) / (1 + pi * grp) / p;
  const alfav = A / (1 + pi * grp) / T;
  return { region, T, p, v, rho: 1 / v, h, s, u, cp, cv, w, kt, alfav };
}
/** Region 2, steam. */
export function region2(T, p) {
  return gibbsIdealPlusResidual(2, T, p, 540 / T, R2_J0, R2_N0, R2_I, R2_J, R2_N, 0.5);
}
/**
 * Second virial coefficient of steam from the region-2 residual (the terms
 * with I = 1): B = (R T / p*) Σ n (τ − 0.5)^J, p* = 1 MPa. Returns B and dB/dT
 * in m³/kg and m³/(kg K). Used by the free-water option of the cubic
 * equations of state (mb-thermo.js, STEP 32).
 * @param {number} T K
 * @returns {{B:number, dBdT:number}}
 */
export function secondVirial(T) {
  const tau = 540 / T, b = tau - 0.5;
  let s = 0, ds = 0;                         // Σ n b^J and d/dτ
  for (let k = 0; k < R2_I.length; k++) {
    if (R2_I[k] !== 1) continue;
    s += R2_N[k] * Math.pow(b, R2_J[k]);
    ds += R2_N[k] * R2_J[k] * Math.pow(b, R2_J[k] - 1);
  }
  const B = R * T / 1000 * s;                 // kJ/(kg K)·K / (1000 kPa) → m³/kg
  const dBdT = R / 1000 * s + R * T / 1000 * ds * (-540 / (T * T));
  return { B, dBdT };
}
/** Region 5, high-temperature steam. */
export function region5(T, p) {
  return gibbsIdealPlusResidual(5, T, p, 1000 / T, R5_J0, R5_N0, R5_I, R5_J, R5_N, 0);
}
/** Ideal-gas part of region 2 at T (p in MPa): h°, s° — used to anchor other enthalpy bases. */
export function idealGas(T, p) {
  const tau = 540 / T;
  let g0 = Math.log(p), g0t = 0, g0tt = 0;
  for (let k = 0; k < R2_J0.length; k++) {
    g0 += R2_N0[k] * Math.pow(tau, R2_J0[k]);
    g0t += R2_N0[k] * R2_J0[k] * Math.pow(tau, R2_J0[k] - 1);
    g0tt += R2_N0[k] * R2_J0[k] * (R2_J0[k] - 1) * Math.pow(tau, R2_J0[k] - 2);
  }
  return { h: R * T * tau * g0t, s: R * (tau * g0t - g0), cp: -R * tau * tau * g0tt };
}

/** Region 3 at density ρ [kg/m³] and T [K]: Helmholtz form. */
export function region3(rho, T) {
  const d = rho / RHOC, tau = TC / T;
  let f = R3_N1 * Math.log(d), fd = R3_N1 / d, fdd = -R3_N1 / (d * d), ft = 0, ftt = 0, fdt = 0;
  for (let k = 0; k < 39; k++) {
    const I = R3_I[k], J = R3_J[k], n = R3_N[k];
    const dI = Math.pow(d, I), dI1 = Math.pow(d, I - 1);
    const tJ = Math.pow(tau, J), tJ1 = Math.pow(tau, J - 1);
    f += n * dI * tJ;
    fd += n * I * dI1 * tJ;
    fdd += n * I * (I - 1) * Math.pow(d, I - 2) * tJ;
    ft += n * J * dI * tJ1;
    ftt += n * J * (J - 1) * dI * Math.pow(tau, J - 2);
    fdt += n * I * J * dI1 * tJ1;
  }
  const p = rho * R * T * d * fd / 1000;
  const h = R * T * (tau * ft + d * fd);
  const s = R * (tau * ft - f);
  const u = R * T * tau * ft;
  const cv = -R * tau * tau * ftt;
  const X = d * fd - d * tau * fdt, Y = 2 * d * fd + d * d * fdd;
  const cp = R * (-tau * tau * ftt + X * X / Y);
  const w = Math.sqrt(Math.max(0, R * T * 1000 * (Y - X * X / (tau * tau * ftt))));
  const kt = 1000 / (rho * R * T * Y);                // 1/MPa
  const alfav = (fd - tau * fdt) / (2 * fd + d * fdd) / T;
  return { region: 3, T, p, v: 1 / rho, rho, h, s, u, cp, cv, w, kt, alfav };
}

// ---------------------------------------------------------------------------
// region 3 at (p, T): p(ρ, T) = p on the liquid-like or vapour-like branch
// ---------------------------------------------------------------------------
// p and ∂p/∂ρ of region 3 at (ρ, T)
function p3(rho, T) {
  const d = rho / RHOC, tau = TC / T;
  let fd = R3_N1 / d, fdd = -R3_N1 / (d * d);
  for (let k = 0; k < 39; k++) {
    const I = R3_I[k];
    if (!I) continue;
    const t = R3_N[k] * Math.pow(tau, R3_J[k]);
    fd += t * I * Math.pow(d, I - 1);
    fdd += t * I * (I - 1) * Math.pow(d, I - 2);
  }
  const p = rho * R * T * d * fd / 1000;
  const dp = R * T * (2 * d * fd + d * d * fdd) / 1000;     // MPa per kg/m³
  return [p, dp];
}
const lastRho = { liquid: null, vapour: null };
function rootRho(T, p, branch) {
  const f = (r) => p3(r, T)[0] - p;
  // warm start: Newton from the last root of this branch (flash iterations move T and p
  // only a little); accepted only if it converges with ∂p/∂ρ > 0 on the right side of ρc
  const last = lastRho[branch];
  if (last && Math.abs(last.T - T) < 30) {
    let r = last.rho;
    for (let k = 0; k < 25; k++) {
      const [pp, dp] = p3(r, T);
      if (!(dp > 0)) break;
      const step = (pp - p) / dp;
      const rn = r - step;
      if (!(rn > 1e-6 && rn < 800)) break;
      r = rn;
      if (Math.abs(step) < 1e-12 * r) {
        const ok = branch === 'liquid' ? (T >= TC || r > RHOC * 0.98) : (T >= TC || r < RHOC * 1.02);
        if (ok && p3(r, T)[1] > 0) { last.T = T; last.rho = r; return r; }
        break;
      }
    }
  }
  let lo, hi;
  if (branch === 'liquid') {
    // walk down from a density where p(ρ) is above p; the first crossing is the stable
    // liquid root (p(ρ) falls monotonically to the liquid spinodal). The region-3 equation
    // is only valid to ρ ≈ 765 kg/m³ (623.15 K, 100 MPa: 762 kg/m³); beyond ~800 it turns over.
    hi = 790;
    if (!(f(hi) > 0)) range(`region 3: pressure ${fmtP(p)} at ${fmtT(T)} is above the formulation's range`);
    for (let k = 0; ; k++) {
      lo = hi * 0.93;
      if (lo < 100 || k > 60) range(`region 3: no liquid root at ${fmtT(T)}, ${fmtP(p)}`);
      if (f(lo) < 0) break;
      hi = lo;
    }
  } else {
    // vapour-like or supercritical: walk up from below the ideal-gas density
    lo = 0.4 * p * 1000 / (R * T);
    if (!(f(lo) < 0)) lo *= 0.25;
    for (let k = 0; ; k++) {
      hi = lo * 1.12;
      if (hi > 800 || k > 80) range(`region 3: no vapour root at ${fmtT(T)}, ${fmtP(p)}`);
      if (f(hi) > 0) break;
      lo = hi;
    }
  }
  // Newton inside the bracket, bisection when a step leaves it
  let r = 0.5 * (lo + hi);
  for (let k = 0; k < 100; k++) {
    const [pp, dp] = p3(r, T);
    const fr = pp - p;
    if (fr < 0) lo = r; else hi = r;
    let rn = dp > 0 ? r - fr / dp : NaN;
    if (!(rn > lo && rn < hi)) rn = 0.5 * (lo + hi);
    if (Math.abs(rn - r) < 1e-13 * r || hi - lo < 1e-13 * hi) { r = rn; break; }
    r = rn;
  }
  lastRho[branch] = { T, rho: r };
  return r;
}

/** Region (1, 2, 3 or 5) of a (p, T) state. */
export function regionPT(p, T) {
  if (!(T >= 273.15 - 1e-9)) range(`water/steam properties need T ≥ 0 °C (got ${fmtT(T)})`);
  if (!(T <= 2273.15)) range(`water/steam properties need T ≤ 2000 °C (got ${fmtT(T)})`);
  if (!(p > 0)) range('pressure must be positive');
  if (T > 1073.15) {
    if (p > 50) range(`above 800 °C the formulation covers p ≤ 500 bar (got ${fmtP(p)})`);
    return 5;
  }
  if (p > 100) range(`the formulation covers p ≤ 1000 bar (got ${fmtP(p)})`);
  if (T <= 623.15) return p >= psat(Math.max(T, 273.15)) ? 1 : 2;
  if (T <= 863.15 && p > p23(T)) return 3;
  return 2;
}

function phaseOf(st) {
  if (st.T >= TC && st.p >= PC) return 'supercritical';
  if (st.region === 1) return 'liquid';
  if (st.region === 3) return st.T < TC && st.p >= psat(st.T) ? 'liquid' : (st.p >= PC ? 'liquid' : 'vapour');
  return 'vapour';
}

/** Single-phase state at (p [MPa], T [K]). */
export function pt(p, T) {
  const r = regionPT(p, T);
  let st;
  if (r === 1) st = region1(Math.max(T, 273.15), p);
  else if (r === 2) st = region2(T, p);
  else if (r === 5) st = region5(T, p);
  else {
    const liquidSide = T < TC ? p >= psat(T) : false;
    st = region3(rootRho(T, p, liquidSide ? 'liquid' : 'vapour'), T);
    st.p = p;
  }
  st.phase = phaseOf(st);
  st.x = st.phase === 'liquid' ? 0 : st.phase === 'vapour' ? 1 : null;
  return st;
}

/** Saturated liquid and vapour at T [K]: { T, p, liq, vap }. */
export function satT(T) {
  if (T > TC - 1e-9 && T <= TC) T = TC - 1e-9;
  const p = psat(T);
  let liq, vap;
  if (T <= 623.15) { liq = region1(T, p); vap = region2(T, p); }
  else {
    liq = region3(rootRho(T, p, 'liquid'), T); liq.p = p;
    vap = region3(rootRho(T, p, 'vapour'), T); vap.p = p;
  }
  liq.phase = 'liquid'; liq.x = 0; vap.phase = 'vapour'; vap.x = 1;
  return { T, p, liq, vap };
}
/** Saturated liquid and vapour at p [MPa]. */
export function satP(p) {
  const s = satT(tsat(p));
  s.p = p; s.liq.p = p; s.vap.p = p;
  return s;
}

// branch-forced single-phase properties (used by the flashes so that a state on the
// liquid side of the dome never lands in region 2 by round-off, and vice versa; the
// flowsheet's steam package also uses them for the liquid and vapour of a saturated
// state and, a little way past the saturation line, for metastable phases)
export function liquidSide(p, T) {
  if (T <= 623.15) return region1(Math.max(T, 273.15), p);
  if (T < TC) { const st = region3(rootRho(T, p, 'liquid'), T); st.p = p; return st; }
  return pt(p, T);
}
export function vapourSide(p, T) {
  if (T > 1073.15) return region5(T, p);
  if (T <= 623.15 || T > 863.15 || p <= p23(T)) return region2(T, p);
  const st = region3(rootRho(T, p, 'vapour'), T); st.p = p; return st;
}

function mix(sat, x) {
  const L = sat.liq, V = sat.vap;
  const v = L.v + x * (V.v - L.v);
  return {
    region: 4, T: sat.T, p: sat.p, x, phase: x <= 0 ? 'liquid' : x >= 1 ? 'vapour' : 'two-phase',
    v, rho: 1 / v, h: L.h + x * (V.h - L.h), s: L.s + x * (V.s - L.s), u: L.u + x * (V.u - L.u),
    cp: null, cv: null, w: null, kt: null, alfav: null, liq: L, vap: V,
  };
}
/** Saturated mixture at T [K] with vapour quality x (0–1). */
export function tx(T, x) {
  if (!(x >= 0 && x <= 1)) range('steam quality must be 0–1');
  return mix(satT(T), x);
}
/** Saturated mixture at p [MPa] with vapour quality x (0–1). */
export function px(p, x) {
  if (!(x >= 0 && x <= 1)) range('steam quality must be 0–1');
  return mix(satP(p), x);
}

// one-dimensional root in T (Brent-style: secant with bisection safeguard)
function solveT(fn, a, b, target, what) {
  let fa = fn(a) - target, fb = fn(b) - target;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if ((fa < 0) === (fb < 0)) range(what);
  for (let k = 0; k < 200; k++) {
    let m = a - fa * (b - a) / (fb - fa);
    if (!(m > Math.min(a, b) && m < Math.max(a, b)) || k % 4 === 3) m = 0.5 * (a + b);
    const fm = fn(m) - target;
    if (Math.abs(fm) < 1e-12 * Math.max(1, Math.abs(target)) || Math.abs(b - a) < 1e-11) return m;
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else { b = m; fb = fm; }
  }
  return 0.5 * (a + b);
}

function flashBy(p, target, key) {
  if (!(p > 0)) range('pressure must be positive');
  const Tmax = p <= 50 ? 2273.15 : 1073.15;
  if (p > 100) range(`the formulation covers p ≤ 1000 bar (got ${fmtP(p)})`);
  const label = key === 'h' ? 'enthalpy' : 'entropy';
  if (p < PC && p >= PMIN) {
    const sat = satP(p);
    const yl = sat.liq[key], yv = sat.vap[key];
    if (target < yl) {
      const T = solveT((t) => liquidSide(p, t)[key], 273.15, sat.T, target, `${label} below that of water at 0 °C and ${fmtP(p)}`);
      const st = liquidSide(p, T); st.p = p; st.phase = 'liquid'; st.x = 0; return st;
    }
    if (target > yv) {
      const T = solveT((t) => vapourSide(p, t)[key], sat.T, Tmax, target, `${label} above the formulation's range at ${fmtP(p)}`);
      const st = vapourSide(p, T); st.p = p; st.phase = phaseOf(st); st.x = 1; return st;
    }
    return mix(sat, (target - yl) / (yv - yl));
  }
  if (p < PMIN) range(`pressure below the triple-point pressure (got ${fmtP(p)})`);
  const T = solveT((t) => pt(p, t)[key], 273.15, Tmax, target, `${label} outside the formulation's range at ${fmtP(p)}`);
  return pt(p, T);
}
/** State at p [MPa] and specific enthalpy h [kJ/kg] (two-phase gives the quality x). */
export function ph(p, h) { return flashBy(p, h, 'h'); }
/** State at p [MPa] and specific entropy s [kJ/(kg·K)]. */
export function ps(p, s) { return flashBy(p, s, 's'); }

// ---------------------------------------------------------------------------
// transport properties
// ---------------------------------------------------------------------------
const MU_H0 = [1.67752, 2.20462, 0.6366564, -0.241605];
const MU_H = [
  [0.520094, 0.222531, -0.281378, 0.161913, -0.0325372, 0, 0],
  [0.0850895, 0.999115, -0.906851, 0.257399, 0, 0, 0],
  [-1.08374, 1.88797, -0.772479, 0, 0, 0, 0],
  [-0.289555, 1.26613, -0.489837, 0, 0.0698452, 0, -0.00435673],
  [0, 0, -0.25704, 0, 0, 0.00872102, 0],
  [0, 0.120573, 0, 0, 0, 0, -0.000593264],
];
/** Dynamic viscosity [Pa·s] at ρ [kg/m³], T [K] — IAPWS R12-08, industrial form (μ₂ = 1). */
export function viscosity(rho, T) {
  const Tr = T / TC, dr = rho / RHOC;
  let s0 = 0; for (let i = 0; i < 4; i++) s0 += MU_H0[i] / Math.pow(Tr, i);
  const mu0 = 100 * Math.sqrt(Tr) / s0;
  let s1 = 0;
  for (let i = 0; i < 6; i++) {
    const ti = Math.pow(1 / Tr - 1, i);
    for (let j = 0; j < 7; j++) if (MU_H[i][j]) s1 += MU_H[i][j] * ti * Math.pow(dr - 1, j);
  }
  return mu0 * Math.exp(dr * s1) * 1e-6;
}
const K_L0 = [2.443221e-3, 1.323095e-2, 6.770357e-3, -3.454586e-3, 4.096266e-4];
const K_L = [
  [1.60397357, -0.646013523, 0.111443906, 0.102997357, -0.0504123634, 0.00609859258],
  [2.33771842, -2.78843778, 1.53616167, -0.463045512, 0.0832827019, -0.00719201245],
  [2.19650529, -4.54580785, 3.55777244, -1.40944978, 0.275418278, -0.0205938816],
  [-1.21051378, 1.60812989, -0.621178141, 0.0716373224, 0, 0],
  [-2.720337, 4.57586331, -3.18369245, 1.1168348, -0.19268305, 0.012913842],
];
const K_A = [
  [6.53786807199516, -5.61149954923348, 3.39624167361325, -2.27492629730878, 10.2631854662709, 1.97815050331519],
  [6.52717759281799, -6.30816983387575, 8.08379285492595, -9.82240510197603, 12.1358413791395, -5.54349664571295],
  [5.35500529896124, -3.96415689925446, 8.91990208918795, -12.033872950579, 9.19494865194302, -2.16866274479712],
  [1.55225959906681, 0.464621290821181, 8.93237374861479, -11.0321960061126, 6.1678099993336, -0.965458722086812],
  [1.11999926419994, 0.595748562571649, 9.8895256507892, -10.325505114704, 4.66861294457414, -0.503243546373828],
];
/**
 * Thermal conductivity [W/(m·K)] — IAPWS R15-11 industrial form. With a single-phase
 * state (from pt / ph / ps) the critical enhancement is included; with (ρ, T) only it is not.
 */
export function conductivity(rho, T, st) {
  const Tr = T / TC, d = rho / RHOC;
  let s0 = 0; for (let i = 0; i < 5; i++) s0 += K_L0[i] / Math.pow(Tr, i);
  const k0 = Math.sqrt(Tr) / s0;
  let s1 = 0;
  for (let i = 0; i < 5; i++) {
    const ti = Math.pow(1 / Tr - 1, i);
    for (let j = 0; j < 6; j++) if (K_L[i][j]) s1 += K_L[i][j] * ti * Math.pow(d - 1, j);
  }
  const k1 = Math.exp(d * s1);
  let k2 = 0;
  if (st && rho > 0 && st.cp && st.cv && st.kt) {
    const ai = d <= 0.310559006 ? K_A[0] : d <= 0.776397516 ? K_A[1] : d <= 1.242236025 ? K_A[2] : d <= 1.863354037 ? K_A[3] : K_A[4];
    let sa = 0; for (let i = 0; i < 6; i++) sa += ai[i] * Math.pow(d, i);
    const drhoRef = 1 / sa * RHOC / PC;              // (∂ρ/∂p)_T at the reference temperature, industrial form
    const drho = rho * st.kt;                        // (∂ρ/∂p)_T, kg/(m³·MPa)
    const dX = Math.max(0, d * (PC / RHOC * drho - PC / RHOC * drhoRef * 1.5 / Tr));
    const xi = 0.13 * Math.pow(dX / 0.06, 0.63 / 1.239);
    const y = xi / 0.4;
    if (y >= 1.2e-7) {
      const kap = st.cp / st.cv;
      const Z = 2 / Math.PI / y * (((1 - 1 / kap) * Math.atan(y) + y / kap) - (1 - Math.exp(-1 / (1 / y + y * y / 3 / (d * d)))));
      const mu = viscosity(rho, T);
      k2 = 177.8514 * d * st.cp / 0.46151805 * Tr / (mu * 1e6) * Z;
    }
  }
  return (k0 * k1 + k2) * 1e-3;
}
/** Surface tension [N/m] of the saturated liquid at T [K] — IAPWS R1-76(2014). */
export function surfaceTension(T) {
  if (!(T < TC)) return 0;
  const tau = 1 - T / TC;
  return 0.2358 * Math.pow(tau, 1.256) * (1 - 0.625 * tau);
}
/** Adds μ, λ, Prandtl number and (at saturation) σ to a single-phase state. */
export function withTransport(st) {
  if (!st || st.phase === 'two-phase' || !(st.rho > 0)) return st;
  st.mu = viscosity(st.rho, st.T);
  st.k = conductivity(st.rho, st.T, st);
  st.Pr = st.cp && st.k ? st.cp * 1000 * st.mu / st.k : null;
  return st;
}

// ---------------------------------------------------------------------------
// verification — IAPWS R7-97(2012) Tables 5, 15, 33, 35, 36 and 42; R12-08 Table 4;
// R15-11 Table 4. Expected values are the release's published numbers.
// ---------------------------------------------------------------------------
export const VERIFY = [
  ['r1', 300, 3, { v: 0.100215168e-2, h: 0.115331273e3, u: 0.112324818e3, s: 0.392294792, cp: 0.417301218e1, w: 0.150773921e4 }],
  ['r1', 300, 80, { v: 0.971180894e-3, h: 0.184142828e3, u: 0.106448356e3, s: 0.368563852, cp: 0.401008987e1, w: 0.163469054e4 }],
  ['r1', 500, 3, { v: 0.120241800e-2, h: 0.975542239e3, u: 0.971934985e3, s: 0.258041912e1, cp: 0.465580682e1, w: 0.124071337e4 }],
  ['r2', 300, 0.0035, { v: 0.394913866e2, h: 0.254991145e4, u: 0.241169160e4, s: 0.852238967e1, cp: 0.191300162e1, w: 0.427920172e3 }],
  ['r2', 700, 0.0035, { v: 0.923015898e2, h: 0.333568375e4, u: 0.301262819e4, s: 0.101749996e2, cp: 0.208141274e1, w: 0.644289068e3 }],
  ['r2', 700, 30, { v: 0.542946619e-2, h: 0.263149474e4, u: 0.246861076e4, s: 0.517540298e1, cp: 0.103505092e2, w: 0.480386523e3 }],
  ['r3', 650, 500, { p: 0.255837018e2, h: 0.186343019e4, u: 0.181226279e4, s: 0.405427273e1, cp: 0.138935717e2, w: 0.502005554e3 }],
  ['r3', 650, 200, { p: 0.222930643e2, h: 0.237512401e4, u: 0.226365868e4, s: 0.485438792e1, cp: 0.446579342e2, w: 0.383444594e3 }],
  ['r3', 750, 500, { p: 0.783095639e2, h: 0.225868845e4, u: 0.210206932e4, s: 0.446971906e1, cp: 0.634165359e1, w: 0.760696041e3 }],
  ['r5', 1500, 0.5, { v: 0.138455090e1, h: 0.521976855e4, u: 0.452749310e4, s: 0.965408875e1, cp: 0.261609445e1, w: 0.917068690e3 }],
  ['r5', 1500, 30, { v: 0.230761299e-1, h: 0.516723514e4, u: 0.447495124e4, s: 0.772970133e1, cp: 0.272724317e1, w: 0.928548002e3 }],
  ['r5', 2000, 30, { v: 0.311385219e-1, h: 0.657122604e4, u: 0.563707038e4, s: 0.853640523e1, cp: 0.288569882e1, w: 0.106736948e4 }],
  ['psat', 300, null, 0.353658941e-2], ['psat', 500, null, 0.263889776e1], ['psat', 600, null, 0.123443146e2],
  ['tsat', null, 0.1, 0.372755919e3], ['tsat', null, 1, 0.453035632e3], ['tsat', null, 10, 0.584149488e3],
  ['p23', 623.15, null, 0.165291643e2], ['t23', null, 0.165291643e2, 0.62315e3],
  ['mu', 298.15, 998, 889.7351e-6], ['mu', 298.15, 1200, 1437.649467e-6], ['mu', 373.15, 1000, 307.883622e-6],
  ['mu', 433.15, 1, 14.538324e-6], ['mu', 873.15, 1, 32.619287e-6], ['mu', 873.15, 100, 35.802262e-6],
  ['mu', 873.15, 600, 77.430195e-6], ['mu', 1173.15, 1, 44.217245e-6], ['mu', 1173.15, 100, 47.640433e-6], ['mu', 1173.15, 400, 64.154608e-6],
  ['k', 298.15, 0, 18.4341883e-3], ['k', 298.15, 998, 607.712868e-3], ['k', 298.15, 1200, 799.038144e-3], ['k', 873.15, 0, 79.1034659e-3],
];
/** Recomputes the verification table; returns { pass, worst, rows }. */
export function selfTest() {
  const rows = [];
  let worst = 0;
  const chk = (label, got, exp) => {
    const rel = Math.abs(got / exp - 1);
    worst = Math.max(worst, rel);
    rows.push({ label, got, exp, rel, ok: rel < 2e-8 * 50 });
  };
  for (const [kind, a, b, exp] of VERIFY) {
    if (kind === 'r1' || kind === 'r2' || kind === 'r5') {
      const st = (kind === 'r1' ? region1 : kind === 'r2' ? region2 : region5)(a, b);
      for (const k of Object.keys(exp)) chk(`${kind} ${a} K ${b} MPa ${k}`, st[k], exp[k]);
    } else if (kind === 'r3') {
      const st = region3(b, a);
      for (const k of Object.keys(exp)) chk(`r3 ${a} K ${b} kg/m3 ${k}`, st[k], exp[k]);
    } else if (kind === 'psat') chk(`psat ${a} K`, psat(a), exp);
    else if (kind === 'tsat') chk(`tsat ${b} MPa`, tsat(b), exp);
    else if (kind === 'p23') chk('p23 623.15 K', p23(a), exp);
    else if (kind === 't23') chk('t23 16.529 MPa', t23(b), exp);
    else if (kind === 'mu') chk(`mu ${a} K ${b} kg/m3`, viscosity(b, a), exp);
    else if (kind === 'k') chk(`k ${a} K ${b} kg/m3`, conductivity(b, a), exp);
  }
  return { pass: rows.every((r) => r.ok), worst, rows };
}

export default {
  IF97_VERSION, R, TC, PC, RHOC, PT, PMIN, MW,
  psat, tsat, p23, t23, region1, region2, region3, region5, idealGas, regionPT, secondVirial,
  pt, ph, ps, tx, px, satT, satP, liquidSide, vapourSide, viscosity, conductivity, surfaceTension, withTransport,
  VERIFY, selfTest,
};
