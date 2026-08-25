import { MODE_LABELS, MODES, applyModeChange, createPermissionState, formatStatusTextForTheme, handleToolCall, parseModeArg, } from "./permission-policy.js";
/**
 * Registers process-local permission modes and tool approval gates.
 *
 * @param pi - Pi extension API.
 * @param options - Optional environment override used by tests and embedded runtimes.
 */
export default function permissionsExtension(pi, options = {}) {
    const env = options.env ?? process.env;
    const state = createPermissionState({ env });
    const updateStatus = (ctx) => {
        if (!ctx.hasUI)
            return;
        ctx.ui.setStatus("permissions", formatStatusTextForTheme(state.getMode(), ctx.ui.theme));
    };
    pi.on("session_start", async (_event, ctx) => {
        updateStatus(ctx);
    });
    pi.on("tool_call", async (event, ctx) => {
        updateStatus(ctx);
        return handleToolCall(toPermissionToolCall(event), ctx, state);
    });
    pi.registerCommand("permissions", {
        description: "Switch between Default permissions and Full access",
        getArgumentCompletions: (prefix) => {
            const values = ["default", "full"];
            const matches = values.filter((value) => value.startsWith(prefix.trim()));
            return matches.length > 0
                ? matches.map((value) => ({ value, label: value }))
                : null;
        },
        handler: async (args, ctx) => {
            const requestedMode = parseModeArg(args);
            if (requestedMode) {
                const result = await applyModeChange(state, requestedMode, ctx);
                updateStatus(ctx);
                notifyModeChange(ctx, result, MODE_LABELS[state.getMode()]);
                return;
            }
            if (!ctx.hasUI) {
                ctx.ui.notify("Cannot switch permissions mode without UI. Use /permissions default or /permissions full.", "error");
                return;
            }
            const choice = await ctx.ui.select("Update Model Permissions", [
                MODE_LABELS[MODES.DEFAULT],
                MODE_LABELS[MODES.FULL_ACCESS],
            ]);
            const selectedMode = choice === MODE_LABELS[MODES.DEFAULT]
                ? MODES.DEFAULT
                : choice === MODE_LABELS[MODES.FULL_ACCESS]
                    ? MODES.FULL_ACCESS
                    : undefined;
            if (!selectedMode)
                return;
            const result = await applyModeChange(state, selectedMode, ctx);
            updateStatus(ctx);
            notifyModeChange(ctx, result, MODE_LABELS[state.getMode()]);
        },
    });
}
function toPermissionToolCall(event) {
    return {
        toolName: event.toolName,
        input: event.input,
    };
}
function notifyModeChange(ctx, result, label) {
    if (result.changed) {
        ctx.ui.notify(`Permissions updated to ${label}`, "info");
    }
    else if (result.reason) {
        ctx.ui.notify(result.reason, "error");
    }
}
//# sourceMappingURL=index.js.map