import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { hasChatbotAccess } from "../admin/access.service.js";

// ======================================================
// Shared by every company-scoped Energy controller (config, questions,
// equipment, …): resolves the chatbot from the URL, checks it's really
// an Energy chatbot, checks the requester actually has access to it,
// and resolves its company — the one place this logic lives, so Phase
// 2+ controllers don't each reimplement it (brief: "do not recreate or
// duplicate anything already implemented").
// ======================================================
export async function loadAuthorizedEnergyChatbot(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot || chatbot.deletedAt) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }
  if (chatbot.template !== "energy") {
    res.status(400).json({ success: false, message: "This chatbot isn't using the Energy template." });
    return null;
  }
  if (!(await hasChatbotAccess(req.adminUser, chatbot._id))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }
  const company = await Company.findOne({ companyId: chatbot.companyId }).lean();
  if (!company) {
    res.status(404).json({ success: false, message: "Company not found." });
    return null;
  }
  return { chatbot, company };
}

/** A query filter matching either a platform default (companyId: null) or this company's own rows — never another tenant's. */
export const sharedOrOwn = (companyId) => ({ $or: [{ companyId: null }, { companyId }] });

/**
 * Escapes regex metacharacters in user-supplied search/filter text before
 * it's interpolated into a Mongo `$regex`. Without this, a search string
 * like `(a+)+$` could cause pathological backtracking (ReDoS) — scoped to
 * the admin's own tenant data either way, but there's no reason to accept
 * even a self-inflicted denial-of-service when escaping is this cheap.
 */
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
