/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createBookmark } from "../src/services/bookmarks.js";
import { serializeUserProfile } from "../src/api/serializers.js";
import { settingsPage } from "../src/web/views/settings-view.js";
import type { UserProfileRow } from "../src/db/schema.js";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
}

function makeProfile(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: 1,
    theme: "auto",
    bookmark_date_display: "relative",
    bookmark_link_target: "_blank",
    web_archive_integration: "disabled",
    tag_search: "strict",
    tag_grouping: "disabled",
    enable_sharing: 0,
    enable_public_sharing: 0,
    enable_favicons: 1,
    enable_preview_images: 1,
    display_url: 0,
    permanent_notes: 0,
    bookmark_description_display: "separate",
    bookmark_description_max_lines: 3,
    collapse_side_panel: 0,
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

async function apiReq(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) {
  const request = new Request(`http://localhost${path}`, {
    headers: { Authorization: "Token test-token-123", ...opts?.headers },
    ...opts,
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

// ── Service: createBookmark uses profile defaults ──────────────────────

describe("createBookmark — default_mark_unread / default_mark_shared", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("without unread/shared in input, uses profile defaults (both true)", async () => {
    const profile = makeProfile({ default_mark_unread: 1, default_mark_shared: 1 });
    const result = await createBookmark(
      env.DB,
      { url: "https://defaults-true.com", title: "Defaults True" },
      profile,
    );
    expect(result.unread).toBe(1);
    expect(result.shared).toBe(1);
  });

  it("without unread/shared in input, uses profile defaults (both false)", async () => {
    const profile = makeProfile({ default_mark_unread: 0, default_mark_shared: 0 });
    const result = await createBookmark(
      env.DB,
      { url: "https://defaults-false.com", title: "Defaults False" },
      profile,
    );
    expect(result.unread).toBe(0);
    expect(result.shared).toBe(0);
  });

  it("explicit unread=false overrides profile default_mark_unread=1", async () => {
    const profile = makeProfile({ default_mark_unread: 1, default_mark_shared: 1 });
    const result = await createBookmark(
      env.DB,
      { url: "https://override-false.com", title: "Override", unread: false },
      profile,
    );
    expect(result.unread).toBe(0);
    expect(result.shared).toBe(1);
  });

  it("explicit unread=true overrides profile default_mark_unread=0", async () => {
    const profile = makeProfile({ default_mark_unread: 0, default_mark_shared: 0 });
    const result = await createBookmark(
      env.DB,
      { url: "https://override-true.com", title: "Override", unread: true, shared: true },
      profile,
    );
    expect(result.unread).toBe(1);
    expect(result.shared).toBe(1);
  });

  it("mixed: default_mark_unread=1, default_mark_shared=0", async () => {
    const profile = makeProfile({ default_mark_unread: 1, default_mark_shared: 0 });
    const result = await createBookmark(
      env.DB,
      { url: "https://mixed-defaults.com", title: "Mixed" },
      profile,
    );
    expect(result.unread).toBe(1);
    expect(result.shared).toBe(0);
  });
});

// ── Serializer: profile includes default_mark_unread / default_mark_shared ──

describe("serializeUserProfile — default_mark_unread / default_mark_shared", () => {
  it("includes default_mark_unread and default_mark_shared as booleans", () => {
    const profile = makeProfile({ default_mark_unread: 1, default_mark_shared: 0 });
    const result = serializeUserProfile(profile, "0.1.0");
    expect(result.default_mark_unread).toBe(true);
    expect(result.default_mark_shared).toBe(false);
  });

  it("both 0 → both false", () => {
    const profile = makeProfile({ default_mark_unread: 0, default_mark_shared: 0 });
    const result = serializeUserProfile(profile, "0.1.0");
    expect(result.default_mark_unread).toBe(false);
    expect(result.default_mark_shared).toBe(false);
  });
});

// ── API: GET /api/user/profile/ includes the new fields ────────────────

describe("API — profile endpoint includes default preferences", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("GET /api/user/profile/ includes default_mark_unread and default_mark_shared", async () => {
    const res = await apiReq("/api/user/profile/");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("default_mark_unread");
    expect(body).toHaveProperty("default_mark_shared");
    expect(typeof body.default_mark_unread).toBe("boolean");
    expect(typeof body.default_mark_shared).toBe("boolean");
  });
});

// ── Settings UI: checkboxes rendered ───────────────────────────────────

describe("Settings UI — default_mark_unread / default_mark_shared checkboxes", () => {
  it("renders checkbox for default_mark_unread", () => {
    const profile = makeProfile({ default_mark_unread: 0, default_mark_shared: 0 });
    const html = settingsPage({ profile, tokens: [] });
    expect(html).toContain('name="default_mark_unread"');
    expect(html).toContain('name="default_mark_shared"');
  });

  it("checkbox is checked when default_mark_unread=1", () => {
    const profile = makeProfile({ default_mark_unread: 1, default_mark_shared: 1 });
    const html = settingsPage({ profile, tokens: [] });
    expect(html).toMatch(/name="default_mark_unread"[^>]*checked/);
    expect(html).toMatch(/name="default_mark_shared"[^>]*checked/);
  });

  it("checkbox is NOT checked when default_mark_unread=0", () => {
    const profile = makeProfile({ default_mark_unread: 0, default_mark_shared: 0 });
    const html = settingsPage({ profile, tokens: [] });
    expect(html).not.toMatch(/name="default_mark_unread"[^>]*checked/);
    expect(html).not.toMatch(/name="default_mark_shared"[^>]*checked/);
  });
});

// ── Migration SQL applies cleanly ──────────────────────────────────────

describe("Migration 0002", () => {
  it("ALTER TABLE adds columns with correct defaults on existing rows", async () => {
    // Create a table WITHOUT the new columns (simulating pre-migration state)
    await env.DB.prepare("DROP TABLE IF EXISTS test_migration_profile").run();
    await env.DB.prepare(
      "CREATE TABLE test_migration_profile (id INTEGER PRIMARY KEY, theme TEXT NOT NULL DEFAULT 'auto')"
    ).run();
    await env.DB.prepare("INSERT INTO test_migration_profile (id, theme) VALUES (1, 'dark')").run();

    // Apply migration
    await env.DB.prepare(
      "ALTER TABLE test_migration_profile ADD COLUMN default_mark_unread INTEGER NOT NULL DEFAULT 0"
    ).run();
    await env.DB.prepare(
      "ALTER TABLE test_migration_profile ADD COLUMN default_mark_shared INTEGER NOT NULL DEFAULT 0"
    ).run();

    // Verify defaults
    const row = await env.DB.prepare("SELECT * FROM test_migration_profile WHERE id = 1").first<any>();
    expect(row.default_mark_unread).toBe(0);
    expect(row.default_mark_shared).toBe(0);

    // Cleanup
    await env.DB.prepare("DROP TABLE test_migration_profile").run();
  });
});
