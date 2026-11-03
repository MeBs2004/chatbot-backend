import EnergyEnquiry, { ENQUIRY_STATUSES } from "../../models/energy/enquiry.model.js";
import EnergySupplier from "../../models/energy/supplier.model.js";
import EnergyJourneyFile from "../../models/energy/journeyFile.model.js";
import { loadAuthorizedEnergyChatbot, escapeRegex } from "../../services/energy/energyAccess.service.js";
import { hasChatbotAccess } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { sendMail } from "../../services/mail.service.js";
import { safeFilenameForHeader } from "../../services/energy/fileUploadPolicy.service.js";
import { formatEnquiryLocation } from "../../services/energy/enquiryLocation.service.js";

// ======================================================
// RFQ / ENQUIRY MANAGEMENT — ADMIN SIDE (Phase 4, Part 7). Creation
// itself happens through the public widget endpoint
// (controllers/widget/energyEnquiry.controller.js) — this file is the
// Company Admin's dashboard: list/detail/status/notes/assignment.
// Status changes are appended to `statusHistory`, never just
// overwritten, so the workflow stays auditable (Part 7: "Keep status
// changes auditable").
// ======================================================

export const listEnquiries = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const filter = { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.fuelKey) filter.fuelKey = req.query.fuelKey;
    if (req.query.search) {
      const term = escapeRegex(req.query.search);
      filter.$or = [{ referenceId: { $regex: term, $options: "i" } }, { "customer.name": { $regex: term, $options: "i" } }, { "customer.email": { $regex: term, $options: "i" } }, { "customer.companyName": { $regex: term, $options: "i" } }];
    }
    if (req.query.dateFrom || req.query.dateTo) {
      filter.createdAt = {};
      if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) filter.createdAt.$lte = new Date(req.query.dateTo);
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const [enquiries, total, countsRaw] = await Promise.all([
      EnergyEnquiry.find(filter).select("-outputSnapshot").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      EnergyEnquiry.countDocuments(filter),
      EnergyEnquiry.aggregate([{ $match: { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    const counts = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, 0]));
    countsRaw.forEach((c) => { counts[c._id] = c.count; });
    counts.total = countsRaw.reduce((sum, c) => sum + c.count, 0);

    return res.status(200).json({ success: true, enquiries, page, limit, total, counts });
  } catch (error) {
    console.error("List Enquiries Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load enquiries." });
  }
};

export const getEnquiryDetail = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const enquiry = await EnergyEnquiry.findOne({ _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id })
      .populate("selectedSupplierIds", "name email phone verificationStatus")
      .populate("assignedTo", "name email")
      .lean();
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });
    return res.status(200).json({ success: true, enquiry });
  } catch (error) {
    console.error("Get Enquiry Detail Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the enquiry." });
  }
};

