import { Injectable } from "@angular/core";

/**
 * Persists in-progress prompt drafts to localStorage so that closing the app,
 * switching conversations or dismissing a dialog doesn't lose partially
 * composed text. Empty drafts are removed so storage doesn't accumulate blank
 * entries.
 */
@Injectable({ providedIn: "root" })
export class DraftStoreService {
  private static readonly PREFIX = "solver-agent.draft.";

  load(key: string): string {
    try {
      return localStorage.getItem(DraftStoreService.PREFIX + key) ?? "";
    } catch {
      return "";
    }
  }

  save(key: string, value: string): void {
    try {
      if (value.trim().length === 0) {
        localStorage.removeItem(DraftStoreService.PREFIX + key);
      } else {
        localStorage.setItem(DraftStoreService.PREFIX + key, value);
      }
    } catch {
      // Ignore persistence failures (private mode, quota exceeded).
    }
  }

  clear(key: string): void {
    this.save(key, "");
  }
}
