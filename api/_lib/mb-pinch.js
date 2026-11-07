// ============================================================================
// REPO PATH: api/_lib/mb-pinch.js
// ============================================================================
// multicalci.com — STEP 36: pinch analysis.
//
// Streams are piecewise-linear temperature–enthalpy curves. A stream is given
// either as points [[T_K, H_kW]…], as a heat-capacity flowrate (CP, kW/K), as a
// duty between two temperatures, or as a process state (flow, composition,
// inlet / outlet T and P) whose curve is computed with the property method by
// flashing at intermediate temperatures — so condensation, boiling and
// non-ideal enthalpy show in the curve.
//
// Targets by the problem table algorithm (Linnhoff & Flower 1978; Kemp,
// "Pinch Analysis and Process Integration", 2nd ed., ch. 2): hot streams are
// shifted down and cold streams up by ΔTmin/2, the shifted temperature range is
// cut into intervals at every segment end, the heat surplus of each interval is
// cascaded from the top, and the largest deficit sets the minimum hot utility.
// Returns the hot and cold composite curves (cold shifted right by the minimum
// cold utility), the grand composite curve, the pinch, the current utility use
// of the streams marked as utility-served, and the heaters below / coolers
// above the pinch that make the difference.
//
// (c) multicalci.com
// ============================================================================

'use strict';

export const PINCH_VERSION = 'mb-pinch 1.0.0';
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const MAX_STREAMS = 120, MAX_POINTS = 60;
const ISO_DT = 1;                     // K — an isothermal duty (condenser, reboiler, reactor) is spread over 1 K

class PinchError extends Error { constructor(code, message, field) { super(message); this.code = code; this.field = field; } }
const fail = (m, f) => { throw new PinchError('MB_PINCH', m, f); };

/**
 * T–H curve of one stream as [[T_K, H_kW]] from its inlet (H = 0) to its outlet,
 * T monotonic. kind 'hot' (T falls) or 'cold' (T rises).
 */
