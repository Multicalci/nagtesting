#!/usr/bin/env python3
"""
Round 12 — measured pure-component data for the extended databank (step 1 of 2).

Collects, for every compound with measured or evaluated critical constants (IUPAC, Matthews, CRC Handbook, PSRK)
that is not already in the ChemSep databank, the data Caleb Bell's `chemicals` library (MIT licence) carries
(round 13: also compounds whose critical constants come only from Yaws' compilation, Thermophysical Properties of
Chemicals and Hydrocarbons — some of them estimated there — admitted only with a measured normal boiling point and a
measured vapour-pressure equation, which the build step checks against each other):
critical constants, acentric factor, normal boiling and melting points, gas-phase formation enthalpy and entropy,
dipole moment, and the temperature correlations that exist for it — vapour pressure (Wagner, PPDS, DIPPR 101,
Antoine), ideal-gas heat capacity (TRC, Poling), heat of vaporisation (DIPPR 106, PPDS 12, CRC at Tb), liquid
density (DIPPR 105, PPDS 17), liquid heat capacity (DIPPR 100), viscosity and thermal conductivity (DIPPR, VDI
PPDS) and surface tension (Jasper). Every correlation is converted to the engine's ChemSep equation forms and
checked against `chemicals`' own function at three temperatures before it is written.

Fluids with a reference Helmholtz equation of state in CoolProp (MIT) take their critical point, boiling point,
acentric factor, vapour pressure, saturated-liquid density, heat of vaporisation and ideal-gas heat capacity from
it instead (equations fitted to the reference equation from 10 Pa to the critical point and checked: 0.5 % vapour
pressure and saturated-liquid density, 1.5 % heat of vaporisation below 0.97 Tc, 0.5 % ideal-gas heat capacity); the few such fluids not in the tables above are added from it.

Step 2 (scripts/build-compdb-ext.mjs) turns the output into api/_lib/mb-compdb-ext.js, filling what is missing
with the same estimates the engine uses for components given by structure.

Usage (repo root):  pip install chemicals scipy CoolProp thermo ;  python3 scripts/gather-compdb-ext.py /tmp/compdb-ext-input.json
"""
import json, math, os, re, sys
import numpy as np
from scipy.optimize import least_squares
import chemicals
from chemicals import critical as C, vapor_pressure as VP, heat_capacity as HC, phase_change as PC, volume as VOL
from chemicals import viscosity as MU, thermal_conductivity as KT, interface as IF, identifiers as ID, reaction as RX
from chemicals import dipole as DP, acentric as AC, dippr
import CoolProp
import CoolProp.CoolProp as CPP
import thermo.unifac as TU                      # DDBST UNIFAC / Dortmund group assignments (thermo, MIT)
TU.load_group_assignments_DDBST()

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = 8.314462618
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/compdb-ext-input.json'
ALLOWED = set('C H O N S F Cl Br I P Si B He Ne Ar Kr Xe'.split())

def existing_cas():
    s = open(os.path.join(ROOT, 'api/_lib/mb-compdb.js'), encoding='utf8').read()
    return set(re.findall(r'"cas":"([0-9-]+)"', s))

C._load_critical_data()
_CDIR = os.path.join(os.path.dirname(chemicals.__file__), 'Critical Properties')
DIPPR_PM = 'DIPPR 801 (Pina-Martinez et al., Fluid Phase Equilib. 485 (2019) 264, supporting data)'
CRIT = [('IUPAC', C.critical_data_IUPAC), ('Matthews', C.critical_data_Matthews), ('CRC Handbook', C.critical_data_CRC),
        (DIPPR_PM, __import__('pandas').read_csv(os.path.join(_CDIR, 'DIPPRPinaMartines.tsv'), sep='\t', index_col=0)),
        ('PSRK (Horstmann et al.)', C.critical_data_PSRKR4)]
YAWS = 'Yaws, Thermophysical Properties of Chemicals and Hydrocarbons, 2nd ed. (2014) — compiled critical constants'
CRIT_YAWS = [(YAWS, C.critical_data_Yaws)]          # round 13: only for a constant no table above has
import pandas as pd
_MDIR = os.path.join(os.path.dirname(chemicals.__file__), 'Misc')
def _cas_fmt(n):
    t = str(int(n)); return f'{t[:-3]}-{t[-3:-1]}-{t[-1]}'
CRC_ORG = pd.read_csv(os.path.join(_MDIR, 'Physical Constants of Organic Compounds.csv'), sep=None, engine='python', index_col=0)
WEBBOOK = pd.read_csv(os.path.join(_MDIR, 'webbook_constants.tsv'), sep='\t', low_memory=False)
WEBBOOK.index = [_cas_fmt(x) for x in WEBBOOK.CAS]
TB_MEASURED = ('HEOS', 'CRC_ORG', 'CRC_INORG', 'COMMON_CHEMISTRY', 'WEBBOOK', 'YAWS', 'WIKIDATA')
TB_NAMES = {'HEOS': 'reference equation of state (CoolProp)', 'CRC_ORG': 'CRC Handbook (organic compounds)', 'CRC_INORG': 'CRC Handbook (inorganic compounds)',
            'COMMON_CHEMISTRY': 'CAS Common Chemistry', 'WEBBOOK': 'NIST Chemistry WebBook', 'YAWS': 'Yaws, Thermophysical Properties of Chemicals and Hydrocarbons', 'WIKIDATA': 'Wikidata'}

