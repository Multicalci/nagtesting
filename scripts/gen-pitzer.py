# ============================================================================
# REPO PATH: scripts/gen-pitzer.py
# ============================================================================
# multicalci.com — STEP 38: extracts the part of the USGS PHREEQC pitzer.dat
# database (public domain; Parkhurst & Appelo, USGS Techniques & Methods 6-A43,
# 2013; Pitzer data of Harvie, Møller & Weare and later work) that the
# aqueous-electrolyte property method uses: species of the elements
# Na K Ca Mg Cl S(6) C(4) H O, their association reactions, the mineral
# phases (saturation indices) and the Pitzer interaction parameters with their
# temperature functions.
#
#   python3 scripts/gen-pitzer.py <path to pitzer.dat>   (run from the repository root)
#
# writes api/_lib/mb-pitzerdata.js
# ============================================================================
import json, re, sys

src = sys.argv[1] if len(sys.argv) > 1 else 'pitzer.dat'
lines = open(src, encoding='latin-1').read().replace('\r', '').split('\n')

ELEM = {'Na', 'K', 'Ca', 'Mg', 'Cl', 'S', 'C', 'H', 'O'}
KCAL = 4.184

def strip(l):
    return l.split('#', 1)[0].rstrip()

def parse_formula(f):
    """element counts of a species/mineral formula like CaMg(CO3)2, Na2SO4:10H2O, MgOH+, CO3-2"""
    f = re.sub(r'[+-]\d*$', '', f.replace('++', '+2').replace('--', '-2'))
    out = {}
    def add(d, k):
        for e, n in d.items(): out[e] = out.get(e, 0) + n * k
    parts = f.split(':')
    for p in parts:
        m = re.match(r'^(\d*)(.*)$', p)
        mult = int(m.group(1)) if m.group(1) else 1
        add(parse_group(m.group(2)), mult)
    return out

def parse_group(s):
    out, i = {}, 0
    while i < len(s):
        if s[i] == '(':
            depth, j = 1, i + 1
            while depth:
                if s[j] == '(': depth += 1
                elif s[j] == ')': depth -= 1
                j += 1
            inner = parse_group(s[i + 1:j - 1])
            m = re.match(r'\d+', s[j:]); n = int(m.group(0)) if m else 1
            for e, c in inner.items(): out[e] = out.get(e, 0) + c * n
            i = j + (len(m.group(0)) if m else 0)
            continue
        m = re.match(r'([A-Z][a-z]?)(\d*)', s[i:])
        if not m: i += 1; continue
        out[m.group(1)] = out.get(m.group(1), 0) + (int(m.group(2)) if m.group(2) else 1)
        i += len(m.group(0))
    return out

def charge(sp):
    sp = sp.replace('++', '+2').replace('--', '-2')
    m = re.search(r'([+-])(\d*)$', sp)
    if not m: return 0
    return (1 if m.group(1) == '+' else -1) * (int(m.group(2)) if m.group(2) else 1)

def norm(sp):
    return sp.replace('++', '+2').replace('--', '-2')

def side(s):
    """'2 H+ + CO3-2' -> {species: coef}"""
    out = {}
    s = s.replace(' - ', ' + -')
    for term in re.split(r'\s\+\s', ' ' + s.strip() + ' '):
        term = term.strip()
        if not term: continue
        m = re.match(r'^(-?\d*\.?\d*)\s*(.+)$', term)
        c = m.group(1)
        coef = float(c) if c not in ('', '-') else (-1.0 if c == '-' else 1.0)
        out[norm(m.group(2).strip())] = out.get(norm(m.group(2).strip()), 0) + coef
    return out

def block(name):
    i = next(k for k, l in enumerate(lines) if l.strip() == name)
    j = i + 1
    while j < len(lines) and not re.match(r'^[A-Z_]{4,}\s*$', lines[j].strip() or 'x') : j += 1
    return lines[i + 1:j]

def logk_props(body):
    """log_k, delta_h (kJ/mol), analytic list from the indented lines of an entry"""
    p = {}
    for l in body:
        for part in strip(l).split(';'):
            t = part.strip().split()
            if not t: continue
            k = t[0].lstrip('-').lower()
            if k == 'log_k': p['logk'] = float(t[1])
            elif k == 'delta_h':
                v = float(t[1]); unit = ' '.join(t[2:]).lower()
                p['dh'] = v * KCAL if 'kcal' in unit else v
            elif k in ('analytic', 'analytical_expression', 'a_e', 'analytical'):
                p['an'] = [float(x) for x in t[1:]]
    return p

