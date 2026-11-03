import EnergyAnalyticsEvent from "../../models/energy/analyticsEvent.model.js";
import EnergyEnquiry, { ENQUIRY_STATUSES } from "../../models/energy/enquiry.model.js";
import EnergyQuestion from "../../models/energy/question.model.js";
import EnergyFuelCategory from "../../models/energy/fuelCategory.model.js";
import EnergyProjectType from "../../models/energy/projectType.model.js";
import Conversation from "../../models/conversation.model.js";
import Visitor from "../../models/visitor.model.js";
import { sharedOrOwn } from "./energyAccess.service.js";

// ======================================================
// PHASE 6 — read side of Energy analytics: every number on the
// dashboard is a real aggregation against EnergyAnalyticsEvent (new,
// Phase-6-forward only) or an existing collection (EnergyEnquiry,
// Conversation, Visitor — reliable historically too). Nothing here is
// computed by loading full collections into memory; every query is a
// Mongo aggregation/count.
//
// FUNNEL COUNTING RULE: every funnel/demand number counts DISTINCT
// sessionId, never raw event rows — a visitor who retries a step (back
// button, a failed request, a page refresh) fires the event again but
// is still exactly one session at that step. See analyticsEvent.model.js.
//
// HISTORICAL DATA CAVEAT: EnergyAnalyticsEvent only has rows from the
// moment Phase 6 tracking was deployed — a date range entirely before
// that has zero events, which is the HONEST answer ("not tracked
// yet"), not a real zero. Every function that depends on this
// collection returns `trackedSince: null | Date` (the earliest event
// this company/chatbot actually has) so the UI can show "available
// from <date>" instead of implying historical completeness.
// ======================================================

async function getTrackedSince(companyId, chatbotId) {
  const earliest = await EnergyAnalyticsEvent.findOne({ companyId, chatbotId }).sort({ eventTimestamp: 1 }).select("eventTimestamp").lean();
  return earliest?.eventTimestamp || null;
}

function pct(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function dayBucket(match, field = "eventTimestamp") {
  return [
    { $match: match },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: "UTC" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];
}

/** Distinct-session count for one event name in range, optionally grouped by an extra field. */
async function distinctSessionCount(match) {
  const rows = await EnergyAnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: "$sessionId" } }, { $count: "n" }]);
  return rows[0]?.n || 0;
}

// ---------------- MODULE 1: Overview ----------------

export async function getOverviewAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const base = { companyId, chatbotId };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [
    visitorRows,
    conversationCount,
    journeySessions,
    solutionsGenerated,
    supplierMatchesCompleted,
    handoffCount,
    enquiryCount,
  ] = await Promise.all([
    EnergyAnalyticsEvent.aggregate([{ $match: { ...base, eventTimestamp: range } }, { $group: { _id: "$visitorId" } }, { $count: "n" }]),
    Conversation.countDocuments({ companyId, chatbotId, startedAt: range }),
    distinctSessionCount({ ...base, eventName: "energy_journey_started", eventTimestamp: range }),
    distinctSessionCount({ ...base, eventName: "energy_solution_generated", eventTimestamp: range }),
    distinctSessionCount({ ...base, eventName: "energy_supplier_matching_completed", eventTimestamp: range }),
    Conversation.countDocuments({ companyId, chatbotId, handoffAt: range }),
    EnergyEnquiry.countDocuments({ companyId, chatbotId, createdAt: range }),
  ]);

  const rfqConversionRate = pct(enquiryCount, journeySessions);

  return {
    trackedSince,
    metrics: {
      uniqueVisitors: visitorRows[0]?.n || 0,
      conversations: conversationCount,
      journeySessions,
      enquiries: enquiryCount,
      solutionsGenerated,
      supplierMatches: supplierMatchesCompleted,
      handoffRequests: handoffCount,
      rfqConversionRate,
    },
  };
}

/** Same metrics for the immediately preceding, equal-length range — used to compute each KPI's delta. */
export async function getOverviewComparison(scope, { since, until }) {
  const spanMs = until.getTime() - since.getTime();
  const prevUntil = since;
  const prevSince = new Date(since.getTime() - spanMs);
  return getOverviewAnalytics(scope, { since: prevSince, until: prevUntil });
}

