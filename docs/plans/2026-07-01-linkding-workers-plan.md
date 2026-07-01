# linkding-workers Implementation Plan

> **For Pi:** Execute this plan using /skill:subagent-driven-development (current session with subagents).

**Goal:** Build a single-user bookmark app on Cloudflare Workers + D1 (TypeScript/Hono) that is fully compatible with the official linkding browser extension, with a full Web UI, and the approved advanced features (auto-tagging, bundles, Netscape import/export, RSS feeds).

**Architecture:** Hono HTTP app on Cloudflare Workers bound to a D1 (SQLite) database. Stateless request handlers; no background processor. Favicons/preview images stored as external URLs (no R2). Web UI is server-rendered HTML. REST API mirrors the linkding/DRF response shapes exactly so the browser extension works unmodified.

**Tech Stack:** Hono, TypeScript (strict), Cloudflare D1 + Wrangler, `linkedom` (HTML parsing for scraping), Vitest + `@cloudflare/vitest-pool-workers` (unit + D1 integration tests), ESLint + Prettier.

## Task Dependency Graph

All tasks are AFK (no human decision needed mid-flight). The bookmark API endpoint file (`src/api/bookmarks.ts`) is a shared hotspot, so tasks that modify it are serialized; independent branches (Web UI, auxiliary surfaces) run in parallel.

```
T1 (scaffold+schema+health)
 ├─ T2 (auth+profile)   ┐
 └─ T3 (tags)           ┘ parallel
       │
       T4 (bookmarks list+retrieve+serializer+favicon+wayback)
        ├─ T5 (bookmarks write: create/upsert/update/delete/archive)
        │    ├─ T6 (/check + scraping + auto-tagging)
        │    ├─ T9 (Web UI core) ──┬─ T10 (Web UI rest)
        │    │                      ├─ T11 (Netscape import/export)
        │    │                      └─ T12 (RSS feeds + PWA + opensearch + custom_css)
        │    └─ (T7, T8 serialized after T5/T6)
        ├─ T7 (search engine: boolean parser→D1)   [serialized after T6]
        └─ T8 (bundles API + bundle filter)        [serialized after T7]
 T13 (extension E2E contract tests)  [blocked by T6, T8]
```

| Task | Type | Blocked by | Parallelizable with |
|------|------|------------|---------------------|
| T1   | AFK  | None       | — |
| T2   | AFK  | T1         | T3 |
| T3   | AFK  | T1         | T2 |
| T4   | AFK  | T2, T3     | — |
| T5   | AFK  | T4         | — |
| T6   | AFK  | T5         | T9 |
| T7   | AFK  | T6         | T9 |
| T8   | AFK  | T7         | T9, T10, T11, T12 |
| T9   | AFK  | T5         | T6, T7 |
| T10  | AFK  | T9         | T8, T12 |
| T11  | AFK  | T9, T5, T3 | T8, T12 |
| T12  | AFK  | T9, T4     | T8, T10, T11 |
| T13  | AFK  | T6, T8     | T10, T11, T12 |

**Shared-file rule:** T6, T7, T8 all touch `src/api/bookmarks.ts` (check route / list query / bundle filter) and are therefore serialized (T6→T7→T8). Each is parallel with the Web UI branch (T9+) which lives under `src/web/`.

---

### Task T1: Project scaffold + D1 schema + /health + test harness

**Type:** AFK
**Blocked by:** None
**Layers touched:** Infrastructure, DB schema, Handler

**Goal:** Stand up the Workers project skeleton, full D1 schema (all tables), a `/health` endpoint, and a working Vitest harness that runs integration tests against an isolated Miniflare D1 — so every later task can write tests against a real D1.

**Acceptance Criteria:**
- [ ] `npm install` succeeds; `npm run build` (tsc --noEmit) passes; `npm run lint` passes.
- [ ] `npm test` runs a sample integration test against D1 and passes.
- [ ] `GET /health` returns `200` with `{"status":"ok"}`.
- [ ] D1 migration applies cleanly (all tables created).
- [ ] `wrangler.toml` declares the D1 binding `DB` and a `dev` script.

**Files:**
- Create: `linkding-workers/package.json`, `tsconfig.json`, `wrangler.toml`, `.eslintrc.cjs`, `.prettierrc`, `vitest.config.ts`
- Create: `src/index.ts` (Hono app + route mount), `src/env.ts` (Env type: `DB: D1Database`, secrets)
- Create: `migrations/0001_init.sql` (full schema), `src/db/schema.ts` (TS types mirroring tables)
- Create: `src/db/repository.ts` (empty seeded helpers if any; mostly stub for now)
- Create: `src/health.ts` (`GET /health`)
- Create: `test/setup.ts` (Miniflare D1 harness helper), `test/health.test.ts`

#### Interface Contracts

