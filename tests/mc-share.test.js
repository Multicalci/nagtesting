/* jsdom tests for /assets/mc-share.js
   Run:  node mc-share.test.js <path-to-mc-share.js> [path-to-calc-common.js]   */
'use strict';
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const SHARE = fs.readFileSync(process.argv[2] || 'mc-share.js', 'utf8');
// calc-common.js has "<script ...></script>" in its header comment; escape it so it can be inlined in a test page.
const COMMON = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8').replace(/<\/script/gi, '<\\/script') : null;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Page A: process-style calculator (like NPSH) ---------- */
const pageA = (extraScriptAttrs = '') => `<!doctype html><html><head>
<title>NPSH Calculator — Net Positive Suction Head (NPSHa &amp; NPSHr) | Free Online Tool | multicalci.com</title></head><body>
<header><input type="search" id="nav-q"><span class="badge">SI &amp; Imperial</span></header>
<div class="units"><button id="bSI" class="ubtn on" onclick="setU('SI')">SI</button><button id="bIMP" class="ubtn" onclick="setU('IMP')">Imperial</button></div>
<select id="fluid"></select>
<input type="number" id="temp" value="20">
<select id="config"><option value="open-above" selected>Open above</option><option value="open-below">Open below</option><option value="press-above">Pressurised</option></select>
<div id="pgWrap" style="display:none"><input type="number" id="pg" value="0"></div>
<input type="number" id="z" value="3">
<input type="number" id="q" value="">
<input type="checkbox" id="inclVh">
<label><input type="radio" name="npshrMode" value="direct" checked> Direct</label>
<label><input type="radio" name="npshrMode" value="estimate"> Estimate</label>
<input type="text" id="pv" readonly value="2.34">
<textarea id="notes"></textarea>
<button id="calc" onclick="calculate()">Calculate NPSHa</button>
<div id="out"></div>
<div class="modal"><button id="shWa" onclick="shareWA()">WhatsApp</button><button id="shCopy" onclick="copyLink()">Copy</button>
<a id="shLi" href="https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fwww.multicalci.com%2Fnpsh-calculator%2F">LinkedIn</a>
<a id="shMail" href="mailto:?subject=NPSH&amp;body=Check%20https%3A%2F%2Fmulticalci.com%2Fnpsh-calculator%2F%20now">Mail</a></div>
<div data-mc-share></div>
<script>
  var calcCount = 0, unitsNow = 'SI', evts = [];
  function setU(u){ unitsNow=u; document.getElementById('bSI').classList.toggle('on',u==='SI'); document.getElementById('bIMP').classList.toggle('on',u==='IMP');
    // like many pages: switching units resets temperature to the unit default
    document.getElementById('temp').value = (u==='IMP') ? '68' : '20'; }
  document.getElementById('config').addEventListener('change', function(){ document.getElementById('pgWrap').style.display = this.value==='press-above' ? 'block':'none'; });
  window.addEventListener('load', function(){ setTimeout(function(){ var f=document.getElementById('fluid');
    ['water','ethanol','condensate'].forEach(function(v){var o=document.createElement('option');o.value=v;o.textContent=v;f.appendChild(o);}); }, 300); });
  function calculate(){ calcCount++; document.getElementById('out').textContent='calc:'+document.getElementById('fluid').value+':'+document.getElementById('q').value+':'+document.getElementById('temp').value+':'+unitsNow; }
  function shareWA(){ window.open('https://wa.me/?text='+encodeURIComponent('NPSH calc https://www.multicalci.com/npsh-calculator/ — try it.'), '_blank'); }
  function copyLink(){ navigator.clipboard.writeText(location.href); }
  window.va = function(){ evts.push(Array.prototype.slice.call(arguments)); };
</script>
<!--MODULE--><script ${extraScriptAttrs}>${SHARE}</script>
</body></html>`;

/* ---------- Page B: calc-common page with data-unit-btn ---------- */
const pageB = () => `<!doctype html><html><head><title>Beam Deflection Calculator | multicalci.com</title></head><body>
<button data-unit-btn="SI" class="on" onclick="MC.setUnitSystem('SI')">SI</button><button data-unit-btn="IMP" onclick="MC.setUnitSystem('IMP')">Imperial</button>
<div class="field"><input type="number" id="L" value="6"></div>
<div class="field"><input type="number" id="w" value=""></div>
<select id="support"><option value="ss">Simply supported</option><option value="cant">Cantilever</option></select>
<button id="go" data-mc-calc onclick="run()">Run</button><button onclick="other()">Calculate something else</button>
<div id="res"></div>
<script>${COMMON}</script>
<script>var runs=0, others=0; function run(){ runs++; document.getElementById('res').textContent = gv('L')+'|'+gv('w')+'|'+gs('support')+'|'+MC.UNITS.system; } function other(){ others++; }</script>
<script>${SHARE}</script>
</body></html>`;

