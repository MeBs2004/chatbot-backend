import express from "express";
import rateLimit from "express-rate-limit";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import {
  listCompanies,
  getCompanyDetail,
  createCompany,
  updateCompany,
  setCompanyStatus,
  deleteCompany,
  getCompanyKnowledge,
  updateCompanyKnowledge,
  clearCompanyKnowledgeCache,
  testCompanyWebhook,
} from "../../controllers/admin/company.controller.js";
import {
  generateKnowledgeFromUrl,
  generateKnowledgeFromFile,
  knowledgeGenerateUploadMiddleware,
} from "../../controllers/admin/knowledgeBuilder.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

// Each call fetches a website or runs an AI completion — bounded like
// the public sign-up/login endpoints, not left to admin-auth alone.
const knowledgeGenerateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many knowledge-generation requests. Please wait and try again." },
});

router.get("/", listCompanies);
router.get("/:id", getCompanyDetail);
router.post("/", requireRole("SUPER_ADMIN"), createCompany);
router.patch("/:id", updateCompany);
router.delete("/:id", requireRole("SUPER_ADMIN"), deleteCompany);
router.post("/:id/status", requireRole("SUPER_ADMIN"), setCompanyStatus);
router.get("/:id/knowledge", getCompanyKnowledge);
router.put("/:id/knowledge", updateCompanyKnowledge);
router.post("/:id/knowledge/clear-cache", clearCompanyKnowledgeCache);
router.post("/:id/knowledge/generate-from-url", knowledgeGenerateLimiter, generateKnowledgeFromUrl);
router.post("/:id/knowledge/generate-from-file", knowledgeGenerateLimiter, knowledgeGenerateUploadMiddleware, generateKnowledgeFromFile);
router.post("/:id/webhook/test", testCompanyWebhook);

export default router;
