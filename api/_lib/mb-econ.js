// ============================================================================
// REPO PATH: api/_lib/mb-econ.js
// ============================================================================
// multicalci.com — STEP 36: capital and utility cost of a solved flowsheet.
//
// Equipment is sized from the flowsheet results and costed with the module
// costing technique of Turton, Bailie, Whiting, Shaeiwitz & Bhattacharyya,
// "Analysis, Synthesis, and Design of Chemical Processes", Appendix A
// (purchased cost at CEPCI 397, 2001 basis, carbon steel at ambient pressure):
//
//   log10 Cp0 = K1 + K2 log10 A + K3 (log10 A)²                    (A.1)
//   log10 FP  = C1 + C2 log10 P + C3 (log10 P)²   (P in barg)        (A.2)
//   FP,vessel = [ (P+1) D / (2 (850 − 0.6 (P+1))) + 0.00315 ] / 0.0063 (A.3)
//   CBM = Cp0 (B1 + B2 FM FP)   (exchangers, vessels, pumps)        (A.4)
//   CBM = Cp0 FBM               (compressors, drives, fired heaters)
//   CTM = 1.18 Σ CBM ;  CGR = CTM + 0.50 Σ CBM0                      (ch. 7)
//
// and escalated with the CE plant cost index. Sizes outside a correlation's
// range are split into equal parallel units above the maximum and extrapolated
// (and flagged) below the minimum. Utilities: steam levels chosen by the
// process temperature, cooling water, chilled water or refrigeration for
// coolers, fuel for duties above the highest steam level, electricity for
// pumps and compressors. Annualised capital uses the capital recovery factor.
// A study estimate (Turton: −20 % / +30 %) — not a quotation.
//
// (c) multicalci.com
// ============================================================================

'use strict';

import if97 from './if97.js';

export const ECON_VERSION = 'mb-econ 1.0.0';
export const CEPCI_BASE = 397;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const log10 = Math.log10;
const R_GAS = 8.314462618;             // kJ/(kmol K)

/** Turton Table A.1: [K1, K2, K3], size range, size unit */
export const CORR = {
  hx_floating: { K: [4.8306, -0.8509, 0.3187], range: [10, 1000], unit: 'm²', label: 'Shell and tube, floating head', B: [1.63, 1.66], P: 'hx' },
  hx_fixed: { K: [4.3247, -0.3030, 0.1634], range: [10, 1000], unit: 'm²', label: 'Shell and tube, fixed tube sheet', B: [1.63, 1.66], P: 'hx' },
  hx_utube: { K: [4.1884, -0.2503, 0.1974], range: [10, 1000], unit: 'm²', label: 'Shell and tube, U-tube', B: [1.63, 1.66], P: 'hx' },
  hx_kettle: { K: [4.4646, -0.5277, 0.3955], range: [10, 100], unit: 'm²', label: 'Kettle reboiler', B: [1.63, 1.66], P: 'hx' },
  hx_double_pipe: { K: [3.3444, 0.2745, -0.0472], range: [1, 10], unit: 'm²', label: 'Double pipe', B: [1.74, 1.55], P: 'hx' },
  air_cooler: { K: [4.0336, 0.2341, 0.0497], range: [10, 10000], unit: 'm²', label: 'Air cooler', B: [0.96, 1.21], P: 'air' },
  pump_centrifugal: { K: [3.3892, 0.0536, 0.1538], range: [1, 300], unit: 'kW', label: 'Centrifugal pump', B: [1.89, 1.35], P: 'pump' },
  compressor_centrifugal: { K: [2.2897, 1.3604, -0.1027], range: [450, 3000], unit: 'kW', label: 'Centrifugal compressor', FBM: { CS: 2.7, SS: 5.8, Ni: 11.5 } },
  compressor_reciprocating: { K: [2.2897, 1.3604, -0.1027], range: [450, 3000], unit: 'kW', label: 'Reciprocating compressor', FBM: { CS: 3.4, SS: 7.0, Ni: 13.9 } },
  drive_electric: { K: [2.4604, 1.4191, -0.1798], range: [75, 2600], unit: 'kW', label: 'Electric drive (explosion-proof)', FBM: { CS: 1.5, SS: 1.5, Ni: 1.5 } },
  vessel_vertical: { K: [3.4974, 0.4485, 0.1074], range: [0.3, 520], unit: 'm³', label: 'Vertical vessel', B: [2.25, 1.82], P: 'vessel' },
  vessel_horizontal: { K: [3.5565, 0.3776, 0.0905], range: [0.1, 628], unit: 'm³', label: 'Horizontal vessel', B: [1.49, 1.52], P: 'vessel' },
  tower: { K: [3.4974, 0.4485, 0.1074], range: [0.3, 520], unit: 'm³', label: 'Tower shell', B: [2.25, 1.82], P: 'vessel' },
  tray_sieve: { K: [2.9949, 0.4465, 0.3961], range: [0.07, 12.3], unit: 'm²', label: 'Sieve trays', FBM: { CS: 1.0, SS: 1.8, Ni: 5.6 } },
  fired_heater: { K: [7.3488, -1.1666, 0.2028], range: [1000, 100000], unit: 'kW', label: 'Fired process heater', FBM: { CS: 2.13, SS: 2.81, Ni: 2.81 } },
};
/** Turton Table A.2 pressure factors [C1, C2, C3] and the barg range they apply in (below: FP = 1) */
const PFAC = {
  hx_both: { C: [0.03881, -0.11272, 0.08183], range: [5, 140] },
  hx_tube: { C: [-0.00164, -0.00627, 0.0123], range: [5, 140] },
  air: { C: [-0.125, 0.15361, -0.02861], range: [10, 100] },
  pump: { C: [-0.3935, 0.3957, -0.00226], range: [10, 100] },
};
/** material factors FM (Turton Fig. A.18) */
const FMAT = {
  hx: { CS: 1.0, 'CS/SS': 1.81, SS: 2.73, 'CS/Ni': 2.68, Ni: 3.73, 'CS/Ti': 4.63 },
  pump: { CS: 1.6, SS: 2.3, Ni: 4.4, CI: 1.0 },
  vessel: { CS: 1.0, 'SS clad': 1.7, SS: 3.1, 'Ni clad': 3.6, Ni: 7.1 },
};
export const MATERIALS = { hx: Object.keys(FMAT.hx), pump: Object.keys(FMAT.pump), vessel: Object.keys(FMAT.vessel), machine: ['CS', 'SS', 'Ni'] };

