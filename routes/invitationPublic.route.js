import express from "express";
import rateLimit from "express-rate-limit";

import {
  getInvitationByToken,
  acceptInvitation,
} from "../controllers/admin/invitation.controller.js";

// ======================================================
// PUBLIC invitation-acceptance endpoints (Phase 11) — deliberately
// mounted OUTSIDE /api/admin, same convention as /webhooks/telegram:
// everything under /api/admin always requires adminAuthMiddleware,
// so an unauthenticated flow lives at its own top-level path instead
// of carrying an exception inside that otherwise-uniform prefix. The
// invitation TOKEN is the authentication here.
// ======================================================

const router = express.Router();

const acceptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

router.get("/:token", acceptLimiter, getInvitationByToken);
router.post("/:token/accept", acceptLimiter, acceptInvitation);

export default router;
