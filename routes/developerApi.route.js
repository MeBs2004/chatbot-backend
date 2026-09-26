import express from "express";

import { apiKeyAuthMiddleware, requireScope } from "../middleware/apiKeyAuth.middleware.js";
import {
  getCompany,
  listChatbots,
  getChatbot,
  listConversations,
  getConversationThread,
  postConversationMessage,
  listVisitors,
  getAnalytics,
  getKnowledge,
} from "../controllers/developerApi/developerApi.controller.js";
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
} from "../controllers/developerApi/developerApiWebhooks.controller.js";

// ======================================================
// DEVELOPER API v1 (Phase 12) — /api/v1/developer/*
// Authenticated with API keys ONLY (apiKeyAuthMiddleware), never the
// admin JWT (adminAuthMiddleware) — a completely separate mount from
// /api/admin/*, matching Section 36's "clearly distinguish public/
// developer APIs from admin APIs".
// ======================================================

const router = express.Router();

router.use(apiKeyAuthMiddleware);

router.get("/company", requireScope("company:read"), getCompany);

router.get("/chatbots", requireScope("chatbots:read"), listChatbots);
router.get("/chatbots/:id", requireScope("chatbots:read"), getChatbot);

router.get("/conversations", requireScope("conversations:read"), listConversations);
router.get("/conversations/:visitorId", requireScope("conversations:read"), getConversationThread);
router.post("/conversations/:visitorId/messages", requireScope("conversations:write"), postConversationMessage);

router.get("/visitors", requireScope("visitors:read"), listVisitors);

router.get("/analytics", requireScope("analytics:read"), getAnalytics);

router.get("/knowledge", requireScope("knowledge:read"), getKnowledge);

router.get("/webhooks", requireScope("webhooks:read"), listWebhooks);
router.post("/webhooks", requireScope("webhooks:write"), createWebhook);
router.patch("/webhooks/:id", requireScope("webhooks:write"), updateWebhook);
router.delete("/webhooks/:id", requireScope("webhooks:write"), deleteWebhook);

export default router;
