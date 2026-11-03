import EnergyQuestion, { QUESTION_TYPES } from "../../models/energy/question.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import { loadAuthorizedEnergyChatbot, sharedOrOwn } from "../../services/energy/energyAccess.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { validateAllowedFileTypes, validateMaxFileSizeMb, SUPPORTED_FILE_TYPES, DEFAULT_MAX_SIZE_MB, HARD_MAX_SIZE_MB } from "../../services/energy/fileUploadPolicy.service.js";

// ======================================================
// DYNAMIC QUESTION BUILDER (Phase 2, Part A) — company-scoped, same
// chatbot-URL-as-authorized-entry-point convention as Phase 1's
// fuels/product-services/project-types: the route is chatbot-scoped
// for the access check, the underlying data is companyId-scoped so a
// company's question set is shared across any Energy chatbot it runs.
// ======================================================

const NEEDS_OPTIONS = ["dropdown", "single_choice", "multiple_choice"];

function validateQuestionShape(body) {
  const { label, type, fuelKey, options } = body;
  if (!label || !String(label).trim()) return "label is required.";
  if (!QUESTION_TYPES.includes(type)) return `type must be one of: ${QUESTION_TYPES.join(", ")}.`;
  if (!fuelKey || !String(fuelKey).trim()) return "fuelKey is required.";
  if (NEEDS_OPTIONS.includes(type) && (!Array.isArray(options) || options.filter((o) => String(o || "").trim()).length < 2)) {
    return `${type} questions need at least two options.`;
  }
  if (type === "number_unit" && !body.unit) return "number_unit questions need a unit.";
  return null;
}

async function validateDependsOn(companyId, fuelKey, dependsOnQuestionId, excludeId = null) {
  if (!dependsOnQuestionId) return null;
  const target = await EnergyQuestion.findOne({ _id: dependsOnQuestionId, companyId, fuelKey }).lean();
  if (!target) return "The question this depends on must exist under the same fuel.";
  if (excludeId && String(target._id) === String(excludeId)) return "A question cannot depend on itself.";
  // One level of cycle protection: the target can't itself depend on
  // the question being saved (a->b->a). Deeper cycles are vanishingly
  // unlikely in a hand-built question set and are a Phase-3-worthy
  // graph check, not blocking here.
  if (excludeId && target.dependsOnQuestionId && String(target.dependsOnQuestionId) === String(excludeId)) {
    return "These two questions would depend on each other.";
  }
  return null;
}

// Task 6 — lets the admin UI render the exact set of file types/size
// limits the upload pipeline actually supports, instead of
// hardcoding a second copy of that list in the frontend that could
// drift out of sync with fileUploadPolicy.service.js.
export const getFileUploadPolicy = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    return res.status(200).json({
      success: true,
      supportedTypes: SUPPORTED_FILE_TYPES.map((t) => ({ mime: t.mime, label: t.label, extensions: t.extensions })),
      defaultMaxSizeMb: DEFAULT_MAX_SIZE_MB,
      hardMaxSizeMb: HARD_MAX_SIZE_MB,
    });
  } catch (error) {
    console.error("Get File Upload Policy Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the upload policy." });
  }
};

export const listQuestions = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const filter = { companyId: ctx.chatbot.companyId };
    if (req.query.fuelKey) filter.fuelKey = req.query.fuelKey;
    if (req.query.projectTypeId) filter.projectTypeId = req.query.projectTypeId;
    const questions = await EnergyQuestion.find(filter).sort({ fuelKey: 1, order: 1, createdAt: 1 }).lean();
    return res.status(200).json({ success: true, questions });
  } catch (error) {
    console.error("List Questions Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load questions." });
  }
};

