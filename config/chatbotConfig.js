// Single source of truth for the Chatbot Customization Studio's
// configuration shape (Phase 4). Not read by the live public widget
// yet — see services/chatbotStatus.service.js / groq.service.js,
// which still read Company.ai/Company.chatbot. That migration is a
// later, separate phase.

export const DEFAULT_CHATBOT_CONFIG = {
  launcher: {
    enabled: true,
    position: "bottom-right",
    shape: "circle",
    color: "#0D5537",
    gradient: { enabled: false, from: "#0D5537", to: "#067647" },
    icon: "default",
    size: "medium",
    animation: "float",
    showGreeting: true,
    greetingTitle: "Hi there \u{1F44B}",
    greetingMessage: "How can we help you today?",
    showNotificationBadge: true,
    showOnMobile: true,
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
  },
  behavior: {
    autoOpen: false,
    autoOpenDelay: 3,
    sound: true,
    typingIndicator: true,
    offlineMode: "default",
  },
  forms: {
    enabled: false,
    style: "classic",
    fields: [],
  },
  language: {
    defaultLanguage: "English",
  },
  appearance: {
    font: "system",
    customCss: "",
  },
};

export const ALLOWED_FORM_FIELDS = ["name", "email", "phone", "company"];

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
