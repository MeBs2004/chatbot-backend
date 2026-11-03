import EducationCategory from "../../models/education/category.model.js";
import EducationFAQ from "../../models/education/faq.model.js";
import EducationCourse from "../../models/education/course.model.js";
import ChatbotEducationConfig from "../../models/education/chatbotEducationConfig.model.js";
import { logAction } from "../../services/admin/audit.service.js";
import { loadAuthorizedEducationChatbot, sharedOrOwn, escapeRegex } from "../../services/education/educationAccess.service.js";

// ======================================================
// COMPANY-SCOPED Education Configuration: a company's own category/
// FAQ/course selections for one Education chatbot, plus any custom
// additions. Every query is filtered to platform defaults OR this
// company's own rows — never any other tenant's. Mirrors
// energyConfig.controller.js's shape exactly.
// ======================================================

const slugify = (label) =>
  String(label)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

// ---------------- Categories ----------------

export const listAvailableCategories = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const [categories, config] = await Promise.all([
      EducationCategory.find({ ...sharedOrOwn(ctx.chatbot.companyId), active: true }).sort({ label: 1 }).lean(),
      ChatbotEducationConfig.findOne({ chatbotId: ctx.chatbot._id }).lean(),
    ]);
    const enabledKeys = new Set(config?.enabledCategoryKeys || []);
    return res.status(200).json({ success: true, categories: categories.map((c) => ({ ...c, enabled: enabledKeys.has(c.key), isCustom: c.companyId !== null })) });
  } catch (error) {
    console.error("List Available Education Categories Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load categories." });
  }
};

export const createCustomCategory = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const { label, description, icon } = req.body || {};
    if (!label || typeof label !== "string" || !label.trim()) {
      return res.status(400).json({ success: false, message: "label is required." });
    }
    const key = slugify(label);
    if (!key) return res.status(400).json({ success: false, message: "label must contain at least one letter or number." });

    const existing = await EducationCategory.findOne({ companyId: ctx.chatbot.companyId, key }).lean();
    if (existing) return res.status(409).json({ success: false, message: "You already have a category with this name." });

    const category = await EducationCategory.create({ key, label: label.trim(), description: description || "", icon: icon || "FiHelpCircle", companyId: ctx.chatbot.companyId });
    await logAction(req, { action: "EDUCATION_CUSTOM_CATEGORY_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { key } });
    return res.status(201).json({ success: true, category: { ...category.toObject(), enabled: false, isCustom: true } });
  } catch (error) {
    console.error("Create Custom Education Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add the custom category." });
  }
};

export const deleteCustomCategory = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const category = await EducationCategory.findOne({ _id: req.params.categoryId, companyId: ctx.chatbot.companyId });
    if (!category) return res.status(404).json({ success: false, message: "Custom category not found." });
    await category.deleteOne();
    await ChatbotEducationConfig.updateOne({ chatbotId: ctx.chatbot._id }, { $pull: { enabledCategoryKeys: category.key } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Custom Education Category Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the custom category." });
  }
};

// ---------------- FAQs ----------------

export const listFaqs = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const filter = { ...sharedOrOwn(ctx.chatbot.companyId) };
    if (req.query.categoryKey) filter.categoryKey = req.query.categoryKey;
    if (req.query.search) filter.question = { $regex: escapeRegex(req.query.search), $options: "i" };
    const [faqs, config] = await Promise.all([
      EducationFAQ.find(filter).sort({ categoryKey: 1, order: 1 }).lean(),
      ChatbotEducationConfig.findOne({ chatbotId: ctx.chatbot._id }).lean(),
    ]);
    const enabledIds = new Set((config?.enabledFAQIds || []).map(String));
    return res.status(200).json({ success: true, faqs: faqs.map((f) => ({ ...f, enabled: enabledIds.has(String(f._id)), isCustom: f.companyId !== null })) });
  } catch (error) {
    console.error("List Education FAQs Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load FAQs." });
  }
};

export const createFaq = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const { categoryKey, question, answer } = req.body || {};
    if (!categoryKey || !question || !String(question).trim() || !answer || !String(answer).trim()) {
      return res.status(400).json({ success: false, message: "categoryKey, question, and answer are required." });
    }
    const highestOrder = await EducationFAQ.findOne({ companyId: ctx.chatbot.companyId, categoryKey }).sort({ order: -1 }).select("order").lean();
    const faq = await EducationFAQ.create({
      companyId: ctx.chatbot.companyId,
      categoryKey: String(categoryKey).toLowerCase(),
      question: String(question).trim(),
      answer: String(answer).trim(),
      order: (highestOrder?.order ?? -1) + 1,
    });
    await logAction(req, { action: "EDUCATION_FAQ_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { categoryKey } });
    return res.status(201).json({ success: true, faq: { ...faq.toObject(), enabled: false, isCustom: true } });
  } catch (error) {
    console.error("Create Education FAQ Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the FAQ." });
  }
};

