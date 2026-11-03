import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import EnergyEnquiry from "../models/energy/enquiry.model.js";
import EnergyJourneyFile from "../models/energy/journeyFile.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

// ======================================================
// PHASE 5.2 — admin operational completion: RFQ attachments, structured
// location display plumbing, assignment cross-tenant safety, supplier
// notification location formatting, publish warnings, file-question
// config validation, duplicate-RFQ idempotency, and file magic-byte
// validation. Same real-HTTP-server-plus-real-test-DB harness as every
// other Energy test file.
// ======================================================

let server;
let superToken;
let chatbotId;
let solarProjectTypeId;
let panelId;
let sa;
const companyId = "acme";

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4208 });
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

  const pts = await sa("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=solar`);
  solarProjectTypeId = pts.body.items.find((i) => i.label === "Residential Solar")._id;
  const panel = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Panel", fuelKey: "solar", category: "panel" });
  panelId = panel.body.item._id;
});

function multipartBody(fields, fileField, fileBuffer, filename, contentType) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(fileField, new Blob([fileBuffer], { type: contentType }), filename);
  return form;
}

async function createFileQuestion(overrides = {}) {
  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "file", label: "Upload a bill", ...overrides });
  return q.body.question;
}

async function uploadRealPdf(questionId, visitorId, bytes = "%PDF-1.4 real pdf bytes") {
  const form = multipartBody({ visitorId }, "file", Buffer.from(bytes), "bill.pdf", "application/pdf");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${questionId}/upload`, { method: "POST", body: form });
  return res.json();
}

// ---------- TASK 1: attachments ----------

test("A1: authorized admin can list and download an enquiry's attachments, metadata matches the real stored file", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-1";
  const { fileId } = await uploadRealPdf(question._id, visitorId);
  const created = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Jane", email: "jane@example.com" }, fuelKey: "solar", visitorId, uploadedFileIds: [fileId] });
  const enquiryId = (await EnergyEnquiry.findOne({ referenceId: created.body.enquiry.referenceId }))._id;

  const list = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/attachments`);
  assert.equal(list.status, 200);
  assert.equal(list.body.attachments.length, 1);
  assert.equal(list.body.attachments[0].filename, "bill.pdf");
  assert.equal(list.body.attachments[0].contentType, "application/pdf");
  assert.ok(list.body.attachments[0].size > 0);
  assert.ok(list.body.attachments[0].uploadedAt, "upload date should be resolved from the source file record");

  const download = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/attachments/${fileId}/download`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-disposition").includes("attachment"), true, "must never be served inline");
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.toString(), "%PDF-1.4 real pdf bytes");
});

test("A2: another company cannot list or download this enquiry's attachments", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-2";
  const { fileId } = await uploadRealPdf(question._id, visitorId);
  const created = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Jane", email: "jane@example.com" }, fuelKey: "solar", visitorId, uploadedFileIds: [fileId] });
  const enquiryId = (await EnergyEnquiry.findOne({ referenceId: created.body.enquiry.referenceId }))._id;

  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });

  const listOther = await sa("GET", `/chatbots/${otherChatbots[0]._id}/energy/enquiries/${enquiryId}/attachments`);
  assert.equal(listOther.status, 404, "the enquiry doesn't belong to that chatbot/company");

  const downloadOther = await fetch(`${server.baseUrl}/api/admin/chatbots/${otherChatbots[0]._id}/energy/enquiries/${enquiryId}/attachments/${fileId}/download`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(downloadOther.status, 404);
});

test("A3: a real EnergyJourneyFile that exists but isn't referenced by THIS enquiry cannot be downloaded through it", async () => {
  const question = await createFileQuestion();
  const visitorA = "visitor-a";
  const visitorB = "visitor-b";
  const fileA = await uploadRealPdf(question._id, visitorA, "%PDF-1.4 file A");
  const fileB = await uploadRealPdf(question._id, visitorB, "%PDF-1.4 file B");

  const enquiryA = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: visitorA, uploadedFileIds: [fileA.fileId] });
  const enquiryAId = (await EnergyEnquiry.findOne({ referenceId: enquiryA.body.enquiry.referenceId }))._id;

  // fileB is a real, valid, same-company file — just never attached to enquiryA.
  const crossEnquiry = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/enquiries/${enquiryAId}/attachments/${fileB.fileId}/download`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(crossEnquiry.status, 404, "a file not in this enquiry's uploadedFiles must never be downloadable through it");
});

