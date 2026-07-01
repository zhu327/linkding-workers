/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import workerApp, { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

/**
 * Extension Compatibility E2E Contract Tests (T13)
 *
 * Asserts the server behaves exactly as the official linkding browser extension expects.
 * Based on linkding-extension/src/linkding.js call sequences.
 *
 * All requests go through the Workers default export (workerApp.fetch), which
 * strips trailing slashes before dispatching to Hono — exactly matching the
 * extension's trailing-slash URL conventions.
 */

// Uses the Workers default export (real entry point with trailing-slash normalization).
async function api(path: string, opts?: { method?: string; body?: unknown; token?: string }) {
  const headers: Record<string, string> = { Authorization: `Token ${opts?.token || "test-token-123"}` };
  if (opts?.body) headers["Content-Type"] = "application/json";
  const request = new Request(`http://localhost${path}`, {
    method: opts?.method || "GET",
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const ctx = createExecutionContext();
  const response = await workerApp.fetch(request, env as any, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Extension Compatibility Contract", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  // 1. testConnection: GET /api/bookmarks/?limit=1 → 200 with results array
  it("testConnection: GET /api/bookmarks/?limit=1 → 200 with results", async () => {
    const res = await api("/api/bookmarks/?limit=1");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  // 2. check: GET /api/bookmarks/check/?url= → 200 {bookmark, metadata, auto_tags}
  it("check: returns {bookmark, metadata, auto_tags}", async () => {
    const res = await api("/api/bookmarks/check/?url=http%3A%2F%2Flocalhost%2Ftest");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("bookmark");
    expect(body).toHaveProperty("metadata");
    expect(body).toHaveProperty("auto_tags");
    expect(Array.isArray(body.auto_tags)).toBe(true);
  });

  // 3. saveBookmark (new): POST /api/bookmarks/?disable_scraping → 201
  it("saveBookmark new: POST → 201 with full bookmark object", async () => {
    const res = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://contract-test.com", title: "Contract Test", tag_names: ["test"], unread: false, shared: false },
    });
    expect(res.status).toBe(201);
    const b: any = await res.json();
    // Verify exact field set and types
    expect(typeof b.id).toBe("number");
    expect(typeof b.url).toBe("string");
    expect(typeof b.title).toBe("string");
    expect(typeof b.description).toBe("string");
    expect(typeof b.notes).toBe("string");
    expect(typeof b.is_archived).toBe("boolean");
    expect(typeof b.unread).toBe("boolean");
    expect(typeof b.shared).toBe("boolean");
    expect(Array.isArray(b.tag_names)).toBe(true);
    expect(typeof b.date_added).toBe("string");
    expect(typeof b.date_modified).toBe("string");
    expect(b.website_title).toBeNull();
    expect(b.website_description).toBeNull();
    expect(b.url).toBe("https://contract-test.com");
    expect(b.title).toBe("Contract Test");
    expect(b.tag_names).toContain("test");
  });

  // 4. saveBookmark (upsert): POST same URL → 201, same id, updated fields
  it("saveBookmark upsert: POST same URL → 201, same id", async () => {
    const res1 = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://upsert-test.com", title: "V1" },
    });
    const b1: any = await res1.json();
    const res2 = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://upsert-test.com", title: "V2" },
    });
    expect(res2.status).toBe(201);
    const b2: any = await res2.json();
    expect(b2.id).toBe(b1.id);
    expect(b2.title).toBe("V2");
  });

  // 5. getBookmark: GET /api/bookmarks/:id/ → 200
  it("getBookmark: GET /api/bookmarks/:id/ → 200", async () => {
    const res = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://get-test.com", title: "Get Test" },
    });
    const b: any = await res.json();
    const getRes = await api(`/api/bookmarks/${b.id}/`);
    expect(getRes.status).toBe(200);
    const got: any = await getRes.json();
    expect(got.id).toBe(b.id);
  });

  // 6. search: GET /api/bookmarks/?q=&limit= → 200 {results}
  it("search: GET /api/bookmarks/?q=test&limit=10 → 200 with results", async () => {
    const res = await api("/api/bookmarks/?q=test&limit=10");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });

  // 6b. search: ?unread=true filter
  it("search: ?unread=true filters unread bookmarks", async () => {
    // Seed one unread and one read bookmark
    const r1 = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://unread-filter-test.com/unread", title: "Unread", unread: true },
    });
    const b1: any = await r1.json();
    const r2 = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://unread-filter-test.com/read", title: "Read", unread: false },
    });
    const b2: any = await r2.json();

    const res = await api("/api/bookmarks/?unread=true");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const urls = body.results.map((r: any) => r.url);
    expect(urls).toContain("https://unread-filter-test.com/unread");
    expect(urls).not.toContain("https://unread-filter-test.com/read");

    // Cleanup
    await api(`/api/bookmarks/${b1.id}/`, { method: "DELETE" });
    await api(`/api/bookmarks/${b2.id}/`, { method: "DELETE" });
  });

  // 7. getTags: GET /api/tags/?limit=5000 → 200 {results: [{id, name, date_added}]}
  it("getTags: GET /api/tags/?limit=5000 → 200 with results", async () => {
    const res = await api("/api/tags/?limit=5000");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    if (body.results.length > 0) {
      expect(body.results[0]).toHaveProperty("id");
      expect(body.results[0]).toHaveProperty("name");
      expect(body.results[0]).toHaveProperty("date_added");
    }
  });

  // 8. getUserProfile: GET /api/user/profile/ → 200
  it("getUserProfile: GET /api/user/profile/ → 200", async () => {
    const res = await api("/api/user/profile/");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("theme");
    expect(body).toHaveProperty("version");
    expect(typeof body.enable_sharing).toBe("boolean");
    expect(body.version).toBe("1.45.0");
  });

  // 9. deleteBookmark: DELETE /api/bookmarks/:id/ → 204
  it("deleteBookmark: DELETE → 204", async () => {
    const res = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://delete-contract-test.com" },
    });
    const b: any = await res.json();
    const delRes = await api(`/api/bookmarks/${b.id}/`, { method: "DELETE" });
    expect(delRes.status).toBe(204);
  });

  // 10. Auth: Token and Bearer both work, missing → 401
  it("Auth: missing token → 401", async () => {
    const request = new Request("http://localhost/api/bookmarks/?limit=1");
    const ctx = createExecutionContext();
    const res = await workerApp.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("Auth: Bearer works", async () => {
    const request = new Request("http://localhost/api/bookmarks/?limit=1", {
      headers: { Authorization: "Bearer test-token-123" },
    });
    const ctx = createExecutionContext();
    const res = await workerApp.fetch(request, env as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
  });

  // 11. Pagination shape
  it("Pagination: {count, next, previous, results}", async () => {
    const res = await api("/api/bookmarks/?limit=1&offset=0");
    const body: any = await res.json();
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("next");
    expect(body).toHaveProperty("previous");
    expect(body).toHaveProperty("results");
    expect(typeof body.count).toBe("number");
  });

  // 12. Bundles API
  it("Bundles: CRUD works", async () => {
    const createRes = await api("/api/bundles/", { method: "POST", body: { name: "Test Bundle", any_tags: "dev" } });
    expect(createRes.status).toBe(201);
    const bundle: any = await createRes.json();
    expect(bundle.name).toBe("Test Bundle");

    const listRes = await api("/api/bundles/");
    expect(listRes.status).toBe(200);
    const list: any = await listRes.json();
    expect(list.results.length).toBeGreaterThan(0);

    const delRes = await api(`/api/bundles/${bundle.id}/`, { method: "DELETE" });
    expect(delRes.status).toBe(204);
  });
});

describe("Search engine", () => {
  it("parseSearchQuery handles terms, tags, operators, grouping", async () => {
    const { parseSearchQuery } = await import("../src/services/search.js");
    // Simple term
    expect(parseSearchQuery("hello")).toEqual({ type: "term", term: "hello" });
    // Tag
    expect(parseSearchQuery("#rust")).toEqual({ type: "tag", tag: "rust" });
    // AND (implicit)
    const and = parseSearchQuery("rome #book");
    expect(and?.type).toBe("and");
    // OR
    const or = parseSearchQuery("#article or #book");
    expect(or?.type).toBe("or");
    // NOT
    const not = parseSearchQuery("not #article");
    expect(not?.type).toBe("not");
    // Grouping
    const grouped = parseSearchQuery("rome (#article or #book)");
    expect(grouped?.type).toBe("and");
    // Quoted phrase
    const phrase = parseSearchQuery('"history of rome"');
    expect(phrase).toEqual({ type: "term", term: "history of rome" });
    // Empty
    expect(parseSearchQuery("")).toBeNull();
  });

  it("compileSearch produces valid SQL fragments", async () => {
    const { parseSearchQuery, compileSearch } = await import("../src/services/search.js");
    const ast = parseSearchQuery("rome #book");
    const compiled = compileSearch(ast);
    expect(compiled).toBeTruthy();
    expect(compiled!.whereSql).toContain("LIKE");
    expect(compiled!.whereSql).toContain("EXISTS");
    expect(compiled!.params.length).toBeGreaterThan(0);
  });

  it("compileSearch lax mode includes tag matching for bare terms", async () => {
    const { parseSearchQuery, compileSearch } = await import("../src/services/search.js");
    const ast = parseSearchQuery("rust");
    const compiled = compileSearch(ast, { lax: true });
    expect(compiled).toBeTruthy();
    expect(compiled!.whereSql).toContain("LIKE");
    expect(compiled!.whereSql).toContain("EXISTS"); // lax mode also matches tags
  });

  it("expressionToString round-trips", async () => {
    const { parseSearchQuery, expressionToString } = await import("../src/services/search.js");
    const ast = parseSearchQuery("hello #world");
    const str = expressionToString(ast);
    expect(str).toContain("hello");
    expect(str).toContain("#world");
  });

  it("extractTagNamesFromQuery extracts tags", async () => {
    const { extractTagNamesFromQuery } = await import("../src/services/search.js");
    const tags = extractTagNamesFromQuery("hello #rust #python", false);
    expect(tags).toEqual(["python", "rust"]);
  });

  it("extractTagNamesFromQuery lax mode includes bare terms", async () => {
    const { extractTagNamesFromQuery } = await import("../src/services/search.js");
    const tags = extractTagNamesFromQuery("hello #rust", true);
    expect(tags).toEqual(["hello", "rust"]);
  });

  it("compileLegacySearch produces AND-of-terms SQL", async () => {
    const { compileLegacySearch } = await import("../src/services/search.js");
    const compiled = compileLegacySearch("hello world");
    expect(compiled).toBeTruthy();
    expect(compiled!.whereSql).toContain("AND");
    expect(compiled!.params.length).toBe(8); // 4 per term × 2 terms
  });

  it("parses !untagged / !unread as special keywords", async () => {
    const { parseSearchQuery } = await import("../src/services/search.js");
    expect(parseSearchQuery("!untagged")).toEqual({ type: "keyword", keyword: "untagged" });
    expect(parseSearchQuery("!unread")).toEqual({ type: "keyword", keyword: "unread" });
    // combinable with other expressions via implicit AND
    expect(parseSearchQuery("!untagged rust")?.type).toBe("and");
  });

  it("compileSearch translates !untagged / !unread to SQL", async () => {
    const { parseSearchQuery, compileSearch } = await import("../src/services/search.js");
    const untagged = compileSearch(parseSearchQuery("!untagged"))!;
    expect(untagged.whereSql).toContain("NOT EXISTS");
    expect(untagged.whereSql).toContain("bookmark_tags");
    expect(untagged.params).toEqual([]);

    const unread = compileSearch(parseSearchQuery("!unread"))!;
    expect(unread.whereSql).toBe("unread = 1");
    expect(unread.params).toEqual([]);

    // unknown special keyword matches all
    const unknown = compileSearch(parseSearchQuery("!unknown"))!;
    expect(unknown.whereSql).toBe("1=1");
  });

  it("expressionToString round-trips special keywords", async () => {
    const { parseSearchQuery, expressionToString } = await import("../src/services/search.js");
    expect(expressionToString(parseSearchQuery("!untagged"))).toBe("!untagged");
  });

  it("compileLegacySearch handles !untagged / !unread", async () => {
    const { compileLegacySearch } = await import("../src/services/search.js");
    const untagged = compileLegacySearch("!untagged")!;
    expect(untagged.whereSql).toContain("NOT EXISTS");
    expect(untagged.params).toEqual([]);

    const combined = compileLegacySearch("rust !untagged")!;
    expect(combined.whereSql).toContain("LIKE");
    expect(combined.whereSql).toContain("NOT EXISTS");
    expect(combined.params.length).toBe(4); // only the "rust" term contributes params

    // unknown special keyword ignored → no conditions → null
    expect(compileLegacySearch("!unknown")).toBeNull();
  });
});

describe("Exact field set assertions", () => {
  const BOOKMARK_FIELDS = ["id", "url", "title", "description", "notes", "web_archive_snapshot_url", "favicon_url", "preview_image_url", "is_archived", "unread", "shared", "tag_names", "date_added", "date_modified", "website_title", "website_description"];

  it("bookmark response has exactly 16 fields", async () => {
    const res = await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://exact-fields-test.com", title: "Fields Test" },
    });
    const b: any = await res.json();
    const keys = Object.keys(b).sort();
    expect(keys).toEqual([...BOOKMARK_FIELDS].sort());
  });

  it("profile response has expected fields", async () => {
    const res = await api("/api/user/profile/");
    const body: any = await res.json();
    expect(body).toHaveProperty("theme");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("enable_sharing");
    expect(body).toHaveProperty("enable_favicons");
    expect(body).toHaveProperty("tag_search");
    expect(body).toHaveProperty("web_archive_integration");
    expect(body).toHaveProperty("search_preferences");
    expect(typeof body.version).toBe("string");
  });
});

