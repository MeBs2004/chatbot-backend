// ======================================================
// PLAN CONFIGURATION (Phase 13)
// The single source of truth for plan limits/features — same
// convention as config/aiConfig.js and config/chatbotConfig.js
// (a static, centrally-reviewed config object, not scattered
// `if (company.plan === "PRO")` checks). Read exclusively through
// services/billing/plan.service.js.
//
// PRICING: no real pricing has been decided for this platform (no
// payment provider is configured — see PHASE_13_REPORT). FREE is
// genuinely $0 (a real, decided price — "free" needs no payment
// provider to be true). Every paid tier has `monthlyPrice: null` /
// `yearlyPrice: null` on purpose: the UI renders "Contact Sales" for
// a null price rather than inventing a number. Do not fill these in
// without a real, decided price.
//
// LIMITS: chosen as sensible, real, enforceable defaults — not
// copied from a competitor, and deliberately generous relative to
// this platform's actual current usage (Nuform Social and OYA, both
// on FREE after migration, use a small fraction of every FREE-tier
// limit below — verified live before choosing these numbers, see
// the report). `Infinity` means genuinely unlimited for that plan.
//
// FEATURES: every feature already fully built in this codebase
// (human_handoff, knowledge_base, bot_builder, developer_api,
// developer_webhooks, advanced_analytics, advanced_channels) is
// `true` on every plan, including FREE — turning any of these off
// for FREE would revoke functionality Nuform Social/OYA already use
// today, which is exactly what this phase must never do.
// `custom_branding` is the one forward-looking flag with no real
// enforcement point wired yet (see Known Limitations) — its value is
// `false` on every real plan today, so defining it changes nothing.
// ======================================================

export const PLAN_IDS = ["FREE", "STARTER", "GROWTH", "PRO", "ENTERPRISE"];

export const PLANS = Object.freeze({
  FREE: {
    id: "FREE",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: "INR",
    limits: {
      maxChatbots: 1,
      maxMembers: 3,
      maxMonthlyVisitors: 500,
      maxMonthlyConversations: 200,
      maxAIRequests: 500,
      maxAPIKeys: 2,
      maxDeveloperWebhooks: 2,
    },
    features: {
      custom_branding: false,
      advanced_analytics: true,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      bot_builder: true,
      advanced_channels: true,
    },
  },
  STARTER: {
    id: "STARTER",
    name: "Starter",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    limits: {
      maxChatbots: 3,
      maxMembers: 10,
      maxMonthlyVisitors: 2500,
      maxMonthlyConversations: 1000,
      maxAIRequests: 2500,
      maxAPIKeys: 5,
      maxDeveloperWebhooks: 5,
    },
    features: {
      custom_branding: false,
      advanced_analytics: true,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      bot_builder: true,
      advanced_channels: true,
    },
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    limits: {
      maxChatbots: 10,
      maxMembers: 25,
      maxMonthlyVisitors: 10000,
      maxMonthlyConversations: 5000,
      maxAIRequests: 10000,
      maxAPIKeys: 15,
      maxDeveloperWebhooks: 15,
    },
    features: {
      custom_branding: true,
      advanced_analytics: true,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      bot_builder: true,
      advanced_channels: true,
    },
  },
  PRO: {
    id: "PRO",
    name: "Pro",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    limits: {
      maxChatbots: 25,
      maxMembers: 100,
      maxMonthlyVisitors: 50000,
      maxMonthlyConversations: 25000,
      maxAIRequests: 50000,
      maxAPIKeys: 50,
      maxDeveloperWebhooks: 50,
    },
    features: {
      custom_branding: true,
      advanced_analytics: true,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      bot_builder: true,
      advanced_channels: true,
    },
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    monthlyPrice: null,
    yearlyPrice: null,
    currency: "INR",
    limits: {
      maxChatbots: Infinity,
      maxMembers: Infinity,
      maxMonthlyVisitors: Infinity,
      maxMonthlyConversations: Infinity,
      maxAIRequests: Infinity,
      maxAPIKeys: Infinity,
      maxDeveloperWebhooks: Infinity,
    },
    features: {
      custom_branding: true,
      advanced_analytics: true,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      bot_builder: true,
      advanced_channels: true,
    },
  },
});

export function getPlanConfig(planId) {
  return PLANS[planId] || null;
}
