// Account rules shared by the sign-up / login pages and the server.
// This file is byte-identical in backend/utils/accountRules.js and
// admin-panel/src/config/accountRules.js (a test keeps them in sync), so
// the page and the server always agree on what's valid. Every check
// returns "" when the value is fine, or a sentence to show the person.

export const LIMITS = {
  name: [2, 60],
  company: [2, 80],
  email: 254,
  password: [8, 72], // bcrypt only reads the first 72 bytes
};

/** Trimmed, single-spaced. */
export const tidy = (v) => String(v ?? "").trim().replace(/\s+/g, " ");

/** Emails are stored lowercased and trimmed. */
export const normalizeEmail = (v) => String(v ?? "").trim().toLowerCase();

// Letters from any script (so "Priya", "José" and "प्रिया" all work),
// plus spaces, dots, apostrophes and hyphens between them.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;

export function checkName(value) {
  const v = tidy(value);
  if (!v) return "Enter your full name.";
  if ([...v].length < LIMITS.name[0]) return "Your name looks too short.";
  if ([...v].length > LIMITS.name[1]) return `Use ${LIMITS.name[1]} characters or fewer.`;
  if (/\d/.test(v)) return "Names can't contain numbers.";
  if (!NAME_RE.test(v)) return "Use letters only — spaces, dots, apostrophes and hyphens are fine.";
  return "";
}

