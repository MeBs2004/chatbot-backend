/**
 * requireRole("SUPER_ADMIN", "COMPANY_ADMIN") — SUPER_ADMIN
 * always passes regardless of the roles listed.
 */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.adminUser) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (req.adminUser.role === "SUPER_ADMIN") {
      return next();
    }

    if (!roles.includes(req.adminUser.role)) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to access this resource.",
      });
    }

    next();
  };

export default requireRole;
