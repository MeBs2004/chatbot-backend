import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";
import EnergyAnalyticsEvent from "../models/energy/analyticsEvent.model.js";
import { ensureEnergyDefaults } from "../services/energy/energyDefaults.service.js";
import { getFunnelAnalytics, getFuelAnalytics, getOverviewAnalytics, buildOverviewDeltas } from "../services/energy/energyAnalytics.service.js";

// ======================================================
// PHASE 6 — Energy Analytics. Two layers of tests:
//  1. Direct calls into energyAnalytics.service.js with hand-seeded
//     EnergyAnalyticsEvent rows — precise control to verify distinct-
//     session counting, funnel drop-off math, and date-range
//     boundaries without needing a full simulated journey.
//  2. Real HTTP calls against the admin API for wiring, RBAC, tenant
//     isolation and export format — the same harness every other
//     Energy test file uses.
// ======================================================

let server;
let superToken;
let chatbotIdA;
let companyIdA = "acmeenergy";
let sa;

before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4212 });
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

function seedEvent(overrides = {}) {
  return EnergyAnalyticsEvent.create({
    companyId: companyIdA,
    chatbotId: chatbotIdA,
    visitorId: "visitor-1",
    sessionId: "session-1",
    eventName: "energy_journey_started",
    eventTimestamp: new Date(),
    ...overrides,
  });
}

const DAY = 24 * 60 * 60 * 1000;

// ---------- Direct service-level calculation tests ----------

test("distinct-session counting: retries of the same step by the same session count once, not per event row", async () => {
  const now = new Date();
  await seedEvent({ sessionId: "s1", eventName: "energy_journey_started", eventTimestamp: now });
  await seedEvent({ sessionId: "s1", eventName: "energy_journey_started", eventTimestamp: new Date(now.getTime() + 1000) }); // retry
  await seedEvent({ sessionId: "s2", eventName: "energy_journey_started", eventTimestamp: now });

  const funnel = await getFunnelAnalytics({ companyId: companyIdA, chatbotId: chatbotIdA }, { since: new Date(now.getTime() - DAY), until: new Date(now.getTime() + DAY) });
  assert.equal(funnel.steps[0].sessions, 2, "two distinct sessions, not three event rows");
});

test("funnel drop-off and conversion percentages are computed correctly across all 12 steps", async () => {
  const now = new Date();
  const steps = [
    "energy_journey_started",
    "energy_intent_selected",
    "energy_fuel_selected",
    "energy_project_type_selected",
    "energy_questions_started",
    "energy_questions_completed",
    "energy_summary_reviewed",
    "energy_solution_generated",
    "energy_supplier_matching_completed",
    "energy_supplier_selected",
    "energy_rfq_submitted",
    "energy_confirmation_displayed",
  ];
  // 10 sessions start; each subsequent step loses exactly 1 session (10,9,8,...,0 is too few steps — use 10 sessions, drop 1 every 2 steps for a clean round-number check).
  const sessionCounts = [10, 10, 8, 8, 6, 6, 4, 4, 2, 2, 1, 1];
  for (let i = 0; i < steps.length; i++) {
    for (let s = 0; s < sessionCounts[i]; s++) {
      // eslint-disable-next-line no-await-in-loop
      await seedEvent({ sessionId: `sess-${s}`, eventName: steps[i], eventTimestamp: now });
    }
  }

  const funnel = await getFunnelAnalytics({ companyId: companyIdA, chatbotId: chatbotIdA }, { since: new Date(now.getTime() - DAY), until: new Date(now.getTime() + DAY) });
  assert.deepEqual(funnel.steps.map((s) => s.sessions), sessionCounts);
  assert.equal(funnel.steps[2].dropOffFromPrevious, 2); // 10 -> 8
  assert.equal(funnel.steps[2].conversionFromPrevious, 80);
  assert.equal(funnel.overall.journeyCompletionRate, 10); // 1/10 confirmed
  assert.equal(funnel.overall.rfqConversionRate, 10); // 1/10 submitted RFQ
});

test("date-range filtering: an event outside the requested range is excluded", async () => {
  const now = new Date();
  await seedEvent({ sessionId: "in-range", eventTimestamp: now });
  await seedEvent({ sessionId: "out-of-range", eventTimestamp: new Date(now.getTime() - 10 * DAY) });

  const funnel = await getFunnelAnalytics({ companyId: companyIdA, chatbotId: chatbotIdA }, { since: new Date(now.getTime() - DAY), until: new Date(now.getTime() + DAY) });
  assert.equal(funnel.steps[0].sessions, 1);
});

