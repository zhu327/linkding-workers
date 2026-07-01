import type { BookmarkRow, UserProfileRow } from "../db/schema.js";
import { normalizeUrl } from "./url.js";
import { ensureTag, sanitizeTagName } from "./tags.js";
import { getTags as getAutoTags } from "./auto-tagging.js";
import { isAllowedScheme } from "../utils/html.js";

export interface CreateBookmarkInput {
  url: string;
  title?: string;
  description?: string;
  notes?: string;
  is_archived?: boolean;
  unread?: boolean;
  shared?: boolean;
  tag_names?: string[];
  date_added?: string;
  date_modified?: string;
}

export class InvalidUrlSchemeError extends Error {
  constructor() {
    super("URL scheme must be http, https, or ftp.");
  }
}

export class DuplicateUrlError extends Error {
  constructor() {
    super("A bookmark with this URL already exists.");
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("Bookmark not found");
  }
}

/**
 * Merge auto-tags from profile rules with user-supplied tags.
 * Deduplicates case-insensitively. Errors are caught silently.
 */
function applyAutoTags(profile: UserProfileRow, url: string, tagNames: string[]): string[] {
  if (!profile.auto_tagging_rules) return tagNames;
  let autoTags: string[];
  try {
    autoTags = getAutoTags(profile.auto_tagging_rules, url);
  } catch {
    return tagNames;
  }
  const seen = new Set(tagNames.map((t) => t.toLowerCase()));
  const merged = [...tagNames];
  for (const tag of autoTags) {
    if (!seen.has(tag.toLowerCase())) {
      merged.push(tag);
      seen.add(tag.toLowerCase());
    }
  }
  return merged;
}

async function fetchExistingTags(db: D1Database, bookmarkId: number): Promise<string[]> {
  return (
    await db
      .prepare(
        "SELECT t.name FROM tags t INNER JOIN bookmark_tags bt ON t.id = bt.tag_id WHERE bt.bookmark_id = ?",
      )
      .bind(bookmarkId)
      .all<{ name: string }>()
  ).results.map((r) => r.name);
}

async function syncTags(db: D1Database, bookmarkId: number, tagNames: string[], now: string) {
  await db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(bookmarkId).run();
  for (const name of tagNames) {
    const sanitized = sanitizeTagName(name);
    if (!sanitized) continue;
    try {
      const tag = await ensureTag(db, sanitized, now);
      await db.prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bookmarkId, tag.id).run();
    } catch {
      // skip invalid tags
    }
  }
}

export async function createBookmark(
  db: D1Database,
  input: CreateBookmarkInput,
  profile: UserProfileRow,
): Promise<BookmarkRow> {
  if (!isAllowedScheme(input.url)) {
    throw new InvalidUrlSchemeError();
  }

  const now = new Date().toISOString();
  const normalized = normalizeUrl(input.url);
  const dateAdded = input.date_added || now;
  const dateModified = input.date_modified || now;

  // Check for existing bookmark with same normalized URL (upsert)
  const existing = await db
    .prepare("SELECT * FROM bookmarks WHERE url_normalized = ? OR (url_normalized = '' AND url = ?)")
    .bind(normalized, input.url)
    .first<BookmarkRow>();

  if (existing) {
    // Update existing bookmark in place (upsert)
    await db
      .prepare(
        "UPDATE bookmarks SET url = ?, title = ?, description = ?, notes = ?, is_archived = ?, unread = ?, shared = ?, date_modified = ? WHERE id = ?",
      )
      .bind(
        input.url,
        input.title ?? existing.title,
        input.description ?? existing.description,
        input.notes ?? existing.notes,
        input.is_archived !== undefined ? (input.is_archived ? 1 : 0) : existing.is_archived,
        input.unread !== undefined ? (input.unread ? 1 : 0) : existing.unread,
        input.shared !== undefined ? (input.shared ? 1 : 0) : existing.shared,
        dateModified,
        existing.id,
      )
      .run();

    const baseTags = input.tag_names ?? await fetchExistingTags(db, existing.id);
    await syncTags(db, existing.id, applyAutoTags(profile, input.url, baseTags), now);

    return (await db.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(existing.id).first<BookmarkRow>())!;
  }

  // Insert new bookmark
  const result = await db
    .prepare(
      "INSERT INTO bookmarks (url, url_normalized, title, description, notes, is_archived, unread, shared, date_added, date_modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      input.url,
      normalized,
      input.title || "",
      input.description || "",
      input.notes || "",
      input.is_archived ? 1 : 0,
      input.unread !== undefined ? (input.unread ? 1 : 0) : (profile.default_mark_unread ? 1 : 0),
      input.shared !== undefined ? (input.shared ? 1 : 0) : (profile.default_mark_shared ? 1 : 0),
      dateAdded,
      dateModified,
    )
    .run();

  const id = Number(result.meta.last_row_id);

  const tagNames = applyAutoTags(profile, input.url, input.tag_names || []);
  await syncTags(db, id, tagNames, now);

  return (await db.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<BookmarkRow>())!;
}

