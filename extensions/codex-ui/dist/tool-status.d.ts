import type { Theme } from "@earendil-works/pi-coding-agent";
export declare const TOOL_STATUS_GLYPH = "\u23FA";
export type ToolFailureStatus = "failed" | "interrupted" | "timed_out";
export type ToolStatus = "pending" | "running" | "completed" | ToolFailureStatus;
declare const COLORS: {
    readonly pending: "warning";
    readonly running: "warning";
    readonly completed: "success";
    readonly failed: "error";
    readonly interrupted: "warning";
    readonly timed_out: "warning";
};
type Content = readonly {
    type: string;
    text?: string;
}[];
/** Native file tools throw this exact diagnostic; ordinary prose is not a status. */
export declare function fileFailureStatus(content: Content | undefined): ToolFailureStatus;
/** Native Bash appends a final diagnostic after a blank separator. Inspect only its bounded tail. */
export declare function bashFailureStatus(content: Content): ToolFailureStatus;
export declare function toolStatusColor(status: ToolStatus): typeof COLORS[ToolStatus];
export declare function toolStatusMarker(theme: Theme, status: ToolStatus): string;
export {};
//# sourceMappingURL=tool-status.d.ts.map