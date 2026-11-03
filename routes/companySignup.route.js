import express from "express";
import rateLimit from "express-rate-limit";

import { registerCompany, checkSlugAvailability, sendSignupOtp } from "../controllers/companySignup.controller.js";

// ======================================================
// PUBLIC company self-registration — mounted OUTSIDE /api/admin,
// same convention as routes/invitationPublic.route.js.
// ======================================================

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

// Generous but still bounded — this is called on every keystroke
// (debounced client-side), not just on final submit.
const slugCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please slow down." },
});

// A real inbox check, not a keystroke-debounced one — bounded more
// tightly than slug-check, generously more than final registration
// (a resend or two is normal; dozens in 15 minutes isn't).
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many codes requested. Please wait a few minutes and try again." },
});

router.get("/check-slug", slugCheckLimiter, checkSlugAvailability);
router.post("/send-otp", otpLimiter, sendSignupOtp);
router.post("/", registerLimiter, registerCompany);

export default router;
