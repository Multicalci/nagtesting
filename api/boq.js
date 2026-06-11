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
// Normalize the library's heterogeneous conditional_display shapes into one
// safe client structure: { field: <spec_key>, op: "in"|"not_in", values: [...] }
// Unparseable conditions fail OPEN (field always visible).
function normalizeCond(f, fields) {
  const c = f.conditional_display ?? f.show_if ?? f.display_condition;
  if (c == null || c === "") return null;
  const byId = {}; for (const x of fields) byId[x.field_id] = x.spec_key || x.field_id;
  const fromStr = (s) => {
    s = String(s).replace(/[{}]/g, "");
    let m = s.match(/^\s*([A-Za-z_]\w*)\s+(NOT\s+IN|IN)\s+\[([^\]]*)\]\s*$/i);
    if (m) {
      const vals = (m[3].match(/'[^']*'|"[^"]*"/g) || []).map(x => x.slice(1, -1));
      return vals.length ? { field: m[1], op: /not/i.test(m[2]) ? "not_in" : "in", values: vals } : null;
    }
    // X === 'A' || X === "B" ... (single field, OR-chain of equalities)
    const eqs = [...s.matchAll(/([A-Za-z_]\w*)\s*={1,3}\s*('[^']*'|"[^"]*")/g)];
    if (eqs.length && !/&&|\bAND\b|!==|!=/.test(s)) {
      const fld = eqs[0][1];
      if (eqs.every(e => e[1] === fld)) return { field: fld, op: "in", values: eqs.map(e => e[2].slice(1, -1)) };
    }
    // X !== 'A' && X !== 'B' (AND-chain of inequalities -> not_in)
    const neqs = [...s.matchAll(/([A-Za-z_]\w*)\s*!==?\s*('[^']*'|"[^"]*")/g)];
    if (neqs.length && !/\|\||\bOR\b/.test(s) && ![...s.replace(/!==?/g, "").matchAll(/===?/g)].length) {
      const fld = neqs[0][1];
      if (neqs.every(e => e[1] === fld)) return { field: fld, op: "not_in", values: neqs.map(e => e[2].slice(1, -1)) };
    }
    // X.startsWith('A') || X.startsWith('B')
    const sw = [...s.matchAll(/([A-Za-z_]\w*)\.startsWith\(\s*('[^']*'|"[^"]*")\s*\)/g)];
    if (sw.length && !/&&|!==|!=/.test(s) && sw.every(e => e[1] === sw[0][1]))
      return { field: sw[0][1], op: "starts_with", values: sw.map(e => e[2].slice(1, -1)) };
    // X.includes('A') / X.toLowerCase().includes('a') (case-insensitive contains)
    const inc = [...s.matchAll(/([A-Za-z_]\w*)(?:\.toLowerCase\(\))?\.includes\(\s*('[^']*'|"[^"]*")\s*\)/g)];
    if (inc.length && !/&&|!==|!=/.test(s) && inc.every(e => e[1] === inc[0][1]))
      return { field: inc[0][1], op: "contains", values: inc.map(e => e[2].slice(1, -1).toLowerCase()) };
    return null;
  };
  if (typeof c === "string") return fromStr(c);
  if (typeof c === "object") {
    const fld = c.field || (c.field_id && byId[c.field_id]) ||
                (typeof c.show_when === "string" && !/\s/.test(c.show_when) ? c.show_when : null) ||
                (typeof c.show_if === "string" && !/\s/.test(c.show_if) ? c.show_if : null);
    if (Array.isArray(c.show_when) && (c.field || fld)) return { field: c.field || fld, op: "in", values: c.show_when };
    const arr = Array.isArray(c.values) ? c.values : (Array.isArray(c.value) ? c.value : null);
    if (fld && arr) return { field: fld, op: (c.operator === "not_in" ? "not_in" : "in"), values: arr };
    if (fld && Array.isArray(c.in)) return { field: fld, op: "in", values: c.in };
    if (fld && Array.isArray(c.not_in)) return { field: fld, op: "not_in", values: c.not_in };
    if (fld && typeof c.value === "string")
      return { field: fld, op: (/not/i.test(c.operator || "") ? "not_in" : "in"), values: [c.value] };
    if (Array.isArray(c.show_if_subtype)) return { field: "equipment_subtype", op: "in", values: c.show_if_subtype };
    if (c.show_if_field && Array.isArray(c.show_if_values))
      return { field: byId[c.show_if_field] || c.show_if_field, op: "in", values: c.show_if_values };
    for (const k of ["show_if", "show_when", "condition"]) if (typeof c[k] === "string") { const r = fromStr(c[k]); if (r) return r; }
    for (const [k, invert] of [["show_when", false], ["hide_when", true]]) {
      const x = c[k];
      if (x && typeof x === "object") {
        const xf = x.field || (x.field_id && byId[x.field_id]);
        const xa = Array.isArray(x.values) ? x.values : (Array.isArray(x.value) ? x.value : (typeof x.value === "string" ? [x.value] : null));
        if (xf && xa) {
          let op = (x.operator === "not_in" || /not/i.test(x.operator || "")) ? "not_in" : "in";
          if (invert) op = op === "in" ? "not_in" : "in";
          return { field: xf, op, values: xa };
        }
      }
    }
  }
  return null;
}
function projectForm(sid) {
  const s = SCHEMAS[sid];
  if (!s) return null;
  return {
    schema_id: sid,
    name: s.template_name || sid.replace("SCHEMA-", ""),
    stream: s.stream || "",
    item_type: s.item_type || "",
    tier_note: (s.tier_summary && s.tier_summary.note) || "",
    fields: (s.fields || []).map(f => {
      const show_if = normalizeCond(f, s.fields || []);
      return {
        field_id: f.field_id,
        spec_key: f.spec_key || f.field_id,
        label: f.label,
        type: f.type,
        unit: f.unit || null,
        tier: f.tier || 1,
        mandatory: !!f.mandatory,
        section: f.section || "Inputs",
        ...(show_if ? { show_if } : {}),
        ...(f.type === "dropdown" ? { options: f.options || [] } : {})
      };
    })
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
  if (Array.isArray(items)) {
    const name = e => e.sub_type || e.name || e.item || "";
    let e = want && items.find(x => name(x).toLowerCase() === String(want).toLowerCase());
    if (!e && want) e = items.find(x => name(x).toLowerCase().includes(String(want).toLowerCase()));
    if (!e) e = items[0];
    return e ? [name(e), e] : [null, null];
  }
  if (want && items[want]) return [want, items[want]];
  if (want) {
    const k = Object.keys(items).find(k => k.toLowerCase() === String(want).toLowerCase());
    if (k) return [k, items[k]];
  }
  const k0 = Object.keys(items)[0];
  return k0 ? [k0, items[k0]] : [null, null];
}
// Equation-priced entries: { cost_equation: "C = A * (X / B)^n", primary_sizing_var: "volume (m3)" }
// Returns { base, unitNote } sized by the user's input where given, else at reference size.
function equationBase(item, inputs) {
  const eq = String(item.cost_equation || "");
  const m = eq.match(/=\s*([0-9][0-9.eE+]*)\s*\*\s*\(\s*[A-Za-z_]\w*\s*\/\s*([0-9][0-9.]*)\s*\)\s*(?:\^|\*\*)\s*([0-9.]+)/);
  const sizeWord = String(item.primary_sizing_var || "").split("(")[0].trim().toLowerCase().replace(/\s+/g, "_");
  const sizeVal = Number(coerce(inputs[sizeWord]));
  if (m) {
    const A = Number(m[1]), B = Number(m[2]), n = Number(m[3]);
    const x = isFinite(sizeVal) && sizeVal > 0 ? sizeVal : B;
    return { base: A * Math.pow(x / B, n),
      unitNote: `USD/Unit (sized by ${item.primary_sizing_var || "reference"}${isFinite(sizeVal) && sizeVal > 0 ? ` = ${sizeVal}` : " @ reference"})` };
  }
  const ex = item.usd_example;
  if (ex && typeof ex === "object") {
    const vals = Object.values(ex).map(Number).filter(isFinite).sort((a, b) => a - b);
    if (vals.length) return { base: vals[Math.floor(vals.length / 2)], unitNote: "USD/Unit (mid-range of reference points)" };
  }
  return { base: NaN, unitNote: "" };
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
  // rate key tolerance: usd_per_* (gold pattern), plain usd, any rate-ish numeric
  // key, or an equation-priced entry (cost_equation + sizing variable).
  let base, unitOverride = null;
  let rateKey = Object.keys(item).find(k => k.startsWith("usd_per"));
  if (!rateKey && typeof item.usd === "number") rateKey = "usd";
  if (!rateKey) rateKey = Object.keys(item).find(k =>
    typeof item[k] === "number" && /usd|rate|cost|price/i.test(k) &&
    !/range|verify|year|low|high|basis|factor/i.test(k));
  if (rateKey) base = Number(item[rateKey]);
  else if (item.cost_equation || item.usd_example) {
    const e = equationBase(item, inputs);
    base = e.base; unitOverride = e.unitNote;
  }
  if (!isFinite(base) || base <= 0)
    return { status: 422, json: { error: "Pricing entry for this item is incomplete — flagged for calibration." } };
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
    unit_basis: unitOverride || item.unit || "USD/Unit",
    quantity: qty,
    confidence: tier === 1 ? "+-30% (Quick)" : tier === 2 ? "+-20% (Budget)" : "+-10% class (Detailed)",
    applied_factors: applied,                       // names only — never values
    estimate_basis: item.verify ? "benchmark-estimate (pending calibration)" : (unitOverride ? "equation-priced (reference class)" : "calibrated"),
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
