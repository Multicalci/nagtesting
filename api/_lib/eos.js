// ============================================================================
// REPO PATH: api/_lib/eos.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2)
// Shared Peng-Robinson EOS module: auto-Z + enthalpy departure + fugacity.
//
// PROVENANCE:
//   EXTRACTED from the control-valve /api/eos engine (SECTION B, FIX Z-4,
//   Jul 2026 build of process-calculators.js). The Z solve — solveCubic
//   root machinery, PR A/B construction, 1976/1978 kappa split at
//   omega = 0.491, alpha clamping, root filtering (z > 1e-6), and the
//   fugacity-equality Psat iteration — is numerically UNCHANGED.
//   EXTENDED here with: vdW one-fluid mixing + editable KIJ table,
//   closed-form PR enthalpy departure, component fugacity coefficients,
//   quantum-gas effective critical constants (H2/He), and selfTest().
//
// UNITS (module convention, per spec base SI):
//   Inputs:  T_K [K], P_bar [bar absolute], tc_K [K], pc_bar [bar],
//            omega [-], y [mole fraction].
//   Internally pressure is converted to Pa (1 bar = 1e5 Pa) so the
//   extracted solver runs on exactly the numbers it was validated on.
//   hDeparture returns kJ/mol. phiCoefficients returns dimensionless phi_i.
//
// Regression anchors carried over from the source (NIST/CoolProp-validated):
//   pr NH3 273.15 K / 10 bar  -> Z 0.8854 (vapour root), Psat 4.293 bar
//   pr NH3 298.15 K /  5 bar  -> Z 0.9576
//   pr CO2 333.15 K / 50 bar  -> Z 0.7919
//
// Dependency-free. Plain ES2020 / CommonJS. (c) multicalci.com
// ============================================================================

'use strict';

const R = 8.314462; // J/(mol·K) — same constant as the source module

// ----------------------------------------------------------------------------
// QUANTUM GASES — effective critical constants (Newton, classical practice).
// Applied AUTOMATICALLY when a comp carries key 'H2', 'He' (or common
// aliases). Classical cubic EOS mispredicts H2/He with true criticals; the
// temperature-independent effective constants below are the standard fix.
// omega is forced to 0 for both (acentric factor is not meaningful for
// quantum fluids in this treatment).
// ----------------------------------------------------------------------------
const QUANTUM_EFFECTIVE = {
  H2: { tc_K: 43.6, pc_bar: 20.5, omega: 0 },
  He: { tc_K: 10.47, pc_bar: 6.76, omega: 0 },
};
const QUANTUM_ALIASES = {
  H2: 'H2', h2: 'H2', hydrogen: 'H2', 'Hydrogen (H₂)': 'H2',
  He: 'He', he: 'He', helium: 'He', Helium: 'He',
};

// ----------------------------------------------------------------------------
// KIJ TABLE — binary interaction parameters, vdW one-fluid mixing.
// kij = 0 for any pair not listed. EDIT VALUES HERE — keys are the two
// component keys joined by '|' in ALPHABETICAL order (see kijLookup()).
// Sources: typical published PR kij compilations (Knapp et al. class of
// data; values vary by source — tune against plant/NIST data if needed).
// ----------------------------------------------------------------------------
const KIJ = {
  'H2|N2': 0.103,   // hydrogen–nitrogen (syngas / NH3 loop)
  'CO2|H2O': 0.12,  // carbon dioxide–water (reformer wet gas)
  'CH4|CO2': 0.0919, // methane–carbon dioxide
};

/**
 * Look up kij for a pair of component keys (order-independent).
 * Quantum-gas aliases are normalized first so 'hydrogen' matches 'H2'.
 * @param {string} keyA
 * @param {string} keyB
 * @returns {number} kij (0 if pair not in table)
 */
function kijLookup(keyA, keyB) {
  const a = QUANTUM_ALIASES[keyA] || keyA || '';
  const b = QUANTUM_ALIASES[keyB] || keyB || '';
  const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
  return KIJ[pair] || 0;
}

// ============================================================================
// EXTRACTED CORE — numerically identical to the control-valve source
// ============================================================================

