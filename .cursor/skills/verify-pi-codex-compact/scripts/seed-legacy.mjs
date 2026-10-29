import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createBranchInputSnapshot, modelKey, NATIVE_COMPACTION_KIND, retainRecentMessages } from "../../../../extensions/codex-compact/dist/native-compaction.js";

// Historical markers deliberately omit preservedInputSources.
const root = resolve(process.argv[2]);
const kind = process.argv[3];
assert.equal(process.env.PI_TEST_ISOLATED, "1");
assert.equal(process.env.COMPACT_VERIFY_ROOT, root);
assert.ok(["provable", "truncated"].includes(kind));
const manager = SessionManager.create(join(root, "workspace"), join(root, "sessions"));
const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.5" };
manager.appendModelChange(model.provider, model.id);
manager.appendMessage({ role: "system", content: "Fixed legacy prompt", timestamp: 0 });
const text = "LEGACY_BEGIN_" + "x".repeat(280000) + "_LEGACY_END";
const user = manager.appendMessage({ role: "user", content: text, timestamp: 1 });
manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "aborted", provider: model.provider,
  api: model.api, model: model.id, timestamp: 2, usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const item = createBranchInputSnapshot({ branch: manager.getBranch(), tools: [] }).view(model, "full-history").items.at(-1);
const retained = retainRecentMessages([item], 64000);
assert.ok(JSON.stringify(retained).includes("truncated"));
manager.appendCompaction("Legacy checkpoint", user, 100, { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(model), compHash: "2911",
  replacementHistory: [...(kind === "truncated" ? retained : []), { type: "compaction", encrypted_content: "legacy-opaque" }], preservedInput: [item] });
console.log(JSON.stringify({ session: manager.getSessionFile(), kind }));
