// ======================================================
// PHASE 5.2, TASK 4 — one place that decides how an EnergyEnquiry's
// location is presented, so the supplier-notification email and any
// other future consumer can't drift out of sync on the same
// "structured first, legacy fallback" rule. Never invents a field
// that wasn't actually recorded.
// ======================================================

function hasStructuredLocation(location) {
  return Boolean(location && (location.country || location.state || location.city || location.postalCode));
}

/** Plain-text block for an email/plaintext context. Priority: structured fields (whichever are present) > legacy projectLocation > "Not provided". */
export function formatEnquiryLocation(enquiry) {
  const location = enquiry?.location;
  if (hasStructuredLocation(location)) {
    const lines = [];
    if (location.city) lines.push(`City: ${location.city}`);
    if (location.state) lines.push(`State: ${location.state}`);
    if (location.country) lines.push(`Country: ${location.country}`);
    if (location.postalCode) lines.push(`Postal Code: ${location.postalCode}`);
    return lines.join("\n");
  }
  if (enquiry?.projectLocation) return enquiry.projectLocation;
  return "Not provided";
}
