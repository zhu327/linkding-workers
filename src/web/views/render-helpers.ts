/**
 * Shared rendering helpers for bookmark views.
 */

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function formatRelativeDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];

  for (const [unit, seconds] of units) {
    if (absSeconds >= seconds) {
      return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return "just now";
}

export function formatBookmarkDate(iso: string, display: string): string {
  if (display === "hidden") return "";
  if (display === "relative") return formatRelativeDate(iso);
  return formatDate(iso);
}
