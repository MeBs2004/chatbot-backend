import crypto from "crypto";

import AdminUser from "../../models/adminUser.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ChatbotAccess from "../../models/chatbotAccess.model.js";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import Conversation from "../../models/conversation.model.js";
import { logAction } from "../../services/admin/audit.service.js";
import { assertMemberQuota, QuotaExceededError } from "../../services/billing/quota.service.js";
import { emitDomainEvent, disconnectUserSockets } from "../../services/realtime/io.js";
import { EVENTS } from "../../services/realtime/events.js";
import { unassignTasks } from "../../services/admin/task.service.js";
import { isValidRoleForCompany } from "../../services/admin/role.service.js";
import { PERMISSIONS, resolveEffectivePermissions, resolveRolePermissions } from "../../services/admin/permissions.service.js";
import Role from "../../models/role.model.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"];

// ======================================================
// Phase 11 — team-management helpers shared by every mutation below.
// A Company Admin's authority is always scoped to companies where
// THEY hold an ACTIVE COMPANY_ADMIN UserCompanyAccess row, and never
// extends to a SUPER_ADMIN target or to granting SUPER_ADMIN — both
// checked explicitly at every call site, never assumed.
// ======================================================

async function getCompanyAdminCompanyIds(requester) {
  const rows = await UserCompanyAccess.find({
    userId: requester._id,
    role: "COMPANY_ADMIN",
    status: "ACTIVE",
  })
    .select("companyId")
    .lean();
  return rows.map((r) => r.companyId);
}

// True if `requester` is an ACTIVE COMPANY_ADMIN of at least one
// company `targetUser` also has ACTIVE access to. Never true for a
// SUPER_ADMIN target — a Company Admin can never manage a Super
// Admin's account, regardless of company overlap.
async function canManageUserAsCompanyAdmin(requester, targetUser) {
  if (targetUser.role === "SUPER_ADMIN") return false;
  const adminCompanyIds = await getCompanyAdminCompanyIds(requester);
  if (adminCompanyIds.length === 0) return false;
  const overlap = await UserCompanyAccess.exists({
    userId: targetUser._id,
    companyId: { $in: adminCompanyIds },
    status: "ACTIVE",
  });
  return !!overlap;
}

// Section 16 — refuse an action that would leave zero ACTIVE
// SUPER_ADMINs. `excludeUserId` is the user being demoted/disabled/
// deleted, so they're not counted against themselves.
async function assertNotLastSuperAdmin(excludeUserId) {
  const remaining = await AdminUser.countDocuments({
    role: "SUPER_ADMIN",
    status: "ACTIVE",
    _id: { $ne: excludeUserId },
  });
  return remaining > 0;
}

// Section 17 — company IDs where `userId` is currently the ONLY
// ACTIVE COMPANY_ADMIN. Non-empty means the caller's action would
// leave that company without an administrator and must be blocked.
async function findSoleCompanyAdminCompanies(userId) {
  const rows = await UserCompanyAccess.find({
    userId,
    role: "COMPANY_ADMIN",
    status: "ACTIVE",
  })
    .select("companyId")
    .lean();

  const blocking = [];
  for (const row of rows) {
    const count = await UserCompanyAccess.countDocuments({
      companyId: row.companyId,
      role: "COMPANY_ADMIN",
      status: "ACTIVE",
    });
    if (count <= 1) blocking.push(row.companyId);
  }
  return blocking;
}

// Section 33 — an agent who can no longer act (disabled/deleted)
// must not leave conversations silently assigned to a nonexistent
// or unreachable user. Unassigning is the safe, already-supported
// behavior (listConversations already has an "unassigned" filter).
async function unassignConversations(userId) {
  await Conversation.updateMany({ assignedTo: userId }, { assignedTo: null });
}

