import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { mergeChatbotConfig } from "../../config/chatbotConfig.js";

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

    if (!chatbot) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }

    // Same enum as everywhere else in the project (chatbot.model.js)
    // — not inventing new status values here.
    if (chatbot.status === "PAUSED" || chatbot.status === "OFFLINE") {
      return res.status(200).json({
        success: true,
        available: false,
        reason: chatbot.status === "OFFLINE" ? "offline" : "paused",
      });
    }

    const company = await Company.findOne({ companyId: chatbot.companyId })
      .select("name")
      .lean();

    return res.status(200).json({
      success: true,
      available: true,
      chatbot: {
        id: chatbot._id,
        name: chatbot.name,
        companyName: company?.name || "",
      },
      config: mergeChatbotConfig(chatbot.config),
    });
  } catch (error) {
    // Never leak internals to a public, unauthenticated caller.
    console.error("Public Widget Config Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load chatbot configuration.",
    });
  }
};
