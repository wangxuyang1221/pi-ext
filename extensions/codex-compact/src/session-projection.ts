import {
	buildSessionProjection,
	sessionEntryToContextMessages,
	type ProjectedSessionEntry,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

export type ProjectedBranchEntry = {
	sourceEntry: SessionEntry;
	sourceIndex: number;
	messages: ProjectedSessionEntry["messages"];
};

export type BranchProjectionSnapshot = {
	branch: readonly SessionEntry[];
	sourceIndexById: ReadonlyMap<string, number>;
	fullHistory(): readonly ProjectedBranchEntry[];
	piContext(): readonly ProjectedBranchEntry[];
};

export function createBranchProjectionSnapshot(branch: SessionEntry[]): BranchProjectionSnapshot {
	const selected = branch.slice();
	const sourceIndexById = new Map(selected.map((entry, index) => [entry.id, index]));
	let fullHistory: readonly ProjectedBranchEntry[] | undefined;
	let piContext: readonly ProjectedBranchEntry[] | undefined;
	return {
		branch: selected,
		sourceIndexById,
		fullHistory: () => {
			if (fullHistory) return fullHistory;
			const edits = new Map<string, Extract<SessionEntry, { type: "context_edit" }>>();
			for (const entry of selected) {
				if (entry.type === "context_edit") edits.set(entry.targetId, entry);
			}
			fullHistory = selected.map((sourceEntry, sourceIndex) => {
				if (sourceEntry.type === "compaction") return { sourceEntry, sourceIndex, messages: [] };
				const messages = sessionEntryToContextMessages(sourceEntry);
				const edit = edits.get(sourceEntry.id);
				if (!edit) return { sourceEntry, sourceIndex, messages };
				if (edit.replacement === null) return { sourceEntry, sourceIndex, messages: [] };
				return {
					sourceEntry,
					sourceIndex,
					messages: messages.map((message) => {
						if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult" && message.role !== "custom") return message;
						const replacement = edit.replacement!.content;
						const content = (message.role === "assistant" || message.role === "toolResult") && typeof replacement === "string"
							? [{ type: "text" as const, text: replacement }]
							: replacement;
						return { ...message, content } as typeof message;
					}),
				};
			});
			return fullHistory;
		},
		piContext: () => {
			if (piContext) return piContext;
			if (selected.length === 0) return piContext = [];
			const shadow = selected.map((entry, index) => ({ ...entry, parentId: selected[index - 1]?.id ?? null } as SessionEntry));
			piContext = buildSessionProjection(shadow, shadow.at(-1)!.id).entries.map(({ sourceEntry, messages }) => ({
				sourceEntry: selected[sourceIndexById.get(sourceEntry.id)!]!,
				sourceIndex: sourceIndexById.get(sourceEntry.id)!,
				messages,
			}));
			return piContext;
		},
	};
}

/** Project a raw branch without discarding history at a compaction boundary. */
export function projectBranchMessages(entries: SessionEntry[]) {
	return createBranchProjectionSnapshot(entries).fullHistory().map((entry) => entry.messages);
}
