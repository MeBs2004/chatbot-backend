import mongoose from "mongoose";

// ======================================================
// CHATBOT FLOW (Phase 6)
// A separate collection rather than an embedded field on Chatbot
// because a flow needs real version history (rollback requires
// keeping every previously-published version recoverable, not just
// the current one) — embedding would mean either losing history on
// every publish or growing one Chatbot document without bound.
// Each publish creates a new, immutable version document; only the
// `status` of a version ever changes after creation (DRAFT is
// mutated in place while being edited, PUBLISHED/ARCHIVED are not).
// ======================================================

const positionSchema = new mongoose.Schema(
  { x: { type: Number, default: 0 }, y: { type: Number, default: 0 } },
  { _id: false }
);

const nodeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: [
        "start",
        "message",
        "question",
        "buttons",
        "aiResponse",
        "knowledgeBase",
        "condition",
        "webhook",
        "humanHandoff",
        "delay",
        "end",
      ],
    },
    position: { type: positionSchema, default: () => ({}) },
    // Node-type-specific config. Structural shape is enforced by
    // flow.validator.js at save/publish time, not by the schema —
    // the node types here are still evolving (Phase 6 is the first
    // pass), so Mixed keeps this additive as new fields are added
    // without a migration, matching Chatbot.settings' own precedent.
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const edgeSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
    sourceHandle: { type: String, default: null },
    targetHandle: { type: String, default: null },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const chatbotFlowSchema = new mongoose.Schema(
  {
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      required: true,
      index: true,
    },

    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // Immutable identifier for this version, scoped per chatbot —
    // 1, 2, 3... incremented only on publish (a draft being edited
    // repeatedly does not consume a version number).
    version: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      default: "DRAFT",
      index: true,
    },

    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
    startNodeId: { type: String, default: null },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one DRAFT and one PUBLISHED version per chatbot — ARCHIVED
// is excluded from this constraint so full version history can
// accumulate freely.
chatbotFlowSchema.index(
  { chatbotId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["DRAFT", "PUBLISHED"] } },
  }
);

chatbotFlowSchema.index({ chatbotId: 1, version: 1 }, { unique: true });

export default mongoose.model("ChatbotFlow", chatbotFlowSchema);
