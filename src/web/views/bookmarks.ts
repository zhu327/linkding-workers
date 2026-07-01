import { esc } from "./layout.js";
import { svgIcon } from "./layout.js";
import { safeHref } from "../../utils/html.js";
import type { BookmarkRow, UserProfileRow, TagRow, BundleRow } from "../../db/schema.js";
import { deriveFaviconUrl } from "../../services/favicon.js";
import { bulkEditBar } from "./bulk-actions.js";
import { renderMarkdown } from "../../utils/markdown.js";
import { formatDate } from "./render-helpers.js";

interface BookmarkViewModel {
  row: BookmarkRow;
  tagNames: string[];
}

function tagLink(basePath: string, name: string): string {
  return `<a href="${basePath}?tag=${encodeURIComponent(name)}">#${esc(name)}</a>`;
}

function bookmarkItem(bm: BookmarkViewModel, profile: UserProfileRow, basePath: string, anonymous?: boolean): string {
  const { row, tagNames } = bm;
  const title = row.title || row.url;
  const showFavicons = !!profile.enable_favicons;
  const favicon = showFavicons ? (row.favicon_url || deriveFaviconUrl(row.url)) : "";
  const classes = [row.unread ? "unread" : "", row.shared ? "shared" : ""].filter(Boolean).join(" ");
  const tagsHtml = tagNames.length
    ? `<div class="tags">${tagNames.map((t) => tagLink(basePath, t)).join("")}</div>`
    : "";
  const descHtml = row.description ? `<div class="description separate">${esc(row.description)}</div>` : "";
  const notesHtml = row.notes ? `<div class="notes"><div class="markdown">${renderMarkdown(row.notes)}</div></div>` : "";

  const checkbox = anonymous ? "" :
    `<label class="form-checkbox bulk-edit-checkbox"><input type="checkbox" name="bookmark_id" value="${row.id}"><i class="form-icon"></i></label>`;

  let actions = "";
  if (!anonymous) {
    const archiveBtn = row.is_archived
      ? `<button type="submit" name="unarchive" value="${row.id}" class="btn btn-link btn-sm">Unarchive</button>`
      : `<button type="submit" name="archive" value="${row.id}" class="btn btn-link btn-sm">Archive</button>`;
    const extra: string[] = [];
    if (row.unread) {
      extra.push(`<button type="submit" name="mark_as_read" value="${row.id}" class="btn btn-link btn-sm btn-icon" data-confirm data-confirm-question="Mark as read?">${svgIcon("unread", 16)} Unread</button>`);
    }
    if (row.shared) {
      extra.push(`<button type="submit" name="unshare" value="${row.id}" class="btn btn-link btn-sm btn-icon" data-confirm data-confirm-question="Unshare?">${svgIcon("share", 16)} Shared</button>`);
    }
    if (row.notes) {
      extra.push(`<button type="button" class="btn btn-link btn-sm btn-icon toggle-notes">${svgIcon("note", 16)} Notes</button>`);
    }
    actions = `<div class="actions">
      <span>${formatDate(row.date_added)}</span><span>|</span>
      <a href="/bookmarks/${row.id}?modal=1" class="view-action" data-modal-trigger data-bookmark-id="${row.id}">View</a>
      <a href="/bookmarks/${row.id}/edit">Edit</a>
      ${archiveBtn}
      <button data-confirm type="submit" name="remove" value="${row.id}" class="btn btn-link btn-sm">Remove</button>
      ${extra.length ? `<div class="extra-actions"><span class="hide-sm">|</span>${extra.join("")}</div>` : ""}
    </div>`;
  } else {
    actions = `<div class="actions"><span>${formatDate(row.date_added)}</span></div>`;
  }

  return `<li data-bookmark-id="${row.id}" role="listitem"${classes ? ` class="${classes}"` : ""}>
  <div class="content">
    <div class="title">
      ${checkbox}
      ${favicon ? `<img class="favicon" src="${esc(favicon)}" alt="">` : ""}
      <a href="${safeHref(row.url)}" target="_blank" rel="noopener"><span>${esc(title)}</span></a>
    </div>
    <div class="url-path truncate"><a href="${safeHref(row.url)}" target="_blank" rel="noopener" class="url-display">${esc(row.url)}</a></div>
    ${descHtml}
    ${tagsHtml}
    ${notesHtml}
    ${actions}
  </div>
</li>`;
}

