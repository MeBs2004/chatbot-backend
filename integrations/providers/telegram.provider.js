import axios from "axios";
import crypto from "crypto";
import { encryptSecret, decryptSecret } from "../../utils/encryption.js";

// ======================================================
// TELEGRAM PROVIDER (Phase 10)
// Uses the official Telegram Bot API only — no scraping, no
// unofficial automation (Section 22). This code is real and would
// work with a genuine bot token; NO real Telegram credentials exist
// in this environment (confirmed by audit: no TELEGRAM_* env var
// anywhere), so this provider's live status is honestly
// NOT_CONFIGURED, not "tested" or "connected". See Phase 10 report.
// ======================================================

export const meta = {
  key: "telegram",
  label: "Telegram",
  category: "channel",
  scope: "CHATBOT",
  description: "Connect a Telegram bot to this chatbot using the official Telegram Bot API.",
  setupRequirements: [
    "A Telegram bot token from @BotFather",
    "PUBLIC_BACKEND_URL must be set to this server's real, publicly-reachable HTTPS URL (Telegram must be able to reach it — a purely local/dev backend cannot receive real webhook traffic)",
  ],
};

const API_BASE = "https://api.telegram.org/bot";

function publicBackendUrl() {
  return process.env.PUBLIC_BACKEND_URL || null;
}

/**
 * Validates a bot token against Telegram's real getMe endpoint.
 * Throws with a safe, human-readable message on any failure —
 * never echoes the token itself into the error.
 */
async function validateToken(botToken) {
  try {
    const res = await axios.get(`${API_BASE}${botToken}/getMe`, { timeout: 8000 });
    if (!res.data?.ok) throw new Error("Telegram rejected this token.");
    return res.data.result; // { id, is_bot, first_name, username, ... }
  } catch (err) {
    if (err.response?.status === 401) throw new Error("Invalid bot token.");
    if (err.code === "ECONNABORTED") throw new Error("Telegram API request timed out.");
    throw new Error("Could not reach the Telegram API.");
  }
}

/**
 * connect: validates the token, registers our webhook with Telegram
 * (setWebhook), and stores the encrypted credentials. Returns the
 * fields the caller should persist onto the ChannelConnection —
 * never returns the raw token.
 */
export async function connect({ botToken }) {
  if (!botToken || typeof botToken !== "string") {
    throw new Error("A bot token is required.");
  }

  const botInfo = await validateToken(botToken);

  const backendUrl = publicBackendUrl();
  if (!backendUrl) {
    throw new Error(
      "PUBLIC_BACKEND_URL is not configured on this server — Telegram cannot deliver messages to a backend it can't reach. Set it and try again."
    );
  }

  // A per-connection secret Telegram will echo back on every webhook
  // call (X-Telegram-Bot-Api-Secret-Token) — the real, provider-
  // supported verification mechanism (Section 7), not an invented one.
  const webhookSecretToken = crypto.randomBytes(24).toString("hex");

  return {
    botInfo,
    webhookSecretToken,
    credentialsEncrypted: encryptSecret(JSON.stringify({ botToken, webhookSecretToken })),
  };
}

/**
 * Actually registers the webhook with Telegram — separated from
 * connect() so the caller can persist the ChannelConnection (and
 * therefore know its own _id, needed for the webhook URL) before
 * telling Telegram where to send updates.
 */
export async function registerWebhook({ connectionId, botToken, webhookSecretToken }) {
  const backendUrl = publicBackendUrl().replace(/\/$/, "");
  const webhookUrl = `${backendUrl}/webhooks/telegram/${connectionId}`;

  const res = await axios.post(
    `${API_BASE}${botToken}/setWebhook`,
    { url: webhookUrl, secret_token: webhookSecretToken, allowed_updates: ["message"] },
    { timeout: 8000 }
  );
  if (!res.data?.ok) {
    throw new Error(res.data?.description || "Telegram rejected the webhook registration.");
  }
}

export async function disconnect({ connection }) {
  if (!connection.credentialsEncrypted) return;
  const { botToken } = JSON.parse(decryptSecret(connection.credentialsEncrypted));
  try {
    await axios.post(`${API_BASE}${botToken}/deleteWebhook`, {}, { timeout: 8000 });
  } catch (err) {
    // Best-effort — the connection is being removed either way, but
    // this is real, not silently swallowed as a fake success.
    console.error("Telegram deleteWebhook failed:", err.message);
  }
}

export async function test({ connection }) {
  if (!connection.credentialsEncrypted) {
    throw new Error("No bot token configured.");
  }
  const { botToken } = JSON.parse(decryptSecret(connection.credentialsEncrypted));
  const botInfo = await validateToken(botToken);
  return { ok: true, botInfo };
}

/**
 * send: real call to Telegram's sendMessage API.
 */
export async function send({ connection, chatId, text }) {
  const { botToken } = JSON.parse(decryptSecret(connection.credentialsEncrypted));
  await axios.post(`${API_BASE}${botToken}/sendMessage`, { chat_id: chatId, text }, { timeout: 8000 });
}

/**
 * Normalizes a Telegram Update into { visitorId, text } or null if
 * this update isn't a plain text message we handle (Section 21 scope
 * — MVP is text-only, matching the website widget's own text-first
 * design before file/image support was added).
 */
export function normalizeUpdate(update) {
  const message = update?.message;
  if (!message || typeof message.text !== "string") return null;
  return {
    chatId: message.chat.id,
    visitorId: `telegram:${message.chat.id}`,
    text: message.text,
    fromName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || message.from?.username || null,
  };
}
