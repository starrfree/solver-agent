const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Compact human-friendly relative time, e.g. "just now", "3m", "5h",
 * "Tue", or "Mar 14".
 */
export function relativeTime(input: string | Date | null | undefined): string {
  if (!input) return "";
  const date = typeof input === "string" ? new Date(input) : input;
  const time = date.getTime();
  if (Number.isNaN(time)) return "";

  const diff = Date.now() - time;

  if (diff < 30_000) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < WEEK) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function absoluteTime(input: string | Date | null | undefined): string {
  if (!input) return "";
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
