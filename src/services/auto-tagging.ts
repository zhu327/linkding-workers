/**
 * Auto-tagging — port of linkding's auto_tagging.py.
 * Rules format: one per line, "<url-pattern> <tag1> <tag2> ...".
 * Pattern matches host, path prefix, query params, fragment prefix.
 */

export function getTags(script: string, url: string): string[] {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.toLowerCase());
  } catch {
    return [];
  }
  if (!parsedUrl.hostname) return [];

  const result = new Set<string>();

  for (let line of script.toLowerCase().split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    // Remove trailing comment
    const commentIdx = line.search(/\s+#/);
    if (commentIdx >= 0) line = line.slice(0, commentIdx);

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    // Parse pattern URL (add scheme if missing)
    let patternStr = parts[0];
    if (!patternStr.startsWith("http://") && !patternStr.startsWith("https://")) {
      patternStr = "https://" + patternStr.replace(/^https?:\/\//, "");
    }

    let pattern: URL;
    try {
      pattern = new URL(patternStr);
    } catch {
      continue;
    }

    if (!domainMatches(pattern.hostname, parsedUrl.hostname)) continue;
    if (pattern.pathname && pattern.pathname !== "/" && !parsedUrl.pathname.startsWith(pattern.pathname)) continue;
    if (pattern.search && !queryMatches(pattern.search, parsedUrl.search)) continue;
    if (pattern.hash && !parsedUrl.hash.startsWith(pattern.hash)) continue;

    for (let i = 1; i < parts.length; i++) {
      result.add(parts[i]);
    }
  }

  return [...result];
}

function domainMatches(expected: string, actual: string): boolean {
  return actual === expected || actual.endsWith("." + expected);
}

function queryMatches(expectedQs: string, actualQs: string): boolean {
  const expected = new URLSearchParams(expectedQs);
  const actual = new URLSearchParams(actualQs);
  for (const [key, value] of expected.entries()) {
    if (!actual.has(key)) return false;
    if (value && actual.getAll(key).indexOf(value) === -1) return false;
  }
  return true;
}
