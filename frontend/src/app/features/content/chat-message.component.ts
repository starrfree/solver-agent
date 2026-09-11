import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

import { ConversationMessage } from "../../core/api/dto";
import { absoluteTime } from "../../core/utils/time";
import { CopyButtonComponent } from "../../shared/copy-button.component";
import { IconComponent } from "../../shared/icon.component";
import { MarkdownComponent } from "../../shared/markdown.component";

@Component({
  selector: "sa-chat-message",
  standalone: true,
  imports: [CopyButtonComponent, IconComponent, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<article class="msg" [class.user]="isUser()" [class.assistant]="!isUser()">
    <div class="meta">
      <span class="role">{{ isUser() ? "You" : "Solver Agent" }}</span>
      <span class="dot">·</span>
      <span class="ts" [title]="absolute()">{{ absolute() }}</span>
    </div>
    <div class="bubble">
      <sa-markdown [source]="message().content" [escapeHtml]="isUser()" />
      <div class="actions">
        <button
          type="button"
          class="fork-btn"
          (click)="fork.emit()"
          title="Fork conversation from here"
          aria-label="Fork conversation from this message"
        >
          <span class="fork-glyph"><sa-icon name="split" [size]="14" /></span>
        </button>
        <sa-copy-button [value]="message().content" title="Copy message (with LaTeX)" />
      </div>
    </div>
  </article>`,
  styles: [
    `
      .msg {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-width: 100%;
      }
      .meta {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
      }
      .role {
        color: var(--sa-text-muted);
        font-weight: 600;
      }
      .ts {
        font-variant-numeric: tabular-nums;
      }
      .bubble {
        position: relative;
        padding: 20px 30px;
        border-radius: var(--sa-radius-lg);
        background: var(--sa-surface);
        border: 1px solid var(--sa-border);
      }
      .bubble ::ng-deep img {
        max-width: 800px;
        width: 100%;
        height: auto;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }
      .msg.user .bubble {
        background: var(--sa-accent-soft);
        border-color: transparent;
      }
      .actions {
        position: absolute;
        right: 6px;
        bottom: 6px;
        display: flex;
        align-items: center;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--sa-transition-fast);
      }
      .bubble:hover .actions,
      .bubble:focus-within .actions {
        opacity: 1;
      }
      .fork-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: var(--sa-radius-md);
        color: var(--sa-text-muted);
        border: 1px solid transparent;
        transition: all var(--sa-transition-fast);
      }
      .fork-btn:hover {
        background: var(--sa-surface-hover);
        color: var(--sa-text);
        border-color: var(--sa-border);
      }
      .fork-glyph {
        display: inline-flex;
        transform: rotate(90deg);
      }
    `,
  ],
})
export class ChatMessageComponent {
  readonly message = input.required<ConversationMessage>();
  readonly fork = output<void>();

  readonly isUser = computed(() => this.message().role === "user");
  readonly absolute = computed(() => absoluteTime(this.message().createdAt));
}
