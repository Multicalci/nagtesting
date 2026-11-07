// ============================================================================
// mb-chem.js — STEP 37: molecules from SMILES, SMARTS substructure search and
// group fragmentation (UNIFAC, modified UNIFAC (Dortmund), Joback).
//
//   parseSmiles(smi)      → molecule graph: heavy atoms (element, aromatic,
//                           charge, hydrogens), bonds (1, 2, 3, aromatic 1.5),
//                           ring membership and aromaticity perceived from a
//                           Kekulé or aromatic SMILES (Hückel 4n+2 on 5–7
//                           rings, fused rings in a second pass)
//   formula(mol), molarMass(mol)
//   compileSmarts(s) / matchSmarts(pattern, mol) — the SMARTS subset used by
//                           the group catalogs: element / #n / * / a / A,
//                           H<n>, D<n>, X<n>, R / R<n> / r<n>, v<n>, charges,
//                           recursive $(…), logic ! & , ; and bond - = # : ~ @
//                           (matches are unique atom sets, like RDKit's)
//   fragmentPriority(catalog, mol) — groups by priority with a bounded search
//                           over dropped matches (the algorithm of thermo's
//                           smarts_fragment_priority, MIT) → UNIFAC, Dortmund
//   fragmentSimple(catalog, mol)   — all matches with overlap removal
//                           (thermo's smarts_fragment) → Joback
//
// Plain ES module, no dependencies. Server-side only. (c) multicalci.com
// ============================================================================

export const CHEM_VERSION = 'mb-chem 1.0.0';
class ChemError extends Error { constructor(message) { super(message); this.code = 'MB_SMILES'; this.field = 'smiles'; } }
const fail = (m) => { throw new ChemError(m); };

// standard atomic weights (IUPAC 2021, conventional values)
export const ATOMIC_MASS = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.180,
  Na: 22.990, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.95, K: 39.098, Ca: 40.078,
  Ti: 47.867, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ge: 72.630, As: 74.922,
  Se: 78.971, Br: 79.904, Kr: 83.798, Sn: 118.71, Sb: 121.76, Te: 127.60, I: 126.90, Xe: 131.29, Hg: 200.59, Pb: 207.2,
};
const ANUM = { H: 1, He: 2, Li: 3, Be: 4, B: 5, C: 6, N: 7, O: 8, F: 9, Ne: 10, Na: 11, Mg: 12, Al: 13, Si: 14, P: 15, S: 16, Cl: 17, Ar: 18,
  K: 19, Ca: 20, Ti: 22, Cr: 24, Mn: 25, Fe: 26, Co: 27, Ni: 28, Cu: 29, Zn: 30, Ge: 32, As: 33, Se: 34, Br: 35, Kr: 36, Sn: 50, Sb: 51,
  Te: 52, I: 53, Xe: 54, Hg: 80, Pb: 82 };
