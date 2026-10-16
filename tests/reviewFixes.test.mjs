import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import { getWidgetToken, publicCall } from "./helpers/widget.mjs";
import Chatbot from "../models/chatbot.model.js";

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

const expiredTokenFor = (bot) =>
  jwt.sign(
    { aud: "nuformly-widget", cid: String(bot._id), co: bot.companyId, exp: Math.floor(Date.now() / 1000) - 5 },
    crypto.createHmac("sha256", TEST_JWT_SECRET).update("nuformly-widget-token").digest()
  );

test("expired token on config and calculator returns 401 WIDGET_TOKEN_EXPIRED", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Locked", allowedDomains: ["a.test"] }] });
  const token = expiredTokenFor(chatbots[0]);
  for (const [method, path, body] of [
    ["GET", `/api/widget/config/${chatbots[0]._id}`, null],
    ["POST", `/api/widget/calculate/${chatbots[0]._id}/marketing`, { calculation: "roi", inputs: {} }],
  ]) {
    const res = await publicCall(server.baseUrl, method, path, { token, origin: "https://cdn.test", body });
    assert.equal(res.status, 401, path);
    assert.equal((await res.json()).code, "WIDGET_TOKEN_EXPIRED", path);
  }
});

test("calculator accepts a valid token from the CDN origin", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Locked", allowedDomains: ["a.test"] }] });
  await Chatbot.updateOne({ _id: chatbots[0]._id }, { template: "digital_marketing" });
  const token = await getWidgetToken(server.baseUrl, chatbots[0]._id, "https://a.test");
  const res = await publicCall(server.baseUrl, "POST", `/api/widget/calculate/${chatbots[0]._id}/marketing`, {
    token,
    origin: "https://cdn.test",
    body: { calculation: "roi", inputs: {} },
  });
  assert.notEqual(res.status, 404);
});

test("session rate limit can't be dodged by varying chatbotId", async () => {
  const ip = "198.51.100.9";
  let limited = false;
  for (let i = 0; i < 70 && !limited; i++) {
    const res = await publicCall(server.baseUrl, "POST", "/api/widget/session", {
      ip,
      body: { chatbotId: i % 2 ? `junk-${i}` : String(new mongoose.Types.ObjectId()) },
    });
    if (res.status === 429) limited = true;
  }
  assert.equal(limited, true);
});

test("a paused chatbot stops answering even with a live token", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "One" }, { name: "Two" }] });
  const token = await getWidgetToken(server.baseUrl, chatbots[0]._id);
  await Chatbot.updateOne({ _id: chatbots[0]._id }, { status: "PAUSED" });
  const res = await publicCall(server.baseUrl, "POST", "/bot/v1/message", { token, body: { text: "human", visitorId: "p1" } });
  assert.equal(res.status, 200);
  assert.match((await res.json()).botMessage, /temporarily paused/);
});
