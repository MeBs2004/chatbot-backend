import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

let server;
let superToken;
let chatbotId;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4203 });
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(async () => {
  await resetDb();
  await ensureEnergyDefaults();

  const superUser = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await superUser.setPassword("password123");
  await superUser.save();
  superToken = jwt.sign({ sub: String(superUser._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });

  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Energy Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "energy" });
});

const admin = (method, path, body) =>
  fetch(`${server.baseUrl}/api/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${superToken}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const upload = (path, formData) =>
  fetch(`${server.baseUrl}/api/admin${path}`, { method: "POST", headers: { Authorization: `Bearer ${superToken}` }, body: formData }).then(async (r) => ({ status: r.status, body: await r.json() }));

// ===================== QUESTIONS =====================

test("question CRUD: create validates shape, update edits fields, delete removes it", async () => {
  const missingLabel = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "short_text" });
  assert.equal(missingLabel.status, 400);

  const needsOptions = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "dropdown", label: "Station type?", options: ["only one"] });
  assert.equal(needsOptions.status, 400);

  const needsUnit = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "number_unit", label: "Daily capacity?" });
  assert.equal(needsUnit.status, 400);

  const created = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, {
    fuelKey: "cng",
    type: "number_unit",
    label: "What is your expected daily gas capacity?",
    unit: "kg/day",
    required: true,
    allowUnknown: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const questionId = created.body.question._id;

  const updated = await admin("PATCH", `/chatbots/${chatbotId}/energy/questions/${questionId}`, { label: "Expected daily gas capacity (kg/day)?", required: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.question.required, false);

  const listed = await admin("GET", `/chatbots/${chatbotId}/energy/questions?fuelKey=cng`);
  assert.equal(listed.body.questions.length, 1);

  const deleted = await admin("DELETE", `/chatbots/${chatbotId}/energy/questions/${questionId}`);
  assert.equal(deleted.status, 200);
  const afterDelete = await admin("GET", `/chatbots/${chatbotId}/energy/questions?fuelKey=cng`);
  assert.equal(afterDelete.body.questions.length, 0);
});

test("questions can be scoped to a specific project type, and reordered", async () => {
  const projectTypes = await admin("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=cng`);
  const motherStation = projectTypes.body.items.find((i) => i.label === "Mother Station");

  const badProjectType = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "short_text", label: "x", projectTypeId: motherStation._id });
  assert.equal(badProjectType.status, 400, "a CNG project type can't scope a Solar question");

  const q1 = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "short_text", label: "Pipeline availability?", projectTypeId: motherStation._id });
  const q2 = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "short_text", label: "Vehicle demand?", projectTypeId: motherStation._id });
  assert.equal(q1.status, 201);
  assert.equal(q2.status, 201);

  const listed = await admin("GET", `/chatbots/${chatbotId}/energy/questions?fuelKey=cng&projectTypeId=${motherStation._id}`);
  assert.deepEqual(listed.body.questions.map((q) => q.label), ["Pipeline availability?", "Vehicle demand?"]);

  const reordered = await admin("POST", `/chatbots/${chatbotId}/energy/questions/reorder`, {
    fuelKey: "cng",
    projectTypeId: motherStation._id,
    orderedIds: [q2.body.question._id, q1.body.question._id],
  });
  assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
  const afterReorder = await admin("GET", `/chatbots/${chatbotId}/energy/questions?fuelKey=cng&projectTypeId=${motherStation._id}`);
  assert.deepEqual(afterReorder.body.questions.map((q) => q.label), ["Vehicle demand?", "Pipeline availability?"]);
});

