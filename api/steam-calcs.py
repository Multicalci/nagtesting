# REPO PATH: api/steam-calcs.py

# ════════════════════════════════════════════════════════════════════════════
# api/steam-calcs.py
# MERGED VERCEL PYTHON SERVERLESS FUNCTION
#
# CALCULATORS IN THIS FILE
# ─────────────────────────────────────────────────────────────────────────
#   SECTION A  ►  STEAM PROPERTIES (IAPWS-IF97)        /api/steam
#   SECTION B  ►  STEAM QUENCH / DESUPERHEATER         /api/steam-quench
#   SECTION C  ►  STEAM TURBINE POWER                  /api/steam-turbine-power
#   SECTION D  ►  RANKINE CYCLE                        /api/rankine
#
# HOW TO NAVIGATE
#   Search "SECTION A" → Steam Properties
#   Search "SECTION B" → Steam Quench / Desuperheater
#   Search "SECTION C" → Steam Turbine Power
#   Search "SECTION D" → Rankine Cycle
#
# ROUTING
#   All 4 routes point here via vercel.json rewrites.
#   The handler reads the last URL path segment and dispatches internally.
#
# DEPENDENCY
#   none — the IAPWS-IF97 equations are implemented below (pure Python). The
#   same formulation, with the same coefficients, serves the flowsheet
#   simulator in api/_lib/steam-if97.js; both are checked against the IAPWS
#   verification tables (.github/tests/test_steam_calcs.py, tests/run-tests.js).
#
# ════════════════════════════════════════════════════════════════════════════

from http.server import BaseHTTPRequestHandler
import json
import math
from datetime import datetime
# ═══════════════════════════════════════════════════════════════════
# IAPWS-IF97 water and steam properties — pure Python, no dependencies.
# Python twin of api/_lib/steam-if97.js (same equations, same coefficients,
# same branch logic); both are checked against the IAPWS verification tables.
#   region 1 compressed liquid · region 2 steam · region 3 near-critical
#   (f(ρ,T), solved for ρ at given p, T) · region 4 saturation · region 5
#   high-temperature steam · B23 boundary.
# Coefficients: IAPWS R7-97(2012). Transport: viscosity IAPWS R12-08
# (industrial, μ2 = 1); thermal conductivity IAPWS R15-11 (industrial, with
# the critical enhancement); surface tension IAPWS R1-76(2014).
# Units inside: p MPa, T K, h kJ/kg, s kJ/(kg·K), v m³/kg.
# ═══════════════════════════════════════════════════════════════════
import math

_R = 0.461526
_TC = 647.096
_PC = 22.064
_RHOC = 322.0
_PMIN = 611.213e-6

_R1_I = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 8, 8, 21, 23, 29, 30, 31, 32]
_R1_J = [-2, -1, 0, 1, 2, 3, 4, 5, -9, -7, -1, 0, 1, 3, -3, 0, 1, 3, 17, -4, 0, 6, -5, -2, 10, -8, -11, -6, -29, -31, -38, -39, -40, -41]
_R1_N = [0.14632971213167, -0.84548187169114, -3.756360367204, 3.3855169168385, -0.95791963387872, 0.15772038513228, -0.016616417199501, 0.00081214629983568, 0.00028319080123804, -0.00060706301565874, -0.018990068218419, -0.032529748770505, -0.021841717175414, -5.283835796993e-05, -0.00047184321073267, -0.00030001780793026, 4.7661393906987e-05, -4.4141845330846e-06, -7.2694996297594e-16, -3.1679644845054e-05, -2.8270797985312e-06, -8.5205128120103e-10, -2.2425281908e-06, -6.5171222895601e-07, -1.4341729937924e-13, -4.0516996860117e-07, -1.2734301741641e-09, -1.7424871230634e-10, -6.8762131295531e-19, 1.4478307828521e-20, 2.6335781662795e-23, -1.1947622640071e-23, 1.8228094581404e-24, -9.3537087292458e-26]
_R2_J0 = [0, 1, -5, -4, -3, -2, -1, 2, 3]
_R2_N0 = [-9.6927686500217, 10.086655968018, -0.005608791128302, 0.071452738081455, -0.40710498223928, 1.4240819171444, -4.383951131945, -0.28408632460772, 0.021268463753307]
_R2_I = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10, 10, 10, 16, 16, 18, 20, 20, 20, 21, 22, 23, 24, 24, 24]
_R2_J = [0, 1, 2, 3, 6, 1, 2, 4, 7, 36, 0, 1, 3, 6, 35, 1, 2, 3, 7, 3, 16, 35, 0, 11, 25, 8, 36, 13, 4, 10, 14, 29, 50, 57, 20, 35, 48, 21, 53, 39, 26, 40, 58]
_R2_N = [-0.0017731742473213, -0.017834862292358, -0.045996013696365, -0.057581259083432, -0.05032527872793, -3.3032641670203e-05, -0.00018948987516315, -0.0039392777243355, -0.043797295650573, -2.6674547914087e-05, 2.0481737692309e-08, 4.3870667284435e-07, -3.227767723857e-05, -0.0015033924542148, -0.040668253562649, -7.8847309559367e-10, 1.2790717852285e-08, 4.8225372718507e-07, 2.2922076337661e-06, -1.6714766451061e-11, -0.0021171472321355, -23.895741934104, -5.905956432427e-18, -1.2621808899101e-06, -0.038946842435739, 1.1256211360459e-11, -8.2311340897998, 1.9809712802088e-08, 1.0406965210174e-19, -1.0234747095929e-13, -1.0018179379511e-09, -8.0882908646985e-11, 0.10693031879409, -0.33662250574171, 8.9185845355421e-25, 3.0629316876232e-13, -4.2002467698208e-06, -5.9056029685639e-26, 3.7826947613457e-06, -1.2768608934681e-15, 7.3087610595061e-29, 5.5414715350778e-17, -9.436970724121e-07]
_R3_I = [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9, 9, 10, 10, 11]
_R3_J = [0, 1, 2, 7, 10, 12, 23, 2, 6, 15, 17, 0, 2, 6, 7, 22, 26, 0, 2, 4, 16, 26, 0, 2, 4, 26, 1, 3, 26, 0, 2, 26, 2, 26, 2, 26, 0, 1, 26]
_R3_N = [-15.732845290239, 20.944396974307, -7.6867707878716, 2.6185947787954, -2.808078114862, 1.2053369696517, -0.0084566812812502, -1.2654315477714, -1.1524407806681, 0.88521043984318, -0.64207765181607, 0.38493460186671, -0.85214708824206, 4.8972281541877, -3.0502617256965, 0.039420536879154, 0.12558408424308, -0.2799932969871, 1.389979956946, -2.018991502357, -0.0082147637173963, -0.47596035734923, 0.0439840744735, -0.44476435428739, 0.90572070719733, 0.70522450087967, 0.10770512626332, -0.32913623258954, -0.50871062041158, -0.022175400873096, 0.094260751665092, 0.16436278447961, -0.013503372241348, -0.014834345352472, 0.00057922953628084, 0.0032308904703711, 8.0964802996215e-05, -0.00016557679795037, -4.4923899061815e-05]
_R5_J0 = [0, 1, -3, -2, -1, 2]
_R5_N0 = [-13.179983674201, 6.8540841634434, -0.024805148933466, 0.36901534980333, -3.1161318213925, -0.32961626538917]
_R5_I = [1, 1, 1, 2, 2, 3]
_R5_J = [1, 2, 3, 3, 9, 7]
_R5_N = [0.0015736404855259, 0.00090153761673944, -0.0050270077677648, 2.2440037409485e-06, -4.1163275453471e-06, 3.7919454822955e-08]

_R3_N1 = 1.0658070028513
_R4_N = (0, 0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5,
         -0.32325550322333e7, 0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6,
         -0.23855557567849, 0.65017534844798e3)
_B23_N = (0.34805185628969e3, -0.11671859879975e1, 0.10192970039326e-2, 0.57254459862746e3, 0.13918839778870e2)


class SteamRangeError(ValueError):
    pass


def _fmtT(T): return '%.2f °C' % (T - 273.15)
def _fmtP(p): return '%.5g bar' % (p * 10)


def _psat(T):
    if not (273.15 <= T <= _TC):
        raise SteamRangeError('saturation needs 0–373.946 °C (got %s)' % _fmtT(T))
    n = _R4_N
    th = T + n[9] / (T - n[10])
    A = th * th + n[1] * th + n[2]
    B = n[3] * th * th + n[4] * th + n[5]
    C = n[6] * th * th + n[7] * th + n[8]
    return (2 * C / (-B + math.sqrt(B * B - 4 * A * C))) ** 4


def _tsat(p):
    if not (_PMIN * 0.999999 <= p <= _PC):
        raise SteamRangeError('saturation needs 0.00611–220.64 bar (got %s)' % _fmtP(p))
    n = _R4_N
    b = p ** 0.25
    E = b * b + n[3] * b + n[6]
    F = n[1] * b * b + n[4] * b + n[7]
    G = n[2] * b * b + n[5] * b + n[8]
    D = 2 * G / (-F - math.sqrt(F * F - 4 * E * G))
    return (n[10] + D - math.sqrt((n[10] + D) ** 2 - 4 * (n[9] + n[10] * D))) / 2


def _p23(T): return _B23_N[0] + _B23_N[1] * T + _B23_N[2] * T * T


def _gibbs_state(region, T, p, g, gp, gpp, gt, gtt, gpt, pi, tau):
    v = pi * gp * _R * T / (p * 1000)
    X = gp - tau * gpt
    return dict(region=region, T=T, p=p, v=v, rho=1 / v, h=tau * gt * _R * T, s=_R * (tau * gt - g),
                u=_R * T * (tau * gt - pi * gp), cp=-_R * tau * tau * gtt,
                cv=_R * (-tau * tau * gtt + X * X / gpp),
                w=math.sqrt(_R * T * 1000 * gp * gp / (X * X / (tau * tau * gtt) - gpp)),
                kt=-pi * gpp / gp / p, alfav=(1 - tau * gpt / gp) / T)