export const updateEnquiryStatus = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const { status, note } = req.body || {};
    if (!ENQUIRY_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${ENQUIRY_STATUSES.join(", ")}.` });

    const enquiry = await EnergyEnquiry.findOne({ _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id });
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });

    enquiry.status = status;
    enquiry.statusHistory.push({ status, changedBy: req.adminUser._id, changedAt: new Date(), note: note || "" });
    await enquiry.save();

    await logAction(req, { action: "ENERGY_ENQUIRY_STATUS_CHANGED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { enquiryId: enquiry._id, status } });
    return res.status(200).json({ success: true, enquiry });
  } catch (error) {
    console.error("Update Enquiry Status Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the enquiry status." });
  }
};

export const addEnquiryNote = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const text = (req.body?.text || "").trim();
    if (!text) return res.status(400).json({ success: false, message: "text is required." });
    const enquiry = await EnergyEnquiry.findOneAndUpdate(
      { _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id },
      { $push: { internalNotes: { authorId: req.adminUser._id, text, createdAt: new Date() } } },
      { new: true }
    );
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });
    return res.status(200).json({ success: true, enquiry });
  } catch (error) {
    console.error("Add Enquiry Note Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add the note." });
  }
};

// ======================================================
// Part 8 — supplier communication. Deliberately NOT automatic on
// enquiry creation: "Allow Company Admins to review the RFQ before
// sharing it with suppliers." An admin reviews, then explicitly
// triggers this. Reuses the existing mail service exactly as-is
// (services/mail.service.js) — if SMTP isn't configured, sendMail
// already reports `sent: false, reason: "not-configured"` rather than
// throwing, and this endpoint passes that honestly back to the caller
// instead of claiming success.
// ======================================================
export const notifySuppliers = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const enquiry = await EnergyEnquiry.findOne({ _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id });
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });
    if (!enquiry.consent.given) return res.status(400).json({ success: false, message: "This enquiry has no recorded customer consent — nothing can be shared with suppliers." });

    const consentedIds = (enquiry.consent.supplierIdsCovered || []).map(String);
    const suppliers = await EnergySupplier.find({ _id: { $in: consentedIds }, companyId: ctx.chatbot.companyId }).lean();
    if (suppliers.length === 0) return res.status(400).json({ success: false, message: "No consented suppliers to notify." });

    const results = [];
    for (const supplier of suppliers) {
      if (!supplier.email) {
        results.push({ supplierId: supplier._id, sent: false, reason: "no-email-on-file" });
        continue; // eslint-disable-line no-continue
      }
      const equipmentList = (enquiry.requiredEquipment || []).map((e) => `- ${e.name} (qty: ${e.qty ?? "—"} ${e.unit || ""})`).join("\n");
      const text = `New enquiry ${enquiry.referenceId}\n\nFuel: ${enquiry.fuelKey}\n\nProject Location:\n${formatEnquiryLocation(enquiry)}\n\nRequired equipment:\n${equipmentList || "(see attached details)"}\n\nPlease reply with your quotation.`;
      // eslint-disable-next-line no-await-in-loop
      const result = await sendMail({ to: supplier.email, subject: `RFQ ${enquiry.referenceId} — quotation requested`, text, html: `<pre>${text}</pre>` });
      results.push({ supplierId: supplier._id, supplierName: supplier.name, ...result });
    }

    const anySent = results.some((r) => r.sent);
    if (anySent) {
      enquiry.status = enquiry.status === "new" ? "supplier_contacted" : enquiry.status;
      enquiry.statusHistory.push({ status: enquiry.status, changedBy: req.adminUser._id, changedAt: new Date(), note: `Notified ${results.filter((r) => r.sent).length} supplier(s).` });
      await enquiry.save();
    }

    await logAction(req, { action: "ENERGY_ENQUIRY_SUPPLIERS_NOTIFIED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { enquiryId: enquiry._id, results } });
    return res.status(200).json({ success: true, results, enquiry });
  } catch (error) {
    console.error("Notify Suppliers Error:", error);
    return res.status(500).json({ success: false, message: "Failed to notify suppliers." });
  }
};

// ======================================================
// TASK 1 — RFQ attachment access for company admins. A visitor's
// upload lives in EnergyJourneyFile (Phase 5.1); the enquiry only
// ever holds a reference + metadata snapshot (uploadedFiles). Both
// endpoints below re-verify the SAME three things the task calls for:
// this company, this chatbot, AND that the specific fileId is really
// one this enquiry references — never just "any file this company
// owns," which would let an admin pull up a file from a different
// enquiry by guessing/iterating ids.
// ======================================================

export const listEnquiryAttachments = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const enquiry = await EnergyEnquiry.findOne({ _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id }).select("uploadedFiles").lean();
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });

    const fileIds = (enquiry.uploadedFiles || []).map((f) => f.fileId).filter(Boolean);
    // Upload timestamp isn't part of the enquiry's own snapshot (only
    // the filename/type/size are) — a best-effort lookup against the
    // source record for display only; a missing/deleted source file
    // still shows the rest of the metadata with uploadedAt: null.
    const fileDocs = fileIds.length > 0 ? await EnergyJourneyFile.find({ _id: { $in: fileIds } }).select("_id createdAt").lean() : [];
    const createdAtById = Object.fromEntries(fileDocs.map((d) => [String(d._id), d.createdAt]));

    const attachments = (enquiry.uploadedFiles || []).map((f) => ({
      fileId: f.fileId,
      questionId: f.questionId || null,
      filename: f.filename || "upload",
      contentType: f.contentType || "",
      size: f.size ?? null,
      uploadedAt: createdAtById[String(f.fileId)] || null,
    }));

    return res.status(200).json({ success: true, attachments });
  } catch (error) {
    console.error("List Enquiry Attachments Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load attachments." });
  }
};

export const downloadEnquiryAttachment = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const enquiry = await EnergyEnquiry.findOne({ _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id }).select("uploadedFiles").lean();
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });

    const reference = (enquiry.uploadedFiles || []).find((f) => String(f.fileId) === String(req.params.fileId));
    if (!reference) return res.status(404).json({ success: false, message: "This file isn't attached to this enquiry." });

    // Deliberately not .lean() — a Buffer field needs the real
    // Mongoose cast (see the identical note in energyJourneyFile.controller.js).
    const file = await EnergyJourneyFile.findOne({ _id: req.params.fileId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id });
    if (!file) return res.status(404).json({ success: false, message: "The uploaded file is no longer available." });

    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilenameForHeader(file.originalFilename || reference.filename)}"`);
    return res.status(200).send(file.data);
  } catch (error) {
    console.error("Download Enquiry Attachment Error:", error);
    return res.status(500).json({ success: false, message: "Failed to download the attachment." });
  }
};

export const assignEnquiry = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const assigneeId = req.body?.assignedTo || null;
    // Only assign to someone who actually has access to this chatbot —
    // reuses the existing access model rather than any new concept.
    if (assigneeId) {
      const allowed = await hasChatbotAccess({ _id: assigneeId }, ctx.chatbot._id).catch(() => false);
      if (!allowed) return res.status(400).json({ success: false, message: "That user doesn't have access to this chatbot." });
    }
    const enquiry = await EnergyEnquiry.findOneAndUpdate({ _id: req.params.enquiryId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id }, { $set: { assignedTo: assigneeId } }, { new: true });
    if (!enquiry) return res.status(404).json({ success: false, message: "Enquiry not found." });
    return res.status(200).json({ success: true, enquiry });
  } catch (error) {
    console.error("Assign Enquiry Error:", error);
    return res.status(500).json({ success: false, message: "Failed to assign the enquiry." });
  }
};
