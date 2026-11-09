// ============================================================================
// REPO PATH: api/_lib/mb-ternary.js
// ============================================================================
// multicalci.com — STEP 40 ternary and azeotrope analyses on the property-package
// core (Aspen Properties "Ternary Diag", "Residue Curves", "Azeotrope Search"):
//
//   ternary-diagram   residue-curve map of three components at fixed pressure:
//                     pure boiling points, binary and ternary azeotropes
//                     (homogeneous and heterogeneous) with their stability
//                     (stable node, unstable node, saddle), residue curves
//                     dx/dξ = x − y integrated forward (towards higher boiling
//                     points) and backward, distillation boundaries traced from
//                     the saddles along their separatrices, and the liquid–liquid
//                     envelope with tie lines at a chosen temperature.
//   azeotrope-search  every homogeneous and heterogeneous azeotrope of 2–8
//                     components at fixed pressure (binary, ternary and
//                     quaternary sub-systems), classified in the sub-system and
//                     in the whole mixture.
//
// Heterogeneous liquids: where the liquid splits at its boiling point, the
// bubble point is that of the two liquids together (LLE at T, then the bubble
// point of either liquid, iterated on T) and the vapour is the one in
// equilibrium with both — so residue curves cross the two-liquid region and
// heteroazeotropes come out of the same equations as homogeneous ones.
//
// Input: {streams:[stream], params:{property_package, keys, P_bar, …}}.
// Plain ES module. Server-side only. (c) multicalci.com
// ============================================================================

import th from './mb-thermo.js';
import units from './mb-units.js';

export const TERNARY_VERSION = 'mb-ternary 1.0.0';
const num = (x) => typeof x === 'number' && isFinite(x);
const fail = (code, msg, field) => { throw new units.UnitError(code, msg, field); };
const r6 = (x) => (num(x) ? Number(x.toPrecision(7)) : null);
const LL_MODELS = new Set(['nrtl', 'uniquac', 'unifac', 'modunifac']);

/**
 * Bubble point of a liquid at pressure P that splits into two liquids where it must.
 * A survey of the composition space first decides whether any liquid splits at its boiling point;
 * if so, each later point is screened by the tangent-plane distance of the liquids found so far
 * (a negative value = unstable) before the split and the heterogeneous bubble point are solved.
 */
