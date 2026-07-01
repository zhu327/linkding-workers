# linkding-workers Migration Implementation Plan

> **For Pi:** Execute this plan using /skill:subagent-driven-development (current session with subagents).

**Goal:** Migrate 6 features from original linkding to the Workers version: auto-tagging on create/update, default unread/shared prefs, bulk actions (Web UI), public shared page/feed, Markdown notes + detail page, PWA static icons.

**Architecture:** All changes are additive to the existing Hono + D1 codebase. One new DB migration adds two profile columns. One new utility module for Markdown. One new `public/` directory for static assets. Bulk actions are new service functions + a single POST route. Public shared reuses existing query logic with conditional auth bypass.

**Tech Stack:** Hono, TypeScript, D1, Vitest + `@cloudflare/vitest-pool-workers`, Wrangler static assets. No new npm dependencies.

## Task Dependency Graph

All tasks are AFK (no human decision needed mid-flight).

```
T1 (auto-tagging)   ─┐
T2 (markdown util)  ─┤
T3 (PWA icons)      ─┤  ← Wave 1 (parallel)
                     │
T4 (default prefs)  ─┘  ← Wave 2 (blocked by T1: shared bookmarks.ts)
                     │
T5 (bulk actions)   ──  ← Wave 3 (blocked by T4: shared bookmarks.ts)
                     │
T6 (public shared)  ──  ← Wave 4 (blocked by T5: shared routes.ts + bookmarks.ts)
                     │
T7 (detail + notes) ──  ← Wave 5 (blocked by T2 + T6: needs markdown, shared files)
```

| Task | Type | Blocked by | Parallelizable with | Files shared with |
|------|------|------------|---------------------|-------------------|
| T1   | AFK  | None       | T2, T3              | T4, T5 (bookmarks.ts) |
| T2   | AFK  | None       | T1, T3              | T7 (markdown.ts import) |
| T3   | AFK  | None       | T1, T2              | None |
| T4   | AFK  | T1         | —                   | T1, T5 (bookmarks.ts) |
| T5   | AFK  | T4         | —                   | T4, T6 (bookmarks.ts, routes.ts) |
| T6   | AFK  | T5         | —                   | T5, T7 (routes.ts, bookmarks.ts) |
| T7   | AFK  | T2, T6     | —                   | T6 (routes.ts, bookmarks.ts) |

**Shared-file rule:** T1→T4→T5 all touch `src/services/bookmarks.ts` and are serialized. T5→T6→T7 all touch `src/web/routes.ts` and `src/web/views/bookmarks.ts` and are serialized. T2 and T3 are fully independent.

---

### Task T1: Auto-tagging on Create/Update

**Type:** AFK
**Blocked by:** None
**Layers touched:** Service

**Goal:** When a bookmark is created or updated, auto-tagging rules from the user profile are applied to merge auto-tags into the bookmark's tag list. Matches original linkding behavior.

**Acceptance Criteria:**
- [ ] `createBookmark()` applies auto-tags from `profile.auto_tagging_rules` and merges them with user-supplied `tag_names` (dedup, case-insensitive).
- [ ] `updateBookmark()` applies auto-tags even when `tag_names` is not provided (merges with existing tags).
- [ ] `updateBookmark()` with explicit `tag_names` merges auto-tags on top.
- [ ] Auto-tag errors are caught and logged, not thrown.
- [ ] Existing tests still pass.

**Files:**
- Modify: `src/services/bookmarks.ts`

#### Interface Contracts

```ts
// src/services/bookmarks.ts — add helper
import { getTags as getAutoTags } from "./auto-tagging.js";

// Internal helper — called by createBookmark and updateBookmark
function applyAutoTags(
  profile: UserProfileRow,
  url: string,
  tagNames: string[]
): string[];
// Returns merged tag list: user tags + auto tags, deduped case-insensitively.
// If profile.auto_tagging_rules is empty, returns tagNames unchanged.
// Errors in getAutoTags are caught silently.
```

#### Test Cases to Cover

**Service layer:**
- Create bookmark with auto-tagging rules → bookmark has both user tags and auto-tags
- Create bookmark without auto-tagging rules → only user tags
- Update bookmark with auto-tagging rules → auto-tags merged with existing tags
- Update bookmark with explicit tag_names → auto-tags merged on top
- Auto-tag rules produce no matches → only user tags
- Auto-tag rules throw error → no crash, only user tags

