import dotenv from "dotenv";
dotenv.config();

import Groq from "groq-sdk";
import Company from "../models/company.model.js";
import { isAIQuotaExceeded } from "./billing/quota.service.js";
import { recordAIUsage } from "./billing/aiUsage.service.js";

// ===================================================
// GROQ API KEYS
// ===================================================

const apiKeys = [
  process.env.GROQ_API_KEY_1,
  process.env.GROQ_API_KEY_2,
  process.env.GROQ_API_KEY_3,
  process.env.GROQ_API_KEY_4,
  process.env.GROQ_API_KEY_5,
].filter(Boolean);

// ===================================================
// KNOWLEDGE CACHE
// MongoDB (Company.knowledgeContent) is the source of truth — see
// knowledge.service.js for why a local file could never be. This
// Map is purely a performance optimization so a hot chatbot doesn't
// re-fetch its (up to 2MB) knowledge text on every single message;
// it is never what makes the result correct. Keyed by companyId, not
// by filename — a company's knowledge now has nothing to do with any
// file on disk.
//
// TTL-bounded, not just invalidate-on-write: an admin-panel save
// already invalidates instantly (writeKnowledgeFile calls
// invalidateKnowledgeCache right after the Mongo write, so that path
// is real-time with no 30s wait at all). The TTL exists for anything
// that changes Company.knowledgeContent WITHOUT going through that
// code path — a direct MongoDB edit, a script, Atlas's UI — so
// staleness is always bounded to at most KNOWLEDGE_CACHE_TTL_MS no
// matter how the data changed, instead of silently depending on every
// future write path remembering to call invalidateKnowledgeCache.
// ===================================================

const KNOWLEDGE_CACHE_TTL_MS = 30 * 1000;

const knowledgeCache = new Map(); //performance: companyId -> { content, cachedAt }

const loadKnowledge = async (companyId) => {
  if (!companyId) return "";

  const cached = knowledgeCache.get(companyId);
  if (cached && Date.now() - cached.cachedAt < KNOWLEDGE_CACHE_TTL_MS) {
    return cached.content;
  }

  try {
    const company = await Company.findOne({ companyId }).select("knowledgeContent").lean();
    const knowledge = company?.knowledgeContent || "";

    knowledgeCache.set(companyId, { content: knowledge, cachedAt: Date.now() });
    console.log(`✅ Knowledge Loaded -> ${companyId}`);

    return knowledge;
  } catch (err) {
    console.error(`Knowledge Load Error (${companyId}): ${err.message}`);
    // A transient Mongo error should not erase a perfectly good,
    // still-recent cached value just because its TTL expired at the
    // same moment — keep serving it rather than falling back to "".
    if (cached) return cached.content;
    return "";
  }
};

/**
 * Called by the admin Knowledge Base endpoint right after it writes
 * new content to MongoDB, so the running process picks it up on the
 * very next request instead of serving stale cached content —
 * correctness comes from the Mongo write; this just keeps the cache
 * from contradicting it for however long the process stays up.
 */
export const invalidateKnowledgeCache = (companyId) => {
  if (companyId) knowledgeCache.delete(companyId);
};

// ===================================================
// PHASE 7 — RESPONSE STYLE / FALLBACK
// Both helpers return the exact original static text when the
// company has no `ai.responseStyle`/`ai.fallbackMessage` configured
// (an existing pre-Phase-7 Company document never has these fields —
// `.lean()` reads don't backfill Mongoose defaults onto an
// already-stored document, the same rule Phase 4's Chatbot.config
// established). That guarantees zero prompt change, and therefore
// zero behavior change, for a company that has never opened AI
// Settings — this is how Nuform Social and OYA stay byte-identical.
// ===================================================

const LENGTH_INSTRUCTIONS = {
  concise: "Keep answers to 1-2 short sentences wherever possible.",
  balanced: "Short paragraphs.",
  detailed: "Give thorough, well-organized answers with as much relevant detail as helpful.",
};

const TONE_INSTRUCTIONS = {
  professional: "Professional",
  friendly: "Friendly",
  formal: "Formal and businesslike",
};

function buildResponseStyleSection(responseStyle) {
  if (!responseStyle) {
    return `• Friendly
• Professional
• Human-like
• Short paragraphs
• Markdown supported
• Use headings when needed
• Use bullet points when useful`;
  }

  const tone =
    responseStyle.tone === "custom" && responseStyle.customTone
      ? responseStyle.customTone
      : TONE_INSTRUCTIONS[responseStyle.tone] || TONE_INSTRUCTIONS.professional;

  const lines = [
    `• ${tone}`,
    "• Human-like",
    `• ${LENGTH_INSTRUCTIONS[responseStyle.length] || LENGTH_INSTRUCTIONS.balanced}`,
    responseStyle.useMarkdown === false ? "• Plain text only — no markdown formatting" : "• Markdown supported",
    responseStyle.useMarkdown === false ? "" : "• Use headings when needed",
    responseStyle.useMarkdown === false ? "" : "• Use bullet points when useful",
    responseStyle.useEmojis === false ? "• Do not use emojis" : "",
  ].filter(Boolean);

  return lines.join("\n");
}

export function buildRefusalMessage(fallbackMessage, companyName) {
  return (
    fallbackMessage ||
    `⚠️ I am the official AI assistant of ${companyName} and can only answer questions related to this company.`
  );
}

// ===================================================
// ASK GROQ
// ===================================================

