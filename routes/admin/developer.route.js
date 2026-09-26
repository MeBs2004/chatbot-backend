import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  listApiKeys,
  createApiKey,
  getApiKey,
  rotateApiKey,
  revokeApiKey,
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  getUsage,
  getDeveloperSettings,
  updateDeveloperSettings,
} from "../../controllers/admin/developer.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/api-keys", listApiKeys);
router.post("/api-keys", createApiKey);
router.get("/api-keys/:id", getApiKey);
router.post("/api-keys/:id/rotate", rotateApiKey);
router.post("/api-keys/:id/revoke", revokeApiKey);

router.get("/webhooks", listWebhooks);
router.post("/webhooks", createWebhook);
router.patch("/webhooks/:id", updateWebhook);
router.delete("/webhooks/:id", deleteWebhook);
router.post("/webhooks/:id/test", testWebhook);

router.get("/usage", getUsage);

router.get("/settings", getDeveloperSettings);
router.patch("/settings", updateDeveloperSettings);

export default router;