#### Layer Guidance
- Import `getTags` from `./auto-tagging.js`
- `applyAutoTags` reads `profile.auto_tagging_rules`, calls `getTags(rules, url)`, merges results into `tagNames` array (lowercase dedup)
- Call `applyAutoTags` in `createBookmark()` before `syncTags()`
- Call `applyAutoTags` in `updateBookmark()` — when `tag_names` not provided, use existing tags from DB

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T2: Markdown Renderer Utility

**Type:** AFK
**Blocked by:** None
**Layers touched:** Utility

**Goal:** Create a minimal, safe Markdown renderer with no external dependencies. Supports bold, italic, inline code, code blocks, links, lists, and paragraphs. All output is HTML-escaped.

**Acceptance Criteria:**
- [ ] `renderMarkdown(text)` returns safe HTML string.
- [ ] Supports: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`, `- item`, `1. item`, paragraphs, fenced code blocks.
- [ ] All HTML special characters are escaped (`<`, `>`, `&`, `"`, `'`).
- [ ] No raw HTML injection possible.
- [ ] Empty input returns empty string.
- [ ] Malformed input (unclosed tags, etc.) doesn't crash.

**Files:**
- Create: `src/utils/markdown.ts`
- Create: `test/markdown.test.ts`

#### Interface Contracts

```ts
// src/utils/markdown.ts
export function renderMarkdown(text: string): string;
// Converts Markdown text to safe HTML.
// Supports: **bold**, *italic*, `inline code`, ```code blocks```,
// [links](url), - unordered lists, 1. ordered lists, paragraphs.
// All output HTML is escaped. No raw HTML allowed.
```

#### Test Cases to Cover

**Utility layer:**
- `**bold**` → `<strong>bold</strong>`
- `*italic*` → `<em>italic</em>`
- `` `code` `` → `<code>code</code>`
- `[text](https://example.com)` → `<a href="https://example.com">text</a>`
- `- item1\n- item2` → `<ul><li>item1</li><li>item2</li></ul>`
- `1. item1\n2. item2` → `<ol><li>item1</li><li>item2</li></ol>`
- Fenced code block → `<pre><code>...</code></pre>`
- Paragraphs separated by blank lines → `<p>...</p><p>...</p>`
- `<script>alert(1)</script>` → escaped, no script execution
- Empty string → `""`
- Mixed: `**bold** and *italic* and [link](url)` → all rendered correctly

#### Layer Guidance
- Pure function, no I/O, no dependencies
- Parse line-by-line, track state (in code block, in list, etc.)
- Escape HTML before any Markdown processing
- For links: validate URL scheme (http/https only, reject javascript:)
- Keep it simple — doesn't need to handle every Markdown edge case

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T3: PWA Static Icons + Manifest Fix

**Type:** AFK
**Blocked by:** None
**Layers touched:** Static assets, Config

**Goal:** Copy original linkding static icons to `public/` directory, configure Wrangler to serve them, and fix `manifest.json` to reference correct icon paths.

**Acceptance Criteria:**
- [ ] `public/` directory contains: `favicon.ico`, `favicon.svg`, `logo-192.png`, `logo-512.png`, `apple-touch-icon.png`, `maskable-logo-192.png`, `maskable-logo-512.png`.
- [ ] `wrangler.toml` configured to serve static assets from `public/`.
- [ ] `GET /manifest.json` returns correct icon entries pointing to `/logo-192.png` and `/logo-512.png`.
- [ ] Icons are accessible via direct URL (e.g., `/favicon.ico`).

**Files:**
- Create: `public/favicon.ico` (copy from original)
- Create: `public/favicon.svg` (copy from original)
- Create: `public/logo-192.png` (copy from original)
- Create: `public/logo-512.png` (copy from original)
- Create: `public/apple-touch-icon.png` (copy from original)
- Create: `public/maskable-logo-192.png` (copy from original)
- Create: `public/maskable-logo-512.png` (copy from original)
- Modify: `wrangler.toml`
- Modify: `src/web/routes.ts` (manifest.json icons)

#### Interface Contracts

```toml
# wrangler.toml — add static assets config
[assets]
directory = "public"
```

```ts
// src/web/routes.ts — update manifest.json response
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
```

#### Test Cases to Cover

**Integration:**
- `GET /manifest.json` returns valid JSON with icons array containing correct paths
- `GET /favicon.ico` returns 200 with image content type
- `GET /logo-192.png` returns 200 with image/png content type

#### Layer Guidance
- Copy files from `/root/Learn/linkding/bookmarks/static/` to `public/`
- Wrangler `[assets]` config serves static files from `public/` directory
- Manifest icons use absolute paths starting with `/`

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T4: Default Mark Unread / Default Mark Shared Preferences

**Type:** AFK
**Blocked by:** T1
**Layers touched:** DB schema, Service, API serializer, Settings UI

