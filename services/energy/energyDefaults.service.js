import EnergyFuelCategory from "../../models/energy/fuelCategory.model.js";
import EnergyProductService from "../../models/energy/productService.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";

// ======================================================
// PLATFORM DEFAULTS — Super Admin-managed starting options (Section 4,
// Section 18: "Super Admin should be able to add another energy
// category... without rewriting the entire chatbot system"). These
// are seeded once via ensureEnergyDefaults() and from then on live in
// the database like any other row — editable/retirable by a Super
// Admin through the normal CRUD API, never hardcoded into the engine
// itself. A company's own selections (Phase 1's ChatbotEnergyConfig)
// are a separate, per-tenant layer on top of this shared catalog.
// ======================================================

export const FUEL_DEFAULTS = [
  { key: "cng", label: "CNG – Compressed Natural Gas", group: "gas_fuel", icon: "FiTruck" },
  { key: "cbg", label: "CBG – Compressed Biogas", group: "gas_fuel", icon: "FiWind" },
  { key: "lpg", label: "LPG – Liquefied Petroleum Gas", group: "gas_fuel", icon: "FiDroplet" },
  { key: "lng", label: "LNG – Liquefied Natural Gas", group: "gas_fuel", icon: "FiThermometer" },
  { key: "png", label: "PNG – Piped Natural Gas", group: "gas_fuel", icon: "FiShare2" },
  { key: "biogas", label: "Biogas", group: "gas_fuel", icon: "FiFeather" },
  { key: "hydrogen", label: "Hydrogen", group: "gas_fuel", icon: "FiZap" },
  { key: "solar", label: "Solar Energy", group: "renewable", icon: "FiSun" },
  { key: "wind", label: "Wind Energy", group: "renewable", icon: "FiWind" },
  { key: "electricity", label: "Electricity / Power Solutions", group: "power_storage", icon: "FiZap" },
  { key: "energy_storage", label: "Energy Storage / Battery Systems", group: "power_storage", icon: "FiBatteryCharging" },
  { key: "other", label: "Other Energy Solutions", group: "other", icon: "FiMoreHorizontal" },
];

export const PRODUCT_SERVICE_DEFAULTS = {
  cng: ["CNG Station Setup", "Mother Station", "Online Station", "Daughter Station", "Daughter Booster Station", "CNG Compressors", "Booster Compressors", "CNG Dispensers", "Cascade Systems", "Priority Panels", "Equipment Supply", "Engineering and Installation", "Maintenance Services", "Turnkey Projects"],
  cbg: ["Biogas Plant Setup", "Biogas Purification", "Biogas Upgrading", "CBG Compression", "CBG Bottling", "CBG Storage", "CBG Equipment Supply", "Plant Engineering and Installation"],
  lpg: ["LPG Storage Tanks", "LPG Bottling Plants", "LPG Filling Systems", "LPG Vaporizers", "LPG Distribution Systems", "LPG Equipment Supply"],
  lng: ["LNG Storage Systems", "LNG Regasification", "LNG Transfer Equipment", "LNG Distribution", "LNG Fueling Infrastructure"],
  hydrogen: ["Hydrogen Production Systems", "Electrolysers", "Hydrogen Compression", "Hydrogen Storage", "Hydrogen Dispensing", "Hydrogen Infrastructure"],
  solar: ["Residential Solar", "Commercial Solar", "Industrial Solar", "Rooftop Solar", "Solar Power Plants", "Solar Panels", "Inverters", "Solar + Battery Systems", "Solar EPC and Installation"],
  wind: ["Wind Turbines", "Onshore Wind Projects", "Offshore Wind Projects", "Wind Farms", "Turbine Components", "Installation and Maintenance"],
  energy_storage: ["Battery Energy Storage Systems (BESS)", "Industrial Battery Systems", "Commercial Battery Systems", "Grid-Scale Storage", "Battery Modules", "Battery Management Systems", "Power Conversion Systems"],
};

export const PROJECT_TYPE_DEFAULTS = {
  cng: ["Mother Station", "Online Station", "Daughter Station", "Daughter Booster Station", "CNG Infrastructure Development"],
  cbg: ["Biogas Plant", "Biogas Purification", "Biogas Upgrading", "CBG Compression", "CBG Bottling", "CBG Storage"],
  lpg: ["LPG Storage Facility", "LPG Bottling Plant", "LPG Distribution", "LPG Filling Station"],
  lng: ["LNG Storage", "LNG Regasification", "LNG Distribution", "LNG Fueling Infrastructure"],
  hydrogen: ["Hydrogen Production", "Electrolyser Systems", "Hydrogen Compression", "Hydrogen Storage", "Hydrogen Dispensing"],
  solar: ["Residential Solar", "Commercial Solar", "Industrial Solar", "Solar Power Plant", "Solar + Battery Storage"],
  wind: ["Onshore Wind", "Offshore Wind", "Wind Farm", "Wind Turbine Systems"],
  energy_storage: ["Battery Energy Storage System", "Industrial Storage", "Commercial Storage", "Grid-Scale Storage"],
};

/**
 * Idempotent — safe to run on every deploy, not just once. Upserts
 * platform defaults (companyId: null) without touching anything a
 * Super Admin has since edited (upsert only sets fields on insert for
 * ones that already exist, via setOnInsert — see below), and never
 * touches company-custom rows.
 */
export async function ensureEnergyDefaults() {
  let fuelsCreated = 0;
  let offeringsCreated = 0;

  for (const fuel of FUEL_DEFAULTS) {
    const res = await EnergyFuelCategory.updateOne(
      { companyId: null, key: fuel.key },
      { $setOnInsert: { ...fuel, companyId: null, active: true } },
      { upsert: true }
    );
    if (res.upsertedCount) fuelsCreated += 1;
  }

  for (const [fuelKey, labels] of Object.entries(PRODUCT_SERVICE_DEFAULTS)) {
    for (const label of labels) {
      const res = await EnergyProductService.updateOne(
        { companyId: null, fuelKey, label },
        { $setOnInsert: { fuelKey, label, companyId: null, active: true } },
        { upsert: true }
      );
      if (res.upsertedCount) offeringsCreated += 1;
    }
  }

  for (const [fuelKey, labels] of Object.entries(PROJECT_TYPE_DEFAULTS)) {
    for (const label of labels) {
      const res = await EnergyProjectType.updateOne(
        { companyId: null, fuelKey, label },
        { $setOnInsert: { fuelKey, label, companyId: null, active: true } },
        { upsert: true }
      );
      if (res.upsertedCount) offeringsCreated += 1;
    }
  }

  return { fuelsCreated, offeringsCreated };
}
