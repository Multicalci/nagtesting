/* =========================================================================
   REPO PATH: mb-exports.js
   =========================================================================
   multicalci.com — Material Balance Calculator (spec v5.2) — STEP 18
   EXPORTS + SPREADSHEET VIEW + PRINT/PDF REPORT + PERMALINK POLISH

   WHY A SEPARATE FILE
     material-balance.html is already large; this step is pure presentation.
     Committing it as one extra static file keeps the diff reviewable in the
     GitHub web editor and changes exactly ONE line of the HTML (the script
     tag). No build step, no dependencies, no framework — same as the rest.

   ARCHITECTURE COMPLIANCE (MASTER CONTEXT)
     This file performs NO thermodynamics and holds NO coefficients. It only
     reads what the server already returned (u.result) plus the user's own
     inputs, and reshapes them into a grid / CSV / printable report. The one
     arithmetic operation it does is the same bookkeeping the page already
     did on screen: flow x mass_fraction, and kmol/h = kg/h / MW_avg, where
     MW comes from the picker metadata the API already exposes.

   HOW IT ATTACHES
     Add ONE line to material-balance.html, immediately before </body>
     (i.e. AFTER the existing inline <script>):

         <script src="mb-exports.js" defer></script>

     The inline script's top-level `let`/`const`/`function` declarations live
     in the shared global scope of classic scripts, so this file reads
     `state`, `MODULE_DEFS`, `compByKey`, `outletLabels()`, `restoreSnapshot()`
     and `toast()` directly. Every access is guarded: if a symbol is missing
     the feature degrades with a console warning instead of throwing.

     It injects its own <style> block, its own header/mobile buttons, and
     rebinds the two existing Permalink buttons to the polished sheet.

   OPTIONAL 2-LINE HTML PATCH (nicer, not required)
     The inline boot calls tryRestoreHash() which only understands the legacy
     `#s=` payload. This file also decodes `#w=` (compact) and `#z=`
     (deflate-raw) links at boot, one tick later — which works, but flashes
     the autosaved case first. To avoid the flash, change the boot block to:

         if (!tryRestoreHash() && !location.hash.startsWith('#w=')
                               && !location.hash.startsWith('#z=')) {

   DELIVERS
     1. Spreadsheet stream view — every stream of every unit as one grid,
        with mass-fraction / kg-h / mole-fraction column modes, sticky
        header + sticky stream column, and copy-as-TSV (paste into Excel).
     2. CSV export — streams grid and balances (mass closure, energy, and
        per-component in/out) as RFC-4180 CSV, UTF-8 BOM + CRLF so Excel
        opens them cleanly, full precision (no thousands separators).
     3. Print-CSS PDF report — dark-petrol report style: masthead, per-unit
        flowsheet SVG (cloned from the live diagram), inputs, stream table,
        balance block, component balance, warnings, basis/method notes,
        disclaimer, and a running copyright footer. Ink-saving light mode
        included for people who print on paper.
     4. Permalink polish — compact codec + optional deflate-raw compression
        (native CompressionStream, no library), URL-safe base64, a proper
        share sheet with copy / native share / open, length warning, and
        backward-compatible reading of legacy `#s=` links.

   (c) multicalci.com
========================================================================= */
(function () {
  'use strict';

  /* =====================================================================
     0. HOST BRIDGE — everything this file borrows from the page, guarded
  ===================================================================== */

  const HOST = {
    get state() {
      if (typeof state !== 'undefined' && state) return state;
      return { units: [] };
    },
    get defs() {
      return (typeof MODULE_DEFS !== 'undefined' && MODULE_DEFS) ? MODULE_DEFS : {};
    },
    get compByKey() {
      return (typeof compByKey !== 'undefined' && compByKey) ? compByKey : {};
    },
    get componentsLoaded() {
      return typeof componentsDB !== 'undefined' && !!componentsDB;
    },
    /** Outlet labels for a unit, with a numeric fallback. */
    labels(u) {
      try {
        if (typeof outletLabels === 'function') return outletLabels(u) || [];
      } catch (_e) { /* module def not ready */ }
      const n = (u.result && u.result.streams_out) ? u.result.streams_out.length : 0;
      return Array.from({ length: n }, (_, i) => 'Out ' + (i + 1));
    },
    toast(msg, kind) {
      if (typeof toast === 'function') return toast(msg, kind);
      console.log('[mb-exports] ' + (kind || 'info') + ': ' + msg);
    },
    restore(snap) {
      if (typeof restoreSnapshot === 'function') { restoreSnapshot(snap); return true; }
      console.warn('[mb-exports] restoreSnapshot() unavailable');
      return false;
    },
    snapshot() {
      return (typeof snapshotInputs === 'function') ? snapshotInputs() : null;
    },
  };

  /** Guard: the page must be the material-balance client. */
  function hostReady() {
    return typeof MODULE_DEFS !== 'undefined' && !!document.getElementById('units');
  }

  /* =====================================================================
     1. UTILITIES — numbers, DOM, CSV, download, clipboard
  ===================================================================== */

  const isNum = (x) => typeof x === 'number' && isFinite(x);

  /** Display formatting: significant figures, locale commas, no exponent soup. */
  function sig(x, n) {
    if (!isNum(x)) return '—';
    if (x === 0) return '0';
    const s = n || 6;
    const a = Math.abs(x);
    if (a >= 1e7 || a < 1e-4) return x.toExponential(3);
    const d = Math.max(0, s - 1 - Math.floor(Math.log10(a)));
    return x.toLocaleString('en-US', { maximumFractionDigits: Math.min(d, 8) });
  }

  /** Machine formatting for CSV/TSV: full useful precision, NO separators. */
  function raw(x) {
    if (x === null || x === undefined || x === '') return '';
    if (!isNum(x)) return String(x);
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e12 || a < 1e-9) return x.toExponential(10);
    /* 12 significant digits then trim trailing zeros — spreadsheet friendly */
    return String(parseFloat(x.toPrecision(12)));
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  /** Compact local stamp for filenames: 20260725-1432 */
  function stamp(d) {
    const t = d || new Date();
    return String(t.getFullYear()) + pad2(t.getMonth() + 1) + pad2(t.getDate()) +
      '-' + pad2(t.getHours()) + pad2(t.getMinutes());
  }

  function E(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = String(v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      e.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return e;
  }

  /** RFC-4180 field: quote when needed, neutralise spreadsheet formula injection. */
  function csvField(v) {
    let s = (v === null || v === undefined) ? '' : String(v);
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !isNum(Number(s)))) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /** rows: array of arrays (or strings, emitted verbatim as comment lines). */
  function toCSV(rows) {
    const out = [];
    for (const r of rows) {
      if (typeof r === 'string') { out.push(r); continue; }
      out.push(r.map(csvField).join(','));
    }
    return '\uFEFF' + out.join('\r\n') + '\r\n';   /* BOM + CRLF for Excel */
  }

  function toTSV(rows) {
    return rows
      .filter((r) => typeof r !== 'string')
      .map((r) => r.map((c) => String(c === null || c === undefined ? '' : c)
        .replace(/[\t\r\n]/g, ' ')).join('\t'))
      .join('\r\n');
  }

  function download(filename, text, mime) {
    try {
      const blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = E('a', { href: url, download: filename, style: 'display:none' });
      document.body.append(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
      HOST.toast('Saved ' + filename, 'ok');
    } catch (_e) {
      HOST.toast('This browser blocked the download.', 'err');
    }
  }

  function copyText(text, okMsg) {
    const done = () => HOST.toast(okMsg || 'Copied to clipboard.', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = E('textarea', {
      style: 'position:fixed;left:-9999px;top:0;opacity:0', readonly: 'readonly',
    });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_e) { ok = false; }
    ta.remove();
    if (ok) done(); else HOST.toast('Copy blocked — select the text manually.', 'err');
  }

  /* =====================================================================
     2. WORKSHEET MODEL — one normalised view of the whole worksheet
        (inputs from state, outputs from the server result; nothing computed
        beyond flow x fraction and kmol/h = kg/h / MW_avg)
  ===================================================================== */

  /** Picker metadata for a component key. */
  function meta(key) {
    const c = HOST.compByKey[key];
    return {
      key,
      name: (c && c.name) || key,
      formula: (c && c.formula) || '',
      mw: (c && isNum(c.mw)) ? c.mw : null,
    };
  }

  /** Mixture MW from mass fractions: 1 / SUM(wi/MWi). null if any MW unknown. */
  function mwOf(comps) {
    if (!comps || !comps.length) return null;
    let s = 0, w = 0;
    for (const c of comps) {
      const mw = isNum(c.mw) ? c.mw : meta(c.key).mw;
      if (!isNum(mw) || mw <= 0 || !isNum(c.mass_fraction)) return null;
      s += c.mass_fraction / mw;
      w += c.mass_fraction;
    }
    return (s > 0 && w > 0) ? w / s : null;
  }

  /** Mole fractions from mass fractions. null when any MW is unknown. */
  function moleFrac(comps) {
    const n = [];
    let s = 0;
    for (const c of comps) {
      const mw = isNum(c.mw) ? c.mw : meta(c.key).mw;
      if (!isNum(mw) || mw <= 0) return null;
      const ni = (c.mass_fraction || 0) / mw;
      n.push(ni); s += ni;
    }
    return s > 0 ? n.map((v) => v / s) : null;
  }

  /** Normalise one stream (input or solved outlet) into the grid row model. */
  function streamView(s, dir, label) {
    const comps = (s.components || []).map((c) => ({
      key: c.key,
      mass_fraction: isNum(c.mass_fraction) ? c.mass_fraction : 0,
      mw: isNum(c.mw) ? c.mw : meta(c.key).mw,
      phase: c.phase || '',
    }));
    const mw = mwOf(comps);
    const xs = moleFrac(comps);
    const phases = [...new Set(comps.map((c) => c.phase).filter(Boolean))];
    const byKey = {};
    comps.forEach((c, i) => {
      byKey[c.key] = {
        frac: c.mass_fraction,
        kgh: isNum(s.mass_flow_kg_h) ? s.mass_flow_kg_h * c.mass_fraction : null,
        x: xs ? xs[i] : null,
        phase: c.phase,
      };
    });
    return {
      dir, label,
      mass: isNum(s.mass_flow_kg_h) ? s.mass_flow_kg_h : null,
      T_K: isNum(s.T_K) ? s.T_K : null,
      P_bar: isNum(s.P_bar) ? s.P_bar : null,
      H: isNum(s.H_kJh) ? s.H_kJh : null,
      mw,
      kmolh: (isNum(s.mass_flow_kg_h) && isNum(mw) && mw > 0) ? s.mass_flow_kg_h / mw : null,
      phase: phases.join(' + '),
      comps: byKey,
      keys: comps.map((c) => c.key),
    };
  }

  /** Per-component in/out bookkeeping for one unit. */
  function componentBalance(unitView) {
    const inn = {}, out = {};
    for (const s of unitView.streams) {
      const bag = s.dir === 'in' ? inn : out;
      for (const k of s.keys) {
        const v = s.comps[k].kgh;
        if (isNum(v)) bag[k] = (bag[k] || 0) + v;
      }
    }
    const keys = [...new Set([...Object.keys(inn), ...Object.keys(out)])];
    return keys.map((k) => ({
      key: k, name: meta(k).name,
      in: inn[k] || 0, out: out[k] || 0, delta: (out[k] || 0) - (inn[k] || 0),
    }));
  }

  /** The whole worksheet, unit by unit. */
  function worksheet() {
    const ws = [];
    const units = HOST.state.units || [];
    units.forEach((u, i) => {
      const def = HOST.defs[u.module] || { label: u.module, sym: '?', fields: [] };
      const R = u.result;
      const streams = [];
      (u.streams || []).forEach((s, k) => {
        streams.push(streamView(s, 'in', s.label || ('Inlet ' + (k + 1))));
      });
      if (R && Array.isArray(R.streams_out)) {
        const labels = HOST.labels(u);
        R.streams_out.forEach((s, k) => {
          streams.push(streamView(s, 'out', labels[k] || ('Outlet ' + (k + 1))));
        });
      }
      const view = {
        id: u.id, n: i + 1, module: u.module, label: def.label, sym: def.sym,
        solved: !!R, streams,
        params: paramList(u, def),
        balance: R ? {
          mass_in: R.mass_balance && R.mass_balance.in,
          mass_out: R.mass_balance && R.mass_balance.out,
          closure_pct: R.mass_balance && R.mass_balance.closure_pct,
          Hin: R.energy_balance && R.energy_balance.Hin,
          Hout: R.energy_balance && R.energy_balance.Hout,
          Q_kW: R.energy_balance && R.energy_balance.Q_kW,
          W_kW: R.energy_balance && R.energy_balance.W_kW,
          converged: R.converged,
          iterations: R.iterations || 0,
        } : null,
        details: R ? (R.details || {}) : {},
        warnings: (u.apiWarnings || []).concat((R && R.warnings) || []),
        engineVersion: u.engineVersion || '',
      };
      view.compBalance = componentBalance(view);
      ws.push(view);
    });
    return ws;
  }

  /** Human-readable parameter list for the report (labels from MODULE_DEFS). */
  function paramList(u, def) {
    const out = [];
    const p = u.params || {};
    for (const f of (def.fields || [])) {
      if (f.showIf) { try { if (!f.showIf(p)) continue; } catch (_e) { /* keep */ } }
      const v = p[f.key];
      if (v === undefined || v === null || v === '') continue;
      let txt;
      if (f.kind === 'select' && Array.isArray(f.options)) {
        const hit = f.options.find((o) => o[0] === v);
        txt = hit ? hit[1] : String(v);
      } else if (f.kind === 'fractions') {
        txt = (v || []).map((x) => sig(x, 4)).join(' / ');
      } else if (f.kind === 'reactions') {
        txt = (v || []).map((rx, i) => 'R' + (i + 1) + ': ' +
          (rx.stoich || []).filter((r) => r.key).map((r) =>
            (r.nu > 0 ? '+' : '') + sig(r.nu, 4) + ' ' + meta(r.key).name).join('  ') +
          '  | limiting ' + (meta(rx.limiting).name) +
          ', X = ' + sig(rx.conversion, 4)).join(' ; ');
      } else if (isNum(v)) {
        txt = sig(v, 6) + (f.unit ? ' ' + f.unit : (f.kind === 'temperature' ? ' K' :
          (f.kind === 'pressure' || f.kind === 'dpressure' ? ' bar' : '')));
      } else txt = String(v);
      out.push({ label: f.label || f.key, value: txt });
    }
    return out;
  }

  /** Flatten result.details into label/value pairs (module extras, profiles). */
  function detailPairs(obj, prefix, acc) {
    const out = acc || [];
    for (const k in obj) {
      const v = obj[k];
      if (v === null || v === undefined) continue;
      const label = (prefix || '') + k;
      if (Array.isArray(v)) {
        out.push({
          label,
          value: v.length > 6 ? v.length + ' items (see on-screen table)'
            : v.map((x) => (x && typeof x === 'object') ? JSON.stringify(x)
              : (isNum(x) ? sig(x, 5) : String(x))).join(', '),
        });
      } else if (typeof v === 'object') detailPairs(v, label + '.', out);
      else out.push({ label, value: isNum(v) ? sig(v, 6) : String(v) });
    }
    return out;
  }

  /* =====================================================================
     3. THE GRID — one builder shared by the on-screen sheet, CSV and TSV
        mode: 'frac' (mass fraction) | 'kgh' (component kg/h) | 'mol' (mole fraction)
  ===================================================================== */

  const MODE_LABEL = {
    frac: 'mass fraction',
    kgh: 'component kg/h',
    mol: 'mole fraction',
  };

  /** Union of component keys across the worksheet, inputs first, stable order. */
  function columnKeys(ws) {
    const seen = [];
    for (const u of ws) for (const s of u.streams) for (const k of s.keys) {
      if (!seen.includes(k)) seen.push(k);
    }
    return seen;
  }

  /**
   * Build the stream grid.
   * @param {Array} ws worksheet()
   * @param {string} mode frac|kgh|mol
   * @returns {{head:string[], sub:string[], rows:Array, keys:string[]}}
   */
  function streamGrid(ws, mode) {
    const keys = columnKeys(ws);
    const head = ['Unit', 'Stream', 'Dir', 'kg/h', 'kmol/h', 'MW',
      'T (°C)', 'T (K)', 'P (bar a)', 'H (kJ/h)', 'Phase'];
    const sub = keys.map((k) => meta(k).name);
    const rows = [];
    for (const u of ws) {
      for (const s of u.streams) {
        const line = [
          u.n + ' · ' + u.label,
          s.label,
          s.dir === 'in' ? 'in' : 'out',
          s.mass, s.kmolh, s.mw,
          isNum(s.T_K) ? s.T_K - 273.15 : null,
          s.T_K, s.P_bar, s.H, s.phase,
        ];
        for (const k of keys) {
          const c = s.comps[k];
          if (!c) { line.push(null); continue; }
          line.push(mode === 'kgh' ? c.kgh : (mode === 'mol' ? c.x : c.frac));
        }
        rows.push({ unit: u.n, dir: s.dir, cells: line });
      }
    }
    return { head: head.concat(sub), rows, keys, fixed: head.length };
  }

  /** Balance rows (mass + energy per unit, then per-component in/out). */
  function balanceGrid(ws) {
    const rows = [];
    rows.push(['Unit', 'Module', 'Mass in (kg/h)', 'Mass out (kg/h)',
      'Closure (%)', 'H in (kJ/h)', 'H out (kJ/h)', 'Q (kW)', 'W shaft (kW)',
      'Converged', 'Iterations', 'Engine']);
    for (const u of ws) {
      const b = u.balance;
      rows.push([u.n, u.label,
        b ? b.mass_in : null, b ? b.mass_out : null, b ? b.closure_pct : null,
        b ? b.Hin : null, b ? b.Hout : null, b ? b.Q_kW : null, b ? b.W_kW : null,
        b ? String(b.converged) : 'not solved', b ? b.iterations : null,
        u.engineVersion || '']);
    }
    return rows;
  }

  function compBalanceGrid(ws) {
    const rows = [['Unit', 'Module', 'Component', 'In (kg/h)', 'Out (kg/h)', 'Δ (kg/h)']];
    for (const u of ws) {
      for (const c of u.compBalance) {
        rows.push([u.n, u.label, c.name, c.in, c.out, c.delta]);
      }
    }
    return rows;
  }

  /* =====================================================================
     4. CSV / TSV EXPORT
  ===================================================================== */

  function csvHeaderLines(title, mode) {
    const d = new Date();
    return [
      '# multicalci.com — Material & Energy Balance — ' + title,
      '# generated,' + csvField(d.toISOString()),
      '# local time,' + csvField(d.toLocaleString()),
      '# units,"kg/h, kmol/h, °C, K, bar absolute, kJ/h, kW"',
      mode ? '# component columns,' + csvField(MODE_LABEL[mode]) : null,
      '# basis,"formation-enthalpy basis: Q = H_out - H_in"',
      '# note,"inputs are user data; outlet streams and balances are engine results"',
      '# (c) multicalci.com — preliminary engineering / education only',
      '',
    ].filter(Boolean);
  }

  function exportStreamsCSV(mode) {
    const ws = worksheet();
    if (!ws.length) return HOST.toast('Nothing to export yet.', 'info');
    const g = streamGrid(ws, mode || 'frac');
    const rows = csvHeaderLines('stream table', mode || 'frac');
    rows.push(g.head);
    for (const r of g.rows) rows.push(r.cells.map(raw));
    download('multicalci-mb-streams-' + stamp() + '.csv', toCSV(rows));
  }

  function exportBalancesCSV() {
    const ws = worksheet();
    if (!ws.length) return HOST.toast('Nothing to export yet.', 'info');
    const rows = csvHeaderLines('balances', null);
    rows.push('# section,unit balances');
    for (const r of balanceGrid(ws)) rows.push(r.map(raw));
    rows.push('');
    rows.push('# section,component balances');
    for (const r of compBalanceGrid(ws)) rows.push(r.map(raw));
    const warns = ws.filter((u) => u.warnings.length);
    if (warns.length) {
      rows.push('');
      rows.push('# section,warnings');
      rows.push(['Unit', 'Module', 'Warning']);
      for (const u of warns) for (const w of u.warnings) rows.push([u.n, u.label, w]);
    }
    download('multicalci-mb-balances-' + stamp() + '.csv', toCSV(rows));
  }

  function copyGridTSV(mode) {
    const ws = worksheet();
    if (!ws.length) return HOST.toast('Nothing to copy yet.', 'info');
    const g = streamGrid(ws, mode || 'frac');
    const rows = [g.head].concat(g.rows.map((r) => r.cells.map(raw)));
    copyText(toTSV(rows), 'Grid copied — paste straight into Excel or Sheets.');
  }

  /* =====================================================================
     5. SPREADSHEET STREAM VIEW  (full-screen overlay, sticky header/column)
  ===================================================================== */

  let sheetMode = 'frac';

  function openSpreadsheet() {
    const ws = worksheet();
    if (!ws.length) return HOST.toast('Add and solve a unit first.', 'info');
    const ov = overlay('mbSheetOverlay');
    ov.body.textContent = '';

    /* toolbar */
    const bar = E('div', { class: 'mbx-bar' });
    bar.append(E('div', { class: 'mbx-title' },
      E('strong', null, 'Spreadsheet view'),
      E('span', { class: 'mbx-sub' }, ws.length + ' unit' + (ws.length === 1 ? '' : 's') +
        ' · ' + ws.reduce((a, u) => a + u.streams.length, 0) + ' streams · base SI')));

    const modes = E('div', { class: 'mbx-modes', role: 'group', 'aria-label': 'Component columns' });
    for (const m of ['frac', 'kgh', 'mol']) {
      modes.append(E('button', {
        class: 'mbx-mbtn' + (sheetMode === m ? ' on' : ''),
        onclick: () => { sheetMode = m; openSpreadsheet(); },
      }, MODE_LABEL[m]));
    }
    bar.append(modes);

    const acts = E('div', { class: 'mbx-acts' });
    acts.append(
      E('button', { class: 'mbx-btn', onclick: () => copyGridTSV(sheetMode) }, 'Copy TSV'),
      E('button', { class: 'mbx-btn', onclick: () => exportStreamsCSV(sheetMode) }, 'Streams CSV'),
      E('button', { class: 'mbx-btn', onclick: exportBalancesCSV }, 'Balances CSV'),
      E('button', { class: 'mbx-btn primary', onclick: () => { closeOverlay(ov); openReport(); } }, 'PDF report'),
      E('button', { class: 'mbx-x', 'aria-label': 'Close', onclick: () => closeOverlay(ov) }, '✕'));
    bar.append(acts);
    ov.body.append(bar);

    /* grid */
    const g = streamGrid(ws, sheetMode);
    const scroll = E('div', { class: 'mbx-scroll' });
    const t = E('table', { class: 'mbx-grid' });
    const thead = E('thead');
    const hr = E('tr');
    g.head.forEach((h, i) => {
      hr.append(E('th', { class: (i === 1 ? 'stick' : '') + (i >= g.fixed ? ' comp' : '') }, h));
    });
    thead.append(hr);
    t.append(thead);

    const tb = E('tbody');
    let lastUnit = null;
    for (const r of g.rows) {
      if (r.unit !== lastUnit) {
        lastUnit = r.unit;
        const gr = E('tr', { class: 'grp' });
        gr.append(E('td', { class: 'stick2', colspan: g.head.length },
          'UNIT ' + r.unit + ' · ' + (ws[r.unit - 1] ? ws[r.unit - 1].label : '')));
        tb.append(gr);
      }
      const tr = E('tr', { class: r.dir === 'out' ? 'o' : 'i' });
      r.cells.forEach((c, i) => {
        const txt = (c === null || c === undefined || c === '') ? ''
          : (isNum(c) ? sig(c, i >= g.fixed && sheetMode !== 'kgh' ? 5 : 6) : String(c));
        tr.append(E('td', {
          class: (i === 1 ? 'stick' : '') + (i < 3 ? ' txt' : '') + (i >= g.fixed ? ' comp' : ''),
          title: isNum(c) ? raw(c) : null,
        }, txt));
      });
      tb.append(tr);
    }
    t.append(tb);
    scroll.append(t);
    ov.body.append(scroll);

    ov.body.append(E('div', { class: 'mbx-foot' },
      'Component columns show ' + MODE_LABEL[sheetMode] +
      '. Blank = component absent from that stream. ' +
      'Cell tooltips carry full precision; CSV and TSV always export unrounded values. ' +
      'Outlet rows are engine results — inputs are your own data.'));
    showOverlay(ov);
  }

  /* =====================================================================
     6. PRINT / PDF REPORT  (dark-petrol report style, print CSS driven)
  ===================================================================== */

  let reportInk = false;

  function reportHost() {
    let r = document.getElementById('mbReport');
    if (!r) {
      r = E('div', { id: 'mbReport', class: 'mbrep', 'aria-hidden': 'true' });
      document.body.append(r);
    }
    return r;
  }

  /** Clone a live SVG out of a unit card so the printed flowsheet matches. */
  function cloneSVG(unitId, selector) {
    const card = document.getElementById(unitId);
    if (!card) return null;
    const svg = card.querySelector(selector);
    if (!svg) return null;
    const c = svg.cloneNode(true);
    c.removeAttribute('tabindex');
    c.querySelectorAll('[tabindex]').forEach((n) => n.removeAttribute('tabindex'));
    c.querySelectorAll('[role=button]').forEach((n) => n.removeAttribute('role'));
    return c;
  }

  function kvBlock(pairs, cls) {
    const d = E('dl', { class: 'mbrep-kv ' + (cls || '') });
    for (const p of pairs) {
      d.append(E('dt', null, p.label), E('dd', null, p.value));
    }
    return d;
  }

  function repTable(head, rows, opts) {
    const o = opts || {};
    const t = E('table', { class: 'mbrep-tab' + (o.wide ? ' wide' : '') });
    const hr = E('tr');
    for (const h of head) hr.append(E('th', null, h));
    t.append(E('thead', null, hr));
    const tb = E('tbody');
    for (const r of rows) {
      const tr = E('tr', { class: r.cls || null });
      (r.cells || r).forEach((c, i) => {
        tr.append(E('td', { class: i === 0 ? 'txt' : null }, c));
      });
      tb.append(tr);
    }
    t.append(tb);
    return t;
  }

  /** Build the printable report DOM from the current worksheet. */
  function buildReport() {
    const host = reportHost();
    host.textContent = '';
    host.classList.toggle('ink', reportInk);
    const ws = worksheet();
    const now = new Date();
    const engine = (ws.find((u) => u.engineVersion) || {}).engineVersion || 'n/a';

    /* ---- masthead ---- */
    const head = E('header', { class: 'mbrep-head' });
    head.append(
      E('div', { class: 'mbrep-brand' },
        E('span', { class: 'lamp2', 'aria-hidden': 'true' }),
        E('span', { class: 'bt' }, 'multicalci'),
        E('span', { class: 'bd' }, '.com')),
      E('h1', null, 'Material & Energy Balance Report'),
      kvBlock([
        { label: 'Generated', value: now.toLocaleString() },
        { label: 'Worksheet', value: ws.length + ' unit' + (ws.length === 1 ? '' : 's') + ' · ' +
          ws.map((u) => u.sym).join(' → ') },
        { label: 'Engine', value: engine },
        { label: 'Basis', value: 'Formation enthalpy — Q + Ws = ΣH(out) − ΣH(in)' },
        { label: 'Units', value: 'kg/h · K (°C shown) · bar absolute · kJ/h · kW' },
      ], 'mast'));
    host.append(head);

    if (!ws.length) {
      host.append(E('p', { class: 'mbrep-note' }, 'The worksheet is empty.'));
    }

    /* ---- per-unit sections ---- */
    for (const u of ws) {
      const sec = E('section', { class: 'mbrep-unit' });
      sec.append(E('h2', null,
        E('span', { class: 'tag2' }, u.sym),
        'Unit ' + u.n + ' · ' + u.label,
        u.solved ? null : E('span', { class: 'unsolved' }, 'NOT SOLVED')));

      const svg = cloneSVG(u.id, 'svg.diagram');
      if (svg) sec.append(E('figure', { class: 'mbrep-fig' }, svg,
        E('figcaption', null, 'Figure ' + u.n + '.1 — flowsheet block and connected streams')));

      if (u.params.length) {
        sec.append(E('h3', null, 'Specification'));
        sec.append(kvBlock(u.params));
      }

      /* stream table — fixed columns only; compositions get their own table */
      sec.append(E('h3', null, 'Streams'));
      const srows = u.streams.map((s) => ({
        cls: s.dir === 'out' ? 'out' : 'in',
        cells: [
          (s.dir === 'in' ? '▸ ' : '◂ ') + s.label,
          sig(s.mass, 6), sig(s.kmolh, 6),
          isNum(s.T_K) ? sig(s.T_K - 273.15, 5) : '—',
          sig(s.P_bar, 5),
          isNum(s.H) ? sig(s.H, 6) : '—',
          s.phase || '—',
        ],
      }));
      if (u.balance) {
        srows.push({
          cls: 'tot',
          cells: ['Δ (out − in)',
            sig((u.balance.mass_out || 0) - (u.balance.mass_in || 0), 4), '', '', '',
            sig((u.balance.Hout || 0) - (u.balance.Hin || 0), 6), ''],
        });
      }
      sec.append(repTable(['Stream', 'kg/h', 'kmol/h', 'T °C', 'P bar a', 'H kJ/h', 'Phase'], srows));

      /* compositions (mass fraction) */
      const ckeys = columnKeys([u]);
      if (ckeys.length) {
        sec.append(E('h3', null, 'Composition — mass fraction'));
        const chead = ['Component'].concat(u.streams.map((s) => s.label));
        const crows = ckeys.map((k) => ({
          cells: [meta(k).name + (meta(k).formula ? ' (' + meta(k).formula + ')' : '')]
            .concat(u.streams.map((s) => s.comps[k] ? sig(s.comps[k].frac, 5) : '—')),
        }));
        sec.append(repTable(chead, crows, { wide: true }));
      }

      /* balances */
      if (u.balance) {
        const b = u.balance;
        sec.append(E('h3', null, 'Balance'));
        const closureOK = isNum(b.closure_pct) && Math.abs(b.closure_pct) < 0.01;
        sec.append(E('div', { class: 'mbrep-band ' + (closureOK && b.converged !== false ? 'ok' : 'warn') },
          'MASS CLOSURE ' + sig(b.closure_pct, 4) + ' %  ·  in ' + sig(b.mass_in, 6) +
          ' / out ' + sig(b.mass_out, 6) + ' kg/h' +
          (b.converged === false ? '  ·  NOT CONVERGED after ' + b.iterations + ' iterations' : '')));
        sec.append(kvBlock([
          { label: 'H in', value: sig(b.Hin, 6) + ' kJ/h' },
          { label: 'H out', value: sig(b.Hout, 6) + ' kJ/h' },
          { label: 'Duty Q', value: sig(b.Q_kW, 5) + ' kW' },
          { label: 'Shaft work W', value: sig(b.W_kW, 5) + ' kW' },
          { label: 'Converged', value: String(b.converged) + ' (' + b.iterations + ' it)' },
        ]));

        if (u.compBalance.length) {
          sec.append(E('h3', null, 'Component balance'));
          const rows = u.compBalance.map((c) => ({
            cells: [c.name, sig(c.in, 6), sig(c.out, 6), sig(c.delta, 4)],
          }));
          const ti = u.compBalance.reduce((a, c) => a + c.in, 0);
          const to = u.compBalance.reduce((a, c) => a + c.out, 0);
          rows.push({ cls: 'tot', cells: ['Total', sig(ti, 6), sig(to, 6), sig(to - ti, 4)] });
          sec.append(repTable(['Component', 'In kg/h', 'Out kg/h', 'Δ kg/h'], rows));
        }

        const sank = cloneSVG(u.id, 'svg.sankey');
        if (sank) sec.append(E('figure', { class: 'mbrep-fig' }, sank,
          E('figcaption', null, 'Figure ' + u.n + '.2 — enthalpy flow (band width ∝ mass flow)')));

        const dp = detailPairs(u.details, '');
        if (dp.length) {
          sec.append(E('h3', null, 'Module details'));
          sec.append(kvBlock(dp, 'two'));
        }
      }

      if (u.warnings.length) {
        sec.append(E('h3', null, 'Warnings'));
        const ul = E('ul', { class: 'mbrep-warn' });
        for (const w of u.warnings) ul.append(E('li', null, w));
        sec.append(ul);
      }
      host.append(sec);
    }

    /* ---- basis / method notes ---- */
    const notes = E('section', { class: 'mbrep-unit notes' });
    notes.append(E('h2', null, 'Basis and method'));
    notes.append(E('ul', { class: 'mbrep-list' },
      E('li', null, 'Mass balances are model-independent and close to better than 0.01 %.'),
      E('li', null, 'Enthalpies are on a formation basis (h includes the heat of formation), so ' +
        'reaction heat appears automatically in Q = H(out) − H(in); no separate ΔHr term is added.'),
      E('li', null, 'Gas enthalpy uses NIST Shomate coefficients where available, otherwise a ' +
        'Smith–Van Ness Cp/R polynomial. Above 30 bar a Peng-Robinson enthalpy departure is added.'),
      E('li', null, 'Water and steam properties are IAPWS-IF97 throughout.'),
      E('li', null, 'Liquid enthalpy uses Hf(liq) + ∫Cp dT where available, otherwise ' +
        'h(gas) − ΔHvap with a Watson correlation (0.38 exponent).'),
      E('li', null, 'All solving is performed server-side; this page only converted display units.'),
      E('li', null, 'Component data is drawn from public sources (NIST WebBook and published ' +
        'handbooks) and each component carries a data-quality tag.')));
    host.append(notes);

    /* ---- disclaimer ---- */
    const dis = E('section', { class: 'mbrep-unit disclaimer' });
    dis.append(E('h2', null, 'Disclaimer'));
    dis.append(E('p', null,
      'This report is for preliminary engineering, education and verification only. ' +
      'Results must be checked by a qualified engineer before use in final design or ' +
      'plant operation. Values flagged as empirical estimates are correlation-based and ' +
      'valid only inside the stated envelope. No warranty of fitness for any purpose is given.'));
    host.append(dis);

    /* ---- permalink line so the printed PDF is reproducible ---- */
    const link = currentPermalink();
    if (link) {
      const lk = E('section', { class: 'mbrep-unit link' });
      lk.append(E('h3', null, 'Reproduce this case'));
      lk.append(E('p', { class: 'mbrep-url' }, link));
      host.append(lk);
    }

    /* ---- running footer ---- */
    host.append(E('footer', { class: 'mbrep-foot' },
      E('span', null, '© multicalci.com — Material & Energy Balance Calculator'),
      E('span', null, 'Generated ' + now.toLocaleString()),
      E('span', null, 'Preliminary engineering / education only')));
    return host;
  }

  function openReport() {
    const ws = worksheet();
    if (!ws.length) return HOST.toast('Add and solve a unit first.', 'info');
    buildReport();
    const ov = overlay('mbReportOverlay');
    ov.body.textContent = '';
    const bar = E('div', { class: 'mbx-bar' });
    bar.append(E('div', { class: 'mbx-title' },
      E('strong', null, 'Report preview'),
      E('span', { class: 'mbx-sub' }, 'Print → “Save as PDF”. Enable “Background graphics” ' +
        'in the print dialog to keep the dark style.')));
    const acts = E('div', { class: 'mbx-acts' });
    const inkBtn = E('button', {
      class: 'mbx-btn' + (reportInk ? ' on' : ''),
      onclick: () => {
        reportInk = !reportInk;
        inkBtn.classList.toggle('on', reportInk);
        inkBtn.textContent = reportInk ? 'Ink-saving: on' : 'Ink-saving: off';
        buildReport();
        mount();
      },
    }, reportInk ? 'Ink-saving: on' : 'Ink-saving: off');
    acts.append(inkBtn,
      E('button', { class: 'mbx-btn primary', onclick: printReport }, 'Print / Save PDF'),
      E('button', { class: 'mbx-x', 'aria-label': 'Close', onclick: () => closeOverlay(ov) }, '✕'));
    bar.append(acts);
    ov.body.append(bar);

    const frame = E('div', { class: 'mbx-repframe' });
    ov.body.append(frame);
    function mount() {
      frame.textContent = '';
      frame.append(reportHost());
      reportHost().setAttribute('aria-hidden', 'false');
    }
    mount();
    showOverlay(ov);
  }

  /* ---------------------------------------------------------------------
     Print plumbing. The print stylesheet hides every direct child of <body>
     except #mbReport — so while the preview overlay is open the report must
     be lifted OUT of the overlay first, or its hidden ancestor would blank
     the whole printout. We move it, print, then put it back. beforeprint /
     afterprint are only a backstop: Safari fires them late or not at all,
     so the Print button does the relocation itself.
  --------------------------------------------------------------------- */
  let repSlot = null;

  function liftReport() {
    const r = document.getElementById('mbReport');
    if (r && r.parentNode && r.parentNode !== document.body) {
      repSlot = r.parentNode;
      document.body.append(r);
    }
  }

  function dropReport() {
    const r = document.getElementById('mbReport');
    if (r && repSlot && repSlot.isConnected) repSlot.append(r);
    repSlot = null;
  }

  function printReport() {
    if (!document.getElementById('mbReport')) buildReport();
    liftReport();
    try { window.print(); } finally { setTimeout(dropReport, 1000); }
  }

  /* Native Ctrl/Cmd-P from the normal page should still print the report. */
  window.addEventListener('beforeprint', () => {
    if (!(HOST.state.units || []).length) return;
    if (!document.getElementById('mbReport')) buildReport();
    liftReport();
  });
  window.addEventListener('afterprint', dropReport);

  /* =====================================================================
     7. PERMALINK POLISH
        v1  #s=<base64 of full snapshot>          (legacy — still readable)
        v2  #w=<base64url of compact snapshot>    (short keys, no names)
        v2z #z=<base64url of deflate-raw(v2)>     (native CompressionStream)
  ===================================================================== */

  const B64URL = {
    encode(bytesOrStr) {
      let b64;
      if (typeof bytesOrStr === 'string') {
        b64 = btoa(unescape(encodeURIComponent(bytesOrStr)));
      } else {
        let s = '';
        for (let i = 0; i < bytesOrStr.length; i++) s += String.fromCharCode(bytesOrStr[i]);
        b64 = btoa(s);
      }
      return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    toBytes(u) {
      const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    toText(u) {
      const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
      return decodeURIComponent(escape(atob(b64 + '='.repeat((4 - b64.length % 4) % 4))));
    },
  };

  /** Drop nulls and round floats — shorter URLs, identical inputs. */
  function trim(x) {
    if (isNum(x)) return parseFloat(x.toPrecision(10));
    return x;
  }

  /** Full snapshot → compact form (component names/formulas are re-fetched). */
  function compact(snap) {
    return {
      v: 2,
      u: (snap.units || []).map((su) => {
        const o = { m: su.module };
        if (su.nOut) o.n = su.nOut;
        if (su.params && Object.keys(su.params).length) o.p = su.params;
        if (su.paramUnits && Object.keys(su.paramUnits).length) o.q = su.paramUnits;
        o.s = (su.streams || []).map((s) => {
          const t = {};
          if (isNum(s.mass_flow_kg_h)) t.f = trim(s.mass_flow_kg_h);
          if (isNum(s.T_K)) t.t = trim(s.T_K);
          if (isNum(s.P_bar)) t.p = trim(s.P_bar);
          if (s.label) t.l = s.label;
          if (s.compMode && s.compMode !== 'mass') t.cm = s.compMode;
          if (s.du) t.d = [s.du.flow, s.du.T, s.du.P];
          if (s.components && s.components.length) {
            t.c = s.components.map((c) => [c.key, trim(c.mass_fraction),
              isNum(c.mw) ? trim(c.mw) : null]);
          }
          return t;
        });
        return o;
      }),
    };
  }

  /** Compact form → the snapshot shape restoreSnapshot() expects. */
  function expand(c) {
    return {
      v: 1,
      units: (c.u || []).map((o) => ({
        module: o.m,
        nOut: o.n,
        params: o.p || {},
        paramUnits: o.q || {},
        streams: (o.s || []).map((t, i) => ({
          label: t.l || ('Inlet ' + (i + 1)),
          mass_flow_kg_h: isNum(t.f) ? t.f : null,
          T_K: isNum(t.t) ? t.t : null,
          P_bar: isNum(t.p) ? t.p : null,
          compMode: t.cm || 'mass',
          du: t.d ? { flow: t.d[0], T: t.d[1], P: t.d[2] } : undefined,
          components: (t.c || []).map((a) => {
            const m = meta(a[0]);
            return {
              key: a[0],
              name: m.name,
              formula: m.formula || null,
              mw: isNum(a[2]) ? a[2] : m.mw,
              mass_fraction: isNum(a[1]) ? a[1] : 0,
            };
          }),
        })),
      })),
    };
  }

  const canDeflate = typeof CompressionStream === 'function' &&
    typeof Response === 'function' && typeof Blob === 'function';

  async function deflate(text) {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([text]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }

  let lastLink = null;   /* {url, hash, chars, encoding} */

  /** Build the shortest available permalink for the current worksheet. */
  async function buildPermalink() {
    const snap = HOST.snapshot();
    if (!snap || !(snap.units || []).length) return null;
    delete snap.t;
    const json = JSON.stringify(compact(snap));
    let hash = '#w=' + B64URL.encode(json);
    let encoding = 'compact';
    if (canDeflate) {
      try {
        const z = '#z=' + B64URL.encode(await deflate(json));
        if (z.length < hash.length) { hash = z; encoding = 'compact + deflate'; }
      } catch (_e) { /* keep the uncompressed form */ }
    }
    const url = location.origin + location.pathname + hash;
    lastLink = { url, hash, chars: url.length, encoding };
    return lastLink;
  }

  /** The link already in the address bar, if any (used by the report). */
  function currentPermalink() {
    if (lastLink) return lastLink.url;
    if (/^#(s|w|z)=/.test(location.hash)) {
      return location.origin + location.pathname + location.hash;
    }
    return null;
  }

  async function openPermalinkSheet() {
    if (!(HOST.state.units || []).length) return HOST.toast('Nothing to link yet.', 'info');
    let link;
    try { link = await buildPermalink(); } catch (_e) { link = null; }
    if (!link) return HOST.toast('Could not build a link for this worksheet.', 'err');
    history.replaceState(null, '', link.hash);

    const ov = overlay('mbLinkOverlay', true);
    ov.body.textContent = '';
    const bar = E('div', { class: 'mbx-bar' });
    bar.append(E('div', { class: 'mbx-title' },
      E('strong', null, 'Shareable permalink'),
      E('span', { class: 'mbx-sub' }, 'Inputs only — results are never stored in the link.')));
    bar.append(E('div', { class: 'mbx-acts' },
      E('button', { class: 'mbx-x', 'aria-label': 'Close', onclick: () => closeOverlay(ov) }, '✕')));
    ov.body.append(bar);

    const inp = E('input', {
      class: 'mbx-url', readonly: 'readonly', 'aria-label': 'Permalink',
      onclick: (e) => e.target.select(),
    });
    inp.value = link.url;
    ov.body.append(inp);

    ov.body.append(E('div', { class: 'mbx-meta' },
      link.chars + ' characters · ' + link.encoding +
      (link.chars > 7500 ? ' · very long: some mail clients truncate links this size — ' +
        'the Cases list is safer for big worksheets' : '')));

    const row = E('div', { class: 'mbx-acts wrap' });
    row.append(E('button', {
      class: 'mbx-btn primary',
      onclick: () => copyText(link.url, 'Permalink copied to clipboard.'),
    }, 'Copy link'));
    if (navigator.share) {
      row.append(E('button', {
        class: 'mbx-btn',
        onclick: () => navigator.share({
          title: 'Material balance case — multicalci.com',
          text: 'Material & energy balance worksheet',
          url: link.url,
        }).catch(() => { /* user cancelled */ }),
      }, 'Share…'));
    }
    row.append(E('button', {
      class: 'mbx-btn',
      onclick: () => window.open(link.url, '_blank', 'noopener'),
    }, 'Open in new tab'));
    ov.body.append(row);

    ov.body.append(E('div', { class: 'mbx-foot' },
      'Anyone opening this link gets your inputs pre-loaded and solves them against the ' +
      'live engine, so the numbers are always current. Older ' +
      'links (the longer #s= form) keep working.'));
    showOverlay(ov);
  }

  /** Boot: decode #w= / #z= links the inline boot code cannot read. */
  async function restoreFromHash() {
    const h = location.hash || '';
    if (!/^#(w|z)=/.test(h)) return false;
    /* names and MWs come from the picker — give it a moment to arrive */
    for (let i = 0; i < 40 && !HOST.componentsLoaded; i++) {
      await new Promise((r) => setTimeout(r, 75));
    }
    try {
      const payload = h.slice(3);
      const json = h.startsWith('#z=')
        ? await inflate(B64URL.toBytes(payload))
        : B64URL.toText(payload);
      const c = JSON.parse(json);
      if (!c || !Array.isArray(c.u)) throw new Error('bad payload');
      if (HOST.restore(expand(c))) {
        HOST.toast('Worksheet restored from permalink.', 'ok');
        return true;
      }
      return false;
    } catch (_e) {
      HOST.toast('This permalink could not be read.', 'err');
      return false;
    }
  }

  /* =====================================================================
     8. EXPORT SHEET (single entry point, mobile-first)
  ===================================================================== */

  function openExportSheet() {
    const n = (HOST.state.units || []).length;
    const ov = overlay('mbExportOverlay', true);
    ov.body.textContent = '';
    const bar = E('div', { class: 'mbx-bar' });
    bar.append(E('div', { class: 'mbx-title' },
      E('strong', null, 'Export'),
      E('span', { class: 'mbx-sub' }, n ? n + ' unit' + (n === 1 ? '' : 's') + ' on the worksheet'
        : 'Nothing on the worksheet yet')));
    bar.append(E('div', { class: 'mbx-acts' },
      E('button', { class: 'mbx-x', 'aria-label': 'Close', onclick: () => closeOverlay(ov) }, '✕')));
    ov.body.append(bar);

    const menu = E('div', { class: 'mbx-menu' });
    const item = (title, sub, fn) => menu.append(E('button', {
      class: 'mbx-item', onclick: () => { closeOverlay(ov); fn(); },
    }, E('span', { class: 'mi-t' }, title), E('span', { class: 'mi-s' }, sub)));

    item('Spreadsheet view', 'Every stream in one grid · copy as TSV', openSpreadsheet);
    item('Streams CSV', 'Flows, T, P, H and compositions', () => exportStreamsCSV(sheetMode));
    item('Balances CSV', 'Mass closure, energy, component balance, warnings', exportBalancesCSV);
    item('PDF report', 'Print-ready report with flowsheets and balances', openReport);
    item('Permalink', 'Short shareable link to these inputs', openPermalinkSheet);
    ov.body.append(menu);
    showOverlay(ov);
  }

  /* =====================================================================
     9. OVERLAY PLUMBING
  ===================================================================== */

  const openOverlays = [];

  function overlay(id, small) {
    let ov = document.getElementById(id);
    if (ov) return ov._mb;
    ov = E('div', { class: 'mbx-ov' + (small ? ' small' : ''), id, role: 'dialog', 'aria-modal': 'true' });
    const scrim = E('div', { class: 'mbx-scrim' });
    const body = E('div', { class: 'mbx-panel' });
    ov.append(scrim, body);
    const api = { root: ov, body };
    ov._mb = api;
    scrim.addEventListener('click', () => closeOverlay(api));
    document.body.append(ov);
    return api;
  }

  function showOverlay(api) {
    api.root.classList.add('on');
    document.documentElement.classList.add('mbx-lock');
    if (!openOverlays.includes(api)) openOverlays.push(api);
    const focusable = api.body.querySelector('button, input, [tabindex]');
    if (focusable) focusable.focus({ preventScroll: true });
  }

  function closeOverlay(api) {
    api.root.classList.remove('on');
    const i = openOverlays.indexOf(api);
    if (i >= 0) openOverlays.splice(i, 1);
    if (!openOverlays.length) document.documentElement.classList.remove('mbx-lock');
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openOverlays.length) closeOverlay(openOverlays[openOverlays.length - 1]);
  });

  /* =====================================================================
     10. STYLES — overlay chrome (screen) + report (screen preview & print)
  ===================================================================== */

  const CSS = `
/* ---------- overlay chrome ---------- */
html.mbx-lock,html.mbx-lock body{overflow:hidden}
.mbx-ov{position:fixed;inset:0;z-index:70;display:none}
.mbx-ov.on{display:block}
.mbx-scrim{position:absolute;inset:0;background:#000b;backdrop-filter:blur(2px)}
.mbx-panel{position:absolute;inset:10px;overflow:auto;display:flex;flex-direction:column;
  background:var(--panel,#0f262b);border:1px solid var(--bezel,#1c424b);border-radius:14px;
  box-shadow:0 20px 60px #000a}
.mbx-ov.small .mbx-panel{inset:auto;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(560px,94vw);max-height:86vh;padding-bottom:8px}
@media(max-width:860px){
  .mbx-panel{inset:0;border-radius:0;border:0}
  .mbx-ov.small .mbx-panel{inset:auto;left:0;right:0;bottom:0;top:auto;transform:none;
    width:auto;border-radius:18px 18px 0 0;border:1px solid var(--bezel,#1c424b);
    padding-bottom:calc(8px + env(safe-area-inset-bottom))}
}
.mbx-bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  padding:12px 14px;border-bottom:1px solid var(--line,#1a3940);
  background:linear-gradient(#12303566,#0f262bf2)}
.mbx-title{flex:1;min-width:180px;display:flex;flex-direction:column;gap:2px}
.mbx-title strong{font-size:15px;letter-spacing:.02em}
.mbx-sub{font-size:11.5px;color:var(--dim,#7fa3a1);line-height:1.35}
.mbx-modes{display:flex;gap:6px}
.mbx-mbtn{min-height:40px;padding:0 12px;border:1px solid var(--bezel,#1c424b);border-radius:999px;
  font-size:12px;color:var(--dim,#7fa3a1);background:var(--bg2,#0b1d21);white-space:nowrap}
.mbx-mbtn.on{border-color:var(--accent,#35d0ba);color:var(--accent,#35d0ba);background:#0d2b28}
.mbx-acts{display:flex;align-items:center;gap:8px}
.mbx-acts.wrap{flex-wrap:wrap;padding:0 14px 4px}
.mbx-btn{min-height:44px;padding:0 14px;border:1px solid var(--bezel,#1c424b);border-radius:9px;
  font-size:13px;color:var(--dim,#7fa3a1);background:var(--bg2,#0b1d21);white-space:nowrap}
.mbx-btn:hover{color:var(--ink,#d9e8e6);border-color:var(--accent,#35d0ba)}
.mbx-btn.on{border-color:var(--amber,#f5b02e);color:var(--amber,#f5b02e)}
.mbx-btn.primary{background:linear-gradient(180deg,#3fe0c8,#22b7a1);color:#04211d;
  border:0;font-weight:700}
.mbx-x{min-width:44px;min-height:44px;border-radius:9px;color:var(--dim,#7fa3a1);font-size:19px}
.mbx-x:hover{color:var(--ink,#d9e8e6)}
.mbx-foot{padding:10px 14px 16px;font-size:11.5px;color:var(--faint,#4f7472);line-height:1.5}
.mbx-meta{padding:8px 14px 0;font-size:11.5px;color:var(--dim,#7fa3a1);font-family:var(--mono,monospace)}
.mbx-url{margin:12px 14px 0;width:calc(100% - 28px);font-family:var(--mono,monospace);
  font-size:12px;word-break:break-all}
.mbx-menu{display:flex;flex-direction:column;padding:6px 8px 10px}
.mbx-item{display:flex;flex-direction:column;gap:2px;align-items:flex-start;text-align:left;
  min-height:60px;padding:10px 12px;border-radius:10px;border:1px solid transparent}
.mbx-item:hover{background:var(--panel2,#133036);border-color:var(--bezel,#1c424b)}
.mbx-item .mi-t{font-size:14.5px}
.mbx-item .mi-s{font-size:11.5px;color:var(--dim,#7fa3a1)}

/* ---------- spreadsheet grid ---------- */
.mbx-scroll{flex:1;overflow:auto;padding:0 0 4px}
table.mbx-grid{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;
  font-family:var(--mono,monospace);font-size:12px}
table.mbx-grid th{position:sticky;top:0;z-index:3;background:#12303a;color:var(--faint,#4f7472);
  font:600 10.5px/1.3 var(--mono,monospace);letter-spacing:.06em;text-transform:uppercase;
  text-align:right;padding:8px 10px;border-bottom:1px solid var(--bezel,#1c424b);white-space:nowrap}
table.mbx-grid th.comp{color:var(--accent,#35d0ba)}
table.mbx-grid th.stick{left:0;z-index:4;text-align:left}
table.mbx-grid td{padding:6px 10px;text-align:right;white-space:nowrap;
  border-bottom:1px solid #14313866;color:var(--amber,#f5b02e)}
table.mbx-grid td.txt{color:var(--ink,#d9e8e6);text-align:left;font-family:var(--sans,sans-serif)}
table.mbx-grid td.comp{color:var(--ink,#d9e8e6)}
table.mbx-grid td.stick{position:sticky;left:0;z-index:2;background:#0e2429;text-align:left}
table.mbx-grid tr.o td{background:#0d2226}
table.mbx-grid tr.o td.stick{background:#0d2226}
table.mbx-grid tr.grp td{background:#0a1b1f;color:var(--accent,#35d0ba);text-align:left;
  font:600 11px/1.4 var(--mono,monospace);letter-spacing:.1em;padding:8px 10px;position:static}
table.mbx-grid tr:hover td{background:#153a3f}

/* ---------- report: screen preview frame ---------- */
.mbx-repframe{flex:1;overflow:auto;padding:14px;background:#050f11}
.mbrep{display:none}
.mbx-repframe .mbrep{display:block;max-width:820px;margin:0 auto;
  background:var(--bg,#081517);border:1px solid var(--bezel,#1c424b);border-radius:10px;
  padding:26px 26px 40px}

/* ---------- report content (shared by preview and print) ---------- */
.mbrep{color:var(--ink,#d9e8e6);font:13px/1.5 var(--sans,sans-serif)}
.mbrep-head{border-bottom:2px solid var(--accent,#35d0ba);padding-bottom:12px;margin-bottom:18px}
.mbrep-brand{display:flex;align-items:center;gap:7px;font:600 15px var(--sans,sans-serif);
  letter-spacing:.04em;margin-bottom:8px}
.mbrep-brand .lamp2{width:9px;height:9px;border-radius:50%;background:var(--accent,#35d0ba);
  box-shadow:0 0 7px var(--accent,#35d0ba)}
.mbrep-brand .bd{color:var(--dim,#7fa3a1)}
.mbrep-head h1{font-size:19px;letter-spacing:.01em;margin-bottom:10px}
.mbrep h2{font-size:15px;margin:0 0 10px;padding-bottom:6px;
  border-bottom:1px solid var(--bezel,#1c424b);display:flex;align-items:center;gap:8px}
.mbrep h2 .tag2{font:600 10px var(--mono,monospace);color:var(--accent,#35d0ba);
  border:1px solid var(--accent,#35d0ba);border-radius:4px;padding:2px 6px}
.mbrep h2 .unsolved{margin-left:auto;font:600 9.5px var(--mono,monospace);letter-spacing:.1em;
  color:var(--warn,#f5b02e);border:1px solid var(--amber-dim,#8a6a24);border-radius:4px;padding:2px 6px}
.mbrep h3{font:600 11px var(--mono,monospace);letter-spacing:.14em;text-transform:uppercase;
  color:var(--faint,#4f7472);margin:16px 0 7px}
.mbrep-unit{margin:0 0 24px;padding:14px 16px;background:#0c2126;
  border:1px solid var(--line,#1a3940);border-radius:10px}
.mbrep-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 14px;font-size:12.5px}
.mbrep-kv.mast{grid-template-columns:92px 1fr}
.mbrep-kv.two{grid-template-columns:auto 1fr auto 1fr}
.mbrep-kv dt{color:var(--dim,#7fa3a1)}
.mbrep-kv dd{font-family:var(--mono,monospace);color:var(--amber,#f5b02e)}
.mbrep-fig{margin:10px 0 4px}
.mbrep-fig svg{width:100%;height:auto;display:block}
.mbrep-fig figcaption{font-size:10.5px;color:var(--faint,#4f7472);margin-top:4px;
  font-family:var(--mono,monospace)}
table.mbrep-tab{border-collapse:collapse;width:100%;font-size:12px;margin:2px 0 4px}
table.mbrep-tab th{font:600 9.5px var(--mono,monospace);letter-spacing:.08em;text-transform:uppercase;
  color:var(--faint,#4f7472);text-align:right;padding:5px 8px;
  border-bottom:1px solid var(--bezel,#1c424b);white-space:nowrap}
table.mbrep-tab th:first-child{text-align:left}
table.mbrep-tab td{padding:5px 8px;text-align:right;font-family:var(--mono,monospace);
  border-bottom:1px solid #14313866;white-space:nowrap}
table.mbrep-tab td.txt{text-align:left;font-family:var(--sans,sans-serif);white-space:normal}
table.mbrep-tab tr.out td{color:var(--amber,#f5b02e)}
table.mbrep-tab tr.tot td{border-top:1.5px solid var(--bezel,#1c424b);color:var(--accent,#35d0ba)}
table.mbrep-tab.wide{font-size:11px}
.mbrep-band{font:12px var(--mono,monospace);border:1px solid;border-radius:8px;
  padding:8px 12px;margin:4px 0 10px}
.mbrep-band.ok{border-color:#1e5c3d;background:#0d2b1d;color:var(--ok,#3ddc84)}
.mbrep-band.warn{border-color:#6b5620;background:#2b220c;color:var(--warn,#f5b02e)}
.mbrep-warn{padding-left:18px;font-size:12px;color:var(--warn,#f5b02e)}
.mbrep-warn li{margin:3px 0}
.mbrep-list{padding-left:18px;font-size:12.5px;color:var(--dim,#7fa3a1)}
.mbrep-list li{margin:4px 0}
.mbrep-unit.disclaimer{border-color:var(--amber-dim,#8a6a24);background:#1c1608}
.mbrep-unit.disclaimer p{font-size:12px;color:var(--ink,#d9e8e6)}
.mbrep-url{font-family:var(--mono,monospace);font-size:10px;color:var(--dim,#7fa3a1);
  word-break:break-all}
.mbrep-foot{display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:space-between;
  border-top:1px solid var(--bezel,#1c424b);padding-top:8px;margin-top:6px;
  font:10px var(--mono,monospace);color:var(--faint,#4f7472)}

/* ink-saving variant */
.mbrep.ink{background:#fff;color:#101418}
.mbrep.ink .mbrep-unit{background:#fff;border-color:#c9d3d6}
.mbrep.ink .mbrep-head{border-bottom-color:#0d6d61}
.mbrep.ink h2{border-bottom-color:#c9d3d6}
.mbrep.ink h2 .tag2{color:#0d6d61;border-color:#0d6d61}
.mbrep.ink h3,.mbrep.ink .mbrep-kv dt,.mbrep.ink .mbrep-list,
.mbrep.ink .mbrep-fig figcaption,.mbrep.ink .mbrep-url,.mbrep.ink .mbrep-foot{color:#4a5a5e}
.mbrep.ink .mbrep-kv dd,.mbrep.ink table.mbrep-tab tr.out td{color:#8a5a00}
.mbrep.ink table.mbrep-tab th{color:#4a5a5e;border-bottom-color:#c9d3d6}
.mbrep.ink table.mbrep-tab td{border-bottom-color:#e2e8ea}
.mbrep.ink table.mbrep-tab tr.tot td{border-top-color:#9aa8ab;color:#0d6d61}
.mbrep.ink .mbrep-band.ok{background:#eefaf2;border-color:#9ccdb2;color:#0b6b3e}
.mbrep.ink .mbrep-band.warn{background:#fdf6e6;border-color:#d8bd7a;color:#7a5a10}
.mbrep.ink .mbrep-warn{color:#7a5a10}
.mbrep.ink .mbrep-unit.disclaimer{background:#fdf9ec;border-color:#d8bd7a}
.mbrep.ink .mbrep-unit.disclaimer p{color:#101418}
.mbrep.ink .mbrep-foot{border-top-color:#c9d3d6}
.mbrep.ink svg text{fill:#101418}

/* ---------- PRINT ---------- */
@media print{
  @page{size:A4;margin:13mm 11mm 20mm}
  html,body{background:#fff!important}
  html.mbx-lock,html.mbx-lock body{overflow:visible!important}
  body>*{display:none!important}
  #mbReport{display:block!important;position:static!important;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .mbrep{background:var(--bg,#081517);color:var(--ink,#d9e8e6);font-size:9.5pt;padding:0}
  .mbrep.ink{background:#fff;color:#000}
  .mbrep-head h1{font-size:15pt}
  .mbrep h2{font-size:11.5pt}
  .mbrep-unit{break-inside:auto;page-break-inside:auto;margin-bottom:8mm}
  .mbrep h2,.mbrep h3{break-after:avoid;page-break-after:avoid}
  .mbrep-fig,.mbrep-band,.mbrep-kv,tr{break-inside:avoid;page-break-inside:avoid}
  table.mbrep-tab thead{display:table-header-group}
  .mbrep-fig svg{max-height:70mm}
  .mbrep-foot{position:fixed;bottom:-14mm;left:0;right:0;background:transparent;
    border-top:1px solid var(--bezel,#1c424b);font-size:7pt}
  .mbrep.ink .mbrep-foot{border-top-color:#c9d3d6;color:#4a5a5e}
  .mbx-ov,.mbx-repframe{display:none!important}
}
`;

  function injectCSS() {
    if (document.getElementById('mbExportCSS')) return;
    document.head.append(E('style', { id: 'mbExportCSS' }, CSS));
  }

  /* =====================================================================
     11. WIRING — inject buttons, rebind Permalink, boot hash restore
  ===================================================================== */

  /** Replace a node to drop the page's existing listeners, then bind ours. */
  function rebind(id, handler, label) {
    const b = document.getElementById(id);
    if (!b) return null;
    const c = b.cloneNode(false);
    c.innerHTML = '';
    c.textContent = label || b.textContent;
    b.replaceWith(c);
    c.addEventListener('click', handler);
    return c;
  }

  function wire() {
    injectCSS();

    /* desktop header: Export sits next to Cases */
    const header = document.querySelector('header');
    const cases = document.getElementById('btnCases');
    if (header && !document.getElementById('mbBtnExport')) {
      const b = E('button', {
        class: (cases && cases.className) || 'hbtn', id: 'mbBtnExport',
        title: 'Spreadsheet view, CSV, PDF report, permalink',
        onclick: openExportSheet,
      }, 'Export');
      if (cases) cases.before(b); else header.append(b);
    }

    /* the two Permalink buttons get the polished sheet */
    rebind('btnLink', openPermalinkSheet, 'Permalink');
    rebind('btnLinkM', openExportSheet, 'Export');

    /* legacy #s= links already restored by the inline boot; handle #w=/#z= */
    restoreFromHash();
  }

  if (!hostReady()) {
    console.warn('[mb-exports] material-balance client not detected — exports disabled.');
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire, { once: true });
  } else wire();

  /* Small public surface, handy for the SEO template pages of STEP 19. */
  window.mbExports = {
    openSpreadsheet, openReport, openExportSheet, openPermalinkSheet,
    exportStreamsCSV, exportBalancesCSV, copyGridTSV,
    buildReport, buildPermalink, worksheet,
  };
})();
