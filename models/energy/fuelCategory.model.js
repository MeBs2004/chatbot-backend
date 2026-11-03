import mongoose from "mongoose";

// ======================================================
// ENERGY — FUEL / ENERGY-SOLUTION CATEGORIES.
// Two kinds of row, same collection:
//   - Platform defaults: companyId = null, managed only by SUPER_ADMIN
//     (CNG, CBG, LPG, LNG, Solar, Wind, …). Visible to every company.
//   - Company-custom: companyId set, created by that company's own
//     admins ("Other Energy Solutions" -> name your own). Visible only
//     to that company, never to any other tenant.
// This is the ONLY place that knows what fuels/solutions exist — the
// Energy Configuration wizard step and the published widget both ask
// this collection, never a hardcoded list (see Section 18 of the
// brief: one configuration-driven engine, not one engine per fuel).
// ======================================================

const fuelCategorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true }, // slug, e.g. "cng", "solar", or a generated slug for a custom one
    label: { type: String, required: true, trim: true }, // e.g. "CNG – Compressed Natural Gas"
    group: {
      type: String,
      enum: ["gas_fuel", "renewable", "power_storage", "other"],
      default: "other",
    },
    description: { type: String, default: "", trim: true },
    icon: { type: String, default: "FiZap" }, // react-icons/fi name, resolved client-side

    // null = platform default (every company sees it); set = one
    // company's own custom fuel/solution (nobody else sees it).
    companyId: { type: String, default: null, trim: true, index: true },

    active: { type: Boolean, default: true }, // SUPER_ADMIN can retire a default without deleting it (companies already using it keep working)
  },
  { timestamps: true }
);

// A platform default's key is globally unique; a company's custom key
// only needs to be unique within that company (two companies can both
// invent a fuel called "biomass").
fuelCategorySchema.index({ companyId: 1, key: 1 }, { unique: true });

export default mongoose.model("EnergyFuelCategory", fuelCategorySchema);
