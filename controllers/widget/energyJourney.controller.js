import EnergyFuelCategory from "../../models/energy/fuelCategory.model.js";
import EnergyProductService from "../../models/energy/productService.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import EnergyQuestion from "../../models/energy/question.model.js";
import EnergyEquipment from "../../models/energy/equipment.model.js";
import ChatbotEnergyConfig from "../../models/energy/chatbotEnergyConfig.model.js";
import SolutionTemplate from "../../models/energy/solutionTemplate.model.js";
import EnergySupplier from "../../models/energy/supplier.model.js";
import Company from "../../models/company.model.js";
import Bot from "../../models/bot.model.js";
import { resolvePublicEnergyChatbot } from "../../services/energy/energyWidgetAccess.service.js";
import { runSolutionTemplate } from "../../services/energy/solutionEngine.service.js";
import { askEnergyAssistant } from "../../services/energy/energyAssistant.service.js";
import { getOrCreateConversation, touchConversationAfterAiReply } from "../../services/conversation.service.js";
import { dispatchWebhookEvent } from "../../services/webhookDispatch.service.js";
import { dispatchDeveloperWebhooks } from "../../services/developerWebhookDispatch.service.js";
import { trackEnergyEvent } from "../../services/energy/energyAnalyticsTracking.service.js";
import { ENERGY_ANALYTICS_EVENTS } from "../../models/energy/analyticsEvent.model.js";

// ======================================================
// PHASE 5 — the public, visitor-facing read side of Phases 1–3's
// configuration (fuels/offerings/questions) plus the one write action
// that matters (running the approved solution engine). Nothing here
// is a new system: every query filters by the SAME
// `ChatbotEnergyConfig.status === "PUBLISHED"` gate and the SAME
// `sharedOrOwn(companyId)` scoping Phases 1–3 already established —
// this just exposes it to an unauthenticated visitor instead of an
// authenticated admin, and additionally refuses anything not
// APPROVED + active for the one write action (Section 3/Stage F: a
// visitor can never choose or invoke an arbitrary template).
// ======================================================

const sharedOrOwn = (companyId) => ({ $or: [{ companyId: null }, { companyId }] });

async function loadPublishedConfig(chatbotId) {
  const config = await ChatbotEnergyConfig.findOne({ chatbotId }).lean();
  if (!config || config.status !== "PUBLISHED") return null;
  return config;
}

/** GET /:chatbotId/journey/config — enabled fuels for the PUBLISHED config only. */
export const getJourneyConfig = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const config = await loadPublishedConfig(chatbot._id);
    if (!config || config.enabledFuelKeys.length === 0) {
      return res.status(200).json({ success: true, published: false, fuels: [] });
    }

    const fuels = await EnergyFuelCategory.find({ ...sharedOrOwn(chatbot.companyId), active: true, key: { $in: config.enabledFuelKeys } }).select("key label icon group").sort({ group: 1, label: 1 }).lean();
    return res.status(200).json({ success: true, published: true, fuels });
  } catch (error) {
    console.error("Get Journey Config Error:", error);
    return res.status(500).json({ success: false, message: "Unable to load this chatbot's Energy options right now." });
  }
};