test("zero-data period returns honest zeros/nulls, not an error", async () => {
  const now = new Date();
  const funnel = await getFunnelAnalytics({ companyId: companyIdA, chatbotId: chatbotIdA }, { since: new Date(now.getTime() - DAY), until: new Date(now.getTime() + DAY) });
  assert.equal(funnel.steps[0].sessions, 0);
  assert.equal(funnel.overall.journeyCompletionRate, null, "0/0 must be null, never a fabricated 0% or 100%");
  assert.equal(funnel.trackedSince, null);
});

test("fuel demand: grouped by distinct session per fuel, with correct share percentages", async () => {
  const now = new Date();
  for (let i = 0; i < 6; i++) await seedEvent({ sessionId: `cng-${i}`, eventName: "energy_fuel_selected", fuelKey: "cng", eventTimestamp: now });
  for (let i = 0; i < 4; i++) await seedEvent({ sessionId: `solar-${i}`, eventName: "energy_fuel_selected", fuelKey: "solar", eventTimestamp: now });

  const fuels = await getFuelAnalytics({ companyId: companyIdA, chatbotId: chatbotIdA }, { since: new Date(now.getTime() - DAY), until: new Date(now.getTime() + DAY) });
  assert.equal(fuels.metrics.totalSelections, 10);
  const cng = fuels.breakdown.find((f) => f.fuelKey === "cng");
  assert.equal(cng.sessions, 6);
  assert.equal(cng.sharePercent, 60);
  assert.equal(fuels.metrics.mostRequested, cng.label);
});

test("overview comparison: delta is computed against the equivalent prior period, and is null when the prior period has zero data", async () => {
  const now = new Date();
  // Current 7-day window: 4 RFQ-start sessions.
  for (let i = 0; i < 4; i++) await seedEvent({ sessionId: `cur-${i}`, eventName: "energy_journey_started", eventTimestamp: now });
  const current = await getOverviewAnalytics({ companyId: companyIdA, chatbotId: chatbotIdA }, { since: new Date(now.getTime() - 7 * DAY), until: new Date(now.getTime() + DAY) });
  const previous = { metrics: { ...current.metrics, journeySessions: 2 } };
  const deltas = buildOverviewDeltas(current, previous);
  assert.equal(deltas.journeySessions, Math.round(((4 - 2) / 2) * 100));

  const previousZero = { metrics: { ...current.metrics, journeySessions: 0 } };
  const deltasZero = buildOverviewDeltas(current, previousZero);
  assert.equal(deltasZero.journeySessions, null, "a zero denominator must never produce a fabricated percentage");
});

// ---------- HTTP wiring, RBAC and tenant isolation ----------

