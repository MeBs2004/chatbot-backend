import puppeteer from "/private/tmp/claude-501/-Users-bharatsharma-Downloads-chatbot-main-copy-3/28e8c63e-2fc6-4088-b405-46cb0e474cd3/scratchpad/puppeteer-tool/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5202";
const SHOTS = "/private/tmp/claude-501/-Users-bharatsharma-Downloads-chatbot-main-copy-3/28e8c63e-2fc6-4088-b405-46cb0e474cd3/scratchpad/ccsu-pdf2/shots";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();

const shot = async (name, full = true) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  console.log("shot:", name);
};

const clickByText = async (selector, text) =>
  page.evaluate((sel, t) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((x) => x.textContent?.trim() === t && x.offsetParent !== null);
    if (el) { el.click(); return true; }
    return false;
  }, selector, text);

const clickByIncludes = async (selector, re) =>
  page.evaluate((sel, pattern) => {
    const r = new RegExp(pattern, "i");
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((x) => r.test(x.textContent || "") && x.offsetParent !== null);
    if (el) { el.click(); return true; }
    return false;
  }, selector, re.source);

// 1. LOGIN
await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await page.waitForSelector('input[type="email"]');
await shot("01-login-page");
await page.type('input[type="email"]', "admin@ccsu2.test", { delay: 10 });
await page.type('input[type="password"]', "password123", { delay: 10 });
await page.click('button[type="submit"]');
await new Promise((r) => setTimeout(r, 1800));
await shot("02-dashboard-after-login");

// 2. CHATBOTS LIST
await page.goto(`${BASE}/chatbots`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 900));
await shot("03-chatbots-list-empty");

// 3. CREATE CHATBOT
await clickByIncludes("a,button", /create chatbot/i);
await new Promise((r) => setTimeout(r, 1200));

// 4. PICK EDUCATION
await clickByIncludes("button", /^Education$/);
await new Promise((r) => setTimeout(r, 500));
await shot("04-template-step-education-selected");

const cont = async () => clickByText("button", "Continue");

console.log("continue (template):", await cont());
await new Promise((r) => setTimeout(r, 900));
await shot("05-basics-step-empty");

// 5. FILL BASICS
await page.evaluate(() => {
  const selects = Array.from(document.querySelectorAll("select"));
  const companySelect = selects[0];
  if (companySelect) {
    const opt = Array.from(companySelect.options).find((o) => /ccsu/i.test(o.textContent || ""));
    if (opt) { companySelect.value = opt.value; companySelect.dispatchEvent(new Event("change", { bubbles: true })); }
  }
});
await page.evaluate(() => {
  const i = Array.from(document.querySelectorAll("input")).find((x) => x.placeholder?.toLowerCase().includes("support assistant"));
  if (i) {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(i, "CCSU Student Help Desk");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await new Promise((r) => setTimeout(r, 400));
await shot("06-basics-step-filled");

console.log("continue (basics -> creates chatbot):", await cont());
await new Promise((r) => setTimeout(r, 2200));
await shot("07-ai-step");

console.log("continue (ai):", await cont());
await new Promise((r) => setTimeout(r, 1200));
await shot("08-knowledge-step");

console.log("continue (knowledge):", await cont());
await new Promise((r) => setTimeout(r, 1500));
await shot("09-education-config-step-faqs-tab");

// 6. EDUCATION CONFIG — enable categories
await page.evaluate(() => {
  const pills = Array.from(document.querySelectorAll("button"));
  ["Admissions", "Fees", "Facility & Hostel", "Placements", "Scholarships", "Courses & Programs"].forEach((label) => {
    const b = pills.find((x) => x.textContent?.trim() === label);
    if (b) b.click();
  });
});
await new Promise((r) => setTimeout(r, 500));
await shot("10-education-config-categories-enabled");

await page.evaluate(() => {
  const toggles = Array.from(document.querySelectorAll('button[role="switch"], input[type="checkbox"]'));
  toggles.slice(0, 3).forEach((t) => t.click());
});
await new Promise((r) => setTimeout(r, 400));
await shot("11-education-config-faqs-enabled");

// switch to Courses & Programs tab
await clickByIncludes("button", /courses & programs/i);
await new Promise((r) => setTimeout(r, 600));
await shot("12-education-config-courses-tab-empty");

await clickByIncludes("button", /add course|add a course/i);
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const fill = (placeholderPart, value) => {
    const input = Array.from(document.querySelectorAll('input[placeholder]')).find((i) => i.placeholder.toLowerCase().includes(placeholderPart));
    if (input) { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }
  };
  fill("b.tech computer science", "B.Sc Computer Science");
  fill("4 years", "3 years");
  fill("1.2l", "₹45,000 - ₹60,000 / year");
  fill("10+2 with pcm", "10+2 with PCM/PCB, 50%+");
});
await new Promise((r) => setTimeout(r, 300));
await clickByText("button", "Save");
await new Promise((r) => setTimeout(r, 900));
await shot("13-education-config-courses-added");

await clickByIncludes("button", /^Leads$/);
await new Promise((r) => setTimeout(r, 600));
await shot("14-education-config-leads-tab-empty");

console.log("continue (to customize):", await cont());
await new Promise((r) => setTimeout(r, 1500));
await shot("15-customize-step");

console.log("continue (to review):", await cont());
await new Promise((r) => setTimeout(r, 1000));
await shot("16-review-step");

await clickByIncludes("button", /finish|create chatbot/i);
await new Promise((r) => setTimeout(r, 2000));
await shot("17-success-screen");

const chatbotInfo = await page.evaluate(async () => {
  const token = localStorage.getItem("nuformly-token");
  const res = await fetch("http://localhost:4320/api/admin/chatbots", { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const bot = data.chatbots?.find((c) => c.name === "CCSU Student Help Desk");
  return bot ? { id: bot._id } : null;
});
console.log("CHATBOT_INFO=" + JSON.stringify(chatbotInfo));

await browser.close();