function streamCurve(s, i, describe, pkgSpec, nPts) {
  const at = `params.streams[${i}]`;
  const name = typeof s.name === 'string' && s.name ? s.name.slice(0, 60) : 'S' + (i + 1);
  if (Array.isArray(s.points)) {
    if (s.points.length < 2 || s.points.length > MAX_POINTS) fail(`${at}.points: 2–${MAX_POINTS} [T_K, H_kW] pairs`, at);
    const pts = s.points.map((p, j) => {
      if (!Array.isArray(p) || !num(p[0]) || !num(p[1]) || p[0] <= 0) fail(`${at}.points[${j}] must be [T_K > 0, H_kW]`, at);
      return [p[0], p[1]];
    });
    const H0 = pts[0][1];
    return { name, pts: pts.map((p) => [p[0], p[1] - H0]), source: 'points' };
  }
  if (!num(s.T_in_K) || !num(s.T_out_K) || s.T_in_K <= 0 || s.T_out_K <= 0) fail(`${at} needs T_in_K and T_out_K (> 0)`, at);
  let Tin = s.T_in_K, Tout = s.T_out_K;
  if (num(s.CP_kW_K)) {
    if (s.CP_kW_K <= 0) fail(`${at}.CP_kW_K must be > 0`, at);
    if (Math.abs(Tout - Tin) < 1e-9) fail(`${at}: a CP stream needs T_in ≠ T_out`, at);
    return { name, pts: [[Tin, 0], [Tout, s.CP_kW_K * (Tout - Tin)]], source: 'CP' };
  }
  // a process state: rigorous curve with the property method (a state the method cannot
  // describe falls back to the duty between the two temperatures, with a note)
  if (s.state && pkgSpec && describe) {
    try { return stateCurve(s, at, name, Tin, Tout, describe, pkgSpec, nPts); }
    catch (e) {
      if (!num(s.Q_kW)) throw e;
      const c = dutyCurve(s, Tin, Tout);
      if (c) c.note = `${e.message.replace(/^[^:]*: /, '')} — duty spread at constant CP instead`;
      return c ? Object.assign({ name }, c) : null;
    }
  }
  if (num(s.Q_kW)) { const c = dutyCurve(s, Tin, Tout); return c ? Object.assign({ name }, c) : null; }
  fail(`${at} needs points, CP_kW_K, Q_kW or a state with a property method`, at);
  return null;
}
/** a duty between two temperatures at constant CP (an isothermal duty spread over ISO_DT) */
function dutyCurve(s, Tin, Tout) {
  if (Math.abs(s.Q_kW) < 1e-12) return null;
  const iso = Math.abs(Tout - Tin) < 0.5 * ISO_DT;
  if (iso) Tout = s.Q_kW > 0 ? Tin + ISO_DT : Tin - ISO_DT;
  return { pts: [[Tin, 0], [Tout, s.Q_kW]], source: iso ? 'isothermal duty' : 'duty, constant CP' };
}
function stateCurve(s, at, name, Tin, Tout, describe, pkgSpec, nPts) {
  {
    const st = s.state;
    if (!num(st.mass_flow_kg_h) || st.mass_flow_kg_h <= 0 || !Array.isArray(st.components) || !st.components.length) fail(`${at}.state needs mass_flow_kg_h and components`, at);
    const Pin = num(st.P_in_bar) ? st.P_in_bar : st.P_bar, Pout = num(st.P_out_bar) ? st.P_out_bar : Pin;
    if (!num(Pin) || Pin <= 0 || !num(Pout) || Pout <= 0) fail(`${at}.state needs P_in_bar (and P_out_bar)`, at);
    const n = Math.max(2, Math.min(nPts, MAX_POINTS));
    const Pat = (T) => Pin + (Tout === Tin ? 0 : (T - Tin) / (Tout - Tin)) * (Pout - Pin);
    const at1 = (T) => {
      let d;
      try { d = describe(pkgSpec, { mass_flow_kg_h: st.mass_flow_kg_h, T_K: T, P_bar: Pat(T), components: st.components }); }
      catch (e) { fail(`${name}: no enthalpy at ${T.toFixed(1)} K, ${Pat(T).toPrecision(4)} bar — ${e.message}`, at); }
      const H = d.H_kJh / 3600;
      if (!num(H)) fail(`${name}: no enthalpy at ${T.toFixed(1)} K`, at);
      const vf = num(d.vapour_fraction) ? d.vapour_fraction : NaN;
      return { T, H, cls: !num(vf) ? 0 : vf <= 1e-7 ? 0 : vf >= 1 - 1e-7 ? 2 : 1 };
    };
    let P0 = [];
    for (let k = 0; k < n; k++) P0.push(at1(Tin + k / (n - 1) * (Tout - Tin)));
    // bubble and dew points inside the range: located by bisection on the phase, so a pure
    // component's boiling and a mixture's condensation start / end are corners of the curve
    const extra = [];
    for (let k = 1; k < P0.length && extra.length < 8; k++) {
      let a = P0[k - 1], b = P0[k];
      if (a.cls === b.cls) continue;
      for (let it = 0; it < 40 && Math.abs(b.T - a.T) > 1e-3; it++) {
        const m = at1((a.T + b.T) / 2);
        if (m.cls === a.cls) a = m; else b = m;
      }
      extra.push(a, b);
    }
    P0 = P0.concat(extra).sort((x, y) => (Tout > Tin ? x.T - y.T : y.T - x.T));
    const H0 = P0[0].H;
    const pts = P0.map((q) => [q.T, q.H - H0]);
    const dH = pts[pts.length - 1][1];
    // a unit duty that differs from the curve (reaction, mixing) is noted, the curve keeps its shape scaled to the duty
    let note = null;
    if (num(s.Q_kW) && Math.abs(s.Q_kW) > 1e-9 && Math.abs(dH) > 1e-9 && Math.abs(dH - s.Q_kW) > 0.01 * Math.abs(s.Q_kW)) {
      note = `curve ΔH ${dH.toPrecision(4)} kW scaled to the unit duty ${s.Q_kW.toPrecision(4)} kW`;
      const f = s.Q_kW / dH;
      for (const p of pts) p[1] *= f;
    }
    return { name, pts, source: 'property method', note };
  }
}

/** split a curve into constant-CP segments with T ascending: [{lo, hi, CP}] (CP > 0) */
function segments(pts) {
  const out = [];
  for (let k = 1; k < pts.length; k++) {
    const [T1, H1] = pts[k - 1], [T2, H2] = pts[k];
    const dT = T2 - T1, dH = H2 - H1;
    if (Math.abs(dH) < 1e-12) continue;
    if (Math.abs(dT) < 1e-9) {                       // vertical piece: spread over ISO_DT around it
      const lo = T1 - ISO_DT / 2, hi = T1 + ISO_DT / 2;
      out.push({ lo, hi, CP: Math.abs(dH) / ISO_DT });
      continue;
    }
    out.push({ lo: Math.min(T1, T2), hi: Math.max(T1, T2), CP: Math.abs(dH / dT) });
  }
  return out;
}

