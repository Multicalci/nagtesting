// Round 12c — PRSV2 pure-component parameters κ1, κ2, κ3 (Stryjek & Vera, Can. J. Chem. Eng. 64 (1986) 820)
//   α = [1 + κ(1 − √Tr)]²,  κ = κ0(ω) + [κ1 + κ2(κ3 − Tr)(1 − √Tr)](1 + √Tr)(0.7 − Tr)   (Tr < 0.7)
// For every databank component with a vapour-pressure correlation, the α that makes Peng–Robinson
// reproduce that vapour pressure exactly is found at 40 temperatures between the triple point (or
// Tr = 0.35, or the correlation's lower limit) and Tr = 0.7, and κ1, κ2·κ3, −κ2 come from linear least
// squares on κ − κ0. Components whose correlation does not cover Tr 0.55–0.7 get none.
// Writes api/_lib/mb-prsv2.js and a report.
//   node scripts/build-prsv2.mjs [report.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import th from '../api/_lib/mb-thermo.js';
import compdb from '../api/_lib/mb-compdb.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const reportPath = process.argv[2] || path.join(root, 'prsv2-report.json');
const R = 8.314462618;
const OA = 0.45723553, OB = 0.07779607;

function cubic(a, b, c) {                      // real roots of x³ + a x² + b x + c
  const Q = (a * a - 3 * b) / 9, Rr = (2 * a * a * a - 9 * a * b + 27 * c) / 54, Q3 = Q * Q * Q;
  if (Rr * Rr < Q3) {
    const t = Math.acos(Math.max(-1, Math.min(1, Rr / Math.sqrt(Q3)))), s = -2 * Math.sqrt(Q);
    return [s * Math.cos(t / 3) - a / 3, s * Math.cos((t + 2 * Math.PI) / 3) - a / 3, s * Math.cos((t - 2 * Math.PI) / 3) - a / 3].sort((x, y) => x - y);
  }
  const A = -Math.sign(Rr) * Math.cbrt(Math.abs(Rr) + Math.sqrt(Rr * Rr - Q3)), B = A ? Q / A : 0;
  return [A + B - a / 3];
}
const s2 = Math.SQRT2;
function lnphi(Z, A, B) { return Z - 1 - Math.log(Z - B) - A / (2 * s2 * B) * Math.log((Z + (1 + s2) * B) / (Z + (1 - s2) * B)); }
/** g(α) = ln φL − ln φV at (T, P); NaN where the cubic has one real root */
function gap(alpha, c, T, P) {
  const A = OA * alpha * P / (R * R * T * T) * (R * c.Tc) ** 2 / c.Pc, B = OB * P / (R * T) * R * c.Tc / c.Pc;
  const r = cubic(-(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B * B * B)).filter((z) => z > B);
  if (r.length < 2) return { g: NaN, one: r[0], A, B };
  return { g: lnphi(r[0], A, B) - lnphi(r[r.length - 1], A, B) };
}
/** α that makes PR give the saturation pressure P at T */
function alphaExact(c, T, P) {
  // scan for a 3-root interval, then bisect on g (g decreases as α grows)
  let lo = NaN, hi = NaN, prev = null;
  for (let k = 0; k <= 400; k++) {
    const a = 0.2 * Math.pow(1.02, k);
    const g = gap(a, c, T, P).g;
    if (Number.isFinite(g)) {
      if (g > 0) lo = a;
      else if (g <= 0 && Number.isFinite(lo)) { hi = a; break; }
    }
    prev = g;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return NaN;
  for (let it = 0; it < 80; it++) {
    const m = 0.5 * (lo + hi), g = gap(m, c, T, P).g;
    if (!Number.isFinite(g)) { // single root: liquid-like (large α) or vapour-like (small α)
      const one = gap(m, c, T, P).one, B = OB * P / (R * T) * R * c.Tc / c.Pc;
      if (one < 3 * B) hi = m; else lo = m;
    } else if (g > 0) lo = m; else hi = m;
    if (hi - lo < 1e-12 * m) break;
  }
  return 0.5 * (lo + hi);
}
function lsq(rows, ys) {
  const m = rows[0].length, A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  rows.forEach((r, k) => { for (let i = 0; i < m; i++) { b[i] += r[i] * ys[k]; for (let j = 0; j < m; j++) A[i][j] += r[i] * r[j]; } });
  for (let i = 0; i < m; i++) {
    let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-300) return null;
    for (let r = 0; r < m; r++) { if (r === i) continue; const f = A[r][i] / A[i][i]; for (let q = i; q < m; q++) A[r][q] -= f * A[i][q]; b[r] -= f * b[i]; }
  }
  return b.map((v, i) => v / A[i][i]);
}
const k0 = (w) => 0.378893 + 1.4897153 * w - 0.17131848 * w * w + 0.0196554 * w * w * w;
const kap = (p, tr, w) => { const sr = Math.sqrt(tr); return k0(w) + (p[0] + p[1] * (p[2] - tr) * (1 - sr)) * (1 + sr) * (0.7 - tr); };

