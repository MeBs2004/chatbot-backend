import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ChatbotAccess from "../../models/chatbotAccess.model.js";
import Chatbot from "../../models/chatbot.model.js";

/**
 * Returns the list of companyIds an admin user may see, or
 * `null` to mean "unrestricted" (SUPER_ADMIN).
 */
export const getAccessibleCompanyIds = async (adminUser) => {
  if (adminUser.role === "SUPER_ADMIN") return null;

  const rows = await UserCompanyAccess.find({
    userId: adminUser._id,
    status: "ACTIVE",
  })
    .select("companyId")
    .lean();

  return rows.map((r) => r.companyId);
};

export const hasCompanyAccess = async (adminUser, companyId) => {
  if (adminUser.role === "SUPER_ADMIN") return true;
  if (!companyId) return false;

  const access = await UserCompanyAccess.findOne({
    userId: adminUser._id,
    companyId,
    status: "ACTIVE",
  }).lean();

  return !!access;
};

/**
 * Company-scoped role for this admin user: their own
 * UserCompanyAccess.role, or "SUPER_ADMIN" if global.
 */
export const getCompanyRole = async (adminUser, companyId) => {
  if (adminUser.role === "SUPER_ADMIN") return "SUPER_ADMIN";

  const access = await UserCompanyAccess.findOne({
    userId: adminUser._id,
    companyId,
    status: "ACTIVE",
  }).lean();

  return access?.role || null;
};

export const hasChatbotAccess = async (adminUser, chatbotId) => {
  if (adminUser.role === "SUPER_ADMIN") return true;

  const chatbot = await Chatbot.findById(chatbotId).lean();
  if (!chatbot) return false;

  if (await hasCompanyAccess(adminUser, chatbot.companyId)) return true;

  const access = await ChatbotAccess.findOne({
    userId: adminUser._id,
    chatbotId,
  }).lean();

  return !!access;
};
