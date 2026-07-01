import { esc } from "./layout.js";
import { safeHref } from "../../utils/html.js";
import type { BookmarkRow, UserProfileRow, TagRow } from "../../db/schema.js";
import { deriveFaviconUrl } from "../../services/favicon.js";
import { bulkActionBar } from "./bulk-actions.js";
import { renderMarkdown } from "../../utils/markdown.js";
import { formatDate, unreadBadge, sharedBadge } from "./render-helpers.js";

interface BookmarkViewModel {
  row: BookmarkRow;
  tagNames: string[];
}

function bookmarkCard(bm: BookmarkViewModel, profile: UserProfileRow, anonymous?: boolean): { card: string; forms: string } {
  const { row, tagNames } = bm;
  const title = row.title || row.url;
  const favicon = row.favicon_url || deriveFaviconUrl(row.url);
  const tags = tagNames.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ");
  const unreadBadgeHtml = unreadBadge(row.unread);
  const sharedBadgeHtml = sharedBadge(row.shared);

  const deleteFormId = `card-delete-${row.id}`;
  const archiveFormId = `card-archive-${row.id}`;
  const archiveAction = row.is_archived ? "/unarchive" : "/archive";
  const archiveLabel = row.is_archived ? "Unarchive" : "Archive";

  const checkbox = anonymous ? "" : `<label style="margin-right:.5rem;cursor:pointer"><input type="checkbox" name="bookmark_id" value="${row.id}" form="bulk-action-form"></label>`;
  const actions = anonymous ? "" : `<div class="actions">
    <a href="/bookmarks/${row.id}/edit" class="btn btn-sm">Edit</a>
    <button type="submit" form="${deleteFormId}" class="btn btn-sm btn-danger">Delete</button>
    <button type="submit" form="${archiveFormId}" class="btn btn-sm">${archiveLabel}</button>
  </div>`;

  const card = `<li class="bookmark-item">
  ${checkbox}
  <div class="bookmark-title"><a href="${safeHref(row.url)}" target="_blank" rel="noopener">${favicon ? `<img src="${esc(favicon)}" width="16" height="16" style="vertical-align:middle;margin-right:4px" alt="">` : ""}${esc(title)}</a>${unreadBadgeHtml}${sharedBadgeHtml}</div>
  <div class="bookmark-url">${esc(row.url)}</div>
  ${row.description ? `<div style="margin-top:.25rem;font-size:.9rem">${esc(row.description).slice(0, 300)}</div>` : ""}
  ${row.notes ? `<div style="margin-top:.25rem;font-size:.9rem">${renderMarkdown(row.notes.slice(0, 300))}</div>` : ""}
  <div class="bookmark-meta"><span>${formatDate(row.date_added)}</span>${tags ? `<span>${tags}</span>` : ""}</div>
  ${actions}
</li>`;

  const forms = anonymous ? "" : `<form id="${deleteFormId}" method="POST" action="/bookmarks/${row.id}/delete" style="display:none" onsubmit="return confirm('Delete?')"></form>` +
    `<form id="${archiveFormId}" method="POST" action="/bookmarks/${row.id}${archiveAction}" style="display:none"></form>`;

  return { card, forms };
}

export function bookmarksListPage(opts: {
  bookmarks: BookmarkViewModel[];
  count: number;
  q: string;
  sort: string;
  offset: number;
  limit: number;
  allTags: TagRow[];
  selectedTag: string;
  unread: string;
  shared: string;
  profile: UserProfileRow;
  page: string; // "bookmarks" | "archived" | "shared"
  anonymous?: boolean;
}): string {
  const { bookmarks, count, q, sort, offset, limit, allTags, selectedTag, unread, shared, profile, page } = opts;
  const basePath = page === "archived" ? "/bookmarks/archived" : page === "shared" ? "/bookmarks/shared" : "/bookmarks";
  const title = page === "archived" ? "Archived Bookmarks" : page === "shared" ? "Shared Bookmarks" : "Bookmarks";

  const tagOptions = allTags.map((t) => `<option value="${esc(t.name)}"${t.name === selectedTag ? " selected" : ""}>${esc(t.name)}</option>`).join("");
  const sortOptions = [
    ["added_desc", "Newest"], ["added_asc", "Oldest"], ["title_asc", "Title A-Z"], ["title_desc", "Title Z-A"],
  ].map(([v, l]) => `<option value="${v}"${sort === v ? " selected" : ""}>${l}</option>`).join("");

  const cardResults = bookmarks.map((bm) => bookmarkCard(bm, profile, opts.anonymous));
  const items = cardResults.map((r) => r.card).join("");
  const cardForms = cardResults.map((r) => r.forms).join("");
  const totalPages = Math.ceil(count / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  let paginationHtml = "";
  if (totalPages > 1) {
    const params = new URLSearchParams({ q, sort, tag: selectedTag, unread, shared, limit: String(limit) });
    const pageLinks: string[] = [];
    if (currentPage > 1) { params.set("offset", String((currentPage - 2) * limit)); pageLinks.push(`<a href="${basePath}?${params}" class="btn btn-sm">&laquo; Prev</a>`); }
    pageLinks.push(`<span style="padding:.2rem .6rem">Page ${currentPage} of ${totalPages} (${count} total)</span>`);
    if (currentPage < totalPages) { params.set("offset", String(currentPage * limit)); pageLinks.push(`<a href="${basePath}?${params}" class="btn btn-sm">Next &raquo;</a>`); }
    paginationHtml = `<div class="pagination">${pageLinks.join("")}</div>`;
  }

  const bulkBar = !opts.anonymous ? bulkActionBar() : "";

  return `<h1>${esc(title)}</h1>
<form method="GET" action="${basePath}" class="search-bar">
  <input type="text" name="q" value="${esc(q)}" placeholder="Search bookmarks..." class="form-control">
  <select name="sort">${sortOptions}</select>
  <select name="tag"><option value="">All tags</option>${tagOptions}</select>
  <select name="unread"><option value="">All</option><option value="yes"${unread === "yes" ? " selected" : ""}>Unread</option><option value="no"${unread === "no" ? " selected" : ""}>Read</option></select>
  <button type="submit" class="btn btn-primary">Search</button>
  ${opts.anonymous ? "" : '<a href="/bookmarks/new" class="btn btn-primary">+ New</a>'}
</form>
${count === 0 ? '<p style="color:var(--muted);text-align:center;padding:2rem">No bookmarks found.</p>' : `<ul class="bookmark-list">${items}</ul>
${bulkBar}`}
${cardForms}
${paginationHtml}`;
}
