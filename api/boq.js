// ============================================================================
// api/boq.js — multicalci.com BOQ Calculator API (Vercel serverless) v1.2
// 2026-07-05 · Drop-in replacement for v1.1. Schemas/SQL unchanged.
//
// v1.2:
//   [DIM]  Dimensional unit-rate items (usd_per_m / _m2 / …) now surface the
//          measured dimension. Previously the length/area consumed inside
//          resolveBase was discarded, so the supply line was labelled by the
//          run COUNT (" — 1 m") and the result carried no length, forcing the
//          UI "rate basis" to divide by quantity (=1) and show the whole supply
//          as the per-metre rate. Now: resolveBase reports out.measured; the
//          supply line reads " — 100 m"; the result adds measured_dimension /
//          total_dimension / unit_rate so the UI can show the true /m rate.
//          Prices are UNCHANGED — this is label/reporting only.
//
// Engine-side fixes folded in (no schema edits required):
//   [IP]   Library rates + cost-curve coefficients no longer leak via notes /
//          factors_applied. Notes are genericised at source; factors_applied
//          returns only {table, matched} (no multiplier value).
//   [SIZE] Cost-equation / scaling parameter is now bound to item.sizing_basis
//          instead of a broad keyword guess (no more capacity_factor vs MW).
//   [SUB]  Subtype fallback picks the dropdown whose options actually match
//          baseline item names — not merely "the first dropdown".
//   [MOC]  Descriptive factor match is exact, with prefix fallback ONLY when a
//          single unambiguous candidate exists (no silent 304-vs-316L mis-pick).
//   [ACT]  Activity vs equipment is a real boolean flag from resolveBase, not a
//          note-string sniff.
//   [QTY]  Dimensional unit rates (area/length/…) price ONE unit; the separate
//          Quantity field multiplies the count (rate × dim × qty). No forced
//          qty=1 — that would undercount multi-unit line items.
//   [IN]   IN ['a','b'] list literals now parse in compliance rules (previously
//          such clauses silently never fired).
//   [BAND] Range tables pick the TIGHTEST matching band, not the first one.
//   [PERF] Escalation / regional / duty / FX run concurrently; rate-limit insert
//          and FX cache-write are fire-and-forget; rate-limit + schema fetch
//          overlap in the handler.
//   [FX]   Stale stored rate is served immediately and refreshed in background;
//          a live fetch blocks only when there is NO stored rate at all.
//   [CORS] Both www and apex hosts are allowed.
//   [RGX]  cost_equation regex tolerates scientific notation / negative exponent.
// ============================================================================

