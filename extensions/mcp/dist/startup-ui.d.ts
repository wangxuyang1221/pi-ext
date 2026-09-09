import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
/** Owns one initial startup batch and its optional interactive status row. */
export declare class McpStartup {
    private readonly ctx;
    private readonly isConnected;
    private readonly onInterrupt;
    private readonly pending;
    private readonly total;
    private readonly startedAt;
    private header;
    private timer?;
    private detachInput?;
    private requestRender?;
    private stopped;
    private mounted;
    constructor(names: string[], ctx: ExtensionContext, isConnected: (name: string) => boolean, onInterrupt: (names: string[]) => void);
    signal(name: string): AbortSignal | undefined;
    settle(name: string): void;
    /** Cancels unfinished work when its owning session is replaced or closed. */
    dispose(): void;
    private stop;
    private updateHeader;
}
//# sourceMappingURL=startup-ui.d.ts.map