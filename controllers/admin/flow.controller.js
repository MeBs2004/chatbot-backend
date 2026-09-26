import Chatbot from "../../models/chatbot.model.js";
import { getCompanyRole } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { validateFlow } from "../../validators/flow.validator.js";
import * as flowService from "../../services/flow/flow.service.js";

/**
 * Shared guard for every flow endpoint below: loads the chatbot,
 * 404s if missing, and requires the same COMPANY_ADMIN-or-SUPER_ADMIN
 * check the rest of the admin chatbot API uses (see
 * controllers/admin/chatbot.controller.js) — company/chatbot
 * identity is always derived from the DB record, never trusted from
 * the request.
 */
async function loadAuthorizedChatbot(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }

  const requester = req.adminUser;
  if (requester.role !== "SUPER_ADMIN") {
    const role = await getCompanyRole(requester, chatbot.companyId);
    if (role !== "COMPANY_ADMIN") {
      res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      return null;
    }
  }

  return chatbot;
}

export const getFlow = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    const [draft, published, versions] = await Promise.all([
      flowService.getDraft(chatbot._id, chatbot.companyId),
      flowService.getPublished(chatbot._id),
      flowService.listVersions(chatbot._id),
    ]);

    return res.status(200).json({
      success: true,
      draft,
      published: published || null,
      versions,
    });
  } catch (error) {
    console.error("Get Flow Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load flow." });
  }
};

export const saveFlowDraft = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    const { nodes, edges, startNodeId } = req.body;
    if (!Array.isArray(nodes) || !Array.isArray(edges)) {
      return res.status(400).json({ success: false, message: "nodes and edges must be arrays." });
    }

    const draft = await flowService.saveDraft(
      chatbot._id,
      chatbot.companyId,
      { nodes, edges, startNodeId },
      req.adminUser._id
    );

    await logAction(req, {
      action: "FLOW_UPDATED",
      resource: "ChatbotFlow",
      resourceId: draft._id,
      companyId: chatbot.companyId,
    });

    return res.status(200).json({ success: true, draft });
  } catch (error) {
    console.error("Save Flow Draft Error:", error);
    return res.status(500).json({ success: false, message: "Failed to save draft." });
  }
};

export const validateFlowDraft = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    // Validate whatever was posted (so the builder can validate
    // in-progress edits before saving), falling back to the
    // persisted draft if no body is given.
    const hasBody = Array.isArray(req.body?.nodes);
    const result = hasBody
      ? validateFlow(req.body)
      : await flowService.validateDraft(chatbot._id, chatbot.companyId);

    await logAction(req, {
      action: "FLOW_VALIDATED",
      resource: "ChatbotFlow",
      resourceId: chatbot._id,
      companyId: chatbot.companyId,
      metadata: { valid: result.valid, errorCount: result.errors.length },
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("Validate Flow Error:", error);
    return res.status(500).json({ success: false, message: "Failed to validate flow." });
  }
};

export const publishFlow = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    const result = await flowService.publishDraft(chatbot._id, chatbot.companyId, req.adminUser._id);

    if (!result.published) {
      return res.status(400).json({ success: false, valid: false, errors: result.errors });
    }

    await logAction(req, {
      action: "FLOW_PUBLISHED",
      resource: "ChatbotFlow",
      resourceId: chatbot._id,
      companyId: chatbot.companyId,
      metadata: { version: result.publishedVersion },
    });

    return res.status(200).json({ success: true, publishedVersion: result.publishedVersion, draft: result.draft });
  } catch (error) {
    console.error("Publish Flow Error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish flow." });
  }
};

export const listFlowVersions = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    const versions = await flowService.listVersions(chatbot._id);
    return res.status(200).json({ success: true, versions });
  } catch (error) {
    console.error("List Flow Versions Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load versions." });
  }
};

export const rollbackFlow = async (req, res) => {
  try {
    const chatbot = await loadAuthorizedChatbot(req, res);
    if (!chatbot) return;

    const version = Number(req.body?.version);
    if (!version || version < 1) {
      return res.status(400).json({ success: false, message: "A valid version number is required." });
    }

    const result = await flowService.rollbackToVersion(chatbot._id, chatbot.companyId, version, req.adminUser._id);
    if (!result.success) {
      return res.status(404).json(result);
    }

    await logAction(req, {
      action: "FLOW_ROLLED_BACK",
      resource: "ChatbotFlow",
      resourceId: chatbot._id,
      companyId: chatbot.companyId,
      metadata: { version: result.publishedVersion },
    });

    return res.status(200).json({ success: true, publishedVersion: result.publishedVersion });
  } catch (error) {
    console.error("Rollback Flow Error:", error);
    return res.status(500).json({ success: false, message: "Failed to roll back flow." });
  }
};
