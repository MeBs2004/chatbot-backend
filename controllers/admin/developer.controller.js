import crypto from "crypto";

import ApiKey, { API_SCOPES } from "../../models/apiKey.model.js";
import DeveloperWebhook, { WEBHOOK_EVENTS } from "../../models/developerWebhook.model.js";
import ApiUsage from "../../models/apiUsage.model.js";
import Company from "../../models/company.model.js";
import Chatbot from "../../models/chatbot.model.js";
import { can, getPermittedCompanyIds, PERMISSIONS } from "../../services/admin/permissions.service.js";
import { generateApiKeyToken } from "../../utils/apiKeyToken.js";
import { encryptSecret } from "../../utils/encryption.js";
import { assertSafeWebhookUrl } from "../../services/flow/flow.security.js";
import { sendTestDelivery } from "../../services/developerWebhookDispatch.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { assertApiKeyQuota, assertWebhookQuota, QuotaExceededError } from "../../services/billing/quota.service.js";

// ======================================================
// DEVELOPER PLATFORM — ADMIN MANAGEMENT (Phase 12)
// These endpoints are authenticated with the existing admin JWT
// (adminAuthMiddleware, mounted at /api/admin/developer/*) — this is
// where a human manages API keys/webhooks from the dashboard. The
// keys/webhooks THEMSELVES authenticate external callers separately,
// at /api/v1/developer/* (see middleware/apiKeyAuth.middleware.js
// and routes/developerApi.route.js). Never conflate the two
// (Section 35/36).
// ======================================================

async function requirePermission(req, res, companyId, permission) {
  if (!companyId) {
    res.status(400).json({ success: false, message: "companyId is required." });
    return false;
  }
  if (!(await can(req.adminUser, permission, { companyId }))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return false;
  }
  return true;
}

const EXPIRY_DAYS = { never: null, "30d": 30, "90d": 90, "1y": 365 };

function resolveExpiresAt(expiresIn, customDate) {
  if (expiresIn === "custom") {
    const d = new Date(customDate);
    if (Number.isNaN(d.getTime()) || d <= new Date()) return { error: "Please provide a valid future expiration date." };
    return { value: d };
  }
  if (!(expiresIn in EXPIRY_DAYS)) return { error: "Invalid expiration option." };
  const days = EXPIRY_DAYS[expiresIn];
  return { value: days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000) };
}

async function validateChatbotIds(companyId, chatbotIds) {
  if (!Array.isArray(chatbotIds) || chatbotIds.length === 0) return { value: [] };
  const chatbots = await Chatbot.find({ _id: { $in: chatbotIds }, companyId }).select("_id").lean();
  if (chatbots.length !== chatbotIds.length) {
    return { error: "One or more selected chatbots don't belong to this company." };
  }
  return { value: chatbotIds };
}

// ------------------------------------------------------
// API KEYS
// ------------------------------------------------------

export const listApiKeys = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { companyId } = req.query;
    const filter = {};

    if (companyId) {
      if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_KEYS_VIEW))) return;
      filter.companyId = companyId;
    } else {
      const permittedIds = await getPermittedCompanyIds(requester, PERMISSIONS.DEVELOPER_KEYS_VIEW);
      if (permittedIds !== null) {
        if (permittedIds.length === 0) return res.status(200).json({ success: true, apiKeys: [] });
        filter.companyId = { $in: permittedIds };
      }
    }

    const apiKeys = await ApiKey.find(filter).select("-secretHash").sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, apiKeys, availableScopes: API_SCOPES });
  } catch (error) {
    console.error("List API Keys Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load API keys." });
  }
};

