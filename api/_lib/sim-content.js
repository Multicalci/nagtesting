// ============================================================================
// REPO PATH: api/_lib/sim-content.js
// ============================================================================
// multicalci.com — flowsheet simulator content served by the API instead of
// being shipped inside the page (front-end protection, Nov 2026):
//   EXAMPLES  the worked flowsheets (inputs only — the engine solves them)
//   PRESETS   the typical-stream compositions of the feed menu
// GET ?module=sim-examples          → the gallery list (no flowsheet inside)
// GET ?module=sim-example&id=<id>   → one example: {id, label, model, note}
// GET ?module=sim-presets           → the preset list
// Moved verbatim from the page; the page fetches them when it needs them.
// (c) multicalci.com — all rights reserved
// ============================================================================

'use strict';

export const SIM_CONTENT_VERSION = 'sim-content 1.0.0';

const sp = (T, Tu, P, Pu, flow, flowU, basis, comps) => ({
  T: { v: T, u: Tu }, P: { v: P, u: Pu }, flow: { v: flow, u: flowU }, basis,
  comps: Object.entries(comps).map(([key, a]) => ({ key, a })),
});
const EXAMPLES = [
  {
    id: 'steam-turbine', label: 'Extraction steam turbine + condenser (IAPWS-IF97)',
    desc: '100 bar / 500 °C steam · 10 bar process extraction · condensing exhaust · condensate pump',
    model: {
      pkg: { model: 'steam' },
      blocks: [
        { id: 'b1', name: 'ST-101', type: 'xturbine', x: 200, y: 160, nIn: 1, nOut: 2, params: {
          P_extract_bar: 10, xspec: 'kg', extraction_kg_h: 20000, P_out_bar: 0.1, efficiency_hp: 0.82, efficiency_lp: 0.78 }, pu: {} },
        { id: 'b2', name: 'E-101', type: 'heater', x: 390, y: 168, nIn: 1, nOut: 1, params: { spec: 'VF', vapour_fraction: 0 }, pu: {} },
        { id: 'b3', name: 'P-101', type: 'rotating', x: 560, y: 168, nIn: 1, nOut: 1, params: { machine: 'pump', P_out_bar: 110, efficiency: 0.75 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'HP STEAM', from: null, to: { b: 'b1', p: 0 }, spec: sp(500, '°C', 100, 'bar(a)', 100000, 'kg/h', 'mole%', { H2O: 100 }) },
        { id: 's2', name: 'PROCESS STEAM', from: { b: 'b1', p: 0 }, to: null },
        { id: 's3', name: 'EXHAUST', from: { b: 'b1', p: 1 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'CONDENSATE', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'BFW', from: { b: 'b3', p: 0 }, to: null },
      ],
      seq: { b: 3, s: 5 },
    },
    note: 'Steam / water (IAPWS-IF97) method. ST-101 expands 100 t/h of 100 bar / 500 °C steam, passes 20 t/h out at 10 bar and condenses the rest at 0.1 bar; E-101 is the condenser (outlet vapour fraction 0) and P-101 the condensate pump. Open ST-101 for the power of each section, exhaust quality and steam rate. Swap ST-101 for a pump / compressor / turbine block to back-calculate an efficiency from a measured exhaust temperature (Known value → Outlet temperature).',
  },
  {
    id: 'turbine-drive', label: 'Steam-turbine-driven compressor with heat recovery (energy streams)',
    desc: 'Turbine power → syngas compressor (W1) · aftercooler heat → boiler feed water (Q1)',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'ST-1', type: 'rotating', x: 180, y: 110, nIn: 1, nOut: 1, params: { machine: 'turbine', P_out_bar: 4, mspec: 'efficiency', efficiency: 0.75, mode: 'isentropic', pkg: 'steam' }, pu: {} },
        { id: 'b2', name: 'K-1', type: 'rotating', x: 420, y: 300, nIn: 1, nOut: 1, params: { machine: 'compressor', perf: 'point', P_out_bar: 60, mspec: 'power', efficiency: 0.78, mode: 'isentropic' }, pu: {} },
        { id: 'b3', name: 'E-1', type: 'heater', x: 600, y: 302, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 313.15 }, pu: {} },
        { id: 'b4', name: 'E-2', type: 'heater', x: 600, y: 500, nIn: 1, nOut: 1, params: { spec: 'Q', pkg: 'steam' }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'HP STEAM', from: null, to: { b: 'b1', p: 0 }, spec: sp(400, '°C', 40, 'bar(a)', 20000, 'kg/h', 'mole%', { H2O: 100 }) },
        { id: 's2', name: 'LP STEAM', from: { b: 'b1', p: 0 }, to: null },
        { id: 's3', name: 'SYNGAS', from: null, to: { b: 'b2', p: 0 }, spec: sp(40, '°C', 25, 'bar(a)', 2350, 'kmol/h', 'mole%', { H2: 74, N2: 25, CH4: 1 }) },
        { id: 's4', name: 'S4', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'HP SYNGAS', from: { b: 'b3', p: 0 }, to: null },
        { id: 's6', name: 'BFW', from: null, to: { b: 'b4', p: 0 }, spec: sp(105, '°C', 45, 'bar(a)', 15000, 'kg/h', 'mole%', { H2O: 100 }) },
        { id: 's7', name: 'HOT BFW', from: { b: 'b4', p: 0 }, to: null },
      ],
      estreams: [
        { id: 'e1', name: 'W1', from: 'b1', to: 'b2', eff: 0.98 },
        { id: 'e2', name: 'Q1', from: 'b3', to: 'b4' },
      ],
      seq: { b: 4, s: 7, e: 2 },
    },
    note: 'Energy streams. ST-1 expands 20 t/h of 40 bar / 400 °C steam to 4 bar on the Steam / water (IAPWS-IF97) method; its shaft power, less 2 % mechanical loss, drives the syngas compressor K-1 through energy stream W1 — K-1 is set to “Shaft power”, so its discharge temperature and isentropic efficiency follow from the power it receives. The heat the aftercooler E-1 removes reaches the boiler feed water in E-2 through energy stream Q1, which sets E-2’s duty. Change the steam flow and watch the compressor efficiency: a design spec on it (varying the steam flow) matches the turbine to the compressor. Drag from any unit’s ◆ energy port to make energy streams of your own.',
  },
  {
    id: 'knockout', label: 'Gas cooling & condensate knock-out',
    desc: 'Mixer → cooler → flash drum on Peng–Robinson · good first example',
    model: {
      blocks: [
        { id: 'b1', name: 'M1', type: 'mixer', x: 200, y: 170, nIn: 2, nOut: 1, params: { mode: 'adiabatic' }, pu: {} },
        { id: 'b2', name: 'E1', type: 'heater', x: 360, y: 180, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 313.15 }, pu: {} },
        { id: 'b3', name: 'F1', type: 'flash', x: 520, y: 160, nIn: 1, nOut: 2, params: { T_K: 313.15, P_bar: 4.8 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'S1', from: null, to: { b: 'b1', p: 0 }, spec: sp(150, '°C', 5, 'bar(a)', 100, 'kmol/h', 'mole%', { N2: 75, H2O: 20, CO2: 5 }) },
        { id: 's2', name: 'S2', from: null, to: { b: 'b1', p: 1 }, spec: sp(25, '°C', 5, 'bar(a)', 20, 'kmol/h', 'mole%', { N2: 100 }) },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'S4', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'GAS', from: { b: 'b3', p: 0 }, to: null },
        { id: 's6', name: 'COND', from: { b: 'b3', p: 1 }, to: null },
      ],
      pkg: { model: 'pr' },   // ROUND 14b: one phase calculation through every unit (classic heaters put each component wholly in one phase)
      seq: { b: 3, s: 6 },
    },
  },
  {
    id: 'ammonia-front-end', label: 'Ammonia front end (syngas train)',
    desc: 'Primary + secondary reformer → HTS → LTS → CO₂ removal → methanator',
    model: {
      v: 2, pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: '101-B', type: 'smr', x: 100, y: 150, nIn: 1, nOut: 1, params: { T_out_K: 1073.15, P_out_bar: 30 }, pu: {} },
        { id: 'b2', name: '103-D', type: 'smr2', x: 300, y: 150, nIn: 2, nOut: 1, params: { P_out_bar: 30 }, pu: {} },
        { id: 'b3', name: 'WHB', type: 'heater', x: 460, y: 210, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 633.15 }, pu: {} },
        { id: 'b4', name: 'HTS', type: 'shift', x: 620, y: 170, nIn: 1, nOut: 1, params: { preset: 'hts', mode: 'adiabatic' }, pu: {} },
        { id: 'b5', name: 'E2', type: 'heater', x: 780, y: 210, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 483.15 }, pu: {} },
        { id: 'b6', name: 'LTS', type: 'shift', x: 940, y: 170, nIn: 1, nOut: 1, params: { preset: 'lts', mode: 'adiabatic' }, pu: {} },
        { id: 'b7', name: 'CO2-R', type: 'sep', x: 1100, y: 190, nIn: 1, nOut: 2, params: { splits: [{ key: 'CO2', f: 1 }] }, pu: {} },
        { id: 'b8', name: 'E3', type: 'heater', x: 1260, y: 230, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 573.15 }, pu: {} },
        { id: 'b9', name: 'METH', type: 'methanator', x: 1420, y: 190, nIn: 1, nOut: 1, params: { mode: 'adiabatic' }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'NG+STM', from: null, to: { b: 'b1', p: 0 },
          spec: sp(800, '°C', 30, 'bar(a)', null, 'kmol/h', 'kmol/h', { CH4: 0.9, C2H6: 0.06, C3H8: 0.03, nC4H10: 0.01, H2O: 3.45 }) },
        { id: 's2', name: 'AIR', from: null, to: { b: 'b2', p: 1 },
          spec: sp(550, '°C', 30, 'bar(a)', null, 'kmol/h', 'kmol/h', { O2: 0.327663, N2: 1.217034, Ar: 0.015603 }) },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'S4', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b3', p: 0 }, to: { b: 'b4', p: 0 } },
        { id: 's6', name: 'S6', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 0 } },
        { id: 's7', name: 'S7', from: { b: 'b5', p: 0 }, to: { b: 'b6', p: 0 } },
        { id: 's8', name: 'S8', from: { b: 'b6', p: 0 }, to: { b: 'b7', p: 0 } },
        { id: 's9', name: 'CO2', from: { b: 'b7', p: 0 }, to: null },
        { id: 's10', name: 'S10', from: { b: 'b7', p: 1 }, to: { b: 'b8', p: 0 } },
        { id: 's11', name: 'S11', from: { b: 'b8', p: 0 }, to: { b: 'b9', p: 0 } },
        { id: 's12', name: 'SYNGAS', from: { b: 'b9', p: 0 }, to: null },
      ],
      specs: [{ id: 'd1', name: 'H₂/N₂ = 3 by process air', active: true,
        vary: { kind: 'feed_flow', stream: 's2', lo: 20, hi: 90 },
        target: { stream: 's12', metric: 'ratio', num: 'H2', den: 'N2' }, value: 3 }],
      seq: { b: 9, s: 12 },
    },
    note: 'Basis 1 kmol/h dry natural gas at steam/carbon 3.0, solved on Peng–Robinson: reformers, shift and methanator use databank equilibrium constants with fugacity coefficients, and every duty is on one enthalpy basis. A design spec meters the process air so SYNGAS leaves at H₂/N₂ = 3 — see Specs.',
  },
  {
    id: 'shift-recycle', label: 'Shift reactor with condensate recycle',
    desc: 'Recycle loop: mixer → reactor → cooler → flash → splitter → back',
    model: {
      blocks: [
        { id: 'b1', name: 'M1', type: 'mixer', x: 180, y: 160, nIn: 3, nOut: 1, params: { mode: 'adiabatic' }, pu: {} },
        { id: 'b2', name: 'R1', type: 'reactor', x: 320, y: 150, nIn: 1, nOut: 1, params: {
          mode: 'adiabatic',
          reactions: [{ stoich: [{ key: 'CO', nu: -1 }, { key: 'H2O', nu: -1 }, { key: 'CO2', nu: 1 }, { key: 'H2', nu: 1 }], limiting: 'CO', conversion: 0.9 }],
        }, pu: {} },
        { id: 'b3', name: 'E1', type: 'heater', x: 470, y: 190, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 313.15 }, pu: {} },
        { id: 'b4', name: 'F1', type: 'flash', x: 610, y: 160, nIn: 1, nOut: 2, params: { T_K: 313.15, P_bar: 29 }, pu: {} },
        { id: 'b5', name: 'SP1', type: 'splitter', x: 760, y: 300, nIn: 1, nOut: 2, params: { fractions: [0.5, 0.5] }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'SYNGAS', from: null, to: { b: 'b1', p: 0 }, spec: sp(220, '°C', 30, 'bar(a)', 100, 'kmol/h', 'mole%', { H2: 45, CO: 15, CO2: 10, N2: 30 }) },
        { id: 's2', name: 'STEAM', from: null, to: { b: 'b1', p: 1 }, spec: sp(250, '°C', 30, 'bar(a)', 25, 'kmol/h', 'mole%', { H2O: 100 }) },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'S4', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b3', p: 0 }, to: { b: 'b4', p: 0 } },
        { id: 's6', name: 'GAS', from: { b: 'b4', p: 0 }, to: null },
        { id: 's7', name: 'S7', from: { b: 'b4', p: 1 }, to: { b: 'b5', p: 0 } },
        { id: 's8', name: 'RCY', from: { b: 'b5', p: 0 }, to: { b: 'b1', p: 2 } },
        { id: 's9', name: 'PURGE', from: { b: 'b5', p: 1 }, to: null },
      ],
      pkg: { model: 'pr' },   // ROUND 14b: one phase calculation through every unit (classic heaters put each component wholly in one phase)
      seq: { b: 5, s: 9 },
    },
    note: 'Half the condensate is recycled to the mixer. RCY is the tear stream; the solver converges it in a handful of iterations.',
  },
  {
    id: 'nh3-separator', label: 'Ammonia loop separator & let-down (Peng–Robinson)',
    desc: 'PR flash predicts dissolved H₂/N₂ and the let-down gas',
    model: {
      blocks: [
        { id: 'b1', name: 'SEP', type: 'flash', x: 260, y: 150, nIn: 1, nOut: 2, params: { T_K: 253.15, P_bar: 140 }, pu: {} },
        { id: 'b2', name: 'LV', type: 'valve', x: 420, y: 330, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 20 }, pu: {} },
        { id: 'b3', name: 'LDD', type: 'flash', x: 580, y: 290, nIn: 1, nOut: 2, params: { T_K: 253.15, P_bar: 20 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'LOOP GAS', from: null, to: { b: 'b1', p: 0 }, spec: sp(-20, '°C', 140, 'bar(a)', 1000, 'kmol/h', 'mole%', { H2: 60, N2: 20, NH3: 17, CH4: 2, Ar: 1 }) },
        { id: 's2', name: 'RECYCLE', from: { b: 'b1', p: 0 }, to: null },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 1 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'S4', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'LETDOWN GAS', from: { b: 'b3', p: 0 }, to: null },
        { id: 's6', name: 'NH3 PRODUCT', from: { b: 'b3', p: 1 }, to: null },
      ],
      pkg: { model: 'pr' },   // ROUND 14b: one phase calculation through every unit (classic heaters put each component wholly in one phase)
      seq: { b: 3, s: 6 },
    },
    note: 'Both drums use Peng–Robinson — set SEP’s property method to Ideal (unit panel → Property method) and re-run to see the dissolved gases and the let-down gas disappear.',
  },
  {
    id: 'bt-column', label: 'Benzene / toluene column (rigorous, Peng–Robinson)',
    desc: 'Preheater to bubble point → 15-stage column · design spec + sensitivity',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'E-101', type: 'heater', x: 170, y: 214, nIn: 1, nOut: 1, params: { spec: 'VF', vapour_fraction: 0, P_out_bar: 1.3 }, pu: {} },
        { id: 'b2', name: 'C-101', type: 'rcol', x: 360, y: 140, nIn: 1, nOut: 2, params: {
          stages: 15, condenser: 'total', reboiler: 'kettle', feed_stages: [8], P_top_bar: 1.05, dp_stage_bar: 0.005,
          specs: [{ type: 'reflux_ratio', value: 2.5 }, { type: 'distillate_rate', value: 49 }], side_draws: [] }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'FEED', from: null, to: { b: 'b1', p: 0 }, spec: sp(30, '°C', 1.3, 'bar(a)', 100, 'kmol/h', 'mole%', { benzene: 50, toluene: 50 }) },
        { id: 's2', name: 'S2', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'BENZENE', from: { b: 'b2', p: 0 }, to: null },
        { id: 's4', name: 'TOLUENE', from: { b: 'b2', p: 1 }, to: null },
      ],
      specs: [{ id: 'd1', name: '99 % benzene overhead', active: true,
        vary: { kind: 'param', block: 'b2', path: 'specs.0.value', lo: 1.2, hi: 8 },
        target: { stream: 's3', metric: 'mole_frac', key: 'benzene' }, value: 0.99 }],
      sens: { active: true, vary: { kind: 'param', block: 'b2', path: 'specs.1.value' }, from: 46, to: 49.5, points: 5,
        outputs: [{ block: 'b2', metric: 'detail', path: 'reflux_ratio' }, { block: 'b2', metric: 'detail', path: 'reboiler_duty_kW' },
          { stream: 's4', metric: 'mole_frac', key: 'benzene' }] },
      seq: { b: 2, s: 4 },
    },
    note: 'Peng–Robinson throughout. The heater brings the feed to its bubble point (vapour fraction 0); the column is solved by Naphtali–Sandholm Newton. A design spec adjusts the reflux ratio for 99 mol % benzene overhead, and the sensitivity study (Sensitivity tab) shows the reflux and reboiler duty needed as more distillate is drawn.',
  },
  {
    id: 'gas-dewpoint', label: 'Gas dew-point control — LTS (Peng–Robinson)',
    desc: 'Gas/gas exchanger + chiller + low-temperature separator + NGL let-down',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'E-101', type: 'heat-exchanger', x: 170, y: 170, nIn: 2, nOut: 2, params: { xmode: 'hot_T', hot_T_out_K: 273.15 }, pu: {} },
        { id: 'b2', name: 'E-102', type: 'heater', x: 350, y: 168, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 253.15 }, pu: {} },
        { id: 'b3', name: 'V-101', type: 'flash', x: 500, y: 150, nIn: 1, nOut: 2, params: { fmode: 'PQ', duty_kW: 0 }, pu: {} },
        { id: 'b4', name: 'LV-1', type: 'valve', x: 620, y: 330, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 12 }, pu: {} },
        { id: 'b5', name: 'V-102', type: 'flash', x: 760, y: 290, nIn: 1, nOut: 2, params: { fmode: 'PQ', duty_kW: 0 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'FEED GAS', from: null, to: { b: 'b1', p: 0 }, spec: sp(40, '°C', 70, 'bar(a)', 1000, 'kmol/h', 'mole%',
          { N2: 1, CO2: 1.5, CH4: 84, C2H6: 6.5, C3H8: 4, isobutane: 1, nC4H10: 1.2, isopentane: 0.3, 'n-pentane': 0.3, nC6H14: 0.2 }) },
        { id: 's2', name: 'S2', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'S3', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's4', name: 'COLD GAS', from: { b: 'b3', p: 0 }, to: { b: 'b1', p: 1 }, spec: sp(-20, '°C', 70, 'bar(a)', 960, 'kmol/h', 'mole%',
          { N2: 1, CO2: 1.5, CH4: 87, C2H6: 6.5, C3H8: 3.2, isobutane: 0.5, nC4H10: 0.3 }) },
        { id: 's5', name: 'SALES GAS', from: { b: 'b1', p: 1 }, to: null },
        { id: 's6', name: 'S6', from: { b: 'b3', p: 1 }, to: { b: 'b4', p: 0 } },
        { id: 's7', name: 'S7', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 0 } },
        { id: 's8', name: 'FLASH GAS', from: { b: 'b5', p: 0 }, to: null },
        { id: 's9', name: 'NGL', from: { b: 'b5', p: 1 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b2', path: 'T_out_K' }, from: 243.15, to: 268.15, points: 6,
        outputs: [{ stream: 's9', metric: 'molar_flow_kmol_h' }, { stream: 's5', metric: 'mole_frac', key: 'C3H8' }, { block: 'b2', metric: 'Q_kW' }] },
      seq: { b: 5, s: 9 },
    },
    note: 'The cold separator gas returns through the gas/gas exchanger — an information recycle the server tears at COLD GAS (which carries an initial estimate) and converges. Rigorous flashes predict the NGL and the let-down flash gas; the sensitivity study steps the chiller outlet from −30 to −5 °C.',
  },
  {
    id: 'gibbs-reformer', label: 'Steam reformer by Gibbs minimisation',
    desc: 'NG + steam → preheat → Gibbs reactor → cooler → knock-out',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'M-101', type: 'mixer', x: 150, y: 170, nIn: 2, nOut: 1, params: { mode: 'adiabatic' }, pu: {} },
        { id: 'b2', name: 'H-101', type: 'heater', x: 290, y: 174, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 873.15 }, pu: {} },
        { id: 'b3', name: 'R-101', type: 'gibbs', x: 440, y: 150, nIn: 1, nOut: 1, params: { mode: 'specified_T', T_out_K: 1123.15, products: ['CO', 'CO2', 'H2'] }, pu: {} },
        { id: 'b4', name: 'E-101', type: 'heater', x: 590, y: 200, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 313.15 }, pu: {} },
        { id: 'b5', name: 'V-101', type: 'flash', x: 730, y: 180, nIn: 1, nOut: 2, params: { fmode: 'TP', T_K: 313.15 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'NG', from: null, to: { b: 'b1', p: 0 }, spec: sp(25, '°C', 30, 'bar(a)', 100, 'kmol/h', 'mole%', { CH4: 95, C2H6: 3, CO2: 1, N2: 1 }) },
        { id: 's2', name: 'STEAM', from: null, to: { b: 'b1', p: 1 }, spec: sp(400, '°C', 30, 'bar(a)', 310, 'kmol/h', 'mole%', { H2O: 100 }) },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'S4', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b3', p: 0 }, to: { b: 'b4', p: 0 } },
        { id: 's6', name: 'S6', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 0 } },
        { id: 's7', name: 'SYNGAS', from: { b: 'b5', p: 0 }, to: null },
        { id: 's8', name: 'CONDENSATE', from: { b: 'b5', p: 1 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b3', path: 'T_out_K' }, from: 973.15, to: 1173.15, points: 5,
        outputs: [{ stream: 's7', metric: 'mole_frac_dry', key: 'CH4' }, { stream: 's7', metric: 'comp_kmol_h', key: 'H2' }, { block: 'b3', metric: 'Q_kW' }] },
      seq: { b: 5, s: 8 },
    },
    note: 'No reactions are written: the Gibbs reactor finds the equilibrium of CH₄, C₂H₆, H₂O, CO, CO₂ and H₂ by minimising Gibbs energy (S/C ≈ 3.1). The sensitivity study shows methane slip and hydrogen make versus reformer outlet temperature.',
  },
  {
    id: 'meoh-water', label: 'Methanol / water column (NRTL)',
    desc: 'Feed pump → preheater → 20-stage column, activity-coefficient method',
    model: {
      pkg: { model: 'nrtl' },
      blocks: [
        { id: 'b1', name: 'P-101', type: 'rotating', x: 150, y: 200, nIn: 1, nOut: 1, params: { machine: 'pump', P_out_bar: 2.5, efficiency: 0.7 }, pu: {} },
        { id: 'b2', name: 'E-101', type: 'heater', x: 280, y: 202, nIn: 1, nOut: 1, params: { spec: 'VF', vapour_fraction: 0 }, pu: {} },
        { id: 'b3', name: 'C-201', type: 'rcol', x: 440, y: 120, nIn: 1, nOut: 2, params: {
          stages: 20, condenser: 'total', reboiler: 'kettle', feed_stages: [12], P_top_bar: 1.1, dp_stage_bar: 0.005,
          specs: [{ type: 'reflux_ratio', value: 1.2 }, { type: 'bottoms_mole_frac', key: 'MeOH', value: 0.001 }], side_draws: [] }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'FEED', from: null, to: { b: 'b1', p: 0 }, spec: sp(35, '°C', 1.2, 'bar(a)', 200, 'kmol/h', 'mole%', { MeOH: 40, H2O: 60 }) },
        { id: 's2', name: 'S2', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'S3', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's4', name: 'METHANOL', from: { b: 'b3', p: 0 }, to: null },
        { id: 's5', name: 'WATER', from: { b: 'b3', p: 1 }, to: null },
      ],
      seq: { b: 3, s: 5 },
    },
    note: 'NRTL with the ChemSep binary parameters (click empty canvas → Property method → Review). The column meets 0.1 mol % methanol in the bottoms at a fixed reflux ratio — the distillate rate is found by the column’s own outer loop.',
  },
  {
    id: 'three-phase', label: 'Three-phase separator — gas / oil / water (PR)',
    desc: 'Well-stream let-down → three-phase separator (VLLE)',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'LV-101', type: 'valve', x: 200, y: 200, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 12 }, pu: {} },
        { id: 'b2', name: 'D-101', type: 'flash3', x: 360, y: 190, nIn: 1, nOut: 3, params: { fmode: 'PQ', duty_kW: 0 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'WELL', from: null, to: { b: 'b1', p: 0 }, spec: sp(60, '°C', 40, 'bar(a)', 500, 'kmol/h', 'mole%',
          { CH4: 35, C2H6: 5, C3H8: 4, nC4H10: 3, nC6H14: 8, nC7H16: 15, H2O: 30 }) },
        { id: 's2', name: 'S2', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'GAS', from: { b: 'b2', p: 0 }, to: null },
        { id: 's4', name: 'OIL', from: { b: 'b2', p: 1 }, to: null },
        { id: 's5', name: 'WATER', from: { b: 'b2', p: 2 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b1', path: 'P_out_bar' }, from: 4, to: 30, points: 6,
        outputs: [{ stream: 's4', metric: 'molar_flow_kmol_h' }, { stream: 's3', metric: 'molar_flow_kmol_h' }, { stream: 's2', metric: 'T_K' }] },
      seq: { b: 2, s: 5 },
    },
    note: 'Peng–Robinson three-phase flash: the separator finds gas, a hydrocarbon liquid and free water after the let-down. The sensitivity study shows how separator pressure trades gas against stabilised oil.',
  },
  {
    id: 'eo-glycol', label: 'Ethylene glycol: EO hydration — PFR vs CSTR (kinetic, NRTL)',
    desc: 'Same feed and volume in a plug-flow and a stirred reactor · series reaction to DEG',
    model: {
      pkg: { model: 'nrtl' },
      blocks: [
        { id: 'b1', name: 'SP-101', type: 'splitter', x: 170, y: 200, nIn: 1, nOut: 2, params: { fractions: [0.5, 0.5] }, pu: {} },
        { id: 'b2', name: 'R-101', type: 'kpfr', x: 330, y: 120, nIn: 1, nOut: 1, params: {
          phase: 'L', thermal: 'adiabatic', geom: 'volume', volume_m3: 0.12, rate_basis: 'volume',
          reactions: [
            { stoich: [{ key: 'ethylene-oxide', nu: -1, order: 1 }, { key: 'H2O', nu: -1, order: 0 }, { key: 'MEG', nu: 1 }], k0: 6e8, Ea_kJmol: 80, basis: 'concentration', rev: 'none' },
            { stoich: [{ key: 'ethylene-oxide', nu: -1 }, { key: 'MEG', nu: -1 }, { key: 'DEG', nu: 1 }], k0: 2.2e7, Ea_kJmol: 80, basis: 'concentration', rev: 'none' }] }, pu: {} },
        { id: 'b3', name: 'R-102', type: 'kcstr', x: 360, y: 260, nIn: 1, nOut: 1, params: {
          phase: 'L', thermal: 'adiabatic', volume_m3: 0.12, rate_basis: 'volume',
          reactions: [
            { stoich: [{ key: 'ethylene-oxide', nu: -1, order: 1 }, { key: 'H2O', nu: -1, order: 0 }, { key: 'MEG', nu: 1 }], k0: 6e8, Ea_kJmol: 80, basis: 'concentration', rev: 'none' },
            { stoich: [{ key: 'ethylene-oxide', nu: -1 }, { key: 'MEG', nu: -1 }, { key: 'DEG', nu: 1 }], k0: 2.2e7, Ea_kJmol: 80, basis: 'concentration', rev: 'none' }] }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'FEED', from: null, to: { b: 'b1', p: 0 }, spec: sp(110, '°C', 20, 'bar(a)', 210, 'kmol/h', 'mole%', { 'ethylene-oxide': 4.7619, H2O: 95.2381 }) },
        { id: 's2', name: 'S2', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 1 }, to: { b: 'b3', p: 0 } },
        { id: 's4', name: 'PFR OUT', from: { b: 'b2', p: 0 }, to: null },
        { id: 's5', name: 'CSTR OUT', from: { b: 'b3', p: 0 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'feed_T', stream: 's1' }, from: 363.15, to: 403.15, points: 5,
        outputs: [{ stream: 's4', metric: 'comp_kmol_h', key: 'DEG' }, { stream: 's5', metric: 'comp_kmol_h', key: 'DEG' }, { stream: 's5', metric: 'comp_kmol_h', key: 'ethylene-oxide' }] },
      seq: { b: 3, s: 5 },
    },
    note: 'Illustrative kinetics: EO + H₂O → MEG (pseudo-first order in EO) and the series reaction EO + MEG → DEG. With equal volumes the plug-flow reactor converts more EO and makes about half the DEG of the stirred tank — the classic selectivity argument. Open R-101 for the axial temperature and composition profiles.',
  },
  {
    id: 'ethane-cracker', label: 'Ethane cracking coil — kinetic PFR in a furnace (PR)',
    desc: 'Ethane + dilution steam → fired coil (U, furnace T) → transfer-line exchanger',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'M-101', type: 'mixer', x: 150, y: 180, nIn: 2, nOut: 1, params: { mode: 'adiabatic' }, pu: {} },
        { id: 'b2', name: 'H-101', type: 'kpfr', x: 300, y: 176, nIn: 1, nOut: 1, params: {
          phase: 'V', thermal: 'coolant', U_W_m2K: 250, T_coolant_K: 1350, geom: 'tubes', length_m: 95, diameter_m: 0.108, tubes: 1, dp_bar: 0.8, rate_basis: 'volume',
          reactions: [
            { stoich: [{ key: 'C2H6', nu: -1 }, { key: 'C2H4', nu: 1 }, { key: 'H2', nu: 1 }], k0: 4.652e13, Ea_kJmol: 272.8, basis: 'concentration', rev: 'equilibrium' },
            { stoich: [{ key: 'C2H6', nu: -2, order: 1 }, { key: 'C3H8', nu: 1 }, { key: 'CH4', nu: 1 }], k0: 3.85e11, Ea_kJmol: 272.8, basis: 'concentration', rev: 'none' }] }, pu: {} },
        { id: 'b3', name: 'E-101', type: 'heater', x: 500, y: 180, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 673.15 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'ETHANE', from: null, to: { b: 'b1', p: 0 }, spec: sp(600, '°C', 3, 'bar(a)', 80, 'kmol/h', 'mole%', { C2H6: 100 }) },
        { id: 's2', name: 'STEAM', from: null, to: { b: 'b1', p: 1 }, spec: sp(600, '°C', 3, 'bar(a)', 960, 'kg/h', 'mole%', { H2O: 100 }) },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'CRACKED', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'TO QUENCH', from: { b: 'b3', p: 0 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b2', path: 'T_coolant_K' }, from: 1250, to: 1400, points: 4,
        outputs: [{ stream: 's4', metric: 'comp_kmol_h', key: 'C2H4' }, { block: 'b2', metric: 'detail', path: 'conversion.C2H6' }, { stream: 's4', metric: 'T_K' }] },
      seq: { b: 3, s: 5 },
    },
    note: 'Illustrative two-reaction ethane-cracking kinetics (after Froment): C₂H₆ ⇌ C₂H₄ + H₂ with the reverse rate from the Gibbs-energy equilibrium constant, plus 2 C₂H₆ → C₃H₈ + CH₄. A 95 m, 108 mm coil heated by the firebox (U = 250 W/m²·K) — the sensitivity study raises the furnace temperature.',
  },
  {
    id: 'smr-xu-froment', label: 'Steam reformer tubes — Xu–Froment LHHW kinetics (PR)',
    desc: 'NG + steam → 40 catalyst tubes in a fired box · Hougen–Watson rate laws',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'M-101', type: 'mixer', x: 150, y: 180, nIn: 2, nOut: 1, params: { mode: 'adiabatic' }, pu: {} },
        { id: 'b2', name: 'H-101', type: 'kpfr', x: 300, y: 176, nIn: 1, nOut: 1, params: {
          phase: 'V', thermal: 'coolant', U_W_m2K: 300, T_coolant_K: 1250, geom: 'tubes', length_m: 11.95, diameter_m: 0.1016, tubes: 40, dp_bar: 2,
          rate_basis: 'catalyst', catalyst_density_kgm3: 1360,
          reactions: [{"stoich": [{"key": "CH4", "nu": -1, "order": 1}, {"key": "H2O", "nu": -1, "order": 1}, {"key": "CO", "nu": 1}, {"key": "H2", "nu": 3, "order": -2.5}], "k0": 35208300000.0, "Ea_kJmol": 240.1, "basis": "partial_pressure", "rev": "equilibrium", "keq": "user", "KA": 30.114, "KB": -26830, "KC": 0, "KD": 0, "form": "lhhw", "ads_m": 2, "ads_terms": [{"K0": 1, "dH": 0, "orders": []}, {"K0": 8.23e-05, "dH": -70.65, "orders": [{"key": "CO", "e": 1}]}, {"K0": 6.12e-09, "dH": -82.9, "orders": [{"key": "H2", "e": 1}]}, {"K0": 0.000665, "dH": -38.28, "orders": [{"key": "CH4", "e": 1}]}, {"K0": 177000, "dH": 88.68, "orders": [{"key": "H2O", "e": 1}, {"key": "H2", "e": -1}]}]}, {"stoich": [{"key": "CO", "nu": -1, "order": 1}, {"key": "H2O", "nu": -1, "order": 1}, {"key": "CO2", "nu": 1}, {"key": "H2", "nu": 1, "order": -1}], "k0": 16.2917, "Ea_kJmol": 67.13, "basis": "partial_pressure", "rev": "equilibrium", "keq": "user", "KA": -4.036, "KB": 4400, "KC": 0, "KD": 0, "form": "lhhw", "ads_m": 2, "ads_terms": [{"K0": 1, "dH": 0, "orders": []}, {"K0": 8.23e-05, "dH": -70.65, "orders": [{"key": "CO", "e": 1}]}, {"K0": 6.12e-09, "dH": -82.9, "orders": [{"key": "H2", "e": 1}]}, {"K0": 0.000665, "dH": -38.28, "orders": [{"key": "CH4", "e": 1}]}, {"K0": 177000, "dH": 88.68, "orders": [{"key": "H2O", "e": 1}, {"key": "H2", "e": -1}]}]}, {"stoich": [{"key": "CH4", "nu": -1, "order": 1}, {"key": "H2O", "nu": -2, "order": 2}, {"key": "CO2", "nu": 1}, {"key": "H2", "nu": 4, "order": -3.5}], "k0": 8500000000.0, "Ea_kJmol": 243.9, "basis": "partial_pressure", "rev": "equilibrium", "keq": "user", "KA": 26.078000000000003, "KB": -22430, "KC": 0, "KD": 0, "form": "lhhw", "ads_m": 2, "ads_terms": [{"K0": 1, "dH": 0, "orders": []}, {"K0": 8.23e-05, "dH": -70.65, "orders": [{"key": "CO", "e": 1}]}, {"K0": 6.12e-09, "dH": -82.9, "orders": [{"key": "H2", "e": 1}]}, {"K0": 0.000665, "dH": -38.28, "orders": [{"key": "CH4", "e": 1}]}, {"K0": 177000, "dH": 88.68, "orders": [{"key": "H2O", "e": 1}, {"key": "H2", "e": -1}]}]}] }, pu: {} },
        { id: 'b3', name: 'E-101', type: 'heater', x: 500, y: 180, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 623.15 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'NATURAL GAS', from: null, to: { b: 'b1', p: 0 }, spec: sp(500, '°C', 29, 'bar(a)', 219, 'kmol/h', 'mole%', { CH4: 91.324, H2: 4.566, CO2: 2.283, N2: 1.826 }) },
        { id: 's2', name: 'STEAM', from: null, to: { b: 'b1', p: 1 }, spec: sp(500, '°C', 29, 'bar(a)', 600, 'kmol/h', 'mole%', { H2O: 100 }) },
        { id: 's3', name: 'S3', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's4', name: 'REFORMED', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'TO WHB', from: { b: 'b3', p: 0 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b2', path: 'T_coolant_K' }, from: 1200, to: 1350, points: 4,
        outputs: [{ block: 'b2', metric: 'detail', path: 'conversion.CH4' }, { stream: 's4', metric: 'T_K' }, { block: 'b2', metric: 'Q_kW' }] },
      seq: { b: 3, s: 5 },
    },
    note: 'Xu & Froment (1989) intrinsic kinetics for CH₄ + H₂O ⇌ CO + 3H₂, CO + H₂O ⇌ CO₂ + H₂ and CH₄ + 2H₂O ⇌ CO₂ + 4H₂ — Hougen–Watson rates with the adsorption term (1 + K_CO·p_CO + K_H₂·p_H₂ + K_CH₄·p_CH₄ + K_H₂O·p_H₂O/p_H₂)², their equilibrium constants, and k0 × 0.03 for the catalyst effectiveness factor. Open H-101 for the axial temperature and composition profiles.',
  },
  {
    id: 'nh3-converter', label: 'Ammonia converter — three intercooled beds, fugacity kinetics (PR)',
    desc: 'Syngas 150 bar → 3 adiabatic Fe-catalyst beds with interbed coolers → chilled separator',
    model: {
      pkg: { model: 'pr' },
      blocks: [
        { id: 'b1', name: 'E-1', type: 'heater', x: 120, y: 214, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 653.15 }, pu: {} },
        { id: 'b2', name: 'R-1', type: 'kpfr', x: 250, y: 210, nIn: 1, nOut: 1, params: { phase: 'V', thermal: 'adiabatic', geom: 'volume', volume_m3: 1.5, dp_bar: 0.5, rate_basis: 'volume', reactions: [{ stoich: [{ key: 'N2', nu: -1 }, { key: 'H2', nu: -3 }, { key: 'NH3', nu: 2 }], k0: 8.849e14, Ea_kJmol: 170.56, form: 'temkin', alpha: 0.5, ka: 'gb', eta: 1, rev: 'none' }] }, pu: {} },
        { id: 'b3', name: 'E-2', type: 'heater', x: 450, y: 214, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 663.15 }, pu: {} },
        { id: 'b4', name: 'R-2', type: 'kpfr', x: 580, y: 210, nIn: 1, nOut: 1, params: { phase: 'V', thermal: 'adiabatic', geom: 'volume', volume_m3: 3, dp_bar: 0.5, rate_basis: 'volume', reactions: [{ stoich: [{ key: 'N2', nu: -1 }, { key: 'H2', nu: -3 }, { key: 'NH3', nu: 2 }], k0: 8.849e14, Ea_kJmol: 170.56, form: 'temkin', alpha: 0.5, ka: 'gb', eta: 1, rev: 'none' }] }, pu: {} },
        { id: 'b5', name: 'E-3', type: 'heater', x: 780, y: 214, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 668.15 }, pu: {} },
        { id: 'b6', name: 'R-3', type: 'kpfr', x: 910, y: 210, nIn: 1, nOut: 1, params: { phase: 'V', thermal: 'adiabatic', geom: 'volume', volume_m3: 5, dp_bar: 0.5, rate_basis: 'volume', reactions: [{ stoich: [{ key: 'N2', nu: -1 }, { key: 'H2', nu: -3 }, { key: 'NH3', nu: 2 }], k0: 8.849e14, Ea_kJmol: 170.56, form: 'temkin', alpha: 0.5, ka: 'gb', eta: 1, rev: 'none' }] }, pu: {} },
        { id: 'b7', name: 'E-4', type: 'heater', x: 1110, y: 214, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 268.15 }, pu: {} },
        { id: 'b8', name: 'V-1', type: 'flash', x: 1240, y: 160, nIn: 1, nOut: 2, params: { T_K: 268.15, P_bar: 147 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'SYNGAS', from: null, to: { b: 'b1', p: 0 }, spec: sp(250, '°C', 150, 'bar(a)', 1000, 'kmol/h', 'mole%', { H2: 65.55, N2: 21.85, NH3: 3.5, CH4: 6.0, Ar: 3.1 }) },
        { id: 's2', name: 'BED-1 IN', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'BED-1 OUT', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's4', name: 'BED-2 IN', from: { b: 'b3', p: 0 }, to: { b: 'b4', p: 0 } },
        { id: 's5', name: 'BED-2 OUT', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 0 } },
        { id: 's6', name: 'BED-3 IN', from: { b: 'b5', p: 0 }, to: { b: 'b6', p: 0 } },
        { id: 's7', name: 'CONV OUT', from: { b: 'b6', p: 0 }, to: { b: 'b7', p: 0 } },
        { id: 's8', name: 'CHILLED', from: { b: 'b7', p: 0 }, to: { b: 'b8', p: 0 } },
        { id: 's9', name: 'RECYCLE GAS', from: { b: 'b8', p: 0 }, to: null },
        { id: 's10', name: 'LIQUID NH3', from: { b: 'b8', p: 1 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b1', path: 'T_out_K' }, from: 623.15, to: 683.15, points: 5,
        outputs: [{ stream: 's3', metric: 'T_K' }, { stream: 's7', metric: 'mole_frac', key: 'NH3' }, { stream: 's10', metric: 'mass_flow_kg_h' }] },
      seq: { b: 8, s: 10 },
    },
    note: 'Temkin–Pyzhev rate in fugacities (Dyson & Simon 1968: k0 = 8.849·10¹⁴ kmol NH₃/(m³·h), Ea = 170.56 kJ/mol, α = 0.5, K_a of Gillespie & Beattie) with φ from Peng–Robinson. Each bed is adiabatic; the interbed coolers stand for the exchangers or steam raisers between beds. Open a bed for its temperature and NH₃ profile, and compare its outlet with a Gibbs reactor at the same T and P for the approach to equilibrium. The sensitivity study scans the bed-1 inlet temperature.',
  },
  {
    id: 'urea-synthesis', label: 'Urea HP synthesis — reactor, CO₂ stripper, carbamate condenser (urea method)',
    desc: 'Pool-condenser liquid 178 °C → adiabatic reactor → CO₂ stripper (MP steam) → HP carbamate condenser',
    model: {
      pkg: { model: 'urea' },
      blocks: [
        { id: 'b1', name: 'R-1', type: 'urea-reactor', x: 150, y: 120, nIn: 1, nOut: 1, params: { umode: 'adiabatic', P_bar: 141, approach_fraction: 1, volume_m3: 180 }, pu: {} },
        { id: 'b2', name: 'V-1', type: 'flash', x: 300, y: 80, nIn: 1, nOut: 2, params: { fmode: 'PQ', P_bar: 141, duty_kW: 0 }, pu: {} },
        { id: 'b3', name: 'S-1', type: 'hp-stripper', x: 470, y: 150, nIn: 2, nOut: 2, params: { stages: 6, hspec_u: 'steam', steam_kg_h: 28000, steam_P_bar: 23, P_bar: 141 }, pu: {} },
        { id: 'b4', name: 'M-1', type: 'mixer', x: 660, y: 110, nIn: 3, nOut: 1, params: { mode: 'adiabatic', P_out_bar: 141 }, pu: {} },
        { id: 'b5', name: 'E-1', type: 'heater', x: 800, y: 114, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 441.15 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'REACTOR FEED', from: null, to: { b: 'b1', p: 0 }, spec: sp(178, '°C', 141, 'bar(a)', 4206, 'kmol/h', 'mole%', { NH3: 57.06134, CO2: 17.1184, H2O: 18.54494, urea: 7.13267, N2: 0.14265 }) },
        { id: 's2', name: 'CO₂ FEED', from: null, to: { b: 'b3', p: 1 }, spec: sp(120, '°C', 145, 'bar(a)', 1006, 'kmol/h', 'mole%', { CO2: 99.40358, N2: 0.59642 }) },
        { id: 's3', name: 'NH₃ FEED', from: null, to: { b: 'b4', p: 1 }, spec: sp(80, '°C', 155, 'bar(a)', 2000, 'kmol/h', 'mole%', { NH3: 100 }) },
        { id: 's4', name: 'LP CARBAMATE', from: null, to: { b: 'b4', p: 2 }, spec: sp(90, '°C', 150, 'bar(a)', 1440, 'kmol/h', 'mole%', { NH3: 43.05556, CO2: 18.05556, H2O: 38.88889 }) },
        { id: 's5', name: 'REACTOR OUT', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's6', name: 'REACTOR GAS', from: { b: 'b2', p: 0 }, to: null },
        { id: 's7', name: 'SYNTHESIS LIQUID', from: { b: 'b2', p: 1 }, to: { b: 'b3', p: 0 } },
        { id: 's8', name: 'STRIPPER GAS', from: { b: 'b3', p: 0 }, to: { b: 'b4', p: 0 } },
        { id: 's9', name: 'UREA SOLUTION', from: { b: 'b3', p: 1 }, to: null },
        { id: 's10', name: 'S10', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 0 } },
        { id: 's11', name: 'TO REACTOR', from: { b: 'b5', p: 0 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b3', path: 'steam_kg_h' }, from: 20000, to: 36000, points: 5,
        outputs: [{ block: 'b3', metric: 'detail', path: 'stripping_efficiency' }, { stream: 's9', metric: 'T_K' }, { stream: 's9', metric: 'comp_kmol_h', key: 'NH3' }] },
      seq: { b: 5, s: 11 },
    },
    note: 'Urea synthesis property method (Voskov et al. 2016 UNIQUAC with carbamate and bicarbonate equilibria, Peng–Robinson vapour). R-1 brings carbamate ⇌ urea + H₂O to equilibrium adiabatically — about 56 % CO₂ conversion at N/C 2.94, H/C 0.47, 185 °C. The CO₂ stripper is six equilibrium stages heated by 23 bar steam; its off-gas is condensed in E-1 with the fresh NH₃ and the LP carbamate (the duty is the LP steam the pool condenser raises). Compare TO REACTOR with REACTOR FEED: connect E-1 to R-1 to close the loop. The sensitivity study scans the stripper steam.',
  },
  {
    id: 'etoac-cstr', label: 'Ethyl acetate esterification CSTR — acid association (UNIQUAC)',
    desc: 'Acetic acid + ethanol ⇌ ethyl acetate + water, adiabatic stirred tank',
    model: {
      pkg: { model: 'uniquac' },
      blocks: [
        { id: 'b1', name: 'R-201', type: 'kcstr', x: 260, y: 150, nIn: 1, nOut: 1, params: {
          phase: 'L', thermal: 'adiabatic', volume_m3: 4, rate_basis: 'volume',
          reactions: [{ stoich: [{ key: 'AcOH', nu: -1 }, { key: 'EtOH', nu: -1 }, { key: 'etoac', nu: 1 }, { key: 'H2O', nu: 1 }], k0: 4.0e4, Ea_kJmol: 50, basis: 'concentration', rev: 'rate', reverse_k0: 1.0e4, reverse_Ea_kJmol: 50 }] }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'FEED', from: null, to: { b: 'b1', p: 0 }, spec: sp(70, '°C', 3, 'bar(a)', 115, 'kmol/h', 'mole%', { AcOH: 43.478, EtOH: 52.174, H2O: 4.348 }) },
        { id: 's2', name: 'PRODUCT', from: { b: 'b1', p: 0 }, to: null },
      ],
      sens: { active: true, vary: { kind: 'param', block: 'b1', path: 'volume_m3' }, from: 0.5, to: 8, points: 6,
        outputs: [{ block: 'b1', metric: 'detail', path: 'conversion.AcOH' }, { stream: 's2', metric: 'T_K' }, { stream: 's2', metric: 'comp_kmol_h', key: 'etoac' }] },
      seq: { b: 1, s: 2 },
    },
    note: 'Acetic acid dimerises in the vapour; with the chemical-theory association model (Methods) its liquid enthalpy matches NIST and the heat of esterification is about −5 kJ/mol, so the adiabatic tank warms by only ~10 K. Untick “Vapour association” in Methods to see the error an unassociated model makes (about +60 K). Illustrative kinetics.',
  },
  {
    id: 'mea-co2-removal', label: 'Syngas CO₂ removal — aqueous MEA absorber + stripper',
    desc: 'Ammonia-plant raw syngas · 20 wt % MEA · lean/rich exchanger · regenerator',
    model: {
      pkg: { model: 'amine-mea', vapour: 'pr' },
      blocks: [
        { id: 'b1', name: 'C-101', type: 'rcol', x: 230, y: 110, nIn: 2, nOut: 2, params: {
          stages: 20, condenser: 'none', reboiler: 'none', feed_stages: [1, 20], P_top_bar: 28, specs: [], side_draws: [],
          comp_eff: [{ key: 'CO2', value: 0.3 }] }, pu: {} },
        { id: 'b2', name: 'LV-101', type: 'valve', x: 380, y: 330, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 5 }, pu: {} },
        { id: 'b3', name: 'V-101', type: 'flash', x: 500, y: 300, nIn: 1, nOut: 2, params: { fmode: 'PQ', P_bar: 5, duty_kW: 0 }, pu: {} },
        { id: 'b4', name: 'LV-102', type: 'valve', x: 650, y: 360, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 2.2 }, pu: {} },
        { id: 'b5', name: 'E-101', type: 'heat-exchanger', x: 780, y: 330, nIn: 2, nOut: 2, params: { xmode: 'cold_T', cold_T_out_K: 378.15 }, pu: {} },
        { id: 'b6', name: 'C-102', type: 'rcol', x: 960, y: 100, nIn: 1, nOut: 2, params: {
          stages: 12, condenser: 'partial', reboiler: 'kettle', feed_stages: [2], P_top_bar: 1.9, side_draws: [],
          specs: [{ type: 'condenser_temperature', value: 313.15 }, { type: 'reboiler_duty', value: 12500 }] }, pu: {} },
        { id: 'b7', name: 'E-102', type: 'heater', x: 720, y: 500, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 318.15 }, pu: {} },
        { id: 'b8', name: 'P-101', type: 'rotating', x: 520, y: 500, nIn: 1, nOut: 1, params: { machine: 'pump', P_out_bar: 28.5, efficiency: 0.75 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'LEAN MEA', from: null, to: { b: 'b1', p: 0 }, spec: sp(45, '°C', 28.5, 'bar(a)', 8827.22, 'kmol/h', 'mole%', { MEA: 6.79716, H2O: 92.18327, CO2: 1.01957 }) },
        { id: 's2', name: 'RAW SYNGAS', from: null, to: { b: 'b1', p: 1 }, spec: sp(45, '°C', 28.5, 'bar(a)', 997, 'kmol/h', 'mole%',
          { H2: 60.68205, N2: 20.36108, CO2: 17.65296, CH4: 0.4012, Ar: 0.3009, CO: 0.3009, H2O: 0.3009 }) },
        { id: 's3', name: 'TREATED GAS', from: { b: 'b1', p: 0 }, to: null },
        { id: 's4', name: 'RICH MEA', from: { b: 'b1', p: 1 }, to: { b: 'b2', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's6', name: 'FLASH GAS', from: { b: 'b3', p: 0 }, to: null },
        { id: 's7', name: 'S7', from: { b: 'b3', p: 1 }, to: { b: 'b4', p: 0 } },
        { id: 's8', name: 'S8', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 1 } },
        { id: 's9', name: 'HOT RICH', from: { b: 'b5', p: 1 }, to: { b: 'b6', p: 0 } },
        { id: 's10', name: 'CO₂ PRODUCT', from: { b: 'b6', p: 0 }, to: null },
        { id: 's11', name: 'HOT LEAN', from: { b: 'b6', p: 1 }, to: { b: 'b5', p: 0 }, spec: sp(120, '°C', 2.2, 'bar(a)', 8827.22, 'kmol/h', 'mole%', { MEA: 6.79716, H2O: 92.18327, CO2: 1.01957 }) },
        { id: 's12', name: 'S12', from: { b: 'b5', p: 0 }, to: { b: 'b7', p: 0 } },
        { id: 's13', name: 'S13', from: { b: 'b7', p: 0 }, to: { b: 'b8', p: 0 } },
        { id: 's14', name: 'LEAN TO C-101', from: { b: 'b8', p: 0 }, to: null },
      ],
      seq: { b: 8, s: 14 },
    },
    note: 'Aqueous-MEA package (Akula et al. / IDAES chemical equilibrium). The absorber trays have a CO₂ Murphree efficiency of 0.3 (water and the light gases stay at equilibrium); the regenerator is specified by its condenser temperature and reboiler duty, and the lean/rich exchanger closes an information recycle (torn at HOT LEAN). Compare LEAN TO C-101 with the LEAN MEA feed: same loading, a little water to make up. Open any liquid stream for the CO₂ loading and equilibrium CO₂ pressure.',
  },
  {
    id: 'mdea-co2-removal', label: 'Syngas CO₂ removal — aqueous MDEA (Extended UNIQUAC)',
    desc: 'Ammonia-plant raw syngas · 40 wt % MDEA · flash let-down · lean/rich exchanger · regenerator',
    model: {
      pkg: { model: 'amine-mdea', vapour: 'pr' },
      blocks: [
        { id: 'b1', name: 'C-101', type: 'rcol', x: 230, y: 110, nIn: 2, nOut: 2, params: {
          stages: 20, condenser: 'none', reboiler: 'none', feed_stages: [1, 20], P_top_bar: 28, specs: [], side_draws: [],
          comp_eff: [{ key: 'CO2', value: 0.2 }] }, pu: {} },
        { id: 'b2', name: 'LV-101', type: 'valve', x: 380, y: 330, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 5 }, pu: {} },
        { id: 'b3', name: 'V-101', type: 'flash', x: 500, y: 300, nIn: 1, nOut: 2, params: { fmode: 'PQ', P_bar: 5, duty_kW: 0 }, pu: {} },
        { id: 'b4', name: 'LV-102', type: 'valve', x: 650, y: 360, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 2.2 }, pu: {} },
        { id: 'b5', name: 'E-101', type: 'heat-exchanger', x: 780, y: 330, nIn: 2, nOut: 2, params: { xmode: 'cold_T', cold_T_out_K: 368.15 }, pu: {} },
        { id: 'b6', name: 'C-102', type: 'rcol', x: 960, y: 100, nIn: 1, nOut: 2, params: {
          stages: 12, condenser: 'partial', reboiler: 'kettle', feed_stages: [2], P_top_bar: 1.9, side_draws: [],
          specs: [{ type: 'condenser_temperature', value: 313.15 }, { type: 'reboiler_duty', value: 6000 }] }, pu: {} },
        { id: 'b7', name: 'E-102', type: 'heater', x: 720, y: 500, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 318.15 }, pu: {} },
        { id: 'b8', name: 'P-101', type: 'rotating', x: 520, y: 500, nIn: 1, nOut: 1, params: { machine: 'pump', P_out_bar: 28.5, efficiency: 0.75 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'LEAN MDEA', from: null, to: { b: 'b1', p: 0 }, spec: sp(45, '°C', 28.5, 'bar(a)', 4500, 'kmol/h', 'mole%', { 'methyl-diethanolamine': 9.1342, H2O: 90.8201, CO2: 0.0457 }) },
        { id: 's2', name: 'RAW SYNGAS', from: null, to: { b: 'b1', p: 1 }, spec: sp(45, '°C', 28.5, 'bar(a)', 997, 'kmol/h', 'mole%',
          { H2: 60.68205, N2: 20.36108, CO2: 17.65296, CH4: 0.4012, Ar: 0.3009, CO: 0.3009, H2O: 0.3009 }) },
        { id: 's3', name: 'TREATED GAS', from: { b: 'b1', p: 0 }, to: null },
        { id: 's4', name: 'RICH MDEA', from: { b: 'b1', p: 1 }, to: { b: 'b2', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's6', name: 'FLASH GAS', from: { b: 'b3', p: 0 }, to: null },
        { id: 's7', name: 'S7', from: { b: 'b3', p: 1 }, to: { b: 'b4', p: 0 } },
        { id: 's8', name: 'S8', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 1 } },
        { id: 's9', name: 'HOT RICH', from: { b: 'b5', p: 1 }, to: { b: 'b6', p: 0 } },
        { id: 's10', name: 'CO₂ PRODUCT', from: { b: 'b6', p: 0 }, to: null },
        { id: 's11', name: 'HOT LEAN', from: { b: 'b6', p: 1 }, to: { b: 'b5', p: 0 }, spec: sp(121, '°C', 1.9, 'bar(a)', 4500, 'kmol/h', 'mole%', { 'methyl-diethanolamine': 9.1342, H2O: 90.8201, CO2: 0.0457 }) },
        { id: 's12', name: 'S12', from: { b: 'b5', p: 0 }, to: { b: 'b7', p: 0 } },
        { id: 's13', name: 'S13', from: { b: 'b7', p: 0 }, to: { b: 'b8', p: 0 } },
        { id: 's14', name: 'LEAN TO C-101', from: { b: 'b8', p: 0 }, to: null },
      ],
      seq: { b: 8, s: 14 },
    },
    note: 'Aqueous-MDEA package (Extended UNIQUAC, Sadegh 2013). MDEA forms no carbamate and reacts slowly, so the absorber trays carry a low CO₂ Murphree efficiency (0.2) — piperazine activation raises it (see the activated-MDEA example). The regenerator is specified by its condenser temperature and reboiler duty (6 MW is close to the minimum here: it heats 122 t/h of solvent from 95 to 121 °C and desorbs the CO₂ at about 55 kJ/mol); the lean/rich exchanger closes an information recycle (torn at HOT LEAN). Open a liquid stream for the loading, protonated-MDEA fraction and equilibrium CO₂ pressure.',
  },
  {
    id: 'amdea-co2-removal', label: 'Syngas CO₂ removal — activated MDEA (MDEA + piperazine)',
    desc: 'Ammonia-plant raw syngas · 40 wt % MDEA + 5 wt % piperazine · flash let-down · lean/rich exchanger · regenerator',
    model: {
      pkg: { model: 'amine-mdea', vapour: 'pr' },
      blocks: [
        { id: 'b1', name: 'C-101', type: 'rcol', x: 230, y: 110, nIn: 2, nOut: 2, params: {
          stages: 20, condenser: 'none', reboiler: 'none', feed_stages: [1, 20], P_top_bar: 28, specs: [], side_draws: [],
          comp_eff: [{ key: 'CO2', value: 0.35 }] }, pu: {} },
        { id: 'b2', name: 'LV-101', type: 'valve', x: 380, y: 330, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 5 }, pu: {} },
        { id: 'b3', name: 'V-101', type: 'flash', x: 500, y: 300, nIn: 1, nOut: 2, params: { fmode: 'PQ', P_bar: 5, duty_kW: 0 }, pu: {} },
        { id: 'b4', name: 'LV-102', type: 'valve', x: 650, y: 360, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 2.2 }, pu: {} },
        { id: 'b5', name: 'E-101', type: 'heat-exchanger', x: 780, y: 330, nIn: 2, nOut: 2, params: { xmode: 'cold_T', cold_T_out_K: 368.15 }, pu: {} },
        { id: 'b6', name: 'C-102', type: 'rcol', x: 960, y: 100, nIn: 1, nOut: 2, params: {
          stages: 12, condenser: 'partial', reboiler: 'kettle', feed_stages: [2], P_top_bar: 1.9, side_draws: [],
          specs: [{ type: 'condenser_temperature', value: 313.15 }, { type: 'reboiler_duty', value: 6400 }] }, pu: {} },
        { id: 'b7', name: 'E-102', type: 'heater', x: 720, y: 500, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 318.15 }, pu: {} },
        { id: 'b8', name: 'P-101', type: 'rotating', x: 520, y: 500, nIn: 1, nOut: 1, params: { machine: 'pump', P_out_bar: 28.5, efficiency: 0.75 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'LEAN aMDEA', from: null, to: { b: 'b1', p: 0 }, spec: sp(45, '°C', 28.5, 'bar(a)', 4500, 'kmol/h', 'mole%', { 'methyl-diethanolamine': 9.6993, piperazine: 1.6766, H2O: 88.2155, CO2: 0.4086 }) },
        { id: 's2', name: 'RAW SYNGAS', from: null, to: { b: 'b1', p: 1 }, spec: sp(45, '°C', 28.5, 'bar(a)', 997, 'kmol/h', 'mole%',
          { H2: 60.68205, N2: 20.36108, CO2: 17.65296, CH4: 0.4012, Ar: 0.3009, CO: 0.3009, H2O: 0.3009 }) },
        { id: 's3', name: 'TREATED GAS', from: { b: 'b1', p: 0 }, to: null },
        { id: 's4', name: 'RICH aMDEA', from: { b: 'b1', p: 1 }, to: { b: 'b2', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's6', name: 'FLASH GAS', from: { b: 'b3', p: 0 }, to: null },
        { id: 's7', name: 'S7', from: { b: 'b3', p: 1 }, to: { b: 'b4', p: 0 } },
        { id: 's8', name: 'S8', from: { b: 'b4', p: 0 }, to: { b: 'b5', p: 1 } },
        { id: 's9', name: 'HOT RICH', from: { b: 'b5', p: 1 }, to: { b: 'b6', p: 0 } },
        { id: 's10', name: 'CO₂ PRODUCT', from: { b: 'b6', p: 0 }, to: null },
        { id: 's11', name: 'HOT LEAN', from: { b: 'b6', p: 1 }, to: { b: 'b5', p: 0 }, spec: sp(121, '°C', 1.9, 'bar(a)', 4500, 'kmol/h', 'mole%', { 'methyl-diethanolamine': 9.6993, piperazine: 1.6766, H2O: 88.2155, CO2: 0.4086 }) },
        { id: 's12', name: 'S12', from: { b: 'b5', p: 0 }, to: { b: 'b7', p: 0 } },
        { id: 's13', name: 'S13', from: { b: 'b7', p: 0 }, to: { b: 'b8', p: 0 } },
        { id: 's14', name: 'LEAN TO C-101', from: { b: 'b8', p: 0 }, to: null },
      ],
      seq: { b: 8, s: 14 },
    },
    note: 'Activated MDEA: the aqueous-MDEA package with piperazine added (MDEA part: Sadegh 2013; piperazine species fitted to measured CO₂ pressures over MDEA/PZ blends — see the validation page). Piperazine speeds up CO₂ absorption, so the absorber trays carry a higher CO₂ Murphree efficiency (0.35) than plain MDEA, and it binds CO₂ as carbamates at lean loadings, lowering the lean-end CO₂ pressure. The rich end of a 28-bar absorber lies above the CO₂ pressures of the piperazine data and is flagged as an extrapolation. The regenerator is specified by its condenser temperature and reboiler duty (6.4 MW returns the solvent at the feed loading — compare LEAN TO C-101 with LEAN aMDEA); the lean/rich exchanger closes an information recycle (torn at HOT LEAN). Open a liquid stream for the loadings, the share of piperazine bound as carbamates and the equilibrium CO₂ pressure.',
  },
  {
    id: 'benfield-co2-removal', label: 'Hot potassium carbonate (Benfield-type) CO₂ removal',
    desc: '30 wt % K₂CO₃ · hot absorber at 28 bar · flash let-down · regenerator',
    model: {
      pkg: { model: 'hot-k2co3', vapour: 'pr' },
      blocks: [
        { id: 'b1', name: 'C-201', type: 'rcol', x: 230, y: 110, nIn: 2, nOut: 2, params: {
          stages: 20, condenser: 'none', reboiler: 'none', feed_stages: [1, 20], P_top_bar: 28, specs: [], side_draws: [],
          comp_eff: [{ key: 'CO2', value: 0.25 }] }, pu: {} },
        { id: 'b2', name: 'LV-201', type: 'valve', x: 420, y: 330, nIn: 1, nOut: 1, params: { pspec: 'P', P_out_bar: 1.9 }, pu: {} },
        { id: 'b3', name: 'C-202', type: 'rcol', x: 600, y: 100, nIn: 1, nOut: 2, params: {
          stages: 14, condenser: 'partial', reboiler: 'kettle', feed_stages: [2], P_top_bar: 1.7, side_draws: [], efficiency: 0.25,
          specs: [{ type: 'condenser_temperature', value: 323.15 }, { type: 'reboiler_duty', value: 7800 }] }, pu: {} },
        { id: 'b4', name: 'P-201', type: 'rotating', x: 420, y: 500, nIn: 1, nOut: 1, params: { machine: 'pump', P_out_bar: 28.5, efficiency: 0.75 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'LEAN SOLUTION', from: null, to: { b: 'b1', p: 0 }, spec: sp(105, '°C', 28.5, 'bar(a)', 7277.23, 'kmol/h', 'mole%', { K2CO3: 5.22177, H2O: 93.47279, CO2: 1.30544 }) },
        { id: 's2', name: 'RAW SYNGAS', from: null, to: { b: 'b1', p: 1 }, spec: sp(120, '°C', 28.5, 'bar(a)', 1044, 'kmol/h', 'mole%',
          { H2: 57.95019, N2: 19.44444, CO2: 16.85824, CH4: 0.38314, Ar: 0.28736, CO: 0.28736, H2O: 4.78927 }) },
        { id: 's3', name: 'TREATED GAS', from: { b: 'b1', p: 0 }, to: null },
        { id: 's4', name: 'RICH SOLUTION', from: { b: 'b1', p: 1 }, to: { b: 'b2', p: 0 } },
        { id: 's5', name: 'S5', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's6', name: 'CO₂ PRODUCT', from: { b: 'b3', p: 0 }, to: null },
        { id: 's7', name: 'S7', from: { b: 'b3', p: 1 }, to: { b: 'b4', p: 0 } },
        { id: 's8', name: 'LEAN TO C-201', from: { b: 'b4', p: 0 }, to: null },
      ],
      seq: { b: 4, s: 8 },
    },
    note: 'Hot-carbonate package (Pitzer, PHREEQC parameters). Absorption and regeneration run near the solution boiling point, so no lean/rich exchanger is needed; the rich solution flashes across LV-201 into the regenerator. CO₂ Murphree efficiency 0.25 in the absorber and 0.25 on the regenerator trays stand in for the slow carbonate kinetics (the activator raises them) — tune them to plant data. Open a liquid stream for the conversion to KHCO₃, water activity and equilibrium CO₂ pressure.',
  },
  {
    id: 'sour-water-stripper', label: 'Refinery sour water stripper (sour-water method)',
    desc: '67 t/h sour water · 2 mol % NH₃, 1.5 mol % H₂S · steam-heated preheater · 20-stage stripper with partial condenser · bottoms cooler',
    model: {
      pkg: { model: 'sour-water', vapour: 'pr' },
      blocks: [
        { id: 'b1', name: 'E-301', type: 'heater', x: 200, y: 260, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 368.15, P_out_bar: 2.5 }, pu: {} },
        { id: 'b2', name: 'C-301', type: 'rcol', x: 420, y: 110, nIn: 1, nOut: 2, params: {
          stages: 20, condenser: 'partial', reboiler: 'kettle', feed_stages: [3], P_top_bar: 1.8, side_draws: [],
          specs: [{ type: 'condenser_temperature', value: 358.15 }, { type: 'reboiler_duty', value: 7200 }] }, pu: {} },
        { id: 'b3', name: 'E-302', type: 'heater', x: 640, y: 420, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 313.15 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'SOUR WATER', from: null, to: { b: 'b1', p: 0 }, spec: sp(40, '°C', 4, 'bar(a)', 67000, 'kg/h', 'mole%', { H2O: 96.4, NH3: 2.0, H2S: 1.5, CO2: 0.1 }) },
        { id: 's2', name: 'HOT FEED', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'ACID GAS', from: { b: 'b2', p: 0 }, to: null },
        { id: 's4', name: 'STRIPPED WATER', from: { b: 'b2', p: 1 }, to: { b: 'b3', p: 0 } },
        { id: 's5', name: 'TO TREATMENT', from: { b: 'b3', p: 0 }, to: null },
      ],
      seq: { b: 3, s: 5 },
    },
    note: 'Sour-water method: NH₃, H₂S and CO₂ ionise in the water and NH₃ ties up H₂S as ammonium hydrosulfide, which is why a stripper needs steam well beyond simple volatility. The reboiler duty sets the stripped-water quality — about 7 MW (≈ 0.17 kg steam per kg feed) brings NH₃ down to a few ppm and H₂S to below 1 ppm; at 6 MW NH₃ rises to several hundred ppm. Open STRIPPED WATER for its pH and equilibrium NH₃ / H₂S pressures, and run a sensitivity on the reboiler duty to see the cliff. A partial condenser at 85 °C keeps NH₄HS from depositing in the overhead.',
  },
  {
    id: 'seawater-evaporator', label: 'Seawater evaporator — boiling-point rise and scaling (aqueous electrolytes)',
    desc: '100 t/h seawater · preheater · evaporator at 1 atm concentrating 2× · condenser · brine cooler',
    model: {
      pkg: { model: 'aqueous-electrolyte' },
      blocks: [
        { id: 'b1', name: 'E-401', type: 'heater', x: 200, y: 260, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 368.15 }, pu: {} },
        { id: 'b2', name: 'V-401', type: 'flash', x: 400, y: 240, nIn: 1, nOut: 2, params: { fmode: 'PVF', P_bar: 1.01325, vapour_fraction: 0.5 }, pu: {} },
        { id: 'b3', name: 'E-402', type: 'heater', x: 600, y: 120, nIn: 1, nOut: 1, params: { spec: 'VF', vapour_fraction: 0 }, pu: {} },
        { id: 'b4', name: 'E-403', type: 'heater', x: 600, y: 380, nIn: 1, nOut: 1, params: { spec: 'T', T_out_K: 313.15 }, pu: {} },
      ],
      streams: [
        { id: 's1', name: 'SEAWATER', from: null, to: { b: 'b1', p: 0 }, spec: sp(25, '°C', 2, 'bar(a)', 100000, 'kg/h', 'mole%',
          { H2O: 98.99789, NaCl: 0.8628027, KCl: 0.01886833, CaCl2: 0.01917347, MgCl2: 0.04543828, MgSO4: 0.0521913, Na2CO3: 0.002029294, CO2: 0.001605369 }) },
        { id: 's2', name: 'HOT SEAWATER', from: { b: 'b1', p: 0 }, to: { b: 'b2', p: 0 } },
        { id: 's3', name: 'VAPOUR', from: { b: 'b2', p: 0 }, to: { b: 'b3', p: 0 } },
        { id: 's4', name: 'BRINE', from: { b: 'b2', p: 1 }, to: { b: 'b4', p: 0 } },
        { id: 's5', name: 'DISTILLATE', from: { b: 'b3', p: 0 }, to: null },
        { id: 's6', name: 'BRINE OUT', from: { b: 'b4', p: 0 }, to: null },
      ],
      seq: { b: 4, s: 6 },
    },
    note: 'Aqueous-electrolyte method (Pitzer, PHREEQC pitzer.dat). The evaporator boils off half of the water at 1 atm: the brine boils about 1.1 K above pure water (its water activity drops as the salts concentrate), and the dissolved CO₂ leaves with the vapour, which raises the pH and pushes calcite and brucite above saturation — the alkaline-scale problem of thermal desalination. At twice the seawater concentration and 101 °C anhydrite is also just past saturation (SI ≈ +0.17), which is why evaporator plants limit the concentration factor and top brine temperature. Open BRINE for pH, water activity and the saturation indices; change the vapour fraction to see the scaling limits move. Seawater as Millero’s reference composition (Sr counted as Ca, Br as Cl; boron left out), with its bicarbonate written as Na₂CO₃ + CO₂ so that the CO₂ can leave in the evaporator — a bicarbonate salt given as NaHCO₃ keeps its CO₂ in the liquid.',
  },
];

