// Phase 15 — the single source of truth for realtime event names.
// Nothing outside this file should emit an arbitrary string as an
// event type. Every name below is namespaced `entity.action` per the
// task spec (Section 9).
//
// WIRED    — actually emitted somewhere in this codebase today (see
//             the call site noted next to each).
// RESERVED — named now so the contract is stable and nothing collides
//             later, but not emitted yet. Listed honestly rather than
//             faked — see the Phase 15 report's "Entities Connected"
//             table for why each is deferred.
export const EVENTS = {
  // WIRED — backend/services/conversation.service.js
  CONVERSATION_CREATED: "conversation.created",
  CONVERSATION_UPDATED: "conversation.updated",
  CONVERSATION_ASSIGNED: "conversation.assigned",
  CONVERSATION_CLOSED: "conversation.closed",
  MESSAGE_CREATED: "message.created",

  // WIRED — backend/controllers/visitor.controller.js
  VISITOR_CREATED: "visitor.created",
  VISITOR_UPDATED: "visitor.updated",

  // WIRED — backend/controllers/admin/chatbot.controller.js
  CHATBOT_CREATED: "chatbot.created",
  CHATBOT_UPDATED: "chatbot.updated",
  CHATBOT_CONFIG_UPDATED: "chatbot.config.updated",

  // RESERVED — there is no chatbot-deletion endpoint anywhere in this
  // codebase today (confirmed: no route, no controller function).
  // Named now so the contract already has the slot if that CRUD gap
  // is ever filled; not claimed as wired since nothing emits it.
  CHATBOT_DELETED: "chatbot.deleted",

  // RESERVED — company-level mutation events exist in
  // controllers/admin/company.controller.js but are not yet wired to
  // emit; the admin Companies list already refetches on its own
  // mutations (create/edit happen from the same page), so the value
  // of a push event there is low relative to the other entities.
  COMPANY_UPDATED: "company.updated",

  // RESERVED — knowledge base has no processing/status pipeline to
  // report progress from (see Phase 15 report); wiring this event now
  // would imply a state machine that does not exist yet.
  KNOWLEDGE_CREATED: "knowledge.created",
  KNOWLEDGE_UPDATED: "knowledge.updated",
  KNOWLEDGE_DELETED: "knowledge.deleted",

  // RESERVED — AI settings are a sub-document of Chatbot.settings;
  // CHATBOT_UPDATED already fires on that save path today. A
  // dedicated event was judged unnecessary duplication rather than
  // deferred for lack of a hook point.
  AI_SETTINGS_UPDATED: "ai.settings.updated",

  // WIRED (Phase 16) — backend/controllers/admin/user.controller.js.
  // Targeted at the affected user's own `user:<id>` room (io.js's
  // `userId` param), not any company room — this is account-level,
  // not tenant data. USER_UPDATED only covers a role change while the
  // account stays ACTIVE (the frontend reacts by refetching
  // /auth/me); status changes and access revocation instead call
  // `disconnectUserSockets` directly (a forced reconnect, which
  // re-runs auth/authorization from scratch, is simpler and more
  // certainly-correct than trying to push a "your permissions
  // shrank" event the client must interpret perfectly).
  USER_UPDATED: "user.updated",
  ACCESS_UPDATED: "access.updated",

  // RESERVED — see Phase 15/16 report, Deferred Work.
  ANALYTICS_UPDATED: "analytics.updated",
  INTEGRATION_CREATED: "integration.created",
  INTEGRATION_UPDATED: "integration.updated",
  INTEGRATION_DELETED: "integration.deleted",
  USER_CREATED: "user.created",
  USER_DELETED: "user.deleted",
  BILLING_UPDATED: "billing.updated",
  USAGE_UPDATED: "usage.updated",
  DEVELOPER_API_KEY_CREATED: "developer.apiKey.created",
  DEVELOPER_API_KEY_REVOKED: "developer.apiKey.revoked",
  DEVELOPER_WEBHOOK_UPDATED: "developer.webhook.updated",

  // WIRED — backend/services/admin/task.service.js
  TASK_CREATED: "task.created",
  TASK_UPDATED: "task.updated",
  TASK_ASSIGNED: "task.assigned",
  TASK_DELETED: "task.deleted",
};

// Event types safe to relay, in a whitelisted form, to the
// unauthenticated public `/widget` namespace. Everything else is
// admin-only by default — this list is the only exception, and
// socket.server.js's public relay logic is the only code path that
// reads it.
export const PUBLIC_SAFE_EVENTS = new Set([EVENTS.CHATBOT_CONFIG_UPDATED]);
