import AdminUser from "../../models/adminUser.model.js";
import { signAdminToken } from "../../services/admin/token.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { getCompanyRole } from "../../services/admin/access.service.js";
import { resolveEffectivePermissions } from "../../services/admin/permissions.service.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const login = async (req, res) => {
  try {
    const { email = "", password = "" } = req.body;

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (!password) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const adminUser = await AdminUser.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!adminUser) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const valid = await adminUser.comparePassword(password);

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (adminUser.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "Your account is currently inactive. Please contact an administrator.",
      });
    }

    adminUser.lastLogin = new Date();
    await adminUser.save();

    const token = signAdminToken(adminUser);

    req.adminUser = adminUser;
    await logAction(req, {
      action: "LOGIN",
      resource: "AdminUser",
      resourceId: adminUser._id,
    });

    return res.status(200).json({
      success: true,
      token,
      user: adminUser.toJSON(),
    });
  } catch (error) {
    console.error("Admin Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to connect to Nuformly. Please try again.",
    });
  }
};

export const logout = async (req, res) => {
  // Phase 18 — this is what actually makes logout revoke the JWT
  // that was just used to call it (and every other outstanding token
  // for this user), instead of it silently remaining valid until its
  // natural 8h expiry. See adminAuthMiddleware's tokenVersion check.
  if (req.adminUser) {
    req.adminUser.tokenVersion = (req.adminUser.tokenVersion || 0) + 1;
    await req.adminUser.save();
  }

  await logAction(req, {
    action: "LOGOUT",
    resource: "AdminUser",
    resourceId: req.adminUser?._id,
  });

  return res.status(200).json({
    success: true,
    message: "Logged out.",
  });
};

export const me = async (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.adminUser.toJSON(),
  });
};

/**
 * Phase 11 — the source of truth for "what can this user do in this
 * company", computed server-side (never trust a frontend-held
 * permission list). The frontend also keeps a static, UX-only copy
 * of this same matrix (admin-panel/src/utils/permissions.js) to
 * avoid a round trip for every render decision like sidebar
 * visibility, but every actual mutation is independently re-checked
 * by its own endpoint regardless of what this returns.
 */
export const getMyPermissions = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required." });
    }

    const companyRole = await getCompanyRole(req.adminUser, companyId);
    if (!companyRole) {
      return res.status(200).json({ success: true, companyRole: null, permissions: [] });
    }

    const overrides =
      companyRole === "SUPER_ADMIN"
        ? []
        : (
            await UserCompanyAccess.findOne({ userId: req.adminUser._id, companyId, status: "ACTIVE" })
              .select("permissionOverrides")
              .lean()
          )?.permissionOverrides;

    return res.status(200).json({
      success: true,
      companyRole,
      permissions: await resolveEffectivePermissions(companyRole, companyId, overrides),
    });
  } catch (error) {
    console.error("Get My Permissions Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load permissions." });
  }
};
