import {
  ChangeDetectionStrategy,
  Component,
  Input,
  signal,
} from "@angular/core";

import { IconComponent } from "./icon.component";

@Component({
  selector: "sa-copy-button",
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button
    type="button"
    class="btn"
    (click)="copy()"
    [attr.aria-label]="copied() ? 'Copied!' : 'Copy'"
  >
    <sa-icon [name]="copied() ? 'check' : 'copy'" [size]="14" />
    @if (showLabel) {
      <span>{{ copied() ? "Copied" : "Copy" }}</span>
    }
  </button>`,
  styles: [
    `
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: var(--sa-radius-md);
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        border: 1px solid transparent;
        transition: all var(--sa-transition-fast);
      }
      .btn:hover {
        background: var(--sa-surface-hover);
        color: var(--sa-text);
        border-color: var(--sa-border);
      }
    `,
  ],
})
export class CopyButtonComponent {
  @Input({ required: true }) value!: string;
  @Input() showLabel = false;

  readonly copied = signal(false);
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value);
      this.copied.set(true);
      if (this.resetTimer) clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // ignore — clipboard may be unavailable in insecure contexts
    }
  }
}
