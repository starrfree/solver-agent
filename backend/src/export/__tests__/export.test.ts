/**
 * Renderer tests for the conversation export. Pure: no database, no network.
 * A fixture `ExportDocument` covers every entry kind (prose, computation with
 * artifacts, verification with issues, rejected / superseded statuses) and the
 * Markdown and LaTeX renderers are checked for structure, verbatim content,
 * escaping and math passthrough.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { safeFileName } from "../buildExport";
import { escapeForCommandVerbatim, highlightPython } from "../highlightPython";
import { markdownToHtml } from "../markdownToHtml";
import { escapeLatex, markdownToLatex, verbatimBlock } from "../markdownToLatex";
import { renderHtml } from "../renderHtml";
import { renderLatex } from "../renderLatex";
import type { ExportBundle } from "../types";
import { createExportArchive } from "../zipBundle";
import { DOC, PROMPTS } from "./fixture";

/** File names listed in a zip's central directory (enough to check layout). */
function zipEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(offset >= 0, "end-of-central-directory record not found");
  const count = zip.readUInt16LE(offset + 10);
  offset = zip.readUInt32LE(offset + 16);
  for (let i = 0; i < count; i += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50, "central directory header expected");
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    names.push(zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8"));
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe("markdownToLatex", () => {
  test("escapes prose but leaves math untouched", () => {
    const tex = markdownToLatex("Rate is 50% & cost_1 is $x_1 + y^2$ here.");
    assert.ok(tex.includes("50\\% \\& cost\\_1"));
    assert.ok(tex.includes("$x_1 + y^2$"));
  });

  test("converts display math and preserves environments", () => {
    const tex = markdownToLatex("$$\\int_0^1 f$$\n\n\\begin{align}\na &= b\n\\end{align}");
    assert.ok(tex.includes("\\[\n\\int_0^1 f\n\\]"));
    assert.ok(tex.includes("\\begin{align}\na &= b\n\\end{align}"));
  });

  test("renders emphasis, code, lists and links", () => {
    const tex = markdownToLatex("- **bold** and `a_b`\n- [site](https://x.org/a_b)");
    assert.ok(tex.includes("\\begin{itemize}"));
    assert.ok(tex.includes("\\textbf{bold}"));
    assert.ok(tex.includes("\\texttt{a\\_b}"));
    assert.ok(tex.includes("\\href{https://x.org/a_b}{site}"));
  });

  test("an environment inside $$…$$ is captured once: no placeholder leaks", () => {
    const tex = markdownToLatex("$$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$ then $x$.");
    assert.ok(!tex.includes("MATHSPAN"), tex);
    assert.ok(tex.includes("\\[\n\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}\n\\]"));
    assert.ok(tex.includes("then $x$."));
  });

  test("display environments are not double-wrapped, bare inner environments are wrapped", () => {
    const align = markdownToLatex("$$\\begin{align*} a &= b \\end{align*}$$");
    assert.equal(align, "\\begin{align*} a &= b \\end{align*}");
    const bracket = markdownToLatex("\\[\\begin{equation} a = b \\end{equation}\\]");
    assert.equal(bracket, "\\begin{equation} a = b \\end{equation}");
    const cases = markdownToLatex("\\begin{cases} a & b \\\\ c & d \\end{cases}");
    assert.equal(cases, "\\[\n\\begin{cases} a & b \\\\ c & d \\end{cases}\n\\]");
  });

  test("blank lines inside display math are removed", () => {
    const tex = markdownToLatex("$$\na = b\n\n\nc = d\n$$");
    assert.equal(tex, "\\[\na = b\nc = d\n\\]");
  });

  test("dollar signs in code and prices are not math", () => {
    const tex = markdownToLatex("Costs $5 and $10; `$HOME` and\n\n```sh\necho $PATH $x$\n```\n\nbut $x$ is.");
    assert.ok(tex.includes("Costs \\$5 and \\$10; \\texttt{\\$HOME}"));
    assert.ok(tex.includes("echo $PATH $x$\n\\end{Verbatim}"));
    assert.ok(tex.includes("but $x$ is."));
    assert.ok(!tex.includes("MATHSPAN") && !tex.includes("CODESPAN"));
  });

  test("inline math may span a single line break, and \\( \\) is kept", () => {
    const tex = markdownToLatex("Let $a =\nb$ and \\(c_1\\) hold.");
    assert.ok(tex.includes("$a =\nb$"));
    assert.ok(tex.includes("\\(c_1\\)"));
  });

  test("math inside emphasis, headings, lists and table cells survives", () => {
    const tex = markdownToLatex("# Claim $Z^5$\n\n- **bold $a_1$** item\n\n| h $x$ |\n|---|\n| $y_2$ |");
    assert.ok(tex.includes("\\paragraph*{Claim $Z^5$}"));
    assert.ok(tex.includes("\\textbf{bold $a_1$}"));
    assert.ok(tex.includes("h $x$"));
    assert.ok(tex.includes("$y_2$ \\\\"));
  });

  test("solver <img> tags become figures of the exported file, <br> a line break", () => {
    const resolveFile = (id: string) => (id === "f1" ? "artifacts/e/p.png" : undefined);
    const tex = markdownToLatex('<img src="/api/conversations/c/files/f1" alt="S_n" />\n\nline<br>next', { resolveFile });
    assert.ok(tex.includes("\\includegraphics[width=0.85\\linewidth,height=0.45\\textheight,keepaspectratio]{artifacts/e/p.png}"));
    assert.ok(tex.includes("\\caption*{S\\_n}"));
    assert.ok(tex.includes("line\\par{}next"));
    const missing = markdownToLatex('<img src="/api/conversations/c/files/zz" alt="x">', { resolveFile });
    assert.ok(missing.includes("[figure not included in the export: x]"));
    // A figure followed by prose in the same HTML block, as models write it.
    const mixed = markdownToLatex('<img src="/api/conversations/c/files/f1" alt="p"/>\nSee <b>above</b> &amp; <sup>2</sup>.', { resolveFile });
    assert.ok(mixed.includes("\\includegraphics"));
    assert.ok(mixed.includes("See \\textbf{above} \\& \\textsuperscript{2}."));
    assert.ok(!mixed.includes("\\textless{}"));
  });

  test("inline HTML formatting is converted and kept balanced", () => {
    const tex = markdownToLatex("a <b>bold $x$</b> and x<sup>2</sup>, unclosed <i>italic");
    assert.ok(tex.includes("a \\textbf{bold $x$} and x\\textsuperscript{2}, unclosed \\emph{italic}"));
    const unknown = markdownToLatex("keep <foo>this</foo>");
    assert.ok(unknown.includes("\\textless{}foo\\textgreater{}this\\textless{}/foo\\textgreater{}"));
  });

  test("escapeLatex covers every special character", () => {
    assert.equal(
      escapeLatex("\\ & % $ # _ { } ~ ^"),
      "\\textbackslash{} \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{}",
    );
  });

  test("verbatim block neutralises an early end", () => {
    const tex = verbatimBlock("x\n\\end{Verbatim}\ny");
    assert.equal(tex.match(/\\end\{Verbatim\}/g)?.length, 1);
  });

  test("python fences are highlighted with commandchars, other fences are not", () => {
    const py = verbatimBlock("def f():\n    return {1}", "python");
    assert.ok(py.includes("commandchars=\\\\\\{\\}"));
    assert.ok(py.includes("\\PYk{def} \\PYf{f}():"));
    assert.ok(py.includes("\\PYk{return} \\{\\PYn{1}\\}"));
    const txt = verbatimBlock("def f(): {1}", "text");
    assert.ok(!txt.includes("commandchars"));
    assert.ok(txt.includes("def f(): {1}"));
  });
});

describe("highlightPython", () => {
  test("escapes the three special characters and keeps everything else literal", () => {
    assert.equal(escapeForCommandVerbatim("a\\b {c} → α"), "a\\textbackslash{}b \\{c\\} → α");
  });

  test("colours keywords, strings, comments, numbers, decorators and definitions", () => {
    const tex = highlightPython('@cache\ndef g(x):  # note\n    return "s\\n" + str(3.5)');
    assert.ok(tex.includes("\\PYd{@cache}"));
    assert.ok(tex.includes("\\PYk{def} \\PYf{g}(x):  \\PYc{# note}"));
    assert.ok(tex.includes('\\PYs{"s\\textbackslash{}n"}'));
    assert.ok(tex.includes("\\PYb{str}(\\PYn{3.5})"));
  });

  test("multi-line strings are wrapped line by line", () => {
    const tex = highlightPython('x = """a\nb"""');
    assert.equal(tex, 'x = \\PYs{"""a}\n\\PYs{b"""}');
  });
});

describe("safeFileName", () => {
  test("strips directories, spaces and odd characters", () => {
    assert.equal(safeFileName("../../etc/pass wd.png"), "pass_wd.png");
    assert.equal(safeFileName(".hidden"), "hidden");
    assert.equal(safeFileName(""), "file");
  });
});

describe("renderLatex", () => {
  const tex = renderLatex(DOC);

  test("is a complete document with the three sections", () => {
    assert.ok(tex.startsWith("% Generated by Solver Agent"));
    assert.ok(tex.includes("\n\\documentclass[11pt,a4paper]{article}\n"));
    assert.ok(tex.trimEnd().endsWith("\\end{document}"));
    for (const s of ["\\section{Header}", "\\section{Prompts}", "\\section{Ledger}"]) {
      assert.ok(tex.includes(s), `${s} missing`);
    }
    assert.ok(!tex.includes("\\section{System prompts}"));
  });

  test("escapes the title and header values", () => {
    assert.ok(tex.includes("Sum of the first n odd numbers \\& a test\\_title\\par}"));
    assert.ok(tex.includes("\\mono{gpt-5.6-sol} & 7 \\\\"));
  });

  test("entries have labels, badges, hyperlinked dependencies and callouts", () => {
    assert.ok(tex.includes("\\label{entry:ledg_c1}"));
    assert.ok(tex.includes("\\badge{typeSymbolic}{Symbolic computation}"));
    assert.ok(tex.includes("\\badge{statusRejected}{Rejected}"));
    assert.ok(tex.includes("\\entryref{ledg_a1}"));
    assert.ok(tex.includes("notecard=statusSuperseded"));
    assert.ok(tex.includes("notecard=statusRejected"));
    assert.ok(tex.includes("watermark text={SUPERSEDED}"));
    assert.ok(tex.includes("headercard=typeSymbolic"));
  });

  test("math in bodies and prompts passes through untouched", () => {
    assert.ok(tex.includes("$n \\in \\mathbb{N}_{\\ge 1}$"));
    assert.ok(tex.includes("\\[\nS_{n+1} - S_n = 2n + 1\n\\]"));
    assert.ok(tex.includes("Show that $\\sum_{k=1}^{n} (2k-1) = n^2$"));
    assert.ok(tex.includes("n = 100\\% of 10"));
  });

  test("code and output are verbatim, figures included, skipped files listed", () => {
    assert.ok(tex.includes('n, k = sp.symbols(\\PYs{"n k"}, positive=\\PYk{True}, integer=\\PYk{True})'));
    assert.ok(tex.includes("\\PYk{def} \\PYf{partial_sum}(n: \\PYb{int}) -> \\PYb{int}:"));
    assert.ok(tex.includes("√ all checks passed → S_n = n² 31 0.0015"));
    assert.ok(tex.includes("\\includegraphics[width=0.85\\linewidth,height=0.45\\textheight,keepaspectratio]{artifacts/ledg_c1/plot_1.png}"));
    assert.ok(tex.includes("\\url{artifacts/ledg_c1/table.csv}"));
    assert.ok(tex.includes("not included, exceeds PYTHON\\_MAX\\_ARTIFACT\\_BYTES"));
    assert.ok(tex.includes("DURATION & 1.23 s \\\\"));
  });

  test("system prompts appear as hashes only, and Verbatim blocks are balanced", () => {
    for (const p of PROMPTS) {
      assert.ok(tex.includes(p.sha256), `hash of ${p.name} missing`);
      assert.ok(!tex.includes(p.text.slice(0, 200)), `text of ${p.name} should not be included`);
    }
    const begins = tex.match(/\\begin\{Verbatim\}/g)?.length ?? 0;
    const ends = tex.match(/\\end\{Verbatim\}/g)?.length ?? 0;
    assert.equal(begins, ends);
    assert.ok(begins >= 2);
  });

  test("undefined control sequences used by the models get a visible fallback", () => {
    const doc = { ...DOC, entries: DOC.entries.map((e, i) => (i === 0 ? { ...e, body: "Take $\\Ocal(6)$ and $\\frac{1}{2}$." } : e)) };
    const out = renderLatex(doc);
    assert.ok(out.includes("\\ifcsname Ocal\\endcsname\\else\\expandafter\\def\\csname Ocal\\endcsname{"));
    assert.ok(out.includes("\\ifcsname frac\\endcsname"));
    assert.ok(out.indexOf("\\AtBeginDocument{") < out.indexOf("\\begin{document}"));
    assert.ok(out.includes("\\nonstopmode\n\\documentclass"));
  });

  test("model text never reaches the document escaped: summaries and titles keep their math", () => {
    assert.ok(tex.includes("Show that $\\sum_{k=1}^{n} (2k-1) = n^2$"));
    // Overview table row for the follow-up-style summary with math.
    assert.ok(tex.includes("& sympy confirms $S_n = n^2$ for symbolic $n$. \\\\"));
    assert.ok(!tex.includes("MATHSPAN"));
    assert.ok(!tex.includes("CODESPAN"));
    assert.ok(!tex.includes("\\$S\\_n"));
  });
});

describe("createExportArchive", () => {
  test("zip contains the reports, ledger.json, artifacts and code", async () => {
    const bundle: ExportBundle = {
      document: DOC,
      ledgerJson: { ok: true },
      fileName: "solver-agent-fixture.zip",
      binaries: [
        { path: "code/ledg_c1.py", data: Buffer.from("print(1)\n") },
        { path: "artifacts/ledg_c1/plot_1.png", data: Buffer.alloc(16) },
      ],
    };
    const archive = createExportArchive(bundle);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      archive.on("data", (c: Buffer) => chunks.push(c));
      archive.on("end", resolve);
      archive.on("error", reject);
    });
    const names = zipEntryNames(Buffer.concat(chunks)).sort();
    assert.deepEqual(names, [
      "artifacts/ledg_c1/plot_1.png",
      "code/ledg_c1.py",
      "ledger.json",
      "report.html",
      "report.tex",
    ]);
  });
});

