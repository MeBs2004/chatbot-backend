import crypto from "crypto";

// ======================================================
// API KEY TOKEN GENERATION (Phase 12)
// Cryptographically secure only — crypto.randomBytes, never
// Math.random/timestamps/UUIDs/predictable strings. The full token
// is shown to the admin exactly once (at creation/rotation) and
// never stored — only its SHA-256 hash. `keyPrefix` is NOT secret
// (it's how the token is displayed after creation, e.g. in the
// table's "Prefix" column, and how the DB looks the key up before
// verifying the hash) — the actual authentication is the full-token
// hash comparison in apiKeyAuth.middleware.js.
// ======================================================

const PREFIX = "nf_live_";
const SECRET_BYTES = 32; // 256 bits of entropy
const VISIBLE_PREFIX_LENGTH = 16; // "nf_live_" + 8 chars of the random part

export function generateApiKeyToken() {
  const random = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const token = `${PREFIX}${random}`;
  const keyPrefix = token.slice(0, VISIBLE_PREFIX_LENGTH);
  const secretHash = hashToken(token);
  return { token, keyPrefix, secretHash };
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function extractKeyPrefix(token) {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  return token.slice(0, VISIBLE_PREFIX_LENGTH);
}

export function verifyToken(token, storedHash) {
  if (!token || !storedHash) return false;
  const computed = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return crypto.timingSafeEqual(computed, stored);
}
