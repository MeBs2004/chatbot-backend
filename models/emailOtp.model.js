import mongoose from "mongoose";

// ======================================================
// EMAIL VERIFICATION CODES — company sign-up only.
// There is no AdminUser yet at this point (that's exactly why this
// isn't a field on AdminUser, the way the password-reset token is) —
// just a short-lived, one-row-per-email code that proves the person
// signing up actually controls the inbox they typed. The TTL index
// drops a row automatically once `expiresAt` passes, whether or not
// it was ever used.
// ======================================================

const emailOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  // Wrong tries against this one code — capped in the controller so a
  // 6-digit code can't be brute-forced before it expires.
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// expireAfterSeconds: 0 means "expire exactly at the stored Date", not
// "0 seconds after creation" — MongoDB's idiom for an absolute TTL.
emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("EmailOtp", emailOtpSchema);
