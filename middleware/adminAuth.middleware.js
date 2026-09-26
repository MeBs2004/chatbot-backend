import AdminUser from "../models/adminUser.model.js";
import { verifyAdminToken } from "../services/admin/token.service.js";

export const adminAuthMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    let payload;
    try {
      payload = verifyAdminToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again.",
      });
    }

    const adminUser = await AdminUser.findById(payload.sub);

    if (!adminUser) {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again.",
      });
    }

    if (adminUser.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is currently inactive. Please contact an administrator.",
      });
    }

    // Phase 18 — session-security fix. `(payload.tokenVersion || 0)`
    // treats a token issued before this change (no claim at all) as
    // version 0, matching every existing user's default — so
    // deploying this never force-logs-out already-active sessions.
    // Only an ACTUAL logout/password-change bumps the DB value from
    // here on, which is what makes those tokens stop working
    // immediately instead of drifting until natural expiry.
    if ((payload.tokenVersion || 0) !== (adminUser.tokenVersion || 0)) {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again.",
      });
    }

    req.adminUser = adminUser;
    next();
  } catch (error) {
    console.error("Admin Auth Middleware Error:", error);

    return res.status(500).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

export default adminAuthMiddleware;
