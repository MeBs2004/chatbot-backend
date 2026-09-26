import express from "express";
import rateLimit from "express-rate-limit";

import { login, logout, me, getMyPermissions } from "../../controllers/admin/auth.controller.js";
import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

router.post("/login", loginLimiter, login);
router.post("/logout", adminAuthMiddleware, logout);
router.get("/me", adminAuthMiddleware, me);
router.get("/permissions", adminAuthMiddleware, getMyPermissions);

export default router;
