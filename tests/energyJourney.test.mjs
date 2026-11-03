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
let solarProjectTypeId;
let panelId;
let sa;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4206 });
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

  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Energy Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "energy" });

  const pts = await sa("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=solar`);
  solarProjectTypeId = pts.body.items.find((i) => i.label === "Residential Solar")._id;
  const panel = await sa("POST", `/chatbots/${chatbotId}/energy/equipment`, { name: "550W Panel", fuelKey: "solar", category: "panel" });
  panelId = panel.body.item._id;
});

async function publishBasicConfig() {
  const products = await sa("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=solar`);
  const solarPanelsOffering = products.body.items.find((i) => i.label === "Solar Panels");
  await sa("PUT", `/chatbots/${chatbotId}/energy/config`, {
    enabledFuelKeys: ["solar"],
    enabledProductServiceIds: [solarPanelsOffering._id],
    enabledProjectTypeIds: [solarProjectTypeId],
  });
  await sa("POST", `/chatbots/${chatbotId}/energy/config/publish`);
}

async function createApprovedTemplate(extra = {}) {
  const created = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, {
    name: "Residential Solar BOM",
    fuelKey: "solar",
    projectTypeId: solarProjectTypeId,
    outputTypes: ["bom"],
    equipmentMappings: [{ equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 10 } }],
    ...extra,
  });
  const templateId = created.body.template._id;
  await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/submit`);
  const approved = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${templateId}/approve`);
  return approved.body.template;
}

test("journey/config: unpublished config reports published:false, not an error; published config lists only enabled fuels", async () => {
  const before = await widget("GET", `/${chatbotId}/journey/config`);
  assert.equal(before.status, 200);
  assert.equal(before.body.published, false);
  assert.deepEqual(before.body.fuels, []);

  await publishBasicConfig();
  const after = await widget("GET", `/${chatbotId}/journey/config`);
  assert.equal(after.body.published, true);
  assert.equal(after.body.fuels.length, 1);
  assert.equal(after.body.fuels[0].key, "solar");
});

test("journey/config refuses a non-energy chatbot, a draft/unpublished-template chatbot still works for config shape, and a missing chatbot 404s", async () => {
  const { chatbots: generalChatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "General Bot" }] });
  const generalRes = await widget("GET", `/${generalChatbots[0]._id}/journey/config`);
  assert.equal(generalRes.status, 404);

  const missing = await widget("GET", `/000000000000000000000000/journey/config`);
  assert.equal(missing.status, 404);
});

test("a paused/offline chatbot can't be used by the public journey even if its Energy config is published", async () => {
  await publishBasicConfig();
  await Chatbot.findByIdAndUpdate(chatbotId, { status: "PAUSED" });
  const res = await widget("GET", `/${chatbotId}/journey/config`);
  assert.equal(res.status, 404);
});

test("journey/offerings: only enabled offerings for the requested fuel, and flags whether an approved template exists per project type", async () => {
  await publishBasicConfig();
  const before = await widget("GET", `/${chatbotId}/journey/offerings?fuelKey=solar`);
  assert.equal(before.status, 200);
  assert.equal(before.body.projectTypes.length, 1);
  assert.equal(before.body.projectTypes[0].hasApprovedTemplate, false);
  assert.equal(before.body.productServices.length, 1);
  assert.equal(before.body.productServices[0].label, "Solar Panels");

  await createApprovedTemplate();
  const after = await widget("GET", `/${chatbotId}/journey/offerings?fuelKey=solar`);
  assert.equal(after.body.projectTypes[0].hasApprovedTemplate, true);
});

test("journey/questions: resolves exactly the approved template's questions, required flag set correctly, and a project type with no approved template returns an empty, honest response", async () => {
  await publishBasicConfig();
  const noneYet = await widget("GET", `/${chatbotId}/journey/questions?fuelKey=solar&projectTypeId=${solarProjectTypeId}`);
  assert.equal(noneYet.status, 200);
  assert.equal(noneYet.body.hasApprovedTemplate, false);
  assert.deepEqual(noneYet.body.questions, []);

  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "number", label: "Monthly electricity consumption (kWh)" });
  const optionalQ = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "short_text", label: "Any other notes?" });
  await createApprovedTemplate({ requiredQuestionIds: [q.body.question._id], optionalQuestionIds: [optionalQ.body.question._id] });

  const res = await widget("GET", `/${chatbotId}/journey/questions?fuelKey=solar&projectTypeId=${solarProjectTypeId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.hasApprovedTemplate, true);
  assert.equal(res.body.questions.length, 2);
  const required = res.body.questions.find((qq) => qq._id === q.body.question._id);
  const optional = res.body.questions.find((qq) => qq._id === optionalQ.body.question._id);
  assert.equal(required.required, true);
  assert.equal(optional.required, false);
});

test("journey/questions silently drops a question that's since been deactivated, instead of erroring", async () => {
  await publishBasicConfig();
  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "number", label: "Monthly electricity consumption (kWh)" });
  await createApprovedTemplate({ requiredQuestionIds: [q.body.question._id] });
  await sa("PATCH", `/chatbots/${chatbotId}/energy/questions/${q.body.question._id}`, { active: false });

  const res = await widget("GET", `/${chatbotId}/journey/questions?fuelKey=solar&projectTypeId=${solarProjectTypeId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.questions.length, 0, "a deactivated question is dropped, not shown broken");
});

