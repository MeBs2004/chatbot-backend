import mongoose from "mongoose";

// ======================================================
// INVITATION (Phase 11)
// No SMTP/email infrastructure exists in this codebase (confirmed
// by audit — see PHASE_11_REPORT), so this model exists to make the
// invitation LIFECYCLE real (pending/accepted/expired/revoked,
// secure one-time token) without ever pretending an email was sent.
// The raw token is never stored — only its SHA-256 hash — mirroring
// how AdminUser never stores a plaintext password.
// ======================================================

const invitationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    name: {
      type: String,
      default: "",
      trim: true,
    },

    role: {
      type: String,
      enum: ["COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"],
      required: true,
    },

    // Which companies (and with what per-company role) the invitee
    // joins on acceptance. Never SUPER_ADMIN — an invitation can
    // never grant platform-level access, matching createUser's own
    // "Company Admin can never create/grant Super Admin" rule.
    companyAccess: {
      type: [
        {
          companyId: { type: String, required: true, trim: true },
          role: {
            type: String,
            enum: ["COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"],
            required: true,
          },
          _id: false,
        },
      ],
      default: [],
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"],
      default: "PENDING",
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    acceptedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Invitation", invitationSchema);
