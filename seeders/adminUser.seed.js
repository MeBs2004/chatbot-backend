import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import AdminUser from "../models/adminUser.model.js";

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ MongoDB Connected");

  const email = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  const name = process.env.SUPER_ADMIN_NAME || "Super Admin";

  if (!email || !password) {
    console.error(
      "❌ Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in backend/.env before seeding."
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ SUPER_ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await AdminUser.findOne({ email });

  if (existing) {
    console.log(`ℹ️  Super admin ${email} already exists. Skipping.`);
    process.exit(0);
  }

  const user = new AdminUser({
    name,
    email,
    role: "SUPER_ADMIN",
    status: "ACTIVE",
  });

  await user.setPassword(password);
  await user.save();

  console.log(`✅ Super admin created: ${email}`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
