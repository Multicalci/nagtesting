// ═══════════════════════════════════════════════════════════════════════════
// ORIFICE FLOW — VALIDATION SUITE (v1.0, 2026-10)
//
// Run:  node tests/orifice-validation.mjs [api/process-calculators.js] [api/mcp.mjs]
//
// Checks both orifice engines against ISO 5167-2:2003/2022:
//   website   api/process-calculators.js  calculate()      (/api/orifice-flow)
//   MCP tool  api/mcp.mjs                 orificeFlow()    (orifice_flow_iso5167)
//
// Same philosophy as validation-suite.mjs — no invented reference numbers:
//   TIER 1  Identities          — corner_tap == sharp_corner, ε = 1 for liquids,
//                                  E = 1/√(1−β⁴).
//   TIER 2  Re-derivation       — Reader-Harris/Gallagher C, ε, flow and loss
//                                  written again here from the ISO 5167-2
//                                  equations and solved independently.
//   TIER 3  External references — values computed with the open-source
//                                  `fluids` library and IAPWS-IF97 (`iapws`
//                                  package: density and κ = ρw²/p), stored
//                                  below with their versions.
//   LIMITS  ISO 5167-2 §5.3.1   — every out-of-range input must be flagged,
//                                  and no valid case may be flagged.
//
// The reference values were generated once by a script outside the repo
// (see DATA.generated / DATA.fluids / DATA.iapws). Re-generate them only if a
// case is added — never to make a failing test pass.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import os from 'os';
import path from 'path';

const SITE_SRC = process.argv[2] || 'api/process-calculators.js';
const MCP_SRC  = process.argv[3] || 'api/mcp.mjs';

async function load(src, names) {
  let code = fs.readFileSync(src, 'utf8').replace(/export default async function handler/, 'async function handler');
  code += `\nexport { ${names.join(', ')} };\n`;
  const tmp = path.join(os.tmpdir(), `_orifice_val_${process.pid}_${path.basename(src)}.mjs`);
  fs.writeFileSync(tmp, code);
  try { return await import(tmp); } finally { try { fs.unlinkSync(tmp); } catch {} }
}
const site = await load(SITE_SRC, ['calculate', 'steamDensity', 'steamKappaAuto']);
const mcp  = await load(MCP_SRC,  ['orificeFlow']);

