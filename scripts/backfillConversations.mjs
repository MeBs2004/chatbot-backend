// One-time, additive, idempotent backfill (Phase 8).
// Creates a Conversation record for every existing Visitor that has
// exchanged at least one message but doesn't have one yet — derived
// from the same signal the OLD conversation.controller.js already
// used on the fly (most recent Bot.type). Never deletes or modifies
// Visitor/User/Bot data. Safe to re-run: existing Conversation docs
// are left untouched (upsert-if-missing only).
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const Visitor = (await import("../models/visitor.model.js")).default;
const Bot = (await import("../models/bot.model.js")).default;
const Conversation = (await import("../models/conversation.model.js")).default;
const { resolveSingleChatbotId } = await import("../services/chatbot.resolver.js");

await mongoose.connect(process.env.MONGO_URI);

const visitors = await Visitor.find({ totalMessages: { $gt: 0 } }).lean();
console.log(`Found ${visitors.length} visitors with messages.`);

const chatbotIdCache = new Map();
let created = 0;
let skipped = 0;

for (const visitor of visitors) {
  const existing = await Conversation.findOne({ companyId: visitor.companyId, visitorId: visitor.visitorId }).select("_id").lean();
  if (existing) {
    skipped += 1;
    continue;
  }

  if (!chatbotIdCache.has(visitor.companyId)) {
    chatbotIdCache.set(visitor.companyId, await resolveSingleChatbotId(visitor.companyId));
  }
  const chatbotId = chatbotIdCache.get(visitor.companyId);

  const lastBotMessage = await Bot.findOne({ companyId: visitor.companyId, visitorId: visitor.visitorId })
    .sort({ createdAt: -1 })
    .lean();

  const isHandoff = lastBotMessage?.type === "handoff";

  await Conversation.create({
    companyId: visitor.companyId,
    chatbotId,
    visitorId: visitor.visitorId,
    status: "OPEN",
    mode: isHandoff ? "HUMAN" : "AI",
    handoffAt: isHandoff ? lastBotMessage.createdAt : null,
    handoffReason: isHandoff ? "keyword" : null,
    startedAt: visitor.firstVisit || visitor.createdAt,
    lastMessageAt: visitor.lastVisit || visitor.updatedAt,
    lastMessagePreview: (visitor.lastMessage || "").slice(0, 300),
    lastSender: lastBotMessage ? (lastBotMessage.type === "agent" ? "agent" : "ai") : "visitor",
    unreadCount: 0,
  });
  created += 1;
}

console.log(`Created ${created} Conversation record(s), skipped ${skipped} already-existing.`);
await mongoose.disconnect();
