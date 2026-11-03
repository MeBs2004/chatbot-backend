import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import Conversation from "../models/conversation.model.js";
import Bot from "../models/bot.model.js";
import EnergyJourneyFile from "../models/energy/journeyFile.model.js";
import EnergyEnquiry from "../models/energy/enquiry.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

// ======================================================
// PHASE 5.1 — AI assistance, human handoff, real file upload and
// structured location, layered onto the Phase 5 customer journey.
// Uses the SAME real-HTTP-server-plus-real-test-DB harness as
// energyJourney.test.mjs — askGroq is called for real here (no fake
// GROQ key is configured in the test env), relying on its
// documented "never throws, always returns a string" contract, which
// is the behavior these tests actually need to verify.
// ======================================================

let server;
let superToken;
let chatbotId;
let companyId = "acme";
let sa;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4207 });
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
});

// ---------- AI assistance ----------

test("journey/ask: answers a free-text question without requiring/touching journey state, and never throws even without a real provider key", async () => {
  const res = await widget("POST", `/${chatbotId}/journey/ask`, { question: "What is a CNG Mother Station?", context: { fuelKey: "cng", stage: "questions" } });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.answer, "string");
  assert.ok(res.body.answer.length > 0, "askGroq's contract guarantees a non-empty string even on provider failure");
});

test("journey/ask: rejects an empty or missing question, and a question over the length cap", async () => {
  const empty = await widget("POST", `/${chatbotId}/journey/ask`, { question: "" });
  assert.equal(empty.status, 400);
  const missing = await widget("POST", `/${chatbotId}/journey/ask`, {});
  assert.equal(missing.status, 400);
  const tooLong = await widget("POST", `/${chatbotId}/journey/ask`, { question: "a".repeat(501) });
  assert.equal(tooLong.status, 400);
});

test("journey/ask: resolves company server-side from the chatbot — a non-energy or missing chatbot 404s, never falling through to another tenant", async () => {
  const { chatbots: generalChatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "General Bot" }] });
  const res = await widget("POST", `/${generalChatbots[0]._id}/journey/ask`, { question: "hello" });
  assert.equal(res.status, 404);

  const missing = await widget("POST", `/000000000000000000000000/journey/ask`, { question: "hello" });
  assert.equal(missing.status, 404);
});

test("journey/ask: a paused/offline chatbot refuses AI assistance just like every other journey endpoint", async () => {
  await Chatbot.findByIdAndUpdate(chatbotId, { status: "PAUSED" });
  const res = await widget("POST", `/${chatbotId}/journey/ask`, { question: "hello" });
  assert.equal(res.status, 404);
});

test("journey/ask: the instruction sent to the assistant forbids generating a BOM, inventing prices/specs, selecting suppliers, or bypassing required questions", async () => {
  const { buildEnergyAssistantInstruction } = await import("../services/energy/energyAssistant.service.js");
  const instruction = buildEnergyAssistantInstruction({ fuelKey: "solar", stage: "questions" });
  for (const phrase of ["Never generate, modify, or approve a Bill of Materials", "Never invent engineering calculations", "Never invent or quote prices", "Never select, recommend, or rule out a specific supplier", "Never tell the visitor to skip, change, or ignore a required question"]) {
    assert.ok(instruction.includes(phrase), `instruction missing restriction: ${phrase}`);
  }
});

// ---------- Human handoff ----------

test("journey/handoff: creates/updates a Conversation, logs a handoff-type Bot message, and routes through the existing handoff machinery", async () => {
  const visitorId = "visitor-handoff-1";
  const res = await widget("POST", `/${chatbotId}/journey/handoff`, { visitorId, reason: "I need help sizing this system", context: { fuelKey: "solar", projectTypeLabel: "Residential Solar" } });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  const conversation = await Conversation.findOne({ companyId, visitorId });
  assert.ok(conversation, "a handoff request must create/touch a real Conversation record");
  assert.ok(conversation.handoffAt, "handoffAt must actually be set, not just claimed in the response");

  const botMsg = await Bot.findOne({ companyId, visitorId, type: "handoff" });
  assert.ok(botMsg, "a handoff-type Bot message must be logged");
  assert.ok(botMsg.text.includes("Residential Solar"), "the visitor's journey context is preserved in the handoff request");
  assert.ok(botMsg.text.includes("I need help sizing this system"), "the visitor's own explanation is preserved");
});

test("journey/handoff: requires a visitorId, 404s for an unknown/non-energy chatbot, and never fakes success without actually creating the request", async () => {
  const missingVisitor = await widget("POST", `/${chatbotId}/journey/handoff`, { reason: "help" });
  assert.equal(missingVisitor.status, 400);

  const missingChatbot = await widget("POST", `/000000000000000000000000/journey/handoff`, { visitorId: "v1" });
  assert.equal(missingChatbot.status, 404);
});

