// Single source of truth for the Chatbot Customization Studio's
// configuration shape (Phase 4). Not read by the live public widget
// yet — see services/chatbotStatus.service.js / groq.service.js,
// which still read Company.ai/Company.chatbot. That migration is a
// later, separate phase.


// Size options: [min, max] in px (bubbleMaxWidthPct is a percentage).
// Every one defaults to null = "automatic" — the widget keeps its
// built-in size until an admin sets a number.
export const SIZE_FIELDS = {
  launcher: {
    customSize: [36, 120],
    iconSize: [12, 72],
    labelFontSize: [11, 24],
    bubbleMaxWidth: [140, 360],
    bubbleFontSize: [10, 20],
    badgeSize: [8, 28],
    // logo size inside the launcher circle, in % (over 100 crops it to fill the circle)
    logoScale: [60, 160],
    // gap between the launcher and its greeting bubble
    bubbleOffset: [4, 40],
    bubbleLetterSpacing: [0, 3],
  },
  chatWindow: {
    customWidth: [280, 560],
    customHeight: [360, 800],
    customRadius: [0, 48],
    headerHeight: [48, 100],
    headerTitleSize: [12, 24],
    headerSubtitleSize: [9, 16],
    avatarSize: [24, 64],
    contentPadding: [8, 32],
    messageGap: [4, 32],
    bubbleMaxWidthPct: [50, 95],
    bubblePaddingX: [8, 32],
    bubblePaddingY: [4, 24],
    welcomeFontSize: [11, 24],
    welcomeLineHeight: [16, 44],
    sectionGap: [8, 40],
    welcomeMaxWidthPct: [50, 100],
    messageAvatarSize: [20, 48],
    lineHeight: [16, 40],
    inputRadius: [8, 32],
    typingDotSize: [4, 14],
    suggestionFontSize: [10, 18],
    suggestionHeight: [24, 64],
    suggestionWidth: [80, 400],
    suggestionPaddingX: [6, 32],
    suggestionGap: [4, 24],
    ctaHeight: [28, 64],
    ctaWidth: [80, 320],
    ctaFontSize: [10, 20],
    ctaRadius: [0, 32],
    ctaGap: [4, 24],
    inputHeight: [36, 80],
    sendButtonSize: [26, 56],
    footerFontSize: [9, 16],
    headerLogoWidth: [16, 64],
    headerLogoHeight: [16, 64],
    messageAvatarHeight: [20, 56],
    inputPaddingX: [4, 24],
    inputPaddingY: [2, 16],
    sendButtonRadius: [0, 28],
    sendIconSize: [10, 24],
    ctaIconSize: [10, 24],
    headerButtonAlpha: [0, 40],
    closeIconSize: [8, 20],
    paragraphGap: [0, 16],
  },
  forms: {
    fieldHeight: [32, 64],
    buttonHeight: [32, 64],
    fontSize: [11, 20],
  },
  appearance: {
    fontSizePx: [10, 22],
  },
};

const nullSizes = (section) => Object.fromEntries(Object.keys(SIZE_FIELDS[section]).map((k) => [k, null]));

