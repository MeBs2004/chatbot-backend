import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ======================================================
// ADMIN USER
// Staff/operator accounts for the Nuformly Control Center.
// Distinct from `User` (backend/models/user.model.js), which
// stores visitor chat messages — do not conflate the two.
// ======================================================

const adminUserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    phone: {
      type: String,
      default: "",
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["SUPER_ADMIN", "COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"],
      required: true,
      default: "VIEWER",
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      default: "ACTIVE",
      index: true,
    },

    lastLogin: {
      type: Date,
      default: null,
    },

    // Phase 18 — session-security fix for the known "logout doesn't
    // revoke the JWT" limitation (Phase 17 report). Embedded in the
    // JWT at sign time; adminAuthMiddleware rejects any token whose
    // embedded version doesn't match the current value here. Bumped
    // on logout and password change/reset — a much smaller change
    // than a revocation-list/refresh-token system, using the exact
    // per-request DB re-fetch adminAuthMiddleware already does for
    // the status check (zero extra queries).
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// ==========================
// Password helpers
// ==========================

adminUserSchema.methods.setPassword = async function (plainPassword) {
  const salt = await bcrypt.genSalt(10);
  this.passwordHash = await bcrypt.hash(plainPassword, salt);
};

adminUserSchema.methods.comparePassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// Never leak the hash in API responses / JSON.stringify
adminUserSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export default mongoose.model("AdminUser", adminUserSchema);
