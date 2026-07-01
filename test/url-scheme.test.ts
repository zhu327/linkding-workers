/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { app } from "../src/index.js";
import { isAllowedScheme, safeHref } from "../src/utils/html.js";
import { InvalidUrlSchemeError } from "../src/services/bookmarks.js";
import { bookmarksListPage } from "../src/web/views/bookmarks.js";
import { bookmarkDetailPage } from "../src/web/views/bookmark-detail.js";
import { parseNetscape } from "../src/services/netscape.js";
import type { UserProfileRow, BookmarkRow } from "../src/db/schema.js";
import { createSession } from "../src/web/auth.js";
import { issueCsrf, CSRF_COOKIE_NAME } from "../src/web/csrf.js";
import type { Env } from "../src/env.js";
import { setupTestDb } from "./helpers/migrations.js";

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
}

async function apiReq(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) {
  const mergedHeaders = { Authorization: "Token test-token-123", ...opts?.headers };
  const request = new Request(`http://localhost${path}`, {
    method: opts?.method,
    headers: mergedHeaders,
    body: opts?.body,
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function webReq(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string | FormData; redirect?: string }) {
  const request = new Request(`http://localhost${path}`, {
    method: opts?.method,
    headers: opts?.headers,
    body: opts?.body as any,
    redirect: (opts?.redirect as any) || "manual",
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

function makeProfile(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: 1,
    theme: "auto",
    bookmark_date_display: "relative",
    bookmark_link_target: "_blank",
    web_archive_integration: "disabled",
    tag_search: "strict",
    enable_sharing: 0,
    enable_public_sharing: 0,
    enable_favicons: 1,
    display_url: 0,
    permanent_notes: 0,
    search_preferences: "{}",
    auto_tagging_rules: "",
    items_per_page: 30,
    legacy_search: 0,
    custom_css: "",
    default_mark_unread: 0,
    default_mark_shared: 0,
    ...overrides,
  };
}

// ── isAllowedScheme unit tests ──────────────────────────────────────

describe("isAllowedScheme", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("rejects javascript: scheme", () => {
    expect(isAllowedScheme("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: scheme", () => {
    expect(isAllowedScheme("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects vbscript: scheme", () => {
    expect(isAllowedScheme("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects file: scheme", () => {
    expect(isAllowedScheme("file:///etc/passwd")).toBe(false);
  });

  it("accepts http: scheme", () => {
    expect(isAllowedScheme("http://example.com")).toBe(true);
  });

  it("accepts https: scheme", () => {
    expect(isAllowedScheme("https://example.com")).toBe(true);
  });

  it("accepts ftp: scheme", () => {
    expect(isAllowedScheme("ftp://example.com")).toBe(true);
  });

  it("rejects malformed URLs", () => {
    expect(isAllowedScheme("not a url")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAllowedScheme("")).toBe(false);
  });
});

// ── safeHref unit tests ─────────────────────────────────────────────

describe("safeHref", () => {
  it("returns the URL unchanged for http", () => {
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });

  it("returns the URL unchanged for https", () => {
    expect(safeHref("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  });

  it("returns the URL unchanged for ftp", () => {
    expect(safeHref("ftp://files.example.com")).toBe("ftp://files.example.com");
  });

  it("returns empty string for javascript:", () => {
    expect(safeHref("javascript:alert(1)")).toBe("");
  });

  it("returns empty string for data:", () => {
    expect(safeHref("data:text/html,<script>")).toBe("");
  });

  it("returns empty string for vbscript:", () => {
    expect(safeHref("vbscript:x")).toBe("");
  });

  it("returns empty string for file:", () => {
    expect(safeHref("file:///etc/passwd")).toBe("");
  });

  it("returns empty string for malformed URL", () => {
    expect(safeHref("not-a-url")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(safeHref("")).toBe("");
  });
});

// ── createBookmark service — scheme validation ─────────────────────

describe("createBookmark — URL scheme validation", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("throws InvalidUrlSchemeError for javascript: URL", async () => {
    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "javascript:alert(1)", title: "XSS" }),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.url).toBeDefined();
    expect(body.url[0]).toContain("scheme");
  });

  it("throws InvalidUrlSchemeError for data: URL", async () => {
    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "data:text/html,<script>", title: "XSS" }),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.url).toBeDefined();
  });

  it("succeeds for http:// URL", async () => {
    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://example.com", title: "OK" }),
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.url).toBe("http://example.com");
  });

  it("succeeds for https:// URL", async () => {
    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://secure.example.com", title: "OK" }),
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.url).toBe("https://secure.example.com");
  });

  it("succeeds for ftp:// URL", async () => {
    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ftp://files.example.com", title: "OK" }),
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.url).toBe("ftp://files.example.com");
  });
});

// ── API handler — InvalidUrlSchemeError → 400 ──────────────────────

describe("API POST /api/bookmarks — rejects unsafe URL schemes", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("POST with javascript: URL → 400 with url field error", async () => {
    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.url).toBeDefined();
    expect(Array.isArray(body.url)).toBe(true);
    expect(body.url[0]).toContain("scheme");
  });

  it("PATCH with javascript: URL → 400", async () => {
    // Create a safe bookmark first
    const createRes = await apiReq("/api/bookmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://patch-safe.com", title: "Safe" }),
    });
    const created: any = await createRes.json();
    // PATCH with a bad URL
    const patchRes = await apiReq(`/api/bookmarks/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "javascript:alert(1)" }),
    });
    expect(patchRes.status).toBe(400);
    const body: any = await patchRes.json();
    expect(body.url).toBeDefined();
  });
});

// ── Netscape import — unsafe scheme skip ───────────────────────────

describe("Netscape import — skip unsafe schemes", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("imports safe bookmarks and skips javascript: entries", async () => {
    const session = await createSession(env as unknown as Env);
    const csrfToken = await issueCsrf((env as unknown as Env).SESSION_SECRET || "default-secret");

    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
<DT><A HREF="javascript:alert(1)" ADD_DATE="1704067200" TAGS="bad">Bad Entry</A>
<DT><A HREF="https://example.com" ADD_DATE="1704067200" TAGS="web">Example</A>
<DT><A HREF="https://another.com" ADD_DATE="1704067200">Another</A>
</DL><p>`;

    const form = new FormData();
    const blob = new Blob([html], { type: "text/html" });
    form.append("file", blob, "bookmarks.html");
    form.append("_csrf", csrfToken);

    const res = await webReq("/settings/import", {
      method: "POST",
      headers: { Cookie: `ld_session=${session}; ${CSRF_COOKIE_NAME}=${csrfToken}` },
      body: form as any,
      redirect: "manual",
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    // Flash message should indicate 2 imported and 1 skipped
    expect(body).toContain("2");
    expect(body).toContain("skipped");

    // Count bookmarks in DB — should have exactly 2 (javascript: skipped)
    const rows = await env.DB.prepare("SELECT * FROM bookmarks").all<BookmarkRow>();
    expect(rows.results).toHaveLength(2);
    const urls = rows.results.map((r) => r.url).sort();
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("https://another.com");
    expect(urls).not.toContain("javascript:alert(1)");
  });
});

// ── View rendering — safeHref for list view ───────────────────────

describe("View rendering — safeHref prevents executable href", () => {
  it("list view renders javascript: URL with empty href (no executable link)", () => {
    const profile = makeProfile({ enable_sharing: 1, enable_public_sharing: 1 });
    const html = bookmarksListPage({
      bookmarks: [{
        row: {
          id: 1, url: "javascript:alert(1)", url_normalized: "",
          title: "Bad Bookmark", description: "", notes: "", web_archive_snapshot_url: "",
          favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0,
          shared: 1, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z",
          date_accessed: null,
        },
        tagNames: [],
      }],
      count: 1, q: "", sort: "added_desc", offset: 0, limit: 30,
      allTags: [], selectedTag: "", unread: "", shared: "",
      profile, page: "shared", anonymous: true,
      bundles: [], selectedBundleId: 0,
    });

    // Must NOT contain an executable href="javascript:..."
    expect(html).not.toMatch(/href="javascript:/i);
    // Must NOT contain href="data:
    expect(html).not.toMatch(/href="data:/i);
    // Should still show the URL text (escaped) so user can see what was stored
    expect(html).toContain("javascript:alert(1)");
  });

  it("list view renders https:// URL as normal clickable link", () => {
    const profile = makeProfile({ enable_sharing: 1, enable_public_sharing: 1 });
    const html = bookmarksListPage({
      bookmarks: [{
        row: {
          id: 2, url: "https://example.com", url_normalized: "https://example.com",
          title: "Safe Bookmark", description: "", notes: "", web_archive_snapshot_url: "",
          favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0,
          shared: 1, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z",
          date_accessed: null,
        },
        tagNames: [],
      }],
      count: 1, q: "", sort: "added_desc", offset: 0, limit: 30,
      allTags: [], selectedTag: "", unread: "", shared: "",
      profile, page: "shared", anonymous: true,
      bundles: [], selectedBundleId: 0,
    });

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("Safe Bookmark");
  });

  it("list view renders ftp:// URL as normal clickable link", () => {
    const profile = makeProfile({ enable_sharing: 1, enable_public_sharing: 1 });
    const html = bookmarksListPage({
      bookmarks: [{
        row: {
          id: 3, url: "ftp://files.example.com", url_normalized: "",
          title: "FTP Bookmark", description: "", notes: "", web_archive_snapshot_url: "",
          favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0,
          shared: 1, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z",
          date_accessed: null,
        },
        tagNames: [],
      }],
      count: 1, q: "", sort: "added_desc", offset: 0, limit: 30,
      allTags: [], selectedTag: "", unread: "", shared: "",
      profile, page: "shared", anonymous: true,
      bundles: [], selectedBundleId: 0,
    });

    expect(html).toContain('href="ftp://files.example.com"');
  });

  it("detail view renders javascript: URL with empty href (no executable link)", () => {
    const profile = makeProfile();
    const html = bookmarkDetailPage({
      bookmark: {
        id: 1, url: "javascript:alert(1)", url_normalized: "",
        title: "Bad Detail", description: "", notes: "", web_archive_snapshot_url: "",
        favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0,
        shared: 0, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z",
        date_accessed: null,
      },
      tagNames: [],
      profile,
    });

    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain("javascript:alert(1)");
  });

  it("detail view renders https:// URL as normal clickable link", () => {
    const profile = makeProfile();
    const html = bookmarkDetailPage({
      bookmark: {
        id: 2, url: "https://example.com", url_normalized: "https://example.com",
        title: "Safe Detail", description: "", notes: "", web_archive_snapshot_url: "",
        favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0,
        shared: 0, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z",
        date_accessed: null,
      },
      tagNames: [],
      profile,
    });

    expect(html).toContain('href="https://example.com"');
  });

  it("anonymous shared page renders pre-existing javascript: bookmark without executable href", async () => {
    await setupTestDb(env.DB);
    await cleanTables();

    // Enable public sharing
    await env.DB.prepare("UPDATE user_profile SET enable_sharing=1, enable_public_sharing=1 WHERE id=1").run();

    // Seed a malicious bookmark directly (simulating pre-existing data)
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, shared, date_added, date_modified) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind("javascript:alert(1)", "", "XSS Bookmark", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();

    // Also seed a safe bookmark
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, shared, date_added, date_modified) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind("https://safe.com", "https://safe.com", "Safe Bookmark", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();

    const res = await webReq("/bookmarks/shared");
    expect(res.status).toBe(200);
    const html = await res.text();

    // javascript: bookmark text is visible but href is never executable
    expect(html).toContain("javascript:alert(1)");
    expect(html).not.toMatch(/href="javascript:/i);

    // Safe bookmark renders normally
    expect(html).toContain('href="https://safe.com"');
  });
});
