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

export default mongoose.model("ChatbotAccess", chatbotAccessSchema);
