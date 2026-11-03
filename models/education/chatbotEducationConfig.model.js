import mongoose from "mongoose";

// ======================================================
// Per-chatbot Education Configuration — which FAQ categories this
// specific chatbot shows, and which of that company's FAQs and courses
// are switched on. Mirrors ChatbotEnergyConfig's shape and draft/publish
// lifecycle exactly.
// ======================================================

const chatbotEducationConfigSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, unique: true, index: true },

    enabledCategoryKeys: { type: [String], default: [] },
    enabledFAQIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    enabledCourseIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    counsellingCtaLabel: { type: String, default: "Get Free Counselling" },

    status: { type: String, enum: ["DRAFT", "PUBLISHED"], default: "DRAFT" },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ChatbotEducationConfig", chatbotEducationConfigSchema);
