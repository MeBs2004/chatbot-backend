import mongoose from "mongoose";

const companySchema = new mongoose.Schema(
  {
    // ==========================
    // Company
    // ==========================

    companyId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    domain: {
      type: String,
      required: true,
      trim: true,
    },

    website: {
      type: String,
      default: "",
      trim: true,
    },

    // ==========================
    // Branding
    // ==========================

    branding: {
      logo: { type: String, default: "" },
      favicon: { type: String, default: "" },
      launcherIcon: { type: String, default: "" },
      botAvatar: { type: String, default: "" },
    },

    // ==========================
    // Theme
    // ==========================

    theme: {
      primaryColor: { type: String, default: "#ff7a00" },
      secondaryColor: { type: String, default: "#222222" },
      accentColor: { type: String, default: "#ffffff" },
      backgroundColor: { type: String, default: "#ffffff" },
      textColor: { type: String, default: "#222222" },
      userBubbleColor: { type: String, default: "#ff7a00" },
      botBubbleColor: { type: String, default: "#f5f5f5" },
      headerGradientFrom: { type: String, default: "#ff7a00" },
      headerGradientTo: { type: String, default: "#ff9d3d" },

      borderRadius: {
        type: Number,
        default: 18,
      },

      fontFamily: {
        type: String,
        default: "Inter",
      },
    },

    // ==========================
    // Chatbot
    // ==========================

    chatbot: {
      chatbotName: { type: String, default: "AI Assistant" },
      botName: { type: String, default: "Assistant" },
      greetingMessage: { type: String, default: "" },

      placeholder: {
        type: String,
        default: "Ask me anything...",
      },

      poweredBy: {
        type: Boolean,
        default: true,
      },
    },

    // ==========================
    // Knowledge
    // ==========================

    knowledgeFile: {
      type: String,
      required: true,
      trim: true,
    },

    suggestions: {
      English: {
        type: [String],
        default: [],
      },

      Hindi: {
        type: [String],
        default: [],
      },
    },

    // ==========================
    // Contact
    // ==========================

    contact: {
      phone: { type: String, default: "" },
      whatsapp: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
    },

    // ==========================
    // AI
    // ==========================

    ai: {
      provider: {
        type: String,
        enum: ["groq", "gemini", "openai", "ollama"],
        default: "groq",
      },

      language: {
        type: String,
        default: "English",
      },

      model: {
        type: String,
        default: "openai/gpt-oss-20b",
      },

      temperature: {
        type: Number,
        default: 0.3,
      },

      maxTokens: {
        type: Number,
        default: 500,
      },

      systemPrompt: {
        type: String,
        default: "",
      },
    },

    // ==========================
    // Webhook
    // ==========================

    webhook: {
      enabled: {
        type: Boolean,
        default: false,
      },

      url: {
        type: String,
        default: "",
      },

      secret: {
        type: String,
        default: "",
      },
    },

    // ==========================
    // Status
    // ==========================

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Company", companySchema);