export const createApiKey = async (req, res) => {
  try {
    const { companyId, name, scopes, chatbotIds = [], expiresIn = "never", expiresAt: customDate } = req.body;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_KEYS_CREATE))) return;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }
    if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some((s) => !API_SCOPES.includes(s))) {
      return res.status(400).json({ success: false, message: "Select at least one valid scope." });
    }

    const chatbotResult = await validateChatbotIds(companyId, chatbotIds);
    if (chatbotResult.error) return res.status(400).json({ success: false, message: chatbotResult.error });

    const expiry = resolveExpiresAt(expiresIn, customDate);
    if (expiry.error) return res.status(400).json({ success: false, message: expiry.error });

    try {
      await assertApiKeyQuota(companyId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return res.status(402).json({ success: false, message: err.message, code: "QUOTA_EXCEEDED", limitKey: err.limitKey });
      }
      throw err;
    }

    const { token, keyPrefix, secretHash } = generateApiKeyToken();

    const apiKey = await ApiKey.create({
      companyId,
      createdBy: req.adminUser._id,
      name: name.trim(),
      keyPrefix,
      secretHash,
      scopes,
      chatbotIds: chatbotResult.value,
      expiresAt: expiry.value,
    });

    await logAction(req, {
      action: "API_KEY_CREATED",
      resource: "ApiKey",
      resourceId: apiKey._id,
      companyId,
      metadata: { name: apiKey.name, scopes, keyPrefix },
    });

    const { secretHash: _omit, ...redacted } = apiKey.toObject();
    return res.status(201).json({ success: true, apiKey: redacted, token });
  } catch (error) {
    console.error("Create API Key Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create API key." });
  }
};

export const getApiKey = async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.id).select("-secretHash").lean();
    if (!apiKey) return res.status(404).json({ success: false, message: "API key not found." });
    if (!(await requirePermission(req, res, apiKey.companyId, PERMISSIONS.DEVELOPER_KEYS_VIEW))) return;
    return res.status(200).json({ success: true, apiKey });
  } catch (error) {
    console.error("Get API Key Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load API key." });
  }
};

export const rotateApiKey = async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.id);
    if (!apiKey) return res.status(404).json({ success: false, message: "API key not found." });
    if (!(await requirePermission(req, res, apiKey.companyId, PERMISSIONS.DEVELOPER_KEYS_ROTATE))) return;

    if (apiKey.status !== "ACTIVE") {
      return res.status(400).json({ success: false, message: `Cannot rotate a ${apiKey.status.toLowerCase()} key.` });
    }

    const { token, keyPrefix, secretHash } = generateApiKeyToken();
    apiKey.keyPrefix = keyPrefix;
    apiKey.secretHash = secretHash;
    apiKey.rotatedAt = new Date();
    await apiKey.save();

    await logAction(req, {
      action: "API_KEY_ROTATED",
      resource: "ApiKey",
      resourceId: apiKey._id,
      companyId: apiKey.companyId,
      metadata: { name: apiKey.name, keyPrefix },
    });

    const { secretHash: _omit, ...redacted } = apiKey.toObject();
    return res.status(200).json({ success: true, apiKey: redacted, token });
  } catch (error) {
    console.error("Rotate API Key Error:", error);
    return res.status(500).json({ success: false, message: "Failed to rotate API key." });
  }
};

export const revokeApiKey = async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.id);
    if (!apiKey) return res.status(404).json({ success: false, message: "API key not found." });
    if (!(await requirePermission(req, res, apiKey.companyId, PERMISSIONS.DEVELOPER_KEYS_REVOKE))) return;

    if (apiKey.status === "REVOKED") {
      return res.status(400).json({ success: false, message: "This key is already revoked." });
    }

    apiKey.status = "REVOKED";
    apiKey.revokedAt = new Date();
    apiKey.revokedBy = req.adminUser._id;
    await apiKey.save();

    await logAction(req, {
      action: "API_KEY_REVOKED",
      resource: "ApiKey",
      resourceId: apiKey._id,
      companyId: apiKey.companyId,
      metadata: { name: apiKey.name, keyPrefix: apiKey.keyPrefix },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Revoke API Key Error:", error);
    return res.status(500).json({ success: false, message: "Failed to revoke API key." });
  }
};

// ------------------------------------------------------
// DEVELOPER WEBHOOKS
// ------------------------------------------------------

export const listWebhooks = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { companyId } = req.query;
    const filter = {};

    if (companyId) {
      if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_WEBHOOKS_VIEW))) return;
      filter.companyId = companyId;
    } else {
      const permittedIds = await getPermittedCompanyIds(requester, PERMISSIONS.DEVELOPER_WEBHOOKS_VIEW);
      if (permittedIds !== null) {
        if (permittedIds.length === 0) return res.status(200).json({ success: true, webhooks: [] });
        filter.companyId = { $in: permittedIds };
      }
    }

    const webhooks = await DeveloperWebhook.find(filter)
      .select("-secretEncrypted")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, webhooks, availableEvents: WEBHOOK_EVENTS });
  } catch (error) {
    console.error("List Webhooks Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load webhooks." });
  }
};