/** GET /:chatbotId/journey/offerings?fuelKey= — products/services + project types enabled for THIS fuel in the PUBLISHED config, each project type flagged with whether an approved template exists for it. */
export const getJourneyOfferings = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });
    const fuelKey = String(req.query.fuelKey || "").toLowerCase();
    if (!fuelKey) return res.status(400).json({ success: false, message: "fuelKey is required." });

    const config = await loadPublishedConfig(chatbot._id);
    if (!config || !config.enabledFuelKeys.includes(fuelKey)) {
      return res.status(200).json({ success: true, productServices: [], projectTypes: [] });
    }

    // Phase 6 — fire-and-forget; visitorId/sessionId are optional query
    // params so older cached widget bundles keep working unchanged.
    const { visitorId, sessionId } = req.query;
    if (visitorId && sessionId) trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName: "energy_fuel_selected", fuelKey });

    const [productServices, projectTypes] = await Promise.all([
      EnergyProductService.find({ ...sharedOrOwn(chatbot.companyId), fuelKey, active: true, _id: { $in: config.enabledProductServiceIds } }).select("label description").lean(),
      EnergyProjectType.find({ ...sharedOrOwn(chatbot.companyId), fuelKey, active: true, _id: { $in: config.enabledProjectTypeIds } }).select("label description").lean(),
    ]);

    const approvedByProjectType = await SolutionTemplate.find({ companyId: chatbot.companyId, fuelKey, status: "approved", active: true, projectTypeId: { $in: projectTypes.map((p) => p._id) } }).select("projectTypeId").lean();
    const approvedIds = new Set(approvedByProjectType.map((t) => String(t.projectTypeId)));

    return res.status(200).json({
      success: true,
      productServices,
      projectTypes: projectTypes.map((p) => ({ ...p, hasApprovedTemplate: approvedIds.has(String(p._id)) })),
    });
  } catch (error) {
    console.error("Get Journey Offerings Error:", error);
    return res.status(500).json({ success: false, message: "Unable to load options for this fuel right now." });
  }
};

/** Resolves the one deterministic approved+active template for a fuel+project type — never client-chosen. */
async function findApprovedTemplate(companyId, fuelKey, projectTypeId) {
  // If more than one approved version somehow exists (shouldn't, given
  // the copy-on-write versioning in Phase 3, but defensive), the
  // highest version wins — it's the most recently approved.
  return SolutionTemplate.findOne({ companyId, fuelKey, projectTypeId, status: "approved", active: true }).sort({ version: -1 }).lean();
}

/** GET /:chatbotId/journey/questions?fuelKey=&projectTypeId= — exactly the questions the approved template for this fuel+project type actually asks, in order, required first. */
export const getJourneyQuestions = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });
    const fuelKey = String(req.query.fuelKey || "").toLowerCase();
    const { projectTypeId } = req.query;
    if (!fuelKey || !projectTypeId) return res.status(400).json({ success: false, message: "fuelKey and projectTypeId are required." });

    const config = await loadPublishedConfig(chatbot._id);
    if (!config || !config.enabledFuelKeys.includes(fuelKey) || !config.enabledProjectTypeIds.some((id) => String(id) === projectTypeId)) {
      return res.status(200).json({ success: true, hasApprovedTemplate: false, questions: [] });
    }

    const { visitorId, sessionId } = req.query;
    if (visitorId && sessionId) trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName: "energy_project_type_selected", fuelKey, projectTypeId });

    const template = await findApprovedTemplate(chatbot.companyId, fuelKey, projectTypeId);
    if (!template) return res.status(200).json({ success: true, hasApprovedTemplate: false, questions: [] });

    const requiredIds = new Set((template.requiredQuestionIds || []).map(String));
    const allIds = [...(template.requiredQuestionIds || []), ...(template.optionalQuestionIds || [])];
    // Active, not-deleted questions only — Stage D: "Handle missing, inactive or deleted questions safely" — anything no longer valid just silently drops out.
    const questions = await EnergyQuestion.find({ companyId: chatbot.companyId, _id: { $in: allIds }, active: true }).sort({ order: 1 }).lean();

    return res.status(200).json({
      success: true,
      hasApprovedTemplate: true,
      templateId: template._id,
      outputTypes: template.outputTypes,
      questions: questions.map((q) => ({ ...q, required: requiredIds.has(String(q._id)) })),
    });
  } catch (error) {
    console.error("Get Journey Questions Error:", error);
    return res.status(500).json({ success: false, message: "Unable to load questions right now." });
  }
};

