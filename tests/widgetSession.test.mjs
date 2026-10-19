import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";

process.env.JWT_SECRET = TEST_JWT_SECRET;
const { verifyWidgetToken } = await import("../services/widget/widgetToken.service.js");

let server;
before(async () => {
  await connectTestDb();
  server = await startTestServer();
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(resetDb);

function session(chatbotId, headers = {}) {
  return fetch(`${server.baseUrl}/api/widget/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ chatbotId }),
  });
}

test("issues a token for a chatbot with no domain restriction", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Sales" }] });
  const res = await session(String(chatbots[0]._id));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, true);
  assert.equal(typeof body.token, "string");
  assert.equal(body.chatbot.name, "Sales");
  assert.ok(body.config.launcher);
  assert.deepEqual(verifyWidgetToken(body.token), { chatbotId: String(chatbots[0]._id), companyId: "acme" });
});

test("rejects a session from a non-allowed origin", async () => {
  const { chatbots } = await seedTenant({
    companyId: "acme",
    chatbots: [{ name: "A", allowedDomains: ["a.test"] }, { name: "W", allowedDomains: ["*.a.test"] }],
  });
  const denied = await session(String(chatbots[0]._id), { Origin: "https://b.test" });
  assert.equal(denied.status, 404);
  assert.equal((await denied.json()).message, "Chatbot not found.");
  const allowed = await session(String(chatbots[1]._id), { Origin: "https://shop.a.test" });
  assert.equal(allowed.status, 200);
});

test("paused chatbot gets no token", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "P", status: "PAUSED" }] });
  const res = await session(String(chatbots[0]._id));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, false);
  assert.equal(body.reason, "paused");
  assert.equal("token" in body, false);
});

test("unknown, malformed, or deleted chatbotId", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "D", deletedAt: new Date() }] });
  for (const id of [String(new (await import("mongoose")).default.Types.ObjectId()), "not-an-id", String(chatbots[0]._id)]) {
    const res = await session(id);
    assert.equal(res.status, 404, id);
    assert.equal((await res.json()).message, "Chatbot not found.");
  }
});

test("inactive company gets no token", async () => {
  const { chatbots } = await seedTenant({ companyId: "gone", isActive: false, chatbots: [{ name: "X" }] });
  const res = await session(String(chatbots[0]._id));
  assert.equal(res.status, 404);
});

test("verifyWidgetToken rejects tampered, wrong-audience and expired tokens", () => {
  const key = crypto.createHmac("sha256", TEST_JWT_SECRET).update("nuformly-widget-token").digest();
  const claims = { aud: "nuformly-widget", cid: "c1", co: "acme" };
  const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }, key);
  assert.throws(() => verifyWidgetToken(expired), { code: "WIDGET_TOKEN_EXPIRED", status: 401 });
  const wrongAud = jwt.sign({ ...claims, aud: "admin" }, key, { expiresIn: "1h" });
  assert.throws(() => verifyWidgetToken(wrongAud), { code: "WIDGET_TOKEN_INVALID" });
  const adminKeySigned = jwt.sign(claims, TEST_JWT_SECRET, { expiresIn: "1h" });
  assert.throws(() => verifyWidgetToken(adminKeySigned), { code: "WIDGET_TOKEN_INVALID" });
  const good = jwt.sign(claims, key, { expiresIn: "1h" });
  assert.throws(() => verifyWidgetToken(good.slice(0, -2) + "xx"), { code: "WIDGET_TOKEN_INVALID" });
  assert.throws(() => verifyWidgetToken(undefined), { code: "WIDGET_TOKEN_INVALID" });
});

test("a widget token is not accepted as an admin token", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "S" }] });
  const { token } = await (await session(String(chatbots[0]._id))).json();
  const res = await fetch(`${server.baseUrl}/api/admin/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 401);
});
