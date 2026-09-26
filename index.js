import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import crypto from "crypto";

import companyRoutes from "./routes/company.route.js";
import chatbotRoutes from "./routes/chatbot.route.js";
import suggestionRoutes from "./routes/suggestion.route.js";
import visitorRoutes from "./routes/visitor.route.js";
import adminRoutes from "./routes/admin/index.js";
import widgetConfigRoutes from "./routes/widget/config.route.js";
import telegramWebhookRoutes from "./routes/webhooks/telegram.route.js";
import invitationPublicRoutes from "./routes/invitationPublic.route.js";
import developerApiRoutes from "./routes/developerApi.route.js";

import companyMiddleware from "./middleware/company.middleware.js";
import { initRealtime } from "./services/realtime/socket.server.js";

dotenv.config();

/* =========================================================
   STARTUP ENV VALIDATION (Phase 18)
   Previously absent — a missing MONGO_URI/JWT_SECRET/Groq key
   would surface only as a confusing runtime failure on the first
   request that needed it (or, for JWT_SECRET, `jwt.sign` silently
   signing with `undefined`). Fails fast and clearly instead, before
   the process ever starts accepting traffic. Does not change
   behavior at all when the required vars are present.
========================================================= */
{
  const missing = [];
  if (!process.env.MONGO_URI) missing.push("MONGO_URI");
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (
    !process.env.GROQ_API_KEY_1 &&
    !process.env.GROQ_API_KEY_2 &&
    !process.env.GROQ_API_KEY_3 &&
    !process.env.GROQ_API_KEY_4 &&
    !process.env.GROQ_API_KEY_5
  ) {
    missing.push("GROQ_API_KEY_1..5 (at least one required)");
  }

  if (missing.length > 0) {
    console.error("FATAL: missing required environment variable(s):");
    missing.forEach((name) => console.error(`  - ${name}`));
    console.error("See backend/.env.example. Refusing to start.");
    process.exit(1);
  }
}

const app = express();

const PORT = process.env.PORT || 4002;

app.set("trust proxy", true);

/* =========================================================
   REQUEST CORRELATION (Phase 19)
   Previously absent — a production incident had no way to tie one
   request's controller/service/error logs together, or to correlate
   a client-reported failure with server-side logs at all. No new
   dependency: reuses an incoming `x-request-id` (so a reverse proxy
   or the frontend can supply its own trace id and have it carried
   through) or generates one with Node's built-in
   `crypto.randomUUID()`. Echoed back on the response header so a
   caller can report it. Never logs anything beyond this opaque id —
   no headers, no body, no tokens.
========================================================= */
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

/* =========================================================
   CORS
   Public /bot/v1/* widget routes stay wide open (unchanged
   behavior). /api/admin/* is restricted to known admin
   frontend origins since it carries authenticated staff
   requests.
========================================================= */

const ADMIN_ALLOWED_ORIGINS = (process.env.ADMIN_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/admin")) {
    const origin = req.headers.origin;

    if (origin && ADMIN_ALLOWED_ORIGINS.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }

    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Vary", "Origin");
  } else {
    res.header("Access-Control-Allow-Origin", "*");

    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS"
    );

    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-company-id"
    );

    res.header("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

/* =========================================================
   SECURITY HEADERS (Phase 14)
   Deliberately hand-rolled rather than pulling in `helmet` — this
   is a JSON API (no server-rendered HTML), so most of helmet's
   surface (CSP, X-Frame-Options) either doesn't apply or would need
   careful per-route tuning to avoid breaking the embeddable widget's
   own framing. These four are universally safe for a JSON API and
   need no per-route exception:
     - X-Content-Type-Options: stops a browser from MIME-sniffing a
       JSON/error response into something executable.
     - Referrer-Policy: avoids leaking full admin-panel/widget URLs
       (which can carry companyId/chatbotId) to third-party resources.
     - X-DNS-Prefetch-Control: off is the conservative default for
       an API host.
     - Strict-Transport-Security: only meaningful over HTTPS, which
       is how this API is actually deployed. Harmless as an HTTP
       response header even if a given request arrived over plain
       HTTP in a dev environment.
   CSP/X-Frame-Options are intentionally NOT set globally: /bot/v1/*
   and /api/widget/config exist specifically to be embedded/fetched
   from arbitrary third-party customer sites (Section 52's "no
   arbitrary command execution" is a widget-code concern, not a
   framing concern — the widget is designed to run on any customer
   domain), so a blanket frame-ancestors/X-Frame-Options would break
   the product. /api/admin/* is already origin-restricted by the CORS
   allowlist above, which is the actual control that matters for it.
========================================================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});

/* =========================================================
   BODY PARSER
========================================================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

/* =========================================================
   DATABASE
========================================================= */

mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  })
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Failed");
    console.error(err);
    process.exit(1);
  });

