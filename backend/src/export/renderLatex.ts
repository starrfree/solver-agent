/**
 * Render an `ExportDocument` as a self-contained LaTeX source. Compiles with
 * pdfLaTeX, XeLaTeX or LuaLaTeX; artifacts are referenced by their relative
 * path inside the bundle, so `report.tex` must be compiled from the bundle
 * root (or the whole bundle uploaded to Overleaf as is).
 *
 * Layout: every ledger entry is a coloured header card (type colour, badges,
 * meta table) followed by first-level block cards for code, output, result,
 * verdict and figures. Blocks are never nested inside another breakable box:
 * tcolorbox cannot page-break a box inside a box, and code listings are the
 * one thing guaranteed to be long.
 */
import type { LedgerEntryStatus, LedgerEntryType } from "../db/types";
import {
  formatDate,
  formatDuration,
  ROLE_LABELS,
  STATUS_LABELS,
  TOOL_LABELS,
  TYPE_LABELS,
} from "./labels";
import { escapeLatex, markdownToLatex, verbatimBlock } from "./markdownToLatex";
import { STATUS_COLOR_HEX, TYPE_COLOR_HEX, UI_COLOR_HEX } from "./palette";
import type { ExportDocument, ExportEntry, ExportFile } from "./types";

const TYPE_COLORS: Record<LedgerEntryType, string> = {
  assumption: "typeAssumption",
  derivation: "typeDerivation",
  result: "typeResult",
  symbolic_computation: "typeSymbolic",
  numerical_computation: "typeNumerical",
  cy_analyst_computation: "typeCy",
  reference_lookup: "typeReference",
  verification: "typeVerification",
  correction: "typeCorrection",
  final_answer: "typeFinal",
  problem_followup: "typeFollowup",
};

const STATUS_COLORS: Record<LedgerEntryStatus, string> = {
  pending: "statusPending",
  accepted: "statusAccepted",
  rejected: "statusRejected",
  superseded: "statusSuperseded",
};

/** `\definecolor` lines for every named colour used in the preamble. */
function paletteDefinitions(): string {
  const hex = (h: string) => h.replace("#", "").toUpperCase();
  const lines: string[] = [];
  const add = (name: string, h: string) => lines.push(`\\definecolor{${name}}{HTML}{${hex(h)}}`);
  add("accent", UI_COLOR_HEX.accent);
  add("ink", UI_COLOR_HEX.ink);
  add("muted", UI_COLOR_HEX.muted);
  add("surface", UI_COLOR_HEX.surface);
  add("surfaceDeep", UI_COLOR_HEX.surfaceDeep);
  add("ruleGray", UI_COLOR_HEX.rule);
  add("codeBg", UI_COLOR_HEX.codeBg);
  add("badgeGray", UI_COLOR_HEX.muted);
  for (const [type, name] of Object.entries(TYPE_COLORS) as [LedgerEntryType, string][]) {
    add(name, TYPE_COLOR_HEX[type]);
  }
  for (const [status, name] of Object.entries(STATUS_COLORS) as [LedgerEntryStatus, string][]) {
    add(name, STATUS_COLOR_HEX[status]);
  }
  add("verdictGood", STATUS_COLOR_HEX.accepted);
  add("verdictBad", STATUS_COLOR_HEX.rejected);
  add("pyKeyword", TYPE_COLOR_HEX.derivation);
  add("pyBuiltin", TYPE_COLOR_HEX.cy_analyst_computation);
  add("pyString", TYPE_COLOR_HEX.numerical_computation);
  add("pyComment", UI_COLOR_HEX.subtle);
  add("pyNumber", TYPE_COLOR_HEX.verification);
  add("pyDecorator", TYPE_COLOR_HEX.result);
  add("pyName", TYPE_COLOR_HEX.symbolic_computation);
  return lines.join("\n");
}