export const listUsers = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const { search, role, status, companyId } = req.query;

    const filter = {};
    const andClauses = [];
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (search) {
      andClauses.push({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      });
    }

    // Used by assignee pickers (e.g. tasks) that need "who has access
    // to THIS company" rather than every teammate the requester can see.
    if (companyId) {
      const companyUserIds = (
        await UserCompanyAccess.find({ companyId, status: "ACTIVE" }).select("userId").lean()
      ).map((r) => String(r.userId));
      andClauses.push({ $or: [{ _id: { $in: companyUserIds } }, { role: "SUPER_ADMIN" }] });
    }
    if (andClauses.length > 0) filter.$and = andClauses;

    // Non-super-admins only see teammates who share at least
    // one company access with them, plus themselves — and only the
    // overlapping company grants, never a peer's unrelated companies.
    let myCompanyIds = null;

    if (requester.role !== "SUPER_ADMIN") {
      myCompanyIds = (
        await UserCompanyAccess.find({
          userId: requester._id,
          status: "ACTIVE",
        })
          .select("companyId")
          .lean()
      ).map((r) => r.companyId);

      const peerRows = await UserCompanyAccess.find({
        companyId: { $in: myCompanyIds },
        status: "ACTIVE",
      })
        .select("userId")
        .lean();

      const allowedUserIds = [
        ...new Set(peerRows.map((r) => String(r.userId))),
        String(requester._id),
      ];

      filter._id = { $in: allowedUserIds };
    }

    const [users, total] = await Promise.all([
      AdminUser.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AdminUser.countDocuments(filter),
    ]);

    const userIds = users.map((u) => u._id);
    const [accessRows, chatbotAccessRows] = await Promise.all([
      UserCompanyAccess.find({
        userId: { $in: userIds },
        status: "ACTIVE",
        ...(myCompanyIds !== null ? { companyId: { $in: myCompanyIds } } : {}),
      }).lean(),
      ChatbotAccess.find({ userId: { $in: userIds } }).select("userId").lean(),
    ]);

    const accessByUser = {};
    accessRows.forEach((r) => {
      const key = String(r.userId);
      accessByUser[key] = accessByUser[key] || [];
      accessByUser[key].push(r.companyId);
    });

    const chatbotAccessCountByUser = {};
    chatbotAccessRows.forEach((r) => {
      const key = String(r.userId);
      chatbotAccessCountByUser[key] = (chatbotAccessCountByUser[key] || 0) + 1;
    });

    const safeUsers = users.map((u) => {
      const { passwordHash, ...rest } = u;
      return {
        ...rest,
        companyAccess:
          u.role === "SUPER_ADMIN" ? "ALL" : accessByUser[String(u._id)] || [],
        chatbotAccessCount: chatbotAccessCountByUser[String(u._id)] || 0,
      };
    });

    return res.status(200).json({
      success: true,
      users: safeUsers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error("List Users Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load users.",
    });
  }
};

export const getUser = async (req, res) => {
  try {
    const requester = req.adminUser;
    const user = await AdminUser.findById(req.params.id).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const isSelfOrSuperAdmin =
      requester.role === "SUPER_ADMIN" ||
      String(requester._id) === String(user._id);

    let myCompanyIds = null;

    if (!isSelfOrSuperAdmin) {
      const [myRows, theirRows] = await Promise.all([
        UserCompanyAccess.find({ userId: requester._id, status: "ACTIVE" })
          .select("companyId")
          .lean(),
        UserCompanyAccess.find({ userId: user._id, status: "ACTIVE" })
          .select("companyId")
          .lean(),
      ]);

      myCompanyIds = myRows.map((r) => r.companyId);
      const theirCompanyIds = theirRows.map((r) => r.companyId);

      const overlap = theirCompanyIds.some((c) => myCompanyIds.includes(c));

      if (!overlap) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const [companyAccess, allChatbotAccess] = await Promise.all([
      UserCompanyAccess.find({
        userId: user._id,
        status: "ACTIVE",
        ...(myCompanyIds !== null ? { companyId: { $in: myCompanyIds } } : {}),
      }).lean(),
      ChatbotAccess.find({ userId: user._id }).lean(),
    ]);

    // Same principle for chatbot-level access: never leak a peer's
    // access to a chatbot in a company the requester can't see.
    let chatbotAccess = allChatbotAccess;
    let visibleChatbots = [];
    const chatbots = allChatbotAccess.length
      ? await Chatbot.find({ _id: { $in: allChatbotAccess.map((a) => a.chatbotId) } })
          .select("companyId name")
          .lean()
      : [];
    const chatbotById = Object.fromEntries(chatbots.map((c) => [String(c._id), c]));

    if (myCompanyIds !== null && allChatbotAccess.length > 0) {
      const visibleChatbotIds = new Set(
        chatbots
          .filter((c) => myCompanyIds.includes(c.companyId))
          .map((c) => String(c._id))
      );
      chatbotAccess = allChatbotAccess.filter((a) =>
        visibleChatbotIds.has(String(a.chatbotId))
      );
    }
    visibleChatbots = chatbotAccess.map((a) => ({
      ...a,
      chatbot: chatbotById[String(a.chatbotId)] || null,
    }));

    // Real companies+chatbots the ACTING user (not the viewed user)
    // can grant, so the frontend's access-management UI never shows
    // options it would be rejected for server-side anyway.
    let grantableCompanyIds = null;
    if (requester.role !== "SUPER_ADMIN") {
      grantableCompanyIds = await getCompanyAdminCompanyIds(requester);
    }

    delete user.passwordHash;

    return res.status(200).json({
      success: true,
      user,
      companyAccess,
      chatbotAccess: visibleChatbots,
      grantableCompanyIds,
    });
  } catch (error) {
    console.error("Get User Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load user.",
    });
  }
};

