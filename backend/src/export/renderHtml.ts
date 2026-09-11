/**
 * Render an `ExportDocument` as a single self-contained HTML page that
 * reproduces the conversation view of the web UI: user and assistant messages
 * interleaved with the ledger step cards, in chronological order. Each card
 * expands to the step's content, code, output, plots and files.
 *
 * Everything the page needs is inlined (styles, KaTeX with its fonts, a few
 * lines of script for the theme toggle and card navigation); figures are
 * loaded from the `artifacts/` folder of the bundle, so the file is meant to
 * be opened from the unzipped bundle. Math is rendered at export time with
 * KaTeX and code is highlighted with Prism, both server-side, so the page
 * contains no third-party script.
 */
import type { LedgerEntryStatus, LedgerEntryType } from "../db/types";
import { katexCssInline } from "./htmlAssets";
import {
  formatDate,
  formatDuration,
  ROLE_LABELS,
  STATUS_LABELS,
  TOOL_LABELS,
  TYPE_LABELS,
} from "./labels";
import { escapeHtml, highlightCode, markdownToHtml } from "./markdownToHtml";
import { STATUS_COLOR_HEX, TYPE_COLOR_HEX } from "./palette";
import type { ExportDocument, ExportEntry, ExportFile, ExportMessage } from "./types";

const TYPE_VAR: Record<LedgerEntryType, string> = {
  assumption: "--type-assumption",
  derivation: "--type-derivation",
  result: "--type-result",
  symbolic_computation: "--type-symbolic",
  numerical_computation: "--type-numerical",
  cy_analyst_computation: "--type-cy-analyst",
  reference_lookup: "--type-reference-seeker",
  verification: "--type-verification",
  correction: "--type-correction",
  final_answer: "--type-final",
  problem_followup: "--type-problem-followup",
};

/** Dark-theme hues, taken from the web UI's default theme. */
const TYPE_DARK_HEX: Record<LedgerEntryType, string> = {
  assumption: "#56b6ff",
  derivation: "#b58dff",
  result: "#e08fd0",
  symbolic_computation: "#6d8eff",
  numerical_computation: "#3ec78a",
  cy_analyst_computation: "#22d3ee",
  reference_lookup: "#9ba3b4",
  verification: "#e3b341",
  correction: "#ef5b6c",
  final_answer: "#f6c177",
  problem_followup: "#5cd1c5",
};

const STATUS_DARK_HEX: Record<LedgerEntryStatus, string> = {
  pending: "#e3b341",
  accepted: "#3ec78a",
  rejected: "#ef5b6c",
  superseded: "#6b7385",
};

type TimelineItem =
  | { kind: "message"; ts: number; message: ExportMessage }
  | { kind: "entry"; ts: number; entry: ExportEntry; index: number };

function typeVars(theme: "light" | "dark"): string {
  const types = Object.keys(TYPE_VAR) as LedgerEntryType[];
  const lines = types.map(
    (t) => `  ${TYPE_VAR[t]}: ${theme === "light" ? TYPE_COLOR_HEX[t] : TYPE_DARK_HEX[t]};`,
  );
  const statuses = Object.keys(STATUS_COLOR_HEX) as LedgerEntryStatus[];
  lines.push(
    ...statuses.map(
      (s) => `  --status-${s}: ${theme === "light" ? STATUS_COLOR_HEX[s] : STATUS_DARK_HEX[s]};`,
    ),
  );
  return lines.join("\n");
}

