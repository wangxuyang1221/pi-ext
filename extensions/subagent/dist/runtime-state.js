import { createSessionState, } from "./state-store.js";
export function activateSession(existing, options) {
    if (!existing) {
        return createSessionState({
            sessionId: options.sessionId,
            epoch: options.createEpoch(),
            cwd: options.cwd,
            sessionFile: options.sessionFile,
            now: options.now,
            ...(options.parent ? { parent: options.parent } : {}),
            ...(options.launch ? { launch: options.launch } : {}),
            ...(options.pid === undefined ? {} : { pid: options.pid }),
            ...(options.processInstanceId ? { processInstanceId: options.processInstanceId } : {}),
            ...(options.tmux ? { tmux: options.tmux } : {}),
        });
    }
    if (existing.sessionId !== options.sessionId) {
        throw new Error("Cannot activate state from another Pi session");
    }
    if (Boolean(existing.parent) !== Boolean(options.parent)
        || (existing.parent && options.parent && (existing.parent.sessionId !== options.parent.sessionId
            || existing.parent.epoch !== options.parent.epoch
            || existing.parent.registrationToken !== options.parent.registrationToken))) {
        throw new Error("Cannot change the owner of a managed Pi session");
    }
    if (existing.parent && (existing.launch?.processInstanceId !== options.launch?.processInstanceId
        || existing.runtime.pid !== options.pid)) {
        throw new Error("Cannot change the process of a managed session instance");
    }
    const { pid: _oldPid, processInstanceId: _oldProcessInstanceId, tmux: _oldTmux, ...preservedRuntime } = existing.runtime;
    return {
        ...existing,
        ...(options.parent ? { parent: options.parent } : {}),
        ...(options.launch ? { launch: options.launch } : {}),
        runtime: {
            ...preservedRuntime,
            status: "running",
            busy: false,
            cwd: options.cwd,
            sessionFile: options.sessionFile,
            ...(options.pid === undefined ? {} : { pid: options.pid }),
            ...(options.processInstanceId ? { processInstanceId: options.processInstanceId } : {}),
            ...(options.tmux ? { tmux: options.tmux } : {}),
            updatedAt: options.now,
        },
    };
}
//# sourceMappingURL=runtime-state.js.map