export function makeBubble(pp, P, llOK) {
  let lastT = null;
  const memo = new Map();
  let calls = 0;
  const lib = [];                                    // tie lines {a, b} of the splits found so far
  const homog = (x) => {
    let r;
    try { r = th.flashPVF(pp, x, P, 0, num(lastT) ? lastT : undefined); } catch (_e) { r = th.flashPVF(pp, x, P, 0); }
    lastT = r.T;
    return r;
  };
  // heterogeneous bubble point: liquid–liquid substitution and the bubble condition of liquid 1
  // (Σ x1 K_V = 1, Newton on T) iterated together from a nearby split
  const het = (x, T0, sp0) => {
    const n = x.length, live = x.map((v) => v > 0);
    let T = T0, x1 = sp0.x1.slice(), x2 = sp0.x2.slice(), beta = sp0.beta;
    let K = x.map((v, i) => (live[i] ? Math.max(x2[i], 1e-300) / Math.max(x1[i], 1e-300) : 1));
    let y = x1.slice();
    const g = (bb) => { let s2 = 0; for (let i = 0; i < n; i++) if (live[i]) s2 += x[i] * (K[i] - 1) / (1 + bb * (K[i] - 1)); return s2; };
    /** liquid–liquid substitution at the current T */
    const llAt = (maxIt, tol) => {
      let err = Infinity, dPrev = null;
      for (let it = 0; it < maxIt; it++) {
        let lo = 0, hi = 1;
        for (let i = 0; i < n; i++) if (live[i]) { if (K[i] > 1) lo = Math.max(lo, (x[i] * K[i] - 1) / (K[i] - 1)); else if (K[i] < 1) hi = Math.min(hi, (1 - x[i]) / (1 - K[i])); }
        if (!(hi > lo)) return null;
        for (let k = 0; k < 100; k++) { const m = 0.5 * (lo + hi); if (g(m) > 0) lo = m; else hi = m; if (hi - lo < 1e-15 * Math.max(1, lo)) break; }
        if (!(lo > 1e-14 && hi < 1 - 1e-14)) return null;
        beta = 0.5 * (lo + hi);
        for (let i = 0; i < n; i++) { x1[i] = live[i] ? x[i] / (1 + beta * (K[i] - 1)) : 0; x2[i] = x1[i] * K[i]; }
        const f1 = pp.lnFug(T, P, x1, 'L'), f2 = pp.lnFug(T, P, x2, 'L');
        let triv = 0; err = 0;
        const d = new Array(n).fill(0);
        for (let i = 0; i < n; i++) if (live[i]) { const lk = f1[i] - f2[i]; d[i] = lk - Math.log(K[i]); err = Math.max(err, Math.abs(d[i])); triv += lk * lk; K[i] = Math.exp(lk); }
        if (triv < 1e-8) return null;
        if (err < tol) return f1;
        if (err < 1e-8 && dPrev && err > 0.5 * Math.max(...dPrev.map(Math.abs))) return f1;      // stalled at round-off
        // dominant-eigenvalue acceleration of the substitution every fifth step (slow near plait points)
        if (dPrev && it % 5 === 4) {
          let a = 0, b = 0; for (let i = 0; i < n; i++) { a += d[i] * dPrev[i]; b += dPrev[i] * dPrev[i]; }
          const lam = b > 0 ? a / b : 0;
          if (lam > 0.05 && lam < 0.97) { const g = lam / (1 - lam); for (let i = 0; i < n; i++) if (live[i]) K[i] *= Math.exp(Math.max(-2, Math.min(2, g * d[i]))); }
        }
        dPrev = d;
      }
      return err < 1e-4 ? pp.lnFug(T, P, x1, 'L') : null;
    };
    /** Σ x1·K_V of liquid 1 at T (vapour converged by substitution) */
    const sumK = (TT, f1) => {
      let fv, sK = 1;
      for (let k = 0; k < 30; k++) {
        fv = pp.lnFug(TT, P, y, 'V'); sK = 0;
        for (let i = 0; i < n; i++) sK += x1[i] * Math.exp(f1[i] - fv[i]);
        let d = 0; for (let i = 0; i < n; i++) { const yn = x1[i] * Math.exp(f1[i] - fv[i]) / sK; d = Math.max(d, Math.abs(yn - y[i])); y[i] = yn; }
        if (d < 1e-12) break;
      }
      return sK;
    };
    for (let outer = 0; outer < 60; outer++) {
      const f1 = llAt(200, 1e-10);
      if (!f1) return null;
      const lns = Math.log(sumK(T, f1));
      // d ln(Σ x1 K_V)/dT at fixed liquid composition
      const dT = 0.01, fa = pp.lnFug(T + dT, P, x1, 'L'), yb = y.slice();
      const fvb = pp.lnFug(T + dT, P, y, 'V');
      let s2 = 0; for (let i = 0; i < n; i++) s2 += x1[i] * Math.exp(fa[i] - fvb[i]);
      y = yb;
      let dl = (Math.log(s2) - lns) / dT;
      if (!(dl > 0)) dl = 0.04;
      const step = Math.max(-3, Math.min(3, -lns / dl));
      T += step;
      if (Math.abs(step) < 1e-7) return { T, y: y.slice(), het: true, x1: x1.slice(), x2: x2.slice(), beta };
    }
    return null;
  };
  let lastHet = null;
  const dist = (u, w) => Math.max(...u.map((v, i) => Math.abs(v - w[i])));
  const addLib = (sp) => {
    if (lib.some((t) => (dist(t.a, sp.x1) < 0.02 && dist(t.b, sp.x2) < 0.02) || (dist(t.a, sp.x2) < 0.02 && dist(t.b, sp.x1) < 0.02))) return;
    lib.push({ a: sp.x1.slice(), b: sp.x2.slice() });
    if (lib.length > 40) lib.splice(0, lib.length - 40);
  };
  /** distance from x to the tie line a–b (Euclidean, in mole fractions) */
  const segDist = (t, x) => {
    let ab = 0, ax = 0;
    for (let i = 0; i < x.length; i++) { const d = t.b[i] - t.a[i]; ab += d * d; ax += (x[i] - t.a[i]) * d; }
    const u = ab > 0 ? Math.max(0, Math.min(1, ax / ab)) : 0;
    let s2 = 0; for (let i = 0; i < x.length; i++) { const q = x[i] - t.a[i] - u * (t.b[i] - t.a[i]); s2 += q * q; }
    return s2;
  };
  let active = false;
  if (llOK && pp.n >= 2) {
    // survey: a coarse grid of the composition space at each point's own bubble temperature
    const n = pp.n, grid = [];
    const step = n <= 3 ? 1 / 7 : 1 / 4;
    const rec = (k, rem, cur) => {
      if (k === n - 1) { grid.push(cur.concat([rem])); return; }
      for (let v = step; v < rem - 1e-9; v += step) rec(k + 1, rem - v, cur.concat([v]));
    };
    rec(0, 1, []);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (const f of [0.15, 0.5, 0.85]) { const x = new Array(n).fill(0); x[a] = f; x[b] = 1 - f; grid.push(x); }
    for (const x of grid.slice(0, 160)) {
      const r = homog(x);
      const sp = th.liquidSplit(pp, x, r.T, P, null);
      if (sp) addLib(sp);
    }
    active = lib.length > 0;
  }
  const f = (x) => {
    const key = x.map((v) => v.toFixed(12)).join('|');
    const m = memo.get(key);
    if (m) return m;
    calls++;
    const r = homog(x);
    let out = { T: r.T, y: r.y, het: false };
    if (active && x.filter((v) => v > 1e-12).length >= 2) {
      // tangent-plane screen with the known liquid phases
      const fx = pp.lnFug(r.T, P, x, 'L');
      let best = null, tmin = -1e-10;
      // trial phases: both ends of the six tie lines that pass closest to x (the liquids x would split into lie on them)
      const ties = lib.length > 6 ? lib.map((t) => [t, segDist(t, x)]).sort((a, b) => a[1] - b[1]).slice(0, 6).map((q) => q[0]) : lib;
      for (const w of ties.flatMap((t) => [t.a, t.b])) {
        const ww = w.map((v, i) => (x[i] > 0 ? Math.max(v, 1e-14) : 0)), sw = ww.reduce((a, v) => a + v, 0);
        const wn = ww.map((v) => v / sw), fw = pp.lnFug(r.T, P, wn, 'L');
        let tpd = 0; for (let i = 0; i < x.length; i++) if (x[i] > 0) tpd += wn[i] * (Math.log(wn[i]) + fw[i] - Math.log(x[i]) - fx[i]);
        if (tpd < tmin) { tmin = tpd; best = wn; }
      }
      if (best) {
        // start from the previous heterogeneous point (residue curves move in small steps), else from a fresh split
        let h = lastHet ? het(x, lastHet.T, lastHet) : null;
        if (!h) {
          const sp = th.liquidSplit(pp, x, r.T, P, null, 1e-8);
          if (sp) h = het(x, r.T, sp);
        }
        if (h) { out = h; lastHet = h; addLib(h); }
      }
    }
    if (memo.size > 20000) memo.clear();
    memo.set(key, out);
    return out;
  };
  f.calls = () => calls;
  return f;
}