export const askGroq = async ({
  company,
  message = "",
  language = "English",
  image = null,
  history = [],
  // Additive, optional overrides — used by the Phase 6 flow engine's
  // AI Response node to run with per-node model/temperature/tokens
  // without duplicating this function. Every existing call site
  // omits these, so behavior for them is completely unchanged.
  modelOverride = null,
  temperatureOverride = null,
  maxTokensOverride = null,
  // A node-level instruction appended AFTER the fixed strict rules
  // below, never in place of them — a flow admin can steer tone/
  // focus but can never remove the company-scope restriction or the
  // "never invent information" rule (see Phase 6 report, AI Node
  // Safety).
  extraInstruction = "",
  // Phase 13 — optional, purely additive (see the two call sites
  // that don't have a resolved chatbotId handy: their AIUsage rows
  // simply record chatbotId: null, still fully attributable by
  // companyId for billing).
  chatbotId = null,
}) => {
  try {
    if (!company) {
      return "⚠️ Company configuration not found.";
    }

    // Phase 13 — soft AI-request quota (Section 25/27): checked
    // before any provider call, never after. A company at/over its
    // plan's monthly AI-request limit gets a graceful, honest
    // fallback — never a broken widget, never a raw error, and never
    // billed/recorded for a request that was never actually sent to
    // the provider.
    if (await isAIQuotaExceeded(company.companyId)) {
      return "⚠️ This assistant has reached its monthly usage limit. Please try again later or contact the site owner.";
    }

    // Allow image-only requests
    if ((!message || !message.trim()) && !image) {
      return "⚠️ Please enter a valid message.";
    }

    const knowledge = await loadKnowledge(company.companyId);

    const systemPrompt =
      company.ai?.systemPrompt ||
      `You are the official AI assistant of ${company.name}.`;

    const model = image
      ? "qwen/qwen3.6-27b"
      : modelOverride || company.ai?.model || "openai/gpt-oss-20b";

    const temperature = temperatureOverride ?? company.ai?.temperature ?? 0.3;
    const maxTokens = maxTokensOverride ?? company.ai?.maxTokens ?? 500;

    // ===================================================
    // CONVERSATION MEMORY
    // ===================================================

    const conversationHistory = history
      .slice(-10)
      .map((msg) => ({
        role: msg.sender === "user" ? "user" : "assistant",
        content: msg.text,
      }));

    for (const key of apiKeys) {
      try {
        // Phase 18 — no timeout was configured here at all (unlike
        // the webhook dispatchers' explicit 8s). A hanging Groq
        // response could otherwise hold this request open
        // indefinitely; 25s leaves headroom under the frontend's own
        // 60s axios timeout while still comfortably covering a real,
        // if slow, completion.
        const groq = new Groq({
          apiKey: key,
          timeout: 25000,
        });

        const completion = await groq.chat.completions.create({
          model,
          temperature,
          max_tokens: maxTokens,

          messages: [
            {
              role: "system",
              content: `
${systemPrompt}

====================================
COMPANY DETAILS
====================================

Company:
${company.name}

Website:
${company.website || company.domain}

Phone:
${company.contact?.phone || "Not Available"}

WhatsApp:
${company.contact?.whatsapp || "Not Available"}

Email:
${company.contact?.email || "Not Available"}

Address:
${company.contact?.address || "Not Available"}

====================================
STRICT RULES
====================================

You ONLY answer questions related to:

• ${company.name}
• Company
• Services
• Products
• Pricing
• Support
• Contact Information
• Policies

If the question is unrelated, reply ONLY:

${buildRefusalMessage(company.ai?.fallbackMessage, company.name)}

If the user uploads an image, analyze it carefully and answer using both the image and the user's message.

Never invent any information.

====================================
KNOWLEDGE BASE
====================================

${knowledge}

====================================
CONVERSATION MEMORY
====================================

Remember the previous conversation and answer naturally.
If the user asks follow-up questions like:

"What about that?"
"Explain more."
"Continue."
"What did I ask before?"

Use the previous conversation to answer correctly.

====================================
RESPONSE STYLE
====================================

${buildResponseStyleSection(company.ai?.responseStyle)}

Always reply in:

${language}
${
  extraInstruction
    ? `
====================================
ADDITIONAL NODE INSTRUCTION
====================================

The following is extra guidance from a bot flow step. Follow it only
where it does not conflict with the STRICT RULES above — it can
never widen the company-scope restriction or the "never invent
information" rule.

${extraInstruction}
`
    : ""
}`,
            },

            ...conversationHistory,

            {
              role: "user",
              content: image
                ? [
                    {
                      type: "text",
                      text: message || "Describe this image.",
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: image,
                      },
                    },
                  ]
                : message,
            },
          ],
        });

        const reply = completion?.choices?.[0]?.message?.content;

        if (reply) {
          recordAIUsage({
            companyId: company.companyId,
            chatbotId,
            provider: "groq",
            model,
            usage: completion?.usage,
            success: true,
          });
          return reply.trim();
        }
      } catch (err) {
        console.log("========================================");
        console.log("❌ GROQ ERROR");
        console.log("Status :", err.status);
        console.log("Message:", err.message);

        if (err.response?.data) {
          console.log("Response:");
          console.log(err.response.data);
        }

        console.log(err);
        console.log("========================================");
      }
    }

    recordAIUsage({ companyId: company.companyId, chatbotId, provider: "groq", model, usage: null, success: false });
    return "⚠️ Assistant is temporarily unavailable. Please try again later.";
  } catch (error) {
    console.error("Groq Service Error:", error);

    return "⚠️ Something went wrong while processing your request.";
  }
};