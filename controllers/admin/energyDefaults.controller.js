import EnergyFuelCategory from "../../models/energy/fuelCategory.model.js";
import EnergyProductService from "../../models/energy/productService.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import { logAction } from "../../services/admin/audit.service.js";

// ======================================================
// SUPER ADMIN — manages the PLATFORM-WIDE Energy taxonomy (Section 14):
// global fuel categories, default products/services, default project
// types. Every endpoint here only ever touches companyId: null rows —
// a company's own custom additions live in the same collections but
// are managed through the chatbot-scoped endpoints in
// energyConfig.controller.js, never through here.
// ======================================================

const slugify = (label) =>
  String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

// Read-only, available to ANY authenticated admin (not SUPER_ADMIN-gated
// like the rest of this file) — this is just the shared platform
// catalog, used by the Create Chatbot wizard's Energy Configuration
// step before a chatbot (and therefore a chatbot-scoped company
// context) exists yet. No company-specific or custom data is ever
// returned here.
export const getPlatformEnergyCatalog = async (req, res) => {
  try {
    const [fuels, productServices, projectTypes] = await Promise.all([
      EnergyFuelCategory.find({ companyId: null, active: true }).sort({ group: 1, label: 1 }).lean(),
      EnergyProductService.find({ companyId: null, active: true }).sort({ fuelKey: 1, label: 1 }).lean(),
      EnergyProjectType.find({ companyId: null, active: true }).sort({ fuelKey: 1, label: 1 }).lean(),
    ]);
    return res.status(200).json({ success: true, fuels, productServices, projectTypes });
  } catch (error) {
    console.error("Get Platform Energy Catalog Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the Energy catalog." });
  }
};

export const listFuelCategories = async (req, res) => {
  try {
    const fuels = await EnergyFuelCategory.find({ companyId: null }).sort({ group: 1, label: 1 }).lean();
    return res.status(200).json({ success: true, fuels });
  } catch (error) {
    console.error("List Fuel Categories Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load fuel categories." });
  }
};

export const createFuelCategory = async (req, res) => {
  try {
    const { label, group, description, icon } = req.body || {};
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ success: false, message: "label is required." });
    }
    const key = slugify(label);
    if (!key) return res.status(400).json({ success: false, message: "label must contain at least one letter or number." });

    const existing = await EnergyFuelCategory.findOne({ companyId: null, key }).lean();
    if (existing) return res.status(409).json({ success: false, message: "A fuel category with this name already exists." });

    const fuel = await EnergyFuelCategory.create({
      key,
      label: label.trim(),
      group: ["gas_fuel", "renewable", "power_storage", "other"].includes(group) ? group : "other",
      description: description || "",
      icon: icon || "FiZap",
      companyId: null,
    });
    await logAction(req, { action: "ENERGY_FUEL_CATEGORY_CREATED", resource: "EnergyFuelCategory", resourceId: fuel._id });
    return res.status(201).json({ success: true, fuel });
  } catch (error) {
    console.error("Create Fuel Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the fuel category." });
  }
};

export const updateFuelCategory = async (req, res) => {
  try {
    const fuel = await EnergyFuelCategory.findOne({ _id: req.params.fuelId, companyId: null });
    if (!fuel) return res.status(404).json({ success: false, message: "Fuel category not found." });

    const { label, group, description, icon, active } = req.body || {};
    if (label !== undefined) fuel.label = String(label).trim();
    if (group !== undefined && ["gas_fuel", "renewable", "power_storage", "other"].includes(group)) fuel.group = group;
    if (description !== undefined) fuel.description = String(description);
    if (icon !== undefined) fuel.icon = String(icon);
    if (active !== undefined) fuel.active = Boolean(active);
    await fuel.save();

    await logAction(req, { action: "ENERGY_FUEL_CATEGORY_UPDATED", resource: "EnergyFuelCategory", resourceId: fuel._id });
    return res.status(200).json({ success: true, fuel });
  } catch (error) {
    console.error("Update Fuel Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the fuel category." });
  }
};

