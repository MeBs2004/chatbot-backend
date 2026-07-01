import { getCompanyById } from "../services/company/company.service.js";

export const companyMiddleware = async (req, res, next) => {
  try {
    console.log("\n========== COMPANY MIDDLEWARE ==========");
    console.log("URL:", req.originalUrl);
    console.log("Method:", req.method);

    const companyId = req.headers["x-company-id"]?.trim();

    console.log("Company ID:", companyId);

    if (!companyId) {
      console.log("❌ Missing x-company-id header");

      return res.status(400).json({
        success: false,
        message: "Company ID is missing.",
      });
    }

    const company = await getCompanyById(companyId);

    if (!company) {
      console.log("❌ Company not found:", companyId);

      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    req.company = company;

    console.log("✅ Company Loaded");
    console.log("Name:", company.name);
    console.log("Company ID:", company.companyId);
    console.log("========================================\n");

    next();
  } catch (error) {
    console.error("❌ Company Middleware Error");
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Company middleware failed.",
      error: error.message,
    });
  }
};

export default companyMiddleware;