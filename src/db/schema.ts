export interface BookmarkRow {
  id: number;
  url: string;
  url_normalized: string;
  title: string;
  description: string;
  notes: string;
  web_archive_snapshot_url: string;
  favicon_url: string;
  preview_image_url: string;
  unread: number;
  is_archived: number;
  shared: number;
  date_added: string;
  date_modified: string;
  date_accessed: string | null;
}

export interface TagRow {
  id: number;
  name: string;
  date_added: string;
}

export interface BookmarkTagRow {
  bookmark_id: number;
  tag_id: number;
}

export interface BundleRow {
  id: number;
  name: string;
  search: string;
  any_tags: string;
  all_tags: string;
  excluded_tags: string;
  filter_unread: string;
  filter_shared: string;
  order: number;
  date_created: string;
  date_modified: string;
}

export interface ApiTokenRow {
  id: number;
  key: string;
  name: string;
  created: string;
}

export interface FeedTokenRow {
  key: string;
  created: string;
}

export interface UserProfileRow {
  id: number;
  theme: string;
  bookmark_date_display: string;
  bookmark_link_target: string;
  web_archive_integration: string;
  tag_search: string;
  tag_grouping: string;
  enable_sharing: number;
  enable_public_sharing: number;
  enable_favicons: number;
  enable_preview_images: number;
  display_url: number;
  permanent_notes: number;
  bookmark_description_display: string;
  bookmark_description_max_lines: number;
  collapse_side_panel: number;
  search_preferences: string;
  auto_tagging_rules: string;
  items_per_page: number;
  legacy_search: number;
  custom_css: string;
  default_mark_unread: number;
  default_mark_shared: number;
}

export async function getProfile(db: D1Database): Promise<UserProfileRow> {
  return (await db.prepare("SELECT * FROM user_profile WHERE id = 1").first<UserProfileRow>())!;
}