// Deactivates rather than deletes — companies already using this fuel
// keep their existing selection working; it simply stops being
// offered to anyone configuring a NEW chatbot (see the "active" filter
// in energyConfig.controller.js's listAvailableFuels).
export const deactivateFuelCategory = async (req, res) => {
  try {
    const fuel = await EnergyFuelCategory.findOneAndUpdate({ _id: req.params.fuelId, companyId: null }, { $set: { active: false } }, { new: true });
    if (!fuel) return res.status(404).json({ success: false, message: "Fuel category not found." });
    await logAction(req, { action: "ENERGY_FUEL_CATEGORY_DEACTIVATED", resource: "EnergyFuelCategory", resourceId: fuel._id });
    return res.status(200).json({ success: true, fuel });
  } catch (error) {
    console.error("Deactivate Fuel Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to deactivate the fuel category." });
  }
};

function offeringController(Model, label) {
  return {
    list: async (req, res) => {
      try {
        const filter = { companyId: null };
        if (req.query.fuelKey) filter.fuelKey = req.query.fuelKey;
        const items = await Model.find(filter).sort({ fuelKey: 1, label: 1 }).lean();
        return res.status(200).json({ success: true, items });
      } catch (error) {
        console.error(`List ${label} Error:`, error);
        return res.status(500).json({ success: false, message: `Failed to load ${label.toLowerCase()}.` });
      }
    },
    create: async (req, res) => {
      try {
        const { fuelKey, label: itemLabel, description } = req.body || {};
        if (!fuelKey || !itemLabel) return res.status(400).json({ success: false, message: "fuelKey and label are required." });
        const item = await Model.create({ fuelKey: String(fuelKey).toLowerCase(), label: String(itemLabel).trim(), description: description || "", companyId: null });
        await logAction(req, { action: `ENERGY_${label.toUpperCase()}_CREATED`, resource: Model.modelName, resourceId: item._id });
        return res.status(201).json({ success: true, item });
      } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: "This already exists for that fuel." });
        console.error(`Create ${label} Error:`, error);
        return res.status(500).json({ success: false, message: `Failed to add the ${label.toLowerCase()}.` });
      }
    },
    update: async (req, res) => {
      try {
        const item = await Model.findOne({ _id: req.params.itemId, companyId: null });
        if (!item) return res.status(404).json({ success: false, message: "Not found." });
        const { label: itemLabel, description, active } = req.body || {};
        if (itemLabel !== undefined) item.label = String(itemLabel).trim();
        if (description !== undefined) item.description = String(description);
        if (active !== undefined) item.active = Boolean(active);
        await item.save();
        return res.status(200).json({ success: true, item });
      } catch (error) {
        console.error(`Update ${label} Error:`, error);
        return res.status(500).json({ success: false, message: `Failed to update the ${label.toLowerCase()}.` });
      }
    },
    deactivate: async (req, res) => {
      try {
        const item = await Model.findOneAndUpdate({ _id: req.params.itemId, companyId: null }, { $set: { active: false } }, { new: true });
        if (!item) return res.status(404).json({ success: false, message: "Not found." });
        return res.status(200).json({ success: true, item });
      } catch (error) {
        console.error(`Deactivate ${label} Error:`, error);
        return res.status(500).json({ success: false, message: `Failed to deactivate the ${label.toLowerCase()}.` });
      }
    },
  };
}

const productServiceDefaults = offeringController(EnergyProductService, "Product/Service");
const projectTypeDefaults = offeringController(EnergyProjectType, "Project Type");

export const listDefaultProductServices = productServiceDefaults.list;
export const createDefaultProductService = productServiceDefaults.create;
export const updateDefaultProductService = productServiceDefaults.update;
export const deactivateDefaultProductService = productServiceDefaults.deactivate;

export const listDefaultProjectTypes = projectTypeDefaults.list;
export const createDefaultProjectType = projectTypeDefaults.create;
export const updateDefaultProjectType = projectTypeDefaults.update;
export const deactivateDefaultProjectType = projectTypeDefaults.deactivate;
