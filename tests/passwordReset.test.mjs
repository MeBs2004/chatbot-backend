import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";

let server;
before(async () => {
  await connectTestDb();
  server = await startTestServer({ port: 4198 });
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(async () => {
  await resetDb();
  for (const [email, role] of [["owner@acme.test", "COMPANY_ADMIN"], ["super@test.com", "SUPER_ADMIN"]]) {
    const u = new AdminUser({ name: "Riya Sharma", email, role });
    await u.setPassword("old-password-1");
    await u.save();
  }
});

const post = (path, body, headers = {}) =>
  fetch(`${server.baseUrl}/api/password-reset${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const verify = (token) => fetch(`${server.baseUrl}/api/password-reset/verify?token=${encodeURIComponent(token)}`).then((r) => r.json());
const login = (email, password) =>
  fetch(`${server.baseUrl}/api/admin/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, panel: "company" }) }).then((r) => r.status);
const lastLink = () => {
  const mails = server.outbox();
  const m = mails[mails.length - 1]?.text.match(/https?:\/\/\S+\/company\/reset-password\?token=([a-f0-9]{64})/);
  return m ? { url: m[0], token: m[1], count: mails.length } : { count: mails.length };
};

// (this file stays within the /forgot rate limit: 5 requests per 15 minutes)
test("forgot: same answer for unknown, super-admin and company emails; only the company gets a link", async () => {
  const unknown = await post("/forgot", { email: "nobody@acme.test" });
  const superAdmin = await post("/forgot", { email: "super@test.com" });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown, superAdmin);
  assert.equal(lastLink().count, 0, "no email for unknown or super-admin accounts");

  const company = await post("/forgot", { email: "OWNER@acme.test" }, { Origin: "http://admin.test" });
  assert.deepEqual(company, unknown, "the answer never reveals that the account exists");
  const link = lastLink();
  assert.equal(link.count, 1);
  assert.ok(link.url.startsWith("http://admin.test/company/reset-password?token="), "link points at the calling admin panel");
  const stored = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  assert.notEqual(stored.resetTokenHash, link.token, "only a hash of the token is stored");
});

test("reset: the link sets a new password once, then stops working, and old sessions are revoked", async () => {
  const before = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  await post("/forgot", { email: "owner@acme.test" });
  const { token } = lastLink();
  assert.equal((await verify(token)).valid, true);

  assert.equal((await post("/reset", { token, password: "short" })).status, 400);
  const ok = await post("/reset", { token, password: "brand-new-password" });
  assert.equal(ok.status, 200);

  assert.equal(await login("owner@acme.test", "brand-new-password"), 200);
  assert.equal(await login("owner@acme.test", "old-password-1"), 401);
  const afterReset = await AdminUser.findOne({ email: "owner@acme.test" }).lean();
  assert.equal(afterReset.tokenVersion, (before.tokenVersion || 0) + 1, "existing sessions are signed out");

  assert.equal((await verify(token)).valid, false, "a used link is dead");
  assert.equal((await post("/reset", { token, password: "another-password" })).status, 400);
});

test("reset: expired and made-up tokens are refused", async () => {
  await post("/forgot", { email: "owner@acme.test" });
  const { token } = lastLink();
  await AdminUser.updateOne({ email: "owner@acme.test" }, { resetTokenExpires: new Date(Date.now() - 1000) });
  assert.equal((await verify(token)).valid, false);
  assert.equal((await post("/reset", { token, password: "brand-new-password" })).status, 400);
  assert.equal((await post("/reset", { token: "f".repeat(64), password: "brand-new-password" })).status, 400);
  assert.equal((await verify("not-a-token")).valid, false);
});

test("the reset token never appears in API responses", async () => {
  const u = await AdminUser.findOne({ email: "owner@acme.test" });
  u.resetTokenHash = "x".repeat(64);
  u.resetTokenExpires = new Date(Date.now() + 60000);
  await u.save();
  const json = JSON.stringify(u.toJSON());
  assert.ok(!json.includes("resetTokenHash") && !json.includes("resetTokenExpires"));
});
