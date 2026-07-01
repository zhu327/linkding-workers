/**
 * Boolean search expression parser — port of linkding's search_query_parser.py.
 * Tokenizer → recursive-descent parser → AST → D1 SQL compiler.
 */

// AST types
export type SearchExpression =
  | { type: "term"; term: string }
  | { type: "tag"; tag: string }
  | { type: "keyword"; keyword: string }
  | { type: "and"; left: SearchExpression; right: SearchExpression }
  | { type: "or"; left: SearchExpression; right: SearchExpression }
  | { type: "not"; operand: SearchExpression };

// Tokenizer
type TokenType = "TERM" | "TAG" | "SPECIAL_KEYWORD" | "AND" | "OR" | "NOT" | "LPAREN" | "RPAREN" | "EOF";
interface Token { type: TokenType; value: string; }

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    if (/\s/.test(query[i])) { i++; continue; }
    if (query[i] === "(") { tokens.push({ type: "LPAREN", value: "(" }); i++; continue; }
    if (query[i] === ")") { tokens.push({ type: "RPAREN", value: ")" }); i++; continue; }
    if (query[i] === "#") {
      i++;
      let tag = "";
      while (i < query.length && !/[\s()]/.test(query[i])) { tag += query[i]; i++; }
      if (tag) tokens.push({ type: "TAG", value: tag });
      continue;
    }
    if (query[i] === "!") {
      i++;
      let keyword = "";
      while (i < query.length && !/[\s()]/.test(query[i])) { keyword += query[i]; i++; }
      if (keyword) tokens.push({ type: "SPECIAL_KEYWORD", value: keyword });
      continue;
    }
    if (query[i] === '"' || query[i] === "'") {
      const q = query[i]; i++;
      let term = "";
      while (i < query.length && query[i] !== q) {
        if (query[i] === "\\" && i + 1 < query.length) { i++; term += query[i]; }
        else term += query[i];
        i++;
      }
      if (i < query.length) i++; // skip closing quote
      tokens.push({ type: "TERM", value: term });
      continue;
    }
    // Read a word
    let word = "";
    while (i < query.length && !/[\s()]/.test(query[i])) { word += query[i]; i++; }
    const lower = word.toLowerCase();
    if (lower === "and") tokens.push({ type: "AND", value: word });
    else if (lower === "or") tokens.push({ type: "OR", value: word });
    else if (lower === "not") tokens.push({ type: "NOT", value: word });
    else tokens.push({ type: "TERM", value: word });
  }
  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

// Parser
class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}
  private peek(): Token { return this.tokens[this.pos]; }
  private advance(): Token { return this.tokens[this.pos++]; }
  private expect(type: TokenType): Token {
    const t = this.advance();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`);
    return t;
  }

  parse(): SearchExpression | null {
    if (this.peek().type === "EOF") return null;
    const expr = this.parseOr();
    if (this.peek().type !== "EOF") throw new Error(`Unexpected token: ${this.peek().value}`);
    return expr;
  }

  private parseOr(): SearchExpression {
    let left = this.parseAnd();
    while (this.peek().type === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  private parseAnd(): SearchExpression {
    let left = this.parseNot();
    while (
      this.peek().type === "AND" ||
      this.peek().type === "TERM" ||
      this.peek().type === "TAG" ||
      this.peek().type === "SPECIAL_KEYWORD" ||
      this.peek().type === "LPAREN" ||
      this.peek().type === "NOT"
    ) {
      if (this.peek().type === "AND") this.advance();
      const right = this.parseNot();
      left = { type: "and", left, right };
    }
    return left;
  }

  private parseNot(): SearchExpression {
    if (this.peek().type === "NOT") {
      this.advance();
      return { type: "not", operand: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SearchExpression {
    const t = this.peek();
    if (t.type === "TERM") { this.advance(); return { type: "term", term: t.value }; }
    if (t.type === "TAG") { this.advance(); return { type: "tag", tag: t.value }; }
    if (t.type === "SPECIAL_KEYWORD") { this.advance(); return { type: "keyword", keyword: t.value }; }
    if (t.type === "LPAREN") {
      this.advance();
      const expr = this.parseOr();
      this.expect("RPAREN");
      return expr;
    }
    throw new Error(`Unexpected token: ${t.value} (${t.type})`);
  }
}

export function parseSearchQuery(query: string): SearchExpression | null {
  if (!query || !query.trim()) return null;
  return new Parser(tokenize(query)).parse();
}

/**
 * Convert AST back to a query string (for display/round-trip).
 */
export function expressionToString(expr: SearchExpression | null): string {
  if (!expr) return "";
  switch (expr.type) {
    case "term": return expr.term.includes(" ") ? `"${expr.term.replace(/"/g, '\\"')}"` : expr.term;
    case "tag": return `#${expr.tag}`;
    case "keyword": return `!${expr.keyword}`;
    case "and": {
      const left = expressionToString(expr.left);
      const right = expressionToString(expr.right);
      return `${left} ${right}`;
    }
    case "or": return `${expressionToString(expr.left)} or ${expressionToString(expr.right)}`;
    case "not": return `not ${expressionToString(expr.operand)}`;
  }
}

