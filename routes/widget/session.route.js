import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createWidgetSession } from "../../controllers/widget/session.controller.js";

const router = express.Router();

// Public. Keyed per chatbot + IP so traffic on one chatbot can't use
// up another chatbot's allowance.
const sessionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.body?.chatbotId}:${ipKeyGenerator(req.ip)}`,
  message: { success: false, message: "Too many requests. Please slow down." },
});

router.post("/", sessionLimiter, createWidgetSession);

export default router;