// ---- small linear algebra ----------------------------------------------------
function solve(A, b) {
  const n = b.length, a = A.map((r, i) => r.slice().concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-300) return null;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = c + 1; r < n; r++) { const f = a[r][c] / a[c][c]; if (f) for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = a[r][n]; for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k]; x[r] = s / a[r][r]; }
  return x;
}
/** real parts of the eigenvalues of a small real matrix (QR iterations, n ≤ 4) */
function eigReal(A) {
  const n = A.length;
  if (n === 1) return [A[0][0]];
  if (n === 2) {
    const tr = A[0][0] + A[1][1], det = A[0][0] * A[1][1] - A[0][1] * A[1][0], d = tr * tr / 4 - det;
    return d >= 0 ? [tr / 2 + Math.sqrt(d), tr / 2 - Math.sqrt(d)] : [tr / 2, tr / 2];
  }
  let M = A.map((r) => r.slice());
  for (let it = 0; it < 300; it++) {
    // Gram–Schmidt QR
    const Q = Array.from({ length: n }, () => new Array(n).fill(0)), Rm = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const v = M.map((r) => r[j]);
      for (let k = 0; k < j; k++) { let d = 0; for (let i = 0; i < n; i++) d += Q[i][k] * M[i][j]; Rm[k][j] = d; for (let i = 0; i < n; i++) v[i] -= d * Q[i][k]; }
      const nv = Math.hypot(...v) || 1e-300; Rm[j][j] = nv; for (let i = 0; i < n; i++) Q[i][j] = v[i] / nv;
    }
    M = Rm.map((r, i) => Q[0].map((_, j) => { let s = 0; for (let k = 0; k < n; k++) s += r[k] * Q[k][j]; return s; }));
  }
  // 2×2 blocks for complex pairs
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i < n - 1 && Math.abs(M[i + 1][i]) > 1e-8) { const tr = M[i][i] + M[i + 1][i + 1]; out.push(tr / 2, tr / 2); i++; } else out.push(M[i][i]);
  }
  return out;
}

/** composition helpers over a subset S of the package indices */
const embed = (n, S, xs) => { const x = new Array(n).fill(0); S.forEach((i, k) => { x[i] = xs[k]; }); return x; };