export const createUser = async (req, res) => {
  try {
    const requester = req.adminUser;
    const {
      name,
      email,
      phone,
      password,
      role,
      companyAccess = [],
      chatbotAccess = [],
    } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required." });
    }

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    if (!ROLES.includes(role)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid role." });
    }

    // Phase 11 — a Company Admin may create teammates, but never a
    // Super Admin, and only scoped to companies they themselves
    // administer (Section 14).
    let allowedCompanyIds = null;
    if (requester.role !== "SUPER_ADMIN") {
      if (role === "SUPER_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "Only a Super Admin can create a Super Admin.",
        });
      }
      allowedCompanyIds = await getCompanyAdminCompanyIds(requester);
      if (allowedCompanyIds.length === 0) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to create users.",
        });
      }
    }

    const existing = await AdminUser.findOne({
      email: email.trim().toLowerCase(),
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A user with this email already exists.",
      });
    }

    // Validate + normalize company access before creating anything.
    const normalizedCompanyAccess = [];
    if (role !== "SUPER_ADMIN" && Array.isArray(companyAccess)) {
      for (const entry of companyAccess) {
        const companyId = typeof entry === "string" ? entry : entry.companyId;
        if (!companyId) continue;

        if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
          return res.status(403).json({
            success: false,
            message: `You don't have permission to grant access to company "${companyId}".`,
          });
        }

        const companyExists = await Company.exists({ companyId });
        if (!companyExists) {
          return res.status(400).json({
            success: false,
            message: `Company "${companyId}" does not exist.`,
          });
        }

        const entryRole = (typeof entry === "object" && entry.role) || role;
        if (!(await isValidRoleForCompany(entryRole, companyId))) {
          return res.status(400).json({
            success: false,
            message: `Invalid company role "${entryRole}".`,
          });
        }

        normalizedCompanyAccess.push({
          companyId,
          role: entryRole,
          permissions: (typeof entry === "object" && entry.permissions) || [],
        });
      }
    }

    if (allowedCompanyIds && normalizedCompanyAccess.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Select at least one company for this user.",
      });
    }

    for (const entry of normalizedCompanyAccess) {
      try {
        await assertMemberQuota(entry.companyId);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          return res.status(402).json({ success: false, message: err.message, code: "QUOTA_EXCEEDED", limitKey: err.limitKey });
        }
        throw err;
      }
    }

    // Validate chatbot access the same way — must resolve to a real
    // chatbot, and (for a scoped Company Admin) that chatbot's
    // company must be one they administer.
    const normalizedChatbotAccess = [];
    if (Array.isArray(chatbotAccess)) {
      for (const entry of chatbotAccess) {
        const chatbotId = typeof entry === "string" ? entry : entry.chatbotId;
        if (!chatbotId) continue;

        const chatbot = await Chatbot.findById(chatbotId).select("companyId").lean();
        if (!chatbot) {
          return res.status(400).json({
            success: false,
            message: "One of the selected chatbots does not exist.",
          });
        }
        if (allowedCompanyIds && !allowedCompanyIds.includes(chatbot.companyId)) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to grant access to that chatbot.",
          });
        }

        normalizedChatbotAccess.push({
          chatbotId,
          permissions: (typeof entry === "object" && entry.permissions) || [],
        });
      }
    }

    const user = new AdminUser({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone || "",
      role,
    });

    await user.setPassword(password);
    await user.save();

    for (const entry of normalizedCompanyAccess) {
      await UserCompanyAccess.create({ userId: user._id, ...entry });
    }
    for (const entry of normalizedChatbotAccess) {
      await ChatbotAccess.create({ userId: user._id, ...entry });
    }

    await logAction(req, {
      action: "CREATE_USER",
      resource: "AdminUser",
      resourceId: user._id,
      metadata: { email: user.email, role: user.role },
    });

    return res.status(201).json({
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Create User Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create user.",
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const requester = req.adminUser;
    const user = await AdminUser.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const isSelf = String(requester._id) === String(user._id);
    const isSuperAdmin = requester.role === "SUPER_ADMIN";

    // Anyone may edit their own name/phone/password. Editing
    // someone else requires SUPER_ADMIN, or being a Company Admin
    // who shares a company with this user (and the user isn't a
    // Super Admin).
    let isScopedCompanyAdmin = false;
    if (!isSelf && !isSuperAdmin) {
      isScopedCompanyAdmin = await canManageUserAsCompanyAdmin(requester, user);
      if (!isScopedCompanyAdmin) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    const { name, phone, role, password } = req.body;

    if (name !== undefined) user.name = name.trim();
    if (phone !== undefined) user.phone = phone;

    if (role !== undefined) {
      if (!ROLES.includes(role)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid role." });
      }
      if (role === "SUPER_ADMIN" && !isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only a Super Admin can grant Super Admin.",
        });
      }

      // Section 15/25 — a user may never change their OWN role
      // except a Super Admin (who is then still protected by the
      // last-Super-Admin check below); a Company Admin can change
      // someone ELSE's role within a shared company, but not their
      // own (avoids any self-escalation path).
      if (!isSuperAdmin) {
        if (isSelf || !isScopedCompanyAdmin) {
          return res.status(403).json({
            success: false,
            message: "You don't have permission to change this role.",
          });
        }
      }

      if (user.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
        if (!(await assertNotLastSuperAdmin(user._id))) {
          return res.status(400).json({
            success: false,
            message: "At least one Super Admin must remain.",
          });
        }
      }

      const previousRole = user.role;
      user.role = role;
      req._roleChange = { from: previousRole, to: role };
    }

    if (password) {
      if (!isSelf && !isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to change this user's password.",
        });
      }
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 8 characters.",
        });
      }
      await user.setPassword(password);
    }

    await user.save();

    await logAction(req, {
      action: "UPDATE_USER",
      resource: "AdminUser",
      resourceId: user._id,
      metadata: {
        fields: Object.keys(req.body || {}),
        ...(req._roleChange ? { roleChange: req._roleChange } : {}),
      },
    });

    // Section 16/26 — backend authorization was ALWAYS live per-request
    // (adminAuthMiddleware re-fetches AdminUser on every call), but a
    // currently-open browser tab's React state kept the stale role
    // until its next /auth/me. This tells that user's own session(s)
    // to refresh now, closing that UI-only staleness gap — never a
    // security fix by itself (the REST layer was never actually
    // bypassable), just an honesty/UX one.
    if (req._roleChange) {
      emitDomainEvent(EVENTS.USER_UPDATED, {
        userId: user._id,
        payload: { changedFields: ["role"] },
      });
    }

    return res.status(200).json({
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Update User Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user.",
    });
  }
};

