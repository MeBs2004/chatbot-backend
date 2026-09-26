import Chatbot from "../models/chatbot.model.js";
import { mergeChatbotConfig } from "../config/chatbotConfig.js";

export const getCompany = async (req, res) => {
  try {
    if (!req.company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    // Additive only (Phase 5) — every existing field/shape below is
    // untouched. Lets the public widget decide legacy vs the new
    // config-driven engine without changing anything it already
    // reads from `company`. Only resolved when the company has
    // exactly one Chatbot record, matching how the rest of the
    // system already treats "one company, one bot" as the norm;
    // ambiguous (0 or 2+) cases fall back to legacy, never guess.
    let widgetEngineVersion = "legacy";
    let chatbotId = null;

    // Additive (Public Widget Config Integration) — the normalized,
    // public-safe Chatbot.config for the same unambiguous chatbot
    // resolved above, so Bot.jsx/OyaBot.jsx can theme themselves
    // without a second network round trip or a new identity model.
    // Reuses the exact same merge function and status-gating rule as
    // the chatbotId-keyed /api/widget/config/:chatbotId endpoint —
    // no duplicated normalization or secret-exposure logic. `null`
    // (not an error) whenever no single chatbot is resolved, or the
    // resolved chatbot is PAUSED/OFFLINE — callers must already
    // handle "no config" by falling back to Company.ai/chatbot/theme
    // or their own hardcoded defaults, same as today.
    let widgetConfig = null;

    try {
      const chatbots = await Chatbot.find({ companyId: req.company.companyId })
        .select("_id widgetEngineVersion status config")
        .lean();

      if (chatbots.length === 1) {
        const chatbot = chatbots[0];
        widgetEngineVersion = chatbot.widgetEngineVersion || "legacy";
        chatbotId = chatbot._id;

        if (chatbot.status === "PAUSED" || chatbot.status === "OFFLINE") {
          widgetConfig = {
            available: false,
            reason: chatbot.status === "OFFLINE" ? "offline" : "paused",
          };
        } else {
          widgetConfig = {
            available: true,
            config: mergeChatbotConfig(chatbot.config),
          };
        }
      }
    } catch (lookupErr) {
      // Never let this additive lookup break the existing response.
      console.error("Widget Engine Lookup Error:", lookupErr);
    }

    // Security fix (Public Widget Config Integration audit) — this
    // endpoint is public and unauthenticated (companyMiddleware only
    // checks that companyId resolves to an active company; there is no
    // API key or session). It previously spread the ENTIRE raw Company
    // document (`company: req.company`), which included `ai.systemPrompt`
    // (the full internal prompt) and `webhook.secret` (a plaintext
    // secret field on the schema) in every response — exposed to any
    // caller with a companyId, permanently, in production. Neither field
    // is read by any frontend widget (Bot.jsx/OyaBot.jsx/NuformlyWidget/
    // Embed.jsx only ever read the fields whitelisted below); the actual
    // AI reply pipeline (chatbot.message.js) loads systemPrompt itself,
    // server-side, from its own `req.company` — never from this response
    // — so narrowing this does not touch AI generation at all.
    const publicCompany = {
      companyId: req.company.companyId,
      name: req.company.name,
      branding: { botAvatar: req.company.branding?.botAvatar || "" },
      theme: req.company.theme || {},
      chatbot: {
        chatbotName: req.company.chatbot?.chatbotName || "",
        botName: req.company.chatbot?.botName || "",
      },
      contact: {
        phone: req.company.contact?.phone || "",
        whatsapp: req.company.contact?.whatsapp || "",
        email: req.company.contact?.email || "",
      },
    };

    return res.status(200).json({
      success: true,
      company: publicCompany,
      widgetEngineVersion,
      chatbotId,
      widgetConfig,
    });
  } catch (error) {
    console.error("Get Company Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch company.",
      error: error.message,
    });
  }
};