export const createWebhook = async (req, res) => {
  try {
    const { companyId, name, url, events, chatbotIds = [] } = req.body;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_WEBHOOKS_CREATE))) return;

    if (!name || !name.trim()) return res.status(400).json({ success: false, message: "Name is required." });
    if (!Array.isArray(events) || events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
      return res.status(400).json({ success: false, message: "Select at least one valid event." });
    }

    try {
      await assertSafeWebhookUrl(url);
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    const chatbotResult = await validateChatbotIds(companyId, chatbotIds);
    if (chatbotResult.error) return res.status(400).json({ success: false, message: chatbotResult.error });

    try {
      await assertWebhookQuota(companyId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return res.status(402).json({ success: false, message: err.message, code: "QUOTA_EXCEEDED", limitKey: err.limitKey });
      }
      throw err;
    }

    const secret = crypto.randomBytes(24).toString("hex");

    const webhook = await DeveloperWebhook.create({
      companyId,
      createdBy: req.adminUser._id,
      name: name.trim(),
      url,
      secretEncrypted: encryptSecret(secret),
      events,
      chatbotIds: chatbotResult.value,
    });

    await logAction(req, {
      action: "WEBHOOK_CREATED",
      resource: "DeveloperWebhook",
      resourceId: webhook._id,
      companyId,
      metadata: { name: webhook.name, events },
    });

    const { secretEncrypted, ...redacted } = webhook.toObject();
    return res.status(201).json({ success: true, webhook: redacted, secret });
  } catch (error) {
    console.error("Create Webhook Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create webhook." });
  }
};

async function loadAuthorizedWebhook(req, res, permission) {
  const webhook = await DeveloperWebhook.findById(req.params.id);
  if (!webhook) {
    res.status(404).json({ success: false, message: "Webhook not found." });
    return null;
  }
  if (!(await requirePermission(req, res, webhook.companyId, permission))) return null;
  return webhook;
}

export const updateWebhook = async (req, res) => {
  try {
    const webhook = await loadAuthorizedWebhook(req, res, PERMISSIONS.DEVELOPER_WEBHOOKS_UPDATE);
    if (!webhook) return;

    const { name, url, events, chatbotIds, status } = req.body;

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ success: false, message: "Name is required." });
      webhook.name = name.trim();
    }
    if (url !== undefined) {
      try {
        await assertSafeWebhookUrl(url);
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      webhook.url = url;
    }
    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0 || events.some((e) => !WEBHOOK_EVENTS.includes(e))) {
        return res.status(400).json({ success: false, message: "Select at least one valid event." });
      }
      webhook.events = events;
    }
    if (chatbotIds !== undefined) {
      const chatbotResult = await validateChatbotIds(webhook.companyId, chatbotIds);
      if (chatbotResult.error) return res.status(400).json({ success: false, message: chatbotResult.error });
      webhook.chatbotIds = chatbotResult.value;
    }
    if (status !== undefined) {
      if (!["ACTIVE", "DISABLED"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid status." });
      }
      webhook.status = status;
    }

    await webhook.save();

    await logAction(req, {
      action: status !== undefined ? (status === "ACTIVE" ? "WEBHOOK_ENABLED" : "WEBHOOK_DISABLED") : "WEBHOOK_UPDATED",
      resource: "DeveloperWebhook",
      resourceId: webhook._id,
      companyId: webhook.companyId,
      metadata: { fields: Object.keys(req.body || {}) },
    });

    const { secretEncrypted, ...redacted } = webhook.toObject();
    return res.status(200).json({ success: true, webhook: redacted });
  } catch (error) {
    console.error("Update Webhook Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update webhook." });
  }
};

