import Conversation from "../models/conversation.model.js";
import Bot from "../models/bot.model.js";
import { resolveSingleChatbotId } from "./chatbot.resolver.js";
import { emitDomainEvent } from "./realtime/io.js";
import { EVENTS } from "./realtime/events.js";

// ======================================================
// CONVERSATION SERVICE (Phase 8)
// The single place conversation state actually changes — used by
// both the public message pipeline (chatbot.message.js) and the
// admin Conversations API (controllers/admin/conversation.controller.js),
// so there is exactly one implementation of each lifecycle rule.
// ======================================================

/**
 * Gets or creates the one Conversation document for this visitor.
 * Never creates a duplicate — see the model's unique
 * {companyId, visitorId} index.
 */
export async function getOrCreateConversation(companyId, visitorId) {
  let conversation = await Conversation.findOne({ companyId, visitorId });
  if (conversation) return conversation;

  const chatbotId = await resolveSingleChatbotId(companyId);
  try {
    conversation = await Conversation.create({ companyId, chatbotId, visitorId });
  } catch (err) {
    // Race: two near-simultaneous first messages from the same new
    // visitor. The unique index rejects the second insert — just
    // re-read what the first one created instead of erroring.
    if (err.code === 11000) {
      conversation = await Conversation.findOne({ companyId, visitorId });
    } else {
      throw err;
    }
    return conversation;
  }

  emitDomainEvent(EVENTS.CONVERSATION_CREATED, {
    companyId,
    chatbotId: chatbotId || null,
    conversationId: visitorId,
    payload: { visitorId },
  });

  return conversation;
}

/**
 * Records that the visitor just sent a message — called for EVERY
 * incoming visitor turn regardless of mode. Reopens a closed
 * conversation (a visitor messaging again after close always
 * resumes in AI mode — a human isn't presumed still present once a
 * thread was explicitly closed; an agent must take over again if
 * needed, same as a brand-new conversation would start in AI mode).
 */
export async function ingestVisitorMessage(conversation, text) {
  const wasClosed = conversation.status === "CLOSED";

  conversation.status = "OPEN";
  if (wasClosed) {
    conversation.mode = "AI";
    conversation.closedAt = null;
    conversation.closedBy = null;
  }

  conversation.lastMessageAt = new Date();
  conversation.lastVisitorMessageAt = conversation.lastMessageAt;
  conversation.lastMessagePreview = String(text || "").slice(0, 300);
  conversation.lastSender = "visitor";
  conversation.unreadCount += 1;

  await conversation.save();

  emitDomainEvent(EVENTS.MESSAGE_CREATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { sender: "visitor", preview: conversation.lastMessagePreview },
  });
  emitDomainEvent(EVENTS.CONVERSATION_UPDATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { changedFields: ["status", "lastMessageAt", "lastSender", "unreadCount"] },
  });

  return conversation;
}

/**
 * Records a bot/system/AI reply's effect on the conversation without
 * touching message content (that already lives in Bot). Call this
 * once per successful reply, right before the response is sent.
 */
export async function touchConversationAfterAiReply(conversation, { text, isHandoff = false, handoffReason = null }) {
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = String(text || "").slice(0, 300);
  conversation.lastSender = "ai";

  if (isHandoff && conversation.mode !== "HUMAN") {
    conversation.mode = "HUMAN";
    conversation.status = "OPEN";
    conversation.handoffAt = new Date();
    conversation.handoffReason = handoffReason;
  }

  await conversation.save();

  emitDomainEvent(EVENTS.MESSAGE_CREATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { sender: "ai", preview: conversation.lastMessagePreview },
  });
  emitDomainEvent(EVENTS.CONVERSATION_UPDATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: {
      changedFields: isHandoff
        ? ["mode", "status", "handoffAt", "handoffReason", "lastMessageAt"]
        : ["lastMessageAt", "lastSender"],
      handoff: isHandoff,
    },
  });

  return conversation;
}

/**
 * The conversation is already in HUMAN mode — this is the message
 * pipeline's short-circuit path (no AI, no flow, no webhook). Finds
 * any agent replies sent since the visitor's previous message and
 * hands them back so the widget can display them on this response,
 * since the widget has no push/pull channel of its own (see Phase 8
 * report, "Known Limitations — no live push to the visitor").
 */
export async function getPendingAgentReplySince(conversation, sinceDate) {
  const agentMessages = await Bot.find({
    companyId: conversation.companyId,
    visitorId: conversation.visitorId,
    type: "agent",
    createdAt: { $gt: sinceDate || conversation.startedAt },
  })
    .sort({ createdAt: 1 })
    .lean();

  if (agentMessages.length === 0) return null;
  return agentMessages.map((m) => m.text).join("\n\n");
}

