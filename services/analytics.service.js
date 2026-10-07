import Visitor from "../models/visitor.model.js";
import UserMessage from "../models/user.model.js";
import Bot from "../models/bot.model.js";
import Conversation from "../models/conversation.model.js";
import Chatbot from "../models/chatbot.model.js";
import { getAccessibleCompanyIds, hasChatbotAccess } from "./admin/access.service.js";
// ======================================================
// ANALYTICS SERVICE (Phase 9)
// The one place every metric is actually calculated — both
// controllers/admin/analytics.controller.js (the Analytics
// workspace) and controllers/admin/dashboard.controller.js (the
// Dashboard's trend chart) call these same functions, so the two
// pages can never silently disagree on what "Visitors" or
// "Conversations" means for the same range (Section 32/33).
//
// ACTIVE VISITOR ("Visitors" metric): a distinct visitorId with at
// least one inbound message (User collection) in the range.
// NEW VISITOR: Visitor.firstVisit falls inside the range.
// RETURNING VISITOR: an active visitor (per above) whose
// Visitor.firstVisit is BEFORE the range start.
// CONVERSATION (in range): Conversation.startedAt falls inside the
// range — this is when the conversation record itself began, not
// when it was last touched.
// AI CONVERSATION: a conversation in range that has never had a
// human handoff (handoffAt is null) — i.e. purely AI-handled so far.
// HUMAN HANDOFF (in range): Conversation.handoffAt falls inside the
// range — the moment the conversation actually escalated, not just
// "currently in HUMAN mode".
// CLOSED / OPEN: CLOSED = Conversation.closedAt falls inside the
// range. OPEN is a CURRENT snapshot (status === "OPEN" right now),
// deliberately not range-bound — mixing the two would misrepresent
// what "open" means (see Section 16).
//
// TIMEZONE: every boundary below is computed and stored in UTC.
// MongoDB Date fields are always UTC internally; date-range
// arithmetic here (`since`/`until`) uses plain `Date` objects with no
// local-timezone conversion, and day-bucketed trends group with
// `$dateToString(..., timezone: "UTC")` explicitly. The admin panel
// does not yet offer a per-viewer timezone preference — "Today"
// means "today in UTC" today. Documented, not hidden.
//
// CHATBOT ATTRIBUTION CAVEAT: `Visitor`/`UserMessage`/`Bot` records
// only ever store `companyId`, never `chatbotId` — that field simply
// doesn't exist on those collections (see Phase 9 audit). When a
// `chatbotId` filter is requested, visitor/message metrics are
// necessarily attributed at the COMPANY level, which is only exactly
// accurate for a company with a single Chatbot record (the same
// "exactly one chatbot per company" assumption every prior phase's
// public-pipeline resolver already relies on). `Conversation`
// documents DO store a real `chatbotId` (Phase 8), so
// conversation/handoff/message-volume-via-conversation metrics ARE
// exactly attributable. This asymmetry is called out in the
// analytics API's response (`scope.chatbotAttributionExact`).
// ======================================================

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_THRESHOLD_MS = 15 * 60 * 1000; // "Active" visitor = seen in the last 15 minutes

export class AnalyticsAuthError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolves and validates a date range from either an explicit
 * start/end pair or a rolling `days` preset. Always returns
 * plain-Date UTC-instant boundaries; `until` is exclusive.
 */
