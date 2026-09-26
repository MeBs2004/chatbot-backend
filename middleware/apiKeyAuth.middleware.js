import ApiKey from "../models/apiKey.model.js";
import Company from "../models/company.model.js";
import ApiUsage from "../models/apiUsage.model.js";
import { extractKeyPrefix, verifyToken } from "../utils/apiKeyToken.js";
import { checkRateLimit } from "../services/apiRateLimiter.service.js";
import { sendError } from "../utils/apiResponse.js";

// ======================================================
// API KEY AUTHENTICATION (Phase 12)
// The authentication mechanism for /api/v1/developer/* — entirely
// separate from admin JWT auth (adminAuth.middleware.js, untouched).
// An API key can never log into the admin panel; an admin JWT can
// never authenticate here (Section 35).
//
// Every value used for authorization below (companyId, chatbotIds,
// scopes) comes from the verified ApiKey record — NEVER from the
// request body/query/params (Section 10, 33). Route handlers must
// use req.apiKeyContext.company.companyId, not anything the caller
// supplied.
// ======================================================

function recordUsage(req, res, apiKeyId, companyId) {
  res.on("finish", () => {
    ApiUsage.create({
      companyId,
      apiKeyId,
      method: req.method,
      path: req.baseUrl + req.path,
      statusCode: res.statusCode,
      rateLimited: res.statusCode === 429,
    }).catch((err) => console.error("API usage record failed:", err.message));
  });
}

export async function apiKeyAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (!token) {
      return sendError(res, 401, "INVALID_API_KEY", "Missing API key. Use 'Authorization: Bearer nf_live_...'.");
    }

    const keyPrefix = extractKeyPrefix(token);
    if (!keyPrefix) {
      return sendError(res, 401, "INVALID_API_KEY", "Malformed API key.");
    }

    const apiKey = await ApiKey.findOne({ keyPrefix });
    if (!apiKey || !verifyToken(token, apiKey.secretHash)) {
      // Same generic response whether the prefix wasn't found or the
      // hash didn't match — never confirms a prefix's existence.
      return sendError(res, 401, "INVALID_API_KEY", "Invalid API key.");
    }

    if (apiKey.status === "REVOKED") {
      return sendError(res, 403, "API_KEY_REVOKED", "This API key has been revoked.");
    }

    if (apiKey.status === "EXPIRED" || (apiKey.expiresAt && apiKey.expiresAt < new Date())) {
      if (apiKey.status !== "EXPIRED") {
        apiKey.status = "EXPIRED";
        await apiKey.save();
      }
      return sendError(res, 403, "API_KEY_EXPIRED", "This API key has expired.");
    }

    const company = await Company.findOne({ companyId: apiKey.companyId }).lean();
    if (!company) {
      return sendError(res, 403, "COMPANY_ACCESS_DENIED", "The company for this API key no longer exists.");
    }
    if (company.status === "SUSPENDED") {
      return sendError(res, 403, "COMPANY_ACCESS_DENIED", "This company's account is suspended.");
    }

    const limit = company.developer?.rateLimitPerMinute || 100;
    const rate = checkRateLimit(apiKey._id, limit);
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(rate.resetAt / 1000)));

    recordUsage(req, res, apiKey._id, apiKey.companyId);

    if (!rate.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((rate.resetAt - Date.now()) / 1000)));
      return sendError(res, 429, "RATE_LIMITED", "Too many requests. Please slow down.");
    }

    // Fire-and-forget — never blocks the response on a write.
    ApiKey.updateOne({ _id: apiKey._id }, { lastUsedAt: new Date() }).catch(() => {});

    req.apiKeyContext = {
      apiKey,
      company,
      companyId: company.companyId,
      chatbotIds: apiKey.chatbotIds.map(String),
      scopes: apiKey.scopes,
    };

    next();
  } catch (error) {
    console.error("API Key Auth Middleware Error:", error);
    return sendError(res, 500, "INTERNAL_ERROR", "Authentication failed.");
  }
}

/**
 * requireScope("conversations:write") — 403 INSUFFICIENT_SCOPE if
 * the authenticated key doesn't have it. Must run after
 * apiKeyAuthMiddleware.
 */
export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKeyContext?.scopes?.includes(scope)) {
      return sendError(res, 403, "INSUFFICIENT_SCOPE", `This API key does not have the '${scope}' scope.`);
    }
    next();
  };
}

/**
 * Verifies a specific chatbotId (already loaded from the DB, never
 * from raw user input) is within this key's chatbot restriction.
 * Empty chatbotIds on the key means "whole company" — always true.
 */
export function isChatbotAllowed(req, chatbotId) {
  const { chatbotIds } = req.apiKeyContext;
  return chatbotIds.length === 0 || chatbotIds.includes(String(chatbotId));
}
