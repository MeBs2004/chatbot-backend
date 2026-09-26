// ======================================================
// DEVELOPER API v1 RESPONSE FORMAT (Phase 12, Section 26)
// Used ONLY by /api/v1/developer/* — existing /api/admin and
// /bot/v1 response shapes are untouched.
// ======================================================

export function sendSuccess(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function sendError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}