**Goal:** Add `default_mark_unread` and `default_mark_shared` to user profile. When creating a bookmark without explicit unread/shared values, use profile defaults. Settings UI exposes these as checkboxes.

**Acceptance Criteria:**
- [ ] D1 migration adds `default_mark_unread` and `default_mark_shared` columns (INTEGER, default 0).
- [ ] `UserProfileRow` type includes both fields.
- [ ] `createBookmark()` uses profile defaults when `unread`/`shared` not explicitly provided in input.
- [ ] `GET /api/user/profile/` includes `default_mark_unread` and `default_mark_shared` boolean fields.
- [ ] Settings page shows two checkboxes for default unread/shared.
- [ ] `POST /settings` saves both values.

**Files:**
- Create: `migrations/0002_defaults.sql`
- Modify: `src/db/schema.ts`
- Modify: `src/services/bookmarks.ts`
- Modify: `src/api/serializers.ts`
- Modify: `src/web/views/settings-view.ts`
- Modify: `src/web/routes.ts`

#### Interface Contracts

```sql
-- migrations/0002_defaults.sql
ALTER TABLE user_profile ADD COLUMN default_mark_unread INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profile ADD COLUMN default_mark_shared INTEGER NOT NULL DEFAULT 0;
```

```ts
// src/db/schema.ts — add to UserProfileRow
export interface UserProfileRow {
  // ...existing fields...
  default_mark_unread: number;
  default_mark_shared: number;
}
```

```ts
// src/services/bookmarks.ts — modify createBookmark
// When input.unread is undefined, use profile.default_mark_unread
// When input.shared is undefined, use profile.default_mark_shared
```

```ts
// src/api/serializers.ts — add to UserProfileResponse
export interface UserProfileResponse {
  // ...existing fields...
  default_mark_unread: boolean;
  default_mark_shared: boolean;
}
```

#### Test Cases to Cover

**Schema:**
- Migration applies cleanly to existing database
- New columns have correct defaults (0)

**Service:**
- Create bookmark without unread/shared → uses profile defaults
- Create bookmark with explicit unread/shared → overrides profile defaults
- Profile defaults are true → new bookmark is unread/shared

**API:**
- `GET /api/user/profile/` includes `default_mark_unread` and `default_mark_shared`

**Web UI:**
- Settings page renders checkboxes for default_mark_unread and default_mark_shared
- POST /settings saves both values

#### Layer Guidance
- Migration uses `ALTER TABLE ADD COLUMN` — D1 supports this
- Default values in migration ensure existing rows get 0
- `createBookmark()` checks `input.unread === undefined` (not falsy) to distinguish "not provided" from "false"

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T5: Bulk Actions — Service + Web Route + UI

**Type:** AFK
**Blocked by:** T4
**Layers touched:** Service, Web route, Web view

**Goal:** Add bulk operations for bookmarks: archive, unarchive, delete, tag, untag, mark read, mark unread, share, unshare. Web UI shows checkboxes and a bulk action bar.

**Acceptance Criteria:**
- [ ] `src/services/bookmarks.ts` exports: `bulkArchive()`, `bulkUnarchive()`, `bulkDelete()`, `bulkTag()`, `bulkUntag()`, `bulkMarkRead()`, `bulkMarkUnread()`, `bulkShare()`, `bulkUnshare()` — all take `(db, ids: number[])`.
- [ ] `POST /bookmarks/bulk` handles all bulk actions with CSRF protection.
- [ ] Request body: `bulk_action` (string), `bookmark_id[]` (array of IDs), `bulk_tag_string` (for tag/untag).
- [ ] Bookmark list page shows checkbox per row and "Select all" checkbox.
- [ ] Bulk action bar at bottom of list with action dropdown and Apply button.
- [ ] Tag/Untag actions show a text input for tag names.

**Files:**
- Modify: `src/services/bookmarks.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/web/views/bookmarks.ts`
- Create: `src/web/views/bulk-actions.ts`

#### Interface Contracts

```ts
// src/services/bookmarks.ts — add bulk functions
export async function bulkArchive(db: D1Database, ids: number[]): Promise<void>;
export async function bulkUnarchive(db: D1Database, ids: number[]): Promise<void>;
export async function bulkDelete(db: D1Database, ids: number[]): Promise<void>;
export async function bulkMarkRead(db: D1Database, ids: number[]): Promise<void>;
export async function bulkMarkUnread(db: D1Database, ids: number[]): Promise<void>;
export async function bulkShare(db: D1Database, ids: number[]): Promise<void>;
export async function bulkUnshare(db: D1Database, ids: number[]): Promise<void>;
export async function bulkTag(db: D1Database, ids: number[], tagNames: string[]): Promise<void>;
export async function bulkUntag(db: D1Database, ids: number[], tagNames: string[]): Promise<void>;
// All functions update date_modified to now.
// bulkTag/bulkUntag parse tag string, create tags if needed, update bookmark_tags.
```

