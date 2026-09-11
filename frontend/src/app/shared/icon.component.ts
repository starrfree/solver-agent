import { ChangeDetectionStrategy, Component, Input } from "@angular/core";
import { LucideAngularModule } from "lucide-angular";

/**
 * Thin wrapper around `<lucide-icon>` that bakes in our default size and
 * stroke width and exposes a `name` input for the icon kebab-case identifier.
 *
 * Usage: `<sa-icon name="plus" size="16" />`
 */
@Component({
  selector: "sa-icon",
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<lucide-icon
    [name]="name"
    [size]="size"
    [strokeWidth]="strokeWidth"
    [color]="'currentColor'"
  />`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
        color: currentColor;
      }
      lucide-icon {
        display: inline-flex;
      }
    `,
  ],
})
export class IconComponent {
  @Input({ required: true }) name!: string;
  @Input() size = 16;
  @Input() strokeWidth = 1.75;
}
