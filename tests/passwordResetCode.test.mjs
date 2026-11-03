import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";

// Separate file (own port, own rate-limiter budget) from passwordReset.test.mjs
// — the code path is a second way to use the same /forgot email, not a
// separate feature, but each test file gets an isolated rate limiter so
// this doesn't eat into the link tests' 5-per-15-min budget.
let server;
before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4200 });
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(async () => {
  await resetDb();
  const u = new AdminUser({ name: "Riya Sharma", email: "owner@acme.test", role: "COMPANY_ADMIN" });
  await u.setPassword("old-password-1");
  await u.save();
});

const post = (path, body) =>
  fetch(`${server.baseUrl}/api/password-reset${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const login = (email, password) =>
  fetch(`${server.baseUrl}/api/admin/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, panel: "company" }) }).then((r) => r.status);
const lastCode = () => {
  const mails = server.outbox();
  const m = mails[mails.length - 1]?.text.match(/this: (\d{6})/);
  return m ? m[1] : null;
};

// This file makes exactly 4 /forgot calls (limit: 5/15min) and 12
// /reset-with-code calls (limit: 20/15min) total. Adding cases means
// recounting both budgets, not just appending.

test("verify-code checks a code without spending it, so a wrong guess after doesn't start from zero", async () => {
  await post("/forgot", { email: "owner@acme.test" });
  const code = lastCode();

  const ok = await post("/verify-code", { email: "owner@acme.test", code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const afterVerify = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  assert.equal(afterVerify.resetCodeAttempts, 0, "a correct check doesn't burn an attempt");
  assert.ok(afterVerify.resetCodeHash, "verifying doesn't consume the code");

  const wrong = await post("/verify-code", { email: "owner@acme.test", code: code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.field, "code");
  const afterWrong = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  assert.equal(afterWrong.resetCodeAttempts, 1, "a wrong check still counts against the cap");

  // The code checked above still works for the real, password-setting call.
  const finished = await post("/reset-with-code", { email: "owner@acme.test", code, password: "brand-new-pass42" });
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(await login("owner@acme.test", "brand-new-pass42"), 200);
});

test("reset-with-code sets a new password once, then the code and link both stop working", async () => {
  const before = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  await post("/forgot", { email: "owner@acme.test" });
  const code = lastCode();
  assert.match(code, /^\d{6}$/);

  const ok = await post("/reset-with-code", { email: "owner@acme.test", code, password: "brand-new-pass42" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  assert.equal(await login("owner@acme.test", "brand-new-pass42"), 200);
  assert.equal(await login("owner@acme.test", "old-password-1"), 401);
  const after = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  assert.equal(after.tokenVersion, (before.tokenVersion || 0) + 1, "existing sessions are signed out");
  assert.equal(after.resetTokenHash, null, "the link is burned too, not just the code");

  // The same code can't be reused.
  const reused = await post("/reset-with-code", { email: "owner@acme.test", code, password: "another-pass42" });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.field, "code");
});

test("reset-with-code: wrong codes count down to a lockout, without touching the link", async () => {
  await post("/forgot", { email: "owner@acme.test" });
  const code = lastCode();
  const wrongCode = code === "000000" ? "111111" : "000000";

  let lastMessage = "";
  for (let i = 0; i < 5; i++) {
    const res = await post("/reset-with-code", { email: "owner@acme.test", code: wrongCode, password: "brand-new-pass42" });
    assert.equal(res.status, 400);
    lastMessage = res.body.message;
  }
  assert.match(lastMessage, /too many/i);

  // Locked out even with the right code now...
  const stillLocked = await post("/reset-with-code", { email: "owner@acme.test", code, password: "brand-new-pass42" });
  assert.equal(stillLocked.status, 400);
  assert.match(stillLocked.body.message, /too many|request a new code/i);

  // ...but the link from the very same email is untouched.
  const stored = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  assert.ok(stored.resetTokenHash, "the link survives a locked-out code");
});

test("reset-with-code: validates email, code shape, and password rules; never reveals whether the account exists", async () => {
  const unknown = await post("/reset-with-code", { email: "nobody@acme.test", code: "123456", password: "brand-new-pass42" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.field, "code");

  const badEmail = await post("/reset-with-code", { email: "not-an-email", code: "123456", password: "brand-new-pass42" });
  assert.equal(badEmail.status, 400);
  assert.equal(badEmail.body.field, "email");

  await post("/forgot", { email: "owner@acme.test" });
  const code = lastCode();

  const shortCode = await post("/reset-with-code", { email: "owner@acme.test", code: "123", password: "brand-new-pass42" });
  assert.equal(shortCode.status, 400);
  assert.equal(shortCode.body.field, "code");

  const weakPassword = await post("/reset-with-code", { email: "owner@acme.test", code, password: "short" });
  assert.equal(weakPassword.status, 400);
  assert.equal(weakPassword.body.field, "password");

  assert.equal(await login("owner@acme.test", "old-password-1"), 200, "nothing above actually changed the password");
});