export async function updateBookmark(
  db: D1Database,
  id: number,
  patch: Partial<CreateBookmarkInput>,
  profile?: UserProfileRow,
): Promise<BookmarkRow> {
  const existing = await db.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<BookmarkRow>();
  if (!existing) throw new NotFoundError();

  // Validate URL scheme
  if (patch.url && !isAllowedScheme(patch.url)) throw new InvalidUrlSchemeError();

  // Check URL collision with OTHER bookmarks
  if (patch.url) {
    const normalized = normalizeUrl(patch.url);
    const collision = await db
      .prepare("SELECT id FROM bookmarks WHERE (url_normalized = ? OR (url_normalized = '' AND url = ?)) AND id != ?")
      .bind(normalized, patch.url, id)
      .first();
    if (collision) throw new DuplicateUrlError();
  }

  const now = new Date().toISOString();
  const newUrl = patch.url ?? existing.url;
  const newNormalized = patch.url ? normalizeUrl(patch.url) : existing.url_normalized;

  await db
    .prepare(
      "UPDATE bookmarks SET url = ?, url_normalized = ?, title = ?, description = ?, notes = ?, is_archived = ?, unread = ?, shared = ?, date_modified = ? WHERE id = ?",
    )
    .bind(
      newUrl,
      newNormalized,
      patch.title ?? existing.title,
      patch.description ?? existing.description,
      patch.notes ?? existing.notes,
      patch.is_archived !== undefined ? (patch.is_archived ? 1 : 0) : existing.is_archived,
      patch.unread !== undefined ? (patch.unread ? 1 : 0) : existing.unread,
      patch.shared !== undefined ? (patch.shared ? 1 : 0) : existing.shared,
      now,
      id,
    )
    .run();

  if (profile) {
    const baseTags = patch.tag_names ?? await fetchExistingTags(db, id);
    await syncTags(db, id, applyAutoTags(profile, newUrl, baseTags), now);
  } else if (patch.tag_names) {
    await syncTags(db, id, patch.tag_names, now);
  }

  return (await db.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<BookmarkRow>())!;
}

export async function deleteBookmark(db: D1Database, id: number): Promise<void> {
  const existing = await db.prepare("SELECT id FROM bookmarks WHERE id = ?").bind(id).first();
  if (!existing) throw new NotFoundError();
  await db.prepare("DELETE FROM bookmark_tags WHERE bookmark_id = ?").bind(id).run();
  await db.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run();
}

export async function setArchived(db: D1Database, id: number, archived: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare("UPDATE bookmarks SET is_archived = ?, date_modified = ? WHERE id = ?").bind(archived ? 1 : 0, now, id).run();
}

// ── Bulk operations ─────────────────────────────────────────────────

function placeholders(count: number): string {
  return Array(count).fill("?").join(",");
}

async function bulkSetField(db: D1Database, column: string, value: number, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE bookmarks SET ${column} = ${value}, date_modified = ? WHERE id IN (${placeholders(ids.length)})`)
    .bind(now, ...ids)
    .run();
}

export async function bulkArchive(db: D1Database, ids: number[]): Promise<void> {
  return bulkSetField(db, "is_archived", 1, ids);
}

export async function bulkUnarchive(db: D1Database, ids: number[]): Promise<void> {
  return bulkSetField(db, "is_archived", 0, ids);
}

export async function bulkDelete(db: D1Database, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch([
    db
      .prepare(`DELETE FROM bookmark_tags WHERE bookmark_id IN (${placeholders(ids.length)})`)
      .bind(...ids),
    db
      .prepare(`DELETE FROM bookmarks WHERE id IN (${placeholders(ids.length)})`)
      .bind(...ids),
  ]);
}

export async function bulkMarkRead(db: D1Database, ids: number[]): Promise<void> {
  return bulkSetField(db, "unread", 0, ids);
}

export async function bulkMarkUnread(db: D1Database, ids: number[]): Promise<void> {
  return bulkSetField(db, "unread", 1, ids);
}

export async function bulkShare(db: D1Database, ids: number[]): Promise<void> {
  return bulkSetField(db, "shared", 1, ids);
}

export async function bulkUnshare(db: D1Database, ids: number[]): Promise<void> {
  return bulkSetField(db, "shared", 0, ids);
}

export async function bulkTag(db: D1Database, ids: number[], tagNames: string[]): Promise<void> {
  if (ids.length === 0 || tagNames.length === 0) return;
  const now = new Date().toISOString();
  const statements: ReturnType<D1Database["prepare"]>[] = [];
  for (const name of tagNames) {
    const sanitized = sanitizeTagName(name);
    if (!sanitized) continue;
    const tag = await ensureTag(db, sanitized, now);
    for (const bookmarkId of ids) {
      statements.push(
        db
          .prepare("INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)")
          .bind(bookmarkId, tag.id),
      );
    }
  }
  // D1 batch limit is 100 statements per call
  const BATCH_SIZE = 100;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }
}

export async function bulkUntag(db: D1Database, ids: number[], tagNames: string[]): Promise<void> {
  if (ids.length === 0 || tagNames.length === 0) return;
  for (const name of tagNames) {
    const sanitized = sanitizeTagName(name);
    if (!sanitized) continue;
    const tag = await db
      .prepare("SELECT id FROM tags WHERE LOWER(name) = LOWER(?)")
      .bind(sanitized)
      .first<{ id: number }>();
    if (!tag) continue;
    await db
      .prepare(`DELETE FROM bookmark_tags WHERE tag_id = ? AND bookmark_id IN (${placeholders(ids.length)})`)
      .bind(tag.id, ...ids)
      .run();
  }
}
