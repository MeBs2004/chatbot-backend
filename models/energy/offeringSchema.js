import mongoose from "mongoose";

// ======================================================
// Shared shape for EnergyProductService and EnergyProjectType — both
// are "things that belong to one fuel category, are either a platform
// default or one company's custom addition, and can be individually
// enabled/disabled." Kept as a factory (not one shared model) so the
// two stay distinct collections per the brief's own separation
// (Section 5 products/services vs Section 6 project types are
// explicitly different concepts), without duplicating the schema body.
// ======================================================

export function buildOfferingSchema() {
  return new mongoose.Schema(
    {
      fuelKey: { type: String, required: true, trim: true, lowercase: true, index: true },
      label: { type: String, required: true, trim: true },
      description: { type: String, default: "", trim: true },
      companyId: { type: String, default: null, trim: true, index: true }, // null = platform default
      active: { type: Boolean, default: true },
    },
    { timestamps: true }
  );
}
