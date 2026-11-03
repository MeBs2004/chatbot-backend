// ======================================================
// Shared condition evaluator — the exact same shape is used for a
// question's "show only if" logic (Phase 2) and a solution template's
// equipment selection conditions (Phase 3), so both read the same
// three operators the same way.
// ======================================================

/** @param {Record<string, any>} answers question id (string) -> answer value. @param {{questionId, condition, value}|null} cond */
export function evaluateCondition(answers, cond) {
  if (!cond || !cond.questionId) return true; // no condition = always applies
  const answer = answers[String(cond.questionId)];
  switch (cond.condition) {
    case "equals":
      return answer === cond.value;
    case "not_equals":
      return answer !== cond.value;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(answer);
    default:
      return true;
  }
}
