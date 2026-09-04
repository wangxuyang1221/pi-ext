export const FAST_COMMAND_USAGE = "Usage: /fast [on|off|toggle]";
export class FastCommandUsageError extends Error {
    constructor(message = FAST_COMMAND_USAGE) {
        super(message);
        this.name = "FastCommandUsageError";
    }
}
export function parseFastCommand(args, currentEnabled) {
    const normalized = args.trim().toLowerCase();
    if (normalized === "" || normalized === "toggle") {
        return !currentEnabled;
    }
    if (normalized === "on")
        return true;
    if (normalized === "off")
        return false;
    throw new FastCommandUsageError();
}
export function getFastCommandCompletions(argumentPrefix) {
    const prefix = argumentPrefix.trim().toLowerCase();
    return ["on", "off", "toggle"]
        .filter((option) => option.startsWith(prefix))
        .map((value) => ({ value, label: value }));
}
//# sourceMappingURL=commands.js.map