# Round 12d — UNIFAC-LL and NIST-modified UNIFAC tables and group assignments for the engine.
#
# Writes api/_lib/mb-unifac2.js from the thermo library (v0.6.1, MIT licence, Copyright (c) 2016–2025 Caleb Bell
# and contributors), which carries the published parameter tables:
#   UNIFAC-LL  — Magnussen, Rasmussen & Fredenslund, Ind. Eng. Chem. Process Des. Dev. 20 (1981) 331:
#                57 subgroups (R, Q), 32 main groups, temperature-independent a_mn fitted to liquid–liquid data
#   NIST-modified UNIFAC — Kang, Diky & Frenkel, Fluid Phase Equilib. 388 (2015) 128: 201 subgroups, 52 main
#                groups, Dortmund form ψ = exp(−(a + bT + cT²)/T)
# Group assignments for every databank component with a structure come from fragmenting its SMILES with
# thermo's SMARTS for each table (RDKit); where that fails, from the component's original-UNIFAC (UNIFAC-LL) or
# Dortmund (NIST) assignment mapped subgroup by subgroup. The mapping tables are written too, for components
# a user adds by structure.
#
#   python3 -I scripts/gen-unifac2.py [report.json]
import json, os, re, subprocess, sys
import thermo.unifac as u
from thermo.group_contribution.group_contribution_base import smarts_fragment_priority
from rdkit import Chem, RDLogger
RDLogger.DisableLog('rdApp.*')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'unifac2-report.json')
u.load_unifac_ip()

# ---- the databank (key, SMILES, original-UNIFAC and Dortmund assignments) from the engine itself
dump = subprocess.run(['node', '-e', """
import('./api/_lib/mb-compdb.js').then((m) => { const d = m.default; const o = {};
  for (const k of d.keys()) { const c = d.get(k); o[k] = { smiles: c.smiles || null, unifac: c.unifac || null, modunifac: c.modunifac || null }; }
  process.stdout.write(JSON.stringify(o)); });"""], cwd=ROOT, capture_output=True, text=True, check=True).stdout
DB = json.loads(dump)

# ---- tables
LSUB = {}
for k, g in u.LLEUFSG.items():
    R = g.R if g.R < 100 else g.R / 10000          # thermo's table has R = 9183 for FCH2O (THF); Magnussen: 0.9183
    LSUB[k] = [g.main_group_id, R, g.Q, g.group]
LA = {}
for m, row in u.LLEUFIP.items():
    for n, a in row.items():
        if m != n: LA[f'{m}|{n}'] = a
NSUB = {k: [g.main_group_id, g.R, g.Q, g.group] for k, g in u.NISTUFSG.items()}
NA = {}
for m, row in u.NISTUFIP.items():
    for n, abc in row.items():
        if m != n: NA[f'{m}|{n}'] = list(abc)
LMAIN = {k: v[0] for k, v in u.LLEMG.items()}
NMAIN = {k: v[0] for k, v in u.NISTUFMG.items()}

# ---- original UNIFAC subgroup -> UNIFAC-LL subgroup(s), by name (the two CHO groups by their main group)
norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
U2L = {}
lle_by_name = {}
for k, g in u.LLEUFSG.items(): lle_by_name.setdefault(norm(g.group), []).append(k)
for k, g in u.UFSG.items():
    c = lle_by_name.get(norm(g.group), [])
    if len(c) == 1: U2L[k] = {c[0]: 1}
    elif len(c) > 1:                                  # CHO: aldehyde (UNIFAC main 10) or ether (main 13)
        U2L[k] = {21: 1} if g.main_group_id == 10 else {29: 1}
U2L[15] = {1: 1, 14: 1}                               # CH3OH: no methanol group in UNIFAC-LL — CH3 + OH
U2L[27] = {30: 1}                                     # THF ring CH2O = FCH2O
U2L[61] = {22: 1}                                     # furfural
U2L[62] = {48: 1}                                     # ethylene glycol (DOH)
U2L[72] = {55: 1}                                     # DMF
# ---- Dortmund subgroup -> NIST subgroup: same number where the group is the same, renumbered where it is not
N_by_name = {norm(g.group): k for k, g in u.NISTUFSG.items()}
SAME = {14, 27, 62, 68, 78, 79, 80, 81, 82, 83, 84, 86, 87, 88, 89, 101, 102, 103, 110, 112, 113, 114}
D2N = {}
for k, g in u.DOUFSG.items():
    n = u.NISTUFSG.get(k)
    if n is not None and (norm(n.group) == norm(g.group) or k in SAME): D2N[k] = k
    elif norm(g.group) in N_by_name: D2N[k] = N_by_name[norm(g.group)]
D2N.update({122: 134, 123: 135, 124: 136})           # CH3S, CH2S, CHS -> CH3-S-, -CH2-S-, >CH-S-

def mapped(assign, table):
    if not assign: return None
    out = {}
    for s, cnt in assign.items():
        t = table.get(int(s))
        if t is None: return None
        for q, m in (t.items() if isinstance(t, dict) else [(t, 1)]): out[q] = out.get(q, 0) + m * cnt
    return out

