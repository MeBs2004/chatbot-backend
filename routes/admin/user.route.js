import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserStatus,
  setCompanyAccess,
  removeCompanyAccess,
  setChatbotAccess,
  removeChatbotAccess,
  deleteUser,
  resetUserPassword,
  getUserEffectivePermissions,
  setUserPermissionOverrides,
} from "../../controllers/admin/user.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

// Phase 11: team-management mutations are no longer SUPER_ADMIN-only
// — a COMPANY_ADMIN may manage their own company's users too
// (Section 14/15). There's deliberately no route-level requireRole
// here, same convention as every other chatbot-scoped/company-scoped
// controller in this codebase (chatbot.controller.js,
// knowledgeAdmin.controller.js, etc): a global AdminUser.role check
// can't express "COMPANY_ADMIN for THIS company", so the full,
// scoped authorization (and every SUPER_ADMIN-only carve-out, e.g.
// never touching another Super Admin) lives inside each controller
// function instead — see user.controller.js. AGENT/VIEWER/DEVELOPER
// requesters are still rejected there (they hold no COMPANY_ADMIN
// rows anywhere), just one level deeper than a route gate.

router.get("/", listUsers);
router.get("/:id", getUser);
router.post("/", createUser);
// Self-vs-others and role-change checks are enforced inside updateUser.
router.patch("/:id", updateUser);
router.post("/:id/status", setUserStatus);
router.post("/:id/company-access", setCompanyAccess);
router.delete("/:id/company-access/:companyId", removeCompanyAccess);
router.post("/:id/chatbot-access", setChatbotAccess);
router.delete("/:id/chatbot-access/:chatbotId", removeChatbotAccess);
router.delete("/:id", deleteUser);
router.post("/:id/reset-password", resetUserPassword);
router.get("/:id/effective-permissions", getUserEffectivePermissions);
router.patch("/:id/permission-overrides", setUserPermissionOverrides);

export default router;
