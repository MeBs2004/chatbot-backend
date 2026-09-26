import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  getBillingOverview,
  getPlans,
  getUsage,
  changePlan,
  cancelBilling,
  listInvoices,
  getBillingSettings,
} from "../../controllers/admin/billing.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", getBillingOverview);
router.get("/plans", getPlans);
router.get("/usage", getUsage);
router.post("/plan/change", changePlan);
router.post("/cancel", cancelBilling);
router.get("/invoices", listInvoices);
router.get("/settings", getBillingSettings);

export default router;
