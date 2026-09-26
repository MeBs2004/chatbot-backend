import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getAnalytics } from "../../controllers/admin/analytics.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", getAnalytics);

export default router;
