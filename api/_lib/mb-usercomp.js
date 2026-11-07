// ============================================================================
// mb-usercomp.js — STEP 37: user-defined components from a molecular
// structure (SMILES), with any measured properties the user has.
//
// From the structure (mb-chem.js):
//   formula and molar mass; Joback & Reid (1987) groups → normal boiling
//   point, Tc (through the Tb used), Pc, Vc, melting point, ideal-gas ΔHf and
//   ΔGf at 298.15 K, ideal-gas Cp (cubic, 273–1000 K) and liquid viscosity
//   (where every group has viscosity parameters); UNIFAC and Dortmund
//   subgroups for the activity-coefficient methods; UNIQUAC r, q from the
//   UNIFAC R, Q.
// Then by corresponding states: acentric factor (Lee–Kesler, through Tb, Tc,
//   Pc), vapour pressure (Lee–Kesler), ΔHvap (Riedel at Tb, Watson exponent
//   0.38), liquid density (Rackett; Z_RA fitted to a measured density when
//   given, else through the Tyn–Calus molar volume at Tb), entropy S° = (ΔHf − ΔGf)/T° + Σ S° of the
//   elements in their standard states. Vapour viscosity and conductivity,
//   liquid conductivity and surface tension come from the estimates in
//   mb-thermo.js (Chung; Sato–Riedel; Brock–Bird).
// Measured values always replace estimates: Tb, Tc, Pc, Vc, ω, a liquid
// density at a temperature, ΔHf, ΔGf, a vapour-pressure point (which
// refits ω), the dipole moment, and the UNIFAC / Dortmund groups.
//
// Components are registered into the databank at run time under a key that
// hashes their definition (UC + 8 hex), so the same key always carries the
// same properties. Plain ES module. Server-side only. (c) multicalci.com
// ============================================================================

import compdb from './mb-compdb.js';
import bip from './mb-bip.js';
import chem from './mb-chem.js';
import groups from './mb-groups.js';
import pseudo from './mb-pseudo.js';

export const USERCOMP_VERSION = 'mb-usercomp 1.0.0';
const R = 8.314462618, T0 = 298.15;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
class UserCompError extends Error { constructor(message, field) { super(message); this.code = 'MB_USERCOMP'; this.field = field || 'user_components'; } }
const fail = (m, f) => { throw new UserCompError(m, f); };

// standard molar entropies of the elements in their reference states at 298.15 K, 1 bar,
// per atom [J/(mol K)] — CODATA Key Values (Cox, Wagman & Medvedev 1989)
const S_EL = { C: 5.74, H: 130.680 / 2, O: 205.152 / 2, N: 191.609 / 2, F: 202.791 / 2, Cl: 223.081 / 2, Br: 152.21 / 2, I: 116.14 / 2, S: 32.054, Si: 18.81, P: 41.09, B: 5.90 };

const FIELDS = ['Tb_K', 'Tc_K', 'Pc_bar', 'Vc_m3kmol', 'omega', 'rho_kgm3', 'rho_T_K', 'Hf_kJmol', 'Gf_kJmol', 'Pv_T_K', 'Pv_bar', 'dipole_D', 'muL_cP', 'muL_T_K'];

