import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import EnergyEnquiry from "../models/energy/enquiry.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

let server;
let superToken;
let chatbotId;
let panelId;
let inverterId;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4205 });
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

let sa;

beforeEach(async () => {
  await resetDb();
  await ensureEnergyDefaults();

  const superUser = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await superUser.setPassword("password123");
  await superUser.save();
  superToken = jwt.sign({ sub: String(superUser._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  sa = admin(superToken);

  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Energy Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "energy" });

  const panel = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Panel", fuelKey: "solar", category: "panel" });
  panelId = panel.body.item._id;
  const inverter = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "5kW Inverter", fuelKey: "solar", category: "inverter" });
  inverterId = inverter.body.item._id;
});

// ===================== SUPPLIERS =====================

test("supplier CRUD: validates shape/references, creates, updates, deletes", async () => {
  const badName = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, {});
  assert.equal(badName.status, 400);

  const foreignEquipment = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Acme Solar Supplies", equipmentIds: ["000000000000000000000000"] });
  assert.equal(foreignEquipment.status, 400);

  const created = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, {
    name: "Acme Solar Supplies",
    contactPerson: "Priya Sharma",
    email: "priya@acmesolar.test",
    supportedFuelKeys: ["solar"],
    equipmentIds: [panelId],
    serviceRegions: ["Maharashtra"],
    leadTimeDays: 7,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.supplier.documents.length, 0);
  const supplierId = created.body.supplier._id;

  const updated = await sa("PATCH", `/chatbots/${chatbotId}/energy/suppliers/${supplierId}`, { leadTimeDays: 10, verificationStatus: "verified" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.supplier.leadTimeDays, 10);
  assert.equal(updated.body.supplier.verificationStatus, "verified");

  const detail = await sa("GET", `/chatbots/${chatbotId}/energy/suppliers/${supplierId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.supplier.name, "Acme Solar Supplies");

  const deleted = await sa("DELETE", `/chatbots/${chatbotId}/energy/suppliers/${supplierId}`);
  assert.equal(deleted.status, 200);
  const afterDelete = await sa("GET", `/chatbots/${chatbotId}/energy/suppliers/${supplierId}`);
  assert.equal(afterDelete.status, 404);
});

test("multiple suppliers can list the same equipment, and one supplier can supply multiple items", async () => {
  await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Supplier A", supportedFuelKeys: ["solar"], equipmentIds: [panelId] });
  await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Supplier B", supportedFuelKeys: ["solar"], equipmentIds: [panelId, inverterId] });

  const byEquipment = await sa("GET", `/chatbots/${chatbotId}/energy/suppliers?equipmentId=${panelId}`);
  assert.equal(byEquipment.body.suppliers.length, 2);

  const search = await sa("GET", `/chatbots/${chatbotId}/energy/suppliers?search=Supplier B`);
  assert.equal(search.body.suppliers.length, 1);
  assert.equal(search.body.suppliers[0].equipmentIds.length, 2);
});

test("supplier documents: upload, serve real bytes, list metadata without binary data, delete", async () => {
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Acme Solar Supplies" });
  const supplierId = created.body.supplier._id;

  const pdfBytes = Buffer.from("%PDF-1.4 fake certification");
  const form = new FormData();
  form.append("label", "ISO Certificate");
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), "iso.pdf");
  const uploadRes = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/suppliers/${supplierId}/documents`, { method: "POST", headers: { Authorization: `Bearer ${superToken}` }, body: form });
  const uploadBody = await uploadRes.json();
  assert.equal(uploadRes.status, 200, JSON.stringify(uploadBody));
  assert.equal(uploadBody.supplier.documents.length, 1);
  assert.equal(uploadBody.supplier.documents[0].data, undefined, "binary data never appears in a normal JSON response");
  const docId = uploadBody.supplier.documents[0]._id;

  const served = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/suppliers/${supplierId}/documents/${docId}`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(served.status, 200);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  assert.ok(servedBytes.equals(pdfBytes));

  const deleted = await sa("DELETE", `/chatbots/${chatbotId}/energy/suppliers/${supplierId}/documents/${docId}`);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.supplier.documents.length, 0);
});

test("admin supplier-match preview: matched, unmatched, and region/active rules apply", async () => {
  await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Supplier A", supportedFuelKeys: ["solar"], equipmentIds: [panelId], serviceRegions: ["Gujarat"] });
  await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Inactive Supplier", supportedFuelKeys: ["solar"], equipmentIds: [inverterId], active: false });

  const result = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers/match-preview`, {
    fuelKey: "solar",
    region: "Gujarat",
    requiredEquipment: [{ equipmentId: panelId, name: "550W Panel" }, { equipmentId: inverterId, name: "5kW Inverter" }],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.result.matchesByEquipment[panelId].length, 1);
  assert.equal(result.body.result.unmatchedEquipment.length, 1, "the inverter has no active matching supplier");
  assert.equal(result.body.result.unmatchedEquipment[0].equipmentId, inverterId);
});

