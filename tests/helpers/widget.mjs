// Small request helpers for public widget endpoints.
export async function getWidgetToken(baseUrl, chatbotId, origin) {
  const res = await fetch(`${baseUrl}/api/widget/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ chatbotId: String(chatbotId) }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`no token: ${res.status} ${JSON.stringify(body)}`);
  return body.token;
}

export function publicCall(baseUrl, method, path, { token, companyId, origin, body, ip } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-widget-token": token } : {}),
      ...(companyId ? { "x-company-id": companyId } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(ip ? { "X-Forwarded-For": ip } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
