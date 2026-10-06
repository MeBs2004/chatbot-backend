import express from "express";

import adminAuthMiddleware from "../../middleware/adminAuth.middleware.js";
import {
  getFeatures,
  getRoles,
  getRoleById,
  postRole,
  patchRole,
  removeRole,
} from "../../controllers/admin/role.controller.js";

const router = express.Router();

router.use(adminAuthMiddleware);

// Any authenticated admin user can read the feature registry — it's
// static metadata, not a secret; the role editor UI that consumes it
// is itself gated behind roles.view/roles.create/etc in the frontend,
// and every actual mutation below is independently authorized inside
// role.service.js regardless of what this returns.
router.get("/features", getFeatures);

router.get("/", getRoles);
router.get("/:id", getRoleById);
router.post("/", postRole);
router.patch("/:id", patchRole);
router.delete("/:id", removeRole);

export default router;
