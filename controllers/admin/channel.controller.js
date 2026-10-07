import Chatbot from "../../models/chatbot.model.js";
import ChannelConnection from "../../models/channelConnection.model.js";
import { hasChatbotAccess, getCompanyRole } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { CHANNEL_PROVIDERS } from "../../integrations/registry.js";
import * as telegramProvider from "../../integrations/providers/telegram.provider.js";
import * as websiteProvider from "../../integrations/providers/website.provider.js";

// ======================================================
// CHANNELS (Phase 10)
// Chatbot-scoped (Section 27) — every endpoint re-derives the
// chatbot's real companyId from the database and re-checks access,
// the same pattern every prior phase's chatbot-scoped controller
// uses (flow.controller.js, aiSettings.controller.js, etc).
// ======================================================

async function loadAuthorizedChatbot(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot || chatbot.deletedAt) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }
  if (!(await hasChatbotAccess(req.adminUser, chatbot._id))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }
  return chatbot;
}

// Phase 11: DEVELOPER also gets integrations.manage (Section 35 —
// "webhooks, technical configuration" is explicitly in the
// DEVELOPER role's scope), everyone else keeps the original
// COMPANY_ADMIN-or-SUPER_ADMIN gate unchanged.
function requireCompanyAdmin(req, res, companyId) {
  return getCompanyRole(req.adminUser, companyId).then((role) => {
    if (!["SUPER_ADMIN", "COMPANY_ADMIN", "DEVELOPER"].includes(role)) {
      res.status(403).json({ success: false, message: "You don't have permission to manage integrations." });
      return false;
    }
    return true;
  });
}

// Never return credentialsEncrypted — only whether one exists.
function redactConnection(conn) {
  if (!conn) return null;
  const { credentialsEncrypted, ...rest } = conn;
  return { ...rest, hasCredentials: Boolean(credentialsEncrypted) };
}

export const listChannels = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    const connections = await ChannelConnection.find({ chatbotId: chatbot._id }).lean();
    const connectionMap = Object.fromEntries(connections.map((c) => [c.provider, c]));

    const websiteStatus = await websiteProvider.getStatus({ chatbotId: chatbot._id });

    const channels = await Promise.all(
      CHANNEL_PROVIDERS.map(async (p) => {
        if (p.key === "website") {
          return { ...p, status: websiteStatus, config: connectionMap.website?.config || { allowedDomains: [] } };
        }
        const conn = redactConnection(connectionMap[p.key]);
        return { ...p, status: conn?.status || "NOT_CONNECTED", ...conn };
      })
    );

    return res.status(200).json({ success: true, channels });
  } catch (error) {
    console.error("List Channels Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load channels." });
  }
};

export const updateWebsiteChannel = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;
    if (!(await requireCompanyAdmin(req, res, chatbot.companyId))) return;

    const { allowedDomains } = req.body;
    if (!Array.isArray(allowedDomains) || allowedDomains.some((d) => typeof d !== "string")) {
      return res.status(400).json({ success: false, message: "allowedDomains must be an array of strings." });
    }
    const cleaned = allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean).slice(0, 20);

    const connection = await ChannelConnection.findOneAndUpdate(
      { chatbotId: chatbot._id, provider: "website" },
      { companyId: chatbot.companyId, chatbotId: chatbot._id, provider: "website", config: { allowedDomains: cleaned }, createdBy: req.adminUser._id },
      { upsert: true, new: true }
    ).lean();

    await logAction(req, {
      action: "CHANNEL_UPDATED",
      resource: "ChannelConnection",
      resourceId: connection._id,
      companyId: chatbot.companyId,
      metadata: { provider: "website", domainCount: cleaned.length },
    });

    return res.status(200).json({ success: true, config: connection.config });
  } catch (error) {
    console.error("Update Website Channel Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update website channel." });
  }
};

