// ════════════════════════════════════════════════════════════════════════════
// api/_lib/hazop-engine.js
// HAZOP WORKSHEET ENGINE — served at /api/hazop through api/materials-utilities.js
//
// Turns a node description (equipment type, fluid hazard, phase, ticked features)
// into draft HAZOP rows: causes ranked by typical frequency, consequences for the
// fluid, credited safeguards, likelihood before / with safeguards, and the
// recommendations raised by missing safeguards.
//
// The library (causes, rules, frequencies, credits) stays on the server. It is read from
//   1. the HAZOP_LIBRARY environment variable (gzip + base64 JSON from build_library.py --private), or
//   2. api/_lib/hazop-library.js (written by build_library.py).
// The page only receives display labels (meta) and the rows for the node it asks about.
//
// Protocol: POST /api/hazop  { op: 'meta' }
//                            { op: 'build',   node: { eq, fluids, phase, feats } }
//                            { op: 'options', node, dk, used: [cause text, ...] }
// ════════════════════════════════════════════════════════════════════════════
import zlib from 'node:zlib';
import BUNDLED from './hazop-library.js';

const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://www.multicalci.com';
const ALLOWED_ORIGINS = new Set([ORIGIN, 'https://www.multicalci.com', 'https://www.multicalci.com', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const RATE_MAX = parseInt(process.env.HAZOP_RATE_LIMIT || '120', 10);   // requests per IP per window, per instance
const RATE_WINDOW_MS = 10 * 60 * 1000;

// ─── library ────────────────────────────────────────────────────────────────
let LIB = null, IDX = null, LIB_ERR = '';
function lib() {
  if (LIB) return LIB;
  const env = process.env.HAZOP_LIBRARY;
  LIB_ERR = '';
  if (env) {
    // tolerate quotes, spaces and line breaks picked up while pasting into Vercel
    try { LIB = JSON.parse(zlib.gunzipSync(Buffer.from(env.replace(/["'\s]/g, ''), 'base64')).toString('utf8')); }
    catch (e) { LIB = null; LIB_ERR = 'HZ-2: the library setting on the server could not be read.'; }
  }
  if (!LIB && BUNDLED && BUNDLED.EQ) LIB = BUNDLED;
  if (!LIB && !LIB_ERR) LIB_ERR = 'HZ-1: the library setting was not found on the server.';
  if (LIB) {
    IDX = { eq: {}, fluid: {} };
    LIB.EQ.forEach((e) => { IDX.eq[e.id] = e; });
    LIB.FLUIDS.forEach((f) => { IDX.fluid[f.id] = f; });
  }
  return LIB;
}

// ─── rules ──────────────────────────────────────────────────────────────────
function featSet(node) {
  const F = {};
  node.feats.forEach((f) => { F[f] = 1; });
  if (node.phase === 'liquid') F.liquid = 1;
  else if (node.phase === 'gas') F.gas = 1;
  else if (node.phase === 'two') { F.liquid = 1; F.gas = 1; F.two = 1; }
  return F;
}
const hasFluid = (node, list) => list.some((x) => node.fluids.includes(x));

function eligible(c, node, F) {
  if (c.q && !c.q.every((x) => F[x])) return false;
  if (c.qa && !c.qa.some((x) => F[x])) return false;
  if (c.x && c.x.some((x) => F[x])) return false;
  if (c.fl && !hasFluid(node, c.fl)) return false;
  return true;
}
function reqLabel(x) {
  const f = LIB.FEAT[x];
  if (f) return f.l;
  return { liquid: 'liquid phase', gas: 'gas phase', two: 'two-phase / liquefied gas' }[x] || x;
}
const fluidShort = (id) => (IDX.fluid[id] ? IDX.fluid[id].l.split(' (')[0] : id);
function whyNot(c, node, F) {
  const m = [];
  (c.q || []).forEach((x) => { if (!F[x]) m.push(reqLabel(x)); });
  if (c.qa && !c.qa.some((x) => F[x])) m.push(c.qa.filter((x) => LIB.FEAT[x]).map(reqLabel).join(' or '));
  (c.x || []).forEach((x) => { if (F[x]) m.push('not relevant with: ' + reqLabel(x)); });
  if (c.fl && !hasFluid(node, c.fl)) m.push(c.fl.map(fluidShort).join(' or ') + ' fluid');
  return m;
}
const likFromF = (f) => (f >= 1 ? 5 : f >= 0.1 ? 4 : f >= 0.01 ? 3 : f >= 0.001 ? 2 : 1);
const devsOf = (eq) => eq.devs.concat(eq.others.map((o) => LIB.OTHERS[o]).filter(Boolean));
const devKey = (d) => d.g + '|' + d.p;

function causeRow(node, d, c, F) {
  const rel = c.rel != null ? !!c.rel : !!d.rel;
  const lf = c.lf != null ? !!c.lf : !!d.lf;
  const parts = [];
  if (c.c) parts.push(c.c);
  if (d.c && d.c !== c.c) parts.push(d.c);
  let sev = c.sev || d.sev || 2;
  if (rel) {
    let hz = node.fluids.filter((x) => x !== 'nonhaz');
    if (!hz.length) hz = ['nonhaz'];
    hz.forEach((id) => { const f = IDX.fluid[id]; if (f) { parts.push(f.rel); sev = Math.max(sev, f.sev); } });
  }
  if (lf && F.critical) { parts.push('Loss of a safety-critical function downstream.'); sev = Math.max(sev, 4); }
  const sg = [];
  let credit = 0, alarm = 0;
  (c.sg || []).forEach((x) => {
    const ft = LIB.FEAT[x];
    if (!F[x] || !ft || !ft.sg || sg.includes(ft.sg)) return;
    sg.push(ft.sg);
    if (ft.ipl === 'a') alarm = 1; else if (ft.ipl) credit += ft.ipl;
  });
  credit = Math.min(3, credit + alarm);
  const recs = [];
  (c.r || []).forEach((r) => {
    if (r.h && !r.h.every((x) => F[x])) return;
    if (r.l && r.l.some((x) => F[x])) return;
    if (r.fl && !hasFluid(node, r.fl)) return;
    recs.push(r.t);
  });
  const l = likFromF(c.f);
  return {
    dk: devKey(d), g: d.g, p: d.p, cause: c.t, cons: parts.join(' '), sg: sg.length ? sg.join('; ') + '.' : '--',
    s: Math.min(5, sev), l, l2: Math.max(1, l - credit), rec: recs.length ? recs.join(' ') : '--', gen: recs.length > 0,
    k: c.k, f: c.f, calc: c.calc || '', src: c.t,
  };
}
const naRow = (d, t) => ({ dk: devKey(d), g: d.g, p: d.p, na: true, cause: t, cons: '', sg: '', s: 0, l: 0, l2: 0, rec: '', gen: false });

export function buildRows(node) {
  const eq = IDX.eq[node.eq], F = featSet(node), rows = [];
  devsOf(eq).forEach((d) => {
    if (d.na) { rows.push(naRow(d, d.na)); return; }
    const cs = d.cs.filter((c) => eligible(c, node, F)).sort((a, b) => b.f - a.f);
    if (!cs.length) { rows.push(naRow(d, 'Not applicable for the selected configuration (see node features).')); return; }
    cs.forEach((c) => rows.push(causeRow(node, d, c, F)));
  });
  return rows;
}

export function options(node, dk, used) {
  const eq = IDX.eq[node.eq], F = featSet(node);
  const d = devsOf(eq).find((x) => devKey(x) === dk);
  if (!d || d.na) return [];
  const u = new Set(used);
  return d.cs.filter((c) => !u.has(c.t))
    .map((c) => ({ ok: eligible(c, node, F), why: whyNot(c, node, F), row: causeRow(node, d, c, F) }))
    .sort((a, b) => (b.ok - a.ok) || (b.row.f - a.row.f));
}

export function meta() {
  const L = LIB, FEAT = {};
  Object.keys(L.FEAT).forEach((k) => { FEAT[k] = { g: L.FEAT[k].g, l: L.FEAT[k].l }; });
  return {
    version: L.version, CATS: L.CATS, GROUPS: L.GROUPS, PHASES: L.PHASES, CALC: L.CALC, SEV: L.SEV, LIK: L.LIK, FEAT,
    FLUIDS: L.FLUIDS.map((f) => ({ id: f.id, l: f.l })),
    EQ: L.EQ.map((e) => ({ id: e.id, l: e.l, d: e.d, feats: e.feats })),
  };
}

// ─── input checks ──────────────────────────────────────────────────────────
export function cleanNode(n) {
  if (!n || typeof n !== 'object') return { error: 'node is missing' };
  const eq = IDX.eq[String(n.eq || '')];
  if (!eq) return { error: 'unknown equipment type' };
  const fluids = (Array.isArray(n.fluids) ? n.fluids : []).map(String).filter((x) => IDX.fluid[x]).slice(0, 12);
  if (!fluids.length) return { error: 'choose at least one fluid hazard' };
  const phase = ['liquid', 'gas', 'two'].includes(n.phase) ? n.phase : 'liquid';
  const feats = [...new Set((Array.isArray(n.feats) ? n.feats : []).map(String).filter((x) => eq.feats.includes(x)))];
  return { eq: eq.id, fluids, phase, feats };
}

// ─── best-effort rate limit (per serverless instance) ──────────────────────
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.t > RATE_WINDOW_MS) { hits.set(ip, { t: now, n: 1 }); }
  else if (++h.n > RATE_MAX) return true;
  if (hits.size > 5000) { for (const [k, v] of hits) if (now - v.t > RATE_WINDOW_MS) hits.delete(k); }
  return false;
}

// ─── HTTP route ────────────────────────────────────────────────────────────
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export async function hazopRoute(req, res) {
  const origin = req.headers.origin || '';
  const okOrigin = !origin || ALLOWED_ORIGINS.has(origin) || /^https:\/\/nagtesting[a-z0-9-]*\.vercel\.app$/.test(origin);
  res.setHeader('Access-Control-Allow-Origin', okOrigin && origin ? origin : ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (!okOrigin) return send(res, 403, { error: 'This API serves the multicalci.com HAZOP worksheet only.' });
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, { error: 'Too many requests. Wait a few minutes and try again.' });

  let body;
  try {
    body = req.body;                                   // Vercel parses JSON bodies; plain Node leaves it undefined
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    if (!body || typeof body !== 'object') body = req.readableEnded ? {} : await readJson(req);
  } catch (e) {
    return send(res, 400, { error: 'Invalid JSON body' });
  }

  if (!lib()) return send(res, 503, { error: 'HAZOP library is not configured on the server (' + LIB_ERR + ')' });
  const op = String(body.op || '').slice(0, 16);
  try {
    if (op === 'meta') return send(res, 200, meta());
    if (op === 'build' || op === 'options') {
      const node = cleanNode(body.node);
      if (node.error) return send(res, 422, { error: node.error });
      if (op === 'build') return send(res, 200, { version: LIB.version, rows: buildRows(node) });
      const used = (Array.isArray(body.used) ? body.used : []).map(String).slice(0, 200);
      return send(res, 200, { version: LIB.version, options: options(node, String(body.dk || '').slice(0, 120), used) });
    }
    return send(res, 400, { error: 'Unknown op. Valid: meta, build, options' });
  } catch (e) {
    return send(res, 500, { error: 'HAZOP engine error' });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 100000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
