import multer from "multer";
import XLSX from "xlsx";
import EnergyEquipment from "../../models/energy/equipment.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import { loadAuthorizedEnergyChatbot, sharedOrOwn, escapeRegex } from "../../services/energy/energyAccess.service.js";
import { logAction } from "../../services/admin/audit.service.js";

// ======================================================
// EQUIPMENT CATALOGUE (Phase 2, Part B) — company-scoped, reusable
// across every Energy chatbot that company runs (see equipment.model.js
// header for why). Images/datasheets are stored as Buffers on the
// document and served through their own routes — list/detail reads
// always exclude the binary data itself (`-image.data -datasheet.data`),
// since `.lean()` bypasses the model's toJSON scrubbing.
// ======================================================

function validateEquipmentShape(body) {
  if (!body.name || !String(body.name).trim()) return "name is required.";
  if (!body.fuelKey || !String(body.fuelKey).trim()) return "fuelKey is required.";
  if (!body.category || !String(body.category).trim()) return "category is required.";
  if (body.capacityValue !== undefined && body.capacityValue !== null && !Number.isFinite(Number(body.capacityValue))) {
    return "capacityValue must be a number.";
  }
  if (body.price !== undefined && body.price !== null && (!Number.isFinite(Number(body.price)) || Number(body.price) < 0)) {
    return "price must be a non-negative number.";
  }
  return null;
}

async function findPossibleDuplicate(companyId, { manufacturer, modelNumber, name }, excludeId = null) {
  if (!manufacturer && !modelNumber) return null;
  const filter = { companyId, manufacturer, modelNumber, active: true };
  if (excludeId) filter._id = { $ne: excludeId };
  return EnergyEquipment.findOne(filter).select("_id name").lean();
}

export const listEquipment = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const filter = { companyId: ctx.chatbot.companyId };
    if (req.query.fuelKey) filter.fuelKey = req.query.fuelKey;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.projectTypeId) filter.supportedProjectTypeIds = req.query.projectTypeId;
    if (req.query.search) {
      const term = escapeRegex(req.query.search);
      filter.$or = [{ name: { $regex: term, $options: "i" } }, { manufacturer: { $regex: term, $options: "i" } }, { modelNumber: { $regex: term, $options: "i" } }];
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [items, total] = await Promise.all([
      EnergyEquipment.find(filter).select("-image.data -datasheet.data").sort({ fuelKey: 1, category: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      EnergyEquipment.countDocuments(filter),
    ]);
    return res.status(200).json({
      success: true,
      items: items.map((i) => ({ ...i, hasImage: Boolean(i.image?.contentType), hasDatasheet: Boolean(i.datasheet?.contentType), image: undefined, datasheet: undefined })),
      page,
      limit,
      total,
    });
  } catch (error) {
    console.error("List Equipment Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the equipment catalogue." });
  }
};

export const getEquipmentDetail = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const item = await EnergyEquipment.findOne({ _id: req.params.equipmentId, companyId: ctx.chatbot.companyId }).select("-image.data -datasheet.data").lean();
    if (!item) return res.status(404).json({ success: false, message: "Equipment not found." });
    return res.status(200).json({ success: true, item: { ...item, hasImage: Boolean(item.image?.contentType), hasDatasheet: Boolean(item.datasheet?.contentType), image: undefined, datasheet: undefined } });
  } catch (error) {
    console.error("Get Equipment Detail Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the equipment." });
  }
};

async function validateProjectTypeIds(companyId, fuelKey, ids) {
  if (!ids) return null;
  if (!Array.isArray(ids)) return "supportedProjectTypeIds must be an array.";
  if (ids.length === 0) return null;
  const count = await EnergyProjectType.countDocuments({ ...sharedOrOwn(companyId), fuelKey, _id: { $in: ids } });
  if (count !== new Set(ids.map(String)).size) return "One or more project types are invalid for this fuel.";
  return null;
}

