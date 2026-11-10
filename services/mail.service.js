import fs from "node:fs";
import nodemailer from "nodemailer";

// ======================================================
// Outgoing email (OTP verification, welcome mail, password resets).
// Configured with standard SMTP settings, so any provider works —
// Gmail (app password), Brevo, Zoho, SES…:
//   SMTP_HOST, SMTP_PORT (587 or 465), SMTP_USER, SMTP_PASS,
//   MAIL_FROM  e.g. "Nuformly <no-reply@yourdomain.com>"
// Without SMTP configured nothing is sent: in development the message
// is printed to the server console (so the flow can still be tested),
// in production a warning is logged.
// ======================================================

const isTest = process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT;

/** Messages "sent" while SMTP isn't configured outside production (tests read this). */
export const outbox = [];

let transport = null;

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!isMailConfigured()) return null;
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Render resolves smtp.gmail.com's AAAA (IPv6) record but can't
      // route outbound IPv6 traffic, so the connection fails with
      // ENETUNREACH on an IPv6 address before it ever reaches Gmail.
      // Forcing IPv4 here is the fix — Gmail's SMTP works fine over
      // IPv4, this just stops Node from preferring the unreachable
      // IPv6 address.
      family: 4,
      // Without these, a stuck/blocked connection hangs the whole
      // request forever instead of failing like any other network
      // error. 15s is generous for TLS handshake + auth over a normal
      // connection, well short of callers' own 60s timeout.
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
    });
  }
  return transport;
}

/** Sends one email. Never throws — returns { sent, reason }. */
export async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "Nuformly <no-reply@nuformly.local>";
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV === "production" && !isTest) {
      console.warn(`[mail] SMTP is not configured — email to ${to} ("${subject}") was not sent.`);
      return { sent: false, reason: "not-configured" };
    }
    outbox.push({ to, subject, text, html, from });
    // tests run the server as a separate process and read "sent" mail from here
    if (process.env.MAIL_OUTBOX_FILE) fs.appendFileSync(process.env.MAIL_OUTBOX_FILE, `${JSON.stringify({ to, subject, text })}\n`);
    if (!isTest) console.log(`\n[mail] SMTP not configured — this email would be sent:\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`);
    return { sent: false, reason: "not-configured" };
  }
  try {
    await t.sendMail({ from, to, subject, text, html });
    return { sent: true };
  } catch (error) {
    console.error("[mail] send failed:", error.message);
    return { sent: false, reason: "send-failed" };
  }
}
