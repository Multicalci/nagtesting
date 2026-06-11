/**
 * /api/boq.js — Universal BOQ Calculator engine (Step 7: IP-isolated)
 * ---------------------------------------------------------------------------
 * SECURITY MODEL (do not weaken):
 *   - The 114 schemas live ONLY in api/schemas.bundle.json, read server-side
 *     here. Files in /api are never served as static routes and must NEVER be
 *     copied to any public folder or imported by client scripts.
 *   - The browser receives ONLY: search hits (item name + schema id + stream),
 *     a stripped render-only form projection, and computed RESULTS.
 *   - NEVER returned by any code path: base rates, rate tables, formulas,
 *     multiplier tables, historical anchors, compliance condition expressions.
 *   - No browse-all endpoint exists. Discovery is search-only (min 3 chars,
 *     max 12 hits) so bulk catalogue extraction is impractical.
 *   - Totals are rounded to 3 significant figures, which is appropriate for
 *     +-10/20/30% estimate tiers and frustrates rate-table reconstruction.
 *
 * Zero external dependencies. Node 18+ (Vercel serverless).
 * Step 8 hook: replace CURRENT_INDICES with a Supabase fetch.
 */
"use strict";

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// SERVER-ONLY data, loaded from the same /api directory (never a public route):
const SCHEMAS = JSON.parse(readFileSync(path.join(__dirname, "schemas.bundle.json"), "utf8"));
const SEARCH_INDEX = JSON.parse(readFileSync(path.join(__dirname, "search_index.json"), "utf8"));

// --- Step 8 hook: live indices come from Supabase later. Base = factor 1.0 today.
const CURRENT_INDICES = { CEPCI: 816, ENR_CCI: 14250, MARKET_RATES: 1 };
const BASE_INDICES    = { CEPCI: 816, ENR_CCI: 14250, MARKET_RATES: 1 };

/* ============================ rate limiting ================================
 * In-memory per serverless instance (resets on cold start — acceptable for
 * Step 7; harden with Upstash Redis in production if abuse is observed).
 * Limits: search 20/min, form 30/min, calc 60/min per IP.
 * Enumeration guard: an IP touching > 40 DISTINCT schemas within 10 minutes
 * is blocked for 10 minutes and the event is logged for review (plan 7.4).
 */
const buckets = new Map();
const LIMITS = { search: 20, form: 30, calc: 60, streams: 10 };
const ENUM_SCHEMA_CAP = 40, ENUM_WINDOW_MS = 600000, BLOCK_MS = 600000;

function gate(ip, action, schemaId) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { counts: {}, winStart: now, schemas: new Map(), blockUntil: 0 }; buckets.set(ip, b); }
  if (now < b.blockUntil) return false;
  if (now - b.winStart > 60000) { b.counts = {}; b.winStart = now; }
  b.counts[action] = (b.counts[action] || 0) + 1;
  if (b.counts[action] > (LIMITS[action] || 20)) return false;
  if (schemaId) {
    b.schemas.set(schemaId, now);
    for (const [k, t] of b.schemas) if (now - t > ENUM_WINDOW_MS) b.schemas.delete(k);
    if (b.schemas.size > ENUM_SCHEMA_CAP) {
      b.blockUntil = now + BLOCK_MS;
      console.warn(`[boq][enum-guard] ip=${ip} touched ${b.schemas.size} schemas in 10min — blocked 10min`);
      return false;
    }
  }
  if (buckets.size > 5000) buckets.clear(); // memory guard
  return true;
}

/* ============================== search ==================================== */
function doSearch(q, stream) {
  q = String(q || "").trim().toLowerCase();
  if (q.length < 3) return { error: "Type at least 3 characters to search." };
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const hits = [];
  for (const e of SEARCH_INDEX) {
    if (stream && e.c !== stream) continue;
    const n = e.i.toLowerCase();
    if (terms.every(t => n.includes(t))) {
      hits.push({ item: e.i, schema_id: e.s, stream: e.c });
      if (hits.length >= 12) break;
    }
  }
  return { results: hits, capped: hits.length >= 12 };
}

/* ====================== form projection (render-only) =====================
 * ONLY these keys leave the server. Nothing cost-bearing.                    */
function projectForm(sid) {
  const s = SCHEMAS[sid];
  if (!s) return null;
  return {
    schema_id: sid,
    name: s.template_name || sid.replace("SCHEMA-", ""),
    stream: s.stream || "",
    item_type: s.item_type || "",
    tier_note: (s.tier_summary && s.tier_summary.note) || "",
    fields: (s.fields || []).map(f => ({
      field_id: f.field_id,
      spec_key: f.spec_key || f.field_id,
      label: f.label,
      type: f.type,
      unit: f.unit || null,
      tier: f.tier || 1,
      mandatory: !!f.mandatory,
      section: f.section || "Inputs",
      ...(f.type === "dropdown" ? { options: f.options || [] } : {})
    }))
  };
}

