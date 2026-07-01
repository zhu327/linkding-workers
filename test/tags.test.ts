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

describe("Tags API", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  it("GET /api/tags returns paginated empty list", async () => {
    const res = await req("/api/tags");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("results");
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.previous).toBeNull();
  });

  it("POST /api/tags creates a tag", async () => {
    const res = await req("/api/tags", {
      method: "POST",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "rust" }),
    });
    expect(res.status).toBe(201);
    const tag: any = await res.json();
    expect(tag.name).toBe("rust");
    expect(tag.id).toBeDefined();
  });

  it("POST /api/tags is idempotent (get-or-create)", async () => {
    const res1 = await req("/api/tags", {
      method: "POST",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "rust" }),
    });
    const res2 = await req("/api/tags", {
      method: "POST",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "rust" }),
    });
    const t1: any = await res1.json();
    const t2: any = await res2.json();
    expect(t1.id).toBe(t2.id);
  });

  it("GET /api/tags lists tags sorted case-insensitively", async () => {
    await req("/api/tags", {
      method: "POST",
      headers: { Authorization: "Token test-token-123", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Apple" }),
    });
    const res = await req("/api/tags?limit=100");
    const body: any = await res.json();
    const names = body.results.map((t: any) => t.name);
    expect(names).toEqual(["Apple", "rust"]);
  });
});

describe("Tag utilities", () => {
  it("parseTagString deduplicates and sorts", async () => {
    const { parseTagString } = await import("../src/services/tags.js");
    expect(parseTagString("a, b , a, C")).toEqual(["a", "b", "C"]);
  });

  it("sanitizeTagName replaces spaces with hyphens", async () => {
    const { sanitizeTagName } = await import("../src/services/tags.js");
    expect(sanitizeTagName("  hello world ")).toBe("hello-world");
  });
});