def pick_crit(cas, field):
    for name, df in CRIT + CRIT_YAWS:
        if cas in df.index and field in df.columns:
            v = df.at[cas, field]
            if v == v and v is not None and float(v) > 0: return float(v), name
    return None, None

def _tab(cas, field, tables):
    return [[float(df.at[cas, field]), nm] for nm, df in tables if cas in df.index and field in df.columns and df.at[cas, field] == df.at[cas, field] and float(df.at[cas, field]) > 0]

def crit_cands(cas, field):
    """tabulated values in priority order; Yaws' compiled values only for a compound no other table has Tc or Pc for
    (so the compounds of round 12 keep exactly their data)"""
    if _tab(cas, 'Tc', CRIT) or _tab(cas, 'Pc', CRIT): return _tab(cas, field, CRIT)
    return _tab(cas, field, CRIT_YAWS)

def rel(a, b): return abs(a - b) / max(abs(b), 1e-300)

def check(name, f_ours, f_ref, Ts, tol=1e-7):
    for T in Ts:
        a, b = f_ours(T), f_ref(T)
        if not (a == a and b == b) or rel(a, b) > tol:
            raise ValueError(f'{name}: conversion check failed at {T:.2f} K ({a} vs {b})')

# --- engine equation forms (must match mb-thermo.js corr) ---
def eq(c, T, Tc=None):
    e, A, B, Cc, D, E = c[:6]
    if len(c) > 8 and c[8]: Tc = c[8]                                   # correlation carries its own Tc
    if e == 2: return A + B * T
    if e == 10: return math.exp(A - B / (T + Cc))
    if e == 100: return A + T * (B + T * (Cc + T * (D + E * T)))
    if e == 101: return math.exp(A + B / T + Cc * math.log(T) + D * T ** E)
    if e == 102: return A * T ** B / (1 + Cc / T + D / (T * T))
    if e == 105: return A / B ** (1 + max(1 - T / Cc, 0) ** D)
    if e == 106:
        Tr = T / Tc
        return A * (1 - Tr) ** (B + Tr * (Cc + Tr * (D + E * Tr))) if Tr < 1 else 0
    if e == 107: return A + B * ((Cc / T) / math.sinh(Cc / T)) ** 2 + D * ((E / T) / math.cosh(E / T)) ** 2
    if e == 116:
        tau = max(1 - T / Tc, 0)
        return A + B * tau ** 0.35 + Cc * tau ** (2 / 3) + D * tau + E * tau ** (4 / 3)
    if e == 117:
        tau = max(1 - T / Tc, 0)
        return 1000 * R * Tc * (A * tau ** (1 / 3) + B * tau ** (2 / 3) + Cc * tau + D * tau ** 2 + E * tau ** 6)
    if e == 200:
        tau = 1 - T / Tc
        return E * math.exp(Tc / T * (A * tau + B * tau ** 1.5 + Cc * tau ** 2.5 + D * tau ** 5))
    if e == 201:
        tau = 1 - T / Tc
        return E * math.exp(Tc / T * (A * tau + B * tau ** 1.5 + Cc * tau ** 3 + D * tau ** 6))
    raise ValueError(e)

def span(lo, hi, n=3):
    return [lo + (hi - lo) * (i + 0.5) / n for i in range(n)]

