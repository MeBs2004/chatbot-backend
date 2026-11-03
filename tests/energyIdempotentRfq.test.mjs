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
// PHASE 5.2, TASK 7 — RFQ idempotency (core cases). Split from the
// concurrency case (energyIdempotentRfqConcurrency.test.mjs) and from
// the rest of the Phase 5.2 suite: together they'd exceed the real
// 10/min enquiryLimiter on one shared server — this is deliberately
// its own server/port so its createEnquiry calls get a clean bucket.
// ======================================================

let server;
let superToken;
let chatbotId;
let sa;
const companyId = "acme";

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4210 });
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
  // See energyIdempotentRfqConcurrency.test.mjs's note: resetDb() drops
  // every index along with the database, so this re-creates the partial
  // unique index these tests rely on before the next test runs.
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

test("G1: a normal RFQ creates exactly one enquiry", async () => {
  const res = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v-g1", idempotencyKey: "key-g1" });
  assert.equal(res.status, 201);
  const count = await EnergyEnquiry.countDocuments({ idempotencyKey: "key-g1" });
  assert.equal(count, 1);
});

test("G2: repeated submission with the same idempotency key returns the original enquiry, no duplicate created", async () => {
  const first = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v-g2", idempotencyKey: "key-g2" });
  const second = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v-g2", idempotencyKey: "key-g2" });
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.enquiry.referenceId, first.body.enquiry.referenceId);
  const count = await EnergyEnquiry.countDocuments({ idempotencyKey: "key-g2" });
  assert.equal(count, 1);
});

test("G4: different idempotency keys (separate legitimate journeys) create separate enquiries", async () => {
  const r1 = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v-g4", idempotencyKey: "key-g4-a" });
  const r2 = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v-g4", idempotencyKey: "key-g4-b" });
  assert.notEqual(r1.body.enquiry.referenceId, r2.body.enquiry.referenceId);
  const count = await EnergyEnquiry.countDocuments({ visitorId: "v-g4" });
  assert.equal(count, 2);
});

test("G5: the same key reused by a DIFFERENT visitor never returns the first visitor's enquiry — it creates its own", async () => {
  const r1 = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "visitor-x", idempotencyKey: "shared-key" });
  const r2 = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "B", email: "b@example.com" }, fuelKey: "solar", visitorId: "visitor-y", idempotencyKey: "shared-key" });
  assert.notEqual(r1.body.enquiry.referenceId, r2.body.enquiry.referenceId, "a different visitorId must never be handed another visitor's enquiry");
  assert.equal(r2.body.idempotent, undefined);
});

test("an invalid idempotency key (wrong type/too long) is safely ignored, RFQ still succeeds normally", async () => {
  const res = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", idempotencyKey: "x".repeat(500) });
  assert.equal(res.status, 201);
});
