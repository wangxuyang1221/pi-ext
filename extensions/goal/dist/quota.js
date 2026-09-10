// Verified account-limit identifiers, not Pi's broader non-retryable matcher.
// Pi 0.84.3: packages/ai/src/utils/retry.ts at 4e58f324fae8ebfa98a3d45181fb248072a2afac.
// Codex 0.153.4: codex-rs/codex-api/src/api_bridge.rs and protocol/src/error.rs
// at 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a.
const ACCOUNT_CODES = new Set(["insufficient_quota", "usage_limit_reached", "gousagelimiterror", "freeusagelimiterror"]);
const ACCOUNT_MESSAGES = /^(?:you've hit your usage limit(?:\.| for )|your workspace is out of credits\.|quota exceeded\. check your plan and billing details\.)/i;
/** Recognize only verified account exhaustion codes and explicit messages. */
export function isAccountUsageLimit(message) {
    // Pi 0.84.3/0.85.1 agent-session.ts and compaction.ts add these wrappers.
    const normalized = message.trim().replace(/’/g, "'")
        .replace(/^(?:Context overflow recovery|Auto-compaction) failed:\s*/i, "")
        .replace(/^(?:Turn prefix summarization|Summarization) failed:\s*/i, "")
        .replace(/^(?:HTTP )?\d{3}(?:\s+|:\s*)/i, "");
    if (ACCOUNT_CODES.has(normalized.toLowerCase()) || ACCOUNT_MESSAGES.test(normalized))
        return true;
    try {
        const envelope = JSON.parse(normalized);
        const error = envelope?.error ?? envelope;
        return [error?.code, error?.type].some(code => typeof code === "string" && ACCOUNT_CODES.has(code.toLowerCase()))
            || (typeof error?.message === "string" && ACCOUNT_MESSAGES.test(error.message.trim().replace(/’/g, "'")));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=quota.js.map