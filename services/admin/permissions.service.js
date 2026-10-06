import { hasChatbotAccess } from "./access.service.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import Role from "../../models/role.model.js";

// ======================================================
// PERMISSIONS (Phase 11)
// Centralized permission model, layered on top of the existing
// access.service.js (getCompanyRole/hasChatbotAccess) — this does
// NOT replace that service, it documents and formalizes the
// role->permission mapping that was previously scattered as ad hoc
// `if (role !== "SUPER_ADMIN") { ... if (role !== "COMPANY_ADMIN") }`
// checks across chatbot/knowledge/aiSettings/channel/company
// controllers (those existing, already-tested checks are left in
// place — this module is additive, used by new Phase 11 code and
// by the frontend's read-only Roles & Permissions page, not a
// forced rewrite of working authorization).
//
// This matrix is intentionally faithful to what the codebase
// ALREADY enforces wherever that enforcement predates Phase 11 (all
// "*.read" permissions, conversations.reply/takeover/close,
// chatbots.create/manage, knowledge.manage, integrations.manage,
// audit.read for SUPER_ADMIN) rather than inventing new
// restrictions — see PHASE_11_REPORT for the short list of
// deliberate, spec-driven extensions (COMPANY_ADMIN self-service
// team management, DEVELOPER integrations.manage, COMPANY_ADMIN
// company-scoped audit.read).
// ======================================================

export const PERMISSIONS = Object.freeze({
  COMPANIES_READ: "companies.read",
  COMPANIES_MANAGE: "companies.manage",
  USERS_READ: "users.read",
  USERS_MANAGE: "users.manage",
  CHATBOTS_READ: "chatbots.read",
  CHATBOTS_CREATE: "chatbots.create",
  CHATBOTS_MANAGE: "chatbots.manage",
  CHATBOT_ACCESS_MANAGE: "chatbot.access.manage",
  CONVERSATIONS_READ: "conversations.read",
  CONVERSATIONS_REPLY: "conversations.reply",
  CONVERSATIONS_TAKEOVER: "conversations.takeover",
  CONVERSATIONS_ASSIGN: "conversations.assign",
  CONVERSATIONS_CLOSE: "conversations.close",
  VISITORS_READ: "visitors.read",
  ANALYTICS_READ: "analytics.read",
  KNOWLEDGE_READ: "knowledge.read",
  KNOWLEDGE_MANAGE: "knowledge.manage",
  INTEGRATIONS_READ: "integrations.read",
  INTEGRATIONS_MANAGE: "integrations.manage",
  INSTALLATION_READ: "installation.read",
  INSTALLATION_MANAGE: "installation.manage",
  AUDIT_READ: "audit.read",
  DEVELOPER_MANAGE: "developer.manage",

  // Phase 12 — Developer Platform. Finer-grained than the Phase 11
  // placeholder DEVELOPER_MANAGE above (kept, unused by new code, for
  // backward compatibility with anything already referencing it).
  DEVELOPER_VIEW: "developer.view",
  DEVELOPER_KEYS_VIEW: "developer.keys.view",
  DEVELOPER_KEYS_CREATE: "developer.keys.create",
  DEVELOPER_KEYS_REVOKE: "developer.keys.revoke",
  DEVELOPER_KEYS_ROTATE: "developer.keys.rotate",
  DEVELOPER_WEBHOOKS_VIEW: "developer.webhooks.view",
  DEVELOPER_WEBHOOKS_CREATE: "developer.webhooks.create",
  DEVELOPER_WEBHOOKS_UPDATE: "developer.webhooks.update",
  DEVELOPER_WEBHOOKS_DELETE: "developer.webhooks.delete",
  DEVELOPER_DOCS_VIEW: "developer.docs.view",
  DEVELOPER_USAGE_VIEW: "developer.usage.view",
  DEVELOPER_SETTINGS_MANAGE: "developer.settings.manage",

  // Phase 13 — Billing + Usage.
  BILLING_VIEW: "billing.view",
  BILLING_MANAGE: "billing.manage",
  BILLING_CHANGE_PLAN: "billing.change_plan",
  BILLING_CANCEL: "billing.cancel",
  BILLING_INVOICES_VIEW: "billing.invoices.view",
  USAGE_VIEW: "usage.view",
  USAGE_EXPORT: "usage.export",

  // Enterprise RBAC phase — custom roles, per-user permission
  // overrides, and task assignment.
  ROLES_VIEW: "roles.view",
  ROLES_CREATE: "roles.create",
  ROLES_EDIT: "roles.edit",
  ROLES_DELETE: "roles.delete",
  ROLES_ASSIGN: "roles.assign",
  USERS_INVITE: "users.invite",
  USERS_SUSPEND: "users.suspend",
  USERS_ASSIGN_ROLE: "users.assignRole",
  USERS_MANAGE_PERMISSIONS: "users.managePermissions",
  TASKS_VIEW: "tasks.view",
  TASKS_CREATE: "tasks.create",
  TASKS_EDIT: "tasks.edit",
  TASKS_DELETE: "tasks.delete",
  TASKS_ASSIGN: "tasks.assign",
  TASKS_COMPLETE: "tasks.complete",
});

