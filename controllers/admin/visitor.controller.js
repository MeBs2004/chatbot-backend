import Visitor from "../../models/visitor.model.js";
import Company from "../../models/company.model.js";
import Chatbot from "../../models/chatbot.model.js";
import UserMessage from "../../models/user.model.js";
import Conversation from "../../models/conversation.model.js";
import { getAccessibleCompanyIds, hasChatbotAccess } from "../../services/admin/access.service.js";
import { ACTIVE_THRESHOLD_MS } from "../../services/analytics.service.js";

// ======================================================
// VISITORS (Phase 9)
// Status vocabulary (Section 10 — every value here is a precise,
// server-computed definition, never the stored Visitor.status field,
// which is set to "online" on every message and never automatically
// decays back to "offline" — it would misrepresent "Active" if used
// directly):
//   ACTIVE:    lastVisit within the last 15 minutes (ACTIVE_THRESHOLD_MS)
//   INACTIVE:  everyone else
//   NEW:       totalVisits <= 1 (has never returned for a second visit)
//   RETURNING: totalVisits > 1
// ======================================================

export const listVisitors = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { search, companyId, chatbotId, status, startDate, endDate } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { visitorId: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { lastMessage: { $regex: search, $options: "i" } },
      ];
    }

    if (startDate || endDate) {
      filter.lastVisit = {};
      if (startDate) filter.lastVisit.$gte = new Date(startDate);
      if (endDate) filter.lastVisit.$lt = new Date(new Date(endDate).getTime() + 24 * 60 * 60 * 1000);
    }

    if (status === "active") {
      filter.lastVisit = { ...filter.lastVisit, $gte: new Date(Date.now() - ACTIVE_THRESHOLD_MS) };
    } else if (status === "inactive") {
      filter.lastVisit = { ...filter.lastVisit, $lt: new Date(Date.now() - ACTIVE_THRESHOLD_MS) };
    } else if (status === "new") {
      filter.totalVisits = { $lte: 1 };
    } else if (status === "returning") {
      filter.totalVisits = { $gt: 1 };
    }

    const accessibleIds = await getAccessibleCompanyIds(requester);

    if (chatbotId) {
      if (!(await hasChatbotAccess(requester, chatbotId))) {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
      const chatbot = await Chatbot.findById(chatbotId).select("companyId").lean();
      if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });
      filter.companyId = chatbot.companyId;
    } else if (companyId) {
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
      filter.companyId = companyId;
    } else if (accessibleIds !== null) {
      filter.companyId = { $in: accessibleIds };
    }

    const [visitors, total] = await Promise.all([
      Visitor.find(filter)
        .sort({ lastVisit: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Visitor.countDocuments(filter),
    ]);

    const companyIds = [...new Set(visitors.map((v) => v.companyId))];
    const visitorKeys = visitors.map((v) => ({ companyId: v.companyId, visitorId: v.visitorId }));

    const [companies, conversationCounts] = await Promise.all([
      Company.find({ companyId: { $in: companyIds } }).select("companyId name").lean(),
      visitorKeys.length
        ? Conversation.find({ $or: visitorKeys }).select("companyId visitorId").lean()
        : [],
    ]);

    const companyMap = Object.fromEntries(companies.map((c) => [c.companyId, c.name]));
    const conversationMap = new Set(conversationCounts.map((c) => `${c.companyId}::${c.visitorId}`));
    const activeThreshold = Date.now() - ACTIVE_THRESHOLD_MS;

    const result = visitors.map((v) => ({
      ...v,
      companyName: companyMap[v.companyId] || v.companyId,
      isActive: new Date(v.lastVisit).getTime() >= activeThreshold,
      isReturning: v.totalVisits > 1,
      hasConversation: conversationMap.has(`${v.companyId}::${v.visitorId}`),
    }));

    return res.status(200).json({
      success: true,
      visitors: result,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error("List Visitors Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load visitors." });
  }
};

export const getVisitorDetail = async (req, res) => {
  try {
    const requester = req.adminUser;
    const visitor = await Visitor.findById(req.params.id).lean();

    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found." });
    }

    const accessibleIds = await getAccessibleCompanyIds(requester);
    if (accessibleIds !== null && !accessibleIds.includes(visitor.companyId)) {
      return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    }

    const [messageCount, company, conversation] = await Promise.all([
      UserMessage.countDocuments({ companyId: visitor.companyId, visitorId: visitor.visitorId }),
      Company.findOne({ companyId: visitor.companyId }).select("companyId name").lean(),
      Conversation.findOne({ companyId: visitor.companyId, visitorId: visitor.visitorId })
        .select("status mode assignedTo chatbotId startedAt lastMessageAt closedAt")
        .populate("assignedTo", "name")
        .lean(),
    ]);

    let chatbotName = null;
    if (conversation?.chatbotId) {
      const chatbot = await Chatbot.findById(conversation.chatbotId).select("name").lean();
      chatbotName = chatbot?.name || null;
    }

    return res.status(200).json({
      success: true,
      visitor,
      company,
      stats: { messageCount },
      conversation: conversation ? { ...conversation, chatbotName } : null,
      isActive: new Date(visitor.lastVisit).getTime() >= Date.now() - ACTIVE_THRESHOLD_MS,
      isReturning: visitor.totalVisits > 1,
    });
  } catch (error) {
    console.error("Get Visitor Detail Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load visitor." });
  }
};

/**
 * A reconstructed activity timeline — every entry is a real database
 * record with a real timestamp, nothing synthesized. See Section 8:
 * only event types that can be reliably reconstructed from existing
 * data are included (e.g. there is no stored "reopened at" history,
 * so a reopen is never shown as a discrete event).
 */
export const getVisitorTimeline = async (req, res) => {
  try {
    const requester = req.adminUser;
    const visitor = await Visitor.findById(req.params.id).lean();
    if (!visitor) return res.status(404).json({ success: false, message: "Visitor not found." });

    const accessibleIds = await getAccessibleCompanyIds(requester);
    if (accessibleIds !== null && !accessibleIds.includes(visitor.companyId)) {
      return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    }

    const UserModel = (await import("../../models/user.model.js")).default;
    const Bot = (await import("../../models/bot.model.js")).default;

    const [userMsgs, botMsgs] = await Promise.all([
      UserModel.find({ companyId: visitor.companyId, visitorId: visitor.visitorId }).select("text createdAt").sort({ createdAt: 1 }).lean(),
      Bot.find({ companyId: visitor.companyId, visitorId: visitor.visitorId }).select("text type agentName createdAt").sort({ createdAt: 1 }).lean(),
    ]);

    const events = [
      { type: "visitor_created", at: visitor.firstVisit, detail: visitor.page ? `Landed on ${visitor.page}` : null },
      ...userMsgs.map((m) => ({ type: "message_sent", at: m.createdAt, detail: m.text })),
      ...botMsgs.map((m) => ({
        type: m.type === "handoff" ? "human_handoff" : m.type === "agent" ? "human_reply" : "ai_response",
        at: m.createdAt,
        detail: m.text,
        agentName: m.agentName || null,
      })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    return res.status(200).json({ success: true, events });
  } catch (error) {
    console.error("Get Visitor Timeline Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load visitor timeline." });
  }
};