function pagination(basePath: string, params: Record<string, string>, count: number, offset: number, limit: number): string {
  const totalPages = Math.max(Math.ceil(count / limit), 1);
  const current = Math.floor(offset / limit) + 1;
  if (totalPages <= 1) return "";

  const link = (page: number) => {
    const p = { ...params, offset: String((page - 1) * limit) };
    const qs = new URLSearchParams(p).toString();
    return `${basePath}?${qs}`;
  };

  // Build page numbers with ellipsis window.
  const nums: (number | null)[] = [];
  const window = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= current - window && p <= current + window)) {
      nums.push(p);
    } else if (nums[nums.length - 1] !== null) {
      nums.push(null); // ellipsis
    }
  }

  const items: string[] = [];
  items.push(current <= 1
    ? `<li class="page-item disabled"><a href="#" tabindex="-1">Previous</a></li>`
    : `<li class="page-item"><a href="${link(current - 1)}" tabindex="-1">Previous</a></li>`);
  for (const n of nums) {
    if (n === null) {
      items.push(`<li class="page-item"><span>...</span></li>`);
    } else {
      items.push(`<li class="page-item${n === current ? " active" : ""}"><a href="${link(n)}">${n}</a></li>`);
    }
  }
  items.push(current >= totalPages
    ? `<li class="page-item disabled"><a href="#" tabindex="-1">Next</a></li>`
    : `<li class="page-item"><a href="${link(current + 1)}" tabindex="-1">Next</a></li>`);

  return `<div class="bookmark-pagination"><ul class="pagination">${items.join("")}</ul></div>`;
}

function searchContainer(basePath: string, q: string, sort: string, unread: string, shared: string, selectedTag: string, bundle: string): string {
  const hidden = (name: string, val: string) => val ? `<input type="hidden" name="${name}" value="${esc(val)}">` : "";
  const preserve = `${hidden("sort", sort)}${hidden("unread", unread)}${hidden("shared", shared)}${hidden("tag", selectedTag)}${hidden("bundle", bundle)}`;

  const sortOptions = [
    ["added_desc", "Newest first"], ["added_asc", "Oldest first"],
    ["title_asc", "Title A-Z"], ["title_desc", "Title Z-A"],
  ].map(([v, l]) => `<option value="${v}"${sort === v ? " selected" : ""}>${l}</option>`).join("");

  const radio = (name: string, current: string, opts: [string, string][]) =>
    opts.map(([v, l]) => `<label class="form-radio form-inline"><input type="radio" name="${name}" value="${v}"${current === v ? " checked" : ""}><i class="form-icon"></i>${l}</label>`).join("");

  return `<div class="search-container">
  <form id="search" action="${basePath}" method="get" role="search">
    <input type="search" name="q" value="${esc(q)}" placeholder="Search for words or #tags" class="form-input" autocomplete="off">
    <input type="submit" value="Search" class="d-none">
    ${preserve}
  </form>
  <div class="dropdown search-options dropdown-right">
    <button type="button" aria-label="Search preferences" class="btn dropdown-toggle">${svgIcon("preferences", 20)}</button>
    <div class="menu" tabindex="0">
      <form action="${basePath}" method="get">
        <div class="form-group">
          <label class="form-label">Sort by</label>
          <select name="sort" class="form-select select-sm">${sortOptions}</select>
        </div>
        <div class="form-group radio-group" role="radiogroup">
          <label class="form-label">Unread filter</label>
          ${radio("unread", unread, [["", "All"], ["yes", "Unread"], ["no", "Read"]])}
        </div>
        <div class="form-group radio-group" role="radiogroup">
          <label class="form-label">Shared filter</label>
          ${radio("shared", shared, [["", "All"], ["yes", "Shared"], ["no", "Private"]])}
        </div>
        <div class="actions">
          <button type="submit" class="btn btn-sm btn-primary">Apply</button>
        </div>
        <input type="hidden" name="q" value="${esc(q)}">
        <input type="hidden" name="tag" value="${esc(selectedTag)}">
        <input type="hidden" name="bundle" value="${esc(bundle)}">
      </form>
    </div>
  </div>
</div>`;
}

function bundleSection(bundles: BundleRow[], selectedBundleId: number, basePath: string, q: string): string {
  if (!bundles.length) return "";
  const items = bundles.map((b) =>
    `<li class="bundle-menu-item${b.id === selectedBundleId ? " selected" : ""}"><a href="${basePath}?bundle=${b.id}">${esc(b.name)}</a></li>`).join("");
  const createFromSearch = q ? `<li class="menu-item"><a href="/bundles?q=${encodeURIComponent(q)}#bundle-form" class="menu-link">Create bundle from search</a></li>` : "";
  return `<section aria-labelledby="bundles-heading">
  <div class="section-header no-wrap">
    <h2 id="bundles-heading">Bundles</h2>
    <div class="dropdown dropdown-right ml-auto">
      <button class="btn btn-noborder dropdown-toggle" aria-label="Bundles menu">${svgIcon("menu", 20)}</button>
      <ul class="menu" role="list" tabindex="-1">
        <li class="menu-item"><a href="/bundles" class="menu-link">Manage bundles</a></li>
        ${createFromSearch}
      </ul>
    </div>
  </div>
  <ul class="bundle-menu">${items}</ul>
</section>`;
}