test("suppliers are tenant-isolated", async () => {
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Acme-only Supplier" });
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });

  const otherOwner = new AdminUser({ name: "Other Owner", email: "owner@other.test", role: "COMPANY_ADMIN" });
  await otherOwner.setPassword("password123");
  await otherOwner.save();
  await UserCompanyAccess.create({ userId: otherOwner._id, companyId: "other", role: "COMPANY_ADMIN", accessScope: "COMPANY", status: "ACTIVE" });
  const otherToken = jwt.sign({ sub: String(otherOwner._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  const otherAdmin = admin(otherToken);

  const otherList = await otherAdmin("GET", `/chatbots/${otherChatbots[0]._id}/energy/suppliers`);
  assert.equal(otherList.body.suppliers.length, 0);
  const otherDetail = await otherAdmin("GET", `/chatbots/${otherChatbots[0]._id}/energy/suppliers/${created.body.supplier._id}`);
  assert.equal(otherDetail.status, 404);
});

// ===================== PUBLIC WIDGET: supplier match + enquiry =====================

test("public supplier match never exposes contact details, only name/verification/lead-time/reasons", async () => {
  await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Acme Solar Supplies", email: "secret@acmesolar.test", phone: "9999999999", supportedFuelKeys: ["solar"], equipmentIds: [panelId] });

  const res = await widget("POST", `/${chatbotId}/suppliers/match`, { fuelKey: "solar", requiredEquipment: [{ equipmentId: panelId, name: "550W Panel" }] });
  assert.equal(res.status, 200);
  const match = Object.values(res.body.result.matchesByEquipment)[0][0];
  assert.equal(match.name, "Acme Solar Supplies");
  assert.equal(match.email, undefined);
  assert.equal(match.phone, undefined);
});

test("creating an enquiry without consent can't select suppliers, validates required fields, and produces a unique reference id", async () => {
  const supplier = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Acme Solar Supplies", email: "sales@acmesolar.test", supportedFuelKeys: ["solar"], equipmentIds: [panelId] });

  const missingEmail = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Priya" }, fuelKey: "solar" });
  assert.equal(missingEmail.status, 400);
  assert.equal(missingEmail.body.field, "customer.email");

  const noConsent = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "Priya", email: "priya@customer.test" },
    fuelKey: "solar",
    selectedSupplierIds: [supplier.body.supplier._id],
  });
  assert.equal(noConsent.status, 400);
  assert.equal(noConsent.body.field, "consent");

  const ok1 = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "Priya", email: "priya@customer.test" },
    fuelKey: "solar",
    requiredEquipment: [{ equipmentId: panelId, name: "550W Panel", qty: 10, unit: "unit" }],
    selectedSupplierIds: [supplier.body.supplier._id],
    consent: { given: true, consentText: "I agree to share my details with the selected supplier(s)." },
  });
  assert.equal(ok1.status, 201, JSON.stringify(ok1.body));
  assert.match(ok1.body.enquiry.referenceId, /^RFQ-/);

  const ok2 = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Raj", email: "raj@customer.test" }, fuelKey: "solar" });
  assert.equal(ok2.status, 201);
  assert.notEqual(ok1.body.enquiry.referenceId, ok2.body.enquiry.referenceId);

  const stored = await EnergyEnquiry.findOne({ referenceId: ok1.body.enquiry.referenceId }).lean();
  assert.equal(stored.companyId, "acme");
  assert.equal(stored.source, "widget");
  assert.equal(stored.consent.given, true);
  assert.deepEqual(stored.consent.supplierIdsCovered.map(String), [supplier.body.supplier._id]);
  assert.equal(stored.statusHistory.length, 1);
});

