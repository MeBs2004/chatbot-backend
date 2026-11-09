import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { requireFeatureForChatbotRoute } from "../../services/billing/featureGate.js";
import {
  listChatbots,
  getChatbotDetail,
  createChatbot,
  updateChatbot,
  updateChatbotConfig,
  deleteChatbot,
  assignChatbotAccess,
  removeChatbotAccessForUser,
} from "../../controllers/admin/chatbot.controller.js";
import {
  getFlow,
  saveFlowDraft,
  validateFlowDraft,
  publishFlow,
  listFlowVersions,
  rollbackFlow,
} from "../../controllers/admin/flow.controller.js";
import {
  getAiSettings,
  updateAiSettings,
  testAi,
  aiTestLimiter,
} from "../../controllers/admin/aiSettings.controller.js";
import {
  getChatbotKnowledge,
  updateChatbotKnowledge,
  knowledgeUploadMiddleware,
  extractChatbotKnowledgeUpload,
  testChatbotKnowledge,
  clearChatbotKnowledgeCache,
} from "../../controllers/admin/knowledgeAdmin.controller.js";
import {
  listChannels,
  updateWebsiteChannel,
  connectTelegram,
  testTelegram,
  disconnectTelegram,
} from "../../controllers/admin/channel.controller.js";
import {
  listAvailableCategories,
  createCustomCategory,
  deleteCustomCategory,
  listFaqs,
  createFaq,
  updateFaq,
  deleteFaq,
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getEducationConfig,
  updateEducationConfig,
  publishEducationConfig,
} from "../../controllers/admin/educationConfig.controller.js";
import {
  listLeads,
  getLeadDetail,
  updateLeadStatus,
  assignLead,
  addLeadNote,
} from "../../controllers/admin/educationLead.controller.js";
import {
  getMarketingConfig,
  updateMarketingConfig,
  publishMarketingConfig,
} from "../../controllers/admin/marketingConfig.controller.js";
import {
  listLeads as listMarketingLeads,
  getLeadDetail as getMarketingLeadDetail,
  updateLeadStatus as updateMarketingLeadStatus,
  assignLead as assignMarketingLead,
  addLeadNote as addMarketingLeadNote,
} from "../../controllers/admin/marketingLead.controller.js";
import {
  listAvailableFuels,
  createCustomFuel,
  deleteCustomFuel,
  listProductServices,
  createCustomProductService,
  deleteCustomProductService,
  listProjectTypes,
  createCustomProjectType,
  deleteCustomProjectType,
  getEnergyConfig,
  updateEnergyConfig,
  publishEnergyConfig,
  getPublishWarnings,
} from "../../controllers/admin/energyConfig.controller.js";
import {
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  getFileUploadPolicy,
} from "../../controllers/admin/energyQuestion.controller.js";
import {
  listEquipment,
  getEquipmentDetail,
  createEquipment,
  updateEquipment,
  deleteEquipment,
  imageUploadMiddleware,
  uploadEquipmentImage,
  serveEquipmentImage,
  datasheetUploadMiddleware,
  uploadEquipmentDatasheet,
  serveEquipmentDatasheet,
  csvUploadMiddleware,
  importEquipmentCsv,
} from "../../controllers/admin/energyEquipment.controller.js";
import {
  listTemplates,
  getTemplateDetail,
  listTemplateVersions,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setTemplateActive,
  submitTemplate,
  approveTemplate,
  rejectTemplate,
  archiveTemplate,
  previewTemplate,
  previewTemplatePdf,
  previewTemplateExcel,
} from "../../controllers/admin/energySolution.controller.js";
import {
  listSuppliers,
  getSupplierDetail,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  documentUploadMiddleware,
  uploadSupplierDocument,
  serveSupplierDocument,
  deleteSupplierDocument,
  previewSupplierMatch,
} from "../../controllers/admin/energySupplier.controller.js";
import {
  listEnquiries,
  getEnquiryDetail,
  updateEnquiryStatus,
  addEnquiryNote,
  assignEnquiry,
  notifySuppliers,
  listEnquiryAttachments,
  downloadEnquiryAttachment,
} from "../../controllers/admin/energyEnquiry.controller.js";
import {
  getEnergyOverview,
  getEnergyVisitorAnalytics,
  getEnergyFuelAnalytics,
  getEnergyProjectTypeAnalytics,
  getEnergyFunnelAnalytics,
  getEnergyQuestionAnalytics,
  getEnergySolutionAnalytics,
  getEnergySupplierAnalytics,
  getEnergyEnquiryAnalytics,
  getEnergyAiHandoffAnalytics,
  exportEnergyAnalytics,
} from "../../controllers/admin/energyAnalytics.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", listChatbots);
router.get("/:id", getChatbotDetail);
router.post("/", createChatbot);
router.patch("/:id", updateChatbot);
router.patch("/:id/config", updateChatbotConfig);
router.delete("/:id", deleteChatbot);
const requireAccessAssignment = requireFeatureForChatbotRoute("chatbot_access_assignment");
router.post("/:id/access", requireAccessAssignment, assignChatbotAccess);
router.delete("/:id/access/:userId", requireAccessAssignment, removeChatbotAccessForUser);

