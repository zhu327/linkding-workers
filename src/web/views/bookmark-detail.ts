import { esc } from "./layout.js";
import { safeHref } from "../../utils/html.js";
import type { BookmarkRow, UserProfileRow } from "../../db/schema.js";
import { renderMarkdown } from "../../utils/markdown.js";
import { deriveFaviconUrl } from "../../services/favicon.js";
import { formatDate } from "./render-helpers.js";

interface DetailOpts {
  bookmark: BookmarkRow;
  tagNames: string[];
  profile: UserProfileRow;
  anonymous?: boolean;
}

function buildDetailContent(row: BookmarkRow, tagNames: string[], profile: UserProfileRow, anonymous: boolean): {
  title: string;
  favicon: string;
  tagsHtml: string;
  descHtml: string;
  notesHtml: string;
  statusSection: string;
  footerActions: string;
} {
  const title = row.title || row.url;
  const showFavicons = !!profile.enable_favicons;
  const favicon = showFavicons ? (row.favicon_url || deriveFaviconUrl(row.url)) : "";
  const sharing = !!profile.enable_sharing;
  const tagsHtml = tagNames.length
    ? `<section class="tags col-1"><h3 id="details-modal-tags-title">Tags</h3><div>${tagNames.map((t) => `<a href="/bookmarks?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join(" ")}</div></section>`
    : "";
  const descHtml = row.description ? `<section class="description col-2"><h3>Description</h3><div>${esc(row.description)}</div></section>` : "";
  const notesHtml = row.notes ? `<section class="notes col-2"><h3>Notes</h3><div class="markdown">${renderMarkdown(row.notes)}</div></section>` : "";

  const editBtn = anonymous ? "" : `<a class="btn btn-wide" href="/bookmarks/${row.id}/edit">Edit</a>`;
  const statusSection = anonymous ? "" : `<section class="status col-2">
          <h3>Status</h3>
          <div class="d-flex" style="gap:.8rem">
            <div class="form-group"><label class="form-checkbox"><input type="checkbox" disabled${row.is_archived ? " checked" : ""}><i class="form-icon"></i> Archived</label></div>
            <div class="form-group"><label class="form-checkbox"><input type="checkbox" disabled${row.unread ? " checked" : ""}><i class="form-icon"></i> Unread</label></div>
            ${sharing ? `<div class="form-group"><label class="form-checkbox"><input type="checkbox" disabled${row.shared ? " checked" : ""}><i class="form-icon"></i> Shared</label></div>` : ""}
          </div>
        </section>`;
  const footerActions = anonymous ? "" : `<div class="modal-footer"><div class="actions">
    <div class="left-actions">${editBtn}</div>
    <div class="right-actions">
      <form action="/bookmarks/bulk" method="post">
        <button data-confirm data-confirm-question="Delete this bookmark?" class="btn btn-error btn-wide" type="submit" name="remove" value="${row.id}">Delete</button>
      </form>
    </div>
  </div></div>`;

  return { title, favicon, tagsHtml, descHtml, notesHtml, statusSection, footerActions };
}

/** Render bookmark detail as a full page (wrapped in layout) */
export function bookmarkDetailPage(opts: DetailOpts): string {
  const { bookmark: row, tagNames, profile, anonymous = false } = opts;
  const { title, favicon, tagsHtml, descHtml, notesHtml, statusSection, footerActions } = buildDetailContent(row, tagNames, profile, anonymous);

  return `<div class="bookmark-details">
  <div class="modal-container" role="dialog">
    <div class="modal-header">
      <h2 class="title">${esc(title)}</h2>
    </div>
    <div class="modal-body">
      <div class="weblinks">
        <a class="weblink" href="${safeHref(row.url)}" rel="noopener" target="_blank">
          ${favicon ? `<img class="favicon" src="${esc(favicon)}" alt="">` : ""}
          <span>${esc(row.url)}</span>
        </a>
      </div>
      <div class="sections grid columns-2 columns-sm-1 gap-0">
        ${statusSection}
        ${tagsHtml}
        <section class="date-added col-1"><h3>Date added</h3><div><span>${formatDate(row.date_added)}</span></div></section>
        ${descHtml}
        ${notesHtml}
      </div>
    </div>
    ${footerActions}
  </div>
</div>`;
}

/** Render bookmark detail as a modal (for injection into .modals container) */
export function bookmarkDetailModal(opts: DetailOpts): string {
  const { bookmark: row, tagNames, profile, anonymous = false } = opts;
  const { title, favicon, tagsHtml, descHtml, notesHtml, statusSection, footerActions } = buildDetailContent(row, tagNames, profile, anonymous);

  return `<div class="modal active bookmark-details" data-modal-id="${row.id}" data-bookmark-id="${row.id}" role="dialog" aria-modal="true" aria-labelledby="modal-title-${row.id}">
  <div class="modal-overlay" data-close-modal></div>
  <div class="modal-container">
    <div class="modal-header">
      <h2 class="title" id="modal-title-${row.id}">${esc(title)}</h2>
      <button class="btn btn-clear" data-close-modal aria-label="Close"></button>
    </div>
    <div class="modal-body">
      <div class="weblinks">
        <a class="weblink" href="${safeHref(row.url)}" rel="noopener" target="_blank">
          ${favicon ? `<img class="favicon" src="${esc(favicon)}" alt="">` : ""}
          <span>${esc(row.url)}</span>
        </a>
      </div>
      <div class="sections grid columns-2 columns-sm-1 gap-0">
        ${statusSection}
        ${tagsHtml}
        <section class="date-added col-1"><h3>Date added</h3><div><span>${formatDate(row.date_added)}</span></div></section>
        ${descHtml}
        ${notesHtml}
      </div>
    </div>
    ${footerActions}
  </div>
</div>`;
}
