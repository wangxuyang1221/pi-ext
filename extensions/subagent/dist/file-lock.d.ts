export interface FileLock {
    token: string;
    assertOwned(): Promise<void>;
    release(): Promise<void>;
}
/** No time-based takeover: only a local owner's confirmed absence permits recovery. */
export declare function acquireFileLock(path: string, signal?: AbortSignal, timeoutMs?: number): Promise<FileLock>;
//# sourceMappingURL=file-lock.d.ts.map