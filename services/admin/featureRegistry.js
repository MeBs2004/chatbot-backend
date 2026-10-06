import { PERMISSIONS } from "./permissions.service.js";

// ======================================================
// FEATURE REGISTRY
// The canonical tree of modules/features used by the role editor's
// permission checklist UI (and, going forward, should replace
// Sidebar.jsx's hand-maintained NAV_GROUPS as the single source of
// truth — the architecture audit flagged the existing permissions.js
// frontend/backend duplication as a maintenance hazard; this registry
// is served over GET /admin/features specifically so the frontend
// doesn't need its own hand-copied feature tree too).
//
// Each leaf has a `permission` (the base/"view" permission that
// gates seeing it at all) and optionally `actions` (finer-grained
// permissions nested under it, e.g. create/edit/delete). A role's
// `permissions` array is just a flat list of permission strings —
// this tree is purely a presentation/grouping layer on top of that
// flat list, not a second storage format.
// ======================================================

export const FEATURE_REGISTRY = [
  {
    category: "Workspace",
    items: [
      { id: "live-view", label: "Live View", permission: PERMISSIONS.VISITORS_READ },
      {
        id: "conversations",
        label: "Conversations",
        permission: PERMISSIONS.CONVERSATIONS_READ,
        actions: [
          { id: "conversations.reply", label: "Reply", permission: PERMISSIONS.CONVERSATIONS_REPLY },
          { id: "conversations.takeover", label: "Take Over", permission: PERMISSIONS.CONVERSATIONS_TAKEOVER },
          { id: "conversations.assign", label: "Assign", permission: PERMISSIONS.CONVERSATIONS_ASSIGN },
          { id: "conversations.close", label: "Close", permission: PERMISSIONS.CONVERSATIONS_CLOSE },
        ],
      },
      { id: "visitors", label: "Visitors", permission: PERMISSIONS.VISITORS_READ },
    ],
  },
  {
    category: "Chatbots",
    items: [
      {
        id: "chatbots",
        label: "Chatbots",
        permission: PERMISSIONS.CHATBOTS_READ,
        actions: [
          { id: "chatbots.create", label: "Create", permission: PERMISSIONS.CHATBOTS_CREATE },
          { id: "chatbots.manage", label: "Edit / Manage", permission: PERMISSIONS.CHATBOTS_MANAGE },
        ],
      },
      {
        id: "knowledge",
        label: "Knowledge Base",
        permission: PERMISSIONS.KNOWLEDGE_READ,
        actions: [{ id: "knowledge.manage", label: "Create / Edit / Delete", permission: PERMISSIONS.KNOWLEDGE_MANAGE }],
      },
      { id: "chatbot-access", label: "Chatbot Access", permission: PERMISSIONS.CHATBOT_ACCESS_MANAGE },
      {
        id: "installation",
        label: "Installation",
        permission: PERMISSIONS.INSTALLATION_READ,
        actions: [{ id: "installation.manage", label: "Manage", permission: PERMISSIONS.INSTALLATION_MANAGE }],
      },
    ],
  },
  {
    category: "Analytics",
    items: [{ id: "analytics", label: "Analytics", permission: PERMISSIONS.ANALYTICS_READ }],
  },
  {
    category: "Integrations",
    items: [
      {
        id: "integrations",
        label: "Integrations",
        permission: PERMISSIONS.INTEGRATIONS_READ,
        actions: [{ id: "integrations.manage", label: "Manage", permission: PERMISSIONS.INTEGRATIONS_MANAGE }],
      },
    ],
  },
  {
    category: "Team",
    items: [
      {
        id: "users",
        label: "Users",
        permission: PERMISSIONS.USERS_READ,
        actions: [
          { id: "users.manage", label: "Edit / Delete", permission: PERMISSIONS.USERS_MANAGE },
          { id: "users.invite", label: "Invite", permission: PERMISSIONS.USERS_INVITE },
          { id: "users.suspend", label: "Suspend / Activate", permission: PERMISSIONS.USERS_SUSPEND },
          { id: "users.assignRole", label: "Assign Role", permission: PERMISSIONS.USERS_ASSIGN_ROLE },
          { id: "users.managePermissions", label: "Manage Permission Overrides", permission: PERMISSIONS.USERS_MANAGE_PERMISSIONS },
        ],
      },
      {
        id: "roles",
        label: "Roles & Permissions",
        permission: PERMISSIONS.ROLES_VIEW,
        actions: [
          { id: "roles.create", label: "Create", permission: PERMISSIONS.ROLES_CREATE },
          { id: "roles.edit", label: "Edit", permission: PERMISSIONS.ROLES_EDIT },
          { id: "roles.delete", label: "Delete", permission: PERMISSIONS.ROLES_DELETE },
          { id: "roles.assign", label: "Assign to Users", permission: PERMISSIONS.ROLES_ASSIGN },
        ],
      },
      {
        id: "tasks",
        label: "Tasks",
        permission: PERMISSIONS.TASKS_VIEW,
        actions: [
          { id: "tasks.create", label: "Create", permission: PERMISSIONS.TASKS_CREATE },
          { id: "tasks.edit", label: "Edit", permission: PERMISSIONS.TASKS_EDIT },
          { id: "tasks.delete", label: "Delete", permission: PERMISSIONS.TASKS_DELETE },
          { id: "tasks.assign", label: "Assign", permission: PERMISSIONS.TASKS_ASSIGN },
          { id: "tasks.complete", label: "Complete", permission: PERMISSIONS.TASKS_COMPLETE },
        ],
      },
    ],
  },
  {
    category: "Developer",
    items: [
      {
        id: "developer",
        label: "Developer Platform",
        permission: PERMISSIONS.DEVELOPER_VIEW,
        actions: [
          { id: "developer.keys.view", label: "API Keys — View", permission: PERMISSIONS.DEVELOPER_KEYS_VIEW },
          { id: "developer.keys.create", label: "API Keys — Create", permission: PERMISSIONS.DEVELOPER_KEYS_CREATE },
          { id: "developer.keys.revoke", label: "API Keys — Revoke", permission: PERMISSIONS.DEVELOPER_KEYS_REVOKE },
          { id: "developer.webhooks.view", label: "Webhooks — View", permission: PERMISSIONS.DEVELOPER_WEBHOOKS_VIEW },
          { id: "developer.webhooks.create", label: "Webhooks — Create / Edit / Delete", permission: PERMISSIONS.DEVELOPER_WEBHOOKS_CREATE },
          { id: "developer.usage.view", label: "Usage", permission: PERMISSIONS.DEVELOPER_USAGE_VIEW },
          { id: "developer.settings.manage", label: "Developer Settings", permission: PERMISSIONS.DEVELOPER_SETTINGS_MANAGE },
        ],
      },
    ],
  },
  {
    category: "Billing",
    items: [
      {
        id: "billing",
        label: "Billing",
        permission: PERMISSIONS.BILLING_VIEW,
        actions: [
          { id: "billing.manage", label: "Manage Plan", permission: PERMISSIONS.BILLING_MANAGE },
          { id: "billing.invoices.view", label: "Invoices", permission: PERMISSIONS.BILLING_INVOICES_VIEW },
          { id: "usage.view", label: "Usage", permission: PERMISSIONS.USAGE_VIEW },
        ],
      },
    ],
  },
  {
    category: "Administration",
    items: [
      {
        id: "companies",
        label: "Companies",
        permission: PERMISSIONS.COMPANIES_READ,
        actions: [{ id: "companies.manage", label: "Manage", permission: PERMISSIONS.COMPANIES_MANAGE }],
      },
      { id: "audit-logs", label: "Audit Logs", permission: PERMISSIONS.AUDIT_READ },
    ],
  },
];
