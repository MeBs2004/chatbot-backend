import express from "express";
import rateLimit from "express-rate-limit";
import { calculateMarketing, calculateEnergyBomPublic } from "../../controllers/widget/calculator.controller.js";

const router = express.Router();

// Pure CPU math, no AI/provider cost behind it — still rate-limited
// since it's a public, unauthenticated POST (same convention as
// chatbot.route.js's /message limiter), just more generous.
const calcLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

router.post("/:chatbotId/marketing", calcLimiter, calculateMarketing);
router.post("/:chatbotId/energy-bom", calcLimiter, calculateEnergyBomPublic);

export default router;