def psat_all(cas):
    """first available measured vapour-pressure correlation that converts cleanly, as [eq, A..E, Tmin, Tmax, Tc] in Pa;
    order: VDI Heat Atlas (PPDS, the most recent fits), Poling et al., McGarry, Perry (DIPPR 101), Antoine"""
    errors, out = [], []
    d = VP.Psat_data_VDI_PPDS_3
    if cas in d.index:
        try:
            r = d.loc[cas]; Tc = float(r.Tc); lo = max(float(r.Tm), 0.35 * Tc)
            c = [200, float(r.A), float(r.B), float(r.C), float(r.D), float(r.Pc), lo, Tc, Tc]
            check('PPDS', lambda T: eq(c, T, Tc), lambda T: VP.Wagner(T, Tc, float(r.Pc), float(r.A), float(r.B), float(r.C), float(r.D)), span(lo, 0.98 * Tc))
            out.append([c, 'Wagner (PPDS) equation, VDI Heat Atlas'])
        except (ValueError, TypeError) as e: errors.append(str(e))
    d = VP.Psat_data_WagnerPoling
    if cas in d.index:
        try:
            r = d.loc[cas]; Tc = float(r.Tc)
            c = [200, float(r.A), float(r.B), float(r.C), float(r.D), float(r.Pc), float(r.Tmin), float(r.Tmax), Tc]
            check('Wagner (Poling)', lambda T: eq(c, T, Tc), lambda T: VP.Wagner(T, Tc, float(r.Pc), float(r.A), float(r.B), float(r.C), float(r.D)), span(float(r.Tmin), min(float(r.Tmax), 0.98 * Tc)))
            out.append([c, 'Wagner equation (Poling et al. 2001)'])
        except (ValueError, TypeError) as e: errors.append(str(e))
    d = VP.Psat_data_WagnerMcGarry
    if cas in d.index:
        try:
            r = d.loc[cas]; Tc = float(r.Tc); lo = float(r.Tmin); hi = Tc
            c = [201, float(r.A), float(r.B), float(r.C), float(r.D), float(r.Pc), lo, hi, Tc]
            check('Wagner (McGarry)', lambda T: eq(c, T, Tc), lambda T: VP.Wagner_original(T, Tc, float(r.Pc), float(r.A), float(r.B), float(r.C), float(r.D)), span(lo, 0.98 * Tc))
            out.append([c, 'Wagner equation (McGarry 1983)'])
        except (ValueError, TypeError) as e: errors.append(str(e))
    d = VP.Psat_data_Perrys2_8
    if cas in d.index:
        try:
            r = d.loc[cas]
            c = [101, float(r.C1), float(r.C2), float(r.C3), float(r.C4), float(r.C5), float(r.Tmin), float(r.Tmax)]
            check('DIPPR 101', lambda T: eq(c, T), lambda T: dippr.EQ101(T, float(r.C1), float(r.C2), float(r.C3), float(r.C4), float(r.C5)), span(float(r.Tmin), float(r.Tmax)))
            out.append([c, 'DIPPR eq. 101, Perry’s Handbook 8th ed. Table 2-8'])
        except (ValueError, TypeError) as e: errors.append(str(e))
    d = VP.Psat_data_AntoinePoling
    if cas in d.index:
        try:
            r = d.loc[cas]; L = math.log(10)
            c = [10, float(r.A) * L, float(r.B) * L, float(r.C), 0.0, 0.0, float(r.Tmin), float(r.Tmax)]
            check('Antoine', lambda T: eq(c, T), lambda T: VP.Antoine(T, float(r.A), float(r.B), float(r.C), base=10.0), span(float(r.Tmin), float(r.Tmax)))
            out.append([c, 'Antoine equation (Poling et al. 2001)'])
        except (ValueError, TypeError) as e: errors.append(str(e))
    d = VP.Psat_data_Landolt_Antoine
    if cas in d.index:
        try:
            r = d.loc[cas]
            c = [10, float(r.A), float(r.B), float(r.C), 0.0, 0.0, float(r.Tmin), float(r.Tmax)]
            check('Antoine (Landolt)', lambda T: eq(c, T), lambda T: VP.Antoine(T, float(r.A), float(r.B), float(r.C), base=math.e), span(float(r.Tmin), float(r.Tmax)))
            out.append([c, 'Antoine equation, Landolt–Börnstein IV/20 (Dykyj, Svoboda, Wilhoit, Frenkel & Hall, Vapor Pressure of Chemicals)'])
        except (ValueError, TypeError) as e: errors.append(str(e))
    if cas in WEBBOOK.index:
        r = WEBBOOK.loc[cas]
        if r.AntoineA == r.AntoineA and r.AntoineTmax > r.AntoineTmin:
            c = [10, float(r.AntoineA), float(r.AntoineB), float(r.AntoineC), 0.0, 0.0, float(r.AntoineTmin), float(r.AntoineTmax)]
            out.append([c, 'Antoine equation, NIST Chemistry WebBook'])
    return out, errors

def fit107(f, lo, hi):
    Ts = np.linspace(lo, hi, 60); y = np.array([f(T) for T in Ts])
    best = None
    for Cg in (600, 1000, 1600, 2400):
        for Eg in (300, 600, 1000):
            x0 = [y.min() * 0.8, (y.max() - y.min()) * 2 + 1e3, Cg, (y.max() - y.min()) + 1e3, Eg]
            try:
                s = least_squares(lambda p: (np.array([eq([107] + list(p), T) for T in Ts]) - y) / y, x0, x_scale='jac', max_nfev=4000)
            except Exception: continue
            err = np.max(np.abs(s.fun))
            if best is None or err < best[1]: best = (s.x, err)
    return best

_HCDIR = os.path.join(os.path.dirname(chemicals.__file__), 'Heat Capacity')
JANAF_GAS = json.load(open(os.path.join(_HCDIR, 'JANAF_1998_gas_Cp.json')))
SHOMATE = json.load(open(os.path.join(_HCDIR, 'webbook_shomate_coefficients.json')))

def _fit_table(Ts, Cps, lo, hi, label):
    Ts, Cps = np.array(Ts, float), np.array(Cps, float) * 1000          # J/(kmol K)
    m = (Ts >= lo - 1e-9) & (Ts <= hi + 1e-9) & (Cps > 0)
    if m.sum() < 6: return None
    T, y = Ts[m], Cps[m]
    f = lambda t: float(np.interp(t, T, y))
    fit = fit107(f, float(T.min()), float(T.max()))
    if not fit: return None
    err = max(abs(eq([107] + list(fit[0]), t) / v - 1) for t, v in zip(T, y))   # at the tabulated points
    if err > 0.01: return None
    return [107] + [float(v) for v in fit[0]] + [float(T.min()), float(T.max())], f'{label}, fitted to DIPPR eq. 107 — largest deviation {100 * err:.2f} % over {T.min():.0f}–{T.max():.0f} K', err

