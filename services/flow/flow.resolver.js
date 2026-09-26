import ChatbotFlow from "../../models/chatbotFlow.model.js";
import { resolveSingleChatbotId } from "../chatbot.resolver.js";

/**
 * Returns the active PUBLISHED flow for this company's chatbot, or
 * `null` if there isn't one — the single opt-in gate for the whole
 * flow engine. A chatbot with no published flow is completely
 * unaffected by anything in this module.
 */
export async function resolvePublishedFlow(companyId) {
  const chatbotId = await resolveSingleChatbotId(companyId);
  if (!chatbotId) return null;

  const flow = await ChatbotFlow.findOne({ chatbotId, status: "PUBLISHED" }).lean();
  if (!flow) return null;

  return { chatbotId, flow };
}
