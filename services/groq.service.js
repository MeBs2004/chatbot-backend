import dotenv from "dotenv";
dotenv.config();

import Groq from "groq-sdk";
import fs from "fs";
import path from "path";

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
// ===================================================

const knowledgeCache = new Map();

const loadKnowledge = (knowledgeFile) => {
  if (!knowledgeFile) return "";

  if (knowledgeCache.has(knowledgeFile)) {
    return knowledgeCache.get(knowledgeFile);
  }

  try {
    const filePath = path.resolve(process.cwd(), knowledgeFile);

    const knowledge = fs.readFileSync(filePath, "utf8");

    knowledgeCache.set(knowledgeFile, knowledge);

    console.log(`✅ Knowledge Loaded -> ${knowledgeFile}`);

    return knowledge;
  } catch (err) {
    console.error(`Knowledge File Error: ${err.message}`);
    return "";
  }
};

// ===================================================
// ASK GROQ
// ===================================================

export const askGroq = async ({
  company,
  message,
  language = "English",
}) => {
  try {
    if (!company) {
      return "⚠️ Company configuration not found.";
    }

    if (!message?.trim()) {
      return "⚠️ Please enter a valid message.";
    }

    const knowledge = loadKnowledge(company.knowledgeFile);

    const systemPrompt =
      company.ai?.systemPrompt ||
      `You are the official AI assistant of ${company.name}.`;

    const model =
      company.ai?.model || "llama-3.1-8b-instant";

    const temperature =
      company.ai?.temperature ?? 0.3;

    const maxTokens =
      company.ai?.maxTokens ?? 500;

    for (const key of apiKeys) {
      try {
        const groq = new Groq({
          apiKey: key,
        });

        const completion =
          await groq.chat.completions.create({
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
• Pricing (only if available)
• Support
• Contact Information
• Policies

If the question is unrelated, reply ONLY:

⚠️ I am the official AI assistant of ${company.name} and can only answer questions related to this company.

Never invent:

• Prices
• Discounts
• Products
• Services
• Contact details
• Policies

If information is unavailable, politely ask the user to contact the company.

====================================
KNOWLEDGE BASE
====================================

${knowledge}

====================================
RESPONSE STYLE
====================================

• Friendly
• Professional
• Human-like
• Short paragraphs
• Markdown supported
• Use headings when needed
• Use bullet points when useful

Always reply in:

${language}
`,
              },
              {
                role: "user",
                content: message,
              },
            ],
          });

        const reply =
          completion?.choices?.[0]?.message?.content;

        if (reply) {
          return reply.trim();
        }
      } catch (err) {
        console.warn(
          "⚠️ Groq API key failed. Trying next key..."
        );
      }
    }

    return "⚠️ Assistant is temporarily unavailable. Please try again later.";
  } catch (error) {
    console.error("Groq Service Error:", error);

    return "⚠️ Something went wrong while processing your request.";
  }
};