// The 4 company-scoped role keys that are fixed code constants, never
// Role documents. SUPER_ADMIN is a 5th, platform-level role (handled
// as a universal bypass everywhere) and is also never a Role document.
export const SYSTEM_ROLES = ["COMPANY_ADMIN", "AGENT", "VIEWER", "DEVELOPER"];

export function isSystemRole(roleValue) {
  return SYSTEM_ROLES.includes(roleValue);
}

const ALL = Object.values(PERMISSIONS);

const READ_ONLY = [
  PERMISSIONS.COMPANIES_READ,
  PERMISSIONS.CHATBOTS_READ,
  PERMISSIONS.CONVERSATIONS_READ,
  PERMISSIONS.VISITORS_READ,
  PERMISSIONS.ANALYTICS_READ,
  PERMISSIONS.KNOWLEDGE_READ,
  PERMISSIONS.INTEGRATIONS_READ,
  PERMISSIONS.INSTALLATION_READ,
];

// Phase 12 — granted identically to COMPANY_ADMIN and DEVELOPER
// (Section 3: "Company Admin: developer access within companies they
// administer" / "Developer: developer functionality for companies/
// chatbots they are authorized to access"). Never granted to AGENT
// or VIEWER — the prompt explicitly says not to unless the model
// already grants a read-only developer permission, and it doesn't.
const DEVELOPER_PLATFORM_PERMISSIONS = [
  PERMISSIONS.DEVELOPER_VIEW,
  PERMISSIONS.DEVELOPER_KEYS_VIEW,
  PERMISSIONS.DEVELOPER_KEYS_CREATE,
  PERMISSIONS.DEVELOPER_KEYS_REVOKE,
  PERMISSIONS.DEVELOPER_KEYS_ROTATE,
  PERMISSIONS.DEVELOPER_WEBHOOKS_VIEW,
  PERMISSIONS.DEVELOPER_WEBHOOKS_CREATE,
  PERMISSIONS.DEVELOPER_WEBHOOKS_UPDATE,
  PERMISSIONS.DEVELOPER_WEBHOOKS_DELETE,
  PERMISSIONS.DEVELOPER_DOCS_VIEW,
  PERMISSIONS.DEVELOPER_USAGE_VIEW,
  PERMISSIONS.DEVELOPER_SETTINGS_MANAGE,
];

// Phase 13 — billing.* is COMPANY_ADMIN-only (plus SUPER_ADMIN's
// universal bypass): Section 7 explicitly says not to give billing
// permissions to DEVELOPER merely because they have developer
// access, and VIEWER/AGENT get nothing here either ("only view if
// EXPLICITLY permitted" — nothing in this codebase does). usage.view
// is the one exception DEVELOPER also gets, matching Section 7's
// "Developer: usage visibility only if appropriate" — a developer
// building against the API plausibly needs to see their own
// consumption, never billing/plan/invoice management.
const BILLING_PERMISSIONS = [
  PERMISSIONS.BILLING_VIEW,
  PERMISSIONS.BILLING_MANAGE,
  PERMISSIONS.BILLING_CHANGE_PLAN,
  PERMISSIONS.BILLING_CANCEL,
  PERMISSIONS.BILLING_INVOICES_VIEW,
  PERMISSIONS.USAGE_VIEW,
  PERMISSIONS.USAGE_EXPORT,
];