# ---- solution species ----
species = {'H2O': {'z': 0, 'el': {'H': 2, 'O': 1}}}
reactions = []      # association reactions: {sp: product, eq: {species: coef}, logk...}
body = block('SOLUTION_SPECIES')
entries = []
cur = None
for l in body:
    if not strip(l).strip(): continue
    if not l.startswith((' ', '\t')) and '=' in l:
        cur = {'eq': strip(l), 'body': []}; entries.append(cur)
    elif cur is not None:
        cur['body'].append(l)
for e in entries:
    lhs, rhs = [x.strip() for x in e['eq'].split('=')]
    L, Rr = side(lhs), side(rhs)
    allsp = list(L) + list(Rr)
    ok = True
    for sp in allsp:
        if sp in ('H2O', 'e-'): continue
        el = parse_formula(sp)
        if not set(el) <= ELEM: ok = False
    if not ok: continue
    if lhs == rhs:            # master species
        sp = norm(lhs)
        if sp == 'e-': continue
        species[sp] = {'z': charge(sp), 'el': parse_formula(sp)}
        continue
    # product: the species defined by the reaction (PHREEQC: the last-new species on the rhs, or the lhs for 'X = Y + H+' forms)
    newsp = [s for s in Rr if s not in species and s not in ('H2O', 'H+', 'OH-')]
    if not newsp: newsp = [s for s in Rr if s not in species]
    prod = newsp[0] if newsp else None
    if prod is None: continue
    species[prod] = {'z': charge(prod), 'el': parse_formula(prod)}
    p = logk_props(e['body'])
    # reaction as written lhs = rhs; store ν with products positive: Σν log a = log K
    nu = {}
    for s, c in Rr.items(): nu[s] = nu.get(s, 0) + c
    for s, c in L.items(): nu[s] = nu.get(s, 0) - c
    reactions.append({'sp': prod, 'nu': nu, **p})

# ---- phases ----
phases = []
body = block('PHASES')
cur = None
for l in body:
    sl = strip(l)
    if not sl.strip(): continue
    if not l.startswith((' ', '\t')):
        cur = {'name': sl.strip(), 'body': []}; phases.append(cur)
    elif cur is not None:
        cur['body'].append(l)
PH = []
for ph in phases:
    eqline = next((strip(l).strip() for l in ph['body'] if '=' in strip(l)), None)
    if not eqline: continue
    lhs, rhs = [x.strip() for x in eqline.split('=')]
    el = parse_formula(lhs.split()[0]) if not lhs.endswith('(g)') else {}
    R2 = side(rhs); L2 = side(lhs)
    sps = [s for s in list(R2) + list(L2) if s not in ('H2O',)]
    if any(not set(parse_formula(s)) <= ELEM for s in sps): continue
    if any(s not in species and s != lhs.split()[0] for s in R2): continue
    p = logk_props(ph['body'])
    nu = {}
    for s, c in R2.items(): nu[s] = nu.get(s, 0) + c
    for s, c in L2.items():
        if s == norm(lhs.split()[0]) and ph['name'] != 'H2O(g)': continue     # the solid / gas itself
        nu[s] = nu.get(s, 0) - c
    PH.append({'name': ph['name'], 'formula': lhs, 'nu': nu, **p})

# ---- Pitzer parameters ----
pit = {}
body = block('PITZER')
sec = None
for l in body:
    sl = strip(l).strip()
    if not sl: continue
    if sl.startswith('-'):
        sec = sl[1:].split()[0].upper(); pit.setdefault(sec, []); continue
    t = sl.split()
    nsp = 3 if sec in ('ZETA', 'PSI', 'MU', 'ETA') else 2
    sps = [norm(x) for x in t[:nsp]]
    if any(s not in species for s in sps): continue
    vals = [float(x) for x in t[nsp:]]
    pit[sec].append(sps + [vals])

used = sorted(species, key=lambda s: (species[s]['z'] == 0, s))
out = {
    'source': 'USGS PHREEQC pitzer.dat (public domain), elements Na K Ca Mg Cl S C H O',
    'species': {s: species[s] for s in used},
    'reactions': reactions, 'phases': PH, 'pitzer': pit,
}
js = ('// GENERATED by scripts/gen-pitzer.py from the USGS PHREEQC pitzer.dat database (public domain).\n'
      '// Do not edit by hand. Elements Na K Ca Mg Cl S C H O: species, association reactions,\n'
      '// mineral phases and Pitzer interaction parameters with their temperature functions.\n'
      'export const PZDATA = ' + json.dumps(out, indent=0, separators=(',', ':')) + ';\nexport default PZDATA;\n')
open('api/_lib/mb-pitzerdata.js', 'w').write(js)
print('species', len(species), 'reactions', len(reactions), 'phases', len(PH), {k: len(v) for k, v in pit.items()})
