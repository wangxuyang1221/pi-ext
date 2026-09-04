export declare const FAST_COMMAND_USAGE = "Usage: /fast [on|off|toggle]";
export declare class FastCommandUsageError extends Error {
    constructor(message?: string);
}
export declare function parseFastCommand(args: string, currentEnabled: boolean): boolean;
export declare function getFastCommandCompletions(argumentPrefix: string): {
    value: string;
    label: string;
}[];
//# sourceMappingURL=commands.d.ts.map