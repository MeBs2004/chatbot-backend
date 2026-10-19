import express from "express";
import mongoose from "mongoose";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { createWidgetSession, getInstallInfo } from "../../controllers/widget/session.controller.js";

const router = express.Router();

const tooMany = { success: false, message: "Too many requests. Please slow down." };

// Overall ceiling per IP, whatever chatbotId is sent — varying the id
// must not buy a fresh allowance.
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: tooMany,
});

// Per chatbot + IP, so one chatbot's traffic can't use up another's.
// Anything that isn't a real ObjectId shares a single bucket.
const chatbotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.body?.chatbotId;
    const bucket = typeof id === "string" && mongoose.Types.ObjectId.isValid(id) ? id : "invalid";
    return `${bucket}:${ipKeyGenerator(req.ip)}`;
  },
  message: tooMany,
});

router.post("/", ipLimiter, chatbotLimiter, createWidgetSession);

export default router;

// Mounted separately at /api/widget/install-info (see index.js).
export const installInfoRouter = express.Router();
installInfoRouter.get("/:chatbotId", ipLimiter, getInstallInfo);
