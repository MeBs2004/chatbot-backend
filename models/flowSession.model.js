import mongoose from "mongoose";

// ======================================================
// FLOW SESSION (Phase 6)
// Server-side state for a visitor mid-flow: which node they're at
// and what variables have been collected so far. Not merged into
// Visitor (analytics/lead profile, one doc per companyId+visitorId
// for the lifetime of that visitor) because flow state is tied to a
// specific flow VERSION and is naturally reset whenever a chatbot
// publishes a new flow — mixing the two would mean either resetting
// unrelated analytics on every publish, or leaking stale node/
// variable state across incompatible flow versions.
// ======================================================

const flowSessionSchema = new mongoose.Schema(
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

    visitorId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    flowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatbotFlow",
      required: true,
    },

    flowVersion: {
      type: Number,
      required: true,
    },

    currentNodeId: {
      type: String,
      default: null,
    },

    // Set when currentNodeId is an interactive node (question/buttons)
    // waiting on the visitor's next message as its answer.
    awaitingInput: {
      type: Boolean,
      default: false,
    },

    // Flat namespaced key -> string value store (see flow.executor.js
    // for the visitor.*/flow.* namespace rules). Kept as Mixed since
    // user-defined `flow.*` variable names are admin-configured, not
    // fixed at schema-design time.
    variables: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // HANDED_OFF: the flow reached a Human Handoff node. There is no
    // live-agent takeover system yet (see handoff.service.js, which
    // is keyword-detection only) — this status exists so a future
    // agent inbox has something real to consume. Until that exists,
    // reaching this status simply stops routing this visitor's
    // future turns through the flow engine (see flow.resolver.js
    // callers), falling back to the existing assistant.
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "ERROR", "HANDED_OFF"],
      default: "ACTIVE",
      index: true,
    },

    // Total nodes executed across this session's lifetime — one of
    // the runtime safety limits (see flow.executor.js MAX_TOTAL_STEPS).
    totalSteps: {
      type: Number,
      default: 0,
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One live session per visitor per chatbot.
flowSessionSchema.index({ chatbotId: 1, visitorId: 1 }, { unique: true });

export default mongoose.model("FlowSession", flowSessionSchema);
