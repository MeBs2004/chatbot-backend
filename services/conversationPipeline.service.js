import User from "../models/user.model.js";
import Bot from "../models/bot.model.js";
import { askGroq } from "./groq.service.js";
import { needsHumanHandoff } from "./handoff.service.js";
import { getChatbotAvailability } from "./chatbotStatus.service.js";
import { resolvePublishedFlow } from "./flow/flow.resolver.js";
import { executeTurn, FlowRuntimeError } from "./flow/flow.executor.js";
import { assertSafeWebhookUrl } from "./flow/flow.security.js";
import { decryptSecret } from "../utils/encryption.js";
import { dispatchWebhookEvent } from "./webhookDispatch.service.js";
import {
  getOrCreateConversation,
  ingestVisitorMessage,
  touchConversationAfterAiReply,
  getPendingAgentReplySince,
} from "./conversation.service.js";
import axios from "axios";
import crypto from "crypto";

// ======================================================
// CONVERSATION PIPELINE (Phase 10)
// A channel-agnostic version of the exact turn-processing sequence
// `controllers/chatbot.message.js` runs for the website widget:
// availability -> conversation/human-mode -> flow engine -> keyword
// handoff -> company webhook -> Groq fallback. Built so a new
// channel (Telegram) reuses the REAL flow engine, conversation
// service, and AI service — not a second copy of this business logic
// — while `chatbot.message.js` itself stays completely untouched
// beyond Phase 10's one-line webhook-field bug fix.
//
// Deliberately NOT reused by chatbot.message.js itself: that file
// also handles multipart file uploads and image analysis, which are
// website-widget-specific concerns this function doesn't need to
// carry. See Phase 10 report, "Architecture", for why this is a
// parallel entry point rather than a shared-and-refactored one — a
// conservative choice given zero tolerance for regressing the two
// real production chatbots.
//
// Returns { reply, conversation } — never persists the VISITOR's own
// message (callers already have their own visitor-message record,
// e.g. a Telegram update); it only persists the BOT's reply and
// updates conversation state, matching chatbot.message.js's own
// division of responsibility (caller creates the User doc, this
// layer creates the Bot doc).
// ======================================================

export async function processInboundText({ company, visitorId, text, language = "English", source = "widget" }) {
  const companyId = company.companyId;

  const availability = await getChatbotAvailability(companyId);
  if (availability.blocked) {
    const maintenanceMessage =
      availability.reason === "offline"
        ? "This assistant is currently offline. Please check back soon."
        : "This assistant is temporarily paused. Please check back soon.";
    await Bot.create({ companyId, visitorId, sender: "bot", type: "system", text: maintenanceMessage });
    return { reply: maintenanceMessage };
  }

  const conversation = await getOrCreateConversation(companyId, visitorId);
  const conversationWasCreated = conversation.createdAt.getTime() === conversation.updatedAt.getTime();
  if (conversation.source === "widget" && source !== "widget") {
    // A conversation only ever gets its source relabeled away from
    // the generic default once, on first contact from a real
    // non-widget channel — never overwrites an already-set channel.
    conversation.source = source;
  }
  const previousVisitorMessageAt = conversation.lastVisitorMessageAt;

  if (conversationWasCreated) {
    dispatchWebhookEvent(company, "conversation.created", { chatbotId: conversation.chatbotId, conversationId: conversation._id, visitorId });
  }
  dispatchWebhookEvent(company, "conversation.message", { chatbotId: conversation.chatbotId, conversationId: conversation._id, visitorId, sender: "visitor", text });

  if (conversation.mode === "HUMAN") {
    await ingestVisitorMessage(conversation, text);
    const pendingReply = await getPendingAgentReplySince(conversation, previousVisitorMessageAt);
    return {
      reply: pendingReply || "Your message has been received. Our team will reply here shortly.",
      conversation,
    };
  }

  await ingestVisitorMessage(conversation, text);

  const resolvedFlow = await resolvePublishedFlow(companyId);
  if (resolvedFlow) {
    try {
      const flowResult = await executeTurn({
        company,
        chatbotId: resolvedFlow.chatbotId,
        flow: resolvedFlow.flow,
        visitorId,
        incomingText: text,
        language,
      });

      if (flowResult) {
        await Bot.create({ companyId, visitorId, sender: "bot", type: "flow", text: flowResult.reply });
        const wasHandoff = flowResult.status === "HANDED_OFF";
        await touchConversationAfterAiReply(conversation, { text: flowResult.reply, isHandoff: wasHandoff, handoffReason: "flow_node" });
        if (wasHandoff) {
          dispatchWebhookEvent(company, "conversation.handoff", {
            chatbotId: conversation.chatbotId,
            conversationId: conversation._id,
            visitorId,
            reason: "flow_node",
          });
        }
        return { reply: flowResult.reply, conversation };
      }
    } catch (err) {
      if (err instanceof FlowRuntimeError) {
        console.error(`Flow runtime error for chatbot ${resolvedFlow.chatbotId}:`, err.message);
      } else {
        console.error("Flow Engine Error:", err);
      }
    }
  }

  if (text && needsHumanHandoff(text)) {
    const handoffMessage = `Sure! Our team will be happy to assist you.\n\n📞 Call:\n${company.contact?.phone || "Not Available"}\n\n💬 WhatsApp:\n${company.contact?.whatsapp || "Not Available"}\n\n📧 Email:\n${company.contact?.email || "Not Available"}\n`;

    await Bot.create({ companyId, visitorId, sender: "bot", type: "handoff", text: handoffMessage });
    await touchConversationAfterAiReply(conversation, { text: handoffMessage, isHandoff: true, handoffReason: "keyword" });
    dispatchWebhookEvent(company, "conversation.handoff", {
      chatbotId: conversation.chatbotId,
      conversationId: conversation._id,
      visitorId,
      reason: "keyword",
    });
    return { reply: handoffMessage, conversation };
  }

  if (company.webhook?.enabled && company.webhook?.url) {
    try {
      await assertSafeWebhookUrl(company.webhook.url);
      const payload = { companyId, visitorId, message: text, language };
      const headers = {};
      if (company.webhook.secretEncrypted) {
        try {
          const secret = decryptSecret(company.webhook.secretEncrypted);
          if (secret) headers["X-Nuformly-Signature"] = `sha256=${crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex")}`;
        } catch (decryptErr) {
          console.error("Webhook secret decryption failed:", decryptErr.message);
        }
      }
      const webhook = await axios.post(company.webhook.url, payload, { headers, timeout: 8000 });
      if (webhook.data?.reply) {
        await Bot.create({ companyId, visitorId, sender: "bot", text: webhook.data.reply });
        await touchConversationAfterAiReply(conversation, { text: webhook.data.reply });
        return { reply: webhook.data.reply, conversation };
      }
    } catch {
      // Falls through to Groq, same as chatbot.message.js.
    }
  }

  const [userHistory, botHistory] = await Promise.all([
    User.find({ companyId, visitorId }).sort({ createdAt: -1 }).limit(8).lean(),
    Bot.find({ companyId, visitorId }).sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  const history = [...userHistory, ...botHistory]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((msg) => ({ sender: msg.sender, text: msg.text }));

  const aiReply = await askGroq({ company, message: text, language, history, chatbotId: conversation.chatbotId });
  await Bot.create({ companyId, visitorId, sender: "bot", text: aiReply });
  await touchConversationAfterAiReply(conversation, { text: aiReply });

  return { reply: aiReply, conversation };
}
