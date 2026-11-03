import puppeteer from "/private/tmp/claude-501/-Users-bharatsharma-Downloads-chatbot-main-copy-3/28e8c63e-2fc6-4088-b405-46cb0e474cd3/scratchpad/puppeteer-tool/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = "/private/tmp/claude-501/-Users-bharatsharma-Downloads-chatbot-main-copy-3/28e8c63e-2fc6-4088-b405-46cb0e474cd3/scratchpad/ccsu-pdf2/shots";
const CHATBOT_ID = process.argv[2];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", defaultViewport: { width: 420, height: 760 } });
const page = await browser.newPage();
const shot = async (name) => { await page.screenshot({ path: `${SHOTS}/${name}.png` }); console.log("shot:", name); };

await page.goto(`http://localhost:5203/embed?companyId=ccsu2&chatbotId=${CHATBOT_ID}`, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 2500));
await shot("21-widget-greeting-and-categories");

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.trim() === "What documents are needed for admission?");
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1000));
await shot("22-widget-faq-answered");

await browser.close();
