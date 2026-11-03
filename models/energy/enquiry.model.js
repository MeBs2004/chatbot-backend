import mongoose from "mongoose";

// ======================================================
// ENERGY — RFQ / ENQUIRY (Phase 4, Part 5/6/7). Created either by a
// real visitor through the public widget API (Phase 5 will be what
// actually drives a visitor to that endpoint from a live
// conversation — this model and its API are real today, just not yet
// invoked by the chat flow) or, for now, by an admin testing the
// flow. Snapshots the required equipment and generated output at
// creation time, same reasoning as the (removed) Energy quote
// feature's line-item snapshots: a later catalogue/template change
// must never rewrite an enquiry someone already submitted.
// ======================================================

export const ENQUIRY_STATUSES = ["new", "under_review", "supplier_contacted", "quotation_in_progress", "quotation_sent", "won", "lost", "closed"];

const requiredEquipmentSchema = new mongoose.Schema(
  { equipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyEquipment", default: null }, name: String, qty: Number, unit: String, mandatory: Boolean },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  { status: { type: String, enum: ENQUIRY_STATUSES, required: true }, changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null }, changedAt: { type: Date, default: Date.now }, note: { type: String, default: "" } },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  { authorId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true }, text: { type: String, required: true }, createdAt: { type: Date, default: Date.now } },
  { _id: false }
);

// Phase 5.1 — a reference + metadata snapshot of an EnergyJourneyFile,
// not the binary itself (that stays in EnergyJourneyFile; see its
// model comment). Snapshotting name/size/contentType here means a
// later deletion of the underlying file record can't silently corrupt
// what the enquiry says it received.
const uploadedFileRefSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyJourneyFile", required: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyQuestion", default: null },
    filename: { type: String, default: "" },
    contentType: { type: String, default: "" },
    size: { type: Number, default: null },
  },
  { _id: false }
);

// Phase 5.1 — structured location, additive alongside the original
// free-text `projectLocation` (kept verbatim below for backward
// compatibility and as the "what the visitor actually typed" record).
// All fields optional: a visitor who only gives a city still matches
// suppliers fine, and wildcard regions ("Pan India"/"All"/"Nationwide")
// never required any of this in the first place.
const structuredLocationSchema = new mongoose.Schema(
  {
    country: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const enquirySchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, index: true },

    referenceId: { type: String, required: true, unique: true },

    customer: {
      name: { type: String, required: true, trim: true },
      companyName: { type: String, default: "", trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, default: "", trim: true },
    },
    projectLocation: { type: String, default: "" },
    location: { type: structuredLocationSchema, default: () => ({}) },

    uploadedFiles: { type: [uploadedFileRefSchema], default: [] },

    // Phase 5.2, Task 7 — idempotent RFQ submission. `visitorId` is
    // stored (previously only used transiently to validate uploaded
    // files) so the idempotency key is scoped per-visitor at the
    // database level: a different visitor reusing the same key can
    // never match this document, so it can never be handed another
    // visitor's enquiry by accident. `idempotencyKey` is null for any
    // enquiry submitted without one (every pre-Phase-5.2 record, and
    // any client that doesn't send one) — the partial unique index
    // below only applies where it's an actual string.
    visitorId: { type: String, default: "", trim: true },
    idempotencyKey: { type: String, default: null },

    fuelKey: { type: String, required: true, lowercase: true },
    projectTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyProjectType", default: null },
    solutionTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "SolutionTemplate", default: null },
    outputSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    requiredEquipment: { type: [requiredEquipmentSchema], default: [] },

    selectedSupplierIds: { type: [mongoose.Schema.Types.ObjectId], ref: "EnergySupplier", default: [] },

    consent: {
      given: { type: Boolean, default: false },
      givenAt: { type: Date, default: null },
      supplierIdsCovered: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      consentText: { type: String, default: "" },
    },

    purchaseTimeline: { type: String, default: "" },
    additionalRequirements: { type: String, default: "" },
    source: { type: String, default: "admin_test" }, // "widget" once Phase 5 wires a real conversation to this

    status: { type: String, enum: ENQUIRY_STATUSES, default: "new" },
    statusHistory: { type: [statusHistorySchema], default: [] },
    internalNotes: { type: [noteSchema], default: [] },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
  },
  { timestamps: true }
);

enquirySchema.index({ companyId: 1, chatbotId: 1, status: 1, createdAt: -1 });
// Task 7 — DB-level enforcement, not just an app-level check: two
// concurrent requests with the same key for the same visitor/chatbot
// can never both succeed in creating a document (the loser gets a
// duplicate-key error, handled in the controller by returning the
// winner's enquiry instead of a 500).
enquirySchema.index(
  { companyId: 1, chatbotId: 1, visitorId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

export default mongoose.model("EnergyEnquiry", enquirySchema);
