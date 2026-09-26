import express from "express";
import rateLimit from "express-rate-limit";
import upload from "../middleware/upload.middleware.js";
import { Message } from "../controllers/chatbot.message.js";

const router = express.Router();

// Phase 14 — this is the ONE public, unauthenticated endpoint that
// triggers a real, paid AI provider call, and it had no rate limit
// at all before this phase (audit finding). Without this, an
// anonymous caller could burn through a company's entire monthly AI
// quota (Phase 13) in seconds, degrading the real chatbot for every
// legitimate visitor — a cost-DoS, not just an inconvenience. Keyed
// by IP (default keyGenerator — there's no authenticated identity on
// this path), generous enough for real conversational use (a
// message every ~2s sustained) while meaningfully capping abuse.
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many messages. Please slow down." },
});

router.post(
  "/message",
  messageLimiter,
  upload.single("file"),
  Message
);

export default router;