/**
 * Extract tag names from a query string.
 * In lax mode, bare terms are also treated as tag names.
 * Returns deduplicated, case-insensitive, sorted list.
 */
export function extractTagNamesFromQuery(query: string, lax: boolean): string[] {
  const tokens = tokenize(query);
  const tags = new Set<string>();
  for (const t of tokens) {
    if (t.type === "TAG") tags.add(t.value.toLowerCase());
    else if (lax && t.type === "TERM") tags.add(t.value.toLowerCase());
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

// SQL compiler
export interface CompiledSearch { whereSql: string; params: unknown[]; }

export function compileSearch(ast: SearchExpression | null, opts?: { lax?: boolean }): CompiledSearch | null {
  if (!ast) return null;
  const params: unknown[] = [];
  const lax = opts?.lax ?? false;

  const termLike = (term: string): string => {
    const p = `%${term.toLowerCase()}%`;
    if (lax) {
      params.push(p, p, p, p, term.toLowerCase());
      return "(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(url) LIKE ? OR EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = bookmarks.id AND LOWER(t.name) = ?))";
    } else {
      params.push(p, p, p, p);
      return "(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(url) LIKE ?)";
    }
  };

  const compile = (expr: SearchExpression): string => {
    switch (expr.type) {
      case "term": return termLike(expr.term);
      case "tag": {
        params.push(expr.tag.toLowerCase());
        return "EXISTS (SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = bookmarks.id AND LOWER(t.name) = ?)";
      }
      case "keyword": {
        const kw = expr.keyword.toLowerCase();
        if (kw === "untagged") return "NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = bookmarks.id)";
        if (kw === "unread") return "unread = 1";
        return "1=1"; // unknown special keyword matches all
      }
      case "and": return `(${compile(expr.left)} AND ${compile(expr.right)})`;
      case "or": return `(${compile(expr.left)} OR ${compile(expr.right)})`;
      case "not": return `NOT (${compile(expr.operand)})`;
    }
  };

  return { whereSql: compile(ast), params };
}

/**
 * Build a legacy simple search: AND of all terms across all text fields.
 * Each term is matched independently with LIKE.
 */
export function compileLegacySearch(query: string): CompiledSearch | null {
  if (!query || !query.trim()) return null;
  const keywords = query.trim().split(/\s+/).filter(Boolean);

  const params: unknown[] = [];
  const conditions: string[] = [];

  for (const keyword of keywords) {
    if (keyword === "!untagged") {
      conditions.push("NOT EXISTS (SELECT 1 FROM bookmark_tags bt WHERE bt.bookmark_id = bookmarks.id)");
    } else if (keyword === "!unread") {
      conditions.push("unread = 1");
    } else if (keyword[0] === "!") {
      // Unknown special keyword — ignored in legacy mode
      continue;
    } else {
      const p = `%${keyword.toLowerCase()}%`;
      params.push(p, p, p, p);
      conditions.push("(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(notes) LIKE ? OR LOWER(url) LIKE ?)");
    }
  }

  if (conditions.length === 0) return null;
  return { whereSql: conditions.join(" AND "), params };
}