/** default settings (prices are examples — every site sets its own) */
export const DEFAULTS = {
  cepci: 797.9,                   // CE plant cost index, 2023 annual average (Chemical Engineering, March 2024)
  currency: 'USD', rate: 1,       // equipment costs are US Gulf Coast basis in USD; rate (currency per USD) converts them —
                                  // utility prices are entered in the display currency
  hours: 8000, interest: 0.10, years: 10,
  dT_util_K: 10,                  // minimum approach to a utility
  steam: [{ name: 'LP steam', P_barg: 5, price_GJ: 14 }, { name: 'MP steam', P_barg: 10, price_GJ: 15 }, { name: 'HP steam', P_barg: 41, price_GJ: 18 }],
  fuel_GJ: 10, furnace_eff: 0.9,
  cw: { T_in_C: 30, T_out_C: 40, price_GJ: 0.4 },
  chilled: { T_in_C: 5, T_out_C: 15, price_GJ: 4.5 },
  refrig_GJ: 8,
  electricity_kWh: 0.08, motor_eff: 0.95,
};
/** overall coefficients, W/m²K, by service (typical values for preliminary sizing) */
const U_DEF = {
  steam: { liquid: 850, gas: 120, change: 1100 },
  cooling: { liquid: 750, gas: 150, change: 900 },
  process: { liquid: 500, gas: 120, change: 600 },
};

const costA = (c, A) => Math.pow(10, c.K[0] + c.K[1] * log10(A) + c.K[2] * log10(A) * log10(A));
function pressureFactor(key, Pg) {
  const f = PFAC[key];
  if (!f || !(Pg > f.range[0])) return { FP: 1 };
  const P = Math.min(Pg, f.range[1]);
  const L = log10(P);
  return { FP: Math.pow(10, f.C[0] + f.C[1] * L + f.C[2] * L * L), clipped: Pg > f.range[1] };
}
function vesselFP(Pg, D) {
  if (Pg < -0.5) return 1.25;
  const fp = ((Pg + 1) * D / (2 * (850 - 0.6 * (Pg + 1))) + 0.00315) / 0.0063;
  return Math.max(1, fp);
}
/** purchased cost at CEPCI 397 for size A — equal parallel units above the range; below it the
 *  cost at the minimum size scaled with the six-tenths rule (the fitted curves are not used outside
 *  their data: several bend upwards at small sizes) */
function sized(c, A) {
  const [lo, hi] = c.range;
  let n = 1, a = A;
  if (A > hi) { n = Math.ceil(A / hi); a = A / n; }
  const below = a < lo;
  const each = below ? costA(c, lo) * Math.pow(a / lo, 0.6) : costA(c, a);
  return { n, a, Cp0: n * each, below, split: n > 1 };
}

/** steam / fuel for a heating duty at a process temperature; cooling medium for a cooling duty */
function heatingUtility(S, Tmax_K) {
  for (const st of S.steam) {
    const Ts = if97.tsat_K(st.P_barg + 1.01325);
    if (Ts >= Tmax_K + S.dT_util_K) return { kind: st.name, T_K: Ts, P_barg: st.P_barg, price_GJ: st.price_GJ, steam: true };
  }
  return { kind: 'Fuel (fired heater)', fired: true, price_GJ: S.fuel_GJ / S.furnace_eff };
}
function coolingUtility(S, Tmin_K) {
  if (Tmin_K >= S.cw.T_in_C + 273.15 + S.dT_util_K) return { kind: 'Cooling water', Tin_K: S.cw.T_in_C + 273.15, Tout_K: S.cw.T_out_C + 273.15, price_GJ: S.cw.price_GJ };
  if (Tmin_K >= S.chilled.T_in_C + 273.15 + S.dT_util_K) return { kind: 'Chilled water', Tin_K: S.chilled.T_in_C + 273.15, Tout_K: S.chilled.T_out_C + 273.15, price_GJ: S.chilled.price_GJ };
  return { kind: 'Refrigeration', Tin_K: Tmin_K - S.dT_util_K, Tout_K: Tmin_K - S.dT_util_K, price_GJ: S.refrig_GJ };
}
/** counter-current log-mean ΔT from the two end differences (≤ 0 → not feasible) */
function lmtd(d1, d2) {
  if (!(d1 > 0) || !(d2 > 0)) return NaN;
  if (Math.abs(d1 - d2) < 1e-6 * Math.max(d1, d2)) return (d1 + d2) / 2;
  return (d1 - d2) / Math.log(d1 / d2);
}
const phaseClass = (vfIn, vfOut) => (num(vfIn) && num(vfOut) ? (vfIn >= 0.95 && vfOut >= 0.95 ? 'gas' : vfIn <= 0.05 && vfOut <= 0.05 ? 'liquid' : 'change') : null);

/** vapour fraction and densities of a calculated stream (property method when present, else estimates) */
function streamPhys(s) {
  const out = { vf: NaN, rhoV: NaN, rhoL: NaN, mw: s && num(s.mw_avg) ? s.mw_avg : NaN, estV: null, estL: null };
  if (!s) return out;
  if (num(s.vapour_fraction)) out.vf = s.vapour_fraction;
  else if (s.rig && num(s.rig.beta)) out.vf = s.rig.beta;
  const ph = s.rig && s.rig.props && Array.isArray(s.rig.props.phases) ? s.rig.props.phases : [];
  for (const q of ph) {
    if (q.type === 'vapour' && num(q.rho_kgm3)) out.rhoV = q.rho_kgm3;
    if ((q.type === 'liquid' || q.type === 'liquid2') && num(q.rho_kgm3) && !num(out.rhoL)) out.rhoL = q.rho_kgm3;
  }
  if (!num(out.rhoV) && num(out.mw) && num(s.T_K) && num(s.P_bar)) { out.rhoV = s.P_bar * 100 * out.mw / (R_GAS * s.T_K); out.estV = 'vapour density as ideal gas'; }
  if (!num(out.rhoL)) { out.rhoL = 800; out.estL = 'liquid density 800 kg/m³ (no property method)'; }
  return out;
}

