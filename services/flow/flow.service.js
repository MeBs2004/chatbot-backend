import ChatbotFlow from "../../models/chatbotFlow.model.js";
import { validateFlow } from "../../validators/flow.validator.js";

export async function getDraft(chatbotId, companyId) {
  let draft = await ChatbotFlow.findOne({ chatbotId, status: "DRAFT" });

  if (!draft) {
    const latest = await ChatbotFlow.findOne({ chatbotId }).sort({ version: -1 }).lean();
    draft = await ChatbotFlow.create({
      chatbotId,
      companyId,
      version: (latest?.version || 0) + 1,
      status: "DRAFT",
      nodes: [],
      edges: [],
      startNodeId: null,
    });
  }

  return draft;
}

export async function getPublished(chatbotId) {
  return ChatbotFlow.findOne({ chatbotId, status: "PUBLISHED" }).lean();
}

export async function saveDraft(chatbotId, companyId, { nodes, edges, startNodeId }, adminUserId) {
  const draft = await getDraft(chatbotId, companyId);

  draft.nodes = Array.isArray(nodes) ? nodes : [];
  draft.edges = Array.isArray(edges) ? edges : [];
  draft.startNodeId = startNodeId || null;
  if (!draft.createdBy) draft.createdBy = adminUserId;

  await draft.save();
  return draft;
}

export async function validateDraft(chatbotId, companyId) {
  const draft = await getDraft(chatbotId, companyId);
  return validateFlow(draft);
}

export async function listVersions(chatbotId) {
  return ChatbotFlow.find({ chatbotId, status: { $in: ["PUBLISHED", "ARCHIVED"] } })
    .select("version status publishedAt createdAt publishedBy")
    .sort({ version: -1 })
    .lean();
}

/**
 * Validates the current draft and, if valid, promotes it to
 * PUBLISHED (archiving whatever was previously published), then
 * opens a fresh draft seeded from what was just published so editing
 * can continue without losing the published graph.
 */
export async function publishDraft(chatbotId, companyId, adminUserId) {
  const draft = await getDraft(chatbotId, companyId);
  const validation = validateFlow(draft);

  if (!validation.valid) {
    return { published: false, errors: validation.errors };
  }

  const previousPublished = await ChatbotFlow.findOne({ chatbotId, status: "PUBLISHED" });
  if (previousPublished) {
    previousPublished.status = "ARCHIVED";
    await previousPublished.save();
  }

  draft.status = "PUBLISHED";
  draft.publishedAt = new Date();
  draft.publishedBy = adminUserId;
  await draft.save();

  const newDraft = await ChatbotFlow.create({
    chatbotId,
    companyId,
    version: draft.version + 1,
    status: "DRAFT",
    nodes: draft.nodes,
    edges: draft.edges,
    startNodeId: draft.startNodeId,
    createdBy: adminUserId,
  });

  return { published: true, publishedVersion: draft.version, draft: newDraft };
}

export async function rollbackToVersion(chatbotId, companyId, targetVersion, adminUserId) {
  const target = await ChatbotFlow.findOne({
    chatbotId,
    version: targetVersion,
    status: { $in: ["PUBLISHED", "ARCHIVED"] },
  });

  if (!target) {
    return { success: false, message: "That version was not found." };
  }

  if (target.status === "PUBLISHED") {
    return { success: true, publishedVersion: target.version };
  }

  const currentPublished = await ChatbotFlow.findOne({ chatbotId, status: "PUBLISHED" });
  if (currentPublished) {
    currentPublished.status = "ARCHIVED";
    await currentPublished.save();
  }

  target.status = "PUBLISHED";
  target.publishedAt = new Date();
  target.publishedBy = adminUserId;
  await target.save();

  return { success: true, publishedVersion: target.version };
}
