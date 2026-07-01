/**
 * Repository / DB access layer.
 * Consolidates SQL for bookmarks, tags, bundles, and profile so the API and
 * Web UI share a single source of truth for query logic.
 */
import type { BookmarkRow, TagRow, BundleRow, ApiTokenRow, UserProfileRow } from "./schema.js";
import { getProfile } from "./schema.js";
import { parseSearchQuery, compileSearch, compileLegacySearch } from "../services/search.js";

export { getProfile };

// ── Bookmarks ───────────────────────────────────────────────────────

export async function getBookmarkById(db: D1Database, id: number): Promise<BookmarkRow | null> {
  return db.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<BookmarkRow>();
}

export async function getBookmarkByNormalizedUrl(db: D1Database, normalized: string, url: string): Promise<BookmarkRow | null> {
  return db
    .prepare("SELECT * FROM bookmarks WHERE url_normalized = ? OR (url_normalized = '' AND url = ?)")
    .bind(normalized, url)
    .first<BookmarkRow>();
}

export async function getBookmarkTagNames(db: D1Database, bookmarkId: number): Promise<string[]> {
  const rows = await db
    .prepare("SELECT t.name FROM tags t INNER JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = ?")
    .bind(bookmarkId)
    .all<TagRow>();
  return rows.results.map((r) => r.name);
}

export async function countBookmarks(db: D1Database, where: string, params: unknown[]): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) as cnt FROM bookmarks ${where}`).bind(...params).first<{ cnt: number }>();
  return r?.cnt ?? 0;
}

export async function listBookmarks(db: D1Database, where: string, params: unknown[], orderBy: string, limit: number, offset: number): Promise<BookmarkRow[]> {
  const rows = await db
    .prepare(`SELECT * FROM bookmarks ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<BookmarkRow>();
  return rows.results;
}

// ── Tags ────────────────────────────────────────────────────────────

export async function listTags(db: D1Database, limit: number, offset: number): Promise<{ count: number; tags: TagRow[] }> {
  const count = (await db.prepare("SELECT COUNT(*) as cnt FROM tags").first<{ cnt: number }>())?.cnt ?? 0;
  const rows = await db
    .prepare("SELECT * FROM tags ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<TagRow>();
  return { count, tags: rows.results };
}

export async function listAllTags(db: D1Database): Promise<TagRow[]> {
  const rows = await db.prepare("SELECT * FROM tags ORDER BY name COLLATE NOCASE").all<TagRow>();
  return rows.results;
}

// ── Bundles ─────────────────────────────────────────────────────────

export async function listBundles(db: D1Database): Promise<BundleRow[]> {
  const rows = await db.prepare('SELECT * FROM bundles ORDER BY "order" ASC').all<BundleRow>();
  return rows.results;
}

export async function getBundleById(db: D1Database, id: number): Promise<BundleRow | null> {
  return db.prepare("SELECT * FROM bundles WHERE id = ?").bind(id).first<BundleRow>();
}

// ── API tokens ──────────────────────────────────────────────────────

export async function listApiTokens(db: D1Database): Promise<ApiTokenRow[]> {
  const rows = await db.prepare("SELECT * FROM api_tokens ORDER BY created DESC").all<ApiTokenRow>();
  return rows.results;
}

// ── Shared bookmark list query builder ──────────────────────────────

export type BookmarkPage = "bookmarks" | "archived" | "shared";

export interface BookmarkListFilters {
  q?: string;
  sort?: string;
  modifiedSince?: string;
  addedSince?: string;
  unread?: string;
  shared?: string;
  bundleId?: string;
  selectedTag?: string;
  page?: BookmarkPage;
}

export interface CompiledListQuery {
  where: string; // "" or "WHERE ..."
  params: unknown[];
  orderBy: string;
}

function sortToOrderBy(sort: string | undefined): string {
  switch (sort) {
    case "added_asc": return "date_added ASC";
    case "added_desc": return "date_added DESC";
    case "title_asc": return "title COLLATE NOCASE ASC";
    case "title_desc": return "title COLLATE NOCASE DESC";
    default: return "date_added DESC";
  }
}

function applySearch(conditions: string[], params: unknown[], q: string, profile: UserProfileRow) {
  if (!q) return;
  if (profile.legacy_search) {
    const compiled = compileLegacySearch(q);
    if (compiled) { conditions.push(compiled.whereSql); params.push(...compiled.params); }
  } else {
    try {
      const ast = parseSearchQuery(q);
      const compiled = compileSearch(ast, { lax: profile.tag_search === "lax" });
      if (compiled) { conditions.push(compiled.whereSql); params.push(...compiled.params); }
    } catch {
      const compiled = compileLegacySearch(q);
      if (compiled) { conditions.push(compiled.whereSql); params.push(...compiled.params); }
    }
  }
}

function applyBundleTagFilters(conditions: string[], params: unknown[], bundle: BundleRow) {
  if (bundle.any_tags) {
    const tags = bundle.any_tags.split(/\s+/).filter(Boolean);
    if (tags.length > 0) {
      const placeholders = tags.map(() => "?").join(", ");
      params.push(...tags.map((t) => t.toLowerCase()));
      conditions.push(`EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = bookmarks.id AND LOWER(t.name) IN (${placeholders}))`);
    }
  }
  if (bundle.all_tags) {
    for (const tag of bundle.all_tags.split(/\s+/).filter(Boolean)) {
      params.push(tag.toLowerCase());
      conditions.push("EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = bookmarks.id AND LOWER(t.name) = ?)");
    }
  }
  if (bundle.excluded_tags) {
    for (const tag of bundle.excluded_tags.split(/\s+/).filter(Boolean)) {
      params.push(tag.toLowerCase());
      conditions.push("NOT EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = bookmarks.id AND LOWER(t.name) = ?)");
    }
  }
}

/**
 * Build the WHERE/ORDER BY for a bookmark list. Used by both the API and the
 * Web UI so search behavior (lax / legacy / bundle) stays consistent.
 */
/**
 * Normalize a boolean filter value to "yes" | "no" | undefined.
 * Accepts: "yes"/"true"/"1" → "yes"; "no"/"false"/"0" → "no"; everything else → undefined.
 */
function normalizeBoolFilter(raw: string | undefined): "yes" | "no" | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v === "yes" || v === "true" || v === "1") return "yes";
  if (v === "no" || v === "false" || v === "0") return "no";
  return undefined;
}

