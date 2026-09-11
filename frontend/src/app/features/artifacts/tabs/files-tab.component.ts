import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";

import { LedgerEntryArtifact } from "../../../core/api/dto";
import { ConversationStoreService } from "../../../core/state/conversation-store.service";
import { IconComponent } from "../../../shared/icon.component";

function formatSize(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, exp)).toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

@Component({
  selector: "sa-files-tab",
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="files">
    @if (other().length === 0) {
      <p class="empty">No additional files in this entry.</p>
    } @else {
      @for (f of other(); track f.fileId ?? f.name) {
        <details class="file">
          <summary>
            <sa-icon name="file" [size]="14" />
            <span class="name">{{ f.name }}</span>
            <span class="mime">{{ f.mimeType }}</span>
            <span class="size">{{ size(f) }}</span>
            @if (f.skipped) {
              <span class="tag">skipped</span>
            }
          </summary>
          @if (f.skipped && f.reason) {
            <p class="reason">{{ f.reason }}</p>
          } @else if (urlFor(f); as url) {
            <a class="download" [href]="url" [download]="f.name" target="_blank" rel="noopener">
              <sa-icon name="download" [size]="13" />
              Download
            </a>
          }
        </details>
      }
    }
  </div>`,
  styles: [
    `
      :host { display: block; height: 100%; }
      .files {
        height: 100%;
        overflow: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .empty {
        color: var(--sa-text-subtle);
        font-style: italic;
        font-size: var(--sa-fs-sm);
      }
      .file {
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        background: var(--sa-bg-elev);
      }
      summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        cursor: pointer;
        font-size: var(--sa-fs-sm);
        list-style: none;

        &::-webkit-details-marker { display: none; }
      }
      .name { font-weight: 500; color: var(--sa-text); }
      .mime, .size { color: var(--sa-text-subtle); font-family: var(--sa-font-mono); font-size: var(--sa-fs-xs); }
      .size { margin-left: auto; }
      .tag {
        font-size: var(--sa-fs-xs);
        padding: 1px 6px;
        background: var(--sa-warning-soft);
        color: var(--sa-warning);
        border-radius: var(--sa-radius-full);
      }
      pre {
        margin: 0;
        padding: 12px 14px;
        border-top: 1px solid var(--sa-border);
        font-family: var(--sa-font-mono);
        font-size: var(--sa-fs-sm);
        white-space: pre-wrap;
        max-height: 320px;
        overflow: auto;
      }
      .reason {
        padding: 10px 14px;
        border-top: 1px solid var(--sa-border);
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
      }
      .download {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-top: 1px solid var(--sa-border);
        color: var(--sa-accent);
        font-size: var(--sa-fs-sm);

        &:hover { color: var(--sa-accent-hover); }
      }
    `,
  ],
})
export class FilesTabComponent {
  private readonly store = inject(ConversationStoreService);

  readonly files = input<LedgerEntryArtifact[]>([]);

  readonly other = computed(() =>
    this.files().filter(
      (f) =>
        !(
          f.mimeType.startsWith("image/") || f.name.toLowerCase().endsWith(".png")
        ),
    ),
  );

  size(f: LedgerEntryArtifact): string {
    return formatSize(f.size);
  }

  urlFor(f: LedgerEntryArtifact): string | null {
    if (!f.fileId) return null;
    const conversationId = this.store.selectedConversationId();
    if (!conversationId) return null;
    return `/api/conversations/${conversationId}/files/${f.fileId}`;
  }
}
