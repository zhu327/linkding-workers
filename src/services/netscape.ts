/**
 * Netscape bookmark HTML parser and exporter.
 * Port of linkding's parser.py and exporter.py.
 * Uses linkedom for robust DOM-based HTML parsing.
 */
import { parseHTML } from "linkedom";
import { normalizeUrl } from "./url.js";
import { esc } from "../utils/html.js";

export interface NetscapeBookmark {
  href: string;
  hrefNormalized: string;
  title: string;
  description: string;
  notes: string;
  dateAdded: string;
  dateModified: string;
  tagNames: string[];
  toRead: boolean;
  privateFlag: boolean;
  archived: boolean;
}

export function parseNetscape(html: string): NetscapeBookmark[] {
  const bookmarks: NetscapeBookmark[] = [];
  const { document } = parseHTML(html);

  // Find all <a> elements (each is a bookmark)
  const anchors = document.querySelectorAll("a");
  for (const anchor of anchors) {
    // linkedom preserves attribute case; try both cases
    const href = anchor.getAttribute("href") || anchor.getAttribute("HREF") || "";
    if (!href) continue;

    const title = anchor.textContent?.trim() || "";
    const addDate = anchor.getAttribute("add_date") || anchor.getAttribute("ADD_DATE") || "";
    const lastModified = anchor.getAttribute("last_modified") || anchor.getAttribute("LAST_MODIFIED") || "";
    const tags = anchor.getAttribute("tags") || anchor.getAttribute("TAGS") || "";
    const toread = (anchor.getAttribute("toread") || anchor.getAttribute("TOREAD") || "") === "1";
    const privateVal = anchor.getAttribute("private") || anchor.getAttribute("PRIVATE") || "";
    const privateFlag = privateVal !== "0";

    const tagNames = tags.split(",").map((t: string) => t.trim()).filter(Boolean);
    const archived = tagNames.includes("linkding:bookmarks.archived");
    const filteredTags = tagNames.filter((t: string) => t !== "linkding:bookmarks.archived");

    // Extract description from next sibling <dd> element
    // In Netscape bookmark HTML, <A> is inside <DT>, and <DD> is a sibling of <DT>
    let description = "";
    let notes = "";
    const dtParent = anchor.parentElement; // <DT> element
    if (dtParent) {
      const nextSibling = dtParent.nextSibling;
      if (nextSibling && nextSibling.nodeType === 1 && (nextSibling as any).tagName?.toLowerCase() === "dd") {
        const raw = (nextSibling as any).textContent?.trim() || "";
        const notesMatch = raw.match(/\[linkding-notes\]([\s\S]*?)\[\/linkding-notes\]/);
        if (notesMatch) notes = notesMatch[1];
        description = raw.replace(/\[linkding-notes\][\s\S]*?\[\/linkding-notes\]/, "").trim();
      }
    }

    bookmarks.push({
      href,
      hrefNormalized: normalizeUrl(href),
      title,
      description,
      notes,
      dateAdded: addDate ? timestampToIso(addDate) : new Date().toISOString(),
      dateModified: lastModified ? timestampToIso(lastModified) : new Date().toISOString(),
      tagNames: filteredTags,
      toRead: toread,
      privateFlag: privateFlag,
      archived,
    });
  }

  return bookmarks;
}

function timestampToIso(ts: string): string {
  const num = parseInt(ts, 10);
  if (isNaN(num)) return new Date().toISOString();
  // Try seconds, then milliseconds, then microseconds
  if (num < 1e11) return new Date(num * 1000).toISOString();
  if (num < 1e14) return new Date(num).toISOString();
  return new Date(num / 1000).toISOString();
}



export interface ExportBookmark {
  url: string;
  title: string;
  description: string;
  notes: string;
  tagNames: string[];
  isArchived: boolean;
  unread: boolean;
  shared: boolean;
  dateAdded: string;
  dateModified: string;
}

export function exportNetscapeHtml(bookmarks: ExportBookmark[]): string {
  const lines: string[] = [];
  lines.push("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
  lines.push("<TITLE>Bookmarks</TITLE>");
  lines.push("<H1>Bookmarks</H1>");
  lines.push("<DL><p>");

  for (const bm of bookmarks) {
    let tags = [...bm.tagNames];
    if (bm.isArchived) tags.push("linkding:bookmarks.archived");
    const tagStr = tags.map(esc).join(",");
    const toread = bm.unread ? "1" : "0";
    const privateVal = bm.shared ? "0" : "1";
    const added = Math.floor(new Date(bm.dateAdded).getTime() / 1000);
    const modified = Math.floor(new Date(bm.dateModified).getTime() / 1000);

    let desc = esc(bm.description);
    if (bm.notes) desc += `[linkding-notes]${esc(bm.notes)}[/linkding-notes]`;

    lines.push(`<DT><A HREF="${esc(bm.url)}" ADD_DATE="${added}" LAST_MODIFIED="${modified}" PRIVATE="${privateVal}" TOREAD="${toread}" TAGS="${tagStr}">${esc(bm.title || bm.url)}</A>`);
    if (desc) lines.push(`<DD>${desc}`);
  }

  lines.push("</DL><p>");
  return lines.join("\r\n");
}
