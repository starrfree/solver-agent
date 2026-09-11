import { ChangeDetectionStrategy, Component, effect, inject } from "@angular/core";

import { ConversationStoreService } from "./core/state/conversation-store.service";

/**
 * Route component for `/`. Clears the active conversation so the content
 * pane shows its empty-state placeholder. The actual UI lives in
 * `<sa-content>` rendered by `AppComponent`.
 */
@Component({
  selector: "sa-empty-state-route",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class EmptyStateRouteComponent {
  private readonly store = inject(ConversationStoreService);

  constructor() {
    effect(() => {
      this.store.selectConversation(null);
    });
  }
}
