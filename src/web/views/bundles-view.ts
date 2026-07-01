import { esc } from "./layout.js";
import type { BundleRow } from "../../db/schema.js";

export function bundlesPage(bundles: BundleRow[], editing?: BundleRow): string {
  const rows = bundles.map((b) =>
    `<tr>
      <td><strong>${esc(b.name)}</strong></td>
      <td>${esc(b.search)}</td>
      <td>${esc(b.any_tags)}</td>
      <td>${esc(b.all_tags)}</td>
      <td>${esc(b.excluded_tags)}</td>
      <td>${esc(b.filter_unread)}</td>
      <td>${esc(b.filter_shared)}</td>
      <td>${b.order}</td>
      <td>
        <a href="/bundles?edit=${b.id}" class="btn btn-sm">Edit</a>
        <form method="POST" action="/bundles/${b.id}/delete" style="display:inline"><button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Delete?')">Delete</button></form>
      </td>
    </tr>`
  ).join("");

  const formTitle = editing ? `Edit Bundle: ${esc(editing.name)}` : "New Bundle";
  return `<h1>Bundles</h1>
<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">${formTitle}</h2>
<form method="POST" action="${editing ? `/bundles/${editing.id}` : "/bundles"}">
  <div class="form-group"><label>Name *</label><input type="text" name="name" value="${esc(editing?.name || "")}" class="form-control" required></div>
  <div class="form-group"><label>Search query</label><input type="text" name="search" value="${esc(editing?.search || "")}" class="form-control"></div>
  <div class="form-group"><label>Any tags (space-separated, OR)</label><input type="text" name="any_tags" value="${esc(editing?.any_tags || "")}" class="form-control"></div>
  <div class="form-group"><label>All tags (space-separated, AND)</label><input type="text" name="all_tags" value="${esc(editing?.all_tags || "")}" class="form-control"></div>
  <div class="form-group"><label>Excluded tags (space-separated)</label><input type="text" name="excluded_tags" value="${esc(editing?.excluded_tags || "")}" class="form-control"></div>
  <div class="form-group">
    <label>Filter Unread</label>
    <select name="filter_unread">
      <option value="off" ${editing?.filter_unread === "off" ? "selected" : ""}>Off</option>
      <option value="yes" ${editing?.filter_unread === "yes" ? "selected" : ""}>Yes</option>
      <option value="no" ${editing?.filter_unread === "no" ? "selected" : ""}>No</option>
    </select>
  </div>
  <div class="form-group">
    <label>Filter Shared</label>
    <select name="filter_shared">
      <option value="off" ${editing?.filter_shared === "off" ? "selected" : ""}>Off</option>
      <option value="yes" ${editing?.filter_shared === "yes" ? "selected" : ""}>Yes</option>
      <option value="no" ${editing?.filter_shared === "no" ? "selected" : ""}>No</option>
    </select>
  </div>
  <div class="form-group"><label>Order</label><input type="number" name="order" value="${editing?.order ?? 0}" class="form-control" style="width:100px"></div>
  <button type="submit" class="btn btn-primary">${editing ? "Update" : "Create"}</button>
  ${editing ? '<a href="/bundles" class="btn" style="margin-left:.5rem">Cancel</a>' : ""}
</form>
</div>
<div class="card">
<table><thead><tr><th>Name</th><th>Search</th><th>Any Tags</th><th>All Tags</th><th>Excluded Tags</th><th>Unread</th><th>Shared</th><th>Order</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9" style="color:var(--muted)">No bundles yet.</td></tr>'}</tbody></table>
</div>`;
}
