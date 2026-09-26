import { Server } from "socket.io";
import mongoose from "mongoose";
import AdminUser from "../../models/adminUser.model.js";
import Chatbot from "../../models/chatbot.model.js";
import Company from "../../models/company.model.js";
import { verifyAdminToken } from "../admin/token.service.js";
import { hasCompanyAccess, hasChatbotAccess, getAccessibleCompanyIds } from "../admin/access.service.js";
import { setIO, companyRoom, chatbotRoom, widgetChatbotRoom } from "./io.js";

// Phase 15 — realtime layer. Two namespaces, deliberately separate
// (Section 44): `/admin` carries the same JWT the REST admin API
// already trusts (adminAuthMiddleware's exact logic, reused here, not
// re-implemented) and only ever joins rooms the connected user is
// actually authorized for (reusing access.service.js — the same
// service the REST endpoints already gate on, so there is exactly one
// tenant-isolation implementation, not two). `/widget` is
// unauthenticated by design (same trust model as /bot/v1/* and
// /api/widget/config/:chatbotId) and can only ever join a single
// per-chatbot room that receives nothing but the same whitelisted
// config shape the public REST config endpoint already returns.
//
// Chosen over raw `ws`: Socket.IO transparently falls back to HTTP
// long-polling when a native WebSocket upgrade is blocked by a proxy
// or unsupported by the hosting platform (Section 69/71 — this
// repo's backend deployment target was not conclusively identified
// during the audit; this makes that uncertainty non-fatal instead of
// picking an architecture that silently does nothing in production).

const MAX_CONNECTIONS_PER_IP = Number(process.env.SOCKET_MAX_CONNECTIONS_PER_IP) || 20;
const connectionsByIp = new Map();

function clientIp(socket) {
  return socket.handshake.address || socket.conn.remoteAddress || "unknown";
}

function trackConnection(socket) {
  const ip = clientIp(socket);
  const count = (connectionsByIp.get(ip) || 0) + 1;
  connectionsByIp.set(ip, count);
  socket.once("disconnect", () => {
    const next = (connectionsByIp.get(ip) || 1) - 1;
    if (next <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, next);
  });
  return count;
}

// Socket.IO's CORS is configured once per Server, not per-namespace
// (both /admin and /widget share the same underlying HTTP upgrade/
// polling transport) — so this can't mirror index.js's per-path
// origin split the way the plain REST CORS middleware does. Left
// wide open here deliberately, matching the /bot/v1/* and
// /api/widget/config/:chatbotId branches: CORS only controls which
// browser origins can INITIATE the handshake, it is not this
// project's access-control layer for /admin — that's the JWT
// verified in the `/admin` namespace middleware below, which an
// attacker gets no benefit from bypassing CORS to reach (they'd still
// need a valid, non-expired token for an ACTIVE admin user).
function corsOptions() {
  return { origin: true, credentials: true };
}

