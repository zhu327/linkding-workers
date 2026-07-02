/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { app } from "../src/index.js";
import {
  bulkArchive,
  bulkUnarchive,
  bulkDelete,
  bulkMarkRead,
  bulkMarkUnread,
  bulkShare,
  bulkUnshare,
  bulkTag,
  bulkUntag,
} from "../src/services/bookmarks.js";
import { issueCsrf, CSRF_COOKIE_NAME } from "../src/web/csrf.js";
import { createSession } from "../src/web/auth.js";
import { setupTestDb } from "./helpers/migrations.js";

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
}

/** Insert N bookmarks and return their IDs. */
async function seedBookmarks(count: number): Promise<number[]> {
  const ids: number[] = [];
  const now = "2024-01-01T00:00:00Z";
  for (let i = 0; i < count; i++) {
    const result = await env.DB
      .prepare(
        "INSERT INTO bookmarks (url, url_normalized, title, date_added, date_modified) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(`https://example${i}.com`, `https://example${i}.com`, `Bookmark ${i}`, now, now)
      .run();
    ids.push(Number(result.meta.last_row_id));
  }
  return ids;
}

// ── Service-layer tests ──────────────────────────────────────────────

describe("bulkArchive", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("sets is_archived=1 and updates date_modified for all IDs", async () => {
    const ids = await seedBookmarks(3);
    await bulkArchive(env.DB, ids);
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.is_archived).toBe(1);
      expect(row.date_modified).not.toBe("2024-01-01T00:00:00Z");
    }
  });

  it("empty ids array is a no-op", async () => {
    await expect(bulkArchive(env.DB, [])).resolves.toBeUndefined();
  });
});

describe("bulkUnarchive", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("sets is_archived=0 for all IDs", async () => {
    const ids = await seedBookmarks(2);
    // Archive first, then unarchive
    await env.DB.prepare("UPDATE bookmarks SET is_archived = 1 WHERE id IN (?, ?)").bind(ids[0], ids[1]).run();
    await bulkUnarchive(env.DB, ids);
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.is_archived).toBe(0);
    }
  });

  it("empty ids array is a no-op", async () => {
    await expect(bulkUnarchive(env.DB, [])).resolves.toBeUndefined();
  });
});

describe("bulkDelete", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("removes bookmarks and their tag associations", async () => {
    const ids = await seedBookmarks(3);
    // Add a tag to first bookmark
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO tags (name, date_added) VALUES (?, ?)").bind("test-tag", now).run();
    const tag = await env.DB.prepare("SELECT id FROM tags WHERE name = ?").bind("test-tag").first<any>();
    await env.DB.prepare("INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(ids[0], tag.id).run();

    await bulkDelete(env.DB, ids);

    for (const id of ids) {
      const row = await env.DB.prepare("SELECT id FROM bookmarks WHERE id = ?").bind(id).first();
      expect(row).toBeNull();
    }
    // Tag associations should also be removed
    const btRows = await env.DB
      .prepare("SELECT * FROM bookmark_tags WHERE bookmark_id IN (?, ?, ?)")
      .bind(ids[0], ids[1], ids[2])
      .all();
    expect(btRows.results).toHaveLength(0);
  });

  it("empty ids array is a no-op", async () => {
    await expect(bulkDelete(env.DB, [])).resolves.toBeUndefined();
  });
});

describe("bulkMarkRead / bulkMarkUnread", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("bulkMarkUnread sets unread=1 for all IDs", async () => {
    const ids = await seedBookmarks(2);
    await bulkMarkUnread(env.DB, ids);
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT unread FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.unread).toBe(1);
    }
  });

  it("bulkMarkRead sets unread=0 for all IDs", async () => {
    const ids = await seedBookmarks(2);
    await env.DB.prepare("UPDATE bookmarks SET unread = 1 WHERE id IN (?, ?)").bind(ids[0], ids[1]).run();
    await bulkMarkRead(env.DB, ids);
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT unread FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.unread).toBe(0);
    }
  });

  it("empty ids array is a no-op for both", async () => {
    await expect(bulkMarkRead(env.DB, [])).resolves.toBeUndefined();
    await expect(bulkMarkUnread(env.DB, [])).resolves.toBeUndefined();
  });
});

