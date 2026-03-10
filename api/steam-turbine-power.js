// ================================================================
// /api/calculate.js  — Vercel Serverless Function
//
// ALL thermodynamic logic lives here — tables, interpolation,
// isentropic solver, and all four turbine power calculations.
//
// Three actions (POST JSON):
//   inletProps   → h, s, T_sat, phase   (inlet / extraction autofill)
//   exhaustProps → h2s, hf, hg, hfg, T_sat   (exhaust autofill)
//   calculate    → all power/heat outputs (all turbine types)
// ================================================================

// ── IAPWS-IF97 Saturation Table ────────────────────────────────
// Raw: [P_bar, T_C, hf, hg, sf, sg, vf, vg]
const SAT_TABLE = (() => {
    const raw = [
        [0.00611, 0.01,   0.00,   2501.4, 0.0000, 9.1562, 0.0010002, 206.140],
        [0.010,   6.98,  29.30,   2514.2, 0.1059, 8.9756, 0.0010001, 129.208],
        [0.015,  13.03,  54.70,   2525.3, 0.1956, 8.8278, 0.0010007,  87.980],
        [0.020,  17.50,  73.47,   2533.5, 0.2607, 8.7236, 0.0010013,  67.006],
        [0.030,  24.08, 101.03,   2545.5, 0.3545, 8.5775, 0.0010028,  45.665],
        [0.040,  28.96, 121.44,   2554.4, 0.4226, 8.4746, 0.0010041,  34.797],
        [0.050,  32.88, 137.79,   2561.4, 0.4763, 8.3950, 0.0010053,  28.193],
        [0.075,  40.29, 168.76,   2574.8, 0.5763, 8.2514, 0.0010080,  19.238],
        [0.100,  45.81, 191.81,   2584.6, 0.6492, 8.1501, 0.0010103,  14.674],
        [0.150,  53.97, 225.90,   2599.1, 0.7548, 8.0084, 0.0010146,  10.021],
        [0.200,  60.06, 251.38,   2609.7, 0.8319, 7.9085, 0.0010182,   7.649],
        [0.300,  69.10, 289.21,   2625.3, 0.9439, 7.7686, 0.0010243,   5.229],
        [0.500,  81.33, 340.47,   2645.9, 1.0910, 7.5939, 0.0010341,   3.240],
        [0.700,  89.95, 376.70,   2660.1, 1.1919, 7.4790, 0.0010416,   2.365],
        [1.00,   99.62, 417.44,   2675.5, 1.3025, 7.3593, 0.0010432,   1.6940],
        [1.25,  105.99, 444.30,   2685.3, 1.3739, 7.2843, 0.0010479,   1.3750],
        [1.50,  111.37, 467.08,   2693.5, 1.4335, 7.2232, 0.0010524,   1.1590],
        [2.00,  120.23, 504.68,   2706.6, 1.5300, 7.1271, 0.0010605,   0.8857],
        [2.50,  127.43, 535.34,   2716.9, 1.6072, 7.0526, 0.0010681,   0.7187],
        [3.00,  133.55, 561.45,   2725.3, 1.6717, 6.9918, 0.0010732,   0.6058],
        [4.00,  143.63, 604.73,   2738.5, 1.7766, 6.8958, 0.0010840,   0.4624],
        [5.00,  151.86, 640.21,   2748.7, 1.8606, 6.8212, 0.0010940,   0.3748],
        [6.00,  158.85, 670.54,   2756.8, 1.9311, 6.7600, 0.0011006,   0.3156],
        [7.00,  164.97, 697.20,   2763.5, 1.9922, 6.7080, 0.0011080,   0.2728],
        [8.00,  170.43, 721.10,   2769.1, 2.0461, 6.6627, 0.0011148,   0.2404],
        [9.00,  175.38, 742.82,   2773.9, 2.0946, 6.6225, 0.0011213,   0.2150],
        [10.00, 179.91, 762.79,   2778.1, 2.1386, 6.5864, 0.0011273,   0.1944],
        [12.00, 187.99, 798.64,   2784.8, 2.2165, 6.5233, 0.0011390,   0.1633],
        [15.00, 198.32, 844.87,   2792.1, 2.3150, 6.4448, 0.0011565,   0.1318],
        [20.00, 212.42, 908.77,   2799.5, 2.4473, 6.3408, 0.0011767,   0.0996],
        [25.00, 223.99, 962.09,   2803.1, 2.5546, 6.2574, 0.0011972,   0.0800],
        [30.00, 233.90,1008.41,   2804.1, 2.6456, 6.1869, 0.0012163,   0.0666],
        [35.00, 242.60,1049.75,   2803.8, 2.7253, 6.1253, 0.0012347,   0.0571],
        [40.00, 250.40,1087.29,   2801.4, 2.7963, 6.0700, 0.0012524,   0.0498],
        [50.00, 263.99,1154.21,   2794.3, 2.9201, 5.9733, 0.0012859,   0.0394],
        [60.00, 275.64,1213.32,   2784.3, 3.0248, 5.8902, 0.0013190,   0.0324],
        [70.00, 285.88,1266.97,   2772.1, 3.1210, 5.8132, 0.0013524,   0.0274],
        [80.00, 295.06,1316.61,   2757.9, 3.2076, 5.7450, 0.0013843,   0.0235],
        [90.00, 303.40,1363.26,   2742.8, 3.2857, 5.6811, 0.0014184,   0.0205],
        [100.00,311.06,1407.53,   2724.7, 3.3595, 5.6140, 0.0014526,   0.0180],
        [110.00,318.15,1450.26,   2705.0, 3.4295, 5.5473, 0.0014890,   0.0160],
        [120.00,324.75,1491.24,   2684.8, 3.4961, 5.4923, 0.0015267,   0.0143],
        [130.00,330.93,1531.46,   2662.9, 3.5605, 5.4295, 0.0015670,   0.0127],
        [140.00,336.75,1570.98,   2638.7, 3.6229, 5.3717, 0.0016107,   0.0115],
        [150.00,342.24,1609.02,   2614.5, 3.6834, 5.3108, 0.0016582,   0.0103],
        [160.00,347.44,1649.55,   2580.6, 3.7428, 5.2455, 0.0017105,   0.0094],
        [170.00,352.37,1690.73,   2548.5, 3.7996, 5.1832, 0.0017651,   0.0084],
        [180.00,357.06,1731.97,   2509.1, 3.8553, 5.1044, 0.0018403,   0.0075],
        [190.00,361.54,1776.53,   2468.4, 3.9102, 5.0218, 0.0019262,   0.0067],
        [200.00,365.81,1826.18,   2409.7, 4.0139, 4.9269, 0.0020360,   0.0059],
        [210.00,369.89,1886.25,   2336.8, 4.1014, 4.8013, 0.0022130,   0.0051],
        [220.00,373.71,2010.30,   2192.4, 4.2887, 4.5481, 0.0027900,   0.0038],
        [220.64,374.14,2099.26,   2099.3, 4.4120, 4.4120, 0.0031550,   0.0032],
    ];
    return raw.map(r => ({
        P:r[0], T:r[1], hf:r[2], hg:r[3], hfg:r[3]-r[2],
        sf:r[4], sg:r[5], sfg:r[5]-r[4], vf:r[6], vg:r[7]
    }));
})();

