import express from "express";
import rateLimit from "express-rate-limit";
import { getSuggestions } from "../controllers/suggestion.controller.js";

const router = express.Router();

// Phase 18 — this was the one public, unauthenticated /bot/v1/*
// route with no rate limit at all (message and visitor already had
// one since Phase 14). Same shape as visitorLimiter.
const suggestionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

// ==========================
// Get Chat Suggestions
// ==========================
router.get("/", suggestionsLimiter, getSuggestions);

export default router;