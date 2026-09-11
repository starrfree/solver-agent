import DOMPurify from "dompurify";
import katex from "katex";
import { Marked } from "marked";
import Prism from "prismjs";
// Register Python grammar for code fences.
import "prismjs/components/prism-python";

const KATEX_PLACEHOLDER = "\u0001SAKATEX\u0001";
const CODE_FENCE_PLACEHOLDER = "\u0001SACODEFENCE\u0001";
const INLINE_CODE_PLACEHOLDER = "\u0001SACODEINLINE\u0001";

const marked = new Marked({
  gfm: true,
  breaks: true,
});

interface ParsedMath {
  cleaned: string;
  fragments: string[];
}

// Math delimiter patterns. We support both the `$...$` / `$$...$$` style
// (typed by humans) and the LaTeX `\(...\)` / `\[...\]` style (commonly
// emitted by LLMs). The `\[ ... \]` and `\( ... \)` forms must be
// extracted *before* marked runs, because marked treats `\[` as an
// escaped `[` and silently strips the backslash.
const LATEX_BLOCK_RE = /\\\[([\s\S]+?)\\\]/g;
const LATEX_INLINE_RE = /\\\(([\s\S]+?)\\\)/g;
const LATEX_ENVIRONMENT_RE =
  /\\begin\{([a-zA-Z*]+)\}([\s\S]+?)\\end\{\1\}/g;
const DOLLAR_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;
const DOLLAR_INLINE_RE = /(^|[^\\$])\$([^\n$]+?)\$/g;
// Control characters that JSON.parse produces from a mangled "\b" / "\f"
// LaTeX escape; matched as plain strings to keep the linter's
// no-control-regex rule happy.
const BACKSPACE_CHAR = "\u0008";
const FORM_FEED_CHAR = "\u000c";

/**
 * Render Markdown enriched with KaTeX (`$inline$`, `$$display$$`,
 * `\(inline\)`, `\[display\]`, `\begin{align}...\end{align}`) and
 * Prism-highlighted code fences
 * (`python` highlighted by default).
 *
 * The pipeline:
 *   1. Shield fenced / inline code so math delimiters inside stay literal
 *   2. Pre-process: replace math fragments with placeholders
 *   3. Restore shielded code, then marked.parse
 *   4. Reinsert KaTeX HTML at placeholder positions
 *   5. DOMPurify
 */
export interface RenderMarkdownOptions {
  /**
   * Wrap each fenced code block in a collapsed `<details>` element so long
   * code listings (e.g. in the reasoning-process walkthrough) start folded.
   */
  collapsibleCode?: boolean;
  /**
   * Escape raw HTML (angle brackets) in prose so XML-like tags typed by the
   * user — e.g. `<tag>...</tag>` — render literally instead of being parsed
   * as HTML and stripped by the sanitizer. Code and math spans are left
   * untouched. Enable this for user-authored content.
   */
  escapeHtml?: boolean;
}

export function renderMarkdown(
  source: string,
  options: RenderMarkdownOptions = {},
): string {
  if (!source) return "";

  const { text, fencedBlocks, inlineCodes } = shieldCodeRegions(source);
  const { cleaned, fragments } = extractMath(text);
  // At this point code fences, inline code and math have been swapped out for
  // placeholders, so `cleaned` is prose only. Escaping angle brackets here
  // keeps user-typed tags like `<tag>` visible without touching code or math.
  const prose = options.escapeHtml ? escapeAngleBrackets(cleaned) : cleaned;
  const withInline = restoreShieldedRegions(
    prose,
    INLINE_CODE_PLACEHOLDER,
    inlineCodes,
  );
  const restored = restoreShieldedRegions(
    withInline,
    CODE_FENCE_PLACEHOLDER,
    fencedBlocks,
  );
  const html = marked.parse(restored, { async: false }) as string;
  const withMath = reinsertMath(html, fragments);
  let highlighted = highlightCodeBlocks(withMath);
  if (options.collapsibleCode) {
    highlighted = makeCodeBlocksCollapsible(highlighted);
  }
  return DOMPurify.sanitize(highlighted, {
    // Whitelist a few extra attributes on top of DOMPurify's defaults:
    //   - `class`, `target`, `rel`: links / inline KaTeX / Prism classes.
    //   - `src`, `alt`, `width`, `height`: images embedded by the Main
    //     Solver via `<img src="/api/conversations/<id>/files/<fileId>">`.
    ADD_ATTR: ["class", "target", "rel", "src", "alt", "width", "height"],
    ADD_TAGS: ["img", "details", "summary"],
  });
}

/**
 * Wrap each top-level `<pre>` code block in a collapsed `<details>` so the
 * reader can expand listings on demand. The language (when present on the
 * `<pre class="language-xxx">`) is surfaced in the summary label.
 */
