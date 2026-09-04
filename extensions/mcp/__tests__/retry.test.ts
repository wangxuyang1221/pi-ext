import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpNormalizedError } from "../src/types.js";
import {
  DEFAULT_MCP_RETRY_CONFIG,
  MAX_MCP_RETRY_AFTER_MS,
  calculateMcpRetryDelay,
  decideMcpRetry,
  defaultMcpRetryScheduler,
  parseHttpRetryAfter,
  parseMcpRetryConfig,
  scheduleMcpRetry,
  shouldRetryMcpError,
  type McpRetryScheduler,
} from "../src/retry.js";

function normalizedError(
  overrides: Partial<McpNormalizedError> = {},
): McpNormalizedError {
  return {
    category: "connection",
    message: "Connection failed",
    retryable: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("retry configuration", () => {
  it("uses stable production defaults", () => {
    expect(parseMcpRetryConfig(undefined)).toEqual({
      enabled: true,
      maxAttempts: 3,
      baseDelayMs: 500,
      factor: 2,
      maxDelayMs: 5_000,
      retryAfterMaxMs: 300_000,
      background: true,
      backgroundMaxDelayMs: 300_000,
    });
    expect(Object.isFrozen(DEFAULT_MCP_RETRY_CONFIG)).toBe(true);
  });

  it("normalizes invalid values and caps Retry-After", () => {
    expect(parseMcpRetryConfig({
      maxAttempts: 2.9,
      baseDelayMs: -1,
      factor: 0.5,
      maxDelayMs: Number.NaN,
      retryAfterMaxMs: 900_000,
      backgroundMaxDelayMs: 12.8,
    })).toMatchObject({
      maxAttempts: 2,
      baseDelayMs: 500,
      factor: 2,
      maxDelayMs: 5_000,
      retryAfterMaxMs: MAX_MCP_RETRY_AFTER_MS,
      backgroundMaxDelayMs: 12,
    });
  });
});

describe("retryable decisions", () => {
  it.each([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527])(
    "retries transient HTTP status %i",
    (httpStatus) => {
      expect(shouldRetryMcpError(normalizedError({ httpStatus }), 1)).toBe(true);
    },
  );

  it.each([400, 404, 409, 501, 505, 519, 528])(
    "does not retry non-transient HTTP status %i",
    (httpStatus) => {
      expect(shouldRetryMcpError(normalizedError({ httpStatus }), 1)).toBe(false);
    },
  );

  it.each(["auth", "config", "protocol", "cancelled"] as const)(
    "does not retry %s errors",
    (category) => {
      expect(shouldRetryMcpError(normalizedError({ category }), 1)).toBe(false);
    },
  );

  it("honors disabled retry and the total attempt limit", () => {
    const error = normalizedError();
    expect(shouldRetryMcpError(error, 1, { enabled: false })).toBe(false);
    expect(shouldRetryMcpError(error, 3)).toBe(false);
    expect(shouldRetryMcpError(error, 0)).toBe(false);
  });
});

describe("retry delay", () => {
  it("uses full jitter over the exponential delay cap", () => {
    const error = normalizedError();
    const config = { maxAttempts: 10, maxDelayMs: 5_000 };

    expect(calculateMcpRetryDelay(error, 1, config, () => 0)).toBe(0);
    expect(calculateMcpRetryDelay(error, 1, config, () => 0.5)).toBe(250);
    expect(calculateMcpRetryDelay(error, 2, config, () => 0.5)).toBe(500);
    expect(calculateMcpRetryDelay(error, 10, config, () => 0.5)).toBe(2_500);
    expect(calculateMcpRetryDelay(error, 10, config, () => 1)).toBe(5_000);
  });

  it("prefers Retry-After and does not apply jitter to it", () => {
    const random = vi.fn(() => 0);
    const delay = calculateMcpRetryDelay(
      normalizedError({ retryAfterMs: 45_000 }),
      1,
      undefined,
      random,
    );

    expect(delay).toBe(45_000);
    expect(random).not.toHaveBeenCalled();
  });

  it("caps Retry-After at five minutes", () => {
    expect(calculateMcpRetryDelay(
      normalizedError({ retryAfterMs: 900_000 }),
      1,
      undefined,
      () => 0,
    )).toBe(MAX_MCP_RETRY_AFTER_MS);
  });
});

describe("HTTP Retry-After parsing", () => {
  it("parses delay-seconds", () => {
    expect(parseHttpRetryAfter("120", 0)).toBe(120_000);
    expect(parseHttpRetryAfter(" 2 ", 0)).toBe(2_000);
  });

  it("parses HTTP dates relative to the supplied clock", () => {
    const now = Date.parse("Wed, 21 Oct 2015 07:27:00 GMT");
    expect(parseHttpRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", now)).toBe(60_000);
    expect(parseHttpRetryAfter("Wed, 21 Oct 2015 07:26:00 GMT", now)).toBe(0);
  });

  it("caps large values and rejects malformed values", () => {
    expect(parseHttpRetryAfter("999999", 0)).toBe(MAX_MCP_RETRY_AFTER_MS);
    expect(parseHttpRetryAfter("1.5", 0)).toBeUndefined();
    expect(parseHttpRetryAfter("later", 0)).toBeUndefined();
    expect(parseHttpRetryAfter(null, 0)).toBeUndefined();
  });
});

describe("deadline-aware scheduling", () => {
  it("stops when the retry delay leaves no time for another attempt", () => {
    expect(decideMcpRetry(
      normalizedError({ retryAfterMs: 1_000 }),
      1,
      undefined,
      { nowMs: 5_000, deadlineMs: 6_000 },
    )).toEqual({ retry: false, reason: "deadline-exceeded" });
  });

  it("returns a retry decision when delay fits the deadline", () => {
    expect(decideMcpRetry(
      normalizedError(),
      1,
      undefined,
      { nowMs: 5_000, deadlineMs: 6_000, random: () => 0.5 },
    )).toEqual({ retry: true, delayMs: 250 });
  });

  it("does not invoke the scheduler when the deadline is insufficient", async () => {
    const scheduler: McpRetryScheduler = {
      now: vi.fn(() => 1_000),
      sleep: vi.fn().mockResolvedValue(undefined),
    };

    await expect(scheduleMcpRetry(500, {
      scheduler,
      deadlineMs: 1_500,
    })).resolves.toBe(false);
    expect(scheduler.sleep).not.toHaveBeenCalled();
  });
});

describe("default scheduler", () => {
  it("resolves after the requested delay and clears its timer", async () => {
    vi.useFakeTimers();
    const sleep = defaultMcpRetryScheduler.sleep(1_000);

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(sleep).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels sleep through AbortSignal and clears its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new DOMException("Stopped", "AbortError");
    const sleep = defaultMcpRetryScheduler.sleep(10_000, controller.signal);

    expect(vi.getTimerCount()).toBe(1);
    controller.abort(reason);
    await expect(sleep).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort(new DOMException("Stopped", "AbortError"));

    await expect(defaultMcpRetryScheduler.sleep(1_000, controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unrefs the Node timer", async () => {
    const unref = vi.fn();
    const fakeTimer = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
      .mockReturnValue(fakeTimer);
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout")
      .mockImplementation(() => undefined);
    const controller = new AbortController();
    const sleep = defaultMcpRetryScheduler.sleep(1_000, controller.signal);

    expect(setTimeoutSpy).toHaveBeenCalledOnce();
    expect(unref).toHaveBeenCalledOnce();
    controller.abort(new DOMException("Stopped", "AbortError"));
    await expect(sleep).rejects.toMatchObject({ name: "AbortError" });
    expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);
  });
});
