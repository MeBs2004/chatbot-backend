import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import ChatbotAccess from "../../models/chatbotAccess.model.js";
import AdminUser from "../../models/adminUser.model.js";
import {
  getAccessibleCompanyIds,
  hasChatbotAccess,
  getCompanyRole,
} from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { mergeChatbotConfig, deepMergeConfig } from "../../config/chatbotConfig.js";
import { assertChatbotQuota, QuotaExceededError } from "../../services/billing/quota.service.js";
import { emitDomainEvent } from "../../services/realtime/io.js";
import { EVENTS } from "../../services/realtime/events.js";

export const listChatbots = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { search, status, companyId } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (search) filter.name = { $regex: search, $options: "i" };

    const accessibleIds = await getAccessibleCompanyIds(requester);

    // A user can also be granted access to a single chatbot directly
    // (ChatbotAccess) without full company access — include those too.
    const chatbotAccessIds =
      accessibleIds !== null
        ? (
            await ChatbotAccess.find({ userId: requester._id })
              .select("chatbotId")
              .lean()
          ).map((a) => a.chatbotId)
        : [];

    if (companyId) {
      if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
      filter.companyId = companyId;
    } else if (accessibleIds !== null) {
      filter.$or = [
        { companyId: { $in: accessibleIds } },
        { _id: { $in: chatbotAccessIds } },
      ];
    }

    const [chatbots, total] = await Promise.all([
      Chatbot.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Chatbot.countDocuments(filter),
    ]);

    const companyIds = [...new Set(chatbots.map((c) => c.companyId))];
    const companies = await Company.find({ companyId: { $in: companyIds } })
      .select("companyId name")
      .lean();
    const companyMap = Object.fromEntries(
      companies.map((c) => [c.companyId, c.name])
    );

    const result = chatbots.map((c) => ({
      ...c,
      companyName: companyMap[c.companyId] || c.companyId,
    }));

    return res.status(200).json({
      success: true,
      chatbots: result,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("List Chatbots Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load chatbots.",
    });
  }
};

export const getChatbotDetail = async (req, res) => {
  try {
    const requester = req.adminUser;
    const chatbot = await Chatbot.findById(req.params.id).lean();

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: "Chatbot not found.",
      });
    }

    if (!(await hasChatbotAccess(requester, chatbot._id))) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this resource.",
      });
    }

    const [company, accessRows] = await Promise.all([
      Company.findOne({ companyId: chatbot.companyId }).lean(),
      ChatbotAccess.find({ chatbotId: chatbot._id }).lean(),
    ]);

    const userIds = accessRows.map((a) => a.userId);
    const users = await AdminUser.find({ _id: { $in: userIds } })
      .select("name email role")
      .lean();
    const usersById = Object.fromEntries(
      users.map((u) => [String(u._id), u])
    );

    const access = accessRows.map((a) => ({
      ...a,
      user: usersById[String(a.userId)] || null,
    }));

    return res.status(200).json({
      success: true,
      chatbot: { ...chatbot, config: mergeChatbotConfig(chatbot.config) },
      company,
      access,
    });
  } catch (error) {
    console.error("Get Chatbot Detail Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load chatbot.",
    });
  }
};

export const createChatbot = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { companyId, name, model, settings } = req.body;

    if (!companyId || !name) {
      return res.status(400).json({
        success: false,
        message: "companyId and name are required.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const company = await Company.findOne({ companyId });
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    try {
      await assertChatbotQuota(companyId);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return res.status(402).json({ success: false, message: err.message, code: "QUOTA_EXCEEDED", limitKey: err.limitKey });
      }
      throw err;
    }

    // Optional per-chatbot settings captured at creation (onboarding
    // wizard). Stored on the existing Mixed `settings` field — no
    // schema change. Not yet read by the live chat pipeline (that
    // still reads Company.ai) — see ADMIN_ARCHITECTURE.md, this
    // becomes active in the Chatbot Customization Studio phase.
    let safeSettings;
    if (settings && typeof settings === "object") {
      if (
        settings.temperature !== undefined &&
        (typeof settings.temperature !== "number" ||
          settings.temperature < 0 ||
          settings.temperature > 1)
      ) {
        return res.status(400).json({
          success: false,
          message: "temperature must be a number between 0 and 1.",
        });
      }

      safeSettings = {
        ...(settings.temperature !== undefined && { temperature: settings.temperature }),
        ...(settings.language && { language: String(settings.language).slice(0, 40) }),
        ...(settings.systemPrompt && {
          systemPrompt: String(settings.systemPrompt).slice(0, 4000),
        }),
      };
    }

    const chatbot = await Chatbot.create({
      companyId,
      name,
      model: model || undefined,
      settings: safeSettings,
      createdBy: requester._id,
    });

    await logAction(req, {
      action: "CREATE_CHATBOT",
      resource: "Chatbot",
      resourceId: chatbot._id,
      companyId,
    });

    emitDomainEvent(EVENTS.CHATBOT_CREATED, {
      companyId,
      chatbotId: chatbot._id,
      payload: { name: chatbot.name, status: chatbot.status },
    });

    return res.status(201).json({ success: true, chatbot });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A chatbot with this name already exists for this company.",
      });
    }

    console.error("Create Chatbot Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create chatbot.",
    });
  }
};

