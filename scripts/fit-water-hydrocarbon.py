#!/usr/bin/env python3
# Requires: numpy, scipy.
"""
Round 11 — water–hydrocarbon binary parameters for NRTL (α = 0.2) and UNIQUAC.

The pairs are fitted to the IUPAC-NIST reference mutual solubilities (both liquid phases, 0–150 °C):
  · hydrocarbon in water: SDS-81 smoothing equations (Mączyński et al., J. Phys. Chem. Ref. Data 33 (2004) 549;
    Góral & Oracz, ChemEngineering 5 (2021) 89 for the alkylbenzene constants);
  · water in the hydrocarbon: SDS-81 reference equations (toluene and ethylbenzene from the IUPAC Technical Report
    of Bazyleva & Acree, Pure Appl. Chem. 2021; alkanes from JPCRD 33 (2004) 549 Table 2); xylenes anchored to the
    SDS-81 recommended value at 298 K; benzene fitted to the IUPAC recommended values 298–343 K.
Form (Aspen): τ_ij = a_ij + b_ij/T + e_ij ln T (UNIQUAC: ln τ_ij). Step 1 solves the two τ exactly at each
temperature, step 2 refines the six constants on ln x of both phases with the model's own LLE.

Usage (repo root):  python3 scripts/fit-water-hydrocarbon.py      → rewrites the generated block of api/_lib/mb-bip-extra.js
Component constants (Tc, Pc, UNIQUAC r and q) are those of the engine databank (ChemSep v8.32).
"""
import json, math, sys
import numpy as np, os
USE_E = os.environ.get('USE_E', '1') == '1'
from scipy.optimize import least_squares, fsolve

C = {"H2O": {"Tc": 647.14, "Pc": 22064000, "r": 0.92, "q": 1.4}, "benzene": {"Tc": 562.05, "Pc": 4895000, "r": 3.1878, "q": 2.4}, "toluene": {"Tc": 591.75, "Pc": 4108000, "r": 3.9228, "q": 2.968}, "ethylbenzene": {"Tc": 617.15, "Pc": 3609000, "r": 4.6, "q": 3.51}, "oxylene": {"Tc": 630.3, "Pc": 3732000, "r": 4.66, "q": 3.54}, "m-xylene": {"Tc": 617, "Pc": 3541000, "r": 4.66, "q": 3.54}, "p-xylene": {"Tc": 616.2, "Pc": 3511000, "r": 4.66, "q": 3.54}, "cyclohexane": {"Tc": 553.5, "Pc": 4073000, "r": 4.0464, "q": 3.24}, "methylcyclohexane": {"Tc": 572.19, "Pc": 3471000, "r": 4.72, "q": 3.776}, "n-pentane": {"Tc": 469.7, "Pc": 3370000, "r": 3.8254, "q": 3.316}, "nC6H14": {"Tc": 507.6, "Pc": 3025000, "r": 4.4998, "q": 3.856}, "nC7H16": {"Tc": 540.2, "Pc": 2740000, "r": 5.1742, "q": 4.396}, "nC8H18": {"Tc": 568.7, "Pc": 2490000, "r": 5.8486, "q": 4.936}, "isooctane": {"Tc": 543.9, "Pc": 2570000, "r": 5.85, "q": 4.94}}   # engine databank: Tc K, Pc Pa, UNIQUAC r, q
R = 8.314462618

def g_arom(T):            # alkylbenzenes: u ln u - u + 1, u = 290/T
    u = 290.0 / T
    return u * math.log(u) - u + 1
def f_alk(T, Tmin):       # alkanes: u - ln u - 1, u = Tmin/T
    u = Tmin / T
    return u - math.log(u) - 1
def lnx_water_eq(T, d, T0):
    Tr = T / T0
    return d[0] + d[1] * (1 / Tr - 1) + d[2] * (1 - Tr) ** (1 / 3) + d[3] * (1 - Tr)

