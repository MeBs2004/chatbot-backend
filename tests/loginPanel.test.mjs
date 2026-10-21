import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";

let server;
before(async () => {
  await connectTestDb();
  server = await startTestServer();
});
after(async () => {
  await server?.stop();
  await disconnectTestDb();
});
beforeEach(async () => {
  await resetDb();
  for (const [email, role] of [["super@test.com", "SUPER_ADMIN"], ["company@test.com", "COMPANY_ADMIN"], ["dev@test.com", "DEVELOPER"]]) {
    const u = new AdminUser({ name: role, email, role });
    await u.setPassword("password123");
    await u.save();
  }
});

const login = (email, panel, password = "password123") =>
  fetch(`${server.baseUrl}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, ...(panel ? { panel } : {}) }),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

// A refused login must look exactly like a wrong password.
const WRONG_PASSWORD = { status: 401, message: "Invalid email or password." };

test("the company login refuses a super-admin account: invalid credentials, no token", async () => {
  const r = await login("super@test.com", "company");
  assert.equal(r.status, WRONG_PASSWORD.status);
  assert.equal(r.body.message, WRONG_PASSWORD.message);
  assert.equal(r.body.token, undefined);
});

test("the admin login refuses company accounts: invalid credentials, no token", async () => {
  for (const email of ["company@test.com", "dev@test.com"]) {
    const r = await login(email, "platform");
    assert.equal(r.status, WRONG_PASSWORD.status, email);
    assert.equal(r.body.message, WRONG_PASSWORD.message, email);
    assert.equal(r.body.token, undefined, email);
  }
});

// (this file stays within the login rate limit: 10 attempts per 15 min)
test("each account signs in on its own login page", async () => {
  const superLogin = await login("super@test.com", "platform");
  assert.equal(superLogin.status, 200);
  assert.ok(superLogin.body.token);
  assert.equal((await login("company@test.com", "company")).status, 200);
  assert.equal((await login("dev@test.com", "company")).status, 200);
});

test("a refused login is indistinguishable from a wrong password", async () => {
  const refused = await login("super@test.com", "company");
  const wrong = await login("super@test.com", "company", "wrong-password");
  assert.deepEqual(refused, wrong);
});

test("no panel given (older clients) keeps the old behaviour", async () => {
  assert.equal((await login("super@test.com")).status, 200);
  assert.equal((await login("company@test.com")).status, 200);
});
