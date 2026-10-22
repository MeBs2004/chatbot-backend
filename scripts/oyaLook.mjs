// The OYA by Gemkara look (frontend/src/component/OyaBot.jsx) as Studio
// options, so the config-driven (v1) widget draws the same launcher and
// chat window. Everything here stays editable in the Studio afterwards.
//
//   node scripts/oyaLook.mjs <chatbotId> [backup.json]   apply it (backs up the old config first)
//   node scripts/oyaLook.mjs <chatbotId> --dry-run        validate only, change nothing

const ASSETS = "https://chatbot-frontend-nine-psi.vercel.app";

const WINE = "#5E0F28";
const WINE_MID = "#8C2346";
const GOLD = "#B8865B";
const CHAMPAGNE = "#F3D6B6";

export const OYA_LOOK = {
  launcher: {
    enabled: true,
    position: "bottom-right",
    shape: "circle",
    style: "icon",
    icon: "logo",
    logoUrl: `${ASSETS}/oya-logo.png`,
    logoOnly: true,
    customSize: 62,
    logoScale: 113, // 70px image in the 62px circle
    color: WINE,
    animation: "luxe",
    entrance: "rise",
    hoverEffect: "subtle",
    effectColor: "#D4AF37",
    sparkleColor: "#E7C873",
    // greeting bubble: cream card, gold border, typed messages in random order
    showGreeting: false,
    bubbleEffect: "typing",
    bubbleOrder: "random",
    bubbleAnimation: "slide",
    bubbleAvatar: true,
    bubbleTail: true,
    bubbleHoldSeconds: 4,
    bubblePauseSeconds: 8,
    bubbleBgColor: "#FFFDF8",
    bubbleBorderColor: "#EEDEAB", // #D4AF37 at 40% on the cream
    bubbleTextColor: "#2E2E2E",
    bubbleDotColor: "#C9A227",
    bubbleMaxWidth: 150, // OyaBot's bubble always settles at its 150px minimum
    bubbleFontSize: 11.5,
    bubbleOffset: 15,
    bubbleLetterSpacing: 0.3,
    teaserMessages: [
      "✨ Welcome to OYA",
      "💎 Looking for timeless jewellery?",
      "✨ Find your perfect sparkle",
      "💍 Discover handcrafted elegance",
      "✨ Explore our latest collection",
      "💎 Looking for the perfect gift?",
      "✨ Need styling advice?",
      "💍 Let's find something beautiful",
      "✨ Browse rings, earrings & necklaces",
      "💎 Ask me anything about OYA",
      "✨ Your jewellery assistant is here",
    ],
    showNotificationBadge: true,
    badgeColor: "#D4AF37",
    badgeSize: 12,
    badgePulse: true,
    badgeWithBubble: true,
    showOnMobile: true,
  },
  chatWindow: {
    theme: "light",
    primaryColor: WINE,
    backgroundColor: "#FFFFFF",
    textColor: "#333333",
    customWidth: 365,
    customHeight: 547,
    customRadius: 28,
    borderColor: "#DCDCDC",
    shadow: "none",
    windowAnimation: "spring",
    // header
    botName: "OYA Assistant",
    subtitle: "Online · Always ready",
    botAvatar: `${ASSETS}/oya-logo.png`,
    headerLogo: `${ASSETS}/oya-logo1.png`,
    avatarShape: "rounded",
    avatarSize: 40,
    headerLogoWidth: 34,
    headerLogoHeight: 38,
    headerHeight: 74,
    headerTitleSize: 15,
    headerSubtitleSize: 11,
    headerGradient: { enabled: true, from: WINE, to: WINE_MID },
    headerTextColor: "#FFFFFF",
    headerSubtitleColor: CHAMPAGNE,
    showStatusDot: true,
    statusStyle: "inline",
    statusDotColor: CHAMPAGNE,
    headerButtonAlpha: 13, // #ffffff22
    closeIconSize: 13,
    showHeaderAvatar: true,
    showClearButton: true,
    showLanguageSelector: true,
    showCloseButton: true,
    headerAnimation: "none",
    avatarAnimation: "none",
    // welcome card + contact buttons
    welcomeMessage:
      "👋 Welcome to OYA by Gemkara. I'm OYA, your luxury jewellery assistant. I can help you with: • Natural Gemstones • Premium Jewellery • Personalized Recommendations • Book Appointments • Customer Support. How may I assist you today?",
    welcomeMessageHindi:
      "👋 नमस्ते! मैं OYA हूँ। OYA by Gemkara में आपका स्वागत है। मैं आपकी सहायता कर सकती हूँ: • प्राकृतिक रत्न • प्रीमियम ज्वेलरी • व्यक्तिगत सुझाव • अपॉइंटमेंट बुकिंग • ऑर्डर सहायता। आज मैं आपकी किस प्रकार सहायता कर सकती हूँ?",
    welcomeBgColor: "#FFFFFF",
    welcomeBorderColor: "#D8E9DE",
    welcomeFontSize: 13.5,
    welcomeLineHeight: 23.22, // 13.5px × 1.72
    welcomeMaxWidthPct: 100,
    sectionGap: 20,
    showWelcome: true,
    showCtas: true,
    ctaHeight: 34,
    ctaFontSize: 12,
    ctaIconSize: 13,
    ctaGap: 8,
    ctaTextColor: "#FFFFFF",
    // messages
    bubbleStyle: "classic",
    userBubbleColor: WINE,
    userTextColor: "#FFFFFF",
    botBubbleColor: "#FFFFFF",
    botTextColor: "#333333",
    botBubbleBorderColor: "#D7E7DC",
    bubbleMaxWidthPct: 82,
    bubblePaddingX: 15,
    bubblePaddingY: 12,
    lineHeight: 22.75, // the replies' paragraphs are leading-relaxed (14px × 1.625)
    paragraphGap: 6,
    messageGap: 16,
    contentPadding: 16,
    showMessageAvatars: true,
    avatarAlign: "top",
    messageAvatarSize: 32,
    messageAvatarHeight: 37,
    messageAnimation: "slide",
    listenPlacement: "below",
    typingStyle: "colorful",
    typingColor1: WINE,
    typingColor2: WINE_MID,
    typingColor3: GOLD,
    typingDotSize: 8,
    typingAvatar: true,
    // suggestion chips (the list itself comes from the company record, per language)
    showSuggestions: true,
    suggestionStyle: "outline",
    suggestionBgColor: "#FFFFFF",
    suggestionTextColor: "#333333",
    suggestionBorderColor: "#D6E8DD",
    suggestionHeight: 32,
    suggestionFontSize: 11,
    suggestionPaddingX: 12,
    suggestionGap: 12,
    suggestionAnimation: "none",
    // input + footer
    inputPlaceholder: "Explore elegance with Oya...",
    inputPlaceholderHindi: "अपना प्रश्न पूछें...",
    placeholderColor: "#9AA5A0",
    footerBackground: "#FFFFFF",
    dividerColor: "#E8E8E8",
    inputRadius: 18,
    inputPaddingX: 8,
    inputPaddingY: 4,
    attachIcon: "paperclip",
    sendButtonColor: WINE,
    sendButtonSize: 35,
    sendButtonRadius: 12,
    sendIconSize: 14,
    sendAnimation: "none",
    showBranding: true,
    brandName: "Nuform Social",
    brandUrl: "nuformsocial.com",
    brandColor: WINE,
    footerFontSize: 11,
    footerText: "",
    showScrollButton: true,
    emailPrompt: "📧 May we have your email address? This helps our OYA jewellery consultants assist you personally.",
    emailThanks: "✨ Thank you. Your email has been saved. Our OYA team will be happy to assist you further.",
  },
  behavior: {
    typingIndicator: true,
    sound: true,
    attachments: true,
    voiceInput: true,
    textToSpeech: true,
    askEmail: true,
  },
  language: { defaultLanguage: "English" },
  appearance: { font: "system", fontSizePx: 14 },
  ctas: [
    { type: "call", enabled: true, label: "Call", value: "+918796885861", color: WINE },
    { type: "whatsapp", enabled: true, label: "WhatsApp", value: "918796885861", color: "#25D366" },
    { type: "email", enabled: true, label: "Email", value: "care@gemkara.com", color: GOLD },
  ],
  suggestions: [],
};

