import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { startTestServer, TEST_JWT_SECRET } from "./helpers/testServer.mjs";
import { connectTestDb, resetDb, disconnectTestDb, seedTenant } from "./helpers/seed.mjs";
import AdminUser from "../models/adminUser.model.js";

let server;
let adminToken;
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
  const user = new AdminUser({ name: "Super", email: "super@test", role: "SUPER_ADMIN" });
  await user.setPassword("password123");
  await user.save();
  adminToken = jwt.sign({ sub: String(user._id), role: "SUPER_ADMIN", tokenVersion: 0 }, TEST_JWT_SECRET, { expiresIn: "1h" });
});

const admin = (method, path, body) =>
  fetch(`${server.baseUrl}/api/admin${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
const saveConfig = (id, config) => admin("PATCH", `/chatbots/${id}/config`, { config });
const publicConfig = async (id) => (await fetch(`${server.baseUrl}/api/widget/config/${id}`)).json();

test("teaserMessages saved and returned", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const res = await saveConfig(chatbots[0]._id, { launcher: { teaserMessages: ["Hi", "Need help?"] } });
  assert.equal(res.status, 200);
  assert.deepEqual((await publicConfig(chatbots[0]._id)).config.launcher.teaserMessages, ["Hi", "Need help?"]);
});

test("teaserMessages limits", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: Array(13).fill("hi") } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: Array(12).fill("hi") } })).status, 200);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: ["x".repeat(81)] } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: [{ text: "hi" }] } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { teaserMessages: ["x".repeat(80)] } })).status, 200);
});

test("existing chatbot without the field gets []", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  await mongoose.connection.db
    .collection("chatbots")
    .updateOne({ _id: chatbots[0]._id }, { $set: { config: { launcher: { color: "#123456" } } } });
  const { config } = await publicConfig(chatbots[0]._id);
  assert.deepEqual(config.launcher.teaserMessages, []);
  assert.equal(config.launcher.color, "#123456");
});

test("botAvatar must be https", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const avatar = (v) => saveConfig(id, { chatWindow: { botAvatar: v } });
  assert.equal((await avatar("http://x.test/a.png")).status, 400);
  assert.equal((await avatar("javascript:alert(1)")).status, 400);
  assert.equal((await avatar("https://x.test/" + "a".repeat(500))).status, 400);
  assert.equal((await avatar("")).status, 200);
  assert.equal((await avatar("https://x.test/a.png")).status, 200);
});

test("new chatbots are v1", async () => {
  await seedTenant({ companyId: "fresh" });
  const res = await admin("POST", "/chatbots", { companyId: "fresh", name: "First Bot" });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await res.json()).chatbot.widgetEngineVersion, "v1");
});

test("studio styling options round-trip to the public config", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const res = await saveConfig(id, {
    launcher: { icon: "robot", animation: "ripple", entrance: "slide-up", hoverEffect: "spin", style: "icon-label", labelText: "Ask us", shape: "squircle", shadow: "glow", iconColor: "#112233", badgeColor: "#00ff00" },
    chatWindow: { bubbleStyle: "pill", windowAnimation: "bounce", messageAnimation: "pop", chatBackground: "dots", suggestionStyle: "outline", userBubbleColor: "#6366f1", headerGradient: { enabled: true, from: "#000000", to: "#6366f1" }, inputPlaceholder: "Ask away", subtitle: "Replies instantly", showMessageAvatars: true },
    behavior: { showTimestamps: true },
    appearance: { font: "poppins", fontSize: "large" },
  });
  assert.equal(res.status, 200, await res.clone().text());
  const { config } = await publicConfig(id);
  assert.equal(config.launcher.icon, "robot");
  assert.equal(config.launcher.labelText, "Ask us");
  assert.equal(config.chatWindow.headerGradient.to, "#6366f1");
  assert.equal(config.chatWindow.windowAnimation, "bounce");
  assert.equal(config.behavior.showTimestamps, true);
  assert.equal(config.appearance.font, "poppins");
  // untouched siblings keep their defaults
  assert.equal(config.launcher.position, "bottom-right");
});

test("studio styling options are validated", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  assert.equal((await saveConfig(id, { launcher: { animation: "spin-forever" } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { bubbleStyle: "blob" } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { userBubbleColor: "red" } })).status, 400);
  assert.equal((await saveConfig(id, { appearance: { font: "comic-sans" } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { userBubbleColor: "" } })).status, 200);
});

test("uploaded logo: small data image ok, scripts and oversized rejected", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const logo = (v) => saveConfig(id, { launcher: { logoUrl: v } });
  assert.equal((await logo("data:image/png;base64,iVBORw0KGgo=")).status, 200);
  assert.equal((await logo("data:text/html;base64,PHNjcmlwdD4=")).status, 400);
  assert.equal((await logo("data:image/svg+xml;base64,PHN2Zz4=")).status, 400);
  assert.equal((await logo("javascript:alert(1)")).status, 400);
  assert.equal((await logo("data:image/png;base64," + "A".repeat(61000))).status, 400);
  assert.equal((await logo("https://x.test/logo.png")).status, 200);
  assert.equal((await saveConfig(id, { chatWindow: { botAvatar: "data:image/jpeg;base64,/9j/4AAQ" } })).status, 200);
});

test("autoOpenAnimation: 15 animations plus default are accepted; unknown rejected", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const names = ["default", "slide-up", "slide-down", "slide-left", "slide-right", "fade", "scale", "zoom", "bounce", "flip", "flip-y", "drop", "rotate", "elastic", "swing", "blur"];
  for (const name of names) {
    assert.equal((await saveConfig(id, { behavior: { autoOpenAnimation: name } })).status, 200, name);
  }
  assert.equal((await publicConfig(id)).config.behavior.autoOpenAnimation, "blur");
  assert.equal((await saveConfig(id, { behavior: { autoOpenAnimation: "spin-forever" } })).status, 400);
});

test("size options: default to automatic (null), save, validate ranges, reach the public config", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;

  const fresh = (await publicConfig(id)).config;
  assert.equal(fresh.chatWindow.suggestionWidth, null);
  assert.equal(fresh.launcher.customSize, null);

  const res = await saveConfig(id, {
    launcher: { customSize: 80, iconSize: 40, bubbleMaxWidth: 300 },
    chatWindow: { suggestionHeight: 44, suggestionWidth: 180, ctaHeight: 48, ctaWidth: 200, ctaRadius: 0, customWidth: 420, customHeight: 640, inputHeight: 56 },
    forms: { fieldHeight: 46, buttonHeight: 48, fontSize: 15 },
    appearance: { fontSizePx: 16 },
  });
  assert.equal(res.status, 200, await res.clone().text());
  const { config } = await publicConfig(id);
  assert.equal(config.chatWindow.suggestionWidth, 180);
  assert.equal(config.chatWindow.ctaRadius, 0, "0 is a real value, not 'unset'");
  assert.equal(config.forms.buttonHeight, 48);
  assert.equal(config.appearance.fontSizePx, 16);
  assert.equal(config.launcher.customSize, 80);

  // out of range
  assert.equal((await saveConfig(id, { launcher: { customSize: 5 } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { customWidth: 5000 } })).status, 400);
  assert.equal((await saveConfig(id, { forms: { fieldHeight: -1 } })).status, 400);
  // not a number
  assert.equal((await saveConfig(id, { chatWindow: { suggestionHeight: "tall" } })).status, 400);
  // back to automatic
  assert.equal((await saveConfig(id, { chatWindow: { suggestionWidth: null } })).status, 200);
  assert.equal((await publicConfig(id)).config.chatWindow.suggestionWidth, null);
  // untouched sizes survive a later partial save
  assert.equal((await publicConfig(id)).config.chatWindow.suggestionHeight, 44);
});

test("a new chatbot starts with the Nuform look; older chatbots keep the neutral defaults", async () => {
  const { STARTER_CHATBOT_CONFIG } = await import("../config/chatbotStarter.js");
  await seedTenant({ companyId: "fresh" });
  const res = await admin("POST", "/chatbots", { companyId: "fresh", name: "Starter Bot", template: "energy" });
  assert.equal(res.status, 201, await res.clone().text());
  const created = (await res.json()).chatbot;
  const { config } = await publicConfig(created._id);

  assert.equal(config.chatWindow.botName, "Nuform Social Assistant");
  assert.equal(config.chatWindow.headerHeight, 74);
  assert.equal(config.chatWindow.headerGradient.to, "#067647");
  assert.equal(config.launcher.logoOnly, true);
  assert.equal(config.launcher.customSize, 55);
  assert.equal(config.launcher.animation, "float-ripple");
  assert.equal(config.launcher.teaserMessages.length, 11);
  assert.deepEqual(config.ctas.map((c) => c.label), ["Call", "WhatsApp", "Email"]);
  assert.deepEqual(config.ctas.map((c) => c.color), ["#067647", "#25D366", "#E36B0A"]);
  assert.equal(config.behavior.askEmail, true);
  assert.deepEqual(config, JSON.parse(JSON.stringify(STARTER_CHATBOT_CONFIG)), "public config equals the starter exactly");

  // The same for every template.
  for (const [i, template] of ["education", "digital_marketing", "general"].entries()) {
    await seedTenant({ companyId: `tpl-${i}` }); // one company each — the free plan caps chatbots per company
    const r = await admin("POST", "/chatbots", { companyId: `tpl-${i}`, name: `Bot ${i}`, template });
    assert.equal(r.status, 201);
    assert.equal((await publicConfig((await r.json()).chatbot._id)).config.chatWindow.botName, "Nuform Social Assistant", template);
  }

  // A chatbot that predates the starter keeps the neutral look.
  const { chatbots } = await seedTenant({ companyId: "old", chatbots: [{ name: "Old Bot" }] });
  const old = (await publicConfig(chatbots[0]._id)).config;
  assert.equal(old.chatWindow.botName, "");
  assert.equal(old.launcher.logoOnly, false);
  assert.equal(old.chatWindow.headerHeight, null);
  assert.deepEqual(old.ctas, []);
});

test("starter keys all exist in the defaults (a typo would be silently dropped)", async () => {
  const { STARTER_PATCH } = await import("../config/chatbotStarter.js");
  const { DEFAULT_CHATBOT_CONFIG } = await import("../config/chatbotConfig.js");
  const missing = (patch, base, pre = "") =>
    Object.keys(patch).flatMap((k) => {
      if (!(k in base)) return [pre + k];
      const v = patch[k];
      return v && typeof v === "object" && !Array.isArray(v) ? missing(v, base[k], `${pre}${k}.`) : [];
    });
  assert.deepEqual(missing(STARTER_PATCH, DEFAULT_CHATBOT_CONFIG), []);
});

test("new look options validate: enums, hex, per-CTA colour, bubble timing", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const ok = await saveConfig(id, {
    launcher: { bubbleEffect: "typing", bubbleOrder: "random", bubbleAvatar: true, bubbleTail: true, bubbleHoldSeconds: 6, bubblePauseSeconds: 12, logoOnly: true, badgePulse: true, animation: "float-ripple" },
    chatWindow: { avatarShape: "rounded", statusStyle: "inline", statusDotColor: "#8DFFB3", bubbleStyle: "classic", typingStyle: "colorful", sendButtonShape: "circle", brandName: "Acme", brandUrl: "acme.test", brandColor: "#E36B0A", welcomeMessageHindi: "नमस्ते", footerBackground: "#FFFFFF", messageAvatarSize: 32, lineHeight: 26, welcomeMaxWidthPct: 100, inputRadius: 18 },
    behavior: { attachments: true, voiceInput: true, textToSpeech: true, askEmail: true },
    ctas: [{ type: "call", enabled: true, label: "Call", value: "+1", color: "#067647" }],
  });
  assert.equal(ok.status, 200, await ok.clone().text());
  const { config } = await publicConfig(id);
  assert.equal(config.ctas[0].color, "#067647");
  assert.equal(config.chatWindow.welcomeMessageHindi, "नमस्ते");
  assert.equal(config.launcher.bubbleHoldSeconds, 6);

  assert.equal((await saveConfig(id, { launcher: { bubbleEffect: "confetti" } })).status, 400);
  assert.equal((await saveConfig(id, { launcher: { bubbleHoldSeconds: 99 } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { avatarShape: "star" } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { bubbleStyle: "wavy" } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { statusDotColor: "green" } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { lineHeight: 5 } })).status, 400);
  assert.equal((await saveConfig(id, { ctas: [{ type: "call", enabled: true, label: "Call", value: "+1", color: "red" }] })).status, 400);
});

test("show/hide switches and editable wording: default on / built-in, save, validate, reach the public config", async () => {
  const { chatbots } = await seedTenant({ companyId: "acme", chatbots: [{ name: "Bot" }] });
  const id = chatbots[0]._id;
  const switches = ["showClearButton", "showLanguageSelector", "showCloseButton", "showHeaderAvatar", "showWelcome", "showSuggestions", "showCtas", "showScrollButton"];
  const texts = ["listenLabel", "stopLabel", "retryLabel", "latestLabel", "errorMessage", "offlineMessage", "emailPrompt", "emailThanks", "noInternetMessage", "listeningPlaceholder", "formTitle", "formSubtitle", "formButtonLabel"];

  const fresh = (await publicConfig(id)).config.chatWindow;
  for (const k of switches) assert.equal(fresh[k], true, `${k} defaults to on`);
  for (const k of texts) assert.equal(fresh[k], "", `${k} defaults to the built-in wording`);

  const patch = Object.fromEntries([...switches.map((k) => [k, false]), ...texts.map((k) => [k, `Custom ${k}`.slice(0, 30)])]);
  const res = await saveConfig(id, { chatWindow: patch });
  assert.equal(res.status, 200, await res.clone().text());
  const saved = (await publicConfig(id)).config.chatWindow;
  for (const k of switches) assert.equal(saved[k], false, k);
  assert.equal(saved.listenLabel, "Custom listenLabel");

  // too long / wrong type
  assert.equal((await saveConfig(id, { chatWindow: { errorMessage: "x".repeat(161) } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { listenLabel: "x".repeat(31) } })).status, 400);
  assert.equal((await saveConfig(id, { chatWindow: { formButtonLabel: "x".repeat(41) } })).status, 400);
  // clearing a text returns to the built-in wording
  assert.equal((await saveConfig(id, { chatWindow: { listenLabel: "" } })).status, 200);
  assert.equal((await publicConfig(id)).config.chatWindow.listenLabel, "");
});
