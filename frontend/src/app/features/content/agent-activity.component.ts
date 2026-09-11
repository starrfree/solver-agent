import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { AgentTool } from "../../core/api/dto";
import { CyNetworkAnimComponent } from "./cy-network-anim.component";

interface AgentChip {
  tool: AgentTool;
  label: string;
  caption: string;
  modifier: string;
}

const META: Record<AgentTool, { label: string; caption: string; modifier: string }> = {
  main_solver: {
    label: "",
    caption: "",
    modifier: "main",
  },
  symbolic: {
    label: "Symbolic",
    caption: "Computing",
    modifier: "symbolic",
  },
  numerical: {
    label: "Numerical",
    caption: "Simulating",
    modifier: "numerical",
  },
  cy_analyst: {
    label: "Calabi-Yau",
    caption: "Analyzing",
    modifier: "cy",
  },
  reference_seeker: {
    label: "References",
    caption: "Searching",
    modifier: "reference",
  },
  step_verification: {
    label: "Step verifier",
    caption: "Reviewing",
    modifier: "step",
  },
  full_verification: {
    label: "Full verifier",
    caption: "Auditing",
    modifier: "full",
  },
  proof_narrator: {
    label: "Narrator",
    caption: "Summarizing",
    modifier: "narrator",
  },
};

@Component({
  selector: "sa-agent-activity",
  standalone: true,
  imports: [CyNetworkAnimComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chips().length > 0) {
      <article class="msg" role="status" aria-live="polite">
        <div class="meta">
          <span class="role">Solver Agent</span>
          <span class="dot">·</span>
          <span class="caption">Working</span>
          <span class="ellipsis" aria-hidden="true">
            <span></span><span></span><span></span>
          </span>
        </div>
        <div class="bubble">
          @for (chip of chips(); track chip.tool) {
            <div class="chip" [attr.data-agent]="chip.modifier" [title]="chip.label + ' — ' + chip.caption + '…'">
              <span class="anim" [class]="'anim-' + chip.modifier" aria-hidden="true">
                @switch (chip.modifier) {
                  @case ("main") {
                    <span class="orb"></span>
                    <span class="ring"></span>
                  }
                  @case ("symbolic") {
                    <span class="sigma">Σ</span>
                  }
                  @case ("numerical") {
                    <span class="bar"></span>
                    <span class="bar"></span>
                    <span class="bar"></span>
                    <span class="bar"></span>
                  }
                  @case ("cy") {
                    <sa-cy-network-anim />
                  }
                  @case ("reference") {
                    <span class="globe"></span>
                    <span class="meridian"></span>
                    <span class="sat"></span>
                  }
                  @case ("step") {
                    <span class="check"></span>
                    <span class="scan"></span>
                  }
                  @case ("full") {
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                    <span class="dot"></span>
                  }
                  @case ("narrator") {
                    <span class="line"></span>
                    <span class="line"></span>
                    <span class="line"></span>
                    <span class="pen"></span>
                  }
                }
              </span>
              <span class="text">
                <span class="label">{{ chip.label }}</span>
                <span class="status">{{ chip.caption }}</span>
              </span>
            </div>
          }
        </div>
      </article>
    }
  `,
  styleUrls: ["./agent-activity.component.scss"],
})
export class AgentActivityComponent {
  readonly agents = input.required<readonly AgentTool[]>();

  readonly chips = computed<AgentChip[]>(() =>
    this.agents().map((tool) => ({ tool, ...META[tool] })),
  );
}