def cpig_corr(cas):
    d = HC.TRC_gas_data
    if cas in d.index:
        r = d.loc[cas]; a = [float(r['a%d' % i]) for i in range(8)]
        lo, hi = max(float(r.Tmin), 200.0), min(float(r.Tmax), 1200.0)
        if hi > lo + 100:
            f = lambda T: HC.TRCCp(T, *a) * 1000                          # J/(kmol K)
            fit = fit107(f, lo, hi)
            if fit and fit[1] < 0.01:
                c = [107] + [float(v) for v in fit[0]] + [lo, hi]
                return c, f'TRC ideal-gas equation (Kabo & Roganov), refitted to DIPPR eq. 107 — largest deviation {100 * fit[1]:.2f} % over {lo:.0f}–{hi:.0f} K', fit[1]
    if cas in JANAF_GAS:
        Ts, Cps = JANAF_GAS[cas]
        out = _fit_table(Ts, Cps, 200.0, 1500.0, 'NIST-JANAF Thermochemical Tables (1998)')
        if out: return out
    sh = SHOMATE.get(cas)
    if sh and sh[2]:
        segs = sorted(sh[2], key=lambda r: r[0])
        Ts = [t for t in np.arange(200.0, 1501.0, 25.0) if segs[0][0] - 1e-9 <= t <= segs[-1][1] + 1e-9]
        def shom(t):
            for a in segs:
                if t <= a[1] + 1e-9: break
            A, B, Cc, D, E = a[2:7]; x = t / 1000
            return A + B * x + Cc * x * x + D * x ** 3 + E / (x * x)
        out = _fit_table(Ts, [shom(t) for t in Ts], 200.0, 1500.0, 'NIST Chemistry WebBook Shomate equation')
        if out: return out
    d = HC.Cp_data_Poling
    if cas in d.index:
        r = d.loc[cas]
        if r.a0 == r.a0 and r.Tmin == r.Tmin:
            k = [float(r['a%d' % i]) * R * 1000 for i in range(5)]
            c = [100] + k + [float(r.Tmin), float(r.Tmax)]
            return c, 'Poling et al. (2001) polynomial', 0.0
    return None, None, None

def hvap_corr(cas, Tc, MW):
    d = PC.phase_change_data_Perrys2_150
    if cas in d.index:
        r = d.loc[cas]; Tcp = float(r.Tc)
        c = [106, float(r.C1) * 1000, float(r.C2), float(r.C3), float(r.C4), 0.0, float(r.Tmin), float(r.Tmax), Tcp]      # J/mol -> J/kmol
        check('DIPPR 106', lambda T: eq(c, T, Tcp), lambda T: 1000 * dippr.EQ106(T, Tcp, float(r.C1), float(r.C2), float(r.C3), float(r.C4)), span(float(r.Tmin), min(float(r.Tmax), 0.98 * Tcp)))
        return c, 'DIPPR eq. 106, Perry’s Handbook 8th ed. Table 2-150', Tcp
    d = PC.phase_change_data_VDI_PPDS_4
    if cas in d.index:
        r = d.loc[cas]; Tcp = float(r.Tc)
        c = [117, float(r.A), float(r.B), float(r.C), float(r.D), float(r.E), 0.35 * Tcp, Tcp, Tcp]
        check('PPDS12', lambda T: eq(c, T, Tcp), lambda T: PC.PPDS12(T, Tcp, float(r.A), float(r.B), float(r.C), float(r.D), float(r.E)) * 1000, span(0.4 * Tcp, 0.97 * Tcp))
        return c, 'PPDS 12 equation, VDI Heat Atlas', Tcp
    d = PC.Hvap_data_CRC
    if cas in d.index:
        r = d.loc[cas]
        if r.HvapTb == r.HvapTb and r.Tb == r.Tb and Tc and float(r.Tb) < Tc:
            Tbr = float(r.Tb) / Tc
            c = [106, float(r.HvapTb) * 1000 / (1 - Tbr) ** 0.38, 0.38, 0.0, 0.0, 0.0, max(0.3 * Tc, 50.0), Tc, Tc]
            return c, 'CRC Handbook ΔHvap at the boiling point, Watson exponent 0.38', Tc
    return None, None, None

def rhol_corr(cas, MW):
    d = VOL.rho_data_Perry_8E_105_l
    if cas in d.index:
        r = d.loc[cas]
        c = [105, float(r.C1) / 1000, float(r.C2), float(r.C3), float(r.C4), 0.0, float(r.Tmin), float(r.Tmax)]      # mol/m3 -> kmol/m3
        check('DIPPR 105', lambda T: eq(c, T), lambda T: dippr.EQ105(T, float(r.C1), float(r.C2), float(r.C3), float(r.C4)) / 1000, span(float(r.Tmin), float(r.Tmax)))
        return c, 'DIPPR eq. 105, Perry’s Handbook 8th ed. Table 2-32', None
    d = VOL.rho_data_VDI_PPDS_2
    if cas in d.index:
        r = d.loc[cas]; Tc = float(r.Tc); M = float(r.MW)
        c = [116, float(r.rhoc) / M, float(r.A) / M, float(r.B) / M, float(r.C) / M, float(r.D) / M, 0.35 * Tc, Tc, Tc]
        check('PPDS17', lambda T: eq(c, T, Tc) * M, lambda T: VOL.volume_VDI_PPDS(T, Tc, float(r.rhoc), float(r.A), float(r.B), float(r.C), float(r.D)), span(0.4 * Tc, 0.97 * Tc), tol=1e-6)
        return c, 'PPDS 17 equation, VDI Heat Atlas', Tc
    return None, None, None