export function getConversationPermissions(role) {
  const isSuperOrCompanyAdmin = role === "SUPER_ADMIN" || role === "COMPANY_ADMIN";
  const isAgent = role === "AGENT";
  return {
    canReply: isSuperOrCompanyAdmin || isAgent,
    canTakeOver: isSuperOrCompanyAdmin || isAgent,
    canReturnToAI: isSuperOrCompanyAdmin || isAgent,
    canClose: isSuperOrCompanyAdmin || isAgent,
    canReopen: isSuperOrCompanyAdmin || isAgent,
    canAddNotes: isSuperOrCompanyAdmin || isAgent,
    // Assigning to someone ELSE (not yourself via Take Over) is a
    // company-admin-level action — an AGENT can still self-assign
    // via takeOver, just not hand work to a different agent.
    canAssignOthers: isSuperOrCompanyAdmin,
  };
}

export async function takeOverConversation(conversation, adminUser) {
  conversation.mode = "HUMAN";
  conversation.status = conversation.status === "CLOSED" ? "OPEN" : conversation.status;
  conversation.assignedTo = adminUser._id;
  if (!conversation.handoffAt) {
    conversation.handoffAt = new Date();
    conversation.handoffReason = "manual";
  }
  await conversation.save();

  emitDomainEvent(EVENTS.CONVERSATION_ASSIGNED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { assignedTo: adminUser._id.toString(), changedFields: ["mode", "status", "assignedTo"] },
  });

  return conversation;
}

export async function returnToAiConversation(conversation) {
  conversation.mode = "AI";
  // assignedTo is deliberately left as-is — the agent stays
  // accountable/visible in the "assigned to me" filter even though
  // AI is answering again, rather than silently losing that history.
  await conversation.save();

  emitDomainEvent(EVENTS.CONVERSATION_UPDATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { changedFields: ["mode"] },
  });

  return conversation;
}

export async function closeConversation(conversation, adminUser) {
  conversation.status = "CLOSED";
  conversation.closedAt = new Date();
  conversation.closedBy = adminUser._id;
  await conversation.save();

  emitDomainEvent(EVENTS.CONVERSATION_CLOSED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { changedFields: ["status", "closedAt", "closedBy"] },
  });

  return conversation;
}

export async function reopenConversation(conversation) {
  conversation.status = "OPEN";
  conversation.closedAt = null;
  conversation.closedBy = null;
  // Unlike a visitor-triggered reopen, an explicit admin reopen keeps
  // whatever mode it already had — the admin opening it back up is
  // presumed to want to keep handling it themselves if it was HUMAN.
  await conversation.save();

  emitDomainEvent(EVENTS.CONVERSATION_UPDATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { changedFields: ["status", "closedAt", "closedBy"] },
  });

  return conversation;
}

export async function assignConversation(conversation, agentAdminUser) {
  conversation.assignedTo = agentAdminUser ? agentAdminUser._id : null;
  await conversation.save();

  emitDomainEvent(EVENTS.CONVERSATION_ASSIGNED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: {
      assignedTo: agentAdminUser ? agentAdminUser._id.toString() : null,
      changedFields: ["assignedTo"],
    },
  });

  return conversation;
}

export async function addConversationNote(conversation, adminUser, text) {
  conversation.notes.push({ authorId: adminUser._id, authorName: adminUser.name, text });
  await conversation.save();
  return conversation;
}

export async function markConversationRead(conversation) {
  if (conversation.unreadCount !== 0) {
    conversation.unreadCount = 0;
    await conversation.save();
  }
  return conversation;
}

export async function saveAgentReply(conversation, adminUser, text) {
  const botMessage = await Bot.create({
    companyId: conversation.companyId,
    visitorId: conversation.visitorId,
    sender: "bot",
    type: "agent",
    agentId: adminUser._id,
    agentName: adminUser.name,
    text,
  });

  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = text.slice(0, 300);
  conversation.lastSender = "agent";
  if (conversation.mode !== "HUMAN") conversation.mode = "HUMAN";
  await conversation.save();

  emitDomainEvent(EVENTS.MESSAGE_CREATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { sender: "agent", preview: conversation.lastMessagePreview },
  });
  emitDomainEvent(EVENTS.CONVERSATION_UPDATED, {
    companyId: conversation.companyId,
    chatbotId: conversation.chatbotId,
    conversationId: conversation.visitorId,
    payload: { changedFields: ["lastMessageAt", "lastSender", "mode"] },
  });

  return botMessage;
}
