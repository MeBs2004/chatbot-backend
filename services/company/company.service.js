import Company from "../../models/company.model.js";

/**
 * Get company by companyId
 */
export const getCompanyById = async (companyId) => {
  try {
    if (!companyId) {
      return null;
    }

    const company = await Company.findOne({
      companyId: companyId.trim(),
      isActive: true,
    }).lean();

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
    }).lean();

    return company;
  } catch (error) {
    console.error("getCompanyByDomain Error:", error);
    return null;
  }
};