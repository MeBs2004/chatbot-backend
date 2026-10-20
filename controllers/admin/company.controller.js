import axios from "axios";
import crypto from "crypto";

import Company from "../../models/company.model.js";
import Chatbot from "../../models/chatbot.model.js";
import Visitor from "../../models/visitor.model.js";
import Conversation from "../../models/conversation.model.js";
import Bot from "../../models/bot.model.js";
import User from "../../models/user.model.js";
import ChatbotFlow from "../../models/chatbotFlow.model.js";
import ChatbotAccess from "../../models/chatbotAccess.model.js";
import ChannelConnection from "../../models/channelConnection.model.js";
import FlowSession from "../../models/flowSession.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ApiKey from "../../models/apiKey.model.js";
import ApiUsage from "../../models/apiUsage.model.js";
import DeveloperWebhook from "../../models/developerWebhook.model.js";
import BillingAccount from "../../models/billingAccount.model.js";
import Invoice from "../../models/invoice.model.js";
import AIUsage from "../../models/aiUsage.model.js";
import Role from "../../models/role.model.js";
import Task from "../../models/task.model.js";
import Invitation from "../../models/invitation.model.js";
import {
  getAccessibleCompanyIds,
  hasCompanyAccess,
  getCompanyRole,
} from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import {
  readKnowledgeFile,
  writeKnowledgeFile,
  isValidKnowledgeFilename,
  KnowledgeConflictError,
} from "../../services/knowledge.service.js";
import { validateAiConfigPatch } from "../../validators/aiConfig.validator.js";
import { encryptSecret, decryptSecret } from "../../utils/encryption.js";
import { assertSafeWebhookUrl, WEBHOOK_MAX_RESPONSE_BYTES } from "../../services/flow/flow.security.js";
import { emitDomainEvent } from "../../services/realtime/io.js";
import { EVENTS } from "../../services/realtime/events.js";
import { invalidateKnowledgeCache } from "../../services/groq.service.js";
import { INDUSTRIES, COMPANY_SIZES } from "../../config/industries.js";
import { invalidSlugReason } from "../../utils/companySlug.js";

// Phase 10: `webhook.secretEncrypted` must never leave this server —
// every response that includes `company.webhook` goes through this
// first. `hasSecret` tells the frontend whether one is configured
// without ever exposing it (masked-field pattern, Section 29).
function redactCompany(company) {
  if (!company?.webhook) return company;
  const { secretEncrypted, ...webhookRest } = company.webhook;
  return { ...company, webhook: { ...webhookRest, hasSecret: Boolean(secretEncrypted) } };
}

export const listCompanies = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { search, status, industry, dateFrom, dateTo, sort } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (industry) filter.industry = industry;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { companyId: { $regex: search, $options: "i" } },
        { domain: { $regex: search, $options: "i" } },
        { "contact.email": { $regex: search, $options: "i" } },
      ];
    }
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        // Inclusive of the whole end day, not just 00:00:00 on it.
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const accessibleIds = await getAccessibleCompanyIds(requester);
    if (accessibleIds !== null) {
      filter.companyId = { $in: accessibleIds };
    }

    const SORT_OPTIONS = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name: { name: 1 },
    };
    const sortBy = SORT_OPTIONS[sort] || SORT_OPTIONS.newest;

    const [companies, total] = await Promise.all([
      Company.find(filter)
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("createdBy", "name email")
        .lean(),
      Company.countDocuments(filter),
    ]);

    const companyIds = companies.map((c) => c.companyId);

    const [chatbotCounts, visitorCounts] = await Promise.all([
      Chatbot.aggregate([
        { $match: { companyId: { $in: companyIds } } },
        { $group: { _id: "$companyId", count: { $sum: 1 } } },
      ]),
      Visitor.aggregate([
        { $match: { companyId: { $in: companyIds } } },
        { $group: { _id: "$companyId", count: { $sum: 1 } } },
      ]),
    ]);

    const chatbotMap = Object.fromEntries(
      chatbotCounts.map((c) => [c._id, c.count])
    );
    const visitorMap = Object.fromEntries(
      visitorCounts.map((c) => [c._id, c.count])
    );

    const result = companies.map((c) => {
      const { createdBy, ...rest } = c;
      return {
        ...redactCompany(rest),
        registeredBy: createdBy ? { name: createdBy.name, email: createdBy.email } : null,
        chatbotCount: chatbotMap[c.companyId] || 0,
        visitorCount: visitorMap[c.companyId] || 0,
      };
    });

    return res.status(200).json({
      success: true,
      companies: result,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("List Companies Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load companies.",
    });
  }
};