test("A4: missing/deleted file is handled safely, not a 500", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-4";
  const { fileId } = await uploadRealPdf(question._id, visitorId);
  const created = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Jane", email: "jane@example.com" }, fuelKey: "solar", visitorId, uploadedFileIds: [fileId] });
  const enquiryId = (await EnergyEnquiry.findOne({ referenceId: created.body.enquiry.referenceId }))._id;

  await EnergyJourneyFile.deleteOne({ _id: fileId });

  const download = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/attachments/${fileId}/download`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(download.status, 404);

  const list = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/attachments`);
  assert.equal(list.status, 200);
  assert.equal(list.body.attachments[0].uploadedAt, null, "a deleted source file still shows the snapshot metadata, with no uploadedAt");
});

test("an enquiry with no attachments returns an empty array, not an error", async () => {
  const created = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "No Files", email: "nofiles@example.com" }, fuelKey: "solar" });
  const enquiryId = (await EnergyEnquiry.findOne({ referenceId: created.body.enquiry.referenceId }))._id;
  const list = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/attachments`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.attachments, []);
});

// ---------- TASK 2: structured location (backend contract) ----------

test("B1/B2/B3: enquiry detail API returns complete, partial, and legacy-only location correctly", async () => {
  const complete = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", location: { country: "India", state: "Karnataka", city: "Bengaluru", postalCode: "560001" } });
  const partial = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "B", email: "b@example.com" }, fuelKey: "solar", location: { city: "Pune" } });
  const legacyOnly = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "C", email: "c@example.com" }, fuelKey: "solar", projectLocation: "Old-style address, no structured fields" });

  const completeId = (await EnergyEnquiry.findOne({ referenceId: complete.body.enquiry.referenceId }))._id;
  const partialId = (await EnergyEnquiry.findOne({ referenceId: partial.body.enquiry.referenceId }))._id;
  const legacyId = (await EnergyEnquiry.findOne({ referenceId: legacyOnly.body.enquiry.referenceId }))._id;

  const completeDetail = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${completeId}`);
  assert.equal(completeDetail.body.enquiry.location.city, "Bengaluru");
  assert.equal(completeDetail.body.enquiry.location.postalCode, "560001");

  const partialDetail = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${partialId}`);
  assert.equal(partialDetail.body.enquiry.location.city, "Pune");
  assert.equal(partialDetail.body.enquiry.location.state, "");

  const legacyDetail = await sa("GET", `/chatbots/${chatbotId}/energy/enquiries/${legacyId}`);
  assert.equal(legacyDetail.body.enquiry.location.city, "", "no structured fields were sent");
  assert.equal(legacyDetail.body.enquiry.projectLocation, "Old-style address, no structured fields");
});

// ---------- TASK 3: assignment cross-tenant safety ----------

test("C1/C2: authorized in-company assignment works; a real admin from a DIFFERENT company cannot be assigned", async () => {
  const created = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar" });
  const enquiryId = (await EnergyEnquiry.findOne({ referenceId: created.body.enquiry.referenceId }))._id;

  const companyUser = new AdminUser({ name: "Teammate", email: "teammate@acme.test", role: "CHATBOT_MANAGER" });
  await companyUser.setPassword("password123");
  await companyUser.save();
  await UserCompanyAccess.create({ userId: companyUser._id, companyId, role: "CHATBOT_MANAGER", accessScope: "COMPANY", status: "ACTIVE" });

  const assign = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/assign`, { assignedTo: String(companyUser._id) });
  assert.equal(assign.status, 200);
  assert.equal(assign.body.enquiry.assignedTo, String(companyUser._id));

  // A real admin user, but belonging to a different company entirely.
  const outsiderUser = new AdminUser({ name: "Outsider", email: "outsider@other.test", role: "CHATBOT_MANAGER" });
  await outsiderUser.setPassword("password123");
  await outsiderUser.save();
  await UserCompanyAccess.create({ userId: outsiderUser._id, companyId: "other", role: "CHATBOT_MANAGER", accessScope: "COMPANY", status: "ACTIVE" });

  const assignOutsider = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/assign`, { assignedTo: String(outsiderUser._id) });
  assert.equal(assignOutsider.status, 400, "a real admin with access to a DIFFERENT company must still be rejected");

  // Unassign (supported via null).
  const unassign = await sa("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/assign`, { assignedTo: null });
  assert.equal(unassign.status, 200);
  assert.equal(unassign.body.enquiry.assignedTo, null);
});

