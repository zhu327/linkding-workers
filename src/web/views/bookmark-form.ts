import { esc } from "./layout.js";
import type { BookmarkRow, TagRow, UserProfileRow } from "../../db/schema.js";

export function bookmarkFormPage(opts: {
  bookmark?: BookmarkRow;
  tagNames?: string[];
  allTags: TagRow[];
  error?: string;
  profile?: UserProfileRow;
}): string {
  const { bookmark, tagNames, allTags, error, profile } = opts;
  const isEdit = !!bookmark;
  const title = isEdit ? "Edit Bookmark" : "New Bookmark";
  const currentTags = (tagNames || []).join(" ");
  const suggestions = allTags.map((t) => t.name);

  return `<h1>${esc(title)}</h1>
${error ? `<div class="flash flash-error">${esc(error)}</div>` : ""}
<div class="card">
<form method="POST" action="${isEdit ? `/bookmarks/${bookmark!.id}` : "/bookmarks"}">
<div class="form-group">
    <label for="url">URL *</label>
    <input type="url" id="url" name="url" value="${esc(bookmark?.url || "")}" class="form-control" required${isEdit ? "" : " autofocus"}>
  </div>
  <div class="form-group">
    <label for="title">Title</label>
    <input type="text" id="title" name="title" value="${esc(bookmark?.title || "")}" class="form-control">
  </div>
  <div class="form-group">
    <label for="description">Description</label>
    <textarea id="description" name="description" class="form-control">${esc(bookmark?.description || "")}</textarea>
  </div>
  <div class="form-group">
    <label for="notes">Notes (Markdown)</label>
    <textarea id="notes" name="notes" class="form-control">${esc(bookmark?.notes || "")}</textarea>
  </div>
  <div class="form-group">
    <label for="tag_names">Tags (space-separated)</label>
    <input type="text" id="tag_names" name="tag_names" value="${esc(currentTags)}" class="form-control" list="tag-suggestions" autocomplete="off">
    <datalist id="tag-suggestions">${suggestions.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
  </div>
  <div class="form-check"><input type="checkbox" id="unread" name="unread" value="1"${isEdit ? (bookmark?.unread ? " checked" : "") : (profile?.default_mark_unread ? " checked" : "")}><label for="unread">Mark as unread</label></div>
  <div class="form-check"><input type="checkbox" id="shared" name="shared" value="1"${isEdit ? (bookmark?.shared ? " checked" : "") : (profile?.default_mark_shared ? " checked" : "")}><label for="shared">Share</label></div>
  <div style="display:flex;gap:.5rem;margin-top:1rem">
    <button type="submit" class="btn btn-primary">${isEdit ? "Update" : "Save"}</button>
    <a href="/bookmarks" class="btn">Cancel</a>
  </div>
</form>
</div>`;
}