export const getCompanyDetail = async (req, res) => {
  try {
    const requester = req.adminUser;
    const company = await Company.findOne({
      companyId: req.params.id,
    })
      .populate("createdBy", "name email")
      .lean();

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    if (!(await hasCompanyAccess(requester, company.companyId))) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this resource.",
      });
    }

    const [chatbots, visitorCount] = await Promise.all([
      Chatbot.find({ companyId: company.companyId, deletedAt: null }).lean(),
      Visitor.countDocuments({ companyId: company.companyId }),
    ]);

    const { createdBy, ...companyRest } = company;

    return res.status(200).json({
      success: true,
      company: { ...redactCompany(companyRest), registeredBy: createdBy ? { name: createdBy.name, email: createdBy.email } : null },
      chatbots,
      stats: { visitorCount },
    });
  } catch (error) {
    console.error("Get Company Detail Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load company.",
    });
  }
};

export const createCompany = async (req, res) => {
  try {
    const { name, domain, website, knowledgeFile } = req.body;

    // Strings only — an object here (e.g. {"$gt": ""}) would otherwise
    // reach the Mongo lookups below as a query operator.
    if ([req.body.companyId, name, domain, website, knowledgeFile].some((v) => v !== undefined && typeof v !== "string")) {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }

    const companyId = (req.body.companyId || "").trim().toLowerCase();

    if (!companyId || !name?.trim() || !domain?.trim() || !knowledgeFile) {
      return res.status(400).json({
        success: false,
        message: "companyId, name, domain and knowledgeFile are required.",
      });
    }

    // Same rules as public sign-up: the companyId is the tenant key
    // every widget sends in x-company-id, so it must be a clean slug.
    const slugError = invalidSlugReason(companyId);
    if (slugError) {
      return res.status(400).json({ success: false, message: slugError.replace(/workspace URL/i, "Company ID") });
    }

    if (!isValidKnowledgeFilename(knowledgeFile)) {
      return res.status(400).json({
        success: false,
        message:
          "knowledgeFile must be a plain filename ending in .txt (no paths).",
      });
    }

    const existing = await Company.findOne({ companyId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A company with this ID already exists.",
      });
    }

    const company = await Company.create({
      companyId,
      name: name.trim(),
      domain: domain.trim(),
      website: (website || domain).trim(),
      knowledgeFile,
      createdBy: req.adminUser._id,
    });

    await logAction(req, {
      action: "CREATE_COMPANY",
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
    });

    return res.status(201).json({ success: true, company });
  } catch (error) {
    // Two concurrent creates with the same companyId.
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "A company with this ID already exists." });
    }
    console.error("Create Company Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create company.",
    });
  }
};

