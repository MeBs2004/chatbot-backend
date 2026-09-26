import Conversation from "../../models/conversation.model.js";
import Visitor from "../../models/visitor.model.js";
import Company from "../../models/company.model.js";
import AdminUser from "../../models/adminUser.model.js";
import UserMessage from "../../models/user.model.js";
import Bot from "../../models/bot.model.js";
import {
  getAccessibleCompanyIds,
  hasCompanyAccess,
  hasChatbotAccess,
  getCompanyRole,
} from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { dispatchWebhookEvent } from "../../services/webhookDispatch.service.js";
import { dispatchDeveloperWebhooks } from "../../services/developerWebhookDispatch.service.js";
import {
  getConversationPermissions,
  takeOverConversation,
  returnToAiConversation,
  closeConversation,
  reopenConversation,
  assignConversation,
  addConversationNote,
  markConversationRead,
  saveAgentReply,
} from "../../services/conversation.service.js";

// ======================================================
// CONVERSATIONS (Phase 8)
// `Conversation` (models/conversation.model.js) is now the source of
// truth for status/mode/assignment — message CONTENT still lives
// entirely in the existing User/Bot collections, read here and
// merged in, never duplicated or moved.
// ======================================================

const THREAD_PAGE_SIZE = 50;

/**
 * Shared guard for every single-conversation endpoint below: loads
 * the Conversation, 404s if missing, and enforces company access
 * plus — closing a real pre-existing gap (this API never checked
 * chatbot-level access before Phase 8) — chatbot access when the
 * conversation has a resolved chatbotId.
 */
async function loadAuthorizedConversation(req, res) {
  const { companyId, visitorId } = req.params;
  const conversation = await Conversation.findOne({ companyId, visitorId });

  if (!conversation) {
    res.status(404).json({ success: false, message: "Conversation not found." });
    return null;
  }

  const requester = req.adminUser;
  if (!(await hasCompanyAccess(requester, conversation.companyId))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }
  if (conversation.chatbotId && !(await hasChatbotAccess(requester, conversation.chatbotId))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }

  return conversation;
}