/**
 * Residue-curve vector field on subset S: F(x) = x − y (reduced to the first |S|−1 coordinates).
 * Returns the Jacobian dF/dx_red (central / inward differences) at a point of the subset simplex.
 */
function jacobian(bub, n, S, xs) {
  const m = S.length - 1, h = 2e-6;
  const F = (v) => { const full = embed(n, S, v); const b = bub(full); return S.slice(0, m).map((i, k) => v[k] - b.y[i]); };
  const J = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let c = 0; c < m; c++) {
    // move along e_c − e_last (keeps the sum at 1); one-sided where a fraction is at its bound
    const canUp = xs[m] > h, canDn = xs[c] > h;
    const up = xs.slice(), dn = xs.slice();
    if (canUp) { up[c] += h; up[m] -= h; }
    if (canDn) { dn[c] -= h; dn[m] += h; }
    const fu = F(up), fd = F(dn), span = (canUp ? h : 0) + (canDn ? h : 0);
    for (let r = 0; r < m; r++) J[r][c] = span ? (fu[r] - fd[r]) / span : 0;
  }
  return J;
}
/** eigenvalues of the residue-curve field at a singular point of subset S, plus the transverse ones (1 − K∞) for the others */
function stability(bub, n, S, xs, others) {
  const lam = S.length > 1 ? eigReal(jacobian(bub, n, S, xs)) : [];
  const trans = [];
  for (const k of others) {
    const e = 1e-6, v = embed(n, S, xs.map((t) => t * (1 - e)));
    v[k] = e;
    const b = bub(v);
    trans.push(1 - b.y[k] / e);
  }
  return { lam, trans };
}
const kindOf = (l) => (l.length === 0 ? 'node' : l.every((v) => v < 0) ? 'stable node' : l.every((v) => v > 0) ? 'unstable node' : 'saddle');

/** binary azeotropes on the edge i–j: sign changes of y_i − x_i, refined by bisection */
function edgeAzeotropes(bub, n, i, j, grid) {
  const out = [];
  const g = grid || 40;
  const at = (a) => { const x = new Array(n).fill(0); x[i] = a; x[j] = 1 - a; return bub(x); };
  let a0 = 1e-4, b0 = at(a0), f0 = b0.y[i] - a0;
  for (let k = 1; k <= g; k++) {
    const a1 = k === g ? 1 - 1e-4 : k / g, b1 = at(a1), f1 = b1.y[i] - a1;
    if (f0 * f1 < 0) {
      let lo = a0, hi = a1, flo = f0, bm = null, m = 0;
      for (let it = 0; it < 60; it++) {
        m = 0.5 * (lo + hi); bm = at(m);
        const fm = bm.y[i] - m;
        if (fm * flo > 0) { lo = m; flo = fm; } else hi = m;
        if (hi - lo < 1e-9) break;
      }
      // in the two-liquid region the overall liquid is any point of the tie line: report the vapour (= azeotrope)
      const x = new Array(n).fill(0); x[i] = bm.het ? bm.y[i] / (bm.y[i] + bm.y[j]) : m; x[j] = 1 - x[i];
      out.push({ x, T: bm.T, het: !!bm.het, bub: bm });
    }
    a0 = a1; f0 = f1;
  }
  return out;
}

/** interior azeotrope of subset S by Newton on y(x) − x from a start point */
function newtonAzeo(bub, n, S, x0) {
  const m = S.length - 1;
  let xs = x0.slice();
  const G = (v) => { const b = bub(embed(n, S, v)); return { g: S.slice(0, m).map((i, k) => b.y[i] - v[k]), b }; };
  let cur = G(xs);
  for (let it = 0; it < 40; it++) {
    const err = Math.max(...cur.g.map(Math.abs));
    if (err < 1e-10) break;
    const J = jacobian(bub, n, S, xs).map((r) => r.map((v) => -v));     // d(y − x)/dx = −dF/dx
    const d = solve(J, cur.g.map((v) => -v));
    if (!d) return null;
    let lam = 1;
    for (let k = 0; k < m; k++) { if (xs[k] + lam * d[k] < 1e-7) lam = Math.min(lam, 0.9 * (xs[k] - 1e-7) / -d[k]); }
    const sd = d.reduce((a, v) => a + v, 0);
    if (xs[m] - lam * sd < 1e-7) lam = Math.min(lam, 0.9 * (xs[m] - 1e-7) / sd);
    let acc = false;
    for (let ls = 0; ls < 20; ls++) {
      const v = xs.slice(); for (let k = 0; k < m; k++) v[k] += lam * d[k]; v[m] = 1 - v.slice(0, m).reduce((a, t) => a + t, 0);
      if (v.some((t) => !(t > 0))) { lam *= 0.5; continue; }
      const c = G(v);
      if (Math.max(...c.g.map(Math.abs)) < Math.max(...cur.g.map(Math.abs)) * (1 - 1e-4 * lam) || Math.max(...c.g.map(Math.abs)) < 1e-10) { xs = v; cur = c; acc = true; break; }
      lam *= 0.5;
    }
    if (!acc) break;
  }
  const err = Math.max(...cur.g.map(Math.abs));
  if (!(err < 1e-7) || xs.some((t) => t < 1e-5)) return null;
  // heteroazeotrope: the vapour composition is the azeotrope (the liquid is a point on the tie line)
  if (cur.b.het) { const ys = S.map((i) => cur.b.y[i]); const sy = ys.reduce((a, t) => a + t, 0); xs = ys.map((t) => t / sy); }
  return { xs, T: cur.b.T, het: !!cur.b.het, bub: cur.b };
}

