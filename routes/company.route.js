import express from "express";
import { getCompany } from "../controllers/company.controller.js";

const router = express.Router();

// ==========================
// Get Company Configuration
// ==========================
router.get("/", getCompany);

export default router;