function pageCss(): string {
  return `
:root, [data-theme="dark"] {
  --bg: #0a0c10; --bg-elev: #0f1218; --surface: #141821; --surface-hover: #1a1f2b; --surface-active: #202636;
  --border: rgba(255,255,255,0.08); --border-strong: rgba(255,255,255,0.16);
  --text: #e6e8ee; --text-muted: #9ba3b4; --text-subtle: #6b7385;
  --accent: #6d8eff; --accent-soft: rgba(109,142,255,0.16);
  --success: #3ec78a; --success-soft: rgba(62,199,138,0.16); --warning: #e3b341; --warning-soft: rgba(227,179,65,0.18);
  --danger: #ef5b6c; --danger-soft: rgba(239,91,108,0.18); --info: #56b6ff; --info-soft: rgba(86,182,255,0.18);
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.25); --shadow-md: 0 4px 12px rgba(0,0,0,0.32);
  --tok-keyword: #b58dff; --tok-builtin: #22d3ee; --tok-string: #3ec78a; --tok-comment: #6b7385; --tok-number: #e3b341; --tok-decorator: #e08fd0; --tok-function: #6d8eff;
${typeVars("dark")}
}
[data-theme="light"] {
  --bg: #f8f9fb; --bg-elev: #ffffff; --surface: #ffffff; --surface-hover: #f1f3f8; --surface-active: #e7eaf2;
  --border: rgba(20,23,31,0.08); --border-strong: rgba(20,23,31,0.16);
  --text: #14171f; --text-muted: #5b6275; --text-subtle: #8a91a3;
  --accent: #2b53e0; --accent-soft: rgba(43,83,224,0.10);
  --success: #167d4f; --success-soft: rgba(22,125,79,0.12); --warning: #b3811a; --warning-soft: rgba(179,129,26,0.14);
  --danger: #c52941; --danger-soft: rgba(197,41,65,0.10); --info: #1f7fc4; --info-soft: rgba(31,127,196,0.12);
  --shadow-sm: 0 1px 2px rgba(20,23,31,0.06); --shadow-md: 0 4px 12px rgba(20,23,31,0.08);
  --tok-keyword: #7c4ed0; --tok-builtin: #0891b2; --tok-string: #167d4f; --tok-comment: #8a91a3; --tok-number: #b3811a; --tok-decorator: #c451a6; --tok-function: #2b53e0;
${typeVars("light")}
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.55 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
code, pre, .mono { font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace; }
a { color: var(--accent); }
button { font: inherit; cursor: pointer; }

/* --- top bar -------------------------------------------------------------- */
.topbar {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--bg-elev) 92%, transparent); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}
.topbar-inner { max-width: 1100px; margin: 0 auto; padding: 12px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.topbar h1 { font-size: 17px; font-weight: 600; margin: 0; letter-spacing: -0.01em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 320px; }
.topbar .actions { display: flex; gap: 6px; margin-left: auto; }
.btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 6px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-muted); font-size: 12.5px; font-weight: 500;
}
.btn:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border-strong); }

/* --- header card ----------------------------------------------------------- */
.page { max-width: 1100px; margin: 0 auto; padding: 24px 24px 64px; }
.overview {
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px 24px; box-shadow: var(--shadow-sm);
}
.overview .label { display: block; font-size: 11px; color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; margin-bottom: 4px; }
.overview .value { font-size: 13px; color: var(--text); }
.overview .value.mono { font-size: 12px; color: var(--text-muted); word-break: break-all; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--border); font-size: 11.5px; color: var(--text-muted);
}
.chip.accent { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.chip .mono { font-size: 11px; }
.models { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; }
.models .role { color: var(--text-muted); }
.models .model { color: var(--text); }

/* --- pills & badges -------------------------------------------------------- */
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px 2px 7px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em; line-height: 1; height: 18px; white-space: nowrap;
}
.pill::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.pill.accepted, .pill.solved, .pill.verified { color: var(--success); background: var(--success-soft); }
.pill.pending, .pill.paused { color: var(--warning); background: var(--warning-soft); }
.pill.rejected, .pill.failed { color: var(--danger); background: var(--danger-soft); }
.pill.superseded, .pill.archived { color: var(--text-subtle); background: var(--surface-active); }
.pill.active { color: var(--info); background: var(--info-soft); }
.type-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; line-height: 1; height: 18px; white-space: nowrap; color: var(--accent-type); }
.type-badge::before { content: ""; width: 7px; height: 7px; border-radius: 2px; background: currentColor; opacity: 0.9; }

/* --- timeline ----------------------------------------------------------------- */
.timeline { display: flex; flex-direction: column; gap: 14px; margin-top: 24px; }
.msg { display: flex; flex-direction: column; gap: 6px; }
.msg .meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-subtle); }
.msg .role { color: var(--text-muted); font-weight: 600; }
.msg .bubble { padding: 20px 30px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); }
.msg.user .bubble { background: var(--accent-soft); border-color: transparent; }
.msg .bubble img { max-width: 800px; width: 100%; height: auto; display: block; margin: 8px auto; }

.card {
  --accent-type: var(--text-muted);
  position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  transition: border-color 120ms, box-shadow 120ms;
}
.card:hover { border-color: var(--border-strong); }
.card:target, .card.flash { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.card.final { border-color: color-mix(in srgb, var(--type-final) 55%, transparent); }
.card.inactive > summary .summary { color: var(--text-muted); text-decoration: line-through; text-decoration-color: var(--border-strong); }
.card > summary {
  list-style: none; display: grid; grid-template-columns: 4px auto 1fr auto; align-items: center; gap: 10px;
  padding: 10px 14px 10px 0; cursor: pointer; color: var(--text);
}
.card > summary .head { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; }
.card > summary::-webkit-details-marker { display: none; }
.card > summary .accent { width: 3px; align-self: stretch; background: var(--accent-type); border-radius: 0 3px 3px 0; }
.card > summary .tool { font-size: 11px; color: var(--text-subtle); padding: 1px 7px; border-radius: 999px; background: var(--surface-active); border: 1px solid var(--border); height: 18px; display: inline-flex; align-items: center; line-height: 1; white-space: nowrap; }
.card > summary .summary { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.card[open] > summary .summary { white-space: normal; }
.card > summary .meta { display: flex; align-items: center; gap: 8px; color: var(--text-subtle); font-size: 11px; flex-shrink: 0; white-space: nowrap; }
.card > summary .meta .duration { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; }
.card > summary .meta .fast { display: inline-flex; align-items: center; padding: 1px 6px; height: 18px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--text-muted); font-weight: 600; }
.card > summary .chevron { width: 14px; height: 14px; transition: transform 120ms; }
.card[open] > summary .chevron { transform: rotate(90deg); }
.card .body { padding: 4px 16px 16px 17px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 14px; }
.card .body > :first-child { margin-top: 10px; }
.empty { font-size: 12.5px; color: var(--text-subtle); font-style: italic; }
.label { display: block; font-size: 11px; color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; margin-bottom: 6px; }
.section p.plain { margin: 0; font-size: 13px; color: var(--text-muted); line-height: 1.55; white-space: pre-wrap; }
.chips-row { display: flex; flex-wrap: wrap; gap: 6px; }
.chip-link { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 11px; color: var(--text-muted); text-decoration: none; }
.chip-link:hover { background: var(--surface-hover); color: var(--text); border-color: var(--border-strong); }
.chip-link.missing { opacity: 0.6; cursor: default; }
.verdict { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); }
.verdict .pill { text-transform: capitalize; }
.status-note { font-size: 12.5px; padding: 8px 12px; border-radius: 6px; border-left: 3px solid var(--danger); background: var(--danger-soft); color: var(--text); }
.status-note.superseded { border-left-color: var(--text-subtle); background: var(--surface-active); }
.status-note.pending { border-left-color: var(--warning); background: var(--warning-soft); }
.final-answer { border: 1px solid color-mix(in srgb, var(--type-final) 40%, transparent); background: color-mix(in srgb, var(--type-final) 7%, var(--surface)); border-radius: 8px; padding: 12px 16px; }
.final-answer .label { color: var(--type-final); }
.entry-footer { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11px; color: var(--text-subtle); border-top: 1px dashed var(--border); padding-top: 10px; }
.entry-footer .mono { color: var(--text-muted); }

/* --- artifacts ------------------------------------------------------------------ */
.artifacts { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); overflow: hidden; }
.artifacts > details { border-top: 1px solid var(--border); }
.artifacts > details:first-child { border-top: 0; }
.artifacts > details > summary { list-style: none; display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--text-muted); }
.artifacts > details > summary::-webkit-details-marker { display: none; }
.artifacts > details > summary:hover { background: var(--surface-hover); color: var(--text); }
.artifacts > details > summary .count { margin-left: 2px; padding: 0 6px; background: var(--surface-active); color: var(--text-muted); border-radius: 999px; font-size: 11px; font-weight: 500; }
.artifacts > details > summary .path { margin-left: auto; font-weight: 400; font-size: 11px; color: var(--text-subtle); }
.artifacts > details > summary .path a { color: var(--text-subtle); }
.artifacts .pane { padding: 0 12px 12px; }
.artifacts pre { margin: 0; }
pre.code, .markdown-body pre {
  background: var(--bg-elev); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; overflow-x: auto;
  font-size: 12.5px; line-height: 1.55; color: var(--text); tab-size: 4;
}
pre.code.stderr { border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.stream-label { font-size: 11px; color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; margin: 10px 0 4px; }
.plots { display: flex; flex-direction: column; gap: 14px; }
.plots figure { margin: 0; }
.plots img { max-width: 100%; height: auto; display: block; margin: 0 auto; border-radius: 6px; border: 1px solid var(--border); background: #fff; }
.plots figcaption { text-align: center; font-size: 11.5px; color: var(--text-subtle); margin-top: 6px; }
.files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.files li { display: flex; align-items: center; gap: 10px; font-size: 12.5px; padding: 6px 8px; border-radius: 6px; background: var(--surface); border: 1px solid var(--border); }
.files li .name { color: var(--text); text-decoration: none; }
.files li .name:hover { text-decoration: underline; }
.files li .kind { color: var(--text-subtle); font-size: 11px; }
.files li .size { margin-left: auto; color: var(--text-subtle); font-size: 11px; font-variant-numeric: tabular-nums; }
.files li.skipped { opacity: 0.7; }
.files li.skipped .name { text-decoration: line-through; }
.missing-figure { font-size: 12px; color: var(--text-subtle); font-style: italic; }

/* --- markdown ------------------------------------------------------------------ */
.markdown-body { color: var(--text); font-size: 14px; line-height: 1.7; overflow-wrap: anywhere; }
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body > * + * { margin-top: 12px; }
.markdown-body p { margin: 0; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { font-weight: 600; line-height: 1.3; margin: 20px 0 0; }
.markdown-body h1 { font-size: 24px; } .markdown-body h2 { font-size: 20px; } .markdown-body h3 { font-size: 17px; } .markdown-body h4 { font-size: 15px; }
.markdown-body ul, .markdown-body ol { padding-left: 1.4em; margin: 0; }
.markdown-body li + li { margin-top: 4px; }
.markdown-body blockquote { margin: 0; border-left: 2px solid var(--border-strong); padding-left: 12px; color: var(--text-muted); }
.markdown-body code { font-size: 0.92em; padding: 0.12em 0.4em; border-radius: 4px; background: var(--surface-active); color: var(--text); }
.markdown-body pre code { background: none; padding: 0; font-size: inherit; }
.markdown-body hr { border: 0; border-top: 1px solid var(--border); margin: 20px 0; }
.markdown-body table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.markdown-body th, .markdown-body td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
.markdown-body th { color: var(--text-muted); font-weight: 600; }
.markdown-body img.figure { max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--border); background: #fff; display: block; margin: 8px auto; }
.katex { color: var(--text); font-size: 1em; }
.katex-display { margin: 12px 0; overflow-x: auto; overflow-y: hidden; }
.katex-display > .katex { white-space: nowrap; }

/* --- Prism tokens --------------------------------------------------------------- */
.token.comment, .token.prolog, .token.doctype, .token.cdata { color: var(--tok-comment); font-style: italic; }
.token.punctuation { color: var(--text-muted); }
.token.keyword, .token.important { color: var(--tok-keyword); font-weight: 600; }
.token.builtin, .token.class-name { color: var(--tok-builtin); }
.token.string, .token.char, .token.triple-quoted-string, .token.attr-value { color: var(--tok-string); }
.token.number, .token.boolean, .token.constant { color: var(--tok-number); }
.token.decorator, .token.annotation, .token.symbol { color: var(--tok-decorator); }
.token.function { color: var(--tok-function); }
.token.operator { color: var(--text); }

/* --- footer ---------------------------------------------------------------------- */
.footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-subtle); display: flex; flex-direction: column; gap: 4px; }
.footer .mono { color: var(--text-muted); word-break: break-all; }
.icon { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
@media (max-width: 860px) {
  .card > summary { grid-template-columns: 4px 1fr auto; row-gap: 6px; padding-top: 8px; padding-bottom: 8px; }
  .card > summary .accent { grid-row: 1 / span 2; }
  .card > summary .head { grid-column: 2; }
  .card > summary .meta { grid-column: 3; }
  .card > summary .summary { grid-column: 2 / span 2; white-space: normal; }
  .msg .bubble { padding: 14px 16px; }
}
@media (max-width: 560px) {
  .card > summary .tool, .card > summary .meta .ts { display: none; }
}
@media print {
  .topbar { position: static; }
  .card, .artifacts > details { break-inside: avoid; }
  .actions { display: none; }
}
`;
}

