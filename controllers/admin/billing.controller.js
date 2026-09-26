import Invoice from "../../models/invoice.model.js";
import { can, PERMISSIONS } from "../../services/admin/permissions.service.js";
import { getCompanyPlan, listPlans } from "../../services/billing/plan.service.js";
import { getUsageWithLimits } from "../../services/billing/usage.service.js";
import { getProviderStatus } from "../../services/billing/billingProvider.js";
import { logAction } from "../../services/admin/audit.service.js";
import { PLAN_IDS, getPlanConfig } from "../../config/plans.js";

// ======================================================
// BILLING — ADMIN MANAGEMENT (Phase 13)
// Admin-JWT-authenticated (mounted at /api/admin/billing/*), same
// convention as developer.controller.js: a small requirePermission
// helper wrapping Phase 11's `can()`, never a second authorization
// system. Every response is built from a real BillingAccount/Invoice
// document or the real, centralized usage engine — nothing here
// fabricates a subscription, invoice, or usage number.
// ======================================================

async function requirePermission(req, res, companyId, permission) {
  if (!companyId) {
    res.status(400).json({ success: false, message: "companyId is required." });
    return false;
  }
  if (!(await can(req.adminUser, permission, { companyId }))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return false;
  }
  return true;
}

function redactAccount(account) {
  // providerCustomerId/providerSubscriptionId are provider
  // identifiers, not secrets, but there's no reason to hand them to
  // the frontend when nothing does anything with them yet.
  const { providerCustomerId, providerSubscriptionId, ...rest } = account.toObject ? account.toObject() : account;
  return rest;
}

export const getBillingOverview = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.BILLING_VIEW))) return;

    const { account, plan } = await getCompanyPlan(companyId);

    return res.status(200).json({
      success: true,
      account: redactAccount(account),
      plan,
      provider: getProviderStatus(),
    });
  } catch (error) {
    console.error("Get Billing Overview Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load billing overview." });
  }
};

export const getPlans = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.BILLING_VIEW))) return;

    const { account } = await getCompanyPlan(companyId);
    return res.status(200).json({ success: true, plans: listPlans(), currentPlanId: account.planId });
  } catch (error) {
    console.error("Get Plans Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load plans." });
  }
};

export const getUsage = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.USAGE_VIEW))) return;

    const usage = await getUsageWithLimits(companyId);
    return res.status(200).json({ success: true, ...usage });
  } catch (error) {
    console.error("Get Billing Usage Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load usage." });
  }
};

export const changePlan = async (req, res) => {
  try {
    const { companyId, planId } = req.body;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.BILLING_CHANGE_PLAN))) return;

    if (!PLAN_IDS.includes(planId)) {
      return res.status(400).json({ success: false, message: "Invalid plan." });
    }

    const { account } = await getCompanyPlan(companyId);
    // No accidental self-change to the same plan — harmless, but not
    // a real "change" worth an audit entry or a status flip.
    if (account.planId === planId) {
      return res.status(200).json({ success: true, account: redactAccount(account), message: "Already on this plan." });
    }

    // The plan being REQUESTED, not the company's current plan —
    // using getCompanyPlan(companyId) here would resolve to the
    // current plan and check the wrong price.
    const targetPlan = getPlanConfig(planId);

    // Section 11 — a plan change must never IMPLY payment was
    // collected. FREE (monthlyPrice 0) can always be switched to
    // immediately, no provider needed. Anything else requires a real
    // payment provider, which isn't configured here.
    const isDowngradeToFree = targetPlan.monthlyPrice === 0;
    if (!isDowngradeToFree) {
      return res.status(402).json({
        success: false,
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
        message:
          targetPlan.monthlyPrice === null
            ? "This plan requires pricing to be finalized — contact sales to upgrade."
            : "Upgrading requires a connected payment provider, which isn't configured yet.",
      });
    }

    const previousPlanId = account.planId;
    account.planId = planId;
    account.status = "ACTIVE";
    await account.save();

    await logAction(req, {
      action: "BILLING_PLAN_CHANGED",
      resource: "BillingAccount",
      resourceId: account._id,
      companyId,
      metadata: { from: previousPlanId, to: planId },
    });

    return res.status(200).json({ success: true, account: redactAccount(account) });
  } catch (error) {
    console.error("Change Plan Error:", error);
    return res.status(500).json({ success: false, message: "Failed to change plan." });
  }
};

export const cancelBilling = async (req, res) => {
  try {
    const { companyId } = req.body;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.BILLING_CANCEL))) return;

    const { account } = await getCompanyPlan(companyId);

    if (account.provider === "NONE") {
      // Nothing to "cancel" — there is no paid subscription without a
      // provider. Never pretend a cancellation was processed.
      return res.status(400).json({
        success: false,
        code: account.planId === "FREE" ? "NOTHING_TO_CANCEL" : "PAYMENT_PROVIDER_NOT_CONFIGURED",
        message:
          account.planId === "FREE"
            ? "You're on the Free plan — there's no subscription to cancel."
            : "Cancellation requires a connected payment provider, which isn't configured yet.",
      });
    }

    // Unreachable today (provider is always NONE), kept for the
    // real provider integration this abstraction is built for.
    return res.status(402).json({ success: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
  } catch (error) {
    console.error("Cancel Billing Error:", error);
    return res.status(500).json({ success: false, message: "Failed to cancel." });
  }
};

export const listInvoices = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.BILLING_INVOICES_VIEW))) return;

    const invoices = await Invoice.find({ companyId }).sort({ issuedAt: -1 }).lean();
    return res.status(200).json({ success: true, invoices, provider: getProviderStatus() });
  } catch (error) {
    console.error("List Invoices Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load invoices." });
  }
};

export const getBillingSettings = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!(await requirePermission(req, res, companyId, PERMISSIONS.BILLING_VIEW))) return;

    const { account } = await getCompanyPlan(companyId);
    return res.status(200).json({
      success: true,
      provider: getProviderStatus(),
      billingInterval: account.billingInterval,
      status: account.status,
    });
  } catch (error) {
    console.error("Get Billing Settings Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load billing settings." });
  }
};
