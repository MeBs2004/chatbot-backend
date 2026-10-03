import { getLiveView } from "../../services/liveView.service.js";
import { getConversationPermissions } from "../../services/conversation.service.js";

export const getLiveViewData = async (req, res) => {
  try {
    const { visitors, stats } = await getLiveView(req.adminUser, req.query);

    return res.status(200).json({
      success: true,
      visitors,
      stats,
      // Same reused pattern as ConversationsInbox's per-conversation
      // permission flags — one gate per role, computed once here
      // rather than the frontend guessing what its own role can do.
      permissions: getConversationPermissions(req.adminUser.role),
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    console.error("Get Live View Error:", error);
    return res.status(500).json({ success: false, message: "Failed to load live view." });
  }
};
