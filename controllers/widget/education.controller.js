import crypto from "node:crypto";
import EducationCategory from "../../models/education/category.model.js";
import EducationFAQ from "../../models/education/faq.model.js";
import EducationCourse from "../../models/education/course.model.js";
import EducationLead from "../../models/education/lead.model.js";
import ChatbotEducationConfig from "../../models/education/chatbotEducationConfig.model.js";
import { hasExpiredWidgetToken, sendTokenExpired } from "../../middleware/widgetSession.middleware.js";
import { resolvePublicEducationChatbot } from "../../services/education/educationWidgetAccess.service.js";

// ======================================================
// PUBLIC EDUCATION WIDGET API — same trust model as every other
// /api/widget/* endpoint: public, unauthenticated, chatbot-scoped by
// id from the URL, never trusts a client-supplied companyId. Only
// ever serves a chatbot's PUBLISHED config — a draft-only chatbot has
// nothing to show a real visitor yet.
// ======================================================

function generateReferenceId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const entropy = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `EDU-${stamp}-${entropy}`;
}

export const getEducationCategories = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolvePublicEducationChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const config = await ChatbotEducationConfig.findOne({ chatbotId: chatbot._id, status: "PUBLISHED" }).lean();
    if (!config || config.enabledCategoryKeys.length === 0) {
      return res.status(200).json({ success: true, categories: [], counsellingCtaLabel: "Get Free Counselling" });
    }
    const categories = await EducationCategory.find({ key: { $in: config.enabledCategoryKeys }, active: true }).sort({ label: 1 }).lean();
    return res.status(200).json({ success: true, categories, counsellingCtaLabel: config.counsellingCtaLabel || "Get Free Counselling" });
  } catch (error) {
    console.error("Get Education Categories Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load categories." });
  }
};

export const getEducationFaqs = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolvePublicEducationChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const config = await ChatbotEducationConfig.findOne({ chatbotId: chatbot._id, status: "PUBLISHED" }).lean();
    if (!config || config.enabledFAQIds.length === 0) return res.status(200).json({ success: true, faqs: [] });

    const filter = { _id: { $in: config.enabledFAQIds }, active: true };
    if (req.query.categoryKey) filter.categoryKey = req.query.categoryKey;
    const faqs = await EducationFAQ.find(filter).sort({ categoryKey: 1, order: 1 }).select("categoryKey question answer order").lean();
    return res.status(200).json({ success: true, faqs });
  } catch (error) {
    console.error("Get Education FAQs Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load FAQs." });
  }
};

export const getEducationCourses = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolvePublicEducationChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const config = await ChatbotEducationConfig.findOne({ chatbotId: chatbot._id, status: "PUBLISHED" }).lean();
    if (!config || config.enabledCourseIds.length === 0) return res.status(200).json({ success: true, courses: [] });

    const courses = await EducationCourse.find({ _id: { $in: config.enabledCourseIds }, active: true }).sort({ name: 1 }).select("name categoryKey duration feeRange eligibility description").lean();
    return res.status(200).json({ success: true, courses });
  } catch (error) {
    console.error("Get Education Courses Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load courses." });
  }
};

export const createLead = async (req, res) => {
  try {
    if (hasExpiredWidgetToken(req)) return sendTokenExpired(res);
    const chatbot = await resolvePublicEducationChatbot(req.params.chatbotId, req);
    if (!chatbot) return res.status(404).json({ success: false, message: "Chatbot not found." });

    const { name, phone, email, courseInterest, message } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: "name is required." });
    if (!phone && !email) return res.status(400).json({ success: false, message: "A phone number or email is required so we can follow up." });

    let referenceId;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      referenceId = generateReferenceId();
      // eslint-disable-next-line no-await-in-loop
      if (!(await EducationLead.exists({ referenceId }))) break;
    }

    const lead = await EducationLead.create({
      companyId: chatbot.companyId,
      chatbotId: chatbot._id,
      referenceId,
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : "",
      email: email ? String(email).trim().toLowerCase() : "",
      courseInterest: courseInterest ? String(courseInterest).trim() : "",
      message: message ? String(message).trim() : "",
      source: "widget",
    });

    return res.status(201).json({ success: true, lead: { referenceId: lead.referenceId, status: lead.status } });
  } catch (error) {
    console.error("Create Education Lead Error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit your request. Please try again." });
  }
};
