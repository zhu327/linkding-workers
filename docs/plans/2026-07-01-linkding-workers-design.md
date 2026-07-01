# linkding-workers — Design Document

**Date:** 2026-07-01
**Status:** Approved (GO-1)
**Goal:** Rewrite linkding as a single-user bookmark app deployable on Cloudflare Workers + D1, TypeScript, fully compatible with the official linkding browser extension.

## 1. Context & Constraints

- **Source project:** linkding v1.45.0 — Django + DRF + SQLite, multi-user, filesystem-based assets, headless-Chromium snapshots.
- **Target:** Cloudflare Workers (compute) + D1 (SQLite storage). TypeScript. Single user.
- **Hard requirement:** Compatible with the official linkding browser extension (Firefox/Chrome). The extension must be configurable against this server and function identically (add/edit/delete/search/check).
- **Scope decisions (confirmed by user):**
  - Full Web UI (browse/search/edit/settings).
  - Server-side metadata scraping on `/check` (Workers `fetch`) coexists with browser-metadata path.
  - Archiving = Wayback URL generation only (no local snapshots, no headless browser).
  - Keep: auto-tagging rules, Bundles (saved searches), Netscape HTML import/export, RSS/Atom feeds.
  - Drop: multi-user, SSO/OIDC, auth proxy, admin panel, local HTML snapshots, background task processor.

## 2. Architecture

```
linkding-workers/
├── src/
│   ├── index.ts              # Hono app entry, route registration
│   ├── env.ts                # Env bindings (D1, secrets) types
│   ├── db/
│   │   ├── schema.sql        # D1 schema
│   │   ├── migrations/       # numbered SQL migrations
│   │   └── repository.ts     # DB access layer (prepared statements)
│   ├── api/
│   │   ├── auth.ts           # Token/Bearer auth middleware
│   │   ├── bookmarks.ts      # /api/bookmarks/* routes
│   │   ├── tags.ts           # /api/tags/*
│   │   ├── bundles.ts        # /api/bundles/*
│   │   ├── user.ts           # /api/user/profile/
│   │   └── serializers.ts    # DRF-compatible response shaping
│   ├── services/
│   │   ├── scraping.ts       # website metadata fetch + parse (linkedom)
│   │   ├── auto-tagging.ts   # URL pattern -> tags
│   │   ├── search.ts         # boolean expression parser + D1 query builder
│   │   ├── wayback.ts        # Wayback URL generation
│   │   ├── netscape.ts       # import/export Netscape HTML
│   │   ├── favicon.ts        # favicon URL derivation
│   │   └── tags.ts           # tag sanitize/parse/build string
│   ├── web/                  # SSR HTML Web UI
│   │   ├── routes.ts
│   │   ├── auth.ts           # session cookie login/logout
│   │   └── views/            # HTML templates
│   └── feeds.ts              # RSS/Atom feeds
├── test/                     # vitest unit + integration (vitest-pool-workers)
├── migrations/
├── wrangler.toml
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Stack:** Hono (HTTP/router), TypeScript (strict), D1 (storage), `linkedom` (DOM parsing for scraping), Vitest + `@cloudflare/vitest-pool-workers` (testing), Wrangler (dev/deploy), ESLint + Prettier (lint). No R2, no frontend SPA framework.

## 3. Data Model (D1 schema, single-user)

Drop `owner`/multi-user fields. Single `user_profile` row. Store favicon/preview as **external URLs** (not files).

- **bookmarks**: `id` (integer pk), `url`, `url_normalized` (indexed, for dedup), `title`, `description`, `notes`, `web_archive_snapshot_url`, `favicon_url`, `preview_image_url`, `unread` (int bool), `is_archived` (int bool), `shared` (int bool), `date_added`, `date_modified`, `date_accessed` (nullable).
- **tags**: `id`, `name`, `date_added`. Unique(`name`).
- **bookmark_tags**: `bookmark_id`, `tag_id`. Composite pk. (many-to-many)
- **bundles**: `id`, `name`, `search`, `any_tags`, `all_tags`, `excluded_tags`, `filter_unread`, `filter_shared`, `order`, `date_created`, `date_modified`.
- **api_tokens**: `id`, `key` (unique, indexed), `name`, `created`.
- **feed_tokens**: `key` (pk), `created`.
- **user_profile**: single row — `theme`, `bookmark_date_display`, `bookmark_link_target`, `web_archive_integration`, `tag_search`, `enable_sharing`, `enable_public_sharing`, `enable_favicons`, `display_url`, `permanent_notes`, `search_preferences` (JSON), `auto_tagging_rules` (text), `items_per_page`, etc.

### URL dedup (critical for extension compat)
On `POST /api/bookmarks/`: compute `url_normalized`, look up existing by `url_normalized` (fallback exact `url`). If found → update existing in place, return **201** with updated bookmark. Matches linkding's silent-upsert behavior the extension relies on.

## 4. API Compatibility Contract

Implement exactly the endpoints the extension calls, with DRF-compatible response shapes.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/bookmarks/?q=&limit=&offset=&modified_since=&added_since=&bundle=` | paginated list `{count,next,previous,results}` |
| GET | `/api/bookmarks/archived/` | archived list |
| GET | `/api/bookmarks/<id>/` | single bookmark |
| GET | `/api/bookmarks/check/?url=` | `{bookmark, metadata, auto_tags}` (server scrape) |
| POST | `/api/bookmarks/?disable_scraping&disable_html_snapshot` | upsert on dup URL; **201** + bookmark |
| PUT/PATCH | `/api/bookmarks/<id>/` | update; 400 on dup URL |
| POST | `/api/bookmarks/<id>/archive/` | 204 |
| POST | `/api/bookmarks/<id>/unarchive/` | 204 |
| DELETE | `/api/bookmarks/<id>/` | 204 |
| GET | `/api/tags/?limit=&offset=` | paginated `{results}` |
| POST | `/api/tags/` | create tag |
| GET/POST/PUT/PATCH/DELETE | `/api/bundles/`, `/api/bundles/<id>/` | bundle CRUD |
| GET | `/api/user/profile/` | profile JSON + `version` |

