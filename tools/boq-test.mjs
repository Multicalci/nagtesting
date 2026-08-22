#!/usr/bin/env node
/**
 * boq-test — behavioural test harness for BOQ schemas.
 *
 * Imports the REAL engine from boq.js via its `_internal` export, so there is no
 * port to drift out of sync. Every DB lookup inside calculate() fails closed
 * (escalation 1.0, no regional factors, no duty), so runs are deterministic and
 * need no network or credentials.
 *
 *   node boq-test.mjs check   ./SCHEMAS              # all schemas
 *   node boq-test.mjs check   ./SCHEMAS/X.json -v    # one, verbose
 *   node boq-test.mjs golden  ./SCHEMAS -o g.json    # snapshot prices
 *   node boq-test.mjs compare ./SCHEMAS -g g.json    # regression vs snapshot
 *   node boq-test.mjs calc    ./SCHEMAS/X.json --set area=500 --set moc=SS316L
 *
 * Exit code 0 = no FAILs, 1 = at least one FAIL. Suitable for CI / pre-commit.
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENGINE = process.env.BOQ_ENGINE || './boq.js';
const { _internal } = await import(pathToFileURL(resolve(ENGINE)).href);
const { calculate, tablesForTier, pickSubtype } = _internal;

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', n: '\x1b[0m', b: '\x1b[1m' };
const optVal = (o) => (typeof o === 'string' ? o : (o && (o.value ?? o.label ?? o.name)) ?? '');
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

function loadSchemas(p) {
  const st = statSync(p);
  const files = st.isDirectory()
    ? readdirSync(p).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => join(p, f))
    : [p];
  return files.map((f) => {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    return { id: s.template_id || basename(f, '.json'), file: f, schema: s };
  });
}

const items = (s) => (s.cost_build_up?.usd_cost_baseline?.items) || {};
const itemNames = (s) => { const it = items(s); return Array.isArray(it)
  ? it.map((x) => x.sub_type || x.item_name || x.name).filter(Boolean)
  : Object.keys(it); };

async function price(schema, values, tier = 'T3') {
  const r = await calculate(schema, { tier, values });
  return r?.error ? null : r.total.usd;
}

/** Representative values for one field, from the schema's own definition. */
function pool(f) {
  if (f.options?.length) return f.options.map(optVal).filter((x) => x !== '');
  if (f.type === 'number') {
    const lo = num(f.min), hi = num(f.max), d = num(f.default);
    const v = [lo, d, hi].filter((x) => x !== null);
    if (lo !== null && hi !== null) v.push((lo + hi) / 2);
    return [...new Set(v)].sort((a, b) => a - b);
  }
  return f.default != null ? [f.default] : [];
}

