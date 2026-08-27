import { decodeSettledCursor, encodeSettledCursor, } from "./cursor.js";
export async function waitForSettled(options) {
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? delay;
    const startedAt = now();
    let expectedGeneration;
    let lastGeneration = 0;
    while (true) {
        options.signal?.throwIfAborted();
        const state = await options.readState();
        const durationMs = Math.max(0, now() - startedAt);
        if (!state) {
            if (await options.wasClosed?.() === true) {
                return {
                    outcome: "closed",
                    generation: lastGeneration,
                    durationMs,
                };
            }
            throw new Error(`Subagent state disappeared while waiting: ${options.agentId}`);
        }
        lastGeneration = state.runtime.generation;
        const decodedCursor = decodeSettledCursor(options.afterSettled, {
            agentId: options.agentId,
            epoch: state.epoch,
        });
        expectedGeneration ??= decodedCursor.generation;
        if (state.runtime.settledGeneration > expectedGeneration) {
            return {
                outcome: "settled",
                generation: state.runtime.settledGeneration,
                durationMs,
                settledCursor: encodeSettledCursor({
                    agentId: options.agentId,
                    epoch: state.epoch,
                    generation: state.runtime.settledGeneration,
                }),
            };
        }
        if (state.runtime.status === "closed" || await options.wasClosed?.() === true) {
            return {
                outcome: "closed",
                generation: state.runtime.generation,
                durationMs,
            };
        }
        if (state.runtime.status === "interrupted" || state.runtime.status === "errored") {
            return {
                outcome: "interrupted",
                generation: state.runtime.generation,
                durationMs,
            };
        }
        if (state.runtime.status !== "closing" && !await options.isAlive(state)) {
            return {
                outcome: "interrupted",
                generation: state.runtime.generation,
                durationMs,
            };
        }
        if (durationMs >= options.timeoutMs) {
            return {
                outcome: "timeout",
                generation: state.runtime.generation,
                durationMs,
            };
        }
        const remaining = options.timeoutMs - durationMs;
        await sleep(Math.min(options.pollIntervalMs ?? 100, remaining), options.signal);
    }
}
async function delay(milliseconds, signal) {
    if (signal?.aborted)
        signal.throwIfAborted();
    await new Promise((resolve, reject) => {
        const timer = setTimeout(finish, milliseconds);
        function finish() {
            signal?.removeEventListener("abort", abort);
            resolve();
        }
        function abort() {
            clearTimeout(timer);
            reject(signal?.reason ?? new Error("Aborted"));
        }
        signal?.addEventListener("abort", abort, { once: true });
    });
}
//# sourceMappingURL=wait.js.map