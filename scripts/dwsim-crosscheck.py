#!/usr/bin/env python3
"""
Cross-check of the multicalci.com flowsheet engine against DWSIM (round 11).

Needs the DWSIM headless MCP server running locally (dwsim-mcp, default http://127.0.0.1:5901/mcp; override with
DWSIM_MCP_URL) and Node 18+. Each case is built in DWSIM through the server and in the engine with the same feed;
the script prints both and writes them to a JSON file (default dwsim-crosscheck.json).

  python3 scripts/dwsim-crosscheck.py                      all cases
  python3 scripts/dwsim-crosscheck.py valve_ng pump_water  selected cases
  python3 scripts/dwsim-crosscheck.py out.json             other output file

DWSIM is GPL-3 software; this script only exchanges inputs and numbers with it and contains none of its code.
Python standard library only.
"""
import json, os, subprocess, sys, traceback, urllib.request
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
URL = os.environ.get('DWSIM_MCP_URL', 'http://127.0.0.1:5901/mcp')
_id = [0]
def call(method, params=None):
    _id[0] += 1
    body = json.dumps({'jsonrpc': '2.0', 'id': _id[0], 'method': method, 'params': params or {}}).encode()
    req = urllib.request.Request(URL, data=body, headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'})
    with urllib.request.urlopen(req, timeout=300) as r:
        txt = r.read().decode()
    if txt.startswith('event:') or txt.startswith('data:'):
        txt = '\n'.join(l[5:] for l in txt.splitlines() if l.startswith('data:'))
    return json.loads(txt)
def tool(_tool, **args):
    r = call('tools/call', {'name': _tool, 'arguments': args})
    if 'error' in r: return {'_error': r['error']}
    res = r['result']
    out = []
    for c in res.get('content', []):
        if c.get('type') == 'text':
            try: out.append(json.loads(c['text']))
            except Exception: out.append(c['text'])
    return out[0] if len(out) == 1 else out
call('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'multicalci-crosscheck', 'version': '1'}})

MW = {'Methane': 16.0428, 'Ethane': 30.069, 'Propane': 44.0956, 'N-butane': 58.1222, 'N-pentane': 72.1488, 'Nitrogen': 28.0134, 'Carbon dioxide': 44.0095,
      'Hydrogen': 2.01588, 'Ammonia': 17.0305, 'Argon': 39.948, 'Water': 18.01528, 'Methanol': 32.04186, 'Ethanol': 46.06844, 'Benzene': 78.11184, 'Toluene': 92.13842}
def mass(molefr):
    s = sum(v * MW[k] for k, v in molefr.items())
    return {k: v * MW[k] / s for k, v in molefr.items()}
def flowsheet(name, comps, pkg):
    fid = tool('dwsim_flowsheet_create', name=name)['flowsheet_id']
    a = tool('dwsim_thermo_add_compounds', flowsheet_id=fid, names=comps)
    p = tool('dwsim_thermo_set_property_package', flowsheet_id=fid, name=pkg)
    return fid
def solve(fid):
    return tool('dwsim_solve_run', flowsheet_id=fid)
def stream(fid, name):
    return tool('dwsim_stream_get_results', flowsheet_id=fid, name=name)

MW.update({'Acetone': 58.07914, 'N-hexane': 86.17536})
ENG_KEY = {'Methane': 'CH4', 'Ethane': 'C2H6', 'Propane': 'C3H8', 'N-butane': 'nC4H10', 'N-pentane': 'n-pentane', 'Nitrogen': 'N2', 'Carbon dioxide': 'CO2',
           'Hydrogen': 'H2', 'Ammonia': 'NH3', 'Argon': 'Ar', 'Water': 'H2O', 'Methanol': 'MeOH', 'Ethanol': 'EtOH', 'Benzene': 'benzene', 'Toluene': 'toluene',
           'Acetone': 'acetone', 'N-hexane': 'nC6H14', 'Carbon monoxide': 'CO'}
NG = {'Methane': 0.85, 'Ethane': 0.06, 'Propane': 0.03, 'N-butane': 0.01, 'N-pentane': 0.005, 'Nitrogen': 0.02, 'Carbon dioxide': 0.025}
PR, SRK = 'Peng-Robinson (PR)', 'Soave-Redlich-Kwong (SRK)'

def eng_comps(comp):
    m = mass(comp)
    return [{'key': ENG_KEY[k], 'mass_fraction': v} for k, v in m.items()]

ENGINE_RUNNER = r'''
import engine from './api/_lib/mb-engine.js';
let buf = ''; process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  process.stdout.write(JSON.stringify(JSON.parse(buf).map((j) => {
    const r = engine.runModule(j.module, j.args);
    if (r.error) return { _error: r.error.message || JSON.stringify(r.error) };
    const o = {}; for (const [k, p] of Object.entries(j.picks)) o[k] = get(r, p); return o;
  })));
});'''
def run_engine(jobs):
    p = subprocess.run(['node', '--input-type=module', '-e', ENGINE_RUNNER], input=json.dumps(jobs), capture_output=True, text=True, cwd=REPO)
    if p.returncode: raise RuntimeError(p.stderr[-2000:])
    return json.loads(p.stdout)

def ds_feed(fid, name, comp, T=None, P=None, vf=None, kg_s=1.0):
    a = dict(flowsheet_id=fid, name=name, mass_flow_kg_s=kg_s, composition=mass(comp))
    if T is not None: a['temperature_K'] = T
    if P is not None: a['pressure_Pa'] = P
    if vf is not None: a['vapor_fraction'] = vf
    return tool('dwsim_stream_add_material', **a)

def phase(r, kind):
    for p in r['phases']:
        if p['name'].lower().startswith(kind): return p
    return None

def ds_mole(p, k): return p['compounds'][k]['mole_fraction']

CASES = []
SETLOG = []
def case(f): CASES.append(f); return f

# ---------------------------------------------------------------- phase equilibrium
@case
def ng_flash_pr():
    fid = flowsheet('x1', list(NG), PR); ds_feed(fid, 'F', NG, T=220, P=40e5); solve(fid); r = stream(fid, 'F')
    v = phase(r, 'vap'); l = phase(r, 'liq')
    ds = {'vapour_fraction': v['fraction'], 'y_CH4': ds_mole(v, 'Methane'), 'x_CH4': ds_mole(l, 'Methane'), 'x_C3H8': ds_mole(l, 'Propane')}
    job = {'module': 'r-flash', 'args': {'streams': [{'mass_flow_kg_h': 3600, 'T_K': 220, 'P_bar': 40, 'components': eng_comps(NG)}], 'params': {'property_package': {'model': 'pr'}, 'T_K': 220, 'P_bar': 40}},
           'picks': {'vapour_fraction': 'details.vapour_fraction', 'y_CH4': 'details.y.CH4', 'x_CH4': 'details.x.CH4', 'x_C3H8': 'details.x.C3H8'}}
    return 'Natural gas (7 components), PT flash 220 K, 40 bar, Peng–Robinson', ds, job

@case
def c3c4_bubble_dew_pr():
    comp = {'Propane': 0.5, 'N-butane': 0.5}; out = {}
    for vf, nm in ((0, 'bubble_T_K'), (1, 'dew_T_K')):
        fid = flowsheet('x2', list(comp), PR); ds_feed(fid, 'F', comp, P=10e5, vf=vf); solve(fid); out[nm] = stream(fid, 'F')['temperature_K']
    jobs = [{'module': 'heater', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 300, 'P_bar': 10, 'components': eng_comps(comp)}], 'params': {'property_package': {'model': 'pr'}, 'vapour_fraction': vf}},
             'picks': {nm: 'streams_out.0.T_K'}} for vf, nm in ((0, 'bubble_T_K'), (1, 'dew_T_K'))]
    return 'Propane / n-butane 0.5 / 0.5, bubble and dew point at 10 bar, Peng–Robinson', out, jobs

