import mongoose from "mongoose";
import { TEST_MONGO_URI, assertLocalMongo } from "./testServer.mjs";
import Company from "../../models/company.model.js";
import Chatbot from "../../models/chatbot.model.js";

export async function connectTestDb() {
  assertLocalMongo();
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_MONGO_URI);
}

export async function resetDb() {
  assertLocalMongo();
  await mongoose.connection.db.dropDatabase();
}

export async function disconnectTestDb() {
  await mongoose.disconnect();
}

/** One company plus its chatbots. Returns lean-ish documents. */
export async function seedTenant({ companyId, isActive = true, chatbots = [] }) {
  const company = await Company.create({
    companyId,
    name: `${companyId} Inc`,
    domain: `${companyId}.test`,
    knowledgeFile: `${companyId}.txt`,
    isActive,
    status: isActive ? "ACTIVE" : "SUSPENDED",
  });
  const created = [];
  for (const b of chatbots) {
    created.push(
      await Chatbot.create({
        companyId,
        name: b.name,
        allowedDomains: b.allowedDomains || [],
        status: b.status || "LIVE",
        deletedAt: b.deletedAt || null,
        widgetEngineVersion: "v1",
      })
    );
  }
  return { company, chatbots: created };
}
