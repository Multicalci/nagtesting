// ============================================================================
// REPO PATH: api/material-balance.js
// ============================================================================
// multicalci.com — Material Balance Calculator (spec v5.2) — STEP 7
// THE ONE SERVERLESS FUNCTION: router, validation, CORS lock, throttle,
// Supabase picker proxy (with mb-data fallback), engine self-test, and
// fire-and-forget solve logging. All thermodynamics stay in api/_lib/.
//
// ROUTES
//   OPTIONS *                     → CORS preflight (204, allowed origins only)
//   GET  ?module=components       → components_picker view via Supabase REST
//                                   (service key, no SDK); on ANY failure fall
//                                   back to metadata derived from mb-data.js
//                                   merged with fluids.js physicals.
//                                   Cache-Control: public, max-age=86400.
//   GET  ?selftest=1              → engine smoke checks → {pass, fail, ms}
//   POST ?module={name}           → shape-validate body, throttle, dispatch to
//                                   MODULES[name] in mb-engine.js, wrap as
//                                   {ok, engine_version, copyright, warnings,
//                                    result}; errors as 400/429/500/504 with
//                                   {error:{code,message,field}}.
//
// MODULE DISPATCH CONTRACT (Step 8 solvers MUST follow this):
//   MODULES[name] is a function taking ONE argument { streams, params } in
//   base SI (kg/h, K, bar(a), kJ/h) and returning either a result object
//   (may carry `warnings:string[]` and convergence flags) or the standard
//   {error:{code,message,field}} envelope. It must NEVER throw.
//
// ENV VARS (Vercel project settings):
//   SUPABASE_URL          e.g. https://xyz.supabase.co   (no trailing slash)
//   SUPABASE_SERVICE_KEY  service-role key — server only, never in browser
//   IP_HASH_SALT          optional; salts the per-IP hash (recommended)
//
// PRIVACY: raw client IPs are never stored, logged, or hashed unsalted.
// Plain ES2020 / CommonJS. No dependencies. (c) multicalci.com
// ============================================================================

'use strict';

const crypto = require('crypto');
const engine = require('./_lib/mb-engine.js');
const mbData = require('./_lib/mb-data.js');
const fluids = require('./_lib/fluids.js');

const API_VERSION = 'material-balance api 1.0.0';
const COPYRIGHT = '(c) multicalci.com';

// ---------------------------------------------------------------------------
// tunables
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = [
  'https://multicalci.com',
  'https://www.multicalci.com',
];

const RATE_PER_MIN = 60;          // sustained solves per minute per IP
const BURST = 10;                 // token-bucket capacity (burst)
const REFILL_PER_MS = RATE_PER_MIN / 60000;   // tokens per millisecond
const BUCKET_IDLE_MS = 10 * 60 * 1000;        // drop buckets idle > 10 min
const BUCKET_SWEEP_EVERY = 200;               // lazy sweep cadence (requests)
const BUCKET_HARD_CAP = 20000;                // absolute Map size guard

const MAX_BODY_BYTES = 200 * 1024;  // request body ceiling
const MAX_STREAMS = 20;             // structural sanity caps (engine may be
const MAX_COMPONENTS = 30;          // stricter; these stop abuse early)

const SUPABASE_TIMEOUT_MS = 4000;   // picker fetch budget before fallback
const SOLVE_TIMEOUT_MS = 9000;      // async-solver budget before 504
const LOG_TIMEOUT_MS = 1500;        // fire-and-forget insert budget

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/**
 * Standard error envelope (spec convention).
 * @param {string} code
 * @param {string} message
 * @param {string} [field]
 * @returns {{error:{code:string,message:string,field:(string|undefined)}}}
 */
function errObj(code, message, field) {
  return { error: { code, message, field } };
}

/** @param {*} x @returns {boolean} finite number */
function num(x) { return typeof x === 'number' && isFinite(x); }

/**
 * Send a JSON response.
 * @param {object} res Node response
 * @param {number} status HTTP status
 * @param {object} payload body
 * @param {Object<string,string>} [headers] extra headers
 */
function sendJson(res, status, payload, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (headers) for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(payload));
}

