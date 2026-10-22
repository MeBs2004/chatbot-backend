import mongoose from "mongoose";
import {
  DEFAULT_CHATBOT_CONFIG,
  ALLOWED_FORM_FIELDS,
  ALLOWED_CTA_TYPES,
  MAX_CTAS,
  MAX_SUGGESTIONS,
  LAUNCHER_ICONS,
  LAUNCHER_SHAPES,
  LAUNCHER_ANIMATIONS,
  LAUNCHER_ENTRANCES,
  LAUNCHER_HOVERS,
  BUBBLE_ANIMATIONS,
  TYPING_STYLES,
  AUTO_OPEN_ANIMATIONS,
  SIZE_FIELDS,
  BUBBLE_EFFECTS,
  BUBBLE_ORDERS,
  AVATAR_SHAPES,
  STATUS_STYLES,
  SEND_SHAPES,
  AVATAR_ALIGNS,
  HEADER_ANIMATIONS,
  AVATAR_ANIMATIONS,
  SEND_ANIMATIONS,
  SUGGESTION_ANIMATIONS,
  LAUNCHER_SHADOWS,
  SHADOWS,
  BUBBLE_STYLES,
  MESSAGE_ANIMATIONS,
  WINDOW_ANIMATIONS,
  CHAT_BACKGROUNDS,
  SUGGESTION_STYLES,
  FONTS,
  FONT_SIZES,
  LISTEN_PLACEMENTS,
  ATTACH_ICONS,
} from "../config/chatbotConfig.js";

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

export const MAX_TEASER_MESSAGES = 12;
export const MAX_TEASER_LENGTH = 80;

// widget.js renders these on the customer's own page, outside the
// iframe, so they're bounded here rather than trusted from the Studio.
const TEASER_VALIDATOR = {
  validator: (list) =>
    Array.isArray(list) &&
    list.length <= MAX_TEASER_MESSAGES &&
    list.every((m) => typeof m === "string" && m.length <= MAX_TEASER_LENGTH),
  message: `Up to ${MAX_TEASER_MESSAGES} teaser messages, each at most ${MAX_TEASER_LENGTH} characters.`,
};