/**
 * Problem table on shifted temperatures. S = [{kind:'hot'|'cold', segs}] in real K.
 * Returns { Qh, Qc, bounds (shifted, descending), cascade (heat flow below each bound, after Qh) }.
 */
function problemTable(S, dTmin) {
  const sh = [];
  for (const s of S) for (const g of s.segs) {
    const d = s.kind === 'hot' ? -dTmin / 2 : dTmin / 2;
    sh.push({ kind: s.kind, lo: g.lo + d, hi: g.hi + d, CP: g.CP });
  }
  const bset = new Set();
  for (const g of sh) { bset.add(+g.lo.toFixed(9)); bset.add(+g.hi.toFixed(9)); }
  const bounds = [...bset].sort((a, b) => b - a);
  const surplus = [];
  for (let k = 1; k < bounds.length; k++) {
    const hi = bounds[k - 1], lo = bounds[k];
    let cp = 0;
    for (const g of sh) if (g.lo <= lo + 1e-9 && g.hi >= hi - 1e-9) cp += g.kind === 'hot' ? g.CP : -g.CP;
    surplus.push(cp * (hi - lo));
  }
  const casc = [0];
  for (const q of surplus) casc.push(casc[casc.length - 1] + q);
  const Qh = Math.max(0, -Math.min(...casc));
  const cascade = casc.map((c) => c + Qh);
  return { Qh, Qc: cascade[cascade.length - 1], bounds, cascade, surplus };
}

/** composite curve of segments (real T): [[H, T]] from the coldest point, H cumulative */
function composite(segsAll) {
  const bset = new Set();
  for (const g of segsAll) { bset.add(+g.lo.toFixed(9)); bset.add(+g.hi.toFixed(9)); }
  const Ts = [...bset].sort((a, b) => a - b);
  if (!Ts.length) return [];
  const out = [[0, Ts[0]]];
  let H = 0;
  for (let k = 1; k < Ts.length; k++) {
    const lo = Ts[k - 1], hi = Ts[k];
    let cp = 0;
    for (const g of segsAll) if (g.lo <= lo + 1e-9 && g.hi >= hi - 1e-9) cp += g.CP;
    H += cp * (hi - lo);
    out.push([H, hi]);
  }
  return out;
}
/** heat of a stream's segments that lies above (side 1) or below (side −1) a shifted temperature */
function dutyBeyond(segs, shift, Tp, side) {
  let q = 0;
  for (const g of segs) {
    const lo = g.lo + shift, hi = g.hi + shift;
    if (side > 0) q += g.CP * Math.max(0, hi - Math.max(lo, Tp));
    else q += g.CP * Math.max(0, Math.min(hi, Tp) - lo);
  }
  return q;
}

/**
 * Pinch analysis.
 * params: { streams: [{name, T_in_K, T_out_K, CP_kW_K | Q_kW | points | state, role?: 'utility' | 'process'}],
 *           dT_min_K (default 10), points_per_stream (default 12), property_package? }
 * describe: (pkgSpec, stream) → stream with H_kJh (the flowsheet's property method)
 */
