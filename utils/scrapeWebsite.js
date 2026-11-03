// Fetches a company's public website (homepage + a handful of its most
// relevant pages) and turns it into plain text for the AI to turn into a
// knowledge base. `fetcher` and `validate` are injectable so tests can run
// this without any real network access or DNS lookups; production always
// uses the real axios client and the real SSRF guard (the defaults below).
import axios from "axios";
import { assertSafeWebhookUrl } from "../services/flow/flow.security.js";
import { htmlToText, extractLinks } from "./htmlToText.js";

export class ScrapeError extends Error {}

const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; NuformlyBot/1.0; +https://www.nuformsocial.com)";
const MAX_REDIRECTS = 3;
const PAGE_BYTE_LIMIT = 1_500_000; // 1.5MB of HTML per page is already generous
const PAGE_TIMEOUT_MS = 8000;
const DEFAULT_MAX_PAGES = 6;
const DEFAULT_TOTAL_TIMEOUT_MS = 20000;
const MAX_RAW_CHARS = 70000; // leaves headroom for the AI step's own prompt + output

// Internal pages worth following from the homepage, roughly in order of
// how useful they tend to be for a support chatbot's knowledge base.
const KEYWORD_WEIGHTS = [
  ["pricing", 5],
  ["price", 4],
  ["plan", 3],
  ["service", 5],
  ["product", 5],
  ["solution", 4],
  ["about", 5],
  ["company", 3],
  ["contact", 5],
  ["faq", 5],
  ["help", 3],
  ["support", 3],
  ["shipping", 3],
  ["delivery", 3],
  ["return", 3],
  ["refund", 3],
  ["polic", 3],
  ["terms", 2],
  ["team", 2],
  ["feature", 3],
  ["gallery", 1],
  ["portfolio", 2],
];

function scoreLink(path, text) {
  const haystack = `${path} ${text}`.toLowerCase();
  let score = 0;
  for (const [kw, pts] of KEYWORD_WEIGHTS) if (haystack.includes(kw)) score += pts;
  return score;
}

/** Adds https:// if no scheme was given, and does basic shape validation. */
function normalizeUrl(input) {
  let raw = String(input ?? "").trim();
  if (!raw) throw new ScrapeError("Enter a website address.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ScrapeError("That doesn't look like a valid website address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScrapeError("Only http and https website addresses are supported.");
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    throw new ScrapeError("That doesn't look like a valid website address.");
  }
  return url;
}

async function fetchPage(url, { validate, fetcher, redirectsLeft }) {
  try {
    await validate(url.href);
  } catch (err) {
    throw new ScrapeError(err.message || "That address isn't allowed.");
  }

  let res;
  try {
    res = await fetcher.get(url.href, {
      headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1" },
      timeout: PAGE_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: PAGE_BYTE_LIMIT,
      maxBodyLength: PAGE_BYTE_LIMIT,
      responseType: "text",
      validateStatus: () => true,
    });
  } catch {
    throw new ScrapeError(`Couldn't reach ${url.hostname}. Check the address and try again.`);
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers?.location;
    if (!location || redirectsLeft <= 0) {
      throw new ScrapeError(`${url.hostname} didn't return a page (too many redirects).`);
    }
    let next;
    try {
      next = new URL(location, url);
    } catch {
      throw new ScrapeError(`${url.hostname} redirected somewhere we couldn't follow.`);
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new ScrapeError(`${url.hostname} redirected to an unsupported address.`);
    }
    return fetchPage(next, { validate, fetcher, redirectsLeft: redirectsLeft - 1 });
  }

  if (res.status === 404) throw new ScrapeError(`That page wasn't found on ${url.hostname}.`);
  if (res.status >= 400) throw new ScrapeError(`${url.hostname} returned an error (status ${res.status}).`);

  const contentType = String(res.headers?.["content-type"] || "");
  if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
    throw new ScrapeError(`That address didn't return a readable webpage.`);
  }

  const html = typeof res.data === "string" ? res.data : String(res.data ?? "");
  return { url: url.href, html };
}

/**
 * Scrapes a company's homepage plus a handful of its most relevant
 * same-origin pages (about, pricing, contact, FAQ, …) and returns their
 * combined, readable text. Never throws for a subpage that fails to load
 * — only the homepage itself (or a homepage with no readable text) is
 * fatal.
 */
export async function scrapeWebsite(
  input,
  { maxPages = DEFAULT_MAX_PAGES, totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS, fetcher = axios, validate = assertSafeWebhookUrl } = {},
) {
  const start = Date.now();
  const homeUrl = normalizeUrl(input);

  const home = await fetchPage(homeUrl, { validate, fetcher, redirectsLeft: MAX_REDIRECTS });
  const homeParsed = htmlToText(home.html);
  if (!homeParsed.text || homeParsed.text.trim().length < 40) {
    throw new ScrapeError("That website's homepage didn't have any readable text to learn from.");
  }

  const homeHref = home.url;
  const origin = new URL(homeHref).origin;
  const seen = new Set([homeHref.split("#")[0]]);
  const candidates = [];
  for (const link of extractLinks(home.html, homeHref)) {
    let u;
    try {
      u = new URL(link);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    const clean = u.href.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    candidates.push({ href: clean, path: u.pathname });
  }
  candidates.sort((a, b) => scoreLink(b.path, "") - scoreLink(a.path, ""));

  const pages = [{ url: homeHref, title: homeParsed.title, text: homeParsed.text }];
  const pagesScanned = [homeHref];

  for (const candidate of candidates) {
    if (pages.length >= maxPages) break;
    if (Date.now() - start > totalTimeoutMs) break;
    let pageUrl;
    try {
      pageUrl = new URL(candidate.href);
    } catch {
      continue;
    }
    try {
      const page = await fetchPage(pageUrl, { validate, fetcher, redirectsLeft: MAX_REDIRECTS });
      const parsed = htmlToText(page.html);
      if (parsed.text && parsed.text.trim().length > 40) {
        pages.push({ url: page.url, title: parsed.title, text: parsed.text });
        pagesScanned.push(page.url);
      }
    } catch {
      // A subpage failing (blocked, 404, timeout) just means we skip it —
      // the homepage alone is still a usable result.
    }
  }

  let rawText = pages.map((p) => `=== ${p.title || p.url} (${p.url}) ===\n${p.text}`).join("\n\n");
  let truncated = false;
  if (rawText.length > MAX_RAW_CHARS) {
    rawText = rawText.slice(0, MAX_RAW_CHARS);
    truncated = true;
  }

  return { title: homeParsed.title, homeUrl: homeHref, pagesScanned, rawText, truncated };
}