export const listConversations = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { search, companyId, status, mode, assigned } = req.query;

    const filter = {};

    const accessibleIds = await getAccessibleCompanyIds(requester);
    if (companyId) {
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
      filter.companyId = companyId;
    } else if (accessibleIds !== null) {
      filter.companyId = { $in: accessibleIds };
    }

    if (status && ["OPEN", "PENDING", "CLOSED"].includes(status)) filter.status = status;
    if (mode && ["AI", "HUMAN"].includes(mode)) filter.mode = mode;

    if (assigned === "me") filter.assignedTo = requester._id;
    else if (assigned === "unassigned") filter.assignedTo = null;
    else if (assigned && assigned !== "any") filter.assignedTo = assigned;

    let visitorIdsForSearch = null;
    if (search) {
      const matchingVisitors = await Visitor.find({
        $or: [
          { visitorId: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      })
        .select("companyId visitorId")
        .lean();
      visitorIdsForSearch = matchingVisitors.map((v) => `${v.companyId}::${v.visitorId}`);
      // Text search across message content — a real backend query,
      // not a client-side filter over a fully-downloaded dataset.
      const matchingMessages = await UserMessage.find({ text: { $regex: search, $options: "i" } })
        .select("companyId visitorId")
        .limit(200)
        .lean();
      visitorIdsForSearch.push(...matchingMessages.map((m) => `${m.companyId}::${m.visitorId}`));

      if (visitorIdsForSearch.length === 0) {
        return res.status(200).json({ success: true, conversations: [], pagination: { page, limit, total: 0, pages: 1 } });
      }
      filter.$or = [...new Set(visitorIdsForSearch)].map((key) => {
        const [cid, vid] = key.split("::");
        return { companyId: cid, visitorId: vid };
      });
    }

    const [conversations, total] = await Promise.all([
      Conversation.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("assignedTo", "name email")
        .lean(),
      Conversation.countDocuments(filter),
    ]);

    const companyIds = [...new Set(conversations.map((c) => c.companyId))];
    const visitorKeys = conversations.map((c) => ({ companyId: c.companyId, visitorId: c.visitorId }));

    const [companies, visitors] = await Promise.all([
      Company.find({ companyId: { $in: companyIds } }).select("companyId name").lean(),
      visitorKeys.length
        ? Visitor.find({ $or: visitorKeys }).select("companyId visitorId name email").lean()
        : [],
    ]);

    const companyMap = Object.fromEntries(companies.map((c) => [c.companyId, c.name]));
    const visitorMap = Object.fromEntries(visitors.map((v) => [`${v.companyId}::${v.visitorId}`, v]));

    const result = conversations.map((c) => {
      const visitor = visitorMap[`${c.companyId}::${c.visitorId}`];
      return {
        companyId: c.companyId,
        companyName: companyMap[c.companyId] || c.companyId,
        chatbotId: c.chatbotId,
        visitorId: c.visitorId,
        visitorName: visitor?.name || null,
        visitorEmail: visitor?.email || null,
        status: c.status,
        mode: c.mode,
        assignedTo: c.assignedTo || null,
        lastMessagePreview: c.lastMessagePreview,
        lastSender: c.lastSender,
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCount,
        source: c.source,
        startedAt: c.startedAt,
      };
    });

    return res.status(200).json({
      success: true,
      conversations: result,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error("List Conversations Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load conversations." });
  }
};

export const getConversationThread = async (req, res) => {
  try {
    const conversation = await loadAuthorizedConversation(req, res);
    if (!conversation) return;

    const { companyId, visitorId } = conversation;
    const before = req.query.before ? new Date(req.query.before) : null;
    const dateFilter = before ? { createdAt: { $lt: before } } : {};

    const [visitor, userMessages, botMessages] = await Promise.all([
      Visitor.findOne({ companyId, visitorId }).lean(),
      UserMessage.find({ companyId, visitorId, ...dateFilter })
        .sort({ createdAt: -1 })
        .limit(THREAD_PAGE_SIZE)
        .lean(),
      Bot.find({ companyId, visitorId, ...dateFilter })
        .sort({ createdAt: -1 })
        .limit(THREAD_PAGE_SIZE)
        .lean(),
    ]);

    const merged = [
      ...userMessages.map((m) => ({ sender: "user", text: m.text, createdAt: m.createdAt })),
      ...botMessages.map((m) => ({
        sender: m.type === "agent" ? "agent" : "bot",
        type: m.type || "ai",
        agentName: m.agentName || null,
        text: m.text,
        createdAt: m.createdAt,
      })),
    ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // Oldest-first page of at most THREAD_PAGE_SIZE*2 raw docs may
    // still exceed the requested page size once merged — trim to the
    // most recent THREAD_PAGE_SIZE after merge, `hasMore` reflects
    // whether either side was cut off at the query's own limit.
    const thread = merged.slice(-THREAD_PAGE_SIZE);
    const hasMore = userMessages.length === THREAD_PAGE_SIZE || botMessages.length === THREAD_PAGE_SIZE;

    const requester = req.adminUser;
    const role = await getCompanyRole(requester, companyId);

    await markConversationRead(conversation);

    return res.status(200).json({
      success: true,
      visitor,
      conversation: {
        companyId: conversation.companyId,
        chatbotId: conversation.chatbotId,
        visitorId: conversation.visitorId,
        status: conversation.status,
        mode: conversation.mode,
        assignedTo: conversation.assignedTo,
        handoffAt: conversation.handoffAt,
        handoffReason: conversation.handoffReason,
        startedAt: conversation.startedAt,
        closedAt: conversation.closedAt,
        source: conversation.source,
        notes: conversation.notes,
      },
      thread,
      hasMore,
      permissions: getConversationPermissions(role),
    });
  } catch (error) {
    console.error("Get Conversation Thread Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load conversation." });
  }
};

export const updateConversationStatus = async (req, res) => {
  try {
    const conversation = await loadAuthorizedConversation(req, res);
    if (!conversation) return;

    const requester = req.adminUser;
    const role = await getCompanyRole(requester, conversation.companyId);
    const perms = getConversationPermissions(role);
    const { action } = req.body;

    let auditAction = null;
    let metadata = {};

    switch (action) {
      case "takeOver": {
        if (!perms.canTakeOver) return res.status(403).json({ success: false, message: "You don't have permission to take over conversations." });
        const wasAlreadyHuman = conversation.mode === "HUMAN";
        await takeOverConversation(conversation, requester);
        auditAction = "CONVERSATION_TAKEN_OVER";
        if (!wasAlreadyHuman) {
          const company = await Company.findOne({ companyId: conversation.companyId }).lean();
          dispatchWebhookEvent(company, "conversation.handoff", {
            chatbotId: conversation.chatbotId,
            conversationId: conversation._id,
            visitorId: conversation.visitorId,
            reason: "manual",
          });
          dispatchDeveloperWebhooks(conversation.companyId, conversation.chatbotId, "conversation.handoff", {
            chatbotId: conversation.chatbotId,
            conversationId: conversation._id,
            visitorId: conversation.visitorId,
            reason: "manual",
          });
        }
        break;
      }
      case "returnToAI": {
        if (!perms.canReturnToAI) return res.status(403).json({ success: false, message: "You don't have permission to return this conversation to AI." });
        await returnToAiConversation(conversation);
        auditAction = "CONVERSATION_RETURNED_TO_AI";
        break;
      }
      case "close": {
        if (!perms.canClose) return res.status(403).json({ success: false, message: "You don't have permission to close conversations." });
        await closeConversation(conversation, requester);
        auditAction = "CONVERSATION_CLOSED";
        const company = await Company.findOne({ companyId: conversation.companyId }).lean();
        dispatchWebhookEvent(company, "conversation.closed", {
          chatbotId: conversation.chatbotId,
          conversationId: conversation._id,
          visitorId: conversation.visitorId,
        });
        dispatchDeveloperWebhooks(conversation.companyId, conversation.chatbotId, "conversation.closed", {
          chatbotId: conversation.chatbotId,
          conversationId: conversation._id,
          visitorId: conversation.visitorId,
        });
        break;
      }
      case "reopen": {
        if (!perms.canReopen) return res.status(403).json({ success: false, message: "You don't have permission to reopen conversations." });
        await reopenConversation(conversation);
        auditAction = "CONVERSATION_REOPENED";
        break;
      }
      case "markRead": {
        await markConversationRead(conversation);
        break;
      }
      case "assign": {
        const { agentId } = req.body;
        if (agentId) {
          // Self-assign via "assign to me" is allowed for anyone who
          // can reply; assigning to someone ELSE requires
          // canAssignOthers.
          const isSelfAssign = String(agentId) === String(requester._id);
          if (!isSelfAssign && !perms.canAssignOthers) {
            return res.status(403).json({ success: false, message: "You don't have permission to assign this conversation to another agent." });
          }
          const targetUser = await AdminUser.findById(agentId);
          if (!targetUser) return res.status(404).json({ success: false, message: "Agent not found." });
          if (!(await hasCompanyAccess(targetUser, conversation.companyId))) {
            return res.status(400).json({ success: false, message: "That user doesn't have access to this company." });
          }
          await assignConversation(conversation, targetUser);
          metadata = { agentId, agentName: targetUser.name };
        } else {
          if (!perms.canAssignOthers) {
            return res.status(403).json({ success: false, message: "You don't have permission to unassign this conversation." });
          }
          await assignConversation(conversation, null);
        }
        auditAction = "CONVERSATION_ASSIGNED";
        break;
      }
      default:
        return res.status(400).json({ success: false, message: `Unsupported action "${action}".` });
    }

    if (auditAction) {
      await logAction(req, {
        action: auditAction,
        resource: "Conversation",
        resourceId: `${conversation.companyId}/${conversation.visitorId}`,
        companyId: conversation.companyId,
        metadata,
      });
    }

    return res.status(200).json({
      success: true,
      conversation: {
        status: conversation.status,
        mode: conversation.mode,
        assignedTo: conversation.assignedTo,
      },
    });
  } catch (error) {
    console.error("Update Conversation Status Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update conversation." });
  }
};