def frag(smiles, catalog):
    m = Chem.MolFromSmiles(smiles) if smiles else None
    if m is None: return None
    try:
        a, _, _, ok, _ = smarts_fragment_priority(catalog=catalog, rdkitmol=m)
    except Exception:
        return None
    return {int(k): int(v) for k, v in a.items()} if ok and a else None

LLE, NIST = {}, {}
rep = {'lle': {'smarts': 0, 'mapped': 0, 'none': 0}, 'nist': {'smarts': 0, 'mapped': 0, 'none': 0},
       'nist_vs_dortmund': {'same': 0, 'differ': 0, 'examples': []}, 'lle_vs_unifac': {'same': 0, 'differ': 0, 'examples': []}}
for key, c in DB.items():
    a = frag(c['smiles'], u.UNIFAC_LLE_SUBGROUPS)
    if a: rep['lle']['smarts'] += 1
    else:
        a = mapped(c['unifac'], U2L)
        rep['lle']['mapped' if a else 'none'] += 1
    if a:
        # every main group of the component must have UNIFAC-LL parameters with water and hydrocarbons at least
        LLE[key] = a
        mu = mapped(c['unifac'], U2L)
        if mu is not None:
            if mu == a: rep['lle_vs_unifac']['same'] += 1
            else:
                rep['lle_vs_unifac']['differ'] += 1
                if len(rep['lle_vs_unifac']['examples']) < 40: rep['lle_vs_unifac']['examples'].append([key, a, mu])
    b = frag(c['smiles'], u.NISTUFSG_SUBGROUPS)
    if b: rep['nist']['smarts'] += 1
    else:
        b = mapped(c['modunifac'], D2N)
        rep['nist']['mapped' if b else 'none'] += 1
    if b:
        NIST[key] = b
        md = mapped(c['modunifac'], D2N)
        if md is not None:
            if md == b: rep['nist_vs_dortmund']['same'] += 1
            else:
                rep['nist_vs_dortmund']['differ'] += 1
                if len(rep['nist_vs_dortmund']['examples']) < 60: rep['nist_vs_dortmund']['examples'].append([key, b, md])

# main-group pairs without parameters among assigned components (for the report)
def missing_pairs(assign, sub, A):
    mains = sorted({sub[s][0] for a in assign.values() for s in a})
    miss = [(m, n) for i, m in enumerate(mains) for n in mains[i + 1:] if f'{m}|{n}' not in A or f'{n}|{m}' not in A]
    return len(mains), len(miss)
rep['lle_main_groups_used'], rep['lle_missing_pairs'] = missing_pairs(LLE, LSUB, LA)
rep['nist_main_groups_used'], rep['nist_missing_pairs'] = missing_pairs(NIST, NSUB, NA)
rep['n_lle'], rep['n_nist'], rep['n_db'] = len(LLE), len(NIST), len(DB)

def js(o): return json.dumps(o, separators=(',', ':'), ensure_ascii=False)
txt = f"""// ============================================================================
// REPO PATH: api/_lib/mb-unifac2.js
// ============================================================================
// multicalci.com — GENERATED by scripts/gen-unifac2.py from the thermo library (v0.6.1, MIT licence,
// Copyright (c) 2016–2025 Caleb Bell and contributors). Do not edit by hand.
//   LLE_*  — UNIFAC-LL: Magnussen, Rasmussen & Fredenslund, Ind. Eng. Chem. Process Des. Dev. 20 (1981) 331
//            (subgroup [main, R, Q, name]; a_mn in K, temperature independent)
//   NIST_* — NIST-modified UNIFAC: Kang, Diky & Frenkel, Fluid Phase Equilib. 388 (2015) 128
//            (subgroup [main, R, Q, name]; [a, b, c] of ψ = exp(−(a + bT + cT²)/T))
//   *_ASSIGN — group counts of the databank components (RDKit fragmentation with thermo's SMARTS; where that
//            fails, the original-UNIFAC or Dortmund assignment mapped through U2LLE / D2NIST)
// Server-side only (api/_lib).
export const LLE_SUB = {js(LSUB)};
export const LLE_A = {js(LA)};
export const LLE_MAIN = {js(LMAIN)};
export const NIST_SUB = {js(NSUB)};
export const NIST_A = {js(NA)};
export const NIST_MAIN = {js(NMAIN)};
export const U2LLE = {js(U2L)};
export const D2NIST = {js(D2N)};
export const LLE_ASSIGN = {js(LLE)};
export const NIST_ASSIGN = {js(NIST)};
export default {{ LLE_SUB, LLE_A, LLE_MAIN, NIST_SUB, NIST_A, NIST_MAIN, U2LLE, D2NIST, LLE_ASSIGN, NIST_ASSIGN }};
"""
open(os.path.join(ROOT, 'api/_lib/mb-unifac2.js'), 'w', encoding='utf8').write(txt)
json.dump(rep, open(REPORT, 'w'), indent=1)
print(json.dumps({k: v for k, v in rep.items() if k not in ('nist_vs_dortmund', 'lle_vs_unifac')}),
      'nist_vs_dortmund', rep['nist_vs_dortmund']['same'], rep['nist_vs_dortmund']['differ'],
      'lle_vs_unifac', rep['lle_vs_unifac']['same'], rep['lle_vs_unifac']['differ'])
