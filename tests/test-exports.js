/* jsdom integration harness: load the real page, attach mb-exports.js,
   fake a solved worksheet, then exercise every export path. */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('/mnt/project/material-balance.html', 'utf8');
const exportsJs = fs.readFileSync('/home/claude/mb-exports.js', 'utf8');

const COMPONENTS = [
  { key: 'water', name: 'Water', formula: 'H2O', mw: 18.01528, category: 'inorganic', data_quality: 'nist' },
  { key: 'methane', name: 'Methane', formula: 'CH4', mw: 16.0425, category: 'hydrocarbon', data_quality: 'nist' },
  { key: 'co2', name: 'Carbon dioxide', formula: 'CO2', mw: 44.0095, category: 'inorganic', data_quality: 'nist' },
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://multicalci.com/material-balance.html',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.fetch = () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ ok: true, components: COMPONENTS }),
    });
    win.URL.createObjectURL = () => 'blob:fake';
    win.URL.revokeObjectURL = () => {};
    win.print = () => { win.__printed = (win.__printed || 0) + 1; };
    win.navigator.clipboard = { writeText: (t) => { win.__clip = t; return Promise.resolve(); } };
  },
});
const win = dom.window;

/* capture downloads instead of writing files */
const downloads = [];
const origCreate = win.document.createElement.bind(win.document);
win.HTMLAnchorElement.prototype.click = function () {
  downloads.push({ name: this.getAttribute('download') });
};
/* capture Blob text */
const RealBlob = win.Blob;
win.Blob = class extends RealBlob {
  constructor(parts, opts) { super(parts, opts); this.__text = String(parts[0]); downloads.__last = this.__text; }
};

