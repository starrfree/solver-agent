import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from "@angular/core";

import { LedgerEntryArtifact } from "../../core/api/dto";
import { ConversationStoreService } from "../../core/state/conversation-store.service";
import { LayoutService } from "../../core/state/layout.service";
import { EmptyStateComponent } from "../../shared/empty-state.component";
import { IconComponent } from "../../shared/icon.component";
import { CodeTabComponent } from "./tabs/code-tab.component";
import { EntryContentTabComponent } from "./tabs/entry-content-tab.component";
import { FilesTabComponent } from "./tabs/files-tab.component";
import { FinalAnswerTabComponent } from "./tabs/final-answer-tab.component";
import { OutputTabComponent } from "./tabs/output-tab.component";
import { PlotTabComponent } from "./tabs/plot-tab.component";

type TabId = "code" | "output" | "plots" | "files" | "content" | "final";

interface TabSpec {
  id: TabId;
  label: string;
  icon: string;
  show: boolean;
}

@Component({
  selector: "sa-artifacts-panel",
  standalone: true,
  imports: [
    IconComponent,
    EmptyStateComponent,
    CodeTabComponent,
    OutputTabComponent,
    PlotTabComponent,
    FilesTabComponent,
    EntryContentTabComponent,
    FinalAnswerTabComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<aside class="panel">
    <header class="header">
      <div class="title">
        <sa-icon name="layers" [size]="16" />
        <span>Artifacts</span>
        @if (entry(); as e) {
          <span class="entry-id">{{ shortId(e._id) }}</span>
        }
      </div>
      <button
        type="button"
        class="icon-btn"
        (click)="layout.closeArtifacts()"
        aria-label="Close panel"
      >
        <sa-icon name="x" [size]="16" />
      </button>
    </header>

    @if (entry() || hasFinal()) {
      <nav class="tabs">
        @for (t of tabs(); track t.id) {
          @if (t.show) {
            <button
              type="button"
              class="tab"
              [class.active]="active() === t.id"
              (click)="setActive(t.id)"
            >
              <sa-icon [name]="t.icon" [size]="13" />
              <span>{{ t.label }}</span>
            </button>
          }
        }
      </nav>
      <div class="body">
        @switch (active()) {
          @case ("code") {
            <sa-code-tab [source]="codeSource()" />
          }
          @case ("output") {
            <sa-output-tab [stdout]="stdout()" [stderr]="stderr()" />
          }
          @case ("plots") {
            <sa-plot-tab [files]="files()" />
          }
          @case ("files") {
            <sa-files-tab [files]="files()" />
          }
          @case ("content") {
            <sa-entry-content-tab [entry]="entry()" />
          }
          @case ("final") {
            <sa-final-answer-tab [answer]="finalAnswer()" />
          }
        }
      </div>
    } @else {
      <sa-empty-state
        icon="paperclip"
        title="No artifact selected"
        message="Click 'View artifacts' on a ledger entry to inspect its code, output, plots and files."
        [showCta]="false"
      />
    }
  </aside>`,
  styleUrls: ["./artifacts-panel.component.scss"],
})
export class ArtifactsPanelComponent {
  protected readonly store = inject(ConversationStoreService);
  protected readonly layout = inject(LayoutService);

  readonly entry = this.store.selectedEntry;
  readonly active = signal<TabId>("code");

  readonly codeSource = computed(() => this.entry()?.artifacts?.code ?? "");
  readonly stdout = computed(() => this.entry()?.artifacts?.stdout ?? "");
  readonly stderr = computed(() => this.entry()?.artifacts?.stderr ?? "");
  readonly files = computed<LedgerEntryArtifact[]>(
    () => this.entry()?.artifacts?.files ?? [],
  );

  readonly hasCode = computed(() => Boolean(this.codeSource()));
  readonly hasOutput = computed(() => Boolean(this.stdout() || this.stderr()));
  readonly hasPlots = computed(() =>
    this.files().some(
      (f) => f.mimeType.startsWith("image/") || f.name.toLowerCase().endsWith(".png"),
    ),
  );
  readonly hasFiles = computed(() =>
    this.files().some(
      (f) =>
        !(
          f.mimeType.startsWith("image/") || f.name.toLowerCase().endsWith(".png")
        ),
    ),
  );

  readonly finalAnswer = computed(() => this.store.ledger()?.finalAnswer ?? "");
  readonly hasFinal = computed(() => {
    const ledger = this.store.ledger();
    if (!ledger?.finalAnswer) return false;
    return ledger.status === "verified" || ledger.status === "solved";
  });

  readonly tabs = computed<TabSpec[]>(() => [
    { id: "code", label: "Code", icon: "code-2", show: this.hasCode() },
    { id: "output", label: "Output", icon: "terminal", show: this.hasOutput() },
    { id: "plots", label: "Plots", icon: "image", show: this.hasPlots() },
    { id: "files", label: "Files", icon: "file", show: this.hasFiles() },
    {
      id: "content",
      label: "Content",
      icon: "text-align-start",
      show: Boolean(this.entry()),
    },
    // Conversation-level final answer, shown only when no entry is selected.
    {
      id: "final",
      label: "Final answer",
      icon: "flag",
      show: this.hasFinal() && !this.entry(),
    },
  ]);

  constructor() {
    // Whenever the selected entry changes (or visible tabs change), prefer
    // the first available tab that has content; fall back to "final" when
    // no entry is selected but a final answer exists.
    effect(() => {
      const tabs = this.tabs();
      const visible = tabs.filter((t) => t.show);
      if (visible.length === 0) return;
      const current = this.active();
      if (visible.some((t) => t.id === current)) return;
      const preferred = this.entry() ? visible[0] : visible.find((t) => t.id === "final") ?? visible[0];
      this.active.set(preferred.id);
    });
  }

  setActive(id: TabId): void {
    this.active.set(id);
  }

  shortId(id: string): string {
    const stripped = id.includes("_") ? id.split("_").slice(1).join("_") : id;
    return stripped.slice(0, 8);
  }
}

export type { TabId };
