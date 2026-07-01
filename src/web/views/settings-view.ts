import { esc } from "./layout.js";
import type { UserProfileRow, ApiTokenRow } from "../../db/schema.js";

export function settingsPage(opts: {
  profile: UserProfileRow;
  tokens: ApiTokenRow[];
  newToken?: string;
  feedToken?: string;
  csrfToken?: string;
}): string {
  const { profile, tokens, newToken, feedToken, csrfToken } = opts;
  const csrf = csrfToken ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">` : "";
  const tokenRows = tokens.map((t) =>
    `<tr><td>${esc(t.name)}</td><td>${esc(t.created)}</td>
    <td><form method="POST" action="/settings/api-token/delete" style="display:inline">${csrf}<input type="hidden" name="id" value="${t.id}"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form></td></tr>`
  ).join("");

  return `<h1>Settings</h1>
${newToken ? `<div class="flash flash-success">New API token created: <code>${esc(newToken)}</code> — copy it now, it won't be shown again.</div>` : ""}
${feedToken ? `<div class="flash flash-success">Feed token: <code>${esc(feedToken)}</code></div>` : ""}

<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">General</h2>
<form method="POST" action="/settings">
${csrf}
  <div class="form-group"><label>Theme</label>
    <select name="theme" class="form-control" style="width:200px">
      <option value="auto"${profile.theme === "auto" ? " selected" : ""}>Auto</option>
      <option value="light"${profile.theme === "light" ? " selected" : ""}>Light</option>
      <option value="dark"${profile.theme === "dark" ? " selected" : ""}>Dark</option>
    </select>
  </div>
  <div class="form-group"><label>Items per page</label><input type="number" name="items_per_page" value="${profile.items_per_page}" class="form-control" style="width:100px" min="10"></div>
  <div class="form-check"><input type="checkbox" id="enable_sharing" name="enable_sharing" value="1"${profile.enable_sharing ? " checked" : ""}><label for="enable_sharing">Enable sharing</label></div>
  <div class="form-check"><input type="checkbox" id="enable_public_sharing" name="enable_public_sharing" value="1"${profile.enable_public_sharing ? " checked" : ""}><label for="enable_public_sharing">Enable public sharing</label></div>
  <div class="form-check"><input type="checkbox" id="enable_favicons" name="enable_favicons" value="1"${profile.enable_favicons ? " checked" : ""}><label for="enable_favicons">Enable favicons</label></div>
  <div class="form-check"><input type="checkbox" id="default_mark_unread" name="default_mark_unread" value="1"${profile.default_mark_unread ? " checked" : ""}><label for="default_mark_unread">Mark new bookmarks as unread by default</label></div>
  <div class="form-check"><input type="checkbox" id="default_mark_shared" name="default_mark_shared" value="1"${profile.default_mark_shared ? " checked" : ""}><label for="default_mark_shared">Mark new bookmarks as shared by default</label></div>
  <div class="form-group"><label>Tag search</label>
    <select name="tag_search" class="form-control" style="width:200px">
      <option value="strict"${profile.tag_search === "strict" ? " selected" : ""}>Strict (# prefix required)</option>
      <option value="lax"${profile.tag_search === "lax" ? " selected" : ""}>Lax (bare words match tags)</option>
    </select>
  </div>
  <div class="form-group"><label>Web archive integration</label>
    <select name="web_archive_integration" class="form-control" style="width:200px">
      <option value="disabled"${profile.web_archive_integration === "disabled" ? " selected" : ""}>Disabled</option>
      <option value="enabled"${profile.web_archive_integration === "enabled" ? " selected" : ""}>Enabled</option>
    </select>
  </div>
  <div class="form-group"><label>Custom CSS</label><textarea name="custom_css" class="form-control" rows="4">${esc(profile.custom_css || "")}</textarea></div>
  <button type="submit" class="btn btn-primary">Save Settings</button>
</form>
</div>

<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">Auto-Tagging Rules</h2>
<form method="POST" action="/settings/auto-tagging">
${csrf}
  <div class="form-group"><label>Rules (one per line: <code>pattern tag1 tag2</code>)</label>
    <textarea name="auto_tagging_rules" class="form-control" rows="6">${esc(profile.auto_tagging_rules)}</textarea>
  </div>
  <button type="submit" class="btn btn-primary">Save Rules</button>
</form>
</div>

<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">API Tokens</h2>
<table><thead><tr><th>Name</th><th>Created</th><th>Actions</th></tr></thead>
<tbody>${tokenRows || '<tr><td colspan="3" style="color:var(--muted)">No tokens.</td></tr>'}</tbody></table>
<form method="POST" action="/settings/api-token" style="display:flex;gap:.5rem;align-items:end;margin-top:.75rem">
${csrf}
  <div class="form-group" style="margin:0"><label>Token name</label><input type="text" name="name" class="form-control" required placeholder="e.g. browser-extension"></div>
  <button type="submit" class="btn btn-primary">Generate Token</button>
</form>
</div>

<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">Import / Export</h2>
<div style="display:flex;gap:1rem;flex-wrap:wrap">
  <div>
    <h3 style="font-size:1rem;margin-bottom:.5rem">Import Bookmarks</h3>
    <form method="POST" action="/settings/import" enctype="multipart/form-data">
      ${csrf}
      <input type="file" name="file" accept=".html,.htm" required>
      <button type="submit" class="btn btn-primary" style="margin-top:.5rem">Import</button>
    </form>
  </div>
  <div>
    <h3 style="font-size:1rem;margin-bottom:.5rem">Export Bookmarks</h3>
    <a href="/settings/export" class="btn btn-primary">Download Netscape HTML</a>
  </div>
</div>
</div>

<div class="card">
<h2 style="font-size:1.1rem;margin-bottom:.75rem">Feeds</h2>
<form method="POST" action="/settings/feed-token">
${csrf}
  <p style="margin-bottom:.5rem;color:var(--muted)">Generate a feed token to subscribe to RSS/Atom feeds of your bookmarks.</p>
  <button type="submit" class="btn btn-primary">Generate Feed Token</button>
</form>
</div>`;
}
