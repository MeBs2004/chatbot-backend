import mongoose from "mongoose";

// ======================================================
// CHANNEL CONNECTION (Phase 10)
// One document per (chatbot, provider) — chatbot-scoped, since a
// company may have multiple chatbots and each may connect to
// different channels independently (Section 27). Company-scoped
// integrations (today: just Webhook) keep living on Company.webhook
// — that feature already existed and works; this model is for the
// genuinely NEW providers this phase adds (Website formalization,
// Telegram), not a forced migration of something that already works.
// ======================================================

const channelConnectionSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, index: true },

    provider: {
      type: String,
      enum: ["website", "telegram", "whatsapp", "instagram", "messenger"],
      required: true,
    },

    // Only states the implementation genuinely supports (Section 12)
    // — CONNECTING exists in the enum for a provider whose connect()
    // is a multi-step async flow (Telegram's setWebhook call), but is
    // never left in that state: connect() always resolves it to
    // CONNECTED or ERROR before returning.
    status: {
      type: String,
      enum: ["NOT_CONNECTED", "CONNECTING", "CONNECTED", "ERROR", "DISCONNECTED"],
      default: "NOT_CONNECTED",
      index: true,
    },

    // Non-secret, provider-specific, safe to return to the frontend
    // as-is. Website: { allowedDomains: [String] }. Telegram:
    // { botUsername, botId } (public info from getMe, not secret).
    config: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Encrypted JSON blob (see utils/encryption.js) — e.g. Telegram's
    // { botToken, webhookSecretToken }. Never decrypted anywhere
    // except inside the owning provider module, server-side only.
    credentialsEncrypted: { type: String, default: null },

    lastConnectedAt: { type: Date, default: null },
    lastTestedAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true }
);

channelConnectionSchema.index({ chatbotId: 1, provider: 1 }, { unique: true });

export default mongoose.model("ChannelConnection", channelConnectionSchema);
