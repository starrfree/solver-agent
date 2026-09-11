import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { LedgerEntryType } from "../core/api/dto";
import { IconComponent } from "./icon.component";

const LABELS: Record<LedgerEntryType, string> = {
  assumption: "Assumption",
  derivation: "Derivation",
  result: "Result",
  symbolic_computation: "Symbolic",
  numerical_computation: "Numerical",
  cy_analyst_computation: "Calabi-Yau",
  reference_lookup: "References",
  verification: "Verification",
  correction: "Correction",
  final_answer: "Final answer",
  problem_followup: "Follow-up",
};

const ICONS: Record<LedgerEntryType, string> = {
  assumption: "lightbulb",
  derivation: "function-square",
  result: "check-check",
  symbolic_computation: "sigma",
  numerical_computation: "line-chart",
  cy_analyst_computation: "shapes",
  reference_lookup: "globe",
  verification: "shield-check",
  correction: "rotate-ccw",
  final_answer: "flag",
  problem_followup: "message-square",
};

const COLOR_VAR: Record<LedgerEntryType, string> = {
  assumption: "--sa-type-assumption",
  derivation: "--sa-type-derivation",
  result: "--sa-type-result",
  symbolic_computation: "--sa-type-symbolic",
  numerical_computation: "--sa-type-numerical",
  cy_analyst_computation: "--sa-type-cy-analyst",
  reference_lookup: "--sa-type-reference-seeker",
  verification: "--sa-type-verification",
  correction: "--sa-type-correction",
  final_answer: "--sa-type-final",
  problem_followup: "--sa-type-problem-followup",
};

@Component({
  selector: "sa-type-badge",
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [style.color]="color()">
    <sa-icon [name]="icon()" [size]="13" [strokeWidth]="2" />
    <span class="label">{{ label() }}</span>
  </span>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: var(--sa-fs-xs);
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1;
        height: 18px;
        white-space: nowrap;
      }
      .label {
        color: currentColor;
      }
    `,
  ],
})
export class TypeBadgeComponent {
  readonly type = input.required<LedgerEntryType>();

  readonly label = computed(() => LABELS[this.type()] ?? this.type());
  readonly icon = computed(() => ICONS[this.type()] ?? "circle");
  readonly color = computed(() => `var(${COLOR_VAR[this.type()] ?? "--sa-text-muted"})`);
}
