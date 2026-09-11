/**
 * Markdown-with-math to LaTeX.
 *
 * The models write entry bodies in Markdown with embedded LaTeX math
 * (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`, `\begin{env}...\end{env}`). We
 * first lift every math span out into a placeholder so the Markdown lexer
 * cannot mangle `_`, `*` or `\` inside it, lex the rest with `marked`, walk the
 * token tree emitting LaTeX with proper escaping of prose, and finally put the
 * math back untouched (display `$$` becomes `\[...\]`).
 */
import { Lexer, type Token, type Tokens } from "marked";

import { highlightPython } from "./highlightPython";

// Control characters that JSON decoding produces from a mangled "\b" / "\f"
// LaTeX escape (same repair as the frontend's markdown renderer).
const BACKSPACE_CHAR = "\u0008";
const FORM_FEED_CHAR = "\u000c";

// Placeholders are pure ASCII letters/digits so neither the Markdown lexer nor
// `escapeLatex` can touch them. "Q" separators keep `MATHSPAN0Z` from ever
// running into a following digit.
const PLACEHOLDER_RE = /MATHSPANQ(\d+)Z/g;
const CODE_PLACEHOLDER_RE = /CODESPANQ(\d+)Z/g;

interface MathSpan {
  latex: string;
}

/**
 * Environments that are themselves display math in LaTeX. `$$\begin{align}
 * ... \end{align}$$` is accepted by KaTeX but is an error under LaTeX, so the
 * `$$` / `\[` wrapper is dropped around these; conversely a bare
 * `\begin{aligned}` (fine for KaTeX in display mode) is wrapped in `\[...\]`.
 */
const DISPLAY_ENVS = new Set([
  "equation",
  "equation*",
  "align",
  "align*",
  "alignat",
  "alignat*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
  "displaymath",
]);

/** Blank lines inside display math are a LaTeX error ("Missing $ inserted"). */
function stripBlankLines(math: string): string {
  return math.replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, "\n");
}

function displayMath(inner: string): string {
  const body = stripBlankLines(inner.trim());
  const env = /^\\begin\{([a-zA-Z*]+)\}[\s\S]*\\end\{\1\}$/.exec(body);
  if (env && DISPLAY_ENVS.has(env[1])) return body;
  return `\\[\n${body}\n\\]`;
}

function bareEnvironment(match: string, name: string): string {
  const body = stripBlankLines(match);
  return DISPLAY_ENVS.has(name) ? body : `\\[\n${body}\n\\]`;
}

/** Escape prose for LaTeX (not to be used on math or verbatim content). */
export function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\u0000BS\u0000")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/\u0000BS\u0000/g, "\\textbackslash{}")
    .replace(/[<>]/g, (c) => (c === "<" ? "\\textless{}" : "\\textgreater{}"))
    .replace(/\|/g, "\\textbar{}");
}

