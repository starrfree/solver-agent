import { Injectable, effect, signal } from "@angular/core";

const STORAGE_KEY = "solver-agent.layout";

interface LayoutState {
  sidebarWidth: number;
  artifactsWidth: number;
  sidebarCollapsed: boolean;
}

const DEFAULT_STATE: LayoutState = {
  sidebarWidth: 280,
  artifactsWidth: 420,
  sidebarCollapsed: false,
};

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 360;
export const ARTIFACTS_MIN = 320;
export const ARTIFACTS_MAX = 560;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

@Injectable({ providedIn: "root" })
export class LayoutService {
  readonly sidebarWidth = signal(DEFAULT_STATE.sidebarWidth);
  readonly artifactsWidth = signal(DEFAULT_STATE.artifactsWidth);
  readonly sidebarCollapsed = signal(DEFAULT_STATE.sidebarCollapsed);
  readonly artifactsOpen = signal(false);

  /**
   * One-shot flag to skip the next selection-driven auto-open of the artifacts
   * panel. Used when an entry is selected for navigation only (e.g. a side-talk
   * "loaded entry" flag scrolls to the step without revealing artifacts). Kept
   * as a plain field — not a signal — so reading it inside the auto-open effect
   * doesn't create a reactive dependency.
   */
  suppressNextArtifactAutoOpen = false;

  constructor() {
    this.load();
    effect(() => {
      const value: LayoutState = {
        sidebarWidth: this.sidebarWidth(),
        artifactsWidth: this.artifactsWidth(),
        sidebarCollapsed: this.sidebarCollapsed(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      } catch {
        // ignore
      }
    });
  }

  setSidebarWidth(value: number): void {
    this.sidebarWidth.set(clamp(value, SIDEBAR_MIN, SIDEBAR_MAX));
  }

  setArtifactsWidth(value: number): void {
    this.artifactsWidth.set(clamp(value, ARTIFACTS_MIN, ARTIFACTS_MAX));
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  openArtifacts(): void {
    this.artifactsOpen.set(true);
  }

  closeArtifacts(): void {
    this.artifactsOpen.set(false);
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<LayoutState>;
      if (typeof parsed.sidebarWidth === "number") {
        this.sidebarWidth.set(clamp(parsed.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX));
      }
      if (typeof parsed.artifactsWidth === "number") {
        this.artifactsWidth.set(clamp(parsed.artifactsWidth, ARTIFACTS_MIN, ARTIFACTS_MAX));
      }
      if (typeof parsed.sidebarCollapsed === "boolean") {
        this.sidebarCollapsed.set(parsed.sidebarCollapsed);
      }
    } catch {
      // ignore
    }
  }
}
