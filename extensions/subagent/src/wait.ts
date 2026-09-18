import {
  decodeSettledCursor,
  encodeSettledCursor,
} from "./cursor.js";
import type { SessionState } from "./state-store.js";
import { DeliveryReceiptReader } from "./delivery-receipt.js";
import { DeadlineExceeded, Operation } from "./operation.js";

export type WaitOutcome = "settled" | "interrupted" | "closed" | "timeout";

export interface WaitForSettledOptions {
  agentId: string;
  afterSettled: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  readState: (signal?: AbortSignal) => Promise<SessionState | undefined>;
  wasClosed?: (signal?: AbortSignal) => Promise<boolean>;
  isAlive: (state: SessionState, signal?: AbortSignal) => Promise<boolean>;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface WaitForSettledResult {
  outcome: WaitOutcome;
  generation: number;
  durationMs: number;
  settledCursor?: string;
}

export async function waitForSettled(
  options: WaitForSettledOptions,
): Promise<WaitForSettledResult> {
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? delay;
  const startedAt = now();
  let expectedGeneration: number | undefined;
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
      if (options.wasClosed && await operation.run((signal) => options.wasClosed!(signal))) {
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
          agentId: options.agentId, epoch: state.epoch, deliveryId: decodedCursor.deliveryId!,
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
    if (state.runtime.status === "closed" || (options.wasClosed && await operation.run((signal) => options.wasClosed!(signal)))) {
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
  } catch (error) {
    if (!(error instanceof DeadlineExceeded)) throw error;
    return { outcome: "timeout", generation: lastGeneration, durationMs: Math.max(0, now() - startedAt) };
  } finally {
    operation.dispose();
  }
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);

    function finish(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort(): void {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}
