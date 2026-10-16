import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { mergeChatbotConfig } from "../../config/chatbotConfig.js";
import { isWidgetRequestAllowed, hasExpiredWidgetToken, sendTokenExpired } from "../../middleware/widgetSession.middleware.js";

/**
 * The public-safe payload for one chatbot, shared by
 * GET /api/widget/config/:chatbotId and POST /api/widget/session.
 * Paused/offline chatbots get `available: false` and nothing else
 * (same status enum as chatbot.model.js).
 */
export function buildPublicWidgetPayload(chatbot, company) {
  if (chatbot.status === "PAUSED" || chatbot.status === "OFFLINE") {
    return {
      success: true,
      available: false,
      reason: chatbot.status === "OFFLINE" ? "offline" : "paused",
    };
  }
  return {
    success: true,
    available: true,
    chatbot: {
      id: chatbot._id,
      name: chatbot.name,
      companyName: company?.name || "",
      template: chatbot.template || "general",
    },
    config: mergeChatbotConfig(chatbot.config),
  };
}

/**
 * Public, unauthenticated endpoint — the widget-config counterpart
 * to the existing public /bot/v1/* routes. Deliberately separate
 * from the admin API (no auth) and from /bot/v1/* (no conversation
 * logic here, just configuration).
 *
 * Security: hand-builds the response field-by-field. Never spreads
 * the raw Chatbot/Company document — no companyId, no createdBy, no
 * `settings` (Phase 3's temperature/systemPrompt), no contact info,
 * no knowledgeFile, no webhook, no theme/branding beyond what
 * Chatbot.config already defines as public-safe.
 */
export const getPublicWidgetConfig = async (req, res) => {
  try {
    const { chatbotId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(chatbotId)) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }

    const chatbot = await Chatbot.findById(chatbotId).lean();

    if (!chatbot || chatbot.deletedAt) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }

    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);

    if (!isWidgetRequestAllowed(req, chatbot)) {
      // Same 404 shape as "doesn't exist" — a caller probing from an
      // unauthorized origin learns nothing about whether the
      // chatbotId is even valid.
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }

    const company = await Company.findOne({ companyId: chatbot.companyId })
      .select("name")
      .lean();

    return res.status(200).json(buildPublicWidgetPayload(chatbot, company));
  } catch (error) {
    // Never leak internals to a public, unauthenticated caller.
    console.error("Public Widget Config Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load chatbot configuration.",
    });
  }
};
