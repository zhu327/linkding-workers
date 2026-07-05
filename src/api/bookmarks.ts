import { Hono } from "hono";
import type { Env, AppContext } from "../env.js";
import type { BookmarkRow, UserProfileRow } from "../db/schema.js";
import { getProfile } from "../db/repository.js";
import { getBookmarkById, getBookmarkByNormalizedUrl, getBookmarkTagNames, countBookmarks, listBookmarks, compileBookmarkListQuery } from "../db/repository.js";
import { apiTokenAuth } from "./auth.js";
import { serializeBookmark } from "./serializers.js";
import { deriveFaviconUrl } from "../services/favicon.js";
import { generateFallbackWebarchiveUrl } from "../services/wayback.js";
import { createBookmark, updateBookmark, deleteBookmark, setArchived, DuplicateUrlError, InvalidUrlSchemeError, NotFoundError } from "../services/bookmarks.js";
import type { CreateBookmarkInput } from "../services/bookmarks.js";
import { loadWebsiteMetadata } from "../services/scraping.js";
import { getTags as getAutoTags } from "../services/auto-tagging.js";
import { normalizeUrl } from "../services/url.js";

export const bookmarkRoutes = new Hono<{ Bindings: Env }>();
bookmarkRoutes.use("/*", apiTokenAuth);

async function serializeBookmarkRow(db: D1Database, row: BookmarkRow, profile: UserProfileRow) {
  const tagNames = await getBookmarkTagNames(db, row.id);
  const faviconUrl = row.favicon_url || deriveFaviconUrl(row.url);
  const webArchiveUrl =
    row.web_archive_snapshot_url ||
    (profile.web_archive_integration === "enabled" ? generateFallbackWebarchiveUrl(row.url, row.date_added) : null);
  return serializeBookmark(row, tagNames, { profile, faviconUrl, webArchiveUrl });
}

function buildPageUrl(reqUrlStr: string, limit: number, offset: number): string {
  const reqUrl = new URL(reqUrlStr);
  const sp = new URLSearchParams(reqUrl.searchParams);
  sp.set("limit", String(limit));
  sp.set("offset", String(offset));
  return `${reqUrl.origin}${reqUrl.pathname}?${sp}`;
}

// GET /api/bookmarks/ — list with search, sort, filters
bookmarkRoutes.get("/", async (c) => {
  const profile = await getProfile(c.env.DB);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 1000);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

  const { where, params, orderBy } = await compileBookmarkListQuery(c.env.DB, profile, {
    q: c.req.query("q") || "",
    sort: c.req.query("sort") || "added_desc",
    modifiedSince: c.req.query("modified_since") || "",
    addedSince: c.req.query("added_since") || "",
    unread: c.req.query("unread") || "",
    shared: c.req.query("shared") || "",
    bundleId: c.req.query("bundle") || "",
    page: "bookmarks",
  });

  const count = await countBookmarks(c.env.DB, where, params);
  const rows = await listBookmarks(c.env.DB, where, params, orderBy, limit, offset);
  const results = await Promise.all(rows.map((row) => serializeBookmarkRow(c.env.DB, row, profile)));

  const next = offset + limit < count ? buildPageUrl(c.req.url, limit, offset + limit) : null;
  const previous = offset > 0 ? buildPageUrl(c.req.url, limit, Math.max(0, offset - limit)) : null;

  return c.json({ count, next, previous, results });
});

// GET /api/bookmarks/archived/
bookmarkRoutes.get("/archived", async (c) => {
  const profile = await getProfile(c.env.DB);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 1000);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);

  const { where, params, orderBy } = await compileBookmarkListQuery(c.env.DB, profile, {
    sort: c.req.query("sort") || "added_desc",
    page: "archived",
  });

  const count = await countBookmarks(c.env.DB, where, params);
  const rows = await listBookmarks(c.env.DB, where, params, orderBy, limit, offset);
  const results = await Promise.all(rows.map((row) => serializeBookmarkRow(c.env.DB, row, profile)));

  const next = offset + limit < count ? buildPageUrl(c.req.url, limit, offset + limit) : null;
  const previous = offset > 0 ? buildPageUrl(c.req.url, limit, Math.max(0, offset - limit)) : null;

  return c.json({ count, next, previous, results });
});

