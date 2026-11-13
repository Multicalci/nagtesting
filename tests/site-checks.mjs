#!/usr/bin/env node
/**
 * Site checks for the multicalci.com flowsheet simulator — run by .github/workflows/flowsheet-tests.yml
 * on every upload that touches the API, the simulator pages or the tests. They catch the mistakes that
 * break a deployment before the engine test cases even start:
 *   1. vercel.json is valid JSON, and every file named in its "functions" block exists
 *   2. api/ holds no more serverless functions than the Vercel Hobby plan deploys (12), and no helper
 *      module that belongs in api/_lib/ (a file in api/ without a default export)
 *   3. every relative import in api/ resolves to a file that is there
 *   4. the inline scripts of the simulator pages parse (and their JSON-LD blocks are valid JSON)
 *   5. the engine loads and reports its version
 *   6. the published simulator files are the protected build of the current src/ files (build hash matches,
 *      no source comments left), and .vercelignore keeps src/ and scripts/ off the site
 *   7. the retired /material-balance page redirects to the simulator and nothing links to it
 *   8. the simulator's examples, presets and "Size equipment" rules are served by the API, not shipped in the page
 * Usage: node tests/site-checks.mjs [repo root]      (exit code 1 when anything fails)
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '.');
const HOBBY_FUNCTION_LIMIT = 12;
const PAGES = ['flowsheet-simulator.html', 'flowsheet-validation.html', 'flowsheet-user-guide.html', 'src/flowsheet-simulator.source.html',
  // calculators the simulator opens pre-filled (#mb= / #case= links)
  'control-valve-sizing/index.html', 'heat-exchanger-design/index.html', 'pressure-drop-calculator/index.html', 'pressure-relief-valve-sizing/index.html',
  'orifice-flow-calculator/index.html', 'vessel-separator-sizing/index.html'];
const FUNC_EXT = /\.(js|mjs|cjs|ts|mts|py)$/;

const results = [];                         // [ok, title, detail]
const pass = (title, detail) => results.push([true, title, detail || '']);
const fail = (title, detail) => results.push([false, title, detail || '']);
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch (_e) { return false; } };

/* 1. vercel.json */
let vercel = null;
try {
  vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  pass('vercel.json is valid JSON');
} catch (e) {
  fail('vercel.json is valid JSON', e.message);
}
if (vercel && vercel.functions) {
  const missing = Object.keys(vercel.functions).filter((k) => !/[*?{[]/.test(k) && !exists(path.join(root, k)));
  if (missing.length) fail('every file in vercel.json "functions" exists', 'missing: ' + missing.join(', ') + ' — Vercel stops a deployment whose functions entry matches no file');
  else pass('every file in vercel.json "functions" exists', Object.keys(vercel.functions).length + ' entries');
}

/* 2. serverless functions in api/ (files and folders starting with _ or . are not functions) */
const apiDir = path.join(root, 'api');
const functions = [], allJs = [];
(function walk(dir, inPrivate) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    const priv = inPrivate || d.name.startsWith('_') || d.name.startsWith('.');
    if (d.isDirectory()) { if (d.name !== 'node_modules') walk(p, priv); continue; }
    if (/\.(js|mjs|cjs)$/.test(d.name)) allJs.push(p);
    if (!priv && FUNC_EXT.test(d.name) && !d.name.endsWith('.d.ts')) functions.push(p);
  }
})(apiDir, false);
if (functions.length > HOBBY_FUNCTION_LIMIT) {
  fail('api/ holds at most ' + HOBBY_FUNCTION_LIMIT + ' serverless functions', functions.length + ' found: ' + functions.map(rel).join(', ') +
    ' — the Vercel Hobby plan stops the deployment. A helper module uploaded to api/ instead of api/_lib/ is the usual cause.');
} else pass('api/ holds at most ' + HOBBY_FUNCTION_LIMIT + ' serverless functions', functions.length + ' found');
const libs = functions.filter((p) => /\.(js|mjs|cjs)$/.test(p) && !/export\s+default\b|module\.exports\b|exports\.handler\b/.test(fs.readFileSync(p, 'utf8')));
if (libs.length) fail('every file in api/ is a function (has a default export)', libs.map(rel).join(', ') + ' — no default export: a library module, which belongs in api/_lib/');
else pass('every file in api/ is a function (has a default export)');

