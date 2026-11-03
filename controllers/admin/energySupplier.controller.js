import multer from "multer";
import EnergySupplier from "../../models/energy/supplier.model.js";
import EnergyEquipment from "../../models/energy/equipment.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import EnergyProductService from "../../models/energy/productService.model.js";
import { loadAuthorizedEnergyChatbot, sharedOrOwn, escapeRegex } from "../../services/energy/energyAccess.service.js";
import { matchSuppliers } from "../../services/energy/supplierMatching.service.js";
import { logAction } from "../../services/admin/audit.service.js";

// ======================================================
// SUPPLIER MANAGEMENT (Phase 4, Part 2/3) — company-scoped, same
// chatbot-URL-as-authorized-entry-point convention as every other
// Energy controller. Supplier<->equipment/project-type/product-service
// relationships reference existing company records; nothing here ever
// creates a duplicate equipment row.
// ======================================================

function validateSupplierShape(body) {
  if (!body.name || !String(body.name).trim()) return "name is required.";
  if (body.leadTimeDays !== undefined && body.leadTimeDays !== null && (!Number.isFinite(Number(body.leadTimeDays)) || Number(body.leadTimeDays) < 0)) return "leadTimeDays must be a non-negative number.";
  if (body.minOrderQty !== undefined && body.minOrderQty !== null && (!Number.isFinite(Number(body.minOrderQty)) || Number(body.minOrderQty) < 0)) return "minOrderQty must be a non-negative number.";
  return null;
}

async function validateReferences(companyId, body) {
  if (body.equipmentIds?.length) {
    const count = await EnergyEquipment.countDocuments({ companyId, _id: { $in: body.equipmentIds } });
    if (count !== new Set(body.equipmentIds.map(String)).size) return "One or more mapped equipment items are invalid for this company.";
  }
  if (body.supportedProjectTypeIds?.length) {
    const count = await EnergyProjectType.countDocuments({ ...sharedOrOwn(companyId), _id: { $in: body.supportedProjectTypeIds } });
    if (count !== new Set(body.supportedProjectTypeIds.map(String)).size) return "One or more project types are invalid.";
  }
  if (body.productServiceIds?.length) {
    const count = await EnergyProductService.countDocuments({ ...sharedOrOwn(companyId), _id: { $in: body.productServiceIds } });
    if (count !== new Set(body.productServiceIds.map(String)).size) return "One or more products/services are invalid.";
  }
  return null;
}

const EDITABLE_FIELDS = [
  "name", "contactPerson", "email", "phone", "website", "address", "city", "state", "country",
  "serviceRegions", "supportedFuelKeys", "supportedProjectTypeIds", "productServiceIds", "equipmentIds",
  "leadTimeDays", "minOrderQty", "active", "verificationStatus", "verificationNotes",
];

export const listSuppliers = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const filter = { companyId: ctx.chatbot.companyId };
    if (req.query.fuelKey) filter.supportedFuelKeys = req.query.fuelKey;
    if (req.query.equipmentId) filter.equipmentIds = req.query.equipmentId;
    if (req.query.projectTypeId) filter.supportedProjectTypeIds = req.query.projectTypeId;
    if (req.query.region) filter.serviceRegions = { $regex: `^${escapeRegex(req.query.region)}$`, $options: "i" };
    if (req.query.active !== undefined) filter.active = req.query.active === "true";
    if (req.query.search) {
      const term = escapeRegex(req.query.search);
      filter.$or = [{ name: { $regex: term, $options: "i" } }, { contactPerson: { $regex: term, $options: "i" } }, { email: { $regex: term, $options: "i" } }];
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [suppliers, total] = await Promise.all([
      EnergySupplier.find(filter).select("-documents.data").sort({ name: 1 }).skip((page - 1) * limit).limit(limit),
      EnergySupplier.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, suppliers: suppliers.map((s) => s.toJSON()), page, limit, total });
  } catch (error) {
    console.error("List Suppliers Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load suppliers." });
  }
};

export const getSupplierDetail = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const supplier = await EnergySupplier.findOne({ _id: req.params.supplierId, companyId: ctx.chatbot.companyId }).select("-documents.data");
    if (!supplier) return res.status(404).json({ success: false, message: "Supplier not found." });
    return res.status(200).json({ success: true, supplier: supplier.toJSON() });
  } catch (error) {
    console.error("Get Supplier Detail Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the supplier." });
  }
};

