import Company from "../../models/company.model.js";
import Chatbot from "../../models/chatbot.model.js";
import AdminUser from "../../models/adminUser.model.js";
import Visitor from "../../models/visitor.model.js";
import VisitorMessage from "../../models/user.model.js";
import AuditLog from "../../models/auditLog.model.js";
import { getAccessibleCompanyIds } from "../../services/admin/access.service.js";

export const getDashboard = async (req, res) => {
  try {
    const requester = req.adminUser;
    const accessibleIds = await getAccessibleCompanyIds(requester);
    const companyFilter =
      accessibleIds !== null ? { companyId: { $in: accessibleIds } } : {};
    const chatbotFilter = { ...companyFilter, deletedAt: null };

    const [
      companyCount,
      chatbotCount,
      adminUserCount,
      visitorCount,
      messageCount,
      recentActivity,
      botHealth,
    ] = await Promise.all([
      Company.countDocuments(companyFilter),
      Chatbot.countDocuments(chatbotFilter),
      requester.role === "SUPER_ADMIN"
        ? AdminUser.countDocuments({})
        : Promise.resolve(null),
      Visitor.countDocuments(companyFilter),
      VisitorMessage.countDocuments(companyFilter),
      AuditLog.find(
        accessibleIds !== null ? { companyId: { $in: accessibleIds } } : {}
      )
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      Chatbot.find(chatbotFilter).select("name status companyId").lean(),
    ]);

    return res.status(200).json({
      success: true,
      kpis: {
        companies: companyCount,
        chatbots: chatbotCount,
        adminUsers: adminUserCount,
        visitors: visitorCount,
        messages: messageCount,
      },
      botHealth,
      recentActivity,
    });
  } catch (error) {
    console.error("Dashboard Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard.",
    });
  }
};
