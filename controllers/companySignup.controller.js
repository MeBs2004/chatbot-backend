import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";
import UserCompanyAccess from "../models/userCompanyAccess.model.js";
import { signAdminToken } from "../services/admin/token.service.js";
import { logAction } from "../services/admin/audit.service.js";
import { INDUSTRIES } from "../config/industries.js";
import { slugify, invalidSlugReason } from "../utils/companySlug.js";
import { checkName, checkCompanyName, checkEmail, checkPassword, normalizeEmail, tidy } from "../utils/accountRules.js";

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
  "password", "confirmPassword", "website", "phone", "companySize",
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
  // Older clients send a separate confirmation; the current page doesn't need one.
  if (confirmPassword && password !== confirmPassword) {
    return res.status(400).json({ success: false, message: "Passwords do not match." });
  }
  if (website && typeof website !== "string") {
    return res.status(400).json({ success: false, message: "Invalid website." });
  }
  if (phone && (typeof phone !== "string" || phone.length > 32)) {
    return res.status(400).json({ success: false, message: "Invalid phone number." });
  }
  if (!industry || !INDUSTRIES.includes(industry)) {
    return invalid("industry", "Please select a valid industry.");
  }
  if (companySize && !["1-10", "11-50", "51-200", "201-1000", "1000+"].includes(companySize)) {
    return res.status(400).json({ success: false, message: "Invalid company size." });
  }

  const normalizedEmail = normalizeEmail(email);

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
      contact: { email: normalizedEmail, phone: phone ? phone.trim() : "" },
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