/** Characters models commonly emit that pdfLaTeX's utf8 inputenc lacks. */
const UNICODE_FALLBACKS: [string, string][] = [
  ["2192", "\\ensuremath{\\rightarrow}"],
  ["2190", "\\ensuremath{\\leftarrow}"],
  ["21D2", "\\ensuremath{\\Rightarrow}"],
  ["21D4", "\\ensuremath{\\Leftrightarrow}"],
  ["2264", "\\ensuremath{\\leq}"],
  ["2265", "\\ensuremath{\\geq}"],
  ["2260", "\\ensuremath{\\neq}"],
  ["2248", "\\ensuremath{\\approx}"],
  ["2261", "\\ensuremath{\\equiv}"],
  ["221A", "\\ensuremath{\\surd}"],
  ["221E", "\\ensuremath{\\infty}"],
  ["2212", "\\ensuremath{-}"],
  ["2208", "\\ensuremath{\\in}"],
  ["2209", "\\ensuremath{\\notin}"],
  ["2211", "\\ensuremath{\\sum}"],
  ["220F", "\\ensuremath{\\prod}"],
  ["222B", "\\ensuremath{\\int}"],
  ["2202", "\\ensuremath{\\partial}"],
  ["2207", "\\ensuremath{\\nabla}"],
  ["2200", "\\ensuremath{\\forall}"],
  ["2203", "\\ensuremath{\\exists}"],
  ["2205", "\\ensuremath{\\emptyset}"],
  ["2229", "\\ensuremath{\\cap}"],
  ["222A", "\\ensuremath{\\cup}"],
  ["2282", "\\ensuremath{\\subset}"],
  ["2286", "\\ensuremath{\\subseteq}"],
  ["22C5", "\\ensuremath{\\cdot}"],
  ["2217", "\\ensuremath{\\ast}"],
  ["2713", "\\ensuremath{\\checkmark}"],
  ["2714", "\\ensuremath{\\checkmark}"],
  ["2717", "\\ensuremath{\\times}"],
  ["2718", "\\ensuremath{\\times}"],
  ["2022", "\\textbullet{}"],
  ["25CF", "\\textbullet{}"],
  ["2026", "\\ldots{}"],
  ["2032", "\\ensuremath{'}"],
  ["03B1", "\\ensuremath{\\alpha}"],
  ["03B2", "\\ensuremath{\\beta}"],
  ["03B3", "\\ensuremath{\\gamma}"],
  ["03B4", "\\ensuremath{\\delta}"],
  ["03B5", "\\ensuremath{\\varepsilon}"],
  ["03B6", "\\ensuremath{\\zeta}"],
  ["03B7", "\\ensuremath{\\eta}"],
  ["03B8", "\\ensuremath{\\theta}"],
  ["03B9", "\\ensuremath{\\iota}"],
  ["03BA", "\\ensuremath{\\kappa}"],
  ["03BB", "\\ensuremath{\\lambda}"],
  ["03BC", "\\ensuremath{\\mu}"],
  ["03BD", "\\ensuremath{\\nu}"],
  ["03BE", "\\ensuremath{\\xi}"],
  ["03C0", "\\ensuremath{\\pi}"],
  ["03C1", "\\ensuremath{\\rho}"],
  ["03C3", "\\ensuremath{\\sigma}"],
  ["03C4", "\\ensuremath{\\tau}"],
  ["03C6", "\\ensuremath{\\varphi}"],
  ["03C7", "\\ensuremath{\\chi}"],
  ["03C8", "\\ensuremath{\\psi}"],
  ["03C9", "\\ensuremath{\\omega}"],
  ["0393", "\\ensuremath{\\Gamma}"],
  ["0394", "\\ensuremath{\\Delta}"],
  ["0398", "\\ensuremath{\\Theta}"],
  ["039B", "\\ensuremath{\\Lambda}"],
  ["03A0", "\\ensuremath{\\Pi}"],
  ["03A3", "\\ensuremath{\\Sigma}"],
  ["03A6", "\\ensuremath{\\Phi}"],
  ["03A8", "\\ensuremath{\\Psi}"],
  ["03A9", "\\ensuremath{\\Omega}"],
  ["2070", "\\textsuperscript{0}"],
  ["2074", "\\textsuperscript{4}"],
  ["2075", "\\textsuperscript{5}"],
  ["2076", "\\textsuperscript{6}"],
  ["2077", "\\textsuperscript{7}"],
  ["2078", "\\textsuperscript{8}"],
  ["2079", "\\textsuperscript{9}"],
  ["207F", "\\textsuperscript{n}"],
  ["2080", "\\textsubscript{0}"],
  ["2081", "\\textsubscript{1}"],
  ["2082", "\\textsubscript{2}"],
  ["2083", "\\textsubscript{3}"],
  ["2084", "\\textsubscript{4}"],
  ["1D62", "\\textsubscript{i}"],
  ["207A", "\\textsuperscript{+}"],
  ["207B", "\\textsuperscript{-}"],
  ["03BF", "o"],
  ["03C2", "\\ensuremath{\\varsigma}"],
  ["03C5", "\\ensuremath{\\upsilon}"],
  ["03D1", "\\ensuremath{\\vartheta}"],
  ["03D5", "\\ensuremath{\\phi}"],
  ["03F5", "\\ensuremath{\\epsilon}"],
  ["0391", "A"],
  ["0392", "B"],
  ["0395", "E"],
  ["0396", "Z"],
  ["0397", "H"],
  ["0399", "I"],
  ["039A", "K"],
  ["039C", "M"],
  ["039D", "N"],
  ["039E", "\\ensuremath{\\Xi}"],
  ["039F", "O"],
  ["03A1", "P"],
  ["03A4", "T"],
  ["03A5", "\\ensuremath{\\Upsilon}"],
  ["03A7", "X"],
  ["2206", "\\ensuremath{\\Delta}"],
  ["2113", "\\ensuremath{\\ell}"],
  ["210F", "\\ensuremath{\\hbar}"],
  ["2115", "\\ensuremath{\\mathbb{N}}"],
  ["211A", "\\ensuremath{\\mathbb{Q}}"],
  ["211D", "\\ensuremath{\\mathbb{R}}"],
  ["2124", "\\ensuremath{\\mathbb{Z}}"],
  ["2102", "\\ensuremath{\\mathbb{C}}"],
  ["2016", "\\ensuremath{\\|}"],
  ["2033", "\\ensuremath{''}"],
  ["2213", "\\ensuremath{\\mp}"],
  ["2216", "\\ensuremath{\\setminus}"],
  ["2218", "\\ensuremath{\\circ}"],
  ["221B", "\\ensuremath{\\sqrt[3]{}}"],
  ["221D", "\\ensuremath{\\propto}"],
  ["2220", "\\ensuremath{\\angle}"],
  ["2225", "\\ensuremath{\\parallel}"],
  ["2227", "\\ensuremath{\\wedge}"],
  ["2228", "\\ensuremath{\\vee}"],
  ["222C", "\\ensuremath{\\iint}"],
  ["222E", "\\ensuremath{\\oint}"],
  ["2234", "\\ensuremath{\\therefore}"],
  ["2235", "\\ensuremath{\\because}"],
  ["223C", "\\ensuremath{\\sim}"],
  ["2243", "\\ensuremath{\\simeq}"],
  ["2245", "\\ensuremath{\\cong}"],
  ["2254", "\\ensuremath{:=}"],
  ["226A", "\\ensuremath{\\ll}"],
  ["226B", "\\ensuremath{\\gg}"],
  ["2283", "\\ensuremath{\\supset}"],
  ["2287", "\\ensuremath{\\supseteq}"],
  ["228A", "\\ensuremath{\\subsetneq}"],
  ["220B", "\\ensuremath{\\ni}"],
  ["2295", "\\ensuremath{\\oplus}"],
  ["2297", "\\ensuremath{\\otimes}"],
  ["22A2", "\\ensuremath{\\vdash}"],
  ["22A5", "\\ensuremath{\\perp}"],
  ["22A8", "\\ensuremath{\\models}"],
  ["22EF", "\\ensuremath{\\cdots}"],
  ["21A6", "\\ensuremath{\\mapsto}"],
  ["27E8", "\\ensuremath{\\langle}"],
  ["27E9", "\\ensuremath{\\rangle}"],
  ["27F6", "\\ensuremath{\\longrightarrow}"],
  ["25A1", "\\ensuremath{\\square}"],
  ["2605", "\\ensuremath{\\star}"],
  ["2010", "-"],
  ["2011", "-"],
  ["2119", "\\ensuremath{\\mathbb{P}}"],
  ["210D", "\\ensuremath{\\mathbb{H}}"],
  ["1D53D", "\\ensuremath{\\mathbb{F}}"],
  ["1D542", "\\ensuremath{\\mathbb{K}}"],
  ["0302", "\\textasciicircum{}"],
  ["2085", "\\textsubscript{5}"],
  ["2086", "\\textsubscript{6}"],
  ["2087", "\\textsubscript{7}"],
  ["2088", "\\textsubscript{8}"],
  ["2089", "\\textsubscript{9}"],
  ["208A", "\\textsubscript{+}"],
  ["208B", "\\textsubscript{-}"],
  ["208C", "\\textsubscript{=}"],
  ["208D", "\\textsubscript{(}"],
  ["208E", "\\textsubscript{)}"],
  ["2090", "\\textsubscript{a}"],
  ["2091", "\\textsubscript{e}"],
  ["2092", "\\textsubscript{o}"],
  ["2093", "\\textsubscript{x}"],
  ["2095", "\\textsubscript{h}"],
  ["2096", "\\textsubscript{k}"],
  ["2097", "\\textsubscript{l}"],
  ["2098", "\\textsubscript{m}"],
  ["2099", "\\textsubscript{n}"],
  ["209A", "\\textsubscript{p}"],
  ["209B", "\\textsubscript{s}"],
  ["209C", "\\textsubscript{t}"],
  ["1D63", "\\textsubscript{r}"],
  ["1D64", "\\textsubscript{u}"],
  ["1D65", "\\textsubscript{v}"],
  ["2C7C", "\\textsubscript{j}"],
  ["2071", "\\textsuperscript{i}"],
  ["207D", "\\textsuperscript{(}"],
  ["207E", "\\textsuperscript{)}"],
  ["1D40", "\\textsuperscript{T}"],
  ["1D43", "\\textsuperscript{a}"],
  ["1D47", "\\textsuperscript{b}"],
  ["1D9C", "\\textsuperscript{c}"],
  ["1D48", "\\textsuperscript{d}"],
  ["1D49", "\\textsuperscript{e}"],
  ["1DA0", "\\textsuperscript{f}"],
  ["1D4D", "\\textsuperscript{g}"],
  ["02B0", "\\textsuperscript{h}"],
  ["02B2", "\\textsuperscript{j}"],
  ["1D4F", "\\textsuperscript{k}"],
  ["02E1", "\\textsuperscript{l}"],
  ["1D50", "\\textsuperscript{m}"],
  ["1D52", "\\textsuperscript{o}"],
  ["1D56", "\\textsuperscript{p}"],
  ["02B3", "\\textsuperscript{r}"],
  ["02E2", "\\textsuperscript{s}"],
  ["1D57", "\\textsuperscript{t}"],
  ["1D58", "\\textsuperscript{u}"],
  ["1D5B", "\\textsuperscript{v}"],
  ["02B7", "\\textsuperscript{w}"],
  ["02E3", "\\textsuperscript{x}"],
  ["02B8", "\\textsuperscript{y}"],
  ["1DBB", "\\textsuperscript{z}"],
  ["2099", "\\textsubscript{n}"],
  ["2115", "\\ensuremath{\\mathbb{N}}"],
  ["2124", "\\ensuremath{\\mathbb{Z}}"],
  ["211A", "\\ensuremath{\\mathbb{Q}}"],
  ["211D", "\\ensuremath{\\mathbb{R}}"],
  ["2102", "\\ensuremath{\\mathbb{C}}"],
];

