// ======================================================
// COMPANY ID ("workspace slug") rules — shared by public self-
// registration and the Super Admin "Add Company" form, so both doors
// onto Company.companyId accept exactly the same values.
// ======================================================

// A chosen workspace slug must never collide with a real platform
// route or a confusing/impersonating word. Deliberately generous —
// this list errs toward over-blocking rather than letting something
// ambiguous through.
export const RESERVED_SLUGS = new Set([
  "admin", "api", "www", "app", "dashboard", "login", "logout", "signup",
  "signin", "register", "settings", "billing", "developer", "company",
  "companies", "super", "superadmin", "root", "system", "null", "undefined",
  "test", "support", "help", "static", "assets", "public", "nuformly",
  "nuform", "oya", "gemkara", "account", "accounts", "user", "users",
  "chatbot", "chatbots", "widget", "embed", "webhook", "webhooks",
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

export function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Returns null when valid, or a user-facing reason string when not —
// shared by both the live check-slug endpoint and final registration
// so the two can never disagree about what's a valid slug.
export function invalidSlugReason(slug) {
  if (!SLUG_RE.test(slug)) {
    return "Workspace URL must be 3-48 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen.";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return "This workspace URL is reserved. Please choose another.";
  }
  return null;
}
