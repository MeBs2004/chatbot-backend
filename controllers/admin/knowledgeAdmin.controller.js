import multer from "multer";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { getCompanyRole, hasChatbotAccess } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { readKnowledgeFile, writeKnowledgeFile, KnowledgeConflictError } from "../../services/knowledge.service.js";
import { extractKnowledgeFileText, UnsupportedKnowledgeFileError, SUPPORTED_KNOWLEDGE_UPLOAD_MIMETYPES } from "../../utils/extractKnowledgeFileText.js";
import { askAI } from "../../services/ai.router.js";
import { emitDomainEvent } from "../../services/realtime/io.js";
import { EVENTS } from "../../services/realtime/events.js";

// Chatbot-scoped door onto the exact same knowledge.service.js the
// Company-scoped endpoints use (backend/controllers/admin/company.controller.js)
// — see Phase 7 report "Knowledge Base" for why there is only one
// underlying knowledge system, not two.

async function loadAuthorizedChatbotAndCompany(req, res) {
  const chatbot = await Chatbot.findById(req.params.id).lean();
  if (!chatbot || chatbot.deletedAt) {
    res.status(404).json({ success: false, message: "Chatbot not found." });
    return null;
  }

  const requester = req.adminUser;
  if (!(await hasChatbotAccess(requester, chatbot._id))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }

  const company = await Company.findOne({ companyId: chatbot.companyId }).lean();
  if (!company) {
    res.status(404).json({ success: false, message: "Company not found." });
    return null;
  }

  return { chatbot, company };
}

export const getChatbotKnowledge = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    const result = await readKnowledgeFile(ctx.company.companyId);
    const status = result.error ? (result.content ? "FAILED" : "EMPTY") : result.content.trim() ? "READY" : "EMPTY";

    const siblingChatbotCount = await Chatbot.countDocuments({
      companyId: ctx.company.companyId,
      deletedAt: null,
      _id: { $ne: ctx.chatbot._id },
    });

    return res.status(200).json({
      success: true,
      knowledgeFile: ctx.company.knowledgeFile,
      content: result.content,
      sizeBytes: result.sizeBytes,
      characterCount: result.content.length,
      updatedAt: result.updatedAt,
      status,
      companyId: ctx.company.companyId,
      siblingChatbotCount,
      ...(result.error && { error: result.error }),
    });
  } catch (error) {
    console.error("Get Chatbot Knowledge Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load knowledge base." });
  }
};

export const updateChatbotKnowledge = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    const requester = req.adminUser;
    if (requester.role !== "SUPER_ADMIN") {
      const role = await getCompanyRole(requester, ctx.company.companyId);
      if (role !== "COMPANY_ADMIN") {
        return res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
      }
    }

    const { content, expectedUpdatedAt } = req.body;
    if (typeof content !== "string") {
      return res.status(400).json({ success: false, message: "content is required." });
    }

    let result;
    try {
      result = await writeKnowledgeFile(ctx.company.companyId, content, { expectedUpdatedAt });
    } catch (writeErr) {
      if (writeErr instanceof KnowledgeConflictError) {
        return res.status(409).json({ success: false, message: writeErr.message });
      }
      return res.status(400).json({ success: false, message: writeErr.message });
    }

    await logAction(req, {
      action: "KNOWLEDGE_UPDATED",
      resource: "Chatbot",
      resourceId: ctx.chatbot._id,
      companyId: ctx.company.companyId,
      metadata: { knowledgeFile: ctx.company.knowledgeFile, bytes: result.sizeBytes },
    });

    // Company-room — the knowledge file is shared across every
    // chatbot in this company (see Company.knowledgeFile), same
    // reasoning as AI_SETTINGS_UPDATED above. Lets another admin's
    // open Knowledge Base tab show a non-destructive "updated
    // elsewhere" banner instead of silently going stale until their
    // next save collides (409).
    emitDomainEvent(EVENTS.KNOWLEDGE_UPDATED, {
      companyId: ctx.company.companyId,
      payload: { updatedAt: result.updatedAt, triggeredByChatbotId: ctx.chatbot._id },
    });

    return res.status(200).json({ success: true, message: "Knowledge base updated.", updatedAt: result.updatedAt });
  } catch (error) {
    console.error("Update Chatbot Knowledge Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update knowledge base." });
  }
};

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // 5MB — binary docs (docx/pdf/xlsx) run bigger than their extracted text
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_KNOWLEDGE_UPLOAD_MIMETYPES.includes(file.mimetype)) return cb(null, true);
    cb(new UnsupportedKnowledgeFileError(`"${file.mimetype}" is not supported for knowledge extraction yet.`));
  },
});
// multer's own error path (fileFilter rejection, size-limit
// exceeded) fires here, before req ever reaches the controller's own
// try/catch below — without this wrapper it falls through to the
// generic 500 handler in index.js instead of an honest 400.
export const knowledgeUploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof UnsupportedKnowledgeFileError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ success: false, message: `File is too large (max ${MAX_UPLOAD_SIZE / (1024 * 1024)}MB).` });
    }
    console.error("Knowledge Upload Middleware Error:", err);
    return res.status(400).json({ success: false, message: "Upload failed." });
  });
};

// Deliberately does NOT persist — extracts and returns the text so
// the admin reviews/merges it into the editor before an explicit
// Save, same "no silent server-side data changes" principle as the
// rest of the knowledge editor (Section 16/23).
export const extractChatbotKnowledgeUpload = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "A file is required." });
    }

    const text = await extractKnowledgeFileText(req.file);

    await logAction(req, {
      action: "KNOWLEDGE_UPLOADED",
      resource: "Chatbot",
      resourceId: ctx.chatbot._id,
      companyId: ctx.company.companyId,
      metadata: { filename: req.file.originalname, mimetype: req.file.mimetype, extractedChars: text.length },
    });

    return res.status(200).json({ success: true, filename: req.file.originalname, extractedText: text });
  } catch (error) {
    if (error instanceof UnsupportedKnowledgeFileError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Extract Knowledge Upload Error:", error);
    return res.status(500).json({ success: false, message: "Failed to extract text from this file." });
  }
};

export const testChatbotKnowledge = async (req, res) => {
  try {
    const ctx = await loadAuthorizedChatbotAndCompany(req, res);
    if (!ctx) return;

    const { question } = req.body;
    if (!question || typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ success: false, message: "question is required." });
    }

    // Reuses the exact same AI call the Knowledge Base flow node and
    // normal chat both use (see flow.executor.js) — no second
    // retrieval system. The system only ever injects the whole
    // knowledge file as text, so there is no per-passage source to
    // cite — reporting a fabricated "source" would be dishonest.
    const answer = await askAI({
      company: ctx.company,
      message: question.slice(0, 2000),
      language: ctx.company.ai?.language || "English",
      extraInstruction: "Answer strictly using the knowledge base content already provided in your system prompt.",
      chatbotId: ctx.chatbot._id,
    });

    await logAction(req, {
      action: "KNOWLEDGE_TESTED",
      resource: "Chatbot",
      resourceId: ctx.chatbot._id,
      companyId: ctx.company.companyId,
      metadata: { questionLength: question.length },
    });

    return res.status(200).json({ success: true, answer, sourcesAvailable: false });
  } catch (error) {
    console.error("Test Knowledge Error:", error);
    return res.status(500).json({ success: false, message: "Knowledge test failed." });
  }
};