test("conditional questions: dependsOnQuestionId must exist under the same fuel, rejects self-reference and mutual cycles", async () => {
  const q1 = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "single_choice", label: "Battery backup required?", options: ["Yes", "No"] });
  const q1Id = q1.body.question._id;

  const foreignFuel = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "short_text", label: "Battery capacity?", dependsOnQuestionId: q1Id, dependsOnCondition: "equals", dependsOnValue: "Yes" });
  assert.equal(foreignFuel.status, 400, "can't depend on a question from a different fuel");

  const q2 = await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "number_unit", label: "Battery capacity?", unit: "kWh", dependsOnQuestionId: q1Id, dependsOnCondition: "equals", dependsOnValue: "Yes" });
  assert.equal(q2.status, 201, JSON.stringify(q2.body));

  const selfRef = await admin("PATCH", `/chatbots/${chatbotId}/energy/questions/${q1Id}`, { dependsOnQuestionId: q1Id });
  assert.equal(selfRef.status, 400);

  const mutualCycle = await admin("PATCH", `/chatbots/${chatbotId}/energy/questions/${q1Id}`, { dependsOnQuestionId: q2.body.question._id });
  assert.equal(mutualCycle.status, 400, "q2 already depends on q1 — making q1 depend on q2 would cycle");

  const deleteQ1 = await admin("DELETE", `/chatbots/${chatbotId}/energy/questions/${q1Id}`);
  assert.equal(deleteQ1.status, 200);
  const q2After = await admin("GET", `/chatbots/${chatbotId}/energy/questions?fuelKey=solar`);
  const q2Fetched = q2After.body.questions.find((q) => q._id === q2.body.question._id);
  assert.equal(q2Fetched.dependsOnQuestionId, null, "deleting the depended-on question clears the dangling reference");
});

