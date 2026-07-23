import express from "express";
import upload from "../middleware/upload.middleware.js";
import { Message } from "../controllers/chatbot.message.js";

const router = express.Router();

router.post(
  "/message",
  upload.single("file"),
  Message
);

export default router;