function preamble(): string {
  const fallbacks = UNICODE_FALLBACKS.map(
    ([cp, tex]) => `  \\DeclareUnicodeCharacter{${cp}}{${tex}}`,
  ).join("\n");

  return String.raw`% Generated by Solver Agent. Compile from the bundle root, e.g.
%   latexmk -pdf report.tex        (pdfLaTeX)
%   latexmk -xelatex report.tex    (XeLaTeX; use this if the run produced
%                                   characters pdfLaTeX complains about)
%
% The math in this file is the models' own LaTeX, reproduced verbatim. It may
% use a macro that does not exist (the app shows the same span as a KaTeX
% error), so the compiler is told to carry on past errors and produce the PDF;
% grep the .log for "Undefined control sequence" to see what needs a manual
% \newcommand. Remove the next line to get the interactive error prompt back.
\nonstopmode
\documentclass[11pt,a4paper]{article}

% --- encoding / fonts: pdfLaTeX, XeLaTeX and LuaLaTeX -----------------------
\usepackage{iftex}
\ifPDFTeX
  \usepackage[utf8]{inputenc}
  \usepackage[T1]{fontenc}
  \usepackage{lmodern}
  \usepackage{textcomp}
${fallbacks}
\else
  \usepackage{fontspec}
  \IfFontExistsTF{DejaVu Sans Mono}{\setmonofont{DejaVu Sans Mono}[Scale=MatchLowercase]}{}
\fi

\usepackage[margin=2.1cm]{geometry}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{mathtools,mathrsfs,bm,cancel}
\usepackage{graphicx}
\usepackage{float}
\usepackage{caption}
\usepackage[table]{xcolor}
\usepackage{longtable}
\usepackage{booktabs}
\usepackage{array}
\usepackage{tabularx}
\usepackage{fvextra}
\usepackage[most]{tcolorbox}
\usepackage{ulem}
\normalem
\usepackage{enumitem}
\usepackage{parskip}
\usepackage{microtype}
\usepackage{titlesec}
\usepackage{needspace}
\usepackage[colorlinks,linkcolor=accent,urlcolor=accent,citecolor=accent,breaklinks]{hyperref}
\usepackage{xurl}

\setlength{\emergencystretch}{3em}
\setlist{nosep}
\setcounter{secnumdepth}{2}
\setcounter{tocdepth}{1}
\captionsetup{font=small,labelfont=bf}

% --- palette (mirrors the web UI's light theme) --------------------------------
${paletteDefinitions()}

% --- typography -----------------------------------------------------------------
\color{ink}
\titleformat{\section}{\sffamily\LARGE\bfseries\color{ink}}{\textcolor{accent}{\thesection}}{0.7em}{}[{\color{surfaceDeep}\titlerule[1pt]}]
\titleformat{\subsection}{\sffamily\large\bfseries\color{ink}}{\textcolor{accent}{\thesubsection}}{0.7em}{}
\titleformat{\subsubsection}{\sffamily\normalsize\bfseries\color{ink}}{\thesubsubsection}{0.7em}{}
\titlespacing*{\section}{0pt}{2.2em}{1.2em}
\titlespacing*{\subsection}{0pt}{1.6em}{0.6em}
\renewcommand{\contentsname}{Contents}

% Python highlighting macros used inside Verbatim blocks with commandchars.
\newcommand{\PYk}[1]{\textcolor{pyKeyword}{\bfseries #1}}
\newcommand{\PYb}[1]{\textcolor{pyBuiltin}{#1}}
\newcommand{\PYs}[1]{\textcolor{pyString}{#1}}
\newcommand{\PYc}[1]{\textcolor{pyComment}{\itshape #1}}
\newcommand{\PYn}[1]{\textcolor{pyNumber}{#1}}
\newcommand{\PYd}[1]{\textcolor{pyDecorator}{#1}}
\newcommand{\PYf}[1]{\textcolor{pyName}{\bfseries #1}}

% --- badges, labels, references ---------------------------------------------------
% Soft badges: a light tint of the colour behind dark text of the same hue.
\newcommand{\badge}[2]{\tikz[baseline=(b.base)]\node[fill=#1!14!white,text=#1!75!black,rounded corners=2.2pt,inner xsep=4pt,inner ysep=1.6pt,font=\sffamily\bfseries\scriptsize](b){\strut #2};}
\newcommand{\badgeoutline}[2]{\tikz[baseline=(b.base)]\node[draw=#1!60!white,text=#1!75!black,rounded corners=2.2pt,inner xsep=4pt,inner ysep=1.4pt,font=\sffamily\bfseries\scriptsize](b){\strut #2};}
\newcommand{\eyebrowfont}{\sffamily\bfseries\scriptsize\color{muted}}
\newcommand{\eyebrow}[1]{{\eyebrowfont\MakeUppercase{#1}}}
\newcommand{\entryid}[1]{\texttt{\footnotesize #1}}
\newcommand{\entryref}[1]{\hyperref[entry:#1]{\texttt{\footnotesize\detokenize{#1}}}}
\newcommand{\mono}[1]{\texttt{#1}}
\newenvironment{mdquote}{\begin{quote}\color{ink!85}}{\end{quote}}

% Key/value meta table used inside header cards.
\newenvironment{metatable}{\begin{tabular}{@{}>{\eyebrowfont}r@{\hspace{1.2em}}p{0.76\linewidth}@{}}}{\end{tabular}}

% --- cards ------------------------------------------------------------------------
\tcbset{
  cardbase/.style={enhanced, breakable, boxrule=0.5pt, arc=2.4mm, left=3.2mm, right=3.2mm, top=2.2mm, bottom=2.2mm, before skip=3mm, after skip=3mm, fonttitle=\sffamily\bfseries\small, toptitle=1.3mm, bottomtitle=1.3mm, drop fuzzy shadow=surfaceDeep},
  headercard/.style={cardbase, colback=white, colframe=#1!40!white, colbacktitle=#1!12!white, coltitle=#1!70!black, after skip=1.5mm, borderline west={2.5pt}{0pt}{#1!80!white}},
  blockcard/.style={cardbase, colback=#1!3!white, colframe=#1!30!white, colbacktitle=#1!9!white, coltitle=#1!65!black, fonttitle=\sffamily\bfseries\scriptsize, toptitle=0.9mm, bottomtitle=0.9mm, before skip=1.5mm, after skip=1.5mm, drop fuzzy shadow=surface},
  codecard/.style={blockcard=badgeGray, colback=codeBg, colframe=ruleGray, colbacktitle=surface, coltitle=muted},
  promptcard/.style={cardbase, colback=accent!2!white, colframe=accent!35!white, colbacktitle=accent!10!white, coltitle=accent!70!black},
  titlecard/.style={enhanced, colback=accent!4!white, colframe=accent!4!white, arc=3.5mm, left=7mm, right=7mm, top=7mm, bottom=7mm, boxrule=0pt, drop fuzzy shadow=surfaceDeep},
  notecard/.style={enhanced, breakable, boxrule=0pt, arc=1.6mm, left=3mm, right=3mm, top=1.6mm, bottom=1.6mm, before skip=1.5mm, after skip=1.5mm, colback=#1!7!white, borderline west={2.5pt}{0pt}{#1!70!white}},
  bodycard/.style={blanker, breakable, left=3.5mm, right=0mm, top=1mm, bottom=1mm, before skip=1mm, after skip=2mm, borderline west={2pt}{0pt}{#1!30!white}},
}
\newtcolorbox{codecard}{codecard}
`;
}

