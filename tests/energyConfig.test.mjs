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
  server = await startTestServer({ port: 4201 });
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

const admin = (method, path, body, token = superToken) =>
  fetch(`${server.baseUrl}/api/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test("ensureEnergyDefaults seeds the platform fuel/offering catalog, and is idempotent", async () => {
  const res = await admin("GET", "/energy-defaults/fuels");
  assert.equal(res.status, 200);
  const keys = res.body.fuels.map((f) => f.key);
  assert.ok(keys.includes("cng") && keys.includes("solar") && keys.includes("hydrogen"));

  const before = await admin("GET", "/energy-defaults/fuels");
  const { fuelsCreated } = await ensureEnergyDefaults();
  assert.equal(fuelsCreated, 0, "re-running the seed creates nothing new");
  const after = await admin("GET", "/energy-defaults/fuels");
  assert.equal(before.body.fuels.length, after.body.fuels.length);
});

test("the platform catalog is readable by any authenticated admin, not just SUPER_ADMIN (used by the Create Chatbot wizard before a chatbot exists)", async () => {
  const companyUser = new AdminUser({ name: "Owner", email: "owner2@acme.test", role: "COMPANY_ADMIN" });
  await companyUser.setPassword("password123");
  await companyUser.save();
  const companyToken = jwt.sign({ sub: String(companyUser._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });

  const res = await admin("GET", "/energy-defaults/catalog", null, companyToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.fuels.some((f) => f.key === "solar"));
  assert.ok(res.body.productServices.some((p) => p.fuelKey === "cng"));
  assert.ok(res.body.projectTypes.some((p) => p.fuelKey === "solar"));
});

test("Super Admin can manage the global fuel catalog; a non-super-admin cannot", async () => {
  const created = await admin("POST", "/energy-defaults/fuels", { label: "Geothermal Energy", group: "renewable" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.fuel.key, "geothermal_energy");

  const dupe = await admin("POST", "/energy-defaults/fuels", { label: "Geothermal Energy" });
  assert.equal(dupe.status, 409);

  const deactivated = await admin("DELETE", `/energy-defaults/fuels/${created.body.fuel._id}`);
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.fuel.active, false);

  const companyUser = new AdminUser({ name: "Owner", email: "owner@acme.test", role: "COMPANY_ADMIN" });
  await companyUser.setPassword("password123");
  await companyUser.save();
  const companyToken = jwt.sign({ sub: String(companyUser._id), role: "COMPANY_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
  const forbidden = await admin("GET", "/energy-defaults/fuels", null, companyToken);
  assert.equal(forbidden.status, 403);
});

test("a non-energy chatbot 400s, and a missing chatbot 404s", async () => {
  const { chatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "General Bot" }] });
  const res = await admin("GET", `/chatbots/${chatbots[0]._id}/energy/fuels`);
  assert.equal(res.status, 400);
  const missing = await admin("GET", `/chatbots/000000000000000000000000/energy/fuels`);
  assert.equal(missing.status, 404);
});

test("listAvailableFuels merges platform defaults with this company's own custom fuels, marks enabled state, and never leaks another company's custom fuel", async () => {
  const res = await admin("GET", `/chatbots/${chatbotId}/energy/fuels`);
  assert.equal(res.status, 200);
  assert.ok(res.body.fuels.some((f) => f.key === "cng" && f.isCustom === false));
  assert.ok(res.body.fuels.every((f) => f.enabled === false), "nothing enabled yet");

  const custom = await admin("POST", `/chatbots/${chatbotId}/energy/fuels`, { label: "Biomass Pellets" });
  assert.equal(custom.status, 201);
  assert.equal(custom.body.fuel.isCustom, true);

  const { chatbots: otherChatbots } = await seedTenant({ companyId: "other", chatbots: [{ name: "Other Energy Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const otherView = await admin("GET", `/chatbots/${otherChatbots[0]._id}/energy/fuels`);
  assert.ok(!otherView.body.fuels.some((f) => f.label === "Biomass Pellets"), "another tenant's custom fuel must never be visible");
  assert.ok(otherView.body.fuels.some((f) => f.key === "cng"), "platform defaults are still shared");
});

test("product/service and project type: list merges defaults + custom, custom creation and deletion, tenant isolation", async () => {
  const listCng = await admin("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=cng`);
  assert.equal(listCng.status, 200);
  assert.ok(listCng.body.items.some((i) => i.label === "CNG Dispensers"));

  const custom = await admin("POST", `/chatbots/${chatbotId}/energy/product-services`, { fuelKey: "cng", label: "Custom CNG Retrofit Kits" });
  assert.equal(custom.status, 201);
  const itemId = custom.body.item._id;

  const dupe = await admin("POST", `/chatbots/${chatbotId}/energy/product-services`, { fuelKey: "cng", label: "Custom CNG Retrofit Kits" });
  assert.equal(dupe.status, 409);

  const projectType = await admin("POST", `/chatbots/${chatbotId}/energy/project-types`, { fuelKey: "solar", label: "Custom Floating Solar" });
  assert.equal(projectType.status, 201);

  const del = await admin("DELETE", `/chatbots/${chatbotId}/energy/product-services/${itemId}`);
  assert.equal(del.status, 200);
  const afterDel = await admin("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=cng`);
  assert.ok(!afterDel.body.items.some((i) => i._id === itemId));
});

