#!/usr/bin/env node
/**
 * multicalci.com — canonical host normalizer
 * ------------------------------------------
 * Rewrites URL references to the bare domain so every canonical, og:url,
 * schema URL and internal link uses one host.
 *
 *   https://multicalci.com/...   ->  https://www.multicalci.com/...
 *   http://multicalci.com/...    ->  https://www.multicalci.com/...
 *   //multicalci.com/...         ->  //www.multicalci.com/...
 *
 * IMPORTANT — what it deliberately does NOT touch:
 *   - Plain-text mentions. "Free converter at multicalci.com" stays as-is,
 *     because that is display copy, not a URL. Only scheme-prefixed
 *     occurrences are rewritten.
 *   - Anything already on www. (no www.www.multicalci.com)
 *   - Other domains, and any host that merely ends in multicalci.com
 *     (e.g. cdn.multicalci.com is left alone).
 *
 * Usage:
 *   node scripts/normalize-domain.mjs            # rewrite in place
 *   node scripts/normalize-domain.mjs --check    # exit 1 if any remain
 *   node scripts/normalize-domain.mjs --dry-run  # report only
 *
 * No dependencies. Node 18+.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const DRY = args.has('--dry-run');

const BARE = 'multicalci.com';
const WWW = 'www.multicalci.com';

const EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.mjs', '.json', '.css', '.txt', '.xml', '.webmanifest'
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', '.vercel', 'dist', 'build', 'coverage',
  // Build tooling is never served to users, and skipping it stops this script
  // from rewriting the example URLs in its own documentation.
  'scripts'
]);

// Never rewrite inside these files — they are generated or config we manage elsewhere.
const SKIP_FILES = new Set(['sitemap.xml', 'sitemap.config.json']);

/* --------------------------------------------------------------- the rewrite */

/**
 * Matches a scheme (or protocol-relative) prefix followed by the bare domain,
 * where the character before the domain is the slash itself — meaning the
 * domain is not already subdomained. The lookahead ensures the next character
 * ends the host (/, ", ', <, whitespace, ) or end-of-string) so we never match
 * something like multicalci.community.
 */
const URL_RE = /(https?:\/\/|\/\/)multicalci\.com(?=[/"'`<\s)]|$)/g;

function rewrite(text) {
  let count = 0;
  const out = text.replace(URL_RE, (_m, scheme) => {
    count++;
    // Normalise http -> https at the same time; leave protocol-relative alone.
    const s = scheme === '//' ? '//' : 'https://';
    return s + WWW;
  });
  return { out, count };
}

/* ------------------------------------------------------------------ traversal */

function walk(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), acc);
    } else if (e.isFile()) {
      if (SKIP_FILES.has(e.name)) continue;
      if (!EXTENSIONS.has(path.extname(e.name).toLowerCase())) continue;
      acc.push(path.join(dir, e.name));
    }
  }
  return acc;
}

/* ----------------------------------------------------------------------- main */

const files = walk(ROOT);

if (files.length === 0) {
  console.error('✗ No candidate files found — refusing to continue.');
  process.exit(1);
}

let totalRefs = 0;
const changed = [];

for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes(BARE)) continue;

  const { out, count } = rewrite(text);
  if (count === 0) continue;

  totalRefs += count;
  const rel = path.relative(ROOT, file);
  changed.push({ rel, count });

  if (!DRY && !CHECK) fs.writeFileSync(file, out, 'utf8');
}

/* --------------------------------------------------------------------- report */

if (changed.length === 0) {
  console.log(`✓ All URLs already use ${WWW} — nothing to change.`);
  process.exit(0);
}

changed.sort((a, b) => b.count - a.count);
const verb = (DRY || CHECK) ? 'would rewrite' : 'rewrote';
console.log(`${verb} ${totalRefs} URL reference(s) across ${changed.length} file(s):`);
for (const c of changed.slice(0, 40)) {
  console.log(`    ${String(c.count).padStart(4)}  ${c.rel}`);
}
if (changed.length > 40) console.log(`    … and ${changed.length - 40} more file(s)`);

if (CHECK) {
  console.error(`\n✗ ${totalRefs} bare-domain URL(s) remain.`);
  console.error('  Run: node scripts/normalize-domain.mjs');
  process.exit(1);
}

if (DRY) {
  console.log('\n(dry run) nothing written.');
  process.exit(0);
}

console.log(`\n✓ Done. Plain-text mentions of ${BARE} were left untouched.`);
