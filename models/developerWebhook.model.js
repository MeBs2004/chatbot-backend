import mongoose from "mongoose";

// ======================================================
// DEVELOPER WEBHOOK (Phase 12)
// Distinct from Company.webhook (Phase 10, one URL per company, the
// "business integration" webhook, unchanged) — this is a real
// subscription system: a company can register MANY developer-facing
// webhooks, each picking specific events and an optional chatbot
// scope. Delivery reuses the same SSRF-hardened, HMAC-signed path
// (see services/developerWebhookDispatch.service.js).
// ======================================================

// Only events this codebase can actually emit reliably — the exact
// same vocabulary as Phase 10's dispatchWebhookEvent (Company.
// webhook), reused rather than inventing a second, near-duplicate
// event taxonomy. See the dispatch call sites added in
// chatbot.message.js and conversation.controller.js.
export const WEBHOOK_EVENTS = [
  "conversation.created",
  "conversation.message",
  "conversation.handoff",
  "conversation.closed",
];

const developerWebhookSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    url: { type: String, required: true, trim: true },

    // AES-256-GCM via utils/encryption.js — reversible, because HMAC
    // signing at delivery time needs the raw secret (unlike ApiKey's
    // secretHash, which only ever needs comparison). Same pattern
    // Phase 10 already uses for Company.webhook.secretEncrypted.
    secretEncrypted: { type: String, default: null },

    events: {
      type: [{ type: String, enum: WEBHOOK_EVENTS }],
      default: [],
      validate: {
        validator: (arr) => arr.length > 0,
        message: "At least one event is required.",
      },
    },

    // Empty = whole company. Non-empty = only events concerning
    // these chatbots are delivered.
    chatbotIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chatbot" }],
      default: [],
    },

    status: {
      type: String,
      enum: ["ACTIVE", "DISABLED"],
      default: "ACTIVE",
      index: true,
    },

    // Consecutive failures since the last success — resets to 0 on
    // any success. Used for at-a-glance health, not analytics.
    failureCount: { type: Number, default: 0 },
    // Cumulative, never reset — what the Usage page's "Webhook
    // Deliveries / Webhook Failures" cards (Section 29) sum across a
    // company's webhooks.
    totalDeliveries: { type: Number, default: 0 },
    totalFailures: { type: Number, default: 0 },
    lastDeliveryAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    lastStatusCode: { type: Number, default: null },
    lastError: { type: String, default: null },
  },
  { timestamps: true }
);

developerWebhookSchema.index({ companyId: 1, status: 1 });

export default mongoose.model("DeveloperWebhook", developerWebhookSchema);
