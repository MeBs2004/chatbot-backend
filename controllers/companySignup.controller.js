import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import { signAdminToken } from "../services/admin/token.service.js";
import { logAction } from "../services/admin/audit.service.js";
import { INDUSTRIES } from "../config/industries.js";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A chosen workspace slug must never collide with a real platform
// route or a confusing/impersonating word. Deliberately generous —
// this list errs toward over-blocking rather than letting something
// ambiguous through.
const RESERVED_SLUGS = new Set([
  "admin", "api", "www", "app", "dashboard", "login", "logout", "signup",
  "signin", "register", "settings", "billing", "developer", "company",
  "companies", "super", "superadmin", "root", "system", "null", "undefined",
  "test", "support", "help", "static", "assets", "public", "nuformly",
  "nuform", "oya", "gemkara", "account", "accounts", "user", "users",
  "chatbot", "chatbots", "widget", "embed", "webhook", "webhooks",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// Returns null when valid, or a user-facing reason string when not —
// shared by both the live check-slug endpoint and final registration
// so the two can never disagree about what's a valid slug.
function invalidSlugReason(slug) {
  if (!SLUG_RE.test(slug)) {
    return "Workspace URL must be 3-48 characters: lowercase letters, numbers, and hyphens only, not starting or ending with a hyphen.";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return "This workspace URL is reserved. Please choose another.";
  }
  return null;
}

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
};

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

export const registerCompany = async (req, res) => {
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
  } = req.body;

  // ---- Validation (mirrors acceptInvitation's conventions) ----
  if (!companyName.trim()) {
    return res.status(400).json({ success: false, message: "Company name is required." });
  }
  if (!adminName.trim()) {
    return res.status(400).json({ success: false, message: "Your full name is required." });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, message: "Please enter a valid work email address." });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: "Passwords do not match." });
  }
  if (website && typeof website !== "string") {
    return res.status(400).json({ success: false, message: "Invalid website." });
  }
  if (phone && (typeof phone !== "string" || phone.length > 32)) {
    return res.status(400).json({ success: false, message: "Invalid phone number." });
  }
  if (!industry || !INDUSTRIES.includes(industry)) {
    return res.status(400).json({ success: false, message: "Please select a valid industry." });
  }
  if (companySize && !["1-10", "11-50", "51-200", "201-1000", "1000+"].includes(companySize)) {
    return res.status(400).json({ success: false, message: "Invalid company size." });
  }

  const normalizedEmail = email.trim().toLowerCase();

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
    return res.status(409).json({ success: false, message: "An account with this email already exists. Try logging in instead." });
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
      name: companyName.trim(),
      domain,
      website: website ? website.trim() : "",
      knowledgeFile: `${companyId}.txt`,
      industry,
      companySize: companySize || "",
      contact: { email: normalizedEmail, phone: phone ? phone.trim() : "" },
    });

    adminUser = new AdminUser({
      name: adminName.trim(),
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
};
