import AdminUser from "../../models/adminUser.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import ChatbotAccess from "../../models/chatbotAccess.model.js";
import { logAction } from "./audit.service.js";
import { assertGrantable, isValidRoleForCompany } from "./role.service.js";
import { isRoleAllowedForChatbotScope, resolveRolePermissions } from "./permissions.service.js";
import { assertMemberQuota } from "../billing/quota.service.js";
import { emitDomainEvent, disconnectUserSockets } from "../realtime/io.js";
import { EVENTS } from "../realtime/events.js";

// ======================================================
// CHATBOT ASSIGNMENT
// The one implementation of "give this user chatbot X" / "take it
// away", shared by POST /users/:id/chatbot-access and
// POST /chatbots/:id/access. Callers must already have checked the
// requester is SUPER_ADMIN or a COMPANY_ADMIN of chatbot.companyId.
//
// A user with no access to the chatbot's company yet gets a
// CHATBOTS-scoped UserCompanyAccess row — they see ONLY the
// chatbots assigned to them. A user who already has full company
// access keeps it; the ChatbotAccess row then just records that
// they're responsible for this chatbot.
// ======================================================

export class AssignmentError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_CHATBOT_ROLE = "AGENT";

async function assertAssignableRole(requester, role, companyId) {
  if (!isRoleAllowedForChatbotScope(role)) {
    throw new AssignmentError(
      "A user limited to specific chatbots can't be a Company Admin. Use Chatbot Manager instead."
    );
  }
  if (!(await isValidRoleForCompany(role, companyId))) {
    throw new AssignmentError("Invalid role.");
  }
  // Never let a Company Admin hand out more than they hold themselves.
  await assertGrantable(requester, companyId, await resolveRolePermissions(role, companyId));
}

/**
 * Grants `userId` access to `chatbot`. `role` only applies when the
 * user is (or becomes) chatbot-scoped in this company.
 */
export async function grantChatbotAccess(req, { userId, chatbot, role, permissions = [] }) {
  const requester = req.adminUser;

  const target = await AdminUser.findById(userId).select("role").lean();
  if (!target) throw new AssignmentError("User not found.", 404);
  if (target.role === "SUPER_ADMIN") {
    throw new AssignmentError("A Super Admin already has access to every chatbot.");
  }

  const companyId = chatbot.companyId;
  let access = await UserCompanyAccess.findOne({ userId, companyId });

  if (!access) {
    const newRole = role || DEFAULT_CHATBOT_ROLE;
    await assertAssignableRole(requester, newRole, companyId);
    await assertMemberQuota(companyId);
    access = await UserCompanyAccess.create({
      userId,
      companyId,
      role: newRole,
      accessScope: "CHATBOTS",
      status: "ACTIVE",
    });
  } else if (access.status !== "ACTIVE") {
    throw new AssignmentError("This user's access to the company is inactive. Reactivate it first.", 409);
  } else if ((access.accessScope || "COMPANY") === "CHATBOTS" && role && role !== access.role) {
    await assertAssignableRole(requester, role, companyId);
    access.role = role;
    await access.save();
  }

  const chatbotAccess = await ChatbotAccess.findOneAndUpdate(
    { userId, chatbotId: chatbot._id },
    { companyId, permissions },
    { upsert: true, new: true }
  );

  await logAction(req, {
    action: "ASSIGN_CHATBOT_ACCESS",
    resource: "Chatbot",
    resourceId: chatbot._id,
    companyId,
    metadata: { userId: String(userId), role: access.role, accessScope: access.accessScope || "COMPANY" },
  });

  // Notice only — the user's client resubscribes, and the server
  // re-checks access from the DB on every subscribe.
  emitDomainEvent(EVENTS.ACCESS_UPDATED, {
    userId,
    payload: { chatbotId: chatbot._id, companyId, granted: true },
  });

  return { access: chatbotAccess, companyAccess: access };
}

/**
 * Removes `userId`'s access to `chatbot`. If that was a chatbot-scoped
 * user's last chatbot in the company, their (now empty) company row
 * goes too.
 */
export async function revokeChatbotAccess(req, { userId, chatbot }) {
  await ChatbotAccess.findOneAndDelete({ userId, chatbotId: chatbot._id });

  const companyId = chatbot.companyId;
  const access = await UserCompanyAccess.findOne({ userId, companyId }).lean();
  if (access && access.accessScope === "CHATBOTS") {
    const remaining = await ChatbotAccess.countDocuments({ userId, companyId });
    if (remaining === 0) await UserCompanyAccess.deleteOne({ _id: access._id });
  }

  await logAction(req, {
    action: "REMOVE_CHATBOT_ACCESS",
    resource: "Chatbot",
    resourceId: chatbot._id,
    companyId,
    metadata: { userId: String(userId) },
  });

  // Revoked — force a reconnect so no socket keeps sitting in this
  // chatbot's room.
  disconnectUserSockets(userId);
}
