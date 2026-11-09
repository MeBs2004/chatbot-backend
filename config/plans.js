// ======================================================
// PLAN CONFIGURATION
// The single source of truth for plan limits/features — same
// convention as config/aiConfig.js and config/chatbotConfig.js
// (a static, centrally-reviewed config object, not scattered
// `if (company.plan === "PRO")` checks). Read exclusively through
// services/billing/plan.service.js.
//
// PRICING: real, decided prices (INR/month) — Starter is genuinely
// free forever; Growth and Enterprise are real self-reported prices,
// not yet collected by a payment provider (none is configured — see
// services/billing/billingProvider.js). A company's `planId` can
// still be changed to a paid tier WITHOUT payment, but only by a
// SUPER_ADMIN (see billing.controller.js's changePlan) — that's the
// platform owner manually granting/comping a plan, not a customer
// self-checkout, since there's no provider to actually charge them.
//
// LIMITS: Starter/Growth/Enterprise numbers below are the platform's
// real, decided pricing-page numbers. STARTER and PRO tiers that used
// to exist here were never reachable by any company (every non-FREE
// plan change was blocked pre-SUPER_ADMIN-override) and have been
// removed rather than kept as unused dead tiers. `Infinity` means
// genuinely unlimited for that plan.
//
// FEATURES: Starter deliberately does NOT include bot_builder,
// live_view, or advanced_analytics — Growth adds those three. Growth
// does NOT include roles_permissions, audit_logs, or
// chatbot_access_assignment — Enterprise adds those three. This is an
// intentional, real feature-gating change (see the services that
// call hasFeature() for enforcement): Nuform Social and OYA, the two
// real companies that were previously on FREE with every feature
// unlocked, have been granted ENTERPRISE for free via the SUPER_ADMIN
// override so this change never removes functionality they already
// use — see PHASE 14 notes.
// ======================================================

export const PLAN_IDS = ["FREE", "GROWTH", "ENTERPRISE"];

export const PLANS = Object.freeze({
  FREE: {
    id: "FREE",
    name: "Starter",
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
      advanced_analytics: false,
      live_view: false,
      bot_builder: false,
      roles_permissions: false,
      audit_logs: false,
      chatbot_access_assignment: false,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      advanced_channels: true,
    },
  },
  GROWTH: {
    id: "GROWTH",
    name: "Growth",
    monthlyPrice: 2499,
    yearlyPrice: null,
    currency: "INR",
    limits: {
      maxChatbots: 5,
      maxMembers: 15,
      maxMonthlyVisitors: 10000,
      maxMonthlyConversations: 2500,
      maxAIRequests: 5000,
      maxAPIKeys: 15,
      maxDeveloperWebhooks: 15,
    },
    features: {
      custom_branding: true,
      advanced_analytics: true,
      live_view: true,
      bot_builder: true,
      roles_permissions: false,
      audit_logs: false,
      chatbot_access_assignment: false,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      advanced_channels: true,
    },
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    monthlyPrice: 7999,
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
      live_view: true,
      bot_builder: true,
      roles_permissions: true,
      audit_logs: true,
      chatbot_access_assignment: true,
      human_handoff: true,
      developer_api: true,
      developer_webhooks: true,
      knowledge_base: true,
      advanced_channels: true,
    },
  },
});

export function getPlanConfig(planId) {
  return PLANS[planId] || null;
}
