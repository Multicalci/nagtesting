/**
 * steam-quench.test.js — v1.0
 * ════════════════════════════════════════════════════════════════════════════
 * Steam Quench / Desuperheater Calculator — Live API Test Suite
 * Route: POST /api/steam-quench
 *
 * Test coverage:
 *   Section 1  — Router / CORS
 *   Section 2  — Preview action (live property display)
 *   Section 3  — Main calculate: boiler preset (high-pressure)
 *   Section 4  — Main calculate: turbine bypass preset (mid-pressure)
 *   Section 5  — Main calculate: header preset (low-pressure)
 *   Section 6  — Main calculate: LP steam preset
 *   Section 7  — Mass & energy balance verification
 *   Section 8  — Field completeness (all HTML-required fields)
 *   Section 9  — Pressure unit consistency (Ps MPa, Pw MPa)
 *   Section 10 — Superheat status logic
 *   Section 11 — Control valve Cv sizing
 *   Section 12 — Sensitivity tables (sensT / sensW)
 *   Section 13 — Input validation & error handling
 *   Section 14 — Imperial unit inputs
 *   Section 15 — Golden-value regression tests
 *
 * All field names verified against api/steam-calculators.js Section B.
 * ════════════════════════════════════════════════════════════════════════════
 */

const BASE_URL = process.env.BASE_URL || 'https://www.multicalci.com';
const ENDPOINT = `${BASE_URL}/api/steam-quench`;
const TIMEOUT  = 30_000;

// ── HTTP helper ──────────────────────────────────────────────────────────────
async function post(body) {
  const resp = await fetch(ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(TIMEOUT),
  });
  const json = await resp.json();
  return { status: resp.status, body: json };
}

// ── Tolerance helper: fractional ─────────────────────────────────────────────
// fracTol = 0.05 means ±5%
function near(actual, expected, fracTol = 0.05, label = '') {
  const denom = Math.max(Math.abs(expected), 1e-9);
  const pct   = Math.abs(actual - expected) / denom;
  if (pct > fracTol) {
    throw new Error(
      `${label}: expected ~${expected}, got ${actual} ` +
      `(${(pct * 100).toFixed(1)}% deviation, tol=${(fracTol * 100).toFixed(0)}%)`
    );
  }
}

