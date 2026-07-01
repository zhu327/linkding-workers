# linkding-workers

A self-hosted bookmark manager built on **Cloudflare Workers + D1**, fully compatible with the official [linkding](https://github.com/sissbruecker/linkding) browser extension.

Lightweight, fast, and cheap to run — no VPS needed.

## Features

- 🔗 **Bookmark management** — add, edit, delete, archive, tag, and search bookmarks
- 🧩 **linkding extension compatible** — works with the official Firefox/Chrome extension (check, save, edit, delete, search)
- 🔍 **Powerful search** — boolean expressions, tag filters, phrase search (`"exact match"`), exclusion (`-term`), and tag syntax (`#tag`)
- 🏷️ **Auto-tagging** — define URL pattern rules to automatically tag new bookmarks
- 📦 **Bundles** — saved searches with tag filters for quick access
- 📄 **Netscape HTML import/export** — migrate bookmarks from browsers or other linkding instances
- 📡 **RSS/Atom feeds** — subscribe to your bookmarks, unread items, or shared items
- 🌐 **Web UI** — server-rendered HTML with light/dark theme support, no SPA framework
- 🗄️ **Wayback Machine integration** — generate archive.org snapshot URLs
- 🖼️ **Favicon support** — automatic favicon URL derivation via Google's favicon service
- 📱 **PWA ready** — manifest and icons included

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Framework | [Hono](https://hono.dev/) |
| Language | TypeScript (strict) |
| HTML parsing | [linkedom](https://github.com/WebReflection/linkedom) |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` |
| Tooling | Wrangler, ESLint, Prettier |

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Cloudflare account](https://dash.cloudflare.com/) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed globally

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/<your-username>/linkding-workers.git
cd linkding-workers
npm install
```

### 2. Configure

Edit `wrangler.toml` with your D1 database binding:

```toml
name = "linkding-workers"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[[d1_databases]]
binding = "DB"
database_name = "linkding-workers"
database_id = "<your-d1-database-id>"

[vars]
SESSION_SECRET = "<a-random-secret-string>"
APP_PASSWORD_HASH = "<sha256-hash-of-your-password>"
```

To generate the password hash:

```bash
echo -n "your-password" | sha256sum
```

### 3. Create the D1 database

```bash
npx wrangler d1 create linkding-workers
# Copy the database_id into wrangler.toml
npx wrangler d1 execute linkding-workers --remote --file=migrations/0001_init.sql
npx wrangler d1 execute linkding-workers --remote --file=migrations/0002_defaults.sql
```

### 4. Insert your user profile

```bash
npx wrangler d1 execute linkding-workers --remote --command="INSERT INTO user_profile (id) VALUES (1);"
```

### 5. Deploy

```bash
npx wrangler deploy
```

Your app is now live at `https://linkding-workers.<your-subdomain>.workers.dev`.

## Local Development

```bash
# Start local dev server with Miniflare (simulates Workers + D1)
npm run dev

# Run tests
npm test

# Type check
npm run build

# Lint
npm run lint
```

## Configuration

All configuration is done via environment variables in `wrangler.toml` (or Cloudflare dashboard secrets):

| Variable | Required | Description |
|----------|----------|-------------|
| `SESSION_SECRET` | ✅ | Secret key for HMAC-signed session cookies |
| `APP_PASSWORD_HASH` | ✅ | SHA-256 hash of your login password |

## Usage

### Web UI

Navigate to your deployed URL and log in with your password. The web UI provides:

- Bookmark browsing, search, and filtering
- Bookmark creation and editing
- Tag management (including tag merging)
- Bundle (saved search) management
- Settings panel for preferences, auto-tagging rules, and API tokens
- Netscape HTML import/export
- RSS/Atom feed URLs

### Browser Extension

1. Install the [linkding browser extension](https://github.com/sissbruecker/linkding#browser-extension)
2. In extension settings, set:
   - **URL**: your deployed Workers URL (e.g. `https://linkding-workers.<your-subdomain>.workers.dev`)
   - **API Token**: generate one from the Web UI Settings page

The extension supports: checking if a URL is bookmarked, saving new bookmarks, editing, deleting, and searching — all compatible with this server.

### API

The REST API follows the linkding API contract. Authentication via `Authorization: Token <your-token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookmarks/` | List bookmarks (supports `q`, `limit`, `offset`, `modified_since`, `added_since`, `bundle`) |
| GET | `/api/bookmarks/archived/` | List archived bookmarks |
| GET | `/api/bookmarks/:id/` | Get a single bookmark |
| GET | `/api/bookmarks/check/?url=` | Check if URL is bookmarked + fetch metadata |
| POST | `/api/bookmarks/` | Create bookmark (upserts on duplicate URL) |
| PUT/PATCH | `/api/bookmarks/:id/` | Update bookmark |
| POST | `/api/bookmarks/:id/archive/` | Archive bookmark |
| POST | `/api/bookmarks/:id/unarchive/` | Unarchive bookmark |
| DELETE | `/api/bookmarks/:id/` | Delete bookmark |
| GET | `/api/tags/` | List tags |
| POST | `/api/tags/` | Create tag |
| GET/POST/PUT/PATCH/DELETE | `/api/bundles/` | Bundle CRUD |
| GET | `/api/user/profile/` | User profile |

## Project Structure

```
linkding-workers/
├── src/
│   ├── index.ts              # Hono app entry, route registration
│   ├── env.ts                # Environment bindings types
│   ├── db/                   # Database schema, migrations, repository
│   ├── api/                  # REST API routes (bookmarks, tags, bundles, user, auth)
│   ├── services/             # Business logic (scraping, search, auto-tagging, feeds, etc.)
│   ├── web/                  # Server-rendered Web UI (routes, views, auth, CSRF)
│   ├── utils/                # HTML and Markdown utilities
│   └── health.ts             # Health check endpoint
├── test/                     # Vitest unit + integration tests
├── migrations/               # D1 SQL migration files
├── public/                   # Static assets (favicons, PWA icons)
├── wrangler.toml             # Cloudflare Workers configuration
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Differences from linkding

This project is a ground-up rewrite of [linkding](https://github.com/sissbruecker/linkding) for the Cloudflare edge. Key differences:

| | linkding | linkding-workers |
|---|---------|-----------------|
| Runtime | Python / Django | TypeScript / Hono |
| Database | SQLite / PostgreSQL | Cloudflare D1 (SQLite) |
| Hosting | VPS / Docker | Cloudflare Workers (serverless) |
| Users | Multi-user + SSO | Single-user (password auth) |
| Snapshots | Headless Chromium | Wayback Machine URLs only |
| Frontend | Django templates + HTMX | Server-rendered HTML (Hono) |

## Limitations

- **Single user only** — no multi-user, SSO, or sharing between users
- **No local HTML snapshots** — uses Wayback Machine URLs instead
- **No background task processor** — all operations are synchronous within the request

## License

[MIT](LICENSE)