D_TOL = (-0.495, -3.700, -0.102, -4.641); T0_TOL = 553.0
D_EB = (-0.383, -3.167, -0.009, -5.655); T0_EB = 566.9
def bRK(Tc, Pc_kPa): return 0.08664 * 8.314462618 * Tc / Pc_kPa * 1000  # cm3/mol

REF = {}
# --- aromatics: HC in water from the SDS-81 alkylbenzene equation (c4..c7, Tmin 290 K) ---
def arom_x1(b):
    return lambda T: math.exp((-2.605 - 0.063 * b) + (7.98 + 0.267 * b) * g_arom(T))
REF['toluene'] = dict(x1=lambda T: math.exp(-9.14 + 35.7 * g_arom(T)), x2=lambda T: math.exp(lnx_water_eq(T, D_TOL, T0_TOL)), Tr=(273.15, 423.15),
                      src='IUPAC Technical Report 2021 (Bazyleva & Acree, Pure Appl. Chem., doi 10.1515/pac-2020-0905), SDS-81 reference equations: ln x_min −9.14, D 35.7, T_ms 290 K; water d = −0.495/−3.700/−0.102/−4.641, T_c 553.0 K')
REF['ethylbenzene'] = dict(x1=lambda T: math.exp(-10.37 + 40.9 * g_arom(T)), x2=lambda T: math.exp(lnx_water_eq(T, D_EB, T0_EB)), Tr=(273.15, 423.15),
                           src='IUPAC Technical Report 2021, SDS-81 reference equations: ln x_min −10.37, D 40.9, T_ms 290 K; water d = −0.383/−3.167/−0.009/−5.655, T_c 566.9 K')
x2EB298 = math.exp(lnx_water_eq(298.15, D_EB, T0_EB))
for k, xw in (('oxylene', 2.60e-3), ('m-xylene', 2.60e-3), ('p-xylene', 2.70e-3)):
    b = bRK(C[k]['Tc'], C[k]['Pc'] / 1000)
    sh = math.log(xw / x2EB298)
    REF[k] = dict(x1=arom_x1(b), x2=(lambda sh: lambda T: math.exp(lnx_water_eq(T, D_EB, T0_EB) + sh))(sh), Tr=(273.15, 423.15),
                  src=f'SDS-81 alkylbenzene equation for the hydrocarbon in water (b = {b:.1f} cm³/mol); water in the hydrocarbon: SDS-81 recommended {xw:.2e} at 298 K with the temperature dependence of the ethylbenzene reference equation')
# benzene: water side fitted to the IUPAC recommended values (SDS-37 Hefter 1989, 303-343 K; SDS-81 3.09e-3 at 298 K) with the toluene d2..d4 shape
bz_pts = [(298.15, 3.09e-3), (303.15, 3.60e-3), (308.15, 4.23e-3), (313.15, 4.87e-3), (318.15, 5.78e-3), (323.15, 6.74e-3), (328.15, 7.76e-3), (333.15, 8.96e-3), (338.15, 10.0e-3), (343.15, 11.9e-3)]
BZ_T0 = 538.5   # three-phase critical end point 541.5 K less the 3 K offset of the toluene equation (556.1 → 553.0)
def bz_res(p):
    return [lnx_water_eq(T, (p[0],) + D_TOL[1:], BZ_T0) - math.log(x) for T, x in bz_pts]
BZ_D1 = float(least_squares(bz_res, [-0.5]).x[0])
bB = bRK(C['benzene']['Tc'], C['benzene']['Pc'] / 1000)
REF['benzene'] = dict(x1=arom_x1(bB), x2=lambda T: math.exp(lnx_water_eq(T, (BZ_D1,) + D_TOL[1:], BZ_T0)), Tr=(273.15, 423.15),
                      src=f'SDS-81 alkylbenzene equation for benzene in water (b = {bB:.1f} cm³/mol; 4.07e-4 at 298 K, recommended 4.11e-4); water in benzene: IUPAC recommended values 298–343 K (SDS-37 and SDS-81) fitted with the toluene reference shape (d1 {BZ_D1:.3f}, T_c {BZ_T0:.1f} K)')
