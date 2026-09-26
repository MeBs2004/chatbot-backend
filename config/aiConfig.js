// Single source of truth for AI Settings' real constraints (Phase 7).
// Every value here is either already hardcoded/used somewhere in
// services/groq.service.js or services/ai.router.js, or is a bound
// on a field that pipeline already reads — nothing invented.

// The only two model strings the live Groq pipeline actually ever
// requests (see groq.service.js: text default + the fixed
// image-mode model). Admins may only pick from this list — the
// backend re-validates it regardless of what the browser sends.
export const SUPPORTED_MODELS = [
  { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B (default, text)" },
  { value: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B (vision-capable)" },
];
export const SUPPORTED_MODEL_VALUES = SUPPORTED_MODELS.map((m) => m.value);
export const DEFAULT_MODEL = "openai/gpt-oss-20b";

export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 1;
export const DEFAULT_TEMPERATURE = 0.3;

// Groq's chat completion API rejects absurd max_tokens; 2000 matches
// the ceiling already enforced on the Phase 6 AI Response node
// (validators/flow.validator.js) for consistency across the one
// underlying call.
export const MAX_TOKENS_MIN = 1;
export const MAX_TOKENS_MAX = 2000;
export const DEFAULT_MAX_TOKENS = 500;

// The only languages the widgets/system prompt have real, tested
// language switches for (see frontend Bot.jsx/OyaBot.jsx language
// selectors — both are English/Hindi only).
export const SUPPORTED_LANGUAGES = ["English", "Hindi"];
export const DEFAULT_LANGUAGE = "English";

export const RESPONSE_LENGTH_OPTIONS = ["concise", "balanced", "detailed"];
export const DEFAULT_RESPONSE_LENGTH = "balanced";

export const TONE_OPTIONS = ["professional", "friendly", "formal", "custom"];
export const DEFAULT_TONE = "professional";

export const SYSTEM_PROMPT_MAX_LENGTH = 4000; // matches Chatbot.settings.systemPrompt precedent
export const CUSTOM_TONE_MAX_LENGTH = 100;
export const FALLBACK_MESSAGE_MAX_LENGTH = 500;

export const DEFAULT_FALLBACK_MESSAGE =
  "I'm sorry, I don't have enough information to answer that. Would you like to speak with our team?";