// Bot Builder (Phase 6)
const requireBotBuilder = requireFeatureForChatbotRoute("bot_builder");
router.get("/:id/flow", requireBotBuilder, getFlow);
router.put("/:id/flow", requireBotBuilder, saveFlowDraft);
router.post("/:id/flow/validate", requireBotBuilder, validateFlowDraft);
router.post("/:id/flow/publish", requireBotBuilder, publishFlow);
router.get("/:id/flow/versions", requireBotBuilder, listFlowVersions);
router.post("/:id/flow/rollback", requireBotBuilder, rollbackFlow);

// AI Settings + Knowledge Base (Phase 7)
router.get("/:id/ai-settings", getAiSettings);
router.put("/:id/ai-settings", updateAiSettings);
router.post("/:id/ai/test", aiTestLimiter, testAi);

router.get("/:id/knowledge", getChatbotKnowledge);
router.put("/:id/knowledge", updateChatbotKnowledge);
router.post("/:id/knowledge/upload", knowledgeUploadMiddleware, extractChatbotKnowledgeUpload);
router.post("/:id/knowledge/test", testChatbotKnowledge);
router.post("/:id/knowledge/clear-cache", clearChatbotKnowledgeCache);

// Channels (Phase 10)
router.get("/:id/channels", listChannels);
router.put("/:id/channels/website", updateWebsiteChannel);
router.post("/:id/channels/telegram/connect", connectTelegram);
router.post("/:id/channels/telegram/test", testTelegram);
router.post("/:id/channels/telegram/disconnect", disconnectTelegram);

// Energy Configuration (Phase 1 — Section 3/4/5/6 of the Energy brief).
// Company-scoped: a chatbot's own fuel/product-service/project-type
// selections, plus any custom additions. Platform-wide defaults are
// managed separately via /api/admin/energy-defaults (SUPER_ADMIN only).
router.get("/:id/energy/fuels", listAvailableFuels);
router.post("/:id/energy/fuels", createCustomFuel);
router.delete("/:id/energy/fuels/:fuelId", deleteCustomFuel);
router.get("/:id/energy/product-services", listProductServices);
router.post("/:id/energy/product-services", createCustomProductService);
router.delete("/:id/energy/product-services/:itemId", deleteCustomProductService);
router.get("/:id/energy/project-types", listProjectTypes);
router.post("/:id/energy/project-types", createCustomProjectType);
router.delete("/:id/energy/project-types/:itemId", deleteCustomProjectType);
router.get("/:id/energy/config", getEnergyConfig);
router.put("/:id/energy/config", updateEnergyConfig);
router.get("/:id/energy/config/publish-warnings", getPublishWarnings);
router.post("/:id/energy/config/publish", publishEnergyConfig);

// Dynamic Question Builder (Phase 2, Part A).
router.get("/:id/energy/file-upload-policy", getFileUploadPolicy);
router.get("/:id/energy/questions", listQuestions);
router.post("/:id/energy/questions", createQuestion);
router.patch("/:id/energy/questions/:questionId", updateQuestion);
router.delete("/:id/energy/questions/:questionId", deleteQuestion);
router.post("/:id/energy/questions/reorder", reorderQuestions);

// Equipment Catalogue (Phase 2, Part B).
router.get("/:id/energy/equipment", listEquipment);
router.get("/:id/energy/equipment/:equipmentId", getEquipmentDetail);
router.post("/:id/energy/equipment", createEquipment);
router.patch("/:id/energy/equipment/:equipmentId", updateEquipment);
router.delete("/:id/energy/equipment/:equipmentId", deleteEquipment);
router.post("/:id/energy/equipment/:equipmentId/image", imageUploadMiddleware, uploadEquipmentImage);
router.get("/:id/energy/equipment/:equipmentId/image", serveEquipmentImage);
router.post("/:id/energy/equipment/:equipmentId/datasheet", datasheetUploadMiddleware, uploadEquipmentDatasheet);
router.get("/:id/energy/equipment/:equipmentId/datasheet", serveEquipmentDatasheet);
router.post("/:id/energy/equipment/import", csvUploadMiddleware, importEquipmentCsv);

// BOM & Technical Solution Templates (Phase 3).
router.get("/:id/energy/solutions", listTemplates);
router.get("/:id/energy/solutions/:templateId", getTemplateDetail);
router.get("/:id/energy/solutions/:templateId/versions", listTemplateVersions);
router.post("/:id/energy/solutions", createTemplate);
router.patch("/:id/energy/solutions/:templateId", updateTemplate);
router.delete("/:id/energy/solutions/:templateId", deleteTemplate);
router.patch("/:id/energy/solutions/:templateId/active", setTemplateActive);
router.post("/:id/energy/solutions/:templateId/submit", submitTemplate);
router.post("/:id/energy/solutions/:templateId/approve", approveTemplate);
router.post("/:id/energy/solutions/:templateId/reject", rejectTemplate);
router.post("/:id/energy/solutions/:templateId/archive", archiveTemplate);
router.post("/:id/energy/solutions/:templateId/preview", previewTemplate);
router.post("/:id/energy/solutions/:templateId/preview/pdf", previewTemplatePdf);
router.post("/:id/energy/solutions/:templateId/preview/excel", previewTemplateExcel);

