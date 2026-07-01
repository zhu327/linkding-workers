import { esc } from "./layout.js";
import type { TagWithCount } from "../../db/repository.js";

export interface TagsPageOpts {
  tags: TagWithCount[];
  search: string;
  sort: string;
  unusedOnly: boolean;
  total: number;
  count: number;
  page: number;
  limit: number;
}

const SORT_OPTIONS: [string, string][] = [
  ["name-asc", "Name A-Z"],
  ["name-desc", "Name Z-A"],
  ["count-asc", "Fewest bookmarks"],
  ["count-desc", "Most bookmarks"],
];

function tagPagination(total: number, page: number, limit: number, params: Record<string, string>): string {
  const totalPages = Math.max(Math.ceil(total / limit), 1);
  if (totalPages <= 1) return "";

  const link = (p: number) => {
    const qs = new URLSearchParams({ ...params, page: String(p) }).toString();
    return `/tags?${qs}`;
  };

  const nums: (number | null)[] = [];
  const window = 1;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window && p <= page + window)) {
      nums.push(p);
    } else if (nums[nums.length - 1] !== null) {
      nums.push(null); // ellipsis
    }
  }

  const items: string[] = [];
  items.push(page <= 1
    ? `<li class="page-item disabled"><a href="#" tabindex="-1">Previous</a></li>`
    : `<li class="page-item"><a href="${link(page - 1)}" tabindex="-1">Previous</a></li>`);
  for (const n of nums) {
    if (n === null) {
      items.push(`<li class="page-item"><span>...</span></li>`);
    } else {
      items.push(`<li class="page-item${n === page ? " active" : ""}"><a href="${link(n)}">${n}</a></li>`);
    }
  }
  items.push(page >= totalPages
    ? `<li class="page-item disabled"><a href="#" tabindex="-1">Next</a></li>`
    : `<li class="page-item"><a href="${link(page + 1)}" tabindex="-1">Next</a></li>`);

  return `<ul class="pagination">${items.join("")}</ul>`;
}

export function tagsPage(opts: TagsPageOpts): string {
  const { tags, search, sort, unusedOnly, total, count, page, limit } = opts;

  const rows = tags.map((t) =>
    `<tr>
      <td>${esc(t.name)}</td>
      <td style="width: 25%">
        <a class="btn btn-link" href="/bookmarks?q=%23${encodeURIComponent(t.name)}">${t.bookmark_count}</a>
      </td>
      <td class="actions">
        <form method="post" action="/tags/${t.id}/delete" class="d-inline">
          <input type="hidden" name="search" value="${esc(search)}">
          <input type="hidden" name="sort" value="${esc(sort)}">
          ${unusedOnly ? '<input type="hidden" name="unused" value="true">' : ""}
          <input type="hidden" name="page" value="${page}">
          <button data-confirm data-confirm-question="Delete tag ${esc(t.name)}?" type="submit" class="btn btn-link text-error">Remove</button>
        </form>
      </td>
    </tr>`).join("");

  const list = tags.length
    ? `<table class="table crud-table">
      <thead><tr><th>Name</th><th style="width: 25%">Bookmarks</th><th class="actions"><span class="text-assistive">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : `<div class="empty"><p class="empty-title h5">${search || unusedOnly ? "No tags found" : "You have no tags yet"}</p><p class="empty-subtitle">${search || unusedOnly ? "Try adjusting your search or filters" : "Tags will appear here when you add bookmarks with tags"}</p></div>`;

  const countText = (search || unusedOnly)
    ? `Showing ${count} of ${total} tags`
    : `${total} tags total`;

  const sortOpts = SORT_OPTIONS.map(([v, l]) => `<option value="${v}"${sort === v ? " selected" : ""}>${esc(l)}</option>`).join("");

  const filterParams: Record<string, string> = {};
  if (search) filterParams.search = search;
  if (sort && sort !== "name-asc") filterParams.sort = sort;
  if (unusedOnly) filterParams.unused = "true";
  const pager = tagPagination(count, page, limit, filterParams);

  return `<div class="tags-page crud-page">
  <main aria-labelledby="main-heading">
    <div class="crud-header">
      <h1 id="main-heading">Tags</h1>
      <div class="d-flex gap-2 ml-auto">
        <a href="#merge" class="btn">Merge Tags</a>
      </div>
    </div>
    <section class="crud-filters">
      <form method="get" class="mb-2">
        <div class="form-group">
          <label class="form-label text-assistive" for="search">Search tags</label>
          <div class="input-group">
            <input type="text" id="search" name="search" value="${esc(search)}" placeholder="Search tags..." class="form-input">
            <button type="submit" class="btn input-group-btn">Search</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label text-assistive" for="sort">Sort by</label>
          <div class="input-group">
            <select id="sort" name="sort" class="form-select" data-submit-on-change>${sortOpts}</select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" name="unused" value="true"${unusedOnly ? " checked" : ""} data-submit-on-change>
            <i class="form-icon"></i> Show only unused tags
          </label>
        </div>
      </form>
      <p class="text-secondary text-small m-0">${countText}</p>
    </section>
    ${list}
    ${pager}
    <section id="merge" aria-labelledby="merge-heading" class="mt-6">
      <h2 id="merge-heading" class="text-lg">Merge Tags</h2>
      <form method="post" action="/tags/merge" class="form-group d-flex gap-2 align-end">
        <div class="form-group" style="margin:0">
          <label for="source" class="form-label">Source tag</label>
          <input type="text" id="source" name="source" class="form-input" required placeholder="tag-to-remove">
        </div>
        <div class="form-group" style="margin:0">
          <label for="target" class="form-label">Target tag</label>
          <input type="text" id="target" name="target" class="form-input" required placeholder="keep-this-tag">
        </div>
        <input type="submit" class="btn btn-primary" value="Merge">
      </form>
    </section>
  </main>
</div>`;
}
