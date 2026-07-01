/**
 * Password verification for single-user web auth.
 * Uses PBKDF2-SHA256 via Web Crypto.
 * Hash format: "pbkdf2$<iterations>$<salt_hex>$<hash_hex>"
 * If APP_PASSWORD_HASH is empty or a simple string, falls back to plain comparison.
 */

export async function verifyPassword(env: { APP_PASSWORD_HASH: string }, password: string): Promise<boolean> {
  const stored = env.APP_PASSWORD_HASH;
  if (!stored) return false;

  // Check for PBKDF2 format
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const salt = hexToBytes(parts[2]);
    const expectedHash = parts[3];

    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
    return bytesToHex(new Uint8Array(derived)) === expectedHash;
  }

  // Fallback: plain SHA-256 hash comparison
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return bytesToHex(new Uint8Array(hash)) === stored;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `pbkdf2$100000$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derived))}`;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
