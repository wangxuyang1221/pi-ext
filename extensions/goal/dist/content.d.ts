export interface ContentReference {
    bundleId: string;
    digest: string;
    attachments: Array<{
        name: string;
        digest: string;
    }>;
}
export interface PreparedGoal {
    objective: string;
    content?: ContentReference;
}
/** Validate metadata before using any component as a path. */
export declare function validateContent(value: ContentReference): void;
/** Immutable content packages keep edits independent of inherited snapshots. */
export declare class GoalContent {
    readonly root: string;
    readonly temporaryRoot: string;
    private readonly drafts;
    constructor(root: string, temporaryRoot: string);
    objectivePath(reference: ContentReference): string;
    private reference;
    /** Recognize native paste filenames without opening any candidate file. */
    candidates(objective: string): string[];
    prepare(objective: string, selected: string[], previous?: PreparedGoal): Promise<PreparedGoal>;
    /** Delete only files created by this instance for this exact uncommitted draft. */
    discard(prepared: PreparedGoal): Promise<void>;
    attachments(goal: PreparedGoal): Promise<string[]>;
    expand(goal: PreparedGoal): Promise<string>;
}
//# sourceMappingURL=content.d.ts.map