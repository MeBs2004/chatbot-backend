import AuditLog from "../../models/auditLog.model.js";

/**
 * Fire-and-forget audit logging. Never throws — a logging
 * failure must not fail the admin action that triggered it.
 */
export const logAction = async (
  req,
  { action, resource, resourceId = "", companyId = null, metadata = {} }
) => {
  try {
    await AuditLog.create({
      userId: req.adminUser?._id,
      companyId,
      action,
      resource,
      resourceId: String(resourceId || ""),
      metadata,
      ip:
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.socket?.remoteAddress ||
        "",
    });
  } catch (error) {
    console.error("Audit Log Error:", error);
  }
};
