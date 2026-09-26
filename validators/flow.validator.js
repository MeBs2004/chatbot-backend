// ======================================================
// FLOW VALIDATOR (Phase 6)
// Pure, synchronous, no DB/network access — the single source of
// truth for whether a flow is structurally and semantically valid.
// The frontend calls the same backend endpoint that runs this; there
// is no separate/duplicated client-side validator, so there is only
// ever one place these rules can drift from what actually executes.
// ======================================================

const NODE_TYPES = new Set([
  "start",
  "message",
  "question",
  "buttons",
  "aiResponse",
  "knowledgeBase",
  "condition",
  "webhook",
  "humanHandoff",
  "delay",
  "end",
]);

const QUESTION_INPUT_TYPES = new Set(["text", "email", "phone", "number"]);
const CONDITION_OPERATORS = new Set([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "exists",
  "not_exists",
  "greater_than",
  "less_than",
]);
const WEBHOOK_METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

export const MAX_DELAY_MS = 4000;
export const MAX_WEBHOOK_TIMEOUT_MS = 8000;

function err(nodeId, code, message) {
  return { nodeId: nodeId ?? null, code, message };
}

function isValidUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function validateNodeData(node) {
  const errors = [];
  const d = node.data || {};

  switch (node.type) {
    case "message": {
      if (!d.message || !String(d.message).trim()) {
        errors.push(err(node.id, "MESSAGE_EMPTY", "Message text is required."));
      }
      break;
    }

    case "question": {
      if (!d.question || !String(d.question).trim()) {
        errors.push(err(node.id, "QUESTION_EMPTY", "Question text is required."));
      }
      if (!d.variable || !String(d.variable).trim()) {
        errors.push(err(node.id, "QUESTION_NO_VARIABLE", "A variable name is required."));
      } else if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(d.variable)) {
        errors.push(err(node.id, "QUESTION_INVALID_VARIABLE", "Variable name must be alphanumeric (dots allowed), e.g. flow.email."));
      }
      if (d.inputType && !QUESTION_INPUT_TYPES.has(d.inputType)) {
        errors.push(err(node.id, "QUESTION_INVALID_TYPE", `Unsupported input type "${d.inputType}".`));
      }
      break;
    }

    case "buttons": {
      if (!d.message || !String(d.message).trim()) {
        errors.push(err(node.id, "BUTTONS_MESSAGE_EMPTY", "Message text is required."));
      }
      const buttons = Array.isArray(d.buttons) ? d.buttons : [];
      if (buttons.length === 0) {
        errors.push(err(node.id, "BUTTONS_EMPTY", "At least one button is required."));
      }
      const seen = new Set();
      buttons.forEach((b, i) => {
        if (!b?.label || !String(b.label).trim()) {
          errors.push(err(node.id, "BUTTON_LABEL_EMPTY", `Button ${i + 1} is missing a label.`));
        }
        const value = String(b?.value ?? b?.label ?? "").trim();
        if (!value) {
          errors.push(err(node.id, "BUTTON_VALUE_EMPTY", `Button ${i + 1} is missing a value.`));
        } else if (seen.has(value.toLowerCase())) {
          errors.push(err(node.id, "BUTTON_DUPLICATE_VALUE", `Duplicate button value "${value}".`));
        } else {
          seen.add(value.toLowerCase());
        }
      });
      break;
    }

    case "aiResponse": {
      if (d.temperature !== undefined) {
        const t = Number(d.temperature);
        if (Number.isNaN(t) || t < 0 || t > 1) {
          errors.push(err(node.id, "AI_INVALID_TEMPERATURE", "Temperature must be between 0 and 1."));
        }
      }
      if (d.maxTokens !== undefined) {
        const m = Number(d.maxTokens);
        if (Number.isNaN(m) || m < 1 || m > 2000) {
          errors.push(err(node.id, "AI_INVALID_MAX_TOKENS", "Max tokens must be between 1 and 2000."));
        }
      }
      break;
    }

    case "knowledgeBase": {
      // Reuses Company.knowledgeFile — nothing node-specific is
      // required, `instructions` and `fallback` are optional.
      break;
    }

    case "condition": {
      if (!d.variable || !String(d.variable).trim()) {
        errors.push(err(node.id, "CONDITION_NO_VARIABLE", "A variable is required."));
      }
      if (!d.operator || !CONDITION_OPERATORS.has(d.operator)) {
        errors.push(err(node.id, "CONDITION_INVALID_OPERATOR", "A valid operator is required."));
      }
      if (
        d.operator &&
        !["exists", "not_exists"].includes(d.operator) &&
        (d.value === undefined || d.value === null || String(d.value).trim() === "")
      ) {
        errors.push(err(node.id, "CONDITION_NO_VALUE", "A comparison value is required for this operator."));
      }
      break;
    }

    case "webhook": {
      if (!isValidUrl(d.url)) {
        errors.push(err(node.id, "WEBHOOK_INVALID_URL", "A valid http(s) URL is required."));
      }
      if (!d.method || !WEBHOOK_METHODS.has(String(d.method).toUpperCase())) {
        errors.push(err(node.id, "WEBHOOK_INVALID_METHOD", "Method must be one of GET, POST, PUT, PATCH."));
      }
      if (d.timeout !== undefined) {
        const t = Number(d.timeout);
        if (Number.isNaN(t) || t < 500 || t > MAX_WEBHOOK_TIMEOUT_MS) {
          errors.push(err(node.id, "WEBHOOK_INVALID_TIMEOUT", `Timeout must be between 500 and ${MAX_WEBHOOK_TIMEOUT_MS}ms.`));
        }
      }
      break;
    }

    case "humanHandoff": {
      if (!d.message || !String(d.message).trim()) {
        errors.push(err(node.id, "HANDOFF_MESSAGE_EMPTY", "A message shown to the visitor is required."));
      }
      break;
    }

    case "delay": {
      const duration = Number(d.duration);
      if (Number.isNaN(duration) || duration < 0) {
        errors.push(err(node.id, "DELAY_INVALID_DURATION", "Duration must be a non-negative number of milliseconds."));
      } else if (duration > MAX_DELAY_MS) {
        errors.push(err(node.id, "DELAY_EXCEEDS_MAXIMUM", `Duration cannot exceed ${MAX_DELAY_MS}ms.`));
      }
      break;
    }

    case "end":
    case "start":
    default:
      break;
  }

  return errors;
}

