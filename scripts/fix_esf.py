#!/usr/bin/env python3
"""
One-off bulk fix for the Engineering Standards Finder static pages.

  1. strips trailing slashes from every /engineering-standards-finder URL
     (canonical, og:url, JSON-LD url/item, and all internal hrefs)
  2. rewrites any remaining non-www multicalci.com reference to www
  3. inserts the Vercel Web Analytics snippet before </body>

Safe to run more than once. The site root "https://www.multicalci.com/"
keeps its slash.
"""
import re, sys, pathlib

TARGETS = ["engineering-standards-finder/standards",
           "engineering-standards-finder/equipment"]

ESF = r"(?:https://www\.multicalci\.com)?/engineering-standards-finder[^\"']*?"

SNIPPET = ('<script>\n'
           '  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };\n'
           '</script>\n'
           '<script defer src="/_vercel/insights/script.js"></script>\n')

def fix(text):
    # non-www -> www (never touches an existing www URL)
    text = re.sub(r'https://(?!www\.)multicalci\.com', 'https://www.multicalci.com', text)
    # "/engineering-standards-finder/..../"  ->  no trailing slash
    text = re.sub(r'"(%s)/"' % ESF, r'"\1"', text)
    text = re.sub(r"'(%s)/'" % ESF, r"'\1'", text)
    # "/engineering-standards-finder/#anchor" -> "/engineering-standards-finder#anchor"
    text = re.sub(r'"(%s)/#' % ESF, r'"\1#', text)
    # analytics, once
    if '_vercel/insights' not in text and '</body>' in text:
        text = text.replace('</body>', SNIPPET + '</body>', 1)
    return text

def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    changed = scanned = 0
    for t in TARGETS:
        for f in sorted((root / t).rglob("index.html")):
            scanned += 1
            src = f.read_text(encoding="utf-8")
            out = fix(src)
            if out != src:
                f.write_text(out, encoding="utf-8")
                changed += 1
    print(f"scanned {scanned} files, changed {changed}")

if __name__ == "__main__":
    main()
