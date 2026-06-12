// ============================================================================
// api/boq.js — multicalci.com BOQ Calculator API (Vercel serverless) v1.0
// 2026-06-11 · Works with supabase_setup_v3.sql + boq_schema_vault.sql
//
// Routes (single function, query param `action`):
//   GET  /api/boq?action=list
//        -> all 114 template metadata rows (safe; powers picker & search)
//   GET  /api/boq?action=fields&template=SCHEMA-XXX&tier=T2
//        -> field definitions ONLY for that template/tier (form rendering)
//   POST /api/boq?action=calc
//        body: { template_id, tier, region, sub_region, currency,
//                equipment_origin, values: { spec_key: value, ... } }
//        -> computed BOQ lines + compliance findings. No formulas leave server.
//
// Vercel env vars (Settings -> Environment Variables):
//   SUPABASE_URL          https://YOURPROJECT.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (server-only; bypasses RLS)
//   BOQ_IP_SALT           any random string (hashes IPs for rate limiting)
//   BOQ_FREE_DAILY_LIMIT  optional, default 20 calcs/IP/day
//   ALLOWED_ORIGIN        optional, default https://multicalci.com
// ============================================================================

// Normalize: tolerate a pasted REST URL or trailing slash in the env var
const SB_URL = (process.env.SUPABASE_URL || '')
  .replace(/\/rest\/v1\/?$/, '')
  .replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DAILY_LIMIT = parseInt(process.env.BOQ_FREE_DAILY_LIMIT || '20', 10);
const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://multicalci.com';

// ── Supabase REST (service role) ─────────────────────────────────────────────
// New-format keys (sb_secret_...) go in the apikey header only; the
// Authorization: Bearer header is added only for legacy JWT keys (eyJ...),
// because the gateway rejects non-JWT bearer tokens.
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

