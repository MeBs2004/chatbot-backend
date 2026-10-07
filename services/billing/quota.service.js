import Chatbot from "../../models/chatbot.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ApiKey from "../../models/apiKey.model.js";
import DeveloperWebhook from "../../models/developerWebhook.model.js";
import AIUsage from "../../models/aiUsage.model.js";
import { getCompanyPlan } from "./plan.service.js";

// ======================================================
// QUOTA ENFORCEMENT (Phase 13, Section 24/25)
// Real backend checks, not just a UI message — every hard-enforced
// limit below is called from its creation controller BEFORE the
// resource is created. Only limits that map to a real, already-
// tracked collection are hard-enforced (chatbots, team members, API
// keys, developer webhooks); visitor/conversation/AI-request quotas
// are intentionally NOT hard-blocking anywhere on the public widget
// path (Section 27) — see PHASE_13_REPORT for the reasoning. AI
// requests get their own soft check (isAIQuotaExceeded) used only by
// the AI reply path itself, which can degrade gracefully instead of
// throwing.
//
// Known limitation (Section 58): each check is "count, then create"
// — not atomic. Two simultaneous creation requests landing in the
// same instant could both read a count one below the limit and both
// succeed, exceeding it by one. Documented, not solved with
// distributed locking (no infrastructure for that here); the
// realistic blast radius is "one extra chatbot/key/webhook/member
// briefly over quota", not a security or data-integrity issue.
// ======================================================

export class QuotaExceededError extends Error {
  constructor(message, limitKey) {
    super(message);
    this.name = "QuotaExceededError";
    this.limitKey = limitKey;
    this.status = 402;
  }
}

async function assertLimit(companyId, limitKey, countFn, label) {
  const { plan } = await getCompanyPlan(companyId);
  const limit = plan.limits[limitKey];
  if (limit === undefined || limit === Infinity) return; // not tracked on this plan, or unlimited

  const current = await countFn();
  if (current >= limit) {
    throw new QuotaExceededError(
      `You've reached your plan's ${label} limit (${limit}). Upgrade your plan to add more.`,
      limitKey
    );
  }
}

export const assertChatbotQuota = (companyId) =>
  assertLimit(companyId, "maxChatbots", () => Chatbot.countDocuments({ companyId, deletedAt: null }), "chatbot");

export const assertMemberQuota = (companyId) =>
  assertLimit(
    companyId,
    "maxMembers",
    () => UserCompanyAccess.countDocuments({ companyId, status: "ACTIVE" }),
    "team member"
  );

export const assertApiKeyQuota = (companyId) =>
  assertLimit(companyId, "maxAPIKeys", () => ApiKey.countDocuments({ companyId, status: "ACTIVE" }), "API key");

export const assertWebhookQuota = (companyId) =>
  assertLimit(
    companyId,
    "maxDeveloperWebhooks",
    () => DeveloperWebhook.countDocuments({ companyId }),
    "developer webhook"
  );

/**
 * Soft check used only by the AI reply path (services/groq.service.js)
 * — returns a boolean rather than throwing, since the caller needs to
 * degrade to a graceful fallback reply, never a hard error surfaced
 * to a public, unauthenticated visitor (Section 27).
 */
export async function isAIQuotaExceeded(companyId) {
  const { plan, account } = await getCompanyPlan(companyId);
  const limit = plan.limits.maxAIRequests;
  if (limit === undefined || limit === Infinity) return false;

  const count = await AIUsage.countDocuments({
    companyId,
    createdAt: { $gte: account.currentPeriodStart, $lt: account.currentPeriodEnd },
  });
  return count >= limit;
}