const VALENCE = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1] };
const TWO = ['Cl', 'Br', 'Si', 'Se', 'Na', 'Li', 'Mg', 'Al', 'Ca', 'He', 'Ne', 'Ar', 'Kr', 'Xe', 'Be', 'Ge', 'As', 'Sn', 'Sb', 'Te', 'Ti', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Hg', 'Pb'];
const AROM_SYM = { b: 'B', c: 'C', n: 'N', o: 'O', p: 'P', s: 'S', se: 'Se', as: 'As' };

// ---------------------------------------------------------------------------
// SMILES
// ---------------------------------------------------------------------------
/**
 * Parse one molecule. Explicit hydrogens in brackets are folded into their
 * heavy atom; stereo marks are ignored.
 * @returns {{atoms:Array, bonds:Array, nb:Array, smiles:string}}
 */
export function parseSmiles(smiles) {
  const s = String(smiles == null ? '' : smiles).trim();
  if (!s) fail('give a SMILES string');
  if (s.length > 400) fail('the SMILES is longer than 400 characters');
  if (s.includes('.')) fail('one molecule only — the SMILES has more than one part (".")');
  const atoms = [], bonds = [];
  const bondKey = new Set();
  let prev = -1, pend = null;
  const stack = [], ring = new Map();
  const addBond = (a, b, sym) => {
    if (a === b) fail('a ring closure joins an atom to itself');
    const k = Math.min(a, b) + '-' + Math.max(a, b);
    if (bondKey.has(k)) fail('two bonds between the same atoms');
    bondKey.add(k);
    let order;
    if (sym === '=') order = 2; else if (sym === '#') order = 3; else if (sym === '$') order = 4; else if (sym === ':') order = 1.5;
    else if (sym === '-' || sym === '/' || sym === '\\') order = 1;
    else order = atoms[a].arom && atoms[b].arom ? 1.5 : 1;
    bonds.push({ a, b, order, ring: false });
  };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') { if (prev < 0) fail('a branch opens before any atom'); stack.push(prev); i++; continue; }
    if (ch === ')') { if (!stack.length) fail('unbalanced “)”'); prev = stack.pop(); pend = null; i++; continue; }
    if ('-=#$:/\\'.includes(ch)) { pend = ch; i++; continue; }
    if (/[0-9%]/.test(ch)) {
      let n, len = 1;
      if (ch === '%') { n = s.substr(i + 1, 2); len = 3; if (!/^\d\d$/.test(n)) fail('ring closure “%” needs two digits'); } else n = ch;
      if (prev < 0) fail('a ring closure before any atom');
      if (ring.has(n)) { const o = ring.get(n); ring.delete(n); addBond(o.atom, prev, pend || o.bond); }
      else ring.set(n, { atom: prev, bond: pend });
      pend = null; i += len; continue;
    }
    let atom;
    if (ch === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) fail('unclosed “[”');
      atom = bracketAtom(s.slice(i + 1, j));
      i = j + 1;
    } else {
      let sym = null;
      if (s.startsWith('Cl', i) || s.startsWith('Br', i)) { sym = s.substr(i, 2); i += 2; }
      else if ('BCNOPSFI'.includes(ch)) { sym = ch; i++; }
      else if ('bcnops'.includes(ch)) { sym = ch; i++; }
      else if (ch === '*') fail('wildcard atoms “*” are not allowed — draw the whole molecule');
      else fail(`unexpected “${ch}” at position ${i + 1}`);
      const arom = sym === sym.toLowerCase();
      atom = { el: arom ? AROM_SYM[sym] : sym, arom, charge: 0, hExp: null, bracket: false };
    }
    atoms.push(atom);
    const idx = atoms.length - 1;
    if (prev >= 0) addBond(prev, idx, pend);
    pend = null;
    prev = idx;
  }
  if (ring.size) fail('a ring is opened but never closed');
  if (stack.length) fail('a branch “(” is never closed');
  if (!atoms.length) fail('no atoms');
  // fold bracket hydrogen atoms ([H]) attached to heavy atoms into their H count
  const keep = atoms.map((a, k) => !(a.el === 'H' && a.bracket && atoms.length > 2 && bonds.filter((b) => b.a === k || b.b === k).length === 1));
  if (keep.some((v) => !v)) {
    const map = []; let n = 0;
    atoms.forEach((a, k) => { map[k] = keep[k] ? n++ : -1; });
    for (const b of bonds) {
      if (!keep[b.a]) { atoms[b.b].hExp = (atoms[b.b].hExp || 0) + 1; atoms[b.b].bracket = true; }
      if (!keep[b.b]) { atoms[b.a].hExp = (atoms[b.a].hExp || 0) + 1; atoms[b.a].bracket = true; }
    }
    const nb = bonds.filter((b) => keep[b.a] && keep[b.b]).map((b) => ({ a: map[b.a], b: map[b.b], order: b.order, ring: false }));
    const na = atoms.filter((_a, k) => keep[k]);
    atoms.length = 0; atoms.push(...na);
    bonds.length = 0; bonds.push(...nb);
  }
  const mol = { atoms, bonds, smiles: s };
  buildAdjacency(mol);
  normaliseNitro(mol);
  implicitH(mol);
  perceiveRings(mol);
  perceiveAromaticity(mol);
  return mol;
}
function bracketAtom(t) {
  const m = /^(\d+)?([A-Z][a-z]?|se|as|[bcnops])(@{1,2}(?:TH\d|AL\d|SP\d|TB\d+|OH\d+)?)?(H\d*)?([+-]+\d*)?(:\d+)?$/.exec(t);
  if (!m) fail(`cannot read the bracket atom [${t}]`);
  let sym = m[2];
  const arom = sym === sym.toLowerCase();
  const el = arom ? AROM_SYM[sym] : sym;
  if (!arom && !ANUM[el]) fail(`unknown element ${sym}`);
  let h = 0;
  if (m[4]) h = m[4].length > 1 ? parseInt(m[4].slice(1), 10) : 1;
  let charge = 0;
  if (m[5]) {
    const sign = m[5][0] === '+' ? 1 : -1;
    const digits = m[5].replace(/[+-]/g, '');
    charge = sign * (digits ? parseInt(digits, 10) : m[5].length);
  }
  return { el, arom, charge, hExp: h, bracket: true, isotope: m[1] ? +m[1] : null };
}
function buildAdjacency(mol) {
  mol.nb = mol.atoms.map(() => []);
  mol.bonds.forEach((b, k) => { mol.nb[b.a].push({ to: b.b, bond: k }); mol.nb[b.b].push({ to: b.a, bond: k }); });
}
/** pentavalent nitro / N-oxide written N(=O)=O → charge-separated [N+](=O)[O-], as RDKit sanitises it */
function normaliseNitro(mol) {
  mol.atoms.forEach((a, k) => {
    if (a.el !== 'N' || a.arom || a.charge !== 0) return;
    const bs = mol.nb[k].map((n) => ({ n, b: mol.bonds[n.bond] }));
    const sum = bs.reduce((x, q) => x + q.b.order, 0) + (a.bracket ? a.hExp || 0 : 0);
    if (sum !== 5) return;
    const o = bs.find((q) => q.b.order === 2 && mol.atoms[q.n.to].el === 'O' && mol.nb[q.n.to].length === 1);
    if (!o) return;
    o.b.order = 1; a.charge = 1; mol.atoms[o.n.to].charge = -1;
    if (!a.bracket) { a.bracket = true; a.hExp = 0; }
    const oa = mol.atoms[o.n.to]; if (!oa.bracket) { oa.bracket = true; oa.hExp = 0; }
  });
}
function implicitH(mol) {
  mol.atoms.forEach((a, k) => {
    if (a.bracket) { a.h = a.hExp || 0; return; }
    const bs = mol.nb[k].map((n) => mol.bonds[n.bond]);
    if (a.arom) {
      const nAr = bs.filter((b) => b.order === 1.5).length;
      const other = bs.filter((b) => b.order !== 1.5).reduce((x, b) => x + b.order, 0);
      const v = (VALENCE[a.el] || [0])[0];
      const pi = a.el === 'C' || a.el === 'B' ? 1 : a.el === 'N' || a.el === 'P' ? (nAr + other >= 3 ? 0 : 1) : 0;
      a.h = Math.max(0, v - nAr - other - pi);
      return;
    }
    const sum = bs.reduce((x, b) => x + b.order, 0);
    const vs = VALENCE[a.el];
    if (!vs) { a.h = 0; return; }
    const v = vs.find((q) => q >= sum);
    a.h = v === undefined ? 0 : v - sum;
  });
}
/** ring bonds (non-bridges), rings as the shortest cycle through each ring bond */
function perceiveRings(mol) {
  const n = mol.atoms.length;
  const disc = new Array(n).fill(-1), low = new Array(n).fill(0);
  let t = 0;
  const bridge = new Set();
  const dfs = (u, pb) => {
    disc[u] = low[u] = t++;
    for (const { to, bond } of mol.nb[u]) {
      if (bond === pb) continue;
      if (disc[to] < 0) { dfs(to, bond); low[u] = Math.min(low[u], low[to]); if (low[to] > disc[u]) bridge.add(bond); }
      else low[u] = Math.min(low[u], disc[to]);
    }
  };
  for (let u = 0; u < n; u++) if (disc[u] < 0) dfs(u, -1);
  mol.bonds.forEach((b, k) => { b.ring = !bridge.has(k); });
  const rings = [], seen = new Set();
  mol.bonds.forEach((b, k) => {
    if (!b.ring) return;
    // BFS from b.a to b.b without bond k
    const prevA = new Array(n).fill(-1); prevA[b.a] = b.a;
    const q = [b.a];
    while (q.length) {
      const u = q.shift();
      if (u === b.b) break;
      for (const { to, bond } of mol.nb[u]) if (bond !== k && prevA[to] < 0 && mol.bonds[bond].ring) { prevA[to] = u; q.push(to); }
    }
    if (prevA[b.b] < 0) return;
    const cyc = []; let u = b.b;
    while (u !== b.a) { cyc.push(u); u = prevA[u]; }
    cyc.push(b.a);
    const key = cyc.slice().sort((x, y) => x - y).join(',');
    if (!seen.has(key)) { seen.add(key); rings.push(cyc); }
  });
  mol.rings = rings;
  mol.atoms.forEach((a, k) => {
    a.ringCount = rings.filter((r) => r.includes(k)).length;
    a.inRing = mol.nb[k].some((x) => mol.bonds[x.bond].ring);
    a.ringSizes = rings.filter((r) => r.includes(k)).map((r) => r.length);
  });
}
function bondBetween(mol, a, b) { const x = mol.nb[a].find((q) => q.to === b); return x ? mol.bonds[x.bond] : null; }
/** Hückel aromaticity on 5–7 membered rings (Kekulé input), fused rings in a second pass */
function perceiveAromaticity(mol) {
  const A = mol.atoms;
  const arRing = new Set();
  const piOf = (k, ring, inAromatic) => {
    const a = A[k];
    if (!['C', 'N', 'O', 'S', 'P', 'B', 'Se'].includes(a.el)) return -1;
    if (a.arom) {                                     // written aromatic
      if (a.el === 'C' || a.el === 'B') return a.charge < 0 ? 2 : 1;
      if (a.el === 'N' || a.el === 'P') return (a.h > 0 || mol.nb[k].length >= 3) && a.charge === 0 ? 2 : 1;
      return 2;
    }
    let dbl = null, dblBond = -1;
    for (const { to, bond } of mol.nb[k]) if (mol.bonds[bond].order === 2) { dbl = to; dblBond = bond; break; }
    if (dbl !== null) {
      if (ring.includes(dbl)) return 1;
      if (inAromatic && inAromatic(dbl, k)) return 1;
      // a C=C belonging to another ring of the same fused system gives one electron (biphenylene, as RDKit)
      if (mol.bonds[dblBond].ring && a.el === 'C' && A[dbl].el === 'C') return 1;
      // exocyclic double bond: to O, N or S it gives no π electron (2-pyridone, coumarin); to C it breaks the ring
      return a.el === 'C' && ['O', 'N', 'S'].includes(A[dbl].el) && !A[dbl].inRing ? 0 : -1;
    }
    const deg = mol.nb[k].length + a.h;
    if (a.el === 'N' && a.charge === 0 && deg === 3) return 2;
    if ((a.el === 'O' || a.el === 'S' || a.el === 'Se') && a.charge === 0 && deg === 2) return 2;
    if (a.el === 'C' && a.charge === -1) return 2;
    return -1;
  };
  const tryRing = (ring, inAromatic) => {
    if (ring.length < 5 || ring.length > 7) return false;
    let pi = 0;
    for (const k of ring) { const p = piOf(k, ring, inAromatic); if (p < 0) return false; pi += p; }
    return pi % 4 === 2;
  };
  const rings = mol.rings;
  rings.forEach((r, i) => { if (r.every((k) => A[k].arom)) arRing.add(i); else if (tryRing(r, null)) arRing.add(i); });
  // fused rings: a double bond into an atom of an aromatic ring counts
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const arAtoms = new Set(); for (const i of arRing) for (const k of rings[i]) arAtoms.add(k);
    rings.forEach((r, i) => {
      if (arRing.has(i)) return;
      if (r.filter((k) => arAtoms.has(k)).length < 2) return;
      if (tryRing(r, (to) => arAtoms.has(to))) { arRing.add(i); changed = true; }
    });
    if (!changed) break;
  }
  const arAtoms = new Set(); for (const i of arRing) for (const k of rings[i]) arAtoms.add(k);
  for (const k of arAtoms) A[k].arom = true;
  for (const i of arRing) {
    const r = rings[i];
    for (let j = 0; j < r.length; j++) { const b = bondBetween(mol, r[j], r[(j + 1) % r.length]); if (b) b.order = 1.5; }
  }
  // a lone aromatic atom outside any perceived ring (bad input) keeps its flag only if bonded aromatically
  A.forEach((a, k) => { if (a.arom && !mol.nb[k].some((x) => mol.bonds[x.bond].order === 1.5)) a.arom = false; });
}

