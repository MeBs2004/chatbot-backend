import crypto from "crypto";

import Invitation from "../../models/invitation.model.js";
import AdminUser from "../../models/adminUser.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import Company from "../../models/company.model.js";
import { logAction } from "../../services/admin/audit.service.js";
import { assertMemberQuota, QuotaExceededError } from "../../services/billing/quota.service.js";
import { isValidRoleForCompany } from "../../services/admin/role.service.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COMPANY_ROLES = ["COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"];
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ======================================================
// INVITATIONS (Phase 11, Sections 11-13)
// No SMTP/email infrastructure exists anywhere in this codebase
// (confirmed by audit) — every response below is explicit that
// nothing was emailed. The raw token is returned to the inviting
// admin exactly once, same honest one-time-secret pattern already
// used by user.controller.js's resetUserPassword. Only its SHA-256
// hash is ever persisted, and acceptance is one-time-use (status
// flips to ACCEPTED inside the same request that consumes it).
// ======================================================

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function generateToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  return { rawToken, tokenHash: hashToken(rawToken) };
}

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

export const createInvitation = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { email, name, role, companyAccess = [] } = req.body;

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (!COMPANY_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Invitations can never grant Super Admin.",
      });
    }

    let allowedCompanyIds = null;
    if (requester.role !== "SUPER_ADMIN") {
      allowedCompanyIds = await getCompanyAdminCompanyIds(requester);
      if (allowedCompanyIds.length === 0) {
        return res.status(403).json({ success: false, message: "You don't have permission to invite users." });
      }
    }

    const normalizedCompanyAccess = [];
    for (const entry of Array.isArray(companyAccess) ? companyAccess : []) {
      const companyId = typeof entry === "string" ? entry : entry.companyId;
      if (!companyId) continue;
      if (allowedCompanyIds && !allowedCompanyIds.includes(companyId)) {
        return res.status(403).json({
          success: false,
          message: `You don't have permission to invite users to company "${companyId}".`,
        });
      }
      const companyExists = await Company.exists({ companyId });
      if (!companyExists) {
        return res.status(400).json({ success: false, message: `Company "${companyId}" does not exist.` });
      }
      const entryRole = (typeof entry === "object" && entry.role) || role;
      if (!(await isValidRoleForCompany(entryRole, companyId))) {
        return res.status(400).json({ success: false, message: `Invalid company role "${entryRole}".` });
      }
      normalizedCompanyAccess.push({ companyId, role: entryRole });
    }

    if (allowedCompanyIds && normalizedCompanyAccess.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one company for this invitation." });
    }

    // Checked at invite-creation time, matching Section 25's "before
    // adding/inviting a user" — not re-checked again at accept time,
    // so two pending invitations both accepted in the same instant
    // could in theory land the company one member over quota (same
    // documented, accepted race-condition class as every other
    // quota check in this phase — see quota.service.js).
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

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await AdminUser.findOne({ email: normalizedEmail }).lean();
    if (existingUser) {
      return res.status(409).json({ success: false, message: "A user with this email already exists." });
    }

    const existingInvite = await Invitation.findOne({ email: normalizedEmail, status: "PENDING" }).lean();
    if (existingInvite) {
      return res.status(409).json({
        success: false,
        message: "An invitation is already pending for this email. Resend or revoke it instead.",
      });
    }

    const { rawToken, tokenHash } = generateToken();

    const invitation = await Invitation.create({
      email: normalizedEmail,
      name: (name || "").trim(),
      role,
      companyAccess: normalizedCompanyAccess,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: requester._id,
    });

    await logAction(req, {
      action: "INVITATION_CREATED",
      resource: "Invitation",
      resourceId: invitation._id,
      metadata: { email: normalizedEmail, role },
    });

    return res.status(201).json({
      success: true,
      invitation: { ...invitation.toObject(), tokenHash: undefined },
      // The backend doesn't know the admin-panel's public origin —
      // the frontend builds the shareable link from its own
      // window.location.origin + this token.
      rawToken,
      emailSent: false,
      message: "Email delivery is not configured on this platform. Share this link with the invitee directly.",
    });
  } catch (error) {
    console.error("Create Invitation Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create invitation." });
  }
};

