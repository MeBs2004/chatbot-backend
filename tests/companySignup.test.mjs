import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";
import Company from "../models/company.model.js";

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

const signup = (body) =>
  fetch(`${server.baseUrl}/api/company-signup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));

const GOOD = { companyName: "  Acme   Solar ", industry: "Energy", adminName: " Priya  Sharma ", email: " Priya@Acme-Solar.in ", password: "Sunflower42" };

// (this file stays within the sign-up rate limit: 10 requests per 15 minutes)
test("a valid sign-up creates the workspace with tidied names and a lowercased email", async () => {
  const res = await signup(GOOD);
  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  const user = await AdminUser.findOne({ email: "priya@acme-solar.in" }).lean();
  assert.equal(user.name, "Priya Sharma");
  const company = await Company.findOne({ companyId: res.body.company.companyId }).lean();
  assert.equal(company.name, "Acme Solar");

  const again = await signup({ ...GOOD, companyName: "Another Co" });
  assert.equal(again.status, 409);
  assert.equal(again.body.field, "email");
  assert.equal(again.body.code, "EMAIL_TAKEN");
});

test("the server refuses what the page refuses, and says which field", async () => {
  const cases = [
    [{ adminName: "Bob2" }, "adminName", /numbers/],
    [{ companyName: "<b>x</b>" }, "companyName", /symbols/],
    [{ email: "priya@mailinator.com" }, "email", /permanent/],
    [{ email: "priya..x@acme.in" }, "email", /valid email/],
    [{ password: "acmesolar1" }, "password", /easy to guess/],
    [{ password: "longenoughnodigits" }, "password", /letter and one number/],
    [{ industry: "Mining" }, "industry", /industry/],
  ];
  for (const [patch, field, message] of cases) {
    const res = await signup({ ...GOOD, ...patch });
    assert.equal(res.status, 400, JSON.stringify(patch));
    assert.equal(res.body.field, field, JSON.stringify(patch));
    assert.match(res.body.message, message);
  }
  assert.equal(await AdminUser.countDocuments(), 0, "nothing was created");
});