/**
 * Cost a solved flowsheet.
 * units: [{ id, name, module, equip?, params, result, inlets: [stream], outlets: [stream] }]
 * settings: DEFAULTS merged with the user's, plus units: {id: {equip?, material?, U_W_m2K?, volume_m3?, exclude?}}
 */
export function computeEconomics(units, settings, ctx) {
  const S = mergeSettings(settings);
  const esc = S.cepci / CEPCI_BASE * S.rate;
  const items = [], skipped = [], util = new Map();
  const addUtil = (kind, Q_kW, price_GJ) => {
    const u = util.get(kind) || { kind, duty_kW: 0, price_GJ, cost_y: 0 };
    u.duty_kW += Q_kW;
    u.cost_y += Q_kW * 3600 * S.hours / 1e6 * price_GJ;
    util.set(kind, u);
    return Q_kW * 3600 * S.hours / 1e6 * price_GJ;
  };
  let elec_kW = 0;
  for (const u of units) {
    const o = (S.units && S.units[u.id]) || {};
    if (o.exclude) { skipped.push({ block: u.id, name: u.name, reason: 'excluded' }); continue; }
    const equip = o.equip || u.equip || inferEquip(u.module);
    const R = u.result || {}, D = R.details || {}, EB = R.energy_balance || {};
    const out0 = (u.outlets || [])[0], in0 = (u.inlets || [])[0];
    const Pout_g = (s) => (s && num(s.P_bar) ? s.P_bar - 1.01325 : 0);
    const Pmax_g = Math.max(0, ...[...(u.inlets || []), ...(u.outlets || [])].filter((s) => s && num(s.P_bar)).map((s) => s.P_bar - 1.01325));
    const it = { block: u.id, name: u.name, equip, parts: [], notes: [], utility: null };
    const mat = (grp, def) => { const m = o.material && FMAT[grp] && FMAT[grp][o.material] !== undefined ? o.material : o.material && grp === 'machine' && ['CS', 'SS', 'Ni'].includes(o.material) ? o.material : def; return m; };
    /** a part costed by Turton A.4 (exchangers, vessels, pumps) or a direct FBM */
    const part = (key, A, opts) => {
      const c = CORR[key];
      const z = sized(c, A);
      let FP = 1, FM = 1, FBM, FBM0, pnote = null;
      if (c.B) {
        if (c.P === 'vessel') FP = vesselFP(opts.Pg || 0, opts.D || 1);
        else if (c.P === 'hx') { const pf = pressureFactor(opts.Pkey || 'hx_both', opts.Pg || 0); FP = pf.FP; if (pf.clipped) pnote = 'pressure above the correlation range (140 barg) — factor at 140 barg'; }
        else if (c.P) { const pf = pressureFactor(c.P, opts.Pg || 0); FP = pf.FP; if (pf.clipped) pnote = 'pressure above the correlation range — factor at its maximum'; }
        FM = opts.FM || 1;
        FBM = c.B[0] + c.B[1] * FM * FP;
        FBM0 = c.B[0] + c.B[1];
      } else {
        FBM = c.FBM[opts.mat || 'CS'] || c.FBM.CS;
        FBM0 = c.FBM.CS;
      }
      const Fq = opts.Fq || 1, N = opts.N || 1;
      const Cp0 = z.Cp0 * N * Fq;
      const p = { type: c.label, key, size: +A.toPrecision(5), size_unit: c.unit, n_units: z.n, material: opts.matLabel || 'CS', P_barg: num(opts.Pg) ? +opts.Pg.toPrecision(4) : undefined,
        FM: +FM.toFixed(3), FP: +FP.toFixed(3), FBM: +FBM.toFixed(3), Cp0: Cp0 * esc, CBM: Cp0 * FBM * esc, CBM0: Cp0 * FBM0 * esc, below_range: z.below || undefined, split: z.split || undefined };
      if (N > 1) p.count = N;
      if (z.below) p.note = `size below the correlation range (${c.range[0]} ${c.unit}) — cost at ${c.range[0]} ${c.unit} scaled by the 0.6 power`;
      if (z.split) p.note = `${z.n} parallel units of ${(+z.a.toPrecision(4))} ${c.unit} (correlation maximum ${c.range[1]} ${c.unit})`;
      if (pnote) p.note = (p.note ? p.note + '; ' : '') + pnote;
      it.parts.push(p);
      return p;
    };
    const exchanger = (Q_kW, dTlm, Ukey, cls, Pg, Pkey, label) => {
      const Uv = num(o.U_W_m2K) && o.U_W_m2K > 0 ? o.U_W_m2K : U_DEF[Ukey][cls || 'liquid'] || 300;
      if (!(dTlm > 0)) { it.notes.push((label ? label + ': ' : '') + 'no positive temperature difference to the utility — area not sized'); return null; }
      const A = Math.abs(Q_kW) * 1000 / (Uv * dTlm);
      const key = o.hx_type && CORR[o.hx_type] ? o.hx_type : A < 10 ? 'hx_double_pipe' : 'hx_floating';
      const m = mat('hx', 'CS');
      const p = part(key, A, { Pg, Pkey, FM: FMAT.hx[m], matLabel: m });
      p.U_W_m2K = Uv; p.dTlm_K = +dTlm.toPrecision(4); p.duty_kW = +Math.abs(Q_kW).toPrecision(6);
      if (label) p.role = label;
      return p;
    };
    /** a utility heater / cooler for duty Q between process temperatures Tin → Tout */
    const utilityExchanger = (Q, Tin, Tout, cls, Pg, label) => {
      if (Math.abs(Q) < 1e-6) return;
      if (Q > 0) {
        const ut = heatingUtility(S, Math.max(Tin, Tout));
        if (ut.fired) {
          const m = mat('machine', 'CS');
          const p = part('fired_heater', Q, { mat: m, matLabel: m });
          p.duty_kW = +Q.toPrecision(6);
          if (label) p.role = label;
          p.note = (p.note ? p.note + '; ' : '') + 'pressure factor not applied';
        } else exchanger(Q, lmtd(ut.T_K - Tout, ut.T_K - Tin), 'steam', cls, ut.P_barg >= 5 ? Math.max(Pg, ut.P_barg) : Pg, ut.P_barg >= 5 ? 'hx_both' : 'hx_tube', label);
        const c = addUtil(ut.kind, Q, ut.price_GJ);
        it.utility = (it.utility || []).concat([{ kind: ut.kind, duty_kW: +Q.toPrecision(6), cost_y: c }]);
      } else {
        const ut = coolingUtility(S, Math.min(Tin, Tout));
        const d1 = Tin - ut.Tout_K, d2 = Tout - ut.Tin_K;
        exchanger(Q, lmtd(d1, d2), 'cooling', cls, Pg, 'hx_tube', label);
        const c = addUtil(ut.kind, -Q, ut.price_GJ);
        it.utility = (it.utility || []).concat([{ kind: ut.kind, duty_kW: +(-Q).toPrecision(6), cost_y: c }]);
      }
    };
    const electric = (W) => { elec_kW += W / S.motor_eff; const c = W / S.motor_eff * S.hours * S.electricity_kWh; it.utility = (it.utility || []).concat([{ kind: 'Electricity', duty_kW: +(W / S.motor_eff).toPrecision(6), cost_y: c }]); };
    const vesselFromVolume = (V, Pg, key, label, LD) => {
      const vkey = key || 'vessel_vertical';
      const ld = num(o.L_D) && o.L_D >= 1 && o.L_D <= 30 ? o.L_D : LD || 3;
      const D = Math.cbrt(4 * V / (ld * Math.PI));
      const m = mat('vessel', 'CS');
      const p = part(vkey, V, { Pg, D, FM: FMAT.vessel[m], matLabel: m });
      p.D_m = +D.toPrecision(3); p.L_D = ld;
      wallNote(p);
      if (label) p.role = label;
      return p;
    };
    /** Turton's vessel pressure factor is the wall thickness (incl. 3.15 mm corrosion allowance) over 6.3 mm */
    const wallNote = (p) => { if (p.FP > 10) p.note = (p.note ? p.note + '; ' : '') + `thick-walled (about ${Math.round(p.FP * 6.3)} mm carbon-steel wall by the ASME formula) — compare with a vendor quote`; };
    try {
      switch (equip) {
        case 'heater': case 'cooler': case 'heat-utility': {
          const Q = num(D.duty_kW) ? D.duty_kW : EB.Q_kW;
          if (!num(Q) || Math.abs(Q) < 1e-6) { skipped.push({ block: u.id, name: u.name, reason: 'no duty' }); continue; }
          const Tin = num(D.T_in_K) ? D.T_in_K : in0 && in0.T_K, Tout = num(D.T_out_K) ? D.T_out_K : out0 && out0.T_K;
          const cls = phaseClass(num(D.vapour_fraction_in) ? D.vapour_fraction_in : streamPhys(in0).vf, num(D.vapour_fraction_out) ? D.vapour_fraction_out : streamPhys(out0).vf);
          utilityExchanger(Q, Tin, Tout, cls, Pmax_g);
          break;
        }
        case 'hx': {
          // two-stream exchanger: area from the engine's UA when given, else from the terminal temperatures
          const Q = num(D.duty_kW) ? Math.abs(D.duty_kW) : NaN;
          if (!num(Q) || Q < 1e-6) { skipped.push({ block: u.id, name: u.name, reason: 'no duty' }); continue; }
          const Uv = num(o.U_W_m2K) && o.U_W_m2K > 0 ? o.U_W_m2K : null;
          let A = null, dT = null;
          const sides = (u.inlets || []).map((s, k) => [s, (u.outlets || [])[k]]);
          const cls = sides.map(([a, b]) => phaseClass(streamPhys(a).vf, streamPhys(b).vf));
          const anyGas = cls.includes('gas'), anyChange = cls.includes('change');
          const Ud = Uv || (anyGas ? U_DEF.process.gas : anyChange ? U_DEF.process.change : U_DEF.process.liquid);
          if (num(D.UA_kW_K) && D.UA_kW_K > 0) { A = D.UA_kW_K * 1000 / Ud; dT = Q / D.UA_kW_K; }
          else if (sides.length === 2 && sides.every(([a, b]) => a && b)) {
            const [h, c] = sides[0][0].T_K > sides[1][0].T_K ? sides : [sides[1], sides[0]];
            dT = lmtd(h[0].T_K - c[1].T_K, h[1].T_K - c[0].T_K);
            if (dT > 0) A = Q * 1000 / (Ud * dT);
          }
          if (!(A > 0)) { it.notes.push('exchanger area could not be found (temperature cross)'); break; }
          const key = o.hx_type && CORR[o.hx_type] ? o.hx_type : A < 10 ? 'hx_double_pipe' : 'hx_floating';
          const m = mat('hx', 'CS');
          const p = part(key, A, { Pg: Pmax_g, Pkey: 'hx_both', FM: FMAT.hx[m], matLabel: m });
          p.U_W_m2K = Ud; p.dTlm_K = +dT.toPrecision(4); p.duty_kW = +Q.toPrecision(6);
          break;
        }
        case 'pump': {
          const W = num(EB.W_kW) ? EB.W_kW : D.power_kW;
          if (!(W > 0)) { skipped.push({ block: u.id, name: u.name, reason: 'no power' }); continue; }
          const m = mat('pump', 'CS');
          part('pump_centrifugal', W, { Pg: Pout_g(out0), FM: FMAT.pump[m], matLabel: m });
          electric(W);
          break;
        }
        case 'compressor': {
          const W = num(EB.W_kW) ? EB.W_kW : D.power_kW;
          if (!(W > 0)) { skipped.push({ block: u.id, name: u.name, reason: 'no power' }); continue; }
          const m = mat('machine', 'CS');
          part(o.compressor_type === 'reciprocating' ? 'compressor_reciprocating' : 'compressor_centrifugal', W, { mat: m, matLabel: m });
          part('drive_electric', W / S.motor_eff, { mat: 'CS' });
          electric(W);
          break;
        }
        case 'ctrain': {
          const st = Array.isArray(D.stages) ? D.stages : [];
          if (!st.length) { skipped.push({ block: u.id, name: u.name, reason: 'no stage results' }); continue; }
          const m = mat('machine', 'CS');
          let Wt = 0;
          st.forEach((s, k) => {
            if (num(s.power_kW) && s.power_kW > 0) { const p = part(o.compressor_type === 'reciprocating' ? 'compressor_reciprocating' : 'compressor_centrifugal', s.power_kW, { mat: m, matLabel: m }); p.role = 'stage ' + (k + 1); Wt += s.power_kW; }
            if (num(s.cooler_duty_kW) && s.cooler_duty_kW < -1e-6 && num(s.T_discharge_K)) {
              const Tc = num(s.T_cooled_K) ? s.T_cooled_K : (num(o.intercooler_T_K) ? o.intercooler_T_K : (u.params && num(u.params.intercooler_T_K) ? u.params.intercooler_T_K : 313.15));
              utilityExchanger(s.cooler_duty_kW, s.T_discharge_K, Tc, 'gas', num(s.P_discharge_bar) ? s.P_discharge_bar - 1.01325 : Pmax_g, 'cooler ' + (k + 1));
            }
          });
          if (Wt > 0) { part('drive_electric', Wt / S.motor_eff, { mat: 'CS' }); electric(Wt); }
          break;
        }
        case 'drum': {
          // vertical drum: Souders–Brown (K = 0.107 m/s with a mesh pad) for the vapour, 5 min liquid hold-up
          const vapOut = (u.outlets || [])[0], liqOuts = (u.outlets || []).slice(1).filter(Boolean);
          const pv = streamPhys(vapOut), pl = liqOuts.length ? streamPhys(liqOuts[0]) : { rhoL: 800, estL: null };
          const mV = vapOut && num(vapOut.mass_flow_kg_h) ? vapOut.mass_flow_kg_h : 0;
          const mL = liqOuts.reduce((a, s) => a + (num(s.mass_flow_kg_h) ? s.mass_flow_kg_h : 0), 0);
          const rhoV = num(pv.rhoV) ? pv.rhoV : 1, rhoL = num(pl.rhoL) ? pl.rhoL : 800;
          const Qv = mV / rhoV / 3600, Ql = mL / rhoL / 3600;
          let Dm = 0.3;
          if (Qv > 0 && rhoL > rhoV) { const uMax = 0.107 * Math.sqrt((rhoL - rhoV) / rhoV); Dm = Math.max(Dm, Math.sqrt(4 * Qv / (Math.PI * uMax))); }
          const tau = Qv > 0 ? 300 : 600;
          let H = Ql * tau / (Math.PI * Dm * Dm / 4) + (Qv > 0 ? 1.5 * Dm : 0.5 * Dm);
          if (H < 3 * Dm) H = 3 * Dm;
          if (H > 5 * Dm) { Dm = Math.cbrt(4 * Ql * tau / (Math.PI * (5 - (Qv > 0 ? 1.5 : 0.5)))); H = 5 * Dm; }
          const V = Math.PI * Dm * Dm / 4 * H;
          const m0 = mat('vessel', 'CS');
          const p = part('vessel_vertical', V, { Pg: Pmax_g, D: Dm, FM: FMAT.vessel[m0], matLabel: m0 });
          p.D_m = +Dm.toPrecision(3); p.H_m = +H.toPrecision(3);
          wallNote(p);
          const est = [mV > 0 ? pv.estV : null, mL > 0 ? pl.estL : null].filter(Boolean);
          if (est.length) it.notes.push(est.join(', '));
          const Q = num(D.duty_kW) ? D.duty_kW : EB.Q_kW;
          if (num(Q) && Math.abs(Q) > 1) utilityExchanger(Q, in0 ? in0.T_K : out0.T_K, out0 ? out0.T_K : in0.T_K, 'change', Pmax_g, 'duty');
          break;
        }
        case 'column': {
          const prof = Array.isArray(D.profile) ? D.profile : [];
          if (!prof.length) { skipped.push({ block: u.id, name: u.name, reason: 'no stage profile' }); continue; }
          const cond = u.params && u.params.condenser && u.params.condenser !== 'none', reb = u.params && u.params.reboiler && u.params.reboiler !== 'none';
          const trays = Math.max(1, prof.length - (cond ? 1 : 0) - (reb ? 1 : 0));
          const mwOf = (ctx && ctx.mw) || (() => NaN);
          const bot = (u.outlets || [])[1];
          const rhoL = num(o.rho_L) ? o.rho_L : (bot ? streamPhys(bot).rhoL : 800);
          let Qmax = 0, rhoAt = 1;
          for (const s of prof) {
            if (!num(s.V_kmol_h) || s.V_kmol_h <= 0) continue;
            const y = s.y || {};
            let mw = 0, sy = 0;
            for (const k in y) { const w = mwOf(k); if (num(w)) { mw += y[k] * w; sy += y[k]; } }
            mw = sy > 0 ? mw / sy : 30;
            const rhoV = s.P_bar * 100 * mw / (R_GAS * s.T_K);
            const Qv = s.V_kmol_h * mw / rhoV / 3600;
            if (Qv > Qmax) { Qmax = Qv; rhoAt = rhoV; }
          }
          // Souders–Brown, C = 0.08 m/s at 0.6 m tray spacing, 80 % of flooding, 90 % of the area active
          const uf = 0.08 * Math.sqrt(Math.max(rhoL - rhoAt, 1) / rhoAt);
          const Dc = Math.max(0.3, Math.sqrt(4 * Qmax / (Math.PI * 0.8 * uf * 0.9)));
          const Hc = trays * 0.6 + 3;
          const V = Math.PI * Dc * Dc / 4 * Hc;
          const m = mat('vessel', 'CS');
          const pt = part('tower', V, { Pg: Pmax_g, D: Dc, FM: FMAT.vessel[m], matLabel: m });
          pt.D_m = +Dc.toPrecision(3); pt.H_m = +Hc.toPrecision(3); pt.role = 'shell';
          wallNote(pt);
          const Fq = trays < 20 ? Math.pow(10, 0.4771 + 0.08516 * log10(trays) - 0.3473 * log10(trays) * log10(trays)) : 1;
          const tm = ['CS', 'SS', 'Ni'].includes(m) ? m : (m.startsWith('SS') ? 'SS' : m.startsWith('Ni') ? 'Ni' : 'CS');
          const ptr = part('tray_sieve', Math.PI * Dc * Dc / 4, { N: trays, Fq, mat: tm, matLabel: tm });
          ptr.role = trays + ' trays';
          if (cond && num(D.condenser_duty_kW) && D.condenser_duty_kW < 0) utilityExchanger(D.condenser_duty_kW, prof[0].T_K + 0.5, prof[0].T_K, 'change', Pmax_g, 'condenser');
          if (reb && num(D.reboiler_duty_kW) && D.reboiler_duty_kW > 0) {
            const Tb = prof[prof.length - 1].T_K;
            const ut = heatingUtility(S, Tb);
            if (ut.fired) utilityExchanger(D.reboiler_duty_kW, Tb - 0.5, Tb, 'change', Pmax_g, 'reboiler');
            else {
              const Uv = num(o.U_W_m2K) && o.U_W_m2K > 0 ? o.U_W_m2K : U_DEF.steam.change;
              const A = D.reboiler_duty_kW * 1000 / (Uv * (ut.T_K - Tb));
              const mm = mat('hx', 'CS');
              const p = part(A <= 100 ? 'hx_kettle' : 'hx_floating', A, { Pg: Pmax_g, Pkey: 'hx_both', FM: FMAT.hx[mm], matLabel: mm });
              p.role = 'reboiler'; p.U_W_m2K = Uv; p.dTlm_K = +(ut.T_K - Tb).toPrecision(4); p.duty_kW = +D.reboiler_duty_kW.toPrecision(6);
              const c = addUtil(ut.kind, D.reboiler_duty_kW, ut.price_GJ);
              it.utility = (it.utility || []).concat([{ kind: ut.kind, duty_kW: +D.reboiler_duty_kW.toPrecision(6), cost_y: c }]);
            }
          }
          it.notes.push('reflux drum and pumps not included; column diameter at 80 % of flooding (Souders–Brown C = 0.08 m/s)');
          break;
        }
        case 'stripper': {
          // falling-film stripper: costed as its steam-heated exchange area plus the HP steam it uses
          const Q = num(D.heat_input_kW) ? D.heat_input_kW : EB.Q_kW;
          if (!(Q > 0) || !num(D.steam_T_sat_K) || !num(D.T_bottom_K)) { skipped.push({ block: u.id, name: u.name, reason: 'no heat input' }); continue; }
          const Uv = num(o.U_W_m2K) && o.U_W_m2K > 0 ? o.U_W_m2K : 1000;
          const A = Q * 1000 / (Uv * Math.max(1, D.steam_T_sat_K - D.T_bottom_K));
          const m = mat('hx', 'SS');
          const p = part('hx_fixed', A, { Pg: Pmax_g, Pkey: 'hx_both', FM: FMAT.hx[m], matLabel: m });
          p.U_W_m2K = Uv; p.duty_kW = +Q.toPrecision(6); p.role = 'exchange area';
          const price = (S.steam.find((st) => if97.tsat_K(st.P_barg + 1.01325) >= D.steam_T_sat_K - 1) || S.steam[S.steam.length - 1]).price_GJ;
          const c = addUtil('Stripper steam', Q, price);
          it.utility = [{ kind: 'Stripper steam', duty_kW: +Q.toPrecision(6), cost_y: c }];
          break;
        }
        case 'reactor': {
          const P = u.params || {};
          const Q = num(D.duty_kW) ? D.duty_kW : EB.Q_kW;
          // a kinetic tube reactor: fired coil / multitubular exchanger / single vessel by its geometry
          const tubeGeom = num(P.length_m) && P.length_m > 0 && num(P.diameter_m) && P.diameter_m > 0 && !num(o.volume_m3);
          if (tubeGeom) {
            const nt = num(P.tubes) && P.tubes >= 1 ? P.tubes : 1;
            if (P.thermal === 'coolant' && num(P.T_coolant_K) && P.T_coolant_K > 773.15 && num(Q) && Q > 1) {
              const m = mat('machine', 'CS');
              const p = part('fired_heater', Q, { mat: m, matLabel: m });
              p.role = 'fired tubular reactor'; p.duty_kW = +Q.toPrecision(6);
              p.note = (p.note ? p.note + '; ' : '') + 'costed as a process heater on its absorbed duty — reactor tubes, catalyst and convection section not included';
              const c = addUtil('Fuel (fired heater)', Q, S.fuel_GJ / S.furnace_eff);
              it.utility = [{ kind: 'Fuel (fired heater)', duty_kW: +Q.toPrecision(6), cost_y: c }];
              break;
            }
            if (nt > 1 || P.thermal === 'coolant') {
              const A = Math.PI * P.diameter_m * P.length_m * nt;
              const m = mat('hx', 'CS');
              const p = part(o.hx_type && CORR[o.hx_type] ? o.hx_type : 'hx_fixed', A, { Pg: Pmax_g, Pkey: 'hx_both', FM: FMAT.hx[m], matLabel: m });
              p.role = nt + ' tube' + (nt > 1 ? 's' : '') + ' of ' + (+P.diameter_m.toPrecision(3)) + ' m × ' + (+P.length_m.toPrecision(4)) + ' m';
              p.note = (p.note ? p.note + '; ' : '') + 'multitubular reactor costed as a fixed-tube-sheet exchanger on its tube area — catalyst and coolant system not included';
              if (num(Q) && Math.abs(Q) > 1) it.notes.push(`${Math.round(Math.abs(Q))} kW ${Q < 0 ? 'removed by' : 'supplied by'} the coolant — the coolant system is not costed`);
              break;
            }
          }
          const V = num(o.volume_m3) && o.volume_m3 > 0 ? o.volume_m3 : num(P.volume_m3) && P.volume_m3 > 0 ? P.volume_m3
            : tubeGeom ? Math.PI / 4 * P.diameter_m * P.diameter_m * P.length_m * (num(P.tubes) && P.tubes >= 1 ? P.tubes : 1) : null;
          if (!V) { skipped.push({ block: u.id, name: u.name, reason: 'no reactor volume — enter one under Costing for this unit' }); continue; }
          vesselFromVolume(V, Pmax_g, 'vessel_vertical', 'reactor vessel', /urea/.test(u.module) ? 10 : 4);
          it.notes.push('catalyst, internals and jacket not included');
          if (num(Q) && Math.abs(Q) > 1) {
            const T = out0 ? out0.T_K : in0.T_K;
            if (Q < 0 && T > 423.15) it.notes.push(`${Math.round(-Q)} kW of reaction heat above 150 °C — available for steam raising, not credited`);
            else utilityExchanger(Q, T - Math.sign(Q) * 0.5, T, 'change', Pmax_g, 'duty');
          }
          break;
        }
        case 'reformer': {
          const Q = EB.Q_kW;
          if (!(Q > 1)) { skipped.push({ block: u.id, name: u.name, reason: 'no fired duty — for a secondary (autothermal) reformer choose Reactor vessel under Costing and enter its volume' }); continue; }
          const m = mat('machine', 'CS');
          const p = part('fired_heater', Q, { mat: m, matLabel: m });
          p.role = 'radiant duty'; p.duty_kW = +Q.toPrecision(6);
          p.note = (p.note ? p.note + '; ' : '') + 'process-heater correlation: catalyst tubes, catalyst and convection section not included';
          const c = addUtil('Fuel (fired heater)', Q, S.fuel_GJ / S.furnace_eff);
          it.utility = [{ kind: 'Fuel (fired heater)', duty_kW: +Q.toPrecision(6), cost_y: c }];
          break;
        }
        default:
          skipped.push({ block: u.id, name: u.name, reason: equip !== 'none' ? 'not costed'
            : /turbine|expander/.test(String(u.module)) ? 'turbines and expanders have no correlation in this costing — add their cost separately'
              : 'no equipment cost (mixer, splitter, valve, ideal separator)' });
          continue;
      }
    } catch (e) {
      skipped.push({ block: u.id, name: u.name, reason: 'costing failed: ' + e.message });
      continue;
    }
    if (!it.parts.length && !it.utility) { skipped.push({ block: u.id, name: u.name, reason: it.notes[0] || 'nothing to cost' }); continue; }
    it.Cp0 = it.parts.reduce((a, p) => a + p.Cp0, 0);
    it.CBM = it.parts.reduce((a, p) => a + p.CBM, 0);
    it.CBM0 = it.parts.reduce((a, p) => a + p.CBM0, 0);
    it.utility_cost_y = (it.utility || []).reduce((a, x) => a + x.cost_y, 0);
    items.push(it);
  }
  const sum = (k) => items.reduce((a, x) => a + (x[k] || 0), 0);
  const Cp0 = sum('Cp0'), CBM = sum('CBM'), CBM0 = sum('CBM0');
  const CTM = 1.18 * CBM, CGR = CTM + 0.50 * CBM0;
  const i = S.interest, n = S.years;
  const crf = i > 0 ? i * Math.pow(1 + i, n) / (Math.pow(1 + i, n) - 1) : 1 / n;
  const ucost = [...util.values()].reduce((a, x) => a + x.cost_y, 0);
  const ecost = elec_kW * S.hours * S.electricity_kWh;
  const r = (v) => (num(v) ? +v.toPrecision(7) : v);
  return {
    version: ECON_VERSION,
    basis: { cepci: S.cepci, cepci_base: CEPCI_BASE, currency: S.currency, rate: S.rate, hours: S.hours, interest: i, years: n, crf: r(crf) },
    items: items.map((x) => Object.assign(x, { Cp0: r(x.Cp0), CBM: r(x.CBM), CBM0: r(x.CBM0), utility_cost_y: r(x.utility_cost_y),
      parts: x.parts.map((p) => Object.assign(p, { Cp0: r(p.Cp0), CBM: r(p.CBM), CBM0: r(p.CBM0) })),
      utility: x.utility ? x.utility.map((q) => Object.assign(q, { cost_y: r(q.cost_y) })) : null })),
    utilities: [...util.values()].map((x) => ({ kind: x.kind, duty_kW: r(x.duty_kW), price_GJ: x.price_GJ, cost_y: r(x.cost_y) }))
      .concat(elec_kW > 0 ? [{ kind: 'Electricity', duty_kW: r(elec_kW), price_kWh: S.electricity_kWh, cost_y: r(ecost) }] : []),
    totals: { purchased: r(Cp0), bare_module: r(CBM), bare_module_base: r(CBM0), total_module: r(CTM), grassroots: r(CGR),
      utility_cost_y: r(ucost + ecost), annualised_capital_y: r(CGR * crf), total_annual_cost_y: r(CGR * crf + ucost + ecost) },
    not_costed: skipped,
  };
}