describe("bulkShare / bulkUnshare", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("bulkShare sets shared=1 for all IDs", async () => {
    const ids = await seedBookmarks(2);
    await bulkShare(env.DB, ids);
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT shared FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.shared).toBe(1);
    }
  });

  it("bulkUnshare sets shared=0 for all IDs", async () => {
    const ids = await seedBookmarks(2);
    await env.DB.prepare("UPDATE bookmarks SET shared = 1 WHERE id IN (?, ?)").bind(ids[0], ids[1]).run();
    await bulkUnshare(env.DB, ids);
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT shared FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.shared).toBe(0);
    }
  });

  it("empty ids array is a no-op for both", async () => {
    await expect(bulkShare(env.DB, [])).resolves.toBeUndefined();
    await expect(bulkUnshare(env.DB, [])).resolves.toBeUndefined();
  });
});

describe("bulkTag", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("creates tag if needed and associates with all bookmarks", async () => {
    const ids = await seedBookmarks(3);
    await bulkTag(env.DB, ids, ["new-tag"]);

    // Tag should exist
    const tag = await env.DB.prepare("SELECT * FROM tags WHERE name = ?").bind("new-tag").first<any>();
    expect(tag).not.toBeNull();

    // Each bookmark should have the tag
    for (const id of ids) {
      const rows = await env.DB
        .prepare("SELECT * FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?")
        .bind(id, tag.id)
        .all();
      expect(rows.results).toHaveLength(1);
    }
  });

  it("uses existing tag if it already exists", async () => {
    const ids = await seedBookmarks(2);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO tags (name, date_added) VALUES (?, ?)").bind("existing-tag", now).run();

    await bulkTag(env.DB, ids, ["existing-tag"]);

    const tag = await env.DB.prepare("SELECT * FROM tags WHERE name = ?").bind("existing-tag").first<any>();
    for (const id of ids) {
      const rows = await env.DB
        .prepare("SELECT * FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?")
        .bind(id, tag.id)
        .all();
      expect(rows.results).toHaveLength(1);
    }
  });

  it("is idempotent — tagging twice does not duplicate", async () => {
    const ids = await seedBookmarks(1);
    await bulkTag(env.DB, ids, ["dup-tag"]);
    await bulkTag(env.DB, ids, ["dup-tag"]);

    const tag = await env.DB.prepare("SELECT * FROM tags WHERE name = ?").bind("dup-tag").first<any>();
    const rows = await env.DB
      .prepare("SELECT * FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?")
      .bind(ids[0], tag.id)
      .all();
    expect(rows.results).toHaveLength(1);
  });

  it("handles multiple tags at once", async () => {
    const ids = await seedBookmarks(2);
    await bulkTag(env.DB, ids, ["tag-a", "tag-b"]);

    for (const id of ids) {
      const rows = await env.DB
        .prepare("SELECT bt.tag_id FROM bookmark_tags bt INNER JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = ?")
        .bind(id)
        .all<any>();
      const tagNames = rows.results.map((r: any) => r.tag_id);
      expect(tagNames).toHaveLength(2);
    }
  });

  it("empty ids array is a no-op", async () => {
    await expect(bulkTag(env.DB, [], ["tag"])).resolves.toBeUndefined();
  });
});

describe("bulkUntag", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("removes tag associations for given bookmarks", async () => {
    const ids = await seedBookmarks(3);
    // First tag them
    await bulkTag(env.DB, ids, ["remove-me"]);
    const tag = await env.DB.prepare("SELECT * FROM tags WHERE name = ?").bind("remove-me").first<any>();

    // Now untag
    await bulkUntag(env.DB, ids, ["remove-me"]);

    for (const id of ids) {
      const rows = await env.DB
        .prepare("SELECT * FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?")
        .bind(id, tag.id)
        .all();
      expect(rows.results).toHaveLength(0);
    }
  });

  it("does not remove the tag itself (other bookmarks may use it)", async () => {
    const ids = await seedBookmarks(1);
    await bulkTag(env.DB, ids, ["keep-tag"]);
    await bulkUntag(env.DB, ids, ["keep-tag"]);

    const tag = await env.DB.prepare("SELECT * FROM tags WHERE name = ?").bind("keep-tag").first();
    expect(tag).not.toBeNull();
  });

  it("empty ids array is a no-op", async () => {
    await expect(bulkUntag(env.DB, [], ["tag"])).resolves.toBeUndefined();
  });
});

// ── Web route tests ──────────────────────────────────────────────────

async function getAuthSession(): Promise<{ session: string; csrfToken: string; csrfCookie: string }> {
  const secret = "test-session-secret-for-testing-only";
  const session = await createSession({ SESSION_SECRET: secret } as any);
  const csrfToken = await issueCsrf(secret);
  const csrfCookie = `${CSRF_COOKIE_NAME}=${encodeURIComponent(csrfToken)}`;
  return { session, csrfToken, csrfCookie };
}

