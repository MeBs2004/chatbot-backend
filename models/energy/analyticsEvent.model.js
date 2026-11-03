import mongoose from "mongoose";

// ======================================================
// PHASE 6 — ENERGY ANALYTICS EVENT. The one new collection this phase
// introduces (the audit found no existing event-level tracking for the
// Energy journey — Conversation/Bot/EnergyEnquiry capture the OUTCOME
// of a journey, never its individual steps or abandonment points).
//
// Deliberately NOT a generic "analytics" collection: scoped to the
// Energy vertical, written by server-side controllers wherever a real
// business action already happens (solution generated, RFQ submitted,
// handoff requested, …) and by one narrow public endpoint
// (journey/track) for the handful of pure client-side stage
// transitions that have no corresponding API call of their own
// (journey started, intent selected, summary reviewed, confirmation
// displayed). Never stores full answers, file contents, or contact
// details — only references (ids) and small non-sensitive metadata,
// per Phase 6 Section 4's "do not store..." requirement.
//
// `sessionId` is a client-generated UUID created once when a visitor
// opens the Energy journey panel and threaded through every
// subsequent call for that attempt — it is what lets the funnel count
// "sessions reaching step X" instead of raw event counts (a visitor
// retrying a step fires the event again, but it's the same session).
// ======================================================

export const ENERGY_ANALYTICS_EVENTS = [
  "energy_journey_started",
  "energy_intent_selected",
  "energy_fuel_selected",
  "energy_project_type_selected",
  "energy_questions_started",
  "energy_question_displayed",
  "energy_question_answered",
  "energy_questions_completed",
  "energy_summary_reviewed",
  "energy_solution_generated",
  "energy_solution_generation_failed",
  "energy_engineering_review_required",
  "energy_supplier_matching_requested",
  "energy_supplier_matching_completed",
  "energy_supplier_selected",
  "energy_rfq_submitted",
  "energy_ai_assistance_requested",
  "energy_handoff_requested",
  "energy_confirmation_displayed",
];

const analyticsEventSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, index: true },
    visitorId: { type: String, required: true, trim: true },
    sessionId: { type: String, required: true, trim: true },

    eventName: { type: String, required: true, enum: ENERGY_ANALYTICS_EVENTS },
    // Server-side timestamp always — never trusts a client-supplied time.
    eventTimestamp: { type: Date, required: true, default: Date.now },

    fuelKey: { type: String, default: null, lowercase: true },
    projectTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyProjectType", default: null },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyQuestion", default: null },
    solutionTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "SolutionTemplate", default: null },
    enquiryId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyEnquiry", default: null },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergySupplier", default: null },

    // Small, explicitly non-sensitive values only (e.g. {answeredWithUnknown:true},
    // {matchedCount:3}, {requiresEngineeringReview:true}) — never raw answer
    // values, filenames, or contact details. Kept Mixed but deliberately
    // thin; callers are responsible for only ever passing safe fields.
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// companyId+chatbotId+eventTimestamp: every module's primary date-range query.
analyticsEventSchema.index({ companyId: 1, chatbotId: 1, eventTimestamp: 1 });
// companyId+chatbotId+eventName+eventTimestamp: per-event-type aggregates (funnel steps, AI/handoff counts).
analyticsEventSchema.index({ companyId: 1, chatbotId: 1, eventName: 1, eventTimestamp: 1 });
// companyId+chatbotId+sessionId: funnel step de-duplication (distinct sessions reaching a step).
analyticsEventSchema.index({ companyId: 1, chatbotId: 1, sessionId: 1 });
// companyId+chatbotId+fuelKey+eventTimestamp: fuel-demand module. Sparse — most events have no fuelKey.
analyticsEventSchema.index({ companyId: 1, chatbotId: 1, fuelKey: 1, eventTimestamp: 1 }, { sparse: true });
// companyId+chatbotId+projectTypeId+eventTimestamp: project-type-demand module. Sparse for the same reason.
analyticsEventSchema.index({ companyId: 1, chatbotId: 1, projectTypeId: 1, eventTimestamp: 1 }, { sparse: true });

export default mongoose.model("EnergyAnalyticsEvent", analyticsEventSchema);
