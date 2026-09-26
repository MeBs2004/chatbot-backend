import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  listConversations,
  getConversationThread,
  updateConversationStatus,
  postAgentReply,
  addNote,
} from "../../controllers/admin/conversation.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

router.get("/", listConversations);
router.get("/:companyId/:visitorId", getConversationThread);
router.patch("/:companyId/:visitorId", updateConversationStatus);
router.post("/:companyId/:visitorId/messages", postAgentReply);
router.post("/:companyId/:visitorId/notes", addNote);

export default router;
