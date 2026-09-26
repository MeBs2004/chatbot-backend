import AIUsage from "../../models/aiUsage.model.js";

// ======================================================
// AI USAGE RECORDING (Phase 13)
// Fire-and-forget, same convention as webhook dispatch — never
// awaited on the visitor-facing AI response path, never throws into
// the caller. Called from groq.service.js after every real provider
// attempt (success or exhausted-all-keys failure).
// ======================================================

export function recordAIUsage({ companyId, chatbotId = null, provider, model, usage, success }) {
  if (!companyId) return;
  AIUsage.create({
    companyId,
    chatbotId,
    provider,
    model,
    promptTokens: usage?.prompt_tokens || 0,
    completionTokens: usage?.completion_tokens || 0,
    totalTokens: usage?.total_tokens || 0,
    success,
  }).catch((err) => console.error("AI usage record failed:", err.message));
}
