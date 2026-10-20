import Visitor from "../models/visitor.model.js";
import axios from "axios";
import { emitDomainEvent } from "../services/realtime/io.js";
import { EVENTS } from "../services/realtime/events.js";

// ================= SAVE VISITOR =================
export const saveVisitor = async (req, res) => {
  try {
    const companyId = req.company.companyId;

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress;

    const existingVisitor = await Visitor.findOne({
      companyId,
      visitorId: req.body.visitorId,
    });

    // Live View heartbeat — the widget now calls this endpoint every
    // ~25s (not just once per page load) to keep `lastVisit` fresh for
    // the admin Live View feature, reusing this exact endpoint rather
    // than adding a new one. A repeat geo lookup on every heartbeat
    // would (a) hammer ip-api.com's free-tier rate limit for data that
    // never changes mid-session and (b) add avoidable latency to a
    // call that now happens far more often — so it only ever runs once,
    // for a visitor this company has genuinely never seen before.
    if (existingVisitor) {
      existingVisitor.lastVisit = new Date();
      existingVisitor.page = req.body.page;
      existingVisitor.status = "online";
      existingVisitor.totalVisits += 1;
      if (req.chatbot) existingVisitor.chatbotId = req.chatbot._id;

      await existingVisitor.save();

      emitDomainEvent(EVENTS.VISITOR_UPDATED, {
        companyId,
        payload: { visitorId: existingVisitor.visitorId, changedFields: ["lastVisit", "page", "status", "totalVisits"] },
      });

      return res.status(200).json({ success: true });
    }

    let geoData = {};

    try {
      // Phase 14 — this had no timeout at all: a slow/unresponsive
      // ip-api.com could hang every single visitor-creation request
      // on this public, high-traffic, unauthenticated endpoint
      // indefinitely. Geolocation is a non-critical enrichment (the
      // catch below already treats any failure as "skip it"), so a
      // short bound is correct here, not a compromise.
      const response = await axios.get(
        `http://ip-api.com/json/${encodeURIComponent(ip)}`,
        { timeout: 3000 }
      );

      geoData = {
        ip,
        country: response.data.country,
        region: response.data.regionName,
        city: response.data.city,
        timezone: response.data.timezone,
        isp: response.data.isp,
        lat: response.data.lat,
        lon: response.data.lon,
      };
    } catch (error) {
      console.log("Geo IP lookup failed");
    }

    const visitor = await Visitor.create({
      companyId,
      visitorId: req.body.visitorId,
      browser: req.body.browser,
      os: req.body.os,
      device: req.body.device,
      language: req.body.language,
      page: req.body.page,
      ...geoData,
      status: "online",
      totalVisits: 1,
      totalMessages: 0,
      chatbotId: req.chatbot?._id || null,
    });

    emitDomainEvent(EVENTS.VISITOR_CREATED, {
      companyId,
      payload: { visitorId: visitor.visitorId },
    });

    // Public endpoint: never echo the Visitor document (IP, geo, email).
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Visitor Error:", error);

    return res.status(500).json({
      success: false,
    });
  }
};

// ================= SAVE EMAIL =================
export const saveEmail = async (req, res) => {
  try {
    const companyId = req.company.companyId;

    const { visitorId, email } = req.body;

    if (!visitorId || !email) {
      return res.status(400).json({
        success: false,
        message: "visitorId and email are required",
      });
    }

    const visitor = await Visitor.findOneAndUpdate(
      {
        companyId,
        visitorId,
      },
      {
        email,
      },
      {
        new: true,
      }
    );

    if (!visitor) {
      return res.status(404).json({
        success: false,
        message: "Visitor not found",
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
    });
  }
};

// ================= UPDATE NAME =================
export const updateVisitorName = async (req, res) => {
  try {
    const companyId = req.company.companyId;

    const { visitorId, name } = req.body;

    if (!visitorId || !name) {
      return res.status(400).json({
        success: false,
        message: "visitorId and name are required",
      });
    }

    const visitor = await Visitor.findOneAndUpdate(
      {
        companyId,
        visitorId,
      },
      {
        name,
      },
      {
        new: true,
      }
    );

    if (!visitor) {
      return res.status(404).json({
        success: false,
        message: "Visitor not found",
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
    });
  }
};
// ================= SAVE PRE-CHAT FORM =================
// One call for everything the chatbot's pre-chat form (config.forms)
// collects. Every field is optional and independently validated; only
// fields that pass are written, so a bad phone number never blocks a
// good email. Responds 400 only when nothing usable was sent.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s.]{5,40}$/;

export const saveVisitorProfile = async (req, res) => {
  try {
    const companyId = req.company.companyId;
    const { visitorId } = req.body || {};
    const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

    if (!visitorId || typeof visitorId !== "string") {
      return res.status(400).json({ success: false, message: "visitorId is required" });
    }

    const update = {};
    const name = clean(req.body.name, 100);
    const email = clean(req.body.email, 200);
    const phone = clean(req.body.phone, 40);
    const company = clean(req.body.company, 100);
    if (name) update.name = name;
    if (email && EMAIL_RE.test(email)) update.email = email.toLowerCase();
    if (phone && PHONE_RE.test(phone)) update.phone = phone;
    if (company) update.company = company;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: "No valid profile fields provided" });
    }

    const visitor = await Visitor.findOneAndUpdate({ companyId, visitorId }, { $set: update }, { new: true });

    if (!visitor) {
      return res.status(404).json({ success: false, message: "Visitor not found" });
    }

    return res.status(200).json({ success: true, saved: Object.keys(update) });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false });
  }
};