export const createSupplier = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const shapeError = validateSupplierShape(req.body || {});
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });
    const refError = await validateReferences(ctx.chatbot.companyId, req.body);
    if (refError) return res.status(400).json({ success: false, message: refError });

    const supplier = await EnergySupplier.create({
      companyId: ctx.chatbot.companyId,
      name: String(req.body.name).trim(),
      contactPerson: req.body.contactPerson || "",
      email: req.body.email || "",
      phone: req.body.phone || "",
      website: req.body.website || "",
      address: req.body.address || "",
      city: req.body.city || "",
      state: req.body.state || "",
      country: req.body.country || "",
      serviceRegions: req.body.serviceRegions || [],
      supportedFuelKeys: (req.body.supportedFuelKeys || []).map((k) => String(k).toLowerCase()),
      supportedProjectTypeIds: req.body.supportedProjectTypeIds || [],
      productServiceIds: req.body.productServiceIds || [],
      equipmentIds: req.body.equipmentIds || [],
      leadTimeDays: req.body.leadTimeDays ?? null,
      minOrderQty: req.body.minOrderQty ?? null,
      active: req.body.active !== undefined ? Boolean(req.body.active) : true,
      createdBy: req.adminUser._id,
    });

    await logAction(req, { action: "ENERGY_SUPPLIER_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { name: supplier.name } });
    return res.status(201).json({ success: true, supplier: supplier.toJSON() });
  } catch (error) {
    console.error("Create Supplier Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the supplier." });
  }
};

export const updateSupplier = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const supplier = await EnergySupplier.findOne({ _id: req.params.supplierId, companyId: ctx.chatbot.companyId });
    if (!supplier) return res.status(404).json({ success: false, message: "Supplier not found." });

    const merged = { ...supplier.toObject(), ...req.body };
    const shapeError = validateSupplierShape(merged);
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });
    const refError = await validateReferences(ctx.chatbot.companyId, merged);
    if (refError) return res.status(400).json({ success: false, message: refError });

    for (const field of EDITABLE_FIELDS) if (req.body[field] !== undefined) supplier[field] = req.body[field];
    await supplier.save();
    return res.status(200).json({ success: true, supplier: supplier.toJSON() });
  } catch (error) {
    console.error("Update Supplier Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the supplier." });
  }
};

export const deleteSupplier = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const result = await EnergySupplier.deleteOne({ _id: req.params.supplierId, companyId: ctx.chatbot.companyId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: "Supplier not found." });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Supplier Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the supplier." });
  }
};

// ---------------- Documents ----------------

const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
export const documentUploadMiddleware = (req, res, next) => {
  docUpload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success: false, message: "File is too large (max 8MB)." });
    console.error("Supplier Document Upload Middleware Error:", err);
    return res.status(400).json({ success: false, message: "Upload failed." });
  });
};

export const uploadSupplierDocument = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required." });
    const supplier = await EnergySupplier.findOneAndUpdate(
      { _id: req.params.supplierId, companyId: ctx.chatbot.companyId },
      { $push: { documents: { label: req.body?.label || req.file.originalname, data: req.file.buffer, contentType: req.file.mimetype, filename: req.file.originalname } } },
      { new: true }
    ).select("-documents.data");
    if (!supplier) return res.status(404).json({ success: false, message: "Supplier not found." });
    return res.status(200).json({ success: true, supplier: supplier.toJSON() });
  } catch (error) {
    console.error("Upload Supplier Document Error:", error);
    return res.status(500).json({ success: false, message: "Failed to upload the document." });
  }
};

export const serveSupplierDocument = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    // Not .lean()/toJSON-transformed — we need the real Buffer for this one document.
    const supplier = await EnergySupplier.findOne({ _id: req.params.supplierId, companyId: ctx.chatbot.companyId }).select("documents");
    const doc = supplier?.documents?.id ? supplier.documents.id(req.params.docId) : supplier?.documents?.find((d) => String(d._id) === req.params.docId);
    if (!doc?.data) return res.status(404).json({ success: false, message: "Document not found." });
    res.setHeader("Content-Type", doc.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename || "document"}"`);
    return res.status(200).send(doc.data);
  } catch (error) {
    console.error("Serve Supplier Document Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch the document." });
  }
};

export const deleteSupplierDocument = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const supplier = await EnergySupplier.findOneAndUpdate(
      { _id: req.params.supplierId, companyId: ctx.chatbot.companyId },
      { $pull: { documents: { _id: req.params.docId } } },
      { new: true }
    ).select("-documents.data");
    if (!supplier) return res.status(404).json({ success: false, message: "Supplier not found." });
    return res.status(200).json({ success: true, supplier: supplier.toJSON() });
  } catch (error) {
    console.error("Delete Supplier Document Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the document." });
  }
};

// ---------------- Matching preview (admin-side testing tool) ----------------

export const previewSupplierMatch = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const { fuelKey, projectTypeId, region, requiredEquipment } = req.body || {};
    if (!fuelKey || !Array.isArray(requiredEquipment)) return res.status(400).json({ success: false, message: "fuelKey and a requiredEquipment array are required." });

    const suppliers = await EnergySupplier.find({ companyId: ctx.chatbot.companyId, active: true }).select("-documents.data").lean();
    const result = matchSuppliers(requiredEquipment, suppliers, { fuelKey: String(fuelKey).toLowerCase(), projectTypeId, region });
    return res.status(200).json({ success: true, result });
  } catch (error) {
    console.error("Preview Supplier Match Error:", error);
    return res.status(500).json({ success: false, message: "Failed to compute supplier matches." });
  }
};
