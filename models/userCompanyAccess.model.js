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

    // Either one of the 4 system company-scoped role keys
    // (COMPANY_ADMIN/AGENT/VIEWER/DEVELOPER) or a custom Role's _id
    // (as a string) — see services/admin/role.service.js. No longer a
    // hard enum: a DB-backed custom role is validated at write time
    // (isValidRoleForCompany), not by the schema.
    role: {
      type: String,
      required: true,
    },

    // Dead field, kept only for backward compatibility with any
    // existing documents — never read by can()/getPermissionsForRole.
    // Superseded by permissionOverrides below, which IS wired into
    // permission resolution.
    permissions: {
      type: [String],
      default: [],
    },

    // Per-user, per-company additions/removals layered on top of
    // whatever the role (system or custom) already grants. `granted:
    // true` adds a permission the role doesn't have; `granted: false`
    // revokes one the role does have. See permissions.service.js's
    // applyPermissionOverrides/resolveEffectivePermissions.
    permissionOverrides: {
      type: [
        {
          permission: { type: String, required: true },
          granted: { type: Boolean, required: true },
          _id: false,
        },
      ],
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
