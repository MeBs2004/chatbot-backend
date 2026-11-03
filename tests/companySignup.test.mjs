import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";
import EmailOtp from "../models/emailOtp.model.js";
import { hashOtp, verifySignupOtp } from "../controllers/companySignup.controller.js";

let server;
before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4197 });
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(resetDb);

const post = (path, body) =>
  fetch(`${server.baseUrl}/api/company-signup${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));
const sendOtp = (email) => post("/send-otp", { email });
const signup = (body) => post("/", body);

/** Reads the 6-digit code out of the most recent OTP email sent to `email`. */
function codeFor(email) {
  const mail = server
    .outbox()
    .reverse()
    .find((m) => m.to === email && /verification code/i.test(m.subject));
  const match = mail?.text.match(/verification code is: (\d{6})/);
  return match?.[1];
}

const GOOD = { companyName: "  Acme   Solar ", industry: "Energy", adminName: " Priya  Sharma ", phone: " 98765  43210 ", email: " Priya@Acme-Solar.in ", password: "Sunflower42", otp: "000000" };

// This file makes exactly 10 signup() calls and 4 send-otp() calls total —
// right at (or under) the rate limits (10 and 8 per 15 minutes). Adding
// another case means trimming one elsewhere, not just appending.

test("send-otp emails a 6-digit code, and refuses a taken or malformed email", async () => {
  const ok = await sendOtp("owner@newco.test");
  assert.equal(ok.status, 200);
  const code = codeFor("owner@newco.test");
  assert.match(code || "", /^\d{6}$/);

  const existing = new AdminUser({ name: "Taken", email: "taken@co.test", role: "COMPANY_ADMIN" });
  await existing.setPassword("whatever-password-1");
  await existing.save();
  const taken = await sendOtp("taken@co.test");
  assert.equal(taken.status, 409);
  assert.equal(taken.body.field, "email");
  assert.equal(taken.body.code, "EMAIL_TAKEN");

  const malformed = await sendOtp("not-an-email");
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.field, "email");
});

test("sign-up requires the right code, consumes it once, creates the workspace, and emails a welcome message", async () => {
  await sendOtp(GOOD.email.trim().toLowerCase());
  const code = codeFor("priya@acme-solar.in");
  assert.match(code || "", /^\d{6}$/);

  const wrong = await signup({ ...GOOD, otp: code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.field, "otp");

  const res = await signup({ ...GOOD, otp: code });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.token);
  const user = await AdminUser.findOne({ email: "priya@acme-solar.in" }).lean();
  assert.equal(user.name, "Priya Sharma");
  const company = await Company.findOne({ companyId: res.body.company.companyId }).lean();
  assert.equal(company.name, "Acme Solar");
  // The phone number collected at sign-up lands directly in Company
  // Settings' "Contact phone" field — that's the whole point of asking for
  // it here.
  assert.equal(company.contact.phone, "98765 43210");
  const welcome = server.outbox().find((m) => m.to === "priya@acme-solar.in" && m.subject === "Welcome to Nuformly!");
  assert.ok(welcome, "a welcome email should have been sent");
  assert.match(welcome.text, /first chatbot/i);

  // The same code can't be used again (one-time use).
  const reused = await signup({ ...GOOD, otp: code });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.field, "otp");
});

test("the server refuses what the page refuses, and says which field — before ever checking the code", async () => {
  const cases = [
    [{ adminName: "Bob2" }, "adminName", /numbers/],
    [{ companyName: "<b>x</b>" }, "companyName", /symbols/],
    [{ email: "priya@mailinator.com" }, "email", /permanent/],
    [{ email: "priya..x@acme.in" }, "email", /valid email/],
    [{ password: "acmesolar1" }, "password", /easy to guess/],
    // Retired industries (Technology/Finance/Healthcare/E-commerce) are no
    // longer accepted — the list is now Energy/Education/Digital
    // Marketing/General/Other, matching the chatbot sector templates.
    [{ industry: "Technology" }, "industry", /industry/],
    [{ phone: "123" }, "phone", /valid phone/],
  ];
  for (const [patch, field, message] of cases) {
    // GOOD.otp is a placeholder ("000000") that's never actually checked —
    // every case here is rejected by a field check that runs before the
    // code is ever looked up, so none of them need a real, sent code.
    const res = await signup({ ...GOOD, ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.equal(res.body.field, field, JSON.stringify(patch));
    assert.match(res.body.message, message);
  }
  assert.equal(await AdminUser.countDocuments(), 0, "nothing was created");
});

// DB-level, not HTTP — exercises the attempt cap and expiry without
// touching either rate limiter.
test("verifySignupOtp expires on time and locks out after 5 wrong attempts", async () => {
  const email = "expiry@co.test";
  await EmailOtp.create({ email, codeHash: hashOtp("123456"), expiresAt: new Date(Date.now() - 1000), attempts: 0 });
  const expired = await verifySignupOtp(email, "123456");
  assert.equal(expired.ok, false);
  assert.match(expired.message, /expired/);

  await EmailOtp.create({ email, codeHash: hashOtp("654321"), expiresAt: new Date(Date.now() + 60000), attempts: 0 });
  for (let i = 0; i < 5; i++) {
    const wrong = await verifySignupOtp(email, "000000");
    assert.equal(wrong.ok, false);
  }
  const lockedOut = await verifySignupOtp(email, "654321"); // the right code, but attempts are spent
  assert.equal(lockedOut.ok, false);
  assert.match(lockedOut.message, /too many/i);

  await EmailOtp.create({ email: "fresh@co.test", codeHash: hashOtp("222222"), expiresAt: new Date(Date.now() + 60000), attempts: 0 });
  const success = await verifySignupOtp("fresh@co.test", "222222");
  assert.equal(success.ok, true);
  assert.equal(await EmailOtp.findOne({ email: "fresh@co.test" }), null, "a verified code is consumed");
});
