# Requires: pip install thermo   (MIT licence)
# Export thermo's UNIFAC / Dortmund subgroup SMARTS catalogs and the Joback table to JS.
import json
from thermo.unifac import UFSG, DOUFSG
from thermo.group_contribution.joback import JOBACK_GROUPS
import thermo
def sg(d):
    out = []
    for k, g in sorted(d.items()):
        if not g.smarts or g.priority is None: continue
        out.append({'id': g.group_id, 'g': g.group, 'm': g.main_group_id, 'R': g.R, 'Q': g.Q, 's': g.smarts, 'p': g.priority,
                    'a': g.atoms or {}, 'hs': bool(g.hydrogen_from_smarts)})
    return out
jb = []
for k, g in sorted(JOBACK_GROUPS.items()):
    jb.append({'id': k, 'g': g.group, 's': g.smarts, 'Tc': g.Tc, 'Pc': g.Pc, 'Vc': g.Vc, 'Tb': g.Tb, 'Tm': g.Tm, 'Hf': g.Hform, 'Gf': g.Gform,
               'Cpa': g.Cpa, 'Cpb': g.Cpb, 'Cpc': g.Cpc, 'Cpd': g.Cpd, 'Hfus': g.Hfus, 'Hvap': g.Hvap, 'mua': g.mua, 'mub': g.mub})
uf, do = sg(UFSG), sg(DOUFSG)
hdr = f"""// ============================================================================
// REPO PATH: api/_lib/mb-groups.js
// ============================================================================
// multicalci.com — GENERATED from the thermo library (v{thermo.__version__}, MIT
// licence, Copyright (c) 2016–2025 Caleb Bell and contributors) by
// scripts/gen-groups.py. Do not edit by hand.
//   UNIFAC  — original UNIFAC subgroups (Hansen et al. 1991; R, Q) with the
//             SMARTS patterns and fragmentation priorities of thermo.unifac
//   DORTMUND — modified UNIFAC (Dortmund) subgroups (Constantinescu & Gmehling
//             2016; R, Q) with the same
//   JOBACK  — Joback & Reid (1987) group contributions (Tc, Pc, Vc, Tb, Tm,
//             ΔHf, ΔGf, ideal-gas Cp a–d, ΔHfus, ΔHvap, liquid viscosity a, b)
//             with the SMARTS of J. Biggs (RDKit mailing list, 2017)
// Server-side only (api/_lib).
// The MIT licence: Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including without
// limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom
// the Software is furnished to do so, subject to the following conditions: The
// above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS
// IS", WITHOUT WARRANTY OF ANY KIND.
// ============================================================================
"""
js = hdr + "export const UNIFAC_SG = " + json.dumps(uf, ensure_ascii=False) + ";\n" \
     + "export const DORTMUND_SG = " + json.dumps(do, ensure_ascii=False) + ";\n" \
     + "export const JOBACK = " + json.dumps(jb, ensure_ascii=False) + ";\n" \
     + "export default { UNIFAC_SG, DORTMUND_SG, JOBACK };\n"
print(len(uf), len(do), len(jb), len(js))

# ---- full UNIFAC / Dortmund subgroup and interaction tables (STEP 37) ----
import thermo.unifac as u
def subs(d):
    return {str(k): [g.main_group_id, g.R, g.Q, g.group] for k, g in sorted(d.items()) if g.R is not None and g.Q is not None}
UA = {}
for m, row in u.UFIP.items():
    for n, a in row.items(): UA[f'{m}|{n}'] = a
DA = {}
for m, row in u.DOUFIP2016.items():
    for n, abc in row.items(): DA[f'{m}|{n}'] = list(abc)
extra = "export const UNIFAC_SUB_ALL = " + json.dumps(subs(UFSG), ensure_ascii=False) + ";\n" \
      + "export const UNIFAC_A_ALL = " + json.dumps(UA) + ";\n" \
      + "export const DORTMUND_SUB_ALL = " + json.dumps(subs(DOUFSG), ensure_ascii=False) + ";\n" \
      + "export const DORTMUND_A_ALL = " + json.dumps(DA) + ";\n"
js = js.replace("export default { UNIFAC_SG, DORTMUND_SG, JOBACK };\n", extra + "export default { UNIFAC_SG, DORTMUND_SG, JOBACK, UNIFAC_SUB_ALL, UNIFAC_A_ALL, DORTMUND_SUB_ALL, DORTMUND_A_ALL };\n")
js = js.replace("//             with the SMARTS of J. Biggs (RDKit mailing list, 2017)\n", "//             with the SMARTS of J. Biggs (RDKit mailing list, 2017)\n//   *_ALL   — the complete UNIFAC (UFSG, UFIP) and Dortmund 2016 (DOUFSG,\n//             DOUFIP2016) subgroup and main-group interaction tables\n")
# run from the repository root:  python3 scripts/gen-groups.py
open('api/_lib/mb-groups.js', 'w').write(js)
print('full', len(UA), len(DA), len(js))
