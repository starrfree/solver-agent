import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { inject } from "@angular/core";

import { renderMarkdown } from "../core/utils/markdown";

@Component({
  selector: "sa-markdown",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="markdown-body" [innerHTML]="html()"></div>`,
  styles: [
    `
      :host {
        display: block;
      }
      .markdown-body img {
        max-width: 100%;
        height: auto;
        border-radius: var(--sa-radius-md);
        border: 1px solid var(--sa-border);
        background: var(--sa-bg-elev);
        display: block;
        margin: 8px 0;
      }
    `,
  ],
})
export class MarkdownComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly source = input<string | null | undefined>("");
  /** Wrap fenced code blocks in collapsed `<details>` elements. */
  readonly collapsibleCode = input<boolean>(false);
  /** Escape XML-like tags (`<tag>`) in prose so they render literally. */
  readonly escapeHtml = input<boolean>(false);

  readonly html = computed<SafeHtml>(() => {
    const raw = this.source() ?? "";
    const sanitized = renderMarkdown(raw, {
      collapsibleCode: this.collapsibleCode(),
      escapeHtml: this.escapeHtml(),
    });
    return this.sanitizer.bypassSecurityTrustHtml(sanitized);
  });
}
