import puppeteer from "/private/tmp/claude-501/-Users-bharatsharma-Downloads-chatbot-main-copy-3/28e8c63e-2fc6-4088-b405-46cb0e474cd3/scratchpad/puppeteer-tool/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5202";
const SHOTS = "/private/tmp/claude-501/-Users-bharatsharma-Downloads-chatbot-main-copy-3/28e8c63e-2fc6-4088-b405-46cb0e474cd3/scratchpad/ccsu-pdf2/shots";
const CHATBOT_ID = process.argv[2];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const shot = async (name) => { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); console.log("shot:", name); };

await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await page.waitForSelector('input[type="email"]');
await page.type('input[type="email"]', "admin@ccsu2.test", { delay: 10 });
await page.type('input[type="password"]', "password123", { delay: 10 });
await page.click('button[type="submit"]');
await new Promise((r) => setTimeout(r, 1800));

await page.goto(`${BASE}/chatbots/${CHATBOT_ID}`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1000));
await shot("18-chatbot-detail-page");

await page.goto(`${BASE}/chatbots/${CHATBOT_ID}/education`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1000));
await shot("19-standalone-education-config-page");

const result = await page.evaluate(async (id) => {
  const token = localStorage.getItem("nuformly-token");
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const cats = await fetch(`http://localhost:4320/api/admin/chatbots/${id}/education/categories`, { headers: auth }).then((r) => r.json());
  const faqsAll = [];
  for (const c of cats.categories) {
    const r = await fetch(`http://localhost:4320/api/admin/chatbots/${id}/education/faqs?categoryKey=${c.key}`, { headers: auth }).then((x) => x.json());
    faqsAll.push(...r.faqs);
  }
  const courses = await fetch(`http://localhost:4320/api/admin/chatbots/${id}/education/courses`, { headers: auth }).then((r) => r.json());
  const save = await fetch(`http://localhost:4320/api/admin/chatbots/${id}/education/config`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      enabledCategoryKeys: cats.categories.map((c) => c.key),
      enabledFAQIds: faqsAll.map((f) => f._id),
      enabledCourseIds: courses.courses.map((c) => c._id),
    }),
  }).then((r) => r.json());
  const pub = await fetch(`http://localhost:4320/api/admin/chatbots/${id}/education/config/publish`, { method: "POST", headers: auth }).then((r) => r.json());
  const live = await fetch(`http://localhost:4320/api/admin/chatbots/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ status: "LIVE" }) }).then((r) => r.json());
  return { saved: save.success, published: pub.success, status: live.chatbot?.status, faqCount: faqsAll.length, courseCount: courses.courses.length };
}, CHATBOT_ID);
console.log("publish result:", result);

await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1000));
await shot("19b-standalone-education-config-page-published");

await page.goto(`${BASE}/chatbots/${CHATBOT_ID}/install`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1000));
await shot("20-installation-page");

await browser.close();