function tagSection(allTags: TagRow[], selectedTag: string, basePath: string, authenticated: boolean): string {
  const selected = selectedTag
    ? `<p class="selected-tags"><a href="${basePath}" class="text-bold mr-2"><span>-${esc(selectedTag)}</span></a></p>`
    : "";
  const tags = allTags.length
    ? `<div class="unselected-tags"><p class="group">${allTags.map((t) => `<a href="${basePath}?tag=${encodeURIComponent(t.name)}" class="mr-2"><span>${esc(t.name)}</span></a>`).join("")}</p></div>`
    : `<div class="unselected-tags"><p class="group"></p></div>`;
  const menu = authenticated
    ? `<div class="dropdown dropdown-right ml-auto">
      <button class="btn btn-noborder dropdown-toggle" aria-label="Tags menu">${svgIcon("menu", 20)}</button>
      <ul class="menu" role="list" tabindex="-1">
        <li class="menu-item"><a href="/tags" class="menu-link">Manage tags</a></li>
      </ul>
    </div>`
    : "";
  return `<section aria-labelledby="tags-heading">
  <div class="section-header no-wrap">
    <h2 id="tags-heading">Tags</h2>
    ${menu}
  </div>
  <div id="tag-cloud-container"><div class="tag-cloud">${selected}${tags}</div></div>
</section>`;
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
  page: "bookmarks" | "archived" | "shared";
  anonymous?: boolean;
  bundles: BundleRow[];
  selectedBundleId: number;
}): string {
  const { bookmarks, count, q, sort, offset, limit, allTags, selectedTag, unread, shared, profile, page, bundles, selectedBundleId } = opts;
  const anonymous = opts.anonymous;
  const basePath = page === "archived" ? "/bookmarks/archived" : page === "shared" ? "/bookmarks/shared" : "/bookmarks";
  const title = page === "archived" ? "Archived bookmarks" : page === "shared" ? "Shared bookmarks" : "Bookmarks";
  const filterParams: Record<string, string> = {};
  if (q) filterParams.q = q;
  if (sort) filterParams.sort = sort;
  if (selectedTag) filterParams.tag = selectedTag;
  if (unread) filterParams.unread = unread;
  if (shared) filterParams.shared = shared;
  if (selectedBundleId) filterParams.bundle = String(selectedBundleId);

  const bulkEditEnabled = !anonymous;
  const search = searchContainer(basePath, q, sort, unread, shared, selectedTag, selectedBundleId ? String(selectedBundleId) : "");

  const listHtml = count === 0
    ? `<div class="empty mt-4"><p class="empty-title h5">You have no bookmarks yet</p><p class="empty-subtitle">You can get started by <a href="/bookmarks/new">adding</a> bookmarks or <a href="/settings#import">importing</a> your existing bookmarks.</p></div>`
    : `<section aria-label="Bookmark list"><ul class="bookmark-list" role="list" tabindex="-1">${bookmarks.map((bm) => bookmarkItem(bm, profile, basePath, anonymous)).join("")}</ul>${pagination(basePath, filterParams, count, offset, limit)}</section>`;

  return `<ld-bookmark-page class="bookmarks-page grid columns-md-1"${bulkEditEnabled ? "" : " no-bulk-edit"}>
  <main class="main col-2" aria-labelledby="main-heading">
    <div class="section-header">
      <h1 id="main-heading">${esc(title)}</h1>
      <div class="header-controls">
        ${search}
        ${bulkEditEnabled ? `<button class="btn hide-sm ml-2 bulk-edit-active-toggle" title="Bulk edit">${svgIcon("bulk-edit", 20)}</button>` : ""}
        <ld-filter-drawer-trigger><button class="btn ml-2" type="button">Filters</button></ld-filter-drawer-trigger>
      </div>
    </div>
    <form class="bookmark-actions" action="/bookmarks/bulk" method="post" autocomplete="off">
      ${bulkEditEnabled ? bulkEditBar(profile, count) : ""}
      <div id="bookmark-list-container">${listHtml}</div>
    </form>
  </main>
  <div class="side-panel col-1 hide-md">
    ${bundleSection(bundles, selectedBundleId, basePath, q)}
    ${tagSection(allTags, selectedTag, basePath, !anonymous)}
  </div>
</ld-bookmark-page>`;
}
