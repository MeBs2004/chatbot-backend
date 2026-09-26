import mongoose from "mongoose";

const botSchema = new mongoose.Schema(
  {
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

    text: {
      type: String,
      required: true,
      trim: true,
    },

    // "handoff" marks the automatic human-handoff reply (see
    // services/handoff.service.js); "system" marks an automated
    // notice such as a paused/offline maintenance message (see
    // services/chatbotStatus.service.js); "flow" marks a reply
    // produced by the Phase 6 flow engine (see services/flow/);
    // "agent" marks a real human reply sent from the Phase 8
    // Conversations inbox — so admin analytics can derive a real
    // human-handoff rate without inventing data.
    type: {
      type: String,
      enum: ["ai", "handoff", "system", "flow", "agent"],
      default: "ai",
    },

    // Only set when type === "agent" — who actually sent it.
    // Denormalized `agentName` avoids an AdminUser join just to
    // render the thread, and stays correct even if that admin's
    // account is later deleted.
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
    agentName: { type: String, default: "" },

    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

botSchema.index({ companyId: 1, visitorId: 1 });

// Phase 9 — supports analytics range queries (message trends,
// AI-vs-human breakdown by `type`) that previously ran an unindexed
// collection scan on every request.
botSchema.index({ companyId: 1, createdAt: 1 });
botSchema.index({ companyId: 1, type: 1, createdAt: 1 });

export default mongoose.model("Bot", botSchema);