/** File id → bundle path for the document being rendered (set by `renderLatex`). */
let resolveFile: (fileId: string) => string | undefined = () => undefined;

function md(text: string): string {
  return markdownToLatex(text, { headingBase: "paragraph", resolveFile });
}

/**
 * Single-line model text (summaries, titles) that may contain math: rendered
 * through the same pipeline so `$...$` becomes real math instead of escaped
 * dollars, then flattened to one paragraph.
 */
function mdInline(text: string): string {
  return markdownToLatex(text.replace(/\s*\n\s*/g, " "), { headingBase: "paragraph", resolveFile }).replace(
    /\n{2,}/g,
    " ",
  );
}

function idLabel(id: string): string {
  return id.replace(/[^A-Za-z0-9:_-]/g, "-");
}

function entryRef(id: string): string {
  return `\\entryref{${idLabel(id)}}`;
}

function badge(color: string, text: string): string {
  return `\\badge{${color}}{${escapeLatex(text)}}`;
}

function models(entry: ExportEntry): string {
  return entry.models.map((m) => `\\mono{${escapeLatex(m)}}`).join(", ");
}

function metaRow(label: string, value: string): string {
  return `${escapeLatex(label.toUpperCase())} & ${value} \\\\`;
}

function blockCard(color: string, title: string, body: string, extra = ""): string {
  const opts = [`blockcard=${color}`, `title={${title}}`, extra].filter(Boolean).join(", ");
  return `\\begin{tcolorbox}[${opts}]\n${body}\n\\end{tcolorbox}`;
}