/** element counts (hydrogens included) */
export function formula(mol) {
  const f = {};
  for (const a of mol.atoms) { f[a.el] = (f[a.el] || 0) + 1; if (a.h) f.H = (f.H || 0) + a.h; }
  return f;
}
/** Hill formula string */
export function hillFormula(f) {
  const ks = Object.keys(f);
  const order = f.C ? ['C', 'H', ...ks.filter((k) => k !== 'C' && k !== 'H').sort()] : ks.sort();
  return order.filter((k) => f[k]).map((k) => k + (f[k] > 1 ? f[k] : '')).join('');
}
export function molarMass(mol) {
  const f = formula(mol);
  let m = 0;
  for (const [el, n] of Object.entries(f)) { if (!ATOMIC_MASS[el]) fail(`no atomic mass for ${el}`); m += ATOMIC_MASS[el] * n; }
  return m;
}

// ---------------------------------------------------------------------------
// SMARTS
// ---------------------------------------------------------------------------
const SM_CACHE = new Map();
/**
 * Compile a SMARTS pattern into {atoms:[{expr}], bonds:[{a, b, expr}]}.
 */
export function compileSmarts(src) {
  if (SM_CACHE.has(src)) return SM_CACHE.get(src);
  const s = String(src);
  const atoms = [], bonds = [];
  let prev = -1, pend = null, i = 0;
  const stack = [], ring = new Map();
  const bondExpr = () => {
    // read a bond expression at i (may be empty)
    let j = i;
    while (j < s.length && '-=#:~@!&,;/\\'.includes(s[j])) j++;
    const txt = s.slice(i, j); i = j;
    return txt ? parseBondExpr(txt) : null;
  };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') { stack.push(prev); i++; continue; }
    if (ch === ')') { prev = stack.pop(); i++; continue; }
    if ('-=#:~@!&,;/\\'.includes(ch)) { pend = bondExpr(); continue; }
    if (/[0-9%]/.test(ch)) {
      let n, len = 1;
      if (ch === '%') { n = s.substr(i + 1, 2); len = 3; } else n = ch;
      if (ring.has(n)) { const o = ring.get(n); ring.delete(n); bonds.push({ a: o.atom, b: prev, expr: pend || o.bond || null }); }
      else ring.set(n, { atom: prev, bond: pend });
      pend = null; i += len; continue;
    }
    let expr;
    if (ch === '[') {
      let depth = 0, j = i;
      for (; j < s.length; j++) { if (s[j] === '[') depth++; else if (s[j] === ']') { depth--; if (depth === 0) break; } }
      expr = parseAtomExpr(s.slice(i + 1, j));
      i = j + 1;
    } else if (s.startsWith('Cl', i) || s.startsWith('Br', i)) { expr = { t: 'el', el: s.substr(i, 2), arom: false }; i += 2; }
    else if ('BCNOPSFI'.includes(ch)) { expr = { t: 'el', el: ch, arom: false }; i++; }
    else if ('cnops'.includes(ch)) { expr = { t: 'el', el: AROM_SYM[ch], arom: true }; i++; }
    else if (ch === '*') { expr = { t: 'any' }; i++; }
    else if (ch === 'a') { expr = { t: 'arom', v: true }; i++; }
    else if (ch === 'A') { expr = { t: 'arom', v: false }; i++; }
    else throw new Error(`SMARTS ${s}: unexpected ${ch}`);
    atoms.push({ expr });
    const idx = atoms.length - 1;
    if (prev >= 0) bonds.push({ a: prev, b: idx, expr: pend });
    pend = null; prev = idx;
  }
  const p = { src: s, atoms, bonds, nb: atoms.map(() => []) };
  bonds.forEach((b, k) => { p.nb[b.a].push({ to: b.b, bond: k }); p.nb[b.b].push({ to: b.a, bond: k }); });
  SM_CACHE.set(src, p);
  return p;
}
function parseAtomExpr(txt) {
  let i = 0;
  const peek = () => txt[i];
  const low = () => { const parts = [orE()]; while (peek() === ';') { i++; parts.push(orE()); } return parts.length > 1 ? { t: 'and', p: parts } : parts[0]; };
  const orE = () => { const parts = [hiAnd()]; while (peek() === ',') { i++; parts.push(hiAnd()); } return parts.length > 1 ? { t: 'or', p: parts } : parts[0]; };
  const hiAnd = () => {
    const parts = [unary()];
    while (i < txt.length && ![';', ','].includes(peek())) { if (peek() === '&') i++; parts.push(unary()); }
    return parts.length > 1 ? { t: 'and', p: parts } : parts[0];
  };
  const digits = () => { let j = i; while (j < txt.length && /\d/.test(txt[j])) j++; const v = j > i ? parseInt(txt.slice(i, j), 10) : null; i = j; return v; };
  const unary = () => {
    if (peek() === '!') { i++; return { t: 'not', p: unary() }; }
    const c = peek();
    if (c === '$' && txt[i + 1] === '(') {
      let depth = 0, j = i + 1;
      for (; j < txt.length; j++) { if (txt[j] === '(') depth++; else if (txt[j] === ')') { depth--; if (depth === 0) break; } }
      const inner = txt.slice(i + 2, j);
      i = j + 1;
      return { t: 'rec', p: compileSmarts(inner) };
    }
    if (c === '#') { i++; return { t: 'anum', v: digits() }; }
    if (c === '*') { i++; return { t: 'any' }; }
    if (c === '+' || c === '-') {
      let n = 0; const sign = c === '+' ? 1 : -1;
      while (peek() === c) { n++; i++; }
      const d = digits();
      return { t: 'charge', v: sign * (d !== null ? d : n) };
    }
    if (c === '@') { while (peek() === '@') i++; return { t: 'any' }; }
    // two-letter elements first
    const two = txt.substr(i, 2);
    if (TWO.includes(two)) { i += 2; return { t: 'el', el: two, arom: false }; }
    if (two === 'se') { i += 2; return { t: 'el', el: 'Se', arom: true }; }
    if (c === 'H') { i++; const d = digits(); return { t: 'H', v: d === null ? 1 : d }; }
    if (c === 'D') { i++; const d = digits(); return { t: 'D', v: d === null ? 1 : d }; }
    if (c === 'X') { i++; const d = digits(); return { t: 'X', v: d === null ? 1 : d }; }
    if (c === 'R') { i++; const d = digits(); return d === null ? { t: 'ring' } : { t: 'R', v: d }; }
    if (c === 'r') { i++; const d = digits(); return d === null ? { t: 'ring' } : { t: 'r', v: d }; }
    if (c === 'v') { i++; const d = digits(); return { t: 'v', v: d === null ? 1 : d }; }
    if (c === 'x') { i++; const d = digits(); return { t: 'x', v: d === null ? 1 : d }; }
    if (c === 'a') { i++; return { t: 'arom', v: true }; }
    if (c === 'A') { i++; return { t: 'arom', v: false }; }
    if ('BCNOPSFIK'.includes(c)) { i++; return { t: 'el', el: c, arom: false }; }
    if ('bcnops'.includes(c)) { i++; return { t: 'el', el: AROM_SYM[c], arom: true }; }
    throw new Error(`SMARTS atom [${txt}]: cannot read “${txt.slice(i)}”`);
  };
  const e = low();
  if (i < txt.length) throw new Error(`SMARTS atom [${txt}]: trailing “${txt.slice(i)}”`);
  return e;
}
function parseBondExpr(txt) {
  let i = 0;
  const peek = () => txt[i];
  const low = () => { const p = [orE()]; while (peek() === ';') { i++; p.push(orE()); } return p.length > 1 ? { t: 'and', p } : p[0]; };
  const orE = () => { const p = [hi()]; while (peek() === ',') { i++; p.push(hi()); } return p.length > 1 ? { t: 'or', p } : p[0]; };
  const hi = () => { const p = [un()]; while (i < txt.length && ![';', ','].includes(peek())) { if (peek() === '&') i++; p.push(un()); } return p.length > 1 ? { t: 'and', p } : p[0]; };
  const un = () => {
    const c = txt[i++];
    if (c === '!') return { t: 'not', p: un() };
    if (c === '-' || c === '/' || c === '\\') return { t: 'single' };
    if (c === '=') return { t: 'double' };
    if (c === '#') return { t: 'triple' };
    if (c === ':') return { t: 'aromatic' };
    if (c === '~') return { t: 'anyb' };
    if (c === '@') return { t: 'ringb' };
    throw new Error(`SMARTS bond ${txt}`);
  };
  return low();
}
function bondOk(e, b) {
  if (!e) return b.order === 1 || b.order === 1.5;            // default: single or aromatic
  switch (e.t) {
    case 'single': return b.order === 1;
    case 'double': return b.order === 2;
    case 'triple': return b.order === 3;
    case 'aromatic': return b.order === 1.5;
    case 'anyb': return true;
    case 'ringb': return b.ring;
    case 'not': return !bondOk(e.p, b);
    case 'and': return e.p.every((x) => bondOk(x, b));
    case 'or': return e.p.some((x) => bondOk(x, b));
    default: return false;
  }
}
function atomOk(e, mol, k, memo) {
  const a = mol.atoms[k];
  switch (e.t) {
    case 'any': return true;
    case 'el': return a.el === e.el && a.arom === e.arom;
    case 'anum': return ANUM[a.el] === e.v;
    case 'arom': return a.arom === e.v;
    case 'H': return a.h === e.v;
    case 'D': return mol.nb[k].length === e.v;
    case 'X': return mol.nb[k].length + a.h === e.v;
    case 'ring': return a.inRing;
    case 'R': return e.v === 0 ? !a.inRing : a.ringCount === e.v;
    case 'r': return e.v === 0 ? !a.inRing : a.ringSizes.length > 0 && Math.min(...a.ringSizes) === e.v;
    case 'x': return mol.nb[k].filter((q) => mol.bonds[q.bond].ring).length === e.v;
    case 'v': { let v = a.h; for (const q of mol.nb[k]) v += mol.bonds[q.bond].order; return Math.round(v) === e.v; }
    case 'charge': return a.charge === e.v;
    case 'not': return !atomOk(e.p, mol, k, memo);
    case 'and': return e.p.every((x) => atomOk(x, mol, k, memo));
    case 'or': return e.p.some((x) => atomOk(x, mol, k, memo));
    case 'rec': {
      const key = e.p.src + '@' + k;
      if (memo.has(key)) return memo.get(key);
      memo.set(key, false);
      const ok = searchMatches(e.p, mol, memo, k, true).length > 0;
      memo.set(key, ok);
      return ok;
    }
    default: return false;
  }
}
/** all matches of a compiled pattern (arrays of molecule atom indices, pattern order) */
function searchMatches(p, mol, memo, anchor, firstOnly) {
  const n = p.atoms.length, out = [];
  const map = new Array(n).fill(-1);
  const used = new Set();
  // order: parse order (each atom after the first is bonded to an earlier one)
  const step = (j) => {
    if (firstOnly && out.length) return;
    if (j === n) { out.push(map.slice()); return; }
    const cands = j === 0 ? (anchor !== undefined ? [anchor] : mol.atoms.map((_a, k) => k)) : null;
    let list = cands;
    if (!list) {
      // neighbours of a mapped pattern neighbour
      const pn = p.nb[j].find((q) => q.to < j);
      list = pn ? mol.nb[map[pn.to]].map((q) => q.to) : mol.atoms.map((_a, k) => k);
    }
    for (const m of list) {
      if (used.has(m)) continue;
      if (!atomOk(p.atoms[j].expr, mol, m, memo)) continue;
      let ok = true;
      for (const q of p.nb[j]) {
        if (q.to >= j) continue;
        const mb = bondBetween(mol, map[q.to], m);
        if (!mb || !bondOk(p.bonds[q.bond].expr, mb)) { ok = false; break; }
      }
      if (!ok) continue;
      map[j] = m; used.add(m);
      step(j + 1);
      used.delete(m); map[j] = -1;
      if (firstOnly && out.length) return;
    }
  };
  step(0);
  return out;
}
/** unique matches (by atom set), RDKit-style */
export function matchSmarts(pattern, mol) {
  const p = typeof pattern === 'string' ? compileSmarts(pattern) : pattern;
  const memo = new Map();
  const all = searchMatches(p, mol, memo);
  const seen = new Set(), out = [];
  for (const m of all) { const key = m.slice().sort((x, y) => x - y).join(','); if (!seen.has(key)) { seen.add(key); out.push(m); } }
  return out;
}