```ts
// src/env.ts
export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;      // HMAC secret for web session cookies
  APP_PASSWORD_HASH: string;   // argon2/scrypt-style hash of single-user password
}
export type AppContext = Context<{ Bindings: Env }>; // Hono context

// src/db/schema.ts — TS row types mirroring migrations/0001_init.sql
export interface BookmarkRow { id:number; url:string; url_normalized:string; title:string; description:string; notes:string; web_archive_snapshot_url:string; favicon_url:string; preview_image_url:string; unread:number; is_archived:number; shared:number; date_added:string; date_modified:string; date_accessed:string|null; }
export interface TagRow { id:number; name:string; date_added:string; }
export interface BookmarkTagRow { bookmark_id:number; tag_id:number; }
export interface BundleRow { id:number; name:string; search:string; any_tags:string; all_tags:string; excluded_tags:string; filter_unread:string; filter_shared:string; order:number; date_created:string; date_modified:string; }
export interface ApiTokenRow { id:number; key:string; name:string; created:string; }
export interface FeedTokenRow { key:string; created:string; }
export interface UserProfileRow { id:number; theme:string; bookmark_date_display:string; bookmark_link_target:string; web_archive_integration:string; tag_search:string; enable_sharing:number; enable_public_sharing:number; enable_favicons:number; display_url:number; permanent_notes:number; search_preferences:string; auto_tagging_rules:string; items_per_page:number; legacy_search:number; }

// src/index.ts
export default app; // Hono instance; routes registered here by each task
```

`migrations/0001_init.sql` creates: `bookmarks`, `tags` (UNIQUE name), `bookmark_tags` (composite PK + FKs), `bundles`, `api_tokens` (UNIQUE key, index), `feed_tokens` (PK key), `user_profile` (single row seeded with defaults). All boolean columns `INTEGER NOT NULL DEFAULT 0`. Timestamps stored as ISO-8601 TEXT (UTC `...Z`).

#### Test Cases to Cover
- `GET /health` returns 200 + `{"status":"ok"}` (integration via Miniflare).
- D1 harness: can insert and read a row from each table (smoke test the binding works in tests).

#### Layer Guidance
- Keep `index.ts` minimal — just `new Hono()` and `app.route(...)` mounts; later tasks add routes.
- Use `@cloudflare/vitest-pool-workers` so tests run in the Workers runtime with a real D1.
- Seed one `user_profile` row in the migration.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T2: API auth (Token/Bearer) + /api/user/profile/

**Type:** AFK
**Blocked by:** T1
**Layers touched:** Middleware, Repository, Handler, Serializer