/**
 * Send the standard error envelope.
 * @param {object} res
 * @param {number} status 400|405|429|500|504
 * @param {string} code
 * @param {string} message
 * @param {string} [field]
 * @param {Object<string,string>} [headers]
 */
function sendErr(res, status, code, message, field, headers) {
  sendJson(res, status, errObj(code, message, field), headers);
}

// ---------------------------------------------------------------------------
// CORS — echo the origin ONLY when allow-listed; never wildcard
// ---------------------------------------------------------------------------

/**
 * Apply CORS headers when the Origin header is allow-listed.
 * Non-browser clients (no Origin) are permitted; the browser lock is CORS's
 * job, abuse is the throttle's job.
 * @param {object} req
 * @param {object} res
 * @returns {boolean} true when Origin present AND allowed (or absent)
 */
function applyCors(req, res) {
  const origin = req.headers && req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return true;                       // curl / server-to-server
  if (!ALLOWED_ORIGINS.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

// ---------------------------------------------------------------------------
// per-IP throttle — token bucket in module-scope Map, lazily cleaned.
// Persists per warm serverless instance; cold starts reset it (accepted).
// ---------------------------------------------------------------------------

/** @type {Map<string, {tokens:number, last:number}>} */
const BUCKETS = new Map();
let bucketOpCount = 0;

/**
 * Best-effort client IP from proxy headers.
 * @param {object} req
 * @returns {string}
 */
function clientIp(req) {
  const h = req.headers || {};
  const xf = h['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  if (typeof h['x-real-ip'] === 'string') return h['x-real-ip'];
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Salted SHA-256 of the IP, truncated. The raw IP is never stored anywhere.
 * @param {string} ip
 * @returns {string} 16-hex-char hash
 */
function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || 'multicalci-mb-static-salt';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 16);
}

/** Lazily drop idle buckets; hard-cap the Map so memory cannot grow unbounded. */
function sweepBuckets(now) {
  bucketOpCount++;
  if (bucketOpCount % BUCKET_SWEEP_EVERY !== 0 && BUCKETS.size < BUCKET_HARD_CAP) return;
  for (const [k, b] of BUCKETS) {
    if (now - b.last > BUCKET_IDLE_MS) BUCKETS.delete(k);
  }
  if (BUCKETS.size >= BUCKET_HARD_CAP) BUCKETS.clear(); // pathological flood
}

/**
 * Token-bucket check: 60/min sustained, burst 10.
 * @param {string} ipHash
 * @returns {{allowed:boolean, retryAfterS:number}}
 */
function throttle(ipHash) {
  const now = Date.now();
  sweepBuckets(now);
  let b = BUCKETS.get(ipHash);
  if (!b) { b = { tokens: BURST, last: now }; BUCKETS.set(ipHash, b); }
  b.tokens = Math.min(BURST, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return { allowed: true, retryAfterS: 0 }; }
  const waitMs = (1 - b.tokens) / REFILL_PER_MS;
  return { allowed: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)) };
}

// ---------------------------------------------------------------------------
// Supabase REST (no SDK) — picker query + fire-and-forget log insert
// ---------------------------------------------------------------------------

/**
 * fetch() with an AbortController timeout.
 * @param {string} url
 * @param {object} opts fetch options
 * @param {number} ms timeout
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, Object.assign({}, opts, { signal: ctl.signal }))
    .finally(() => clearTimeout(timer));
}

/**
 * Query the components_picker VIEW via Supabase REST with the service key.
 * @returns {Promise<Array<object>>} rows (throws on any failure → caller
 * falls back to mb-data metadata)
 */
async function fetchPickerFromSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('supabase env vars missing');
  const endpoint = url.replace(/\/+$/, '') +
    '/rest/v1/components_picker' +
    '?select=key,name,formula,mw,category,nonvolatile,data_quality' +
    '&order=name.asc';
  const resp = await fetchWithTimeout(endpoint, {
    method: 'GET',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  }, SUPABASE_TIMEOUT_MS);
  if (!resp.ok) throw new Error('supabase status ' + resp.status);
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('supabase empty');
  return rows;
}

/**
 * Fallback picker metadata derived from mb-data.js keys, enriched with
 * name/formula/mw from fluids.js where the key exists there. Same 7-column
 * shape as the components_picker view — and, critically, NO coefficients.
 * @returns {Array<{key,name,formula,mw,category,nonvolatile,data_quality}>}
 */