def _region1(T, p):
    pi, tau = p / 16.53, 1386.0 / T
    a, b = 7.1 - pi, tau - 1.222
    g = gp = gpp = gt = gtt = gpt = 0.0
    for I, J, n in zip(_R1_I, _R1_J, _R1_N):
        aI, bJ = a ** I, b ** J
        aI1, bJ1 = a ** (I - 1), b ** (J - 1)
        g += n * aI * bJ
        gp -= n * I * aI1 * bJ
        gpp += n * I * (I - 1) * a ** (I - 2) * bJ
        gt += n * J * aI * bJ1
        gtt += n * J * (J - 1) * aI * b ** (J - 2)
        gpt -= n * I * J * aI1 * bJ1
    return _gibbs_state(1, T, p, g, gp, gpp, gt, gtt, gpt, pi, tau)


def _ideal_plus_residual(region, T, p, tau, J0, N0, Ir, Jr, Nr, shift):
    pi = p
    g0, g0t, g0tt = math.log(pi), 0.0, 0.0
    for j, n in zip(J0, N0):
        g0 += n * tau ** j
        g0t += n * j * tau ** (j - 1)
        g0tt += n * j * (j - 1) * tau ** (j - 2)
    g0p = 1 / pi
    b = tau - shift
    gr = grp = grpp = grt = grtt = grpt = 0.0
    for i, j, n in zip(Ir, Jr, Nr):
        pI, pI1 = pi ** i, pi ** (i - 1)
        bJ, bJ1 = b ** j, b ** (j - 1)
        gr += n * pI * bJ
        grp += n * i * pI1 * bJ
        grpp += n * i * (i - 1) * pi ** (i - 2) * bJ
        grt += n * pI * j * bJ1
        grtt += n * pI * j * (j - 1) * b ** (j - 2)
        grpt += n * i * pI1 * j * bJ1
    v = pi * (g0p + grp) * _R * T / (p * 1000)
    A = 1 + pi * grp - tau * pi * grpt
    return dict(region=region, T=T, p=p, v=v, rho=1 / v, h=_R * T * tau * (g0t + grt),
                s=_R * (tau * (g0t + grt) - (g0 + gr)), u=_R * T * (tau * (g0t + grt) - pi * (g0p + grp)),
                cp=-_R * tau * tau * (g0tt + grtt),
                cv=_R * (-tau * tau * (g0tt + grtt) - A * A / (1 - pi * pi * grpp)),
                w=math.sqrt(_R * T * 1000 * (1 + 2 * pi * grp + pi * pi * grp * grp)
                            / ((1 - pi * pi * grpp) + A * A / (tau * tau * (g0tt + grtt)))),
                kt=(1 - pi * pi * grpp) / (1 + pi * grp) / p, alfav=A / (1 + pi * grp) / T)


def _region2(T, p): return _ideal_plus_residual(2, T, p, 540.0 / T, _R2_J0, _R2_N0, _R2_I, _R2_J, _R2_N, 0.5)
def _region5(T, p): return _ideal_plus_residual(5, T, p, 1000.0 / T, _R5_J0, _R5_N0, _R5_I, _R5_J, _R5_N, 0.0)


def _region3(rho, T):
    d, tau = rho / _RHOC, _TC / T
    f, fd, fdd = _R3_N1 * math.log(d), _R3_N1 / d, -_R3_N1 / (d * d)
    ft = ftt = fdt = 0.0
    for I, J, n in zip(_R3_I, _R3_J, _R3_N):
        dI, dI1 = d ** I, d ** (I - 1)
        tJ, tJ1 = tau ** J, tau ** (J - 1)
        f += n * dI * tJ
        fd += n * I * dI1 * tJ
        fdd += n * I * (I - 1) * d ** (I - 2) * tJ
        ft += n * J * dI * tJ1
        ftt += n * J * (J - 1) * dI * tau ** (J - 2)
        fdt += n * I * J * dI1 * tJ1
    X, Y = d * fd - d * tau * fdt, 2 * d * fd + d * d * fdd
    return dict(region=3, T=T, p=rho * _R * T * d * fd / 1000, v=1 / rho, rho=rho,
                h=_R * T * (tau * ft + d * fd), s=_R * (tau * ft - f), u=_R * T * tau * ft,
                cv=-_R * tau * tau * ftt, cp=_R * (-tau * tau * ftt + X * X / Y),
                w=math.sqrt(max(0.0, _R * T * 1000 * (Y - X * X / (tau * tau * ftt)))),
                kt=1000 / (rho * _R * T * Y), alfav=(fd - tau * fdt) / (2 * fd + d * fdd) / T)


def _p3(rho, T):
    d, tau = rho / _RHOC, _TC / T
    fd, fdd = _R3_N1 / d, -_R3_N1 / (d * d)
    for I, J, n in zip(_R3_I, _R3_J, _R3_N):
        if not I:
            continue
        t = n * tau ** J
        fd += t * I * d ** (I - 1)
        fdd += t * I * (I - 1) * d ** (I - 2)
    return rho * _R * T * d * fd / 1000, _R * T * (2 * d * fd + d * d * fdd) / 1000


_last_rho = {'liquid': None, 'vapour': None}


def _root_rho(T, p, branch):
    f = lambda r: _p3(r, T)[0] - p
    last = _last_rho[branch]
    if last and abs(last[0] - T) < 30:
        r = last[1]
        for _ in range(25):
            pp, dp = _p3(r, T)
            if not dp > 0:
                break
            step = (pp - p) / dp
            rn = r - step
            if not (1e-6 < rn < 800):
                break
            r = rn
            if abs(step) < 1e-12 * r:
                ok = (T >= _TC or r > _RHOC * 0.98) if branch == 'liquid' else (T >= _TC or r < _RHOC * 1.02)
                if ok and _p3(r, T)[1] > 0:
                    _last_rho[branch] = (T, r)
                    return r
                break
    if branch == 'liquid':
        hi = 790.0
        if not f(hi) > 0:
            raise SteamRangeError('region 3: pressure %s at %s is above the formulation range' % (_fmtP(p), _fmtT(T)))
        k = 0
        while True:
            lo = hi * 0.93
            if lo < 100 or k > 60:
                raise SteamRangeError('region 3: no liquid root at %s, %s' % (_fmtT(T), _fmtP(p)))
            if f(lo) < 0:
                break
            hi = lo
            k += 1
    else:
        lo = 0.4 * p * 1000 / (_R * T)
        if not f(lo) < 0:
            lo *= 0.25
        k = 0
        while True:
            hi = lo * 1.12
            if hi > 800 or k > 80:
                raise SteamRangeError('region 3: no vapour root at %s, %s' % (_fmtT(T), _fmtP(p)))
            if f(hi) > 0:
                break
            lo = hi
            k += 1
    r = 0.5 * (lo + hi)
    for _ in range(100):
        pp, dp = _p3(r, T)
        fr = pp - p
        if fr < 0:
            lo = r
        else:
            hi = r
        rn = r - fr / dp if dp > 0 else float('nan')
        if not (lo < rn < hi):
            rn = 0.5 * (lo + hi)
        if abs(rn - r) < 1e-13 * r or hi - lo < 1e-13 * hi:
            r = rn
            break
        r = rn
    _last_rho[branch] = (T, r)
    return r


def _region_pt(p, T):
    if not T >= 273.15 - 1e-9:
        raise SteamRangeError('water/steam properties need T ≥ 0 °C (got %s)' % _fmtT(T))
    if not T <= 2273.15:
        raise SteamRangeError('water/steam properties need T ≤ 2000 °C (got %s)' % _fmtT(T))
    if not p > 0:
        raise SteamRangeError('pressure must be positive')
    if T > 1073.15:
        if p > 50:
            raise SteamRangeError('above 800 °C the formulation covers p ≤ 500 bar (got %s)' % _fmtP(p))
        return 5
    if p > 100:
        raise SteamRangeError('the formulation covers p ≤ 1000 bar (got %s)' % _fmtP(p))
    if T <= 623.15:
        return 1 if p >= _psat(max(T, 273.15)) else 2
    if T <= 863.15 and p > _p23(T):
        return 3
    return 2


def _phase_of(st):
    if st['T'] >= _TC and st['p'] >= _PC:
        return 'supercritical'
    if st['region'] == 1:
        return 'liquid'
    if st['region'] == 3:
        if st['T'] < _TC and st['p'] >= _psat(st['T']):
            return 'liquid'
        return 'liquid' if st['p'] >= _PC else 'vapour'
    return 'vapour'


def steam_pt(p, T):
    r = _region_pt(p, T)
    if r == 1:
        st = _region1(max(T, 273.15), p)
    elif r == 2:
        st = _region2(T, p)
    elif r == 5:
        st = _region5(T, p)
    else:
        liquid = T < _TC and p >= _psat(T)
        st = _region3(_root_rho(T, p, 'liquid' if liquid else 'vapour'), T)
        st['p'] = p
    st['phase'] = _phase_of(st)
    st['x'] = 0.0 if st['phase'] == 'liquid' else 1.0 if st['phase'] == 'vapour' else None
    return st


def steam_sat_T(T):
    if _TC - 1e-9 < T <= _TC:
        T = _TC - 1e-9
    p = _psat(T)
    if T <= 623.15:
        liq, vap = _region1(T, p), _region2(T, p)
    else:
        liq = _region3(_root_rho(T, p, 'liquid'), T)
        vap = _region3(_root_rho(T, p, 'vapour'), T)
        liq['p'] = vap['p'] = p
    liq['phase'], liq['x'], vap['phase'], vap['x'] = 'liquid', 0.0, 'vapour', 1.0
    return dict(T=T, p=p, liq=liq, vap=vap)