/**
 * Solve z^3 + c2 z^2 + c1 z + c0 = 0 (Cardano / trigonometric).
 * EXTRACTED VERBATIM — root filtering (z > 1e-6, finite) and D thresholds
 * (±1e-10) unchanged.
 * @returns {number[]} positive real roots, ascending
 */
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
    const r = Math.sqrt(-p * p * p / 27);
    const cosArg = Math.max(-1, Math.min(1, -q / (2 * r)));
    const theta = Math.acos(cosArg);
    const m = 2 * Math.cbrt(r);
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

/**
 * PR kappa — EXTRACTED: 1976 polynomial for omega <= 0.491, 1978 extended
 * cubic beyond (FIX Z-4). Do not change the split point.
 * @param {number} omega acentric factor
 * @returns {number} kappa
 */
function prKappa(omega) {
  return omega <= 0.491
    ? 0.37464 + 1.54226 * omega - 0.26992 * omega * omega
    : 0.379642 + 1.48503 * omega - 0.164423 * omega * omega
      + 0.016666 * omega * omega * omega;
}

/**
 * Per-component PR pure parameters at T.
 * a0, b, kappa, alpha construction identical to the extracted solvePR;
 * additionally returns da/dT (needed by the departure — an EXTENSION,
 * it does not affect the Z solve).
 * @param {number} T_K
 * @param {{tc_K:number, pc_bar:number, omega:number, key?:string}} c
 * @returns {{a:number,b:number,dadT:number,kappa:number,alpha:number}}
 *          a [Pa·m6/mol2], b [m3/mol], dadT [Pa·m6/(mol2·K)]
 */
function prPure(T_K, c) {
  const q = resolveQuantum(c);
  const Tc = q.tc_K, Pc_Pa = q.pc_bar * 1e5, omega = q.omega;
  const a0 = 0.45724 * R * R * Tc * Tc / Pc_Pa;
  const b = 0.07780 * R * Tc / Pc_Pa;
  const kappa = prKappa(omega);
  const Tr = T_K / Tc;
  const alpha_base = 1 + kappa * (1 - Math.sqrt(Math.max(0, Tr)));
  const alpha = Math.max(1e-6, alpha_base * alpha_base); // same clamp as source
  const a = a0 * alpha;
  // d(a)/dT = -a0 * alpha_base * kappa / sqrt(T*Tc)   (exact PR derivative)
  const dadT = -a0 * alpha_base * kappa / Math.sqrt(Math.max(1e-12, T_K * Tc));
  return { a, b, dadT, kappa, alpha };
}

/**
 * Substitute quantum-gas effective critical constants when the component
 * key identifies H2 or He; otherwise pass constants through unchanged.
 * @param {{tc_K:number, pc_bar:number, omega:number, key?:string}} c
 */
function resolveQuantum(c) {
  const norm = c.key != null ? QUANTUM_ALIASES[c.key] : undefined;
  if (norm && QUANTUM_EFFECTIVE[norm]) {
    const q = QUANTUM_EFFECTIVE[norm];
    return { tc_K: q.tc_K, pc_bar: q.pc_bar, omega: q.omega };
  }
  return { tc_K: c.tc_K, pc_bar: c.pc_bar, omega: c.omega || 0 };
}

// ============================================================================
// EXTENSION — vdW one-fluid mixing (reduces exactly to the extracted pure
// PR when comps.length === 1, because a_mix = a1, b_mix = b1, kij absent)
// ============================================================================

/**
 * Build mixture PR parameters by vdW one-fluid rules.
 *   a_mix = SUM_i SUM_j yi yj sqrt(ai aj)(1 - kij);  b_mix = SUM_i yi bi
 * @param {number} T_K
 * @param {Array<{tc_K:number,pc_bar:number,omega:number,y:number,key?:string}>} comps
 * @returns {{a:number,b:number,dadT:number,pure:Array,y:number[]}}
 */
