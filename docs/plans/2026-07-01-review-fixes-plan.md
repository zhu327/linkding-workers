# Review Fixes Implementation Plan

> **For Pi:** Execute this plan using /skill:subagent-driven-development (current session with subagents).

**Goal:** Fix the P1/P2 defects found in the 2026-07-01 design-goal review so the Web UI bookmark path honors profile defaults & auto-tagging, stored-XSS via unsafe URL schemes is closed, the API/bundle surface matches design §4 exactly, and the test suite reflects real extension URLs + the real migration schema.

**Architecture:** Surgical edits to existing Hono routes/services/views plus a shared test-migration helper. No new tables, no new dependencies. Each fix is verified by a failing-then-passing test (TDD). CSRF hardening is explicitly OUT OF SCOPE (handled in a separate effort).

**Tech Stack:** Hono, TypeScript (strict), Cloudflare D1, Vitest + `@cloudflare/vitest-pool-workers`.

## Task Dependency Graph

Tasks marked ✅ AFK can be executed by agents autonomously.

```
T1 (AFK) ──┐                    ┌── T4 (AFK) ──┐
            ├── T3 (AFK) ───────┘               ├── T5 (AFK)
T2 (AFK) ──┘                                     │
                                                 │
T2 ──────────────────────────────────────────────┘
```

| Task | Type | Blocked by | Parallelizable with |
|------|------|------------|---------------------|
| T1   | AFK  | None       | T2                  |
| T2   | AFK  | None       | T1                  |
| T3   | AFK  | T1         | T2 (if still running) |
| T4   | AFK  | T3         | T2 (if still running) |
| T5   | AFK  | T2, T4     | —                   |

**Shared-file rule:** T1, T3, T4 all modify `src/web/routes.ts` (T1=bookmark POSTs, T3=feeds+bundle POSTs, T4 only reads routes via tests) → serialized T1→T3→T4. T2 touches only `src/services/*` + `src/web/views/bookmarks.ts`/`bookmark-detail.ts` + `src/utils/html.ts` → parallel with T1. T5 refactors every test file → runs last (blocked by T2 and T4 so all feature tests exist first).

---

### Task T1: Bookmark create/update honors profile defaults & auto-tagging (web + API)

**Type:** AFK
**Blocked by:** None — can start immediately
**Layers touched:** Web view, Web route, API handler, Service

**Goal:** Close the two P1 gaps: (P1-B) the Web *new bookmark* form ignores `default_mark_unread`/`default_mark_shared`; (P1-A) the Web *edit* path never applies auto-tags because `updateBookmark` is called without `profile`. Also unify the API update path (F1-P2) so a PATCH omitting `tag_names` still applies auto-tags on top of existing tags, and remove the redundant inline auto-tag merges duplicated in both API handlers.