export const updateCompany = async (req, res) => {
  try {
    const requester = req.adminUser;
    const company = await Company.findOne({ companyId: req.params.id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, company.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const allowedFields = [
      "name",
      "website",
      "branding",
      "theme",
      "chatbot",
      "contact",
      "ai",
      "companySize",
      // "webhook" is deliberately NOT in this generic whitelist —
      // it needs SSRF validation and secret encryption before it can
      // be assigned, handled explicitly below.
      // "industry" is deliberately NOT in this generic whitelist —
      // it has a strict enum and gets an explicit 400 below instead
      // of a would-be Mongoose ValidationError surfacing as a bare 500.
    ];

    if (req.body.industry !== undefined && !INDUSTRIES.includes(req.body.industry)) {
      return res.status(400).json({ success: false, message: "Invalid industry." });
    }
    if (req.body.companySize !== undefined && req.body.companySize !== "" && !COMPANY_SIZES.includes(req.body.companySize)) {
      return res.status(400).json({ success: false, message: "Invalid company size." });
    }
    if (req.body.industry !== undefined) company.industry = req.body.industry;

    // Billing plan is SUPER_ADMIN-only, same trust level as status —
    // a COMPANY_ADMIN must not be able to self-upgrade their plan.
    if (requester.role === "SUPER_ADMIN" && req.body.plan !== undefined) {
      company.plan = req.body.plan;
    }

    // Phase 7: `ai` used to be a blind whitelist-of-field-name patch
    // with no value validation at all — model/temperature/maxTokens
    // could be set to anything. Same validator the new chatbot-scoped
    // AI Settings endpoint uses (validators/aiConfig.validator.js),
    // so both doors onto Company.ai enforce identical constraints.
    if (req.body.ai !== undefined) {
      const { valid, errors } = validateAiConfigPatch(req.body.ai);
      if (!valid) {
        return res.status(400).json({ success: false, message: errors[0]?.message || "Invalid AI configuration.", errors });
      }
    }

    // Phase 10: real validation + secret handling for the one
    // existing outbound-webhook integration. `secret` never touches
    // the document as-is — only its encrypted form does, and only
    // when the caller actually sent a new one (omitting it keeps
    // whatever was already stored; sending "" clears it).
    if (req.body.webhook !== undefined) {
      const { enabled, url, secret } = req.body.webhook;

      if (enabled && url) {
        try {
          await assertSafeWebhookUrl(url);
        } catch (err) {
          return res.status(400).json({ success: false, message: `Webhook URL rejected: ${err.message}` });
        }
      }

      company.webhook = {
        enabled: enabled ?? company.webhook?.enabled ?? false,
        url: url !== undefined ? url : company.webhook?.url || "",
        secretEncrypted:
          secret !== undefined
            ? encryptSecret(secret) // "" -> encryptSecret returns null -> clears it
            : company.webhook?.secretEncrypted ?? null,
      };
    }

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) company[field] = req.body[field];
    });

    await company.save();

    await logAction(req, {
      action: "UPDATE_COMPANY",
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
    });

    return res.status(200).json({ success: true, company: redactCompany(company.toObject()) });
  } catch (error) {
    console.error("Update Company Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update company.",
    });
  }
};

export const setCompanyStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE", "SUSPENDED", "TRIAL"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status." });
    }

    const company = await Company.findOne({ companyId: req.params.id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    company.status = status;
    // isActive remains the flag the public tenant middleware checks.
    company.isActive = status === "ACTIVE" || status === "TRIAL";
    await company.save();

    await logAction(req, {
      action: `SET_COMPANY_STATUS_${status}`,
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
    });

    return res.status(200).json({ success: true, company });
  } catch (error) {
    console.error("Set Company Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update company status.",
    });
  }
};

// =========================================================
// DELETE COMPANY (SUPER_ADMIN only)
// Permanent. Removes the company and everything scoped to its
// companyId — chatbots, flows, visitors, conversations, API keys,
// webhooks, billing records, roles, tasks and access grants.
// Deliberately kept: AuditLog rows (incl. the DELETE_COMPANY entry
// written here) and the admin user accounts themselves — a user who
// belonged to this company just loses that access.
// The caller must echo the company's exact name in `confirmName`, so a
// stray/scripted DELETE can't wipe a tenant by accident.
// =========================================================
export const deleteCompany = async (req, res) => {
  try {
    const company = await Company.findOne({ companyId: req.params.id });

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found." });
    }

    if ((req.body?.confirmName || "").trim() !== company.name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Confirmation name does not match the company name.",
      });
    }

    const { companyId } = company;

    const chatbots = await Chatbot.find({ companyId }).select("_id").lean();
    const chatbotIds = chatbots.map((c) => c._id);
    const byCompany = { companyId };

    // Write the audit entry first, so a partial failure below still
    // leaves a record of who attempted the deletion.
    await logAction(req, {
      action: "DELETE_COMPANY",
      resource: "Company",
      resourceId: companyId,
      companyId,
      metadata: { name: company.name, chatbots: chatbotIds.length },
    });

    const affectedInvites = await Invitation.find({ "companyAccess.companyId": companyId }).select("_id").lean();
    const affectedInviteIds = affectedInvites.map((i) => i._id);

    const results = await Promise.all([
      Conversation.deleteMany(byCompany),
      Visitor.deleteMany(byCompany),
      Bot.deleteMany(byCompany),
      User.deleteMany(byCompany),
      FlowSession.deleteMany(byCompany),
      ChatbotFlow.deleteMany(byCompany),
      ChatbotAccess.deleteMany({ $or: [byCompany, { chatbotId: { $in: chatbotIds } }] }),
      ChannelConnection.deleteMany(byCompany),
      UserCompanyAccess.deleteMany(byCompany),
      ApiKey.deleteMany(byCompany),
      ApiUsage.deleteMany(byCompany),
      DeveloperWebhook.deleteMany(byCompany),
      BillingAccount.deleteMany(byCompany),
      Invoice.deleteMany(byCompany),
      AIUsage.deleteMany(byCompany),
      Role.deleteMany(byCompany),
      Task.deleteMany(byCompany),
      Chatbot.deleteMany(byCompany),
      // Pending invitations: drop this company from their grants and
      // delete any invitation that is left with nothing to grant.
      Invitation.updateMany({ "companyAccess.companyId": companyId }, { $pull: { companyAccess: { companyId } } }),
    ]);

    // Only invitations THIS deletion emptied — never ones that were
    // already company-less by design.
    await Invitation.deleteMany({ _id: { $in: affectedInviteIds }, companyAccess: { $size: 0 } });
    await Company.deleteOne({ companyId });

    invalidateKnowledgeCache(companyId);

    return res.status(200).json({
      success: true,
      message: "Company deleted.",
      removed: { chatbots: results[17].deletedCount, conversations: results[0].deletedCount, visitors: results[1].deletedCount },
    });
  } catch (error) {
    console.error("Delete Company Error:", error);

    return res.status(500).json({ success: false, message: "Failed to delete company." });
  }
};

