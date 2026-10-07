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

    // Historical/display identifier only — e.g. "knowledge.txt" shown
    // in the admin UI. NOT the storage location anymore: Render's web
    // service filesystem is ephemeral (reset on every deploy and every
    // idle-spindown restart), so a local file can never be the
    // authoritative source for a production SaaS. The real content now
    // lives in `knowledgeContent` below, which survives restarts
    // because it's in MongoDB. See services/knowledge.service.js.
    knowledgeFile: {
      type: String,
      required: true,
      trim: true,
    },

    knowledgeContent: {
      type: String,
      default: "",
    },

    knowledgeUpdatedAt: {
      type: Date,
      default: null,
    },

    // Set once, the first time services/knowledge.migration.js
    // successfully rescues (or confirms there's nothing to rescue
    // from) this company's old disk file. Gates eligibility instead
    // of "is knowledgeContent currently empty" — an admin
    // deliberately clearing their knowledge base to blank must never
    // be silently undone by the frozen, no-longer-written disk file
    // reappearing on the next restart.
    knowledgeMigratedAt: {
      type: Date,
      default: null,
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

      // Phase 7 — additive. A pre-existing Company document simply
      // lacks these fields (`.lean()` reads never backfill Mongoose
      // defaults onto an already-stored document, same gotcha as
      // Chatbot.config in Phase 4) — services/groq.service.js treats
      // an absent `responseStyle`/`fallbackMessage` as "use the
      // original, unconditional prompt text", so an existing company
      // that has never opened AI Settings sees zero behavior change.
      responseStyle: {
        length: {
          type: String,
          enum: ["concise", "balanced", "detailed"],
          default: "balanced",
        },
        tone: {
          type: String,
          enum: ["professional", "friendly", "formal", "custom"],
          default: "professional",
        },
        customTone: { type: String, default: "", maxlength: 100 },
        useEmojis: { type: Boolean, default: true },
        useMarkdown: { type: Boolean, default: true },
      },

      fallbackMessage: {
        type: String,
        default: "",
        maxlength: 500,
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

      // Phase 10: replaces the old plaintext `secret` field (no real
      // company ever had one set — confirmed live before this
      // change, so this is a clean cut, not a migration). Holds the
      // output of utils/encryption.js's encryptSecret() — never the
      // raw secret. Only ever decrypted server-side, in
      // webhookDispatch.service.js, to sign outbound requests; never
      // returned by any API response (see company.controller.js,
      // which projects `webhook.hasSecret` instead).
      secretEncrypted: {
        type: String,
        default: null,
      },

      // Phase 10: real, truthful health indicators (Section 32) —
      // only ever set by an actual test/delivery attempt, never
      // defaulted to a "healthy"-looking value.
      lastTestedAt: { type: Date, default: null },
      lastConnectedAt: { type: Date, default: null },
      lastErrorAt: { type: Date, default: null },
      lastError: { type: String, default: null },
    },

    // ==========================
    // Status
    // ==========================

    isActive: {
      type: Boolean,
      default: true,
    },

    // Richer status used by the admin panel; isActive above
    // remains the source of truth the public tenant middleware
    // checks, kept in sync whenever status changes.
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED", "TRIAL"],
      default: "ACTIVE",
      index: true,
    },

    // ==========================
    // Plan / Billing (future)
    // ==========================

    plan: {
      type: String,
      default: "",
      trim: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    // ==========================
    // Developer Platform (Phase 12)
    // ==========================

    developer: {
      // Requests/minute per API key for this company. In-memory,
      // single-process enforcement (see
      // middleware/apiKeyAuth.middleware.js) — bounded so a company
      // admin can't accidentally set something that defeats the
      // point of having a limit, or that's unenforceable.
      rateLimitPerMinute: {
        type: Number,
        default: 100,
        min: 10,
        max: 1000,
      },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Company", companySchema);