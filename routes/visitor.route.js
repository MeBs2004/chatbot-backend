import express from "express";

import {
  saveVisitor,
  saveEmail,
  updateVisitorName,
} from "../controllers/visitor.controller.js";

const router = express.Router();

// ==========================
// Visitor Tracking
// ==========================
router.post("/", saveVisitor);

// ==========================
// Save Visitor Email
// ==========================
router.post("/email", saveEmail);

// ==========================
// Save Visitor Name
// ==========================
router.post("/name", updateVisitorName);

export default router;