def steam_sat_p(p):
    s = steam_sat_T(_tsat(p))
    s['p'] = s['liq']['p'] = s['vap']['p'] = p
    return s


def _liquid_side(p, T):
    if T <= 623.15:
        return _region1(max(T, 273.15), p)
    if T < _TC:
        st = _region3(_root_rho(T, p, 'liquid'), T)
        st['p'] = p
        return st
    return steam_pt(p, T)


def _vapour_side(p, T):
    if T > 1073.15:
        return _region5(T, p)
    if T <= 623.15 or T > 863.15 or p <= _p23(T):
        return _region2(T, p)
    st = _region3(_root_rho(T, p, 'vapour'), T)
    st['p'] = p
    return st


def _mix(sat, x):
    L, V = sat['liq'], sat['vap']
    v = L['v'] + x * (V['v'] - L['v'])
    return dict(region=4, T=sat['T'], p=sat['p'], x=x,
                phase='liquid' if x <= 0 else 'vapour' if x >= 1 else 'two-phase',
                v=v, rho=1 / v, h=L['h'] + x * (V['h'] - L['h']), s=L['s'] + x * (V['s'] - L['s']),
                u=L['u'] + x * (V['u'] - L['u']), cp=None, cv=None, w=None, kt=None, alfav=None, liq=L, vap=V)


def steam_tx(T, x):
    if not 0 <= x <= 1:
        raise SteamRangeError('steam quality must be 0–1')
    return _mix(steam_sat_T(T), x)


def steam_px(p, x):
    if not 0 <= x <= 1:
        raise SteamRangeError('steam quality must be 0–1')
    return _mix(steam_sat_p(p), x)


def _solve_T(fn, a, b, target, what):
    fa, fb = fn(a) - target, fn(b) - target
    if fa == 0:
        return a
    if fb == 0:
        return b
    if (fa < 0) == (fb < 0):
        raise SteamRangeError(what)
    for k in range(200):
        m = a - fa * (b - a) / (fb - fa)
        if not (min(a, b) < m < max(a, b)) or k % 4 == 3:
            m = 0.5 * (a + b)
        fm = fn(m) - target
        if abs(fm) < 1e-12 * max(1.0, abs(target)) or abs(b - a) < 1e-11:
            return m
        if (fm < 0) == (fa < 0):
            a, fa = m, fm
        else:
            b, fb = m, fm
    return 0.5 * (a + b)


def _flash_by(p, target, key):
    if not p > 0:
        raise SteamRangeError('pressure must be positive')
    if p > 100:
        raise SteamRangeError('the formulation covers p ≤ 1000 bar (got %s)' % _fmtP(p))
    Tmax = 2273.15 if p <= 50 else 1073.15
    label = 'enthalpy' if key == 'h' else 'entropy'
    if _PMIN <= p < _PC:
        sat = steam_sat_p(p)
        yl, yv = sat['liq'][key], sat['vap'][key]
        if target < yl:
            T = _solve_T(lambda t: _liquid_side(p, t)[key], 273.15, sat['T'], target,
                         '%s below that of water at 0 °C and %s' % (label, _fmtP(p)))
            st = _liquid_side(p, T)
            st['p'], st['phase'], st['x'] = p, 'liquid', 0.0
            return st
        if target > yv:
            T = _solve_T(lambda t: _vapour_side(p, t)[key], sat['T'], Tmax, target,
                         "%s above the formulation's range at %s" % (label, _fmtP(p)))
            st = _vapour_side(p, T)
            st['p'] = p
            st['phase'], st['x'] = _phase_of(st), 1.0
            return st
        return _mix(sat, (target - yl) / (yv - yl))
    if p < _PMIN:
        raise SteamRangeError('pressure below the triple-point pressure (got %s)' % _fmtP(p))
    T = _solve_T(lambda t: steam_pt(p, t)[key], 273.15, Tmax, target,
                 "%s outside the formulation's range at %s" % (label, _fmtP(p)))
    return steam_pt(p, T)


def steam_ph(p, h): return _flash_by(p, h, 'h')
def steam_ps(p, s): return _flash_by(p, s, 's')


_MU_H0 = (1.67752, 2.20462, 0.6366564, -0.241605)
_MU_H = ((0.520094, 0.222531, -0.281378, 0.161913, -0.0325372, 0, 0),
         (0.0850895, 0.999115, -0.906851, 0.257399, 0, 0, 0),
         (-1.08374, 1.88797, -0.772479, 0, 0, 0, 0),
         (-0.289555, 1.26613, -0.489837, 0, 0.0698452, 0, -0.00435673),
         (0, 0, -0.25704, 0, 0, 0.00872102, 0),
         (0, 0.120573, 0, 0, 0, 0, -0.000593264))


def steam_viscosity(rho, T):
    """Pa·s, IAPWS R12-08 industrial form (μ2 = 1)."""
    Tr, dr = T / _TC, rho / _RHOC
    mu0 = 100 * math.sqrt(Tr) / sum(h / Tr ** i for i, h in enumerate(_MU_H0))
    s1 = 0.0
    for i in range(6):
        ti = (1 / Tr - 1) ** i
        for j in range(7):
            if _MU_H[i][j]:
                s1 += _MU_H[i][j] * ti * (dr - 1) ** j
    return mu0 * math.exp(dr * s1) * 1e-6


_K_L0 = (2.443221e-3, 1.323095e-2, 6.770357e-3, -3.454586e-3, 4.096266e-4)
_K_L = ((1.60397357, -0.646013523, 0.111443906, 0.102997357, -0.0504123634, 0.00609859258),
        (2.33771842, -2.78843778, 1.53616167, -0.463045512, 0.0832827019, -0.00719201245),
        (2.19650529, -4.54580785, 3.55777244, -1.40944978, 0.275418278, -0.0205938816),
        (-1.21051378, 1.60812989, -0.621178141, 0.0716373224, 0, 0),
        (-2.720337, 4.57586331, -3.18369245, 1.1168348, -0.19268305, 0.012913842))
_K_A = ((6.53786807199516, -5.61149954923348, 3.39624167361325, -2.27492629730878, 10.2631854662709, 1.97815050331519),
        (6.52717759281799, -6.30816983387575, 8.08379285492595, -9.82240510197603, 12.1358413791395, -5.54349664571295),
        (5.35500529896124, -3.96415689925446, 8.91990208918795, -12.033872950579, 9.19494865194302, -2.16866274479712),
        (1.55225959906681, 0.464621290821181, 8.93237374861479, -11.0321960061126, 6.1678099993336, -0.965458722086812),
        (1.11999926419994, 0.595748562571649, 9.8895256507892, -10.325505114704, 4.66861294457414, -0.503243546373828))


def steam_conductivity(rho, T, st=None):
    """W/(m·K), IAPWS R15-11 industrial form; critical enhancement when a state is given."""
    Tr, d = T / _TC, rho / _RHOC
    k0 = math.sqrt(Tr) / sum(n / Tr ** i for i, n in enumerate(_K_L0))
    s1 = 0.0
    for i in range(5):
        ti = (1 / Tr - 1) ** i
        for j in range(6):
            if _K_L[i][j]:
                s1 += _K_L[i][j] * ti * (d - 1) ** j
    k1 = math.exp(d * s1)
    k2 = 0.0
    if st and rho > 0 and st.get('cp') and st.get('cv') and st.get('kt'):
        ai = (_K_A[0] if d <= 0.310559006 else _K_A[1] if d <= 0.776397516 else
              _K_A[2] if d <= 1.242236025 else _K_A[3] if d <= 1.863354037 else _K_A[4])
        drho_ref = 1 / sum(a * d ** i for i, a in enumerate(ai)) * _RHOC / _PC
        drho = rho * st['kt']
        dX = max(0.0, d * (_PC / _RHOC * drho - _PC / _RHOC * drho_ref * 1.5 / Tr))
        xi = 0.13 * (dX / 0.06) ** (0.63 / 1.239)
        y = xi / 0.4
        if y >= 1.2e-7:
            kap = st['cp'] / st['cv']
            Z = 2 / math.pi / y * (((1 - 1 / kap) * math.atan(y) + y / kap)
                                   - (1 - math.exp(-1 / (1 / y + y * y / 3 / (d * d)))))
            k2 = 177.8514 * d * st['cp'] / 0.46151805 * Tr / (steam_viscosity(rho, T) * 1e6) * Z
    return (k0 * k1 + k2) * 1e-3


def steam_surface_tension(T):
    """N/m, IAPWS R1-76(2014)."""
    if not T < _TC:
        return 0.0
    tau = 1 - T / _TC
    return 0.2358 * tau ** 1.256 * (1 - 0.625 * tau)


class IAPWS97:
    """
    Water/steam state, IAPWS-IF97 — call signatures as the iapws library:
      IAPWS97(P=P_MPa, T=T_K)          single phase (region 1, 2, 3 or 5)
      IAPWS97(P=P_MPa, x=0..1)         saturation by pressure (x = vapour quality)
      IAPWS97(T=T_K,  x=0..1)          saturation by temperature
      IAPWS97(P=P_MPa, h=kJ/kg) / IAPWS97(P=P_MPa, s=kJ/kgK)   flashes
    Attributes: T [K], P [MPa], h, s, u [kJ/kg(K)], v [m³/kg], rho, x, cp, cv
    [kJ/kgK], w [m/s], mu [Pa·s], k [W/mK], sigma [N/m], Prandt, region, phase.
    Mixture (0 < x < 1) states carry no cp/cv/w/mu/k (use the saturated phases).
    """
    def __init__(self, P=None, T=None, x=None, h=None, s=None):
        if x is not None:
            x = float(x)
            sat = steam_sat_p(P) if P is not None else steam_sat_T(T)
            st = sat['liq'] if x <= 0 else sat['vap'] if x >= 1 else _mix(sat, x)
            if x <= 0 or x >= 1:
                st = dict(st)
                st['p'] = sat['p']
        elif P is not None and T is not None:
            st = steam_pt(P, T)
        elif P is not None and h is not None:
            st = steam_ph(P, h)
        elif P is not None and s is not None:
            st = steam_ps(P, s)
        else:
            raise SteamRangeError('IAPWS97 needs (P, T), (P, x), (T, x), (P, h) or (P, s)')
        self.T = st['T']; self.P = st['p']; self.h = st['h']; self.s = st['s']
        self.v = st['v']; self.rho = st['rho']; self.u = st['u']
        self.x = st.get('x'); self.region = st['region']
        self.phase = {'liquid': 'liquid', 'vapour': 'gas', 'supercritical': 'gas'}.get(st.get('phase'), 'twophase')
        self.cp = st.get('cp'); self.cv = st.get('cv'); self.w = st.get('w')
        if self.cp is not None and self.rho > 0:
            self.mu = steam_viscosity(self.rho, self.T)
            self.k = steam_conductivity(self.rho, self.T, st)
            self.Prandt = self.cp * 1000 * self.mu / self.k if self.k else None
        else:
            self.mu = self.k = self.Prandt = None
        self.sigma = steam_surface_tension(self.T)