def simple(cas, df, eqno, cols, conv, name, ref, rng=None, dflt=None):
    if cas not in df.index: return None, None
    r = df.loc[cas]
    v = [float(r[c]) for c in cols]
    if any(x != x for x in v): return None, None
    lo, hi = rng(r) if rng else (float(r.Tmin), float(r.Tmax))
    if not (lo == lo and hi == hi and hi > lo):
        if not dflt: return None, None
        lo, hi = dflt
    c = [eqno] + conv(v) + [lo, hi]
    c = c[:1] + (c[1:6] + [0.0] * 5)[:5] + [lo, hi]
    if ref: check(name, lambda T: eq(c, T), ref(v), span(lo, hi), tol=1e-6)
    return c, name

# --- reference equations of state (CoolProp) ---
CP_SKIP = ('PPF', 'ppf', 'Ortho', 'Para', 'Deuterium', 'HeavyWater', 'Air')
def coolprop_map():
    out = {}
    for f in CPP.get_global_param_string('FluidsList').split(','):
        if any(x in f for x in CP_SKIP): continue
        cas = CPP.get_fluid_param_string(f, 'CAS')
        if re.fullmatch(r'\d+-\d\d-\d', cas): out[cas] = f
    return out

def coolprop_data(f):
    """constants and fitted correlations from a reference equation of state; raises ValueError if a fit misses"""
    P = lambda *a: CPP.PropsSI(*a)
    Tc, Pc, rhoc, M = P('Tcrit', f), P('pcrit', f), P('rhomolar_critical', f), P('molar_mass', f) * 1000
    Tt = max(P('Ttriple', f), P('Tmin', f))
    key = CPP.get_BibTeXKey(f, 'EOS')
    src = f'reference equation of state {key} (CoolProp {CoolProp.__version__}, MIT)'
    d = {'Tc': Tc, 'Pc': Pc, 'Vc': 1 / rhoc, 'omega': P('acentric', f), 'src': src, 'fluid': f, 'corr': {}, 'fit': {}}
    try: d['Tb'] = P('T', 'P', 101325, 'Q', 0, f)
    except Exception: d['Tb'] = None
    lo = max(Tt, 0.35 * Tc)
    try: lo = max(lo, P('T', 'P', 10.0, 'Q', 0, f))                     # the fits start where the vapour pressure reaches 10 Pa
    except Exception: pass
    T = np.linspace(lo, 0.995 * Tc, 60)
    ps = np.array([P('P', 'T', t, 'Q', 0, f) for t in T])
    tau = 1 - T / Tc
    A = np.vstack([tau, tau ** 1.5, tau ** 2.5, tau ** 5]).T * (Tc / T)[:, None]
    co, *_ = np.linalg.lstsq(A, np.log(ps / Pc), rcond=None)
    c = [200] + [float(v) for v in co] + [Pc, float(lo), float(Tc), float(Tc)]
    err = max(abs(eq(c, t) / v - 1) for t, v in zip(T, ps))
    if err > 0.005: raise ValueError(f'{f}: Wagner fit to the reference vapour pressure misses by {100 * err:.2f} %')
    d['corr']['psat'] = c; d['fit']['psat'] = err
    rl = np.array([P('Dmolar', 'T', t, 'Q', 0, f) / 1000 for t in T])            # kmol/m3
    B = np.vstack([np.ones_like(tau), tau ** 0.35, tau ** (2 / 3), tau, tau ** (4 / 3)]).T
    co, *_ = np.linalg.lstsq(B, rl, rcond=None)
    c = [116] + [float(v) for v in co] + [float(lo), float(Tc), float(Tc)]
    err = max(abs(eq(c, t) / v - 1) for t, v in zip(T, rl))
    if err > 0.005: raise ValueError(f'{f}: PPDS density fit misses by {100 * err:.2f} %')
    d['corr']['rhol'] = c; d['fit']['rhol'] = err
    T2 = T[T < 0.97 * Tc]
    hv = np.array([(P('Hmolar', 'T', t, 'Q', 1, f) - P('Hmolar', 'T', t, 'Q', 0, f)) * 1000 for t in T2])   # J/kmol
    Tr = T2 / Tc
    Cm = np.vstack([np.ones_like(Tr), np.log(1 - Tr), Tr * np.log(1 - Tr), Tr ** 2 * np.log(1 - Tr), Tr ** 3 * np.log(1 - Tr)]).T
    co, *_ = np.linalg.lstsq(Cm, np.log(hv), rcond=None)
    c = [106, float(np.exp(co[0]))] + [float(v) for v in co[1:]] + [float(lo), float(Tc), float(Tc)]
    err = max(abs(eq(c, t) / v - 1) for t, v in zip(T2, hv))
    if err > 0.015: raise ValueError(f'{f}: DIPPR 106 fit to the heat of vaporisation misses by {100 * err:.2f} %')
    d['corr']['hvap'] = c; d['fit']['hvap'] = err
    cp0 = lambda t: P('Cp0molar', 'T', t, 'Dmolar', 1e-9, f) * 1000          # J/(kmol K)
    a, b = max(200.0, min(Tt, 300.0)), min(1200.0, max(P('Tmax', f), 600.0))
    fit = fit107(cp0, a, b)
    if not fit or fit[1] > 0.005: raise ValueError(f'{f}: Aly–Lee fit to the ideal-gas heat capacity misses')
    d['corr']['cpig'] = [107] + [float(v) for v in fit[0]] + [a, b]; d['fit']['cpig'] = fit[1]
    return d

