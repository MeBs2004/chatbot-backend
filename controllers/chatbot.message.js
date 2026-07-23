import Bot from "../models/bot.model.js";
import User from "../models/user.model.js";
import Visitor from "../models/visitor.model.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth";
import XLSX from "xlsx";

import { askGroq } from "../services/groq.service.js";
import { needsHumanHandoff } from "../services/handoff.service.js";
//hello
import axios from "axios";

export const Message = async (req, res) => {
  try {
    const { text = "", language = "English", visitorId } = req.body;
const file = req.file;
    const company = req.company;

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found.",
      });
    }

    const companyId = company.companyId;

// Allow either text OR file
if ((!text || !text.trim()) && !file) {
  return res.status(400).json({
    success: false,
    message: "Please enter a message or upload a file.",
  });
}

console.log("TEXT :", text);
console.log("FILE :", file?.originalname);
console.log("MIME :", file?.mimetype);

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
  text:
    text && text.trim()
      ? text
      : `[Uploaded ${file?.originalname || "file"}]`,
});

    // =========================
    // Human Handoff
    // =========================

    if (text && needsHumanHandoff(text)) {
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

let imageBase64 = null;
let extractedText = "";

if (file) {
  const mime = file.mimetype;

  // ===========================
  // IMAGE
  // ===========================
  if (mime.startsWith("image/")) {
    imageBase64 = `data:${mime};base64,${file.buffer.toString("base64")}`;
  }

  // ===========================
// PDF
// ===========================
else if (mime === "application/pdf") {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(file.buffer),
  });

  const pdf = await loadingTask.promise;

  let pdfText = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    const content = await page.getTextContent();

    pdfText +=
      content.items
        .map((item) => item.str)
        .join(" ") + "\n";
  }

  extractedText = pdfText;
}

  // ===========================
  // DOCX
  // ===========================
  else if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({
      buffer: file.buffer,
    });

    extractedText = result.value;
  }

  // ===========================
  // TXT
  // ===========================
  else if (mime === "text/plain") {
    extractedText = file.buffer.toString("utf8");
  }

  // ===========================
  // EXCEL
  // ===========================
  else if (
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    const workbook = XLSX.read(file.buffer, {
      type: "buffer",
    });

    workbook.SheetNames.forEach((sheet) => {
      const rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[sheet],
        {
          header: 1,
        }
      );

      extractedText += `\nSheet: ${sheet}\n`;

      rows.forEach((row) => {
        extractedText += row.join(" | ") + "\n";
      });
    });
  }

  // ===========================
// PPT / PPTX
// ===========================
else if (
  mime === "application/vnd.ms-powerpoint" ||
  mime ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
) {
  extractedText = `The user uploaded a PowerPoint file named "${file.originalname}". I cannot extract slide text yet, but answer based on the user's request.`;
}

// ===========================
// VIDEO
// ===========================
else if (mime.startsWith("video/")) {
  extractedText = `The user uploaded a video named "${file.originalname}". I cannot watch videos yet. Ask the user what they want to know about it.`;
}

// ===========================
// AUDIO
// ===========================
else if (mime.startsWith("audio/")) {
  extractedText = `The user uploaded an audio file named "${file.originalname}". I cannot transcribe audio yet. Ask the user what they need.`;
}

// ===========================
// OTHER FILES
// ===========================
else {
  extractedText = `The user uploaded a file named "${file.originalname}" of type "${mime}".`;
}
}

    // =========================
    // Groq AI
    // =========================

  let finalMessage = text || "";

if (extractedText) {
  finalMessage += `

Attached File Content:

${extractedText}`;
}

if (!finalMessage.trim() && file) {
  finalMessage = `User uploaded a file named "${file.originalname}". Please analyze it.`;
}

const aiReply = await askGroq({
  company,
  message: finalMessage,
  language,
  image: imageBase64,
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