function makeCodeBlocksCollapsible(html: string): string {
  return html.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g, (full, attrs: string) => {
    const langMatch = /language-([a-z0-9_-]+)/i.exec(attrs);
    const label = langMatch ? `${langMatch[1]} code` : "Code";
    return `<details class="code-collapse"><summary>${label}</summary>${full}</details>`;
  });
}

/**
 * Escape `<` and `>` so XML-like tags typed by the user are rendered as
 * literal text rather than parsed as HTML by `marked` (and subsequently
 * stripped by DOMPurify). `marked` preserves the `&lt;` / `&gt;` entities.
 */
function escapeAngleBrackets(source: string): string {
  return source.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface ShieldedCodeRegions {
  text: string;
  fencedBlocks: string[];
  inlineCodes: string[];
}

/**
 * Temporarily replace fenced and inline code spans so `extractMath` does not
 * render `$...$`, `\[...\]`, etc. that appear inside ```latex``` blocks.
 */
function shieldCodeRegions(source: string): ShieldedCodeRegions {
  const fencedBlocks: string[] = [];
  let text = source.replace(/```[^\n]*\n[\s\S]*?```/g, (match) => {
    fencedBlocks.push(match);
    return `${CODE_FENCE_PLACEHOLDER}${fencedBlocks.length - 1}${CODE_FENCE_PLACEHOLDER}`;
  });

  const inlineCodes: string[] = [];
  text = text.replace(/`[^`\n]+`/g, (match) => {
    inlineCodes.push(match);
    return `${INLINE_CODE_PLACEHOLDER}${inlineCodes.length - 1}${INLINE_CODE_PLACEHOLDER}`;
  });

  return { text, fencedBlocks, inlineCodes };
}

function restoreShieldedRegions(
  source: string,
  placeholder: string,
  regions: string[],
): string {
  if (regions.length === 0) return source;
  const re = new RegExp(`${placeholder}(\\d+)${placeholder}`, "g");
  return source.replace(re, (_match, idx: string) => regions[Number(idx)] ?? "");
}

function extractMath(source: string): ParsedMath {
  const fragments: string[] = [];

  const replaceWithPlaceholder = (
    body: string,
    displayMode: boolean,
    prefix = "",
  ): string => {
    const html = renderKatex(normalizeMathBody(body), displayMode);
    fragments.push(html);
    return `${prefix}${KATEX_PLACEHOLDER}${fragments.length - 1}${KATEX_PLACEHOLDER}`;
  };

  // LaTeX-style delimiters first so `\[` is consumed before marked treats
  // it as an escaped bracket.
  let cleaned = source.replace(LATEX_BLOCK_RE, (_m, body: string) =>
    replaceWithPlaceholder(body, true),
  );
  cleaned = cleaned.replace(
    LATEX_ENVIRONMENT_RE,
    (_m, _env: string, body: string) =>
      replaceWithPlaceholder(`\\begin{${_env}}${body}\\end{${_env}}`, true),
  );
  cleaned = cleaned.replace(LATEX_INLINE_RE, (_m, body: string) =>
    replaceWithPlaceholder(body, false),
  );

  cleaned = cleaned.replace(DOLLAR_BLOCK_RE, (_m, body: string) =>
    replaceWithPlaceholder(body, true),
  );
  cleaned = cleaned.replace(
    DOLLAR_INLINE_RE,
    (_m, before: string, body: string) => replaceWithPlaceholder(body, false, before),
  );

  return { cleaned, fragments };
}

function renderKatex(body: string, displayMode: boolean): string {
  try {
    return katex.renderToString(body, {
      throwOnError: false,
      displayMode,
      output: "html",
      strict: "ignore",
    });
  } catch {
    return body;
  }
}

/**
 * Some model/tool outputs can arrive with accidental JSON escape decoding
 * artifacts (e.g. `\frac` turning into form-feed + `rac`). Normalize those
 * control chars back into their intended LaTeX command prefixes before KaTeX.
 */
function normalizeMathBody(body: string): string {
  return body.replaceAll(BACKSPACE_CHAR, "\\b").replaceAll(FORM_FEED_CHAR, "\\f");
}

function reinsertMath(html: string, fragments: string[]): string {
  if (fragments.length === 0) return html;
  const re = new RegExp(`${KATEX_PLACEHOLDER}(\\d+)${KATEX_PLACEHOLDER}`, "g");
  return html.replace(re, (_match, idx: string) => fragments[Number(idx)] ?? "");
}

function highlightCodeBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-([a-z0-9_-]+)">([\s\S]*?)<\/code><\/pre>/g,
    (_full, lang: string, body: string) => {
      const grammar = Prism.languages[lang] ?? Prism.languages["clike"];
      if (!grammar) return _full;
      const decoded = decodeHtml(body);
      const highlighted = Prism.highlight(decoded, grammar, lang);
      return `<pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>`;
    },
  );
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Highlight a raw Python source string for the artifacts code tab. */
export function highlightPython(source: string): string {
  if (!source) return "";
  const grammar = Prism.languages["python"];
  if (!grammar) return source;
  return Prism.highlight(source, grammar, "python");
}