function codeCard(title: string, content: string, lang = ""): string {
  return `\\begin{tcolorbox}[codecard, title={${title}}]\n${verbatimBlock(content, lang)}\n\\end{tcolorbox}`;
}

function noteCard(color: string, body: string): string {
  return `\\begin{tcolorbox}[notecard=${color}]\n${body}\n\\end{tcolorbox}`;
}

function statusNote(entry: ExportEntry): string | null {
  if (entry.status === "rejected") {
    return noteCard(
      "statusRejected",
      "\\textcolor{statusRejected}{\\sffamily\\bfseries Rejected.} This entry was rejected, by a verifier or because its computation failed. It is kept as part of the record; the solver could not build on it.",
    );
  }
  if (entry.status === "superseded") {
    return noteCard(
      "statusSuperseded",
      "\\textcolor{statusSuperseded}{\\sffamily\\bfseries Superseded.} A later correction replaced this entry. It is kept as part of the record; the solver could no longer build on it.",
    );
  }
  if (entry.status === "pending") {
    return noteCard(
      "statusPending",
      "\\textcolor{muted}{\\sffamily\\bfseries Pending.} This entry had not been accepted or rejected when the export was made.",
    );
  }
  return null;
}

function renderFiles(files: ExportFile[]): string[] {
  const out: string[] = [];
  for (const f of files.filter((x) => x.isImage)) {
    out.push(
      [
        "\\begin{figure}[H]",
        "\\centering",
        `\\includegraphics[width=0.85\\linewidth,height=0.45\\textheight,keepaspectratio]{${f.path}}`,
        `\\caption*{\\mono{${escapeLatex(f.name)}} {\\color{muted}(${escapeLatex(f.mimeType)}, ${f.size} bytes)}}`,
        "\\end{figure}",
      ].join("\n"),
    );
  }
  const others = files.filter((x) => !x.isImage);
  if (others.length > 0) {
    const items = others.map((f) =>
      f.skipped
        ? `\\item \\mono{${escapeLatex(f.name)}} {\\color{muted}(${f.size} bytes)}: not included${f.reason ? `, ${escapeLatex(f.reason)}` : ""}`
        : `\\item \\mono{${escapeLatex(f.name)}} {\\color{muted}(${escapeLatex(f.mimeType)}, ${f.size} bytes)}: \\url{${f.path}}`,
    );
    out.push(
      blockCard("badgeGray", "Files", `\\begin{itemize}\n${items.join("\n")}\n\\end{itemize}`),
    );
  }
  return out;
}

