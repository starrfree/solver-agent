import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { inject } from "@angular/core";

import { highlightPython } from "../../../core/utils/markdown";
import { CopyButtonComponent } from "../../../shared/copy-button.component";

@Component({
  selector: "sa-code-tab",
  standalone: true,
  imports: [CopyButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="code-tab">
    <div class="header">
      <span class="filename">main.py</span>
      <sa-copy-button [value]="source()" [showLabel]="true" />
    </div>
    <pre class="language-python"><code class="language-python" [innerHTML]="html()"></code></pre>
  </div>`,
  styles: [
    `
      :host { display: block; height: 100%; }
      .code-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        border-bottom: 1px solid var(--sa-border);
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-muted);
      }
      .filename {
        font-family: var(--sa-font-mono);
      }
      pre {
        flex: 1 1 auto;
        margin: 0;
        padding: 14px 16px;
        overflow: auto;
        background: var(--sa-bg-elev);
        border: 0;
        border-radius: 0;
        font-size: var(--sa-fs-sm);
        line-height: var(--sa-line-base);
      }
    `,
  ],
})
export class CodeTabComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly source = input<string>("");
  readonly html = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(highlightPython(this.source())),
  );
}