/* ===================== compliance evaluation (server) ======================
 * Python-style condition_expr -> sandboxed JS. The EXPRESSION never leaves
 * the server; only severity + message of triggered rules are returned.       */
function evalCondition(expr, inputs) {
  if (typeof expr !== "string" || !expr.trim() || expr.includes("TODO")) return false;
  const lits = [];
  let e = expr.replace(/'[^']*'|"[^"]*"/g, m => { lits.push(m.slice(1, -1)); return `__L${lits.length - 1}__`; });
  e = e
    .replace(/\bIS\s+not\s+None\b/gi, " != null").replace(/\bIS\s+None\b/gi, " == null")
    .replace(/\bNOT\s+IN\b/gi, " __NIN__ ").replace(/\bnot\s+IN\b/g, " __NIN__ ")
    .replace(/\bAND\b/g, " && ").replace(/\bOR\b/g, " || ").replace(/\bNOT\b/g, " ! ")
    .replace(/\btrue\b/g, "true").replace(/\bTrue\b/g, "true")
    .replace(/\bfalse\b/g, "false").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null");
  // membership: X IN [..] | lit IN field | field IN field
  e = e.replace(/(__L\d+__|[A-Za-z_]\w*)\s+(__NIN__|IN)\s+(\[[^\]]*\])/g,
        (_, x, op, arr) => `${op === "__NIN__" ? "!" : ""}${arr}.includes(${x})`)
       .replace(/(__L\d+__|[A-Za-z_]\w*)\s+(__NIN__|IN)\s+([A-Za-z_]\w*)/g,
        (_, x, op, f) => `${op === "__NIN__" ? "!" : ""}String(${f} == null ? "" : ${f}).includes(${x})`);
  e = e.replace(/__L(\d+)__/g, (_, i) => JSON.stringify(lits[+i]));
  if (/[^\w\s<>=!&|()+\-*/.,'"\[\]]/.test(e.replace(/"(?:[^"\\]|\\.)*"/g, ""))) return false; // whitelist
  try {
    const ctx = new Proxy({}, { has: () => true,
      get: (_, k) => (k === Symbol.unscopables ? undefined :
        Object.prototype.hasOwnProperty.call(inputs, k) ? coerce(inputs[k]) : null) });
    // eslint-disable-next-line no-new-func
    return !!Function("ctx", `with(ctx){ return (${e}); }`)(ctx);
  } catch { return false; }
}
function coerce(v) {
  if (v === "" || v == null) return null;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return v;
}

/* ============================= cost engine ================================ */
function sig3(x) {
  if (!isFinite(x) || x === 0) return 0;
  const m = Math.pow(10, 2 - Math.floor(Math.log10(Math.abs(x))));
  return Math.round(x * m) / m;
}
function pickItem(s, inputs) {
  const items = ((s.cost_build_up || {}).usd_cost_baseline || {}).items || {};
  const want = inputs.equipment_subtype || inputs.activity_subtype;
  if (want && items[want]) return [want, items[want]];
  if (want) {
    const k = Object.keys(items).find(k => k.toLowerCase() === String(want).toLowerCase());
    if (k) return [k, items[k]];
  }
  const k0 = Object.keys(items)[0];
  return k0 ? [k0, items[k0]] : [null, null];
}
function regionalFactor(s, region, sub) {
  const cb = s.cost_build_up || {};
  const ri = ((cb.regional_cost_index || {}).regional_index) || {};
  let f = (ri[region] && Number(ri[region].factor)) || 1;
  let sf = 1;
  try {
    const r = (((cb.regional_factors || {}).regions) || {})[region];
    const srv = r && r.sub_regions && sub ? r.sub_regions[sub] : null;
    if (typeof srv === "number") sf = srv;
    else if (srv && typeof srv === "object") {
      const n = Object.values(srv).find(v => typeof v === "number");
      if (n) sf = n;
    }
  } catch { /* default 1 */ }
  return { f, sf };
}
function multiplierFactors(s, inputs, tier) {
  const out = [];
  if (tier < 2) return { factor: 1, applied: out };
  const tables = (s.cost_build_up || {}).cost_multiplier_tables;
  if (!tables || typeof tables !== "object") return { factor: 1, applied: out };
  let factor = 1;
  for (const [tname, table] of Object.entries(tables)) {
    if (!table || typeof table !== "object") continue;
    const stem = tname.replace(/_factor.*/, "").toLowerCase();
    const inKey = Object.keys(inputs).find(k => k.toLowerCase().includes(stem));
    const val = inKey ? coerce(inputs[inKey]) : null;
    let hit = null;
    if (typeof val === "string" && typeof table[val] === "number") hit = table[val];
    else if (typeof val === "number") {
      const bandsKey = Object.keys(table).find(k => k.startsWith("bands"));
      const bands = bandsKey ? table[bandsKey] : null;
      if (Array.isArray(bands)) {
        const b = bands.find(b => typeof b.max === "number" && val <= b.max);
        if (b && typeof b.factor === "number") hit = b.factor;
      }
    }
    if (hit != null && isFinite(hit) && hit > 0) { factor *= hit; out.push(tname); }
  }
  return { factor, applied: out };
}
function doCalc(body, ip) {
  const sid = String(body.schema_id || "");
  const s = SCHEMAS[sid];
  if (!s) return { status: 404, json: { error: "Unknown item template." } };
  const inputs = (body.inputs && typeof body.inputs === "object") ? body.inputs : {};
  const tier = Math.min(3, Math.max(1, Number(body.tier) || 1));
  const region = String(body.region || "USA");
  const sub = body.sub_region ? String(body.sub_region) : null;

  const [itemName, item] = pickItem(s, inputs);
  if (!item) return { status: 422, json: { error: "This template has no priced line item yet." } };
  const rateKey = Object.keys(item).find(k => k.startsWith("usd_per"));
  const base = Number(item[rateKey]);
  const qty = Math.max(0, Number(coerce(inputs.quantity)) || 1);

  const code = (((s.cost_build_up || {}).regional_cost_index) || {}).universal_code || "CEPCI";
  const esc = (CURRENT_INDICES[code] || 1) / (BASE_INDICES[code] || 1);
  const { f: rf, sf } = regionalFactor(s, region, sub);
  const { factor: mf, applied } = multiplierFactors(s, inputs, tier);

  let adders = 0;
  if (tier >= 3) {
    const a = (s.cost_build_up || {}).adders;
    if (a && typeof a === "object")
      adders = Object.values(a).filter(v => typeof v === "number" && v < 1).reduce((x, y) => x + y, 0);
  }
  const total = base * qty * esc * rf * sf * mf * (1 + adders);
  const lo = Number(item.range_low), hi = Number(item.range_high);
  const spread = (isFinite(lo) && isFinite(hi) && base > 0) ? [lo / base, hi / base] : [0.7, 1.6];

  const alerts = [];
  for (const r of s.compliance_rules || []) {
    if (evalCondition(r.condition_expr, inputs))
      alerts.push({ severity: String(r.severity || "info").toLowerCase(), message: r.message || "" });
  }

  return { status: 200, json: {
    schema_id: sid, item: itemName, tier, region, sub_region: sub || undefined,
    currency: "USD",
    total: sig3(total),
    range_low: sig3(total * spread[0]),
    range_high: sig3(total * spread[1]),
    unit_basis: item.unit || "USD/Unit",
    quantity: qty,
    confidence: tier === 1 ? "+-30% (Quick)" : tier === 2 ? "+-20% (Budget)" : "+-10% class (Detailed)",
    applied_factors: applied,                       // names only — never values
    estimate_basis: item.verify ? "benchmark-estimate (pending calibration)" : "calibrated",
    alerts
  } };
}

/* =============================== handler ================================== */
export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "?";
  const body = req.method === "POST" ? (typeof req.body === "object" && req.body ? req.body : safeJson(req)) : (req.query || {});
  const action = String(body.action || (req.query && req.query.action) || "").toLowerCase();

  if (!["search", "form", "calc", "streams"].includes(action))
    return res.status(400).json({ error: "Unknown action." });
  if (!gate(ip, action, action === "form" || action === "calc" ? String(body.schema_id || "") : null))
    return res.status(429).json({ error: "Too many requests — please slow down." });

  if (action === "streams") {
    const set = new Set(); for (const e of SEARCH_INDEX) if (e.c) set.add(e.c);
    return res.status(200).json({ streams: [...set].sort() });
  }
  if (action === "search") return res.status(200).json(doSearch(body.q, body.stream));
  if (action === "form") {
    const p = projectForm(String(body.schema_id || ""));
    return p ? res.status(200).json(p) : res.status(404).json({ error: "Unknown item template." });
  }
  if (action === "calc") {
    const out = doCalc(body, ip);
    return res.status(out.status).json(out.json);
  }
}
function safeJson(req) { try { return JSON.parse(req.body || "{}"); } catch { return {}; } }
