/**
 * Atom feed builder.
 */
import type { BookmarkRow } from "../db/schema.js";
import { escXml } from "../utils/html.js";

export function buildAtomFeed(bookmarks: BookmarkRow[], opts: { title: string; selfUrl: string; siteUrl: string }): string {
  const entries = bookmarks.map((b) => {
    const title = b.title || b.url;
    return `  <entry>
    <title>${escXml(title)}</title>
    <link href="${escXml(b.url)}" rel="alternate"/>
    <id>${escXml(b.url)}</id>
    <updated>${b.date_modified || b.date_added}</updated>
    ${b.description ? `<summary>${escXml(b.description)}</summary>` : ""}
  </entry>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escXml(opts.title)}</title>
  <link href="${escXml(opts.selfUrl)}" rel="self"/>
  <link href="${escXml(opts.siteUrl)}" rel="alternate"/>
  <id>${escXml(opts.siteUrl)}</id>
  <updated>${bookmarks[0]?.date_modified || new Date().toISOString()}</updated>
${entries}
</feed>`;
}


