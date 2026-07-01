/**
 * URL normalization — port of linkding's normalize_url.
 */

export function normalizeUrl(url: string): string {
  if (!url || typeof url !== "string") return "";
  url = url.trim();
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol.replace(":", "").toLowerCase();
    let netloc = parsed.hostname.toLowerCase();
    if (parsed.port) netloc += `:${parsed.port}`;
    if (parsed.username) {
      const auth = parsed.password ? `${parsed.username}:${parsed.password}` : parsed.username;
      netloc = `${auth}@${netloc}`;
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    const params = parsed.searchParams;
    const sortedParams = new URLSearchParams([...params.entries()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])));
    const query = sortedParams.toString();
    const fragment = parsed.hash ? parsed.hash.slice(1) : "";

    let result = `${scheme}://${netloc}${path}`;
    if (query) result += `?${query}`;
    if (fragment) result += `#${fragment}`;
    return result;
  } catch {
    return url;
  }
}
