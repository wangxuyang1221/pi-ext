import type { SessionState } from "./state-store.js";

export function markAgentStarted(state: SessionState, now: string): SessionState {
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

export function markRuntimeStopped(
  state: SessionState,
  status: "closed" | "interrupted" | "errored",
  now: string,
): SessionState {
  return withRuntime(state, {
    status,
    busy: false,
    updatedAt: now,
  });
}

export function markAgentSettled(
  state: SessionState,
  now: string,
  settledEntryId?: string,
): SessionState {
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

function withRuntime(
  state: SessionState,
  changes: Partial<SessionState["runtime"]>,
): SessionState {
  return {
    ...state,
    runtime: {
      ...state.runtime,
      ...changes,
    },
  };
}
