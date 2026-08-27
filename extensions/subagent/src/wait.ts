import {
  decodeSettledCursor,
  encodeSettledCursor,
} from "./cursor.js";
import type { SessionState } from "./state-store.js";

export type WaitOutcome = "settled" | "interrupted" | "closed" | "timeout";

export interface WaitForSettledOptions {
  agentId: string;
  afterSettled: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  readState: () => Promise<SessionState | undefined>;
  wasClosed?: () => Promise<boolean>;
  isAlive: (state: SessionState) => Promise<boolean>;
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
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const startedAt = now();
  let expectedGeneration: number | undefined;
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
