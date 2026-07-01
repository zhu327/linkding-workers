import { Hono } from "hono";
import type { Env, AppContext } from "../env.js";

declare module "hono" {
  interface ContextVariableMap {
    anonymous: boolean;
  }
}
import type { BookmarkRow, TagRow, BundleRow, ApiTokenRow, FeedTokenRow } from "../db/schema.js";
import { getProfile } from "../db/repository.js";
import { getBookmarkById, getBookmarkTagNames, countBookmarks, listBookmarks, listAllTags, listBundles, getBundleById, listApiTokens, compileBookmarkListQuery, listTagsWithCounts, countAllTags } from "../db/repository.js";
import { webAuth, createSession, setSessionCookie, clearSessionCookie } from "./auth.js";
import { verifyPassword } from "../services/password.js";
import { issueCsrf, verifyCsrf, CSRF_COOKIE_NAME } from "./csrf.js";
import { loginBody } from "./views/login.js";
import { layout } from "./views/layout.js";
import { bookmarksListPage } from "./views/bookmarks.js";
import { bookmarkFormPage } from "./views/bookmark-form.js";
import { bookmarkDetailPage, bookmarkDetailModal } from "./views/bookmark-detail.js";
import { tagsPage } from "./views/tags-view.js";
import { bundlesPage } from "./views/bundles-view.js";
import { settingsPage } from "./views/settings-view.js";
import { createBookmark, updateBookmark, deleteBookmark, setArchived, bulkArchive, bulkUnarchive, bulkDelete, bulkMarkRead, bulkMarkUnread, bulkShare, bulkUnshare, bulkTag, bulkUntag, InvalidUrlSchemeError } from "../services/bookmarks.js";
import { isAllowedScheme } from "../utils/html.js";
import { ensureTag, parseTagString } from "../services/tags.js";
import { parseNetscape, exportNetscapeHtml } from "../services/netscape.js";
import { buildAtomFeed } from "../services/feeds.js";

export const webRouter = new Hono<{ Bindings: Env }>();

// CSRF helper: generate token and set cookie for views
async function getCsrfToken(env: Env): Promise<string> {
  const secret = env.SESSION_SECRET || "default-secret";
  return issueCsrf(secret);
}