function computeDelta(current, previous) {
  if (previous === 0 || previous === null || previous === undefined) return null;
  if (current === null || current === undefined) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function buildOverviewDeltas(current, previous) {
  const deltas = {};
  for (const key of Object.keys(current.metrics)) {
    if (key === "rfqConversionRate") continue; // a rate's own delta is a percentage of a percentage — not meaningful here, shown as-is instead.
    deltas[key] = computeDelta(current.metrics[key], previous.metrics[key]);
  }
  return deltas;
}

// ---------------- MODULE 2: Visitors ----------------

export async function getVisitorAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const base = { companyId, chatbotId };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [sessionRows, newVisitorCount, sessionsPerDay, journeyDurationAgg] = await Promise.all([
    EnergyAnalyticsEvent.aggregate([{ $match: { ...base, eventTimestamp: range } }, { $group: { _id: "$visitorId" } }, { $count: "n" }]),
    // "New" via the platform's own Visitor.firstVisit — company-level
    // attribution (Visitor has no chatbotId field; same documented
    // caveat as the general analytics.service.js).
    Visitor.countDocuments({ companyId, firstVisit: range }),
    EnergyAnalyticsEvent.aggregate(dayBucket({ ...base, eventName: "energy_journey_started", eventTimestamp: range })),
    // Reliable only when BOTH a start and a confirmation event exist for the same session.
    EnergyAnalyticsEvent.aggregate([
      { $match: { ...base, eventName: { $in: ["energy_journey_started", "energy_confirmation_displayed"] }, eventTimestamp: range } },
      { $group: { _id: "$sessionId", start: { $min: { $cond: [{ $eq: ["$eventName", "energy_journey_started"] }, "$eventTimestamp", null] } }, end: { $max: { $cond: [{ $eq: ["$eventName", "energy_confirmation_displayed"] }, "$eventTimestamp", null] } } } },
      { $match: { start: { $ne: null }, end: { $ne: null } } },
      { $project: { durationMs: { $subtract: ["$end", "$start"] } } },
      { $match: { durationMs: { $gte: 0 } } },
      { $group: { _id: null, avgMs: { $avg: "$durationMs" }, count: { $sum: 1 } } },
    ]),
  ]);

  const uniqueVisitors = sessionRows[0]?.n || 0;
  const journeySessionTotal = sessionsPerDay.reduce((sum, r) => sum + r.count, 0);

  return {
    trackedSince,
    metrics: {
      uniqueVisitors,
      newVisitors: newVisitorCount,
      journeySessions: journeySessionTotal,
      avgJourneyCompletionMinutes: journeyDurationAgg[0]?.count > 0 ? Number((journeyDurationAgg[0].avgMs / 60000).toFixed(1)) : null,
    },
    trends: { sessionsPerDay },
  };
}

// ---------------- MODULE 3: Fuel demand ----------------

export async function getFuelAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [selectionRows, fuelDefs] = await Promise.all([
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_fuel_selected", eventTimestamp: range, fuelKey: { $ne: null } } },
      { $group: { _id: { fuelKey: "$fuelKey", sessionId: "$sessionId" } } },
      { $group: { _id: "$_id.fuelKey", sessions: { $sum: 1 } } },
      { $sort: { sessions: -1 } },
    ]),
    EnergyFuelCategory.find(sharedOrOwn(companyId)).select("key label").lean(),
  ]);

  const labelByKey = Object.fromEntries(fuelDefs.map((f) => [f.key, f.label]));
  const total = selectionRows.reduce((sum, r) => sum + r.sessions, 0);

  const breakdown = selectionRows.map((r) => ({
    fuelKey: r._id,
    label: labelByKey[r._id] || r._id,
    sessions: r.sessions,
    sharePercent: pct(r.sessions, total),
  }));

  const trendRows = await EnergyAnalyticsEvent.aggregate([
    { $match: { companyId, chatbotId, eventName: "energy_fuel_selected", eventTimestamp: range, fuelKey: { $ne: null } } },
    { $group: { _id: { fuelKey: "$fuelKey", day: { $dateToString: { format: "%Y-%m-%d", date: "$eventTimestamp", timezone: "UTC" } }, sessionId: "$sessionId" } } },
    { $group: { _id: { fuelKey: "$_id.fuelKey", day: "$_id.day" }, count: { $sum: 1 } } },
    { $sort: { "_id.day": 1 } },
  ]);

  return {
    trackedSince,
    metrics: { totalSelections: total, mostRequested: breakdown[0]?.label || null },
    breakdown,
    trends: { byDay: trendRows.map((r) => ({ fuelKey: r._id.fuelKey, day: r._id.day, count: r.count })) },
  };
}

