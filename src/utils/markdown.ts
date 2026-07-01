import { esc } from "./html.js";

/**
 * Converts Markdown text to safe HTML.
 * Supports: **bold**, *italic*, `inline code`, ```code blocks```,
 * [links](url), - unordered lists, 1. ordered lists, paragraphs.
 * All output HTML is escaped. No raw HTML allowed.
 */
export function renderMarkdown(text: string): string {
  if (!text || !text.trim()) return "";

  const escaped = esc(text);
  const lines = escaped.split("\n");

  let result = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Fenced code block ---
    if (line.startsWith("```")) {
      let code = "";
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code += lines[i] + "\n";
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      result += `<pre><code>${code}</code></pre>`;
      continue;
    }

    // --- Unordered list ---
    if (/^[-*]\s+/.test(line)) {
      let items = "";
      while (i < lines.length && /^[-*]\s+(.*)/.test(lines[i])) {
        const m = lines[i].match(/^[-*]\s+(.*)/)!;
        items += `<li>${processInline(m[1])}</li>`;
        i++;
      }
      result += `<ul>${items}</ul>`;
      continue;
    }

    // --- Ordered list ---
    if (/^\d+\.\s+/.test(line)) {
      let items = "";
      while (i < lines.length && /^\d+\.\s+(.*)/.test(lines[i])) {
        const m = lines[i].match(/^\d+\.\s+(.*)/)!;
        items += `<li>${processInline(m[1])}</li>`;
        i++;
      }
      result += `<ol>${items}</ol>`;
      continue;
    }

    // --- Blank line ---
    if (line.trim() === "") {
      i++;
      continue;
    }

    // --- Paragraph: collect consecutive non-special lines ---
    let para = "";
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      if (para) para += "\n";
      para += lines[i];
      i++;
    }
    if (para) {
      result += `<p>${processInline(para)}</p>`;
    }
  }

  return result;
}

function isSafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

function processInline(text: string): string {
  // 1. Inline code — protect content from further processing
  text = text.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

  // 2. Bold
  text = text.replace(/\*\*(.+?)\*\*/g, (_m, inner) => `<strong>${inner}</strong>`);

  // 3. Italic (single *, not preceded/followed by *)
  text = text.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_m, pre, inner) => `${pre}<em>${inner}</em>`);

  // 4. Links — validate URL scheme
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    // URL was escaped by esc() — decode &amp; back to & for scheme validation
    const decodedUrl = url.replace(/&amp;/g, "&");
    if (!isSafeUrl(decodedUrl)) return match; // leave as-is if unsafe
    return `<a href="${url}">${linkText}</a>`;
  });

  return text;
}
