# multicalci.com — Free Engineering Calculators

Free browser-based engineering calculators for process, chemical, mechanical, electrical, and civil engineers.

All calculators implement recognised international engineering standards. No login, no subscription, no installation — runs entirely in the browser. Built and maintained by a practicing chemical engineer with experience across power/utilities, pharmaceutical, and petrochemical industries.

**Site:** https://multicalci.com

---

## Contents

- [Process Engineering](#process-engineering)
- [Steam & Power Engineering](#steam--power-engineering)
- [Fluid Machinery](#fluid-machinery)
- [Mechanical Engineering](#mechanical-engineering)
- [Civil Engineering](#civil-engineering)
- [Electrical Engineering](#electrical-engineering)
- [Instrumentation](#instrumentation)
- [Reference Libraries](#reference-libraries)
- [Standards Implemented](#standards-implemented)

---

## Process Engineering

### Orifice Flow Calculator
**Standard:** ISO 5167-2
**Method:** Reader-Harris/Gallagher discharge coefficient equation
**URL:** https://multicalci.com/orifice-flow-calculator/

Sizes orifice plates for flow measurement in liquid, gas, and steam service. Calculates discharge coefficient Cd, beta ratio, differential pressure, permanent pressure loss, and isentropic expansion factor ε. Supports corner taps, flange taps, and D&D/2 taps. SI and Imperial units.

Key equations:
- Reader-Harris/Gallagher: `Cd = 0.5961 + 0.0261β² − 0.216β⁸ + ...`
- Isentropic expansion factor: `ε = 1 − (0.351 + 0.256β⁴ + 0.93β⁸)[1−(P2/P1)^(1/κ)]`
- Mass flow: `qm = (Cd / √(1−β⁴)) × (π/4) × d² × ε × √(2ΔPρ)`

---

### Control Valve Sizing Calculator
**Standard:** IEC 60534 / ISA 75.01
**URL:** https://multicalci.com/control-valve-sizing/

Sizes control valves for liquid, compressible gas, and steam service. Calculates flow coefficient Cv and Kv, pressure recovery factor FL, choked flow differential pressure, cavitation index σ, and piping geometry factor Fp.

Key equations:
- Liquid flow: `Cv = Q × √(SG / ΔP)`
- Choked flow: `ΔP_choked = FL² × (P1 − Ff × Pv)`
- Cavitation index: `σ = (P1 − Pv) / ΔP`

---

### Pipe Pressure Drop Calculator
**Standard:** Darcy-Weisbach; Colebrook-White; Hagen-Poiseuille
**URL:** https://multicalci.com/pressure-drop-calculator/

Calculates friction pressure drop in pipes for 119 fluids. Uses Darcy-Weisbach with Colebrook-White friction factor for turbulent flow and Hagen-Poiseuille for laminar flow. Includes fitting losses via K-method and erosional velocity check. SI and Imperial units.

Key equations:
- Darcy-Weisbach: `ΔP = f × (L/D) × (ρv²/2)`
- Colebrook-White: `1/√f = −2log(ε/3.7D + 2.51/Re√f)`
- Laminar (Hagen-Poiseuille): `ΔP = 128μLQ / πD⁴`

---

### NPSH Calculator
**Standard:** Hydraulic Institute
**URL:** https://multicalci.com/npsh-calculator/

Calculates Net Positive Suction Head available (NPSHa) for centrifugal pumps. Covers suction-side friction losses, vapour pressure correction, elevation head, and velocity head. 31-fluid library. Cavitation check against NPSHr margin. SI and Imperial units.

Key equation:
- `NPSHa = (Ps/ρg) + (vs²/2g) + Hs − (Pv/ρg) − hf`

---

### Vessel & Separator Sizing
**Standards:** API 12J (separators); ASME Section VIII Division 1 (pressure vessels)
**URL:** https://multicalci.com/vessel-separator-sizing/

Sizes gas-liquid separators and calculates pressure vessel wall thickness. Outputs vessel internal diameter, seam-to-seam length, L/D ratio, droplet settling velocity, minimum shell thickness, nozzle reinforcement area, and wind/seismic load check.

---

### Heat Exchanger Design
**Standard:** Bell-Delaware method; TEMA
**URL:** https://multicalci.com/heat-exchanger-design/

Thermal and hydraulic rating of shell-and-tube heat exchangers using the Bell-Delaware shellside method. Calculates LMTD, NTU-effectiveness, overall heat transfer coefficient U, shellside and tubeside pressure drop, and fouling resistance. 80+ fluids. TEMA E/F/G/H/J/X shell types.

Key equations:
- `Q = U × A × LMTD × Ft`
- `1/U = 1/ho + Rfo + (t/kw) + Rfi + 1/hi`

---

### Cooling Tower Performance
**Standard:** CTI ATC-105; Merkel method; Poppe method
**URL:** https://multicalci.com/cooling-tower-performance/

Evaluates cooling tower thermal performance for counterflow and crossflow configurations. Calculates Merkel number (KaV/L), approach temperature, range, L/G ratio, fan power, and tower characteristic. Altitude correction included.

Key equation:
- Merkel: `KaV/L = ∫[dT / (hw − ha)]` from cold water temp to hot water temp

---

### Gas Equation of State Calculator
**Standards:** Peng-Robinson EOS; Soave-Redlich-Kwong (SRK) EOS; Van der Waals EOS
**URL:** https://multicalci.com/gas-equation-of-state/

Calculates real gas compressibility factor Z, molar volume, density, and fugacity coefficient for pure gases and multi-component mixtures.

Key equations:
- Peng-Robinson: `P = RT/(V−b) − a(T)/[V(V+b) + b(V−b)]`
- SRK: `P = RT/(V−b) − a(T)/[V(V+b)]`

---

### Psychrometric Calculator
**URL:** https://multicalci.com/psychrometric-calculator/

Calculates moist air properties: dew point, wet-bulb temperature, relative humidity, specific humidity, enthalpy, and specific volume. Altitude-corrected atmospheric pressure. SI and Imperial units.

---

### Water Treatment Calculator
**URL:** https://multicalci.com/water-treatment-calculator/

Coagulant dosing, chlorine demand, and filtration design calculations for water treatment plant engineering.

---

## Steam & Power Engineering

### Steam Properties Calculator
**Standard:** IAPWS-IF97
**URL:** https://multicalci.com/steam-properties-calculator/

Calculates thermodynamic and transport properties of water and steam across all regions: compressed liquid (Region 1), two-phase / wet steam (Region 4), superheated steam (Region 2), and supercritical fluid (Region 3). Outputs specific enthalpy, entropy, specific volume, dynamic viscosity, thermal conductivity, and Prandtl number.

---

### Steam Turbine Power Calculator
**Standard:** IAPWS-IF97
**URL:** https://multicalci.com/steam-turbine-power-calculator/

Calculates isentropic and actual enthalpy drop, shaft power output, electrical generation, condenser duty, and exhaust steam quality for back-pressure and condensing turbines.

Key equation:
- `W_actual = ṁ × (h1 − h2s) × η_isentropic`

---

### Rankine Cycle Calculator
**Standard:** IAPWS-IF97
**URL:** https://multicalci.com/rankine-cycle-calculator/

Analyses steam power plant thermal efficiency for simple Rankine, reheat, and regenerative cycles. Calculates cycle efficiency, net specific work, heat rate, and T-s diagram state point data.

Key equation:
- `η_thermal = W_net / Q_boiler`

---

### Steam Quench / Desuperheater Calculator
**Standard:** IAPWS-IF97
**URL:** https://multicalci.com/steam-quench-calculator/

Calculates quench water (desuperheating water) flow rate for steam temperature control via mass and energy balance using IAPWS-IF97 enthalpies.

Key equation:
- `ṁ_steam_in × h_in + ṁ_quench × h_quench = ṁ_steam_out × h_out`

---

## Fluid Machinery

### Fluid Machinery Calculator
**URL:** https://multicalci.com/fluid-machinery-calculator/

Covers pump hydraulic power and NPSH, compressor polytropic and isentropic power, fan and blower sizing, affinity law scaling, and specific speed for centrifugal pumps, reciprocating compressors, and axial/centrifugal fans.

Key equations:
- Pump hydraulic power: `P = ρgQH / η`
- Affinity law (speed): `Q2/Q1 = N2/N1`; `H2/H1 = (N2/N1)²`; `P2/P1 = (N2/N1)³`
- Specific speed: `Ns = N√Q / H^(3/4)`

---

## Mechanical Engineering

### Mechanical Engineering Calculators
**Standards:** ASME B16.5; ASME PTC 19.3 TW
**URL:** https://multicalci.com/mechanical-engineering-calculators/

- Beam deflection and bending stress (simply supported, cantilever, fixed-fixed)
- Euler column buckling load: `Pcr = π²EI / (KL)²`
- Von Mises equivalent stress: `σ_vm = √(σx² − σxσy + σy² + 3τ²)`
- Bolt torque-tension: `T = K × d × F`
- Flange bolt load per ASME B16.5
- Thermowell wake frequency and Strouhal number per ASME PTC 19.3 TW

---

## Civil Engineering

### Civil Engineering Calculators
**Standards:** ACI 318; Manning equation
**URL:** https://multicalci.com/civil-engineering-calculators/

- Structural beam shear force and bending moment diagrams
- Reinforced concrete beam and slab design per ACI 318
- Pile axial capacity
- Open channel flow velocity and discharge: `Q = (1/n) × A × R^(2/3) × S^(1/2)` (Manning)
- Storm drainage sizing
- Foundation bearing capacity (Terzaghi general bearing capacity equation)

---

## Electrical Engineering

### Electrical Engineering Calculators
**Standards:** IEC 60909
**URL:** https://multicalci.com/electrical-engineering-calculators/

- Cable current carrying capacity and voltage drop sizing
- Motor starting current (DOL, star-delta)
- Transformer kVA sizing
- Power factor correction capacitor sizing
- Prospective short-circuit current per IEC 60909
- Hazardous area zone classification

---

## Instrumentation

### Instrumentation Calculators
**Standards:** ASME PTC 19.3 TW; ISA 5.1; Ziegler-Nichols; Cohen-Coon
**URL:** https://multicalci.com/instrumentation-calculators/

- Thermowell wake frequency and natural frequency per ASME PTC 19.3 TW
- PID controller tuning — Ziegler-Nichols open loop, Ziegler-Nichols closed loop, Cohen-Coon
- Transmitter span and zero ranging
- Orifice impulse line pressure drop sizing
- ISA 5.1 instrument tag notation reference

---

## Reference Libraries

### Material Grades Library
**URL:** https://multicalci.com/material-grades-library/

Mechanical properties for carbon steel, stainless steel (austenitic, duplex, super duplex), alloy steel, aluminium, and titanium. Cross-references ASTM, EN (Euronorm), JIS, and ISO designations.

### Material of Construction Guide
**URL:** https://multicalci.com/material-of-construction/

Corrosion resistance tables for common engineering materials against process fluids — mineral acids, organic acids, alkalis, solvents, hydrocarbons, and gases.

### Unit Converter
**URL:** https://multicalci.com/unit-converter/

25+ engineering quantity categories: pressure, temperature, flow rate, viscosity, thermal conductivity, specific heat, density, energy, power, and more.

---

## Standards Implemented

| Standard | Description | Calculator |
|---|---|---|
| ISO 5167-2 | Orifice plate flow metering | Orifice Flow Calculator |
| IEC 60534 / ISA 75.01 | Control valve sizing | Control Valve Sizing Calculator |
| IAPWS-IF97 | Water and steam thermodynamic properties | Steam Properties, Turbine, Rankine, Quench |
| Bell-Delaware method | Shell-and-tube heat exchanger shellside rating | Heat Exchanger Design |
| TEMA | Heat exchanger construction and fouling | Heat Exchanger Design |
| CTI ATC-105 | Cooling tower thermal performance | Cooling Tower Performance |
| Merkel / Poppe method | Cooling tower heat and mass transfer | Cooling Tower Performance |
| ASME Section VIII Div. 1 | Pressure vessel wall thickness | Vessel & Separator Sizing |
| ASME B31.3 | Process piping design | Pipe Pressure Drop Calculator |
| ASME PTC 19.3 TW | Thermowell wake frequency | Instrumentation Calculators |
| ASME B16.5 | Pipe flanges and flange bolt loads | Mechanical Engineering Calculators |
| API 12J | Gas-liquid separator sizing | Vessel & Separator Sizing |
| Peng-Robinson EOS | Real gas compressibility and density | Gas Equation of State |
| Soave-Redlich-Kwong (SRK) EOS | Real gas compressibility and density | Gas Equation of State |
| Darcy-Weisbach | Pipe friction pressure drop | Pipe Pressure Drop Calculator |
| Colebrook-White | Turbulent friction factor | Pipe Pressure Drop Calculator |
| Hagen-Poiseuille | Laminar pipe flow | Pipe Pressure Drop Calculator |
| ACI 318 | Reinforced concrete structural design | Civil Engineering Calculators |
| IEC 60909 | Short-circuit current calculation | Electrical Engineering Calculators |
| ISA 5.1 | Instrumentation symbology and tag notation | Instrumentation Calculators |
| Hydraulic Institute | Pump NPSH methodology | NPSH Calculator |
| Ziegler-Nichols | PID controller tuning | Instrumentation Calculators |
| Cohen-Coon | PID controller tuning | Instrumentation Calculators |

---

## About

multicalci.com is built and maintained by a practicing chemical engineer with hands-on experience across power generation, utilities, pharmaceutical manufacturing, and petrochemical processing. Every calculator implements the same equations used in professional engineering practice — not simplified approximations.

All calculators run entirely in the browser. No data is sent to any server. No login or subscription required.

**https://multicalci.com**
