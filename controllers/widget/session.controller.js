import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { isOriginAllowed } from "../../services/domainAllowlist.service.js";
import { signWidgetToken } from "../../services/widget/widgetToken.service.js";
import { buildPublicWidgetPayload } from "./config.controller.js";

const notFound = (res) => res.status(404).json({ success: false, message: "Chatbot not found." });

/**
 * POST /api/widget/session { chatbotId } — called by widget.js on the
 * customer's page. The ONLY place the site's domain is checked against
 * allowedDomains, because it's the only widget request whose Origin is
 * the customer's site rather than the widget CDN. Every rejection is
 * the same 404 so a caller can't probe which ids or domains exist.
 */
export const createWidgetSession = async (req, res) => {
  try {
    const { chatbotId } = req.body || {};
    if (typeof chatbotId !== "string" || !mongoose.Types.ObjectId.isValid(chatbotId)) return notFound(res);

    const chatbot = await Chatbot.findById(chatbotId).lean();
    if (!chatbot || chatbot.deletedAt) return notFound(res);
    if (!isOriginAllowed(chatbot.allowedDomains, req)) return notFound(res);

    const company = await Company.findOne({ companyId: chatbot.companyId, isActive: true }).select("name companyId").lean();
    if (!company) return notFound(res);

    const payload = buildPublicWidgetPayload(chatbot, company);
    if (!payload.available) return res.status(200).json(payload);

    const { token, expiresAt } = signWidgetToken({ chatbotId: chatbot._id, companyId: chatbot.companyId });
    return res.status(200).json({ ...payload, token, expiresAt });
  } catch (error) {
    console.error("Widget Session Error:", error);
    return res.status(500).json({ success: false, message: "Unable to start chat session." });
  }
};