function pickerFromLocal() {
  const rows = [];
  for (const key of mbData.keys()) {
    const cal = mbData.get(key) || {};
    const phys = fluids.get(key) || {};
    const sup = cal.supplement || {};
    rows.push({
      key,
      name: phys.name || sup.name || key,
      formula: phys.formula || sup.formula || null,
      mw: num(phys.mw) ? phys.mw : (num(sup.mw) ? sup.mw : null),
      category: phys.category || cal.category || 'other',
      nonvolatile: !!(phys.nonvolatile || sup.nonvolatile || cal.nonvolatile),
      data_quality: cal.data_quality || phys.data_quality || 'estimated',
    });
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return rows;
}

/**
 * Fire-and-forget insert into calculation_log. Never awaited by the request
 * path; every failure mode is swallowed. No raw IP, no payload, no result.
 * @param {string} moduleName
 * @param {boolean} ok
 * @param {number} ms
 * @param {string} ipHash
 * @returns {void}
 */
function logSolve(moduleName, ok, ms, ipHash) {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return;
    fetchWithTimeout(url.replace(/\/+$/, '') + '/rest/v1/calculation_log', {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        module: String(moduleName).slice(0, 60),
        ok: !!ok,
        ms: Math.round(ms),
        ip_hash: ipHash,
      }),
    }, LOG_TIMEOUT_MS).catch(() => { /* swallow */ });
  } catch (_e) { /* swallow — logging must never affect the response */ }
}

// ---------------------------------------------------------------------------
// request-body shape validation (structural only — deep thermo validation
// belongs to the engine, which returns its own {error:{...}} envelopes)
// ---------------------------------------------------------------------------

/**
 * Validate the POST body: { streams:[...], params:{...} } in base SI.
 * Each stream: { mass_flow_kg_h≥0, T_K>0, P_bar>0,
 *                components:[{key:string, mass_fraction:number}, ...] }.
 * @param {*} body
 * @returns {{streams:Array<object>, params:object}|{error:object}}
 */
