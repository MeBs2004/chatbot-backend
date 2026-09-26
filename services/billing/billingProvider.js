// ======================================================
// BILLING PROVIDER ABSTRACTION (Phase 13, Section 30-32)
//
//   UI -> billing.controller.js -> this interface -> a real provider
//
// No payment provider is configured in this deployment — confirmed
// by audit: no Stripe/Razorpay dependency in package.json, no
// provider credentials in .env. `NotConfiguredProvider` is the only
// implementation registered below. Every method returns the same
// honest, structured "not configured" result rather than throwing a
// generic error or pretending to succeed — callers (billing.
// controller.js) turn this into the documented
// PAYMENT_PROVIDER_NOT_CONFIGURED / CONTACT_SALES_REQUIRED responses
// (Section 11/35), never a fake success.
//
// Connecting a real provider later means adding a StripeProvider (or
// RazorpayProvider) class implementing this same interface and
// switching PROVIDER below — plan logic, quota logic, the usage
// engine, and every billing UI page are already provider-agnostic
// and need no changes.
// ======================================================

class NotConfiguredProvider {
  name = "NONE";

  async getStatus() {
    return { status: "NOT_CONFIGURED", provider: "NONE" };
  }

  async createCustomer() {
    return { ok: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" };
  }

  async createCheckout() {
    return { ok: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" };
  }

  async changeSubscription() {
    return { ok: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" };
  }

  async cancelSubscription() {
    return { ok: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" };
  }

  async getSubscription() {
    return { ok: false, code: "PAYMENT_PROVIDER_NOT_CONFIGURED" };
  }

  async listInvoices() {
    return { ok: true, invoices: [] };
  }
}

const PROVIDER = new NotConfiguredProvider();

export function getBillingProvider() {
  return PROVIDER;
}

export function getProviderStatus() {
  return { status: "NOT_CONFIGURED", provider: "NONE" };
}
