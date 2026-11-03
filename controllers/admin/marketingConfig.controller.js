import ChatbotMarketingConfig from "../../models/marketing/chatbotMarketingConfig.model.js";
import { loadAuthorizedMarketingChatbot } from "../../services/marketing/marketingAccess.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import {
  MARKETING_SERVICE_CATEGORIES,
  MARKETING_SERVICE_KEYS,
  MARKETING_CAPABILITIES,
  MARKETING_CAPABILITY_KEYS,
  BUSINESS_TYPES,
} from "../../config/marketingServices.js";

// ======================================================
// COMPANY-SCOPED Digital Marketing Configuration. Unlike Energy/
// Education, services and capabilities are a FIXED curated taxonomy
// (config/marketingServices.js), not admin-managed or company-custom
// rows — so there's no CRUD here, just get/update/publish against
// that fixed catalog. Mirrors educationConfig.controller.js's
// get/update/publish shape exactly.
// ======================================================

// Read-only, available to any authenticated admin — the shared fixed
// catalog the Create Chatbot wizard's Marketing step renders from.
export const getMarketingCatalog = async (req, res) => {
  return res.status(200).json({
    success: true,
    serviceCategories: MARKETING_SERVICE_CATEGORIES,
    capabilities: MARKETING_CAPABILITIES,
    businessTypes: BUSINESS_TYPES,
  });
};

export const getMarketingConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    let config = await ChatbotMarketingConfig.findOne({ chatbotId: ctx.chatbot._id }).lean();
    if (!config) {
      config = {
        chatbotId: ctx.chatbot._id,
        companyId: ctx.chatbot.companyId,
        businessProfile: {},
        enabledServiceKeys: [],
        enabledCapabilityKeys: [],
        leadSettings: { enabled: true, requiredFields: ["name", "phone"], qualificationQuestions: [], humanHandoffEnabled: true, ctaLabel: "Request a Quote" },
        status: "DRAFT",
        publishedAt: null,
      };
    }
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Get Marketing Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the Marketing configuration." });
  }
};

const BUSINESS_PROFILE_FIELDS = ["businessName", "website", "description", "businessType", "location", "targetAudience", "industriesServed", "businessGoals", "contactInfo"];

export const updateMarketingConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const { businessProfile, enabledServiceKeys, enabledCapabilityKeys, leadSettings } = req.body || {};

    const update = { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id };

    if (businessProfile && typeof businessProfile === "object") {
      const profile = {};
      BUSINESS_PROFILE_FIELDS.forEach((f) => {
        if (businessProfile[f] !== undefined) profile[f] = String(businessProfile[f]).slice(0, 2000);
      });
      update.businessProfile = profile;
    }

    if (Array.isArray(enabledServiceKeys)) {
      update.enabledServiceKeys = enabledServiceKeys.filter((k) => MARKETING_SERVICE_KEYS.includes(k));
    }
    if (Array.isArray(enabledCapabilityKeys)) {
      update.enabledCapabilityKeys = enabledCapabilityKeys.filter((k) => MARKETING_CAPABILITY_KEYS.includes(k));
    }
    if (leadSettings && typeof leadSettings === "object") {
      const settings = {};
      if (typeof leadSettings.enabled === "boolean") settings.enabled = leadSettings.enabled;
      if (Array.isArray(leadSettings.requiredFields)) settings.requiredFields = leadSettings.requiredFields.map(String);
      if (Array.isArray(leadSettings.qualificationQuestions)) settings.qualificationQuestions = leadSettings.qualificationQuestions.map(String).slice(0, 20);
      if (typeof leadSettings.humanHandoffEnabled === "boolean") settings.humanHandoffEnabled = leadSettings.humanHandoffEnabled;
      if (leadSettings.ctaLabel !== undefined) settings.ctaLabel = String(leadSettings.ctaLabel).slice(0, 60) || "Request a Quote";
      update.leadSettings = settings;
    }

    const config = await ChatbotMarketingConfig.findOneAndUpdate(
      { chatbotId: ctx.chatbot._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logAction(req, { action: "MARKETING_CONFIG_UPDATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Update Marketing Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the Marketing configuration." });
  }
};

export const publishMarketingConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const config = await ChatbotMarketingConfig.findOne({ chatbotId: ctx.chatbot._id });
    if (!config || config.enabledServiceKeys.length === 0) {
      return res.status(400).json({ success: false, message: "Enable at least one marketing service before publishing." });
    }
    if (!config.businessProfile?.businessName) {
      return res.status(400).json({ success: false, message: "Add a business name before publishing." });
    }
    config.status = "PUBLISHED";
    config.publishedAt = new Date();
    await config.save();
    await logAction(req, { action: "MARKETING_CONFIG_PUBLISHED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Publish Marketing Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish the Marketing configuration." });
  }
};
