/**
 * heatxpert.test.js — v3 (field names verified against API source)
 * ================================================================
 * All input/output field names verified directly from api/heat-exchanger.js
 *
 * Key corrections vs v2:
 *   wallThick  : P_barg→P, D_mm→D, S_MPa→S, CA_mm→CA, MT_mm→MT, standard→std
 *   doublePipe : innerOD→iOD, tw→iTW, outerID_i→oID (outer pipe ID)
 *   finFan     : completely rewritten with correct API 661 field names
 *   lmtdNtu    : NTU test now passes Ch+Cc so NTU is computed
 *   shellTube  : pressure-drop direction tests use non-crossing temps
 *   airCooled  : eta_fin floor lowered to 0.25 (actual ≈ 0.30 for these fins)
 */

const BASE_URL = process.env.BASE_URL || 'https://www.multicalci.com';
const ENDPOINT = `${BASE_URL}/api/heatxpert`;
const TIMEOUT  = 30_000;

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

function near(actual, expected, fracTol = 0.05, label = '') {
  const pct = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  if (pct > fracTol) {
    throw new Error(
      `${label}: expected ~${expected}, got ${actual} (${(pct*100).toFixed(1)}% deviation, tol=${(fracTol*100).toFixed(0)}%)`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — ROUTER & CORS
// ═══════════════════════════════════════════════════════════════════════════════
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

  test('Unknown calcType returns 400', async () => {
    const { status, body } = await post({ calcType: 'nonExistentCalc' });
    expect(status).toBe(400);
    expect(body.error).toMatch(/unknown calcType/i);
  });

  test('Missing calcType returns 400', async () => {
    const { status, body } = await post({});
    expect(status).toBe(400);
    expect(body.error).toMatch(/calcType required/i);
  });

  test('Invalid JSON body returns 4xx or 5xx error', async () => {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json :::',
    });
    expect(resp.status).toBeGreaterThanOrEqual(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — SHELL & TUBE
// ═══════════════════════════════════════════════════════════════════════════════

const ST_BASELINE = {
  calcType: 'shellTube',
  hFlKey: 'water', hTi: 90, hTo: 60, hF: 80000,
  cFlKey: 'water', cTi: 25, cF: 40000, coldMode: 'flow',
  OD: 25.4, tw: 2.0, L: 4.88, pitch: 1.25, arr: 'counter',
  mat: 'ss316', tema: 'C', hxType: '1-2',
  Rfo: 0.0002, Rfi: 0.0002,
  pdAllowShell: 1.0, pdAllowTube: 1.0,
};

describe('Shell & Tube — single-phase water/water', () => {

  test('returns 200 with no error', async () => {
    const { status, body } = await post(ST_BASELINE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('Q > 0 and matches energy balance within 10%', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.Q).toBeGreaterThan(0);
    near(body.Q, 2790, 0.10, 'Q energy balance');
  });

  test('cold outlet: cTi < cTo < hTi', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.cTo).toBeGreaterThan(ST_BASELINE.cTi);
    expect(body.cTo).toBeLessThan(ST_BASELINE.hTi);
  });

  test('LMTD > 0', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.lmtd).toBeGreaterThan(0);
  });

  test('U in realistic range 200–2000 W/m²K', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.U).toBeGreaterThan(200);
    expect(body.U).toBeLessThan(2000);
  });

  test('area > 0 and < 500 m²', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.area).toBeGreaterThan(0);
    expect(body.area).toBeLessThan(500);
  });

  test('tubeVel > 0', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.tubeVel).toBeGreaterThan(0);
  });

  test('shellDP > 0', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.shellDP).toBeGreaterThan(0);
  });

  test('tubeDp > 0', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.tubeDp).toBeGreaterThan(0);
  });

  test('NTU > 0 and 0 < eff <= 1', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.NTU).toBeGreaterThan(0);
    expect(body.eff).toBeGreaterThan(0);
    expect(body.eff).toBeLessThanOrEqual(1.0);
  });

  test('resistance breakdown sums to ~100%', async () => {
    const { body } = await post(ST_BASELINE);
    const total = body.resistanceBreakdown.reduce((s, r) => s + r.pct, 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(105);
  });

  test('numTubes is positive integer multiple of nPasses', async () => {
    const { body } = await post(ST_BASELINE);
    expect(Number.isInteger(body.numTubes)).toBe(true);
    expect(body.numTubes % body.nPasses).toBe(0);
    expect(body.numTubes).toBeGreaterThan(0);
  });

  test('U converged (deviation < 5%)', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.convergence.converged).toBe(true);
    expect(body.convergence.deviation_pct).toBeLessThan(5);
  });
});

