import { esc } from "./layout.js";
import type { UserProfileRow, ApiTokenRow } from "../../db/schema.js";

function checkbox(id: string, name: string, label: string, checked: boolean, hint?: string): string {
  return `<div class="form-group">
  <label class="form-checkbox">
    <input type="checkbox" id="${id}" name="${name}" value="1"${checked ? " checked" : ""}>
    <i class="form-icon"></i> ${esc(label)}
  </label>
  ${hint ? `<p class="form-input-hint">${hint}</p>` : ""}
</div>`;
}

export function settingsPage(opts: {
  profile: UserProfileRow;
  tokens: ApiTokenRow[];
  newToken?: string;
  feedToken?: string;
  csrfToken?: string;
  flash?: string;
}): string {
  const { profile, tokens, newToken, feedToken, csrfToken } = opts;
  const csrf = csrfToken ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">` : "";
  const p = profile;

  const tokenRows = tokens.map((t) =>
    `<tr>
      <td>${esc(t.name)}</td>
      <td>${esc(t.created)}</td>
      <td class="actions">
        <form method="post" action="/settings/api-token/delete" class="d-inline">${csrf}<input type="hidden" name="id" value="${t.id}"><button data-confirm type="submit" class="btn btn-link text-error">Delete</button></form>
      </td>
    </tr>`).join("");

  return `<main class="settings-page" aria-labelledby="main-heading">
  <h1 id="main-heading">Settings</h1>
  ${newToken ? `<div class="toast toast-success mb-4">New API token created: <code>${esc(newToken)}</code> — copy it now, it won't be shown again.</div>` : ""}
  ${feedToken ? `<div class="toast toast-success mb-4">Feed token: <code>${esc(feedToken)}</code></div>` : ""}

  <section aria-labelledby="profile-heading">
    <h2 id="profile-heading">Profile</h2>
    <form action="/settings" method="post" novalidate>
      ${csrf}
      <div class="form-group">
        <label for="theme" class="form-label">Theme</label>
        <select id="theme" name="theme" class="form-select width-25 width-sm-100">
          <option value="auto"${p.theme === "auto" ? " selected" : ""}>Auto</option>
          <option value="light"${p.theme === "light" ? " selected" : ""}>Light</option>
          <option value="dark"${p.theme === "dark" ? " selected" : ""}>Dark</option>
        </select>
        <p class="form-input-hint">Whether to use a light or dark theme, or automatically adjust the theme based on your system's settings.</p>
      </div>
      <div class="form-group">
        <label for="items_per_page" class="form-label">Items per page</label>
        <input type="number" id="items_per_page" name="items_per_page" value="${p.items_per_page}" class="form-input width-25 width-sm-100" min="10">
        <p class="form-input-hint">The number of bookmarks to display per page.</p>
      </div>
      <div class="form-group">
        <label for="tag_search" class="form-label">Tag search</label>
        <select id="tag_search" name="tag_search" class="form-select width-25 width-sm-100">
          <option value="strict"${p.tag_search === "strict" ? " selected" : ""}>Strict</option>
          <option value="lax"${p.tag_search === "lax" ? " selected" : ""}>Lax</option>
        </select>
        <p class="form-input-hint">In strict mode, tags must be prefixed with a hash character (#). In lax mode, tags can also be searched without the hash character.</p>
      </div>
      <div class="form-group">
        <label for="web_archive_integration" class="form-label">Internet Archive integration</label>
        <select id="web_archive_integration" name="web_archive_integration" class="form-select width-25 width-sm-100">
          <option value="disabled"${p.web_archive_integration === "disabled" ? " selected" : ""}>Disabled</option>
          <option value="enabled"${p.web_archive_integration === "enabled" ? " selected" : ""}>Enabled</option>
        </select>
        <p class="form-input-hint">Enabling this feature will automatically create snapshots of bookmarked websites on the Internet Archive Wayback Machine.</p>
      </div>
      ${checkbox("enable_favicons", "enable_favicons", "Enable Favicons", !!p.enable_favicons, "Automatically loads favicons for bookmarked websites and displays them next to each bookmark.")}
      ${checkbox("enable_sharing", "enable_sharing", "Enable bookmark sharing", !!p.enable_sharing, "Allows to share bookmarks with other users, and to view shared bookmarks.")}
      ${checkbox("enable_public_sharing", "enable_public_sharing", "Enable public bookmark sharing", !!p.enable_public_sharing, "Makes shared bookmarks publicly accessible, without requiring a login.")}
      ${checkbox("default_mark_unread", "default_mark_unread", "Create bookmarks as unread by default", !!p.default_mark_unread)}
      ${checkbox("default_mark_shared", "default_mark_shared", "Create bookmarks as shared by default", !!p.default_mark_shared)}
      <div class="form-group">
        <details${p.auto_tagging_rules ? " open" : ""}>
          <summary><span class="form-label d-inline-block">Auto Tagging</span></summary>
          <label for="auto_tagging_rules" class="text-assistive">Auto Tagging</label>
          <textarea id="auto_tagging_rules" name="auto_tagging_rules" rows="6" class="form-input monospace">${esc(p.auto_tagging_rules || "")}</textarea>
        </details>
        <p class="form-input-hint">Automatically adds tags to bookmarks based on predefined rules. Each line maps a URL to one or more tags, e.g. <code>youtube.com video</code>.</p>
      </div>
      <div class="form-group">
        <details${p.custom_css ? " open" : ""}>
          <summary><span class="form-label d-inline-block">Custom CSS</span></summary>
          <label for="custom_css" class="text-assistive">Custom CSS</label>
          <textarea id="custom_css" name="custom_css" rows="6" class="form-input monospace">${esc(p.custom_css || "")}</textarea>
        </details>
        <p class="form-input-hint">Allows to add custom CSS to the page.</p>
      </div>
      <div class="form-group">
        <input type="submit" name="update_profile" value="Save" class="btn btn-primary btn-wide mt-2">
      </div>
    </form>
  </section>

  <section id="integrations" aria-labelledby="integrations-heading">
    <h2 id="integrations-heading">Integrations</h2>
    <h3>API Tokens</h3>
    <table class="table crud-table mb-4">
      <thead><tr><th>Name</th><th>Created</th><th class="actions"><span class="text-assistive">Actions</span></th></tr></thead>
      <tbody>${tokenRows || `<tr><td colspan="3" class="text-secondary">No tokens.</td></tr>`}</tbody>
    </table>
    <form method="post" action="/settings/api-token" class="form-group d-flex gap-2">
      ${csrf}
      <input type="text" name="name" class="form-input" placeholder="Token name" required>
      <input type="submit" class="btn btn-primary" value="Create API token">
    </form>

    <h3 class="mt-4">RSS Feeds</h3>
    <form method="post" action="/settings/feed-token" class="form-group">
      ${csrf}
      <p class="form-input-hint">Generate a feed token to subscribe to RSS/Atom feeds of your bookmarks.</p>
      <input type="submit" class="btn" value="Generate Feed Token">
    </form>
  </section>

  <section aria-labelledby="import-heading">
    <h2 id="import-heading">Import</h2>
    <p>Import bookmarks and tags in the Netscape HTML format. This will execute a sync where new bookmarks are added and existing ones are updated.</p>
    <form method="post" enctype="multipart/form-data" action="/settings/import">
      ${csrf}
      <div class="form-group">
        <div class="input-group width-75 width-md-100">
          <input class="form-input" type="file" name="file" accept=".html,.htm" required>
          <input type="submit" class="input-group-btn btn btn-primary" value="Upload">
        </div>
      </div>
    </form>
  </section>

  <section aria-labelledby="export-heading">
    <h2 id="export-heading">Export</h2>
    <p>Export all bookmarks in Netscape HTML format.</p>
    <a class="btn btn-primary" target="_blank" href="/settings/export">Download (.html)</a>
  </section>

  <section class="about" aria-labelledby="about-heading">
    <h2 id="about-heading">About</h2>
    <table class="table">
      <tbody>
        <tr><td>Version</td><td>linkding-workers</td></tr>
        <tr><td style="vertical-align:top">Links</td><td><div class="d-flex flex-column gap-2">
          <a href="https://github.com/sissbruecker/linkding/" target="_blank">GitHub (upstream)</a>
          <a href="https://linkding.link/" target="_blank">Documentation</a>
        </div></td></tr>
      </tbody>
    </table>
  </section>
</main>`;
}
