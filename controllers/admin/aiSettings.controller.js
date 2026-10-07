import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { getCompanyRole, hasChatbotAccess } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { validateAiConfigPatch } from "../../validators/aiConfig.validator.js";
import { askAI } from "../../services/ai.router.js";
import { emitDomainEvent } from "../../services/realtime/io.js";
import { EVENTS } from "../../services/realtime/events.js";
import {
  SUPPORTED_MODELS,
  SUPPORTED_LANGUAGES,
  RESPONSE_LENGTH_OPTIONS,
  TONE_OPTIONS,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
  MAX_TOKENS_MIN,
  MAX_TOKENS_MAX,
} from "../../config/aiConfig.js";

/**
 * Same tenant-derivation chain as Phase 6's flow controller: the
 * chatbot doc is the only thing ever trusted from the URL, its
 * companyId (never a client-supplied companyId) resolves the real
 * Company record, and access is re-checked from the authenticated
 * session on every call.
 */
async function loadAuthorizedChatbotAndCompany(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot || chatbot.deletedAt) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }

  const requester = req.adminUser;
  if (!(await hasChatbotAccess(requester, chatbot._id))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }

  const company = await Company.findOne({ companyId: chatbot.companyId });
  if (!company) {
    res.status(404).json({ success: false, message: "Company not found." });
    return null;
  }

  return { chatbot, company };
}

export const getAiSettings = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    const siblingChatbotCount = await Chatbot.countDocuments({
      companyId: ctx.company.companyId,
      deletedAt: null,
      _id: { $ne: ctx.chatbot._id },
    });

    return res.status(200).json({
      success: true,
      ai: ctx.company.ai,
      chatbotId: ctx.chatbot._id,
      companyId: ctx.company.companyId,
      companyName: ctx.company.name,
      siblingChatbotCount,
      options: {
        models: SUPPORTED_MODELS,
        languages: SUPPORTED_LANGUAGES,
        responseLengths: RESPONSE_LENGTH_OPTIONS,
        tones: TONE_OPTIONS,
        temperatureRange: [TEMPERATURE_MIN, TEMPERATURE_MAX],
        maxTokensRange: [MAX_TOKENS_MIN, MAX_TOKENS_MAX],
      },
    });
  } catch (error) {
    console.error("Get AI Settings Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load AI settings." });
  }
};

export const updateAiSettings = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    const requester = req.adminUser;
    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, ctx.company.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
    }

    const patch = req.body?.ai;
    if (!patch || typeof patch !== "object") {
      return res.status(400).json({ success: false, message: "ai is required." });
    }

    const { valid, errors } = validateAiConfigPatch(patch);
    if (!valid) {
      return res.status(400).json({ success: false, message: errors[0]?.message || "Invalid AI configuration.", errors });
    }

    // Merge at the leaf level via dot-paths (Mongoose's documented
    // way to update part of a nested subdocument) so saving just
    // `temperature` never blanks out model/systemPrompt/etc., and a
    // partial `responseStyle` never wipes its untouched siblings.
    // Provider stays fixed: only Groq is a real, wired provider today
    // (see ai.router.js), so it is never accepted from this endpoint.
    const company = await Company.findOne({ companyId: ctx.company.companyId });
    const TOP_LEVEL_AI_FIELDS = ["model", "temperature", "maxTokens", "systemPrompt", "language", "fallbackMessage"];
    TOP_LEVEL_AI_FIELDS.forEach((field) => {
      if (patch[field] !== undefined) company.set(`ai.${field}`, patch[field]);
    });
    if (patch.responseStyle && typeof patch.responseStyle === "object") {
      ["length", "tone", "customTone", "useEmojis", "useMarkdown"].forEach((field) => {
        if (patch.responseStyle[field] !== undefined) company.set(`ai.responseStyle.${field}`, patch.responseStyle[field]);
      });
    }
    await company.save();

    await logAction(req, {
      action: "AI_SETTINGS_UPDATED",
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
      metadata: { chatbotId: ctx.chatbot._id, fields: Object.keys(patch) },
    });

    // Company-room, not chatbot-room — AI config is shared across
    // every chatbot in this company (see Company.ai), so every admin
    // with ANY of this company's chatbots open needs to know their
    // view is now stale, not just the one chatbotId in this request.
    emitDomainEvent(EVENTS.AI_SETTINGS_UPDATED, {
      companyId: company.companyId,
      payload: { changedFields: Object.keys(patch), triggeredByChatbotId: ctx.chatbot._id },
    });

    return res.status(200).json({ success: true, ai: company.ai });
  } catch (error) {
    console.error("Update AI Settings Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update AI settings." });
  }
};

// Narrow, targeted rate limit — not a general new subsystem, just
// enough to stop the Playground from firing unlimited provider
// requests (Section 41). Keyed by admin user, not IP, so shared
// office IPs don't get penalized together.
export const aiTestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.adminUser?._id?.toString() || ipKeyGenerator(req.ip),
  message: { success: false, message: "Too many AI test requests. Please wait a few minutes." },
});

export const testAi = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    const { message, language } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ success: false, message: "message is required." });
    }

    const reply = await askAI({
      company: ctx.company,
      message: message.slice(0, 2000),
      language: language || ctx.company.ai?.language || "English",
      chatbotId: ctx.chatbot._id,
    });

    await logAction(req, {
      action: "AI_TESTED",
      resource: "Company",
      resourceId: ctx.company.companyId,
      companyId: ctx.company.companyId,
      metadata: { chatbotId: ctx.chatbot._id, messageLength: message.length },
    });

    return res.status(200).json({ success: true, reply });
  } catch (error) {
    console.error("Test AI Error:", error);
    return res.status(500).json({ success: false, message: "AI test failed." });
  }
};
