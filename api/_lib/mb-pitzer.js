// ============================================================================
// REPO PATH: api/_lib/mb-pitzer.js
// ============================================================================
// multicalci.com — STEP 38 generic Pitzer (Harvie–Møller–Weare) activity model
// for aqueous electrolytes, in the form PHREEQC uses (Plummer et al. 1988,
// USGS WRI 88-4153; Pitzer 1991):
//   ln γ_M = z_M² F + Σa m_a (2 B_Ma + Z C_Ma) + Σc m_c (2 Φ_Mc + Σa m_a ψ_Mca)
//            + Σa<a' m_a m_a' ψ_Maa' + |z_M| ΣΣ m_c m_a C_ca + 2 Σn m_n λ_nM + …
//   φ − 1   = (2/Σm) [ −Aφ I^1.5/(1 + b√I) + ΣΣ m_c m_a (B^φ_ca + Z C_ca) + … ]
// with b = 1.2, α1 = 2 (α1 = 1.4 and α2 = 12 for 2:2 pairs), C_ca = Cφ/(2√|z_c z_a|),
// unsymmetrical mixing Eθ(I) by Harvie's Chebyshev approximation of J(x), and
// neutral–ion λ, neutral–neutral λ (lnγ_n = 2 λ_nn m_n) and neutral–cation–anion ζ.
// Plain ES module, allocation-light. (c) multicalci.com
// ============================================================================

const MW_KG = 0.01801528;

// Harvie's Chebyshev approximation of J(x) (Pitzer 1991) — same constants as mb-electrolyte
const AKX = [1.925154014814667, -0.060076477753119, -0.029779077456514, -0.007299499690937, 0.000388260636404,
  0.000636874599598, 0.000036583601823, -0.000045036975204, -0.000004537895710, 0.000002937706971,
  0.000000396566462, -0.000000202099617, -0.000000025267769, 0.000000013522610, 0.000000001229405,
  -0.000000000821969, -0.000000000050847, 0.000000000046333, 0.000000000001943, -0.000000000002563,
  -0.000000000010991,
  0.628023320520852, 0.462762985338493, 0.150044637187895, -0.028796057604906, -0.036552745910311,
  -0.001668087945272, 0.006519840398744, 0.001130378079086, -0.000887171310131, -0.000242107641309,
  0.000087294451594, 0.000034682122751, -0.000004583768938, -0.000003548684306, -0.000000250453880,
  0.000000216991779, 0.000000080779570, 0.000000004558555, -0.000000006944757, -0.000000002849257,
  0.000000000237816];
const JB = new Float64Array(23), JD = new Float64Array(23);
function jfun(X, out) {
  let Z, DZ, L;
  if (X <= 1) { Z = 4 * Math.pow(X, 0.2) - 2; DZ = 0.8 * Math.pow(X, -0.8); L = 0; }
  else { Z = 40 * Math.pow(X, -0.1) / 9 - 22 / 9; DZ = -4 * Math.pow(X, -1.1) / 9; L = 21; }
  JB[21] = JB[22] = JD[21] = JD[22] = 0;
  for (let m = 20; m >= 0; m--) { JB[m] = Z * JB[m + 1] - JB[m + 2] + AKX[m + L]; JD[m] = JB[m + 1] + Z * JD[m + 1] - JD[m + 2]; }
  out[0] = 0.25 * X - 1 + 0.5 * (JB[0] - JB[2]);
  out[1] = 0.25 * X + 0.5 * DZ * (JD[0] - JD[2]) * X;
  return out;
}
const J1 = [0, 0];
/** Eθ and Eθ' for like-signed ions of charges zi, zj at ionic strength I */
function etheta(zi, zj, I, A0, out) {
  if (zi === zj || I <= 0) { out[0] = 0; out[1] = 0; return out; }
  const xc = 6 * A0 * Math.sqrt(I);
  jfun(xc * zi * zj, J1); const Jij = J1[0], Pij = J1[1];
  jfun(xc * zi * zi, J1); const Jii = J1[0], Pii = J1[1];
  jfun(xc * zj * zj, J1); const Jjj = J1[0], Pjj = J1[1];
  const zz = zi * zj;
  const et = zz * (Jij - 0.5 * Jii - 0.5 * Jjj) / (4 * I);
  out[0] = et; out[1] = zz * (Pij - 0.5 * Pii - 0.5 * Pjj) / (8 * I * I) - et / I;
  return out;
}
const gfun = (x) => (x > 1e-12 ? 2 * (1 - (1 + x) * Math.exp(-x)) / (x * x) : 1 - 2 * x / 3);
const gpfun = (x) => (x > 1e-12 ? -2 * (1 - (1 + x + 0.5 * x * x) * Math.exp(-x)) / (x * x) : -0.5 + 2 * x / 3);

/**
 * Compile a parameter set at one temperature.
 * @param {string[]} species names, @param {number[]} z charges (0 = neutral)
 * @param {object} p {B0:[[i,j,v]], B1, B2, C0 (Cφ), TH:[[i,j,v]], PSI:[[i,j,k,v]], LAM:[[n,i,v]], ZETA:[[n,c,a,v]]}
 * @param {number} A0 Debye–Hückel Aφ at T
 */