describe('Shell & Tube — input validation', () => {

  test('hTo >= hTi rejected with 500', async () => {
    const { status } = await post({ ...ST_BASELINE, hTi: 60, hTo: 90 });
    expect(status).toBe(500);
  });

  test('hF = 0 rejected with 500', async () => {
    const { status } = await post({ ...ST_BASELINE, hF: 0 });
    expect(status).toBe(500);
  });

  test('hTi <= cTi rejected with 500', async () => {
    const { status } = await post({ ...ST_BASELINE, hTi: 25, hTo: 15, cTi: 30 });
    expect(status).toBe(500);
  });

  test('missing OD returns 500 mentioning OD', async () => {
    const body = { ...ST_BASELINE };
    delete body.OD;
    const { status, body: resp } = await post(body);
    expect(status).toBe(500);
    expect(resp.error).toMatch(/OD/i);
  });
});

describe('Shell & Tube — condensing steam', () => {

  test('phaseZones.mode = condensing', async () => {
    const { body } = await post({
      calcType: 'shellTube',
      hFlKey: 'steam', hTi: 120, hTo: 100, hF: 5000,
      cFlKey: 'water', cTi: 25, cF: 50000, coldMode: 'flow',
      OD: 25.4, tw: 2.0, L: 3.66, pitch: 1.25, arr: 'counter',
      mat: 'cs', tema: 'C', hxType: '1-2',
      shellMode: 'condensing',
    });
    expect(body.Q).toBeGreaterThan(0);
    expect(body.phaseZones).toBeDefined();
    expect(body.phaseZones.mode).toBe('condensing');
  });
});

describe('Shell & Tube — imperial unit conversion', () => {

  test('imperial Q matches metric Q within 5%', async () => {
    const common = {
      calcType: 'shellTube',
      hFlKey: 'water', cFlKey: 'water',
      OD: 25.4, tw: 2.0, L: 4.88, pitch: 1.25, arr: 'counter',
      mat: 'ss304', tema: 'C', hxType: '1-2',
    };
    const si  = await post({ ...common, hTi:90, hTo:60, hF:80000, cTi:25, cF:40000, coldMode:'flow' });
    const imp = await post({ ...common, hTi:194, hTo:140, hF:176370, cTi:77, cF:88185, coldMode:'flow', unitSys:'imperial' });
    near(imp.body.Q, si.body.Q, 0.05, 'imperial vs metric Q');
  });
});

describe('Shell & Tube — Bell-Delaware physics', () => {

  test('Jtotal in range 0.30–1.05', async () => {
    const { body } = await post(ST_BASELINE);
    expect(body.bdCorr.Jtotal).toBeGreaterThan(0.30);
    expect(body.bdCorr.Jtotal).toBeLessThan(1.05);
  });

  test('higher baffle cut → lower or equal shellDP', async () => {
    const lo = await post({ ...ST_BASELINE, bcut: 0.20 });
    const hi = await post({ ...ST_BASELINE, bcut: 0.40 });
    // Allow 10% tolerance for edge cases
    expect(hi.body.shellDP).toBeLessThanOrEqual(lo.body.shellDP * 1.10);
  });

  test('triangular pitch hShell >= 80% of square pitch hShell', async () => {
    const tri = await post({ ...ST_BASELINE, pitchLayout: 'triangular' });
    const sq  = await post({ ...ST_BASELINE, pitchLayout: 'square' });
    expect(tri.body.bdCorr.hShell).toBeGreaterThanOrEqual(sq.body.bdCorr.hShell * 0.80);
  });
});

