# multicalci.com — Free Engineering Calculators

Free browser-based engineering calculators and reference tools for process, chemical, mechanical, electrical, civil and instrumentation engineers.

All calculators implement recognised international engineering standards. No login, no subscription, no installation — runs entirely in the browser. Built and maintained by a practicing chemical engineer with experience across power/utilities, pharmaceutical, and petrochemical industries.

**Site:** https://www.multicalci.com

---

## Contents

- [Process & Fluid Systems](#process--fluid-systems)
- [Heat Transfer & Thermodynamics](#heat-transfer--thermodynamics)
- [Vessels, Separators & Materials](#vessels-separators--materials)
- [Mechanical Engineering](#mechanical-engineering)
- [Civil Engineering](#civil-engineering)
- [Electrical Engineering](#electrical-engineering)
- [Instrumentation](#instrumentation)
- [Standards & Reference Tools](#standards--reference-tools)
- [Unit Converter](#unit-converter)
- [Standards Implemented](#standards-implemented)

---

## Process & Fluid Systems

### Orifice Design & Sizing Calculator
**Standard:** ISO 5167-2:2022 (also ISO 5167-3 nozzles, ISO 5167-4 venturi)
**Method:** Reader-Harris/Gallagher discharge coefficient equation
**URL:** https://www.multicalci.com/orifice-flow-calculator

Sizes orifice plates, ISA nozzles and venturi tubes for flow measurement in liquid, gas and steam service. Iterative Cd solution, beta ratio, differential pressure, permanent pressure loss, isentropic expansion factor and flow uncertainty. Corner, flange and D & D/2 taps. SI and Imperial.

Key equations:
- Reader-Harris/Gallagher: `Cd = 0.5961 + 0.0261β² − 0.216β⁸ + 0.000521(10⁶β/Re)^0.7 + ...`
- Expansibility: `Y = 1 − (0.351 + 0.256β⁴ + 0.93β⁸)[1 − (P2/P1)^(1/κ)]`
- Mass flow: `qm = Cd · E · Y · (π/4)d² · √(2ΔPρ)`, `E = 1/√(1−β⁴)`

---

### Control Valve Sizing Calculator
**Standard:** IEC 60534 / ISA 75.01
**URL:** https://www.multicalci.com/control-valve-sizing
**Sub-tool:** Actuator sizing — https://www.multicalci.com/control-valve-sizing/actuator-sizing

Sizes control valves for liquid, compressible gas and steam service. Flow coefficient Cv and Kv, pressure recovery factor FL, choked flow differential pressure, cavitation index, piping geometry factor Fp, inherent characteristic and noise prediction.

Key equations:
- Liquid flow: `Cv = Q × √(SG / ΔP)`
- Choked flow: `ΔP_choked = FL² × (P1 − Ff × Pv)`
- Cavitation index: `σ = (P1 − Pv) / ΔP`

---

### PSV / Relief Valve Sizing
**Standards:** API 520, API 521, API 526
**URL:** https://www.multicalci.com/pressure-relief-valve-sizing

Sizes pressure relief valves for gas/vapour, steam, liquid, fire case (wetted and unwetted) and two-phase service using the omega method. Automatic API 526 letter-orifice selection from D to T.

---

### Pipe Pressure Drop Calculator
**Standards:** Darcy-Weisbach; Colebrook-White; Hazen-Williams; Hagen-Poiseuille
**URL:** https://www.multicalci.com/pressure-drop-calculator

Friction pressure drop in pipes for a 119-fluid library. Colebrook-White friction factor for turbulent flow, Hagen-Poiseuille for laminar. Fitting losses via K-method, elevation head, multi-segment networks and erosional velocity check.

Key equations:
- Darcy-Weisbach: `ΔP = f × (L/D) × (ρv²/2)`
- Colebrook-White: `1/√f = −2log(ε/3.7D + 2.51/Re√f)`
- Laminar: `ΔP = 128μLQ / πD⁴`

---

### NPSH Calculator
**Standard:** Hydraulic Institute
**URL:** https://www.multicalci.com/npsh-calculator

Net Positive Suction Head available (NPSHa) for centrifugal pumps. Suction-side friction losses, vapour pressure correction, elevation head and velocity head. 31-fluid library. Cavitation check against NPSHr margin.

Key equation:
- `NPSHa = (Ps/ρg) + (vs²/2g) + Hs − (Pv/ρg) − hf`

---

### Head & Pressure Calculator
**URL:** https://www.multicalci.com/head-pressure-calculator

Static, dynamic and total head. Pump head, system curve and fluid column pressure for any fluid density and elevation difference.

---

### Pump, Compressor & Fan Calculator
**URL:** https://www.multicalci.com/fluid-machinery-calculator

Centrifugal and positive-displacement pumps (NPSHA/NPSHR, affinity laws), multi-stage compressors with intercoolers, fans and blowers — isentropic and polytropic.

Key equations:
- Pump hydraulic power: `P = ρgQH / η`
- Affinity laws: `Q2/Q1 = N2/N1`; `H2/H1 = (N2/N1)²`; `P2/P1 = (N2/N1)³`
- Specific speed: `Ns = N√Q / H^(3/4)`

---

### Pump Power Calculator
**URL:** https://www.multicalci.com/pump-power-calculator

Hydraulic power, brake (shaft) power and motor input power from flow rate, head, specific gravity and pump/motor efficiency. Output in kW and hp.

---

### Gas Equation of State Calculator
**Standards:** Peng-Robinson EOS; Soave-Redlich-Kwong (SRK) EOS; van der Waals EOS
**URL:** https://www.multicalci.com/gas-equation-of-state

Real gas compressibility factor Z, molar volume, density and fugacity coefficient for pure gases and multi-component mixtures.

Key equations:
- Peng-Robinson: `P = RT/(V−b) − a(T)/[V(V+b) + b(V−b)]`
- SRK: `P = RT/(V−b) − a(T)/[V(V+b)]`

---

### Pipe Velocity & Sizing Calculator
**URL:** https://www.multicalci.com/pipe-velocity-calculator

Flow velocity from flow rate and pipe ID, or recommended inside diameter and nearest NPS size from flow rate and target velocity.

---

### Pipe Volume Calculator
**URL:** https://www.multicalci.com/pipe-volume-calculator

Internal volume and liquid fill capacity from pipe ID and length, or from NPS and schedule. Output in litres, US gallons, m³, barrels and liquid weight.

---

### Pipe Weight Calculator
**Standards:** ASME B36.10M / B36.19M
**URL:** https://www.multicalci.com/pipe-weight-calculator

Pipe weight per metre or foot and total weight, from NPS and schedule or from custom OD and wall thickness.

---

### Flange Rating Calculator
**Standard:** ASME B16.5
**URL:** https://www.multicalci.com/flange-rating-calculator

Pressure-temperature class lookup. Select flange class and material group, enter design temperature for interpolated allowable pressure. Classes 150 to 2500.

---

### Material & Energy Balance *(Beta)*
**URL:** https://www.multicalci.com/material-balance

Flowsheet mass and energy balances across mixer, splitter, flash drum, heat exchanger, pump/compressor/turbine and conversion reactor unit operations. NIST-based enthalpies on a formation basis, IAPWS-IF97 steam properties, chainable units.

---

### Water Treatment Calculator
**URL:** https://www.multicalci.com/water-treatment-calculator

Chemical dosing, blowdown rates and cycles of concentration for boiler and cooling tower water treatment systems.

---

## Heat Transfer & Thermodynamics

### Heat Exchanger Design
**Standards:** Bell-Delaware method (shellside); TEMA
**URL:** https://www.multicalci.com/heat-exchanger-design

Thermal and hydraulic rating of shell-and-tube heat exchangers. LMTD and correction factor F, NTU-effectiveness, overall U (clean and fouled), shellside and tubeside pressure drop, fouling resistance. 80+ fluids. TEMA E/F/G/H/J/X shell types.

Key equations:
- `Q = U × A × LMTD × Ft`
- `1/U = 1/ho + Rfo + (t/kw) + Rfi + 1/hi`

---

### LMTD Calculator
**URL:** https://www.multicalci.com/lmtd-calculator

Log mean temperature difference for counter-current or co-current exchangers, with optional correction factor F for multi-pass units.

---

### Steam Properties Calculator
**Standard:** IAPWS-IF97
**URL:** https://www.multicalci.com/steam-properties-calculator

Thermodynamic and transport properties of water and steam across all regions: compressed liquid (Region 1), two-phase (Region 4), superheated steam (Region 2), supercritical (Region 3). Enthalpy, entropy, specific volume, viscosity, thermal conductivity, Prandtl number.

---

### Steam Turbine Power Calculator
**Standard:** IAPWS-IF97
**URL:** https://www.multicalci.com/steam-turbine-power-calculator

Isentropic and actual enthalpy drop, shaft power, electrical generation, condenser duty and exhaust steam quality for back-pressure and condensing turbines.

Key equation:
- `W_actual = ṁ × (h1 − h2s) × η_isentropic`

---

### Rankine Cycle Calculator
**Standard:** IAPWS-IF97
**URL:** https://www.multicalci.com/rankine-cycle-calculator

Ideal and actual Rankine cycle analysis. Thermal efficiency, boiler heat input, turbine and pump work, condenser heat rejection, net specific work, heat rate.

Key equation:
- `η_thermal = W_net / Q_boiler`

---

### Steam Quench / Desuperheater Calculator
**Standard:** IAPWS-IF97
**URL:** https://www.multicalci.com/steam-quench-calculator

Quench water (desuperheating water) flow rate for steam temperature control via mass and energy balance.

Key equation:
- `ṁ_steam_in × h_in + ṁ_quench × h_quench = ṁ_steam_out × h_out`

---

### Psychrometric Calculator
**URL:** https://www.multicalci.com/psychrometric-calculator

Moist air properties for HVAC and drying system design: dew point, wet-bulb temperature, relative humidity, humidity ratio, specific enthalpy and specific volume. Altitude-corrected atmospheric pressure.

---

### Cooling Tower Performance
**Standard:** CTI ATC-105; Merkel method
**URL:** https://www.multicalci.com/cooling-tower-performance

Thermal performance of counterflow and crossflow towers. Tower characteristic KaV/L by adaptive Simpson integration, approach, range, L/G ratio, fan power, drift and evaporation losses. IAPWS-IF97 psychrometrics. Altitude correction.

Key equation:
- Merkel: `KaV/L = ∫[dT / (hw − ha)]` from cold water temperature to hot water temperature

---

### Insulation Heat Loss Calculator
**URL:** https://www.multicalci.com/insulation-heat-loss-calculator

Heat loss and jacket surface temperature for insulated pipes, tanks, spheres and buried lines. Multi-layer construction, temperature-dependent conductivity, condensation check and personnel burn-risk check.

---

## Vessels, Separators & Materials

### Tank Volume Calculator
**Standard:** ASME F&D (torispherical) head geometry
**URL:** https://www.multicalci.com/tank-volume-calculator

Horizontal and vertical tanks with flat, hemispherical, 2:1 ellipsoidal, torispherical (ASME F&D) or conical heads. Exact circular-segment shell volume, partial-fill volume at any level, liquid mass and downloadable CSV dip chart in m³, litres and US gallons.

Key equation:
- Spheroidal head pair: `V = π·a·h²·(3R−h)/(3R)` — exact for hemispherical and 2:1 ellipsoidal

---

### Vessel & Separator Sizing
**Standards:** API 12J (separators); ASME Section VIII Division 1 (pressure vessels)
**URL:** https://www.multicalci.com/vessel-separator-sizing

Horizontal and vertical gas-liquid separators and pressure vessel wall thickness. Vessel internal diameter, seam-to-seam length, L/D ratio, droplet settling velocity, retention time, mist eliminator sizing, minimum shell thickness, nozzle reinforcement area.

---

### Pressure Vessel Thickness Calculator
**Standard:** ASME Section VIII Division 1
**URL:** https://www.multicalci.com/pressure-vessel-thickness-calculator

Minimum required shell and head thickness for internal pressure, including corrosion allowance and joint efficiency.

---

### Material of Construction Guide
**URL:** https://www.multicalci.com/material-of-construction

Corrosion resistance tables for common engineering materials against process fluids — mineral acids, organic acids, alkalis, solvents, hydrocarbons and gases. Selection by fluid chemistry, temperature and concentration.

---

### Material Grades Library
**URL:** https://www.multicalci.com/material-grades-library

Mechanical properties for carbon steel, stainless steel (austenitic, duplex, super duplex), alloy steel, aluminium and titanium. Cross-references ASTM, DIN, EN, JIS and ISO designations.

---

## Mechanical Engineering

**Hub:** https://www.multicalci.com/mechanical-engineering-calculators

| Calculator | URL |
|---|---|
| Bolt Torque | https://www.multicalci.com/bolt-torque-calculator |
| Flange Bolt Torque | https://www.multicalci.com/flange-bolt-torque-calculator |
| Fillet Weld Size (AWS D1.1) | https://www.multicalci.com/fillet-weld-size-calculator |
| Beam Deflection | https://www.multicalci.com/beam-deflection-calculator |
| Pressure Vessel Thickness (ASME VIII) | https://www.multicalci.com/pressure-vessel-thickness-calculator |
| Spur Gear (AGMA) | https://www.multicalci.com/spur-gear-calculator |
| Shaft Design | https://www.multicalci.com/shaft-design-calculator |
| Compression Spring | https://www.multicalci.com/compression-spring-calculator |
| Bend Allowance | https://www.multicalci.com/bend-allowance-calculator |
| CNC Feed Rate | https://www.multicalci.com/cnc-feed-rate-calculator |
| Centre of Gravity | https://www.multicalci.com/center-of-gravity-calculator |

Key equations:
- Bolt torque-tension: `T = K × d × F`
- Beam deflection (simply supported, central point load): `δ = PL³/48EI`
- Flange bolt load per ASME B16.5

---

## Civil Engineering

**Hub:** https://www.multicalci.com/civil-engineering-calculators

| Calculator | URL |
|---|---|
| Concrete Mix Design | https://www.multicalci.com/concrete-mix-design-calculator |
| Footing Design | https://www.multicalci.com/footing-design-calculator |
| Retaining Wall Design | https://www.multicalci.com/retaining-wall-design-calculator |
| Bending Moment | https://www.multicalci.com/bending-moment-calculator |
| Column Buckling | https://www.multicalci.com/column-buckling-calculator |
| Steel Section Properties | https://www.multicalci.com/steel-section-properties-calculator |
| Manning Equation (open channel) | https://www.multicalci.com/manning-equation-calculator |
| Earthwork Volume | https://www.multicalci.com/earthwork-volume-calculator |
| Horizontal Curve (surveying) | https://www.multicalci.com/horizontal-curve-calculator |
| Vertical Curve (surveying) | https://www.multicalci.com/vertical-curve-calculator |

Key equations:
- Manning: `Q = (1/n) × A × R^(2/3) × S^(1/2)`
- Euler column buckling: `Pcr = π²EI / (KL)²`

---

## Electrical Engineering

**Hub:** https://www.multicalci.com/electrical-engineering-calculators

| Calculator | URL |
|---|---|
| Ohm's Law | https://www.multicalci.com/ohms-law-calculator |
| Three-Phase Power | https://www.multicalci.com/three-phase-power-calculator |
| Cable Size (IEC 60228) | https://www.multicalci.com/cable-size-calculator |
| Voltage Drop | https://www.multicalci.com/voltage-drop-calculator |
| Motor Full Load Current | https://www.multicalci.com/motor-full-load-current-calculator |
| Transformer Sizing | https://www.multicalci.com/transformer-calculator |
| Short Circuit Current (IEC 60909) | https://www.multicalci.com/short-circuit-current-calculator |
| Capacitive Reactance | https://www.multicalci.com/capacitive-reactance-calculator |
| Lumen Method (lighting) | https://www.multicalci.com/lumen-method-calculator |
| HV Cable Test Voltage | https://www.multicalci.com/hv-cable-test-voltage-calculator |

---

## Instrumentation

**Hub:** https://www.multicalci.com/instrumentation-calculators

| Calculator | URL |
|---|---|
| 4–20 mA Signal (NAMUR NE43) | https://www.multicalci.com/4-20ma-calculator |
| Square Root Flow (DP linearisation) | https://www.multicalci.com/square-root-flow-calculator |
| Instrument Loop Integrity | https://www.multicalci.com/instrument-loop-calculator |
| Loop Power Supply | https://www.multicalci.com/loop-power-supply-calculator |
| Thermowell (ASME PTC 19.3 TW) | https://www.multicalci.com/thermowell-calculator |

Key equations:
- 4–20 mA span: `I = 4 + 16 × (value − LRV)/(URV − LRV)`
- Thermowell: Strouhal `St ≈ 0.22`; wake frequency `f_s = St·V/D`; check `f_s/f_n` per ASME PTC 19.3 TW

---

## Standards & Reference Tools

### Engineering Standards & Codes Finder
**URL:** https://www.multicalci.com/engineering-standards-finder

Look up applicable codes for any equipment — pumps, vessels, valves, piping, tanks, heat exchangers, instruments, rotating machinery. Covers API, ASME, ASTM, ISO, EN, DIN, BS, JIS and Indian Standards (IS, IBR) with latest edition, scope, key requirements and related standards. Around 490 individual reference pages under `/engineering-standards-finder/equipment/…` and `/engineering-standards-finder/standards/…`.

### P&ID Symbol Finder
**Standards:** ANSI/ISA-5.1; ISO 10628
**URL:** https://www.multicalci.com/pid-symbol-finder

Searchable library of 368+ P&ID symbols — pumps, valves, heat exchangers, vessels, instruments and process lines — with an instrument tag abbreviation panel. Export as PNG, JPG or SVG.

### BOQ Capital Cost Estimator *(Beta)*
**URL:** https://www.multicalci.com/boq-estimator

Bill of quantities capital cost estimator with 1,400+ line items across pumps, vessels, cabling, concrete, earthwork, piping and valves. Tiered ±30 / ±20 / ±10% accuracy classes across 8 regions.

---

## Unit Converter

**URL:** https://www.multicalci.com/unit-converter

30+ engineering quantity categories with full SI ↔ Imperial conversion. Each category also has its own page:

`acceleration` · `angle` · `area` · `concentration` · `density` · `dynamic-viscosity` · `energy` · `flow-rate-mass` · `flow-rate-volume` · `force` · `frequency` · `fuel-economy` · `heat-flux` · `heat-transfer-coefficient` · `kinematic-viscosity` · `length` · `mass` · `power` · `pressure` · `specific-heat` · `stress-pressure-structural` · `temperature` · `thermal-conductivity` · `time` · `torque` · `velocity` · `volume`

Example: https://www.multicalci.com/unit-converter/pressure

---

## Standards Implemented

| Standard | Description | Calculator |
|---|---|---|
| ISO 5167-2:2022 | Orifice plate flow metering | Orifice Design & Sizing |
| ISO 5167-3 / -4 | ISA nozzle and venturi flow metering | Orifice Design & Sizing |
| IEC 60534 / ISA 75.01 | Control valve sizing | Control Valve Sizing |
| API 520 / 521 / 526 | Pressure relief valve sizing and orifice selection | PSV / Relief Valve Sizing |
| IAPWS-IF97 | Water and steam thermodynamic properties | Steam Properties, Turbine, Rankine, Quench, Cooling Tower |
| Bell-Delaware method | Shell-and-tube heat exchanger shellside rating | Heat Exchanger Design |
| TEMA | Heat exchanger construction and fouling | Heat Exchanger Design |
| CTI ATC-105 / Merkel | Cooling tower thermal performance | Cooling Tower Performance |
| ASME Section VIII Div. 1 | Pressure vessel wall thickness and nozzle design | Vessel & Separator Sizing, Pressure Vessel Thickness |
| ASME B31.3 | Process piping design | Pipe Pressure Drop |
| ASME B36.10M / B36.19M | Pipe dimensions and weights | Pipe Weight, Pipe Volume |
| ASME B16.5 | Flange pressure-temperature ratings and bolt loads | Flange Rating, Flange Bolt Torque |
| ASME PTC 19.3 TW | Thermowell wake frequency and mechanical design | Thermowell Calculator |
| ASME F&D | Torispherical head geometry | Tank Volume |
| API 12J | Gas-liquid separator sizing | Vessel & Separator Sizing |
| AWS D1.1 | Structural welding — fillet weld sizing | Fillet Weld Size |
| AGMA | Spur gear geometry and rating | Spur Gear |
| Peng-Robinson / SRK EOS | Real gas compressibility and density | Gas Equation of State |
| Darcy-Weisbach + Colebrook-White | Pipe friction pressure drop | Pipe Pressure Drop |
| Hazen-Williams | Water pipe friction | Pipe Pressure Drop, Manning Equation |
| Hagen-Poiseuille | Laminar pipe flow | Pipe Pressure Drop |
| Manning equation | Open channel flow | Manning Equation |
| IEC 60228 | Conductor cross-sectional areas | Cable Size |
| IEC 60909 | Short-circuit current calculation | Short Circuit Current |
| NAMUR NE43 | 4–20 mA fault signalling zones | 4–20 mA Calculator |
| ANSI/ISA-5.1 · ISO 10628 | P&ID symbology and instrument tagging | P&ID Symbol Finder |
| API · ASME · ASTM · ISO · EN · DIN · BS · JIS · IS · IBR | 200+ codes indexed by equipment | Engineering Standards Finder |

---

## About

multicalci.com is built and maintained by a practicing chemical engineer with hands-on experience across power generation, utilities, pharmaceutical manufacturing and petrochemical processing. Every calculator implements the same equations used in professional engineering practice — not simplified approximations.

All calculators run entirely in the browser. No calculation data is sent to any server. No login or subscription required.

Results are intended for preliminary engineering, feasibility studies, education and cross-checking. Verify all results with a qualified engineer against applicable codes before use in final designs.

**https://www.multicalci.com**
