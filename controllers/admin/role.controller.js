import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  RoleError,
} from "../../services/admin/role.service.js";
import { PERMISSIONS, SYSTEM_ROLES } from "../../services/admin/permissions.service.js";
import { FEATURE_REGISTRY } from "../../services/admin/featureRegistry.js";

function handleRoleError(res, error, fallbackMessage) {
  if (error instanceof RoleError) {
    return res.status(error.status).json({ success: false, message: error.message, code: error.code });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ success: false, message: fallbackMessage });
}

export const getFeatures = async (_req, res) => {
  return res.status(200).json({
    success: true,
    features: FEATURE_REGISTRY,
    permissions: PERMISSIONS,
    systemRoles: SYSTEM_ROLES,
  });
};

export const getRoles = async (req, res) => {
  try {
    const { companyId } = req.query;
    if (!companyId) {
      return res.status(400).json({ success: false, message: "companyId is required." });
    }
    const roles = await listRoles(req.adminUser, companyId);
    return res.status(200).json({ success: true, roles });
  } catch (error) {
    return handleRoleError(res, error, "Failed to load roles.");
  }
};

export const getRoleById = async (req, res) => {
  try {
    const role = await getRole(req.adminUser, req.params.id);
    return res.status(200).json({ success: true, role });
  } catch (error) {
    return handleRoleError(res, error, "Failed to load role.");
  }
};

export const postRole = async (req, res) => {
  try {
    const { companyId, name, description, permissions } = req.body;
    const role = await createRole(req, { companyId, name, description, permissions: permissions || [] });
    return res.status(201).json({ success: true, role });
  } catch (error) {
    return handleRoleError(res, error, "Failed to create role.");
  }
};

export const patchRole = async (req, res) => {
  try {
    const { name, description, permissions } = req.body;
    const role = await updateRole(req, req.params.id, { name, description, permissions });
    return res.status(200).json({ success: true, role });
  } catch (error) {
    return handleRoleError(res, error, "Failed to update role.");
  }
};

export const removeRole = async (req, res) => {
  try {
    const { replacementRole } = req.body;
    const result = await deleteRole(req, req.params.id, { replacementRole });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return handleRoleError(res, error, "Failed to delete role.");
  }
};
