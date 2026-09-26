import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { listVisitors, getVisitorDetail, getVisitorTimeline } from "../../controllers/admin/visitor.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", listVisitors);
router.get("/:id", getVisitorDetail);
router.get("/:id/timeline", getVisitorTimeline);

export default router;
