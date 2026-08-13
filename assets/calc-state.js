/* =========================================================================
   multicalci.com — assets/calc-state.js   (v2)
   Shareable URL state + last-session restore for all calculator pages.

   Load AFTER calc-common.js:
     <script src="/assets/calc-common.js"></script>
     <script src="/assets/calc-state.js"></script>

   No dependencies, no build step.

   Integrates with calc-common.js:
     - unit system read from  MC.UNITS.system  ('SI' | 'IMP')
     - unit system restored via MC.setUnitSystem(), which fires the page's
       own window.onUnitSystemChange hook
     - boot sequenced through MC.ready()

   SEO: query-string URLs must never become indexable duplicates. This
   module forces a param-free rel=canonical on every page it runs on.
   ========================================================================= */
(function (window, document) {
  'use strict';

  if (window.MCState) return;

  var DEFAULTS = {
    root: 'body',

    excludeSelector: [
      '[data-mc-state="off"]',
      '[type="search"]',
      '[type="hidden"]',
      '[type="password"]',
      '[type="file"]',
      '#search', '#searchInput', '.search-input', '.mc-search'
    ].join(','),

    // Page's own calculate function, e.g. { calcHandler: calculate }.
    // Preferred over clicking a button.
    calcHandler: null,

    // Fallback if no calcHandler is given.
    calcButton: '[data-mc-calc],#calculate,#calcBtn,.calc-btn',

    shareMount: '[data-mc-share]',

    storagePrefix: 'mc:state:',
    storageMaxAgeDays: 30,
    restoreFromStorage: true,

    writeDelay: 400,
    maxUrlLength: 1800,

    // Reserved query key for the unit system.
    unitKey: 'u'
  };

  var CFG = {};
  (function () {
    var over = window.MC_STATE_CONFIG || {};
    for (var k in DEFAULTS) CFG[k] = DEFAULTS[k];
    for (var j in over) CFG[j] = over[j];
  })();

  /* ---------------------------------------------------------------- utils */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function storageKey() {
    return CFG.storagePrefix + location.pathname.replace(/\/+$/, '');
  }
  function isCrawler() {
    return /bot|crawl|spider|slurp|bingpreview|headlesschrome/i
      .test(navigator.userAgent || '');
  }

  /* ------------------------------------------------- unit system bridging */
  function getUnitSystem() {
    if (window.MC && window.MC.UNITS && window.MC.UNITS.system)
      return window.MC.UNITS.system;
    var on = $('[data-unit-btn].on');
    return on ? on.getAttribute('data-unit-btn') : null;
  }

  function setUnitSystem(v) {
    if (!v) return false;
    if (getUnitSystem() === v) return false;
    if (window.MC && typeof window.MC.setUnitSystem === 'function') {
      window.MC.setUnitSystem(v);          // fires window.onUnitSystemChange
      return true;
    }
    var btn = $('[data-unit-btn="' + v + '"]');
    if (btn) { btn.click(); return true; }
    return false;
  }

  /* ------------------------------------------------------- canonical guard */
  function ensureCleanCanonical() {
    var clean = location.origin +
      (location.pathname === '/' ? '/' : location.pathname.replace(/\/+$/, ''));
    var link = $('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
      link.setAttribute('href', clean);
      return;
    }
    var href = link.getAttribute('href') || '';
    if (href.indexOf('?') > -1 || href.indexOf('#') > -1)
      link.setAttribute('href', href.split(/[?#]/)[0]);
  }

  /* ----------------------------------------------------------- field layer */
  function fields() {
    var root = $(CFG.root) || document.body;
    if (!root) return [];
    return $$('input,select,textarea', root).filter(function (el) {
      if (el.disabled) return false;
      if (CFG.excludeSelector && el.matches && el.matches(CFG.excludeSelector)) return false;
      return !!fieldKey(el);
    });
  }
  function fieldKey(el) {
    if (el.type === 'radio') return el.name || null;
    return el.id || el.name || null;
  }
  function readField(el) {
    if (el.type === 'checkbox') return el.checked ? '1' : '0';
    if (el.type === 'radio') return el.checked ? el.value : null;
    return el.value;
  }
  function writeField(el, value) {
    if (value == null) return false;
    if (el.type === 'checkbox') {
      var next = (value === '1' || value === 'true');
      if (el.checked === next) return false;
      el.checked = next; return true;
    }
    if (el.type === 'radio') {
      if (el.value !== value || el.checked) return false;
      el.checked = true; return true;
    }
    if (el.value === value) return false;
    el.value = value; return true;
  }
  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* --------------------------------------------------------- baseline diff */
  var baseline = {};

  function captureBaseline() {
    baseline = {};
    fields().forEach(function (el) {
      var k = fieldKey(el), v = readField(el);
      if (k && v != null && !(k in baseline)) baseline[k] = v;
    });
    baseline[CFG.unitKey] = getUnitSystem();
  }

  function snapshot() {
    var out = {};
    fields().forEach(function (el) {
      var k = fieldKey(el), v = readField(el);
      if (!k || v == null || v === '') return;
      if (baseline[k] === v) return;
      out[k] = v;
    });
    var u = getUnitSystem();
    if (u && u !== baseline[CFG.unitKey]) out[CFG.unitKey] = u;
    return out;
  }

  /* -------------------------------------------------------- serialisation */
  function toQuery(state, includeGo) {
    var p = new URLSearchParams();
    Object.keys(state).sort().forEach(function (k) { p.set(k, state[k]); });
    if (includeGo) p.set('go', '1');
    return p.toString();
  }
  function fromQuery() {
    var p = new URLSearchParams(location.search), out = {}, n = 0;
    p.forEach(function (v, k) { if (k !== 'go') { out[k] = v; n++; } });
    return { state: out, go: p.get('go') === '1', any: n > 0 };
  }

  /* -------------------------------------------------------------- restore */
  var restoring = false;

  function applyState(state, then) {
    if (!state || !Object.keys(state).length) { if (then) then(); return; }
    restoring = true;

    // Phase 1 — unit system, because MC.setUnitSystem() rewrites labels and
    // the page's onUnitSystemChange hook may rewrite field values.
    setUnitSystem(state[CFG.unitKey]);

    setTimeout(function () {
      // Phase 2 — field values
      fields().forEach(function (el) {
        var k = fieldKey(el);
        if (k in state && writeField(el, state[k])) fire(el);
      });
      restoring = false;
      if (then) then();
    }, 0);
  }

  function runCalculation() {
    if (typeof CFG.calcHandler === 'function') {
      try { CFG.calcHandler(); return; } catch (e) { /* non-fatal */ }
    }
    var btn = CFG.calcButton && $(CFG.calcButton);
    if (btn && !btn.disabled) { try { btn.click(); } catch (e) {} }
  }

  /* ---------------------------------------------------------- persistence */
  var writeUrl = debounce(function () {
    if (restoring) return;
    var state = snapshot();
    var qs = toQuery(state, false);
    var url = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (url.length <= CFG.maxUrlLength) {
      try { history.replaceState(null, '', url); } catch (e) {}
    }
    saveLocal(state);
  }, CFG.writeDelay);

  function saveLocal(state) {
    if (!CFG.restoreFromStorage) return;
    try {
      if (!Object.keys(state).length) { localStorage.removeItem(storageKey()); return; }
      localStorage.setItem(storageKey(), JSON.stringify({ t: Date.now(), s: state }));
    } catch (e) {}
  }
  function loadLocal() {
    if (!CFG.restoreFromStorage) return null;
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      var o = JSON.parse(raw);
      if ((Date.now() - (o.t || 0)) / 86400000 > CFG.storageMaxAgeDays) {
        localStorage.removeItem(storageKey()); return null;
      }
      return o.s || null;
    } catch (e) { return null; }
  }
  function clearLocal() { try { localStorage.removeItem(storageKey()); } catch (e) {} }

  /* ------------------------------------------------------------------- UI */
  function getLink(withGo) {
    var qs = toQuery(snapshot(), withGo !== false);
    return location.origin + location.pathname + (qs ? '?' + qs : '');
  }

  function toast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'background:#111;color:#fff;padding:10px 16px;border-radius:8px;' +
      'font:14px/1.4 system-ui,sans-serif;z-index:99999;opacity:0;' +
      'transition:opacity .2s;box-shadow:0 4px 16px rgba(0,0,0,.25)';
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = '1'; }, 10);
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
    }, 2200);
  }

  function copyLink() {
    var url = getLink(true);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast('Link copied — your inputs are included'); },
        function () { window.prompt('Copy this link:', url); }
      );
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  function mountShareButton(selector) {
    var mount = $(selector || CFG.shareMount);
    if (!mount || mount.querySelector('[data-mc-share-btn]')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mc-share-btn';
    b.setAttribute('data-mc-share-btn', '');
    b.textContent = 'Copy link with my inputs';
    b.addEventListener('click', copyLink);
    mount.appendChild(b);
  }

  function showRestoredNotice() {
    var mount = $(CFG.shareMount) || document.body;
    var bar = document.createElement('div');
    bar.setAttribute('data-mc-restored', '');
    bar.style.cssText =
      'margin:8px 0;padding:8px 12px;border-radius:8px;background:#eef6ff;' +
      'border:1px solid #cfe3fb;font:13px/1.4 system-ui,sans-serif;color:#123';
    bar.appendChild(document.createTextNode('Restored your last inputs. '));
    var a = document.createElement('button');
    a.type = 'button';
    a.textContent = 'Start fresh';
    a.style.cssText = 'background:none;border:0;color:#0b5cad;text-decoration:underline;' +
                      'cursor:pointer;font:inherit;padding:0';
    a.addEventListener('click', function () {
      clearLocal(); location.href = location.pathname;
    });
    bar.appendChild(a);
    if (mount.firstChild) mount.insertBefore(bar, mount.firstChild);
    else mount.appendChild(bar);
  }

  /* ----------------------------------------------------------------- boot */
  function init() {
    ensureCleanCanonical();
    if (isCrawler()) return;

    captureBaseline();

    var q = fromQuery();
    if (q.any) {
      applyState(q.state, function () { if (q.go) runCalculation(); });
    } else {
      var saved = loadLocal();
      if (saved && Object.keys(saved).length) applyState(saved, showRestoredNotice);
    }

    var root = $(CFG.root) || document.body;
    root.addEventListener('input', writeUrl, true);
    root.addEventListener('change', writeUrl, true);

    // Unit buttons are <button>, not form fields — catch them separately.
    $$('[data-unit-btn]').forEach(function (b) {
      b.addEventListener('click', writeUrl, true);
    });

    mountShareButton();
  }

  window.MCState = {
    getLink: getLink,
    snapshot: snapshot,
    copyLink: copyLink,
    mountShareButton: mountShareButton,
    clear: function () { clearLocal(); location.href = location.pathname; },
    config: CFG
  };

  if (window.MC && typeof window.MC.ready === 'function') window.MC.ready(init);
  else if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else init();

})(window, document);