test("overview/funnel/fuels endpoints require auth and reject a chatbot that isn't an Energy chatbot", async () => {
  const noAuth = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotIdA}/energy/analytics/overview`);
  assert.equal(noAuth.status, 401);

  const { chatbots: generalChatbots } = await seedTenant({ companyId: companyIdA, chatbots: [{ name: "General Bot" }] });
  const res = await sa("GET", `/chatbots/${generalChatbots[0]._id}/energy/analytics/overview`);
  assert.equal(res.status, 400);
});

test("a user with no access to this company/chatbot cannot read its analytics", async () => {
  const outsider = new AdminUser({ name: "Outsider", email: "outsider@test", role: "CHATBOT_MANAGER" });
  await outsider.setPassword("password123");
  await outsider.save();
  const token = jwt.sign({ sub: String(outsider._id), role: "CHATBOT_MANAGER", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  const res = await admin(token)("GET", `/chatbots/${chatbotIdA}/energy/analytics/overview`);
  assert.equal(res.status, 403);
});

test("Company A cannot read, and cannot export, Company B's Energy analytics by swapping the chatbotId", async () => {
  await seedEvent({ eventName: "energy_journey_started" });

  const { chatbots: companyBChatbots } = await seedTenant({ companyId: "othersolar", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(companyBChatbots[0]._id, { template: "energy" });
  await EnergyAnalyticsEvent.create({ companyId: "othersolar", chatbotId: companyBChatbots[0]._id, visitorId: "v-b", sessionId: "s-b", eventName: "energy_journey_started", eventTimestamp: new Date() });

  // SUPER_ADMIN can see both (by design) — the real test is a company-scoped user restricted to Company A only being unable to pull Company B's numbers via the OTHER chatbotId.
  const companyAUser = new AdminUser({ name: "A Admin", email: "aadmin@test", role: "COMPANY_ADMIN" });
  await companyAUser.setPassword("password123");
  await companyAUser.save();
  const UserCompanyAccess = (await import("../models/userCompanyAccess.model.js")).default;
  await UserCompanyAccess.create({ userId: companyAUser._id, companyId: companyIdA, role: "COMPANY_ADMIN", accessScope: "COMPANY", status: "ACTIVE" });
  const aToken = jwt.sign({ sub: String(companyAUser._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });

  const ownOverview = await admin(aToken)("GET", `/chatbots/${chatbotIdA}/energy/analytics/overview`);
  assert.equal(ownOverview.status, 200);
  assert.equal(ownOverview.body.metrics.journeySessions, 1);

  const crossOverview = await admin(aToken)("GET", `/chatbots/${companyBChatbots[0]._id}/energy/analytics/overview`);
  assert.equal(crossOverview.status, 403, "Company A's admin must never read Company B's chatbot analytics");

  const crossExport = await fetch(`${server.baseUrl}/api/admin/chatbots/${companyBChatbots[0]._id}/energy/analytics/export?format=csv`, { headers: { Authorization: `Bearer ${aToken}` } });
  assert.equal(crossExport.status, 403, "export must enforce the same access check");
});

test("createEnquiry fires energy_rfq_submitted on a real new enquiry, but never on an idempotent replay", async () => {
  const widget = (method, path, body) => fetch(`${server.baseUrl}/api/widget/energy${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

  const body = { customer: { name: "A", email: "a@example.com" }, fuelKey: "solar", visitorId: "v1", sessionId: "sess-rfq", idempotencyKey: "key-1" };
  const first = await widget("POST", `/${chatbotIdA}/enquiries`, body);
  assert.equal(first.status, 201);
  const second = await widget("POST", `/${chatbotIdA}/enquiries`, body); // idempotent replay
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);

  const count = await EnergyAnalyticsEvent.countDocuments({ companyId: companyIdA, chatbotId: chatbotIdA, eventName: "energy_rfq_submitted" });
  assert.equal(count, 1, "the replay must not fire a second rfq_submitted event");
});

test("the public track endpoint rejects event names outside the client-trackable allowlist (cannot fabricate server-tracked metrics)", async () => {
  const res = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotIdA}/journey/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName: "energy_rfq_submitted", visitorId: "v1", sessionId: "s1" }),
  });
  assert.equal(res.status, 400);

  const okRes = await fetch(`${server.baseUrl}/api/widget/energy/${chatbotIdA}/journey/track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName: "energy_journey_started", visitorId: "v1", sessionId: "s1" }),
  });
  assert.equal(okRes.status, 200);
  const stored = await EnergyAnalyticsEvent.findOne({ eventName: "energy_journey_started", sessionId: "s1" });
  assert.ok(stored);
});

test("export produces a real XLSX workbook with the expected sections, and a CSV with real content", async () => {
  await seedEvent({ eventName: "energy_journey_started" });

  const xlsxRes = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotIdA}/energy/analytics/export?format=xlsx&days=30`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(xlsxRes.status, 200);
  const buf = Buffer.from(await xlsxRes.arrayBuffer());
  const XLSX = (await import("xlsx")).default;
  const workbook = XLSX.read(buf, { type: "buffer" });
  assert.ok(workbook.SheetNames.includes("Overview"));
  assert.ok(workbook.SheetNames.includes("Journey Funnel"));

  const csvRes = await fetch(`${server.baseUrl}/api/admin/chatbots/${chatbotIdA}/energy/analytics/export?format=csv&days=30`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.includes("Overview"));
  assert.ok(csvText.includes("Journey Funnel"));
});

test("invalid custom date range is rejected (endDate before startDate)", async () => {
  const res = await sa("GET", `/chatbots/${chatbotIdA}/energy/analytics/overview?startDate=2026-01-10&endDate=2026-01-01`);
  assert.equal(res.status, 400);
});
