// ======================================================
// HUMAN HANDOFF KEYWORDS
// ======================================================

const handoffKeywords = new Set([
  // Human
  "human",
  "real human",
  "person",
  "real person",
  "someone",

  // Agent
  "agent",
  "live agent",
  "customer agent",
  "representative",
  "executive",

  // Support
  "support",
  "customer support",
  "technical support",
  "help desk",
  "assistance",

  // Contact
  "contact",
  "contact team",
  "contact support",
  "contact sales",
  "reach out",

  // Talk
  "talk to human",
  "talk to someone",
  "talk to person",
  "speak to human",
  "speak to person",
  "speak with someone",
  "chat with human",

  // Call
  "call me",
  "call us",
  "phone number",
  "phone support",
  "customer care",

  // Help
  "need help",
  "need assistance",
  "i need help",
  "can you help me",
  "unable to understand",

  // Frustration
  "not satisfied",
  "unsatisfied",
  "bad support",
  "poor support",
  "complaint",
  "issue not resolved",
  "frustrated",

  // Business
  "sales team",
  "marketing team",
  "consultant",
  "expert",
  "advisor",

  // Appointment
  "book a call",
  "schedule a call",
  "free consultation",
  "consultation",

  // WhatsApp
  "whatsapp",
  "chat on whatsapp",

  // Hindi
  "इंसान",
  "व्यक्ति",
  "सपोर्ट",
  "मदद",
  "कॉल करें",
  "मुझसे बात कराओ",
  "किसी से बात करनी है",
  "टीम से बात करनी है",
  "मानव",
  "सहायता चाहिए",
]);

// ======================================================
// NORMALIZE MESSAGE
// ======================================================

const normalize = (text = "") =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

// ======================================================
// CHECK IF HUMAN HANDOFF IS NEEDED
// ======================================================

export const needsHumanHandoff = (message = "") => {
  if (!message || typeof message !== "string") {
    return false;
  }

  const normalizedMessage = normalize(message);

  for (const keyword of handoffKeywords) {
    if (normalizedMessage.includes(normalize(keyword))) {
      return true;
    }
  }

  return false;
};