import mongoose from "mongoose";

// ======================================================
// ENERGY — EQUIPMENT CATALOGUE (Phase 2, Part B). A company's own
// real products/equipment, company-scoped (not chatbot-scoped) so one
// catalogue is reusable across every Energy chatbot that company
// runs — same reasoning as EnergyProductService/EnergyProjectType.
//
// Different fuels need different technical attributes (a CNG
// compressor's pressure vs. a solar panel's wattage), so beyond the
// handful of universal fields, specs are a flexible key/value bag
// (`specs`) rather than one rigid schema trying to cover every fuel —
// per the brief: "Use flexible attributes instead of forcing every
// equipment category into the same fixed fields."
//
// Images/datasheets are stored as Buffers on the document, same
// deliberate choice as the (now-removed) Energy quote PDFs: this
// codebase has no object-storage integration yet, and these files are
// small enough that standing up new infra for Phase 2 isn't worth it.
// ======================================================

const equipmentSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },

    name: { type: String, required: true, trim: true },
    fuelKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    category: { type: String, required: true, trim: true }, // free text, company-defined — e.g. "compressor", "panel", "inverter"
    supportedProjectTypeIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergyProjectType", default: [] },

    manufacturer: { type: String, default: "", trim: true },
    modelNumber: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },

    // Universal, explicit (every equipment item has SOME capacity):
    capacityValue: { type: Number, default: null },
    capacityUnit: { type: String, default: "" }, // e.g. "kg/day", "kW", "bar", "%"

    // Fuel-specific technical attributes, free-form:
    // e.g. CNG: { pressureBar: 250 }, Solar: { wattageW: 550, efficiencyPct: 21.3 }
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },

    image: { data: Buffer, contentType: String, filename: String },
    datasheet: { data: Buffer, contentType: String, filename: String },

    price: { type: Number, default: null, min: 0 },
    currency: { type: String, default: "INR" },
    availability: { type: String, enum: ["in_stock", "made_to_order", "unavailable"], default: "in_stock" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

equipmentSchema.index({ companyId: 1, fuelKey: 1, category: 1 });
// Soft duplicate signal, not a hard constraint — a manufacturer+model
// really can repeat across categories (e.g. a bundle vs. a part), so
// this is enforced as a warning in the controller, not a unique index.
equipmentSchema.index({ companyId: 1, manufacturer: 1, modelNumber: 1 });

// Never send image/datasheet binary data in a normal API response —
// those are fetched through their own dedicated routes.
equipmentSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.hasImage = Boolean(ret.image?.data);
    ret.hasDatasheet = Boolean(ret.datasheet?.data);
    delete ret.image;
    delete ret.datasheet;
    return ret;
  },
});

export default mongoose.model("EnergyEquipment", equipmentSchema);
