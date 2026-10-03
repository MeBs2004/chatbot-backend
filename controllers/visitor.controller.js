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

      await existingVisitor.save();

      emitDomainEvent(EVENTS.VISITOR_UPDATED, {
        companyId,
        payload: { visitorId: existingVisitor.visitorId, changedFields: ["lastVisit", "page", "status", "totalVisits"] },
      });

      return res.status(200).json({
        success: true,
        message: "Visitor updated",
        visitor: existingVisitor,
      });
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
    });

    emitDomainEvent(EVENTS.VISITOR_CREATED, {
      companyId,
      payload: { visitorId: visitor.visitorId },
    });

    return res.status(200).json({
      success: true,
      message: "New visitor created",
      visitor,
    });
  } catch (error) {
    console.error("Visitor Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
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

    return res.status(200).json({
      success: true,
      message: "Email saved successfully",
      visitor,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      error: error.message,
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

    return res.status(200).json({
      success: true,
      visitor,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};