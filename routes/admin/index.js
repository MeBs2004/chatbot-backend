import express from "express";

import authRoutes from "./auth.route.js";
import userRoutes from "./user.route.js";
import companyRoutes from "./company.route.js";
import chatbotRoutes from "./chatbot.route.js";
import auditLogRoutes from "./auditLog.route.js";
import visitorRoutes from "./visitor.route.js";
import liveViewRoutes from "./liveView.route.js";
import conversationRoutes from "./conversation.route.js";
import analyticsRoutes from "./analytics.route.js";
import invitationRoutes from "./invitation.route.js";
import developerRoutes from "./developer.route.js";
import billingRoutes from "./billing.route.js";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { getDashboard } from "../../controllers/admin/dashboard.controller.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/companies", companyRoutes);
router.use("/chatbots", chatbotRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/visitors", visitorRoutes);
router.use("/live-view", liveViewRoutes);
router.use("/conversations", conversationRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/invitations", invitationRoutes);
router.use("/developer", developerRoutes);
router.use("/billing", billingRoutes);
router.get("/dashboard", adminAuthMiddleware, getDashboard);

export default router;
