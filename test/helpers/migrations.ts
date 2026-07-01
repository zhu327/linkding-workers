// Real migration SQL from the repo's migrations/0001_init.sql and
// migrations/0002_defaults.sql.  Inlined here because the Cloudflare
// Workers test environment (workerd) has no host-filesystem access.
const MIGRATION_0001 = `-- Bookmarks
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  url_normalized TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  web_archive_snapshot_url TEXT NOT NULL DEFAULT '',
  favicon_url TEXT NOT NULL DEFAULT '',
  preview_image_url TEXT NOT NULL DEFAULT '',
  unread INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  shared INTEGER NOT NULL DEFAULT 0,
  date_added TEXT NOT NULL,
  date_modified TEXT NOT NULL,
  date_accessed TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_url_normalized ON bookmarks(url_normalized);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  date_added TEXT NOT NULL
);

-- Bookmark-Tag many-to-many
CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(bookmark_id, tag_id),
  FOREIGN KEY(bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag ON bookmark_tags(tag_id);

-- Bundles (saved searches)
CREATE TABLE IF NOT EXISTS bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  search TEXT NOT NULL DEFAULT '',
  any_tags TEXT NOT NULL DEFAULT '',
  all_tags TEXT NOT NULL DEFAULT '',
  excluded_tags TEXT NOT NULL DEFAULT '',
  filter_unread TEXT NOT NULL DEFAULT 'off',
  filter_shared TEXT NOT NULL DEFAULT 'off',
  "order" INTEGER NOT NULL DEFAULT 0,
  date_created TEXT NOT NULL,
  date_modified TEXT NOT NULL
);

-- API tokens
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_key ON api_tokens(key);

-- Feed tokens (for RSS)
CREATE TABLE IF NOT EXISTS feed_tokens (
  key TEXT PRIMARY KEY,
  created TEXT NOT NULL
);

-- User profile (single row, single user)
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'auto',
  bookmark_date_display TEXT NOT NULL DEFAULT 'relative',
  bookmark_link_target TEXT NOT NULL DEFAULT '_blank',
  web_archive_integration TEXT NOT NULL DEFAULT 'disabled',
  tag_search TEXT NOT NULL DEFAULT 'strict',
  enable_sharing INTEGER NOT NULL DEFAULT 0,
  enable_public_sharing INTEGER NOT NULL DEFAULT 0,
  enable_favicons INTEGER NOT NULL DEFAULT 1,
  display_url INTEGER NOT NULL DEFAULT 0,
  permanent_notes INTEGER NOT NULL DEFAULT 0,
  search_preferences TEXT NOT NULL DEFAULT '{}',
  auto_tagging_rules TEXT NOT NULL DEFAULT '',
  items_per_page INTEGER NOT NULL DEFAULT 30,
  legacy_search INTEGER NOT NULL DEFAULT 0,
  custom_css TEXT NOT NULL DEFAULT ''
);

-- Seed default profile
INSERT OR IGNORE INTO user_profile (id, theme, bookmark_date_display, bookmark_link_target, web_archive_integration, tag_search, enable_sharing, enable_public_sharing, enable_favicons, display_url, permanent_notes, search_preferences, auto_tagging_rules, items_per_page, legacy_search, custom_css) VALUES (1, 'auto', 'relative', '_blank', 'disabled', 'strict', 0, 0, 1, 0, 0, '{}', '', 30, 0, '');
`;

const MIGRATION_0002 = `ALTER TABLE user_profile ADD COLUMN default_mark_unread INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profile ADD COLUMN default_mark_shared INTEGER NOT NULL DEFAULT 0;
`;

// Applies the real migrations against a D1 binding.  This matches the
// exact schema that `wrangler d1 execute` would create — including
// UNIQUE COLLATE NOCASE on tags.name and the seeded user_profile row.
export async function applyMigrations(db: D1Database): Promise<void> {
  // Run MIGRATION_0001 (CREATE TABLE IF NOT EXISTS — safe to re-run)
  const stmts1 = MIGRATION_0001
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of stmts1) {
    await db.prepare(stmt).run();
  }
  // Run MIGRATION_0002 (ALTER TABLE — must be idempotent for multi-test-file runs)
  const stmts2 = MIGRATION_0002
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of stmts2) {
    try {
      await db.prepare(stmt).run();
    } catch (e: any) {
      // Ignore "duplicate column" errors — column already added by another test file
      if (!e?.message?.includes("duplicate column")) throw e;
    }
  }
}

// Convenience: apply migrations + seed the standard test API token.
export async function setupTestDb(db: D1Database): Promise<void> {
  await applyMigrations(db);
  await db
    .prepare(
      "INSERT OR IGNORE INTO api_tokens (key, name, created) VALUES ('test-token-123', 'test', '2024-01-01T00:00:00Z')",
    )
    .run();
}
