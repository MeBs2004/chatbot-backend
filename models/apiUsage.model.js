import mongoose from "mongoose";

// ======================================================
// API USAGE (Phase 12)
// One row per developer-API request — real telemetry, not the
// audit log (Section 32: high-volume request logging does not
// belong in AuditLog). Bounded growth via a TTL index: documents
// are automatically deleted 30 days after `createdAt` (Section 42 —
// retention must be defined, not "unlimited forever").
// ======================================================

const apiUsageSchema = new mongoose.Schema({
  companyId: { type: String, required: true, index: true },
  apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: "ApiKey", required: true, index: true },
  method: { type: String, required: true },
  path: { type: String, required: true },
  statusCode: { type: Number, required: true },
  rateLimited: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

apiUsageSchema.index({ companyId: 1, createdAt: -1 });
apiUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model("ApiUsage", apiUsageSchema);