export const postAgentReply = async (req, res) => {
  try {
    const conversation = await loadAuthorizedConversation(req, res);
    if (!conversation) return;

    const requester = req.adminUser;
    const role = await getCompanyRole(requester, conversation.companyId);
    if (!getConversationPermissions(role).canReply) {
      return res.status(403).json({ success: false, message: "You don't have permission to reply to conversations." });
    }

    if (conversation.status === "CLOSED") {
      return res.status(400).json({ success: false, message: "This conversation is closed. Reopen it before replying." });
    }

    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success: false, message: "text is required." });
    }
    if (text.length > 4000) {
      return res.status(400).json({ success: false, message: "Message is too long (max 4000 characters)." });
    }

    const botMessage = await saveAgentReply(conversation, requester, text.trim());

    await logAction(req, {
      action: "CONVERSATION_REPLY_SENT",
      resource: "Conversation",
      resourceId: `${conversation.companyId}/${conversation.visitorId}`,
      companyId: conversation.companyId,
      metadata: { length: text.length },
    });

    return res.status(201).json({
      success: true,
      message: { sender: "agent", type: "agent", agentName: requester.name, text: botMessage.text, createdAt: botMessage.createdAt },
    });
  } catch (error) {
    console.error("Post Agent Reply Error:", error);
    return res.status(500).json({ success: false, message: "Failed to send reply." });
  }
};

export const addNote = async (req, res) => {
  try {
    const conversation = await loadAuthorizedConversation(req, res);
    if (!conversation) return;

    const requester = req.adminUser;
    const role = await getCompanyRole(requester, conversation.companyId);
    if (!getConversationPermissions(role).canAddNotes) {
      return res.status(403).json({ success: false, message: "You don't have permission to add notes." });
    }

    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success: false, message: "text is required." });
    }

    await addConversationNote(conversation, requester, text.trim());

    await logAction(req, {
      action: "CONVERSATION_NOTE_ADDED",
      resource: "Conversation",
      resourceId: `${conversation.companyId}/${conversation.visitorId}`,
      companyId: conversation.companyId,
    });

    return res.status(201).json({ success: true, notes: conversation.notes });
  } catch (error) {
    console.error("Add Conversation Note Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add note." });
  }
};
