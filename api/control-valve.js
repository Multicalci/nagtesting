// ============================================================
// Vercel Serverless API — Control Valve Sizing
// File: /api/control-valve.js
// ALL math, unit conversions, validation done HERE — nothing in client
// Protected by secret key — requests without key return 403
// ============================================================

const SECRET_KEY = 'cv-k3y9x';  // must match _K in index.html

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  // ── SECRET KEY CHECK ──────────────────────────────────────────────────────
  if (req.headers['x-api-key'] !== SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const d = req.body;

    // ── RAW INPUTS ────────────────────────────────────────────────────────────
    const phase    = d.phase    || 'liq_gen';
    const flowType = d.flowType || 'vol';
    const units    = d.units    || 'imp';   // 'imp' = US, 'met' = SI
    const m        = units === 'met';
    const isL      = phase.includes('liq');
    const isG      = phase.includes('gas');
    const isS      = phase === 'steam';

    const Q  = parseFloat(d.Q)  || 0;
    const P1 = parseFloat(d.P1) || 0;
    const P2 = parseFloat(d.P2) || 0;
    const T  = parseFloat(d.T)  || (m ? 20 : 60);
    const SG = parseFloat(d.SG) || 1;
    const Pv = parseFloat(d.Pv) || 0;
    const D  = parseFloat(d.D)  || (m ? 52.5 : 2.067);
    const FL = parseFloat(d.FL) || 0.9;
    const k  = parseFloat(d.k)  || 1.4;
    const Z  = parseFloat(d.Z)  || 1.0;
    const fluidVisc  = parseFloat(d.fluidVisc) || 1.0;
    const fluidPc    = d.fluidPc ? parseFloat(d.fluidPc) : null;
    const steamFluid = d.steamFluid || '';

    // ── VALIDATION ────────────────────────────────────────────────────────────
    const warns = [];
    let hasError = false;

    if (P1 <= 0) { warns.push({ cls:'warn-red', txt:'❌ Inlet pressure P₁ must be positive.' }); hasError=true; }
    if (P2 < 0)  { warns.push({ cls:'warn-red', txt:'❌ Outlet pressure P₂ cannot be negative.' }); hasError=true; }
    if (!hasError && P2 >= P1) { warns.push({ cls:'warn-red', txt:'❌ P₂ ≥ P₁: Outlet pressure must be less than inlet pressure.' }); hasError=true; }
    if (Q <= 0)  { warns.push({ cls:'warn-red', txt:'❌ Flow rate must be greater than zero.' }); hasError=true; }
    if (isL && SG <= 0) { warns.push({ cls:'warn-red', txt:'❌ Specific gravity must be positive.' }); hasError=true; }
    if (isG && SG <= 0) { warns.push({ cls:'warn-red', txt:'❌ Molecular weight must be positive.' }); hasError=true; }
    if (FL <= 0 || FL > 1) warns.push({ cls:'warn-amber', txt:'⚠ FL/xT should be between 0.1 and 1.0.' });
    if (Z <= 0  || Z > 1.5) warns.push({ cls:'warn-amber', txt:'⚠ Compressibility Z outside typical range (0.7–1.05).' });

    // Gauge pressure warnings
    if (!hasError && isL && !m && P1 < 14.5 && P1 > 0)
      warns.push({ cls:'warn-amber', txt:`⚠ P₁ = ${P1} psi looks like gauge pressure. IEC 60534 requires ABSOLUTE pressure. Add 14.7 psia.` });
    if (!hasError && m && P1 < 1.013 && P1 > 0 && isL)
      warns.push({ cls:'warn-amber', txt:`⚠ P₁ = ${P1} bar looks like gauge pressure. IEC 60534 requires ABSOLUTE pressure (bara). Add 1.013 bar.` });
    if (isL && Pv > 0 && Pv >= P1) {
      warns.push({ cls:'warn-red', txt:'❌ Vapour pressure Pv ≥ P₁: fluid already vaporised at inlet.' }); hasError=true;
    }

    if (hasError) return res.status(200).json({ error: null, warns, Cv:null, Kv:null });

    // ── UNIT CONVERSIONS to US base ───────────────────────────────────────────
    let P1a = P1, P2a = P2, Pva = Pv, T_F = T, D_in = D;
    if (m) {
      P1a  *= 14.5038;   // bara → psia
      P2a  *= 14.5038;
      Pva  *= 14.5038;
      D_in  = D / 25.4;  // mm → in
      T_F   = T * 9/5 + 32; // °C → °F
    }
    const dP   = Math.max(P1a - P2a, 0.0001);
    const TR   = T_F + 459.67;  // Rankine
    const A_in2 = Math.PI / 4 * D_in * D_in;
    const Pc_psia = fluidPc ? fluidPc * 14.5038 : 3208;

    // ── FLOW CONVERSION to canonical units ────────────────────────────────────
    let Qc = Q;
    if (isL) {
      if      (flowType === 'vol')  { if (m) Qc = Q * 4.40287; }
      else if (flowType === 'mass') {
        const rho = SG * 8.3454;
        Qc = m ? (Q * 2.20462) / (rho * 60) : Q / (rho * 60);
      } else { if (m) Qc = Q * 4.40287; }
    } else if (isG) {
      if      (flowType === 'vol')  { if (m) Qc = Q * 35.3147; }
      else if (flowType === 'mass') { const lbh = m ? Q * 2.20462 : Q; Qc = (lbh / SG) * 379.5; }
      else { if (m) Qc = Q * 35.3147; }
    } else {
      Qc = m ? Q * 2.20462 : Q; // steam → lb/h
    }

    // ── CORE IEC 60534-2-1 CALCULATIONS ──────────────────────────────────────
    let Cv = 0, vel = 0, dPmax = 0, dPeff = dP, x_ratio = 0;
    let flowState = '', noiseDb = 0, Y = null, FR = null, Rev = null;

    if (isL) {
      // LIQUID — IEC 60534-2-1 §5.1
      const FF  = Math.min(0.96, 0.96 - 0.28 * Math.sqrt(Math.max(Pva / Pc_psia, 0)));
      dPmax     = Math.max(FL * FL * (P1a - FF * Pva), 0.001);
      dPeff     = Math.min(dP, dPmax);
      Cv        = Qc * Math.sqrt(SG / Math.max(dPeff, 0.0001));

      // Reynolds viscosity correction IEC 60534 §5.3
      Rev = 76000 * Qc / (fluidVisc * Math.sqrt(Math.max(Cv * FL * FL, 0.001)));
      FR  = 1.0;
      if (Rev < 10000) {
        if      (Rev < 10)    FR = 0.026 * Math.pow(Rev, 0.33);
        else if (Rev < 100)   FR = 0.12  * Math.pow(Rev, 0.20);
        else if (Rev < 1000)  FR = 0.34  * Math.pow(Rev, 0.10);
        else                  FR = 0.70  * Math.pow(Rev / 10000, 0.04);
        FR = Math.min(Math.max(FR, 0.1), 1.0);
        Cv = Cv / FR;
      }

      vel = Qc * 0.002228 / (A_in2 / 144.0);

      const sigma = (P1a - Pva) / Math.max(dP, 0.0001);
      const ci    = dP / Math.max(dPmax, 0.0001);
      x_ratio     = Math.min(ci, 1.0);

      if      (dP >= dPmax) flowState = '🔴 Choked / Flashing';
      else if (ci > 0.75)   flowState = `🟡 Cavitation Risk (σ=${sigma.toFixed(2)})`;
      else if (ci > 0.50)   flowState = `🟠 Incipient Cavitation (σ=${sigma.toFixed(2)})`;
      else                  flowState = '🟢 Normal Liquid';

      noiseDb = Math.round(68 + 10*Math.log10(Math.max(Cv,1)) + 12*(ci>1?1:ci)*Math.log10(Math.max(P1a/14.7,1.1)));

      if (dP >= dPmax) warns.push({ cls:'warn-red',   txt:`⚠️ Choked flow — Cv at ΔP_choked = ${fmt2(m?dPmax/14.5038:dPmax)} ${m?'bara':'psia'}. Hardened trim required.` });
      else if (ci > 0.75) warns.push({ cls:'warn-amber', txt:`⚠ Cavitation risk (ΔP/ΔP_choked = ${(ci*100).toFixed(0)}%). Anti-cavitation trim recommended. σ = ${sigma.toFixed(2)}.` });
      else if (ci > 0.50) warns.push({ cls:'warn-amber', txt:`⚠ Incipient cavitation. Monitor trim. σ = ${sigma.toFixed(2)}.` });
      if (FR < 0.95) warns.push({ cls:'warn-amber', txt:`⚠ Viscosity correction: FR=${FR.toFixed(3)}, Rev=${Rev.toFixed(0)}. Cv +${((1/FR-1)*100).toFixed(1)}% for viscous flow.` });

    } else if (isG) {
      // GAS — IEC 60534-2-1 §5.2
      const MW     = SG;
      const xT     = FL;
      const x      = dP / Math.max(P1a, 0.0001);
      const Fk     = k / 1.4;
      const x_crit = Fk * xT;
      const x_lim  = Math.min(x, x_crit);
      x_ratio      = x / Math.max(x_crit, 0.0001);
      Y            = Math.max(1.0 - x_lim / (3.0 * Fk * xT), 0.667);
      dPmax        = x_crit * P1a;

      Cv = Qc * Math.sqrt(MW * TR * Z) / (1360.0 * P1a * Y * Math.sqrt(Math.max(x_lim, 0.0001)));

      const Q_cfs = Qc * (14.696 / Math.max(P2a,14.696)) * (TR / 519.67) / 3600.0;
      vel = Q_cfs / (A_in2 / 144.0);

      if      (x >= x_crit)       { flowState = '🔴 Choked Gas (Sonic)';  warns.push({ cls:'warn-red',   txt:`⚠️ Sonic flow: x=${(x*100).toFixed(1)}% ≥ Fk·xT=${(x_crit*100).toFixed(1)}%. Flow will NOT increase with higher ΔP.` }); }
      else if (x > x_crit * 0.8)  { flowState = `🟡 Near-Critical Gas`;   warns.push({ cls:'warn-amber', txt:`⚠ Near sonic: x/x_crit=${(x_ratio*100).toFixed(0)}%. Significant noise likely.` }); }
      else                         { flowState = '🟢 Normal Gas Flow'; }
      if (vel > 100) warns.push({ cls:'warn-amber', txt:`⚠ Inlet velocity ${vel.toFixed(0)} ft/s > 100 ft/s. Consider larger pipe.` });

      noiseDb = Math.round(62 + 10*Math.log10(Math.max(Cv,1)) + 18*x_lim + 5*Math.log10(Math.max(P1a/14.7,1.1)));

    } else {
      // STEAM — ISA S75.01
      const W          = Qc;
      const x_s        = dP / Math.max(P1a, 0.0001);
      const x_crit_s   = 0.42;
      dPmax            = x_crit_s * P1a;
      x_ratio          = x_s / x_crit_s;
      const dPeff_s    = Math.min(dP, dPmax);
      const isSup      = steamFluid === 'Superheated Steam';
      const isWet      = steamFluid === 'Wet Steam (90%)';

      if (isSup) {
        const Tsat_F = -459.67 + 49.16 * Math.pow(P1a, 0.2345) + 200;
        const Fs     = 1.0 + 0.00065 * Math.max(T_F - Tsat_F, 0);
        Cv = W * Fs / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      } else if (isWet) {
        Cv = W / (0.90 * 2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      } else {
        Cv = W / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      }

      const v_spec = (85.76 * TR) / (P2a * 144.0);
      vel = W * v_spec / (3600.0 * A_in2 / 144.0);

      flowState = x_ratio >= 1 ? '🔴 Choked Steam' : '🟢 Steam Flow OK';
      if (x_ratio >= 1) warns.push({ cls:'warn-red', txt:`⚠️ Choked steam: ΔP/P₁=${(x_s*100).toFixed(1)}% > 42%. Verify flash piping downstream.` });
      noiseDb = Math.round(65 + 10*Math.log10(Math.max(Cv,1)) + 15*(x_ratio>1?1:x_ratio));
    }

    const Kv = Cv / 1.1561;

    // ── VELOCITY DISPLAY (convert to metric if needed) ────────────────────────
    const vel_disp = m ? vel * 0.3048 : vel;
    const velLim   = isL ? (m ? 5 : 15) : (m ? 30 : 100);
    const velOk    = vel_disp < velLim;
    if (!velOk) warns.push({ cls:'warn-amber', txt:`ℹ Pipe velocity (${vel_disp.toFixed(1)} ${m?'m/s':'ft/s'}) exceeds recommended limit. Consider larger bore piping.` });

    // ── VALVE SIZE RECOMMENDATION ─────────────────────────────────────────────
    const stdCv = [
      {s:'1"',Cv_rated:11},{s:'1.5"',Cv_rated:25},{s:'2"',Cv_rated:55},
      {s:'3"',Cv_rated:120},{s:'4"',Cv_rated:240},{s:'6"',Cv_rated:550},
      {s:'8"',Cv_rated:1000},{s:'10"',Cv_rated:1800},{s:'12"',Cv_rated:3000},
      {s:'14"',Cv_rated:4500},{s:'16"',Cv_rated:6500},
    ];
    const ri0 = stdCv.findIndex(s => s.Cv_rated * 0.8 >= Cv);
    const ri   = ri0 === -1 ? stdCv.length-1 : Math.max(0, Math.min(ri0, stdCv.length-1));
    const sizes = {
      smaller: stdCv[Math.max(ri-1,0)],
      rec:     stdCv[ri],
      larger:  stdCv[Math.min(ri+1, stdCv.length-1)],
    };

    // ── DISPLAY LABELS (built server side so no math in client) ──────────────
    const pu        = m ? 'bar' : 'psi';
    const dp2label  = v => v == null ? '—' : (m ? (v/14.5038).toFixed(3) : v.toFixed(2)) + ' ' + pu;

    return res.status(200).json({
      Cv:         fmtN(Cv),
      Kv:         fmtN(Kv),
      vel:        fmtN(vel_disp),
      velOk,
      velLim,
      dP,   dPeff, dPmax,
      dpRatioPct: ((dP / Math.max(P1a,0.001)) * 100).toFixed(1),
      Y:          isG ? fmtN(Y) : null,
      Rev:        isL && Rev != null ? Rev : null,
      flowState,
      noiseDb,
      sizes,
      warns,
      // Display labels — all formatting done server side
      sgLabel:    SG.toFixed(3) + (isL?' (SG)': isG?' g/mol':' (steam MW=18.02)'),
      tempLabel:  m ? ((T_F-32)*5/9).toFixed(1)+'°C' : T_F.toFixed(1)+'°F',
      flLabel:    FL.toFixed(3) + (isG?' (xT)':' (FL)'),
      pipeLabel:  m ? (D_in*25.4).toFixed(1)+' mm' : D_in.toFixed(3)+' in',
      dPmaxLabel: isL||isS ? dp2label(dPmax) : 'x_crit='+((k/1.4)*FL).toFixed(3),
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function fmtN(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return null;
  return v < 1 ? Math.round(v*1000)/1000 : v < 10 ? Math.round(v*100)/100 : Math.round(v*10)/10;
}
function fmt2(v) {
  return v == null ? '—' : v.toFixed(2);
}
