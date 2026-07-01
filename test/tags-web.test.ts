/// <reference types="@cloudflare/workers-types" />
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { parseHTML } from "linkedom";
import { app } from "../src/index.js";
import { createSession } from "../src/web/auth.js";
import { setupTestDb } from "./helpers/migrations.js";

// Create a session signed with the test env's actual SESSION_SECRET so that
// webAuth accepts it. (The wrangler.toml [vars] value is used at runtime.)
async function authSession(): Promise<string> {
  return createSession({ SESSION_SECRET: env.SESSION_SECRET } as any);
}

async function webReq(
  path: string,
  opts: { method?: string; session?: string; body?: FormData; redirect?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.session) headers["Cookie"] = `ld_session=${opts.session}`;
  const request = new Request(`http://localhost${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body as any,
    redirect: (opts.redirect as any) || "manual",
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** Names of tags in the table, in displayed order. */
function tagRowNames(html: string): string[] {
  const { document } = parseHTML(html);
  const names: string[] = [];
  for (const tr of document.querySelectorAll("table.crud-table tbody tr")) {
    const td = tr.querySelector("td");
    names.push((td?.textContent || "").trim());
  }
  return names;
}

/** The bookmark-count cell text for a given tag row. */
function tagCountCell(html: string, name: string): string {
  const { document } = parseHTML(html);
  for (const tr of document.querySelectorAll("table.crud-table tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if ((tds[0]?.textContent || "").trim() === name) return (tds[1]?.textContent || "").trim();
  }
  return "";
}

/** The href of the bookmark-count link for a given tag row. */
function tagCountHref(html: string, name: string): string {
  const { document } = parseHTML(html);
  for (const tr of document.querySelectorAll("table.crud-table tbody tr")) {
    const tds = tr.querySelectorAll("td");
    if ((tds[0]?.textContent || "").trim() === name) return tds[1]?.querySelector("a")?.getAttribute("href") || "";
  }
  return "";
}

async function cleanTables() {
  await env.DB.prepare("DELETE FROM bookmark_tags").run();
  await env.DB.prepare("DELETE FROM tags").run();
  await env.DB.prepare("DELETE FROM bookmarks").run();
}

async function seedTag(name: string): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO tags (name, date_added) VALUES (?, ?)").bind(name, "2024-01-01T00:00:00Z").run();
  return Number(r.meta.last_row_id);
}

async function seedBookmarkWithTags(tagIds: number[]): Promise<number> {
  const url = `https://example.com/${Math.random().toString(36).slice(2)}`;
  const r = await env.DB
    .prepare("INSERT INTO bookmarks (url, url_normalized, title, date_added, date_modified) VALUES (?, ?, ?, ?, ?)")
    .bind(url, url, "Bm", "2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z")
    .run();
  const bmId = Number(r.meta.last_row_id);
  for (const tid of tagIds) {
    await env.DB.prepare("INSERT INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)").bind(bmId, tid).run();
  }
  return bmId;
}

describe("Tags index — web route", () => {
  beforeAll(async () => {
    await setupTestDb(env.DB);
  });
  beforeEach(async () => {
    await cleanTables();
  });

  it("redirects to /login when unauthenticated", async () => {
    const res = await webReq("/tags");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("shows a bookmark count per tag with a link to filtered bookmarks", async () => {
    const python = await seedTag("python");
    const django = await seedTag("django-framework");
    await seedBookmarkWithTags([python]);
    await seedBookmarkWithTags([python, django]);

    const session = await authSession();
    const res = await webReq("/tags", { session });
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(tagCountCell(html, "python")).toBe("2");
    expect(tagCountCell(html, "django-framework")).toBe("1");
    expect(tagCountHref(html, "python")).toBe("/bookmarks?q=%23python");
    expect(tagCountHref(html, "django-framework")).toBe("/bookmarks?q=%23django-framework");
  });

  it("shows 'N tags total' when no filter is active", async () => {
    await seedTag("python");
    await seedTag("javascript");
    const session = await authSession();
    const res = await webReq("/tags", { session });
    const html = await res.text();
    expect(html).toContain("2 tags total");
  });

  it("searches tags by name (case-insensitive contains)", async () => {
    await seedTag("programming");
    await seedTag("python");
    await seedTag("django");
    await seedTag("design");

    const session = await authSession();
    const res = await webReq("/tags?search=prog", { session });
    const html = await res.text();
    expect(tagRowNames(html)).toEqual(["programming"]);
    expect(html).toContain("Showing 1 of 4 tags");
  });

  it("filters to only unused tags", async () => {
    const used = await seedTag("used");
    const unused = await seedTag("unused");
    await seedBookmarkWithTags([used]);

    const session = await authSession();
    const res = await webReq("/tags?unused=true", { session });
    const html = await res.text();
    expect(tagRowNames(html)).toEqual(["unused"]);
    expect(html).toContain("Showing 1 of 2 tags");
  });

  it("sorts by name descending", async () => {
    await seedTag("c_tag");
    await seedTag("a_tag");
    await seedTag("b_tag");

    const session = await authSession();
    const res = await webReq("/tags?sort=name-desc", { session });
    const html = await res.text();
    expect(tagRowNames(html)).toEqual(["c_tag", "b_tag", "a_tag"]);
  });

  it("sorts by bookmark count ascending", async () => {
    const none = await seedTag("no_bookmarks");
    const few = await seedTag("few_bookmarks");
    const many = await seedTag("many_bookmarks");
    await seedBookmarkWithTags([few]);
    await seedBookmarkWithTags([many]);
    await seedBookmarkWithTags([many]);
    await seedBookmarkWithTags([many]);

    const session = await authSession();
    const res = await webReq("/tags?sort=count-asc", { session });
    const html = await res.text();
    expect(tagRowNames(html)).toEqual(["no_bookmarks", "few_bookmarks", "many_bookmarks"]);
  });

  it("sorts by bookmark count descending", async () => {
    const none = await seedTag("no_bookmarks");
    const few = await seedTag("few_bookmarks");
    const many = await seedTag("many_bookmarks");
    await seedBookmarkWithTags([few]);
    await seedBookmarkWithTags([many]);
    await seedBookmarkWithTags([many]);
    await seedBookmarkWithTags([many]);

    const session = await authSession();
    const res = await webReq("/tags?sort=count-desc", { session });
    const html = await res.text();
    expect(tagRowNames(html)).toEqual(["many_bookmarks", "few_bookmarks", "no_bookmarks"]);
  });

  it("defaults to sorting by name ascending", async () => {
    await seedTag("c_tag");
    await seedTag("a_tag");
    await seedTag("b_tag");

    const session = await authSession();
    const res = await webReq("/tags", { session });
    const html = await res.text();
    expect(tagRowNames(html)).toEqual(["a_tag", "b_tag", "c_tag"]);
  });

  it("paginates at 50 tags per page", async () => {
    for (let i = 0; i < 55; i++) {
      await seedTag(`tag-${i.toString().padStart(2, "0")}`);
    }
    const session = await authSession();

    const res1 = await webReq("/tags", { session });
    const html1 = await res1.text();
    expect(tagRowNames(html1).length).toBe(50);

    const res2 = await webReq("/tags?page=2", { session });
    const html2 = await res2.text();
    expect(tagRowNames(html2).length).toBe(5);
  });

  it("falls back for invalid sort/page and clamps pages past the end", async () => {
    for (let i = 0; i < 55; i++) {
      await seedTag(`tag-${i.toString().padStart(2, "0")}`);
    }
    const session = await authSession();

    const invalid = await webReq("/tags?sort=bad&page=abc", { session });
    const invalidHtml = await invalid.text();
    expect(tagRowNames(invalidHtml)[0]).toBe("tag-00");
    expect(invalidHtml).toContain('<option value="name-asc" selected>Name A-Z</option>');

    const pastEnd = await webReq("/tags?page=99", { session });
    const pastEndHtml = await pastEnd.text();
    expect(tagRowNames(pastEndHtml).length).toBe(5);
  });

  it("delete removes the tag and preserves filter/pagination query params", async () => {
    for (let i = 0; i < 55; i++) {
      await seedTag(`tag-${i.toString().padStart(2, "0")}`);
    }
    const session = await authSession();

    // Find a tag id on page 2 to delete.
    const before = await webReq("/tags?page=2&sort=name-desc", { session });
    const beforeHtml = await before.text();
    const { document } = parseHTML(beforeHtml);
    const form = document.querySelector("table.crud-table tbody form");
    const action = form?.getAttribute("action") || "";
    const id = action.match(/\/tags\/(\d+)\/delete/)?.[1];
    expect(id).toBeTruthy();

    // Submit the delete form as-is (hidden fields carry search/sort/unused/page).
    const formData = new FormData();
    const hidden = form?.querySelectorAll("input[type=hidden]") || [];
    for (const h of hidden) {
      formData.append(h.getAttribute("name") || "", h.getAttribute("value") || "");
    }

    const res = await webReq(`/tags/${id}/delete`, { method: "POST", session, body: formData });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") || "";
    expect(loc).toContain("/tags?");
    expect(loc).toContain("sort=name-desc");
    expect(loc).toContain("page=2");

    // Tag is gone.
    const remaining = await env.DB.prepare("SELECT COUNT(*) as cnt FROM tags").first<{ cnt: number }>();
    expect(remaining?.cnt).toBe(54);
  });
});