**Goal:** Implement token auth middleware (compatible with the extension's `Authorization: Token <token>` / `Bearer <token>`) and the `GET /api/user/profile/` endpoint returning the profile JSON + `version`, exactly as the extension expects.

**Acceptance Criteria:**
- [ ] Request with valid `Authorization: Token <key>` or `Bearer <key>` reaches protected routes.
- [ ] Missing/invalid token → `401` (DRF-style `{"detail":"Invalid token."}` is acceptable).
- [ ] `GET /api/user/profile/` returns 200 with all `UserProfileSerializer` fields + `version`.
- [ ] Profile fields match the linkding response shape (see design §4).

**Files:**
- Create: `src/api/auth.ts` (middleware + `requireApiToken`)
- Create: `src/api/user.ts` (`GET /api/user/profile/`)
- Create: `src/api/serializers.ts` (`serializeUserProfile`)
- Modify: `src/index.ts` (mount `/api/user`)

#### Interface Contracts
```ts
// src/api/auth.ts
export const apiTokenAuth: MiddlewareHandler<{ Bindings: Env }>;
// sets c.set("token", ApiTokenRow) on success; 401 on failure.
// Accepts both "Token" and "Bearer" keywords (case-insensitive).

// src/api/serializers.ts
export interface UserProfileResponse {
  theme:string; bookmark_date_display:string; bookmark_link_target:string;
  web_archive_integration:string; tag_search:string; enable_sharing:boolean;
  enable_public_sharing:boolean; enable_favicons:boolean; display_url:boolean;
  permanent_notes:boolean; search_preferences:Record<string,unknown>; version:string;
}
export function serializeUserProfile(row:UserProfileRow, version:string):UserProfileResponse;

// src/api/user.ts
export const userRoutes = new Hono<{ Bindings: Env }>();
// GET /profile/  -> 200 UserProfileResponse (apply apiTokenAuth)
```

#### Test Cases to Cover
- 200 on valid Token; 200 on valid Bearer; 401 on missing header; 401 on unknown token; 401 on malformed header.
- Profile response includes `version` and all boolean fields coerced to JS booleans; `search_preferences` parsed to object.

#### Layer Guidance
- Token lookup: `SELECT * FROM api_tokens WHERE key = ?`. Single-user → any valid token authenticates.
- Read the single `user_profile` row (id=1).

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T3: Tags API + tag utilities

**Type:** AFK
**Blocked by:** T1
**Layers touched:** Domain, Repository, Handler, Serializer

**Goal:** Implement tag string parsing/sanitization (port `parse_tag_string`/`sanitize_tag_name`/`build_tag_string`) and the `GET /api/tags/` (paginated) + `POST /api/tags/` endpoints.

**Acceptance Criteria:**
- [ ] `GET /api/tags/?limit=&offset=` returns `{count,next,previous,results}` with `{id,name,date_added}` items.
- [ ] `POST /api/tags/ {name}` creates or returns existing tag (idempotent get-or-create); 201.
- [ ] Tag names sanitized (spaces→`-`), de-duplicated case-insensitively, sorted lowercase.

**Files:**
- Create: `src/services/tags.ts` (`sanitizeTagName`, `parseTagString`, `buildTagString`)
- Create: `src/api/tags.ts` (routes)
- Create: `src/api/serializers.ts` additions: `serializeTag`
- Modify: `src/index.ts` (mount `/api/tags`)

#### Interface Contracts
```ts
// src/services/tags.ts
export function sanitizeTagName(name:string):string;           // strip + replace spaces with "-"
export function parseTagString(tagString:string, delimiter?:string):string[]; // sanitize, drop empty, dedupe (case-insensitive), sort lowercase
export function buildTagString(names:string[], delimiter?:string):string;

// src/api/tags.ts
export const tagRoutes = new Hono<{ Bindings: Env }>();
// GET /  -> paginated {results:[{id,name,date_added}]}
// POST / {name} -> 201 {id,name,date_added}  (get-or-create)
```

#### Test Cases to Cover
- `parseTagString("a, b , a, C")` → `["a","b","C"]` (dedupe case-insensitive, sorted).
- `sanitizeTagName("  hello world ")` → `"hello-world"`.
- List pagination: `limit`/`offset`, `next`/`previous` absolute URLs or null.
- POST idempotent: posting same name twice returns same id.

#### Layer Guidance
- Tags are global (single-user). `get-or-create` by lowercased name.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T4: Bookmarks list + retrieve + serializer + favicon + wayback

**Type:** AFK
**Blocked by:** T2, T3
**Layers touched:** Domain, Repository, Handler, Serializer, Services

**Goal:** Implement the bookmark read path: full `BookmarkSerializer` (exact field set incl. `tag_names`, `favicon_url`, `preview_image_url`, `web_archive_snapshot_url`, `website_title`/`website_description`), `GET /api/bookmarks/` (list with `q` simple LIKE, `limit`/`offset`, `sort`, `modified_since`, `added_since`, `unread`/`shared` filters), `GET /api/bookmarks/<id>/`, and `GET /api/bookmarks/archived/`. Includes the `wayback` and `favicon` services.

**Acceptance Criteria:**
- [ ] List returns DRF paginated `{count,next,previous,results}`; default limit 100.
- [ ] Bookmark object has exactly the 16 fields (see design §4); booleans are JS booleans; `tag_names` is a string array.
- [ ] `q` does case-insensitive LIKE across title/description/notes/url (simple search; boolean parser comes in T7).
- [ ] `sort` supports `added_asc`/`added_desc`/`title_asc`/`title_desc`.
- [ ] `favicon_url` derived from URL host; `web_archive_snapshot_url` via wayback service when profile `web_archive_integration === 'enabled'`, else linkding fallback URL.
- [ ] `GET /api/bookmarks/<id>/` returns 404 for unknown id.
- [ ] `archived/` lists only `is_archived=1`.

**Files:**
- Create: `src/services/wayback.ts`, `src/services/favicon.ts`, `src/services/url.ts` (`normalizeUrl` port)
- Create: `src/db/repository.ts` bookmark query helpers (`listBookmarks`, `getBookmark`, `countBookmarks`)
- Create: `src/api/bookmarks.ts` (GET list/retrieve/archived only this task)
- Create: `src/api/serializers.ts` additions: `serializeBookmark`
- Modify: `src/index.ts` (mount `/api/bookmarks`)

#### Interface Contracts
```ts
// src/services/url.ts
export function normalizeUrl(url:string):string; // port of linkding normalize_url

// src/services/wayback.ts
export function generateFallbackWebarchiveUrl(url:string, timestampIso:string|null):string|null;
// -> "https://web.archive.org/web/<YYYYMMDDhhmmss>/<url>"

// src/services/favicon.ts
export function deriveFaviconUrl(url:string):string; // google s2 favicons by host

// src/api/serializers.ts
export interface BookmarkResponse {
  id:number; url:string; title:string; description:string; notes:string;
  web_archive_snapshot_url:string|null; favicon_url:string|null; preview_image_url:string|null;
  is_archived:boolean; unread:boolean; shared:boolean; tag_names:string[];
  date_added:string; date_modified:string; website_title:null; website_description:null;
}
export function serializeBookmark(row:BookmarkRow, tagNames:string[], opts:{profile:UserProfileRow; baseUrl:string}):BookmarkResponse;

// src/api/bookmarks.ts
export const bookmarkRoutes = new Hono<{ Bindings: Env }>();
// GET /            -> list (q, limit, offset, sort, modified_since, added_since, unread, shared)
// GET /archived/   -> archived list
// GET /:id/        -> single
```

#### Test Cases to Cover
- `normalizeUrl("HTTPS://Example.com/A/?b=2&a=1")` → scheme/host lowercase, path trailing slash stripped, query sorted.
- wayback URL format for a known timestamp.
- List pagination shape + `count` correctness.
- Bookmark serializer field set + types (booleans, tag_names array, website_* null).
- `q` matches title/description/notes/url (case-insensitive); `sort` orders correctly.
- 404 on missing id; `archived/` excludes non-archived.

#### Layer Guidance
- Repository builds SQL with `WHERE`/`ORDER BY` and `LIMIT`/`OFFSET`; fetch tag_names via a join/subquery on `bookmark_tags`+`tags`.
- `serializeBookmark` needs the profile (for web_archive_integration) and base URL (for absolute `next`/`previous`).

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T5: Bookmarks write — create/upsert + update + delete + archive/unarchive

**Type:** AFK
**Blocked by:** T4
**Layers touched:** Domain, Repository, Handler

**Goal:** Implement the bookmark write path matching linkding semantics the extension depends on: `POST /api/bookmarks/?disable_scraping&disable_html_snapshot` upserts on duplicate normalized URL (returns **201**), `PUT`/`PATCH` update (400 on duplicate URL), `DELETE` (204), `POST /:id/archive/` & `/:id/unarchive/` (204). Tag assignment via `tag_names`. Auto-tagging rules NOT applied here (T6 applies them on /check; linkding applies on update too — apply auto-tags on create/update by calling the auto-tagging service once it exists in T6; for T5, leave a `TODO`/hook but keep tests green).

**Acceptance Criteria:**
- [ ] POST with new URL → 201 + full bookmark; `date_added`/`date_modified` set to now (unless provided).
- [ ] POST with existing normalized URL → updates in place, returns 201 + updated bookmark (silent upsert).
- [ ] `?disable_scraping` honored (no fetch — there is no fetch on POST anyway).
- [ ] PUT/PATCH updates provided fields; 400 `{"url":"A bookmark with this URL already exists."}` on duplicate URL belonging to another bookmark.
- [ ] DELETE → 204; 404 if missing.
- [ ] archive/unarchive → 204; toggles `is_archived`.
- [ ] `tag_names` assigned (creates missing tags), replacing existing tags on update.

**Files:**
- Modify: `src/api/bookmarks.ts` (add POST/PUT/PATCH/DELETE/archive/unarchive)
- Modify: `src/db/repository.ts` (`upsertBookmark`, `updateBookmark`, `deleteBookmark`, `setBookmarkTags`, `archiveBookmark`)
- Create: `src/services/bookmarks.ts` (orchestration: dedup lookup, tag sync, auto-tag hook)

#### Interface Contracts
```ts
// src/services/bookmarks.ts
export interface CreateBookmarkInput {
  url:string; title?:string; description?:string; notes?:string;
  is_archived?:boolean; unread?:boolean; shared?:boolean; tag_names?:string[];
  date_added?:string; date_modified?:string;
}
export async function createBookmark(db:D1Database, input:CreateBookmarkInput, profile:UserProfileRow):Promise<BookmarkRow>;
// upsert semantics: lookup by normalizeUrl(input.url); if found update, else insert. Returns saved row.

export async function updateBookmark(db:D1Database, id:number, patch:Partial<CreateBookmarkInput>, profile:UserProfileRow):Promise<BookmarkRow>;
// throws DuplicateUrlError if patch.url collides with another bookmark.

export async function deleteBookmark(db:D1Database, id:number):Promise<void>;
export async function setArchived(db:D1Database, id:number, archived:boolean):Promise<void>;

export class DuplicateUrlError extends Error {}
```

#### Test Cases to Cover
- POST new → 201, row exists, tag_names persisted.
- POST duplicate URL → 201, same id, fields updated (e.g., title overwritten).
- POST with empty title/description → stored empty (no scraping on POST; extension always sends disable_scraping).
- PATCH updates one field, leaves others; `tag_names` fully replaced.
- PUT/PATCH to a URL owned by another bookmark → 400 with url error.
- DELETE → 204; subsequent GET → 404.
- archive then unarchive toggles `is_archived`; both 204.
- 404s for missing ids on update/delete/archive.

#### Layer Guidance
- Wrap each handler in a D1 transaction where multiple writes occur (bookmark + bookmark_tags).
- `setBookmarkTags`: delete existing `bookmark_tags` for the bookmark, insert new (resolving tag ids via get-or-create).
- Auto-tagging: T6 provides `getTags(rules, url)`. To avoid a circular dependency, T5 may merge auto-tags only if the service exists; otherwise skip. Document this as the T6→T5 integration point (T6 will wire it). **Decision:** T5 implements an injectable `autoTagger?: (url:string)=>string[]` hook defaulting to none; T6 supplies it via module binding.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T6: /check endpoint + scraping + auto-tagging

**Type:** AFK
**Blocked by:** T5
**Layers touched:** Services, Handler

**Goal:** Implement `GET /api/bookmarks/check/?url=` returning `{bookmark, metadata, auto_tags}` — server-side metadata scraping via Workers `fetch` + `linkedom` (read until `</head>`), and the auto-tagging rule engine (port `auto_tagging.py`). Also wire auto-tagging into create/update (the hook T5 left).

**Acceptance Criteria:**
- [ ] `GET /api/bookmarks/check/?url=<u>` returns 200 `{bookmark: <BookmarkResponse|null>, metadata: {url,title,description,preview_image}, auto_tags: string[]}`.
- [ ] Scraping fetches the URL, parses `<title>`, `<meta name=description>`, `og:description`, `og:image` (resolve relative URLs).
- [ ] Scraping never throws on fetch/parse failure — returns null fields.
- [ ] `auto_tags` computed from `user_profile.auto_tagging_rules` for the URL.
- [ ] Auto-tagging merged into `tag_names` on create/update (T5 hook wired).

**Files:**
- Create: `src/services/scraping.ts` (`loadWebsiteMetadata(url):Promise<WebsiteMetadata>`)
- Create: `src/services/auto-tagging.ts` (`getTags(script:string, url:string):string[]` port)
- Modify: `src/api/bookmarks.ts` (add `GET /check/`, wire auto-tagger into T5 service)
- Modify: `src/services/bookmarks.ts` (default autoTagger now calls auto-tagging service)

#### Interface Contracts
```ts
// src/services/scraping.ts
export interface WebsiteMetadata { url:string; title:string|null; description:string|null; preview_image:string|null; }
export async function loadWebsiteMetadata(url:string):Promise<WebsiteMetadata>;
// fetch with browser-like headers; read body until "</head>" (cap ~5MB); parse with linkedom.

// src/services/auto-tagging.ts
export function getTags(script:string, url:string):string[]; // port of auto_tagging.get_tags

// src/api/bookmarks.ts (added route)
// GET /check/?url=&ignore_cache=  -> {bookmark, metadata, auto_tags}
```

#### Test Cases to Cover
- `getTags` with sample rules + URLs (matching host/path/query/fragment; non-matching; comments; multiple tags). Port the python test expectations.
- Scraping: use a fixture HTML string (test the parser function directly, not the network) → extracts title/description/og:image; relative og:image resolved.
- Scraping returns nulls on malformed HTML / empty.
- `/check` returns existing bookmark when URL already saved; `bookmark` null when not.
- Auto-tags appear in `/check` response.
- Create with a URL matching rules → saved bookmark `tag_names` includes auto-tags merged with provided tags.

#### Layer Guidance
- Split scraping into `fetchHead(url)` (network) and `parseMetadata(html, baseUrl)` (pure) so the parser is unit-testable without network.
- Auto-tagging is pure (no network) — port `auto_tagging.py` 1:1 (host via `idna`? Use `URL` host; punycode via `URL` is automatic in Workers).

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T7: Search engine (boolean expression parser → D1 query builder)

**Type:** AFK
**Blocked by:** T6
**Layers touched:** Domain (parser), Repository (query builder), Handler

**Goal:** Replace the simple `q` LIKE matching in the bookmarks list with the full boolean search engine (port `search_query_parser.py`): tokenizer → recursive-descent parser → AST (`Term`/`Tag`/`SpecialKeyword`/`And`/`Or`/`Not`/grouping), compiled to D1 SQL with `LIKE` over (title,description,notes,url) + tag joins for `#tag`. Support `lax` tag-search mode and `legacy_search` toggle.

**Acceptance Criteria:**
- [ ] Parser produces correct AST for terms, `"phrases"`, `#tag`, `and`/`or`/`not`, parentheses, implicit AND.
- [ ] `rome (#article or #book)` compiles to SQL returning the right bookmarks.
- [ ] `#tag` uses tag join; bare terms match fields (and tag names in lax mode).
- [ ] `not #article` excludes matching bookmarks.
- [ ] Parse errors fall back to legacy/simple search (no 500).
- [ ] `legacy_search=1` profile setting uses simple AND-of-terms search.

**Files:**
- Create: `src/services/search.ts` (tokenizer, parser, AST types, `parseSearchQuery`, `expressionToString`, `extractTagNamesFromQuery`)
- Create: `src/db/search-query.ts` (`compileSearch(ast, {tagSearchMode}): {sql, params}` for D1)
- Modify: `src/api/bookmarks.ts` (list `q` now uses compiled search; legacy toggle)
- Modify: `src/db/repository.ts` (`listBookmarks` accepts compiled where-clause)

#### Interface Contracts
```ts
// src/services/search.ts
export type SearchExpression =
  | { type:"term"; term:string }
  | { type:"tag"; tag:string }
  | { type:"keyword"; keyword:string }
  | { type:"and"; left:SearchExpression; right:SearchExpression }
  | { type:"or";  left:SearchExpression; right:SearchExpression }
  | { type:"not"; operand:SearchExpression };
export function parseSearchQuery(query:string):SearchExpression|null;
export function expressionToString(expr:SearchExpression|null):string;
export function extractTagNamesFromQuery(query:string, lax:boolean):string[];

// src/db/search-query.ts
export interface CompiledSearch { whereSql:string; params:unknown[]; }
export function compileSearch(ast:SearchExpression|null, opts:{lax:boolean}):CompiledSearch|null;
```

#### Test Cases to Cover
- Tokenizer/parser: each expression type; implicit AND; precedence (`a or b and c` → `a or (b and c)`); grouping; quoted phrases with escapes; `#tag` with no content ignored; unclosed quote lenient.
- `expressionToString` round-trips equivalent queries.
- `extractTagNamesFromQuery` dedupes case-insensitively + sorts; lax includes bare terms.
- Query builder: `rome (#article or #book)` returns only matching bookmarks (integration test against D1 with seeded data); `not #article` excludes.

#### Layer Guidance
- The query builder emits parameterized SQL with `LIKE` and `EXISTS (SELECT 1 FROM bookmark_tags ...)`. Map `Not` via `NOT EXISTS`/`NOT ( ... )`.
- Keep the simple `q` path as the `legacy_search` fallback.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T8: Bundles API (CRUD) + bundle filter in list

**Type:** AFK
**Blocked by:** T7
**Layers touched:** Domain, Repository, Handler, Serializer

**Goal:** Implement `GET/POST/PUT/PATCH/DELETE /api/bundles/` + `/api/bundles/<id>/` and the `?bundle=<id>` filter on the bookmarks list (a bundle = saved search: `search`, `any_tags`, `all_tags`, `excluded_tags`, `filter_unread`, `filter_shared`).

**Acceptance Criteria:**
- [ ] Bundle CRUD returns DRF shapes; `order` auto-assigned to next position when omitted.
- [ ] `GET /api/bookmarks/?bundle=<id>` filters bookmarks by the bundle's criteria (search text via T7 engine + any/all/excluded tag matching + unread/shared filters).
- [ ] `any_tags` = OR over tags, `all_tags` = AND, `excluded_tags` = NOT.

**Files:**
- Create: `src/api/bundles.ts` (CRUD routes)
- Create: `src/api/serializers.ts` additions: `serializeBundle`
- Create: `src/db/repository.ts` additions: bundle CRUD + `applyBundleToSearch(bundle, search)` merging bundle criteria into the search AST
- Modify: `src/api/bookmarks.ts` (list reads `bundle` param, merges into search)

#### Interface Contracts
```ts
// src/api/bundles.ts
export const bundleRoutes = new Hono<{ Bindings: Env }>();
// GET /  POST /  GET /:id/  PUT|PATCH /:id/  DELETE /:id/

// src/api/serializers.ts
export interface BundleResponse { id:number; name:string; search:string; any_tags:string; all_tags:string; excluded_tags:string; filter_unread:string; filter_shared:string; order:number; date_created:string; date_modified:string; }
export function serializeBundle(row:BundleRow):BundleResponse;
```

#### Test Cases to Cover
- CRUD: create (order auto), retrieve, update (PATCH partial), delete → 404 after.
- `any_tags`: bookmark tagged with any of the listed tags matches.
- `all_tags`: must have all listed tags.
- `excluded_tags`: must not have any listed tags.
- Bundle `search` text combined with tag filters.
- `filter_unread` yes/no/off and `filter_shared` yes/no/off.

#### Layer Guidance
- Merge bundle criteria into the T7 search AST: wrap the bundle's `search` expression and add tag constraints. Reuse `compileSearch`.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T9: Web UI core — session auth + layout + bookmarks list

**Type:** AFK
**Blocked by:** T5
**Layers touched:** Web (SSR), Auth, Handler

**Goal:** Build the SSR Web UI foundation: session-cookie login/logout (password from `APP_PASSWORD_HASH`), base HTML layout with light/dark theme CSS, and the bookmarks list page (`/bookmarks`, `/bookmarks/archived`, `/bookmarks/shared`) with search box, filters, pagination — calling the same repository/services as the API.

**Acceptance Criteria:**
- [ ] `GET /login` shows form; `POST /login` verifies password, sets HMAC-signed `session` cookie; `GET /logout` clears it.
- [ ] Web routes behind `webAuth` middleware redirect to `/login` when unauthenticated.
- [ ] `/bookmarks` renders a list with search (`q`), sort, unread/shared/tag filters, pagination.
- [ ] `/bookmarks/archived` and `/bookmarks/shared` render filtered lists.
- [ ] `/` redirects to `/bookmarks`.
- [ ] Pages render with light/dark theme based on profile.

**Files:**
- Create: `src/web/auth.ts` (session cookie sign/verify via Web Crypto HMAC, `webAuth` middleware)
- Create: `src/web/routes.ts` (mount web routes), `src/web/views/layout.ts` (base HTML), `src/web/views/bookmarks.ts` (list page)
- Create: `src/web/views/login.ts`
- Create: `src/services/password.ts` (verify password hash — use SubtleCrypto; pick scrypt/PBKDF2)
- Modify: `src/index.ts` (mount web routes)

#### Interface Contracts
```ts
// src/web/auth.ts
export async function createSession(env:Env):Promise<string>;        // returns signed cookie value
export async function verifySession(env:Env, cookie:string):Promise<boolean>;
export const webAuth: MiddlewareHandler<{ Bindings: Env }>;

// src/services/password.ts
export async function verifyPassword(env:Env, password:string):Promise<boolean>;
// uses APP_PASSWORD_HASH (format: "<alg>$<...>"); implement PBKDF2-SHA256 via SubtleCrypto.

// src/web/views/layout.ts
export function layout(title:string, bodyHtml:string, profile:UserProfileRow):string;
```

#### Test Cases to Cover
- Login with correct password → 302 to /bookmarks + Set-Cookie; wrong password → 401/re-renders form.
- Unauthenticated GET /bookmarks → 302 to /login.
- Authenticated /bookmarks returns 200 HTML containing bookmark titles.
- Search `q` filters the rendered list; archived/shared pages show correct subsets.
- Session cookie tampering → treated as unauthenticated.

#### Layer Guidance
- Reuse `listBookmarks`/`compileSearch` from the API layer — do not duplicate query logic.
- HTML built with tagged templates; escape all interpolated values (XSS-safe).

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T10: Web UI rest — new/edit/delete + tags + bundles + settings

**Type:** AFK
**Blocked by:** T9
**Layers touched:** Web (SSR), Handler

**Goal:** Complete the Web UI: `/bookmarks/new`, `/bookmarks/<id>/edit`, delete action, `/tags` (list + merge), `/bundles` (CRUD), `/settings` (general prefs, auto-tagging rules, API token generate/delete, import, export link).

**Acceptance Criteria:**
- [ ] New/edit forms create/update bookmarks via the same services as the API; delete removes.
- [ ] `/tags` lists tags and supports merging one tag into another.
- [ ] `/bundles` full CRUD via forms.
- [ ] `/settings` updates `user_profile`; generates/shows/deletes API tokens (so the extension can be configured); links to import/export.
- [ ] All form submissions are CSRF-protected (double-submit cookie or same-origin check).

**Files:**
- Create: `src/web/views/bookmark-form.ts`, `src/web/views/tags.ts`, `src/web/views/bundles.ts`, `src/web/views/settings.ts`
- Create: `src/web/csrf.ts` (CSRF token helper)
- Modify: `src/web/routes.ts` (add routes)

#### Interface Contracts
```ts
// src/web/csrf.ts
export function issueCsrf(env:Env, session:string):string;
export function verifyCsrf(env:Env, session:string, token:string):boolean;

// src/web/routes.ts (added)
// GET /bookmarks/new  POST /bookmarks  GET /bookmarks/:id/edit  POST /bookmarks/:id  POST /bookmarks/:id/delete
// GET /tags  POST /tags/merge
// GET /bundles  POST /bundles  GET /bundles/:id/edit  POST /bundles/:id  POST /bundles/:id/delete
// GET /settings  POST /settings  POST /settings/api-token  POST /settings/api-token/delete
```

#### Test Cases to Cover
- Create bookmark via web → appears in list; edit → changes persist; delete → gone.
- Tag merge: bookmarks retagged, source tag removed.
- Settings update persists prefs; API token generation returns a key once (not retrievable later); delete removes it.
- CSRF: POST without valid token → 403.

#### Layer Guidance
- API token shown only once on creation (store hash? linkding stores plaintext key — for single-user parity, store the key; display only on creation).
- Reuse `createBookmark`/`updateBookmark`/`deleteBookmark` services.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T11: Netscape import/export

**Type:** AFK
**Blocked by:** T9, T5, T3
**Layers touched:** Services, Web, Handler

**Goal:** Port `parser.py` (Netscape bookmark HTML → bookmarks) and `exporter.py` (bookmarks → Netscape HTML), wire into `/settings/import` (upload) and `/settings/export` (download). Round-trip the `linkding:bookmarks.archived` tag and `[linkding-notes]...[/linkding-notes]` notes convention.

**Acceptance Criteria:**
- [ ] Import parses Netscape HTML, creates bookmarks (get-or-create by normalized URL), assigns tags, sets archived/unread/shared from flags, preserves notes.
- [ ] Export generates valid Netscape HTML with all bookmarks (archived marked via tag, notes embedded).
- [ ] Import is idempotent (re-importing updates existing rather than duplicating).
- [ ] Export includes `ADD_DATE`/`LAST_MODIFIED`/`PRIVATE`/`TOREAD`/`TAGS` attributes.

**Files:**
- Create: `src/services/netscape.ts` (`parseNetscape(html):NetscapeBookmark[]`, `exportNetscapeHtml(bookmarks):string`)
- Create: `src/web/views/import.ts` (upload form + result summary)
- Modify: `src/web/routes.ts` (`POST /settings/import`, `GET /settings/export`)

#### Interface Contracts
```ts
// src/services/netscape.ts
export interface NetscapeBookmark {
  href:string; hrefNormalized:string; title:string; description:string; notes:string;
  dateAdded:string; dateModified:string; tagNames:string[]; toRead:boolean; privateFlag:boolean; archived:boolean;
}
export function parseNetscape(html:string):NetscapeBookmark[];
export function exportNetscapeHtml(rows:BookmarkRow[] & {tagNames:string[]}[]):string;
```

#### Test Cases to Cover
- Parse a sample Netscape HTML (multiple bookmarks, tags, DD description, notes block) → correct field extraction.
- Archived tag detection; private/toRead flags.
- Export a set of bookmarks → valid HTML re-parseable by `parseNetscape` (round-trip).
- Import idempotency: import same file twice → no duplicate rows.
- Export includes correct timestamp attributes.

#### Layer Guidance
- Use `linkedom` to parse (or a small state machine mirroring the python HTMLParser). Prefer `linkedom` for consistency with scraping.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T12: RSS/Atom feeds + PWA manifest + opensearch + custom_css

**Type:** AFK
**Blocked by:** T9, T4
**Layers touched:** Services, Web, Handler

**Goal:** Implement RSS/Atom feeds (`/feeds/<key>/all|unread|shared` keyed by `feed_tokens`), PWA `manifest.json`, `opensearch.xml`, and `/custom_css` (serves profile custom CSS with hash-based caching).

**Acceptance Criteria:**
- [ ] `GET /feeds/<key>/all` returns valid Atom feed of all bookmarks for the token's owner; `/unread` and `/shared` filter accordingly.
- [ ] Invalid/missing feed key → 404.
- [ ] `GET /manifest.json` returns a PWA manifest; `GET /opensearch.xml` returns OpenSearch descriptor pointing at `/bookmarks?q=`.
- [ ] `GET /custom_css` returns profile custom CSS (empty 200 if none); correct Content-Type.

**Files:**
- Create: `src/services/feeds.ts` (`buildAtomFeed(bookmarks, opts):string`)
- Create: `src/web/feeds.ts` (routes)
- Create: `src/web/manifest.ts`, `src/web/opensearch.ts`, `src/web/custom-css.ts`
- Modify: `src/web/routes.ts` (mount)

#### Interface Contracts
```ts
// src/services/feeds.ts
export function buildAtomFeed(bookmarks:BookmarkRow[], opts:{title:string; selfUrl:string; siteUrl:string}):string;

// src/web/feeds.ts
// GET /feeds/:key/all  GET /feeds/:key/unread  GET /feeds/:key/shared
```

#### Test Cases to Cover
- Feed key lookup: valid → 200 Atom XML; invalid → 404.
- Feed content includes bookmark titles/urls/dates; unread/shared filters correct.
- manifest.json valid JSON with name/start_url/display; opensearch.xml references the search URL.
- custom_css returns stored CSS with `text/css`; empty string when none.

#### Layer Guidance
- Feed tokens: single row in `feed_tokens` (single user). Generate one in settings if missing (T10 settings could expose this — keep minimal: auto-create on first feed request if a token env var is set, or add a settings action later).

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

### Task T13: Extension compatibility E2E contract tests

**Type:** AFK (this is the E2E task for the API endpoints)
**Blocked by:** T6, T8
**Layers touched:** Test

**Goal:** A dedicated contract test suite asserting the server behaves exactly as the official linkding browser extension expects — the full call sequence the extension performs (`linkding.js`): test connection → check → save (new + upsert) → get → list/search → tags → profile → delete, with exact status codes and response field shapes.

**Acceptance Criteria:**
- [ ] `testConnection`: `GET /api/bookmarks/?limit=1` → 200, body has `results` array.
- [ ] `check`: `GET /api/bookmarks/check/?url=` → 200 `{bookmark, metadata, auto_tags}`.
- [ ] `saveBookmark` new: `POST /api/bookmarks/?disable_scraping` → 201 + full bookmark object (16 fields).
- [ ] `saveBookmark` upsert: POST same URL again → 201, same id, updated fields.
- [ ] `getBookmark`: `GET /api/bookmarks/<id>/` → 200.
- [ ] `search`: `GET /api/bookmarks/?q=&limit=` → 200 `{results}`.
- [ ] `getTags`: `GET /api/tags/?limit=5000` → 200 `{results:[{id,name,date_added}]}`.
- [ ] `getUserProfile`: `GET /api/user/profile/` → 200 profile.
- [ ] `deleteBookmark`: `DELETE /api/bookmarks/<id>/` → 204.
- [ ] Auth: `Token` and `Bearer` both work; missing → 401.
- [ ] All assertions verify EXACT field names and types (booleans, arrays, ISO timestamps).

**Files:**
- Create: `test/extension-contract.test.ts`

#### Test Cases to Cover
- The full sequence above as one ordered scenario (the extension relies on upsert-after-check).
- Pagination shape `{count,next,previous,results}` for list + tags.
- 404/400 error codes match linkding (404 on missing get, 400 on duplicate-url PUT).

#### Layer Guidance
- Run via `@cloudflare/vitest-pool-workers` against an isolated D1 with a seeded API token + profile.
- This is the acceptance gate for API compatibility — it must be green before review.

#### Validation
```bash
npm run build && npm test && npm run lint
```

---

## Plan Coverage Checklist

- [x] Every approved requirement maps to at least one task —
  - Extension API compat → T2,T3,T4,T5,T6,T8,T13
  - Full Web UI → T9,T10
  - Server-side scraping → T6
  - Wayback URL archiving → T4
  - Auto-tagging → T6
  - Bundles → T8
  - Netscape import/export → T11
  - RSS feeds → T12
  - PWA/opensearch/custom_css → T12
- [x] Every task has clear acceptance criteria
- [x] Every task lists behavior-focused test cases
- [x] Every task lists exact Create/Modify file paths
- [x] New or modified API endpoints have E2E test task(s) — T13 covers all extension-facing endpoints
- [x] The dependency graph has no cycles (T1→T2,T3→T4→T5→T6→T7→T8; T5→T9→T10/T11/T12; T6,T8→T13)
- [x] Parallelizable tasks do not modify the same files — T6/T7/T8 serialized (shared `bookmarks.ts`); Web UI branch (T9+) lives under `src/web/` and is parallel with T6/T7/T8
- [x] No task is purely horizontal unless unavoidable infrastructure — T1 is scaffolding (unavoidable) but includes a vertical `/health` slice + working test harness
- [x] Known assumptions or deviations documented —
  - API tokens stored as plaintext key (single-user parity with linkding); shown once on creation.
  - Favicons/preview images stored as external URLs (no R2).
  - Auto-tagging wired into create/update via an injectable hook (T5 defines, T6 supplies).
  - Validation uses TS commands (`npm run build && npm test && npm run lint`) in place of go build/test/vet.
