import archiver, { type Archiver } from "archiver";

import { renderHtml } from "./renderHtml";
import { renderLatex } from "./renderLatex";
import type { ExportBundle } from "./types";

/**
 * Lay an `ExportBundle` out as a zip stream:
 *
 *   report.html    offline page reproducing the web UI's conversation view
 *   report.tex     self-contained LaTeX source of the same document
 *   ledger.json    raw records for programmatic use
 *   artifacts/     files produced by the sandbox, per entry
 *   code/          final script of each computation entry
 *
 * The returned archive is already finalised; pipe it to a response or a file.
 * Errors are emitted on the stream (`archive.on("error", ...)`).
 */
export function createExportArchive(bundle: ExportBundle): Archiver {
  const archive = archiver("zip", { zlib: { level: 6 } });

  archive.append(renderHtml(bundle.document), { name: "report.html" });
  archive.append(renderLatex(bundle.document), { name: "report.tex" });
  archive.append(JSON.stringify(bundle.ledgerJson, null, 2), { name: "ledger.json" });
  for (const bin of bundle.binaries) {
    archive.append(bin.data, { name: bin.path });
  }

  // Not awaited: finalize() resolves when the stream has ended, and the
  // consumer drives that by piping. Failures surface as "error" events.
  void archive.finalize();
  return archive;
}