export const createEquipment = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const shapeError = validateEquipmentShape(req.body || {});
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });

    const ptError = await validateProjectTypeIds(ctx.chatbot.companyId, req.body.fuelKey, req.body.supportedProjectTypeIds);
    if (ptError) return res.status(400).json({ success: false, message: ptError });

    const duplicate = await findPossibleDuplicate(ctx.chatbot.companyId, req.body);
    const item = await EnergyEquipment.create({
      companyId: ctx.chatbot.companyId,
      name: String(req.body.name).trim(),
      fuelKey: String(req.body.fuelKey).toLowerCase(),
      category: String(req.body.category).trim(),
      supportedProjectTypeIds: req.body.supportedProjectTypeIds || [],
      manufacturer: req.body.manufacturer || "",
      modelNumber: req.body.modelNumber || "",
      description: req.body.description || "",
      capacityValue: req.body.capacityValue ?? null,
      capacityUnit: req.body.capacityUnit || "",
      specs: req.body.specs && typeof req.body.specs === "object" ? req.body.specs : {},
      price: req.body.price ?? null,
      currency: req.body.currency || "INR",
      availability: ["in_stock", "made_to_order", "unavailable"].includes(req.body.availability) ? req.body.availability : "in_stock",
    });

    await logAction(req, { action: "ENERGY_EQUIPMENT_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { name: item.name } });
    return res.status(201).json({ success: true, item, duplicateWarning: duplicate ? `This looks similar to an existing item: "${duplicate.name}".` : null });
  } catch (error) {
    console.error("Create Equipment Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add the equipment." });
  }
};

export const updateEquipment = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const item = await EnergyEquipment.findOne({ _id: req.params.equipmentId, companyId: ctx.chatbot.companyId });
    if (!item) return res.status(404).json({ success: false, message: "Equipment not found." });

    const merged = { ...item.toObject(), ...req.body };
    const shapeError = validateEquipmentShape(merged);
    if (shapeError) return res.status(400).json({ success: false, message: shapeError });

    if (req.body.supportedProjectTypeIds !== undefined) {
      const ptError = await validateProjectTypeIds(ctx.chatbot.companyId, item.fuelKey, req.body.supportedProjectTypeIds);
      if (ptError) return res.status(400).json({ success: false, message: ptError });
    }

    const EDITABLE = ["name", "category", "supportedProjectTypeIds", "manufacturer", "modelNumber", "description", "capacityValue", "capacityUnit", "specs", "price", "currency", "availability", "active"];
    for (const field of EDITABLE) if (req.body[field] !== undefined) item[field] = req.body[field];
    await item.save();

    return res.status(200).json({ success: true, item });
  } catch (error) {
    console.error("Update Equipment Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the equipment." });
  }
};

export const deleteEquipment = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const result = await EnergyEquipment.deleteOne({ _id: req.params.equipmentId, companyId: ctx.chatbot.companyId });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: "Equipment not found." });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Equipment Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the equipment." });
  }
};

// ---------------- Image / datasheet upload & serve ----------------

const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
const MAX_DATASHEET_SIZE = 8 * 1024 * 1024;
const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE }, fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)) });
const datasheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DATASHEET_SIZE } });

function uploadMiddleware(multerInstance, maxSizeMb) {
  return (req, res, next) => {
    multerInstance.single("file")(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success: false, message: `File is too large (max ${maxSizeMb}MB).` });
      console.error("Equipment Upload Middleware Error:", err);
      return res.status(400).json({ success: false, message: "Upload failed." });
    });
  };
}
export const imageUploadMiddleware = uploadMiddleware(imageUpload, MAX_IMAGE_SIZE / (1024 * 1024));
export const datasheetUploadMiddleware = uploadMiddleware(datasheetUpload, MAX_DATASHEET_SIZE / (1024 * 1024));

function makeFileHandlers(field, { imageOnly = false } = {}) {
  return {
    upload: async (req, res) => {
      try {
        const ctx = await loadAuthorizedEnergyChatbot(req, res);
        if (!ctx) return;
        if (!req.file) return res.status(400).json({ success: false, message: "A file is required." });
        if (imageOnly && !/^image\//.test(req.file.mimetype)) return res.status(400).json({ success: false, message: "Only image files are accepted." });

        const item = await EnergyEquipment.findOneAndUpdate(
          { _id: req.params.equipmentId, companyId: ctx.chatbot.companyId },
          { $set: { [field]: { data: req.file.buffer, contentType: req.file.mimetype, filename: req.file.originalname } } },
          { new: true }
        ).select("_id");
        if (!item) return res.status(404).json({ success: false, message: "Equipment not found." });
        return res.status(200).json({ success: true });
      } catch (error) {
        console.error(`Upload ${field} Error:`, error);
        return res.status(500).json({ success: false, message: "Failed to upload the file." });
      }
    },
    serve: async (req, res) => {
      try {
        const ctx = await loadAuthorizedEnergyChatbot(req, res);
        if (!ctx) return;
        // Not .lean() — a Buffer path needs the real Mongoose cast, not
        // the raw BSON Binary a lean read would return (see the same
        // note on EnergyQuote's PDF field before this model existed).
        const item = await EnergyEquipment.findOne({ _id: req.params.equipmentId, companyId: ctx.chatbot.companyId }).select(field);
        if (!item?.[field]?.data) return res.status(404).json({ success: false, message: "File not found." });
        res.setHeader("Content-Type", item[field].contentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${item[field].filename || field}"`);
        return res.status(200).send(item[field].data);
      } catch (error) {
        console.error(`Serve ${field} Error:`, error);
        return res.status(500).json({ success: false, message: "Failed to fetch the file." });
      }
    },
  };
}
const imageHandlers = makeFileHandlers("image", { imageOnly: true });
const datasheetHandlers = makeFileHandlers("datasheet");
export const uploadEquipmentImage = imageHandlers.upload;
export const serveEquipmentImage = imageHandlers.serve;
export const uploadEquipmentDatasheet = datasheetHandlers.upload;
export const serveEquipmentDatasheet = datasheetHandlers.serve;

// ---------------- CSV / Excel import ----------------

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
export const csvUploadMiddleware = (req, res, next) => {
  csvUpload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success: false, message: "File is too large (max 2MB)." });
    console.error("Equipment CSV Upload Middleware Error:", err);
    return res.status(400).json({ success: false, message: "Upload failed." });
  });
};

