'use strict';

// Helper: get element by id
function E(id) {
  return document.getElementById(id);
}

// Helper: format number
function fN(v, dp) {
  if (dp === undefined) { dp = 3; }
  if (isNaN(v) || !isFinite(v)) { return '\u2014'; }
  return Number(v).toFixed(dp);
}

// ── FLUID LIBRARY ───────────────────────────────────────────────
// rho20 = density at 20°C (kg/m³)
// beta  = volumetric thermal expansion coefficient (1/°C)
var FLUIDS = [
  // Water & Aqueous
  { name: 'Water (pure)',             rho20: 998.2,   beta: 2.1e-4,  group: 'Water & Aqueous'   },
  { name: 'Seawater (3.5% NaCl)',     rho20: 1025.0,  beta: 2.2e-4,  group: 'Water & Aqueous'   },
  { name: 'Brine (NaCl 20%)',         rho20: 1148.0,  beta: 4.0e-4,  group: 'Water & Aqueous'   },
  { name: 'Glycol-water (50%)',       rho20: 1065.0,  beta: 5.0e-4,  group: 'Water & Aqueous'   },
  // Hydrocarbons
  { name: 'Gasoline',                 rho20: 720.0,   beta: 9.5e-4,  group: 'Hydrocarbons'      },
  { name: 'Kerosene / Jet A-1',       rho20: 800.0,   beta: 9.0e-4,  group: 'Hydrocarbons'      },
  { name: 'Diesel / Gas oil',         rho20: 840.0,   beta: 8.5e-4,  group: 'Hydrocarbons'      },
  { name: 'Crude oil (light)',        rho20: 800.0,   beta: 7.5e-4,  group: 'Hydrocarbons'      },
  { name: 'Crude oil (heavy)',        rho20: 950.0,   beta: 7.0e-4,  group: 'Hydrocarbons'      },
  { name: 'Fuel oil (heavy)',         rho20: 980.0,   beta: 6.0e-4,  group: 'Hydrocarbons'      },
  { name: 'Lubricating oil SAE30',    rho20: 880.0,   beta: 7.2e-4,  group: 'Hydrocarbons'      },
  // Chemicals
  { name: 'Methanol',                 rho20: 791.0,   beta: 1.18e-3, group: 'Chemicals'         },
  { name: 'Ethanol (96%)',            rho20: 789.0,   beta: 1.10e-3, group: 'Chemicals'         },
  { name: 'Acetone',                  rho20: 791.0,   beta: 1.43e-3, group: 'Chemicals'         },
  { name: 'Toluene',                  rho20: 867.0,   beta: 1.08e-3, group: 'Chemicals'         },
  { name: 'Benzene',                  rho20: 879.0,   beta: 1.24e-3, group: 'Chemicals'         },
  { name: 'Glycerol',                 rho20: 1261.0,  beta: 4.8e-4,  group: 'Chemicals'         },
  { name: 'Sulfuric acid (98%)',      rho20: 1840.0,  beta: 5.7e-4,  group: 'Chemicals'         },
  { name: 'HCl solution (32%)',       rho20: 1160.0,  beta: 4.5e-4,  group: 'Chemicals'         },
  { name: 'Caustic soda (50%)',       rho20: 1525.0,  beta: 5.2e-4,  group: 'Chemicals'         },
  { name: 'Phosphoric acid (85%)',    rho20: 1685.0,  beta: 5.0e-4,  group: 'Chemicals'         },
  { name: 'Methylene chloride',       rho20: 1325.0,  beta: 1.37e-3, group: 'Chemicals'         },
  // Metal & Specialty
  { name: 'Mercury',                  rho20: 13546.0, beta: 1.82e-4, group: 'Metal & Specialty' },
  { name: 'Molten salt (nitrate)',    rho20: 1899.0,  beta: 5.0e-4,  group: 'Metal & Specialty' },
  { name: 'Liquid sodium (200\u00b0C)', rho20: 927.0, beta: 2.5e-4,  group: 'Metal & Specialty' },
  // Cryogenic
  { name: 'Liquid nitrogen (LN\u2082)',      rho20: 808.0,  beta: 5.5e-3,  group: 'Cryogenic' },
  { name: 'Liquid oxygen (LOX)',             rho20: 1141.0, beta: 4.0e-3,  group: 'Cryogenic' },
  { name: 'Liquid ammonia',                  rho20: 682.0,  beta: 2.45e-3, group: 'Cryogenic' },
  { name: 'Liquid CO\u2082 (pressurised)',   rho20: 770.0,  beta: 5.0e-3,  group: 'Cryogenic' },
  { name: 'Liquid hydrogen (LH\u2082)',      rho20: 70.8,   beta: 1.0e-2,  group: 'Cryogenic' },
  { name: 'Propane (liquid)',                rho20: 510.0,  beta: 2.8e-3,  group: 'Cryogenic' }
];

