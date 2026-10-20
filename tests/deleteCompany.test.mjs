import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";
import Chatbot from "../models/chatbot.model.js";
import Visitor from "../models/visitor.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import AuditLog from "../models/auditLog.model.js";
import Invitation from "../models/invitation.model.js";

let server;
let superToken;
let adminUser;
before(async () => {
  await connectTestDb();
  server = await startTestServer();
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(async () => {
  await resetDb();
  adminUser = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await adminUser.setPassword("password123");
  await adminUser.save();
  superToken = jwt.sign({ sub: String(adminUser._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
});

const del = (token, id, body) =>
  fetch(`${server.baseUrl}/api/admin/companies/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body || {}),
  });

async function seedWithData() {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  await seedTenant({ companyId: "other", chatbots: [{ name: "Keep me" }] });
  await Visitor.create({ companyId: "acme", visitorId: "v1" });
  await Visitor.create({ companyId: "other", visitorId: "v2" });
  await UserCompanyAccess.create({ userId: adminUser._id, companyId: "acme", role: "COMPANY_ADMIN" });
  return chatbots[0];
}

test("requires the exact company name as confirmation", async () => {
  await seedWithData();
  assert.equal((await del(superToken, "acme", {})).status, 400);
  assert.equal((await del(superToken, "acme", { confirmName: "wrong" })).status, 400);
  assert.ok(await Company.findOne({ companyId: "acme" }));
});

test("only SUPER_ADMIN can delete a company", async () => {
  await seedWithData();
  const agent = new AdminUser({ name: "Agent", email: "agent@test", role: "COMPANY_ADMIN" });
  await agent.setPassword("password123");
  await agent.save();
  await UserCompanyAccess.create({ userId: agent._id, companyId: "acme", role: "COMPANY_ADMIN" });
  const token = jwt.sign({ sub: String(agent._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  assert.equal((await del(token, "acme", { confirmName: "acme Inc" })).status, 403);
  assert.ok(await Company.findOne({ companyId: "acme" }));
});

test("404 for an unknown company", async () => {
  assert.equal((await del(superToken, "nope", { confirmName: "x" })).status, 404);
});

test("deletes the company and everything under it, nothing else", async () => {
  const bot = await seedWithData();
  await Invitation.create({
    email: "inv@test", role: "AGENT", tokenHash: "h1", invitedBy: adminUser._id,
    companyAccess: [{ companyId: "acme", role: "AGENT" }], expiresAt: new Date(Date.now() + 86400000),
  }).catch(() => null);

  const res = await del(superToken, "acme", { confirmName: "acme Inc" });
  assert.equal(res.status, 200, await res.clone().text());

  assert.equal(await Company.countDocuments({ companyId: "acme" }), 0);
  assert.equal(await Chatbot.countDocuments({ companyId: "acme" }), 0);
  assert.equal(await Chatbot.countDocuments({ _id: bot._id }), 0);
  assert.equal(await Visitor.countDocuments({ companyId: "acme" }), 0);
  assert.equal(await UserCompanyAccess.countDocuments({ companyId: "acme" }), 0);

  // The other tenant is untouched, and the admin account survives.
  assert.ok(await Company.findOne({ companyId: "other" }));
  assert.equal(await Chatbot.countDocuments({ companyId: "other" }), 1);
  assert.equal(await Visitor.countDocuments({ companyId: "other" }), 1);
  assert.ok(await AdminUser.findById(adminUser._id));

  // The deletion is audited and the audit trail is kept.
  const audit = await AuditLog.findOne({ action: "DELETE_COMPANY", resourceId: "acme" });
  assert.ok(audit);
  assert.equal(audit.metadata.name, "acme Inc");
  assert.equal(await Invitation.countDocuments({ "companyAccess.companyId": "acme" }), 0);
});
