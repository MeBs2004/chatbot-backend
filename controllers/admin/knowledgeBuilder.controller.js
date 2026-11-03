import multer from "multer";
import Company from "../../models/company.model.js";
import { hasCompanyAccess } from "../../services/admin/access.service.js";
import { isAIQuotaExceeded } from "../../services/billing/quota.service.js";
import { scrapeWebsite, ScrapeError } from "../../utils/scrapeWebsite.js";
import { extractKnowledgeFileText, UnsupportedKnowledgeFileError, SUPPORTED_KNOWLEDGE_UPLOAD_MIMETYPES } from "../../utils/extractKnowledgeFileText.js";
import { buildKnowledgeFromText, KnowledgeBuildError } from "../../services/knowledgeBuilder.service.js";

const QUOTA_MESSAGE = "This company has reached its monthly AI usage limit. Please try again later, or write the knowledge base manually.";

// ======================================================
// KNOWLEDGE BASE GENERATION — "Website URL" and "Upload file", the two
// ways the Create Chatbot wizard's Knowledge step builds a starting
// knowledge.txt. Deliberately does NOT persist anything (same contract
// as extractChatbotKnowledgeUpload in knowledgeAdmin.controller.js) —
// it returns generated text for the page to show in an editable box;
// saving it goes through the existing PUT .../knowledge endpoints once
// the admin is happy with it.
// ======================================================

const MAX_UPLOAD_SIZE = 5 * 1024 * 1024; // matches knowledgeAdmin.controller.js's per-chatbot upload limit

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (SUPPORTED_KNOWLEDGE_UPLOAD_MIMETYPES.includes(file.mimetype)) return cb(null, true);
    cb(new UnsupportedKnowledgeFileError(`"${file.mimetype}" is not supported for knowledge extraction yet.`));
  },
});

// multer's own error path (fileFilter rejection, size-limit overflow)
// rejects BEFORE Express's normal error handler sees a typed error —
// same convention as knowledgeAdmin.controller.js's upload middleware.
export const knowledgeGenerateUploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof UnsupportedKnowledgeFileError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ success: false, message: `File is too large (max ${MAX_UPLOAD_SIZE / (1024 * 1024)}MB).` });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) {
      console.error("Knowledge Generate Upload Error:", err);
      return res.status(500).json({ success: false, message: "Failed to process the upload." });
    }
    next();
  });
};

async function loadAuthorizedCompany(req, res) {
  const company = await Company.findOne({ companyId: req.params.id });
  if (!company) {
    res.status(404).json({ success: false, message: "Company not found." });
    return null;
  }
  if (!(await hasCompanyAccess(req.adminUser, company.companyId))) {
    res.status(403).json({ success: false, message: "You don't have permission to access this resource." });
    return null;
  }
  return company;
}

const MAX_URL_LENGTH = 2048;

export const generateKnowledgeFromUrl = async (req, res) => {
  try {
    const company = await loadAuthorizedCompany(req, res);
    if (!company) return;

    const { url } = req.body || {};
    if (typeof url !== "string" || !url.trim()) {
      return res.status(400).json({ success: false, message: "Enter a website address." });
    }
    if (url.length > MAX_URL_LENGTH) {
      return res.status(400).json({ success: false, message: "That address is too long." });
    }

    let scraped;
    try {
      scraped = await scrapeWebsite(url);
    } catch (err) {
      if (err instanceof ScrapeError) {
        return res.status(400).json({ success: false, message: err.message });
      }
      throw err;
    }

    if (await isAIQuotaExceeded(company.companyId)) {
      return res.status(402).json({ success: false, message: QUOTA_MESSAGE });
    }

    let built;
    try {
      built = await buildKnowledgeFromText({
        companyId: company.companyId,
        companyName: company.name,
        rawText: scraped.rawText,
        sourceLabel: scraped.homeUrl,
      });
    } catch (err) {
      if (err instanceof KnowledgeBuildError) {
        return res.status(502).json({ success: false, message: err.message });
      }
      throw err;
    }

    return res.status(200).json({
      success: true,
      content: built.content,
      source: { type: "url", url: scraped.homeUrl, pagesScanned: scraped.pagesScanned, title: scraped.title },
      truncated: Boolean(scraped.truncated || built.truncatedSource),
    });
  } catch (error) {
    console.error("Generate Knowledge From URL Error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate a knowledge base from that website." });
  }
};

export const generateKnowledgeFromFile = async (req, res) => {
  try {
    const company = await loadAuthorizedCompany(req, res);
    if (!company) return;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Choose a file to upload." });
    }

    let text;
    try {
      text = await extractKnowledgeFileText(req.file);
    } catch (err) {
      if (err instanceof UnsupportedKnowledgeFileError) {
        return res.status(400).json({ success: false, message: err.message });
      }
      console.error("Extract Knowledge File Error:", err);
      return res.status(500).json({ success: false, message: "Failed to read this file." });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: `"${req.file.originalname}" doesn't have any readable text.` });
    }

    // A plain .txt upload is treated as a ready-made knowledge base, not
    // raw material — it's used as-is, with no AI call (and no AI cost).
    if (req.file.mimetype === "text/plain") {
      return res.status(200).json({
        success: true,
        content: text,
        source: { type: "file", filename: req.file.originalname },
        structured: false,
        truncated: false,
      });
    }

    if (await isAIQuotaExceeded(company.companyId)) {
      return res.status(402).json({ success: false, message: QUOTA_MESSAGE });
    }

    let built;
    try {
      built = await buildKnowledgeFromText({
        companyId: company.companyId,
        companyName: company.name,
        rawText: text,
        sourceLabel: req.file.originalname,
      });
    } catch (err) {
      if (err instanceof KnowledgeBuildError) {
        return res.status(502).json({ success: false, message: err.message });
      }
      throw err;
    }

    return res.status(200).json({
      success: true,
      content: built.content,
      source: { type: "file", filename: req.file.originalname },
      structured: true,
      truncated: built.truncatedSource,
    });
  } catch (error) {
    console.error("Generate Knowledge From File Error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate a knowledge base from this file." });
  }
};
