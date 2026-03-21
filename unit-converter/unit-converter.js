'use strict';

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
const CATEGORIES = {
  "Pressure":{icon:"🔵",slug:"pressure",
    units:{"Bar":100000,"kg/cm²":98066.5,"kgf/cm²":98066.5,"PSI":6894.76,"Kilopascal (kPa)":1000,"Megapascal (MPa)":1000000,"Pascal (Pa)":1,"Atmosphere (atm)":101325,"mH₂O (mWC)":9806.65,"mmH₂O (mmWC)":9.80665,"cmH₂O":98.0665,"inH₂O":249.089,"ftH₂O":2989.07,"Torr (mmHg)":133.322,"cmHg":1333.22,"inHg":3386.39,"Millibar (mbar)":100,"Tech Atmosphere (at)":98066.5,"kN/m²":1000,"N/mm²":1000000,"kgf/m²":9.80665,"kg/m²":9.80665,"PSF (lb/ft²)":47.8803,"Gigapascal (GPa)":1e9,"Microbar (µbar)":0.1,"dyne/cm²":0.1},
    desc:"Pressure is force per unit area. Used in hydraulics, pneumatics, weather, and process engineering.",
    aboutText:`<h2>About Pressure Conversion</h2><p>Pressure is force applied perpendicularly per unit area. The SI unit is the Pascal (Pa), defined as 1 N/m².</p><h3>Common Applications</h3><p>Pressure conversions are critical in fluid mechanics, hydraulics, weather forecasting, HVAC design, and medical equipment. Engineers frequently convert between kPa, PSI, bar, atm, and water-column units (mmH₂O, mH₂O).</p><h3>Water Column Units</h3><p>mmH₂O (millimetres of water column) and mH₂O (metres WC) are widely used in HVAC duct pressure, low-pressure gas systems, and differential pressure transmitters. 1 mmH₂O = 9.807 Pa. 1 mH₂O = 9806.65 Pa ≈ 0.1 bar.</p><h3>Key Reference Values</h3><p>Standard atmospheric pressure: 101.325 kPa = 14.696 PSI = 1.01325 bar = 10.332 mH₂O = 760 mmHg. Tyre pressure: 200–240 kPa (29–35 PSI). Industrial hydraulics: 10–35 MPa.</p>`},

  "Temperature":{icon:"🌡️",slug:"temperature",special:"temp",
    units:["°C (Celsius)","°F (Fahrenheit)","K (Kelvin)","°R (Rankine)"],
    desc:"Temperature measures thermal energy. Celsius, Fahrenheit, Kelvin and Rankine are the main engineering scales.",
    aboutText:`<h2>About Temperature Conversion</h2><p>Temperature conversion uses non-linear formulas because the scales have different zero points. Kelvin is the SI base unit, starting at absolute zero (−273.15 °C).</p><h3>Engineering Usage</h3><p>Thermodynamic calculations require Kelvin or Rankine. HVAC and food processing use Celsius. The US uses Fahrenheit for everyday measurement.</p><h3>Absolute Zero</h3><p>Absolute zero is 0 K = −273.15 °C = −459.67 °F = 0 °R. No substance can reach below absolute zero.</p>`},

  "Length":{icon:"📏",slug:"length",
    units:{"Meter (m)":1,"Kilometer (km)":1000,"Centimeter (cm)":0.01,"Millimeter (mm)":0.001,"Micrometer (um)":1e-6,"Nanometer (nm)":1e-9,"Picometer (pm)":1e-12,"Angstrom (A)":1e-10,"Inch (in)":0.0254,"Foot (ft)":0.3048,"Yard (yd)":0.9144,"Mile (mi)":1609.344,"Nautical Mile (nmi)":1852,"Fathom":1.8288,"Chain":20.1168,"Furlong":201.168,"Rod (rd)":5.0292,"Cubit":0.4572,"Mil (thou)":2.54e-5,"Light Year":9.461e15,"Astronomical Unit (AU)":1.496e11,"Parsec (pc)":3.0857e16},
    desc:"Length is the most fundamental dimensional measurement. Meters, feet, miles, and astronomical units cover all engineering scales.",
    aboutText:`<h2>About Length Conversion</h2><p>Length measures distance between two points. The SI unit is the meter. Imperial units (feet, inches, miles) remain common in the US and UK. Structural engineers use mm/m; civil engineers use km; semiconductor manufacturing uses nm. The Angstrom (0.1 nm) is used in crystallography. Astronomical distances use AU, light years, and parsecs.</p>`},

  "Area":{icon:"⬛",slug:"area",
    units:{"Square Meter (m2)":1,"Square Kilometer (km2)":1e6,"Square Centimeter (cm2)":0.0001,"Square Millimeter (mm2)":1e-6,"Square Decimeter (dm2)":0.01,"Hectare (ha)":10000,"Acre":4046.856,"Square Foot (ft2)":0.092903,"Square Inch (in2)":0.00064516,"Square Yard (yd2)":0.836127,"Square Mile (mi2)":2589988.11,"Square Nautical Mile":3434290,"Square Rod (rd2)":25.2929,"Dunam":1000,"Square Chain":404.686},
    desc:"Area measures two-dimensional space. Used in land surveying, construction, and material quantity estimation.",
    aboutText:`<h2>About Area Conversion</h2><p>Area measures a 2D surface. The SI unit is the square meter (m²). Land area uses hectares (metric) or acres (imperial). 1 hectare = 10,000 m² = 2.471 acres.</p>`},

  "Volume":{icon:"🧊",slug:"volume",
    units:{"Cubic Meter (m3)":1,"Liter (L)":0.001,"Milliliter (mL)":1e-6,"Cubic Centimeter (cm3)":1e-6,"Cubic Decimeter (dm3)":0.001,"Cubic Foot (ft3)":0.0283168,"Cubic Inch (in3)":1.63871e-5,"Cubic Yard (yd3)":0.764555,"US Gallon":0.00378541,"UK Gallon":0.00454609,"US Quart":9.46353e-4,"US Pint":4.73176e-4,"UK Pint":5.6826e-4,"US fl oz":2.95735e-5,"UK fl oz":2.84131e-5,"Oil Barrel (bbl)":0.158987,"Cup (US)":2.36588e-4,"Tablespoon (US)":1.47868e-5,"Teaspoon (US)":4.92892e-6},
    desc:"Volume measures three-dimensional space. Liters, gallons, and cubic meters are standard in engineering and cooking.",
    aboutText:`<h2>About Volume Conversion</h2><p>Volume is the 3D space occupied by a substance. SI unit: cubic meter (m³). Note: US and UK gallons differ — 1 US gallon = 3.785 L, 1 UK gallon = 4.546 L.</p>`},

  "Mass":{icon:"⚖️",slug:"mass",
    units:{"Kilogram (kg)":1,"Gram (g)":0.001,"Milligram (mg)":1e-6,"Microgram (ug)":1e-9,"Metric Ton (t)":1000,"Quintal (q)":100,"Pound (lb)":0.453592,"Ounce (oz)":0.0283495,"Stone":6.35029,"Grain (gr)":6.47989e-5,"Troy Ounce (ozt)":0.0311035,"Troy Pound":0.373242,"Pennyweight (dwt)":0.00155517,"Carat (ct)":0.0002,"Slug":14.5939,"Short Ton (US)":907.185,"Long Ton (UK)":1016.047,"Hundredweight (cwt, US)":45.3592,"Hundredweight (cwt, UK)":50.8023},
    desc:"Mass is the measure of matter in an object. Kilograms and pounds are the most common engineering units.",
    aboutText:`<h2>About Mass Conversion</h2><p>Mass is a fundamental property of matter. SI unit: kilogram (kg). Note: mass (kg) differs from weight (N) — weight = mass × gravity.</p>`},

  "Power":{icon:"⚡",slug:"power",
    units:{"Watt (W)":1,"Milliwatt (mW)":0.001,"Microwatt (uW)":1e-6,"Kilowatt (kW)":1000,"Megawatt (MW)":1e6,"Gigawatt (GW)":1e9,"Horsepower (HP)":745.7,"Metric HP":735.499,"Boiler HP":9809.5,"BTU/hr":0.293071,"BTU/min":17.5843,"BTU/s":1055.06,"cal/s":4.184,"kcal/hr":1.163,"kcal/s":4184,"Ton of Refrigeration":3516.853,"ft·lbf/s":1.35582,"ft·lbf/min":0.022597},
    desc:"Power is energy per unit time. Watts and horsepower are used in electrical and mechanical engineering.",
    aboutText:`<h2>About Power Conversion</h2><p>Power is the rate of doing work. SI unit: Watt (W = J/s). 1 mechanical HP = 745.7 W. 1 metric HP = 735.499 W. Air conditioning uses "tons of refrigeration" (1 ton = 3517 W).</p>`},

  "Energy":{icon:"🔋",slug:"energy",
    units:{"Joule (J)":1,"Kilojoule (kJ)":1000,"Megajoule (MJ)":1e6,"Gigajoule (GJ)":1e9,"Calorie (cal)":4.184,"Kilocalorie (kcal)":4184,"Watt-hour (Wh)":3600,"Kilowatt-hour (kWh)":3600000,"MWh":3.6e9,"GWh":3.6e12,"BTU":1055.06,"Therm":1.054804e8,"Quad":1.05480403e18,"ft·lbf":1.35582,"eV":1.60218e-19,"MeV":1.60218e-13,"Erg":1e-7,"Ton of TNT":4.184e9,"Ton of Oil Equiv (toe)":4.1868e10,"Barrel of Oil Equiv (BOE)":6.117e9},
    desc:"Energy is the capacity to do work. kWh, kJ, BTU, and Calories are common in engineering and daily life.",
    aboutText:`<h2>About Energy Conversion</h2><p>Energy is the ability to do work. SI unit: Joule (J). Electricity bills use kWh. Dietary energy uses kcal. US heating uses BTU; metric uses kJ/MJ. 1 kWh = 3600 kJ = 3412 BTU.</p>`},

  "Velocity":{icon:"💨",slug:"velocity",
    units:{"Meter/second (m/s)":1,"Kilometer/hour (km/h)":0.277778,"Mile/hour (mph)":0.44704,"Knot":0.514444,"Foot/second (ft/s)":0.3048,"Foot/minute (ft/min)":0.00508,"Inch/second (in/s)":0.0254,"Millimeter/second (mm/s)":0.001,"Centimeter/second (cm/s)":0.01,"Meter/minute (m/min)":0.016667,"Meter/hour (m/hr)":2.77778e-4,"Mach (sea level)":340.29,"Mach (stratosphere)":295,"Speed of Light (c)":2.998e8},
    desc:"Velocity is speed in a direction. km/h, mph, m/s, and knots are used in transport, meteorology, and aviation.",
    aboutText:`<h2>About Velocity Conversion</h2><p>Speed and velocity use the same units. SI unit: m/s. Road speed: km/h or mph. Aviation: knots (nautical miles/hr). Speed of sound at sea level ≈ 340.3 m/s = Mach 1.</p>`},

  "Acceleration":{icon:"🏎️",slug:"acceleration",
    units:{"m/s2":1,"cm/s2":0.01,"mm/s2":0.001,"ft/s2":0.3048,"in/s2":0.0254,"km/h/s":0.277778,"mph/s":0.44704,"g (standard gravity)":9.80665,"Gal (cm/s2)":0.01,"mGal":1e-5},
    desc:"Acceleration is the rate of change of velocity. g-force is used in aerospace, automotive, and seismic engineering.",
    aboutText:`<h2>About Acceleration Conversion</h2><p>Acceleration is the rate of change of velocity. SI unit: m/s². Standard g = 9.80665 m/s² = 32.174 ft/s². Used in crash testing, rocket propulsion, and seismology.</p>`},

  "Force":{icon:"💪",slug:"force",
    units:{"Newton (N)":1,"Millinewton (mN)":0.001,"Kilonewton (kN)":1000,"Meganewton (MN)":1e6,"Gram-force (gf)":0.00980665,"Kilogram-force (kgf)":9.80665,"Tonne-force (tf)":9806.65,"Pound-force (lbf)":4.44822,"Ounce-force (ozf)":0.278014,"Kip (1000 lbf)":4448.222,"Short Ton-force":8896.44,"Long Ton-force":9964.02,"Dyne":1e-5},
    desc:"Force causes acceleration. Newtons and pound-force are used in structural, mechanical, and aerospace engineering.",
    aboutText:`<h2>About Force Conversion</h2><p>Force = mass × acceleration (Newton's 2nd law). SI unit: Newton (N). 1 lbf = 4.448 N. 1 kip = 1000 lbf. Used in structural load calculations and machine design.</p>`},

  "Torque":{icon:"🔩",slug:"torque",
    units:{"N·m":1,"kN·m":1000,"MN·m":1e6,"N·cm":0.01,"N·mm":0.001,"dN·m":0.1,"lbf·ft":1.35582,"lbf·in":0.112985,"kgf·m":9.80665,"kgf·cm":0.0980665,"ozf·in":0.007062,"kip·ft":1355.82},
    desc:"Torque is rotational force. N·m and lbf·ft are standard in mechanical and automotive engineering.",
    aboutText:`<h2>About Torque Conversion</h2><p>Torque = force × perpendicular distance. SI unit: N·m. Car engine torque is given in N·m (metric) or lbf·ft (US). Fastener tightening torques are specified in N·m.</p>`},

  "Flow Rate (Vol)":{icon:"🌊",slug:"flow-rate-volume",
    units:{"m3/s":1,"m3/h":2.77778e-4,"m3/min":0.0166667,"L/s":0.001,"L/min":1.66667e-5,"L/h":2.7778e-7,"mL/s":1e-6,"mL/min":1.66667e-8,"US gpm":6.30902e-5,"US gph":1.0515e-6,"UK gpm":7.57682e-5,"ft3/min (cfm)":4.71947e-4,"ft3/h":2.83168e-5,"ft3/s":0.0283168,"bbl/day (oil)":1.84013e-6,"acre-ft/day":0.014276},
    desc:"Volumetric flow rate measures fluid volume per unit time. Used in pumps, HVAC, pipelines, and water treatment.",
    aboutText:`<h2>About Volumetric Flow Rate</h2><p>Volumetric flow rate (Q = v × A) measures volume passing a point per unit time. SI unit: m³/s. HVAC uses cfm and L/s. Pump performance uses m³/h or US gpm.</p>`},

  "Flow Rate (Mass)":{icon:"🌀",slug:"flow-rate-mass",
    units:{"kg/s":1,"kg/min":0.016667,"kg/h":2.77778e-4,"g/s":0.001,"g/min":1.66667e-5,"mg/s":1e-6,"lb/s":0.453592,"lb/min":7.55987e-3,"lb/h":1.25998e-4,"ton/h (metric)":0.277778,"ton/day (metric)":0.011574,"short ton/h (US)":0.251999,"long ton/h (UK)":0.282235},
    desc:"Mass flow rate measures fluid mass per unit time. Critical in combustion, chemical, and process engineering.",
    aboutText:`<h2>About Mass Flow Rate</h2><p>Mass flow rate (ṁ = ρQ) is fundamental to heat and mass balance calculations. SI unit: kg/s. Process plants use kg/h or ton/h. Unlike volumetric flow, mass flow is independent of pressure and temperature.</p>`},

  "Density":{icon:"🪨",slug:"density",
    units:{"kg/m3":1,"g/cm3":1000,"g/mL":1000,"g/L":1,"kg/L":1000,"mg/mL":1,"mg/L":0.001,"t/m3":1000,"lb/ft3":16.0185,"lb/in3":27679.9,"lb/gal (US)":119.826,"lb/gal (UK)":99.7763,"oz/in3":1729.99,"oz/gal (US)":7.48915},
    desc:"Density is mass per unit volume. Used in material selection, fluid mechanics, and buoyancy calculations.",
    aboutText:`<h2>About Density Conversion</h2><p>Density = mass / volume. SI unit: kg/m³. Water = 1000 kg/m³. Steel ≈ 7850 kg/m³. Aluminium ≈ 2700 kg/m³. Used to calculate buoyancy, hydrostatic pressure, and material weights.</p>`},

  "Viscosity (Dyn)":{icon:"🫙",slug:"dynamic-viscosity",
    units:{"Pa·s":1,"mPa·s":0.001,"Centipoise (cP)":0.001,"Poise (P)":0.1,"Micropoise (uP)":1e-7,"lb/(ft·s)":1.48816,"lb/(ft·hr)":4.13379e-4,"kgf·s/m2":9.80665,"dyne·s/cm2":0.1},
    desc:"Dynamic viscosity measures fluid resistance to flow. Used in lubricant selection, pipe flow, and polymer processing.",
    aboutText:`<h2>About Dynamic Viscosity</h2><p>Dynamic viscosity (μ) measures internal resistance to flow. SI unit: Pa·s. Water at 20°C ≈ 1 mPa·s = 1 cP. Motor oil ≈ 100–200 cP. Critical in Reynolds number calculations and pump design.</p>`},

  "Viscosity (Kin)":{icon:"💧",slug:"kinematic-viscosity",
    units:{"m2/s":1,"mm2/s (cSt)":1e-6,"cm2/s (St)":1e-4,"dm2/s":0.01,"ft2/s":0.092903,"ft2/hr":2.58064e-5,"in2/s":6.4516e-4},
    desc:"Kinematic viscosity is dynamic viscosity divided by density. Used in fluid mechanics and lubrication engineering.",
    aboutText:`<h2>About Kinematic Viscosity</h2><p>Kinematic viscosity (ν = μ/ρ) accounts for both viscosity and density. SI unit: m²/s. Expressed in centistokes (cSt). Lubricating oils: 10–500 cSt. Water at 20°C: 1.0 cSt.</p>`},

  "Thermal Conductivity":{icon:"🌡",slug:"thermal-conductivity",
    units:{"W/(m·K)":1,"W/(m·°C)":1,"mW/(m·K)":0.001,"kW/(m·K)":1000,"MW/(m·K)":1e6,"BTU/(hr·ft·°F)":1.73073,"BTU·in/(hr·ft2·°F)":0.144228,"kcal/(hr·m·°C)":1.163,"cal/(s·cm·°C)":418.68},
    desc:"Thermal conductivity measures heat transfer ability. Used in insulation design, heat exchangers, and material selection.",
    aboutText:`<h2>About Thermal Conductivity</h2><p>Thermal conductivity (k) measures a material's ability to conduct heat. SI unit: W/(m·K). Copper: 401. Steel: ~50. Concrete: ~1.7. Glass wool insulation: ~0.04. Essential for heat exchanger and building insulation design.</p>`},

  "Specific Heat":{icon:"🔥",slug:"specific-heat",
    units:{"J/(kg·K)":1,"kJ/(kg·K)":1000,"kJ/(kg·°C)":1000,"J/(g·K)":1000,"cal/(g·°C)":4186.8,"BTU/(lb·°F)":4186.8,"BTU/(lb·°R)":4186.8,"kcal/(kg·°C)":4186.8,"kcal/(kg·K)":4186.8,"J/(mol·K)":1},
    desc:"Specific heat capacity measures energy needed to raise temperature. Used in thermal analysis and heat exchanger design.",
    aboutText:`<h2>About Specific Heat Capacity</h2><p>Specific heat (cp) is the energy to raise 1 kg of material by 1 K. SI unit: J/(kg·K). Water: 4186. Steel: ~490. Air: ~1005. Critical for heat exchanger sizing and thermal energy storage.</p>`},

  "Heat Flux":{icon:"☀️",slug:"heat-flux",
    units:{"W/m2":1,"kW/m2":1000,"MW/m2":1e6,"W/cm2":10000,"W/mm2":1e6,"BTU/(hr·ft2)":3.15459,"BTU/(min·ft2)":189.276,"BTU/(s·ft2)":11356.5,"kcal/(hr·m2)":1.163,"kcal/(s·m2)":4186.8,"cal/(s·cm2)":41868},
    desc:"Heat flux is power transferred per unit area. Used in boiler design, solar energy, and electronics cooling.",
    aboutText:`<h2>About Heat Flux</h2><p>Heat flux (q = Q/(A·t)) is heat transfer rate per unit area. SI unit: W/m². Solar radiation ≈ 1000 W/m². Electronics cooling: 10–100 W/cm².</p>`},

  "Heat Transfer Coeff":{icon:"📡",slug:"heat-transfer-coefficient",
    units:{"W/(m2·K)":1,"W/(m2·°C)":1,"kW/(m2·K)":1000,"MW/(m2·K)":1e6,"BTU/(hr·ft2·°F)":5.67826,"BTU/(s·ft2·°F)":20441.7,"kcal/(hr·m2·°C)":1.163,"kcal/(s·m2·°C)":4186.8,"cal/(s·cm2·°C)":41868},
    desc:"Heat transfer coefficient quantifies convective heat transfer. Used in heat exchanger and HVAC design.",
    aboutText:`<h2>About Heat Transfer Coefficient</h2><p>The heat transfer coefficient (h) quantifies heat transfer between a surface and a fluid. SI unit: W/(m²·K). Forced air: 25–250. Boiling water: 2000–20,000. Essential for heat exchanger area calculations.</p>`},

  "Stress / Pressure (Structural)":{icon:"🏗️",slug:"stress-pressure-structural",
    units:{"Pa":1,"kPa":1000,"MPa":1e6,"GPa":1e9,"TPa":1e12,"N/mm2":1e6,"N/m2":1,"kN/m2":1000,"MN/m2":1e6,"PSI":6894.76,"ksi":6894760,"Msi":6.89476e9,"kgf/cm2":98066.5,"kgf/mm2":9806650,"bar":100000,"mbar":100,"atm":101325},
    desc:"Structural stress and pressure share the same SI unit (Pa). Used in civil, mechanical, and materials engineering.",
    aboutText:`<h2>About Structural Stress/Pressure</h2><p>Stress (force per area) and pressure share the same units. SI unit: Pascal (Pa). Material strength is quoted in MPa or N/mm². 1 N/mm² = 1 MPa. Steel yield: 250–690 MPa.</p>`},

  "Fuel Economy":{icon:"⛽",slug:"fuel-economy",special:"fuel",
    units:["L/100km","km/L","mpg (US)","mpg (UK)"],
    desc:"Fuel economy is an inverse relationship — higher mpg means lower L/100km consumption.",
    aboutText:`<h2>About Fuel Economy Conversion</h2><p>Fuel economy uses inverse relationships. L/100km (consumption) and km/L (efficiency) are reciprocals. US mpg uses the US gallon (3.785 L); UK mpg uses the Imperial gallon (4.546 L). A US car rated 30 mpg equals about 7.84 L/100km.</p>`},

  "Frequency":{icon:"〰️",slug:"frequency",
    units:{"Hertz (Hz)":1,"Kilohertz (kHz)":1000,"Megahertz (MHz)":1e6,"Gigahertz (GHz)":1e9,"RPM":0.016667,"rad/s":0.159155,"cycles/min":0.016667,"cycles/hr":2.77778e-4},
    desc:"Frequency measures cycles per second. Hz, kHz, MHz, and GHz cover audio, radio, and digital signals.",
    aboutText:`<h2>About Frequency Conversion</h2><p>Frequency is the number of cycles per second. SI unit: Hertz (Hz). Audio: 20 Hz–20 kHz. Radio: MHz–GHz. CPU clocks: GHz. 1 RPM = 1/60 Hz. Angular frequency ω (rad/s) = 2π × Hz.</p>`},

  "Angle":{icon:"📐",slug:"angle",
    units:{"Degree (°)":1,"Radian (rad)":57.2958,"Gradian (grad)":0.9,"Arcminute (')":0.016667,"Arcsecond (\")":2.77778e-4,"Milliradian (mrad)":0.0572958,"Turn (revolution)":360,"Quadrant":90,"Sextant":60},
    desc:"Angle units span degrees, radians, and gradians. Used in trigonometry, navigation, and engineering.",
    aboutText:`<h2>About Angle Conversion</h2><p>Angles measure rotation. SI derived unit: radian. 1 full turn = 360° = 2π rad = 400 grad. Gradians (gon) divide the right angle into 100 parts — convenient for surveying calculations.</p>`},

  "Time":{icon:"⏱️",slug:"time",
    units:{"Second (s)":1,"Millisecond (ms)":0.001,"Microsecond (us)":1e-6,"Nanosecond (ns)":1e-9,"Minute (min)":60,"Hour (hr)":3600,"Day":86400,"Week":604800,"Month (avg)":2628000,"Year (avg)":31536000,"Decade":315360000,"Century":3.1536e9},
    desc:"Time units span nanoseconds to years. Used in process control, scheduling, physics, and signal processing.",
    aboutText:`<h2>About Time Conversion</h2><p>Time ranges from nanoseconds (electronics) to geological eons. SI unit: second. 1 day = 86,400 s. 1 year ≈ 31,536,000 s. Nanoseconds are critical in digital electronics (1 GHz processor cycles in 1 ns).</p>`},

  "Concentration":{icon:"🧪",slug:"concentration",special:"concentration",
    units:["ppm (mg/kg)","mg/L","mg/m³","µg/L (ppb)","µg/m³","% w/w","% w/v","% v/v","g/L","g/m³","mol/L (M)","mmol/L (mM)","µmol/L (µM)"],
    desc:"Concentration conversions between ppm, mg/L, %, ppb and molar units. Default matrix: water (density 1.0 g/mL) for liquids, air for gases.",
    aboutText:`<h2>About Concentration Conversion</h2><p>Concentration expresses the amount of a solute in a solution or mixture. Different industries use different units:</p><h3>Liquids (default: water, ρ = 1.0 g/mL)</h3><p><strong>ppm (mg/kg)</strong> — parts per million by mass. For dilute aqueous solutions: 1 ppm ≈ 1 mg/L.</p><p><strong>mg/L</strong> — milligrams per litre. Most common in water quality and environmental analysis.</p><p><strong>% w/w</strong> — grams of solute per 100 g solution. 1% = 10,000 ppm.</p><h3>Gases (default: air, MW = 28.97 g/mol, at 25°C 1 atm)</h3><p>Gas ppm is volume-based (ppmv). Formula: mg/m³ = ppm × MW / 24.45 (at 25°C).</p>`}
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentCat = "Pressure";
let sidebarOpen = false;

// ─── URL ROUTING ─────────────────────────────────────────────────────────────
function slugify(str){
  return String(str).toLowerCase()
    .replace(/[()°·²³]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
function parseURL(){
  const path = window.location.pathname;
  const m = path.match(/\/unit-converter\/([^/]+)\/?([^/]+)?/);
  if(!m) return null;
  const catSlug=m[1], pairSlug=m[2]||'';
  const catName=Object.keys(CATEGORIES).find(c=>CATEGORIES[c].slug===catSlug);
  if(!catName) return null;
  const cat=CATEGORIES[catName];
  const units=cat.special==="temp"?cat.units:Object.keys(cat.units);
  if(!pairSlug) return {cat:catName,fromUnit:units[0],toUnit:units[1]};
  let bestFrom=null,bestTo=null;
  for(let i=0;i<units.length;i++){
    const fs=slugify(units[i]);
    if(!pairSlug.startsWith(fs+'-to-')) continue;
    const rest=pairSlug.slice(fs.length+4);
    for(let j=0;j<units.length;j++){
      if(i===j) continue;
      if(slugify(units[j])===rest){bestFrom=units[i];bestTo=units[j];break;}
    }
    if(bestFrom) break;
  }
  return {cat:catName,fromUnit:bestFrom||units[0],toUnit:bestTo||units[1]};
}
function pushURL(catName,fromUnit,toUnit){
  const cat=CATEGORIES[catName]; if(!cat) return;
  const path=`/unit-converter/${cat.slug}/${slugify(fromUnit)}-to-${slugify(toUnit)}/`;
  const title=buildPageTitle(catName,fromUnit,toUnit);
  try{ window.history.pushState({cat:catName,from:fromUnit,to:toUnit},title,path); }catch(e){}
}

// ─── SEO META + SCHEMA ───────────────────────────────────────────────────────
function shortUnit(u){ const m=String(u).match(/\(([^)]+)\)$/); return m?m[1]:u; }
function longUnit(u){ const m=String(u).match(/^([^(]+)\s*\(/); return m?m[1].trim():u; }
function buildPageTitle(catName,fromUnit,toUnit){
  return `Convert ${longUnit(fromUnit)} to ${longUnit(toUnit)} | ${shortUnit(fromUnit)} to ${shortUnit(toUnit)} Converter — multicalci.com`;
}
function buildMetaDesc(catName,fromUnit,toUnit,factorStr){
  const fs=shortUnit(fromUnit),ts=shortUnit(toUnit),fl=longUnit(fromUnit),tl=longUnit(toUnit);
  return `Convert ${fl} (${fs}) to ${tl} (${ts}) instantly.${factorStr?` 1 ${fs} = ${factorStr} ${ts}.`:''} Free ${catName.toLowerCase()} converter with formula, common values table, and FAQ.`;
}
function injectSchema(catName,fromUnit,toUnit,factorStr,formulaStr){
  const fs=shortUnit(fromUnit),ts=shortUnit(toUnit),fl=longUnit(fromUnit),tl=longUnit(toUnit);
  const cat=CATEGORIES[catName];
  const url=`https://multicalci.com/unit-converter/${cat.slug}/${slugify(fromUnit)}-to-${slugify(toUnit)}/`;
  const faqs=buildFAQData(catName,fromUnit,toUnit,factorStr,formulaStr);
  const schema={
    "@context":"https://schema.org",
    "@graph":[
      {"@type":"WebApplication","name":`${fl} to ${tl} Converter`,"url":url,
       "applicationCategory":"UtilitiesApplication","operatingSystem":"Web",
       "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},
       "description":`Convert ${fl} (${fs}) to ${tl} (${ts}).${factorStr?` 1 ${fs} = ${factorStr} ${ts}.`:''} ${cat.desc}`},
      {"@type":"HowTo","name":`How to convert ${fl} to ${tl}`,
       "description":`Step-by-step guide to convert ${fs} to ${ts}.`,
       "step":[
         {"@type":"HowToStep","name":"Enter the value","text":`Type the value in ${fs} into the input box.`},
         {"@type":"HowToStep","name":"Apply the formula","text":formulaStr||`The calculator converts ${fs} to ${ts} instantly.`},
         {"@type":"HowToStep","name":"Read the result","text":`The result in ${ts} is shown instantly in the right box.`}
       ]},
      {"@type":"BreadcrumbList","itemListElement":[
        {"@type":"ListItem","position":1,"name":"Home","item":"https://multicalci.com/"},
        {"@type":"ListItem","position":2,"name":"Unit Converter","item":"https://multicalci.com/unit-converter/"},
        {"@type":"ListItem","position":3,"name":catName,"item":`https://multicalci.com/unit-converter/${cat.slug}/`},
        {"@type":"ListItem","position":4,"name":`${fs} to ${ts}`,"item":url}
      ]},
      ...(faqs.length>0?[{"@type":"FAQPage","mainEntity":faqs.map(f=>({
        "@type":"Question","name":f.q,"acceptedAnswer":{"@type":"Answer","text":f.a}
      }))}]:[])
    ]
  };
  const el=document.getElementById('schemaLD');
  if(el) el.textContent=JSON.stringify(schema,null,2);
}
function updateSEO(catName,fromUnit,toUnit,factorStr,formulaStr){
  const title=buildPageTitle(catName,fromUnit,toUnit);
  const desc=buildMetaDesc(catName,fromUnit,toUnit,factorStr);
  const cat=CATEGORIES[catName];
  const url=`https://multicalci.com/unit-converter/${cat.slug}/${slugify(fromUnit)}-to-${slugify(toUnit)}/`;
  const fs=shortUnit(fromUnit),ts=shortUnit(toUnit);
  document.getElementById('pageTitle').textContent=title;
  document.title=title;
  setMeta('metaDesc','content',desc);
  setMeta('metaKeys','content',`${fromUnit} to ${toUnit}, ${fs} to ${ts} converter, convert ${fs} to ${ts}, ${catName.toLowerCase()} converter, ${fs} ${ts} formula`);
  setMeta('canonicalLink','href',url);
  setMeta('ogTitle','content',title);
  setMeta('ogDesc','content',desc);
  setMeta('ogUrl','content',url);
  document.getElementById('bcCategory').textContent=`${fs} → ${ts}`;
  injectSchema(catName,fromUnit,toUnit,factorStr,formulaStr);
  pushURL(catName,fromUnit,toUnit);
}
function setMeta(id,attr,val){const el=document.getElementById(id);if(el)el.setAttribute(attr,val);}

// ─── SEO CONTENT GENERATION ──────────────────────────────────────────────────
function getConversionFactor(catName,fromUnit,toUnit){
  const cat=CATEGORIES[catName];
  if(!cat||cat.special) return null;
  const f1=cat.units[fromUnit],f2=cat.units[toUnit];
  if(!f1||!f2) return null;
  return f1/f2;
}
function fmtFactor(v){
  if(!isFinite(v)||v===0) return '—';
  const abs=Math.abs(v);
  if(abs>=0.0001&&abs<1e10) return parseFloat(v.toPrecision(7)).toString();
  return v.toExponential(4);
}
function buildHowTo(catName,fromUnit,toUnit){
  const fs=shortUnit(fromUnit),ts=shortUnit(toUnit),fl=longUnit(fromUnit),tl=longUnit(toUnit);
  const cat=CATEGORIES[catName];
  const factor=getConversionFactor(catName,fromUnit,toUnit);
  const factorStr=factor!==null?fmtFactor(factor):null;
  const formulaStr=factor!==null?`${ts} = ${fs} × ${factorStr}`:null;
  let html='';
  if(factorStr){
    html+=`<div class="how-to-answer"><strong>1 ${fl} (${fs}) = ${factorStr} ${tl} (${ts}).</strong> To convert ${fl} to ${tl}, multiply the ${fs} value by <strong>${factorStr}</strong>. To convert back, divide by ${factorStr}.</div>`;
  } else if(cat.special==='temp'){
    html+=`<div class="how-to-answer">Temperature conversions require specific formulas because the scales have different zero points. Use the converter above for an instant, accurate result.</div>`;
  }
  html+=`<ol class="how-to-steps">`;
  if(cat.special==='temp'){
    const tempF={'°C→°F':'°F = (°C × 9/5) + 32','°F→°C':'°C = (°F − 32) × 5/9','°C→K':'K = °C + 273.15','K→°C':'°C = K − 273.15','°F→K':'K = (°F − 32) × 5/9 + 273.15'};
    const s1=fs.slice(0,2),s2=ts.slice(0,2);
    const f=tempF[`${s1}→${s2}`]||`Apply the ${fs} to ${ts} formula`;
    html+=`<li><span class="step-num">1</span><span>Enter your temperature value in the <strong>${fs}</strong> input box.</span></li>
    <li><span class="step-num">2</span><span>Apply the formula: <strong>${f}</strong></span></li>
    <li><span class="step-num">3</span><span>Read the converted result in <strong>${ts}</strong> on the right.</span></li>`;
  } else if(cat.special==='fuel'){
    html+=`<li><span class="step-num">1</span><span>Enter your fuel value in <strong>${fs}</strong>.</span></li>
    <li><span class="step-num">2</span><span><strong>Inverse relationship:</strong> higher L/100km means lower mpg / km/L efficiency.</span></li>
    <li><span class="step-num">3</span><span>Read the equivalent <strong>${ts}</strong> value on the right.</span></li>`;
  } else {
    html+=`<li><span class="step-num">1</span><span>Enter the <strong>${fl}</strong> value in the left input box.</span></li>
    <li><span class="step-num">2</span><span>The converter applies: <strong>${formulaStr||`${ts} = ${fs} × factor`}</strong></span></li>
    <li><span class="step-num">3</span><span>Read the result in <strong>${tl} (${ts})</strong> instantly in the right box.</span></li>
    <li><span class="step-num">4</span><span>To reverse (${ts} → ${fs}), click the <strong>⇄ swap button</strong>.</span></li>`;
  }
  html+=`</ol>`;
  return {html,factorStr,formulaStr};
}
function buildCommonTable(catName,fromUnit,toUnit){
  const fs=shortUnit(fromUnit),ts=shortUnit(toUnit);
  const factor=getConversionFactor(catName,fromUnit,toUnit);
  const cat=CATEGORIES[catName];
  const vals=[0.1,0.5,1,2,5,10,25,50,100,200,500,1000];
  let html=`<h2 style="font-family:'Syne',sans-serif;font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:12px;">Common ${fs} to ${ts} Conversions</h2>
  <div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border)">
  <table class="common-vals-table"><thead><tr><th>${fromUnit}</th><th>${toUnit}</th></tr></thead><tbody>`;
  vals.forEach(v=>{
    if(cat.special||!factor) return;
    html+=`<tr><td>${v} ${fs}</td><td>${fmtFactor(v*factor)} ${ts}</td></tr>`;
  });
  if(cat.special) html+=`<tr><td colspan="2" style="color:var(--muted);font-size:.8rem;padding:12px 14px;">Use the converter above to calculate custom values.</td></tr>`;
  html+=`</tbody></table></div><p style="font-size:.75rem;color:var(--muted);margin-top:10px;font-family:'DM Mono',monospace;">Values rounded to 7 significant figures.</p>`;
  return html;
}
function buildFAQData(catName,fromUnit,toUnit,factorStr,formulaStr){
  const fs=shortUnit(fromUnit),ts=shortUnit(toUnit),fl=longUnit(fromUnit),tl=longUnit(toUnit);
  const cat=CATEGORIES[catName];
  const faqs=[];
  if(factorStr&&cat&&!cat.special){
    faqs.push({q:`What is 1 ${fl} (${fs}) in ${tl} (${ts})?`,a:`1 ${fl} (${fs}) = ${factorStr} ${tl} (${ts}). Formula: ${formulaStr}.`});
    faqs.push({q:`How do I convert ${fs} to ${ts}?`,a:`Multiply the ${fs} value by ${factorStr}. Example: 10 ${fs} = ${fmtFactor(10*parseFloat(factorStr))} ${ts}.`});
    faqs.push({q:`What is the formula to convert ${fs} to ${ts}?`,a:`${formulaStr}. To reverse: ${fs} = ${ts} ÷ ${factorStr}.`});
    faqs.push({q:`Is this ${fl} to ${tl} converter free?`,a:`Yes — completely free, no sign-up needed, works instantly in your browser at multicalci.com.`});
  } else if(cat&&cat.special==='temp'){
    faqs.push({q:`How do I convert ${fs} to ${ts}?`,a:`Use the converter above. Temperature scales use offset formulas because they have different zero points.`});
    faqs.push({q:`Why can't I just multiply to convert temperature?`,a:`Temperature scales (°C, °F, K, °R) have different zero points, so simple multiplication gives wrong results — you must also add or subtract a constant.`});
    faqs.push({q:`What is absolute zero?`,a:`Absolute zero is 0 K = −273.15 °C = −459.67 °F = 0 °R — the lowest theoretically possible temperature.`});
  } else {
    faqs.push({q:`How do I use this ${catName.toLowerCase()} converter?`,a:`Enter a value in the left box, select your source unit, and the result appears instantly. Use ⇄ to swap units.`});
    faqs.push({q:`What units does this ${catName.toLowerCase()} converter support?`,a:`${cat?.desc||''} Supported units: ${Object.keys(cat?.units||{}).slice(0,6).join(', ')}.`});
  }
  return faqs;
}
function buildFAQ(catName,fromUnit,toUnit,factorStr,formulaStr){
  return buildFAQData(catName,fromUnit,toUnit,factorStr,formulaStr).map((f,i)=>`
    <div class="faq-item" id="faq${i}">
      <button class="faq-q" onclick="toggleFAQ(${i})" aria-expanded="false">
        ${f.q}<span class="faq-arrow" aria-hidden="true">▼</span>
      </button>
      <div class="faq-a" id="faq${i}-a">${f.a}</div>
    </div>`).join('');
}
function toggleFAQ(i){
  const item=document.getElementById('faq'+i);if(!item) return;
  const open=item.classList.contains('open');
  item.classList.toggle('open',!open);
  const btn=item.querySelector('.faq-q');
  if(btn) btn.setAttribute('aria-expanded',String(!open));
}
function refreshSEOContent(catName,fromUnit,toUnit){
  const {html,factorStr,formulaStr}=buildHowTo(catName,fromUnit,toUnit);
  document.getElementById('howToContent').innerHTML=html;
  document.getElementById('tableContent').innerHTML=buildCommonTable(catName,fromUnit,toUnit);
  document.getElementById('faqContent').innerHTML=buildFAQ(catName,fromUnit,toUnit,factorStr,formulaStr);
  document.getElementById('aboutContent').innerHTML=CATEGORIES[catName]?.aboutText||'';
  renderDefsPanel(catName);
  updateSEO(catName,fromUnit,toUnit,factorStr,formulaStr);
}
function showTab(name,btn){
  document.querySelectorAll('.seo-panel').forEach(p=>p.classList.remove('show'));
  document.querySelectorAll('.seo-tab').forEach(b=>{b.classList.remove('active-tab');b.setAttribute('aria-selected','false');});
  const p=document.getElementById('tab-'+name);if(p) p.classList.add('show');
  if(btn){btn.classList.add('active-tab');btn.setAttribute('aria-selected','true');}
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function init(){
  const urlState=parseURL();
  if(urlState) currentCat=urlState.cat;
  else if(window.DEFAULT_CAT && CATEGORIES[window.DEFAULT_CAT]) currentCat=window.DEFAULT_CAT;
  buildSidebar();
  const effectiveState = urlState || (window.DEFAULT_FROM ? {cat:currentCat, fromUnit:window.DEFAULT_FROM, toUnit:window.DEFAULT_TO} : null);
  setupSelectors(effectiveState);
  setupSearch();
  setupInputListeners();
  convert(1);
  document.getElementById('mobileCatName').textContent=currentCat;
  window.addEventListener('popstate',function(e){
    if(e.state&&e.state.cat){
      currentCat=e.state.cat;
      setCategory(currentCat,false);
      const u1=document.getElementById('unit1'),u2=document.getElementById('unit2');
      if(e.state.from&&u1) u1.value=e.state.from;
      if(e.state.to&&u2) u2.value=e.state.to;
      convert(1);
    }
  });
}
function buildSidebar(filter=""){
  const list=document.getElementById('categoryList');
  list.innerHTML="";
  Object.keys(CATEGORIES).forEach(cat=>{
    if(filter&&!cat.toLowerCase().includes(filter.toLowerCase())) return;
    const d=CATEGORIES[cat];
    const btn=document.createElement('button');
    btn.className='cat-btn'+(cat===currentCat?' active-cat':'');
    btn.innerHTML=`<span class="cat-icon" aria-hidden="true">${d.icon}</span>${cat}`;
    btn.setAttribute('aria-label',`Open ${cat} converter`);
    btn.onclick=()=>{
      setCategory(cat,true);
      if(window.innerWidth<=768){
        sidebarOpen=false;
        document.getElementById('sidebar').classList.remove('open');
        const arrow=document.getElementById('mobileCatArrow'),tog=document.getElementById('mobileCatToggle');
        if(arrow) arrow.textContent='▼';
        if(tog) tog.setAttribute('aria-expanded','false');
      }
    };
    list.appendChild(btn);
  });
}
function setupSelectors(urlState){
  const s1=document.getElementById('unit1'),s2=document.getElementById('unit2');
  s1.innerHTML=s2.innerHTML="";
  const cat=CATEGORIES[currentCat];
  if(cat.special==="concentration"){
    document.getElementById('catSub').textContent=`— 13 concentration units`;
    return;
  }
  const units=cat.special==="temp"?cat.units:Object.keys(cat.units);
  units.forEach(u=>{s1.add(new Option(u,u));s2.add(new Option(u,u));});
  if(urlState&&urlState.fromUnit){s1.value=urlState.fromUnit;s2.value=urlState.toUnit;}
  else if(units.length>1) s2.selectedIndex=1;
  s1.setAttribute('aria-label',`Convert from — ${currentCat} unit`);
  s2.setAttribute('aria-label',`Convert to — ${currentCat} unit`);
  document.getElementById('catSub').textContent=`— ${units.length} unit${units.length>1?'s':''} available`;
}
function setupSearch(){
  document.getElementById('globalSearch').addEventListener('input',function(){buildSidebar(this.value);});
}
function setupInputListeners(){
  const v1=document.getElementById('val1'),v2=document.getElementById('val2');
  const u1=document.getElementById('unit1'),u2=document.getElementById('unit2');
  v1.addEventListener('input',()=>convert(1));
  v2.addEventListener('input',()=>convert(2));
  u1.addEventListener('change',()=>{convert(1);onUnitChange();});
  u2.addEventListener('change',()=>{convert(1);onUnitChange();});
}
function onUnitChange(){
  const u1=document.getElementById('unit1').value,u2=document.getElementById('unit2').value;
  refreshSEOContent(currentCat,u1,u2);
}
function setCategory(cat,doURL=true){
  currentCat=cat;
  document.querySelectorAll('.cat-btn').forEach(b=>b.classList.toggle('active-cat',b.textContent.trim().includes(cat)));
  document.getElementById('catTitle').innerHTML=`${cat} <span>Converter</span>`;
  document.getElementById('mobileCatName').textContent=cat;
  document.getElementById('bcCategory').textContent=cat;
  document.getElementById('val1').value="1";
  const cp=document.getElementById('concPanel');
  const isConc=(cat==="Concentration");
  if(cp) cp.style.display=isConc?'block':'none';
  const ca=document.querySelector('.conversion-area');
  const fb=document.querySelector('.formula-bar');
  const rt=document.querySelector('.ref-table-wrap');
  if(ca) ca.style.display=isConc?'none':'block';
  if(fb) fb.style.display=isConc?'none':'flex';
  if(rt) rt.style.display=isConc?'none':'block';
  if(!isConc){setupSelectors(null);convert(1);}
  else{resetConcFields();setConcMode(currentConcMode);}
}

// ─── CONCENTRATION CONVERTER ──────────────────────────────────────────────────
let currentConcMode = 'liquid';
let _concLock = false;

function setConcMode(mode){
  currentConcMode = mode;
  document.getElementById('concModeLiquid').classList.toggle('active', mode==='liquid');
  document.getElementById('concModeGas').classList.toggle('active', mode==='gas');
  const isGas = mode==='gas';
  const dLabel = document.getElementById('densityLabel');
  const dHint  = document.getElementById('densityHint');
  const dInput = document.getElementById('concDensity');
  const tGroup = document.getElementById('tempGroup');
  const ppmvG  = document.getElementById('cPpmvGroup');
  if(isGas){
    dLabel.textContent = 'Air Density (kg/m³ → g/L)';
    dHint.textContent  = 'Default: dry air = 1.2041 g/L @ 20°C, 1 atm';
    if(parseFloat(dInput.value)===1.000 || parseFloat(dInput.value)===1.2041) dInput.value='1.2041';
    tGroup.style.display='flex';
    if(ppmvG) ppmvG.style.display='flex';
  } else {
    dLabel.textContent = 'Solution Density (g/mL)';
    dHint.textContent  = 'Default: water = 1.000 g/mL';
    if(parseFloat(dInput.value)===1.2041 || parseFloat(dInput.value)===1.000) dInput.value='1.000';
    tGroup.style.display='flex';
    if(ppmvG) ppmvG.style.display='none';
  }
  updateVmNote();
  runConcCalc();
}
function updateVmNote(){
  const T = parseFloat(document.getElementById('concTemp').value)||25;
  const P = parseFloat(document.getElementById('concPressure').value)||1;
  const Vm = (0.082057*(T+273.15))/P;
  const el = document.getElementById('vmolHint');
  if(el) el.textContent = `Vm = ${Vm.toFixed(3)} L/mol @ ${T}°C, ${P} atm`;
}
function resetConcFields(){
  ['c_ppm','c_mgL','c_mgm3','c_ppb','c_ugm3','c_pww','c_pwv','c_gL','c_gm3','c_molL','c_mmolL','c_ppmv']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
}
function getMolarVolume(){
  const T = parseFloat(document.getElementById('concTemp').value)||25;
  const P = parseFloat(document.getElementById('concPressure').value)||1;
  return (0.082057*(T+273.15))/P;
}
function runConcCalc(source){
  if(_concLock) return;
  const rho  = parseFloat(document.getElementById('concDensity').value)||1.0;
  const MW   = parseFloat(document.getElementById('concMW').value)||0;
  const Vm   = getMolarVolume();
  updateVmNote();
  const get = id => { const el=document.getElementById(id); return el?parseFloat(el.value):NaN; };
  let ppm_base = NaN;
  const isGas = currentConcMode==='gas';
  if(!source) return;
  switch(source){
    case 'ppm':   ppm_base = get('c_ppm'); break;
    case 'mgL':   ppm_base = get('c_mgL') / rho; break;
    case 'mgm3':  ppm_base = (get('c_mgm3')/1000) / rho; break;
    case 'ppb':   ppm_base = get('c_ppb') / 1000; break;
    case 'ugm3':  ppm_base = (get('c_ugm3')/1e6) / rho; break;
    case 'pww':   ppm_base = get('c_pww') * 10000; break;
    case 'pwv':   ppm_base = (get('c_pwv')*10000) / rho; break;
    case 'gL':    ppm_base = (get('c_gL')*1000) / rho; break;
    case 'gm3':   ppm_base = get('c_gm3') / rho; break;
    case 'molL':  if(MW>0) ppm_base = (get('c_molL')*MW*1000)/rho; break;
    case 'mmolL': if(MW>0) ppm_base = (get('c_mmolL')*MW)/rho; break;
    case 'ppmv':
      if(MW>0){
        const mgm3 = get('c_ppmv') * MW / Vm;
        ppm_base = (mgm3/1000)/rho;
      } break;
  }
  if(isNaN(ppm_base)||!isFinite(ppm_base)) return;
  const mgL  = ppm_base * rho;
  const mgm3 = mgL * 1000;
  const ppb  = ppm_base * 1000;
  const ugm3 = mgm3 * 1000;
  const pww  = ppm_base / 10000;
  const pwv  = (mgL / 10000);
  const gL   = mgL / 1000;
  const gm3  = mgm3 / 1000;
  const molL = MW>0 ? mgL/(MW*1000) : NaN;
  const mmolL= MW>0 ? molL*1000 : NaN;
  const ppmv = (MW>0) ? (mgm3*Vm/MW) : NaN;
  const fmt = v => {
    if(isNaN(v)||!isFinite(v)) return '';
    const a=Math.abs(v);
    if(a===0) return '0';
    if(a>=0.0001&&a<1e10) return parseFloat(v.toPrecision(7)).toString();
    return v.toExponential(4);
  };
  _concLock = true;
  const set = (id,val) => { const el=document.getElementById(id); if(el&&source!==id.replace('c_','')) el.value=fmt(val); };
  set('c_ppm',  ppm_base); set('c_mgL',  mgL); set('c_mgm3', mgm3);
  set('c_ppb',  ppb);      set('c_ugm3', ugm3); set('c_pww',  pww);
  set('c_pwv',  pwv);      set('c_gL',   gL);  set('c_gm3',  gm3);
  if(MW>0){ set('c_molL', molL); set('c_mmolL', mmolL); }
  if(isGas&&MW>0) set('c_ppmv', ppmv);
  _concLock = false;
  const note = document.getElementById('concFormulaNote');
  if(note){
    if(isGas){
      const vmStr=Vm.toFixed(3);
      note.innerHTML=`<strong>Gas mode (air, ρ=${rho} g/L, Vm=${vmStr} L/mol):</strong> ppmv → mg/m³ = ppmv × MW / Vm &nbsp;|&nbsp; µg/m³ = mg/m³ × 1000 &nbsp;|&nbsp; ${MW>0?`Using MW=${MW} g/mol`:'<em>Enter Molar Mass for ppmv conversion</em>'}`;
    } else {
      note.innerHTML=`<strong>Liquid mode (ρ=${rho} g/mL):</strong> ppm = mg/L ÷ ρ &nbsp;|&nbsp; % w/w = ppm ÷ 10,000 &nbsp;|&nbsp; % w/v = mg/L ÷ 10,000 &nbsp;|&nbsp; 1 ppm = 1 mg/L (water)`;
    }
  }
}

// ─── CONVERSION LOGIC ─────────────────────────────────────────────────────────
function toBaseCelsius(v,u){
  if(u.startsWith("°C")) return v;
  if(u.startsWith("°F")) return (v-32)*5/9;
  if(u.startsWith("K"))  return v-273.15;
  if(u.startsWith("°R")) return (v-491.67)*5/9;
  return v;
}
function fromBaseCelsius(c,u){
  if(u.startsWith("°C")) return c;
  if(u.startsWith("°F")) return c*9/5+32;
  if(u.startsWith("K"))  return c+273.15;
  if(u.startsWith("°R")) return (c+273.15)*9/5;
  return c;
}
function toBaseL100km(v,u){
  if(u==="L/100km") return v;
  if(u==="km/L") return v===0?Infinity:100/v;
  if(u==="mpg (US)") return v===0?Infinity:235.215/v;
  if(u==="mpg (UK)") return v===0?Infinity:282.481/v;
  return v;
}
function fromBaseL100km(b,u){
  if(u==="L/100km") return b;
  if(u==="km/L") return b===0?Infinity:100/b;
  if(u==="mpg (US)") return b===0?Infinity:235.215/b;
  if(u==="mpg (UK)") return b===0?Infinity:282.481/b;
  return b;
}
function getConvertedValue(inputVal,fromUnit,toUnit){
  const cat=CATEGORIES[currentCat];
  if(cat.special==="temp") return fromBaseCelsius(toBaseCelsius(inputVal,fromUnit),toUnit);
  if(cat.special==="fuel") return fromBaseL100km(toBaseL100km(inputVal,fromUnit),toUnit);
  return inputVal*cat.units[fromUnit]/cat.units[toUnit];
}
function convert(dir){
  if(currentCat==="Concentration") return;
  const v1El=document.getElementById('val1'),v2El=document.getElementById('val2');
  const u1=document.getElementById('unit1').value,u2=document.getElementById('unit2').value;
  const rawFrom=dir===1?v1El.value:v2El.value;
  const inputVal=parseFloat(rawFrom);
  if(rawFrom===""||rawFrom==="-"){
    if(dir===1) v2El.value=""; else v1El.value="";
    updateFormula(u1,u2); updateRefTable(); refreshSEOContent(currentCat,u1,u2); return;
  }
  if(isNaN(inputVal)){if(dir===1) v2El.value="Error"; else v1El.value="Error"; return;}
  const result=getConvertedValue(inputVal,dir===1?u1:u2,dir===1?u2:u1);
  const formatted=formatNumber(result);
  if(dir===1) v2El.value=formatted; else v1El.value=formatted;
  updateFormula(u1,u2); updateRefTable(); refreshSEOContent(currentCat,u1,u2);
}
function formatNumber(num){
  if(!isFinite(num)) return "∞";
  if(num===0) return "0";
  const abs=Math.abs(num);
  if(abs>=0.0001&&abs<1e10) return parseFloat(num.toPrecision(8)).toString();
  return num.toExponential(6);
}
function swapUnits(){
  const u1=document.getElementById('unit1'),u2=document.getElementById('unit2');
  const v1=document.getElementById('val1'),v2=document.getElementById('val2');
  [u1.value,u2.value]=[u2.value,u1.value];[v1.value,v2.value]=[v2.value,v1.value];
  convert(1);
}
function updateFormula(u1,u2){
  const cat=CATEGORIES[currentCat];
  let text="—";
  if(cat.special==="temp"){
    const f={"°C → °F":"°F = °C × 9/5 + 32","°F → °C":"°C = (°F − 32) × 5/9","°C → K":"K = °C + 273.15","K → °C":"°C = K − 273.15","°C → °R":"°R = (°C + 273.15) × 9/5","°F → K":"K = (°F − 32) × 5/9 + 273.15"};
    text=f[`${u1.slice(0,2)} → ${u2.slice(0,2)}`]||`${u1} → ${u2}`;
  } else if(cat.special==="fuel"){
    text="Inverse relationship: L/100km ↔ efficiency";
  } else {
    const f1=cat.units[u1],f2=cat.units[u2];
    if(f1&&f2) text=`1 ${u1} = ${formatNumber(f1/f2)} ${u2}`;
  }
  document.getElementById('formulaText').textContent=text;
}
function updateRefTable(){
  const tbody=document.getElementById('refTableBody');
  tbody.innerHTML="";
  const cat=CATEGORIES[currentCat];
  const u1=document.getElementById('unit1').value;
  const rawVal=parseFloat(document.getElementById('val1').value)||1;
  const units=cat.special==="temp"?cat.units:Object.keys(cat.units);
  units.slice(0,8).forEach(u=>{
    if(u===document.getElementById('unit2').value) return;
    const converted=getConvertedValue(rawVal,u1,u);
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${u}</td><td>${formatNumber(converted)}</td><td>${u}</td>`;
    tr.setAttribute('aria-label',`${rawVal} ${shortUnit(u1)} = ${formatNumber(converted)} ${shortUnit(u)}`);
    tr.onclick=()=>{document.getElementById('unit2').value=u;convert(1);};
    tbody.appendChild(tr);
  });
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function copyVal(n){
  const val=document.getElementById('val'+n).value;if(!val) return;
  navigator.clipboard.writeText(val).then(()=>showToast("Copied!")).catch(()=>{
    const el=document.getElementById('val'+n);el.select();document.execCommand('copy');showToast("Copied!");
  });
}
function showToast(msg){
  const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),1800);
}
function toggleSidebar(){
  sidebarOpen=!sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open',sidebarOpen);
  const arrow=document.getElementById('mobileCatArrow'),tog=document.getElementById('mobileCatToggle');
  if(arrow) arrow.textContent=sidebarOpen?'▲':'▼';
  if(tog) tog.setAttribute('aria-expanded',String(sidebarOpen));
}

// ─── UNIT DEFINITIONS DATABASE ────────────────────────────────────────────────
const UNIT_DEFS = {
  "Pressure": [
    {sym:"bar",name:"Bar",std:"IUPAC / ISO 80000-4",def:"A metric unit of pressure defined as exactly 100,000 Pascals (100 kPa). Widely used in meteorology, industrial processes, and hydraulics.",formula:"1 bar = 10⁵ Pa = 100 kPa",equiv:["1 bar","= 100 kPa","= 0.986923 atm","= 14.5038 PSI","= 10.197 mH₂O","= 750.06 mmHg"]},
    {sym:"PSI",name:"Pounds-force per Square Inch",std:"NIST / ASTM E380",def:"The primary pressure unit in US customary and Imperial systems. Defined as 1 lbf/in². Used in tyre pressure, plumbing, boilers, and hydraulics.",formula:"1 PSI = 1 lbf/in² = 6 894.757 Pa",equiv:["1 PSI","= 6.89476 kPa","= 0.068948 bar","= 0.06805 atm","= 51.715 mmHg","= 703.07 mmH₂O"]},
    {sym:"kPa",name:"Kilopascal",std:"SI — BIPM / ISO 80000-4",def:"A derived SI unit equal to 1,000 Pascals. The practical engineering scale for moderate pressures such as atmospheric and HVAC duct.",formula:"1 kPa = 1 000 Pa = 1 000 N/m²",equiv:["1 kPa","= 0.01 bar","= 0.14504 PSI","= 0.10197 mH₂O","= 7.5006 mmHg"]},
    {sym:"MPa",name:"Megapascal",std:"SI — BIPM / ISO 80000-4",def:"Equal to 1,000,000 Pascals. Standard unit for structural stress, material strength, and high-pressure industrial processes. Numerically equivalent to N/mm².",formula:"1 MPa = 10⁶ Pa = 1 N/mm²",equiv:["1 MPa","= 10 bar","= 145.038 PSI","= 10.197 kg/cm²","= 9.8692 atm"]},
    {sym:"Pa",name:"Pascal",std:"SI base derived unit — BIPM (1971)",def:"The SI coherent unit of pressure and mechanical stress. Equals one Newton per square metre. Named after Blaise Pascal (1623–1662).",formula:"1 Pa = 1 N/m² = 1 kg/(m·s²)",equiv:["1 Pa","= 0.001 kPa","= 10 µbar","= 1.450×10⁻⁴ PSI","= 0.10197 mmH₂O"]},
    {sym:"atm",name:"Standard Atmosphere",std:"BIPM / IUPAC (1982)",def:"Defined as exactly 101,325 Pa. Originally based on average atmospheric pressure at sea level at 45° latitude and 0°C.",formula:"1 atm = 101 325 Pa exactly",equiv:["1 atm","= 101.325 kPa","= 1.01325 bar","= 14.696 PSI","= 760 mmHg","= 10.332 mH₂O"]},
    {sym:"mH₂O",name:"Metre of Water Column",std:"ISO 80000-4 / EN 1434",def:"Hydrostatic pressure exerted by a column of water 1 metre high at standard gravity and 4°C. Widely used in HVAC, low-pressure gas, and differential pressure transmitters.",formula:"1 mH₂O = ρ·g·h = 9 806.65 Pa",equiv:["1 mH₂O","= 9806.65 Pa","= 0.0980665 bar","= 1.4223 PSI","= 73.556 mmHg"]},
    {sym:"mmHg",name:"Millimetre of Mercury (Torr)",std:"ISO 80000-4 / IUPAC",def:"Pressure exerted by 1 mm of mercury at 0°C under standard gravity. The Torr equals exactly 1/760 standard atmosphere. Used in blood pressure and vacuum engineering.",formula:"1 mmHg = 133.322 Pa ≈ 1 Torr",equiv:["1 mmHg","= 133.322 Pa","= 0.001333 bar","= 0.01934 PSI","= 13.595 mmH₂O"]},
  ],
  "Velocity": [
    {sym:"m/s",name:"Metre per Second",std:"SI — BIPM / ISO 80000-3",def:"The SI coherent unit of speed and velocity. Standard for wind speed in meteorology and flow velocity in hydraulics.",formula:"1 m/s = 3.6 km/h = 3.28084 ft/s",equiv:["1 m/s","= 3.6 km/h","= 1.944 kn","= 2.237 mph","= 3.281 ft/s"]},
    {sym:"kn",name:"Knot",std:"ICAO / IMO",def:"One nautical mile per hour. Standard unit for aircraft airspeed and ship speed. Defined as 1852 m/hr.",formula:"1 kn = 1852 m/hr = 0.514444 m/s",equiv:["1 kn","= 1.852 km/h","= 1.15078 mph","= 0.514444 m/s"]},
    {sym:"Mach",name:"Mach Number",std:"ISO 80000-11 / aeronautics",def:"Dimensionless ratio of flow speed to the local speed of sound. Speed of sound varies with medium and temperature: 340.3 m/s at sea level, 295 m/s at 11 km altitude.",formula:"Ma = v / a  (a = local speed of sound)",equiv:["Mach 1 ≈ 340 m/s (sea level, 15°C)","Mach 1 ≈ 295 m/s (11 km altitude)"]},
  ],
  "Frequency": [
    {sym:"Hz",name:"Hertz",std:"SI — BIPM (1930, confirmed 1960)",def:"The SI unit of frequency. Named after Heinrich Rudolf Hertz (1857–1894). Defined as 1 cycle per second (s⁻¹). Used for sound, electromagnetic waves, and electrical signals.",formula:"1 Hz = 1 cycle/s = 1 s⁻¹",equiv:["1 Hz","= 60 RPM","= 2π rad/s","= 1 cycle/s"]},
    {sym:"RPM",name:"Revolutions per Minute",std:"SAE / ISO 1219-2",def:"A non-SI unit of rotational frequency used for engine speed and motor speed ratings.",formula:"1 RPM = 1/60 Hz = 0.10472 rad/s",equiv:["1 RPM","= 0.01667 Hz","= 0.10472 rad/s","1 Hz = 60 RPM"]},
  ],
  "Angle": [
    {sym:"°",name:"Degree",std:"ISO 80000-3",def:"The most common angle unit. A full circle is divided into 360 degrees. Used universally in navigation, geometry, and engineering.",formula:"1° = π/180 rad ≈ 0.017453 rad",equiv:["360° = 2π rad","90° = π/2 rad","1° = 60 arcmin = 3600 arcsec"]},
    {sym:"rad",name:"Radian",std:"SI coherent derived unit — BIPM",def:"The SI coherent unit of plane angle. One radian is the angle subtended by an arc equal in length to the radius. Used in all mathematical and physical formulae.",formula:"1 rad = 180/π degrees ≈ 57.2958°",equiv:["2π rad = 360°","1 rad ≈ 57.296°","π rad = 180°"]},
    {sym:"grad",name:"Gradian (Gon)",std:"ISO 80000-3 / surveying",def:"A unit where the right angle is divided into 100 parts, giving 400 gradians per full circle. Used in surveying and civil engineering in continental Europe.",formula:"1 grad = 0.9° = π/200 rad",equiv:["400 grad = 360°","100 grad = 90°","1 grad = 0.9°"]},
  ],
};

function buildDefs(catName, filter='') {
  const allDefs = [...(UNIT_DEFS[catName] || [])];
  const filtered = filter
    ? allDefs.filter(d =>
        d.name.toLowerCase().includes(filter.toLowerCase()) ||
        d.sym.toLowerCase().includes(filter.toLowerCase()) ||
        d.def.toLowerCase().includes(filter.toLowerCase()))
    : allDefs;
  if (filtered.length === 0) {
    return `<div class="defs-none">${filter ? `No unit definitions match "<strong>${filter}</strong>"` : `Detailed definitions for <strong>${catName}</strong> units are coming soon.`}</div>`;
  }
  return filtered.map((d, i) => `
    <div class="def-card" id="defcard-${i}">
      <div class="def-header" onclick="toggleDef(${i})" role="button" aria-expanded="false" aria-controls="defbody-${i}">
        <span class="def-symbol">${d.sym}</span>
        <span class="def-name">${d.name}</span>
        <span class="def-std">${d.std}</span>
        <span class="def-arrow" aria-hidden="true">▼</span>
      </div>
      <div class="def-body" id="defbody-${i}">
        <p>${d.def}</p>
        ${d.formula ? `<code class="def-formula">${d.formula}</code>` : ''}
        ${d.equiv && d.equiv.length ? `<div class="def-equiv">${d.equiv.map(e=>`<span><strong>${e.split('=')[0]}</strong>${e.includes('=')?'= '+e.split('=').slice(1).join('='):''}</span>`).join('')}</div>` : ''}
        <p class="def-source">Source / Standard: ${d.std}</p>
      </div>
    </div>`).join('');
}
function toggleDef(i) {
  const card = document.getElementById('defcard-' + i);
  if (!card) return;
  const isOpen = card.classList.contains('open');
  card.classList.toggle('open', !isOpen);
  const hdr = card.querySelector('.def-header');
  if (hdr) hdr.setAttribute('aria-expanded', String(!isOpen));
}
function renderDefsPanel(catName) {
  const wrap = document.getElementById('defsContent');
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="defs-search-wrap">
      <span class="defs-search-icon" aria-hidden="true">&#128269;</span>
      <input type="text" class="defs-search" id="defsSearch"
        placeholder="Search definitions…" autocomplete="off"
        aria-label="Search unit definitions"
        oninput="document.getElementById('defsList').innerHTML=buildDefs('${catName}',this.value)">
    </div>
    <div id="defsList">${buildDefs(catName)}</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRAND PROTECTION — multicalci.com
// MutationObserver only — no setInterval CPU drain
// ═══════════════════════════════════════════════════════════════════════════════
(function(){
  'use strict';
  const _b1='multi',_b2='calci',_b3='.com';
  const BRAND     = _b1+_b2+_b3;
  const BRAND_URL = 'https://'+BRAND+'/';
  const BRAND_DISP= '\u26A1\u00A0'+BRAND;

  function restoreBrand(){
    const wm=document.getElementById('mc-watermark');
    if(wm){
      if(wm.textContent!==BRAND_DISP) wm.textContent=BRAND_DISP;
      if(wm.style.display==='none'||wm.style.visibility==='hidden'){wm.style.display='';wm.style.visibility='';}
      if(parseFloat(wm.style.opacity)===0) wm.style.opacity='';
    } else {
      const el=document.createElement('div');
      el.id='mc-watermark';el.setAttribute('aria-hidden','true');
      el.textContent=BRAND_DISP;document.body.appendChild(el);
    }
    const ft=document.getElementById('mc-footer');
    if(ft){
      if(ft.style.display==='none'||ft.style.visibility==='hidden'){ft.style.display='';ft.style.visibility='';}
      const ftLink=ft.querySelector('a');
      if(ftLink){if(ftLink.href!==BRAND_URL) ftLink.href=BRAND_URL;if(ftLink.textContent!==BRAND) ftLink.textContent=BRAND;}
    }
    const logo=document.querySelector('.logo');
    if(logo&&logo.href!==BRAND_URL) logo.href=BRAND_URL;
    const homeBtn=document.querySelector('.home-btn');
    if(homeBtn&&homeBtn.href!==BRAND_URL) homeBtn.href=BRAND_URL;
    if(!document.title.includes(BRAND)){
      document.title=document.title.replace(/\s*—.*$/,'')+' — '+BRAND;
    }
    ['canonicalLink','ogUrl'].forEach(id=>{
      const el=document.getElementById(id);if(!el) return;
      const attr=el.tagName==='LINK'?'href':'content';
      const val=el.getAttribute(attr)||'';
      if(!val.includes(BRAND)) el.setAttribute(attr,BRAND_URL);
    });
  }

  restoreBrand();

  const observer=new MutationObserver(function(mutations){
    let needs=false;
    mutations.forEach(function(m){
      if(m.removedNodes.length){
        m.removedNodes.forEach(function(n){
          if(n.id==='mc-watermark'||n.id==='mc-footer') needs=true;
        });
      }
      if(m.type==='attributes'){
        const t=m.target;
        if(t.id==='mc-watermark'||t.id==='mc-footer'||t.classList.contains('logo')||t.classList.contains('home-btn')) needs=true;
      }
    });
    if(needs) restoreBrand();
  });

  document.addEventListener('DOMContentLoaded',function(){
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','href','class','hidden']});
    restoreBrand();
    init();
  });
})();
