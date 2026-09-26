import mongoose from "mongoose";

// ======================================================
// API KEY (Phase 12)
// The raw secret is NEVER stored — only `secretHash` (SHA-256 over
// the full token string). `keyPrefix` is a short, non-secret,
// indexed lookup value (first 16 chars of the token, e.g.
// "nf_live_a1b2c3d4") so authentication doesn't need to hash every
// ACTIVE key on every request. Revoked/rotated keys are kept (never
// deleted) for audit/history — see Section 11.
// ======================================================

export const API_SCOPES = [
  "company:read",
  "chatbots:read",
  "conversations:read",
  "conversations:write",
  "visitors:read",
  "analytics:read",
  "knowledge:read",
  "webhooks:read",
  "webhooks:write",
];

const apiKeySchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true },

    name: { type: String, required: true, trim: true, maxlength: 100 },

    keyPrefix: { type: String, required: true, unique: true, index: true },
    secretHash: { type: String, required: true },

    scopes: {
      type: [{ type: String, enum: API_SCOPES }],
      default: [],
      validate: {
        validator: (arr) => arr.length > 0,
        message: "At least one scope is required.",
      },
    },

    // Empty array = whole company (every chatbot the company owns,
    // now and in the future). Non-empty = restricted to exactly
    // these chatbots — enforced in apiKeyAuth.middleware.js, never
    // trusted from the request.
    chatbotIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chatbot" }],
      default: [],
    },

    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
    },

    lastUsedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
    rotatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

apiKeySchema.index({ companyId: 1, status: 1 });
apiKeySchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.model("ApiKey", apiKeySchema);