describe("markdownToHtml", () => {
  test("renders math with KaTeX and code with Prism", () => {
    const html = markdownToHtml("Let $x^2$ and\n\n$$\\int_0^1 f$$\n\n```python\ndef f(x):\n    return 1\n```");
    assert.ok(html.includes('class="katex"'));
    assert.ok(html.includes('class="katex-display"'));
    assert.ok(html.includes('<span class="token keyword">def</span>'));
    assert.ok(html.includes('<pre class="language-python">'));
  });

  test("escapes unsafe HTML and links, keeps formatting tags and http links", () => {
    const html = markdownToHtml("<script>alert(1)</script>\n\n<b onclick=\"x()\">x</b> <tag>y</tag> x<sup>2</sup><br> [a](javascript:alert(2)) [b](https://example.org)");
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(html.includes("<b>x</b> &lt;tag&gt;y&lt;/tag&gt; x<sup>2</sup><br>"));
    assert.ok(!html.includes("onclick"));
    assert.ok(!html.includes("javascript:"));
    assert.ok(html.includes('<a href="https://example.org" target="_blank" rel="noopener noreferrer">b</a>'));
  });

  test("rewrites solver <img> file URLs to bundle paths", () => {
    const resolveFile = (id: string) => (id === "file_1" ? "artifacts/e/plot.png" : undefined);
    const ok = markdownToHtml('<img src="/api/conversations/c/files/file_1" alt="plot" />', { resolveFile });
    assert.ok(ok.includes('<img class="figure" src="artifacts/e/plot.png" alt="plot"'));
    const missing = markdownToHtml('<img src="/api/conversations/c/files/nope" alt="x" />', { resolveFile });
    assert.ok(missing.includes("figure not included in the export: x"));
    assert.ok(!missing.includes("<img"));
  });

  test("leaves math delimiters inside code untouched", () => {
    const html = markdownToHtml("`$a$` and\n\n```\n$$b$$\n```");
    assert.ok(html.includes("<code>$a$</code>"));
    assert.ok(html.includes("$$b$$"));
    assert.ok(!html.includes("katex"));
  });
});

