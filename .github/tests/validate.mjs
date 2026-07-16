#!/usr/bin/env node
// Control-valve sizing — validation & regression runner (CI).
// POSTs known cases to a deployed /api/control-valve and checks Cv + flow regime.
// Usage:  node validate.mjs [https://host]     (defaults to production)
//         API_URL env var overrides the endpoint entirely.
// Exit code 0 = all pass, 1 = any failure (fails the GitHub Actions job).

const arg = process.argv[2];
const API_URL =
  process.env.API_URL ||
  (arg ? arg.replace(/\/+$/, '') + '/api/control-valve'
       : 'https://www.multicalci.com/api/control-valve');

const BASE = { Pv: '0', fluidVisc: 1.0, fluidPc: null, charType: 'equal_pct', R_trim: '50', steamFluid: '' };

// expected Cv = independent IEC/ISA derivation (confirmed against the engine); tol = relative %
const CASES = [
  { id: 'L1', name: 'Water — normal',              kind: 'validated',  expCv: 18.257, tol: 2,   state: 'normal liquid',
    p: { phase:'liq_gen', flowType:'vol', units:'imp', Q:'100', P1:'100', P2:'70', T:'60', SG:'1.0', Pv:'0',  D:'2.067', FL:'0.9', k:'1.4', Z:'1' } },
  { id: 'L2', name: 'Water — choked / flashing',   kind: 'validated',  expCv: 11.664, tol: 2.5, state: 'choked',
    p: { phase:'liq_gen', flowType:'vol', units:'imp', Q:'100', P1:'100', P2:'20', T:'60', SG:'1.0', Pv:'10', D:'2.067', FL:'0.9', k:'1.4', Z:'1' } },
  { id: 'L3', name: 'Water — incipient cavitation',kind: 'validated',  expCv: 14.142, tol: 2,   state: 'cavitation',
    p: { phase:'liq_gen', flowType:'vol', units:'imp', Q:'100', P1:'100', P2:'50', T:'60', SG:'1.0', Pv:'5',  D:'2.067', FL:'0.9', k:'1.4', Z:'1' } },
  { id: 'G1', name: 'Air — normal',                kind: 'validated',  expCv: 8.264,  tol: 2,   state: 'normal gas',
    p: { phase:'gas', flowType:'nm3', units:'imp', Q:'20000', P1:'100', P2:'80', T:'60', SG:'28.97', Pv:'0', D:'2.067', FL:'0.72', k:'1.4', Z:'1' } },
  { id: 'G2', name: 'Gas — choked (sonic)',        kind: 'validated',  expCv: 2.962,  tol: 2,   state: 'choked gas',
    p: { phase:'gas', flowType:'nm3', units:'imp', Q:'10000', P1:'100', P2:'20', T:'60', SG:'28.97', Pv:'0', D:'2.067', FL:'0.72', k:'1.4', Z:'1' } },
  { id: 'G3', name: 'Ammonia — real gas (SI)',     kind: 'validated',  expCv: 301.2,  tol: 1.5, state: 'normal gas',
    p: { phase:'gas', flowType:'mass', units:'met', Q:'20000', P1:'10', P2:'9', T:'60', SG:'17.03', Pv:'0', D:'202.7', FL:'0.72', k:'1.31', Z:'0.9372' } },
  { id: 'S1', name: 'Saturated steam',             kind: 'regression', expCv: 5.498,  tol: 3,   state: 'steam',
    p: { phase:'steam', flowType:'mass', units:'imp', Q:'1000', P1:'100', P2:'50', T:'328', SG:'1', Pv:'0', D:'2.067', FL:'0.9', k:'1.3' } },
];

const BYPASS_SECRET = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

async function runCase(c) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(BYPASS_SECRET ? { 'x-vercel-protection-bypass': BYPASS_SECRET } : {}),
    },
    body: JSON.stringify({ ...BASE, ...c.p }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const r = await resp.json();
  if (r.error) throw new Error(r.error);
  if (typeof r.Cv !== 'number') throw new Error('no numeric Cv in response');
  const dev = ((r.Cv - c.expCv) / c.expCv) * 100;
  const cvPass = Math.abs(dev) <= c.tol;
  const statePass = !c.state || (r.flowState || '').toLowerCase().includes(c.state);
  return { ok: cvPass && statePass, cv: r.Cv, dev, state: r.flowState, cvPass, statePass };
}

(async () => {
  console.log(`\nControl-valve validation suite → ${API_URL}\n`);
  let pass = 0, maxDev = 0;
  const rows = [];
  for (const c of CASES) {
    try {
      const r = await runCase(c);
      if (r.ok) pass++;
      maxDev = Math.max(maxDev, Math.abs(r.dev));
      const flag = r.ok ? 'PASS' : 'FAIL';
      const cvNote = r.cvPass ? '' : `  Cv off (exp ${c.expCv}, tol ±${c.tol}%)`;
      const stNote = r.statePass ? '' : `  regime≠"${c.state}"`;
      rows.push(`  ${flag}  ${c.id}  ${c.name.padEnd(30)} Cv ${String(r.cv).padStart(8)}  Δ ${(r.dev >= 0 ? '+' : '') + r.dev.toFixed(2)}%${cvNote}${stNote}`);
    } catch (e) {
      rows.push(`  ERR   ${c.id}  ${c.name.padEnd(30)} ${e.message}`);
    }
  }
  console.log(rows.join('\n'));
  console.log(`\n${pass}/${CASES.length} passed · worst Cv deviation ${maxDev.toFixed(2)}%\n`);
  process.exit(pass === CASES.length ? 0 : 1);
})().catch((e) => { console.error('Runner error:', e.message); process.exit(1); });
