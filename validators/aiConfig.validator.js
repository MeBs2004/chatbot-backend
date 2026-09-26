import {
  SUPPORTED_MODEL_VALUES,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
  MAX_TOKENS_MIN,
  MAX_TOKENS_MAX,
  SUPPORTED_LANGUAGES,
  RESPONSE_LENGTH_OPTIONS,
  TONE_OPTIONS,
  SYSTEM_PROMPT_MAX_LENGTH,
  CUSTOM_TONE_MAX_LENGTH,
  FALLBACK_MESSAGE_MAX_LENGTH,
} from "../config/aiConfig.js";

/**
 * Validates a partial `Company.ai` patch. Every field is optional —
 * only fields actually present in `input` are checked — since both
 * callers (the existing generic company PATCH and the new
 * chatbot-scoped AI Settings endpoint) may send a subset. Never
 * trusts the frontend; this is the one place both paths funnel
 * through.
 */
export function validateAiConfigPatch(input) {
  const errors = [];
  if (!input || typeof input !== "object") return { valid: true, errors };

  if (input.model !== undefined && !SUPPORTED_MODEL_VALUES.includes(input.model)) {
    errors.push({ field: "model", message: `Model must be one of: ${SUPPORTED_MODEL_VALUES.join(", ")}.` });
  }

  if (input.temperature !== undefined) {
    const t = Number(input.temperature);
    if (Number.isNaN(t) || t < TEMPERATURE_MIN || t > TEMPERATURE_MAX) {
      errors.push({ field: "temperature", message: `Temperature must be between ${TEMPERATURE_MIN} and ${TEMPERATURE_MAX}.` });
    }
  }

  if (input.maxTokens !== undefined) {
    const m = Number(input.maxTokens);
    if (!Number.isInteger(m) || m < MAX_TOKENS_MIN || m > MAX_TOKENS_MAX) {
      errors.push({ field: "maxTokens", message: `Max tokens must be a whole number between ${MAX_TOKENS_MIN} and ${MAX_TOKENS_MAX}.` });
    }
  }

  if (input.language !== undefined && !SUPPORTED_LANGUAGES.includes(input.language)) {
    errors.push({ field: "language", message: `Language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}.` });
  }

  if (input.systemPrompt !== undefined) {
    if (typeof input.systemPrompt !== "string") {
      errors.push({ field: "systemPrompt", message: "Instructions must be text." });
    } else if (input.systemPrompt.length > SYSTEM_PROMPT_MAX_LENGTH) {
      errors.push({ field: "systemPrompt", message: `Instructions must be under ${SYSTEM_PROMPT_MAX_LENGTH} characters.` });
    }
  }

  if (input.fallbackMessage !== undefined) {
    if (typeof input.fallbackMessage !== "string") {
      errors.push({ field: "fallbackMessage", message: "Fallback message must be text." });
    } else if (input.fallbackMessage.length > FALLBACK_MESSAGE_MAX_LENGTH) {
      errors.push({ field: "fallbackMessage", message: `Fallback message must be under ${FALLBACK_MESSAGE_MAX_LENGTH} characters.` });
    }
  }

  if (input.responseStyle !== undefined) {
    const rs = input.responseStyle;
    if (!rs || typeof rs !== "object") {
      errors.push({ field: "responseStyle", message: "Response style must be an object." });
    } else {
      if (rs.length !== undefined && !RESPONSE_LENGTH_OPTIONS.includes(rs.length)) {
        errors.push({ field: "responseStyle.length", message: `Response length must be one of: ${RESPONSE_LENGTH_OPTIONS.join(", ")}.` });
      }
      if (rs.tone !== undefined && !TONE_OPTIONS.includes(rs.tone)) {
        errors.push({ field: "responseStyle.tone", message: `Tone must be one of: ${TONE_OPTIONS.join(", ")}.` });
      }
      if (rs.customTone !== undefined) {
        if (typeof rs.customTone !== "string") {
          errors.push({ field: "responseStyle.customTone", message: "Custom tone must be text." });
        } else if (rs.customTone.length > CUSTOM_TONE_MAX_LENGTH) {
          errors.push({ field: "responseStyle.customTone", message: `Custom tone must be under ${CUSTOM_TONE_MAX_LENGTH} characters.` });
        }
      }
      if (rs.useEmojis !== undefined && typeof rs.useEmojis !== "boolean") {
        errors.push({ field: "responseStyle.useEmojis", message: "useEmojis must be true or false." });
      }
      if (rs.useMarkdown !== undefined && typeof rs.useMarkdown !== "boolean") {
        errors.push({ field: "responseStyle.useMarkdown", message: "useMarkdown must be true or false." });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
