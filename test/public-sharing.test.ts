/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { app } from "../src/index.js";
import { createSession } from "../src/web/auth.js";
import { issueCsrf, CSRF_COOKIE_NAME } from "../src/web/csrf.js";
import type { Env } from "../src/env.js";
import { settingsPage } from "../src/web/views/settings-view.js";
import { bookmarksListPage } from "../src/web/views/bookmarks.js";
import { layout } from "../src/web/views/layout.js";
import type { UserProfileRow } from "../src/db/schema.js";
import { setupTestDb } from "./helpers/migrations.js";

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
  await env.DB.prepare("DELETE FROM feed_tokens").run();
}

async function setProfileSharing(sharing: number, publicSharing: number) {
  await env.DB.prepare(
    "UPDATE user_profile SET enable_sharing=?, enable_public_sharing=? WHERE id=1"
  ).bind(sharing, publicSharing).run();
}

async function seedSharedBookmark() {
  await env.DB.prepare(
    "INSERT INTO bookmarks (url, url_normalized, title, shared, date_added, date_modified) VALUES (?, ?, ?, 1, ?, ?)"
  ).bind("https://shared-public.com", "https://shared-public.com", "Shared Public Bookmark", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
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

// ── Route: anonymous GET /bookmarks/shared ─────────────────────────────

describe("Public Sharing — anonymous GET /bookmarks/shared", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("200 with shared bookmarks when enable_sharing=1 AND enable_public_sharing=1", async () => {
    await setProfileSharing(1, 1);
    await seedSharedBookmark();

    const res = await fetchUrl("/bookmarks/shared");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Shared Public Bookmark");
  });

  it("redirects to login when enable_public_sharing=0", async () => {
    await setProfileSharing(1, 0);

    const res = await fetchUrl("/bookmarks/shared");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("redirects to login when enable_sharing=0 even if enable_public_sharing=1", async () => {
    await setProfileSharing(0, 1);

    const res = await fetchUrl("/bookmarks/shared");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});

// ── Route: anonymous GET /feeds/shared ─────────────────────────────────

describe("Public Sharing — anonymous GET /feeds/shared", () => {
  beforeEach(async () => {
    await cleanTables();
  });

  it("200 with Atom feed when enable_sharing=1 AND enable_public_sharing=1", async () => {
    await setProfileSharing(1, 1);
    await seedSharedBookmark();

    const res = await fetchUrl("/feeds/shared");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("atom+xml");
    const xml = await res.text();
    expect(xml).toContain("Shared Public Bookmark");
  });

  it("401 when enable_public_sharing=0", async () => {
    await setProfileSharing(1, 0);

    const res = await fetchUrl("/feeds/shared");
    expect(res.status).toBe(401);
  });

  it("401 when enable_sharing=0 even if enable_public_sharing=1", async () => {
    await setProfileSharing(0, 1);

    const res = await fetchUrl("/feeds/shared");
    expect(res.status).toBe(401);
  });
});

// ── View: anonymous shared page hides interactive UI ────────────────────

describe("Public Sharing — anonymous view hides interactive UI", () => {
  it("anonymous shared page has no edit/delete buttons", async () => {
    await cleanTables();
    await setProfileSharing(1, 1);
    await seedSharedBookmark();

    const res = await fetchUrl("/bookmarks/shared");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Shared Public Bookmark");
    expect(html).not.toContain(">Edit</a>");
    expect(html).not.toContain('class="btn btn-sm btn-danger"');
    expect(html).not.toContain(">Archive</button>");
  });

  it("anonymous shared page has no bulk action bar", async () => {
    await cleanTables();
    await setProfileSharing(1, 1);
    await seedSharedBookmark();

    const res = await fetchUrl("/bookmarks/shared");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("bulk-action-bar");
    expect(html).not.toContain("bulk_action");
    expect(html).not.toContain('name="bookmark_id"');
  });

  it("anonymous layout has minimal nav (only shared link, no settings/tags/bundles)", async () => {
    await cleanTables();
    await setProfileSharing(1, 1);

    const res = await fetchUrl("/bookmarks/shared");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/bookmarks/shared");
    expect(html).not.toContain(">Settings</a>");
    expect(html).not.toContain(">Tags</a>");
    expect(html).not.toContain(">Bundles</a>");
    expect(html).not.toContain("/logout");
  });
});

// ── Settings: enable_public_sharing checkbox ────────────────────────────

describe("Public Sharing — settings UI", () => {
  it("settings page renders enable_public_sharing checkbox", () => {
    const profile = makeProfile({ enable_sharing: 1, enable_public_sharing: 0 });
    const html = settingsPage({ profile, tokens: [] });
    expect(html).toContain('name="enable_public_sharing"');
    expect(html).toContain("Enable public sharing");
  });

  it("checkbox is checked when enable_public_sharing=1", () => {
    const profile = makeProfile({ enable_public_sharing: 1 });
    const html = settingsPage({ profile, tokens: [] });
    expect(html).toMatch(/name="enable_public_sharing"[^>]*checked/);
  });

  it("checkbox is NOT checked when enable_public_sharing=0", () => {
    const profile = makeProfile({ enable_public_sharing: 0 });
    const html = settingsPage({ profile, tokens: [] });
    expect(html).not.toMatch(/name="enable_public_sharing"[^>]*checked/);
  });
});

// ── Settings: POST /settings saves enable_public_sharing ────────────────

describe("Public Sharing — POST /settings saves enable_public_sharing", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("saving enable_public_sharing=1 persists to DB", async () => {
    // Reset
    await env.DB.prepare(
      "UPDATE user_profile SET enable_public_sharing=0 WHERE id=1"
    ).run();

    // Login
    const session = await createSession(env as unknown as Env);
    const csrf = await issueCsrf((env as unknown as Env).SESSION_SECRET || "default-secret");

    // POST settings with enable_public_sharing
    const form = new FormData();
    form.append("_csrf", csrf);
    form.append("theme", "auto");
    form.append("items_per_page", "30");
    form.append("enable_sharing", "1");
    form.append("enable_public_sharing", "1");
    form.append("tag_search", "strict");
    form.append("web_archive_integration", "disabled");
    form.append("custom_css", "");

    const res = await fetchUrl("/settings", {
      method: "POST",
      headers: {
        Cookie: `ld_session=${session}; ${CSRF_COOKIE_NAME}=${csrf}`,
      },
      body: form as any,
      redirect: "manual",
    });

    expect(res.status).toBe(302);

    // Verify DB
    const row = await env.DB.prepare("SELECT enable_public_sharing FROM user_profile WHERE id=1").first<{ enable_public_sharing: number }>();
    expect(row?.enable_public_sharing).toBe(1);
  });

  it("saving without enable_public_sharing sets it to 0", async () => {
    // Set to 1 first
    await env.DB.prepare(
      "UPDATE user_profile SET enable_public_sharing=1 WHERE id=1"
    ).run();

    // Login
    const session = await createSession(env as unknown as Env);
    const csrf = await issueCsrf((env as unknown as Env).SESSION_SECRET || "default-secret");

    // POST settings WITHOUT enable_public_sharing
    const form = new FormData();
    form.append("_csrf", csrf);
    form.append("theme", "auto");
    form.append("items_per_page", "30");
    form.append("tag_search", "strict");
    form.append("web_archive_integration", "disabled");
    form.append("custom_css", "");

    const res = await fetchUrl("/settings", {
      method: "POST",
      headers: {
        Cookie: `ld_session=${session}; ${CSRF_COOKIE_NAME}=${csrf}`,
      },
      body: form as any,
      redirect: "manual",
    });

    expect(res.status).toBe(302);

    // Verify DB
    const row = await env.DB.prepare("SELECT enable_public_sharing FROM user_profile WHERE id=1").first<{ enable_public_sharing: number }>();
    expect(row?.enable_public_sharing).toBe(0);
  });
});

// ── View unit: bookmarksListPage anonymous mode ────────────────────────

describe("Public Sharing — bookmarksListPage anonymous mode", () => {
  it("hides checkboxes and action buttons when anonymous=true", () => {
    const profile = makeProfile({ enable_sharing: 1, enable_public_sharing: 1 });
    const html = bookmarksListPage({
      bookmarks: [{
        row: {
          id: 1, url: "https://test.com", url_normalized: "https://test.com",
          title: "Test", description: "", notes: "", web_archive_snapshot_url: "",
          favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0,
          shared: 1, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z",
          date_accessed: null,
        },
        tagNames: [],
      }],
      count: 1, q: "", sort: "added_desc", offset: 0, limit: 30,
      allTags: [], selectedTag: "", unread: "", shared: "",
      profile, page: "shared", anonymous: true,
    });
    expect(html).not.toContain('name="bookmark_id"');
    expect(html).not.toContain("bulk-action-bar");
    expect(html).not.toContain(">Edit</a>");
    expect(html).not.toContain('class="btn btn-sm btn-danger"');
  });
});

// ── View unit: layout anonymous mode ───────────────────────────────────

describe("Public Sharing — layout anonymous mode", () => {
  it("anonymous layout shows only shared link, no full nav", () => {
    const html = layout("Shared", "<p>body</p>", { anonymous: true });
    expect(html).toContain("/bookmarks/shared");
    expect(html).not.toContain(">Settings</a>");
    expect(html).not.toContain(">Tags</a>");
    expect(html).not.toContain(">Bundles</a>");
    expect(html).not.toContain(">Archived</a>");
    expect(html).not.toContain("/logout");
  });

  it("non-anonymous layout shows full nav", () => {
    const profile = makeProfile();
    const html = layout("Bookmarks", "<p>body</p>", { profile, activeNav: "bookmarks" });
    expect(html).toContain(">Bookmarks</a>");
    expect(html).toContain(">Archived</a>");
    expect(html).toContain(">Shared</a>");
    expect(html).toContain(">Settings</a>");
  });
});

// ── Bundle Web form: filter_unread / filter_shared persistence ─────

describe("Bundle Web form — filter_unread / filter_shared", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM bundles").run();
  });

  it("POST /bundles with filter_unread=yes persists to DB", async () => {
    const session = await createSession(env as unknown as Env);

    const form = new FormData();
    form.append("name", "My Bundle");
    form.append("filter_unread", "yes");
    form.append("filter_shared", "off");
    form.append("order", "1");

    const res = await fetchUrl("/bundles", {
      method: "POST",
      headers: { Cookie: `ld_session=${session}` },
      body: form as any,
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const row = await env.DB.prepare("SELECT filter_unread, filter_shared FROM bundles WHERE name = ?").bind("My Bundle").first<{ filter_unread: string; filter_shared: string }>();
    expect(row?.filter_unread).toBe("yes");
    expect(row?.filter_shared).toBe("off");
  });

  it("GET /bundles?edit=<id> shows filter_unread selected", async () => {
    // Create a bundle directly in DB with filter_unread=yes
    await env.DB.prepare(
      "INSERT INTO bundles (name, filter_unread, filter_shared, date_created, date_modified) VALUES (?, ?, ?, ?, ?)"
    ).bind("Edit Bundle", "yes", "off", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
    const inserted = await env.DB.prepare("SELECT id FROM bundles WHERE name = ?").bind("Edit Bundle").first<{ id: number }>();

    const session = await createSession(env as unknown as Env);
    const res = await fetchUrl(`/bundles?edit=${inserted!.id}`, {
      headers: { Cookie: `ld_session=${session}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    // The select should have "yes" selected
    expect(html).toContain('value="yes" selected');
  });

  it("POST /bundles/:id updates filter_shared and round-trips", async () => {
    // Create a bundle
    await env.DB.prepare(
      "INSERT INTO bundles (name, filter_unread, filter_shared, date_created, date_modified) VALUES (?, ?, ?, ?, ?)"
    ).bind("Update Bundle", "off", "off", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
    const inserted = await env.DB.prepare("SELECT id FROM bundles WHERE name = ?").bind("Update Bundle").first<{ id: number }>();

    const session = await createSession(env as unknown as Env);

    // Update filter_shared to "no"
    const form = new FormData();
    form.append("name", "Update Bundle");
    form.append("filter_unread", "off");
    form.append("filter_shared", "no");
    form.append("order", "1");

    const updateRes = await fetchUrl(`/bundles/${inserted!.id}`, {
      method: "POST",
      headers: { Cookie: `ld_session=${session}` },
      body: form as any,
      redirect: "manual",
    });
    expect(updateRes.status).toBe(302);

    // Verify DB updated
    const row = await env.DB.prepare("SELECT filter_shared FROM bundles WHERE id = ?").bind(inserted!.id).first<{ filter_shared: string }>();
    expect(row?.filter_shared).toBe("no");

    // Verify edit form round-trips the value
    const editRes = await fetchUrl(`/bundles?edit=${inserted!.id}`, {
      headers: { Cookie: `ld_session=${session}` },
    });
    expect(editRes.status).toBe(200);
    const html = await editRes.text();
    expect(html).toContain('value="no" selected');
  });
});
