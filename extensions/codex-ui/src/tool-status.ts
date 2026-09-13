import type { Theme } from "@earendil-works/pi-coding-agent";

export const TOOL_STATUS_GLYPH = "⏺";
export type ToolFailureStatus = "failed" | "interrupted" | "timed_out";
export type ToolStatus = "pending" | "running" | "completed" | ToolFailureStatus;

const COLORS = { pending: "warning", running: "warning", completed: "success", failed: "error", interrupted: "warning", timed_out: "warning" } as const;

type Content = readonly { type: string; text?: string }[];

/** Native file tools throw this exact diagnostic; ordinary prose is not a status. */
export function fileFailureStatus(content: Content | undefined): ToolFailureStatus {
  return content?.length === 1 && content[0]?.type === "text" && content[0].text === "Operation aborted"
    ? "interrupted" : "failed";
}

/** Native Bash appends a final diagnostic after a blank separator. Inspect only its bounded tail. */
export function bashFailureStatus(content: Content): ToolFailureStatus {
  const text = content.length === 1 && content[0]?.type === "text" ? content[0].text : undefined;
  const tail = typeof text === "string" ? text.slice(-256) : "";
  if (/(?:^|\n\n)Command aborted$/u.test(tail)) return "interrupted";
  if (/(?:^|\n\n)Command timed out after \d+(?:\.\d+)? seconds$/u.test(tail)) return "timed_out";
  return "failed";
}

export function toolStatusColor(status: ToolStatus): typeof COLORS[ToolStatus] {
  return COLORS[status];
}

export function toolStatusMarker(theme: Theme, status: ToolStatus): string {
  return theme.fg(toolStatusColor(status), TOOL_STATUS_GLYPH);
}
