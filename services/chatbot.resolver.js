import Chatbot from "../models/chatbot.model.js";

/**
 * The "exactly one Chatbot record for this company" heuristic used
 * across Phase 5 (GET /bot/v1/company), Phase 6 (flow.resolver.js)
 * and now Phase 8 (conversation.service.js) — an ambiguous (0 or 2+)
 * case deliberately resolves to `null` rather than guessing, so
 * every caller falls back to its own company-only behavior instead
 * of silently picking the wrong bot. Extracted here so it's defined
 * in exactly one place instead of being re-copied per phase.
 */
export async function resolveSingleChatbotId(companyId) {
  const chatbots = await Chatbot.find({ companyId, deletedAt: null }).select("_id").lean();
  if (chatbots.length !== 1) return null;
  return chatbots[0]._id;
}
