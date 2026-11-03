// Single source of truth for Company.industry/companySize — matches
// the enum in models/company.model.js exactly. Deliberately the same
// four values as the CHATBOT sector templates (services/sectors/index.js)
// plus "Other": a company picks what kind of business it is at sign-up,
// then (separately) picks a chatbot template per chatbot it creates —
// the two lists are kept aligned on purpose so "Energy" means the same
// thing in both places, but choosing one never sets the other.
export const INDUSTRIES = ["Energy", "Education", "Digital Marketing", "General", "Other"];

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
