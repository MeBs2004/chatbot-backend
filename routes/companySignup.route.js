import express from "express";
import rateLimit from "express-rate-limit";

import { registerCompany, checkSlugAvailability } from "../controllers/companySignup.controller.js";

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

router.get("/check-slug", slugCheckLimiter, checkSlugAvailability);
router.post("/", registerLimiter, registerCompany);

export default router;