// ---------------------------------------------------------------------------
// fragmentation
// ---------------------------------------------------------------------------
/**
 * Priority fragmentation (UNIFAC-type catalogs): groups claimed in falling
 * priority without overlap; if the heavy atoms or the hydrogens are not all
 * accounted for, retry with up to four matches (or whole groups) dropped.
 * @param {Array<{id, s, p, a, hs}>} catalog  s: SMARTS or list, p: priority, a: atom counts, hs: H from the molecule
 * @returns {{counts:Object, success:boolean, status:string}}
 */
export function fragmentPriority(catalog, mol) {
  const n = mol.atoms.length;
  const Hc = mol.atoms.reduce((x, a) => x + a.h, 0);
  const all = new Map();
  for (const g of catalog) {
    const pats = Array.isArray(g.s) ? g.s : [g.s];
    const hits = [], seen = new Set();
    for (const s of pats) for (const m of matchSmarts(s, mol)) { const key = m.slice().sort((x, y) => x - y).join(','); if (!seen.has(key)) { seen.add(key); hits.push(m); } }
    if (hits.length) all.set(g.id, hits);
  }
  const byPri = catalog.slice().sort((x, y) => (y.p - x.p) || (y.id - x.id));
  const obj = new Map(catalog.map((g) => [g.id, g]));
  const covered = new Set(); for (const v of all.values()) for (const m of v) for (const k of m) covered.add(k);
  const run = (ignore) => {
    const matched = new Set(), counts = {}, assign = {};
    for (const g of byPri) {
      const hits = all.get(g.id);
      if (!hits) continue;
      for (const m of hits) {
        if (m.some((k) => matched.has(k))) continue;
        if (m.length === n && Hc && (g.a.H || 0) !== Hc) continue;
        if (ignore.has(g.id + '|' + m.join(','))) continue;
        for (const k of m) matched.add(k);
        counts[g.id] = (counts[g.id] || 0) + 1;
        (assign[g.id] = assign[g.id] || []).push(m);
      }
    }
    let hFound = 0;
    for (const [id, ms] of Object.entries(assign)) {
      const g = obj.get(+id);
      for (const m of ms) hFound += g.hs ? m.reduce((x, k) => x + mol.atoms[k].h, 0) : (g.a.H || 0);
    }
    return { counts, ok: matched.size === n && hFound === Hc };
  };
  if (covered.size !== n) { const r = run(new Set()); return { counts: r.counts, success: false, status: 'some atoms belong to no group' }; }
  let r = run(new Set());
  if (r.ok) return { counts: r.counts, success: true, status: 'OK' };
  // bounded search over dropped matches
  const things = [];
  for (const [id, ms] of all) for (const m of ms) things.push([id, m]);
  const units = [];
  const byG = new Map();
  for (const [id, m] of things) { if (!byG.has(id)) byG.set(id, []); byG.get(id).push(id + '|' + m.join(',')); }
  for (const [, ks] of byG) units.push(ks.length > 1 ? ks : [ks[0]]);
  for (const [, ks] of byG) if (ks.length > 1) for (const k of ks) units.push([k]);
  let tries = 0;
  const combos = function* (k, start, acc) {
    if (acc.length === k) { yield acc; return; }
    for (let j = start; j < units.length; j++) yield* combos(k, j + 1, acc.concat([j]));
  };
  for (let k = 1; k <= Math.min(4, units.length); k++) {
    for (const c of combos(k, 0, [])) {
      if (++tries > 5000) return { counts: r.counts, success: false, status: 'no complete assignment found' };
      const ign = new Set(); for (const j of c) for (const x of units[j]) ign.add(x);
      const t = run(ign);
      if (t.ok) return { counts: t.counts, success: true, status: 'OK' };
    }
  }
  return { counts: r.counts, success: false, status: 'no complete assignment found' };
}
/**
 * Simple fragmentation (Joback): every match of every group, overlaps resolved
 * in favour of the larger group.
 */