@case
def ng_flash_srk():
    fid = flowsheet('x3', list(NG), SRK); ds_feed(fid, 'F', NG, T=230, P=50e5); solve(fid); r = stream(fid, 'F')
    v = phase(r, 'vap'); l = phase(r, 'liq')
    ds = {'vapour_fraction': v['fraction'], 'x_CH4': ds_mole(l, 'Methane')}
    job = {'module': 'r-flash', 'args': {'streams': [{'mass_flow_kg_h': 3600, 'T_K': 230, 'P_bar': 50, 'components': eng_comps(NG)}], 'params': {'property_package': {'model': 'srk'}, 'T_K': 230, 'P_bar': 50}},
           'picks': {'vapour_fraction': 'details.vapour_fraction', 'x_CH4': 'details.x.CH4'}}
    return 'Natural gas, PT flash 230 K, 50 bar, SRK', ds, job

def bubble_case(comp, pkg_ds, model, P=101325, extra=None):
    fid = flowsheet('xb', list(comp), pkg_ds); ds_feed(fid, 'F', comp, P=P, vf=0); solve(fid); r = stream(fid, 'F')
    v = phase(r, 'vap'); k0 = list(comp)[0]
    ds = {'bubble_T_K': r['temperature_K'], 'y_' + ENG_KEY[k0]: ds_mole(v, k0) if v else None}
    pk = {'model': model}; pk.update(extra or {})
    job = {'module': 'r-flash', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 300, 'P_bar': P / 1e5, 'components': eng_comps(comp)}], 'params': {'property_package': pk, 'P_bar': P / 1e5, 'vapour_fraction': 0}},
           'picks': {'bubble_T_K': 'details.T_K', 'y_' + ENG_KEY[k0]: 'details.y.' + ENG_KEY[k0]}}
    return ds, job

