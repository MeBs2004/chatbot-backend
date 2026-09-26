import mongoose from "mongoose";
import { PLAN_IDS } from "../config/plans.js";

// ======================================================
// BILLING ACCOUNT (Phase 13)
// One per company, created lazily (see plan.service.js's
// ensureBillingAccount) the first time anything billing-related is
// read for that company — no bulk migration script needed, and a
// company that never opens Billing simply never gets a document,
// which is fine since the safe default (FREE/ACTIVE) is exactly what
// ensureBillingAccount returns anyway when no document exists yet.
//
// `provider`/`providerCustomerId`/`providerSubscriptionId` exist for
// the abstraction (Section 30) but are NEVER populated in this
// phase — no payment provider is configured (see PHASE_13_REPORT).
// ======================================================

const billingAccountSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, unique: true, index: true },

    planId: { type: String, enum: PLAN_IDS, default: "FREE" },

    status: {
      type: String,
      enum: ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED", "INCOMPLETE"],
      default: "ACTIVE",
    },

    billingInterval: { type: String, enum: ["monthly", "yearly"], default: "monthly" },

    // Defaults to the current calendar month — the only meaningful
    // "billing period" that exists without a real subscription
    // (there is no provider-issued cycle to anchor to). Rolled
    // forward lazily by plan.service.js's ensureBillingAccount
    // whenever it's read past currentPeriodEnd, so usage always
    // reports against a real, current window.
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },

    trialStart: { type: Date, default: null },
    trialEnd: { type: Date, default: null },

    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },

    provider: { type: String, enum: ["NONE", "STRIPE", "RAZORPAY"], default: "NONE" },
    providerCustomerId: { type: String, default: null },
    providerSubscriptionId: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("BillingAccount", billingAccountSchema);