# --- alkanes (JPCRD 33 (2004) 549, Tables 1 and 2) ---
ALK = {  # key: (lnxmin, b, Tmin, d1..d4, T0, Tmax)
    'n-pentane': (-11.50, 100.5, 306, (-1.591, -6.577, -0.064, -5.526), 467.5, 393.15),
    'nC6H14': (-13.04, 121.4, 306, (-1.118, -6.113, -0.144, -5.049), 499.8, 423.15),
    'nC7H16': (-14.58, 142.3, 306, (-0.633, -6.177, -0.846, -3.372), 524.2, 443.15),
    'nC8H18': (-16.24, 164.8, 306, (-0.456, -5.460, -0.260, -4.467), 553.8, 473.15),
    'isooctane': (-15.33, 152.5, 306, (-0.499, -6.314, -0.954, -2.859), 526.7, 443.15),
    'cyclohexane': (-11.31, 97.9, 298, (-0.963, -6.267, -0.710, -3.111), 533.3, 453.15),
    'methylcyclohexane': (-12.85, 118.8, 298, (-0.203, -6.277, -1.935, -1.695), 545.3, 463.15),
}
for k, (lxm, b, Tm, d, T0, Tmax) in ALK.items():
    REF[k] = dict(x1=(lambda lxm, b, Tm: lambda T: math.exp(lxm + 0.376 * b * f_alk(T, Tm)))(lxm, b, Tm),
                  x2=(lambda d, T0: lambda T: math.exp(lnx_water_eq(T, d, T0)))(d, T0), Tr=(273.15, Tmax),
                  src=f'Mączyński, Wiśniewska-Gocłowska & Góral, J. Phys. Chem. Ref. Data 33 (2004) 549 (SDS-81 reference equations): ln x_min {lxm}, b {b} cm³/mol, T_min {Tm} K; water d = {d[0]}/{d[1]}/{d[2]}/{d[3]}, T_0 {T0} K')

# ---------------- models ----------------
def taus(p, T):    # p = a12, b12, e12, a21, b21, e21  (tau = a + b/T + e ln T, Aspen form without f)
    return p[0] + p[1] / T + p[2] * math.log(T), p[3] + p[4] / T + p[5] * math.log(T)
def nrtl_lng(x1, T, p, alpha):        # component 1 = water, 2 = hydrocarbon
    t12, t21 = taus(p, T)
    G12 = math.exp(-alpha * t12); G21 = math.exp(-alpha * t21)
    x2 = 1 - x1
    l1 = x2 * x2 * (t21 * (G21 / (x1 + x2 * G21)) ** 2 + t12 * G12 / (x2 + x1 * G12) ** 2)
    l2 = x1 * x1 * (t12 * (G12 / (x2 + x1 * G12)) ** 2 + t21 * G21 / (x1 + x2 * G21) ** 2)
    return l1, l2
def uniquac_lng(x1, T, p, r, q):
    t12, t21 = taus(p, T)
    tau = [[1, math.exp(t12)], [math.exp(t21), 1]]
    x = [x1, 1 - x1]; z = 10
    sr = sum(x[i] * r[i] for i in range(2)); sq = sum(x[i] * q[i] for i in range(2))
    th = [x[i] * q[i] / sq for i in range(2)]
    l = [z / 2 * (r[i] - q[i]) - (r[i] - 1) for i in range(2)]
    st = [sum(th[k] * tau[k][j] for k in range(2)) for j in range(2)]
    out = []
    for i in range(2):
        Vi = r[i] / sr; Fi = q[i] / sq
        comb = math.log(Vi) + 1 - Vi - z / 2 * q[i] * (math.log(Vi / Fi) + 1 - Vi / Fi)
        res = q[i] * (1 - math.log(st[i]) - sum(th[j] * tau[i][j] / st[j] for j in range(2)))
        out.append(comb + res)
    return out

