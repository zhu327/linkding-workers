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

// Escape a string for safe embedding inside a single-quoted JS string.
function escJsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function feedUrlsSection(siteUrl?: string, token?: string, publicSharing?: boolean): string {
  const rows: string[] = [];
  if (siteUrl && token) {
    for (const [label, path] of [["All bookmarks", "all"], ["Unread bookmarks", "unread"], ["Shared bookmarks", "shared"]]) {
      const url = `${siteUrl}/feeds/${token}/${path}`;
      rows.push(`<div class="input-group mb-2"><span class="input-group-addon">${label}</span><input class="form-input" readonly value="${esc(url)}"><button type="button" class="btn input-group-btn" data-copy-text="${esc(url)}">Copy</button></div>`);
    }
  }
  if (siteUrl && publicSharing) {
    const url = `${siteUrl}/feeds/shared`;
    rows.push(`<div class="input-group mb-2"><span class="input-group-addon">Public shared</span><input class="form-input" readonly value="${esc(url)}"><button type="button" class="btn input-group-btn" data-copy-text="${esc(url)}">Copy</button></div>`);
  }
  return rows.length ? `<div class="form-group mt-2">${rows.join("")}</div>` : "";
}

function bookmarkletSection(applicationUrl?: string): string {
  if (!applicationUrl) return "";
  const appUrl = escJsString(applicationUrl);
  // URL-only bookmarklet: linkding opens the form with the current page URL.
  const serverBookmarklet = `javascript:(function(){var u=window.location;var a='${appUrl}';a+='?url='+encodeURIComponent(u);a+='&auto_close';window.open(a);})();`;
  // Client-side detection: grab title/description from the current page DOM.
  const clientBookmarklet = `javascript:(function(){var u=window.location;var t=document.querySelector('title')&&document.querySelector('title').textContent||document.querySelector('meta[property="og:title"]')&&document.querySelector('meta[property="og:title"]').getAttribute('content')||'';var d=document.querySelector('meta[name="description"]')&&document.querySelector('meta[name="description"]').getAttribute('content')||document.querySelector('meta[property="og:description"]')&&document.querySelector('meta[property="og:description"]').getAttribute('content')||'';var a='${appUrl}';a+='?url='+encodeURIComponent(u);a+='&title='+encodeURIComponent(t);a+='&description='+encodeURIComponent(d);a+='&auto_close';window.open(a);})();`;
  return `    <h3 class="mt-4">Bookmarklet</h3>
    <p class="form-input-hint">The bookmarklet is an alternative, cross-browser way to quickly add new bookmarks without opening the linkding application first. Drag the button below into your browser's bookmark bar, then click it on any page you want to bookmark.</p>
    <div class="form-group radio-group" role="radiogroup" aria-labelledby="bookmarklet-method-label">
      <p id="bookmarklet-method-label">Choose your preferred bookmarklet:</p>
      <label class="form-radio" for="bookmarklet-type-server">
        <input id="bookmarklet-type-server" type="radio" name="bookmarklet-type" value="server" checked>
        <i class="form-icon"></i> Send URL only
      </label>
      <label class="form-radio" for="bookmarklet-type-client">
        <input id="bookmarklet-type-client" type="radio" name="bookmarklet-type" value="client">
        <i class="form-icon"></i> Send title and description from the browser
      </label>
    </div>
    <div class="form-group bookmarklet-container">
      <a id="bookmarklet-server" href="${esc(serverBookmarklet)}" class="btn btn-primary">📎 Add bookmark</a>
      <a id="bookmarklet-client" href="${esc(clientBookmarklet)}" class="btn btn-primary" style="display: none">📎 Add bookmark</a>
      <button type="button" class="btn" data-copy-target="#bookmarklet-server">Copy URL-only bookmarklet</button>
      <button type="button" class="btn" data-copy-target="#bookmarklet-client">Copy metadata bookmarklet</button>
    </div>
    <script>
      (function () {
        var radios = document.querySelectorAll('input[name="bookmarklet-type"]');
        var server = document.getElementById('bookmarklet-server');
        var client = document.getElementById('bookmarklet-client');
        function toggle() {
          var v = document.querySelector('input[name="bookmarklet-type"]:checked').value;
          server.style.display = v === 'server' ? 'inline-block' : 'none';
          client.style.display = v === 'client' ? 'inline-block' : 'none';
        }
        toggle();
        for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', toggle);
      })();
    </script>`;
}