/** residue curve from x0 (full composition on the ternary face), both directions; returns points ordered by rising T */
function residueCurve(bub, n, S, x0, opt) {
  const ds = opt.ds || 0.02, maxSteps = opt.maxSteps || 160, tEnd = opt.tEnd;
  const F = (x) => { const b = bub(x); return { f: S.map((i) => x[i] - b.y[i]), T: b.T }; };
  const run = (sign) => {
    const pts = [];
    let x = x0.slice(), c = F(x);
    for (let k = 0; k < maxSteps; k++) {
      if (Date.now() > tEnd) break;
      const nf = Math.hypot(...c.f);
      if (nf < 3e-5) break;                                     // a node
      const h = sign * Math.min(ds / nf, 40);
      // Heun step
      const x1 = x.slice(); S.forEach((i, k2) => { x1[i] = Math.max(0, x[i] + h * c.f[k2]); });
      const s1 = S.reduce((a, i) => a + x1[i], 0); S.forEach((i) => { x1[i] /= s1; });
      const c1 = F(x1);
      const x2 = x.slice(); S.forEach((i, k2) => { x2[i] = Math.max(0, x[i] + 0.5 * h * (c.f[k2] + c1.f[k2])); });
      const s2 = S.reduce((a, i) => a + x2[i], 0); S.forEach((i) => { x2[i] /= s2; });
      x = x2; c = F(x);
      pts.push({ x: S.map((i) => x[i]), T: c.T });
    }
    return pts;
  };
  const back = run(-1).reverse(), c0 = F(x0), fwd = run(1);
  return back.concat([{ x: S.map((i) => x0[i]), T: c0.T }], fwd);
}

function pkgFor(p, keys) {
  const spec = Object.assign({}, p.property_package || { model: 'nrtl' });
  const pp = units.pkg(spec, keys);
  if (pp.electrolyte) fail('MB_TERN_PKG', 'not available with an electrolyte or urea property method', 'property_package');
  return pp;
}

