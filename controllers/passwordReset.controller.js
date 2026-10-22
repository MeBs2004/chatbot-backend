import crypto from "node:crypto";
import AdminUser from "../models/adminUser.model.js";
import { sendMail } from "../services/mail.service.js";
import { logAction } from "../services/admin/audit.service.js";

// ======================================================
// PUBLIC password reset for company accounts (the /company/login page).
// Mounted outside /api/admin, same convention as company sign-up.
//
//  POST /api/password-reset/forgot { email }        → emails a one-time link
//  GET  /api/password-reset/verify?token=…          → is the link still valid?
//  POST /api/password-reset/reset  { token, password } → sets the new password
//
// Security: the answer to /forgot never depends on whether the email
// exists; only a SHA-256 hash of the token is stored; links expire after
// 30 minutes and work once; a reset signs the account out everywhere
// (tokenVersion bump). Super-admin accounts are never reset here.
// ======================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const GENERIC_OK = "If an account exists for that email, we've sent a link to reset your password.";
const BAD_LINK = "This reset link is invalid or has expired. Please request a new one.";

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** Where the reset page lives: the calling admin-panel origin if allowlisted, else APP_URL. */
function appUrl(req) {
  const allowed = (process.env.ADMIN_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) return origin;
  return (process.env.APP_URL || allowed[0] || "http://localhost:5174").replace(/\/+$/, "");
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function resetEmail(name, link) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const text = `Hi ${first},

We received a request to reset the password for your Nuformly account.

Reset your password: ${link}

This link works once and expires in 30 minutes. If you didn't ask for this, you can ignore this email — your password won't change.

— The Nuformly team`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f7f4;font-family:Arial,Helvetica,sans-serif;color:#0b1f17">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:36px 32px;border:1px solid #dfe9e3">
<tr><td style="font-size:22px;font-weight:800;color:#0d5537;padding-bottom:20px">Nuformly</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Reset your password</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3d5148;padding-bottom:24px">Hi ${escapeHtml(first)}, we received a request to reset the password for your Nuformly account. Click the button below to choose a new one.</td></tr>
<tr><td style="padding-bottom:24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0d5537;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:999px">Reset password</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#55675f">This link works once and expires in 30 minutes. If you didn't ask for this, ignore this email — your password won't change.</td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#8a9b93;padding-top:20px;word-break:break-all">Button not working? Paste this into your browser:<br>${escapeHtml(link)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export const forgotPassword = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    const user = await AdminUser.findOne({ email });
    if (user && user.role !== "SUPER_ADMIN" && user.status === "ACTIVE") {
      const token = crypto.randomBytes(32).toString("hex");
      user.resetTokenHash = hashToken(token);
      user.resetTokenExpires = new Date(Date.now() + TOKEN_TTL_MS);
      await user.save();
      const link = `${appUrl(req)}/company/reset-password?token=${token}`;
      const { text, html } = resetEmail(user.name, link);
      await sendMail({ to: user.email, subject: "Reset your Nuformly password", text, html });
      req.adminUser = user;
      await logAction(req, { action: "PASSWORD_RESET_REQUESTED", resource: "AdminUser", resourceId: user._id });
    }
    // Same answer whether or not the account exists.
    return res.status(200).json({ success: true, message: GENERIC_OK });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

async function findByToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const user = await AdminUser.findOne({ resetTokenHash: hashToken(token), resetTokenExpires: { $gt: new Date() } });
  return user && user.role !== "SUPER_ADMIN" && user.status === "ACTIVE" ? user : null;
}

export const verifyResetToken = async (req, res) => {
  try {
    const user = await findByToken(req.query?.token);
    return res.status(200).json({ success: true, valid: Boolean(user) });
  } catch (error) {
    console.error("Verify Reset Token Error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    }
    if (password.length > 200) {
      return res.status(400).json({ success: false, message: "Password is too long." });
    }
    const user = await findByToken(token);
    if (!user) return res.status(400).json({ success: false, message: BAD_LINK });

    await user.setPassword(password);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    user.tokenVersion = (user.tokenVersion || 0) + 1; // signs out every existing session
    await user.save();

    req.adminUser = user;
    await logAction(req, { action: "PASSWORD_RESET", resource: "AdminUser", resourceId: user._id });
    return res.status(200).json({ success: true, message: "Your password has been updated. You can log in now." });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};
