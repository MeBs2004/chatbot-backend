import crypto from "node:crypto";
import MarketingLead from "../../models/marketing/lead.model.js";
import ChatbotMarketingConfig from "../../models/marketing/chatbotMarketingConfig.model.js";
import { hasExpiredWidgetToken, sendTokenExpired } from "../../middleware/widgetSession.middleware.js";
import { resolvePublicMarketingChatbot } from "../../services/marketing/marketingWidgetAccess.service.js";

// ======================================================
// PUBLIC DIGITAL MARKETING WIDGET API — same trust model as every
// other /api/widget/* endpoint: public, unauthenticated, chatbot-
// scoped by id from the URL. Only ever serves a PUBLISHED config.
// ======================================================

function generateReferenceId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const entropy = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `MKT-${stamp}-${entropy}`;
}

export const getMarketingConfig = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolvePublicMarketingChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const config = await ChatbotMarketingConfig.findOne({ chatbotId: chatbot._id, status: "PUBLISHED" }).lean();
    if (!config) {
      return res.status(200).json({ success: true, leadCaptureEnabled: false, ctaLabel: "Request a Quote", enabledServiceKeys: [], enabledCapabilityKeys: [] });
    }
    return res.status(200).json({
      success: true,
      leadCaptureEnabled: Boolean(config.leadSettings?.enabled),
      ctaLabel: config.leadSettings?.ctaLabel || "Request a Quote",
      requiredFields: config.leadSettings?.requiredFields || ["name", "phone"],
      enabledServiceKeys: config.enabledServiceKeys || [],
      enabledCapabilityKeys: config.enabledCapabilityKeys || [],
    });
  } catch (error) {
    console.error("Get Marketing Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load configuration." });
  }
};

export const createLead = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolvePublicMarketingChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const { name, phone, email, companyName, website, requiredServices, budget, timeline, message } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required." });
    if (!phone && !email) return res.status(400).json({ success: false, message: "A phone number or email is required so we can follow up." });

    let referenceId;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      referenceId = generateReferenceId();
      // eslint-disable-next-line no-await-in-loop
      if (!(await MarketingLead.exists({ referenceId }))) break;
    }

    const lead = await MarketingLead.create({
      companyId: chatbot.companyId,
      chatbotId: chatbot._id,
      referenceId,
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : "",
      email: email ? String(email).trim().toLowerCase() : "",
      companyName: companyName ? String(companyName).trim() : "",
      website: website ? String(website).trim() : "",
      requiredServices: Array.isArray(requiredServices) ? requiredServices.map(String) : [],
      budget: budget ? String(budget).trim() : "",
      timeline: timeline ? String(timeline).trim() : "",
      message: message ? String(message).trim() : "",
      source: "widget",
    });

    return res.status(201).json({ success: true, lead: { referenceId: lead.referenceId, status: lead.status } });
  } catch (error) {
    console.error("Create Marketing Lead Error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit your request. Please try again." });
  }
};