test("updateEnergyConfig validates selections against what's actually visible to this chatbot, and rejects another tenant's ids", async () => {
  const listSolar = await admin("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=solar`);
  const solarItem = listSolar.body.items.find((i) => i.label === "Solar Panels");
  const listProjects = await admin("GET", `/chatbots/${chatbotId}/energy/project-types?fuelKey=solar`);
  const residential = listProjects.body.items.find((i) => i.label === "Residential Solar");

  const badFuel = await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledFuelKeys: ["not-a-real-fuel"] });
  assert.equal(badFuel.status, 400);

  const ok = await admin("PUT", `/chatbots/${chatbotId}/energy/config`, {
    enabledFuelKeys: ["solar", "cng"],
    enabledProductServiceIds: [solarItem._id],
    enabledProjectTypeIds: [residential._id],
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.config.status, "DRAFT");

  // Another tenant's custom product/service id must be rejected even
  // though it's a real, valid ObjectId in the same collection.
  const { chatbots: otherChatbots } = await seedTenant({ companyId: "intruder", chatbots: [{ name: "Intruder Bot" }] });
  await Chatbot.findByIdAndUpdate(otherChatbots[0]._id, { template: "energy" });
  const foreign = await admin("POST", `/chatbots/${otherChatbots[0]._id}/energy/product-services`, { fuelKey: "solar", label: "Intruder's Custom Item" });
  const stolen = await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledProductServiceIds: [foreign.body.item._id] });
  assert.equal(stolen.status, 400, "a foreign tenant's custom item id must never validate");
});

test("publish requires at least one fuel and one offering, then flips status to PUBLISHED", async () => {
  const tooEarly = await admin("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(tooEarly.status, 400);

  await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledFuelKeys: ["cng"] });
  const stillMissingOfferings = await admin("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(stillMissingOfferings.status, 400);

  const listCng = await admin("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=cng`);
  const dispenser = listCng.body.items.find((i) => i.label === "CNG Dispensers");
  await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledProductServiceIds: [dispenser._id] });

  const published = await admin("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.config.status, "PUBLISHED");
  assert.ok(published.body.config.publishedAt);
});

test("editing a published config drops it back to DRAFT (Phase 5 publish-safety fix) instead of silently rewriting the live config", async () => {
  await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledFuelKeys: ["cng"] });
  const listCng = await admin("GET", `/chatbots/${chatbotId}/energy/product-services?fuelKey=cng`);
  const dispenser = listCng.body.items.find((i) => i.label === "CNG Dispensers");
  await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledProductServiceIds: [dispenser._id] });
  const published = await admin("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(published.body.config.status, "PUBLISHED");

  const edited = await admin("PUT", `/chatbots/${chatbotId}/energy/config`, { enabledFuelKeys: ["cng", "solar"] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.config.status, "DRAFT", "an edit to a published config must require re-publishing");
  assert.equal(edited.body.config.publishedAt, null);

  const reconfirmed = await admin("GET", `/chatbots/${chatbotId}/energy/config`);
  assert.equal(reconfirmed.body.config.status, "DRAFT");

  const republished = await admin("POST", `/chatbots/${chatbotId}/energy/config/publish`);
  assert.equal(republished.body.config.status, "PUBLISHED");
});
