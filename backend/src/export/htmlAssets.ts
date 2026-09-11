/**
 * Static assets inlined into `report.html` so the page opens offline, straight
 * from the unzipped bundle, with no CDN round-trip: the KaTeX stylesheet with
 * its WOFF2 fonts embedded as data URIs. Loaded lazily and cached for the
 * lifetime of the process (≈ 0.4 MB once base64-encoded).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

let katexCssCache: string | undefined;

/** KaTeX CSS with every `url(fonts/*.woff2)` replaced by an inline data URI. */
export function katexCssInline(): string {
  if (katexCssCache !== undefined) return katexCssCache;
  const cssPath = require.resolve("katex/dist/katex.min.css");
  const fontsDir = join(dirname(cssPath), "fonts");
  const css = readFileSync(cssPath, "utf8");
  const inlined = css.replace(
    /src:url\(fonts\/([A-Za-z0-9_-]+)\.woff2\) format\("woff2"\)(?:,url\([^)]*\) format\("[a-z]+"\))*/g,
    (_m, name: string) => {
      const data = readFileSync(join(fontsDir, `${name}.woff2`)).toString("base64");
      return `src:url(data:font/woff2;base64,${data}) format("woff2")`;
    },
  );
  katexCssCache = inlined;
  return inlined;
}

/** For tests: drop the cache so the next call re-reads from disk. */
export function resetHtmlAssetCache(): void {
  katexCssCache = undefined;
}