async function sha256Hex(s) {
  const data = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function tierNum(t) {
  const m = String(t || 'T1').toUpperCase().match(/([123])/);
  return m ? parseInt(m[1], 10) : 1;
}

// ── Factor table resolution ──────────────────────────────────────────────────
// Tables come in two key styles:
//  (a) descriptive strings that exactly match dropdown option values
//  (b) range-encoded keys for numeric inputs:
//      lte_120_c | 120_to_200_c | gt_350_c | lte_20_barg_ASME150 | 50_to_100_barg_ASME600
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

function resolveFactor(table, fieldValues) {
  // Returns { factor, matchedKey, source } or null if nothing in this table applies.
  const entries = Object.entries(table).filter(
    ([k, v]) => k !== 'note' && typeof v === 'number'
  );
  if (!entries.length) return null;

  const isRangeTable = entries.every(([k]) => /^(lte?|gte?|gt|lt)_\d|^\d+(?:\.\d+)?_to_\d/.test(k));

  if (isRangeTable) {
    for (const v of Object.values(fieldValues)) {
      const n = num(v);
      if (n === null) continue;
      for (const [k, f] of entries) {
        if (rangeKeyMatch(k, n)) return { factor: f, matchedKey: k, source: String(v) };
      }
    }
    return null;
  }
  // Descriptive table: exact match against any provided string value
  for (const v of Object.values(fieldValues)) {
    if (typeof v !== 'string' || !v) continue;
    for (const [k, f] of entries) {
      if (k === v) return { factor: f, matchedKey: k, source: v };
    }
  }
  // Tolerant fallback: case-insensitive prefix match (handles minor UI drift)
  for (const v of Object.values(fieldValues)) {
    if (typeof v !== 'string' || v.length < 4) continue;
    const lv = v.toLowerCase();
    for (const [k, f] of entries) {
      const lk = k.toLowerCase();
      if (lk.startsWith(lv) || lv.startsWith(lk)) return { factor: f, matchedKey: k, source: v };
    }
  }
  return null;
}

// Range tables only apply to the field they describe. To avoid a pressure value
// matching a temperature table, prefer values whose spec_key relates to the
// table name; fall back to any value only if nothing related is provided.
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

// ── Baseline cost resolution ────────────────────────────────────────────────
// Item shapes seen across the 114 schemas (in priority order):
//   usd_per_unit | usd | usd_per_manhour (× activity_manhours)
//   scaling: usd × (param_value / reference)^exponent
//   fallback: midpoint of range_low / range_high
function resolveBase(baseline, subtype, values, notes) {
  const items = baseline && baseline.items;
  let item = null;
  const want = String(subtype || '').trim().toLowerCase();
  if (Array.isArray(items)) {
    // list-form library: entries identified by sub_type / item_name / name
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

  // Shape: flat list price (e.g. PLC modules)
  if (item.usd_list_price != null) {
    return item.usd_list_price;
  }

  // Shape: unit-rate keys like usd_per_m2 / usd_per_m / usd_per_tonne / usd_per_kg
  for (const [k, v] of Object.entries(item)) {
    const m = k.match(/^usd_per_([a-z0-9]+)$/i);
    if (m && typeof v === 'number' && m[1].toLowerCase() !== 'manhour') {
      const unit = m[1];
      // quantity drivers commonly used by civil/piping unit-rate schemas
      const qv =
        num(values.area) ?? num(values.length) ?? num(values.weight) ??
        num(values.volume) ?? num(values.measured_quantity) ?? null;
      if (qv !== null) {
        notes.push(`Unit rate: ${v} USD/${unit} × ${qv} ${unit}.`);
        return v * qv;
      }
      notes.push(`Unit rate ${v} USD/${unit} — multiply by your measured quantity (the Quantity field is treated as ${unit}).`);
      return v; // per-unit; quantity multiplier handles the rest
    }
  }

  // Shape: cost equation "C = A * (P / R)^E" (e.g. turbines, generators)
  if (typeof item.cost_equation === 'string') {
    const m = item.cost_equation.match(
      /=\s*([\d.eE+]+)\s*\*\s*\(\s*\w+\s*\/\s*([\d.]+)\s*\)\s*\^\s*([\d.]+)/
    );
    if (m) {
      const A = parseFloat(m[1]), R = parseFloat(m[2]), E = parseFloat(m[3]);
      const basis = String(item.sizing_basis || '').toLowerCase();
      let pv = null;
      for (const [k, v] of Object.entries(values)) {
        const lk = k.toLowerCase();
        if (['mw','power','output','capacity','rating','duty','sizing'].some((h) => lk.includes(h) || basis.includes(h) && lk.includes(h.slice(0,4)))) {
          const n = num(v); if (n !== null) { pv = n; break; }
        }
      }
      if (pv === null) pv = num(values.sizing_value);
      if (pv !== null) {
        if (item.valid_range_min_MW != null && pv < item.valid_range_min_MW) notes.push(`Sizing ${pv} below equation valid range — extrapolated.`);
        if (item.valid_range_max_MW != null && pv > item.valid_range_max_MW) notes.push(`Sizing ${pv} above equation valid range — extrapolated.`);
        notes.push(`Cost equation: ${A} × (${pv}/${R})^${E} (${item.sizing_basis || 'sizing basis'}).`);
        return A * Math.pow(pv / R, E);
      }
      notes.push(`Provide ${item.sizing_basis || 'the sizing parameter'} to evaluate the cost equation — reference point used.`);
      return A; // value at reference size as a fallback
    }
  }

  // Shape: per-size rate maps (e.g. rates_per_joint_usd keyed by DN)
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
        notes.push(`Rate basis: ${k} → "${hit[0]}" = ${hit[1]} USD.`);
        return hit[1];
      }
    }
    notes.push(`Select a size option to price from ${k} — smallest size used as placeholder.`);
    return entries[0][1];
  }

  // Activity (man-hour) items
  if (item.usd_per_manhour != null) {
    const mh = num(values.activity_manhours) || num(values.manhours) || num(values.man_hours);
    if (mh) {
      notes.push(`Labour basis: ${item.usd_per_manhour} USD/man-hour × ${mh} man-hours.`);
      return item.usd_per_manhour * mh;
    }
    if (item.usd == null && item.usd_per_unit == null) {
      notes.push('Activity item: provide man-hours (activity_manhours) for labour-based pricing.');
      return null;
    }
  }

  let base = item.usd_per_unit != null ? item.usd_per_unit : item.usd;

  // Parametric scaling (e.g. BFP: usd × (motor_kW / reference_kW)^0.7)
  if (item.scaling_parameter && item.scaling_exponent && base != null) {
    const ref =
      item.reference_power_kW || item.reference_value || item.reference || null;
    // find the user value: match scaling_parameter against provided spec keys
    const wanted = item.scaling_parameter.toLowerCase().replace(/_kw$/, '');
    let pv = null;
    for (const [k, v] of Object.entries(values)) {
      if (k.toLowerCase().includes(wanted) || wanted.includes(k.toLowerCase())) {
        pv = num(v);
        if (pv != null) break;
      }
    }
    if (pv == null) pv = num(values.motor_power);
    if (pv != null && ref) {
      base = base * Math.pow(pv / ref, item.scaling_exponent);
      notes.push(
        `Parametric scaling: (${pv}/${ref})^${item.scaling_exponent} applied to base.`
      );
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
  if (item.verify) notes.push('Baseline flagged verify=true: public-benchmark estimate pending calibration.');
  return base;
}

// ── Compliance mini-language evaluator (NO eval) ─────────────────────────────
// Handles: a == 'x' | a != 'x' | a < 5 | a >= 5 | 'x' IN a | !'x' IN a |
//          bare truthiness | clauses joined by AND / OR. Parse failure => skip.
function evalCondition(expr, values) {
  try {
    const orParts = expr.split(/\s+OR\s+/i);
    return orParts.some((part) =>
      part.split(/\s+AND\s+/i).every((clause) => evalClause(clause.trim(), values))
    );
  } catch {
    return false; // fail-safe: a rule we can't parse never fires
  }
}
function literal(tok, values) {
  tok = tok.trim();
  const q = tok.match(/^'(.*)'$|^"(.*)"$/s);
  if (q) return q[1] !== undefined ? q[1] : q[2];
  const n = num(tok);
  if (n !== null && /^[\d.+-]+$/.test(tok)) return n;
  return values[tok]; // bare identifier -> field value
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
  const v = literal(clause, values); // bare truthiness
  return v !== undefined && v !== null && v !== '' && v !== false && v !== 0;
}
function inTest(needleTok, hayTok, values) {
  const needle = literal(needleTok, values);
  const hay = literal(hayTok, values);
  if (needle == null || hay == null) return false;
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
// Apply only the factor tables the tier formula mentions (fuzzy name match);
// if the formula text is missing/unparseable, T1 applies all descriptive
// tables conservatively.
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

// ── The calculation ──────────────────────────────────────────────────────────
async function calculate(schema, body) {
  const cb = schema.cost_build_up || {};
  const values = body.values || {};
  const tier = body.tier || 'T1';
  const notes = [];
  const qty = num(values.quantity) || 1;

  // 1) Subtype: explicit, or the first dropdown field's value
  let subtype = values.equipment_subtype;
  if (!subtype) {
    const dd = (schema.fields || []).find((f) => f.type === 'dropdown' && f.spec_key);
    subtype = dd ? values[dd.spec_key] : null;
  }

  // 2) Baseline USD (2024)
  let base = resolveBase(cb.usd_cost_baseline, subtype, values, notes);
  if (base == null) return { error: 'NO_BASELINE', notes };

  // 3) Multiplier tables for this tier
  const applied = [];
  let factorProduct = 1;
  for (const [name, table] of tablesForTier(cb, tier)) {
    if (typeof table !== 'object') continue;
    const hit = resolveFactor(table, relatedValues(name, values));
    if (hit) {
      factorProduct *= hit.factor;
      applied.push({ table: name, matched: hit.matchedKey, factor: hit.factor });
    }
  }

  // 4) Escalation from Supabase view (current index ÷ 2024 schema base)
  let escalation = 1;
  try {
    const rows = await sb(
      `template_index_resolution?template_id=eq.${encodeURIComponent(schema.template_id)}&select=escalation_factor,universal_code`
    );
    if (rows && rows[0]) {
      escalation = Number(rows[0].escalation_factor) || 1;
      notes.push(`Escalation ×${escalation.toFixed(4)} (${rows[0].universal_code} vs 2024 base).`);
    }
  } catch (e) {
    notes.push('Escalation lookup failed — using ×1.0 (2024 basis).');
  }

  // 5) Regional factors + duty from Supabase
  const region = body.region || 'India';
  const subRegion = body.sub_region || null;
  let rf = { equipment_factor: 1, labour_factor: 1, civil_factor: 1, inland_freight_pct: 0, contingency_pct: 10, accuracy_pct: 25, aace_class: 'Class 4', currency_code: 'USD' };
  try {
    let q = `regional_factors?region=eq.${encodeURIComponent(region)}&select=*`;
    if (subRegion) q += `&sub_region=eq.${encodeURIComponent(subRegion)}`;
    const rows = await sb(q);
    if (rows && rows[0]) rf = rows[0];
    else notes.push(`Region "${region}" not found — world-average factors (×1.0) used.`);
  } catch { notes.push('Regional factor lookup failed — ×1.0 used.'); }

  let dutyPct = 0;
  if ((body.equipment_origin || 'Local') === 'Imported') {
    const dutyCat =
      (cb.regional_factors && cb.regional_factors.equipment_duty_category) || 'Process equipment';
    try {
      const rows = await sb(
        `import_duties?region=eq.${encodeURIComponent(region)}&equipment_category=eq.${encodeURIComponent(dutyCat)}&select=total_landed_adder_pct,indicative_duty_pct`
      );
      if (rows && rows[0]) {
        dutyPct = Number(rows[0].total_landed_adder_pct ?? rows[0].indicative_duty_pct) || 0;
        notes.push(`Import duty applied: ${dutyPct}% landed adder (${dutyCat}, ${region}). Indicative — verify HS code.`);
      }
    } catch { /* duty stays 0 */ }
  }

  // 6) Build lines (USD first)
  const adders = cb.adders || {};
  const isActivity = notes.some((n) => n.startsWith('Labour basis'));
  const supplyFactor = isActivity ? Number(rf.labour_factor) : Number(rf.equipment_factor);
  const supplyUsd = base * factorProduct * qty * escalation * (supplyFactor || 1);

  const lines = [];
  lines.push({ line: isActivity ? 'Labour / activity cost' : 'Equipment supply (ex-works, regionalised)', usd: round2(supplyUsd) });

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

  // 7) Output currency
  const outCur = (body.currency || 'USD').toUpperCase();
  let fx = 1;
  if (outCur !== 'USD') {
    try {
      const rows = await sb(`latest_currency_rates?from_currency=eq.USD&to_currency=eq.${encodeURIComponent(outCur)}&select=rate`);
      if (rows && rows[0]) fx = Number(rows[0].rate) || 1;
      else { notes.push(`No FX rate for ${outCur} — totals left in USD.`); }
    } catch { notes.push('FX lookup failed — totals in USD.'); }
  }

  // 8) Compliance rules — evaluated HERE, never shipped to the client
  const findings = [];
  for (const r of schema.compliance_rules || []) {
    if (r.condition_expr && evalCondition(r.condition_expr, values)) {
      findings.push({ severity: r.severity || 'warning', message: r.message, basis: r.engineering_basis || null });
    }
  }

  // 9) Spec string
  let spec = null;
  if (typeof schema.spec_formula === 'string') {
    spec = schema.spec_formula.replace(/\{(\w+)\}/g, (_, k) =>
      values[k] !== undefined && values[k] !== null && values[k] !== '' ? values[k] : '—'
    );
  }

  const accuracy = `±${rf.accuracy_pct || (t === 1 ? 30 : t === 2 ? 20 : 10)}%`;
  return {
    template_id: schema.template_id,
    template_name: schema.template_name,
    tier, accuracy, region, sub_region: rf.sub_region || subRegion,
    quantity: qty, spec,
    factors_applied: applied,
    lines: lines.map((l) => ({ ...l, amount: round2(l.usd * fx) })),
    total: { usd: round2(totalUsd), currency: outCur, amount: round2(totalUsd * fx), fx_rate: fx },
    compliance: findings,
    notes,
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
    await sb('boq_calc_log', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, tier, region, client_hash: hash }),
    });
  } catch { /* logging must never break the calc */ }
  return { blocked: false };
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const reqOrigin = req.headers.origin || '';
  const allowed = [ORIGIN, 'http://localhost:3000', 'http://127.0.0.1:3000'];
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(reqOrigin) ? reqOrigin : ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!SB_URL || !SB_KEY) {
    return res.status(500).json({ error: 'Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY missing).' });
  }
  const action = (req.query.action || '').toLowerCase();

  try {
    // ---- LIST: public metadata for the picker -------------------------------
    if (action === 'list' && req.method === 'GET') {
      const rows = await sb('boq_schema_meta?select=*&order=stream,template_name');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ count: rows.length, templates: rows });
    }

    // ---- FIELDS: form definition for one template/tier ----------------------
    if (action === 'fields' && req.method === 'GET') {
      const id = String(req.query.template || '');
      if (!/^SCHEMA-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Bad template id.' });
      const rows = await sb(`boq_schemas?template_id=eq.${id}&select=schema_json`);
      if (!rows || !rows[0]) return res.status(404).json({ error: 'Template not found.' });
      const schema = rows[0].schema_json;
      const tier = String(req.query.tier || 'T1');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({
        template_id: id,
        template_name: schema.template_name,
        tier,
        tier_summary: schema.tier_summary || null,
        fields: publicFields(schema, tier),
        // deliberately NOT included: library rates, formulas, multiplier
        // tables, compliance rules, cost_build_up — those never leave server.
      });
    }

    // ---- CALC: the engine ----------------------------------------------------
    if (action === 'calc' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const id = String(body.template_id || '');
      if (!/^SCHEMA-[A-Z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Bad template id.' });
      if (!body.values || typeof body.values !== 'object') {
        return res.status(400).json({ error: 'Missing values object.' });
      }
      const rl = await rateLimit(req, id, body.tier, body.region);
      if (rl.blocked) {
        return res.status(429).json({
          error: `Free limit reached (${DAILY_LIMIT} calculations/day). Upgrade to Pro for unlimited calculations, PDF & Excel export.`,
          upgrade_url: 'https://multicalci.com/pro/',
        });
      }
      const rows = await sb(`boq_schemas?template_id=eq.${id}&select=schema_json`);
      if (!rows || !rows[0]) return res.status(404).json({ error: 'Template not found.' });
      const result = await calculate(rows[0].schema_json, body);
      if (result.error) return res.status(422).json(result);
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Unknown action. Use list | fields | calc.' });
  } catch (e) {
    console.error('BOQ API error:', e.message);
    return res.status(500).json({ error: 'Internal error. Try again shortly.', reason: String(e.message).slice(0, 160) });
  }
}

// exported for offline testing only
export const _internal = { resolveFactor, resolveBase, evalCondition, calculate, publicFields, tablesForTier, relatedValues };
