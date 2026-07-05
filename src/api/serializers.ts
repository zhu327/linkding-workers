import type { UserProfileRow, TagRow, BookmarkRow, BundleRow } from "../db/schema.js";

export interface UserProfileResponse {
  theme: string;
  bookmark_date_display: string;
  bookmark_link_target: string;
  web_archive_integration: string;
  tag_search: string;
  tag_grouping: string;
  enable_sharing: boolean;
  enable_public_sharing: boolean;
  enable_favicons: boolean;
  enable_preview_images: boolean;
  display_url: boolean;
  permanent_notes: boolean;
  bookmark_description_display: string;
  bookmark_description_max_lines: number;
  collapse_side_panel: boolean;
  search_preferences: Record<string, unknown>;
  default_mark_unread: boolean;
  default_mark_shared: boolean;
  version: string;
}

export function serializeUserProfile(row: UserProfileRow, version: string): UserProfileResponse {
  return {
    theme: row.theme,
    bookmark_date_display: row.bookmark_date_display,
    bookmark_link_target: row.bookmark_link_target,
    web_archive_integration: row.web_archive_integration,
    tag_search: row.tag_search,
    tag_grouping: row.tag_grouping,
    enable_sharing: !!row.enable_sharing,
    enable_public_sharing: !!row.enable_public_sharing,
    enable_favicons: !!row.enable_favicons,
    enable_preview_images: !!row.enable_preview_images,
    display_url: !!row.display_url,
    permanent_notes: !!row.permanent_notes,
    bookmark_description_display: row.bookmark_description_display,
    bookmark_description_max_lines: row.bookmark_description_max_lines,
    collapse_side_panel: !!row.collapse_side_panel,
    search_preferences: JSON.parse(row.search_preferences || "{}"),
    default_mark_unread: !!row.default_mark_unread,
    default_mark_shared: !!row.default_mark_shared,
    version,
  };
}

export interface TagResponse {
  id: number;
  name: string;
  date_added: string;
}

export function serializeTag(row: TagRow): TagResponse {
  return { id: row.id, name: row.name, date_added: row.date_added };
}

export interface BookmarkResponse {
  id: number;
  url: string;
  title: string;
  description: string;
  notes: string;
  web_archive_snapshot_url: string | null;
  favicon_url: string | null;
  preview_image_url: string | null;
  is_archived: boolean;
  unread: boolean;
  shared: boolean;
  tag_names: string[];
  date_added: string;
  date_modified: string;
  website_title: null;
  website_description: null;
}

export function serializeBookmark(
  row: BookmarkRow,
  tagNames: string[],
  opts: { profile: UserProfileRow; faviconUrl: string | null; webArchiveUrl: string | null },
): BookmarkResponse {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    notes: row.notes,
    web_archive_snapshot_url: opts.webArchiveUrl,
    favicon_url: opts.faviconUrl || null,
    preview_image_url: row.preview_image_url || null,
    is_archived: !!row.is_archived,
    unread: !!row.unread,
    shared: !!row.shared,
    tag_names: [...tagNames].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
    date_added: row.date_added,
    date_modified: row.date_modified,
    website_title: null,
    website_description: null,
  };
}

export interface BundleResponse {
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

export function serializeBundle(row: BundleRow): BundleResponse {
  return {
    id: row.id, name: row.name, search: row.search,
    any_tags: row.any_tags, all_tags: row.all_tags, excluded_tags: row.excluded_tags,
    filter_unread: row.filter_unread, filter_shared: row.filter_shared,
    order: row.order, date_created: row.date_created, date_modified: row.date_modified,
  };
}