function open(html, url) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => { if (!/Not implemented: navigation/.test(e.message)) errors.push(e.message); });
  vc.on('error', e => errors.push(String(e)));
  const warns = [];
  vc.on('warn', m => warns.push(String(m)));
  const opened = [], copied = [];
  const dom = new JSDOM(html, {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.open = u => { opened.push(u); return null; };
      Object.defineProperty(w.navigator, 'clipboard', { configurable: true,
        value: { writeText: t => { copied.push(t); return Promise.resolve(); } } });
    }
  });
  return { dom, w: dom.window, d: dom.window.document, opened, copied, errors, warns };
}

function hashState(url) {
  const m = /#mc=([A-Za-z0-9_-]+)/.exec(url); if (!m) return null;
  let b = m[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
  return JSON.parse(Buffer.from(b, 'base64').toString('utf8'));
}

(async () => {
  console.log('\nA1. Clean page: nothing restored, nothing to share');
  let A = open(pageA(), 'https://www.multicalci.com/npsh-calculator');
  await wait(700);
  ok(A.errors.length === 0, 'no script errors (' + A.errors.join('; ') + ')');
  ok(!A.d.getElementById('mcs-note'), 'no notice on a normal visit');
  ok(A.w.calcCount === 0, 'no automatic calculation on a normal visit');
  ok(A.w.MCShare.state() === null, 'state() is null when nothing changed');
  const plain = A.w.MCShare.url('copy');
  ok(plain === 'https://www.multicalci.com/npsh-calculator?utm_source=copy&utm_medium=share&utm_campaign=calculator', 'untouched page shares a clean tagged URL: ' + plain);
  ok(A.d.querySelectorAll('.mcs-bar button').length === 4, 'share bar rendered with 4 buttons');

  console.log('\nA2. User fills the form, switches to Imperial, shares');
  const $ = id => A.d.getElementById(id);
  A.w.setU('IMP');
  $('fluid').value = 'condensate'; $('q').value = '120'; $('z').value = '4.5'; $('temp').value = '203';
  $('config').value = 'press-above'; $('config').dispatchEvent(new A.w.Event('change', { bubbles: true }));
  $('pg').value = '1.5'; $('inclVh').checked = true;
  A.d.querySelector('input[name=npshrMode][value=estimate]').checked = true;
  $('notes').value = 'Line 1 <img src=x onerror=alert(1)> & "q" — ünïcödé ✓\nline 2';
  $('nav-q').value = 'should not travel';
  const st = A.w.MCShare.state();
  ok(st && st.u === 'IMP', 'unit system captured from custom SI/Imperial buttons');
  ok(st && !('nav-q' in st.f) && !('pv' in st.f), 'search box and readonly field left out');
  ok(st && st.r && st.r.npshrMode === 'estimate', 'radio group captured by name');

  $('shWa').click();
  const wa = A.opened[A.opened.length - 1];
  const waText = decodeURIComponent(wa.split('?text=')[1]);
  ok(/^NPSH calc https:\/\/www\.multicalci\.com\/npsh-calculator\?utm_source=whatsapp&utm_medium=share&utm_campaign=calculator#mc=[\w-]+ — try it\.$/.test(waText),
     'existing WhatsApp button upgraded, rest of message kept: ' + waText.slice(0, 120) + '…');

  $('shCopy').click(); await wait(10);
  const copied = A.copied[A.copied.length - 1];
  ok(/^https:\/\/www\.multicalci\.com\/npsh-calculator\?utm_source=copy&utm_medium=share&utm_campaign=calculator#mc=/.test(copied), 'existing Copy button upgraded');

  $('shLi').click();
  ok(/linkedin\.com\/sharing\/share-offsite\/\?url=https%3A%2F%2Fwww\.multicalci\.com%2Fnpsh-calculator%3Futm_source%3Dlinkedin/.test($('shLi').getAttribute('href')), 'plain LinkedIn <a> upgraded at click');
  $('shMail').click();
  const mail = $('shMail').getAttribute('href');
  ok(/^mailto:\?subject=NPSH&body=Check%20https%3A%2F%2Fwww\.multicalci\.com%2Fnpsh-calculator%3Futm_source%3Demail.*%20now$/.test(mail), 'mailto upgraded, spaces stay %20, non-www→www');

  A.d.querySelector('.mcs-bar [data-mcs-ch=whatsapp]').click();
  ok(/^https:\/\/wa\.me\/\?text=/.test(A.opened[A.opened.length - 1]), 'own share bar opens WhatsApp');
  ok(A.w.evts.some(e => e[0] === 'event' && e[1].name === 'Share' && e[1].data.channel === 'whatsapp' && e[1].data.page === '/npsh-calculator'), 'Vercel Share event sent with channel and page');

  console.log('\nA3. Recipient opens the copied link');
  const B = open(pageA(), copied);
  await wait(3200);
  const g = id => B.d.getElementById(id);
  ok(B.errors.length === 0, 'no script errors (' + B.errors.join('; ') + ')');
  ok(B.w.unitsNow === 'IMP' && g('bIMP').classList.contains('on'), 'Imperial restored by clicking the page\'s own toggle');
  ok(g('fluid').value === 'condensate', 'JS-populated list restored after it filled (retry works)');
  ok(g('temp').value === '203', 'temperature kept at shared value (unit switch ran first, did not overwrite it)');
  ok(g('q').value === '120' && g('z').value === '4.5' && g('pg').value === '1.5', 'numbers restored, incl. field revealed by config change');
  ok(g('config').value === 'press-above' && g('pgWrap').style.display === 'block', 'select restored and its change handler ran');
  ok(g('inclVh').checked && B.d.querySelector('input[name=npshrMode][value=estimate]').checked, 'checkbox and radio restored');
  ok(g('notes').value === $('notes').value, 'text with HTML, quotes, unicode and newline restored exactly');
  ok(B.d.querySelectorAll('img').length === 0, 'HTML in a value never becomes markup');
  ok(g('nav-q').value === '', 'search box untouched');
  ok(B.w.calcCount === 1 && g('out').textContent === 'calc:condensate:120:203:IMP', 'Calculate clicked once, after all inputs set: ' + g('out').textContent);
  const n1 = B.d.getElementById('mcs-note');
  ok(n1 && /Imperial units/.test(n1.textContent) && !n1.classList.contains('warn'), 'notice: ' + (n1 && n1.textContent));
  ok(B.w.evts.some(e => e[1] && e[1].name === 'Shared link opened' && e[1].data.missed === 0), '"Shared link opened" event sent');

  console.log('\nA4. Hostile / broken links');
  const enc = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const bad = enc({ v: 1, u: 'IMP', f: { q: '<img src=x onerror=alert(1)>', fluid: 'nonexistent', 'nav-q': 'x', pv: '999', ghost: 'y', z: '7' } });
  const C = open(pageA(), 'https://www.multicalci.com/npsh-calculator?utm_source=x#mc=' + bad);
  await wait(4600);
  ok(C.errors.length === 0, 'no script errors');
  ok(C.d.querySelectorAll('img').length === 0, 'no markup injected');
  ok(C.d.getElementById('nav-q').value === '' && C.d.getElementById('pv').value === '2.34', 'fields outside the shareable set untouched');
  ok(C.d.getElementById('z').value === '7', 'valid fields still restored');
  ok(C.w.calcCount === 0, 'did NOT auto-calculate when some inputs failed');
  const n2 = C.d.getElementById('mcs-note');
  ok(n2 && n2.classList.contains('warn') && /could not be set/.test(n2.textContent), 'warning notice: ' + (n2 && n2.textContent));

  for (const h of ['#mc=%%%', '#mc=e30', '#section-3', '#mc=' + 'A'.repeat(25000)]) {
    const D = open(pageA(), 'https://www.multicalci.com/npsh-calculator' + h);
    await wait(500);
    ok(D.errors.length === 0 && !D.d.getElementById('mcs-note') && D.w.calcCount === 0, 'ignored safely: ' + h.slice(0, 20));
  }

  console.log('\nA5. Address matching');
  const E = open(pageA(), 'https://multicalci.com/npsh-calculator/');
  await wait(400);
  ok(E.w.MCShare.url('x').startsWith('https://www.multicalci.com/npsh-calculator?utm_source=x'), 'non-www + slash page shares the canonical www, no-slash URL');
  const rw = t => E.w.MCShare.rewrite(t, 'copy');
  ok(rw('see https://www.multicalci.com/npsh-calculator-v2') === 'see https://www.multicalci.com/npsh-calculator-v2', 'other page with same prefix untouched');
  ok(rw('Try https://www.multicalci.com/npsh-calculator.') === 'Try https://www.multicalci.com/npsh-calculator?utm_source=copy&utm_medium=share&utm_campaign=calculator.', 'full stop after link kept');
  ok(rw('old https://www.multicalci.com/npsh-calculator?utm_source=a#mc=xyz).').endsWith('calculator).'), 'old tagged link replaced, closing punctuation kept');
  ok(rw('home https://www.multicalci.com/ and https://www.multicalci.com/orifice-flow-calculator') === 'home https://www.multicalci.com/ and https://www.multicalci.com/orifice-flow-calculator', 'home page and other calculators untouched');
  E.w.MCShare.config({ patch: false });
  E.w.open('https://wa.me/?text=' + encodeURIComponent('https://www.multicalci.com/npsh-calculator'));
  ok(E.opened[E.opened.length - 1] === 'https://wa.me/?text=' + encodeURIComponent('https://www.multicalci.com/npsh-calculator'), 'config({patch:false}) leaves share buttons alone');

  console.log('\nA6. Explicit Calculate button via script attribute');
  const F0 = open(pageA(), 'https://www.multicalci.com/npsh-calculator');
  await wait(400);
  F0.d.getElementById('q').value = '55';
  const link = F0.w.MCShare.url('copy');
  const F = open(pageA('data-autocalc="false"'), link);
  await wait(800);
  ok(F.d.getElementById('q').value === '55' && F.w.calcCount === 0, 'data-autocalc="false": restored, not calculated');
  ok(/Select Calculate/.test(F.d.getElementById('mcs-note').textContent), 'notice tells visitor to select Calculate');

  console.log('\nA7. Unit switch the module cannot read (active class "unit-active")');
  const pageC = (extra = '') => {
    const h = pageA()
      .replace('class="ubtn on"', 'class="ubtn unit-active"')
      .replace(/classList\.toggle\('on',/g, "classList.toggle('unit-active',");
    return h.replace('<!--MODULE-->', () => extra);   // page's own script, before mc-share.js
  };
  const G = open(pageC(), 'https://www.multicalci.com/npsh-calculator');
  await wait(400);
  ok(G.warns.some(w => /unit switch whose state cannot be read/.test(w)), 'console warning tells you which page needs config');
  G.w.setU('IMP'); G.d.getElementById('q').value = '80';
  const gs = G.w.MCShare.state();
  ok(gs && gs.u === '?', 'link marks units as unknown');
  const H = open(pageC(), G.w.MCShare.url('copy'));
  await wait(900);
  ok(H.w.calcCount === 0, 'unknown units: NOT auto-calculated');
  const n3 = H.d.getElementById('mcs-note');
  ok(n3 && n3.classList.contains('warn') && /unit system could not be recorded/.test(n3.textContent), 'warning: ' + (n3 && n3.textContent));

  // Set by the page before mc-share.js loads, as it would be with the deferred tag.
  const cfgScript = "<script>window.MCShareConfig = { getUnits: function(){ return unitsNow; }, setUnits: function(u){ setU(u); } };</script>";
  const I = open(pageC(cfgScript), 'https://www.multicalci.com/npsh-calculator');
  await wait(400);
  ok(!I.warns.some(w => /mc-share/.test(w)), 'no warning once the page sets window.MCShareConfig');
  I.w.setU('IMP'); I.d.getElementById('q').value = '80';
  const J = open(pageC(cfgScript), I.w.MCShare.url('copy'));
  await wait(900);
  ok(J.w.unitsNow === 'IMP' && J.w.calcCount === 1 && J.d.getElementById('out').textContent.endsWith(':IMP'), 'with config: Imperial restored and calculated');

  if (COMMON) {
    console.log('\nB. calc-common page (data-unit-btn + data-mc-calc)');
    const P = open(pageB(), 'https://www.multicalci.com/beam-deflection-calculator');
    await wait(400);
    P.w.MC.setUnitSystem('IMP');
    P.d.getElementById('w').value = '12.5'; P.d.getElementById('support').value = 'cant';
    const s2 = P.w.MCShare.state();
    ok(s2 && s2.u === 'IMP' && s2.f.L === '6' && s2.f.w === '12.5', 'state includes MC unit system and fields');
    const Q = open(pageB(), P.w.MCShare.url('linkedin'));
    await wait(900);
    ok(Q.errors.length === 0, 'no script errors (' + Q.errors.join('; ') + ')');
    ok(Q.w.MC.UNITS.system === 'IMP' && Q.d.querySelector('[data-unit-btn=IMP]').classList.contains('on'), 'MC.setUnitSystem used to restore units');
    ok(Q.w.runs === 1 && Q.w.others === 0 && Q.d.getElementById('res').textContent === '6|12.5|cant|IMP', '[data-mc-calc] button used, not the other "Calculate" button');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
