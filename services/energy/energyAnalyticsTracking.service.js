import EnergyAnalyticsEvent, { ENERGY_ANALYTICS_EVENTS } from "../../models/energy/analyticsEvent.model.js";

// ======================================================
// PHASE 6 — write-side of Energy analytics. The single function every
// controller (public journey endpoints and the one public tracking
// endpoint) calls to record an event. Deliberately fire-and-forget:
// analytics must never be able to break the customer journey or an
// admin action, so this never throws — a failed write is logged and
// swallowed, never surfaced to the caller.
//
// Security: this function itself does NOT re-validate companyId/
// chatbotId ownership — callers are required to have already resolved
// both server-side (resolvePublicEnergyChatbot for the widget side,
// loadAuthorizedEnergyChatbot for admin-triggered events) before
// calling this. It never accepts a client-supplied companyId.
// ======================================================

export async function trackEnergyEvent({ companyId, chatbotId, visitorId, sessionId, eventName, fuelKey, projectTypeId, questionId, solutionTemplateId, enquiryId, supplierId, metadata }) {
  try {
    if (!ENERGY_ANALYTICS_EVENTS.includes(eventName)) {
      console.error("Track Energy Event: rejected unknown event name:", eventName);
      return;
    }
    if (!companyId || !chatbotId || !visitorId || !sessionId) {
      console.error("Track Energy Event: missing required identifiers, dropping event:", eventName);
      return;
    }
    await EnergyAnalyticsEvent.create({
      companyId,
      chatbotId,
      visitorId: String(visitorId).slice(0, 200),
      sessionId: String(sessionId).slice(0, 200),
      eventName,
      eventTimestamp: new Date(),
      fuelKey: fuelKey ? String(fuelKey).toLowerCase() : null,
      projectTypeId: projectTypeId || null,
      questionId: questionId || null,
      solutionTemplateId: solutionTemplateId || null,
      enquiryId: enquiryId || null,
      supplierId: supplierId || null,
      metadata: metadata || null,
    });
  } catch (error) {
    // Never let a tracking failure affect the caller's real operation.
    console.error("Track Energy Event Error:", eventName, error.message);
  }
}
