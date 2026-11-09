import AuditLog from "../../models/auditLog.model.js";
import AdminUser from "../../models/adminUser.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import { hasFeature } from "../../services/billing/plan.service.js";

export const listAuditLogs = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const { companyId, action } = req.query;

    const filter = {};
    if (action) filter.action = action;

    if (requester.role === "SUPER_ADMIN") {
      if (companyId) filter.companyId = companyId;
    } else {
      // Phase 11 (Section 27) — a Company Admin sees only events for
      // companies where they hold an ACTIVE COMPANY_ADMIN row, never
      // platform-wide events (companyId: null, e.g. another user's
      // LOGIN) and never another company's events. Anyone who isn't
      // a Company Admin anywhere sees nothing, rather than erroring —
      // consistent with how every other list endpoint in this app
      // degrades for a requester with zero accessible companies.
      const adminRows = await UserCompanyAccess.find({
        userId: requester._id,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      })
        .select("companyId")
        .lean();
      const candidateCompanyIds = adminRows.map((r) => r.companyId);

      // Audit Logs is an Enterprise-plan feature — a Company Admin
      // only sees logs for companies whose plan actually includes it
      // (they may administer several companies on different plans).
      const entitlementChecks = await Promise.all(
        candidateCompanyIds.map((id) => hasFeature(id, "audit_logs"))
      );
      const allowedCompanyIds = candidateCompanyIds.filter((_, i) => entitlementChecks[i]);

      if (companyId) {
        if (!allowedCompanyIds.includes(companyId)) {
          const wasCandidate = candidateCompanyIds.includes(companyId);
          return res.status(wasCandidate ? 402 : 403).json({
            success: false,
            code: wasCandidate ? "PLAN_FEATURE_LOCKED" : undefined,
            message: wasCandidate
              ? "Audit Logs is available on the Enterprise plan."
              : "You don't have permission to access this resource.",
          });
        }
        filter.companyId = companyId;
      } else {
        filter.companyId = { $in: allowedCompanyIds };
      }
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    const userIds = [...new Set(logs.map((l) => String(l.userId)))];
    const users = await AdminUser.find({ _id: { $in: userIds } })
      .select("name email")
      .lean();
    const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

    const result = logs.map((l) => ({
      ...l,
      user: userMap[String(l.userId)] || null,
    }));

    return res.status(200).json({
      success: true,
      logs: result,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("List Audit Logs Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load audit logs.",
    });
  }
};