/** Escape a URL for `\href` / `\url` arguments. */
function escapeUrl(url: string): string {
  return url.replace(/([%#\\{}])/g, "\\$1");
}

/**
 * Swap fenced and inline code for placeholders so `$`, `\[` … inside code are
 * never mistaken for math. They are put back before lexing, so `marked` still
 * sees (and types) them as code.
 */
function shieldCode(src: string): { text: string; regions: string[] } {
  const regions: string[] = [];
  const stash = (m: string): string => {
    regions.push(m);
    return `CODESPANQ${regions.length - 1}Z`;
  };
  let text = src.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[ \t]*(?=\n|$)/g, (m) => stash(m));
  text = text.replace(/`+[^`\n]+`+/g, (m) => stash(m));
  return { text, regions };
}

function restoreCode(text: string, regions: string[]): string {
  return text.replace(CODE_PLACEHOLDER_RE, (_m, n: string) => regions[Number(n)] ?? "");
}

function protectMath(src: string): { text: string; spans: MathSpan[] } {
  const spans: MathSpan[] = [];
  const stash = (latex: string): string => {
    spans.push({ latex });
    return `MATHSPANQ${spans.length - 1}Z`;
  };

  let text = src.replaceAll(BACKSPACE_CHAR, "\\b").replaceAll(FORM_FEED_CHAR, "\\f");

  // Order matters. Display delimiters go first so an environment written
  // inside them (`$$\begin{aligned}…\end{aligned}$$`, very common) is captured
  // once, as a whole; then bare environments; then the inline forms, whose
  // patterns would otherwise fire on `$` / `\(` inside display math.
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => stash(displayMath(inner)));
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => stash(displayMath(inner)));
  text = text.replace(/\\begin\{([a-zA-Z*]+)\}[\s\S]+?\\end\{\1\}/g, (m, name: string) =>
    stash(bareEnvironment(m, name)),
  );
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => stash(`\\(${inner}\\)`));
  // Inline `$…$`: no `$` inside, at most single line breaks (a blank line ends
  // a paragraph and cannot be inside inline math), not preceded by `\` or `$`.
  text = text.replace(
    /(^|[^\\$])\$((?:[^$\n]|\n(?![ \t]*\n))+?)\$(?!\d)/g,
    (_m, pre: string, inner: string) => `${pre}${stash(`$${inner}$`)}`,
  );
  return { text, spans };
}

function restoreMath(text: string, spans: MathSpan[]): string {
  // Loop: a span's LaTeX can itself contain a placeholder when delimiters were
  // nested in an unexpected way; every level must be resolved.
  let out = text;
  for (let i = 0; i < 8 && /MATHSPANQ\d+Z/.test(out); i += 1) {
    out = out.replace(PLACEHOLDER_RE, (_m, n: string) => spans[Number(n)]?.latex ?? "");
  }
  return out;
}

export interface MarkdownToLatexOptions {
  /**
   * LaTeX sectioning command for a level-1 Markdown heading; deeper headings
   * step down from there. Defaults to `paragraph` so headings inside an entry
   * body never outrank the entry's own heading.
   */
  headingBase?: "section" | "subsection" | "subsubsection" | "paragraph";
  /**
   * Maps a persisted file id to its path inside the bundle, so the solver's
   * `<img src="/api/conversations/<id>/files/<fileId>">` figures become
   * `\includegraphics` of the exported copy.
   */
  resolveFile?: (fileId: string) => string | undefined;
}

const FILE_URL_RE = /\/api\/conversations\/[^/"'\s]+\/files\/([A-Za-z0-9_-]+)/;

const HEADING_LEVELS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph"] as const;

function headingCommand(depth: number, base: MarkdownToLatexOptions["headingBase"]): string {
  const start = HEADING_LEVELS.indexOf(base ?? "paragraph");
  const idx = Math.min(HEADING_LEVELS.length - 1, start + Math.max(0, depth - 1));
  return HEADING_LEVELS[idx];
}

const PYTHON_LANGS = new Set(["python", "py", "python3", "sage"]);

/**
 * Verbatim block that survives arbitrary content. `fvextra`'s Verbatim breaks
 * long lines and copes with UTF-8 under pdfLaTeX; the only sequence that could
 * end it early is neutralised. Python is highlighted with the `\PY*` colour
 * macros defined in the preamble (the block then uses `commandchars`, and the
 * highlighter escapes `\`, `{`, `}` accordingly). The block has no frame of
 * its own so it can sit inside a breakable card.
 */
/**
 * fvextra measures each line in a box before breaking it; a single line above
 * roughly 3000 characters overflows TeX's maximum dimension. Such lines (JSON
 * dumps, mostly) are folded here; the exact bytes are in `ledger.json` and the
 * `code/` files.
 */
const VERBATIM_MAX_LINE = 1500;

function foldLongLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length <= VERBATIM_MAX_LINE ? line : line.match(/[\s\S]{1,1500}/g)?.join("\n") ?? line))
    .join("\n");
}

export function verbatimBlock(content: string, lang = "", extraOptions = ""): string {
  const trimmed = foldLongLines(content.replace(/\n+$/, ""));
  const python = PYTHON_LANGS.has(lang.toLowerCase());
  const body = (python ? highlightPython(trimmed) : trimmed).replace(
    /\\end\{Verbatim\}/g,
    "\\end {Verbatim}",
  );
  const opts = [
    "breaklines=true",
    "breakanywhere=true",
    "fontsize=\\footnotesize",
    "baselinestretch=1.05",
    python ? "commandchars=\\\\\\{\\}" : "",
    extraOptions,
  ]
    .filter(Boolean)
    .join(", ");
  return `\\begin{Verbatim}[${opts}]\n${body}\n\\end{Verbatim}`;
}

class LatexEmitter {
  constructor(private readonly options: MarkdownToLatexOptions) {}

  blocks(tokens: Token[]): string {
    return tokens
      .map((t) => this.block(t))
      .filter((s) => s.length > 0)
      .join("\n\n");
  }

  private block(token: Token): string {
    switch (token.type) {
      case "space":
        return "";
      case "heading": {
        const t = token as Tokens.Heading;
        return `\\${headingCommand(t.depth, this.options.headingBase)}*{${this.inline(t.tokens)}${this.closeHtmlGroups()}}`;
      }
      case "paragraph":
        return this.inline((token as Tokens.Paragraph).tokens) + this.closeHtmlGroups();
      case "text": {
        const t = token as Tokens.Text;
        return (t.tokens ? this.inline(t.tokens) : escapeLatex(t.text)) + this.closeHtmlGroups();
      }
      case "code": {
        const t = token as Tokens.Code;
        return verbatimBlock(
          t.text,
          t.lang ?? "",
          "frame=leftline, rulecolor=\\color{ruleGray}, framerule=1.2pt, framesep=2mm",
        );
      }
      case "blockquote":
        return `\\begin{mdquote}\n${this.blocks((token as Tokens.Blockquote).tokens)}\n\\end{mdquote}`;
      case "list": {
        const t = token as Tokens.List;
        const env = t.ordered ? "enumerate" : "itemize";
        const start =
          t.ordered && typeof t.start === "number" && t.start !== 1
            ? `\n\\setcounter{enumi}{${t.start - 1}}`
            : "";
        const items = t.items
          .map((item) => {
            const marker = item.task ? (item.checked ? "[$\\boxtimes$] " : "[$\\square$] ") : "";
            return `\\item ${marker}${this.blocks(item.tokens)}`;
          })
          .join("\n");
        return `\\begin{${env}}${start}\n${items}\n\\end{${env}}`;
      }
      case "hr":
        return "\\noindent\\rule{\\linewidth}{0.4pt}";
      case "html":
        return this.html((token as Tokens.HTML).text, true);
      case "table": {
        const t = token as Tokens.Table;
        const cols = t.header.length;
        const spec = Array(cols).fill("l").join(" ");
        const row = (cells: Tokens.TableCell[]): string =>
          cells.map((c) => this.inline(c.tokens) + this.closeHtmlGroups()).join(" & ") + " \\\\";
        const lines = [
          `\\begin{longtable}{${spec}}`,
          "\\toprule",
          `\\rowcolor{surface} ${row(t.header)}`,
          "\\midrule",
          "\\endhead",
          ...t.rows.map(row),
          "\\bottomrule",
          "\\end{longtable}",
        ];
        return lines.join("\n");
      }
      case "def":
        return "";
      default:
        return this.inline([token]);
    }
  }

  /** Formatting groups opened by inline HTML tags (`<b>`, `<sup>` …) not yet closed. */
  private openHtmlGroups = 0;

  /**
   * Raw HTML written by a model, as `marked` hands it over: a whole block, or
   * a single tag when it appears inline in a paragraph. Figures (`<img>` of a
   * generated file) become `\includegraphics`; simple formatting tags map to
   * their LaTeX equivalent, with groups kept balanced across tokens;
   * structural tags are dropped; anything else is shown literally.
   */
  private html(raw: string, block: boolean): string {
    const parts: string[] = [];
    const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\/?>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(raw)) !== null) {
      if (m.index > last) parts.push(escapeLatex(decodeEntities(raw.slice(last, m.index))));
      parts.push(this.htmlTag(m[1] === "/", m[2].toLowerCase(), m[3], m[0]));
      last = m.index + m[0].length;
    }
    if (last < raw.length) parts.push(escapeLatex(decodeEntities(raw.slice(last))));
    let out = parts.join("");
    if (block) {
      out += this.closeHtmlGroups();
    }
    return block ? out.trim() : out;
  }

  private htmlTag(closing: boolean, name: string, attrs: string, raw: string): string {
    const OPEN: Record<string, string> = {
      b: "\\textbf{",
      strong: "\\textbf{",
      i: "\\emph{",
      em: "\\emph{",
      u: "\\uline{",
      s: "\\sout{",
      del: "\\sout{",
      strike: "\\sout{",
      sub: "\\textsubscript{",
      sup: "\\textsuperscript{",
      code: "\\texttt{",
      tt: "\\texttt{",
      kbd: "\\texttt{",
    };
    if (name === "img" && !closing) {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
      const fileId = FILE_URL_RE.exec(src)?.[1];
      const path = fileId ? this.options.resolveFile?.(fileId) : undefined;
      if (path) {
        const caption = alt ? `\n\\caption*{${escapeLatex(alt)}}` : "";
        return `\n\\begin{figure}[H]\n\\centering\n\\includegraphics[width=0.85\\linewidth,height=0.45\\textheight,keepaspectratio]{${path}}${caption}\n\\end{figure}\n`;
      }
      return `{\\color{muted}\\itshape [figure not included in the export${alt ? `: ${escapeLatex(alt)}` : ""}]}`;
    }
    if (name === "br") return "\\par{}";
    if (name === "hr") return "\n\\noindent\\rule{\\linewidth}{0.4pt}\n";
    if (name in OPEN) {
      if (!closing) {
        this.openHtmlGroups += 1;
        return OPEN[name];
      }
      if (this.openHtmlGroups > 0) {
        this.openHtmlGroups -= 1;
        return "}";
      }
      return "";
    }
    // Structural tags carry no formatting in a linear document.
    if (["p", "div", "span", "center", "details", "summary", "section", "article", "small", "font", "a"].includes(name)) {
      return closing && (name === "p" || name === "div" || name === "center" || name === "details") ? "\\par{}" : "";
    }
    if (["ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th"].includes(name)) {
      return name === "li" && !closing ? "\\par{}\\textbullet~" : name === "tr" && closing ? "\\par{}" : name === "td" || name === "th" ? " " : "";
    }
    return escapeLatex(raw);
  }

  private closeHtmlGroups(): string {
    const closers = "}".repeat(this.openHtmlGroups);
    this.openHtmlGroups = 0;
    return closers;
  }

  inline(tokens: Token[] | undefined): string {
    if (!tokens) return "";
    return tokens.map((t) => this.inlineToken(t)).join("");
  }

  private inlineToken(token: Token): string {
    switch (token.type) {
      case "text": {
        const t = token as Tokens.Text;
        return t.tokens ? this.inline(t.tokens) : escapeLatex(t.text);
      }
      case "escape":
        return escapeLatex((token as Tokens.Escape).text);
      case "strong":
        return `\\textbf{${this.inline((token as Tokens.Strong).tokens)}}`;
      case "em":
        return `\\emph{${this.inline((token as Tokens.Em).tokens)}}`;
      case "del":
        return `\\sout{${this.inline((token as Tokens.Del).tokens)}}`;
      case "codespan":
        return `\\texttt{${escapeLatex(decodeEntities((token as Tokens.Codespan).text))}}`;
      case "br":
        return "\\\\";
      case "link": {
        const t = token as Tokens.Link;
        const label = this.inline(t.tokens);
        return `\\href{${escapeUrl(t.href)}}{${label}}`;
      }
      case "image": {
        const t = token as Tokens.Image;
        return `\\url{${escapeUrl(t.href)}}`;
      }
      case "html":
        return this.html((token as Tokens.HTML).text, false);
      case "paragraph":
      case "heading":
      case "list":
      case "blockquote":
      case "code":
      case "table":
        return this.block(token);
      default:
        return escapeLatex((token as { raw?: string }).raw ?? "");
    }
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Convert a Markdown (with math) string to LaTeX body text. */
export function markdownToLatex(markdown: string, options: MarkdownToLatexOptions = {}): string {
  const shielded = shieldCode(markdown);
  const { text, spans } = protectMath(shielded.text);
  const tokens = new Lexer({ gfm: true }).lex(restoreCode(text, shielded.regions));
  const latex = new LatexEmitter(options).blocks(tokens);
  return restoreMath(latex, spans);
}
