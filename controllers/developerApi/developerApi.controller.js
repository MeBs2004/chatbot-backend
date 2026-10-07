import Chatbot from "../../models/chatbot.model.js";
import Conversation from "../../models/conversation.model.js";
import Visitor from "../../models/visitor.model.js";
import UserMessage from "../../models/user.model.js";
import Bot from "../../models/bot.model.js";
import { resolveDateRange, computeAnalytics } from "../../services/analytics.service.js";
import { readKnowledgeFile } from "../../services/knowledge.service.js";
import { saveAgentReply } from "../../services/conversation.service.js";
import { isChatbotAllowed } from "../../middleware/apiKeyAuth.middleware.js";
import { sendSuccess, sendError } from "../../utils/apiResponse.js";

// ======================================================
// DEVELOPER API v1 (Phase 12) — /api/v1/developer/*
// Every handler below uses ONLY req.apiKeyContext.companyId for
// tenant scoping — a caller-supplied companyId in the query/body is
// never trusted (Section 10/33). Chatbot-restricted keys are
// enforced via isChatbotAllowed() before any chatbot-scoped read/
// write proceeds.
// ======================================================

const PAGE_LIMIT_MAX = 100;

function pagination(req) {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit) || 20, PAGE_LIMIT_MAX);
  return { page, limit };
}

export const getCompany = async (req, res) => {
  const { company } = req.apiKeyContext;
  return sendSuccess(res, {
    companyId: company.companyId,
    name: company.name,
    status: company.status,
    createdAt: company.createdAt,
  });
};

