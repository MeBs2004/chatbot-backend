import mongoose from "mongoose";

// ======================================================
// ENERGY — SUPPLIER (Phase 4, Part 2/3). Company-scoped, same
// convention as EnergyEquipment/EnergyQuestion: reusable across any
// Energy chatbot that company runs. The supplier<->equipment
// relationship is a plain array of EnergyEquipment ids on the
// supplier document (many-to-many: one supplier can list many
// equipment ids, and many suppliers can each separately list the same
// equipment id) — no new equipment records are ever created here.
// ======================================================

const documentSchema = new mongoose.Schema(
  {
    label: { type: String, default: "" },
    data: Buffer,
    contentType: String,
    filename: String,
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const supplierSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },

    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },

    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "" },

    // Free-text region tags (e.g. "Maharashtra", "Pune", "Pan India")
    // — an empty list means "no region restriction configured", per
    // Part 3: region is only enforced "where region restrictions apply."
    serviceRegions: { type: [String], default: [] },

    supportedFuelKeys: { type: [String], default: [] },
    supportedProjectTypeIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergyProjectType", default: [] },
    productServiceIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergyProductService", default: [] },
    // The actual supplier<->equipment mapping (Part 3).
    equipmentIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergyEquipment", default: [] },

    documents: { type: [documentSchema], default: [] },

    leadTimeDays: { type: Number, default: null, min: 0 },
    minOrderQty: { type: Number, default: null, min: 0 },

    active: { type: Boolean, default: true },
    verificationStatus: { type: String, enum: ["unverified", "pending", "verified"], default: "unverified" },
    verificationNotes: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true }
);

supplierSchema.index({ companyId: 1, name: 1 });
supplierSchema.index({ companyId: 1, supportedFuelKeys: 1 });
supplierSchema.index({ companyId: 1, equipmentIds: 1 });

// Document binary data is never sent in a normal list/detail response
// — same reasoning as EnergyEquipment's image/datasheet.
supplierSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.documents = (ret.documents || []).map((d) => ({ _id: d._id, label: d.label, filename: d.filename, contentType: d.contentType, uploadedAt: d.uploadedAt }));
    return ret;
  },
});

export default mongoose.model("EnergySupplier", supplierSchema);