export function fragmentSimple(catalog, mol) {
  const n = mol.atoms.length;
  const all = new Map();
  for (const g of catalog) { const hits = matchSmarts(g.s, mol); if (hits.length) all.set(g.id, hits); }
  const atomUse = () => { const c = new Map(); for (const v of all.values()) for (const m of v) for (const k of m) c.set(k, (c.get(k) || 0) + 1); return c; };
  for (let it = 0; it < 100; it++) {
    const use = atomUse();
    const dup = [...use.entries()].find(([, c]) => c > 1);
    if (!dup) break;
    const at = dup[0];
    const hold = [];
    for (const [id, v] of all) v.forEach((m, j) => { if (m.includes(at)) hold.push([id, j, m.length]); });
    const mx = Math.max(...hold.map((h) => h[2]));
    if (hold.filter((h) => h[2] === mx).length > 1) break;
    for (const [id, j, size] of hold.slice().sort((x, y) => y[1] - x[1])) if (size !== mx) all.get(id).splice(j, 1);
    for (const [id, v] of [...all]) if (!v.length) all.delete(id);
  }
  const counts = {};
  for (const [id, v] of all) counts[id] = v.length;
  const use = atomUse();
  let status = 'OK', success = true;
  if (use.size !== n) { success = false; status = 'some atoms belong to no group'; }
  else if ([...use.values()].some((c) => c > 1)) { success = false; status = 'some atoms are in two groups'; }
  return { counts, success, status };
}

export default { CHEM_VERSION, ATOMIC_MASS, parseSmiles, formula, hillFormula, molarMass, compileSmarts, matchSmarts, fragmentPriority, fragmentSimple };