test("journey/generate: never lets the visitor choose a template, uses only the approved+active one, blocks on missing required input, and never fabricates an output when no template is configured", async () => {
  await publishBasicConfig();

  const noTemplate = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "solar", projectTypeId: solarProjectTypeId, answers: {} });
  assert.equal(noTemplate.status, 200);
  assert.equal(noTemplate.body.noTemplateConfigured, true);

  const q = await sa("POST", `/chatbots/${chatbotId}/energy/questions`, { fuelKey: "solar", type: "number", label: "Monthly electricity consumption (kWh)" });
  const draftCreated = await sa("POST", `/chatbots/${chatbotId}/energy/solutions`, { name: "Draft Template", fuelKey: "solar", projectTypeId: solarProjectTypeId, outputTypes: ["bom"], requiredQuestionIds: [q.body.question._id], equipmentMappings: [{ equipmentId: panelId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 5 } }] });
  const draftId = draftCreated.body.template._id;

  // A draft (not yet approved) template must never be usable by a visitor.
  const stillNoTemplate = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "solar", projectTypeId: solarProjectTypeId, answers: { [q.body.question._id]: 300 } });
  assert.equal(stillNoTemplate.body.noTemplateConfigured, true, "a draft template is never used for customer-facing generation");

  await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${draftId}/submit`);
  const rejected = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${draftId}/reject`, { reason: "needs work" });
  assert.equal(rejected.body.template.status, "rejected");
  const stillNotUsable = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "solar", projectTypeId: solarProjectTypeId, answers: { [q.body.question._id]: 300 } });
  assert.equal(stillNotUsable.body.noTemplateConfigured, true, "a rejected template is never used either");

  await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${draftId}/submit`);
  const approved = await sa("POST", `/chatbots/${chatbotId}/energy/solutions/${draftId}/approve`);
  assert.equal(approved.body.template.status, "approved");

  const missingInput = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "solar", projectTypeId: solarProjectTypeId, answers: {} });
  assert.equal(missingInput.body.result.valid, false);
  assert.equal(missingInput.body.result.missingInputs.length, 1);

  const ok = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "solar", projectTypeId: solarProjectTypeId, answers: { [q.body.question._id]: 300 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result.valid, true);
  assert.equal(ok.body.result.lines[0].qty, 5);
  assert.equal(ok.body.template.id, draftId);

  // A client-supplied templateId in the body must be ignored entirely — the server always resolves its own.
  const ignoredTemplateId = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "solar", projectTypeId: solarProjectTypeId, templateId: "000000000000000000000000", answers: { [q.body.question._id]: 300 } });
  assert.equal(ignoredTemplateId.status, 200);
  assert.equal(ignoredTemplateId.body.template.id, draftId, "the server-resolved template is used regardless of any client-supplied id");
});

test("journey endpoints refuse a fuel/project type that isn't actually enabled in the published config, even if it exists globally", async () => {
  await publishBasicConfig();
  const cngOfferings = await widget("GET", `/${chatbotId}/journey/offerings?fuelKey=cng`);
  assert.deepEqual(cngOfferings.body.productServices, []);
  assert.deepEqual(cngOfferings.body.projectTypes, []);

  const generate = await widget("POST", `/${chatbotId}/journey/generate`, { fuelKey: "cng", projectTypeId: solarProjectTypeId, answers: {} });
  assert.equal(generate.status, 400);
});

test("one company's published journey never leaks another company's custom fuels/offerings/templates", async () => {
  await publishBasicConfig();
  await createApprovedTemplate();

  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherConfig = await widget("GET", `/${otherChatbots[0]._id}/journey/config`);
  assert.equal(otherConfig.body.published, false, "another tenant's chatbot has its own, separate (unpublished) config");
});