export const setUserStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["ACTIVE", "INACTIVE", "SUSPENDED"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status." });
    }

    const requester = req.adminUser;
    const user = await AdminUser.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (String(user._id) === String(requester._id) && status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      if (!(await canManageUserAsCompanyAdmin(requester, user))) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    if (status !== "ACTIVE") {
      if (user.role === "SUPER_ADMIN" && !(await assertNotLastSuperAdmin(user._id))) {
        return res.status(400).json({
          success: false,
          message: "At least one Super Admin must remain.",
        });
      }

      const blocking = await findSoleCompanyAdminCompanies(user._id);
      if (blocking.length > 0) {
        return res.status(400).json({
          success: false,
          message: `${user.name} is the only Company Admin for ${blocking.join(", ")}. Assign another Company Admin first.`,
        });
      }
    }

    user.status = status;
    await user.save();

    if (status !== "ACTIVE") {
      await unassignConversations(user._id);
      await unassignTasks(user._id);
      // See services/realtime/io.js — REST access was already cut by
      // the status write above (adminAuthMiddleware re-checks it on
      // every request); this only drops an already-open realtime
      // connection so it stops receiving room broadcasts too.
      disconnectUserSockets(user._id);
    } else {
      emitDomainEvent(EVENTS.USER_UPDATED, { userId: user._id, payload: { changedFields: ["status"] } });
    }

    await logAction(req, {
      action: `SET_USER_STATUS_${status}`,
      resource: "AdminUser",
      resourceId: user._id,
    });

    return res.status(200).json({
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Set User Status Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user status.",
    });
  }
};

