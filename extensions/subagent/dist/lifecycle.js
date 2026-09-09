export function markAgentStarted(state, now) {
    if (state.runtime.busy) {
        return withRuntime(state, {
            status: "running",
            updatedAt: now,
        });
    }
    return withRuntime(state, {
        status: "running",
        busy: true,
        leafPinned: false,
        generation: state.runtime.generation + 1,
        updatedAt: now,
    });
}
export function markRuntimeStopped(state, status, now) {
    return withRuntime(state, {
        status,
        busy: false,
        updatedAt: now,
    });
}
export function markAgentSettled(state, now, settledEntryId) {
    return withRuntime(state, {
        status: "settled",
        busy: false,
        settledGeneration: state.runtime.busy
            ? state.runtime.generation
            : state.runtime.settledGeneration,
        ...(settledEntryId === undefined ? {} : { settledEntryId }),
        updatedAt: now,
    });
}
function withRuntime(state, changes) {
    return {
        ...state,
        runtime: {
            ...state.runtime,
            ...changes,
        },
    };
}
//# sourceMappingURL=lifecycle.js.map