// ============================================================================
// scripts/build-protected.mjs — the published front-end pages from their sources
//
//   npm i --no-save terser          (or TERSER=/path/to/terser/main.js)
//   node scripts/build-protected.mjs
//
// src/flowsheet-simulator.source.html  →  flowsheet-simulator.html
//
// What the build does to a page:
//   - every inline script is minified with terser: comments removed, local
//     names shortened, and — for the flowsheet simulator, whose one script
//     shares nothing with other files — the top-level names too;
//   - a page whose scripts share top-level names with another file must use
//     toplevel: false, so only its local names are shortened;
//   - HTML comments (the architecture notes at the top of each source) and
//     CSS comments are removed; JSON-LD is compacted;
//   - a short copyright notice and the SHA-256 of the source go in the first
//     line, so tests/site-checks.mjs can tell a published page that was not
//     rebuilt after its source changed.
// The sources keep every comment. src/ and scripts/ are in .vercelignore, so
// they are not published; once the repository is private they are not
// readable anywhere outside it.
// (c) multicalci.com — all rights reserved
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { minify } = await import(process.env.TERSER || 'terser');

export const PAGES = [
  { src: 'src/flowsheet-simulator.source.html', out: 'flowsheet-simulator.html', toplevel: true },
];
export const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
const NOTICE = (h) => `(c) multicalci.com — all rights reserved. Not licensed for copying or reuse. build ${h}`;

const TERSER = (toplevel) => ({
  ecma: 2020,
  compress: { passes: 2, toplevel, drop_debugger: true },
  mangle: { toplevel },
  format: { comments: false, inline_script: true, ascii_only: false },
});

async function js(code, toplevel, label) {
  const r = await minify(code, TERSER(toplevel));
  if (!r.code) throw new Error(label + ': terser returned nothing');
  return r.code;
}

const css = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]*\n[ \t\n]*/g, '\n').trim();

async function html(src, toplevel, label) {
  // split into script / style blocks and the markup between them
  const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let out = '', last = 0, m, n = 0;
  const markup = (s) => s.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  while ((m = re.exec(src))) {
    out += markup(src.slice(last, m.index));
    const [, tag, attrs, body] = m;
    if (tag.toLowerCase() === 'style') out += `<style${attrs}>${css(body)}</style>`;
    else if (/\bsrc\s*=/.test(attrs)) out += m[0];
    else if (/application\/ld\+json/.test(attrs)) out += `<script${attrs}>${JSON.stringify(JSON.parse(body))}</script>`;
    else { out += `<script${attrs}>${await js(body, toplevel, label + ' script ' + (++n))}</script>`; }
    last = m.index + m[0].length;
  }
  out += markup(src.slice(last));
  return out;
}

export async function build(p) {
  const src = fs.readFileSync(path.join(ROOT, p.src), 'utf8');
  const h = sha(src);
  let out;
  if (p.src.endsWith('.js')) out = `/* ${NOTICE(h)} */\n` + await js(src, p.toplevel, p.src) + '\n';
  else {
    const body = await html(src, p.toplevel, p.src);
    out = body.replace(/^<!DOCTYPE html>\s*/i, `<!DOCTYPE html>\n<!-- ${NOTICE(h)} -->\n`);
  }
  return { out, h, before: src.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const p of PAGES) {
    const t0 = Date.now();
    const { out, h, before } = await build(p);
    fs.writeFileSync(path.join(ROOT, p.out), out);
    console.log(`${p.out}: ${(before / 1024).toFixed(0)} KB source → ${(out.length / 1024).toFixed(0)} KB published (build ${h}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
