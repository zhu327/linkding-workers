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

export function unreadBadge(unread: boolean | number): string {
  return unread ? ' <span class="tag" style="background:var(--accent);color:#fff">unread</span>' : "";
}

export function sharedBadge(shared: boolean | number): string {
  return shared ? ' <span class="tag" style="background:var(--success);color:#fff">shared</span>' : "";
}
