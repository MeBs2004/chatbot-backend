import mongoose from "mongoose";

// ======================================================
// INVOICE (Phase 13)
// The architecture for real billing history — NEVER populated with
// synthetic data. No payment provider is configured in this
// deployment (see PHASE_13_REPORT), so this collection is expected
// to stay empty until one is; Billing History honestly shows an
// empty state rather than fabricated rows. A future provider
// integration writes real rows here from real provider events
// (Section 33), never from the admin UI directly.
// ======================================================

const invoiceSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },

    provider: { type: String, enum: ["STRIPE", "RAZORPAY"], required: true },
    providerInvoiceId: { type: String, required: true },

    number: { type: String, default: "" },
    status: {
      type: String,
      enum: ["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"],
      required: true,
    },

    currency: { type: String, required: true },
    subtotal: { type: Number, required: true },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },

    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    issuedAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    dueAt: { type: Date, default: null },

    hostedInvoiceUrl: { type: String, default: null },
  },
  { timestamps: true }
);

invoiceSchema.index({ companyId: 1, issuedAt: -1 });
invoiceSchema.index({ provider: 1, providerInvoiceId: 1 }, { unique: true });

export default mongoose.model("Invoice", invoiceSchema);
