import EducationCategory from "../../models/education/category.model.js";
import { logAction } from "../../services/admin/audit.service.js";

// ======================================================
// SUPER ADMIN — manages the PLATFORM-WIDE Education taxonomy: global
// FAQ categories. Mirrors energyDefaults.controller.js. Only ever
// touches companyId: null rows — a company's own custom categories/
// FAQs/courses live in the same collections but are managed through
// the chatbot-scoped endpoints in educationConfig.controller.js.
// ======================================================

const slugify = (label) =>
  String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

// Read-only, available to ANY authenticated admin — the shared platform
// catalog used by the Create Chatbot wizard's Education step before a
// chatbot (and therefore a chatbot-scoped company context) exists yet.
export const getPlatformEducationCatalog = async (req, res) => {
  try {
    const categories = await EducationCategory.find({ companyId: null, active: true }).sort({ label: 1 }).lean();
    return res.status(200).json({ success: true, categories });
  } catch (error) {
    console.error("Get Platform Education Catalog Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the Education catalog." });
  }
};

export const listCategories = async (req, res) => {
  try {
    const categories = await EducationCategory.find({ companyId: null }).sort({ label: 1 }).lean();
    return res.status(200).json({ success: true, categories });
  } catch (error) {
    console.error("List Education Categories Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load categories." });
  }
};

export const createCategory = async (req, res) => {
  try {
    const { label, description, icon } = req.body || {};
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ success: false, message: "label is required." });
    }
    const key = slugify(label);
    if (!key) return res.status(400).json({ success: false, message: "label must contain at least one letter or number." });

    const existing = await EducationCategory.findOne({ companyId: null, key }).lean();
    if (existing) return res.status(409).json({ success: false, message: "A category with this name already exists." });

    const category = await EducationCategory.create({ key, label: label.trim(), description: description || "", icon: icon || "FiHelpCircle", companyId: null });
    await logAction(req, { action: "EDUCATION_CATEGORY_CREATED", resource: "EducationCategory", resourceId: category._id });
    return res.status(201).json({ success: true, category });
  } catch (error) {
    console.error("Create Education Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the category." });
  }
};

export const updateCategory = async (req, res) => {
  try {
    const category = await EducationCategory.findOne({ _id: req.params.categoryId, companyId: null });
    if (!category) return res.status(404).json({ success: false, message: "Category not found." });

    const { label, description, icon, active } = req.body || {};
    if (label !== undefined) category.label = String(label).trim();
    if (description !== undefined) category.description = String(description);
    if (icon !== undefined) category.icon = String(icon);
    if (active !== undefined) category.active = Boolean(active);
    await category.save();

    await logAction(req, { action: "EDUCATION_CATEGORY_UPDATED", resource: "EducationCategory", resourceId: category._id });
    return res.status(200).json({ success: true, category });
  } catch (error) {
    console.error("Update Education Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the category." });
  }
};

export const deactivateCategory = async (req, res) => {
  try {
    const category = await EducationCategory.findOneAndUpdate({ _id: req.params.categoryId, companyId: null }, { $set: { active: false } }, { new: true });
    if (!category) return res.status(404).json({ success: false, message: "Category not found." });
    await logAction(req, { action: "EDUCATION_CATEGORY_DEACTIVATED", resource: "EducationCategory", resourceId: category._id });
    return res.status(200).json({ success: true, category });
  } catch (error) {
    console.error("Deactivate Education Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to deactivate the category." });
  }
};
