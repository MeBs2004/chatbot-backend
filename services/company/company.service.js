import Company from "../../models/company.model.js";

/**
 * Get company by companyId
 */
export const getCompanyById = async (companyId) => {
  try {
    if (!companyId) {
      return null;
    }

    // Excludes knowledgeContent (up to 2MB) — this runs on every
    // single public request (visitor pings, suggestions, messages,
    // not just AI replies), and nothing reads it off this object;
    // services/groq.service.js's loadKnowledge() does its own
    // dedicated, cached fetch of just that field only when an AI
    // reply is actually being generated. Pulling it here on every
    // request would be exactly the "read a huge Knowledge Base
    // unnecessarily for every message" mistake the Mongo migration
    // was supposed to avoid, not just the ephemeral-disk one.
    const company = await Company.findOne({
      companyId: companyId.trim(),
      isActive: true,
    })
      .select("-knowledgeContent")
      .lean();

    return company;
  } catch (error) {
    console.error("getCompanyById Error:", error);
    return null;
  }
};

/**
 * Get company by domain
 */
export const getCompanyByDomain = async (domain) => {
  try {
    if (!domain) {
      return null;
    }

    const company = await Company.findOne({
      domain: domain.trim(),
      isActive: true,
    })
      .select("-knowledgeContent")
      .lean();

    return company;
  } catch (error) {
    console.error("getCompanyByDomain Error:", error);
    return null;
  }
};