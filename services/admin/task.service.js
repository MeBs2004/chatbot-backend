import Task from "../../models/task.model.js";
import UserCompanyAccess from "../../models/userCompanyAccess.model.js";
import { can, PERMISSIONS } from "./permissions.service.js";
import { getAccessibleCompanyIds, hasCompanyAccess } from "./access.service.js";
import { logAction } from "./audit.service.js";
import { emitDomainEvent } from "../realtime/io.js";
import { EVENTS } from "../realtime/events.js";

export class TaskError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Mirrors user.controller.js's unassignConversations — called when a
// user is suspended/deactivated/deleted so no task is left silently
// assigned to someone unreachable.
export async function unassignTasks(userId) {
  await Task.updateMany({ assigneeId: userId }, { assigneeId: null });
}

export async function listTasks(requester, query = {}) {
  const { companyId, status, priority, assignee, page = 1, limit = 50 } = query;

  const accessibleCompanyIds = await getAccessibleCompanyIds(requester);
  const filter = {};

  if (companyId) {
    if (accessibleCompanyIds !== null && !accessibleCompanyIds.includes(companyId)) {
      throw new TaskError("You don't have access to this company.", 403);
    }
    filter.companyId = companyId;
  } else if (accessibleCompanyIds !== null) {
    filter.companyId = { $in: accessibleCompanyIds };
  }

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (assignee === "me") filter.assigneeId = requester._id;
  else if (assignee === "unassigned") filter.assigneeId = null;
  else if (assignee) filter.assigneeId = assignee;

  const pageNum = Math.max(parseInt(page) || 1, 1);
  const limitNum = Math.min(parseInt(limit) || 50, 100);

  const [tasks, total] = await Promise.all([
    Task.find(filter)
      .populate("assigneeId", "name email")
      .populate("createdBy", "name email")
      .sort({ dueDate: 1, createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    Task.countDocuments(filter),
  ]);

  return { tasks, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 } };
}

export async function getTaskById(requester, taskId) {
  const task = await Task.findById(taskId).populate("assigneeId", "name email").populate("createdBy", "name email");
  if (!task) throw new TaskError("Task not found.", 404);
  if (!(await hasCompanyAccess(requester, task.companyId))) {
    throw new TaskError("You don't have access to this task.", 403);
  }
  return task;
}

async function assertAssigneeHasCompanyAccess(assigneeId, companyId) {
  if (!assigneeId) return;
  const access = await UserCompanyAccess.findOne({ userId: assigneeId, companyId, status: "ACTIVE" }).lean();
  if (!access) {
    throw new TaskError("The assignee doesn't have access to this company.");
  }
}

export async function createTask(req, { title, description, companyId, priority, assigneeId, dueDate }) {
  const requester = req.adminUser;
  if (!title || !title.trim()) throw new TaskError("Title is required.");
  if (!companyId) throw new TaskError("companyId is required.");
  if (!(await can(requester, PERMISSIONS.TASKS_CREATE, { companyId }))) {
    throw new TaskError("You don't have permission to create tasks for this company.", 403);
  }
  if (assigneeId) await assertAssigneeHasCompanyAccess(assigneeId, companyId);

  const task = await Task.create({
    title: title.trim(),
    description: (description || "").trim(),
    companyId,
    priority: priority || "MEDIUM",
    assigneeId: assigneeId || null,
    dueDate: dueDate || null,
    createdBy: requester._id,
  });

  await logAction(req, {
    action: "CREATE_TASK",
    resource: "Task",
    resourceId: task._id,
    companyId,
    metadata: { title: task.title, assigneeId: assigneeId || null },
  });

  if (assigneeId) {
    emitDomainEvent(EVENTS.TASK_ASSIGNED, { userId: assigneeId, companyId, payload: { taskId: task._id, title: task.title } });
  }
  emitDomainEvent(EVENTS.TASK_CREATED, { companyId, payload: { taskId: task._id } });

  return task;
}

export async function updateTask(req, taskId, updates) {
  const requester = req.adminUser;
  const task = await Task.findById(taskId);
  if (!task) throw new TaskError("Task not found.", 404);

  const isAssignee = task.assigneeId && String(task.assigneeId) === String(requester._id);
  const canEdit = await can(requester, PERMISSIONS.TASKS_EDIT, { companyId: task.companyId });
  const canComplete = await can(requester, PERMISSIONS.TASKS_COMPLETE, { companyId: task.companyId });
  const canAssign = await can(requester, PERMISSIONS.TASKS_ASSIGN, { companyId: task.companyId });

  if (!canEdit && !(isAssignee && canComplete)) {
    throw new TaskError("You don't have permission to edit this task.", 403);
  }

  const { title, description, priority, dueDate, status, assigneeId } = updates;
  const changedFields = [];

  // A self-service assignee (no tasks.edit) may only ever touch
  // status/completedAt — never rewrite the task's content or hand it
  // to someone else (Phase 24's explicit VIEWER example).
  if (!canEdit && isAssignee) {
    if (title !== undefined || description !== undefined || priority !== undefined || dueDate !== undefined || assigneeId !== undefined) {
      throw new TaskError("You can only update this task's status.", 403);
    }
  } else {
    if (title !== undefined) { task.title = title.trim(); changedFields.push("title"); }
    if (description !== undefined) { task.description = description.trim(); changedFields.push("description"); }
    if (priority !== undefined) { task.priority = priority; changedFields.push("priority"); }
    if (dueDate !== undefined) { task.dueDate = dueDate; changedFields.push("dueDate"); }
    if (assigneeId !== undefined && String(task.assigneeId || "") !== String(assigneeId || "")) {
      if (!canAssign) throw new TaskError("You don't have permission to reassign tasks.", 403);
      await assertAssigneeHasCompanyAccess(assigneeId, task.companyId);
      task.assigneeId = assigneeId || null;
      changedFields.push("assigneeId");
    }
  }

  if (status !== undefined && status !== task.status) {
    task.status = status;
    task.completedAt = status === "COMPLETED" ? new Date() : null;
    changedFields.push("status");
  }

  await task.save();

  await logAction(req, {
    action: changedFields.includes("status") && task.status === "COMPLETED" ? "COMPLETE_TASK" : "UPDATE_TASK",
    resource: "Task",
    resourceId: task._id,
    companyId: task.companyId,
    metadata: { changedFields },
  });

  if (changedFields.includes("assigneeId") && task.assigneeId) {
    emitDomainEvent(EVENTS.TASK_ASSIGNED, { userId: task.assigneeId, companyId: task.companyId, payload: { taskId: task._id, title: task.title } });
  }
  emitDomainEvent(EVENTS.TASK_UPDATED, { companyId: task.companyId, payload: { taskId: task._id, changedFields } });

  return task;
}

export async function deleteTask(req, taskId) {
  const requester = req.adminUser;
  const task = await Task.findById(taskId);
  if (!task) throw new TaskError("Task not found.", 404);

  if (!(await can(requester, PERMISSIONS.TASKS_DELETE, { companyId: task.companyId }))) {
    throw new TaskError("You don't have permission to delete this task.", 403);
  }

  await Task.deleteOne({ _id: task._id });

  await logAction(req, {
    action: "DELETE_TASK",
    resource: "Task",
    resourceId: task._id,
    companyId: task.companyId,
    metadata: { title: task.title },
  });

  emitDomainEvent(EVENTS.TASK_DELETED, { companyId: task.companyId, payload: { taskId: task._id } });
}