export function pinchAnalysis(params, describe) {
  const p = params || {};
  if (!Array.isArray(p.streams) || !p.streams.length || p.streams.length > MAX_STREAMS) fail(`params.streams must hold 1–${MAX_STREAMS} streams`, 'params.streams');
  const dT = p.dT_min_K === undefined ? 10 : p.dT_min_K;
  if (!num(dT) || dT < 0 || dT > 200) fail('params.dT_min_K must be 0–200 K', 'params.dT_min_K');
  const nPts = p.points_per_stream === undefined ? 12 : p.points_per_stream;
  if (!Number.isInteger(nPts) || nPts < 2 || nPts > MAX_POINTS) fail(`params.points_per_stream must be 2–${MAX_POINTS}`, 'params.points_per_stream');
  const pkgSpec = p.property_package || null;
  const S = [], skipped = [], notes = [];
  p.streams.forEach((s, i) => {
    if (!s || typeof s !== 'object') fail(`params.streams[${i}] must be an object`, 'params.streams');
    const c = streamCurve(s, i, describe, pkgSpec, nPts);
    if (!c) { skipped.push(s.name || 'S' + (i + 1)); return; }
    const Tfirst = c.pts[0][0], Tlast = c.pts[c.pts.length - 1][0], dH = c.pts[c.pts.length - 1][1];
    if (Math.abs(dH) < 1e-9) { skipped.push(c.name); return; }
    // hot = gives heat (H falls); a curve whose T and H move opposite ways is not a heating / cooling curve
    const kind = dH < 0 ? 'hot' : 'cold';
    if ((kind === 'hot' && Tlast > Tfirst + 1e-9) || (kind === 'cold' && Tlast < Tfirst - 1e-9)) {
      skipped.push(c.name); notes.push(`${c.name}: temperature and enthalpy move in opposite directions — left out`); return;
    }
    const segs = segments(c.pts);
    if (c.note) notes.push(c.name + ': ' + c.note);
    S.push({ name: c.name, kind, role: s.role === 'utility' ? 'utility' : 'process', unit: typeof s.unit === 'string' ? s.unit : undefined,
      T_in_K: Tfirst, T_out_K: Tlast, Q_kW: Math.abs(dH), source: c.source, curve: c.pts.map((q) => [+q[0].toFixed(4), +Math.abs(q[1]).toPrecision(8)]), segs });
  });
  const hot = S.filter((s) => s.kind === 'hot'), cold = S.filter((s) => s.kind === 'cold');
  if (!S.length) fail('no stream with a non-zero duty', 'params.streams');
  const PT = problemTable(S, dT);
  // pinch: zero heat flow inside the range (not at the ends)
  const pinches = [];
  for (let k = 1; k < PT.cascade.length - 1; k++) if (PT.cascade[k] < 1e-6 * Math.max(1, PT.Qh + PT.Qc)) pinches.push(PT.bounds[k]);
  const hotC = composite(hot.flatMap((s) => s.segs)), coldC0 = composite(cold.flatMap((s) => s.segs));
  const coldC = coldC0.map(([H, T]) => [H + PT.Qc, T]);
  const gcc = PT.bounds.map((T, k) => [PT.cascade[k], T]);
  const totHot = hot.reduce((a, s) => a + s.Q_kW, 0), totCold = cold.reduce((a, s) => a + s.Q_kW, 0);
  const curHot = cold.filter((s) => s.role === 'utility').reduce((a, s) => a + s.Q_kW, 0);
  const curCold = hot.filter((s) => s.role === 'utility').reduce((a, s) => a + s.Q_kW, 0);
  // utility heaters below the pinch and coolers above it (the cross-pinch heat flow they cause)
  const cross = [];
  const Tp = pinches.length ? pinches[0] : null;
  if (Tp !== null) {
    for (const s of S) {
      if (s.role !== 'utility') continue;
      const q = s.kind === 'cold' ? dutyBeyond(s.segs, dT / 2, Tp, -1) : dutyBeyond(s.segs, -dT / 2, Tp, 1);
      if (q > 1e-6 * Math.max(1, s.Q_kW)) cross.push({ stream: s.name, unit: s.unit, kind: s.kind === 'cold' ? 'heater below the pinch' : 'cooler above the pinch', Q_kW: q });
    }
  }
  const r6 = (v) => +v.toPrecision(8);
  return {
    version: PINCH_VERSION,
    dT_min_K: dT,
    Q_hot_min_kW: r6(PT.Qh), Q_cold_min_kW: r6(PT.Qc),
    pinch_shifted_K: Tp === null ? null : r6(Tp),
    pinch_hot_K: Tp === null ? null : r6(Tp + dT / 2), pinch_cold_K: Tp === null ? null : r6(Tp - dT / 2),
    pinches_shifted_K: pinches.map(r6),
    threshold: Tp === null,
    total_hot_kW: r6(totHot), total_cold_kW: r6(totCold),
    current_hot_utility_kW: r6(curHot), current_cold_utility_kW: r6(curCold),
    saving_hot_kW: r6(Math.max(0, curHot - PT.Qh)), saving_cold_kW: r6(Math.max(0, curCold - PT.Qc)),
    hot_composite: hotC.map(([H, T]) => [r6(H), r6(T)]), cold_composite: coldC.map(([H, T]) => [r6(H), r6(T)]),
    grand_composite: gcc.map(([H, T]) => [r6(H), r6(T)]),
    cross_pinch: cross.map((c) => Object.assign(c, { Q_kW: r6(c.Q_kW) })),
    streams: S.map((s) => ({ name: s.name, unit: s.unit, kind: s.kind, role: s.role, T_in_K: r6(s.T_in_K), T_out_K: r6(s.T_out_K), Q_kW: r6(s.Q_kW), source: s.source, curve: s.curve })),
    skipped, notes,
  };
}

export { PinchError };
export default { PINCH_VERSION, pinchAnalysis, PinchError };