export function resolveDateRange({ days, startDate, endDate }) {
  if (startDate || endDate) {
    const since = startDate ? new Date(startDate) : null;
    const until = endDate ? new Date(new Date(endDate).getTime() + DAY_MS) : new Date();
    if (!since || Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
      throw new AnalyticsAuthError("Invalid startDate/endDate.", 400);
    }
    if (until <= since) {
      throw new AnalyticsAuthError("endDate must be after startDate.", 400);
    }
    if (until.getTime() - since.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new AnalyticsAuthError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`, 400);
    }
    return { since, until, days: Math.round((until - since) / DAY_MS) };
  }

  const resolvedDays = Math.min(Math.max(parseInt(days) || 30, 1), 90);
  const until = new Date();
  const since = new Date(until.getTime() - resolvedDays * DAY_MS);
  return { since, until, days: resolvedDays };
}

/**
 * Resolves the authorized {companyFilter, chatbotId, chatbotAttributionExact}
 * scope for an analytics/visitors request. Never trusts `companyId`/
 * `chatbotId` beyond re-validating them against the authenticated
 * user's real access on every call.
 */
export async function resolveAnalyticsScope(requester, { companyId, chatbotId } = {}) {
  const accessibleIds = await getAccessibleCompanyIds(requester);

  if (chatbotId) {
    if (!(await hasChatbotAccess(requester, chatbotId))) {
      throw new AnalyticsAuthError("You don't have permission to access this resource.");
    }
    const chatbot = await Chatbot.findById(chatbotId).select("companyId").lean();
    if (!chatbot) throw new AnalyticsAuthError("Chatbot not found.", 404);

    const siblingCount = await Chatbot.countDocuments({ companyId: chatbot.companyId, deletedAt: null });
    return {
      companyFilter: { companyId: chatbot.companyId },
      chatbotId,
      chatbotAttributionExact: false,
      note:
        siblingCount === 1
          ? null
          : "This company has multiple chatbots; visitor/message totals are company-wide, not exactly attributable to this one chatbot (conversation-based metrics ARE exact).",
    };
  }

  if (companyId) {
    if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
      throw new AnalyticsAuthError("You don't have permission to access this resource.");
    }
    return { companyFilter: { companyId }, chatbotId: null, chatbotAttributionExact: true, note: null };
  }

  if (accessibleIds !== null) {
    return { companyFilter: { companyId: { $in: accessibleIds } }, chatbotId: null, chatbotAttributionExact: true, note: null };
  }

  return { companyFilter: {}, chatbotId: null, chatbotAttributionExact: true, note: null };
}

function dayBucketPipeline(match, dateField = "createdAt") {
  return [
    { $match: match },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: `$${dateField}`, timezone: "UTC" } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ];
}
/**
 * The full metrics + trends payload for a resolved scope/range.
 * Every number here is a real aggregation result — nothing is
 * computed in a JS loop over fully-fetched documents.
 */
export async function computeAnalytics({ companyFilter, chatbotId }, { since, until }) {
  const range = { $gte: since, $lt: until };
  const convFilter = { ...companyFilter, ...(chatbotId ? { chatbotId } : {}) };

  const [
    activeVisitorAgg,
    newVisitors,
    conversationsInRange,
    aiConversationsInRange,
    handoffsInRange,
    closedInRange,
    openNow,
    userMsgsInRange,
    botMsgsInRange,
    closedDurationAgg,
    visitorsPerDay,
    conversationsPerDay,
    userMessagesPerDay,
    botMessagesPerDay,
    aiVsHumanAgg,
  ] = await Promise.all([
    UserMessage.aggregate([
      { $match: { ...companyFilter, createdAt: range } },
      { $group: { _id: { companyId: "$companyId", visitorId: "$visitorId" } } },
    ]),
    Visitor.countDocuments({ ...companyFilter, firstVisit: range }),
    Conversation.countDocuments({ ...convFilter, startedAt: range }),
    Conversation.countDocuments({ ...convFilter, startedAt: range, handoffAt: null }),
    Conversation.countDocuments({ ...convFilter, handoffAt: range }),
    Conversation.countDocuments({ ...convFilter, closedAt: range }),
    Conversation.countDocuments({ ...convFilter, status: "OPEN" }),
    UserMessage.countDocuments({ ...companyFilter, createdAt: range }),
    Bot.countDocuments({ ...companyFilter, createdAt: range }),
    Conversation.aggregate([
      { $match: { ...convFilter, closedAt: range } },
      { $project: { durationMs: { $subtract: ["$closedAt", "$startedAt"] } } },
      { $group: { _id: null, avgMs: { $avg: "$durationMs" }, count: { $sum: 1 } } },
    ]),
    UserMessage.aggregate(
      dayBucketPipeline({ ...companyFilter, createdAt: range })
    ),
    Conversation.aggregate(dayBucketPipeline({ ...convFilter, startedAt: range }, "startedAt")),
    UserMessage.aggregate(dayBucketPipeline({ ...companyFilter, createdAt: range })),
    Bot.aggregate(dayBucketPipeline({ ...companyFilter, createdAt: range })),
    Bot.aggregate([
      { $match: { ...companyFilter, createdAt: range, type: { $in: ["ai", "flow", "agent"] } } },
      {
        $group: {
          _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } }, isAgent: { $eq: ["$type", "agent"] } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const activeVisitorIds = activeVisitorAgg.map((v) => v._id);
  const activeVisitorCount = activeVisitorIds.length;

  // visitorId is a crypto.randomUUID() (see the public widget), so a
  // cross-company collision that would make this $in imprecise for a
  // multi-company (SUPER_ADMIN) scope is not a realistic concern —
  // the alternative (one exact companyId+visitorId $or clause per
  // active visitor) doesn't scale and isn't worth it for that.
  const returningVisitors =
    activeVisitorCount === 0
      ? 0
      : await Visitor.countDocuments({
          ...companyFilter,
          firstVisit: { $lt: since },
          visitorId: { $in: activeVisitorIds.map((v) => v.visitorId) },
        });

  const totalMessagesInRange = userMsgsInRange + botMsgsInRange;

  const avgMessagesPerConversation =
    conversationsInRange > 0 ? Number((totalMessagesInRange / conversationsInRange).toFixed(1)) : null;

  const avgConversationDurationMinutes =
    closedDurationAgg[0]?.count > 0 ? Number((closedDurationAgg[0].avgMs / 60000).toFixed(1)) : null;

  const humanHandoffRate =
    conversationsInRange > 0 ? Number(((handoffsInRange / conversationsInRange) * 100).toFixed(1)) : null;

  const returningVisitorRate =
    activeVisitorCount > 0 ? Number(((returningVisitors / activeVisitorCount) * 100).toFixed(1)) : null;

  const aiVsHumanPerDay = {};
  for (const row of aiVsHumanAgg) {
    const day = row._id.day;
    if (!aiVsHumanPerDay[day]) aiVsHumanPerDay[day] = { _id: day, ai: 0, human: 0 };
    if (row._id.isAgent) aiVsHumanPerDay[day].human += row.count;
    else aiVsHumanPerDay[day].ai += row.count;
  }

  return {
    metrics: {
      visitors: activeVisitorCount,
      newVisitors,
      returningVisitors,
      conversations: conversationsInRange,
      messages: totalMessagesInRange,
      aiConversations: aiConversationsInRange,
      humanHandoffs: handoffsInRange,
      closedConversations: closedInRange,
      openConversations: openNow,
      avgMessagesPerConversation,
      avgConversationDurationMinutes,
      humanHandoffRate,
      returningVisitorRate,
    },
    trends: {
      visitorsPerDay,
      conversationsPerDay,
      messagesPerDay: mergeDailySeries(userMessagesPerDay, botMessagesPerDay),
      aiVsHumanPerDay: Object.values(aiVsHumanPerDay).sort((a, b) => a._id.localeCompare(b._id)),
    },
  };
}

function mergeDailySeries(a, b) {
  const map = new Map();
  for (const row of a) map.set(row._id, (map.get(row._id) || 0) + row.count);
  for (const row of b) map.set(row._id, (map.get(row._id) || 0) + row.count);
  return [...map.entries()].map(([_id, count]) => ({ _id, count })).sort((x, y) => x._id.localeCompare(y._id));
}

export { ACTIVE_THRESHOLD_MS };