/** POST /:chatbotId/journey/generate — the one write action: runs the deterministic engine against the resolved approved template. The visitor supplies answers only, never a template id. */
export const generateJourneySolution = async (req, res) => {
  let chatbot;
  try {
    chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });
    const { fuelKey, projectTypeId, answers, visitorId, sessionId } = req.body || {};
    if (!fuelKey || !projectTypeId) return res.status(400).json({ success: false, message: "fuelKey and projectTypeId are required." });
    const canTrack = Boolean(visitorId && sessionId);
    // Awaited — a generation result is exactly the kind of business-
    // critical outcome the tracking is meant to capture reliably, not
    // best-effort (see the identical note on RFQ submission).
    const track = (eventName, extra) => {
      if (canTrack) return trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName, fuelKey, projectTypeId, ...extra });
      return Promise.resolve();
    };

    const config = await loadPublishedConfig(chatbot._id);
    if (!config || !config.enabledFuelKeys.includes(String(fuelKey).toLowerCase()) || !config.enabledProjectTypeIds.some((id) => String(id) === projectTypeId)) {
      return res.status(400).json({ success: false, message: "This fuel/project type isn't available on this chatbot." });
    }

    const template = await findApprovedTemplate(chatbot.companyId, String(fuelKey).toLowerCase(), projectTypeId);
    if (!template) {
      return res.status(200).json({ success: true, noTemplateConfigured: true, message: "This company hasn't set up an automatic solution for this project type yet. You can still submit your requirements and a team member will follow up." });
    }

    const questionIds = new Set([...(template.requiredQuestionIds || []).map(String), ...(template.optionalQuestionIds || []).map(String)]);
    for (const m of template.equipmentMappings || []) {
      if (m.selectionCondition?.questionId) questionIds.add(String(m.selectionCondition.questionId));
      if (m.quantityRule?.sourceQuestionId) questionIds.add(String(m.quantityRule.sourceQuestionId));
    }
    const equipmentIds = (template.equipmentMappings || []).map((m) => m.equipmentId).filter(Boolean);
    const [questions, equipment] = await Promise.all([
      EnergyQuestion.find({ companyId: chatbot.companyId, _id: { $in: [...questionIds] } }).lean(),
      EnergyEquipment.find({ companyId: chatbot.companyId, _id: { $in: equipmentIds } }).select("-image.data -datasheet.data").lean(),
    ]);
    const questionsById = new Map(questions.map((q) => [String(q._id), q]));
    const equipmentById = new Map(equipment.map((e) => [String(e._id), e]));

    const result = runSolutionTemplate(template, { questionsById, equipmentById, answers: answers && typeof answers === "object" ? answers : {} });

    // Only a genuinely completed run counts as "generated" — a
    // `valid: false` result just means required answers are still
    // missing (the visitor hasn't finished the questions yet), not a
    // failure of the engine itself, so it's never tracked either way.
    if (result.valid) await track("energy_solution_generated", { solutionTemplateId: template._id, metadata: { requiresEngineeringReview: Boolean(result.requiresEngineeringReview) } });

    // Subtitle context for the chat widget's BOM card ("CNG · Up to
    // 1,000 kg/day · Daughter booster station") plus a fallback
    // "supplied by" label for lines with no distinct manufacturer —
    // every line is still this company's own work unless an
    // equipment row names a different manufacturer.
    const [company, fuel, projectType] = await Promise.all([
      Company.findOne({ companyId: chatbot.companyId }).select("name").lean(),
      EnergyFuelCategory.findOne({ ...sharedOrOwn(chatbot.companyId), key: String(fuelKey).toLowerCase() }).select("label").lean(),
      EnergyProjectType.findById(projectTypeId).select("label").lean(),
    ]);

    return res.status(200).json({
      success: true,
      noTemplateConfigured: false,
      result,
      template: { id: template._id, version: template.version, outputTypes: template.outputTypes },
      context: {
        companyName: company?.name || "",
        fuelLabel: fuel?.label || fuelKey,
        projectTypeLabel: projectType?.label || "",
      },
    });
  } catch (error) {
    console.error("Generate Journey Solution Error:", error);
    if (chatbot && req.body?.visitorId && req.body?.sessionId) {
      await trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId: req.body.visitorId, sessionId: req.body.sessionId, eventName: "energy_solution_generation_failed", metadata: { reason: "server_error" } });
    }
    return res.status(500).json({ success: false, message: "Unable to generate your solution right now." });
  }
};

const MAX_ASSISTANT_QUESTION_LENGTH = 500;