test("C3: a user with no access to this company/chatbot at all cannot even reach the assignment endpoint", async () => {
  const created = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar" });
  const enquiryId = (await EnergyEnquiry.findOne({ referenceId: created.body.enquiry.referenceId }))._id;

  const noAccessUser = new AdminUser({ name: "NoAccess", email: "noaccess@test", role: "CHATBOT_MANAGER" });
  await noAccessUser.setPassword("password123");
  await noAccessUser.save();
  const token = jwt.sign({ sub: String(noAccessUser._id), role: "CHATBOT_MANAGER", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  const res = await admin(token)("PATCH", `/chatbots/${chatbotId}/energy/enquiries/${enquiryId}/assign`, { assignedTo: String(noAccessUser._id) });
  assert.equal(res.status, 403);
});

// Task 4's HTTP-level notifySuppliers test lives in its own file
// (energyNotificationLocation.test.mjs) for the same rate-limit-bucket
// reason as Task 7's idempotency tests — see that file's header note.

test("formatEnquiryLocation: structured fields take priority, partial fields render only what exists, legacy fallback, and 'Not provided' when both are empty", async () => {
  const { formatEnquiryLocation } = await import("../services/energy/enquiryLocation.service.js");
  assert.equal(formatEnquiryLocation({ location: { city: "Noida", state: "Uttar Pradesh", country: "India", postalCode: "201301" }, projectLocation: "ignored legacy text" }), "City: Noida\nState: Uttar Pradesh\nCountry: India\nPostal Code: 201301");
  assert.equal(formatEnquiryLocation({ location: { city: "Pune" }, projectLocation: "ignored" }), "City: Pune");
  assert.equal(formatEnquiryLocation({ location: {}, projectLocation: "42 MG Road" }), "42 MG Road");
  assert.equal(formatEnquiryLocation({ location: {}, projectLocation: "" }), "Not provided");
});

// ---------- TASK 5: publish validation warnings ----------

async function enableSolarAndResidential() {
  const products = await sa("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=solar`);
  const offering = products.body.items.find((i) => i.label === "Solar Panels");
  await sa("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledFuelKeys: ["solar"], enabledProductServiceIds: [offering._id], enabledProjectTypeIds: [solarProjectTypeId] });
}

test("E1: publishing with an enabled project type that has no approved template produces a warning, not a block", async () => {
  await enableSolarAndResidential();
  const before = await sa("GET", `/chatbots/${chatbotId}/energy/config/publish-warnings`);
  assert.equal(before.status, 200);
  assert.equal(before.body.warnings.missingTemplates.length, 1);
  assert.equal(before.body.warnings.missingTemplates[0].fuelKey, "solar");

  const publish = await sa("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(publish.status, 200, "a missing template must never block publishing");
  assert.equal(publish.body.config.status, "PUBLISHED");
  assert.equal(publish.body.warnings.missingTemplates.length, 1);
});

test("E2: an approved template for every enabled project type produces zero false warnings", async () => {
  await enableSolarAndResidential();
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, { name: "Residential Solar BOM", fuelKey: "solar", projectTypeId: solarProjectTypeId, outputTypes: ["bom"], equipmentMappings: [{ equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 10 } }] });
  await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${created.body.template._id}/submit`);
  await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${created.body.template._id}/approve`);

  const warnings = await sa("GET", `/chatbots/${chatbotId}/energy/config/publish-warnings`);
  assert.deepEqual(warnings.body.warnings.missingTemplates, []);

  const publish = await sa("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.deepEqual(publish.body.warnings.missingTemplates, []);
});

test("E3: existing publication behavior (at least one fuel, at least one offering) is unchanged", async () => {
  const empty = await sa("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(empty.status, 400);
});

// ---------- TASK 6: file question config validation ----------

test("F1: admin can save supported file types and a valid size", async () => {
  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "file", label: "Upload", allowedFileTypes: ["application/pdf", "image/png"], maxFileSizeMb: 5 });
  assert.equal(q.status, 201);
  assert.deepEqual(q.body.question.allowedFileTypes, ["application/pdf", "image/png"]);
  assert.equal(q.body.question.maxFileSizeMb, 5);
});

test("F2: an unsupported type or an invalid/oversized limit is rejected", async () => {
  const badType = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "file", label: "Upload", allowedFileTypes: ["application/x-msdownload"] });
  assert.equal(badType.status, 400);

  const negativeSize = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "file", label: "Upload", maxFileSizeMb: -1 });
  assert.equal(negativeSize.status, 400);

  const overHardCap = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "file", label: "Upload", maxFileSizeMb: 999 });
  assert.equal(overHardCap.status, 400);
});