export const createQuestion = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const shapeError = validateQuestionShape(req.body || {});
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });

    // Task 6 — never trust the admin UI alone to keep these sane; the
    // upload endpoint enforces the same shared policy (see
    // fileUploadPolicy.service.js), so a bad value here would
    // otherwise only surface confusingly later, at upload time.
    const typesCheck = validateAllowedFileTypes(req.body.allowedFileTypes);
    if (!typesCheck.valid) return res.status(400).json({ success: false, message: typesCheck.error });
    const sizeCheck = validateMaxFileSizeMb(req.body.maxFileSizeMb);
    if (!sizeCheck.valid) return res.status(400).json({ success: false, message: sizeCheck.error });

    const { fuelKey, projectTypeId, dependsOnQuestionId } = req.body;
    if (projectTypeId) {
      const pt = await EnergyProjectType.findOne({ _id: projectTypeId, ...sharedOrOwn(ctx.chatbot.companyId), fuelKey }).lean();
      if (!pt) return res.status(400).json({ success: false, message: "projectTypeId must be a valid project type under this fuel." });
    }
    const dependsError = await validateDependsOn(ctx.chatbot.companyId, fuelKey, dependsOnQuestionId);
    if (dependsError) return res.status(400).json({ success: false, message: dependsError });

    const highestOrder = await EnergyQuestion.findOne({ companyId: ctx.chatbot.companyId, fuelKey, projectTypeId: projectTypeId || null }).sort({ order: -1 }).select("order").lean();

    const question = await EnergyQuestion.create({
      companyId: ctx.chatbot.companyId,
      fuelKey: String(fuelKey).toLowerCase(),
      projectTypeId: projectTypeId || null,
      label: String(req.body.label).trim(),
      description: req.body.description || "",
      placeholder: req.body.placeholder || "",
      type: req.body.type,
      unit: req.body.unit || "",
      options: Array.isArray(req.body.options) ? req.body.options.map((o) => String(o).trim()).filter(Boolean) : [],
      required: req.body.required !== false,
      allowUnknown: Boolean(req.body.allowUnknown),
      validation: {
        min: req.body.validation?.min ?? null,
        max: req.body.validation?.max ?? null,
        maxLength: req.body.validation?.maxLength ?? null,
        regex: req.body.validation?.regex || "",
      },
      dependsOnQuestionId: dependsOnQuestionId || null,
      dependsOnCondition: dependsOnQuestionId ? req.body.dependsOnCondition || "equals" : null,
      dependsOnValue: dependsOnQuestionId ? req.body.dependsOnValue ?? null : null,
      order: (highestOrder?.order ?? -1) + 1,
      allowedFileTypes: typesCheck.value ?? [],
      maxFileSizeMb: sizeCheck.value ?? null,
    });

    await logAction(req, { action: "ENERGY_QUESTION_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { fuelKey } });
    return res.status(201).json({ success: true, question });
  } catch (error) {
    console.error("Create Question Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the question." });
  }
};

export const updateQuestion = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const question = await EnergyQuestion.findOne({ _id: req.params.questionId, companyId: ctx.chatbot.companyId });
    if (!question) return res.status(404).json({ success: false, message: "Question not found." });

    const merged = { ...question.toObject(), ...req.body };
    const shapeError = validateQuestionShape(merged);
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });

    if (req.body.dependsOnQuestionId !== undefined) {
      const dependsError = await validateDependsOn(ctx.chatbot.companyId, question.fuelKey, req.body.dependsOnQuestionId, question._id);
      if (dependsError) return res.status(400).json({ success: false, message: dependsError });
    }

    const typesCheck = validateAllowedFileTypes(req.body.allowedFileTypes);
    if (!typesCheck.valid) return res.status(400).json({ success: false, message: typesCheck.error });
    const sizeCheck = validateMaxFileSizeMb(req.body.maxFileSizeMb);
    if (!sizeCheck.valid) return res.status(400).json({ success: false, message: sizeCheck.error });
    if (typesCheck.value !== undefined) req.body.allowedFileTypes = typesCheck.value;
    if (sizeCheck.value !== undefined) req.body.maxFileSizeMb = sizeCheck.value;

    const EDITABLE = ["label", "description", "placeholder", "type", "unit", "options", "required", "allowUnknown", "validation", "dependsOnQuestionId", "dependsOnCondition", "dependsOnValue", "active", "allowedFileTypes", "maxFileSizeMb"];
    for (const field of EDITABLE) if (req.body[field] !== undefined) question[field] = req.body[field];
    await question.save();

    return res.status(200).json({ success: true, question });
  } catch (error) {
    console.error("Update Question Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the question." });
  }
};

export const deleteQuestion = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const question = await EnergyQuestion.findOne({ _id: req.params.questionId, companyId: ctx.chatbot.companyId });
    if (!question) return res.status(404).json({ success: false, message: "Question not found." });
    await question.deleteOne();
    // Nothing else should still reference a deleted question as a
    // dependency — clear it rather than leaving a dangling pointer.
    await EnergyQuestion.updateMany({ companyId: ctx.chatbot.companyId, dependsOnQuestionId: question._id }, { $set: { dependsOnQuestionId: null, dependsOnCondition: null, dependsOnValue: null } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Question Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the question." });
  }
};

// Drag-and-drop reordering within one fuel (+ optional project type)
// scope — takes the full ordered list of ids for that scope and
// re-numbers them 0..n, so the admin UI never has to compute gaps.
export const reorderQuestions = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const { fuelKey, projectTypeId, orderedIds } = req.body || {};
    if (!fuelKey || !Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ success: false, message: "fuelKey and a non-empty orderedIds array are required." });
    }
    const existing = await EnergyQuestion.find({ companyId: ctx.chatbot.companyId, fuelKey, projectTypeId: projectTypeId || null }).select("_id").lean();
    const existingIds = new Set(existing.map((q) => String(q._id)));
    if (orderedIds.length !== existingIds.size || !orderedIds.every((id) => existingIds.has(String(id)))) {
      return res.status(400).json({ success: false, message: "orderedIds must be exactly the questions currently in this fuel/project-type scope." });
    }
    await Promise.all(orderedIds.map((id, index) => EnergyQuestion.updateOne({ _id: id, companyId: ctx.chatbot.companyId }, { $set: { order: index } })));
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Reorder Questions Error:", error);
    return res.status(500).json({ success: false, message: "Failed to reorder questions." });
  }
};