export function settingsPage(opts: {
  profile: UserProfileRow;
  tokens: ApiTokenRow[];
  newToken?: string;
  feedToken?: string;
  csrfToken?: string;
  flash?: string;
  applicationUrl?: string;
  currentFeedToken?: string;
  siteUrl?: string;
}): string {
  const { profile, tokens, newToken, feedToken, csrfToken, applicationUrl, currentFeedToken, siteUrl } = opts;
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
  ${newToken ? `<div class="toast toast-success mb-4">New API token created: <code>${esc(newToken)}</code> — copy it now, it won't be shown again. <button type="button" class="btn btn-sm" data-copy-text="${esc(newToken)}">Copy</button></div>` : ""}
  ${feedToken ? `<div class="toast toast-success mb-4">Feed token: <code>${esc(feedToken)}</code> <button type="button" class="btn btn-sm" data-copy-text="${esc(feedToken)}">Copy</button></div>` : ""}

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
        <label for="bookmark_link_target" class="form-label">Bookmark link target</label>
        <select id="bookmark_link_target" name="bookmark_link_target" class="form-select width-25 width-sm-100">
          <option value="_blank"${p.bookmark_link_target === "_blank" ? " selected" : ""}>New page</option>
          <option value="_self"${p.bookmark_link_target === "_self" ? " selected" : ""}>Same page</option>
        </select>
        <p class="form-input-hint">Where bookmark links should open.</p>
      </div>
      <div class="form-group">
        <label for="bookmark_date_display" class="form-label">Bookmark date display</label>
        <select id="bookmark_date_display" name="bookmark_date_display" class="form-select width-25 width-sm-100">
          <option value="relative"${p.bookmark_date_display === "relative" ? " selected" : ""}>Relative</option>
          <option value="absolute"${p.bookmark_date_display === "absolute" ? " selected" : ""}>Absolute</option>
          <option value="hidden"${p.bookmark_date_display === "hidden" ? " selected" : ""}>Hidden</option>
        </select>
        <p class="form-input-hint">Whether to show bookmark dates in lists and detail views.</p>
      </div>
      ${checkbox("display_url", "display_url", "Display bookmark URLs", !!p.display_url, "Shows the URL below each bookmark title in lists.")}
      ${checkbox("permanent_notes", "permanent_notes", "Always show notes", !!p.permanent_notes, "Shows bookmark notes in lists without using the notes toggle.")}
      ${checkbox("enable_preview_images", "enable_preview_images", "Enable preview images", !!p.enable_preview_images, "Shows website preview images for bookmarks when available.")}
      ${checkbox("collapse_side_panel", "collapse_side_panel", "Collapse side panel by default", !!p.collapse_side_panel, "Hides the bundles and tags side panel by default on bookmark list pages.")}
      <div class="form-group">
        <label for="bookmark_description_display" class="form-label">Bookmark description display</label>
        <select id="bookmark_description_display" name="bookmark_description_display" class="form-select width-25 width-sm-100">
          <option value="separate"${p.bookmark_description_display === "separate" ? " selected" : ""}>Separate line</option>
          <option value="inline"${p.bookmark_description_display === "inline" ? " selected" : ""}>Inline</option>
          <option value="hidden"${p.bookmark_description_display === "hidden" ? " selected" : ""}>Hidden</option>
        </select>
        <p class="form-input-hint">How bookmark descriptions should be displayed in lists.</p>
      </div>
      <div class="form-group">
        <label for="bookmark_description_max_lines" class="form-label">Description max lines</label>
        <input type="number" id="bookmark_description_max_lines" name="bookmark_description_max_lines" value="${p.bookmark_description_max_lines || 3}" class="form-input width-25 width-sm-100" min="1" max="10">
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
        <label for="tag_grouping" class="form-label">Tag grouping</label>
        <select id="tag_grouping" name="tag_grouping" class="form-select width-25 width-sm-100">
          <option value="disabled"${p.tag_grouping === "disabled" ? " selected" : ""}>Disabled</option>
          <option value="alphabetical"${p.tag_grouping === "alphabetical" ? " selected" : ""}>Alphabetical</option>
          <option value="prefix"${p.tag_grouping === "prefix" ? " selected" : ""}>By prefix</option>
        </select>
        <p class="form-input-hint">Group tags in the side panel alphabetically or by prefix before a slash.</p>
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
    <form action="/settings/search-preferences/clear" method="post" class="form-group">
      ${csrf}
      <button data-confirm data-confirm-question="Clear saved search preferences?" type="submit" class="btn">Clear search preferences</button>
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
    ${feedUrlsSection(siteUrl, feedToken || currentFeedToken, !!(p.enable_sharing && p.enable_public_sharing))}

    ${bookmarkletSection(applicationUrl)}
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
