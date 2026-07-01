/**
 * HTML layout and helpers for the Web UI.
 * All user-generated content is escaped to prevent XSS.
 */
import type { UserProfileRow } from "../../db/schema.js";

import { esc } from "../../utils/html.js";
export { esc };

export function layout(title: string, bodyHtml: string, opts?: { profile?: UserProfileRow; activeNav?: string; flash?: string; csrfToken?: string; anonymous?: boolean }): string {
  const theme = opts?.profile?.theme || "auto";
  const themeClass = theme === "dark" ? "dark" : theme === "light" ? "light" : "";
  const navItem = (href: string, label: string, key: string) =>
    `<a href="${href}" class="nav-item${opts?.activeNav === key ? " active" : ""}">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="en" class="${themeClass}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — linkding</title>
<link rel="manifest" href="/manifest.json">
<link rel="stylesheet" href="/custom_css">
<style>
:root{--bg:#fff;--fg:#1a1a2e;--muted:#6c757d;--border:#dee2e6;--accent:#4361ee;--accent-hover:#3a56d4;--card:#f8f9fa;--danger:#dc3545;--success:#198754;--input-bg:#fff;--input-border:#ced4da}
html.dark{--bg:#1a1a2e;--fg:#e8e8e8;--muted:#adb5bd;--border:#3a3a5c;--accent:#6c8cff;--accent-hover:#5a7af0;--card:#16213e;--danger:#ff6b6b;--success:#51cf66;--input-bg:#16213e;--input-border:#3a3a5c}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;max-width:960px;margin:0 auto;padding:1rem}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
nav{display:flex;gap:1rem;padding:.75rem 0;border-bottom:1px solid var(--border);margin-bottom:1.5rem;flex-wrap:wrap;align-items:center}
nav .brand{font-weight:700;font-size:1.1rem;color:var(--fg);margin-right:auto}
.nav-item{color:var(--muted);padding:.25rem .5rem;border-radius:4px}.nav-item:hover,.nav-item.active{color:var(--accent);text-decoration:none;background:var(--card)}
h1{font-size:1.5rem;margin-bottom:1rem}
.btn{display:inline-block;padding:.4rem 1rem;border:1px solid var(--border);border-radius:4px;background:var(--card);color:var(--fg);cursor:pointer;font-size:.9rem;text-decoration:none}
.btn:hover{text-decoration:none;border-color:var(--accent)}.btn-primary{background:var(--accent);color:#fff;border-color:var(--accent)}.btn-primary:hover{background:var(--accent-hover)}
.btn-danger{background:var(--danger);color:#fff;border-color:var(--danger)}
.btn-sm{padding:.2rem .6rem;font-size:.8rem}
.form-group{margin-bottom:1rem}.form-group label{display:block;margin-bottom:.25rem;font-weight:500}
.form-control{width:100%;padding:.4rem .6rem;border:1px solid var(--input-border);border-radius:4px;background:var(--input-bg);color:var(--fg);font-size:.9rem}
.form-control:focus{outline:none;border-color:var(--accent)}
textarea.form-control{min-height:80px;resize:vertical}
.form-check{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem}
.flash{padding:.75rem 1rem;border-radius:4px;margin-bottom:1rem}.flash-success{background:var(--success);color:#fff}.flash-error{background:var(--danger);color:#fff}
.bookmark-list{list-style:none}.bookmark-item{padding:.75rem 0;border-bottom:1px solid var(--border)}
.bookmark-title{font-weight:500;font-size:1.05rem}.bookmark-title a{color:var(--fg)}
.bookmark-url{color:var(--muted);font-size:.85rem;word-break:break-all}
.bookmark-meta{display:flex;gap:.5rem;align-items:center;margin-top:.25rem;flex-wrap:wrap;font-size:.85rem;color:var(--muted)}
.tag{display:inline-block;padding:.1rem .4rem;background:var(--card);border:1px solid var(--border);border-radius:3px;font-size:.8rem;color:var(--accent)}
.actions{display:flex;gap:.5rem;margin-top:.25rem}
.pagination{display:flex;gap:.5rem;margin-top:1.5rem;justify-content:center}
.search-bar{display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap}
.search-bar .form-control{flex:1;min-width:200px}
.search-bar select{padding:.4rem .6rem;border:1px solid var(--input-border);border-radius:4px;background:var(--input-bg);color:var(--fg)}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1.25rem;margin-bottom:1rem}
.login-box{max-width:400px;margin:4rem auto}
table{width:100%;border-collapse:collapse;margin-bottom:1rem}
th,td{text-align:left;padding:.5rem;border-bottom:1px solid var(--border)}
th{font-weight:600}
@media(prefers-color-scheme:dark){html:not(.light){--bg:#1a1a2e;--fg:#e8e8e8;--muted:#adb5bd;--border:#3a3a5c;--accent:#6c8cff;--accent-hover:#5a7af0;--card:#16213e;--danger:#ff6b6b;--success:#51cf66;--input-bg:#16213e;--input-border:#3a3a5c}}
</style>
</head>
<body>
${opts?.csrfToken ? `<input type="hidden" id="_csrf_token" value="${esc(opts.csrfToken)}">` : ""}
<nav>
  <a href="${opts?.anonymous ? "/bookmarks/shared" : "/bookmarks"}" class="brand">linkding</a>
  ${opts?.anonymous
    ? navItem("/bookmarks/shared", "Shared", "shared")
    : `${navItem("/bookmarks", "Bookmarks", "bookmarks")}
  ${navItem("/bookmarks/archived", "Archived", "archived")}
  ${navItem("/bookmarks/shared", "Shared", "shared")}
  ${navItem("/tags", "Tags", "tags")}
  ${navItem("/bundles", "Bundles", "bundles")}
  ${navItem("/settings", "Settings", "settings")}
  <a href="/logout" class="nav-item">Logout</a>`}
</nav>
${opts?.flash ? `<div class="flash ${opts.flash.startsWith("Error") ? "flash-error" : "flash-success"}">${esc(opts.flash)}</div>` : ""}
${bodyHtml}
</body>
</html>`;
}
