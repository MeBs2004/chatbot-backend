import crypto from "node:crypto";
import EnergySupplier from "../../models/energy/supplier.model.js";
import EnergyEnquiry from "../../models/energy/enquiry.model.js";
import EnergyJourneyFile from "../../models/energy/journeyFile.model.js";
import { hasExpiredWidgetToken, sendTokenExpired } from "../../middleware/widgetSession.middleware.js";
import { matchSuppliers } from "../../services/energy/supplierMatching.service.js";
import { resolvePublicEnergyChatbot as resolveEnergyChatbot } from "../../services/energy/energyWidgetAccess.service.js";
import { trackEnergyEvent } from "../../services/energy/energyAnalyticsTracking.service.js";

// ======================================================
// PUBLIC RFQ / SUPPLIER-MATCH API (Phase 4, Part 5/6/10) — same trust
// model as every other /api/widget/energy/* endpoint: public,
// unauthenticated, chatbot-scoped by ID from the URL. This is real,
// callable, tenant-isolated infrastructure today — what's NOT done
// yet is a live chat conversation actually calling it (that's Phase
// 5's job). Supplier contact details (email/phone/address/documents)
// are never returned here, before consent — only enough for a visitor
// to choose which supplier(s) they want their enquiry shared with.
// ======================================================

export const getSupplierMatches = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolveEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const { fuelKey, projectTypeId, region, location, requiredEquipment, visitorId, sessionId } = req.body || {};
    if (!fuelKey || !Array.isArray(requiredEquipment)) return res.status(400).json({ success: false, message: "fuelKey and a requiredEquipment array are required." });

    const canTrack = Boolean(visitorId && sessionId);
    if (canTrack) trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName: "energy_supplier_matching_requested", fuelKey: String(fuelKey).toLowerCase(), projectTypeId });

    const suppliers = await EnergySupplier.find({ companyId: chatbot.companyId, active: true }).select("name verificationStatus leadTimeDays supportedFuelKeys equipmentIds supportedProjectTypeIds serviceRegions").lean();
    // Phase 5.1: prefer the new structured location when the caller sends
    // one, fall back to the original free-text `region` otherwise —
    // matchSuppliers accepts either shape (see supplierMatching.service.js).
    const result = matchSuppliers(requiredEquipment, suppliers, { fuelKey: String(fuelKey).toLowerCase(), projectTypeId, region: location || region });

    if (canTrack) {
      trackEnergyEvent({
        companyId: chatbot.companyId,
        chatbotId: chatbot._id,
        visitorId,
        sessionId,
        eventName: "energy_supplier_matching_completed",
        fuelKey: String(fuelKey).toLowerCase(),
        projectTypeId,
        metadata: { matchedCount: Object.keys(result.matchesByEquipment).length, unmatchedCount: result.unmatchedEquipment.length },
      });
    }

    // Strip anything beyond what a visitor should see before giving consent.
    const sanitized = Object.fromEntries(
      Object.entries(result.matchesByEquipment).map(([eqId, matches]) => [eqId, matches.map((m) => ({ supplierId: m.supplierId, name: m.name, verificationStatus: m.verificationStatus, leadTimeDays: m.leadTimeDays, reasons: m.reasons }))])
    );
    return res.status(200).json({ success: true, result: { matchesByEquipment: sanitized, unmatchedEquipment: result.unmatchedEquipment } });
  } catch (error) {
    console.error("Public Supplier Match Error:", error);
    return res.status(500).json({ success: false, message: "Unable to find matching suppliers right now." });
  }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateReferenceId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const entropy = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `RFQ-${stamp}-${entropy}`;
}

