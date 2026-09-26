// ======================================================
// PROVIDER REGISTRY (Phase 10)
// The single source of truth for what the Channels + Integrations
// UI is allowed to claim about each provider. `implemented: true`
// means real backend code exists (adapter/connect/test) — it does
// NOT mean credentials are configured; that's `status` on the
// per-chatbot/company connection record. A provider with
// `implemented: false` is never clickable as a real feature — the
// frontend renders it as "Coming soon" and nothing else.
// ======================================================

export const CHANNEL_PROVIDERS = [
  { key: "website", label: "Website", scope: "CHATBOT", implemented: true },
  { key: "telegram", label: "Telegram", scope: "CHATBOT", implemented: true },
  { key: "whatsapp", label: "WhatsApp", scope: "CHATBOT", implemented: false },
  { key: "instagram", label: "Instagram", scope: "CHATBOT", implemented: false },
  { key: "messenger", label: "Facebook Messenger", scope: "CHATBOT", implemented: false },
];

export const INTEGRATION_PROVIDERS = [
  { key: "webhook", label: "Webhook", scope: "COMPANY", implemented: true },
  { key: "crm", label: "CRM", scope: "COMPANY", implemented: false },
  { key: "email", label: "Email", scope: "COMPANY", implemented: false },
  { key: "slack", label: "Slack", scope: "COMPANY", implemented: false },
  { key: "teams", label: "Microsoft Teams", scope: "COMPANY", implemented: false },
  { key: "automation", label: "Automation", scope: "COMPANY", implemented: false },
];
