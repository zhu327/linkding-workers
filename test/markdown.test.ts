import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/utils/markdown.js";

describe("renderMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(renderMarkdown("   \n  \n  ")).toBe("");
  });

  // --- Inline formatting ---

  it("renders **bold** text", () => {
    expect(renderMarkdown("**bold**")).toBe("<p><strong>bold</strong></p>");
  });

  it("renders *italic* text", () => {
    expect(renderMarkdown("*italic*")).toBe("<p><em>italic</em></p>");
  });

  it("renders `inline code`", () => {
    expect(renderMarkdown("`code`")).toBe("<p><code>code</code></p>");
  });

  it("renders mixed inline: bold, italic, and link", () => {
    expect(renderMarkdown("**bold** and *italic* and [link](https://x.com)")).toBe(
      '<p><strong>bold</strong> and <em>italic</em> and <a href="https://x.com">link</a></p>',
    );
  });

  // --- Links ---

  it("renders [text](url) as an anchor tag", () => {
    expect(renderMarkdown("[text](https://example.com)")).toBe(
      '<p><a href="https://example.com">text</a></p>',
    );
  });

  it("rejects javascript: URLs in links", () => {
    const result = renderMarkdown("[click](javascript:alert(1))");
    // Must not create an anchor with javascript: href
    expect(result).not.toMatch(/<a\s/);
    expect(result).not.toMatch(/href="javascript:/);
    // Text content should still be present
    expect(result).toContain("click");
  });

  it("allows http: URLs in links", () => {
    expect(renderMarkdown("[text](http://example.com)")).toBe(
      '<p><a href="http://example.com">text</a></p>',
    );
  });

  // --- Lists ---

  it("renders unordered lists", () => {
    expect(renderMarkdown("- item1\n- item2")).toBe("<ul><li>item1</li><li>item2</li></ul>");
  });

  it("renders ordered lists", () => {
    expect(renderMarkdown("1. item1\n2. item2")).toBe("<ol><li>item1</li><li>item2</li></ol>");
  });

  it("renders unordered list with * marker", () => {
    expect(renderMarkdown("* item1\n* item2")).toBe("<ul><li>item1</li><li>item2</li></ul>");
  });

  // --- Fenced code blocks ---

  it("renders fenced code blocks", () => {
    const input = "```\nconsole.log('hi')\n```";
    expect(renderMarkdown(input)).toBe(
      "<pre><code>console.log(&#39;hi&#39;)\n</code></pre>",
    );
  });

  it("renders fenced code blocks with language hint (ignored)", () => {
    const input = "```js\nconst x = 1;\n```";
    expect(renderMarkdown(input)).toBe("<pre><code>const x = 1;\n</code></pre>");
  });

  it("handles unclosed fenced code block without crashing", () => {
    const input = "```\nsome code";
    const result = renderMarkdown(input);
    // Should not crash; treat as code block that extends to end
    expect(result).toContain("<pre><code>");
    expect(result).toContain("some code");
  });

  // --- Paragraphs ---

  it("wraps plain text in <p> tags", () => {
    expect(renderMarkdown("hello world")).toBe("<p>hello world</p>");
  });

  it("separates paragraphs by blank lines", () => {
    expect(renderMarkdown("para one\n\npara two")).toBe("<p>para one</p><p>para two</p>");
  });

  // --- HTML escaping / XSS prevention ---

  it("escapes <script> tags", () => {
    const result = renderMarkdown("<script>alert(1)</script>");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes all HTML special characters", () => {
    const result = renderMarkdown(`<b>bold</b> & "quotes" 'apos'`);
    expect(result).not.toContain("<b>");
    expect(result).toContain("&lt;b&gt;");
    expect(result).toContain("&amp;");
    expect(result).toContain("&quot;");
    expect(result).toContain("&#39;");
  });

  it("escapes HTML inside bold/italic", () => {
    const result = renderMarkdown("**<img onerror=alert(1)>**");
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
  });

  it("escapes HTML inside link text", () => {
    const result = renderMarkdown("[<b>xss</b>](https://example.com)");
    expect(result).not.toContain("<b>");
    expect(result).toContain("&lt;b&gt;");
  });

  it("escapes HTML inside code blocks", () => {
    const result = renderMarkdown("```\n<script>alert(1)</script>\n```");
    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("escapes HTML inside list items", () => {
    const result = renderMarkdown("- <img src=x onerror=alert(1)>");
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;img");
  });

  // --- Malformed input ---

  it("handles unclosed bold gracefully", () => {
    const result = renderMarkdown("**unclosed bold");
    // Should not crash; treat the ** as literal or render best-effort
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("handles unclosed italic gracefully", () => {
    const result = renderMarkdown("*unclosed italic");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("handles unclosed inline code gracefully", () => {
    const result = renderMarkdown("`unclosed code");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("handles unclosed link gracefully", () => {
    const result = renderMarkdown("[text](unclosed");
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });
});
