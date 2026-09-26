import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  listChatbots,
  getChatbotDetail,
  createChatbot,
  updateChatbot,
  updateChatbotConfig,
  assignChatbotAccess,
  removeChatbotAccessForUser,
} from "../../controllers/admin/chatbot.controller.js";
import {
  getFlow,
  saveFlowDraft,
  validateFlowDraft,
  publishFlow,
  listFlowVersions,
  rollbackFlow,
} from "../../controllers/admin/flow.controller.js";
import {
  getAiSettings,
  updateAiSettings,
  testAi,
  aiTestLimiter,
} from "../../controllers/admin/aiSettings.controller.js";
import {
  getChatbotKnowledge,
  updateChatbotKnowledge,
  knowledgeUploadMiddleware,
  extractChatbotKnowledgeUpload,
  testChatbotKnowledge,
} from "../../controllers/admin/knowledgeAdmin.controller.js";
import {
  listChannels,
  updateWebsiteChannel,
  connectTelegram,
  testTelegram,
  disconnectTelegram,
} from "../../controllers/admin/channel.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", listChatbots);
router.get("/:id", getChatbotDetail);
router.post("/", createChatbot);
router.patch("/:id", updateChatbot);
router.patch("/:id/config", updateChatbotConfig);
router.post("/:id/access", assignChatbotAccess);
router.delete("/:id/access/:userId", removeChatbotAccessForUser);

// Bot Builder (Phase 6)
router.get("/:id/flow", getFlow);
router.put("/:id/flow", saveFlowDraft);
router.post("/:id/flow/validate", validateFlowDraft);
router.post("/:id/flow/publish", publishFlow);
router.get("/:id/flow/versions", listFlowVersions);
router.post("/:id/flow/rollback", rollbackFlow);

// AI Settings + Knowledge Base (Phase 7)
router.get("/:id/ai-settings", getAiSettings);
router.put("/:id/ai-settings", updateAiSettings);
router.post("/:id/ai/test", aiTestLimiter, testAi);

router.get("/:id/knowledge", getChatbotKnowledge);
router.put("/:id/knowledge", updateChatbotKnowledge);
router.post("/:id/knowledge/upload", knowledgeUploadMiddleware, extractChatbotKnowledgeUpload);
router.post("/:id/knowledge/test", testChatbotKnowledge);

// Channels (Phase 10)
router.get("/:id/channels", listChannels);
router.put("/:id/channels/website", updateWebsiteChannel);
router.post("/:id/channels/telegram/connect", connectTelegram);
router.post("/:id/channels/telegram/test", testTelegram);
router.post("/:id/channels/telegram/disconnect", disconnectTelegram);

export default router;
