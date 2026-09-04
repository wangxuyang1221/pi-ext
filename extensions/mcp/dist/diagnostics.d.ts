import type { McpFileLogConfig, McpNormalizedError } from "./types.js";
export declare const DEFAULT_DIAGNOSTIC_EVENTS = 100;
export declare const DEFAULT_DIAGNOSTIC_BYTES: number;
export declare const DEFAULT_STDERR_LINES = 100;
export declare const DEFAULT_STDERR_BYTES: number;
export declare const DEFAULT_FIELD_BYTES: number;
export declare const DEFAULT_USER_MESSAGE_WIDTH = 300;
export declare const DEFAULT_FILE_LOG_BYTES: number;
export declare const DEFAULT_DIAGNOSTIC_CLOSE_TIMEOUT_MS = 1000;
export declare const MIN_DIAGNOSTIC_BUFFER_BYTES = 512;
export type McpDiagnosticLevel = "debug" | "info" | "warn" | "error";
export interface McpDiagnosticEvent {
    timestamp: string;
    timestampMs: number;
    serverName: string;
    level: McpDiagnosticLevel;
    message: string;
    context: Record<string, unknown>;
    error?: McpNormalizedError;
    fingerprint: string;
    repeats: number;
    lastSeenAt: number;
}
export interface McpDiagnosticRecord {
    level: McpDiagnosticLevel;
    message: string;
    serverName?: string;
    context?: Record<string, unknown>;
    error?: unknown;
    normalizedError?: McpNormalizedError;
}
export interface McpDiagnosticsFileSystem {
    appendFile(path: string, data: string, options: {
        encoding: "utf8";
        mode: number;
    }): Promise<unknown>;
    chmod(path: string, mode: number): Promise<unknown>;
    mkdir(path: string, options: {
        recursive: true;
    }): Promise<unknown>;
    rename(oldPath: string, newPath: string): Promise<unknown>;
    rm(path: string, options: {
        force: true;
    }): Promise<unknown>;
    stat(path: string): Promise<{
        size: number;
    }>;
}
export interface McpDiagnosticsOptions {
    now?: () => number;
    eventLimit?: number;
    byteLimit?: number;
    stderrLineLimit?: number;
    stderrByteLimit?: number;
    fieldByteLimit?: number;
    dedupeWindowMs?: number;
    file?: McpFileLogConfig;
    fileSystem?: Partial<McpDiagnosticsFileSystem>;
}
export interface McpDiagnosticsCloseOptions {
    timeoutMs?: number;
}
export interface NormalizeMcpErrorOptions {
    timeoutMs?: number;
    deadlineExceeded?: boolean;
    signalAborted?: boolean;
    httpStatus?: number;
    retryAfterMs?: number;
    responseDetail?: string;
    responseTruncated?: boolean;
    responseOriginalBytes?: number;
    sessionExpired?: boolean;
}
interface FileSinkState {
    enabled: boolean;
    path?: string;
    maxBytes: number;
    failed?: string;
}
export declare class McpDiagnostics {
    private readonly now;
    private readonly eventLimit;
    private readonly byteLimit;
    private readonly stderrLineLimit;
    private readonly stderrByteLimit;
    private readonly fieldByteLimit;
    private readonly dedupeWindowMs;
    private readonly fileSystem;
    private readonly buffers;
    private fileSink;
    private fileQueue;
    private fileSinkGeneration;
    private acceptingFileWrites;
    private recordingFileFailure;
    constructor(options?: McpDiagnosticsOptions);
    configureFileSink(config: McpFileLogConfig | undefined): void;
    record(input: McpDiagnosticRecord): {
        event: McpDiagnosticEvent;
        duplicate: boolean;
    };
    recordStderr(serverName: string, line: string): void;
    getEvents(serverName?: string): McpDiagnosticEvent[];
    getStderr(serverName: string): string[];
    getStderrTail(serverName: string, count?: number): string[];
    clear(serverName?: string): void;
    getFileSinkStatus(): Readonly<FileSinkState>;
    flush(): Promise<void>;
    close(options?: McpDiagnosticsCloseOptions): Promise<void>;
    private getBuffer;
    private trimEvents;
    private recalculateEventBytes;
    private enqueueFileWrite;
    private bestEffortChmod;
}
export declare function normalizeMcpError(error: unknown, options?: NormalizeMcpErrorOptions): McpNormalizedError;
export declare function sanitizeDiagnosticValue(value: unknown, maxBytes?: number): unknown;
export declare function sanitizeDiagnosticText(value: string, maxBytes?: number): string;
export declare function summarizeHtml(value: string, httpStatus?: number): string;
export declare function truncateUtf8(value: string, maxBytes: number): {
    value: string;
    truncated: boolean;
    originalBytes: number;
};
export {};
//# sourceMappingURL=diagnostics.d.ts.map