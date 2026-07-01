/**
 * Wayback URL generation — port of linkding's generate_fallback_webarchive_url.
 */

export function generateFallbackWebarchiveUrl(url: string, timestampIso: string | null): string | null {
  if (!url) return null;
  const ts = timestampIso ? new Date(timestampIso) : new Date();
  const formatted = ts.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `https://web.archive.org/web/${formatted}/${url}`;
}
