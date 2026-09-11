import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { CopyButtonComponent } from "../../../shared/copy-button.component";
import { MarkdownComponent } from "../../../shared/markdown.component";

@Component({
  selector: "sa-final-answer-tab",
  standalone: true,
  imports: [MarkdownComponent, CopyButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="wrap">
    <div class="header">
      <span class="badge">Verified final answer</span>
      <sa-copy-button [value]="answer()" [showLabel]="true" />
    </div>
    <div class="body">
      <sa-markdown [source]="answer()" />
    </div>
  </div>`,
  styles: [
    `
      :host { display: block; height: 100%; }
      .wrap {
        height: 100%;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid var(--sa-border);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 9px;
        height: 20px;
        border-radius: var(--sa-radius-full);
        background: var(--sa-success-soft);
        color: var(--sa-success);
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .body {
        flex: 1 1 auto;
        overflow: auto;
        padding: 14px 16px;
      }
    `,
  ],
})
export class FinalAnswerTabComponent {
  readonly answer = input<string>("");
}
