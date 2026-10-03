import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getLiveViewData } from "../../controllers/admin/liveView.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", getLiveViewData);

export default router;