# ════════════════════════════════════════════════════════════════════════════
# SHARED IAPWS HELPERS  (used by all sections)
# ════════════════════════════════════════════════════════════════════════════

def _sat_liq(P_bar=None, T_C=None):
    if P_bar is not None:
        return IAPWS97(P=P_bar / 10, x=0)
    return IAPWS97(T=T_C + 273.15, x=0)

def _sat_vap(P_bar=None, T_C=None):
    if P_bar is not None:
        return IAPWS97(P=P_bar / 10, x=1)
    return IAPWS97(T=T_C + 273.15, x=1)

def _sat_pair(P_bar=None, T_C=None):
    if P_bar is not None:
        return _sat_liq(P_bar=P_bar), _sat_vap(P_bar=P_bar)
    return _sat_liq(T_C=T_C), _sat_vap(T_C=T_C)

T_CRIT_C = 647.096 - 273.15   # critical temperature, deg C

def _superheated(P_bar, T_C):
    # above the critical pressure there is no saturation: the boiler outlet is a
    # supercritical fluid state (IF97 region 2 or 3)
    if P_bar >= 220.64:
        return IAPWS97(P=P_bar / 10, T=T_C + 273.15)
    liq = _sat_liq(P_bar=P_bar)
    if T_C + 273.15 <= liq.T:
        return _sat_vap(P_bar=P_bar)
    return IAPWS97(P=P_bar / 10, T=T_C + 273.15)

def _pump_work(v_m3kg, P_hi_bar, P_lo_bar, eta_p):
    return v_m3kg * (P_hi_bar - P_lo_bar) * 100.0 / eta_p

def _isentropic_exhaust(s1, P2_bar, T2_C=None):
    liq2, vap2 = _sat_pair(P_bar=P2_bar)
    P2_MPa = P2_bar / 10
    if T2_C is not None and T2_C > liq2.T - 273.15 + 0.5:
        st = IAPWS97(P=P2_MPa, T=T2_C + 273.15)
        return st.h, f'Superheated (T2={T2_C:.1f}C)'
    if s1 >= vap2.s:
        st_exit = IAPWS97(P=P2_MPa, s=s1)
        return st_exit.h, f'Superheated (T2s~{st_exit.T-273.15:.1f}C)'
    elif s1 >= liq2.s:
        x = (s1 - liq2.s) / max(vap2.s - liq2.s, 1e-9)
        x = max(0.0, min(1.0, x))
        return liq2.h + x*(vap2.h - liq2.h), f'Wet Steam (x={x*100:.1f}%)'
    else:
        return liq2.h, 'Subcooled'

def _safe(val, scale=1.0, digits=4):
    if val is None: return None
    v = val * scale
    return round(v, digits) if math.isfinite(v) else None

def _tsat_C(P_bar):
    return _sat_liq(P_bar=P_bar).T - 273.15


# ════════════════════════════════════════════════════════════════════════════
# MAIN VERCEL HANDLER
# ════════════════════════════════════════════════════════════════════════════

