import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import { isWidgetRequestAllowed } from "../../middleware/widgetSession.middleware.js";

// ======================================================
// Shared by every PUBLIC Education widget controller — same contract
// as energyWidgetAccess.service.js's resolvePublicEnergyChatbot: 404s
// identically for missing, soft-deleted, wrong-template, or
// origin/token-disallowed requests. Never trusts a companyId from the
// request; the company is always derived server-side from this chatbot.
// ======================================================
export async function resolvePublicEducationChatbot(chatbotId, req) {
  if (!mongoose.Types.ObjectId.isValid(chatbotId)) return null;
  const chatbot = await Chatbot.findById(chatbotId).select("companyId template deletedAt status allowedDomains").lean();
  if (!chatbot || chatbot.deletedAt) return null;
  if (chatbot.template !== "education") return null;
  if (chatbot.status === "PAUSED" || chatbot.status === "OFFLINE") return null;
  if (!isWidgetRequestAllowed(req, chatbot)) return null;
  return chatbot;
}
