// The look a NEW chatbot starts with per sector template — on top of
// chatbotStarter.js's existing Nuform Social look (same sizes,
// animations, bubble style, etc.), just the handful of fields that
// make each sector instantly recognizable: colour, header icon, bot
// name, welcome message, CTA colours, suggestion chips and the input
// placeholder. "general" keeps the original, unbranded-by-sector
// starter exactly as it was before this file existed.
//
// The DATA here (colours, text, icons) is identical to
// admin-panel/src/config/chatbotSectorStarters.js — a test compares the
// two modules' actual output, not these files' bytes, since the import
// path and merge-helper name differ between the two repos (same
// convention as chatbotStarter.js itself).
import { STARTER_CHATBOT_CONFIG, STARTER_PATCH } from "./chatbotStarter.js";
import { deepMergeConfig } from "./chatbotConfig.js";
import { ENERGY_ICON, EDUCATION_ICON, MARKETING_ICON } from "./sectorStarterAssets.js";

// A warm, brand-neutral orange for Email — kept the same across every
// sector (and the same one the Nuform starter already uses) since the
// three CTA colours read as "dark / bright / warm", not "this exact
// hex is sector-specific".
const EMAIL_ORANGE = "#E8833A";

function sectorPatch({ primary, whatsapp, botName, welcomeMessage, icon, suggestionBg, suggestionText, suggestionBorder, inputPlaceholder, suggestions }) {
  return {
    launcher: { color: primary, icon: "logo", logoUrl: icon, logoOnly: true },
    chatWindow: {
      primaryColor: primary,
      headerGradient: { enabled: false, from: primary, to: primary },
      botName,
      botAvatar: icon,
      avatarShape: "rounded",
      statusDotColor: suggestionBorder,
      headerSubtitleColor: suggestionBg,
      welcomeMessage,
      userBubbleColor: primary,
      welcomeBgColor: suggestionBg,
      welcomeBorderColor: suggestionBorder,
      suggestionBgColor: suggestionBg,
      suggestionTextColor: suggestionText,
      suggestionBorderColor: suggestionBorder,
      sendButtonColor: primary,
      inputPlaceholder,
    },
    ctas: [
      { type: "call", enabled: true, label: "Call", value: "+91XXXXXXXXXX", color: primary },
      { type: "whatsapp", enabled: true, label: "WhatsApp", value: "91XXXXXXXXXX", color: whatsapp },
      { type: "email", enabled: true, label: "Email", value: "info@yourcompany.com", color: EMAIL_ORANGE },
    ],
    suggestions,
  };
}

const ENERGY_PATCH = sectorPatch({
  primary: "#15803D",
  whatsapp: "#22C55E",
  botName: "Energy Assistant",
  welcomeMessage:
    "\u{1F44B} Hello! I'm your Energy Assistant. Whether you're exploring renewable energy solutions, looking for energy efficiency tips, or need details about our services — I'm here to help. What brings you here today?",
  icon: ENERGY_ICON,
  suggestionBg: "#DCFCE7",
  suggestionText: "#14532D",
  suggestionBorder: "#BBF7D0",
  inputPlaceholder: "Ask About Our Energy Services...",
  suggestions: [
    "⚡ Energy solutions & services",
    "\u{1F33F} Renewable energy options",
    "\u{1F4C4} Bill of Materials (BOM)",
    "⚙️ Technical support",
    "\u{1F3E2} Projects & case studies",
    "❓ General inquiries",
  ],
});

const EDUCATION_PATCH = sectorPatch({
  primary: "#1D4ED8",
  whatsapp: "#2563EB",
  botName: "Education Assistant",
  welcomeMessage:
    "\u{1F44B} Hello! I'm your Education Assistant. Whether you're looking for course details, admissions, learning resources, or support with our programs — I'm here to help. What brings you here today?",
  icon: EDUCATION_ICON,
  suggestionBg: "#DBEAFE",
  suggestionText: "#1E3A8A",
  suggestionBorder: "#BFDBFE",
  inputPlaceholder: "Ask About Our Education Programs...",
  suggestions: [
    "\u{1F4D6} Courses & Programs",
    "\u{1F393} Admissions & Enrollment",
    "\u{1F4C5} Scholarships & Fees",
    "\u{1F4BB} Learning Resources",
    "\u{1F464} Student Support",
    "❓ General Inquiries",
  ],
});

const MARKETING_PATCH = sectorPatch({
  primary: "#5B21B6",
  whatsapp: "#7C3AED",
  botName: "Digital Marketing Assistant",
  welcomeMessage:
    "\u{1F44B} Hello! I'm your Digital Marketing Assistant. Whether you want to calculate ad spend, check ROI, find SEO tips, or learn about our digital marketing services — I'm here to help. What brings you here today?",
  icon: MARKETING_ICON,
  suggestionBg: "#EDE9FE",
  suggestionText: "#4C1D95",
  suggestionBorder: "#DDD6FE",
  inputPlaceholder: "Ask About Our Digital Marketing Services...",
  suggestions: [
    "\u{1F9EE} Digital Marketing Calculator",
    "\u{1F4C8} SEO & Content Marketing",
    "\u{1F4E3} Social Media Marketing",
    "\u{1F3AF} Paid Advertising (PPC)",
    "\u{1F5A5}️ Website & Branding",
    "❓ General Inquiries",
  ],
});

export const ENERGY_STARTER_CONFIG = deepMergeConfig(STARTER_CHATBOT_CONFIG, ENERGY_PATCH);
export const EDUCATION_STARTER_CONFIG = deepMergeConfig(STARTER_CHATBOT_CONFIG, EDUCATION_PATCH);
export const DIGITAL_MARKETING_STARTER_CONFIG = deepMergeConfig(STARTER_CHATBOT_CONFIG, MARKETING_PATCH);

// What a newly-created chatbot's `config` is seeded with (see
// controllers/admin/chatbot.controller.js's createChatbot) — "general"
// (or no template) is untouched, exactly the same STARTER_CHATBOT_CONFIG
// every template used before this file existed.
export const STARTER_CONFIG_BY_TEMPLATE = {
  general: STARTER_CHATBOT_CONFIG,
  energy: ENERGY_STARTER_CONFIG,
  education: EDUCATION_STARTER_CONFIG,
  digital_marketing: DIGITAL_MARKETING_STARTER_CONFIG,
};

export const starterConfigForTemplate = (template) => STARTER_CONFIG_BY_TEMPLATE[template] || STARTER_CHATBOT_CONFIG;

export { ENERGY_PATCH, EDUCATION_PATCH, MARKETING_PATCH, STARTER_PATCH };
