import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB Connected");

  const { fuelsCreated, offeringsCreated } = await ensureEnergyDefaults();
  console.log(`✅ Energy defaults ensured — ${fuelsCreated} fuel categories and ${offeringsCreated} products/services/project types created (existing rows left untouched).`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Energy defaults seed failed:", err);
  process.exit(1);
});
