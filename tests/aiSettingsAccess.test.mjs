import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";

// ======================================================
// By explicit product decision, AI Settings (view, edit, and the test
// playground) is SUPER_ADMIN-only — a Company Admin (even of the
// chatbot's own company) can no longer view or change a chatbot's AI
// model/tone/temperature configuration. See aiSettings.controller.js's
// loadAuthorizedChatbotAndCompany.
// ======================================================

let server;
let chatbotId;
let companyId = "aiacme";

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4214 });
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});

const admin = (token) => (method, path, body) =>
  fetch(`${server.baseUrl}/api/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

beforeEach(async () => {
  await resetDb();
  const { chatbots } = await seedTenant({ companyId, chatbots: [{ name: "Bot" }] });
  chatbotId = chatbots[0]._id;
});

async function tokenFor(role, { companyScoped = false } = {}) {
  const user = new AdminUser({ name: role, email: `${role.toLowerCase()}@test`, role: companyScoped ? "COMPANY_ADMIN" : role });
  await user.setPassword("password123");
  await user.save();
  if (companyScoped) {
    await UserCompanyAccess.create({ userId: user._id, companyId, role: "COMPANY_ADMIN", accessScope: "COMPANY", status: "ACTIVE" });
  }
  return jwt.sign({ sub: String(user._id), role: user.role, tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
}

test("GET ai-settings: SUPER_ADMIN can view; a COMPANY_ADMIN of the same company (and a user with no access) cannot", async () => {
  const superToken = await tokenFor("SUPER_ADMIN");
  const superRes = await admin(superToken)("GET", `/chatbots/${chatbotId}/ai-settings`);
  assert.equal(superRes.status, 200);

  const companyAdminToken = await tokenFor("COMPANY_ADMIN", { companyScoped: true });
  const companyRes = await admin(companyAdminToken)("GET", `/chatbots/${chatbotId}/ai-settings`);
  assert.equal(companyRes.status, 403, "a Company Admin of the chatbot's own company must no longer be able to view AI settings");

  const noAccessToken = await tokenFor("CHATBOT_MANAGER");
  const noAccessRes = await admin(noAccessToken)("GET", `/chatbots/${chatbotId}/ai-settings`);
  assert.equal(noAccessRes.status, 403);
});

test("PUT ai-settings: SUPER_ADMIN can update; a COMPANY_ADMIN of the same company cannot", async () => {
  const superToken = await tokenFor("SUPER_ADMIN");
  const superRes = await admin(superToken)("PUT", `/chatbots/${chatbotId}/ai-settings`, { ai: { model: "openai/gpt-oss-20b" } });
  assert.equal(superRes.status, 200);

  const companyAdminToken = await tokenFor("COMPANY_ADMIN", { companyScoped: true });
  const companyRes = await admin(companyAdminToken)("PUT", `/chatbots/${chatbotId}/ai-settings`, { ai: { model: "openai/gpt-oss-20b" } });
  assert.equal(companyRes.status, 403, "a Company Admin must no longer be able to edit AI settings");
});

test("POST ai/test: SUPER_ADMIN only — a COMPANY_ADMIN of the same company is rejected", async () => {
  const companyAdminToken = await tokenFor("COMPANY_ADMIN", { companyScoped: true });
  const res = await admin(companyAdminToken)("POST", `/chatbots/${chatbotId}/ai/test`, { message: "hello" });
  assert.equal(res.status, 403, "the AI test playground is part of AI Settings and must be SUPER_ADMIN-only too");
});