export const DEFAULT_CHATBOT_CONFIG = {
  launcher: {
    enabled: true,
    position: "bottom-right",
    shape: "circle",
    color: "#0D5537",
    gradient: { enabled: false, from: "#0D5537", to: "#067647" },
    icon: "default",
    // Custom launcher image (https URL or small data: URL from the
    // Studio's uploader). Used when icon === "logo".
    logoUrl: "",
    iconColor: "#FFFFFF",
    // "icon" = round button, "icon-label" = pill with text next to it.
    style: "icon",
    labelText: "Chat with us",
    size: "medium",
    animation: "float",
    entrance: "pop",
    hoverEffect: "grow",
    // Animation of the greeting/teaser bubble above the launcher.
    bubbleAnimation: "slide",
    // "typing": the bubble shows a typing indicator, then types each
    // message out, holds it, hides, pauses, and repeats.
    bubbleEffect: "none",
    bubbleOrder: "sequence",
    bubbleAvatar: false,
    bubbleTail: false,
    bubbleHoldSeconds: 4,
    bubblePauseSeconds: 8,
    // Draw just the logo — no coloured button behind it.
    logoOnly: false,
    badgePulse: false,
    // Show the badge only while the greeting bubble is on screen.
    badgeWithBubble: false,
    shadow: "strong",
    badgeColor: "#EF4444",
    // "luxe" animation: halo, glow and shimmer colour, and the sparkles' colour.
    // Empty = the launcher colour.
    effectColor: "",
    sparkleColor: "",
    // Greeting bubble colours. Empty = white bubble, grey border, dark text, grey dots.
    bubbleBgColor: "",
    bubbleBorderColor: "",
    bubbleTextColor: "",
    bubbleDotColor: "",
    showGreeting: true,
    greetingTitle: "Hi there \u{1F44B}",
    greetingMessage: "How can we help you today?",
    showNotificationBadge: true,
    showOnMobile: true,
    // Rotating bubbles above the launcher; empty = greeting only.
    teaserMessages: [],
    ...nullSizes("launcher"),
  },
  chatWindow: {
    theme: "light",
    primaryColor: "#0D5537",
    backgroundColor: "#FFFFFF",
    textColor: "#111827",
    size: "medium",
    borderRadius: "large",
    botName: "",
    companyName: "",
    botAvatar: "",
    showBranding: true,
    welcomeMessage: "Hi! How can we help you today?",
    headerGradient: { enabled: false, from: "#0D5537", to: "#067647" },
    headerTextColor: "#FFFFFF",
    // Empty colour = derive it (primary colour / theme default).
    userBubbleColor: "",
    userTextColor: "#FFFFFF",
    botBubbleColor: "",
    botTextColor: "",
    sendButtonColor: "",
    inputPlaceholder: "Type a message...",
    subtitle: "",
    showStatusDot: true,
    bubbleStyle: "rounded",
    showMessageAvatars: false,
    messageAnimation: "fade",
    windowAnimation: "slide-up",
    typingStyle: "dots",
    headerAnimation: "none",
    avatarAnimation: "none",
    sendAnimation: "none",
    suggestionAnimation: "slide",
    shadow: "strong",
    chatBackground: "plain",
    suggestionStyle: "soft",
    footerText: "",
    headerSubtitleColor: "",
    avatarShape: "circle",
    statusStyle: "avatar",
    statusDotColor: "",
    botBubbleBorderColor: "",
    footerBackground: "",
    sendButtonShape: "rounded",
    suggestionBgColor: "",
    suggestionTextColor: "",
    suggestionBorderColor: "",
    brandName: "Nuformly",
    brandUrl: "",
    brandColor: "",
    // Shown instead of welcomeMessage when the visitor picks Hindi.
    welcomeMessageHindi: "",
    inputPlaceholderHindi: "",
    // Show / hide each part of the window. All on by default.
    showClearButton: true,
    showLanguageSelector: true,
    showCloseButton: true,
    showHeaderAvatar: true,
    showWelcome: true,
    showSuggestions: true,
    showCtas: true,
    showScrollButton: true,
    // Wording of the built-in labels and messages. Empty = the built-in text.
    listenLabel: "",
    stopLabel: "",
    retryLabel: "",
    latestLabel: "",
    errorMessage: "",
    offlineMessage: "",
    emailPrompt: "",
    emailThanks: "",
    noInternetMessage: "",
    listeningPlaceholder: "",
    formTitle: "",
    formSubtitle: "",
    formButtonLabel: "",
    borderColor: "",
    dividerColor: "",
    welcomeBgColor: "",
    welcomeBorderColor: "",
    placeholderColor: "",
    avatarAlign: "bottom",
    // A separate image for the header (empty = the bot avatar).
    headerLogo: "",
    // Where "Listen" sits: inside the bot's bubble, or under it.
    listenPlacement: "inside",
    // Typing-dot colours (empty = the style's own colours).
    typingColor1: "",
    typingColor2: "",
    typingColor3: "",
    // The bot's avatar beside the typing indicator.
    typingAvatar: false,
    attachIcon: "plus",
    // Text colour of the contact buttons (empty = automatic per button).
    ctaTextColor: "",
    ...nullSizes("chatWindow"),
  },
  behavior: {
    autoOpen: false,
    autoOpenDelay: 3,
    // How the window appears when it opens by itself. "default" = use
    // chatWindow.windowAnimation, same as a manual open.
    autoOpenAnimation: "default",
    sound: true,
    typingIndicator: true,
    showTimestamps: false,
    attachments: false,
    voiceInput: false,
    textToSpeech: false,
    askEmail: false,
    offlineMode: "default",
  },
  forms: {
    enabled: false,
    style: "classic",
    fields: [],
    ...nullSizes("forms"),
  },
  language: {
    defaultLanguage: "English",
  },
  appearance: {
    font: "system",
    fontSize: "medium",
    customCss: "",
    ...nullSizes("appearance"),
  },
  // CTA quick-action buttons shown above the welcome message (Call/
  // WhatsApp/Email/custom link) — mirrors the legacy Bot.jsx/OyaBot.jsx
  // hardcoded buttons, made per-chatbot and admin-editable instead.
  ctas: [],
  // Per-chatbot suggestion chips. Empty = fall back to the existing
  // company-wide GET bot/v1/suggestions endpoint (today's behavior,
  // unchanged for every chatbot that never sets this) — see
  // NuformlyWidget.jsx.
  suggestions: [],
};

