// ============================================================================
// mb-ureasyn.js — STEP 34: urea synthesis units on the rigorous urea method
// (property_package {model:'urea'}, mb-ureathermo.js).
//
//   r-urea-reactor   synthesis reactor / pool condenser. The liquid holds the
//                    NH3–CO2–H2O–urea solution with carbamate and bicarbonate
//                    speciated (fast reactions II, III); urea formation
//                       carbamate ⇌ urea + H2O                    (I, slow)
//                    is solved to its equilibrium in the liquid at the outlet
//                    T and P, with the vapour in phase equilibrium (two-phase
//                    PT flash of the urea method at every trial extent). The
//                    plant reactor reaches a fraction of the equilibrium
//                    extent: approach_fraction η (0–1, default 1), or a
//                    specified CO2 conversion overrides the equilibrium.
//                    Thermal modes: adiabatic (outlet T solved, optional duty),
//                    specified outlet T (duty reported), duty given.
//                    Reported: equilibrium and actual CO2 → urea conversion,
//                    N/C and H/C, liquid speciation, outlet bubble pressure
//                    (reactor pressure margin), liquid residence time when a
//                    volume is given, heat of reaction at the outlet T.
//
//   r-urea-stripper  HP falling-film stripper as a counter-current equilibrium-
//                    stage column (mb-column.js, Naphtali–Sandholm) without
//                    condenser or reboiler: synthesis liquid on the top stage,
//                    strip gas (CO2, or none for thermal stripping) on the
//                    bottom stage, the shell-side steam duty spread evenly over
//                    the stages. Reported: stripping efficiency
//                    α = 1 − (NH3 + CO2 in the bottom liquid)/(NH3 + CO2 in the
//                    feed liquid), the NH3 and CO2 removals, steam consumption
//                    from IF97 latent heat.
//
// Urea forms only in the liquid. Urea hydrolysis and biuret are not modelled
// here (the classic urea-reactor estimates biuret).
//
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

import units from './mb-units.js';
import rigColumn from './mb-column.js';
import { region1, region2, tsat } from './steam-if97.js';

export const UREASYN_VERSION = 'mb-ureasyn 1.0.0';
const K = units.KIT;
const { th, num, fail, KJH_PER_KW } = K;
const CORE = ['NH3', 'CO2', 'H2O', 'urea'];

function ureaPkg(p, keys, unit) {
  const spec = p.property_package && p.property_package.model ? p.property_package : { model: 'urea' };
  if (spec.model !== 'urea') fail('MB_UREA_PKG', `${unit}: needs the 'urea' (urea synthesis) property method`, 'property_package');
  return K.pkg(spec, keys);
}

/** apparent N/C, H/C and CO2 → urea conversion of a set of mole flows */
function ratios(pp, n) {
  const g = (k) => (pp.index[k] !== undefined ? n[pp.index[k]] : 0);
  const U = g('urea'), C0 = g('CO2') + U, N0 = g('NH3') + 2 * U, W0 = g('H2O') - U;
  return { NC: C0 > 0 ? N0 / C0 : null, HC: C0 > 0 ? W0 / C0 : null, Y: C0 > 0 ? U / C0 : null, C0, N0 };
}

