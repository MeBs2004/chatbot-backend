import fs from "fs";
import path from "path";
import { invalidateKnowledgeCache } from "./groq.service.js";

// ======================================================
// KNOWLEDGE SERVICE (Phase 7)
// Extracted from controllers/admin/company.controller.js so the
// original Company-scoped knowledge endpoints and the new
// Chatbot-scoped ones (controllers/admin/knowledge.controller.js)
// call exactly the same read/write/invalidate logic — one real
// knowledge system, not two. Still the same "one flat text file per
// company" architecture; no vector DB, no chunking, no embeddings.
// ======================================================

export const MAX_KNOWLEDGE_SIZE = 2 * 1024 * 1024; // 2MB, matches a plain-text knowledge file

// Existing knowledge files are plain filenames in the backend's
// working directory (knowledge.txt, oya-knowledge.txt). Restrict to
// that shape so knowledgeFile can never resolve outside it — no
// path separators, no "..", no absolute paths.
const SAFE_KNOWLEDGE_FILENAME_RE = /^[A-Za-z0-9_-]+\.txt$/;

export const isValidKnowledgeFilename = (knowledgeFile) =>
  typeof knowledgeFile === "string" && SAFE_KNOWLEDGE_FILENAME_RE.test(knowledgeFile);

const resolveKnowledgePath = (knowledgeFile) => path.resolve(process.cwd(), knowledgeFile);

/**
 * Reads a company's knowledge file. Never throws for a missing file
 * — returns empty content with `error` set instead, matching the
 * pre-existing controller behavior exactly.
 */
export async function readKnowledgeFile(knowledgeFile) {
  if (!isValidKnowledgeFilename(knowledgeFile)) {
    return { content: "", sizeBytes: 0, updatedAt: null, error: "Invalid knowledge file reference." };
  }

  const filePath = resolveKnowledgePath(knowledgeFile);

  try {
    const [content, stats] = await Promise.all([
      fs.promises.readFile(filePath, "utf8"),
      fs.promises.stat(filePath),
    ]);
    return { content, sizeBytes: stats.size, updatedAt: stats.mtime, error: null };
  } catch {
    return { content: "", sizeBytes: 0, updatedAt: null, error: "Knowledge file not found on disk." };
  }
}

/**
 * Writes a company's knowledge file and invalidates the live
 * in-memory cache so the very next AI request picks it up — no
 * restart required (see groq.service.js loadKnowledge/knowledgeCache).
 *
 * `expectedUpdatedAt`, if provided, guards against clobbering a
 * newer save from another tab/admin (Phase 7 concurrent-edit
 * protection) — a mismatch throws a `ConflictError`.
 */
export class KnowledgeConflictError extends Error {}

export async function writeKnowledgeFile(knowledgeFile, content, { expectedUpdatedAt } = {}) {
  if (!isValidKnowledgeFilename(knowledgeFile)) {
    throw new Error("Invalid knowledge file reference.");
  }
  if (typeof content !== "string") {
    throw new Error("content is required.");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_KNOWLEDGE_SIZE) {
    throw new Error("Knowledge content is too large (max 2MB).");
  }

  const filePath = resolveKnowledgePath(knowledgeFile);

  if (expectedUpdatedAt) {
    try {
      const stats = await fs.promises.stat(filePath);
      if (new Date(stats.mtime).getTime() !== new Date(expectedUpdatedAt).getTime()) {
        throw new KnowledgeConflictError("This knowledge base was updated elsewhere since you loaded it.");
      }
    } catch (err) {
      if (err instanceof KnowledgeConflictError) throw err;
      // File didn't exist yet — nothing to conflict with.
    }
  }

  await fs.promises.writeFile(filePath, content, "utf8");
  invalidateKnowledgeCache(knowledgeFile);

  const stats = await fs.promises.stat(filePath);
  return { sizeBytes: stats.size, updatedAt: stats.mtime };
}
