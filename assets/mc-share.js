/* ═══════════════════════════════════════════════════════════════════
   multicalci.com — SHARE LINKS
   Path: /assets/mc-share.js

   Lets a visitor share a calculator with their inputs filled in.
   The link opens the same page, restores the inputs and recalculates.

   How it behaves
   - Inputs travel in the URL fragment (#mc=...). Browsers never send
     the fragment to the server and Google ignores it, so shared links
     cannot create duplicate URLs in Search Console.
   - Every link carries utm_source=<channel>&utm_medium=share so visits
     from shared links can be counted.
   - Existing share buttons need no changes. Links they send to
     WhatsApp, LinkedIn, X, email, the clipboard or the phone's share
     sheet are upgraded on the way out, as long as they contain this
     page's address.
   - On opening a shared link: unit system first, then fields in page
     order, then Calculate. If a field or the unit system cannot be
     restored, it does NOT calculate and tells the visitor what to check.

   Install — on each calculator page, just before </body> and after
   calc-common.js where that file is used, add one script element:
       src="/assets/mc-share.js", with the defer attribute
   (The full tag isn't written out here: a closing script tag inside
   this comment would break the page if the file were pasted inline.)

   Check per page — open it with the browser console open. A warning
   starting "[mc-share]" means its SI/Imperial switch can't be read;
   add to that page:
       MCShare.config({ getUnits: function () { return 'SI' or 'IMP' },
                        setUnits: function (u) { switch the page to u } });
   Until then, links from that page restore inputs but don't calculate.

   Optional, per page
     <div data-mc-share></div>     share bar (Copy link, WhatsApp,
                                   LinkedIn, Email) rendered here
     data-mc-calc                  on the Calculate button. Without it,
                                   the first visible button whose text
                                   starts with "Calculate" is used.
     data-mc-share-skip            on a field or container to keep it
                                   out of shared links
     MCShare.config({...})         see CONFIG below
     MCShare.url('pdf')            link for a PDF report footer

   Contains NO calculator mathematics.
═══════════════════════════════════════════════════════════════════ */

