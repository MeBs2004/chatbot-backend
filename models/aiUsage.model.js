import mongoose from "mongoose";

// ======================================================
// AI USAGE (Phase 13)
// One document per real AI provider call — same "one row per event"
// convention as Phase 12's ApiUsage. `requestCount` isn't a stored
// field (it's always 1 per document); aggregation queries count
// documents for request totals and $sum the token fields. Token
// counts come directly from the provider's own response
// (`completion.usage` — see services/groq.service.js) — never
// estimated. No prompt/response text is stored here, only counts.
// TTL slightly longer than Phase 12's ApiUsage (30 days) since
// billing needs to look back across a full monthly period plus a
// grace window even if a company's period start drifts.
// ======================================================

const aiUsageSchema = new mongoose.Schema({
  companyId: { type: String, required: true, index: true },
  chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", default: null },
  provider: { type: String, required: true },
  model: { type: String, required: true },
  promptTokens: { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  totalTokens: { type: Number, default: 0 },
  success: { type: Boolean, required: true },
  createdAt: { type: Date, default: Date.now },
});

aiUsageSchema.index({ companyId: 1, createdAt: -1 });
aiUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default mongoose.model("AIUsage", aiUsageSchema);
