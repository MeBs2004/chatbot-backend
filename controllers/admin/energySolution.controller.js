import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import XLSX from "xlsx";
import SolutionTemplate, { OUTPUT_TYPES } from "../../models/energy/solutionTemplate.model.js";
import EnergyQuestion from "../../models/energy/question.model.js";
import EnergyEquipment from "../../models/energy/equipment.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import { loadAuthorizedEnergyChatbot, sharedOrOwn } from "../../services/energy/energyAccess.service.js";
import { runSolutionTemplate } from "../../services/energy/solutionEngine.service.js";
import { getChatbotRole } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";

// ======================================================
// BOM & TECHNICAL SOLUTION TEMPLATES (Phase 3) — company-scoped, same
// chatbot-URL-as-authorized-entry-point convention as Phases 1/2.
// Approve/reject are gated to COMPANY_ADMIN+ (see APPROVER_ROLES); any
// chatbot-accessing role can create/edit/preview a template.
// ======================================================

const APPROVER_ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN"];

function validateTemplateShape(body) {
  if (!body.name || !String(body.name).trim()) return "name is required.";
  if (!body.fuelKey || !String(body.fuelKey).trim()) return "fuelKey is required.";
  if (!body.projectTypeId) return "projectTypeId is required.";
  if (body.outputTypes !== undefined) {
    if (!Array.isArray(body.outputTypes) || body.outputTypes.length === 0) return "Select at least one output type.";
    if (body.outputTypes.some((t) => !OUTPUT_TYPES.includes(t))) return `outputTypes must only contain: ${OUTPUT_TYPES.join(", ")}.`;
  }
  return null;
}

async function validateReferences(companyId, fuelKey, body, { questionIdsMustBeKnown = new Set() } = {}) {
  const pt = await EnergyProjectType.findOne({ _id: body.projectTypeId, ...sharedOrOwn(companyId), fuelKey }).lean();
  if (!pt) return "projectTypeId must be a valid project type under this fuel.";

  const allQuestionIds = [...(body.requiredQuestionIds || []), ...(body.optionalQuestionIds || [])];
  if (allQuestionIds.length > 0) {
    const count = await EnergyQuestion.countDocuments({ companyId, fuelKey, _id: { $in: allQuestionIds } });
    if (count !== new Set(allQuestionIds.map(String)).size) return "One or more questions are invalid for this fuel.";
  }
  const knownQuestionIds = new Set(allQuestionIds.map(String));

  for (const m of body.equipmentMappings || []) {
    if (!m.equipmentId) return "Every equipment mapping needs an equipmentId.";
    if (m.selectionCondition?.questionId && !knownQuestionIds.has(String(m.selectionCondition.questionId))) {
      return "An equipment mapping's selection condition must reference one of this template's own questions.";
    }
    if (["per_question_value", "per_question_value_divided"].includes(m.quantityRule?.type)) {
      if (!m.quantityRule.sourceQuestionId || !knownQuestionIds.has(String(m.quantityRule.sourceQuestionId))) {
        return "A per-question quantity rule must reference one of this template's own questions.";
      }
    }
    // Phase 7 audit fix — nothing previously stopped an admin from
    // saving a nonsensical rule (negative fixed quantity, a zero/negative
    // multiplier that would silently produce a wrong-direction result,
    // a negative floor) that the engine would then apply to every
    // matching visitor answer. Caught here, once, at save time, rather
    // than relying solely on the engine's own per-run safety net.
    const rule = m.quantityRule;
    if (rule?.type === "fixed" && rule.fixedQty !== undefined && rule.fixedQty !== null && Number(rule.fixedQty) < 0) {
      return "A fixed quantity rule cannot be negative.";
    }
    if (rule?.type === "per_question_value" && rule.multiplier !== undefined && rule.multiplier !== null && !(Number(rule.multiplier) > 0)) {
      return "A per-question quantity rule's multiplier must be greater than zero.";
    }
    if (rule?.type === "per_question_value_divided" && rule.divisor !== undefined && rule.divisor !== null && !(Number(rule.divisor) > 0)) {
      return "A per-question quantity rule's divisor must be greater than zero.";
    }
    if (rule?.minQty !== undefined && rule.minQty !== null && Number(rule.minQty) < 0) {
      return "A quantity rule's minimum quantity cannot be negative.";
    }
  }
  if ((body.equipmentMappings || []).length > 0) {
    const equipmentIds = body.equipmentMappings.map((m) => m.equipmentId);
    const count = await EnergyEquipment.countDocuments({ companyId, fuelKey, _id: { $in: equipmentIds } });
    if (count !== new Set(equipmentIds.map(String)).size) return "One or more mapped equipment items are invalid for this fuel.";
  }
  return null;
}