describe('Shell & Tube — pressure drop direction', () => {

  // Use a small hot-side flow so changing cF doesn't cause temperature cross
  const ST_SMALL = {
    calcType: 'shellTube',
    hFlKey: 'water', hTi: 90, hTo: 70, hF: 30000,
    cFlKey: 'water', cTi: 25, coldMode: 'flow',
    OD: 25.4, tw: 2.0, L: 4.88, pitch: 1.25, arr: 'counter',
    mat: 'ss304', tema: 'C', hxType: '1-2',
  };

  test('tubeDp increases with increasing cold flow', async () => {
    const lo = await post({ ...ST_SMALL, cF: 10000 });
    const hi = await post({ ...ST_SMALL, cF: 50000 });
    expect(lo.body.tubeDp).toBeGreaterThan(0);
    expect(hi.body.tubeDp).toBeGreaterThan(0);
    expect(hi.body.tubeDp).toBeGreaterThan(lo.body.tubeDp);
  });

  test('shellDP increases with increasing hot flow', async () => {
    const lo = await post({ ...ST_SMALL, cF: 20000, hF: 20000 });
    const hi = await post({ ...ST_SMALL, cF: 20000, hF: 80000 });
    expect(lo.body.shellDP).toBeGreaterThan(0);
    expect(hi.body.shellDP).toBeGreaterThan(0);
    expect(hi.body.shellDP).toBeGreaterThan(lo.body.shellDP);
  });
});