// ---------------- MODULE 4: Project type demand ----------------

export async function getProjectTypeAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const selectionRows = await EnergyAnalyticsEvent.aggregate([
    { $match: { companyId, chatbotId, eventName: "energy_project_type_selected", eventTimestamp: range, projectTypeId: { $ne: null } } },
    { $group: { _id: { projectTypeId: "$projectTypeId", sessionId: "$sessionId" } } },
    { $group: { _id: "$_id.projectTypeId", sessions: { $sum: 1 } } },
    { $sort: { sessions: -1 } },
  ]);

  const projectTypeIds = selectionRows.map((r) => r._id).filter(Boolean);
  // Phase 7 audit fix — a visitor-fired tracking event's projectTypeId is
  // never ownership-validated (see trackJourneyEvent), so without this
  // scope a foreign tenant's project-type _id could resolve to THEIR
  // label inside this company's own report. sharedOrOwn still allows
  // genuine platform-default project types to resolve normally.
  const projectTypes = projectTypeIds.length > 0 ? await EnergyProjectType.find({ _id: { $in: projectTypeIds }, ...sharedOrOwn(companyId) }).select("label fuelKey").lean() : [];
  const byId = Object.fromEntries(projectTypes.map((pt) => [String(pt._id), pt]));
  const total = selectionRows.reduce((sum, r) => sum + r.sessions, 0);

  const breakdown = selectionRows.map((r) => ({
    projectTypeId: r._id,
    label: byId[String(r._id)]?.label || "Unknown",
    fuelKey: byId[String(r._id)]?.fuelKey || null,
    sessions: r.sessions,
    sharePercent: pct(r.sessions, total),
  }));

  return {
    trackedSince,
    metrics: { totalSelections: total, mostRequested: breakdown[0]?.label || null },
    breakdown,
  };
}

// ---------------- MODULE 5: Journey funnel ----------------

const FUNNEL_STEPS = [
  { key: "journeyStarted", label: "Journey started", eventName: "energy_journey_started" },
  { key: "intentSelected", label: "Intent selected", eventName: "energy_intent_selected" },
  { key: "fuelSelected", label: "Fuel selected", eventName: "energy_fuel_selected" },
  { key: "projectTypeSelected", label: "Project type selected", eventName: "energy_project_type_selected" },
  { key: "questionsStarted", label: "Dynamic questions started", eventName: "energy_questions_started" },
  { key: "questionsCompleted", label: "Questions completed", eventName: "energy_questions_completed" },
  { key: "summaryReviewed", label: "Summary reviewed", eventName: "energy_summary_reviewed" },
  { key: "solutionGenerated", label: "Technical solution / BOM generated", eventName: "energy_solution_generated" },
  { key: "supplierMatchingCompleted", label: "Supplier matching completed", eventName: "energy_supplier_matching_completed" },
  { key: "supplierSelected", label: "Supplier selected", eventName: "energy_supplier_selected" },
  { key: "rfqSubmitted", label: "RFQ submitted", eventName: "energy_rfq_submitted" },
  { key: "confirmationDisplayed", label: "Confirmation displayed", eventName: "energy_confirmation_displayed" },
];

