import express from "express";
import rateLimit from "express-rate-limit";
import { getEducationCategories, getEducationFaqs, getEducationCourses, createLead } from "../../controllers/widget/education.controller.js";

const router = express.Router();

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });

router.get("/:chatbotId/categories", readLimiter, getEducationCategories);
router.get("/:chatbotId/faqs", readLimiter, getEducationFaqs);
router.get("/:chatbotId/courses", readLimiter, getEducationCourses);
router.post("/:chatbotId/leads", leadLimiter, createLead);

export default router;
