// Dependency-free HTML → plain text, for turning a scraped webpage into
// something an AI model can read. Not a full browser-grade parser — good
// enough to strip markup, scripts, and styling noise from a real company
// website and keep the words a visitor would actually see.

const SKIP_TAGS = ["script", "style", "noscript", "template", "svg", "head", "iframe"];

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
};

function decodeEntities(str) {
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code)) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return "";
        }
      }
      return "";
    }
    return ENTITIES[body] ?? m;
  });
}

/** Strips tags this function never wants text from (and their contents). */
function stripSkippedBlocks(html) {
  let out = html;
  for (const tag of SKIP_TAGS) {
    out = out.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  return out;
}

/** Inserts a newline where a block-level tag closes, so words from
 *  different paragraphs/list items don't run together once tags are gone. */
const BLOCK_TAGS_RE = /<\/(p|div|section|article|header|footer|nav|main|aside|li|tr|table|h[1-6]|blockquote|pre|br|ul|ol)\b[^>]*>/gi;

export function htmlToText(html) {
  const input = String(html || "");
  const titleMatch = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : "";

  let body = stripSkippedBlocks(input);
  body = body.replace(/<br\s*\/?>/gi, "\n");
  body = body.replace(BLOCK_TAGS_RE, "\n");
  body = body.replace(/<[^>]+>/g, " ");
  body = decodeEntities(body);
  body = body
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  // Collapse 3+ blank lines down to a single blank line between sections.
  body = body.replace(/\n{3,}/g, "\n\n");

  return { title, text: body.trim() };
}

/** Absolute URLs for every <a href> in the page, resolved against `baseUrl`. */
export function extractLinks(html, baseUrl) {
  const input = String(html || "");
  const links = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(input))) {
    const href = m[1].trim();
    if (!href || /^(javascript|mailto|tel):/i.test(href)) continue;
    try {
      links.push(new URL(href, baseUrl).href);
    } catch {
      // malformed href — skip it
    }
  }
  return links;
}
