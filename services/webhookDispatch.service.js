import axios from "axios";
import crypto from "crypto";
import { assertSafeWebhookUrl, WEBHOOK_MAX_RESPONSE_BYTES } from "./flow/flow.security.js";
import { decryptSecret } from "../utils/encryption.js";

// ======================================================
// OUTBOUND WEBHOOK DISPATCH (Phase 10)
// Formalizes Company.webhook into a real event system. Every event
// uses the same envelope (Section 9) and the same SSRF-hardened,
// signed delivery path — this is the ONE place an event leaves
// Nuformly for a company's configured webhook URL.
//
// Only events that can be generated reliably are wired up (see
// callers): conversation.created, conversation.message,
// conversation.handoff, conversation.closed. visitor.created is
// deliberately NOT included — the public /bot/v1/visitor endpoint
// upserts, so "created" vs "updated" isn't reliably distinguishable
// there without a broader change; documented as a known limitation
// rather than dispatched on a guess.
//
// Delivery is fire-and-forget from the caller's perspective (never
// awaited on the critical visitor-response path — see Section 41)
// and never throws into the caller; failures are swallowed after
// one bounded retry on transient (network/timeout) errors only —
// never on 4xx, which means the request itself was rejected and
// retrying identically would just fail again.
// ======================================================

const RETRYABLE = new Set(["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"]);

function sign(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function deliver(url, envelope, secret, attempt = 1) {
  const body = JSON.stringify(envelope);
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["X-Nuformly-Signature"] = `sha256=${sign(secret, body)}`;

  try {
    await assertSafeWebhookUrl(url);
    await axios.post(url, envelope, {
      headers,
      timeout: 8000,
      maxContentLength: WEBHOOK_MAX_RESPONSE_BYTES,
      maxBodyLength: WEBHOOK_MAX_RESPONSE_BYTES,
    });
  } catch (err) {
    const retryable = RETRYABLE.has(err.code) && !err.response;
    if (retryable && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500));
      return deliver(url, envelope, secret, attempt + 1);
    }
    // Never logs the URL's query string or the payload — only that
    // delivery failed and why, matching Section 34's "never log
    // secrets/payloads" for integration audit records.
    console.error(`Webhook dispatch failed for event ${envelope.event}:`, err.message);
  }
}

/**
 * Fire-and-forget: dispatches `event` to `company`'s configured
 * webhook if one is enabled. Safe to call without awaiting; never
 * rejects into the caller.
 */
export function dispatchWebhookEvent(company, event, data) {
  if (!company?.webhook?.enabled || !company?.webhook?.url) return;

  const envelope = {
    event,
    timestamp: new Date().toISOString(),
    companyId: company.companyId,
    data,
  };

  let secret = null;
  try {
    secret = company.webhook.secretEncrypted ? decryptSecret(company.webhook.secretEncrypted) : null;
  } catch (err) {
    console.error("Webhook secret decryption failed:", err.message);
  }

  deliver(company.webhook.url, envelope, secret).catch(() => {});
}
