import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import { isWidgetRequestAllowed } from "../../middleware/widgetSession.middleware.js";

// ======================================================
// Shared by every PUBLIC Digital Marketing widget controller — same
// contract as resolvePublicEducationChatbot/resolvePublicEnergyChatbot.
// ======================================================
export async function resolvePublicMarketingChatbot(chatbotId, req) {
  if (!mongoose.Types.ObjectId.isValid(chatbotId)) return null;
  const chatbot = await Chatbot.findById(chatbotId).select("companyId template deletedAt status allowedDomains").lean();
  if (!chatbot || chatbot.deletedAt) return null;
  if (chatbot.template !== "digital_marketing") return null;
  if (chatbot.status === "PAUSED" || chatbot.status === "OFFLINE") return null;
  if (!isWidgetRequestAllowed(req, chatbot)) return null;
  return chatbot;
}
