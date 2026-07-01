import express from "express";
import { Message } from "../controllers/chatbot.message.js";

const router = express.Router();

// ==========================
// Chat Message
// ==========================
router.post("/message", Message);

export default router;