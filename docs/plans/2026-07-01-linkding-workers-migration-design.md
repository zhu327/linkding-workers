# linkding-workers Migration Design

**Date:** 2026-07-01
**Status:** Approved (GO-1)
**Scope:** 6 features from original linkding to be migrated to Cloudflare Workers version.

## 1. Auto-tagging on Create/Update

### Problem
Current workers has `auto_tagging.ts` service that returns tags for a URL, but `createBookmark()` and `updateBookmark()` in `src/services/bookmarks.ts` do not apply auto-tags. The original linkding applies auto-tags on both create and update.

### Solution
In `createBookmark()` and `updateBookmark()`:
1. Read `profile.auto_tagging_rules`
2. Call `getTags(rules, url)` to get auto-tags
3. Merge auto-tags into `tag_names` (dedup, case-insensitive)
4. Pass merged tags to `syncTags()`

### Behavior
- **Create/UPSERT:** auto-tags merged with user-supplied tags
- **Update (PATCH):** if `tag_names` not provided, auto-tags still applied on top of existing tags
- **Update (PUT):** auto-tags merged with user-supplied tags

### Files
- `src/services/bookmarks.ts`: add `applyAutoTags()` helper, call in `createBookmark()` and `updateBookmark()`
- `test/bookmarks-write.test.ts`: add tests

---

## 2. Default Mark Unread / Default Mark Shared

### Problem
Original linkding has `default_mark_unread` and `default_mark_shared` user preferences. Workers schema lacks these.

### Solution
Add two columns to `user_profile`:
- `default_mark_unread INTEGER NOT NULL DEFAULT 0`
- `default_mark_shared INTEGER NOT NULL DEFAULT 0`

### Behavior
- Settings page shows two checkboxes
- When creating a bookmark without explicit `unread`/`shared`, use profile defaults
- API `POST /api/bookmarks/` respects defaults when fields omitted
- API `GET /api/user/profile/` includes these fields (add to serializer)

### Files
- `migrations/0002_defaults.sql`
- `src/db/schema.ts`: add fields to `UserProfileRow`
- `src/services/bookmarks.ts`: read defaults in `createBookmark()`
- `src/api/serializers.ts`: add to `UserProfileResponse`
- `src/web/views/settings-view.ts`: add checkboxes
- `src/web/routes.ts`: save in `POST /settings`
- `test/`: add tests

---

## 3. Bulk Actions (Web UI Only)

### Problem
Original linkding supports bulk archive/unarchive/delete/tag/untag/read/unread/share/unshare. Workers lacks bulk actions.

### Scope (per user choice)
Web UI only. Operations:
- Bulk archive
- Bulk unarchive
- Bulk delete
- Bulk tag (add tags to selected)
- Bulk untag (remove tags from selected)
- Bulk mark read
- Bulk mark unread
- Bulk share
- Bulk unshare

### Solution
- `src/services/bookmarks.ts`: add `bulkArchive()`, `bulkDelete()`, `bulkTag()`, `bulkUntag()`, `bulkMarkRead()`, `bulkMarkUnread()`, `bulkShare()`, `bulkUnshare()` — all take `ids: number[]`
- `src/web/routes.ts`: POST `/bookmarks/bulk` with `bulk_action` and `bookmark_id[]` and `bulk_tag_string`
- `src/web/views/bookmarks.ts`: add checkbox column, bulk action bar at bottom
- CSRF protection on POST

### Bulk action bar
- "Select all" checkbox in header
- Action dropdown: Archive / Unarchive / Delete / Tag / Untag / Mark Read / Mark Unread / Share / Unshare
- For tag/untag: text input for tag names
- "Apply" button

### Files
- `src/services/bookmarks.ts`
- `src/web/routes.ts`
- `src/web/views/bookmarks.ts`
- `src/web/views/bulk-actions.ts` (new)
- `test/web-ui.test.ts`

---

## 4. Public Shared Bookmarks Page & Feed

### Problem
Original linkding allows public (anonymous) access to shared bookmarks and shared feed when `enable_public_sharing` is on. Workers requires login for `/bookmarks/shared`.

### Solution
- `/bookmarks/shared`: allow anonymous access when `enable_public_sharing = 1`
- Anonymous view: hide edit/delete/archive buttons, hide bulk actions, hide nav items except shared
- `/feeds/shared`: allow anonymous access when `enable_public_sharing = 1` (no feed token needed)
- Settings UI: add `enable_public_sharing` checkbox (if not present)

### Behavior
- If `enable_sharing = 0` or `enable_public_sharing = 0` → redirect to login (401 for feed)
- If `enable_sharing = 1 && enable_public_sharing = 1` → allow anonymous

### Files
- `src/web/routes.ts`: modify `/bookmarks/shared` and `/feeds/shared` auth logic
- `src/web/views/bookmarks.ts`: conditional rendering for anonymous mode
- `src/web/views/layout.ts`: conditional nav for anonymous
- `src/web/views/settings-view.ts`: add checkbox
- `test/web-ui.test.ts`

---

## 5. Markdown Notes + Bookmark Detail Page

### Problem
Original linkding renders notes as Markdown. Workers renders notes as plain text. Also lacks a dedicated detail page.

### Solution

#### Markdown renderer
- `src/utils/markdown.ts`: minimal safe Markdown renderer
- Supports: `**bold**`, `*italic*`, `` `code` ``, `[link](url)`, `- list`, `1. list`, paragraphs, code blocks (``` ```)
- All output HTML is escaped/sanitized — no raw HTML injection
- No dependencies

#### Detail page
- `GET /bookmarks/:id` → full detail view
- Shows: title, URL, description, notes (rendered as Markdown), tags, dates, archive status
- Edit/Delete/Archive buttons (only when logged in)
- Back link to list

#### List page notes
- Notes shown inline (truncated, expandable) using Markdown rendering
- Or: notes shown in detail page only, list shows snippet

### Files
- `src/utils/markdown.ts` (new)
- `src/web/views/bookmark-detail.ts` (new)
- `src/web/routes.ts`: GET `/bookmarks/:id`
- `src/web/views/bookmarks.ts`: notes rendering in list
- `test/markdown.test.ts` (new)

---

## 6. PWA Static Icons

### Problem
Current `manifest.json` points icons to `/health` which is a JSON endpoint, not a valid icon.

### Solution
- Copy original linkding static icons to `public/` directory (Workers serves static assets from `public/`)
- Files: `favicon.ico`, `favicon.svg`, `logo-192.png`, `logo-512.png`, `apple-touch-icon.png`, `maskable-logo-192.png`, `maskable-logo-512.png`
- Update `wrangler.toml` to include static assets
- Update `/manifest.json` response to point to correct icon paths

### Files
- `public/favicon.ico`
- `public/favicon.svg`
- `public/logo-192.png`
- `public/logo-512.png`
- `public/apple-touch-icon.png`
- `public/maskable-logo-192.png`
- `public/maskable-logo-512.png`
- `wrangler.toml`: add `[site]` or `[assets]` config
- `src/web/routes.ts`: update manifest.json icon paths

---

## Architecture Notes

- All changes are single-user, no multi-user implications
- No new tables except schema additions (migration)
- No R2 needed — icons are small static files served via Workers static assets
- Markdown renderer is pure function, no external dependencies
- Bulk actions are synchronous DB updates, no background processing needed
- Public shared page reuses existing query logic, just removes auth requirement conditionally
