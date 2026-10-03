import Visitor from "../models/visitor.model.js";
import Company from "../models/company.model.js";
import Chatbot from "../models/chatbot.model.js";
import Conversation from "../models/conversation.model.js";
import { getAccessibleCompanyIds, hasChatbotAccess } from "./admin/access.service.js";

// ======================================================
// LIVE VIEW SERVICE
//
// Precise definition of "live" — deliberately NOT the stored
// Visitor.status field, which is set to "online" on every visit and
// never decays back to "offline" anywhere in this codebase (see
// controllers/admin/visitor.controller.js's own Section-10 comment,
// which documents the identical problem for the existing Visitors
// page). Using it here would show every visitor who has EVER visited
// as permanently online.
//
// Real signal used instead: Visitor.lastVisit, which the public
// widget now refreshes on a ~25s heartbeat while the chat is actually
// mounted in the visitor's browser (see frontend/src/component/
// Bot.jsx and OyaBot.jsx), on top of the save that already happens on
// page load. That makes recency of lastVisit a reasonably accurate
// "is this tab still open" signal without needing a second, separate
// presence protocol (e.g. a per-visitor Socket.IO connection) that
// does not exist anywhere in this codebase today.
//
// ONLINE: lastVisit within the last 60s (i.e. at most ~2 missed
//         heartbeats).
// IDLE:   lastVisit within the last 5 minutes but not ONLINE — the
//         heartbeat has stopped (tab backgrounded/closed, or a slow
//         network) but they were just here.
// Anyone older than the IDLE window is not part of Live View at all
// — they still exist on the regular Visitors page, which already has
// its own, coarser "Active" definition (ACTIVE_THRESHOLD_MS, 15
// minutes, in analytics.service.js) for a different purpose (session-
// level engagement, not "who is on the site right now").
// ======================================================

export const LIVE_ONLINE_MS = 60 * 1000;
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function computeLiveStatus(lastVisit) {
  const ageMs = Date.now() - new Date(lastVisit).getTime();
  if (ageMs <= LIVE_ONLINE_MS) return "online";
  if (ageMs <= LIVE_WINDOW_MS) return "idle";
  return null; // outside the live window entirely
}

const SORTERS = {
  latest: (a, b) => new Date(b.lastVisit) - new Date(a.lastVisit),
  firstSeen: (a, b) => new Date(b.firstVisit) - new Date(a.firstVisit),
  messages: (a, b) => (b.totalMessages || 0) - (a.totalMessages || 0),
  // Online before idle; ties broken by most recent activity.
  status: (a, b) =>
    (a.liveStatus === b.liveStatus ? 0 : a.liveStatus === "online" ? -1 : 1) ||
    new Date(b.lastVisit) - new Date(a.lastVisit),
};

/**
 * Scoped, bounded, real-time-ish snapshot of visitors currently on
 * site. Never scans the whole Visitor collection — the lastVisit
 * range filter (indexed via the existing {companyId,lastVisit} index,
 * see visitor.model.js) keeps this to just the live window regardless
 * of how large the historical collection grows.
 */
export async function getLiveView(requester, query = {}) {
  const { companyId, chatbotId, status, device, conversation: conversationFilter, search } = query;

  const filter = { lastVisit: { $gte: new Date(Date.now() - LIVE_WINDOW_MS) } };

  const accessibleIds = await getAccessibleCompanyIds(requester);

  if (chatbotId) {
    if (!(await hasChatbotAccess(requester, chatbotId))) {
      const err = new Error("You don't have permission to access this resource.");
      err.status = 403;
      throw err;
    }
    const chatbot = await Chatbot.findById(chatbotId).select("companyId").lean();
    if (!chatbot) {
      const err = new Error("Chatbot not found.");
      err.status = 404;
      throw err;
    }
    filter.companyId = chatbot.companyId;
  } else if (companyId) {
    if (accessibleIds !== null && !accessibleIds.includes(companyId)) {
      const err = new Error("You don't have permission to access this resource.");
      err.status = 403;
      throw err;
    }
    filter.companyId = companyId;
  } else if (accessibleIds !== null) {
    filter.companyId = { $in: accessibleIds };
  }

  if (device === "Desktop" || device === "Mobile") filter.device = device;

  if (search) {
    filter.$or = [
      { visitorId: { $regex: search, $options: "i" } },
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { page: { $regex: search, $options: "i" } },
    ];
  }

  // Capped, not paginated — this is a bounded "who's here right now"
  // set, not a historical archive; 300 concurrent live visitors is far
  // beyond this platform's current two-tenant scale, and a hard cap is
  // simpler and safer than pagination for a view that's re-fetched
  // every few seconds anyway.
  const rawVisitors = await Visitor.find(filter).sort({ lastVisit: -1 }).limit(300).lean();

  const companyIds = [...new Set(rawVisitors.map((v) => v.companyId))];
  const visitorKeys = rawVisitors.map((v) => ({ companyId: v.companyId, visitorId: v.visitorId }));

  const [companies, conversations] = await Promise.all([
    Company.find({ companyId: { $in: companyIds } }).select("companyId name").lean(),
    visitorKeys.length
      ? Conversation.find({ $or: visitorKeys })
          .select("companyId visitorId mode status assignedTo handoffAt unreadCount chatbotId")
          .populate("assignedTo", "name")
          .lean()
      : [],
  ]);

  const companyMap = Object.fromEntries(companies.map((c) => [c.companyId, c.name]));
  const conversationMap = new Map(conversations.map((c) => [`${c.companyId}::${c.visitorId}`, c]));

  let visitors = rawVisitors
    .map((v) => {
      const liveStatus = computeLiveStatus(v.lastVisit);
      const convo = conversationMap.get(`${v.companyId}::${v.visitorId}`) || null;
      const isHandoffPending = Boolean(convo && convo.mode === "HUMAN" && !convo.assignedTo);

      return {
        ...v,
        companyName: companyMap[v.companyId] || v.companyId,
        liveStatus,
        conversation: convo
          ? {
              chatbotId: convo.chatbotId,
              mode: convo.mode,
              status: convo.status,
              unreadCount: convo.unreadCount,
              assignedToName: convo.assignedTo?.name || null,
              isHandoffPending,
            }
          : null,
      };
    })
    .filter((v) => v.liveStatus !== null);

  // Stats reflect the true scoped/live picture BEFORE the admin's own
  // status/conversation-type filters narrow the visible list below —
  // narrowing the list to "just handoffs" shouldn't also make the
  // "Active Visitors" stat card lie about how many people are here.
  const stats = {
    activeVisitors: visitors.length,
    activeChats: visitors.filter((v) => v.conversation && v.conversation.status !== "CLOSED").length,
    aiConversations: visitors.filter((v) => v.conversation && v.conversation.mode === "AI" && v.conversation.status !== "CLOSED").length,
    handoffs: visitors.filter((v) => v.conversation?.isHandoffPending).length,
  };

  if (status === "online" || status === "idle") {
    visitors = visitors.filter((v) => v.liveStatus === status);
  }

  if (conversationFilter === "none") {
    visitors = visitors.filter((v) => !v.conversation);
  } else if (conversationFilter === "active") {
    visitors = visitors.filter((v) => v.conversation && v.conversation.status !== "CLOSED");
  } else if (conversationFilter === "handoff") {
    visitors = visitors.filter((v) => v.conversation?.isHandoffPending);
  }

  const sorter = SORTERS[query.sort] || SORTERS.latest;
  visitors.sort(sorter);

  return { visitors, stats };
}