/** POST /:chatbotId/journey/ask — Phase 5.1: a one-off, read-only explainer call. Never touches journey state, never generates a BOM — see energyAssistant.service.js. */
export const askJourneyQuestion = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) return res.status(400).json({ success: false, message: "question is required." });
    if (question.length > MAX_ASSISTANT_QUESTION_LENGTH) return res.status(400).json({ success: false, message: `question must be ${MAX_ASSISTANT_QUESTION_LENGTH} characters or fewer.` });

    // Company is always resolved from the already-verified chatbot — a
    // client-supplied companyId is never trusted or even accepted here.
    const company = await Company.findOne({ companyId: chatbot.companyId }).lean();
    if (!company) return res.status(404).json({ success: false, message: "Company not found." });

    const context = req.body?.context || {};
    const answer = await askEnergyAssistant({
      company,
      chatbotId: chatbot._id,
      question,
      fuelKey: typeof context.fuelKey === "string" ? context.fuelKey : undefined,
      projectTypeLabel: typeof context.projectTypeLabel === "string" ? context.projectTypeLabel.slice(0, 120) : undefined,
      stage: typeof context.stage === "string" ? context.stage.slice(0, 40) : undefined,
    });

    const { visitorId, sessionId } = req.body || {};
    if (visitorId && sessionId) trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName: "energy_ai_assistance_requested", fuelKey: typeof context.fuelKey === "string" ? context.fuelKey : null });

    return res.status(200).json({ success: true, answer });
  } catch (error) {
    console.error("Ask Journey Question Error:", error);
    return res.status(500).json({ success: false, message: "Unable to answer that right now." });
  }
};

/**
 * POST /:chatbotId/journey/handoff — Phase 5.1: routes a visitor's
 * request for a human through the SAME Conversation/handoff machinery
 * the regular chat pipeline uses (see controllers/chatbot.message.js's
 * keyword-triggered handoff) — not a new, separate system. This is
 * what makes the request show up in the company's existing LiveView/
 * Conversations inbox (services/liveView.service.js already surfaces
 * anything with `handoffAt` set).
 */
export const requestJourneyHandoff = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const visitorId = typeof req.body?.visitorId === "string" ? req.body.visitorId.trim() : "";
    if (!visitorId) return res.status(400).json({ success: false, message: "visitorId is required." });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";

    const company = await Company.findOne({ companyId: chatbot.companyId }).lean();
    if (!company) return res.status(404).json({ success: false, message: "Company not found." });

    const context = req.body?.context || {};
    const contextLine = [context.fuelKey ? `Fuel: ${context.fuelKey}` : null, context.projectTypeLabel ? `Project type: ${context.projectTypeLabel}` : null].filter(Boolean).join(" · ");

    const handoffMessage = `A visitor requested human assistance from the Energy assistant.${contextLine ? `\n\n${contextLine}` : ""}${reason ? `\n\nTheir message: "${reason}"` : ""}

📞 Call: ${company.contact?.phone || "Not available"}
💬 WhatsApp: ${company.contact?.whatsapp || "Not available"}
📧 Email: ${company.contact?.email || "Not available"}`;

    const conversation = await getOrCreateConversation(chatbot.companyId, visitorId, chatbot._id);

    await Bot.create({
      companyId: chatbot.companyId,
      visitorId,
      chatbotId: chatbot._id,
      sender: "bot",
      type: "handoff",
      text: handoffMessage,
    });

    await touchConversationAfterAiReply(conversation, { text: handoffMessage, isHandoff: true, handoffReason: "manual" });

    dispatchWebhookEvent(company, "conversation.handoff", { chatbotId: conversation.chatbotId, conversationId: conversation._id, visitorId, reason: "manual" });
    dispatchDeveloperWebhooks(chatbot.companyId, conversation.chatbotId, "conversation.handoff", { chatbotId: conversation.chatbotId, conversationId: conversation._id, visitorId, reason: "manual" });

    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    if (sessionId) trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName: "energy_handoff_requested", fuelKey: typeof context.fuelKey === "string" ? context.fuelKey : null });

    return res.status(200).json({ success: true, message: handoffMessage });
  } catch (error) {
    console.error("Request Journey Handoff Error:", error);
    return res.status(500).json({ success: false, message: "We couldn't connect you with a human right now — please try again or use the contact details on our site." });
  }
};

