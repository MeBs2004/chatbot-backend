import axios from "axios";
import FlowSession from "../../models/flowSession.model.js";
import Bot from "../../models/bot.model.js";
import User from "../../models/user.model.js";
import { askAI } from "../ai.router.js";
import { buildRefusalMessage } from "../groq.service.js";
import { assertSafeWebhookUrl, WEBHOOK_MAX_RESPONSE_BYTES, WEBHOOK_DEFAULT_TIMEOUT_MS } from "./flow.security.js";
import { MAX_DELAY_MS, MAX_WEBHOOK_TIMEOUT_MS } from "../../validators/flow.validator.js";

// ======================================================
// FLOW EXECUTOR (Phase 6)
// One call = one visitor message in, one combined bot reply out.
// Runs synchronously within the /bot/v1/message request/response
// cycle — there is no background job queue, so Delay nodes really
// do hold the HTTP request open (capped at MAX_DELAY_MS) and Webhook
// nodes really do block on the outbound call (capped at
// MAX_WEBHOOK_TIMEOUT_MS). See Phase 6 report, "Runtime".
// ======================================================

const MAX_NODE_EXECUTIONS_PER_TURN = 25;

export class FlowRuntimeError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nodeById(flow, id) {
  return flow.nodes.find((n) => n.id === id) || null;
}

function nextEdge(flow, sourceId, handle = null) {
  return (
    flow.edges.find((e) => e.source === sourceId && (e.sourceHandle || null) === handle) || null
  );
}

function substitute(template, vars) {
  if (typeof template !== "string") return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function substituteDeep(value, vars) {
  if (typeof value === "string") return substitute(value, vars);
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = substituteDeep(value[k], vars);
    return out;
  }
  return value;
}

function validateAnswer(inputType, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, message: "This can't be empty. Please try again." };

  switch (inputType) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? { ok: true, value }
        : { ok: false, message: "That doesn't look like a valid email address. Please try again." };
    case "phone":
      return /^[+\d][\d\s\-()]{6,19}$/.test(value)
        ? { ok: true, value }
        : { ok: false, message: "That doesn't look like a valid phone number. Please try again." };
    case "number":
      return !Number.isNaN(Number(value))
        ? { ok: true, value }
        : { ok: false, message: "Please enter a valid number." };
    default:
      return { ok: true, value };
  }
}

function matchButton(buttons, raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  return buttons.find(
    (b) => String(b.label ?? "").trim().toLowerCase() === value || String(b.value ?? "").trim().toLowerCase() === value
  );
}

function evaluateCondition(varValue, operator, compareValue) {
  const exists = varValue !== undefined && varValue !== null && String(varValue).trim() !== "";
  switch (operator) {
    case "exists":
      return exists;
    case "not_exists":
      return !exists;
    case "equals":
      return String(varValue ?? "") === String(compareValue ?? "");
    case "not_equals":
      return String(varValue ?? "") !== String(compareValue ?? "");
    case "contains":
      return String(varValue ?? "").includes(String(compareValue ?? ""));
    case "not_contains":
      return !String(varValue ?? "").includes(String(compareValue ?? ""));
    case "greater_than": {
      const a = Number(varValue);
      const b = Number(compareValue);
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
    }
    case "less_than": {
      const a = Number(varValue);
      const b = Number(compareValue);
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b;
    }
    default:
      return false;
  }
}

