/* =========================================================================
   multicalci.com — calc-state.js
   Shareable URL state + last-session restore for all calculator pages.

   Load AFTER calc-common.js:
     <script src="/assets/calc-common.js"></script>
     <script src="/assets/calc-state.js"></script>

   No dependencies. No build step. Safe to add to every page unchanged.

   What it does
     1. Watches every input/select/textarea on the page.
     2. Writes changed fields into the query string (replaceState, no history spam).
     3. On load, restores state from the URL — or, if none, from the last
        session in localStorage.
     4. Exposes MCState.getLink() so share buttons can share a working state.

   SEO
     Query-string URLs must never become indexable duplicates. This module
     enforces a param-free rel=canonical on every page it runs on. See
     ensureCleanCanonical() below.
   ========================================================================= */
(function (window, document) {
  'use strict';

  if (window.MCState) return; // already loaded

  /* ---------------------------------------------------------------------
     Configuration
     Override per page BEFORE this script loads:
       <script>window.MC_STATE_CONFIG = { calcButton: '#myCalcBtn' };</script>
     --------------------------------------------------------------------- */
  var DEFAULTS = {
    // Root to scan for fields. Narrow this if a page has unrelated forms.
    root: 'body',

    // Fields matching these are never captured (search boxes, filters, etc).
    excludeSelector: [
      '[data-mc-state="off"]',
      '[type="search"]',
      '[type="hidden"]',
      '[type="password"]',
      '[type="file"]',
      '[autocomplete="off"][role="combobox"]',
      '#search', '#searchInput', '.search-input', '.mc-search'
    ].join(','),

    // Unit-system controls are restored FIRST, because flipping units
    // usually rewrites the other fields. Heuristic — override if it misses.
    unitControlSelector: '[data-mc-unit],[name*="unit" i],[id*="unit" i],' +
                         '[name*="system" i],[id*="unitSystem" i]',

    // Calculate button. When a shared link carries ?go=1 this is clicked
    // after restore so the recipient sees results, not just inputs.
    calcButton: '[data-mc-calc],#calculate,#calcBtn,.calc-btn,' +
                'button[type="submit"]',

    // Where to mount the "Copy link" button. Nothing is injected if absent.
    shareMount: '[data-mc-share]',

    // localStorage
    storagePrefix: 'mc:state:',
    storageMaxAgeDays: 30,
    restoreFromStorage: true,

    // Debounce for URL writes (ms)
    writeDelay: 400,

    // Max query-string length before falling back to storage-only
    maxUrlLength: 1800
  };

  var CFG = Object.assign({}, DEFAULTS, window.MC_STATE_CONFIG || {});

  /* ---------------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
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

  /* ---------------------------------------------------------------------
     SEO guard — canonical must never carry query parameters.

     Without this, every shared link is a candidate duplicate of the clean
     URL. With it, Google folds ?p=45&t=400 back into the canonical page.
     --------------------------------------------------------------------- */
  function ensureCleanCanonical() {
    var clean = location.origin + location.pathname.replace(/\/+$/, '');
    if (location.pathname === '/') clean = location.origin + '/';

    var link = $('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    // Strip any query/fragment that may have been baked in.
    var current = (link.getAttribute('href') || '').split(/[?#]/)[0];
    link.setAttribute('href', current || clean);
  }

  /* ---------------------------------------------------------------------
     Field discovery
     --------------------------------------------------------------------- */
  function fields() {
    var root = $(CFG.root) || document.body;
    if (!root) return [];
    return $$('input,select,textarea', root).filter(function (el) {
      if (el.disabled) return false;
      if (CFG.excludeSelector && el.matches(CFG.excludeSelector)) return false;
      return !!fieldKey(el);
    });
  }

  function fieldKey(el) {
    // Radios share a name; everything else prefers id.
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
      el.checked = next;
      return true;
    }
    if (el.type === 'radio') {
      if (el.value !== value) return false;
      if (el.checked) return false;
      el.checked = true;
      return true;
    }
    if (el.value === value) return false;
    el.value = value;
    return true;
  }

  function fire(el) {
    // Both events: some handlers listen for one, some the other.
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* ---------------------------------------------------------------------
     Baseline — captured BEFORE any restore, so the URL only ever carries
     fields the user actually changed. Keeps shared links short and readable.
     --------------------------------------------------------------------- */
  var baseline = {};

  function captureBaseline() {
    baseline = {};
    fields().forEach(function (el) {
      var k = fieldKey(el), v = readField(el);
      if (k && v != null && !(k in baseline)) baseline[k] = v;
    });
  }

  function snapshot() {
    var out = {};
    fields().forEach(function (el) {
      var k = fieldKey(el), v = readField(el);
      if (!k || v == null || v === '') return;
      if (baseline[k] === v) return;      // unchanged from page default
      out[k] = v;
    });
    return out;
  }

  /* ---------------------------------------------------------------------
     Serialisation
     --------------------------------------------------------------------- */
  function toQuery(state, includeGo) {
    var p = new URLSearchParams();
    Object.keys(state).sort().forEach(function (k) { p.set(k, state[k]); });
    if (includeGo) p.set('go', '1');
    return p.toString();
  }

  function fromQuery() {
    var p = new URLSearchParams(location.search), out = {};
    p.forEach(function (v, k) { if (k !== 'go') out[k] = v; });
    return { state: out, go: p.get('go') === '1', any: Object.keys(out).length > 0 };
  }

  /* ---------------------------------------------------------------------
     Restore — two phases, because unit toggles rewrite other fields.
     --------------------------------------------------------------------- */
  var restoring = false;

  function applyState(state, then) {
    if (!state || !Object.keys(state).length) { if (then) then(); return; }
    restoring = true;

    var all = fields();
    var unitEls = [], otherEls = [];
    all.forEach(function (el) {
      if (CFG.unitControlSelector && el.matches(CFG.unitControlSelector)) unitEls.push(el);
      else otherEls.push(el);
    });

    // Phase 1 — unit system
    unitEls.forEach(function (el) {
      var k = fieldKey(el);
      if (k in state && writeField(el, state[k])) fire(el);
    });

    // Let the page's own unit handler finish before touching values.
    setTimeout(function () {
      // Phase 2 — everything else
      otherEls.forEach(function (el) {
        var k = fieldKey(el);
        if (k in state && writeField(el, state[k])) fire(el);
      });
      restoring = false;
      if (then) then();
    }, 0);
  }

  function autoCalculate() {
    if (!CFG.calcButton) return;
    var btn = $(CFG.calcButton);
    if (btn && !btn.disabled) {
      try { btn.click(); } catch (e) { /* non-fatal */ }
    }
  }

  /* ---------------------------------------------------------------------
     Persistence
     --------------------------------------------------------------------- */
  var writeUrl = debounce(function () {
    if (restoring) return;
    var state = snapshot();
    var qs = toQuery(state, false);
    var url = location.pathname + (qs ? '?' + qs : '') + location.hash;
    if (url.length <= CFG.maxUrlLength) {
      try { history.replaceState(null, '', url); } catch (e) { /* ignore */ }
    }
    saveLocal(state);
  }, CFG.writeDelay);

  function saveLocal(state) {
    if (!CFG.restoreFromStorage) return;
    try {
      if (!Object.keys(state).length) { localStorage.removeItem(storageKey()); return; }
      localStorage.setItem(storageKey(), JSON.stringify({ t: Date.now(), s: state }));
    } catch (e) { /* private mode / quota — non-fatal */ }
  }

  function loadLocal() {
    if (!CFG.restoreFromStorage) return null;
    try {
      var raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      var obj = JSON.parse(raw);
      var ageDays = (Date.now() - (obj.t || 0)) / 86400000;
      if (ageDays > CFG.storageMaxAgeDays) {
        localStorage.removeItem(storageKey());
        return null;
      }
      return obj.s || null;
    } catch (e) { return null; }
  }

  function clearLocal() {
    try { localStorage.removeItem(storageKey()); } catch (e) {}
  }

  /* ---------------------------------------------------------------------
     UI — share button and "restored" notice.
     Nothing is injected unless a mount point exists on the page.
     --------------------------------------------------------------------- */
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
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 250);
    }, 2200);
  }

  function copyLink() {
    var url = getLink(true);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast('Link copied — inputs included'); },
        function () { window.prompt('Copy this link:', url); }
      );
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  function mountShareButton(selector) {
    var mount = $(selector || CFG.shareMount);
    if (!mount || mount.querySelector('[data-mc-share-btn]')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-mc-share-btn', '');
    btn.textContent = '🔗 Copy link with my inputs';
    btn.className = 'mc-share-btn';
    btn.addEventListener('click', copyLink);
    mount.appendChild(btn);
  }

  function showRestoredNotice() {
    var mount = $(CFG.shareMount) || document.body;
    var bar = document.createElement('div');
    bar.setAttribute('data-mc-restored', '');
    bar.style.cssText =
      'margin:8px 0;padding:8px 12px;border-radius:8px;background:#eef6ff;' +
      'border:1px solid #cfe3fb;font:13px/1.4 system-ui,sans-serif;color:#123;';
    bar.innerHTML = 'Restored your last inputs. ';
    var a = document.createElement('button');
    a.type = 'button';
    a.textContent = 'Start fresh';
    a.style.cssText =
      'background:none;border:0;color:#0b5cad;text-decoration:underline;' +
      'cursor:pointer;font:inherit;padding:0';
    a.addEventListener('click', function () {
      clearLocal();
      location.href = location.pathname;
    });
    bar.appendChild(a);
    mount.insertBefore ? mount.insertBefore(bar, mount.firstChild)
                       : mount.appendChild(bar);
  }

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  function init() {
    ensureCleanCanonical();
    if (isCrawler()) return;   // never restore state for bots

    captureBaseline();

    var q = fromQuery();

    if (q.any) {
      applyState(q.state, function () { if (q.go) autoCalculate(); });
    } else {
      var saved = loadLocal();
      if (saved && Object.keys(saved).length) {
        applyState(saved, showRestoredNotice);
      }
    }

    // Track changes
    var root = $(CFG.root) || document.body;
    root.addEventListener('input',  writeUrl, true);
    root.addEventListener('change', writeUrl, true);

    mountShareButton();
  }

  /* ---------------------------------------------------------------------
     Public API
     --------------------------------------------------------------------- */
  window.MCState = {
    getLink: getLink,               // MCState.getLink() -> shareable URL
    snapshot: snapshot,             // current changed fields as an object
    clear: function () { clearLocal(); location.href = location.pathname; },
    copyLink: copyLink,
    mountShareButton: mountShareButton,
    config: CFG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