export const setCompanyAccess = async (req, res) => {
  try {
    const { companyId, role, permissions = [] } = req.body;

    if (!companyId || !role) {
      return res.status(400).json({
        success: false,
        message: "companyId and role are required.",
      });
    }

    const companyExists = await Company.exists({ companyId });
    if (!companyExists) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    if (!(await isValidRoleForCompany(role, companyId))) {
      return res.status(400).json({
        success: false,
        message: "Invalid role.",
      });
    }

    const requester = req.adminUser;
    const targetUser = await AdminUser.findById(req.params.id).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (requester.role !== "SUPER_ADMIN") {
      if (targetUser.role === "SUPER_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to modify a Super Admin's access.",
        });
      }
      const companyRole = await UserCompanyAccess.findOne({
        userId: requester._id,
        companyId,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      }).lean();
      if (!companyRole) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to manage access for this company.",
        });
      }

      // Phase 43 — never let a Company Admin hand out a role (custom
      // or system) that grants a permission they don't themselves
      // effectively have.
      const requesterEffective = await resolveEffectivePermissions(
        "COMPANY_ADMIN",
        companyId,
        (
          await UserCompanyAccess.findOne({ userId: requester._id, companyId, status: "ACTIVE" })
            .select("permissionOverrides")
            .lean()
        )?.permissionOverrides
      );
      const targetGrantPermissions = await resolveEffectivePermissions(role, companyId, []);
      const missing = targetGrantPermissions.filter((p) => !requesterEffective.includes(p));
      if (missing.length > 0) {
        return res.status(403).json({
          success: false,
          message: `You cannot grant a role with a permission you don't have yourself: ${missing[0]}`,
        });
      }
    }

    // Section 17 — refuse a demotion that would leave the company
    // without any Company Admin.
    const existing = await UserCompanyAccess.findOne({ userId: req.params.id, companyId }).lean();
    if (existing?.role === "COMPANY_ADMIN" && existing.status === "ACTIVE" && role !== "COMPANY_ADMIN") {
      const count = await UserCompanyAccess.countDocuments({
        companyId,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      });
      if (count <= 1) {
        return res.status(400).json({
          success: false,
          message: "This company must have at least one Company Admin.",
        });
      }
    }

    // Only a genuinely NEW active membership grows the company's
    // member count — a role/permission change on an already-ACTIVE
    // member doesn't, so it's never quota-checked.
    if (!existing || existing.status !== "ACTIVE") {
      try {
        await assertMemberQuota(companyId);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          return res.status(402).json({ success: false, message: err.message, code: "QUOTA_EXCEEDED", limitKey: err.limitKey });
        }
        throw err;
      }
    }

    const access = await UserCompanyAccess.findOneAndUpdate(
      { userId: req.params.id, companyId },
      { role, permissions, status: "ACTIVE" },
      { upsert: true, new: true }
    );

    await logAction(req, {
      action: "ASSIGN_COMPANY_ACCESS",
      resource: "AdminUser",
      resourceId: req.params.id,
      companyId,
      metadata: { role },
    });

    // Phase 17 fix — `companyId` here must stay payload-only, not a
    // room target: emitDomainEvent broadcasts to `company:<id>` for
    // any event carrying a top-level companyId, which would leak
    // "user X's role changed" to every OTHER admin already watching
    // this company, not just the affected user. This event is
    // account-level and belongs in the user's own private room only.
    emitDomainEvent(EVENTS.ACCESS_UPDATED, {
      userId: req.params.id,
      payload: { companyId, role },
    });

    return res.status(200).json({ success: true, access });
  } catch (error) {
    console.error("Set Company Access Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to assign company access.",
    });
  }
};

