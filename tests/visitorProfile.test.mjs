import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import { getWidgetToken, publicCall } from "./helpers/widget.mjs";
import Visitor from "../models/visitor.model.js";

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

async function setup() {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const token = await getWidgetToken(server.baseUrl, chatbots[0]._id);
  await publicCall(server.baseUrl, "POST", "/bot/v1/visitor", { token, body: { visitorId: "v1", page: "https://x.test" } });
  return { token };
}
const profile = (token, body) => publicCall(server.baseUrl, "POST", "/bot/v1/visitor/profile", { token, body });

test("pre-chat form fields are saved on the visitor", async () => {
  const { token } = await setup();
  const res = await profile(token, { visitorId: "v1", name: "Jane Doe", email: "Jane@Acme.test", phone: "+1 (555) 000-1234", company: "Acme Inc" });
  assert.equal(res.status, 200, await res.clone().text());
  const v = await Visitor.findOne({ companyId: "acme", visitorId: "v1" }).lean();
  assert.equal(v.name, "Jane Doe");
  assert.equal(v.email, "jane@acme.test");
  assert.equal(v.phone, "+1 (555) 000-1234");
  assert.equal(v.company, "Acme Inc");
});

test("each field is validated independently; a bad one never blocks a good one", async () => {
  const { token } = await setup();
  const res = await profile(token, { visitorId: "v1", name: "Jane", email: "nope", phone: "abc" });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).saved, ["name"]);
  const v = await Visitor.findOne({ visitorId: "v1" }).lean();
  assert.equal(v.email, "");
  assert.equal(v.phone, "");
});

test("rejects empty, unknown visitors, and cannot write another tenant's visitor", async () => {
  const { token } = await setup();
  assert.equal((await profile(token, { visitorId: "v1" })).status, 400);
  assert.equal((await profile(token, { name: "x" })).status, 400);
  assert.equal((await profile(token, { visitorId: "ghost", name: "x" })).status, 404);

  const other = await seedTenant({ companyId: "beta", chatbots: [{ name: "Beta Bot" }] });
  const betaToken = await getWidgetToken(server.baseUrl, other.chatbots[0]._id);
  assert.equal((await profile(betaToken, { visitorId: "v1", name: "Hijack" })).status, 404);
  assert.equal((await Visitor.findOne({ visitorId: "v1" }).lean()).name, "");
});
