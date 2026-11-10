import fs from "node:fs";
import dns from "node:dns";
import net from "node:net";
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

export function isMailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Nodemailer (9.x) resolves both the A and AAAA records for the SMTP
// host and then picks ONE AT RANDOM to connect to (see
// node_modules/nodemailer/lib/shared/index.js's formatDNSValue) — it
// does NOT honor a `family` transport option at all for that choice.
// On hosts without real outbound IPv6 routing (Render, and others)
// that random pick regularly lands on an IPv6 address and the
// connection fails with ENETUNREACH. The fix is to resolve the
// hostname to an IPv4 address ourselves and hand nodemailer that
// literal IP as `host` — `net.isIP(host)` short-circuits its own DNS
// resolution entirely once `host` is already an IP, so there is
// nothing left for it to randomly mis-pick. `servername` is set
// separately so TLS certificate validation (SNI) still checks against
// the real hostname rather than the IP.
async function resolveIPv4(hostname) {
  if (net.isIP(hostname)) return hostname;
  const addresses = await dns.promises.resolve4(hostname);
  if (!addresses.length) throw new Error(`No IPv4 address found for ${hostname}`);
  return addresses[Math.floor(Math.random() * addresses.length)];
}

/** Built fresh per send — a DNS lookup is cheap and keeps this correct
 * even if the provider's IPv4 address pool changes while the process
 * stays up for days between deploys. */
async function getTransport() {
  if (!isMailConfigured()) return null;
  const hostname = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  let host = hostname;
  try {
    host = await resolveIPv4(hostname);
  } catch (error) {
    console.warn(`[mail] could not resolve an IPv4 address for ${hostname}, falling back to hostname: ${error.message}`);
  }
  return nodemailer.createTransport({
    host,
    servername: hostname,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Without these, a stuck/blocked connection hangs the whole
    // request forever instead of failing like any other network
    // error. 15s is generous for TLS handshake + auth over a normal
    // connection, well short of callers' own 60s timeout.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
}

/** Sends one email. Never throws — returns { sent, reason }. */
export async function sendMail({ to, subject, text, html }) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "Nuformly <no-reply@nuformly.local>";
  const t = await getTransport();
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
