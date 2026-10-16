import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import { getWidgetToken, publicCall } from "./helpers/widget.mjs";
import Visitor from "../models/visitor.model.js";

const { buildHistoryFilter } = await import("../controllers/chatbot.message.js");

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

test("visitor endpoints return no visitor data", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const token = await getWidgetToken(server.baseUrl, chatbots[0]._id);
  const calls = [
    ["/bot/v1/visitor", { visitorId: "v1", page: "/" }],
    ["/bot/v1/visitor", { visitorId: "v1", page: "/pricing" }], // update branch
    ["/bot/v1/visitor/email", { visitorId: "v1", email: "a@b.test" }],
    ["/bot/v1/visitor/name", { visitorId: "v1", name: "Ann" }],
  ];
  for (const [path, body] of calls) {
    const res = await publicCall(server.baseUrl, "POST", path, { token, body });
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), { success: true }, path);
  }
});

test("visitor is stamped with the token's chatbot", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "One" }, { name: "Two" }] });
  const token = await getWidgetToken(server.baseUrl, chatbots[1]._id);
  await publicCall(server.baseUrl, "POST", "/bot/v1/visitor", { token, body: { visitorId: "v2" } });
  const v = await Visitor.findOne({ visitorId: "v2" }).lean();
  assert.equal(String(v.chatbotId), String(chatbots[1]._id));
});

test("AI history excludes other chatbots", () => {
  assert.deepEqual(buildHistoryFilter({ companyId: "acme", visitorId: "v1", chatbotId: "X" }), {
    companyId: "acme",
    visitorId: "v1",
    chatbotId: { $in: ["X", null] },
  });
  assert.deepEqual(buildHistoryFilter({ companyId: "acme", visitorId: "v1", chatbotId: null }), {
    companyId: "acme",
    visitorId: "v1",
  });
});

test("message rate limit is per chatbot", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "X" }, { name: "Y" }] });
  const [tokenX, tokenY] = [await getWidgetToken(server.baseUrl, chatbots[0]._id), await getWidgetToken(server.baseUrl, chatbots[1]._id)];
  const ip = "203.0.113.7";
  // "human" triggers the keyword handoff, which replies without an AI call.
  const send = (token, i) =>
    publicCall(server.baseUrl, "POST", "/bot/v1/message", { token, ip, body: { text: "human", visitorId: `rl-${i}` } });
  for (let i = 0; i < 30; i++) assert.notEqual((await send(tokenX, i)).status, 429, `message ${i}`);
  assert.equal((await send(tokenX, 30)).status, 429);
  assert.notEqual((await send(tokenY, 31)).status, 429);
});
