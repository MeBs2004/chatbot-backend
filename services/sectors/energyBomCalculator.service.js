// ======================================================
// ENERGY BOM (BILL OF MATERIALS) CALCULATOR — deterministic solar/
// battery system sizing, built from standard, publicly documented
// off-grid solar sizing formulas (daily load -> panel count -> battery
// bank -> inverter rating). This is NOT a copy of any specific
// vendor's proprietary BOM logic — https://sanmishx.beforelive.in/
// was inspected (network access was available) and had no visible
// BOM/sizing calculator on its page, only a chat widget and a
// product marketplace, so there was nothing vendor-specific to
// replicate. Every number here is computed from the visitor's own
// inputs using named, standard formulas — never invented quantities,
// specifications, or prices (per the spec: "Unknown values must be
// requested, sourced from verified data, or explicitly marked
// unavailable").
//
// These are ESTIMATES ONLY — every response using this module must
// carry an explicit "verify with a certified engineer" warning, and
// the calling code (not the AI) is responsible for that, never the
// LLM.
// ======================================================

// Same deliberate strictness as marketingCalculator.service.js's
// toNumber — null/undefined/""/false must never silently become 0.
function toNumber(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const ENGINEER_WARNING =
  "This is an estimate for planning purposes only. Have a licensed electrical/solar engineer verify system sizing, wiring, and safety margins before procurement or installation.";

export function calculateEnergyBom({
  dailyLoadWh, // total daily energy consumption in watt-hours (required)
  autonomyDays = 1, // days of backup with no sun/charging
  systemVoltageV = 12, // battery bank nominal voltage
  panelWattageW = 330, // wattage of a single solar panel
  peakSunHours = 5, // average full-sun hours/day for the site
  batteryAhCapacity = 100, // Ah rating of a single battery unit
  depthOfDischarge = 0.5, // fraction of battery capacity usable (0-1)
  inverterSafetyFactor = 1.25, // headroom above peak load for inverter sizing
  peakLoadW = null, // instantaneous peak load, for inverter sizing (optional)
}) {
  const errors = [];
  const load = toNumber(dailyLoadWh);
  if (load === null || load <= 0) errors.push("dailyLoadWh must be a positive number.");

  const autonomy = toNumber(autonomyDays);
  if (autonomy === null || autonomy <= 0) errors.push("autonomyDays must be a positive number.");

  const voltage = toNumber(systemVoltageV);
  if (voltage === null || voltage <= 0) errors.push("systemVoltageV must be a positive number.");

  const panelW = toNumber(panelWattageW);
  if (panelW === null || panelW <= 0) errors.push("panelWattageW must be a positive number.");

  const sunHours = toNumber(peakSunHours);
  if (sunHours === null || sunHours <= 0) errors.push("peakSunHours must be a positive number.");

  const batteryAh = toNumber(batteryAhCapacity);
  if (batteryAh === null || batteryAh <= 0) errors.push("batteryAhCapacity must be a positive number.");

  const dod = toNumber(depthOfDischarge);
  if (dod === null || dod <= 0 || dod > 1) errors.push("depthOfDischarge must be a number between 0 (exclusive) and 1.");

  const safetyFactor = toNumber(inverterSafetyFactor);
  if (safetyFactor === null || safetyFactor < 1) errors.push("inverterSafetyFactor must be a number >= 1.");

  const peakLoad = peakLoadW !== null && peakLoadW !== undefined ? toNumber(peakLoadW) : null;
  if (peakLoadW !== null && peakLoadW !== undefined && peakLoad === null) errors.push("peakLoadW must be a number.");

  if (errors.length > 0) {
    return { valid: false, errors, warnings: [ENGINEER_WARNING] };
  }

  // ---- Panel sizing ----
  // Required array wattage = daily load (Wh) / peak sun hours — the
  // standard off-grid sizing formula. A real design would add a
  // system-loss derate (wiring, temperature, inverter efficiency);
  // left out here deliberately rather than inventing a derate figure
  // the visitor didn't supply — flagged as an explicit assumption.
  const requiredArrayWattage = load / sunHours;
  const panelCount = Math.ceil(requiredArrayWattage / panelW);

  // ---- Battery sizing ----
  // Usable Ah needed = (daily load Wh × autonomy days) / system
  // voltage, then divided by depth-of-discharge to get the actual
  // bank capacity required (since only `dod` fraction is usable).
  const requiredUsableAh = (load * autonomy) / voltage;
  const requiredBankAh = requiredUsableAh / dod;
  const batteryCount = Math.ceil(requiredBankAh / batteryAh);

  // ---- Inverter sizing ----
  // If no explicit peak load was given, fall back to treating the
  // average hourly draw (dailyLoadWh / 24h) as the load baseline —
  // clearly marked as an assumption, not a measured peak.
  const effectivePeakLoad = peakLoad !== null ? peakLoad : load / 24;
  const peakLoadIsAssumed = peakLoad === null;
  const inverterRatingVA = Math.ceil(effectivePeakLoad * safetyFactor);

  const assumptions = [
    "No system-loss/derate factor applied to panel sizing — add 10-20% in a real design for wiring and temperature losses.",
    peakLoadIsAssumed
      ? "No peak load was provided — inverter sizing assumes average hourly draw (dailyLoadWh / 24h), which UNDERSTATES a real peak load. Provide peakLoadW for an accurate inverter size."
      : "Inverter sizing uses the peak load you provided.",
  ];

  return {
    valid: true,
    inputs: {
      dailyLoadWh: load,
      autonomyDays: autonomy,
      systemVoltageV: voltage,
      panelWattageW: panelW,
      peakSunHours: sunHours,
      batteryAhCapacity: batteryAh,
      depthOfDischarge: dod,
      inverterSafetyFactor: safetyFactor,
      peakLoadW: peakLoad,
    },
    bom: {
      solarPanels: {
        quantity: panelCount,
        unitWattage: panelW,
        totalArrayWattage: panelCount * panelW,
        formula: "Panel count = ceil((dailyLoadWh / peakSunHours) / panelWattageW)",
      },
      batteryBank: {
        quantity: batteryCount,
        unitAh: batteryAh,
        totalBankAh: batteryCount * batteryAh,
        systemVoltageV: voltage,
        formula: "Battery count = ceil(((dailyLoadWh × autonomyDays) / systemVoltageV) / depthOfDischarge / batteryAhCapacity)",
      },
      inverter: {
        ratingVA: inverterRatingVA,
        formula: "Inverter rating (VA) = ceil(effective peak load × safety factor)",
      },
    },
    assumptions,
    warnings: [ENGINEER_WARNING],
    isEstimate: true,
  };
}
