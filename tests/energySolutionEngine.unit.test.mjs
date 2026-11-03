// Pure-logic tests for the Phase 3 solution engine: no server, no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition } from "../services/energy/conditionEvaluator.js";
import { runSolutionTemplate } from "../services/energy/solutionEngine.service.js";

test("evaluateCondition: equals/not_equals/in, and no condition always applies", () => {
  const answers = { q1: "Yes", q2: 5 };
  assert.equal(evaluateCondition(answers, null), true);
  assert.equal(evaluateCondition(answers, { questionId: "q1", condition: "equals", value: "Yes" }), true);
  assert.equal(evaluateCondition(answers, { questionId: "q1", condition: "equals", value: "No" }), false);
  assert.equal(evaluateCondition(answers, { questionId: "q1", condition: "not_equals", value: "No" }), true);
  assert.equal(evaluateCondition(answers, { questionId: "q2", condition: "in", value: [1, 5, 9] }), true);
  assert.equal(evaluateCondition(answers, { questionId: "q2", condition: "in", value: [1, 9] }), false);
});

const Q_BACKUP = { _id: "q_backup", label: "Battery backup required?" };
const Q_CAPACITY = { _id: "q_capacity", label: "Critical load (W)" };
const Q_HIDDEN_DEPENDENT = { _id: "q_hidden", label: "Backup hours", dependsOnQuestionId: "q_backup", dependsOnCondition: "equals", dependsOnValue: "Yes" };

// capacityUnit is deliberately "W" here (the panel's own wattage spec
// unit) — distinct from "unit" — so the BOM-line-unit test below can
// actually prove the engine doesn't confuse the two (see the comment
// in solutionEngine.service.js on why capacityUnit is never used as
// the line's counting unit).
const PANEL = { _id: "eq_panel", name: "550W Panel", manufacturer: "Acme", modelNumber: "AP-550", category: "panel", specs: { wattageW: 550 }, capacityUnit: "W", price: 12000, currency: "INR", active: true };
const BATTERY = { _id: "eq_battery", name: "5kWh Battery", manufacturer: "Acme", category: "battery", capacityUnit: "unit", price: 150000, currency: "INR", active: true };

function makeTemplate(overrides = {}) {
  return {
    status: "approved",
    version: 1,
    outputTypes: ["bom"],
    requiredQuestionIds: ["q_backup"],
    optionalQuestionIds: [],
    equipmentMappings: [{ equipmentId: "eq_panel", mandatory: true, quantityRule: { type: "fixed", fixedQty: 10 }, selectionCondition: null }],
    requiresEngineeringReview: false,
    ...overrides,
  };
}

function ctx({ questions = [Q_BACKUP], equipment = [PANEL], answers = {} } = {}) {
  return { questionsById: new Map(questions.map((q) => [String(q._id), q])), equipmentById: new Map(equipment.map((e) => [String(e._id), e])), answers };
}

test("a missing required question blocks the result entirely, with no invented lines", () => {
  const result = runSolutionTemplate(makeTemplate(), ctx({ answers: {} }));
  assert.equal(result.valid, false);
  assert.equal(result.missingInputs.length, 1);
  assert.equal(result.missingInputs[0].questionId, "q_backup");
  assert.equal(result.lines.length, 0);
});

test("a required question hidden by its own conditional logic is not counted as missing", () => {
  const template = makeTemplate({ requiredQuestionIds: ["q_backup", "q_hidden"] });
  const result = runSolutionTemplate(template, ctx({ questions: [Q_BACKUP, Q_HIDDEN_DEPENDENT], answers: { q_backup: "No" } }));
  // q_hidden depends on q_backup === "Yes", which is false here, so it's not required right now.
  assert.equal(result.valid, true);
});

test("a fixed quantity rule produces the exact configured quantity", () => {
  const result = runSolutionTemplate(makeTemplate(), ctx({ answers: { q_backup: "Yes" } }));
  assert.equal(result.valid, true);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].qty, 10);
  assert.equal(result.lines[0].name, "550W Panel");
  assert.equal(result.requiresEngineeringReview, false);
  assert.equal(result.lines[0].unit, "unit", "the line's counting unit must never default to the equipment's own spec unit (e.g. \"W\")");
});

test("unitOverride on the mapping is honored even when the equipment has its own capacityUnit", () => {
  const template = makeTemplate({ equipmentMappings: [{ equipmentId: "eq_panel", mandatory: true, quantityRule: { type: "fixed", fixedQty: 50 }, unitOverride: "m" }] });
  const result = runSolutionTemplate(template, ctx({ answers: { q_backup: "Yes" } }));
  assert.equal(result.lines[0].unit, "m");
});

