import mongoose from "mongoose";

// ======================================================
// Per-chatbot Digital Marketing Configuration — business profile,
// which services/AI capabilities this chatbot offers, and lead
// collection settings. Mirrors ChatbotEducationConfig's shape and
// draft/publish lifecycle. Personality/tone/welcome-message/widget
// styling are deliberately NOT duplicated here — those already live
// on Company.ai and Chatbot.config and are reused as-is.
// ======================================================

const businessProfileSchema = new mongoose.Schema(
  {
    businessName: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    businessType: { type: String, default: "", trim: true },
    location: { type: String, default: "", trim: true },
    targetAudience: { type: String, default: "", trim: true },
    industriesServed: { type: String, default: "", trim: true },
    businessGoals: { type: String, default: "", trim: true },
    contactInfo: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const leadSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    requiredFields: {
      type: [String],
      default: ["name", "phone"],
    },
    qualificationQuestions: { type: [String], default: [] },
    humanHandoffEnabled: { type: Boolean, default: true },
    ctaLabel: { type: String, default: "Request a Quote" },
  },
  { _id: false }
);

const chatbotMarketingConfigSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, unique: true, index: true },

    businessProfile: { type: businessProfileSchema, default: () => ({}) },
    enabledServiceKeys: { type: [String], default: [] },
    enabledCapabilityKeys: { type: [String], default: [] },
    leadSettings: { type: leadSettingsSchema, default: () => ({}) },

    status: { type: String, enum: ["DRAFT", "PUBLISHED"], default: "DRAFT" },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ChatbotMarketingConfig", chatbotMarketingConfigSchema);
