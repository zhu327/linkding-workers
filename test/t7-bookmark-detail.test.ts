/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index.js";
import { createSession } from "../src/web/auth.js";
import { issueCsrf } from "../src/web/csrf.js";
import type { Env } from "../src/env.js";
import { bookmarkDetailPage } from "../src/web/views/bookmark-detail.js";
import { bookmarksListPage } from "../src/web/views/bookmarks.js";
import type { BookmarkRow, UserProfileRow, TagRow } from "../src/db/schema.js";
import { setupTestDb } from "./helpers/migrations.js";

// ── Helpers ────────────────────────────────────────────────────────────

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeBookmark(overrides: Partial<BookmarkRow> = {}): BookmarkRow {
  return {
    id: 1,
    url: "https://example.com",
    url_normalized: "https://example.com",
    title: "Test Bookmark",
    description: "A test description",
    notes: "Some **bold** notes",
    web_archive_snapshot_url: "",
    favicon_url: "",
    preview_image_url: "",
    unread: 0,
    is_archived: 0,
    shared: 0,
    date_added: "2024-01-01T00:00:00Z",
    date_modified: "2024-06-15T12:00:00Z",
    date_accessed: null,
    ...overrides,
  };
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

async function fetchUrl(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string | FormData; redirect?: string }) {
  const request = new Request(`http://localhost${path}`, {
    method: opts?.method,
    headers: opts?.headers,
    body: opts?.body as any,
    redirect: (opts?.redirect as any) || "manual",
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env as any, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function getSession(): Promise<string> {
  return createSession(env as unknown as Env);
}

// ═══════════════════════════════════════════════════════════════════════
// View unit tests: bookmarkDetailPage
// ═══════════════════════════════════════════════════════════════════════

describe("bookmarkDetailPage — rendering", () => {
  it("renders title", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ title: "My Great Bookmark" }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain("My Great Bookmark");
  });

  it("renders URL as clickable link", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ url: "https://example.com/page" }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain('href="https://example.com/page"');
  });

  it("renders description", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ description: "This is a description" }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain("This is a description");
  });

  it("renders notes as Markdown (**bold** → <strong>)", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ notes: "**bold** text" }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders tags", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark(),
      tagNames: ["javascript", "typescript"],
      profile: makeProfile(),
    });
    expect(html).toContain("javascript");
    expect(html).toContain("typescript");
  });

  it("renders date_added", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ date_added: "2024-01-01T00:00:00Z" }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain("2024");
  });

  it("renders archive status", () => {
    const htmlArchived = bookmarkDetailPage({
      bookmark: makeBookmark({ is_archived: 1 }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(htmlArchived.toLowerCase()).toContain("archived");

    const htmlActive = bookmarkDetailPage({
      bookmark: makeBookmark({ is_archived: 0 }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(htmlActive.toLowerCase()).toContain("active");
  });

  it("has Back to list link", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark(),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toMatch(/href="\/bookmarks"/);
  });
});

describe("bookmarkDetailPage — action buttons", () => {
  it("shows Edit button linking to /bookmarks/:id/edit when authenticated", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ id: 42 }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain('href="/bookmarks/42/edit"');
  });

  it("shows Delete button when authenticated", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark(),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).toContain("Delete");
  });

  it("shows Archive/Unarchive button when authenticated", () => {
    const htmlNotArchived = bookmarkDetailPage({
      bookmark: makeBookmark({ is_archived: 0 }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(htmlNotArchived).toContain("Archive");

    const htmlArchived = bookmarkDetailPage({
      bookmark: makeBookmark({ is_archived: 1 }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(htmlArchived).toContain("Unarchive");
  });

  it("hides Edit/Delete/Archive buttons when anonymous", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark(),
      tagNames: [],
      profile: makeProfile(),
      anonymous: true,
    });
    expect(html).not.toContain("/edit");
    expect(html).not.toContain("Delete");
    expect(html).not.toContain("Archive");
    expect(html).not.toContain("Unarchive");
  });
});

describe("bookmarkDetailPage — XSS safety", () => {
  it("escapes <script> in notes", () => {
    const html = bookmarkDetailPage({
      bookmark: makeBookmark({ notes: '<script>alert("xss")</script>' }),
      tagNames: [],
      profile: makeProfile(),
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// View unit tests: list page notes rendering
// ═══════════════════════════════════════════════════════════════════════

describe("List page — notes rendering", () => {
  const defaultProfile = makeProfile();

  function listWithNotes(notes: string): string {
    return bookmarksListPage({
      bookmarks: [{
        row: makeBookmark({ id: 1, notes }),
        tagNames: [],
      }],
      count: 1, q: "", sort: "added_desc", offset: 0, limit: 30,
      allTags: [], selectedTag: "", unread: "", shared: "",
      profile: defaultProfile, page: "bookmarks",
    });
  }

  it("renders notes inline with Markdown", () => {
    const html = listWithNotes("**bold** text");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("escapes <script> in notes", () => {
    const html = listWithNotes('<script>alert(1)</script>');
    // The raw <script>alert(1)</script> must not appear unescaped in notes
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("truncates long notes to ~300 chars before rendering", () => {
    const longNotes = "A".repeat(500);
    const html = listWithNotes(longNotes);
    // 500 raw A's should not appear in output
    expect(html).not.toContain("A".repeat(500));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Route tests: GET /bookmarks/:id
// ═══════════════════════════════════════════════════════════════════════

describe("Route: GET /bookmarks/:id", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("authenticated GET returns 200 with detail page", async () => {
    await cleanTables();
    await env.DB.prepare(
      "INSERT INTO bookmarks (id, url, url_normalized, title, description, notes, date_added, date_modified) VALUES (1, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      "https://detail-test.com", "https://detail-test.com",
      "Detail Test", "Desc", "**bold** notes",
      "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z",
    ).run();

    const session = await getSession();
    const res = await fetchUrl("/bookmarks/1", {
      headers: { Cookie: `ld_session=${session}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Detail Test");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("non-existent bookmark redirects to /bookmarks", async () => {
    const session = await getSession();
    const res = await fetchUrl("/bookmarks/99999", {
      headers: { Cookie: `ld_session=${session}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks");
  });

  it("anonymous GET redirects to /login", async () => {
    const res = await fetchUrl("/bookmarks/1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});
