import { isDeepStrictEqual } from "node:util";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionEntry, ToolInfo } from "@earendil-works/pi-coding-agent";
import { createBranchInputSnapshot, HistoryPrefixMismatchError, isJsonObject, type JsonObject, type RequestProjectionPolicy, type ResponseItem } from "./native-compaction.js";

/** Recognize Pi's declaration filtering and forced-prompt projections, never arbitrary context hooks. */
export function resolveRequestProjection(branch: SessionEntry[], model: Model<any>, tools: ToolInfo[], input: ResponseItem[], payload: JsonObject): RequestProjectionPolicy {
	if (typeof payload.instructions !== "string") throw new HistoryPrefixMismatchError(0);
	const baseline = createBranchInputSnapshot({ branch, tools });
	const full = baseline.projection.fullHistory();
	const active = branch.some(entry => entry.type === "compaction") ? baseline.projection.piContext() : full;
	const declared = (entries: typeof full) => new Set(entries.flatMap(entry => entry.messages.flatMap(message => message.role === "system" ? (message.toolsAdded ?? []).map(tool => tool.name) : [])));
	const allNames = declared(full);
	const activeNames = declared(active);
	const observed = new Set<string>();
	const remember = (values: unknown) => {
		if (Array.isArray(values)) for (const value of values) if (isJsonObject(value) && typeof value.name === "string") observed.add(value.name);
	};
	remember(payload.tools);
	for (const item of input) if (item.type === "additional_tools" || item.type === "tool_search_output") remember(item.tools);
	const minimalHidden = new Set([...activeNames].filter(name => !observed.has(name)));
	const maximalHidden = new Set([...allNames].filter(name => !observed.has(name)));
	const seen = new Set<string>();
	let additive = true;
	for (const entry of full) for (const message of entry.messages) {
		if (message.role !== "system") continue;
		if (message.toolsRemoved?.length) additive = false;
		for (const tool of message.toolsAdded ?? []) {
			if (seen.has(tool.name)) additive = false;
			seen.add(tool.name);
		}
	}
	// For additive histories each unobserved declaration is independent. Checking the two
	// extremes proves whether invisible declarations can change replay, without 2^T subsets.
	// Non-additive hidden histories need a policy adapter; normal and forced replay remain testable.
	const policies: RequestProjectionPolicy[] = [{ hiddenNames: new Set() }];
	if (additive) policies.push({ hiddenNames: minimalHidden }, { hiddenNames: maximalHidden });
	const normalInstructions = baseline.view(model, "pi-context", { allowCheckpointModelMismatch: true }).instructions || "You are a helpful assistant.";
	// If prompt text is unchanged, a non-additive hidden history can be observationally
	// indistinguishable from forced collapse. Do not choose one explanation silently.
	if (additive || normalInstructions !== payload.instructions) policies.push({ hiddenNames: maximalHidden, forcedPrompt: payload.instructions });
	let selected: RequestProjectionPolicy | undefined;
	let replay: ResponseItem[] | undefined;
	for (const policy of policies) {
		const snapshot = createBranchInputSnapshot({ branch, tools, projectionPolicy: policy });
		for (const kind of ["pi-context", "full-history", "effective"] as const) {
			const wire = snapshot.view(model, kind, { allowCheckpointModelMismatch: true });
			if (!isDeepStrictEqual(wire.items, input) || (wire.instructions || "You are a helpful assistant.") !== payload.instructions
				|| !isDeepStrictEqual(wire.tools ?? [], payload.tools ?? [])) continue;
			const candidate = snapshot.view(model, "effective", { allowCheckpointModelMismatch: true }).items;
			if (replay && !isDeepStrictEqual(replay, candidate)) throw new Error("The observed Codex payload has ambiguous checkpoint replay under the supported projection policies.");
			selected ??= policy;
			replay = candidate;
		}
	}
	if (!selected) throw new HistoryPrefixMismatchError(0);
	return selected;
}