test("F3: the upload endpoint actually enforces the saved per-question configuration", async () => {
  const q = await createFileQuestion({ allowedFileTypes: ["image/png"], maxFileSizeMb: 1 });
  const form = multipartBody({ visitorId: "v1" }, "file", Buffer.from("%PDF-1.4 x"), "doc.pdf", "application/pdf");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: form });
  assert.equal(res.status, 400, "a PDF must be rejected when the question only allows PNG");
});

test("existing questions with no allowedFileTypes/maxFileSizeMb configured keep working with platform defaults", async () => {
  const q = await createFileQuestion(); // no overrides
  const { fileId, filename } = await uploadRealPdf(q._id, "v1");
  assert.ok(fileId);
  assert.equal(filename, "bill.pdf");
});

test("GET file-upload-policy exposes the supported catalogue the admin UI should render", async () => {
  const res = await sa("GET", `/chatbots/${chatbotId}/energy/file-upload-policy`);
  assert.equal(res.status, 200);
  assert.ok(res.body.supportedTypes.some((t) => t.mime === "application/pdf"));
  assert.equal(res.body.hardMaxSizeMb, 25);
});

// Task 7 (duplicate-RFQ idempotency) lives in its own file
// (energyIdempotentRfq.test.mjs) — it alone needs more createEnquiry
// calls than the real 10/min enquiryLimiter allows on a single shared
// server instance, so it gets its own server/port and therefore its
// own rate-limit bucket, exactly like every other Energy test file
// already gets its own port for the same reason.

// ---------- TASK 8: magic-byte validation ----------

test("H1: a genuine PDF, PNG, and JPEG are accepted", async () => {
  const q = await createFileQuestion();
  const pdf = multipartBody({ visitorId: "v1" }, "file", Buffer.from("%PDF-1.4 genuine"), "a.pdf", "application/pdf");
  const pdfRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: pdf });
  assert.equal(pdfRes.status, 201);

  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const png = multipartBody({ visitorId: "v2" }, "file", pngBytes, "a.png", "image/png");
  const pngRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: png });
  assert.equal(pngRes.status, 201);

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const jpeg = multipartBody({ visitorId: "v3" }, "file", jpegBytes, "a.jpg", "image/jpeg");
  const jpegRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: jpeg });
  assert.equal(jpegRes.status, 201);
});

test("H2: a spoofed MIME type (real PNG bytes labeled as PDF) is rejected", async () => {
  const q = await createFileQuestion();
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const spoofed = multipartBody({ visitorId: "v1" }, "file", pngBytes, "a.pdf", "application/pdf");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: spoofed });
  assert.equal(res.status, 400);
});

test("H3: a file extension renamed to look like an allowed type, but with unrelated content, is rejected by signature, not by extension", async () => {
  const q = await createFileQuestion();
  const notReallyAPdf = multipartBody({ visitorId: "v1" }, "file", Buffer.from("just some plain text, not a real pdf"), "fake.pdf", "application/pdf");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: notReallyAPdf });
  assert.equal(res.status, 400);
});

test("H4: an empty file is rejected", async () => {
  const q = await createFileQuestion();
  const empty = multipartBody({ visitorId: "v1" }, "file", Buffer.alloc(0), "empty.pdf", "application/pdf");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: empty });
  assert.equal(res.status, 400);
});

test("H5: an unsupported file type is rejected before signature checking even applies", async () => {
  const q = await createFileQuestion();
  const exe = multipartBody({ visitorId: "v1" }, "file", Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "virus.exe", "application/x-msdownload");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${q._id}/upload`, { method: "POST", body: exe });
  assert.equal(res.status, 400);
});

// ---------- TASK 9: tenant isolation sweep for new endpoints ----------

test("I: none of the new Phase 5.2 endpoints leak another tenant's data", async () => {
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });

  const policy = await sa("GET", `/chatbots/${otherChatbots[0]._id}/energy/file-upload-policy`);
  assert.equal(policy.status, 200, "this endpoint returns platform-wide policy, not tenant data — just confirming it's reachable per-chatbot");

  const warnings = await sa("GET", `/chatbots/${otherChatbots[0]._id}/energy/config/publish-warnings`);
  assert.equal(warnings.status, 200);
  assert.deepEqual(warnings.body.warnings.missingTemplates, [], "the other company has no config at all yet — never this company's warnings");
});