// ── Superheated steam table — [T°C, h(kJ/kg), s(kJ/kg·K), v(m³/kg)] ──
const SH_FB = [
  {P:1,   d:[[100,2676.2,7.361,1.696],[150,2776.5,7.615,1.937],[200,2875.5,7.835,2.172],[250,2974.5,8.033,2.406],[300,3074.3,8.217,2.639],[350,3175.8,8.390,2.871],[400,3279.6,8.545,3.103],[500,3488.1,8.834,3.565],[600,3705.4,9.102,4.028],[700,3928.7,9.352,4.490],[800,4159.0,9.586,4.952]]},
  {P:5,   d:[[152,2748.7,6.821,0.375],[200,2855.4,7.059,0.425],[250,2961.0,7.272,0.474],[300,3064.2,7.460,0.523],[350,3168.1,7.633,0.570],[400,3272.3,7.794,0.617],[500,3484.9,8.087,0.711],[600,3704.3,8.352,0.804],[700,3927.1,8.605,0.897],[800,4157.8,8.840,0.990]]},
  {P:10,  d:[[180,2778.1,6.587,0.1944],[200,2827.9,6.694,0.2060],[250,2942.6,6.925,0.2328],[300,3051.2,7.123,0.2579],[350,3157.7,7.301,0.2825],[400,3264.5,7.465,0.3066],[500,3478.5,7.762,0.3541],[600,3697.9,8.029,0.4011],[700,3922.5,8.281,0.4479],[800,4154.5,8.516,0.4945]]},
  {P:20,  d:[[213,2799.5,6.341,0.0996],[250,2902.5,6.545,0.1114],[300,3023.5,6.768,0.1255],[350,3137.0,6.958,0.1385],[400,3248.7,7.127,0.1520],[500,3467.6,7.432,0.1757],[600,3687.9,7.702,0.1996],[700,3913.3,7.955,0.2233],[800,4142.0,8.192,0.2467]]},
  {P:40,  d:[[251,2801.4,6.070,0.0498],[300,2962.0,6.362,0.0589],[350,3092.5,6.584,0.0666],[400,3213.6,6.771,0.0734],[500,3445.3,7.090,0.0864],[600,3670.3,7.369,0.0989],[700,3894.9,7.624,0.1112],[800,4122.0,7.861,0.1234]]},
  {P:60,  d:[[276,2784.3,5.890,0.0324],[300,2885.5,6.070,0.0362],[350,3043.4,6.336,0.0421],[400,3178.3,6.545,0.0474],[450,3301.8,6.719,0.0522],[500,3422.2,6.883,0.0567],[600,3658.4,7.169,0.0653],[700,3876.1,7.428,0.0736],[800,4095.0,7.667,0.0818]]},
  {P:80,  d:[[295,2758.4,5.745,0.0235],[300,2786.5,5.794,0.0243],[350,2988.1,6.132,0.0299],[400,3139.4,6.366,0.0343],[500,3398.3,6.727,0.0398],[600,3633.2,7.059,0.0480],[700,3857.2,7.321,0.0543],[800,4074.0,7.562,0.0604]]},
  {P:100, d:[[311,2725.5,5.614,0.0180],[350,2924.5,5.945,0.0228],[400,3096.5,6.212,0.0264],[450,3249.0,6.419,0.0297],[500,3374.2,6.599,0.0328],[600,3625.3,6.903,0.0384],[700,3838.2,7.176,0.0427],[800,4053.0,7.418,0.0487]]},
  {P:120, d:[[325,2684.9,5.492,0.0143],[360,2820.0,5.752,0.0165],[400,3051.6,6.004,0.0208],[450,3215.9,6.233,0.0236],[500,3350.7,6.425,0.0262],[600,3582.3,6.742,0.0308],[700,3793.5,7.027,0.0351],[800,4032.0,7.271,0.0405]]},
  {P:140, d:[[337,2637.6,5.372,0.0115],[360,2753.0,5.581,0.0132],[400,3001.9,5.845,0.0166],[450,3182.5,6.086,0.0191],[500,3323.1,6.285,0.0214],[600,3541.2,6.604,0.0260],[700,3762.2,6.898,0.0302],[800,4011.0,7.143,0.0352]]},
  {P:160, d:[[347,2580.6,5.246,0.0093],[380,2745.0,5.508,0.0115],[400,2947.0,5.693,0.0132],[450,3146.1,5.951,0.0157],[500,3295.0,6.156,0.0178],[600,3561.1,6.513,0.0214],[700,3732.3,6.781,0.0256],[800,3989.0,7.029,0.0302]]},
  {P:180, d:[[357,2509.1,5.104,0.0075],[390,2748.0,5.484,0.0100],[400,2880.1,5.554,0.0107],[450,3104.9,5.827,0.0130],[500,3266.1,6.037,0.0149],[600,3542.0,6.409,0.0181],[700,3701.4,6.657,0.0218],[800,3968.0,6.909,0.0260]]},
  {P:200, d:[[366,2409.7,4.927,0.0059],[395,2702.0,5.378,0.0085],[400,2818.1,5.472,0.0099],[450,3060.1,5.796,0.0121],[500,3239.3,6.018,0.0145],[600,3532.0,6.336,0.0175],[700,3670.6,6.589,0.0210],[800,3947.0,6.845,0.0249]]},
];

