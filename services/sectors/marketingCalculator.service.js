// ======================================================
// DIGITAL MARKETING CALCULATOR — deterministic, testable math only.
// Never touches the AI/Groq pipeline. Every function here takes
// plain numbers, validates them, and returns a structured result —
// the LLM is only ever allowed to EXPLAIN a result object that this
// module already computed (see services/sectors/index.js).
// ======================================================

// A single, consistent shape every calculation returns, so the
// widget/UI never has to special-case one formula vs another.
function result(value, { formula, inputs, unit = "", warnings = [] }) {
  return {
    value: value === null ? null : Math.round(value * 10000) / 10000,
    unit,
    formula,
    inputs,
    warnings,
    isEstimate: true,
  };
}

// Deliberately stricter than a bare `Number(v)` coercion — that
// silently turns null/undefined/""/false into 0, which would make a
// genuinely MISSING input indistinguishable from a real zero (e.g.
// ROAS with no revenue supplied would wrongly compute as "0 revenue"
// instead of flagging a missing value).
function toNumber(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Guards every formula against the one failure mode deterministic
// math can't recover from on its own: a zero or missing denominator.
// Returns null (never NaN/Infinity) with a human-readable warning
// instead of crashing or silently showing a misleading number.
function safeDivide(numerator, denominator) {
  if (numerator === null || denominator === null) return { value: null, warning: "Missing required value." };
  if (denominator === 0) return { value: null, warning: "Cannot divide by zero." };
  return { value: numerator / denominator, warning: null };
}

export function calculateROI({ revenue, cost }) {
  const r = toNumber(revenue);
  const c = toNumber(cost);
  const inputs = { revenue: r, cost: c };
  const { value, warning } = safeDivide(r !== null && c !== null ? r - c : null, c);
  return result(value === null ? null : value * 100, {
    formula: "ROI = (revenue − cost) / cost × 100%",
    inputs,
    unit: "%",
    warnings: warning ? [warning] : [],
  });
}

export function calculateROAS({ revenue, spend }) {
  const r = toNumber(revenue);
  const s = toNumber(spend);
  const { value, warning } = safeDivide(r, s);
  return result(value, {
    formula: "ROAS = attributed revenue / advertising spend",
    inputs: { revenue: r, spend: s },
    unit: "x",
    warnings: warning ? [warning] : [],
  });
}

export function calculateCPC({ spend, clicks }) {
  const s = toNumber(spend);
  const cl = toNumber(clicks);
  const { value, warning } = safeDivide(s, cl);
  return result(value, {
    formula: "CPC = advertising spend / clicks",
    inputs: { spend: s, clicks: cl },
    unit: "currency/click",
    warnings: warning ? [warning] : [],
  });
}

export function calculateCPM({ spend, impressions }) {
  const s = toNumber(spend);
  const imp = toNumber(impressions);
  const { value, warning } = safeDivide(s, imp);
  return result(value === null ? null : value * 1000, {
    formula: "CPM = advertising spend / impressions × 1,000",
    inputs: { spend: s, impressions: imp },
    unit: "currency/1000 impressions",
    warnings: warning ? [warning] : [],
  });
}

export function calculateCTR({ clicks, impressions }) {
  const cl = toNumber(clicks);
  const imp = toNumber(impressions);
  const { value, warning } = safeDivide(cl, imp);
  return result(value === null ? null : value * 100, {
    formula: "CTR = clicks / impressions × 100%",
    inputs: { clicks: cl, impressions: imp },
    unit: "%",
    warnings: warning ? [warning] : [],
  });
}

// `denominatorLabel` is surfaced in the result so the UI/explanation
// always shows what the conversion rate is actually a percentage OF
// (visits vs. clicks) — required explicitly by the spec ("with the
// selected denominator explicitly displayed").
export function calculateConversionRate({ conversions, denominator, denominatorLabel = "visits" }) {
  const conv = toNumber(conversions);
  const denom = toNumber(denominator);
  const { value, warning } = safeDivide(conv, denom);
  return result(value === null ? null : value * 100, {
    formula: `Conversion rate = conversions / ${denominatorLabel} × 100%`,
    inputs: { conversions: conv, [denominatorLabel]: denom },
    unit: "%",
    warnings: warning ? [warning] : [],
  });
}

export function calculateCPL({ spend, leads }) {
  const s = toNumber(spend);
  const l = toNumber(leads);
  const { value, warning } = safeDivide(s, l);
  return result(value, {
    formula: "CPL = advertising spend / leads",
    inputs: { spend: s, leads: l },
    unit: "currency/lead",
    warnings: warning ? [warning] : [],
  });
}

export function calculateLeadsFromBudget({ budget, costPerLead }) {
  const b = toNumber(budget);
  const cpl = toNumber(costPerLead);
  const { value, warning } = safeDivide(b, cpl);
  return result(value, {
    formula: "Estimated leads = budget / cost per lead",
    inputs: { budget: b, costPerLead: cpl },
    unit: "leads",
    warnings: warning ? [warning] : [],
  });
}

export function calculateBudgetFromLeads({ targetLeads, costPerLead }) {
  const t = toNumber(targetLeads);
  const cpl = toNumber(costPerLead);
  if (t === null || cpl === null) {
    return result(null, {
      formula: "Estimated budget = target leads × assumed cost per lead",
      inputs: { targetLeads: t, costPerLead: cpl },
      unit: "currency",
      warnings: ["Missing required value."],
    });
  }
  return result(t * cpl, {
    formula: "Estimated budget = target leads × assumed cost per lead",
    inputs: { targetLeads: t, costPerLead: cpl },
    unit: "currency",
    warnings: [],
  });
}

export const MARKETING_CALCULATIONS = {
  roi: calculateROI,
  roas: calculateROAS,
  cpc: calculateCPC,
  cpm: calculateCPM,
  ctr: calculateCTR,
  conversion_rate: calculateConversionRate,
  cpl: calculateCPL,
  leads_from_budget: calculateLeadsFromBudget,
  budget_from_leads: calculateBudgetFromLeads,
};
