import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

import { IconComponent } from "./icon.component";

@Component({
  selector: "sa-empty-state",
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="empty">
    @if (icon) {
      <div class="icon">
        <sa-icon [name]="icon" [size]="28" [strokeWidth]="1.5" />
      </div>
    }
    <h2 class="title">{{ title }}</h2>
    @if (message) {
      <p class="message">{{ message }}</p>
    }
    @if (showCta) {
      <ng-content select="[empty-cta]"></ng-content>
    }
  </div>`,
  styles: [
    `
      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: var(--sa-space-8) var(--sa-space-6);
        gap: var(--sa-space-3);
        max-width: 480px;
        margin: 0 auto;
      }
      .icon {
        width: 56px;
        height: 56px;
        border-radius: var(--sa-radius-xl);
        background: var(--sa-surface);
        border: 1px solid var(--sa-border);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--sa-text-muted);
        margin-bottom: var(--sa-space-2);
      }
      .title {
        font-size: var(--sa-fs-lg);
        font-weight: 600;
        color: var(--sa-text);
      }
      .message {
        font-size: var(--sa-fs-base);
        color: var(--sa-text-muted);
        line-height: var(--sa-line-loose);
      }
    `,
  ],
})
export class EmptyStateComponent {
  @Input() title = "Nothing to see here";
  @Input() message?: string;
  @Input() icon?: string;
  @Input() showCta = true;
}
