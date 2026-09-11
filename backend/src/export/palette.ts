/**
 * Shared colour palette for the exported documents.
 *
 * The hues mirror the web UI's light theme (`frontend/src/styles/_tokens.scss`)
 * so a step looks the same in the app, in `report.html` and in the PDF built
 * from `report.tex`. Renderers use the
 * saturated value for text, strokes and accents, and a white-mixed tint
 * (`tint()`) for backgrounds, which keeps the documents soft on the eye.
 */
import type { LedgerEntryStatus, LedgerEntryType } from "../db/types";

export const TYPE_COLOR_HEX: Record<LedgerEntryType, string> = {
  assumption: "#1F7FC4",
  derivation: "#7C4ED0",
  result: "#C451A6",
  symbolic_computation: "#2B53E0",
  numerical_computation: "#167D4F",
  cy_analyst_computation: "#0891B2",
  reference_lookup: "#5B6275",
  verification: "#B3811A",
  correction: "#C52941",
  final_answer: "#C46F1A",
  problem_followup: "#0E8A82",
};

export const STATUS_COLOR_HEX: Record<LedgerEntryStatus, string> = {
  pending: "#B3811A",
  accepted: "#167D4F",
  rejected: "#C52941",
  superseded: "#8A91A3",
};

export const UI_COLOR_HEX = {
  accent: "#2B53E0",
  ink: "#14171F",
  muted: "#5B6275",
  subtle: "#8A91A3",
  surface: "#F1F3F8",
  surfaceDeep: "#E7EAF2",
  rule: "#D9DDE7",
  codeBg: "#F8F9FB",
} as const;

/** Mix a `#rrggbb` colour with white; `amount` = 1 keeps the colour, 0 gives white. */
export function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * amount);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Mix a `#rrggbb` colour with black; `amount` = 1 keeps the colour, 0 gives black. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c * amount);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}