// ── Cubic-spline interpolation (exact copy from original) ──────
function csplineInterp(xs, ys, x) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n-1]) return ys[n-1];
    let i = 0;
    for (let j = 0; j < n-1; j++) { if (xs[j] <= x && x <= xs[j+1]) { i=j; break; } }
    const t=(x-xs[i])/(xs[i+1]-xs[i]), t2=t*t, t3=t2*t, h=xs[i+1]-xs[i];
    const m1 = i>0     ? (ys[i+1]-ys[i-1])/(xs[i+1]-xs[i-1]) : (ys[i+1]-ys[i])/h;
    const m2 = i<n-2   ? (ys[i+2]-ys[i])  /(xs[i+2]-xs[i])   : (ys[i+1]-ys[i])/h;
    return ys[i]*(2*t3-3*t2+1)+ys[i+1]*(-2*t3+3*t2)+m1*h*(t3-2*t2+t)+m2*h*(t3-t2);
}

// ── Saturation props by pressure (exact copy from original getSatProps) ──
function getSatProps(P_bar) {
    if (!P_bar || P_bar <= 0) P_bar = 0.00611;
    if (P_bar <= SAT_TABLE[0].P) return {...SAT_TABLE[0]};
    if (P_bar >= SAT_TABLE[SAT_TABLE.length-1].P) return {...SAT_TABLE[SAT_TABLE.length-1]};
    const xs = SAT_TABLE.map(r=>r.P);
    const interp = key => csplineInterp(xs, SAT_TABLE.map(r=>r[key]), P_bar);
    const hf=interp('hf'), hg=interp('hg'), sf=interp('sf'), sg=interp('sg');
    return { P:P_bar, T:interp('T'), hf, hg, hfg:hg-hf, sf, sg, sfg:sg-sf,
             vf:interp('vf'), vg:interp('vg') };
}