// ---------------------------------------------------------------------------
// ternary-diagram
// ---------------------------------------------------------------------------
function solveTernary(inp) {
  const t0 = Date.now();
  const p = (inp && inp.params) || {};
  const keys = Array.isArray(p.keys) ? p.keys.slice(0, 3) : [];
  if (keys.length !== 3 || new Set(keys).size !== 3) fail('MB_TERN_KEYS', 'ternary-diagram: three different components are needed', 'keys');
  const pp = pkgFor(p, keys);
  keys.splice(0, 3, ...pp.keys);              // work in the package's component order
  const n = 3, S = [0, 1, 2];
  const P = (num(p.P_bar) && p.P_bar > 0 ? p.P_bar : 1.01325) * 1e5;
  const llOK = LL_MODELS.has(pp.model) && p.two_liquids !== false;
  const bub = makeBubble(pp, P, llOK);
  const w = pp.warnings.slice();
  const tEnd = t0 + (num(p.time_ms) ? p.time_ms : 6500);
  // pure components
  const singular = [];
  keys.forEach((k, i) => {
    const x = [0, 0, 0]; x[i] = 1;
    const b = bub(x);
    const st = stability(bub, n, [i], [1], S.filter((j) => j !== i));
    singular.push({ type: 'pure', key: k, x, T: b.T, lam: st.trans, kind: kindOf(st.trans), het: false });
  });
  // binary azeotropes on the three edges
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    for (const a of edgeAzeotropes(bub, n, i, j, 40)) {
      const xs = [a.x[i], a.x[j]];
      const st = stability(bub, n, [i, j], xs, S.filter((k) => k !== i && k !== j));
      const lam = st.lam.concat(st.trans);
      singular.push({ type: 'binary', keys: [keys[i], keys[j]], x: a.x, T: a.T, lam, kind: kindOf(lam), het: a.het });
    }
  }
  // ternary azeotropes: Newton from a spread of starts
  const starts = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.45, 0.1, 0.45], [0.1, 0.45, 0.45], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
  for (const s0 of starts) {
    if (Date.now() > tEnd) break;
    const r = newtonAzeo(bub, n, S, s0);
    if (!r) continue;
    if (singular.some((q) => q.type === 'ternary' && Math.max(...q.x.map((v, k) => Math.abs(v - r.xs[k]))) < 1e-4)) continue;
    const st = stability(bub, n, S, r.xs, []);
    singular.push({ type: 'ternary', keys: keys.slice(), x: r.xs, T: r.T, lam: st.lam, kind: kindOf(st.lam), het: r.het });
  }
  // distillation boundaries: separatrices from the saddles
  const bounds = [];
  for (const q of singular) {
    if (q.kind !== 'saddle' || Date.now() > tEnd) continue;
    const dirs = [];
    if (q.type === 'pure') {
      // pure saddle: the edges are its separatrices — no interior boundary leaves a vertex
      continue;
    } else if (q.type === 'binary') {
      // transverse direction into the interior: towards the third component, corrected along the edge
      const k = S.find((t) => q.x[t] === 0);
      const d = [0, 0, 0]; d[k] = 1;
      const i = S.find((t) => t !== k && q.x[t] > 0), j = S.find((t) => t !== k && t !== i);
      // eigenvector of the 2D Jacobian for the transverse eigenvalue (coordinates x_i, x_k with x_j = 1 − x_i − x_k)
      const Sx = [i, k, j], xs = [q.x[i], q.x[k], q.x[j]];
      const J = jacobian(bub, n, Sx, xs);
      const lamT = J[1][1];                       // ∂F_k/∂x_k on the edge (F_k ≡ 0 along it)
      const di = Math.abs(J[0][0] - lamT) > 1e-12 ? J[0][1] / (lamT - J[0][0]) : 0;
      d[i] = di; d[j] = -1 - di;
      dirs.push({ d, sign: lamT > 0 ? 1 : -1 });
    } else {
      const J = jacobian(bub, n, S, q.x);
      const tr = J[0][0] + J[1][1], det = J[0][0] * J[1][1] - J[0][1] * J[1][0], disc = tr * tr / 4 - det;
      if (disc <= 0) continue;
      for (const lam of [tr / 2 + Math.sqrt(disc), tr / 2 - Math.sqrt(disc)]) {
        const v = Math.abs(J[0][1]) > 1e-12 ? [J[0][1], lam - J[0][0]] : [lam - J[1][1], J[1][0]];
        for (const sg of [1, -1]) dirs.push({ d: [sg * v[0], sg * v[1], -sg * (v[0] + v[1])], sign: lam > 0 ? 1 : -1 });
      }
    }
    for (const { d, sign } of dirs) {
      const nd = Math.hypot(...d) || 1, eps = 0.004;
      const x0 = q.x.map((v, k) => v + eps * d[k] / nd);
      if (x0.some((v) => v < 0)) continue;
      const s0 = x0.reduce((a, v) => a + v, 0);
      const xs0 = x0.map((v) => v / s0);
      const pts = residueCurve(bub, n, S, xs0, { tEnd, maxSteps: 220, ds: 0.015 });
      // keep the half that runs away from the saddle
      const k0 = pts.findIndex((pt) => Math.abs(pt.x[0] - xs0[0]) < 1e-12 && Math.abs(pt.x[1] - xs0[1]) < 1e-12);
      const half = sign > 0 ? pts.slice(k0) : pts.slice(0, k0 + 1).reverse();
      bounds.push([{ x: q.x.slice(), T: q.T }].concat(half));
    }
  }
  // residue curves: seeds spread over the triangle
  const nC = Math.max(4, Math.min(30, Math.round(num(p.curves) ? p.curves : 14)));
  const seeds = [];
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
  for (let i = 1; seeds.length < nC && i < 400; i++) {
    let u = halton(i, 2), v = halton(i, 3);
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const x = [u, v, 1 - u - v];
    if (x.some((t) => t < 0.03)) continue;
    if (seeds.some((s) => Math.hypot(s[0] - x[0], s[1] - x[1]) < 0.11)) continue;
    seeds.push(x);
  }
  const curves = [];
  for (const s0 of seeds) {
    if (Date.now() > tEnd) { w.push('ternary-diagram: time limit reached — fewer residue curves than asked'); break; }
    const pts = residueCurve(bub, n, S, s0, { tEnd });
    if (pts.length > 2) curves.push(pts);
  }
  // liquid–liquid envelope at a chosen temperature (activity methods)
  let lle = null;
  if (llOK && num(p.lle_T_K)) {
    const T = p.lle_T_K, Pl = Math.max(P, 50e5);
    const ties = [];
    for (let a = 0.025; a < 1; a += 0.05) for (let b = 0.025; a + b < 0.999; b += 0.05) {
      const x = [a, b, 1 - a - b];
      const sp = th.liquidSplit(pp, x, T, Pl, ties.length ? ties[ties.length - 1] : null);
      if (!sp) continue;
      if (ties.some((t) => Math.max(Math.abs(t.x1[0] - sp.x1[0]), Math.abs(t.x1[1] - sp.x1[1]), Math.abs(t.x2[0] - sp.x2[0]), Math.abs(t.x2[1] - sp.x2[1])) < 0.01)) continue;
      ties.push(sp);
    }
    if (ties.length) {
      const ends = ties.flatMap((t) => [t.x1, t.x2]);
      const c = [0, 1, 2].map((k) => ends.reduce((s, e) => s + e[k], 0) / ends.length);
      const ang = (e) => Math.atan2((e[1] - c[1]) * Math.sqrt(3) / 2, e[0] - c[0] + 0.5 * (e[1] - c[1]));
      const env = ends.slice().sort((u, v) => ang(u) - ang(v));
      // tie lines in order along the envelope (by the angle of their midpoint)
      const tl = ties.slice().sort((u, v) => ang(u.x1.map((q, k2) => 0.5 * (q + u.x2[k2]))) - ang(v.x1.map((q, k2) => 0.5 * (q + v.x2[k2]))));
      lle = { T_K: r6(T), tie_lines: tl.map((t) => ({ x1: t.x1.map(r6), x2: t.x2.map(r6) })), envelope: env.map((e) => e.map(r6)) };
    } else lle = { T_K: r6(T), tie_lines: [], envelope: [] };
  }
  const ms = Date.now() - t0;
  const pt = (q) => ({ x: q.x.map(r6), T_K: r6(q.T) });
  // keyed look-up of the singular points ('acetone+chloroform': …; names sorted) — lowest-boiling first when a set repeats
  const byKeys = {};
  for (const q of singular.slice().sort((u, v) => u.T - v.T)) {
    const ks = q.keys || [q.key], id = ks.slice().sort().join('+');
    if (byKeys[id]) continue;
    byKeys[id] = { T_K: r6(q.T), kind: q.kind, heterogeneous: q.het, x: Object.fromEntries(keys.map((k, i) => [k, r6(q.x[i])])) };
  }
  return {
    streams_out: [], mass_balance: {}, energy_balance: {},
    details: {
      pp: { model: pp.model, label: pp.label }, keys, P_bar: r6(P / 1e5), two_liquids: llOK,
      singular_points: singular.map((q) => ({ type: q.type, keys: q.keys || [q.key], x: q.x.map(r6), T_K: r6(q.T), kind: q.kind, heterogeneous: q.het, eigenvalues: q.lam.map(r6) })),
      residue_curves: curves.map((c) => c.filter((_, k) => k % 2 === 0 || k === c.length - 1).map(pt)),
      boundaries: bounds.map((c) => c.filter((_, k) => k % 2 === 0 || k === c.length - 1).map(pt)),
      by_keys: byKeys, n_boundaries: bounds.length,
      lle, bubble_points: bub.calls(), ms,
    },
    converged: true, warnings: w,
  };
}

