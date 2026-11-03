import mongoose from "mongoose";

// ======================================================
// EDUCATION — COURSES / PROGRAMS catalog. The Education equivalent of
// Energy's EquipmentCatalog: the concrete things this company actually
// offers, surfaced to visitors and referenced by leads ("courseInterest").
// ======================================================

const courseSchema = new mongoose.Schema(
  {
    companyId: { type: String, default: null, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    categoryKey: { type: String, default: "", trim: true, lowercase: true },
    duration: { type: String, default: "", trim: true }, // e.g. "4 years", "6 months"
    feeRange: { type: String, default: "", trim: true }, // e.g. "₹1.2L - ₹1.8L / year"
    eligibility: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

courseSchema.index({ companyId: 1, name: 1 });

export default mongoose.model("EducationCourse", courseSchema);
