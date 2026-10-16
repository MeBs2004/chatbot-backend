// One-time, idempotent migration for chatbot-scoped access.
//
//   node scripts/migrateChatbotScopedAccess.mjs           # dry run — reports only
//   node scripts/migrateChatbotScopedAccess.mjs --apply   # writes
//
// 1. ChatbotAccess.companyId      ← the chatbot's company.
// 2. A user with ChatbotAccess rows but NO UserCompanyAccess for that
//    company (previously: could open the chatbot but held no
//    permissions) gets a CHATBOTS-scoped VIEWER row, so they keep
//    seeing exactly those chatbots, read-only. Upgrade their role in
//    the admin panel if they need more.
// 3. Conversation.chatbotId       ← the company's only chatbot, where
//    still null and unambiguous.
// 4. Visitor/User/Bot .chatbotId  ← their conversation's chatbotId.
// 5. Reports any CHATBOTS-scoped COMPANY_ADMIN row (must not exist).
//
// Never deletes anything and never overwrites a chatbotId that's
// already set. Safe to re-run.
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const APPLY = process.argv.includes("--apply");

const AdminUser = (await import("../models/adminUser.model.js")).default;
const Chatbot = (await import("../models/chatbot.model.js")).default;
const ChatbotAccess = (await import("../models/chatbotAccess.model.js")).default;
const UserCompanyAccess = (await import("../models/userCompanyAccess.model.js")).default;
const Conversation = (await import("../models/conversation.model.js")).default;
const Visitor = (await import("../models/visitor.model.js")).default;
const UserMessage = (await import("../models/user.model.js")).default;
const Bot = (await import("../models/bot.model.js")).default;
const { resolveSingleChatbotId } = await import("../services/chatbot.resolver.js");

await mongoose.connect(process.env.MONGO_URI);
console.log(APPLY ? "APPLYING changes." : "DRY RUN — pass --apply to write.");

// Builds the new indexes declared on the models (create-only — never
// drops an existing index).
if (APPLY) {
  for (const model of [ChatbotAccess, UserCompanyAccess, Visitor, UserMessage, Bot]) {
    await model.createIndexes();
  }
  console.log("Indexes synced.");
}

// ---- 1 + 2: ChatbotAccess.companyId, orphaned chatbot grants --------
const accessRows = await ChatbotAccess.find({}).lean();
const chatbots = await Chatbot.find({ _id: { $in: accessRows.map((a) => a.chatbotId) } })
  .select("_id companyId")
  .lean();
const chatbotCompany = new Map(chatbots.map((c) => [String(c._id), c.companyId]));

let companyIdBackfilled = 0;
const orphanGrants = new Map(); // `${userId}::${companyId}` -> { userId, companyId }

for (const row of accessRows) {
  const companyId = chatbotCompany.get(String(row.chatbotId));
  if (!companyId) continue; // chatbot gone — row is inert

  if (row.companyId !== companyId) {
    companyIdBackfilled += 1;
    if (APPLY) await ChatbotAccess.updateOne({ _id: row._id }, { companyId });
  }

  const hasCompanyRow = await UserCompanyAccess.exists({ userId: row.userId, companyId });
  if (!hasCompanyRow) orphanGrants.set(`${row.userId}::${companyId}`, { userId: row.userId, companyId });
}
console.log(`ChatbotAccess.companyId to backfill: ${companyIdBackfilled}`);

let scopedRowsCreated = 0;
for (const { userId, companyId } of orphanGrants.values()) {
  const user = await AdminUser.findById(userId).select("email role").lean();
  if (!user || user.role === "SUPER_ADMIN") continue;
  console.log(`  chatbot-scoped VIEWER: ${user.email} in ${companyId}`);
  scopedRowsCreated += 1;
  if (APPLY) {
    await UserCompanyAccess.create({ userId, companyId, role: "VIEWER", accessScope: "CHATBOTS", status: "ACTIVE" });
  }
}
console.log(`Chatbot-scoped access rows to create: ${scopedRowsCreated}`);

// ---- 3: unattributed conversations --------------------------------
const singleBotCache = new Map();
const unattributed = await Conversation.find({ chatbotId: null }).select("_id companyId").lean();
let conversationsAttributed = 0;
for (const c of unattributed) {
  if (!singleBotCache.has(c.companyId)) singleBotCache.set(c.companyId, await resolveSingleChatbotId(c.companyId));
  const chatbotId = singleBotCache.get(c.companyId);
  if (!chatbotId) continue;
  conversationsAttributed += 1;
  if (APPLY) await Conversation.updateOne({ _id: c._id, chatbotId: null }, { chatbotId });
}
console.log(`Conversations to attribute to their company's only chatbot: ${conversationsAttributed} (of ${unattributed.length} unattributed)`);

// ---- 4: visitors + messages from their conversation ---------------
const BATCH = 500;
let visitorOps = [];
let messageOps = [];
let conversationsScanned = 0;

async function flush() {
  if (!APPLY) return;
  if (visitorOps.length) await Visitor.bulkWrite(visitorOps, { ordered: false });
  if (messageOps.length) {
    await UserMessage.bulkWrite(messageOps, { ordered: false });
    await Bot.bulkWrite(messageOps, { ordered: false });
  }
}

const cursor = Conversation.find({ chatbotId: { $ne: null } }).select("companyId visitorId chatbotId").lean().cursor();
for await (const c of cursor) {
  conversationsScanned += 1;
  const filter = { companyId: c.companyId, visitorId: c.visitorId, chatbotId: null };
  visitorOps.push({ updateOne: { filter, update: { $set: { chatbotId: c.chatbotId } } } });
  messageOps.push({ updateMany: { filter, update: { $set: { chatbotId: c.chatbotId } } } });
  if (visitorOps.length >= BATCH) {
    await flush();
    visitorOps = [];
    messageOps = [];
  }
}
await flush();
console.log(`Attributed conversations whose visitor + messages get a chatbotId: ${conversationsScanned}`);

// ---- 5: invariant check -------------------------------------------
const badRows = await UserCompanyAccess.countDocuments({ accessScope: "CHATBOTS", role: "COMPANY_ADMIN" });
if (badRows > 0) {
  console.warn(`WARNING: ${badRows} chatbot-scoped COMPANY_ADMIN row(s) exist — change their role or scope.`);
} else {
  console.log("Invariant OK: no chatbot-scoped COMPANY_ADMIN rows.");
}

await mongoose.disconnect();
console.log("Done.");
