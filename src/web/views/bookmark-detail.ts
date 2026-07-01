import { esc } from "./layout.js";
import { safeHref } from "../../utils/html.js";
import type { BookmarkRow, UserProfileRow } from "../../db/schema.js";
import { renderMarkdown } from "../../utils/markdown.js";
import { deriveFaviconUrl } from "../../services/favicon.js";
import { formatDate, unreadBadge, sharedBadge } from "./render-helpers.js";

export function bookmarkDetailPage(opts: {
  bookmark: BookmarkRow;
  tagNames: string[];
  profile: UserProfileRow;
  anonymous?: boolean;
}): string {
  const { bookmark: row, tagNames, anonymous } = opts;
  const title = row.title || row.url;
  const favicon = row.favicon_url || deriveFaviconUrl(row.url);
  const tags = tagNames.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ");
  const unreadBadgeHtml = unreadBadge(row.unread);
  const sharedBadgeHtml = sharedBadge(row.shared);
  const archiveStatus = row.is_archived ? "Archived" : "Active";

  const notesHtml = row.notes ? `<div class="card" style="margin-top:1rem">${renderMarkdown(row.notes)}</div>` : "";

  const actions = anonymous ? "" : `<div class="actions" style="margin-top:1rem">
    <a href="/bookmarks/${row.id}/edit" class="btn btn-sm">Edit</a>
    <form method="POST" action="/bookmarks/${row.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')">
      <button type="submit" class="btn btn-sm btn-danger">Delete</button>
    </form>
    <form method="POST" action="/bookmarks/${row.id}${row.is_archived ? "/unarchive" : "/archive"}" style="display:inline">
      <button type="submit" class="btn btn-sm">${row.is_archived ? "Unarchive" : "Archive"}</button>
    </form>
  </div>`;

  return `<div style="margin-bottom:1rem"><a href="/bookmarks">&larr; Back to list</a></div>
<div class="card">
  <h1>${favicon ? `<img src="${esc(favicon)}" width="20" height="20" style="vertical-align:middle;margin-right:6px" alt="">` : ""}${esc(title)}${unreadBadgeHtml}${sharedBadgeHtml}</h1>
  <div class="bookmark-url" style="margin:.5rem 0"><a href="${safeHref(row.url)}" target="_blank" rel="noopener">${esc(row.url)}</a></div>
  ${row.description ? `<p style="margin:.5rem 0;color:var(--muted)">${esc(row.description)}</p>` : ""}
  <div class="bookmark-meta" style="margin-top:.75rem">
    <span>Added: ${formatDate(row.date_added)}</span>
    <span>Modified: ${formatDate(row.date_modified)}</span>
    <span>Status: ${archiveStatus}</span>
  </div>
  ${tags ? `<div style="margin-top:.5rem">${tags}</div>` : ""}
  ${actions}
</div>
${notesHtml}`;
}
