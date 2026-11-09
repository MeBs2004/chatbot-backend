import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getLiveViewData } from "../../controllers/admin/liveView.controller.js";
import { requireFeatureForCompanyParam } from "../../services/billing/featureGate.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", requireFeatureForCompanyParam("live_view"), getLiveViewData);

export default router;