// ── Superheated props (exact copy from original getSuperheatedProps_fb) ──
function getSuperheatedProps(P_bar, T_C) {
    const sat = getSatProps(P_bar);
    if (T_C <= sat.T + 0.5) return { h:sat.hg, s:sat.sg, v:sat.vg, phase:'sat' };
    const prs = SH_FB.map(b=>b.P);
    function atBlock(idx, T) {
        const d = SH_FB[idx].d;
        return {
            h: csplineInterp(d.map(r=>r[0]), d.map(r=>r[1]), T),
            s: csplineInterp(d.map(r=>r[0]), d.map(r=>r[2]), T),
            v: csplineInterp(d.map(r=>r[0]), d.map(r=>r[3]), T)
        };
    }
    if (P_bar <= prs[0]) return { ...atBlock(0, T_C), phase:'superheated' };
    if (P_bar >= prs[prs.length-1]) return { ...atBlock(prs.length-1, T_C), phase:'superheated' };
    let lo = 0;
    for (let i=0; i<prs.length-1; i++) { if (prs[i]<=P_bar && P_bar<=prs[i+1]) { lo=i; break; } }
    const fP = (P_bar-prs[lo])/(prs[lo+1]-prs[lo]);
    const a = atBlock(lo, T_C), b = atBlock(lo+1, T_C);
    return { h:a.h+fP*(b.h-a.h), s:a.s+fP*(b.s-a.s), v:a.v+fP*(b.v-a.v), phase:'superheated' };
}

// ── Isentropic exhaust enthalpy (exact copy from original isentropicExhaustEnthalpy_fb) ──
function isentropicExhaust(s1_SI, P2_bar, T2_C_opt) {
    const sat2 = getSatProps(P2_bar);
    if (T2_C_opt && T2_C_opt > sat2.T + 0.5) {
        const sup = getSuperheatedProps(P2_bar, T2_C_opt);
        return { h2s:sup.h, phase:'Superheated (specified T)' };
    }
    if (s1_SI >= sat2.sg) {
        // Superheated exit — bisection for T where s(P2,T)=s1
        let Tlo=sat2.T+1, Thi=1400;
        for (let iter=0; iter<60; iter++) {
            const Tmid=(Tlo+Thi)/2;
            const sp=getSuperheatedProps(P2_bar, Tmid);
            if(sp.s<s1_SI) Tlo=Tmid; else Thi=Tmid;
            if(Thi-Tlo<0.05) break;
        }
        const Tmid=(Tlo+Thi)/2;
        const sup=getSuperheatedProps(P2_bar, Tmid);
        return { h2s:sup.h, phase:`Superheated (T₂s ≈ ${Tmid.toFixed(0)}°C)` };
    } else if (s1_SI >= sat2.sf) {
        const x=(s1_SI-sat2.sf)/(sat2.sg-sat2.sf);
        return { h2s:sat2.hf+x*sat2.hfg, x, phase:`Wet (x=${(x*100).toFixed(1)}%)` };
    }
    return { h2s:sat2.hf, phase:'Subcooled / Liquid' };
}