// CSRF verification middleware for POST routes
const csrfVerify = async (c: AppContext, next: () => Promise<void>) => {
  const cookie = c.req.header("Cookie") || "";
  const csrfMatch = cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`));
  const cookieToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : "";

  let formToken = "";
  const contentType = c.req.header("Content-Type") || "";
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const form = await c.req.formData();
      formToken = (form.get("_csrf") as string) || "";
      // Re-set the form data so handlers can read it
      c.set("_formData", form);
    } catch {
      formToken = "";
    }
  }

  const secret = c.env.SESSION_SECRET || "default-secret";
  if (!formToken || !(await verifyCsrf(secret, formToken))) {
    return c.json({ detail: "CSRF validation failed." }, 403);
  }

  await next();
};

// Helper to get form data. Works with or without csrfVerify middleware.
async function getFormData(c: AppContext): Promise<FormData> {
  const cached = c.get("_formData") as FormData | undefined;
  if (cached) return cached;
  return await c.req.formData();
}

// ── Login / Logout ──────────────────────────────────────────────────
webRouter.get("/login", async (c) => {
  const csrf = await getCsrfToken(c.env);
  const profile = await getProfile(c.env.DB);
  return c.html(layout("Login", loginBody(csrf), { profile, anonymous: true, csrfToken: csrf }));
});

webRouter.post("/login", csrfVerify, async (c) => {
  const form = await getFormData(c);
  const password = form.get("password") as string || "";
  if (!(await verifyPassword(c.env, password))) {
    const csrf = await getCsrfToken(c.env);
    const profile = await getProfile(c.env.DB);
    return c.html(layout("Login", loginBody(csrf, "Invalid password."), { profile, anonymous: true, csrfToken: csrf }), 401);
  }
  const session = await createSession(c.env);
  c.header("Set-Cookie", setSessionCookie(session));
  return c.redirect("/bookmarks", 302);
});

webRouter.get("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.redirect("/login", 302);
});

webRouter.get("/", (c) => c.redirect("/bookmarks", 302));

// ── Bookmarks list ──────────────────────────────────────────────────
async function renderBookmarkList(c: AppContext, page: "bookmarks" | "archived" | "shared"): Promise<Response> {
  const db = c.env.DB;
  const profile = await getProfile(db);
  const bundles = await listBundles(db);
  let q = c.req.query("q") || "";
  let sort = c.req.query("sort") || "added_desc";
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);
  const limit = profile.items_per_page || 30;
  let selectedTag = c.req.query("tag") || "";
  let unread = c.req.query("unread") || "";
  let shared = c.req.query("shared") || "";
  const bundleId = c.req.query("bundle") || "";
  let selectedBundleId = 0;

  // Apply bundle filters when a bundle is selected.
  if (bundleId) {
    const bundle = await getBundleById(db, parseInt(bundleId, 10));
    if (bundle) {
      selectedBundleId = bundle.id;
      if (bundle.search) q = bundle.search;
      if (bundle.filter_unread === "yes") unread = "yes";
      else if (bundle.filter_unread === "no") unread = "no";
      if (bundle.filter_shared === "yes") shared = "yes";
      else if (bundle.filter_shared === "no") shared = "no";
      if (bundle.any_tags) selectedTag = bundle.any_tags.split(/\s+/)[0] || selectedTag;
    }
  }

  const { where, params, orderBy } = await compileBookmarkListQuery(db, profile, {
    q, sort, unread, shared, selectedTag, page,
  });

  const count = await countBookmarks(db, where, params);
  const rows = await listBookmarks(db, where, params, orderBy, limit, offset);
  const allTags = await listAllTags(db);

  const bookmarks = await Promise.all(rows.map(async (row) => {
    const tagNames = await getBookmarkTagNames(db, row.id);
    return { row, tagNames };
  }));

  const anonymous = c.get("anonymous") as boolean;
  const body = bookmarksListPage({ bookmarks, count, q, sort, offset, limit, allTags, selectedTag, unread, shared, profile, page, anonymous, bundles, selectedBundleId });
  return c.html(layout(page === "archived" ? "Archived" : page === "shared" ? "Shared" : "Bookmarks", body, { profile, activeNav: page, anonymous }));
}

webRouter.get("/bookmarks", webAuth, (c) => renderBookmarkList(c, "bookmarks"));
webRouter.get("/bookmarks/archived", webAuth, (c) => renderBookmarkList(c, "archived"));
webRouter.get("/bookmarks/shared", async (c, next) => {
  const profile = await getProfile(c.env.DB);
  if (profile.enable_sharing && profile.enable_public_sharing) {
    c.set("anonymous", true);
    return next();
  }
  return webAuth(c, next);
}, (c) => renderBookmarkList(c, "shared"));

// ── Bulk actions (web) ──────────────────────────────────────────────
webRouter.get("/autocomplete/tags", webAuth, async (c) => {
  const tags = await listAllTags(c.env.DB);
  return c.json(tags.map((tag) => ({ name: tag.name })));
});

webRouter.get("/autocomplete/bookmarks", webAuth, async (c) => {
  const profile = await getProfile(c.env.DB);
  const q = c.req.query("q") || "";
  if (q.trim().length < 2) return c.json([]);

  const { where, params, orderBy } = await compileBookmarkListQuery(c.env.DB, profile, {
    q,
    sort: "added_desc",
    page: "bookmarks",
  });
  const rows = await listBookmarks(c.env.DB, where, params, orderBy, 5, 0);
  return c.json(rows.map((row) => ({ id: row.id, title: row.title || row.url, url: row.url })));
});

webRouter.post("/bookmarks/bulk", webAuth, async (c) => {
  const form = await getFormData(c);
  const tagString = (form.get("bulk_tag_string") as string) || "";

  // Single-item actions submitted via the wrapping bookmark-actions form.
  const singleId = (name: string) => parseInt(String(form.get(name) || ""), 10);
  if (!isNaN(singleId("archive"))) { await setArchived(c.env.DB, singleId("archive"), true); return c.redirect("/bookmarks", 302); }
  if (!isNaN(singleId("unarchive"))) { await setArchived(c.env.DB, singleId("unarchive"), false); return c.redirect("/bookmarks/archived", 302); }
  if (!isNaN(singleId("remove"))) { await deleteBookmark(c.env.DB, singleId("remove")); return c.redirect("/bookmarks", 302); }
  if (!isNaN(singleId("mark_as_read"))) { await bulkMarkRead(c.env.DB, [singleId("mark_as_read")]); return c.redirect("/bookmarks", 302); }
  if (!isNaN(singleId("mark_as_unread"))) { await bulkMarkUnread(c.env.DB, [singleId("mark_as_unread")]); return c.redirect("/bookmarks", 302); }
  if (!isNaN(singleId("share"))) { await bulkShare(c.env.DB, [singleId("share")]); return c.redirect("/bookmarks", 302); }
  if (!isNaN(singleId("unshare"))) { await bulkUnshare(c.env.DB, [singleId("unshare")]); return c.redirect("/bookmarks", 302); }

  // Bulk actions.
  const action = (form.get("bulk_action") as string) || "";
  const rawIds = form.getAll("bookmark_id").map((v) => parseInt(String(v), 10)).filter((n) => !isNaN(n));
  if (rawIds.length > 0) {
    const tagNames = parseTagString(tagString);
    switch (action) {
      case "bulk_archive":
        await bulkArchive(c.env.DB, rawIds);
        break;
      case "bulk_unarchive":
        await bulkUnarchive(c.env.DB, rawIds);
        break;
      case "bulk_delete":
        await bulkDelete(c.env.DB, rawIds);
        break;
      case "bulk_read":
        await bulkMarkRead(c.env.DB, rawIds);
        break;
      case "bulk_unread":
        await bulkMarkUnread(c.env.DB, rawIds);
        break;
      case "bulk_share":
        await bulkShare(c.env.DB, rawIds);
        break;
      case "bulk_unshare":
        await bulkUnshare(c.env.DB, rawIds);
        break;
      case "bulk_tag":
        if (tagNames.length > 0) await bulkTag(c.env.DB, rawIds, tagNames);
        break;
      case "bulk_untag":
        if (tagNames.length > 0) await bulkUntag(c.env.DB, rawIds, tagNames);
        break;
    }
  }

  return c.redirect("/bookmarks", 302);
});

// ── Bookmark CRUD (web) ─────────────────────────────────────────────
webRouter.get("/bookmarks/new", webAuth, async (c) => {
  const profile = await getProfile(c.env.DB);
  const allTags = await listAllTags(c.env.DB);
  return c.html(layout("New Bookmark", bookmarkFormPage({ allTags, profile }), { profile, activeNav: "bookmarks" }));
});

webRouter.post("/bookmarks", webAuth, async (c) => {
  const form = await getFormData(c);
  const profile = await getProfile(c.env.DB);
  const tagNames = (form.get("tag_names") as string || "").split(/\s+/).filter(Boolean);
  try {
    await createBookmark(c.env.DB, {
      url: form.get("url") as string,
      title: form.get("title") as string || "",
      description: form.get("description") as string || "",
      notes: form.get("notes") as string || "",
      tag_names: tagNames,
      unread: form.get("unread") === "1",
      shared: form.get("shared") === "1",
    }, profile);
    return c.redirect("/bookmarks", 302);
  } catch (e: any) {
    const allTags = await listAllTags(c.env.DB);
    return c.html(layout("Error", bookmarkFormPage({ allTags, error: e.message }), { profile, activeNav: "bookmarks" }), 400);
  }
});

// ── Bookmark detail ──────────────────────────────────────────────────
webRouter.get("/bookmarks/:id", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  const row = await getBookmarkById(c.env.DB, id);
  if (!row) return c.redirect("/bookmarks", 302);
  const profile = await getProfile(c.env.DB);
  const tagNames = await getBookmarkTagNames(c.env.DB, id);
  const modal = c.req.query("modal") === "1";

  if (modal) {
    // Return modal HTML only (for AJAX injection)
    return c.html(bookmarkDetailModal({ bookmark: row, tagNames, profile }));
  }

  // Full page view
  const body = bookmarkDetailPage({ bookmark: row, tagNames, profile });
  return c.html(layout(row.title || "Bookmark", body, { profile, activeNav: "bookmarks" }));
});

webRouter.get("/bookmarks/:id/edit", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  const row = await getBookmarkById(c.env.DB, id);
  if (!row) return c.redirect("/bookmarks", 302);
  const profile = await getProfile(c.env.DB);
  const allTags = await listAllTags(c.env.DB);
  const tagNames = await getBookmarkTagNames(c.env.DB, id);
  return c.html(layout("Edit Bookmark", bookmarkFormPage({ bookmark: row, tagNames, allTags }), { profile, activeNav: "bookmarks" }));
});

webRouter.post("/bookmarks/:id", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  const form = await getFormData(c);
  const profile = await getProfile(c.env.DB);
  const tagNames = (form.get("tag_names") as string || "").split(/\s+/).filter(Boolean);
  try {
    await updateBookmark(c.env.DB, id, {
      url: form.get("url") as string,
      title: form.get("title") as string,
      description: form.get("description") as string,
      notes: form.get("notes") as string,
      tag_names: tagNames,
      unread: form.get("unread") === "1",
      shared: form.get("shared") === "1",
    }, profile);
    return c.redirect("/bookmarks", 302);
  } catch {
    return c.redirect(`/bookmarks/${id}/edit`, 302);
  }
});

webRouter.post("/bookmarks/:id/delete", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  await deleteBookmark(c.env.DB, id);
  return c.redirect("/bookmarks", 302);
});

webRouter.post("/bookmarks/:id/archive", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  await setArchived(c.env.DB, id, true);
  return c.redirect("/bookmarks", 302);
});

webRouter.post("/bookmarks/:id/unarchive", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  await setArchived(c.env.DB, id, false);
  return c.redirect("/bookmarks/archived", 302);
});

// ── Tags ────────────────────────────────────────────────────────────
webRouter.get("/tags", webAuth, async (c) => {
  const profile = await getProfile(c.env.DB);
  const search = (c.req.query("search") || "").trim();
  const rawSort = c.req.query("sort") || "name-asc";
  const sort = ["name-asc", "name-desc", "count-asc", "count-desc"].includes(rawSort) ? rawSort : "name-asc";
  const unusedOnly = c.req.query("unused") === "true";
  const rawPage = parseInt(c.req.query("page") || "1", 10);
  let page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = 50;
  let offset = (page - 1) * limit;

  const total = await countAllTags(c.env.DB);
  let { count, tags } = await listTagsWithCounts(c.env.DB, { search, sort, unused: unusedOnly, limit, offset });
  if (tags.length === 0 && count > 0 && page > 1) {
    page = Math.ceil(count / limit);
    offset = (page - 1) * limit;
    ({ count, tags } = await listTagsWithCounts(c.env.DB, { search, sort, unused: unusedOnly, limit, offset }));
  }
  return c.html(layout("Tags", tagsPage({ tags, search, sort, unusedOnly, total, count, page, limit }), { profile, activeNav: "tags" }));
});

webRouter.post("/tags/merge", webAuth, async (c) => {
  const form = await getFormData(c);
  const source = (form.get("source") as string || "").trim();
  const target = (form.get("target") as string || "").trim();
  if (!source || !target || source === target) return c.redirect("/tags", 302);

  const db = c.env.DB;
  const sourceTag = await db.prepare("SELECT * FROM tags WHERE LOWER(name) = LOWER(?)").bind(source).first<TagRow>();
  if (!sourceTag) return c.redirect("/tags", 302);
  const now = new Date().toISOString();
  const targetTag = await ensureTag(db, target, now);

  // Re-associate bookmarks from source to target
  const bookmarks = await db.prepare("SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?").bind(sourceTag.id).all<{ bookmark_id: number }>();
  for (const { bookmark_id } of bookmarks.results) {
    await db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bookmark_id, targetTag.id).run();
  }
  // Delete source tag and its associations
  await db.prepare("DELETE FROM bookmark_tags WHERE tag_id = ?").bind(sourceTag.id).run();
  await db.prepare("DELETE FROM tags WHERE id = ?").bind(sourceTag.id).run();

  return c.redirect("/tags", 302);
});

webRouter.post("/tags/:id/delete", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  await c.env.DB.prepare("DELETE FROM bookmark_tags WHERE tag_id = ?").bind(id).run();
  await c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
  // Preserve filter / pagination state when returning to the tags list.
  const form = await getFormData(c);
  const params = new URLSearchParams();
  if (form.get("search")) params.set("search", (form.get("search") as string) || "");
  if (form.get("sort")) params.set("sort", (form.get("sort") as string) || "");
  if (form.get("unused") === "true") params.set("unused", "true");
  if (form.get("page")) params.set("page", (form.get("page") as string) || "");
  const qs = params.toString();
  return c.redirect(qs ? `/tags?${qs}` : "/tags", 302);
});

// ── Bundles ─────────────────────────────────────────────────────────
webRouter.get("/bundles", webAuth, async (c) => {
  const profile = await getProfile(c.env.DB);
  const bundles = await listBundles(c.env.DB);
  const editId = c.req.query("edit");
  let editing: BundleRow | undefined;
  if (editId) editing = (await getBundleById(c.env.DB, parseInt(editId, 10))) || undefined;
  return c.html(layout("Bundles", bundlesPage(bundles, editing, c.req.query("q") || ""), { profile, activeNav: "bundles" }));
});

webRouter.post("/bundles", webAuth, async (c) => {
  const form = await getFormData(c);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'INSERT INTO bundles (name, search, any_tags, all_tags, excluded_tags, filter_unread, filter_shared, "order", date_created, date_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    form.get("name") as string || "",
    form.get("search") as string || "",
    form.get("any_tags") as string || "",
    form.get("all_tags") as string || "",
    form.get("excluded_tags") as string || "",
    form.get("filter_unread") ?? "off",
    form.get("filter_shared") ?? "off",
    parseInt(form.get("order") as string || "0", 10),
    now, now,
  ).run();
  return c.redirect("/bundles", 302);
});

webRouter.post("/bundles/:id", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  const form = await getFormData(c);
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    'UPDATE bundles SET name=?, search=?, any_tags=?, all_tags=?, excluded_tags=?, filter_unread=?, filter_shared=?, "order"=?, date_modified=? WHERE id=?'
  ).bind(
    form.get("name") as string || "",
    form.get("search") as string || "",
    form.get("any_tags") as string || "",
    form.get("all_tags") as string || "",
    form.get("excluded_tags") as string || "",
    form.get("filter_unread") ?? "off",
    form.get("filter_shared") ?? "off",
    parseInt(form.get("order") as string || "0", 10),
    now, id,
  ).run();
  return c.redirect("/bundles", 302);
});

webRouter.post("/bundles/:id/delete", webAuth, async (c) => {
  const id = parseInt(c.req.param("id") || "", 10);
  await c.env.DB.prepare("DELETE FROM bundles WHERE id = ?").bind(id).run();
  return c.redirect("/bundles", 302);
});

// ── Settings ────────────────────────────────────────────────────────
webRouter.get("/settings", webAuth, async (c) => {
  const profile = await getProfile(c.env.DB);
  const tokens = await listApiTokens(c.env.DB);
  const csrf = await getCsrfToken(c.env);
  return c.html(layout("Settings", settingsPage({ profile, tokens, csrfToken: csrf }), { profile, activeNav: "settings", csrfToken: csrf }));
});

webRouter.post("/settings", webAuth, csrfVerify, async (c) => {
  const form = await getFormData(c);
  await c.env.DB.prepare(
    "UPDATE user_profile SET theme=?, items_per_page=?, enable_sharing=?, enable_favicons=?, tag_search=?, web_archive_integration=?, custom_css=?, auto_tagging_rules=?, default_mark_unread=?, default_mark_shared=?, enable_public_sharing=? WHERE id=1"
  ).bind(
    form.get("theme") as string || "auto",
    parseInt(form.get("items_per_page") as string || "30", 10),
    form.get("enable_sharing") === "1" ? 1 : 0,
    form.get("enable_favicons") === "1" ? 1 : 0,
    form.get("tag_search") as string || "strict",
    form.get("web_archive_integration") as string || "disabled",
    form.get("custom_css") as string || "",
    form.get("auto_tagging_rules") as string || "",
    form.get("default_mark_unread") === "1" ? 1 : 0,
    form.get("default_mark_shared") === "1" ? 1 : 0,
    form.get("enable_public_sharing") === "1" ? 1 : 0,
  ).run();
  return c.redirect("/settings", 302);
});

webRouter.post("/settings/auto-tagging", webAuth, csrfVerify, async (c) => {
  const form = await getFormData(c);
  await c.env.DB.prepare("UPDATE user_profile SET auto_tagging_rules=? WHERE id=1").bind(form.get("auto_tagging_rules") as string || "").run();
  return c.redirect("/settings", 302);
});

webRouter.post("/settings/api-token", webAuth, csrfVerify, async (c) => {
  const form = await getFormData(c);
  const name = form.get("name") as string || "unnamed";
  const key = Array.from(crypto.getRandomValues(new Uint8Array(20))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  await c.env.DB.prepare("INSERT INTO api_tokens (key, name, created) VALUES (?, ?, ?)").bind(key, name, now).run();
  const profile = await getProfile(c.env.DB);
  const tokens = await listApiTokens(c.env.DB);
  const csrf = await getCsrfToken(c.env);
  return c.html(layout("Settings", settingsPage({ profile, tokens, newToken: key, csrfToken: csrf }), { profile, activeNav: "settings", csrfToken: csrf }));
});

webRouter.post("/settings/api-token/delete", webAuth, csrfVerify, async (c) => {
  const form = await getFormData(c);
  const id = parseInt(form.get("id") as string || "", 10);
  if (id) await c.env.DB.prepare("DELETE FROM api_tokens WHERE id = ?").bind(id).run();
  return c.redirect("/settings", 302);
});

// ── Import / Export (T11) ───────────────────────────────────────────
webRouter.post("/settings/import", webAuth, csrfVerify, async (c) => {
  const form = await getFormData(c);
  const file = form.get("file") as File | null;
  if (!file) return c.redirect("/settings", 302);
  const html = await file.text();
  const parsed = parseNetscape(html);
  const profile = await getProfile(c.env.DB);
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  for (const bm of parsed) {
    if (!isAllowedScheme(bm.href)) {
      skipped++;
      continue;
    }
    try {
      const saved = await createBookmark(c.env.DB, {
        url: bm.href, title: bm.title, description: bm.description, notes: bm.notes,
        tag_names: bm.tagNames, unread: bm.toRead, shared: !bm.privateFlag,
        is_archived: bm.archived, date_added: bm.dateAdded, date_modified: bm.dateModified,
      }, profile);
      imported++;
    } catch (e) {
      console.error(`Import failed for "${bm.href}":`, e);
      failed++;
    }
  }
  const tokens = await listApiTokens(c.env.DB);
  const csrf = await getCsrfToken(c.env);
  const parts: string[] = [`Imported ${imported} bookmarks`];
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  const flash = parts.join(", ") + ".";
  return c.html(layout("Settings", settingsPage({ profile, tokens, csrfToken: csrf }), { profile, activeNav: "settings", flash, csrfToken: csrf }));
});

webRouter.get("/settings/export", webAuth, async (c) => {
  const rows = (await c.env.DB.prepare("SELECT * FROM bookmarks ORDER BY date_added DESC").all<BookmarkRow>()).results;
  const bookmarks = await Promise.all(rows.map(async (row) => ({
    url: row.url, title: row.title, description: row.description, notes: row.notes,
    tagNames: await getBookmarkTagNames(c.env.DB, row.id),
    isArchived: !!row.is_archived, unread: !!row.unread, shared: !!row.shared,
    dateAdded: row.date_added, dateModified: row.date_modified,
  })));
  const html = exportNetscapeHtml(bookmarks);
  return c.body(html, 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Disposition": 'attachment; filename="bookmarks.html"',
  });
});

// ── Feed token ──────────────────────────────────────────────────────
webRouter.post("/settings/feed-token", webAuth, csrfVerify, async (c) => {
  const key = Array.from(crypto.getRandomValues(new Uint8Array(20))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  // Delete existing feed token and create new one
  await c.env.DB.prepare("DELETE FROM feed_tokens").run();
  await c.env.DB.prepare("INSERT INTO feed_tokens (key, created) VALUES (?, ?)").bind(key, now).run();
  const profile = await getProfile(c.env.DB);
  const tokens = await listApiTokens(c.env.DB);
  const csrf = await getCsrfToken(c.env);
  return c.html(layout("Settings", settingsPage({ profile, tokens, feedToken: key, csrfToken: csrf }), { profile, activeNav: "settings", csrfToken: csrf }));
});

// ── RSS/Atom Feeds (T12) ────────────────────────────────────────────
async function serveFeed(c: AppContext, filter: "all" | "unread" | "shared"): Promise<Response> {
  const key = c.req.param("key");
  const token = await c.env.DB.prepare("SELECT * FROM feed_tokens WHERE key = ?").bind(key).first<FeedTokenRow>();
  if (!token) return c.json({ detail: "Invalid feed key." }, 404);

  const conditions: string[] = [];
  if (filter === "unread") conditions.push("unread = 1");
  else if (filter === "shared") conditions.push("shared = 1");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(`SELECT * FROM bookmarks ${where} ORDER BY date_modified DESC LIMIT 100`).all<BookmarkRow>();
  const siteUrl = new URL(c.req.url).origin;
  const title = `linkding — ${filter === "unread" ? "Unread" : filter === "shared" ? "Shared" : "All"} Bookmarks`;
  const xml = buildAtomFeed(rows.results, { title, selfUrl: c.req.url, siteUrl });
  return c.body(xml, 200, { "Content-Type": "application/atom+xml; charset=utf-8" });
}

webRouter.get("/feeds/:key/all", (c) => serveFeed(c, "all"));
webRouter.get("/feeds/:key/unread", (c) => serveFeed(c, "unread"));
webRouter.get("/feeds/:key/shared", (c) => serveFeed(c, "shared"));

// Public shared feed (no token required)
webRouter.get("/feeds/shared", async (c) => {
  const profile = await getProfile(c.env.DB);
  if (!(profile.enable_sharing && profile.enable_public_sharing)) {
    return c.json({ detail: "Public sharing is not enabled." }, 401);
  }
  const rows = await c.env.DB.prepare("SELECT * FROM bookmarks WHERE shared = 1 ORDER BY date_modified DESC LIMIT 100").all<BookmarkRow>();
  const siteUrl = new URL(c.req.url).origin;
  const xml = buildAtomFeed(rows.results, { title: "linkding — Shared Bookmarks", selfUrl: c.req.url, siteUrl });
  return c.body(xml, 200, { "Content-Type": "application/atom+xml; charset=utf-8" });
});

// ── Manifest / OpenSearch / Custom CSS (T12) ────────────────────────
webRouter.get("/manifest.json", (c) => c.json({
  name: "linkding", short_name: "linkding",
  start_url: "/bookmarks", display: "standalone",
  background_color: "#1a1a2e", theme_color: "#4361ee",
  icons: [
    { src: "/logo-192.png", sizes: "192x192", type: "image/png" },
    { src: "/logo-512.png", sizes: "512x512", type: "image/png" },
    { src: "/maskable-logo-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/maskable-logo-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}));

webRouter.get("/opensearch.xml", (c) => {
  const siteUrl = new URL(c.req.url).origin;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>linkding</ShortName>
  <Description>Search bookmarks in linkding</Description>
  <Url type="text/html" template="${siteUrl}/bookmarks?q={searchTerms}"/>
</OpenSearchDescription>`;
  return c.body(xml, 200, { "Content-Type": "application/opensearchdescription+xml" });
});

webRouter.get("/custom_css", async (c) => {
  const profile = await getProfile(c.env.DB);
  return c.body(profile.custom_css || "", 200, { "Content-Type": "text/css" });
});
