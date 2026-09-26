import dns from "dns/promises";
import net from "net";

// ======================================================
// FLOW WEBHOOK SECURITY (Phase 6)
// The one node type that makes an outbound request to an
// admin-supplied URL, so it gets its own SSRF-hardening module
// rather than living inline in the executor.
// ======================================================

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

// IPv4 ranges that must never be reachable from a webhook node:
// loopback, RFC1918 private space, link-local (also covers the
// 169.254.169.254 cloud metadata endpoint), and CGNAT space.
function isBlockedIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // malformed -> reject

  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isBlockedIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped address — check the embedded IPv4 too.
    const mapped = normalized.split(":").pop();
    if (net.isIPv4(mapped) && isBlockedIPv4(mapped)) return true;
  }
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  return false;
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // unrecognized format -> reject
}

/**
 * Resolves the URL's hostname and rejects it if either the literal
 * hostname or ANY of its resolved IPs land in a blocked range. DNS
 * resolution (not just a string check on the URL) is required so a
 * public-looking hostname that resolves to an internal IP (DNS
 * rebinding) is still caught.
 */
export async function assertSafeWebhookUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("This destination is not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("This destination is not allowed.");
    }
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Could not resolve this URL's hostname.");
  }

  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error("This destination is not allowed.");
  }
}

export const WEBHOOK_MAX_RESPONSE_BYTES = 100 * 1024; // 100KB
export const WEBHOOK_DEFAULT_TIMEOUT_MS = 5000;
