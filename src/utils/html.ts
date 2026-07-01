export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ftp:"]);

/**
 * Returns true if the URL has a safe scheme (http, https, ftp).
 * Returns false for javascript:, data:, vbscript:, file:, malformed URLs, etc.
 */
export function isAllowedScheme(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Returns url unchanged if its scheme is http/https/ftp; returns "" otherwise.
 * An empty href is inert (non-clickable), providing defense-in-depth against stored XSS.
 */
export function safeHref(url: string): string {
  return isAllowedScheme(url) ? url : "";
}