@case
def etoh_water_nrtl():
    ds, job = bubble_case({'Ethanol': 0.3, 'Water': 0.7}, 'NRTL', 'nrtl')
    return 'Ethanol / water 0.3 / 0.7, bubble point at 1 atm, NRTL (ChemSep parameters in both)', ds, job

@case
def acetone_meoh_uniquac():
    ds, job = bubble_case({'Acetone': 0.5, 'Methanol': 0.5}, 'UNIQUAC', 'uniquac')
    return 'Acetone / methanol 0.5 / 0.5, bubble point at 1 atm, UNIQUAC', ds, job

@case
def benzene_toluene_raoult():
    ds, job = bubble_case({'Benzene': 0.5, 'Toluene': 0.5}, "Raoult's Law", 'ideal', extra={'poynting': False})
    return 'Benzene / toluene 0.5 / 0.5, bubble point at 1 atm, Raoult’s law', ds, job

@case
def nh3_separator():
    comp = {'Hydrogen': 0.60, 'Nitrogen': 0.20, 'Ammonia': 0.12, 'Methane': 0.05, 'Argon': 0.03}
    fid = flowsheet('x7', list(comp), PR); ds_feed(fid, 'F', comp, T=273.15, P=140e5); solve(fid); r = stream(fid, 'F')
    v = phase(r, 'vap'); l = phase(r, 'liq')
    ds = {'vapour_fraction': v['fraction'], 'y_NH3': ds_mole(v, 'Ammonia'), 'x_NH3': ds_mole(l, 'Ammonia'), 'rho_vapour': v['density_kg_m3']}
    jobs = []
    for vt in (True, False):
        jobs.append({'module': 'r-flash', 'args': {'streams': [{'mass_flow_kg_h': 3600, 'T_K': 273.15, 'P_bar': 140, 'components': eng_comps(comp)}], 'params': {'property_package': {'model': 'pr', 'volume_translation': vt}, 'T_K': 273.15, 'P_bar': 140}},
                     'picks': ({'vapour_fraction': 'details.vapour_fraction', 'y_NH3': 'details.y.NH3', 'x_NH3': 'details.x.NH3', 'rho_vapour': 'streams_out.0.rig.props.rho_kgm3'} if vt else {'rho_vapour_plainPR': 'streams_out.0.rig.props.rho_kgm3'})})
    return 'Ammonia-loop separator gas, 0 °C, 140 bar, Peng–Robinson', ds, jobs

@case
def ng_dew_50bar():
    fid = flowsheet('x8', list(NG), PR); ds_feed(fid, 'F', NG, P=50e5, vf=1); solve(fid); r = stream(fid, 'F')
    ds = {'dew_T_K': r['temperature_K']}
    job = {'module': 'heater', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 300, 'P_bar': 50, 'components': eng_comps(NG)}], 'params': {'property_package': {'model': 'pr'}, 'vapour_fraction': 1}},
           'picks': {'dew_T_K': 'streams_out.0.T_K'}}
    return 'Natural gas hydrocarbon dew point at 50 bar, Peng–Robinson', ds, job

