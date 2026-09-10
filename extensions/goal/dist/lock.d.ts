/** A directory lock with a unique owner filename; no timeout-based stealing. */
export declare class WriterLock {
    private readonly directory;
    private readonly ownerFile;
    private closed;
    private constructor();
    static available(directory: string): Promise<boolean>;
    static acquire(directory: string, owner: string): Promise<WriterLock>;
    assertOwned(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=lock.d.ts.map