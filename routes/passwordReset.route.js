import express from "express";
import rateLimit from "express-rate-limit";
import { forgotPassword, verifyResetToken, verifyResetCode, resetPassword, resetPasswordWithCode } from "../controllers/passwordReset.controller.js";

// PUBLIC — mounted outside /api/admin (see controllers/passwordReset.controller.js).
const router = express.Router();

const limiter = (max) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Please try again in a few minutes." },
  });

router.post("/forgot", limiter(5), forgotPassword);
router.get("/verify", limiter(30), verifyResetToken);
router.post("/reset", limiter(10), resetPassword);
// Generous bound — the per-account 5-attempt cap in the controller is
// the real brute-force defense for a 6-digit code; this just stops one
// IP hammering the endpoint across many accounts.
router.post("/verify-code", limiter(20), verifyResetCode);
router.post("/reset-with-code", limiter(20), resetPasswordWithCode);

export default router;
