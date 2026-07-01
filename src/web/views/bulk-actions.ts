import { esc } from "./layout.js";
import type { UserProfileRow } from "../../db/schema.js";

export function bulkEditBar(profile: UserProfileRow, total: number): string {
  const sharing = !!profile.enable_sharing;
  const options = [
    `<option value="bulk_archive">Archive</option>`,
    `<option value="bulk_unarchive">Unarchive</option>`,
    `<option value="bulk_delete">Delete</option>`,
    `<option value="bulk_tag">Add tags</option>`,
    `<option value="bulk_untag">Remove tags</option>`,
    `<option value="bulk_read">Mark as read</option>`,
    `<option value="bulk_unread">Mark as unread</option>`,
    sharing ? `<option value="bulk_share">Share</option>` : "",
    sharing ? `<option value="bulk_unshare">Unshare</option>` : "",
  ].filter(Boolean).join("");

  return `<div class="bulk-edit-bar">
  <label class="form-checkbox bulk-edit-checkbox all">
    <input type="checkbox" id="select-all">
    <i class="form-icon"></i>
  </label>
  <select name="bulk_action" class="form-select select-sm">${options}</select>
  <input type="text" name="bulk_tag_string" class="form-input input-sm bulk-tag-input" placeholder="Tag names...">
  <button data-confirm type="submit" name="bulk_execute" class="btn btn-link btn-sm" disabled><span>Execute</span></button>
  <label class="form-checkbox select-across d-none">
    <input type="checkbox" name="bulk_select_across">
    <i class="form-icon"></i>
    All <span class="total">${esc(String(total))}</span> bookmarks
  </label>
</div>`;
}
