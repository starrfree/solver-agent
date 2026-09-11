import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from "@angular/core";

import { LedgerEntry } from "../../core/api/dto";
import { absoluteTime, shortDuration } from "../../core/utils/time";
import { IconComponent } from "../../shared/icon.component";
import { MarkdownComponent } from "../../shared/markdown.component";
import { StatusPillComponent } from "../../shared/status-pill.component";
import { TypeBadgeComponent } from "../../shared/type-badge.component";

@Component({
  selector: "sa-ledger-entry-card",
  standalone: true,
  imports: [IconComponent, MarkdownComponent, StatusPillComponent, TypeBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section
    class="card"
    [class.selected]="selected()"
    [style.--accent]="'var(' + accentVar() + ')'"
    [attr.data-entry-id]="entry()._id"
  >
    <button type="button" class="header" (click)="toggle()">
      <span class="accent" aria-hidden="true"></span>
      <sa-type-badge [type]="entry().type" />
      <sa-status-pill [status]="entry().status" />
      <span class="tool">{{ toolLabel() }}</span>
      <span class="summary">{{ entry().content.summary }}</span>
      <span class="meta">
        @if (isFast()) {
          <span class="fast-pill" title="Produced in fast mode">
            <sa-icon name="zap" [size]="11" />
            <span>Fast</span>
          </span>
        }
        @if (durationLabel()) {
          <span class="duration">{{ durationLabel() }}</span>
        }
        <span class="ts" [title]="ts()">{{ ts() }}</span>
        <span
          class="fork-btn"
          role="button"
          tabindex="0"
          (click)="fork.emit(); $event.stopPropagation()"
          (keydown.enter)="fork.emit(); $event.stopPropagation(); $event.preventDefault()"
          (keydown.space)="fork.emit(); $event.stopPropagation(); $event.preventDefault()"
          title="Fork conversation from here"
          aria-label="Fork conversation from this step"
        >
          <span class="fork-glyph"><sa-icon name="split" [size]="13" /></span>
        </span>
        <sa-icon [name]="open() ? 'chevron-down' : 'chevron-right'" [size]="14" />
      </span>
    </button>

    @if (open()) {
      <div class="body">
        @if (detailsBody()) {
          <sa-markdown [source]="detailsBody()" />
        } @else {
          <p class="empty-details">No additional details.</p>
        }

        @if (entry().content.justification) {
          <div class="justification">
            <span class="label">Justification</span>
            <p>{{ entry().content.justification }}</p>
          </div>
        }

        @if (entry().dependsOn.length > 0) {
          <div class="depends">
            <span class="label">Depends on</span>
            <div class="chips">
              @for (id of entry().dependsOn; track id) {
                <button
                  type="button"
                  class="chip"
                  (click)="navigate.emit(id); $event.stopPropagation()"
                  [title]="id"
                >
                  <sa-icon name="link" [size]="11" />
                  <span>{{ shortId(id) }}</span>
                </button>
              }
            </div>
          </div>
        }

        @if (hasArtifacts()) {
          <button
            type="button"
            class="artifacts-btn"
            (click)="openArtifacts.emit(entry()._id); $event.stopPropagation()"
          >
            <sa-icon name="paperclip" [size]="13" />
            <span>View artifacts</span>
            @if (artifactCount(); as count) {
              <span class="count">{{ count }}</span>
            }
          </button>
        }
      </div>
    }
  </section>`,
  styleUrls: ["./ledger-entry-card.component.scss"],
})
export class LedgerEntryCardComponent {
  readonly entry = input.required<LedgerEntry>();
  readonly selected = input(false);
  readonly defaultOpen = input(false);
  readonly openArtifacts = output<string>();
  readonly navigate = output<string>();
  readonly fork = output<void>();

  readonly open = signal(false);

  constructor() {
    // Snap to defaultOpen on first render.
    queueMicrotask(() => this.open.set(this.defaultOpen()));
  }

  readonly toolLabel = computed(() => formatTool(this.entry().tool));
  readonly isFast = computed(() => this.entry().reasoningSpeed === "fast");
  readonly ts = computed(() => absoluteTime(this.entry().createdAt));
  readonly durationLabel = computed(() => {
    const ms = this.entry().artifacts?.durationMs;
    return ms ? shortDuration(ms) : "";
  });
  readonly hasArtifacts = computed(() => {
    const a = this.entry().artifacts;
    if (!a) return false;
    return Boolean(a.code || a.stdout || a.stderr || (a.files && a.files.length > 0));
  });
  readonly artifactCount = computed(() => {
    const a = this.entry().artifacts;
    if (!a) return 0;
    let n = 0;
    if (a.code) n += 1;
    if (a.stdout) n += 1;
    if (a.stderr) n += 1;
    if (a.files) n += a.files.length;
    return n;
  });

  readonly detailsBody = computed(() => {
    const details = this.entry().content.details;
    if (!details) return "";
    if (typeof details["body"] === "string") return details["body"];
    return formatDetails(details);
  });

  readonly accentVar = computed(() => {
    switch (this.entry().type) {
      case "assumption":
        return "--sa-type-assumption";
      case "derivation":
        return "--sa-type-derivation";
      case "result":
        return "--sa-type-result";
      case "symbolic_computation":
        return "--sa-type-symbolic";
      case "numerical_computation":
        return "--sa-type-numerical";
      case "cy_analyst_computation":
        return "--sa-type-cy-analyst";
      case "reference_lookup":
        return "--sa-type-reference-seeker";
      case "verification":
        return "--sa-type-verification";
      case "correction":
        return "--sa-type-correction";
      case "final_answer":
        return "--sa-type-final";
      case "problem_followup":
        return "--sa-type-problem-followup";
      default:
        return "--sa-text-muted";
    }
  });

  toggle(): void {
    this.open.update((v) => !v);
  }

  shortId(id: string): string {
    const stripped = id.includes("_") ? id.split("_").slice(1).join("_") : id;
    return stripped.slice(0, 8);
  }
}

function formatTool(tool: string): string {
  switch (tool) {
    case "main_solver":
      return "Main solver";
    case "ledger":
      return "Ledger";
    case "symbolic":
      return "Symbolic";
    case "numerical":
      return "Numerical";
    case "cy_analyst":
      return "Calabi-Yau";
    case "reference_seeker":
      return "References";
    case "step_verification":
      return "Step verifier";
    case "full_verification":
      return "Full verifier";
    case "user":
      return "User";
    default:
      return tool;
  }
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
