/**
 * HTML layout and helpers for the Web UI.
 * Mirrors the original linkding shared/layout.html + shared/head.html structure.
 * All user-generated content is escaped to prevent XSS.
 */
import type { UserProfileRow } from "../../db/schema.js";

import { esc } from "../../utils/html.js";
export { esc };

export interface LayoutOpts {
  profile?: UserProfileRow;
  activeNav?: string;
  flash?: string;
  csrfToken?: string;
  anonymous?: boolean;
  rssFeedUrl?: string;
}

const APP_VERSION = "1";

function icon(name: string, size = 24): string {
  return `<svg width="${size}" height="${size}"><use href="/icons.svg?v=${APP_VERSION}#${name}"></use></svg>`;
}

/** SVG icon markup, reused by views. */
export function svgIcon(name: string, size = 24): string {
  return icon(name, size);
}

function themeLinks(theme: string): string {
  if (theme === "light") {
    return `<link href="/css/theme-light.css?v=${APP_VERSION}" rel="stylesheet" type="text/css">
    <meta name="theme-color" content="#5856e0">`;
  }
  if (theme === "dark") {
    return `<link href="/css/theme-dark.css?v=${APP_VERSION}" rel="stylesheet" type="text/css">
    <meta name="theme-color" content="#161822">`;
  }
  // auto
  return `<link href="/css/theme-dark.css?v=${APP_VERSION}" rel="stylesheet" type="text/css" media="(prefers-color-scheme: dark)">
    <link href="/css/theme-light.css?v=${APP_VERSION}" rel="stylesheet" type="text/css" media="(prefers-color-scheme: light)">
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#161822">
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#5856e0">`;
}

function navMenu(profile: UserProfileRow | undefined, activeNav: string | undefined): string {
  const sharing = !!profile?.enable_sharing;
  const isActive = (key: string) => (activeNav === key ? " active" : "");
  return `<div class="hide-md">
  <a href="/bookmarks/new" class="btn btn-primary mr-2">Add bookmark</a>
  <div class="dropdown">
    <button class="btn btn-link dropdown-toggle" tabindex="0">Bookmarks</button>
    <ul class="menu" role="list" tabindex="-1">
      <li class="menu-item"><a href="/bookmarks" class="menu-link${isActive("bookmarks")}">Active</a></li>
      <li class="menu-item"><a href="/bookmarks/archived" class="menu-link${isActive("archived")}">Archived</a></li>
      ${sharing ? `<li class="menu-item"><a href="/bookmarks/shared" class="menu-link${isActive("shared")}">Shared</a></li>` : ""}
      <li class="menu-item"><a href="/bookmarks?unread=yes" class="menu-link">Unread</a></li>
      <li class="menu-item"><a href="/bookmarks?q=!untagged" class="menu-link">Untagged</a></li>
    </ul>
  </div>
  <div class="dropdown">
    <button class="btn btn-link dropdown-toggle" tabindex="0">Settings</button>
    <ul class="menu" role="list" tabindex="-1">
      <li class="menu-item"><a href="/settings" class="menu-link${isActive("settings")}">General</a></li>
      <li class="menu-item"><a href="/settings#integrations" class="menu-link">Integrations</a></li>
    </ul>
  </div>
  <a href="/logout" class="btn btn-link">Logout</a>
</div>
<div class="show-md">
  <a href="/bookmarks/new" aria-label="Add bookmark" class="btn btn-primary">${icon("plus")}</a>
  <div class="dropdown dropdown-right">
    <button class="btn btn-link dropdown-toggle" aria-label="Navigation menu" tabindex="0">${icon("menu")}</button>
    <ul class="menu" role="list" tabindex="-1">
      <li class="menu-item"><a href="/bookmarks" class="menu-link">Bookmarks</a></li>
      <li class="menu-item"><a href="/bookmarks/archived" class="menu-link">Archived bookmarks</a></li>
      ${sharing ? `<li class="menu-item"><a href="/bookmarks/shared" class="menu-link">Shared bookmarks</a></li>` : ""}
      <li class="menu-item"><a href="/bookmarks?unread=yes" class="menu-link">Unread</a></li>
      <li class="menu-item"><a href="/bookmarks?q=!untagged" class="menu-link">Untagged</a></li>
      <div class="divider"></div>
      <li class="menu-item"><a href="/settings" class="menu-link">Settings</a></li>
      <li class="menu-item"><a href="/settings#integrations" class="menu-link">Integrations</a></li>
      <div class="divider"></div>
      <li class="menu-item"><a href="/logout" class="btn btn-link menu-link">Logout</a></li>
    </ul>
  </div>
</div>`;
}

export function layout(title: string, bodyHtml: string, opts?: LayoutOpts): string {
  const theme = opts?.profile?.theme || "auto";
  const flash = opts?.flash;
  const toastClass = flash?.startsWith("Error") ? "toast-error" : "toast-success";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5856e0">
<link rel="manifest" href="/manifest.json">
<link rel="search" type="application/opensearchdescription+xml" title="Linkding" href="/opensearch.xml">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Self-hosted bookmark service">
<title>${esc(title)}</title>
    ${themeLinks(theme)}
    <link href="/custom_css" rel="stylesheet" type="text/css">
    ${opts?.rssFeedUrl ? `<link rel="alternate" type="application/rss+xml" href="${esc(opts.rssFeedUrl)}">` : ""}
    <script src="/js/app.js?v=${APP_VERSION}"></script>
</head>
<body>
${opts?.csrfToken ? `<input type="hidden" id="_csrf_token" value="${esc(opts.csrfToken)}">` : ""}
<header class="container">
  ${flash ? `<div class="message-list"><div class="toast ${toastClass} d-flex">${esc(flash)}</div></div>` : ""}
  <div class="d-flex justify-between">
    <a href="${opts?.anonymous ? "/bookmarks/shared" : "/bookmarks"}" class="app-link d-flex align-center">
      <img class="app-logo" src="/logo.svg" alt="Application logo">
      <span class="app-name">LINKDING</span>
    </a>
    <nav>
      ${opts?.anonymous
        ? `<a href="/login" class="btn btn-link">Login</a>`
        : navMenu(opts?.profile, opts?.activeNav)}
    </nav>
  </div>
</header>
<div class="content container">
${bodyHtml}
</div>
<div class="modals"></div>
</body>
</html>`;
}
