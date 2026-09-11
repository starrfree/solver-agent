import { ChangeDetectionStrategy, Component, effect, inject } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { map } from "rxjs";

import { ConversationStoreService } from "./core/state/conversation-store.service";

/**
 * Route component for `/c/:id`. Synchronizes the URL `:id` parameter into
 * `ConversationStoreService.selectedConversationId`. The visible UI is
 * rendered by `<sa-content>` in `AppComponent`.
 */
@Component({
  selector: "sa-conversation-view",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class ConversationViewComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(ConversationStoreService);

  private readonly id = toSignal(
    this.route.paramMap.pipe(map((p) => p.get("id"))),
    { initialValue: null },
  );

  constructor() {
    effect(() => {
      const id = this.id();
      this.store.selectConversation(id);
    });
  }
}
