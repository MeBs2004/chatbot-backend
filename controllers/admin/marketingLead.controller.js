import MarketingLead, { LEAD_STATUSES } from "../../models/marketing/lead.model.js";
import { loadAuthorizedMarketingChatbot } from "../../services/marketing/marketingAccess.service.js";
import { hasChatbotAccess } from "../../services/admin/access.service.js";
import { logAction } from "../../services/admin/audit.service.js";
import { escapeRegex } from "../../services/energy/energyAccess.service.js";

// ======================================================
// LEAD MANAGEMENT — ADMIN SIDE for Digital Marketing. Creation
// happens through the public widget endpoint
// (controllers/widget/marketing.controller.js) — this file is the
// Company Admin's dashboard. Mirrors educationLead.controller.js.
// ======================================================

export const listLeads = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const filter = { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      const term = escapeRegex(req.query.search);
      filter.$or = [{ referenceId: { $regex: term, $options: "i" } }, { name: { $regex: term, $options: "i" } }, { email: { $regex: term, $options: "i" } }, { phone: { $regex: term, $options: "i" } }, { companyName: { $regex: term, $options: "i" } }];
    }

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const [leads, total, countsRaw] = await Promise.all([
      MarketingLead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      MarketingLead.countDocuments(filter),
      MarketingLead.aggregate([{ $match: { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0]));
    countsRaw.forEach((c) => { counts[c._id] = c.count; });
    counts.total = countsRaw.reduce((sum, c) => sum + c.count, 0);

    return res.status(200).json({ success: true, leads, page, limit, total, counts });
  } catch (error) {
    console.error("List Marketing Leads Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load leads." });
  }
};

export const getLeadDetail = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const lead = await MarketingLead.findOne({ _id: req.params.leadId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id })
      .populate("assignedTo", "name email")
      .lean();
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    return res.status(200).json({ success: true, lead });
  } catch (error) {
    console.error("Get Marketing Lead Detail Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load the lead." });
  }
};

export const updateLeadStatus = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const { status } = req.body || {};
    if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${LEAD_STATUSES.join(", ")}.` });
    const lead = await MarketingLead.findOneAndUpdate({ _id: req.params.leadId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id }, { $set: { status } }, { new: true });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    await logAction(req, { action: "MARKETING_LEAD_STATUS_CHANGED", resource: "Chatbot", resourceId: ctx.chatbot._id, companyId: ctx.company.companyId, metadata: { leadId: lead._id, status } });
    return res.status(200).json({ success: true, lead });
  } catch (error) {
    console.error("Update Marketing Lead Status Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update the lead status." });
  }
};

export const assignLead = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const assigneeId = req.body?.assignedTo || null;
    if (assigneeId) {
      const allowed = await hasChatbotAccess({ _id: assigneeId }, ctx.chatbot._id).catch(() => false);
      if (!allowed) return res.status(400).json({ success: false, message: "That user doesn't have access to this chatbot." });
    }
    const lead = await MarketingLead.findOneAndUpdate({ _id: req.params.leadId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id }, { $set: { assignedTo: assigneeId } }, { new: true });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    return res.status(200).json({ success: true, lead });
  } catch (error) {
    console.error("Assign Marketing Lead Error:", error);
    return res.status(500).json({ success: false, message: "Failed to assign the lead." });
  }
};

export const addLeadNote = async (req, res) => {
  try {
    const ctx = await loadAuthorizedMarketingChatbot(req, res);
    if (!ctx) return;
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ success: false, message: "text is required." });
    const lead = await MarketingLead.findOne({ _id: req.params.leadId, companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found." });
    lead.internalNotes.push({ authorId: req.adminUser._id, text: String(text).trim(), createdAt: new Date() });
    await lead.save();
    return res.status(200).json({ success: true, lead });
  } catch (error) {
    console.error("Add Marketing Lead Note Error:", error);
    return res.status(500).json({ success: false, message: "Failed to add the note." });
  }
};
