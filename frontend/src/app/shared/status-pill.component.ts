import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import {
  ConversationStatus,
  LedgerEntryStatus,
  LedgerStatus,
} from "../core/api/dto";

type AnyStatus = ConversationStatus | LedgerStatus | LedgerEntryStatus;

const LABELS: Record<AnyStatus, string> = {
  active: "Active",
  paused: "Paused",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
  solved: "Solved",
  failed: "Failed",
  archived: "Archived",
  verified: "Verified",
};

const COLOR_VAR: Record<AnyStatus, string> = {
  active: "--sa-info",
  paused: "--sa-warning",
  pending: "--sa-warning",
  accepted: "--sa-success",
  rejected: "--sa-danger",
  superseded: "--sa-text-subtle",
  solved: "--sa-success",
  failed: "--sa-danger",
  archived: "--sa-text-subtle",
  verified: "--sa-success",
};

const SOFT_VAR: Record<AnyStatus, string> = {
  active: "--sa-info-soft",
  paused: "--sa-warning-soft",
  pending: "--sa-warning-soft",
  accepted: "--sa-success-soft",
  rejected: "--sa-danger-soft",
  superseded: "--sa-surface-active",
  solved: "--sa-success-soft",
  failed: "--sa-danger-soft",
  archived: "--sa-surface-active",
  verified: "--sa-success-soft",
};

@Component({
  selector: "sa-status-pill",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pill title-pill" [style.color]="color()" [style.background]="bg()">
    <span class="dot"></span>
    {{ label() }}
  </span>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px 2px 7px;
        border-radius: var(--sa-radius-full);
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1;
        height: 18px;
        white-space: nowrap;
      }
      .dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: currentColor;
      }
      .title-pill {
        transform: translateY(1px);
      }
    `,
  ],
})
export class StatusPillComponent {
  readonly status = input.required<AnyStatus>();

  readonly label = computed(() => LABELS[this.status()] ?? this.status());
  readonly color = computed(() => `var(${COLOR_VAR[this.status()] ?? "--sa-text"})`);
  readonly bg = computed(() => `var(${SOFT_VAR[this.status()] ?? "--sa-surface-active"})`);
}
