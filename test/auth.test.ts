/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index.js";
import { setupTestDb } from "./helpers/migrations.js";

describe("API auth + profile", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });

  async function fetchProfile(authHeader?: string) {
    const headers: Record<string, string> = {};
    if (authHeader) headers["Authorization"] = authHeader;
    const request = new Request("http://localhost/api/user/profile/", { headers });
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }

  it("200 with Token auth", async () => {
    const res = await fetchProfile("Token test-token-123");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.theme).toBe("auto");
    expect(body.bookmark_date_display).toBe("relative");
    expect(body.enable_sharing).toBe(false);
    expect(body.enable_favicons).toBe(true);
    expect(body.search_preferences).toEqual({});
    expect(body.version).toBe("1.45.0");
  });

  it("200 with Bearer auth", async () => {
    const res = await fetchProfile("Bearer test-token-123");
    expect(res.status).toBe(200);
  });

  it("401 with no auth", async () => {
    const res = await fetchProfile();
    expect(res.status).toBe(401);
  });

  it("401 with wrong token", async () => {
    const res = await fetchProfile("Token wrong-token");
    expect(res.status).toBe(401);
  });

  it("401 with unsupported scheme", async () => {
    const res = await fetchProfile("Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
  });
});