const PRESETS = [
  /* g: group in the menu · c: composition in mole % unless b says mass % · typical compositions to start from; edit them freely */
  // AGA Report No. 8 reference gases — averages of many field samples, used to check natural-gas property calculators
  { g: 'Natural gas & LNG', label: 'Natural gas — AGA 8 Gulf Coast reference', c: { CH4: 96.5222, N2: 0.2595, CO2: 0.5956, C2H6: 1.8186, C3H8: 0.4596, isobutane: 0.0977, nC4H10: 0.1007, isopentane: 0.0473, 'n-pentane': 0.0324, nC6H14: 0.0664 } },
  { g: 'Natural gas & LNG', label: 'Natural gas — AGA 8 Amarillo reference', c: { CH4: 90.6724, N2: 3.1284, CO2: 0.4676, C2H6: 4.5279, C3H8: 0.828, isobutane: 0.1037, nC4H10: 0.1563, isopentane: 0.0321, 'n-pentane': 0.0443, nC6H14: 0.0393 } },
  { g: 'Natural gas & LNG', label: 'Natural gas — AGA 8 Ekofisk reference', c: { CH4: 85.9063, N2: 1.0068, CO2: 1.4954, C2H6: 8.4919, C3H8: 2.3015, isobutane: 0.3486, nC4H10: 0.3506, isopentane: 0.0509, 'n-pentane': 0.048 } },
  { g: 'Natural gas & LNG', label: 'Natural gas — AGA 8 high-N₂ reference', c: { CH4: 81.441, N2: 13.465, CO2: 0.985, C2H6: 3.3, C3H8: 0.605, isobutane: 0.1, nC4H10: 0.104 } },
  { g: 'Natural gas & LNG', label: 'Natural gas — AGA 8 high-CO₂/N₂ reference', c: { CH4: 81.211, N2: 5.702, CO2: 7.585, C2H6: 4.303, C3H8: 0.895, isobutane: 0.151, nC4H10: 0.152 } },
  { g: 'Natural gas & LNG', label: 'Natural gas (lean, typical)', c: { CH4: 90, C2H6: 6, C3H8: 3, nC4H10: 1 } },
  { g: 'Natural gas & LNG', label: 'Associated gas (rich, typical)', c: { CH4: 75, C2H6: 10, C3H8: 6, isobutane: 1.5, nC4H10: 2.5, isopentane: 0.8, 'n-pentane': 0.8, nC6H14: 0.6, nC7H16: 0.3, N2: 1, CO2: 1.5 } },
  { g: 'Natural gas & LNG', label: 'Sour gas (5 % H₂S, 5 % CO₂)', c: { CH4: 80, C2H6: 5, C3H8: 2, nC4H10: 1, N2: 2, CO2: 5, H2S: 5 } },
  { g: 'Natural gas & LNG', label: 'LNG (typical)', c: { CH4: 92, C2H6: 5.5, C3H8: 1.5, isobutane: 0.3, nC4H10: 0.3, N2: 0.4 } },
  { g: 'Natural gas & LNG', label: 'NGL (ethane-plus)', c: { C2H6: 40, C3H8: 28, isobutane: 6, nC4H10: 12, isopentane: 4, 'n-pentane': 4, nC6H14: 6 } },
  { g: 'Natural gas & LNG', label: 'Gas condensate (light)', c: { C3H8: 2, isobutane: 2, nC4H10: 5, isopentane: 8, 'n-pentane': 10, nC6H14: 20, nC7H16: 20, nC8H18: 15, 'n-nonane': 10, 'n-decane': 8 } },
  { g: 'Natural gas & LNG', label: 'Biogas (typical)', c: { CH4: 60, CO2: 38.5, N2: 1, O2: 0.3, H2S: 0.2 } },

  { g: 'Air, flue gas & combustion', label: 'Air (dry)', c: { N2: 78.08, O2: 20.95, Ar: 0.93, CO2: 0.04 } },
  { g: 'Air, flue gas & combustion', label: 'Air (humid — 60 % RH at 25 °C)', c: { N2: 76.6, O2: 20.55, Ar: 0.91, CO2: 0.04, H2O: 1.9 } },
  { g: 'Air, flue gas & combustion', label: 'Flue gas — natural-gas boiler (15 % excess air)', c: { N2: 71.76, CO2: 8.3, H2O: 16.6, O2: 2.49, Ar: 0.85 } },
  { g: 'Air, flue gas & combustion', label: 'Flue gas — coal-fired boiler (typical)', c: { N2: 74.2, CO2: 13.5, H2O: 8, O2: 4, Ar: 0.2, SO2: 0.1 } },
  { g: 'Air, flue gas & combustion', label: 'Gas-turbine exhaust (typical)', c: { N2: 74.6, O2: 13.5, H2O: 7.5, CO2: 3.5, Ar: 0.9 } },

  { g: 'Syngas, hydrogen & ammonia', label: 'Ammonia make-up gas (H₂/N₂ = 3)', c: { H2: 74.0, N2: 24.7, CH4: 1.0, Ar: 0.3 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Primary reformer outlet (wet, typical)', c: { H2: 47, CO: 7, CO2: 6.5, CH4: 6, H2O: 33.5 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Secondary reformer outlet — ammonia plant (wet)', c: { H2: 37, N2: 14, CO: 8, CO2: 5.5, CH4: 0.3, Ar: 0.17, H2O: 35.03 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'LT shift outlet — ammonia plant (wet)', c: { H2: 45, N2: 15, CO: 0.2, CO2: 12.5, CH4: 0.2, Ar: 0.2, H2O: 26.9 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Raw syngas to CO₂ removal (ammonia plant)', c: { H2: 60.68205, N2: 20.36108, CO2: 17.65296, CH4: 0.4012, Ar: 0.3009, CO: 0.3009, H2O: 0.3009 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Ammonia converter inlet (loop gas)', c: { H2: 66, N2: 22, NH3: 3, CH4: 6, Ar: 3 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Ammonia converter outlet', c: { H2: 54, N2: 18, NH3: 17, CH4: 7, Ar: 4 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Ammonia loop purge gas', c: { H2: 60, N2: 20, CH4: 12, Ar: 5.5, NH3: 2.5 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Methanol synthesis gas (SN ≈ 2.05)', c: { H2: 67, CO: 25, CO2: 5, CH4: 2, N2: 1 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Coal gasifier syngas (O₂-blown, dry)', c: { CO: 45, H2: 35, CO2: 15, N2: 3, H2S: 1, CH4: 0.5, Ar: 0.5 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Coke-oven gas (typical)', c: { H2: 57, CH4: 26, CO: 6, N2: 5, CO2: 2, C2H4: 2.5, C2H6: 1, O2: 0.5 } },
  { g: 'Syngas, hydrogen & ammonia', label: 'Hydrogen — PSA product (99.9 %)', c: { H2: 99.9, CH4: 0.05, N2: 0.05 } },

  { g: 'Urea and CO₂-removal solvents', label: 'Urea reactor feed (urea method)', c: { NH3: 57.06134, CO2: 17.1184, H2O: 18.54494, urea: 7.13267, N2: 0.14265 } },
  { g: 'Urea and CO₂-removal solvents', label: 'Urea solution, 70 wt % (urea method)', b: 'mass%', c: { urea: 70, H2O: 30 } },
  { g: 'Urea and CO₂-removal solvents', label: 'CO₂ to urea synthesis', c: { CO2: 99.40358, N2: 0.59642 } },
  { g: 'Urea and CO₂-removal solvents', label: 'Lean MDEA, 40 wt % (amine method)', c: { 'methyl-diethanolamine': 9.1342, H2O: 90.8201, CO2: 0.0457 } },
  { g: 'Urea and CO₂-removal solvents', label: 'Lean MEA, 30 wt %, loading 0.2 (amine method)', b: 'mass%', c: { MEA: 28.76, H2O: 67.1, CO2: 4.14 } },
  { g: 'Urea and CO₂-removal solvents', label: 'Lean hot potassium carbonate (Benfield-type)', c: { K2CO3: 5.22177, H2O: 93.47279, CO2: 1.30544 } },

  { g: 'Water, steam & aqueous solutions', label: 'Water / steam', c: { H2O: 100 } },
  { g: 'Water, steam & aqueous solutions', label: 'Seawater (35 g/kg salinity)', c: { H2O: 98.99789, NaCl: 0.8628027, KCl: 0.01886833, CaCl2: 0.01917347, MgCl2: 0.04543828, MgSO4: 0.0521913, Na2CO3: 0.002029294, CO2: 0.001605369 } },
  { g: 'Water, steam & aqueous solutions', label: 'Brine — sodium chloride, 20 wt %', b: 'mass%', c: { NaCl: 20, H2O: 80 } },
  { g: 'Water, steam & aqueous solutions', label: 'Brine — calcium chloride, 25 wt %', b: 'mass%', c: { CaCl2: 25, H2O: 75 } },
  { g: 'Water, steam & aqueous solutions', label: 'Caustic soda, 20 wt % NaOH', b: 'mass%', c: { NaOH: 20, H2O: 80 } },
  { g: 'Water, steam & aqueous solutions', label: 'Sulphuric acid, 10 wt %', b: 'mass%', c: { H2SO4: 10, H2O: 90 } },
  { g: 'Water, steam & aqueous solutions', label: 'Hydrochloric acid, 10 wt %', b: 'mass%', c: { HCl: 10, H2O: 90 } },
  { g: 'Water, steam & aqueous solutions', label: 'Aqueous ammonia, 25 wt %', b: 'mass%', c: { NH3: 25, H2O: 75 } },
  { g: 'Water, steam & aqueous solutions', label: 'Sour water (refinery, typical)', c: { H2O: 96.4, NH3: 2.0, H2S: 1.5, CO2: 0.1 } },
  { g: 'Water, steam & aqueous solutions', label: 'Ethylene glycol – water, 50 wt %', b: 'mass%', c: { MEG: 50, H2O: 50 } },
  { g: 'Water, steam & aqueous solutions', label: 'Lean TEG, 99 wt % (gas dehydration)', b: 'mass%', c: { TEG: 99, H2O: 1 } },
  { g: 'Water, steam & aqueous solutions', label: 'Methanol – water, 80 wt % (crude methanol)', b: 'mass%', c: { MeOH: 80, H2O: 20 } },
  { g: 'Water, steam & aqueous solutions', label: 'Ethanol – water azeotrope (95.6 wt %)', b: 'mass%', c: { EtOH: 95.6, H2O: 4.4 } },
  { g: 'Water, steam & aqueous solutions', label: 'Fermentation broth (10 wt % ethanol)', b: 'mass%', c: { EtOH: 10, H2O: 90 } },

  { g: 'Refinery & hydrocarbon mixtures', label: 'Refinery fuel gas (typical)', c: { H2: 30, CH4: 40, C2H6: 12, C2H4: 3, C3H8: 7, C3H6: 3, nC4H10: 2, N2: 2, CO2: 0.9, H2S: 0.1 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'LPG — propane / butane', c: { C3H8: 60, nC4H10: 25, isobutane: 15 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'Commercial propane', c: { C3H8: 95, C2H6: 2.5, C3H6: 1.5, isobutane: 1 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'Light naphtha (surrogate)', c: { 'n-pentane': 10, isopentane: 10, nC6H14: 25, methylcyclopentane: 10, cyclohexane: 10, benzene: 5, nC7H16: 20, toluene: 10 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'Gasoline (surrogate: iso-octane / toluene / n-heptane)', b: 'mass%', c: { isooctane: 55, toluene: 30, nC7H16: 15 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'Kerosene / jet fuel (surrogate: n-decane / 1,2,4-trimethylbenzene)', b: 'mass%', c: { 'n-decane': 80, '1-2-4-trimethylbenzene': 20 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'Mixed xylenes', c: { oxylene: 20, 'm-xylene': 44, 'p-xylene': 20, ethylbenzene: 16 } },
  { g: 'Refinery & hydrocarbon mixtures', label: 'Benzene / toluene (50 / 50)', c: { benzene: 50, toluene: 50 } },

  { g: 'Refrigerants & cryogens', label: 'Ammonia (R-717)', c: { NH3: 100 } },
  { g: 'Refrigerants & cryogens', label: 'Carbon dioxide (R-744)', c: { CO2: 100 } },
  { g: 'Refrigerants & cryogens', label: 'Propane (R-290)', c: { C3H8: 100 } },
  { g: 'Refrigerants & cryogens', label: 'Isobutane (R-600a)', c: { isobutane: 100 } },
  { g: 'Refrigerants & cryogens', label: 'Propylene (R-1270)', c: { C3H6: 100 } },
  { g: 'Refrigerants & cryogens', label: 'Ethylene (R-1150)', c: { C2H4: 100 } },
  { g: 'Refrigerants & cryogens', label: 'R-32 (difluoromethane)', c: { difluoromethane: 100 } },
  { g: 'Refrigerants & cryogens', label: 'R-125 (pentafluoroethane)', c: { pentafluoroethane: 100 } },
  { g: 'Refrigerants & cryogens', label: 'R-143a (1,1,1-trifluoroethane)', c: { '1-1-1-trifluoroethane': 100 } },
  { g: 'Refrigerants & cryogens', label: 'R-1234yf (2,3,3,3-tetrafluoropropene)', c: { '2-3-3-3-tetrafluoropropene': 100 } },
  { g: 'Refrigerants & cryogens', label: 'R-410A (R-32 / R-125, 50 / 50 wt %)', b: 'mass%', c: { difluoromethane: 50, pentafluoroethane: 50 } },
  { g: 'Refrigerants & cryogens', label: 'R-507A (R-125 / R-143a, 50 / 50 wt %)', b: 'mass%', c: { pentafluoroethane: 50, '1-1-1-trifluoroethane': 50 } },
  { g: 'Refrigerants & cryogens', label: 'Mixed refrigerant (LNG, typical)', c: { N2: 5, CH4: 40, C2H6: 45, C3H8: 10 } },

  { g: 'Pure gases', label: 'Nitrogen', c: { N2: 100 } },
  { g: 'Pure gases', label: 'Oxygen', c: { O2: 100 } },
  { g: 'Pure gases', label: 'Hydrogen', c: { H2: 100 } },
  { g: 'Pure gases', label: 'Argon', c: { Ar: 100 } },
  { g: 'Pure gases', label: 'Helium', c: { He: 100 } },
  { g: 'Pure gases', label: 'Methane', c: { CH4: 100 } },
  { g: 'Pure gases', label: 'Carbon monoxide', c: { CO: 100 } },
  { g: 'Pure gases', label: 'Carbon dioxide', c: { CO2: 100 } },
  { g: 'Pure gases', label: 'Hydrogen sulphide', c: { H2S: 100 } },
  { g: 'Pure gases', label: 'Sulphur dioxide', c: { SO2: 100 } },
  { g: 'Pure gases', label: 'Ammonia', c: { NH3: 100 } },

  { g: 'Pure hydrocarbons', label: 'Ethane', c: { C2H6: 100 } },
  { g: 'Pure hydrocarbons', label: 'Propane', c: { C3H8: 100 } },
  { g: 'Pure hydrocarbons', label: 'n-Butane', c: { nC4H10: 100 } },
  { g: 'Pure hydrocarbons', label: 'Isobutane', c: { isobutane: 100 } },
  { g: 'Pure hydrocarbons', label: 'n-Pentane', c: { 'n-pentane': 100 } },
  { g: 'Pure hydrocarbons', label: 'n-Hexane', c: { nC6H14: 100 } },
  { g: 'Pure hydrocarbons', label: 'n-Heptane', c: { nC7H16: 100 } },
  { g: 'Pure hydrocarbons', label: 'n-Octane', c: { nC8H18: 100 } },
  { g: 'Pure hydrocarbons', label: 'n-Decane', c: { 'n-decane': 100 } },
  { g: 'Pure hydrocarbons', label: 'Ethylene', c: { C2H4: 100 } },
  { g: 'Pure hydrocarbons', label: 'Propylene', c: { C3H6: 100 } },
  { g: 'Pure hydrocarbons', label: '1,3-Butadiene', c: { '1-3-butadiene': 100 } },
  { g: 'Pure hydrocarbons', label: 'Cyclohexane', c: { cyclohexane: 100 } },
  { g: 'Pure hydrocarbons', label: 'Benzene', c: { benzene: 100 } },
  { g: 'Pure hydrocarbons', label: 'Toluene', c: { toluene: 100 } },
  { g: 'Pure hydrocarbons', label: 'Styrene', c: { styrene: 100 } },

  { g: 'Solvents & chemicals', label: 'Methanol', c: { MeOH: 100 } },
  { g: 'Solvents & chemicals', label: 'Ethanol', c: { EtOH: 100 } },
  { g: 'Solvents & chemicals', label: 'Isopropanol', c: { iPrOH: 100 } },
  { g: 'Solvents & chemicals', label: 'Acetone', c: { acetone: 100 } },
  { g: 'Solvents & chemicals', label: 'Methyl ethyl ketone', c: { mek: 100 } },
  { g: 'Solvents & chemicals', label: 'Ethyl acetate', c: { etoac: 100 } },
  { g: 'Solvents & chemicals', label: 'Acetic acid', c: { AcOH: 100 } },
  { g: 'Solvents & chemicals', label: 'Ethylene glycol (MEG)', c: { MEG: 100 } },
  { g: 'Solvents & chemicals', label: 'Triethylene glycol (TEG)', c: { TEG: 100 } },
  { g: 'Solvents & chemicals', label: 'Glycerol', c: { glycerol: 100 } },
  { g: 'Solvents & chemicals', label: 'Dichloromethane', c: { dichloromethane: 100 } },
  { g: 'Solvents & chemicals', label: 'Acetonitrile', c: { mecn: 100 } },
  { g: 'Solvents & chemicals', label: 'Tetrahydrofuran', c: { thf: 100 } },
  { g: 'Solvents & chemicals', label: 'Phenol', c: { phenol: 100 } },
  { g: 'Solvents & chemicals', label: 'Methyl tert-butyl ether', c: { 'methyl-tert-butyl-ether': 100 } },
  { g: 'Solvents & chemicals', label: 'Dimethyl ether', c: { 'dimethyl-ether': 100 } },
  { g: 'Solvents & chemicals', label: 'Ethylene oxide', c: { 'ethylene-oxide': 100 } },
  { g: 'Solvents & chemicals', label: 'Vinyl chloride', c: { 'vinyl-chloride': 100 } },
];

/** gallery list: what a card and the search need, without the flowsheet */
export function examplesList() {
  return EXAMPLES.map((x) => ({
    id: x.id, label: x.label, desc: x.desc,
    pkg: (x.model && x.model.pkg && x.model.pkg.model) || null,
    units: ((x.model && x.model.blocks) || []).length,
    note: !!x.note,
  }));
}
/** one example by id (a deep copy), or null */
export function exampleById(id) {
  const x = EXAMPLES.find((e) => e.id === id);
  return x ? JSON.parse(JSON.stringify({ id: x.id, label: x.label, model: x.model, note: x.note || null })) : null;
}
export function presetsList() { return JSON.parse(JSON.stringify(PRESETS)); }

export default { SIM_CONTENT_VERSION, examplesList, exampleById, presetsList };
