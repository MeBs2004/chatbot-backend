import Company from "../models/company.model.js";
import { invalidateKnowledgeCache } from "./groq.service.js";

// ======================================================
// KNOWLEDGE SERVICE
// MongoDB-backed (Company.knowledgeContent) — NOT a local file
// anymore. The original "one flat .txt file per company on local
// disk" design was fatally incompatible with Render's ephemeral web
// service filesystem: any edit made only through the running admin
// panel lived solely on that one container's disk and was silently
// destroyed on the next deploy or idle-spindown restart, with no
// error surfaced anywhere. MongoDB is the one thing in this stack
// that's actually durable across restarts, so it's now the sole
// source of truth. `invalidateKnowledgeCache` keeps the in-process
// cache in groq.service.js from serving stale content after a write
// — see that file for why a cache is still worth having even though
// Mongo, not the cache, is what makes this correct.
// ======================================================

export const MAX_KNOWLEDGE_SIZE = 2 * 1024 * 1024; // 2MB, matches the original plain-text file cap

// `knowledgeFile` is now purely a cosmetic label (shown in the admin
// UI, e.g. "oya-knowledge.txt") — kept validated to this shape only
// so a company's display name can't contain path separators or other
// surprises; it no longer resolves to any real file anywhere.
const SAFE_KNOWLEDGE_FILENAME_RE = /^[A-Za-z0-9_-]+\.txt$/;
export const isValidKnowledgeFilename = (knowledgeFile) =>
  typeof knowledgeFile === "string" && SAFE_KNOWLEDGE_FILENAME_RE.test(knowledgeFile);

export class KnowledgeConflictError extends Error {}

/**
 * Reads a company's knowledge content straight from MongoDB. Never
 * throws for a missing/unknown company — returns empty content with
 * `error` set instead, matching the pre-existing controller contract
 * exactly (callers already handle this shape).
 */
export async function readKnowledgeFile(companyId) {
  if (!companyId) {
    return { content: "", sizeBytes: 0, updatedAt: null, error: "Invalid company reference." };
  }

  const company = await Company.findOne({ companyId }).select("knowledgeContent knowledgeUpdatedAt").lean();
  if (!company) {
    return { content: "", sizeBytes: 0, updatedAt: null, error: "Company not found." };
  }

  const content = company.knowledgeContent || "";
  return {
    content,
    sizeBytes: Buffer.byteLength(content, "utf8"),
    updatedAt: company.knowledgeUpdatedAt,
    error: null,
  };
}

/**
 * Writes a company's knowledge content to MongoDB and invalidates the
 * live in-memory cache so the very next AI request picks it up — no
 * restart required (see groq.service.js loadKnowledge/knowledgeCache).
 *
 * `expectedUpdatedAt`, if provided, guards against clobbering a newer
 * save from another tab/admin (concurrent-edit protection) — a
 * mismatch throws a `KnowledgeConflictError`, surfaced as HTTP 409.
 */
export async function writeKnowledgeFile(companyId, content, { expectedUpdatedAt } = {}) {
  if (!companyId) {
    throw new Error("Invalid company reference.");
  }
  if (typeof content !== "string") {
    throw new Error("content is required.");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_KNOWLEDGE_SIZE) {
    throw new Error("Knowledge content is too large (max 2MB).");
  }

  if (expectedUpdatedAt) {
    const current = await Company.findOne({ companyId }).select("knowledgeUpdatedAt").lean();
    const currentTime = current?.knowledgeUpdatedAt ? new Date(current.knowledgeUpdatedAt).getTime() : null;
    const expectedTime = new Date(expectedUpdatedAt).getTime();
    if (currentTime !== null && currentTime !== expectedTime) {
      throw new KnowledgeConflictError("This knowledge base was updated elsewhere since you loaded it.");
    }
  }

  const updatedAt = new Date();
  const company = await Company.findOneAndUpdate(
    { companyId },
    { knowledgeContent: content, knowledgeUpdatedAt: updatedAt },
    { new: true }
  ).select("knowledgeContent knowledgeUpdatedAt");

  if (!company) {
    throw new Error("Company not found.");
  }

  invalidateKnowledgeCache(companyId);

  return { sizeBytes: Buffer.byteLength(content, "utf8"), updatedAt };
}