/** FNV-1a 32-bit hash of the definition (name excluded) */
export function userKey(d) {
  const o = { s: String(d.smiles || '').trim() };
  for (const f of FIELDS) if (num(d[f])) o[f] = +d[f].toPrecision(8);
  for (const g of ['unifac', 'modunifac']) if (d[g] && typeof d[g] === 'object') o[g] = Object.keys(d[g]).sort((a, b) => a - b).map((k) => k + ':' + d[g][k]).join(',');
  if (Array.isArray(d.cp_ig)) o.cp = d.cp_ig.map((v) => (num(v) ? +v.toPrecision(8) : v)).join(',');
  const txt = JSON.stringify(o);
  let h = 0x811c9dc5;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'UC' + h.toString(16).padStart(8, '0').toUpperCase();
}
function cleanGroups(g, table, field) {
  if (g === undefined || g === null) return null;
  if (typeof g !== 'object' || Array.isArray(g)) fail(`${field} must be an object {subgroup id: count}`, field);
  const out = {};
  for (const [k, v] of Object.entries(g)) {
    const id = parseInt(k, 10);
    if (!table[id]) fail(`${field}: no subgroup ${k}`, field);
    if (!Number.isInteger(v) || v < 1 || v > 60) fail(`${field}: count of subgroup ${k} must be a whole number 1–60`, field);
    out[id] = v;
  }
  return Object.keys(out).length ? out : null;
}
/** Lee–Kesler acentric factor from Tb, Tc [K], Pc [bar] */
export function leeKeslerOmega(Tb, Tc, Pc) {
  const th = Tb / Tc;
  return (-Math.log(Pc / 1.01325) - 5.92714 + 6.09648 / th + 1.28862 * Math.log(th) - 0.169347 * th ** 6) /
    (15.2518 - 15.6875 / th - 13.4721 * Math.log(th) + 0.43577 * th ** 6);
}
/** ω from one vapour-pressure point by the Lee–Kesler equation */
function omegaFromPoint(T, P, Tc, Pc) {
  const Tr = T / Tc;
  const f0 = 5.92714 - 6.09648 / Tr - 1.28862 * Math.log(Tr) + 0.169347 * Tr ** 6;
  const f1 = 15.2518 - 15.6875 / Tr - 13.4721 * Math.log(Tr) + 0.43577 * Tr ** 6;
  return (Math.log(P / Pc) - f0) / f1;
}

/**
 * Joback estimates for a parsed molecule.
 * @returns {{ok, status, groups:[{id, name, n}], Tb, Tc(Tb), Pc, Vc, Tm, Hf, Gf, cp:[a,b,c,d], Hvap, mu:[a,b]|null}}
 */
export function joback(mol) {
  const fr = chem.fragmentSimple(groups.JOBACK, mol);
  const byId = new Map(groups.JOBACK.map((g) => [g.id, g]));
  const list = Object.entries(fr.counts).map(([id, n]) => ({ g: byId.get(+id), n }));
  const sum = (f) => { let s = 0; for (const { g, n } of list) { if (!num(g[f])) return NaN; s += g[f] * n; } return s; };
  const nA = Object.values(chem.formula(mol)).reduce((a, b) => a + b, 0);
  const sTc = sum('Tc'), sPc = sum('Pc');
  const out = {
    ok: fr.success, status: fr.status, groups: list.map(({ g, n }) => ({ id: g.id, name: g.g, n })),
    Tb: 198 + sum('Tb'), Tm: 122.5 + sum('Tm'),
    TcOf: (Tb) => Tb / (0.584 + 0.965 * sTc - sTc * sTc),
    Pc: 1 / Math.pow(0.113 + 0.0032 * nA - sPc, 2),                 // bar
    Vc: 17.5 + sum('Vc'),                                            // cm³/mol
    Hf: 68.29 + sum('Hf'), Gf: 53.88 + sum('Gf'),                    // kJ/mol
    cp: [sum('Cpa') - 37.93, sum('Cpb') + 0.210, sum('Cpc') - 3.91e-4, sum('Cpd') + 2.06e-7],
    Hvap: 15.30 + sum('Hvap'),
    mu: list.every(({ g }) => num(g.mua) && num(g.mub)) ? [sum('mua'), sum('mub')] : null,
  };
  return out;
}

/**
 * Databank record of a user component (ChemSep units: Pa, J/kmol, m³/kmol) and a report.
 * @param {object} d {smiles, name?, Tb_K?, Tc_K?, Pc_bar?, Vc_m3kmol?, omega?, rho_kgm3?, rho_T_K?, Hf_kJmol?, Gf_kJmol?,
 *                    Pv_T_K?, Pv_bar?, dipole_D?, unifac?, modunifac?}
 */