export function checkCompanyName(value) {
  const v = tidy(value);
  if (!v) return "Enter your company's name.";
  if ([...v].length < LIMITS.company[0]) return "Your company name looks too short.";
  if ([...v].length > LIMITS.company[1]) return `Use ${LIMITS.company[1]} characters or fewer.`;
  if (!/[\p{L}\p{N}]/u.test(v)) return "Include at least one letter or number.";
  if (/[<>{}\\`]|[\u0000-\u001f]/.test(v)) return "Remove symbols like < > { } from the name.";
  return "";
}

// One "@", a sensible local part (no leading/trailing/double dots) and a
// real-looking domain ending in a 2+ letter TLD.
const EMAIL_RE = /^(?!\.)(?!.*\.\.)[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}(?<!\.)@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;

export const isEmail = (value) => {
  const v = normalizeEmail(value);
  return v.length <= LIMITS.email && EMAIL_RE.test(v);
};

// Throwaway inboxes: an account on one can't receive its reset link later.
export const DISPOSABLE_DOMAINS = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "tempmail.net", "yopmail.com", "trashmail.com", "getnada.com",
  "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com",
  "tempail.com", "emailondeck.com", "mohmal.com", "tempr.email", "discard.email", "mintemail.com",
];

/** `forSignup` also refuses temporary inboxes; logging in only checks the format. */
export function checkEmail(value, { forSignup = false } = {}) {
  const v = normalizeEmail(value);
  if (!v) return "Enter your email address.";
  if (!v.includes("@")) return "Email addresses need an @ — like name@company.com.";
  if (!isEmail(v)) return "Enter a valid email address, like name@company.com.";
  if (forSignup && DISPOSABLE_DOMAINS.includes(v.split("@")[1])) {
    return "Please use a permanent email — temporary inboxes can't receive your login links.";
  }
  return "";
}

// The passwords people try first. Compared case-insensitively.
const COMMON = new Set([
  "password", "password1", "password12", "password123", "password1234", "passw0rd", "p@ssw0rd", "p@ssword1",
  "12345678", "123456789", "1234567890", "123123123", "11111111", "00000000", "87654321", "12341234",
  "qwerty123", "qwertyuiop", "qwerty12", "qwerty1234", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "asdfgh123",
  "iloveyou1", "welcome1", "welcome123", "admin123", "admin1234", "letmein1", "abc12345", "abcd1234",
  "football1", "monkey123", "sunshine1", "princess1", "india123", "india@123", "nuformly1", "nuformly123",
  "changeme1", "test1234", "secret123", "master123", "computer1",
]);

const COMMON_WORDS = ["password", "passw0rd", "welcome", "admin", "letmein", "iloveyou", "qwerty", "india", "monkey", "dragon", "sunshine", "princess", "football", "cricket", "secret", "master", "login", "hello", "test", "changeme", "nuformly"];

const SEQUENCES = ["0123456789", "9876543210", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

function isEasyToGuess(pw, { email = "", name = "", company = "" } = {}) {
  const p = pw.toLowerCase();
  if (COMMON.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true; // "aaaaaaaa"
  const trimmed = p.replace(/[\d!@#$%^&*._-]+$/, ""); // "abcabc" + "123!"
  if (/^(.{1,4})\1+$/.test(p) || (trimmed.length >= 6 && /^(.{1,4})\1+$/.test(trimmed))) return true; // "abcabcabc", "12121212"
  // a keyboard run or a common word with numbers stuck on: "qwerty12345", "Welcome@2024"
  const base = p.replace(/[^a-z0-9]+/g, "").replace(/\d+$/, "").replace(/^\d+/, "");
  if (base.length >= 4 && SEQUENCES.some((seq) => seq.includes(base))) return true;
  if (COMMON_WORDS.includes(base)) return true;
  if (SEQUENCES.some((s) => s.includes(p.replace(/[^a-z0-9]/g, "")) && p.replace(/[^a-z0-9]/g, "").length >= 6)) return true;
  // Built from the person's own details
  const local = normalizeEmail(email).split("@")[0].replace(/[^\p{L}\p{N}]/gu, "");
  const words = (v) => tidy(v).toLowerCase().split(" ");
  const bits = [local, ...words(name), words(name).join(""), ...words(company), words(company).join("")]
    .map((b) => b.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((b) => b.length >= 4);
  const core = p.replace(/[^\p{L}]/gu, "");
  return bits.some((b) => p.includes(b) && core.length - b.length <= 2);
}

/**
 * The checklist shown under the password field. `ctx` = { email, name, company }
 * so a password made from the person's own details is refused.
 */
export function passwordChecks(pw = "", ctx = {}) {
  return [
    { id: "length", label: `At least ${LIMITS.password[0]} characters`, ok: pw.length >= LIMITS.password[0] },
    { id: "mix", label: "A letter and a number", ok: /\p{L}/u.test(pw) && /\d/.test(pw) },
    { id: "guess", label: "Not easy to guess", ok: pw.length > 0 && !isEasyToGuess(pw, ctx) },
  ];
}

export function checkPassword(pw, ctx = {}) {
  if (typeof pw !== "string" || !pw) return "Create a password.";
  if (pw.length < LIMITS.password[0]) return `Use at least ${LIMITS.password[0]} characters.`;
  if (new TextEncoder().encode(pw).length > LIMITS.password[1]) return `Use ${LIMITS.password[1]} characters or fewer.`;
  if (/^\s|\s$/.test(pw)) return "Remove the space at the start or end.";
  if (!/\p{L}/u.test(pw) || !/\d/.test(pw)) return "Include at least one letter and one number.";
  if (isEasyToGuess(pw, ctx)) return "That password is too easy to guess — try something less common.";
  return "";
}

/** 0–4 for the strength meter: 1 = not valid yet, 2–4 = valid and getting stronger. */
export function passwordStrength(pw = "", ctx = {}) {
  if (!pw) return { score: 0, label: "" };
  if (checkPassword(pw, ctx)) return { score: 1, label: "Too weak" };
  let score = 2;
  if (pw.length >= 12) score += 1;
  if ((/[a-z]/.test(pw) && /[A-Z]/.test(pw)) || /[^\p{L}\p{N}]/u.test(pw)) score += 1;
  score = Math.min(4, score);
  return { score, label: ["", "Too weak", "Okay", "Strong", "Excellent"][score] };
}