const EDITABLE_FIELDS = ["name", "description", "outputTypes", "requiredQuestionIds", "optionalQuestionIds", "equipmentMappings", "requiresEngineeringReview"];

export const listTemplates = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const filter = { companyId: ctx.chatbot.companyId };
    if (req.query.fuelKey) filter.fuelKey = req.query.fuelKey;
    if (req.query.projectTypeId) filter.projectTypeId = req.query.projectTypeId;
    if (req.query.status) filter.status = req.query.status;
    // Only the latest version of each family by default — pass ?allVersions=1 to see every version (used by the version-history view).
    const templates = await SolutionTemplate.find(filter).sort({ fuelKey: 1, name: 1, version: -1 }).lean();
    const latestOnly = req.query.allVersions ? templates : Object.values(templates.reduce((acc, t) => {
      const key = String(t.familyId);
      if (!acc[key] || acc[key].version < t.version) acc[key] = t;
      return acc;
    }, {}));
    return res.status(200).json({ success: true, templates: latestOnly });
  } catch (error) {
    console.error("List Solution Templates Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load templates." });
  }
};

export const getTemplateDetail = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }).lean();
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.error("Get Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the template." });
  }
};

export const listTemplateVersions = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }).select("familyId").lean();
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    const versions = await SolutionTemplate.find({ companyId: ctx.chatbot.companyId, familyId: template.familyId }).sort({ version: -1 }).lean();
    return res.status(200).json({ success: true, versions });
  } catch (error) {
    console.error("List Template Versions Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load version history." });
  }
};

export const createTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const shapeError = validateTemplateShape(req.body || {});
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });
    const fuelKey = String(req.body.fuelKey).toLowerCase();
    const refError = await validateReferences(ctx.chatbot.companyId, fuelKey, req.body);
    if (refError) return res.status(400).json({ success: false, message: refError });

    const template = await SolutionTemplate.create({
      companyId: ctx.chatbot.companyId,
      familyId: new mongoose.Types.ObjectId(),
      name: String(req.body.name).trim(),
      description: req.body.description || "",
      fuelKey,
      projectTypeId: req.body.projectTypeId,
      outputTypes: req.body.outputTypes || [],
      requiredQuestionIds: req.body.requiredQuestionIds || [],
      optionalQuestionIds: req.body.optionalQuestionIds || [],
      equipmentMappings: req.body.equipmentMappings || [],
      requiresEngineeringReview: Boolean(req.body.requiresEngineeringReview),
      version: 1,
      status: "draft",
      createdBy: req.adminUser._id,
    });

    await logAction(req, { action: "ENERGY_SOLUTION_TEMPLATE_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { name: template.name } });
    return res.status(201).json({ success: true, template });
  } catch (error) {
    console.error("Create Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the template." });
  }
};

// Editing a DRAFT/REJECTED template mutates it in place. Editing an
// APPROVED one creates a new version instead (see model header) — the
// version currently relied on elsewhere is never silently changed.
export const updateTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const existing = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId });
    if (!existing) return res.status(404).json({ success: false, message: "Template not found." });
    if (existing.status === "archived") return res.status(400).json({ success: false, message: "An archived template can't be edited — create a new one instead." });

    const merged = { ...existing.toObject(), ...req.body };
    const shapeError = validateTemplateShape(merged);
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });
    const refError = await validateReferences(ctx.chatbot.companyId, existing.fuelKey, merged);
    if (refError) return res.status(400).json({ success: false, message: refError });

    if (existing.status === "approved") {
      const latestVersion = await SolutionTemplate.findOne({ companyId: ctx.chatbot.companyId, familyId: existing.familyId }).sort({ version: -1 }).select("version").lean();
      const next = new SolutionTemplate({
        ...existing.toObject(),
        _id: undefined,
        ...Object.fromEntries(EDITABLE_FIELDS.filter((f) => req.body[f] !== undefined).map((f) => [f, req.body[f]])),
        version: (latestVersion?.version || existing.version) + 1,
        previousVersionId: existing._id,
        status: "draft",
        submittedAt: null,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectedReason: "",
        createdBy: req.adminUser._id,
        createdAt: undefined,
        updatedAt: undefined,
      });
      await next.save();
      return res.status(201).json({ success: true, template: next, newVersionCreated: true });
    }

    for (const field of EDITABLE_FIELDS) if (req.body[field] !== undefined) existing[field] = req.body[field];
    await existing.save();
    return res.status(200).json({ success: true, template: existing });
  } catch (error) {
    console.error("Update Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the template." });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId });
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    if (!["draft", "rejected"].includes(template.status)) {
      return res.status(400).json({ success: false, message: "Only a draft or rejected template can be deleted — archive it instead." });
    }
    await template.deleteOne();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the template." });
  }
};

