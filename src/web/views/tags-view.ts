import { esc } from "./layout.js";
import type { TagRow } from "../../db/schema.js";

export function tagsPage(tags: TagRow[]): string {
  const rows = tags.map((t) =>
    `<tr><td><span class="tag">${esc(t.name)}</span></td><td>${esc(t.date_added)}</td>
    <td><form method="POST" action="/tags/${t.id}/delete" style="display:inline"><button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Delete tag ${esc(t.name)}?')">Delete</button></form></td></tr>`
  ).join("");

  return `<h1>Tags</h1>
<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">Merge Tags</h2>
<form method="POST" action="/tags/merge" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end">
  <div class="form-group" style="margin:0"><label>Source tag</label><input type="text" name="source" class="form-control" required placeholder="tag-to-remove"></div>
  <div class="form-group" style="margin:0"><label>Target tag</label><input type="text" name="target" class="form-control" required placeholder="keep-this-tag"></div>
  <button type="submit" class="btn btn-primary">Merge</button>
</form>
</div>
<div class="card">
<table><thead><tr><th>Name</th><th>Created</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="3" style="color:var(--muted)">No tags yet.</td></tr>'}</tbody></table>
</div>`;
}
