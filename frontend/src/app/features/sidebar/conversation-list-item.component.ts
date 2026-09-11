import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

import { Conversation } from "../../core/api/dto";
import { relativeTime } from "../../core/utils/time";
import { IconComponent } from "../../shared/icon.component";
import { StatusPillComponent } from "../../shared/status-pill.component";

@Component({
  selector: "sa-conversation-list-item",
  standalone: true,
  imports: [IconComponent, StatusPillComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="item-wrap" [class.active]="active()">
    <button
      type="button"
      class="item"
      (click)="selectItem.emit(conversation()._id)"
    >
      <div class="row">
        <span class="title" [title]="conversation().title">{{
          conversation().title
        }}</span>
        <span class="time">{{ time() }}</span>
      </div>
      <div class="row">
        <sa-status-pill [status]="conversation().status" />
      </div>
    </button>
    <button
      type="button"
      class="delete-btn"
      title="Delete conversation"
      aria-label="Delete conversation"
      (click)="onDeleteClick($event)"
    >
      <sa-icon name="trash-2" [size]="14" />
    </button>
  </div>`,
  styles: [
    `
      .item-wrap {
        position: relative;
        display: block;
        border-radius: var(--sa-radius-md);
        border: 1px solid transparent;
        transition:
          background var(--sa-transition-fast),
          border-color var(--sa-transition-fast);
      }
      .item-wrap:hover {
        background: var(--sa-surface-hover);
      }
      .item-wrap.active {
        background: var(--sa-surface-active);
        border-color: var(--sa-border);
      }
      .item {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
        padding: 10px 36px 10px 12px;
        text-align: left;
        background: transparent;
        border: none;
        color: var(--sa-text);
        cursor: pointer;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .title {
        font-size: var(--sa-fs-base);
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1 1 auto;
        min-width: 0;
      }
      .time {
        font-size: var(--sa-fs-xs);
        color: var(--sa-text-subtle);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
      }
      .delete-btn {
        position: absolute;
        top: 50%;
        right: 6px;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--sa-text-subtle);
        border-radius: var(--sa-radius-sm);
        opacity: 0;
        cursor: pointer;
        transition:
          opacity var(--sa-transition-fast),
          background var(--sa-transition-fast),
          color var(--sa-transition-fast);
      }
      .item-wrap:hover .delete-btn,
      .item-wrap:focus-within .delete-btn {
        opacity: 1;
      }
      .delete-btn:hover {
        background: var(--sa-surface-hover);
        color: var(--sa-danger, #e5484d);
      }
    `,
  ],
})
export class ConversationListItemComponent {
  readonly conversation = input.required<Conversation>();
  readonly active = input(false);
  readonly selectItem = output<string>();
  readonly deleteItem = output<string>();

  readonly time = computed(() => relativeTime(this.conversation().updatedAt));

  protected onDeleteClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.deleteItem.emit(this.conversation()._id);
  }
}