class handler(BaseHTTPRequestHandler):

    def log_message(self, format, *args): pass

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_POST(self):
        key = self.path.split('?')[0].rstrip('/').split('/')[-1]
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
        except Exception:
            return self._send(400, {'error': 'Invalid JSON body'})
        try:
            if   key == 'steam':               r = self._section_a(body)
            elif key == 'steam-quench':        r = self._section_b(body)
            elif key == 'steam-turbine-power': r = self._section_c(body)
            elif key == 'rankine':             r = self._section_d(body)
            else: r = {'error': f'Unknown route: {key}'}
        except Exception as e:
            return self._send(422, {'error': str(e)})
        self._send(400 if 'error' in r else 200, r)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code); self._cors()
        self.send_header('Content-Type', 'application/json')
        self.end_headers(); self.wfile.write(body)


    # ════════════════════════════════════════════════════════════════════════
    # SECTION A  ►  STEAM PROPERTIES  /api/steam
    # Phases: compressed | sat-liq | wet | sat-vap | superheat
    # ════════════════════════════════════════════════════════════════════════

    def _section_a(self, body):
        phase  = body.get('type')
        P_bar  = body.get('P_bar')
        T_C    = body.get('T_C')
        x_in   = body.get('x')
        specBy = body.get('specBy', 'P')
        sys_   = body.get('sys', 'SI')
        result = self._a_calc(phase, P_bar, T_C, x_in, specBy)
        if 'error' in result: return result
        if sys_ == 'IMP': result = self._a_imperial(result)
        # the page treats a missing field as "not applicable"; a JSON null would break
        # its number formatting — drop them
        result = {k: v for k, v in result.items() if v is not None}
        return {'success': True, 'data': result}

    def _a_calc(self, phase, P_bar, T_C, x_in, specBy):
        # A1: Compressed liquid
        if phase == 'compressed':
            if P_bar is None or T_C is None: return {'error': 'P_bar and T_C required.'}
            liq, vap = _sat_pair(P_bar=P_bar)
            Tsat_C = liq.T - 273.15
            if T_C >= Tsat_C: return {'error': f'T must be below T_sat={Tsat_C:.2f}C at {P_bar:.3f} bar.'}
            st = IAPWS97(P=P_bar/10, T=T_C+273.15)
            r  = self._a_state(st, liq, vap, None)
            r.update({'phase': 'Compressed Liquid', 'phaseCls': 'compressed'})
            return r
        # A2: Saturated liquid
        if phase == 'sat-liq':
            liq, vap = _sat_pair(P_bar=P_bar) if specBy=='P' else _sat_pair(T_C=T_C)
            r = self._a_state(liq, liq, vap, 0)
            r.update({'phase': 'Saturated Liquid', 'phaseCls': 'sat-liq'}); return r
        # A3: Wet steam
        if phase == 'wet':
            if x_in is None: return {'error': 'x required.'}
            x = float(x_in)
            if not (0.0 <= x <= 1.0): return {'error': 'x must be 0-1.'}
            if specBy == 'P':
                liq, vap = _sat_pair(P_bar=P_bar); st = IAPWS97(P=P_bar/10, x=x)
            else:
                liq, vap = _sat_pair(T_C=T_C); st = IAPWS97(T=T_C+273.15, x=x)
            r = self._a_state(st, liq, vap, x)
            r.update({'phase': f'Wet Steam (x = {x:.3f})', 'phaseCls': 'wet'})
            if x < 0.88: r['erosionRisk'] = True
            # Split transport for wet steam — matches JS addTransport wet branch
            r['mu_f']  = _safe(liq.mu, 1e6, 4); r['mu_g']  = _safe(vap.mu, 1e6, 4)
            r['lam_f'] = _safe(liq.k,  1e3, 4); r['lam_g'] = _safe(vap.k,  1e3, 4)
            r['Cp_f']  = _safe(liq.cp, 1.0, 4); r['Cp_g']  = _safe(vap.cp, 1.0, 4)
            return r
        # A4: Saturated vapor
        if phase == 'sat-vap':
            liq, vap = _sat_pair(P_bar=P_bar) if specBy=='P' else _sat_pair(T_C=T_C)
            r = self._a_state(vap, liq, vap, 1)
            r.update({'phase': 'Saturated Vapor (Dry)', 'phaseCls': 'sat-vap'}); return r
        # A5: Superheated
        if phase == 'superheat':
            if P_bar is None or T_C is None: return {'error': 'P_bar and T_C required.'}
            if P_bar >= _PC * 10:
                # above the critical pressure there is no saturation line
                st = IAPWS97(P=P_bar/10, T=T_C+273.15)
                r  = self._a_state(st, None, None, None)
                sc = T_C + 273.15 >= _TC
                r.update({'phase': 'Supercritical Fluid' if sc else 'Compressed Liquid (above P_c)',
                          'phaseCls': 'superheat' if sc else 'compressed',
                          '_note': 'Above the critical pressure (220.64 bar) water has no saturation line, '
                                   'so T_sat, h_f and h_g do not exist; properties from IAPWS-IF97 '
                                   + ('region 3' if st.region == 3 else 'region %d' % st.region) + '.'})
                return r
            liq, vap = _sat_pair(P_bar=P_bar)
            Tsat_C = liq.T - 273.15
            if T_C <= Tsat_C: return {'error': f'T must exceed T_sat={Tsat_C:.2f}C at {P_bar:.3f} bar.'}
            st = IAPWS97(P=P_bar/10, T=T_C+273.15)
            r  = self._a_state(st, liq, vap, None)
            r.update({'phase': 'Superheated Steam', 'phaseCls': 'superheat', 'dT_sh': round(T_C-Tsat_C, 4)})
            return r
        return {'error': f'Unknown phase: {phase}'}

    def _a_state(self, st, liq, vap, x_val):
        # surface tension of the saturated liquid at T, in mN/m (the page's SI unit)
        sigma = _safe(st.sigma, 1e3, 4) if st.T < _TC else None
        r = {
            'T': round(st.T-273.15, 4), 'P': round(st.P*10, 4),
            'h': round(st.h, 3),
            's': round(st.s, 5), 'v': round(st.v, 7), 'rho': round(1/st.v, 4),
            'u': round(st.u, 3), 'x': x_val,
            'mu': _safe(st.mu, 1e6, 4), 'lam': _safe(st.k, 1e3, 4),
            'Cp': _safe(st.cp, 1.0, 4), 'Cv': _safe(st.cv, 1.0, 4),
            'w':  _safe(st.w,  1.0, 3), 'Pr': _safe(st.Prandt, 1.0, 4),
            'sigma': sigma,
        }
        if liq is not None:
            r.update({
                'Tsat': round(liq.T-273.15, 4),
                'hf': round(liq.h, 3), 'hfg': round(vap.h-liq.h, 3), 'hg': round(vap.h, 3),
                'sf': round(liq.s, 5), 'sfg': round(vap.s-liq.s, 5), 'sg': round(vap.s, 5),
                'vf': round(liq.v, 7), 'vg': round(vap.v, 7),
            })
        return r

    def _a_imperial(self, r):
        tc=lambda v: round(v*9/5+32,3)   if v is not None else None
        pc=lambda v: round(v*14.5038,4)  if v is not None else None
        hc=lambda v: round(v*0.429922,4) if v is not None else None
        sc=lambda v: round(v*0.238846,5) if v is not None else None
        vc=lambda v: round(v*16.01846,6) if v is not None else None
        rc=lambda v: round(v*0.062428,4) if v is not None else None
        kc=lambda v: round(v*5.77789e-4,6) if v is not None else None
        cc=lambda v: round(v*0.238846,4)   if v is not None else None
        wc=lambda v: round(v*3.28084,3)    if v is not None else None
        c = dict(r)
        for k in ['T','Tsat']:             c[k]=tc(c.get(k))
        for k in ['P']:                    c[k]=pc(c.get(k))
        for k in ['h','hf','hfg','hg','u']:c[k]=hc(c.get(k))
        for k in ['s','sf','sfg','sg']:    c[k]=sc(c.get(k))
        for k in ['v','vf','vg']:          c[k]=vc(c.get(k))
        for k in ['rho']:                  c[k]=rc(c.get(k))
        for k in ['lam']:                  c[k]=kc(c.get(k))
        for k in ['Cp','Cv']:              c[k]=cc(c.get(k))
        for k in ['w']:                    c[k]=wc(c.get(k))
        if c.get('sigma') is not None: c['sigma']=round(c['sigma']*6.85218e-5, 8)   # mN/m → lbf/ft
        if c.get('dT_sh') is not None: c['dT_sh']=round(c['dT_sh']*9/5,4)
        return c

    # ── End Section A ─────────────────────────────────────────────────────


    # ════════════════════════════════════════════════════════════════════════
    # SECTION B  ►  STEAM QUENCH / DESUPERHEATER  /api/steam-quench
    # Returns ALL fields that the HTML reads from lastR.
    # HTML is 100% client-side — this replaces the JS steam engine entirely.
    # ════════════════════════════════════════════════════════════════════════

    def _section_b(self, body):
        # ── B1: Parse ─────────────────────────────────────────────────────
        try:
            P_s    = float(body['P_s'])           # bara steam pressure
            T1     = float(body['T1'])             # °C inlet steam
            Tw     = float(body['Tw'])             # °C quench water
            Pw     = float(body.get('Pw', P_s))   # bara water supply
            T2     = float(body['T2'])             # °C target outlet
            m_in   = float(body['m_in'])           # kg/h inlet flow
            sh_min = float(body.get('sh_min', 10))
            f_min  = float(body.get('f_min',  30))
            f_max  = float(body.get('f_max', 110))
            cv_in  = float(body.get('cv_in',   0))
        except (KeyError, TypeError) as e:
            return {'error': f'Missing input: {e}'}

        Ps_MPa = P_s / 10
        Pw_MPa = Pw  / 10
        warns  = []

        # ── B2: Tsat at steam pressure ────────────────────────────────────
        sat_line = IAPWS97(P=Ps_MPa, x=0)
        Ts = sat_line.T - 273.15

        # ── B3: Validation ────────────────────────────────────────────────
        if T1 <= Ts + 0.5:
            return {'error': f'Inlet steam ({T1:.1f}C) not superheated — must exceed Tsat ({Ts:.1f}C).'}
        if T2 >= T1:
            return {'error': 'Target outlet must be lower than inlet temperature.'}
        if T2 <= Ts + sh_min:
            return {'error': f'Outlet target too close to saturation. Min outlet = {Ts+sh_min:.1f}C.'}
        if Tw >= T2:
            return {'error': 'Water temperature must be below outlet target.'}
        if m_in <= 0:
            return {'error': 'Steam mass flow must be positive.'}

        if Tw >= Ts:
            warns.append(f'Warning: Water temp ({Tw:.1f}C) >= Tsat at steam pressure — flash risk.')
        if Pw > 0 and Pw <= P_s + 0.3:
            warns.append(f'Warning: Low water pressure margin (Pw-Ps = {Pw-P_s:.2f} bara). Need >= 3 bar.')

        # ── B4: IAPWS97 properties ────────────────────────────────────────
        st1 = IAPWS97(P=Ps_MPa, T=T1+273.15)
        st2 = IAPWS97(P=Ps_MPa, T=T2+273.15)
        stw = IAPWS97(P=Pw_MPa, T=Tw+273.15)
        h1,h2,hw = st1.h,st2.h,stw.h
        v1,v2    = st1.v,st2.v
        s1,s2    = st1.s,st2.s

        if not all(math.isfinite(v) for v in [h1,h2,hw]):
            return {'error': 'Steam property calculation failed.'}
        if h1 <= h2: return {'error': 'Inlet enthalpy <= outlet enthalpy.'}
        denom = h2 - hw
        if denom < 20: return {'error': f'Insufficient driving force (h2-hw = {denom:.1f} kJ/kg, min 20).'}

        # ── B5: Mass & energy balance ─────────────────────────────────────
        ratio  = (h1-h2)/denom
        m_w    = m_in*ratio; m_out = m_in+m_w
        qPct   = m_w/m_out*100
        Q_rem  = m_in/3600*(h1-h2); Q_abs = m_w/3600*denom
        sh_out = T2-Ts
        mw_min = m_w*f_min/100; mw_max = m_w*f_max/100
        mo_min = m_in+mw_min;   mo_max = m_in+mw_max

        # ── B6: Superheat status object (matches JS shSt.{c,lbl,bb}) ─────
        if sh_out >= 20:
            shSt = {'c':'ok', 'lbl':'ADEQUATE SUPERHEAT',    'bb':'bb-ok'}
        elif sh_out >= sh_min:
            shSt = {'c':'wa', 'lbl':'LOW SUPERHEAT MARGIN',  'bb':'bb-wa'}
        else:
            shSt = {'c':'bd', 'lbl':'INSUFFICIENT SUPERHEAT','bb':'bb-bd'}

        # ── B7: Near-saturation quality check ────────────────────────────
        outletQuality = None
        if 0 <= sh_out < 3:
            liq_ps = IAPWS97(P=Ps_MPa, x=0); vap_ps = IAPWS97(P=Ps_MPa, x=1)
            hfg_ps = vap_ps.h - liq_ps.h
            if hfg_ps > 1:
                x_est = (h2-liq_ps.h)/hfg_ps
                outletQuality = max(0.0, min(1.0, x_est))
                warns.append(f'Outlet very close to saturation (SH={sh_out:.1f}C). x~{outletQuality:.3f}.')

        # ── B8: Uncertainty estimates ─────────────────────────────────────
        def _unc(P_bar_v, T_C_v, is_sh):
            # IAPWS-IF97 equations: consistent to about 0.2 kJ/kg across region boundaries;
            # close to the critical point properties are so steep that input errors dominate
            if T_C_v > 350 and P_bar_v > 165:
                d = math.sqrt(((T_C_v-373.946)/24)**2+((P_bar_v-220.64)/56)**2)
                return '+-2 kJ/kg near-critical' if d < 0.5 else '+-0.5 kJ/kg (region 3)'
            return '+-0.2 kJ/kg'
        unc_h1 = _unc(P_s, T1, True)
        unc_h2 = _unc(P_s, T2, True)
        unc_hw = _unc(Pw,  Tw, False)

        # ── B9: Sensitivity tables ────────────────────────────────────────
        sensT, sensW = [], []
        for d in range(-10, 11, 2):
            T2s = T2+d
            if T2s > T1 or T2s <= Ts+sh_min: continue
            h2s = IAPWS97(P=Ps_MPa, T=T2s+273.15).h
            if not math.isfinite(h2s) or h2s <= hw+5: continue
            mws = m_in*(h1-h2s)/(h2s-hw)
            sensT.append({'d':d,'T2s':round(T2s,2),'mws':round(mws,1),
                          'pct':round(mws/(m_in+mws)*100,2),'base':d==0})
        for d in range(-20, 21, 5):
            Tws = Tw+d
            if Tws <= 0 or Tws >= T2: continue
            hws = IAPWS97(P=Pw_MPa, T=Tws+273.15).h
            if not math.isfinite(hws) or h2 <= hws+5: continue
            mws = m_in*(h1-h2)/(h2-hws)
            sensW.append({'d':d,'Tws':round(Tws,2),'mws':round(mws,1),
                          'pct':round(mws/(m_in+mws)*100,2),'base':d==0})

        # ── B10: Saturation boundary (for stream table row) ───────────────
        liq_ps = IAPWS97(P=Ps_MPa, x=0); vap_ps = IAPWS97(P=Ps_MPa, x=1)
        hf_Ps  = round(liq_ps.h, 2);     hg_Ps  = round(vap_ps.h, 2)

        # ── B11: Valve Cv (ISA S75.01) ────────────────────────────────────
        cv_res = None
        if cv_in > 0 and Pw > 0:
            dP_bar = Pw-P_s; dP_psi = dP_bar*14.5038
            rho_w  = 1.0/stw.v; SG = rho_w/998.2
            sat_w  = IAPWS97(T=Tw+273.15, x=0); Pv_bar = sat_w.P*10
            m_w_gpm = m_w/0.453592/60/8.3454
            FL = 0.90; dP_allow = FL*FL*(Pw-Pv_bar)
            Cv_req = m_w_gpm/math.sqrt(dP_psi/SG) if dP_bar>0.1 and dP_psi>0 and SG>0 else None
            Kv_req = Cv_req/1.1561 if Cv_req and math.isfinite(Cv_req) else None
            rat    = cv_in/Cv_req  if Cv_req and math.isfinite(Cv_req) and Cv_req>0 else None
            sigma  = (Pw-Pv_bar)/dP_bar if dP_bar>0.01 else None
            cv_res = {
                'Cv_req':  round(Cv_req,3) if Cv_req and math.isfinite(Cv_req) else None,
                'Kv_req':  round(Kv_req,3) if Kv_req and math.isfinite(Kv_req) else None,
                'Cv_inst': cv_in,
                'Kv_inst': round(cv_in/1.1561,3),
                'rat':     round(rat,3)   if rat   and math.isfinite(rat)   else None,
                'dP_psi':  round(dP_psi,2), 'dP_bar': round(dP_bar,2),
                'm_w_gpm': round(m_w_gpm,2), 'SG': round(SG,3), 'rho_w': round(rho_w,1),
                'Pv_bar':  round(Pv_bar,3),
                'sigma':   round(sigma,2) if sigma and math.isfinite(sigma) else None,
                'cavitating': sigma is not None and sigma < 2.0 and dP_bar > 0.1,
                'flashing':   Pv_bar >= Pw,
                'choked':     dP_bar > dP_allow,
                'dP_allow':   round(dP_allow,2), 'FL': FL,
            }

        # ── B12: Return — every field HTML reads from lastR ───────────────
        return {
            # Inputs echoed (HTML uses these in render/sensitivity/PDF)
            'P_s': P_s,
            'Ps':  Ps_MPa,    # HTML calls h_steam(T, r.Ps) in sensitivity — MPa
            'T1': T1, 'T2': T2, 'Tw': Tw,
            'Pw': Pw_MPa,     # HTML calls h_water(Tws, r.Pw) — MPa
            'm_in': m_in, 'fMin': f_min, 'fMax': f_max, 'shMin_C': sh_min,
            # Saturation
            'Ts': round(Ts, 3),
            # Properties
            'h1': round(h1,2), 'h2': round(h2,2), 'hw': round(hw,2),
            'v1': round(v1,5), 'v2': round(v2,5),
            's1': round(s1,4), 's2': round(s2,4),
            # Sat boundary for stream table
            'hf_Ps': hf_Ps, 'hg_Ps': hg_Ps,
            # Mass balance
            'ratio': round(ratio,6), 'm_w': round(m_w,1), 'm_out': round(m_out,1),
            'qPct': round(qPct,3), 'Q_rem': round(Q_rem,2), 'Q_abs': round(Q_abs,2),
            # Superheat
            'sh_out': round(sh_out,3), 'shSt': shSt, 'shStatus': shSt['lbl'],
            # Control range
            'mw_min': round(mw_min,1), 'mw_max': round(mw_max,1),
            'mo_min': round(mo_min,1), 'mo_max': round(mo_max,1),
            # Quality & uncertainty
            'outletQuality': round(outletQuality,4) if outletQuality is not None else None,
            'unc_h1': unc_h1, 'unc_h2': unc_h2, 'unc_hw': unc_hw,
            # Tables & valve
            'sensT': sensT, 'sensW': sensW, 'cv_res': cv_res, 'warns': warns,
            # Timestamp for PDF header
            'ts': datetime.now().strftime('%d %b %Y, %H:%M:%S'),
        }

    # ── End Section B ─────────────────────────────────────────────────────


    # ════════════════════════════════════════════════════════════════════════
    # SECTION C  ►  STEAM TURBINE POWER  /api/steam-turbine-power
    # Actions: inletProps | exhaustProps | calculate
    # Types  : backpressure | condensing | extraction | mixed
    # ════════════════════════════════════════════════════════════════════════

    def _section_c(self, body):
        action = body.get('action', 'calculate')
        try:
            if   action == 'inletProps':   return self._c_inlet(body)
            elif action == 'exhaustProps': return self._c_exhaust(body)
            elif action == 'calculate':    return self._c_calc(body)
            return {'error': f'Unknown action: {action}'}
        except Exception as e:
            return {'error': f'section_c error ({action}): {str(e)}'}

    def _c_inlet(self, body):
        try:
            P_bar = float(body.get('P_bar') or 0)
            T_C   = float(body['T_C']) if body.get('T_C') is not None else None
            if not P_bar or P_bar <= 0:
                return {'error': 'P_bar required and must be > 0'}
            P_in  = P_bar
            P_bar = max(0.00611, min(220.64, P_bar))
            liq, vap = _sat_pair(P_bar=P_bar); Tsat_C = liq.T-273.15
            if P_in >= 220.64 and T_C is not None:
                # supercritical inlet: no saturation, the (p, T) state is used as given
                st = IAPWS97(P=P_in/10, T=T_C+273.15)
                return {'h':round(st.h,3),'s':round(st.s,5),'v':round(st.v,7),'T_sat':round(T_CRIT_C,3),'phase':'supercritical'}
            if T_C is None or T_C <= Tsat_C+0.5:
                return {'h':round(vap.h,3),'s':round(vap.s,5),'v':round(vap.v,7),'T_sat':round(Tsat_C,3),'phase':'sat'}
            st = IAPWS97(P=P_in/10, T=T_C+273.15)
            return {'h':round(st.h,3),'s':round(st.s,5),'v':round(st.v,7),'T_sat':round(Tsat_C,3),'phase':'superheated'}
        except Exception as e:
            return {'error': f'inletProps error: {e}'}

    def _c_exhaust(self, body):
        try:
            P_bar = float(body.get('P_bar') or 0)
            s1    = float(body.get('s1_SI') or 0)
            T2_C  = float(body['T2_C']) if body.get('T2_C') is not None else None
            if not P_bar or P_bar <= 0:
                return {'error': 'P_bar required and must be > 0'}
            P_bar = max(0.00611, min(220.64, P_bar))
            liq2, vap2 = _sat_pair(P_bar=P_bar)
            h2s, phase = _isentropic_exhaust(s1 or vap2.s, P_bar, T2_C)
            return {'h2s':round(h2s,3),'hf':round(liq2.h,3),'hg':round(vap2.h,3),
                    'hfg':round(vap2.h-liq2.h,3),'T_sat':round(liq2.T-273.15,3),
                    'sf':round(liq2.s,5),'sg':round(vap2.s,5),'phase':phase}
        except Exception as e:
            return {'error': f'exhaustProps error: {e}'}

    def _c_calc(self, body):
        try:
            flow_kgh=float(body['flow_kgh']); h1=float(body['h1_SI'])
            h2s=float(body['h2s_SI']); s1=float(body.get('s1_SI',0))
            p1_bar=float(body['p1_bar']); p2_bar=float(body['p2_bar'])
            eff=min(1.0,max(0.01,float(body['eff'])))
            effm=min(1.0,max(0.01,float(body['effm'])))
            effg=min(1.0,max(0.01,float(body['effg'])))
            turb=body.get('turbineType','backpressure')
        except (KeyError,TypeError) as e: return {'error':f'Missing: {e}'}
        if flow_kgh<=0: return {'error':'Invalid mass flow'}
        if h1<=0: return {'error':'Invalid h1'}
        if h2s<=0: return {'error':'Invalid h2s'}
        if p1_bar<=0: return {'error':'Invalid P1'}
        if p2_bar<=0: return {'error':'Invalid P2'}
        if p2_bar>=p1_bar: return {'error':'P2 must be < P1'}
        if h1<=h2s: return {'error':'h1 must be > h2s'}

        mDot=flow_kgh/3600; w=(h1-h2s)*eff; h2=h1-w
        liq2,vap2=_sat_pair(P_bar=p2_bar)
        quality=None
        if h2 < vap2.h:
            q=(h2-liq2.h)/max(vap2.h-liq2.h,1e-9); quality=max(0.0,min(1.0,q))
        out={'w_SI':round(w,3),'h2_SI':round(h2,3),
             'quality':round(quality,4) if quality is not None else None,
             'sat2_T':round(liq2.T-273.15,3)}

        # C3a: Back pressure
        if turb == 'backpressure':
            pw=mDot*w*effm; pe=pw*effg; Q_in=mDot*h1
            out.update({'pw':round(pw,3),'pe':round(pe,3),'Q_in':round(Q_in,3),
                        'Q_out':round(mDot*h2,3),
                        'eta':round(pw/Q_in*100 if Q_in>0 else 0,4)})

        # C3b: Condensing
        elif turb == 'condensing':
            cwIn_C=float(body['cwIn_C']); cwOut_C=float(body['cwOut_C'])
            hf=float(body['hf_SI']); condP_bar=float(body.get('condP_bar',p2_bar))
            pw=mDot*w*effm; pe=pw*effg
            Q_cond=mDot*max(0,h2-hf); dT_cw=cwOut_C-cwIn_C
            mDot_cw=Q_cond/(4.187*dT_cw) if dT_cw>0 else 0
            Q_in=mDot*h1
            heatRate=pw/(mDot*h1)*3600 if pw>0 else 0
            liq_c,_=_sat_pair(P_bar=condP_bar)
            out.update({'pw':round(pw,3),'pe':round(pe,3),'Q_cond':round(Q_cond,3),
                        'mDot_cw':round(mDot_cw,4),'dT_cw':round(dT_cw,2),
                        'heatRate':round(heatRate,2),'Q_in':round(Q_in,3),
                        'eta':round(pw/Q_in*100 if Q_in>0 else 0,4),
                        'condP_bar':condP_bar,'satCond_T':round(liq_c.T-273.15,3)})

        # C3c: Extraction — uses JS field names (extFrac, he_SI)
        elif turb == 'extraction':
            extFrac=float(body['extFrac']); he_SI=float(body['he_SI'])
            mExt=mDot*extFrac; mExh=mDot*(1-extFrac)
            if mExh<0: return {'error':'Extraction flow exceeds inlet.'}
            w_HP=(h1-he_SI)*eff; w_LP=(he_SI-h2s)*eff
            pw=(mDot*w_HP+mExh*w_LP)*effm; pe=pw*effg
            h2_exh=he_SI-w_LP; Q_proc=mExt*(he_SI-419); Q_in=mDot*h1
            out.update({'pw':round(pw,3),'pe':round(pe,3),'Q_proc':round(Q_proc,3),
                        'eta':round(pw/Q_in*100 if Q_in>0 else 0,4),
                        'w_HP':round(w_HP,3),'w_LP':round(w_LP,3),
                        'he_SI':round(he_SI,3),'h2_exh':round(h2_exh,3),
                        'extFrac':extFrac,'mExt':round(mExt,4),'mExh':round(mExh,4)})

        # C3d: Mixed — uses JS field names (extFrac2, he2_SI)
        elif turb == 'mixed':
            extFrac2=float(body['extFrac2']); he2_SI=float(body['he2_SI'])
            cwIn2_C=float(body['cwIn2_C']); cwOut2_C=float(body['cwOut2_C'])
            hf2_SI=float(body['hf2_SI'])
            mExt2=mDot*extFrac2; mExh2=mDot*(1-extFrac2)
            if mExh2<0: return {'error':'Extraction flow exceeds inlet.'}
            w_HP2=(h1-he2_SI)*eff; w_LP2=(he2_SI-h2s)*eff
            pw=(mDot*w_HP2+mExh2*w_LP2)*effm; pe=pw*effg
            h2_exh2=he2_SI-w_LP2
            Q_cond2=max(0,mExh2*(h2_exh2-hf2_SI))
            dT2=cwOut2_C-cwIn2_C; mDot_cw2=Q_cond2/(4.187*dT2) if dT2>0 else 0
            Q_proc2=mExt2*(he2_SI-419); Q_in=mDot*h1
            out.update({'pw':round(pw,3),'pe':round(pe,3),'Q_cond':round(Q_cond2,3),
                        'mDot_cw':round(mDot_cw2,4),'dT_cw':round(dT2,2),
                        'Q_proc':round(Q_proc2,3),'eta':round(pw/Q_in*100 if Q_in>0 else 0,4),
                        'w_HP':round(w_HP2,3),'w_LP':round(w_LP2,3),
                        'he_SI':round(he2_SI,3),'h2_exh':round(h2_exh2,3),
                        'extFrac':extFrac2,'mExt':round(mExt2,4),'mExh':round(mExh2,4)})
        else:
            return {'error':f'Unknown turbineType: {turb}'}
        return out

    # ── End Section C ─────────────────────────────────────────────────────


    # ════════════════════════════════════════════════════════════════════════
    # SECTION D  ►  RANKINE CYCLE  /api/rankine
    # HTML sends: { type, params }   type = cycle name or 'tsat'
    # All pressures in params are in MPa
    # ════════════════════════════════════════════════════════════════════════

    def _section_d(self, body):
        cycle  = body.get('type', '')
        params = body.get('params', body)

        # tsat autofill — called by every cycle tab for Tsat display
        if cycle == 'tsat':
            P_MPa = float(params.get('P_MPa', 0))
            if P_MPa <= 0: return {'tsat': None}
            if P_MPa >= 22.064: return {'tsat': None, 'supercritical': True, 'Tcrit': round(T_CRIT_C, 3)}
            try:
                return {'tsat': round(_sat_liq(P_bar=P_MPa*10).T-273.15, 3)}
            except Exception: return {'tsat': None}

        if   cycle == 'basic':     return self._d_basic(params)
        elif cycle == 'superheat': return self._d_superheat(params)
        elif cycle == 'reheat':    return self._d_reheat(params)
        elif cycle == 'regen':     return self._d_regen(params)
        elif cycle == 'carnot':    return self._d_carnot(params)
        return {'error': f'Unknown cycle: {cycle}'}

    # shared helpers
    def _d_isentropic_h(self, s1, liq, vap):
        if s1 >= vap.s: return IAPWS97(P=liq.P, s=s1).h, 1.0
        x=(s1-liq.s)/max(vap.s-liq.s,1e-9); x=max(0.0,min(1.0,x))
        return liq.h+x*(vap.h-liq.h), x

    def _d_tsat(self, P_MPa):
        # no saturation above the critical pressure → None (callers use T_CRIT_C)
        if P_MPa >= 22.064: return None
        return IAPWS97(P=P_MPa, x=0).T-273.15

    def _d_hot_check(self, T_C, P_MPa, Tsat, label):
        # boiler outlet must be vapour (subcritical) or above the critical temperature
        if Tsat is None:
            if T_C <= T_CRIT_C:
                return {'error': f'{label} must exceed the critical temperature {T_CRIT_C:.2f}C at supercritical pressure ({P_MPa:g} MPa).'}
            return None
        if T_C <= Tsat: return {'error': f'{label} must exceed Tsat={Tsat:.1f}C.'}
        return None

    def _d_s1(self, liq, vap):
        return {'hf':round(liq.h,2),'sf':round(liq.s,5),
                'sfg':round(vap.s-liq.s,5),'hfg':round(vap.h-liq.h,2),'vf':round(liq.v,7)}

    # D1: Basic Rankine
    def _d_basic(self, p):
        T3=float(p['T3']); Ph=float(p['Ph']); T1=float(p['T1']); Pc=float(p['Pc'])
        etaT=float(p['etaT']); etaP=float(p['etaP']); etaG=float(p['etaG'])
        etaB=float(p['etaB']); mdot=float(p['mdot']); hhv=float(p['hhv'])
        TsatB=self._d_tsat(Ph)
        e=self._d_hot_check(T3,Ph,TsatB,'Boiler T')
        if e: return e
        if Pc>=Ph: return {'error':'Condenser P must be < boiler P.'}
        st3=_superheated(Ph*10,T3); h3,s3=st3.h,st3.s
        liq1=IAPWS97(P=Pc,x=0); vap1=IAPWS97(P=Pc,x=1)
        h4s,_=self._d_isentropic_h(s3,liq1,vap1); h4=h3-etaT*(h3-h4s)
        wp=_pump_work(liq1.v,Ph*10,Pc*10,etaP); h2=liq1.h+wp
        qB=h3-h2; wT=h3-h4; wNet=wT-wp
        if qB<=0: return {'error':'qB<=0'}
        if wNet<=0: return {'error':'Net work<=0'}
        etaTh=wNet/qB; etaC=1-(T1+273.15)/(T3+273.15)
        WkW=wNet*mdot; QkW=qB*mdot; QrejkW=QkW-WkW
        heatRate=3600/max(etaTh,1e-9); fuelRate=QkW/(etaB*hhv*1000)
        x4raw=(h4-liq1.h)/max(vap1.h-liq1.h,1e-9)
        if x4raw<0: return {'error':'Turbine exit sub-cooled.'}
        x4=max(0.0,min(1.0,x4raw))
        return {'ok':True,'type':'basic',
                'etaTh':round(etaTh,6),'etaCarnot':round(etaC,6),
                'eta2nd':round(etaTh/max(etaC,1e-9),6),'etaOverall':round(etaTh*etaG*etaB,6),
                'WkW':round(WkW,2),'QkW':round(QkW,2),'QrejkW':round(QrejkW,2),
                'heatRate':round(heatRate,1),'fuelRate':round(fuelRate,5),
                'bwr':round(wp/max(wT,1e-9),5),
                'wT':round(wT,3),'wp':round(wp,3),'wNet':round(wNet,3),'qB':round(qB,3),
                'h1':round(liq1.h,2),'h2':round(h2,2),'h3':round(h3,2),'h4':round(h4,2),
                's1':self._d_s1(liq1,vap1),'s3':{'h':round(h3,2),'s':round(s3,5)},
                'x4':round(x4,4),'moisture':round((1-x4)*100,2),
                'TsatBoiler':round(TsatB if TsatB is not None else T_CRIT_C,2),
                'supercritical':TsatB is None,'T1':T1,'T3':T3,'Ph':Ph,'Pc':Pc,
                'mdot':mdot,'etaG':etaG,'etaB':etaB}

    # D2: Superheat Rankine
    def _d_superheat(self, p):
        Tsh=float(p['Tsh']); Ph=float(p['Ph']); Tc=float(p['Tc']); Pc=float(p['Pc'])
        etaT=float(p['etaT']); etaP=float(p['etaP']); mdot=float(p['mdot'])
        TsatB=self._d_tsat(Ph)
        e=self._d_hot_check(Tsh,Ph,TsatB,'T_sh')
        if e: return e
        Tref=TsatB if TsatB is not None else T_CRIT_C
        if Pc>=Ph: return {'error':'Condenser P must be < boiler P.'}
        st3=_superheated(Ph*10,Tsh); h3,s3=st3.h,st3.s
        liq1=IAPWS97(P=Pc,x=0); vap1=IAPWS97(P=Pc,x=1)
        h4s,_=self._d_isentropic_h(s3,liq1,vap1); h4=h3-etaT*(h3-h4s)
        wp=_pump_work(liq1.v,Ph*10,Pc*10,etaP); h2=liq1.h+wp
        qB=h3-h2; wT=h3-h4; wNet=wT-wp
        if qB<=0: return {'error':'qB<=0'}
        if wNet<=0: return {'error':'Net work<=0'}
        etaTh=wNet/qB; etaC=1-(Tc+273.15)/(Tsh+273.15)
        WkW=wNet*mdot; QkW=qB*mdot
        x4raw=(h4-liq1.h)/max(vap1.h-liq1.h,1e-9)
        if x4raw<0: return {'error':'Turbine exit sub-cooled.'}
        x4=max(0.0,min(1.0,x4raw))
        return {'ok':True,'type':'superheat',
                'etaTh':round(etaTh,6),'etaC':round(etaC,6),
                'eta2nd':round(etaTh/max(etaC,1e-9),6),
                'WkW':round(WkW,2),'QkW':round(QkW,2),
                'heatRate':round(3600/max(etaTh,1e-9),1),'bwr':round(wp/max(wT,1e-9),5),
                'wT':round(wT,3),'wp':round(wp,3),'wNet':round(wNet,3),'qB':round(qB,3),
                'h1':round(liq1.h,2),'h2':round(h2,2),'h3':round(h3,2),'h4':round(h4,2),
                's1':self._d_s1(liq1,vap1),
                'x4':round(x4,4),'moisture':round((1-x4)*100,2),
                'dsh':round(Tsh-Tref,2),'TsatB':round(Tref,2),'supercritical':TsatB is None,
                'Tsh':Tsh,'Ph':Ph,'Tc':Tc,'Pc':Pc}

    # D3: Reheat Rankine
    def _d_reheat(self, p):
        T1=float(p['T1']); P1=float(p['P1'])
        Trh=float(p['Trh']); P2=float(p['P2']); Pc=float(p['Pc'])
        etaHPT=float(p['etaHPT']); etaLPT=float(p['etaLPT'])
        etaP=float(p['etaP']); mdot=float(p['mdot'])
        Tc=float(p['Tc']) if p.get('Tc') is not None else self._d_tsat(Pc)
        e=self._d_hot_check(T1,P1,self._d_tsat(P1),'HPT inlet T')
        if e: return e
        if not (Pc<P2<P1): return {'error':'Pressures must satisfy condenser < reheat < HPT inlet.'}
        st3=_superheated(P1*10,T1); h3,s3=st3.h,st3.s
        liq2=IAPWS97(P=P2,x=0); vap2=IAPWS97(P=P2,x=1)
        h4s,_=self._d_isentropic_h(s3,liq2,vap2); h4=h3-etaHPT*(h3-h4s)
        st5=_superheated(P2*10,Trh); h5,s5=st5.h,st5.s
        liq_c=IAPWS97(P=Pc,x=0); vap_c=IAPWS97(P=Pc,x=1)
        h6s,_=self._d_isentropic_h(s5,liq_c,vap_c); h6=h5-etaLPT*(h5-h6s)
        wp=_pump_work(liq_c.v,P1*10,Pc*10,etaP); h2=liq_c.h+wp
        wHPT=h3-h4; wLPT=h5-h6; wNet=wHPT+wLPT-wp
        qBoil=h3-h2; qReh=h5-h4; qTotal=qBoil+qReh
        if qTotal<=0: return {'error':'Heat input<=0'}
        if wNet<=0: return {'error':'Net work<=0'}
        etaTh=wNet/qTotal; etaC=1-(Tc+273.15)/(T1+273.15)
        WkW=wNet*mdot; QkW=qTotal*mdot
        x6raw=(h6-liq_c.h)/max(vap_c.h-liq_c.h,1e-9); x6=max(0.0,min(1.0,x6raw))
        optP2=math.sqrt(P1*Pc)
        return {'ok':True,'type':'reheat',
                'etaTh':round(etaTh,6),'etaC':round(etaC,6),
                'eta2nd':round(etaTh/max(etaC,1e-9),6),
                'WkW':round(WkW,2),'QkW':round(QkW,2),
                'heatRate':round(3600/max(etaTh,1e-9),1),'bwr':round(wp/max(wHPT+wLPT,1e-9),5),
                'wHPT':round(wHPT,3),'wLPT':round(wLPT,3),
                'wp':round(wp,3),'wNet':round(wNet,3),
                'qBoiler':round(qBoil,3),'qReheat':round(qReh,3),'qTotal':round(qTotal,3),
                'h1':round(liq_c.h,2),'h2':round(h2,2),'h3':round(h3,2),
                'h4':round(h4,2),'h5':round(h5,2),'h6':round(h6,2),
                's1':self._d_s1(liq_c,vap_c),
                'x6':round(x6,4),'moisture':round((1-x6)*100,2),
                'Tsat1':round(self._d_tsat(P1) if P1<22.064 else T_CRIT_C,2),
                'supercritical':P1>=22.064,'optP2':round(optP2,4),
                'Tc':Tc,'T1':T1,'P1':P1,'Trh':Trh,'P2':P2,'Pc':Pc}

    # D4: Regenerative Rankine
    def _d_regen(self, p):
        Thi=float(p['Thi']); Phi=float(p['Phi'])
        Pbleed=float(p['Pbleed']); Pc=float(p['Pc'])
        etaT=float(p['etaT']); etaP=float(p['etaP']); mdot=float(p['mdot'])
        Tc=float(p['Tc']) if p.get('Tc') is not None else self._d_tsat(Pc)
        e=self._d_hot_check(Thi,Phi,self._d_tsat(Phi),'Turbine inlet T')
        if e: return e
        if not (Pc<Pbleed<Phi): return {'error':'Pressures must satisfy condenser < bleed < turbine inlet.'}
        stIn=_superheated(Phi*10,Thi); h_in,s_in=stIn.h,stIn.s
        liq_bl=IAPWS97(P=Pbleed,x=0); vap_bl=IAPWS97(P=Pbleed,x=1)
        h_bl_s,_=self._d_isentropic_h(s_in,liq_bl,vap_bl); h_bl=h_in-etaT*(h_in-h_bl_s)
        liq_c=IAPWS97(P=Pc,x=0); vap_c=IAPWS97(P=Pc,x=1)
        h4s,_=self._d_isentropic_h(s_in,liq_c,vap_c); h4=h_in-etaT*(h_in-h4s)
        h5=liq_c.h; h6=liq_bl.h
        y=min(max((h6-h5)/max(h_bl-h5,1e-9),0.0),0.5)
        wp1=_pump_work(liq_c.v, Pbleed*10,Pc*10,    etaP)
        wp2=_pump_work(liq_bl.v,Phi*10,   Pbleed*10, etaP)
        h7=h6+wp2; h2=h7  # h2 = boiler feed = h7
        wT=(h_in-h_bl)+(1-y)*(h_bl-h4); wp_total=(1-y)*wp1+wp2
        wNet=wT-wp_total; qB=h_in-h7
        if qB<=0: return {'error':'Heat input<=0'}
        if wNet<=0: return {'error':'Net work<=0'}
        etaTh=wNet/qB; etaC=1-(Tc+273.15)/(Thi+273.15)
        WkW=wNet*mdot; QkW=qB*mdot
        x4raw=(h4-liq_c.h)/max(vap_c.h-liq_c.h,1e-9); x4=max(0.0,min(1.0,x4raw))
        return {'ok':True,'type':'regen',
                'etaTh':round(etaTh,6),'etaC':round(etaC,6),
                'eta2nd':round(etaTh/max(etaC,1e-9),6),
                'WkW':round(WkW,2),'QkW':round(QkW,2),
                'heatRate':round(3600/max(etaTh,1e-9),1),
                'wT':round(wT,3),'wp_total':round(wp_total,3),
                'wNet':round(wNet,3),'qB':round(qB,3),'y':round(y,4),
                'h1':round(h_in,2),'h2':round(h2,2),'h4':round(h4,2),
                'h5':round(h5,2),'h6':round(h6,2),'h7':round(h7,2),
                'h_bl':round(h_bl,2),'s1':self._d_s1(liq_c,vap_c),
                'x4':round(x4,4),'moisture':round((1-x4)*100,2),
                'TsatIn':round(self._d_tsat(Phi) if Phi<22.064 else T_CRIT_C,2),
                'supercritical':Phi>=22.064,'TsatBleed':round(self._d_tsat(Pbleed),2),
                'Thi':Thi,'Phi':Phi,'Pbleed':Pbleed,'Tc':Tc,'Pc':Pc}

    # D5: Carnot
    def _d_carnot(self, p):
        TH=float(p['TH']); TC=float(p['TC']); QH=float(p['QH'])
        actual=float(p['actual']) if p.get('actual') is not None else None
        if TH<=TC: return {'error':'T_H must be > T_C.'}
        TH_K=TH+273.15; TC_K=TC+273.15; etaC=1-TC_K/TH_K
        if actual is not None and actual/100>=etaC: return {'error':'Actual eta > Carnot limit.'}
        Wmax=etaC*QH; Qrej=QH-Wmax
        eta2nd=(actual/100)/etaC if actual is not None else None
        wrongEta=(1-TC/TH)*100 if TH!=0 else None  # HTML shows this as the "wrong" Celsius calc
        return {'ok':True,'type':'carnot',
                'etaC':round(etaC,6),'Wmax':round(Wmax,2),'Qrej':round(Qrej,2),
                'COPhp':round(TH_K/(TH_K-TC_K),4),'COPref':round(TC_K/(TH_K-TC_K),4),
                'eta2nd':round(eta2nd,4) if eta2nd is not None else None,
                'wrongEta':round(wrongEta,4) if wrongEta is not None else None,
                'TH_K':TH_K,'TC_K':TC_K,'TH':TH,'TC':TC,'QH':QH}

    # ── End Section D ─────────────────────────────────────────────────────