# ---------------------------------------------------------------- unit operations
def ds_unit(name, comp, pkg, T, P, utype, props, energy='feed', kg_s=1000 / 3600):
    fid = flowsheet(name, list(comp), pkg)
    ds_feed(fid, 'IN', comp, T=T, P=P, kg_s=kg_s)
    tool('dwsim_stream_add_material', flowsheet_id=fid, name='OUT')
    tool('dwsim_unitop_add', flowsheet_id=fid, type=utype, name='U')
    con = dict(flowsheet_id=fid, unitop='U', feed_stream='IN', product_stream='OUT')
    if energy:
        tool('dwsim_stream_add_energy', flowsheet_id=fid, name='E')
        con['energy_feed' if energy == 'feed' else 'energy_product'] = 'E'
    tool('dwsim_unitop_connect', **con)
    SETLOG.append(tool('dwsim_unitop_set', flowsheet_id=fid, name='U', properties=props))
    s = solve(fid)
    if not s.get('ok'): raise RuntimeError(json.dumps(s)[:800])
    u = tool('dwsim_unitop_get_results', flowsheet_id=fid, name='U')
    u['_set'] = SETLOG[-1]
    if energy:
        try: u['_energy'] = tool('dwsim_stream_get_results', flowsheet_id=fid, name='E')
        except Exception as e: u['_energy'] = repr(e)
    u['_in'] = stream(fid, 'IN')
    return u, stream(fid, 'OUT')

def uval(u, *names):
    for n in names:
        if n in u['properties']: return float(u['properties'][n]['value'])
    raise KeyError(f'{names} not in {list(u["properties"])}')

for gas, key in (('Methane', 'CH4'), ('Hydrogen', 'H2')):
    def mk(gas=gas, key=key):
        def f():
            u, o = ds_unit('k_' + key, {gas: 1}, PR, 300, 30e5, 'Compressor', {'POut': 150e5, 'AdiabaticEfficiency': 75})
            ds = {'power_kW': uval(u, 'Power Required'), 'T_out_K': o['temperature_K']}
            jobs = [{'module': 'compressor', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 300, 'P_bar': 30, 'components': [{'key': key, 'mass_fraction': 1}]}],
                                                   'params': {'property_package': {'model': 'pr', 'volume_translation': vt}, 'P_out_bar': 150, 'efficiency': 0.75}},
                     'picks': {'power_kW' + sfx: 'details.power_kW', 'T_out_K' + sfx: 'details.T_out_K'}} for vt, sfx in ((True, ''), (False, '_plainPR'))]
            return f'Compressor, 1000 kg/h {gas.lower()}, 300 K, 30 → 150 bar, adiabatic efficiency 0.75, Peng–Robinson', ds, jobs
        f.__name__ = 'compressor_' + key
        return f
    CASES.append(mk())

@case
def valve_ng():
    u, o = ds_unit('v', NG, PR, 300, 60e5, 'Valve', {'DeltaP': 50e5}, energy=None)
    ds = {'T_out_K': o['temperature_K']}
    job = {'module': 'valve', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 300, 'P_bar': 60, 'components': eng_comps(NG)}], 'params': {'property_package': {'model': 'pr'}, 'P_out_bar': 10}},
           'picks': {'T_out_K': 'streams_out.0.T_K'}}
    return 'Valve, natural gas 300 K, 60 → 10 bar (Joule–Thomson), Peng–Robinson', ds, job

@case
def pump_water():
    u, o = ds_unit('p', {'Water': 1}, 'Steam Tables (IAPWS-IF97)', 300, 1e5, 'Pump', {'DeltaP': 19e5, 'Eficiencia': 75}, kg_s=10.0)
    ds = {'power_kW': uval(u, 'Power Required', 'Power'), 'T_out_K': o['temperature_K']}
    job = {'module': 'pump', 'args': {'streams': [{'mass_flow_kg_h': 36000, 'T_K': 300, 'P_bar': 1, 'components': [{'key': 'H2O', 'mass_fraction': 1}]}], 'params': {'property_package': {'model': 'steam'}, 'P_out_bar': 20, 'efficiency': 0.75}},
           'picks': {'power_kW': 'details.power_kW', 'T_out_K': 'streams_out.0.T_K'}}
    return 'Pump, 36 t/h water 300 K, 1 → 20 bar, efficiency 0.75, IAPWS-IF97', ds, job

