import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ChatbotAccess from "../../models/chatbotAccess.model.js";
import Chatbot from "../../models/chatbot.model.js";

// ======================================================
// ACCESS — the single source of truth for tenant isolation.
//
// Three kinds of admin user:
//   1. SUPER_ADMIN (Nuform) — unrestricted, bypasses everything.
//   2. Company-scoped  (UserCompanyAccess.accessScope = "COMPANY")
//      — sees the whole company, every chatbot in it.
//   3. Chatbot-scoped  (UserCompanyAccess.accessScope = "CHATBOTS")
//      — sees ONLY the chatbots they have a ChatbotAccess row for,
//      and nothing company-wide.
//
// Deny-by-default: every pre-existing "company" check below
// (getAccessibleCompanyIds / hasCompanyAccess / getCompanyRole) only
// ever counts COMPANY-scoped rows, so a chatbot-scoped user is
// automatically refused by any company-level endpoint — including
// one nobody remembered to update. Chatbot-level endpoints opt in
// explicitly via hasChatbotAccess / getChatbotRole / getScopeFilter.
// ======================================================

const isSuperAdmin = (adminUser) => adminUser?.role === "SUPER_ADMIN";

// Missing accessScope (a row written before this field existed) is
// COMPANY — the field's schema default, but `.lean()` reads never
// apply defaults to already-stored documents.
const COMPANY_SCOPE = { $in: ["COMPANY", null] };

/**
 * companyIds where this user has FULL company access, or `null` for
 * unrestricted (SUPER_ADMIN). Chatbot-scoped companies are excluded.
 */
export const getAccessibleCompanyIds = async (adminUser) => {
  if (isSuperAdmin(adminUser)) return null;

  const rows = await UserCompanyAccess.find({
    userId: adminUser._id,
    status: "ACTIVE",
    accessScope: COMPANY_SCOPE,
  })
    .select("companyId")
    .lean();

  return rows.map((r) => r.companyId);
};

/**
 * Every company the user can see ANYTHING in (company- or chatbot-
 * scoped). Only for things like the workspace switcher's list of
 * names — never for returning company data.
 */
export const getVisibleCompanyIds = async (adminUser) => {
  if (isSuperAdmin(adminUser)) return null;

  const rows = await UserCompanyAccess.find({ userId: adminUser._id, status: "ACTIVE" })
    .select("companyId")
    .lean();

  return rows.map((r) => r.companyId);
};

export const hasCompanyAccess = async (adminUser, companyId) => {
  if (isSuperAdmin(adminUser)) return true;
  if (!companyId) return false;

  const access = await UserCompanyAccess.findOne({
    userId: adminUser._id,
    companyId,
    status: "ACTIVE",
    accessScope: COMPANY_SCOPE,
  }).lean();

  return !!access;
};

/**
 * Company-wide role for this user: their COMPANY-scoped
 * UserCompanyAccess.role, "SUPER_ADMIN" if global, or null. A
 * chatbot-scoped user gets null here — use getChatbotRole for
 * anything that's about one specific chatbot.
 */
export const getCompanyRole = async (adminUser, companyId) => {
  if (isSuperAdmin(adminUser)) return "SUPER_ADMIN";

  const access = await UserCompanyAccess.findOne({
    userId: adminUser._id,
    companyId,
    status: "ACTIVE",
    accessScope: COMPANY_SCOPE,
  }).lean();

  return access?.role || null;
};

/**
 * The ACTIVE UserCompanyAccess row that grants this user access to
 * this chatbot (company-scoped, or chatbot-scoped with a matching
 * ChatbotAccess row), or null. SUPER_ADMIN is handled by callers.
 */
async function getChatbotAccessRow(adminUser, chatbot) {
  const access = await UserCompanyAccess.findOne({
    userId: adminUser._id,
    companyId: chatbot.companyId,
    status: "ACTIVE",
  }).lean();
  if (!access) return null;

  if ((access.accessScope || "COMPANY") === "COMPANY") return access;

  const assigned = await ChatbotAccess.exists({ userId: adminUser._id, chatbotId: chatbot._id });
  return assigned ? access : null;
}

async function loadChatbot(chatbotOrId) {
  if (chatbotOrId && typeof chatbotOrId === "object" && chatbotOrId.companyId) return chatbotOrId;
  return Chatbot.findById(chatbotOrId).select("_id companyId").lean();
}

