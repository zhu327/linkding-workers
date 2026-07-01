import { Hono } from "hono";
import type { Env, AppContext } from "../env.js";
import type { BundleRow } from "../db/schema.js";
import { apiTokenAuth } from "./auth.js";
import { serializeBundle } from "./serializers.js";

export const bundleRoutes = new Hono<{ Bindings: Env }>();
bundleRoutes.use("/*", apiTokenAuth);

bundleRoutes.get("/", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 1000);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);
  const count = (await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM bundles").first<{ cnt: number }>())?.cnt ?? 0;
  const rows = await c.env.DB.prepare("SELECT * FROM bundles ORDER BY \"order\" ASC LIMIT ? OFFSET ?").bind(limit, offset).all<BundleRow>();
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    count, next: offset + limit < count ? `${baseUrl}/api/bundles?limit=${limit}&offset=${offset + limit}` : null,
    previous: offset > 0 ? `${baseUrl}/api/bundles?limit=${limit}&offset=${Math.max(0, offset - limit)}` : null,
    results: rows.results.map(serializeBundle),
  });
});

bundleRoutes.post("/", async (c) => {
  const body = await c.req.json<Partial<BundleRow>>();
  if (!body.name?.trim()) return c.json({ name: ["Required."] }, 400);
  const now = new Date().toISOString();
  const order = body.order ?? 0;
  const r = await c.env.DB.prepare(
    "INSERT INTO bundles (name, search, any_tags, all_tags, excluded_tags, filter_unread, filter_shared, \"order\", date_created, date_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(body.name, body.search || "", body.any_tags || "", body.all_tags || "", body.excluded_tags || "", body.filter_unread ?? "off", body.filter_shared ?? "off", order, now, now).run();
  return c.json(serializeBundle({ id: Number(r.meta.last_row_id), name: body.name, search: body.search || "", any_tags: body.any_tags || "", all_tags: body.all_tags || "", excluded_tags: body.excluded_tags || "", filter_unread: body.filter_unread ?? "off", filter_shared: body.filter_shared ?? "off", order, date_created: now, date_modified: now }), 201);
});

bundleRoutes.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  const row = await c.env.DB.prepare("SELECT * FROM bundles WHERE id = ?").bind(id).first<BundleRow>();
  if (!row) return c.json({ detail: "Not found." }, 404);
  return c.json(serializeBundle(row));
});

async function handleBundleUpdate(c: AppContext) {
  const id = parseInt(c.req.param("id") || "", 10);
  const existing = await c.env.DB.prepare("SELECT * FROM bundles WHERE id = ?").bind(id).first<BundleRow>();
  if (!existing) return c.json({ detail: "Not found." }, 404);
  const body = await c.req.json<Partial<BundleRow>>();
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "UPDATE bundles SET name=?, search=?, any_tags=?, all_tags=?, excluded_tags=?, filter_unread=?, filter_shared=?, \"order\"=?, date_modified=? WHERE id=?"
  ).bind(body.name ?? existing.name, body.search ?? existing.search, body.any_tags ?? existing.any_tags, body.all_tags ?? existing.all_tags, body.excluded_tags ?? existing.excluded_tags, body.filter_unread ?? existing.filter_unread, body.filter_shared ?? existing.filter_shared, body.order ?? existing.order, now, id).run();
  const updated = await c.env.DB.prepare("SELECT * FROM bundles WHERE id = ?").bind(id).first<BundleRow>();
  return c.json(serializeBundle(updated!), 200);
}

bundleRoutes.put("/:id", handleBundleUpdate);
bundleRoutes.patch("/:id", handleBundleUpdate);

bundleRoutes.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  const existing = await c.env.DB.prepare("SELECT id FROM bundles WHERE id = ?").bind(id).first();
  if (!existing) return c.json({ detail: "Not found." }, 404);
  await c.env.DB.prepare("DELETE FROM bundles WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
