import { type Theme } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";
interface McpRowState {
    mcpStatus?: "pending" | "success" | "error";
    mcpNames?: McpToolNames;
    mcpWarning?: boolean;
}
interface RendererContext {
    state?: McpRowState;
    lastComponent: Component | undefined;
    isPartial: boolean;
    isError: boolean;
}
interface ResultRenderOptions {
    expanded: boolean;
    isPartial: boolean;
}
type McpToolNames = {
    serverName: string;
    toolName: string;
} | {
    fullName: string;
};
export declare function renderMcpToolCall(args: unknown, names: McpToolNames, theme: Theme, context: RendererContext): Component;
export declare function renderMcpToolResult(result: unknown, options: ResultRenderOptions, theme: Theme, context: RendererContext): Component;
export {};
//# sourceMappingURL=renderers.d.ts.map