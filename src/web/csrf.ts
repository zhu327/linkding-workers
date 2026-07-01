/**
 * CSRF protection via HMAC-signed tokens.
 * Token = base64(timestamp).HMAC-SHA256(secret, base64(timestamp))
 */

const CSRF_COOKIE_NAME = "ld_csrf";

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function issueCsrf(secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ t: Math.floor(Date.now() / 1000) }));
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifyCsrf(secret: string, token: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  const expected = await hmacSign(secret, encoded);
  if (!constantTimeEqual(sig, expected)) return false;
  try {
    const payload = JSON.parse(atob(encoded));
    const age = Math.floor(Date.now() / 1000) - payload.t;
    return age >= 0 && age < 86400; // 24h TTL
  } catch {
    return false;
  }
}

export { CSRF_COOKIE_NAME };