export const createEnquiry = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolveEnergyChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const body = req.body || {};
    const customer = body.customer || {};
    if (!customer.name || !String(customer.name).trim()) return res.status(400).json({ success: false, field: "customer.name", message: "Your name is required." });
    if (!customer.email || !EMAIL_RE.test(customer.email)) return res.status(400).json({ success: false, field: "customer.email", message: "A valid email is required." });
    if (!body.fuelKey) return res.status(400).json({ success: false, field: "fuelKey", message: "fuelKey is required." });
    if (body.requiredEquipment !== undefined && !Array.isArray(body.requiredEquipment)) return res.status(400).json({ success: false, field: "requiredEquipment", message: "requiredEquipment must be an array." });

    const selectedSupplierIds = Array.isArray(body.selectedSupplierIds) ? body.selectedSupplierIds : [];
    if (selectedSupplierIds.length > 0) {
      // Part 6: never share with a supplier the customer hasn't actually consented to.
      if (!body.consent?.given) return res.status(400).json({ success: false, field: "consent", message: "Consent is required before selecting suppliers to share your enquiry with." });
      const validSuppliers = await EnergySupplier.countDocuments({ _id: { $in: selectedSupplierIds }, companyId: chatbot.companyId, active: true });
      if (validSuppliers !== new Set(selectedSupplierIds.map(String)).size) return res.status(400).json({ success: false, field: "selectedSupplierIds", message: "One or more selected suppliers are invalid." });
    }

    const visitorId = typeof body.visitorId === "string" ? body.visitorId.trim() : "";

    // Phase 5.1 — files are uploaded during the journey (before the
    // enquiry exists), so the body only carries their ids. Each one
    // must be a real, already-stored upload belonging to THIS chatbot
    // and THIS visitor — never trusted blind, and never another
    // tenant's file. Uploaded files are never auto-forwarded to a
    // supplier; only the enquiry's own owner (this company, via its
    // own admin panel) can see them unless/until it chooses to share.
    const uploadedFileIds = Array.isArray(body.uploadedFileIds) ? body.uploadedFileIds : [];
    let uploadedFiles = [];
    if (uploadedFileIds.length > 0) {
      if (!visitorId) return res.status(400).json({ success: false, field: "visitorId", message: "visitorId is required when attaching uploaded files." });
      const files = await EnergyJourneyFile.find({ _id: { $in: uploadedFileIds }, companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId }).select("questionId originalFilename contentType size").lean();
      if (files.length !== new Set(uploadedFileIds.map(String)).size) return res.status(400).json({ success: false, field: "uploadedFileIds", message: "One or more uploaded files are invalid." });
      uploadedFiles = files.map((f) => ({ fileId: f._id, questionId: f.questionId || null, filename: f.originalFilename, contentType: f.contentType, size: f.size }));
    }

    // Phase 5.2, Task 7 — idempotent submission. Scoped to
    // {companyId, chatbotId, visitorId, idempotencyKey} both in this
    // lookup and in the DB's own partial unique index (see
    // enquiry.model.js), so a different visitor can never be handed
    // back by reusing (or guessing) the same key — the query simply
    // won't match their document. A malformed/oversized key is
    // treated as "no key" rather than rejecting the whole submission.
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim().length > 0 && body.idempotencyKey.trim().length <= 100 ? body.idempotencyKey.trim() : null;
    if (idempotencyKey) {
      const existing = await EnergyEnquiry.findOne({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, idempotencyKey }).lean();
      if (existing) return res.status(200).json({ success: true, enquiry: { referenceId: existing.referenceId, status: existing.status }, idempotent: true });
    }

    // Structured location (Phase 5.1) is additive — the original
    // free-text projectLocation is preserved verbatim below regardless.
    const location = body.location && typeof body.location === "object" ? body.location : {};
    const normalizedLocation = {
      country: typeof location.country === "string" ? location.country.trim() : "",
      state: typeof location.state === "string" ? location.state.trim() : "",
      city: typeof location.city === "string" ? location.city.trim() : "",
      postalCode: typeof location.postalCode === "string" ? location.postalCode.trim() : "",
    };

    let referenceId;
    for (let attempt = 0; attempt < 5; attempt++) {
      referenceId = generateReferenceId();
      // eslint-disable-next-line no-await-in-loop
      if (!(await EnergyEnquiry.exists({ referenceId }))) break;
    }

    let enquiry;
    try {
      enquiry = await EnergyEnquiry.create({
        companyId: chatbot.companyId,
        chatbotId: chatbot._id,
        referenceId,
        visitorId,
        idempotencyKey,
        customer: { name: String(customer.name).trim(), companyName: customer.companyName || "", email: String(customer.email).trim().toLowerCase(), phone: customer.phone || "" },
        projectLocation: body.projectLocation || "",
        location: normalizedLocation,
        uploadedFiles,
        fuelKey: String(body.fuelKey).toLowerCase(),
        projectTypeId: body.projectTypeId || null,
        solutionTemplateId: body.solutionTemplateId || null,
        outputSnapshot: body.outputSnapshot || null,
        requiredEquipment: body.requiredEquipment || [],
        selectedSupplierIds,
        consent: {
          given: Boolean(body.consent?.given),
          givenAt: body.consent?.given ? new Date() : null,
          supplierIdsCovered: body.consent?.given ? selectedSupplierIds : [],
          consentText: body.consent?.consentText || "",
        },
        purchaseTimeline: body.purchaseTimeline || "",
        additionalRequirements: body.additionalRequirements || "",
        source: "widget",
        status: "new",
        statusHistory: [{ status: "new", changedBy: null, changedAt: new Date(), note: "Submitted by visitor." }],
      });
    } catch (createError) {
      // A concurrent request with the same idempotency key won this
      // race at the database level (E11000 on the partial unique
      // index) — return the winner's enquiry instead of a 500 or a
      // second record.
      if (createError?.code === 11000 && idempotencyKey) {
        const existing = await EnergyEnquiry.findOne({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, idempotencyKey }).lean();
        if (existing) return res.status(200).json({ success: true, enquiry: { referenceId: existing.referenceId, status: existing.status }, idempotent: true });
      }
      throw createError;
    }

    // Tracked here, never on the two idempotent-replay return paths
    // above — a duplicate submission must never inflate this count.
    // Awaited, not fire-and-forget — the RFQ-submission event is recorded
    // as part of this successful business operation itself, not left to
    // a best-effort background write (trackEnergyEvent never throws, so
    // this adds negligible latency and no new failure mode).
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    if (visitorId && sessionId) await trackEnergyEvent({ companyId: chatbot.companyId, chatbotId: chatbot._id, visitorId, sessionId, eventName: "energy_rfq_submitted", fuelKey: enquiry.fuelKey, projectTypeId: enquiry.projectTypeId, enquiryId: enquiry._id });

    return res.status(201).json({ success: true, enquiry: { referenceId: enquiry.referenceId, status: enquiry.status } });
  } catch (error) {
    console.error("Create Enquiry Error:", error);
    return res.status(500).json({ success: false, message: "Unable to submit your request right now." });
  }
};
