// HTTP-layer tests for the knowledge-generation endpoints
// (POST /companies/:id/knowledge/generate-from-url and .../generate-from-file).
// Covers auth, input validation, and the SSRF guard — all deterministic
// and network-independent (a blocked/malformed address is rejected before
// any fetch is attempted). The AI-structuring happy path itself is
// covered by tests/knowledgeScrape.unit.test.mjs, since this suite's
// server runs with fake Groq keys and must never make a real AI call.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import AIUsage from "../models/aiUsage.model.js";

let server;
let superToken;
before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4196 });
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(async () => {
  await resetDb();
  const user = new AdminUser({ name: "Super", email: "super@test.com", role: "SUPER_ADMIN" });
  await user.setPassword("password123");
  await user.save();
  superToken = jwt.sign({ sub: String(user._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
});

const tokenFor = async (email, companyId, role = "COMPANY_ADMIN") => {
  const user = new AdminUser({ name: "Owner", email, role: "COMPANY_ADMIN" });
  await user.setPassword("password123");
  await user.save();
  await UserCompanyAccess.create({ userId: user._id, companyId, role, status: "ACTIVE" });
  return jwt.sign({ sub: String(user._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
};

const fromUrl = (companyId, body, token) =>
  fetch(`${server.baseUrl}/api/admin/companies/${companyId}/knowledge/generate-from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const fromFile = (companyId, { filename, content, type }, token) => {
  const form = new FormData();
  form.append("file", new Blob([content], { type }), filename);
  return fetch(`${server.baseUrl}/api/admin/companies/${companyId}/knowledge/generate-from-file`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
};

test("generate-from-url requires authentication and company access", async () => {
  await seedTenant({ companyId: "acme" });
  const noAuth = await fromUrl("acme", { url: "https://acme.test" });
  assert.equal(noAuth.status, 401);

  const otherToken = await tokenFor("owner@other.test", "other-co");
  const wrongCompany = await fromUrl("acme", { url: "https://acme.test" }, otherToken);
  assert.equal(wrongCompany.status, 403);

  const missing = await fromUrl("does-not-exist", { url: "https://acme.test" }, superToken);
  assert.equal(missing.status, 404);
});

test("generate-from-url rejects a missing or malformed address without touching the network", async () => {
  await seedTenant({ companyId: "acme" });
  const noUrl = await fromUrl("acme", {}, superToken);
  assert.equal(noUrl.status, 400);

  const malformed = await fromUrl("acme", { url: "not a url" }, superToken);
  assert.equal(malformed.status, 400);

  const badScheme = await fromUrl("acme", { url: "ftp://files.acme.test/x" }, superToken);
  assert.equal(badScheme.status, 400);
});

test("generate-from-url blocks a private/loopback address (SSRF guard) and never calls the AI", async () => {
  await seedTenant({ companyId: "acme" });
  const res = await fromUrl("acme", { url: "http://127.0.0.1:9/" }, superToken);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.message, /not allowed/i);
  assert.equal(await AIUsage.countDocuments({ companyId: "acme" }), 0, "a blocked address must never reach the AI step");
});

test("generate-from-url also blocks a hostname that is a cloud-metadata/link-local address", async () => {
  await seedTenant({ companyId: "acme" });
  const res = await fromUrl("acme", { url: "http://169.254.169.254/latest/meta-data/" }, superToken);
  assert.equal(res.status, 400);
});

test("generate-from-file requires a file and rejects an unsupported type", async () => {
  await seedTenant({ companyId: "acme" });
  const noFile = await fetch(`${server.baseUrl}/api/admin/companies/acme/knowledge/generate-from-file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${superToken}` },
    body: new FormData(),
  });
  assert.equal(noFile.status, 400);

  const badType = await fromFile("acme", { filename: "logo.png", content: "not really a png", type: "image/png" }, superToken);
  assert.equal(badType.status, 400);
  assert.equal(await AIUsage.countDocuments({ companyId: "acme" }), 0);
});

test("generate-from-file uses a plain .txt upload as-is, with no AI call", async () => {
  await seedTenant({ companyId: "acme" });
  const text = "ABOUT ACME\nAcme sells rockets.\n";
  const res = await fromFile("acme", { filename: "knowledge.txt", content: text, type: "text/plain" }, superToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.content, text);
  assert.equal(body.structured, false);
  assert.equal(body.source.filename, "knowledge.txt");
  assert.equal(await AIUsage.countDocuments({ companyId: "acme" }), 0, "a .txt upload should never call the AI");
});

test("generate-from-file rejects an empty .txt upload", async () => {
  await seedTenant({ companyId: "acme" });
  const res = await fromFile("acme", { filename: "empty.txt", content: "   \n  ", type: "text/plain" }, superToken);
  assert.equal(res.status, 400);
});

test("a company admin can generate for their own company but not another one", async () => {
  await seedTenant({ companyId: "acme" });
  await seedTenant({ companyId: "other-co" });
  const ownerToken = await tokenFor("owner@acme.test", "acme");

  const ok = await fromFile("acme", { filename: "k.txt", content: "Acme facts.", type: "text/plain" }, ownerToken);
  assert.equal(ok.status, 200);

  const blocked = await fromFile("other-co", { filename: "k.txt", content: "Other facts.", type: "text/plain" }, ownerToken);
  assert.equal(blocked.status, 403);
});