def lle(lng, T, guess):
    # unknowns: ln(x_hc in water phase), ln(x_w in hc phase)
    def F(v):
        xh_I = math.exp(v[0]); xw_II = math.exp(v[1])
        x1I = 1 - xh_I; x1II = xw_II
        gI = lng(x1I, T); gII = lng(x1II, T)
        return [math.log(x1I) + gI[0] - math.log(x1II) - gII[0], math.log(xh_I) + gI[1] - math.log(1 - xw_II) - gII[1]]
    v, info, ier, msg = fsolve(F, [math.log(guess[0]), math.log(guess[1])], full_output=True, xtol=1e-12)
    if ier != 1 or max(abs(t) for t in F(v)) > 1e-8: return None
    return math.exp(v[0]), math.exp(v[1])

def grid(key):
    lo, hi = REF[key]['Tr']
    return list(np.linspace(lo, hi, 13))

def fit(key, model):
    ref = REF[key]; Ts = grid(key)
    r = [C['H2O']['r'], C[key]['r']]; q = [C['H2O']['q'], C[key]['q']]
    alpha = 0.2
    def mk(p):
        return (lambda x1, T: nrtl_lng(x1, T, p, alpha)) if model == 'nrtl' else (lambda x1, T: uniquac_lng(x1, T, p, r, q))
    # step 1: exact parameters at each T from the infinite-dilution-like conditions (solve 2x2 in tau at each T)
    def taus_at(T, start):
        x1I = 1 - ref['x1'](T); x1II = ref['x2'](T)
        def F(t):
            p = (t[0], 0, 0, t[1], 0, 0)
            lng = mk(p)
            gI = lng(x1I, T); gII = lng(x1II, T)
            return [math.log(x1I) + gI[0] - math.log(x1II) - gII[0], math.log(1 - x1I) + gI[1] - math.log(1 - x1II) - gII[1]]
        t, info, ier, msg = fsolve(F, start, full_output=True, xtol=1e-12)
        return t if ier == 1 else None
    start = [5.0, 1.0] if model == 'nrtl' else [-1.0, -3.0]
    tt = []
    for T in Ts:
        t = taus_at(T, start)
        if t is None:
            for s in ([8, 2], [6, 0.5], [3, 3], [-0.5, -4], [-2, -2], [0.5, -5]):
                t = taus_at(T, s)
                if t is not None: break
        if t is None: raise RuntimeError(f'{key} {model}: no exact tau at {T}')
        tt.append(t); start = list(t)
    tt = np.array(tt)
    X = np.vstack([np.ones(len(Ts)), 1 / np.array(Ts), np.log(Ts)]).T if USE_E else np.vstack([np.ones(len(Ts)), 1 / np.array(Ts), 0 * np.array(Ts)]).T
    c12 = np.linalg.lstsq(X, tt[:, 0], rcond=None)[0]; c21 = np.linalg.lstsq(X, tt[:, 1], rcond=None)[0]
    p0 = [c12[0], c12[1], c12[2], c21[0], c21[1], c21[2]]
    # step 2: refine on ln x of both phases with the LLE solved from the model
    def res(p):
        lng = mk(p); out = []
        for T in Ts:
            s = lle(lng, T, (ref['x1'](T), ref['x2'](T)))
            if s is None: out += [5, 5]; continue
            out += [math.log(s[0] / ref['x1'](T)), math.log(s[1] / ref['x2'](T))]
        return out
    if USE_E:
        sol = least_squares(res, p0, x_scale='jac')
        p = sol.x
    else:
        sol = least_squares(lambda q: res([q[0], q[1], 0, q[2], q[3], 0]), [p0[0], p0[1], p0[3], p0[4]], x_scale='jac')
        p = [sol.x[0], sol.x[1], 0, sol.x[2], sol.x[3], 0]
    rr = np.array(res(p))
    p = [p[0], p[1], p[2], p[3], p[4], p[5]]
    return dict(p=[float(v) for v in p], rms_pct=float(100 * math.sqrt(np.mean(np.expm1(np.abs(rr)) ** 2))), max_pct=float(100 * np.max(np.expm1(np.abs(rr)))), Ts=[float(t) for t in Ts], p0=[float(v) for v in p0], resid_pct=[float(100 * math.expm1(v)) for v in rr])