// GET /api/bookmarks/:id/
// GET /api/bookmarks/check/?url= — check if URL is bookmarked + scrape metadata + auto-tags
bookmarkRoutes.get("/check", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ detail: "url parameter is required." }, 400);

  // Check for existing bookmark
  const normalized = normalizeUrl(url);
  const existing = await getBookmarkByNormalizedUrl(c.env.DB, normalized, url);

  const profile = await getProfile(c.env.DB);
  let bookmarkData = null;
  if (existing) {
    bookmarkData = await serializeBookmarkRow(c.env.DB, existing, profile);
  }

  // Scrape metadata
  const metadata = await loadWebsiteMetadata(url);

  // Auto-tags
  let autoTags: string[] = [];
  if (profile.auto_tagging_rules) {
    try {
      autoTags = getAutoTags(profile.auto_tagging_rules, url);
    } catch {
      // ignore auto-tag errors
    }
  }

  return c.json({
    bookmark: bookmarkData,
    metadata: { url: metadata.url, title: metadata.title, description: metadata.description, preview_image: metadata.preview_image },
    auto_tags: autoTags,
  });
});

bookmarkRoutes.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ detail: "Invalid bookmark ID." }, 400);

  const row = await getBookmarkById(c.env.DB, id);
  if (!row) return c.json({ detail: "Not found." }, 404);

  const profile = await getProfile(c.env.DB);
  return c.json(await serializeBookmarkRow(c.env.DB, row, profile));
});

// POST /api/bookmarks/ — create or upsert on duplicate URL
bookmarkRoutes.post("/", async (c) => {
  const profile = await getProfile(c.env.DB);
  const body = await c.req.json<{
    url?: string;
    title?: string;
    description?: string;
    notes?: string;
    preview_image_url?: string;
    is_archived?: boolean;
    unread?: boolean;
    shared?: boolean;
    tag_names?: string[];
    date_added?: string;
    date_modified?: string;
  }>();

  if (!body.url?.trim()) {
    return c.json({ url: ["This field is required."] }, 400);
  }

  try {
    const saved = await createBookmark(c.env.DB, body as CreateBookmarkInput, profile);
    return c.json(await serializeBookmarkRow(c.env.DB, saved, profile), 201);
  } catch (e) {
    if (e instanceof InvalidUrlSchemeError) {
      return c.json({ url: [e.message] }, 400);
    }
    throw e;
  }
});

// PUT/PATCH /api/bookmarks/:id/
async function handleUpdate(c: AppContext) {
  const id = parseInt(c.req.param("id") || "", 10);
  if (isNaN(id)) return c.json({ detail: "Invalid bookmark ID." }, 400);

  const body = await c.req.json<any>();
  const profile = await getProfile(c.env.DB);

  try {
    const updated = await updateBookmark(c.env.DB, id, body, profile);
    return c.json(await serializeBookmarkRow(c.env.DB, updated, profile));
  } catch (e) {
    if (e instanceof DuplicateUrlError) return c.json({ url: [e.message] }, 400);
    if (e instanceof InvalidUrlSchemeError) return c.json({ url: [e.message] }, 400);
    if (e instanceof NotFoundError) return c.json({ detail: "Not found." }, 404);
    throw e;
  }
}

bookmarkRoutes.put("/:id", handleUpdate);
bookmarkRoutes.patch("/:id", handleUpdate);

// DELETE /api/bookmarks/:id/
bookmarkRoutes.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ detail: "Invalid bookmark ID." }, 400);
  try {
    await deleteBookmark(c.env.DB, id);
    return c.body(null, 204);
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ detail: "Not found." }, 404);
    throw e;
  }
});

// POST /api/bookmarks/:id/archive
bookmarkRoutes.post("/:id/archive", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ detail: "Invalid bookmark ID." }, 400);
  if (!(await getBookmarkById(c.env.DB, id))) return c.json({ detail: "Not found." }, 404);
  await setArchived(c.env.DB, id, true);
  return c.body(null, 204);
});

// POST /api/bookmarks/:id/unarchive
bookmarkRoutes.post("/:id/unarchive", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) return c.json({ detail: "Invalid bookmark ID." }, 400);
  if (!(await getBookmarkById(c.env.DB, id))) return c.json({ detail: "Not found." }, 404);
  await setArchived(c.env.DB, id, false);
  return c.body(null, 204);
});
