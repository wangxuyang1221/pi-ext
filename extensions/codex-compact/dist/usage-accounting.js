// Adapted from OpenAI Codex 0.154.0 history accounting. See ../NOTICE.
import { createHash } from "node:crypto";
import { isUserTurnBoundary } from "./turn-boundary.js";
import { isJsonObject } from "./native-compaction.js";
/** Hashes JSON content without depending on object property insertion order. */
export function accountingFingerprint(value) {
    return createHash("sha256").update(JSON.stringify(value, (_key, part) => {
        if (!isJsonObject(part))
            return part;
        return Object.fromEntries(Object.keys(part).sort().map((key) => [key, part[key]]));
    }) ?? "").digest("hex");
}
function isModelOutput(item) {
    return (item.type === "message" && item.role === "assistant")
        || ["reasoning", "function_call", "custom_tool_call", "tool_search_call", "web_search_call",
            "image_generation_call", "local_shell_call", "compaction", "context_compaction"].includes(String(item.type));
}
/** Tracks usage only for requests observed in the current session lifecycle. */
export class WindowUsageAccounting {
    request;
    response;
    observeRequest(prefix, input) {
        this.request = { prefix, items: input.map(accountingFingerprint) };
        this.response = undefined;
    }
    observeResponse(message) {
        if (!isJsonObject(message) || message.role !== "assistant")
            return;
        this.response = undefined;
        if (!this.request || !isJsonObject(message.usage)
            || !["stop", "length", "toolUse"].includes(String(message.stopReason)))
            return;
        const total = message.usage.totalTokens;
        if (typeof total !== "number" || !Number.isSafeInteger(total) || total <= 0)
            return;
        this.response = { fingerprint: accountingFingerprint(message), total };
    }
    estimate(prefix, input, message, estimate) {
        const request = this.request;
        const response = this.response;
        if (!request || !response || prefix !== request.prefix
            || accountingFingerprint(message) !== response.fingerprint
            || input.length <= request.items.length)
            return undefined;
        for (let index = 0; index < request.items.length; index++) {
            if (accountingFingerprint(input[index]) !== request.items[index])
                return undefined;
        }
        const boundary = input.findLastIndex(isModelOutput);
        if (boundary < request.items.length)
            return undefined;
        // Pi does not expose Codex's server_reasoning_included capability. Use
        // Codex's conservative false branch, not a fabricated server capability.
        const lastUser = input.findLastIndex(isUserTurnBoundary);
        const oldReasoning = lastUser < 0 ? [] : input.slice(0, lastUser).filter((item) => item.type === "reasoning" && typeof item.encrypted_content === "string");
        return response.total + (oldReasoning.length ? estimate(oldReasoning) : 0) + estimate(input.slice(boundary + 1));
    }
}
//# sourceMappingURL=usage-accounting.js.map