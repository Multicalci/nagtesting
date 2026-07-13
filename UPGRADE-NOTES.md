HeatXpert Pro — Capability Upgrade (2026-07)
"3.5 → 5.5" release: zone marching, clearance-based Bell-Delaware, vibration screening, validation suite
1. Zone-wise incremental design for phase change (biggest single win)
Condensers and evaporators are no longer sized with one U and one LMTD.
Condensing (`marchCondensingZones`): desuperheat zone (vapour crossflow HTC) →
condensation marched in 8 quality increments (Nusselt film with per-zone wall-temperature
iteration) → subcool zone (liquid crossflow HTC). Counter-current coolant temperature
profile per zone. `A\_req = Σ Qᵢ/(Uᵢ·ΔTᵢ)`.
Evaporating (`marchEvaporatingZones`): optional subcooled preheat zone, then boiling
marched in 8 quality increments. Chen correlation evaluated at local quality with
local heat flux (q = U·ΔT iterated 3× per zone — replaces the fixed 20 kW/m²
assumption). Dryout flagged when duty exceeds latent capacity.
Why it matters: in the steam-condenser test case the desuperheat zone consumes 20% of
the area for only 3.4% of the duty (local U = 158 vs 1330 W/m²K in the condensing
zones). A single-point method cannot see this — HTRI's incremental method can, and now
so can HeatXpert. Results expose `zoneModel` (per-zone table) and `U\_effective`
(duty-consistent U), both rendered in the UI.
2. Clearance-based Bell-Delaware leakage/bypass (`bdLeakGeometry`)
Replaced per-TEMA-class constants with actual diametral clearances:
Stream	Clearance basis
Tube-to-baffle δ_tb	TEMA RCB-4.2: 0.4 mm (OD ≤ 31.75 mm, span ≤ 914 mm) else 0.8 mm
Shell-to-baffle δ_sb	1.6 + 0.004·Ds mm (Taborek/HEDH)
Bundle bypass L_bb	head-type based: fixed 12 / split-ring 35 / pull-through 95 mm (+0.005·Ds)
Leakage areas S_tb, S_sb and bypass fraction F_sbp computed from real geometry, then the
published correction forms: Jl = 0.44(1−r_s)+[1−0.44(1−r_s)]e^(−2.2·r_lm);
Jb = e^(−C·F_sbp(1−(2r_ss)^⅓)); ΔP uses matching Rl = e^(−1.33(1+r_s)·r_lm^p),
Rb = e^(−C_bp·F_sbp(1−(2r_ss)^⅓)). Same geometry object feeds HTC and ΔP — no more
divergent assumptions between the two.
Jc bug fixed en route: the baffle-cut correction was fed the cut fraction (0.25)
where Fc — the fraction of tubes in crossflow (≈0.61 at a 25% cut) — belongs. Jc was
0.62 instead of ≈0.99, under-predicting shell HTC ~35-40% on every prior run.
3. Flow-induced vibration screen (`calcVibrationScreen`)
TEMA-V-style checks on every shell & tube run, rendered as a dedicated panel:
Tube natural frequency — pinned-pinned central span; tube metal + tube-side fluid
Blevins confined added mass (Cm from pitch ratio).
Fluidelastic instability — Connors, K = 3.0, log decrement 0.10 liquid / 0.03 gas.
V/V_crit > 0.8 → warning; > 1.0 → design status forced to error.
Vortex shedding (St = 0.2) resonance band vs f_n (liquids).
Turbulent buffeting dominant frequency (Owen 1965) vs f_n.
Acoustic resonance (gas shells): first transverse shell mode vs excitation.
Clearly labelled a screen: it flags risk for detailed analysis; it does not clear a
final design (end spans, nozzle-zone velocities and U-bends need span-by-span checks).
4. Validation suite (`validation-suite.mjs`)
Three honest tiers — no invented reference numbers:
Tier 1 — analytic identities (10 checks): energy closure, Q = U_eff·A·FLMTD,
LMTD limits, crossflow-F round-trip inversion, zone sums = totals, Nm³/Sm³ algebra,
laminar Nu floor, f_n ∝ 1/L².
Tier 2 — literature-equation recomputation (7 checks): Gnielinski, Nusselt film,
Chen monotonicity/floor, Jc vs published form, Jl band, Connors V_crit, PR Z for
dense CO₂.
Tier 3 — external benchmarks: harness ready for HTRI / vendor / plant cases.
Paste real reference values into `EXTERNAL\_CASES`; empty slots report SKIP, never
fabricated numbers. This tier is what ultimately earns design-grade trust — fill it
from your IFFCO HTRI runs.
Current status: 21 PASS / 0 FAIL / 4 SKIP (1 structural, 3 awaiting external data).
Bugs the suite caught on its first run (all fixed)
Condensing Q halved — a post-loop sensible-only cTo recompute ran for condensing
mode, overwriting the latent-based value (Qc collapsed to the desuperheat fraction).
Chen F(Xtt) branch inverted — F = 1 was returned at high quality (Xtt ≤ 0.1),
exactly where enhancement peaks, so h_tp fell with quality.
Peng-Robinson Z broken — dimensionally wrong `a` term; dense CO₂ returned Z = 1.10
vs correct PR root 0.39. Rewritten in standard reduced form (A = 0.45724αPr/Tr²,
B = 0.0778Pr/Tr).
Run the suite
```
node validation-suite.mjs ./heat-exchanger.js
```
Exit code 1 on any FAIL — wire it into a GitHub Action on the api/ path if you want
regression protection per commit.
Honest position after this release
Single-phase S&T: preliminary-design grade with realistic stream-analysis corrections.
Phase change: now zone-marched — materially closer to incremental-method behaviour,
still single-correlation per mechanism (no flow-regime maps, no shear-controlled
condensation, no dryout/post-dryout). Vibration: screening only. The path from here to
higher fidelity runs through Tier-3 benchmark data, not more correlations.
---
v7 release (2026-07): the "route to 7"
5. CoolProp property engine (NIST-grade, graceful fallback)
`coolprop-wasm@6.6.0` (6.8 MB, MIT) loaded lazily on first request, cached across warm
invocations. ~20 fluids mapped to Helmholtz-EOS reference equations (water/steam IAPWS-95,
ammonia Tillner-Roth, CO₂ Span-Wagner, glycols via INCOMP backend). Oils, brines and food
fluids deliberately stay on the built-in DB — CoolProp has no model for them. Every
response carries `propSource`; the UI shows a badge. If the npm package is absent the
API works identically on the built-in DB — validated in both modes.
Immediate accuracy wins measured: steam condenser at 2.7 bar now uses the true
Tsat = 129.97 °C and hvap = 2174 kJ/kg (DB constants were 100 °C / 2257 — every zone LMTD
was wrong); ammonia evaporator at 4 bar boils at −1.87 °C exactly.
Saturation-property priority (all duty branches): CoolProp exact → Antoine/Watson
estimate → DB constant.
Deploy: commit `package.json` to the repo root (GitHub web editor is fine); Vercel
installs the dependency on next build. Nothing else changes.
6. Modern two-phase correlations
Gungor-Winterton (1986) flow boiling in the evaporator marcher: E/S factors, Boiling
number coupling to local iterated heat flux, Cooper pool term at true reduced pressure,
horizontal-tube Froude stratification correction, and a flagged post-dryout blend to
vapour-only DB above x = 0.85. Chen retained via `boilCorr:'chen'`.
Bundle condensation: Kern condensate-inundation (h₁·N⁻¹ᐟ⁶) combined with the
McNaught (1982) shear term h_sh = 1.26·(1/Xtt)^0.78·h_l as h = √(h_grav² + h_sh²);
Breber J*g labels each zone gravity / mixed / shear. The zone table now shows the
governing mechanism per increment.
7. Span-by-span vibration
Three spans evaluated per design: central, end zone, and window tubes (2× spacing,
fₙ ÷ 4) — where real FEI failures start and single-span screens are blind. Plus TEMA
RCB-4.52 maximum-unsupported-span check (anchored exactly: 19.05 mm → 1524 mm,
25.4 mm → 1880 mm) and TEMA RCB-4.6 inlet ρv² impingement screening (estimated nozzle,
flagged as an estimate). Worst span drives the verdict.
Suite status
36 PASS / 0 FAIL with CoolProp · 32 PASS / 0 FAIL fallback mode · 3 Tier-3 slots
awaiting your HTRI/vendor data. New Tier-2 coverage: Cooper vs literature equation, G-W
E and S recomputed from the 1986 paper, Kern N⁻¹ᐟ⁶ identity, McNaught shear monotonicity,
Antoine vs steam tables, CoolProp vs NIST anchors, TEMA span anchors, window-tube fₙ÷4.
One correction the suite forced during this release: the interrupted-session Antoine/Watson
helpers were overriding CoolProp's exact saturation values (NH₃ Tsat 0.02 °C vs true
−1.87 °C) — priority inverted, regression-guarded by check 2.13.
Honest position at v7
Single-phase: preliminary-design grade with full stream-analysis corrections and NIST
properties. Phase change: incremental method with regime-aware modern correlations —
the same architecture as commercial tools, at coarser resolution. Vibration: span-aware
screening incl. the window-tube failure mode. Remaining distance to HTRI is now almost
entirely data, not method: fill Tier-3, and state the measured deviations on the pa
