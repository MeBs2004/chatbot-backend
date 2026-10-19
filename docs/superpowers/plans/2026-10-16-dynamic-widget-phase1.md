# Dynamic Widget Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any company can create a chatbot and install it with a one-line snippet whose look comes entirely from the admin panel, while every public widget request is bound to that chatbot's company server-side.

**Architecture:** The loader (`widget.js`, running on the customer's page) requests a short-lived signed widget session token; the backend checks the site's Origin against the chatbot's allowed domains only at that moment. The chat iframe sends the token on every call, and a new middleware derives `req.company`/`req.chatbot` from it. The loader draws the launcher purely from the chatbot's saved config and listens for live config updates; old `data-company-id` snippets keep their exact current code path.

**Tech Stack:** Node 25 / Express 4 / Mongoose 8 / jsonwebtoken / express-rate-limit 8 / socket.io (backend); React + Vite 7 + axios + socket.io-client (`chatbot-frontend`, `admin-panel`); tests with Node's built-in `node --test`.

**Spec:** `chatbot-backend/docs/superpowers/specs/2026-10-16-dynamic-widget-phase1-design.md`

## Global Constraints

- Work on a branch `feat/dynamic-widget` in each of the three repos. Do not commit `.env` files.
- Backend tests run against a **local** MongoDB only: `TEST_MONGO_URI`, default `mongodb://127.0.0.1:27017/nuformly_test`. The test helper must refuse any host other than `127.0.0.1` / `localhost` (the real `.env` points at production Atlas).
- Widget token: HS256; key = `HMAC-SHA256(JWT_SECRET, "nuformly-widget-token")`; claims `{ aud: "nuformly-widget", cid: <chatbotId>, co: <companyId> }`; `expiresIn: "12h"`.
- Header name `x-widget-token`. Error codes `WIDGET_TOKEN_EXPIRED`, `WIDGET_TOKEN_INVALID` (both HTTP 401).
- Every rejection of an unknown/deleted/foreign chatbot on a public route uses the message `"Chatbot not found."` with HTTP 404.
- `launcher.teaserMessages`: array, ≤10 entries, each a string ≤80 chars, default `[]`.
- `chatWindow.botAvatar`: `""` or an `https://` URL ≤500 chars.
- postMessage types: `NUFORMLY_TOKEN_REQUEST`, `NUFORMLY_TOKEN`, `NUFORMLY_CONFIG`, existing `NUFORMLY_CLOSE`.
- Text from config is rendered on the customer page with `textContent` / DOM APIs only — never `innerHTML`.
- Snippets with only `data-company-id` behave exactly as today (legacy launcher, `/embed?companyId=`, `x-company-id` APIs).
- New snippet: `<script src="<widget-cdn>/widget.js" data-chatbot-id="<id>" async></script>`; `data-position`, `data-bottom`, `data-side`, `data-api-base` optional.

## Review Focus

1. **Chatbot with allowed domains set, chatted with from the iframe** — must work (token proves the site), where today it breaks. Test: Task 2 `allowed-domain chatbot accepts token from CDN origin`.
2. **Token expires mid-conversation** — the next message must still go through after one silent refresh, not show an error. Test: Task 7 `retries once after WIDGET_TOKEN_EXPIRED`.
3. **Loader on a page where the session request fails** (paused chatbot, wrong domain, backend down) — nothing renders and the host page throws nothing. Test: Task 6 `renders nothing when session unavailable`.
4. **Old snippet with both `data-company-id` and `data-chatbot-id`** (existing v1 installs) — takes the new path and still shows the chatbot. Test: Task 5 `pickMode prefers chatbotId`.
5. **Config text containing HTML** (`<img onerror=…>` in a greeting or teaser) on a customer's page — shown as literal text. Test: Task 6 `renders config text as text`.

---

## File Structure

**chatbot-backend**
- Create `services/widget/widgetToken.service.js` — sign/verify widget tokens.
- Create `controllers/widget/session.controller.js`, `routes/widget/session.route.js` — `POST /api/widget/session`.
- Create `middleware/widgetSession.middleware.js` — `widgetSessionMiddleware`, `publicTenantMiddleware`, `isWidgetRequestAllowed`.
- Modify `index.js` — mount session route, use `publicTenantMiddleware` on `/bot/v1/*`, add `x-widget-token` to public CORS headers.
- Modify `controllers/chatbot.message.js`, `controllers/visitor.controller.js`, `controllers/widget/config.controller.js`, `controllers/widget/calculator.controller.js`, `routes/chatbot.route.js`.
- Modify `config/chatbotConfig.js`, `models/chatbot.model.js`, `controllers/admin/chatbot.controller.js`.
- Create `tests/helpers/testServer.mjs`, `tests/helpers/seed.mjs`, `tests/widgetSession.test.mjs`, `tests/publicTenant.test.mjs`, `tests/publicIsolation.test.mjs`, `tests/chatbotConfig.test.mjs`. Add `"test": "node --test --test-concurrency=1 tests/"` to `package.json`.

**chatbot-frontend**
- Create `vite.widget.config.js`, `src/widget/loader.js` (entry), `src/widget/launcherModel.js` (pure), `src/widget/launcher.js` (DOM), `src/widget/session.js`, `src/widget/legacyLauncher.js` (moved verbatim from `public/widget.js`).
- Delete `public/widget.js`; add `public/widget.js` to `.gitignore` (dev build output).
- Create `src/components/NuformlyWidget/widgetApi.js`; modify `NuformlyWidget.jsx`, `src/pages/Embed.jsx`.
- Create `tests/launcherModel.test.mjs`, `tests/widgetApi.test.mjs`; add `"test": "node --test tests/"`.

**admin-panel**
- Modify `src/pages/chatbots/studio/SectionLauncher.jsx`, `src/pages/chatbots/ChatbotInstall.jsx`, `src/config/chatbotConfigDefaults.js` (add `teaserMessages: []`).

---

### Task 1: Widget session token + `POST /api/widget/session` (with test harness)

**Files:**
- Create: `chatbot-backend/services/widget/widgetToken.service.js`
- Create: `chatbot-backend/controllers/widget/session.controller.js`, `chatbot-backend/routes/widget/session.route.js`
- Modify: `chatbot-backend/index.js` (mount at `/api/widget/session`), `chatbot-backend/package.json`
- Create: `chatbot-backend/tests/helpers/testServer.mjs`, `chatbot-backend/tests/helpers/seed.mjs`, `chatbot-backend/tests/widgetSession.test.mjs`

**Interfaces:**
- Produces:
  - `signWidgetToken({ chatbotId: string, companyId: string }) -> { token: string, expiresAt: string /* ISO */ }`
  - `verifyWidgetToken(token: string) -> { chatbotId: string, companyId: string }`, throws `WidgetTokenError` with `.code` ∈ `{"WIDGET_TOKEN_EXPIRED","WIDGET_TOKEN_INVALID"}` and `.status = 401`.
  - `startTestServer({ port?: number }) -> Promise<{ baseUrl: string, stop(): Promise<void> }>` — spawns `node index.js` with `MONGO_URI=TEST_MONGO_URI`, `JWT_SECRET="test-secret"`, `GROQ_API_KEY_1="test"`, `PORT`, `ADMIN_ALLOWED_ORIGINS="http://admin.test"`; waits for `GET /health` 200 (20 s); refuses non-local Mongo hosts.
  - `connectTestDb() -> Promise<void>`, `resetDb() -> Promise<void>` (drops the test database), `seedTenant({ companyId, chatbots: [{ name, allowedDomains?, status? }] }) -> { company, chatbots }` in `seed.mjs`.
  - Response of `POST /api/widget/session`: `{ success: true, available: true, token, expiresAt, chatbot: { id, name, companyName, template }, config }`, or `{ success: true, available: false, reason: "paused"|"offline" }`.

- [ ] **Step 1: Write the failing tests** in `tests/widgetSession.test.mjs`:
  - `issues a token for a chatbot with no domain restriction` — POST `{ chatbotId }`, no Origin → 200, `available: true`, `token` is a string, `verifyWidgetToken(token)` returns `{ chatbotId, companyId }` of the seed.
  - `rejects a session from a non-allowed origin` — chatbot `allowedDomains: ["a.test"]`, header `Origin: https://b.test` → 404 `"Chatbot not found."`; `Origin: https://shop.a.test` with `["*.a.test"]` → 200.
  - `paused chatbot gets no token` → 200 `{ available: false, reason: "paused" }`, no `token` key.
  - `unknown, malformed, or deleted chatbotId` → 404 `"Chatbot not found."` (three cases).
  - `inactive company gets no token` → 404.
  - `verifyWidgetToken rejects tampered, wrong-audience and expired tokens` — expired → code `WIDGET_TOKEN_EXPIRED`; token signed with `JWT_SECRET` directly → `WIDGET_TOKEN_INVALID`.
  - `a widget token is not accepted as an admin token` — `GET /api/admin/auth/me` with `Authorization: Bearer <widget token>` → 401.
- [ ] **Step 2: Run** `npm test` → FAIL (route and module missing).
- [ ] **Step 3: Implement** the token service, controller and route. Rate limit the route: 30/min, key `` `${req.body?.chatbotId}:${ipKeyGenerator(req.ip)}` ``. The controller reuses `mergeChatbotConfig` and the PAUSED/OFFLINE rule from `controllers/widget/config.controller.js` (extract the payload builder there as `buildPublicWidgetPayload(chatbot, company)` and use it from both).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(widget): signed widget session tokens`.

### Task 2: `publicTenantMiddleware` on public routes

**Files:**
- Create: `chatbot-backend/middleware/widgetSession.middleware.js`
- Modify: `chatbot-backend/index.js:131-140` (CORS allow-headers add `x-widget-token`), `index.js` `/bot/v1*` mounts, `controllers/chatbot.message.js:31-55`, `controllers/widget/config.controller.js`, `controllers/widget/calculator.controller.js:15-22`
- Test: `chatbot-backend/tests/publicTenant.test.mjs`

**Interfaces:**
- Consumes: `verifyWidgetToken` (Task 1).
- Produces:
  - `widgetSessionMiddleware(req, res, next)` — sets `req.company` (same shape `getCompanyById` returns) and `req.chatbot` (`{ _id, companyId, allowedDomains, status }`, lean).
  - `publicTenantMiddleware` — `x-widget-token` present → `widgetSessionMiddleware`, else existing `companyMiddleware`.
  - `isWidgetRequestAllowed(req, chatbot) -> boolean` — true if `x-widget-token` verifies for `chatbot._id`, else falls back to `isOriginAllowed(chatbot.allowedDomains, req)`.

- [ ] **Step 1: Write the failing tests:**
  - `token tenant wins over x-company-id` — token for company A + `x-company-id: B`, `POST /bot/v1/message` → the stored `User` message has `companyId` A and `chatbotId` A's bot; nothing written for B.
  - `body chatbotId from another company is rejected` — token for A, body `chatbotId` = B's bot → 404 `"Chatbot not found."`.
  - `allowed-domain chatbot accepts token from CDN origin` — chatbot `allowedDomains: ["a.test"]`; session with `Origin: https://a.test`; then `POST /bot/v1/message` and `GET /api/widget/config/:id` with `Origin: https://cdn.test` + token → both succeed.
  - `invalid and expired tokens` → 401 with the matching `code` on `/bot/v1/message`, `/bot/v1/visitor`, `/bot/v1/suggestions`.
  - `legacy x-company-id requests unchanged` — no token, `x-company-id: A` → `/bot/v1/company` 200 and `/bot/v1/message` stores under A, as before.
  - `CORS preflight allows x-widget-token` — `OPTIONS /bot/v1/message` → `Access-Control-Allow-Headers` contains `x-widget-token`.
  - (Message tests may get a 500 from the AI call with the fake Groq key; assert on stored documents, which are written before the AI call.)
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.** In `Message`, when `req.chatbot` is set: `requestedChatbotId = req.chatbot._id`; a body `chatbotId` that differs → 404; skip the origin check. Config and calculator controllers replace their `isOriginAllowed(...)` call with `isWidgetRequestAllowed(req, chatbot)`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(widget): derive public tenant from widget token`.

### Task 3: Public isolation fixes

**Files:**
- Modify: `chatbot-backend/controllers/visitor.controller.js` (all three handlers), `controllers/chatbot.message.js` (history query ~line 560), `routes/chatbot.route.js` (`messageLimiter`)
- Test: `chatbot-backend/tests/publicIsolation.test.mjs`

**Interfaces:**
- Consumes: `req.chatbot` (Task 2).

- [ ] **Step 1: Write the failing tests:**
  - `visitor endpoints return no visitor data` — `POST /bot/v1/visitor`, `/visitor/email`, `/visitor/name` → body is exactly `{ success: true }` (no `visitor`, `ip`, `email`).
  - `visitor is stamped with the token's chatbot` — after `POST /bot/v1/visitor` with a token, `Visitor.chatbotId` = the bot.
  - `AI history excludes other chatbots` — seed visitor `v1` messages stamped bot Y; send a message as bot X; assert the history passed to the AI excludes Y's text. Expose it by exporting `buildHistoryFilter({ companyId, visitorId, chatbotId })` from `chatbot.message.js` and asserting it equals `{ companyId, visitorId, chatbotId: { $in: [X, null] } }` (and `{ companyId, visitorId }` when `chatbotId` is null).
  - `message rate limit is per chatbot` — 30 messages on bot X from one IP, then the 31st on X → 429 and the first on bot Y → not 429. The test server runs with `trust proxy 1`; set the same `X-Forwarded-For` on every request.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.** `saveVisitor` sets `chatbotId: req.chatbot._id` when present (both create and update branches). `messageLimiter.keyGenerator`: `` `${req.chatbot?._id || "-"}:${ipKeyGenerator(req.ip)}` ``.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `fix(widget): isolate public visitor data and AI history per chatbot`.

### Task 4: Config schema additions + v1 by default

**Files:**
- Modify: `chatbot-backend/config/chatbotConfig.js` (defaults), `models/chatbot.model.js:29-83` (schema), `controllers/admin/chatbot.controller.js:250` (`Chatbot.create`)
- Test: `chatbot-backend/tests/chatbotConfig.test.mjs`

- [ ] **Step 1: Write the failing tests** (admin calls signed with a SUPER_ADMIN token from `jsonwebtoken` using `"test-secret"` and `Origin: http://admin.test`):
  - `teaserMessages saved and returned` — `PATCH /api/admin/chatbots/:id/config` `{ launcher: { teaserMessages: ["Hi", "Need help?"] } }` → 200; `GET /api/widget/config/:id` → `config.launcher.teaserMessages` equals that array.
  - `teaserMessages limits` — 11 entries → 400; an 81-char entry → 400; a non-string entry → 400.
  - `existing chatbot without the field gets []` — seed raw document with no `teaserMessages` → public config returns `[]`.
  - `botAvatar must be https` — `"http://x.test/a.png"` → 400, `"javascript:alert(1)"` → 400, `""` and `"https://x.test/a.png"` → 200.
  - `new chatbots are v1` — `POST /api/admin/chatbots` → `widgetEngineVersion: "v1"`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** the schema fields/validators (validator messages surface through the existing `ValidationError` → 400 path) and `widgetEngineVersion: "v1"` in `Chatbot.create`. Leave the schema default as `"legacy"`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(chatbot-config): launcher teaser messages, avatar URL validation, v1 default`.

### Task 5: Widget build pipeline + launcher model

**Files:**
- Create: `chatbot-frontend/vite.widget.config.js`, `src/widget/loader.js`, `src/widget/launcherModel.js`, `src/widget/legacyLauncher.js`
- Delete: `chatbot-frontend/public/widget.js`; modify `.gitignore`, `package.json`
- Test: `chatbot-frontend/tests/launcherModel.test.mjs`

**Interfaces:**
- Produces (`launcherModel.js`, pure, no DOM):
  - `readAttributes(script) -> { chatbotId, companyId, position, bottom, side, apiBase }` (`position` ∈ `"left"|"right"|null`).
  - `pickMode(attrs) -> "dynamic" | "legacy" | "none"` — `chatbotId` → dynamic; else `companyId` → legacy; else none.
  - `buildLauncherModel({ config, chatbot, attrs, isMobile }) -> null | { side, bottom, sideOffset, shape, size, animation, background /* css colour or linear-gradient */, icon: { kind: "default"|"chat"|"image", src? }, label, greeting: { title, message } | null, teasers: string[], showBadge, autoOpenMs: number | null }` — `null` when `launcher.enabled` is false, or `isMobile && !showOnMobile`.
- `legacyLauncher.js` exports `startLegacyLauncher({ script, companyId, chatbotId, position, bottom, side })` containing the current `public/widget.js` body unchanged apart from reading those values from its argument.
- `loader.js`: captures `document.currentScript` synchronously, guards `window.NuformlyWidgetLoaded`, dispatches by `pickMode` (dynamic path is wired in Task 6; until then it calls nothing).

- [ ] **Step 1: Write the failing tests** in `tests/launcherModel.test.mjs`:
  - `pickMode prefers chatbotId` — both attributes → `"dynamic"`; only company → `"legacy"`; neither → `"none"`.
  - `position: data-position overrides config` — config `bottom-left`, attr `right` → `side: "right"`; no attr → `"left"`.
  - `gradient vs solid background`, `icon logo with avatar → image`, `icon logo without avatar → default`.
  - `label uses botName then chatbot name` → `"Open Aria"` / `"Open Acme Sales"`.
  - `hidden when disabled or mobile-hidden` → `null`.
  - `greeting null when showGreeting false`; `autoOpenMs` = `autoOpenDelay * 1000` only when `autoOpen`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.** `vite.widget.config.js`: `build.lib = { entry: "src/widget/loader.js", formats: ["iife"], name: "NuformlyWidgetLoader", fileName: () => "widget.js" }`, `outDir: "dist"`, `emptyOutDir: false`. `package.json`: `"build": "vite build && vite build --config vite.widget.config.js"`, `"dev:widget": "vite build --watch --config vite.widget.config.js --outDir public"`, `"test": "node --test tests/"`. Backend base = `attrs.apiBase || import.meta.env.VITE_BACKEND_URL`.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run build` → `dist/widget.js` exists; open `test.html` (Nuform Social snippet) against `dist/` → legacy launcher looks and behaves as before.
- [ ] **Step 5: Commit** `refactor(widget): build loader with Vite, extract launcher model`.

### Task 6: Dynamic launcher (session, DOM, iframe, live updates)

**Files:**
- Create: `chatbot-frontend/src/widget/session.js`, `src/widget/launcher.js`; modify `src/widget/loader.js`
- Create: `chatbot-frontend/test-dynamic.html` (manual test page)

**Interfaces:**
- Consumes: `buildLauncherModel`, `readAttributes` (Task 5); `POST /api/widget/session` (Task 1).
- Produces:
  - `fetchSession(apiBase, chatbotId) -> Promise<null | { token, expiresAt, chatbot, config }>` — `null` on any failure or `available: false`; never throws.
  - `mountLauncher(model, { onClick }) -> { update(model | null): void, destroy(): void }` — DOM only via `createElement`/`textContent`/`style`.
  - Iframe URL: `` `${WIDGET_ORIGIN}/embed?chatbotId=${id}#t=${token}` `` where `WIDGET_ORIGIN = new URL(script.src).origin`.

- [ ] **Step 1: Write the manual test page** `test-dynamic.html` with three snippets commented in/out: dynamic (`data-chatbot-id` only), legacy Nuform Social, legacy OYA.
- [ ] **Step 2: Implement** the dynamic path in `loader.js`: `fetchSession` → `null` ⇒ return silently; otherwise `mountLauncher(buildLauncherModel(...))`, the iframe open/close logic from the legacy launcher (same sizing/mobile rules), `NUFORMLY_CLOSE` handling, and:
  - token refresh: on `message` from `WIDGET_ORIGIN` with `NUFORMLY_TOKEN_REQUEST` → `fetchSession` → post `{ type: "NUFORMLY_TOKEN", token }` to the iframe with `targetOrigin = WIDGET_ORIGIN`; ignore messages from any other origin.
  - live updates: `io(`${apiBase}widget`, { auth: { chatbotId } })`; on `domain:event` with `type === "chatbot.config.updated"` → `update(available ? buildLauncherModel({ config }) : null)` and forward `{ type: "NUFORMLY_CONFIG", config }` to the iframe.
- [ ] **Step 3: Verify in a browser** with the local backend and a chatbot whose config sets a greeting, two teasers and a colour:
  - `renders the configured launcher` — colour, corner, greeting and teasers match the Studio; no "Nuform Social" text anywhere on the page.
  - `renders config text as text` — set `greetingMessage` to `<img src=x onerror=alert(1)>` → shown literally, no alert.
  - `renders nothing when session unavailable` — pause the chatbot → no launcher, no console errors except one warning; wrong `allowedDomains` → same.
  - `live update` — change the launcher colour in the Studio with the page open → launcher recolours within a few seconds without reload.
  - `legacy unchanged` — Nuform Social and OYA snippets look and work as before.
- [ ] **Step 4: Run** `npm test && npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(widget): config-driven launcher with session tokens and live updates`.

### Task 7: Chat iframe uses the token

**Files:**
- Create: `chatbot-frontend/src/components/NuformlyWidget/widgetApi.js`
- Modify: `chatbot-frontend/src/components/NuformlyWidget/NuformlyWidget.jsx` (calls at lines ~105, 176, 205, 275), `src/pages/Embed.jsx`
- Test: `chatbot-frontend/tests/widgetApi.test.mjs`

**Interfaces:**
- Consumes: `NUFORMLY_TOKEN_REQUEST` / `NUFORMLY_TOKEN` / `NUFORMLY_CONFIG` messages (Task 6).
- Produces: `createWidgetClient({ baseURL, getToken: () => string | null, requestToken: () => Promise<string | null> }) -> AxiosInstance` — adds `x-widget-token` when `getToken()` returns one; on 401 with `code === "WIDGET_TOKEN_EXPIRED"` calls `requestToken()` once, then retries the request once.
  `requestTokenFromParent(parentOrigin: string, timeoutMs = 5000) -> Promise<string | null>` — posts `NUFORMLY_TOKEN_REQUEST`, resolves with the next `NUFORMLY_TOKEN` from `parentOrigin`, or `null` on timeout.

- [ ] **Step 1: Write the failing tests** in `tests/widgetApi.test.mjs` using a fake axios adapter:
  - `sends x-widget-token when present` and `omits it when null`.
  - `retries once after WIDGET_TOKEN_EXPIRED` — first response 401 expired, `requestToken` resolves `"new"`, second request carries `"new"` and succeeds; `requestToken` called exactly once.
  - `does not retry on WIDGET_TOKEN_INVALID or when refresh returns null` — rejects with the original error.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement.** `Embed.jsx` reads `t` from `location.hash` and passes `token` to `NuformlyWidget` when `chatbotId` and `token` are both present; otherwise unchanged. `NuformlyWidget` uses `createWidgetClient` for all four calls, drops `x-company-id` when it has a token, and applies `NUFORMLY_CONFIG` messages (from `document.referrer`'s origin) as a new config.
- [ ] **Step 4: Run** `npm test && npm run build` → PASS; in the browser from Task 6, chat end-to-end on a chatbot with `allowedDomains` set to the test page's host → replies arrive; a conversation appears under that company in the admin panel with the right chatbot.
- [ ] **Step 5: Commit** `feat(widget): chat iframe authenticates with the widget token`.

### Task 8: Admin panel — teaser editor and one-line snippet

**Files:**
- Modify: `admin-panel/src/pages/chatbots/studio/SectionLauncher.jsx`, `admin-panel/src/config/chatbotConfigDefaults.js`, `admin-panel/src/pages/chatbots/ChatbotInstall.jsx:95-105` and the "Rendering engine" section

- [ ] **Step 1: Implement** a "Teaser messages" textarea in the Greeting section (one message per line; trims, drops empty lines; shows "max 10 messages, 80 characters each" and blocks saving beyond that; writes `launcher.teaserMessages`). Add `teaserMessages: []` to the frontend defaults. Install page: for v1 chatbots the snippet is exactly `<script\n  src="${WIDGET_CDN_URL}/widget.js"\n  data-chatbot-id="${chatbot._id}"\n  async\n></script>` and the engine selector is hidden; legacy chatbots keep today's snippet and selector.
- [ ] **Step 2: Verify:** `npx vite build` passes; in the panel as a company admin, create a chatbot → Installation shows the one-liner; add two teasers in the Studio, save, reload the Task 6 test page → both rotate in the launcher bubble.
- [ ] **Step 3: Commit** `feat(admin): launcher teaser messages and one-line install snippet`.
