// ============================================================================
// motor-sizing.js  ·  multicalci.com BOQ — recommended motor sizing
// Browser + Node. No dependencies. Drop into the BOQ frontend.
//
// WHY: api/boq.js scales equipment cost on the POSTED motor_power value. If the
// form auto-fills motor_power from the process inputs the user actually knows
// (flow, discharge pressure, gas, inlet temp, stages | flow, head, fluid), then
// flow/pressure/fluid drive the cost end-to-end with NO engine change.
//
// Engineering basis: multi-stage adiabatic (isentropic) compression with perfect
// intercooling to inlet temperature (compressors); hydraulic power P=Q·H·SG/367
// (pumps). Overall efficiencies are calibrated to vendor package specific-power
// and are INDICATIVE — tune the EFF constants below to your vendor data.
// ============================================================================

const R_U = 8.314;          // kJ/(kmol·K)
const VN  = 22.414;         // Nm³/kmol at 0°C, 1 atm
const P_ATM = 1.013;        // bar(a)

// Overall package efficiency (isentropic × mechanical × VSD/transmission) by type.
// Motor electrical efficiency handled separately (ETA_MOTOR).
const EFF = { screw: 0.84, reciprocating: 0.80, booster: 0.78 };
const ETA_MOTOR = 0.95;
const SERVICE_FACTOR = 1.10;   // margin over computed shaft power
const ETA_PUMP = 0.68;         // reciprocating / PD pump hydraulic efficiency

// Fluid property table keyed to the schema's gas_type / fluid options.
// k = Cp/Cv (ratio of specific heats); sg = liquid specific gravity (pumps).
const FLUID = {
  "Air (dry / instrument quality)":        { k: 1.40, sg: 1.00 },
  "Air (general / plant utility)":         { k: 1.40, sg: 1.00 },
  "Nitrogen (N₂)":                          { k: 1.40, sg: 0.81 },
  "Ammonia (NH₃) - gas phase":              { k: 1.31, sg: 0.68 },
  "Ammonia (NH₃) - liquid phase":           { k: 1.31, sg: 0.68 },
  "CO₂ (carbon dioxide)":                   { k: 1.29, sg: 1.03 },
  "Natural gas / methane":                  { k: 1.30, sg: 0.42 },
  "Hydrogen (H₂)":                          { k: 1.41, sg: 0.07 },
  "Chlorine (Cl₂)":                         { k: 1.33, sg: 1.41 },
  "Propylene / propane (refrigerant)":      { k: 1.13, sg: 0.51 },
  "Process gas (mixed HC, specify MW)":     { k: 1.20, sg: 0.60 },
  "Inert gas (Ar, He, N₂ mixture)":         { k: 1.50, sg: 0.90 },
};
function fluidOf(name) { return FLUID[name] || { k: 1.40, sg: 1.00 }; }

// IEC IE3 standard motor frame sizes (kW)
const FRAMES = [1.5,2.2,3,4,5.5,7.5,11,15,18.5,22,30,37,45,55,75,90,110,132,160,
                200,250,315,355,400,450,500,560,630,710,800,900,1000,1250,1600,2000];
function nearestFrame(kW) {
  // smallest frame >= 0.97×kW (allow tiny round-down), else largest
  for (const f of FRAMES) if (f >= kW * 0.97) return f;
  return FRAMES[FRAMES.length - 1];
}

function stageCount(numStages) {
  const m = { "Single-stage":1, "2-stage":2, "3-stage":3, "4-stage":4, "5-stage or more":5 };
  return m[numStages] || 1;
}

// ---- Compressor (screw / reciprocating / booster) ----------------------------
// type: 'screw' | 'reciprocating' | 'booster'
function compressorMotorkW({ flow_Nm3h, discharge_barg, suction_barg = 0,
                             inlet_C = 35, stages = 1, gas = "Air (general / plant utility)",
                             type = 'screw' }) {
  const Q = Number(flow_Nm3h);
  if (!Q || Q <= 0) return null;
  const { k } = fluidOf(gas);
  const T1 = (Number(inlet_C) || 35) + 273.15;
  const P1 = (Number(suction_barg) || 0) + P_ATM;
  const P2 = (Number(discharge_barg) || 0) + P_ATM;
  const rp = Math.max(P2 / P1, 1.0001);
  const z  = Math.max(1, Number(stages) || 1);
  const exp = (k - 1) / (k * z);
  const molarFlow = Q / VN / 3600;                  // kmol/s
  const isenStage = (k / (k - 1)) * R_U * T1 * (Math.pow(rp, exp) - 1); // kJ/kmol per stage
  const P_isen = molarFlow * z * isenStage;         // kW
  const eff = EFF[type] || EFF.screw;
  const shaft = P_isen / eff;
  const motorReq = shaft * SERVICE_FACTOR / ETA_MOTOR;
  return { shaft_kW: +shaft.toFixed(1), motor_required_kW: +motorReq.toFixed(1),
           recommended_frame_kW: nearestFrame(motorReq), pressure_ratio: +rp.toFixed(2),
           basis: `${z}-stage adiabatic, k=${k}, η_pkg=${eff}, SF=${SERVICE_FACTOR}` };
}

// ---- Pump (reciprocating supply / ammonia liquid) ----------------------------
function pumpMotorkW({ flow_m3h, head_m, fluid = "Ammonia (NH₃) - liquid phase", sg_override = null }) {
  const Q = Number(flow_m3h), H = Number(head_m);
  if (!Q || !H || Q <= 0 || H <= 0) return null;
  const sg = sg_override != null ? Number(sg_override) : fluidOf(fluid).sg;
  const P_hyd = (Q * H * sg) / 367;                 // kW
  const shaft = P_hyd / ETA_PUMP;
  const motorReq = shaft * SERVICE_FACTOR / ETA_MOTOR;
  return { hydraulic_kW: +P_hyd.toFixed(2), shaft_kW: +shaft.toFixed(1),
           motor_required_kW: +motorReq.toFixed(1), recommended_frame_kW: nearestFrame(motorReq),
           sg, basis: `P=Q·H·SG/367, η_pump=${ETA_PUMP}, SF=${SERVICE_FACTOR}` };
}

// Dispatch by equipment_subtype (matches schema option strings).
function recommendMotorkW(subtype, v) {
  if (/Screw/i.test(subtype))
    return compressorMotorkW({ flow_Nm3h:v.flow_rate, discharge_barg:v.design_pressure,
      inlet_C:v.design_temperature, stages:stageCount(v.num_stages), gas:v.gas_type, type:'screw' });
  if (/Reciprocating Compressor/i.test(subtype))
    return compressorMotorkW({ flow_Nm3h:v.flow_rate, discharge_barg:v.design_pressure,
      inlet_C:v.design_temperature, stages:stageCount(v.num_stages), gas:v.gas_type, type:'reciprocating' });
  if (/Booster/i.test(subtype))
    return compressorMotorkW({ flow_Nm3h:v.flow_rate, discharge_barg:v.design_pressure,
      inlet_C:v.design_temperature, stages:stageCount(v.num_stages), gas:v.gas_type, type:'booster' });
  if (/pump/i.test(subtype))
    return pumpMotorkW({ flow_m3h:v.pump_flow_rate, head_m:v.diff_head_m, fluid:v.gas_type });
  return null; // Refrigeration compressor: cost scales on refrigeration_capacity_kw — no motor sizing needed
}

if (typeof module !== 'undefined') module.exports = { recommendMotorkW, compressorMotorkW, pumpMotorkW, nearestFrame, FLUID };
