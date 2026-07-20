// ════════════════════════════════════════════════════════════════════════════
// api/psv-sizing.js
// VERCEL SERVERLESS API — PRESSURE RELIEF VALVE (PSV) SIZING
// Route: /api/psv-sizing   (standalone function — auto-deployed by Vercel)
//
// STANDARDS IMPLEMENTED
//   API 520 Part I (10th Ed) — Sizing of pressure-relieving devices
//     • Gas/Vapor  : critical flow  A = W·√(TZ/M) / (C·Kd·P1·Kb·Kc)
//     • Gas/Vapor  : subcritical    A = W·√(TZ/M) / (735·F2·Kd·Kc·√(P1(P1−P2)))
//     • Steam      : A = W / (51.5·P1·Kd·Kb·Kc·Kn·Ksh)   (Napier + superheat)
//     • Liquid     : A = (Q/(38·Kd·Kw·Kc·Kv))·√(G/(P1−P2))  (certified, Kv iterated)
//     • Two-phase  : Annex C Omega (Leung) method — flashing & non-flashing
//   API 521 (7th Ed) — Pressure-relieving and depressuring systems
//     • Fire, wetted vessel   : Q = C·F·Aw^0.82  (C = 21000 / 34500 BTU·h⁻¹·ft⁻²)
//     • Fire, unwetted (gas)  : A = F′·A′ / √P1
//   API 526 — Flanged steel PRVs: letter orifices D→T, valve selection
//   ASME VIII — accumulation limits (10% / 16% / 21%)
//
// ALL math, unit conversion, validation done HERE — nothing in client.
// Protocol: POST { calc: 'gas'|'steam'|'liquid'|'fire'|'twophase', params:{…} }
// ════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────
// UNIT HELPERS  (internal basis: US customary — lb/h, psia, °R, in², gpm, cP)
// ────────────────────────────────────────────────────────────────────────────
const PATM_PSI = 14.696;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

function toPsia(val, u) {
  switch (u) {
    case 'psig':  return val + PATM_PSI;
    case 'psia':  return val;
    case 'barg':  return val * 14.5038 + PATM_PSI;
    case 'bara':  return val * 14.5038;
    case 'kPag':  return val * 0.145038 + PATM_PSI;
    case 'kPaa':  return val * 0.145038;
    case 'MPag':  return val * 145.038 + PATM_PSI;
    case 'kgcm2g':return val * 14.2233 + PATM_PSI;
    default:      return NaN;
  }
}
function toRankine(val, u) {
  switch (u) {
    case 'C': return (val + 273.15) * 1.8;
    case 'F': return val + 459.67;
    case 'K': return val * 1.8;
    case 'R': return val;
    default:  return NaN;
  }
}
function toLbHr(val, u) {
  switch (u) {
    case 'kghr':  return val * 2.20462;
    case 'kgs':   return val * 2.20462 * 3600;
    case 'lbhr':  return val;
    case 'tonhr': return val * 2204.62;
    default:      return NaN;
  }
}
function toGpm(val, u) {
  switch (u) {
    case 'm3hr': return val * 4.40287;
    case 'gpm':  return val;
    case 'lpm':  return val * 0.264172;
    case 'lps':  return val * 15.8503;
    default:     return NaN;
  }
}
function toFt2(val, u) {
  switch (u) {
    case 'm2':  return val * 10.7639;
    case 'ft2': return val;
    default:    return NaN;
  }
}
function toFt(val, u) {
  switch (u) {
    case 'm':  return val * 3.28084;
    case 'ft': return val;
    case 'mm': return val * 0.00328084;
    case 'in': return val / 12;
    default:   return NaN;
  }
}
function toBtuLb(val, u) {          // latent heat
  switch (u) {
    case 'kJkg':  return val * 0.429923;
    case 'btulb': return val;
    case 'kcalkg':return val * 1.8;
    default:      return NaN;
  }
}
const in2_to_mm2 = (a) => a * 645.16;
const psia_to_barg = (p) => (p - PATM_PSI) / 14.5038;
const psia_to_kpaa = (p) => p / 0.145038;
const R_to_C = (t) => t / 1.8 - 273.15;

// ────────────────────────────────────────────────────────────────────────────
// API 526 LETTER ORIFICES  (effective areas, in²)  + representative valve sizes
// ────────────────────────────────────────────────────────────────────────────
const ORIFICES = [
  { L: 'D', A: 0.110, sizes: '1"×2", 1½"×2", 1½"×2½"' },
  { L: 'E', A: 0.196, sizes: '1"×2", 1½"×2", 1½"×2½"' },
  { L: 'F', A: 0.307, sizes: '1½"×2", 1½"×2½", 2"×3"' },
  { L: 'G', A: 0.503, sizes: '1½"×2½", 1½"×3", 2"×3"' },
  { L: 'H', A: 0.785, sizes: '1½"×3", 2"×3"' },
  { L: 'J', A: 1.287, sizes: '2"×3", 2½"×4", 3"×4"' },
  { L: 'K', A: 1.838, sizes: '3"×4"' },
  { L: 'L', A: 2.853, sizes: '3"×4", 4"×6"' },
  { L: 'M', A: 3.60,  sizes: '4"×6"' },
  { L: 'N', A: 4.34,  sizes: '4"×6"' },
  { L: 'P', A: 6.38,  sizes: '4"×6"' },
  { L: 'Q', A: 11.05, sizes: '6"×8"' },
  { L: 'R', A: 16.0,  sizes: '6"×8", 6"×10"' },
  { L: 'T', A: 26.0,  sizes: '8"×10"' },
];

