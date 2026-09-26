import Conversation from "../../models/conversation.model.js";

// ======================================================
// WEBSITE PROVIDER (Phase 10)
// The first real channel (Phase 5). No OAuth/token handshake exists
// for it, so "Connected" can't mean "credentials validated" the way
// Telegram's can — it's defined honestly instead: CONNECTED means
// this chatbot has processed at least one real conversation through
// the widget. A chatbot that has never received a message is
// NOT_CONNECTED, not falsely shown as ready.
// ======================================================

export const meta = {
  key: "website",
  label: "Website",
  category: "channel",
  scope: "CHATBOT",
  description: "The public chat widget (see Phase 5 Installation).",
};

export async function getStatus({ chatbotId }) {
  const hasConversation = await Conversation.exists({ chatbotId });
  return hasConversation ? "CONNECTED" : "NOT_CONNECTED";
}
