import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { LedgerEntryArtifact } from "../../../core/api/dto";
import { ConversationStoreService } from "../../../core/state/conversation-store.service";

@Component({
  selector: "sa-plot-tab",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="plots">
    @if (plots().length === 0) {
      <p class="empty">No plots in this entry.</p>
    } @else {
      @for (plot of plots(); track plot.fileId ?? plot.name) {
        <figure>
          <div class="frame">
            @if (urlFor(plot); as url) {
              <img [src]="url" [alt]="plot.name" />
            } @else if (plot.skipped) {
              <div class="skipped">
                <span>Plot skipped</span>
                @if (plot.reason) {
                  <small>{{ plot.reason }}</small>
                }
              </div>
            } @else {
              <div class="skipped">
                <span>Plot unavailable</span>
              </div>
            }
          </div>
          <figcaption>{{ plot.name }}</figcaption>
        </figure>
      }
    }
  </div>`,
  styles: [
    `
      :host { display: block; height: 100%; }
      .plots {
        height: 100%;
        overflow: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      figure {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .frame {
        background: var(--sa-bg-elev);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        padding: 8px;
        display: grid;
        place-items: center;
      }
      img {
        max-width: 100%;
        height: auto;
        border-radius: var(--sa-radius-sm);
      }
      .skipped {
        text-align: center;
        padding: var(--sa-space-6);
        color: var(--sa-text-muted);
        small { display: block; color: var(--sa-text-subtle); margin-top: 4px; }
      }
      figcaption {
        font-family: var(--sa-font-mono);
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
        text-align: center;
      }
      .empty {
        color: var(--sa-text-subtle);
        font-style: italic;
        font-size: var(--sa-fs-sm);
      }
    `,
  ],
})
export class PlotTabComponent {
  private readonly store = inject(ConversationStoreService);

  readonly files = input<LedgerEntryArtifact[]>([]);

  readonly plots = computed(() =>
    this.files().filter(
      (f) => f.mimeType.startsWith("image/") || f.name.toLowerCase().endsWith(".png"),
    ),
  );

  urlFor(plot: LedgerEntryArtifact): string | null {
    if (!plot.fileId) return null;
    const conversationId = this.store.selectedConversationId();
    if (!conversationId) return null;
    return `/api/conversations/${conversationId}/files/${plot.fileId}`;
  }
}