function renderComputation(entry: ExportEntry): string[] {
  const c = entry.computation;
  if (!c) return [];
  const out: string[] = [];
  if (c.task) out.push(blockCard("typeDerivation", "Task given to the sub-agent", md(c.task)));
  if (c.code) {
    const where = c.codePath ? ` {\\mdseries\\color{muted}also in \\mono{${escapeLatex(c.codePath)}}}` : "";
    out.push(codeCard(`Code${where}`, c.code, c.codePath?.endsWith(".py") ? "python" : ""));
  }
  if (c.stdout) out.push(codeCard("Standard output", c.stdout));
  if (c.stderr) out.push(codeCard("Standard error", c.stderr));
  if (c.result) out.push(blockCard("typeResult", "Result returned to the solver", md(c.result)));
  if (c.error) out.push(codeCard("Error", c.error));
  out.push(...renderFiles(c.files));
  return out;
}

function renderVerification(entry: ExportEntry): string[] {
  const v = entry.verification;
  if (!v) return [];
  const good = v.verdict === "accepted" || v.verdict === "verified";
  const color = good ? "verdictGood" : "verdictBad";
  const parts: string[] = [];
  if (v.focus) parts.push(`\\eyebrow{Focus requested by the solver}\\par ${md(v.focus)}`);
  if (v.candidateAnswer) {
    parts.push(`\\eyebrow{Candidate answer under review}\\par ${md(v.candidateAnswer)}`);
  }
  if (v.justification) parts.push(`\\eyebrow{Justification}\\par ${md(v.justification)}`);
  if (v.counterExample) parts.push(`\\eyebrow{Counter-example}\\par ${md(v.counterExample)}`);
  if (v.issues && v.issues.length > 0) {
    const items = v.issues.map(
      (i) =>
        `\\item ${entryRef(i.entryId)}: ${md(i.problem)}\\par {\\color{muted}\\itshape Required correction:} ${md(i.requiredCorrection)}`,
    );
    parts.push(`\\eyebrow{Issues found}\n\\begin{itemize}\n${items.join("\n")}\n\\end{itemize}`);
  }
  const title = [
    `Verdict: ${escapeLatex(v.verdict ?? "unknown")}`,
    v.method ? `{\\mdseries method: ${escapeLatex(v.method)}}` : "",
  ]
    .filter(Boolean)
    .join(" \\quad ");
  return [blockCard(color, title, parts.join("\n\n\\medskip\n\n"), "fonttitle=\\sffamily\\bfseries\\small")];
}

