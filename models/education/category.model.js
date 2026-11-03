import mongoose from "mongoose";

// ======================================================
// EDUCATION — FAQ CATEGORIES (Admissions, Fees, Facility & Hostel,
// Placements, Scholarships, Courses & Programs, General). Same two-kind-
// of-row pattern as Energy's EnergyFuelCategory:
//   - Platform defaults: companyId = null, managed by SUPER_ADMIN,
//     visible to every company.
//   - Company-custom: companyId set, created by that company's own
//     admins, visible only to that company.
// ======================================================

const categorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    icon: { type: String, default: "FiHelpCircle" }, // react-icons/fi name, resolved client-side
    description: { type: String, default: "", trim: true },

    companyId: { type: String, default: null, trim: true, index: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

categorySchema.index({ companyId: 1, key: 1 }, { unique: true });

export default mongoose.model("EducationCategory", categorySchema);