export async function getFunnelAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const counts = await Promise.all(FUNNEL_STEPS.map((step) => distinctSessionCount({ companyId, chatbotId, eventName: step.eventName, eventTimestamp: range })));

  const steps = FUNNEL_STEPS.map((step, i) => {
    const sessions = counts[i];
    const previousSessions = i === 0 ? sessions : counts[i - 1];
    return {
      key: step.key,
      label: step.label,
      sessions,
      dropOffFromPrevious: i === 0 ? 0 : Math.max(previousSessions - sessions, 0),
      conversionFromPrevious: i === 0 ? null : pct(sessions, previousSessions),
    };
  });

  const started = counts[0];
  const confirmed = counts[counts.length - 1];
  const rfqSubmitted = counts[FUNNEL_STEPS.findIndex((s) => s.key === "rfqSubmitted")];

  return {
    trackedSince,
    steps,
    overall: {
      journeyCompletionRate: pct(confirmed, started),
      rfqConversionRate: pct(rfqSubmitted, started),
    },
  };
}

// ---------------- MODULE 6: Dynamic question analytics ----------------

export async function getQuestionAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [displayedRows, answeredRows, unknownRows] = await Promise.all([
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_question_displayed", eventTimestamp: range, questionId: { $ne: null } } },
      { $group: { _id: { questionId: "$questionId", sessionId: "$sessionId" } } },
      { $group: { _id: "$_id.questionId", displayed: { $sum: 1 } } },
    ]),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_question_answered", eventTimestamp: range, questionId: { $ne: null } } },
      { $group: { _id: { questionId: "$questionId", sessionId: "$sessionId" } } },
      { $group: { _id: "$_id.questionId", answered: { $sum: 1 } } },
    ]),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_question_answered", eventTimestamp: range, questionId: { $ne: null }, "metadata.answeredWithUnknown": true } },
      { $group: { _id: { questionId: "$questionId", sessionId: "$sessionId" } } },
      { $group: { _id: "$_id.questionId", unknownCount: { $sum: 1 } } },
    ]),
  ]);

  const questionIds = [...new Set([...displayedRows.map((r) => String(r._id)), ...answeredRows.map((r) => String(r._id))])];
  // Phase 7 audit fix — same cross-tenant-label reasoning as the
  // project-type lookup above; EnergyQuestion has no shared/global
  // concept, so this is a plain companyId scope.
  const questions = questionIds.length > 0 ? await EnergyQuestion.find({ _id: { $in: questionIds }, companyId }).select("label type required").lean() : [];
  const questionById = Object.fromEntries(questions.map((q) => [String(q._id), q]));

  const displayedById = Object.fromEntries(displayedRows.map((r) => [String(r._id), r.displayed]));
  const answeredById = Object.fromEntries(answeredRows.map((r) => [String(r._id), r.answered]));
  const unknownById = Object.fromEntries(unknownRows.map((r) => [String(r._id), r.unknownCount]));

  const perQuestion = questionIds
    .map((id) => {
      const displayed = displayedById[id] || 0;
      const answered = answeredById[id] || 0;
      return {
        questionId: id,
        label: questionById[id]?.label || "Deleted question",
        type: questionById[id]?.type || null,
        required: questionById[id]?.required ?? null,
        displayed,
        answered,
        unansweredOrSkipped: Math.max(displayed - answered, 0),
        completionRate: pct(answered, displayed),
        unknownSelections: unknownById[id] || 0,
      };
    })
    .sort((a, b) => b.displayed - a.displayed);

  return {
    trackedSince,
    questions: perQuestion,
    fileUploadQuestions: perQuestion.filter((q) => q.type === "file"),
  };
}

// ---------------- MODULE 7: BOM / solution analytics ----------------

