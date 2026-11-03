import EnergyFuelCategory from "../../models/energy/fuelCategory.model.js";
import EnergyProductService from "../../models/energy/productService.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import ChatbotEnergyConfig from "../../models/energy/chatbotEnergyConfig.model.js";
import SolutionTemplate from "../../models/energy/solutionTemplate.model.js";
import { logAction } from "../../services/admin/audit.service.js";
import { loadAuthorizedEnergyChatbot, sharedOrOwn } from "../../services/energy/energyAccess.service.js";

// ======================================================
// COMPANY-SCOPED Energy Configuration (Phase 1): a company's own
// fuel/product-service/project-type selections for one Energy
// chatbot, plus any custom additions that company has made. Every
// query here is filtered to `{ companyId: null }` (platform defaults)
// OR `{ companyId: ctx.chatbot.companyId }` (this company's own
// rows) — never any other tenant's custom data (Section 15/16:
// tenant isolation enforced server-side, not by frontend filtering).
// ======================================================

const slugify = (label) =>
  String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

// ---------------- Fuels ----------------

export const listAvailableFuels = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const [fuels, config] = await Promise.all([
      EnergyFuelCategory.find({ ...sharedOrOwn(ctx.chatbot.companyId), active: true }).sort({ group: 1, label: 1 }).lean(),
      ChatbotEnergyConfig.findOne({ chatbotId: ctx.chatbot._id }).lean(),
    ]);
    const enabledKeys = new Set(config?.enabledFuelKeys || []);
    return res.status(200).json({
      success: true,
      fuels: fuels.map((f) => ({ ...f, enabled: enabledKeys.has(f.key), isCustom: f.companyId !== null })),
    });
  } catch (error) {
    console.error("List Available Fuels Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load fuels." });
  }
};

export const createCustomFuel = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const { label, group, description, icon } = req.body || {};
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ success: false, message: "label is required." });
    }
    const key = slugify(label);
    if (!key) return res.status(400).json({ success: false, message: "label must contain at least one letter or number." });

    const existing = await EnergyFuelCategory.findOne({ companyId: ctx.chatbot.companyId, key }).lean();
    if (existing) return res.status(409).json({ success: false, message: "You already have a fuel/solution with this name." });

    const fuel = await EnergyFuelCategory.create({
      key,
      label: label.trim(),
      group: ["gas_fuel", "renewable", "power_storage", "other"].includes(group) ? group : "other",
      description: description || "",
      icon: icon || "FiZap",
      companyId: ctx.chatbot.companyId,
    });
    await logAction(req, { action: "ENERGY_CUSTOM_FUEL_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { key } });
    return res.status(201).json({ success: true, fuel: { ...fuel.toObject(), enabled: false, isCustom: true } });
  } catch (error) {
    console.error("Create Custom Fuel Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add the custom fuel/solution." });
  }
};

export const deleteCustomFuel = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const fuel = await EnergyFuelCategory.findOne({ _id: req.params.fuelId, companyId: ctx.chatbot.companyId });
    if (!fuel) return res.status(404).json({ success: false, message: "Custom fuel/solution not found." });
    await fuel.deleteOne();
    await ChatbotEnergyConfig.updateOne({ chatbotId: ctx.chatbot._id }, { $pull: { enabledFuelKeys: fuel.key } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Custom Fuel Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the custom fuel/solution." });
  }
};

// ---------------- Products/Services & Project Types (shared shape) ----------------

