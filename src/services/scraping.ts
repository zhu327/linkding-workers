/**
 * Website metadata scraping — port of linkding's website_loader.
 * Splits into fetchHead (network) and parseMetadata (pure) for testability.
 * Uses linkedom for robust DOM-based HTML parsing.
 */
import { parseHTML } from "linkedom";

export interface WebsiteMetadata {
  url: string;
  title: string | null;
  description: string | null;
  preview_image: string | null;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.0.0 Safari/537.36";

export async function fetchHead(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    // Read only up to </head> to minimize data
    const reader = response.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let html = "";
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB cap

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/</.test(html) && html.toLowerCase().includes("</head>")) {
        const idx = html.toLowerCase().indexOf("</head>");
        html = html.slice(0, idx + "</head>".length);
        break;
      }
      if (html.length > MAX_BYTES) {
        html = html.slice(0, MAX_BYTES);
        break;
      }
    }
    reader.cancel();
    return html;
  } catch {
    return null;
  }
}

export function parseMetadata(html: string, baseUrl: string): WebsiteMetadata {
  let title: string | null = null;
  let description: string | null = null;
  let previewImage: string | null = null;

  try {
    const { document } = parseHTML(html);

    // Extract <title>
    const titleEl = document.querySelector("title");
    if (titleEl) {
      title = titleEl.textContent?.trim() || null;
    }

    // Extract <meta name="description">
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) {
      description = descMeta.getAttribute("content")?.trim() || null;
    }

    // Fallback to og:description
    if (!description) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) {
        description = ogDesc.getAttribute("content")?.trim() || null;
      }
    }

    // Extract <meta property="og:image">
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) {
      const raw = ogImage.getAttribute("content")?.trim();
      if (raw) {
        try {
          previewImage = new URL(raw, baseUrl).toString();
        } catch {
          previewImage = null;
        }
      }
    }
  } catch {
    // Return nulls on parse failure
  }

  return { url: baseUrl, title, description, preview_image: previewImage };
}

export async function loadWebsiteMetadata(url: string): Promise<WebsiteMetadata> {
  const empty: WebsiteMetadata = { url, title: null, description: null, preview_image: null };
  try {
    const html = await fetchHead(url);
    if (!html) return empty;
    return parseMetadata(html, url);
  } catch {
    return empty;
  }
}