export async function getSolutionAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [generated, failed, reviewRequired, byTemplate, byFuel] = await Promise.all([
    distinctSessionCount({ companyId, chatbotId, eventName: "energy_solution_generated", eventTimestamp: range }),
    distinctSessionCount({ companyId, chatbotId, eventName: "energy_solution_generation_failed", eventTimestamp: range }),
    distinctSessionCount({ companyId, chatbotId, eventName: "energy_solution_generated", eventTimestamp: range, "metadata.requiresEngineeringReview": true }),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_solution_generated", eventTimestamp: range, solutionTemplateId: { $ne: null } } },
      { $group: { _id: { solutionTemplateId: "$solutionTemplateId", sessionId: "$sessionId" } } },
      { $group: { _id: "$_id.solutionTemplateId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_solution_generated", eventTimestamp: range, fuelKey: { $ne: null } } },
      { $group: { _id: { fuelKey: "$fuelKey", sessionId: "$sessionId" } } },
      { $group: { _id: "$_id.fuelKey", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const templateIds = byTemplate.map((r) => r._id);
  const templates = templateIds.length > 0 ? await (await import("../../models/energy/solutionTemplate.model.js")).default.find({ _id: { $in: templateIds } }).select("name fuelKey").lean() : [];
  const templateById = Object.fromEntries(templates.map((t) => [String(t._id), t]));

  return {
    trackedSince,
    metrics: {
      generated,
      failed,
      requiresEngineeringReview: reviewRequired,
      successRate: pct(generated, generated + failed),
    },
    mostGenerated: byTemplate.map((r) => ({ solutionTemplateId: r._id, name: templateById[String(r._id)]?.name || "Deleted template", count: r.count })),
    byFuel: byFuel.map((r) => ({ fuelKey: r._id, count: r.count })),
  };
}

// ---------------- MODULE 8: Supplier matching analytics ----------------

export async function getSupplierAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [requested, completedRows, byFuel, byProjectType] = await Promise.all([
    distinctSessionCount({ companyId, chatbotId, eventName: "energy_supplier_matching_requested", eventTimestamp: range }),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_supplier_matching_completed", eventTimestamp: range } },
      { $group: { _id: "$sessionId", matchedCount: { $max: "$metadata.matchedCount" }, unmatchedCount: { $max: "$metadata.unmatchedCount" } } },
    ]),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_supplier_matching_completed", eventTimestamp: range, fuelKey: { $ne: null } } },
      { $group: { _id: { fuelKey: "$fuelKey", sessionId: "$sessionId" }, matchedCount: { $max: "$metadata.matchedCount" } } },
      { $group: { _id: "$_id.fuelKey", requests: { $sum: 1 }, successes: { $sum: { $cond: [{ $gt: ["$matchedCount", 0] }, 1, 0] } } } },
    ]),
    EnergyAnalyticsEvent.aggregate([
      { $match: { companyId, chatbotId, eventName: "energy_supplier_matching_completed", eventTimestamp: range, projectTypeId: { $ne: null } } },
      { $group: { _id: { projectTypeId: "$projectTypeId", sessionId: "$sessionId" }, matchedCount: { $max: "$metadata.matchedCount" } } },
      { $group: { _id: "$_id.projectTypeId", requests: { $sum: 1 }, successes: { $sum: { $cond: [{ $gt: ["$matchedCount", 0] }, 1, 0] } } } },
    ]),
  ]);

  const completed = completedRows.length;
  const successful = completedRows.filter((r) => (r.matchedCount || 0) > 0).length;
  const noMatch = completed - successful;
  const totalMatchedSuppliers = completedRows.reduce((sum, r) => sum + (r.matchedCount || 0), 0);
  const totalUnmatchedEquipment = completedRows.reduce((sum, r) => sum + (r.unmatchedCount || 0), 0);

  return {
    trackedSince,
    metrics: {
      requested,
      completed,
      successful,
      noMatch,
      totalMatchedSuppliers,
      totalUnmatchedEquipment,
      successRate: pct(successful, completed),
    },
    byFuel: byFuel.map((r) => ({ fuelKey: r._id, requests: r.requests, successRate: pct(r.successes, r.requests) })),
    byProjectType: byProjectType.map((r) => ({ projectTypeId: r._id, requests: r.requests, successRate: pct(r.successes, r.requests) })),
    // Per-equipment match-rate breakdown would need equipment-level sub-events, not
    // captured by Phase 6 — documented limitation rather than a fabricated number.
    mostFrequentlyMatchedEquipmentAvailable: false,
  };
}

// ---------------- MODULE 9: RFQ / enquiry analytics ----------------