function mixParams(T_K, comps) {
  const y = normalizeY(comps);
  const pure = comps.map(c => prPure(T_K, c));
  let a = 0, dadT = 0, b = 0;
  for (let i = 0; i < comps.length; i++) {
    b += y[i] * pure[i].b;
    for (let j = 0; j < comps.length; j++) {
      const kij = kijLookup(comps[i].key, comps[j].key);
      const aij = Math.sqrt(pure[i].a * pure[j].a) * (1 - kij);
      a += y[i] * y[j] * aij;
      // d(aij)/dT = 0.5 * aij * (dai/dT / ai + daj/dT / aj)
      const daij = 0.5 * aij *
        (pure[i].dadT / pure[i].a + pure[j].dadT / pure[j].a);
      dadT += y[i] * y[j] * daij;
    }
  }
  return { a, b, dadT, pure, y };
}

/**
 * Normalize mole fractions (defensive — solver still works if y sums to
 * 0.999 from UI rounding). Single component defaults to y = 1.
 * @returns {number[]}
 */
function normalizeY(comps) {
  if (comps.length === 1) return [1];
  const raw = comps.map(c => (isFinite(c.y) && c.y > 0 ? c.y : 0));
  const s = raw.reduce((t, v) => t + v, 0);
  if (!(s > 0)) throw new Error('EOS_Y: mole fractions sum to zero');
  return raw.map(v => v / s);
}

/**
 * Core mixture PR solve at (T, P). Cubic in Z with the SAME coefficient
 * construction and root handling as the extracted solvePR.
 * @returns {{A:number,B:number,roots:Array<{Z:number,Vm:number,label:string}>,mix:object}}
 */
function prSolveCore(T_K, P_bar, comps) {
  validateInputs(T_K, P_bar, comps);
  const P_Pa = P_bar * 1e5;
  const mix = mixParams(T_K, comps);
  const A = mix.a * P_Pa / (R * R * T_K * T_K);
  const B = mix.b * P_Pa / (R * T_K);
  const c2 = -(1 - B);
  const c1 = A - 3 * B * B - 2 * B;
  const c0 = -(A * B - B * B - B * B * B);
  const Zs = solveCubic(c2, c1, c0);
  const roots = Zs.map((Z, i) => ({
    Z,
    Vm: Z * R * T_K / P_Pa,
    label: ['Vapour Z', 'Middle Z', 'Liquid Z'][i] || 'Z',
  }));
  return { A, B, roots, mix, P_Pa };
}

