#!/usr/bin/env node
/**
 * multicalci.com — build-time sitemap generator
 * ---------------------------------------------
 * Scans the repository for real, deployable pages and writes sitemap.xml
 * (plus a sitemap index if the site ever exceeds the per-file limit).
 *
 * Usage:
 *   node scripts/generate-sitemap.mjs            # write sitemap.xml
 *   node scripts/generate-sitemap.mjs --check    # exit 1 if sitemap.xml is stale
 *   node scripts/generate-sitemap.mjs --dry-run  # print, write nothing
 *
 * Config lives in sitemap.config.json at the repo root.
 * No dependencies. Node 18+.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const DRY = args.has('--dry-run');

/* ------------------------------------------------------------------ config */

const DEFAULTS = {
  siteUrl: 'https://www.multicalci.com',
  pagesDir: '.',
  outFile: 'sitemap.xml',
  trailingSlash: true,
  maxUrlsPerFile: 45000,
  excludeDirs: ['node_modules', '.git', '.github', 'api', 'assets', 'static',
                'scripts', 'dist', '.vercel', 'public/assets'],
  excludeRoutes: ['/404', '/500', '/thank-you', '/privacy-draft'],
  extraRoutes: [],
  rules: [
    { match: '^/$',                                priority: '1.0', changefreq: 'weekly'  },
    { match: '-calculator/?$',                     priority: '0.9', changefreq: 'monthly' },
    { match: '^/unit-converter/?$',                priority: '0.9', changefreq: 'monthly' },
    { match: '^/unit-converter/',                  priority: '0.8', changefreq: 'monthly' },
    { match: '^/engineering-standards-finder/?$',  priority: '0.8', changefreq: 'monthly' },
    { match: '^/engineering-standards-finder/',    priority: '0.6', changefreq: 'yearly'  },
    { match: '.*',                                 priority: '0.7', changefreq: 'monthly' }
  ]
};

function loadConfig() {
  const p = path.join(ROOT, 'sitemap.config.json');
  if (!fs.existsSync(p)) {
    console.warn('! sitemap.config.json not found — using built-in defaults.');
    return DEFAULTS;
  }
  try {
    const user = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...DEFAULTS, ...user };
  } catch (err) {
    console.error(`✗ Could not parse sitemap.config.json: ${err.message}`);
    process.exit(1);
  }
}

const cfg = loadConfig();
const SITE = cfg.siteUrl.replace(/\/+$/, '');

/* ------------------------------------------------------------------- utils */

function normalizeRoute(route) {
  let r = '/' + route.split(path.sep).join('/').replace(/^\/+/, '');
  r = r.replace(/\/{2,}/g, '/');
  if (r === '/') return '/';
  r = r.replace(/\/+$/, '');
  return cfg.trailingSlash ? r + '/' : r;
}

function isExcludedDir(name) {
  return name.startsWith('.') || cfg.excludeDirs.includes(name);
}

function matchesAny(route, patterns) {
  return patterns.some(p => {
    const norm = normalizeRoute(p);
    return route === norm || route === norm.replace(/\/$/, '');
  });
}

/* ------------------------------------------------------------- page discovery */

/**
 * A "page" is either:
 *   - a directory containing index.html   ->  /that/directory/
 *   - a standalone foo.html               ->  /foo/
 * Both patterns work on Vercel's static hosting with clean URLs.
 */
function discoverPages(dir, relBase = '') {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) continue;
      found.push(...discoverPages(abs, path.join(relBase, entry.name)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;

    if (entry.name === 'index.html') {
      found.push({ route: normalizeRoute(relBase || '/'), file: abs });
    } else {
      const slug = entry.name.replace(/\.html$/, '');
      found.push({ route: normalizeRoute(path.join(relBase, slug)), file: abs });
    }
  }

  return found;
}

/* ----------------------------------------------------------------- lastmod */

let gitAvailable = null;

function gitDate(file) {
  if (gitAvailable === false) return null;
  try {
    const out = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', path.relative(ROOT, file)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    gitAvailable = true;
    return out ? out.slice(0, 10) : null;
  } catch {
    if (gitAvailable === null) {
      gitAvailable = false;
      console.warn('! git history unavailable — falling back to file mtimes for <lastmod>.');
    }
    return null;
  }
}

const BUILD_DATE = new Date().toISOString().slice(0, 10);

function lastmodFor(file) {
  const g = gitDate(file);
  if (g) return g;
  try {
    return fs.statSync(file).mtime.toISOString().slice(0, 10);
  } catch {
    return BUILD_DATE;
  }
}

/* -------------------------------------------------------------- rule lookup */

const compiledRules = cfg.rules.map(r => ({ ...r, re: new RegExp(r.match) }));

function metaFor(route) {
  for (const rule of compiledRules) {
    if (rule.re.test(route)) {
      return { priority: rule.priority, changefreq: rule.changefreq };
    }
  }
  return { priority: '0.5', changefreq: 'monthly' };
}