// Option lists shared by the schema (enums) so the Studio, the
// validator and the widget can never disagree about what is allowed.
export const LAUNCHER_ICONS = ["default", "chat", "logo", "headset", "bolt", "heart", "help", "robot", "send", "smile", "star"];
export const LAUNCHER_SHAPES = ["circle", "rounded-square", "squircle"];
export const LAUNCHER_ANIMATIONS = ["none", "float", "pulse", "glow", "bounce", "wiggle", "ripple", "heartbeat", "shake", "jelly", "swing", "tada", "breathe", "spin", "flash", "wobble", "float-ripple", "luxe"];
export const LAUNCHER_ENTRANCES = ["none", "pop", "slide-up", "fade", "bounce", "zoom", "flip", "slide-left", "slide-right", "drop", "rotate", "blur", "rise"];
export const LAUNCHER_HOVERS = ["none", "grow", "lift", "spin", "shake", "tilt", "glow", "bounce", "pulse", "grow-rotate", "subtle"];
export const AVATAR_ALIGNS = ["bottom", "top"];
export const BUBBLE_ANIMATIONS = ["none", "fade", "slide", "pop", "bounce", "shake"];
export const SHADOWS = ["none", "soft", "strong"];
export const LAUNCHER_SHADOWS = ["none", "soft", "strong", "glow"];
export const BUBBLE_STYLES = ["rounded", "soft", "sharp", "pill", "classic"];
export const MESSAGE_ANIMATIONS = ["none", "fade", "slide", "pop", "bounce", "zoom", "flip", "side", "blur"];
export const WINDOW_ANIMATIONS = ["none", "slide-up", "fade", "scale", "bounce", "zoom", "flip", "drop", "rotate", "elastic", "spring"];
export const AUTO_OPEN_ANIMATIONS = ["default", "slide-up", "slide-down", "slide-left", "slide-right", "fade", "scale", "zoom", "bounce", "flip", "flip-y", "drop", "rotate", "elastic", "swing", "blur"];
export const TYPING_STYLES = ["dots", "wave", "pulse", "bars", "colorful"];
export const BUBBLE_EFFECTS = ["none", "typing"];
export const BUBBLE_ORDERS = ["sequence", "random"];
export const AVATAR_SHAPES = ["circle", "rounded"];
export const STATUS_STYLES = ["avatar", "inline"];
export const SEND_SHAPES = ["rounded", "circle"];
export const LISTEN_PLACEMENTS = ["inside", "below"];
export const ATTACH_ICONS = ["plus", "paperclip"];
export const HEADER_ANIMATIONS = ["none", "shimmer", "flow"];
export const AVATAR_ANIMATIONS = ["none", "pulse", "float", "wiggle"];
export const SEND_ANIMATIONS = ["none", "fly", "pulse", "spin"];
export const SUGGESTION_ANIMATIONS = ["none", "fade", "slide", "pop", "bounce"];
export const CHAT_BACKGROUNDS = ["plain", "dots", "grid", "gradient"];
export const SUGGESTION_STYLES = ["soft", "outline", "filled"];
export const FONTS = ["system", "inter", "poppins", "nunito", "dm-sans", "merriweather", "mono"];
export const FONT_SIZES = ["small", "medium", "large"];

export const ALLOWED_FORM_FIELDS = ["name", "email", "phone", "company"];
export const ALLOWED_CTA_TYPES = ["call", "whatsapp", "email", "custom"];
export const MAX_CTAS = 6;
export const MAX_SUGGESTIONS = 8;

const HEX_RE = /^#([0-9A-Fa-f]{3}){1,2}$/;
export const isValidHex = (v) => typeof v === "string" && HEX_RE.test(v);

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/**
 * Recursively merges `overrides` onto `base`, only at leaf values —
 * a partial nested object (e.g. { launcher: { color } }) never wipes
 * out its untouched siblings (e.g. launcher.position). Unknown keys
 * not present in `base` are dropped (the shape of `base`/defaults
 * is always what wins), which is the whitelist that keeps arbitrary
 * fields from ever being persisted.
 */
export function deepMergeConfig(base, overrides) {
  if (!isPlainObject(overrides)) return base;
  const result = { ...base };
  for (const key of Object.keys(base)) {
    const value = overrides[key];
    if (isPlainObject(base[key])) {
      result[key] = deepMergeConfig(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Deep-merges a partial/possibly-empty stored config with the
 * defaults above, so callers never see missing fields — including
 * pre-Phase-4 Chatbot documents that have no `config` at all (no
 * migration script needed; this runs on every read instead).
 */
export function mergeChatbotConfig(stored) {
  return deepMergeConfig(DEFAULT_CHATBOT_CONFIG, stored);
}
