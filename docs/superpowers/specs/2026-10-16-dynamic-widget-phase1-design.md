# Dynamic Widget — Phase 1: one snippet, config-driven launcher, isolated public API

Date: 2026-10-16
Repos touched: `chatbot-backend`, `chatbot-frontend` (widget), `admin-panel`

## 1. Goal

A company signs up, creates its own chatbot in the admin panel, designs it in the
Studio, and pastes **one line** onto its website. Nothing about that company is ever
written into code. Every design change made later in the panel reaches the live site
without touching the snippet. One company's chatbot, visitors, messages and AI usage
can never be read, written or spent through another company's identity.

### Success criteria
1. A brand-new company (never seen by any code) can create a chatbot and get a working,
   fully branded widget on its site with zero code changes or deploys.
2. The embed contains only `data-chatbot-id` — no company id, no colours, no text.
3. The launcher (button, greeting, teaser bubbles, icon/avatar, colour, position) comes
   entirely from the chatbot's saved config. No company name appears in `widget.js`.
4. Studio edits appear on the live site on the next page load, and on already-open
   pages within seconds (existing widget realtime room).
5. Every public widget request is resolved to a company **server-side from the
   chatbotId**; a caller can't act as another company by changing a header.
6. Existing installs (Nuform Social, OYA — `data-company-id` only, legacy engine) keep
   working exactly as today.

### Non-goals (later phases)
- Voice input, text-to-speech, file upload in the v1 widget (Phase 2).
- Migrating Nuform Social / OYA off `Bot.jsx` / `OyaBot.jsx` and deleting them (Phase 3).
- Install guides per platform and "installed on example.com" verification (Phase 4).
- Per-chatbot knowledge base / AI settings (today both are shared company-wide by
  design; isolation is between companies, which this spec covers).
- Image upload storage — Phase 1 takes an image URL.

## 2. Current state (verified in code)

- `public/widget.js` hard-codes two looks: `isOya = companyId === "oya-gemkara"`, else
  Nuform Social's logo, teaser messages ("Need SEO Services?"…) and the label "Open
  Nuform Social Assistant". Every other company gets Nuform Social's launcher.
- `Embed.jsx` renders `NuformlyWidget` (config-driven) only when the chatbot's
  `widgetEngineVersion` is `v1`; otherwise `OyaBot` for `oya-gemkara` and `Bot` (Nuform
  Social, hard-coded `x-company-id: "nuform-social"`) for everyone else.
- The create wizard already sets new chatbots to `v1`; the schema default is `legacy`.
- `Chatbot.config` already has `launcher` (enabled, position, shape, color, gradient,
  icon, size, animation, showGreeting, greetingTitle, greetingMessage,
  showNotificationBadge, showOnMobile), `chatWindow` (botName, botAvatar, colours, …),
  `behavior`, `forms`, `language`, `appearance`.
- `GET /api/widget/config/:chatbotId` is public, checks status and `allowedDomains`,
  returns `{ chatbot: { id, name, companyName, template }, config }`.
- Public routes under `/bot/v1/*` (message, visitor, visitor/email, visitor/name,
  suggestions, company) pick the tenant from the `x-company-id` header via
  `companyMiddleware`. `allowedDomains` is only enforced when the body also carries a
  `chatbotId`.
- `POST /bot/v1/visitor/email` and `/visitor/name` return the full Visitor document
  (IP, geo, email, last message) to any caller who knows companyId + visitorId.
- The AI history sent to the model is the visitor's last messages for the **company**,
  not for the chatbot.
- The chat UI runs inside an iframe served from the widget CDN, so every API call it
  makes carries the **CDN's** Origin/Referer, never the customer site's. The
  `allowedDomains` check on `/bot/v1/message` therefore compares the CDN domain: a
  chatbot with any allowed domain set rejects its own widget's messages.

## 3. Design

### 3.1 The snippet

```html
<script src="https://<widget-cdn>/widget.js" data-chatbot-id="<chatbotId>" async></script>
```

Optional overrides stay supported: `data-position`, `data-bottom`, `data-side`.
`data-company-id` stays supported for old installs (§3.6).

### 3.2 `widget.js` becomes a generic loader

1. Read `data-chatbot-id`. If absent but `data-company-id` is present → legacy path,
   unchanged (§3.6).
2. `POST /api/widget/session` with `{ chatbotId }`. This request runs **on the customer's
   page**, so the browser sends the real site Origin. Response: `{ token, expiresAt }`
   plus the same `{ chatbot, config }` payload `GET /api/widget/config/:chatbotId`
   returns. If rejected or `available: false` (paused/offline/not allowed on this
   domain) → render nothing.
