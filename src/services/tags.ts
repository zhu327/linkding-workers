import type { TagRow } from "../db/schema.js";

/**
 * Tag string utilities — port of linkding's parse_tag_string / sanitize_tag_name / build_tag_string.
 */

export async function ensureTag(db: D1Database, name: string, now: string): Promise<TagRow> {
  const sanitized = sanitizeTagName(name);
  if (!sanitized) throw new Error("Invalid tag name");
  // Use INSERT OR IGNORE to handle race condition between SELECT and INSERT
  await db
    .prepare("INSERT OR IGNORE INTO tags (name, date_added) VALUES (?, ?)")
    .bind(sanitized, now)
    .run();
  // Re-select to get the row (either newly inserted or existing)
  return (await db
    .prepare("SELECT * FROM tags WHERE LOWER(name) = LOWER(?)")
    .bind(sanitized)
    .first<TagRow>())!;
}

export function sanitizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, "-");
}

export function parseTagString(tagString: string, delimiter = ","): string[] {
  if (!tagString) return [];
  const names = tagString.split(delimiter).map((n) => sanitizeTagName(n)).filter((n) => n.length > 0);
  // Deduplicate case-insensitively, keeping first occurrence
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of names) {
    const lower = n.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(n);
    }
  }
  unique.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return unique;
}