// ================================================================
// VERCEL HANDLER
// ================================================================
export default function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    try {
        const b = req.body;

        // ── ACTION: inletProps ────────────────────────────────────
        // Used by autoSteam('inlet'), autoSteam('extraction'), autoSteam('mixed_ext')
        // Mirrors original autoSteam inlet branch:
        //   getSatProps(P) → check T vs T_sat → getSuperheatedProps_fb or sat
        if (b.action === 'inletProps') {
            const P_bar = Number(b.P_bar);
            const T_C   = b.T_C !== null && b.T_C !== undefined ? Number(b.T_C) : null;
            if (!P_bar || P_bar <= 0) return res.status(400).json({ error: 'Invalid P_bar' });

            const sat = getSatProps(P_bar);
            let props, phase;
            if (!T_C || T_C <= sat.T + 0.5) {
                props = { h:sat.hg, s:sat.sg, v:sat.vg };
                phase = 'sat';
            } else {
                props = getSuperheatedProps(P_bar, T_C);
                phase = 'superheated';
            }
            return res.json({ h:props.h, s:props.s, v:props.v, T_sat:sat.T, phase });
        }

        // ── ACTION: exhaustProps ──────────────────────────────────
        // Used by autoSteam('exhaust')
        // Mirrors original autoSteam exhaust branch:
        //   getSatProps(P2) → isentropicExhaustEnthalpy_fb(s1,P2) → h2s, hfg etc.
        if (b.action === 'exhaustProps') {
            const P_bar = Number(b.P_bar);
            const s1_SI = Number(b.s1_SI) || 0;
            const T2_C  = (b.T2_C !== null && b.T2_C !== undefined) ? Number(b.T2_C) : null;
            if (!P_bar || P_bar <= 0) return res.status(400).json({ error: 'Invalid P_bar' });

            const sat = getSatProps(P_bar);
            const { h2s } = isentropicExhaust(s1_SI || sat.sg, P_bar, T2_C);

            return res.json({
                h2s,
                hf: sat.hf, hg: sat.hg, hfg: sat.hfg,
                T_sat: sat.T, sf: sat.sf, sg: sat.sg
            });
        }

        // ── ACTION: calculate ─────────────────────────────────────
        // Mirrors original calculate() function exactly for all 4 turbine types.
        // Returns all values needed by _renderResults on the client.
        if (b.action === 'calculate') {
            const flow_kgh = Number(b.flow_kgh);
            const h1_SI    = Number(b.h1_SI);
            const h2s_SI   = Number(b.h2s_SI);
            const s1_SI    = Number(b.s1_SI) || 0;
            const p1_bar   = Number(b.p1_bar);
            const p2_bar   = Number(b.p2_bar);
            const eff      = Math.min(1, Math.max(0.01, Number(b.eff)));
            const effm     = Math.min(1, Math.max(0.01, Number(b.effm)));
            const effg     = Math.min(1, Math.max(0.01, Number(b.effg)));

            // Server-side validation (belt-and-suspenders)
            if (!flow_kgh||flow_kgh<=0) return res.status(400).json({error:'Invalid mass flow'});
            if (!h1_SI  ||h1_SI<=0)     return res.status(400).json({error:'Invalid h₁'});
            if (!h2s_SI ||h2s_SI<=0)    return res.status(400).json({error:'Invalid h₂s'});
            if (!p1_bar ||p1_bar<=0)    return res.status(400).json({error:'Invalid P₁'});
            if (!p2_bar ||p2_bar<=0)    return res.status(400).json({error:'Invalid P₂'});
            if (p2_bar>=p1_bar)         return res.status(400).json({error:'P₂ must be < P₁'});
            if (h1_SI<=h2s_SI)          return res.status(400).json({error:'h₁ must be > h₂s'});

            const mDot = flow_kgh / 3600;

            // Core: isentropic specific work + actual exit enthalpy
            const w_SI  = (h1_SI - h2s_SI) * eff;
            const h2_SI = h1_SI - w_SI;
            const sat2  = getSatProps(p2_bar);

            // Steam quality at exit
            let quality = null;
            if (h2_SI < sat2.hg) {
                quality = (h2_SI - sat2.hf) / sat2.hfg;
                if (quality < 0) quality = 0;
                if (quality > 1) quality = null;
            }

            const out = { w_SI, h2_SI, quality, sat2_T: sat2.T };

            const type = b.turbineType;

            // ── Back Pressure ─────────────────────────────────────
            if (type === 'backpressure') {
                const pw    = mDot * w_SI * effm;
                const pe    = pw * effg;
                const Q_in  = mDot * h1_SI;
                const Q_out = mDot * h2_SI;
                const eta   = Q_in > 0 ? pw / Q_in * 100 : 0;
                Object.assign(out, { pw, pe, Q_in, Q_out, eta });

            // ── Condensing ────────────────────────────────────────
            } else if (type === 'condensing') {
                const cwIn_C   = Number(b.cwIn_C);
                const cwOut_C  = Number(b.cwOut_C);
                const hf_SI    = Number(b.hf_SI);
                const condP_bar= Number(b.condP_bar) || p2_bar;
                const pw       = mDot * w_SI * effm;
                const pe       = pw * effg;
                const Q_cond   = mDot * Math.max(0, h2_SI - hf_SI);
                const dT_cw    = cwOut_C - cwIn_C;
                const mDot_cw  = dT_cw > 0 ? Q_cond / (4.187 * dT_cw) : 0;
                const Q_in     = mDot * h1_SI;
                const heatRate = pw > 0 ? 3600 * mDot * h1_SI / pw : 0;
                const eta      = Q_in > 0 ? pw / Q_in * 100 : 0;
                const satCond  = getSatProps(condP_bar);
                Object.assign(out, { pw, pe, Q_cond, mDot_cw, dT_cw, heatRate, eta,
                                     condP_bar, satCond_T: satCond.T });

            // ── Extraction ────────────────────────────────────────
            } else if (type === 'extraction') {
                const extFrac = Number(b.extFrac);
                const he_SI   = Number(b.he_SI);
                const mExt    = mDot * extFrac;
                const mExh    = mDot * (1 - extFrac);
                const w_HP    = (h1_SI - he_SI) * eff;
                const w_LP    = (he_SI - h2s_SI) * eff;
                const pw      = (mDot * w_HP + mExh * w_LP) * effm;
                const pe      = pw * effg;
                const h2_exh  = he_SI - w_LP;
                const Q_proc  = mExt * (he_SI - 419);   // hf_proc = 419 kJ/kg (100°C)
                const Q_in    = mDot * h1_SI;
                const eta     = Q_in > 0 ? pw / Q_in * 100 : 0;
                Object.assign(out, { pw, pe, Q_proc, eta, w_HP, w_LP, he_SI, h2_exh,
                                     extFrac, mExt, mExh });

            // ── Mixed (extraction + condensing) ───────────────────
            } else if (type === 'mixed') {
                const extFrac2 = Number(b.extFrac2);
                const he2_SI   = Number(b.he2_SI);
                const cwIn2_C  = Number(b.cwIn2_C);
                const cwOut2_C = Number(b.cwOut2_C);
                const hf2_SI   = Number(b.hf2_SI);
                const mExt2    = mDot * extFrac2;
                const mExh2    = mDot * (1 - extFrac2);
                const w_HP2    = (h1_SI - he2_SI) * eff;
                const w_LP2    = (he2_SI - h2s_SI) * eff;
                const pw       = (mDot * w_HP2 + mExh2 * w_LP2) * effm;
                const pe       = pw * effg;
                const h2_exh2  = he2_SI - w_LP2;
                const Q_cond2  = Math.max(0, mExh2 * (h2_exh2 - hf2_SI));
                const dT2      = cwOut2_C - cwIn2_C;
                const mDot_cw2 = dT2 > 0 ? Q_cond2 / (4.187 * dT2) : 0;
                const Q_proc2  = mExt2 * (he2_SI - 419);
                const Q_in     = mDot * h1_SI;
                const eta      = Q_in > 0 ? pw / Q_in * 100 : 0;
                Object.assign(out, { pw, pe, Q_cond:Q_cond2, mDot_cw:mDot_cw2, dT_cw:dT2,
                                     Q_proc:Q_proc2, eta, w_HP:w_HP2, w_LP:w_LP2,
                                     he_SI:he2_SI, h2_exh:h2_exh2,
                                     extFrac:extFrac2, mExt:mExt2, mExh:mExh2 });
            } else {
                return res.status(400).json({ error: 'Unknown turbineType' });
            }

            return res.json(out);
        }

        return res.status(400).json({ error: 'Unknown action' });

    } catch (err) {
        console.error('API error:', err);
        return res.status(500).json({ error: 'Internal server error', detail: err.message });
    }
}
