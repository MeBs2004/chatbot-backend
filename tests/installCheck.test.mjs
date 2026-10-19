import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import { publicCall } from "./helpers/widget.mjs";
import Chatbot from "../models/chatbot.model.js";
import AdminUser from "../models/adminUser.model.js";

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

const session = (id, origin, ip = "203.0.113.50") =>
  publicCall(server.baseUrl, "POST", "/api/widget/session", { origin, ip, body: { chatbotId: String(id) } });

// Recording is fire-and-forget (never slows the widget down), so poll.
async function installationsOf(id, until = (l) => l.length > 0) {
  for (let i = 0; i < 40; i++) {
    const bot = await Chatbot.findById(id).lean();
    if (until(bot.installations || [])) return bot.installations;
    await new Promise((r) => setTimeout(r, 50));
  }
  return (await Chatbot.findById(id).lean()).installations || [];
}

test("session records the website the widget runs on", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const before = Date.now();
  assert.equal((await session(chatbots[0]._id, "https://shop.example.com")).status, 200);
  const list = await installationsOf(chatbots[0]._id);
  assert.equal(list.length, 1);
  assert.equal(list[0].origin, "https://shop.example.com");
  assert.ok(new Date(list[0].lastSeenAt).getTime() >= before);
});

test("repeat visits from the same website don't duplicate it", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  await session(chatbots[0]._id, "https://shop.example.com");
  await installationsOf(chatbots[0]._id);
  await session(chatbots[0]._id, "https://shop.example.com");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await installationsOf(chatbots[0]._id)).length, 1);
});

test("keeps only the 20 most recently seen websites", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  for (let i = 1; i <= 21; i++) {
    await session(chatbots[0]._id, `https://site${i}.example.com`, `203.0.113.${i}`);
    await installationsOf(chatbots[0]._id, (l) => l.some((x) => x.origin === `https://site${i}.example.com`));
  }
  const list = await installationsOf(chatbots[0]._id, (l) => l.length >= 20);
  assert.equal(list.length, 20);
  assert.equal(list.some((x) => x.origin === "https://site1.example.com"), false);
  assert.equal(list.some((x) => x.origin === "https://site21.example.com"), true);
});

test("nothing recorded without an Origin, or from a rejected website", async () => {
  const { chatbots } = await seedTenant({
    companyId: "acme",
    chatbots: [{ name: "Open" }, { name: "Locked", allowedDomains: ["a.test"] }],
  });
  await session(chatbots[0]._id, null);
  await session(chatbots[1]._id, "https://b.test");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await installationsOf(chatbots[0]._id)).length, 0);
  assert.equal((await installationsOf(chatbots[1]._id)).length, 0);
});

test("installations are visible to admins but not in public config", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  await session(chatbots[0]._id, "https://shop.example.com");
  await installationsOf(chatbots[0]._id);

  const user = new AdminUser({ name: "S", email: "s@test", role: "SUPER_ADMIN" });
  await user.setPassword("password123");
  await user.save();
  const token = jwt.sign({ sub: String(user._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET);
  const detail = await (await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbots[0]._id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(detail.chatbot.installations[0].origin, "https://shop.example.com");

  const pub = await (await fetch(`${server.baseUrl}/api/widget/config/${chatbots[0]._id}`)).json();
  assert.equal(JSON.stringify(pub).includes("shop.example.com"), false);
});

test("public install info returns only the chatbot's display name", async () => {
  const { chatbots } = await seedTenant({
    companyId: "acme",
    chatbots: [{ name: "Locked", allowedDomains: ["a.test"] }, { name: "Gone", deletedAt: new Date() }],
  });
  // Works even from a website outside allowedDomains: it's how a
  // developer opens the shared install page.
  const res = await publicCall(server.baseUrl, "GET", `/api/widget/install-info/${chatbots[0]._id}`, { origin: "https://admin.elsewhere.test" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true, chatbot: { id: String(chatbots[0]._id), name: "Locked", companyName: "acme Inc" } });
  for (const id of [String(chatbots[1]._id), "nope"]) {
    const r = await publicCall(server.baseUrl, "GET", `/api/widget/install-info/${id}`);
    assert.equal(r.status, 404);
  }
});
