import mongoose from "mongoose";
import ChannelConnection from "../../models/channelConnection.model.js";
import Company from "../../models/company.model.js";
import User from "../../models/user.model.js";
import Visitor from "../../models/visitor.model.js";
import { decryptSecret } from "../../utils/encryption.js";
import { processInboundText } from "../../services/conversationPipeline.service.js";
import * as telegramProvider from "../../integrations/providers/telegram.provider.js";

// ======================================================
// PUBLIC TELEGRAM WEBHOOK RECEIVER (Phase 10)
// Route: POST /webhooks/telegram/:connectionId — deliberately NOT
// just a companyId/chatbotId in the URL (Section 30 explicitly warns
// against that as the only auth). The connectionId is an opaque
// Mongo ObjectId, and every request is additionally required to
// carry the exact secret_token Telegram was told to send back
// (X-Telegram-Bot-Api-Secret-Token) — the real mechanism Telegram's
// own API supports for this (Section 7), not an invented one.
//
// Never tested against the real Telegram API (no credentials exist
// in this environment — see Phase 10 report). This handler's own
// logic (secret verification, update normalization, pipeline
// invocation) IS live-tested with a realistic, Telegram-documented
// payload shape.
// ======================================================

export const handleTelegramWebhook = async (req, res) => {
  try {
    const { connectionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(connectionId)) {
      return res.status(404).end(); // never reveal whether an ID format is "close"
    }

    const connection = await ChannelConnection.findById(connectionId);
    if (!connection || connection.provider !== "telegram" || connection.status !== "CONNECTED" || !connection.credentialsEncrypted) {
      return res.status(404).end();
    }

    const { webhookSecretToken } = JSON.parse(decryptSecret(connection.credentialsEncrypted));

    const providedToken = req.headers["x-telegram-bot-api-secret-token"];
    if (!providedToken || providedToken !== webhookSecretToken) {
      // Deliberately generic — never confirms whether the connection
      // itself exists to an unauthenticated caller.
      return res.status(401).end();
    }

    const normalized = telegramProvider.normalizeUpdate(req.body);
    if (!normalized) {
      // Not a text message this MVP handles (e.g. a sticker, edited
      // message) — acknowledge so Telegram doesn't retry, do nothing.
      return res.status(200).end();
    }

    const company = await Company.findOne({ companyId: connection.companyId }).lean();
    if (!company) return res.status(200).end();

    // Mirrors chatbot.message.js's own division of labor: the caller
    // persists the visitor's inbound message; processInboundText only
    // persists the BOT's reply and conversation state.
    await User.create({ companyId: company.companyId, visitorId: normalized.visitorId, sender: "user", text: normalized.text });

    // Same upsert shape as /bot/v1/visitor (the website widget's own
    // visitor-tracking call) — so a Telegram visitor shows up in the
    // Phase 9 Visitors page too, not just Conversations. No
    // browser/os/page fields (don't apply to Telegram), `name` is the
    // one real signal Telegram provides.
    await Visitor.findOneAndUpdate(
      { companyId: company.companyId, visitorId: normalized.visitorId },
      {
        $inc: { totalMessages: 1 },
        $set: { lastVisit: new Date(), lastMessage: normalized.text, status: "online", ...(normalized.fromName && { name: normalized.fromName }) },
        $setOnInsert: { firstVisit: new Date() },
      },
      { upsert: true }
    );

    const { reply } = await processInboundText({
      company,
      visitorId: normalized.visitorId,
      text: normalized.text,
      language: company.ai?.language || "English",
      source: "telegram",
    });

    if (reply) {
      try {
        await telegramProvider.send({ connection: { credentialsEncrypted: connection.credentialsEncrypted }, chatId: normalized.chatId, text: reply });
      } catch (sendErr) {
        console.error("Telegram send failed:", sendErr.message);
      }
    }

    return res.status(200).end();
  } catch (error) {
    console.error("Telegram Webhook Error:", error);
    // Still 200 — Telegram will otherwise retry-storm a broken
    // handler; the error is already logged server-side.
    return res.status(200).end();
  }
};
