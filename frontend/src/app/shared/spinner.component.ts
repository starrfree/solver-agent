import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

@Component({
  selector: "sa-spinner",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="spinner"
    role="status"
    [attr.aria-label]="label"
    [style.--sa-spinner-size.px]="size"
  ></span>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .spinner {
        --sa-spinner-size: 16px;
        width: var(--sa-spinner-size);
        height: var(--sa-spinner-size);
        border-radius: 50%;
        border: 2px solid var(--sa-border);
        border-top-color: var(--sa-accent);
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class SpinnerComponent {
  @Input() size = 16;
  @Input() label = "Loading";
}
