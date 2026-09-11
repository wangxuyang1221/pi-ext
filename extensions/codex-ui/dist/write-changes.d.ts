import { createWriteToolDefinition, type ToolDefinition } from "@earendil-works/pi-coding-agent";
type WriteDefinition = ReturnType<typeof createWriteToolDefinition>;
export interface CodexWriteChange {
    version: 1;
    action?: "Added" | "Edited";
    patch?: string;
}
export interface CodexWriteDetails {
    codexWrite: CodexWriteChange;
}
/** Capture local write metadata inside the built-in mutation queue, isolated per call. */
export declare function createObservedWriteDefinition(cwd: string, isLowPowerEnabled?: () => boolean): ToolDefinition<WriteDefinition["parameters"], CodexWriteDetails | undefined>;
export {};
//# sourceMappingURL=write-changes.d.ts.map