let fails = 0;
function ok(cond, name, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

win.addEventListener('load', () => {
  /* --- attach mb-exports.js the way the script tag would --- */
  const s = win.document.createElement('script');
  s.textContent = exportsJs;
  win.document.body.append(s);

  console.log('\n1. WIRING');
  ok(!!win.mbExports, 'window.mbExports published');
  ok(!!win.document.getElementById('mbBtnExport'), 'Export button injected in header');
  ok(!!win.document.getElementById('mbExportCSS'), 'stylesheet injected');
  ok(win.document.getElementById('btnLinkM').textContent === 'Export', 'mobile Link rebound to Export');

  /* --- seed components + a two-unit worksheet with fake engine results --- */
  win.eval(`
    setComponents(${JSON.stringify(COMPONENTS)});
    state = { v: 1, units: [] };
    const m = newUnit('mixer');
    m.streams[0].mass_flow_kg_h = 1000; m.streams[0].T_K = 300.15; m.streams[0].P_bar = 2;
    m.streams[0].components = [{ key:'water', name:'Water', formula:'H2O', mw:18.01528, mass_fraction:1 }];
    m.streams[1].mass_flow_kg_h = 500; m.streams[1].T_K = 360.15; m.streams[1].P_bar = 2;
    m.streams[1].components = [{ key:'water', name:'Water', formula:'H2O', mw:18.01528, mass_fraction:1 }];
    m.result = {
      streams_out: [{ mass_flow_kg_h:1500, T_K:320.02, P_bar:2, H_kJh:-2.3781e8,
        components:[{ key:'water', mass_fraction:1, phase:'liquid' }] }],
      mass_balance: { in:1500, out:1500, closure_pct:0 },
      energy_balance: { Hin:-2.3781e8, Hout:-2.3781e8, Q_kW:0, W_kW:0 },
      details: { T_out_K: 320.02, mode: 'adiabatic' },
      converged: true, iterations: 7, warnings: ['adiabatic mix — no duty applied'],
    };
    m.engineVersion = 'mb-engine 0.9.3';
    m.apiWarnings = [];
    state.units.push(m);

    const r = newUnit('reactor');
    r.streams[0].mass_flow_kg_h = 2000; r.streams[0].T_K = 900; r.streams[0].P_bar = 25;
    r.streams[0].components = [
      { key:'methane', name:'Methane', formula:'CH4', mw:16.0425, mass_fraction:0.4 },
      { key:'water', name:'Water', formula:'H2O', mw:18.01528, mass_fraction:0.6 }];
    r.result = {
      streams_out: [{ mass_flow_kg_h:2000, T_K:1120, P_bar:24.5, H_kJh:1.42e7,
        components:[
          { key:'methane', mass_fraction:0.05, phase:'gas' },
          { key:'water', mass_fraction:0.45, phase:'gas' },
          { key:'co2', mass_fraction:0.50, phase:'gas' }] }],
      mass_balance: { in:2000, out:2000, closure_pct:0.0004 },
      energy_balance: { Hin:-1.1e7, Hout:1.42e7, Q_kW:7055.6, W_kW:0 },
      details: { extents_kmol_h:[12.4], dHr298_kJmol:[165.0] },
      converged: true, iterations: 3, warnings: [],
    };
    r.engineVersion = 'mb-engine 0.9.3';
    state.units.push(r);
    renderUnits();
  `);

  const ws = win.mbExports.worksheet();
  console.log('\n2. WORKSHEET MODEL');
  ok(ws.length === 2, 'two units seen');
  ok(ws[0].streams.length === 3, '3 streams on the mixer (2 in + 1 out)', ws[0].streams.length);
  const outMix = ws[0].streams[2];
  ok(Math.abs(outMix.kmolh - 1500 / 18.01528) < 1e-6, 'kmol/h from MW_avg', outMix.kmolh);
  ok(outMix.phase === 'liquid', 'phase carried through', outMix.phase);
  const feed = ws[1].streams[0];
  const xCH4 = feed.comps.methane.x;
  /* mole frac check: (0.4/16.0425) / (0.4/16.0425 + 0.6/18.01528) */
  const expect = (0.4 / 16.0425) / (0.4 / 16.0425 + 0.6 / 18.01528);
  ok(Math.abs(xCH4 - expect) < 1e-12, 'mole fraction arithmetic', xCH4 + ' vs ' + expect);
  ok(Math.abs(feed.comps.methane.kgh - 800) < 1e-9, 'component kg/h', feed.comps.methane.kgh);
  const cb = ws[1].compBalance.find((c) => c.key === 'co2');
  ok(Math.abs(cb.in - 0) < 1e-9 && Math.abs(cb.out - 1000) < 1e-9, 'component balance in/out', JSON.stringify(cb));
  ok(ws[0].params.length >= 1, 'mixer params listed', JSON.stringify(ws[0].params));

  console.log('\n3. SPREADSHEET VIEW');
  win.mbExports.openSpreadsheet();
  const ov = win.document.getElementById('mbSheetOverlay');
  ok(!!ov && ov.classList.contains('on'), 'overlay opened');
  const grid = ov.querySelector('table.mbx-grid');
  ok(!!grid, 'grid rendered');
  const heads = [...grid.querySelectorAll('thead th')].map((t) => t.textContent);
  ok(heads.slice(0, 3).join('|') === 'Unit|Stream|Dir', 'fixed columns', heads.slice(0, 3).join('|'));
  ok(heads.includes('Carbon dioxide'), 'component column named from picker metadata');
  const bodyRows = [...grid.querySelectorAll('tbody tr')];
  ok(bodyRows.filter((r) => r.className === 'grp').length === 2, 'one group row per unit');
  ok(bodyRows.filter((r) => r.className !== 'grp').length === 5, '5 stream rows', bodyRows.length);
  ok(!!grid.querySelector('td.stick'), 'sticky stream column present');

  console.log('\n4. CSV EXPORT');
  win.mbExports.exportStreamsCSV('kgh');
  const csv = downloads.__last;
  ok(downloads.length === 1 && /^multicalci-mb-streams-\d{8}-\d{4}\.csv$/.test(downloads[0].name),
    'filename stamped', downloads[0] && downloads[0].name);
  ok(csv.charCodeAt(0) === 0xFEFF, 'UTF-8 BOM for Excel');
  ok(csv.includes('\r\n'), 'CRLF line endings');
  ok(csv.includes('# component columns,component kg/h'), 'mode recorded in header');
  const dataLines = csv.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l && !l.startsWith('#'));
  const headerCols = dataLines[0].split(',');
  ok(headerCols.length === 14, 'header column count = 11 fixed + 3 components', headerCols.length);
  const ragged = dataLines.filter((l) => l.split(',').length !== headerCols.length);
  ok(ragged.length === 0, 'every row has the same column count', ragged.length + ' ragged');
  ok(/,-237810000,/.test(csv) || /-2\.3781/.test(csv), 'full-precision numbers, no thousands commas');
  ok(!/,[\d.]+,000/.test(csv), 'no locale separators leaked into CSV');

  win.mbExports.exportBalancesCSV();
  const bcsv = downloads.__last;
  ok(bcsv.includes('# section,unit balances'), 'balances section');
  ok(bcsv.includes('# section,component balances'), 'component balance section');
  ok(bcsv.includes('# section,warnings') && bcsv.includes('adiabatic mix'), 'warnings section');
  ok(bcsv.includes('mb-engine 0.9.3'), 'engine version recorded');

  win.mbExports.copyGridTSV('frac');
  ok((win.__clip || '').split('\r\n').length === 6, 'TSV = header + 5 rows (no group rows)',
    (win.__clip || '').split('\r\n').length);
  ok((win.__clip || '').split('\r\n')[0].split('\t').length === 14, 'TSV column count');

  console.log('\n5. PRINT REPORT');
  let rep = win.mbExports.buildReport();
  ok(rep.querySelectorAll('section.mbrep-unit').length === 4,
    'no permalink yet → 2 unit sections + notes + disclaimer', rep.querySelectorAll('section.mbrep-unit').length);
  win.location.hash = '#w=deadbeef';
  rep = win.mbExports.buildReport();
  ok(rep.querySelectorAll('section.mbrep-unit').length === 5,
    'permalink in the address bar adds the reproduce-this-case block', rep.querySelectorAll('section.mbrep-unit').length);
  ok(/multicalci\.com\/material-balance\.html#w=deadbeef/.test(rep.textContent), 'permalink printed in the report');
  win.location.hash = '';
  ok(rep.querySelectorAll('figure.mbrep-fig svg.diagram').length === 2,
    'flowsheet SVG cloned per unit', rep.querySelectorAll('figure.mbrep-fig svg.diagram').length);
  ok(rep.querySelectorAll('figure.mbrep-fig svg.sankey').length === 2, 'sankey cloned per solved unit');
  ok(!rep.querySelector('[tabindex]'), 'interactive attributes stripped from cloned SVG');
  ok(rep.querySelectorAll('table.mbrep-tab').length >= 6, 'stream/composition/balance tables present',
    rep.querySelectorAll('table.mbrep-tab').length);
  ok(/MASS CLOSURE/.test(rep.textContent), 'closure band in report');
  ok(/© multicalci\.com/.test(rep.textContent), 'copyright footer');
  ok(/Disclaimer/.test(rep.textContent), 'disclaimer section');
  ok(/Formation enthalpy/.test(rep.textContent), 'basis stated in masthead');
  ok(/extents_kmol_h/.test(rep.textContent), 'module details flattened into report');
  const bands = [...rep.querySelectorAll('.mbrep-band')];
  ok(bands.length === 2 && bands.every((b) => b.classList.contains('ok')), 'both closures pass');

  win.mbExports.openReport();
  ok(win.document.getElementById('mbReportOverlay').classList.contains('on'), 'report preview opens');
  ok(win.document.getElementById('mbReport').parentNode.className === 'mbx-repframe',
    'report mounted inside the preview frame');
  win.document.querySelector('#mbReportOverlay .mbx-btn.primary').click();
  ok(win.document.getElementById('mbReport').parentNode === win.document.body,
    'report lifted to body level for printing (overlay cannot blank the printout)');
  ok(win.__printed === 1, 'window.print() called once');
  win.dispatchEvent(new win.Event('afterprint'));
  ok(win.document.getElementById('mbReport').parentNode.className === 'mbx-repframe',
    'report returned to the preview frame afterwards');

  console.log('\n6. PERMALINK v2');
  win.mbExports.buildPermalink().then((link) => {
    ok(!!link && link.hash.startsWith('#w='), 'compact hash built (no CompressionStream in jsdom)', link && link.hash.slice(0, 4));
    ok(!/[+/=]/.test(link.hash.slice(3)), 'URL-safe base64 (no + / =)');

    /* legacy encoder length for comparison */
    const legacy = win.eval(`(function(){const s=snapshotInputs();delete s.t;
      return btoa(unescape(encodeURIComponent(JSON.stringify(s)))).length;})()`);
    ok(link.hash.length - 3 < legacy, 'shorter than the legacy #s= payload',
      (link.hash.length - 3) + ' vs ' + legacy + ' chars (' +
      Math.round(100 - 100 * (link.hash.length - 3) / legacy) + '% smaller)');

    /* round trip: clear the worksheet, restore from the hash, compare inputs */
    const before = win.eval('JSON.stringify(snapshotInputs().units)');
    win.eval('state={v:1,units:[]};renderUnits();');
    win.location.hash = link.hash;
    return win.eval(`(function(){
      const h=location.hash, json=(function(u){
        const b64=u.replace(/-/g,'+').replace(/_/g,'/');
        return decodeURIComponent(escape(atob(b64+'='.repeat((4-b64.length%4)%4))));
      })(h.slice(3));
      return json;
    })()`) && Promise.resolve({ before, link });
  }).then(({ before, link }) => {
    return win.eval('window.__restored = false;') , new Promise((res) => {
      /* drive the module's own restore path */
      win.eval('location.hash = ' + JSON.stringify(link.hash) + ';');
      const p = win.eval('window.mbExports && null');
      /* call the private path through a fresh permalink decode */
      const decoded = win.eval(`(function(){
        const u='${link.hash.slice(3)}';
        const b64=u.replace(/-/g,'+').replace(/_/g,'/');
        return decodeURIComponent(escape(atob(b64+'='.repeat((4-b64.length%4)%4))));
      })()`);
      const c = JSON.parse(decoded);
      ok(c.v === 2 && Array.isArray(c.u) && c.u.length === 2, 'compact payload shape');
      ok(!/"Carbon dioxide"/.test(decoded), 'component names dropped from the payload');
      ok(c.u[0].s[0].c[0][0] === 'water', 'component keys kept');
      res({ before, c });
    });
  }).then(({ before }) => {
    /* full restore through the public boot path by re-running the wiring */
    const s2 = win.document.createElement('script');
    s2.textContent = exportsJs;
    win.document.body.append(s2);
    return new Promise((r) => setTimeout(() => r(before), 400));
  }).then((before) => {
    const after = win.eval('JSON.stringify(snapshotInputs().units)');
    const b = JSON.parse(before), a = JSON.parse(after);
    ok(a.length === b.length, 'unit count survives the round trip', a.length + ' vs ' + b.length);
    if (a.length === b.length && a.length) {
      const same = JSON.stringify(a.map(stripVolatile)) === JSON.stringify(b.map(stripVolatile));
      ok(same, 'inputs identical after round trip',
        same ? '' : '\n  before: ' + JSON.stringify(b[0].streams[0]) +
          '\n  after:  ' + JSON.stringify(a[0].streams[0]));
    }
    console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'ALL CHECKS PASSED'));
    process.exit(fails ? 1 : 0);
  }).catch((e) => {
    console.log('\nHARNESS ERROR: ' + e.stack);
    process.exit(1);
  });
});

function stripVolatile(u) {
  return {
    module: u.module, nOut: u.nOut, params: u.params,
    streams: (u.streams || []).map((s) => ({
      mass_flow_kg_h: s.mass_flow_kg_h, T_K: s.T_K, P_bar: s.P_bar,
      components: (s.components || []).map((c) => ({ key: c.key, mass_fraction: c.mass_fraction })),
    })),
  };
}
