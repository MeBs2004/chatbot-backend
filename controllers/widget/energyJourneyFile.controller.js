import crypto from "node:crypto";
import multer from "multer";
import EnergyQuestion from "../../models/energy/question.model.js";
import EnergyJourneyFile from "../../models/energy/journeyFile.model.js";
import { resolvePublicEnergyChatbot } from "../../services/energy/energyWidgetAccess.service.js";
import { DEFAULT_ALLOWED_MIME_TYPES, DEFAULT_MAX_SIZE_MB, HARD_MAX_SIZE_MB, validateFileSignature, safeFilenameForHeader } from "../../services/energy/fileUploadPolicy.service.js";

// ======================================================
// PHASE 5.1 — real file upload for "file"-type EnergyQuestions. Same
// multer memoryStorage + Buffer-in-Mongo pattern already established
// for equipment images/datasheets and supplier documents (see
// energyEquipment.controller.js / energySupplier.controller.js) —
// this codebase has no S3/cloud storage, so that IS "existing
// infrastructure," not a corner-cut taken for this phase.
//
// The browser-supplied filename is kept only as display metadata —
// it is NEVER used as a storage path or trusted for content type; the
// actual MIME is read from the upload itself (multer/the browser's
// Content-Type), and a server-generated `storageKey` is the only
// identifier handed back to the client.
//
// PHASE 5.2, TASK 8 — the claimed MIME type (`req.file.mimetype`) is
// still just what the browser said; `validateFileSignature` below
// additionally inspects the real bytes before anything is stored, so
// a file can't lie its way past the allowlist by spoofing its
// Content-Type. The allowed-type/size limits themselves now come from
// the shared fileUploadPolicy service (Task 6), so the admin-facing
// question config and this enforcement can never drift apart.
// ======================================================

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_MAX_SIZE_MB * 1024 * 1024 } });
export const journeyFileUploadMiddleware = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success: false, message: `File is too large (max ${HARD_MAX_SIZE_MB}MB).` });
    console.error("Journey File Upload Middleware Error:", err);
    return res.status(400).json({ success: false, message: "Upload failed." });
  });
};

export const uploadJourneyFile = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const visitorId = typeof req.body?.visitorId === "string" ? req.body.visitorId.trim() : "";
    if (!visitorId) return res.status(400).json({ success: false, message: "visitorId is required." });
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required." });

    // The question must be real, active, belong to this company, and
    // actually be a "file" question — never trust the browser's claim
    // about which question this answers.
    const question = await EnergyQuestion.findOne({ _id: req.params.questionId, companyId: chatbot.companyId, active: true, type: "file" }).lean();
    if (!question) return res.status(404).json({ success: false, message: "This question is not available for file upload." });

    const allowedTypes = question.allowedFileTypes?.length ? question.allowedFileTypes : DEFAULT_ALLOWED_MIME_TYPES;
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: `That file type isn't accepted here. Allowed: ${allowedTypes.join(", ")}.` });
    }
    const maxSizeMb = Math.min(question.maxFileSizeMb || DEFAULT_MAX_SIZE_MB, HARD_MAX_SIZE_MB);
    if (req.file.size > maxSizeMb * 1024 * 1024) {
      return res.status(400).json({ success: false, message: `File is too large (max ${maxSizeMb}MB for this question).` });
    }

    const signatureError = validateFileSignature(req.file.buffer, req.file.mimetype);
    if (signatureError) return res.status(400).json({ success: false, message: signatureError });

    const storageKey = crypto.randomUUID();
    const file = await EnergyJourneyFile.create({
      companyId: chatbot.companyId,
      chatbotId: chatbot._id,
      visitorId,
      questionId: question._id,
      storageKey,
      originalFilename: (req.file.originalname || "").slice(0, 255),
      contentType: req.file.mimetype,
      size: req.file.size,
      data: req.file.buffer,
    });

    return res.status(201).json({ success: true, fileId: file._id, filename: file.originalFilename, size: file.size, contentType: file.contentType });
  } catch (error) {
    console.error("Upload Journey File Error:", error);
    return res.status(500).json({ success: false, message: "Upload failed. Please try again." });
  }
};

/** GET /:chatbotId/journey/files/:fileId?visitorId= — a visitor can only ever re-fetch their OWN upload, from the chatbot's own company. */
export const serveJourneyFile = async (req, res) => {
  try {
    const chatbot = await resolvePublicEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });
    const visitorId = typeof req.query.visitorId === "string" ? req.query.visitorId.trim() : "";
    if (!visitorId) return res.status(403).json({ success: false, message: "Not authorized to view this file." });

    // Deliberately not .lean() — a Buffer path needs the real
    // Mongoose cast, not the raw BSON Binary a lean read returns (see
    // the identical note on EnergyEquipment's image/datasheet fields).
    const file = await EnergyJourneyFile.findOne({ _id: req.params.fileId, companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId });
    if (!file) return res.status(404).json({ success: false, message: "File not found." });

    // "attachment", never "inline" — an uploaded file's content isn't
    // trusted, so the browser must never try to render it in place
    // (e.g. an HTML file renamed to .pdf executing as a page).
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilenameForHeader(file.originalFilename)}"`);
    return res.status(200).send(file.data);
  } catch (error) {
    console.error("Serve Journey File Error:", error);
    return res.status(500).json({ success: false, message: "Unable to fetch the file." });
  }
};
