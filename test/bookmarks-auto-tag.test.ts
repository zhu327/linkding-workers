/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createBookmark, updateBookmark } from "../src/services/bookmarks.js";
import type { UserProfileRow } from "../src/db/schema.js";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
}

function makeProfile(autoTaggingRules: string): UserProfileRow {
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
    auto_tagging_rules: autoTaggingRules,
    items_per_page: 30,
    legacy_search: 0,
    custom_css: "",
    default_mark_unread: 0,
    default_mark_shared: 0,
  };
}

async function getBookmarkTags(db: D1Database, bookmarkId: number): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT t.name FROM tags t INNER JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = ? ORDER BY t.name",
    )
    .bind(bookmarkId)
    .all<{ name: string }>();
  return rows.results.map((r) => r.name);
}

const AUTO_TAG_RULES = "github.com dev code\nyoutube.com media video\n";

// ── Helpers for API-level tests ──────────────────────────────────────

async function apiReq(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) {
  const request = new Request(`http://localhost${path}`, {
    headers: { Authorization: "Token test-token-123", "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

// ── API handler auto-tagging tests (T1) ───────────────────────────────

describe("API handler auto-tagging", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  it("PATCH with empty body (no tag_names) applies auto-tags on top of existing tags", async () => {
    // Create bookmark WITHOUT auto-tag rules enabled first
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules='' WHERE id=1").run();
    const createRes = await apiReq("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/test/repo", title: "Repo", tag_names: ["existing"] }),
    });
    const created: any = await createRes.json();
    // Verify it only has the user tag for now
    expect(created.tag_names).toEqual(["existing"]);

    // Now enable auto-tagging rules
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind(AUTO_TAG_RULES).run();

    // PATCH with empty body — no tag_names, no url
    const patchRes = await apiReq(`/api/bookmarks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect(patchRes.status).toBe(200);
    const updated: any = await patchRes.json();
    expect(updated.tag_names).toContain("existing");
    expect(updated.tag_names).toContain("dev");
    expect(updated.tag_names).toContain("code");
  });

  it("PATCH with explicit tag_names merges auto-tags on top", async () => {
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind(AUTO_TAG_RULES).run();

    const createRes = await apiReq("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/test/repo", title: "Repo", tag_names: ["old"] }),
    });
    const created: any = await createRes.json();

    // PATCH with new tag_names
    const patchRes = await apiReq(`/api/bookmarks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ tag_names: ["x"] }),
    });
    expect(patchRes.status).toBe(200);
    const updated: any = await patchRes.json();
    expect(updated.tag_names).toContain("x");
    expect(updated.tag_names).toContain("dev");
    expect(updated.tag_names).toContain("code");
  });

  it("PATCH with tag_names containing an auto-tag does not duplicate", async () => {
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind(AUTO_TAG_RULES).run();

    const createRes = await apiReq("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/test/repo", title: "Repo", tag_names: ["user"] }),
    });
    const created: any = await createRes.json();

    // PATCH with tag_names including "dev" (which is also an auto-tag)
    const patchRes = await apiReq(`/api/bookmarks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ tag_names: ["dev", "code", "user2"] }),
    });
    expect(patchRes.status).toBe(200);
    const updated: any = await patchRes.json();
    // "dev", "code" should appear exactly once each
    const devCount = updated.tag_names.filter((t: string) => t.toLowerCase() === "dev").length;
    const codeCount = updated.tag_names.filter((t: string) => t.toLowerCase() === "code").length;
    expect(devCount).toBe(1);
    expect(codeCount).toBe(1);
    expect(updated.tag_names).toContain("user2");
  });

  it("POST /api/bookmarks/ applies auto-tags exactly once", async () => {
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind(AUTO_TAG_RULES).run();

    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/test/repo", title: "Repo", tag_names: ["dev", "code"] }),
    });
    expect(res.status).toBe(201);
    const created: any = await res.json();

    // auto-tags should appear exactly once (no double-application)
    const devCount = created.tag_names.filter((t: string) => t.toLowerCase() === "dev").length;
    const codeCount = created.tag_names.filter((t: string) => t.toLowerCase() === "code").length;
    expect(devCount).toBe(1);
    expect(codeCount).toBe(1);
  });

  it("POST /api/bookmarks/ applies auto-tags when no user tags provided", async () => {
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind(AUTO_TAG_RULES).run();

    const res = await apiReq("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify({ url: "https://github.com/test/repo", title: "Repo" }),
    });
    expect(res.status).toBe(201);
    const created: any = await res.json();
    expect(created.tag_names).toContain("dev");
    expect(created.tag_names).toContain("code");
  });
});

describe("Auto-tagging on create/update", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  beforeEach(async () => {
    await cleanTables();
  });

  // ── createBookmark ─────────────────────────────────────────────────

  it("createBookmark applies auto-tags from profile and merges with user tags", async () => {
    const profile = makeProfile(AUTO_TAG_RULES);
    const result = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["user-tag"] },
      profile,
    );
    const tags = await getBookmarkTags(env.DB, result.id);
    expect(tags).toContain("user-tag");
    expect(tags).toContain("dev");
    expect(tags).toContain("code");
  });

  it("createBookmark without auto-tagging rules only has user tags", async () => {
    const profile = makeProfile("");
    const result = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["user-tag"] },
      profile,
    );
    const tags = await getBookmarkTags(env.DB, result.id);
    expect(tags).toEqual(["user-tag"]);
  });

  it("createBookmark deduplicates auto-tags with user tags (case-insensitive)", async () => {
    const profile = makeProfile(AUTO_TAG_RULES);
    const result = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["DEV"] },
      profile,
    );
    const tags = await getBookmarkTags(env.DB, result.id);
    // "DEV" from user, "code" from auto-tag; "dev" should not be duplicated
    expect(tags).toContain("DEV");
    expect(tags).toContain("code");
    const devCount = tags.filter((t) => t.toLowerCase() === "dev").length;
    expect(devCount).toBe(1);
  });

  it("createBookmark with no matching auto-tag rules only has user tags", async () => {
    const profile = makeProfile(AUTO_TAG_RULES);
    const result = await createBookmark(
      env.DB,
      { url: "https://example.com/page", title: "Page", tag_names: ["misc"] },
      profile,
    );
    const tags = await getBookmarkTags(env.DB, result.id);
    expect(tags).toEqual(["misc"]);
  });

  it("createBookmark with auto-tag error does not crash", async () => {
    // Profile with rules that contain malformed lines — getTags handles gracefully
    const profile = makeProfile("not a valid rule line\n\n   \ngithub.com dev\n");
    const result = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["user-tag"] },
      profile,
    );
    const tags = await getBookmarkTags(env.DB, result.id);
    expect(tags).toContain("user-tag");
    expect(tags).toContain("dev");
  });

  // ── updateBookmark ─────────────────────────────────────────────────

  it("updateBookmark with profile applies auto-tags merged with existing tags", async () => {
    const profile = makeProfile(AUTO_TAG_RULES);
    // Create without auto-tagging first (empty rules)
    const emptyProfile = makeProfile("");
    const created = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["existing"] },
      emptyProfile,
    );

    // Update with auto-tagging profile, no tag_names provided
    await updateBookmark(env.DB, created.id, { title: "Updated" }, profile);
    const tags = await getBookmarkTags(env.DB, created.id);
    expect(tags).toContain("existing");
    expect(tags).toContain("dev");
    expect(tags).toContain("code");
  });

  it("updateBookmark with explicit tag_names merges auto-tags on top", async () => {
    const profile = makeProfile(AUTO_TAG_RULES);
    const emptyProfile = makeProfile("");
    const created = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["old-tag"] },
      emptyProfile,
    );

    // Update with explicit tag_names + profile for auto-tagging
    await updateBookmark(env.DB, created.id, { tag_names: ["new-tag"] }, profile);
    const tags = await getBookmarkTags(env.DB, created.id);
    expect(tags).toContain("new-tag");
    expect(tags).toContain("dev");
    expect(tags).toContain("code");
    // old-tag should be replaced since tag_names was explicitly provided
    expect(tags).not.toContain("old-tag");
  });

  it("updateBookmark without profile does not apply auto-tags", async () => {
    const emptyProfile = makeProfile("");
    const created = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["existing"] },
      emptyProfile,
    );

    // Update without passing profile
    await updateBookmark(env.DB, created.id, { title: "Updated" });
    const tags = await getBookmarkTags(env.DB, created.id);
    expect(tags).toEqual(["existing"]);
  });

  it("updateBookmark with auto-tag error does not crash", async () => {
    const profile = makeProfile("github.com dev\n");
    const emptyProfile = makeProfile("");
    const created = await createBookmark(
      env.DB,
      { url: "https://github.com/test/repo", title: "Repo", tag_names: ["existing"] },
      emptyProfile,
    );

    // Should not throw even if auto-tagging encounters issues
    await expect(
      updateBookmark(env.DB, created.id, { title: "Updated" }, profile),
    ).resolves.toBeDefined();
    const tags = await getBookmarkTags(env.DB, created.id);
    expect(tags).toContain("existing");
    expect(tags).toContain("dev");
  });
});
