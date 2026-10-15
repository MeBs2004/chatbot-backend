// ======================================================
// WEBSITE DOMAIN ALLOWLIST — per-chatbot, server-enforced.
//
// Deliberately a separate control from CORS, from the developer API
// key auth, and from company/tenant identification:
//   - CORS (index.js) governs which browser origins may even read a
//     cross-origin response at all — unrelated to WHICH chatbot.
//   - This allowlist governs which WEBSITE a specific chatbot is
//     authorized to run on, checked against the Origin/Referer the
//     browser sends.
//   - Tenant isolation (getCompanyRole etc.) governs admin API
//     access — entirely separate from this public, unauthenticated
//     surface.
//
// Honest limitation (documented, not hidden): the Origin/Referer
// header is supplied by the calling HTTP client. A real browser
// cannot forge it for a cross-origin request, so this is a genuine
// control against embedding on an unauthorized WEBSITE. It is NOT a
// substitute for authentication — a non-browser HTTP client (curl,
// a script) can set any Origin/Referer it wants. The actual secrets
// boundary is, and remains, that the public config/messaging
// endpoints never return anything private regardless of origin —
// this allowlist only decides whether to answer at all.
// ======================================================

const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/i;
export const MAX_ALLOWED_DOMAINS = 20;
export const MAX_DOMAIN_LENGTH = 253;

export function isValidDomainEntry(entry) {
  return typeof entry === "string" && entry.length > 0 && entry.length <= MAX_DOMAIN_LENGTH && DOMAIN_RE.test(entry);
}

export function normalizeDomainList(list) {
  if (!Array.isArray(list)) return { valid: false, error: "allowedDomains must be an array." };
  if (list.length > MAX_ALLOWED_DOMAINS) {
    return { valid: false, error: `A chatbot can have at most ${MAX_ALLOWED_DOMAINS} allowed domains.` };
  }
  const normalized = [];
  for (const raw of list) {
    const entry = String(raw || "").trim().toLowerCase();
    if (!entry) continue;
    if (!isValidDomainEntry(entry)) {
      return { valid: false, error: `"${raw}" is not a valid domain. Use a bare hostname like "example.com" or "*.example.com", optionally with a port.` };
    }
    normalized.push(entry);
  }
  return { valid: true, domains: [...new Set(normalized)] };
}

function extractHostname(originOrReferer) {
  try {
    const url = new URL(originOrReferer);
    return url.port ? `${url.hostname.toLowerCase()}:${url.port}` : url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Empty allowlist = unrestricted (today's behavior, unchanged — every
 * chatbot that has never configured this stays exactly as it was).
 * A non-empty allowlist requires a verifiable Origin/Referer that
 * matches one of the entries (exact host[:port], or a `*.base.tld`
 * wildcard matching any subdomain of `base.tld`).
 */
export function isOriginAllowed(allowedDomains, req) {
  if (!allowedDomains || allowedDomains.length === 0) return true;

  const originHeader = req.headers.origin || req.headers.referer;
  const hostname = originHeader ? extractHostname(originHeader) : null;
  if (!hostname) return false; // policy configured, no verifiable origin -> reject, never assume

  const bareHost = hostname.split(":")[0];
  return allowedDomains.some((d) => {
    if (d.startsWith("*.")) {
      const base = d.slice(2).split(":")[0];
      return bareHost === base || bareHost.endsWith(`.${base}`);
    }
    return hostname === d || bareHost === d;
  });
}
