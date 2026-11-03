import mongoose from "mongoose";

// ======================================================
// Per-chatbot Energy Configuration (Phase 1 slice): which fuels this
// specific chatbot offers, and which of that company's products/
// services and project types are switched on. Everything downstream
// (Phase 2+: questions, equipment, BOM templates, suppliers, the
// published widget journey) reads from THIS document to know what a
// given company's chatbot actually supports — never a hardcoded list.
//
// One row per chatbot, not per company: a company can run more than
// one Energy chatbot with different fuel mixes (e.g. one site per
// business line), matching every other per-chatbot config in this
// codebase (EnergyBotConfig's predecessor, AiSettings, etc).
// ======================================================

const chatbotEnergyConfigSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, unique: true, index: true },

    // Fuel keys this chatbot offers (EnergyFuelCategory.key values —
    // either platform defaults or this company's own custom ones).
    enabledFuelKeys: { type: [String], default: [] },

    // Which of this company's EnergyProductService / EnergyProjectType
    // rows are actually switched on for this chatbot. Stored as ids
    // (not a boolean flag on the offering itself) because the same
    // offering could in principle be reused — and because a deleted/
    // deactivated offering should just silently drop out of a config
    // that references it, rather than needing a cleanup pass.
    enabledProductServiceIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    enabledProjectTypeIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    // Draft vs published — a company can save partial configuration
    // without it affecting the live, published widget (Section 3:
    // "Support draft saving and editing" / "validate required
    // configuration before publishing").
    status: { type: String, enum: ["DRAFT", "PUBLISHED"], default: "DRAFT" },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("ChatbotEnergyConfig", chatbotEnergyConfigSchema);
