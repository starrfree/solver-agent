import { Injectable, signal } from "@angular/core";

const STORAGE_KEY = "solver-agent.userId";

function generateLocalUserId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `local-${rnd}`;
}

@Injectable({ providedIn: "root" })
export class UserService {
  /** Stable, locally-generated user id. Persisted across reloads. */
  readonly userId = signal<string>(this.load());

  private load(): string {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing && existing.length > 0) return existing;
    } catch {
      // localStorage may be unavailable (e.g. SSR); fall through.
    }
    const fresh = generateLocalUserId();
    try {
      localStorage.setItem(STORAGE_KEY, fresh);
    } catch {
      // ignore
    }
    return fresh;
  }
}
