import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";
import type { McpServerState } from "./types.js";
export interface McpInventoryServer {
    name: string;
    status: string;
    tools: string[];
}
export interface McpInventory {
    servers: McpInventoryServer[];
    verbose: boolean;
    notice?: string;
}
/** Captures display-only fields, never transport configuration or credentials. */
export declare function inventoryServer(name: string, state: McpServerState | undefined): McpInventoryServer;
/** Renders a durable inventory outside model context. */
export declare function inventoryComponent(inventory: McpInventory, theme: Pick<Theme, "fg" | "bold">): Component;
//# sourceMappingURL=status-ui.d.ts.map