const DATA = {
 "generated": "2026-10-22",
 "fluids": "1.3.1",
 "iapws": "1.5.5",
 "valid": [
  {
   "id": "L1",
   "desc": "Water, small pipe (small-bore term active)",
   "site": {
    "cat": "liquid",
    "tapType": "corner_tap",
    "D_mm": 50,
    "d_mm": 25,
    "dp_Pa_in": 25000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 998.0,
    "C": 0.610762583636,
    "eps": 1.0,
    "m": 2.18729296884,
    "ReD": 55698.9580769,
    "loss": 18261.0836307
   },
   "mcp": {
    "pipe_id_mm": 50,
    "orifice_bore_mm": 25,
    "differential_pressure_pa": 25000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "corner",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.610762583636,
    "eps": 1.0,
    "m": 2.18729296884,
    "ReD": 55698.9580769,
    "loss": 18261.0836307
   }
  },
  {
   "id": "L2",
   "desc": "Water, 4 in line",
   "site": {
    "cat": "liquid",
    "tapType": "sharp_flange",
    "D_mm": 100,
    "d_mm": 50,
    "dp_Pa_in": 25000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 998.0,
    "C": 0.605979036185,
    "eps": 1.0,
    "m": 8.68064757484,
    "ReD": 110525.437662,
    "loss": 18305.7003932
   },
   "mcp": {
    "pipe_id_mm": 100,
    "orifice_bore_mm": 50,
    "differential_pressure_pa": 25000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.605979036185,
    "eps": 1.0,
    "m": 8.68064757484,
    "ReD": 110525.437662,
    "loss": 18305.7003932
   }
  },
  {
   "id": "L3",
   "desc": "Water, beta at upper limit",
   "site": {
    "cat": "liquid",
    "tapType": "d_d2_tap",
    "D_mm": 150,
    "d_mm": 112.5,
    "dp_Pa_in": 10000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 998.0,
    "C": 0.613272658764,
    "eps": 1.0,
    "m": 32.9404673276,
    "ReD": 279607.370824,
    "loss": 4439.81280171
   },
   "mcp": {
    "pipe_id_mm": 150,
    "orifice_bore_mm": 112.5,
    "differential_pressure_pa": 10000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "d_and_d2",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.613272658764,
    "eps": 1.0,
    "m": 32.9404673276,
    "ReD": 279607.370824,
    "loss": 4439.81280171
   }
  },
  {
   "id": "L4",
   "desc": "Water, low beta",
   "site": {
    "cat": "liquid",
    "tapType": "sharp_flange",
    "D_mm": 200,
    "d_mm": 40,
    "dp_Pa_in": 50000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 998.0,
    "C": 0.598411142119,
    "eps": 1.0,
    "m": 7.51834965927,
    "ReD": 47863.3004866,
    "loss": 47661.1381037
   },
   "mcp": {
    "pipe_id_mm": 200,
    "orifice_bore_mm": 40,
    "differential_pressure_pa": 50000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.598411142119,
    "eps": 1.0,
    "m": 7.51834965927,
    "ReD": 47863.3004866,
    "loss": 47661.1381037
   }
  },
  {
   "id": "L5",
   "desc": "Light oil, moderate Reynolds number",
   "site": {
    "cat": "liquid",
    "tapType": "corner_tap",
    "D_mm": 300,
    "d_mm": 180,
    "dp_Pa_in": 5000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.85,
    "mu_input": 0.02,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 850.0,
    "C": 0.627349605322,
    "eps": 1.0,
    "m": 49.8878218176,
    "ReD": 10586.5245898,
    "loss": 3095.32522549
   },
   "mcp": {
    "pipe_id_mm": 300,
    "orifice_bore_mm": 180,
    "differential_pressure_pa": 5000,
    "density_kgm3": 850,
    "viscosity_cp": 20.0,
    "fluid_state": "liquid",
    "tap_type": "corner",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.627349605322,
    "eps": 1.0,
    "m": 49.8878218176,
    "ReD": 10586.5245898,
    "loss": 3095.32522549
   }
  },
  {
   "id": "L6",
   "desc": "Cooling water, 1000 mm main",
   "site": {
    "cat": "liquid",
    "tapType": "sharp_flange",
    "D_mm": 1000,
    "d_mm": 600,
    "dp_Pa_in": 20000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.995,
    "mu_input": 0.0008,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 995.0,
    "C": 0.604344139243,
    "eps": 1.0,
    "m": 1155.47031294,
    "ReD": 1838988.119,
    "loss": 12597.0239361
   },
   "mcp": {
    "pipe_id_mm": 1000,
    "orifice_bore_mm": 600,
    "differential_pressure_pa": 20000,
    "density_kgm3": 995,
    "viscosity_cp": 0.8,
    "fluid_state": "liquid",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.604344139243,
    "eps": 1.0,
    "m": 1155.47031294,
    "ReD": 1838988.119,
    "loss": 12597.0239361
   }
  },
  {
   "id": "L7",
   "desc": "Viscous oil, near the Reynolds limit",
   "site": {
    "cat": "liquid",
    "tapType": "corner_tap",
    "D_mm": 50,
    "d_mm": 30,
    "dp_Pa_in": 50000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.9,
    "mu_input": 0.015,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_ref": {
    "rho": 900.0,
    "C": 0.633901801082,
    "eps": 1.0,
    "m": 4.55634069068,
    "ReD": 7735.08419554,
    "loss": 30801.5445427
   },
   "mcp": {
    "pipe_id_mm": 50,
    "orifice_bore_mm": 30,
    "differential_pressure_pa": 50000,
    "density_kgm3": 900,
    "viscosity_cp": 15.0,
    "fluid_state": "liquid",
    "tap_type": "corner",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.633901801082,
    "eps": 1.0,
    "m": 4.55634069068,
    "ReD": 7735.08419554,
    "loss": 30801.5445427
   }
  },
  {
   "id": "G1",
   "desc": "Natural gas, 6 in Sch 40",
   "site": {
    "cat": "gas",
    "tapType": "sharp_flange",
    "D_mm": 154.1,
    "d_mm": 92.46,
    "dp_Pa_in": 25000,
    "P_bar": 40.0,
    "T_c": 15,
    "sg": 0.6203765836037839,
    "mu_input": 1.1e-05,
    "k": 1.3,
    "MW_input": 17.968587367499996
   },
   "site_ref": {
    "rho": 30.0,
    "C": 0.604171594368,
    "eps": 0.998076504392,
    "m": 5.31505768883,
    "ReD": 3992296.40255,
    "loss": 15748.3220599
   },
   "mcp": {
    "pipe_id_mm": 154.1,
    "orifice_bore_mm": 92.46,
    "differential_pressure_pa": 25000,
    "density_kgm3": 30.0,
    "viscosity_cp": 0.011,
    "fluid_state": "gas",
    "tap_type": "flange",
    "upstream_pressure_bara": 40.0,
    "downstream_pressure_bara": 39.75,
    "isentropic_exponent": 1.3
   },
   "mcp_ref": {
    "C": 0.604171594368,
    "eps": 0.998076504392,
    "m": 5.31505768883,
    "ReD": 3992296.40255,
    "loss": 15748.3220599
   }
  },
  {
   "id": "G2",
   "desc": "Air, 4 in Sch 40, low pressure",
   "site": {
    "cat": "gas",
    "tapType": "corner_tap",
    "D_mm": 102.3,
    "d_mm": 51.15,
    "dp_Pa_in": 20000,
    "P_bar": 2.0,
    "T_c": 15,
    "sg": 0.9843308459846706,
    "mu_input": 1.85e-05,
    "k": 1.4,
    "MW_input": 28.510158623099997
   },
   "site_ref": {
    "rho": 2.38,
    "C": 0.605156046837,
    "eps": 0.973130830735,
    "m": 0.385613831166,
    "ReD": 259427.110955,
    "loss": 14650.7106847
   },
   "mcp": {
    "pipe_id_mm": 102.3,
    "orifice_bore_mm": 51.15,
    "differential_pressure_pa": 20000,
    "density_kgm3": 2.38,
    "viscosity_cp": 0.0185,
    "fluid_state": "gas",
    "tap_type": "corner",
    "upstream_pressure_bara": 2.0,
    "downstream_pressure_bara": 1.8,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.605156046837,
    "eps": 0.973130830735,
    "m": 0.385613831166,
    "ReD": 259427.110955,
    "loss": 14650.7106847
   }
  },
  {
   "id": "S1",
   "desc": "Saturated steam, 8 in Sch 40",
   "site": {
    "cat": "steam",
    "tapType": "d_d2_tap",
    "D_mm": 202.7,
    "d_mm": 141.89,
    "dp_Pa_in": 50000,
    "P_bar": 11.0,
    "T_c": 200,
    "sg": 1,
    "mu_input": 1.5e-05,
    "k": 1.3,
    "MW_input": 18.015
   },
   "site_ref": {
    "rho": 5.37603875475,
    "C": 0.607717615923,
    "eps": 0.983616451374,
    "m": 7.95012653948,
    "ReD": 3075017.81607,
    "loss": 25570.8916
   },
   "mcp": {
    "pipe_id_mm": 202.7,
    "orifice_bore_mm": 141.89,
    "differential_pressure_pa": 50000,
    "density_kgm3": 5.6,
    "viscosity_cp": 0.0155,
    "fluid_state": "steam",
    "tap_type": "d_and_d2",
    "upstream_pressure_bara": 11.0,
    "downstream_pressure_bara": 10.5,
    "isentropic_exponent": 1.3
   },
   "mcp_ref": {
    "C": 0.607632450403,
    "eps": 0.983616451374,
    "m": 8.11289757498,
    "ReD": 3287764.22008,
    "loss": 25573.2085346
   }
  },
  {
   "id": "G3",
   "desc": "Air, pressure ratio near the 0.75 limit",
   "site": {
    "cat": "gas",
    "tapType": "sharp_flange",
    "D_mm": 77.9,
    "d_mm": 31.16,
    "dp_Pa_in": 36000,
    "P_bar": 1.5,
    "T_c": 15,
    "sg": 0.9870880752451318,
    "mu_input": 1.8200000000000002e-05,
    "k": 1.4,
    "MW_input": 28.590019011399995
   },
   "site_ref": {
    "rho": 1.79,
    "C": 0.601527916095,
    "eps": 0.936243604513,
    "m": 0.156190119304,
    "ReD": 140266.780738,
    "loss": 29631.1286639
   },
   "mcp": {
    "pipe_id_mm": 77.9,
    "orifice_bore_mm": 31.16,
    "differential_pressure_pa": 36000,
    "density_kgm3": 1.79,
    "viscosity_cp": 0.0182,
    "fluid_state": "gas",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.5,
    "downstream_pressure_bara": 1.14,
    "isentropic_exponent": 1.4
   },
   "mcp_ref": {
    "C": 0.601527916095,
    "eps": 0.936243604513,
    "m": 0.156190119304,
    "ReD": 140266.780738,
    "loss": 29631.1286639
   }
  }
 ],
 "limits": [
  {
   "id": "R1",
   "desc": "beta above 0.75",
   "site": {
    "cat": "liquid",
    "tapType": "sharp_flange",
    "D_mm": 100,
    "d_mm": 80,
    "dp_Pa_in": 25000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_expect": "outside ISO 5167 range",
   "mcp": {
    "pipe_id_mm": 100,
    "orifice_bore_mm": 80,
    "differential_pressure_pa": 25000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   }
  },
  {
   "id": "R2",
   "desc": "pipe below 50 mm",
   "site": {
    "cat": "liquid",
    "tapType": "sharp_flange",
    "D_mm": 40,
    "d_mm": 20,
    "dp_Pa_in": 25000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_expect": "ISO 5167 minimum 50 mm",
   "mcp": {
    "pipe_id_mm": 40,
    "orifice_bore_mm": 20,
    "differential_pressure_pa": 25000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   }
  },
  {
   "id": "R3",
   "desc": "bore below 12.5 mm",
   "site": {
    "cat": "liquid",
    "tapType": "corner_tap",
    "D_mm": 50,
    "d_mm": 10,
    "dp_Pa_in": 25000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.998,
    "mu_input": 0.001,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_expect": "minimum 12.5 mm",
   "mcp": {
    "pipe_id_mm": 50,
    "orifice_bore_mm": 10,
    "differential_pressure_pa": 25000,
    "density_kgm3": 998,
    "viscosity_cp": 1.0,
    "fluid_state": "liquid",
    "tap_type": "corner",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   }
  },
  {
   "id": "R4",
   "desc": "Reynolds number below limit",
   "site": {
    "cat": "liquid",
    "tapType": "corner_tap",
    "D_mm": 50,
    "d_mm": 30,
    "dp_Pa_in": 50000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.9,
    "mu_input": 0.15,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_expect": "below ISO 5167 minimum",
   "mcp": {
    "pipe_id_mm": 50,
    "orifice_bore_mm": 30,
    "differential_pressure_pa": 50000,
    "density_kgm3": 900,
    "viscosity_cp": 150.0,
    "fluid_state": "liquid",
    "tap_type": "corner",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   }
  },
  {
   "id": "R5",
   "desc": "pressure ratio below 0.75",
   "site": {
    "cat": "gas",
    "tapType": "sharp_flange",
    "D_mm": 100,
    "d_mm": 50,
    "dp_Pa_in": 40000,
    "P_bar": 1.2,
    "T_c": 15,
    "sg": 0.9857094606149011,
    "mu_input": 1.8e-05,
    "k": 1.4,
    "MW_input": 28.550088817249993
   },
   "site_expect": "ΔP/P > 0.25",
   "mcp": {
    "pipe_id_mm": 100,
    "orifice_bore_mm": 50,
    "differential_pressure_pa": 40000,
    "density_kgm3": 1.43,
    "viscosity_cp": 0.018,
    "fluid_state": "gas",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.2,
    "downstream_pressure_bara": 0.8,
    "isentropic_exponent": 1.4
   }
  },
  {
   "id": "R6",
   "desc": "corner taps, beta 0.75, Re_D below 16000 beta^2",
   "site": {
    "cat": "liquid",
    "tapType": "corner_tap",
    "D_mm": 100,
    "d_mm": 75,
    "dp_Pa_in": 2000,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.9,
    "mu_input": 0.012,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_expect": "below ISO 5167 minimum \\(9000",
   "mcp": {
    "pipe_id_mm": 100,
    "orifice_bore_mm": 75,
    "differential_pressure_pa": 2000,
    "density_kgm3": 900,
    "viscosity_cp": 12.0,
    "fluid_state": "liquid",
    "tap_type": "corner",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   }
  },
  {
   "id": "R7",
   "desc": "flange taps, beta 0.75, Re_D below 170 beta^2 D",
   "site": {
    "cat": "liquid",
    "tapType": "sharp_flange",
    "D_mm": 1000,
    "d_mm": 750,
    "dp_Pa_in": 500,
    "P_bar": 5,
    "T_c": 20,
    "sg": 0.9,
    "mu_input": 0.007,
    "k": 1.4,
    "MW_input": 28.964
   },
   "site_expect": "below ISO 5167 minimum \\(95625",
   "mcp": {
    "pipe_id_mm": 1000,
    "orifice_bore_mm": 750,
    "differential_pressure_pa": 500,
    "density_kgm3": 900,
    "viscosity_cp": 7.0,
    "fluid_state": "liquid",
    "tap_type": "flange",
    "upstream_pressure_bara": 1.01325,
    "downstream_pressure_bara": 1,
    "isentropic_exponent": 1.4
   }
  }
 ],
 "steam_if97": [
  [
   1,
   200,
   0.460300288277,
   1.31095583136
  ],
  [
   1,
   300,
   0.378950393136,
   1.29983204391
  ],
  [
   1,
   400,
   0.322297653023,
   1.28805855151
  ],
  [
   1,
   500,
   0.280459026852,
   1.27648064193
  ],
  [
   1,
   600,
   0.248265300841,
   1.2653990041
  ],
  [
   5,
   200,
   2.35275480601,
   1.30608111393
  ],
  [
   5,
   300,
   1.91349924281,
   1.29876196849
  ],
  [
   5,
   400,
   1.61997295718,
   1.28784177979
  ],
  [
   5,
   500,
   1.40657530747,
   1.27652057363
  ],
  [
   5,
   600,
   1.24363362818,
   1.2655592889
  ],
  [
   11,
   200,
   5.37603875475,
   1.29729182614
  ],
  [
   11,
   300,
   4.2751312589,
   1.29700141842
  ],
  [
   11,
   400,
   3.59263934539,
   1.28749649912
  ],
  [
   11,
   500,
   3.10877843294,
   1.27658365477
  ],
  [
   11,
   600,
   2.74366718976,
   1.26580844607
  ],
  [
   20,
   300,
   7.9680527031,
   1.29400207376
  ],
  [
   20,
   400,
   6.61340509241,
   1.28693569276
  ],
  [
   20,
   500,
   5.69215484538,
   1.27668886575
  ],
  [
   20,
   600,
   5.00965927355,
   1.26620405063
  ],
  [
   40,
   300,
   16.9871689031,
   1.28573720431
  ],
  [
   40,
   400,
   13.6180775301,
   1.28553684358
  ],
  [
   40,
   500,
   11.5685836279,
   1.27699720375
  ],
  [
   40,
   600,
   10.1155760585,
   1.26719470235
  ],
  [
   60,
   300,
   27.6310764974,
   1.2743122024
  ],
  [
   60,
   400,
   21.0868349284,
   1.28402043339
  ],
  [
   60,
   500,
   17.6455029092,
   1.27746939341
  ],
  [
   60,
   600,
   15.3222969593,
   1.26837296447
  ],
  [
   100,
   400,
   37.8224714494,
   1.28132058993
  ],
  [
   100,
   500,
   30.4758533669,
   1.27924142856
  ],
  [
   100,
   600,
   26.0569558342,
   1.27145603291
  ],
  [
   160,
   400,
   70.0229869849,
   1.28241501674
  ],
  [
   160,
   500,
   51.7498362745,
   1.28544919228
  ],
  [
   160,
   600,
   43.0343015492,
   1.27849895464
  ]
 ],
 "steam_near_sat": [
  [
   1,
   100.106
  ],
  [
   1,
   101.506
  ],
  [
   11,
   184.57
  ],
  [
   11,
   185.97
  ],
  [
   40,
   250.858
  ],
  [
   40,
   252.258
  ],
  [
   100,
   311.499
  ],
  [
   100,
   312.899
  ]
 ]
};

// ── tiny harness ─────────────────────────────────────────────────────────────
let nPass = 0, nFail = 0;
const fails = [];
function check(tier, name, ok, detail = '') {
  ok ? nPass++ : nFail++;
  if (!ok) fails.push(`[${tier}] ${name}  ${detail}`);
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const siteRun = (inp) => site.calculate({ mode: 'flow', customCd: undefined, fluidKey: null, flow_in: 0, flow_unit: 'kghr', Z_input: 1, ...inp });
const ISO_WARN = /ISO|Re=|β=|Bore|Pipe ID|ΔP\/P/;   // warnings about ISO 5167 limits (not advisory notes)

// ── TIER 2 — independent ISO 5167-2 implementation ──────────────────────────
function rhgC(Dmm, dmm, ReD, tap) {
  const b = dmm / Dmm;
  const [L1, L2] = tap === 'corner' ? [0, 0] : tap === 'd_and_d2' ? [1, 0.47] : [25.4 / Dmm, 25.4 / Dmm];
  const A = (19000 * b / ReD) ** 0.8, M2 = 2 * L2 / (1 - b);
  let C = 0.5961 + 0.0261 * b ** 2 - 0.216 * b ** 8 + 0.000521 * (1e6 * b / ReD) ** 0.7
        + (0.0188 + 0.0063 * A) * b ** 3.5 * (1e6 / ReD) ** 0.3
        + (0.043 + 0.080 * Math.exp(-10 * L1) - 0.123 * Math.exp(-7 * L1)) * (1 - 0.11 * A) * b ** 4 / (1 - b ** 4)
        - 0.031 * (M2 - 0.8 * M2 ** 1.1) * b ** 1.3;
  if (Dmm < 71.12) C += 0.011 * (0.75 - b) * (2.8 - Dmm / 25.4);
  return C;
}
function isoFlow({ Dmm, dmm, dp, rho, mu, tap, p1, p2, k, liquid }) {
  const b = dmm / Dmm, E = 1 / Math.sqrt(1 - b ** 4), a2 = Math.PI / 4 * (dmm / 1000) ** 2;
  const eps = liquid ? 1 : 1 - (0.351 + 0.256 * b ** 4 + 0.93 * b ** 8) * (1 - (p2 / p1) ** (1 / k));
  let C = 0.6, m = 0;
  for (let i = 0; i < 200; i++) {
    m = C * E * eps * a2 * Math.sqrt(2 * dp * rho);
    const Cn = rhgC(Dmm, dmm, 4 * m / (Math.PI * mu * Dmm / 1000), tap);
    if (Math.abs(Cn - C) < 1e-15) { C = Cn; break; }
    C = Cn;
  }
  m = C * E * eps * a2 * Math.sqrt(2 * dp * rho);
  return { C, eps, m, ReD: 4 * m / (Math.PI * mu * Dmm / 1000) };
}
const TAP_OF = { corner_tap: 'corner', sharp_corner: 'corner', sharp_flange: 'flange', d_d2_tap: 'd_and_d2' };

// ── VALID CASES ──────────────────────────────────────────────────────────────
for (const c of DATA.valid) {
  // Website engine
  const r = siteRun(c.site), ref = c.site_ref;
  check(3, `${c.id} site C vs fluids`,       rel(r.Cd, ref.C) < 1e-7,  `got ${r.Cd} ref ${ref.C}`);
  check(3, `${c.id} site ε vs fluids`,       rel(r.Y ?? 1, ref.eps) < 1e-9, `got ${r.Y} ref ${ref.eps}`);
  check(3, `${c.id} site mass flow vs fluids`, rel(r.mass_kgs, ref.m) < 1e-6, `got ${r.mass_kgs} ref ${ref.m}`);
  check(3, `${c.id} site Re_D vs fluids`,    rel(r.Re_pipe, ref.ReD) < 1e-6, `got ${r.Re_pipe} ref ${ref.ReD}`);
  check(3, `${c.id} site pressure loss vs fluids`, rel(r.perm_Pa, ref.loss) < 1e-6, `got ${r.perm_Pa} ref ${ref.loss}`);
  if (c.site.cat === 'steam') check(3, `${c.id} site steam density vs IAPWS-IF97`, rel(r.rho_op, ref.rho) < 1e-9, `got ${r.rho_op} ref ${ref.rho}`);
  check('LIM', `${c.id} site: valid case not flagged`, !r.warnings.some(w => ISO_WARN.test(w)), JSON.stringify(r.warnings));

  const t2 = isoFlow({ Dmm: c.site.D_mm, dmm: c.site.d_mm, dp: c.site.dp_Pa_in, rho: r.rho_op, mu: r.mu_used,
                       tap: TAP_OF[c.site.tapType], p1: c.site.P_bar * 1e5, p2: c.site.P_bar * 1e5 - c.site.dp_Pa_in,
                       k: c.site.k, liquid: c.site.cat === 'liquid' });
  check(2, `${c.id} site C vs re-derived ISO`, rel(r.Cd, t2.C) < 1e-7, `got ${r.Cd} iso ${t2.C}`);
  check(2, `${c.id} site mass flow vs re-derived ISO`, rel(r.mass_kgs, t2.m) < 1e-6, `got ${r.mass_kgs} iso ${t2.m}`);

  // Tier 1 identities
  if (c.site.tapType === 'corner_tap') check(1, `${c.id} corner_tap == sharp_corner`, siteRun({ ...c.site, tapType: 'sharp_corner' }).Cd === r.Cd);
  if (c.site.cat === 'liquid') check(1, `${c.id} ε = 1 for liquid`, (r.Y ?? 1) === 1);
  check(1, `${c.id} E = 1/√(1−β⁴)`, rel(r.E, 1 / Math.sqrt(1 - r.beta ** 4)) < 1e-12);

  // MCP tool: compare at the precision it reports
  const q = mcp.orificeFlow(c.mcp), mref = c.mcp_ref;
  const at = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
  check(3, `${c.id} MCP C (5 dp) vs fluids`, Math.abs(q.discharge_coefficient_Cd - at(mref.C, 5)) < 1.5e-5, `got ${q.discharge_coefficient_Cd} ref ${mref.C}`);
  check(3, `${c.id} MCP mass flow vs fluids`, rel(q.mass_flow_kg_s, mref.m) < 2e-6, `got ${q.mass_flow_kg_s} ref ${mref.m}`);
  check(3, `${c.id} MCP ε (5 dp) vs fluids`, Math.abs(q.expansibility_epsilon - at(mref.eps, 5)) < 1.5e-5, `got ${q.expansibility_epsilon} ref ${mref.eps}`);
  check('LIM', `${c.id} MCP: valid case not flagged`, JSON.stringify(q.validity_warnings) === '["Within ISO 5167-2 validity limits."]', JSON.stringify(q.validity_warnings));
}

// ── OUT-OF-RANGE CASES ───────────────────────────────────────────────────────
for (const c of DATA.limits) {
  const r = siteRun(c.site);
  check('LIM', `${c.id} site flags: ${c.desc}`, r.warnings.some(w => new RegExp(c.site_expect).test(w)), JSON.stringify(r.warnings));
  const q = mcp.orificeFlow(c.mcp);
  check('LIM', `${c.id} MCP flags: ${c.desc}`, !q.validity_warnings.includes('Within ISO 5167-2 validity limits.'), JSON.stringify(q.validity_warnings));
}

// ── STEAM vs IAPWS-IF97 (region 2): density and isentropic exponent ──────────
for (const [p, t, rho, kappa] of DATA.steam_if97) {
  const s = site.steamDensity(p, t);
  check(3, `steam ρ ${p} bar a, ${t} °C vs IAPWS-IF97`, rel(s.rho, rho) < 1e-9, `got ${s.rho} ref ${rho}`);
  check(3, `steam κ ${p} bar a, ${t} °C vs IAPWS-IF97`, rel(s.kappa, kappa) < 1e-9, `got ${s.kappa} ref ${kappa}`);
  check(1, `steam κ auto uses IF97 when superheated (${p} bar a, ${t} °C)`, site.steamKappaAuto(p, t).k === s.kappa);
}
for (const [p, t] of DATA.steam_near_sat)
  check(1, `κ = 1.135 within 2 °C of saturation (${p} bar a, ${t} °C)`, site.steamKappaAuto(p, t).k === 1.135, String(site.steamKappaAuto(p, t).k));
check(1, 'κ not set for compressed water (11 bar a, 150 °C)', site.steamKappaAuto(11, 150).k === null);

console.log(`Orifice validation: ${nPass} passed, ${nFail} failed  (references: fluids ${DATA.fluids}, iapws ${DATA.iapws}, generated ${DATA.generated})`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(nFail ? 1 : 0);