export function userRecord(d) {
  if (!d || typeof d !== 'object') fail('a user component must be an object {smiles, …}');
  for (const f of FIELDS) if (d[f] !== undefined && d[f] !== null && !num(d[f])) fail(`${f} must be a number`, f);
  let mol;
  try { mol = chem.parseSmiles(d.smiles); } catch (e) { fail('SMILES: ' + e.message, 'smiles'); }
  if (mol.atoms.length > 60) fail('at most 60 heavy atoms', 'smiles');
  if (mol.atoms.some((a) => a.charge !== 0) && !mol.atoms.every((a) => a.charge === 0 || a.el === 'N' || a.el === 'O')) fail('ions are not supported — give a neutral molecule', 'smiles');
  const F = chem.formula(mol), MW = chem.molarMass(mol);
  if (!F.C) fail('give an organic molecule (with carbon) — inorganic species need measured data the estimates do not cover', 'smiles');
  const jb = joback(mol);
  const src = {}, warn = [];
  const need = (what) => fail(`Joback cannot fragment this molecule (${jb.status}) — give the ${what}`, 'smiles');
  // boiling point and critical constants
  let Tb = d.Tb_K;
  if (num(Tb)) { if (Tb < 100 || Tb > 1200) fail('Tb_K must be 100–1200 K', 'Tb_K'); src.Tb = 'given'; }
  else { if (!jb.ok) need('normal boiling point Tb'); Tb = jb.Tb; src.Tb = 'Joback'; warn.push('normal boiling point estimated by Joback (typically ±4 %, worse for large or polar molecules) — enter the measured value if known'); }
  let Tc = d.Tc_K;
  if (num(Tc)) { if (Tc <= Tb) fail('Tc_K must be above the boiling point', 'Tc_K'); src.Tc = 'given'; }
  else { if (!jb.ok) need('critical temperature Tc'); Tc = jb.TcOf(Tb); src.Tc = 'Joback (through Tb)'; }
  let Pc = d.Pc_bar;
  if (num(Pc)) { if (Pc < 1 || Pc > 300) fail('Pc_bar must be 1–300 bar', 'Pc_bar'); src.Pc = 'given'; }
  else { if (!jb.ok) need('critical pressure Pc'); Pc = jb.Pc; src.Pc = 'Joback'; }
  let Vc = d.Vc_m3kmol;
  if (num(Vc)) { if (Vc < 0.02 || Vc > 3) fail('Vc_m3kmol must be 0.02–3 m³/kmol', 'Vc_m3kmol'); src.Vc = 'given'; }
  else if (jb.ok && num(jb.Vc)) { Vc = jb.Vc / 1000; src.Vc = 'Joback'; }
  else { Vc = 0.27 * R * Tc / (Pc * 1e5) * 1000; src.Vc = 'Zc = 0.27'; }
  if (!(Tc > Tb && Pc > 0 && Vc > 0)) fail('the estimates give no valid critical point — enter Tb, Tc and Pc', 'smiles');
  let w = d.omega;
  if (num(w)) { if (w < -0.4 || w > 2) fail('omega must be −0.4 to 2', 'omega'); src.omega = 'given'; }
  else if (num(d.Pv_T_K) && num(d.Pv_bar)) {
    if (!(d.Pv_T_K < Tc && d.Pv_T_K > 0.3 * Tc && d.Pv_bar > 0)) fail('the vapour-pressure point must lie between 0.3 Tc and Tc', 'Pv_T_K');
    w = omegaFromPoint(d.Pv_T_K, d.Pv_bar, Tc, Pc); src.omega = 'Lee–Kesler through the vapour-pressure point';
  } else { w = leeKeslerOmega(Tb, Tc, Pc); src.omega = 'Lee–Kesler through Tb'; }
  const Zc = Pc * 1e5 * Vc / 1000 / (R * Tc);
  // formation properties
  let Hf = d.Hf_kJmol, Gf = d.Gf_kJmol;
  if (num(Hf)) src.Hf = 'given'; else if (jb.ok && num(jb.Hf)) { Hf = jb.Hf; src.Hf = 'Joback'; } else { Hf = 0; src.Hf = 'none (0)'; warn.push('ΔHf unknown — set to 0: fine for heat balances without reaction, wrong in any reaction'); }
  if (num(Gf)) src.Gf = 'given'; else if (jb.ok && num(jb.Gf)) { Gf = jb.Gf; src.Gf = 'Joback'; } else { Gf = Hf; src.Gf = 'none'; }
  let S0 = (Hf - Gf) * 1000 / T0;
  let sOk = true;
  for (const [el, n] of Object.entries(F)) { if (S_EL[el] === undefined) { sOk = false; break; } S0 += n * S_EL[el]; }
  if (!sOk) { S0 = 300; warn.push('absolute entropy not available for this element set — set to 300 J/(mol K)'); }
  // ideal-gas Cp (ChemSep eq 4, J/(kmol K)): Joback, or the user's polynomial a + bT + cT² + dT³ [J/(mol K)]
  let cpc;
  if (Array.isArray(d.cp_ig) && d.cp_ig.length >= 1 && d.cp_ig.length <= 4 && d.cp_ig.every(num)) { cpc = [0, 0, 0, 0].map((_v, i) => d.cp_ig[i] || 0); src.cp = 'given'; }
  else if (d.cp_ig !== undefined) fail('cp_ig must be [a, b, c, d] of Cp = a + bT + cT² + dT³ in J/(mol K)', 'cp_ig');
  else { if (!jb.ok || jb.cp.some((v) => !num(v))) need('ideal-gas heat capacity cp_ig'); cpc = jb.cp; src.cp = 'Joback'; }
  const cpig = [4, cpc[0] * 1000, cpc[1] * 1000, cpc[2] * 1000, cpc[3] * 1000, 0, 273.15, 1000];
  const cp300 = cpc[0] + 300 * (cpc[1] + 300 * (cpc[2] + 300 * cpc[3]));
  if (!(cp300 > 20)) fail('the Joback heat capacity is not physical for this structure', 'smiles');
  // vapour pressure (Lee–Kesler as ChemSep eq 101), ΔHvap (Riedel at Tb, Watson 0.38)
  const lnPc = Math.log(Pc * 1e5);
  const psat = [101, lnPc + (5.92714 + 15.2518 * w) + (1.28862 + 13.4721 * w) * Math.log(Tc), -(6.09648 + 15.6875 * w) * Tc,
    -(1.28862 + 13.4721 * w), (0.169347 + 0.43577 * w) / Math.pow(Tc, 6), 6, Math.max(0.3 * Tc, 100), Tc];
  const Tbr = Tb / Tc;
  const dHb = 1.093 * R * Tc * Tbr * (Math.log(Pc) - 1.013) / (0.930 - Tbr) * 1000;     // J/kmol
  const hvap = [106, dHb / Math.pow(1 - Tbr, 0.38), 0.38, 0, 0, 0, Math.max(0.3 * Tc, 100), Tc];
  // liquid density: Rackett (eq 105: ρ = A / B^(1 + (1 − T/C)^D) kmol/m³)
  const A = Pc * 1e5 / (8314.462618 * Tc);
  let zra;
  if (num(d.rho_kgm3)) {
    const Tr = num(d.rho_T_K) ? d.rho_T_K : T0;
    if (!(d.rho_kgm3 > 100 && d.rho_kgm3 < 3000)) fail('rho_kgm3 must be 100–3000 kg/m³', 'rho_kgm3');
    if (!(Tr < Tc)) fail('rho_T_K must be below Tc', 'rho_T_K');
    zra = Math.pow(A / (d.rho_kgm3 / MW), 1 / (1 + Math.pow(1 - Tr / Tc, 2 / 7)));
    src.rho = 'Rackett, fitted to the given density';
  } else {
    // Tyn–Calus molar volume at the boiling point, Vb = 0.285 Vc^1.048 (cm³/mol), anchors the Rackett curve
    const Vb = 0.285 * Math.pow(Vc * 1000, 1.048) / 1000;                            // m³/kmol
    zra = Math.pow(Vb * Pc * 1e5 / (8314.462618 * Tc), 1 / (1 + Math.pow(1 - Tb / Tc, 2 / 7)));
    if (!(zra > 0.15 && zra < 0.35)) zra = 0.29056 - 0.08775 * w;
    src.rho = 'Rackett through the Tyn–Calus volume at Tb';
  }
  const rhol = [105, A, zra, Tc, 2 / 7, 0, Math.max(0.3 * Tc, 100), Tc];
  // liquid viscosity: Joback where all groups carry it, μ = M exp((Σa − 597.82)/T + Σb − 11.202);
  // otherwise the n-paraffin of the same Tb at the same T/Tb (corresponding states, as for
  // pseudo-components). A measured point shifts the curve onto it.
  let mul = null;
  if (jb.ok && jb.mu) { mul = [101, Math.log(MW) + jb.mu[1] - 11.202, jb.mu[0] - 597.82, 0, 0, 0, Math.max(0.3 * Tc, 150), 0.7 * Tc]; src.mul = 'Joback (to 0.7 Tc), Letsou–Stiel above'; }
  else {
    const Ts = [0.55, 0.7, 0.85, 1.0, 1.15].map((r) => r * Tb).filter((T) => T < 0.95 * Tc);
    if (Ts.length >= 3) {
      const M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v3 = [0, 0, 0];
      for (const T of Ts) { const y = pseudo.lnMuRef(Tb, T), f = [1, 1 / T, Math.log(T)]; for (let i = 0; i < 3; i++) { v3[i] += f[i] * y; for (let j = 0; j < 3; j++) M3[i][j] += f[i] * f[j]; } }
      const sol = solve3(M3, v3);
      if (sol.every(num)) { mul = [101, sol[0], sol[1], sol[2], 0, 0, Math.min(...Ts) * 0.9, Math.max(...Ts)]; src.mul = 'n-paraffin of the same Tb at the same T/Tb'; }
    }
    if (!mul) src.mul = 'Letsou–Stiel / Lewis–Squires';
  }
  if (num(d.muL_cP)) {
    if (!(d.muL_cP > 0.01 && d.muL_cP < 1e5)) fail('muL_cP must be 0.01–100000 cP', 'muL_cP');
    const Tm = num(d.muL_T_K) ? d.muL_T_K : T0;
    if (!mul) fail('give the structure Joback reads, or no viscosity point', 'muL_cP');
    const est = Math.exp(mul[1] + mul[2] / Tm + mul[3] * Math.log(Tm));
    mul[1] += Math.log(d.muL_cP * 1e-3 / est);
    mul[6] = Math.min(mul[6], 0.9 * Tm); mul[7] = Math.max(mul[7], 1.05 * Tm);
    src.mul += ', shifted onto the given point';
  } else warn.push('liquid viscosity is an estimate (typically ±20–35 %) — enter one measured value to anchor it');
  // activity-model groups
  const USUB = Object.assign({}, groups.UNIFAC_SUB_ALL, bip.UNIFAC_SUB), DSUB = Object.assign({}, groups.DORTMUND_SUB_ALL, bip.DORTMUND_SUB);
  const gUser = { unifac: cleanGroups(d.unifac, USUB, 'unifac'), modunifac: cleanGroups(d.modunifac, DSUB, 'modunifac') };
  const gOut = {}, gReport = {};
  for (const [field, cat, table] of [['unifac', groups.UNIFAC_SG, USUB], ['modunifac', groups.DORTMUND_SG, DSUB]]) {
    if (gUser[field]) { gOut[field] = gUser[field]; gReport[field] = { source: 'given', ok: true }; continue; }
    const fr = chem.fragmentPriority(cat, mol);
    if (fr.success && Object.keys(fr.counts).every((k) => table[k])) { gOut[field] = {}; for (const [k, v] of Object.entries(fr.counts)) gOut[field][k] = v; gReport[field] = { source: 'from the structure', ok: true }; }
    else gReport[field] = { source: 'none', ok: false, status: fr.status };
  }
  let uqr, uqq;
  if (gOut.unifac) { uqr = 0; uqq = 0; for (const [k, v] of Object.entries(gOut.unifac)) { uqr += v * USUB[k][1]; uqq += v * USUB[k][2]; } }
  const dip = num(d.dipole_D) ? d.dipole_D * 3.33564e-30 : 0;
  const rec = {
    name: d.name ? String(d.name).slice(0, 60) : chem.hillFormula(F), cas: '', formula: chem.hillFormula(F), smiles: mol.smiles, family: 0,
    mw: MW, tc: Tc, pc: Pc * 1e5, vc: Vc, zc: Zc, w, tb: Tb, tm: jb.ok && num(jb.Tm) ? jb.Tm : undefined,
    hf: Hf * 1e6, gf: Gf * 1e6, s0: S0 * 1000, dip, zra, vcost: Vc, wcost: w,
    psat, cpig, hvap, rhol, cat: 'user',
    user: { src, warn, joback: { ok: jb.ok, status: jb.status, groups: jb.groups }, groups: gReport },
  };
  if (mul) rec.mul = mul;
  if (gOut.unifac) rec.unifac = gOut.unifac;
  if (gOut.modunifac) rec.modunifac = gOut.modunifac;
  if (num(uqr)) { rec.uqr = uqr; rec.uqq = uqq; }
  return rec;
}