function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errObj('MB_BODY', 'request body must be a JSON object', 'body');
  }
  if (!Array.isArray(body.streams) || body.streams.length === 0) {
    return errObj('MB_STREAMS', 'body.streams must be a non-empty array', 'streams');
  }
  if (body.streams.length > MAX_STREAMS) {
    return errObj('MB_STREAMS_MAX', `at most ${MAX_STREAMS} streams per solve`, 'streams');
  }
  for (let i = 0; i < body.streams.length; i++) {
    const s = body.streams[i];
    const at = `streams[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return errObj('MB_STREAM', `${at} must be an object`, at);
    }
    if (!num(s.mass_flow_kg_h) || s.mass_flow_kg_h < 0) {
      return errObj('MB_MASSFLOW', `${at}.mass_flow_kg_h must be a number ≥ 0 [kg/h]`, `${at}.mass_flow_kg_h`);
    }
    if (!num(s.T_K) || s.T_K <= 0) {
      return errObj('MB_T', `${at}.T_K must be a number > 0 [K]`, `${at}.T_K`);
    }
    if (!num(s.P_bar) || s.P_bar <= 0) {
      return errObj('MB_P', `${at}.P_bar must be a number > 0 [bar abs]`, `${at}.P_bar`);
    }
    if (!Array.isArray(s.components) || s.components.length === 0) {
      return errObj('MB_COMPONENTS', `${at}.components must be a non-empty array`, `${at}.components`);
    }
    if (s.components.length > MAX_COMPONENTS) {
      return errObj('MB_COMPONENTS_MAX', `${at}: at most ${MAX_COMPONENTS} components`, `${at}.components`);
    }
    for (let j = 0; j < s.components.length; j++) {
      const c = s.components[j];
      const cat = `${at}.components[${j}]`;
      if (!c || typeof c !== 'object' || typeof c.key !== 'string' || !c.key) {
        return errObj('MB_KEY', `${cat}.key must be a non-empty string`, `${cat}.key`);
      }
      if (!num(c.mass_fraction) || c.mass_fraction < 0) {
        return errObj('MB_MASSFRAC', `${cat}.mass_fraction must be a number ≥ 0`, `${cat}.mass_fraction`);
      }
      if (c.phase !== undefined &&
          !['gas', 'liquid', 'solid'].includes(c.phase)) {
        return errObj('MB_PHASE', `${cat}.phase must be gas|liquid|solid when given`, `${cat}.phase`);
      }
    }
  }
  const params = (body.params === undefined) ? {} : body.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return errObj('MB_PARAMS', 'body.params must be an object when given', 'params');
  }
  return { streams: body.streams, params };
}

/**
 * Read + JSON-parse the request body with a byte cap. Vercel usually
 * pre-parses JSON into req.body; both paths are handled.
 * @param {object} req
 * @returns {Promise<*>} parsed body, or {error:{...}} envelope
 */
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (req.body.length > MAX_BODY_BYTES) {
        return errObj('MB_BODY_SIZE', 'request body too large', 'body');
      }
      try { return JSON.parse(req.body); }
      catch (_e) { return errObj('MB_JSON', 'request body is not valid JSON', 'body'); }
    }
    return req.body; // already parsed by the platform
  }
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (ch) => {
      size += ch.length;
      if (size > MAX_BODY_BYTES) {
        resolve(errObj('MB_BODY_SIZE', 'request body too large', 'body'));
        req.destroy();
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return; // already resolved
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve(errObj('MB_BODY', 'request body required', 'body')); return; }
      try { resolve(JSON.parse(raw)); }
      catch (_e) { resolve(errObj('MB_JSON', 'request body is not valid JSON', 'body')); }
    });
    req.on('error', () => resolve(errObj('MB_BODY', 'failed to read request body', 'body')));
  });
}

// ---------------------------------------------------------------------------
// route handlers
// ---------------------------------------------------------------------------

/**
 * GET ?module=components — Supabase view, else local fallback; cached 24 h.
 * @param {object} res
 */
async function handleComponents(res) {
  const headers = { 'Cache-Control': 'public, max-age=86400' };
  let components;
  let source = 'supabase';
  try {
    components = await fetchPickerFromSupabase();
  } catch (_e) {
    components = pickerFromLocal();
    source = 'fallback';
  }
  sendJson(res, 200, {
    ok: true,
    api_version: API_VERSION,
    copyright: COPYRIGHT,
    source,
    count: components.length,
    components,
  }, headers);
}

/**
 * GET ?selftest=1 — engine smoke checks.
 * @param {object} res
 */
function handleSelftest(res) {
  const t0 = Date.now();
  let st;
  try {
    st = engine.selfTest();
  } catch (e) {
    sendErr(res, 500, 'MB_SELFTEST_THROW', 'selfTest threw: ' + e.message);
    return;
  }
  const ms = Date.now() - t0;
  const results = Array.isArray(st.results) ? st.results : [];
  const passN = results.filter((r) => r.ok).length;
  sendJson(res, 200, {
    ok: !!st.pass,
    engine_version: engine.ENGINE_VERSION,
    api_version: API_VERSION,
    copyright: COPYRIGHT,
    pass: passN,
    fail: results.length - passN,
    ms,
    results,
  }, { 'Cache-Control': 'no-store' });
}

/**
 * POST ?module={name} — throttle, validate, dispatch, wrap, log.
 * @param {object} req
 * @param {object} res
 * @param {string} moduleName
 * @param {string} ipHash
 */
async function handleSolve(req, res, moduleName, ipHash) {
  // ---- throttle (solves only) ----
  const gate = throttle(ipHash);
  if (!gate.allowed) {
    sendErr(res, 429, 'MB_RATE_LIMIT',
      `rate limit exceeded (${RATE_PER_MIN}/min, burst ${BURST}) — retry in ${gate.retryAfterS}s`,
      undefined, { 'Retry-After': String(gate.retryAfterS) });
    return;
  }

  // ---- module lookup ----
  const solver = engine.MODULES && engine.MODULES[moduleName];
  if (typeof solver !== 'function') {
    const known = Object.keys(engine.MODULES || {});
    sendErr(res, 400, 'MB_UNKNOWN_MODULE',
      `unknown module '${moduleName}'` +
      (known.length ? ` — available: ${known.join(', ')}` : ' — no solver modules registered yet'),
      'module');
    return;
  }

  // ---- body shape ----
  const body = await readBody(req);
  if (body && body.error) { sendJson(res, 400, body); return; }
  const shaped = validateBody(body);
  if (shaped.error) { sendJson(res, 400, shaped); return; }

  // ---- dispatch (solvers must not throw; belt-and-braces try/race) ----
  const t0 = Date.now();
  let result;
  try {
    result = solver({ streams: shaped.streams, params: shaped.params });
    if (result && typeof result.then === 'function') {
      result = await Promise.race([
        result,
        new Promise((_r, rej) => setTimeout(
          () => rej(new Error('SOLVE_TIMEOUT')), SOLVE_TIMEOUT_MS)),
      ]);
    }
  } catch (e) {
    const ms = Date.now() - t0;
    logSolve(moduleName, false, ms, ipHash);
    if (e && e.message === 'SOLVE_TIMEOUT') {
      sendErr(res, 504, 'MB_TIMEOUT', `solver '${moduleName}' exceeded ${SOLVE_TIMEOUT_MS} ms`);
    } else {
      sendErr(res, 500, 'MB_ENGINE_THROW', 'engine exception: ' + (e && e.message));
    }
    return;
  }
  const ms = Date.now() - t0;

  // ---- engine-reported input/convergence error → 400 ----
  if (result && result.error) {
    logSolve(moduleName, false, ms, ipHash);
    sendJson(res, 400, result);
    return;
  }
  if (result === undefined || result === null) {
    logSolve(moduleName, false, ms, ipHash);
    sendErr(res, 500, 'MB_EMPTY_RESULT', `solver '${moduleName}' returned nothing`);
    return;
  }

  // ---- success envelope ----
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  logSolve(moduleName, true, ms, ipHash);
  sendJson(res, 200, {
    ok: true,
    engine_version: engine.ENGINE_VERSION,
    api_version: API_VERSION,
    copyright: COPYRIGHT,
    module: moduleName,
    ms,
    warnings,
    result,
  }, { 'Cache-Control': 'no-store' });
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Vercel Node serverless handler.
 * @param {object} req IncomingMessage (+ req.query / req.body on Vercel)
 * @param {object} res ServerResponse
 */
module.exports = async function handler(req, res) {
  try {
    const corsOk = applyCors(req, res);

    // Preflight
    if (req.method === 'OPTIONS') {
      res.statusCode = corsOk ? 204 : 403;
      res.end();
      return;
    }
    if (!corsOk) {
      // Disallowed browser origin: no ACAO header is the real lock; the 403
      // body just makes server-side probing unambiguous.
      sendErr(res, 403, 'MB_ORIGIN', 'origin not allowed');
      return;
    }

    // Query params (Vercel provides req.query; fall back to manual parse)
    let q = req.query;
    if (!q) {
      const u = new URL(req.url, 'http://localhost');
      q = Object.fromEntries(u.searchParams.entries());
    }

    if (req.method === 'GET') {
      if (q.selftest === '1' || q.selftest === 'true') { handleSelftest(res); return; }
      if (q.module === 'components') { await handleComponents(res); return; }
      sendErr(res, 400, 'MB_ROUTE',
        'GET supports ?module=components or ?selftest=1', 'module');
      return;
    }

    if (req.method === 'POST') {
      const moduleName = typeof q.module === 'string' ? q.module.trim() : '';
      if (!moduleName || moduleName === 'components' || !/^[a-z0-9_-]{1,40}$/i.test(moduleName)) {
        sendErr(res, 400, 'MB_MODULE', 'POST requires ?module={solver-name}', 'module');
        return;
      }
      const ipHash = hashIp(clientIp(req));
      await handleSolve(req, res, moduleName, ipHash);
      return;
    }

    sendErr(res, 405, 'MB_METHOD', `method ${req.method} not supported`, undefined,
      { Allow: 'GET, POST, OPTIONS' });
  } catch (e) {
    // Last-resort guard: the router itself must never crash the function.
    try { sendErr(res, 500, 'MB_INTERNAL', 'internal error: ' + (e && e.message)); }
    catch (_e2) { /* response already gone */ }
  }
};