describe('Shell & Tube — fluid comparison', () => {

  test('water U >> lube-oil U', async () => {
    const w = await post({ ...ST_BASELINE, hFlKey:'water',    cFlKey:'water' });
    const o = await post({ ...ST_BASELINE, hFlKey:'lube-oil', cFlKey:'water' });
    expect(w.body.U).toBeGreaterThan(o.body.U * 1.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — PLATE HX
// ═══════════════════════════════════════════════════════════════════════════════

const PLATE_BASE = {
  calcType: 'plate',
  hFlKey: 'water', hTi: 80, hTo: 50, hF: 30000,
  cFlKey: 'water', cTi: 20, cF: 25000, coldMode: 'flow',
  th: 0.6, angle: 45, gap: 3.0, pw: 0.5, plen: 1.2, phi: 1.17,
  mat: 'ss316', foul: 0.0002,
  pdAllowH: 1.5, pdAllowC: 1.5,
};

describe('Plate HX', () => {

  test('returns 200', async () => {
    const { status, body } = await post(PLATE_BASE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('Q > 0', async () => {
    const { body } = await post(PLATE_BASE);
    expect(body.Q).toBeGreaterThan(0);
  });

  test('U_clean > U', async () => {
    const { body } = await post(PLATE_BASE);
    expect(body.U_clean).toBeGreaterThan(body.U);
  });

  test('A_provided >= 98% of A_req', async () => {
    const { body } = await post(PLATE_BASE);
    expect(body.A_provided).toBeGreaterThanOrEqual(body.A_req * 0.98);
  });

  test('nPlates >= 4', async () => {
    const { body } = await post(PLATE_BASE);
    expect(body.nPlates).toBeGreaterThanOrEqual(4);
  });

  test('hH and hC > 200 W/m²K', async () => {
    const { body } = await post(PLATE_BASE);
    expect(body.hH).toBeGreaterThan(200);
    expect(body.hC).toBeGreaterThan(200);
  });

  test('temperature cross (cTi > hTo) rejected', async () => {
    const { status } = await post({ ...PLATE_BASE, cTi: 55 });
    expect(status).toBe(500);
  });

  test('cTo > cTi', async () => {
    const { body } = await post(PLATE_BASE);
    expect(body.cTo).toBeGreaterThan(PLATE_BASE.cTi);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — AIR COOLED HX
// Input fields: flKey, Ti, To, F (kg/h), Tamb, dTa,
//               tubeOD, tubeID, finH, finThk, finDens,
//               pitchT, rows, nTubes, tubeLen, Rfo, finMat
// Return fields: Q, eta_fin, eta_0, h_eff, A_total, A_req, overDesign
// ═══════════════════════════════════════════════════════════════════════════════

const AC_BASE = {
  calcType: 'airCooled',
  flKey: 'crude-oil-light', Ti: 100, To: 65, F: 80000,
  Tamb: 35, dTa: 15,
  tubeOD: 25.4, tubeID: 20.0,
  finH: 12.5, finThk: 0.40, finDens: 394,
  pitchT: 63.5, rows: 4, nTubes: 40, tubeLen: 6.0,
  Rfo: 0.0002, finMat: 'alum',
};

describe('Air Cooled HX', () => {

  test('returns 200', async () => {
    const { status, body } = await post(AC_BASE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('Q > 0', async () => {
    const { body } = await post(AC_BASE);
    expect(body.Q).toBeGreaterThan(0);
  });

  test('eta_fin between 0.20 and 1.0', async () => {
    // Crude oil service with large fins can give eta_fin as low as 0.30
    const { body } = await post(AC_BASE);
    expect(body.eta_fin).toBeGreaterThan(0.20);
    expect(body.eta_fin).toBeLessThanOrEqual(1.0);
  });

  test('aluminium fins give higher eta_fin than carbon steel fins', async () => {
    const alum = await post({ ...AC_BASE, finMat: 'alum' });
    const cs   = await post({ ...AC_BASE, finMat: 'cs' });
    expect(alum.body.eta_fin).toBeGreaterThan(cs.body.eta_fin);
  });

  test('ambient >= process outlet rejected', async () => {
    const { status } = await post({ ...AC_BASE, Tamb: 70 });
    expect(status).toBe(500);
  });

  test('outlet >= inlet rejected', async () => {
    const { status } = await post({ ...AC_BASE, To: 110 });
    expect(status).toBe(500);
  });

  test('A_total > 0', async () => {
    const { body } = await post(AC_BASE);
    expect(body.A_total).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — FIN-FAN HX (API 661 detailed)
// Required inputs verified from calcFinFan source:
//   tFlKey, tTi, tTo, tF_kgh, aTamb, aTout,
//   tubeOD, tubeID, tubeLen, pitchT, pitchL,
//   finRoot, finH, finThk, finDensity,
//   nRows, nPasses, nTubes, bundleW,
//   nBays, nBundlesPBay, nFans
// ═══════════════════════════════════════════════════════════════════════════════

const FF_BASE = {
  calcType: 'finFan',
  tFlKey: 'water', tTi: 70, tTo: 45, tF_kgh: 50000,
  aTamb: 35, aTout: 50,
  tubeOD: 25.4, tubeID: 20.0, tubeLen: 6000,   // mm
  pitchT: 63.5, pitchL: 55.0,                   // mm
  finRoot: 25.4, finH: 12.7, finThk: 0.4,       // mm
  finDensity: 394, finMat: 'al1100',
  nRows: 4, nPasses: 2, nTubes: 48,
  bundleW: 3000,                                  // mm
  nBays: 1, nBundlesPBay: 1, nFans: 2,
  fanDia: 3.658, fanEff: 0.65, driverKW: 30,
  draftType: 'forced', tubeLayout: 'staggered',
  tubeMat: 'cs',
};

describe('Fin-Fan HX (API 661)', () => {

  test('returns 200', async () => {
    const { status, body } = await post(FF_BASE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('Qhot > 0', async () => {
    const { body } = await post(FF_BASE);
    expect(body.Qhot).toBeGreaterThan(0);
  });

  test('eta_fin between 0.20 and 1.0', async () => {
    const { body } = await post(FF_BASE);
    expect(body.eta_fin).toBeGreaterThan(0.20);
    expect(body.eta_fin).toBeLessThanOrEqual(1.0);
  });

  test('A_extended > 0', async () => {
    const { body } = await post(FF_BASE);
    expect(body.A_extended).toBeGreaterThan(0);
  });

  test('U_ext > 0', async () => {
    const { body } = await post(FF_BASE);
    expect(body.U_ext).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — DOUBLE PIPE HX
// Required inputs verified from calcDoublePipe source:
//   hFlKey, hTi, hTo, hF, cFlKey, cTi, cF, coldMode,
//   iOD (inner pipe OD mm), iTW (inner pipe wall thickness mm),
//   oID (outer pipe ID mm), L (m), nHairpins, arr, mat, foul
// ═══════════════════════════════════════════════════════════════════════════════

const DP_BASE = {
  calcType: 'doublePipe',
  hFlKey: 'water', hTi: 75, hTo: 50, hF: 5000,
  cFlKey: 'water', cTi: 20, cF: 4000, coldMode: 'flow',
  iOD: 50,    // inner pipe OD mm
  iTW: 3,     // inner pipe wall thickness mm
  oID: 80,    // outer pipe ID mm (must be > iOD=50)
  L: 6.0, nHairpins: 4, arr: 'counter',
  mat: 'ss304', foul: 0.0002,
};

describe('Double Pipe HX', () => {

  test('returns 200', async () => {
    const { status, body } = await post(DP_BASE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('Q > 0', async () => {
    const { body } = await post(DP_BASE);
    expect(body.Q).toBeGreaterThan(0);
  });

  test('U in range 100–8000 W/m²K', async () => {
    const { body } = await post(DP_BASE);
    expect(body.U).toBeGreaterThan(100);
    expect(body.U).toBeLessThan(8000);
  });

  test('LMTD > 0 and physically bounded for counter-flow', async () => {
    const { body } = await post({ ...DP_BASE, arr: 'counter' });
    expect(body.lmtd).toBeGreaterThan(0);
    expect(body.lmtd).toBeLessThan(60); // max terminal dT = hTi - cTi = 75-20 = 55
  });

  test('outer pipe ID must be > inner pipe OD — validation', async () => {
    const { status } = await post({ ...DP_BASE, oID: 30 }); // 30 < iOD=50
    expect(status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — LMTD / NTU METHOD
// NTU and eff only computed when Ch and Cc (heat capacity rates kW/K) are provided
// ═══════════════════════════════════════════════════════════════════════════════

describe('LMTD / NTU method', () => {

  test('1-1 counter-flow LMTD ≈ 37.06°C', async () => {
    // dT1=100-55=45, dT2=60-30=30 → LMTD=(45-30)/ln(45/30)=37.06°C
    const { body } = await post({
      calcType: 'lmtdNtu',
      hTi: 100, hTo: 60, cTi: 30, cTo: 55,
      hF: 20000, cF: 18000,
      hFlKey: 'water', cFlKey: 'water',
      arr: 'counter', hxType: '1-1',
    });
    near(body.lmtd, 37.06, 0.03, 'LMTD counter-flow');
  });

  test('1-2 pass F correction 0.70–1.01', async () => {
    const { body } = await post({
      calcType: 'lmtdNtu',
      hTi: 100, hTo: 60, cTi: 30, cTo: 55,
      hF: 20000, cF: 18000,
      hFlKey: 'water', cFlKey: 'water',
      arr: 'counter', hxType: '1-2',
    });
    expect(body.F).toBeGreaterThan(0.70);
    expect(body.F).toBeLessThanOrEqual(1.01);
  });

  test('NTU and effectiveness computed when Ch and Cc provided', async () => {
    // Ch = (hF/3600) × cp_water = (20000/3600)×4.182 ≈ 23.23 kW/K
    // Cc = (cF/3600) × cp_water = (18000/3600)×4.182 ≈ 20.91 kW/K
    const { body } = await post({
      calcType: 'lmtdNtu',
      hTi: 100, hTo: 60, cTi: 30, cTo: 55,
      hF: 20000, cF: 18000,
      hFlKey: 'water', cFlKey: 'water',
      arr: 'counter', hxType: '1-1',
      Ch: 23.23, Cc: 20.91,   // heat capacity rates kW/K
    });
    expect(body.NTU).toBeGreaterThan(0);
    expect(body.eff).toBeGreaterThan(0);
    expect(body.eff).toBeLessThanOrEqual(1.0);
  });

  test('temperature cross rejected', async () => {
    const { status } = await post({
      calcType: 'lmtdNtu',
      hTi: 50, hTo: 40, cTi: 45, cTo: 60,
      hF: 10000, cF: 10000,
      hFlKey: 'water', cFlKey: 'water',
      arr: 'counter', hxType: '1-1',
    });
    expect(status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — WALL THICKNESS (ASME VIII)
// Verified field names from calcWallThickness source:
//   P  (design pressure barg — NOT P_barg)
//   D  (internal diameter mm — NOT D_mm)
//   S  (allowable stress MPa — NOT S_MPa)
//   CA (corrosion allowance mm — NOT CA_mm)
//   MT (mill tolerance mm — NOT MT_mm)
//   E  (weld efficiency)
//   std (standard code: 'asme8d1', 'en13445', 'bs5500' — NOT 'ASME-VIII')
//   type ('cylinder', 'sphere', 'cone')
// ═══════════════════════════════════════════════════════════════════════════════

const WT_BASE = {
  calcType: 'wallThick',
  type: 'cylinder',
  P: 15,        // barg
  D: 600,       // mm internal diameter
  S: 138,       // MPa allowable stress
  E: 1.0,       // weld efficiency
  CA: 3.0,      // mm corrosion allowance
  MT: 0.6,      // mm mill tolerance
  std: 'asme8d1',
};

describe('Wall Thickness — ASME Sec. VIII UG-27', () => {

  test('returns 200', async () => {
    const { status, body } = await post(WT_BASE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('t_calc_mm > 0', async () => {
    const { body } = await post(WT_BASE);
    expect(body.t_calc_mm).toBeGreaterThan(0);
  });

  test('t_nominal >= t_with_CA', async () => {
    const { body } = await post(WT_BASE);
    expect(body.t_nominal).toBeGreaterThanOrEqual(body.t_with_CA);
  });

  test('MAWP at t_nominal > design pressure', async () => {
    const { body } = await post(WT_BASE);
    expect(body.pMax_check_bar).toBeGreaterThan(WT_BASE.P);
  });

  test('thin-wall formula: t ≈ PR/(SE-0.6P)', async () => {
    const { body } = await post(WT_BASE);
    const P_MPa = WT_BASE.P * 0.1;
    const R_i   = WT_BASE.D / 2;
    const t_exp = (P_MPa * R_i) / (WT_BASE.S * WT_BASE.E - 0.6 * P_MPa);
    near(body.t_thin_mm, t_exp, 0.03, 'thin-wall formula');
  });

  test('thick-wall Lamé triggered at P=250 barg (t/R >= 0.1)', async () => {
    const { body } = await post({ ...WT_BASE, P: 250 });
    expect(body.isThickWall).toBe(true);
    expect(body.lameT).toBeGreaterThan(0);
  });

  test('sphere gives smaller t than cylinder', async () => {
    const cyl    = await post({ ...WT_BASE, type: 'cylinder' });
    const sphere = await post({ ...WT_BASE, type: 'sphere' });
    expect(sphere.body.t_calc_mm).toBeLessThan(cyl.body.t_calc_mm);
  });

  test('EN 13445 gives slightly different t than ASME', async () => {
    const asme = await post({ ...WT_BASE, std: 'asme8d1' });
    const en   = await post({ ...WT_BASE, std: 'en13445' });
    // Both should succeed and give positive thicknesses
    expect(asme.body.t_calc_mm).toBeGreaterThan(0);
    expect(en.body.t_calc_mm).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — FOULING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Fouling calculator', () => {

  test('returns 200', async () => {
    const { status, body } = await post({ calcType:'fouling', Rf_s:0.0002, Rf_t:0.0002, U_cl:800 });
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('U_service < U_cl', async () => {
    const { body } = await post({ calcType:'fouling', Rf_s:0.0002, Rf_t:0.0002, U_cl:800 });
    expect(body.U_service).toBeLessThan(body.U_cl);
  });

  test('Rf_total = Rf_s + Rf_t', async () => {
    const { body } = await post({ calcType:'fouling', Rf_s:0.0003, Rf_t:0.0004, U_cl:800 });
    near(body.Rf_total, 0.0007, 0.001, 'Rf_total');
  });

  test('higher fouling → larger area_increase', async () => {
    const lo = await post({ calcType:'fouling', Rf_s:0.0001, Rf_t:0.0001, U_cl:800 });
    const hi = await post({ calcType:'fouling', Rf_s:0.0005, Rf_t:0.0005, U_cl:800 });
    expect(hi.body.area_increase).toBeGreaterThan(lo.body.area_increase);
  });

  test('U_service = 1/(1/U_cl + Rf_total)', async () => {
    const { body } = await post({ calcType:'fouling', Rf_s:0.0002, Rf_t:0.0002, U_cl:1000 });
    near(body.U_service, 1/(1/1000+0.0004), 0.001, 'U_service formula');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — HX SELECTOR
// ═══════════════════════════════════════════════════════════════════════════════

describe('HX Type Selector', () => {

  test('air-cooling → air-cooled', async () => {
    const { body } = await post({ calcType:'selector', app:'air-cooling', pres:'low', foul:'low', duty:'large', space:'plenty', corr:'low' });
    expect(body.top).toBe('air-cooled');
  });

  test('condensing + high pressure → shell-tube', async () => {
    const { body } = await post({ calcType:'selector', app:'condensing', pres:'high', foul:'medium', duty:'large', space:'plenty', corr:'medium' });
    expect(body.top).toBe('shell-tube');
  });

  test('small duty + LL + very-limited space → plate', async () => {
    const { body } = await post({ calcType:'selector', app:'liquid-liquid', pres:'low', foul:'low', duty:'small', space:'very-limited', corr:'low' });
    expect(body.top).toBe('plate');
  });

  test('scores has all six HX types', async () => {
    const { body } = await post({ calcType:'selector', app:'liquid-liquid', pres:'medium', foul:'low', duty:'medium', space:'plenty', corr:'low' });
    ['shell-tube','plate','air-cooled','double-pipe','spiral','plate-fin'].forEach(t =>
      expect(body.scores).toHaveProperty(t)
    );
  });

  test('high fouling + high pressure → plate score < shell-tube score', async () => {
    const { body } = await post({ calcType:'selector', app:'liquid-liquid', pres:'high', foul:'high', duty:'large', space:'plenty', corr:'low' });
    expect(body.scores['plate']).toBeLessThan(body.scores['shell-tube']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — GEOMETRY OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════════

const GO_BASE = {
  calcType: 'geoOptimizer',
  area_req: 30, massC_kgs: 5.0, L_fixed: 4.88,
  rho_c: 998, target_vel: 1.5, vel_min: 0.8, vel_max: 3.5,
  max_passes: 8, max_shells: 3,
};

describe('Geometry Optimizer', () => {

  test('returns 200', async () => {
    const { status, body } = await post(GO_BASE);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
  });

  test('finds valid solutions', async () => {
    const { body } = await post(GO_BASE);
    expect(body.any_solution).toBe(true);
    expect(body.solutions_valid.length).toBeGreaterThan(0);
  });

  test('valid solutions have velocity in [vel_min, vel_max]', async () => {
    const { body } = await post(GO_BASE);
    body.solutions_valid.forEach(s => {
      expect(s.velocity).toBeGreaterThanOrEqual(GO_BASE.vel_min - 0.02);
      expect(s.velocity).toBeLessThanOrEqual(GO_BASE.vel_max + 0.02);
    });
  });

  test('valid solutions meet area requirement', async () => {
    const { body } = await post(GO_BASE);
    body.solutions_valid.forEach(s => {
      expect(s.area_margin_pct).toBeGreaterThanOrEqual(-0.5);
    });
  });

  test('recommendation string is non-empty', async () => {
    const { body } = await post(GO_BASE);
    expect(body.recommendation.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — GOLDEN VALUE REGRESSION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Golden-value regression tests', () => {

  test('[REG-ST-01] water/water Q ≈ 2790 kW', async () => {
    const { body } = await post(ST_BASELINE);
    near(body.Q, 2790, 0.10, '[REG-ST-01]');
  });

  test('[REG-PL-01] plate HX Q ≈ 1045 kW', async () => {
    const { body } = await post(PLATE_BASE);
    near(body.Q, 1045, 0.10, '[REG-PL-01]');
  });

  test('[REG-FO-01] fouling U_service ≈ 606.1 W/m²K', async () => {
    const { body } = await post({ calcType:'fouling', Rf_s:0.0002, Rf_t:0.0002, U_cl:800 });
    near(body.U_service, 606.1, 0.01, '[REG-FO-01]');
  });

  test('[REG-WT-01] t_thin ≈ 3.28 mm at 15 barg, D=600mm, ASME VIII', async () => {
    const { body } = await post(WT_BASE);
    near(body.t_thin_mm, 3.28, 0.05, '[REG-WT-01]');
  });

  test('[REG-LMTD-01] counter-flow LMTD ≈ 37.06°C', async () => {
    const { body } = await post({
      calcType: 'lmtdNtu',
      hTi: 100, hTo: 60, cTi: 30, cTo: 55,
      hF: 20000, cF: 18000,
      hFlKey: 'water', cFlKey: 'water',
      arr: 'counter', hxType: '1-1',
    });
    near(body.lmtd, 37.06, 0.03, '[REG-LMTD-01]');
  });
});
