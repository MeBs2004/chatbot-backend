import express from "express";
import rateLimit from "express-rate-limit";

import {
  saveVisitor,
  saveEmail,
  updateVisitorName,
} from "../controllers/visitor.controller.js";

const router = express.Router();

// Phase 14 — same reasoning as chatbot.route.js's messageLimiter:
// this is public/unauthenticated and had no bound at all. Higher
// limit than /message since a real page load can legitimately fire
// visitor + email + name in quick succession.
const visitorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

router.use(visitorLimiter);

// ==========================
// Visitor Tracking
// ==========================
router.post("/", saveVisitor);

// ==========================
// Save Visitor Email
// ==========================
router.post("/email", saveEmail);

// ==========================
// Save Visitor Name
// ==========================
router.post("/name", updateVisitorName);

export default router;