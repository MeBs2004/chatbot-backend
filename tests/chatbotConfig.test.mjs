import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";

let server;
let adminToken;
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
  const user = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await user.setPassword("password123");
  await user.save();
  adminToken = jwt.sign({ sub: String(user._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
});

const admin = (method, path, body) =>
  fetch(`${server.baseUrl}/api/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
const saveConfig = (id, config) => admin("PATCH", `/chatbots/${id}/config`, { config });
const publicConfig = async (id) => (await fetch(`${server.baseUrl}/api/widget/config/${id}`)).json();

test("teaserMessages saved and returned", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const res = await saveConfig(chatbots[0]._id, { launcher: { teaserMessages: ["Hi", "Need help?"] } });
  assert.equal(res.status, 200);
  assert.deepEqual((await publicConfig(chatbots[0]._id)).config.launcher.teaserMessages, ["Hi", "Need help?"]);
});

test("teaserMessages limits", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: Array(11).fill("hi") } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: ["x".repeat(81)] } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: [{ text: "hi" }] } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: ["x".repeat(80)] } })).status, 200);
});

test("existing chatbot without the field gets []", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  await mongoose.connection.db
    .collection("chatbots")
    .updateOne({ _id: chatbots[0]._id }, { $set: { config: { launcher: { color: "#123456" } } } });
  const { config } = await publicConfig(chatbots[0]._id);
  assert.deepEqual(config.launcher.teaserMessages, []);
  assert.equal(config.launcher.color, "#123456");
});

test("botAvatar must be https", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const avatar = (v) => saveConfig(id, { chatWindow: { botAvatar: v } });
  assert.equal((await avatar("http://x.test/a.png")).status, 400);
  assert.equal((await avatar("javascript:alert(1)")).status, 400);
  assert.equal((await avatar("https://x.test/" + "a".repeat(500))).status, 400);
  assert.equal((await avatar("")).status, 200);
  assert.equal((await avatar("https://x.test/a.png")).status, 200);
});

test("new chatbots are v1", async () => {
  await seedTenant({ companyId: "fresh" });
  const res = await admin("POST", "/chatbots", { companyId: "fresh", name: "First Bot" });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await res.json()).chatbot.widgetEngineVersion, "v1");
});
