import { Client, type ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpDiagnostics } from "./diagnostics.js";
import { type McpRetryScheduler } from "./retry.js";
import type { McpConnectionStatus, McpManagerEvent, McpNormalizedError, McpServerConfig, McpServerState, McpTool, McpToolResult } from "./types.js";
type ConnectionSource = "initial" | "manual" | "background";
export interface McpConnectOptions {
    source?: ConnectionSource;
    signal?: AbortSignal;
}
export interface McpReconnectOptions {
    source?: "manual";
    signal?: AbortSignal;
}
export interface McpCallOptions {
    signal?: AbortSignal;
}
export interface McpTransportFactoryContext {
    serverName: string;
    fetch: FetchLike;
}
export interface McpClientManagerOptions {
    diagnostics?: McpDiagnostics;
    scheduler?: McpRetryScheduler;
    random?: () => number;
    now?: () => number;
    fetch?: FetchLike;
    clientFactory?: (options: ClientOptions) => Client;
    transportFactory?: (config: McpServerConfig, context: McpTransportFactoryContext) => Transport;
}
/** A bounded, normalized connection failure suitable for user-facing surfaces. */
export declare class McpConnectionError extends Error {
    readonly serverName: string;
    readonly normalizedError?: McpNormalizedError | undefined;
    readonly outcomeUnknown: boolean;
    constructor(serverName: string, message: string, normalizedError?: McpNormalizedError | undefined, outcomeUnknown?: boolean);
}
/** A compatibility error class for callers that previously matched timeout failures. */
export declare class McpTimeoutError extends McpConnectionError {
    constructor(serverName: string, timeoutMs: number, normalizedError?: McpNormalizedError);
}
/** A compatibility error class for callers that previously matched authentication failures. */
export declare class McpAuthError extends McpConnectionError {
    constructor(serverName: string, detail: string, normalizedError?: McpNormalizedError);
}
/** A tool or routing error that did not require transport recovery. */
export declare class McpToolError extends Error {
    readonly serverName: string;
    readonly toolName: string;
    readonly normalizedError?: McpNormalizedError | undefined;
    constructor(serverName: string, toolName: string, message: string, normalizedError?: McpNormalizedError | undefined);
}
/**
 * Owns MCP clients, transport lifecycles, bounded retries, and stable tool routes.
 * The class intentionally has no stdout or stderr sink.
 */
export declare class McpClientManager {
    readonly diagnostics: McpDiagnostics;
    private readonly scheduler;
    private readonly random;
    private readonly now;
    private readonly baseFetch;
    private readonly clientFactory;
    private readonly transportFactory?;
    private readonly runtimes;
    private readonly listeners;
    private readonly toolRoutes;
    private readonly retiredToolRoutes;
    private readonly toolCache;
    private lifecycleGeneration;
    private httpObservationSequence;
    private selfHealAttempted;
    private disconnecting;
    constructor(options?: McpClientManagerOptions);
    /** Subscribes to immutable state and tool-catalog events. */
    subscribe(listener: (event: McpManagerEvent) => void): () => void;
    /** Connects one server with a single total deadline and bounded retries. */
    connectServer(name: string, config: McpServerConfig, options?: McpConnectOptions): Promise<McpServerState>;
    /** Reconnects a configured server immediately and wakes any background supervisor. */
    reconnectServer(name: string, options?: McpReconnectOptions): Promise<McpServerState>;
    /** Records a disabled or invalid configured server without attempting a connection. */
    setUnavailableServer(name: string, status: Extract<McpConnectionStatus, "offline" | "disabled">, error?: string): McpServerState;
    /** Executes one tool call and applies the configured safe replay policy. */
    callTool(fullToolName: string, args: Record<string, unknown>, options?: McpCallOptions): Promise<McpToolResult>;
    /** Disconnects one server while retaining its catalog for future recovery. */
    disconnectServer(name: string): Promise<void>;
    /** Cancels all work, closes all clients once, and clears session-owned state. */
    disconnectAll(): Promise<void>;
    /** Lifecycle alias used by the extension shutdown hook. */
    shutdown(): Promise<void>;
    /** Compatibility helper that reconnects every missing configured server once. */
    selfHeal(config: Record<string, McpServerConfig>): Promise<number>;
    resetSelfHeal(): void;
    isSelfHealAttempted(): boolean;
    getAllTools(): Map<string, McpTool>;
    getServerState(name: string): McpServerState | undefined;
    getServerSnapshot(name: string): McpServerState | undefined;
    getAllServerStates(): McpServerState[];
    getSnapshots(): McpServerState[];
    getConnectionCount(): number;
    isServerConnected(name: string): boolean;
    hasConnections(): boolean;
    mcpToolName(server: string, tool: string): string;
    getAllConnectionPids(): number[];
    private createRuntime;
    private runForegroundConnect;
    private performConnectionAttempt;
    private listAllTools;
    private commitConnection;
    private replaceToolCatalog;
    private rebuildToolRoutes;
    private emitToolCatalogs;
    private attachClientHandlers;
    private attachLoggingHandler;
    private handleOutOfBandError;
    private attachStderr;
    private createTransport;
    private createBoundedFetch;
    private invokeTool;
    private normalizeConnectFailure;
    private normalizeToolFailure;
    private recordConnectFailure;
    private dropConnection;
    private startSupervisor;
    private stopRuntimeWork;
    private closeConnectionHandle;
    private updateState;
    private publishState;
    private emit;
    private snapshot;
    private isCurrent;
    private unavailableState;
}
export {};
//# sourceMappingURL=client.d.ts.map