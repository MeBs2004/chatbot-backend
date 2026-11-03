import mongoose from "mongoose";

// ======================================================
// EDUCATION — FAQ entries. The deterministic, stored answer shown
// verbatim when a visitor taps a suggested question — never the
// generic AI's own guess (see the Energy "Bill of Materials" chip
// bug this mirrors the fix for: a chip that implies a real answer
// must resolve to real, stored data, not an AI paraphrase).
// companyId: null = platform default (shared starter content, editable
// per company by copying into a custom one); companyId set = a
// company's own FAQ, visible only to that company.
// ======================================================

const faqSchema = new mongoose.Schema(
  {
    companyId: { type: String, default: null, trim: true, index: true },
    categoryKey: { type: String, required: true, trim: true, lowercase: true },
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

faqSchema.index({ companyId: 1, categoryKey: 1, order: 1 });

export default mongoose.model("EducationFAQ", faqSchema);