export const updateChatbot = async (req, res) => {
  try {
    const requester = req.adminUser;
    const chatbot = await Chatbot.findById(req.params.id);

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: "Chatbot not found.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, chatbot.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const allowed = ["name", "status", "model", "settings", "widgetEngineVersion"];
    const changedFields = allowed.filter((f) => req.body[f] !== undefined);
    changedFields.forEach((f) => {
      chatbot[f] = req.body[f];
    });

    await chatbot.save();

    await logAction(req, {
      action: "UPDATE_CHATBOT",
      resource: "Chatbot",
      resourceId: chatbot._id,
      companyId: chatbot.companyId,
    });

    emitDomainEvent(EVENTS.CHATBOT_UPDATED, {
      companyId: chatbot.companyId,
      chatbotId: chatbot._id,
      payload: { changedFields, status: chatbot.status },
    });

    return res.status(200).json({ success: true, chatbot });
  } catch (error) {
    console.error("Update Chatbot Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update chatbot.",
    });
  }
};

// =========================================================
// CHATBOT CUSTOMIZATION STUDIO CONFIG (Phase 4)
// Read by the live public widget via GET /api/widget/config/:chatbotId
// and GET /bot/v1/company's widgetConfig field (Public Widget Config
// Integration phase) — both reuse mergeChatbotConfig, same as here.
// =========================================================

export const updateChatbotConfig = async (req, res) => {
  try {
    const requester = req.adminUser;
    const chatbot = await Chatbot.findById(req.params.id);

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: "Chatbot not found.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, chatbot.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const incoming = req.body.config;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({
        success: false,
        message: "config is required and must be an object.",
      });
    }

    // Layer: schema defaults <- what's already saved <- this PATCH's
    // partial payload. Each layer only overrides leaf values it
    // actually provides, so { launcher: { color } } never wipes out
    // sibling fields like launcher.position. Mongoose then validates
    // every leaf (enums, hex colors, string lengths) on save, and
    // silently strips any key not defined in the schema — that's
    // the whitelist, arbitrary fields can never be persisted.
    const existing = mergeChatbotConfig(chatbot.config?.toObject?.() ?? chatbot.config);
    chatbot.config = deepMergeConfig(existing, incoming);

    try {
      await chatbot.save();
    } catch (validationError) {
      if (validationError.name === "ValidationError") {
        const firstMessage = Object.values(validationError.errors)[0]?.message;
        return res.status(400).json({
          success: false,
          message: firstMessage || "Invalid configuration.",
        });
      }
      throw validationError;
    }

    await logAction(req, {
      action: "UPDATE_CHATBOT_CONFIG",
      resource: "Chatbot",
      resourceId: chatbot._id,
      companyId: chatbot.companyId,
    });

    // Admin room: just a "refetch" signal, not the full config (Section
    // 10 — other open admin tabs already have their own REST client and
    // should pull the authoritative doc, not trust a socket payload as
    // the source of truth). Public widget room: the actual normalized,
    // already-whitelisted config — same shape/function as the public
    // REST endpoints, gated the same way (never pushed for a
    // PAUSED/OFFLINE chatbot, matching getPublicWidgetConfig's rule).
    emitDomainEvent(EVENTS.CHATBOT_CONFIG_UPDATED, {
      companyId: chatbot.companyId,
      chatbotId: chatbot._id,
      payload: { changedFields: Object.keys(incoming) },
      publicPayload:
        chatbot.status === "PAUSED" || chatbot.status === "OFFLINE"
          ? { available: false, reason: chatbot.status === "OFFLINE" ? "offline" : "paused" }
          : { available: true, config: mergeChatbotConfig(chatbot.config) },
    });

    return res.status(200).json({
      success: true,
      chatbotId: chatbot._id,
      config: chatbot.config,
    });
  } catch (error) {
    console.error("Update Chatbot Config Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update chatbot configuration.",
    });
  }
};

export const assignChatbotAccess = async (req, res) => {
  try {
    const requester = req.adminUser;
    const chatbot = await Chatbot.findById(req.params.id);

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: "Chatbot not found.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, chatbot.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const { userId, permissions = [] } = req.body;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required." });
    }

    const access = await ChatbotAccess.findOneAndUpdate(
      { userId, chatbotId: chatbot._id },
      { permissions },
      { upsert: true, new: true }
    );

    await logAction(req, {
      action: "ASSIGN_CHATBOT_ACCESS",
      resource: "Chatbot",
      resourceId: chatbot._id,
      companyId: chatbot.companyId,
      metadata: { userId },
    });

    return res.status(200).json({ success: true, access });
  } catch (error) {
    console.error("Assign Chatbot Access Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to assign access.",
    });
  }
};

export const removeChatbotAccessForUser = async (req, res) => {
  try {
    const requester = req.adminUser;
    const chatbot = await Chatbot.findById(req.params.id).lean();

    if (!chatbot) {
      return res.status(404).json({
        success: false,
        message: "Chatbot not found.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, chatbot.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    await ChatbotAccess.findOneAndDelete({
      chatbotId: req.params.id,
      userId: req.params.userId,
    });

    await logAction(req, {
      action: "REMOVE_CHATBOT_ACCESS",
      resource: "Chatbot",
      resourceId: req.params.id,
      metadata: { userId: req.params.userId },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Remove Chatbot Access Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove access.",
    });
  }
};
