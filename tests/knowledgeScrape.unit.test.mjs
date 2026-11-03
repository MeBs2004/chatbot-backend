// Pure-logic tests for the knowledge-generation pipeline: no spawned
// server, no MongoDB, no real network or DNS lookups. scrapeWebsite's
// `fetcher`/`validate` are injected here, and the real SSRF guard
// (assertSafeWebhookUrl) is exercised directly with IP-literal URLs,
// which it rejects without ever touching the network or DNS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, extractLinks } from "../utils/htmlToText.js";
import { scrapeWebsite, ScrapeError } from "../utils/scrapeWebsite.js";
import { assertSafeWebhookUrl } from "../services/flow/flow.security.js";
import { buildKnowledgeFromText, KnowledgeBuildError } from "../services/knowledgeBuilder.service.js";
import { GenerationError } from "../services/groq.service.js";

test("htmlToText strips scripts/styles, decodes entities, and separates blocks with newlines", () => {
  const html = `
    <html><head><title>Acme &amp; Co</title><style>.x{color:red}</style></head>
    <body>
      <script>trackStuff();</script>
      <nav><a href="/x">Menu</a></nav>
      <h1>Welcome to Acme</h1>
      <p>We sell widgets &mdash; the best in town.</p>
      <ul><li>Fast shipping</li><li>24/7 support</li></ul>
    </body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, "Acme & Co");
  assert.ok(!text.includes("trackStuff"));
  assert.ok(!text.includes("color:red"));
  assert.ok(text.includes("Welcome to Acme"));
  assert.ok(text.includes("We sell widgets — the best in town."));
  assert.ok(text.includes("Fast shipping"));
  assert.ok(text.includes("24/7 support"));
  // block tags produced real line breaks, not one run-on line
  assert.ok(text.split("\n").length > 2);
});

test("extractLinks resolves relative hrefs against the base URL and skips non-navigable ones", () => {
  const html = `
    <a href="/about">About</a>
    <a href="https://other.example.com/x">External</a>
    <a href="mailto:hi@acme.test">Email</a>
    <a href="javascript:void(0)">JS</a>
    <a href="#top">Anchor only</a>
    <a href="pricing?ref=nav">Pricing</a>
  `;
  const links = extractLinks(html, "https://acme.test/home");
  assert.ok(links.includes("https://acme.test/about"));
  assert.ok(links.includes("https://other.example.com/x"));
  assert.ok(links.includes("https://acme.test/pricing?ref=nav"));
  assert.ok(!links.some((l) => l.startsWith("mailto:")));
  assert.ok(!links.some((l) => l.startsWith("javascript:")));
});

test("the real SSRF guard rejects loopback, private, link-local and malformed addresses", async () => {
  for (const bad of ["http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.0.5/", "http://169.254.169.254/", "http://localhost/", "ftp://example.com/"]) {
    await assert.rejects(() => assertSafeWebhookUrl(bad), undefined, `expected ${bad} to be rejected`);
  }
});

test("scrapeWebsite rejects an empty or malformed address before any fetch is attempted", async () => {
  const fetcher = { get: () => assert.fail("fetcher should never be called") };
  await assert.rejects(() => scrapeWebsite("", { fetcher }), ScrapeError);
  await assert.rejects(() => scrapeWebsite("not a url", { fetcher }), ScrapeError);
  await assert.rejects(() => scrapeWebsite("ftp://files.acme.test/x", { fetcher }), ScrapeError);
});

test("scrapeWebsite propagates the SSRF guard's rejection for a blocked address", async () => {
  const fetcher = { get: () => assert.fail("fetcher should never be called for a blocked address") };
  await assert.rejects(() => scrapeWebsite("http://127.0.0.1:9999/", { fetcher }), ScrapeError);
});

// A small fake site: a homepage linking to a relevant "pricing" page and an
// irrelevant off-topic page, plus an external link that must never be
// followed. Every page is served from this in-memory map by the injected
// fetcher — no real network or DNS involved.
const SITE = {
  "https://acme.test/": `<html><head><title>Acme</title></head><body>
    <nav><a href="/pricing">Pricing</a><a href="/random-off-topic">Random</a><a href="https://elsewhere.test/page">Elsewhere</a></nav>
    <h1>Acme Rockets</h1><p>${"We build rockets for small satellites. ".repeat(10)}</p>
  </body></html>`,
  "https://acme.test/pricing": `<html><head><title>Pricing</title></head><body><p>${"Our starter plan is $99 per month. ".repeat(10)}</p></body></html>`,
  "https://acme.test/random-off-topic": `<html><head><title>Random</title></head><body><p>${"Nothing important here. ".repeat(10)}</p></body></html>`,
};

function fakeFetcher(map, { contentType = "text/html" } = {}) {
  return {
    get: async (url) => {
      const html = map[url];
      if (!html) return { status: 404, headers: {}, data: "" };
      return { status: 200, headers: { "content-type": contentType }, data: html };
    },
  };
}

test("scrapeWebsite follows same-origin links, skips the external one, and prioritizes relevant pages", async () => {
  const result = await scrapeWebsite("https://acme.test/", {
    fetcher: fakeFetcher(SITE),
    validate: async () => {},
    maxPages: 2, // homepage + exactly one more — should pick "pricing" over "random-off-topic"
  });
  assert.equal(result.homeUrl, "https://acme.test/");
  assert.ok(result.pagesScanned.includes("https://acme.test/"));
  assert.ok(result.pagesScanned.includes("https://acme.test/pricing"), "the relevant page should be scanned first");
  assert.ok(!result.pagesScanned.includes("https://acme.test/random-off-topic"));
  assert.ok(!result.pagesScanned.some((u) => u.includes("elsewhere.test")), "the external link must never be followed");
  assert.ok(result.rawText.includes("rockets"));
  assert.ok(result.rawText.includes("$99"));
});

test("scrapeWebsite rejects a page with no readable content type", async () => {
  const fetcher = fakeFetcher({ "https://acme.test/": SITE["https://acme.test/"] }, { contentType: "application/octet-stream" });
  await assert.rejects(() => scrapeWebsite("https://acme.test/", { fetcher, validate: async () => {} }), ScrapeError);
});

test("scrapeWebsite requires the homepage to actually have content; a thin page is rejected", async () => {
  const fetcher = fakeFetcher({ "https://acme.test/": "<html><body><p>hi</p></body></html>" });
  await assert.rejects(() => scrapeWebsite("https://acme.test/", { fetcher, validate: async () => {} }), ScrapeError);
});

test("buildKnowledgeFromText rejects empty source without calling the AI", async () => {
  const complete = () => assert.fail("should never call the AI for empty source text");
  await assert.rejects(() => buildKnowledgeFromText({ companyId: null, companyName: "Acme", rawText: "   ", complete }), KnowledgeBuildError);
});

test("buildKnowledgeFromText sends the company name and source text to the model, and returns its output", async () => {
  let seenSystemPrompt = "";
  let seenUserPrompt = "";
  const complete = async ({ systemPrompt, userPrompt }) => {
    seenSystemPrompt = systemPrompt;
    seenUserPrompt = userPrompt;
    return { text: "COMPANY INFO\nAcme Rockets builds small-satellite launchers.\n\nRULES\n1. Only answer about Acme Rockets.", usage: { total_tokens: 42 }, model: "openai/gpt-oss-20b" };
  };
  const result = await buildKnowledgeFromText({
    companyId: null,
    companyName: "Acme Rockets",
    rawText: "Acme Rockets builds rockets for small satellites.",
    sourceLabel: "https://acme.test/",
    complete,
  });
  assert.ok(seenSystemPrompt.includes("Acme Rockets"), "the system prompt should be personalized with the company name");
  assert.ok(seenUserPrompt.includes("https://acme.test/"));
  assert.ok(seenUserPrompt.includes("Acme Rockets builds rockets"));
  assert.ok(result.content.includes("RULES"));
  assert.equal(result.truncatedSource, false);
});

test("buildKnowledgeFromText truncates an oversized source before sending it to the model", async () => {
  const huge = "x".repeat(200000);
  let seenLength = 0;
  const complete = async ({ userPrompt }) => {
    seenLength = userPrompt.length;
    return { text: "COMPANY INFO\nSome info.", usage: null, model: "openai/gpt-oss-20b" };
  };
  const result = await buildKnowledgeFromText({ companyId: null, companyName: "Acme", rawText: huge, complete });
  assert.equal(result.truncatedSource, true);
  assert.ok(seenLength < huge.length, "the oversized source must not be sent to the model in full");
});

test("buildKnowledgeFromText turns a failed completion into a clear KnowledgeBuildError", async () => {
  const complete = async () => {
    throw new GenerationError("every key failed");
  };
  await assert.rejects(
    () => buildKnowledgeFromText({ companyId: null, companyName: "Acme", rawText: "Acme sells widgets.", complete }),
    KnowledgeBuildError,
  );
});