**Auth:** `Authorization: Token <token>` or `Bearer <token>` → lookup `api_tokens.key`. Returns 401 on missing/invalid.

**Bookmark response object fields (exact):** `id, url, title, description, notes, web_archive_snapshot_url, favicon_url, preview_image_url, is_archived, unread, shared, tag_names[], date_added, date_modified, website_title, website_description`. (`website_title`/`website_description` return `null` for compat, as linkding does.)

**Pagination defaults:** `limit=100`. `next`/`previous` are absolute URLs or null.

## 5. Web UI (SSR HTML)

Hono routes returning server-rendered HTML (template literals / `html` helper). light/dark themes via CSS.

- `/` → redirect to `/bookmarks`
- `/login` (GET/POST), `/logout` — password login → HMAC-signed session cookie
- `/bookmarks` — list + search box + filters (sort, unread, shared, tag) + pagination + bulk actions
- `/bookmarks/archived`, `/bookmarks/shared`
- `/bookmarks/new`, `/bookmarks/<id>/edit`
- `/tags` — list + merge
- `/bundles` — CRUD
- `/settings` — general prefs, auto-tagging rules, API token generate/delete, import, export
- `/feeds/<key>/all|unread|shared` — RSS/Atom
- `/manifest.json` (PWA), `/opensearch.xml`, `/custom_css`, `/health`

### Web auth (single user)
- Password stored as env secret `APP_PASSWORD_HASH` (verify via Web Crypto).
- Login sets `session` cookie = HMAC-signed token (secret `SESSION_SECRET`), checked by web middleware.
- API endpoints are exempt (use token auth instead).

## 6. Key Services

### Scraping (`/check` metadata)
- `fetch(url)` with browser-like headers; read body until `</head>` (cap bytes ~5MB).
- Parse with `linkedom`: `<title>`, `<meta name=description>`, `<meta property=og:description>`, `<meta property=og:image>` (resolve relative via base URL).
- Return `{url, title, description, preview_image}`.
- Optional: cache result in D1 by URL hash to avoid repeat fetches.
- `POST` save path: extension always sends `disable_scraping`, so no fetch on create (matches linkding).

### Search
- Port `search_query_parser.py` → TS: tokenize into AST of `TermExpression`, `TagExpression`, `Phrase`, `And/Or/Not`, grouping.
- Compile AST → D1 SQL with `LIKE` over (title, description, notes, url) + tag joins for `#tag`.
- `lax` tag-search mode: bare terms also match tag names.
- Legacy simple search toggle (AND of terms across fields).

### Auto-tagging
- Port `auto_tagging.py` (pure URL/host/path/query/fragment matching, no deps). `get_tags(rules, url) -> string[]`.

### Wayback
- `generate_fallback_webarchive_url(url, date_added)` → `https://web.archive.org/web/<YYYYMMDDhhmmss>/<url>` when `web_archive_integration === 'enabled'`. Pure computation.

### Netscape import/export
- Port `parser.py` (parse Netscape bookmark HTML) + `exporter.py` (generate). Preserve `linkding:bookmarks.archived` tag convention and `[linkding-notes]...[/linkding-notes]` notes round-trip.

### Favicon
- Derive `favicon_url` from URL host: `https://www.google.com/s2/favicons?domain=<host>&sz=32` (or site `/favicon.ico`). Stored on bookmark at create time. No download, no R2.

## 7. Testing Strategy

- **Unit (Vitest):** search parser (AST + SQL), auto-tagging, wayback URL, netscape parse/emit, serializers (exact field shapes), tag sanitize/parse, URL normalize.
- **Integration (`@cloudflare/vitest-pool-workers` + Miniflare D1):** full API request/response cycle per endpoint against an in-memory D1, including the **extension compatibility contract tests** — assert exact status codes (201/204/200), pagination shape, and bookmark object fields for each extension call sequence (check → save → get → list → delete).
- **Web UI:** smoke tests for route auth + render.

## 8. Validation Gates (TS equivalents)

```
npm run build   # tsc --noEmit + wrangler types
npm test        # vitest run
npm run lint    # eslint
```

All three must be green before review/simplify gates.

## 9. Out of Scope (explicit)

Multi-user, sharing-with-other-users semantics (shared flag kept but no cross-user queries), SSO/OIDC, auth proxy, Django admin, local HTML snapshots via headless Chromium, BookmarkAsset upload/download endpoints, background task processor, feeds for other users. Single API token per user is sufficient; multiple tokens supported but no per-token scoping.