export async function compileBookmarkListQuery(
  db: D1Database,
  profile: UserProfileRow,
  filters: BookmarkListFilters,
): Promise<CompiledListQuery> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const page = filters.page || "bookmarks";
  if (page === "archived") conditions.push("is_archived = 1");
  else if (page === "shared") conditions.push("shared = 1");
  else conditions.push("is_archived = 0");

  // Bundle filter: merge bundle search + tag criteria into the query
  if (filters.bundleId) {
    const bundle = await getBundleById(db, parseInt(filters.bundleId, 10));
    if (bundle) {
      const effectiveQ = [filters.q || "", bundle.search].filter(Boolean).join(" ").trim();
      applySearch(conditions, params, effectiveQ, profile);
      applyBundleTagFilters(conditions, params, bundle);
      if (bundle.filter_unread === "yes") conditions.push("unread = 1");
      else if (bundle.filter_unread === "no") conditions.push("unread = 0");
      if (bundle.filter_shared === "yes") conditions.push("shared = 1");
      else if (bundle.filter_shared === "no") conditions.push("shared = 0");
    } else {
      applySearch(conditions, params, filters.q || "", profile);
    }
  } else {
    applySearch(conditions, params, filters.q || "", profile);
  }

  if (filters.modifiedSince) { conditions.push("date_modified >= ?"); params.push(filters.modifiedSince); }
  if (filters.addedSince) { conditions.push("date_added >= ?"); params.push(filters.addedSince); }
  const unread = normalizeBoolFilter(filters.unread);
  if (unread === "yes") conditions.push("unread = 1");
  else if (unread === "no") conditions.push("unread = 0");
  const shared = normalizeBoolFilter(filters.shared);
  if (shared === "yes") conditions.push("shared = 1");
  else if (shared === "no") conditions.push("shared = 0");
  if (filters.selectedTag) {
    conditions.push("EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = bookmarks.id AND t.name = ?)");
    params.push(filters.selectedTag);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params, orderBy: sortToOrderBy(filters.sort) };
}