function solve3(A, b) {
  const M = A.map((r, i) => r.concat([b[i]]));
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let j = i; j < 4; j++) M[r][j] -= f * M[i][j]; }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Register user components (idempotent). @returns {string[]} keys */
export function registerUserComponents(list) {
  if (!Array.isArray(list)) fail('user_components must be an array');
  if (list.length > 30) fail('at most 30 user components');
  const keys = [];
  list.forEach((d, i) => {
    if (!d || typeof d !== 'object') fail(`user_components[${i}] must be an object {smiles, …}`);
    const k = userKey(d);
    if (d.key !== undefined && d.key !== k) fail(`user_components[${i}]: key '${d.key}' does not match its definition (expected '${k}')`);
    if (!compdb.has(k)) {
      let rec;
      try { rec = userRecord(d); } catch (e) { e.message = `user_components[${i}]: ${e.message}`; throw e; }
      compdb.COMPS[k] = rec;
    } else if (d.name && compdb.get(k).name !== String(d.name).slice(0, 60)) compdb.get(k).name = String(d.name).slice(0, 60);
    keys.push(k);
  });
  return keys;
}

/** what the component picker / inspector shows */
export function userReport(k) {
  const c = compdb.get(k);
  if (!c || !c.user) return null;
  const USUB = Object.assign({}, groups.UNIFAC_SUB_ALL, bip.UNIFAC_SUB), DSUB = Object.assign({}, groups.DORTMUND_SUB_ALL, bip.DORTMUND_SUB);
  const sub = (field, table) => (c[field] ? Object.entries(c[field]).map(([id, n]) => ({ id: +id, name: table[id] ? table[id][3] : String(id), n })) : null);
  return {
    key: k, name: c.name, formula: c.formula, smiles: c.smiles, MW: c.mw, Tb_K: c.tb, Tc_K: c.tc, Pc_bar: c.pc / 1e5, Vc_m3kmol: c.vc, Zc: c.zc, omega: c.w,
    Tm_K: c.tm, Hf_kJmol: c.hf / 1e6, Gf_kJmol: c.gf / 1e6, S0_JmolK: c.s0 / 1000, Z_RA: c.zra, dipole_D: c.dip / 3.33564e-30,
    rho298_kgm3: c.mw * c.rhol[1] / Math.pow(c.rhol[2], 1 + Math.pow(Math.max(1 - T0 / c.tc, 0), 2 / 7)),
    cp298_JmolK: (c.cpig[1] + T0 * (c.cpig[2] + T0 * (c.cpig[3] + T0 * c.cpig[4]))) / 1000,
    muL298_cP: c.mul && c.mul[0] === 101 && T0 < c.tc ? 1000 * Math.exp(c.mul[1] + c.mul[2] / T0 + c.mul[3] * Math.log(T0)) : null,
    sources: c.user.src, warnings: c.user.warn, joback: c.user.joback,
    unifac: sub('unifac', USUB), modunifac: sub('modunifac', DSUB), groups: c.user.groups,
  };
}

export default { USERCOMP_VERSION, userKey, userRecord, registerUserComponents, userReport, joback, leeKeslerOmega };
