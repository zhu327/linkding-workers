import { esc } from "./layout.js";
import type { TagRow } from "../../db/schema.js";

export function tagsPage(tags: TagRow[]): string {
  const rows = tags.map((t) =>
    `<tr>
      <td>${esc(t.name)}</td>
      <td class="actions">
        <a class="btn btn-link" href="/bookmarks?q=%23${encodeURIComponent(t.name)}">View bookmarks</a>
        <form method="post" action="/tags/${t.id}/delete" class="d-inline">
          <button data-confirm data-confirm-question="Delete tag ${esc(t.name)}?" type="submit" class="btn btn-link text-error">Remove</button>
        </form>
      </td>
    </tr>`).join("");

  const list = tags.length
    ? `<table class="table crud-table">
      <thead><tr><th>Name</th><th class="actions"><span class="text-assistive">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : `<div class="empty"><p class="empty-title h5">You have no tags yet</p><p class="empty-subtitle">Tags will appear here when you add bookmarks with tags</p></div>`;

  return `<div class="tags-page crud-page">
  <main aria-labelledby="main-heading">
    <div class="crud-header">
      <h1 id="main-heading">Tags</h1>
      <div class="d-flex gap-2 ml-auto">
        <a href="#merge" class="btn">Merge Tags</a>
      </div>
    </div>
    <section id="merge" aria-labelledby="merge-heading" class="mb-6">
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
    <p class="text-secondary text-small m-0 mb-4">${tags.length} tags total</p>
    ${list}
  </main>
</div>`;
}
