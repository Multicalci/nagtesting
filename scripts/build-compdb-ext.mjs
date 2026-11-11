// ============================================================================
// Round 12 — extended pure-component databank (step 2 of 2).
//
//   node scripts/build-compdb-ext.mjs /tmp/compdb-ext-input.json [api/_lib/mb-compdb-ext.js]
//
// Reads the measured data gathered by scripts/gather-compdb-ext.py and writes
// api/_lib/mb-compdb-ext.js, merged into the databank by mb-compdb.js after the
// ChemSep components. Each compound goes through these checks before it is
// written (a failed check drops the compound, or drops the one correlation and
// leaves the estimate in its place; build-compdb-ext-report.json lists both):
//   - the structure (SMILES) has the formula the data are filed under;
//   - critical constants: where sources disagree by more than 3 % (Tc) or 10 %
//     (Pc), the value closest to the Joback estimate is taken; a single value
//     more than 15 % (Tc) or 40 % (Pc) from Joback is not used; 0.40 < Tb/Tc
//     < 0.95, 0.15 < Zc < 0.40;
//   - a measured vapour-pressure correlation must give 1 atm within 3 K (0.6 %)
//     of a tabulated normal boiling point when its range contains it (and then
//     sets Tb); an Antoine equation measured over a range short of the
//     critical point is refitted as DIPPR eq. 101 through its own points, the
//     boiling point and the critical point (3 %, 1 %, 3 %, rising); ω follows from it at Tr = 0.7 (its
//     definition) when the Lee–Kesler curve with that ω still meets the boiling
//     point within 10 %, and otherwise from the boiling point (Lee–Kesler);
//   - ideal-gas Cp within 25 % of Joback at 298 K and increasing with T;
//     heat of vaporisation within 15 % of Riedel–Watson at the boiling point;
//     liquid density 300–3500 kg/m³ and within 15 % of Rackett; liquid Cp
//     between 0.9 and 4 times the ideal-gas Cp; viscosities, conductivities and
//     surface tension inside physical bounds at a temperature in their range.
// What is not measured is estimated as for a component given by its structure
// (mb-usercomp.js): Joback ideal-gas Cp and ΔHf, Lee–Kesler vapour pressure,
// Riedel–Watson heat of vaporisation, Rackett density, UNIFAC / Dortmund groups.
// (c) multicalci.com
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chem from '../api/_lib/mb-chem.js';
import compdb from '../api/_lib/mb-compdb.js';
import uc from '../api/_lib/mb-usercomp.js';
import { corr } from '../api/_lib/mb-thermo.js';
import groups from '../api/_lib/mb-groups.js';
import bip from '../api/_lib/mb-bip.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN = process.argv[2] || '/tmp/compdb-ext-input.json';
const OUT = process.argv[3] || path.join(ROOT, 'api/_lib/mb-compdb-ext.js');
const R = 8.314462618, T0 = 298.15, P0 = 101325;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const S_EL = { C: 5.74, H: 130.680 / 2, O: 205.152 / 2, N: 191.609 / 2, F: 202.791 / 2, Cl: 223.081 / 2, Br: 152.21 / 2, I: 116.14 / 2, S: 32.054, Si: 18.81, P: 41.09, B: 5.90, He: 126.153, Ne: 146.328, Ar: 154.846, Kr: 164.085, Xe: 169.685 };

const input = JSON.parse(fs.readFileSync(IN, 'utf8'));
const USUB = Object.assign({}, groups.UNIFAC_SUB_ALL, bip.UNIFAC_SUB), DSUB = Object.assign({}, groups.DORTMUND_SUB_ALL, bip.DORTMUND_SUB);
const groupStats = { unifac: { same: 0, differ: 0, added: 0, own: 0 }, modunifac: { same: 0, differ: 0, added: 0, own: 0 } };
const base = compdb.keys().filter((k) => !compdb.get(k).ext);
const baseCas = new Set(base.map((k) => compdb.get(k).cas).filter(Boolean));
const used = new Set(base.map((k) => k.toLowerCase()));

const SOURCES = [];
const sid = (s) => { let i = SOURCES.indexOf(s); if (i < 0) { SOURCES.push(s); i = SOURCES.length - 1; } return i; };
const report = { dropped: [], props_rejected: [], choices: [], groups: [] };
const drop = (r, why) => { report.dropped.push({ cas: r.cas, name: r.name, why }); return null; };
const rejectProp = (r, prop, why) => report.props_rejected.push({ cas: r.cas, name: r.name, prop, why });

function parseFormula(s) {
  const o = {};
  for (const [, el, n] of String(s).matchAll(/([A-Z][a-z]?)(\d*)/g)) o[el] = (o[el] || 0) + (n ? +n : 1);
  return o;
}
const sameFormula = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };

