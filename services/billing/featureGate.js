import { hasFeature } from "./plan.service.js";
import Chatbot from "../../models/chatbot.model.js";
import { getAccessibleCompanyIds } from "../admin/access.service.js";

// ======================================================
// FEATURE GATING — real backend checks tied to a company's plan
// (config/plans.js), same "count/check before acting" discipline as
// quota.service.js. SUPER_ADMIN always bypasses (the platform owner,
// not bound by any company's plan). Every other requester is checked
// against the COMPANY they're acting on, never a client-supplied flag.
// ======================================================

const UPGRADE_HINTS = {
  bot_builder: "Bot Builder is available on the Growth plan and above.",
  live_view: "Live View is available on the Growth plan and above.",
  advanced_analytics: "Analytics & Reports are available on the Growth plan and above.",
  roles_permissions: "Roles & Permissions are available on the Enterprise plan.",
  audit_logs: "Audit Logs are available on the Enterprise plan.",
  chatbot_access_assignment: "Assigning chatbot access to team members is available on the Enterprise plan.",
};

/**
 * Returns true (and sends nothing) if the requester may proceed;
 * sends a 402 upgrade response and returns false otherwise. Mirrors
 * the `if (!(await requirePermission(...))) return;` pattern already
 * used by billing.controller.js/admin controllers.
 */
export async function requireFeature(req, res, companyId, featureKey) {
  if (req.adminUser?.role === "SUPER_ADMIN") return true;
  if (!companyId) {
    res.status(400).json({ success: false, message: "companyId is required." });
    return false;
  }
  const allowed = await hasFeature(companyId, featureKey);
  if (!allowed) {
    res.status(402).json({
      success: false,
      code: "PLAN_FEATURE_LOCKED",
      feature: featureKey,
      message: UPGRADE_HINTS[featureKey] || "This feature isn't included in your current plan. Upgrade to unlock it.",
    });
    return false;
  }
  return true;
}

/**
 * Several existing pages (LiveView, Reports/Analytics) never send a
 * companyId at all for a non-SUPER_ADMIN requester — the controller
 * resolves scope internally from req.adminUser (access.service.js's
 * getAccessibleCompanyIds/getScopeFilter). A feature gate on those
 * routes has to resolve the same way instead of either 400ing (no
 * companyId to check) or silently letting everything through. This is
 * a product gate, not the tenant-isolation boundary (getScopeFilter
 * still owns that), so for a requester with access to more than one
 * company it's deliberately lenient: allowed if ANY accessible company
 * carries the feature.
 */
async function hasFeatureAcrossAccessibleCompanies(adminUser, featureKey) {
  const companyIds = await getAccessibleCompanyIds(adminUser);
  if (companyIds === null || companyIds.length === 0) return true;
  const checks = await Promise.all(companyIds.map((id) => hasFeature(id, featureKey)));
  return checks.some(Boolean);
}

function sendFeatureLocked(res, featureKey) {
  res.status(402).json({
    success: false,
    code: "PLAN_FEATURE_LOCKED",
    feature: featureKey,
    message: UPGRADE_HINTS[featureKey] || "This feature isn't included in your current plan. Upgrade to unlock it.",
  });
}

/**
 * Express middleware factory for routes shaped `/:id/...` where `:id`
 * is a chatbotId — resolves that chatbot's companyId once, then
 * applies requireFeature. 404s (rather than 402) for a chatbot the
 * route can't find at all, matching this codebase's existing
 * "404 for missing, not just unauthorized" convention.
 */
export function requireFeatureForChatbotRoute(featureKey) {
  return async (req, res, next) => {
    if (req.adminUser?.role === "SUPER_ADMIN") return next();
    const chatbot = await Chatbot.findById(req.params.id).select("companyId deletedAt").lean();
    if (!chatbot || chatbot.deletedAt) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }
    if (!(await requireFeature(req, res, chatbot.companyId, featureKey))) return;
    next();
  };
}

/**
 * Express middleware factory for routes that take `companyId` as a
 * query/body param directly (e.g. live view's company-panel variant)
 * rather than resolving it via a chatbot id.
 */
export function requireFeatureForCompanyParam(featureKey, source = "query") {
  return async (req, res, next) => {
    if (req.adminUser?.role === "SUPER_ADMIN") return next();
    const companyId = source === "body" ? req.body?.companyId : req.query?.companyId;
    if (companyId) {
      if (!(await requireFeature(req, res, companyId, featureKey))) return;
      return next();
    }
    if (!(await hasFeatureAcrossAccessibleCompanies(req.adminUser, featureKey))) {
      return sendFeatureLocked(res, featureKey);
    }
    next();
  };
}

/**
 * Like requireFeatureForCompanyParam, but for routes (e.g. analytics)
 * that accept EITHER ?companyId= OR ?chatbotId= (resolving the
 * chatbot's companyId when only the latter is given) — mirrors
 * analytics.service.js's own resolveAnalyticsScope resolution order.
 */
export function requireFeatureForCompanyOrChatbotParam(featureKey) {
  return async (req, res, next) => {
    if (req.adminUser?.role === "SUPER_ADMIN") return next();
    let companyId = req.query?.companyId || null;
    if (!companyId && req.query?.chatbotId) {
      const chatbot = await Chatbot.findById(req.query.chatbotId).select("companyId").lean();
      companyId = chatbot?.companyId || null;
    }
    // Neither given at all: the controller's own scope resolution
    // decides which companies this request covers (e.g. a company-panel
    // request with no explicit companyId) — gate against that same set.
    if (!companyId) {
      if (!(await hasFeatureAcrossAccessibleCompanies(req.adminUser, featureKey))) {
        return sendFeatureLocked(res, featureKey);
      }
      return next();
    }
    if (!(await requireFeature(req, res, companyId, featureKey))) return;
    next();
  };
}