const SB_URL = (process.env.SUPABASE_URL || '')
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DAILY_LIMIT = parseInt(process.env.BOQ_FREE_DAILY_LIMIT || '20', 10);
const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://multicalci.com';
// [CORS] allow both hosts + localhost; dedupe
const ALLOWED_ORIGINS = [...new Set([
  ORIGIN,
  'https://multicalci.com',
  'https://www.multicalci.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])];

const enc = encodeURIComponent;

// ── Supabase REST (service role) ─────────────────────────────────────────────
async function sb(path, opts = {}) {
  const headers = {
    apikey: SB_KEY,
    'Content-Type': 'application/json',
    Prefer: opts.prefer || 'return=minimal',
    ...(opts.headers || {}),
  };
  if (SB_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers });
  if (!r.ok) {
    const txt = await r.text().catch(() => r.statusText);
    throw new Error(`Supabase ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.status === 204 ? null : r.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (v) => Math.round(v * 100) / 100;
const optVal = (o) => (typeof o === 'string' ? o : (o && (o.value ?? o.label ?? o.name)) ?? '');

async function sha256Hex(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tierNum(t) {
  const m = String(t || 'T1').toUpperCase().match(/([123])/);
  return m ? parseInt(m[1], 10) : 1;
}

// ── Measurement unit extraction ──────────────────────────────────────────────
const COUNT_UNITS = new Set(['unit', 'units', 'no', 'no.', 'nos', 'each', 'ea', 'set', 'item', 'job lot']);
const UNIT_PRETTY = { m2: 'm²', m3: 'm³', sqm: 'm²', cum: 'm³', rm: 'm (run)', mt: 'tonne', 'man-hour': 'man-hour' };
function normalizeUnit(u) {
  if (!u) return null;
  u = String(u).toLowerCase().replace(/^usd\s*\/\s*/, '').replace(/^per\s+/, '').trim();
  if (COUNT_UNITS.has(u)) return null;
  return UNIT_PRETTY[u] || u;
}
function itemUnit(item) {
  if (item.unit) return normalizeUnit(item.unit);
  for (const k of Object.keys(item)) {
    const m = k.match(/^usd_per_([a-z0-9_-]+)$/i);
    if (m && m[1].toLowerCase() !== 'manhour') return normalizeUnit(m[1]);
  }
  if (typeof item.basis === 'string') {
    const m = item.basis.match(/USD\s*\/\s*([A-Za-z][A-Za-z0-9.\-]{0,11})/);
    if (m) return normalizeUnit(m[1]);
  }
  return null;
}

// ── Factor table resolution ──────────────────────────────────────────────────
function rangeKeyMatch(key, value) {
  const k = key.toLowerCase();
  let m = k.match(/^lte?_(\d+(?:\.\d+)?)/);
  if (m) return value <= parseFloat(m[1]);
  m = k.match(/^gte?_(\d+(?:\.\d+)?)/);
  if (m) return value >= parseFloat(m[1]);
  m = k.match(/^gt_(\d+(?:\.\d+)?)/);
  if (m) return value > parseFloat(m[1]);
  m = k.match(/^lt_(\d+(?:\.\d+)?)/);
  if (m) return value < parseFloat(m[1]);
  m = k.match(/^(\d+(?:\.\d+)?)_to_(\d+(?:\.\d+)?)/);
  if (m) return value > parseFloat(m[1]) && value <= parseFloat(m[2]);
  return false;
}

// [BAND] numeric interval implied by a band key, for tightest-match selection
function bandInterval(key) {
  const k = key.toLowerCase();
  let lo = -Infinity, hi = Infinity, m;
  if ((m = k.match(/^lte?_(\d+(?:\.\d+)?)/))) hi = parseFloat(m[1]);
  else if ((m = k.match(/^lt_(\d+(?:\.\d+)?)/))) hi = parseFloat(m[1]);
  else if ((m = k.match(/^gte?_(\d+(?:\.\d+)?)/))) lo = parseFloat(m[1]);
  else if ((m = k.match(/^gt_(\d+(?:\.\d+)?)/))) lo = parseFloat(m[1]);
  else if ((m = k.match(/^(\d+(?:\.\d+)?)_to_(\d+(?:\.\d+)?)/))) { lo = parseFloat(m[1]); hi = parseFloat(m[2]); }
  return [lo, hi];
}

function resolveFactor(table, fieldValues) {
  const entries = Object.entries(table).filter(
    ([k, v]) => k !== 'note' && typeof v === 'number'
  );
  if (!entries.length) return null;

  const isRangeTable = entries.every(([k]) => /^(lte?|gte?|gt|lt)_\d|^\d+(?:\.\d+)?_to_\d/.test(k));

  if (isRangeTable) {
    // [BAND] pick the tightest band that contains the value, not the first match
    let best = null, bestW = Infinity;
    for (const v of Object.values(fieldValues)) {
      const n = num(v);
      if (n === null) continue;
      for (const [k, f] of entries) {
        if (rangeKeyMatch(k, n)) {
          const [lo, hi] = bandInterval(k);
          const w = hi - lo;
          if (w < bestW) { bestW = w; best = { factor: f, matchedKey: k, source: String(v) }; }
        }
      }
    }
    return best;
  }

  // Descriptive table: exact match first
  for (const v of Object.values(fieldValues)) {
    if (typeof v !== 'string' || !v) continue;
    for (const [k, f] of entries) {
      if (k === v) return { factor: f, matchedKey: k, source: v };
    }
  }
  // [MOC] prefix fallback ONLY when exactly one unambiguous candidate exists
  const cands = [];
  const seen = new Set();
  for (const v of Object.values(fieldValues)) {
    if (typeof v !== 'string' || v.length < 4) continue;
    const lv = v.toLowerCase();
    for (const [k, f] of entries) {
      const lk = k.toLowerCase();
      if (lk === lv) continue;
      if ((lk.startsWith(lv) || lv.startsWith(lk)) && !seen.has(k)) {
        seen.add(k);
        cands.push({ factor: f, matchedKey: k, source: v });
      }
    }
  }
  return cands.length === 1 ? cands[0] : null;
}

function relatedValues(tableName, values) {
  const hints = {
    pressure: ['pressure'],
    temp: ['temp'],
    stage: ['stage'],
    power: ['power', 'kw'],
    head: ['head'],
    flow: ['flow'],
    voltage: ['voltage', 'kv'],
    size: ['size', 'dn', 'dia'],
    thickness: ['thick'],
    capacity: ['capacity', 'duty'],
  };
  const tn = tableName.toLowerCase();
  for (const [group, keys] of Object.entries(hints)) {
    if (tn.includes(group)) {
      const sub = {};
      for (const [k, v] of Object.entries(values)) {
        if (keys.some((h) => k.toLowerCase().includes(h))) sub[k] = v;
      }
      if (Object.keys(sub).length) return sub;
    }
  }
  return values;
}

// ── Sizing-parameter selection ───────────────────────────────────────────────
// [SIZE] Bind the cost-curve driver to item.sizing_basis tokens instead of a
// broad keyword guess. Longer tokens weighted higher so "power output (MW)"
// beats an unrelated "capacity_factor" field.
function pickSizingValue(item, values) {
  const explicit = num(values.sizing_value);
  if (explicit !== null) return explicit;
  const basis = String(item.sizing_basis || '').toLowerCase();
  const stop = new Set(['the', 'for', 'per', 'rated', 'of', 'at', 'in', 'and']);
  const tokens = basis.split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !stop.has(t));
  if (!tokens.length) return null;
  let best = null, bestScore = 0;
  for (const [k, v] of Object.entries(values)) {
    const n = num(v);
    if (n === null) continue;
    const lk = k.toLowerCase();
    let score = 0;
    for (const t of tokens) if (lk.includes(t)) score += t.length;
    if (score > bestScore) { bestScore = score; best = n; }
  }
  return bestScore > 0 ? best : null;
}

// ── Subtype selection ────────────────────────────────────────────────────────
function itemIdSet(baseline) {
  const set = new Set();
  const items = baseline && baseline.items;
  if (Array.isArray(items)) {
    for (const it of items) {
      const n = it && (it.sub_type || it.item_name || it.name);
      if (n) set.add(String(n).trim().toLowerCase());
    }
  } else if (items && typeof items === 'object') {
    for (const k of Object.keys(items)) set.add(String(k).trim().toLowerCase());
  }
  return set;
}
// [SUB] choose the dropdown that actually drives the baseline, not just the first
function pickSubtype(schema, values) {
  const cb = schema.cost_build_up || {};
  const ids = itemIdSet(cb.usd_cost_baseline);
  const dropdowns = (schema.fields || []).filter((f) => f.type === 'dropdown' && f.spec_key);
  if (!dropdowns.length) return null;
  // 1) a dropdown whose CURRENT value is itself a baseline item
  for (const f of dropdowns) {
    const v = values[f.spec_key];
    if (typeof v === 'string' && ids.has(v.trim().toLowerCase())) return v;
  }
  // 2) the dropdown whose OPTIONS overlap baseline item names the most
  let best = null, bestOverlap = 0;
  for (const f of dropdowns) {
    const opts = Array.isArray(f.options) ? f.options : [];
    const overlap = opts.reduce(
      (a, o) => a + (ids.has(String(optVal(o)).trim().toLowerCase()) ? 1 : 0), 0
    );
    if (overlap > bestOverlap) { bestOverlap = overlap; best = f; }
  }
  if (best && values[best.spec_key] != null) return values[best.spec_key];
  // 3) original fallback: first dropdown
  return values[dropdowns[0].spec_key] ?? null;
}

// ── Baseline cost resolution ────────────────────────────────────────────────
// out flags set for the caller: { unit, isActivity, qtyConsumed }
function resolveBase(baseline, subtype, values, notes, out = {}) {
  const items = baseline && baseline.items;
  let item = null;
  const want = String(subtype || '').trim().toLowerCase();
  if (Array.isArray(items)) {
    item =
      items.find((it) => String(it.sub_type || it.item_name || it.name || '').trim().toLowerCase() === want) || null;
  } else if (items) {
    item = items[subtype] || null;
    if (!item) {
      for (const [k, v] of Object.entries(items)) {
        if (k.trim().toLowerCase() === want) { item = v; break; }
      }
    }
  }
  if (!item || typeof item !== 'object') {
    notes.push(`No USD baseline found for "${subtype}" — cannot compute.`);
    return null;
  }
  out.unit = itemUnit(item);

  // Flat list price
  if (item.usd_list_price != null) {
    return item.usd_list_price;
  }

  // Unit-rate keys (usd_per_m2 / usd_per_m / usd_per_tonne / …)
  for (const [k, v] of Object.entries(item)) {
    const m = k.match(/^usd_per_([a-z0-9]+)$/i);
    if (m && typeof v === 'number' && m[1].toLowerCase() !== 'manhour') {
      const unit = m[1];
      const countUnits = ['unit','units','no','nos','nr','each','set','lot','item','job','point','loc','location'];
      if (countUnits.includes(unit.toLowerCase())) {
        notes.push('Priced as a flat per-each rate.'); // [IP] no rate value
        return v;
      }
      const qv =
        num(values.area) ?? num(values.length) ?? num(values.weight) ??
        num(values.volume) ?? num(values.measured_quantity) ?? null;
      if (qv !== null) {
        // area/length/… is the per-unit dimension; the separate Quantity field
        // is the COUNT, applied later in calculate(). rate × dim × qty is correct.
        out.measured = qv;   // [DIM] dimension priced here (e.g. 100 m) — was discarded, so the
        out.rateUnit = unit; // [DIM] supply label could only show the run count. Surface it now.
        notes.push(`Priced on a unit rate over ${qv} ${unit}.`); // [IP]
        return v * qv;
      }
      notes.push(`Priced on a unit rate; the Quantity field is treated as ${unit}.`); // [IP]
      return v;
    }
  }

  // Cost equation "C = A * (P / R)^E"  [RGX] tolerate sci-notation / neg exponent
  if (typeof item.cost_equation === 'string') {
    const m = item.cost_equation.match(
      /=\s*([\d.]+(?:[eE][+-]?\d+)?)\s*\*\s*\(\s*\w+\s*\/\s*([\d.]+(?:[eE][+-]?\d+)?)\s*\)\s*\^\s*(-?[\d.]+)/
    );
    if (m) {
      const A = parseFloat(m[1]), R = parseFloat(m[2]), E = parseFloat(m[3]);
      const pv = pickSizingValue(item, values); // [SIZE]
      if (pv !== null) {
        if (item.valid_range_min_MW != null && pv < item.valid_range_min_MW) notes.push(`Sizing ${pv} below validated range — extrapolated.`);
        if (item.valid_range_max_MW != null && pv > item.valid_range_max_MW) notes.push(`Sizing ${pv} above validated range — extrapolated.`);
        notes.push(`Cost-curve estimate at ${pv} (${item.sizing_basis || 'sizing basis'}).`); // [IP]
        return A * Math.pow(pv / R, E);
      }
      notes.push(`Provide ${item.sizing_basis || 'the sizing parameter'} for a sized estimate — reference point used.`); // [IP]
      return A;
    }
  }

  // Per-size rate maps (e.g. rates_per_joint_usd keyed by DN)
  for (const [k, v] of Object.entries(item)) {
    if (!/rate|usd_per|price_per/i.test(k) || typeof v !== 'object' || v === null) continue;
    const entries = Object.entries(v).filter(([, x]) => typeof x === 'number');
    if (!entries.length) continue;
    for (const val of Object.values(values)) {
      if (typeof val !== 'string' || !val) continue;
      const hit =
        entries.find(([rk]) => rk === val) ||
        entries.find(([rk]) => rk.toLowerCase().startsWith(val.toLowerCase()) || val.toLowerCase().startsWith(rk.toLowerCase()));
      if (hit) {
        notes.push(`Rate basis: ${hit[0]}.`); // [IP] no USD value
        return hit[1];
      }
    }
    notes.push(`Select a size option for an exact rate — smallest size used as placeholder.`);
    return entries[0][1];
  }

  // Activity (man-hour) items  [ACT] set a real flag
  if (item.usd_per_manhour != null) {
    out.isActivity = true;
    const mh = num(values.activity_manhours) || num(values.manhours) || num(values.man_hours);
    if (mh) {
      notes.push(`Labour basis: ${mh} man-hours.`); // [IP] no rate
      return item.usd_per_manhour * mh;
    }
    if (item.usd == null && item.usd_per_unit == null) {
      notes.push('Activity item: provide man-hours (activity_manhours) for labour-based pricing.');
      return null;
    }
  }

  let base = item.usd_per_unit != null ? item.usd_per_unit : item.usd;

  // Parametric scaling
  if (item.scaling_parameter && item.scaling_exponent && base != null) {
    const ref =
      item.reference_power_kW || item.reference_value || item.reference || null;
    const wanted = item.scaling_parameter.toLowerCase().replace(/_kw$/, '');
    let pv = null;
    for (const [k, v] of Object.entries(values)) {
      const lk = k.toLowerCase();
      if (lk.includes(wanted) || (lk.length >= 3 && wanted.includes(lk))) {
        pv = num(v);
        if (pv != null) break;
      }
    }
    if (pv == null) pv = num(values.motor_power);
    if (pv != null && ref) {
      base = base * Math.pow(pv / ref, item.scaling_exponent);
      notes.push(`Parametric scaling applied (size ${pv}).`); // [IP] no exponent/ref
    } else {
      notes.push('Scaling parameter value not provided — reference base used unscaled.');
    }
  }

  if (base == null && item.range_low != null && item.range_high != null) {
    base = (item.range_low + item.range_high) / 2;
    notes.push('Baseline taken as midpoint of published range (no point estimate in library).');
  }
  if (base == null) {
    notes.push(`Baseline for "${subtype}" has no usable rate — cannot compute.`);
    return null;
  }
  if (item.verify) notes.push('Baseline flagged for verification: public-benchmark estimate pending calibration.');
  return base;
}

// ── Compliance mini-language evaluator (NO eval) ─────────────────────────────
function evalCondition(expr, values) {
  try {
    const orParts = expr.split(/\s+OR\s+/i);
    return orParts.some((part) =>
      part.split(/\s+AND\s+/i).every((clause) => evalClause(clause.trim(), values))
    );
  } catch {
    return false;
  }
}
function literal(tok, values) {
  tok = tok.trim();
  const q = tok.match(/^'(.*)'$|^"(.*)"$/s);
  if (q) return q[1] !== undefined ? q[1] : q[2];
  const n = num(tok);
  if (n !== null && /^[\d.+-]+$/.test(tok)) return n;
  return values[tok];
}
function evalClause(clause, values) {
  let m = clause.match(/^!\s*(.+?)\s+IN\s+(.+)$/i);
  if (m) return !inTest(m[1], m[2], values);
  m = clause.match(/^(.+?)\s+NOT\s+IN\s+(.+)$/i);
  if (m) return !inTest(m[1], m[2], values);
  m = clause.match(/^(.+?)\s+IN\s+(.+)$/i);
  if (m) return inTest(m[1], m[2], values);
  m = clause.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (m) {
    const a = literal(m[1], values);
    const b = literal(m[3], values);
    if (a === undefined || a === null || a === '') return false;
    const an = num(a), bn = num(b);
    const bothNum = an !== null && bn !== null && typeof b !== 'string';
    switch (m[2]) {
      case '==': return bothNum ? an === bn : String(a) === String(b);
      case '!=': return bothNum ? an !== bn : String(a) !== String(b);
      case '>':  return an !== null && bn !== null && an > bn;
      case '<':  return an !== null && bn !== null && an < bn;
      case '>=': return an !== null && bn !== null && an >= bn;
      case '<=': return an !== null && bn !== null && an <= bn;
    }
  }
  const v = literal(clause, values);
  return v !== undefined && v !== null && v !== '' && v !== false && v !== 0;
}
function parseListLiteral(tok) {
  const m = String(tok).trim().match(/^\[(.*)\]$/s);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter((s) => s.length > 0);
}
function inTest(needleTok, hayTok, values) {
  const needle = literal(needleTok, values);
  if (needle == null) return false;
  const list = parseListLiteral(hayTok); // [IN] handle  X IN ['a','b']
  if (list) return list.map(String).includes(String(needle));
  const hay = literal(hayTok, values);
  if (hay == null) return false;
  if (Array.isArray(hay)) return hay.map(String).includes(String(needle));
  return String(hay).toLowerCase().includes(String(needle).toLowerCase());
}

// ── Field filtering for the fields endpoint ──────────────────────────────────
const SAFE_FIELD_KEYS = [
  'field_id','label','section','section_order','field_order','type','unit','unit_us',
  'factor_si_to_us','is_temperature','mandatory','options','default','hint','min','max',
  'min_us','max_us','conditional_display','tier','spec_key',
];
function publicFields(schema, tier) {
  const t = tierNum(tier);
  return (schema.fields || [])
    .filter((f) => (f.tier || 1) <= t)
    .map((f) => Object.fromEntries(SAFE_FIELD_KEYS.map((k) => [k, f[k] ?? null])))
    .sort((a, b) => (a.section_order - b.section_order) || (a.field_order - b.field_order));
}

// ── Tier-aware multiplier selection ──────────────────────────────────────────
function tablesForTier(cb, tier) {
  const all = Object.entries(cb.cost_multiplier_tables || {});
  if (!all.length) return [];
  const t = tierNum(tier);
  const fml =
    t === 1 ? cb.tier_1_formula : t === 2 ? cb.tier_2_formula : cb.full_formula;
  if (typeof fml !== 'string' || !fml) return all;
  const used = all.filter(([name]) => {
    const stem = name.toLowerCase().replace(/_factor$/, '').split('_')[0];
    return fml.toLowerCase().includes(stem);
  });
  return used.length ? used : all;
}

// ── Self-refreshing FX ────────────────────────────────────────────────────────
const FX_PEGGED = { AED: 3.6725, SAR: 3.75, QAR: 3.64, OMR: 0.3845, BHD: 0.376 };
const FX_LIST = 'INR,GBP,EUR,CNY,JPY,SGD,MYR,THB,IDR,PHP,KRW,CAD,AUD,CHF,VND';

// [FX] one live fetch refreshes ALL currencies; caching is fire-and-forget
async function refreshAllFx(today) {
  try {
    const r = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${FX_LIST}`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.rates) return null;
    const payload = Object.entries(d.rates).map(([cur, rate]) => ({
      from_currency: 'USD', to_currency: cur, rate, rate_date: today, source: 'frankfurter.app (ECB)',
    }));
    sb('currency_rates?on_conflict=from_currency,to_currency,rate_date', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(payload),
    }).catch(() => {}); // fire-and-forget
    return d.rates;
  } catch {
    return null;
  }
}

async function getFxRate(outCur, notes) {
  if (FX_PEGGED[outCur]) {
    notes.push(`FX: ${outCur} is USD-pegged at ${FX_PEGGED[outCur]}.`);
    return FX_PEGGED[outCur];
  }
  const today = new Date().toISOString().slice(0, 10);
  let stored = null;
  try {
    const rows = await sb(
      `latest_currency_rates?from_currency=eq.USD&to_currency=eq.${enc(outCur)}&select=rate,rate_date`
    );
    if (rows && rows[0]) stored = rows[0];
  } catch { /* try live below */ }

  if (stored && String(stored.rate_date).slice(0, 10) >= today) {
    return Number(stored.rate); // fresh today
  }
  // [FX] stale → serve immediately, refresh in background for next caller
  if (stored) {
    refreshAllFx(today).catch(() => {});
    notes.push(`FX: using cached rate of ${String(stored.rate_date).slice(0, 10)}; refreshing in background.`);
    return Number(stored.rate);
  }
  // no stored rate at all → must fetch live now
  const live = await refreshAllFx(today);
  if (live && live[outCur] != null) {
    notes.push('FX fetched live (ECB daily fix).');
    return Number(live[outCur]);
  }
  return null;
}

// ── Independent Supabase lookups (run concurrently) ──────────────────────────
async function lookupEscalation(templateId) {
  try {
    const rows = await sb(
      `template_index_resolution?template_id=eq.${enc(templateId)}&select=escalation_factor,universal_code`
    );
    if (rows && rows[0]) {
      return { escalation: Number(rows[0].escalation_factor) || 1, code: rows[0].universal_code };
    }
    return { escalation: 1, code: null };
  } catch {
    return { escalation: 1, code: null, failed: true };
  }
}
async function lookupRegional(region, subRegion) {
  try {
    let q = `regional_factors?region=eq.${enc(region)}&select=*`;
    if (subRegion) q += `&sub_region=eq.${enc(subRegion)}`;
    const rows = await sb(q);
    if (rows && rows[0]) return { rf: rows[0] };
    return { rf: null, notFound: true };
  } catch {
    return { rf: null, failed: true };
  }
}
async function lookupDuty(region, dutyCat) {
  try {
    const rows = await sb(
      `import_duties?region=eq.${enc(region)}&equipment_category=eq.${enc(dutyCat)}&select=total_landed_adder_pct,indicative_duty_pct`
    );
    if (rows && rows[0]) return Number(rows[0].total_landed_adder_pct ?? rows[0].indicative_duty_pct) || 0;
  } catch { /* duty stays 0 */ }
  return 0;
}

// ── The calculation ──────────────────────────────────────────────────────────
async function calculate(schema, body) {
  const cb = schema.cost_build_up || {};
  const values = body.values || {};
  const tier = body.tier || 'T1';
  const notes = [];
  let qty = num(values.quantity) || 1;

  // 1) Subtype
  let subtype = values.equipment_subtype;
  if (!subtype) subtype = pickSubtype(schema, values); // [SUB]

  // 2) Baseline USD (2024)
  const ub = {};
  const base = resolveBase(cb.usd_cost_baseline, subtype, values, notes, ub);
  const unit = ub.unit || null;
  if (base == null) return { error: 'NO_BASELINE', notes };

  // 3) Multiplier tables for this tier
  const applied = [];
  let factorProduct = 1;
  for (const [name, table] of tablesForTier(cb, tier)) {
    if (typeof table !== 'object') continue;
    const hit = resolveFactor(table, relatedValues(name, values));
    if (hit) {
      factorProduct *= hit.factor;
      applied.push({ table: name, matched: hit.matchedKey }); // [IP] no factor value
    }
  }

  // 4-7) Independent lookups in parallel  [PERF]
  const region = body.region || 'India';
  const subRegion = body.sub_region || null;
  let outCur = (body.currency || 'USD').toUpperCase();
  const dutyCat =
    (cb.regional_factors && cb.regional_factors.equipment_duty_category) || 'Process equipment';
  const isImported = (body.equipment_origin || 'Local') === 'Imported';

  const [esc, regional, dutyPctRaw, fxRaw] = await Promise.all([
    lookupEscalation(schema.template_id),
    lookupRegional(region, subRegion),
    isImported ? lookupDuty(region, dutyCat) : Promise.resolve(0),
    outCur !== 'USD' ? getFxRate(outCur, notes) : Promise.resolve(1),
  ]);

  // Escalation
  const escalation = esc.escalation;
  if (esc.failed) notes.push('Escalation lookup failed — using ×1.0 (2024 basis).');
  else if (esc.code) notes.push(`Escalation ×${escalation.toFixed(4)} (${esc.code} vs 2024 base).`);

  // Regional factors
  const DEFAULT_RF = {
    equipment_factor: 1, labour_factor: 1, civil_factor: 1, inland_freight_pct: 0,
    contingency_pct: 10, accuracy_pct: 25, aace_class: 'Class 4', currency_code: 'USD',
  };
  let rf = DEFAULT_RF;
  if (regional.rf) rf = regional.rf;
  else if (regional.notFound) notes.push(`Region "${region}" not found — world-average factors (×1.0) used.`);
  else if (regional.failed) notes.push('Regional factor lookup failed — ×1.0 used.');

  // Import duty
  const dutyPct = dutyPctRaw || 0;
  if (isImported && dutyPct) {
    notes.push(`Import duty applied: ${dutyPct}% landed adder (${dutyCat}, ${region}). Indicative — verify HS code.`);
  } else if (isImported && !dutyPct) {
    notes.push(`No duty row for "${dutyCat}" in ${region} — duty taken as 0%. Verify HS code.`);
  }

  // FX
  let fx = 1;
  if (outCur !== 'USD') {
    if (fxRaw === null) { notes.push(`No FX rate available for ${outCur} — totals shown in USD.`); outCur = 'USD'; }
    else fx = fxRaw;
  }

  // 8) Build lines (USD first)
  const adders = cb.adders || {};
  const isActivity = !!ub.isActivity; // [ACT] real flag
  const supplyFactor = isActivity ? Number(rf.labour_factor) : Number(rf.equipment_factor);
  const supplyUsd = base * factorProduct * qty * escalation * (supplyFactor || 1);

  // [DIM] For dimensional unit rates the measured dimension (length/area/…) was
  // consumed in resolveBase; reflect it in the label instead of the run count.
  const measured = ub.measured != null ? ub.measured : null;          // per run, e.g. 100 (m)
  const totalDim = measured != null ? round2(measured * qty) : null;  // total across runs
  const dimLabel = !unit ? ''
    : (measured != null ? ` — ${qty > 1 ? qty + ' × ' : ''}${measured} ${unit}`
                        : ` — ${qty} ${unit}`);                        // per-each items unchanged

  const lines = [];
  lines.push({
    line: (isActivity ? 'Labour / activity cost' : 'Supply (ex-works, regionalised)') + dimLabel,
    usd: round2(supplyUsd),
  });

  const t = tierNum(tier);
  let subtotal = supplyUsd;
  if (!isActivity) {
    const freight = supplyUsd * ((Number(adders.freight_insurance) || 0) + (Number(rf.inland_freight_pct) || 0) / 100);
    if (freight) { lines.push({ line: 'Freight, insurance & inland transport', usd: round2(freight) }); subtotal += freight; }
    if (dutyPct) {
      const duty = supplyUsd * (dutyPct / 100);
      lines.push({ line: 'Import duty & landed costs (indicative)', usd: round2(duty) });
      subtotal += duty;
    }
    const erect = supplyUsd * (Number(adders.erection_installation) || 0) * (Number(rf.labour_factor) || 1);
    if (erect) { lines.push({ line: 'Erection & installation (regional labour)', usd: round2(erect) }); subtotal += erect; }
  }
  const contPct = Number(rf.contingency_pct ?? (Number(adders.contingency) || 0.1) * 100);
  const cont = subtotal * (contPct / 100);
  lines.push({ line: `Contingency (${contPct}% ${rf.aace_class || ''})`.trim(), usd: round2(cont) });
  const totalUsd = subtotal + cont;

  // 9) Compliance rules — evaluated HERE, never shipped to the client
  const findings = [];
  for (const r of schema.compliance_rules || []) {
    if (r.condition_expr && evalCondition(r.condition_expr, values)) {
      findings.push({ severity: r.severity || 'warning', message: r.message, basis: r.engineering_basis || null });
    }
  }

  // 10) Spec string
  let spec = null;
  if (typeof schema.spec_formula === 'string') {
    spec = schema.spec_formula.replace(/\{(\w+)\}/g, (_, k) =>
      values[k] !== undefined && values[k] !== null && values[k] !== '' ? values[k] : '—'
    );
  }

  const tierAcc = t === 1 ? 30 : t === 2 ? 20 : 10;
  const accuracy = `±${Math.max(tierAcc, Number(rf.accuracy_pct) || 0)}%`;
  return {
    template_id: schema.template_id,
    template_name: schema.template_name,
    tier, accuracy, region, sub_region: rf.sub_region || subRegion,
    quantity: qty, unit, spec,
    measured_dimension: measured, // [DIM] per run, e.g. 100 (m)
    total_dimension: totalDim,    // [DIM] total, e.g. 100 (m) — divide supply by this for the /unit rate
    unit_rate: (measured != null && totalDim) ? round2((supplyUsd / totalDim) * fx) : null, // [DIM] correct /m rate
    factors_applied: applied, // [IP] {table, matched} only
    lines: lines.map((l) => ({ ...l, amount: round2(l.usd * fx) })),
    total: { usd: round2(totalUsd), currency: outCur, amount: round2(totalUsd * fx), fx_rate: fx },
    compliance: findings,
    notes, // [IP] genericised at source — no library rates / coefficients
    disclaimer: `Tier ${t} ${accuracy} estimate for budgetary purposes only — not for procurement. multicalci.com`,
  };
}

// ── Rate limiting via boq_calc_log ───────────────────────────────────────────
async function rateLimit(req, templateId, tier, region) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const hash = (await sha256Hex(ip + (process.env.BOQ_IP_SALT || 'multicalci'))).slice(0, 32);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const rows = await sb(
      `boq_calc_log?client_hash=eq.${hash}&created_at=gte.${today}T00:00:00Z&select=id`,
      { headers: { Prefer: 'count=exact' }, prefer: 'count=exact' }
    );
    if (Array.isArray(rows) && rows.length >= DAILY_LIMIT) return { blocked: true };
    // [PERF] logging insert is fire-and-forget — must never delay or break the calc
    sb('boq_calc_log', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, tier, region, client_hash: hash }),
    }).catch(() => {});
  } catch { /* logging must never break the calc */ }
  return { blocked: false };
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const reqOrigin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ error: 'Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing).' });
  }
  const action = (req.query.action || '').toLowerCase();

  try {
    // ---- LIST ---------------------------------------------------------------
    if (action === 'list' && req.method === 'GET') {
      const rows = await sb('boq_schema_meta?select=*&order=stream,template_name');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ count: rows.length, templates: rows });
    }

    // ---- REGIONS ------------------------------------------------------------
    if (action === 'regions' && req.method === 'GET') {
      const rows = await sb('regional_factors?select=region,sub_region,currency_code,accuracy_pct&order=region,sub_region');
      const regions = {};
      for (const r of rows) {
        regions[r.region] = regions[r.region] || { currency: r.currency_code, sub_regions: [] };
        if (r.sub_region) regions[r.region].sub_regions.push(r.sub_region);
      }
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ regions });
    }

    // ---- FIELDS -------------------------------------------------------------
    if (action === 'fields' && req.method === 'GET') {
      const id = String(req.query.template || '');
      if (!/^SCHEMA-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Bad template id.' });
      const rows = await sb(`boq_schemas?template_id=eq.${id}&select=schema_json`);
      if (!rows || !rows[0]) return res.status(404).json({ error: 'Template not found.' });
      const schema = rows[0].schema_json;
      const tier = String(req.query.tier || 'T1');
      const itemUnits = {};
      const its = (schema.cost_build_up && schema.cost_build_up.usd_cost_baseline || {}).items;
      if (Array.isArray(its)) {
        its.forEach((it) => { if (it && typeof it === 'object') { const u = itemUnit(it); if (u) itemUnits[it.sub_type || it.item_name || it.name] = u; } });
      } else if (its && typeof its === 'object') {
        Object.entries(its).forEach(([k, it]) => { if (it && typeof it === 'object') { const u = itemUnit(it); if (u) itemUnits[k] = u; } });
      }
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({
        template_id: id,
        template_name: schema.template_name,
        tier,
        tier_summary: schema.tier_summary || null,
        item_units: itemUnits,
        fields: publicFields(schema, tier),
      });
    }

    // ---- CALC ---------------------------------------------------------------
    if (action === 'calc' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const id = String(body.template_id || '');
      if (!/^SCHEMA-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Bad template id.' });
      if (!body.values || typeof body.values !== 'object') {
        return res.status(400).json({ error: 'Missing values object.' });
      }
      // [PERF] rate-limit check and schema fetch overlap
      const [rl, rows] = await Promise.all([
        rateLimit(req, id, body.tier, body.region),
        sb(`boq_schemas?template_id=eq.${id}&select=schema_json`),
      ]);
      if (rl.blocked) {
        return res.status(429).json({
          error: `Free limit reached (${DAILY_LIMIT} calculations/day). Upgrade to Pro for unlimited calculations, PDF & Excel export.`,
          upgrade_url: 'https://multicalci.com/pro/',
        });
      }
      if (!rows || !rows[0]) return res.status(404).json({ error: 'Template not found.' });
      const result = await calculate(rows[0].schema_json, body);
      if (result.error) return res.status(422).json(result);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown action. Use list | regions | fields | calc.' });
  } catch (e) {
    console.error('BOQ API error:', e.message);
    return res.status(500).json({ error: 'Internal error. Try again shortly.', reason: String(e.message).slice(0, 160) });
  }
}

// exported for offline testing only
export const _internal = {
  resolveFactor, resolveBase, evalCondition, calculate, publicFields,
  tablesForTier, relatedValues, pickSizingValue, pickSubtype, bandInterval,
};
