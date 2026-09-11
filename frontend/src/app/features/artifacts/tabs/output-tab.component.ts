import { ChangeDetectionStrategy, Component, input } from "@angular/core";

@Component({
  selector: "sa-output-tab",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="output">
    @if (stdout()) {
      <section>
        <h3>stdout</h3>
        <pre>{{ stdout() }}</pre>
      </section>
    }
    @if (stderr()) {
      <section class="err">
        <h3>stderr</h3>
        <pre>{{ stderr() }}</pre>
      </section>
    }
    @if (!stdout() && !stderr()) {
      <p class="empty">No output captured.</p>
    }
  </div>`,
  styles: [
    `
      :host { display: block; height: 100%; }
      .output {
        height: 100%;
        overflow: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: var(--sa-space-4);
      }
      h3 {
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--sa-text-subtle);
        margin-bottom: 6px;
      }
      .err h3 { color: var(--sa-danger); }
      pre {
        background: var(--sa-bg-elev);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        padding: 12px 14px;
        font-family: var(--sa-font-mono);
        font-size: var(--sa-fs-sm);
        line-height: var(--sa-line-base);
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--sa-text);
      }
      .err pre {
        border-color: var(--sa-danger-soft);
      }
      .empty {
        color: var(--sa-text-subtle);
        font-style: italic;
        font-size: var(--sa-fs-sm);
      }
    `,
  ],
})
export class OutputTabComponent {
  readonly stdout = input<string>("");
  readonly stderr = input<string>("");
}
