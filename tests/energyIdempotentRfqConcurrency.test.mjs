import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import EnergyEnquiry from "../models/energy/enquiry.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

// ======================================================
// PHASE 5.2, TASK 7 — RFQ idempotency under real concurrency. Split
// into its own file/port — see energyIdempotentRfq.test.mjs's header
// note on the shared enquiryLimiter budget.
// ======================================================

let server;
let superToken;
let chatbotId;
let sa;
const companyId = "acme";

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4211 });
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

const widget = (method, path, body) =>
  fetch(`${server.baseUrl}/api/widget/energy${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

beforeEach(async () => {
  await resetDb();
  // resetDb() drops the whole database, which also drops every index —
  // including the partial unique index this test specifically exists to
  // verify. The spawned backend server's own Mongoose connection only
  // builds indexes once (right after it first connects), so after a drop
  // they're gone until something rebuilds them; the Mongo server itself
  // is shared, so creating them via this process's connection makes them
  // visible to the backend server's connection too.
  await EnergyEnquiry.createIndexes();
  await ensureEnergyDefaults();

  const superUser = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await superUser.setPassword("password123");
  await superUser.save();
  superToken = jwt.sign({ sub: String(superUser._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  sa = admin(superToken);

  const { chatbots } = await seedTenant({ companyId, chatbots: [{ name: "Energy Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "energy" });
});

test("G3: concurrent requests with the same idempotency key never create two enquiries", async () => {
  const body = { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v-g3", idempotencyKey: "key-g3" };
  const [r1, r2, r3] = await Promise.all([widget("POST", `/${chatbotId}/enquiries`, body), widget("POST", `/${chatbotId}/enquiries`, body), widget("POST", `/${chatbotId}/enquiries`, body)]);
  const refs = new Set([r1, r2, r3].map((r) => r.body.enquiry.referenceId));
  assert.equal(refs.size, 1, "all three concurrent attempts must resolve to the SAME enquiry");
  const count = await EnergyEnquiry.countDocuments({ idempotencyKey: "key-g3" });
  assert.equal(count, 1);
});
