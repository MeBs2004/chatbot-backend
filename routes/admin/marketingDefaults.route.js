import express from "express";
import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getMarketingCatalog } from "../../controllers/admin/marketingConfig.controller.js";

// Read-only fixed catalog (services taxonomy, capabilities, business
// types) — any authenticated admin, used by the Create Chatbot
// wizard's Marketing step before a chatbot exists yet. Unlike Energy/
// Education's platform catalog, there's nothing to manage here: the
// taxonomy is a fixed constant (config/marketingServices.js), not an
// admin-editable collection.
const router = express.Router();

router.get("/catalog", adminAuthMiddleware, getMarketingCatalog);

export default router;
