import { Injectable, effect, signal } from "@angular/core";

export type Theme = "light" | "dark";

const STORAGE_KEY = "solver-agent.theme";

@Injectable({ providedIn: "root" })
export class ThemeService {
  readonly theme = signal<Theme>(this.detectInitial());

  constructor() {
    effect(() => {
      const value = this.theme();
      try {
        document.documentElement.dataset["theme"] = value;
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // ignore
      }
    });
  }

  toggle(): void {
    this.theme.update((t) => (t === "dark" ? "light" : "dark"));
  }

  private detectInitial(): Theme {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // ignore
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      return prefersLight ? "light" : "dark";
    }
    return "dark";
  }
}
