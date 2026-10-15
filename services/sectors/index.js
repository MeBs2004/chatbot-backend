// ======================================================
// SHARED CHATBOT ENGINE — SECTOR TEMPLATES
// One engine (groq.service.js's askGroq, conversationPipeline.
// service.js, chatbot.message.js, the public widget runtime) serves
// all four templates. This module is the ONLY place that knows what
// a template IS — every other file asks it a question
// (getSectorInstruction, isValidTemplate) rather than branching on
// template strings itself. Adding a 5th template later means editing
// this directory, not scattering `if (template === ...)` through
// controllers/components.
// ======================================================

import Chatbot from "../../models/chatbot.model.js";

export const SECTOR_TEMPLATES = ["general", "energy", "education", "digital_marketing"];

export const SECTOR_LABELS = {
  general: "General",
  energy: "Energy",
  education: "Education",
  digital_marketing: "Digital Marketing Calculator",
};

export const isValidTemplate = (value) => SECTOR_TEMPLATES.includes(value);

// Appended to askGroq's existing `extraInstruction` parameter — the
// same, already-safe extension point the flow engine's AI Response
// node uses (see groq.service.js: "can steer tone/focus but can
// never remove the company-scope restriction or the 'never invent
// information' rule"). A template never gets its own system prompt;
// it only ever adds guidance on top of the one shared prompt.
const SECTOR_INSTRUCTIONS = {
  general: "",

  energy: `This chatbot serves an ENERGY-sector company (solar, power, electrical equipment, or similar).
Focus on helping visitors with energy products/services, system needs, and basic project scoping.
If a visitor wants a Bill-of-Materials (BOM) / system-sizing estimate, do NOT calculate it yourself or
invent component counts, specifications, or prices — tell them to use the built-in BOM Calculator in
this chat window, which computes real, deterministic results from the values they enter. You may explain
what the calculator's output means once they share it with you, but never fabricate your own numbers.`,

  education: `This chatbot serves an EDUCATION-sector company (school, college, university, or coaching provider).
Help visitors with course/program discovery, general admissions questions, and eligibility information
STRICTLY from the knowledge base provided below. Do NOT invent course fees, admission requirements,
scholarship eligibility, available dates/seats, or booking confirmations under any circumstance — if the
knowledge base does not contain the answer, say so clearly and offer to connect them with the company
(a human representative) for anything fee-, date-, or eligibility-specific. When a visitor wants a
consultation or demo, capture their interest and let them know the company will follow up — never promise
a confirmed booking or appointment time yourself.`,

  digital_marketing: `This chatbot serves a DIGITAL MARKETING company/agency or a marketing team.
You may explain marketing concepts and interpret calculator results in plain language, but you must NEVER
perform ROI/ROAS/CPC/CPM/CTR/conversion-rate/CPL/budget calculations yourself or invent numbers — all of
those are computed by the built-in, deterministic Marketing Calculator in this chat window. Direct the
visitor to use it, and only discuss/explain numbers they've actually gotten from it. Always describe
calculator output as an estimate, never a guarantee of campaign performance.`,
};

export const getSectorInstruction = (template) => SECTOR_INSTRUCTIONS[template] || "";

// Shared by every askGroq call site that has a resolved chatbotId
// (chatbot.message.js, conversationPipeline.service.js) so the
// "look up this chatbot's template and turn it into prompt guidance"
// logic exists in exactly one place, never duplicated per caller.
// Deliberately silent/empty-string on any lookup failure — a missing
// or unresolvable chatbotId must never block a reply, it just means
// no sector guidance is added (identical to today's "general"
// behavior).
export const getSectorInstructionForChatbot = async (chatbotId) => {
  if (!chatbotId) return "";
  try {
    const chatbot = await Chatbot.findById(chatbotId).select("template").lean();
    return getSectorInstruction(chatbot?.template || "general");
  } catch {
    return "";
  }
};
