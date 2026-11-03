import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Chatbot from "../models/chatbot.model.js";

let server;
let token;
let chatbotId;

before(async () => {
  await connectTestDb();
  await resetDb();
  server = await startTestServer({ port: 4311 });

  const { chatbots } = await seedTenant({ companyId: "mkt-check", chatbots: [{ name: "Marketing Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "digital_marketing" });

  const user = new AdminUser({ name: "Super", email: "super@mkt.test", role: "SUPER_ADMIN" });
  await user.setPassword("password123");
  await user.save();
  token = jwt.sign({ sub: String(user._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
});

after(async () => {
  await server?.stop();
  await disconnectTestDb();
});

const admin = (method, path, body) =>
  fetch(`${server.baseUrl}/api/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

const pub = (method, path, body) =>
  fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("platform marketing catalog (fixed taxonomy) loads", async () => {
  const res = await admin("GET", "/marketing-defaults/catalog");
  console.log("catalog status", res.status, "categories:", res.body.serviceCategories?.length, "capabilities:", res.body.capabilities?.length);
  assert.equal(res.status, 200);
  assert.ok(res.body.serviceCategories.length > 0);
  assert.ok(res.body.capabilities.length > 0);
});

test("save business profile, services, capabilities, lead settings", async () => {
  const save = await admin("PUT", `/chatbots/${chatbotId}/marketing/config`, {
    businessProfile: { businessName: "Acme Growth Co", website: "acmegrowth.test", businessType: "Digital Marketing Agency", description: "We grow D2C brands.", targetAudience: "D2C ecommerce founders" },
    enabledServiceKeys: ["seo", "google_ads", "content_marketing"],
    enabledCapabilityKeys: ["knowledge_assistant", "metrics_calculator", "lead_generation"],
    leadSettings: { enabled: true, requiredFields: ["name", "phone", "budget"], qualificationQuestions: ["What's your monthly ad budget?"], ctaLabel: "Request a Quote" },
  });
  console.log("save config status", save.status, save.body?.config?.businessProfile);
  assert.equal(save.status, 200);
  assert.equal(save.body.config.businessProfile.businessName, "Acme Growth Co");
  assert.deepEqual(save.body.config.enabledServiceKeys.sort(), ["content_marketing", "google_ads", "seo"]);
});

test("publish config and set chatbot LIVE", async () => {
  const pub1 = await admin("POST", `/chatbots/${chatbotId}/marketing/config/publish`);
  console.log("publish status", pub1.status, pub1.body);
  assert.equal(pub1.status, 200);
  const live = await admin("PATCH", `/chatbots/${chatbotId}`, { status: "LIVE" });
  console.log("set LIVE status", live.status, live.body?.chatbot?.status);
  assert.equal(live.body.chatbot.status, "LIVE");
});

test("public widget sees published config (lead capture enabled, correct services/capabilities)", async () => {
  const cfg = await pub("GET", `/api/widget/marketing/${chatbotId}/config`);
  console.log("public config status", cfg.status, cfg.body);
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.leadCaptureEnabled, true);
  assert.equal(cfg.body.ctaLabel, "Request a Quote");
  assert.ok(cfg.body.enabledServiceKeys.includes("seo"));
  assert.ok(cfg.body.enabledCapabilityKeys.includes("metrics_calculator"));
});

test("deterministic calculator: ROI and ROAS stay distinct formulas", async () => {
  const roi = await pub("POST", `/api/widget/calculate/${chatbotId}/marketing`, { calculation: "roi", inputs: { revenue: 1500, cost: 1000 } });
  console.log("ROI result", roi.status, roi.body);
  assert.equal(roi.status, 200);
  assert.equal(roi.body.result.value, 50); // (1500-1000)/1000*100

  const roas = await pub("POST", `/api/widget/calculate/${chatbotId}/marketing`, { calculation: "roas", inputs: { revenue: 1500, spend: 500 } });
  console.log("ROAS result", roas.status, roas.body);
  assert.equal(roas.status, 200);
  assert.equal(roas.body.result.value, 3); // 1500/500

  const cac = await pub("POST", `/api/widget/calculate/${chatbotId}/marketing`, { calculation: "cac", inputs: { totalAcquisitionCost: 2000, newCustomers: 10 } });
  console.log("CAC result", cac.status, cac.body);
  assert.equal(cac.status, 200);
  assert.equal(cac.body.result.value, 200);
});

let leadReferenceId;
test("submit a lead publicly, then see it in admin", async () => {
  const lead = await pub("POST", `/api/widget/marketing/${chatbotId}/leads`, {
    name: "Rohan Gupta",
    phone: "9876500000",
    companyName: "Gupta Textiles",
    website: "guptatextiles.test",
    requiredServices: ["seo", "google_ads"],
    budget: "₹50,000/month",
    timeline: "Next month",
  });
  console.log("submit lead status", lead.status, lead.body);
  assert.equal(lead.status, 201);
  leadReferenceId = lead.body.lead.referenceId;
  assert.ok(leadReferenceId.startsWith("MKT-"));

  const list = await admin("GET", `/chatbots/${chatbotId}/marketing/leads`);
  console.log("admin leads list status", list.status, "count:", list.body.leads?.length);
  assert.equal(list.status, 200);
  const match = list.body.leads.find((l) => l.referenceId === leadReferenceId);
  assert.ok(match, "submitted lead should show up in admin leads list");
  assert.equal(match.companyName, "Gupta Textiles");
});

test("sector instruction is dynamic: enabled capability present, disabled capability explicitly excluded", async () => {
  const { getSectorInstructionForChatbot } = await import("../services/sectors/index.js");
  const instruction = await getSectorInstructionForChatbot(chatbotId);
  console.log("dynamic instruction snippet:", instruction.slice(0, 400));
  assert.ok(instruction.includes("Acme Growth Co"), "business name should appear in the dynamic instruction");
  assert.ok(instruction.includes("Marketing Metrics Calculator"), "enabled capability should be listed");
  assert.ok(instruction.includes("DO NOT offer or perform"), "disabled capabilities should be explicitly excluded");
  assert.ok(instruction.includes("Basic SEO Assistant"), "a disabled capability (SEO assistant) should be named in the exclusion list");
});