def apply_coolprop(rec, d):
    for k in ('Tc', 'Pc', 'Vc'):
        rec['cands'][k] = [[d[k], d['src']]] + rec['cands'].get(k, [])
    rec['Tc'], rec['Pc'], rec['Vc'] = d['Tc'], d['Pc'], d['Vc']
    rec['src'].update({'Tc': d['src'], 'Pc': d['src'], 'Vc': d['src']})
    if d.get('Tb'): rec['Tb'] = d['Tb']; rec['src']['Tb'] = d['src']; rec['Tb_cands'] = [[d['Tb'], d['src']]] + rec.get('Tb_cands', [])
    rec['omega'] = d['omega']; rec['src']['omega'] = d['src']
    rec['psat_all'] = [[d['corr']['psat'], f"{d['src']}, fitted ({100 * d['fit']['psat']:.2f} % max deviation)"]] + rec.get('psat_all', [])
    for k, c in d['corr'].items():
        rec['corr'][k] = c
        rec['src'][k] = f"{d['src']}, fitted ({100 * d['fit'][k]:.2f} % max deviation)"
    rec['Tc_psat'] = d['Tc']; rec['coolprop'] = d['fluid']

# formation enthalpy and entropy of the ideal gas: tabulated values only (the chemicals library would fall back to Joback)
HF_NAMES = {'ATCT_G': 'Active Thermochemical Tables (ATcT 1.112)', 'TRC': 'TRC Thermodynamic Tables', 'CRC': 'CRC Handbook', 'WEBBOOK': 'NIST Chemistry WebBook',
            'JANAF': 'NIST-JANAF Thermochemical Tables', 'API_TDB_G': 'API Technical Data Book', 'YAWS': 'Yaws, Thermophysical Properties of Chemicals and Hydrocarbons'}
def formation(rec, cas):
    for key, fn, meths in (('Hf', RX.Hfg, RX.Hfg_methods), ('S0', RX.S0g, RX.S0g_methods)):
        try:
            for m in meths(cas):
                if m in HF_NAMES:
                    v = fn(cas, method=m)
                    if v is not None:
                        rec[key] = float(v) / 1000 if key == 'Hf' else float(v); rec['src'][key] = HF_NAMES[m]; break
        except Exception: pass

def add_ddbst(rec):
    k = rec.get('inchikey')
    g = {}
    if k and TU.DDBST_UNIFAC_assignments.get(k): g['unifac'] = {str(a): int(b) for a, b in TU.DDBST_UNIFAC_assignments[k].items()}
    if k and TU.DDBST_MODIFIED_UNIFAC_assignments.get(k): g['modunifac'] = {str(a): int(b) for a, b in TU.DDBST_MODIFIED_UNIFAC_assignments[k].items()}
    if g: rec['ddbst'] = g