3. Draw the launcher purely from `config.launcher` + `config.chatWindow`:

   | Launcher element | Config field |
   |---|---|
   | Visible at all / on mobile | `launcher.enabled`, `launcher.showOnMobile` |
   | Corner | `launcher.position` (overridable by `data-position`) |
   | Shape, size, animation | `launcher.shape`, `launcher.size`, `launcher.animation` |
   | Colour / gradient | `launcher.color`, `launcher.gradient` |
   | Icon | `launcher.icon` (existing values `default` / `chat` / `logo`) — `logo` uses `chatWindow.botAvatar`, falling back to the default icon if empty |
   | Greeting bubble | `launcher.showGreeting`, `greetingTitle`, `greetingMessage` |
   | Rotating teaser bubbles | **new** `launcher.teaserMessages: string[]` (empty → greeting only) |
   | Badge | `launcher.showNotificationBadge` |
   | Accessible label | `"Open " + (chatWindow.botName \|\| chatbot.name)` |
   | Auto-open | `behavior.autoOpen`, `behavior.autoOpenDelay` |

4. On click, open the iframe `/embed?chatbotId=<id>#t=<token>` (no companyId; the token
   is in the fragment so it never reaches server logs).
5. Token refresh: when the iframe gets `401 WIDGET_TOKEN_EXPIRED` it posts
   `{ type: "NUFORMLY_TOKEN_REQUEST" }` to the parent; the loader re-runs step 2 and
   replies `{ type: "NUFORMLY_TOKEN", token }` to the iframe (targetOrigin = widget CDN
   origin; the loader ignores messages whose `event.origin` isn't the CDN origin).
6. Live updates: the loader connects to the existing `/widget` socket.io namespace with
   `auth: { chatbotId }` (`socket.io-client`, already a dependency, bundled into the
   loader). On a `domain:event` of type `chatbot.config.updated` it redraws the launcher
   from the event's `config` (or hides it on `available: false`) and forwards
   `{ type: "NUFORMLY_CONFIG", config }` to the iframe, which `NuformlyWidget` applies.
   The backend already emits this event; nothing listens to it today.

No company id, name, logo or copy is written in `widget.js` anywhere on this path.

**Build.** `public/widget.js` is a static file today and can't see `VITE_BACKEND_URL`,
so the loader moves to `src/widget/` and is built by a second Vite config
(`vite.widget.config.js`, IIFE, output `dist/widget.js`) with the backend URL baked in
from `VITE_BACKEND_URL`; `data-api-base` on the script tag overrides it. The current
launcher code moves verbatim into `src/widget/legacyLauncher.js` and still serves
`data-company-id` snippets. `public/widget.js` is deleted; the published URL
(`<widget-cdn>/widget.js`) stays the same.

### 3.3 Embed

`Embed.jsx`: when `chatbotId` is in the URL, always render `NuformlyWidget` for it —
the chatbot decides its own look; there is no company branch on this path. The
`companyId`-only path is unchanged (§3.6).

### 3.4 Public API: widget session token (isolation)

**Issuing — `POST /api/widget/session`** (public, rate-limited):
1. Validate `chatbotId`; load the chatbot (not deleted) and its company (`isActive`).
2. `isOriginAllowed(chatbot.allowedDomains, req)` — the existing helper. This is the only
   place the site domain is checked, because it is the only request that comes from
   the customer's page.
3. Sign a token: HS256, key = `HMAC-SHA256(JWT_SECRET, "nuformly-widget-token")` (a
   distinct key, so a widget token can never verify as an admin token or vice versa),
   claims `{ aud: "nuformly-widget", cid: chatbotId, co: companyId }`, `expiresIn: "12h"`.
4. Return `{ success, token, expiresAt, available, chatbot, config }` (PAUSED/OFFLINE →
   `available: false`, no token).

**Using — `widgetSessionMiddleware`**, for every public widget endpoint called from the
iframe:
1. Read `x-widget-token`. Verify signature, audience and expiry; expired →
   `401 { code: "WIDGET_TOKEN_EXPIRED" }`, anything else → `401 { code: "WIDGET_TOKEN_INVALID" }`.
2. Load the chatbot by `cid`; reject (404, generic message) if missing, deleted or its
   `companyId` ≠ `co`. Load the company by `co` with `isActive: true`.
3. Set `req.company` and `req.chatbot` from the **database**. Any `x-company-id` or body
   `chatbotId` the caller sent is ignored (a mismatching body `chatbotId` → 404).

Wiring: the four `/bot/v1/*` mounts use **`publicTenantMiddleware`** = `x-widget-token`
present → `widgetSessionMiddleware`, otherwise the existing `companyMiddleware` (old
installs, unchanged). The v1 widget always sends the token. The calculator endpoints
`/api/widget/calculate/:chatbotId/*` also accept the token.

The `allowedDomains` Origin check is removed from the iframe-called paths
(`/bot/v1/message`, `GET /api/widget/config/:chatbotId` when called with a valid token)
— the token already proves the session started on an allowed site. Honest limitation,
kept from the existing docs: a non-browser client can forge Origin when requesting a
token; this protects against other *websites* embedding a chatbot, it is not
authentication.

Further isolation fixes, all endpoints:
- `/bot/v1/visitor`, `/visitor/email`, `/visitor/name` return `{ success: true }` only —
  never the Visitor document.
- Visitor upsert on `/bot/v1/visitor` stamps `chatbotId` (already stamped on message).
- The AI conversation history for a chatbot-scoped request is filtered to
  `{ companyId, visitorId, chatbotId: { $in: [chatbotId, null] } }`, so one chatbot's
  replies never draw on what the visitor told a different chatbot.
- Rate limiting on `/bot/v1/message` and `/api/widget/session` keys on chatbotId + IP
  (`ipKeyGenerator` from express-rate-limit for the IP part), so traffic on one
  chatbot can't exhaust the limit for another.

### 3.5 Admin panel

- **Studio → Launcher**: add a "Teaser messages" list editor (`launcher.teaserMessages`,
  max 10, max 80 chars each). The existing "Company Logo" icon option uses
  `chatWindow.botAvatar`, which takes an image URL (https only).
- **Installation page**: the snippet becomes the one-liner from §3.1 for every v1
  chatbot. The engine selector is hidden for new chatbots (kept for legacy ones until
  Phase 3).
- **Create chatbot**: backend `createChatbot` sets `widgetEngineVersion: "v1"`
  explicitly (not via a schema default change — see §4).

### 3.6 Backward compatibility

- Snippets with `data-company-id` and no `data-chatbot-id` keep today's exact
  behaviour: the same launcher code path (moved into a clearly-labelled legacy
  function), the same `/embed?companyId=` iframe, the same `x-company-id` APIs. Nuform
  Social and OYA see no change.
- A snippet with both attributes uses the new path (chatbotId wins).

## 4. Data changes

| Change | Notes |
|---|---|
| `Chatbot.config.launcher.teaserMessages: [String]`, default `[]` | Added to `config/chatbotConfig.js` defaults **and** to the Mongoose `chatbotConfigSchema` in `models/chatbot.model.js` (the schema strips keys it doesn't define), with a validator: ≤10 entries, each a string ≤80 chars. `mergeChatbotConfig` fills it for existing docs; no migration. |
| `chatWindow.botAvatar` validator | Every other launcher/chatWindow value is already validated by the schema (enums, `HEX_VALIDATOR`, maxlength). `botAvatar` is not: add a validator accepting `""` or an `https://` URL ≤500 chars. `widget.js` puts it on the customer's page; text is always rendered with `textContent`, never `innerHTML`. |
| `createChatbot` writes `widgetEngineVersion: "v1"` | Schema default stays `legacy`: hydrated reads of old documents with no stored field would otherwise silently flip to v1. |

No other collection changes; `chatbotId` on visitors/messages already exists (migrated).

## 5. Error handling

- Config fetch fails or `available: false` → no launcher, no console noise beyond one
  warning; the host page is never affected.
- Any public endpoint rejection uses one generic message ("Chatbot not found.") so a
  caller can't probe which chatbotIds exist or which domains are allowed.
- Token expired mid-chat → the iframe requests a new one from the loader (§3.2 step 5)
  and retries the request once; if that fails it shows the existing offline message.
- `widget.js` guards against double-loading (existing `NuformlyWidgetLoaded`).

## 6. Testing

- **Backend e2e** (same harness as the access suite, local mongod):
  - Token for company A's chatbot + `x-company-id: B` → acts as A only; messages and
    visitors land in A.
  - Chatbot with `allowedDomains: ["a.com"]`: session request with Origin `b.com` →
    rejected; with Origin `a.com` → token; requests carrying that token succeed with the
    CDN Origin (the iframe case).
  - Expired, tampered, wrong-audience, and admin-JWT-as-widget-token → 401; a widget
    token sent as an admin Bearer token → 401.
  - Visitor endpoints never return IP/geo/email.
  - AI history for chatbot X excludes messages stamped with chatbot Y.
  - Old `x-company-id`-only requests behave exactly as before.
- **Widget**: a static test page per case — new company (only chatbotId), Nuform Social
  snippet, OYA snippet — checked in a real browser: launcher look matches Studio,
  Studio change appears after reload and live, paused chatbot shows nothing.
- `vite build` for admin-panel and chatbot-frontend.

## 7. Rollout

1. Deploy backend (backward compatible; old widgets unaffected).
2. Deploy chatbot-frontend (`widget.js` + Embed) — old snippets take the legacy path.
3. Deploy admin-panel (new snippet + Studio fields).
4. New companies use the one-line snippet from day one; existing ones move when Phase 3
   lands.