export function initRealtime(httpServer) {
  const io = new Server(httpServer, { cors: corsOptions() });

  setIO(io);

  const admin = io.of("/admin");
  const widget = io.of("/widget");

  // ── /admin — authenticated, tenant-scoped ────────────────────────
  admin.use(async (socket, next) => {
    try {
      if (trackConnection(socket) > MAX_CONNECTIONS_PER_IP) {
        return next(new Error("Too many connections from this address."));
      }

      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required."));

      let payload;
      try {
        payload = verifyAdminToken(token);
      } catch {
        return next(new Error("Session expired."));
      }

      const adminUser = await AdminUser.findById(payload.sub);
      if (!adminUser || adminUser.status !== "ACTIVE") {
        return next(new Error("Session expired."));
      }

      socket.adminUser = adminUser;
      next();
    } catch (err) {
      console.error("Realtime Admin Auth Error:", err);
      next(new Error("Authentication failed."));
    }
  });

  admin.on("connection", (socket) => {
    // Every admin user gets their own private room too — used for
    // user-scoped notices (e.g. "your permissions changed") without
    // needing a company context.
    socket.join(`user:${socket.adminUser._id}`);

    socket.on("subscribe:company", async (companyId, ack) => {
      try {
        if (typeof companyId !== "string" || !companyId.trim()) {
          return ack?.({ success: false, message: "companyId required." });
        }
        const allowed = await hasCompanyAccess(socket.adminUser, companyId);
        if (!allowed) return ack?.({ success: false, message: "Not authorized for this company." });

        socket.join(companyRoom(companyId));
        ack?.({ success: true });
      } catch (err) {
        console.error("subscribe:company error:", err);
        ack?.({ success: false, message: "Subscription failed." });
      }
    });

    socket.on("unsubscribe:company", (companyId) => {
      if (typeof companyId === "string") socket.leave(companyRoom(companyId));
    });

    // For pages that legitimately span every company the admin can
    // see at once (e.g. the cross-company Conversations inbox) —
    // resolved server-side from the SAME access.service.js used by
    // the REST /conversations list endpoint, so the set of rooms
    // joined here can never be wider than what that endpoint would
    // actually return rows for.
    socket.on("subscribe:accessible-companies", async (_data, ack) => {
      try {
        const ids = await getAccessibleCompanyIds(socket.adminUser);
        const companyIds = ids === null ? (await Company.find({}).select("companyId").lean()).map((c) => c.companyId) : ids;

        companyIds.forEach((id) => socket.join(companyRoom(id)));
        ack?.({ success: true, count: companyIds.length });
      } catch (err) {
        console.error("subscribe:accessible-companies error:", err);
        ack?.({ success: false, message: "Subscription failed." });
      }
    });

    socket.on("subscribe:chatbot", async (chatbotId, ack) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(chatbotId)) {
          return ack?.({ success: false, message: "Invalid chatbotId." });
        }
        const allowed = await hasChatbotAccess(socket.adminUser, chatbotId);
        if (!allowed) return ack?.({ success: false, message: "Not authorized for this chatbot." });

        socket.join(chatbotRoom(chatbotId));
        ack?.({ success: true });
      } catch (err) {
        console.error("subscribe:chatbot error:", err);
        ack?.({ success: false, message: "Subscription failed." });
      }
    });

    socket.on("unsubscribe:chatbot", (chatbotId) => {
      if (typeof chatbotId === "string") socket.leave(chatbotRoom(chatbotId));
    });
  });

  // ── /widget — public, single-purpose ─────────────────────────────
  // Deliberately wide-open CORS (same trust model as /bot/v1/* and
  // /api/widget/config/:chatbotId — a customer's embed can be any
  // origin). The ONLY thing a connection here can ever do is sit in
  // its own chatbot's config room; there is no subscribe/unsubscribe
  // surface at all, so there is nothing to authorize beyond "does
  // this chatbotId exist," matching the public config endpoint.
  widget.use((socket, next) => {
    try {
      if (trackConnection(socket) > MAX_CONNECTIONS_PER_IP) {
        return next(new Error("Too many connections from this address."));
      }
      next();
    } catch (err) {
      next(new Error("Connection failed."));
    }
  });

  widget.on("connection", async (socket) => {
    try {
      const { chatbotId } = socket.handshake.auth || {};
      if (!mongoose.Types.ObjectId.isValid(chatbotId)) {
        socket.disconnect(true);
        return;
      }

      // Existence check only — same rule as getPublicWidgetConfig:
      // a real chatbotId is enough to join its own public room, no
      // company header, no secret. Never joins any other room.
      const exists = await Chatbot.exists({ _id: chatbotId });
      if (!exists) {
        socket.disconnect(true);
        return;
      }

      socket.join(widgetChatbotRoom(chatbotId));
    } catch (err) {
      console.error("Realtime Widget Connection Error:", err);
      socket.disconnect(true);
    }
  });

  return io;
}