test("per_question_value multiplies and rounds up, respecting minQty", () => {
  const template = makeTemplate({
    requiredQuestionIds: ["q_backup", "q_capacity"],
    equipmentMappings: [{ equipmentId: "eq_battery", mandatory: true, quantityRule: { type: "per_question_value", sourceQuestionId: "q_capacity", multiplier: 0.002, minQty: 1 } }],
  });
  const result = runSolutionTemplate(template, ctx({ questions: [Q_BACKUP, Q_CAPACITY], equipment: [BATTERY], answers: { q_backup: "Yes", q_capacity: 2400 } }));
  assert.equal(result.valid, true);
  // 2400 * 0.002 = 4.8 -> ceil = 5
  assert.equal(result.lines[0].qty, 5);
});

test("per_question_value_divided computes correctly and guards against a zero divisor", () => {
  const good = makeTemplate({
    requiredQuestionIds: ["q_backup", "q_capacity"],
    equipmentMappings: [{ equipmentId: "eq_battery", mandatory: true, quantityRule: { type: "per_question_value_divided", sourceQuestionId: "q_capacity", divisor: 5000, minQty: 1 } }],
  });
  const r1 = runSolutionTemplate(good, ctx({ questions: [Q_BACKUP, Q_CAPACITY], equipment: [BATTERY], answers: { q_backup: "Yes", q_capacity: 12000 } }));
  assert.equal(r1.lines[0].qty, 3); // ceil(12000/5000) = 3

  const badDivisor = makeTemplate({
    requiredQuestionIds: ["q_backup", "q_capacity"],
    equipmentMappings: [{ equipmentId: "eq_battery", mandatory: true, quantityRule: { type: "per_question_value_divided", sourceQuestionId: "q_capacity", divisor: 0 } }],
  });
  const r2 = runSolutionTemplate(badDivisor, ctx({ questions: [Q_BACKUP, Q_CAPACITY], equipment: [BATTERY], answers: { q_backup: "Yes", q_capacity: 12000 } }));
  assert.equal(r2.lines[0].qty, null);
  assert.equal(r2.requiresEngineeringReview, true);
});

test("a quantity rule with no usable numeric answer flags engineering review instead of guessing a number", () => {
  const template = makeTemplate({
    requiredQuestionIds: ["q_backup"],
    optionalQuestionIds: ["q_capacity"],
    equipmentMappings: [{ equipmentId: "eq_battery", mandatory: true, quantityRule: { type: "per_question_value", sourceQuestionId: "q_capacity", multiplier: 1 } }],
  });
  const result = runSolutionTemplate(template, ctx({ questions: [Q_BACKUP, Q_CAPACITY], equipment: [BATTERY], answers: { q_backup: "Yes" /* q_capacity never answered, and it's optional */ } }));
  assert.equal(result.valid, true, "optional question missing doesn't block the whole result");
  assert.equal(result.lines[0].qty, null);
  assert.equal(result.lines[0].requiresEngineeringReview, true);
  assert.equal(result.requiresEngineeringReview, true);
});

test("a mandatory mapping pointing at deleted/inactive equipment still produces a flagged line, never a silently dropped or invented one", () => {
  const template = makeTemplate({ equipmentMappings: [{ equipmentId: "eq_does_not_exist", mandatory: true, quantityRule: { type: "fixed", fixedQty: 2 } }] });
  const result = runSolutionTemplate(template, ctx({ answers: { q_backup: "Yes" } }));
  assert.equal(result.valid, true);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].name, "Unavailable equipment");
  assert.equal(result.requiresEngineeringReview, true);
  assert.ok(result.warnings.length > 0);
});

test("a selection condition excludes an equipment mapping when it doesn't match", () => {
  const template = makeTemplate({
    equipmentMappings: [
      { equipmentId: "eq_panel", mandatory: true, quantityRule: { type: "fixed", fixedQty: 10 }, selectionCondition: null },
      { equipmentId: "eq_battery", mandatory: false, quantityRule: { type: "fixed", fixedQty: 1 }, selectionCondition: { questionId: "q_backup", condition: "equals", value: "Yes" } },
    ],
  });
  const withoutBattery = runSolutionTemplate(template, ctx({ equipment: [PANEL, BATTERY], answers: { q_backup: "No" } }));
  assert.equal(withoutBattery.lines.length, 1);
  const withBattery = runSolutionTemplate(template, ctx({ equipment: [PANEL, BATTERY], answers: { q_backup: "Yes" } }));
  assert.equal(withBattery.lines.length, 2);
});

test("an inactive equipment item is treated the same as a missing one", () => {
  const inactiveBattery = { ...BATTERY, active: false };
  const template = makeTemplate({ equipmentMappings: [{ equipmentId: "eq_battery", mandatory: true, quantityRule: { type: "fixed", fixedQty: 1 } }] });
  const result = runSolutionTemplate(template, ctx({ equipment: [inactiveBattery], answers: { q_backup: "Yes" } }));
  assert.equal(result.lines[0].name, "Unavailable equipment");
  assert.equal(result.requiresEngineeringReview, true);
});
