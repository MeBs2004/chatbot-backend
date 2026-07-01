import mongoose from "mongoose";

const visitorSchema = new mongoose.Schema(
  {
    // ==========================
    // Company
    // ==========================

    companyId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // ==========================
    // Visitor
    // ==========================

    visitorId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // ==========================
    // Geo Location
    // ==========================

    ip: {
      type: String,
      default: "",
    },

    country: {
      type: String,
      default: "",
    },

    region: {
      type: String,
      default: "",
    },

    city: {
      type: String,
      default: "",
    },

    timezone: {
      type: String,
      default: "",
    },

    isp: {
      type: String,
      default: "",
    },

    lat: {
      type: Number,
      default: 0,
    },

    lon: {
      type: Number,
      default: 0,
    },

    // ==========================
    // Device Information
    // ==========================

    browser: {
      type: String,
      default: "",
    },

    os: {
      type: String,
      default: "",
    },

    device: {
      type: String,
      default: "",
    },

    language: {
      type: String,
      default: "",
    },

    page: {
      type: String,
      default: "",
    },

    // ==========================
    // Lead Information
    // ==========================

    name: {
      type: String,
      default: "",
      trim: true,
    },

    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    // ==========================
    // Analytics
    // ==========================

    totalVisits: {
      type: Number,
      default: 1,
      min: 1,
    },

    totalMessages: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastMessage: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["online", "offline"],
      default: "online",
    },

    // ==========================
    // Dates
    // ==========================

    firstVisit: {
      type: Date,
      default: Date.now,
    },

    lastVisit: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// A visitor can exist in multiple companies,
// but only once per company.
visitorSchema.index(
  {
    companyId: 1,
    visitorId: 1,
  },
  {
    unique: true,
  }
);

export default mongoose.model("Visitor", visitorSchema);