// An https:// image URL, or a small data: image produced by the
// Studio's uploader (resized client-side, so it stays well under the cap).
const MAX_IMAGE_DATA_URL = 60000;
const IMAGE_SRC_VALIDATOR = {
  validator: (v) =>
    !v ||
    (v.length <= 500 && /^https:\/\/[^\s"'<>]+$/i.test(v)) ||
    (v.length <= MAX_IMAGE_DATA_URL && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v)),
  message: "Images must be an https:// URL or an uploaded image under ~45 KB.",
};
const AVATAR_URL_VALIDATOR = IMAGE_SRC_VALIDATOR;

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
        enum: LAUNCHER_SHAPES,
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
        enum: LAUNCHER_ICONS,
        default: DEFAULT_CHATBOT_CONFIG.launcher.icon,
      },
      logoUrl: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.logoUrl, trim: true, validate: IMAGE_SRC_VALIDATOR },
      iconColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.iconColor, validate: HEX_VALIDATOR },
      style: { type: String, enum: ["icon", "icon-label"], default: DEFAULT_CHATBOT_CONFIG.launcher.style },
      labelText: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.labelText, maxlength: 30, trim: true },
      entrance: { type: String, enum: LAUNCHER_ENTRANCES, default: DEFAULT_CHATBOT_CONFIG.launcher.entrance },
      hoverEffect: { type: String, enum: LAUNCHER_HOVERS, default: DEFAULT_CHATBOT_CONFIG.launcher.hoverEffect },
      bubbleAnimation: { type: String, enum: BUBBLE_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleAnimation },
      bubbleEffect: { type: String, enum: BUBBLE_EFFECTS, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleEffect },
      bubbleOrder: { type: String, enum: BUBBLE_ORDERS, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleOrder },
      bubbleAvatar: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleAvatar },
      bubbleTail: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleTail },
      bubbleHoldSeconds: { type: Number, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleHoldSeconds, min: 1, max: 15 },
      bubblePauseSeconds: { type: Number, default: DEFAULT_CHATBOT_CONFIG.launcher.bubblePauseSeconds, min: 2, max: 60 },
      logoOnly: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.logoOnly },
      badgePulse: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.badgePulse },
      badgeWithBubble: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.badgeWithBubble },
      shadow: { type: String, enum: LAUNCHER_SHADOWS, default: DEFAULT_CHATBOT_CONFIG.launcher.shadow },
      badgeColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.badgeColor, validate: HEX_VALIDATOR },
      effectColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.effectColor, validate: HEX_VALIDATOR },
      sparkleColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.sparkleColor, validate: HEX_VALIDATOR },
      bubbleBgColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleBgColor, validate: HEX_VALIDATOR },
      bubbleBorderColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleBorderColor, validate: HEX_VALIDATOR },
      bubbleTextColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleTextColor, validate: HEX_VALIDATOR },
      bubbleDotColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.bubbleDotColor, validate: HEX_VALIDATOR },
      size: {
        type: String,
        enum: ["small", "medium", "large"],
        default: DEFAULT_CHATBOT_CONFIG.launcher.size,
      },
      animation: {
        type: String,
        enum: LAUNCHER_ANIMATIONS,
        default: DEFAULT_CHATBOT_CONFIG.launcher.animation,
      },
      showGreeting: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.showGreeting },
      greetingTitle: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.greetingTitle, maxlength: 60 },
      greetingMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.launcher.greetingMessage, maxlength: 160 },
      showNotificationBadge: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.showNotificationBadge },
      showOnMobile: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.launcher.showOnMobile },
      // Mixed, not [String]: Mongoose would cast { text: "hi" } to a
      // string instead of letting the validator reject it.
      teaserMessages: {
        type: [mongoose.Schema.Types.Mixed],
        default: () => [...DEFAULT_CHATBOT_CONFIG.launcher.teaserMessages],
        validate: TEASER_VALIDATOR,
      },
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
      botAvatar: {
        type: String,
        default: DEFAULT_CHATBOT_CONFIG.chatWindow.botAvatar,
        trim: true,
        validate: AVATAR_URL_VALIDATOR,
      },
      showBranding: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showBranding },
      welcomeMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.welcomeMessage, maxlength: 300 },
      headerGradient: {
        enabled: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerGradient.enabled },
        from: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerGradient.from, validate: HEX_VALIDATOR },
        to: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerGradient.to, validate: HEX_VALIDATOR },
      },
      headerTextColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerTextColor, validate: HEX_VALIDATOR },
      userBubbleColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.userBubbleColor, validate: HEX_VALIDATOR },
      userTextColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.userTextColor, validate: HEX_VALIDATOR },
      botBubbleColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.botBubbleColor, validate: HEX_VALIDATOR },
      botTextColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.botTextColor, validate: HEX_VALIDATOR },
      sendButtonColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.sendButtonColor, validate: HEX_VALIDATOR },
      inputPlaceholder: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.inputPlaceholder, maxlength: 80 },
      subtitle: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.subtitle, maxlength: 60, trim: true },
      showStatusDot: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showStatusDot },
      bubbleStyle: { type: String, enum: BUBBLE_STYLES, default: DEFAULT_CHATBOT_CONFIG.chatWindow.bubbleStyle },
      showMessageAvatars: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showMessageAvatars },
      messageAnimation: { type: String, enum: MESSAGE_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.messageAnimation },
      windowAnimation: { type: String, enum: WINDOW_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.windowAnimation },
      typingStyle: { type: String, enum: TYPING_STYLES, default: DEFAULT_CHATBOT_CONFIG.chatWindow.typingStyle },
      headerAnimation: { type: String, enum: HEADER_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerAnimation },
      avatarAnimation: { type: String, enum: AVATAR_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.avatarAnimation },
      sendAnimation: { type: String, enum: SEND_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.sendAnimation },
      suggestionAnimation: { type: String, enum: SUGGESTION_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.suggestionAnimation },
      shadow: { type: String, enum: SHADOWS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.shadow },
      chatBackground: { type: String, enum: CHAT_BACKGROUNDS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.chatBackground },
      suggestionStyle: { type: String, enum: SUGGESTION_STYLES, default: DEFAULT_CHATBOT_CONFIG.chatWindow.suggestionStyle },
      footerText: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.footerText, maxlength: 80, trim: true },
      headerSubtitleColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerSubtitleColor, validate: HEX_VALIDATOR },
      avatarShape: { type: String, enum: AVATAR_SHAPES, default: DEFAULT_CHATBOT_CONFIG.chatWindow.avatarShape },
      statusStyle: { type: String, enum: STATUS_STYLES, default: DEFAULT_CHATBOT_CONFIG.chatWindow.statusStyle },
      statusDotColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.statusDotColor, validate: HEX_VALIDATOR },
      botBubbleBorderColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.botBubbleBorderColor, validate: HEX_VALIDATOR },
      footerBackground: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.footerBackground, validate: HEX_VALIDATOR },
      sendButtonShape: { type: String, enum: SEND_SHAPES, default: DEFAULT_CHATBOT_CONFIG.chatWindow.sendButtonShape },
      suggestionBgColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.suggestionBgColor, validate: HEX_VALIDATOR },
      suggestionTextColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.suggestionTextColor, validate: HEX_VALIDATOR },
      suggestionBorderColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.suggestionBorderColor, validate: HEX_VALIDATOR },
      brandName: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.brandName, maxlength: 40, trim: true },
      brandUrl: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.brandUrl, maxlength: 60, trim: true },
      brandColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.brandColor, validate: HEX_VALIDATOR },
      borderColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.borderColor, validate: HEX_VALIDATOR },
      dividerColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.dividerColor, validate: HEX_VALIDATOR },
      welcomeBgColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.welcomeBgColor, validate: HEX_VALIDATOR },
      welcomeBorderColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.welcomeBorderColor, validate: HEX_VALIDATOR },
      placeholderColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.placeholderColor, validate: HEX_VALIDATOR },
      avatarAlign: { type: String, enum: AVATAR_ALIGNS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.avatarAlign },
      headerLogo: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.headerLogo, trim: true, validate: IMAGE_SRC_VALIDATOR },
      listenPlacement: { type: String, enum: LISTEN_PLACEMENTS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.listenPlacement },
      typingColor1: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.typingColor1, validate: HEX_VALIDATOR },
      typingColor2: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.typingColor2, validate: HEX_VALIDATOR },
      typingColor3: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.typingColor3, validate: HEX_VALIDATOR },
      typingAvatar: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.typingAvatar },
      attachIcon: { type: String, enum: ATTACH_ICONS, default: DEFAULT_CHATBOT_CONFIG.chatWindow.attachIcon },
      ctaTextColor: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.ctaTextColor, validate: HEX_VALIDATOR },
      showClearButton: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showClearButton },
      showLanguageSelector: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showLanguageSelector },
      showCloseButton: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showCloseButton },
      showHeaderAvatar: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showHeaderAvatar },
      showWelcome: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showWelcome },
      showSuggestions: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showSuggestions },
      showCtas: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showCtas },
      showScrollButton: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.chatWindow.showScrollButton },
      listenLabel: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.listenLabel, maxlength: 30, trim: true },
      stopLabel: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.stopLabel, maxlength: 30, trim: true },
      retryLabel: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.retryLabel, maxlength: 30, trim: true },
      latestLabel: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.latestLabel, maxlength: 30, trim: true },
      errorMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.errorMessage, maxlength: 160, trim: true },
      offlineMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.offlineMessage, maxlength: 240, trim: true },
      emailPrompt: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.emailPrompt, maxlength: 240, trim: true },
      emailThanks: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.emailThanks, maxlength: 240, trim: true },
      noInternetMessage: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.noInternetMessage, maxlength: 120, trim: true },
      listeningPlaceholder: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.listeningPlaceholder, maxlength: 60, trim: true },
      formTitle: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.formTitle, maxlength: 80, trim: true },
      formSubtitle: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.formSubtitle, maxlength: 160, trim: true },
      formButtonLabel: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.formButtonLabel, maxlength: 40, trim: true },
      welcomeMessageHindi: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.welcomeMessageHindi, maxlength: 300 },
      inputPlaceholderHindi: { type: String, default: DEFAULT_CHATBOT_CONFIG.chatWindow.inputPlaceholderHindi, maxlength: 80 },
    },
    behavior: {
      autoOpen: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.autoOpen },
      autoOpenDelay: { type: Number, default: DEFAULT_CHATBOT_CONFIG.behavior.autoOpenDelay, min: 0, max: 60 },
      autoOpenAnimation: { type: String, enum: AUTO_OPEN_ANIMATIONS, default: DEFAULT_CHATBOT_CONFIG.behavior.autoOpenAnimation },
      sound: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.sound },
      typingIndicator: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.typingIndicator },
      showTimestamps: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.showTimestamps },
      attachments: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.attachments },
      voiceInput: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.voiceInput },
      textToSpeech: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.textToSpeech },
      askEmail: { type: Boolean, default: DEFAULT_CHATBOT_CONFIG.behavior.askEmail },
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
      font: { type: String, enum: FONTS, default: DEFAULT_CHATBOT_CONFIG.appearance.font },
      fontSize: { type: String, enum: FONT_SIZES, default: DEFAULT_CHATBOT_CONFIG.appearance.fontSize },
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
          // Button colour; empty = the chat window's primary colour.
          color: { type: String, default: "", validate: HEX_VALIDATOR },
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

// Size options (see SIZE_FIELDS): nullable numbers with a min/max.
// null = automatic; validators skip null, so "unset" is always valid.
chatbotConfigSchema.add(
  Object.fromEntries(
    Object.entries(SIZE_FIELDS).map(([section, fields]) => [
      section,
      Object.fromEntries(
        Object.entries(fields).map(([key, [min, max]]) => [
          key,
          {
            type: Number,
            default: null,
            min: [min, `${section}.${key} must be at least ${min}.`],
            max: [max, `${section}.${key} must be at most ${max}.`],
          },
        ])
      ),
    ])
  )
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

    // Install check: websites the widget has started a session on (the
    // Origin of POST /api/widget/session), most recent first, capped at
    // MAX_INSTALLATIONS. Admin-only — never part of the public config.
    installations: {
      type: [
        {
          origin: { type: String, required: true },
          lastSeenAt: { type: Date, required: true },
          _id: false,
        },
      ],
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
