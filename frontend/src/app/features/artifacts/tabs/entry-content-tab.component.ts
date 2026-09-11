import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { LedgerEntry } from "../../../core/api/dto";
import { CopyButtonComponent } from "../../../shared/copy-button.component";
import { MarkdownComponent } from "../../../shared/markdown.component";
import { StatusPillComponent } from "../../../shared/status-pill.component";
import { TypeBadgeComponent } from "../../../shared/type-badge.component";

@Component({
  selector: "sa-entry-content-tab",
  standalone: true,
  imports: [
    MarkdownComponent,
    CopyButtonComponent,
    StatusPillComponent,
    TypeBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="wrap">
    @if (entry(); as e) {
      <div class="header">
        <div class="tags">
          <sa-type-badge [type]="e.type" />
          <sa-status-pill [status]="e.status" />
        </div>
        <sa-copy-button [value]="copyValue()" [showLabel]="true" />
      </div>
      <div class="body">
        <p class="summary">{{ e.content.summary }}</p>

        @if (detailsBody()) {
          <sa-markdown [source]="detailsBody()" />
        }

        @if (e.content.justification) {
          <div class="section">
            <span class="label">Justification</span>
            <p>{{ e.content.justification }}</p>
          </div>
        }

        @if (e.content.finalAnswer) {
          <div class="section">
            <span class="label">Final answer</span>
            <sa-markdown [source]="e.content.finalAnswer" />
          </div>
        }
      </div>
    } @else {
      <p class="empty">No entry selected.</p>
    }
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
        gap: var(--sa-space-3);
        padding: 10px 14px;
        border-bottom: 1px solid var(--sa-border);
      }
      .tags {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .body {
        flex: 1 1 auto;
        overflow: auto;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: var(--sa-space-4);
      }
      .summary {
        font-size: var(--sa-fs-md);
        font-weight: 600;
        color: var(--sa-text);
        margin: 0;
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .section .label {
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--sa-text-subtle);
      }
      .section p {
        margin: 0;
        color: var(--sa-text);
        font-size: var(--sa-fs-sm);
        line-height: var(--sa-line-base);
      }
      .empty {
        padding: 14px 16px;
        color: var(--sa-text-subtle);
        font-style: italic;
        font-size: var(--sa-fs-sm);
      }
    `,
  ],
})
export class EntryContentTabComponent {
  readonly entry = input<LedgerEntry | null>(null);

  readonly detailsBody = computed(() => {
    const details = this.entry()?.content.details;
    if (!details) return "";
    if (typeof details["body"] === "string") return details["body"];
    return formatDetails(details);
  });

  readonly copyValue = computed(() => {
    const e = this.entry();
    if (!e) return "";
    const parts: string[] = [e.content.summary];
    const body = this.detailsBody();
    if (body) parts.push(body);
    if (e.content.justification) parts.push(`Justification:\n${e.content.justification}`);
    if (e.content.finalAnswer) parts.push(`Final answer:\n${e.content.finalAnswer}`);
    return parts.join("\n\n");
  });
}

function formatDetails(details: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined) continue;
    const valStr =
      typeof value === "string"
        ? value
        : "```json\n" + JSON.stringify(value, null, 2) + "\n```";
    lines.push(`**${key}:** ${valStr}`);
  }
  return lines.join("\n\n");
}
