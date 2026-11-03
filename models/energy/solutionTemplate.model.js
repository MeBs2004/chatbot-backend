import mongoose from "mongoose";

// ======================================================
// ENERGY — BOM & TECHNICAL SOLUTION TEMPLATE (Phase 3). Company-scoped,
// one fuel + one project type per template. This is the ONLY place
// equipment quantities/selections for a customer journey are decided —
// the LLM (Phase 5) will only ever explain a result this template (via
// solutionEngine.service.js) already computed, never invent one.
//
// Versioning: editing a DRAFT/REJECTED template mutates it in place.
// Editing an APPROVED template instead creates a NEW document (same
// `familyId`, version+1, status reset to DRAFT, `previousVersionId`
// pointing at the approved one) — the approved version already in use
// is never silently changed. `familyId` is shared by every version of
// "the same template" and is what groups version history.
// ======================================================

export const OUTPUT_TYPES = ["bom", "equipment_recommendation", "system_sizing", "technical_solution_proposal", "project_requirement_summary", "quotation_request"];
export const TEMPLATE_STATUSES = ["draft", "pending_review", "approved", "rejected", "archived"];

const selectionConditionSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyQuestion", default: null }, // null = always included
    condition: { type: String, enum: ["equals", "not_equals", "in"], default: "equals" },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

// Deliberately NOT a free-form formula string (no arbitrary code
// execution) — a small, fixed set of controlled quantity rules, per
// the brief's own fallback: "provide a clearly defined controlled
// configuration approach instead of executing arbitrary user-supplied
// code."
const quantityRuleSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["fixed", "per_question_value", "per_question_value_divided"], default: "fixed" },
    fixedQty: { type: Number, default: 1 }, // used by "fixed"
    sourceQuestionId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyQuestion", default: null }, // used by the per_question_value* types
    multiplier: { type: Number, default: 1 }, // per_question_value: qty = ceil(answer * multiplier)
    divisor: { type: Number, default: 1 }, // per_question_value_divided: qty = ceil(answer / divisor)
    minQty: { type: Number, default: 1 },
  },
  { _id: false }
);

const equipmentMappingSchema = new mongoose.Schema(
  {
    equipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyEquipment", required: true },
    mandatory: { type: Boolean, default: true },
    selectionCondition: { type: selectionConditionSchema, default: null },
    quantityRule: { type: quantityRuleSchema, default: () => ({ type: "fixed", fixedQty: 1 }) },
    unitOverride: { type: String, default: "" }, // falls back to the equipment's own unit/capacityUnit if blank
    notes: { type: String, default: "" }, // "reason for selection" shown in the output preview
  },
  { _id: false }
);

const solutionTemplateSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, // same across every version of "this template"

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },

    fuelKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    projectTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyProjectType", required: true },

    outputTypes: { type: [String], enum: OUTPUT_TYPES, default: [] },

    requiredQuestionIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergyQuestion", default: [] },
    optionalQuestionIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergyQuestion", default: [] },
    equipmentMappings: { type: [equipmentMappingSchema], default: [] },

    requiresEngineeringReview: { type: Boolean, default: false }, // the company can flag a whole template as "always needs a human to check" regardless of what the engine computes

    version: { type: Number, default: 1 },
    previousVersionId: { type: mongoose.Schema.Types.ObjectId, ref: "SolutionTemplate", default: null },

    status: { type: String, enum: TEMPLATE_STATUSES, default: "draft" },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
    rejectedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: "" },

    active: { type: Boolean, default: true }, // usage flag, independent of approval status — toggled without creating a new version
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true }
);

solutionTemplateSchema.index({ companyId: 1, fuelKey: 1, projectTypeId: 1 });
solutionTemplateSchema.index({ familyId: 1, version: -1 });

export default mongoose.model("SolutionTemplate", solutionTemplateSchema);
