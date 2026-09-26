import Chatbot from "../models/chatbot.model.js";

/**
 * Determines whether a company's public chat endpoint should
 * respond normally or show a maintenance message.
 *
 * Rule (this is the exact, documented definition — see
 * ADMIN_API.md): the endpoint is blocked ONLY when every Chatbot
 * record for the company has been explicitly set to PAUSED or
 * OFFLINE. A company with zero Chatbot records, or with any record
 * left at the default DRAFT status, or with any LIVE record, is
 * never blocked. This means merely creating an admin Chatbot entry
 * (which defaults to DRAFT) can never take down a running public
 * bot — only a deliberate PAUSED/OFFLINE action can.
 */
export const getChatbotAvailability = async (companyId) => {
  const chatbots = await Chatbot.find({ companyId }).select("status").lean();

  if (chatbots.length === 0) {
    return { blocked: false };
  }

  const allExplicitlyDown = chatbots.every(
    (b) => b.status === "PAUSED" || b.status === "OFFLINE"
  );

  if (!allExplicitlyDown) {
    return { blocked: false };
  }

  const allOffline = chatbots.every((b) => b.status === "OFFLINE");

  return {
    blocked: true,
    reason: allOffline ? "offline" : "paused",
  };
};
