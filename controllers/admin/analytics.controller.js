import {
  resolveDateRange,
  resolveAnalyticsScope,
  computeAnalytics,
  AnalyticsAuthError,
} from "../../services/analytics.service.js";

/**
 * Real aggregation over existing data — see analytics.service.js for
 * every metric's exact definition. No invented percentages, no
 * client-side-only filtering.
 */
export const getAnalytics = async (req, res) => {
  try {
    const requester = req.adminUser;
    const { companyId, chatbotId, days, startDate, endDate } = req.query;

    const scope = await resolveAnalyticsScope(requester, { companyId, chatbotId });
    const range = resolveDateRange({ days, startDate, endDate });

    const { metrics, trends } = await computeAnalytics(scope, range);

    return res.status(200).json({
      success: true,
      range: { since: range.since, until: range.until, days: range.days, timezone: "UTC" },
      scope: {
        companyId: companyId || null,
        chatbotId: scope.chatbotId,
        chatbotAttributionExact: scope.chatbotAttributionExact,
        note: scope.note,
      },
      metrics,
      trends,
    });
  } catch (error) {
    if (error instanceof AnalyticsAuthError) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Analytics Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load analytics." });
  }
};