export const removeCompanyAccess = async (req, res) => {
  try {
    const { companyId } = req.params;
    const requester = req.adminUser;

    const targetUser = await AdminUser.findById(req.params.id).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (requester.role !== "SUPER_ADMIN") {
      if (targetUser.role === "SUPER_ADMIN") {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to modify a Super Admin's access.",
        });
      }
      const companyRole = await UserCompanyAccess.findOne({
        userId: requester._id,
        companyId,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      }).lean();
      if (!companyRole) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to manage access for this company.",
        });
      }
    }

    const existing = await UserCompanyAccess.findOne({ userId: req.params.id, companyId }).lean();
    if (existing?.role === "COMPANY_ADMIN" && existing.status === "ACTIVE") {
      const count = await UserCompanyAccess.countDocuments({
        companyId,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      });
      if (count <= 1) {
        return res.status(400).json({
          success: false,
          message: "This company must have at least one Company Admin.",
        });
      }
    }

    await UserCompanyAccess.findOneAndDelete({
      userId: req.params.id,
      companyId,
    });

    await logAction(req, {
      action: "REMOVE_COMPANY_ACCESS",
      resource: "AdminUser",
      resourceId: req.params.id,
      companyId,
    });

    // Revoked, not just changed — force a full reconnect rather than
    // just notifying, so a socket that had already joined this
    // company's room (from before the revoke) can't keep sitting in
    // it. The next connection re-runs hasCompanyAccess from scratch,
    // same as every fresh subscribe:company call already does.
    disconnectUserSockets(req.params.id);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Remove Company Access Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove company access.",
    });
  }
};

export const setChatbotAccess = async (req, res) => {
  try {
    const { chatbotId, permissions = [] } = req.body;

    if (!chatbotId) {
      return res
        .status(400)
        .json({ success: false, message: "chatbotId is required." });
    }

    const chatbot = await Chatbot.findById(chatbotId).select("companyId").lean();
    if (!chatbot) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }

    const requester = req.adminUser;
    if (requester.role !== "SUPER_ADMIN") {
      const companyRole = await UserCompanyAccess.findOne({
        userId: requester._id,
        companyId: chatbot.companyId,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      }).lean();
      if (!companyRole) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to manage access for this chatbot.",
        });
      }
    }

    const access = await ChatbotAccess.findOneAndUpdate(
      { userId: req.params.id, chatbotId },
      { permissions },
      { upsert: true, new: true }
    );

    await logAction(req, {
      action: "ASSIGN_CHATBOT_ACCESS",
      resource: "AdminUser",
      resourceId: req.params.id,
      companyId: chatbot.companyId,
      metadata: { chatbotId },
    });

    // Phase 17 — same treatment as setCompanyAccess: a notice only,
    // never the grant itself. DB (ChatbotAccess, just written above)
    // remains the sole source of truth; the affected user's client
    // reacts by resubscribing, which re-runs hasChatbotAccess from
    // scratch on the server — this event never bypasses that check.
    // Phase 17 fix — same reasoning as setCompanyAccess above: keep
    // chatbotId/companyId out of the top-level room-targeting fields
    // so this only reaches the affected user's own room, not every
    // other admin already watching this chatbot/company.
    emitDomainEvent(EVENTS.ACCESS_UPDATED, {
      userId: req.params.id,
      payload: { chatbotId, companyId: chatbot.companyId, granted: true },
    });

    return res.status(200).json({ success: true, access });
  } catch (error) {
    console.error("Set Chatbot Access Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to assign chatbot access.",
    });
  }
};

