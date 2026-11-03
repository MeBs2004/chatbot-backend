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
  server = await startTestServer({ port: 4301 });

  const { chatbots } = await seedTenant({ companyId: "edu-check", chatbots: [{ name: "Edu Bot" }] });
  chatbotId = chatbots[0]._id;
  await Chatbot.findByIdAndUpdate(chatbotId, { template: "education" });

  const user = new AdminUser({ name: "Super", email: "super@edu.test", role: "SUPER_ADMIN" });
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

test("platform default categories seeded on boot", async () => {
  // /health reporting mongoose.readyState===1 can race the async
  // ensureEducationDefaults() seeding chain that runs after the same
  // connect() resolves — poll briefly rather than asserting instantly.
  let res;
  for (let i = 0; i < 20; i += 1) {
    res = await admin("GET", "/education-defaults/catalog");
    if (res.body.categories?.length > 0) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log("catalog status", res.status, "categories:", res.body.categories?.length);
  assert.equal(res.status, 200);
  assert.ok(res.body.categories.length > 0, "expected default categories to exist from boot-time seeding");
});

let categoryKey, faqId, courseId, leadReferenceId;

test("enable a category and add a custom FAQ + course", async () => {
  const cat = await admin("GET", `/chatbots/${chatbotId}/education/categories`);
  assert.equal(cat.status, 200);
  categoryKey = cat.body.categories[0].key;
  console.log("using category:", categoryKey);

  const faq = await admin("POST", `/chatbots/${chatbotId}/education/faqs`, {
    categoryKey,
    question: "Is there a hostel on campus?",
    answer: "Yes, separate hostels for boys and girls with 24/7 security and Wi-Fi.",
  });
  console.log("create faq status", faq.status, faq.body);
  assert.equal(faq.status, 201);
  faqId = faq.body.faq._id;

  const course = await admin("POST", `/chatbots/${chatbotId}/education/courses`, {
    name: "B.Tech Computer Science",
    categoryKey,
    duration: "4 years",
    feeRange: "₹2,00,000 - ₹4,00,000/yr",
    eligibility: "10+2 with PCM, min 60%",
  });
  console.log("create course status", course.status, course.body);
  assert.equal(course.status, 201);
  courseId = course.body.course._id;
});

test("save + publish education config", async () => {
  const save = await admin("PUT", `/chatbots/${chatbotId}/education/config`, {
    enabledCategoryKeys: [categoryKey],
    enabledFAQIds: [faqId],
    enabledCourseIds: [courseId],
  });
  console.log("save config status", save.status, save.body?.config || save.body);
  assert.equal(save.status, 200);

  const pub1 = await admin("POST", `/chatbots/${chatbotId}/education/config/publish`);
  console.log("publish status", pub1.status, pub1.body);
  assert.equal(pub1.status, 200);

  const live = await admin("PATCH", `/chatbots/${chatbotId}`, { status: "LIVE" });
  console.log("set LIVE status", live.status, live.body?.chatbot?.status);
});

test("public widget sees the real published FAQ (not AI-invented)", async () => {
  const cats = await pub("GET", `/api/widget/education/${chatbotId}/categories`);
  console.log("public categories status", cats.status, cats.body);
  assert.equal(cats.status, 200);

  const faqs = await pub("GET", `/api/widget/education/${chatbotId}/faqs`);
  console.log("public faqs status", faqs.status, faqs.body);
  assert.equal(faqs.status, 200);
  const found = faqs.body.faqs.find((f) => f._id === faqId);
  assert.ok(found, "published FAQ should be visible publicly");
  assert.equal(found.answer, "Yes, separate hostels for boys and girls with 24/7 security and Wi-Fi.");
});

test("submit a 'Get Free Counselling' lead publicly, then see it in admin", async () => {
  const lead = await pub("POST", `/api/widget/education/${chatbotId}/leads`, {
    name: "Rahul Sharma",
    phone: "9876543210",
    courseInterest: "B.Tech Computer Science",
  });
  console.log("submit lead status", lead.status, lead.body);
  assert.equal(lead.status, 201);
  leadReferenceId = lead.body.lead.referenceId;
  assert.ok(leadReferenceId);

  const list = await admin("GET", `/chatbots/${chatbotId}/education/leads`);
  console.log("admin leads list status", list.status, "count:", list.body.leads?.length);
  assert.equal(list.status, 200);
  const match = list.body.leads.find((l) => l.referenceId === leadReferenceId);
  assert.ok(match, "submitted lead should show up in admin leads list");
  assert.equal(match.name, "Rahul Sharma");
});