const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
/** `base` with every key of `patch` written over it (arrays are replaced). */
export function mergeLook(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && isPlain(base?.[k]) ? mergeLook(base[k], v) : v;
  return out;
}

// CLI
const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , chatbotId, arg] = process.argv;
  if (!chatbotId) {
    console.error("usage: node scripts/oyaLook.mjs <chatbotId> [backup.json | --dry-run]");
    process.exit(1);
  }
  const fs = await import("node:fs");
  const mongoose = (await import("mongoose")).default;
  (await import("dotenv")).default.config();
  const Chatbot = (await import("../models/chatbot.model.js")).default;

  await mongoose.connect(process.env.MONGO_URI);
  try {
    const bot = await Chatbot.findById(chatbotId);
    if (!bot) throw new Error(`No chatbot ${chatbotId}`);
    const before = bot.toObject().config;
    bot.config = mergeLook(before, OYA_LOOK);
    bot.widgetEngineVersion = "v1";
    await bot.validate();
    if (arg === "--dry-run") {
      console.log(`OK: the OYA look validates for "${bot.name}" (nothing saved).`);
    } else {
      const backup = arg || `oya-config-backup-${Date.now()}.json`;
      fs.writeFileSync(backup, JSON.stringify({ chatbotId, name: bot.name, config: before }, null, 2));
      bot.markModified("config");
      await bot.save();
      console.log(`Saved the OYA look on "${bot.name}". Previous config: ${backup}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}