async function checkSchema({ id, schema }, opts = {}) {
  const out = [];
  const add = (lvl, code, msg) => out.push({ lvl, code, msg });
  const names = itemNames(schema);
  const cb = schema.cost_build_up || {};

  if (!names.length) { add('FAIL', 'no-items', 'no baseline items'); return out; }

  const sub = names[0];
  const base = { equipment_subtype: sub, quantity: 1 };

  // ── 1. every baseline item must price
  for (const n of names) {
    const p = await price(schema, { equipment_subtype: n, quantity: 1 });
    if (p === null) add('FAIL', 'unpriceable', `item "${n}" returns NO_BASELINE`);
  }

  // ── 2. every MANDATORY input must move the price
  for (const f of schema.fields || []) {
    const k = f.spec_key;
    if (!k || k === 'quantity' || k === 'equipment_subtype' || !f.mandatory) continue;
    const vals = pool(f);
    if (vals.length < 2) continue;
    const probes = f.type === 'number' ? [vals[0], vals[vals.length - 1]] : vals;
    const seen = new Set();
    for (const v of probes) seen.add(await price(schema, { ...base, [k]: v }));
    if (seen.size <= 1) add('FAIL', 'dead-input', `mandatory "${k}" (${f.type}) does not change the price`);
  }

  // ── 3. factor tables named in a formula must exist
  const tabs = cb.cost_multiplier_tables || {};
  const fml = [cb.tier_1_formula, cb.tier_2_formula, cb.full_formula].filter(Boolean).join(' ').toLowerCase();
  const named = new Set([...fml.matchAll(/([a-z_]+_(?:factor|premium|multiplier))\s*\(/g)].map((m) => m[1]));
  for (const t of named) {
    if (!Object.keys(tabs).some((x) => x.toLowerCase() === t)) {
      add('FAIL', 'missing-table', `formula names "${t}" but cost_multiplier_tables has no such table`);
    }
  }

  // ── 4. every table needs a 1.00 datum, else every price is skewed
  for (const [tn, tv] of Object.entries(tabs)) {
    if (typeof tv !== 'object') continue;
    const vals = Object.entries(tv).filter(([k, v]) => k !== 'note' && typeof v === 'number').map(([, v]) => v);
    if (vals.length && !vals.some((v) => Math.abs(v - 1) < 1e-9)) {
      add('WARN', 'no-unity', `table "${tn}" has no 1.00 datum — every price is scaled by it`);
    }
  }

  // ── 5. tier gating: a tier that selects NO table but declares one in its formula
  for (const t of ['T1', 'T2', 'T3']) {
    if (!Object.keys(tabs).length) break;
    const used = tablesForTier(cb, t);
    if (!used.length) add('WARN', 'tier-empty', `${t} selects no factor table`);
  }

  // ── 6. compliance rules: can each fire?
  for (const r of schema.compliance_rules || []) {
    if (!r.condition_expr) { add('WARN', 'rule-noexpr', `${r.rule_id} has no condition_expr`); continue; }
    if (!(await ruleCanFire(schema, r.condition_expr))) {
      add('FAIL', 'rule-dead', `${r.rule_id} (${r.severity || 'warning'}) can never fire`);
    }
  }

  // ── 7. uncalibrated prices
  const it = items(schema);
  const list = Array.isArray(it) ? it : Object.values(it);
  const unver = list.filter((v) => v && v.verify).length;
  if (unver) add('WARN', 'uncalibrated', `${unver}/${list.length} baseline prices carry verify=true`);

  // ── 8. size response
  const drivers = (schema.fields || []).filter(
    (f) => f.type === 'number' && f.spec_key && f.spec_key !== 'quantity' && num(f.min) !== null && num(f.max) !== null);
  let best = 1, driver = null;
  for (const f of drivers) {
    const lo = await price(schema, { ...base, [f.spec_key]: num(f.min) });
    const hi = await price(schema, { ...base, [f.spec_key]: num(f.max) });
    if (lo && hi && hi / lo > best) { best = hi / lo; driver = f.spec_key; }
  }
  if (drivers.length && best < 1.05) {
    add('WARN', 'size-flat', `price does not respond to any numeric field (checked ${drivers.length})`);
  }
  if (opts.verbose) add('INFO', 'size-resp', `max size response ${best.toFixed(2)}x${driver ? ` via ${driver}` : ''}`);
  return out;
}

const { evalCondition } = _internal;
async function ruleCanFire(schema, expr) {
  const fields = (schema.fields || []).filter((f) => f.spec_key);
  const idents = new Set([...expr.replace(/'[^']*'|"[^"]*"/g, "''").matchAll(/\b([a-z_][a-z0-9_]*)\b/g)].map((m) => m[1]));
  const keys = fields.filter((f) => idents.has(f.spec_key)).slice(0, 3);
  if (!keys.length) return evalCondition(expr, {});
  const pools = keys.map((f) => [...pool(f).slice(0, 24), undefined]);
  const rec = (i, acc) => {
    if (i === keys.length) return evalCondition(expr, acc);
    for (const v of pools[i]) {
      const nx = { ...acc };
      if (v === undefined) delete nx[keys[i].spec_key]; else nx[keys[i].spec_key] = v;
      if (rec(i + 1, nx)) return true;
    }
    return false;
  };
  return rec(0, {});
}

// ── golden snapshot ──────────────────────────────────────────────────────────
async function goldenOne(schema) {
  const g = {};
  for (const n of itemNames(schema)) {
    for (const t of ['T1', 'T2', 'T3']) {
      const vals = { equipment_subtype: n, quantity: 1 };
      for (const f of schema.fields || []) if (f.default != null && f.spec_key) vals[f.spec_key] = f.default;
      vals.equipment_subtype = n;
      g[`${n}|${t}|defaults`] = await price(schema, vals, t);
      for (const f of schema.fields || []) {
        const k = f.spec_key; if (!k || k === 'equipment_subtype') continue;
        for (const v of pool(f).slice(0, 6)) g[`${n}|${t}|${k}=${v}`] = await price(schema, { ...vals, [k]: v }, t);
      }
    }
  }
  return g;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); return i < 0 ? null : rest[i + 1]; };
const has = (n) => rest.includes(n);

if (!cmd || !target) { console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]); process.exit(2); }
const loaded = loadSchemas(target);

