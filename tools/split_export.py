#!/usr/bin/env python3
"""
split_export.py — explode a Supabase `jsonb_agg` bundle export into one file
per BOQ schema.

Input : the CSV (or raw .json) downloaded from the Supabase SQL editor after
        running the bundle query:

            SELECT jsonb_agg(
                     jsonb_build_object(
                       'template_id', template_id,
                       'version',     version,
                       'updated_at',  updated_at,
                       'schema_json', schema_json
                     ) ORDER BY template_id
                   ) AS bundle
            FROM   boq_schemas;

        That returns ONE row with ONE cell holding every schema, which is why
        it does not truncate the way a paginated 114-row SELECT does.

Output: <outdir>/SCHEMA-*.json   (schema_json body only, pretty-printed)
        <outdir>/_manifest.csv   (template_id, version, updated_at, bytes)

Usage :
    python split_export.py bundle.csv ./SCHEMAS
    python split_export.py bundle.csv ./SCHEMAS --wrapped   # keep version/updated_at
"""
import csv, json, sys, os, re

csv.field_size_limit(2**31 - 1)          # bundle cell is megabytes, not kilobytes
SAFE = re.compile(r"[^A-Za-z0-9._-]")


def load_bundle(path):
    """Return the list of row-objects, whatever wrapper the download used."""
    raw = open(path, encoding="utf-8-sig").read().strip()

    # Case 1: file is already raw JSON (some clients download .json)
    if raw[:1] in "[{":
        obj = json.loads(raw)
        return obj if isinstance(obj, list) else obj.get("bundle", [obj])

    # Case 2: CSV with a header and one data cell
    rows = list(csv.reader(raw.splitlines()))
    header, data = rows[0], rows[1:]
    if not data:
        sys.exit("ERROR: CSV has a header but no data row — did the query return NULL?")

    col = 0
    for i, h in enumerate(header):
        if h.strip().lower() in ("bundle", "jsonb_agg", "json_agg"):
            col = i
            break

    cell = data[0][col]
    try:
        return json.loads(cell)
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: bundle cell is not valid JSON ({e}).\n"
                 f"       Cell length {len(cell)} bytes — if this looks short, the "
                 f"editor truncated the download. Re-run the query and use "
                 f"'Download CSV', not copy-paste.")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, outdir = sys.argv[1], sys.argv[2]
    wrapped = "--wrapped" in sys.argv

    bundle = load_bundle(src)
    if not isinstance(bundle, list):
        sys.exit("ERROR: bundle did not parse to a JSON array.")

    os.makedirs(outdir, exist_ok=True)
    manifest, seen = [], set()

    for row in bundle:
        tid = row.get("template_id")
        if not tid:
            sys.exit(f"ERROR: row without template_id: {str(row)[:120]}")
        if tid in seen:
            sys.exit(f"ERROR: duplicate template_id in export: {tid}")
        seen.add(tid)

        body = row.get("schema_json")
        if isinstance(body, str):                     # jsonb came back as text
            body = json.loads(body)
        if body is None:
            sys.exit(f"ERROR: {tid} has NULL schema_json")

        payload = row if wrapped else body
        fname = SAFE.sub("_", tid) + ".json"
        path = os.path.join(outdir, fname)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)

        # round-trip guard: what we wrote must re-read identical
        assert json.load(open(path, encoding="utf-8")) == payload, f"round-trip failed: {tid}"

        manifest.append(dict(template_id=tid,
                             version=row.get("version"),
                             updated_at=row.get("updated_at"),
                             bytes=os.path.getsize(path)))

    with open(os.path.join(outdir, "_manifest.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["template_id", "version", "updated_at", "bytes"])
        w.writeheader()
        w.writerows(manifest)

    newest = max((m["updated_at"] or "") for m in manifest)
    print(f"wrote {len(manifest)} schemas -> {outdir}")
    print(f"newest updated_at: {newest}")
    if len(manifest) != 114:
        print(f"WARNING: expected 114, got {len(manifest)} — export may be incomplete.")


if __name__ == "__main__":
    main()
