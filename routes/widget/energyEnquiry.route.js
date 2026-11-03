import express from "express";
import rateLimit from "express-rate-limit";
import { getSupplierMatches, createEnquiry } from "../../controllers/widget/energyEnquiry.controller.js";
import { getJourneyConfig, getJourneyOfferings, getJourneyQuestions, generateJourneySolution, askJourneyQuestion, requestJourneyHandoff, trackJourneyEvent } from "../../controllers/widget/energyJourney.controller.js";
import { journeyFileUploadMiddleware, uploadJourneyFile, serveJourneyFile } from "../../controllers/widget/energyJourneyFile.controller.js";

const router = express.Router();

const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
const matchLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
// Real engine work (not a keystroke-debounced lookup) — bounded tighter.
const generateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
// A real RFQ submission, bounded tighter still.
const enquiryLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
// Phase 5.1 — an AI call, bounded like other generate-class work.
const askLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
const handoffLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });
// Phase 6 — frequent but cheap; generous limit since a single journey fires several of these.
const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { success: false, message: "Too many requests. Please slow down." } });

// Phase 5 — the customer journey's read side (Phases 1–3's published config/questions).
router.get("/:chatbotId/journey/config", readLimiter, getJourneyConfig);
router.get("/:chatbotId/journey/offerings", readLimiter, getJourneyOfferings);
router.get("/:chatbotId/journey/questions", readLimiter, getJourneyQuestions);
router.post("/:chatbotId/journey/generate", generateLimiter, generateJourneySolution);

// Phase 5.1 — AI assistance + human handoff during the structured journey.
router.post("/:chatbotId/journey/ask", askLimiter, askJourneyQuestion);
router.post("/:chatbotId/journey/handoff", handoffLimiter, requestJourneyHandoff);

// Phase 6 — client-fired tracking for stage transitions with no other API call (see CLIENT_TRACKABLE_EVENTS).
router.post("/:chatbotId/journey/track", trackLimiter, trackJourneyEvent);

// Phase 5.1 — real file upload for "file"-type questions.
router.post("/:chatbotId/journey/questions/:questionId/upload", uploadLimiter, journeyFileUploadMiddleware, uploadJourneyFile);
router.get("/:chatbotId/journey/files/:fileId", readLimiter, serveJourneyFile);

// Phase 4 — supplier matching + RFQ creation (reused as-is).
router.post("/:chatbotId/suppliers/match", matchLimiter, getSupplierMatches);
router.post("/:chatbotId/enquiries", enquiryLimiter, createEnquiry);

export default router;
