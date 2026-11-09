// ============================================================================
// REPO PATH: api/_lib/mb-aqelec.js
// ============================================================================
// multicalci.com — STEP 38 aqueous-electrolyte property method: brines, caustic,
// acids and process / cooling waters with dissolved salts of Na, K, Ca, Mg with
// Cl, SO4, OH, CO3 / HCO3, plus CO2 and HCl.
//
// Model: Pitzer (Harvie–Møller–Weare) with the species, equilibrium constants,
// interaction parameters and mineral solubility products of the USGS PHREEQC
// pitzer.dat database (public domain), the same set PHREEQC's PITZER option
// uses: free species Na+, K+, Ca+2, Mg+2, H+, Cl−, SO4−2, HSO4−, OH−, HCO3−,
// CO3−2, CO2(aq), MgOH+, MgCO3(aq); unsymmetrical mixing Eθ for every pair of
// like-signed ions of different charge. CO2 volatility from the IAPWS G7-04
// Henry constant; HCl from HCl(g) = H+ + Cl− (NBS tables); water from its
// Pitzer activity (pure liquid water on IAPWS-IF97). Mineral saturation indices (calcite, gypsum, halite …) are
// reported; solids are not precipitated.
// Solution density and viscosity: Laliberté (J. Chem. Eng. Data 54 (2009) 1725).
// Enthalpy on the apparent-molar basis: pure water (IF97) plus, per mole of salt, the
// aqueous standard state of its ions (NBS 1982), the Pitzer relative enthalpy at 25 °C and
// the Laliberté (2009) apparent heat capacity; CO2 and HCl by Gibbs–Helmholtz on their fugacity.
//
// Apparent components: H2O, CO2, HCl and the salts NaCl, KCl, CaCl2, MgCl2,
// Na2SO4, K2SO4, MgSO4, CaSO4, NaOH, KOH, Na2CO3, NaHCO3, K2CO3, KHCO3, H2SO4.
// Units inside: T K, molality mol/kg. Plain ES module. (c) multicalci.com
// ============================================================================

import pz from './mb-pitzer.js';
import PZDATA from './mb-pitzerdata.js';
import LALIBERTE from './mb-laliberte.js';

const R = 8.314462618;
const MW = 0.01801528;
const LN10 = Math.LN10;
const TR = 298.15;