// Company-scoped role -> permission set. SUPER_ADMIN is handled as a
// universal bypass in `can()` below (same convention as the existing
// requireRole middleware), not listed here.
// Enterprise RBAC phase — COMPANY_ADMIN already performs every one of
// these actions today via dedicated, independently-authorized
// controller logic (user.controller.js, role.controller.js); this
// just names them so they're expressible as grantable/revocable
// permissions (e.g. for a custom role or a per-user override), not a
// new capability.
const TEAM_MANAGEMENT_PERMISSIONS = [
  PERMISSIONS.ROLES_VIEW,
  PERMISSIONS.ROLES_CREATE,
  PERMISSIONS.ROLES_EDIT,
  PERMISSIONS.ROLES_DELETE,
  PERMISSIONS.ROLES_ASSIGN,
  PERMISSIONS.USERS_INVITE,
  PERMISSIONS.USERS_SUSPEND,
  PERMISSIONS.USERS_ASSIGN_ROLE,
  PERMISSIONS.USERS_MANAGE_PERMISSIONS,
];

const TASK_MANAGEMENT_PERMISSIONS = [
  PERMISSIONS.TASKS_VIEW,
  PERMISSIONS.TASKS_CREATE,
  PERMISSIONS.TASKS_EDIT,
  PERMISSIONS.TASKS_DELETE,
  PERMISSIONS.TASKS_ASSIGN,
  PERMISSIONS.TASKS_COMPLETE,
];

// A user who isn't a company's team manager can still see tasks
// assigned to them and mark them done — never create/edit/delete/
// reassign (spec Phase 24's explicit VIEWER example).
const TASK_SELF_SERVICE_PERMISSIONS = [PERMISSIONS.TASKS_VIEW, PERMISSIONS.TASKS_COMPLETE];

export const ROLE_PERMISSIONS = Object.freeze({
  COMPANY_ADMIN: [
    ...READ_ONLY,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.CHATBOTS_CREATE,
    PERMISSIONS.CHATBOTS_MANAGE,
    PERMISSIONS.CHATBOT_ACCESS_MANAGE,
    PERMISSIONS.CONVERSATIONS_REPLY,
    PERMISSIONS.CONVERSATIONS_TAKEOVER,
    PERMISSIONS.CONVERSATIONS_ASSIGN,
    PERMISSIONS.CONVERSATIONS_CLOSE,
    PERMISSIONS.KNOWLEDGE_MANAGE,
    PERMISSIONS.INTEGRATIONS_MANAGE,
    PERMISSIONS.INSTALLATION_MANAGE,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.DEVELOPER_MANAGE,
    ...DEVELOPER_PLATFORM_PERMISSIONS,
    ...BILLING_PERMISSIONS,
    ...TEAM_MANAGEMENT_PERMISSIONS,
    ...TASK_MANAGEMENT_PERMISSIONS,
  ],
  AGENT: [
    ...READ_ONLY,
    PERMISSIONS.CONVERSATIONS_REPLY,
    PERMISSIONS.CONVERSATIONS_TAKEOVER,
    PERMISSIONS.CONVERSATIONS_CLOSE,
    ...TASK_SELF_SERVICE_PERMISSIONS,
  ],
  VIEWER: [...READ_ONLY, ...TASK_SELF_SERVICE_PERMISSIONS],
  DEVELOPER: [
    ...READ_ONLY,
    PERMISSIONS.INTEGRATIONS_MANAGE,
    PERMISSIONS.DEVELOPER_MANAGE,
    ...DEVELOPER_PLATFORM_PERMISSIONS,
    PERMISSIONS.USAGE_VIEW,
    ...TASK_SELF_SERVICE_PERMISSIONS,
  ],
});

/**
 * Static permission list for a company-scoped role string (or
 * "SUPER_ADMIN"). Used by the read-only Roles & Permissions page and
 * by `can()` below. Pure function, no DB access.
 */
export function getPermissionsForRole(companyRole) {
  if (companyRole === "SUPER_ADMIN") return [...ALL];
  return [...(ROLE_PERMISSIONS[companyRole] || [])];
}

