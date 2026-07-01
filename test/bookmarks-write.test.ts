/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

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

async function createBookmark(url: string, title?: string, tag_names?: string[]) {
  return req("/api/bookmarks", {
    method: "POST",
    headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
    body: JSON.stringify({ url, title: title || "", tag_names: tag_names || [] }),
  });
}

describe("Bookmarks API — write", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("POST creates a new bookmark → 201", async () => {
    const res = await createBookmark("https://example.com", "Example", ["web"]);
    expect(res.status).toBe(201);
    const b: any = await res.json();
    expect(b.url).toBe("https://example.com");
    expect(b.title).toBe("Example");
    expect(b.tag_names).toEqual(["web"]);
    expect(b.is_archived).toBe(false);
    expect(b.id).toBeDefined();
  });

  it("POST with duplicate URL upserts (same id, updated fields)", async () => {
    const res1 = await createBookmark("https://dup.com", "First");
    const b1: any = await res1.json();
    const res2 = await createBookmark("https://dup.com", "Updated Title", ["new-tag"]);
    const b2: any = await res2.json();
    expect(res2.status).toBe(201);
    expect(b2.id).toBe(b1.id);
    expect(b2.title).toBe("Updated Title");
    expect(b2.tag_names).toEqual(["new-tag"]);
  });

  it("PATCH updates fields", async () => {
    const res = await createBookmark("https://patch.com", "Original");
    const b: any = await res.json();
    const updateRes = await req(`/api/bookmarks/${b.id}`, {
      method: "PATCH",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Patched", tag_names: ["updated"] }),
    });
    expect(updateRes.status).toBe(200);
    const updated: any = await updateRes.json();
    expect(updated.title).toBe("Patched");
    expect(updated.tag_names).toEqual(["updated"]);
  });

  it("PATCH with duplicate URL returns 400", async () => {
    await createBookmark("https://exists.com", "First");
    const res2 = await createBookmark("https://other.com", "Second");
    const b2: any = await res2.json();
    const updateRes = await req(`/api/bookmarks/${b2.id}`, {
      method: "PATCH",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://exists.com" }),
    });
    expect(updateRes.status).toBe(400);
    const body: any = await updateRes.json();
    expect(body.url).toBeDefined();
  });

  it("DELETE returns 204", async () => {
    const res = await createBookmark("https://delete.com", "Gone");
    const b: any = await res.json();
    const delRes = await req(`/api/bookmarks/${b.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);
    const getRes = await req(`/api/bookmarks/${b.id}`);
    expect(getRes.status).toBe(404);
  });

  it("archive and unarchive toggle is_archived", async () => {
    const res = await createBookmark("https://archive.com", "Test");
    const b: any = await res.json();

    const archRes = await req(`/api/bookmarks/${b.id}/archive`, { method: "POST" });
    expect(archRes.status).toBe(204);

    const getRes = await req(`/api/bookmarks/${b.id}`);
    const updated: any = await getRes.json();
    expect(updated.is_archived).toBe(true);

    const unarchRes = await req(`/api/bookmarks/${b.id}/unarchive`, { method: "POST" });
    expect(unarchRes.status).toBe(204);

    const getRes2 = await req(`/api/bookmarks/${b.id}`);
    const updated2: any = await getRes2.json();
    expect(updated2.is_archived).toBe(false);
  });

  it("404 on missing id for delete", async () => {
    const res = await req("/api/bookmarks/9999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("404 on missing id for update", async () => {
    const patchRes = await req("/api/bookmarks/9999", {
      method: "PATCH",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(patchRes.status).toBe(404);
  });
});