**Acceptance Criteria:**
- [ ] `GET /bookmarks/new` with `default_mark_unread=1` renders the "Mark as unread" checkbox **checked**; with `default_mark_shared=1` renders "Share" checked. (Edit form still pre-checks from `bookmark.unread`/`bookmark.shared` — unchanged.)
- [ ] Web create submitting the pre-checked (untouched) form persists `unread=1` when `default_mark_unread=1`; unchecking it persists `unread=0`.
- [ ] Web edit (`POST /bookmarks/:id`) with `auto_tagging_rules` matching the bookmark URL applies auto-tags merged with the form's `tag_names` (dedup, case-insensitive).
- [ ] API `PATCH /api/bookmarks/<id>/` with a body that **omits** `tag_names` still adds auto-tags (matching the rules) on top of the bookmark's existing tags.
- [ ] API `PUT`/`PATCH` with `tag_names` applies auto-tags exactly once (no double-application, no dead inline merge).
- [ ] API `POST /api/bookmarks/` applies auto-tags exactly once (the inline merge in `handleCreate` is removed; `createBookmark`'s internal `applyAutoTags` is the single source).

**Files:**
- Modify: `src/web/views/bookmark-form.ts` (accept optional `profile`; pre-check unread/shared on the *new* form from profile defaults)
- Modify: `src/web/routes.ts` (`GET /bookmarks/new` passes `profile` to `bookmarkFormPage`; `POST /bookmarks/:id` passes `profile` to `updateBookmark`)
- Modify: `src/api/bookmarks.ts` (`handleUpdate` passes `profile` to `updateBookmark` and removes its inline auto-tag merge; `handleCreate` removes its inline auto-tag merge — rely on `createBookmark`'s internal `applyAutoTags`)
- Modify: `test/web-ui.test.ts` (web create defaults + web edit auto-tag assertions)
- Modify: `test/bookmarks-auto-tag.test.ts` (API PATCH-without-tag_names applies auto-tags)

---

#### Interface Contracts

```ts
// src/web/views/bookmark-form.ts — add optional profile to opts
export function bookmarkFormPage(opts: {
  bookmark?: BookmarkRow;
  tagNames?: string[];
  allTags: TagRow[];
  error?: string;
  profile?: UserProfileRow;   // NEW: when present and !bookmark, pre-check unread/shared from defaults
}): string;

// src/services/bookmarks.ts — NO signature change. Existing signatures already accept profile:
//   createBookmark(db, input, profile)            // already applies applyAutoTags internally
//   updateBookmark(db, id, patch, profile?)        // if(profile) branch applies auto-tags (incl. tag_names omitted → fetchExisting)
// T1 only changes CALLERS to pass profile.

// src/api/bookmarks.ts
// handleCreate: remove the `if (profile.auto_tagging_rules) { ...mutate body.tag_names... }` block;
//   keep `createBookmark(c.env.DB, body, profile)`.
// handleUpdate: remove the `if (profile.auto_tagging_rules && body.tag_names) { ... }` block;
//   call `updateBookmark(c.env.DB, id, body, profile)` (pass profile).

// src/web/routes.ts
// GET /bookmarks/new: pass `profile` into bookmarkFormPage({ allTags, profile })
// POST /bookmarks/:id: `updateBookmark(c.env.DB, id, {...}, profile)` — fetch profile via getProfile
```

> No new types. `updateBookmark`'s existing `if (profile)` branch already does `baseTags = patch.tag_names ?? fetchExisting` then `applyAutoTags(profile, newUrl, baseTags)` — so passing `profile` fixes both the web edit and the API PATCH-omits-tags cases with zero service-layer change.

#### Test Cases to Cover

**Web view layer (`test/web-ui.test.ts`):**
- `GET /bookmarks/new` HTML contains `name="unread" ... checked` when `default_mark_unread=1`; absent when `=0`. Same for `shared`.
- Web create with `default_mark_unread=1`, submit form with unread checkbox checked (as rendered) → persisted `unread=1`.
- Web create with `default_mark_unread=1`, submit form after unchecking unread → persisted `unread=0`.
- Web edit (`POST /bookmarks/:id`) with `auto_tagging_rules` matching the URL and `tag_names="userTag"` → bookmark's tags include both the auto-tag and `userTag`.

**API handler layer (`test/bookmarks-auto-tag.test.ts` or `bookmarks-write.test.ts`):**
- `PATCH /api/bookmarks/<id>/` with body `{}` (no `tag_names`, no `url`) and rules matching the existing URL → existing tags preserved AND auto-tag added.
- `PATCH` with `tag_names: ["x"]` and matching rules → tags = `["x", <auto-tag>]` (no duplicate if `x` is the auto-tag).
- `POST /api/bookmarks/` with matching rules → auto-tag applied exactly once (assert tag_names has each auto-tag exactly once).

#### Layer Guidance
- **View:** on the *new* form (`!bookmark`), set the `checked` attribute from `profile?.default_mark_unread` / `profile?.default_mark_shared`. On the *edit* form, keep the existing `bookmark?.unread` / `bookmark?.shared` pre-check (edit reflects current state, not defaults). Escape nothing new — only the `checked` attribute changes.
- **Web route:** `POST /bookmarks/:id` must `getProfile(c.env.DB)` (it currently does not) and pass it as the 4th arg to `updateBookmark`. The create route already reads the checkbox explicitly (`form.get("unread") === "1"`) — keep that; correctness now comes from the form pre-checking defaults.
- **API handler:** deleting the inline merges is safe because `createBookmark`/`updateBookmark` already call `applyAutoTags` when `profile` is passed. Verify no test previously asserted the inline behavior in a way that breaks.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T2: URL scheme allowlist — prevent stored XSS

**Type:** AFK
**Blocked by:** None — can start immediately (parallel with T1)
**Layers touched:** Service, Web view, Utility

**Goal:** Close the P2-4 stored-XSS vector: `normalizeUrl` accepts any `new URL()`-parseable scheme (`javascript:`, `data:`), and the list/detail views render `<a href="${esc(row.url)}">` — `esc` neutralizes HTML chars but not the scheme, so a saved `javascript:alert(1)` bookmark is a clickable executing link (exploitable on the anonymous `/bookmarks/shared` page when public sharing is on). Apply defense-in-depth: reject unsafe schemes at write time (create/import) **and** sanitize the `href` at render time.

**Acceptance Criteria:**
- [ ] `createBookmark` rejects URLs whose scheme is not `http`, `https`, or `ftp` by throwing `InvalidUrlSchemeError` (API → 400; web form → error re-render).
- [ ] `javascript:`, `data:`, `vbscript:`, `file:` URLs are rejected at create.
- [ ] Netscape import skips entries with unsafe schemes (does not abort the whole import; counts them as skipped).
- [ ] List view and detail view render a bookmark whose URL has an unsafe scheme (e.g. pre-existing `javascript:` row) as **non-clickable** (no `href` attribute, or `href=""` with the URL shown as escaped text) — never an executable `href`.
- [ ] `http`/`https`/`ftp` URLs render as normal clickable links.
- [ ] The extension contract test (which only sends `http(s)` URLs) is unaffected.

**Files:**
- Modify: `src/utils/html.ts` (add `safeHref(url): string`)
- Modify: `src/services/bookmarks.ts` (add `InvalidUrlSchemeError` + scheme check at the top of `createBookmark`; export the error class)
- Modify: `src/services/netscape.ts` (skip entries whose URL fails the scheme check during import)
- Modify: `src/web/views/bookmarks.ts` (use `safeHref(row.url)` for the card `<a href>`)
- Modify: `src/web/views/bookmark-detail.ts` (use `safeHref(row.url)` for the detail `<a href>`)
- Modify: `src/api/bookmarks.ts` (map `InvalidUrlSchemeError` → 400 in the POST handler)
- Modify: `test/check-and-services.test.ts` or new `test/url-scheme.test.ts` (reject + skip + render cases)

---

#### Interface Contracts

```ts
// src/utils/html.ts
export function safeHref(url: string): string;
// Returns the url unchanged if its scheme is http/https/ftp (parseable via new URL);
// returns "" otherwise. Caller renders `<a href="${safeHref(url)}">` — empty href is inert.

// src/services/bookmarks.ts
export class InvalidUrlSchemeError extends Error {}

// Inside createBookmark(db, input, profile), before normalizeUrl/insert:
//   validateScheme(input.url);   // throws InvalidUrlSchemeError if scheme not in {http,https,ftp}
// (export a pure helper `isAllowedScheme(url: string): boolean` so netscape.ts and tests reuse it)
export function isAllowedScheme(url: string): boolean;

// src/services/netscape.ts
// In the import loop, skip any NetscapeBookmark where !isAllowedScheme(href); count skips.

// src/api/bookmarks.ts
// POST handler: catch InvalidUrlSchemeError → c.json({ url: ["URL scheme must be http, https, or ftp."] }, 400)
```

> Reuse `isAllowedScheme` in both the service and the import path so the rule has one definition. `safeHref` is the render-time backstop for any pre-existing bad data and for defense-in-depth.

#### Test Cases to Cover

**Service layer:**
- `createBookmark` with `javascript:alert(1)` throws `InvalidUrlSchemeError`.
- `createBookmark` with `data:text/html,<script>` throws.
- `createBookmark` with `http://x`, `https://x`, `ftp://x` succeeds.
- `isAllowedScheme("javascript:1")` → false; `isAllowedScheme("https://x")` → true; `isAllowedScheme("not a url")` → false.

**Import layer:**
- Parse a Netscape fixture with one `javascript:` entry + two `https://` entries → import creates 2 bookmarks, skips 1.

**Render layer (`test/web-ui.test.ts` or `test/public-sharing.test.ts`):**
- Seed a bookmark with `url = "javascript:alert(1)"` directly in D1; `GET /bookmarks/shared` (anonymous, public sharing on) → response HTML does NOT contain `href="javascript:` (assert the anchor has empty href or no href).
- Seed an `https://` bookmark → rendered as a normal `href="https://...` link.

**API layer:**
- `POST /api/bookmarks/` with `url: "javascript:alert(1)"` → 400 with a `url` field.

#### Layer Guidance
- **Utility:** `safeHref` should `try { new URL(url) }` and check `protocol`; any throw → `""`. Keep it pure (no I/O).
- **Service:** put the scheme check at the very top of `createBookmark` (before the dedup lookup) so bad URLs never reach the DB. The upsert path also runs `createBookmark`, so existing-bookmark re-saves of bad URLs get rejected too — acceptable (the extension never sends bad schemes).
- **View:** replace `href="${esc(row.url)}"` with `href="${safeHref(row.url)}"` in both the list card and the detail page. Keep `esc(row.url)` for the visible link *text* (so the user still sees what was stored).
- **Import:** do not throw on a bad entry — skip and continue, mirroring linkding's lenient import.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T3: API & bundle conformance fixes

**Type:** AFK
**Blocked by:** T1 (both modify `src/web/routes.ts`)
**Layers touched:** API handler, Repository, Web view (bundles), Web route

**Goal:** Bring five small spec deviations into conformance with design §4 / the migration design: (P2-1) report a linkding-compatible `version`; (P2-2) accept boolean-style `unread`/`shared` filter values; (P2-3) implement `PATCH /api/bundles/<id>/`; (P2-5) return 401 (not 404) when public shared feed is disabled; (P2-6) expose `filter_unread`/`filter_shared` in the bundle Web form and persist them.

**Acceptance Criteria:**
- [ ] `GET /api/user/profile/` returns `version: "1.45.0"` (a real linkding version the extension feature-gates against).
- [ ] `GET /api/bookmarks/?unread=true` and `?unread=1` and `?unread=yes` all filter to unread bookmarks; `?unread=false`/`0`/`no` filter to read. Same for `shared`. (Existing `yes`/`no` still work.)
- [ ] `PATCH /api/bundles/<id>/` performs a partial update and returns 200 with the updated bundle; 404 on missing id.
- [ ] `GET /feeds/shared` with public sharing disabled returns **401** (not 404).
- [ ] The bundle Web form has `filter_unread` and `filter_shared` selects (`off`/`yes`/`no`); creating/editing a bundle persists both; the saved values round-trip into the edit form.
- [ ] A bundle with `filter_unread=yes` actually filters the bookmark list (the repository already honors these fields — this task only makes them settable from the UI).

**Files:**
- Modify: `src/api/user.ts` (`APP_VERSION = "1.45.0"`)
- Modify: `src/db/repository.ts` (`applyFilters` accepts `true/false/1/0/yes/no` for `unread`/`shared`)
- Modify: `src/api/bundles.ts` (add `bundleRoutes.patch("/:id", ...)` reusing the PUT handler or a partial-update handler)
- Modify: `src/web/views/bundles-view.ts` (add two `<select>` fields for `filter_unread`/`filter_shared`; show `all_tags`/`excluded_tags` values too since the form already collects them)
- Modify: `src/web/routes.ts` (`POST /bundles` and `POST /bundles/:id` read + bind `filter_unread`/`filter_shared`; `GET /feeds/shared` returns 401 when disabled)
- Modify: `test/extension-contract.test.ts` (assert `version === "1.45.0"`; add bundles PATCH case)
- Modify: `test/bookmarks-read.test.ts` (boolean-style `unread`/`shared` filters)
- Modify: `test/public-sharing.test.ts` (`/feeds/shared` disabled → 401; bundle filter fields round-trip)

---

#### Interface Contracts

```ts
// src/api/user.ts
const APP_VERSION = "1.45.0";   // was "0.1.0"

// src/db/repository.ts — extend the unread/shared normalization
// In applyFilters (currently: filters.unread === "yes" ? ... : "no" ? ...):
//   normalize to a tri-state: "yes" | "no" | undefined
//   accepting: "yes"/"true"/"1" → yes; "no"/"false"/"0" → no; else undefined
function normalizeBoolFilter(raw: string | undefined): "yes" | "no" | undefined;

// src/api/bundles.ts
bundleRoutes.patch("/:id", /* partial update: ?? over existing row fields, 404 if missing, 200 serializeBundle */);

// src/web/views/bundles-view.ts — add to the form (values from editing?.filter_unread / editing?.filter_shared):
//   <select name="filter_unread"><option value="off">…<option value="yes">…<option value="no">…</select>
//   <select name="filter_shared"> … </select>

// src/web/routes.ts
// POST /bundles:        bind form.get("filter_unread") || "off", form.get("filter_shared") || "off"
// POST /bundles/:id:    UPDATE … SET …, filter_unread=?, filter_shared=?, … WHERE id=?
// GET /feeds/shared:    return c.json({ detail: "Public sharing is not enabled." }, 401)  // was 404
```

> The repository already honors `bundle.filter_unread`/`filter_shared` (`repository.ts:176-179`), so P2-6 is purely a UI+persistence gap — no query-layer change. P2-2 adds a tiny normalizer so the existing `=== "yes"/"no"` checks keep working while also accepting booleans.

#### Test Cases to Cover

**Profile (`test/extension-contract.test.ts`):**
- `GET /api/user/profile/` → `body.version === "1.45.0"`.

**Boolean filters (`test/bookmarks-read.test.ts`):**
- Seed one unread + one read bookmark. `?unread=true` → 1 result (unread). `?unread=false` → 1 (read). `?unread=1`/`?unread=0` behave the same. `?unread=yes`/`?unread=no` still work (regression).
- Same matrix for `shared`.

**Bundles PATCH (`test/extension-contract.test.ts`):**
- `PATCH /api/bundles/<id>/` `{name: "renamed"}` → 200, only `name` changed, other fields preserved.
- `PATCH /api/bundles/9999/` → 404.

**Feeds 401 (`test/public-sharing.test.ts`):**
- `enable_sharing=0` (or `enable_public_sharing=0`) → `GET /feeds/shared` → 401.

**Bundle web filters (`test/public-sharing.test.ts` or `test/web-ui.test.ts`):**
- `POST /bundles` with `filter_unread=yes` → DB row has `filter_unread='yes'`; `GET /bundles?edit=<id>` → the select shows `yes` selected.
- `POST /bundles/:id` updating `filter_shared=no` → persisted; round-trips into edit form.

#### Layer Guidance
- **Repository:** add `normalizeBoolFilter` and call it for both `filters.unread` and `filters.shared` before the existing `=== "yes"/"no"` comparisons. Keep `"off"` semantics for bundles unchanged (bundle filters are a separate code path using literal `"yes"/"no"/"off"`).
- **Bundles API:** the existing PUT handler already does partial update via `??`; reuse it for PATCH (`bookmarkRoutes.put`/`.patch` share `handleUpdate` in the bookmarks router — mirror that pattern: `bundleRoutes.put("/:id", h); bundleRoutes.patch("/:id", h)`).
- **Bundle view:** the form already collects `all_tags`/`excluded_tags` inputs but the table doesn't show them — optionally add columns; the acceptance criterion is only the two filter selects + round-trip.
- **Feeds:** one-line status change; update the existing test that asserts 404 to assert 401.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T4: Extension contract test fidelity

**Type:** AFK
**Blocked by:** T3 (exercises T3's bundles PATCH + version + filters)
**Layers touched:** Test

**Goal:** Fix P2-7: the contract test drives every endpoint through `app.fetch` with **slash-less** paths, bypassing the default-export trailing-slash normalization (`src/index.ts`) that the real extension depends on (`/api/bookmarks/<id>/`, `/api/bookmarks/check/?url=`, `/api/tags/`, `/api/bundles/<id>/`). Rewrite the suite to exercise the actual extension URL shapes through the Workers default export, and add coverage for the T3 additions (bundles PATCH, `version`, boolean filters).

**Acceptance Criteria:**
- [ ] Every request in `test/extension-contract.test.ts` goes through the Workers **default export** (`export default { fetch }` in `src/index.ts`), not `app.fetch` directly.
- [ ] All extension-style URLs use **trailing slashes** (`/api/bookmarks/`, `/api/bookmarks/<id>/`, `/api/bookmarks/check/?url=`, `/api/bookmarks/archived/`, `/api/tags/`, `/api/bundles/`, `/api/bundles/<id>/`, `/api/user/profile/`).
- [ ] The full extension sequence still passes: testConnection → check → save new → save upsert → get → search → getTags → getUserProfile → delete, with exact status codes (201/204/200) and the exact 16-field bookmark object.
- [ ] Added: `PATCH /api/bundles/<id>/` partial update → 200; `version === "1.45.0"`; `?unread=true` list filter.
- [ ] The existing "Trailing slash compatibility" block is retained or folded into the main flow (no longer a separate special-case).

**Files:**
- Modify: `test/extension-contract.test.ts` (replace the `api()` helper to call the default export; switch all paths to trailing-slash; add the T3 assertions)

---

#### Interface Contracts

```ts
// test/extension-contract.test.ts
// Import the default export instead of (or in addition to) `app`:
import workerApp from "../src/index.js";

// Helper: drive a request through the default export (the real Workers entry point)
async function api(path: string, init?: RequestInit & { token?: string }): Promise<Response> {
  // build Request with trailing-slash path + Authorization header,
  // call workerApp.fetch(request, env, ctx) — exactly what production does
}

// All endpoint paths use trailing slashes, e.g.:
//   api("/api/bookmarks/", { method: "POST", ... })
//   api(`/api/bookmarks/${id}/`)
//   api(`/api/bookmarks/check/?url=${encodeURIComponent(u)}`)
//   api("/api/tags/?limit=5000")
```

> No production code changes. The default export (`src/index.ts`) already strips one trailing slash before dispatching to `app`; routing it through the default export means the slash-strip + Hono route matching is actually exercised for every endpoint the extension calls.

#### Test Cases to Cover

- Full ordered extension sequence (testConnection/check/save-new/save-upsert/get/search/getTags/getUserProfile/delete) through the default export with trailing slashes — exact status codes + 16-field shape.
- `Token` and `Bearer` auth both succeed; missing → 401.
- `PATCH /api/bundles/<id>/` → 200 partial; 404 missing.
- `GET /api/user/profile/` → `version === "1.45.0"`.
- `GET /api/bookmarks/?unread=true` filters correctly.
- Pagination shape `{count,next,previous,results}` for bookmarks + tags.

#### Layer Guidance
- Keep the Miniflare D1 seeding pattern already in the file; only change the request helper and path strings.
- If `workerApp.fetch` needs an `ExecutionContext`, reuse `createExecutionContext()`/`waitOnExecutionContext()` already imported in the test files.
- Do not weaken existing assertions — this task only changes *how* requests are issued and adds T3 coverage.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T5: Test schema hygiene — real migrations in tests

**Type:** AFK
**Blocked by:** T2, T4 (runs last, after all feature tests exist)
**Layers touched:** Test infrastructure

**Goal:** Fix P2-8: every test file redeclares its own inline `migrationSQL` that **diverges from the real migrations** — some omit `default_mark_unread`/`default_mark_shared`, and none use `COLLATE NOCASE` on `tags.name` (which `ensureTag`'s case-insensitive dedup relies on in production). Introduce a shared helper that reads and applies the real `migrations/*.sql`, and refactor all test files to use it. This makes schema drift impossible: a migration change is automatically reflected in tests.

**Acceptance Criteria:**
- [ ] A shared helper `test/helpers/migrations.ts` exports `applyMigrations(db)` that reads `migrations/0001_init.sql` and `migrations/0002_defaults.sql` and executes every statement against the test D1.
- [ ] Every test file that previously declared an inline `migrationSQL` constant now calls `applyMigrations(env.DB)` instead (the inline constant is removed).
- [ ] All 200+ existing tests still pass with zero behavioral change.
- [ ] The shared helper seeds the `user_profile` row (id=1) and the test API token exactly as before (tests that inserted a token via inline SQL keep working — verify the token still authenticates).
- [ ] Adding a new column to a real migration would now surface in tests (the helper reads files), proving drift is eliminated.

**Files:**
- Create: `test/helpers/migrations.ts` (`applyMigrations(db): Promise<void>` reading `migrations/*.sql`)
- Modify: every test file with an inline `migrationSQL` — `test/health.test.ts`, `test/auth.test.ts`, `test/tags.test.ts`, `test/bookmarks-read.test.ts`, `test/bookmarks-write.test.ts`, `test/bookmarks-auto-tag.test.ts`, `test/bulk-actions.test.ts`, `test/check-and-services.test.ts`, `test/default-preferences.test.ts`, `test/web-ui.test.ts`, `test/extension-contract.test.ts`, `test/public-sharing.test.ts`, `test/markdown.test.ts` (if it has one), `test/t7-bookmark-detail.test.ts` (if it has one)

---

#### Interface Contracts

```ts
// test/helpers/migrations.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Reads migrations/0001_init.sql + migrations/0002_defaults.sql from the repo root,
// splits on ';', executes each non-empty statement against the D1 binding.
export async function applyMigrations(db: D1Database): Promise<void>;

// Convenience: apply migrations + seed a known API token for auth'd tests.
// (Extracts the token-seeding currently duplicated inline so tests don't re-implement it.)
export async function setupTestDb(db: D1Database, opts?: { apiToken?: string }): Promise<void>;
```

> The real `migrations/0001_init.sql` already seeds the `user_profile` row and uses `UNIQUE COLLATE NOCASE` on `tags.name`; `0002_defaults.sql` adds the two default columns. So switching tests to the real migrations both fixes the collation gap and guarantees the default columns exist everywhere. Tests that currently seed an API token via inline SQL should move that into `setupTestDb` (or keep a tiny inline `INSERT INTO api_tokens`) — the implementer chooses, but the divergence from production schema must end.

#### Test Cases to Cover

- Smoke test (in `test/helpers/migrations.test.ts` or folded into `health.test.ts`): after `applyMigrations(env.DB)`, all tables exist, `user_profile` has 1 row, `tags.name` enforces case-insensitive uniqueness (inserting "Foo" then "foo" does not create a second row), and `user_profile.default_mark_unread` column exists.
- Regression: every pre-existing test file passes unchanged in behavior after swapping inline schema → `applyMigrations`.

#### Layer Guidance
- Read migration files relative to the repo root (`resolve(__dirname, "../../migrations/...")` or `process.cwd()`); Vitest runs with CWD = repo root, so `resolve("migrations/0001_init.sql")` works.
- Split SQL on `;` and `.trim()`/filter empties, exactly as the existing inline helpers do — the real migrations are already written as `;`-terminated statements.
- Do NOT alter `migrations/*.sql` — the goal is for tests to consume them verbatim.
- Some test files seed extra rows (API token, bookmarks) after schema setup; preserve those inserts, just replace the schema-creation part with `applyMigrations`.
- `markdown.test.ts` likely has no DB; skip files that don't touch D1.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

## Plan Coverage Checklist

- [x] Every approved requirement maps to at least one task —
  - P1-A (web edit auto-tag) → T1
  - P1-B (web create defaults) → T1
  - F1-P2 (API PATCH auto-tag) → T1
  - P2-1 (version) → T3
  - P2-2 (bool filters) → T3
  - P2-3 (bundles PATCH) → T3
  - P2-4 (URL scheme XSS) → T2
  - P2-5 (feeds 401) → T3
  - P2-6 (bundle web filters) → T3
  - P2-7 (contract test fidelity) → T4
  - P2-8 (test schema hygiene) → T5
- [x] Every task has clear acceptance criteria
- [x] Every task lists behavior-focused test cases
- [x] Every task lists exact Create/Modify file paths
- [x] New or modified API endpoints have E2E test task(s) — T4 covers the API surface (incl. T3's bundles PATCH) through the default export; T1/T2/T3 also include per-fix tests
- [x] The dependency graph has no cycles (T1→T3→T4; T2∥T1; T5 blocked by T2+T4)
- [x] Parallelizable tasks do not modify the same files — T1/T3/T4 (all touch `src/web/routes.ts`) are serialized; T2 touches disjoint files (services + `views/bookmarks.ts`/`bookmark-detail.ts`/`utils/html.ts`) and runs parallel with T1; T5 runs alone last
- [x] No task is purely horizontal unless unavoidable — T5 is test-infra (unavoidable to eliminate schema drift) but ships with a smoke test proving the helper works
- [x] Known assumptions or deviations documented —
  - CSRF hardening is OUT OF SCOPE (handled in a separate effort); the earlier "detail-page forms always 403" finding was a false alarm (`web-ui.test.ts:167` asserts POST /bookmarks works without CSRF).
  - `updateBookmark`/`createBookmark` already accept `profile` and apply auto-tags internally — T1 changes only callers, not service signatures.
  - T2 rejects non-http(s)/ftp schemes at write time; the extension only ever sends http(s) so the contract test is unaffected, but any pre-existing bad URLs are neutralized at render via `safeHref`.
  - `version` set to `"1.45.0"` (the source linkding version) so extension feature-gating treats the server as modern.
  - P3 defects (dead `keyword` AST node, unused `buildTagString`, archived endpoint dropping some filters, feed missing `<author>`, unreferenced `favicon.svg`/`apple-touch-icon`) are intentionally NOT in scope for this plan.
