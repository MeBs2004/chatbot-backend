import crypto from "crypto";

// ======================================================
// ENCRYPTION (Phase 10)
// No encryption-at-rest utility existed anywhere in this codebase
// before this phase (confirmed by audit) — Company.webhook.secret
// was stored and returned as plain text. This is the one real
// implementation every integration credential now goes through:
// AES-256-GCM (authenticated encryption — a tampered ciphertext
// fails to decrypt rather than silently returning garbage), keyed by
// INTEGRATION_ENCRYPTION_KEY. Uses Node's built-in `crypto` only —
// no new dependency, no invented cipher.
// ======================================================

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended nonce length for GCM

function getKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY is not set. Required to store or read any integration credential."
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).");
  }
  return key;
}

/**
 * Encrypts a plaintext string (e.g. a webhook secret or bot token)
 * into a single storable string: `<iv>:<authTag>:<ciphertext>`, all
 * hex-encoded. Returns null for empty/undefined input so "no secret
 * configured" stays a clean null rather than an encrypted empty
 * string.
 */
export function encryptSecret(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypts a value produced by encryptSecret. Server-side only —
 * never call this in code whose result reaches an HTTP response.
 */
export function decryptSecret(stored) {
  if (!stored) return null;
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) return null;

  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}

export function hasEncryptionKeyConfigured() {
  return Boolean(process.env.INTEGRATION_ENCRYPTION_KEY);
}
