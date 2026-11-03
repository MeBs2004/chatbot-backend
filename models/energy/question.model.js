import mongoose from "mongoose";

// ======================================================
// ENERGY — DYNAMIC QUESTION (Phase 2, Part A). One question a company
// wants to ask visitors for a given fuel (and optionally narrowed to
// one project type under it). Company-scoped via `companyId`, same
// convention as EnergyProductService/EnergyProjectType, so a
// company's question set is reusable across any Energy chatbot it
// runs, not duplicated per chatbot. Phase 3's BOM/solution engine will
// read these the same way the future widget journey will: filtered by
// fuelKey + projectTypeId, ordered, active only.
// ======================================================

export const QUESTION_TYPES = ["short_text", "long_text", "number", "number_unit", "dropdown", "single_choice", "multiple_choice", "date", "file"];

const questionSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },

    fuelKey: { type: String, required: true, trim: true, lowercase: true, index: true },
    // null = applies to every project type under this fuel; set = only
    // shown when the visitor picked this specific project type.
    projectTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyProjectType", default: null, index: true },

    label: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    placeholder: { type: String, default: "", trim: true },

    type: { type: String, enum: QUESTION_TYPES, required: true },
    unit: { type: String, default: "" }, // used by "number_unit"
    options: { type: [String], default: [] }, // used by dropdown/single_choice/multiple_choice

    required: { type: Boolean, default: true },
    allowUnknown: { type: Boolean, default: false }, // shows an "I don't know" choice alongside the real input

    // Kept intentionally small/explicit rather than a free-form Mixed
    // blob — these are the validations the input types above can
    // actually use; an unsupported combination is just ignored, never
    // silently mis-enforced.
    validation: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      maxLength: { type: Number, default: null },
      regex: { type: String, default: "" },
    },

    // Conditional display — "only show this question if question X's
    // answer equals/includes/doesn't equal value Y". Self-referencing;
    // the controller rejects a cycle or a reference to a question
    // under a different fuel (see energyQuestion.controller.js).
    dependsOnQuestionId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyQuestion", default: null },
    dependsOnCondition: { type: String, enum: ["equals", "not_equals", "in"], default: null },
    dependsOnValue: { type: mongoose.Schema.Types.Mixed, default: null },

    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },

    // Phase 5.1 — only meaningful for type: "file". Empty/null means
    // "use the platform default allowlist/size cap" (see
    // energyJourneyFile.controller.js's DEFAULT_ALLOWED_MIME_TYPES),
    // not "any file of any size."
    allowedFileTypes: { type: [String], default: [] }, // MIME types, e.g. "application/pdf"
    maxFileSizeMb: { type: Number, default: null },
  },
  { timestamps: true }
);

questionSchema.index({ companyId: 1, fuelKey: 1, projectTypeId: 1, order: 1 });

export default mongoose.model("EnergyQuestion", questionSchema);
