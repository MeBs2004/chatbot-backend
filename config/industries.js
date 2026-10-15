// Single source of truth for Company.industry/companySize — matches
// the enum in models/company.model.js exactly. Distinct from the
// four CHATBOT sectors used elsewhere in the product: this describes
// what business the COMPANY itself is in, not what kind of chatbot
// it builds.
export const INDUSTRIES = [
  "Energy",
  "Education",
  "Digital Marketing",
  "Technology",
  "Finance",
  "Healthcare",
  "E-commerce",
  "Other",
];

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