// Comparison reference fluids
var COMPARE = [
  { name: 'Water',              rho: 998.2   },
  { name: 'Seawater',          rho: 1025.0  },
  { name: 'Gasoline',          rho: 720.0   },
  { name: 'Diesel',            rho: 840.0   },
  { name: 'Crude (light)',     rho: 800.0   },
  { name: 'Sulfuric acid 98%', rho: 1840.0  },
  { name: 'Mercury',           rho: 13546.0 },
  { name: 'Methanol',          rho: 791.0   }
];

// Head units
var HEAD_UNITS = [
  { id: 'm',  label: 'Metres (m)',       toM: 1        },
  { id: 'mm', label: 'Millimetres (mm)', toM: 0.001    },
  { id: 'cm', label: 'Centimetres (cm)', toM: 0.01     },
  { id: 'km', label: 'Kilometres (km)',  toM: 1000     },
  { id: 'ft', label: 'Feet (ft)',        toM: 0.3048   },
  { id: 'in', label: 'Inches (in)',      toM: 0.0254   },
  { id: 'yd', label: 'Yards (yd)',       toM: 0.9144   }
];

// Pressure units
var PRESSURE_UNITS = [
  { id: 'Pa',    label: 'Pascal (Pa)',                       fromPa: 1                   },
  { id: 'kPa',   label: 'Kilopascal (kPa)',                  fromPa: 1e-3                },
  { id: 'MPa',   label: 'Megapascal (MPa)',                  fromPa: 1e-6                },
  { id: 'bar',   label: 'Bar (bar)',                         fromPa: 1e-5                },
  { id: 'mbar',  label: 'Millibar (mbar)',                   fromPa: 0.01                },
  { id: 'psi',   label: 'PSI (psi)',                         fromPa: 1 / 6894.757        },
  { id: 'atm',   label: 'Atmosphere (atm)',                  fromPa: 1 / 101325          },
  { id: 'mmHg',  label: 'mmHg / Torr',                      fromPa: 1 / 133.322         },
  { id: 'inHg',  label: 'Inches Hg (inHg)',                 fromPa: 1 / 3386.39         },
  { id: 'mH2O',  label: 'Metres H\u2082O (mH\u2082O)',      fromPa: 1 / 9810            },
  { id: 'ftH2O', label: 'Feet H\u2082O (ftH\u2082O)',       fromPa: 1 / (9810 * 0.3048) }
];

// ── App State ─────────────────────────────────────────────────
var MODE = 'hp';         // 'hp' = head to pressure, 'ph' = pressure to head
var tempUnitCur = 'C';   // current temperature unit

// ── Initialise ────────────────────────────────────────────────
function init() {
  buildFluidDropdown();
  updateUnitDrop();
  onFluidChange();
  updateSlider();
}

function buildFluidDropdown() {
  var sel = E('fluidSel');
  var lastGroup = '';

  for (var i = 0; i < FLUIDS.length; i++) {
    var fluid = FLUIDS[i];

    if (fluid.group !== lastGroup) {
      var og = document.createElement('optgroup');
      og.label = fluid.group;
      sel.appendChild(og);
      lastGroup = fluid.group;
    }

    var opt = document.createElement('option');
    opt.value = i;
    opt.textContent = fluid.name;
    sel.appendChild(opt);
  }
}

