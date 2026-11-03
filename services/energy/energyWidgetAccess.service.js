import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import { isWidgetRequestAllowed } from "../../middleware/widgetSession.middleware.js";

// ======================================================
// Shared by every PUBLIC Energy widget controller (enquiries, supplier
// match, the Phase 5 journey endpoints): resolves a chatbot from an
// untrusted, visitor-supplied id, the same way every other
// /api/widget/* endpoint does — 404s identically for missing,
// soft-deleted, wrong-template, or origin/token-disallowed requests,
// so a caller can never distinguish "doesn't exist" from "exists but
// you can't use it." Never trusts a companyId from the request body;
// the company is always derived server-side from this chatbot.
// ======================================================
export async function resolvePublicEnergyChatbot(chatbotId, req) {
  if (!mongoose.Types.ObjectId.isValid(chatbotId)) return null;
  const chatbot = await Chatbot.findById(chatbotId).select("companyId template deletedAt status allowedDomains").lean();
  if (!chatbot || chatbot.deletedAt) return null;
  if (chatbot.template !== "energy") return null;
  if (chatbot.status === "PAUSED" || chatbot.status === "OFFLINE") return null;
  if (!isWidgetRequestAllowed(req, chatbot)) return null;
  return chatbot;
}