export async function getEnquiryAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };

  const [total, byStatusRaw, byFuel, byDay, recent, processingAgg] = await Promise.all([
    EnergyEnquiry.countDocuments({ companyId, chatbotId, createdAt: range }),
    EnergyEnquiry.aggregate([{ $match: { companyId, chatbotId, createdAt: range } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    EnergyEnquiry.aggregate([{ $match: { companyId, chatbotId, createdAt: range } }, { $group: { _id: "$fuelKey", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    EnergyEnquiry.aggregate(dayBucket({ companyId, chatbotId, createdAt: range }, "createdAt")),
    EnergyEnquiry.find({ companyId, chatbotId, createdAt: range }).select("referenceId customer.name fuelKey status createdAt").sort({ createdAt: -1 }).limit(10).lean(),
    // Average time from submission to a final status (won/lost/closed), from the enquiry's own auditable statusHistory.
    EnergyEnquiry.aggregate([
      { $match: { companyId, chatbotId, createdAt: range, status: { $in: ["won", "lost", "closed"] } } },
      { $project: { durationMs: { $subtract: [{ $arrayElemAt: ["$statusHistory.changedAt", -1] }, "$createdAt"] } } },
      { $match: { durationMs: { $gte: 0 } } },
      { $group: { _id: null, avgMs: { $avg: "$durationMs" }, count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = Object.fromEntries(ENQUIRY_STATUSES.map((s) => [s, 0]));
  byStatusRaw.forEach((r) => { byStatus[r._id] = r.count; });

  // By location: structured city when present, else the first 40 chars of the
  // legacy free-text field — grouping free text is best-effort, not geocoded.
  const byLocationRaw = await EnergyEnquiry.aggregate([
    { $match: { companyId, chatbotId, createdAt: range } },
    { $project: { locationLabel: { $cond: [{ $ne: ["$location.city", ""] }, "$location.city", { $substrCP: [{ $ifNull: ["$projectLocation", "Not provided"] }, 0, 40] }] } } },
    { $group: { _id: "$locationLabel", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  return {
    metrics: {
      total,
      new: byStatus.new,
      underReview: byStatus.under_review,
      supplierContacted: byStatus.supplier_contacted,
      quotationInProgress: byStatus.quotation_in_progress,
      quotationSent: byStatus.quotation_sent,
      won: byStatus.won,
      lost: byStatus.lost,
      closed: byStatus.closed,
      avgProcessingDays: processingAgg[0]?.count > 0 ? Number((processingAgg[0].avgMs / 86400000).toFixed(1)) : null,
    },
    byFuel: byFuel.map((r) => ({ fuelKey: r._id, count: r.count })),
    byLocation: byLocationRaw.map((r) => ({ location: r._id || "Not provided", count: r.count })),
    trends: { byDay },
    recent,
  };
}

// ---------------- MODULE 10: AI & human handoff analytics ----------------

export async function getAiHandoffAnalytics({ companyId, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const trackedSince = await getTrackedSince(companyId, chatbotId);

  const [aiRequests, aiPerDay, handoffCount, handoffPerDay, conversationsInRange] = await Promise.all([
    distinctSessionCount({ companyId, chatbotId, eventName: "energy_ai_assistance_requested", eventTimestamp: range }),
    EnergyAnalyticsEvent.aggregate(dayBucket({ companyId, chatbotId, eventName: "energy_ai_assistance_requested", eventTimestamp: range })),
    // Authoritative and historically reliable (Conversation.handoffAt predates Phase 6 tracking).
    Conversation.countDocuments({ companyId, chatbotId, handoffAt: range }),
    Conversation.aggregate(dayBucket({ companyId, chatbotId, handoffAt: range }, "handoffAt")),
    Conversation.countDocuments({ companyId, chatbotId, startedAt: range }),
  ]);

  return {
    trackedSince,
    metrics: {
      aiAssistanceRequests: aiRequests,
      humanHandoffRequests: handoffCount,
      handoffRate: pct(handoffCount, conversationsInRange),
    },
    trends: {
      aiRequestsPerDay: aiPerDay,
      handoffPerDay: handoffPerDay,
    },
    // Handoff reasons are free text entered by the visitor and are
    // intentionally never aggregated/displayed here — Section 10 of
    // the brief: "only if explicitly captured" as structured data, and
    // this platform only captures them as private free text.
    handoffReasonsAvailable: false,
  };
}
