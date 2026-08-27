import { truncateToWidth } from "@earendil-works/pi-tui";

export interface FitToWidthOptions {
  ellipsis?: string;
}

export function normalizeWidth(width: number): number {
  if (!Number.isFinite(width)) return 0;
  return Math.max(0, Math.floor(width));
}

export function fitToWidth(
  text: string,
  width: number,
  options: FitToWidthOptions = {},
): string {
  const safeWidth = normalizeWidth(width);
  if (safeWidth === 0) return "";
  return truncateToWidth(text, safeWidth, options.ellipsis ?? "");
}