// =========================================================
// KNOWLEDGE BASE
// The real, existing system: one flat text file per company
// (Company.knowledgeFile), read directly by services/groq.service.js.
// This is not a multi-file pipeline — that infrastructure doesn't
// exist, so we don't pretend it does.
// =========================================================

export const getCompanyKnowledge = async (req, res) => {
  try {
    const requester = req.adminUser;
    const company = await Company.findOne({ companyId: req.params.id }).lean();

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found." });
    }

    if (!(await hasCompanyAccess(requester, company.companyId))) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this resource.",
      });
    }

    const result = await readKnowledgeFile(company.companyId);

    return res.status(200).json({
      success: true,
      knowledgeFile: company.knowledgeFile,
      content: result.content,
      sizeBytes: result.sizeBytes,
      updatedAt: result.updatedAt,
      ...(result.error && { error: result.error }),
    });
  } catch (error) {
    console.error("Get Company Knowledge Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load knowledge base.",
    });
  }
};

export const updateCompanyKnowledge = async (req, res) => {
  try {
    const requester = req.adminUser;
    const company = await Company.findOne({ companyId: req.params.id });

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found." });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, company.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const { content, expectedUpdatedAt } = req.body;

    if (typeof content !== "string") {
      return res.status(400).json({
        success: false,
        message: "content is required.",
      });
    }

    let result;
    try {
      result = await writeKnowledgeFile(company.companyId, content, { expectedUpdatedAt });
    } catch (writeErr) {
      if (writeErr instanceof KnowledgeConflictError) {
        return res.status(409).json({ success: false, message: writeErr.message });
      }
      return res.status(400).json({ success: false, message: writeErr.message });
    }

    await logAction(req, {
      action: "KNOWLEDGE_UPDATED",
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
      metadata: { knowledgeFile: company.knowledgeFile, bytes: result.sizeBytes },
    });

    // Parity with the chatbot-scoped knowledge endpoint
    // (knowledgeAdmin.controller.js) — this is the SAME underlying
    // Company.knowledgeContent, just edited from the Company page
    // instead of a specific chatbot's page, so any open Knowledge
    // Base tab (chatbot-scoped or this one) needs the same notice.
    emitDomainEvent(EVENTS.KNOWLEDGE_UPDATED, {
      companyId: company.companyId,
      payload: { updatedAt: result.updatedAt },
    });

    return res.status(200).json({ success: true, message: "Knowledge base updated.", updatedAt: result.updatedAt });
  } catch (error) {
    console.error("Update Company Knowledge Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update knowledge base.",
    });
  }
};