// ---------------------------------------------------------------------------
// azeotrope-search
// ---------------------------------------------------------------------------
function solveAzeoSearch(inp) {
  const t0 = Date.now();
  const p = (inp && inp.params) || {};
  const keys = Array.isArray(p.keys) ? [...new Set(p.keys)] : [];
  if (keys.length < 2 || keys.length > 8) fail('MB_AZEO_KEYS', 'azeotrope-search: give 2 to 8 different components', 'keys');
  const pp = pkgFor(p, keys);
  keys.splice(0, keys.length, ...pp.keys);
  const n = keys.length, all = keys.map((_, i) => i);
  const P = (num(p.P_bar) && p.P_bar > 0 ? p.P_bar : 1.01325) * 1e5;
  const llOK = LL_MODELS.has(pp.model) && p.two_liquids !== false;
  const bub = makeBubble(pp, P, llOK);
  const w = pp.warnings.slice();
  const tEnd = t0 + (num(p.time_ms) ? p.time_ms : 7000);
  const maxOrder = Math.max(2, Math.min(4, Math.round(num(p.max_order) ? p.max_order : 4)));
  const pure = keys.map((k, i) => {
    const x = new Array(n).fill(0); x[i] = 1;
    const b = bub(x);
    const st = stability(bub, n, [i], [1], all.filter((j) => j !== i));
    return { key: k, T: b.T, kind: kindOf(st.trans) };
  });
  const found = [];
  const azSets = new Set();
  const subsets = (k) => { const out = []; const rec = (s, a) => { if (a.length === k) { out.push(a.slice()); return; } for (let i = s; i < n; i++) { a.push(i); rec(i + 1, a); a.pop(); } }; rec(0, []); return out; };
  let truncated = false;
  for (const [a, b] of subsets(2)) {
    if (Date.now() > tEnd) { truncated = true; break; }
    for (const az of edgeAzeotropes(bub, n, a, b, 40)) {
      const S = [a, b], xs = [az.x[a], az.x[b]];
      const st = stability(bub, n, S, xs, all.filter((k) => !S.includes(k)));
      found.push({ S, xs, T: az.T, het: az.het, inSub: kindOf(st.lam), inAll: kindOf(st.lam.concat(st.trans)) });
      azSets.add(S.join(','));
    }
  }
  for (let order = 3; order <= Math.min(maxOrder, n); order++) {
    for (const S of subsets(order)) {
      if (Date.now() > tEnd) { truncated = true; break; }
      // a higher-order azeotrope needs azeotropic sub-systems: at least one (ternary) or two (quaternary)
      const nAz = [...azSets].filter((s) => s.split(',').map(Number).every((i) => S.includes(i))).length;
      if (nAz < order - 2) continue;
      const m = S.length;
      const starts = [new Array(m).fill(1 / m)];
      for (let k = 0; k < m; k++) { const v = new Array(m).fill(0.4 / (m - 1)); v[k] = 0.6; starts.push(v); }
      for (const s0 of starts) {
        const r = newtonAzeo(bub, n, S, s0);
        if (!r) continue;
        if (found.some((f) => f.S.join(',') === S.join(',') && Math.max(...f.xs.map((v, k) => Math.abs(v - r.xs[k]))) < 1e-4)) continue;
        const st = stability(bub, n, S, r.xs, all.filter((k) => !S.includes(k)));
        found.push({ S, xs: r.xs, T: r.T, het: r.het, inSub: kindOf(st.lam), inAll: kindOf(st.lam.concat(st.trans)) });
        azSets.add(S.join(','));
      }
    }
  }
  if (truncated) w.push('azeotrope-search: time limit reached — the search did not cover every sub-system; give fewer components');
  const mwOf = (S, xs) => { const m = S.reduce((a, i, k) => a + xs[k] * pp.MW[i], 0); return S.map((i, k) => xs[k] * pp.MW[i] / m); };
  const boil = (f) => {
    const Tmin = Math.min(...f.S.map((i) => pure[i].T)), Tmax = Math.max(...f.S.map((i) => pure[i].T));
    return f.T < Tmin ? 'minimum-boiling' : f.T > Tmax ? 'maximum-boiling' : 'intermediate (saddle)';
  };
  const az = found.sort((u, v) => u.T - v.T).map((f) => ({
    keys: f.S.map((i) => keys[i]), x: f.xs.map(r6), w: mwOf(f.S, f.xs).map(r6), T_K: r6(f.T), heterogeneous: f.het,
    boiling: boil(f), kind_in_subsystem: f.inSub, kind_in_mixture: f.inAll,
  }));
  const byKeys = {};
  for (const a of az) {
    const id = a.keys.slice().sort().join('+');
    if (!byKeys[id]) byKeys[id] = { T_K: a.T_K, heterogeneous: a.heterogeneous, boiling: a.boiling, kind_in_mixture: a.kind_in_mixture, x: Object.fromEntries(a.keys.map((k, i) => [k, a.x[i]])), w: Object.fromEntries(a.keys.map((k, i) => [k, a.w[i]])) };
  }
  return {
    streams_out: [], mass_balance: {}, energy_balance: {},
    details: { pp: { model: pp.model, label: pp.label }, keys, P_bar: r6(P / 1e5), two_liquids: llOK,
      pure: pure.map((q) => ({ key: q.key, T_K: r6(q.T), kind: q.kind })), azeotropes: az, n_azeotropes: az.length, by_keys: byKeys, bubble_points: bub.calls(), ms: Date.now() - t0 },
    converged: !truncated, warnings: w,
  };
}

export const TERNARY_MODULES = { 'ternary-diagram': solveTernary, 'azeotrope-search': solveAzeoSearch };
export default { TERNARY_VERSION, TERNARY_MODULES };
