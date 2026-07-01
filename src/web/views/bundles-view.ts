import { esc } from "./layout.js";
import type { BundleRow } from "../../db/schema.js";

function field(name: string, label: string, value: string, help?: string, type = "text"): string {
  return `<div class="form-group">
  <label for="${name}" class="form-label">${esc(label)}</label>
  <input type="${type}" id="${name}" name="${name}" value="${esc(value)}" class="form-input">
  ${help ? `<p class="form-input-hint">${help}</p>` : ""}
</div>`;
}

function selectField(name: string, label: string, value: string, options: [string, string][], help?: string): string {
  const opts = options.map(([v, l]) => `<option value="${v}"${value === v ? " selected" : ""}>${esc(l)}</option>`).join("");
  return `<div class="form-group">
  <label for="${name}" class="form-label">${esc(label)}</label>
  <select id="${name}" name="${name}" class="form-select">${opts}</select>
  ${help ? `<p class="form-input-hint">${help}</p>` : ""}
</div>`;
}

export function bundlesPage(bundles: BundleRow[], editing?: BundleRow, initialSearch = ""): string {
  const rows = bundles.map((b) =>
    `<tr data-bundle-id="${b.id}">
      <td>
        <div class="d-flex align-center">
          <svg class="text-secondary mr-1" width="16" height="16"><use href="/icons.svg#drag"></use></svg>
          <span>${esc(b.name)}</span>
        </div>
      </td>
      <td class="actions">
        <a class="btn btn-link" href="/bundles?edit=${b.id}">Edit</a>
        <form method="post" action="/bundles/${b.id}/delete" class="d-inline">
          <button data-confirm type="submit" class="btn btn-link text-error">Remove</button>
        </form>
      </td>
    </tr>`).join("");

  const list = bundles.length
    ? `<table class="table crud-table">
      <thead><tr><th>Name</th><th class="actions"><span class="text-assistive">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
    : `<div class="empty"><p class="empty-title h5">You have no bundles yet</p><p class="empty-subtitle">Create your first bundle to get started</p></div>`;

  const isEdit = !!editing;
  const heading = isEdit ? "Edit bundle" : "New bundle";
  const action = isEdit ? `/bundles/${editing!.id}` : "/bundles";
  const unreadOpts: [string, string][] = [["off", "Off"], ["yes", "Unread only"], ["no", "Read only"]];
  const sharedOpts: [string, string][] = [["off", "Off"], ["yes", "Shared only"], ["no", "Private only"]];

  const form = `<section aria-labelledby="bundle-form-heading" class="mb-6">
  <div class="section-header"><h2 id="bundle-form-heading">${esc(heading)}</h2></div>
  <form id="bundle-form" action="${action}" method="post" novalidate>
    ${field("name", "Name", editing?.name || "", undefined)}
    ${field("search", "Search terms", editing?.search || initialSearch, "All of these search terms must be present in a bookmark to match.")}
    ${field("any_tags", "Tags", editing?.any_tags || "", "At least one of these tags must be present in a bookmark to match.")}
    ${field("all_tags", "Required tags", editing?.all_tags || "", "All of these tags must be present in a bookmark to match.")}
    ${field("excluded_tags", "Excluded tags", editing?.excluded_tags || "", "None of these tags must be present in a bookmark to match.")}
    ${selectField("filter_unread", "Reading State", editing?.filter_unread || "off", unreadOpts, "Limit matches to unread or read bookmarks.")}
    ${selectField("filter_shared", "Sharing State", editing?.filter_shared || "off", sharedOpts, "Limit matches to shared or unshared bookmarks.")}
    <div class="form-group">
      <label for="order" class="form-label">Order</label>
      <input type="number" id="order" name="order" value="${editing?.order ?? 0}" class="form-input width-25 width-sm-100">
    </div>
    <div class="form-footer d-flex mt-4">
      <input type="submit" name="save" value="Save" class="btn btn-primary btn-wide">
      <a href="/bundles" class="btn btn-wide ml-auto">Cancel</a>
    </div>
  </form>
</section>`;

  return `<main class="bundles-page crud-page" aria-labelledby="main-heading">
  <div class="crud-header">
    <h1 id="main-heading">Bundles</h1>
    <a href="#bundle-form" class="btn">Add bundle</a>
  </div>
  ${isEdit ? form : ""}
  ${list}
  ${!isEdit ? form : ""}
</main>`;
}