describe("Bundle filter", () => {
  it("GET /api/bookmarks/?bundle=<id> filters by bundle criteria", async () => {
    // Create a bookmark with specific tag
    await api("/api/bookmarks/?disable_scraping", {
      method: "POST",
      body: { url: "https://bundle-filter-test.com", title: "Bundle Test", tag_names: ["dev"] },
    });

    // Create a bundle that filters by tag
    const bundleRes = await api("/api/bundles/", {
      method: "POST",
      body: { name: "Dev Bundle", any_tags: "dev" },
    });
    const bundle: any = await bundleRes.json();

    // Query bookmarks with bundle filter
    const listRes = await api(`/api/bookmarks/?bundle=${bundle.id}`);
    expect(listRes.status).toBe(200);
    const body: any = await listRes.json();
    expect(body.results.some((r: any) => r.url === "https://bundle-filter-test.com")).toBe(true);

    // Cleanup
    await api(`/api/bundles/${bundle.id}/`, { method: "DELETE" });
  });

  it("bundle DELETE returns 404 for missing id", async () => {
    const res = await api("/api/bundles/99999/", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("PATCH /api/bundles/:id/ performs partial update", async () => {
    const createRes = await api("/api/bundles/", { method: "POST", body: { name: "Patch Test", any_tags: "dev", search: "original" } });
    const bundle: any = await createRes.json();

    const patchRes = await api(`/api/bundles/${bundle.id}/`, { method: "PATCH", body: { name: "renamed" } });
    expect(patchRes.status).toBe(200);
    const patched: any = await patchRes.json();
    expect(patched.name).toBe("renamed");
    // Other fields preserved
    expect(patched.any_tags).toBe("dev");
    expect(patched.search).toBe("original");

    // Cleanup
    await api(`/api/bundles/${bundle.id}/`, { method: "DELETE" });
  });

  it("PATCH /api/bundles/9999/ returns 404", async () => {
    const res = await api("/api/bundles/9999/", { method: "PATCH", body: { name: "renamed" } });
    expect(res.status).toBe(404);
  });
});