// Manual escape hatch — see the identical endpoint/comment in
// knowledgeAdmin.controller.js (clearChatbotKnowledgeCache). A normal
// Save through this page is already instant; this is for knowledge
// edited directly in MongoDB rather than through either Knowledge
// Base page.
export const clearCompanyKnowledgeCache = async (req, res) => {
  try {
    const requester = req.adminUser;
    const company = await Company.findOne({ companyId: req.params.id }).lean();

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found." });
    }

    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, company.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
    }

    invalidateKnowledgeCache(company.companyId);

    await logAction(req, {
      action: "KNOWLEDGE_CACHE_CLEARED",
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
    });

    return res.status(200).json({ success: true, message: "Knowledge cache cleared — the next message will reload from MongoDB." });
  } catch (error) {
    console.error("Clear Company Knowledge Cache Error:", error);
    return res.status(500).json({ success: false, message: "Failed to clear knowledge cache." });
  }
};

// =========================================================
// WEBHOOK INTEGRATION
// Reuses Company.webhook (already existed). The Test button
// makes a real HTTP request — no simulated success.
// =========================================================

export const testCompanyWebhook = async (req, res) => {
  try {
    const requester = req.adminUser;
    const company = await Company.findOne({ companyId: req.params.id });

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found." });
    }

    if (!(await hasCompanyAccess(requester, company.companyId))) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this resource.",
      });
    }

    if (!company.webhook?.url) {
      return res.status(400).json({
        success: false,
        message: "No webhook URL configured for this company.",
      });
    }

    // Phase 10: SSRF-hardened (was previously a raw axios.post with
    // no destination validation at all — an admin could point a
    // "test" at an internal service). Reuses the same check the Bot
    // Builder's webhook node already uses.
    try {
      await assertSafeWebhookUrl(company.webhook.url);
    } catch (err) {
      return res.status(400).json({ success: false, message: `Webhook URL rejected: ${err.message}` });
    }

    const startedAt = Date.now();
    const envelope = {
      event: "integration.test",
      timestamp: new Date().toISOString(),
      companyId: company.companyId,
      data: { message: "This is a test event from Nuformly Control Center." },
    };

    let secret = null;
    try {
      secret = company.webhook.secretEncrypted ? decryptSecret(company.webhook.secretEncrypted) : null;
    } catch (err) {
      console.error("Webhook secret decryption failed:", err.message);
    }

    const body = JSON.stringify(envelope);
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["X-Nuformly-Signature"] = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

    try {
      const response = await axios.post(company.webhook.url, envelope, {
        headers,
        timeout: 8000,
        maxContentLength: WEBHOOK_MAX_RESPONSE_BYTES,
        maxBodyLength: WEBHOOK_MAX_RESPONSE_BYTES,
        maxRedirects: 0,
      });

      company.webhook.lastTestedAt = new Date();
      company.webhook.lastConnectedAt = new Date();
      company.webhook.lastErrorAt = null;
      company.webhook.lastError = null;
      await company.save();

      await logAction(req, {
        action: "INTEGRATION_TESTED",
        resource: "Company",
        resourceId: company.companyId,
        companyId: company.companyId,
        metadata: { integration: "webhook", status: response.status },
      });

      return res.status(200).json({
        success: true,
        result: { ok: true, statusCode: response.status, latencyMs: Date.now() - startedAt, testedAt: company.webhook.lastTestedAt },
      });
    } catch (err) {
      const safeError = err.code === "ECONNABORTED" ? "Request timed out." : err.response ? `Provider responded with ${err.response.status}.` : "Could not reach the webhook URL.";

      company.webhook.lastTestedAt = new Date();
      company.webhook.lastErrorAt = new Date();
      company.webhook.lastError = safeError;
      await company.save();

      await logAction(req, {
        action: "INTEGRATION_TESTED",
        resource: "Company",
        resourceId: company.companyId,
        companyId: company.companyId,
        metadata: { integration: "webhook", status: err.response?.status || null, failed: true },
      });

      return res.status(200).json({
        success: true,
        result: { ok: false, statusCode: err.response?.status || null, error: safeError, latencyMs: Date.now() - startedAt, testedAt: company.webhook.lastTestedAt },
      });
    }
  } catch (error) {
    console.error("Test Company Webhook Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to test webhook.",
    });
  }
};
