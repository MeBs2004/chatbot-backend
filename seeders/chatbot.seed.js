import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Company from "../models/company.model.js";
import Chatbot from "../models/chatbot.model.js";

/**
 * Backfills a Chatbot admin record for every existing Company that
 * doesn't have one yet, using that company's current chatbot/ai
 * config. Status is set to LIVE so this is a no-op for the public
 * chat pipeline (see services/chatbotStatus.service.js) — it only
 * makes the existing bots visible/manageable in the admin panel.
 */
async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB Connected");

  const companies = await Company.find({}).lean();
  let created = 0;

  for (const company of companies) {
    const existing = await Chatbot.findOne({ companyId: company.companyId });
    if (existing) {
      console.log(`ℹ️  ${company.companyId} already has a Chatbot record. Skipping.`);
      continue;
    }

    await Chatbot.create({
      companyId: company.companyId,
      name: company.chatbot?.chatbotName || `${company.name} Assistant`,
      status: "LIVE",
      model: company.ai?.model || "openai/gpt-oss-20b",
    });

    created += 1;
    console.log(`✅ Created Chatbot record for ${company.companyId}`);
  }

  console.log(`Done. ${created} chatbot record(s) created.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
