import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import EnergyAnalyticsEvent from "../models/energy/analyticsEvent.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";
import { computeQuantity } from "../services/energy/solutionEngine.service.js";

// ======================================================
// PHASE 7 — targeted regression tests for the 5 fixes made from the
// audit forks' findings:
//  1. Admin password reset now invalidates outstanding tokens.
//  2/3. Analytics project-type/question label lookups are company-
//       scoped (closes a real cross-tenant label leak).
//  4. The public journey/track endpoint drops a questionId/supplierId
//     that doesn't belong to the resolved company, instead of storing
//     it unchecked (closes the leak at its source + stops metric
//     pollution).
//  5. The BOM engine flags (never silently clamps/accepts) a
//     negative/zero or absurdly large computed quantity, and the
//     admin solution-template save path rejects nonsensical
//     quantityRule values up front.
// ======================================================

let server;
let superToken;
let chatbotIdA;
let companyIdA = "acme7";
let sa;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4213 });
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

beforeEach(async () => {
  await resetDb();
  await ensureEnergyDefaults();

  const superUser = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await superUser.setPassword("password123");
  await superUser.save();
  superToken = jwt.sign({ sub: String(superUser._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  sa = admin(superToken);

  const { chatbots } = await seedTenant({ companyId: companyIdA, chatbots: [{ name: "Energy Bot" }] });
  chatbotIdA = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotIdA, { template: "energy" });
});

// ---------- Fix 1: admin password reset invalidates outstanding tokens ----------

test("admin resetUserPassword bumps tokenVersion, invalidating any token issued before the reset", async () => {
  const target = new AdminUser({ name: "Target", email: "target@test", role: "CHATBOT_MANAGER" });
  await target.setPassword("originalPassword123");
  await target.save();
  const staleToken = jwt.sign({ sub: String(target._id), role: "CHATBOT_MANAGER", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });

  // The stale token works before the reset.
  const before = await admin(staleToken)("GET", `/chatbots/${chatbotIdA}/energy/config`);
  assert.notEqual(before.status, 401);

  const reset = await sa("POST", `/users/${target._id}/reset-password`);
  assert.equal(reset.status, 200);
  assert.ok(reset.body.temporaryPassword);

  const after = await admin(staleToken)("GET", `/chatbots/${chatbotIdA}/energy/config`);
  assert.equal(after.status, 401, "a token issued before the password reset must be rejected afterward");
});

// ---------- Fix 2/3 + 4: analytics cross-tenant label leak closed ----------

test("a foreign company's real questionId/projectTypeId attached to an analytics event never leaks that company's label into this company's report", async () => {
  // A second, real tenant with its own real question — this is the record we must never see the label of.
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "othertenant7", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherToken = superToken; // SUPER_ADMIN can create the other tenant's question for test setup purposes
  const otherQuestion = await admin(otherToken)("POST", `/chatbots/${otherChatbots[0]._id}/energy/questions`, { fuelKey: "solar", type: "number", label: "Other Tenant's Private Question Label" });
  assert.equal(otherQuestion.status, 201);
  const foreignQuestionId = otherQuestion.body.question._id;

  // Directly insert an event under COMPANY A that references the foreign question id — simulating what a malicious client could have gotten written before the trackJourneyEvent fix existed. This isolates the READ-side fix (the service layer must never resolve/display a foreign label) regardless of how the id got there.
  await EnergyAnalyticsEvent.create({
    companyId: companyIdA,
    chatbotId: chatbotIdA,
    visitorId: "v1",
    sessionId: "s1",
    eventName: "energy_question_displayed",
    eventTimestamp: new Date(),
    questionId: foreignQuestionId,
  });

  const questionsReport = await sa("GET", `/chatbots/${chatbotIdA}/energy/analytics/questions?days=30`);
  assert.equal(questionsReport.status, 200);
  const bodyText = JSON.stringify(questionsReport.body);
  assert.ok(!bodyText.includes("Other Tenant's Private Question Label"), "Company A's analytics must never display another tenant's real question label");
  const entry = questionsReport.body.questions.find((q) => q.questionId === String(foreignQuestionId));
  assert.equal(entry.label, "Deleted question", "an unowned reference resolves to the same honest fallback as a genuinely deleted one, not the foreign label");
});

test("trackJourneyEvent drops a questionId/supplierId that doesn't belong to the resolved company, rather than storing it", async () => {
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "othertenant7b", chatbots: [{ name: "Other Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherQuestion = await sa("POST", `/chatbots/${otherChatbots[0]._id}/energy/questions`, { fuelKey: "solar", type: "number", label: "Foreign Question" });
  const foreignQuestionId = otherQuestion.body.question._id;

  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotIdA}/journey/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName: "energy_question_displayed", visitorId: "v1", sessionId: "s1", questionId: String(foreignQuestionId) }),
  });
  assert.equal(res.status, 200);

  const stored = await EnergyAnalyticsEvent.findOne({ companyId: companyIdA, eventName: "energy_question_displayed", sessionId: "s1" });
  assert.ok(stored);
  assert.equal(stored.questionId, null, "a questionId that doesn't belong to this company must be dropped, never stored");
});

