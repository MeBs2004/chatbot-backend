import express from "express";
import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import requireRole from "../../middleware/role.middleware.js";
import {
  getPlatformEnergyCatalog,
  listFuelCategories,
  createFuelCategory,
  updateFuelCategory,
  deactivateFuelCategory,
  listDefaultProductServices,
  createDefaultProductService,
  updateDefaultProductService,
  deactivateDefaultProductService,
  listDefaultProjectTypes,
  createDefaultProjectType,
  updateDefaultProjectType,
  deactivateDefaultProjectType,
} from "../../controllers/admin/energyDefaults.controller.js";

// Platform-wide Energy taxonomy (Section 14) — SUPER_ADMIN only.
// Deliberately separate from /chatbots/:id/energy/* (company-scoped,
// see chatbot.route.js): this manages the shared catalog every
// company's Energy Configuration step reads from, not one company's
// own selections or custom additions.
const router = express.Router();

// Any authenticated admin (any role, any company) — read-only, no
// company-specific data. Must come before the SUPER_ADMIN gate below.
router.get("/catalog", adminAuthMiddleware, getPlatformEnergyCatalog);

router.use(adminAuthMiddleware, requireRole("SUPER_ADMIN"));

router.get("/fuels", listFuelCategories);
router.post("/fuels", createFuelCategory);
router.patch("/fuels/:fuelId", updateFuelCategory);
router.delete("/fuels/:fuelId", deactivateFuelCategory);

router.get("/product-services", listDefaultProductServices);
router.post("/product-services", createDefaultProductService);
router.patch("/product-services/:itemId", updateDefaultProductService);
router.delete("/product-services/:itemId", deactivateDefaultProductService);

router.get("/project-types", listDefaultProjectTypes);
router.post("/project-types", createDefaultProjectType);
router.patch("/project-types/:itemId", updateDefaultProjectType);
router.delete("/project-types/:itemId", deactivateDefaultProjectType);

export default router;
