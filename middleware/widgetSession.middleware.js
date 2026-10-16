import mongoose from "mongoose";
import Chatbot from "../models/chatbot.model.js";
import { getCompanyById } from "../services/company/company.service.js";
import { verifyWidgetToken, WidgetTokenError } from "../services/widget/widgetToken.service.js";
import { isOriginAllowed } from "../services/domainAllowlist.service.js";
import companyMiddleware from "./company.middleware.js";

// ======================================================
// Public widget tenancy. A request carrying x-widget-token is bound
// to the token's chatbot and company, loaded from the database — any
// x-company-id or body chatbotId the caller sends is ignored (a
// mismatching body chatbotId is rejected in the message controller).
// Requests without a token are old installs and keep using
// companyMiddleware exactly as before.
// ======================================================

const notFound = (res) => res.status(404).json({ success: false, message: "Chatbot not found." });

export const widgetSessionMiddleware = async (req, res, next) => {
  let claims;
  try {
    claims = verifyWidgetToken(req.headers["x-widget-token"]);
  } catch (err) {
    if (err instanceof WidgetTokenError) {
      return res.status(401).json({ success: false, code: err.code, message: err.message });
    }
    throw err;
  }

  try {
    if (!mongoose.Types.ObjectId.isValid(claims.chatbotId)) return notFound(res);
    const chatbot = await Chatbot.findById(claims.chatbotId)
      .select("_id companyId allowedDomains status deletedAt template")
      .lean();
    if (!chatbot || chatbot.deletedAt || chatbot.companyId !== claims.companyId) return notFound(res);

    // Same lookup companyMiddleware uses (isActive only, no knowledge blob).
    const company = await getCompanyById(chatbot.companyId);
    if (!company) return notFound(res);

    req.chatbot = chatbot;
    req.company = company;
    next();
  } catch (error) {
    console.error("Widget Session Middleware Error:", error);
    return res.status(500).json({ success: false, message: "Request failed." });
  }
};

export const publicTenantMiddleware = (req, res, next) =>
  req.headers["x-widget-token"] ? widgetSessionMiddleware(req, res, next) : companyMiddleware(req, res, next);

/**
 * True when the request carries a widget token that has expired — the
 * caller should answer 401 WIDGET_TOKEN_EXPIRED so the chat iframe
 * refreshes the token instead of showing "unavailable".
 */
export function hasExpiredWidgetToken(req) {
  const token = req.headers["x-widget-token"];
  if (!token) return false;
  try {
    verifyWidgetToken(token);
    return false;
  } catch (err) {
    return err instanceof WidgetTokenError && err.code === "WIDGET_TOKEN_EXPIRED";
  }
}

export function sendTokenExpired(res) {
  return res.status(401).json({ success: false, code: "WIDGET_TOKEN_EXPIRED", message: "Widget session expired." });
}

/**
 * May this public request act for `chatbot`? A valid widget token for
 * that exact chatbot proves the session started on an allowed site;
 * without one, fall back to the Origin/Referer allowlist (old installs).
 */
export function isWidgetRequestAllowed(req, chatbot) {
  const token = req.headers["x-widget-token"];
  if (token) {
    try {
      return verifyWidgetToken(token).chatbotId === String(chatbot._id);
    } catch {
      return false;
    }
  }
  return isOriginAllowed(chatbot.allowedDomains, req);
}