function offeringEndpoints(Model, configField) {
  return {
    list: async (req, res) => {
      try {
        const ctx = await loadAuthorizedEnergyChatbot(req, res);
        if (!ctx) return;
        const filter = { ...sharedOrOwn(ctx.chatbot.companyId), active: true };
        if (req.query.fuelKey) filter.fuelKey = req.query.fuelKey;
        const [items, config] = await Promise.all([
          Model.find(filter).sort({ fuelKey: 1, label: 1 }).lean(),
          ChatbotEnergyConfig.findOne({ chatbotId: ctx.chatbot._id }).lean(),
        ]);
        const enabledIds = new Set((config?.[configField] || []).map(String));
        return res.status(200).json({
          success: true,
          items: items.map((i) => ({ ...i, enabled: enabledIds.has(String(i._id)), isCustom: i.companyId !== null })),
        });
      } catch (error) {
        console.error("List Offering Error:", error);
        return res.status(500).json({ success: false, message: "Failed to load items." });
      }
    },
    create: async (req, res) => {
      try {
        const ctx = await loadAuthorizedEnergyChatbot(req, res);
        if (!ctx) return;
        const { fuelKey, label, description } = req.body || {};
        if (!fuelKey || !label || !String(label).trim()) {
          return res.status(400).json({ success: false, message: "fuelKey and label are required." });
        }
        const existing = await Model.findOne({ companyId: ctx.chatbot.companyId, fuelKey, label: String(label).trim() }).lean();
        if (existing) return res.status(409).json({ success: false, message: "This already exists for that fuel." });

        const item = await Model.create({ fuelKey: String(fuelKey).toLowerCase(), label: String(label).trim(), description: description || "", companyId: ctx.chatbot.companyId });
        return res.status(201).json({ success: true, item: { ...item.toObject(), enabled: false, isCustom: true } });
      } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: "This already exists for that fuel." });
        console.error("Create Offering Error:", error);
        return res.status(500).json({ success: false, message: "Failed to add the item." });
      }
    },
    remove: async (req, res) => {
      try {
        const ctx = await loadAuthorizedEnergyChatbot(req, res);
        if (!ctx) return;
        const item = await Model.findOne({ _id: req.params.itemId, companyId: ctx.chatbot.companyId });
        if (!item) return res.status(404).json({ success: false, message: "Custom item not found." });
        await item.deleteOne();
        await ChatbotEnergyConfig.updateOne({ chatbotId: ctx.chatbot._id }, { $pull: { [configField]: item._id } });
        return res.status(200).json({ success: true });
      } catch (error) {
        console.error("Delete Offering Error:", error);
        return res.status(500).json({ success: false, message: "Failed to delete the item." });
      }
    },
  };
}

const productServiceEndpoints = offeringEndpoints(EnergyProductService, "enabledProductServiceIds");
const projectTypeEndpoints = offeringEndpoints(EnergyProjectType, "enabledProjectTypeIds");

export const listProductServices = productServiceEndpoints.list;
export const createCustomProductService = productServiceEndpoints.create;
export const deleteCustomProductService = productServiceEndpoints.remove;

export const listProjectTypes = projectTypeEndpoints.list;
export const createCustomProjectType = projectTypeEndpoints.create;
export const deleteCustomProjectType = projectTypeEndpoints.remove;

// ---------------- Config (selections + publish) ----------------

export const getEnergyConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const config = (await ChatbotEnergyConfig.findOne({ chatbotId: ctx.chatbot._id }).lean()) || {
      enabledFuelKeys: [],
      enabledProductServiceIds: [],
      enabledProjectTypeIds: [],
      status: "DRAFT",
    };
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Get Energy Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the Energy configuration." });
  }
};

/** Only lets a chatbot select fuels/ids that are actually visible to it (global or its own) — never another tenant's custom rows, and never a fuel key nobody defined. */
async function validateSelection(companyId, { enabledFuelKeys, enabledProductServiceIds, enabledProjectTypeIds }) {
  if (enabledFuelKeys) {
    const validFuels = await EnergyFuelCategory.find({ ...sharedOrOwn(companyId), key: { $in: enabledFuelKeys } }).select("key").lean();
    if (validFuels.length !== new Set(enabledFuelKeys).size) return "One or more selected fuels/solutions are invalid.";
  }
  if (enabledProductServiceIds) {
    const count = await EnergyProductService.countDocuments({ ...sharedOrOwn(companyId), _id: { $in: enabledProductServiceIds } });
    if (count !== new Set(enabledProductServiceIds.map(String)).size) return "One or more selected products/services are invalid.";
  }
  if (enabledProjectTypeIds) {
    const count = await EnergyProjectType.countDocuments({ ...sharedOrOwn(companyId), _id: { $in: enabledProjectTypeIds } });
    if (count !== new Set(enabledProjectTypeIds.map(String)).size) return "One or more selected project types are invalid.";
  }
  return null;
}