describe("renderHtml", () => {
  const html = renderHtml(DOC);

  test("is a self-contained page with inlined KaTeX fonts and no external resources", () => {
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("<title>Sum of the first n odd numbers &amp; a test_title · Solver Agent</title>"));
    assert.ok(html.includes("data:font/woff2;base64,"));
    assert.ok(!/url\(fonts\//.test(html));
    assert.ok(!/<(script|link)[^>]*\s(src|href)=["']https?:/i.test(html));
  });

  test("interleaves messages and step cards chronologically", () => {
    const order = ["msg_u0", "ledg_a1", "ledg_d1", "ledg_c1", "ledg_v1", "ledg_f1", "msg_a0", "msg_u1"].map((id) =>
      html.indexOf(`id="${id}"`),
    );
    assert.ok(order.every((i) => i >= 0));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.ok(html.includes('<span class="role">You</span>'));
    assert.ok(html.includes('<span class="role">Solver Agent</span>'));
  });

  test("cards carry type badge, status pill, tool, artifacts and dependency links", () => {
    assert.ok(html.includes('<span class="type-badge">Symbolic computation</span>'));
    assert.ok(html.includes('<span class="pill superseded">Superseded</span>'));
    assert.ok(html.includes('<span class="tool">Step verifier</span>'));
    assert.ok(html.includes('href="#ledg_a1"'));
    assert.ok(html.includes('<img src="artifacts/ledg_c1/plot_1.png"'));
    assert.ok(html.includes('href="code/ledg_c1.py"'));
    assert.ok(html.includes("not included — exceeds PYTHON_MAX_ARTIFACT_BYTES"));
    assert.ok(html.includes('<span class="token keyword">def</span>'));
    assert.ok(html.includes("√ all checks passed → S_n = n² 31 0.0015"));
    assert.ok(html.includes('class="status-note rejected"'));
    assert.ok(html.includes('class="card final" id="ledg_f1"') && html.includes(" open>"));
  });

  test("assistant HTML is neutralised and solver figures resolved", () => {
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!/href=["']javascript:/i.test(html));
    assert.ok(html.includes('<img class="figure" src="artifacts/ledg_c1/plot_1.png" alt="S_n against n"'));
    assert.ok(html.includes("figure not included in the export: not exported"));
    assert.ok(html.includes("&lt;tag&gt;literal&lt;/tag&gt;"));
  });
});