async function loadRecentHistory(companyId, visitorId) {
  const [userHistory, botHistory] = await Promise.all([
    User.find({ companyId, visitorId }).sort({ createdAt: -1 }).limit(8).lean(),
    Bot.find({ companyId, visitorId }).sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  return [...userHistory, ...botHistory]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((m) => ({ sender: m.sender, text: m.text }));
}

async function runWebhookNode(node, vars) {
  const data = node.data || {};
  const url = substitute(data.url, vars);
  const method = String(data.method || "POST").toUpperCase();
  const timeout = Math.min(Number(data.timeout) || WEBHOOK_DEFAULT_TIMEOUT_MS, MAX_WEBHOOK_TIMEOUT_MS);

  try {
    await assertSafeWebhookUrl(url);

    const headers = {};
    if (data.headers && typeof data.headers === "object") {
      for (const [k, v] of Object.entries(data.headers)) {
        if (typeof v === "string") headers[k] = substitute(v, vars);
      }
    }

    const body = data.body ? substituteDeep(data.body, vars) : undefined;

    const response = await axios.request({
      url,
      method,
      headers,
      data: ["GET"].includes(method) ? undefined : body,
      timeout,
      maxContentLength: WEBHOOK_MAX_RESPONSE_BYTES,
      maxBodyLength: WEBHOOK_MAX_RESPONSE_BYTES,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      return { ok: true, message: data.successMessage ? substitute(data.successMessage, vars) : (response.data?.reply || "") };
    }
    // Never log response bodies/headers — only status, to avoid
    // leaking anything the remote endpoint sends back.
    console.error(`Flow webhook non-2xx status ${response.status} for node ${node.id}`);
    return { ok: false, message: data.failureMessage ? substitute(data.failureMessage, vars) : "" };
  } catch (error) {
    console.error(`Flow webhook error for node ${node.id}:`, error.message);
    return { ok: false, message: data.failureMessage ? substitute(data.failureMessage, vars) : "" };
  }
}

/**
 * Executes exactly one visitor turn against a PUBLISHED flow.
 * Never persists partial state — either the whole turn completes
 * and the session is saved once at the end, or it throws
 * FlowRuntimeError and the caller is expected to leave the session
 * untouched and fall back to the existing assistant for this turn.
 */
export async function executeTurn({ company, chatbotId, flow, visitorId, incomingText, language }) {
  const companyId = company.companyId;

  let session = await FlowSession.findOne({ chatbotId, visitorId });

  if (session && session.status === "HANDED_OFF") {
    // Once handed off, this visitor's future turns are deliberately
    // NOT routed through the flow engine (see model comment) — the
    // caller treats a null-ish outcome as "no flow for this turn".
    return null;
  }

  const isNewSession = !session;
  if (isNewSession) {
    // Reuse-in-place, not `new FlowSession(...)`: the unique index on
    // {chatbotId, visitorId} means a fresh document would collide
    // with any existing (COMPLETED/ERROR) session for a returning
    // visitor and fail the eventual insert.
    session = new FlowSession({ chatbotId, companyId, visitorId, flowId: flow._id, flowVersion: flow.version });
  }

  if (isNewSession || session.flowVersion !== flow.version || session.status !== "ACTIVE") {
    // A republish or a completed/errored prior run — start this
    // visitor over at the current flow's beginning.
    session.flowId = flow._id;
    session.flowVersion = flow.version;
    session.currentNodeId = flow.startNodeId;
    session.awaitingInput = false;
    session.variables = {};
    session.status = "ACTIVE";
    session.totalSteps = 0;
  }

  const outputParts = [];
  let steps = session.totalSteps;
  let currentNodeId = session.currentNodeId;
  let awaitingInput = false;

  const vars = {
    ...session.variables,
    "visitor.message": incomingText,
    "conversation.id": visitorId,
    "company.id": companyId,
    "chatbot.id": String(chatbotId),
  };

  // ---- Resolve an interactive node's pending answer first ----
  if (session.awaitingInput && currentNodeId) {
    const node = nodeById(flow, currentNodeId);
    if (!node) throw new FlowRuntimeError(`Session pointed at missing node ${currentNodeId}`);

    if (node.type === "question") {
      const result = validateAnswer(node.data?.inputType || "text", incomingText);
      if (!result.ok) {
        return { reply: result.message, status: "ACTIVE" };
      }
      vars[node.data.variable] = result.value;
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
    } else if (node.type === "buttons") {
      const buttons = Array.isArray(node.data?.buttons) ? node.data.buttons : [];
      const matched = matchButton(buttons, incomingText);
      if (!matched) {
        const options = buttons.map((b) => b.label).join(", ");
        return { reply: `Please choose one of: ${options}`, status: "ACTIVE" };
      }
      const handle = String(matched.value ?? matched.label).trim();
      const edge = nextEdge(flow, node.id, handle);
      currentNodeId = edge?.target || null;
    }
  }

  // ---- Step through the graph until an interactive node or a
  //      terminal node is reached ----
  while (currentNodeId) {
    steps += 1;
    if (steps > MAX_NODE_EXECUTIONS_PER_TURN) {
      throw new FlowRuntimeError(`Exceeded ${MAX_NODE_EXECUTIONS_PER_TURN} node executions in one turn`);
    }

    const node = nodeById(flow, currentNodeId);
    if (!node) throw new FlowRuntimeError(`Flow references missing node ${currentNodeId}`);

    if (node.type === "start") {
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "message") {
      outputParts.push(substitute(node.data?.message || "", vars));
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "question") {
      outputParts.push(substitute(node.data?.question || "", vars));
      awaitingInput = true;
      break;
    }

    if (node.type === "buttons") {
      const buttons = Array.isArray(node.data?.buttons) ? node.data.buttons : [];
      const list = buttons.map((b) => `• ${b.label}`).join("\n");
      outputParts.push(`${substitute(node.data?.message || "", vars)}\n${list}`);
      awaitingInput = true;
      break;
    }

    if (node.type === "aiResponse") {
      const history = node.data?.historyEnabled === false ? [] : await loadRecentHistory(companyId, visitorId);
      const reply = await askAI({
        company,
        message: substitute(node.data?.prompt || vars["visitor.message"] || "", vars),
        language,
        history,
        modelOverride: node.data?.model || null,
        temperatureOverride: node.data?.temperature ?? null,
        maxTokensOverride: node.data?.maxTokens ?? null,
        extraInstruction: node.data?.instruction || "",
        chatbotId,
      });
      outputParts.push(reply);
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "knowledgeBase") {
      // Reuses the exact same AI call — company.knowledgeContent is
      // always loaded into its system prompt already (groq.service.js
      // loadKnowledge). There is no separate knowledge-base system
      // here; this node only narrows the instruction.
      const reply = await askAI({
        company,
        message: substitute(vars["visitor.message"] || "", vars),
        language,
        extraInstruction: `Answer strictly using the knowledge base content already provided in your system prompt. ${node.data?.instructions || ""}`.trim(),
        chatbotId,
      });
      // Compares against the company's *actual current* refusal text
      // (Phase 7 made it configurable via ai.fallbackMessage) rather
      // than a hardcoded string, so this still detects an off-topic
      // refusal correctly after an admin customizes it.
      const refusalText = buildRefusalMessage(company.ai?.fallbackMessage, company.name);
      const looksLikeFallback = !reply || reply.trim() === refusalText.trim();
      outputParts.push(looksLikeFallback && node.data?.fallback ? node.data.fallback : reply);
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "condition") {
      const result = evaluateCondition(vars[node.data?.variable], node.data?.operator, node.data?.value);
      const edge = nextEdge(flow, node.id, result ? "true" : "false");
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "webhook") {
      const result = await runWebhookNode(node, vars);
      if (result.message) outputParts.push(result.message);
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "humanHandoff") {
      outputParts.push(substitute(node.data?.message || "", vars));
      await Bot.create({ companyId, visitorId, sender: "bot", type: "handoff", text: outputParts[outputParts.length - 1] });
      session.status = "HANDED_OFF";
      currentNodeId = null;
      break;
    }

    if (node.type === "delay") {
      const duration = Math.min(Math.max(Number(node.data?.duration) || 0, 0), MAX_DELAY_MS);
      await sleep(duration);
      const edge = nextEdge(flow, node.id, null);
      currentNodeId = edge?.target || null;
      continue;
    }

    if (node.type === "end") {
      if (node.data?.endMessage) outputParts.push(substitute(node.data.endMessage, vars));
      session.status = "COMPLETED";
      currentNodeId = null;
      break;
    }

    throw new FlowRuntimeError(`Unsupported node type "${node.type}"`);
  }

  // Persist the final state for this turn only now that every step
  // has completed without throwing.
  session.currentNodeId = currentNodeId;
  session.awaitingInput = awaitingInput;
  // Only flow.*/visitor.* variables collected via Question nodes are
  // persisted — the per-turn dynamic ones (visitor.message, etc.)
  // are recomputed fresh next turn and never written back.
  const persistedVars = { ...vars };
  delete persistedVars["visitor.message"];
  delete persistedVars["conversation.id"];
  delete persistedVars["company.id"];
  delete persistedVars["chatbot.id"];
  session.variables = persistedVars;
  session.totalSteps = steps;
  await session.save();

  return { reply: outputParts.join("\n\n").trim(), status: session.status };
}
