// ============================================================
// Vercel Serverless API — Control Valve Sizing Calculator
// File: /api/control-valve.js
// Standard: IEC 60534-2-1 / ISA S75.01
// Handles: Liquid, Gas, Steam service
// Deploy: push to your Vercel-connected GitHub repo
// ============================================================

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const d = req.body;
    // All inputs arrive already in US base units from client:
    //   pressures → psia, flow → GPM (liq) / SCFH (gas) / lb/h (steam)
    //   temp → °F (→ Rankine), pipe diameter → inches
    const phase = d.phase || 'liq';
    const isL = phase.includes('liq');
    const isG = phase.includes('gas');
    const isS = phase === 'steam';

    // ── INPUTS ──────────────────────────────────────────────
    const Qc   = parseFloat(d.Qc)   || 0;   // canonical flow
    const P1a  = parseFloat(d.P1a)  || 0;   // psia
    const P2a  = parseFloat(d.P2a)  || 0;   // psia
    const Pva  = parseFloat(d.Pva)  || 0;   // psia (liquid only)
    const SG   = parseFloat(d.SG)   || 1;   // liq:SG, gas:MW
    const TR   = parseFloat(d.TR)   || 520; // Rankine
    const FL   = parseFloat(d.FL)   || 0.9; // FL or xT
    const k    = parseFloat(d.k)    || 1.4; // isentropic exp
    const Z    = parseFloat(d.Z)    || 1.0; // compressibility
    const A_in2= parseFloat(d.A_in2)|| 3.35;// pipe area in²
    const visc = parseFloat(d.visc) || 1.0; // cSt (liquid)
    const Pc_psia = parseFloat(d.Pc_psia) || 3208; // critical pressure psia
    const steamType = d.steamType || 'sat'; // 'sat'|'sup'|'wet'

    const dP = Math.max(P1a - P2a, 0.0001);

    let Cv = 0, vel = 0, dPmax = 0, dPeff = dP;
    let x_ratio = 0, flowState = '', noiseDb = 0;
    let FR = 1.0, Rev = 0, Y = 1.0;
    const warns = [];

    if (isL) {
      // ── LIQUID: IEC 60534-2-1 §5.1 ─────────────────────
      const FF = Math.min(0.96, 0.96 - 0.28 * Math.sqrt(Math.max(Pva / Pc_psia, 0)));
      dPmax = Math.max(FL * FL * (P1a - FF * Pva), 0.001);
      dPeff = Math.min(dP, dPmax);
      Cv    = Qc * Math.sqrt(SG / Math.max(dPeff, 0.0001));

      // Reynolds viscosity correction (IEC 60534 §5.3)
      Rev = 76000 * Qc / (visc * Math.sqrt(Math.max(Cv * FL * FL, 0.001)));
      if (Rev < 10000) {
        if      (Rev < 10)    FR = 0.026 * Math.pow(Rev, 0.33);
        else if (Rev < 100)   FR = 0.12  * Math.pow(Rev, 0.20);
        else if (Rev < 1000)  FR = 0.34  * Math.pow(Rev, 0.10);
        else                  FR = 0.70  * Math.pow(Rev / 10000, 0.04);
        FR = Math.min(Math.max(FR, 0.1), 1.0);
        Cv = Cv / FR;
      }

      // Pipe velocity ft/s: Q[GPM] × 0.002228 / A[ft²]
      vel = Qc * 0.002228 / (A_in2 / 144.0);

      // Cavitation index σ
      const sigma = (P1a - Pva) / Math.max(dP, 0.0001);
      const ci    = dP / Math.max(dPmax, 0.0001);
      x_ratio     = Math.min(ci, 1.0);

      if      (dP >= dPmax)  flowState = '🔴 Choked / Flashing';
      else if (ci > 0.75)    flowState = `🟡 Cavitation Risk (σ=${sigma.toFixed(2)})`;
      else if (ci > 0.50)    flowState = `🟠 Incipient Cavitation (σ=${sigma.toFixed(2)})`;
      else                   flowState = '🟢 Normal Liquid';

      noiseDb = Math.round(68 + 10 * Math.log10(Math.max(Cv, 1)) +
                12 * (ci > 1 ? 1 : ci) * Math.log10(Math.max(P1a / 14.7, 1.1)));

      if (dP >= dPmax) warns.push({ cls: 'warn-red',   txt: `⚠️ Choked flow — Cv computed at ΔP_choked = ${dpFmt(dPmax)}. Hardened trim & flash piping required.` });
      else if (ci > 0.75) warns.push({ cls: 'warn-amber', txt: `⚠ Cavitation risk (ΔP/ΔP_choked = ${(ci*100).toFixed(0)}%). Anti-cavitation trim recommended. σ = ${sigma.toFixed(2)}.` });
      else if (ci > 0.50) warns.push({ cls: 'warn-amber', txt: `⚠ Incipient cavitation (ΔP/ΔP_choked = ${(ci*100).toFixed(0)}%). Monitor trim. σ = ${sigma.toFixed(2)}.` });
      if (FR < 0.95) warns.push({ cls: 'warn-amber', txt: `⚠ Viscosity correction: FR = ${FR.toFixed(3)}, Rev = ${Rev.toFixed(0)}. Cv increased ${((1/FR-1)*100).toFixed(1)}% for viscous flow.` });

    } else if (isG) {
      // ── GAS: IEC 60534-2-1 §5.2 ────────────────────────
      const MW     = SG;
      const xT     = FL;
      const x      = dP / Math.max(P1a, 0.0001);
      const Fk     = k / 1.4;
      const x_crit = Fk * xT;
      const x_lim  = Math.min(x, x_crit);
      x_ratio      = x / Math.max(x_crit, 0.0001);
      Y            = Math.max(1.0 - x_lim / (3.0 * Fk * xT), 0.667);
      dPmax        = x_crit * P1a;

      // IEC 60534-2-1 Eq.4: Cv = Q·√(M·T·Z) / (1360·P1·Y·√x_eff)
      Cv = Qc * Math.sqrt(MW * TR * Z) / (1360.0 * P1a * Y * Math.sqrt(Math.max(x_lim, 0.0001)));

      // Gas velocity at downstream conditions
      const P2_abs    = Math.max(P2a, 14.696);
      const Q_act_cfs = Qc * (14.696 / P2_abs) * (TR / 519.67) / 3600.0;
      vel = Q_act_cfs / (A_in2 / 144.0);

      if (x >= x_crit) {
        flowState = '🔴 Choked Gas (Sonic)';
        warns.push({ cls: 'warn-red',   txt: `⚠️ Sonic flow: x=${(x*100).toFixed(1)}% ≥ Fk·xT=${(x_crit*100).toFixed(1)}%. Increasing ΔP will NOT increase flow. Check noise & vibration.` });
      } else if (x > x_crit * 0.8) {
        flowState = `🟡 Near-Critical Gas (Y=${Y.toFixed(4)})`;
        warns.push({ cls: 'warn-amber', txt: `⚠ Near sonic: x/x_crit = ${(x_ratio*100).toFixed(0)}%. Significant noise likely.` });
      } else {
        flowState = '🟢 Normal Gas Flow';
      }
      if (vel > 100) warns.push({ cls: 'warn-amber', txt: `⚠ Inlet velocity ${vel.toFixed(0)} ft/s > 100 ft/s. Enlarge pipe or valve.` });
      noiseDb = Math.round(62 + 10 * Math.log10(Math.max(Cv, 1)) + 18 * x_lim + 5 * Math.log10(Math.max(P1a / 14.7, 1.1)));

    } else {
      // ── STEAM: ISA S75.01 ────────────────────────────────
      const W          = Qc;
      const x_steam    = dP / Math.max(P1a, 0.0001);
      const x_crit_s   = 0.42; // Fk·xT for steam
      dPmax            = x_crit_s * P1a;
      x_ratio          = x_steam / x_crit_s;
      const dPeff_s    = Math.min(dP, dPmax);
      const T_F        = TR - 459.67;

      if (steamType === 'sup') {
        const Tsat_F = -459.67 + 49.16 * Math.pow(P1a, 0.2345) + 200;
        const Fs     = 1.0 + 0.00065 * Math.max(T_F - Tsat_F, 0);
        Cv = W * Fs / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      } else if (steamType === 'wet') {
        Cv = W / (0.90 * 2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      } else {
        // Saturated
        Cv = W / (2.1 * Math.sqrt(Math.max(dPeff_s * (P1a + P2a), 0.0001)));
      }

      // Steam velocity via specific volume approximation
      const v_spec = (85.76 * TR) / (P2a * 144.0);
      vel = W * v_spec / (3600.0 * A_in2 / 144.0);

      flowState = x_ratio >= 1 ? '🔴 Choked Steam' : '🟢 Steam Flow OK';
      if (x_ratio >= 1) warns.push({ cls: 'warn-red', txt: `⚠️ Choked steam: ΔP/P₁ = ${(x_steam*100).toFixed(1)}% > 42%. Verify downstream flash piping.` });
      noiseDb = Math.round(65 + 10 * Math.log10(Math.max(Cv, 1)) + 15 * (x_ratio > 1 ? 1 : x_ratio));
    }

    const Kv = Cv / 1.1561;

    // ── VALVE SIZE RECOMMENDATION ────────────────────────
    const stdCv = [
      { s: '1"',  Cv_rated: 11  }, { s: '1.5"', Cv_rated: 25  },
      { s: '2"',  Cv_rated: 55  }, { s: '3"',   Cv_rated: 120 },
      { s: '4"',  Cv_rated: 240 }, { s: '6"',   Cv_rated: 550 },
      { s: '8"',  Cv_rated: 1000}, { s: '10"',  Cv_rated: 1800},
      { s: '12"', Cv_rated: 3000}, { s: '14"',  Cv_rated: 4500},
      { s: '16"', Cv_rated: 6500},
    ];
    const ri0 = stdCv.findIndex(s => s.Cv_rated * 0.8 >= Cv);
    const ri   = ri0 === -1 ? stdCv.length - 1 : Math.max(0, Math.min(ri0, stdCv.length - 1));
    const sizes = {
      smaller: stdCv[Math.max(ri - 1, 0)],
      rec:     stdCv[ri],
      larger:  stdCv[Math.min(ri + 1, stdCv.length - 1)],
    };

    // Additional shared warnings
    if (vel > (isL ? 15 : 100)) warns.push({ cls: 'warn-amber', txt: `ℹ Pipe velocity (${vel.toFixed(1)} ft/s) exceeds recommended limit. Consider larger bore piping.` });

    return res.status(200).json({
      Cv:        fmt(Cv),
      Kv:        fmt(Kv),
      vel,
      dP:        dP,
      dPeff:     dPeff,
      dPmax:     dPmax,
      x_ratio,
      Y:         isG ? Y : null,
      FR:        isL ? FR : null,
      Rev:       isL ? Rev : null,
      flowState,
      noiseDb,
      sizes,
      warns,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function fmt(v) {
  if (!isFinite(v) || isNaN(v)) return 0;
  return v < 1 ? Math.round(v * 1000) / 1000 : v < 10 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
}
function dpFmt(v) {
  return v.toFixed(2) + ' psia';
}
