import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import { CopyButtonComponent } from "../../shared/copy-button.component";
import { IconComponent } from "../../shared/icon.component";
import { MarkdownComponent } from "../../shared/markdown.component";
import { SpinnerComponent } from "../../shared/spinner.component";

/**
 * Full-height view that renders the Proof Narrator's read-only walkthrough of
 * the successful reasoning chain. Shown in place of the conversation timeline
 * when the user toggles the "Reasoning process" view. Falls back to a
 * generating / empty state while the narrator is still working.
 */
@Component({
  selector: "sa-reasoning-process",
  standalone: true,
  imports: [CopyButtonComponent, IconComponent, MarkdownComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="reasoning">
      <div class="head">
        <div class="title">
          <sa-icon name="text-align-start" [size]="15" />
          <span>Solution</span>
        </div>
        <div class="head-actions">
          @if (narrative()) {
            <sa-copy-button [value]="narrative()!" title="Copy walkthrough (with LaTeX)" />
            <button
              type="button"
              class="action-btn"
              [disabled]="generating()"
              (click)="generate.emit()"
              title="Regenerate the walkthrough from scratch"
            >
              @if (generating()) {
                <sa-spinner [size]="12" />
              } @else {
                <sa-icon name="rotate-ccw" [size]="13" />
              }
              <span>Regenerate</span>
            </button>
          }
        </div>
      </div>

      <div class="body">
        @if (narrative(); as text) {
          <sa-markdown [source]="text" [collapsibleCode]="true" />
        } @else if (generating()) {
          <div class="state">
            <sa-spinner [size]="20" />
            <p>Building the walkthrough of how the solution was reached…</p>
          </div>
        } @else {
          <div class="state">
            <button type="button" class="action-btn primary" (click)="generate.emit()">
              <sa-icon name="sparkles" [size]="14" />
              <span>Generate solution walkthrough</span>
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
      }
      .reasoning {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 0;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 24px;
        border-bottom: 1px solid var(--sa-border);
        flex: 0 0 auto;
      }
      .title {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: var(--sa-fs-sm);
        color: var(--sa-text);
      }
      .head-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .action-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        background: var(--sa-surface);
        color: var(--sa-text);
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        cursor: pointer;
        transition:
          background var(--sa-transition-fast),
          border-color var(--sa-transition-fast);
      }
      .action-btn:hover:not(:disabled) {
        border-color: var(--sa-text-muted);
      }
      .action-btn:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .action-btn.primary {
        padding: 8px 14px;
        font-size: var(--sa-fs-sm);
        color: #fff;
        background: var(--sa-accent, #2563eb);
        border-color: var(--sa-accent, #2563eb);
      }
      .action-btn.primary:hover:not(:disabled) {
        filter: brightness(1.05);
      }
      .body {
        flex: 1 1 auto;
        overflow-y: auto;
        padding: 24px 32px 56px;
      }
      .body ::ng-deep .markdown-body {
        max-width: 880px;
        margin: 0 auto;
      }
      .body ::ng-deep img {
        max-width: 100%;
        height: auto;
      }
      .body ::ng-deep details.code-collapse {
        margin: 12px 0;
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        background: var(--sa-surface);
        overflow: hidden;
      }
      .body ::ng-deep details.code-collapse > summary {
        cursor: pointer;
        list-style: none;
        padding: 8px 12px;
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--sa-text-muted);
        user-select: none;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .body ::ng-deep details.code-collapse > summary::-webkit-details-marker {
        display: none;
      }
      .body ::ng-deep details.code-collapse > summary::before {
        content: "▸";
        font-size: 10px;
        transition: transform var(--sa-transition-fast);
      }
      .body ::ng-deep details.code-collapse[open] > summary::before {
        transform: rotate(90deg);
      }
      .body ::ng-deep details.code-collapse > summary:hover {
        color: var(--sa-text);
      }
      .body ::ng-deep details.code-collapse > pre {
        margin: 0;
        border: none;
        border-top: 1px solid var(--sa-border);
        border-radius: 0;
      }
      .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
        color: var(--sa-text-muted);
        padding: 72px 24px;
      }
    `,
  ],
})
export class ReasoningProcessComponent {
  readonly narrative = input<string | null | undefined>(null);
  readonly generating = input<boolean>(false);
  /** Emitted when the user asks to generate or regenerate the walkthrough. */
  readonly generate = output<void>();
}