// ======================================================
// PHASE 6 — client-fired tracking for the handful of pure stage
// transitions that have no corresponding API call of their own
// (opening the panel, clicking "Explore", reaching the summary, …).
// Deliberately a NARROW allowlist, stricter than the model's full
// ENERGY_ANALYTICS_EVENTS enum: events that already have a trustworthy
// server-side trigger (fuel/project-type selection, solution
// generation, AI requests, handoff requests, RFQ submission) are
// intentionally excluded here so a visitor's browser can never
// fabricate/inflate those business-critical counts by calling this
// endpoint directly — only the client genuinely knows these happened.
// ======================================================
const CLIENT_TRACKABLE_EVENTS = [
  "energy_journey_started",
  "energy_intent_selected",
  "energy_questions_started",
  "energy_question_displayed",
  "energy_question_answered",
  "energy_questions_completed",
  "energy_summary_reviewed",
  "energy_supplier_selected",
  "energy_confirmation_displayed",
];

/** POST /:chatbotId/journey/track — see CLIENT_TRACKABLE_EVENTS above. Always non-blocking from the frontend's point of view; this endpoint itself responds immediately either way. */
export const trackJourneyEvent = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const { eventName, visitorId, sessionId, fuelKey, projectTypeId, questionId, supplierId, metadata } = req.body || {};
    if (!CLIENT_TRACKABLE_EVENTS.includes(eventName)) return res.status(400).json({ success: false, message: "Unsupported event name." });
    if (!ENERGY_ANALYTICS_EVENTS.includes(eventName)) return res.status(400).json({ success: false, message: "Unsupported event name." });
    if (typeof visitorId !== "string" || !visitorId || typeof sessionId !== "string" || !sessionId) {
      return res.status(400).json({ success: false, message: "visitorId and sessionId are required." });
    }

    // Only a small, explicit allowlist of metadata keys ever reaches
    // storage — never the raw answer value, filename, or any free text.
    const safeMetadata = metadata && typeof metadata === "object" ? { answeredWithUnknown: metadata.answeredWithUnknown === true ? true : undefined } : undefined;

    // Phase 7 audit fix — a client-fired event's reference ids were
    // previously stored unchecked. Since this is a public,
    // unauthenticated endpoint, a visitor could attach another
    // tenant's real questionId/supplierId, which this company's own
    // analytics would later resolve and display that tenant's label
    // (a real, confirmed cross-tenant leak) — or simply attach a
    // mismatched id to pollute this company's own metrics. Any
    // reference that doesn't resolve to a record this company
    // actually owns is dropped (set to null) rather than rejecting
    // the whole event — analytics must still never block the journey.
    const [questionOwned, supplierOwned] = await Promise.all([
      typeof questionId === "string" && questionId ? EnergyQuestion.exists({ _id: questionId, companyId: chatbot.companyId }) : null,
      typeof supplierId === "string" && supplierId ? EnergySupplier.exists({ _id: supplierId, companyId: chatbot.companyId }) : null,
    ]);

    await trackEnergyEvent({
      companyId: chatbot.companyId,
      chatbotId: chatbot._id,
      visitorId,
      sessionId,
      eventName,
      fuelKey: typeof fuelKey === "string" ? fuelKey : null,
      projectTypeId: null, // no CLIENT_TRACKABLE_EVENTS event legitimately carries this today — never trusted from this public endpoint.
      questionId: questionOwned ? questionId : null,
      supplierId: supplierOwned ? supplierId : null,
      metadata: safeMetadata,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Track Journey Event Error:", error);
    // Analytics must never break the journey — a failure here is still a 200 from the caller's perspective where possible, but this endpoint's own failure mode is a plain error response; the frontend never surfaces it to the visitor.
    return res.status(500).json({ success: false });
  }
};
