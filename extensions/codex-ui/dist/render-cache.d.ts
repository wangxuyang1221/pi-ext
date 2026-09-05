export interface RenderCacheScope {
    readonly active: boolean;
    identity(source: object): number;
    lines(key: string, compute: () => string[]): string[];
    prefix(key: string, length: number, compute: (index: number) => string): string[];
    count(key: string, compute: () => number): number;
}
/** A single budget shared by all tool rows of an extension instance. */
export declare class ToolRenderCache {
    private readonly layouts;
    private readonly counts;
    private generation;
    private identities;
    private nextIdentity;
    constructor(options?: {
        layoutBytes?: number;
        countBytes?: number;
    });
    scope(): RenderCacheScope;
    clear(): void;
    stats(): {
        layouts: {
            limitBytes: number;
            chargedBytes: number;
            entries: number;
            hits: number;
            misses: number;
            evictions: number;
        };
        counts: {
            limitBytes: number;
            chargedBytes: number;
            entries: number;
            hits: number;
            misses: number;
            evictions: number;
        };
    };
}
//# sourceMappingURL=render-cache.d.ts.map