// ============================================================================
// REPO PATH: tests/run-tests.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — TEST HARNESS
// Zero-dependency Node runner. Loads tests/mb-vectors.json and executes each
// vector against api/_lib/mb-engine.js, printing PASS/FAIL with actual vs
// expected and the tolerance applied. Exit code 0 = all pass, 1 = failures.
//
// Run from anywhere:   node tests/run-tests.js
// Filter by id:        node tests/run-tests.js MB-007 MB-013
// Verbose (warnings):  node tests/run-tests.js --verbose
//
// VECTOR SCHEMA (tests/mb-vectors.json → { meta, vectors:[...] }):
//   {
//     id     : "MB-001",
//     desc   : "human description",
//     call   : engine export name | "combine" | "solveT_roundtrip",
//     args   : array (positional args for plain calls)  — or, for the two
//              composite calls, an object (see below),
//     expect : { "<dotted.path>": number|string|boolean, ... },
//     tol    : number (absolute, applied to every numeric expect)
//              | { "<dotted.path>": number, "default": number },
//     source : provenance of the expected value (NIST / steam tables / ...)
//   }
//
// COMPOSITE CALLS (keep vectors declarative, no code in JSON):
//   "combine"          args: { terms:[{ fn, args, field, coef }, ...] }
//                      result: { value: Σ coef·result[field] } — used for
//                      enthalpy deltas and reaction ΔH from stream enthalpies.
//   "solveT_roundtrip" args: { stream, T_true, Tlo, Thi }
//                      Runs streamEnthalpy at T_true, feeds H into
//                      solveT_forH over [Tlo,Thi]; result is the solver
//                      output (expect targets T_K / converged / iterations).
//
// Plain ES2020 / CommonJS. No dependencies. (c) multicalci.com
// ============================================================================

'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const engine = require(path.join(ROOT, 'api', '_lib', 'mb-engine.js'));
const VECTOR_FILE = path.join(__dirname, 'mb-vectors.json');

const DEFAULT_TOL = 1e-6;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** @param {*} x @returns {boolean} finite number check */
function num(x) { return typeof x === 'number' && isFinite(x); }

/**
 * Resolve a dotted path ("error.code", "h_kJmol") in an object.
 * @param {object} obj
 * @param {string} p
 * @returns {*} value or undefined
 */