export const connectTelegram = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;
    if (!(await requireCompanyAdmin(req, res, chatbot.companyId))) return;

    const { botToken } = req.body;
    if (!botToken || typeof botToken !== "string") {
      return res.status(400).json({ success: false, message: "botToken is required." });
    }

    let connection = await ChannelConnection.findOneAndUpdate(
      { chatbotId: chatbot._id, provider: "telegram" },
      { companyId: chatbot.companyId, chatbotId: chatbot._id, provider: "telegram", status: "CONNECTING", createdBy: req.adminUser._id },
      { upsert: true, new: true }
    );

    try {
      const { botInfo, webhookSecretToken, credentialsEncrypted } = await telegramProvider.connect({ botToken });
      await telegramProvider.registerWebhook({ connectionId: connection._id.toString(), botToken, webhookSecretToken });

      connection.status = "CONNECTED";
      connection.config = { botUsername: botInfo.username, botId: botInfo.id };
      connection.credentialsEncrypted = credentialsEncrypted;
      connection.lastConnectedAt = new Date();
      connection.lastErrorAt = null;
      connection.lastError = null;
      await connection.save();

      await logAction(req, {
        action: "CHANNEL_CONNECTED",
        resource: "ChannelConnection",
        resourceId: connection._id,
        companyId: chatbot.companyId,
        metadata: { provider: "telegram", botUsername: botInfo.username },
      });

      return res.status(200).json({ success: true, status: "CONNECTED", config: connection.config });
    } catch (err) {
      connection.status = "ERROR";
      connection.lastErrorAt = new Date();
      connection.lastError = err.message;
      await connection.save();

      await logAction(req, {
        action: "CHANNEL_CONNECTED",
        resource: "ChannelConnection",
        resourceId: connection._id,
        companyId: chatbot.companyId,
        metadata: { provider: "telegram", failed: true },
      });

      return res.status(400).json({ success: false, message: err.message });
    }
  } catch (error) {
    console.error("Connect Telegram Error:", error);
    return res.status(500).json({ success: false, message: "Failed to connect Telegram." });
  }
};

export const testTelegram = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;
    if (!(await requireCompanyAdmin(req, res, chatbot.companyId))) return;

    const connection = await ChannelConnection.findOne({ chatbotId: chatbot._id, provider: "telegram" });
    if (!connection || !connection.credentialsEncrypted) {
      return res.status(400).json({ success: false, message: "Telegram is not connected for this chatbot." });
    }

    try {
      const result = await telegramProvider.test({ connection });
      connection.lastTestedAt = new Date();
      connection.lastErrorAt = null;
      connection.lastError = null;
      await connection.save();

      await logAction(req, { action: "INTEGRATION_TESTED", resource: "ChannelConnection", resourceId: connection._id, companyId: chatbot.companyId, metadata: { provider: "telegram" } });

      return res.status(200).json({ success: true, result: { ok: true, botUsername: result.botInfo.username } });
    } catch (err) {
      connection.lastTestedAt = new Date();
      connection.lastErrorAt = new Date();
      connection.lastError = err.message;
      connection.status = "ERROR";
      await connection.save();

      await logAction(req, { action: "INTEGRATION_TESTED", resource: "ChannelConnection", resourceId: connection._id, companyId: chatbot.companyId, metadata: { provider: "telegram", failed: true } });

      return res.status(200).json({ success: true, result: { ok: false, error: err.message } });
    }
  } catch (error) {
    console.error("Test Telegram Error:", error);
    return res.status(500).json({ success: false, message: "Failed to test Telegram connection." });
  }
};

export const disconnectTelegram = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;
    if (!(await requireCompanyAdmin(req, res, chatbot.companyId))) return;

    const connection = await ChannelConnection.findOne({ chatbotId: chatbot._id, provider: "telegram" });
    if (!connection) {
      return res.status(404).json({ success: false, message: "No Telegram connection found." });
    }

    await telegramProvider.disconnect({ connection });

    connection.status = "DISCONNECTED";
    connection.credentialsEncrypted = null;
    connection.config = {};
    await connection.save();

    await logAction(req, { action: "CHANNEL_DISCONNECTED", resource: "ChannelConnection", resourceId: connection._id, companyId: chatbot.companyId, metadata: { provider: "telegram" } });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Disconnect Telegram Error:", error);
    return res.status(500).json({ success: false, message: "Failed to disconnect Telegram." });
  }
};
