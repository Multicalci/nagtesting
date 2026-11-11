// Round 12c — Lee–Kesler–Plöcker binary parameters k_ij (multiplier on the pair critical temperature).
//
// Each pair of the GERG-2008 components that has fitted GERG-2008 mixture parameters (water and helium
// left out) gets the k_ij that makes the Lee–Kesler–Plöcker bubble pressures agree with GERG-2008
// (ISO 20765-2; its mixture parameters are fitted to measured VLE and density data) at three
// temperatures and three compositions (bubble pressures up to 100 bar). The search minimises the mean
// |ln Σ x_i K_i| at the GERG-2008 bubble points (vapour held at the GERG-2008 composition) — a coarse
// scan, then golden section; the report gives the resulting bubble-pressure deviations.
// Then two correlations of our own are fitted to the table:
//   hydrocarbon pairs   k = 1 + a·lnτ·lnν + b·lnτ + c·(lnτ)²,  τ = Tc2/Tc1, ν = Vc2/Vc1 (2 heavier)
//   light gas + hydrocarbon   k = a + b·X,  X = ln(Tc,HC / Tc,gas)
// for pairs with no fitted value; a hydrocarbon pair more than 3 rms off the first fit takes the
// correlation. Writes api/_lib/mb-lkp-kij.js and a report.
//
//   node scripts/fit-lkp-kij.mjs [report.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import th from '../api/_lib/mb-thermo.js';
import gerg from '../api/_lib/mb-gerg.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const reportPath = process.argv[2] || path.join(root, 'lkp-kij-report.json');

const KEYS = gerg.GERG_KEYS.filter((k) => k !== 'H2O' && k !== 'He');
// GERG-2008 pairs with no fitted mixture parameters (β and γ all 1) — nothing to fit to
const src = fs.readFileSync(path.join(root, 'api/_lib/mb-gerg.js'), 'utf8');
const unfitted = new Set();
for (const m of src.matchAll(/bvij\[(\d+)\]\[(\d+)\] = ([\d.]+);\s*gvij\[\d+\]\[\d+\] = ([\d.]+);\s*btij\[\d+\]\[\d+\] = ([\d.]+);\s*gtij\[\d+\]\[\d+\] = ([\d.]+);/g)) {
  const [, i, j, a, b, c, d] = m;
  if (+a === 1 && +b === 1 && +c === 1 && +d === 1) unfitted.add([gerg.GERG_KEYS[i - 1], gerg.GERG_KEYS[j - 1]].sort().join('|'));
}
const HC = ['CH4', 'C2H6', 'C3H8', 'isobutane', 'nC4H10', 'isopentane', 'n-pentane', 'nC6H14', 'nC7H16', 'nC8H18', 'n-nonane', 'n-decane'];
const GASES = ['N2', 'CO2', 'H2S', 'CO', 'H2', 'Ar', 'O2', 'CH4', 'C2H6', 'C3H8'];   // light partners with a line of their own

const comp = Object.fromEntries(KEYS.map((k) => [k, th.component(k)]));
const vcLK = (c) => (0.2905 - 0.085 * c.omega) * 8.314462618 * c.Tc / c.Pc;

function points(k1, k2) {
  const c1 = comp[k1], c2 = comp[k2];
  const tlow = Math.max(Number(c2.ttp) || 0, Number(c2.tm) || 0, Number(c1.ttp) || 0, Number(c1.tm) || 0) + 3;
  const Ts = [0.55, 0.7, 0.85].map((f) => Math.min(Math.max(f * c2.Tc, tlow), 600));
  const gp = th.createPackage({ model: 'gerg2008' }, [k1, k2]);
  const out = [];
  for (const T of [...new Set(Ts.map((t) => Math.round(t * 100) / 100))]) {
    // a light gas above its critical temperature dissolves sparingly: smaller amounts keep the bubble point below 100 bar
    const xs = T > c1.Tc ? [0.02, 0.06, 0.12] : [0.05, 0.15, 0.35];
    for (const x1 of xs) {
      try {
        const r = th.flashTVF(gp, [x1, 1 - x1], T, 0);
        const y1 = r.y ? r.y[0] : NaN;
        if (!(r.P > 0) || r.P > 100e5 || !(Math.abs(y1 - x1) > 0.03)) continue;     // away from the critical region
        out.push({ T, x1, P: r.P, y1 });
      } catch (_e) { /* no GERG bubble point here */ }
    }
  }
  return out;
}

/** fast deviation for the search: at each GERG-2008 bubble point (T, P, x, y) the LKP sum Σ x_i φL_i(x)/φV_i(y) —
 *  its logarithm is close to the relative error of the LKP bubble pressure. The vapour is held at the GERG-2008
 *  composition, so the search cannot fall onto the trivial solution (vapour = liquid). */