ORDER = ['benzene', 'toluene', 'ethylbenzene', 'oxylene', 'm-xylene', 'p-xylene', 'cyclohexane', 'methylcyclohexane', 'n-pentane', 'nC6H14', 'nC7H16', 'nC8H18', 'isooctane']
P_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'api', '_lib', 'mb-bip-extra.js')

def write_js(F):
    import re
    def g(v): return float('%.7g' % v)
    src, nr, uq = [], [], []
    for k in ORDER:
        f = F[k]; lo, hi = f['T_range']
        tag = 'W_' + re.sub(r'[^A-Za-z0-9]', '_', k)
        rn = f['nrtl']; ru = f['uniquac']
        src.append(f"const {tag} = {json.dumps('Fitted (multicalci.com, Nov 2026) to IUPAC-NIST mutual solubilities, %.0f–%.0f K — %s' % (lo, hi, f['src']), ensure_ascii=False)};")
        p = rn['p']
        nr.append(f"  'H2O|{k}': {{ a: {g(p[0])}, b: {g(p[1])}, e: {g(p[2])}, alpha: 0.2, T: [{lo}, {hi}], rms_pct: {rn['rms_pct']:.1f}, source: {tag} }},")
        nr.append(f"  '{k}|H2O': {{ a: {g(p[3])}, b: {g(p[4])}, e: {g(p[5])}, alpha: 0.2, T: [{lo}, {hi}], rms_pct: {rn['rms_pct']:.1f}, source: {tag} }},")
        p = ru['p']
        uq.append(f"  'H2O|{k}': {{ a: {g(p[0])}, b: {g(p[1])}, e: {g(p[2])}, T: [{lo}, {hi}], rms_pct: {ru['rms_pct']:.1f}, source: {tag} }},")
        uq.append(f"  '{k}|H2O': {{ a: {g(p[3])}, b: {g(p[4])}, e: {g(p[5])}, T: [{lo}, {hi}], rms_pct: {ru['rms_pct']:.1f}, source: {tag} }},")
    s = open(P_JS, encoding='utf8').read()
    block = ('// --- GENERATED by scripts/fit-water-hydrocarbon.py (round 11) — do not edit by hand ---\n' + '\n'.join(src) + '\n// --- end GENERATED sources ---\n')
    s = re.sub(r'// --- GENERATED by scripts/fit-water-hydrocarbon\.py.*?// --- end GENERATED sources ---\n', lambda m: block, s, flags=re.S)
    def put(name, rows, s):
        start = s.index(f'export const {name} = {{')
        end = s.index('\n};', start)
        body = re.sub(r'\n  // >>> water–hydrocarbon.*?// <<< water–hydrocarbon', '', s[start:end], flags=re.S)
        body += '\n  // >>> water–hydrocarbon pairs' + (', α = 0.2: τ = a + b/T + e ln T' if name == 'NRTL' else ': ln τ = a + b/T + e ln T') + '\n' + '\n'.join(rows) + '\n  // <<< water–hydrocarbon'
        return s[:start] + body + s[end:]
    s = put('NRTL', nr, s); s = put('UNIQUAC', uq, s)
    open(P_JS, 'w', encoding='utf8').write(s)

if __name__ == '__main__':
    out = {}
    for k in ORDER:
        out[k] = {'src': REF[k]['src'], 'T_range': REF[k]['Tr']}
        for m in ('nrtl', 'uniquac'):
            f = fit(k, m)
            out[k][m] = f
            print(k, m, ['%.6g' % v for v in f['p']], 'rms %.1f%% max %.1f%%' % (f['rms_pct'], f['max_pct']), flush=True)
    write_js(out)
    print('benzene water-side reference: d1 %.4f, T_c %.1f K; wrote %s' % (BZ_D1, BZ_T0, P_JS))