export const updateEnergyConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const { enabledFuelKeys, enabledProductServiceIds, enabledProjectTypeIds } = req.body || {};

    for (const [name, val] of [["enabledFuelKeys", enabledFuelKeys], ["enabledProductServiceIds", enabledProductServiceIds], ["enabledProjectTypeIds", enabledProjectTypeIds]]) {
      if (val !== undefined && !Array.isArray(val)) return res.status(400).json({ success: false, message: `${name} must be an array.` });
    }
    const error = await validateSelection(ctx.chatbot.companyId, { enabledFuelKeys, enabledProductServiceIds, enabledProjectTypeIds });
    if (error) return res.status(400).json({ success: false, message: error });

    const update = { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id };
    if (enabledFuelKeys !== undefined) update.enabledFuelKeys = enabledFuelKeys;
    if (enabledProductServiceIds !== undefined) update.enabledProductServiceIds = enabledProductServiceIds;
    if (enabledProjectTypeIds !== undefined) update.enabledProjectTypeIds = enabledProjectTypeIds;

    // Publish safety (Phase 5, Section 8): this document IS what the
    // public widget reads directly — there's no separate snapshot
    // copy. So once published, an edit that actually changes the
    // selection must drop status back to DRAFT rather than silently
    // rewriting the live config visitors are already using. The admin
    // has to explicitly re-publish, same "approve again after a
    // change" principle as SolutionTemplate's versioning.
    const existing = await ChatbotEnergyConfig.findOne({ chatbotId: ctx.chatbot._id }).lean();
    const changesSelection = Object.keys(update).some((k) => k !== "companyId" && k !== "chatbotId");
    if (existing?.status === "PUBLISHED" && changesSelection) {
      update.status = "DRAFT";
      update.publishedAt = null;
    }

    // No $setOnInsert for `status` — setDefaultsOnInsert already applies
    // the schema's own DRAFT default on insert, and having the same
    // path in both $set and $setOnInsert is rejected by MongoDB as a
    // conflicting update when `update.status` is also set above.
    const config = await ChatbotEnergyConfig.findOneAndUpdate(
      { chatbotId: ctx.chatbot._id },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    await logAction(req, { action: "ENERGY_CONFIG_UPDATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Update Energy Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the Energy configuration." });
  }
};

// "Validate required configuration before publishing" (Section 3) —
// at minimum one fuel, and at least one product/service or project
// type so the published widget has something real to show.
// ======================================================
// TASK 5 — a company can legitimately publish before every enabled
// project type has an approved BOM template (Phase 5's journey
// already degrades gracefully to "collect an enquiry, no auto-BOM" in
// that case — see journey.controller.js's noTemplateConfigured path),
// so this is a WARNING, never a publish-blocking error. It exists so
// the admin finds out about the gap at configuration time instead of
// only noticing after a real customer hits it.
// ======================================================
async function computeMissingTemplateWarnings(companyId, config) {
  if (!config || config.enabledProjectTypeIds.length === 0) return [];
  const projectTypes = await EnergyProjectType.find({ _id: { $in: config.enabledProjectTypeIds }, ...sharedOrOwn(companyId) }).select("fuelKey label").lean();
  // Only project types whose own fuel is also actually enabled — an
  // enabled project type under a since-disabled fuel isn't reachable
  // by a visitor, so it's not worth warning about.
  const relevant = projectTypes.filter((pt) => config.enabledFuelKeys.includes(pt.fuelKey));
  if (relevant.length === 0) return [];

  const approvedTemplates = await SolutionTemplate.find({ companyId, projectTypeId: { $in: relevant.map((pt) => pt._id) }, status: "approved", active: true }).select("projectTypeId").lean();
  const projectTypeIdsWithTemplate = new Set(approvedTemplates.map((t) => String(t.projectTypeId)));

  return relevant
    .filter((pt) => !projectTypeIdsWithTemplate.has(String(pt._id)))
    .map((pt) => ({ fuelKey: pt.fuelKey, projectTypeId: pt._id, projectTypeLabel: pt.label }));
}

// GET — lets the admin UI show this BEFORE publishing (e.g. in a
// confirmation modal), not only after.
export const getPublishWarnings = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const config = await ChatbotEnergyConfig.findOne({ chatbotId: ctx.chatbot._id }).lean();
    const missingTemplates = await computeMissingTemplateWarnings(ctx.chatbot.companyId, config);
    return res.status(200).json({ success: true, warnings: { missingTemplates } });
  } catch (error) {
    console.error("Get Publish Warnings Error:", error);
    return res.status(500).json({ success: false, message: "Failed to check configuration warnings." });
  }
};

export const publishEnergyConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEnergyChatbot(req, res);
    if (!ctx) return;
    const config = await ChatbotEnergyConfig.findOne({ chatbotId: ctx.chatbot._id });
    if (!config || config.enabledFuelKeys.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one fuel or energy solution before publishing." });
    }
    if (config.enabledProductServiceIds.length === 0 && config.enabledProjectTypeIds.length === 0) {
      return res.status(400).json({ success: false, message: "Enable at least one product/service or project type before publishing." });
    }
    config.status = "PUBLISHED";
    config.publishedAt = new Date();
    await config.save();
    await logAction(req, { action: "ENERGY_CONFIG_PUBLISHED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });

    const missingTemplates = await computeMissingTemplateWarnings(ctx.chatbot.companyId, config);
    return res.status(200).json({ success: true, config, warnings: { missingTemplates } });
  } catch (error) {
    console.error("Publish Energy Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish the Energy configuration." });
  }
};
