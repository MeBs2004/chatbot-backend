import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { hasChatbotAccess } from "../admin/access.service.js";

// ======================================================
// Shared by every company-scoped Education controller — same pattern
// as backend/services/energy/energyAccess.service.js: resolves the
// chatbot from the URL, checks it's really an Education chatbot,
// checks the requester actually has access to it, resolves its company.
// ======================================================
export async function loadAuthorizedEducationChatbot(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot || chatbot.deletedAt) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }
  if (chatbot.template !== "education") {
    res.status(400).json({ success: false, message: "This chatbot isn't using the Education template." });
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

/** Escapes regex metacharacters before interpolating user-supplied search text into a Mongo $regex. */
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