function headerCard(entry: ExportEntry, index: number): string {
  const typeColor = TYPE_COLORS[entry.type];
  const inactive = entry.status === "rejected" || entry.status === "superseded";
  const title = `{\\large ${index}}\\quad ${escapeLatex(TYPE_LABELS[entry.type])}\\hfill\\entryid{${escapeLatex(entry.id)}}`;
  const opts = [
    `headercard=${typeColor}`,
    `title={${title}}`,
    inactive ? `colback=${STATUS_COLORS[entry.status]}!2!white` : "",
    inactive
      ? `watermark text={${STATUS_LABELS[entry.status].toUpperCase()}}, watermark color=${STATUS_COLORS[entry.status]}!9!white`
      : "",
  ]
    .filter(Boolean)
    .join(", ");

  const badges = [
    badge("badgeGray", TOOL_LABELS[entry.tool]),
    badge(STATUS_COLORS[entry.status], STATUS_LABELS[entry.status]),
    entry.reasoningSpeed ? badge("badgeGray", `speed: ${entry.reasoningSpeed}`) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const rows: string[] = [
    metaRow(
      "Depends on",
      entry.dependsOn.length > 0 ? entry.dependsOn.map(entryRef).join(", ") : "\\textcolor{muted}{nothing}",
    ),
  ];
  if (entry.models.length > 0) rows.push(metaRow("Model", models(entry)));
  if (entry.computation?.durationMs !== undefined) {
    rows.push(metaRow("Duration", escapeLatex(formatDuration(entry.computation.durationMs))));
  }
  if (entry.computation?.status) rows.push(metaRow("Sub-agent status", `\\mono{${escapeLatex(entry.computation.status)}}`));
  if (entry.verification?.targetEntryId) rows.push(metaRow("Target", entryRef(entry.verification.targetEntryId)));

  const body = [
    `\\noindent ${badges}\\hfill{\\footnotesize\\color{muted}${escapeLatex(formatDate(entry.createdAt))}}\\par\\smallskip`,
    `{\\color{ruleGray}\\hrule height 0.4pt}\\smallskip`,
    `\\begin{metatable}\n${rows.join("\n")}\n\\end{metatable}\\par\\smallskip`,
    `\\eyebrow{Summary}\\par{\\sffamily ${md(entry.summary)}}`,
  ].join("\n");

  return `\\begin{tcolorbox}[${opts}]\n${body}\n\\end{tcolorbox}`;
}

function renderEntry(entry: ExportEntry, index: number): string {
  const blocks: string[] = [];
  // \Needspace (not \needspace: its stretchable glue confuses breakable boxes)
  // keeps a header card from being orphaned at the bottom of a page.
  blocks.push(`\\Needspace{9\\baselineskip}\\phantomsection\\label{entry:${idLabel(entry.id)}}`);
  blocks.push(headerCard(entry, index));
  const note = statusNote(entry);
  if (note) blocks.push(note);
  if (entry.body) {
    blocks.push(
      `\\begin{tcolorbox}[bodycard=${TYPE_COLORS[entry.type]}]\n${md(entry.body)}\n\\end{tcolorbox}`,
    );
  }
  if (entry.finalAnswer && entry.finalAnswer !== entry.body) {
    blocks.push(blockCard("typeFinal", "Final answer", md(entry.finalAnswer), "fonttitle=\\sffamily\\bfseries\\small"));
  }
  blocks.push(...renderComputation(entry));
  blocks.push(...renderVerification(entry));
  if (entry.extraDetails) {
    blocks.push(codeCard("Other details", JSON.stringify(entry.extraDetails, null, 2)));
  }
  blocks.push("\\vspace{2mm}");
  return blocks.join("\n\n");
}

function overviewTable(doc: ExportDocument): string {
  const rows = doc.entries.map((e, i) => {
    const bg = e.status === "rejected" ? "statusRejected!4!white" : e.status === "superseded" ? "statusSuperseded!6!white" : i % 2 ? "surface" : "white";
    return `\\rowcolor{${bg}} \\hyperref[entry:${idLabel(e.id)}]{${i + 1}} & ${badge(TYPE_COLORS[e.type], TYPE_LABELS[e.type])} & ${badge(STATUS_COLORS[e.status], STATUS_LABELS[e.status])} & ${escapeLatex(TOOL_LABELS[e.tool])} & ${mdInline(e.summary)} \\\\`;
  });
  return [
    "\\begin{longtable}{@{}r l l l >{\\raggedright\\arraybackslash}p{0.5\\linewidth}@{}}",
    "\\toprule",
    "\\rowcolor{white} \\textbf{\\#} & \\textbf{Type} & \\textbf{Status} & \\textbf{Agent} & \\textbf{Summary} \\\\",
    "\\midrule",
    "\\endhead",
    ...rows,
    "\\bottomrule",
    "\\end{longtable}",
  ].join("\n");
}

function keyValueTable(rows: [string, string][]): string {
  return [
    "\\begin{tabularx}{\\linewidth}{@{}>{\\eyebrowfont}l X@{}}",
    ...rows.map(([k, v], i) => `${i % 2 ? "\\rowcolor{surface}" : ""} ${escapeLatex(k.toUpperCase())} & ${v} \\\\`),
    "\\end{tabularx}",
  ].join("\n");
}

export function renderLatex(doc: ExportDocument): string {
  const { header } = doc;
  const files = new Map<string, string>();
  for (const e of doc.entries) {
    for (const f of e.computation?.files ?? []) {
      if (f.fileId && !f.skipped && f.path) files.set(f.fileId, f.path);
    }
  }
  resolveFile = (id) => files.get(id);
  const counts = {
    accepted: doc.entries.filter((e) => e.status === "accepted").length,
    rejected: doc.entries.filter((e) => e.status === "rejected").length,
    superseded: doc.entries.filter((e) => e.status === "superseded").length,
  };
  const out: string[] = [preamble()];

  // Title block ---------------------------------------------------------
  out.push(
    "\\begin{document}",
    "\\pagestyle{plain}",
    "\\begin{tcolorbox}[titlecard]",
    "\\eyebrow{Solver Agent · session record}\\par\\medskip",
    `{\\sffamily\\bfseries\\Huge\\color{ink}${mdInline(header.title)}\\par}\\bigskip`,
    [
      badge("statusAccepted", `ledger: ${header.ledgerStatus}`),
      badge("badgeGray", `speed: ${header.reasoningSpeed}`),
      badge("badgeGray", `${doc.entries.length} entries`),
      ...header.enabledTools.map((t) => badge("accent", t)),
    ].join(" ") + "\\par\\medskip",
    `{\\small\\color{muted}Created ${escapeLatex(formatDate(header.createdAt))} \\quad Exported ${escapeLatex(formatDate(header.exportedAt))} \\quad Solver Agent ${escapeLatex(header.solverAgentVersion)}\\par}`,
    "\\end{tcolorbox}",
    "",
    "\\medskip\\noindent This document is a verbatim record of a Solver Agent session: every prompt, ledger entry, computation and verification verdict is reproduced exactly as it was stored, including rejected and superseded steps. Models' hidden reasoning is never stored and is therefore not part of the record.",
    "",
    "\\tableofcontents",
    "\\clearpage",
    "",
  );

  // 1. Header -------------------------------------------------------------
  out.push("\\section{Header}", "");
  out.push(
    keyValueTable([
      ["Title", mdInline(header.title)],
      ["Conversation id", `\\mono{${escapeLatex(header.conversationId)}}`],
      ["Ledger id", `\\mono{${escapeLatex(header.ledgerId)}}`],
      ["Created", escapeLatex(formatDate(header.createdAt))],
      ["Exported", escapeLatex(formatDate(header.exportedAt))],
      ["Ledger status", badge("statusAccepted", header.ledgerStatus)],
      ["Reasoning speed", badge("badgeGray", header.reasoningSpeed)],
      [
        "Enabled optional tools",
        header.enabledTools.length > 0
          ? header.enabledTools.map((t) => badge("accent", t)).join(" ")
          : "{\\color{muted}none}",
      ],
      [
        "Entries",
        `${doc.entries.length} total: ${counts.accepted} accepted, ${counts.rejected} rejected, ${counts.superseded} superseded`,
      ],
      ["System prompts SHA-256", `\\mono{\\scriptsize ${escapeLatex(header.promptsSha256)}}`],
      ["Solver Agent version", escapeLatex(header.solverAgentVersion)],
    ]),
    "",
  );
  out.push("\\subsection{Models per role}", "");
  if (header.models.length === 0) {
    out.push("{\\color{muted}No LLM calls were recorded for this conversation.}", "");
  } else {
    out.push(
      "\\begin{longtable}{@{}llr@{}}",
      "\\toprule",
      "\\textbf{Role} & \\textbf{Model} & \\textbf{Calls} \\\\",
      "\\midrule",
      "\\endhead",
      ...header.models.map(
        (m, i) =>
          `${i % 2 ? "\\rowcolor{surface}" : ""} ${escapeLatex(ROLE_LABELS[m.role])} & \\mono{${escapeLatex(m.model)}} & ${m.calls} \\\\`,
      ),
      "\\bottomrule",
      "\\end{longtable}",
      "",
    );
  }
  out.push("\\subsection{System prompt hashes}", "");
  out.push(
    "\\begin{longtable}{@{}>{\\raggedright\\arraybackslash}p{0.36\\linewidth}>{\\raggedright\\arraybackslash}p{0.6\\linewidth}@{}}",
    "\\toprule",
    "\\textbf{Prompt} & \\textbf{SHA-256} \\\\",
    "\\midrule",
    "\\endhead",
    ...doc.systemPrompts.map(
      (p, i) =>
        `${i % 2 ? "\\rowcolor{surface}" : ""} ${escapeLatex(p.label)}\\newline{\\scriptsize\\color{muted}\\mono{${escapeLatex(p.name)}}} & \\mono{\\scriptsize ${escapeLatex(p.sha256)}} \\\\`,
    ),
    "\\bottomrule",
    "\\end{longtable}",
    "",
    "Each hash is the SHA-256 of the exact prompt text shipped in \\mono{backend/src/agents/systemPrompts.ts} at the Solver Agent version above; recompute it from the repository to verify that the run used the published prompts. Opt-in tool prompts are listed only when the tool was enabled.",
    "",
  );

  // 2. Prompts ------------------------------------------------------------
  out.push("\\section{Prompts}", "");
  out.push(
    "The problem statement and every follow-up, verbatim and in order. Follow-ups pause the solver and are recorded in the ledger as well.",
    "",
  );
  for (const p of doc.prompts) {
    const title = `${p.index === 0 ? "Problem statement" : `Follow-up ${p.index}`}\\hfill{\\mdseries\\footnotesize ${escapeLatex(formatDate(p.createdAt))}}`;
    out.push(`\\begin{tcolorbox}[promptcard, title={${title}}]`, md(p.content), "\\end{tcolorbox}", "");
  }

  // 3. Ledger -------------------------------------------------------------
  out.push("\\section{Ledger}", "");
  out.push(
    `${doc.entries.length} entries in chronological order. Each entry opens with a card giving its type, the agent that produced it, its status, the reasoning speed it was produced under and the earlier entries it depends on (hyperlinked), followed by its content, code, output and verdicts. Rejected and superseded entries are kept in place and marked: they are part of the record and show how the solution was corrected.`,
    "",
    "\\subsection*{Overview}",
    overviewTable(doc),
    "",
    "\\subsection*{Entries}",
    "",
  );
  doc.entries.forEach((entry, i) => {
    out.push(renderEntry(entry, i + 1), "");
  });

  out.push("\\end{document}", "");
  // No whitespace normalisation: Verbatim blocks must stay byte-for-byte verbatim.
  const body = out.slice(1).join("\n");
  return `${out[0]}\n${macroFallbacks(body)}\n${body}`;
}

/**
 * The models' math may use control sequences that no package defines
 * (`\Ocal`, `\ord` …); KaTeX shows those in red in the app, pdfLaTeX would
 * stop. Every control sequence used in the body that is still undefined at
 * `\begin{document}` is defined there to typeset its own name in red.
 */
function macroFallbacks(body: string): string {
  const noVerbatim = body.replace(/\\begin\{Verbatim\}[\s\S]*?\\end\{Verbatim\}/g, "");
  const names = new Set<string>();
  for (const m of noVerbatim.matchAll(/\\([a-zA-Z]+)/g)) names.add(m[1]);
  const lines = [...names]
    .sort()
    .map(
      (n) =>
        `\\ifcsname ${n}\\endcsname\\else\\expandafter\\def\\csname ${n}\\endcsname{\\textcolor{statusRejected}{\\texttt{\\textbackslash ${n}}}}\\fi`,
    );
  return [
    "% --- fallbacks for control sequences the models used but nothing defines ---",
    `\\AtBeginDocument{%\n${lines.join("%\n")}%\n}`,
    "",
  ].join("\n");
}
