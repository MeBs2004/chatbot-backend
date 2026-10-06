import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getTasks, getTask, postTask, patchTask, removeTask } from "../../controllers/admin/task.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", getTasks);
router.get("/:id", getTask);
router.post("/", postTask);
router.patch("/:id", patchTask);
router.delete("/:id", removeTask);

export default router;
