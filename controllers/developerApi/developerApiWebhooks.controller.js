import crypto from "crypto";

import DeveloperWebhook, { WEBHOOK_EVENTS } from "../../models/developerWebhook.model.js";
import Chatbot from "../../models/chatbot.model.js";
import { assertSafeWebhookUrl } from "../../services/flow/flow.security.js";
import { encryptSecret } from "../../utils/encryption.js";
import { sendSuccess, sendError } from "../../utils/apiResponse.js";
import { assertWebhookQuota, QuotaExceededError } from "../../services/billing/quota.service.js";

// ======================================================
// DEVELOPER API v1 — WEBHOOKS (webhooks:read / webhooks:write)
// A v1-API mirror of controllers/admin/developer.controller.js's
// webhook CRUD, scoped strictly to req.apiKeyContext.companyId
// instead of an admin permission check — same DeveloperWebhook
// model and delivery service, a different (API-key) caller.
// ======================================================

async function validateChatbotIds(companyId, chatbotIds) {
  if (!Array.isArray(chatbotIds) || chatbotIds.length === 0) return { value: [] };
  const chatbots = await Chatbot.find({ _id: { $in: chatbotIds }, companyId }).select("_id").lean();
  if (chatbots.length !== chatbotIds.length) {
    return { error: "One or more selected chatbots don't belong to this company." };
  }
  return { value: chatbotIds };
}

export const listWebhooks = async (req, res) => {
  try {
    const { companyId } = req.apiKeyContext;
    const webhooks = await DeveloperWebhook.find({ companyId }).select("-secretEncrypted").sort({ createdAt: -1 }).lean();
    return sendSuccess(res, { webhooks, availableEvents: WEBHOOK_EVENTS });
  } catch (error) {
    console.error("Developer API listWebhooks Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to load webhooks.");
  }
};

export const createWebhook = async (req, res) => {
  try {
    const { companyId, apiKey } = req.apiKeyContext;
    const { name, url, events, chatbotIds = [] } = req.body;

    if (!name || !name.trim()) return sendError(res, 400, "INVALID_REQUEST", "Name is required.");
    if (!Array.isArray(events) || events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
      return sendError(res, 400, "INVALID_REQUEST", "Select at least one valid event.");
    }

    try {
      await assertSafeWebhookUrl(url);
    } catch (err) {
      return sendError(res, 400, "INVALID_REQUEST", err.message);
    }

    const chatbotResult = await validateChatbotIds(companyId, chatbotIds);
    if (chatbotResult.error) return sendError(res, 400, "INVALID_REQUEST", chatbotResult.error);

    try {
      await assertWebhookQuota(companyId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return sendError(res, 402, "QUOTA_EXCEEDED", err.message);
      }
      throw err;
    }

    const secret = crypto.randomBytes(24).toString("hex");
    const webhook = await DeveloperWebhook.create({
      companyId,
      createdBy: apiKey.createdBy,
      name: name.trim(),
      url,
      secretEncrypted: encryptSecret(secret),
      events,
      chatbotIds: chatbotResult.value,
    });

    const { secretEncrypted, ...redacted } = webhook.toObject();
    return sendSuccess(res, { webhook: redacted, secret }, 201);
  } catch (error) {
    console.error("Developer API createWebhook Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to create webhook.");
  }
};

async function loadScopedWebhook(req, res) {
  const { companyId } = req.apiKeyContext;
  const webhook = await DeveloperWebhook.findOne({ _id: req.params.id, companyId });
  if (!webhook) {
    sendError(res, 404, "RESOURCE_NOT_FOUND", "Webhook not found.");
    return null;
  }
  return webhook;
}

export const updateWebhook = async (req, res) => {
  try {
    const webhook = await loadScopedWebhook(req, res);
    if (!webhook) return;

    const { name, url, events, chatbotIds, status } = req.body;

    if (name !== undefined) {
      if (!name.trim()) return sendError(res, 400, "INVALID_REQUEST", "Name is required.");
      webhook.name = name.trim();
    }
    if (url !== undefined) {
      try {
        await assertSafeWebhookUrl(url);
      } catch (err) {
        return sendError(res, 400, "INVALID_REQUEST", err.message);
      }
      webhook.url = url;
    }
    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
        return sendError(res, 400, "INVALID_REQUEST", "Select at least one valid event.");
      }
      webhook.events = events;
    }
    if (chatbotIds !== undefined) {
      const chatbotResult = await validateChatbotIds(webhook.companyId, chatbotIds);
      if (chatbotResult.error) return sendError(res, 400, "INVALID_REQUEST", chatbotResult.error);
      webhook.chatbotIds = chatbotResult.value;
    }
    if (status !== undefined) {
      if (!["ACTIVE", "DISABLED"].includes(status)) return sendError(res, 400, "INVALID_REQUEST", "Invalid status.");
      webhook.status = status;
    }

    await webhook.save();
    const { secretEncrypted, ...redacted } = webhook.toObject();
    return sendSuccess(res, { webhook: redacted });
  } catch (error) {
    console.error("Developer API updateWebhook Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to update webhook.");
  }
};

export const deleteWebhook = async (req, res) => {
  try {
    const webhook = await loadScopedWebhook(req, res);
    if (!webhook) return;

    await DeveloperWebhook.deleteOne({ _id: webhook._id });
    return sendSuccess(res, { deleted: true });
  } catch (error) {
    console.error("Developer API deleteWebhook Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Failed to delete webhook.");
  }
};
