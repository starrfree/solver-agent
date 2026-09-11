import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";

import { ApiService } from "../../core/api/api.service";
import {
  ConversationUsage,
  UsageAgentRole,
  UsageBreakdownRow,
} from "../../core/api/dto";
import { IconComponent } from "../../shared/icon.component";
import { SpinnerComponent } from "../../shared/spinner.component";

const ROLE_LABELS: Record<UsageAgentRole, string> = {
  main_solver: "Main solver",
  full_verification: "Full verification",
  step_verification: "Step verification",
  computation: "Computation",
  cy_analyst: "Calabi-Yau analyst",
  reference_seeker: "Reference seeker",
  proof_narrator: "Proof narrator",
  side_talk: "Side-talk",
};

interface ModelUsage {
  model: string;
  totalTokens: number;
  costUsd: number;
}

/** Per-agent group: total cost across its models plus one entry per model. */
interface RoleGroup {
  role: UsageAgentRole;
  costUsd: number;
  models: ModelUsage[];
}

/**
 * Compact topbar token/cost meter. Shows the running total tokens and USD cost
 * for the selected conversation; clicking opens a popover with a per-agent /
 * per-model breakdown fetched lazily from `GET /conversations/:id/usage`.
 */
@Component({
  selector: "sa-usage-meter",
  standalone: true,
  imports: [IconComponent, SpinnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="usage-meter">
      <button
        type="button"
        class="meter-pill"
        [class.active]="open()"
        [attr.aria-pressed]="open()"
        (click)="toggle()"
        title="Token usage and estimated cost for this conversation"
      >
        <sa-icon name="coins" [size]="13" />
        <span class="tokens">{{ totalTokensLabel() }}</span>
        <span class="sep">·</span>
        <span class="cost">{{ costLabel() }}</span>
      </button>

      @if (open()) {
        <div class="popover" role="dialog" aria-label="Usage breakdown">
          <div class="pop-head">
            <span class="pop-title">Token usage</span>
            @if (usage(); as u) {
              <span class="pop-calls">{{ u.calls }} call{{ u.calls === 1 ? "" : "s" }}</span>
            }
          </div>

          @if (usage(); as u) {
            <div class="totals">
              <div class="total-row">
                <span class="label">Total cost</span>
                <span class="value strong">{{ costLabel() }}</span>
              </div>
              <div class="total-row">
                <span class="label">Total tokens</span>
                <span class="value token-count">
                  <sa-icon name="circle" [size]="8" [strokeWidth]="4" />
                  {{ formatTokens(u.totalTokens) }}
                </span>
              </div>
              <div class="token-split">
                <span title="Input tokens">{{ formatTokens(u.inputTokens) }} in</span>
                @if (u.cachedInputTokens > 0) {
                  <span class="cached" title="Cached input tokens (billed at a discount)">
                    {{ formatTokens(u.cachedInputTokens) }} cached
                  </span>
                }
                <span class="output" title="Output tokens">{{ formatTokens(u.outputTokens) }} out</span>
                @if (u.reasoningTokens > 0) {
                  <span class="reasoning" title="Reasoning tokens (part of output)">
                    {{ formatTokens(u.reasoningTokens) }} reasoning
                  </span>
                }
              </div>
            </div>
          }

          <div class="pop-section-title">By agent</div>

          @if (loading()) {
            <div class="pop-loading"><sa-spinner [size]="16" /></div>
          } @else if (groups().length === 0) {
            <div class="pop-empty">No usage recorded yet.</div>
          } @else {
            <ul class="breakdown">
              @for (group of groups(); track group.role) {
                <li class="group">
                  <div class="group-head">
                    <span class="role">{{ roleLabel(group.role) }}</span>
                    <span class="row-cost">{{ formatUsd(group.costUsd) }}</span>
                  </div>
                  <div class="models">
                    @for (m of group.models; track m.model) {
                      <div class="model-line">
                        <span class="model">{{ m.model }}</span>
                        <span class="model-tokens token-count">
                          <sa-icon name="circle" [size]="7.5" [strokeWidth]="3" />
                          {{ formatTokens(m.totalTokens) }}
                        </span>
                      </div>
                    }
                  </div>
                </li>
              }
            </ul>
          }

          <div class="pop-foot">Estimated costs.</div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      .usage-meter {
        position: relative;
        display: inline-flex;
      }
      .meter-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 9px;
        height: 20px;
        border-radius: var(--sa-radius-full);
        background: var(--sa-surface);
        border: 1px solid var(--sa-border);
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-muted);
        cursor: pointer;
        line-height: 1;
        transition: background var(--sa-transition-fast), border-color var(--sa-transition-fast),
          color var(--sa-transition-fast);
      }
      .meter-pill:hover {
        background: var(--sa-surface-hover);
        color: var(--sa-text);
      }
      .meter-pill.active {
        border-color: var(--sa-accent);
        background: var(--sa-surface);
        color: var(--sa-text-muted);
      }
      .meter-pill .tokens {
        font-variant-numeric: tabular-nums;
      }
      .token-count {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        font-variant-numeric: tabular-nums;
      }
      .token-count sa-icon {
        margin-right: -0.5px;
      }
      .meter-pill .cost {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .meter-pill .sep {
        opacity: 0.5;
      }

      .popover {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 290px;
        background: var(--sa-bg-elev);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-lg);
        box-shadow: var(--sa-shadow-lg);
        z-index: var(--sa-z-dropdown);
        padding: 12px;
        color: var(--sa-text);
        cursor: default;
      }
      .pop-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .pop-title {
        font-size: var(--sa-fs-sm);
        font-weight: 600;
      }
      .pop-calls {
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
      }
      .totals {
        background: var(--sa-surface);
        border: 1px solid var(--sa-border);
        border-radius: var(--sa-radius-md);
        padding: 8px 10px;
      }
      .total-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        font-size: var(--sa-fs-sm);
      }
      .total-row .label {
        color: var(--sa-text-muted);
      }
      .total-row .value {
        font-variant-numeric: tabular-nums;
      }
      .total-row .value.strong {
        font-weight: 700;
        font-size: var(--sa-fs-base);
      }
      .token-split {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 10px;
        margin-top: 6px;
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
        font-variant-numeric: tabular-nums;
      }
      .token-split .cached {
        color: var(--sa-success);
      }
      .token-split .output,
      .token-split .reasoning {
        color: var(--sa-accent);
      }
      .pop-section-title {
        margin: 12px 2px 6px;
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--sa-text-subtle);
      }
      .pop-loading {
        display: flex;
        justify-content: center;
        padding: 12px 0;
      }
      .pop-empty {
        font-size: var(--sa-fs-sm);
        color: var(--sa-text-muted);
        padding: 6px 2px;
      }
      .breakdown {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 250px;
        overflow-y: auto;
      }
      .group {
        padding: 6px 8px;
        border-radius: var(--sa-radius-sm);
      }
      .group:hover {
        background: var(--sa-surface-hover);
      }
      .group-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      .group-head .role {
        font-size: var(--sa-fs-sm);
        font-weight: 500;
      }
      .group-head .row-cost {
        font-size: var(--sa-fs-sm);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .models {
        display: flex;
        flex-direction: column;
        gap: 1px;
        margin-top: 3px;
      }
      .model-line {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
      }
      .model-line .model {
        font-family: var(--sa-font-mono);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .model-line .model-tokens {
        color: var(--sa-text-muted);
        flex-shrink: 0;
      }
      .pop-foot {
        margin-top: 10px;
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
        text-align: center;
      }
    `,
  ],
})
export class UsageMeterComponent {
  private readonly api = inject(ApiService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly usage = input<ConversationUsage | null>(null);
  readonly conversationId = input<string | null>(null);

  readonly open = signal(false);
  readonly loading = signal(false);
  readonly breakdown = signal<UsageBreakdownRow[]>([]);

  readonly totalTokensLabel = computed(() => {
    const u = this.usage();
    return u ? this.formatTokens(u.totalTokens) : "—";
  });

  readonly costLabel = computed(() => {
    const u = this.usage();
    return u ? this.formatUsd(u.costUsd) : "—";
  });

  /**
   * Breakdown rows (one per role+model) regrouped by agent: each group shows
   * the agent's total cost and one token line per model it used.
   */
  readonly groups = computed<RoleGroup[]>(() => {
    const byRole = new Map<UsageAgentRole, RoleGroup>();
    for (const row of this.breakdown()) {
      let group = byRole.get(row.role);
      if (!group) {
        group = { role: row.role, costUsd: 0, models: [] };
        byRole.set(row.role, group);
      }
      group.costUsd += row.costUsd;
      group.models.push({
        model: row.model,
        totalTokens: row.tokens.totalTokens,
        costUsd: row.costUsd,
      });
    }
    const groups = [...byRole.values()];
    for (const g of groups) g.models.sort((a, b) => b.costUsd - a.costUsd);
    groups.sort((a, b) => b.costUsd - a.costUsd);
    return groups;
  });

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) this.loadBreakdown();
  }

  private loadBreakdown(): void {
    const id = this.conversationId();
    if (!id) return;
    this.loading.set(true);
    this.api.getUsage(id).subscribe({
      next: (res) => {
        this.breakdown.set(res.breakdown);
        this.loading.set(false);
      },
      error: () => {
        this.breakdown.set([]);
        this.loading.set(false);
      },
    });
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }

  roleLabel(role: UsageAgentRole): string {
    return ROLE_LABELS[role] ?? role;
  }

  formatTokens(n: number): string {
    if (!n) return "0";
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  }

  formatUsd(cost: number): string {
    if (!cost) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  }
}