@case
def cooler_ng():
    u, o = ds_unit('c', NG, PR, 300, 50e5, 'Cooler', {'CalcMode': 'OutletTemperature', 'OutletTemperature': 240, 'DeltaP': 0}, energy='product')
    v = phase(o, 'vap')
    hmix = lambda st: next(p for p in st['phases'] if p['name'] == 'Mixture')['enthalpy_kJ_kg']
    ds = {'duty_kW': o['mass_flow_kg_s'] * (hmix(o) - hmix(u['_in'])), 'vapour_fraction': v['fraction'] if v else 1.0}
    job = {'module': 'heater', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 300, 'P_bar': 50, 'components': eng_comps(NG)}], 'params': {'property_package': {'model': 'pr'}, 'T_out_K': 240}},
           'picks': {'duty_kW': 'details.duty_kW', 'vapour_fraction': 'streams_out.0.vapour_fraction'}}
    return 'Cooler, natural gas 50 bar, 300 → 240 K, Peng–Robinson', ds, job

def gibbs_case():
    MW['Carbon monoxide'] = 28.0101
    comp = {'Methane': 0.25, 'Water': 0.75, 'Hydrogen': 0, 'Carbon monoxide': 0, 'Carbon dioxide': 0}
    fid = flowsheet('g', list(comp), PR)
    tool('dwsim_stream_add_material', flowsheet_id=fid, name='IN', temperature_K=1100, pressure_Pa=1e5, mass_flow_kg_s=1, composition={'Methane': 0.25 * 16.0428, 'Water': 0.75 * 18.01528})
    tool('dwsim_stream_add_material', flowsheet_id=fid, name='V'); tool('dwsim_stream_add_material', flowsheet_id=fid, name='L'); tool('dwsim_stream_add_energy', flowsheet_id=fid, name='E')
    tool('dwsim_unitop_add', flowsheet_id=fid, type='GibbsReactor', name='R')
    tool('dwsim_unitop_connect', flowsheet_id=fid, unitop='R', feed_stream='IN', product_stream='V', product_port=0, energy_feed='E')
    tool('dwsim_unitop_connect', flowsheet_id=fid, unitop='R', product_stream='L', product_port=1)
    tool('dwsim_reactor_set_compounds', flowsheet_id=fid, name='R', compounds=list(comp))
    SETLOG.append(tool('dwsim_unitop_set', flowsheet_id=fid, name='R', properties={'ReactorOperationMode': 'Isothermic'}))
    s = solve(fid)
    if not s.get('ok'): raise RuntimeError(json.dumps(s)[:800])
    v = stream(fid, 'V'); ph = next(p for p in v['phases'] if p['name'] == 'Mixture')
    ds = {'T_K': v['temperature_K']}
    for k in ('Hydrogen', 'Carbon monoxide', 'Carbon dioxide', 'Methane', 'Water'): ds['y_' + ENG_KEY[k]] = ph['compounds'][k]['mole_fraction']
    job = {'module': 'gibbs', 'args': {'streams': [{'mass_flow_kg_h': 3600, 'T_K': 1100, 'P_bar': 1, 'components': [{'key': 'CH4', 'mass_fraction': 0.25 * 16.0428 / (0.25 * 16.0428 + 0.75 * 18.01528)}, {'key': 'H2O', 'mass_fraction': 0.75 * 18.01528 / (0.25 * 16.0428 + 0.75 * 18.01528)}]}],
                                       'params': {'property_package': {'model': 'pr'}, 'T_out_K': 1100, 'products': ['H2', 'CO', 'CO2']}},
           'picks': {'T_K': 'streams_out.0.T_K', **{'y_' + k: 'details.outlet_mole_frac.' + k for k in ('H2', 'CO', 'CO2', 'CH4', 'H2O')}}}
    return 'Gibbs reactor, steam reforming CH₄ : H₂O = 1 : 3 at 1100 K, 1 bar (Peng–Robinson; each program its own formation data)', ds, job
gibbs_case.__name__ = 'gibbs_smr'
CASES.append(gibbs_case)

