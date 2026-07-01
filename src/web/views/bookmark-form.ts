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
  const title = isEdit ? "Edit bookmark" : "New bookmark";
  const currentTags = (tagNames || []).join(" ");
  const suggestions = allTags.map((t) => `<option value="${esc(t.name)}">`).join("");
  const sharing = !!profile?.enable_sharing;
  const hasNotes = !!(bookmark && bookmark.notes);

  return `<div class="bookmarks-form-page">
  <main aria-labelledby="main-heading">
    <div class="section-header">
      <h1 id="main-heading">${esc(title)}</h1>
    </div>
    <form action="${isEdit ? `/bookmarks/${bookmark!.id}` : "/bookmarks"}" method="post" novalidate>
      <div class="bookmarks-form">
        ${error ? `<div class="toast toast-error d-flex">${esc(error)}</div>` : ""}
        <div class="form-group">
          <label for="url" class="form-label">URL</label>
          <div class="has-icon-right">
            <input type="url" id="url" name="url" value="${esc(bookmark?.url || "")}" class="form-input" required${isEdit ? "" : " autofocus"}>
            <i class="form-icon loading"></i>
          </div>
        </div>
        <div class="form-group">
          <label for="tag_names" class="form-label">Tags</label>
          <input type="text" id="tag_names" name="tag_names" value="${esc(currentTags)}" class="form-input" list="tag-suggestions" autocomplete="off">
          <datalist id="tag-suggestions">${suggestions}</datalist>
          <p class="form-input-hint">Enter any number of tags separated by space and <strong>without</strong> the hash (#). If a tag does not exist it will be automatically created.</p>
        </div>
        <div class="form-group">
          <label for="title" class="form-label">Title</label>
          <input type="text" id="title" name="title" value="${esc(bookmark?.title || "")}" class="form-input">
        </div>
        <div class="form-group">
          <label for="description" class="form-label">Description</label>
          <textarea id="description" name="description" rows="3" class="form-input">${esc(bookmark?.description || "")}</textarea>
        </div>
        <div class="form-group">
          <details class="notes"${hasNotes ? " open" : ""}>
            <summary><span class="form-label d-inline-block">Notes</span></summary>
            <label for="notes" class="text-assistive">Notes</label>
            <textarea id="notes" name="notes" rows="8" class="form-input">${esc(bookmark?.notes || "")}</textarea>
            <p class="form-input-hint">Additional notes, supports Markdown.</p>
          </details>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" id="unread" name="unread" value="1"${isEdit ? (bookmark?.unread ? " checked" : "") : (profile?.default_mark_unread ? " checked" : "")}>
            <i class="form-icon"></i> Mark as unread
          </label>
          <p class="form-input-hint">Unread bookmarks can be filtered for, and marked as read after you had a chance to look at them.</p>
        </div>
        ${sharing ? `<div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" id="shared" name="shared" value="1"${isEdit ? (bookmark?.shared ? " checked" : "") : (profile?.default_mark_shared ? " checked" : "")}>
            <i class="form-icon"></i> Share
          </label>
          <p class="form-input-hint">${profile?.enable_public_sharing ? "Share this bookmark with other registered users and anonymous users." : "Share this bookmark with other registered users."}</p>
        </div>` : ""}
        <div class="divider"></div>
        <div class="form-group d-flex justify-between">
          <input type="submit" value="Save" class="btn btn-primary btn-wide">
          <a href="/bookmarks" class="btn">Cancel</a>
        </div>
      </div>
    </form>
  </main>
</div>`;
}
