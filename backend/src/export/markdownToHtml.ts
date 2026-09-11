/**
 * Server-side counterpart of the web UI's Markdown pipeline
 * (`frontend/src/app/core/utils/markdown.ts`): Markdown + math + code fences
 * rendered to HTML with KaTeX and Prism, for `report.html`.
 *
 * Because the exported page is opened as a local file, no sanitiser runs in
 * the browser. Instead of trusting model-written HTML, every raw HTML token is
 * escaped and rendered as text; the single exception is the `<img>` tag the
 * Main Solver uses to embed generated figures, which is rewritten to point at
 * the copy of the file inside the bundle (`artifacts/<entryId>/<name>`). Link
 * targets are limited to http(s), mailto and in-page anchors.
 */
import katex from "katex";
import { Marked, type Tokens } from "marked";
import Prism from "prismjs";
import "prismjs/components/prism-python";

const KATEX_PLACEHOLDER = "\u0001SAKATEX\u0001";
const CODE_FENCE_PLACEHOLDER = "\u0001SACODEFENCE\u0001";
const INLINE_CODE_PLACEHOLDER = "\u0001SACODEINLINE\u0001";

const LATEX_BLOCK_RE = /\\\[([\s\S]+?)\\\]/g;
const LATEX_INLINE_RE = /\\\(([\s\S]+?)\\\)/g;
const LATEX_ENVIRONMENT_RE = /\\begin\{([a-zA-Z*]+)\}([\s\S]+?)\\end\{\1\}/g;
const DOLLAR_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;
// Inline `$…$`: no `$` inside, at most single line breaks, not preceded by `\`
// or `$`, not followed by a digit (`$5 and $10` is not math).
const DOLLAR_INLINE_RE = /(^|[^\\$])\$((?:[^$\n]|\n(?![ \t]*\n))+?)\$(?!\d)/g;
const BACKSPACE_CHAR = "\u0008";
const FORM_FEED_CHAR = "\u000c";

const FILE_URL_RE = /\/api\/conversations\/[^/"'\s]+\/files\/([A-Za-z0-9_-]+)/;

/** Tags kept (without attributes) when a model writes raw HTML. */
const SAFE_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "del", "strike", "sub", "sup", "code", "kbd", "tt", "small",
  "br", "hr", "p", "div", "span", "center", "blockquote", "pre",
  "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
  "details", "summary", "h1", "h2", "h3", "h4", "h5", "h6",
]);
const VOID_TAGS = new Set(["br", "hr"]);

export interface MarkdownToHtmlOptions {
  /**
   * Maps a persisted file id to its path inside the bundle. `<img>` tags whose
   * `src` is a `/api/conversations/<id>/files/<fileId>` URL are rewritten to
   * that path; unknown ids render as a small placeholder note.
   */
  resolveFile?: (fileId: string) => string | undefined;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  return undefined;
}

/** Highlight source code with Prism; falls back to escaped text. */
export function highlightCode(source: string, lang: string): string {
  const grammar = Prism.languages[lang] ?? (lang === "" ? undefined : Prism.languages["clike"]);
  if (!grammar) return escapeHtml(source);
  return Prism.highlight(source, grammar, lang || "clike");
}

function buildMarked(options: MarkdownToHtmlOptions): Marked {
  const marked = new Marked({ gfm: true, breaks: true });

  const imageFromRawHtml = (raw: string): string | undefined => {
    const tag = /^\s*<img\b([^>]*)\/?>\s*$/i.exec(raw);
    if (!tag) return undefined;
    const attrs = tag[1];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const fileId = FILE_URL_RE.exec(src)?.[1];
    const path = fileId ? options.resolveFile?.(fileId) : undefined;
    if (path) {
      return `<img class="figure" src="${escapeHtml(path)}" alt="${escapeHtml(alt)}" loading="lazy">`;
    }
    return `<span class="missing-figure">[figure not included in the export${alt ? `: ${escapeHtml(alt)}` : ""}]</span>`;
  };

  /**
   * Keep the harmless formatting / structure tags the app's sanitiser also
   * keeps (attributes dropped), rewrite figure `<img>`s, escape everything
   * else so it shows literally.
   */
  const sanitizeHtml = (raw: string): string => {
    const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)\/?>/g;
    const parts: string[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(raw)) !== null) {
      if (m.index > last) parts.push(escapeHtml(raw.slice(last, m.index)));
      const closing = m[1] === "/";
      const name = m[2].toLowerCase();
      if (name === "img" && !closing) parts.push(imageFromRawHtml(m[0]) ?? escapeHtml(m[0]));
      else if (SAFE_TAGS.has(name)) parts.push(closing && !VOID_TAGS.has(name) ? `</${name}>` : `<${name}>`);
      else parts.push(escapeHtml(m[0]));
      last = m.index + m[0].length;
    }
    if (last < raw.length) parts.push(escapeHtml(raw.slice(last)));
    return parts.join("");
  };

  marked.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag): string {
        const asImage = imageFromRawHtml(token.text);
        if (asImage) return token.block ? `<p>${asImage}</p>\n` : asImage;
        const safe = sanitizeHtml(token.text);
        return token.block ? `<div class="raw-html">${safe}</div>\n` : safe;
      },
      link(token: Tokens.Link): string {
        const inner = this.parser.parseInline(token.tokens);
        const href = safeHref(token.href);
        if (!href) return inner;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
      },
      image(token: Tokens.Image): string {
        const fileId = FILE_URL_RE.exec(token.href)?.[1];
        const path = fileId ? options.resolveFile?.(fileId) : undefined;
        const src = path ?? (safeHref(token.href) && /^https?:/i.test(token.href) ? token.href : undefined);
        if (!src) {
          return `<span class="missing-figure">[image not included in the export${token.text ? `: ${escapeHtml(token.text)}` : ""}]</span>`;
        }
        return `<img class="figure" src="${escapeHtml(src)}" alt="${escapeHtml(token.text)}" loading="lazy">`;
      },
      code(token: Tokens.Code): string {
        const lang = (token.lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
        return `<pre${cls}><code${cls}>${highlightCode(token.text, lang)}</code></pre>\n`;
      },
    },
  });
  return marked;
}

