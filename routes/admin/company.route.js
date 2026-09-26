import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import {
  listCompanies,
  getCompanyDetail,
  createCompany,
  updateCompany,
  setCompanyStatus,
  getCompanyKnowledge,
  updateCompanyKnowledge,
  testCompanyWebhook,
} from "../../controllers/admin/company.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", listCompanies);
router.get("/:id", getCompanyDetail);
router.post("/", requireRole("SUPER_ADMIN"), createCompany);
router.patch("/:id", updateCompany);
router.post("/:id/status", requireRole("SUPER_ADMIN"), setCompanyStatus);
router.get("/:id/knowledge", getCompanyKnowledge);
router.put("/:id/knowledge", updateCompanyKnowledge);
router.post("/:id/webhook/test", testCompanyWebhook);

export default router;
