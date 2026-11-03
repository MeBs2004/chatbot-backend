import express from "express";
import rateLimit from "express-rate-limit";
import { getMarketingConfig, createLead } from "../../controllers/widget/marketing.controller.js";

const router = express.Router();

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });

router.get("/:chatbotId/config", readLimiter, getMarketingConfig);
router.post("/:chatbotId/leads", leadLimiter, createLead);

export default router;