def web_layers():
    comp = {'Water': 0.074, 'Ethanol': 0.185, 'Benzene': 0.741}   # mass fractions (ternary azeotrope)
    fid = flowsheet('web', list(comp), 'NRTL')
    tool('dwsim_stream_add_material', flowsheet_id=fid, name='F', temperature_K=338.05, pressure_Pa=1.5e5, mass_flow_kg_s=1.0, composition=comp)
    solve(fid); r = stream(fid, 'F')
    L = [p for p in r['phases'] if p['name'] in ('Liquid1', 'Liquid2') and p['fraction'] > 0]
    def wt(p): return {ENG_KEY[k]: v['mass_fraction'] for k, v in p['compounds'].items()}
    ds = {}
    for p in L:
        w = wt(p); tag = 'org' if w['benzene'] > 0.5 else 'aq'
        for k in ('H2O', 'EtOH', 'benzene'): ds[f'w_{k}_{tag}'] = w[k]
    ds['n_liquids'] = len(L)
    job = {'module': 'r-flash3', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': 338.05, 'P_bar': 1.5, 'components': [{'key': 'H2O', 'mass_fraction': 0.074}, {'key': 'EtOH', 'mass_fraction': 0.185}, {'key': 'benzene', 'mass_fraction': 0.741}]}],
                                         'params': {'property_package': {'model': 'nrtl', 'three_phase': True}, 'T_K': 338.05, 'P_bar': 1.5}},
           'picks': {'w_EtOH_org': 'streams_out.1.components.0.mass_fraction', 'w_H2O_org': 'streams_out.1.components.1.mass_fraction', 'w_benzene_org': 'streams_out.1.components.2.mass_fraction',
                     'w_EtOH_aq': 'streams_out.2.components.0.mass_fraction', 'w_H2O_aq': 'streams_out.2.components.1.mass_fraction', 'w_benzene_aq': 'streams_out.2.components.2.mass_fraction'}}
    return 'Water / ethanol / benzene at the ternary heteroazeotrope (7.4 / 18.5 / 74.1 wt %, 64.9 °C), NRTL — the two liquid layers (CRC: organic 1.3 / 12.7 / 86.0, aqueous 43.1 / 52.1 / 4.8 wt % water / ethanol / benzene)', ds, job
web_layers.__name__ = 'web_layers'
CASES.append(web_layers)

def lle_binary(hc_ds, T, ref):
    def f():
        comp = {'Water': 0.5, hc_ds: 0.5}
        fid = flowsheet('lle', list(comp), 'NRTL')
        ds_feed(fid, 'F', comp, T=T, P=2e5); solve(fid); r = stream(fid, 'F')
        L = [p for p in r['phases'] if p['name'] in ('Liquid1', 'Liquid2') and p['fraction'] > 0]
        ds = {'n_liquids': len(L)}
        for p in L:
            xw = p['compounds']['Water']['mole_fraction']
            if xw > 0.5: ds['x_hc_in_water'] = p['compounds'][hc_ds]['mole_fraction']
            else: ds['x_water_in_hc'] = xw
        k = ENG_KEY[hc_ds]
        job = {'module': 'r-flash3', 'args': {'streams': [{'mass_flow_kg_h': 1000, 'T_K': T, 'P_bar': 2, 'components': eng_comps(comp)}], 'params': {'property_package': {'model': 'nrtl', 'three_phase': True}, 'T_K': T, 'P_bar': 2}},
               'picks': {'x_hc_in_water': 'details.x2.' + k, 'x_water_in_hc': 'details.x1.H2O'}}
        return f'{hc_ds}–water liquid–liquid equilibrium at {T - 273.15:.0f} °C, NRTL (IUPAC-NIST: {ref})', ds, job
    f.__name__ = 'lle_' + ENG_KEY[hc_ds] + '_' + str(int(round(T)))
    return f
CASES.append(lle_binary('Benzene', 298.15, 'benzene in water 4.11e-4, water in benzene 3.09e-3'))
CASES.append(lle_binary('Toluene', 298.15, 'toluene in water 1.12e-4, water in toluene 2.80e-3'))
CASES.append(lle_binary('N-hexane', 298.15, 'hexane in water 2.50e-6, water in hexane 5.10e-4 (measured)'))

if __name__ == '__main__':
    only = [a for a in sys.argv[1:] if not a.endswith('.json')]
    OUT = next((a for a in sys.argv[1:] if a.endswith('.json')), 'dwsim-crosscheck.json')
    out = {}
    for f in CASES:
        if only and f.__name__ not in only: continue
        try:
            desc, ds, jobs = f()
            if isinstance(jobs, dict): jobs = [jobs]
            eng = {}
            for r in run_engine(jobs): eng.update(r)
            out[f.__name__] = {'desc': desc, 'dwsim': ds, 'engine': eng, 'jobs': jobs}
            print(f.__name__, json.dumps(ds), json.dumps(eng), flush=True)
        except Exception as e:
            print(f.__name__, 'ERROR', repr(e)[:600], flush=True); traceback.print_exc()
    json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
    print('wrote', OUT)