function lkpSumK(k1, k2, pts, kij) {
  const pair = [k1, k2].sort().join('|');
  const pp = th.createPackage({ model: 'lkp', lkp_kij: { [pair]: kij } }, [k1, k2]);
  let s = 0;
  for (const p of pts) {
    try {
      const x = [p.x1, 1 - p.x1], y = [p.y1, 1 - p.y1];
      const L = pp.eos.state(p.T, p.P, x, 'L'), V = pp.eos.state(p.T, p.P, y, 'V');
      if (!(V.Z > L.Z * 1.02)) { s += 1; continue; }                 // no distinct liquid and vapour
      const sk = x[0] * Math.exp(L.lnphi[0] - V.lnphi[0]) + x[1] * Math.exp(L.lnphi[1] - V.lnphi[1]);
      const d = Math.log(sk);
      s += Number.isFinite(d) ? Math.min(Math.abs(d), 1) : 1;
    } catch (_e) { s += 1; }
  }
  return s / pts.length;
}
function lkpDev(k1, k2, pts, kij) {
  const pair = [k1, k2].sort().join('|');
  const pp = th.createPackage({ model: 'lkp', lkp_kij: { [pair]: kij } }, [k1, k2]);
  let s = 0, nf = 0;
  for (const p of pts) {
    try {
      const r = th.flashTVF(pp, [p.x1, 1 - p.x1], p.T, 0, p.P);
      const d = Math.log(r.P / p.P);
      s += Number.isFinite(d) ? Math.abs(d) : 1;            // mean absolute deviation: a stray reference point does not pull the fit
      if (!Number.isFinite(d)) nf++;
    } catch (_e) { s += 1; nf++; }
  }
  return { obj: s / pts.length, nf };
}

function golden(f, a, b, n) {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a), x2 = a + g * (b - a), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < n; i++) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = f(x1); }
    else { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = f(x2); }
  }
  return (a + b) / 2;
}

