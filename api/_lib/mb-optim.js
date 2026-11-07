// ============================================================================
// REPO PATH: api/_lib/mb-optim.js
// ============================================================================
// multicalci.com — STEP 36: derivative-free bounded minimisers for flowsheet
// optimisation. Every function evaluation is a whole flowsheet solve, so the
// minimisers are written as generators: they yield the next point and receive
// its merit value. The driver can then replay earlier evaluations from a cache
// (a continuation of a run that hit the server time limit) and the minimiser
// retraces exactly the same path — no internal state has to be stored.
//
//   one variable : Brent's method (golden section + parabolic interpolation),
//                  as in Forsythe, Malcolm & Moler (1977), "fmin", started at
//                  the user's value;
//   2–6 variables: Nelder–Mead simplex (Lagarias et al. 1998 coefficients)
//                  on variables scaled to [0, 1] and kept inside the bounds,
//                  with one restart from the best point.
//
// Constraints are handled by the caller with an exact (L1) penalty.
//
// (c) multicalci.com
// ============================================================================

'use strict';

export const OPTIM_VERSION = 'mb-optim 1.0.0';
const EPS = Math.sqrt(2.220446049250313e-16);
const GOLD = (3 - Math.sqrt(5)) / 2;

/**
 * Brent minimisation on [a, b] from x0. Yields x, receives f(x).
 * Stops when the bracket is within tol (absolute, in x) or after maxit points.
 */
export function* brent(a, b, x0, tol, maxit) {
  let x = Math.min(b, Math.max(a, x0)), w = x, v = x;
  let fx = yield x;
  let fw = fx, fv = fx, d = 0, e = 0, n = 1;
  while (n < maxit) {
    const xm = 0.5 * (a + b), tol1 = EPS * Math.abs(x) + tol / 3, tol2 = 2 * tol1;
    if (Math.abs(x - xm) <= tol2 - 0.5 * (b - a)) return { x: [x], f: fx, converged: true, evaluations: n };
    let golden = true;
    if (Math.abs(e) > tol1 && Number.isFinite(fx) && Number.isFinite(fw) && Number.isFinite(fv)) {
      let r = (x - w) * (fx - fv), q = (x - v) * (fx - fw), p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p; else q = -q;
      const eOld = e;
      e = d;
      if (Math.abs(p) < Math.abs(0.5 * q * eOld) && p > q * (a - x) && p < q * (b - x)) {
        d = p / q;
        const u = x + d;
        if (u - a < tol2 || b - u < tol2) d = xm >= x ? tol1 : -tol1;
        golden = false;
      }
    }
    if (golden) { e = (x < xm ? b : a) - x; d = GOLD * e; }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d > 0 ? tol1 : -tol1);
    const fu = yield u;
    n++;
    if (fu <= fx) {
      if (u < x) b = x; else a = x;
      v = w; fv = fw; w = x; fw = fx; x = u; fx = fu;
    } else {
      if (u < x) a = u; else b = u;
      if (fu <= fw || w === x) { v = w; fv = fw; w = u; fw = fu; }
      else if (fu <= fv || v === x || v === w) { v = u; fv = fu; }
    }
  }
  return { x: [x], f: fx, converged: false, evaluations: n };
}

const clip01 = (u) => u.map((v) => Math.min(1, Math.max(0, v)));

/**
 * Nelder–Mead on [0, 1]^n from u0. Yields u (scaled), receives f.
 * opts: { step (initial edge, 0.15), xtol (0.002), ftol (1e-7), maxit (points), restart (true) }
 */
export function* nelderMead(u0, opts) {
  const n = u0.length;
  const step = opts.step || 0.15, xtol = opts.xtol || 2e-3, ftol = opts.ftol || 1e-7, maxit = opts.maxit || 200;
  let evals = 0;
  const f = function* (u) { evals++; return yield u; };
  let best = null;
  for (let round = 0; round < (opts.restart === false ? 1 : 2); round++) {
    const start = round === 0 ? clip01(u0) : best.u;
    const st = round === 0 ? step : step / 3;
    const S = [{ u: start, f: round === 0 ? yield* f(start) : best.f }];
    for (let i = 0; i < n && evals < maxit; i++) {
      const u = start.slice();
      u[i] = u[i] + st <= 1 ? u[i] + st : u[i] - st;
      S.push({ u: clip01(u), f: yield* f(clip01(u)) });
    }
    if (S.length < n + 1) { best = S.reduce((a, b) => (b.f < a.f ? b : a)); break; }
    let conv = false;
    while (evals < maxit) {
      S.sort((a, b) => a.f - b.f);
      const fr0 = S[0].f, frn = S[n].f;
      const size = Math.max(...S.slice(1).map((p) => Math.max(...p.u.map((v, k) => Math.abs(v - S[0].u[k])))));
      if (size <= xtol && Math.abs(frn - fr0) <= ftol * (Math.abs(fr0) + ftol)) { conv = true; break; }
      if (size <= xtol / 10) { conv = true; break; }
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += S[i].u[k] / n;
      const W = S[n];
      const ur = clip01(c.map((v, k) => v + (v - W.u[k])));
      const fr = yield* f(ur);
      if (fr < S[0].f) {
        const ue = clip01(c.map((v, k) => v + 2 * (ur[k] - v)));
        const fe = evals < maxit ? yield* f(ue) : Infinity;
        S[n] = fe < fr ? { u: ue, f: fe } : { u: ur, f: fr };
      } else if (fr < S[n - 1].f) {
        S[n] = { u: ur, f: fr };
      } else {
        const outside = fr < W.f;
        const uc = clip01(c.map((v, k) => v + 0.5 * ((outside ? ur[k] : W.u[k]) - v)));
        const fc = evals < maxit ? yield* f(uc) : Infinity;
        if (fc < (outside ? fr : W.f)) S[n] = { u: uc, f: fc };
        else {
          for (let i = 1; i <= n && evals < maxit; i++) {
            const us = clip01(S[i].u.map((v, k) => S[0].u[k] + 0.5 * (v - S[0].u[k])));
            S[i] = { u: us, f: yield* f(us) };
          }
        }
      }
    }
    S.sort((a, b) => a.f - b.f);
    const prev = best;
    best = { u: S[0].u, f: S[0].f, converged: conv };
    if (round === 1 && prev && prev.f <= best.f) best = Object.assign({}, prev, { converged: conv });
    if (evals >= maxit) break;
  }
  return { u: best.u, f: best.f, converged: !!best.converged, evaluations: evals };
}

export default { OPTIM_VERSION, brent, nelderMead };
