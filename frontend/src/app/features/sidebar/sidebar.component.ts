import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";

import { ConversationStoreService } from "../../core/state/conversation-store.service";
import { LayoutService } from "../../core/state/layout.service";
import { ThemeService } from "../../core/state/theme.service";
import { UserService } from "../../core/state/user.service";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog.component";
import { IconComponent } from "../../shared/icon.component";
import { SpinnerComponent } from "../../shared/spinner.component";
import { ConversationListItemComponent } from "./conversation-list-item.component";
import {
  NewConversationDialogComponent,
  NewConversationPayload,
} from "./new-conversation-dialog.component";

@Component({
  selector: "sa-sidebar",
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
    ConversationListItemComponent,
    NewConversationDialogComponent,
    ConfirmDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./sidebar.component.html",
  styleUrl: "./sidebar.component.scss",
})
export class SidebarComponent {
  protected readonly store = inject(ConversationStoreService);
  protected readonly layout = inject(LayoutService);
  protected readonly theme = inject(ThemeService);
  protected readonly user = inject(UserService);
  private readonly router = inject(Router);

  readonly query = signal("");
  readonly dialogOpen = signal(false);
  readonly pendingDeleteId = signal<string | null>(null);

  readonly pendingDeleteConversation = computed(() => {
    const id = this.pendingDeleteId();
    if (!id) return null;
    return this.store.conversations().find((c) => c._id === id) ?? null;
  });

  readonly pendingDeleteMessage = computed(() => {
    const conv = this.pendingDeleteConversation();
    const title = conv?.title ?? "this conversation";
    return `Delete conversation “${title}”? This will permanently remove its ledger, messages, and generated files. This action cannot be undone.`;
  });

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.store.conversations();
    return this.store
      .conversations()
      .filter((c) => c.title.toLowerCase().includes(q));
  });

  readonly userInitial = computed(() => {
    const id = this.user.userId();
    return id.replace("local-", "").slice(0, 2).toUpperCase();
  });

  openDialog(): void {
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  createConversation(payload: NewConversationPayload): void {
    this.store
      .createConversation(payload.problem, payload.reasoningSpeed, {
        cyAnalyst: payload.cyAnalyst,
        referenceSeeker: payload.referenceSeeker,
      })
      .subscribe((id) => {
        void this.router.navigate(["/c", id]);
      });
    this.closeDialog();
  }

  onSelect(id: string): void {
    void this.router.navigate(["/c", id]);
  }

  onDelete(id: string): void {
    this.pendingDeleteId.set(id);
  }

  cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  confirmDelete(): void {
    const id = this.pendingDeleteId();
    if (!id) return;
    this.pendingDeleteId.set(null);
    const wasSelected = this.store.selectedConversationId() === id;
    this.store.deleteConversation(id).subscribe({
      next: () => {
        if (wasSelected) {
          void this.router.navigate(["/"]);
        }
      },
      error: (err) => {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as { message?: unknown }).message)
            : "Failed to delete conversation.";
        window.alert(message);
      },
    });
  }

  toggleTheme(): void {
    this.theme.toggle();
  }

  toggleCollapse(): void {
    this.layout.toggleSidebar();
  }

  @HostListener("window:sa:new-conversation")
  onNewConversationShortcut(): void {
    this.openDialog();
  }
}