async function webReq(
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: FormData;
    session?: string;
    csrfCookie?: string;
    redirect?: string;
  } = {},
) {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.session) {
    const cookie = opts.csrfCookie ? `ld_session=${opts.session}; ${opts.csrfCookie}` : `ld_session=${opts.session}`;
    headers["Cookie"] = cookie;
  }
  const request = new Request(`http://localhost${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body as any,
    redirect: (opts.redirect as any) || "manual",
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("POST /bookmarks/bulk — web route", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("archives selected bookmarks and redirects", async () => {
    const ids = await seedBookmarks(3);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_archive");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks");

    // Verify they are archived
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT is_archived FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.is_archived).toBe(1);
    }
  });

  it("unarchives selected bookmarks", async () => {
    const ids = await seedBookmarks(2);
    await env.DB.prepare("UPDATE bookmarks SET is_archived = 1").run();
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_unarchive");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    for (const id of ids) {
      const row = await env.DB.prepare("SELECT is_archived FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.is_archived).toBe(0);
    }
  });

  it("preserves bookmark list filters and offset after bulk actions", async () => {
    const ids = await seedBookmarks(1);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_archive");
    form.append("bookmark_id", String(ids[0]));
    form.append("base_path", "/bookmarks");
    form.append("offset", "30");
    form.append("q", "foo bar");
    form.append("sort", "title_asc");
    form.append("tag", "work");
    form.append("unread", "no");
    form.append("shared", "yes");
    form.append("bundle", "1");

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks?offset=30&q=foo+bar&sort=title_asc&tag=work&unread=no&shared=yes&bundle=1");
  });

  it("rejects malicious return base_path", async () => {
    const ids = await seedBookmarks(1);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_archive");
    form.append("bookmark_id", String(ids[0]));
    form.append("base_path", "https://evil.example");
    form.append("q", "safe");

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks?q=safe");
  });

  it("preserves zero-valued bookmark list filters", async () => {
    const ids = await seedBookmarks(1);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_archive");
    form.append("bookmark_id", String(ids[0]));
    form.append("base_path", "/bookmarks");
    form.append("q", "0");
    form.append("tag", "0");
    form.append("unread", "0");
    form.append("shared", "0");

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks?q=0&tag=0&unread=0&shared=0");
  });

  it("keeps archived-list fallback when single unarchive form has no return state", async () => {
    const ids = await seedBookmarks(1);
    await env.DB.prepare("UPDATE bookmarks SET is_archived = 1").run();
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("unarchive", String(ids[0]));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/bookmarks/archived");
  });

  it("deletes selected bookmarks", async () => {
    const ids = await seedBookmarks(3);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_delete");
    form.append("bookmark_id", String(ids[0]));
    form.append("bookmark_id", String(ids[1]));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    // ids[0] and ids[1] should be deleted
    const row0 = await env.DB.prepare("SELECT id FROM bookmarks WHERE id = ?").bind(ids[0]).first();
    expect(row0).toBeNull();
    const row1 = await env.DB.prepare("SELECT id FROM bookmarks WHERE id = ?").bind(ids[1]).first();
    expect(row1).toBeNull();
    // ids[2] should still exist
    const row2 = await env.DB.prepare("SELECT id FROM bookmarks WHERE id = ?").bind(ids[2]).first();
    expect(row2).not.toBeNull();
  });

  it("tags selected bookmarks with bulk_tag_string", async () => {
    const ids = await seedBookmarks(2);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_tag");
    form.append("bulk_tag_string", "tag1, tag2");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    // Verify tags exist
    const tagRows = await env.DB.prepare("SELECT t.name FROM tags t INNER JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = ?").bind(ids[0]).all<any>();
    const names = tagRows.results.map((r: any) => r.name).sort();
    expect(names).toContain("tag1");
    expect(names).toContain("tag2");
  });

  it("untags selected bookmarks", async () => {
    const ids = await seedBookmarks(2);
    await bulkTag(env.DB, ids, ["remove-me"]);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_untag");
    form.append("bulk_tag_string", "remove-me");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    const tag = await env.DB.prepare("SELECT id FROM tags WHERE name = ?").bind("remove-me").first<any>();
    for (const id of ids) {
      const rows = await env.DB.prepare("SELECT * FROM bookmark_tags WHERE bookmark_id = ? AND tag_id = ?").bind(id, tag.id).all();
      expect(rows.results).toHaveLength(0);
    }
  });

  it("marks bookmarks as read", async () => {
    const ids = await seedBookmarks(2);
    await env.DB.prepare("UPDATE bookmarks SET unread = 1").run();
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_read");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    for (const id of ids) {
      const row = await env.DB.prepare("SELECT unread FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.unread).toBe(0);
    }
  });

  it("marks bookmarks as unread", async () => {
    const ids = await seedBookmarks(2);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_unread");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    for (const id of ids) {
      const row = await env.DB.prepare("SELECT unread FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.unread).toBe(1);
    }
  });

  it("shares bookmarks", async () => {
    const ids = await seedBookmarks(2);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_share");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    for (const id of ids) {
      const row = await env.DB.prepare("SELECT shared FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.shared).toBe(1);
    }
  });

  it("unshares bookmarks", async () => {
    const ids = await seedBookmarks(2);
    await env.DB.prepare("UPDATE bookmarks SET shared = 1").run();
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "bulk_unshare");
    for (const id of ids) form.append("bookmark_id", String(id));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);

    for (const id of ids) {
      const row = await env.DB.prepare("SELECT shared FROM bookmarks WHERE id = ?").bind(id).first<any>();
      expect(row.shared).toBe(0);
    }
  });

  it("without CSRF token still succeeds (CSRF not required for bulk actions)", async () => {
    const ids = await seedBookmarks(1);
    const { session } = await getAuthSession();

    const form = new FormData();
    form.append("bulk_action", "bulk_archive");
    form.append("bookmark_id", String(ids[0]));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      // No CSRF cookie
    });
    expect(res.status).toBe(302);
  });

  it("with invalid action redirects without error", async () => {
    const ids = await seedBookmarks(1);
    const { session, csrfToken, csrfCookie } = await getAuthSession();

    const form = new FormData();
    form.append("_csrf", csrfToken);
    form.append("bulk_action", "invalid_action");
    form.append("bookmark_id", String(ids[0]));

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
      session,
      csrfCookie,
    });
    expect(res.status).toBe(302);
  });

  it("without auth redirects to /login", async () => {
    const form = new FormData();
    form.append("bulk_action", "bulk_archive");
    form.append("bookmark_id", "1");

    const res = await webReq("/bookmarks/bulk", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});

// ── UI tests ─────────────────────────────────────────────────────────

describe("Bulk Edit Bar UI", () => {
  it("bulkEditBar returns HTML with action dropdown and Execute button", async () => {
    const { bulkEditBar } = await import("../src/web/views/bulk-actions.js");
    const profile: any = { enable_sharing: 1 };
    const html = bulkEditBar(profile, 0);
    expect(html).toContain('name="bulk_action"');
    expect(html).toContain("Archive");
    expect(html).toContain("Unarchive");
    expect(html).toContain("Delete");
    expect(html).toContain("Add tags");
    expect(html).toContain("Remove tags");
    expect(html).toContain("Mark as read");
    expect(html).toContain("Mark as unread");
    expect(html).toContain("Share");
    expect(html).toContain("Unshare");
    expect(html).toContain("Execute");
    expect(html).toContain('name="bulk_tag_string"');
  });
});

describe("Bookmark list checkboxes", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("renders a checkbox for each bookmark row", async () => {
    const { bookmarksListPage } = await import("../src/web/views/bookmarks.js");
    const profile: any = {
      id: 1, theme: "auto", items_per_page: 30, enable_sharing: 0, enable_favicons: 1,
      tag_search: "strict", custom_css: "", default_mark_unread: 0, default_mark_shared: 0,
    };
    const bookmarks = [
      { row: { id: 1, url: "https://a.com", url_normalized: "", title: "A", description: "", notes: "", web_archive_snapshot_url: "", favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0, shared: 0, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z", date_accessed: null }, tagNames: [] },
      { row: { id: 2, url: "https://b.com", url_normalized: "", title: "B", description: "", notes: "", web_archive_snapshot_url: "", favicon_url: "", preview_image_url: "", unread: 0, is_archived: 0, shared: 0, date_added: "2024-01-01T00:00:00Z", date_modified: "2024-01-01T00:00:00Z", date_accessed: null }, tagNames: [] },
    ];
    const html = bookmarksListPage({
      bookmarks, count: 2, q: "", sort: "added_desc", offset: 0, limit: 30,
      allTags: [], selectedTag: "", unread: "", shared: "", profile, page: "bookmarks",
      bundles: [], selectedBundleId: 0,
    });

    // Checkboxes with value matching bookmark ID
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="bookmark_id"');
    expect(html).toContain('value="1"');
    expect(html).toContain('value="2"');

    // Select all checkbox
    expect(html).toContain("select-all");

    // Bulk action bar
    expect(html).toContain('action="/bookmarks/bulk"');
    expect(html).toContain('name="bulk_action"');
  });
});
