import { evaluateCondition } from "./conditionEvaluator.js";

// ======================================================
// DETERMINISTIC SOLUTION ENGINE — the one place a template's
// equipment mappings and quantity rules actually get evaluated against
// real answers. Pure function: same inputs always produce the same
// output, nothing here calls the AI or invents a number. Built so
// Phase 5's published-widget flow can call this unchanged once real
// customer answers exist (Section 8 of the brief) — this is already
// exactly that call, just driven by admin-supplied preview answers
// for now instead of a real visitor conversation.
//
// Contract: if a REQUIRED (and currently applicable, i.e. not hidden
// by its own conditional logic) question has no answer, the engine
// refuses to produce a result at all — it reports what's missing
// instead of guessing. A mandatory equipment mapping that can't be
// resolved (deleted/inactive equipment, or a quantity rule with no
// usable numeric input) still produces a line, but flagged as needing
// engineering review rather than silently invented or dropped.
// ======================================================

const UNKNOWN_SENTINEL = "__unknown__";

function isQuestionCurrentlyApplicable(question, answers) {
  if (!question?.dependsOnQuestionId) return true;
  return evaluateCondition(answers, { questionId: question.dependsOnQuestionId, condition: question.dependsOnCondition, value: question.dependsOnValue });
}

// Phase 7 audit fix — a believable real-world equipment-line quantity
// ceiling. Not a hard rejection: an answer that computes past this is
// still shown (never silently altered) so an admin can see exactly
// what was requested, but it's flagged for engineering review rather
// than silently accepted as a confident, ready-to-order quantity —
// this catches a visitor's fat-fingered "999999999" the same way a
// missing answer already does.
const MAX_SANITY_QTY = 100000;

function computeQuantity(rule, answers) {
  if (!rule || rule.type === "fixed") return { qty: rule?.fixedQty ?? 1, warning: null };

  const raw = answers[String(rule.sourceQuestionId)];
  const value = Number(raw);
  if (raw === undefined || raw === null || raw === "" || raw === UNKNOWN_SENTINEL || !Number.isFinite(value)) {
    return { qty: null, warning: "No usable numeric answer for this item's quantity rule — needs engineering review." };
  }

  let qty;
  if (rule.type === "per_question_value") qty = Math.ceil(value * (rule.multiplier ?? 1));
  else if (rule.type === "per_question_value_divided") {
    const divisor = rule.divisor;
    if (!(divisor > 0)) return { qty: null, warning: "This item's quantity rule has an invalid divisor — needs engineering review." };
    qty = Math.ceil(value / divisor);
  } else qty = 1;

  // A negative/zero answer (e.g. "-5" nozzles) previously got silently
  // coerced up to minQty with no trace of the invalid input — flag it
  // instead so the admin reviewing the BOM knows the visitor's answer
  // didn't make physical sense, rather than seeing a plausible-looking
  // minQty and assuming the visitor really meant that.
  if (qty <= 0) {
    const minQty = rule.minQty ?? 1;
    return { qty: Math.max(qty, minQty), warning: "The answer driving this item's quantity was zero or negative — needs engineering review." };
  }

  if (qty > MAX_SANITY_QTY) {
    return { qty, warning: `This item's computed quantity (${qty}) is unusually large — needs engineering review.` };
  }

  const minQty = rule.minQty ?? 1;
  return { qty: Math.max(qty, minQty), warning: null };
}

/**
 * @param template a SolutionTemplate (lean or document)
 * @param questionsById Map<string, question> — every question in requiredQuestionIds/optionalQuestionIds/mapping selectionConditions
 * @param equipmentById Map<string, equipment>
 * @param answers Record<string, any> — question id (string) -> answer
 */
export function runSolutionTemplate(template, { questionsById, equipmentById, answers = {} }) {
  const missingInputs = [];
  for (const qid of template.requiredQuestionIds || []) {
    const question = questionsById.get(String(qid));
    if (!question) continue; // a required question that's since been deleted — nothing to validate against; the admin UI should flag this separately
    if (!isQuestionCurrentlyApplicable(question, answers)) continue; // hidden by its own conditional logic — not required right now
    const answer = answers[String(qid)];
    const answered = answer !== undefined && answer !== null && answer !== "";
    if (!answered) missingInputs.push({ questionId: String(qid), label: question.label });
  }

  if (missingInputs.length > 0) {
    return { valid: false, missingInputs, requiresEngineeringReview: false, lines: [], warnings: [], outputTypes: template.outputTypes, templateStatus: template.status, templateVersion: template.version };
  }

  const warnings = [];
  let requiresEngineeringReview = Boolean(template.requiresEngineeringReview);
  const lines = [];

  for (const mapping of template.equipmentMappings || []) {
    if (!evaluateCondition(answers, mapping.selectionCondition)) continue;

    const equipment = equipmentById.get(String(mapping.equipmentId));
    const { qty, warning: qtyWarning } = computeQuantity(mapping.quantityRule, answers);

    if (!equipment || equipment.active === false) {
      requiresEngineeringReview = true;
      const msg = `Mapped equipment is no longer available in the catalogue (mandatory: ${mapping.mandatory}).`;
      warnings.push(msg);
      lines.push({ equipmentId: mapping.equipmentId || null, name: "Unavailable equipment", mandatory: mapping.mandatory, qty: qty, unit: mapping.unitOverride || "", notes: mapping.notes || "", requiresEngineeringReview: true, warning: msg });
      continue;
    }

    if (qtyWarning) {
      requiresEngineeringReview = true;
      warnings.push(`${equipment.name}: ${qtyWarning}`);
    }

    lines.push({
      equipmentId: equipment._id,
      name: equipment.name,
      manufacturer: equipment.manufacturer,
      modelNumber: equipment.modelNumber,
      category: equipment.category,
      specs: equipment.specs || {},
      mandatory: mapping.mandatory,
      qty: qty,
      // Deliberately NOT equipment.capacityUnit here — that's the spec
      // unit of ONE item (e.g. "W" for a panel's wattage), not the
      // counting unit for how many of them this line needs. Default to
      // a plain count; a mapping that genuinely needs a different
      // counting unit (e.g. cable sold by the metre) sets unitOverride.
      unit: mapping.unitOverride || "unit",
      price: equipment.price ?? null,
      currency: equipment.currency || "INR",
      notes: mapping.notes || "",
      requiresEngineeringReview: Boolean(qtyWarning),
      warning: qtyWarning,
    });
  }

  return {
    valid: true,
    missingInputs: [],
    requiresEngineeringReview,
    lines,
    warnings,
    outputTypes: template.outputTypes,
    templateStatus: template.status,
    templateVersion: template.version,
  };
}

export { UNKNOWN_SENTINEL, computeQuantity };