```ts
// src/web/routes.ts
webRouter.post("/bookmarks/bulk", webAuth, csrfVerify, async (c) => {
  // Read bulk_action, bookmark_id[], bulk_tag_string from form
  // Dispatch to appropriate bulk function
  // Redirect back to referring page
});
```

```ts
// src/web/views/bulk-actions.ts
export function bulkActionBar(page: string): string;
// Returns HTML for the bulk action bar:
// - Action dropdown: Archive / Unarchive / Delete / Tag / Untag / Mark Read / Mark Unread / Share / Unshare
// - For tag/untag: text input (shown/hidden via JS or always visible)
// - Apply button
```

#### Test Cases to Cover

**Service layer:**
- `bulkArchive(ids)` sets is_archived=1 for all IDs, updates date_modified
- `bulkDelete(ids)` removes bookmarks and their tag associations
- `bulkTag(ids, ["tag1"])` creates tag if needed, associates with all bookmarks
- `bulkUntag(ids, ["tag1"])` removes tag associations
- Empty ids array → no-op, no error

**Web route:**
- POST `/bookmarks/bulk` with `bulk_action=bulk_archive` and bookmark IDs → archives them, redirects
- POST `/bookmarks/bulk` without CSRF → 403
- POST `/bookmarks/bulk` with invalid action → redirect without error

**Web UI:**
- Bookmark list renders checkbox for each row
- Bulk action bar renders at bottom of list

#### Layer Guidance
- Bulk functions use `WHERE id IN (?,?,...)` with parameterized queries
- For tag operations, use `INSERT OR IGNORE` for idempotent tag assignment
- `bulkDelete` must also clean up `bookmark_tags` entries
- Bulk action bar is part of the form — wrap in `<form method="POST" action="/bookmarks/bulk">`

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T6: Public Shared Bookmarks Page + Feed

**Type:** AFK
**Blocked by:** T5
**Layers touched:** Web route, Web view, Settings UI

**Goal:** When `enable_public_sharing` is on, allow anonymous access to `/bookmarks/shared` and `/feeds/shared`. Anonymous view hides edit/delete/bulk actions.

**Acceptance Criteria:**
- [ ] `GET /bookmarks/shared` accessible without login when `enable_sharing=1 AND enable_public_sharing=1`.
- [ ] Anonymous shared page shows only shared bookmarks, no edit/delete/bulk UI.
- [ ] Anonymous layout shows only the shared page link (no bookmarks/archived/tags/bundles/settings nav).
- [ ] `GET /feeds/shared` accessible without feed token when `enable_public_sharing=1`.
- [ ] If `enable_public_sharing=0`, `/bookmarks/shared` redirects to login (existing behavior).
- [ ] Settings page shows "Enable public sharing" checkbox.
- [ ] `POST /settings` saves `enable_public_sharing`.

**Files:**
- Modify: `src/web/routes.ts`
- Modify: `src/web/views/bookmarks.ts`
- Modify: `src/web/views/layout.ts`
- Modify: `src/web/views/settings-view.ts`

#### Interface Contracts

```ts
// src/web/routes.ts — modify /bookmarks/shared handler
webRouter.get("/bookmarks/shared", async (c, next) => {
  const profile = await getProfile(c.env.DB);
  if (profile.enable_sharing && profile.enable_public_sharing) {
    // Allow anonymous access — set a flag for views
    c.set("anonymous", true);
    return next();
  }
  return webAuth(c, next);
}, (c) => renderBookmarkList(c, "shared"));
```

```ts
// src/web/routes.ts — modify /feeds/shared handler
webRouter.get("/feeds/shared", async (c) => {
  const profile = await getProfile(c.env.DB);
  if (profile.enable_sharing && profile.enable_public_sharing) {
    // Serve feed without token check
    return serveSharedFeed(c);
  }
  // Fall through to token-based auth
  return serveFeed(c, "shared");
});
```

```ts
// src/web/views/settings-view.ts — add checkbox
// <div class="form-check">
//   <input type="checkbox" id="enable_public_sharing" name="enable_public_sharing" value="1">
//   <label for="enable_public_sharing">Enable public sharing</label>
// </div>
```

#### Test Cases to Cover

