import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
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

    // Which chatbot this record belongs to. `null` for legacy rows
    // written before chatbot attribution existed (and for companies
    // whose chatbot couldn't be resolved) — a chatbot-scoped admin
    // never sees a null-attributed row (see access.service.js).
    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      default: null,
    },

    sender: {
      type: String,
      enum: ["user"],
      default: "user",
    },

    text: {
      type: String,
      required: true,
      trim: true,
    },

    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Every query in the codebase filters by exactly this pair
// (companyId + visitorId) — Phase 8 increases thread-read volume
// (Conversations inbox), so this compound index is added now.
// Purely additive: an index changes nothing about existing data or
// query results, only lookup speed.
userSchema.index({ companyId: 1, visitorId: 1 });

// Phase 9 — supports analytics range queries ($match on createdAt,
// scoped to companyId) that previously ran an unindexed collection
// scan on every request.
userSchema.index({ companyId: 1, createdAt: 1 });

// Chatbot-scoped analytics (a user assigned to specific chatbots).
userSchema.index({ companyId: 1, chatbotId: 1, createdAt: 1 });

export default mongoose.model("User", userSchema);