import Bot from "../models/bot.model.js";
import User from "../models/user.model.js";
import Visitor from "../models/visitor.model.js";
import mammoth from "mammoth";
import XLSX from "xlsx";

import { askGroq } from "../services/groq.service.js";
import { needsHumanHandoff } from "../services/handoff.service.js";
import { getChatbotAvailability } from "../services/chatbotStatus.service.js";
import { resolvePublishedFlow } from "../services/flow/flow.resolver.js";
import { executeTurn, FlowRuntimeError } from "../services/flow/flow.executor.js";
import {
  getOrCreateConversation,
  ingestVisitorMessage,
  touchConversationAfterAiReply,
  getPendingAgentReplySince,
} from "../services/conversation.service.js";
import { assertSafeWebhookUrl } from "../services/flow/flow.security.js";
import { decryptSecret } from "../utils/encryption.js";
import { dispatchWebhookEvent } from "../services/webhookDispatch.service.js";
import { dispatchDeveloperWebhooks } from "../services/developerWebhookDispatch.service.js";
import crypto from "crypto";
//hello
import axios from "axios";

export const Message = async (req, res) => {
  try {
    const { text = "", language: requestedLanguage, visitorId } = req.body;
const file = req.file;
    const company = req.company;

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    // Phase 7: honor the company's configured default language when
    // the widget doesn't send one, instead of always hardcoding
    // "English". Both real companies already have ai.language
    // explicitly set to "English" today, so this is a no-op for them.
    const language = requestedLanguage || company.ai?.language || "English";

    const companyId = company.companyId;
// Allow either text OR file
if ((!text || !text.trim()) && !file) {
  return res.status(400).json({
    success: false,
    message: "Please enter a message or upload a file.",
  });
}

console.log("TEXT :", text);
console.log("FILE :", file?.originalname);
console.log("MIME :", file?.mimetype);

    // =========================
    // Visitor Analytics
    // =========================

    if (visitorId) {
      await Visitor.findOneAndUpdate(
        {
          companyId,
          visitorId,
        },
        {
          $inc: {
            totalMessages: 1,
          },
          $set: {
            lastVisit: new Date(),
            lastMessage: text,
            status: "online",
          },
        },
        {
          new: true,
        }
      );
    }

    // =========================
    // Save User Message
    // =========================

   const userMessage = await User.create({
  companyId,
  visitorId,
  sender: "user",
  text:
    text && text.trim()
      ? text
      : `[Uploaded ${file?.originalname || "file"}]`,
});

    // =========================
    // Chatbot Availability
    // (only applies once an admin has migrated this company into
    // the admin panel — see services/chatbotStatus.service.js)
    // =========================

    const availability = await getChatbotAvailability(companyId);

    if (availability.blocked) {
      const maintenanceMessage =
        availability.reason === "offline"
          ? "This assistant is currently offline. Please check back soon."
          : "This assistant is temporarily paused. Please check back soon.";

      await Bot.create({
        companyId,
        visitorId,
        sender: "bot",
        type: "system",
        text: maintenanceMessage,
      });

      return res.status(200).json({
        success: true,
        userMessage: userMessage.text,
        botMessage: maintenanceMessage,
      });
    }

    // =========================
    // Conversation state (Phase 8)
    // A conversation already in HUMAN mode must never receive an
    // automatic reply from ANY of the systems below — flow engine,
    // keyword handoff, webhook, or Groq. This check runs before all
    // of them for exactly that reason. The widget has no push
    // channel of its own (see conversation.service.js
    // getPendingAgentReplySince), so a visitor's own next message is
    // what delivers any agent reply that was waiting.
    // =========================

    const conversation = await getOrCreateConversation(companyId, visitorId);
    const previousVisitorMessageAt = conversation.lastVisitorMessageAt;
    // A brand-new document's createdAt/updatedAt are set to the same
    // instant by Mongoose; any subsequent .save() (ingestVisitorMessage
    // etc.) moves updatedAt forward. Checked here, before this turn's
    // first save, so it reliably distinguishes "just created" from
    // "already existed" without changing getOrCreateConversation's
    // return shape for its other callers.
    const conversationWasCreated = conversation.createdAt.getTime() === conversation.updatedAt.getTime();

    if (conversationWasCreated) {
      dispatchWebhookEvent(company, "conversation.created", {
        chatbotId: conversation.chatbotId,
        conversationId: conversation._id,
        visitorId,
      });
      dispatchDeveloperWebhooks(companyId, conversation.chatbotId, "conversation.created", {
        chatbotId: conversation.chatbotId,
        conversationId: conversation._id,
        visitorId,
      });
    }
    dispatchWebhookEvent(company, "conversation.message", {
      chatbotId: conversation.chatbotId,
      conversationId: conversation._id,
      visitorId,
      sender: "visitor",
      text,
    });
    dispatchDeveloperWebhooks(companyId, conversation.chatbotId, "conversation.message", {
      chatbotId: conversation.chatbotId,
      conversationId: conversation._id,
      visitorId,
      sender: "visitor",
      text,
    });

    if (conversation.mode === "HUMAN") {
      await ingestVisitorMessage(conversation, text);

      const pendingReply = await getPendingAgentReplySince(conversation, previousVisitorMessageAt);
      const botMessage =
        pendingReply || "Your message has been received. Our team will reply here shortly.";

      return res.status(200).json({
        success: true,
        userMessage: userMessage.text,
        botMessage,
        mode: "HUMAN",
      });
    }

    await ingestVisitorMessage(conversation, text);

    // =========================
    // Flow Engine (Phase 6, opt-in)
    // Only a chatbot with an explicitly PUBLISHED flow is ever routed
    // here — every other company/chatbot (including both real
    // production ones today) falls straight through to the unchanged
    // legacy pipeline below. Any unexpected runtime error is caught
    // and safely falls back to that same legacy pipeline for this
    // one turn, leaving flow session state untouched so the next
    // message can retry cleanly.
    // =========================

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
          await Bot.create({
            companyId,
            visitorId,
            sender: "bot",
            type: "flow",
            text: flowResult.reply,
          });

          const wasHandoff = flowResult.status === "HANDED_OFF";
          await touchConversationAfterAiReply(conversation, {
            text: flowResult.reply,
            isHandoff: wasHandoff,
            handoffReason: "flow_node",
          });
          if (wasHandoff) {
            dispatchWebhookEvent(company, "conversation.handoff", {
              chatbotId: conversation.chatbotId,
              conversationId: conversation._id,
              visitorId,
              reason: "flow_node",
            });
            dispatchDeveloperWebhooks(companyId, conversation.chatbotId, "conversation.handoff", {
              chatbotId: conversation.chatbotId,
              conversationId: conversation._id,
              visitorId,
              reason: "flow_node",
            });
          }

          return res.status(200).json({
            success: true,
            userMessage: userMessage.text,
            botMessage: flowResult.reply,
          });
        }
        // flowResult === null (e.g. session was HANDED_OFF) -> fall
        // through to the legacy pipeline below on purpose.
      } catch (err) {
        if (err instanceof FlowRuntimeError) {
          console.error(`Flow runtime error for chatbot ${resolvedFlow.chatbotId}:`, err.message);
        } else {
          console.error("Flow Engine Error:", err);
        }
        // Fall through to the legacy pipeline below.
      }
    }

    // =========================
    // Human Handoff
    // =========================

    if (text && needsHumanHandoff(text)) {
      const handoffMessage = `Sure! Our team will be happy to assist you.

📞 Call:
${company.contact?.phone || "Not Available"}

💬 WhatsApp:
${company.contact?.whatsapp || "Not Available"}

📧 Email:
${company.contact?.email || "Not Available"}
`;

     await Bot.create({
  companyId,
  visitorId,
  sender: "bot",
  type: "handoff",
  text: handoffMessage,
});

      await touchConversationAfterAiReply(conversation, {
        text: handoffMessage,
        isHandoff: true,
        handoffReason: "keyword",
      });
      dispatchWebhookEvent(company, "conversation.handoff", {
        chatbotId: conversation.chatbotId,
        conversationId: conversation._id,
        visitorId,
        reason: "keyword",
      });
      dispatchDeveloperWebhooks(companyId, conversation.chatbotId, "conversation.handoff", {
        chatbotId: conversation.chatbotId,
        conversationId: conversation._id,
        visitorId,
        reason: "keyword",
      });

      return res.status(200).json({
        success: true,
        userMessage: userMessage.text,
        botMessage: handoffMessage,
      });
    }

    // =========================
    // Company Webhook (reply delegation)
    // Phase 10 fix: this previously read `company.ai?.webhookUrl`, a
    // field that has never existed anywhere in the Company schema —
    // meaning this entire feature (configurable and testable in the
    // admin panel since Company.webhook was added, per
    // testCompanyWebhook's identical payload shape) has never
    // actually fired in production. Neither real company has
    // webhook.enabled set today, so this fix is a zero-behavior-
    // change no-op for them and a genuine bug fix for anyone who
    // configures one going forward. Now SSRF-protected and HMAC-
    // signed like every other outbound webhook call in this codebase.
    // =========================

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
          await Bot.create({
  companyId,
  visitorId,
  sender: "bot",
  text: webhook.data.reply,
});
          await touchConversationAfterAiReply(conversation, { text: webhook.data.reply });
          return res.status(200).json({
            success: true,
            userMessage: userMessage.text,
            botMessage: webhook.data.reply,
          });
        }
      } catch (err) {
        console.log("Webhook failed. Falling back to Groq...");
      }
    }