// ion standard-state properties at 25 °C: ΔfH° kJ/mol, ΔfG° kJ/mol, S° J/(mol K), Cp° J/(mol K)
const ION = {
  'H+': [0, 0, 0, 0], 'Na+': [-240.12, -261.905, 59.0, 46.4], 'K+': [-252.38, -283.27, 102.5, 21.8],
  'Ca+2': [-542.83, -553.58, -53.1, -31.5], 'Mg+2': [-466.85, -454.8, -138.1, -21.7],
  'Cl-': [-167.159, -131.228, 56.5, -136.4], 'OH-': [-229.994, -157.244, -10.75, -148.5],
  'SO4-2': [-909.27, -744.53, 20.1, -293.0], 'CO3-2': [-677.14, -527.81, -56.9, -290.0], 'HCO3-': [-691.99, -586.77, 91.2, -35.0],
};
// apparent salts: ions released per formula unit (molar masses from the elements)
export const SALTS = {
  NaCl: { ions: { 'Na+': 1, 'Cl-': 1 }, mw: 58.4428, name: 'Sodium chloride (aqueous)', cas: '7647-14-5' },
  KCl: { ions: { 'K+': 1, 'Cl-': 1 }, mw: 74.5513, name: 'Potassium chloride (aqueous)', cas: '7447-40-7' },
  CaCl2: { ions: { 'Ca+2': 1, 'Cl-': 2 }, mw: 110.984, name: 'Calcium chloride (aqueous)', cas: '10043-52-4' },
  MgCl2: { ions: { 'Mg+2': 1, 'Cl-': 2 }, mw: 95.211, name: 'Magnesium chloride (aqueous)', cas: '7786-30-3' },
  Na2SO4: { ions: { 'Na+': 2, 'SO4-2': 1 }, mw: 142.0421, name: 'Sodium sulfate (aqueous)', cas: '7757-82-6' },
  K2SO4: { ions: { 'K+': 2, 'SO4-2': 1 }, mw: 174.2592, name: 'Potassium sulfate (aqueous)', cas: '7778-80-5' },
  MgSO4: { ions: { 'Mg+2': 1, 'SO4-2': 1 }, mw: 120.3676, name: 'Magnesium sulfate (aqueous)', cas: '7487-88-9' },
  CaSO4: { ions: { 'Ca+2': 1, 'SO4-2': 1 }, mw: 136.1406, name: 'Calcium sulfate (aqueous)', cas: '7778-18-9' },
  NaOH: { ions: { 'Na+': 1, 'OH-': 1 }, mw: 39.99711, name: 'Sodium hydroxide (aqueous)', cas: '1310-73-2' },
  KOH: { ions: { 'K+': 1, 'OH-': 1 }, mw: 56.10564, name: 'Potassium hydroxide (aqueous)', cas: '1310-58-3' },
  Na2CO3: { ions: { 'Na+': 2, 'CO3-2': 1 }, mw: 105.9884, name: 'Sodium carbonate (aqueous)', cas: '497-19-8' },
  NaHCO3: { ions: { 'Na+': 1, 'HCO3-': 1 }, mw: 84.0066, name: 'Sodium bicarbonate (aqueous)', cas: '144-55-8' },
  K2CO3: { ions: { 'K+': 2, 'CO3-2': 1 }, mw: 138.2055, name: 'Potassium carbonate (aqueous)', cas: '584-08-7' },
  KHCO3: { ions: { 'K+': 1, 'HCO3-': 1 }, mw: 100.1151, name: 'Potassium bicarbonate (aqueous)', cas: '298-14-6' },
  H2SO4: { ions: { 'H+': 2, 'SO4-2': 1 }, mw: 98.0785, name: 'Sulfuric acid (aqueous)', cas: '7664-93-9' },
};
for (const [k, s] of Object.entries(SALTS)) {
  let h = 0, g = 0, sv = 0, cp = 0;
  for (const [ion, n] of Object.entries(s.ions)) { const d = ION[ion]; h += n * d[0]; g += n * d[1]; sv += n * d[2]; cp += n * d[3]; }
  Object.assign(s, { hf: h, gf: g, s0: sv, cp0: cp });
}
/** databank-style record of a salt (aqueous standard state; never vaporises) */
export function saltRecord(key) {
  const s = SALTS[key];
  return {
    name: s.name, cas: s.cas, formula: key, family: 0, mw: s.mw, tc: 3000, pc: 2.5e7, vc: 0.08, zc: 0.25, w: 0, tb: 2000, tm: 1000,
    hf: s.hf * 1e6, gf: s.gf * 1e6, s0: s.s0 * 1e3, cp_aq: s.cp0,
    cpig: [1, 60e3, 0, 0, 0, 0, 50, 3000], psat: [10, -46.0, 0, 0, 0, 0, 200, 3000],
    cat: 'electrolyte', electrolyte: true, ions: s.ions,
  };
}
// HCl(g) = H+ + Cl−: ΔrG° = −35.929 kJ/mol, ΔrH° = −74.852 kJ/mol (NBS tables)
const LNK_HCL = (T) => 35929 / (R * TR) + (74852 / R) * (1 / T - 1 / TR);

// ---------------------------------------------------------------------------
// data set up from PHREEQC pitzer.dat
// ---------------------------------------------------------------------------
const SPECIES = Object.keys(PZDATA.species).filter((s) => s !== 'H2O');
const ZOF = Object.fromEntries(SPECIES.map((s) => [s, PZDATA.species[s].z]));
const ELOF = Object.fromEntries(SPECIES.map((s) => [s, PZDATA.species[s].el]));
/** log10 K at T of a reaction / phase entry (analytic expression, else log K + van 't Hoff) */
export function log10K(e, T) {
  if (e.an && e.an.length) { const a = e.an; return a[0] + (a[1] || 0) * T + (a[2] || 0) / T + (a[3] || 0) * Math.log10(T) + (a[4] || 0) / (T * T) + (a[5] || 0) * T * T; }
  return (e.logk || 0) - ((e.dh || 0) * 1000 / (R * LN10)) * (1 / T - 1 / TR);
}
const pTemp = (a, T) => (a[0] || 0) + (a[1] || 0) * (1 / T - 1 / TR) + (a[2] || 0) * Math.log(T / TR) + (a[3] || 0) * (T - TR) + (a[4] || 0) * (T * T - TR * TR) + (a[5] || 0) * (1 / (T * T) - 1 / (TR * TR));
/** ln γ± of pure aqueous KCl at molality m (MacInnes reference) */
function lnGammaKCl(T, m, A0) {
  const pick = (name) => { const e = (PZDATA.pitzer[name] || []).find((r) => (r[0] === 'K+' && r[1] === 'Cl-') || (r[0] === 'Cl-' && r[1] === 'K+')); return e ? [[0, 1, pTemp(e[2], T)]] : []; };
  const c = pz.compile(['K+', 'Cl-'], [1, -1], { B0: pick('B0'), B1: pick('B1'), C0: pick('C0') }, A0);
  const lg = new Float64Array(2);
  pz.evaluate(c, [m, m], lg);
  return lg[1];
}
const PHASE_SI = ['Calcite', 'Aragonite', 'Dolomite', 'Magnesite', 'Brucite', 'Portlandite', 'Gypsum', 'Anhydrite', 'Halite', 'Sylvite',
  'Mirabilite', 'Thenardite', 'Epsomite', 'Glauberite', 'Arcanite', 'Nahcolite', 'Natron', 'Trona', 'Bischofite', 'Kalicinite'];
