import mongoose from "mongoose";

// ======================================================
// ROLE (custom, company-scoped)
// The 5 system roles (SUPER_ADMIN/COMPANY_ADMIN/AGENT/VIEWER/
// DEVELOPER) remain fixed code constants in permissions.service.js —
// they are NEVER rows in this collection. A Role document only
// exists for a custom role (e.g. "SEO Manager") created by a
// COMPANY_ADMIN/SUPER_ADMIN for exactly one company.
// UserCompanyAccess.role then stores either one of the 4 system
// company-scoped role keys, OR this Role's _id as a string — see
// services/admin/role.service.js's isSystemRole()/resolveRolePermissions().
// ======================================================

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    permissions: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ["ACTIVE", "ARCHIVED"],
      default: "ACTIVE",
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
  },
  { timestamps: true }
);

// A company can't have two custom roles with the same name.
roleSchema.index({ companyId: 1, name: 1 }, { unique: true });

export default mongoose.model("Role", roleSchema);