function validateImportRow(fuelKey, row, rowIndex) {
  if (!row.name || !String(row.name).trim()) return { error: `Row ${rowIndex}: name is required.` };
  if (!row.category || !String(row.category).trim()) return { error: `Row ${rowIndex}: category is required.` };
  const price = row.price !== undefined && row.price !== "" ? Number(row.price) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0)) return { error: `Row ${rowIndex}: price must be a non-negative number.` };
  const capacityValue = row.capacityValue !== undefined && row.capacityValue !== "" ? Number(row.capacityValue) : null;
  if (row.capacityValue !== undefined && row.capacityValue !== "" && !Number.isFinite(capacityValue)) return { error: `Row ${rowIndex}: capacityValue must be a number.` };

  return {
    item: {
      fuelKey,
      name: String(row.name).trim(),
      category: String(row.category).trim(),
      manufacturer: String(row.manufacturer || "").trim(),
      modelNumber: String(row.modelNumber || "").trim(),
      description: String(row.description || "").trim(),
      capacityValue,
      capacityUnit: String(row.capacityUnit || "").trim(),
      price,
      currency: String(row.currency || "INR").trim() || "INR",
    },
  };
}

// Runs synchronously in the request, same scoping decision as every
// other bulk-import in this codebase (no job queue exists yet) — a
// 500-row equipment sheet is well within what one request can do.
export const importEquipmentCsv = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const fuelKey = req.body?.fuelKey;
    if (!fuelKey) return res.status(400).json({ success: false, message: "fuelKey is required." });
    if (!req.file) return res.status(400).json({ success: false, message: "A CSV or Excel file is required." });

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    } catch {
      return res.status(400).json({ success: false, message: "Couldn't read that file — make sure it's a valid CSV or XLSX export." });
    }
    if (rows.length === 0) return res.status(400).json({ success: false, message: "That file has no rows." });
    if (rows.length > 500) return res.status(400).json({ success: false, message: "A single import is limited to 500 rows." });

    const validated = [];
    const errors = [];
    rows.forEach((row, i) => {
      const { item, error } = validateImportRow(String(fuelKey).toLowerCase(), row, i + 2);
      if (error) errors.push(error);
      else validated.push(item);
    });
    if (errors.length > 0) return res.status(400).json({ success: false, message: "Some rows couldn't be imported.", errors, importedCount: 0 });

    // Duplicate detection within the batch itself (two rows claiming
    // the same manufacturer+model) — flagged, not blocked, since a
    // real catalogue sometimes legitimately repeats a model number
    // under a different category.
    const seen = new Map();
    const duplicateWarnings = [];
    for (const item of validated) {
      if (!item.manufacturer && !item.modelNumber) continue;
      const key = `${item.manufacturer}::${item.modelNumber}`;
      if (seen.has(key)) duplicateWarnings.push(`"${item.name}" shares manufacturer+model with "${seen.get(key)}" in this file.`);
      seen.set(key, item.name);
    }

    await EnergyEquipment.insertMany(validated.map((item) => ({ ...item, companyId: ctx.chatbot.companyId })));
    await logAction(req, { action: "ENERGY_EQUIPMENT_IMPORTED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { fuelKey, rowCount: validated.length } });
    return res.status(200).json({ success: true, importedCount: validated.length, duplicateWarnings });
  } catch (error) {
    console.error("Import Equipment CSV Error:", error);
    return res.status(500).json({ success: false, message: "Failed to import the equipment catalogue." });
  }
};