export function compile(species, z, p, A0) {
  const n = species.length;
  const B = [];
  const add = (list, f) => { for (const r of list || []) f(r); };
  // pair table: B0, B1 (α1), B2 (α2) per cation–anion pair
  const key = (i, j) => (i < j ? i * n + j : j * n + i);
  const pair = new Map();
  const get = (i, j) => { const k = key(i, j); let e = pair.get(k); if (!e) { e = { i: Math.min(i, j), j: Math.max(i, j), b0: 0, b1: 0, b2: 0, c: 0, a1: 2, a2: 12 }; pair.set(k, e); } return e; };
  add(p.B0, ([i, j, v]) => { get(i, j).b0 += v; });
  add(p.B1, ([i, j, v]) => { get(i, j).b1 += v; });
  add(p.B2, ([i, j, v]) => { get(i, j).b2 += v; });
  add(p.C0, ([i, j, v]) => { get(i, j).c += v / (2 * Math.sqrt(Math.abs(z[i] * z[j]))); });
  for (const e of pair.values()) {
    if (Math.abs(z[e.i]) === 2 && Math.abs(z[e.j]) === 2) e.a1 = 1.4;
    else if (Math.abs(z[e.i]) >= 2 && Math.abs(z[e.j]) >= 2) e.a1 = 1.4;     // as PHREEQC for 2:2 (and higher)
    B.push(e);
  }
  return {
    n, z: Float64Array.from(z), A0, B,
    TH: (p.TH || []).map(([i, j, v]) => ({ i, j, v })),
    PSI: (p.PSI || []).map(([i, j, k, v]) => ({ i, j, k, v })),
    LAM: (p.LAM || []).map(([i, j, v]) => ({ i, j, v })),
    ZETA: (p.ZETA || []).map(([i, j, k, v]) => ({ i, j, k, v })),
  };
}

const ET = [0, 0];
/**
 * ln γ_i (molality scale) and ln a_w for molalities m.
 * @param {object} c compiled set, @param {Float64Array|number[]} m molalities
 * @param {Float64Array} lg output ln γ (length n)
 * @returns {{lnaw:number, phi:number, I:number}}
 */
export function evaluate(c, m, lg) {
  const n = c.n, z = c.z, A0 = c.A0, b = 1.2;
  let I = 0, Z = 0, osum = 0;
  for (let i = 0; i < n; i++) { lg[i] = 0; I += 0.5 * m[i] * z[i] * z[i]; Z += m[i] * Math.abs(z[i]); osum += m[i]; }
  const sI = Math.sqrt(I);
  let F = -A0 * (sI / (1 + b * sI) + 2 * Math.log(1 + b * sI) / b);
  let osm = -A0 * I * sI / (1 + b * sI);
  let csum = 0;
  for (let q = 0; q < c.B.length; q++) {
    const e = c.B[q], i = e.i, j = e.j, mi = m[i], mj = m[j];
    let Bv = e.b0, Bp = 0, Bphi = e.b0;
    if (e.b1) { const x = e.a1 * sI, ex = Math.exp(-x); Bv += e.b1 * gfun(x); Bp += e.b1 * gpfun(x) / (I || 1e-300); Bphi += e.b1 * ex; }
    if (e.b2) { const x = e.a2 * sI, ex = Math.exp(-x); Bv += e.b2 * gfun(x); Bp += e.b2 * gpfun(x) / (I || 1e-300); Bphi += e.b2 * ex; }
    lg[i] += 2 * mj * Bv; lg[j] += 2 * mi * Bv;
    F += mi * mj * Bp;
    osm += mi * mj * Bphi;
    if (e.c) { csum += mi * mj * e.c; lg[i] += mj * Z * e.c; lg[j] += mi * Z * e.c; osm += mi * mj * Z * e.c; }
  }
  for (let q = 0; q < c.TH.length; q++) {
    const t = c.TH[q], i = t.i, j = t.j;
    etheta(z[i], z[j], I, A0, ET);
    lg[i] += 2 * m[j] * (t.v + ET[0]); lg[j] += 2 * m[i] * (t.v + ET[0]);
    F += m[i] * m[j] * ET[1];
    osm += m[i] * m[j] * (t.v + ET[0] + I * ET[1]);
  }
  for (let q = 0; q < c.PSI.length; q++) {
    const t = c.PSI[q], i = t.i, j = t.j, k = t.k;
    lg[i] += m[j] * m[k] * t.v; lg[j] += m[i] * m[k] * t.v; lg[k] += m[i] * m[j] * t.v;
    osm += m[i] * m[j] * m[k] * t.v;
  }
  for (let q = 0; q < c.LAM.length; q++) {
    const t = c.LAM[q], i = t.i, j = t.j;
    if (i === j) { lg[i] += 2 * m[i] * t.v; osm += 0.5 * m[i] * m[i] * t.v; continue; }
    lg[i] += 2 * m[j] * t.v; lg[j] += 2 * m[i] * t.v; osm += m[i] * m[j] * t.v;
  }
  for (let q = 0; q < c.ZETA.length; q++) {
    const t = c.ZETA[q], i = t.i, j = t.j, k = t.k;
    lg[i] += m[j] * m[k] * t.v; lg[j] += m[i] * m[k] * t.v; lg[k] += m[i] * m[j] * t.v;
    osm += m[i] * m[j] * m[k] * t.v;
  }
  for (let i = 0; i < n; i++) if (z[i]) lg[i] += z[i] * z[i] * F + Math.abs(z[i]) * csum;
  const phi = osum > 0 ? 1 + 2 * osm / osum : 1;
  return { lnaw: -osum * phi * MW_KG, phi, I };
}

export default { compile, evaluate };