/**
 * Layers per-user overrides on top of a base permission set: `granted:
 * true` adds a permission the role doesn't already have, `granted:
 * false` removes one it does. Pure function — the override array is
 * whatever's already on the UserCompanyAccess row.
 */
export function applyPermissionOverrides(basePermissions, overrides = []) {
  const set = new Set(basePermissions);
  for (const o of overrides) {
    if (!o || !o.permission) continue;
    if (o.granted) set.add(o.permission);
    else set.delete(o.permission);
  }
  return [...set];
}

/**
 * The full permission set for a company-scoped role VALUE, which is
 * either one of the 4 system role keys or a custom Role's _id (as a
 * string) — see role.service.js. Unlike getPermissionsForRole (sync,
 * system-roles-only), this is async because a custom role requires a
 * DB lookup, and company-scoped (a custom role only ever applies
 * within the company it was created for).
 */
export async function resolveRolePermissions(roleValue, companyId) {
  if (roleValue === "SUPER_ADMIN") return [...ALL];
  if (isSystemRole(roleValue)) return getPermissionsForRole(roleValue);
  if (!roleValue) return [];

  const role = await Role.findOne({ _id: roleValue, companyId, status: "ACTIVE" }).lean();
  return role ? [...role.permissions] : [];
}

/**
 * The complete, effective permission set for roleValue + overrides
 * within one company — the single function every real authorization
 * check (can(), getMyPermissions, the user-detail "effective
 * permissions" view) should resolve through.
 */
export async function resolveEffectivePermissions(roleValue, companyId, overrides = []) {
  const base = await resolveRolePermissions(roleValue, companyId);
  return applyPermissionOverrides(base, overrides);
}

/**
 * can(user, permission, { companyId, chatbotId }) -> boolean
 *
 * The central authorization check for Phase 11+ code. Considers:
 *   1. authenticated identity (the passed-in adminUser)
 *   2. platform role (SUPER_ADMIN bypasses everything)
 *   3. company access (via the existing getCompanyRole)
 *   4. chatbot access (via the existing hasChatbotAccess, only
 *      when chatbotId is provided and the permission is chatbot-
 *      scoped — company-level access already implies access to
 *      every chatbot in that company, matching hasChatbotAccess's
 *      existing, unchanged semantics)
 *   5. resource ownership — left to the caller (e.g. "is this
 *      conversation assigned to me") since that varies per resource
 *      and already has dedicated, tested logic in
 *      conversation.service.js
 *   6. the permission itself, via ROLE_PERMISSIONS
 *
 * This wraps, and never duplicates, access.service.js — callers
 * that already have a companyRole in hand (e.g. conversation.
 * controller.js's getConversationPermissions) are not required to
 * switch to this; it exists for new call sites and for the
 * frontend-facing GET /auth/permissions endpoint.
 */
export async function can(user, permission, { companyId, chatbotId } = {}) {
  if (!user) return false;
  if (user.role === "SUPER_ADMIN") return true;
  if (!ALL.includes(permission)) return false;
  if (!companyId) return false;

  const access = await UserCompanyAccess.findOne({
    userId: user._id,
    companyId,
    status: "ACTIVE",
  })
    .select("role permissionOverrides")
    .lean();
  if (!access) return false;

  const effective = await resolveEffectivePermissions(access.role, companyId, access.permissionOverrides);
  if (!effective.includes(permission)) return false;

  if (chatbotId && !(await hasChatbotAccess(user, chatbotId))) return false;

  return true;
}

/**
 * Every companyId this user holds `permission` in — null means
 * unrestricted (SUPER_ADMIN). Used for list endpoints that aren't
 * scoped to one company up front (e.g. "all my API keys across every
 * company I administer"), the same shape as access.service.js's
 * getAccessibleCompanyIds but filtered to a specific permission
 * rather than "any access at all".
 */
export async function getPermittedCompanyIds(user, permission) {
  if (user.role === "SUPER_ADMIN") return null;
  const rows = await UserCompanyAccess.find({ userId: user._id, status: "ACTIVE" })
    .select("companyId role permissionOverrides")
    .lean();
  const permitted = [];
  for (const r of rows) {
    const effective = await resolveEffectivePermissions(r.role, r.companyId, r.permissionOverrides);
    if (effective.includes(permission)) permitted.push(r.companyId);
  }
  return permitted;
}