let imageBase64 = null;
let extractedText = "";

if (file) {
  const mime = file.mimetype;

  // ===========================
  // IMAGE
  // ===========================
  if (mime.startsWith("image/")) {
    imageBase64 = `data:${mime};base64,${file.buffer.toString("base64")}`;
  }

  // ===========================
// PDF
// Loaded lazily so a Node version that can't satisfy pdfjs-dist's
// browser-API polyfills (e.g. Node < 22, missing DOMMatrix) only
// affects PDF uploads, not server startup or every other feature.
// ===========================
else if (mime === "application/pdf") {
  try {
    // Phase 14 fix — see utils/extractKnowledgeFileText.js for the
    // full explanation: pdfjs-dist needs these globals to exist (but
    // never actually calls them) for pure text extraction under
    // Node < 22. Confirmed live: this path silently produced the
    // catch-block fallback message below for every real PDF upload
    // before this fix, and extracts real text after it.
    if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = class DOMMatrix {};
    if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = class Path2D {};
    if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = class ImageData {};

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(file.buffer),
    });

    const pdf = await loadingTask.promise;

    let pdfText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);

      const content = await page.getTextContent();

      pdfText +=
        content.items
          .map((item) => item.str)
          .join(" ") + "\n";
    }

    extractedText = pdfText;
  } catch (pdfError) {
    console.error("PDF Parsing Error:", pdfError.message);
    extractedText = `The user uploaded a PDF named "${file.originalname}" but it could not be read on this server. Ask the user what they'd like to know about it.`;
  }
}

  // ===========================
  // DOCX
  // ===========================
  else if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({
      buffer: file.buffer,
    });

    extractedText = result.value;
  }

  // ===========================
  // TXT
  // ===========================
  else if (mime === "text/plain") {
    extractedText = file.buffer.toString("utf8");
  }

  // ===========================
  // EXCEL
  // ===========================
  else if (
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    const workbook = XLSX.read(file.buffer, {
      type: "buffer",
    });

    workbook.SheetNames.forEach((sheet) => {
      const rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[sheet],
        {
          header: 1,
        }
      );

      extractedText += `\nSheet: ${sheet}\n`;

      rows.forEach((row) => {
        extractedText += row.join(" | ") + "\n";
      });
    });
  }

  // ===========================
