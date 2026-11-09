import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getAnalytics } from "../../controllers/admin/analytics.controller.js";
import { requireFeatureForCompanyOrChatbotParam } from "../../services/billing/featureGate.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", requireFeatureForCompanyOrChatbotParam("advanced_analytics"), getAnalytics);

export default router;
