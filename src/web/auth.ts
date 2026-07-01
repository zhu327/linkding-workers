/**
 * Session cookie auth for the Web UI.
 * Signs/verifies HMAC-SHA256 session tokens stored in a cookie.
 */
import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";

const COOKIE_NAME = "ld_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

function parseCookie(header: string, name: string): string | undefined {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Constant-time string comparison to prevent timing attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function createSession(env: Env): Promise<string> {
  const payload = JSON.stringify({ t: Math.floor(Date.now() / 1000) });
  const encoded = btoa(payload);
  const sig = await hmacSign(env.SESSION_SECRET || "default-secret", encoded);
  return `${encoded}.${sig}`;
}

export async function verifySession(env: Env, cookie: string): Promise<boolean> {
  const parts = cookie.split(".");
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  const expected = await hmacSign(env.SESSION_SECRET || "default-secret", encoded);
  if (!constantTimeEqual(sig, expected)) return false;
  try {
    const payload = JSON.parse(atob(encoded));
    const age = Math.floor(Date.now() / 1000) - payload.t;
    return age >= 0 && age < SESSION_TTL;
  } catch {
    return false;
  }
}

export const webAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const cookie = parseCookie(c.req.header("Cookie") || "", COOKIE_NAME);
  if (!cookie || !(await verifySession(c.env, cookie))) {
    return c.redirect("/login", 302);
  }
  await next();
};

export function setSessionCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { COOKIE_NAME };