// Supplier Management (Phase 4, Part 2/3).
router.get("/:id/energy/suppliers", listSuppliers);
router.get("/:id/energy/suppliers/:supplierId", getSupplierDetail);
router.post("/:id/energy/suppliers", createSupplier);
router.patch("/:id/energy/suppliers/:supplierId", updateSupplier);
router.delete("/:id/energy/suppliers/:supplierId", deleteSupplier);
router.post("/:id/energy/suppliers/:supplierId/documents", documentUploadMiddleware, uploadSupplierDocument);
router.get("/:id/energy/suppliers/:supplierId/documents/:docId", serveSupplierDocument);
router.delete("/:id/energy/suppliers/:supplierId/documents/:docId", deleteSupplierDocument);
router.post("/:id/energy/suppliers/match-preview", previewSupplierMatch);

// RFQ / Enquiry Management (Phase 4, Part 5/6/7/8).
router.get("/:id/energy/enquiries", listEnquiries);
router.get("/:id/energy/enquiries/:enquiryId", getEnquiryDetail);
router.patch("/:id/energy/enquiries/:enquiryId/status", updateEnquiryStatus);
router.post("/:id/energy/enquiries/:enquiryId/notes", addEnquiryNote);
router.patch("/:id/energy/enquiries/:enquiryId/assign", assignEnquiry);
router.get("/:id/energy/enquiries/:enquiryId/attachments", listEnquiryAttachments);
router.get("/:id/energy/enquiries/:enquiryId/attachments/:fileId/download", downloadEnquiryAttachment);
router.post("/:id/energy/enquiries/:enquiryId/notify-suppliers", notifySuppliers);

// Phase 6 — Energy Analytics Dashboard.
router.get("/:id/energy/analytics/overview", getEnergyOverview);
router.get("/:id/energy/analytics/visitors", getEnergyVisitorAnalytics);
router.get("/:id/energy/analytics/fuels", getEnergyFuelAnalytics);
router.get("/:id/energy/analytics/project-types", getEnergyProjectTypeAnalytics);
router.get("/:id/energy/analytics/funnel", getEnergyFunnelAnalytics);
router.get("/:id/energy/analytics/questions", getEnergyQuestionAnalytics);
router.get("/:id/energy/analytics/solutions", getEnergySolutionAnalytics);
router.get("/:id/energy/analytics/suppliers", getEnergySupplierAnalytics);
router.get("/:id/energy/analytics/enquiries", getEnergyEnquiryAnalytics);
router.get("/:id/energy/analytics/ai-handoff", getEnergyAiHandoffAnalytics);
router.get("/:id/energy/analytics/export", exportEnergyAnalytics);

// ---------------- Education (company-scoped, mirrors Energy above) ----------------
router.get("/:id/education/categories", listAvailableCategories);
router.post("/:id/education/categories", createCustomCategory);
router.delete("/:id/education/categories/:categoryId", deleteCustomCategory);

router.get("/:id/education/faqs", listFaqs);
router.post("/:id/education/faqs", createFaq);
router.patch("/:id/education/faqs/:faqId", updateFaq);
router.delete("/:id/education/faqs/:faqId", deleteFaq);

router.get("/:id/education/courses", listCourses);
router.post("/:id/education/courses", createCourse);
router.patch("/:id/education/courses/:courseId", updateCourse);
router.delete("/:id/education/courses/:courseId", deleteCourse);

router.get("/:id/education/config", getEducationConfig);
router.put("/:id/education/config", updateEducationConfig);
router.post("/:id/education/config/publish", publishEducationConfig);

router.get("/:id/education/leads", listLeads);
router.get("/:id/education/leads/:leadId", getLeadDetail);
router.patch("/:id/education/leads/:leadId/status", updateLeadStatus);
router.patch("/:id/education/leads/:leadId/assign", assignLead);
router.post("/:id/education/leads/:leadId/notes", addLeadNote);

// ---------------- Digital Marketing (company-scoped, mirrors Education above) ----------------
router.get("/:id/marketing/config", getMarketingConfig);
router.put("/:id/marketing/config", updateMarketingConfig);
router.post("/:id/marketing/config/publish", publishMarketingConfig);

router.get("/:id/marketing/leads", listMarketingLeads);
router.get("/:id/marketing/leads/:leadId", getMarketingLeadDetail);
router.patch("/:id/marketing/leads/:leadId/status", updateMarketingLeadStatus);
router.patch("/:id/marketing/leads/:leadId/assign", assignMarketingLead);
router.post("/:id/marketing/leads/:leadId/notes", addMarketingLeadNote);

export default router;