/* 3. relative imports in api/ resolve */
const IMPORT_RES = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g,
  /\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
];
const broken = [];
let nImports = 0;
for (const f of allJs) {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const re of IMPORT_RES) {
    for (const m of src.matchAll(re)) {
      nImports++;
      const t = path.resolve(path.dirname(f), m[1]);
      if (!(exists(t) || exists(t + '.js') || exists(t + '.mjs') || exists(path.join(t, 'index.js')))) broken.push(rel(f) + ' → ' + m[1]);
    }
  }
}
if (broken.length) fail('every relative import in api/ resolves', broken.join('; ') + ' — a file is missing or sits in the wrong folder');
else pass('every relative import in api/ resolves', nImports + ' imports in ' + allJs.length + ' files');

/* 4. inline scripts of the simulator pages and of the calculators it opens parse */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-site-'));
for (const page of PAGES) {
  const file = path.join(root, page);
  if (!exists(file)) { fail(page + ' is present'); continue; }
  const html = fs.readFileSync(file, 'utf8');
  let n = 0;
  const bad = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '', code = m[2];
    if (/\bsrc\s*=/.test(attrs) || !code.trim()) continue;
    n++;
    if (/application\/ld\+json/i.test(attrs)) {
      try { JSON.parse(code); } catch (e) { bad.push('JSON-LD block ' + n + ': ' + e.message); }
      continue;
    }
    const f = path.join(tmp, page.replace(/\W/g, '_') + '_' + n + (/type\s*=\s*["']?module/i.test(attrs) ? '.mjs' : '.cjs'));
    fs.writeFileSync(f, code);
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) {
      const msg = String(e.stderr || e.message).split('\n').filter((l) => l.trim()).slice(0, 4).join(' | ').replace(f, 'script ' + n);
      bad.push(msg);
    }
  }
  if (bad.length) fail(page + ' — inline scripts parse', bad.join(' ;; '));
  else pass(page + ' — inline scripts parse', n + ' script blocks');
}
fs.rmSync(tmp, { recursive: true, force: true });

/* 5. the engine loads */
try {
  const mod = await import(pathToFileURL(path.join(root, 'api/_lib/mb-engine.js')).href);
  const eng = mod.default || mod;
  const v = eng.ENGINE_VERSION || mod.ENGINE_VERSION;
  if (typeof v === 'string' && v) pass('the engine loads', v.slice(0, v.indexOf(' (') > 0 ? v.indexOf(' (') : 40));
  else fail('the engine loads', 'api/_lib/mb-engine.js has no ENGINE_VERSION');
} catch (e) {
  fail('the engine loads', String(e && e.message || e).split('\n')[0]);
}

/* 6. protected build: the published files come from src/ through scripts/build-protected.mjs */
const PROTECTED = [['src/flowsheet-simulator.source.html', 'flowsheet-simulator.html']];
for (const [src, out] of PROTECTED) {
  if (!exists(path.join(root, src)) || !exists(path.join(root, out))) { fail(out + ' is the protected build of ' + src, 'missing file'); continue; }
  const s = fs.readFileSync(path.join(root, src), 'utf8'), o = fs.readFileSync(path.join(root, out), 'utf8');
  const h = crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
  const m = o.slice(0, 400).match(/build ([0-9a-f]{16})/);
  const leftovers = (o.match(/ROUND \d|REPO PATH:/g) || []).length;
  if (!m) fail(out + ' is the protected build of ' + src, 'no build stamp — run: node scripts/build-protected.mjs');
  else if (m[1] !== h) fail(out + ' is the protected build of ' + src, src + ' changed since the last build (' + m[1] + ' ≠ ' + h + ') — run: node scripts/build-protected.mjs');
  else if (leftovers) fail(out + ' is the protected build of ' + src, leftovers + ' source comments left in the published file');
  else pass(out + ' is the protected build of ' + src, 'build ' + h + ', ' + (o.length / 1024).toFixed(0) + ' KB from ' + (s.length / 1024).toFixed(0) + ' KB');
}
{
  const ign = exists(path.join(root, '.vercelignore')) ? fs.readFileSync(path.join(root, '.vercelignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()) : [];
  const need = ['src/', 'scripts/'].filter((x) => !ign.includes(x) && !ign.includes(x.slice(0, -1)));
  if (need.length) fail('.vercelignore keeps the readable sources off the site', 'add: ' + need.join(', '));
  else pass('.vercelignore keeps the readable sources off the site', 'src/ and scripts/ are not deployed');
}
/* the retired single-unit worksheet: its address redirects to the simulator and no page links to it */
{
  const red = (vercel && vercel.redirects || []).filter((r) => /^\/material-balance(\.html)?$/.test(r.source) && r.destination === '/flowsheet-simulator');
  if (red.length < 2) fail('/material-balance redirects to the flowsheet simulator', 'vercel.json needs redirects for /material-balance and /material-balance.html');
  else pass('/material-balance redirects to the flowsheet simulator');
  const linking = [];
  (function walk(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name === 'node_modules' || d.name === 'tests') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.name.endsWith('.html') && /href=["']\/material-balance(\.html)?["'#?]/.test(fs.readFileSync(p, 'utf8'))) linking.push(rel(p));
    }
  })(root);
  if (linking.length) fail('no page links to the retired /material-balance page', linking.join(', '));
  else pass('no page links to the retired /material-balance page');
}

/* 8. simulator content and "Size equipment" rules live on the server, not in the page */
{
  const pub = fs.readFileSync(path.join(root, 'flowsheet-simulator.html'), 'utf8');
  const srcp = path.join(root, 'src/flowsheet-simulator.source.html');
  const src = exists(srcp) ? fs.readFileSync(srcp, 'utf8') : '';
  // a few signatures of the moved content: steam-table latent heat, a Sch 40 bore, an example, a preset, a sizing rule
  const SIG = ['2120.2', '154.06', '100 bar / 500 °C steam', 'AGA 8 Gulf Coast reference', 'smallest Schedule 40 size'];
  const left = SIG.filter((x) => pub.includes(x) || src.includes(x));
  if (left.length) fail('the simulator page carries no examples, presets or sizing rules', 'found in the page: ' + left.join(', '));
  else pass('the simulator page carries no examples, presets or sizing rules', 'served by ?module=sim-examples / sim-presets / size-equipment');
  try {
    const C = (await import(pathToFileURL(path.join(root, 'api/_lib/sim-content.js')).href)).default;
    const L = C.examplesList(), ids = new Set(L.map((x) => x.id)), P = C.presetsList();
    const broken = L.filter((x) => { const e = C.exampleById(x.id); return !e || !e.model || !Array.isArray(e.model.blocks) || !e.model.blocks.length; });
    if (L.length < 20 || ids.size !== L.length || broken.length || P.length < 100) fail('simulator examples and presets load', L.length + ' examples (' + ids.size + ' ids), ' + P.length + ' presets' + (broken.length ? ', broken: ' + broken.map((x) => x.id).join(', ') : ''));
    else pass('simulator examples and presets load', L.length + ' examples, ' + P.length + ' typical streams');
  } catch (e) { fail('simulator examples and presets load', String(e && e.message || e).split('\n')[0]); }
  try {
    const S = (await import(pathToFileURL(path.join(root, 'api/_lib/sim-sizing.js')).href)).default;
    const E = (await import(pathToFileURL(path.join(root, 'api/_lib/mb-engine.js')).href)).default;
    const run = async (name, streams, params) => E.MODULES[name]({ streams, params });
    const gas = { mass_flow_kg_h: 10000, T_K: 313.15, P_bar: 20, components: [{ key: 'CH4', mass_fraction: 0.9 }, { key: 'C2H6', mass_fraction: 0.1 }] };
    const r = await S.sizeEquipment({ streams: [gas], params: { kind: 'line', name: 'S1', property_package: { model: 'pr' }, pkg_model: 'pr' } }, run);
    const sh = r && r.sheet;
    const ok = sh && sh.link && /^\/pressure-drop-calculator#mb=/.test(sh.link.href) && sh.fields.length === 2 && sh.fields[0].value === 154.06;
    const v = await S.sizeEquipment({ streams: [], params: { kind: 'heater', nIn: 1, Q_kW: 500,
      ri: { T_K: 303.15, P_bar: 5, mass_flow_kg_h: 5000, vapour_fraction: 0, components: [{ key: 'H2O', mass_fraction: 1 }] },
      ro: { T_K: 363.15, vapour_fraction: 0 } } }, run);
    const okH = v && v.links && v.links.buttons.length === 1 && /4\.5 bar a/.test(v.links.note);
    if (ok && okH) pass('"Size equipment" runs on the server', 'gas line → 6" Sch 40 start, heater → 4.5 bar a steam');
    else fail('"Size equipment" runs on the server', JSON.stringify(r).slice(0, 160) + ' | ' + JSON.stringify(v).slice(0, 120));
  } catch (e) { fail('"Size equipment" runs on the server', String(e && e.message || e).split('\n')[0]); }
}

/* report */
const failed = results.filter((r) => !r[0]);
for (const [ok, title, detail] of results) console.log((ok ? '✓ ' : '✗ ') + title + (detail ? '  — ' + detail : ''));
console.log(failed.length ? `\n${failed.length} check(s) failed` : `\nall ${results.length} checks passed`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['### Site checks', '', '| | Check | Detail |', '|---|---|---|',
    ...results.map(([ok, t, d]) => `| ${ok ? '✅' : '❌'} | ${t} | ${String(d).replace(/\|/g, '\\|').slice(0, 400)} |`), ''];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}
process.exit(failed.length ? 1 : 0);
