import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { connectTestDb, disconnectTestDb } from "./helpers/seed.mjs";
import { TEST_MONGO_URI, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4320;

await connectTestDb();

await Company.create({
  companyId: "ccsu2",
  name: "CCSU - Chaudhary Charan Singh University",
  domain: "ccsu.ac.in",
  knowledgeFile: "ccsu2.txt",
  industry: "Education",
  isActive: true,
  status: "ACTIVE",
});
const user = new AdminUser({ name: "CCSU Admin", email: "admin@ccsu2.test", role: "SUPER_ADMIN" });
await user.setPassword("password123");
await user.save();
await disconnectTestDb();

const env = {
  ...process.env,
  MONGO_URI: TEST_MONGO_URI,
  JWT_SECRET: TEST_JWT_SECRET,
  PORT: String(PORT),
  ADMIN_ALLOWED_ORIGINS: "http://localhost:5202",
  GROQ_API_KEY_1: "test",
  GROQ_API_KEY_2: "test",
  GROQ_API_KEY_3: "test",
  GROQ_API_KEY_4: "test",
  GROQ_API_KEY_5: "test",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  MAIL_OUTBOX_FILE: path.join(os.tmpdir(), `nuformly-ccsu2-outbox-${PORT}.jsonl`),
};
fs.rmSync(env.MAIL_OUTBOX_FILE, { force: true });

const child = spawn(process.execPath, ["index.js"], { cwd: BACKEND_DIR, env, stdio: "inherit" });

const deadline = Date.now() + 20000;
for (;;) {
  try {
    const res = await fetch(`http://localhost:${PORT}/health`);
    if (res.status === 200) break;
  } catch {}
  if (Date.now() > deadline) { console.error("server never became healthy"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 200));
}

console.log("READY http://localhost:" + PORT);
console.log("Login: admin@ccsu2.test / password123");
process.on("SIGINT", () => { child.kill(); process.exit(0); });
