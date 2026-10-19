import mongoose from "mongoose";

// ======================================================
// CHATBOT ACCESS
// Join between AdminUser and Chatbot: bot-level permissions,
// finer-grained than UserCompanyAccess — a user can have
// company access without access to every bot in it.
// ======================================================

const chatbotAccessSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },

    chatbotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chatbot",
      required: true,
      index: true,
    },

    // Denormalized from the Chatbot so "which chatbots in company X is
    // this user assigned to" is a single indexed query. Backfilled by
    // scripts/migrateChatbotScopedAccess.mjs.
    companyId: {
      type: String,
      trim: true,
      default: null,
    },

    permissions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

chatbotAccessSchema.index({ userId: 1, chatbotId: 1 }, { unique: true });
chatbotAccessSchema.index({ userId: 1, companyId: 1 });

export default mongoose.model("ChatbotAccess", chatbotAccessSchema);