const PHASES = Object.fromEntries(PZDATA.phases.map((p) => [p.name, p]));

/**
 * Speciation engine for one element make-up.
 * @param {string[]} present species that can exist (subset of SPECIES)
 */
function makeSystem(present) {
  const sp = present.slice();
  const n = sp.length;
  const idx = Object.fromEntries(sp.map((s, i) => [s, i]));
  const z = sp.map((s) => ZOF[s]);
  const rx = PZDATA.reactions.filter((r) => idx[r.sp] !== undefined && Object.keys(r.nu).every((k) => k === 'H2O' || idx[k] !== undefined));
  const products = new Set(rx.map((r) => r.sp));
  const masters = sp.filter((s) => !products.has(s));          // Na+ K+ Ca+2 Mg+2 Cl- SO4-2 CO3-2 H+ (those present)
  // element balances: one per non-H/O element present; charge balance closes H+
  const elems = ['Na', 'K', 'Ca', 'Mg', 'Cl', 'S', 'C'].filter((e) => sp.some((s) => ELOF[s][e]));
  // compile Pitzer at T (memo)
  const cache = new Map();
  function compileAt(T, A0) {
    const key = Math.round(T * 1000);
    const c0 = cache.get(key);
    if (c0) return c0;
    const P = PZDATA.pitzer;
    const lst = (name) => (P[name] || []).filter((r) => r.slice(0, -1).every((s) => idx[s] !== undefined)).map((r) => [...r.slice(0, -1).map((s) => idx[s]), pTemp(r[r.length - 1], T)]);
    const TH = lst('THETA');
    // Eθ for every like-signed pair of different charge (PHREEQC applies it whether or not θ is listed)
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (z[i] * z[j] > 0 && z[i] !== z[j] && !TH.some((t) => (t[0] === i && t[1] === j) || (t[0] === j && t[1] === i))) TH.push([i, j, 0]);
    }
    const c = pz.compile(sp, z, { B0: lst('B0'), B1: lst('B1'), B2: lst('B2'), C0: lst('C0'), TH, PSI: lst('PSI'), LAM: lst('LAMDA'), ZETA: lst('ZETA') }, A0);
    if (cache.size > 64) cache.clear();
    cache.set(key, c);
    return c;
  }
  const m = new Float64Array(n), lg = new Float64Array(n);
  /**
   * @param {number} T K, @param {object} tot element moles {Na,K,Ca,Mg,Cl,S,C} and w (water), O (total O), Q (charge of salts: 0)
   */
  function speciate(T, tot, A0, guess) {
    const cp = compileAt(T, A0);
    const lnK = rx.map((r) => log10K(r, T) * LN10);
    const lnKw = log10K(PZDATA.reactions.find((r) => r.sp === 'OH-'), T) * LN10;
    // unknowns: ln m of every species, then ln W
    const NU = n + 1;
    const resid = (v) => {
      for (let i = 0; i < n; i++) m[i] = Math.exp(v[i]);
      const W = Math.exp(v[n]);
      const pr = pz.evaluate(cp, m, lg);
      const la = (s) => (s === 'H2O' ? pr.lnaw : lg[idx[s]] + Math.log(m[idx[s]]));
      const r = [];
      rx.forEach((q, k) => { let s = 0; for (const [sname, c] of Object.entries(q.nu)) s += c * la(sname); r.push(s - lnK[k]); });
      for (const e of elems) {
        let s = 0; for (let i = 0; i < n; i++) { const c = ELOF[sp[i]][e]; if (c) s += c * m[i]; }
        r.push((s * W - tot[e]) / tot[e]);
      }
      let pos = 0, neg = 0; for (let i = 0; i < n; i++) { if (z[i] > 0) pos += z[i] * m[i]; else neg -= z[i] * m[i]; }
      r.push((pos - neg) / (pos + neg));
      let o = W / MW; for (let i = 0; i < n; i++) { const c = ELOF[sp[i]].O; if (c) o += c * m[i] * W; }
      r.push((o - tot.O) / tot.O);
      return { r, pr };
    };
    const norm = (r) => { let x = 0; for (const q of r) { const a = Math.abs(q); if (!(a <= x)) x = a; } return x; };
    let v = guess && guess.length === NU ? guess.slice() : null;
    if (!v) {
      // ideal start: strong ions free; H+ from the charge balance with carbonate / sulfate / water speciation (bisection)
      const W0 = tot.w * MW;
      const KC1 = Math.pow(10, -log10K(PZDATA.reactions.find((r) => r.sp === 'HCO3-'), T));       // HCO3- = CO3-2 + H+
      const K2 = Math.pow(10, log10K(PZDATA.reactions.find((r) => r.sp === 'CO2'), T));            // CO3 + 2H = CO2 + H2O
      const KS = Math.pow(10, log10K(PZDATA.reactions.find((r) => r.sp === 'HSO4-'), T));          // SO4 + H = HSO4
      const Kw = Math.exp(lnKw);
      const cs = (e) => (tot[e] || 0) / W0;
      const base = cs('Na') + cs('K') + 2 * cs('Ca') + 2 * cs('Mg') - cs('Cl');
      const parts = (lh) => {
        const h = Math.exp(lh);
        const d = 1 + h / KC1 + K2 * h * h;
        const c3 = cs('C') / d, hc = c3 * h / KC1, co2 = K2 * h * h * c3;
        const so4 = cs('S') / (1 + KS * h), hso4 = cs('S') - so4;
        return { h, c3, hc, co2, so4, hso4, oh: Kw / h, ch: base + h - Kw / h - 2 * c3 - hc - 2 * so4 - hso4 };
      };
      let lo = -80, hi = 8;
      for (let it = 0; it < 200; it++) { const mid = 0.5 * (lo + hi); if (parts(mid).ch > 0) hi = mid; else lo = mid; if (hi - lo < 1e-12) break; }
      const q = parts(0.5 * (lo + hi));
      const fl = (x) => Math.log(Math.max(x, 1e-60));
      v = sp.map((s) => {
        switch (s) {
          case 'Na+': return fl(cs('Na')); case 'K+': return fl(cs('K')); case 'Ca+2': return fl(cs('Ca')); case 'Mg+2': return fl(cs('Mg'));
          case 'Cl-': return fl(cs('Cl')); case 'H+': return fl(q.h); case 'OH-': return fl(q.oh);
          case 'CO3-2': return fl(q.c3); case 'HCO3-': return fl(q.hc); case 'CO2': return fl(q.co2);
          case 'SO4-2': return fl(q.so4); case 'HSO4-': return fl(q.hso4);
          case 'MgOH+': return fl(cs('Mg') * 1e-6); case 'MgCO3': return fl(Math.min(cs('Mg'), cs('C')) * 1e-3);
          default: return -30;
        }
      }).concat([Math.log(W0)]);
    }
    let cur = resid(v), nrm = norm(cur.r);
    const J = Array.from({ length: NU }, () => new Array(NU));
    for (let it = 0; it < 150 && nrm > 1e-12; it++) {
      for (let c = 0; c < NU; c++) {
        const vp = v.slice(); vp[c] += 1e-7;
        const rp = resid(vp).r;
        for (let k = 0; k < NU; k++) J[k][c] = (rp[k] - cur.r[k]) / 1e-7;
      }
      const dv = solveN(J, cur.r.map((x) => -x));
      if (!dv) break;
      let lim = 1; for (const d of dv) if (Math.abs(d) * lim > 4) lim = 4 / Math.abs(d);
      let alpha = lim, acc = false;
      for (let ls = 0; ls < 40; ls++) {
        const vn = v.map((x, i) => x + alpha * dv[i]);
        const cn = resid(vn), nn = norm(cn.r);
        if (isFinite(nn) && (nn < nrm * (1 - 1e-4 * alpha) || nn < 1e-12)) { v = vn; cur = cn; nrm = nn; acc = true; break; }
        alpha *= 0.5;
      }
      if (!acc) break;
    }
    const fin = resid(v);
    const out = { v, resid: nrm, lnaw: fin.pr.lnaw, I: fin.pr.I, phi: fin.pr.phi, W: Math.exp(v[n]), m: {}, lg: {} };
    sp.forEach((s, i) => { out.m[s] = m[i]; out.lg[s] = lg[i]; });
    return out;
  }
  return { sp, speciate, elems };
}
function solveN(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (!(Math.abs(M[p][c]) > 1e-300)) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

/** element moles of an apparent composition {key: moles} (water and CO2 included) */
function elementsOf(xk) {
  const t = { Na: 0, K: 0, Ca: 0, Mg: 0, Cl: 0, S: 0, C: 0, O: 0, w: xk.H2O || 0 };
  t.O += xk.H2O || 0;
  if (xk.CO2) { t.C += xk.CO2; t.O += 2 * xk.CO2; }
  if (xk.HCl) t.Cl += xk.HCl;
  for (const [k, s] of Object.entries(SALTS)) {
    const a = xk[k]; if (!a) continue;
    for (const [ion, nI] of Object.entries(s.ions)) {
      const el = ion === 'H+' ? {} : ELOF[ion];
      for (const [e, c] of Object.entries(el)) if (e !== 'H') t[e] = (t[e] || 0) + a * nI * c;
    }
  }
  return t;
}

/**
 * Electrolyte implementation for mb-electrolyte.makeElectrolyte (makeGeneric interface).
 * @param {string[]} keys package keys
 * @param {object} h helpers {aphi, psatW, lnPhiSatW?, lnKhCO2?}
 */
export function makeAqElec(keys, h) {
  const ALL = ['H2O', 'CO2', 'HCl', ...Object.keys(SALTS)];
  const owned = ALL.filter((k) => keys.includes(k));
  const idxK = owned.map((k) => keys.indexOf(k));
  const salts = owned.filter((k) => SALTS[k]);
  const EPS = 1e-13;
  const IMAX = 15;
  const TOLR = 1e-6;            // residuals are relative balances and ln-equilibria
  // species that can exist with these components
  const hasEl = (e) => owned.some((k) => (k === 'CO2' && e === 'C') || (k === 'HCl' && e === 'Cl') || (SALTS[k] && Object.keys(SALTS[k].ions).some((ion) => ion !== 'H+' && ELOF[ion][e])));
  // Cl− is always carried (at trace level if absent) so the MacInnes pH scale is defined
  const present = SPECIES.filter((s) => s === 'Cl-' || Object.keys(ELOF[s]).every((e) => e === 'H' || e === 'O' || hasEl(e)));
  const sys = makeSystem(present);
  const sub = (x) => {
    const xk = {}; let s = 0;
    owned.forEach((k, j) => { let v = x[idxK[j]]; if (!(v > EPS)) v = EPS; xk[k] = v; s += v; });
    for (const k of owned) xk[k] /= s;
    return { xk, S: s, w: xk.H2O || EPS };
  };
  let warm = null;
  const memo = new Map(), capMemo = new Map();
  function core(T0, xs) {
    const T = Math.min(Math.max(T0, 273.15), 523.15);
    const key = T + '|' + owned.map((k) => xs.xk[k]).join('|');
    let c = memo.get(key);
    if (c) return c;
    const tot0 = elementsOf(xs.xk);
    for (const e of sys.elems) if (!(tot0[e] > 0)) tot0[e] = EPS * 1e-3;
    // beyond IMAX (flash trial phases, near-dry liquids) the speciation is held at IMAX and
    // the activities are extrapolated: ln a_w ∝ Σm (constant φ), solute activities ∝ m
    const Iapp = (0.5 * salts.reduce((a, k) => a + xs.xk[k] * Object.entries(SALTS[k].ions).reduce((b, [ion, nI]) => b + nI * ZOF[ion] * ZOF[ion], 0), 0)
      + (xs.xk.HCl || 0) + (xs.xk.CO2 || 0) * 0.02) / ((xs.xk.H2O || EPS) * MW);
    const A0 = h.aphi(T);
    const scaled = (sc) => { const t = { ...tot0 }; if (sc !== 1) { for (const e of sys.elems) t[e] = tot0[e] / sc; t.O = tot0.w + (tot0.O - tot0.w) / sc; } return t; };
    const solveAt = (tot, guess) => {
      let q = null;
      if (guess) { q = sys.speciate(T, tot, A0, guess); if (!(q.resid < TOLR)) q = null; }
      if (!q) { q = sys.speciate(T, tot, A0, null); if (!(q.resid < TOLR)) q = null; }
      if (!q) {
        // continuation from a dilute solution
        let g = null, rr = null;
        for (const f of [0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 1]) {
          const t2 = { ...tot }; for (const e of sys.elems) t2[e] = tot[e] * f;
          t2.O = tot.w + (tot.O - tot.w) * f;
          rr = sys.speciate(T, t2, A0, g);
          if (!(rr.resid < TOLR)) { g = null; break; }
          g = rr.v;
        }
        if (g) q = rr;
      }
      return q;
    };
    // concentration limit along this direction of composition (ionic strength): IMAX, lowered where
    // the osmotic product −ln a_w = φ·Σm·Mw stops rising with concentration — pitzer.dat's temperature
    // functions turn over for some salts at high molality and temperature (NaOH above ~8 mol/kg at
    // 100 °C). Beyond it the speciation is held at the limit and the activities extrapolated.
    let cap = IMAX;
    if (Iapp > 4) {
      const dk = Math.round(T) + '|' + owned.filter((k) => k !== 'H2O').map((k) => (xs.xk[k] / (1 - (xs.xk.H2O || 0))).toFixed(2)).join('|');
      const cv = capMemo.get(dk);
      if (cv !== undefined) cap = cv;
      else {
        let g = warm && Math.abs(warm.T - T) < 30 ? warm.v : null;
        while (cap > 4) {
          const ra = solveAt(scaled(Iapp / cap), g), rb = ra ? solveAt(scaled(Iapp / cap * 1.05), ra.v) : null;
          if (ra && rb && -ra.lnaw > -rb.lnaw * 1.005) break;
          if (ra) g = ra.v;
          cap /= 1.25;
        }
        if (capMemo.size > 200) capMemo.clear();
        capMemo.set(dk, cap);
      }
    }
    const scale = Iapp > cap ? Iapp / cap : 1;
    const r = solveAt(scaled(scale), warm && Math.abs(warm.T - T) < 30 ? warm.v : null);
    if (!r) throw new Error(`aqueous-electrolyte speciation did not converge at ${T.toFixed(2)} K`);
    if (scale === 1) warm = { T, v: r.v };
    r.ls = Math.log(scale); r.lnawEff = r.lnaw * scale; r.scale = scale;
    c = { r, T };
    if (memo.size > 300) memo.clear();
    memo.set(key, c);
    return c;
  }
  const la = (r, s) => (r.lg[s] !== undefined ? r.lg[s] + Math.log(Math.max(r.m[s], 1e-300)) + r.ls : -700);
  function lnf(T0, xs) {
    const { r } = core(T0, xs);
    const out = { H2O: r.lnawEff + Math.log(h.psatW(T0)) + (h.lnPhiSatW ? h.lnPhiSatW(T0) : 0) };
    // CO2 volatility on IAPWS G7-04 (molecular CO2, ln a = ln f − ln(kH·Mw)) — pitzer.dat's CO2(g) constant
    // (Plummer & Busenberg 1982) runs 5–9 % more volatile than G7-04 at 100–150 °C
    if (owned.includes('CO2')) out.CO2 = h.lnKhCO2 ? la(r, 'CO2') + h.lnKhCO2(T0) + Math.log(MW)
      : la(r, 'CO2') - log10K(PHASES['CO2(g)'], Math.min(Math.max(T0, 273.15), 523.15)) * LN10 + Math.log(101325);
    if (owned.includes('HCl')) out.HCl = la(r, 'H+') + la(r, 'Cl-') - LNK_HCL(T0) + Math.log(101325);
    for (const k of salts) out[k] = Math.log(1e-30);
    return { out, r };
  }
  const saltAct = (r, k) => { let s = 0; for (const [ion, n] of Object.entries(SALTS[k].ions)) s += n * la(r, ion); return s; };
  // Laliberté density and viscosity on the salt mass fractions (CO2 and HCl added as their mass)
  const massFr = (xs) => {
    let tot = 0; const w = {};
    for (const k of owned) { const mw = k === 'H2O' ? 18.01528 : k === 'CO2' ? 44.0095 : k === 'HCl' ? 36.4609 : SALTS[k].mw; w[k] = xs.xk[k] * mw; tot += w[k]; }
    for (const k of owned) w[k] /= tot;
    return { w, tot };
  };
  function lalDensity(T, xs) {
    const { w } = massFr(xs);
    const t = T - 273.15;
    const rw = (((((-2.8054253e-10 * t + 1.0556302e-7) * t - 4.6170461e-5) * t - 0.0079870401) * t + 16.945176) * t + 999.83952) / (1 + 0.01687985 * t);
    const ww = w.H2O || 1e-9;
    let inv = ww / rw;
    for (const k of owned) {
      if (k === 'H2O') continue;
      const L = LALIBERTE[k];
      if (!L || L.c[0] === null) { inv += w[k] / 1000; continue; }
      const c = L.c;
      const rapp = ((c[0] * (1 - ww) + c[1]) * Math.exp(1e-6 * (t + c[4]) * (t + c[4]))) / ((1 - ww) + c[2] + c[3] * t);
      inv += w[k] / rapp;
    }
    return 1 / inv;
  }
  function lalViscosity(T, xs) {
    const { w } = massFr(xs);
    const t = Math.min(Math.max(T - 273.15, 0), 150);
    const ww = w.H2O || 1e-9;
    const muw = (t + 246) / ((0.05594 * t + 5.2842) * t + 137.37);
    let lnmu = ww * Math.log(muw);
    for (const k of owned) {
      if (k === 'H2O') continue;
      const L = LALIBERTE[k];
      if (!L || L.v[0] === null) { lnmu += w[k] * Math.log(muw); continue; }
      const v = L.v, ws = Math.max(1 - ww, 1e-12);
      const mui = Math.exp((v[0] * Math.pow(ws, v[1]) + v[2]) / (v[3] * t + 1)) / (v[4] * Math.pow(ws, v[5]) + 1);
      lnmu += w[k] * Math.log(mui);
    }
    return Math.exp(lnmu) * 1e-3;
  }
  // apparent heat capacity of a salt in solution, J/(mol K): Laliberté (2009) Cp_i(t, w_w), clamped to its fitted range
  function cpApp(k, T, ws) {
    const L = LALIBERTE[k], a = L.a;
    const t = Math.min(Math.max(T - 273.15, L.cTmin ?? L.Tmin), L.cTmax ?? L.Tmax);
    const al = a[1] * t + a[2] * Math.exp(0.01 * t) + a[3] * ws;
    return (a[0] * Math.exp(al) + a[4] * Math.pow(Math.max(ws, 0), a[5])) * SALTS[k].mw;     // J/(g K) × g/mol
  }
  const GL = [[-0.9324695142, 0.1713244924], [-0.6612093865, 0.3607615730], [-0.2386191861, 0.4679139346],
    [0.2386191861, 0.4679139346], [0.6612093865, 0.3607615730], [0.9324695142, 0.1713244924]];
  const lalCp = salts.length && salts.every((k) => LALIBERTE[k] && LALIBERTE[k].a && LALIBERTE[k].a[0] !== null);
  /**
   * Enthalpy of water and salts on the apparent-molar basis: pure liquid water plus, per mole of salt,
   * h° + L_φ(25 °C, Pitzer heats of dilution) + ∫ Cp_app dT (Laliberté). Keeps the measured solution heat
   * capacity, which the second temperature derivatives of the Pitzer parameters do not reproduce.
   */
  function hExAdjust(T, xs, o, relAt) {
    if (!lalCp) return;
    const d = 0.01;
    const a = relAt(TR + d), b = relAt(TR - d);
    const hx = (k) => -R * TR * TR * (a[k] - b[k]) / (2 * d);
    const nSalt = salts.reduce((q, k) => q + xs.xk[k], 0);
    if (!(nSalt > 1e-12)) { o.H2O = 0; return; }
    const shareW = (xs.xk.H2O || 0) * (Number.isFinite(hx('H2O')) ? hx('H2O') : 0) / nSalt;
    const { w } = massFr(xs);
    const ws = 1 - (w.H2O || 0);
    for (const k of salts) {
      // ∫_{25 °C}^{T} Cp_app dT by 6-point Gauss–Legendre
      const half = 0.5 * (T - TR), mid = 0.5 * (T + TR);
      let integ = 0; for (const [xg, wg] of GL) integ += wg * cpApp(k, mid + half * xg, ws);
      integ *= half;
      const L298 = (Number.isFinite(hx(k)) ? hx(k) : 0) + shareW;
      const ref = SALTS[k].hf * 1000 + SALTS[k].cp0 * (T - TR);
      o[k] = L298 + integ - (ref - SALTS[k].hf * 1000);
    }
    o.H2O = 0;
  }
  const MWK = (k) => (k === 'H2O' ? 18.01528 : k === 'CO2' ? 44.0095 : k === 'HCl' ? 36.4609 : SALTS[k].mw);
  return {
    hExAdjust,
    solvent: 'H2O', keys: owned, sub, heavy: ['H2O', ...salts], gasRef: ['CO2', 'HCl'], salts,
    vInf: { CO2: 33.5e-6 }, xsub: (xs, key) => xs.xk[key],
    lnPhiSub(T, xs) { const { out } = lnf(T, xs); const r = {}; for (const k of owned) r[k] = out[k] - Math.log(xs.xk[k]); return r; },
    lnRel(T, xs) {
      const { out, r } = lnf(T, xs);
      const o = { H2O: r.lnawEff };
      if (owned.includes('CO2')) o.CO2 = out.CO2;
      if (owned.includes('HCl')) o.HCl = out.HCl;
      for (const k of salts) o[k] = saltAct(r, k);
      return o;
    },
    saltRef(T, key) { const s = SALTS[key]; return { h: s.hf * 1000 + s.cp0 * (T - TR), s: s.s0 + s.cp0 * Math.log(T / TR) }; },
    volume(T, xs) { const { tot } = massFr(xs); return tot / 1000 / lalDensity(T, xs); },
    viscosity(T, xs) { return lalViscosity(T, xs); },
    waterTransport: true, waterIF97: true,
    report(T, xs) {
      const { r } = core(T, xs);
      const Tc = Math.min(Math.max(T, 273.15), 523.15);
      const si = {};
      for (const name of PHASE_SI) {
        const p = PHASES[name];
        if (!p || !Object.keys(p.nu).every((s) => s === 'H2O' || r.m[s] !== undefined)) continue;
        let lp = 0; for (const [s, c] of Object.entries(p.nu)) lp += c * (s === 'H2O' ? r.lnawEff : la(r, s));
        si[name] = lp / LN10 - log10K(p, Tc);
      }
      const { out } = lnf(T, xs);
      const molality = {}; for (const [s, v] of Object.entries(r.m)) if (v * r.scale > 1e-14) molality[s] = v * r.scale;
      // pH on the MacInnes scale (γCl− = γ± of KCl at the same ionic strength), as PHREEQC reports it
      const sMac = (r.lg['Cl-'] !== undefined ? r.lg['Cl-'] : 0) - lnGammaKCl(Tc, r.I, h.aphi(Tc));
      const totSalt = salts.reduce((a, k) => a + xs.xk[k], 0) / ((xs.xk.H2O || 1e-12) * MW);
      return {
        model: 'aqueous-electrolyte', pH: -(la(r, 'H+') + sMac) / LN10, pH_scale: 'MacInnes', pH_unscaled: -la(r, 'H+') / LN10, ionic_strength_mol_kg: r.I, water_activity: Math.exp(r.lnawEff), osmotic_coefficient: r.phi,
        ...(r.scale > 1 ? { extrapolated: `concentration beyond the range of the Pitzer parameters (ionic strength ${(r.I * r.scale).toFixed(1)} mol/kg): speciation held at ionic strength ${r.I.toFixed(1)}, activities extrapolated` } : {}),
        salt_molality: totSalt, molality, saturation_index: si,
        ...(owned.includes('CO2') ? { P_CO2_eq_kPa: Math.exp(out.CO2) / 1000 } : {}),
        ...(owned.includes('HCl') ? { P_HCl_eq_kPa: Math.exp(out.HCl) / 1000 } : {}),
        density_kg_m3: lalDensity(T, xs),
      };
    },
    warn(xs, T) {
      const out = [];
      const mw = (xs.xk.H2O || 1e-12) * MW;
      const ionic = salts.reduce((a, k) => a + xs.xk[k] * Object.entries(SALTS[k].ions).reduce((b, [ion, n]) => b + n * ZOF[ion] * ZOF[ion], 0), 0) * 0.5 / mw;
      if (ionic > 9) out.push(`aqueous electrolyte: ionic strength about ${ionic.toFixed(0)} mol/kg — beyond the range the Pitzer parameters were fitted to (≈ 6–9 mol/kg)`);
      if (T > 473.15) out.push('aqueous electrolyte: above 200 °C the pitzer.dat temperature functions are extrapolated');
      try {
        const rep = this.report(T, xs);
        if (rep.extrapolated && !(ionic > 9)) out.push('aqueous electrolyte: ' + rep.extrapolated);
        // dolomite and magnesite are left out: kinetically inhibited, they almost never deposit from process waters
        const sat = Object.entries(rep.saturation_index).filter(([k, v]) => v > 0.05 && k !== 'Dolomite' && k !== 'Magnesite').map(([k, v]) => `${k} (SI ${v.toFixed(2)})`);
        if (sat.length) out.push(`supersaturated in ${sat.join(', ')} — scale or crystals could form (solids are not precipitated in the calculation)`);
      } catch (_e) { /* no report */ }
      return out.join('; ') || null;
    },
  };
}

export default { SALTS, saltRecord, makeAqElec, log10K, ION };
