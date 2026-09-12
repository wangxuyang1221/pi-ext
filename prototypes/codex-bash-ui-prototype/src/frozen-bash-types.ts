// PROTOTYPE: Historical layout inputs, independent of the current production ownership model.
import type { BashToolDetails } from "@earendil-works/pi-coding-agent";
import type { RenderCacheScope } from "../../../extensions/codex-ui/src/render-cache.js";
export type BashStatus = "pending" | "running" | "completed" | "failed";
export interface BashMember {
  id: string;
  cache: RenderCacheScope;
  group: BashGroup;
  command: string;
  commandRevision: number;
  outputRevision: number;
  status: BashStatus;
  content?: Array<{ type: string; text?: string }>;
  details?: BashToolDetails;
  startedAt?: number;
  endedAt?: number;
}
export interface BashGroup {
  timerKey: string;
  members: BashMember[];
  counts: Record<BashStatus, number>;
  running: Set<BashMember>;
}
