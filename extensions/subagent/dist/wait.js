import { decodeSettledCursor, encodeSettledCursor, } from "./cursor.js";
import { DeliveryReceiptReader } from "./delivery-receipt.js";
import { DeadlineExceeded, Operation } from "./operation.js";
export async function waitForSettled(options) {
    const now = options.now ?? (() => performance.now());
    const sleep = options.sleep ?? delay;
    const startedAt = now();
    let expectedGeneration;
    let lastGeneration = 0;
    const receiptReader = new DeliveryReceiptReader();
    // A zero timeout still permits one bounded snapshot, but never another poll.
    const operation = new Operation(options.timeoutMs === 0 ? 250 : options.timeoutMs, options.signal);
    try {
        while (true) {
            operation.signal.throwIfAborted();
            const state = await operation.run((signal) => options.readState(signal));
            const durationMs = Math.max(0, now() - startedAt);
            if (!state) {
                if (options.wasClosed && await operation.run((signal) => options.wasClosed(signal))) {
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
            const consumedGeneration = decodedCursor.deliveryId
                ? await operation.run((signal) => receiptReader.read(state.runtime.sessionFile, {
                    agentId: options.agentId, epoch: state.epoch, deliveryId: decodedCursor.deliveryId,
                }, signal))
                : undefined;
            const settled = decodedCursor.deliveryId
                ? consumedGeneration !== undefined && state.runtime.settledGeneration >= consumedGeneration
                : state.runtime.settledGeneration > expectedGeneration;
            if (settled) {
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
            if (state.runtime.status === "closed" || (options.wasClosed && await operation.run((signal) => options.wasClosed(signal)))) {
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
            if (state.runtime.status !== "closing" && !await operation.run((signal) => options.isAlive(state, signal))) {
                return {
                    outcome: "interrupted",
                    generation: state.runtime.generation,
                    durationMs,
                };
            }
            if (now() - startedAt >= options.timeoutMs) {
                return {
                    outcome: "timeout",
                    generation: state.runtime.generation,
                    durationMs,
                };
            }
            const remaining = options.timeoutMs - (now() - startedAt);
            await operation.run((signal) => sleep(Math.min(options.pollIntervalMs ?? 100, remaining), signal));
        }
    }
    catch (error) {
        if (!(error instanceof DeadlineExceeded))
            throw error;
        return { outcome: "timeout", generation: lastGeneration, durationMs: Math.max(0, now() - startedAt) };
    }
    finally {
        operation.dispose();
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