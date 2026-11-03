import XLSX from "xlsx";
import { loadAuthorizedEnergyChatbot } from "../../services/energy/energyAccess.service.js";
import { resolveDateRange } from "../../services/analytics.service.js";
import {
  getOverviewAnalytics,
  getOverviewComparison,
  buildOverviewDeltas,
  getVisitorAnalytics,
  getFuelAnalytics,
  getProjectTypeAnalytics,
  getFunnelAnalytics,
  getQuestionAnalytics,
  getSolutionAnalytics,
  getSupplierAnalytics,
  getEnquiryAnalytics,
  getAiHandoffAnalytics,
} from "../../services/energy/energyAnalytics.service.js";

// ======================================================
// PHASE 6 — Energy Analytics, admin side. Every endpoint here follows
// the exact same pattern as every other Energy admin controller:
// `loadAuthorizedEnergyChatbot` resolves the chatbot from the URL,
// checks it's really an Energy chatbot, checks the requester's real
// access (role/permission, company/chatbot scope — the existing RBAC,
// nothing new), and resolves `company` server-side — a client-supplied
// companyId is never read anywhere in this file. The date range comes
// from the EXISTING `resolveDateRange` (services/analytics.service.js)
// so "Last 7 days"/"Custom range"/timezone/off-by-one handling can
// never drift from the platform's one general Analytics page.
// ======================================================

async function scopeAndRange(req, res) {
  const ctx = await loadAuthorizedEnergyChatbot(req, res);
  if (!ctx) return null;
  const { days, startDate, endDate } = req.query;
  const range = resolveDateRange({ days, startDate, endDate });
  return { scope: { companyId: ctx.chatbot.companyId, chatbotId: ctx.chatbot._id }, range, ctx };
}

function wrap(fn, label) {
  return async (req, res) => {
    try {
      const resolved = await scopeAndRange(req, res);
      if (!resolved) return;
      const data = await fn(resolved);
      return res.status(200).json({ success: true, range: { since: resolved.range.since, until: resolved.range.until, days: resolved.range.days, timezone: "UTC" }, ...data });
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error(`Energy Analytics (${label}) Error:`, error);
      return res.status(500).json({ success: false, message: "Failed to load analytics." });
    }
  };
}

export const getEnergyOverview = wrap(async ({ scope, range }) => {
  const [current, previous] = await Promise.all([getOverviewAnalytics(scope, range), getOverviewComparison(scope, range)]);
  return { metrics: current.metrics, deltas: buildOverviewDeltas(current, previous), trackedSince: current.trackedSince };
}, "overview");

export const getEnergyVisitorAnalytics = wrap(async ({ scope, range }) => getVisitorAnalytics(scope, range), "visitors");
export const getEnergyFuelAnalytics = wrap(async ({ scope, range }) => getFuelAnalytics(scope, range), "fuels");
export const getEnergyProjectTypeAnalytics = wrap(async ({ scope, range }) => getProjectTypeAnalytics(scope, range), "project-types");
export const getEnergyFunnelAnalytics = wrap(async ({ scope, range }) => getFunnelAnalytics(scope, range), "funnel");
export const getEnergyQuestionAnalytics = wrap(async ({ scope, range }) => getQuestionAnalytics(scope, range), "questions");
export const getEnergySolutionAnalytics = wrap(async ({ scope, range }) => getSolutionAnalytics(scope, range), "solutions");
export const getEnergySupplierAnalytics = wrap(async ({ scope, range }) => getSupplierAnalytics(scope, range), "suppliers");
export const getEnergyEnquiryAnalytics = wrap(async ({ scope, range }) => getEnquiryAnalytics(scope, range), "enquiries");
export const getEnergyAiHandoffAnalytics = wrap(async ({ scope, range }) => getAiHandoffAnalytics(scope, range), "ai-handoff");

