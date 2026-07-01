import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";

import companyRoutes from "./routes/company.route.js";
import chatbotRoutes from "./routes/chatbot.route.js";
import suggestionRoutes from "./routes/suggestion.route.js";
import visitorRoutes from "./routes/visitor.route.js";

import companyMiddleware from "./middleware/company.middleware.js";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 4002;

app.set("trust proxy", true);

/* =========================================================
   CORS
========================================================= */

app.use((req, res, next) => {
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

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

/* =========================================================
   BODY PARSER
========================================================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   DATABASE
========================================================= */

mongoose
  .connect(process.env.MONGO_URI)
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
========================================================= */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Nuformly Backend Running 🚀",
    status: "OK",
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
========================================================= */

app.use((err, req, res, next) => {
  console.error("Global Error:", err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
  console.log("====================================");
  console.log("🚀 Nuformly Server Started");
  console.log(`🌐 Port : ${PORT}`);
  console.log("====================================");
});