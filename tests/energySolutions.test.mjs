import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";

let server;
let superToken;
let chatbotId;
let solarProjectTypeId;
let panelId;
let inverterId;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4204 });
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

  const pts = await sa("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=solar`);
  solarProjectTypeId = pts.body.items.find((i) => i.label === "Residential Solar")._id;

  const panel = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Panel", fuelKey: "solar", category: "panel", capacityValue: 550, capacityUnit: "W" });
  panelId = panel.body.item._id;
  const inverter = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "5kW Inverter", fuelKey: "solar", category: "inverter", capacityValue: 5, capacityUnit: "kW" });
  inverterId = inverter.body.item._id;
});

function baseTemplateBody(overrides = {}) {
  return {
    name: "Residential Solar BOM",
    description: "Standard residential solar BOM.",
    fuelKey: "solar",
    projectTypeId: solarProjectTypeId,
    outputTypes: ["bom", "system_sizing"],
    equipmentMappings: [
      { equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 10 } },
      { equipmentId: inverterId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 1 } },
    ],
    ...overrides,
  };
}

test("template CRUD: validates shape and references, creates, edits a draft in place, deletes", async () => {
  const badFuel = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, { name: "x", fuelKey: "solar", projectTypeId: solarProjectTypeId, outputTypes: ["not_a_real_type"] });
  assert.equal(badFuel.status, 400);

  const wrongFuelPT = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, { name: "x", fuelKey: "cng", projectTypeId: solarProjectTypeId });
  assert.equal(wrongFuelPT.status, 400, "a solar project type can't be used on a CNG template");

  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.template.status, "draft");
  assert.equal(created.body.template.version, 1);
  const templateId = created.body.template._id;

  const edited = await sa("PATCH", `/chatbots/${chatbotId}/energy/solutions/${templateId}`, { description: "Updated description." });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.template.description, "Updated description.");
  assert.equal(edited.body.template._id, templateId, "editing a draft mutates in place, no new version");

  const deleted = await sa("DELETE", `/chatbots/${chatbotId}/energy/solutions/${templateId}`);
  assert.equal(deleted.status, 200);
  const afterDelete = await sa("GET", `/chatbots/${chatbotId}/energy/solutions/${templateId}`);
  assert.equal(afterDelete.status, 404);
});

