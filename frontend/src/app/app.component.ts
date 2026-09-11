import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  effect,
  inject,
} from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { ConversationStoreService } from "./core/state/conversation-store.service";
import { LayoutService } from "./core/state/layout.service";
import { ArtifactsPanelComponent } from "./features/artifacts/artifacts-panel.component";
import { ContentComponent } from "./features/content/content.component";
import { SidebarComponent } from "./features/sidebar/sidebar.component";
import { IconComponent } from "./shared/icon.component";
import { ResizablePaneDirective } from "./shared/resizable-pane.directive";

@Component({
  selector: "sa-root",
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    ContentComponent,
    ArtifactsPanelComponent,
    IconComponent,
    ResizablePaneDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.scss",
})
export class AppComponent {
  protected readonly layout = inject(LayoutService);
  protected readonly store = inject(ConversationStoreService);

  constructor() {
    this.store.loadConversations();

    // When a brand-new ledger entry arrives that has artifacts, eagerly
    // open the artifacts panel so it's always discoverable. (The user can
    // still close it manually.)
    effect(() => {
      const id = this.store.selectedEntryId();
      if (!id) return;
      if (this.layout.suppressNextArtifactAutoOpen) {
        this.layout.suppressNextArtifactAutoOpen = false;
        return;
      }
      this.layout.openArtifacts();
    });
  }

  @HostListener("document:keydown", ["$event"])
  onShortcut(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      // Defer to the sidebar's "new conversation" CTA via a custom event.
      event.preventDefault();
      window.dispatchEvent(new CustomEvent("sa:new-conversation"));
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
      event.preventDefault();
      this.layout.toggleSidebar();
    }
  }
}
