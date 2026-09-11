export declare const MAX_HISTORY_FILE_BYTES: number;
export declare const MAX_HISTORY_IDENTITIES = 4096;
export declare const MAX_HISTORY_NAME_BYTES = 1024;
/** Display-only identity recovered from session history. */
export interface HistoryIdentity {
    fullName: string;
    serverName?: string;
    toolName?: string;
}
/** Collects MCP display identities across all session branches. */
export declare function collectHistoryIdentities(entries: readonly unknown[]): HistoryIdentity[];
/** Reads a bounded session file without opening or migrating a SessionManager. */
export declare function readHistoryIdentities(path: string): HistoryIdentity[];
/** Reads only regular files, rejecting symlinks, growth, and oversized input. */
export declare function readBoundedFile(path: string, maxBytes: number, privateFile?: boolean): string;
//# sourceMappingURL=history.d.ts.map