import mongoose from "mongoose";

// ======================================================
// PHASE 5.1 — a real uploaded file for a "file"-type EnergyQuestion,
// answered during the public Energy journey. Same Buffer-in-Mongo
// pattern already used for equipment images/datasheets and supplier
// documents (this codebase has no S3/cloud storage integration) —
// not a new storage architecture, the established one.
//
// Uploaded BEFORE an EnergyEnquiry exists (the enquiry is only
// created at the very end of the journey), so this is its own
// collection; EnergyEnquiry.uploadedFiles later stores a REFERENCE
// (fileId + metadata snapshot) to rows here, never a duplicate copy.
//
// `storageKey` is a server-generated, unguessable identifier — the
// answer value a visitor's browser holds for a file question is this
// key, never the original filename, which is kept only as display
// metadata and never trusted as a path or an identifier.
// ======================================================

const journeyFileSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, trim: true, index: true },
    chatbotId: { type: mongoose.Schema.Types.ObjectId, ref: "Chatbot", required: true, index: true },
    visitorId: { type: String, required: true, trim: true, index: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: "EnergyQuestion", required: true },

    storageKey: { type: String, required: true, unique: true },
    originalFilename: { type: String, default: "" }, // display only — never used as a path or trusted for type
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

journeyFileSchema.index({ companyId: 1, chatbotId: 1, visitorId: 1 });

// Never include the binary payload in a normal JSON response.
journeyFileSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.data;
    return ret;
  },
});

export default mongoose.model("EnergyJourneyFile", journeyFileSchema);
