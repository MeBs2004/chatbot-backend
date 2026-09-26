import mammoth from "mammoth";
import XLSX from "xlsx";

// ======================================================
// KNOWLEDGE FILE TEXT EXTRACTION (Phase 7)
// A separate, smaller extractor than chatbot.message.js's inline
// file-handling block, deliberately not sharing code with it: that
// block is live, proven, and handles chat attachments (where a
// placeholder like "I can't read this video yet" is honest, useful
// conversational context). Knowledge base uploads are different — a
// placeholder string injected as if it were real company knowledge
// would be actively misleading persisted data, so this extractor
// only supports the formats it can genuinely turn into real text,
// using the exact same libraries (mammoth/xlsx/pdfjs-dist) the proven
// chat path already uses, and rejects everything else outright.
// ======================================================

export const SUPPORTED_KNOWLEDGE_UPLOAD_MIMETYPES = [
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
];

export class UnsupportedKnowledgeFileError extends Error {}

export async function extractKnowledgeFileText(file) {
  const mime = file.mimetype;

  if (mime === "text/plain") {
    return file.buffer.toString("utf8");
  }

  if (mime === "application/pdf") {
    // Lazy import for the same reason as chatbot.message.js: only
    // breaks this one code path on a Node version missing pdfjs-dist's
    // browser-API polyfills, not server startup.
    //
    // Phase 14 fix: pdfjs-dist references DOMMatrix/Path2D/ImageData
    // at module-load time for its (unused-by-us) rendering path, even
    // though this function only ever calls getTextContent() — plain
    // text extraction, never rendering. Under Node < 22 those globals
    // don't exist at all, and the reference alone throws before a
    // single page is read. Minimal inert stubs are enough to satisfy
    // that reference; they are never actually invoked for text
    // extraction. Confirmed live against a real PDF during the Phase
    // 14 audit — extraction silently failed before this fix (caught
    // by the try/catch below and produced a "could not be read"
    // fallback) and succeeds after it.
    if (typeof globalThis.DOMMatrix === "undefined") globalThis.DOMMatrix = class DOMMatrix {};
    if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = class Path2D {};
    if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = class ImageData {};

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(file.buffer) });
    const pdf = await loadingTask.promise;

    let text = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ") + "\n";
    }
    return text;
  }

  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (mime.includes("spreadsheet") || mime.includes("excel")) {
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    let text = "";
    workbook.SheetNames.forEach((sheet) => {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1 });
      text += `\nSheet: ${sheet}\n`;
      rows.forEach((row) => {
        text += row.join(" | ") + "\n";
      });
    });
    return text;
  }

  throw new UnsupportedKnowledgeFileError(
    `"${mime}" is not supported for knowledge extraction yet. Supported: .txt, .pdf, .docx, .xlsx.`
  );
}