/**
 * @param {{nodes: any[], edges: any[], startNodeId?: string}} flow
 * @returns {{valid: boolean, errors: {nodeId: string|null, code: string, message: string}[]}}
 */
export function validateFlow(flow) {
  const errors = [];
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];

  if (nodes.length === 0) {
    errors.push(err(null, "FLOW_EMPTY", "The flow has no nodes."));
    return { valid: false, errors };
  }

  // ---- Structural: duplicate IDs, unsupported types ----
  const idCounts = new Map();
  for (const node of nodes) {
    if (!node?.id) {
      errors.push(err(null, "NODE_MISSING_ID", "A node is missing an id."));
      continue;
    }
    idCounts.set(node.id, (idCounts.get(node.id) || 0) + 1);
    if (!NODE_TYPES.has(node.type)) {
      errors.push(err(node.id, "NODE_UNSUPPORTED_TYPE", `Unsupported node type "${node.type}".`));
    }
  }
  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      errors.push(err(id, "NODE_DUPLICATE_ID", `Duplicate node id "${id}".`));
    }
  }

  const nodeIds = new Set(nodes.filter((n) => n?.id).map((n) => n.id));

  // ---- Structural: Start node ----
  const startNodes = nodes.filter((n) => n.type === "start");
  if (startNodes.length === 0) {
    errors.push(err(null, "FLOW_NO_START", "The flow has no Start node."));
  } else if (startNodes.length > 1) {
    errors.push(err(null, "FLOW_MULTIPLE_START", "Only one Start node is allowed."));
  }

  // ---- Structural: edges ----
  const edgeIds = new Set();
  for (const edge of edges) {
    if (!edge?.id) {
      errors.push(err(null, "EDGE_MISSING_ID", "An edge is missing an id."));
    } else if (edgeIds.has(edge.id)) {
      errors.push(err(null, "EDGE_DUPLICATE_ID", `Duplicate edge id "${edge.id}".`));
    } else {
      edgeIds.add(edge.id);
    }

    if (!edge?.source || !nodeIds.has(edge.source)) {
      errors.push(err(edge?.id, "EDGE_INVALID_SOURCE", `Edge references a nonexistent source node "${edge?.source}".`));
    }
    if (!edge?.target || !nodeIds.has(edge.target)) {
      errors.push(err(edge?.id, "EDGE_INVALID_TARGET", `Edge references a nonexistent target node "${edge?.target}".`));
    }
    if (edge?.source && edge?.target && edge.source === edge.target) {
      errors.push(err(edge?.id, "EDGE_SELF_REFERENCE", "A node cannot connect to itself."));
    }
  }

  // ---- Node-level config validation ----
  for (const node of nodes) {
    if (!node?.id || !NODE_TYPES.has(node.type)) continue;
    errors.push(...validateNodeData(node));
  }

  // ---- Buttons: every button needs a resolvable target ----
  const outgoingByNode = new Map();
  for (const edge of edges) {
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    outgoingByNode.get(edge.source).push(edge);
  }
  for (const node of nodes) {
    if (node.type !== "buttons") continue;
    const buttons = Array.isArray(node.data?.buttons) ? node.data.buttons : [];
    const outgoing = outgoingByNode.get(node.id) || [];
    buttons.forEach((b, i) => {
      const value = String(b?.value ?? b?.label ?? "").trim();
      const hasTarget = outgoing.some((e) => (e.sourceHandle || "") === value);
      if (value && !hasTarget) {
        errors.push(err(node.id, "BUTTON_NO_TARGET", `Button ${i + 1} ("${b?.label || value}") has no connected next node.`));
      }
    });
  }

  // ---- Condition: needs both true/false branches ----
  for (const node of nodes) {
    if (node.type !== "condition") continue;
    const outgoing = outgoingByNode.get(node.id) || [];
    const hasTrue = outgoing.some((e) => e.sourceHandle === "true");
    const hasFalse = outgoing.some((e) => e.sourceHandle === "false");
    if (!hasTrue) errors.push(err(node.id, "CONDITION_NO_TRUE_BRANCH", "The TRUE branch is not connected."));
    if (!hasFalse) errors.push(err(node.id, "CONDITION_NO_FALSE_BRANCH", "The FALSE branch is not connected."));
  }

  return { valid: errors.length === 0, errors };
}