function selectOrifice(Areq_in2) {
  if (!(Areq_in2 > 0)) return null;
  // Single-valve selection
  const single = ORIFICES.find(o => o.A >= Areq_in2);
  if (single) {
    return {
      multi: false, letter: single.L, area: single.A, sizes: single.sizes,
      count: 1, pctUsed: (Areq_in2 / single.A) * 100,
      totalArea: single.A,
    };
  }
  // Multiple T valves
  const n = Math.ceil(Areq_in2 / 26.0);
  return {
    multi: true, letter: 'T', area: 26.0, sizes: '8"×10"',
    count: n, pctUsed: (Areq_in2 / (n * 26.0)) * 100,
    totalArea: n * 26.0,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// COEFFICIENT C  — function of ideal-gas isentropic exponent k
//   C = 520·√( k·(2/(k+1))^((k+1)/(k−1)) )      [US customary form]
// ────────────────────────────────────────────────────────────────────────────
function coeffC(k) {
  if (!(k > 1.0001)) return 315;  // k→1 limit per API 520 (C = 315)
  return 520 * Math.sqrt(k * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));
}

// ────────────────────────────────────────────────────────────────────────────
// Kb — BACKPRESSURE CORRECTION (gas/vapor & steam)
//   Conventional: Kb = 1 when flow is critical (built-up BP handled by design);
//                 subcritical flow uses the F2 method instead.
//   Balanced bellows: API 520 Fig. curve @10% overpressure (piecewise-linear).
//   Pilot: Kb = 1 (until subcritical, then F2).
// ────────────────────────────────────────────────────────────────────────────
const KB_BELLOWS_10 = [[0,1],[30,1],[35,0.94],[40,0.88],[45,0.81],[50,0.74]];
function kbBellows(bpPctGauge) {
  const t = KB_BELLOWS_10;
  if (bpPctGauge <= t[0][0]) return 1;
  if (bpPctGauge >= t[t.length-1][0]) return t[t.length-1][1];
  for (let i = 0; i < t.length - 1; i++) {
    if (bpPctGauge >= t[i][0] && bpPctGauge <= t[i+1][0]) {
      const f = (bpPctGauge - t[i][0]) / (t[i+1][0] - t[i][0]);
      return t[i][1] + f * (t[i+1][1] - t[i][1]);
    }
  }
  return 1;
}

// Kw — balanced-bellows backpressure correction for LIQUID service (API 520 Fig.)
const KW_BELLOWS = [[0,1],[15,1],[20,0.96],[25,0.92],[30,0.87],[35,0.82],[40,0.77],[45,0.71],[50,0.65]];
function kwBellows(bpPctGauge) {
  const t = KW_BELLOWS;
  if (bpPctGauge <= t[0][0]) return 1;
  if (bpPctGauge >= t[t.length-1][0]) return t[t.length-1][1];
  for (let i = 0; i < t.length - 1; i++) {
    if (bpPctGauge >= t[i][0] && bpPctGauge <= t[i+1][0]) {
      const f = (bpPctGauge - t[i][0]) / (t[i+1][0] - t[i][0]);
      return t[i][1] + f * (t[i+1][1] - t[i][1]);
    }
  }
  return 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Kn — NAPIER STEAM CORRECTION  (1500 < P1 ≤ 3200 psia)
// ────────────────────────────────────────────────────────────────────────────
function napierKn(P1) {
  if (P1 <= 1500) return 1;
  if (P1 > 3200) return NaN;
  return (0.1906 * P1 - 1000) / (0.2292 * P1 - 1061);
}

// ────────────────────────────────────────────────────────────────────────────
// Ksh — SUPERHEAT STEAM CORRECTION  (API 520 Table; bilinear interpolation)
//   Rows: set pressure psig · Cols: total steam temperature °F
// ────────────────────────────────────────────────────────────────────────────
const KSH_T = [300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200];
const KSH_P = [15, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240,
               260, 280, 300, 350, 400, 500, 600, 800, 1000, 1250, 1500,
               1750, 2000, 2500, 3000];
const KSH = [
 [1.00,0.98,0.93,0.88,0.84,0.80,0.77,0.74,0.72,0.70],
 [1.00,0.98,0.93,0.88,0.84,0.80,0.77,0.74,0.72,0.70],
 [1.00,0.99,0.93,0.88,0.84,0.81,0.77,0.74,0.72,0.70],
 [1.00,0.99,0.93,0.88,0.84,0.81,0.77,0.75,0.72,0.70],
 [1.00,0.99,0.93,0.88,0.84,0.81,0.77,0.75,0.72,0.70],
 [1.00,0.99,0.94,0.89,0.84,0.81,0.77,0.75,0.72,0.70],
 [1.00,0.99,0.94,0.89,0.84,0.81,0.78,0.75,0.72,0.70],
 [1.00,0.99,0.94,0.89,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,0.99,0.94,0.89,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,0.99,0.94,0.89,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,0.99,0.95,0.89,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,0.99,0.95,0.89,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.95,0.90,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.95,0.90,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.96,0.90,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.96,0.90,0.85,0.81,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.96,0.90,0.86,0.82,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.96,0.91,0.86,0.82,0.78,0.75,0.72,0.70],
 [1.00,1.00,0.96,0.92,0.86,0.82,0.78,0.75,0.73,0.70],
 [1.00,1.00,0.97,0.92,0.87,0.82,0.79,0.75,0.73,0.70],
 [1.00,1.00,1.00,0.95,0.88,0.83,0.79,0.76,0.73,0.70],
 [1.00,1.00,1.00,0.96,0.89,0.84,0.78,0.76,0.73,0.71],
 [1.00,1.00,1.00,0.97,0.91,0.85,0.80,0.77,0.74,0.71],
 [1.00,1.00,1.00,1.00,0.93,0.86,0.81,0.77,0.74,0.71],
 [1.00,1.00,1.00,1.00,0.94,0.86,0.81,0.77,0.73,0.70],
 [1.00,1.00,1.00,1.00,0.95,0.86,0.80,0.76,0.72,0.69],
 [1.00,1.00,1.00,1.00,0.95,0.85,0.78,0.73,0.69,0.66],
 [1.00,1.00,1.00,1.00,1.00,0.82,0.74,0.69,0.65,0.62],
];
function kshLookup(setPsig, T_F) {
  if (T_F <= KSH_T[0]) return 1.0;            // ≤ ~saturation band → Ksh = 1
  const tHi = Math.min(T_F, KSH_T[KSH_T.length - 1]);
  const pHi = Math.min(Math.max(setPsig, KSH_P[0]), KSH_P[KSH_P.length - 1]);
  let ti = 0; while (ti < KSH_T.length - 2 && KSH_T[ti + 1] < tHi) ti++;
  let pi = 0; while (pi < KSH_P.length - 2 && KSH_P[pi + 1] < pHi) pi++;
  const tf = (tHi - KSH_T[ti]) / (KSH_T[ti + 1] - KSH_T[ti]);
  const pf = (pHi - KSH_P[pi]) / (KSH_P[pi + 1] - KSH_P[pi]);
  const a = KSH[pi][ti]     + tf * (KSH[pi][ti + 1]     - KSH[pi][ti]);
  const b = KSH[pi + 1][ti] + tf * (KSH[pi + 1][ti + 1] - KSH[pi + 1][ti]);
  return a + pf * (b - a);
}

// ────────────────────────────────────────────────────────────────────────────
// RELIEVING PRESSURE / ACCUMULATION  (ASME VIII)
// ────────────────────────────────────────────────────────────────────────────
function relievingPressure(setPsig, scenario, nValves, overpressurePctUser) {
  let accum;
  if (Number.isFinite(overpressurePctUser) && overpressurePctUser > 0) {
    accum = overpressurePctUser;
  } else if (scenario === 'fire') {
    accum = 21;
  } else {
    accum = (nValves > 1) ? 16 : 10;
  }
  // ASME: minimum 3 psi overpressure for very low set pressures
  const opPsi = Math.max(setPsig * accum / 100, 3);
  return { P1: setPsig + opPsi + PATM_PSI, accumPct: accum, opPsi };
}

// ────────────────────────────────────────────────────────────────────────────
// SHARED RESULT PACKAGING
// ────────────────────────────────────────────────────────────────────────────
function packageArea(Areq_in2, warnings) {
  const sel = selectOrifice(Areq_in2);
  const out = {
    A_req_in2: round(Areq_in2, 4),
    A_req_mm2: round(in2_to_mm2(Areq_in2), 1),
  };
  if (sel) {
    out.orifice = sel.multi
      ? `${sel.count} × T (parallel)`
      : sel.letter;
    out.orifice_area_in2 = sel.area;
    out.orifice_total_in2 = round(sel.totalArea, 3);
    out.orifice_total_mm2 = round(in2_to_mm2(sel.totalArea), 0);
    out.valve_sizes = sel.sizes;
    out.pct_capacity = round(sel.pctUsed, 1);
    out.n_valves = sel.count;
    if (!sel.multi && sel.pctUsed > 95)
      warnings.push(`Selected orifice is ${out.pct_capacity}% utilised — consider next orifice letter for margin.`);
    if (sel.multi)
      warnings.push(`Required area exceeds a single T orifice — ${sel.count} valves in parallel required. Verify staggered set pressures per ASME VIII UG-134.`);
    if (!sel.multi && sel.pctUsed < 25 && sel.letter === 'D')
      warnings.push('Very small required area — check minimum practical orifice and possibility of chatter at low lift.');
  }
  return out;
}
const round = (v, d) => Number.isFinite(v) ? +v.toFixed(d) : v;

function valveTypeAdvice(bpPct, warnings) {
  if (bpPct > 50) {
    warnings.push(`Back pressure ${round(bpPct,1)}% of set — beyond balanced-bellows range. Pilot-operated valve required.`);
    return 'Pilot-operated (BP > 50% of set)';
  }
  if (bpPct > 10) {
    return 'Balanced bellows or pilot-operated (BP > 10% of set)';
  }
  return 'Conventional acceptable (BP ≤ 10% of set)';
}

// ────────────────────────────────────────────────────────────────────────────
// CALC 1 — GAS / VAPOR  (API 520 §5.6)
// ────────────────────────────────────────────────────────────────────────────
function calcGas(p) {
  const warnings = [];
  const setP  = num(p.setP), W = toLbHr(num(p.W), p.W_u || 'kghr');
  const setPsig = toPsia(setP, p.setP_u || 'barg') - PATM_PSI;
  const T1 = toRankine(num(p.T), p.T_u || 'C');
  const props = resolveGasProps(p);
  const M = props.M, k = props.k;
  let Z = num(p.Z) || 1.0, Z_source = 'manual', phase = null, Psat_barg = null;
  const wantAutoZ = (p.autoZ === 'yes' || p.autoZ === true);
  const Pb = Number.isFinite(num(p.Pb)) ? toPsia(num(p.Pb), p.Pb_u || 'barg') : PATM_PSI;
  const Kd = num(p.Kd) || 0.975;
  const Kc = (p.ruptureDisc === true || p.ruptureDisc === 'yes') ? 0.9 : 1.0;
  const nV = Math.max(1, Math.round(num(p.nValves) || 1));
  const scenario = p.scenario === 'fire' ? 'fire' : 'process';
  const valveStyle = p.valveStyle || 'conventional';

  if (!(setPsig > 0)) return { error: 'Set pressure must be positive (gauge).' };
  if (!(W > 0))       return { error: 'Relief rate W must be positive.' };
  if (!(T1 > 0))      return { error: 'Relieving temperature invalid.' };
  if (!(M > 0 && M < 500)) return { error: 'Molecular weight must be 0–500.' };
  if (!(k >= 1.0 && k < 2.5)) return { error: 'Isentropic exponent k must be between 1.0 and 2.5.' };

  const { P1, accumPct, opPsi } = relievingPressure(setPsig, scenario, nV, num(p.overpressure));

  // ── Auto-Z (PR EOS) at relieving conditions — API 520 §5.6 ──
  if (wantAutoZ) {
    if (props.crit) {
      const az = autoZAtRelieving(P1, T1, props.crit);
      Z = az.Z; Z_source = 'PR EOS @ P1,T1 (' + props.crit.name + ')';
      phase = az.phase;
      Psat_barg = az.Psat_Pa != null ? +((az.Psat_Pa / 1e5 - 1.01325).toFixed(3)) : null;
      az.warnings.forEach(w => warnings.push(w));
    } else {
      warnings.push('Auto-Z requested but no critical properties available (custom fluid without Tc/Pc/ω) — manual Z used.');
    }
  }
  if (!(Z > 0.2 && Z < 3)) return { error: `Compressibility Z = ${round(Z,4)} out of plausible range (0.2–3).` + (Z_source !== 'manual' ? ' PR EOS indicates liquid-like conditions — vapor sizing invalid.' : '') };

  const C = coeffC(k);
  const rCrit = Math.pow(2 / (k + 1), k / (k - 1));
  const Pcf = P1 * rCrit;
  const critical = Pb <= Pcf;
  const bpPctGauge = ((Pb - PATM_PSI) / setPsig) * 100;

  let Kb = 1, F2 = null, A;
  if (critical) {
    if (valveStyle === 'bellows') Kb = kbBellows(bpPctGauge);
    A = (W * Math.sqrt(T1 * Z / M)) / (C * Kd * P1 * Kb * Kc);
  } else {
    // Subcritical — API 520 F2 method (conventional/pilot); bellows keeps Kb curve
    if (valveStyle === 'bellows') {
      Kb = kbBellows(bpPctGauge);
      A = (W * Math.sqrt(T1 * Z / M)) / (C * Kd * P1 * Kb * Kc);
      warnings.push('Subcritical flow with balanced bellows — sized with critical-flow equation and Kb per API 520 practice.');
    } else {
      const r = Pb / P1;
      F2 = Math.sqrt((k / (k - 1)) * Math.pow(r, 2 / k) *
            (1 - Math.pow(r, (k - 1) / k)) / (1 - r));
      A = (W / (735 * F2 * Kd * Kc)) * Math.sqrt((T1 * Z) / (M * P1 * (P1 - Pb)));
      warnings.push('Flow is SUBCRITICAL — sized with API 520 F₂ method.');
    }
  }

  const vType = valveTypeAdvice(bpPctGauge, warnings);
  if (bpPctGauge > 10 && valveStyle === 'conventional')
    warnings.push('Back pressure exceeds 10% of set with a conventional valve — set-pressure shift and chatter risk. Use balanced bellows.');
  if (accumPct === 21 && scenario !== 'fire')
    warnings.push('21% accumulation is reserved for the fire case only.');

  const res = {
    status: warnings.length ? 'WARN' : 'PASS',
    calc: 'gas',
    inputsEcho: { setPsig: round(setPsig,2), W_lbhr: round(W,0), T_R: round(T1,1), M, k, Z, Kd, Kc, valveStyle },
    M_used: round(M, 3), k_used: round(k, 3),
    Z_used: round(Z, 4), Z_source, phase, Psat_barg,
    P1_psia: round(P1, 2), P1_barg: round(psia_to_barg(P1), 3), P1_kPaa: round(psia_to_kpaa(P1), 1),
    accum_pct: accumPct, overpressure_psi: round(opPsi, 2),
    C_coeff: round(C, 1),
    Pcf_psia: round(Pcf, 2), Pcf_barg: round(psia_to_barg(Pcf), 3),
    flow_regime: critical ? 'CRITICAL (choked)' : 'SUBCRITICAL',
    Kb: round(Kb, 3), F2: F2 !== null ? round(F2, 4) : null,
    bp_pct_of_set: round(bpPctGauge, 1),
    valve_type: vType,
    ...packageArea(A, warnings),
    warnings,
  };
  return res;
}

// ────────────────────────────────────────────────────────────────────────────
// CALC 2 — STEAM  (API 520 §5.8, Napier)
// ────────────────────────────────────────────────────────────────────────────
function calcSteam(p) {
  const warnings = [];
  const setPsig = toPsia(num(p.setP), p.setP_u || 'barg') - PATM_PSI;
  const W  = toLbHr(num(p.W), p.W_u || 'kghr');
  const Kd = num(p.Kd) || 0.975;
  const Kc = (p.ruptureDisc === true || p.ruptureDisc === 'yes') ? 0.9 : 1.0;
  const nV = Math.max(1, Math.round(num(p.nValves) || 1));
  const scenario = p.scenario === 'fire' ? 'fire' : 'process';
  const valveStyle = p.valveStyle || 'conventional';
  const Pb = Number.isFinite(num(p.Pb)) ? toPsia(num(p.Pb), p.Pb_u || 'barg') : PATM_PSI;
  const steamState = p.steamState || 'saturated';

  if (!(setPsig > 0)) return { error: 'Set pressure must be positive (gauge).' };
  if (!(W > 0))       return { error: 'Relief rate W must be positive.' };

  const { P1, accumPct, opPsi } = relievingPressure(setPsig, scenario, nV, num(p.overpressure));
  if (P1 > 3200) return { error: 'P1 exceeds 3200 psia — outside Napier equation validity (API 520).' };

  const Kn = napierKn(P1);
  let Ksh = 1.0, T_F = null;
  if (steamState === 'superheated') {
    T_F = toRankine(num(p.T), p.T_u || 'C') - 459.67;
    if (!Number.isFinite(T_F) || T_F <= 0) return { error: 'Superheated steam requires a valid total temperature.' };
    Ksh = kshLookup(setPsig, T_F);
  }
  const bpPctGauge = ((Pb - PATM_PSI) / setPsig) * 100;
  let Kb = 1;
  if (valveStyle === 'bellows') Kb = kbBellows(bpPctGauge);

  const A = W / (51.5 * P1 * Kd * Kb * Kc * Kn * Ksh);
  const vType = valveTypeAdvice(bpPctGauge, warnings);
  if (bpPctGauge > 10 && valveStyle === 'conventional')
    warnings.push('Back pressure exceeds 10% of set with a conventional valve — use balanced bellows.');

  return {
    status: warnings.length ? 'WARN' : 'PASS',
    calc: 'steam',
    P1_psia: round(P1, 2), P1_barg: round(psia_to_barg(P1), 3),
    accum_pct: accumPct, overpressure_psi: round(opPsi, 2),
    Kn: round(Kn, 4), Ksh: round(Ksh, 3), Kb: round(Kb, 3),
    steam_state: steamState, T_F: T_F !== null ? round(T_F, 1) : null,
    bp_pct_of_set: round(bpPctGauge, 1),
    valve_type: vType,
    ...packageArea(A, warnings),
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CALC 3 — LIQUID  (API 520 §5.10, certified valves, Kv Reynolds iteration)
// ────────────────────────────────────────────────────────────────────────────
function calcLiquid(p) {
  const warnings = [];
  const setPsig = toPsia(num(p.setP), p.setP_u || 'barg') - PATM_PSI;
  const Q  = toGpm(num(p.Q), p.Q_u || 'm3hr');
  const G  = num(p.G);
  const mu = num(p.mu) || 0;      // cP
  const Kd = num(p.Kd) || 0.65;
  const Kc = (p.ruptureDisc === true || p.ruptureDisc === 'yes') ? 0.9 : 1.0;
  const nV = Math.max(1, Math.round(num(p.nValves) || 1));
  const valveStyle = p.valveStyle || 'conventional';
  const Pb = Number.isFinite(num(p.Pb)) ? toPsia(num(p.Pb), p.Pb_u || 'barg') : PATM_PSI;

  if (!(setPsig > 0)) return { error: 'Set pressure must be positive (gauge).' };
  if (!(Q > 0))       return { error: 'Relief flow rate must be positive.' };
  if (!(G > 0.2 && G < 3)) return { error: 'Specific gravity out of plausible range (0.2–3).' };
  if (mu < 0)         return { error: 'Viscosity cannot be negative.' };

  const { P1, accumPct, opPsi } = relievingPressure(setPsig, 'process', nV, num(p.overpressure));
  const P2 = Pb;
  const dP = P1 - P2;
  if (!(dP > 0)) return { error: 'Relieving pressure must exceed back pressure.' };

  const bpPctGauge = ((Pb - PATM_PSI) / setPsig) * 100;
  let Kw = 1;
  if (valveStyle === 'bellows') Kw = kwBellows(bpPctGauge);

  // First pass Kv = 1
  let Kv = 1;
  let A = (Q / (38 * Kd * Kw * Kc * Kv)) * Math.sqrt(G / dP);
  let Re = null, iter = 0;

  if (mu > 0.1) {
    // Iterate: Re computed with the NEXT standard orifice area (API 520 practice)
    for (iter = 1; iter <= 12; iter++) {
      const sel = selectOrifice(A);
      const Ause = sel ? sel.totalArea : A;
      Re = (Q * 2800 * G) / (mu * Math.sqrt(Ause));
      if (Re < 20) {
        warnings.push(`Reynolds number ${round(Re,0)} < 20 — outside Kv correlation validity. Result is indicative only.`);
      }
      const KvNew = 1 / (0.9935 + 2.878 / Math.sqrt(Re) + 342.75 / Math.pow(Re, 1.5));
      const Anew = (Q / (38 * Kd * Kw * Kc * KvNew)) * Math.sqrt(G / dP);
      if (Math.abs(Anew - A) / A < 1e-4) { Kv = KvNew; A = Anew; break; }
      Kv = KvNew; A = Anew;
    }
  }

  const vType = valveTypeAdvice(bpPctGauge, warnings);
  if (bpPctGauge > 10 && valveStyle === 'conventional')
    warnings.push('Back pressure exceeds 10% of set with a conventional valve — use balanced bellows (Kw applies).');
  if (Kd > 0.68)
    warnings.push('Kd > 0.68 unusual for liquid service — certified liquid valves use Kd ≈ 0.65.');

  return {
    status: warnings.length ? 'WARN' : 'PASS',
    calc: 'liquid',
    P1_psia: round(P1, 2), P1_barg: round(psia_to_barg(P1), 3),
    dP_psi: round(dP, 2), dP_bar: round(dP / 14.5038, 3),
    accum_pct: accumPct, overpressure_psi: round(opPsi, 2),
    Kw: round(Kw, 3), Kv: round(Kv, 4),
    Re: Re !== null ? round(Re, 0) : null, kv_iterations: iter,
    Q_gpm: round(Q, 1),
    bp_pct_of_set: round(bpPctGauge, 1),
    valve_type: vType,
    ...packageArea(A, warnings),
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CALC 4 — FIRE CASE  (API 521 §4.4.13)
// ────────────────────────────────────────────────────────────────────────────
function wettedAreaFt2(geom) {
  // Wetted area limited to 25 ft (7.6 m) above fire (grade) per API 521
  const D = toFt(num(geom.D), geom.D_u || 'm');
  const L = toFt(num(geom.L), geom.L_u || 'm');       // T/T length (horiz/vert)
  const liq = toFt(num(geom.liqLevel), geom.liq_u || 'm');  // liquid depth from bottom
  const elev = toFt(num(geom.elev) || 0, geom.elev_u || 'm'); // bottom elevation above grade
  const FIRE_H = 25;
  if (!(D > 0)) return { error: 'Vessel diameter must be positive.' };

  const hTop = Math.max(0, Math.min(liq, FIRE_H - elev)); // wetted height within fire zone
  const R = D / 2;
  let Aw = 0, note = '';

  switch (geom.shape) {
    case 'vertical': {
      if (!(L > 0)) return { error: 'Vessel length/height must be positive.' };
      const h = Math.min(hTop, L);
      Aw = Math.PI * D * h + (elev < FIRE_H ? Math.PI / 4 * D * D : 0); // shell + bottom head (flat approx)
      note = 'Vertical: shell π·D·h + bottom head (projected).';
      break;
    }
    case 'horizontal': {
      if (!(L > 0)) return { error: 'Vessel length must be positive.' };
      const h = Math.min(hTop, D);
      const theta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - h / R)));
      const arc = R * theta;                     // wetted circumference
      const Ashell = arc * L;
      const Aseg = R * R / 2 * (theta - Math.sin(theta)); // wetted segment area per head
      Aw = Ashell + 2 * Aseg;
      note = 'Horizontal: wetted shell arc × length + 2 head segments (flat-head approx; add ~9% for 2:1 ellipsoidal).';
      break;
    }
    case 'sphere': {
      const h = Math.min(hTop, D, Math.max(D / 2, FIRE_H - elev)); // API: greater of level or hemisphere within 25ft
      const hEff = Math.max(h, Math.min(D / 2, FIRE_H - elev));
      Aw = Math.PI * D * hEff;                   // spherical zone area = π·D·h
      note = 'Sphere: zone area π·D·h, min. bottom hemisphere within fire height.';
      break;
    }
    default: return { error: 'Unknown vessel shape.' };
  }
  return { Aw, note, hWetted: hTop };
}

function calcFire(p) {
  const warnings = [];
  const mode = p.fireMode || 'wetted';
  const setPsig = toPsia(num(p.setP), p.setP_u || 'barg') - PATM_PSI;
  if (!(setPsig > 0)) return { error: 'Set pressure must be positive (gauge).' };

  if (mode === 'wetted') {
    // ── Wetted vessel: heat input → vaporisation rate → gas sizing at 21% ──
    let Aw;
    let geomNote = '', hW = null;
    if (p.AwDirect && num(p.Aw) > 0) {
      Aw = toFt2(num(p.Aw), p.Aw_u || 'm2');
    } else {
      const g = wettedAreaFt2(p);
      if (g.error) return { error: g.error };
      Aw = g.Aw; geomNote = g.note; hW = g.hWetted;
    }
    const F = num(p.envF) || 1.0;                 // environment factor (insulation credit)
    const drainage = p.drainage === 'yes' || p.drainage === true;
    const Cfire = drainage ? 21000 : 34500;
    const Qbtu = Cfire * F * Math.pow(Aw, 0.82);  // BTU/h
    const lambda = toBtuLb(num(p.latentHeat), p.latent_u || 'kJkg');
    if (!(lambda > 10)) return { error: 'Latent heat of vaporisation required (> 10 BTU/lb).' };
    if (lambda < 50)
      warnings.push('Latent heat < 50 BTU/lb — near critical point; API 521 recommends rigorous methods (λ→0 invalidates W = Q/λ).');
    const W = Qbtu / lambda;                       // lb/h vapor generated

    // Size as gas at fire accumulation (21%)
    const gasRes = calcGas({
      setP: setPsig, setP_u: 'psig',
      W: W, W_u: 'lbhr',
      fluid: p.fluid, autoZ: p.autoZ,
      Tc_K: p.Tc_K, Pc_bar: p.Pc_bar, omega: p.omega,
      T: num(p.T), T_u: p.T_u || 'C',
      M: num(p.M), k: num(p.k), Z: num(p.Z) || 1,
      Pb: num(p.Pb), Pb_u: p.Pb_u || 'barg',
      Kd: num(p.Kd) || 0.975,
      ruptureDisc: p.ruptureDisc,
      valveStyle: p.valveStyle || 'conventional',
      scenario: 'fire', nValves: 1,
    });
    if (gasRes.error) return gasRes;
    gasRes.warnings = [...warnings, ...gasRes.warnings];
    return {
      ...gasRes,
      status: gasRes.warnings.length ? 'WARN' : 'PASS',
      calc: 'fire-wetted',
      fire_C: Cfire, fire_F: F, drainage: drainage ? 'adequate' : 'none',
      Aw_ft2: round(Aw, 1), Aw_m2: round(Aw / 10.7639, 2),
      wetted_height_ft: hW !== null ? round(hW, 2) : null,
      geom_note: geomNote,
      Q_fire_BTUhr: round(Qbtu, 0), Q_fire_kW: round(Qbtu * 0.000293071, 1),
      lambda_BTUlb: round(lambda, 1),
      W_relief_lbhr: round(W, 0), W_relief_kghr: round(W / 2.20462, 0),
    };
  }

  // ── Unwetted (gas-filled) vessel: API 521 §A.5  A = F′·A′/√P1 ──
  //    T1 = Tn·(P1/Pn)   (isochoric heat-up to relieving pressure)
  //    F′ = 0.1406/(C·Kd)·[(Tw−T1)^1.25 / T1^0.6506]   (min 0.01; 0.045 default)
  const Aexp = toFt2(num(p.Aexp), p.Aexp_u || 'm2');
  if (!(Aexp > 0)) return { error: 'Exposed surface area A′ must be positive (in² basis internally).' };
  const Aexp_in2 = Aexp * 144;
  const Tn = toRankine(num(p.T), p.T_u || 'C');           // NORMAL operating gas temp
  if (!(Tn > 0)) return { error: 'Normal operating gas temperature invalid.' };
  const PnPsia = toPsia(num(p.Pn), p.Pn_u || 'barg');     // NORMAL operating pressure
  if (!(PnPsia > 0)) return { error: 'Normal operating pressure required for unwetted case (T₁ = Tn·P₁/Pn).' };
  const Tw = Number.isFinite(num(p.Tw)) ? toRankine(num(p.Tw), p.Tw_u || 'F')
                                        : toRankine(1100, 'F'); // wall temp default 1100°F CS
  const k = num(p.k) || 1.4;
  const Kd = num(p.Kd) || 0.975;
  const M = num(p.M);                                     // optional, for W reporting
  const { P1 } = relievingPressure(setPsig, 'fire', 1, num(p.overpressure));

  const T1 = Tn * (P1 / PnPsia);
  if (T1 >= Tw) {
    return { error:
      `Relieving temperature T₁ = ${Math.round(T1)}°R (${round(R_to_C(T1),0)}°C) meets or exceeds wall temperature ` +
      `Tw = ${Math.round(Tw)}°R. The vessel wall will weaken and fail BEFORE pressure reaches set point — a PSV cannot ` +
      `protect this vessel. Provide depressuring (API 521 §4.6), fireproofing, or water spray instead.` };
  }

  const C = coeffC(k);
  let Fp = (0.1406 / (C * Kd)) * (Math.pow(Tw - T1, 1.25) / Math.pow(T1, 0.6506));
  let fpNote = '';
  if (!Number.isFinite(Fp) || Fp < 0.01) {
    fpNote = `Computed F′ = ${round(Fp, 4)} below the API 521 recommended minimum — F′ = 0.01 applied.`;
    warnings.push(fpNote);
    Fp = 0.01;
  }
  const A = Fp * Aexp_in2 / Math.sqrt(P1);

  let W_lbhr = null;
  if (M > 0) {
    W_lbhr = 0.1406 * Math.sqrt(M * P1) * Aexp_in2 * Math.pow(Tw - T1, 1.25) / Math.pow(T1, 1.1506);
  }

  warnings.push('Unwetted fire case sizes for gas expansion only. A PSV rarely protects a gas-filled vessel in fire — verify wall rupture temperature; depressuring per API 521 §4.6 may govern.');

  return {
    status: 'WARN',
    calc: 'fire-unwetted',
    P1_psia: round(P1, 2), P1_barg: round(psia_to_barg(P1), 3),
    T1_relieving_C: round(R_to_C(T1), 1), T1_relieving_R: round(T1, 0),
    Tw_C: round(R_to_C(Tw), 0), Tw_F: round(Tw - 459.67, 0),
    Fprime: round(Fp, 4), C_coeff: round(C, 1),
    Aexp_ft2: round(Aexp, 1), Aexp_in2: round(Aexp_in2, 0),
    W_relief_lbhr: W_lbhr !== null ? round(W_lbhr, 0) : null,
    W_relief_kghr: W_lbhr !== null ? round(W_lbhr / 2.20462, 0) : null,
    ...packageArea(A, warnings),
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CALC 5 — TWO-PHASE  (API 520 Annex C — Omega / Leung method)
//   ω from two-point specific volume:  ω = 9·(v9/v0 − 1)
//   Critical ratio ηc:  ηc² + (ω² − 2ω)(1 − ηc)² + 2ω²·ln ηc + 2ω²(1 − ηc) = 0
//   G_crit = ηc·√(P0/(v0·ω))   |   subcritical G per Annex C
// ────────────────────────────────────────────────────────────────────────────
function calcTwoPhase(p) {
  const warnings = [];
  const setPsig = toPsia(num(p.setP), p.setP_u || 'barg') - PATM_PSI;
  const W  = toLbHr(num(p.W), p.W_u || 'kghr');           // total two-phase mass rate
  const Kd = num(p.Kd) || 0.85;
  const Kc = (p.ruptureDisc === true || p.ruptureDisc === 'yes') ? 0.9 : 1.0;
  const Pb = Number.isFinite(num(p.Pb)) ? toPsia(num(p.Pb), p.Pb_u || 'barg') : PATM_PSI;
  const valveStyle = p.valveStyle || 'conventional';
  const scenario = p.scenario === 'fire' ? 'fire' : 'process';
  const mode = p.omegaMode === 'frozen' ? 'frozen' : p.omegaMode === 'flashing' ? 'flashing' : 'direct';

  if (!(setPsig > 0)) return { error: 'Set pressure must be positive (gauge).' };
  if (!(W > 0))  return { error: 'Relief rate W must be positive.' };

  const { P1, accumPct } = relievingPressure(setPsig, scenario, 1, num(p.overpressure));
  const P0_Pa = P1 * 6894.76;

  // ── ω parameter: direct (user v₀,v₉) | frozen (PR gas + inert liquid) |
  //    flashing (Leung correlation, saturated two-phase inlet) ──────────────
  let v0, omega, omega_basis, x0 = null, vg0 = null;
  if (mode === 'direct') {
    v0 = num(p.v0);   // m³/kg at P0 (relieving pressure)
    const v9 = num(p.v9);   // m³/kg at 0.9·P0 (isentropic/isenthalpic flash)
    if (!(v0 > 0)) return { error: 'v₀ (specific volume at P₀) must be positive.' };
    if (!(v9 > v0)) return { error: 'v₉ must exceed v₀ (mixture expands as pressure falls to 0.9·P₀).' };
    omega = 9 * (v9 / v0 - 1);
    omega_basis = 'Direct: ω = 9(v₉/v₀ − 1) from user flash data';
  } else {
    x0 = num(p.x0);                       // inlet mass quality (vapor fraction)
    const vl = num(p.vl);                 // liquid specific volume m³/kg
    const T_K = toRankine(num(p.T), p.T_u || 'C') / 1.8;
    const g = resolveGasProps(p);
    if (!(x0 >= 0 && x0 <= 1)) return { error: 'Inlet quality x₀ must be between 0 and 1.' };
    if (!(vl > 0 && vl < 0.1)) return { error: 'Liquid specific volume v_l must be 0–0.1 m³/kg (e.g. water ≈ 0.001).' };
    if (!(T_K > 0)) return { error: 'Temperature invalid.' };
    if (!(g.M > 0)) return { error: 'Molecular weight required to estimate vapor density (pick a fluid or enter M).' };
    const vgAt = (P_Pa) => {
      let Z = 1;
      if (g.crit) {
        const roots = solvePR(T_K, P_Pa, g.crit.Tc_K, g.crit.Pc_Pa, g.crit.omega);
        if (roots.length) Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z;
      }
      return Z * R_GAS * T_K / ((g.M / 1000) * P_Pa);     // m³/kg
    };
    vg0 = vgAt(P0_Pa);
    v0 = x0 * vg0 + (1 - x0) * vl;
    if (mode === 'frozen') {
      if (!(x0 > 0)) return { error: 'Frozen-flow mode needs x₀ > 0 (some vapor present, none generated).' };
      const vg9 = vgAt(0.9 * P0_Pa);
      const v9 = x0 * vg9 + (1 - x0) * vl;
      omega = 9 * (v9 / v0 - 1);
      omega_basis = `Frozen (non-flashing): PR vapor v at P₀ & 0.9P₀ (x₀=${x0}), inert liquid`;
      warnings.push('Frozen-flow ω assumes NO vapor generation during depressurization (non-flashing, non-condensing mixture at constant T). For flashing liquids use the Flashing mode or direct flash data.');
    } else {
      const Cp  = num(p.Cp)  * 1000;     // kJ/kg·K → J/kg·K (liquid Cp)
      const hfg = num(p.hfg) * 1000;     // kJ/kg → J/kg
      if (!(Cp > 100 && Cp < 20000)) return { error: 'Liquid Cp must be plausible (0.1–20 kJ/kg·K).' };
      if (!(hfg > 10000)) return { error: 'Latent heat h_fg must be > 10 kJ/kg.' };
      const vfg = vg0 - vl;
      if (!(vfg > 0)) return { error: 'v_g at relieving conditions must exceed v_l — check T, P and fluid.' };
      omega = (x0 * vfg / v0) + (Cp * T_K * P0_Pa / v0) * Math.pow(vfg / hfg, 2);
      omega_basis = `Flashing (Leung): ω = x₀v_fg/v₀ + CpT₀P₀/v₀·(v_fg/h_fg)², PR v_g (x₀=${x0})`;
      warnings.push('Flashing ω per Leung correlation assumes a saturated, thermal-equilibrium two-phase inlet. Near the critical point or for wide-boiling mixtures, use rigorous flash data (Direct mode).');
    }
  }
  if (omega > 100) warnings.push('ω > 100 — highly flashing system; verify inputs (v₉ at exactly 0.9·P₀).');
  if (!(omega > 0)) return { error: `Computed ω = ${round(omega, 4)} ≤ 0 — the mixture does not expand on depressurization. Two-phase omega sizing is not applicable; check inputs.` };

  // Solve critical pressure ratio ηc by bisection
  const f = (eta) => eta * eta + (omega * omega - 2 * omega) * Math.pow(1 - eta, 2)
                   + 2 * omega * omega * Math.log(eta) + 2 * omega * omega * (1 - eta);
  let lo = 1e-4, hi = 0.999999, etaC = 0.5;
  for (let i = 0; i < 80; i++) {
    etaC = (lo + hi) / 2;
    if (f(etaC) > 0) hi = etaC; else lo = etaC;
  }

  const etaB = Pb / P1;
  const critical = etaB <= etaC;
  let G; // kg/(m²·s)
  if (critical) {
    G = etaC * Math.sqrt(P0_Pa / (v0 * omega));
  } else {
    const eta = etaB;
    const numr = -2 * (omega * Math.log(eta) + (omega - 1) * (1 - eta));
    G = Math.sqrt(numr) * Math.sqrt(P0_Pa / v0) / (omega * (1 / eta - 1) + 1);
    warnings.push('Subcritical two-phase flow — Annex C subcritical mass-flux equation applied.');
  }

  const bpPctGauge = ((Pb - PATM_PSI) / setPsig) * 100;
  let Kb = 1;
  if (valveStyle === 'bellows') Kb = kbBellows(bpPctGauge);

  const W_kgs = W / 2.20462 / 3600;
  const A_m2 = W_kgs / (Kd * Kb * Kc * G);
  const A_in2 = A_m2 * 1e6 / 645.16;

  warnings.push('Two-phase sizing per API 520 Annex C is a screening method — validate with rigorous HEM/DIERS analysis for reactive or foamy systems.');

  return {
    status: 'WARN',
    calc: 'twophase',
    P1_psia: round(P1, 2), P1_barg: round(psia_to_barg(P1), 3),
    accum_pct: accumPct,
    omega: round(omega, 3),
    omega_basis,
    x0_quality: x0 !== null ? x0 : undefined,
    vg0_m3kg: vg0 !== null ? round(vg0, 5) : undefined,
    v0_m3kg: round(v0, 5),
    eta_crit: round(etaC, 4),
    eta_back: round(etaB, 4),
    flow_regime: critical ? 'CRITICAL (choked)' : 'SUBCRITICAL',
    G_mass_flux_kgm2s: round(G, 0),
    Kd, Kb: round(Kb, 3),
    ...packageArea(A_in2, warnings),
    warnings,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION H ► RELIEF-LOAD ESTIMATORS (API 521 §4.4 load determination)
// Feed the scenario manager so it computes credible loads, not just sizes them.
// ════════════════════════════════════════════════════════════════════════════

// Gas blowby through a wide-open control valve — ISA-75.01 compressible:
//   W [kg/h] = 27.3·Cv·Y·√(x·Pu[bar a]·ρu[kg/m³]),  x = min(ΔP/Pu, Fk·xT),
//   Y = 1 − x/(3·Fk·xT)  (floor ⅔ at choking),  Fk = k/1.4
function estGasBlowby(s, P1_psia, warnings) {
  const Cv = num(s.Cv);
  const xT = Number.isFinite(num(s.xT)) && num(s.xT) > 0 ? num(s.xT) : 0.75;
  const Pu_psia = toPsia(num(s.Pu), s.Pu_u || 'barg');
  const T_R = toRankine(num(s.T), s.T_u || 'C');
  if (!(Cv > 0)) return { error: 'CV blowby: valve Cv (wide-open) must be positive.' };
  if (!(Pu_psia > P1_psia)) return { error: `CV blowby: upstream pressure (${round(psia_to_barg(Pu_psia),2)} barg) must exceed relieving pressure (${round(psia_to_barg(P1_psia),2)} barg) — otherwise there is no blowby flow.` };
  if (!(T_R > 0)) return { error: 'CV blowby: temperature invalid.' };
  const g = resolveGasProps(s);
  if (!(g.M > 0 && g.k >= 1)) return { error: 'CV blowby: fluid M and k required.' };
  let Z = Number.isFinite(num(s.Z)) && num(s.Z) > 0 ? num(s.Z) : 1.0;
  if ((s.autoZ === 'yes' || s.autoZ === true) && g.crit) {
    const roots = solvePR(T_R / 1.8, Pu_psia / 0.145038 * 1000, g.crit.Tc_K, g.crit.Pc_Pa, g.crit.omega);
    if (roots.length) Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z;
  }
  const Fk = g.k / 1.4;
  const xAvail = (Pu_psia - P1_psia) / Pu_psia;
  const choked = xAvail >= Fk * xT;
  const x = choked ? Fk * xT : xAvail;
  const Y = Math.max(2 / 3, 1 - x / (3 * Fk * xT));
  const Pu_Pa = Pu_psia * 6894.757;
  const rho_u = Pu_Pa * (g.M / 1000) / (Z * R_GAS * (T_R / 1.8));      // kg/m³
  const W_kghr = 27.3 * Cv * Y * Math.sqrt(x * (Pu_Pa / 1e5) * rho_u);
  warnings.push(`CV-blowby load: wide-open Cv=${Cv}, ${choked ? 'CHOKED' : 'subcritical'} (x=${round(x,3)}, Y=${round(Y,3)}, xT=${xT}). Verify Cv is the valve's rated (100% open) value incl. any bypass that can be open simultaneously.`);
  return { W_lbhr: W_kghr * 2.20462, basis: `CV blowby: Cv ${Cv} wide-open from ${round(psia_to_barg(Pu_psia),2)} barg${choked ? ' (choked)' : ''}` };
}

// Liquid blowby through a wide-open control valve:  Q[gpm] = Cv·√(ΔP[psi]/G)
function estLiqBlowby(s, P1_psia, warnings) {
  const Cv = num(s.Cv), G = num(s.G) || 1.0;
  const Pu_psia = toPsia(num(s.Pu), s.Pu_u || 'barg');
  if (!(Cv > 0)) return { error: 'CV blowby: valve Cv (wide-open) must be positive.' };
  if (!(Pu_psia > P1_psia)) return { error: 'CV blowby: upstream pressure must exceed relieving pressure.' };
  const Q_gpm = Cv * Math.sqrt((Pu_psia - P1_psia) / G);
  warnings.push(`Liquid CV-blowby load from wide-open Cv=${Cv} at ΔP=${round((Pu_psia-P1_psia)/14.5038,2)} bar. If the upstream source can flash across the valve, treat as two-phase instead.`);
  return { Q_gpm, basis: `CV blowby: Cv ${Cv} @ ΔP ${round((Pu_psia - P1_psia) / 14.5038, 2)} bar` };
}

// Thermal expansion of blocked-in liquid — API 521 §4.4.12:
//   q[gpm] = B[1/°F]·H[BTU/h] / (500·G·c[BTU/lb·°F])
function estThermal(s, warnings) {
  const H_kW = num(s.H_kW);
  const B_C  = Number.isFinite(num(s.betaC)) && num(s.betaC) > 0 ? num(s.betaC) : 9e-4; // 1/°C
  const G    = num(s.G) || 1.0;
  const c_kJ = Number.isFinite(num(s.cp_kJ)) && num(s.cp_kJ) > 0 ? num(s.cp_kJ) : 2.1; // kJ/kg·K
  if (!(H_kW > 0)) return { error: 'Thermal expansion: heat input H must be positive (kW). Typical sources: solar ≈ 0.3–1 kW/m² exposed, heat tracing duty, exchanger duty with block-in.' };
  const H_btu = H_kW * 3412.14;
  const B_F = B_C / 1.8;
  const c_btu = c_kJ * 0.238846;
  const Q_gpm = B_F * H_btu / (500 * G * c_btu);
  warnings.push(`Thermal-expansion load per API 521 §4.4.12 (β=${B_C}/°C, c=${c_kJ} kJ/kg·K, H=${H_kW} kW). These loads are tiny — a ¾"×1" thermal relief valve usually suffices; confirm the governing case is not artificially inflated by this row.`);
  return { Q_gpm, basis: `Thermal expansion: H ${H_kW} kW, β ${B_C}/°C` };
}

// Heat-exchanger tube rupture — API 521 §4.4.14: complete severance of one tube,
// flow from BOTH open ends = 2× tube bore area, sharp-orifice Cd = 0.6.
function estTubeRupture(s, P1_psia, phase, warnings) {
  const d_mm = num(s.tubeID);
  const Pu_psia = toPsia(num(s.Pu), s.Pu_u || 'barg');
  if (!(d_mm > 1)) return { error: 'Tube rupture: tube inside diameter must be > 1 mm.' };
  if (!(Pu_psia > P1_psia)) return { error: 'Tube rupture: HP-side pressure must exceed the LP-side relieving pressure (otherwise no credible overpressure by tube rupture — check the 10/13 rule).' };
  const A_one_m2 = Math.PI * Math.pow(d_mm / 1000, 2) / 4;
  const A_m2 = 2 * A_one_m2;                      // both ends of severed tube
  const Cd = 0.6;
  if (phase === 'liquid') {
    const G = num(s.G) || 1.0;
    const rho = G * 999;                          // kg/m³
    const dP_Pa = (Pu_psia - P1_psia) * 6894.757;
    const w_kgs = Cd * A_m2 * Math.sqrt(2 * rho * dP_Pa);
    const Q_gpm = (w_kgs / rho) * 3600 * 4.40287; // m³/h → gpm
    warnings.push(`Tube-rupture load (liquid): 1 tube fully severed, 2×bore area, Cd=0.6, ΔP=${round(dP_Pa/1e5,2)} bar. If the HP fluid flashes into the LP side, size as two-phase (Ω tab) instead — liquid basis may understate the required area.`);
    return { Q_gpm, basis: `Tube rupture: Ø${d_mm} mm, HP ${round(psia_to_barg(Pu_psia),1)} barg (liquid)` };
  }
  // gas: critical orifice via the same C(k)-form as API 520: W = C·Cd·Pu·A·√(M/(T·Z))
  const T_R = toRankine(num(s.T), s.T_u || 'C');
  if (!(T_R > 0)) return { error: 'Tube rupture: temperature invalid.' };
  const g = resolveGasProps(s);
  if (!(g.M > 0 && g.k >= 1)) return { error: 'Tube rupture: fluid M and k required.' };
  let Z = Number.isFinite(num(s.Z)) && num(s.Z) > 0 ? num(s.Z) : 1.0;
  if ((s.autoZ === 'yes' || s.autoZ === true) && g.crit) {
    const roots = solvePR(T_R / 1.8, Pu_psia / 0.145038 * 1000, g.crit.Tc_K, g.crit.Pc_Pa, g.crit.omega);
    if (roots.length) Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z;
  }
  const A_in2 = A_m2 * 1550.0031;
  const critRatio = Math.pow(2 / (g.k + 1), g.k / (g.k - 1));
  if (P1_psia / Pu_psia > critRatio) warnings.push(`Tube rupture: flow is subcritical (P₁/Pu = ${round(P1_psia/Pu_psia,3)} > critical ratio ${round(critRatio,3)}); the critical-flow estimate used here is CONSERVATIVE (overstates load).`);
  const W_lbhr = coeffC(g.k) * Cd * Pu_psia * A_in2 * Math.sqrt(g.M / (T_R * Z));
  warnings.push(`Tube-rupture load (gas): 1 tube fully severed, 2×bore area, sharp-orifice Cd=0.6, critical flow at HP-side conditions per API 521 §4.4.14. Check whether the dynamic (transient) analysis exemption of the 10/13 rule applies before relying on the PSV alone.`);
  return { W_lbhr, basis: `Tube rupture: Ø${d_mm} mm, HP ${round(psia_to_barg(Pu_psia),1)} barg (gas, choked)` };
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION G ► MULTI-SCENARIO GOVERNING-CASE ENGINE  (calc: 'scenarios')
// PSV-datasheet workflow: evaluate every credible overpressure scenario at the
// same set pressure, each with its own ASME accumulation (10% process single /
// 16% multi / 21% fire), then size the orifice on the GOVERNING (largest) area.
// ════════════════════════════════════════════════════════════════════════════
function calcScenarios(p) {
  const warnings = [];
  const rows = Array.isArray(p.scenarios) ? p.scenarios.slice(0, 8) : [];
  if (rows.length < 2) return { error: 'Provide at least 2 scenarios to compare (max 8).' };

  const shared = {
    setP: p.setP, setP_u: p.setP_u,
    Pb: p.Pb, Pb_u: p.Pb_u,
    valveStyle: p.valveStyle, ruptureDisc: p.ruptureDisc,
    nValves: p.nValves,
  };

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i] || {};
    const name = String(s.name || `Scenario ${i + 1}`).slice(0, 60);
    const type = String(s.type || 'gas');
    const loadBasis = String(s.loadBasis || 'manual');
    let r, load = '—', basisNote = '';
    try {
      // Relieving pressure for estimators (process accumulation of this valve set)
      const setPsig0 = toPsia(num(p.setP), p.setP_u || 'barg') - PATM_PSI;
      const P1est = relievingPressure(setPsig0, type === 'fire' ? 'fire' : 'process',
        Math.max(1, Math.round(num(p.nValves) || 1)), undefined).P1;

      if (type === 'gas') {
        let W = s.W, W_u = s.W_u;
        if (loadBasis === 'cvblowby') {
          const est = estGasBlowby(s, P1est, warnings);
          if (est.error) throw new Error(est.error);
          W = est.W_lbhr; W_u = 'lbhr'; basisNote = est.basis;
        } else if (loadBasis === 'tuberupture') {
          const est = estTubeRupture(s, P1est, 'gas', warnings);
          if (est.error) throw new Error(est.error);
          W = est.W_lbhr; W_u = 'lbhr'; basisNote = est.basis;
        }
        r = calcGas({ ...shared, W, W_u, T: s.T, T_u: s.T_u,
          fluid: s.fluid, autoZ: s.autoZ, M: s.M, k: s.k, Z: s.Z,
          Tc_K: s.Tc_K, Pc_bar: s.Pc_bar, omega: s.omega,
          Kd: s.Kd, scenario: 'process', overpressure: s.overpressure });
        load = `${round(toLbHr(num(W), W_u || 'kghr') / 2.20462, 0)} kg/h vapor` + (basisNote ? ` — ${basisNote}` : '');
      } else if (type === 'steam') {
        r = calcSteam({ ...shared, W: s.W, W_u: s.W_u,
          steamState: s.steamState, T: s.T, T_u: s.T_u, Kd: s.Kd,
          overpressure: s.overpressure });
        load = `${round(toLbHr(num(s.W), s.W_u || 'kghr') / 2.20462, 0)} kg/h steam`;
      } else if (type === 'liquid') {
        let Q = s.Q, Q_u = s.Q_u;
        if (loadBasis === 'thermal') {
          const est = estThermal(s, warnings);
          if (est.error) throw new Error(est.error);
          Q = est.Q_gpm; Q_u = 'gpm'; basisNote = est.basis;
        } else if (loadBasis === 'cvblowby') {
          const est = estLiqBlowby(s, P1est, warnings);
          if (est.error) throw new Error(est.error);
          Q = est.Q_gpm; Q_u = 'gpm'; basisNote = est.basis;
        } else if (loadBasis === 'tuberupture') {
          const est = estTubeRupture(s, P1est, 'liquid', warnings);
          if (est.error) throw new Error(est.error);
          Q = est.Q_gpm; Q_u = 'gpm'; basisNote = est.basis;
        }
        r = calcLiquid({ ...shared, Q, Q_u, G: s.G, mu: s.mu,
          Kd: s.Kd, overpressure: s.overpressure });
        const Qm3 = toGpm(num(Q), Q_u || 'm3hr') / 4.40287;
        load = `${round(Qm3, Qm3 < 10 ? 3 : 1)} m³/h liquid` + (basisNote ? ` — ${basisNote}` : '');
      } else if (type === 'fire') {
        r = calcFire({ ...shared, fireMode: 'wetted', AwDirect: true,
          Aw: s.Aw, Aw_u: s.Aw_u || 'm2', envF: s.envF, drainage: s.drainage,
          latentHeat: s.latentHeat, latent_u: s.latent_u,
          T: s.T, T_u: s.T_u, fluid: s.fluid, autoZ: s.autoZ,
          M: s.M, k: s.k, Z: s.Z });
        load = r && !r.error ? `${r.W_relief_kghr} kg/h (fire, Aw ${r.Aw_m2} m²)` : 'fire';
      } else {
        r = { error: `Unknown scenario type "${type}".` };
      }
    } catch (e) { r = { error: e.message }; }

    if (r.error) {
      results.push({ name, type, ok: false, note: r.error, A_req_in2: null });
      warnings.push(`Scenario "${name}" failed: ${r.error}`);
    } else {
      results.push({
        name, type, ok: true,
        A_req_in2: r.A_req_in2, A_req_mm2: r.A_req_mm2,
        P1_barg: r.P1_barg, accum_pct: r.accum_pct,
        load,
        note: (r.warnings && r.warnings.length) ? r.warnings[0].slice(0, 140) : '',
      });
    }
  }

  const okRows = results.filter(r => r.ok);
  if (!okRows.length) return { error: 'All scenarios failed — fix the individual inputs. ' + (warnings[0] || '') };

  const governing = okRows.reduce((a, b) => (a.A_req_in2 > b.A_req_in2 ? a : b));
  results.forEach(r => {
    r.governing = r.ok && r.name === governing.name && r.A_req_in2 === governing.A_req_in2;
    r.pct_of_governing = r.ok ? round(r.A_req_in2 / governing.A_req_in2 * 100, 1) : null;
  });

  const pkg = packageArea(governing.A_req_in2, warnings);
  warnings.push(`Orifice selected on the GOVERNING case "${governing.name}" (${governing.type}, ${governing.accum_pct}% accumulation). Verify the selected valve's rated capacity also covers every other scenario at its own allowable overpressure, and confirm the fire case on the finally-selected orifice (API 521 §4.4).`);
  if (okRows.length < results.length) warnings.unshift(`${results.length - okRows.length} scenario(s) errored and were EXCLUDED from the comparison — resolve them before finalizing.`);

  return {
    calc: 'scenarios',
    status: okRows.length < results.length ? 'FAIL' : 'WARN',
    governing_name: governing.name,
    governing_type: governing.type,
    governing_accum_pct: governing.accum_pct,
    n_scenarios: results.length,
    rows: results,
    ...pkg,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// REFERENCE DATA endpoint (orifice table for frontend)
// ────────────────────────────────────────────────────────────────────────────
function refData() {
  return {
    status: 'PASS',
    orifices: ORIFICES.map(o => ({
      letter: o.L, area_in2: o.A, area_mm2: round(in2_to_mm2(o.A), 0), sizes: o.sizes,
    })),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const calc = String(body.calc || '').slice(0, 24);
  const params = (body.params && typeof body.params === 'object') ? body.params : {};

  try {
    let result;
    switch (calc) {
      case 'gas':      result = calcGas(params);      break;
      case 'steam':    result = calcSteam(params);    break;
      case 'liquid':   result = calcLiquid(params);   break;
      case 'fire':     result = calcFire(params);     break;
      case 'twophase': result = calcTwoPhase(params); break;
      case 'backpressure': result = calcBackPressure(params); break;
      case 'scenarios': result = calcScenarios(params); break;
      case 'ref':      result = refData();            break;
      default:
        return res.status(400).json({ error: `Unknown calc: "${calc}". Valid: gas, steam, liquid, fire, twophase, backpressure, scenarios, ref` });
    }
    if (result.error) return res.status(422).json(result);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: 'Calculation error: ' + e.message });
  }
}

// Export internals for validation harness (tree-shaken by Vercel, harmless)
export { calcGas, calcSteam, calcLiquid, calcFire, calcTwoPhase, calcBackPressure, calcScenarios, coeffC, napierKn, kshLookup, selectOrifice, solvePR, eosPsat, eosPhase };

// ══════════════════════════════════════════════════════════════════════════════
// SECTION E ► PENG-ROBINSON AUTO-Z ENGINE
// Ported from process-calculators.js SECTION B (/api/eos, FIX Z-4 level):
//   • 1978 extended kappa for omega > 0.491
//   • eosPsat: saturation pressure by fugacity equality (Wilson init)
//   • eosPhase: 'vapor' | 'near_dew' | 'liquid' | 'supercritical'
// Anchors (NIST/CoolProp): NH3 273.15K/10e5Pa → Z 0.8854, Psat 4.293e5, liquid
//                          NH3 298.15K/ 5e5Pa → Z 0.9576, Psat 10.04e5, vapor
//                          CO2 333.15K/50e5Pa → Z 0.7919, supercritical
// ══════════════════════════════════════════════════════════════════════════════
const R_GAS = 8.314462; // J/(mol·K)

function solveCubic(c2, c1, c0) {
  const shift = -c2 / 3;
  const p = c1 - c2 * c2 / 3;
  const q = 2 * c2 * c2 * c2 / 27 - c1 * c2 / 3 + c0;
  const D = q * q / 4 + p * p * p / 27;
  let roots = [];
  if (D > 1e-10) {
    const sqrtD = Math.sqrt(D);
    roots = [Math.cbrt(-q / 2 + sqrtD) + Math.cbrt(-q / 2 - sqrtD) + shift];
  } else if (D < -1e-10) {
    const r = Math.sqrt(-p * p * p / 27);
    const theta = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
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

function solvePR(T_K, P_Pa, Tc_K, Pc_Pa, omega) {
  const a0 = 0.45724 * R_GAS * R_GAS * Tc_K * Tc_K / Pc_Pa;
  const b  = 0.07780 * R_GAS * Tc_K / Pc_Pa;
  const kappa = omega <= 0.491
    ? 0.37464 + 1.54226 * omega - 0.26992 * omega * omega
    : 0.379642 + 1.48503 * omega - 0.164423 * omega * omega + 0.016666 * omega * omega * omega;
  const Tr = T_K / Tc_K;
  const ab = 1 + kappa * (1 - Math.sqrt(Math.max(0, Tr)));
  const alpha = Math.max(1e-6, ab * ab);
  const a = a0 * alpha;
  const A = a * P_Pa / (R_GAS * R_GAS * T_K * T_K);
  const B = b * P_Pa / (R_GAS * T_K);
  const Zs = solveCubic(-(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B * B * B));
  return Zs.map((Z) => {
    const sq2 = Math.SQRT2;
    const lnPhi = (Z - 1) - Math.log(Math.max(1e-300, Z - B))
      - A / (2 * sq2 * B) * Math.log(Math.max(1e-300, Z + (1 + sq2) * B) / Math.max(1e-300, Z + (1 - sq2) * B));
    return { Z, phi: Math.exp(lnPhi) };
  });
}

function eosPsat(T_K, Tc_K, Pc_Pa, omega) {
  if (!(T_K < Tc_K)) return null;
  let P = Pc_Pa * Math.exp(5.373 * (1 + omega) * (1 - Tc_K / T_K)); // Wilson init
  if (!(P > 0) || !isFinite(P)) return null;
  for (let i = 0; i < 60; i++) {
    const roots = solvePR(T_K, P, Tc_K, Pc_Pa, omega);
    if (roots.length < 2) {
      const zTop = roots.length ? Math.max(...roots.map(r => r.Z)) : 1;
      P *= zTop > 0.5 ? 1.05 : 0.95;
      continue;
    }
    const rV = roots.reduce((a, b) => (a.Z > b.Z ? a : b));
    const rL = roots.reduce((a, b) => (a.Z < b.Z ? a : b));
    if (!(rV.phi > 0) || !(rL.phi > 0)) return null;
    const Pn = P * (rL.phi / rV.phi);
    if (!isFinite(Pn) || Pn <= 0) return null;
    if (Math.abs(Pn - P) / P < 1e-7) return Pn;
    P = Pn;
  }
  return P;
}

function eosPhase(T_K, P_Pa, Tc_K, Psat_Pa) {
  if (T_K >= Tc_K) return 'supercritical';
  if (Psat_Pa == null) return 'vapor';
  if (P_Pa > Psat_Pa * 1.001) return 'liquid';
  if (P_Pa > Psat_Pa * 0.95)  return 'near_dew';
  return 'vapor';
}

// Gas DB — same values as FLUID_DB_orifice / control-valve library (Tc K, Pc MPa)
const PSV_GAS_DB = {
  'air':      { name:'Air',              M:28.964, k:1.400, Tc:132.5, Pc:3.77,  omega:0.035  },
  'n2':       { name:'Nitrogen (N₂)',    M:28.014, k:1.400, Tc:126.2, Pc:3.39,  omega:0.037  },
  'o2':       { name:'Oxygen (O₂)',      M:32.000, k:1.395, Tc:154.6, Pc:5.04,  omega:0.025  },
  'h2':       { name:'Hydrogen (H₂)',    M:2.016,  k:1.405, Tc:33.2,  Pc:1.30,  omega:-0.216 },
  'co2':      { name:'CO₂',              M:44.010, k:1.289, Tc:304.1, Pc:7.38,  omega:0.239  },
  'co':       { name:'CO',               M:28.010, k:1.400, Tc:132.9, Pc:3.50,  omega:0.048  },
  'ch4':      { name:'Methane (CH₄)',    M:16.043, k:1.304, Tc:190.6, Pc:4.60,  omega:0.012  },
  'c2h6':     { name:'Ethane (C₂H₆)',    M:30.069, k:1.200, Tc:305.3, Pc:4.87,  omega:0.099  },
  'c2h4':     { name:'Ethylene',         M:28.054, k:1.240, Tc:282.4, Pc:5.04,  omega:0.089  },
  'c3h8':     { name:'Propane (C₃H₈)',   M:44.097, k:1.130, Tc:369.8, Pc:4.25,  omega:0.152  },
  'c4h10':    { name:'Butane (C₄H₁₀)',   M:58.124, k:1.100, Tc:425.1, Pc:3.80,  omega:0.200  },
  'natgas':   { name:'Natural Gas',      M:17.967, k:1.310, Tc:203.3, Pc:4.64,  omega:0.010  },
  'nh3':      { name:'Ammonia (NH₃)',    M:17.031, k:1.310, Tc:405.6, Pc:11.28, omega:0.250  },
  'cl2':      { name:'Chlorine',         M:70.906, k:1.340, Tc:417.2, Pc:7.71,  omega:0.069  },
  'so2':      { name:'SO₂',              M:64.065, k:1.290, Tc:430.8, Pc:7.88,  omega:0.245  },
  'h2s':      { name:'H₂S',              M:34.081, k:1.320, Tc:373.2, Pc:8.94,  omega:0.100  },
  'c2h2':     { name:'Acetylene',        M:26.038, k:1.232, Tc:308.3, Pc:6.14,  omega:0.187  },
  'ar':       { name:'Argon',            M:39.948, k:1.667, Tc:150.9, Pc:4.87,  omega:0.001  },
  'he':       { name:'Helium',           M:4.003,  k:1.667, Tc:5.2,   Pc:0.23,  omega:-0.390 },
  'syngas':   { name:'Syngas (3H₂:N₂)',  M:8.525,  k:1.400, Tc:56.5,  Pc:1.82,  omega:-0.150 },
  'biogas':   { name:'Biogas (60% CH₄)', M:27.230, k:1.300, Tc:236.0, Pc:5.71,  omega:0.100  },
  'lpg':      { name:'LPG Vapor',        M:49.708, k:1.110, Tc:391.9, Pc:4.07,  omega:0.170  },
  'fluegas':  { name:'Flue Gas',         M:28.964, k:1.350, Tc:132.5, Pc:3.77,  omega:0.035  },
};

// Resolve M/k + critical props from fluid key or custom params.
// autoZ is applied later, AT RELIEVING CONDITIONS (P1, T1) — API 520 §5.6.
function resolveGasProps(p) {
  const key = (p.fluid || 'custom').toLowerCase();
  if (key !== 'custom' && PSV_GAS_DB[key]) {
    const f = PSV_GAS_DB[key];
    return {
      M: Number.isFinite(num(p.M)) && num(p.M) > 0 ? num(p.M) : f.M,
      k: Number.isFinite(num(p.k)) && num(p.k) > 0 ? num(p.k) : f.k,
      crit: { Tc_K: f.Tc, Pc_Pa: f.Pc * 1e6, omega: f.omega, name: f.name },
    };
  }
  // custom: optional user-supplied criticals enable auto-Z too
  const Tc = num(p.Tc_K), Pc = num(p.Pc_bar), om = num(p.omega);
  const crit = (Tc > 0 && Pc > 0 && Number.isFinite(om))
    ? { Tc_K: Tc, Pc_Pa: Pc * 1e5, omega: om, name: 'Custom fluid' } : null;
  return { M: num(p.M), k: num(p.k), crit };
}

// PR Z at relieving conditions + phase verdict. Returns {Z, phase, Psat_Pa, warnings[]}
function autoZAtRelieving(P1_psia, T1_R, crit) {
  const P_Pa = P1_psia / 0.145038 * 1000;   // psia → kPa → Pa
  const T_K  = T1_R / 1.8;
  const out = { Z: null, phase: null, Psat_Pa: null, warnings: [] };
  const roots = solvePR(T_K, P_Pa, crit.Tc_K, crit.Pc_Pa, crit.omega);
  if (!roots.length) { out.warnings.push('PR EOS found no real root at relieving conditions — auto-Z unavailable, Z = 1 assumed. Verify inputs.'); out.Z = 1; return out; }
  out.Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z;   // vapour root
  out.Psat_Pa = eosPsat(T_K, crit.Tc_K, crit.Pc_Pa, crit.omega);
  out.phase = eosPhase(T_K, P_Pa, crit.Tc_K, out.Psat_Pa);
  if (out.phase === 'liquid') {
    out.warnings.push(`PHASE CHECK (PR EOS): at relieving conditions (${(P_Pa/1e5).toFixed(2)} bar a, ${(T_K-273.15).toFixed(1)} °C) the stable phase of ${crit.name} is LIQUID (Psat ≈ ${(out.Psat_Pa/1e5).toFixed(2)} bar a). Vapor sizing is INVALID here — use the Liquid tab, or the Two-Phase Ω tab if flashing is expected.`);
  } else if (out.phase === 'near_dew') {
    out.warnings.push(`PHASE CHECK (PR EOS): relieving state is within 5% of the dew point (Psat ≈ ${(out.Psat_Pa/1e5).toFixed(2)} bar a). Condensation/two-phase relief possible — consider the Two-Phase Ω method; vapor Z accuracy reduced.`);
  }
  if (out.Z < 0.2) out.warnings.push(`Auto-Z = ${out.Z.toFixed(4)} is very low (liquid-like density). Verify phase before using vapor sizing.`);
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION F ► BUILT-UP BACK PRESSURE (tailpipe) + 3% INLET CHECK
// Isothermal compressible flow, API 521 §5.5 / API 520 Pt II practice:
//   P_up² = P_exit² + G²(ZRT/M)[fL/D + ΣK + 2ln(P_up/P_exit)]
//   Choked exit when P_dest < G·√(ZRT/M) (isothermal sonic limit).
// Inlet 3% check: incompressible at relieving density (losses are small).
// ══════════════════════════════════════════════════════════════════════════════
function toMeters(v, u) {
  switch (u) { case 'mm': return v / 1000; case 'in': return v * 0.0254;
    case 'ft': return v * 0.3048; default: return v; } // m
}

function swameeJain(Re, relRough) {
  if (Re < 2100) return 64 / Math.max(Re, 1);
  const f = 0.25 / Math.pow(Math.log10(relRough / 3.7 + 5.74 / Math.pow(Re, 0.9)), 2);
  return Math.min(Math.max(f, 0.008), 0.1);
}

function calcBackPressure(p) {
  const warnings = [];
  const setPsig = toPsia(num(p.setP), p.setP_u || 'barg') - PATM_PSI;
  if (!(setPsig > 0)) return { error: 'Set pressure must be positive (gauge).' };
  const setPa_g = setPsig * 6894.757;              // Pa gauge

  const w = toLbHr(num(p.W), p.W_u || 'kghr') * 0.000125998; // lb/h → kg/s
  if (!(w > 0)) return { error: 'Relief rate W must be positive.' };
  const T_K = toRankine(num(p.T), p.T_u || 'C') / 1.8;
  if (!(T_K > 0)) return { error: 'Relieving temperature invalid.' };

  // Fluid props (fluid key or custom M/k; Z manual or PR auto at exit state)
  const g = resolveGasProps(p);
  const M = g.M, k = g.k;
  if (!(M > 0 && M < 500)) return { error: 'Molecular weight must be 0–500.' };
  if (!(k >= 1.0 && k < 2.5)) return { error: 'Isentropic exponent k must be 1.0–2.5.' };
  const M_SI = M / 1000;                            // kg/mol

  // Tailpipe geometry
  const D = toMeters(num(p.D_out), p.D_out_u || 'mm');
  const L = toMeters(num(p.L_out), p.L_out_u || 'm');
  const K = Number.isFinite(num(p.K_out)) ? num(p.K_out) : 0;
  if (!(D > 0.005)) return { error: 'Tailpipe internal diameter must be > 5 mm.' };
  if (!(L >= 0))    return { error: 'Tailpipe length invalid.' };
  const rough = (Number.isFinite(num(p.rough)) ? num(p.rough) : 0.046) / 1000; // m
  const mu = Number.isFinite(num(p.mu)) ? num(p.mu) : 1.8e-5;                  // Pa·s

  // Destination
  const Pdest_Pa = p.dest === 'header'
    ? toPsia(num(p.Pdest), p.Pdest_u || 'barg') * 6894.757
    : 101325;
  if (!(Pdest_Pa > 0)) return { error: 'Destination (header) pressure invalid.' };

  // Z for tailpipe (low pressure — manual, or PR at destination state)
  let Z = Number.isFinite(num(p.Z)) && num(p.Z) > 0 ? num(p.Z) : 1.0;
  let Z_source = 'manual';
  if ((p.autoZ === 'yes' || p.autoZ === true) && g.crit) {
    const roots = solvePR(T_K, Pdest_Pa, g.crit.Tc_K, g.crit.Pc_Pa, g.crit.omega);
    if (roots.length) { Z = roots.reduce((a, b) => (a.Z > b.Z ? a : b)).Z; Z_source = 'PR EOS @ tailpipe'; }
  }

  const A = Math.PI * D * D / 4;
  const G = w / A;                                  // kg/m²·s
  const RTs = Z * R_GAS * T_K / M_SI;               // m²/s² (specific ZRT/M)
  const c_iso = Math.sqrt(RTs);

  // Choked-exit check
  const P_choke = G * c_iso;
  let P_exit = Pdest_Pa, choked = false;
  if (P_choke > Pdest_Pa) {
    P_exit = P_choke; choked = true;
    warnings.push(`Tailpipe exit is CHOKED (sonic): exit pressure floats up to ${(P_exit/1e5).toFixed(3)} bar a regardless of the ${(Pdest_Pa/1e5).toFixed(3)} bar a destination. Consider a larger tailpipe.`);
  }

  // Friction factor at pipe conditions
  const Re = G * D / mu;
  const f = swameeJain(Re, rough / D);
  const fLD = f * L / D + K;

  // Iterate P_up (valve outlet flange pressure)
  let P_up = Math.sqrt(P_exit * P_exit + G * G * RTs * fLD);
  for (let i = 0; i < 30; i++) {
    const rhs = P_exit * P_exit + G * G * RTs * (fLD + 2 * Math.log(Math.max(P_up / P_exit, 1)));
    const next = Math.sqrt(rhs);
    if (Math.abs(next - P_up) / P_up < 1e-9) { P_up = next; break; }
    P_up = next;
  }

  // Definitions (API 520): superimposed = dest gauge; built-up = P_up − P_dest; total = P_up gauge
  const superimposed_Pa = Pdest_Pa - 101325;
  const builtup_Pa = P_up - Pdest_Pa;
  const total_g_Pa = P_up - 101325;
  const pctTotal = total_g_Pa / setPa_g * 100;
  const pctBuiltup = builtup_Pa / setPa_g * 100;

  // Exit velocity / Mach / momentum
  const rho_exit = P_exit / RTs;
  const u_exit = G / rho_exit;
  const Ma = u_exit / Math.sqrt(k * RTs);
  const rhoV2 = rho_exit * u_exit * u_exit;
  if (!choked && Ma > 0.7) warnings.push(`Exit Mach ${Ma.toFixed(2)} > 0.7 — API 521 recommends keeping tail-pipe/header Mach ≤ 0.7 to limit noise, vibration and pressure loss.`);
  if (rhoV2 > 100000) warnings.push(`ρv² = ${Math.round(rhoV2/1000)} kPa at exit — high momentum flux; check acoustic-induced vibration (AIV) and support design (Energy Institute guidelines).`);

  // ── Reaction force — API 520 Part II §4.4 (gas, open discharge) ──────────
  // F [lbf] = (W/366)·√(k·T/((k+1)·M)) + A_exit[in²]·(P_exit − P_atm)[psi]
  const W_lbhr   = w / 0.000125998;
  const T_R      = T_K * 1.8;
  const Aexit_in2 = A * 1550.0031;
  const Pexit_psia = P_exit / 6894.757;
  const F_lbf = (W_lbhr / 366) * Math.sqrt(k * T_R / ((k + 1) * M))
              + Aexit_in2 * Math.max(0, Pexit_psia - 14.696);
  const F_N   = F_lbf * 4.44822;
  if (F_N > 5000) warnings.push(`Reaction force ${(F_N/1000).toFixed(1)} kN — verify discharge-pipe supports and nozzle loads. API 520 Pt II: apply a dynamic load factor (up to 2.0) for the opening transient in structural design.`);

  // Valve-style verdict
  const style = p.valveStyle || 'conventional';
  let Kb = 1.0, verdict;
  if (pctTotal <= 10) {
    verdict = 'Conventional spring valve acceptable (total back pressure ≤ 10% of set).';
  } else if (pctTotal <= 50) {
    Kb = kbBellows(pctTotal);
    verdict = `Balanced bellows required (total BP ${pctTotal.toFixed(1)}% of set). Apply Kb = ${Kb.toFixed(3)} to capacity.`;
    if (style === 'conventional') warnings.push(`Selected CONVENTIONAL valve but total back pressure is ${pctTotal.toFixed(1)}% of set (> 10%) — set-point shift and chatter risk. Change to balanced bellows or pilot-operated.`);
  } else {
    verdict = `Total back pressure ${pctTotal.toFixed(1)}% of set (> 50%) — pilot-operated valve territory, or redesign the tailpipe/header.`;
    warnings.push('Back pressure exceeds bellows service range (50%). Increase tailpipe size, shorten routing, or select a pilot-operated PSV with vendor confirmation.');
  }
  if (choked && style !== 'pilot') warnings.push('Choked tailpipe with a spring valve: built-up back pressure is flow-dependent and can interact with valve lift (chatter). Strongly consider resizing the tailpipe.');

  // ── Optional inlet 3% check ──────────────────────────────────────────────
  let inlet = null;
  const Din = num(p.D_in) > 0 ? toMeters(num(p.D_in), p.D_in_u || 'mm') : null;
  if (Din) {
    const Lin = toMeters(num(p.L_in) || 0, p.L_in_u || 'm');
    const Kin = Number.isFinite(num(p.K_in)) ? num(p.K_in) : 0;
    const wIn = num(p.Wrated) > 0 ? toLbHr(num(p.Wrated), p.W_u || 'kghr') * 0.000125998 : w;
    const P1_Pa = (setPsig * 1.10 + PATM_PSI) * 6894.757;   // 10% accumulated, single valve
    const rho1 = P1_Pa / RTs;
    const Ain = Math.PI * Din * Din / 4;
    const vIn = wIn / (rho1 * Ain);
    const ReIn = rho1 * vIn * Din / mu;
    const fIn = swameeJain(ReIn, rough / Din);
    const dP = (fIn * Lin / Din + Kin) * rho1 * vIn * vIn / 2;
    const pctIn = dP / setPa_g * 100;
    const pass = pctIn <= 3.0;
    if (!pass) warnings.push(`INLET CHECK FAILED: non-recoverable inlet loss ${pctIn.toFixed(2)}% of set exceeds the API 520 Pt II 3% rule — chatter/rapid-cycling risk. Increase inlet line size or reduce fittings.`);
    if (!(num(p.Wrated) > 0)) warnings.push('Inlet loss evaluated at REQUIRED flow. API 520 Pt II requires the check at RATED valve capacity — enter rated flow for a rigorous verdict.');
    inlet = {
      dP_kPa: round(dP / 1000, 2), dP_pct_of_set: round(pctIn, 2),
      limit_pct: 3.0, pass, v_ms: round(vIn, 1), basis_kghr: round(wIn * 3600, 0),
    };
  }

  return {
    calc: 'backpressure', status: warnings.length ? 'WARN' : 'PASS',
    // pressures
    P_valve_outlet_bara: round(P_up / 1e5, 3),
    superimposed_barg: round(superimposed_Pa / 1e5, 3),
    builtup_bar: round(builtup_Pa / 1e5, 3),
    total_bp_barg: round(total_g_Pa / 1e5, 3),
    pct_total_of_set: round(pctTotal, 1),
    pct_builtup_of_set: round(pctBuiltup, 1),
    Kb_capacity_factor: round(Kb, 3),
    verdict,
    // hydraulics
    choked_exit: choked,
    exit_P_bara: round(P_exit / 1e5, 3),
    exit_velocity_ms: round(u_exit, 1),
    exit_Mach: round(Ma, 3),
    rhoV2_kPa: round(rhoV2 / 1000, 1),
    reaction_force_N: Math.round(F_N),
    reaction_force_kN: round(F_N / 1000, 2),
    reaction_force_kgf: Math.round(F_N / 9.80665),
    friction_f: round(f, 5), Re: Math.round(Re),
    G_kgm2s: round(G, 1), pipe_ID_mm: round(D * 1000, 1),
    Z_used: round(Z, 4), Z_source,
    inlet,
    warnings,
  };
}
