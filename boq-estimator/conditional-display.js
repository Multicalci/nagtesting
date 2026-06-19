// ============================================================================
// conditional-display.js — client-side show_if evaluator for the BOQ estimator
// Drop this into the frontend. It mirrors the engine's compliance mini-language
// exactly, so the form shows precisely the fields the server expects.
//
// Why it's needed: fields carry conditional_display.show_if expressions like
//   "equipment_subtype IN ['Centrifuge (Basket)', 'Extractor (Pulse)']"
// The previous frontend could not parse the  X IN ['a','b']  form, so every
// conditional field was hidden (fields with show_if === null kept showing).
//
// Supports: a == 'x' | a != 'x' | a < 5 | a >= 5 | a IN [..] | a NOT IN [..] |
//           !a IN [..] | bare truthiness | clauses joined by AND / OR.
// ============================================================================

// --- public API -------------------------------------------------------------

// Return true when a field should be visible for the current form values.
// Pass field.conditional_display && field.conditional_display.show_if (or null).
export function evalShowIf(showIf, values) {
  if (!showIf) return true; // no rule → always visible
  try {
    return String(showIf)
      .split(/\s+OR\s+/i)
      .some((part) => part.split(/\s+AND\s+/i).every((c) => evalClause(c.trim(), values)));
  } catch {
    return true; // fail OPEN on the client — better to show a field than hide it
  }
}

// Group visible fields by section, in order, dropping sections that end up empty.
// `fields` is the array from /api/boq?action=fields ; `values` is the live form state.
// Returns: [{ section, section_order, fields: [...] }, ...]
export function buildVisibleSections(fields, values) {
  const visible = (fields || [])
    .filter((f) => evalShowIf(f.conditional_display && f.conditional_display.show_if, values))
    .slice()
    .sort((a, b) => (a.section_order - b.section_order) || (a.field_order - b.field_order));

  const bySection = new Map();
  for (const f of visible) {
    const key = f.section || '';
    if (!bySection.has(key)) bySection.set(key, { section: f.section, section_order: f.section_order, fields: [] });
    bySection.get(key).fields.push(f);
  }
  return [...bySection.values()]
    .filter((s) => s.fields.length > 0) // [FIX] no empty section headers
    .sort((a, b) => a.section_order - b.section_order);
}

// --- internals (kept in lock-step with api/boq.js) --------------------------

function literal(tok, values) {
  tok = tok.trim();
  const q = tok.match(/^'(.*)'$|^"(.*)"$/s);
  if (q) return q[1] !== undefined ? q[1] : q[2];
  if (/^[\d.+-]+$/.test(tok)) {
    const n = parseFloat(tok);
    if (Number.isFinite(n)) return n;
  }
  return values[tok]; // bare identifier → field value
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
  const list = parseListLiteral(hayTok);
  if (list) return list.map(String).includes(String(needle));
  const hay = literal(hayTok, values);
  if (hay == null) return false;
  if (Array.isArray(hay)) return hay.map(String).includes(String(needle));
  return String(hay).toLowerCase().includes(String(needle).toLowerCase());
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
    const an = parseFloat(a), bn = parseFloat(b);
    const bothNum = Number.isFinite(an) && Number.isFinite(bn) && typeof b !== 'string';
    switch (m[2]) {
      case '==': return bothNum ? an === bn : String(a) === String(b);
      case '!=': return bothNum ? an !== bn : String(a) !== String(b);
      case '>':  return Number.isFinite(an) && Number.isFinite(bn) && an > bn;
      case '<':  return Number.isFinite(an) && Number.isFinite(bn) && an < bn;
      case '>=': return Number.isFinite(an) && Number.isFinite(bn) && an >= bn;
      case '<=': return Number.isFinite(an) && Number.isFinite(bn) && an <= bn;
    }
  }
  const v = literal(clause, values); // bare truthiness
  return v !== undefined && v !== null && v !== '' && v !== false && v !== 0;
}

/* ── Usage sketch ────────────────────────────────────────────────────────────
   import { buildVisibleSections } from './conditional-display.js';

   // values = { equipment_subtype: 'Extractor (Pulse)', ... } from form state
   const sections = buildVisibleSections(apiResponse.fields, values);
   // re-render the form from `sections` whenever the sub-type (or any value)
   // changes. Empty sections never appear; Motor Power / Volume / Flow Rate
   // now show for Extractor (Pulse) as the data intends.
──────────────────────────────────────────────────────────────────────────── */