const out = {}, rep = { fitted: [], skipped: [] };
for (const key of compdb.keys()) {
  let c;
  try { c = th.component(key); } catch (_e) { continue; }
  const eq = c.psat || c.psat_ant;
  if (!eq || c.pseudo || !(c.Tc > 0) || !(c.Pc > 0) || !Number.isFinite(c.omega)) { rep.skipped.push({ key, why: 'no vapour-pressure correlation' }); continue; }
  let tmin = Math.max(Number(eq[6]) || 0, Number(c.ttp) || 0, Number(c.tm) || 0, 0.35 * c.Tc);
  if (th.psat(c, tmin) < 10 && th.psat(c, 0.7 * c.Tc) > 10) {        // below 10 Pa the correlation is extrapolated or not measured
    let a = tmin, b = 0.7 * c.Tc;
    for (let it = 0; it < 60; it++) { const m = 0.5 * (a + b); if (th.psat(c, m) < 10) a = m; else b = m; }
    tmin = b;
  }
  const tmax = Math.min(Number(eq[7]) || Infinity, 0.7 * c.Tc);
  if (!(tmax >= 0.7 * c.Tc * 0.999) || !(tmin <= 0.55 * c.Tc)) { rep.skipped.push({ key, why: `correlation range ${(tmin / c.Tc).toFixed(2)}–${(tmax / c.Tc).toFixed(2)} Tc` }); continue; }
  const rows = [], ys = [], pts = [];
  for (let k = 0; k < 40; k++) {
    const T = tmin + (tmax - tmin) * k / 39, tr = T / c.Tc, P = th.psat(c, T);
    if (!(P > 0)) continue;
    const a = alphaExact(c, T, P);
    if (!Number.isFinite(a)) continue;
    const sr = Math.sqrt(tr), kx = (Math.sqrt(a) - 1) / (1 - sr), u = (1 + sr) * (0.7 - tr), w = 1 - sr;
    pts.push({ T, tr, P, kx });
    if (u < 1e-9) continue;
    rows.push([u, u * w, u * tr * w]); ys.push(kx - k0(c.omega));
  }
  if (rows.length < 10) { rep.skipped.push({ key, why: `only ${rows.length} points` }); continue; }
  let sol = lsq(rows, ys), p;
  if (sol && Math.abs(sol[2]) > 1e-6) p = [sol[0], -sol[2], sol[1] / -sol[2]];
  else { const s1 = lsq(rows.map((r) => [r[0]]), ys); p = [s1[0], 0, 0]; }
  const maxErr = (q0) => Math.max(...pts.map((q) => Math.abs((1 + kap(q0, q.tr, c.omega) * (1 - Math.sqrt(q.tr))) ** 2 / (1 + q.kx * (1 - Math.sqrt(q.tr))) ** 2 - 1)));
  const one = () => { const s1 = lsq(rows.map((r) => [r[0]]), ys); return [s1[0], 0, 0]; };
  // a fit is usable when the κ1–κ3 term stays moderate down to Tr = 0.25 (it is extrapolated there)
  const tame = (q0) => q0.every(Number.isFinite) && [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65].every((tr) => Math.abs(kap(q0, tr, c.omega) - k0(c.omega)) < 1.5);
  const p1 = one();
  if (!tame(p) || (tame(p1) && maxErr(p1) <= maxErr(p))) p = p1;
  if (!(maxErr(p) < 0.05) || !tame(p)) { rep.skipped.push({ key, why: `no consistent fit (max |Δα/α| ${maxErr(p).toFixed(3)})` }); continue; }
  // check: vapour pressure from PRSV2 with these parameters vs the correlation, and PR
  let e2 = 0, e0 = 0, ep = 0;
  for (const q of pts) {
    const aP = (1 + kap(p, q.tr, c.omega) * (1 - Math.sqrt(q.tr))) ** 2, a0 = (1 + k0(c.omega) * (1 - Math.sqrt(q.tr))) ** 2;
    const mPR = 0.37464 + 1.54226 * c.omega - 0.26992 * c.omega ** 2, aPR = (1 + mPR * (1 - Math.sqrt(q.tr))) ** 2;
    const ax = (1 + q.kx * (1 - Math.sqrt(q.tr))) ** 2;
    // d ln Psat / d α ≈ evaluated through the exact α: use relative α error as a proxy for ln P error
    // (ln P changes by about (A/B)/(Z_V − Z_L)… so compare α directly, reported as max |Δα/α|)
    e2 = Math.max(e2, Math.abs(aP / ax - 1)); e0 = Math.max(e0, Math.abs(a0 / ax - 1)); ep = Math.max(ep, Math.abs(aPR / ax - 1));
  }
  out[key] = p.map((v) => +v.toPrecision(6));
  rep.fitted.push({ key, n: rows.length, tr: [+(tmin / c.Tc).toFixed(3), 0.7], k: out[key], max_dalpha_prsv2: +e2.toExponential(2), max_dalpha_prsv_k0: +e0.toExponential(2), max_dalpha_pr: +ep.toExponential(2) });
}
const lines = Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: [${v.join(', ')}],`);
fs.writeFileSync(path.join(root, 'api/_lib/mb-prsv2.js'), `// PRSV2 κ1, κ2, κ3 (Stryjek & Vera 1986 form), generated by scripts/build-prsv2.mjs — do not edit by hand.
// Fitted to the databank vapour-pressure correlation of each component between the triple point (or
// Tr = 0.35) and Tr = 0.7: the α that makes Peng–Robinson reproduce the vapour pressure, by linear least
// squares on κ − κ0(ω). Above Tr = 0.7 the κ1–κ3 term is zero (Stryjek–Vera).
export const PRSV2 = {
${lines.join('\n')}
};
export default { PRSV2 };
`);
fs.writeFileSync(reportPath, JSON.stringify(rep, null, 1));
process.stderr.write(`${rep.fitted.length} components fitted, ${rep.skipped.length} skipped\n`);
