import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { hasChatbotAccess } from "../admin/access.service.js";

// ======================================================
// Shared by every company-scoped Digital Marketing controller — same
// pattern as services/education/educationAccess.service.js and
// services/energy/energyAccess.service.js.
// ======================================================
export async function loadAuthorizedMarketingChatbot(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot || chatbot.deletedAt) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }
  if (chatbot.template !== "digital_marketing") {
    res.status(400).json({ success: false, message: "This chatbot isn't using the Digital Marketing template." });
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
