import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  resendInvitation,
} from "../../controllers/admin/invitation.controller.js";

const router = express.Router();

// Authenticated (SUPER_ADMIN or scoped COMPANY_ADMIN — enforced
// inside each controller, same convention as user.route.js).
router.use(adminAuthMiddleware);

router.post("/", createInvitation);
router.get("/", listInvitations);
router.post("/:id/revoke", revokeInvitation);
router.post("/:id/resend", resendInvitation);

export default router;
