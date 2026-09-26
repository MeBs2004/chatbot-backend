import express from "express";
import { handleTelegramWebhook } from "../../controllers/webhooks/telegram.controller.js";

const router = express.Router();

// Public — no adminAuthMiddleware. Authenticated instead by the
// per-connection secret_token Telegram echoes back on every call
// (verified inside the handler). See handler's own doc comment.
router.post("/:connectionId", handleTelegramWebhook);

export default router;