export const updateFaq = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const faq = await EducationFAQ.findOne({ _id: req.params.faqId, companyId: ctx.chatbot.companyId });
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
    const { question, answer, active } = req.body || {};
    if (question !== undefined) faq.question = String(question).trim();
    if (answer !== undefined) faq.answer = String(answer).trim();
    if (active !== undefined) faq.active = Boolean(active);
    await faq.save();
    return res.status(200).json({ success: true, faq });
  } catch (error) {
    console.error("Update Education FAQ Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the FAQ." });
  }
};

export const deleteFaq = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const faq = await EducationFAQ.findOne({ _id: req.params.faqId, companyId: ctx.chatbot.companyId });
    if (!faq) return res.status(404).json({ success: false, message: "FAQ not found." });
    await faq.deleteOne();
    await ChatbotEducationConfig.updateOne({ chatbotId: ctx.chatbot._id }, { $pull: { enabledFAQIds: faq._id } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Education FAQ Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the FAQ." });
  }
};

// ---------------- Courses ----------------

export const listCourses = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const filter = { ...sharedOrOwn(ctx.chatbot.companyId) };
    if (req.query.search) filter.name = { $regex: escapeRegex(req.query.search), $options: "i" };
    const [courses, config] = await Promise.all([
      EducationCourse.find(filter).sort({ name: 1 }).lean(),
      ChatbotEducationConfig.findOne({ chatbotId: ctx.chatbot._id }).lean(),
    ]);
    const enabledIds = new Set((config?.enabledCourseIds || []).map(String));
    return res.status(200).json({ success: true, courses: courses.map((c) => ({ ...c, enabled: enabledIds.has(String(c._id)), isCustom: c.companyId !== null })) });
  } catch (error) {
    console.error("List Education Courses Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load courses." });
  }
};

export const createCourse = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const { name, categoryKey, duration, feeRange, eligibility, description } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required." });
    const course = await EducationCourse.create({
      companyId: ctx.chatbot.companyId,
      name: String(name).trim(),
      categoryKey: categoryKey ? String(categoryKey).toLowerCase() : "",
      duration: duration || "",
      feeRange: feeRange || "",
      eligibility: eligibility || "",
      description: description || "",
    });
    await logAction(req, { action: "EDUCATION_COURSE_CREATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });
    return res.status(201).json({ success: true, course: { ...course.toObject(), enabled: false, isCustom: true } });
  } catch (error) {
    console.error("Create Education Course Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create the course." });
  }
};

export const updateCourse = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const course = await EducationCourse.findOne({ _id: req.params.courseId, companyId: ctx.chatbot.companyId });
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });
    const EDITABLE = ["name", "categoryKey", "duration", "feeRange", "eligibility", "description", "active"];
    for (const field of EDITABLE) if (req.body[field] !== undefined) course[field] = req.body[field];
    await course.save();
    return res.status(200).json({ success: true, course });
  } catch (error) {
    console.error("Update Education Course Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the course." });
  }
};

export const deleteCourse = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const course = await EducationCourse.findOne({ _id: req.params.courseId, companyId: ctx.chatbot.companyId });
    if (!course) return res.status(404).json({ success: false, message: "Course not found." });
    await course.deleteOne();
    await ChatbotEducationConfig.updateOne({ chatbotId: ctx.chatbot._id }, { $pull: { enabledCourseIds: course._id } });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Delete Education Course Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete the course." });
  }
};

// ---------------- Config (enable/disable + publish) ----------------

export const getEducationConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    let config = await ChatbotEducationConfig.findOne({ chatbotId: ctx.chatbot._id }).lean();
    if (!config) {
      config = { chatbotId: ctx.chatbot._id, companyId: ctx.chatbot.companyId, enabledCategoryKeys: [], enabledFAQIds: [], enabledCourseIds: [], status: "DRAFT", publishedAt: null };
    }
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Get Education Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the Education configuration." });
  }
};

export const updateEducationConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const { enabledCategoryKeys, enabledFAQIds, enabledCourseIds } = req.body || {};
    const update = { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id };
    if (Array.isArray(enabledCategoryKeys)) update.enabledCategoryKeys = enabledCategoryKeys;
    if (Array.isArray(enabledFAQIds)) update.enabledFAQIds = enabledFAQIds;
    if (Array.isArray(enabledCourseIds)) update.enabledCourseIds = enabledCourseIds;

    const config = await ChatbotEducationConfig.findOneAndUpdate(
      { chatbotId: ctx.chatbot._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logAction(req, { action: "EDUCATION_CONFIG_UPDATED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Update Education Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the Education configuration." });
  }
};

export const publishEducationConfig = async (req, res) => {
  try {
    const ctx = await loadAuthorizedEducationChatbot(req, res);
    if (!ctx) return;
    const config = await ChatbotEducationConfig.findOne({ chatbotId: ctx.chatbot._id });
    if (!config || config.enabledCategoryKeys.length === 0) {
      return res.status(400).json({ success: false, message: "Enable at least one category before publishing." });
    }
    config.status = "PUBLISHED";
    config.publishedAt = new Date();
    await config.save();
    await logAction(req, { action: "EDUCATION_CONFIG_PUBLISHED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId });
    return res.status(200).json({ success: true, config });
  } catch (error) {
    console.error("Publish Education Config Error:", error);
    return res.status(500).json({ success: false, message: "Failed to publish the Education configuration." });
  }
};
