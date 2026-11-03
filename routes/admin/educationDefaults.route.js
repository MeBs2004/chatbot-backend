import express from "express";
import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import { getPlatformEducationCatalog, listCategories, createCategory, updateCategory, deactivateCategory } from "../../controllers/admin/educationDefaults.controller.js";

// Platform-wide Education taxonomy — SUPER_ADMIN only, except the
// read-only /catalog endpoint used by the Create Chatbot wizard before
// a chatbot exists yet. Mirrors energyDefaults.route.js exactly.
const router = express.Router();

router.get("/catalog", adminAuthMiddleware, getPlatformEducationCatalog);

router.use(adminAuthMiddleware, requireRole("SUPER_ADMIN"));

router.get("/categories", listCategories);
router.post("/categories", createCategory);
router.patch("/categories/:categoryId", updateCategory);
router.delete("/categories/:categoryId", deactivateCategory);

export default router;
