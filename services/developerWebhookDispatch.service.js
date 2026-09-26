import axios from "axios";
import crypto from "crypto";

import DeveloperWebhook from "../models/developerWebhook.model.js";
import { assertSafeWebhookUrl, WEBHOOK_MAX_RESPONSE_BYTES } from "./flow/flow.security.js";
import { decryptSecret } from "../utils/encryption.js";

// ======================================================
// DEVELOPER WEBHOOK DISPATCH (Phase 12)
// Parallel to webhookDispatch.service.js (Phase 10, untouched) by
// deliberate choice — same low-risk pattern established in Phase 10
// (conversationPipeline.service.js): a new capability calls the
// same security primitives (assertSafeWebhookUrl, HMAC signing) via
// its own small service, rather than modifying the tested Phase 10
// single-URL dispatcher to also fan out to N subscriptions.
//
// Every event gets a real, unique ID (Section 19) and every
// delivery's outcome is persisted onto the DeveloperWebhook document
// itself (Section 21's "Delivery status / Last delivery / Failure
// count" — no separate delivery-log collection, since the doc's own
// fields are sufficient for what the UI shows and keeps this
// additive and simple).
// ======================================================

const RETRYABLE = new Set(["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"]);

function sign(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function buildEnvelope(event, companyId, data) {
  return {
    id: `evt_${crypto.randomBytes(12).toString("hex")}`,
    event,
    timestamp: new Date().toISOString(),
    companyId,
    data,
  };
}

async function attemptDelivery(url, envelope, secret, attempt = 1) {
  const body = JSON.stringify(envelope);
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["X-Nuformly-Signature"] = `sha256=${sign(secret, body)}`;

  const start = Date.now();
  try {
    await assertSafeWebhookUrl(url);
    const res = await axios.post(url, envelope, {
      headers,
      timeout: 8000,
      maxContentLength: WEBHOOK_MAX_RESPONSE_BYTES,
      maxBodyLength: WEBHOOK_MAX_RESPONSE_BYTES,
    });
    return { ok: true, statusCode: res.status, latencyMs: Date.now() - start };
  } catch (err) {
    const retryable = RETRYABLE.has(err.code) && !err.response;
    if (retryable && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500));
      return attemptDelivery(url, envelope, secret, attempt + 1);
    }
    return {
      ok: false,
      statusCode: err.response?.status || null,
      error: err.response ? `HTTP ${err.response.status}` : err.message,
      latencyMs: Date.now() - start,
    };
  }
}

async function persistOutcome(webhookId, result) {
  const now = new Date();
  const update = { lastDeliveryAt: now, lastStatusCode: result.statusCode };
  if (result.ok) {
    update.lastSuccessAt = now;
    update.failureCount = 0;
    update.lastError = null;
    await DeveloperWebhook.updateOne({ _id: webhookId }, { ...update, $inc: { totalDeliveries: 1 } });
    return;
  }
  update.lastFailureAt = now;
  update.lastError = result.error;
  await DeveloperWebhook.updateOne(
    { _id: webhookId },
    { ...update, $inc: { failureCount: 1, totalDeliveries: 1, totalFailures: 1 } }
  );
}

/**
 * Fire-and-forget: dispatches `event` to every ACTIVE
 * DeveloperWebhook subscribed to it for this company (and, if
 * chatbot-scoped, matching chatbotId). Never awaited by callers,
 * never throws.
 */
export async function dispatchDeveloperWebhooks(companyId, chatbotId, event, data) {
  try {
    const webhooks = await DeveloperWebhook.find({
      companyId,
      status: "ACTIVE",
      events: event,
    });

    for (const webhook of webhooks) {
      if (webhook.chatbotIds.length > 0 && (!chatbotId || !webhook.chatbotIds.some((id) => String(id) === String(chatbotId)))) {
        continue;
      }

      const envelope = buildEnvelope(event, companyId, data);
      let secret = null;
      try {
        secret = webhook.secretEncrypted ? decryptSecret(webhook.secretEncrypted) : null;
      } catch (err) {
        console.error("Developer webhook secret decryption failed:", err.message);
      }

      attemptDelivery(webhook.url, envelope, secret)
        .then((result) => persistOutcome(webhook._id, result))
        .catch((err) => console.error(`Developer webhook dispatch failed for event ${event}:`, err.message));
    }
  } catch (err) {
    console.error("dispatchDeveloperWebhooks lookup failed:", err.message);
  }
}

/**
 * Real, synchronous (awaited) test delivery — used by the "Send
 * Test" admin action (Section 22), never a faked "Test successful".
 */
export async function sendTestDelivery(webhook) {
  const envelope = buildEnvelope("webhook.test", webhook.companyId, {
    message: "This is a test event from Nuformly.",
  });
  let secret = null;
  try {
    secret = webhook.secretEncrypted ? decryptSecret(webhook.secretEncrypted) : null;
  } catch (err) {
    console.error("Developer webhook secret decryption failed:", err.message);
  }
  const result = await attemptDelivery(webhook.url, envelope, secret);
  await persistOutcome(webhook._id, result);
  return result;
}
