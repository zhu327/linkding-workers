import { Hono } from "hono";
import type { Env } from "../env.js";
import type { TagRow } from "../db/schema.js";
import { apiTokenAuth } from "./auth.js";
import { serializeTag } from "./serializers.js";
import { ensureTag, sanitizeTagName } from "../services/tags.js";

export const tagRoutes = new Hono<{ Bindings: Env }>();
tagRoutes.use("/*", apiTokenAuth);

// GET /api/tags/?limit=&offset=
tagRoutes.get("/", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 5000);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

  const countResult = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM tags").first<{ cnt: number }>();
  const count = countResult?.cnt ?? 0;

  const rows = await c.env.DB
    .prepare("SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<TagRow>();

  const results = rows.results.map((r) => serializeTag(r));
  const baseUrl = new URL(c.req.url).origin;
  const next =
    offset + limit < count
      ? `${baseUrl}/api/tags/?limit=${limit}&offset=${offset + limit}`
      : null;
  const previous =
    offset > 0 ? `${baseUrl}/api/tags/?limit=${limit}&offset=${Math.max(0, offset - limit)}` : null;

  return c.json({ count, next, previous, results });
});

// POST /api/tags/ — get-or-create
tagRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name?: string }>();
  if (!body.name?.trim()) {
    return c.json({ name: ["This field is required."] }, 400);
  }
  const name = sanitizeTagName(body.name);
  if (!name) {
    return c.json({ name: ["Invalid tag name."] }, 400);
  }
  const row = await ensureTag(c.env.DB, name, new Date().toISOString());
  return c.json(serializeTag(row), 201);
});
