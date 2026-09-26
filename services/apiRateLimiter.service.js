// ======================================================
// API KEY RATE LIMITER (Phase 12, Section 28/44)
// A hand-rolled fixed-window limiter, not express-rate-limit —
// the per-company limit is dynamic (Company.developer.
// rateLimitPerMinute), and express-rate-limit's `max` option is
// designed around a static or IP-derived value, not a per-request
// DB-backed number resolved by upstream auth middleware. This is
// intentionally simple and IN-MEMORY, matching every other rate
// limiter already in this codebase (login, invitation accept, AI
// test — all express-rate-limit's own default MemoryStore).
//
// HONEST LIMITATION: this is single-process. In a multi-instance
// deployment (not the case today — see backend/index.js, one
// process), each instance would enforce its own independent window,
// so the effective limit would be (perInstanceLimit x instanceCount)
// rather than a true global limit. Documented, not hidden.
// ======================================================

const WINDOW_MS = 60 * 1000;
const windows = new Map(); // apiKeyId -> { windowStart, count }

export function checkRateLimit(apiKeyId, limitPerMinute) {
  const now = Date.now();
  const key = String(apiKeyId);
  let entry = windows.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    windows.set(key, entry);
  }

  entry.count += 1;

  return {
    allowed: entry.count <= limitPerMinute,
    limit: limitPerMinute,
    remaining: Math.max(0, limitPerMinute - entry.count),
    resetAt: entry.windowStart + WINDOW_MS,
  };
}

// Bounds the Map's size over a long-running process — without this,
// every distinct API key ever used (including revoked ones) would
// keep one entry forever.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, entry] of windows) {
    if (entry.windowStart < cutoff) windows.delete(key);
  }
}, 5 * 60 * 1000).unref();
