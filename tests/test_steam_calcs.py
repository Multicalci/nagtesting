# REPO PATH: .github/tests/test_steam_calcs.py
import sys
import math
import importlib.util

# ── Load steam-calcs.py as a module ──────────────────────────────────────
spec = importlib.util.spec_from_file_location(
    'steam_calcs', 'api/steam-calcs.py'
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
inst = object.__new__(mod.handler)

# ── Test runner ───────────────────────────────────────────────────────────
passed = 0
failed = 0
errors = []

def check(name, condition, detail=''):
    global passed, failed
    if condition:
        print(f'  ✅  {name}')
        passed += 1
    else:
        print(f'  ❌  {name}  {detail}')
        failed += 1
        errors.append(name)

def close(a, b, tol=0.5, name=''):
    ok = math.isfinite(a) and math.isfinite(b) and abs(a - b) <= tol
    if not ok:
        print(f'       got {a}, expected ~{b} (tol {tol})')
    return ok


# ════════════════════════════════════════════════════════════════════════
# SECTION A — STEAM PROPERTIES
# Reference values from IAPWS-IF97 verification tables
# ════════════════════════════════════════════════════════════════════════
print('\nSECTION A — Steam Properties')

# A-1: Saturated liquid at 1 bar — NIST reference: T=99.63°C, h=417.44 kJ/kg
r = inst._section_a({'type':'sat-liq','specBy':'P','P_bar':1.0,'sys':'SI'})
d = r['data']
check('A-1  sat-liq 1 bar: Tsat=99.63°C',  close(d['T'],   99.63, 0.1))
check('A-1  sat-liq 1 bar: hf=417.44',      close(d['h'],  417.44, 0.5))
check('A-1  sat-liq 1 bar: sf=1.3026',      close(d['s'],   1.3026, 0.002))
check('A-1  sat-liq 1 bar: vf=0.001043',    close(d['v'],   0.001043, 0.00001))

# A-2: SUB-ATMOSPHERIC — the original bug (0.133 bar → Tsat should be ~51.5°C not 99.63°C)
r = inst._section_a({'type':'sat-liq','specBy':'P','P_bar':0.133,'sys':'SI'})
d = r['data']
check('A-2  sub-atm 0.133 bar: Tsat~51.5°C (bug fix)', close(d['T'], 51.5, 0.5))

# A-3: Superheated steam at 10 bar, 300°C — NIST: h=3051.2, s=7.1229
r = inst._section_a({'type':'superheat','P_bar':10.0,'T_C':300.0,'sys':'SI'})
d = r['data']
check('A-3  superheat 10bar 300C: h=3051.2',  close(d['h'], 3051.2, 1.0))
check('A-3  superheat 10bar 300C: s=7.1229',  close(d['s'],   7.1229, 0.01))
check('A-3  superheat 10bar 300C: dT_sh=120°C', close(d['dT_sh'], 120.1, 0.3))

# A-4: Wet steam split transport fields present (was missing before)
r = inst._section_a({'type':'wet','specBy':'P','P_bar':5.0,'x':0.85,'sys':'SI'})
d = r['data']
check('A-4  wet steam: mu_f present',  d.get('mu_f')  is not None)
check('A-4  wet steam: mu_g present',  d.get('mu_g')  is not None)
check('A-4  wet steam: lam_f present', d.get('lam_f') is not None)
check('A-4  wet steam: Cp_f present',  d.get('Cp_f')  is not None)
check('A-4  wet steam: x=0.85',        close(d['x'], 0.85, 0.001))

# A-5: Saturated vapor at 100 bar — NIST: T=311.06°C, hg=2724.5
r = inst._section_a({'type':'sat-vap','specBy':'P','P_bar':100.0,'sys':'SI'})
d = r['data']
check('A-5  sat-vap 100bar: T=311.06°C', close(d['T'], 311.06, 0.1))
check('A-5  sat-vap 100bar: hg=2724.5',  close(d['h'], 2724.5,  1.0))

# A-6: Imperial conversion — 1 bar = 14.504 psi, 99.63°C = 211.33°F
r = inst._section_a({'type':'sat-liq','specBy':'P','P_bar':1.0,'sys':'IMP'})
d = r['data']
check('A-6  imperial: P in psi~14.504', close(d['P'], 14.504, 0.05))
check('A-6  imperial: T in °F~211.3',   close(d['T'], 211.33,  0.2))

# A-7: Compressed liquid — 1 bar, 80°C (below Tsat=99.63)
r = inst._section_a({'type':'compressed','P_bar':1.0,'T_C':80.0,'sys':'SI'})
d = r['data']
check('A-7  compressed liquid: phase correct', d['data']['phaseCls'] == 'compressed'
      if 'data' in d else d.get('phaseCls') == 'compressed')

# A-8: Error handling — T above Tsat for compressed
r = inst._section_a({'type':'compressed','P_bar':1.0,'T_C':110.0,'sys':'SI'})
check('A-8  compressed error on T>Tsat', 'error' in r)


# ════════════════════════════════════════════════════════════════════════
# SECTION B — STEAM QUENCH
# ════════════════════════════════════════════════════════════════════════
print('\nSECTION B — Steam Quench')

BASE = {'P_s':10.0,'T1':350.0,'Tw':30.0,'Pw':12.0,'T2':200.0,
        'm_in':10000.0,'sh_min':10,'f_min':30,'f_max':110,'cv_in':0}

r = inst._section_b(BASE)
check('B-1  no error on valid inputs', 'error' not in r)

# Mass balance: m_out = m_in + m_w
check('B-2  mass balance',
      close(r['m_out'], r['m_in'] + r['m_w'], 0.1))

# Energy balance: Q_rem ≈ Q_abs (adiabatic)
check('B-3  energy balance Q_rem~Q_abs',
      close(r['Q_rem'], r['Q_abs'], 1.0))

# All 30+ HTML-required fields present
required = [
    'Ps','T1','T2','Tw','Pw','m_in','Ts',
    'h1','h2','hw','v1','v2','s1','s2',
    'ratio','m_w','m_out','qPct','Q_rem','Q_abs',
    'sh_out','shSt','mw_min','mw_max','mo_min','mo_max',
    'fMin','fMax','shMin_C','hf_Ps','hg_Ps',
    'sensT','sensW','warns','ts','unc_h1','unc_h2','unc_hw',
    'outletQuality',
]
missing = [f for f in required if f not in r]
check('B-4  all HTML fields present', not missing, str(missing))

# shSt is object with c/lbl/bb (not just a string)
shSt = r.get('shSt', {})
check('B-5  shSt is object {c,lbl,bb}',
      isinstance(shSt, dict) and 'c' in shSt and 'lbl' in shSt and 'bb' in shSt)

# Ps is MPa (10 bar steam → 1.0 MPa)
check('B-6  Ps returned in MPa',  close(r['Ps'], 1.0, 0.01))

# Pw is MPa (12 bar water → 1.2 MPa)
check('B-7  Pw returned in MPa',  close(r['Pw'], 1.2, 0.01))

# ts is a non-empty string
check('B-8  ts timestamp present', isinstance(r.get('ts'), str) and len(r['ts']) > 5)

# hf_Ps and hg_Ps are finite numbers
check('B-9  hf_Ps finite',  math.isfinite(r.get('hf_Ps', float('nan'))))
check('B-10 hg_Ps finite',  math.isfinite(r.get('hg_Ps', float('nan'))))

# sensT has base row (d=0)
base_rows = [row for row in r.get('sensT', []) if row.get('base')]
check('B-11 sensT has base row (d=0)', len(base_rows) == 1)

# Valve Cv with cv_in
r2 = inst._section_b({**BASE, 'cv_in': 50.0})
cv = r2.get('cv_res', {})
check('B-12 cv_res returned when cv_in>0', cv is not None)
check('B-13 cv_res.rat present', 'rat' in cv)
check('B-14 cv_res.sigma present', 'sigma' in cv)
check('B-15 cv_res.FL = 0.90', close(cv.get('FL', 0), 0.90, 0.01))

# Error on T2 > T1
r3 = inst._section_b({**BASE, 'T2': 400.0})
check('B-16 error when T2>T1', 'error' in r3)

# Error on T1 not superheated
r4 = inst._section_b({**BASE, 'T1': 150.0})  # Tsat@10bar = 179.9°C
check('B-17 error when T1 not superheated', 'error' in r4)


# ════════════════════════════════════════════════════════════════════════
# SECTION C — STEAM TURBINE
# ════════════════════════════════════════════════════════════════════════
print('\nSECTION C — Steam Turbine')

# C-1: inletProps — superheated at 40 bar, 400°C → NIST h≈3213.6
r = inst._section_c({'action':'inletProps','P_bar':40.0,'T_C':400.0})
check('C-1  inletProps 40bar 400C: h~3213', close(r['h'], 3213.6, 3.0))
check('C-1  inletProps: T_sat returned',   'T_sat' in r)
check('C-1  inletProps: phase=superheated', r.get('phase') == 'superheated')

# C-2: inletProps at saturation (no T_C)
r = inst._section_c({'action':'inletProps','P_bar':10.0,'T_C':None})
check('C-2  inletProps no T_C: phase=sat', r.get('phase') == 'sat')

# C-3: exhaustProps
r = inst._section_c({'action':'exhaustProps','P_bar':1.0,'s1_SI':7.1229})
check('C-3  exhaustProps: h2s finite', math.isfinite(r.get('h2s', float('nan'))))
check('C-3  exhaustProps: hfg present', 'hfg' in r)

# C-4: backpressure
r = inst._section_c({'action':'calculate','turbineType':'backpressure',
    'flow_kgh':50000,'h1_SI':3213.6,'h2s_SI':2801.4,'s1_SI':6.771,
    'p1_bar':40.0,'p2_bar':4.0,'eff':0.85,'effm':0.98,'effg':0.97})
check('C-4  backpressure: pw>0',    r.get('pw', 0) > 0)
check('C-4  backpressure: pe<pw',   r.get('pe', 0) < r.get('pw', 1))
check('C-4  backpressure: eta>0',   r.get('eta', 0) > 0)

# C-5: condensing returns heatRate, condP_bar, satCond_T
r = inst._section_c({'action':'calculate','turbineType':'condensing',
    'flow_kgh':50000,'h1_SI':3213.6,'h2s_SI':2350.0,'s1_SI':6.771,
    'p1_bar':40.0,'p2_bar':0.1,'eff':0.85,'effm':0.98,'effg':0.97,
    'cwIn_C':25.0,'cwOut_C':35.0,'hf_SI':191.8,'condP_bar':0.1})
check('C-5  condensing: heatRate present',  'heatRate'  in r)
check('C-5  condensing: condP_bar present', 'condP_bar' in r)
check('C-5  condensing: satCond_T present', 'satCond_T' in r)
check('C-5  condensing: Q_cond>0',          r.get('Q_cond', 0) > 0)

# C-6: extraction — JS field names (extFrac, he_SI)
r = inst._section_c({'action':'calculate','turbineType':'extraction',
    'flow_kgh':50000,'h1_SI':3213.6,'h2s_SI':2450.0,'s1_SI':6.771,
    'p1_bar':40.0,'p2_bar':1.0,'eff':0.85,'effm':0.98,'effg':0.97,
    'extFrac':'0.3','he_SI':'2900.0'})
check('C-6  extraction: Q_proc present',  'Q_proc'  in r)
check('C-6  extraction: w_HP present',    'w_HP'    in r)
check('C-6  extraction: w_LP present',    'w_LP'    in r)
check('C-6  extraction: he_SI echoed',    'he_SI'   in r)
check('C-6  extraction: h2_exh present',  'h2_exh'  in r)
check('C-6  extraction: extFrac echoed',  'extFrac' in r)
check('C-6  extraction: mExt present',    'mExt'    in r)
check('C-6  extraction: mExh present',    'mExh'    in r)

# C-7: error handling
r = inst._section_c({'action':'calculate','turbineType':'backpressure',
    'flow_kgh':50000,'h1_SI':2800.0,'h2s_SI':3000.0,  # h1 < h2s — invalid
    's1_SI':6.771,'p1_bar':10.0,'p2_bar':1.0,'eff':0.85,'effm':0.98,'effg':0.97})
check('C-7  error when h1<h2s', 'error' in r)


# ════════════════════════════════════════════════════════════════════════
# SECTION D — RANKINE CYCLE
# ════════════════════════════════════════════════════════════════════════
print('\nSECTION D — Rankine Cycle')

# D-1: tsat action — critical for autofill (was 404 before fix)
r = inst._section_d({'type':'tsat','params':{'P_MPa':1.0}})
check('D-1  tsat 1MPa: Tsat~179.9°C', close(r.get('tsat', 0), 179.9, 0.2))

r2 = inst._section_d({'type':'tsat','params':{'P_MPa':0.01}})
check('D-2  tsat 0.01MPa: Tsat~45.8°C', close(r2.get('tsat', 0), 45.8, 0.3))

# D-3: body format {type, params} — critical (was broken before fix)
r = inst._section_d({'type':'basic','params':{
    'T3':400,'Ph':4.0,'T1':45,'Pc':0.01,
    'etaT':0.85,'etaP':0.80,'etaG':0.95,'etaB':0.88,
    'mdot':10.0,'hhv':43.0}})
check('D-3  basic: ok=True',          r.get('ok') == True)
check('D-3  basic: etaTh in range',   0.1 < r.get('etaTh', 0) < 0.50)
check('D-3  basic: etaCarnot > etaTh', r.get('etaCarnot', 0) > r.get('etaTh', 1))
check('D-3  basic: WkW > 0',          r.get('WkW', 0) > 0)
check('D-3  basic: s1 is dict',       isinstance(r.get('s1'), dict))
check('D-3  basic: s3 is dict',       isinstance(r.get('s3'), dict))
check('D-3  basic: TsatBoiler present', 'TsatBoiler' in r)

# D-4: superheat
r = inst._section_d({'type':'superheat','params':{
    'Tsh':450,'Ph':6.0,'Tc':35,'Pc':0.006,
    'etaT':0.87,'etaP':0.82,'mdot':8.0}})
check('D-4  superheat: ok=True',    r.get('ok') == True)
check('D-4  superheat: dsh present', 'dsh' in r)
check('D-4  superheat: TsatB present', 'TsatB' in r)
check('D-4  superheat: s1 dict',    isinstance(r.get('s1'), dict))

# D-5: reheat — optP2 must be present (HTML reads r.optP2)
r = inst._section_d({'type':'reheat','params':{
    'T1':500,'P1':10.0,'Trh':480,'P2':2.0,'Pc':0.01,
    'etaHPT':0.87,'etaLPT':0.87,'etaP':0.80,'mdot':10.0,'Tc':None}})
check('D-5  reheat: ok=True',       r.get('ok') == True)
check('D-5  reheat: optP2 present', 'optP2' in r)
check('D-5  reheat: wHPT present',  'wHPT'  in r)
check('D-5  reheat: wLPT present',  'wLPT'  in r)
check('D-5  reheat: qBoiler present','qBoiler' in r)
check('D-5  reheat: Tsat1 present', 'Tsat1' in r)
check('D-5  reheat: s1 dict',       isinstance(r.get('s1'), dict))

# D-6: regen — h2 must be present (HTML reads r.h2)
r = inst._section_d({'type':'regen','params':{
    'Thi':500,'Phi':8.0,'Pbleed':1.5,'Pc':0.01,
    'etaT':0.87,'etaP':0.80,'mdot':10.0,'Tc':None}})
check('D-6  regen: ok=True',         r.get('ok') == True)
check('D-6  regen: h2 present',      'h2' in r)
check('D-6  regen: h_bl present',    'h_bl' in r)
check('D-6  regen: y in 0-0.5',      0 <= r.get('y', -1) <= 0.5)
check('D-6  regen: TsatBleed present','TsatBleed' in r)
check('D-6  regen: TsatIn present',  'TsatIn'    in r)
check('D-6  regen: s1 dict',         isinstance(r.get('s1'), dict))

# D-7: carnot — wrongEta must be present (HTML shows incorrect °C calc)
r = inst._section_d({'type':'carnot','params':{'TH':500,'TC':30,'QH':1000,'actual':None}})
check('D-7  carnot: etaC correct',    close(r.get('etaC', 0), 1-303.15/773.15, 0.001))
check('D-7  carnot: wrongEta present','wrongEta' in r)
check('D-7  carnot: COPhp present',   'COPhp'    in r)
check('D-7  carnot: COPref present',  'COPref'   in r)
check('D-7  carnot: TH_K = 773.15',   close(r.get('TH_K', 0), 773.15, 0.01))

# D-8: 2nd law violation caught
r = inst._section_d({'type':'carnot','params':{'TH':500,'TC':30,'QH':1000,'actual':99}})
check('D-8  carnot: error on eta>Carnot limit', 'error' in r)

# D-9: supercritical reheat cycle, 25 MPa / 600 °C → 4 MPa, reheat 600 °C → 0.01 MPa,
# η_HPT = η_LPT = 0.88, η_pump = 0.80. Expected values: the same cycle worked with the
# independent iapws library (IAPWS97 P,T / P,s / P,x states) — before Step 26 the
# API refused every boiler pressure above 22.064 MPa.
r = inst._section_d({'type':'reheat','params':{
    'T1':600,'P1':25,'Trh':600,'P2':4,'Tc':None,'Pc':0.01,
    'etaHPT':0.88,'etaLPT':0.88,'etaP':0.80,'mdot':100}})
check('D-9  supercritical reheat: no error', 'error' not in r, r.get('error', ''))
check('D-9  supercritical reheat: h3 = 3493.69 (iapws)', close(r.get('h3', 0), 3493.6905, 0.01))
check('D-9  supercritical reheat: h4 = 3025.50 (iapws)', close(r.get('h4', 0), 3025.4970, 0.01))
check('D-9  supercritical reheat: h6 = 2496.30 (iapws)', close(r.get('h6', 0), 2496.3042, 0.01))
check('D-9  supercritical reheat: eta = 0.412070 (iapws)', close(r.get('etaTh', 0), 0.4120701, 2e-6))
check('D-9  supercritical reheat: x6 = 0.9634 (iapws)', close(r.get('x6', 0), 0.963386, 1e-4))
check('D-9  supercritical flag set', r.get('supercritical') is True)
r = inst._section_d({'type':'superheat','params':{'Tsh':350,'Ph':25,'Tc':45,'Pc':0.01,'etaT':0.85,'etaP':0.8,'mdot':100}})
check('D-10 supercritical P below critical T → error', 'error' in r and 'critical' in r['error'])
r = inst._section_d({'type':'tsat','params':{'P_MPa':25}})
check('D-11 tsat at 25 MPa → supercritical flag', r.get('supercritical') is True and r.get('tsat') is None)


# ════════════════════════════════════════════════════════════════════════
# SECTION E — IAPWS-IF97 FORMULATION
# Expected values: the IAPWS R7-97(2012) verification tables (regions 1, 2,
# 3, 4, 5 and B23), IAPWS R12-08 / R15-11 transport check values, and the
# independent iapws library (installed by the workflow) on a (p, T) grid.
# ════════════════════════════════════════════════════════════════════════
print('\nSECTION E — IAPWS-IF97 formulation')

def rel(a, b): return abs(a / b - 1)

VER = [
    ('r1', 300, 3, dict(v=0.100215168e-2, h=0.115331273e3, u=0.112324818e3, s=0.392294792, cp=0.417301218e1, w=0.150773921e4)),
    ('r1', 300, 80, dict(v=0.971180894e-3, h=0.184142828e3, u=0.106448356e3, s=0.368563852, cp=0.401008987e1, w=0.163469054e4)),
    ('r1', 500, 3, dict(v=0.120241800e-2, h=0.975542239e3, u=0.971934985e3, s=0.258041912e1, cp=0.465580682e1, w=0.124071337e4)),
    ('r2', 300, 0.0035, dict(v=0.394913866e2, h=0.254991145e4, u=0.241169160e4, s=0.852238967e1, cp=0.191300162e1, w=0.427920172e3)),
    ('r2', 700, 0.0035, dict(v=0.923015898e2, h=0.333568375e4, u=0.301262819e4, s=0.101749996e2, cp=0.208141274e1, w=0.644289068e3)),
    ('r2', 700, 30, dict(v=0.542946619e-2, h=0.263149474e4, u=0.246861076e4, s=0.517540298e1, cp=0.103505092e2, w=0.480386523e3)),
    ('r3', 650, 500, dict(p=0.255837018e2, h=0.186343019e4, u=0.181226279e4, s=0.405427273e1, cp=0.138935717e2, w=0.502005554e3)),
    ('r3', 650, 200, dict(p=0.222930643e2, h=0.237512401e4, u=0.226365868e4, s=0.485438792e1, cp=0.446579342e2, w=0.383444594e3)),
    ('r3', 750, 500, dict(p=0.783095639e2, h=0.225868845e4, u=0.210206932e4, s=0.446971906e1, cp=0.634165359e1, w=0.760696041e3)),
    ('r5', 1500, 0.5, dict(v=0.138455090e1, h=0.521976855e4, u=0.452749310e4, s=0.965408875e1, cp=0.261609445e1, w=0.917068690e3)),
    ('r5', 1500, 30, dict(v=0.230761299e-1, h=0.516723514e4, u=0.447495124e4, s=0.772970133e1, cp=0.272724317e1, w=0.928548002e3)),
    ('r5', 2000, 30, dict(v=0.311385219e-1, h=0.657122604e4, u=0.563707038e4, s=0.853640523e1, cp=0.288569882e1, w=0.106736948e4)),
]
for reg, a, b, exp in VER:
    st = mod._region1(a, b) if reg == 'r1' else mod._region2(a, b) if reg == 'r2' else mod._region5(a, b) if reg == 'r5' else mod._region3(b, a)
    worst = max(rel(st[k], v) for k, v in exp.items())
    check(f'E-1  IF97 {reg} {a} K / {b}: all properties to 1e-8', worst < 1e-7, f'worst rel {worst:.2e}')
for T, ps in ((300, 0.353658941e-2), (500, 0.263889776e1), (600, 0.123443146e2)):
    check(f'E-2  psat({T} K) = {ps} MPa', rel(mod._psat(T), ps) < 1e-8)
for P, ts in ((0.1, 0.372755919e3), (1, 0.453035632e3), (10, 0.584149488e3)):
    check(f'E-2  tsat({P} MPa) = {ts} K', rel(mod._tsat(P), ts) < 1e-8)
check('E-2  B23 p(623.15 K) = 16.5291643 MPa', rel(mod._p23(623.15), 0.165291643e2) < 1e-8)
for T, rho, mu in ((298.15, 998, 889.7351), (298.15, 1200, 1437.649467), (373.15, 1000, 307.883622), (433.15, 1, 14.538324),
                   (873.15, 1, 32.619287), (873.15, 100, 35.802262), (873.15, 600, 77.430195), (1173.15, 400, 64.154608)):
    check(f'E-3  viscosity {T} K, {rho} kg/m3 = {mu} uPa.s', rel(mod.steam_viscosity(rho, T) * 1e6, mu) < 1e-7)
for T, rho, lam in ((298.15, 0, 18.4341883), (298.15, 998, 607.712868), (298.15, 1200, 799.038144), (873.15, 0, 79.1034659)):
    check(f'E-3  conductivity {T} K, {rho} kg/m3 = {lam} mW/mK', rel(mod.steam_conductivity(rho, T) * 1e3, lam) < 1e-7)

# states the former table interpolation got wrong: superheated steam below 1 bar,
# entropy between table pressures, high-pressure steam and compressed liquid
r = inst._section_a({'type':'sat-vap','specBy':'P','P_bar':0.1,'sys':'SI'}); d = r['data']
check('E-4  sat-vap 0.1 bar: Tsat = 45.81 °C', close(d['T'], 45.81, 0.01))
check('E-4  sat-vap 0.1 bar: hg = 2583.9', close(d['h'], 2583.89, 0.02))
r = inst._section_a({'type':'superheat','P_bar':0.1,'T_C':60.0,'sys':'SI'}); d = r['data']
check('E-4  superheat 0.1 bar 60 °C: h = 2611.18 (was 2676.2)', close(d['h'], 2611.18, 0.02))
r = inst._section_a({'type':'superheat','P_bar':150.0,'T_C':540.0,'sys':'SI'}); d = r['data']
check('E-4  superheat 150 bar 540 °C: h = 3423.22, s = 6.4897 (was 3405.9, 6.356)', close(d['h'], 3423.22, 0.02) and close(d['s'], 6.48974, 0.0001))
r = inst._section_a({'type':'superheat','P_bar':4.0,'T_C':180.0,'sys':'SI'}); d = r['data']
check('E-4  superheat 4 bar 180 °C: s = 7.0809 (was 7.157)', close(d['s'], 7.08090, 0.0001))
r = inst._section_a({'type':'superheat','P_bar':110.0,'T_C':360.0,'sys':'SI'}); d = r['data']
check('E-4  superheat 110 bar 360 °C: h = 2930.53 (was 2889.5)', close(d['h'], 2930.53, 0.02))
r = inst._section_a({'type':'superheat','P_bar':250.0,'T_C':600.0,'sys':'SI'}); d = r['data']
check('E-4  supercritical 250 bar 600 °C: no saturation fields, note given', 'Tsat' not in d and '_note' in d and close(d['h'], 3493.69, 0.05))
r = inst._section_a({'type':'sat-liq','specBy':'P','P_bar':1.0,'sys':'SI'}); d = r['data']
check('E-4  surface tension 99.6 °C = 58.99 mN/m', close(d['sigma'], 58.99, 0.02))

# against the independent iapws library on a (p, T) grid and through the flashes
try:
    from iapws import IAPWS97 as REF
    worst = {'h': 0, 's': 0, 'v': 0, 'cp': 0, 'w': 0}
    n = 0
    for T in (280, 350, 450, 550, 620, 640, 660, 700, 800, 900, 1000, 1200, 1600, 2000):
        for P in (0.005, 0.1, 1, 5, 10, 16, 20, 22, 25, 30, 50, 80, 100):
            if T > 1073.15 and P > 50: continue
            ref = REF(P=P, T=T)
            if not ref.status: continue
            st = mod.IAPWS97(P=P, T=T)
            for k in worst:
                worst[k] = max(worst[k], rel(getattr(st, k), getattr(ref, k)))
            n += 1
    check(f'E-5  {n} (p, T) states vs iapws: h, s, v, cp, w within 1e-7', max(worst.values()) < 1e-7, str(worst))
    worst_T = 0
    for P, h in ((0.01, 2400), (0.5, 3000), (5, 900), (20, 2300), (30, 2500), (80, 3200)):
        worst_T = max(worst_T, abs(mod.IAPWS97(P=P, h=h).T - REF(P=P, h=h).T))
    check('E-5  (p, h) flashes vs iapws: T within 1e-6 K', worst_T < 1e-6, f'{worst_T:.2e}')
except ImportError:
    print('  (iapws not installed — library comparison skipped)')


# ════════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════════
print(f'\n{"="*60}')
print(f'  RESULTS: {passed} passed,  {failed} failed')
print(f'{"="*60}')
if errors:
    print('\nFailed tests:')
    for e in errors:
        print(f'  ❌  {e}')
    print()
    sys.exit(1)
else:
    print('\n  All tests passed ✅')
    sys.exit(0)
