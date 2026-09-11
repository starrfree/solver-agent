/**
 * Minimal Python tokenizer producing LaTeX for an `fvextra` Verbatim block
 * with `commandchars=\\\{\}`. `listings` cannot cope with non-Latin-1 text
 * under pdfLaTeX and `minted` needs shell escape, so a hand-rolled highlighter
 * that only relies on `xcolor` keeps `report.tex` compilable everywhere.
 *
 * Inside such a Verbatim block, `\`, `{` and `}` are the only special
 * characters; every other byte is reproduced literally.
 */

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
  "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return",
  "try", "while", "with", "yield", "match", "case",
]);

const BUILTINS = new Set([
  "abs", "all", "any", "bool", "dict", "enumerate", "float", "int", "isinstance", "len",
  "list", "map", "max", "min", "open", "print", "range", "round", "set", "sorted", "str",
  "sum", "tuple", "type", "zip", "super", "self", "cls",
]);

const TOKEN_RE =
  /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*|@[A-Za-z_][\w.]*|\b\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?[jJ]?\b|\b[A-Za-z_]\w*\b|\n|[^\n])/g;

/** Escape a run of text for a Verbatim block with `commandchars=\\\{\}`. */
export function escapeForCommandVerbatim(text: string): string {
  return text
    .replace(/\\/g, "\u0000")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\u0000/g, "\\textbackslash{}");
}

function wrap(macro: string, text: string): string {
  // A macro argument cannot span Verbatim lines: wrap each line separately.
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `\\${macro}{${escapeForCommandVerbatim(line)}}` : ""))
    .join("\n");
}

/**
 * Highlight Python source. Output macros: `\PYk` keyword, `\PYb` builtin,
 * `\PYs` string, `\PYc` comment, `\PYn` number, `\PYd` decorator, `\PYf`
 * function/class name after `def` / `class`.
 */
export function highlightPython(source: string): string {
  const out: string[] = [];
  let previousWord: string | null = null;
  for (const m of source.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const first = tok[0];
    if (tok.startsWith('"') || tok.startsWith("'")) {
      out.push(wrap("PYs", tok));
    } else if (first === "#") {
      out.push(wrap("PYc", tok));
    } else if (first === "@") {
      out.push(wrap("PYd", tok));
    } else if (/^\d/.test(tok)) {
      out.push(wrap("PYn", tok));
    } else if (/^[A-Za-z_]/.test(tok)) {
      if (KEYWORDS.has(tok)) out.push(wrap("PYk", tok));
      else if (previousWord === "def" || previousWord === "class") out.push(wrap("PYf", tok));
      else if (BUILTINS.has(tok)) out.push(wrap("PYb", tok));
      else out.push(escapeForCommandVerbatim(tok));
    } else {
      out.push(escapeForCommandVerbatim(tok));
    }
    if (tok === "\n") previousWord = null;
    else if (/^[A-Za-z_]/.test(tok)) previousWord = tok;
  }
  return out.join("");
}
