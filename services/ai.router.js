import { askGroq } from "./groq.service.js";
// import { askGemini } from "./gemini.service.js";
// import { askOpenAI } from "./openai.service.js";
// import { askOllama } from "./ollama.service.js";

export const askAI = async ({
  company,
  message,
  language = "English",
}) => {
  if (!company) {
    throw new Error("Company object is required.");
  }

  const provider = company.ai?.provider || "groq";

  switch (provider) {
    case "groq":
      return await askGroq({
        company,
        message,
        language,
      });

    /*
    case "gemini":
      return await askGemini({
        company,
        message,
        language,
      });

    case "openai":
      return await askOpenAI({
        company,
        message,
        language,
      });

    case "ollama":
      return await askOllama({
        company,
        message,
        language,
      });
    */

    default:
      return await askGroq({
        company,
        message,
        language,
      });
  }
};