// ---------------- Export (Module 11) ----------------
// A workbook of real aggregated numbers — never raw per-visitor rows
// (no PII), and never a value the dashboard itself couldn't also show.
export const exportEnergyAnalytics = async (req, res) => {
  try {
    const resolved = await scopeAndRange(req, res);
    if (!resolved) return;
    const { scope, range, ctx } = resolved;
    const format = req.query.format === "csv" ? "csv" : "xlsx";

    const [overview, previous, visitors, fuels, projectTypes, funnel, solutions, suppliers, enquiries] = await Promise.all([
      getOverviewAnalytics(scope, range),
      getOverviewComparison(scope, range),
      getVisitorAnalytics(scope, range),
      getFuelAnalytics(scope, range),
      getProjectTypeAnalytics(scope, range),
      getFunnelAnalytics(scope, range),
      getSolutionAnalytics(scope, range),
      getSupplierAnalytics(scope, range),
      getEnquiryAnalytics(scope, range),
    ]);
    const deltas = buildOverviewDeltas(overview, previous);

    const sections = {
      Overview: Object.entries(overview.metrics).map(([metric, value]) => ({ Metric: metric, Value: value ?? "—", "Change vs previous period": deltas[metric] != null ? `${deltas[metric]}%` : "—" })),
      Visitors: Object.entries(visitors.metrics).map(([metric, value]) => ({ Metric: metric, Value: value ?? "—" })),
      "Fuel Demand": fuels.breakdown.map((f) => ({ Fuel: f.label, Sessions: f.sessions, "Share %": f.sharePercent ?? "—" })),
      "Project Type Demand": projectTypes.breakdown.map((p) => ({ "Project Type": p.label, Fuel: p.fuelKey || "—", Sessions: p.sessions, "Share %": p.sharePercent ?? "—" })),
      "Journey Funnel": funnel.steps.map((s) => ({ Step: s.label, Sessions: s.sessions, "Drop-off": s.dropOffFromPrevious, "Conversion %": s.conversionFromPrevious ?? "—" })),
      "BOM & Solutions": [{ Metric: "Generated", Value: solutions.metrics.generated }, { Metric: "Failed", Value: solutions.metrics.failed }, { Metric: "Requires Engineering Review", Value: solutions.metrics.requiresEngineeringReview }, { Metric: "Success Rate %", Value: solutions.metrics.successRate ?? "—" }],
      "Supplier Matching": [{ Metric: "Requested", Value: suppliers.metrics.requested }, { Metric: "Completed", Value: suppliers.metrics.completed }, { Metric: "Successful", Value: suppliers.metrics.successful }, { Metric: "No Match", Value: suppliers.metrics.noMatch }, { Metric: "Success Rate %", Value: suppliers.metrics.successRate ?? "—" }],
      "RFQ / Enquiries": Object.entries(enquiries.metrics).map(([metric, value]) => ({ Metric: metric, Value: value ?? "—" })),
    };

    const filenameBase = `energy-analytics-${ctx.chatbot._id}-${new Date(resolved.range.since).toISOString().slice(0, 10)}_to_${new Date(resolved.range.until).toISOString().slice(0, 10)}`;

    if (format === "csv") {
      // A single CSV can only hold one table — concatenate sections with headers, which is the honest shape of "export everything" as CSV.
      let csv = "";
      for (const [title, rows] of Object.entries(sections)) {
        csv += `${title}\n`;
        csv += rows.length > 0 ? XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows)) : "No data in this range\n";
        csv += "\n";
      }
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.csv"`);
      return res.status(200).send(csv);
    }

    const workbook = XLSX.utils.book_new();
    for (const [title, rows] of Object.entries(sections)) {
      const sheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Note: "No data in this range" }]);
      // Excel sheet names can't contain : \ / ? * [ ] — "RFQ / Enquiries" needed this.
      const sheetName = title.replace(/[:\\/?*[\]]/g, "-").slice(0, 31);
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    }
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Energy Analytics Export Error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate the export." });
  }
};