export const deleteWebhook = async (req, res) => {
  try {
    const webhook = await loadAuthorizedWebhook(req, res, PERMISSIONS.DEVELOPER_WEBHOOKS_DELETE);
    if (!webhook) return;

    await DeveloperWebhook.deleteOne({ _id: webhook._id });

    await logAction(req, {
      action: "WEBHOOK_DELETED",
      resource: "DeveloperWebhook",
      resourceId: webhook._id,
      companyId: webhook.companyId,
      metadata: { name: webhook.name },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Webhook Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete webhook." });
  }
};

export const testWebhook = async (req, res) => {
  try {
    const webhook = await loadAuthorizedWebhook(req, res, PERMISSIONS.DEVELOPER_WEBHOOKS_UPDATE);
    if (!webhook) return;

    const result = await sendTestDelivery(webhook);

    await logAction(req, {
      action: "WEBHOOK_TESTED",
      resource: "DeveloperWebhook",
      resourceId: webhook._id,
      companyId: webhook.companyId,
      metadata: { ok: result.ok, statusCode: result.statusCode },
    });

    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Test Webhook Error:", error);
    return res.status(500).json({ success: false, message: "Failed to send test delivery." });
  }
};

// ------------------------------------------------------
// USAGE
// ------------------------------------------------------

const RANGE_HOURS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };

export const getUsage = async (req, res) => {
  try {
    const { companyId, range = "7d" } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_USAGE_VIEW))) return;

    let since;
    let until = new Date();
    if (range === "custom") {
      since = new Date(req.query.since);
      if (req.query.until) until = new Date(req.query.until);
      if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid custom date range." });
      }
    } else {
      const hours = RANGE_HOURS[range];
      if (!hours) return res.status(400).json({ success: false, message: "Invalid range." });
      since = new Date(Date.now() - hours * 60 * 60 * 1000);
    }

    const match = { companyId, createdAt: { $gte: since, $lte: until } };

    const [totals, perDay, activeKeyCount, webhookTotals] = await Promise.all([
      ApiUsage.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            successful: { $sum: { $cond: [{ $lt: ["$statusCode", 400] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $gte: ["$statusCode", 400] }, 1, 0] } },
            rateLimited: { $sum: { $cond: ["$rateLimited", 1, 0] } },
          },
        },
      ]),
      ApiUsage.aggregate([
        { $match: match },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      ApiKey.countDocuments({ companyId, status: "ACTIVE" }),
      DeveloperWebhook.aggregate([
        { $match: { companyId } },
        { $group: { _id: null, deliveries: { $sum: "$totalDeliveries" }, failures: { $sum: "$totalFailures" } } },
      ]),
    ]);

    const t = totals[0] || { total: 0, successful: 0, failed: 0, rateLimited: 0 };
    const w = webhookTotals[0] || { deliveries: 0, failures: 0 };

    return res.status(200).json({
      success: true,
      range: { since, until },
      metrics: {
        requests: t.total,
        successfulRequests: t.successful,
        failedRequests: t.failed,
        rateLimitedRequests: t.rateLimited,
        activeApiKeys: activeKeyCount,
        webhookDeliveries: w.deliveries,
        webhookFailures: w.failures,
      },
      requestsPerDay: perDay,
    });
  } catch (error) {
    console.error("Get Usage Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load usage." });
  }
};

// ------------------------------------------------------
// SETTINGS
// ------------------------------------------------------

export const getDeveloperSettings = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_SETTINGS_MANAGE))) return;

    const company = await Company.findOne({ companyId }).select("developer").lean();
    if (!company) return res.status(404).json({ success: false, message: "Company not found." });

    return res.status(200).json({ success: true, settings: company.developer, apiVersion: "v1" });
  } catch (error) {
    console.error("Get Developer Settings Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load developer settings." });
  }
};

export const updateDeveloperSettings = async (req, res) => {
  try {
    const { companyId, rateLimitPerMinute } = req.body;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.DEVELOPER_SETTINGS_MANAGE))) return;

    if (
      rateLimitPerMinute === undefined ||
      typeof rateLimitPerMinute !== "number" ||
      rateLimitPerMinute < 10 ||
      rateLimitPerMinute > 1000
    ) {
      return res.status(400).json({ success: false, message: "rateLimitPerMinute must be a number between 10 and 1000." });
    }

    const company = await Company.findOneAndUpdate(
      { companyId },
      { "developer.rateLimitPerMinute": rateLimitPerMinute },
      { new: true }
    ).select("developer");
    if (!company) return res.status(404).json({ success: false, message: "Company not found." });

    await logAction(req, {
      action: "DEVELOPER_SETTINGS_UPDATED",
      resource: "Company",
      resourceId: companyId,
      companyId,
      metadata: { rateLimitPerMinute },
    });

    return res.status(200).json({ success: true, settings: company.developer });
  } catch (error) {
    console.error("Update Developer Settings Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update developer settings." });
  }
};
