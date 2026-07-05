/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

async function fetchUrl(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string | FormData; redirect?: string }) {
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

// Generate a CSRF token matching the test SESSION_SECRET for /login form submissions.
async function testCsrfToken(): Promise<string> {
  const { issueCsrf } = await import("../src/web/csrf.js");
  return issueCsrf("test-session-secret-for-testing-only");
}

describe("Web UI — Auth", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
    // Set a known password hash (SHA-256 of "testpass")
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("testpass"));
    const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
    await env.DB.prepare("UPDATE user_profile SET theme='auto' WHERE id=1").run();
    // We can't set APP_PASSWORD_HASH via DB — it's an env var. The verifyPassword falls back to SHA-256 comparison.
    // For tests, we'll test that unauthenticated requests redirect.
  });

  it("GET /login renders login form", async () => {
    const res = await fetchUrl("/login");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("LINKDING");
    expect(html).toContain('type="password"');
  });

  it("GET /bookmarks redirects to /login when unauthenticated", async () => {
    const res = await fetchUrl("/bookmarks");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("GET / redirects to /bookmarks", async () => {
    const res = await fetchUrl("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks");
  });

  it("POST /login with correct password → 302 + Set-Cookie", async () => {
    const form = new FormData();
    form.append("password", "testpass");
    form.append("_csrf", await testCsrfToken());
    const res = await fetchUrl("/login", {
      method: "POST",
      body: form as any,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks");
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("ld_session=");
  });

  it("POST /login with wrong password → 401", async () => {
    const form = new FormData();
    form.append("password", "wrongpass");
    form.append("_csrf", await testCsrfToken());
    const res = await fetchUrl("/login", {
      method: "POST",
      body: form as any,
      redirect: "manual",
    });
    expect(res.status).toBe(401);
  });

  it("authenticated GET /bookmarks returns 200", async () => {
    // First login to get session cookie
    const form = new FormData();
    form.append("password", "testpass");
    form.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", {
      method: "POST",
      body: form as any,
      redirect: "manual",
    });
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(/ld_session=([^;]+)/);
    const session = sessionMatch ? sessionMatch[1] : "";

    // Access bookmarks with session cookie
    const res = await fetchUrl("/bookmarks", {
      headers: { Cookie: `ld_session=${session}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bookmarks");
  });
});

describe("Web UI — CSRF Protection", () => {
  it("POST /settings without CSRF token → 403", async () => {
    // Login first
    const form = new FormData();
    form.append("password", "testpass");
    form.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", {
      method: "POST",
      body: form as any,
      redirect: "manual",
    });
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(/ld_session=([^;]+)/);
    const session = sessionMatch ? sessionMatch[1] : "";

    // Try to update settings without CSRF token
    const settingsForm = new FormData();
    settingsForm.append("theme", "dark");

    const res = await fetchUrl("/settings", {
      method: "POST",
      headers: { Cookie: `ld_session=${session}` },
      body: settingsForm as any,
      redirect: "manual",
    });
    expect(res.status).toBe(403);
  });

  it("POST /bookmarks without CSRF token still succeeds (CSRF not required)", async () => {
    // Login first
    const form = new FormData();
    form.append("password", "testpass");
    form.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", {
      method: "POST",
      body: form as any,
      redirect: "manual",
    });
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sessionMatch = setCookie.match(/ld_session=([^;]+)/);
    const session = sessionMatch ? sessionMatch[1] : "";

    // POST /bookmarks without CSRF — should NOT be 403
    const bookmarkForm = new FormData();
    bookmarkForm.append("url", "https://csrf-test.com");
    bookmarkForm.append("title", "CSRF Test");

    const res = await fetchUrl("/bookmarks", {
      method: "POST",
      headers: { Cookie: `ld_session=${session}` },
      body: bookmarkForm as any,
      redirect: "manual",
    });
    expect(res.status).not.toBe(403);
  });
});

// ── T1: Bookmark form honors default_mark_unread / default_mark_shared ──

describe("Bookmark form — default pre-check from profile", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("GET /bookmarks/new with default_mark_unread=1 renders checked unread checkbox", async () => {
    // Login first
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    const session = m ? m[1] : "";

    // Set default_mark_unread=1
    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=1, default_mark_shared=0 WHERE id=1").run();

    const res = await fetchUrl("/bookmarks/new", { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Unread checkbox should be checked
    expect(html).toMatch(/name="unread"[^>]*checked/);
    // Shared checkbox should NOT be checked
    expect(html).not.toMatch(/name="shared"[^>]*checked/);
  });

  it("GET /bookmarks/new with default_mark_shared=1 renders checked shared checkbox", async () => {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    const session = m ? m[1] : "";

    // Set default_mark_shared=1, default_mark_unread=0, enable sharing so the checkbox renders
    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=0, default_mark_shared=1, enable_sharing=1 WHERE id=1").run();

    const res = await fetchUrl("/bookmarks/new", { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Shared checkbox should be checked
    expect(html).toMatch(/name="shared"[^>]*checked/);
    // Unread checkbox should NOT be checked
    expect(html).not.toMatch(/name="unread"[^>]*checked/);
  });

  it("GET /bookmarks/new with both defaults=0 renders no checked checkboxes", async () => {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    const session = m ? m[1] : "";

    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=0, default_mark_shared=0 WHERE id=1").run();

    const res = await fetchUrl("/bookmarks/new", { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toMatch(/name="unread"[^>]*checked/);
    expect(html).not.toMatch(/name="shared"[^>]*checked/);
  });

  it("edit form uses bookmark.unread/bookmark.shared (not profile defaults)", async () => {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    const session = m ? m[1] : "";

    // Create a bookmark with unread=0, shared=0
    const createForm = new FormData();
    createForm.append("url", "https://edit-precheck.com");
    createForm.append("title", "Edit Precheck");
    await fetchUrl("/bookmarks", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: createForm as any, redirect: "manual" });

    const bm: any = await env.DB.prepare("SELECT * FROM bookmarks WHERE url='https://edit-precheck.com'").first();

    // Set profile defaults to 1 — edit form should NOT use them
    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=1, default_mark_shared=1 WHERE id=1").run();

    const res = await fetchUrl(`/bookmarks/${bm.id}/edit`, { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    // Edit form reflects bookmark state (both 0), not profile defaults (both 1)
    expect(html).not.toMatch(/name="unread"[^>]*checked/);
    expect(html).not.toMatch(/name="shared"[^>]*checked/);
  });
});

describe("Bookmark form — create honors profile defaults", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  async function loginAndGetSession(): Promise<string> {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    return m ? m[1] : "";
  }

  it("default_mark_unread=1 creates bookmark with unread=1 when checkbox left checked", async () => {
    const session = await loginAndGetSession();
    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=1, default_mark_shared=0 WHERE id=1").run();

    const form = new FormData();
    form.append("url", "https://test-unread-1.com");
    form.append("title", "Unread 1");
    form.append("unread", "1"); // checkbox checked (as rendered by form)

    await fetchUrl("/bookmarks", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: form as any, redirect: "manual" });

    const row: any = await env.DB.prepare("SELECT unread FROM bookmarks WHERE url='https://test-unread-1.com'").first();
    expect(row.unread).toBe(1);
  });

  it("default_mark_unread=1 creates bookmark with unread=0 when checkbox unchecked", async () => {
    const session = await loginAndGetSession();
    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=1, default_mark_shared=0 WHERE id=1").run();

    const form = new FormData();
    form.append("url", "https://test-unread-0.com");
    form.append("title", "Unread 0");
    // Do NOT append "unread" — simulating an unchecked checkbox

    await fetchUrl("/bookmarks", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: form as any, redirect: "manual" });

    const row: any = await env.DB.prepare("SELECT unread FROM bookmarks WHERE url='https://test-unread-0.com'").first();
    expect(row.unread).toBe(0);
  });

  it("default_mark_shared=1 creates bookmark with shared=1 when checkbox left checked", async () => {
    const session = await loginAndGetSession();
    await env.DB.prepare("UPDATE user_profile SET default_mark_unread=0, default_mark_shared=1 WHERE id=1").run();

    const form = new FormData();
    form.append("url", "https://test-shared-1.com");
    form.append("title", "Shared 1");
    form.append("shared", "1");

    await fetchUrl("/bookmarks", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: form as any, redirect: "manual" });

    const row: any = await env.DB.prepare("SELECT shared FROM bookmarks WHERE url='https://test-shared-1.com'").first();
    expect(row.shared).toBe(1);
  });
});

describe("Web edit — auto-tagging", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  async function loginAndGetSession(): Promise<string> {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    return m ? m[1] : "";
  }

  async function getBookmarkTags(db: D1Database, bookmarkId: number): Promise<string[]> {
    const rows = await db
      .prepare("SELECT t.name FROM tags t INNER JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = ? ORDER BY t.name")
      .bind(bookmarkId)
      .all<{ name: string }>();
    return rows.results.map((r) => r.name);
  }

  it("POST /bookmarks/:id with auto_tagging_rules matching URL merges auto-tags with user tags", async () => {
    const session = await loginAndGetSession();

    // Enable auto-tagging rules for github.com
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules='github.com dev code' WHERE id=1").run();

    // Create a bookmark with matching URL
    const createForm = new FormData();
    createForm.append("url", "https://github.com/test/repo");
    createForm.append("title", "Test Repo");
    createForm.append("tag_names", "userTag");
    await fetchUrl("/bookmarks", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: createForm as any, redirect: "manual" });

    const bm: any = await env.DB.prepare("SELECT * FROM bookmarks WHERE url='https://github.com/test/repo'").first();

    // Edit the bookmark — provide new user tag
    const editForm = new FormData();
    editForm.append("url", "https://github.com/test/repo");
    editForm.append("title", "Updated Repo");
    editForm.append("tag_names", "newUserTag");
    await fetchUrl(`/bookmarks/${bm.id}`, { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: editForm as any, redirect: "manual" });

    const tags = await getBookmarkTags(env.DB, bm.id);
    expect(tags).toContain("newUserTag");
    expect(tags).toContain("dev");
    expect(tags).toContain("code");
  });
});

describe("Web UI — Manifest & OpenSearch (T12)", () => {
  it("GET /manifest.json returns valid PWA manifest", async () => {
    const res = await fetchUrl("/manifest.json");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe("linkding");
    expect(body.start_url).toBe("/bookmarks");
    expect(body.display).toBe("standalone");
  });

  it("GET /opensearch.xml returns valid OpenSearch descriptor", async () => {
    const res = await fetchUrl("/opensearch.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("opensearchdescription");
    const xml = await res.text();
    expect(xml).toContain("OpenSearchDescription");
    expect(xml).toContain("/bookmarks?q=");
  });

  it("GET /custom_css returns text/css", async () => {
    const res = await fetchUrl("/custom_css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css");
  });
});

describe("Netscape import/export (T11)", () => {
  it("parseNetscape extracts bookmarks correctly", async () => {
    const { parseNetscape } = await import("../src/services/netscape.js");
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
<DT><A HREF="https://example.com" ADD_DATE="1704067200" LAST_MODIFIED="1704067200" PRIVATE="0" TOREAD="1" TAGS="web,test">Example</A>
<DD>A description[linkding-notes]Some notes[/linkding-notes]
<DT><A HREF="https://archived.com" ADD_DATE="1704067200" TAGS="linkding:bookmarks.archived,old">Archived Site</A>
</DL><p>`;
    const bookmarks = parseNetscape(html);
    expect(bookmarks).toHaveLength(2);

    expect(bookmarks[0].href).toBe("https://example.com");
    expect(bookmarks[0].title).toBe("Example");
    expect(bookmarks[0].description).toBe("A description");
    expect(bookmarks[0].notes).toBe("Some notes");
    expect(bookmarks[0].tagNames).toEqual(["web", "test"]);
    expect(bookmarks[0].toRead).toBe(true);
    expect(bookmarks[0].archived).toBe(false);

    expect(bookmarks[1].title).toBe("Archived Site");
    expect(bookmarks[1].archived).toBe(true);
    expect(bookmarks[1].tagNames).toEqual(["old"]); // linkding:bookmarks.archived removed
  });

  it("exportNetscapeHtml generates valid HTML with round-trip support", async () => {
    const { exportNetscapeHtml, parseNetscape } = await import("../src/services/netscape.js");
    const bookmarks = [{
      url: "https://round-trip.com", title: "Round Trip", description: "Desc", notes: "My notes",
      tagNames: ["tag1", "tag2"], isArchived: true, unread: true, shared: false,
      dateAdded: "2024-01-01T00:00:00Z", dateModified: "2024-06-01T00:00:00Z",
    }];
    const html = exportNetscapeHtml(bookmarks);
    expect(html).toContain("NETSCAPE-Bookmark-file-1");
    expect(html).toContain("https://round-trip.com");
    expect(html).toContain("Round Trip");
    expect(html).toContain("[linkding-notes]My notes[/linkding-notes]");
    expect(html).toContain("linkding:bookmarks.archived");
    expect(html).toContain('TOREAD="1"');
    expect(html).toContain('PRIVATE="1"');

    // Round-trip
    const reparsed = parseNetscape(html);
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].href).toBe("https://round-trip.com");
    expect(reparsed[0].title).toBe("Round Trip");
    expect(reparsed[0].notes).toBe("My notes");
    expect(reparsed[0].archived).toBe(true);
    expect(reparsed[0].toRead).toBe(true);
    expect(reparsed[0].tagNames).toContain("tag1");
    expect(reparsed[0].tagNames).toContain("tag2");
  });
});

describe("RSS Feeds (T12)", () => {
  it("buildAtomFeed generates valid Atom XML", async () => {
    const { buildAtomFeed } = await import("../src/services/feeds.js");
    const bookmarks: any[] = [
      { id: 1, url: "https://example.com", url_normalized: "", title: "Test", description: "Desc", notes: "", web_archive_snapshot_url: "", favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0, shared: 0, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z", date_accessed: null },
    ];
    const xml = buildAtomFeed(bookmarks, { title: "Test Feed", selfUrl: "http://localhost/feeds/abc/all", siteUrl: "http://localhost" });
    expect(xml).toContain("<?xml");
    expect(xml).toContain("<feed xmlns");
    expect(xml).toContain("<entry>");
    expect(xml).toContain("https://example.com");
    expect(xml).toContain("<title>Test</title>");
  });

  it("feed endpoint returns 404 for invalid key", async () => {
    const res = await fetchUrl("/feeds/invalid-key/all");
    expect(res.status).toBe(404);
  });

  it("settings page shows feed URLs for an existing token", async () => {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const session = (loginRes.headers.get("set-cookie") || "").match(/ld_session=([^;]+)/)?.[1] || "";
    await env.DB.prepare("INSERT OR REPLACE INTO feed_tokens (key, created) VALUES ('settings-feed-key', '2024-01-01T00:00:00Z')").run();
    const res = await fetchUrl("/settings", { headers: { Cookie: `ld_session=${session}` } });
    const html = await res.text();
    expect(html).toContain("http://localhost/feeds/settings-feed-key/all");
    expect(html).toContain("http://localhost/feeds/settings-feed-key/unread");
    expect(html).toContain("http://localhost/feeds/settings-feed-key/shared");
  });

  it("feed endpoint returns Atom XML for valid key", async () => {
    // Seed a feed token
    await env.DB.prepare("INSERT OR REPLACE INTO feed_tokens (key, created) VALUES ('valid-feed-key', '2024-01-01T00:00:00Z')").run();
    // Seed a bookmark
    await env.DB.prepare("INSERT INTO bookmarks (url, url_normalized, title, date_added, date_modified) VALUES (?, ?, ?, ?, ?)").bind("https://feed-test.com", "https://feed-test.com", "Feed Test", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();

    const res = await fetchUrl("/feeds/valid-feed-key/all");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("atom+xml");
    const xml = await res.text();
    expect(xml).toContain("Feed Test");
    expect(xml).toContain("https://feed-test.com");
  });
});

describe("Bookmarklet (T13)", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  async function loginAndGetSession(): Promise<string> {
    const loginForm = new FormData();
    loginForm.append("password", "testpass");
    loginForm.append("_csrf", await testCsrfToken());
    const loginRes = await fetchUrl("/login", { method: "POST", body: loginForm as any, redirect: "manual" });
    const cookie = loginRes.headers.get("set-cookie") || "";
    const m = cookie.match(/ld_session=([^;]+)/);
    return m ? m[1] : "";
  }

  it("GET /settings renders bookmarklet section with javascript: link", async () => {
    const session = await loginAndGetSession();
    const res = await fetchUrl("/settings", { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bookmarklet");
    expect(html).toContain('id="bookmarklet-server"');
    expect(html).toContain('id="bookmarklet-client"');
    // The bookmarklet href should be a javascript: URL pointing at /bookmarks/new
    expect(html).toMatch(/href="javascript:\(function\(\)\{[^}]*\/bookmarks\/new/);
    // Client-side bookmarklet selectors contain double quotes; they must be HTML-escaped in href.
    expect(html).toContain('meta[property=&quot;og:title&quot;]');
  });

  it("GET /bookmarks/new?url=...&title=...&auto_close pre-fills form and renders auto_close field", async () => {
    const session = await loginAndGetSession();
    const params = new URLSearchParams({ url: "https://example.com/pre-fill", title: "Pre-filled", description: "Desc", tags: "tag1 tag2" });
    params.set("auto_close", "");
    const res = await fetchUrl(`/bookmarks/new?${params.toString()}`, { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("https://example.com/pre-fill");
    expect(html).toContain("Pre-filled");
    expect(html).toContain("Desc");
    expect(html).toContain("tag1 tag2");
    expect(html).toMatch(/name="auto_close"\s+value="1"/);
  });

  it("GET /bookmarks/check returns metadata and auto-tags for the web form", async () => {
    vi.stubGlobal("fetch", async () => new Response(`<html><head>
      <title>Checked Title</title>
      <meta name="description" content="Checked Description">
    </head><body></body></html>`, { status: 200 }));
    try {
      const session = await loginAndGetSession();
      await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind("metadata.example checked").run();
      const res = await fetchUrl("/bookmarks/check?url=https%3A%2F%2Fmetadata.example%2Fpage", { headers: { Cookie: `ld_session=${session}` } });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.metadata.title).toBe("Checked Title");
      expect(body.metadata.description).toBe("Checked Description");
      expect(body.auto_tags).toContain("checked");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("GET /bookmarks/new?url=... fetches metadata when title/description are absent", async () => {
    vi.stubGlobal("fetch", async () => new Response(`<html><head>
      <title>Fetched Title</title>
      <meta name="description" content="Fetched Description">
      <meta property="og:image" content="https://metadata.example/preview.png">
    </head><body></body></html>`, { status: 200 }));
    try {
      const session = await loginAndGetSession();
      const params = new URLSearchParams({ url: "https://metadata.example/page" });
      const res = await fetchUrl(`/bookmarks/new?${params.toString()}`, { headers: { Cookie: `ld_session=${session}` } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Fetched Title");
      expect(html).toContain("Fetched Description");
      expect(html).toContain('name="preview_image_url" value="https://metadata.example/preview.png"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("POST /bookmarks with auto_close=1 redirects to /bookmarks/close and persists preview image", async () => {
    const session = await loginAndGetSession();
    const form = new FormData();
    form.append("url", "https://auto-close-test.com");
    form.append("title", "Auto Close");
    form.append("preview_image_url", "https://auto-close-test.com/preview.png");
    form.append("auto_close", "1");
    form.append("_csrf", await testCsrfToken());
    const res = await fetchUrl("/bookmarks", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: form as any, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks/close");
    // Bookmark should have been created
    const row: any = await env.DB.prepare("SELECT title, preview_image_url FROM bookmarks WHERE url='https://auto-close-test.com'").first();
    expect(row?.title).toBe("Auto Close");
    expect(row?.preview_image_url).toBe("https://auto-close-test.com/preview.png");
  });

  it("GET /bookmarks/close returns HTML that calls window.close()", async () => {
    const session = await loginAndGetSession();
    const res = await fetchUrl("/bookmarks/close", { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("window.close()");
  });

  it("GET /bookmarks persists search preferences", async () => {
    const session = await loginAndGetSession();
    const res = await fetchUrl("/bookmarks?sort=title_asc&unread=yes&shared=no", { headers: { Cookie: `ld_session=${session}` } });
    expect(res.status).toBe(200);
    const row: any = await env.DB.prepare("SELECT search_preferences FROM user_profile WHERE id=1").first();
    expect(JSON.parse(row.search_preferences)).toEqual({ sort: "title_asc", unread: "yes", shared: "no" });
  });

  it("POST /settings/search-preferences/clear clears saved search preferences", async () => {
    const session = await loginAndGetSession();
    await env.DB.prepare("UPDATE user_profile SET search_preferences=? WHERE id=1").bind(JSON.stringify({ sort: "title_asc" })).run();
    const form = new FormData();
    form.append("_csrf", await testCsrfToken());
    const res = await fetchUrl("/settings/search-preferences/clear", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: form as any, redirect: "manual" });
    expect(res.status).toBe(302);
    const row: any = await env.DB.prepare("SELECT search_preferences FROM user_profile WHERE id=1").first();
    expect(row.search_preferences).toBe("{}");
  });

  it("POST /settings saves bookmark display preferences", async () => {
    const session = await loginAndGetSession();
    const form = new FormData();
    form.append("_csrf", await testCsrfToken());
    form.append("theme", "auto");
    form.append("items_per_page", "30");
    form.append("bookmark_link_target", "_self");
    form.append("bookmark_date_display", "hidden");
    form.append("display_url", "1");
    form.append("permanent_notes", "1");
    form.append("enable_preview_images", "1");
    form.append("bookmark_description_display", "hidden");
    form.append("bookmark_description_max_lines", "5");
    form.append("collapse_side_panel", "1");
    form.append("enable_favicons", "1");
    form.append("tag_search", "strict");
    form.append("tag_grouping", "prefix");
    form.append("web_archive_integration", "disabled");
    const res = await fetchUrl("/settings", { method: "POST", headers: { Cookie: `ld_session=${session}` }, body: form as any, redirect: "manual" });
    expect(res.status).toBe(302);
    const row: any = await env.DB.prepare("SELECT bookmark_link_target, bookmark_date_display, display_url, permanent_notes, enable_preview_images, bookmark_description_display, bookmark_description_max_lines, collapse_side_panel, tag_grouping FROM user_profile WHERE id=1").first();
    expect(row.bookmark_link_target).toBe("_self");
    expect(row.bookmark_date_display).toBe("hidden");
    expect(row.display_url).toBe(1);
    expect(row.permanent_notes).toBe(1);
    expect(row.enable_preview_images).toBe(1);
    expect(row.bookmark_description_display).toBe("hidden");
    expect(row.bookmark_description_max_lines).toBe(5);
    expect(row.collapse_side_panel).toBe(1);
    expect(row.tag_grouping).toBe("prefix");
  });
});
