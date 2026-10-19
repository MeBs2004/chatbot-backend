import Chatbot from "../../models/chatbot.model.js";

export const MAX_INSTALLATIONS = 20;
// A busy site starts a session on every page view; only touch the DB
// when a website's lastSeenAt is older than this.
const REFRESH_AFTER_MS = 5 * 60 * 1000;

function siteOrigin(req) {
  const header = req.headers.origin || req.headers.referer;
  if (!header) return null;
  try {
    const { origin } = new URL(header);
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Records that this chatbot's widget is running on the requesting
 * website. Call only after the session was granted (so a rejected site
 * is never recorded). At most two small updates; never throws.
 */
export async function recordInstallation(chatbotId, req) {
  const origin = siteOrigin(req);
  if (!origin) return;
  const now = new Date();
  try {
    const refreshed = await Chatbot.updateOne(
      { _id: chatbotId, installations: { $elemMatch: { origin, lastSeenAt: { $lt: new Date(now - REFRESH_AFTER_MS) } } } },
      { $set: { "installations.$.lastSeenAt": now } }
    );
    if (refreshed.matchedCount > 0) return;

    // Not refreshed: either new, or seen within the last few minutes.
    await Chatbot.updateOne(
      { _id: chatbotId, "installations.origin": { $ne: origin } },
      {
        $push: {
          installations: { $each: [{ origin, lastSeenAt: now }], $sort: { lastSeenAt: -1 }, $slice: MAX_INSTALLATIONS },
        },
      }
    );
  } catch (err) {
    console.error("Record Installation Error:", err.message);
  }
}