/* ------------------------------------------------------------------- render */

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderUrlset(urls) {
  const body = urls.map(u =>
    `  <url>\n` +
    `    <loc>${esc(SITE + u.route)}</loc>\n` +
    `    <lastmod>${u.lastmod}</lastmod>\n` +
    `    <changefreq>${u.changefreq}</changefreq>\n` +
    `    <priority>${u.priority}</priority>\n` +
    `  </url>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
         `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
         `${body}\n</urlset>\n`;
}

function renderIndex(files) {
  const body = files.map(f =>
    `  <sitemap>\n` +
    `    <loc>${esc(SITE + '/' + f.name)}</loc>\n` +
    `    <lastmod>${f.lastmod}</lastmod>\n` +
    `  </sitemap>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
         `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
         `${body}\n</sitemapindex>\n`;
}

/* --------------------------------------------------------------------- main */

const scanDir = path.resolve(ROOT, cfg.pagesDir);
const discovered = discoverPages(scanDir);

// Merge in any manually declared routes (SPA routes, redirects you want indexed).
for (const extra of cfg.extraRoutes) {
  discovered.push({ route: normalizeRoute(extra), file: null, manual: true });
}

// Dedupe by route, then drop exclusions.
const byRoute = new Map();
for (const page of discovered) {
  if (matchesAny(page.route, cfg.excludeRoutes)) continue;
  if (!byRoute.has(page.route)) byRoute.set(page.route, page);
}

const urls = [...byRoute.values()]
  .map(page => ({
    route: page.route,
    lastmod: page.file ? lastmodFor(page.file) : BUILD_DATE,
    ...metaFor(page.route)
  }))
  .sort((a, b) => {
    if (a.route === '/') return -1;
    if (b.route === '/') return 1;
    return a.route.localeCompare(b.route);
  });

if (urls.length === 0) {
  console.error(
    `✗ No pages found under "${scanDir}".\n` +
    `  Check "pagesDir" in sitemap.config.json — the sitemap was NOT overwritten.`
  );
  process.exit(1);
}

// Build the output file set (single sitemap, or index + chunks if huge).
const outputs = [];
if (urls.length <= cfg.maxUrlsPerFile) {
  outputs.push({ name: cfg.outFile, content: renderUrlset(urls) });
} else {
  const chunks = [];
  for (let i = 0; i < urls.length; i += cfg.maxUrlsPerFile) {
    chunks.push(urls.slice(i, i + cfg.maxUrlsPerFile));
  }
  chunks.forEach((chunk, i) => {
    const name = `sitemap-${i + 1}.xml`;
    outputs.push({ name, content: renderUrlset(chunk) });
  });
  outputs.push({
    name: cfg.outFile,
    content: renderIndex(outputs.map(o => ({ name: o.name, lastmod: BUILD_DATE })))
  });
  console.log(`  Split into ${chunks.length} sitemap files + index.`);
}

/* ------------------------------------------------------- check / dry / write */

if (DRY) {
  console.log(outputs.find(o => o.name === cfg.outFile).content);
  console.log(`\n(dry run) ${urls.length} URLs — nothing written.`);
  process.exit(0);
}

if (CHECK) {
  let stale = false;
  for (const out of outputs) {
    const p = path.join(ROOT, out.name);
    const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (existing !== out.content) {
      console.error(`✗ ${out.name} is out of date.`);
      stale = true;
    }
  }
  if (stale) {
    console.error('  Run: node scripts/generate-sitemap.mjs');
    process.exit(1);
  }
  console.log(`✓ Sitemap is up to date (${urls.length} URLs).`);
  process.exit(0);
}

for (const out of outputs) {
  fs.writeFileSync(path.join(ROOT, out.name), out.content, 'utf8');
}

/* ------------------------------------------------------------ report + hints */

const groups = {};
for (const u of urls) {
  const seg = u.route === '/' ? '(homepage)' : u.route.split('/')[1];
  groups[seg] = (groups[seg] || 0) + 1;
}

console.log(`✓ Wrote ${cfg.outFile} — ${urls.length} URLs, host ${SITE}`);
for (const [seg, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  /${seg === '(homepage)' ? '' : seg}`);
}

// Warn about manual routes that have no file behind them — usually a typo.
const orphans = [...byRoute.values()].filter(p => p.manual);
if (orphans.length) {
  console.warn(`! ${orphans.length} route(s) came from extraRoutes and were not verified on disk:`);
  orphans.forEach(o => console.warn(`    ${o.route}`));
}

// Nudge if robots.txt doesn't point at the sitemap.
const robots = path.join(ROOT, 'robots.txt');
if (fs.existsSync(robots)) {
  const txt = fs.readFileSync(robots, 'utf8');
  if (!txt.includes(`${SITE}/${cfg.outFile}`)) {
    console.warn(`! robots.txt does not reference ${SITE}/${cfg.outFile} — add:`);
    console.warn(`    Sitemap: ${SITE}/${cfg.outFile}`);
  }
} else {
  console.warn('! No robots.txt found at repo root.');
}