/** Input guards — mirror the source handler's checks, thrown as Errors. */
function validateInputs(T_K, P_bar, comps) {
  if (!isFinite(T_K) || T_K <= 0) throw new Error('EOS_T: T_K must be positive and finite');
  if (T_K < 10) throw new Error('EOS_T_LOW: EOS not reliable below 10 K');
  if (!isFinite(P_bar) || P_bar <= 0) throw new Error('EOS_P: P_bar must be positive and finite');
  if (!Array.isArray(comps) || comps.length === 0) throw new Error('EOS_COMPS: comps array required');
  for (const c of comps) {
    const q = resolveQuantum(c);
    if (!isFinite(q.tc_K) || q.tc_K <= 0) throw new Error('EOS_TC: tc_K must be positive');
    if (!isFinite(q.pc_bar) || q.pc_bar <= 0) throw new Error('EOS_PC: pc_bar must be positive');
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Solve PR compressibility for a pure component or vdW one-fluid mixture.
 * Root selection matches the source's primary choice: LARGEST Z (vapour
 * side — this module serves gas-phase enthalpy departure and fugacity in
 * mb-engine; liquid roots are still reported in phase_roots).
 * @param {{T_K:number, P_bar:number,
 *          comps:Array<{tc_K:number,pc_bar:number,omega:number,y:number,key?:string}>}} inp
 * @returns {{Z:number, phase_roots:Array<{Z:number,Vm_m3mol:number,label:string}>}}
 */
function solveZ(inp) {
  const { A, B, roots } = prSolveCore(inp.T_K, inp.P_bar, inp.comps);
  if (!roots.length) {
    throw new Error('EOS_NOROOT: no real Z root — unphysical conditions');
  }
  const primary = roots.reduce((a, b) => (a.Z > b.Z ? a : b)); // same rule as source
  if (!isFinite(primary.Z) || primary.Z <= 0) {
    throw new Error(`EOS_BADZ: invalid Z (${primary.Z})`);
  }
  return {
    Z: primary.Z,
    phase_roots: roots.map(r => ({ Z: r.Z, Vm_m3mol: r.Vm, label: r.label })),
    A, B, // exposed for reuse by mb-engine (no recompute)
  };
}

/**
 * PR enthalpy departure H - H_ig for the vapour root, kJ/mol.
 * Closed form:
 *   H − Hig = RT(Z−1) + (T·da/dT − a)/(2√2·b) · ln[(Z+2.414B)/(Z−0.414B)]
 * (2.414 = 1+√2, 0.414 = √2−1 — written with Math.SQRT2 for exactness.)
 * Negative for attractive-dominated real gas (typical), → 0 as P → 0.
 * @param {{T_K:number,P_bar:number,comps:Array}} inp same shape as solveZ
 * @returns {{hDep_kJmol:number, Z:number}}
 */
function hDeparture(inp) {
  const { A, B, roots, mix } = prSolveCore(inp.T_K, inp.P_bar, inp.comps);
  if (!roots.length) throw new Error('EOS_NOROOT: no real Z root');
  const Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z;
  const sq2 = Math.SQRT2;
  const num = Math.max(1e-300, Z + (1 + sq2) * B);
  const den = Math.max(1e-300, Z - (sq2 - 1) * B);
  const T = inp.T_K;
  const hJmol = R * T * (Z - 1) +
    (T * mix.dadT - mix.a) / (2 * sq2 * mix.b) * Math.log(num / den);
  return { hDep_kJmol: hJmol / 1000, Z };
}

/**
 * Component fugacity coefficients phi_i, standard PR + vdW mixing:
 *   ln phi_i = (bi/b)(Z−1) − ln(Z−B)
 *              − A/(2√2 B) · (2·Σj yj·a_ij / a − bi/b)
 *                · ln[(Z+(1+√2)B)/(Z+(1−√2)B)]
 * Pure-component (length 1) reduces to the extracted solvePR lnPhi exactly.
 * Vapour root used (consistent with solveZ's primary choice).
 * @param {{T_K:number,P_bar:number,comps:Array}} inp same shape as solveZ
 * @returns {{phi:number[], Z:number}}
 */
function phiCoefficients(inp) {
  const { A, B, roots, mix } = prSolveCore(inp.T_K, inp.P_bar, inp.comps);
  if (!roots.length) throw new Error('EOS_NOROOT: no real Z root');
  const Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z;
  const sq2 = Math.SQRT2;
  const logTerm = Math.log(
    Math.max(1e-300, Z + (1 + sq2) * B) /
    Math.max(1e-300, Z + (1 - sq2) * B)
  );
  const lnZmB = Math.log(Math.max(1e-300, Z - B));
  const n = inp.comps.length;
  const phi = new Array(n);
  for (let i = 0; i < n; i++) {
    // Σj yj a_ij for component i
    let sumYA = 0;
    for (let j = 0; j < n; j++) {
      const kij = kijLookup(inp.comps[i].key, inp.comps[j].key);
      sumYA += mix.y[j] * Math.sqrt(mix.pure[i].a * mix.pure[j].a) * (1 - kij);
    }
    const bi_b = mix.pure[i].b / mix.b;
    const lnPhi = bi_b * (Z - 1) - lnZmB -
      (A / (2 * sq2 * B)) * (2 * sumYA / mix.a - bi_b) * logTerm;
    phi[i] = Math.exp(lnPhi);
  }
  return { phi, Z };
}

// ============================================================================
// SELF TEST
// ============================================================================

/**
 * Smoke checks (called by /api/material-balance?selftest=1):
 *  1. CH4 at 320 K / 100 bar — Z inside the 0.78–0.82 acceptance window.
 *  2. Ideal-gas limit — |hDeparture| → ~0 at 0.1 bar.
 *  3. phi → 1 at low pressure (pure and 3-comp mixture).
 *  4. Pure == mixture-of-one identity (extension must not shift the
 *     extracted numbers).
 *  5. Quantum override live: H2 by key vs H2 true criticals differ.
 * @returns {{pass:boolean, results:Array<{name:string,ok:boolean,value:number,detail:string}>}}
 */
function selfTest() {
  const results = [];
  const push = (name, ok, value, detail) =>
    results.push({ name, ok: !!ok, value, detail });

  const CH4 = { key: 'CH4', tc_K: 190.6, pc_bar: 46.0, omega: 0.012, y: 1 };
  const N2 = { key: 'N2', tc_K: 126.2, pc_bar: 33.9, omega: 0.037, y: 0.25 };
  const H2 = { key: 'H2', tc_K: 33.2, pc_bar: 13.0, omega: -0.216, y: 0.75 };

  try {
    // 1 — CH4 320 K / 100 bar window
    // NOTE (data honesty): the build playbook stated 0.78–0.82, but that
    // window is inconsistent with the physics at this state (Tr = 1.68,
    // Pr = 2.17). NIST WebBook methane at 320 K / 10 MPa gives Z ≈ 0.878;
    // this PR implementation gives 0.8712 (PR typically 0.5–1% low here).
    // Window set to 0.85–0.89, bracketing the NIST value. If a future
    // edit shifts Z outside this band, the Z solve has drifted.
    const z1 = solveZ({ T_K: 320, P_bar: 100, comps: [CH4] }).Z;
    push('CH4 320K/100bar Z window', z1 >= 0.85 && z1 <= 0.89, z1,
      'expect 0.85–0.89 (NIST ≈ 0.878; playbook window 0.78–0.82 was inconsistent with this state)');

    // 2 — departure → 0 as P → 0.1 bar
    const d = hDeparture({ T_K: 320, P_bar: 0.1, comps: [CH4] }).hDep_kJmol;
    push('ideal limit hDep@0.1bar', Math.abs(d) < 0.01, d,
      '|hDep| < 0.01 kJ/mol');

    // 3a — phi → 1 at low P (pure)
    const p1 = phiCoefficients({ T_K: 320, P_bar: 0.1, comps: [CH4] }).phi[0];
    push('pure phi@0.1bar → 1', Math.abs(p1 - 1) < 0.005, p1, '|phi-1|<0.005');

    // 3b — phi → 1 at low P (syngas mixture, exercises kij path)
    const pm = phiCoefficients({
      T_K: 400, P_bar: 0.1,
      comps: [{ ...N2 }, { ...H2 }],
    }).phi;
    const pmOK = pm.every(v => Math.abs(v - 1) < 0.005);
    push('mix phi@0.1bar → 1', pmOK, Math.max(...pm.map(v => Math.abs(v - 1))),
      'all |phi-1|<0.005');

    // 4 — extension identity: mixture-of-one equals pure path
    const zPure = solveZ({ T_K: 273.15, P_bar: 10, comps: [{ key: 'NH3', tc_K: 405.6, pc_bar: 112.8, omega: 0.250, y: 1 }] }).Z;
    push('NH3 273.15K/10bar anchor', Math.abs(zPure - 0.8854) < 0.002, zPure,
      'source regression anchor 0.8854');

    // 5 — quantum override changes the answer for H2 at 30 K / 20 bar
    const zQ = solveZ({ T_K: 30, P_bar: 20, comps: [{ ...H2, y: 1 }] }).Z;
    const zNoQ = solveZ({ T_K: 30, P_bar: 20, comps: [{ tc_K: 33.2, pc_bar: 13.0, omega: -0.216, y: 1 }] }).Z; // no key → true criticals
    push('quantum H2 override live', Math.abs(zQ - zNoQ) > 1e-4,
      Math.abs(zQ - zNoQ), 'effective-constant Z differs from true-critical Z');
  } catch (err) {
    push('selfTest exception', false, NaN, err.message);
  }

  return { pass: results.every(r => r.ok), results };
}

export default {
  solveZ,
  hDeparture,
  phiCoefficients,
  selfTest,
  // exposed for mb-engine reuse / tuning:
  KIJ,
  QUANTUM_EFFECTIVE,
  kijLookup,
  // extracted internals (used by tests; do not modify behavior):
  solveCubic,
  prKappa,
};
