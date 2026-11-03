import mongoose from "mongoose";

// ======================================================
// EDUCATION — LEADS. The "Get Free Counselling" capture from the live
// widget, modeled on Energy's EnergyEnquiry but intentionally much
// lighter (no file uploads/suppliers/consent — a counselling lead is
// just contact details + what they're interested in).
// ======================================================

export const LEAD_STATUSES = ["new", "contacted", "converted", "closed"];

const leadSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, index: true },

    referenceId: { type: String, required: true, unique: true },

    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    courseInterest: { type: String, default: "", trim: true },
    message: { type: String, default: "", trim: true },

    source: { type: String, default: "widget" },
    status: { type: String, enum: LEAD_STATUSES, default: "new" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", default: null },
    internalNotes: {
      type: [
        {
          authorId: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser", required: true },
          text: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

leadSchema.index({ companyId: 1, chatbotId: 1, status: 1, createdAt: -1 });

export default mongoose.model("EducationLead", leadSchema);
