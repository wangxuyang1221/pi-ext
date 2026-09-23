import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";

/** Project a raw branch without discarding history at a compaction boundary. */
export function projectBranchMessages(entries: SessionEntry[], includeCompactionSummary = false) {
	const edits = new Map<string, Extract<SessionEntry, { type: "context_edit" }>>();
	for (const entry of entries) {
		if (entry.type === "context_edit") edits.set(entry.targetId, entry);
	}
	return entries.map((entry) => {
		if (entry.type === "compaction" && !includeCompactionSummary) return [];
		const messages = sessionEntryToContextMessages(entry);
		const edit = edits.get(entry.id);
		if (!edit) return messages;
		if (edit.replacement === null) return [];
		return messages.map((message) => {
			if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult" && message.role !== "custom") return message;
			const replacement = edit.replacement!.content;
			const content = (message.role === "assistant" || message.role === "toolResult") && typeof replacement === "string"
				? [{ type: "text" as const, text: replacement }]
				: replacement;
			return { ...message, content } as typeof message;
		});
	});
}