def main():
    have = existing_cas()
    cpmap = coolprop_map()
    cand = set()
    for _, df in CRIT + CRIT_YAWS: cand |= set(df.index)
    cand -= have
    out, skipped = [], {}
    def skip(why): skipped[why] = skipped.get(why, 0) + 1
    for cas in sorted(cand):
        try: m = ID.search_chemical(cas)
        except Exception: m = None
        if not m or not m.smiles: skip('no structure'); continue
        smi = m.smiles
        if '.' in smi: skip('mixture / salt'); continue
        els = set(re.findall(r'[A-Z][a-z]?', m.formula or ''))
        if not els or not els <= ALLOWED: skip('elements outside C H O N S halogens P Si B, noble gases'); continue
        if re.search(r'\[[^\]]*[+-]\d*\]', smi) and not re.search(r'N\+\]|\[O-\]', smi): skip('ion'); continue
        if cas == '14762-55-1': skip('quantum fluid (helium-3)'); continue
        Tc, sTc = pick_crit(cas, 'Tc'); Pc, sPc = pick_crit(cas, 'Pc'); Vc, sVc = pick_crit(cas, 'Vc')
        if not (Tc and Pc): skip('no Tc / Pc'); continue
        MW = float(m.MW)
        if MW > 500: skip('MW > 500'); continue
        cands = {f: crit_cands(cas, f) for f in ('Tc', 'Pc', 'Vc')}
        rec = {'cas': cas, 'name': m.common_name or m.iupac_name, 'iupac': m.iupac_name, 'formula': m.formula, 'smiles': smi, 'mw': MW, 'inchikey': m.InChI_key,
               'Tc': Tc, 'Pc': Pc, 'Vc': Vc, 'cands': cands, 'src': {'Tc': sTc, 'Pc': sPc}, 'corr': {}}
        if Vc: rec['src']['Vc'] = sVc
        # every tabulated (not estimated) normal boiling point; the builder takes the one the others or the vapour-pressure equation confirm
        rec['Tb'] = None; rec['Tb_cands'] = []
        try:
            for meth in PC.Tb_methods(cas):
                if meth in TB_MEASURED:
                    v = float(PC.Tb(cas, method=meth))
                    if v > 0: rec['Tb_cands'].append([v, TB_NAMES[meth]])
        except Exception: pass
        if rec['Tb_cands']: rec['Tb'], rec['src']['Tb'] = rec['Tb_cands'][0]
        try: Tm = PC.Tm(cas); rec['Tm'] = float(Tm) if Tm else None
        except Exception: rec['Tm'] = None
        if rec['Tb'] and rec['Tm'] and rec['Tm'] >= rec['Tb'] - 0.5: skip('sublimes at 1 atm (triple point above 1 atm)'); continue
        if cas in C.critical_data_PSRKR4.index and C.critical_data_PSRKR4.at[cas, 'omega'] == C.critical_data_PSRKR4.at[cas, 'omega']:
            rec['omega'] = float(C.critical_data_PSRKR4.at[cas, 'omega']); rec['src']['omega'] = 'PSRK (Horstmann et al.)'
        formation(rec, cas)
        try:
            mu = DP.dipole_moment(cas)
            if mu is not None: rec['dipole'] = float(mu)
        except Exception: pass
        lst, errs = psat_all(cas)
        if errs: rec['src']['psat_conversion_rejected'] = '; '.join(errs)
        if lst:
            rec['psat_all'] = lst
            rec['corr']['psat'], rec['src']['psat'] = lst[0]
            rec['Tc_psat'] = lst[0][0][8] if len(lst[0][0]) > 8 else None
        try:
            c, s, err = cpig_corr(cas)
            if c: rec['corr']['cpig'] = c; rec['src']['cpig'] = s
        except ValueError as e: rec['src']['cpig_rejected'] = str(e)
        try:
            c, s, Tcx = hvap_corr(cas, Tc, MW)
            if c: rec['corr']['hvap'] = c; rec['src']['hvap'] = s; rec['Tc_hvap'] = Tcx
        except ValueError as e: rec['src']['hvap_rejected'] = str(e)
        try:
            c, s, Tcx = rhol_corr(cas, MW)
            if c: rec['corr']['rhol'] = c; rec['src']['rhol'] = s; rec['Tc_rhol'] = Tcx
        except ValueError as e: rec['src']['rhol_rejected'] = str(e)
        if cas in VOL.rho_data_COSTALD.index:
            r = VOL.rho_data_COSTALD.loc[cas]
            if r.Vchar == r.Vchar: rec['vcost'] = float(r.Vchar) * 1000; rec['wcost'] = float(r.omega_SRK)
            if r.Z_RA == r.Z_RA: rec['zra'] = float(r.Z_RA)
        for key, args in (
            ('cpl', (HC.Cp_data_Perry_Table_153_100, 100, ['A', 'B', 'C', 'D', 'E'], lambda v: v, 'DIPPR eq. 100, Perry’s Handbook 8th ed. Table 2-153', lambda v: (lambda T: dippr.EQ100(T, *v)))),
            ('mul', (MU.mu_data_Perrys_8E_2_313, 101, ['C1', 'C2', 'C3', 'C4', 'C5'], lambda v: v, 'DIPPR eq. 101, Perry’s Handbook 8th ed. Table 2-313', lambda v: (lambda T: dippr.EQ101(T, *v)))),
            ('muv', (MU.mu_data_Perrys_8E_2_312, 102, ['C1', 'C2', 'C3', 'C4'], lambda v: v, 'DIPPR eq. 102, Perry’s Handbook 8th ed. Table 2-312', lambda v: (lambda T: dippr.EQ102(T, *v)))),
            ('kl', (KT.k_data_Perrys_8E_2_315, 100, ['C1', 'C2', 'C3', 'C4', 'C5'], lambda v: v, 'DIPPR eq. 100, Perry’s Handbook 8th ed. Table 2-315', lambda v: (lambda T: dippr.EQ100(T, *v)))),
            ('kv', (KT.k_data_Perrys_8E_2_314, 102, ['C1', 'C2', 'C3', 'C4'], lambda v: v, 'DIPPR eq. 102, Perry’s Handbook 8th ed. Table 2-314', lambda v: (lambda T: dippr.EQ102(T, *v)))),
            ('st', (IF.sigma_data_Jasper_Lange, 2, ['a', 'b'], lambda v: [(v[0] + 273.15 * v[1]) / 1000, -v[1] / 1000], 'Jasper (1972) linear fit, Lange’s Handbook', lambda v: (lambda T: IF.Jasper(T, v[0], v[1]))))):
            try:
                dflt = (max(rec.get('Tm') or 0, 0.4 * Tc, 200.0), min(rec.get('Tb') or 0.7 * Tc, 0.75 * Tc)) if key == 'st' else None
                c, s = simple(cas, args[0], args[1], args[2], args[3], args[4], args[5], dflt=dflt)
                if c: rec['corr'][key] = c; rec['src'][key] = s
            except ValueError as e: rec['src'][key + '_rejected'] = str(e)
        if 'muv' not in rec['corr'] and cas in MU.mu_data_VDI_PPDS_8.index:
            r = MU.mu_data_VDI_PPDS_8.loc[cas]
            rec['corr']['muv'] = [100] + [float(r[x]) for x in 'ABCDE'] + [max(0.4 * Tc, 150), 1000.0]; rec['src']['muv'] = 'VDI Heat Atlas polynomial'
        if 'kv' not in rec['corr'] and cas in KT.k_data_VDI_PPDS_10.index:
            r = KT.k_data_VDI_PPDS_10.loc[cas]
            rec['corr']['kv'] = [100] + [float(r[x]) for x in 'ABCDE'] + [max(0.4 * Tc, 150), 1000.0]; rec['src']['kv'] = 'VDI Heat Atlas polynomial'
        if 'kl' not in rec['corr'] and cas in KT.k_data_VDI_PPDS_9.index:
            r = KT.k_data_VDI_PPDS_9.loc[cas]
            rec['corr']['kl'] = [100] + [float(r[x]) for x in 'ABCDE'] + [max(0.4 * Tc, 150), 0.9 * Tc]; rec['src']['kl'] = 'VDI Heat Atlas polynomial'
        # critical constants from DIPPR or Yaws only: the compound goes in only with a measured boiling point and vapour-pressure equation
        if all(x[1] in (DIPPR_PM, YAWS) for x in cands['Tc'] + cands['Pc']) and cas not in cpmap and not ('psat' in rec['corr'] and rec['Tb']):
            skip('critical constants from DIPPR or Yaws only, without a measured boiling point and vapour-pressure equation'); continue
        if any(x[1] == YAWS for x in cands['Tc'] + cands['Pc']): rec['crit_compiled'] = True
        if cas in CRC_ORG.index and CRC_ORG.at[cas, 'rho'] == CRC_ORG.at[cas, 'rho'] and float(CRC_ORG.at[cas, 'rho']) > 0:
            rec['rho_point'] = [float(CRC_ORG.at[cas, 'rho']), 293.15, 'CRC Handbook density (20 °C)']
        if 'mul' not in rec['corr'] and cas in MU.mu_data_VN3.index:
            r = MU.mu_data_VN3.loc[cas]; L = math.log(10)
            try:
                A = float(r.A) - 3                                               # cP -> Pa s
                c = [10, L * A, L * float(r.B), -float(r.C), 0.0, 0.0, float(r.Tmin), float(r.Tmax)]
                check('Viswanath–Natarajan', lambda T: eq(c, T), lambda T: MU.Viswanath_Natarajan_3(T, A, float(r.B), float(r.C)), span(float(r.Tmin), float(r.Tmax)))
                rec['corr']['mul'] = c; rec['src']['mul'] = 'Viswanath & Natarajan, Data Book on the Viscosity of Liquids (1989)'
            except (ValueError, TypeError) as e: rec['src']['mul_rejected'] = str(e)
        add_ddbst(rec)
        if cas in cpmap:
            try: apply_coolprop(rec, coolprop_data(cpmap[cas]))
            except ValueError as e: rec['src']['coolprop_rejected'] = str(e)
        out.append(rec)
    done = {r['cas'] for r in out}
    for cas, f in sorted(cpmap.items()):
        if cas in have or cas in done: continue
        try: m = ID.search_chemical(cas)
        except Exception: m = None
        if not m or not m.smiles or '.' in m.smiles: skip('no structure'); continue
        try: d = coolprop_data(f)
        except ValueError as e: skip('reference-equation fit'); print(e); continue
        rec = {'cas': cas, 'name': m.common_name or f, 'iupac': m.iupac_name, 'formula': m.formula, 'smiles': m.smiles, 'mw': float(m.MW),
               'Tc': d['Tc'], 'Pc': d['Pc'], 'Vc': d['Vc'], 'cands': {'Tc': [], 'Pc': [], 'Vc': []}, 'src': {}, 'corr': {}}
        try: Tm = PC.Tm(cas); rec['Tm'] = float(Tm) if Tm else None
        except Exception: rec['Tm'] = None
        formation(rec, cas)
        try:
            mu = DP.dipole_moment(cas)
            if mu is not None: rec['dipole'] = float(mu)
        except Exception: pass
        rec['inchikey'] = m.InChI_key
        add_ddbst(rec)
        apply_coolprop(rec, d)
        out.append(rec)
    json.dump({'chemicals_version': chemicals.__version__, 'records': out, 'skipped': skipped}, open(OUT, 'w'), indent=0, ensure_ascii=False)
    have_ps = sum(1 for r in out if 'psat' in r['corr']); have_cp = sum(1 for r in out if 'cpig' in r['corr'])
    print(f'{len(out)} records ({have_ps} with a measured vapour-pressure correlation, {have_cp} with measured ideal-gas Cp); skipped {skipped}')

if __name__ == '__main__':
    main()