export const listChatbots = async (req, res) => {
  try {
    const { companyId, chatbotIds } = req.apiKeyContext;
    const filter = { companyId };
    if (chatbotIds.length > 0) filter._id = { $in: chatbotIds };

    const chatbots = await Chatbot.find(filter)
      .select("_id name status model createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();
    return sendSuccess(res, { chatbots });
  } catch (error) {
    console.error("Developer API listChatbots Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load chatbots.");
  }
};

export const getChatbot = async (req, res) => {
  try {
    const { companyId } = req.apiKeyContext;
    if (!isChatbotAllowed(req, req.params.id)) {
      return sendError(res, 403, "CHATBOT_ACCESS_DENIED", "This API key is not scoped to this chatbot.");
    }
    const chatbot = await Chatbot.findOne({ _id: req.params.id, companyId })
      .select("_id name status model createdAt updatedAt")
      .lean();
    if (!chatbot) return sendError(res, 404, "RESOURCE_NOT_FOUND", "Chatbot not found.");
    return sendSuccess(res, { chatbot });
  } catch (error) {
    console.error("Developer API getChatbot Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load chatbot.");
  }
};

export const listConversations = async (req, res) => {
  try {
    const { companyId, chatbotIds } = req.apiKeyContext;
    const { page, limit } = pagination(req);
    const filter = { companyId };
    // A chatbot-scoped key can only see conversations reliably
    // attributed to an allowed chatbot — conversations with a null
    // chatbotId (see Conversation model: ambiguous when a company
    // has 0 or >1 chatbots) are excluded rather than guessed at.
    if (chatbotIds.length > 0) filter.chatbotId = { $in: chatbotIds };

    const [conversations, total] = await Promise.all([
      Conversation.find(filter)
        .select("chatbotId visitorId status mode lastMessagePreview lastSender lastMessageAt startedAt closedAt source")
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Conversation.countDocuments(filter),
    ]);

    return sendSuccess(res, { conversations, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (error) {
    console.error("Developer API listConversations Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load conversations.");
  }
};

async function loadScopedConversation(req, res) {
  const { companyId, chatbotIds } = req.apiKeyContext;
  const { visitorId } = req.params;
  const conversation = await Conversation.findOne({ companyId, visitorId });
  if (!conversation) {
    sendError(res, 404, "RESOURCE_NOT_FOUND", "Conversation not found.");
    return null;
  }
  if (chatbotIds.length > 0 && (!conversation.chatbotId || !chatbotIds.includes(String(conversation.chatbotId)))) {
    sendError(res, 403, "CHATBOT_ACCESS_DENIED", "This API key is not scoped to this conversation's chatbot.");
    return null;
  }
  return conversation;
}

export const getConversationThread = async (req, res) => {
  try {
    const conversation = await loadScopedConversation(req, res);
    if (!conversation) return;

    const { companyId, visitorId } = conversation;
    const [userMessages, botMessages] = await Promise.all([
      UserMessage.find({ companyId, visitorId }).sort({ createdAt: -1 }).limit(50).lean(),
      Bot.find({ companyId, visitorId }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);

    const thread = [
      ...userMessages.map((m) => ({ sender: "user", text: m.text, createdAt: m.createdAt })),
      ...botMessages.map((m) => ({ sender: m.type === "agent" ? "agent" : "bot", text: m.text, createdAt: m.createdAt })),
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return sendSuccess(res, {
      conversation: {
        chatbotId: conversation.chatbotId,
        visitorId: conversation.visitorId,
        status: conversation.status,
        mode: conversation.mode,
        startedAt: conversation.startedAt,
        closedAt: conversation.closedAt,
      },
      thread,
    });
  } catch (error) {
    console.error("Developer API getConversationThread Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load conversation.");
  }
};

export const postConversationMessage = async (req, res) => {
  try {
    const conversation = await loadScopedConversation(req, res);
    if (!conversation) return;

    if (conversation.status === "CLOSED") {
      return sendError(res, 400, "INVALID_REQUEST", "This conversation is closed.");
    }

    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return sendError(res, 400, "INVALID_REQUEST", "text is required.");
    }
    if (text.length > 4000) {
      return sendError(res, 400, "INVALID_REQUEST", "Message is too long (max 4000 characters).");
    }

    const { apiKey } = req.apiKeyContext;
    // Reuses the exact same service function the admin dashboard's
    // agent-reply endpoint uses (conversation.controller.js
    // postAgentReply) — an API-key-attributed reply is functionally
    // identical to a human agent's, just with no AdminUser behind it
    // (Bot.agentId stays null; Bot.agentName records which API key
    // sent it, for the visitor-facing/admin-thread display).
    const botMessage = await saveAgentReply(conversation, { _id: null, name: `API: ${apiKey.name}` }, text.trim());

    return sendSuccess(
      res,
      { message: { sender: "agent", text: botMessage.text, createdAt: botMessage.createdAt } },
      201
    );
  } catch (error) {
    console.error("Developer API postConversationMessage Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to send message.");
  }
};

export const listVisitors = async (req, res) => {
  try {
    const { companyId, chatbotIds } = req.apiKeyContext;
    // Visitor records are company-scoped, not chatbot-scoped (no
    // chatbotId field exists on the model) — matching every other
    // part of this codebase's "one chatbot per company" assumption
    // (see chatbot.resolver.js). A chatbot-restricted key still sees
    // every visitor of the company; documented as a known limitation
    // for a future multi-chatbot company, not silently ignored.
    void chatbotIds;
    const { page, limit } = pagination(req);

    const [visitors, total] = await Promise.all([
      Visitor.find({ companyId })
        .select("visitorId name email totalVisits totalMessages firstVisit lastVisit status")
        .sort({ lastVisit: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Visitor.countDocuments({ companyId }),
    ]);

    return sendSuccess(res, { visitors, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (error) {
    console.error("Developer API listVisitors Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load visitors.");
  }
};

export const getAnalytics = async (req, res) => {
  try {
    const { companyId, chatbotIds } = req.apiKeyContext;
    const { chatbotId, days, startDate, endDate } = req.query;

    if (chatbotId && !isChatbotAllowed(req, chatbotId)) {
      return sendError(res, 403, "CHATBOT_ACCESS_DENIED", "This API key is not scoped to this chatbot.");
    }
    // A key restricted to more than one chatbot has no explicit
    // chatbotId here, and computeAnalytics only supports filtering
    // by zero or exactly one chatbotId — rather than silently
    // falling through to unrestricted company-wide numbers (which
    // could include a chatbot this key can't access), require the
    // caller to pick one of their allowed chatbots explicitly.
    if (!chatbotId && chatbotIds.length > 1) {
      return sendError(res, 400, "INVALID_REQUEST", "This API key is restricted to multiple chatbots — specify a chatbotId.");
    }

    // A single-chatbot-restricted key with no explicit chatbotId
    // implicitly scopes to that one chatbot — safer than silently
    // returning company-wide numbers a restricted key shouldn't see.
    const scope =
      chatbotId || chatbotIds.length === 1
        ? { companyFilter: { companyId }, chatbotId: chatbotId || chatbotIds[0], chatbotAttributionExact: false, note: null }
        : { companyFilter: { companyId }, chatbotId: null, chatbotAttributionExact: true, note: null };

    const range = resolveDateRange({ days, startDate, endDate });
    const { metrics, trends } = await computeAnalytics(scope, range);

    return sendSuccess(res, {
      range: { since: range.since, until: range.until, days: range.days },
      metrics,
      trends,
    });
  } catch (error) {
    if (error.status) return sendError(res, error.status, "INVALID_REQUEST", error.message);
    console.error("Developer API getAnalytics Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load analytics.");
  }
};

export const getKnowledge = async (req, res) => {
  try {
    const { company, chatbotIds } = req.apiKeyContext;
    const chatbotId = req.query.chatbotId || chatbotIds[0];
    if (chatbotId && !isChatbotAllowed(req, chatbotId)) {
      return sendError(res, 403, "CHATBOT_ACCESS_DENIED", "This API key is not scoped to this chatbot.");
    }

    const result = await readKnowledgeFile(company.companyId);
    return sendSuccess(res, {
      content: result.content,
      characterCount: result.content.length,
      updatedAt: result.updatedAt,
      ...(result.error && { note: "Knowledge base is empty or unavailable." }),
    });
  } catch (error) {
    console.error("Developer API getKnowledge Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load knowledge base.");
  }
};
