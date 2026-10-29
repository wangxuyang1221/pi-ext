import { expect, test } from "vitest";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { createSessionCoordinator } from "../src/session-coordinator.js";
import { createBranchInputSnapshot, modelKey, NATIVE_COMPACTION_KIND, type CheckpointReplayProjection, type NativeCompactionDetails } from "../src/native-compaction.js";
import { getTestModel } from "./fixtures/models.js";
import { resolveFixtureHashes } from "./fixtures/compaction-metadata.js";

test.each(["manual", "automatic", "recovery", "transition"])("supplies the projected replay budget through %s", async kind => {
	const old = { ...getTestModel("openai-codex", "gpt-5.5")!, compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } };
	const target = kind === "manual" || kind === "automatic" ? old
		: { ...getTestModel("openai-codex", "gpt-5.6-sol")!, compat: old.compat };
	const tool = { name: "read", description: "Current tool", parameters: { type: "object", properties: {} } };
	const branch: SessionEntry[] = [
		{ id: "system", parentId: null, timestamp: "2026-01-01T00:00:00Z", type: "message", message: { role: "system", content: "stable", toolsAdded: [tool], timestamp: 0 } },
		{ id: "history", parentId: "system", timestamp: "2026-01-01T00:00:01Z", type: "message", message: { role: "user", content: "history", timestamp: 1 } },
		{ id: "checkpoint", parentId: "history", timestamp: "2026-01-01T00:00:02Z", type: "custom", customType: NATIVE_COMPACTION_KIND,
			data: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(old), compHash: "2911", replacementHistory: [{ type: "compaction", encrypted_content: "old" }] } },
		{ id: "tail", parentId: "checkpoint", timestamp: "2026-01-01T00:00:02Z", type: "message", message: { role: "assistant", provider: old.provider, api: old.api, model: old.id,
			content: [{ type: "text", text: "Previous tail response" }], stopReason: "stop", timestamp: 2,
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
		{ id: "pending", parentId: "checkpoint", timestamp: "2026-01-01T00:00:03Z", type: "message", message: { role: "user", content: "pending", timestamp: 3 } },
	];
	const ctx = { cwd: "/nonexistent-compaction-test", isProjectTrusted: () => false, model: target, getSystemPrompt: () => "stable",
		sessionManager: { getSessionId: () => "session", getBranch: () => branch },
		modelRegistry: { find: (provider: string, id: string) => (kind === "recovery" ? [target] : [old, target]).find(model => model.provider === provider && model.id === id) },
	} as unknown as ExtensionContext;
	let projectReplay: CheckpointReplayProjection | undefined;
	const coordinator = createSessionCoordinator({ getBranch: () => branch, getAllTools: () => [], resolveCompactionHashes: resolveFixtureHashes,
		shouldAutoCompact: () => true,
		createCheckpoint: async params => {
			projectReplay = params.projectReplay;
			return { details: { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(params.model), replacementHistory: [{ type: "compaction", encrypted_content: "new" }] } };
		},
		appendCheckpoint: data => branch.push({ id: `new-${branch.length}`, parentId: "pending", timestamp: "2026-01-01T00:00:04Z", type: "custom", customType: NATIVE_COMPACTION_KIND, data }),
		appendCheckpointBypass: () => { throw new Error("Unexpected bypass"); },
	});
	if (kind === "manual") projectReplay = (await coordinator.prepareCompactionPlan(target, ctx)).projectReplay;
	else {
		const input = createBranchInputSnapshot({ branch, tools: [] }).view(target, "effective", { allowCheckpointModelMismatch: true }).items;
		if (kind === "transition") await coordinator.selectModel({ model: target, previousModel: old }, ctx);
		if (kind === "recovery") await coordinator.recoverCurrentModel(target, ctx, { instructions: "stable", tools: [] }, input);
		else await coordinator.prepareRequest(target, ctx, input, { instructions: "stable", tools: [] });
	}
	expect(projectReplay).toBeTypeOf("function");
	const details: NativeCompactionDetails = { kind: NATIVE_COMPACTION_KIND, version: 2, modelKey: modelKey(target), replacementHistory: [{ type: "compaction", encrypted_content: "candidate" }] };
	const replay = projectReplay!(details.replacementHistory);
	expect(replay.input.filter(item => item.role === "user")).toEqual([{ role: "user", content: [{ type: "input_text", text: "pending" }] }]);
	expect(replay.input.filter(item => item.type === "additional_tools").flatMap(item => item.tools as any[]).map(tool => tool.name)).toEqual(["read"]);
});