export const removeChatbotAccess = async (req, res) => {
  try {
    const { chatbotId } = req.params;

    const chatbot = await Chatbot.findById(chatbotId).select("companyId").lean();
    if (!chatbot) {
      return res.status(404).json({ success: false, message: "Chatbot not found." });
    }

    const requester = req.adminUser;
    if (requester.role !== "SUPER_ADMIN") {
      const companyRole = await UserCompanyAccess.findOne({
        userId: requester._id,
        companyId: chatbot.companyId,
        role: "COMPANY_ADMIN",
        status: "ACTIVE",
      }).lean();
      if (!companyRole) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to manage access for this chatbot.",
        });
      }
    }

    await ChatbotAccess.findOneAndDelete({
      userId: req.params.id,
      chatbotId,
    });

    await logAction(req, {
      action: "REMOVE_CHATBOT_ACCESS",
      resource: "AdminUser",
      resourceId: req.params.id,
      companyId: chatbot.companyId,
      metadata: { chatbotId },
    });

    // Phase 17 — closes the gap Phase 16 flagged: this previously had
    // no realtime treatment at all. Same approach as
    // removeCompanyAccess: force a full reconnect rather than trying
    // to surgically remove just this chatbot's room membership, so
    // the very next connection re-runs hasChatbotAccess (which also
    // re-checks company-level access — a user with company-wide
    // access is correctly unaffected by losing only their
    // chatbot-specific grant) from scratch instead of trusting
    // anything cached in the existing socket.
    disconnectUserSockets(req.params.id);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Remove Chatbot Access Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to remove access.",
    });
  }
};

// Phase 36 — "what can this user do?" effective permission matrix,
// plus Phase 15/52/53's inherited-vs-override breakdown. Computes the
// SAME effective set can()/resolveEffectivePermissions would use for
// a real authorization check — this is a read view onto that, not a
// second implementation.
export const getUserEffectivePermissions = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required." });
    }

    const targetUser = await AdminUser.findById(req.params.id).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    if (requester.role !== "SUPER_ADMIN" && String(requester._id) !== String(targetUser._id)) {
      if (!(await canManageUserAsCompanyAdmin(requester, targetUser))) {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
    }

    if (targetUser.role === "SUPER_ADMIN") {
      return res.status(200).json({
        success: true,
        role: "SUPER_ADMIN",
        roleLabel: "Super Admin",
        basePermissions: Object.values(PERMISSIONS),
        overrides: [],
        effectivePermissions: Object.values(PERMISSIONS),
      });
    }

    const access = await UserCompanyAccess.findOne({ userId: targetUser._id, companyId, status: "ACTIVE" }).lean();
    if (!access) {
      return res.status(200).json({
        success: true,
        role: null,
        roleLabel: null,
        basePermissions: [],
        overrides: [],
        effectivePermissions: [],
      });
    }

    const basePermissions = await resolveRolePermissions(access.role, companyId);
    const effectivePermissions = await resolveEffectivePermissions(access.role, companyId, access.permissionOverrides);

    let roleLabel = access.role;
    if (!["COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"].includes(access.role)) {
      const roleDoc = await Role.findById(access.role).select("name").lean();
      roleLabel = roleDoc?.name || "Unknown Role";
    }

    return res.status(200).json({
      success: true,
      role: access.role,
      roleLabel,
      basePermissions,
      overrides: access.permissionOverrides || [],
      effectivePermissions,
    });
  } catch (error) {
    console.error("Get Effective Permissions Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load effective permissions." });
  }
};