/** settings merged over the defaults, with checks; throws {message, field} */
export function mergeSettings(s) {
  const o = Object.assign({}, DEFAULTS, s || {});
  for (const k of ['cw', 'chilled']) o[k] = Object.assign({}, DEFAULTS[k], (s || {})[k] || {});
  o.steam = Array.isArray(s && s.steam) && s.steam.length ? s.steam.map((x, k) => Object.assign({}, DEFAULTS.steam[k] || DEFAULTS.steam[2], x)) : DEFAULTS.steam.map((x) => Object.assign({}, x));
  o.steam.sort((a, b) => a.P_barg - b.P_barg);
  return o;
}
export function validateSettings(s) {
  if (s === undefined || s === null) return null;
  if (typeof s !== 'object' || Array.isArray(s)) return 'params.economics must be an object';
  const pos = (v) => v === undefined || (num(v) && v > 0);
  for (const k of ['cepci', 'rate', 'hours', 'years', 'fuel_GJ', 'refrig_GJ', 'electricity_kWh']) if (!pos(s[k])) return `params.economics.${k} must be > 0`;
  if (s.hours !== undefined && s.hours > 8784) return 'params.economics.hours must be ≤ 8784';
  if (s.interest !== undefined && !(num(s.interest) && s.interest >= 0 && s.interest <= 1)) return 'params.economics.interest must be 0–1 (fraction)';
  if (s.years !== undefined && !(Number.isInteger(s.years) && s.years >= 1 && s.years <= 50)) return 'params.economics.years must be 1–50';
  if (s.furnace_eff !== undefined && !(num(s.furnace_eff) && s.furnace_eff > 0 && s.furnace_eff <= 1)) return 'params.economics.furnace_eff must be in (0, 1]';
  if (s.motor_eff !== undefined && !(num(s.motor_eff) && s.motor_eff > 0 && s.motor_eff <= 1)) return 'params.economics.motor_eff must be in (0, 1]';
  if (s.dT_util_K !== undefined && !(num(s.dT_util_K) && s.dT_util_K >= 0 && s.dT_util_K <= 100)) return 'params.economics.dT_util_K must be 0–100 K';
  if (s.currency !== undefined && (typeof s.currency !== 'string' || s.currency.length > 8)) return 'params.economics.currency must be a short text';
  if (s.steam !== undefined) {
    if (!Array.isArray(s.steam) || s.steam.length > 5) return 'params.economics.steam must be an array of ≤ 5 levels';
    for (const [k, x] of s.steam.entries()) if (!x || typeof x !== 'object' || !(num(x.P_barg) && x.P_barg > 0 && x.P_barg < 200) || !pos(x.price_GJ)) return `params.economics.steam[${k}] needs P_barg (0–200) and price_GJ > 0`;
  }
  for (const k of ['cw', 'chilled']) if (s[k] !== undefined) {
    const x = s[k];
    if (!x || typeof x !== 'object' || (x.T_in_C !== undefined && !num(x.T_in_C)) || (x.T_out_C !== undefined && !num(x.T_out_C)) || !pos(x.price_GJ)) return `params.economics.${k} must be {T_in_C, T_out_C, price_GJ}`;
  }
  if (s.units !== undefined) {
    if (!s.units || typeof s.units !== 'object' || Array.isArray(s.units)) return 'params.economics.units must be an object keyed by block id';
    for (const [id, x] of Object.entries(s.units)) {
      if (!x || typeof x !== 'object') return `params.economics.units.${id} must be an object`;
      if (x.equip !== undefined && !EQUIP.includes(x.equip)) return `params.economics.units.${id}.equip must be one of ${EQUIP.join(', ')}`;
      if (x.L_D !== undefined && x.L_D !== null && !(num(x.L_D) && x.L_D >= 1 && x.L_D <= 30)) return `params.economics.units.${id}.L_D must be 1–30`;
      for (const k of ['U_W_m2K', 'volume_m3', 'rho_L']) if (x[k] !== undefined && x[k] !== null && !(num(x[k]) && x[k] > 0)) return `params.economics.units.${id}.${k} must be > 0`;
      if (x.material !== undefined && typeof x.material !== 'string') return `params.economics.units.${id}.material must be text`;
      if (x.compressor_type !== undefined && !['centrifugal', 'reciprocating'].includes(x.compressor_type)) return `params.economics.units.${id}.compressor_type must be centrifugal or reciprocating`;
      if (x.hx_type !== undefined && !['hx_floating', 'hx_fixed', 'hx_utube', 'hx_kettle', 'hx_double_pipe', 'air_cooler'].includes(x.hx_type)) return `params.economics.units.${id}.hx_type is not an exchanger type`;
    }
  }
  return null;
}
export const EQUIP = ['heat-utility', 'heater', 'cooler', 'hx', 'pump', 'compressor', 'ctrain', 'drum', 'column', 'stripper', 'reactor', 'reformer', 'none'];
/** equipment class of an engine module when the caller does not say */
export function inferEquip(module) {
  const m = String(module || '');
  if (m === 'heater') return 'heat-utility';
  if (m === 'heat-exchanger' || m === 'r-hx') return 'hx';
  if (m === 'pump') return 'pump';
  if (m === 'compressor') return 'compressor';
  if (m === 'r-compressor-train') return 'ctrain';
  if (m === 'flash' || m === 'r-flash' || m === 'r-flash3') return 'drum';
  if (m === 'column') return 'column';
  if (m === 'r-urea-stripper' || m === 'hp-stripper') return 'stripper';
  if (['r-pfr', 'r-cstr', 'pfr', 'cstr', 'pfr-recycle', 'r-urea-reactor', 'urea-reactor', 'reactor', 'r-reactor', 'gibbs', 'shift', 'r-shift', 'methanator', 'r-methanator', 'atr', 'r-atr'].includes(m)) return 'reactor';
  if (m === 'smr' || m === 'r-smr') return 'reformer';
  return 'none';
}

export default { ECON_VERSION, CEPCI_BASE, CORR, DEFAULTS, MATERIALS, EQUIP, computeEconomics, mergeSettings, validateSettings, inferEquip };