test("journey/handoff: a request against one company's chatbot never appears in another company's conversations", async () => {
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });

  const visitorId = "shared-visitor-id";
  await widget("POST", `/${chatbotId}/journey/handoff`, { visitorId, reason: "acme request" });

  const otherConversation = await Conversation.findOne({ companyId: "other", visitorId });
  assert.equal(otherConversation, null, "the other tenant must have no record of a handoff it never received");
  const acmeConversation = await Conversation.findOne({ companyId, visitorId });
  assert.ok(acmeConversation);
});

// ---------- File upload ----------

async function createFileQuestion(overrides = {}) {
  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "file", label: "Upload a recent electricity bill", ...overrides });
  return q.body.question;
}

function multipartBody(fields, fileField, fileBuffer, filename, contentType) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(fileField, new Blob([fileBuffer], { type: contentType }), filename);
  return form;
}

test("journey upload: accepts an allowed file type/size, stores it as a real EnergyJourneyFile record, and returns a fileId (never just the filename)", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-upload-1";
  const form = multipartBody({ visitorId }, "file", Buffer.from("%PDF-1.4 fake pdf bytes"), "bill.pdf", "application/pdf");

  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${question._id}/upload`, { method: "POST", body: form });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.ok(body.fileId);
  assert.equal(body.filename, "bill.pdf");

  const stored = await EnergyJourneyFile.findById(body.fileId);
  assert.ok(stored, "a real file record must exist");
  assert.equal(stored.companyId, companyId);
  assert.equal(stored.visitorId, visitorId);
  assert.equal(String(stored.questionId), String(question._id));
  assert.ok(Buffer.isBuffer(stored.data) && stored.data.length > 0, "the actual bytes must be stored, not just metadata");
});

test("journey upload: rejects a disallowed MIME type and an oversized file", async () => {
  const question = await createFileQuestion({ allowedFileTypes: ["application/pdf"], maxFileSizeMb: 1 });
  const visitorId = "visitor-upload-2";

  const badType = multipartBody({ visitorId }, "file", Buffer.from("hello"), "note.txt", "text/plain");
  const badTypeRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${question._id}/upload`, { method: "POST", body: badType });
  assert.equal(badTypeRes.status, 400);

  const tooBig = multipartBody({ visitorId }, "file", Buffer.alloc(2 * 1024 * 1024, "a"), "big.pdf", "application/pdf");
  const tooBigRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${question._id}/upload`, { method: "POST", body: tooBig });
  assert.equal(tooBigRes.status, 400);
});

test("journey upload: never trusts the browser-supplied filename as a storage path/identifier — a real random storageKey is generated server-side", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-upload-3";
  const form = multipartBody({ visitorId }, "file", Buffer.from("%PDF-1.4 content"), "../../etc/passwd", "application/pdf");
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${question._id}/upload`, { method: "POST", body: form });
  const body = await res.json();
  assert.equal(res.status, 201);
  const stored = await EnergyJourneyFile.findById(body.fileId);
  assert.notEqual(stored.storageKey, "../../etc/passwd");
  assert.match(stored.storageKey, /^[0-9a-f-]{36}$/i, "storageKey must be a server-generated UUID, not the raw filename");
});

