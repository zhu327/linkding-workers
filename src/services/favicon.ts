/**
 * Favicon URL derivation.
 */

export function deriveFaviconUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return "";
  }
}
