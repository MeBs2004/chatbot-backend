import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import { listAuditLogs } from "../../controllers/admin/auditLog.controller.js";

const router = express.Router();

// Phase 11 (Section 27): Company Admins may now see audit events for
// their own company, not just Super Admins. A global-role
// requireRole("COMPANY_ADMIN") gate can't express "Company Admin
// for THIS company" (a user's global AdminUser.role can differ from
// their per-company UserCompanyAccess.role) so, same convention as
// every other company-scoped controller in this codebase, the real
// check — SUPER_ADMIN sees everything, a real per-company
// COMPANY_ADMIN sees only their own companies' logs, everyone else
// gets an empty result — lives entirely inside listAuditLogs.
router.use(adminAuthMiddleware);

router.get("/", listAuditLogs);

export default router;
