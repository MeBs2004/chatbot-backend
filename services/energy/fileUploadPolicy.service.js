// ======================================================
// PHASE 5.2, TASKS 6 & 8 — single source of truth for what a journey
// file-upload question is allowed to accept, shared by the admin
// question-config validation (energyQuestion.controller.js) and the
// actual public upload endpoint (energyJourneyFile.controller.js) —
// previously the upload endpoint had its own private default list
// with nothing validating what an admin could configure. Centralizing
// this means "what the admin can pick" and "what the server actually
// enforces" can never drift apart.
// ======================================================

// label/extension are display-only (admin UI); `mime` is the value
// actually stored in EnergyQuestion.allowedFileTypes and compared
// against the upload's Content-Type; `signature` is the magic-byte
// check used by detectAndValidateSignature (Task 8) — a function
// (buffer) => boolean, since a couple of formats need more than a
// fixed byte prefix.
export const SUPPORTED_FILE_TYPES = [
  { mime: "application/pdf", label: "PDF", extensions: [".pdf"], signature: (buf) => buf.slice(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/jpeg", label: "JPG / JPEG", extensions: [".jpg", ".jpeg"], signature: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff },
  { mime: "image/png", label: "PNG", extensions: [".png"], signature: (buf) => buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", label: "WEBP", extensions: [".webp"], signature: (buf) => buf.length >= 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP" },
  // .docx/.xlsx are both zip containers (PK\x03\x04) — a magic-byte
  // check can confirm "this really is a zip archive", which catches
  // the realistic spoofing case (an arbitrary file renamed to
  // .docx/.xlsx), but cannot by itself distinguish a Word doc from an
  // Excel sheet without parsing the archive's internal manifest; that
  // deeper check is intentionally out of scope here (documented
  // limitation, not silently claimed as full verification).
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX", extensions: [".docx"], signature: (buf) => isZipContainer(buf) },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "XLSX", extensions: [".xlsx"], signature: (buf) => isZipContainer(buf) },
  // Legacy OLE-compound-file formats (.doc/.xls) share one container
  // signature too — same honest limitation as above.
  { mime: "application/msword", label: "DOC (legacy)", extensions: [".doc"], signature: (buf) => isOleContainer(buf) },
  { mime: "application/vnd.ms-excel", label: "XLS (legacy)", extensions: [".xls"], signature: (buf) => isOleContainer(buf) },
];

function isZipContainer(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) && (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08);
}
function isOleContainer(buf) {
  return buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

export const SUPPORTED_MIME_TYPES = SUPPORTED_FILE_TYPES.map((t) => t.mime);

// A question with no `allowedFileTypes` configured falls back to this
// — images + PDF + the office formats, a reasonable broad default for
// "attach a document or photo" without enabling anything unsafe
// (never executables, scripts, archives, etc).
export const DEFAULT_ALLOWED_MIME_TYPES = SUPPORTED_MIME_TYPES;

export const DEFAULT_MAX_SIZE_MB = 10;
export const HARD_MAX_SIZE_MB = 25;

/** Used by the admin question-save validation (Task 6) — every entry must be one of the types the upload pipeline can actually handle. */
export function validateAllowedFileTypes(types) {
  if (types === undefined) return { valid: true, value: undefined };
  if (!Array.isArray(types)) return { valid: false, error: "allowedFileTypes must be an array." };
  const cleaned = types.map((t) => String(t || "").trim()).filter(Boolean);
  const unsupported = cleaned.filter((t) => !SUPPORTED_MIME_TYPES.includes(t));
  if (unsupported.length > 0) return { valid: false, error: `Unsupported file type(s): ${unsupported.join(", ")}. Supported: ${SUPPORTED_FILE_TYPES.map((t) => t.label).join(", ")}.` };
  return { valid: true, value: cleaned };
}

/** Used by the admin question-save validation (Task 6) — null/undefined means "use the platform default", anything else must be a sane positive number under the hard cap. */
export function validateMaxFileSizeMb(value) {
  if (value === undefined) return { valid: true, value: undefined };
  if (value === null || value === "") return { valid: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return { valid: false, error: "maxFileSizeMb must be a positive number." };
  if (n > HARD_MAX_SIZE_MB) return { valid: false, error: `maxFileSizeMb cannot exceed the platform maximum of ${HARD_MAX_SIZE_MB}MB.` };
  return { valid: true, value: n };
}

/**
 * Task 8 — server-side file-signature check. Returns null (pass) or a
 * human-readable rejection reason. Never trusts the browser-supplied
 * MIME type or filename extension alone — inspects the actual bytes.
 */
/** Strips characters that could break or inject into a Content-Disposition header; the visitor-supplied filename is never trusted as-is. */
export function safeFilenameForHeader(filename) {
  const cleaned = String(filename || "upload").replace(/["\r\n]/g, "").slice(0, 200);
  return cleaned || "upload";
}

export function validateFileSignature(buffer, claimedMime) {
  if (!buffer || buffer.length === 0) return "The uploaded file is empty.";
  const spec = SUPPORTED_FILE_TYPES.find((t) => t.mime === claimedMime);
  if (!spec) return `Unsupported file type: ${claimedMime}.`;
  if (!spec.signature(buffer)) return "The file's actual content doesn't match its claimed type. Please upload a genuine file of the allowed type.";
  return null;
}
