export const DEFAULT_MCP_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_MCP_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_MCP_RETRY_FACTOR = 2;
export const DEFAULT_MCP_RETRY_MAX_DELAY_MS = 5_000;
export const MAX_MCP_RETRY_AFTER_MS = 5 * 60_000;
export const DEFAULT_MCP_BACKGROUND_MAX_DELAY_MS = 5 * 60_000;
const RETRYABLE_HTTP_STATUSES = new Set([
    408,
    429,
    500,
    502,
    503,
    504,
]);
const NON_RETRYABLE_CATEGORIES = new Set([
    "cancelled",
    "auth",
    "protocol",
    "config",
]);
export const DEFAULT_MCP_RETRY_CONFIG = Object.freeze({
    enabled: true,
    maxAttempts: DEFAULT_MCP_RETRY_MAX_ATTEMPTS,
    baseDelayMs: DEFAULT_MCP_RETRY_BASE_DELAY_MS,
    factor: DEFAULT_MCP_RETRY_FACTOR,
    maxDelayMs: DEFAULT_MCP_RETRY_MAX_DELAY_MS,
    retryAfterMaxMs: MAX_MCP_RETRY_AFTER_MS,
    background: true,
    backgroundMaxDelayMs: DEFAULT_MCP_BACKGROUND_MAX_DELAY_MS,
});
/** Resolves partial retry configuration to finite, stable runtime values. */
export function parseMcpRetryConfig(config) {
    return {
        enabled: config?.enabled ?? DEFAULT_MCP_RETRY_CONFIG.enabled,
        maxAttempts: positiveInteger(config?.maxAttempts, DEFAULT_MCP_RETRY_CONFIG.maxAttempts),
        baseDelayMs: nonNegativeInteger(config?.baseDelayMs, DEFAULT_MCP_RETRY_CONFIG.baseDelayMs),
        factor: finiteAtLeast(config?.factor, 1, DEFAULT_MCP_RETRY_CONFIG.factor),
        maxDelayMs: nonNegativeInteger(config?.maxDelayMs, DEFAULT_MCP_RETRY_CONFIG.maxDelayMs),
        retryAfterMaxMs: Math.min(nonNegativeInteger(config?.retryAfterMaxMs, DEFAULT_MCP_RETRY_CONFIG.retryAfterMaxMs), MAX_MCP_RETRY_AFTER_MS),
        background: config?.background ?? DEFAULT_MCP_RETRY_CONFIG.background,
        backgroundMaxDelayMs: nonNegativeInteger(config?.backgroundMaxDelayMs, DEFAULT_MCP_RETRY_CONFIG.backgroundMaxDelayMs),
    };
}
/** Returns whether another attempt is allowed for a normalized error. */
export function shouldRetryMcpError(error, failedAttempt, config) {
    const resolved = parseMcpRetryConfig(config);
    if (!resolved.enabled || !isPositiveAttempt(failedAttempt))
        return false;
    if (failedAttempt >= resolved.maxAttempts)
        return false;
    if (NON_RETRYABLE_CATEGORIES.has(error.category))
        return false;
    if (error.httpStatus !== undefined) {
        if (error.category === "session-expired")
            return error.retryable;
        return isRetryableHttpStatus(error.httpStatus);
    }
    return error.retryable;
}
/** Calculates full-jitter delay after a one-based failed attempt. */
export function calculateMcpRetryDelay(error, failedAttempt, config, random = Math.random) {
    const resolved = parseMcpRetryConfig(config);
    const retryAfterMs = validRetryAfter(error.retryAfterMs, resolved.retryAfterMaxMs);
    if (retryAfterMs !== undefined)
        return retryAfterMs;
    const exponent = Math.max(0, Math.floor(failedAttempt) - 1);
    const exponentialDelay = resolved.baseDelayMs * Math.pow(resolved.factor, exponent);
    const delayCap = Math.min(resolved.maxDelayMs, Number.isFinite(exponentialDelay) ? exponentialDelay : resolved.maxDelayMs);
    return Math.floor(Math.max(0, delayCap) * normalizedRandom(random));
}
/** Parses an HTTP Retry-After delay-seconds or HTTP-date value in milliseconds. */
export function parseHttpRetryAfter(value, nowMs = Date.now(), maxDelayMs = MAX_MCP_RETRY_AFTER_MS) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    if (!trimmed)
        return undefined;
    const cap = Math.min(nonNegativeInteger(maxDelayMs, MAX_MCP_RETRY_AFTER_MS), MAX_MCP_RETRY_AFTER_MS);
    if (/^\d+$/.test(trimmed)) {
        const seconds = Number(trimmed);
        if (!Number.isFinite(seconds))
            return cap;
        return Math.min(seconds * 1_000, cap);
    }
    if (!/[A-Za-z]/.test(trimmed))
        return undefined;
    const timestamp = Date.parse(trimmed);
    if (!Number.isFinite(timestamp) || !Number.isFinite(nowMs))
        return undefined;
    return Math.min(Math.max(0, timestamp - nowMs), cap);
}
/** Decides whether to retry and verifies that its delay fits the total deadline. */
export function decideMcpRetry(error, failedAttempt, config, options = {}) {
    const resolved = parseMcpRetryConfig(config);
    if (!resolved.enabled)
        return { retry: false, reason: "disabled" };
    if (!isPositiveAttempt(failedAttempt) || failedAttempt >= resolved.maxAttempts) {
        return { retry: false, reason: "attempts-exhausted" };
    }
    if (!shouldRetryMcpError(error, failedAttempt, resolved)) {
        return { retry: false, reason: "not-retryable" };
    }
    const delayMs = calculateMcpRetryDelay(error, failedAttempt, resolved, options.random);
    const nowMs = options.nowMs ?? Date.now();
    if (!canRetryBeforeDeadline(delayMs, options.deadlineMs, nowMs)) {
        return { retry: false, reason: "deadline-exceeded" };
    }
    return { retry: true, delayMs };
}
/** Returns true when sleeping still leaves time for the next attempt. */
export function canRetryBeforeDeadline(delayMs, deadlineMs, nowMs = Date.now()) {
    if (deadlineMs === undefined)
        return true;
    if (!Number.isFinite(delayMs) || delayMs < 0)
        return false;
    if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs))
        return false;
    return nowMs < deadlineMs && delayMs < deadlineMs - nowMs;
}
/** Sleeps for a retry only when the delay fits the remaining deadline. */
export async function scheduleMcpRetry(delayMs, options = {}) {
    const scheduler = options.scheduler ?? defaultMcpRetryScheduler;
    if (!canRetryBeforeDeadline(delayMs, options.deadlineMs, scheduler.now())) {
        return false;
    }
    await scheduler.sleep(delayMs, options.signal);
    return options.deadlineMs === undefined || scheduler.now() < options.deadlineMs;
}
export const defaultMcpRetryScheduler = {
    now: () => Date.now(),
    sleep(delayMs, signal) {
        if (signal?.aborted)
            return Promise.reject(abortReason(signal));
        const safeDelay = nonNegativeInteger(delayMs, 0);
        if (safeDelay === 0)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            let timer;
            const cleanup = () => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                    timer = undefined;
                }
                signal?.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
                cleanup();
                reject(abortReason(signal));
            };
            timer = setTimeout(() => {
                cleanup();
                resolve();
            }, safeDelay);
            timer.unref?.();
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted)
                onAbort();
        });
    },
};
function isRetryableHttpStatus(status) {
    return RETRYABLE_HTTP_STATUSES.has(status) || (status >= 520 && status <= 527);
}
function validRetryAfter(value, maxDelayMs) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return undefined;
    }
    return Math.min(Math.floor(value), maxDelayMs, MAX_MCP_RETRY_AFTER_MS);
}
function normalizedRandom(random) {
    let value;
    try {
        value = random();
    }
    catch {
        return 0;
    }
    if (!Number.isFinite(value))
        return 0;
    return Math.min(1, Math.max(0, value));
}
function isPositiveAttempt(value) {
    return Number.isInteger(value) && value > 0;
}
function positiveInteger(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback;
}
function nonNegativeInteger(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : fallback;
}
function finiteAtLeast(value, minimum, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value >= minimum
        ? value
        : fallback;
}
function abortReason(signal) {
    return signal?.reason ?? new DOMException("The operation was aborted", "AbortError");
}
//# sourceMappingURL=retry.js.map