import mongoose from "mongoose";
import Chatbot from "../../models/chatbot.model.js";
import { MARKETING_CALCULATIONS } from "../../services/sectors/marketingCalculator.service.js";
import { calculateEnergyBom } from "../../services/sectors/energyBomCalculator.service.js";
import { isWidgetRequestAllowed } from "../../middleware/widgetSession.middleware.js";

// ======================================================
// PUBLIC SECTOR CALCULATORS — deterministic math only, no AI
// involved. Same trust model as widget/config.controller.js: public,
// unauthenticated, keyed by chatbotId from the URL (never a
// client-supplied companyId), 404s identically for a missing or
// soft-deleted chatbot so a caller can't distinguish "doesn't exist"
// from "exists but you can't see it".
// ======================================================

async function resolveChatbot(chatbotId, req) {
  if (!mongoose.Types.ObjectId.isValid(chatbotId)) return null;
  const chatbot = await Chatbot.findById(chatbotId).select("template deletedAt status allowedDomains").lean();
  if (!chatbot || chatbot.deletedAt) return null;
  if (!isWidgetRequestAllowed(req, chatbot)) return null;
  return chatbot;
}

export const calculateMarketing = async (req, res) => {
  try {
    const chatbot = await resolveChatbot(req.params.chatbotId, req);
    if (!chatbot) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }
    if (chatbot.template !== "digital_marketing") {
      return res.status(403).json({ success: false, message: "This chatbot does not have the marketing calculator enabled." });
    }

    const { calculation, inputs } = req.body;
    const fn = MARKETING_CALCULATIONS[calculation];
    if (!fn) {
      return res.status(400).json({
        success: false,
        message: `Unknown calculation. Supported: ${Object.keys(MARKETING_CALCULATIONS).join(", ")}`,
      });
    }
    if (!inputs || typeof inputs !== "object") {
      return res.status(400).json({ success: false, message: "inputs object is required." });
    }

    const result = fn(inputs);
    return res.status(200).json({ success: true, calculation, result });
  } catch (error) {
    console.error("Public Marketing Calculator Error:", error);
    return res.status(500).json({ success: false, message: "Unable to run calculation." });
  }
};

export const calculateEnergyBomPublic = async (req, res) => {
  try {
    const chatbot = await resolveChatbot(req.params.chatbotId, req);
    if (!chatbot) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }
    if (chatbot.template !== "energy") {
      return res.status(403).json({ success: false, message: "This chatbot does not have the BOM calculator enabled." });
    }

    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ success: false, message: "Request body is required." });
    }

    const result = calculateEnergyBom(req.body);
    if (!result.valid) {
      return res.status(400).json({ success: false, message: "Invalid input.", errors: result.errors });
    }
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Public Energy BOM Calculator Error:", error);
    return res.status(500).json({ success: false, message: "Unable to run calculation." });
  }
};