export const listInvitations = async (req, res) => {
  try {
    const requester = req.adminUser;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const filter = {};
    if (requester.role !== "SUPER_ADMIN") {
      const allowedCompanyIds = await getCompanyAdminCompanyIds(requester);
      filter["companyAccess.companyId"] = { $in: allowedCompanyIds };
    }

    const now = new Date();
    // Lazily flip anything past its expiry rather than running a
    // background job for a field that's only ever read here.
    await Invitation.updateMany(
      { status: "PENDING", expiresAt: { $lt: now } },
      { status: "EXPIRED" }
    );

    const [invitations, total] = await Promise.all([
      Invitation.find(filter)
        .select("-tokenHash")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Invitation.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      invitations,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (error) {
    console.error("List Invitations Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load invitations." });
  }
};

async function loadAuthorizedInvitation(req, res) {
  const invitation = await Invitation.findById(req.params.id);
  if (!invitation) {
    res.status(404).json({ success: false, message: "Invitation not found." });
    return null;
  }
  const requester = req.adminUser;
  if (requester.role !== "SUPER_ADMIN") {
    const allowedCompanyIds = await getCompanyAdminCompanyIds(requester);
    const overlap = invitation.companyAccess.some((a) => allowedCompanyIds.includes(a.companyId));
    if (!overlap) {
      res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      return null;
    }
  }
  return invitation;
}

export const revokeInvitation = async (req, res) => {
  try {
    const invitation = await loadAuthorizedInvitation(req, res);
    if (!invitation) return;

    if (invitation.status !== "PENDING") {
      return res.status(400).json({ success: false, message: `Cannot revoke a ${invitation.status.toLowerCase()} invitation.` });
    }

    invitation.status = "REVOKED";
    invitation.revokedAt = new Date();
    await invitation.save();

    await logAction(req, {
      action: "INVITATION_REVOKED",
      resource: "Invitation",
      resourceId: invitation._id,
      metadata: { email: invitation.email },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Revoke Invitation Error:", error);
    return res.status(500).json({ success: false, message: "Failed to revoke invitation." });
  }
};

export const resendInvitation = async (req, res) => {
  try {
    const invitation = await loadAuthorizedInvitation(req, res);
    if (!invitation) return;

    if (!["PENDING", "EXPIRED"].includes(invitation.status)) {
      return res.status(400).json({ success: false, message: `Cannot resend a ${invitation.status.toLowerCase()} invitation.` });
    }

    // "Resend" rotates the token and expiry — the old link stops
    // working. There is still no email provider, so this is really
    // "generate a fresh link", labeled honestly on the frontend.
    const { rawToken, tokenHash } = generateToken();
    invitation.tokenHash = tokenHash;
    invitation.status = "PENDING";
    invitation.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await invitation.save();

    await logAction(req, {
      action: "INVITATION_RESENT",
      resource: "Invitation",
      resourceId: invitation._id,
      metadata: { email: invitation.email },
    });

    return res.status(200).json({
      success: true,
      rawToken,
      emailSent: false,
      message: "Email delivery is not configured on this platform. Share this link with the invitee directly.",
    });
  } catch (error) {
    console.error("Resend Invitation Error:", error);
    return res.status(500).json({ success: false, message: "Failed to resend invitation." });
  }
};

// ------------------------------------------------------
// Public endpoints (no adminAuthMiddleware) — token IS the auth.
// ------------------------------------------------------

async function findPendingInvitationByToken(rawToken) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const tokenHash = hashToken(rawToken);
  const invitation = await Invitation.findOne({ tokenHash });
  if (!invitation) return null;

  if (invitation.status === "PENDING" && invitation.expiresAt < new Date()) {
    invitation.status = "EXPIRED";
    await invitation.save();
  }
  return invitation;
}

export const getInvitationByToken = async (req, res) => {
  try {
    const invitation = await findPendingInvitationByToken(req.params.token);
    if (!invitation || invitation.status !== "PENDING") {
      return res.status(404).json({ success: false, message: "This invitation link is invalid or has expired." });
    }

    const companies = await Company.find({
      companyId: { $in: invitation.companyAccess.map((a) => a.companyId) },
    })
      .select("companyId name")
      .lean();
    const companyNameById = Object.fromEntries(companies.map((c) => [c.companyId, c.name]));

    return res.status(200).json({
      success: true,
      invitation: {
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        companyAccess: invitation.companyAccess.map((a) => ({
          companyId: a.companyId,
          role: a.role,
          companyName: companyNameById[a.companyId] || a.companyId,
        })),
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    console.error("Get Invitation Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load invitation." });
  }
};

export const acceptInvitation = async (req, res) => {
  try {
    const invitation = await findPendingInvitationByToken(req.params.token);
    if (!invitation || invitation.status !== "PENDING") {
      return res.status(404).json({ success: false, message: "This invitation link is invalid or has expired." });
    }

    const { name, password } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Name is required." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }

    const existingUser = await AdminUser.findOne({ email: invitation.email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: "A user with this email already exists." });
    }

    const user = new AdminUser({
      name: name.trim(),
      email: invitation.email,
      role: invitation.role,
    });
    await user.setPassword(password);
    await user.save();

    for (const entry of invitation.companyAccess) {
      await UserCompanyAccess.create({ userId: user._id, companyId: entry.companyId, role: entry.role });
    }

    invitation.status = "ACCEPTED";
    invitation.acceptedAt = new Date();
    invitation.acceptedUserId = user._id;
    await invitation.save();

    // Public route — there is no req.adminUser from auth middleware
    // here. Attribute the log entry to the account that just
    // self-registered (same pattern auth.controller.js's login
    // handler uses for its own LOGIN entry).
    req.adminUser = user;
    await logAction(req, {
      action: "INVITATION_ACCEPTED",
      resource: "Invitation",
      resourceId: invitation._id,
      metadata: { email: invitation.email, userId: user._id },
    });

    return res.status(201).json({
      success: true,
      message: "Account created. You can now log in.",
    });
  } catch (error) {
    console.error("Accept Invitation Error:", error);
    return res.status(500).json({ success: false, message: "Failed to accept invitation." });
  }
};