// ===================== ADMIN DASHBOARD =====================

test("admin enquiry dashboard: list with status counts/filters, detail, status transitions are auditable, notes, assignment", async () => {
  await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Priya", email: "priya@customer.test" }, fuelKey: "solar" });
  await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Raj", email: "raj@customer.test" }, fuelKey: "cng" });

  const list = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries`);
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 2);
  assert.equal(list.body.counts.new, 2);
  assert.equal(list.body.counts.total, 2);

  const filtered = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries?fuelKey=cng`);
  assert.equal(filtered.body.enquiries.length, 1);

  const enquiryId = list.body.enquiries[0]._id;
  const detail = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.enquiry.customer.name, list.body.enquiries[0].customer.name);

  const badStatus = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/status`, { status: "not_a_real_status" });
  assert.equal(badStatus.status, 400);

  const statusChange = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/status`, { status: "under_review", note: "Looks good, reviewing requirements." });
  assert.equal(statusChange.status, 200);
  assert.equal(statusChange.body.enquiry.status, "under_review");
  assert.equal(statusChange.body.enquiry.statusHistory.length, 2, "the original 'new' entry plus this transition");

  const note = await sa("POST", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/notes`, { text: "Called the customer, confirmed location." });
  assert.equal(note.status, 200);
  assert.equal(note.body.enquiry.internalNotes.length, 1);

  const companyUser = new AdminUser({ name: "Manager", email: "manager2@acme.test", role: "CHATBOT_MANAGER" });
  await companyUser.setPassword("password123");
  await companyUser.save();
  await UserCompanyAccess.create({ userId: companyUser._id, companyId: "acme", role: "CHATBOT_MANAGER", accessScope: "COMPANY", status: "ACTIVE" });
  const assign = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/assign`, { assignedTo: String(companyUser._id) });
  assert.equal(assign.status, 200, JSON.stringify(assign.body));
  assert.equal(assign.body.enquiry.assignedTo, String(companyUser._id));

  const assignOutsider = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/assign`, { assignedTo: "000000000000000000000000" });
  assert.equal(assignOutsider.status, 400, "can't assign to a user with no access to this chatbot");
});

test("enquiries are tenant-isolated", async () => {
  await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Priya", email: "priya@customer.test" }, fuelKey: "solar" });
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherList = await sa("GET", `/chatbots/${otherChatbots[0]._id}/energy/enquiries`);
  assert.equal(otherList.body.total, 0);
});

test("notifySuppliers: refuses without consent, and honestly reports mail as not-configured in tests", async () => {
  const supplier = await sa("POST", `/chatbots/${chatbotId}/energy/suppliers`, { name: "Acme Solar Supplies", email: "sales@acmesolar.test", supportedFuelKeys: ["solar"], equipmentIds: [panelId] });
  const enquiryRes = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "Priya", email: "priya@customer.test" },
    fuelKey: "solar",
    requiredEquipment: [{ equipmentId: panelId, name: "550W Panel", qty: 5, unit: "unit" }],
    selectedSupplierIds: [supplier.body.supplier._id],
    consent: { given: true, consentText: "ok" },
  });
  const stored = await EnergyEnquiry.findOne({ referenceId: enquiryRes.body.enquiry.referenceId }).lean();

  const notified = await sa("POST", `/chatbots/${chatbotId}/energy/enquiries/${stored._id}/notify-suppliers`);
  assert.equal(notified.status, 200, JSON.stringify(notified.body));
  assert.equal(notified.body.results.length, 1);
  assert.equal(notified.body.results[0].sent, false);
  assert.equal(notified.body.results[0].reason, "not-configured", "SMTP is never configured in tests — this must be reported honestly, not faked as sent");

  const noConsentEnquiry = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Raj", email: "raj@customer.test" }, fuelKey: "solar" });
  const noConsentStored = await EnergyEnquiry.findOne({ referenceId: noConsentEnquiry.body.enquiry.referenceId }).lean();
  const blocked = await sa("POST", `/chatbots/${chatbotId}/energy/enquiries/${noConsentStored._id}/notify-suppliers`);
  assert.equal(blocked.status, 400);
});