function pageScript(): string {
  return `
(function () {
  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    if (toggle) toggle.textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    try { localStorage.setItem('solver-agent-export-theme', theme); } catch (e) {}
  }
  var saved = null;
  try { saved = localStorage.getItem('solver-agent-export-theme'); } catch (e) {}
  apply(saved === 'dark' ? 'dark' : 'light');
  if (toggle) toggle.addEventListener('click', function () {
    apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
  function setAll(open) {
    var cards = document.querySelectorAll('details.card');
    for (var i = 0; i < cards.length; i++) cards[i].open = open;
  }
  var ex = document.getElementById('expand-all');
  var co = document.getElementById('collapse-all');
  if (ex) ex.addEventListener('click', function () { setAll(true); });
  if (co) co.addEventListener('click', function () { setAll(false); });
  function reveal() {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'DETAILS') el.open = true;
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 2000);
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  window.addEventListener('hashchange', reveal);
  reveal();
})();
`;
}

const CHEVRON_SVG =
  '<svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

function pill(status: string, label = status): string {
  return `<span class="pill ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
}

function typeBadge(type: LedgerEntryType): string {
  return `<span class="type-badge">${escapeHtml(TYPE_LABELS[type])}</span>`;
}

function section(label: string, inner: string, extraClass = ""): string {
  return `<div class="section ${extraClass}"><span class="label">${escapeHtml(label)}</span>${inner}</div>`;
}

function plain(text: string): string {
  return `<p class="plain">${escapeHtml(text)}</p>`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(id: string): string {
  const stripped = id.includes("_") ? id.split("_").slice(1).join("_") : id;
  return stripped.slice(0, 8);
}

function codeBlock(source: string, lang: string, extraClass = ""): string {
  const cls = lang ? ` language-${escapeHtml(lang)}` : "";
  return `<pre class="code${cls}${extraClass ? ` ${extraClass}` : ""}"><code class="${cls.trim()}">${highlightCode(source, lang)}</code></pre>`;
}

interface RenderContext {
  md: (text: string) => string;
  known: Set<string>;
  indexOf: Map<string, number>;
}

function renderMessage(m: ExportMessage, ctx: RenderContext): string {
  const who = m.role === "user" ? "You" : "Solver Agent";
  const related = m.relatedEntries
    .filter((id) => ctx.known.has(id))
    .map((id) => `<a class="chip-link" href="#${escapeHtml(id)}">step ${ctx.indexOf.get(id)}</a>`)
    .join("");
  return `<article class="msg ${m.role}" id="${escapeHtml(m.id)}">
  <div class="meta"><span class="role">${who}</span><span>·</span><span class="ts">${escapeHtml(formatDate(m.createdAt))}</span></div>
  <div class="bubble"><div class="markdown-body">${ctx.md(m.content)}</div>${related ? `<div class="chips-row" style="margin-top:12px">${related}</div>` : ""}</div>
</article>`;
}

function renderFiles(files: ExportFile[]): string {
  const items = files.map((f) => {
    const name = f.skipped
      ? `<span class="name">${escapeHtml(f.name)}</span>`
      : `<a class="name" href="${escapeHtml(f.path)}" download>${escapeHtml(f.name)}</a>`;
    const note = f.skipped
      ? `<span class="kind">not included${f.reason ? ` — ${escapeHtml(f.reason)}` : ""}</span>`
      : `<span class="kind">${escapeHtml(f.mimeType)}</span>`;
    return `<li class="${f.skipped ? "skipped" : ""}">${name}${note}<span class="size">${formatBytes(f.size)}</span></li>`;
  });
  return `<ul class="files">${items.join("")}</ul>`;
}

function renderArtifacts(entry: ExportEntry): string {
  const c = entry.computation;
  if (!c) return "";
  const panes: string[] = [];
  if (c.code) {
    const lines = c.code.split("\n").length;
    const lang = c.codePath?.endsWith(".py") ? "python" : "";
    const path = c.codePath
      ? `<span class="path"><a href="${escapeHtml(c.codePath)}" download>${escapeHtml(c.codePath)}</a></span>`
      : "";
    panes.push(
      `<details open><summary>Code<span class="count">${lines} lines</span>${path}</summary><div class="pane">${codeBlock(c.code, lang)}</div></details>`,
    );
  }
  if (c.stdout || c.stderr) {
    const parts: string[] = [];
    if (c.stdout) parts.push(`<div class="stream-label">stdout</div>${codeBlock(c.stdout, "")}`);
    if (c.stderr) parts.push(`<div class="stream-label">stderr</div>${codeBlock(c.stderr, "", "stderr")}`);
    const long = (c.stdout?.length ?? 0) + (c.stderr?.length ?? 0) > 1500;
    panes.push(
      `<details${long ? "" : " open"}><summary>Output</summary><div class="pane">${parts.join("")}</div></details>`,
    );
  }
  const images = c.files.filter((f) => f.isImage && !f.skipped);
  if (images.length > 0) {
    const figs = images
      .map(
        (f) =>
          `<figure><a href="${escapeHtml(f.path)}" target="_blank" rel="noopener"><img src="${escapeHtml(f.path)}" alt="${escapeHtml(f.name)}" loading="lazy"></a><figcaption>${escapeHtml(f.name)}</figcaption></figure>`,
      )
      .join("");
    panes.push(
      `<details open><summary>Plots<span class="count">${images.length}</span></summary><div class="pane"><div class="plots">${figs}</div></div></details>`,
    );
  }
  if (c.files.length > 0) {
    panes.push(
      `<details><summary>Files<span class="count">${c.files.length}</span></summary><div class="pane">${renderFiles(c.files)}</div></details>`,
    );
  }
  if (panes.length === 0) return "";
  return `<div class="artifacts">${panes.join("")}</div>`;
}

function statusNote(entry: ExportEntry): string {
  switch (entry.status) {
    case "rejected":
      return `<div class="status-note rejected"><strong>Rejected.</strong> This step was rejected, by a verifier or because its computation failed. It is kept as part of the record; the solver could not build on it.</div>`;
    case "superseded":
      return `<div class="status-note superseded"><strong>Superseded.</strong> A later correction replaced this step. It is kept as part of the record; the solver could no longer build on it.</div>`;
    case "pending":
      return `<div class="status-note pending"><strong>Pending.</strong> This step had not been accepted or rejected when the export was made.</div>`;
    default:
      return "";
  }
}

function renderVerification(entry: ExportEntry, ctx: RenderContext): string[] {
  const v = entry.verification;
  if (!v) return [];
  const out: string[] = [];
  if (v.verdict) {
    const good = v.verdict === "accepted" || v.verdict === "verified";
    out.push(
      `<div class="verdict">${pill(good ? "accepted" : "rejected", v.verdict)}${v.method ? `<span>method: <span class="mono">${escapeHtml(v.method)}</span></span>` : ""}${
        v.targetEntryId ? `<span>target: ${entryLink(v.targetEntryId, ctx)}</span>` : ""
      }</div>`,
    );
  }
  if (v.focus) out.push(section("Focus", plain(v.focus)));
  if (v.candidateAnswer) out.push(section("Candidate answer", `<div class="markdown-body">${ctx.md(v.candidateAnswer)}</div>`));
  if (v.justification) out.push(section("Justification", `<div class="markdown-body">${ctx.md(v.justification)}</div>`));
  if (v.counterExample) out.push(section("Counter-example", `<div class="markdown-body">${ctx.md(v.counterExample)}</div>`));
  if (v.issues && v.issues.length > 0) {
    const items = v.issues
      .map(
        (i) =>
          `<li>${i.entryId ? `${entryLink(i.entryId, ctx)} ` : ""}<div class="markdown-body">${ctx.md(i.problem)}</div>${
            i.requiredCorrection ? `<div class="markdown-body" style="margin-top:4px"><em>Required correction:</em> ${ctx.md(i.requiredCorrection)}</div>` : ""
          }</li>`,
      )
      .join("");
    out.push(section("Issues", `<ol style="margin:0;padding-left:1.4em;display:flex;flex-direction:column;gap:8px">${items}</ol>`));
  }
  return out;
}

function entryLink(id: string, ctx: RenderContext): string {
  if (!ctx.known.has(id)) {
    return `<span class="chip-link missing" title="${escapeHtml(id)}">${escapeHtml(shortId(id))}</span>`;
  }
  return `<a class="chip-link" href="#${escapeHtml(id)}" title="${escapeHtml(id)}">step ${ctx.indexOf.get(id)} · ${escapeHtml(shortId(id))}</a>`;
}

function renderEntry(entry: ExportEntry, index: number, ctx: RenderContext): string {
  const inactive = entry.status === "rejected" || entry.status === "superseded";
  const isFinal = entry.type === "final_answer";
  const classes = ["card", inactive ? "inactive" : "", isFinal ? "final" : ""].filter(Boolean).join(" ");
  const c = entry.computation;

  const meta: string[] = [];
  if (entry.reasoningSpeed === "fast") meta.push(`<span class="fast" title="Produced in fast mode">Fast</span>`);
  if (c?.durationMs !== undefined) meta.push(`<span class="duration">${escapeHtml(formatDuration(c.durationMs))}</span>`);
  meta.push(`<span class="ts">${escapeHtml(formatDate(entry.createdAt))}</span>`);
  meta.push(CHEVRON_SVG);

  const body: string[] = [];
  const note = statusNote(entry);
  if (note) body.push(note);

  if (c?.task) body.push(section("Task", `<div class="markdown-body">${ctx.md(c.task)}</div>`));
  if (entry.body) body.push(`<div class="markdown-body">${ctx.md(entry.body)}</div>`);
  else if (!c && !entry.verification && !entry.finalAnswer) body.push(`<p class="empty">No additional details.</p>`);

  if (entry.finalAnswer && entry.finalAnswer !== entry.body) {
    body.push(`<div class="final-answer"><span class="label">Final answer</span><div class="markdown-body">${ctx.md(entry.finalAnswer)}</div></div>`);
  }
  if (c?.result) body.push(section("Result", `<div class="markdown-body">${ctx.md(c.result)}</div>`));
  if (c?.error) body.push(section("Error", codeBlock(c.error, "", "stderr")));
  body.push(...renderVerification(entry, ctx));

  if (entry.dependsOn.length > 0) {
    body.push(section("Depends on", `<div class="chips-row">${entry.dependsOn.map((id) => entryLink(id, ctx)).join("")}</div>`));
  }
  const artifacts = renderArtifacts(entry);
  if (artifacts) body.push(section("Artifacts", artifacts));
  if (entry.extraDetails) {
    body.push(section("Other details", codeBlock(JSON.stringify(entry.extraDetails, null, 2), "")));
  }

  const footer: string[] = [`<span>id <span class="mono">${escapeHtml(entry.id)}</span></span>`];
  if (entry.models.length > 0) footer.push(`<span>model <span class="mono">${entry.models.map(escapeHtml).join(", ")}</span></span>`);
  if (c?.status) footer.push(`<span>sub-agent status <span class="mono">${escapeHtml(c.status)}</span></span>`);
  body.push(`<div class="entry-footer">${footer.join("")}</div>`);

  return `<details class="${classes}" id="${escapeHtml(entry.id)}" style="--accent-type: var(${TYPE_VAR[entry.type]})"${isFinal ? " open" : ""}>
  <summary>
    <span class="accent" aria-hidden="true"></span>
    <span class="head">${typeBadge(entry.type)}${pill(entry.status, STATUS_LABELS[entry.status])}<span class="tool">${escapeHtml(TOOL_LABELS[entry.tool])}</span></span>
    <span class="summary" title="Step ${index}">${escapeHtml(entry.summary)}</span>
    <span class="meta">${meta.join("")}</span>
  </summary>
  <div class="body">
${body.join("\n")}
  </div>
</details>`;
}

function overview(doc: ExportDocument): string {
  const h = doc.header;
  const cells: string[] = [];
  cells.push(
    `<div><span class="label">Status</span><div class="value">${pill(h.ledgerStatus)}</div></div>`,
  );
  cells.push(
    `<div><span class="label">Session</span><div class="chips"><span class="chip">speed: ${escapeHtml(h.reasoningSpeed)}</span><span class="chip">${doc.entries.length} steps</span><span class="chip">${doc.messages.length} messages</span>${h.enabledTools
      .map((t) => `<span class="chip accent">${escapeHtml(t)}</span>`)
      .join("")}</div></div>`,
  );
  cells.push(
    `<div><span class="label">Created</span><div class="value">${escapeHtml(formatDate(h.createdAt))}</div></div>`,
  );
  cells.push(
    `<div><span class="label">Exported</span><div class="value">${escapeHtml(formatDate(h.exportedAt))} · Solver Agent ${escapeHtml(h.solverAgentVersion)}</div></div>`,
  );
  if (h.models.length > 0) {
    const rows = h.models
      .map(
        (m) =>
          `<div><span class="role">${escapeHtml(ROLE_LABELS[m.role])}</span> · <span class="model mono">${escapeHtml(m.model)}</span> <span class="role">(${m.calls} calls)</span></div>`,
      )
      .join("");
    cells.push(`<div><span class="label">Models</span><div class="models">${rows}</div></div>`);
  }
  cells.push(
    `<div><span class="label">Bundle</span><div class="chips"><a class="chip" href="report.tex">report.tex</a><a class="chip" href="ledger.json">ledger.json</a></div></div>`,
  );
  return `<section class="overview">${cells.join("")}</section>`;
}

export function renderHtml(doc: ExportDocument): string {
  const files = new Map<string, string>();
  for (const e of doc.entries) {
    for (const f of e.computation?.files ?? []) {
      if (f.fileId && !f.skipped && f.path) files.set(f.fileId, f.path);
    }
  }
  const known = new Set(doc.entries.map((e) => e.id));
  const indexOf = new Map(doc.entries.map((e, i) => [e.id, i + 1]));
  const ctx: RenderContext = {
    md: (text) => markdownToHtml(text, { resolveFile: (id) => files.get(id) }),
    known,
    indexOf,
  };

  const items: TimelineItem[] = [
    ...doc.messages.map((m): TimelineItem => ({ kind: "message", ts: Date.parse(m.createdAt) || 0, message: m })),
    ...doc.entries.map((e, i): TimelineItem => ({ kind: "entry", ts: Date.parse(e.createdAt) || 0, entry: e, index: i + 1 })),
  ];
  items.sort((a, b) => a.ts - b.ts);

  // When the transcript is empty (older sessions / forks), show the prompts
  // so the page still reads as a conversation.
  const timeline =
    items.length > 0
      ? items.map((it) => (it.kind === "message" ? renderMessage(it.message, ctx) : renderEntry(it.entry, it.index, ctx)))
      : doc.prompts.map((p) =>
          renderMessage(
            { id: `prompt-${p.index}`, role: "user", createdAt: p.createdAt, content: p.content, relatedEntries: [] },
            ctx,
          ),
        );

  const h = doc.header;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Solver Agent ${escapeHtml(h.solverAgentVersion)}">
<title>${escapeHtml(h.title)} · Solver Agent</title>
<style>${katexCssInline()}</style>
<style>${pageCss()}</style>
</head>
<body>
<header class="topbar"><div class="topbar-inner">
  <h1 title="${escapeHtml(h.title)}">${escapeHtml(h.title)}</h1>
  ${pill(h.ledgerStatus)}
  <div class="actions">
    <button type="button" class="btn" id="expand-all">Expand all</button>
    <button type="button" class="btn" id="collapse-all">Collapse all</button>
    <button type="button" class="btn" id="theme-toggle">Dark theme</button>
  </div>
</div></header>
<main class="page">
${overview(doc)}
<div class="timeline">
${timeline.join("\n")}
</div>
<footer class="footer">
  <span>Exported ${escapeHtml(formatDate(h.exportedAt))} by Solver Agent ${escapeHtml(h.solverAgentVersion)}. Conversation <span class="mono">${escapeHtml(h.conversationId)}</span>, ledger <span class="mono">${escapeHtml(h.ledgerId)}</span>.</span>
  <span>System prompts SHA-256 <span class="mono">${escapeHtml(h.promptsSha256)}</span> (per-prompt hashes in <span class="mono">ledger.json</span>; recompute from <span class="mono">backend/src/agents/systemPrompts.ts</span> to verify).</span>
  <span>Figures and files are loaded from the <span class="mono">artifacts/</span> and <span class="mono">code/</span> folders of the bundle; keep this file next to them.</span>
</footer>
</main>
<script>${pageScript()}</script>
</body>
</html>
`;
}
