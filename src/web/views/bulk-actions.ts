import { esc } from "./layout.js";

export function bulkActionBar(): string {
  return `<div class="bulk-action-bar">
<form method="POST" action="/bookmarks/bulk" id="bulk-action-form">
<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:1rem;padding:.75rem;background:var(--card);border:1px solid var(--border);border-radius:4px">
  <label style="display:flex;align-items:center;gap:.25rem;cursor:pointer"><input type="checkbox" id="select-all"> Select all</label>
  <select name="bulk_action" class="form-control" style="width:auto">
    <option value="bulk_archive">Archive</option>
    <option value="bulk_unarchive">Unarchive</option>
    <option value="bulk_delete">Delete</option>
    <option value="bulk_tag">Tag</option>
    <option value="bulk_untag">Untag</option>
    <option value="bulk_mark_read">Mark Read</option>
    <option value="bulk_mark_unread">Mark Unread</option>
    <option value="bulk_share">Share</option>
    <option value="bulk_unshare">Unshare</option>
  </select>
  <input type="text" name="bulk_tag_string" class="form-control" style="width:auto" placeholder="Tag names (comma-separated)">
  <button type="submit" class="btn btn-primary">Apply</button>
</div>
</form>
<script>
document.getElementById('select-all').addEventListener('change', function() {
  var checked = this.checked;
  document.querySelectorAll('input[name="bookmark_id"]').forEach(function(cb) { cb.checked = checked; });
});
</script>
</div>`;
}