// display name: CAS-index inversions turned round ("octane, 2,7-dimethyl-" → "2,7-dimethyloctane"), first word capitalised
function prettyName(n) {
  let s = String(n || '').trim();
  const m = s.match(/^([^,]+), (.+-)$/);
  if (m) s = m[2] + m[1];
  s = s.replace(/\s*\((?:[A-Z][a-z]?\d*)+\)$/, '');
  // capitalise the first word of three or more letters that is not a stereo / position prefix (as ChemSep names: "2-Methylhexane", "cis-2-Hexene")
  const re = /[A-Za-z]{3,}/g;
  let mm;
  while ((mm = re.exec(s))) {
    if (/^(cis|trans|tert|sec|iso|exo|endo|alpha|beta|gamma)$/i.test(mm[0]) && s[mm.index + mm[0].length] === '-') continue;
    s = s.slice(0, mm.index) + mm[0][0].toUpperCase() + s.slice(mm.index + 1);
    break;
  }
  return s.slice(0, 60);
}
function slug(n, cas) {
  let k = String(n).toLowerCase().replace(/[′']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!k || k.length > 40) k = 'cas-' + cas;
  if (used.has(k)) k = k + '-' + cas.replace(/-/g, '');
  used.add(k);
  return k;
}
function category(F) {
  if (!F.C) return 'inorganic';
  if (F.F || F.Cl || F.Br || F.I) return 'halogenated';
  if (F.S) return 'sulfur';
  if (F.N) return 'nitrogen';
  if (F.O || F.Si || F.B || F.P) return 'oxygenate';
  return 'hydrocarbon';
}

// Lee–Kesler vapour pressure and its ChemSep eq-101 form (as mb-usercomp.js)
const lkP = (T, Tc, Pc, w) => { const Tr = T / Tc; return Pc * Math.exp(5.92714 - 6.09648 / Tr - 1.28862 * Math.log(Tr) + 0.169347 * Tr ** 6 + w * (15.2518 - 15.6875 / Tr - 13.4721 * Math.log(Tr) + 0.43577 * Tr ** 6)); };
const lk101 = (Tc, Pc, w) => { const lnPc = Math.log(Pc); return [101, lnPc + (5.92714 + 15.2518 * w) + (1.28862 + 13.4721 * w) * Math.log(Tc), -(6.09648 + 15.6875 * w) * Tc, -(1.28862 + 13.4721 * w), (0.169347 + 0.43577 * w) / Math.pow(Tc, 6), 6, Math.max(0.3 * Tc, 5), Tc]; };
const riedelHb = (Tb, Tc, Pc) => { const Tbr = Tb / Tc; return 1.093 * R * Tc * Tbr * (Math.log(Pc / 1e5) - 1.013) / (0.930 - Tbr) * 1000; };   // J/kmol
const rackett = (T, Tc, Pc, zra) => (Pc / (8314.462618 * Tc)) / Math.pow(zra, 1 + Math.pow(Math.max(1 - T / Tc, 0), 2 / 7));   // kmol/m3
const ev = (c, T, Tc) => { try { return corr(c, T, Tc); } catch (_e) { return NaN; } };
const inRange = (c, T) => Math.min(Math.max(T, c[6]), c[7]);

// temperature at which a correlation reaches P (bisection), NaN if not bracketed
function tAtP(c, P, lo, hi, Tc) {
  const f = (T) => ev(c, T, Tc) - P;
  if (!(hi > lo) || !(f(lo) < 0 && f(hi) > 0)) return NaN;
  for (let i = 0; i < 80; i++) { const m = 0.5 * (lo + hi); if (f(m) > 0) hi = m; else lo = m; }
  return 0.5 * (lo + hi);
}
// Gaussian elimination with partial pivoting
function solveN(A, b) {
  const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    if (!(Math.abs(M[i][i]) > 1e-300)) return new Array(n).fill(NaN);
    for (let k = 0; k < n; k++) if (k !== i) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// ---------------------------------------------------------------- critical constants
function chooseCrit(r, field, est, tolSpread, tolSingle) {
  const c = (r.cands[field] || []).filter((x) => num(x[0]) && x[0] > 0);       // priority order: IUPAC, Matthews, CRC, PSRK
  if (!c.length) return null;
  const confirm = c.slice();
  if (field === 'Tc' && num(r.Tc_psat)) confirm.push([r.Tc_psat, 'vapour-pressure correlation']);
  const vals = c.map((x) => x[0]);
  const spread = Math.max(...vals) / Math.min(...vals) - 1;
  let pick = c[0];
  if (pick[1] === 'IUPAC' || /^reference equation of state/.test(pick[1])) return { v: pick[0], src: pick[1] };   // evaluated values are taken as they are
  if (num(est) && spread > tolSpread) {
    pick = c.slice().sort((a, b) => Math.abs(a[0] / est - 1) - Math.abs(b[0] / est - 1))[0];
    if (pick !== c[0]) report.choices.push({ cas: r.cas, name: r.name, field, chosen: pick, first: c[0], estimate: +est.toPrecision(5) });
  }
  if (num(est) && Math.abs(pick[0] / est - 1) > tolSingle) {
    // a value far from the estimate is kept only if a second source confirms it within 2 %
    const confirmed = confirm.some((x) => x !== pick && Math.abs(x[0] / pick[0] - 1) < 0.02);
    if (!confirmed) return { bad: `${field} ${pick[0]} (${pick[1]}) is ${(100 * (pick[0] / est - 1)).toFixed(0)} % from the Joback estimate ${est.toPrecision(4)}` };
  }
  return { v: pick[0], src: pick[1] };
}

// ---------------------------------------------------------------- property checks
function checkCorr(r, key, c, ctx) {
  const { Tc, Tb, MW, cpig } = ctx;
  if (!Array.isArray(c) || c.slice(0, 8).some((v) => !num(v))) return 'incomplete coefficients';
  if (!(c[7] > c[6])) return 'empty temperature range';
  const mid = (c[6] + c[7]) / 2;
  const at = (T) => ev(c, T, Tc);
  if (key === 'cpig') {
    const v1 = at(Math.max(c[6], 250)), v2 = at(Math.min(c[7], 800));
    if (!(v1 > 0 && v2 >= v1 * 0.995)) return 'not positive / not increasing with temperature';
    if (ctx.jbCp298) { const v = at(inRange(c, T0)) / 1000; if (Math.abs(v / ctx.jbCp298 - 1) > 0.25) return `Cp(298 K) ${v.toFixed(1)} J/(mol K) vs Joback ${ctx.jbCp298.toFixed(1)}`; }
  } else if (key === 'hvap') {
    // Trouton ratio at the boiling point: 20–160 J/(mol K) covers HF and the carboxylic acids (associated vapours) to the glycols
    const Tt = inRange(c, Tb), v = at(Tt) * Math.pow((1 - Tb / Tc) / (1 - Tt / Tc), 0.38), tr = v / 1000 / Tb;
    if (!(tr > 20 && tr < 160)) return `ΔHvap ${(v / 1e6).toFixed(2)} kJ/mol at the boiling point (Trouton ratio ${tr.toFixed(0)} J/(mol K))`;
  } else if (key === 'rhol') {
    const Tt = inRange(c, Math.min(Math.max(T0, ctx.Tm || 0), 0.9 * Tc, Tb)), v = c[0] === 105 && Tt >= c[3] ? NaN : at(Tt), kg = v * MW;
    if (!(kg > 300 && kg < 3500)) return `density ${kg.toFixed(0)} kg/m³ at ${Tt.toFixed(0)} K`;
    const e = rackett(Tt, Tc, ctx.Pc, ctx.zraEst);
    if (!(v / e > 0.4 && v / e < 3)) return `density ${kg.toFixed(0)} kg/m³ vs Rackett ${(e * MW).toFixed(0)}`;
    if (c[7] - c[6] > 20 && !(at(c[6] + 0.25 * (c[7] - c[6])) > at(c[6] + 0.75 * (c[7] - c[6])))) return 'density does not fall with temperature';
  } else if (key === 'cpl') {
    const Tt = inRange(c, Math.min(Math.max(T0, ctx.Tm || 0), 0.85 * Tc)), v = at(Tt), g = ev(cpig, Tt, Tc);
    if (!(v > 0.9 * g && v < 4 * g)) return `liquid Cp ${(v / 1000).toFixed(0)} vs ideal-gas ${(g / 1000).toFixed(0)} J/(mol K)`;
  } else if (key === 'mul') { const v = at(mid); if (!(v > 2e-5 && v < 50)) return `viscosity ${v} Pa s at ${mid.toFixed(0)} K`; }
  else if (key === 'muv') { const v = at(Math.min(Math.max(mid, 300), c[7])); if (!(v > 2e-6 && v < 1e-4)) return `vapour viscosity ${v} Pa s`; }
  else if (key === 'kl') { const v = at(mid); if (!(v > 0.02 && v < 0.8)) return `liquid conductivity ${v} W/(m K)`; }
  else if (key === 'kv') { const v = at(Math.min(Math.max(mid, 300), c[7])); if (!(v > 0.002 && v < 0.3)) return `vapour conductivity ${v} W/(m K)`; }
  else if (key === 'st') { const v = at(mid); if (!(v > 0.002 && v < 0.1)) return `surface tension ${v} N/m at ${mid.toFixed(0)} K`; }
  return null;
}

// ---------------------------------------------------------------- one compound
function build(r) {
  let mol;
  try { mol = chem.parseSmiles(r.smiles); } catch (e) { return drop(r, 'SMILES: ' + e.message); }
  const F = chem.formula(mol);
  if (!sameFormula(F, parseFormula(r.formula))) return drop(r, `structure gives ${chem.hillFormula(F)}, data filed under ${r.formula}`);
  const MW = chem.molarMass(mol);
  const organic = !!F.C;
  const jb = organic ? uc.joback(mol) : null;
  const jbOk = !!(jb && jb.ok);
  // normal boiling point: tabulated values (CRC, CAS Common Chemistry, NIST WebBook, Yaws, Wikidata) disagree now and then by
  // several kelvin. A vapour-pressure equation fitted over a range that contains (or nearly contains) the boiling point decides:
  // the candidate closest to its 1-atm temperature is taken if within 3 K (0.6 %) of it, and the equation's own value is then
  // used; without such an equation, the first value that a second source confirms within 1.5 K.
  const cands = (r.Tb_cands || (num(r.Tb) ? [[r.Tb, r.src.Tb]] : [])).filter((x) => num(x[0]) && x[0] > 0);
  if (!cands.length) return drop(r, 'no measured normal boiling point');
  const psList = (r.psat_all || (r.corr.psat ? [[r.corr.psat, r.src.psat]] : [])).filter((x) => Array.isArray(x[0]));
  let ps = null, psSrc = null, Tb = null, TbSrc = null;
  for (const [c, s] of psList) {
    const Tbc = tAtP(c, P0, Math.max(c[6] - 30, 0.3 * cands[0][0]), Math.min(c[7] + 30, 1.6 * cands[0][0]), r.Tc);
    if (!num(Tbc) || Tbc < c[6] - 10 || Tbc > c[7] + 10) continue;
    const best = cands.slice().sort((x, y) => Math.abs(x[0] - Tbc) - Math.abs(y[0] - Tbc))[0];
    if (Math.abs(best[0] - Tbc) > Math.max(3, 0.006 * Tbc)) { rejectProp(r, 'psat', `${s}: 1 atm at ${Tbc.toFixed(1)} K, tabulated boiling points ${cands.map((x) => x[0].toFixed(1)).join(', ')} K`); continue; }
    ps = c; psSrc = s; Tb = Tbc;
    TbSrc = 'normal boiling point of the vapour-pressure equation (' + s + '), agreeing with ' + best[1];
    if (best !== cands[0] || Math.abs(best[0] - Tbc) > 0.05) report.choices.push({ cas: r.cas, name: r.name, field: 'Tb', chosen: [+Tbc.toFixed(2), 'vapour-pressure equation'], first: cands[0] });
    break;
  }
  if (!num(Tb)) {
    const conf = cands.find((x) => cands.some((y) => y !== x && Math.abs(x[0] - y[0]) <= Math.max(1.5, 0.003 * x[0])));
    const pick = conf || cands[0];
    Tb = pick[0]; TbSrc = pick[1] + (conf && conf !== cands[0] ? ' (confirmed by a second source)' : '');
    if (pick !== cands[0]) report.choices.push({ cas: r.cas, name: r.name, field: 'Tb', chosen: pick, first: cands[0] });
  }
  const TcJ = jbOk ? jb.TcOf(Tb) : NaN, PcJ = jbOk && num(jb.Pc) ? jb.Pc * 1e5 : NaN;
  const tc = chooseCrit(r, 'Tc', TcJ / Tb > 1.15 && TcJ / Tb < 2.2 ? TcJ : NaN, 0.03, 0.15);
  if (!tc || tc.bad) return drop(r, tc ? tc.bad : 'no Tc');
  const pc = chooseCrit(r, 'Pc', PcJ > 5e5 && PcJ < 1.5e7 ? PcJ : NaN, 0.10, 0.40);
  if (!pc || pc.bad) return drop(r, pc ? pc.bad : 'no Pc');
  const Tc = tc.v, Pc = pc.v;
  if (!(Tb / Tc > 0.40 && Tb / Tc < 0.95)) return drop(r, `Tb/Tc = ${(Tb / Tc).toFixed(3)}`);
  const src = { Tc: sid(tc.src), Pc: sid(pc.src), Tb: sid(TbSrc) };
  let Vc = null;
  const vc = chooseCrit(r, 'Vc', jbOk && num(jb.Vc) ? jb.Vc / 1e6 : NaN, 0.08, 0.35);
  if (vc && !vc.bad) {
    const Zc = Pc * vc.v / (R * Tc);
    if (Zc > 0.15 && Zc < 0.40) { Vc = vc.v * 1000; src.Vc = sid(vc.src); }          // m3/kmol
  }
  // vapour pressure and ω. An Antoine equation holds only over its own range (often far below the boiling point): it is
  // turned into a DIPPR eq. 101 curve fitted to points of the Antoine equation inside its range together with the boiling
  // point and the critical point, accepted if it stays within 3 % of the Antoine points, 1 % at Tb and 3 % at Tc and
  // rises with temperature throughout. This also rescues an Antoine equation measured only well below the boiling point.
  let w, wsrc;
  const anchored = (c, s) => {
    const lo = c[6], hi = Math.min(c[7], 0.97 * Tc);
    if (!(hi > lo + 5)) return null;
    const pts = [];
    for (let i = 0; i < 9; i++) { const T = lo + (hi - lo) * i / 8; pts.push([T, Math.log(ev(c, T, Tc)), 1]); }
    pts.push([Tb, Math.log(P0), 6], [Tc, Math.log(Pc), 6]);
    const M = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], v = [0, 0, 0, 0];
    for (const [T, y, wt] of pts) { const f = [1, 1 / T, Math.log(T), (T / Tc) ** 6]; for (let i = 0; i < 4; i++) { v[i] += wt * f[i] * y; for (let j = 0; j < 4; j++) M[i][j] += wt * f[i] * f[j]; } }
    const k = solveN(M, v);
    if (!k.every(num)) return null;
    const q = [101, k[0], k[1], k[2], k[3] / Tc ** 6, 6, lo, Tc];
    const dev = (T, y) => Math.abs(Math.log(ev(q, T, Tc)) - y);
    if (pts.slice(0, 9).some(([T, y]) => dev(T, y) > 0.03) || dev(Tb, Math.log(P0)) > 0.01 || dev(Tc, Math.log(Pc)) > 0.03) return null;
    for (let i = 1; i <= 40; i++) { const T1 = lo + (Tc - lo) * (i - 1) / 40, T2 = lo + (Tc - lo) * i / 40; if (!(ev(q, T2, Tc) > ev(q, T1, Tc))) return null; }
    return [q, `DIPPR eq. 101 fitted to the ${s} within its range, the normal boiling point and the critical point`];
  };
  if (ps && ps[0] === 10 && ps[7] < 0.95 * Tc) { const a = anchored(ps, psSrc); if (a) [ps, psSrc] = a; }
  if (!ps) {
    for (const [c, s] of psList) {
      if (c[0] !== 10) continue;
      const a = anchored(c, s);
      if (a) { [ps, psSrc] = a; break; }
      rejectProp(r, 'psat', `${s} (${c[6]}–${c[7]} K): no consistent curve through it, the boiling point and the critical point`);
    }
  }
  if (ps) {
    const e = ev(ps, Tb, Tc) / P0 - 1;
    if (!(Math.abs(e) <= 0.05)) { rejectProp(r, 'psat', `gives ${(100 * e).toFixed(1)} % at the normal boiling point`); ps = null; }
  }
  if (ps && 0.7 * Tc >= ps[6] - 0.05 * Tc && 0.7 * Tc <= ps[7] + 0.02 * Tc) {
    const wd = -Math.log10(ev(ps, 0.7 * Tc, Tc) / Pc) - 1;
    if (num(wd) && Math.abs(lkP(Tb, Tc, Pc, wd) / P0 - 1) < 0.10) { w = wd; wsrc = 'definition (vapour pressure at Tr = 0.7)'; }
  }
  if (/^DIPPR/.test(tc.src) && /^DIPPR/.test(pc.src) && !ps) return drop(r, 'critical constants from DIPPR only and no vapour-pressure equation that passes');
  if (!num(w)) { w = uc.leeKeslerOmega(Tb, Tc, Pc / 1e5); wsrc = 'Lee–Kesler through Tb'; }
  if (!(w > -0.4 && w < 1.6)) return drop(r, `acentric factor ${w.toFixed(3)}`);
  src.omega = sid(wsrc);
  // formation properties (kJ/mol), entropy
  let Hf = num(r.Hf) ? r.Hf : null, S0 = num(r.S0) ? r.S0 : null;
  let sEl = 0; for (const [el, n] of Object.entries(F)) { if (S_EL[el] === undefined) { sEl = NaN; break; } sEl += n * S_EL[el]; }
  const element = Object.keys(F).length === 1;
  if (element && Hf === null && (F.He || F.Ne || F.Ar || F.Kr || F.Xe)) Hf = 0;
  let noForm = false;
  if (Hf !== null) src.Hf = sid(r.src.Hf);
  else if (jbOk && num(jb.Hf)) { Hf = jb.Hf; src.Hf = sid('Joback estimate'); }
  else { Hf = 0; noForm = true; src.Hf = sid('not available — 0 (heat balances without reaction are unaffected; do not use in reactions)'); }
  let Gf;
  if (S0 !== null && num(sEl)) { Gf = Hf - T0 * (S0 - sEl) / 1000; src.S0 = sid(r.src.S0); }
  else if (jbOk && num(jb.Gf) && num(jb.Hf)) { Gf = Hf - (jb.Hf - jb.Gf); src.S0 = sid('Joback estimate (ΔHf − ΔGf)'); }
  else if (num(sEl)) { Gf = Hf; noForm = true; src.S0 = sid('not available — elements’ entropy only (do not use in reactions)'); }
  else return drop(r, 'no entropy');
  // ideal-gas Cp
  let cpig = r.corr.cpig || null;
  const jbCp298 = jbOk && jb.cp.every(num) ? jb.cp[0] + T0 * (jb.cp[1] + T0 * (jb.cp[2] + T0 * jb.cp[3])) : null;
  const zraEst = num(r.zra) ? r.zra : 0.29056 - 0.08775 * w;
  const ctx = { Tc, Pc, Tb, MW, Tm: r.Tm, jbCp298, zraEst };
  if (cpig) { const why = checkCorr(r, 'cpig', cpig, ctx); if (why) { rejectProp(r, 'cpig', why); cpig = null; } }
  if (!cpig && !(jbCp298 > 20)) return drop(r, 'no ideal-gas heat capacity (none measured, Joback cannot fragment the molecule)');
  // record: measured constants into the structure-based record (organics) or a record of its own (inorganics)
  let rec;
  const dipole = num(r.dipole) ? r.dipole : 0;
  if (organic && jbOk) {
    try {
      rec = uc.userRecord({ smiles: r.smiles, name: r.name, Tb_K: Tb, Tc_K: Tc, Pc_bar: Pc / 1e5, Vc_m3kmol: Vc || undefined, omega: w, Hf_kJmol: Hf, Gf_kJmol: Gf, dipole_D: dipole });
    } catch (e) { return drop(r, 'record: ' + e.message); }
    if (!Vc) src.Vc = sid(rec.user.src.Vc === 'Joback' ? 'Joback estimate' : 'Zc = 0.27');
    delete rec.user;
  } else {
    if (!cpig) return drop(r, 'no measured ideal-gas heat capacity');
    if (!Vc) { Vc = 0.29 * R * Tc / Pc * 1000; src.Vc = sid('Zc = 0.29'); }
    // Rackett through the Tyn–Calus molar volume at Tb, as for organic compounds (mb-usercomp.js)
    const Vb = 0.285 * Math.pow(Vc * 1000, 1.048) / 1000;
    let zra = Math.pow(Vb * Pc / (8314.462618 * Tc), 1 / (1 + Math.pow(1 - Tb / Tc, 2 / 7)));
    if (!(zra > 0.15 && zra < 0.35)) zra = zraEst;
    rec = { name: r.name, cas: '', formula: chem.hillFormula(F), smiles: r.smiles, family: 0, mw: MW, tc: Tc, pc: Pc, vc: Vc, zc: Pc * Vc / 1000 / (R * Tc), w, tb: Tb,
      hf: Hf * 1e6, gf: Gf * 1e6, s0: (S0 !== null ? S0 : (Hf - Gf) * 1000 / T0 + sEl) * 1000, dip: dipole * 3.33564e-30, zra, vcost: Vc, wcost: w,
      psat: lk101(Tc, Pc, w), cpig: null,
      hvap: [106, riedelHb(Tb, Tc, Pc) / Math.pow(1 - Tb / Tc, 0.38), 0.38, 0, 0, 0, Math.max(0.3 * Tc, 5), Tc],
      rhol: [105, Pc / (8314.462618 * Tc), zra, Tc, 2 / 7, 0, Math.max(0.3 * Tc, 5), Tc] };
  }
  // UNIFAC / Dortmund groups: the DDBST assignments where they exist (thermo, MIT), else the structure's own fragmentation
  for (const [field, table] of [['unifac', USUB], ['modunifac', DSUB]]) {
    const g = r.ddbst && r.ddbst[field];
    if (g && Object.keys(g).every((id) => table[id])) {
      const same = rec[field] && JSON.stringify(Object.entries(rec[field]).map(([a, b]) => [String(a), b]).sort()) === JSON.stringify(Object.entries(g).sort());
      groupStats[field][same ? 'same' : rec[field] ? 'differ' : 'added']++;
      if (!same && rec[field]) report.groups.push({ cas: r.cas, name: r.name, field, structure: rec[field], ddbst: g });
      rec[field] = Object.fromEntries(Object.entries(g).map(([a, b]) => [a, b]));
      src[field] = sid('DDBST group assignment (via thermo, MIT)');
    } else if (rec[field]) { src[field] = sid('fragmentation of the structure (SMARTS patterns of thermo.unifac)'); groupStats[field].own++; }
  }
  if (rec.unifac) { rec.uqr = 0; rec.uqq = 0; for (const [id, n] of Object.entries(rec.unifac)) { rec.uqr += n * USUB[id][1]; rec.uqq += n * USUB[id][2]; } }
  rec.ext = true;
  if (noForm) rec.noform = true;
  rec.name = prettyName(r.name);
  if (F.N) rec.name = rec.name.replace(/^n(,n)?-/, (x) => x.toUpperCase());
  rec.cas = r.cas;
  rec.mw = +MW.toPrecision(8);
  rec.cat = category(F);
  if (num(r.Tm)) { rec.tm = r.Tm; src.Tm = sid('CRC Handbook / chemicals (MIT) melting point'); } else delete rec.tm;
  if (num(r.zra)) { rec.zra = r.zra; rec.rhol = [105, Pc / (8314.462618 * Tc), r.zra, Tc, 2 / 7, 0, Math.max(0.3 * Tc, 5), Tc]; }
  // a measured density at 20 °C anchors the Rackett curve (Z_RA through the point) where no density equation exists
  let rhoAnchor = null;
  if (r.rho_point && !(r.corr.rhol) && (!num(r.Tm) || r.Tm < r.rho_point[1] - 1) && Tb > r.rho_point[1] + 1) {
    const [rk, Tr] = r.rho_point, Ac = Pc / (8314.462618 * Tc);
    const zra = Math.pow(Ac / (rk / MW), 1 / (1 + Math.pow(1 - Tr / Tc, 2 / 7)));
    if (zra > 0.18 && zra < 0.36) {
      rec.zra = zra; rec.rhol = [105, Ac, zra, Tc, 2 / 7, 0, Math.max(0.3 * Tc, 5), Tc]; rhoAnchor = r.rho_point[2];
    } else rejectProp(r, 'rho_point', `density ${rk} kg/m³ at ${Tr} K gives Z_RA ${zra.toFixed(3)} — outside 0.18–0.36`);
  }
  if (num(r.vcost)) { rec.vcost = r.vcost; rec.wcost = r.wcost; }
  // measured correlations replace the estimates, each after its check
  const estimate = { psat: 'Lee–Kesler', cpig: 'Joback estimate', hvap: 'Riedel at Tb, Watson exponent 0.38',
    rhol: rhoAnchor ? 'Rackett through the ' + rhoAnchor : num(r.zra) ? 'Rackett (Z_RA of Yamada–Gunn / COSTALD tables)' : 'Rackett estimate (Z_RA through the Tyn–Calus volume at Tb)',
    mul: rec.mul ? 'Joback / corresponding-states estimate' : null, cpl: null, muv: null, kl: null, kv: null, st: null };
  if (ps) { rec.psat = ps; src.psat = sid(psSrc); } else src.psat = sid(estimate.psat);
  if (cpig) { rec.cpig = cpig; src.cpig = sid(r.src.cpig); } else src.cpig = sid(estimate.cpig);
  ctx.cpig = rec.cpig;
  for (const key of ['hvap', 'rhol', 'cpl', 'mul', 'muv', 'kl', 'kv', 'st']) {
    const c = r.corr[key];
    if (c) {
      const why = checkCorr(r, key, c, ctx);
      if (!why) { rec[key] = c; src[key] = sid(r.src[key]); continue; }
      rejectProp(r, key, why);
    }
    if (estimate[key]) src[key] = sid(estimate[key]); else delete rec[key];
  }
  if (num(r.dipole)) src.dipole = sid('dipole moment: CCCBDB / Poling et al., via chemicals (MIT)');
  rec.src = src;
  // final consistency: the vapour pressure used meets the boiling point
  const pb = ev(rec.psat, Tb, Tc) / P0 - 1;
  if (!(Math.abs(pb) < 0.06)) return drop(r, `final vapour pressure ${(100 * pb).toFixed(1)} % off at Tb`);
  // rounding (8 significant figures) keeps the module small without changing a value that matters
  const rd = (v) => (num(v) ? +v.toPrecision(8) : v);
  for (const [k, v] of Object.entries(rec)) {
    if (Array.isArray(v)) rec[k] = v.map(rd);
    else if (num(v)) rec[k] = rd(v);
  }
  return rec;
}

// ---------------------------------------------------------------- run
const out = {};
const built = [];
for (const r of input.records) {
  if (baseCas.has(r.cas)) { drop(r, 'already in the ChemSep databank'); continue; }
  const rec = build(r);
  if (rec) built.push([r, rec]);
}
// one record per name: stereo-isomer entries (SMILES with @) and second CAS numbers of a ChemSep component are left out
const baseNames = new Set(base.map((k) => String(compdb.get(k).name).toLowerCase()));
const measured = (rec) => Object.values(rec.src).filter((i) => !/estimate|Lee–Kesler|Riedel|Rackett|not available/.test(SOURCES[i])).length;
const byName = new Map();
for (const [r, rec] of built) {
  const n = rec.name.toLowerCase();
  if (baseNames.has(n)) { drop(r, 'same name as a ChemSep component (another CAS number of it)'); continue; }
  const prev = byName.get(n);
  const better = !prev || (/@/.test(prev[1].smiles) && !/@/.test(rec.smiles)) || (/@/.test(prev[1].smiles) === /@/.test(rec.smiles) && measured(rec) > measured(prev[1]));
  if (prev) drop(better ? prev[0] : r, 'duplicate name (stereo-isomer or second CAS number)');
  if (better) byName.set(n, [r, rec]);
}
for (const [r, rec] of byName.values()) {
  const key = slug(rec.name, r.cas);
  // field order as in mb-compdb.js
  const order = ['name', 'cas', 'formula', 'smiles', 'family', 'mw', 'tc', 'pc', 'vc', 'zc', 'w', 'tb', 'tm', 'hf', 'gf', 's0', 'dip', 'zra', 'vcost', 'wcost', 'uqr', 'uqq',
    'psat', 'cpig', 'hvap', 'rhol', 'cpl', 'mul', 'muv', 'kl', 'kv', 'st', 'cat', 'unifac', 'modunifac', 'src', 'ext', 'noform'];
  const o = {};
  for (const k of order) if (rec[k] !== undefined && rec[k] !== null) o[k] = rec[k];
  out[key] = o;
}

const n = Object.keys(out).length;
const cnt = (f) => Object.values(out).filter(f).length;
const measuredPs = cnt((c) => !/Lee–Kesler/.test(SOURCES[c.src.psat])), measuredCp = cnt((c) => !/Joback/.test(SOURCES[c.src.cpig]));
const header = `// ============================================================================
// REPO PATH: api/_lib/mb-compdb-ext.js
// ============================================================================
// multicalci.com — GENERATED by scripts/gather-compdb-ext.py and
// scripts/build-compdb-ext.mjs (round 12). Do not edit by hand.
// Extended pure-component databank: ${n} compounds not in the ChemSep databank,
// each with measured or evaluated critical constants and normal boiling point;
// ${measuredPs} carry a measured vapour-pressure equation and ${measuredCp} a measured
// ideal-gas heat capacity. Properties without measured data are estimated
// (Joback; Lee–Kesler vapour pressure through the measured Tb, Tc, Pc;
// Riedel–Watson; Rackett) exactly as for a component given by its structure.
// Every record lists the source of each value in "src" (indices into SOURCES).
// Data compiled by Caleb Bell and contributors in the chemicals library
// (${input.chemicals_version}, MIT licence, https://github.com/CalebBell/chemicals), from:
// IUPAC critical-property series (Ambrose, Tsonopoulos, Young et al., J. Chem.
// Eng. Data 1995–2015); Matthews, Chem. Rev. 72 (1972) 71; CRC Handbook of
// Chemistry and Physics; Horstmann et al., Fluid Phase Equilib. 227 (2005) 157
// (PSRK); McGarry, Ind. Eng. Chem. Process Des. Dev. 22 (1983) 313 and Poling,
// Prausnitz & O'Connell, The Properties of Gases and Liquids, 5th ed. (Wagner
// and Antoine equations); Perry's Chemical Engineers' Handbook, 8th ed. (DIPPR
// equations); VDI Heat Atlas, 2nd ed. (PPDS equations); Kabo & Roganov, TRC
// Thermodynamics of Organic Compounds in the Gas State (1994); NIST-JANAF
// Thermochemical Tables (1998); NIST Chemistry WebBook; Active Thermochemical
// Tables and API Technical Data Book (formation enthalpies); Jasper, J. Phys.
// Chem. Ref. Data 1 (1972) 841 (surface tension). Correlations are converted to
// ChemSep equation forms and checked against the source function.
// Units and correlation layout as in mb-compdb.js; a ninth correlation element
// is the Tc the equation was fitted with (see corr() in mb-thermo.js).
// Server-side only (api/_lib) — never shipped to the browser.
// ============================================================================
`;
const body = 'export const EXT_SOURCES = ' + JSON.stringify(SOURCES) + ';\n\nexport const EXT_COMPS = {\n' +
  Object.entries(out).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',\n') + '\n};\n\n' +
  `export const EXT_VERSION = 'extended databank r12 (${n} compounds; chemicals ${input.chemicals_version})';\n` +
  'export default { EXT_COMPS, EXT_SOURCES, EXT_VERSION };\n';
fs.writeFileSync(OUT, header + body);
fs.writeFileSync(path.join(path.dirname(IN), 'build-compdb-ext-report.json'), JSON.stringify(report, null, 1));
const why = {};
for (const d of report.dropped) { const k = d.why.replace(/[\d.]+/g, '#').slice(0, 60); why[k] = (why[k] || 0) + 1; }
console.log(`${n} compounds written (${measuredPs} measured vapour pressure, ${measuredCp} measured ideal-gas Cp); ${report.dropped.length} dropped; ${report.props_rejected.length} correlations rejected; ${report.choices.length} choices between sources (Tc, Pc, Vc by agreement with the estimate; Tb from the vapour-pressure equation)`);
console.log(why);
console.log('groups', JSON.stringify(groupStats));
report.groupStats = groupStats;
fs.writeFileSync(path.join(path.dirname(IN), 'build-compdb-ext-report.json'), JSON.stringify(report, null, 1));