test("trackJourneyEvent keeps a questionId that genuinely belongs to the resolved company", async () => {
  const ownQuestion = await sa("POST", `/chatbots/${chatbotIdA}/energy/questions`, { fuelKey: "solar", type: "number", label: "Own Question" });
  const ownQuestionId = ownQuestion.body.question._id;

  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotIdA}/journey/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName: "energy_question_displayed", visitorId: "v1", sessionId: "s2", questionId: String(ownQuestionId) }),
  });
  assert.equal(res.status, 200);

  const stored = await EnergyAnalyticsEvent.findOne({ companyId: companyIdA, eventName: "energy_question_displayed", sessionId: "s2" });
  assert.equal(String(stored.questionId), String(ownQuestionId));
});

// ---------- Fix 5: BOM engine quantity safety ----------

test("computeQuantity flags (never silently accepts) a negative or zero driving answer", () => {
  const rule = { type: "per_question_value", sourceQuestionId: "q1", multiplier: 1, minQty: 1 };
  const negative = computeQuantity(rule, { q1: -5 });
  assert.ok(negative.warning, "a negative answer must produce a warning");
  assert.equal(negative.qty, 1, "still clamped to minQty for display, but flagged");

  const zero = computeQuantity(rule, { q1: 0 });
  assert.ok(zero.warning, "a zero answer must produce a warning");
});

test("computeQuantity flags an absurdly large computed quantity instead of silently accepting it", () => {
  const rule = { type: "per_question_value", sourceQuestionId: "q1", multiplier: 1 };
  const huge = computeQuantity(rule, { q1: 999999999 });
  assert.ok(huge.warning, "an absurdly large quantity must be flagged for engineering review");
  assert.equal(huge.qty, 999999999, "the real computed value is preserved for review, never silently altered");
});

test("computeQuantity does not flag a normal, sane answer", () => {
  const rule = { type: "per_question_value", sourceQuestionId: "q1", multiplier: 1 };
  const normal = computeQuantity(rule, { q1: 4 });
  assert.equal(normal.warning, null);
  assert.equal(normal.qty, 4);
});

test("admin solution-template save rejects a nonsensical quantityRule (negative fixedQty, non-positive multiplier/divisor, negative minQty)", async () => {
  const pts = await sa("GET", `/chatbots/${chatbotIdA}/energy/project-types?fuelKey=solar`);
  const projectTypeId = pts.body.items[0]._id;
  const equipment = await sa("POST", `/chatbots/${chatbotIdA}/energy/equipment`, { name: "Panel", fuelKey: "solar", category: "panel" });
  const equipmentId = equipment.body.item._id;

  const negativeFixed = await sa("POST", `/chatbots/${chatbotIdA}/energy/solutions`, {
    name: "Bad Template",
    fuelKey: "solar",
    projectTypeId,
    outputTypes: ["bom"],
    equipmentMappings: [{ equipmentId, mandatory: true, quantityRule: { type: "fixed", fixedQty: -5 } }],
  });
  assert.equal(negativeFixed.status, 400);

  const zeroMultiplier = await sa("POST", `/chatbots/${chatbotIdA}/energy/solutions`, {
    name: "Bad Template 2",
    fuelKey: "solar",
    projectTypeId,
    outputTypes: ["bom"],
    equipmentMappings: [{ equipmentId, mandatory: true, quantityRule: { type: "per_question_value", multiplier: 0 } }],
  });
  assert.equal(zeroMultiplier.status, 400);

  const negativeMinQty = await sa("POST", `/chatbots/${chatbotIdA}/energy/solutions`, {
    name: "Bad Template 3",
    fuelKey: "solar",
    projectTypeId,
    outputTypes: ["bom"],
    equipmentMappings: [{ equipmentId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 1, minQty: -1 } }],
  });
  assert.equal(negativeMinQty.status, 400);

  // A legitimate rule still saves fine.
  const valid = await sa("POST", `/chatbots/${chatbotIdA}/energy/solutions`, {
    name: "Good Template",
    fuelKey: "solar",
    projectTypeId,
    outputTypes: ["bom"],
    equipmentMappings: [{ equipmentId, mandatory: true, quantityRule: { type: "fixed", fixedQty: 1 } }],
  });
  assert.equal(valid.status, 201);
});
