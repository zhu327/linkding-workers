-- Bookmarks
CREATE TABLE bookmarks (
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
CREATE INDEX idx_bookmarks_url_normalized ON bookmarks(url_normalized);

-- Tags
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  date_added TEXT NOT NULL
);

-- Bookmark-Tag many-to-many
CREATE TABLE bookmark_tags (
  bookmark_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY(bookmark_id, tag_id),
  FOREIGN KEY(bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX idx_bookmark_tags_tag ON bookmark_tags(tag_id);

-- Bundles (saved searches)
CREATE TABLE bundles (
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
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created TEXT NOT NULL
);
CREATE INDEX idx_api_tokens_key ON api_tokens(key);

-- Feed tokens (for RSS)
CREATE TABLE feed_tokens (
  key TEXT PRIMARY KEY,
  created TEXT NOT NULL
);

-- User profile (single row, single user)
CREATE TABLE user_profile (
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
INSERT INTO user_profile (id, theme, bookmark_date_display, bookmark_link_target, web_archive_integration, tag_search, enable_sharing, enable_public_sharing, enable_favicons, display_url, permanent_notes, search_preferences, auto_tagging_rules, items_per_page, legacy_search, custom_css) VALUES (1, 'auto', 'relative', '_blank', 'disabled', 'strict', 0, 0, 1, 0, 0, '{}', '', 30, 0, '');