// ── Mode Toggle ───────────────────────────────────────────────
function setMode(m) {
  MODE = m;
  E('btnHP').classList.toggle('on', m === 'hp');
  E('btnPH').classList.toggle('on', m === 'ph');
  updateUnitDrop();
  calc();
}

// ── Unit Dropdown ─────────────────────────────────────────────
function updateUnitDrop() {
  var sel = E('inUnit');
  if (!sel) { return; }
  sel.innerHTML = '';

  var units = (MODE === 'hp') ? HEAD_UNITS : PRESSURE_UNITS;

  for (var i = 0; i < units.length; i++) {
    var opt = document.createElement('option');
    opt.value = units[i].id;
    opt.textContent = units[i].label;
    sel.appendChild(opt);
  }

  sel.value = (MODE === 'hp') ? 'm' : 'bar';
  E('inPill').textContent = (MODE === 'hp') ? 'm' : 'bar';
  E('inputLbl').textContent = (MODE === 'hp') ? 'Fluid Head (H)' : 'Pressure (P)';
  E('inputHint').textContent = (MODE === 'hp')
    ? 'Enter the fluid column height in your chosen unit.'
    : 'Enter the pressure value to convert to fluid head.';
}

function onUnitChange() {
  E('inPill').textContent = E('inUnit').value;
  calc();
}

// ── Fluid Change ──────────────────────────────────────────────
function onFluidChange() {
  updateMeta();
  calc();
}

// ── Density ───────────────────────────────────────────────────
function getRho() {
  // Manual override
  var ov = parseFloat(E('rhoOv').value);
  if (!isNaN(ov) && ov > 0) {
    return ov;
  }

  // Temperature-corrected from fluid library
  var idx = parseInt(E('fluidSel').value) || 0;
  var fluid = FLUIDS[idx];
  var T = getTempC();
  var rho = fluid.rho20 * (1 - fluid.beta * (T - 20));
  return Math.max(1, rho);
}

function getTempC() {
  var v = parseFloat(E('tempInp').value);
  if (isNaN(v)) { v = 20; }
  if (tempUnitCur === 'C') { return v; }
  if (tempUnitCur === 'F') { return (v - 32) * 5 / 9; }
  return v - 273.15;   // Kelvin
}

// ── Fluid Meta Chips ──────────────────────────────────────────
function updateMeta() {
  var metaEl = E('fluidMeta');
  if (!metaEl) { return; }
  var rho = getRho();
  var g = parseFloat(E('gravInp').value) || 9.81;
  var sg = rho / 1000;
  var mPerBar = 1e5 / (rho * g);

  metaEl.innerHTML =
    '<div class="fmc"><span class="lbl">Density \u03c1</span><span class="val">' +
    fN(rho, 1) + ' kg/m\u00b3</span></div>' +
    '<div class="fmc"><span class="lbl">Spec. Gravity</span><span class="val">' +
    fN(sg, 4) + '</span></div>' +
    '<div class="fmc"><span class="lbl">Temp (T)</span><span class="val">' +
    fN(getTempC(), 1) + ' \u00b0C</span></div>' +
    '<div class="fmc"><span class="lbl">m head / bar</span><span class="val">' +
    fN(mPerBar, 3) + ' m</span></div>';
}

// ── SG Override ───────────────────────────────────────────────
function onSGChange() {
  var sg = parseFloat(E('sgOv').value);
  if (!isNaN(sg) && sg > 0) {
    E('rhoOv').value = fN(sg * 1000, 1);
  } else {
    E('rhoOv').value = '';
  }
  updateMeta();
  calc();
}

// ── Temperature ───────────────────────────────────────────────
function onTempInput() {
  updateSlider();
  updateMeta();
  calc();
}

function onTempSlider() {
  var v = parseFloat(E('tempSl').value);
  var displayVal = v;
  if (tempUnitCur === 'F') { displayVal = v * 9 / 5 + 32; }
  if (tempUnitCur === 'K') { displayVal = v + 273.15; }
  E('tempInp').value = fN(displayVal, 0);
  E('tempBadge').textContent = fN(v, 0) + '\u00b0C';
  E('tempSl').style.setProperty('--pct', (v / 150 * 100).toFixed(1) + '%');
  updateMeta();
  calc();
}