export const hasChatbotAccess = async (adminUser, chatbotOrId) => {
  if (isSuperAdmin(adminUser)) return true;

  const chatbot = await loadChatbot(chatbotOrId);
  if (!chatbot) return false;

  return !!(await getChatbotAccessRow(adminUser, chatbot));
};

/**
 * The role this user holds for one specific chatbot — their company
 * role if company-scoped, or their chatbot-scoped role if this
 * chatbot is assigned to them. null = no access.
 */
export const getChatbotRole = async (adminUser, chatbotOrId) => {
  if (isSuperAdmin(adminUser)) return "SUPER_ADMIN";

  const chatbot = await loadChatbot(chatbotOrId);
  if (!chatbot) return null;

  return (await getChatbotAccessRow(adminUser, chatbot))?.role || null;
};

/**
 * The UserCompanyAccess row behind getChatbotRole (role +
 * permissionOverrides), for permission resolution.
 */
export const getChatbotAccess = async (adminUser, chatbotOrId) => {
  if (isSuperAdmin(adminUser)) return null;
  const chatbot = await loadChatbot(chatbotOrId);
  if (!chatbot) return null;
  return getChatbotAccessRow(adminUser, chatbot);
};

/**
 * chatbotIds assigned to a chatbot-scoped user (optionally within one
 * company). Only counts companies where the user's access row is
 * ACTIVE and CHATBOTS-scoped — a COMPANY-scoped user already sees
 * every chatbot via getAccessibleCompanyIds.
 */
export const getAssignedChatbotIds = async (adminUser, companyId = null) => {
  if (isSuperAdmin(adminUser)) return [];

  const scopedRows = await UserCompanyAccess.find({
    userId: adminUser._id,
    status: "ACTIVE",
    accessScope: "CHATBOTS",
    ...(companyId ? { companyId } : {}),
  })
    .select("companyId")
    .lean();
  if (scopedRows.length === 0) return [];

  const rows = await ChatbotAccess.find({
    userId: adminUser._id,
    companyId: { $in: scopedRows.map((r) => r.companyId) },
  })
    .select("chatbotId")
    .lean();

  return rows.map((r) => r.chatbotId);
};

/**
 * Mongo filter limiting a query to exactly what this user may see,
 * for any collection that carries companyId + chatbotId (Chatbot uses
 * `_id` as its chatbot field). Returns `{}` for SUPER_ADMIN.
 *
 *   companyId (optional) — narrow to one company; throws 403 if the
 *     user can't see anything in it.
 *   chatbotId (optional) — narrow to one chatbot; throws 403 if the
 *     user can't access it.
 *
 * A record with chatbotId: null (legacy/unattributed) is only ever
 * visible to company-scoped users and SUPER_ADMIN.
 */
export const getScopeFilter = async (
  adminUser,
  { companyId = null, chatbotId = null, chatbotField = "chatbotId" } = {}
) => {
  if (chatbotId) {
    const chatbot = await loadChatbot(chatbotId);
    if (!chatbot || !(await hasChatbotAccess(adminUser, chatbot))) throw accessDenied();
    if (companyId && companyId !== chatbot.companyId) throw accessDenied();
    return { companyId: chatbot.companyId, [chatbotField]: chatbot._id };
  }

  if (isSuperAdmin(adminUser)) return companyId ? { companyId } : {};

  const [companyIds, chatbotIds] = await Promise.all([
    getAccessibleCompanyIds(adminUser),
    getAssignedChatbotIds(adminUser, companyId),
  ]);

  if (companyId) {
    if (companyIds.includes(companyId)) return { companyId };
    if (chatbotIds.length > 0) return { companyId, [chatbotField]: { $in: chatbotIds } };
    throw accessDenied();
  }

  const clauses = [];
  if (companyIds.length > 0) clauses.push({ companyId: { $in: companyIds } });
  if (chatbotIds.length > 0) clauses.push({ [chatbotField]: { $in: chatbotIds } });
  // Matches nothing — an authenticated user with no access at all.
  if (clauses.length === 0) return { companyId: { $in: [] } };
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

export function accessDenied() {
  const err = new Error("You don't have permission to access this resource.");
  err.status = 403;
  return err;
}
