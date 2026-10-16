import crypto from "crypto";
import jwt from "jsonwebtoken";

// ======================================================
// WIDGET SESSION TOKEN
// Issued by POST /api/widget/session — the one public request that
// runs on the customer's own page, where the browser sends the real
// site Origin — and carried by every later widget call from the chat
// iframe (whose Origin is always the widget CDN). The token is what
// binds those calls to one chatbot and its company.
//
// Signed with a key DERIVED from JWT_SECRET, never JWT_SECRET itself,
// so a widget token can't pass as an admin JWT or the reverse.
// ======================================================

const AUDIENCE = "nuformly-widget";
const EXPIRES_IN = "12h";

export class WidgetTokenError extends Error {
  constructor(code) {
    super(code === "WIDGET_TOKEN_EXPIRED" ? "Widget session expired." : "Invalid widget session.");
    this.code = code;
    this.status = 401;
  }
}

function signingKey() {
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update("nuformly-widget-token").digest();
}

export function signWidgetToken({ chatbotId, companyId }) {
  const token = jwt.sign({ cid: String(chatbotId), co: companyId }, signingKey(), {
    algorithm: "HS256",
    audience: AUDIENCE,
    expiresIn: EXPIRES_IN,
  });
  const { exp } = jwt.decode(token);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyWidgetToken(token) {
  if (typeof token !== "string" || !token) throw new WidgetTokenError("WIDGET_TOKEN_INVALID");
  let payload;
  try {
    payload = jwt.verify(token, signingKey(), { algorithms: ["HS256"], audience: AUDIENCE });
  } catch (err) {
    throw new WidgetTokenError(err.name === "TokenExpiredError" ? "WIDGET_TOKEN_EXPIRED" : "WIDGET_TOKEN_INVALID");
  }
  if (typeof payload.cid !== "string" || typeof payload.co !== "string") {
    throw new WidgetTokenError("WIDGET_TOKEN_INVALID");
  }
  return { chatbotId: payload.cid, companyId: payload.co };
}
