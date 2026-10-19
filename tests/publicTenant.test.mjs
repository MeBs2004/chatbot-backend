import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import { getWidgetToken, publicCall } from "./helpers/widget.mjs";
import UserMessage from "../models/user.model.js";

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

async function twoTenants() {
  const a = await seedTenant({ companyId: "acme", chatbots: [{ name: "Acme Bot" }] });
  const b = await seedTenant({ companyId: "beta", chatbots: [{ name: "Beta Bot" }] });
  return { botA: a.chatbots[0], botB: b.chatbots[0] };
}

test("token tenant wins over x-company-id", async () => {
  const { botA } = await twoTenants();
  const token = await getWidgetToken(server.baseUrl, botA._id);
  await publicCall(server.baseUrl, "POST", "/bot/v1/message", {
    token,
    companyId: "beta",
    body: { text: "hello", visitorId: "v-spoof" },
  });
  const stored = await UserMessage.find({ visitorId: "v-spoof" }).lean();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].companyId, "acme");
  assert.equal(String(stored[0].chatbotId), String(botA._id));
});

test("body chatbotId from another company is rejected", async () => {
  const { botA, botB } = await twoTenants();
  const token = await getWidgetToken(server.baseUrl, botA._id);
  const res = await publicCall(server.baseUrl, "POST", "/bot/v1/message", {
    token,
    body: { text: "hello", visitorId: "v-x", chatbotId: String(botB._id) },
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, "Chatbot not found.");
  assert.equal(await UserMessage.countDocuments({ visitorId: "v-x" }), 0);
});

test("allowed-domain chatbot accepts token from CDN origin", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Locked", allowedDomains: ["a.test"] }] });
  const bot = chatbots[0];
  const token = await getWidgetToken(server.baseUrl, bot._id, "https://a.test");

  // Without the token, the CDN origin is (correctly) not an allowed site.
  const noToken = await publicCall(server.baseUrl, "GET", `/api/widget/config/${bot._id}`, { origin: "https://cdn.test" });
  assert.equal(noToken.status, 404);

  const config = await publicCall(server.baseUrl, "GET", `/api/widget/config/${bot._id}`, { token, origin: "https://cdn.test" });
  assert.equal(config.status, 200);
  assert.equal((await config.json()).available, true);

  const msg = await publicCall(server.baseUrl, "POST", "/bot/v1/message", {
    token,
    origin: "https://cdn.test",
    body: { text: "hi", visitorId: "v-cdn", chatbotId: String(bot._id) },
  });
  assert.notEqual(msg.status, 404);
  assert.equal(await UserMessage.countDocuments({ visitorId: "v-cdn", companyId: "acme" }), 1);
});

test("invalid and expired tokens", async () => {
  const { botA } = await twoTenants();
  const key = crypto.createHmac("sha256", TEST_JWT_SECRET).update("nuformly-widget-token").digest();
  const expired = jwt.sign(
    { aud: "nuformly-widget", cid: String(botA._id), co: "acme", exp: Math.floor(Date.now() / 1000) - 5 },
    key
  );
  const cases = [
    ["POST", "/bot/v1/message", { text: "x", visitorId: "v" }],
    ["POST", "/bot/v1/visitor", { visitorId: "v" }],
    ["GET", "/bot/v1/suggestions", null],
  ];
  for (const [method, path, body] of cases) {
    const bad = await publicCall(server.baseUrl, method, path, { token: "garbage", body });
    assert.equal(bad.status, 401, path);
    assert.equal((await bad.json()).code, "WIDGET_TOKEN_INVALID");
    const old = await publicCall(server.baseUrl, method, path, { token: expired, body });
    assert.equal(old.status, 401, path);
    assert.equal((await old.json()).code, "WIDGET_TOKEN_EXPIRED");
  }
});

test("legacy x-company-id requests unchanged", async () => {
  await twoTenants();
  const company = await publicCall(server.baseUrl, "GET", "/bot/v1/company", { companyId: "acme" });
  assert.equal(company.status, 200);
  assert.equal((await company.json()).company.companyId, "acme");
  await publicCall(server.baseUrl, "POST", "/bot/v1/message", { companyId: "acme", body: { text: "old", visitorId: "v-old" } });
  assert.equal(await UserMessage.countDocuments({ visitorId: "v-old", companyId: "acme" }), 1);
});

test("CORS preflight allows x-widget-token", async () => {
  const res = await fetch(`${server.baseUrl}/bot/v1/message`, { method: "OPTIONS" });
  assert.match(res.headers.get("access-control-allow-headers") || "", /x-widget-token/i);
});