export const setTemplateActive = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOneAndUpdate({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }, { $set: { active: Boolean(req.body.active) } }, { new: true });
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.error("Set Template Active Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the template." });
  }
};

// ---------------- Approval workflow ----------------

export const submitTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId });
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    if (!["draft", "rejected"].includes(template.status)) return res.status(400).json({ success: false, message: "Only a draft or rejected template can be submitted for review." });
    if ((template.equipmentMappings || []).length === 0) return res.status(400).json({ success: false, message: "Add at least one equipment mapping before submitting for review." });

    template.status = "pending_review";
    template.submittedAt = new Date();
    await template.save();
    await logAction(req, { action: "ENERGY_SOLUTION_TEMPLATE_SUBMITTED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { templateId: template._id } });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.error("Submit Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit the template." });
  }
};

export const approveTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const role = await getChatbotRole(req.adminUser, ctx.chatbot._id);
    if (!APPROVER_ROLES.includes(role)) return res.status(403).json({ success: false, message: "You don't have permission to approve templates." });

    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId });
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    if (template.status !== "pending_review") return res.status(400).json({ success: false, message: "Only a template pending review can be approved." });

    template.status = "approved";
    template.approvedBy = req.adminUser._id;
    template.approvedAt = new Date();
    await template.save();
    await logAction(req, { action: "ENERGY_SOLUTION_TEMPLATE_APPROVED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { templateId: template._id } });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.error("Approve Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to approve the template." });
  }
};

export const rejectTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const role = await getChatbotRole(req.adminUser, ctx.chatbot._id);
    if (!APPROVER_ROLES.includes(role)) return res.status(403).json({ success: false, message: "You don't have permission to reject templates." });

    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId });
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    if (template.status !== "pending_review") return res.status(400).json({ success: false, message: "Only a template pending review can be rejected." });

    template.status = "rejected";
    template.rejectedBy = req.adminUser._id;
    template.rejectedAt = new Date();
    template.rejectedReason = req.body?.reason || "";
    await template.save();
    await logAction(req, { action: "ENERGY_SOLUTION_TEMPLATE_REJECTED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { templateId: template._id, reason: template.rejectedReason } });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.error("Reject Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to reject the template." });
  }
};

export const archiveTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOneAndUpdate({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }, { $set: { status: "archived", active: false } }, { new: true });
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    return res.status(200).json({ success: true, template });
  } catch (error) {
    console.error("Archive Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to archive the template." });
  }
};

// ---------------- Preview / export ----------------

async function buildEngineContext(companyId, template) {
  const questionIds = new Set([...(template.requiredQuestionIds || []).map(String), ...(template.optionalQuestionIds || []).map(String)]);
  for (const m of template.equipmentMappings || []) {
    if (m.selectionCondition?.questionId) questionIds.add(String(m.selectionCondition.questionId));
    if (m.quantityRule?.sourceQuestionId) questionIds.add(String(m.quantityRule.sourceQuestionId));
  }
  const equipmentIds = (template.equipmentMappings || []).map((m) => m.equipmentId).filter(Boolean);

  const [questions, equipment] = await Promise.all([
    EnergyQuestion.find({ companyId, _id: { $in: [...questionIds] } }).lean(),
    EnergyEquipment.find({ companyId, _id: { $in: equipmentIds } }).select("-image.data -datasheet.data").lean(),
  ]);
  return { questionsById: new Map(questions.map((q) => [String(q._id), q])), equipmentById: new Map(equipment.map((e) => [String(e._id), e])) };
}