test("questions are tenant-isolated: another company's questions never appear, even for the same fuel", async () => {
  await admin("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "cng", type: "short_text", label: "Acme-only question" });
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherList = await admin("GET", `/chatbots/${otherChatbots[0]._id}/energy/questions?fuelKey=cng`);
  assert.equal(otherList.body.questions.length, 0);
});

// ===================== EQUIPMENT =====================

test("equipment CRUD: create validates shape, rejects an invalid project type, update and delete work", async () => {
  const missingCategory = await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "Compressor X", fuelKey: "cng" });
  assert.equal(missingCategory.status, 400);

  const solarProjectTypes = await admin("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=solar`);
  const solarType = solarProjectTypes.body.items.find((i) => i.label === "Residential Solar");
  const cngProjectTypes = await admin("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=cng`);
  const cngType = cngProjectTypes.body.items[0];

  const mismatchedProjectType = await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, {
    name: "550W Panel",
    fuelKey: "solar",
    category: "panel",
    supportedProjectTypeIds: [cngType._id], // a CNG-fuel project type used on a solar item — invalid
  });
  assert.equal(mismatchedProjectType.status, 400, JSON.stringify(mismatchedProjectType.body));

  const created = await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, {
    name: "550W Mono Panel",
    fuelKey: "solar",
    category: "panel",
    manufacturer: "Acme Panels",
    modelNumber: "AP-550",
    capacityValue: 550,
    capacityUnit: "W",
    specs: { efficiencyPct: 21.3 },
    supportedProjectTypeIds: [solarType._id],
    price: 12000,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.item.specs.efficiencyPct, 21.3);

  const itemId = created.body.item._id;
  const updated = await admin("PATCH", `/chatbots/${chatbotId}/energy/equipment/${itemId}`, { price: 13000 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.item.price, 13000);

  const detail = await admin("GET", `/chatbots/${chatbotId}/energy/equipment/${itemId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.item.hasImage, false);
  assert.equal(detail.body.item.image, undefined, "binary data is never included in a normal JSON response");

  const deleted = await admin("DELETE", `/chatbots/${chatbotId}/energy/equipment/${itemId}`);
  assert.equal(deleted.status, 200);
  const afterDelete = await admin("GET", `/chatbots/${chatbotId}/energy/equipment/${itemId}`);
  assert.equal(afterDelete.status, 404);
});

test("equipment list supports search and filtering by fuel/category, and flags a possible duplicate on create", async () => {
  await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Mono Panel", fuelKey: "solar", category: "panel", manufacturer: "Acme Panels", modelNumber: "AP-550" });
  await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "5kW Hybrid Inverter", fuelKey: "solar", category: "inverter", manufacturer: "Acme Power", modelNumber: "INV-5K" });
  const dup = await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Mono Panel (Batch 2)", fuelKey: "solar", category: "panel", manufacturer: "Acme Panels", modelNumber: "AP-550" });
  assert.equal(dup.status, 201);
  assert.match(dup.body.duplicateWarning, /similar to an existing item/);

  const byCategory = await admin("GET", `/chatbots/${chatbotId}/energy/equipment?fuelKey=solar&category=inverter`);
  assert.equal(byCategory.body.items.length, 1);
  assert.equal(byCategory.body.items[0].category, "inverter");

  const bySearch = await admin("GET", `/chatbots/${chatbotId}/energy/equipment?search=hybrid`);
  assert.equal(bySearch.body.items.length, 1);
  assert.equal(bySearch.body.items[0].name, "5kW Hybrid Inverter");
});

test("image upload and serve round-trips real bytes, rejects a non-image file, and datasheet accepts any file type", async () => {
  const created = await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Mono Panel", fuelKey: "solar", category: "panel" });
  const itemId = created.body.item._id;

  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const imgForm = new FormData();
  imgForm.append("file", new Blob([pngBytes], { type: "image/png" }), "panel.png");
  const imgRes = await upload(`/chatbots/${chatbotId}/energy/equipment/${itemId}/image`, imgForm);
  assert.equal(imgRes.status, 200, JSON.stringify(imgRes.body));

  const served = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/equipment/${itemId}/image`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/png");
  const servedBytes = Buffer.from(await served.arrayBuffer());
  assert.ok(servedBytes.equals(pngBytes), "served bytes match what was uploaded");

  const notAnImageForm = new FormData();
  notAnImageForm.append("file", new Blob(["not an image"], { type: "text/plain" }), "notes.txt");
  const rejected = await upload(`/chatbots/${chatbotId}/energy/equipment/${itemId}/image`, notAnImageForm);
  assert.equal(rejected.status, 400);

  const pdfForm = new FormData();
  pdfForm.append("file", new Blob(["%PDF-1.4 fake datasheet"], { type: "application/pdf" }), "datasheet.pdf");
  const datasheetRes = await upload(`/chatbots/${chatbotId}/energy/equipment/${itemId}/datasheet`, pdfForm);
  assert.equal(datasheetRes.status, 200);

  const detail = await admin("GET", `/chatbots/${chatbotId}/energy/equipment/${itemId}`);
  assert.equal(detail.body.item.hasImage, true);
  assert.equal(detail.body.item.hasDatasheet, true);
});

test("CSV import: valid rows get created, a bad row rejects the whole file, duplicate manufacturer+model within the file is flagged not blocked", async () => {
  const badCsv = "name,category,price\nGood Item,panel,abc";
  const form1 = new FormData();
  form1.append("fuelKey", "solar");
  form1.append("file", new Blob([badCsv], { type: "text/csv" }), "equip.csv");
  const rejected = await upload(`/chatbots/${chatbotId}/energy/equipment/import`, form1);
  assert.equal(rejected.status, 400);
  assert.ok(rejected.body.errors.some((e) => /price/.test(e)));

  const csv = "name,category,manufacturer,modelNumber,price\nPanel A,panel,Acme,AP-1,10000\nPanel B (dup model),panel,Acme,AP-1,10500\nInverter A,inverter,Acme,INV-1,45000";
  const form2 = new FormData();
  form2.append("fuelKey", "solar");
  form2.append("file", new Blob([csv], { type: "text/csv" }), "equip.csv");
  const imported = await upload(`/chatbots/${chatbotId}/energy/equipment/import`, form2);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.importedCount, 3);
  assert.equal(imported.body.duplicateWarnings.length, 1);

  const listed = await admin("GET", `/chatbots/${chatbotId}/energy/equipment?fuelKey=solar`);
  assert.equal(listed.body.items.length, 3);
});

test("equipment is tenant-isolated", async () => {
  const created = await admin("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "Acme-only Item", fuelKey: "solar", category: "panel" });
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherList = await admin("GET", `/chatbots/${otherChatbots[0]._id}/energy/equipment`);
  assert.equal(otherList.body.items.length, 0);
  const otherDetail = await admin("GET", `/chatbots/${otherChatbots[0]._id}/energy/equipment/${created.body.item._id}`);
  assert.equal(otherDetail.status, 404, "another tenant can't reach this item even by direct id");
});