test("equipment mapping validation: rejects a condition/quantity-rule referencing a question outside this template, and a foreign-fuel equipment id", async () => {
  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "single_choice", label: "Battery backup?", options: ["Yes", "No"] });
  const unrelatedQ = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "number", label: "Unrelated question" });

  const badCondition = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody({
    requiredQuestionIds: [q.body.question._id],
    equipmentMappings: [{ equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 1 }, selectionCondition: { questionId: unrelatedQ.body.question._id, condition: "equals", value: "Yes" } }],
  }));
  assert.equal(badCondition.status, 400, "selectionCondition must reference one of the template's own questions");

  const cngPanel = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "CNG Dispenser", fuelKey: "cng", category: "dispenser" });
  const foreignEquipment = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody({ equipmentMappings: [{ equipmentId: cngPanel.body.item._id, mandatory: true, quantityRule: { type: "fixed", fixedQty: 1 } }] }));
  assert.equal(foreignEquipment.status, 400, "a CNG equipment item can't be mapped on a solar template");

  const ok = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody({
    requiredQuestionIds: [q.body.question._id],
    equipmentMappings: [{ equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 1 }, selectionCondition: { questionId: q.body.question._id, condition: "equals", value: "Yes" } }],
  }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test("approval workflow: submit requires mappings, approve/reject gated by role, rejected can be resubmitted", async () => {
  const empty = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody({ equipmentMappings: [] }));
  const emptyId = empty.body.template._id;
  const cantSubmit = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${emptyId}/submit`);
  assert.equal(cantSubmit.status, 400);

  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody());
  const templateId = created.body.template._id;

  const submitted = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/submit`);
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.template.status, "pending_review");

  // A non-approver role (CHATBOT_MANAGER) can't approve/reject.
  const manager = new AdminUser({ name: "Manager", email: "manager@acme.test", role: "CHATBOT_MANAGER" });
  await manager.setPassword("password123");
  await manager.save();
  await UserCompanyAccess.create({ userId: manager._id, companyId: "acme", role: "CHATBOT_MANAGER", accessScope: "COMPANY", status: "ACTIVE" });
  const managerToken = jwt.sign({ sub: String(manager._id), role: "CHATBOT_MANAGER", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  const managerDenied = await admin(managerToken)("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/approve`);
  assert.equal(managerDenied.status, 403);

  const rejected = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/reject`, { reason: "Missing earthing kit." });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.template.status, "rejected");
  assert.equal(rejected.body.template.rejectedReason, "Missing earthing kit.");

  const resubmitted = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/submit`);
  assert.equal(resubmitted.status, 200);
  const approved = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/approve`);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.template.status, "approved");
  assert.ok(approved.body.template.approvedAt);

  const cantDeleteApproved = await sa("DELETE", `/chatbots/${chatbotId}/energy/solutions/${templateId}`);
  assert.equal(cantDeleteApproved.status, 400);
});

test("editing an approved template creates a new version instead of mutating the live one, and version history lists both", async () => {
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody());
  const templateId = created.body.template._id;
  await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/submit`);
  const approved = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/approve`);
  assert.equal(approved.body.template.status, "approved");

  const edited = await sa("PATCH", `/chatbots/${chatbotId}/energy/solutions/${templateId}`, { description: "Revised for v2." });
  assert.equal(edited.status, 201, JSON.stringify(edited.body));
  assert.equal(edited.body.newVersionCreated, true);
  assert.notEqual(edited.body.template._id, templateId);
  assert.equal(edited.body.template.version, 2);
  assert.equal(edited.body.template.status, "draft");
  assert.equal(edited.body.template.previousVersionId, templateId);

  const original = await sa("GET", `/chatbots/${chatbotId}/energy/solutions/${templateId}`);
  assert.equal(original.body.template.status, "approved", "the live approved version is untouched");
  assert.equal(original.body.template.description, "Standard residential solar BOM.");

  const versions = await sa("GET", `/chatbots/${chatbotId}/energy/solutions/${templateId}/versions`);
  assert.equal(versions.body.versions.length, 2);
  assert.deepEqual(versions.body.versions.map((v) => v.version), [2, 1]);

  const listDefault = await sa("GET", `/chatbots/${chatbotId}/energy/solutions?fuelKey=solar`);
  assert.equal(listDefault.body.templates.length, 1, "the default list shows only the latest version per family");
  assert.equal(listDefault.body.templates[0].version, 2);
});

test("preview: blocks on missing required input, computes real lines when answered, and exports PDF/Excel", async () => {
  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "number", label: "Critical load (W)" });
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody({
    requiredQuestionIds: [q.body.question._id],
    equipmentMappings: [
      { equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 10 } },
      { equipmentId: inverterId, mandatory: true, quantityRule: { type: "per_question_value_divided", sourceQuestionId: q.body.question._id, divisor: 5000, minQty: 1 } },
    ],
  }));
  const templateId = created.body.template._id;

  const missing = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/preview`, { answers: {} });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.result.valid, false);
  assert.equal(missing.body.previewWarning !== null, true, "a draft template's preview carries a not-yet-approved warning");

  const answers = { [q.body.question._id]: 12000 };
  const ok = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/preview`, { answers });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result.valid, true);
  const inverterLine = ok.body.result.lines.find((l) => l.name === "5kW Inverter");
  assert.equal(inverterLine.qty, 3); // ceil(12000/5000)

  const pdfRes = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/solutions/${templateId}/preview/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ answers }),
  });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
  assert.equal(pdfBytes.slice(0, 4).toString(), "%PDF");

  const excelRes = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotId}/energy/solutions/${templateId}/preview/excel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ answers }),
  });
  assert.equal(excelRes.status, 200);
  assert.equal(excelRes.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const excelBytes = Buffer.from(await excelRes.arrayBuffer());
  assert.ok(excelBytes.length > 0);
});

test("solution templates are tenant-isolated — a real company-scoped admin from another tenant can neither list nor reach it by id", async () => {
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, baseTemplateBody());
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });

  const otherOwner = new AdminUser({ name: "Other Owner", email: "owner@other.test", role: "COMPANY_ADMIN" });
  await otherOwner.setPassword("password123");
  await otherOwner.save();
  await UserCompanyAccess.create({ userId: otherOwner._id, companyId: "other", role: "COMPANY_ADMIN", accessScope: "COMPANY", status: "ACTIVE" });
  const otherToken = jwt.sign({ sub: String(otherOwner._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  const otherAdmin = admin(otherToken);

  const otherList = await otherAdmin("GET", `/chatbots/${otherChatbots[0]._id}/energy/solutions`);
  assert.equal(otherList.body.templates.length, 0);
  const otherDetail = await otherAdmin("GET", `/chatbots/${otherChatbots[0]._id}/energy/solutions/${created.body.template._id}`);
  assert.equal(otherDetail.status, 404);
  const crossTenantAccess = await otherAdmin("GET", `/chatbots/${chatbotId}/energy/solutions`);
  assert.equal(crossTenantAccess.status, 403, "another tenant's admin can't even open Acme's chatbot");
});