(function (root, doc) {
  'use strict';
  if (root.MCShare) return;

  var VERSION = 1;
  var HASH_RE = /[#&]mc=([A-Za-z0-9_-]+)/;
  var MAX_PAYLOAD = 20000;   // characters; anything longer is ignored
  var UTM = '&utm_medium=share&utm_campaign=calculator';


  /* ══════════════════════════════
     CONFIG
  ══════════════════════════════ */

  var cfg = {
    root: null,        // element or selector: only fields inside it are shared
    exclude: [],       // field ids never shared
    calculate: null,   // function run after inputs are restored
    calcButton: null,  // selector of the Calculate button
    autoCalc: true,    // recalculate after restoring
    getUnits: null,    // function -> 'SI' | 'IMP' for pages with a custom toggle
    setUnits: null,    // function('SI' | 'IMP')
    patch: true        // upgrade links sent by the page's own share buttons
  };

  // Same options as data attributes on the script tag, for pages with no JS of their own:
  // <script src="/assets/mc-share.js" data-calc="#btnCalc" data-autocalc="false" defer>
  var me = doc.currentScript;
  if (me && me.dataset) {
    if (me.dataset.root) cfg.root = me.dataset.root;
    if (me.dataset.calc) cfg.calcButton = me.dataset.calc;
    if (me.dataset.autocalc === 'false') cfg.autoCalc = false;
    if (me.dataset.patch === 'false') cfg.patch = false;
  }

  function config(opts) {
    for (var k in opts) {
      if (Object.prototype.hasOwnProperty.call(opts, k) && Object.prototype.hasOwnProperty.call(cfg, k)) cfg[k] = opts[k];
    }
    return cfg;
  }


  /* ══════════════════════════════
     1. FIELDS
  ══════════════════════════════ */

  var SKIP_TYPES = /^(button|submit|reset|file|password|image|hidden|search)$/i;

  function scope() {
    var r = cfg.root;
    if (typeof r === 'string') r = doc.querySelector(r);
    return r || doc;
  }

  /** Shareable fields in page order. Readonly/disabled fields are results, not inputs. */
  function fields() {
    var out = [];
    var list = scope().querySelectorAll('input, select, textarea');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.type && SKIP_TYPES.test(el.type)) continue;
      if (el.disabled || el.readOnly) continue;
      if (el.closest && el.closest('[data-mc-share-skip], [data-mc-share], .mcs-bar, #mcs-note')) continue;
      if (el.type === 'radio') { if (!el.name) continue; }
      else if (!el.id) continue;
      if (el.id && cfg.exclude.indexOf(el.id) !== -1) continue;
      out.push(el);
    }
    return out;
  }

  function defaultIndex(sel) {
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].defaultSelected) return i;
    return sel.options.length ? 0 : -1;
  }

  function atDefault(el) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked === el.defaultChecked;
    if (el.tagName === 'SELECT') {
      if (el.multiple) {
        for (var i = 0; i < el.options.length; i++) if (el.options[i].selected !== el.options[i].defaultSelected) return false;
        return true;
      }
      return el.selectedIndex === defaultIndex(el);
    }
    return el.value === el.defaultValue;
  }

  function multiValue(sel) {
    var v = [];
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].selected) v.push(sel.options[i].value);
    return v;
  }


  /* ══════════════════════════════
     2. UNIT SYSTEM
  ══════════════════════════════ */

  var UNIT_WORDS = { 'si': 'SI', 'metric': 'SI', 'imperial': 'IMP', 'us': 'IMP', 'us customary': 'IMP', 'english': 'IMP' };
  var ACTIVE_CLS = /(^|\s)(on|active|selected|sel|is-active|checked|current)(\s|$)/;
  var initialUnits;

  function hasMcUnits() {
    return !!(root.MC && root.MC.UNITS && typeof root.MC.setUnitSystem === 'function' && doc.querySelector('[data-unit-btn]'));
  }

  function wordOf(el) { return UNIT_WORDS[(el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()]; }

  /** Buttons/labels whose whole text is a unit-system name ("SI", "Imperial", ...). */
  function unitToggles() {
    var out = [];
    var els = doc.querySelectorAll('button, [role="button"], [role="tab"], a, span, label, div');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.tagName !== 'BUTTON' && el.children.length) continue;
      if (el.closest('.mcs-bar, #mcs-note')) continue;
      if (wordOf(el)) out.push(el);
    }
    return out;
  }

  function isActive(el) {
    if (ACTIVE_CLS.test(el.className || '')) return true;
    if (['aria-pressed', 'aria-checked', 'aria-selected'].some(function (a) { return el.getAttribute(a) === 'true'; })) return true;
    return !!(el.control && el.control.checked);
  }

  /** 'SI' | 'IMP', or undefined when the page has no toggle this can read. */
  function currentUnits() {
    if (typeof cfg.getUnits === 'function') { try { return cfg.getUnits(); } catch (e) { return undefined; } }
    if (hasMcUnits()) return root.MC.UNITS.system;
    var t = unitToggles();
    if (t.length < 2) return undefined;
    var found;
    for (var i = 0; i < t.length; i++) {
      if (!isActive(t[i])) continue;
      var w = wordOf(t[i]);
      if (found && found !== w) return undefined;   // conflicting toggles: don't guess
      found = w;
    }
    return found;
  }

  /**
   * True when the page shows a unit switch whose state can't be read.
   * Links from such a page are marked u:'?' and are never auto-calculated,
   * because inputs typed in Imperial would be calculated as SI.
   * Fix for that page: MCShare.config({ getUnits: ..., setUnits: ... }).
   */
  function unitsUnreadable() {
    if (typeof cfg.getUnits === 'function' || hasMcUnits()) return false;
    return unitToggles().length >= 2 && currentUnits() === undefined;
  }

  function applyUnits(u) {
    if (u !== 'SI' && u !== 'IMP') return;
    if (typeof cfg.setUnits === 'function') { try { cfg.setUnits(u); } catch (e) { /* reported by the check after restore */ } return; }
    if (hasMcUnits()) { root.MC.setUnitSystem(u); return; }
    if (currentUnits() === u) return;
    var t = unitToggles();
    for (var i = 0; i < t.length; i++) if (wordOf(t[i]) === u) { t[i].click(); return; }
  }

  function unitName(u) { return u === 'IMP' ? 'Imperial' : 'SI'; }


  /* ══════════════════════════════
     3. STATE  <->  LINK
  ══════════════════════════════ */

  /** Current inputs, or null when nothing differs from the page as loaded. */
  function readState() {
    var f = {}, r = {}, changed = false;
    fields().forEach(function (el) {
      if (!atDefault(el)) changed = true;
      if (el.type === 'radio') { if (el.checked) r[el.name] = el.value; return; }
      if (el.type === 'checkbox') { f[el.id] = el.checked ? 1 : 0; return; }
      if (el.tagName === 'SELECT' && el.multiple) { f[el.id] = multiValue(el); return; }
      if (el.value !== '') f[el.id] = el.value;
    });
    var u = currentUnits();
    if (u === undefined && unitsUnreadable()) u = '?';
    if (u !== undefined && initialUnits !== undefined && u !== initialUnits) changed = true;
    if (!changed) return null;
    var s = { v: VERSION, f: f };
    if (Object.keys(r).length) s.r = r;
    if (u !== undefined) s.u = u;
    return s;
  }

  // base64url of UTF-8 JSON (unescape/escape keep this working in every browser)
  function encode(obj) {
    return root.btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(str) {
    if (!str || str.length > MAX_PAYLOAD) return null;
    var b = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    try {
      var o = JSON.parse(decodeURIComponent(escape(root.atob(b))));
      if (!o || typeof o !== 'object' || o.v !== VERSION || !o.f || typeof o.f !== 'object') return null;
      return o;
    } catch (e) { return null; }
  }

  function stateFromHash() {
    var m = HASH_RE.exec(root.location.hash || '');
    return m ? decode(m[1]) : null;
  }

  /** Page path without trailing slash or index.html; '' for the home page. */
  function cleanPath() {
    return (root.location.pathname || '/').replace(/\/index\.html?$/i, '/').replace(/\/+$/, '');
  }

  function baseUrl() {
    var live = /(^|\.)multicalci\.com$/i.test(root.location.hostname);
    return (live ? 'https://www.multicalci.com' : root.location.origin) + (cleanPath() || '/');
  }

  /** Link to this calculator with the current inputs, tagged for `channel`. */
  function shareUrl(channel) {
    var s = readState();
    var url = baseUrl() + '?utm_source=' + encodeURIComponent(channel || 'share') + UTM;
    if (s) url += '#mc=' + encode(s);
    return url;
  }


  /* ══════════════════════════════
     4. UPGRADING OUTGOING LINKS
  ══════════════════════════════ */

  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Matches this page's address in any form (www or not, slash or not, any query/fragment). */
  function pageRe() {
    var hosts = 'https?:\\/\\/(?:www\\.)?multicalci\\.com';
    var o = root.location.origin;
    if (!/(^|\.)multicalci\.com$/i.test(root.location.hostname) && o && o !== 'null') hosts += '|' + escRe(o);
    // The lookahead stops /npsh-calculator from matching /npsh-calculator-v2 or a sub-page.
    return new RegExp('(?:' + hosts + ')' + escRe(cleanPath()) + '\\/?(?![\\w%\\-\\/])(?:[?#][^\\s"\'<>]*)?', 'gi');
  }

  /** Replace every occurrence of this page's address in `text` with a share link. */
  function rewrite(text, channel) {
    if (typeof text !== 'string' || !text) return text;
    var link = null;
    return text.replace(pageRe(), function (m) {
      var trail = '';
      if (/[?#]/.test(m)) { var p = /[.,;:!)\]]+$/.exec(m); if (p) trail = p[0]; }   // sentence punctuation after a link
      if (link === null) link = shareUrl(channel);
      return link + trail;
    });
  }

  function channelOf(url) {
    var u = String(url || '').toLowerCase();
    if (u.indexOf('mailto:') === 0) return 'email';
    if (/^https?:\/\/[^/]*(whatsapp\.com|wa\.me)/.test(u)) return 'whatsapp';
    if (/^https?:\/\/[^/]*linkedin\.com/.test(u)) return 'linkedin';
    if (/^https?:\/\/[^/]*(twitter\.com|x\.com)/.test(u)) return 'x';
    if (/^https?:\/\/[^/]*facebook\.com/.test(u)) return 'facebook';
    if (/^https?:\/\/[^/]*(telegram\.me|t\.me)/.test(u)) return 'telegram';
    if (/^https?:\/\/[^/]*reddit\.com/.test(u)) return 'reddit';
    return null;
  }

  /** Rewrite the page address inside a share-intent or mailto URL's parameters. */
  function upgradeOutgoing(url) {
    var ch = channelOf(url);
    if (!ch) return url;
    var q = url.indexOf('?');
    if (q === -1) return url;
    var hashAt = url.indexOf('#', q), tail = '';
    if (hashAt !== -1) { tail = url.slice(hashAt); url = url.slice(0, hashAt); }
    var changed = false;
    var parts = url.slice(q + 1).split('&').map(function (p) {
      var eq = p.indexOf('=');
      if (eq === -1) return p;
      var val;
      try { val = decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' ')); } catch (e) { return p; }
      var nv = rewrite(val, ch);
      if (nv === val) return p;
      changed = true;
      return p.slice(0, eq + 1) + encodeURIComponent(nv);
    });
    if (changed) track('Share', { channel: ch });
    return changed ? url.slice(0, q + 1) + parts.join('&') + tail : url + tail;
  }

  // Wrap the browser functions the site's existing share buttons use.
  // Each wrapper only changes text that contains this page's address.
  var nativeOpen = root.open;
  root.open = function (url) {
    var a = Array.prototype.slice.call(arguments);
    if (cfg.patch && typeof url === 'string') { try { a[0] = upgradeOutgoing(url); } catch (e) { /* send unchanged */ } }
    return nativeOpen.apply(root, a);
  };

  var nav = root.navigator || {};
  var nativeWrite = null;
  try {
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      nativeWrite = nav.clipboard.writeText.bind(nav.clipboard);
      nav.clipboard.writeText = function (t) {
        if (cfg.patch && typeof t === 'string') {
          try { var nt = rewrite(t, 'copy'); if (nt !== t) track('Share', { channel: 'copy' }); t = nt; } catch (e) { /* copy unchanged */ }
        }
        return nativeWrite(t);
      };
    }
  } catch (e) { /* clipboard not writable here */ }

  try {
    if (typeof nav.share === 'function') {
      var nativeShare = nav.share.bind(nav);
      nav.share = function (d) {
        if (cfg.patch && d && typeof d === 'object') {
          try {
            var c = {};
            for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) c[k] = d[k];
            if (c.url) c.url = rewrite(c.url, 'native');
            if (c.text) c.text = rewrite(c.text, 'native');
            track('Share', { channel: 'native' });
            d = c;
          } catch (e) { /* share unchanged */ }
        }
        return nativeShare(d);
      };
    }
  } catch (e) { /* share sheet not available */ }

  // Plain <a href="https://wa.me/?text=..."> links: rewrite just before the browser follows them.
  doc.addEventListener('click', function (e) {
    if (!cfg.patch) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.closest('.mcs-bar')) return;
    var h = a.getAttribute('href');
    if (!channelOf(h)) return;
    var nh = upgradeOutgoing(h);
    if (nh !== h) a.setAttribute('href', nh);
  }, true);


  /* ══════════════════════════════
     5. RESTORING A SHARED LINK
  ══════════════════════════════ */

  function fire(el) {
    ['input', 'change'].forEach(function (t) {
      var ev;
      try { ev = new Event(t, { bubbles: true }); }
      catch (x) { ev = doc.createEvent('Event'); ev.initEvent(t, true, true); }
      el.dispatchEvent(ev);
    });
  }

  function matches(el, val) {
    if (el.type === 'checkbox') return el.checked === !!(+val);
    if (el.tagName === 'SELECT' && el.multiple) return JSON.stringify(multiValue(el)) === JSON.stringify(val);
    return el.value === String(val);
  }

  /** Set one field. Only existing options are selectable; values are never parsed as HTML. */
  function setField(el, val) {
    if (matches(el, val)) return;
    if (el.type === 'checkbox') { el.checked = !!(+val); fire(el); return; }
    if (el.tagName === 'SELECT') {
      if (el.multiple) {
        if (!Array.isArray(val)) return;
        for (var j = 0; j < el.options.length; j++) el.options[j].selected = val.indexOf(el.options[j].value) !== -1;
        fire(el); return;
      }
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === String(val)) { el.selectedIndex = i; fire(el); return; }
      }
      return;   // option not there yet (may be added by page script): retried
    }
    el.value = String(val);
    fire(el);
  }

  /**
   * Units first, then fields in page order. Pages often rebuild a field
   * after another changes, or fill a list after load, so every pass is
   * followed by a check and anything that didn't stick is set again.
   * cb(missed) gets the ids/names that could not be restored.
   */
  function applyState(s, cb) {
    var f = s.f || {}, r = s.r || {}, tries = 0;
    applyUnits(s.u);

    function pass() {
      fields().forEach(function (el) {
        if (el.type === 'radio') {
          if (Object.prototype.hasOwnProperty.call(r, el.name) && el.value === String(r[el.name]) && !el.checked) { el.checked = true; fire(el); }
        } else if (Object.prototype.hasOwnProperty.call(f, el.id)) {
          setField(el, f[el.id]);
        }
      });
      setTimeout(check, 120);
    }

    function check() {
      var seen = {}, missed = [];
      fields().forEach(function (el) {
        if (el.type === 'radio') {
          if (Object.prototype.hasOwnProperty.call(r, el.name) && el.value === String(r[el.name])) {
            seen['r:' + el.name] = true;
            if (!el.checked) missed.push(el.name);
          }
        } else if (Object.prototype.hasOwnProperty.call(f, el.id)) {
          seen['f:' + el.id] = true;
          if (!matches(el, f[el.id])) missed.push(el.id);
        }
      });
      Object.keys(f).forEach(function (k) { if (!seen['f:' + k]) missed.push(k); });
      Object.keys(r).forEach(function (k) { if (!seen['r:' + k]) missed.push(k); });

      if (missed.length && ++tries < 15) { setTimeout(pass, 150); return; }
      cb(missed);
    }

    pass();
  }

  function shown(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.hidden) return false;
      var cs = root.getComputedStyle ? root.getComputedStyle(e) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    }
    return true;
  }

  function calcButton() {
    var b = cfg.calcButton ? doc.querySelector(cfg.calcButton) : doc.querySelector('[data-mc-calc]');
    if (b) return b;
    var list = doc.querySelectorAll('button, input[type="button"], input[type="submit"]');
    for (var i = 0; i < list.length; i++) {
      var t = list[i].tagName === 'INPUT' ? list[i].value : list[i].textContent;
      if (/^\s*calculate\b/i.test(t || '') && !list[i].disabled && !list[i].closest('.mcs-bar') && shown(list[i])) return list[i];
    }
    return null;
  }

  function runCalc() {
    if (typeof cfg.calculate === 'function') { cfg.calculate(); return true; }
    var b = calcButton();
    if (b) { b.click(); return true; }
    return false;
  }

  function restore(s) {
    applyState(s, function (missed) {
      var known = s.u === 'SI' || s.u === 'IMP';
      var units = known ? ' (' + unitName(s.u) + ' units)' : '';
      var unitsOk = !s.u || (known && currentUnits() === s.u);
      track('Shared link opened', { missed: missed.length, units: unitsOk ? 'ok' : 'mismatch' });

      if (s.u && !known) {
        notice('Inputs loaded from a shared link, but its unit system could not be recorded. ' +
               'Check the unit setting and the inputs, then select Calculate.', 0, true);
        return;
      }
      if (!unitsOk) {
        notice('This link was made in ' + unitName(s.u) + ' units. Switch the calculator to ' + unitName(s.u) +
               ', check the inputs, then select Calculate.', 0, true);
        return;
      }
      if (missed.length) {
        notice('Inputs loaded from a shared link' + units + ', but ' + missed.length + ' of them could not be set. ' +
               'Check the form before calculating.', 0, true);
        return;
      }
      var calculated = false;
      if (cfg.autoCalc) { try { calculated = runCalc(); } catch (e) { calculated = false; } }
      notice('Inputs loaded from a shared link' + units + '. Check the values before relying on the result.' +
             (calculated ? '' : ' Select Calculate to see the result.'), 15000, false);
    });
  }


  /* ══════════════════════════════
     6. UI: SHARE BAR, NOTICES
  ══════════════════════════════ */

  function css() {
    if (doc.getElementById('mcs-css')) return;
    var st = doc.createElement('style');
    st.id = 'mcs-css';
    st.textContent =
      '.mcs-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:12px 0;font-size:.85rem}' +
      '.mcs-lbl{font-weight:600;margin-right:4px}' +
      '.mcs-bar button{font:inherit;font-size:.8rem;padding:5px 11px;border:1px solid rgba(15,32,68,.28);' +
        'border-radius:5px;background:transparent;color:inherit;cursor:pointer}' +
      '.mcs-bar button:hover,.mcs-bar button:focus-visible{border-color:currentColor}' +
      '#mcs-note{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;' +
        'align-items:flex-start;max-width:min(560px,92vw);padding:10px 12px 10px 16px;border-radius:6px;' +
        'font:500 .85rem/1.45 system-ui,sans-serif;background:#eef4ff;border:1.5px solid #9db8ee;color:#12305f;' +
        'box-shadow:0 8px 28px rgba(15,32,68,.18)}' +
      '#mcs-note.warn{background:#fff7e6;border-color:#f0c36d;color:#6b4300}' +
      '#mcs-note button{background:none;border:0;font:inherit;font-size:1.1rem;line-height:1;cursor:pointer;color:inherit;padding:0 2px}';
    (doc.head || doc.documentElement).appendChild(st);
  }

  /** ms = 0 keeps it until dismissed. */
  function notice(text, ms, warn) {
    css();
    var old = doc.getElementById('mcs-note');
    if (old) old.parentNode.removeChild(old);
    var b = doc.createElement('div');
    b.id = 'mcs-note';
    b.setAttribute('role', warn ? 'alert' : 'status');
    if (warn) b.className = 'warn';
    var t = doc.createElement('span');
    t.textContent = text;
    var x = doc.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '×';
    x.onclick = function () { if (b.parentNode) b.parentNode.removeChild(b); };
    b.appendChild(t);
    b.appendChild(x);
    doc.body.appendChild(b);
    if (ms) setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, ms);
  }

  function copyText(text) {
    if (nativeWrite) {
      return nativeWrite(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    doc.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    doc.body.removeChild(ta);
    return ok;
  }

  function pageTitle() { return (doc.title || 'Engineering calculator').split(' | ')[0].trim(); }

  /** Share through one channel: copy | whatsapp | linkedin | x | email. */
  function share(ch) {
    var url = shareUrl(ch), title = pageTitle(), target = null;
    track('Share', { channel: ch });
    if (ch === 'copy') {
      return copyText(url).then(function (ok) {
        notice(ok ? 'Link copied. It opens this calculator with your inputs.' : 'Copy this link: ' + url, ok ? 3500 : 0, !ok);
      });
    }
    if (ch === 'whatsapp') target = 'https://wa.me/?text=' + encodeURIComponent(title + '\n' + url);
    // LinkedIn builds its post from the page itself and may drop the #mc= part; the visit is still tagged.
    if (ch === 'linkedin') target = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
    if (ch === 'x') target = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url);
    if (ch === 'email') {
      root.location.href = 'mailto:?subject=' + encodeURIComponent(title) +
        '&body=' + encodeURIComponent('Here is the calculation, with the inputs filled in:\n' + url);
      return;
    }
    if (target) nativeOpen.call(root, target, '_blank', 'noopener');
  }

  var CHANNELS = [['copy', 'Copy link'], ['whatsapp', 'WhatsApp'], ['linkedin', 'LinkedIn'], ['email', 'Email']];

  function renderBars() {
    var slots = doc.querySelectorAll('[data-mc-share]');
    if (!slots.length) return;
    css();
    for (var i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (slot.getAttribute('data-mcs-done')) continue;
      slot.setAttribute('data-mcs-done', '1');
      var html = '<div class="mcs-bar" role="group" aria-label="Share this calculation">' +
                 '<span class="mcs-lbl">Share this calculation</span>';
      CHANNELS.forEach(function (c) { html += '<button type="button" data-mcs-ch="' + c[0] + '">' + c[1] + '</button>'; });
      slot.innerHTML = html + '</div>';
      slot.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-mcs-ch]') : null;
        if (b) { e.preventDefault(); share(b.getAttribute('data-mcs-ch')); }
      });
    }
  }


  /* ══════════════════════════════
     7. ANALYTICS
  ══════════════════════════════ */

  /** Vercel custom event (counted only on plans that include custom events). */
  function track(name, data) {
    try {
      if (typeof root.va === 'function') {
        data = data || {};
        data.page = cleanPath() || '/';
        root.va('event', { name: name, data: data });
      }
    } catch (e) { /* analytics must never break the page */ }
  }


  /* ══════════════════════════════
     8. START
  ══════════════════════════════ */

  function onReady(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // Restore after window load, so the page's own start-up code (default
  // values, option lists) has run and cannot overwrite the shared inputs.
  function onLoaded(fn) {
    if (doc.readyState === 'complete') setTimeout(fn, 50);
    else root.addEventListener('load', function () { setTimeout(fn, 50); });
  }

  onReady(renderBars);

  onLoaded(function () {
    initialUnits = currentUnits();
    if (initialUnits === undefined && unitsUnreadable()) {
      initialUnits = '?';
      if (root.console && console.warn) {
        console.warn('[mc-share] This page has a unit switch whose state cannot be read, so shared links ' +
                     'will not auto-calculate. Add MCShare.config({ getUnits: fn, setUnits: fn }) to this page.');
      }
    }
    var s = stateFromHash();
    if (s) restore(s);
  });

  // A different shared link pasted into the same tab.
  root.addEventListener('hashchange', function () {
    var s = stateFromHash();
    if (s) restore(s);
  });

  root.MCShare = {
    version: VERSION,
    config: config,
    url: shareUrl,
    state: readState,
    apply: restore,
    share: share,
    rewrite: rewrite,
    render: renderBars
  };

})(window, document);