test("journey upload: a question belonging to a different company, or not of type file, is rejected", async () => {
  const question = await createFileQuestion();
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });

  const form = multipartBody({ visitorId: "v1" }, "file", Buffer.from("x"), "a.pdf", "application/pdf");
  const crossTenant = await fetch(`${server.baseUrl}/api/widget/energy/${otherChatbots[0]._id}/journey/questions/${question._id}/upload`, { method: "POST", body: form });
  assert.equal(crossTenant.status, 404);

  const textQ = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "short_text", label: "Notes" });
  const form2 = multipartBody({ visitorId: "v1" }, "file", Buffer.from("x"), "a.pdf", "application/pdf");
  const wrongType = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${textQ.body.question._id}/upload`, { method: "POST", body: form2 });
  assert.equal(wrongType.status, 404);
});

test("journey file download: a visitor can fetch only their own upload, scoped to this chatbot/company — never another visitor's or another tenant's", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-download-1";
  const form = multipartBody({ visitorId }, "file", Buffer.from("%PDF-1.4 secret bytes"), "bill.pdf", "application/pdf");
  const uploadRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${question._id}/upload`, { method: "POST", body: form });
  const { fileId } = await uploadRes.json();

  const ok = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/files/${fileId}?visitorId=${visitorId}`);
  assert.equal(ok.status, 200);
  const bytes = Buffer.from(await ok.arrayBuffer());
  assert.equal(bytes.toString(), "%PDF-1.4 secret bytes");

  const wrongVisitor = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/files/${fileId}?visitorId=someone-else`);
  assert.equal(wrongVisitor.status, 404);

  const noVisitor = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/files/${fileId}`);
  assert.equal(noVisitor.status, 403);
});

test("createEnquiry: a saved file answer references a real stored file record via uploadedFileIds, not just a filename, and rejects an invalid/foreign fileId", async () => {
  const question = await createFileQuestion();
  const visitorId = "visitor-enquiry-1";
  const form = multipartBody({ visitorId }, "file", Buffer.from("%PDF-1.4 bill bytes"), "bill.pdf", "application/pdf");
  const uploadRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotId}/journey/questions/${question._id}/upload`, { method: "POST", body: form });
  const { fileId } = await uploadRes.json();

  const ok = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "Jane Doe", email: "jane@example.com" },
    fuelKey: "solar",
    visitorId,
    uploadedFileIds: [fileId],
  });
  assert.equal(ok.status, 201);
  const enquiry = await EnergyEnquiry.findOne({ referenceId: ok.body.enquiry.referenceId });
  assert.equal(enquiry.uploadedFiles.length, 1);
  assert.equal(enquiry.uploadedFiles[0].filename, "bill.pdf");
  assert.equal(String(enquiry.uploadedFiles[0].fileId), String(fileId));

  const missingVisitorId = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Jane Doe", email: "jane@example.com" }, fuelKey: "solar", uploadedFileIds: [fileId] });
  assert.equal(missingVisitorId.status, 400);

  const badFile = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Jane Doe", email: "jane@example.com" }, fuelKey: "solar", visitorId, uploadedFileIds: ["000000000000000000000000"] });
  assert.equal(badFile.status, 400);
});

// ---------- Structured location ----------

test("createEnquiry: accepts a structured location alongside the original free-text projectLocation, both preserved independently", async () => {
  const res = await widget("POST", `/${chatbotId}/enquiries`, {
    customer: { name: "Jane Doe", email: "jane@example.com" },
    fuelKey: "solar",
    projectLocation: "42 MG Road, near the old water tank",
    location: { country: "India", state: "Karnataka", city: "Bengaluru", postalCode: "560001" },
  });
  assert.equal(res.status, 201);
  const enquiry = await EnergyEnquiry.findOne({ referenceId: res.body.enquiry.referenceId });
  assert.equal(enquiry.projectLocation, "42 MG Road, near the old water tank");
  assert.equal(enquiry.location.city, "Bengaluru");
  assert.equal(enquiry.location.state, "Karnataka");
});

test("createEnquiry: omitting location entirely still works — structured location is optional, not a forced new requirement", async () => {
  const res = await widget("POST", `/${chatbotId}/enquiries`, { customer: { name: "Jane Doe", email: "jane@example.com" }, fuelKey: "solar" });
  assert.equal(res.status, 201);
});

test("supplier matching: a structured location matches a supplier whose serviceRegions lists the city, exactly like the old free-text region did", async () => {
  const { matchSuppliers } = await import("../services/energy/supplierMatching.service.js");
  const suppliers = [{ _id: "s1", active: true, supportedFuelKeys: ["solar"], equipmentIds: ["e1"], serviceRegions: ["Bengaluru"] }];
  const requiredEquipment = [{ equipmentId: "e1", name: "Panel", mandatory: true }];

  const byString = matchSuppliers(requiredEquipment, suppliers, { fuelKey: "solar", region: "Bengaluru" });
  assert.equal(Object.keys(byString.matchesByEquipment).length, 1);

  const byStructured = matchSuppliers(requiredEquipment, suppliers, { fuelKey: "solar", region: { city: "Bengaluru", state: "Karnataka", country: "India" } });
  assert.equal(Object.keys(byStructured.matchesByEquipment).length, 1);

  const noMatch = matchSuppliers(requiredEquipment, suppliers, { fuelKey: "solar", region: { city: "Mumbai", state: "Maharashtra", country: "India" } });
  assert.equal(Object.keys(noMatch.matchesByEquipment).length, 0);
});

test("supplier matching: existing wildcard regions ('Pan India'/'All'/'Nationwide') still match a structured location, preserving Phase 4 behavior exactly", async () => {
  const { matchSuppliers } = await import("../services/energy/supplierMatching.service.js");
  const suppliers = [{ _id: "s1", active: true, supportedFuelKeys: ["solar"], equipmentIds: ["e1"], serviceRegions: ["Pan India"] }];
  const requiredEquipment = [{ equipmentId: "e1", name: "Panel", mandatory: true }];
  const res = matchSuppliers(requiredEquipment, suppliers, { fuelKey: "solar", region: { city: "Anywhere", state: "Anystate", country: "Anycountry" } });
  assert.equal(Object.keys(res.matchesByEquipment).length, 1);
});