**Web route:**
- Anonymous GET `/bookmarks/shared` with `enable_public_sharing=1` → 200 with shared bookmarks
- Anonymous GET `/bookmarks/shared` with `enable_public_sharing=0` → redirect to login
- Anonymous GET `/feeds/shared` with `enable_public_sharing=1` → 200 with Atom feed
- Anonymous GET `/feeds/shared` with `enable_public_sharing=0` → 404

**Web view:**
- Anonymous shared page has no edit/delete buttons
- Anonymous shared page has no bulk action bar
- Anonymous layout has minimal nav (only shared link)

**Settings:**
- Settings page renders enable_public_sharing checkbox
- POST /settings saves enable_public_sharing

#### Layer Guidance
- Check `enable_sharing` first — if off, public sharing is meaningless
- Anonymous mode: pass `anonymous: true` flag to views so they can hide interactive elements
- Layout for anonymous: minimal, no user menu, no settings link
- Feed: same Atom format as authenticated feed, just no token check

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T7: Bookmark Detail Page + Notes Rendering

**Type:** AFK
**Blocked by:** T2, T6
**Layers touched:** Web route, Web view

**Goal:** Add a detail page at `/bookmarks/:id` that shows full bookmark info with Markdown-rendered notes. List page also renders notes inline using Markdown.

**Acceptance Criteria:**
- [ ] `GET /bookmarks/:id` renders a detail page with title, URL, description, notes (Markdown), tags, dates, archive status.
- [ ] Detail page shows Edit/Delete/Archive buttons (only when logged in).
- [ ] Detail page has "Back to list" link.
- [ ] List page renders notes inline (truncated, using Markdown renderer).
- [ ] Notes are rendered safely (no XSS via Markdown).

**Files:**
- Create: `src/web/views/bookmark-detail.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/web/views/bookmarks.ts`

#### Interface Contracts

```ts
// src/web/views/bookmark-detail.ts
export function bookmarkDetailPage(opts: {
  bookmark: BookmarkRow;
  tagNames: string[];
  profile: UserProfileRow;
  anonymous?: boolean;
}): string;
// Returns full HTML for the detail page.
// Notes rendered via renderMarkdown().
// Edit/Delete/Archive buttons only shown when not anonymous.
```

```ts
// src/web/routes.ts
webRouter.get("/bookmarks/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  // Check if user is authenticated (or anonymous with public sharing)
  // Fetch bookmark + tags
  // Render detail page
});
```

```ts
// src/web/views/bookmarks.ts — modify notes rendering in list
// Replace plain text notes with renderMarkdown(truncate(notes, 300))
```

#### Test Cases to Cover

**Web route:**
- Authenticated GET `/bookmarks/:id` → 200 with detail page
- GET `/bookmarks/99999` (non-existent) → redirect to list
- Anonymous GET `/bookmarks/:id` → redirect to login (detail page requires auth)

**Web view:**
- Detail page renders title, URL, description, notes (Markdown), tags, dates
- Detail page shows Edit button (links to `/bookmarks/:id/edit`)
- Notes with Markdown `**bold**` render as `<strong>bold</strong>`
- Notes with `<script>` are escaped

**List page:**
- Notes rendered inline with Markdown
- Long notes truncated to ~300 chars

#### Layer Guidance
- Detail page uses `layout()` wrapper for consistent styling
- Import `renderMarkdown` from `src/utils/markdown.js`
- Truncate notes in list view: render full Markdown, then truncate HTML (or truncate source first, then render)
- For safety: truncate source text first, then render Markdown

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

## Plan Coverage Checklist

- [x] Every approved requirement maps to at least one task
  - Auto-tagging → T1
  - Default prefs → T4
  - Bulk actions → T5
  - Public shared → T6
  - Markdown + detail → T2, T7
  - PWA icons → T3
- [x] Every task has clear acceptance criteria
- [x] Every task lists behavior-focused test cases
- [x] Every task lists exact Create/Modify file paths
- [x] New or modified API endpoints have E2E test task(s) — N/A (no new API endpoints; bulk actions are Web UI only, public shared uses existing endpoints with modified auth)
- [x] The dependency graph has no cycles
- [x] Parallelizable tasks do not modify the same files (T1/T2/T3 are independent)
- [x] No task is purely horizontal unless it is unavoidable infrastructure — T2 (markdown util) is a utility but is a single small file, justified
- [x] Known assumptions or deviations from the approved design are documented
  - Bulk actions are Web UI only (no API endpoint) per user choice
  - Public shared feed uses same Atom format as authenticated feed
  - Markdown renderer is minimal, not full CommonMark spec
  - PWA icons are copied from original linkding static assets
