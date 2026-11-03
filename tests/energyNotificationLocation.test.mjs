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
// PHASE 5.2, TASK 4 — supplier notification location formatting
// (HTTP-level). Split into its own file/port: the group of
// createEnquiry calls this needs, combined with the rest of the
// Phase 5.2 suite in one process, would exceed the real 10/min
// enquiryLimiter on a single shared server (see energyPhase52.test.mjs's
// note on the same issue for Task 7).
// ======================================================

let server;
let superToken;
let chatbotId;
let panelId;
let sa;
const companyId = "acme";

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4209 });
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
  await ensureEnergyDefaults();

  const superUser = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await superUser.setPassword("password123");
  await superUser.save();
  superToken = jwt.sign({ sub: String(superUser._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  sa = admin(superToken);

  const { chatbots } = await seedTenant({ companyId, chatbots: [{ name: "Energy Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "energy" });

  const panel = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Panel", fuelKey: "solar", category: "panel" });
  panelId = panel.body.item._id;
});

test("D1/D2: notifySuppliers email body prefers structured location, falls back to legacy projectLocation, and still enforces consent", async () => {
  const supplier = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Test Supplier", email: "supplier@test.com", supportedFuelKeys: ["solar"], equipmentIds: [panelId] });
  const supplierId = supplier.body.supplier._id;

  const withStructured = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "A", email: "a@example.com" },
    fuelKey: "solar",
    location: { city: "Noida", state: "Uttar Pradesh", country: "India", postalCode: "201301" },
    selectedSupplierIds: [supplierId],
    consent: { given: true },
  });
  const enquiryId1 = (await EnergyEnquiry.findOne({ referenceId: withStructured.body.enquiry.referenceId }))._id;
  const notify1 = await sa("POST", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId1}/notify-suppliers`);
  assert.equal(notify1.status, 200);
  // SMTP isn't configured in tests — sendMail honestly reports not-configured, never claims success.
  assert.equal(notify1.body.results[0].sent, false);
  assert.equal(notify1.body.results[0].reason, "not-configured");

  const legacyOnly = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "B", email: "b@example.com" },
    fuelKey: "solar",
    projectLocation: "Plot 9, Legacy Industrial Area",
    selectedSupplierIds: [supplierId],
    consent: { given: true },
  });
  const enquiryId2 = (await EnergyEnquiry.findOne({ referenceId: legacyOnly.body.enquiry.referenceId }))._id;
  const notify2 = await sa("POST", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId2}/notify-suppliers`);
  assert.equal(notify2.status, 200);
  assert.equal(notify2.body.results[0].sent, false);

  // Consent enforcement is unchanged.
  const noConsent = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "C", email: "c@example.com" }, fuelKey: "solar" });
  const enquiryId3 = (await EnergyEnquiry.findOne({ referenceId: noConsent.body.enquiry.referenceId }))._id;
  const notify3 = await sa("POST", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId3}/notify-suppliers`);
  assert.equal(notify3.status, 400);
});