function onTempUnitChange() {
  tempUnitCur = E('tempUnit').value;
  var newVal = 20;
  if (tempUnitCur === 'F') { newVal = 68; }
  if (tempUnitCur === 'K') { newVal = 293.15; }
  E('tempInp').value = fN(newVal, 1);
  updateSlider();
  updateMeta();
  calc();
}

function updateSlider() {
  var Tc = Math.max(0, Math.min(150, getTempC()));
  E('tempSl').value = Tc;
  E('tempBadge').textContent = fN(Tc, 0) + '\u00b0C';
  E('tempSl').style.setProperty('--pct', (Tc / 150 * 100).toFixed(1) + '%');
}

// ── Main Calculation ──────────────────────────────────────────
function calc() {
  var valEl = E('valInp');
  if (!valEl) { return; }

  var val = parseFloat(valEl.value);
  if (isNaN(val) || val < 0) { return; }

  var rho = getRho();
  var g   = parseFloat(E('gravInp').value) || 9.81;
  var unitId = E('inUnit').value;

  updateMeta();

  var H_m, P_Pa, i;

  if (MODE === 'hp') {
    var headUnit = null;
    for (i = 0; i < HEAD_UNITS.length; i++) {
      if (HEAD_UNITS[i].id === unitId) { headUnit = HEAD_UNITS[i]; break; }
    }
    H_m  = val * (headUnit ? headUnit.toM : 1);
    P_Pa = rho * g * H_m;
  } else {
    var pressUnit = null;
    for (i = 0; i < PRESSURE_UNITS.length; i++) {
      if (PRESSURE_UNITS[i].id === unitId) { pressUnit = PRESSURE_UNITS[i]; break; }
    }
    P_Pa = val / (pressUnit ? pressUnit.fromPa : 1);
    H_m  = P_Pa / (rho * g);
  }

  showResults(H_m, P_Pa, rho, g);
}