function renderKatex(body: string, displayMode: boolean): string {
  const normalized = body.replaceAll(BACKSPACE_CHAR, "\\b").replaceAll(FORM_FEED_CHAR, "\\f");
  try {
    return katex.renderToString(normalized, {
      throwOnError: false,
      displayMode,
      output: "html",
      strict: "ignore",
    });
  } catch {
    return escapeHtml(body);
  }
}

function extractMath(source: string): { cleaned: string; fragments: string[] } {
  const fragments: string[] = [];
  const put = (body: string, display: boolean, prefix = ""): string => {
    fragments.push(renderKatex(body, display));
    return `${prefix}${KATEX_PLACEHOLDER}${fragments.length - 1}${KATEX_PLACEHOLDER}`;
  };
  // Display delimiters first so an environment written inside them
  // (`$$\begin{aligned}…\end{aligned}$$`) is rendered once, as a whole; then
  // bare environments; then the inline forms.
  let cleaned = source.replace(LATEX_BLOCK_RE, (_m, body: string) => put(body, true));
  cleaned = cleaned.replace(DOLLAR_BLOCK_RE, (_m, body: string) => put(body, true));
  cleaned = cleaned.replace(LATEX_ENVIRONMENT_RE, (_m, env: string, body: string) =>
    put(`\\begin{${env}}${body}\\end{${env}}`, true),
  );
  cleaned = cleaned.replace(LATEX_INLINE_RE, (_m, body: string) => put(body, false));
  cleaned = cleaned.replace(DOLLAR_INLINE_RE, (_m, before: string, body: string) =>
    put(body, false, before),
  );
  return { cleaned, fragments };
}

function shield(source: string): { text: string; fences: string[]; inline: string[] } {
  const fences: string[] = [];
  let text = source.replace(/```[^\n]*\n[\s\S]*?```/g, (m) => {
    fences.push(m);
    return `${CODE_FENCE_PLACEHOLDER}${fences.length - 1}${CODE_FENCE_PLACEHOLDER}`;
  });
  const inline: string[] = [];
  text = text.replace(/`[^`\n]+`/g, (m) => {
    inline.push(m);
    return `${INLINE_CODE_PLACEHOLDER}${inline.length - 1}${INLINE_CODE_PLACEHOLDER}`;
  });
  return { text, fences, inline };
}

function restore(source: string, placeholder: string, regions: string[]): string {
  if (regions.length === 0) return source;
  const re = new RegExp(`${placeholder}(\\d+)${placeholder}`, "g");
  return source.replace(re, (_m, idx: string) => regions[Number(idx)] ?? "");
}

/**
 * Render Markdown with `$…$`, `$$…$$`, `\(…\)`, `\[…\]` and LaTeX environments
 * to HTML. Raw HTML in the source is escaped (see module comment).
 */
export function markdownToHtml(source: string, options: MarkdownToHtmlOptions = {}): string {
  if (!source) return "";
  const { text, fences, inline } = shield(source);
  const { cleaned, fragments } = extractMath(text);
  const restored = restore(restore(cleaned, INLINE_CODE_PLACEHOLDER, inline), CODE_FENCE_PLACEHOLDER, fences);
  const html = buildMarked(options).parse(restored, { async: false }) as string;
  return restore(html, KATEX_PLACEHOLDER, fragments);
}
