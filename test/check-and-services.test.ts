/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

async function req(path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }) {
  const mergedHeaders = { Authorization: "Token test-token-123", ...opts?.headers };
  const { headers: _, ...restOpts } = opts || {};
  const request = new Request(`http://localhost${path}`, {
    headers: mergedHeaders,
    ...restOpts,
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Check endpoint", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
    // Set custom auto_tagging_rules for tests
    await env.DB.prepare("UPDATE user_profile SET auto_tagging_rules = ? WHERE id = 1").bind("github.com dev\ndocs.google.com docs work").run();
    // Seed a bookmark
    await env.DB.prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, date_added, date_modified) VALUES (?, ?, ?, ?, ?)"
    ).bind("https://example.com", "https://example.com", "Existing", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z").run();
  });

  it("GET /api/bookmarks/check?url= returns bookmark when exists", async () => {
    const res = await req("/api/bookmarks/check?url=https%3A%2F%2Fexample.com");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.bookmark).toBeTruthy();
    expect(body.bookmark.url).toBe("https://example.com");
    expect(body.metadata).toBeDefined();
    expect(body.auto_tags).toBeDefined();
    expect(Array.isArray(body.auto_tags)).toBe(true);
  });

  it("GET /api/bookmarks/check?url= returns null bookmark when not exists", async () => {
    // Use localhost URL to avoid DNS issues in Workers test runtime
    const res = await req("/api/bookmarks/check?url=http%3A%2F%2Flocalhost%2Fnonexistent");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.bookmark).toBeNull();
    expect(body.metadata).toBeDefined();
  });

  it("auto-tags are computed from rules", async () => {
    const res = await req("/api/bookmarks/check?url=https%3A%2F%2Fgithub.com%2Frepo");
    const body: any = await res.json();
    expect(body.auto_tags).toContain("dev");
  });

  it("GET /api/bookmarks/check without url returns 400", async () => {
    const res = await req("/api/bookmarks/check");
    expect(res.status).toBe(400);
  });
});

describe("Auto-tagging service", () => {
  it("matches host and returns tags", async () => {
    const { getTags } = await import("../src/services/auto-tagging.js");
    const rules = "github.com dev\ndocs.google.com docs work";
    expect(getTags(rules, "https://github.com/some/repo")).toEqual(["dev"]);
    expect(getTags(rules, "https://docs.google.com/document/d/123")).toEqual(["docs", "work"]);
    expect(getTags(rules, "https://example.com")).toEqual([]);
  });

  it("ignores comments and empty lines", async () => {
    const { getTags } = await import("../src/services/auto-tagging.js");
    const rules = "# comment\n\ngithub.com dev\n# another comment";
    expect(getTags(rules, "https://github.com/repo")).toEqual(["dev"]);
  });

  it("matches path prefix", async () => {
    const { getTags } = await import("../src/services/auto-tagging.js");
    const rules = "github.com/user private";
    expect(getTags(rules, "https://github.com/user/repo")).toEqual(["private"]);
    expect(getTags(rules, "https://github.com/other/repo")).toEqual([]);
  });
});

describe("Scraping service", () => {
  it("parseMetadata extracts title, description, og:image", async () => {
    const { parseMetadata } = await import("../src/services/scraping.js");
    const html = `
      <html><head>
        <title>Test Page</title>
        <meta name="description" content="A test description">
        <meta property="og:image" content="https://example.com/image.png">
      </head><body></body></html>
    `;
    const meta = parseMetadata(html, "https://example.com");
    expect(meta.title).toBe("Test Page");
    expect(meta.description).toBe("A test description");
    expect(meta.preview_image).toBe("https://example.com/image.png");
  });

  it("parseMetadata resolves relative og:image", async () => {
    const { parseMetadata } = await import("../src/services/scraping.js");
    const html = `<html><head><meta property="og:image" content="/img/preview.jpg"></head></html>`;
    const meta = parseMetadata(html, "https://example.com/page");
    expect(meta.preview_image).toBe("https://example.com/img/preview.jpg");
  });

  it("parseMetadata returns nulls on empty HTML", async () => {
    const { parseMetadata } = await import("../src/services/scraping.js");
    const meta = parseMetadata("", "https://example.com");
    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
    expect(meta.preview_image).toBeNull();
  });
});

describe("Auto-tagging on update", () => {
  it("PATCH with tag_names merges auto-tags", async () => {
    // Create a bookmark
    const createRes = await req("/api/bookmarks", {
      method: "POST",
      headers: { "Authorization": "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/test-repo", title: "Auto-tag test", tag_names: ["manual"] }),
    });
    const b: any = await createRes.json();

    // Update with tag_names - auto-tags should be merged
    const updateRes = await req(`/api/bookmarks/${b.id}`, {
      method: "PATCH",
      headers: { "Authorization": "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ tag_names: ["updated"] }),
    });
    expect(updateRes.status).toBe(200);
    const updated: any = await updateRes.json();
    expect(updated.tag_names).toContain("updated");
    expect(updated.tag_names).toContain("dev"); // auto-tag from rules
  });
});

describe("Auto-tagging domain matching", () => {
  it("notgithub.com does not match github.com", async () => {
    const { getTags } = await import("../src/services/auto-tagging.js");
    const rules = "github.com dev";
    expect(getTags(rules, "https://notgithub.com/repo")).toEqual([]);
    expect(getTags(rules, "https://github.com/repo")).toEqual(["dev"]);
  });

  it("subdomain.github.com matches github.com", async () => {
    const { getTags } = await import("../src/services/auto-tagging.js");
    const rules = "github.com dev";
    expect(getTags(rules, "https://docs.github.com/repo")).toEqual(["dev"]);
  });
});