/* =========================================================
   HEALTH
   Reflects real MongoDB connection state via
   mongoose.connection.readyState (0=disconnected, 1=connected,
   2=connecting, 3=disconnecting) — never the connection string,
   credentials, or any other environment detail.
========================================================= */

const MONGO_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

app.get("/", (req, res) => {
  const mongoState = MONGO_STATES[mongoose.connection.readyState] || "unknown";
  res.status(200).json({
    success: true,
    message: "Nuformly Backend Running 🚀",
    status: "OK",
    mongo: mongoState,
  });
});

app.get("/health", (req, res) => {
  const mongoState = MONGO_STATES[mongoose.connection.readyState] || "unknown";
  const healthy = mongoose.connection.readyState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    mongo: mongoState,
  });
});

/* =========================================================
   ROUTES
========================================================= */

// Company
app.use(
  "/bot/v1/company",
  companyMiddleware,
  companyRoutes
);

// Chatbot
app.use(
  "/bot/v1",
  companyMiddleware,
  chatbotRoutes
);

// Suggestions
app.use(
  "/bot/v1/suggestions",
  companyMiddleware,
  suggestionRoutes
);

// Visitor
app.use(
  "/bot/v1/visitor",
  companyMiddleware,
  visitorRoutes
);

// Admin Control Center (own auth, not the public companyMiddleware)
app.use("/api/admin", adminRoutes);

// Public widget configuration (Phase 5) — no auth, no company
// header, chatbot-scoped by ID. Separate from /bot/v1/* on purpose:
// this never touches conversation logic.
app.use("/api/widget/config", widgetConfigRoutes);

// Public inbound channel webhooks (Phase 10) — authenticated per-
// request by a provider-specific secret (see the Telegram handler),
// never by the URL's connectionId alone.
app.use("/webhooks/telegram", telegramWebhookRoutes);

// Public invitation acceptance (Phase 11) — the token in the URL IS
// the authentication; no adminAuthMiddleware.
app.use("/api/invitations", invitationPublicRoutes);

// Developer API v1 (Phase 12) — external, API-key-authenticated.
// Deliberately separate from /api/admin (admin JWT) and /bot/v1
// (public widget) — see routes/developerApi.route.js.
app.use("/api/v1/developer", developerApiRoutes);

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

/* =========================================================
   GLOBAL ERROR HANDLER
   Phase 14: only ever forwards `err.message` to the client when the
   error explicitly set its own `.status` (meaning it's one of this
   codebase's own deliberate, crafted errors — e.g.
   QuotaExceededError, KnowledgeConflictError — whose message was
   already written to be safe to show an admin). Anything without an
   explicit `.status` is an unexpected exception (a raw Mongoose
   error, a bug, a third-party library throwing) and could otherwise
   leak field names, connection details, or internal implementation
   specifics — those get a generic message instead. The real error
   is still logged in full server-side either way.
========================================================= */

app.use((err, req, res, next) => {
  console.error(`Global Error [requestId=${req.requestId}]:`, err);

  const status = err.status || 500;
  const message = err.status ? err.message || "Request failed." : "Internal server error. Please try again later.";

  res.status(status).json({
    success: false,
    message,
    requestId: req.requestId,
  });
});

/* =========================================================
   PROCESS HARDENING (Phase 14)
   Previously absent entirely — an uncaught error or rejected
   promise outside Express's own request/response cycle would either
   crash the process with no cleanup or (for an unhandled rejection)
   just print a Node warning and leave the process running in an
   unknown state. This does not change any request-handling
   behavior; it only ensures a fatal error or a deployment signal
   (SIGTERM/SIGINT, e.g. from a platform redeploy or `kill`) is
   handled once, logged clearly, and followed by a real attempt to
   close the MongoDB connection before exiting — rather than an
   abrupt, unlogged process death.
========================================================= */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out — forcing exit.");
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  server.close(async () => {
    try {
      await mongoose.connection.close();
      console.log("MongoDB connection closed.");
    } catch (err) {
      console.error("Error closing MongoDB connection:", err.message);
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
  // Not fatal by itself — a rejected promise outside the request
  // cycle (e.g. a fire-and-forget dispatch call) is already the
  // established pattern across this codebase (webhook/AI-usage
  // dispatch, all deliberately not awaited) and every one of those
  // already has its own .catch(). This logs anything that slipped
  // through without one, without taking the whole server down for a
  // single non-critical background failure.
});

/* =========================================================
   START SERVER
========================================================= */

const server = app.listen(PORT, () => {
  console.log("====================================");
  console.log("🚀 Nuformly Server Started");
  console.log(`🌐 Port : ${PORT}`);
  console.log("====================================");
});

// Phase 15 — attaches to the same http.Server instance `server.close()`
// (in the graceful-shutdown handler above) already knows how to close;
// purely additive, no change to how the HTTP server itself starts.
initRealtime(server);