const table = {}, rep = { pairs: [], skipped: [] };
const t0 = Date.now();
for (let i = 0; i < KEYS.length; i++) {
  for (let j = i + 1; j < KEYS.length; j++) {
    let [k1, k2] = [KEYS[i], KEYS[j]];
    if (comp[k1].Tc > comp[k2].Tc) [k1, k2] = [k2, k1];
    const pair = [k1, k2].sort().join('|');
    if (unfitted.has(pair)) { rep.skipped.push({ pair, why: 'no fitted GERG-2008 parameters' }); continue; }
    const pts = points(k1, k2);
    if (pts.length < 3) { rep.skipped.push({ pair, why: `only ${pts.length} GERG-2008 bubble points` }); continue; }
    const f = (k) => lkpSumK(k1, k2, pts, k);
    const hi = k1 === 'H2' || k2 === 'H2' ? 3.6 : 1.9;
    // coarse scan first (the deviation is not unimodal far from the optimum), then golden section around the best
    let kb = 1, fb = Infinity;
    for (let kk = 0.7; kk <= hi + 1e-9; kk += 0.05) { const v = f(kk); if (v < fb) { fb = v; kb = kk; } }
    const k = golden(f, Math.max(0.7, kb - 0.05), Math.min(hi, kb + 0.05), 14);
    const at = lkpDev(k1, k2, pts, k), at1 = lkpDev(k1, k2, pts, 1);
    if (at.nf > pts.length / 3) { rep.skipped.push({ pair, why: `LKP bubble point fails at ${at.nf} of ${pts.length} points` }); continue; }
    if (k < 0.71 || k > hi - 0.01) { rep.skipped.push({ pair, why: `k_ij at the search bound (${k.toFixed(3)})` }); continue; }
    table[pair] = Math.round(k * 1e4) / 1e4;
    rep.pairs.push({ pair, light: k1, heavy: k2, kij: table[pair], n: pts.length, aad_lnP: at.obj, aad_lnP_k1: at1.obj, T: [...new Set(pts.map((p) => p.T))] });
    process.stderr.write(`${pair.padEnd(24)} k=${k.toFixed(4)} AAD ${(100 * at.obj).toFixed(2)} % (k=1: ${(100 * at1.obj).toFixed(1)} %) n=${pts.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  }
}

// ---- correlations (linear least squares)
function lsq(rows, ys) {
  const m = rows[0].length, A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  rows.forEach((r, k) => { for (let i = 0; i < m; i++) { b[i] += r[i] * ys[k]; for (let j = 0; j < m; j++) A[i][j] += r[i] * r[j]; } });
  for (let i = 0; i < m; i++) { let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < m; r++) { if (r === i) continue; const f = A[r][i] / A[i][i]; for (let c = i; c < m; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; } }
  return b.map((v, i) => v / A[i][i]);
}
const hcRows = [], hcY = [], hcPairs = [];
for (const p of rep.pairs) {
  if (!HC.includes(p.light) || !HC.includes(p.heavy) || p.light === 'CH4') continue;     // methane has its own line
  const c1 = comp[p.light], c2 = comp[p.heavy], lt = Math.log(c2.Tc / c1.Tc), lv = Math.log(vcLK(c2) / vcLK(c1));
  if (lt < 0.05) continue;
  hcRows.push([lt * lv, lt, lt * lt]); hcY.push(p.kij - 1); hcPairs.push(p.pair);
}
let [ha, hb, hc] = lsq(hcRows, hcY);
let hcRes = hcRows.map((r, k) => 1 + ha * r[0] + hb * r[1] + hc * r[2] - (hcY[k] + 1));
// a hydrocarbon pair far off the homologous trend (GERG-2008 has sparse data for some of them, e.g. ethane–n-nonane)
// takes the correlation instead; the correlation is refitted without it
const rms0 = Math.sqrt(hcRes.reduce((s, v) => s + v * v, 0) / hcRes.length);
const off = hcRes.map((v, k) => (Math.abs(v) > 3 * rms0 ? k : -1)).filter((k) => k >= 0);
if (off.length) {
  const keep = hcRows.map((_, k) => !off.includes(k));
  [ha, hb, hc] = lsq(hcRows.filter((_, k) => keep[k]), hcY.filter((_, k) => keep[k]));
  rep.replaced = [];
  for (const k of off) {
    const r = hcRows[k], v = 1 + ha * r[0] + hb * r[1] + hc * r[2];
    rep.replaced.push({ pair: hcPairs[k], fitted: table[hcPairs[k]], correlation: +v.toFixed(4) });
    table[hcPairs[k]] = Math.round(v * 1e4) / 1e4;
  }
  const idx = hcRows.map((_, k) => k).filter((k) => keep[k]);
  hcRes = idx.map((k) => 1 + ha * hcRows[k][0] + hb * hcRows[k][1] + hc * hcRows[k][2] - (hcY[k] + 1));
}
const gas = {};
for (const g of GASES) {
  const rows = [], ys = [], xs = [];
  for (const p of rep.pairs) {
    const other = p.light === g ? p.heavy : p.heavy === g ? null : null;
    if (!other || !HC.includes(other) || other === g) continue;
    const X = Math.log(comp[other].Tc / comp[g].Tc);
    if (X < Math.log(1.4)) continue;                       // the heavier partners set the slope that is extrapolated
    rows.push([1, X]); ys.push(p.kij); xs.push(X);
  }
  if (rows.length < 4) continue;
  const [a, b] = lsq(rows, ys);
  const res = rows.map((r, k) => a + b * r[1] - ys[k]);
  gas[g] = { a: +a.toFixed(5), b: +b.toFixed(5), c: 0, xmin: +Math.min(...xs).toFixed(3), xmax: +Math.max(...xs).toFixed(3), n: rows.length, rms: +Math.sqrt(res.reduce((s, v) => s + v * v, 0) / res.length).toFixed(4) };
}
const corr = {
  hc2: { a: +ha.toFixed(5), b: +hb.toFixed(5), c: +hc.toFixed(5), n: hcRes.length, rms: +Math.sqrt(hcRes.reduce((s, v) => s + v * v, 0) / hcRes.length).toFixed(4) },
  gas,
  hc: HC,
};
rep.corr = corr; rep.unfitted = [...unfitted];

const lines = Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `  '${k}': ${v},`);
fs.writeFileSync(path.join(root, 'api/_lib/mb-lkp-kij.js'), `// Lee–Kesler–Plöcker binary parameters k_ij (T_c,ij = k_ij·√(T_c,i·T_c,j)), generated by
// scripts/fit-lkp-kij.mjs — do not edit by hand.
// LKP_KIJ: fitted so that Lee–Kesler–Plöcker bubble pressures agree with GERG-2008 (ISO 20765-2, whose
// mixture parameters are fitted to measured VLE and density data) at three temperatures and three
// compositions per pair; hydrogen with the Gunn–Chueh–Prausnitz quantum-corrected constants.
// LKP_CORR: our own correlations fitted to that table, for pairs with no fitted value —
//   hc2: hydrocarbon pairs, k = 1 + a·lnτ·lnν + b·lnτ + c·(lnτ)², τ = Tc2/Tc1, ν = Vc2/Vc1 (2 the heavier)
//   gas: light gas + heavier hydrocarbon, k = a + b·X, X = ln(Tc,HC/Tc,gas), X held below xmax + 0.5
export const LKP_KIJ = {
${lines.join('\n')}
};
export const LKP_CORR = ${JSON.stringify(corr, null, 2)};
export default { LKP_KIJ, LKP_CORR };
`);
fs.writeFileSync(reportPath, JSON.stringify(rep, null, 1));
process.stderr.write(`\n${Object.keys(table).length} pairs fitted, ${rep.skipped.length} skipped; hc2 rms ${corr.hc2.rms}; ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
