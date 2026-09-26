import express from "express";
import { getPublicWidgetConfig } from "../../controllers/widget/config.controller.js";

const router = express.Router();

// No auth middleware — this is deliberately public, same trust
// model as /bot/v1/*. See config.controller.js for the exact
// response whitelist.
router.get("/:chatbotId", getPublicWidgetConfig);

export default router;
