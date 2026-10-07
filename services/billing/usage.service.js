import Chatbot from "../../models/chatbot.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ApiKey from "../../models/apiKey.model.js";
import DeveloperWebhook from "../../models/developerWebhook.model.js";
import AIUsage from "../../models/aiUsage.model.js";
import ApiUsage from "../../models/apiUsage.model.js";
import { computeAnalytics } from "../analytics.service.js";
import { getCompanyPlan } from "./plan.service.js";

// ======================================================
// USAGE ENGINE (Phase 13)
// Every metric below is computed from a real, already-existing data
// source — nothing here introduces a second copy of telemetry:
//
//   visitors/conversations  -> analytics.service.js's computeAnalytics
//                              (the SAME engine the Analytics page
//                              uses — Section 16/17's "prefer
//                              existing lifecycle data" satisfied by
//                              literal reuse, not a re-derivation)
//   AI requests/tokens      -> AIUsage (Phase 13, real provider usage)
//   API requests            -> ApiUsage (Phase 12, reused verbatim,
//                              never duplicated — Section 20)
//   webhook deliveries      -> DeveloperWebhook.totalDeliveries/
//                              totalFailures (Phase 12 counters,
//                              reused verbatim — Section 21)
//   chatbots/members/keys/
//   webhooks (current count) -> live counts, not period-bound (these
//                              are "how many do you have right now",
//                              not "how many did you create this
//                              period" — matches how their quotas are
//                              enforced elsewhere in this phase)
//
// BILLING DEFINITION (Section 16/17, documented explicitly): a
// "visitor" for billing is the same as Phase 9's `visitors` metric —
// a distinct visitorId with at least one message in the period (an
// ACTIVE visitor), not a raw Visitor document count and not
// `newVisitors` alone. A "conversation" is a Conversation document
// whose `startedAt` falls in the period, regardless of its current
// status (OPEN/PENDING/CLOSED) — started-in-period, counted once,
// matching computeAnalytics's own `conversations` metric exactly.
// ======================================================

export async function computeUsage(companyId, { since, until }) {
  const companyFilter = { companyId };

  const [{ metrics: analyticsMetrics }, aiAgg, apiAgg, webhookAgg, chatbotCount, memberCount, apiKeyCount, webhookCount] =
    await Promise.all([
      computeAnalytics({ companyFilter, chatbotId: null }, { since, until }),
      AIUsage.aggregate([
        { $match: { companyId, createdAt: { $gte: since, $lt: until } } },
        {
          $group: {
            _id: null,
            requests: { $sum: 1 },
            successfulRequests: { $sum: { $cond: ["$success", 1, 0] } },
            promptTokens: { $sum: "$promptTokens" },
            completionTokens: { $sum: "$completionTokens" },
            totalTokens: { $sum: "$totalTokens" },
          },
        },
      ]),
      ApiUsage.aggregate([
        { $match: { companyId, createdAt: { $gte: since, $lt: until } } },
        { $group: { _id: null, requests: { $sum: 1 } } },
      ]),
      DeveloperWebhook.aggregate([
        { $match: { companyId } },
        { $group: { _id: null, deliveries: { $sum: "$totalDeliveries" }, failures: { $sum: "$totalFailures" } } },
      ]),
      Chatbot.countDocuments({ companyId, deletedAt: null }),
      UserCompanyAccess.countDocuments({ companyId, status: "ACTIVE" }),
      ApiKey.countDocuments({ companyId, status: "ACTIVE" }),
      DeveloperWebhook.countDocuments({ companyId }),
    ]);

  const ai = aiAgg[0] || { requests: 0, successfulRequests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const api = apiAgg[0] || { requests: 0 };
  const wh = webhookAgg[0] || { deliveries: 0, failures: 0 };

  return {
    visitors: analyticsMetrics.visitors,
    conversations: analyticsMetrics.conversations,
    messages: analyticsMetrics.messages,
    aiRequests: ai.requests,
    aiTokens: ai.totalTokens,
    aiPromptTokens: ai.promptTokens,
    aiCompletionTokens: ai.completionTokens,
    apiRequests: api.requests,
    webhookDeliveries: wh.deliveries,
    webhookFailures: wh.failures,
    chatbots: chatbotCount,
    members: memberCount,
    apiKeys: apiKeyCount,
    developerWebhooks: webhookCount,
  };
}

// Thresholds (Section 23) — centralized here, the one place a
// "healthy" vs "approaching" vs "reached" boundary is defined.
function statusFor(used, limit) {
  if (limit === undefined) return "NOT_TRACKED";
  if (limit === Infinity) return "UNLIMITED";
  if (limit === 0) return used > 0 ? "OVER_LIMIT" : "HEALTHY";
  const pct = (used / limit) * 100;
  if (pct >= 100) return used > limit ? "OVER_LIMIT" : "LIMIT_REACHED";
  if (pct >= 90) return "LIMIT_REACHED";
  if (pct >= 70) return "APPROACHING";
  return "HEALTHY";
}

// metric key -> plan limit key, only for metrics that have a defined
// quota. Metrics with no entry here (messages, webhookDeliveries,
// webhookFailures, aiPromptTokens/aiCompletionTokens) are real,
// displayed numbers with no quota attached — "NOT_TRACKED".
const LIMIT_KEY_BY_METRIC = {
  visitors: "maxMonthlyVisitors",
  conversations: "maxMonthlyConversations",
  aiRequests: "maxAIRequests",
  chatbots: "maxChatbots",
  members: "maxMembers",
  apiKeys: "maxAPIKeys",
  developerWebhooks: "maxDeveloperWebhooks",
};

/**
 * Real usage for the company's CURRENT billing period, each metric
 * paired with its plan limit (if any) and a centralized status.
 */
export async function getUsageWithLimits(companyId) {
  const { account, plan } = await getCompanyPlan(companyId);
  const usage = await computeUsage(companyId, { since: account.currentPeriodStart, until: account.currentPeriodEnd });

  const result = {};
  for (const [metric, used] of Object.entries(usage)) {
    const limitKey = LIMIT_KEY_BY_METRIC[metric];
    const limit = limitKey ? plan.limits[limitKey] : undefined;
    result[metric] = {
      used,
      limit: limit === undefined ? null : limit === Infinity ? null : limit,
      unlimited: limit === Infinity,
      remaining: limit === undefined || limit === Infinity ? null : Math.max(0, limit - used),
      percent: limit === undefined || limit === Infinity || limit === 0 ? null : Math.min(999, Math.round((used / limit) * 100)),
      status: statusFor(used, limit),
    };
  }

  return {
    period: { start: account.currentPeriodStart, end: account.currentPeriodEnd },
    planId: plan.id,
    usage: result,
  };
}
