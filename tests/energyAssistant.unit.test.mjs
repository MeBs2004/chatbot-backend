// Pure-logic tests for the Phase 5.1 "Ask AI" guardrail layer — no
// server, no DB, no real Groq call (the `ask` function is injected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEnergyAssistantInstruction, askEnergyAssistant } from "../services/energy/energyAssistant.service.js";

test("buildEnergyAssistantInstruction forbids every restricted action the brief lists", () => {
  const instruction = buildEnergyAssistantInstruction({ fuelKey: "cng", projectTypeLabel: "Mother Station", stage: "questions" });
  for (const phrase of ["Bill of Materials", "engineering calculations", "prices", "select, recommend", "skip, change, or ignore a required question"]) {
    assert.ok(instruction.includes(phrase), `missing restriction: ${phrase}`);
  }
  assert.ok(instruction.includes("cng") && instruction.includes("Mother Station") && instruction.includes("questions"), "context is threaded through for tone/relevance only");
});

test("buildEnergyAssistantInstruction still reads sensibly with no context given", () => {
  const instruction = buildEnergyAssistantInstruction();
  assert.ok(instruction.includes("Bill of Materials"));
});

test("askEnergyAssistant calls the injected ask function with the guardrail instruction and the visitor's exact question, never mutating journey state (it only ever returns a string)", async () => {
  let captured = null;
  const fakeAsk = async (args) => {
    captured = args;
    return "A CNG Mother Station is the primary source station in a CNG distribution network.";
  };
  const company = { companyId: "acme", name: "Acme Energy" };
  const answer = await askEnergyAssistant({ company, chatbotId: "chatbot123", question: "What is a CNG Mother Station?", fuelKey: "cng", projectTypeLabel: "Mother Station", stage: "project", ask: fakeAsk });

  assert.equal(answer, "A CNG Mother Station is the primary source station in a CNG distribution network.");
  assert.equal(captured.company, company);
  assert.equal(captured.chatbotId, "chatbot123");
  assert.equal(captured.message, "What is a CNG Mother Station?");
  assert.deepEqual(captured.history, [], "no conversation memory is threaded in — this is a one-off, isolated Q&A");
  assert.ok(captured.extraInstruction.includes("Bill of Materials"));
});

// askEnergyAssistant's default (real askGroq) path — including its
// "never throws, always a string" guarantee — is exercised by the
// full HTTP integration test in energyJourney.test.mjs instead, which
// has a real DB connection for askGroq's quota/knowledge lookups.
// Calling it here with no DB connected just hangs on a Mongoose
// buffering timeout for no extra coverage.