if (cmd === 'check') {
  let nf = 0, nw = 0, bad = 0;
  for (const s of loaded) {
    const res = await checkSchema(s, { verbose: has('-v') });
    const f = res.filter((r) => r.lvl === 'FAIL'), w = res.filter((r) => r.lvl === 'WARN');
    nf += f.length; nw += w.length; if (f.length) bad++;
    const tag = f.length ? `${C.r}FAIL${C.n}` : w.length ? `${C.y}WARN${C.n}` : `${C.g} OK ${C.n}`;
    console.log(`${tag} ${s.id.padEnd(28)} ${String(f.length).padStart(3)}F ${String(w.length).padStart(3)}W`);
    if (has('-v') || f.length) for (const r of res)
      if (r.lvl !== 'INFO' || has('-v'))
        console.log(`      ${r.lvl === 'FAIL' ? C.r : r.lvl === 'WARN' ? C.y : C.d}${r.code.padEnd(14)}${C.n} ${r.msg}`);
  }
  console.log(`\n${loaded.length} schemas · ${nf} FAIL · ${nw} WARN · ${bad} schemas with at least one FAIL`);
  process.exit(nf ? 1 : 0);
}

if (cmd === 'golden') {
  const g = {};
  for (const s of loaded) g[s.id] = await goldenOne(s.schema);
  const out = flag('-o') || 'golden.json';
  writeFileSync(out, JSON.stringify(g, null, 1));
  const n = Object.values(g).reduce((a, x) => a + Object.keys(x).length, 0);
  console.log(`snapshot: ${loaded.length} templates, ${n} cases -> ${out}`);
  process.exit(0);
}

if (cmd === 'compare') {
  const g = JSON.parse(readFileSync(flag('-g') || 'golden.json', 'utf8'));
  let moved = 0, checked = 0;
  for (const s of loaded) {
    const now = await goldenOne(s.schema), was = g[s.id] || {};
    for (const [k, v] of Object.entries(was)) {
      checked++;
      const n = now[k];
      if (n === v) continue;
      if (v && n && Math.abs(n - v) / Math.abs(v) < 1e-9) continue;
      moved++;
      console.log(`${C.r}MOVED${C.n} ${s.id} ${k}\n        was ${v}  now ${n}`);
    }
  }
  console.log(moved ? `\n${moved} of ${checked} cases moved` : `\n${C.g}NO PRICE DRIFT${C.n} — ${checked} cases identical`);
  process.exit(moved ? 1 : 0);
}

if (cmd === 'calc') {
  const s = loaded[0];
  const vals = { quantity: 1 };
  for (const f of s.schema.fields || []) if (f.default != null && f.spec_key) vals[f.spec_key] = f.default;
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--set') {
    const [k, ...v] = rest[i + 1].split('='); const raw = v.join('=');
    vals[k] = num(raw) !== null && String(num(raw)) === raw ? num(raw) : raw;
  }
  const r = await calculate(s.schema, { tier: flag('--tier') || 'T3', values: vals });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

console.error(`unknown command "${cmd}" — use check | golden | compare | calc`);
process.exit(2);