// PPT / PPTX
// ===========================
else if (
  mime === "application/vnd.ms-powerpoint" ||
  mime ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
) {
  extractedText = `The user uploaded a PowerPoint file named "${file.originalname}". I cannot extract slide text yet, but answer based on the user's request.`;
}

// ===========================
// VIDEO
// ===========================
else if (mime.startsWith("video/")) {
  extractedText = `The user uploaded a video named "${file.originalname}". I cannot watch videos yet. Ask the user what they want to know about it.`;
}

// ===========================
// AUDIO
// ===========================
else if (mime.startsWith("audio/")) {
  extractedText = `The user uploaded an audio file named "${file.originalname}". I cannot transcribe audio yet. Ask the user what they need.`;
}

// ===========================
// OTHER FILES
// ===========================
else {
  extractedText = `The user uploaded a file named "${file.originalname}" of type "${mime}".`;
}
}

    // =========================
    // Groq AI
    // =========================

    if (extractedText.length > 15000) {
  extractedText = extractedText.substring(0, 15000);
}

  let finalMessage = text || "";

if (extractedText) {
  finalMessage += `

Attached File Content:

${extractedText}`;
}

if (!finalMessage.trim() && file) {
  finalMessage = `User uploaded a file named "${file.originalname}". Please analyze it.`;
}

// =========================
// Conversation History
// =========================

// Fetch recent messages
const userHistory = await User.find({
  companyId,
  visitorId,
})
  .sort({ createdAt: -1 })
  .limit(8)
  .lean();

const botHistory = await Bot.find({
  companyId,
  visitorId,
})
  .sort({ createdAt: -1 })
  .limit(8)
  .lean();

const history = [...userHistory, ...botHistory]
  .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  .filter((msg) => String(msg._id) !== String(userMessage._id))
  .map((msg) => ({
    sender: msg.sender,
    text: msg.text,
  }));

// Ask AI
const aiReply = await askGroq({
  company,
  message: finalMessage,
  language,
  image: imageBase64,
  history,
  chatbotId: conversation.chatbotId,
});

// Save bot reply
await Bot.create({
  companyId,
  visitorId,
  sender: "bot",
  text: aiReply,
});

await touchConversationAfterAiReply(conversation, { text: aiReply });

return res.status(200).json({
  success: true,
  userMessage: userMessage.text,
  botMessage: aiReply,
});
} catch (error) {
  console.error("Message Controller Error:", error);

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: error.message,
  });
}
};