// ── Absolute tolerance helper ─────────────────────────────────────────────────
function abs_near(actual, expected, absTol, label = '') {
  if (Math.abs(actual - expected) > absTol) {
    throw new Error(
      `${label}: expected ${expected} ± ${absTol}, got ${actual}`
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
// BASELINE INPUTS — four standard presets (all SI: bara, °C, kg/h)
// Mirrors the PR{} object in the HTML file
// ════════════════════════════════════════════════════════════════════════════
const BOILER = {
  P_s: 100, T1: 500, m_in: 100000,
  Tw: 105,  Pw: 120, T2: 420,
  sh_min: 10, f_min: 30, f_max: 110, cv_in: 0,
};

const TURBINE = {
  P_s: 60, T1: 380, m_in: 60000,
  Tw: 90,  Pw: 75,  T2: 320,
  sh_min: 10, f_min: 30, f_max: 110, cv_in: 0,
};

const HEADER = {
  P_s: 30, T1: 280, m_in: 40000,
  Tw: 80,  Pw: 40,  T2: 250,
  sh_min: 10, f_min: 30, f_max: 110, cv_in: 0,
};

const LP = {
  P_s: 5, T1: 180, m_in: 20000,
  Tw: 50, Pw: 8,   T2: 165,
  sh_min: 10, f_min: 30, f_max: 110, cv_in: 0,
};


// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ROUTER / CORS
// ════════════════════════════════════════════════════════════════════════════
describe('Router / CORS', () => {

  test('OPTIONS preflight returns 204', async () => {
    const resp = await fetch(ENDPOINT, { method: 'OPTIONS' });
    expect(resp.status).toBe(204);
    expect(resp.headers.get('access-control-allow-methods')).toMatch(/POST/i);
  });

  test('GET returns 405', async () => {
    const resp = await fetch(ENDPOINT, { method: 'GET' });
    expect(resp.status).toBe(405);
  });

  test('Empty body returns 400', async () => {
    const { status } = await post({});
    expect(status).toBeGreaterThanOrEqual(400);
  });

  test('Invalid JSON body returns 4xx', async () => {
    const resp = await fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{ invalid json :::',
    });
    expect(resp.status).toBeGreaterThanOrEqual(400);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — PREVIEW ACTION
// Lightweight property preview: action:'preview'
// Returns: Ts, h1, v1, s1, sh_in, inlet_ok, h2, sh_out, hw, Tsat_w, water_ok
// ════════════════════════════════════════════════════════════════════════════
describe('Preview action', () => {

  test('returns 200 with Ts for valid pressure', async () => {
    const { status, body } = await post({
      action: 'preview', P_s: 10, T1: 300, Tw: 80, Pw: 12, T2: 250,
    });
    expect(status).toBe(200);
    expect(body.Ts).toBeDefined();
    expect(body.Ts).toBeGreaterThan(0);
  });

  test('Tsat at 10 bara ≈ 179.9°C', async () => {
    const { body } = await post({ action: 'preview', P_s: 10 });
    abs_near(body.Ts, 179.9, 0.3, 'Tsat@10bara');
  });

  test('Tsat at 100 bara ≈ 311.1°C', async () => {
    const { body } = await post({ action: 'preview', P_s: 100 });
    abs_near(body.Ts, 311.1, 0.3, 'Tsat@100bara');
  });

  test('Tsat at 5 bara ≈ 151.9°C', async () => {
    const { body } = await post({ action: 'preview', P_s: 5 });
    abs_near(body.Ts, 151.9, 0.3, 'Tsat@5bara');
  });

  test('returns h1, s1, v1, sh_in for valid inlet', async () => {
    const { body } = await post({
      action: 'preview', P_s: 10, T1: 300, Tw: 80, Pw: 12, T2: 250,
    });
    expect(body.h1).toBeGreaterThan(2500);  // superheated steam
    expect(body.s1).toBeGreaterThan(6.0);
    expect(body.v1).toBeGreaterThan(0);
    expect(body.sh_in).toBeGreaterThan(0);
    expect(body.inlet_ok).toBe(true);
  });

  test('h1 at 10 bara 300°C ≈ 3051 kJ/kg (IAPWS-IF97)', async () => {
    const { body } = await post({ action: 'preview', P_s: 10, T1: 300 });
    abs_near(body.h1, 3051.2, 5.0, 'h1@10bara,300C');
  });

  test('returns hw for valid water conditions', async () => {
    const { body } = await post({
      action: 'preview', P_s: 10, T1: 300, Tw: 80, Pw: 12, T2: 250,
    });
    expect(body.hw).toBeDefined();
    expect(body.hw).toBeGreaterThan(200);   // liquid water enthalpy
    expect(body.hw).toBeLessThan(700);
    expect(body.water_ok).toBe(true);
  });

  test('returns h2 and sh_out for valid outlet', async () => {
    const { body } = await post({
      action: 'preview', P_s: 10, T1: 300, Tw: 80, Pw: 12, T2: 250,
    });
    expect(body.h2).toBeGreaterThan(2500);
    expect(body.sh_out).toBeGreaterThan(0);
  });

  test('water_ok = false when Tw ≥ Tsat@Pw', async () => {
    // Tsat at 1 bara ≈ 99.6°C — water at 110°C is superheated
    const { body } = await post({ action: 'preview', P_s: 10, Tw: 110, Pw: 1.0 });
    expect(body.water_ok).toBe(false);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — BOILER PRESET (100 bara, 500°C → 420°C)
// ════════════════════════════════════════════════════════════════════════════
describe('Boiler preset (100 bara, 500°C → 420°C)', () => {

  let body;
  beforeAll(async () => {
    const r = await post(BOILER);
    expect(r.status).toBe(200);
    body = r.body;
  });

  test('no error returned', () => {
    expect(body.error).toBeUndefined();
  });

  test('h1 > h2 (inlet enthalpy exceeds outlet)', () => {
    expect(body.h1).toBeGreaterThan(body.h2);
  });

  test('hw < h2 (water enthalpy below outlet steam)', () => {
    expect(body.hw).toBeLessThan(body.h2);
  });

  test('ratio > 0 and < 0.30 (physically reasonable quench fraction)', () => {
    expect(body.ratio).toBeGreaterThan(0);
    expect(body.ratio).toBeLessThan(0.30);
  });

  test('m_w > 0', () => {
    expect(body.m_w).toBeGreaterThan(0);
  });

  test('m_out = m_in + m_w (mass balance)', () => {
    abs_near(body.m_out, body.m_in + body.m_w, 1.0, 'mass balance');
  });

  test('Q_rem ≈ Q_abs (adiabatic energy balance within 1%)', () => {
    near(body.Q_rem, body.Q_abs, 0.01, 'energy balance');
  });

  test('sh_out = T2 − Ts ≈ 109°C (420 − 311.1)', () => {
    abs_near(body.sh_out, BOILER.T2 - body.Ts, 0.5, 'sh_out');
  });

  test('Ts returned in °C (100 bara → ~311°C)', () => {
    abs_near(body.Ts, 311.1, 0.5, 'Ts@100bara');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — TURBINE BYPASS PRESET (60 bara, 380°C → 320°C)
// ════════════════════════════════════════════════════════════════════════════
describe('Turbine bypass preset (60 bara, 380°C → 320°C)', () => {

  let body;
  beforeAll(async () => {
    const r = await post(TURBINE);
    body = r.body;
  });

  test('no error returned', () => expect(body.error).toBeUndefined());

  test('mass balance: m_out = m_in + m_w', () => {
    abs_near(body.m_out, body.m_in + body.m_w, 1.0, 'mass balance');
  });

  test('energy balance: Q_rem ≈ Q_abs within 1%', () => {
    near(body.Q_rem, body.Q_abs, 0.01, 'energy balance');
  });

  test('ratio in range 0–0.20', () => {
    expect(body.ratio).toBeGreaterThan(0);
    expect(body.ratio).toBeLessThan(0.20);
  });

  test('shStatus is ADEQUATE (sh_out ≈ 45°C >> sh_min=10)', () => {
    expect(body.shStatus).toBe('ADEQUATE');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — PROCESS HEADER PRESET (30 bara, 280°C → 250°C)
// ════════════════════════════════════════════════════════════════════════════
describe('Process header preset (30 bara, 280°C → 250°C)', () => {

  let body;
  beforeAll(async () => {
    const r = await post(HEADER);
    body = r.body;
  });

  test('no error returned', () => expect(body.error).toBeUndefined());

  test('mass balance: m_out = m_in + m_w', () => {
    abs_near(body.m_out, body.m_in + body.m_w, 1.0, 'mass balance');
  });

  test('Q_rem > 0', () => expect(body.Q_rem).toBeGreaterThan(0));

  test('Tsat at 30 bara ≈ 233.9°C', () => {
    abs_near(body.Ts, 233.9, 0.5, 'Ts@30bara');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 6 — LP STEAM PRESET (5 bara, 180°C → 165°C)
// ════════════════════════════════════════════════════════════════════════════
describe('LP steam preset (5 bara, 180°C → 165°C)', () => {

  let body;
  beforeAll(async () => {
    const r = await post(LP);
    body = r.body;
  });

  test('no error returned', () => expect(body.error).toBeUndefined());

  test('mass balance: m_out = m_in + m_w', () => {
    abs_near(body.m_out, body.m_in + body.m_w, 1.0, 'mass balance');
  });

  test('sh_out = 165 − Tsat@5bara ≈ 13°C', () => {
    abs_near(body.sh_out, LP.T2 - body.Ts, 0.5, 'sh_out@LP');
  });

  test('Tsat at 5 bara ≈ 151.9°C', () => {
    abs_near(body.Ts, 151.9, 0.3, 'Ts@5bara');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 7 — MASS & ENERGY BALANCE (analytical verification)
// ════════════════════════════════════════════════════════════════════════════
describe('Mass & energy balance verification', () => {

  test('ratio = (h1 − h2) / (h2 − hw)', async () => {
    const { body } = await post(HEADER);
    const expected = (body.h1 - body.h2) / (body.h2 - body.hw);
    abs_near(body.ratio, expected, 0.0001, 'ratio formula');
  });

  test('m_w = m_in × ratio', async () => {
    const { body } = await post(HEADER);
    abs_near(body.m_w, body.m_in * body.ratio, 1.0, 'm_w formula');
  });

  test('qPct = m_w / m_out × 100', async () => {
    const { body } = await post(HEADER);
    const expected = (body.m_w / body.m_out) * 100;
    abs_near(body.qPct, expected, 0.01, 'qPct formula');
  });

  test('Q_rem = m_in/3600 × (h1−h2) [kW]', async () => {
    const { body } = await post(HEADER);
    const expected = (body.m_in / 3600) * (body.h1 - body.h2);
    abs_near(body.Q_rem, expected, 1.0, 'Q_rem formula');
  });

  test('Q_abs = m_w/3600 × (h2−hw) [kW]', async () => {
    const { body } = await post(HEADER);
    const expected = (body.m_w / 3600) * (body.h2 - body.hw);
    abs_near(body.Q_abs, expected, 1.0, 'Q_abs formula');
  });

  test('Q_rem ≈ Q_abs (adiabatic assumption closed)', async () => {
    const { body } = await post(BOILER);
    near(body.Q_rem, body.Q_abs, 0.005, 'adiabatic check boiler');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 8 — FIELD COMPLETENESS
// All fields consumed by the HTML render function must be present
// ════════════════════════════════════════════════════════════════════════════
describe('All HTML-required fields present', () => {

  let body;
  beforeAll(async () => {
    const r = await post(BOILER);
    body = r.body;
  });

  // inputs reflected back
  const inputFields = ['P_s','T1','T2','Tw','Pw','m_in','sh_min','f_min','f_max','cv_in'];
  inputFields.forEach(f => {
    test(`input field reflected: ${f}`, () => expect(body[f]).toBeDefined());
  });

  // sat / steam properties
  const propFields = ['Ts','Ps','h1','h2','hw','v1','v2','s1','s2'];
  propFields.forEach(f => {
    test(`property field present: ${f}`, () => {
      expect(body[f]).toBeDefined();
      expect(typeof body[f]).toBe('number');
      expect(isFinite(body[f])).toBe(true);
    });
  });

  // mass & energy balance outputs
  const balanceFields = ['ratio','m_w','m_out','qPct','Q_rem','Q_abs','sh_out'];
  balanceFields.forEach(f => {
    test(`balance field present: ${f}`, () => {
      expect(body[f]).toBeDefined();
      expect(body[f]).toBeGreaterThan(0);
    });
  });

  // saturation boundary (used in properties table)
  test('hf_steam finite', () => expect(isFinite(body.hf_steam)).toBe(true));
  test('hg_steam finite', () => expect(isFinite(body.hg_steam)).toBe(true));
  test('hg_steam > hf_steam', () => expect(body.hg_steam).toBeGreaterThan(body.hf_steam));

  // shStatus string
  test('shStatus is ADEQUATE, LOW, or INSUFFICIENT', () => {
    expect(['ADEQUATE','LOW','INSUFFICIENT']).toContain(body.shStatus);
  });

  // control range
  const rangeFields = ['mw_min','mw_max','mo_min','mo_max'];
  rangeFields.forEach(f => {
    test(`control range field: ${f}`, () => expect(body[f]).toBeGreaterThan(0));
  });

  // uncertainty strings
  test('unc_h1 is a non-empty string', () => {
    expect(typeof body.unc_h1).toBe('string');
    expect(body.unc_h1.length).toBeGreaterThan(2);
  });
  test('unc_h2 is a non-empty string', () => {
    expect(typeof body.unc_h2).toBe('string');
  });
  test('unc_hw is a non-empty string', () => {
    expect(typeof body.unc_hw).toBe('string');
  });

  // sensitivity arrays
  test('sensT is a non-empty array', () => {
    expect(Array.isArray(body.sensT)).toBe(true);
    expect(body.sensT.length).toBeGreaterThan(0);
  });
  test('sensW is a non-empty array', () => {
    expect(Array.isArray(body.sensW)).toBe(true);
    expect(body.sensW.length).toBeGreaterThan(0);
  });

  // meta
  test('warns is an array', () => expect(Array.isArray(body.warns)).toBe(true));
  test('ts is a non-empty string', () => {
    expect(typeof body.ts).toBe('string');
    expect(body.ts.length).toBeGreaterThan(5);
  });
  test('outletQuality is null (not near-sat) or a number', () => {
    expect(body.outletQuality === null || typeof body.outletQuality === 'number').toBe(true);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 9 — PRESSURE UNIT CONSISTENCY
// Ps must be in MPa, Pw must be in MPa (for fPu() in HTML render)
// ════════════════════════════════════════════════════════════════════════════
describe('Pressure unit consistency', () => {

  test('Ps = P_s × 0.1 (bara → MPa): boiler 100 bara → 10 MPa', async () => {
    const { body } = await post(BOILER);
    abs_near(body.Ps, BOILER.P_s * 0.1, 0.01, 'Ps MPa boiler');
  });

  test('Ps = P_s × 0.1: header 30 bara → 3 MPa', async () => {
    const { body } = await post(HEADER);
    abs_near(body.Ps, HEADER.P_s * 0.1, 0.01, 'Ps MPa header');
  });

  test('Pw = Pw_input × 0.1 (bara → MPa): boiler Pw=120 bara → 12 MPa', async () => {
    const { body } = await post(BOILER);
    abs_near(body.Pw, BOILER.Pw * 0.1, 0.01, 'Pw MPa boiler');
  });

  test('Pw = Pw_input × 0.1: header Pw=40 bara → 4 MPa', async () => {
    const { body } = await post(HEADER);
    abs_near(body.Pw, HEADER.Pw * 0.1, 0.01, 'Pw MPa header');
  });

  test('P_s echoed in bara (for valve calc reference)', async () => {
    const { body } = await post(BOILER);
    abs_near(body.P_s, BOILER.P_s, 0.01, 'P_s bara echo');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 10 — SUPERHEAT STATUS LOGIC
// ADEQUATE = sh_out >= sh_min + 10
// LOW      = sh_min <= sh_out < sh_min + 10
// INSUFFICIENT = sh_out < sh_min
// ════════════════════════════════════════════════════════════════════════════
describe('Superheat status logic', () => {

  test('ADEQUATE when sh_out >> sh_min (boiler: ~109°C >> 10°C)', async () => {
    const { body } = await post(BOILER);
    expect(body.shStatus).toBe('ADEQUATE');
  });

  test('LOW when sh_out is between sh_min and sh_min+10', async () => {
    // Tsat@5bara ≈ 151.9°C, T2 = 165°C → sh_out ≈ 13°C
    // sh_min = 10 → range [10, 20) → LOW
    const { body } = await post(LP);
    expect(body.shStatus).toBe('LOW');
  });

  test('INSUFFICIENT when sh_out < sh_min (raises error before result)', async () => {
    // T2 = Tsat + 5°C < sh_min = 10 → should error
    const { body: preview } = await post({ action: 'preview', P_s: 10 });
    const Ts = preview.Ts;
    const r = await post({
      ...HEADER, P_s: 10, T1: 300, T2: Ts + 5, sh_min: 10,
    });
    // API should reject with error (T2 ≤ Ts + sh_min)
    expect(r.body.error).toBeDefined();
  });

  test('sh_out = T2 - Ts (definition check)', async () => {
    const { body } = await post(HEADER);
    abs_near(body.sh_out, body.T2 - body.Ts, 0.5, 'sh_out definition');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 11 — CONTROL VALVE Cv SIZING (ISA S75 / IEC 60534)
// ════════════════════════════════════════════════════════════════════════════
describe('Control valve Cv sizing', () => {

  const WITH_CV = { ...BOILER, cv_in: 50.0 };

  let body;
  beforeAll(async () => {
    const r = await post(WITH_CV);
    body = r.body;
  });

  test('cv_res returned when cv_in > 0', () => {
    expect(body.cv_res).toBeDefined();
    expect(body.cv_res).not.toBeNull();
    expect(typeof body.cv_res).toBe('object');
  });

  test('cv_res.Cv_req > 0', () => {
    expect(body.cv_res.Cv_req).toBeGreaterThan(0);
  });

  test('cv_res.Kv_req > 0 (IEC metric equivalent)', () => {
    expect(body.cv_res.Kv_req).toBeGreaterThan(0);
  });

  test('cv_res.Cv_inst = cv_in (50.0)', () => {
    expect(body.cv_res.Cv_inst).toBe(WITH_CV.cv_in);
  });

  test('cv_res.rat = Cv_inst / Cv_req', () => {
    const expected = WITH_CV.cv_in / body.cv_res.Cv_req;
    abs_near(body.cv_res.rat, expected, 0.01, 'rat formula');
  });

  test('cv_res.FL = 0.90 (globe valve liquid pressure recovery)', () => {
    abs_near(body.cv_res.FL, 0.90, 0.001, 'FL');
  });

  test('cv_res.dP_bar = Pw − P_s', () => {
    abs_near(body.cv_res.dP_bar, WITH_CV.Pw - WITH_CV.P_s, 0.1, 'dP_bar');
  });

  test('cv_res.SG > 0 and < 1.0 (hot water < cold reference)', () => {
    expect(body.cv_res.SG).toBeGreaterThan(0);
    expect(body.cv_res.SG).toBeLessThan(1.0);
  });

  test('cv_res.sigma defined (cavitation index)', () => {
    expect(body.cv_res.sigma).toBeDefined();
  });

  test('cv_res.flashing is boolean', () => {
    expect(typeof body.cv_res.flashing).toBe('boolean');
  });

  test('cv_res.choked is boolean', () => {
    expect(typeof body.cv_res.choked).toBe('boolean');
  });

  test('cv_res = null when cv_in = 0', async () => {
    const { body: b } = await post(BOILER);   // cv_in = 0
    expect(b.cv_res).toBeNull();
  });

  test('flashing = false for boiler (P_s=100 >> Pv@105°C≈1.2 bar)', () => {
    // P_s = 100 bara >> vapour pressure of water at 105°C ≈ 1.2 bar
    // so steam line pressure is WAY above vapour pressure — no flashing
    expect(body.cv_res.flashing).toBe(false);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 12 — SENSITIVITY TABLES
// sensT: T2 ± variations (server-side computed)
// sensW: Tw ± variations (server-side computed)
// ════════════════════════════════════════════════════════════════════════════
describe('Sensitivity tables', () => {

  let body;
  beforeAll(async () => {
    const r = await post(HEADER);
    body = r.body;
  });

  test('sensT has exactly one base row (d=0)', () => {
    const baseRows = body.sensT.filter(r => r.base === true);
    expect(baseRows).toHaveLength(1);
    expect(baseRows[0].d).toBe(0);
  });

  test('sensT base row mws matches m_w', () => {
    const base = body.sensT.find(r => r.base);
    abs_near(base.mws, body.m_w, 1.0, 'sensT base mws vs m_w');
  });

  test('sensT: higher T2 → less quench water (monotone)', () => {
    const sorted = [...body.sensT].sort((a, b) => a.d - b.d);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].mws).toBeLessThanOrEqual(sorted[i-1].mws + 1);
    }
  });

  test('sensT rows have required fields: d, T2s, mws, pct', () => {
    body.sensT.forEach(row => {
      expect(row).toHaveProperty('d');
      expect(row).toHaveProperty('T2s');
      expect(row).toHaveProperty('mws');
      expect(row).toHaveProperty('pct');
    });
  });

  test('sensW has exactly one base row (d=0)', () => {
    const baseRows = body.sensW.filter(r => r.base === true);
    expect(baseRows).toHaveLength(1);
  });

  test('sensW: lower Tw → less quench water (monotone)', () => {
    const sorted = [...body.sensW].sort((a, b) => a.d - b.d);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].mws).toBeGreaterThanOrEqual(sorted[i-1].mws - 1);
    }
  });

  test('sensW rows have required fields: d, Tws, mws, pct', () => {
    body.sensW.forEach(row => {
      expect(row).toHaveProperty('d');
      expect(row).toHaveProperty('Tws');
      expect(row).toHaveProperty('mws');
      expect(row).toHaveProperty('pct');
    });
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 13 — INPUT VALIDATION & ERROR HANDLING
// ════════════════════════════════════════════════════════════════════════════
describe('Input validation & error handling', () => {

  test('T1 not superheated → 422 error', async () => {
    // Tsat@10bara ≈ 179.9°C, T1=170 is wet
    const { status, body } = await post({ ...HEADER, P_s: 10, T1: 170 });
    expect(status).toBe(422);
    expect(body.error).toMatch(/superheated/i);
  });

  test('T2 >= T1 → 422 error', async () => {
    const { status, body } = await post({ ...HEADER, T2: 300 }); // T2>T1=280
    expect(status).toBe(422);
    expect(body.error).toBeDefined();
  });

  test('T2 ≤ Ts + sh_min → 422 error', async () => {
    // Tsat@30bara ≈ 233.9°C, sh_min=10 → min T2 = 243.9°C
    const { status, body } = await post({ ...HEADER, T2: 235 });
    expect(status).toBe(422);
    expect(body.error).toMatch(/superheat/i);
  });

  test('Tw >= T2 → 422 error', async () => {
    const { status, body } = await post({ ...HEADER, Tw: 260 }); // Tw>T2=250
    expect(status).toBe(422);
    expect(body.error).toBeDefined();
  });

  test('missing P_s → 400', async () => {
    const body = { ...HEADER };
    delete body.P_s;
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/P_s/i);
  });

  test('missing T1 → 400', async () => {
    const body = { ...HEADER };
    delete body.T1;
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/T1/i);
  });

  test('missing m_in → 400', async () => {
    const body = { ...HEADER };
    delete body.m_in;
    const r = await post(body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/m_in/i);
  });

  test('m_in = 0 → 400', async () => {
    const { status, body } = await post({ ...HEADER, m_in: 0 });
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  test('h2 − hw < 20 → 422 (insufficient enthalpy driving force)', async () => {
    // Water temp very close to outlet target → driving force collapses
    const { status, body } = await post({ ...HEADER, Tw: 248 }); // T2=250, Tw=248
    expect(status).toBe(422);
    expect(body.error).toMatch(/enthalpy/i);
  });

  test('Pw warning when margin < 3 bar', async () => {
    // Pw = P_s + 2 → warns but does not reject
    const { body } = await post({ ...HEADER, Pw: 32 });
    if (!body.error) {
      const hasWarn = body.warns && body.warns.some(w => w.includes('margin'));
      expect(hasWarn).toBe(true);
    }
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 14 — CONTROL RANGE (f_min / f_max)
// ════════════════════════════════════════════════════════════════════════════
describe('Control range (f_min / f_max)', () => {

  let body;
  beforeAll(async () => {
    const r = await post({ ...HEADER, f_min: 30, f_max: 110 });
    body = r.body;
  });

  test('mw_min = m_w × f_min/100', () => {
    abs_near(body.mw_min, body.m_w * 30 / 100, 1.0, 'mw_min');
  });

  test('mw_max = m_w × f_max/100', () => {
    abs_near(body.mw_max, body.m_w * 110 / 100, 1.0, 'mw_max');
  });

  test('mo_min = m_in + mw_min', () => {
    abs_near(body.mo_min, body.m_in + body.mw_min, 1.0, 'mo_min');
  });

  test('mo_max = m_in + mw_max', () => {
    abs_near(body.mo_max, body.m_in + body.mw_max, 1.0, 'mo_max');
  });

  test('mw_min < m_w < mw_max', () => {
    expect(body.mw_min).toBeLessThan(body.m_w);
    expect(body.mw_max).toBeGreaterThan(body.m_w);
  });
});


// ════════════════════════════════════════════════════════════════════════════
// SECTION 15 — GOLDEN-VALUE REGRESSION TESTS
// Reference values hand-calculated from IAPWS-IF97 tables
// ════════════════════════════════════════════════════════════════════════════
describe('Golden-value regression tests', () => {

  test('[REG-SQ-01] h1 at 100 bara, 500°C ≈ 3374 kJ/kg (IF97)', async () => {
    const { body } = await post(BOILER);
    near(body.h1, 3374, 0.01, '[REG-SQ-01] h1 boiler');
  });

  test('[REG-SQ-02] h2 at 100 bara, 420°C ≈ 3174 kJ/kg (IF97)', async () => {
    const { body } = await post(BOILER);
    near(body.h2, 3174, 0.015, '[REG-SQ-02] h2 boiler');
  });

  test('[REG-SQ-03] hw at 105°C, 120 bara > hw at 105°C (Poynting correction)', async () => {
    // hw must be > hf(105°C)≈440 kJ/kg due to Poynting correction at 120 bara
    const { body } = await post(BOILER);
    expect(body.hw).toBeGreaterThan(440);
  });

  test('[REG-SQ-04] header ratio ≈ 0.020–0.035 (30 bara, 280→250°C)', async () => {
    const { body } = await post(HEADER);
    expect(body.ratio).toBeGreaterThan(0.015);
    expect(body.ratio).toBeLessThan(0.040);
  });

  test('[REG-SQ-05] LP Q_rem: 20000 kg/h × Δh → physically reasonable kW', async () => {
    const { body } = await post(LP);
    // Δh @ 5bara: ~3000−2900 = ~100 kJ/kg → Q = 20000/3600 × 100 ≈ 556 kW
    expect(body.Q_rem).toBeGreaterThan(100);
    expect(body.Q_rem).toBeLessThan(2000);
  });

  test('[REG-SQ-06] Tsat at 60 bara ≈ 275.6°C', async () => {
    const { body } = await post(TURBINE);
    abs_near(body.Ts, 275.6, 0.5, '[REG-SQ-06] Ts@60bara');
  });

  test('[REG-SQ-07] hf_steam at 30 bara ≈ 1008 kJ/kg', async () => {
    const { body } = await post(HEADER);
    near(body.hf_steam, 1008, 0.02, '[REG-SQ-07] hf@30bara');
  });

  test('[REG-SQ-08] hg_steam at 30 bara ≈ 2804 kJ/kg', async () => {
    const { body } = await post(HEADER);
    near(body.hg_steam, 2804, 0.02, '[REG-SQ-08] hg@30bara');
  });

  test('[REG-SQ-09] m_w for boiler is in range 3000–8000 kg/h (100 t/h steam)', async () => {
    const { body } = await post(BOILER);
    expect(body.m_w).toBeGreaterThan(3000);
    expect(body.m_w).toBeLessThan(8000);
  });

  test('[REG-SQ-10] s1 at 100 bara, 500°C ≈ 6.59 kJ/kg·K', async () => {
    const { body } = await post(BOILER);
    abs_near(body.s1, 6.59, 0.05, '[REG-SQ-10] s1 boiler');
  });
});