/** Brent root of f on [a, b] with f(a) < 0 < f(b) */
function brent(f, a, b, fa, fb, tol) {
  let c = a, fc = fa, d = b - a, e = d;
  for (let it = 0; it < 80; it++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const t = 2 * 1e-15 * Math.abs(b) + 0.5 * tol, m = 0.5 * (c - b);
    if (Math.abs(m) <= t || fb === 0) return { x: b, it };
    if (Math.abs(e) >= t && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let pq, q;
      if (a === c) { pq = 2 * m * s; q = 1 - s; } else {
        const q0 = fa / fc, r = fb / fc;
        pq = s * (2 * m * q0 * (q0 - r) - (b - a) * (r - 1)); q = (q0 - 1) * (r - 1) * (s - 1);
      }
      if (pq > 0) q = -q; else pq = -pq;
      if (2 * pq < Math.min(3 * m * q - Math.abs(t * q), Math.abs(e * q))) { e = d; d = pq / q; } else { d = m; e = d; }
    } else { d = m; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > t ? d : (m > 0 ? t : -t);
    fb = f(b);
  }
  return { x: b, it: 80 };
}

/**
 * Liquid-phase equilibrium of reaction I at (T, P) from base mole flows n0.
 * Returns the equilibrium extent (kmol/h urea formed) and the flash there.
 */
function equilibriumAt(pp, n0, T, P, guess) {
  const iN = pp.index.NH3, iC = pp.index.CO2, iW = pp.index.H2O, iU = pp.index.urea;
  const ul = pp.ureaLiquid;
  const state = (xi) => {
    const n = n0.slice();
    n[iN] -= 2 * xi; n[iC] -= xi; n[iU] += xi; n[iW] += xi;
    for (let i = 0; i < n.length; i++) if (n[i] < 0) n[i] = 0;
    const F = n.reduce((a, b) => a + b, 0);
    const z = n.map((v) => v / F);
    const r = th.flashPT(pp, z, T, P);
    return { n, F, z, r };
  };
  const g = (xi) => {
    const s = state(xi);
    if (s.r.phase === 'V') return -1e3;               // no liquid: the reaction can only go forward
    const x = s.r.phase === 'L' ? s.z : s.r.x;
    return ul.ureaResidual(T, x);
  };
  const hi0 = Math.min(n0[iN] / 2, n0[iC]), lo0 = -Math.min(n0[iU], n0[iW]);
  const span = hi0 - lo0;
  if (!(span > 0)) return { xi: 0, ...state(0), it: 0 };
  const LO = lo0 + 1e-9 * span, HI = hi0 - 1e-9 * span;
  let lo, hi, flo, fhi, ev = 0;
  if (num(guess) && guess > LO && guess < HI) {
    // warm start (the previous temperature of an energy-balance iteration): a narrow bracket
    // about the last extent, widened geometrically until it holds the root
    let d = 0.01 * span;
    lo = Math.max(LO, guess - d); hi = Math.min(HI, guess + d);
    flo = g(lo); fhi = g(hi); ev += 2;
    while (!(flo < 0 && fhi > 0) && (lo > LO || hi < HI) && ev < 24) {
      d *= 4;
      if (!(flo < 0)) { hi = lo; fhi = flo; lo = Math.max(LO, guess - d); flo = g(lo); ev++; }
      else { lo = hi; flo = fhi; hi = Math.min(HI, guess + d); fhi = g(hi); ev++; }
    }
    if (!(flo < 0) && lo <= LO) return { xi: LO, ...state(LO), it: ev, edge: 'low' };
    if (!(fhi > 0) && hi >= HI) return { xi: HI, ...state(HI), it: ev, edge: 'high' };
  } else {
    lo = LO; hi = HI;
    flo = g(lo); fhi = g(hi); ev += 2;
    if (!(flo < 0)) return { xi: lo, ...state(lo), it: ev, edge: 'low' };
    if (!(fhi > 0)) return { xi: hi, ...state(hi), it: ev, edge: 'high' };
    // a first guess at 60 % of the CO2 available speeds up the bracket
    const xg = lo + 0.6 * (hi - lo), fg = g(xg); ev++;
    if (fg < 0) { lo = xg; flo = fg; } else { hi = xg; fhi = fg; }
  }
  const b = brent(g, lo, hi, flo, fhi, 1e-10 * Math.max(span, 1e-12));
  return { xi: b.x, ...state(b.x), it: b.it + ev };
}

/** last converged outlet temperature and extent per feed signature (warm start inside flowsheet loops) */
const WARM = new Map();

function solveUreaReactor(inp) {
  const unit = 'r-urea-reactor';
  const { streams, params: p } = K.input(inp, 1, 6, unit);
  const keys = [...new Set(K.keysOf(...streams).concat(CORE))];
  const pp = ureaPkg(p, keys, unit);
  const w = pp.warnings.slice();
  const st = streams.map((s, i) => K.stateIn(pp, s, `${unit} inlet ${i + 1}`));
  const f = K.combine(pp, st);
  const P = K.pOut(p, Math.min(...streams.map((s) => s.P_bar)), unit);
  if (P < 20e5 || P > 400e5) fail('MB_UREA_P', `${unit}: pressure ${(P / 1e5).toFixed(1)} bar is outside 20–400 bar`, 'P_out_bar');
  const n0 = f.z.map((v) => v * f.F);
  const rin = ratios(pp, n0);
  if (!(rin.C0 > 0) || !(n0[pp.index.NH3] > 0)) fail('MB_UREA_FEED', `${unit}: needs NH3 and CO2 (free or as urea) in the feed`, 'streams');
  const mode = p.mode === undefined ? 'adiabatic' : p.mode;
  if (!['adiabatic', 'specified_T', 'duty'].includes(mode)) fail('MB_UREA_MODE', `${unit}: mode must be 'adiabatic', 'specified_T' or 'duty'`, 'mode');
  const eta = num(p.approach_fraction) ? p.approach_fraction : 1;
  if (!(eta >= 0 && eta <= 1)) fail('MB_UREA_ETA', `${unit}: approach_fraction must be 0–1`, 'approach_fraction');
  const Yset = num(p.conversion) ? p.conversion : null;
  if (Yset !== null && !(Yset >= 0 && Yset < 1)) fail('MB_UREA_Y', `${unit}: conversion (CO2 → urea, fraction of total CO2) must be 0–1`, 'conversion');
  const iN = pp.index.NH3, iC = pp.index.CO2, iW = pp.index.H2O, iU = pp.index.urea;
  if (Yset !== null) {
    const xiS = Yset * rin.C0 - n0[iU];
    if (xiS > Math.min(n0[iN] / 2, n0[iC]) || -xiS > n0[iW]) fail('MB_UREA_Y', `${unit}: conversion ${Yset} is not reachable with this feed`, 'conversion');
  }
  // outlet at a temperature: equilibrium (unless a conversion is given), then η
  let last = null;
  const sig = pp.pkgSig + '|' + mode + '|' + (P / 1e5).toFixed(1) + '|' + (rin.NC || 0).toFixed(2) + '|' + (rin.HC || 0).toFixed(2);
  const warm = WARM.get(sig) || null;
  const at = (T) => {
    let eq = null, xi;
    if (Yset !== null) xi = Yset * rin.C0 - n0[iU];
    else { eq = equilibriumAt(pp, n0, T, P, last && last.eq ? last.eq.xi : warm ? warm.xiPerC * rin.C0 : undefined); xi = eta * eq.xi; }
    let s;
    if (eq && eta === 1) s = eq;
    else {
      const n = n0.slice();
      n[iN] -= 2 * xi; n[iC] -= xi; n[iU] += xi; n[iW] += xi;
      const F = n.reduce((a, b) => a + b, 0), z = n.map((v) => v / F);
      s = { n, F, z, r: th.flashPT(pp, z, T, P) };
    }
    last = { T, xi, eq, n: s.n, F: s.F, z: s.z, r: s.r, H: s.F * th.hOf(pp, s.r) };
    return last;
  };
  let T;
  if (mode === 'specified_T') {
    T = p.T_out_K;
    if (!num(T) || T < 373.15 || T > 513.15) fail('MB_UREA_T', `${unit}: T_out_K must be within 373–513 K (100–240 °C)`, 'T_out_K');
    at(T);
  } else {
    const Q = num(p.duty_kW) ? p.duty_kW * KJH_PER_KW : 0;
    if (mode === 'duty' && !num(p.duty_kW)) fail('MB_UREA_Q', `${unit}: mode 'duty' needs duty_kW (heat added, + ; removed, −)`, 'duty_kW');
    const Tg = Math.max(400, Math.min(490, num(p.T_guess_K) ? p.T_guess_K : warm ? warm.T : 458));
    T = solveT((t) => at(t).H - (f.H_kJh + Q), Tg, warm ? 4 : 15, unit);
    if (!last || last.T !== T) at(T);
  }
  const res = last;
  if (res.eq) { WARM.set(sig, { T, xiPerC: res.eq.xi / rin.C0 }); if (WARM.size > 50) WARM.delete(WARM.keys().next().value); }
  const out = K.streamOut(pp, res.F, res.z, res.r);
  // ---- reporting
  const rout = ratios(pp, res.n);
  const Yeq = res.eq ? (n0[iU] + res.eq.xi) / rin.C0 : null;
  const liq = res.r.phase === 'V' ? null : res.r.phase === 'L' ? res.z : res.r.x;
  const beta = res.r.phase === 'L' ? 0 : res.r.phase === 'V' ? 1 : res.r.beta;
  const details = {
    pp: { model: pp.model, label: pp.label }, unit_version: UREASYN_VERSION,
    method: Yset !== null ? 'specified CO2 → urea conversion; phases and enthalpy from the urea method'
      : `liquid-phase equilibrium of carbamate ⇌ urea + H2O at the outlet T and P (${pp.label})${eta < 1 ? `, approach ${eta} of the equilibrium extent` : ''}`,
    mode, T_out_K: T, P_out_bar: P / 1e5, approach_fraction: Yset !== null ? undefined : eta,
    feed_NC: rin.NC, feed_HC: rin.HC, feed_urea_conversion: rin.Y,
    co2_conversion_equilibrium: Yeq === null ? undefined : Yeq,
    co2_conversion: rout.Y, nh3_conversion: rin.N0 > 0 ? 2 * (n0[iU] + res.xi) / rin.N0 : null,
    urea_formed_kmol_h: res.xi, urea_out_kg_h: res.n[iU] * 60.0553,
    vapour_fraction: beta,
  };
  if (Yset !== null) details.co2_conversion_specified = Yset;
  if (mode !== 'adiabatic' || num(p.duty_kW)) details.Q_kW = (res.H - f.H_kJh) / KJH_PER_KW;
  if (liq) {
    const rep = pp.electrolyte.report(T, liq);
    details.liquid = rep;
    const note = pp.electrolyte.warn(T, liq);
    if (note) w.push(`${unit}: ${note}`);
    // bubble pressure of the whole outlet without inert gases — the pressure that keeps the
    // synthesis mixture liquid (the inerts always form a gas phase of their own)
    try {
      const zi = res.z.map((v, i) => (CORE.includes(pp.keys[i]) ? v : 0));
      const S = zi.reduce((a, b) => a + b, 0);
      const b = th.flashTVF(pp, zi.map((v) => v / S), T, 0, P);
      details.bubble_P_inert_free_bar = b.P / 1e5;
      details.pressure_margin_bar = (P - b.P) / 1e5;
    } catch (_e) { /* informative only */ }
    // heat of reaction I at the outlet (liquid, per kmol urea formed)
    try {
      const L = (1 - beta) * res.F, x = liq, d = 1e-4 * L;
      const x2 = x.map((v, i) => v * L);
      x2[iN] -= 2 * d; x2[iC] -= d; x2[iU] += d; x2[iW] += d;
      const L2 = x2.reduce((a, b) => a + b, 0);
      const dH = (L2 * pp.hPhase(T, P, x2.map((v) => v / L2), 'L') - L * pp.hPhase(T, P, x, 'L')) / d;
      details.dH_reaction_apparent_kJ_per_kmol_urea = dH;   // 2 NH3 + CO2 (as speciated) → urea + H2O in the liquid; J/mol = kJ/kmol
    } catch (_e) { /* informative only */ }
    if (num(p.volume_m3) && p.volume_m3 > 0) {
      const ph = th.properties(pp, res.r).phases.find((q) => q.type === 'liquid');
      if (ph) {
        const Lkg_h = ph.fraction * res.F * ph.MW;
        const Qv = Lkg_h / ph.rho_kgm3;                // m³/h
        const hold = num(p.liquid_holdup) ? p.liquid_holdup : 1;
        details.liquid_volume_flow_m3_h = Qv;
        details.residence_time_min = 60 * p.volume_m3 * hold / Qv;
      }
    }
  }
  if (beta > 0.02) w.push(`${unit}: ${(100 * beta).toFixed(1)} mol % of the outlet is vapour at ${(P / 1e5).toFixed(1)} bar — the liquid volume (and the conversion) of a real reactor is lower`);
  if (res.eq && res.eq.edge) w.push(`${unit}: the equilibrium lies at the ${res.eq.edge === 'high' ? 'complete-conversion' : 'zero-urea'} limit of the feed`);
  if (beta <= 0.02 && details.pressure_margin_bar !== undefined && details.pressure_margin_bar < 0) w.push(`${unit}: the inert-free outlet boils at ${details.bubble_P_inert_free_bar.toFixed(1)} bar, above the reactor pressure`);
  const R0 = K.result([out], f.mass, f.H_kJh, out.H_kJh, 0, details, w, { converged: true, iterations: res.eq ? res.eq.it : 0 });
  return R0;
}

/** outlet temperature from the energy balance: secant from a bracket of ±d about the guess (Illinois) */
function solveT(fn, Tg, d, unit) {
  const Tmin = 373.15, Tmax = 513.15;
  let a = Math.max(Tmin, Tg - d), b = Math.min(Tmax, Tg + d), fa = fn(a), fb = fn(b);
  for (let k = 0; k < 30 && fa * fb > 0; k++) {
    // the enthalpy rises with T: move towards the root
    const step = Math.max(d, b - a);
    if (fa > 0) { b = a; fb = fa; a = Math.max(Tmin, a - step); fa = fn(a); } else { a = b; fa = fb; b = Math.min(Tmax, b + step); fb = fn(b); }
    if ((a <= Tmin && fa > 0) || (b >= Tmax && fb < 0)) break;
  }
  if (fa * fb > 0) fail('MB_ENERGY_T', `${unit}: no outlet temperature between 100 and 240 °C satisfies the energy balance`, 'params');
  let side = 0, c = a;
  for (let it = 0; it < 60; it++) {
    c = (a * fb - b * fa) / (fb - fa);
    if (!(c > Math.min(a, b) && c < Math.max(a, b))) c = 0.5 * (a + b);
    const fc = fn(c);
    if (Math.abs(fc) < 1e-7 * Math.max(1, Math.abs(fa), Math.abs(fb)) || Math.abs(b - a) < 1e-5) break;
    if (fc * fb < 0) { a = b; fa = fb; b = c; fb = fc; side = 0; } else { b = c; fb = fc; if (side === 1) fa *= 0.5; side = 1; }
  }
  return c;
}

/** latent heat of saturated steam [kJ/kg] and its saturation temperature [K] at P bar(a) */
function steamLatent(P_bar) {
  const pM = P_bar / 10;
  const Ts = tsat(pM);
  return { Ts, hfg: region2(Ts, pM).h - region1(Ts, pM).h };
}

function solveUreaStripper(inp) {
  const unit = 'r-urea-stripper';
  const { streams, params: p } = K.input(inp, 1, 2, unit);
  const keys = [...new Set(K.keysOf(...streams).concat(CORE))];
  const spec = p.property_package && p.property_package.model ? p.property_package : { model: 'urea' };
  const pp = ureaPkg(p, keys, unit);
  const w = [];
  const N = num(p.stages) ? Math.round(p.stages) : 6;
  if (N < 2 || N > 30) fail('MB_STRIP_N', `${unit}: stages must be 2–30`, 'stages');
  const P_bar = num(p.P_out_bar) ? p.P_out_bar : Math.min(...streams.map((s) => s.P_bar));
  let Qtot = null, steam = null;
  if (num(p.duty_kW)) Qtot = p.duty_kW;
  else if (num(p.steam_kg_h)) {
    const sp = num(p.steam_P_bar) ? p.steam_P_bar : 23;
    steam = steamLatent(sp);
    Qtot = p.steam_kg_h * steam.hfg / 3600;
  } else fail('MB_STRIP_Q', `${unit}: give the shell-side heat as duty_kW, or steam_kg_h with steam_P_bar`, 'duty_kW');
  if (!(Qtot >= 0)) fail('MB_STRIP_Q', `${unit}: the heat input must be ≥ 0`, 'duty_kW');
  const heaters = [];
  for (let s = 1; s <= N; s++) heaters.push({ stage: s, duty_kW: Qtot / N });
  const colP = {
    property_package: spec, stages: N, condenser: 'none', reboiler: 'none',
    feed_stages: streams.length === 2 ? [1, N] : [1],
    P_top_bar: P_bar, dp_stage_bar: 0, specs: [], heaters,
    efficiency: num(p.efficiency) ? p.efficiency : 1,
  };
  if (p.budget_ms) colP.budget_ms = p.budget_ms;
  if (p.warm_out) colP.warm_out = true;              // flowsheet solver: keep the converged profile
  if (p.warm) colP.warm = p.warm;
  // the column's generic start-up (bubble/dew temperatures of the total feed) does not suit
  // a reactive stripper: start from temperature profiles about the liquid feed temperature
  const Tl = streams[0].T_K;
  const starts = p.estimates ? [p.estimates] : [{ T_top_K: Tl + 2, T_bottom_K: Tl - 8 }, { T_top_K: Tl, T_bottom_K: Tl + 10 },
    { T_top_K: Math.max(Tl + 10, 455), T_bottom_K: Math.max(Tl, 448) }, { T_top_K: Tl + 5, T_bottom_K: Tl - 25 }, { T_top_K: Tl + 20, T_bottom_K: Tl + 25 }];
  if (!p.estimates && Tl < 445) starts.unshift(starts.splice(2, 1)[0]);     // a cold feed: start from a hot profile
  if (p.warm) starts.unshift(starts[0]);
  let R = null;
  const t0 = Date.now(), cap = num(p.budget_ms) ? p.budget_ms : 7000;
  for (const [q, est] of starts.entries()) {
    const left = cap - (Date.now() - t0);
    if (q > 0 && left < 300) break;
    const Rk = rigColumn.solveColumn({ streams, params: Object.assign({}, colP, { estimates: est, budget_ms: Math.max(250, Math.min(left, 2500)) }, q > 0 ? { warm: null } : {}) });
    if (!R || (Rk.error ? false : (Rk.converged || R.error))) R = Rk;
    if (!Rk.error && Rk.converged) break;
  }
  if (R.error) return R;
  const [gas, liq] = R.streams_out;
  // stripping efficiency on the apparent NH3 + CO2 (urea and water excluded)
  const mol = (s) => { const m = units.moles(s); return m ? m.n : {}; };
  const nf = mol(streams[0]), nb = mol(liq);
  const ng = streams.length === 2 ? mol(streams[1]) : {};
  const a = (n, k) => n[k] || 0;
  const app = (n) => ({ N: a(n, 'NH3') + 2 * a(n, 'urea'), C: a(n, 'CO2') + a(n, 'urea'), U: a(n, 'urea') });
  const freeF = a(nf, 'NH3') + a(nf, 'CO2'), freeB = a(nb, 'NH3') + a(nb, 'CO2');
  const d = Object.assign({}, R.details || {});
  delete d.reflux_ratio; delete d.boilup_ratio;       // no condenser / reboiler
  d.unit_version = UREASYN_VERSION;
  d.method = `${N} counter-current equilibrium stages (Naphtali–Sandholm), heat spread evenly over the stages; ${pp.label}`;
  d.stripping_efficiency = freeF > 0 ? 1 - freeB / freeF : null;
  d.nh3_removed_fraction = a(nf, 'NH3') > 0 ? 1 - a(nb, 'NH3') / a(nf, 'NH3') : null;
  d.co2_removed_fraction = a(nf, 'CO2') + a(ng, 'CO2') > 0 ? 1 - a(nb, 'CO2') / (a(nf, 'CO2') + a(ng, 'CO2')) : null;
  d.urea_in_kmol_h = a(nf, 'urea'); d.urea_out_kmol_h = a(nb, 'urea');
  d.heat_input_kW = Qtot;
  if (steam) Object.assign(d, { steam_kg_h: p.steam_kg_h, steam_P_bar: num(p.steam_P_bar) ? p.steam_P_bar : 23, steam_T_sat_K: steam.Ts, steam_latent_kJ_kg: steam.hfg });
  d.T_bottom_K = liq.T_K; d.T_top_gas_K = gas.T_K;
  const bl = app(nb);
  d.bottom_NC = bl.C > 0 ? bl.N / bl.C : null;
  if (steam && liq.T_K > steam.Ts - 5) w.push(`${unit}: the bottom liquid (${(liq.T_K - 273.15).toFixed(1)} °C) is within 5 K of the steam saturation temperature (${(steam.Ts - 273.15).toFixed(1)} °C) — the heat input is not transferable at this steam pressure`);
  if (liq.T_K > 488.15) w.push(`${unit}: bottom temperature above 215 °C — biuret formation and corrosion limits (not modelled)`);
  return Object.assign({}, R, { details: d, warnings: [...new Set([...(R.warnings || []), ...w])] });
}

export const UREASYN_MODULES = {
  'r-urea-reactor': solveUreaReactor,
  'r-urea-stripper': solveUreaStripper,
};

export default { UREASYN_VERSION, UREASYN_MODULES };