// ── Display Results ───────────────────────────────────────────
function showResults(H_m, P_Pa, rho, g) {
  var panel       = E('resultsPanel');
  var placeholder = E('placeholder');
  var grid        = E('unitsGrid');
  if (!panel || !grid) { return; }

  panel.classList.add('show');
  if (placeholder) { placeholder.style.display = 'none'; }

  var fluidIdx = parseInt(E('fluidSel').value) || 0;
  var fluidName = FLUIDS[fluidIdx].name;
  var Tc = fN(getTempC(), 1);

  if (MODE === 'hp') {
    E('brLbl').textContent = 'RESULTING PRESSURE';
    E('brVal').textContent = fN(P_Pa / 1e5, 5);
    E('brUnit').textContent = 'bar  (differential pressure from fluid column)';
    E('brFormula').innerHTML =
      '<span class="hi">P = \u03c1 \u00d7 g \u00d7 H</span><br>' +
      'P = ' + fN(rho, 1) + ' kg/m\u00b3 \u00d7 ' + fN(g, 3) + ' m/s\u00b2 \u00d7 ' + fN(H_m, 4) + ' m<br>' +
      'P = <span class="eq">' + fN(P_Pa, 1) + ' Pa = ' + fN(P_Pa / 1e5, 5) + ' bar = ' +
      fN(P_Pa / 6894.757, 4) + ' psi = ' + fN(P_Pa / 1000, 3) + ' kPa</span><br>' +
      'Fluid: ' + fluidName + '  \u00b7  T = ' + Tc + '\u00b0C  \u00b7  \u03c1 = ' + fN(rho, 1) + ' kg/m\u00b3';
  } else {
    E('brLbl').textContent = 'RESULTING HEAD';
    E('brVal').textContent = fN(H_m, 4);
    E('brUnit').textContent = 'metres of fluid column';
    E('brFormula').innerHTML =
      '<span class="hi">H = P / (\u03c1 \u00d7 g)</span><br>' +
      'H = ' + fN(P_Pa, 1) + ' Pa \u00f7 (' + fN(rho, 1) + ' \u00d7 ' + fN(g, 3) + ')<br>' +
      'H = <span class="eq">' + fN(H_m, 5) + ' m = ' + fN(H_m / 0.3048, 4) + ' ft = ' +
      fN(H_m * 1000, 2) + ' mm</span><br>' +
      'Fluid: ' + fluidName + '  \u00b7  T = ' + Tc + '\u00b0C  \u00b7  \u03c1 = ' + fN(rho, 1) + ' kg/m\u00b3';
  }

  // Unit conversion grid
  var pressureOuts = [
    { lbl: 'Pascal',      unit: 'Pa',              v: P_Pa,                    p: false },
    { lbl: 'Kilopascal',  unit: 'kPa',             v: P_Pa / 1e3,              p: false },
    { lbl: 'Bar',         unit: 'bar',             v: P_Pa / 1e5,              p: true  },
    { lbl: 'Millibar',    unit: 'mbar',            v: P_Pa * 0.01,             p: false },
    { lbl: 'PSI',         unit: 'psi',             v: P_Pa / 6894.757,         p: true  },
    { lbl: 'Atmosphere',  unit: 'atm',             v: P_Pa / 101325,           p: false },
    { lbl: 'mmHg',        unit: 'mmHg',            v: P_Pa / 133.322,          p: false },
    { lbl: 'm H\u2082O',  unit: 'mH\u2082O',       v: P_Pa / (998.2 * 9.81),  p: false }
  ];

  var headOuts = [
    { lbl: 'Metres',      unit: 'm',    v: H_m,            p: true  },
    { lbl: 'Millimetres', unit: 'mm',   v: H_m * 1000,     p: false },
    { lbl: 'Centimetres', unit: 'cm',   v: H_m * 100,      p: false },
    { lbl: 'Feet',        unit: 'ft',   v: H_m / 0.3048,   p: true  },
    { lbl: 'Inches',      unit: 'in',   v: H_m / 0.0254,   p: false },
    { lbl: 'Kilometres',  unit: 'km',   v: H_m / 1000,     p: false },
    { lbl: 'Yards',       unit: 'yd',   v: H_m / 0.9144,   p: false },
    { lbl: 'Miles',       unit: 'mi',   v: H_m / 1609.34,  p: false }
  ];

  var outputs = (MODE === 'hp') ? pressureOuts : headOuts;
  grid.innerHTML = '';

  for (var k = 0; k < outputs.length; k++) {
    var o = outputs[k];
    var absV = Math.abs(o.v);
    var dp = absV > 1000 ? 1 : absV > 10 ? 3 : absV > 0.01 ? 5 : 7;
    var d = document.createElement('div');
    d.className = 'uc' + (o.p ? ' p' : '');
    d.title = 'Click to copy';
    (function(val, unit, places) {
      d.onclick = function() { copyVal(fN(val, places) + ' ' + unit); };
    })(o.v, o.unit, dp);
    d.innerHTML =
      '<div class="uc-lbl">' + o.lbl + '</div>' +
      '<div class="uc-val">' + fN(o.v, dp) + '</div>' +
      '<div class="uc-unit">' + o.unit + '</div>';
    grid.appendChild(d);
  }


}

// ── Copy to Clipboard ─────────────────────────────────────────
function copyVal(txt) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function() {
      showToast('Copied: ' + txt);
    }).catch(function() {
      fallbackCopy(txt);
    });
  } else {
    fallbackCopy(txt);
  }
}

function fallbackCopy(txt) {
  var ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('Copied: ' + txt); } catch(e) {}
  document.body.removeChild(ta);
}

function showToast(msg) {
  var t = E('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 2200);
}

// ── FAQ Accordion ─────────────────────────────────────────────
function toggleFaq(btn) {
  var item = btn.closest('.faq-item');
  var wasOpen = item.classList.contains('open');
  var allOpen = document.querySelectorAll('.faq-item.open');
  for (var i = 0; i < allOpen.length; i++) {
    allOpen[i].classList.remove('open');
  }
  if (!wasOpen) {
    item.classList.add('open');
  }
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
