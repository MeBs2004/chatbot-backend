import { PUBLIC_SAFE_EVENTS } from "./events.js";

// Phase 15 — tiny singleton so services (conversation.service.js,
// chatbot.controller.js, visitor.controller.js) can emit domain
// events without importing the whole socket.server.js bootstrap or
// threading `io` through every function call. Set once at startup by
// socket.server.js; safe no-op if realtime never initialized (e.g. a
// unit/script context that imports a service directly) — emitting an
// event must never be able to break the request that triggered it.
let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function companyRoom(companyId) {
  return `company:${companyId}`;
}

export function chatbotRoom(chatbotId) {
  return `chatbot:${chatbotId}`;
}

export function conversationRoom(companyId, visitorId) {
  return `conversation:${companyId}:${visitorId}`;
}

export function widgetChatbotRoom(chatbotId) {
  return `widget-chatbot:${chatbotId}`;
}

// Every admin socket auto-joins its own `user:<id>` room on connect
// (socket.server.js) — used for account-level events (role/status/
// access changes) that aren't scoped to any one company.
export function userRoom(userId) {
  return `user:${userId}`;
}

/**
 * Emits a domain event to every authorized admin room for it, and —
 * only for the small whitelist in PUBLIC_SAFE_EVENTS — to the public
 * widget room too, using `publicPayload` (never the same payload as
 * the admin one; see chatbot.config.updated call sites, which always
 * pass a separately-built, already-whitelisted config object here,
 * never the raw Chatbot document).
 *
 * `payload` should be minimal per Section 10 of the spec: entity id +
 * companyId + changed fields + timestamp, not the full document —
 * callers that need the fresh document already get it back from the
 * REST response; the event's job is telling OTHER open clients to
 * refetch, not to replace REST as the data source.
 */
export function emitDomainEvent(type, { companyId, chatbotId, conversationId, userId, payload = {}, publicPayload } = {}) {
  if (!ioInstance) return;

  const event = {
    type,
    companyId: companyId || null,
    chatbotId: chatbotId || null,
    conversationId: conversationId || null,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  const admin = ioInstance.of("/admin");
  if (companyId) admin.to(companyRoom(companyId)).emit("domain:event", event);
  if (chatbotId) admin.to(chatbotRoom(chatbotId)).emit("domain:event", event);
  if (conversationId && companyId) {
    admin.to(conversationRoom(companyId, conversationId)).emit("domain:event", event);
  }
  if (userId) admin.to(userRoom(userId)).emit("domain:event", event);

  if (chatbotId && PUBLIC_SAFE_EVENTS.has(type) && publicPayload) {
    ioInstance.of("/widget").to(widgetChatbotRoom(chatbotId)).emit("domain:event", {
      type,
      chatbotId,
      timestamp: event.timestamp,
      ...publicPayload,
    });
  }
}

/**
 * Forcibly drops every open admin socket for this user — used when a
 * user is deactivated/suspended. The REST layer already re-checks
 * `AdminUser.status` on every request (adminAuthMiddleware), so this
 * isn't what makes deactivation "secure"; it closes the narrower gap
 * where an already-open socket would otherwise keep silently
 * receiving room broadcasts (company/chatbot updates) after their
 * account was disabled, until whatever happened to make them
 * reconnect on their own.
 */
export function disconnectUserSockets(userId) {
  if (!ioInstance) return;
  ioInstance.of("/admin").in(userRoom(userId)).disconnectSockets(true);
}
