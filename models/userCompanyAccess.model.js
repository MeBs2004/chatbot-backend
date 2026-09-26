import mongoose from "mongoose";

// ======================================================
// USER COMPANY ACCESS
// Join between AdminUser and Company: which companies an
// admin user can see, with what role/permissions within
// that company. SUPER_ADMIN bypasses this table entirely
// (checked by AdminUser.role, not by rows here).
// ======================================================

const userCompanyAccessSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"],
      required: true,
    },

    permissions: {
      type: [String],
      default: [],
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

userCompanyAccessSchema.index({ userId: 1, companyId: 1 }, { unique: true });

export default mongoose.model("UserCompanyAccess", userCompanyAccessSchema);
