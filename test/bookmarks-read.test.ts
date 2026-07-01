/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

async function seedBookmark(url: string, title: string, opts?: { is_archived?: number; tags?: string[]; date_added?: string }) {
  const now = opts?.date_added || new Date().toISOString();
  const urlNormalized = url.toLowerCase().replace(/\/+$/, "");
  const result = await env.DB.prepare(
    "INSERT INTO bookmarks (url, url_normalized, title, date_added, date_modified, is_archived) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(url, urlNormalized, title, now, now, opts?.is_archived ?? 0).run();
  const id = Number(result.meta.last_row_id);
  if (opts?.tags) {
    for (const tagName of opts.tags) {
      let tag = await env.DB.prepare("SELECT id FROM tags WHERE name = ?").bind(tagName).first<{ id: number }>();
      if (!tag) {
        const tr = await env.DB.prepare("INSERT INTO tags (name, date_added) VALUES (?, ?)").bind(tagName, now).run();
        tag = { id: Number(tr.meta.last_row_id) };
      }
      await env.DB.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(id, tag.id).run();
    }
  }
  return id;
}

async function req(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) {
  const request = new Request(`http://localhost${path}`, {
    headers: { Authorization: "Token test-token-123", ...opts?.headers },
    ...opts,
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Bookmarks API — read", () => {
  let bookmarkId: number;

  beforeAll(async () => {
    await setupTestDb(env.DB);
    bookmarkId = await seedBookmark("https://example.com", "Example", { tags: ["web", "test"], date_added: "2024-06-01T00:00:00Z" });
    await seedBookmark("https://rust-lang.org", "Rust Language", { tags: ["rust"], date_added: "2024-07-01T00:00:00Z" });
    await seedBookmark("https://archived.example.com", "Archived Page", { is_archived: 1, date_added: "2024-05-01T00:00:00Z" });
  });

  it("GET /api/bookmarks returns paginated list", async () => {
    const res = await req("/api/bookmarks");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.count).toBe(2); // excludes archived
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toHaveProperty("id");
    expect(body.results[0]).toHaveProperty("tag_names");
    expect(Array.isArray(body.results[0].tag_names)).toBe(true);
    expect(body.results[0].website_title).toBeNull();
    expect(body.results[0].website_description).toBeNull();
    expect(typeof body.results[0].is_archived).toBe("boolean");
    expect(typeof body.results[0].unread).toBe("boolean");
  });

  it("bookmark fields have correct types", async () => {
    const res = await req(`/api/bookmarks/${bookmarkId}`);
    const b: any = await res.json();
    expect(b.id).toBe(bookmarkId);
    expect(b.url).toBe("https://example.com");
    expect(b.title).toBe("Example");
    expect(b.tag_names).toEqual(["test", "web"]); // sorted
    expect(b.is_archived).toBe(false);
    expect(b.favicon_url).toBeTruthy();
  });

  it("GET /api/bookmarks/:id returns 404 for missing", async () => {
    const res = await req("/api/bookmarks/9999");
    expect(res.status).toBe(404);
  });

  it("GET /api/bookmarks/archived lists only archived", async () => {
    const res = await req("/api/bookmarks/archived");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].title).toBe("Archived Page");
  });

  it("search q matches title case-insensitively", async () => {
    const res = await req("/api/bookmarks?q=rust");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].title).toBe("Rust Language");
  });

  it("sort added_asc orders oldest first", async () => {
    const res = await req("/api/bookmarks?sort=added_asc");
    const body: any = await res.json();
    expect(body.results[0].title).toBe("Example"); // 2024-06-01 before 2024-07-01
  });
});

describe("Boolean-style unread filters", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
    await env.DB.prepare("DELETE FROM bookmark_tags").run();
    await env.DB.prepare("DELETE FROM tags").run();
    await env.DB.prepare("DELETE FROM bookmarks").run();
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, unread, date_added, date_modified) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind("https://unread.example.com", "https://unread.example.com", "Unread Page", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, unread, date_added, date_modified) VALUES (?, ?, ?, 0, ?, ?)"
    ).bind("https://read.example.com", "https://read.example.com", "Read Page", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
  });

  it("?unread=yes returns only unread", async () => {
    const res = await req("/api/bookmarks?unread=yes");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://unread.example.com");
  });

  it("?unread=no returns only read", async () => {
    const res = await req("/api/bookmarks?unread=no");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://read.example.com");
  });

  it("?unread=true (boolean-style) returns only unread", async () => {
    const res = await req("/api/bookmarks?unread=true");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://unread.example.com");
  });

  it("?unread=false (boolean-style) returns only read", async () => {
    const res = await req("/api/bookmarks?unread=false");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://read.example.com");
  });

  it("?unread=1 returns only unread", async () => {
    const res = await req("/api/bookmarks?unread=1");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://unread.example.com");
  });

  it("?unread=0 returns only read", async () => {
    const res = await req("/api/bookmarks?unread=0");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://read.example.com");
  });

  it("?unread=garbage returns all (filter ignored)", async () => {
    const res = await req("/api/bookmarks?unread=garbage");
    const body: any = await res.json();
    expect(body.count).toBe(2);
  });
});

describe("Boolean-style shared filters", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
    await env.DB.prepare("DELETE FROM bookmark_tags").run();
    await env.DB.prepare("DELETE FROM tags").run();
    await env.DB.prepare("DELETE FROM bookmarks").run();
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, shared, date_added, date_modified) VALUES (?, ?, ?, 1, ?, ?)"
    ).bind("https://shared.example.com", "https://shared.example.com", "Shared Page", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, shared, date_added, date_modified) VALUES (?, ?, ?, 0, ?, ?)"
    ).bind("https://private.example.com", "https://private.example.com", "Private Page", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
  });

  it("?shared=yes returns only shared", async () => {
    const res = await req("/api/bookmarks?shared=yes");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://shared.example.com");
  });

  it("?shared=true (boolean-style) returns only shared", async () => {
    const res = await req("/api/bookmarks?shared=true");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://shared.example.com");
  });

  it("?shared=false (boolean-style) returns only not-shared", async () => {
    const res = await req("/api/bookmarks?shared=false");
    const body: any = await res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].url).toBe("https://private.example.com");
  });
});

describe("Service utilities", () => {
  it("normalizeUrl lowercases scheme/host, strips trailing slash, sorts query", async () => {
    const { normalizeUrl } = await import("../src/services/url.js");
    expect(normalizeUrl("HTTPS://Example.com/A/?b=2&a=1")).toBe("https://example.com/A?a=1&b=2");
  });

  it("generateFallbackWebarchiveUrl returns correct format", async () => {
    const { generateFallbackWebarchiveUrl } = await import("../src/services/wayback.js");
    const url = generateFallbackWebarchiveUrl("https://example.com", "2024-06-15T12:30:45Z");
    expect(url).toBe("https://web.archive.org/web/20240615123045/https://example.com");
  });

  it("deriveFaviconUrl returns google favicon URL", async () => {
    const { deriveFaviconUrl } = await import("../src/services/favicon.js");
    expect(deriveFaviconUrl("https://example.com/page")).toBe("https://www.google.com/s2/favicons?domain=example.com&sz=32");
  });
});
