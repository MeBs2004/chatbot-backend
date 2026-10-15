import mongoose from "mongoose";
import { DEFAULT_CHATBOT_CONFIG, ALLOWED_FORM_FIELDS, ALLOWED_CTA_TYPES, MAX_CTAS, MAX_SUGGESTIONS } from "../config/chatbotConfig.js";

// ======================================================
// CHATBOT
// Models a single bot belonging to a Company. Today each
// Company has exactly one implicit bot (Company.chatbot /
// Company.ai). This collection introduces the 1:many
// relationship the admin panel needs without touching how
// the live message pipeline reads Company.ai — it keeps
// reading from Company until an explicit, separate
// migration copies existing bots into this collection.
// ======================================================

const HEX_VALIDATOR = {
  validator: (v) => !v || /^#([0-9A-Fa-f]{3}){1,2}$/.test(v),
  message: (props) => `${props.value} is not a valid hex color.`,
};

// Studio configuration (Phase 4). Not yet read by the live public
// widget — see config/chatbotConfig.js for the full explanation and
// the shared defaults this schema mirrors. Existing Chatbot
// documents created before this field existed simply have no
// `config` in Mongo; reads explicitly merge in these same defaults
// (see mergeChatbotConfig) since `.lean()` reads don't apply
// Mongoose defaults to already-stored documents.
const chatbotConfigSchema = new mongoose.Schema(
  {
    launcher: {
      enabled: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.enabled },
      position: {
        type: String,
        enum: ["bottom-right", "bottom-left"],
        default: DEFAULT_CHATBOT_CONFIG.launcher.position,
      },
      shape: {
        type: String,
        enum: ["circle", "rounded-square"],
        default: DEFAULT_CHATBOT_CONFIG.launcher.shape,
      },
      color: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.color, validate: HEX_VALIDATOR },
      gradient: {
        enabled: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.gradient.enabled },
        from: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.gradient.from, validate: HEX_VALIDATOR },
        to: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.gradient.to, validate: HEX_VALIDATOR },
      },
      icon: {
        type: String,
        enum: ["default", "chat", "logo"],
        default: DEFAULT_CHATBOT_CONFIG.launcher.icon,
      },
      size: {
        type: String,
        enum: ["small", "medium", "large"],
        default: DEFAULT_CHATBOT_CONFIG.launcher.size,
      },
      animation: {
        type: String,
        enum: ["none", "float", "pulse", "glow"],
        default: DEFAULT_CHATBOT_CONFIG.launcher.animation,
      },
      showGreeting: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.showGreeting },
      greetingTitle: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.greetingTitle, maxlength: 60 },
      greetingMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.greetingMessage, maxlength: 160 },
      showNotificationBadge: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.showNotificationBadge },
      showOnMobile: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.showOnMobile },
    },
    chatWindow: {
      theme: { type: String, enum: ["light", "dark"], default: DEFAULT_CHATBOT_CONFIG.chatWindow.theme },
      primaryColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.primaryColor, validate: HEX_VALIDATOR },
      backgroundColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.backgroundColor, validate: HEX_VALIDATOR },
      textColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.textColor, validate: HEX_VALIDATOR },
      size: { type: String, enum: ["small", "medium", "large"], default: DEFAULT_CHATBOT_CONFIG.chatWindow.size },
      borderRadius: {
        type: String,
        enum: ["small", "medium", "large"],
        default: DEFAULT_CHATBOT_CONFIG.chatWindow.borderRadius,
      },
      botName: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.botName, maxlength: 60, trim: true },
      companyName: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.companyName, maxlength: 60, trim: true },
      botAvatar: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.botAvatar, trim: true },
      showBranding: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showBranding },
      welcomeMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.welcomeMessage, maxlength: 300 },
    },
    behavior: {
      autoOpen: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.autoOpen },
      autoOpenDelay: { type: Number, default: DEFAULT_CHATBOT_CONFIG.behavior.autoOpenDelay, min: 0, max: 60 },
      sound: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.sound },
      typingIndicator: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.typingIndicator },
      offlineMode: {
        type: String,
        enum: ["default", "offline-message"],
        default: DEFAULT_CHATBOT_CONFIG.behavior.offlineMode,
      },
    },
    forms: {
      enabled: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.forms.enabled },
      style: { type: String, enum: ["classic", "conversational"], default: DEFAULT_CHATBOT_CONFIG.forms.style },
      fields: {
        type: [{ type: String, enum: ALLOWED_FORM_FIELDS }],
        default: DEFAULT_CHATBOT_CONFIG.forms.fields,
      },
    },
    language: {
      defaultLanguage: {
        type: String,
        enum: ["English", "Hindi"],
        default: DEFAULT_CHATBOT_CONFIG.language.defaultLanguage,
      },
    },
    appearance: {
      font: { type: String, enum: ["system", "inter"], default: DEFAULT_CHATBOT_CONFIG.appearance.font },
      customCss: { type: String, default: DEFAULT_CHATBOT_CONFIG.appearance.customCss, maxlength: 4000 },
    },
    // CTA quick-action buttons (Call/WhatsApp/Email/custom link) —
    // see config/chatbotConfig.js. Array length capped at the schema
    // level so an admin can't balloon the document with hundreds of
    // buttons; the public widget only ever renders the enabled ones.
    ctas: {
      type: [
        {
          type: { type: String, enum: ALLOWED_CTA_TYPES, required: true },
          enabled: { type: Boolean, default: true },
          label: { type: String, trim: true, maxlength: 40, default: "" },
          value: { type: String, trim: true, maxlength: 300, default: "" },
          _id: false,
        },
      ],
      default: DEFAULT_CHATBOT_CONFIG.ctas,
      validate: {
        validator: (v) => v.length <= MAX_CTAS,
        message: `A chatbot can have at most ${MAX_CTAS} CTA buttons.`,
      },
    },
    // Per-chatbot suggestion chips — empty means "fall back to the
    // existing company-wide suggestions endpoint" (NuformlyWidget.jsx).
    suggestions: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: DEFAULT_CHATBOT_CONFIG.suggestions,
      validate: {
        validator: (v) => v.length <= MAX_SUGGESTIONS,
        message: `A chatbot can have at most ${MAX_SUGGESTIONS} suggestions.`,
      },
    },
  },
  { _id: false }
);

const chatbotSchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["LIVE", "DRAFT", "PAUSED", "OFFLINE"],
      default: "DRAFT",
      index: true,
    },

    model: {
      type: String,
      default: "openai/gpt-oss-20b",
    },

    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Studio configuration (Phase 4) — see chatbotConfigSchema above.
    config: {
      type: chatbotConfigSchema,
      default: () => ({}),
    },

    // Website domain allowlist (Production Installation phase) —
    // empty array means unrestricted, the exact behavior every
    // chatbot already had before this field existed. Enforced
    // server-side on the public widget-config/messaging/calculator
    // endpoints via services/domainAllowlist.service.js — never a
    // frontend-only check.
    allowedDomains: {
      type: [{ type: String, trim: true, lowercase: true }],
      default: [],
    },

    // Sector template (Shared Engine phase) — selected once at
    // creation in the Create Chatbot wizard. Purely a configuration
    // identifier: the shared messaging pipeline (groq.service.js) and
    // the shared public widget both read this to select sector-
    // specific prompt guidance / calculator UI, but every template
    // flows through the exact same engine and schema — see
    // services/sectors/. "general" (today's existing behavior) is
    // the default so every pre-existing chatbot is unaffected.
    template: {
      type: String,
      enum: ["general", "energy", "education", "digital_marketing"],
      default: "general",
      index: true,
    },

    // Phase 5 rollout control. Every chatbot — including both real
    // production ones — defaults to "legacy" (today's hardcoded
    // Bot.jsx/OyaBot.jsx rendering, completely untouched). Only a
    // chatbot explicitly flipped to "v1" by an admin uses the new
    // config-driven public widget engine. This field is only ever
    // set via the authenticated admin API — the public widget has
    // no way to set or influence it.
    widgetEngineVersion: {
      type: String,
      enum: ["legacy", "v1"],
      default: "legacy",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },

    // Soft delete — set instead of removing the document so
    // historical Conversations/Visitors/analytics that reference this
    // chatbotId keep resolving correctly. `null` = not deleted.
    // Deleted chatbots are filtered out of every list/detail read
    // (see chatbot.controller.js) but the doc itself is never
    // destroyed.
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

chatbotSchema.index({ companyId: 1, name: 1 }, { unique: true });

export default mongoose.model("Chatbot", chatbotSchema);
