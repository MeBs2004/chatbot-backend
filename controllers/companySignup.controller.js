import crypto from "node:crypto";
import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import EmailOtp from "../models/emailOtp.model.js";
import { signAdminToken } from "../services/admin/token.service.js";
import { logAction } from "../services/admin/audit.service.js";
import { sendMail } from "../services/mail.service.js";
import { INDUSTRIES } from "../config/industries.js";
import { slugify, invalidSlugReason } from "../utils/companySlug.js";
import { checkName, checkCompanyName, checkEmail, checkPassword, checkPhone, normalizeEmail, tidy } from "../utils/accountRules.js";

// ======================================================
// EMAIL VERIFICATION (sign-up only)
//   POST /api/company-signup/send-otp { email } → emails a 6-digit code
//   POST /api/company-signup           { ..., otp } → the existing
//     endpoint now also requires that code, checked before anything
//     is created.
// A code is 6 digits, expires in 10 minutes, is single-use, and is
// capped at 5 wrong tries — generous for someone typing it off their
// phone, short enough that a brute force never completes in time.
// ======================================================

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
export const hashOtp = (code) => crypto.createHash("sha256").update(code).digest("hex");
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function otpEmail(code) {
  const text = `Your Nuformly verification code is: ${code}

This code expires in 10 minutes. If you didn't request this, you can ignore this email.

— The Nuformly team`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f7f4;font-family:Arial,Helvetica,sans-serif;color:#0b1f17">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;padding:36px 32px;border:1px solid #dfe9e3">
<tr><td style="font-size:22px;font-weight:800;color:#0d5537;padding-bottom:20px">Nuformly</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Verify your email</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3d5148;padding-bottom:20px">Enter this code to finish creating your Nuformly workspace:</td></tr>
<tr><td style="padding-bottom:20px"><div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#0d5537;background:#f2f7f4;border-radius:14px;padding:18px 0;text-align:center">${escapeHtml(code)}</div></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#55675f">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

function welcomeEmail(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const link = `${process.env.APP_URL || "https://admin-panel-one-vert.vercel.app"}/company/chatbots/new`;
  const text = `Hi ${first},

Thank you for creating an account! Let's go now create your first chatbot with Nuformly.

${link}

— The Nuformly team`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f7f4;font-family:Arial,Helvetica,sans-serif;color:#0b1f17">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:36px 32px;border:1px solid #dfe9e3">
<tr><td style="font-size:22px;font-weight:800;color:#0d5537;padding-bottom:20px">Nuformly</td></tr>
<tr><td style="font-size:20px;font-weight:700;padding-bottom:12px">Welcome, ${escapeHtml(first)}! 🎉</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3d5148;padding-bottom:24px">Thank you for creating an account! Let's go now create your first chatbot with Nuformly.</td></tr>
<tr><td style="padding-bottom:8px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0d5537;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:999px">Create your first chatbot</a></td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

// POST /api/company-signup/send-otp — emails a fresh code and replaces
// any still-pending one for this address. Deliberately honest about
// EMAIL_TAKEN (unlike password reset's generic answer): this is a
// sign-up form, so the visitor needs to know right away that this
// address already has an account, before they type a code for nothing.
export const sendSignupOtp = async (req, res) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const emailError = checkEmail(email, { forSignup: true });
    if (emailError) return res.status(400).json({ success: false, field: "email", message: emailError });

    const normalizedEmail = normalizeEmail(email);
    const existingUser = await AdminUser.findOne({ email: normalizedEmail }).select("_id").lean();
    if (existingUser) {
      return res.status(409).json({ success: false, field: "email", code: "EMAIL_TAKEN", message: "An account with this email already exists. Try logging in instead." });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    await EmailOtp.findOneAndUpdate(
      { email: normalizedEmail },
      { email: normalizedEmail, codeHash: hashOtp(code), expiresAt: new Date(Date.now() + OTP_TTL_MS), attempts: 0 },
      { upsert: true },
    );

    const { text, html } = otpEmail(code);
    await sendMail({ to: normalizedEmail, subject: "Your Nuformly verification code", text, html });

    return res.status(200).json({ success: true, message: "We've sent a 6-digit code to your email." });
  } catch (error) {
    console.error("Send Signup OTP Error:", error);
    return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
};

/** `{ ok: true }`, or `{ ok: false, message }` — never throws. Consumes the code on success (one-time use). Exported for tests. */
export async function verifySignupOtp(email, code) {
  const trimmed = typeof code === "string" ? code.trim() : "";
  if (!/^\d{6}$/.test(trimmed)) {
    return { ok: false, message: "Enter the 6-digit code we sent to your email." };
  }
  const record = await EmailOtp.findOne({ email });
  if (!record || record.expiresAt < new Date()) {
    if (record) await EmailOtp.deleteOne({ _id: record._id });
    return { ok: false, message: "That code has expired. Request a new one." };
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await EmailOtp.deleteOne({ _id: record._id });
    return { ok: false, message: "Too many incorrect attempts. Request a new code." };
  }
  if (hashOtp(trimmed) !== record.codeHash) {
    await EmailOtp.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    return { ok: false, message: "That code isn't right. Check your email and try again." };
  }
  await EmailOtp.deleteOne({ _id: record._id });
  return { ok: true };
}

// ======================================================
// PUBLIC COMPANY SELF-REGISTRATION
// Mounted OUTSIDE /api/admin (same convention as
// routes/invitationPublic.route.js) — everything under /api/admin
// always requires adminAuthMiddleware, so an unauthenticated flow
// lives at its own top-level path instead of carrying an exception
// inside that otherwise-uniform prefix.
//
// This is the ONLY public path that creates a Company. The existing
// POST /api/admin/companies stays SUPER_ADMIN-only and untouched.
// A successful call here creates exactly: one Company, one AdminUser
// (role COMPANY_ADMIN), and one UserCompanyAccess row granting that
// user COMPANY_ADMIN on that company — identical shape to what
// acceptInvitation already does when a new user joins an existing
// company, just with the Company itself also being new.
// ======================================================

function deriveDomain(website, companyId) {
  if (website && typeof website === "string") {
    const stripped = website
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/.*$/, "");
    if (stripped) return stripped;
  }
  // No website given — domain has no runtime routing dependency
  // anywhere in this codebase (confirmed: getCompanyByDomain has
  // zero callers), it's purely a display field. A clearly-labeled
  // placeholder is safe and never clobbers real DNS/routing behavior.
  return `${companyId}.no-domain.nuformly.pending`;
}

// GET /api/company-signup/check-slug?slug=... — live availability
// check for the Sign Up form. Deliberately returns only a boolean +
// reason, never anything about WHO owns a taken slug (no company
// name/email leak through this public, unauthenticated endpoint).
export const checkSlugAvailability = async (req, res) => {
  try {
    return await checkSlug(req, res);
  } catch (error) {
    console.error("Check Slug Error:", error);
    return res.status(500).json({ success: false, message: "Unable to check availability. Please try again." });
  }
};

async function checkSlug(req, res) {
  const slug = String(req.query.slug || "")
    .toLowerCase()
    .trim();

  if (!slug) {
    return res.status(400).json({ success: false, message: "slug is required." });
  }

  const reason = invalidSlugReason(slug);
  if (reason) {
    return res.status(200).json({ success: true, available: false, reason });
  }

  const existing = await Company.findOne({ companyId: slug }).select("_id").lean();
  return res.status(200).json({ success: true, available: !existing, reason: existing ? "This workspace URL is already taken." : null });
}

async function generateUniqueCompanyId(companyName) {
  const base = slugify(companyName) || "company";
  let candidate = base;
  let suffix = 2;
  // Bounded retry — a pathological name colliding 500 times is not a
  // real scenario; this guards against an infinite loop, not that.
  for (let i = 0; i < 500; i++) {
    const existing = await Company.findOne({ companyId: candidate }).select("_id").lean();
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  throw new Error("Could not generate a unique company ID.");
}

const SIGNUP_STRING_FIELDS = [
  "companyName", "workspaceSlug", "industry", "adminName", "email",
  "password", "confirmPassword", "website", "phone", "companySize", "otp",
];

// Every async step below (including validation) runs inside this
// try — Express 4 does not catch a rejected async handler, so an
// uncaught throw would leave the request hanging with no response.
export const registerCompany = async (req, res) => {
  try {
    // Non-string values (numbers, arrays, objects) would crash the
    // .trim() calls below and could smuggle Mongo query operators
    // into the lookups — reject them up front.
    const body = req.body || {};
    if (SIGNUP_STRING_FIELDS.some((f) => body[f] !== undefined && typeof body[f] !== "string")) {
      return res.status(400).json({ success: false, message: "Invalid request." });
    }
    return await register(req, res);
  } catch (error) {
    console.error("Company Self-Registration Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create your company. Please try again." });
  }
};

async function register(req, res) {
  const {
    companyName = "",
    workspaceSlug = "",
    industry = "",
    adminName = "",
    email = "",
    password = "",
    confirmPassword = "",
    website = "",
    phone = "",
    companySize = "",
    otp = "",
  } = req.body;

  // ---- Validation: the same rules the Sign Up page checks (utils/accountRules.js) ----
  // `field` tells the page which input to point at.
  const invalid = (field, message) => res.status(400).json({ success: false, field, message });
  const companyError = checkCompanyName(companyName);
  if (companyError) return invalid("companyName", companyError);
  const nameError = checkName(adminName);
  if (nameError) return invalid("adminName", nameError);
  const emailError = checkEmail(email, { forSignup: true });
  if (emailError) return invalid("email", emailError);
  const passwordError = checkPassword(password, { email, name: adminName, company: companyName });
  if (passwordError) return invalid("password", passwordError);
  const phoneError = checkPhone(phone);
  if (phoneError) return invalid("phone", phoneError);
  // Older clients send a separate confirmation; the current page doesn't need one.
  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ success: false, message: "Passwords do not match." });
  }
  if (website && typeof website !== "string") {
    return res.status(400).json({ success: false, message: "Invalid website." });
  }
  if (!industry || !INDUSTRIES.includes(industry)) {
    return invalid("industry", "Please select a valid industry.");
  }
  if (companySize && !["1-10", "11-50", "51-200", "201-1000", "1000+"].includes(companySize)) {
    return res.status(400).json({ success: false, message: "Invalid company size." });
  }

  const normalizedEmail = normalizeEmail(email);

  // The code sent by POST /send-otp — checked only once every free,
  // client-mirrorable field check above already passed (no point
  // spending a DB lookup verifying a code for an otherwise-invalid
  // submission), and consumed (one-time use) right here.
  const otpResult = await verifySignupOtp(normalizedEmail, otp);
  if (!otpResult.ok) return invalid("otp", otpResult.message);

  // A caller may submit a chosen slug (the normal Sign Up form path,
  // already live-checked client-side via GET check-slug) or omit it
  // entirely (any other integration hitting this endpoint directly).
  // Either way, uniqueness is re-verified here — the frontend's check
  // is a convenience, never trusted as the actual guarantee.
  let requestedSlug = null;
  if (workspaceSlug && String(workspaceSlug).trim()) {
    requestedSlug = String(workspaceSlug).toLowerCase().trim();
    const reason = invalidSlugReason(requestedSlug);
    if (reason) {
      return res.status(400).json({ success: false, message: reason });
    }
  }

  // Never allow registration to collide with an existing staff/company
  // account — same uniqueness guarantee acceptInvitation already
  // enforces, checked up front so we never create a Company only to
  // fail on the AdminUser step.
  const existingUser = await AdminUser.findOne({ email: normalizedEmail }).select("_id").lean();
  if (existingUser) {
    return res.status(409).json({ success: false, field: "email", code: "EMAIL_TAKEN", message: "An account with this email already exists. Try logging in instead." });
  }

  let company = null;
  let adminUser = null;
  try {
    let companyId;
    if (requestedSlug) {
      const existingSlug = await Company.findOne({ companyId: requestedSlug }).select("_id").lean();
      if (existingSlug) {
        return res.status(409).json({ success: false, message: "This workspace URL is already taken." });
      }
      companyId = requestedSlug;
    } else {
      companyId = await generateUniqueCompanyId(companyName);
    }
    const domain = deriveDomain(website, companyId);

    company = await Company.create({
      companyId,
      name: tidy(companyName),
      domain,
      website: website ? website.trim() : "",
      knowledgeFile: `${companyId}.txt`,
      industry,
      companySize: companySize || "",
      contact: { email: normalizedEmail, phone: tidy(phone) },
    });

    adminUser = new AdminUser({
      name: tidy(adminName),
      email: normalizedEmail,
      role: "COMPANY_ADMIN",
    });
    await adminUser.setPassword(password);
    await adminUser.save();

    company.createdBy = adminUser._id;
    await company.save();

    await UserCompanyAccess.create({
      userId: adminUser._id,
      companyId: company.companyId,
      role: "COMPANY_ADMIN",
      status: "ACTIVE",
    });

    const token = signAdminToken(adminUser);

    // logAction requires req.adminUser — there is no authenticated
    // actor yet on this public route, so we attach the just-created
    // user for this one fire-and-forget audit call only.
    req.adminUser = adminUser;
    await logAction(req, {
      action: "COMPANY_SELF_REGISTERED",
      resource: "Company",
      resourceId: company.companyId,
      companyId: company.companyId,
      metadata: { email: normalizedEmail },
    });

    // Best-effort — a slow/failed welcome email never blocks the account
    // that was already created (sendMail itself never throws).
    const { text, html } = welcomeEmail(adminUser.name);
    await sendMail({ to: adminUser.email, subject: "Welcome to Nuformly!", text, html });

    return res.status(201).json({
      success: true,
      token,
      user: adminUser.toJSON(),
      company: { companyId: company.companyId, name: company.name },
    });
  } catch (error) {
    // Compensating cleanup — nothing in this codebase wraps
    // multi-document writes in a transaction (confirmed: no
    // replica-set transaction usage anywhere), so a failure partway
    // through must not leave an orphaned Company and/or an
    // orphaned AdminUser (the latter would permanently occupy the
    // email address) behind. Reverse creation order, each
    // independently best-effort.
    if (adminUser?._id) {
      await UserCompanyAccess.deleteMany({ userId: adminUser._id }).catch(() => {});
      await AdminUser.deleteOne({ _id: adminUser._id }).catch(() => {});
    }
    if (company?._id) {
      await Company.deleteOne({ _id: company._id }).catch(() => {});
    }
    console.error("Company Self-Registration Error:", error);
    // A duplicate-key race on companyId (two concurrent signups
    // requesting the same slug) surfaces here as a Mongo E11000, not
    // as our own pre-check 409 above — still a clean, honest 409.
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, message: "This workspace URL was just taken. Please choose another." });
    }
    return res.status(500).json({ success: false, message: "Failed to create your company. Please try again." });
  }
}
