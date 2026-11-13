import type { Component } from "@earendil-works/pi-tui";

// Optional contracts are structural: stock Pi never declares these patch APIs.
export interface TextRegionHandle {
  requestRender(): void;
  dispose(): void;
}
export interface TextRegionCapability {
  registerTextRegion?(component: Component): TextRegionHandle;
}
export type SessionSummaryTransformer = (text: string, context: { role: "user" | "assistant"; sessionId: string }) => string | undefined;
export interface SessionSummaryCapability {
  registerSessionSummaryTransformer?(transformer: SessionSummaryTransformer): void;
}