function getPath(obj, p) {
  let cur = obj;
  for (const seg of p.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Tolerance for one expect path: per-path override > "default" key > scalar
 * tol > DEFAULT_TOL.
 * @param {number|object|undefined} tol vector tol field
 * @param {string} p expect path
 * @returns {number}
 */
function tolFor(tol, p) {
  if (num(tol)) return tol;
  if (tol && typeof tol === 'object') {
    if (num(tol[p])) return tol[p];
    if (num(tol.default)) return tol.default;
  }
  return DEFAULT_TOL;
}

/** Compact value formatter for the report line. */
function fmt(v) {
  if (num(v)) {
    const a = Math.abs(v);
    if (v === 0) return '0';
    if (a >= 1e6 || a < 1e-3) return v.toExponential(6);
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (v === undefined) return 'undefined';
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// call dispatch — plain engine calls + the two composite kinds
// ---------------------------------------------------------------------------

/**
 * Execute one vector's call and return the raw result object (or an
 * {error:{...}} envelope, or a thrown-error envelope).
 * @param {object} vec vector from mb-vectors.json
 * @returns {object}
 */
function execute(vec) {
  try {
    if (vec.call === 'combine') {
      const terms = vec.args && vec.args.terms;
      if (!Array.isArray(terms) || terms.length === 0) {
        return { error: { code: 'HARNESS_BAD_VECTOR', message: 'combine requires args.terms[]' } };
      }
      let sum = 0;
      const warnings = [];
      for (const t of terms) {
        const fn = engine[t.fn];
        if (typeof fn !== 'function') {
          return { error: { code: 'HARNESS_NO_FN', message: `engine has no export '${t.fn}'` } };
        }
        const r = fn.apply(null, t.args || []);
        if (r && r.error) {
          return { error: { code: 'HARNESS_SUBCALL', message: `${t.fn}(${JSON.stringify(t.args)}) → ${r.error.code}: ${r.error.message}` } };
        }
        const v = getPath(r, t.field || 'h_kJmol');
        if (!num(v)) {
          return { error: { code: 'HARNESS_FIELD', message: `${t.fn}: field '${t.field}' is not numeric` } };
        }
        sum += (num(t.coef) ? t.coef : 1) * v;
        if (Array.isArray(r.warnings)) warnings.push(...r.warnings);
      }
      return { value: sum, warnings };
    }

    if (vec.call === 'solveT_roundtrip') {
      const a = vec.args || {};
      if (!a.stream || !num(a.T_true) || !num(a.Tlo) || !num(a.Thi)) {
        return { error: { code: 'HARNESS_BAD_VECTOR', message: 'solveT_roundtrip requires args {stream, T_true, Tlo, Thi}' } };
      }
      const fwd = engine.streamEnthalpy(Object.assign({}, a.stream, { T_K: a.T_true }));
      if (fwd.error) {
        return { error: { code: 'HARNESS_FORWARD', message: `streamEnthalpy at T_true failed: ${fwd.error.code}: ${fwd.error.message}` } };
      }
      const inv = engine.solveT_forH(a.stream, fwd.H_kJh, a.Tlo, a.Thi);
      if (inv.error) return inv;
      inv.H_forward_kJh = fwd.H_kJh; // for the report
      return inv;
    }

    const fn = engine[vec.call];
    if (typeof fn !== 'function') {
      return { error: { code: 'HARNESS_NO_FN', message: `engine has no export '${vec.call}'` } };
    }
    return fn.apply(null, Array.isArray(vec.args) ? vec.args : []);
  } catch (e) {
    return { error: { code: 'HARNESS_THROW', message: `call threw: ${e.message}` } };
  }
}

// ---------------------------------------------------------------------------
// check one vector
// ---------------------------------------------------------------------------

/**
 * Compare a result against a vector's expect map.
 * @param {object} vec
 * @param {object} result
 * @returns {{pass:boolean, lines:string[], warnings:string[]}}
 */
function check(vec, result) {
  const lines = [];
  let pass = true;
  const expectsError = Object.keys(vec.expect).some((k) => k.startsWith('error.'));

  if (result && result.error && !expectsError) {
    return {
      pass: false,
      lines: [`unexpected error → ${result.error.code}: ${result.error.message}`],
      warnings: [],
    };
  }

  for (const [p, want] of Object.entries(vec.expect)) {
    const got = getPath(result, p);
    if (num(want)) {
      const tol = tolFor(vec.tol, p);
      const ok = num(got) && Math.abs(got - want) <= tol;
      if (!ok) pass = false;
      lines.push(`${p}: actual=${fmt(got)} expected=${fmt(want)} tol=±${fmt(tol)} ${ok ? '✓' : '✗'}`);
    } else {
      const ok = got === want;
      if (!ok) pass = false;
      lines.push(`${p}: actual=${fmt(got)} expected=${fmt(want)} ${ok ? '✓' : '✗'}`);
    }
  }
  return { pass, lines, warnings: (result && result.warnings) || [] };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.includes('--verbose');
  const idFilter = argv.filter((a) => !a.startsWith('--'));

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  } catch (e) {
    console.error(`FATAL: cannot load ${VECTOR_FILE}: ${e.message}`);
    process.exit(1);
  }
  const vectors = (doc.vectors || []).filter(
    (v) => idFilter.length === 0 || idFilter.includes(v.id),
  );
  if (vectors.length === 0) {
    console.error('FATAL: no vectors matched');
    process.exit(1);
  }

  console.log('============================================================');
  console.log(`mb-engine test harness — ${engine.ENGINE_VERSION}`);
  console.log(`vectors: ${vectors.length}  (${doc.meta ? doc.meta.version : 'no meta'})`);
  console.log('============================================================');

  let passed = 0;
  const failures = [];

  for (const vec of vectors) {
    const result = execute(vec);
    const { pass, lines, warnings } = check(vec, result);
    if (pass) passed++;
    else failures.push(vec.id);

    console.log(`${pass ? 'PASS' : 'FAIL'}  ${vec.id}  ${vec.desc}`);
    for (const l of lines) console.log(`      ${l}`);
    if (!pass || verbose) {
      if (vec.source) console.log(`      source: ${vec.source}`);
      for (const w of warnings) console.log(`      warn: ${w}`);
    }
  }

  console.log('------------------------------------------------------------');
  console.log(`${passed}/${vectors.length} passed${failures.length ? '  FAILED: ' + failures.join(', ') : ''}`);
  console.log('------------------------------------------------------------');
  process.exit(failures.length ? 1 : 0);
}

main();
