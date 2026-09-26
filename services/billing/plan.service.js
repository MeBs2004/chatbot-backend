import BillingAccount from "../../models/billingAccount.model.js";
import { PLANS, getPlanConfig } from "../../config/plans.js";

// ======================================================
// PLAN SERVICE (Phase 13)
// The one place plan/entitlement logic lives — no controller should
// ever compare `company.plan === "PRO"` directly (Section 5).
// ======================================================

function startOfMonthUTC(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function addMonthsUTC(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

/**
 * Loads (or lazily creates) a company's BillingAccount. A brand-new
 * document defaults to FREE/ACTIVE with the current calendar month
 * as its billing period — the only safe, real definition available
 * without a payment provider (Section 13: existing companies get
 * FREE/ACTIVE, never a fabricated paid state). If the stored period
 * has lapsed and no provider manages it, the window is rolled
 * forward to the current month — lazy, no cron job required.
 */
export async function ensureBillingAccount(companyId) {
  let account = await BillingAccount.findOne({ companyId });
  const now = new Date();

  if (!account) {
    const start = startOfMonthUTC(now);
    account = await BillingAccount.create({
      companyId,
      planId: "FREE",
      status: "ACTIVE",
      currentPeriodStart: start,
      currentPeriodEnd: addMonthsUTC(start, 1),
    });
    return account;
  }

  if (account.provider === "NONE" && account.currentPeriodEnd <= now) {
    const start = startOfMonthUTC(now);
    account.currentPeriodStart = start;
    account.currentPeriodEnd = addMonthsUTC(start, 1);
    await account.save();
  }

  return account;
}

export async function getCompanyPlan(companyId) {
  const account = await ensureBillingAccount(companyId);
  const plan = getPlanConfig(account.planId) || PLANS.FREE;
  return { account, plan };
}

export async function hasFeature(companyId, feature) {
  const { plan } = await getCompanyPlan(companyId);
  return Boolean(plan.features[feature]);
}

export async function getLimit(companyId, limitKey) {
  const { plan } = await getCompanyPlan(companyId);
  const value = plan.limits[limitKey];
  return value === undefined ? Infinity : value;
}

export function listPlans() {
  return Object.values(PLANS);
}
