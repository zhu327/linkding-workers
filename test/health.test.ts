/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../src/index.js";
import { applyMigrations } from "./helpers/migrations.js";

describe("Health endpoint", () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it("GET /health returns 200 ok", async () => {
    const request = new Request("http://localhost/health");
    const ctx = createExecutionContext();
    const response = await app.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("D1 binding works — can read seeded user_profile", async () => {
    const result = await env.DB.prepare("SELECT * FROM user_profile WHERE id = 1").first();
    expect(result).toBeTruthy();
    expect((result as any).theme).toBe("auto");
  });
});
