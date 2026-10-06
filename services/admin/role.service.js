import Role from "../../models/role.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import {
  PERMISSIONS,
  isSystemRole,
  resolveEffectivePermissions,
} from "./permissions.service.js";
import { getCompanyRole } from "./access.service.js";
import { logAction } from "./audit.service.js";
import { disconnectUserSockets, emitDomainEvent } from "../realtime/io.js";
import { EVENTS } from "../realtime/events.js";

const ALL_PERMISSIONS = new Set(Object.values(PERMISSIONS));

export class RoleError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isValidPermissionList(permissions) {
  return Array.isArray(permissions) && permissions.every((p) => ALL_PERMISSIONS.has(p));
}

/**
 * True if roleValue (a system key or a custom Role _id string) is a
 * real, assignable role for this company right now.
 */
export async function isValidRoleForCompany(roleValue, companyId) {
  if (isSystemRole(roleValue)) return true;
  if (!roleValue) return false;
  const role = await Role.findOne({ _id: roleValue, companyId, status: "ACTIVE" }).lean();
  return !!role;
}

/**
 * Requires that `requester` is either SUPER_ADMIN or an ACTIVE
 * COMPANY_ADMIN of `companyId` — the same authority level every
 * existing team-management mutation (setCompanyAccess, setChatbotAccess)
 * already requires. Throws RoleError(403) otherwise.
 */
async function assertCompanyAdminAuthority(requester, companyId) {
  if (requester.role === "SUPER_ADMIN") return;
  const companyRole = await getCompanyRole(requester, companyId);
  if (companyRole !== "COMPANY_ADMIN") {
    throw new RoleError("You don't have permission to manage roles for this company.", 403);
  }
}

/**
 * Phase 43 — a requester can never grant a permission they don't
 * themselves effectively have in this company. SUPER_ADMIN bypasses
 * (has everything). Throws RoleError(403) naming the first offending
 * permission if the check fails.
 */
async function assertGrantable(requester, companyId, permissions) {
  if (requester.role === "SUPER_ADMIN") return;
  const requesterRole = await getCompanyRole(requester, companyId);
  const requesterAccess = await UserCompanyAccess.findOne({
    userId: requester._id,
    companyId,
    status: "ACTIVE",
  })
    .select("permissionOverrides")
    .lean();
  const requesterEffective = await resolveEffectivePermissions(
    requesterRole,
    companyId,
    requesterAccess?.permissionOverrides
  );
  const missing = permissions.filter((p) => !requesterEffective.includes(p));
  if (missing.length > 0) {
    throw new RoleError(
      `You cannot grant a permission you don't have yourself: ${missing[0]}`,
      403,
      "PRIVILEGE_ESCALATION"
    );
  }
}

export async function listRoles(requester, companyId) {
  await assertCompanyAdminAuthority(requester, companyId);
  return Role.find({ companyId }).sort({ name: 1 }).lean();
}

export async function getRole(requester, roleId) {
  const role = await Role.findById(roleId).lean();
  if (!role) throw new RoleError("Role not found.", 404);
  await assertCompanyAdminAuthority(requester, role.companyId);
  return role;
}

export async function createRole(req, { companyId, name, description, permissions }) {
  const requester = req.adminUser;
  if (!companyId) throw new RoleError("companyId is required.");
  if (!name || !name.trim()) throw new RoleError("Role name is required.");
  if (!isValidPermissionList(permissions)) {
    throw new RoleError("One or more permissions are invalid.");
  }

  await assertCompanyAdminAuthority(requester, companyId);
  await assertGrantable(requester, companyId, permissions);

  const existing = await Role.findOne({ companyId, name: name.trim() }).lean();
  if (existing) throw new RoleError("A role with this name already exists.", 409);

  const role = await Role.create({
    companyId,
    name: name.trim(),
    description: (description || "").trim(),
    permissions,
    createdBy: requester._id,
  });

  await logAction(req, {
    action: "CREATE_ROLE",
    resource: "Role",
    resourceId: role._id,
    companyId,
    metadata: { name: role.name, permissions },
  });

  return role;
}

export async function updateRole(req, roleId, { name, description, permissions }) {
  const requester = req.adminUser;
  const role = await Role.findById(roleId);
  if (!role) throw new RoleError("Role not found.", 404);

  await assertCompanyAdminAuthority(requester, role.companyId);

  if (permissions !== undefined) {
    if (!isValidPermissionList(permissions)) {
      throw new RoleError("One or more permissions are invalid.");
    }
    // Only check escalation for permissions being newly added, not
    // ones the role already had (which the requester may have lost
    // in the meantime, e.g. via their own override) — avoids locking
    // an admin out of editing a role's unrelated fields.
    const added = permissions.filter((p) => !role.permissions.includes(p));
    await assertGrantable(requester, role.companyId, added);
    role.permissions = permissions;
  }
  if (name !== undefined) {
    if (!name.trim()) throw new RoleError("Role name is required.");
    role.name = name.trim();
  }
  if (description !== undefined) role.description = description.trim();

  await role.save();

  await logAction(req, {
    action: "UPDATE_ROLE",
    resource: "Role",
    resourceId: role._id,
    companyId: role.companyId,
    metadata: { name: role.name },
  });

  // This role's permission set just changed — every user holding it
  // needs their live sockets to re-validate on next subscribe rather
  // than keep broadcasting under the stale permission set (closes the
  // gap the architecture audit flagged: role changes were previously
  // soft-notice-only).
  const holders = await UserCompanyAccess.find({ companyId: role.companyId, role: String(role._id) })
    .select("userId")
    .lean();
  for (const h of holders) {
    emitDomainEvent(EVENTS.ACCESS_UPDATED, { userId: h.userId, payload: { companyId: role.companyId, roleUpdated: true } });
    disconnectUserSockets(h.userId);
  }

  return role;
}

export async function deleteRole(req, roleId, { replacementRole } = {}) {
  const requester = req.adminUser;
  const role = await Role.findById(roleId);
  if (!role) throw new RoleError("Role not found.", 404);

  await assertCompanyAdminAuthority(requester, role.companyId);

  const holders = await UserCompanyAccess.find({ companyId: role.companyId, role: String(role._id) });

  if (holders.length > 0) {
    if (!replacementRole) {
      // Phase 27 — don't silently delete; tell the caller exactly how
      // many users are affected so the UI can ask for a replacement.
      throw new RoleError(
        `This role is assigned to ${holders.length} user(s). Choose a replacement role.`,
        409,
        "ROLE_IN_USE"
      );
    }
    if (!(await isValidRoleForCompany(replacementRole, role.companyId))) {
      throw new RoleError("Replacement role is not valid for this company.");
    }
    for (const holder of holders) {
      holder.role = replacementRole;
      await holder.save();
      emitDomainEvent(EVENTS.ACCESS_UPDATED, { userId: holder.userId, payload: { companyId: role.companyId, role: replacementRole } });
      disconnectUserSockets(holder.userId);
    }
  }

  await Role.deleteOne({ _id: role._id });

  await logAction(req, {
    action: "DELETE_ROLE",
    resource: "Role",
    resourceId: role._id,
    companyId: role.companyId,
    metadata: { name: role.name, migratedUserCount: holders.length, replacementRole: replacementRole || null },
  });

  return { migratedUserCount: holders.length };
}

export { assertCompanyAdminAuthority, assertGrantable };
