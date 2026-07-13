import Bot from "../models/bot.model.js";
import User from "../models/user.model.js";
import Visitor from "../models/visitor.model.js";

import { askGroq } from "../services/groq.service.js";
import { needsHumanHandoff } from "../services/handoff.service.js";
//hello
import axios from "axios";

export const Message = async (req, res) => {
  try {
    const { text, language = "English", visitorId } = req.body;

    const company = req.company;

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    const companyId = company.companyId;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message cannot be empty.",
      });
    }

    // =========================
    // Visitor Analytics
    // =========================

    if (visitorId) {
      await Visitor.findOneAndUpdate(
        {
          companyId,
          visitorId,
        },
        {
          $inc: {
            totalMessages: 1,
          },
          $set: {
            lastVisit: new Date(),
            lastMessage: text,
            status: "online",
          },
        },
        {
          new: true,
        }
      );
    }

    // =========================
    // Save User Message
    // =========================

    const userMessage = await User.create({
      companyId,
      visitorId,
      sender: "user",
      text,
    });

    // =========================
    // Human Handoff
    // =========================

    if (needsHumanHandoff(text)) {
      const handoffMessage = `Sure! Our team will be happy to assist you.

📞 Call:
${company.contact?.phone || "Not Available"}

💬 WhatsApp:
${company.contact?.whatsapp || "Not Available"}

📧 Email:
${company.contact?.email || "Not Available"}
`;

      await Bot.create({
        companyId,
        visitorId,
        text: handoffMessage,
      });

      return res.status(200).json({
        success: true,
        userMessage: userMessage.text,
        botMessage: handoffMessage,
      });
    }

    // =========================
    // Company Webhook
    // =========================

    if (company.ai?.webhookUrl) {
      try {
        const webhook = await axios.post(company.ai.webhookUrl, {
          companyId,
          visitorId,
          message: text,
          language,
        });

        if (webhook.data?.reply) {
          await Bot.create({
            companyId,
            visitorId,
            text: webhook.data.reply,
          });

          return res.status(200).json({
            success: true,
            userMessage: userMessage.text,
            botMessage: webhook.data.reply,
          });
        }
      } catch (err) {
        console.log("Webhook failed. Falling back to Groq...");
      }
    }

    // =========================
    // Groq AI
    // =========================

    const aiReply = await askGroq({
  company,
  message: text,
  language,
});

    await Bot.create({
      companyId,
      visitorId,
      text: aiReply,
    });

    return res.status(200).json({
      success: true,
      userMessage: userMessage.text,
      botMessage: aiReply,
    });
  } catch (error) {
    console.error("Message Controller Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};