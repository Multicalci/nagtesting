/* ═══════════════════════════════════════════════════════════════════
   multicalci.com — CALC COMMON
   Shared front-end helpers for individual calculator pages.
   Path: /assets/calc-common.js

   Contains: DOM helpers, number formatting, unit conversion,
             input validation, and the API caller factory.

   Contains NO calculator mathematics. Every engineering formula
   stays server-side in api/civil-electrical-mechanical-instrumentation.js.

   Loaded as a classic script (no module/defer needed):
       <script src="/assets/calc-common.js"></script>
   Everything is exposed on window.MC, and the familiar short helpers
   ($, gs, gv, set, raw, ...) are also exposed as globals so render
   code ported from the hub pages runs unchanged.
═══════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  var MC = {};


  /* ══════════════════════════════
     1. DOM HELPERS
  ══════════════════════════════ */

  /** Element by id. */
  function $(id) { return document.getElementById(id); }

  /** Raw string value of an input/select. '' if missing. */
  function gs(id) { var e = $(id); return e ? (e.value || '') : ''; }

  /**
   * Numeric value of an input.
   *
   * Returns NaN when the field is empty or non-numeric.
   *
   * DELIBERATE BEHAVIOUR CHOICE — read this before porting hub code.
   * The four hubs disagreed on this:
   *     instrumentation  gv() -> NaN   (on empty/invalid)
   *     civil            gv() -> 0     (via `parseFloat(...) || 0`)
   *     electrical       gv() -> 0     (via `isNaN(v) ? 0 : v`)
   *     mechanical       read fields inline, no shared gv
   *
   * NaN is the correct default for a calculator. Silently substituting
   * 0 for a missing beam length or a missing cable CSA produces a
   * confident wrong answer instead of a caught error. NaN forces the
   * value through validate() where it is reported to the user.
   *
   * Where a 0 default is genuinely wanted (an optional surcharge, an
   * optional eccentricity), call gvOr(id, 0) explicitly so the intent
   * is visible at the call site.
   */
  function gv(id) {
    var v = parseFloat(gs(id));
    return isNaN(v) ? NaN : v;
  }

  /** Numeric value with an explicit fallback for empty/invalid input. */
  function gvOr(id, fallback) {
    var v = parseFloat(gs(id));
    return isNaN(v) ? (fallback === undefined ? 0 : fallback) : v;
  }

  /** Alias of gv() — matches the electrical hub's `raw` helper. */
  function raw(id) { return gv(id); }

  /** Set innerHTML of a container. */
  function set(id, html) { var e = $(id); if (e) e.innerHTML = String(html); }

  /** Set textContent of a container (use when the value is untrusted). */
  function setText(id, txt) { var e = $(id); if (e) e.textContent = String(txt); }

  /** Show/hide by display. `mode` defaults to 'block'. */
  function show(id, visible, mode) {
    var e = $(id); if (!e) return;
    e.style.display = visible ? (mode || 'block') : 'none';
  }

  /** Toggle a class. */
  function cls(id, name, on) {
    var e = $(id); if (!e) return;
    e.classList.toggle(name, !!on);
  }


  /* ══════════════════════════════
     2. LOADING STATE
  ══════════════════════════════ */

  /**
   * Show or clear a "calculating" placeholder.
   *
   * Accepts either signature used by the hubs:
   *     setLoading('beam-results')                 // single id, on
   *     setLoading(['a','b'], true)                // array of ids
   *     setLoading('beam-results', false)          // clear
   */
  function setLoading(ids, loading) {
    var list = Array.isArray(ids) ? ids : [ids];
    var on = (loading === undefined) ? true : !!loading;
    list.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (on) {
        el.innerHTML = '<div class="rc-empty">Calculating…</div>';
      } else if (el.querySelector('.rc-empty')) {
        el.innerHTML = '';
      }
    });
  }

  /** Disable a button and swap its label while a request is in flight. */
  function busy(btnEl, isBusy, busyLabel) {
    if (!btnEl) return;
    if (isBusy) {
      btnEl.dataset.mcLabel = btnEl.textContent;
      btnEl.disabled = true;
      btnEl.textContent = busyLabel || 'Calculating…';
    } else {
      btnEl.disabled = false;
      if (btnEl.dataset.mcLabel) {
        btnEl.textContent = btnEl.dataset.mcLabel;
        delete btnEl.dataset.mcLabel;
      }
    }
  }


  /* ══════════════════════════════
     3. API CALLER FACTORY
  ══════════════════════════════ */

  /**
   * The backend exposes FOUR different request/response contracts, one
   * per discipline. They are all enforced server-side. Verified against
   * api/civil-electrical-mechanical-instrumentation.js:
   *
   *   discipline       request body              success response
   *   ─────────────────────────────────────────────────────────────────
   *   civil            { calc, params }          raw object (no `ok`)
   *   instrumentation  { tool, inputs }          { ok, result }
   *   electrical       { calc, inputs }          { ok, results }
   *   mechanical       { calculator, inputs }    { ok, results }
   *
   * Civil signals failure by returning { error } with status 400/422/500.
   * The other three return { ok:false, error } — instrumentation and
   * electrical at status 200, mechanical at 400/422/500.
   *
   * makeApi() adapts to whichever contract applies. The backend is NOT
   * modified.
   *
   * @param {object} cfg
   * @param {string} cfg.endpoint    e.g. '/api/civil-engineering-calculators'
   * @param {string} cfg.calcKey     body key naming the calculator
   * @param {string} cfg.inputsKey   body key carrying the inputs
   * @param {string|null} cfg.resultKey  response field holding results,
   *                                 or null when the whole body is the result
   * @param {boolean} cfg.okFlag     whether the response carries `ok`
   * @returns {function(string, object): Promise<object>}
   */
  function makeApi(cfg) {
    return async function call(calcName, inputs) {
      var body = {};
      body[cfg.calcKey] = calcName;
      body[cfg.inputsKey] = inputs || {};

      var res, data;
      try {
        res = await fetch(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (err) {
        showNetworkError();
        throw new Error('Network unreachable');
      }

      try {
        data = await res.json();
      } catch (err) {
        throw new Error('Server returned an unreadable response (HTTP ' + res.status + ')');
      }

      // Contract without an `ok` flag (civil): an `error` field means failure.
      if (!cfg.okFlag) {
        if (data && data.error) throw new Error(data.error);
        if (!res.ok) throw new Error('Request failed (HTTP ' + res.status + ')');
        return cfg.resultKey ? data[cfg.resultKey] : data;
      }

      // Contracts with an `ok` flag.
      if (!data || data.ok !== true) {
        throw new Error((data && data.error) || 'Calculation failed (HTTP ' + res.status + ')');
      }
      return cfg.resultKey ? data[cfg.resultKey] : data;
    };
  }

  /* Ready-made callers, one per discipline. Use the one matching the page. */
  var api = {
    civil: makeApi({
      endpoint:  '/api/civil-engineering-calculators',
      calcKey:   'calc',
      inputsKey: 'params',
      resultKey: null,
      okFlag:    false
    }),
    instrumentation: makeApi({
      endpoint:  '/api/instrumentation-calculators',
      calcKey:   'tool',
      inputsKey: 'inputs',
      resultKey: 'result',
      okFlag:    true
    }),
    electrical: makeApi({
      endpoint:  '/api/electrical-engineering-calculators',
      calcKey:   'calc',
      inputsKey: 'inputs',
      resultKey: 'results',
      okFlag:    true
    }),
    mechanical: makeApi({
      endpoint:  '/api/mechanical-engineering-calculators',
      calcKey:   'calculator',
      inputsKey: 'inputs',
      resultKey: 'results',
      okFlag:    true
    })
  };

  /** Transient banner for connection failures. */
  function showNetworkError(msg) {
    if ($('mc-net-error')) return;
    var b = document.createElement('div');
    b.id = 'mc-net-error';
    b.setAttribute('role', 'alert');
    b.style.cssText =
      'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#fef2f2;border:1.5px solid #fca5a5;color:#b91c1c;' +
      'padding:10px 18px;border-radius:6px;font-weight:600;font-size:.85rem;' +
      'font-family:system-ui,sans-serif;box-shadow:0 8px 28px rgba(15,32,68,.18);max-width:92vw';
    b.textContent = msg || "Couldn't reach the calculation server. Check your connection and try again.";
    document.body.appendChild(b);
    setTimeout(function () { b.remove(); }, 6000);
  }

  /** Render a caught error into a results container. */
  function showError(containerId, err) {
    var msg = (err && err.message) ? err.message : String(err);
    set(containerId, '<div class="rc-empty"><span class="validation-err">' + esc(msg) + '</span></div>');
  }


  /* ══════════════════════════════
     4. VALIDATION
  ══════════════════════════════ */

  /**
   * Check fields before spending a request.
   *
   * rules: [{ id, label, required, gt, gte, lt, lte, warnGt, warnLt }]
   * returns { ok, errors:[{id,msg}], warns:[{id,msg}] }
   */
  function validate(rules) {
    var errors = [], warns = [];
    (rules || []).forEach(function (r) {
      var el = $(r.id);
      var field = el && el.closest ? el.closest('.field') : null;
      if (field) field.classList.remove('err', 'warn');

      var v = parseFloat(gs(r.id));

      if (isNaN(v)) {
        if (r.required) {
          errors.push({ id: r.id, msg: r.label + ' is required' });
          if (field) field.classList.add('err');
        }
        return;
      }
      if (r.gt  !== undefined && v <= r.gt)  { errors.push({ id: r.id, msg: r.label + ' must be greater than ' + r.gt }); if (field) field.classList.add('err'); }
      if (r.gte !== undefined && v <  r.gte) { errors.push({ id: r.id, msg: r.label + ' must be at least ' + r.gte });   if (field) field.classList.add('err'); }
      if (r.lt  !== undefined && v >= r.lt)  { errors.push({ id: r.id, msg: r.label + ' must be less than ' + r.lt });   if (field) field.classList.add('err'); }
      if (r.lte !== undefined && v >  r.lte) { errors.push({ id: r.id, msg: r.label + ' must be at most ' + r.lte });    if (field) field.classList.add('err'); }

      if (r.warnGt !== undefined && v > r.warnGt) { warns.push({ id: r.id, msg: r.label + ' is unusually high (' + v + ') — check the units' }); if (field) field.classList.add('warn'); }
      if (r.warnLt !== undefined && v < r.warnLt) { warns.push({ id: r.id, msg: r.label + ' is unusually low (' + v + ') — check the units' });  if (field) field.classList.add('warn'); }
    });
    return { ok: errors.length === 0, errors: errors, warns: warns };
  }

  /** Paint validation output into a container. */
  function showValidation(containerId, v) {
    var el = $(containerId);
    if (!el) return;
    var html = '';
    v.errors.forEach(function (e) { html += '<span class="badge err">' + esc(e.msg) + '</span>'; });
    v.warns.forEach(function (w)  { html += '<span class="badge warn">' + esc(w.msg) + '</span>'; });
    el.innerHTML = html;
    el.style.display = html ? 'block' : 'none';
  }

  /** Escape untrusted text before injecting as HTML. */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }


  /* ══════════════════════════════
     5. NUMBER FORMATTING
  ══════════════════════════════ */

  /** Fixed decimals with optional unit. Non-numeric renders as an em dash. */
  function fN(v, dp, unit) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    if (isNaN(n) || !isFinite(n)) return '—';
    return n.toFixed(dp === undefined ? 2 : dp) + (unit ? ' ' + unit : '');
  }

  /** SI-prefixed (k / M / G). Mirrors the electrical hub's fE. */
  function fE(v, dp, unit) {
    if (v === null || v === undefined || v === '') return '—';
    var n = parseFloat(v);
    if (isNaN(n) || !isFinite(n)) return '—';
    var d = dp === undefined ? 2 : dp;
    var u = unit || '';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(d) + ' G' + u;
    if (a >= 1e6) return (n / 1e6).toFixed(d) + ' M' + u;
    if (a >= 1e3) return (n / 1e3).toFixed(d) + ' k' + u;
    return n.toFixed(d) + (u ? ' ' + u : '');
  }

  /** Significant figures. */
  function fS(v, sig) {
    var n = Number(v);
    if (isNaN(n) || !isFinite(n)) return '—';
    if (n === 0) return '0';
    return Number(n.toPrecision(sig || 4)).toString();
  }

  /** Scientific notation for very large/small magnitudes. */
  function fSci(v, dp) {
    var n = Number(v);
    if (isNaN(n) || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return n.toExponential(dp === undefined ? 3 : dp);
    return fN(n, dp === undefined ? 3 : dp);
  }


  /* ══════════════════════════════
     6. UNIT CONVERSION
  ══════════════════════════════ */

  /**
   * Display-side unit conversion only. These factors are copied verbatim
   * from the civil hub so ported pages produce byte-identical output.
   *
   * NOTE — three of these are rounded rather than exact:
   *     kN·m -> kip·ft   uses 1.356    (exact 1.355818)
   *     MPa  -> psi      uses 145.04   (exact 145.0377)
   *     kPa  -> ksf      uses 0.02089  (exact 0.02088543)
   * Left as-is deliberately. Change them only if you want the new pages
   * to disagree with the hubs in the 4th significant figure.
   */
  var UNITS = { system: 'SI' };

  function setUnitSystem(s) {
    UNITS.system = (s === 'IMP') ? 'IMP' : 'SI';
    document.querySelectorAll('[data-unit-btn]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-unit-btn') === UNITS.system);
    });
    document.querySelectorAll('[data-unit-si], [data-unit-imp]').forEach(function (el) {
      var t = el.getAttribute(UNITS.system === 'SI' ? 'data-unit-si' : 'data-unit-imp');
      if (t !== null) el.textContent = t;
    });
    if (typeof root.onUnitSystemChange === 'function') root.onUnitSystemChange(UNITS.system);
  }

  function isSI() { return UNITS.system === 'SI'; }

  var fLen = function (v, dp) { return isSI() ? fN(v, dp, 'm')     : fN(v / 0.3048,   dp, 'ft');     };
  var fMm  = function (v, dp) { return isSI() ? fN(v, dp, 'mm')    : fN(v / 25.4,     dp, 'in');     };
  var fKN  = function (v, dp) { return isSI() ? fN(v, dp, 'kN')    : fN(v / 4.44822,  dp, 'kip');    };
  var fKNm = function (v, dp) { return isSI() ? fN(v, dp, 'kN·m')  : fN(v / 1.356,    dp, 'kip·ft'); };
  var fMPa = function (v, dp) { return isSI() ? fN(v, dp, 'MPa')   : fN(v * 145.04,   dp, 'psi');    };
  var fKPa = function (v, dp) { return isSI() ? fN(v, dp, 'kN/m²') : fN(v * 0.02089,  dp, 'ksf');    };
  var fM3  = function (v, dp) { return isSI() ? fN(v, dp, 'm³')    : fN(v * 1.30795,  dp, 'yd³');    };
  var fTon = function (v, dp) { return isSI() ? fN(v, dp, 't')     : fN(v * 1.10231,  dp, 'ton');    };

  /** Convert a raw length into millimetres given a unit-selector value. */
  function toMm(value, unit) {
    var n = Number(value);
    if (isNaN(n)) return NaN;
    if (unit === 'm')  return n * 1000;
    if (unit === 'ft') return n * 304.8;
    if (unit === 'in') return n * 25.4;
    if (unit === 'cm') return n * 10;
    return n; // already mm
  }


  /* ══════════════════════════════
     7. RESULT RENDERING
  ══════════════════════════════ */

  /**
   * Build one result card.
   * @param {object} r
   * @param {string} r.label   caption
   * @param {string} r.value   pre-formatted value
   * @param {string} [r.unit]  unit shown beside the figure
   * @param {string} [r.sub]   secondary line
   * @param {string} [r.tone]  'main' | 'grn' | 'red' | 'amb' | 'blu' | 'cyn' | 'pur'
   * @param {boolean} [r.big]  render as the headline figure
   * @param {boolean} [r.span] span both grid columns
   */
  function resultCard(r) {
    var tone = r.tone ? ' c-' + r.tone : '';
    var vTone = r.tone ? ' v-' + r.tone : '';
    return '<div class="rc' + tone + (r.span ? ' sp2' : '') + '">' +
             '<div class="rl">' + esc(r.label) + '</div>' +
             '<div class="rv' + (r.big ? ' big' : '') + vTone + '">' + esc(r.value) +
               (r.unit ? '<span class="un">' + esc(r.unit) + '</span>' : '') +
             '</div>' +
             (r.sub ? '<div class="rsub">' + esc(r.sub) + '</div>' : '') +
           '</div>';
  }

  /** Render an array of result descriptors into a container. */
  function renderResults(containerId, list) {
    set(containerId, (list || []).map(resultCard).join(''));
  }

  /** Reset a results container to its empty state. */
  function clearResults(containerId, msg) {
    set(containerId, '<div class="rc-empty">' + esc(msg || 'Enter your values and select Calculate.') + '</div>');
  }


  /* ══════════════════════════════
     8. MISC
  ══════════════════════════════ */

  /** Run a function once the DOM is parsed. */
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  /** Submit the form when Enter is pressed inside any of the given fields. */
  function enterToCalc(fieldIds, handler) {
    (fieldIds || []).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); handler(); }
      });
    });
  }


  /* ══════════════════════════════
     9. EXPORTS
  ══════════════════════════════ */

  MC.$ = $;             MC.gs = gs;           MC.gv = gv;
  MC.gvOr = gvOr;       MC.raw = raw;         MC.set = set;
  MC.setText = setText; MC.show = show;       MC.cls = cls;
  MC.setLoading = setLoading;                 MC.busy = busy;
  MC.makeApi = makeApi; MC.api = api;
  MC.showNetworkError = showNetworkError;     MC.showError = showError;
  MC.validate = validate;                     MC.showValidation = showValidation;
  MC.esc = esc;
  MC.fN = fN; MC.fE = fE; MC.fS = fS; MC.fSci = fSci;
  MC.fLen = fLen; MC.fMm = fMm; MC.fKN = fKN; MC.fKNm = fKNm;
  MC.fMPa = fMPa; MC.fKPa = fKPa; MC.fM3 = fM3; MC.fTon = fTon;
  MC.toMm = toMm; MC.UNITS = UNITS;
  MC.setUnitSystem = setUnitSystem;           MC.isSI = isSI;
  MC.resultCard = resultCard;                 MC.renderResults = renderResults;
  MC.clearResults = clearResults;
  MC.ready = ready;     MC.enterToCalc = enterToCalc;

  root.MC = MC;

  /* Convenience globals so render code ported from the hubs runs unchanged.
     Assigned only when the name is free, so a page-local definition always
     wins and nothing is clobbered. */
  ['$', 'gs', 'gv', 'gvOr', 'raw', 'set', 'setText', 'show', 'setLoading',
   'busy', 'validate', 'showValidation', 'showNetworkError', 'showError',
   'esc', 'fN', 'fE', 'fS', 'fSci', 'fLen', 'fMm', 'fKN', 'fKNm', 'fMPa',
   'fKPa', 'fM3', 'fTon', 'toMm', 'setUnitSystem', 'isSI',
   'resultCard', 'renderResults', 'clearResults', 'ready', 'enterToCalc'
  ].forEach(function (name) {
    if (typeof root[name] === 'undefined') root[name] = MC[name];
  });

})(window);


/* ═══════════════════════════════════════════════════════════════════════
   VERCEL WEB ANALYTICS — static-site injection
   ───────────────────────────────────────────────────────────────────────
   The npm package (@vercel/analytics) and its inject() helper assume a
   bundler. This repo has no build step, so the tracking script is loaded
   directly from the platform endpoint instead. Same data, no dependency.

   Verify: DevTools > Network should show a request to
           /_vercel/insights/view on page load.
   Note:   ad blockers and privacy browsers block this, so counts
           undercount real traffic. Treat the numbers as directional.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root, doc) {
  'use strict';
  if (root.va) return;                       // already present on the page
  if (!/multicalci\.com$/i.test(root.location.hostname)) return; // prod only
  root.va = root.va || function () {
    (root.vaq = root.vaq || []).push(arguments);
  };
  var s = doc.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  (doc.head || doc.documentElement).appendChild(s);
})(window, document);
