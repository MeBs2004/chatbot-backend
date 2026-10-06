import { listTasks, getTaskById, createTask, updateTask, deleteTask, TaskError } from "../../services/admin/task.service.js";

function handleTaskError(res, error, fallbackMessage) {
  if (error instanceof TaskError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

export const getTasks = async (req, res) => {
  try {
    const result = await listTasks(req.adminUser, req.query);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return handleTaskError(res, error, "Failed to load tasks.");
  }
};

export const getTask = async (req, res) => {
  try {
    const task = await getTaskById(req.adminUser, req.params.id);
    return res.status(200).json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "Failed to load task.");
  }
};

export const postTask = async (req, res) => {
  try {
    const task = await createTask(req, req.body);
    return res.status(201).json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "Failed to create task.");
  }
};

export const patchTask = async (req, res) => {
  try {
    const task = await updateTask(req, req.params.id, req.body);
    return res.status(200).json({ success: true, task });
  } catch (error) {
    return handleTaskError(res, error, "Failed to update task.");
  }
};

export const removeTask = async (req, res) => {
  try {
    await deleteTask(req, req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return handleTaskError(res, error, "Failed to delete task.");
  }
};