// Phase 15/43 — per-user permission overrides on top of their
// (system or custom) role within one company. Atomic replace of the
// whole overrides array (Phase 39/40 — never one checkbox per
// request), anti-escalation checked exactly like role grants above.
export const setUserPermissionOverrides = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { companyId, overrides } = req.body;

    if (!companyId || !Array.isArray(overrides)) {
      return res.status(400).json({ success: false, message: "companyId and overrides[] are required." });
    }

    const validPermissions = new Set(Object.values(PERMISSIONS));
    for (const o of overrides) {
      if (!o || !validPermissions.has(o.permission) || typeof o.granted !== "boolean") {
        return res.status(400).json({ success: false, message: "One or more overrides are invalid." });
      }
    }

    const targetUser = await AdminUser.findById(req.params.id).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    if (targetUser.role === "SUPER_ADMIN") {
      return res.status(400).json({ success: false, message: "Super Admin already has every permission." });
    }

    if (requester.role !== "SUPER_ADMIN") {
      if (!(await canManageUserAsCompanyAdmin(requester, targetUser))) {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
      // Phase 43 — never let a Company Admin grant (via override) a
      // permission they don't themselves effectively have. Denials
      // (granted: false) are always allowed — removing access is
      // never an escalation.
      const requesterAccess = await UserCompanyAccess.findOne({ userId: requester._id, companyId, status: "ACTIVE" }).select("role permissionOverrides").lean();
      const requesterEffective = requesterAccess
        ? await resolveEffectivePermissions(requesterAccess.role, companyId, requesterAccess.permissionOverrides)
        : [];
      const grantedOverrides = overrides.filter((o) => o.granted).map((o) => o.permission);
      const missing = grantedOverrides.filter((p) => !requesterEffective.includes(p));
      if (missing.length > 0) {
        return res.status(403).json({
          success: false,
          message: `You cannot grant a permission you don't have yourself: ${missing[0]}`,
        });
      }
    }

    const access = await UserCompanyAccess.findOneAndUpdate(
      { userId: req.params.id, companyId, status: "ACTIVE" },
      { permissionOverrides: overrides },
      { new: true }
    );
    if (!access) {
      return res.status(404).json({ success: false, message: "This user has no active access to that company." });
    }

    await logAction(req, {
      action: "SET_PERMISSION_OVERRIDES",
      resource: "AdminUser",
      resourceId: req.params.id,
      companyId,
      metadata: { overrides },
    });

    // The user's effective permission set just changed — force a
    // resubscribe so any live socket re-validates against it, same
    // treatment as a company-access revoke.
    disconnectUserSockets(req.params.id);
    emitDomainEvent(EVENTS.ACCESS_UPDATED, { userId: req.params.id, payload: { companyId, overridesUpdated: true } });

    return res.status(200).json({ success: true, access });
  } catch (error) {
    console.error("Set Permission Overrides Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update permission overrides." });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const requester = req.adminUser;
    const user = await AdminUser.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (String(user._id) === String(requester._id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      if (!(await canManageUserAsCompanyAdmin(requester, user))) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    if (user.role === "SUPER_ADMIN" && !(await assertNotLastSuperAdmin(user._id))) {
      return res.status(400).json({
        success: false,
        message: "At least one Super Admin must remain.",
      });
    }

    const blocking = await findSoleCompanyAdminCompanies(user._id);
    if (blocking.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${user.name} is the only Company Admin for ${blocking.join(", ")}. Assign another Company Admin first.`,
      });
    }

    await unassignConversations(user._id);
    await unassignTasks(user._id);

    await Promise.all([
      UserCompanyAccess.deleteMany({ userId: user._id }),
      ChatbotAccess.deleteMany({ userId: user._id }),
      AdminUser.deleteOne({ _id: user._id }),
    ]);

    await logAction(req, {
      action: "DELETE_USER",
      resource: "AdminUser",
      resourceId: user._id,
      metadata: { email: user.email },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete User Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to delete user.",
    });
  }
};

export const resetUserPassword = async (req, res) => {
  try {
    const requester = req.adminUser;
    const user = await AdminUser.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (requester.role !== "SUPER_ADMIN") {
      if (!(await canManageUserAsCompanyAdmin(requester, user))) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to access this resource.",
        });
      }
    }

    // No SMTP/email infrastructure exists yet, so we generate a
    // secure temporary password and return it once — the admin is
    // expected to share it out-of-band. It is never logged or
    // stored anywhere in plaintext.
    const temporaryPassword = crypto.randomBytes(9).toString("base64url");

    await user.setPassword(temporaryPassword);
    await user.save();

    await logAction(req, {
      action: "PASSWORD_RESET",
      resource: "AdminUser",
      resourceId: user._id,
    });

    return res.status(200).json({
      success: true,
      temporaryPassword,
      message:
        "Temporary password generated. Share it securely — it will not be shown again.",
    });
  } catch (error) {
    console.error("Reset User Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to reset password.",
    });
  }
};
