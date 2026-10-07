import fs from "fs";
import path from "path";
import Company from "../models/company.model.js";

// ======================================================
// ONE-TIME KNOWLEDGE MIGRATION (disk -> MongoDB)
// Knowledge used to live in a local .txt file per company
// (Company.knowledgeFile), read/written straight off whatever
// filesystem the backend process happened to be running on. On
// Render that filesystem is ephemeral — wiped on every deploy and
// every idle-spindown restart — so any edit made only through the
// live admin panel was silently lost the next time the service
// restarted, with no error anywhere. See services/knowledge.service.js
// for the real fix (Company.knowledgeContent in MongoDB is now the
// source of truth).
//
// This migration exists to rescue whatever is CURRENTLY sitting on
// this process's disk — which, the first time this runs after
// deploying the fix, is the production admin's actual latest edit —
// before anything can wipe it.
//
// Idempotent via `knowledgeMigratedAt`, NOT via "is knowledgeContent
// empty": gating on emptiness would mean an admin deliberately
// clearing their knowledge base to blank gets silently un-cleared the
// next time the service restarts, because the stale (frozen, never
// written again) disk file would still be sitting there and look
// eligible again. Gating on a one-time marker instead means every
// company is touched AT MOST ONCE, ever, regardless of what Mongo's
// content looks like afterward — a genuinely empty, intentional
// knowledge base is never second-guessed.
// ======================================================

const SAFE_KNOWLEDGE_FILENAME_RE = /^[A-Za-z0-9_-]+\.txt$/;

export async function migrateKnowledgeFromDisk() {
  const candidates = await Company.find({
    knowledgeFile: { $exists: true, $ne: "" },
    knowledgeMigratedAt: null,
  }).select("companyId knowledgeFile knowledgeContent");

  if (candidates.length === 0) return;

  let migrated = 0;
  for (const company of candidates) {
    // Mark as migrated regardless of outcome below — "no file found"
    // and "file found but empty" are both terminal, not retryable.
    const markMigrated = () => Company.updateOne({ _id: company._id }, { knowledgeMigratedAt: new Date() });

    if (!SAFE_KNOWLEDGE_FILENAME_RE.test(company.knowledgeFile || "")) {
      await markMigrated();
      continue;
    }

    // A company that already has real content in Mongo (e.g. already
    // edited once through the new, fixed admin panel) is done — never
    // let an older disk snapshot clobber a newer Mongo write.
    if (company.knowledgeContent && company.knowledgeContent.trim()) {
      await markMigrated();
      continue;
    }

    const filePath = path.resolve(process.cwd(), company.knowledgeFile);
    try {
      const [content, stats] = await Promise.all([
        fs.promises.readFile(filePath, "utf8"),
        fs.promises.stat(filePath),
      ]);
      if (content.trim()) {
        await Company.updateOne(
          { _id: company._id },
          { knowledgeContent: content, knowledgeUpdatedAt: stats.mtime, knowledgeMigratedAt: new Date() }
        );
        migrated += 1;
        console.log(`✅ Knowledge migrated to MongoDB -> ${company.companyId} (${content.length} chars)`);
      } else {
        await markMigrated();
      }
    } catch {
      // No file on this disk for this company — nothing to rescue,
      // not an error (e.g. a fresh deploy with no prior local edits).
      await markMigrated();
    }
  }

  if (migrated > 0) {
    console.log(`✅ Knowledge migration complete: ${migrated}/${candidates.length} compan${migrated === 1 ? "y" : "ies"} migrated from disk to MongoDB.`);
  }
}