export const previewTemplate = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }).lean();
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });

    const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
    const { questionsById, equipmentById } = await buildEngineContext(ctx.chatbot.companyId, template);
    const result = runSolutionTemplate(template, { questionsById, equipmentById, answers });
    return res.status(200).json({ success: true, result, isPreview: true, previewWarning: template.status !== "approved" ? `This template is still ${template.status.replace("_", " ")} — not yet approved for real customer use.` : null });
  } catch (error) {
    console.error("Preview Solution Template Error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate the preview." });
  }
};

function moneyStr(n, currency = "INR") {
  if (n === null || n === undefined) return "—";
  return `${currency === "INR" ? "₹" : currency + " "}${Number(n).toLocaleString("en-IN")}`;
}

export const previewTemplatePdf = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }).lean();
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
    const { questionsById, equipmentById } = await buildEngineContext(ctx.chatbot.companyId, template);
    const result = runSolutionTemplate(template, { questionsById, equipmentById, answers });

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on("end", resolve));

    doc.fontSize(16).fillColor("#0d5537").text(template.name);
    doc.fontSize(10).fillColor("#666").text(`${template.fuelKey.toUpperCase()} · ${template.status.toUpperCase()} · v${template.version}`);
    doc.moveDown();
    if (!result.valid) {
      doc.fontSize(12).fillColor("#b91c1c").text("Missing required information:");
      doc.fontSize(10).fillColor("#333");
      result.missingInputs.forEach((m) => doc.text(`• ${m.label}`));
    } else {
      doc.fontSize(12).fillColor("#000").text("Bill of Materials (preview)");
      doc.moveDown(0.3);
      for (const line of result.lines) {
        doc.fontSize(10).fillColor("#000").text(`${line.name}${line.modelNumber ? ` (${line.modelNumber})` : ""} — ${line.mandatory ? "mandatory" : "optional"}`);
        doc.fontSize(9).fillColor("#555").text(`Qty: ${line.qty ?? "—"} ${line.unit || ""}  ·  Price: ${moneyStr(line.price, line.currency)}${line.requiresEngineeringReview ? "  ·  NEEDS ENGINEERING REVIEW" : ""}`);
        if (line.notes) doc.fontSize(8).fillColor("#888").text(line.notes);
        doc.moveDown(0.4);
      }
      if (result.warnings.length) {
        doc.moveDown();
        doc.fontSize(10).fillColor("#000").text("Warnings:");
        result.warnings.forEach((w) => doc.fontSize(9).fillColor("#b45309").text(`• ${w}`));
      }
    }
    doc.moveDown();
    doc.fontSize(8).fillColor("#999").text("PREVIEW ONLY — generated by an administrator for testing, not a customer-facing output.", { align: "center" });
    doc.end();
    await done;

    const buffer = Buffer.concat(chunks);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${template.name.replace(/[^a-z0-9]+/gi, "-")}-preview.pdf"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Preview Template PDF Error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate the PDF." });
  }
};

export const previewTemplateExcel = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const template = await SolutionTemplate.findOne({ _id: req.params.templateId, companyId: ctx.chatbot.companyId }).lean();
    if (!template) return res.status(404).json({ success: false, message: "Template not found." });
    const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
    const { questionsById, equipmentById } = await buildEngineContext(ctx.chatbot.companyId, template);
    const result = runSolutionTemplate(template, { questionsById, equipmentById, answers });

    if (!result.valid) return res.status(400).json({ success: false, message: "Can't export — required information is missing.", missingInputs: result.missingInputs });

    const rows = result.lines.map((l) => ({
      Item: l.name,
      Manufacturer: l.manufacturer || "",
      Model: l.modelNumber || "",
      Mandatory: l.mandatory ? "Yes" : "No",
      Qty: l.qty ?? "",
      Unit: l.unit || "",
      Price: l.price ?? "",
      Currency: l.currency || "",
      Notes: l.notes || "",
      "Needs Review": l.requiresEngineeringReview ? "Yes" : "No",
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "BOM Preview");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${template.name.replace(/[^a-z0-9]+/gi, "-")}-preview.xlsx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Preview Template Excel Error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate the Excel file." });
  }
};
